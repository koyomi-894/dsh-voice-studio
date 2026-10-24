/**
 * dsh-voice-studio-plugin —— 语音合成 + 歌声转换插件。
 *
 * 设计原则（逐条对应踩过的坑，详见 PITFALLS.md）：
 *   · 服务进程用 pythonw 启动，不经 cmd，绝不弹控制台窗口。
 *   · 外部服务接口先探测再用，不假设存在 /warm。
 *   · 配置落盘，重启不丢。
 *   · 显存优先读服务自报值，差值法只作兜底。
 *   · 破坏性操作有多道校验。
 */

import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  loadUserConfig, normalizeConfig, resolveEffective,
  saveUserConfig, scanProfiles,
} from './src/config.js'
import { cleanForSpeech, splitSegments, truncateForTurn } from './src/text.js'
import { trimWavTail, wavDurationSec } from './src/audio.js'
import {
  probeTts, queryTtsVram, setGptWeights, setSovitsWeights, synthesize, warmTts,
} from './src/tts/client.js'
import * as sapi from './src/tts/sapi.js'
import { probeSvc, querySvcVram, listSongs, singSong, unloadSvc, warmSvc } from './src/svc/client.js'
import { createLauncher, pickPython, portOpen, spawnService } from './src/services/proc.js'
import { formatMiB, readGpuMemory, resolveUsage, setBaseline } from './src/services/vram.js'
import {
  cancelDownload, clearProgress, downloadModel, getProgress, readMarket, uninstallModel,
} from './src/market/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTE = '/voice-studio'
const PROFILES_ROOT = path.join(HERE, 'profiles')
const MARKET_DIR = path.join(HERE, 'market')
const CONFIG_FILE = path.join(HERE, 'user-config.json')
const LOG_FILE = path.join(HERE, 'debug.log')
const CLIENT_ROUTE = ROUTE + '/main.js'

export const name = 'dsh-voice-studio-plugin'

function makeLog(ctx) {
  return (level, message) => {
    try {
      const fn = level === 'warn' ? ctx?.logger?.warn : ctx?.logger?.info
      if (typeof fn === 'function') fn.call(ctx.logger, 'voice-studio: ' + message)
    } catch { /* 忽略 */ }
    try {
      try {
        if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.writeFileSync(LOG_FILE, '')
      } catch { /* 文件不存在 */ }
      fs.appendFileSync(
        LOG_FILE,
        new Date().toISOString() + ' [' + level + '] ' + message + String.fromCharCode(10),
      )
    } catch { /* 忽略 */ }
  }
}

const CACHE_DIR = path.join(HERE, 'cache')
const CACHE_MAX_BYTES = 100 * 1024 * 1024

/** 语音缓存：sha1(角色+文本+采样参数) → 磁盘 wav。命中直接返回，重读秒回。 */
function cacheKey(profileId, text, params) {
  const h = createHash('sha1')
  h.update(String(profileId || '') + '\n' + String(text || '') + '\n' + JSON.stringify(params || {}))
  return h.digest('hex')
}

function cacheGet(key) {
  try {
    const f = path.join(CACHE_DIR, key + '.wav')
    if (!fs.existsSync(f)) return null
    return fs.readFileSync(f)
  } catch { return null }
}

function cachePut(key, buffer) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    const f = path.join(CACHE_DIR, key + '.wav')
    fs.writeFileSync(f, buffer)
    // 缓存超过 100MB 时按修改时间删最旧的，防止无限增长
    const files = []
    let total = 0
    for (const name of fs.readdirSync(CACHE_DIR)) {
      const p2 = path.join(CACHE_DIR, name)
      try {
        const st = fs.statSync(p2)
        if (st.isFile()) { files.push({ p: p2, mtime: st.mtimeMs, size: st.size }); total += st.size }
      } catch { /* 忽略 */ }
    }
    if (total > CACHE_MAX_BYTES) {
      files.sort((a, b) => a.mtime - b.mtime)
      for (const it of files) {
        if (total <= CACHE_MAX_BYTES) break
        try { fs.unlinkSync(it.p); total -= it.size } catch { /* 忽略 */ }
      }
    }
    return true
  } catch { return false }
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { req.destroy(); resolve(null); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

function sendJson(res, code, obj) {
  try {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(obj))
  } catch {
    try { res.writeHead(500); res.end() } catch { /* 忽略 */ }
  }
}

function sendFile(res, file, type) {
  try {
    const buf = fs.readFileSync(file)
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(buf)
    return true
  } catch {
    try { res.writeHead(404); res.end() } catch { /* 忽略 */ }
    return false
  }
}

function mimeOf(ext) {
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  }
  return map[String(ext || '').toLowerCase()] || 'application/octet-stream'
}

// ── 插件主体 ──────────────────────────────────────────────────────────

export function apply(ctx, rawConfig) {
  const log = makeLog(ctx)

  let cfg = normalizeConfig({ ...(rawConfig || {}), ...loadUserConfig(CONFIG_FILE) })

  let profileCache = null
  let profileCacheAt = 0

  function profiles() {
    return scanProfiles(PROFILES_ROOT)
  }

  function currentProfile() {
    const now = Date.now()
    if (profileCache !== null && now - profileCacheAt < 3000) return profileCache
    const { profiles: list } = profiles()
    let p = list.find((x) => x.id === cfg.profile)
    if (!p && list.length) {
      p = list[0]
      if (cfg.profile !== p.id) {
        cfg = normalizeConfig({ ...cfg, profile: p.id })
        saveUserConfig(CONFIG_FILE, cfg)
      }
    }
    profileCache = p || null
    profileCacheAt = now
    return profileCache
  }

  function effective() {
    return resolveEffective(cfg, currentProfile())
  }

  const launcher = createLauncher(log)

  const queue = []
  let pumping = false
  let lastTurnText = ''
  // 「听上一句」= 重读模型最近一次实际朗读的内容（不再是最近一条 AI 回复）
  let lastSpokenText = ''
  let ttsWarm = false
  let svcWarm = false
  let svcSinging = false
  const svcQueue = []
  let svcPumping = false
  let pendingAudio = null
  // 最近成功推给 GPT-SoVITS 的微调权重（换角色/服务重启后自动重推）
  let ttsWeights = { gpt: '', sovits: '' }

  // 空闲冷却：记录每个服务最后一次使用时间
  let ttsLastUsedAt = 0
  let svcLastUsedAt = 0
  let idleTimer = null
  let ttsPid = null
  let svcPid = null
  let ttsChild = null

  // 服务部署路径全部来自配置（pythonPath/ttsScript/ttsCwd/svcScript/svcCwd）。
  // 留空 = 不自动拉起，只探测已在跑的服务；这是给别人部署时的默认形态。
  async function ensureTts(base) {
    let port = 9880
    try { port = Number(new URL(base).port) || 9880 } catch { /* 默认 */ }
    const r = await launcher.ensure('tts', port, () => {
      if (!cfg.ttsScript) return { ok: false, error: '未配置 TTS 启动脚本（ttsScript）：请在插件配置里填写，或自行启动 GPT-SoVITS 服务' }
      if (!cfg.pythonPath) return { ok: false, error: '未配置 Python 解释器（pythonPath）：请在插件配置里填写（建议 venv 的 pythonw.exe）' }
      return spawnService({
        python: pickPython(cfg.pythonPath),
        args: ['-u', cfg.ttsScript, '-a', '127.0.0.1', '-p', String(port)],
        cwd: cfg.ttsCwd || path.dirname(cfg.ttsScript),
        logFile: path.join(HERE, 'tts-server.log'),
      })
    })
    if (r.ok && r.pid) {
      ttsPid = r.pid
      if (r.child) ttsChild = r.child
    }
    // 新进程 = 服务端权重回到它自己的默认：清掉插件侧记录，下次合成前重新推送
    if (r.launched) ttsWeights = { gpt: '', sovits: '' }
    return r
  }

  async function ensureSvc(base) {
    let port = 9890
    try { port = Number(new URL(base).port) || 9890 } catch { /* 默认 */ }
    const r = await launcher.ensure('svc', port, () => {
      if (!cfg.svcScript) return { ok: false, error: '未配置唱歌服务启动脚本（svcScript）：请在插件配置里填写，或自行启动 Seed-VC 服务' }
      if (!cfg.pythonPath) return { ok: false, error: '未配置 Python 解释器（pythonPath）：请在插件配置里填写（建议 venv 的 pythonw.exe）' }
      return spawnService({
        python: pickPython(cfg.pythonPath),
        args: ['-u', cfg.svcScript, '--port', String(port)],
        cwd: cfg.svcCwd || path.dirname(cfg.svcScript),
        logFile: path.join(HERE, 'svc-server.log'),
      })
    })
    if (r.ok && r.pid) svcPid = r.pid
    return r
  }

  /**
   * 把当前角色的微调权重推给 GPT-SoVITS（profile 配了 modelFiles 才生效）。
   * 服务已加载同一份权重时跳过，不重复花几十秒重载。
   * @returns {Promise<string>} 出错时返回错误信息，成功返回空串。
   */
  async function ensureWeights(profile, baseUrl) {
    try {
      const mf = profile?.modelFiles || {}
      const gpt = String(mf.gpt || '')
      const sovits = String(mf.sovits || '')
      if (gpt && ttsWeights.gpt !== gpt) {
        const r = await setGptWeights(baseUrl, gpt)
        if (!r.ok) return '加载 GPT 权重失败：' + r.error + '（' + gpt + '）'
        ttsWeights.gpt = gpt
        log('info', '已加载 GPT 权重: ' + gpt)
      }
      if (sovits && ttsWeights.sovits !== sovits) {
        const r = await setSovitsWeights(baseUrl, sovits)
        if (!r.ok) return '加载 SoVITS 权重失败：' + r.error + '（' + sovits + '）'
        ttsWeights.sovits = sovits
        log('info', '已加载 SoVITS 权重: ' + sovits)
      }
      return ''
    } catch (e) {
      return '加载权重异常: ' + String((e && e.message) || e)
    }
  }

  /** 预热（含权重推送）：所有预热入口统一走这里。 */
  async function warmTtsNow(eff) {
    const werr = await ensureWeights(eff.profile, eff.ttsUrl)
    if (werr) return { ok: false, error: werr }
    return warmTts(eff.profile, eff.ttsUrl)
  }

  /**
   * 时长合理性检查：GPT-SoVITS 的时长预测偶发抽风，
   * 16 个字能合成出 40 多秒的慢动作语音。按字数估预期时长
   * （保守按 2 字/秒 × 语速），超 3 倍视为抽风。
   */
  function durationSuspicious(buffer, text) {
    const sec = wavDurationSec(buffer)
    if (sec === null) return false
    const expect = Math.max(1, String(text || '').length) / (2 * (cfg.speed || 1))
    return sec > Math.max(expect * 3, expect + 8)
  }

  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (queue.length) {
        const item = queue[0]
        if (item.error) { queue.shift(); continue }
        if (item.buffer) break

        const eff = effective()
        let r
        if (eff.profile && eff.profile.tts.engine === 'sapi') {
          r = await sapi.synthesize({
            text: item.text,
            voice: eff.profile.tts.sapiVoice || '',
            rate: Math.round((cfg.speed - 1) * 10),
            volume: Math.round(cfg.volume * 100),
          })
        } else {
          if (!eff.ttsUrl) { item.error = '未配置 TTS 地址'; queue.shift(); continue }
          let port = 80
          try { port = Number(new URL(eff.ttsUrl).port) || 80 } catch { /* 默认 */ }
          if (!(await portOpen(port))) {
            const lr = await ensureTts(eff.ttsUrl)
            if (!lr.ok) { item.error = lr.error; queue.shift(); continue }
          }
          // 换角色/服务重启后，先把微调权重推给服务（profile 配了 modelFiles 才生效）
          const werr = await ensureWeights(eff.profile, eff.ttsUrl)
          if (werr) { item.error = werr; if (queue[0] === item) queue.shift(); continue }
          const params = {
            temperature: cfg.temperature,
            topK: cfg.topK,
            topP: cfg.topP,
            repetitionPenalty: cfg.repetitionPenalty,
            fragmentInterval: cfg.fragmentInterval,
            speed: cfg.speed,
          }
          const ck = cacheKey(eff.profile?.id || '', item.text, params)
          const cached = cacheGet(ck)
          // 缓存里躺着时长抽风的坏文件（旧版本合成、没经过校验）→ 当 miss 重合成并覆盖
          if (cached && !durationSuspicious(cached, item.text)) {
            // 查缓存前的 await 期间队列可能被 /clear（停止按钮）清空：项已不在队首就丢弃
            if (queue[0] !== item) break
            log('info', '语音缓存命中: ' + ck.slice(0, 12))
            item.buffer = trimWavTail(cached)
            ttsLastUsedAt = Date.now()
            if (!ttsWarm) ttsWarm = true
            if (item.head) lastSpokenText = item.full
            pendingAudio = item
            break
          }
          r = await synthesize(eff.profile, eff.ttsUrl, item.text, params)

          // 时长抽风防御：明显超过按字数估算的时长（慢动抽语音）就重试一次，
          // 采样是随机的，重试大概率正常；两次都异常才判失败
          if (r.ok && durationSuspicious(r.buffer, item.text)) {
            const d1 = wavDurationSec(r.buffer)
            log('warn', '合成时长异常 ' + (d1 ? d1.toFixed(1) : '?') + 's（' + item.text.length + ' 字），重试一次')
            const r2 = await synthesize(eff.profile, eff.ttsUrl, item.text, params)
            if (r2.ok) {
              const d2 = wavDurationSec(r2.buffer)
              if (d2 === null || d1 === null || d2 < d1) r = r2
              if (durationSuspicious(r.buffer, item.text)) {
                const expect = Math.max(1, item.text.length) / (2 * (cfg.speed || 1))
                item.error = '合成时长异常（' + ((wavDurationSec(r.buffer) || 0)).toFixed(1)
                  + 's，预计约 ' + expect.toFixed(1) + 's），已重试仍异常，跳过这段'
                if (queue[0] === item) queue.shift()
                continue
              }
              log('info', '时长重试成功: ' + (d2 !== null ? d2.toFixed(1) : '?') + 's')
            }
          }
        }

        if (!r.ok) {
          item.error = r.error || '合成失败'
          // 队列可能已被 /clear 清空并塞入新内容：只移除自己的项，不能误删别人的
          if (queue[0] === item) queue.shift()
          continue
        }
        item.buffer = trimWavTail(r.buffer)
        try {
          const ck2 = cacheKey(eff.profile?.id || '', item.text, {
            temperature: cfg.temperature,
            topK: cfg.topK,
            topP: cfg.topP,
            repetitionPenalty: cfg.repetitionPenalty,
            fragmentInterval: cfg.fragmentInterval,
            speed: cfg.speed,
          })
          // 存裁剪后的版本，重读不再吃同一份拖尾
          cachePut(ck2, item.buffer)
        } catch { /* 缓存写失败不影响播放 */ }
        ttsLastUsedAt = Date.now()
        // 合成成功 = 模型已经加载进显存，预热状态同步为开
        if (!ttsWarm) {
          ttsWarm = true
          log('info', 'TTS 合成成功，预热状态自动同步为开')
        }
        // 合成期间被 /clear（停止按钮）清空：丢弃这条音频，避免「停止后又响一声」
        if (queue[0] !== item) break
        // 首段成功晋升整轮原文，供「听上一句」重读
        if (item.head) lastSpokenText = item.full
        pendingAudio = item
        break
      }
    } finally {
      pumping = false
    }
  }

  function enqueue(text, source) {
    const cleaned = cleanForSpeech(text)
    if (!cleaned) return 0
    const trimmed = truncateForTurn(cleaned, cfg.maxCharsPerTurn)
    const segs = splitSegments(trimmed, cfg.segmentChars)
    // 每段带上整轮原文：首段合成成功后晋升为 lastSpokenText，
    // 「听上一句」重读的是模型最近一次读的完整内容，而不是最近一条 AI 回复
    for (let i = 0; i < segs.length; i++) {
      queue.push({ text: segs[i], buffer: null, error: '', source, full: trimmed, head: i === 0 })
    }
    void pump()
    return segs.length
  }

  try {
    ctx.on('session/event', (evt) => {
      try {
        const role = evt?.role || evt?.message?.role
        if (role !== 'assistant') return
        const text = String(evt?.text ?? evt?.message?.content ?? '')
        if (!text) return
        // 关键：无论自动朗读是否开启，都先记录最后一轮 AI 回复，
        // 否则「听上一句」在 autoSpeak 关闭时永远拿不到可读文本。
        lastTurnText = text
        if (!cfg.enabled || !cfg.autoSpeak) return
        enqueue(text, 'auto')
      } catch { /* 忽略 */ }
    })
  } catch { /* 宿主不支持 */ }

  // ── HTTP 路由 ───────────────────────────────────────────────────────

  ctx.inject(['webServer'], (scoped) => {
    const guard = (req, res, method) => {
      if (method && req.method !== method) {
        sendJson(res, 405, { ok: false, error: '只接受 ' + method })
        return false
      }
      return true
    }

    const routeFile = (urlPath, filePath) => {
      scoped.webServer.register({
        kind: 'exact',
        path: urlPath,
        handler: (req, res) => { sendFile(res, filePath, mimeOf(path.extname(filePath))) },
      })
    }

    const CLIENT_DIR = path.join(HERE, 'client')
    const clientFiles = [
      ['/main.js', path.join(CLIENT_DIR, 'main.js')],
      ['/panel.css', path.join(CLIENT_DIR, 'panel.css')],
      ['/src/api.js', path.join(CLIENT_DIR, 'src', 'api.js')],
      ['/src/dom.js', path.join(CLIENT_DIR, 'src', 'dom.js')],
      ['/src/store.js', path.join(CLIENT_DIR, 'src', 'store.js')],
      ['/src/controls.js', path.join(CLIENT_DIR, 'src', 'controls.js')],
      ['/src/player.js', path.join(CLIENT_DIR, 'src', 'player.js')],
      ['/src/dropdown.js', path.join(CLIENT_DIR, 'src', 'dropdown.js')],
      ['/src/pages/speak.js', path.join(CLIENT_DIR, 'src', 'pages', 'speak.js')],
      ['/src/pages/sing.js', path.join(CLIENT_DIR, 'src', 'pages', 'sing.js')],
      ['/src/pages/market.js', path.join(CLIENT_DIR, 'src', 'pages', 'market.js')],
      ['/src/pages/look.js', path.join(CLIENT_DIR, 'src', 'pages', 'look.js')],
    ]
    for (const [p, f] of clientFiles) routeFile(ROUTE + p, f)

    // ── 状态 ──────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/status',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const eff = effective()
          let ttsUp = false
          let svcUp = false
          try {
            if (eff.ttsUrl) ttsUp = await portOpen(Number(new URL(eff.ttsUrl).port) || 80)
          } catch { /* 忽略 */ }
          try {
            if (eff.svcUrl) svcUp = await portOpen(Number(new URL(eff.svcUrl).port) || 80)
          } catch { /* 忽略 */ }

          const keys = []
          if (ttsUp) keys.push('tts')
          if (svcUp) keys.push('svc')

          const real = {}
          if (ttsUp) real.tts = await queryTtsVram(eff.ttsUrl)
          if (svcUp) real.svc = await querySvcVram(eff.svcUrl)

          const usage = await resolveUsage(keys, real)

          let gpu = null
          if (usage) {
            gpu = {
              used: usage.used,
              total: usage.total,
              usedText: formatMiB(usage.used),
              totalText: formatMiB(usage.total),
              tts: usage.parts.tts ?? 0,
              svc: usage.parts.svc ?? 0,
              other: usage.other,
              ttsText: formatMiB(usage.parts.tts ?? 0),
              svcText: formatMiB(usage.parts.svc ?? 0),
              otherText: formatMiB(usage.other),
              exact: usage.exact,
            }
          }

          sendJson(res, 200, {
            ok: true,
            enabled: cfg.enabled,
            autoSpeak: cfg.autoSpeak,
            widgetVisible: cfg.widgetVisible,
            wakeEnabled: cfg.wakeEnabled,
            volume: cfg.volume,
            speed: cfg.speed,
            synthesizing: pumping,
            queueLen: queue.length,
            lastError: queue[0]?.error ?? '',
            hasPendingAudio: Boolean(pendingAudio),
            profile: eff.profile
              ? {
                id: eff.profile.id,
                name: eff.profile.name,
                description: eff.profile.description,
                engine: eff.profile.tts.engine,
              }
              : null,
            tts: { url: eff.ttsUrl, up: ttsUp, warm: ttsWarm },
            svc: { url: eff.svcUrl, up: svcUp, warm: svcWarm, singing: svcSinging, queueLen: svcQueue.length },
            gpu,
          })
        } catch (error) {
          log('warn', '/status 异常: ' + (error?.message ?? error))
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 配置 ──────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const { profiles: list, errors } = profiles()
            sendJson(res, 200, {
              ok: true,
              config: cfg,
              effective: effective(),
              profiles: list.map((p) => ({
                id: p.id, name: p.name, description: p.description, engine: p.tts.engine,
              })),
              profileErrors: errors,
            })
            return
          }
          if (!guard(req, res, 'POST')) return
          const body = await readBody(req)
          if (!body || typeof body !== 'object') {
            sendJson(res, 400, { ok: false, error: '请求体不是对象' })
            return
          }
          cfg = normalizeConfig({ ...cfg, ...body })
          saveUserConfig(CONFIG_FILE, cfg)
          profileCache = null
          // QQ 桥接唤醒开关：打开就监听，关闭就停掉端口
          if (cfg.wakePort > 0 && cfg.wakeEnabled !== false) {
            if (!wakeServer) startWakeServer()
          } else if (wakeServer) {
            try { wakeServer.close(); wakeServer = null } catch { /* 忽略 */ }
            log('info', '唤醒端口已关闭')
          }
          sendJson(res, 200, { ok: true, config: cfg })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 资源图 ────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/asset',
      handler: (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          const name = u.searchParams.get('name') || ''
          // 冒泡素材走专用目录（dsh-whale-widget 的 petpet 动图）
          if (name.startsWith('bubble-')) {
            const bf = path.join(HERE, 'assets', 'bubbles', name + '.webp')
            if (fs.existsSync(bf)) {
              sendFile(res, bf, 'image/webp')
            } else {
              res.writeHead(404); res.end()
            }
            return
          }
          const which = name === 'background' ? 'background' : 'icon'
          const p = currentProfile()
          let file = p ? (which === 'background' ? p.background : p.icon) : ''

          if (!file || !fs.existsSync(file)) {
            // 背景优先 WebP（体积小画质好）；立绘只带 whale.png 一张默认图。
            // 其他角色图不内置，用户要自定义就用「修改立绘」传自己的图。
            const builtin = which === 'background'
              ? ['background.webp', 'background.png', 'background.jpg']
              : ['whale.png']
            file = ''
            for (const n of builtin) {
              const cand = path.join(HERE, 'assets', n)
              if (fs.existsSync(cand)) { file = cand; break }
            }
          }
          if (!file) { res.writeHead(404); res.end(); return }
          sendFile(res, file, mimeOf(path.extname(file)))
        } catch {
          try { res.writeHead(500); res.end() } catch { /* 忽略 */ }
        }
      },
    })

    // ── 立绘动图素材（16 个：14 待机 + 2 说话）──────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/mood',
      handler: (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          const name = String(u.searchParams.get('name') || '').replace(/[^\w-]/g, '')
          if (!name) { res.writeHead(400); res.end(); return }
          const file = path.join(HERE, 'assets', 'moods', name + '.webp')
          if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return }
          // 动图必须支持 Range，否则浏览器可能只播第一帧
          const size = fs.statSync(file).size
          const range = req.headers.range
          if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range)
            if (m) {
              let start = m[1] ? parseInt(m[1], 10) : 0
              let end = m[2] ? parseInt(m[2], 10) : size - 1
              if (start > end || start >= size) {
                res.writeHead(416, { 'Content-Range': 'bytes */' + size }); res.end(); return
              }
              end = Math.min(end, size - 1)
              res.writeHead(206, {
                'Content-Type': 'image/webp',
                'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Cache-Control': 'public, max-age=86400',
              })
              fs.createReadStream(file, { start, end }).pipe(res)
              return
            }
          }
          res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Length': size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400',
          })
          fs.createReadStream(file).pipe(res)
        } catch {
          try { res.writeHead(500); res.end() } catch { /* 忽略 */ }
        }
      },
    })

    // ── 立绘素材清单 ──────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/moods',
      handler: (req, res) => {
        try {
          const file = path.join(HERE, 'assets', 'moods', 'manifest.json')
          const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"moods":[]}'
          sendJson(res, 200, JSON.parse(raw))
        } catch {
          try { sendJson(res, 500, { moods: [] }) } catch { /* 忽略 */ }
        }
      },
    })

    // ── 内置图标 ──────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/icon',
      handler: (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          const n = String(u.searchParams.get('name') || '').replace(/[^\w-]/g, '')
          if (!n) { res.writeHead(400); res.end(); return }
          sendFile(res, path.join(HERE, 'assets', 'icons', n + '.png'), 'image/png')
        } catch {
          try { res.writeHead(500); res.end() } catch { /* 忽略 */ }
        }
      },
    })

    // ── 上传 ──────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/upload',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const eff = effective()
          if (!eff.profile) { sendJson(res, 400, { ok: false, error: '没有可用角色' }); return }
          const body = await readBody(req)
          const which = body?.which === 'icon' ? 'icon' : 'background'
          const dataUrl = String(body?.data ?? '')
          const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
          if (!m) { sendJson(res, 400, { ok: false, error: '只接受 base64 图片' }); return }

          const ext = m[2] === 'jpeg' ? 'jpg' : m[2]
          const buf = Buffer.from(m[3], 'base64')
          if (!buf.length) { sendJson(res, 400, { ok: false, error: '图片为空' }); return }
          if (buf.length > 8 * 1024 * 1024) {
            sendJson(res, 400, { ok: false, error: '图片超过 8MB' })
            return
          }

          const dir = path.join(eff.profile.dir, 'assets')
          fs.mkdirSync(dir, { recursive: true })
          for (const e of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
            const old = path.join(dir, which + '.' + e)
            try { if (fs.existsSync(old)) fs.unlinkSync(old) } catch { /* 忽略 */ }
          }
          const name = which + '.' + ext
          fs.writeFileSync(path.join(dir, name), buf)
          profileCache = null
          invalidateProfilesSize()
          log('info', '已保存 ' + which + ' → ' + name + ' (' + buf.length + ' 字节)')
          sendJson(res, 200, { ok: true, file: name, bytes: buf.length })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: '写入失败：' + (error?.message ?? error) })
        }
      },
    })

    // ── 说话 ──────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/speak',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          // 空 text = 「听上一句」：重读模型最近一次实际朗读的内容
          const text = typeof body?.text === 'string' && body.text.trim() ? body.text : lastSpokenText
          if (!text) {
            sendJson(res, 400, {
              ok: false,
              error: '还没有朗读过的内容：先点小喇叭、「说一句试试」或开启自动读回复',
            })
            return
          }

          // 「说句试试」和「听上一句」都走这里：进入队列前如果模型没预热，
          // 先按 /tts-warm 的方式做一次短试合成把模型拉起来，和「说句试试」一致。
          const eff0 = effective()
          if (eff0.profile && eff0.profile.tts.engine !== 'sapi' && !ttsWarm && eff0.ttsUrl) {
            try {
              let port = 80
              try { port = Number(new URL(eff0.ttsUrl).port) || 80 } catch { /* 默认 */ }
              if (!(await portOpen(port))) {
                const lr = await ensureTts(eff0.ttsUrl)
                if (lr.ok && lr.launched) {
                  const before = await readGpuMemory()
                  if (before) setBaseline('tts', before.used)
                }
              }
              const w = await warmTtsNow(eff0)
              if (w.ok) {
                ttsWarm = true
                ttsLastUsedAt = Date.now()
                log('info', '朗读前预热完成（模型已加载）')
              }
            } catch { /* 预热失败不阻塞，正式合成时还会兜底拉起 */ }
          }

          const n = enqueue(text, 'manual')
          sendJson(res, 200, { ok: true, segments: n })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 取音频 ────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/poll',
      handler: (req, res) => {
        try {
          if (pendingAudio && pendingAudio.buffer) {
            const b = pendingAudio.buffer
            pendingAudio = null
            queue.shift()
            void pump()
            sendJson(res, 200, { ok: true, audio: b.toString('base64'), remaining: queue.length })
            return
          }
          sendJson(res, 200, {
            ok: true,
            audio: '',
            remaining: queue.length,
            synthesizing: pumping,
            error: queue[0]?.error || '',
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/clear',
      handler: (req, res) => {
        try {
          queue.length = 0
          pendingAudio = null
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── TTS 预载 ──────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/tts-warm',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const eff = effective()
          if (!eff.ttsUrl) { sendJson(res, 400, { ok: false, error: '未配置 TTS 地址' }); return }

          if (ttsWarm) {
            ttsWarm = false
            ttsLastUsedAt = 0
            // api_v2 没有 /unload，关闭预热 = 杀掉 TTS 进程才能真正释放显存
            try {
              const port = Number(new URL(eff.ttsUrl).port) || 9880
              killByPort(port)
              ttsPid = null
              ttsChild = null
              ttsWeights = { gpt: '', sovits: '' }
              log('info', '关闭预热：已终止 TTS 进程释放显存（端口 ' + port + '）')
            } catch { /* 杀不掉也不能卡住响应 */ }
            sendJson(res, 200, {
              ok: true, warm: false,
              note: '已关闭预热并终止说话服务进程',
            })
            return
          }

          const lr = await ensureTts(eff.ttsUrl)
          if (!lr.ok) { sendJson(res, 500, { ok: false, error: lr.error }); return }

          if (lr.launched) {
            const before = await readGpuMemory()
            if (before) setBaseline('tts', before.used)
          }

          const w = await warmTtsNow(eff)
          ttsWarm = w.ok
          if (w.ok) ttsLastUsedAt = Date.now()
          sendJson(res, 200, {
            ok: w.ok,
            warm: ttsWarm,
            launched: Boolean(lr.launched),
            note: w.ok ? (lr.launched ? '已拉起并预热' : '预热完成') : w.error,
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 歌曲库 ────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/songs',
      handler: async (req, res) => {
        try {
          const eff = effective()
          if (!eff.svcUrl) { sendJson(res, 200, { ok: true, songs: [] }); return }
          const r = await listSongs(eff.svcUrl)
          sendJson(res, 200, { ok: r.ok, songs: r.songs, error: r.error || '' })
        } catch (error) {
          sendJson(res, 500, { ok: false, songs: [], error: String(error?.message ?? error) })
        }
      },
    })

    // ── SVC 预载 ──────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/svc-toggle',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const eff = effective()
          if (!eff.svcUrl) {
            sendJson(res, 400, { ok: false, error: '该角色未配置唱歌服务' })
            return
          }

          const health = await probeSvc(eff.svcUrl)
          if (health.ok && health.ready) {
            const r = await unloadSvc(eff.svcUrl)
            svcWarm = false
            sendJson(res, 200, { ok: r.ok, action: 'unloaded', warm: false })
            return
          }

          const lr = await ensureSvc(eff.svcUrl)
          if (!lr.ok) { sendJson(res, 500, { ok: false, error: lr.error }); return }

          if (lr.launched) {
            const before = await readGpuMemory()
            if (before) setBaseline('svc', before.used)
          }

          const w = await warmSvc(eff.svcUrl)
          svcWarm = w.ok
          if (w.ok) svcLastUsedAt = Date.now()
          sendJson(res, 200, {
            ok: w.ok,
            action: 'warmed',
            warm: svcWarm,
            launched: Boolean(lr.launched),
            error: w.ok ? '' : w.error,
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 唱歌队列泵：一次一首，唱完自动下一首 ─────────────────────────
    async function pumpSvcQueue() {
      if (svcPumping || svcSinging) return
      svcPumping = true
      try {
        while (svcQueue.length) {
          const job = svcQueue[0]
          const eff = effective()
          if (!eff.svcUrl) { svcQueue.shift(); continue }
          const lr = await ensureSvc(eff.svcUrl)
          if (!lr.ok) { svcQueue.shift(); log('warn', '唱歌队列：服务不可用 ' + lr.error); continue }

          svcSinging = true
          try {
            const r = await singSong(eff.svcUrl, job)
            if (!r.ok) {
              log('warn', '唱歌队列：转换失败 ' + r.error)
            } else {
              svcWarm = true
              svcLastUsedAt = Date.now()
            }
          } finally {
            svcSinging = false
          }
          svcQueue.shift()
        }
      } finally {
        svcPumping = false
      }
    }

    // ── 唱歌 ──────────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/sing',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const eff = effective()
          if (!eff.svcUrl) {
            sendJson(res, 400, { ok: false, error: '该角色未配置唱歌服务' })
            return
          }
          if (svcSinging) {
            sendJson(res, 409, { ok: false, error: '正在转换中，请稍候' })
            return
          }

          const body = await readBody(req)
          const source = String(body?.source || '')
          if (!source) { sendJson(res, 400, { ok: false, error: '没有选源歌曲' }); return }

          const lr = await ensureSvc(eff.svcUrl)
          if (!lr.ok) { sendJson(res, 500, { ok: false, error: lr.error }); return }

          // 唱歌队列：一次一首，后续请求排队等待，不再报 409
          const job = {
            source,
            steps: Number(body?.steps) || 30,
            backing: body?.backing || 'keep',
            vocalGain: Number(body?.vocalGain) || 1,
            backingGain: Number(body?.backingGain) || 0.9,
          }
          svcQueue.push(job)
          void pumpSvcQueue()
          sendJson(res, 200, {
            ok: true,
            queued: true,
            position: svcQueue.length,
            note: svcQueue.length > 1 ? '已加入唱歌队列，前面还有 ' + (svcQueue.length - 1) + ' 首' : '开始转换',
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 模型市场 ──────────────────────────────────────────────────────

    /** 递归算目录总占用（字节）。 */
    function dirSize(dir) {
      let total = 0
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name)
          if (e.isDirectory()) total += dirSize(p)
          else {
            try { total += fs.statSync(p).size } catch { /* 忽略 */ }
          }
        }
      } catch { /* 目录不存在 */ }
      return total
    }

    // profiles/ 目录总占用缓存：打开市场页不再每次同步递归扫全目录。
    // 下载/卸载/上传资源后清掉，下次打开重新计算。
    let profilesSizeCache = null
    function cachedProfilesSize() {
      if (profilesSizeCache === null) profilesSizeCache = dirSize(PROFILES_ROOT)
      return profilesSizeCache
    }
    function invalidateProfilesSize() {
      profilesSizeCache = null
    }

    function formatBytes(n) {
      if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
      if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
      return n + ' B'
    }

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/market',
      handler: (req, res) => {
        try {
          const r = readMarket(MARKET_DIR)
          if (!r.ok) { sendJson(res, 500, r); return }
          const { profiles: installed } = profiles()
          const set = new Set(installed.map((p) => p.id))
          sendJson(res, 200, {
            ok: true,
            notice: r.notice,
            updatedAt: r.updatedAt,
            // 本地模型目录总占用（实时计算）
            profilesSize: formatBytes(cachedProfilesSize()),
            profilesSizeBytes: cachedProfilesSize(),
            models: r.models.map((m) => ({
              id: m.id,
              name: m.name,
              source: m.source,
              description: m.description,
              language: m.language,
              category: m.category,
              needsRef: m.needsRef,
              license: m.license,
              risk: m.risk,
              riskNote: m.riskNote,
              // 市场清单里的大小不准（手填的），前端不再显示
              sizeMb: m.sizeMb,
              sizeBytes: m.sizeBytes,
              fileCount: m.files.length,
              installed: set.has(m.id),
            })),
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/market/download',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          const id = String(body?.id || '')
          if (!id) { sendJson(res, 400, { ok: false, error: '缺少模型 id' }); return }
          const r = await downloadModel(MARKET_DIR, PROFILES_ROOT, id)
          profileCache = null
          invalidateProfilesSize()
          if (!r.ok) { sendJson(res, 500, r); return }
          sendJson(res, 200, r)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/market/progress',
      handler: (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          const id = String(u.searchParams.get('id') || '')
          sendJson(res, 200, { ok: true, progress: id ? getProgress(id) : null })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/market/cancel',
      handler: (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          const id = String(u.searchParams.get('id') || '')
          const r = cancelDownload(id)
          sendJson(res, 200, { ok: r, cancelled: r })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/market/clear',
      handler: (req, res) => {
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          clearProgress(String(u.searchParams.get('id') || ''))
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/market/uninstall',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          const r = uninstallModel(PROFILES_ROOT, body?.id)
          profileCache = null
          invalidateProfilesSize()
          if (!r.ok) { sendJson(res, 400, r); return }
          log('info', '已卸载模型 ' + r.id)
          if (cfg.profile === r.id) {
            const { profiles: left } = profiles()
            cfg = normalizeConfig({ ...cfg, profile: left[0]?.id || '' })
            saveUserConfig(CONFIG_FILE, cfg)
          }
          sendJson(res, 200, r)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 检测服务 ──────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/probe',
      handler: async (req, res) => {
        try {
          const eff = effective()
          const out = { ok: true, sapi: null, tts: null, svc: null }
          out.sapi = await sapi.probe()
          if (eff.profile && eff.profile.tts.engine === 'gpt-sovits' && eff.ttsUrl) {
            out.tts = await probeTts(eff.ttsUrl)
          }
          if (eff.svcUrl) out.svc = await probeSvc(eff.svcUrl)
          sendJson(res, 200, out)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // ── 前端日志上报 ──────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/clientlog',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req, 64 * 1024)
          const msg = String(body?.msg ?? '').slice(0, 500)
          const level = ['info', 'warn', 'error'].includes(body?.level) ? body.level : 'info'
          if (msg) log(level, '[client] ' + msg)
          sendJson(res, 200, { ok: true })
        } catch {
          try { res.writeHead(200); res.end('{}') } catch { /* 忽略 */ }
        }
      },
    })

    // ── 打开文件夹 ────────────────────────────────────────────────────
    scoped.webServer.register({
      kind: 'exact',
      path: ROUTE + '/open-folder',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const u = new URL(req.url ?? '/', 'http://x')
          const which = u.searchParams.get('which') || 'songs'
          let target
          if (which === 'profile') {
            const eff = effective()
            target = eff.profile ? eff.profile.dir : PROFILES_ROOT
          } else if (which === 'svc') {
            target = SVC_CWD
          } else {
            target = path.join(SVC_CWD, 'songs')
          }
          if (!fs.existsSync(target)) {
            sendJson(res, 404, { ok: false, error: '目录不存在：' + target })
            return
          }
          const { spawn } = await import('node:child_process')
          const c = spawn('explorer', [target], {
            detached: true, stdio: 'ignore', windowsHide: true,
          })
          c.unref()
          sendJson(res, 200, { ok: true, path: target })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
  })

  // ── TCP 唤醒端口（qq-bridge 桥接）────────────────────────────────
  // qq-bridge 的 tts-client.js / svc-client.js 通过这个端口请插件拉起服务：
  //   wake / tts  -> 拉起说话服务并预热
  //   sing / svc  -> 拉起唱歌服务并预热
  //   ping        -> 探活，回 ok
  // 行协议约定来自外部 qq-bridge 项目（本机机器人桥接用，可按此约定自行接入）。
  let wakeServer = null
  function startWakeServer() {
    try {
      wakeServer = net.createServer((socket) => {
        socket.setEncoding('utf8')
        socket.setTimeout(600000)
        let buf = ''
        socket.on('data', async (chunk) => {
          buf += chunk
          if (!buf.includes('\n')) return
          const cmd = buf.split('\n')[0].trim().toLowerCase()
          buf = ''
          const reply = (text) => { try { socket.write(text + '\n') } catch { /* 忽略 */ } }
          try {
            if (cmd === 'ping') { reply('ok'); return }
            if (cmd === 'wake' || cmd === 'tts') {
              const eff = effective()
              if (eff.profile && eff.profile.tts.engine !== 'sapi' && eff.ttsUrl) {
                const lr = await ensureTts(eff.ttsUrl)
                if (!lr.ok) { reply('err ' + lr.error); return }
                if (!ttsWarm) {
                  const w = await warmTtsNow(eff)
                  if (!w.ok) { reply('err ' + w.error); return }
                  ttsWarm = true
                  ttsLastUsedAt = Date.now()
                }
                reply('ok')
              } else {
                reply('ok')
              }
              return
            }
            if (cmd === 'sing' || cmd === 'svc') {
              const eff = effective()
              if (!eff.svcUrl) { reply('err 未配置唱歌服务'); return }
              const lr = await ensureSvc(eff.svcUrl)
              if (!lr.ok) { reply('err ' + lr.error); return }
              if (!svcWarm) {
                const w = await warmSvc(eff.svcUrl)
                if (!w.ok) { reply('err ' + w.error); return }
                svcWarm = true
                svcLastUsedAt = Date.now()
              }
              reply('ok')
              return
            }
            reply('err 未知命令: ' + cmd)
          } catch (e) {
            reply('err ' + (e?.message ?? e))
          }
        })
        socket.on('error', () => {})
        socket.on('timeout', () => { try { socket.destroy() } catch { /* 忽略 */ } })
      })
      wakeServer.on('error', () => {})
      wakeServer.listen(cfg.wakePort || 0, '127.0.0.1', () => {
        log('info', '唤醒端口已监听 127.0.0.1:' + (cfg.wakePort || 0))
      })
    } catch (e) {
      log('warn', '唤醒端口启动失败: ' + (e?.message ?? e))
    }
  }
  if (cfg.wakePort > 0 && cfg.wakeEnabled !== false) startWakeServer()

  // ── 空闲冷却：一段时间没使用就自动卸载模型，把显存还给系统 ──────
  function startIdleWatch() {
    if (idleTimer !== null) return
    // 60 秒检测一次：滑块最小单位是 1 分钟，检测粒度对齐滑块，
    // 比 30 秒少一半唤醒次数，省一点资源，精度上没有任何损失。
    idleTimer = setInterval(async () => {
      try {
        const ms = Number(cfg.idleUnloadMs) || 0
        if (ms <= 0) return

        // TTS：预热过、当前没在合成、队列空，且超过空闲时间
        if (ttsWarm && !pumping && queue.length === 0 && ttsLastUsedAt > 0) {
          if (Date.now() - ttsLastUsedAt >= ms) {
            log('info', '空闲冷却：TTS 预热标记已取消（' + Math.round(ms / 60000) + ' 分钟未使用）')
            ttsWarm = false
            ttsLastUsedAt = 0
            // api_v2 没有 /unload，只能标记；模型等进程空闲时由 torch 缓存回收
          }
        }

        // SVC：预热过、没在唱歌，且超过空闲时间
        if (svcWarm && !svcSinging && svcLastUsedAt > 0) {
          if (Date.now() - svcLastUsedAt >= ms) {
            log('info', '空闲冷却：SVC 预热标记已取消')
            svcWarm = false
            svcLastUsedAt = 0
            try {
              const eff = effective()
              if (eff.svcUrl) await unloadSvc(eff.svcUrl)
            } catch (e) {
              log('warn', 'SVC 卸载失败: ' + (e?.message ?? e))
            }
          }
        }
      } catch { /* 定时器异常不影响主流程 */ }
    }, 60000)
    if (typeof idleTimer.unref === 'function') idleTimer.unref()
  }

  // 启动时探测服务：如果服务已经在跑（比如上次启动拉起、DSH 重启但服务没退），
  // 恢复 warm 标记，否则会出现「开关关着但显存有占用、状态在线」的矛盾。
  async function syncWarmFromServices() {
    try {
      const eff = effective()
      log('info', '启动状态同步开始: ttsUrl=' + (eff.ttsUrl || '空') + ' svcUrl=' + (eff.svcUrl || '空'))

      if (eff.ttsUrl) {
        let port = 80
        try { port = Number(new URL(eff.ttsUrl).port) || 80 } catch { /* 默认 */ }
        const up = await portOpen(port)
        log('info', 'TTS 端口 ' + port + ': ' + (up ? '在线' : '离线'))
        if (up) {
          const v = await queryTtsVram(eff.ttsUrl)
          log('info', 'TTS /vram 自报: ' + (v === null ? '拿不到' : v + ' MiB'))
          ttsWarm = v !== null && v > 0
          if (ttsWarm) ttsLastUsedAt = Date.now()
          log('info', 'TTS warm 同步为: ' + ttsWarm)
        }
      }

      if (eff.svcUrl) {
        let port = 80
        try { port = Number(new URL(eff.svcUrl).port) || 80 } catch { /* 默认 */ }
        const up = await portOpen(port)
        log('info', 'SVC 端口 ' + port + ': ' + (up ? '在线' : '离线'))
        if (up) {
          const h = await probeSvc(eff.svcUrl)
          log('info', 'SVC /health: ready=' + h.ready + ' vramMb=' + (h.vramMb ?? '无'))
          svcWarm = h.ok && h.ready === true
          if (svcWarm) svcLastUsedAt = Date.now()
          log('info', 'SVC warm 同步为: ' + svcWarm)
        }
      }
      log('info', '启动状态同步完成')
    } catch (e) {
      log('warn', '同步服务状态失败: ' + (e?.message ?? e))
    }
  }

  void syncWarmFromServices()

  startIdleWatch()

  // ── 注入前端脚本 ────────────────────────────────────────────────────
  try {
    ctx.on('webserver/index-inject', (table) => {
      try {
        // 宿主传进来的是一个数组，每项形如 { kind, placement, text }。
        // 早期版本误判成对象/函数，导致脚本从未被注入、整个挂件不显示。
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.includes(CLIENT_ROUTE)) {
            return
          }
        }
        // 用内联片段动态插入 script，避免被宿主缓存
        const snippet = '(function(){try{'
          + 'var d=document.body||document.head||document.documentElement;if(!d)return;'
          + 'if(document.querySelector("script[data-voice-studio]"))return;'
          + 'var s=document.createElement("script");'
          + 's.type="module";'
          + 's.src="' + CLIENT_ROUTE + '?v="+Date.now();'
          + 's.async=true;'
          + 's.setAttribute("data-voice-studio","1");'
          + 's.onerror=function(){};'
          + 'd.appendChild(s)'
          + '}catch(e){}})()'
        table.push({ kind: 'script', placement: 'body', text: snippet })
      } catch { /* 注入失败不能拖垮启动 */ }
    })
  } catch { /* 宿主不支持 */ }

  /**
   * 按端口杀掉监听进程。用于退出清理的孤儿进程兜底：
   * 旧版本没做退出清理，可能留下 pythonw 还占着 9880。
   */
  function killByPort(port) {
    try {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
      })
      for (const line of out.split(String.fromCharCode(10))) {
        if (!line.includes('LISTENING') || !line.includes(':' + port + ' ')) continue
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (!pid || !Number.isInteger(pid)) continue
        try {
          execFileSync('taskkill', ['/PID', String(pid), '/F'], {
            windowsHide: true, timeout: 5000,
          })
        } catch { /* 进程可能已退 */ }
        log('info', '已按端口 ' + port + ' 终止进程 PID=' + pid)
      }
    } catch { /* 拿不到就跳过，不影响退出 */ }
  }

  // ── 退出 DSH 时卸载模型（保留服务进程，只释放显存）──────────────
  // 和原版一致：ctx.effect 必须直接调用，不要用 ?. 静默跳过。
  ctx.effect(() => () => {
        try {
          // 分别按开关处理，默认都开。
          // 用 currentProfile() 拿真实角色（含角色级 svc.baseUrl），
          // 用 resolveEffective(cfg, null) 会丢掉角色配置导致 svcUrl 为空。
          const eff = resolveEffective(cfg, currentProfile())

          // SVC：有 /unload，服务进程保留，只卸模型
          if (cfg.svcUnloadOnExit !== false && eff.svcUrl) {
            // portOpen 是异步的，清理函数不能 await；直接发请求，
            // 失败就失败（进程反正保留，下次启动会自动同步状态）。
            fetch(String(eff.svcUrl).replace(/\/+$/, '') + '/unload', {
              method: 'POST',
              signal: AbortSignal.timeout(8000),
            }).catch(() => {})
            log('info', '退出清理：已请求卸载 SVC 模型')
          }

          // TTS：api_v2 没有 /unload，只能杀服务进程才能真正释放显存
          // 用 child.kill()，Windows 上能正确终止；SIGTERM 在 win 下不可用
          if (cfg.ttsUnloadOnExit !== false) {
            if (ttsChild) {
              try { ttsChild.kill() } catch { /* 已经退了 */ }
            } else if (ttsPid) {
              try { process.kill(ttsPid) } catch { /* 已经退了 */ }
            }
            // 孤儿进程兜底：旧版本没做退出清理，可能留下 pythonw 还占着端口
            killByPort(9880)
            log('info', '退出清理：TTS 进程已终止')
          }
        } catch { /* 清理失败不能拖垮退出 */ }
        try { if (wakeServer) wakeServer.close() } catch { /* 忽略 */ }
  })

  log('info', '已加载（朗读' + (cfg.enabled ? '开启' : '关闭') + '）')
}
