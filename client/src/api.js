/**
 * 后端接口封装。
 *
 * 所有请求统一走 request()：
 *   · 失败不抛异常，返回 {ok:false, error}
 *   · 自动把错误上报到后端日志（Electron 里前端 console 不可见）
 */

const ROUTE = '/voice-studio'

/** 上报前端事件到后端日志。 */
export function logEvent(msg, level) {
  try {
    fetch(ROUTE + '/clientlog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: String(msg).slice(0, 500), level: level || 'info' }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* 忽略 */ }
}

async function request(path, init, timeoutMs = 20000) {
  try {
    const res = await fetch(ROUTE + path, {
      ...(init || {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const err = (body && body.error) || ('HTTP ' + res.status)
      logEvent('请求失败 ' + path + ' → ' + err, 'warn')
      return { ok: false, error: err }
    }
    return await res.json()
  } catch (error) {
    const msg = String((error && error.message) || error)
    logEvent('请求异常 ' + path + ' → ' + msg, 'error')
    return { ok: false, error: msg }
  }
}

const post = (path, body, timeoutMs) => request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
}, timeoutMs)

export const api = {
  status: () => request('/status'),
  config: () => request('/config'),
  saveConfig: (patch) => post('/config', patch),

  speak: (text) => post('/speak', { text }, 240000),
  poll: () => request('/poll'),
  clear: () => post('/clear'),

  ttsWarm: () => post('/tts-warm', {}, 240000),
  svcToggle: () => post('/svc-toggle', {}, 240000),
  probe: () => request('/probe', undefined, 30000),

  songs: () => request('/songs', undefined, 15000),
  sing: (opts) => post('/sing', opts, 660000),

  market: () => request('/market'),
  marketDownload: (id) => post('/market/download', { id }, 1800000),
  marketProgress: (id) => request('/market/progress?id=' + encodeURIComponent(id)),
  marketCancel: (id) => request('/market/cancel?id=' + encodeURIComponent(id)),
  marketClear: (id) => request('/market/clear?id=' + encodeURIComponent(id)),
  marketUninstall: (id) => post('/market/uninstall', { id }),

  upload: (which, data) => post('/upload', { which, data }, 60000),
  openFolder: (which) => post('/open-folder?which=' + encodeURIComponent(which || 'songs')),

  assetUrl: (name, version) => ROUTE + '/asset?name=' + encodeURIComponent(name)
    + '&v=' + encodeURIComponent(version || ''),
  iconUrl: (name) => ROUTE + '/icon?name=' + encodeURIComponent(name),

  /** 立绘动图清单：{ moods: [{key,name,tag,file,bytes}] } */
  moods: () => request('/moods', undefined, 15000),
  /** 单个动图 URL */
  moodUrl: (key, version) => ROUTE + '/mood?name=' + encodeURIComponent(key)
    + '&v=' + encodeURIComponent(version || ''),
}
