/**
 * 显存读数。
 *
 * 优先级：
 *   1. 服务自报（TTS 的 /vram、SVC 的 /health.vramMb）—— 准确
 *   2. 整卡差值估算 —— 兜底，保证各项之和恒等于整卡已用
 *
 * WDDM 驱动下 nvidia-smi --query-compute-apps 一律返回 [N/A]，拿不到单进程占用，
 * 所以只能读整卡再想办法拆。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_FILE = path.join(HERE, '..', '..', '.vram-baseline.json')

/** 基线超过这个时间不再可信：期间系统占用会变，差值失真。 */
const BASELINE_TTL_MS = 2 * 60 * 60 * 1000

/** 整卡读数缓存，避免每次轮询都 spawn 进程。 */
let cache = { at: 0, value: null }
const CACHE_MS = 4000

/**
 * 读整卡显存（MiB）。
 * @returns {Promise<{used:number,total:number}|null>}
 */
export function readGpuMemory() {
  const now = Date.now()
  if (cache.value && now - cache.at < CACHE_MS) return Promise.resolve(cache.value)

  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) { resolve(null); return }
        const line = String(stdout).trim().split(/\r?\n/)[0] || ''
        const p = line.split(',').map((s) => Number(String(s).trim()))
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { resolve(null); return }
        const value = { used: Math.round(p[0]), total: Math.round(p[1]) }
        cache = { at: now, value }
        resolve(value)
      },
    )
  })
}

// ── 基线持久化 ──────────────────────────────────────────────────────────

const baselines = new Map()

function loadBaselines() {
  try {
    if (!fs.existsSync(BASELINE_FILE)) return
    const data = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    const now = Date.now()
    for (const k of Object.keys(data)) {
      const e = data[k]
      const used = typeof e === 'number' ? e : Number(e?.used)
      const at = typeof e === 'number' ? 0 : Number(e?.at) || 0
      if (!Number.isFinite(used) || used < 0) continue
      // 太旧的基线丢掉，用了反而更不准
      if (at && now - at > BASELINE_TTL_MS) continue
      baselines.set(k, used)
    }
  } catch { /* 文件损坏就当没有 */ }
}

function persistBaselines() {
  try {
    const obj = {}
    const now = Date.now()
    for (const [k, v] of baselines) obj[k] = { used: v, at: now }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(obj, null, 2), 'utf8')
  } catch { /* 写失败不影响功能 */ }
}

loadBaselines()

export function setBaseline(key, usedMiB) {
  if (Number.isFinite(usedMiB) && usedMiB >= 0) {
    baselines.set(key, usedMiB)
    persistBaselines()
  }
}

export function getBaseline(key) {
  return baselines.has(key) ? baselines.get(key) : null
}

export function clearBaseline(key) {
  baselines.delete(key)
  persistBaselines()
}

// ── 估算 ────────────────────────────────────────────────────────────────

/**
 * 一次性估算多个服务的占用。
 *
 * 为什么不能逐个算：差值法下若 A 先跑、B 后启动，B 的基线里已经含了 A 的占用，
 * 各自「当前 - 自己基线」再相加会把 A 算两遍。
 *
 * 正确做法：共用最早基线求总增量，再按各服务基线差的比例拆分。
 * 各项之和恒等于整卡已用。
 */
export async function estimateMany(keys) {
  const gpu = await readGpuMemory()
  if (!gpu) return null

  const withBase = keys.filter((k) => getBaseline(k) !== null)
  const parts = {}

  if (withBase.length === 0) {
    for (const k of keys) parts[k] = null
    return { used: gpu.used, total: gpu.total, parts }
  }

  const base = Math.min(...withBase.map((k) => getBaseline(k)))
  const delta = Math.max(0, gpu.used - base)

  // 基线越晚（越接近当前值）说明它启动得越晚，该分到的增量越少
  const weights = withBase.map((k) => Math.max(0, getBaseline(k) - base))
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  if (totalWeight === 0) {
    // 基线完全相同（典型：两个服务同时被唤醒），分不出谁多谁少 → 均分。
    // 绝不能让每个服务都拿整份 delta，那样合计会翻倍。
    const share = Math.round(delta / withBase.length)
    for (const k of keys) parts[k] = withBase.includes(k) ? share : null
    return { used: gpu.used, total: gpu.total, parts }
  }

  // 按权重拆分，最后一个吃掉取整误差，保证总和精确等于 delta
  let assigned = 0
  withBase.forEach((k, i) => {
    const isLast = i === withBase.length - 1
    const share = isLast
      ? delta - assigned
      : Math.round(delta * (weights[i] / totalWeight))
    parts[k] = share
    assigned += share
  })
  for (const k of keys) if (parts[k] === undefined) parts[k] = null

  return { used: gpu.used, total: gpu.total, parts }
}

/** 结果合并：优先用服务自报的真实值，缺失的用估算补。 */
export async function resolveUsage(keys, realValues) {
  const est = await estimateMany(keys)
  if (!est) return null

  const parts = {}
  for (const k of keys) {
    const real = realValues ? realValues[k] : null
    parts[k] = (typeof real === 'number' && real >= 0) ? real : (est.parts[k] ?? null)
  }

  const known = keys.filter((k) => parts[k] !== null)
  const usedKnown = known.reduce((a, k) => a + parts[k], 0)
  const other = Math.max(0, est.used - usedKnown)

  return {
    used: est.used,
    total: est.total,
    parts,
    other,
    exact: keys.every((k) => typeof (realValues || {})[k] === 'number'),
  }
}

/** 把 MiB 格式化成人类可读。 */
export function formatMiB(mib) {
  const n = Number(mib) || 0
  if (n <= 0) return '0 MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' GB'
  return Math.round(n) + ' MB'
}
