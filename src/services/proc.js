/**
 * 子进程启动。
 *
 * 设计约束（每条都对应一个真实踩过的坑）：
 *   · Windows 上 spawn('cmd', ['/c', ...]) 即使 windowsHide 为 true 也会闪控制台，
 *     所以这里一律直接 spawn 可执行文件，不经过 cmd。
 *   · python.exe 是控制台程序，windowsHide 对它不可靠；优先用同目录的 pythonw.exe。
 *   · 服务进程要脱离宿主，否则 DSH 退出会把它们一起带走。
 *   · 启动前先探端口、启动中加锁，避免连点拉起多个进程抢端口。
 */

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'

/** 端口是否已有进程在监听。 */
export function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) { resolve(false); return }
    const sock = new net.Socket()
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
    try { sock.connect(port, host) } catch { finish(false) }
  })
}

/** 等端口就绪，每隔 500ms 探一次。 */
export async function waitForPort(port, { timeoutMs = 90000, host = '127.0.0.1' } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await portOpen(port, host)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * 选一个不会弹控制台的 Python 解释器。
 *
 * pythonw.exe 是 Windows 的 GUI 子系统版本，不创建控制台窗口；
 * python.exe 是控制台程序，spawn 时会闪一下黑框。
 *
 * 只认外部传入的路径（配置里的 pythonPath），没有硬编码回退：
 * · 传目录（如 venv/Scripts）→ 优先里面的 pythonw.exe
 * · 传 python.exe → 自动优先同目录 pythonw.exe
 * 找不到返回 ''，由调用方给出可读错误。
 */
export function pickPython(preferred) {
  const cands = []
  const push = (p) => { if (p && !cands.includes(p)) cands.push(p) }
  if (preferred) {
    try {
      if (fs.statSync(preferred).isDirectory()) {
        push(path.join(preferred, 'pythonw.exe'))
        push(path.join(preferred, 'python.exe'))
      } else {
        if (/python\.exe$/i.test(preferred)) push(preferred.replace(/python\.exe$/i, 'pythonw.exe'))
        push(preferred)
      }
    } catch { push(preferred) }
  }
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c } catch { /* 忽略 */ }
  }
  return ''
}

/**
 * 启动一个长驻服务进程。
 *
 * @param {object} o
 * @param {string} o.python    解释器路径（优先 pythonw）
 * @param {string[]} o.args    python 参数
 * @param {string} o.cwd       工作目录
 * @param {string} o.logFile   标准输出/错误重定向到的文件
 * @returns {{ok:boolean, pid?:number, error?:string}}
 */
const MAX_LOG_BYTES = 512 * 1024

/** 服务日志轮转：超过 512KB 就把当前日志改名 .old，新日志从头写。 */
function rotateLog(logFile) {
  try {
    if (!logFile) return
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      const oldFile = logFile + '.old'
      try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile) } catch { /* 忽略 */ }
      try { fs.renameSync(logFile, oldFile) } catch { /* 忽略 */ }
    }
  } catch { /* 轮转失败不影响启动 */ }
}

export function spawnService({ python, args, cwd, logFile }) {
  if (!python) return { ok: false, error: '找不到 Python 解释器' }
  try {
    if (!fs.existsSync(python)) return { ok: false, error: '解释器不存在：' + python }
    if (cwd && !fs.existsSync(cwd)) return { ok: false, error: '工作目录不存在：' + cwd }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) }
  }

  rotateLog(logFile)

  let out = null
  try {
    out = fs.openSync(logFile, 'a')
  } catch {
    out = null
  }

  try {
    const child = spawn(python, args, {
      cwd,
      // 脱离宿主：DSH 退出后服务继续活着，下次唤醒才能复用
      detached: true,
      // 不创建控制台窗口（对 pythonw 是双保险，对 python.exe 也尽量减少闪现）
      windowsHide: true,
      stdio: out === null ? 'ignore' : ['ignore', out, out],
      env: {
        ...process.env,
        // 强制 Python 用 UTF-8 输出，避免日志出现 GBK 乱码
        PYTHONIOENCODING: 'utf-8',
      },
    })
    child.unref()
    return { ok: true, pid: child.pid, child }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    if (out !== null) {
      try { fs.closeSync(out) } catch { /* 忽略 */ }
    }
  }
}

/**
 * 服务启动管理器：每个 key 一把锁，防止并发重复拉起。
 */
export function createLauncher(log) {
  const inflight = new Map()

  /**
   * 确保服务在 port 上就绪。已在跑则直接返回。
   *
   * @param {string} key        服务标识（用于锁）
   * @param {number} port       监听端口
   * @param {Function} starter  返回 {ok, pid?, error?} 的启动函数，仅在需要时调用
   * @param {number} timeoutMs  等就绪超时
   */
  async function ensure(key, port, starter, timeoutMs = 90000) {
    if (await portOpen(port)) return { ok: true, already: true }

    // 同一服务同时只允许一个启动流程
    if (inflight.has(key)) return { ok: false, error: '正在启动中，请稍候' }
    inflight.set(key, true)
    try {
      const started = starter()
      if (!started?.ok) return { ok: false, error: started?.error || '启动失败' }
      log?.('info', '已拉起 ' + key + ' 服务，PID=' + (started.pid ?? '?'))

      const ready = await waitForPort(port, { timeoutMs })
      if (!ready) return { ok: false, error: key + ' 服务等就绪超时（' + Math.round(timeoutMs / 1000) + 's）' }
      return { ok: true, launched: true, pid: started.pid }
    } finally {
      inflight.delete(key)
    }
  }

  return { ensure }
}
