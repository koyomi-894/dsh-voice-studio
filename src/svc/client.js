/**
 * Seed-VC 唱歌服务客户端。
 *
 * 与服务端的约定（svc_server.py）：
 *   GET  /health    → { ready, loading, device, busy, vramMb }
 *   POST /warm      → 加载模型进显存
 *   POST /unload    → 卸载释放显存
 *   GET  /library   → 可用源音频列表
 *   POST /sing      → 转换
 *   GET  /audio/<n> → 取回结果
 */

const trim = (u) => String(u || '').replace(/\/+$/, '')

/** 探活 + 读状态。 */
export async function probeSvc(baseUrl, { timeoutMs = 3000 } = {}) {
  if (!baseUrl) return { ok: false, ready: false, error: '未配置地址' }
  try {
    const r = await fetch(trim(baseUrl) + '/health', { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return { ok: false, ready: false, error: 'HTTP ' + r.status }
    const d = await r.json()
    return {
      ok: true,
      ready: d?.ready === true,
      loading: d?.loading === true,
      busy: d?.busy === true,
      device: d?.device || '',
      vramMb: Number.isFinite(Number(d?.vramMb)) ? Number(d.vramMb) : null,
      error: d?.error || '',
    }
  } catch (error) {
    return { ok: false, ready: false, error: String(error?.message ?? error) }
  }
}

/** 查显存占用（MiB）。拿不到返回 null。 */
export async function querySvcVram(baseUrl) {
  const s = await probeSvc(baseUrl)
  return s.ok ? s.vramMb : null
}

/** 预热：加载模型。 */
export async function warmSvc(baseUrl, { timeoutMs = 180000 } = {}) {
  if (!baseUrl) return { ok: false, error: '未配置地址' }
  try {
    const r = await fetch(trim(baseUrl) + '/warm', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok) return { ok: false, error: (d && d.error) || ('HTTP ' + r.status) }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/** 卸载：释放显存。 */
export async function unloadSvc(baseUrl, { timeoutMs = 30000 } = {}) {
  if (!baseUrl) return { ok: false, error: '未配置地址' }
  try {
    const r = await fetch(trim(baseUrl) + '/unload', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { ok: r.ok }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 列出可用源音频。
 *
 * ⚠️ 协议契约：svc_server.py 的 /library 返回的是 `{ dir, items: [{ name, bytes }] }`，
 * 不是 `{ songs: [...] }`。以前这里读 d.songs，于是歌曲库永远是空的 ——
 * 面板显示「0 首」、下拉框空，但文件其实好好躺在 songs/ 里。
 * 这里同时兼容 items / songs 两种键，且把对象项归一成文件名字符串，
 * 因为前端把列表值直接当作 /sing 的 source 传回服务端。
 */
export async function listSongs(baseUrl, { timeoutMs = 5000 } = {}) {
  if (!baseUrl) return { ok: false, dir: '', songs: [], error: '未配置地址' }
  try {
    const r = await fetch(trim(baseUrl) + '/library', { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return { ok: false, dir: '', songs: [], error: 'HTTP ' + r.status }
    const d = await r.json()
    const raw = Array.isArray(d?.items) ? d.items : (Array.isArray(d?.songs) ? d.songs : [])
    const songs = raw
      .map((it) => (typeof it === 'string' ? it : String(it?.name ?? '')))
      .filter(Boolean)
    return { ok: true, dir: typeof d?.dir === 'string' ? d.dir : '', songs }
  } catch (error) {
    return { ok: false, dir: '', songs: [], error: String(error?.message ?? error) }
  }
}

/**
 * 唱一首。
 * @param {object} o
 * @param {string} o.source  源音频名
 * @param {number} [o.steps] 扩散步数
 * @param {string} [o.backing] keep | remove
 * @param {number} [o.vocalGain]
 * @param {number} [o.backingGain]
 */
export async function singSong(baseUrl, o, { timeoutMs = 600000 } = {}) {
  if (!baseUrl) return { ok: false, error: '未配置地址' }
  const body = {
    source: o.source,
    steps: o.steps ?? 30,
    backing: o.backing ?? 'keep',
    vocal_gain: o.vocalGain ?? 1,
    backing_gain: o.backingGain ?? 0.9,
  }
  try {
    const r = await fetch(trim(baseUrl) + '/sing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.ok) return { ok: false, error: (d && (d.error || d.message)) || ('HTTP ' + r.status) }
    // 结果音频用 /audio/<name> 取回
    const url = trim(baseUrl) + '/audio/' + encodeURIComponent(d.file || d.name || '')
    return { ok: true, file: d.file || d.name, url, raw: d }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/** 取回结果音频的字节流。 */
export async function fetchAudio(url, { timeoutMs = 60000 } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) return { ok: false, error: '空音频' }
    return { ok: true, buffer: buf }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}
