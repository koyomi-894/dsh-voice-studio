/**
 * GPT-SoVITS HTTP 客户端。
 *
 * 重要事实（实测确认，不要假设）：
 *   · api_v2.py 只有 /tts、/control、/set_gpt_weights、/set_sovits_weights、/set_refer_audio
 *   · 没有 /warm、没有 /unload —— 模型在第一次 /tts 时延迟加载
 *   · 所以「预热」= 发一次极短的试合成
 */

/**
 * 探活：能连上就算活着（接口可能返回 404，那也说明服务在跑）。
 */
export async function probeTts(baseUrl, { timeoutMs = 3000 } = {}) {
  if (!baseUrl) return { ok: false, error: '未配置地址' }
  const base = String(baseUrl).replace(/\/+$/, '')
  for (const path of ['/tts', '/']) {
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(timeoutMs) })
      // 有响应就说明在跑，状态码不重要
      if (r.status < 500) return { ok: true, status: r.status }
    } catch { /* 继续试下一个 */ }
  }
  return { ok: false, error: '连接失败' }
}

/**
 * 推送 GPT 微调权重给服务端加载（api_v2 的 /set_gpt_weights?weights_path=…）。
 * 加载大 ckpt 可能要几十秒，超时给足。返回 {ok, error?}。
 */
export async function setGptWeights(baseUrl, weightsPath, { timeoutMs = 180000 } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base || !weightsPath) return { ok: false, error: '缺少地址或权重路径' }
  try {
    const r = await fetch(base + '/set_gpt_weights?weights_path=' + encodeURIComponent(weightsPath), {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return { ok: false, error: 'HTTP ' + r.status + ' ' + String(t).slice(0, 160) }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

/**
 * 推送 SoVITS 微调权重（api_v2 的 /set_sovits_weights?weights_path=…）。
 */
export async function setSovitsWeights(baseUrl, weightsPath, { timeoutMs = 180000 } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base || !weightsPath) return { ok: false, error: '缺少地址或权重路径' }
  try {
    const r = await fetch(base + '/set_sovits_weights?weights_path=' + encodeURIComponent(weightsPath), {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return { ok: false, error: 'HTTP ' + r.status + ' ' + String(t).slice(0, 160) }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

/**
 * 预热：用一次极短合成触发模型加载。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function warmTts(profile, baseUrl, { timeoutMs = 180000 } = {}) {  if (!profile) return { ok: false, error: '没有可用角色' }
  const ref = profile.tts?.refAudio || ''
  if (!ref) return { ok: false, error: '该角色未配置参考音频，无法预热' }
  const base = String(baseUrl).replace(/\/+$/, '')

  const params = new URLSearchParams({
    text: '好',
    text_lang: profile.tts.textLang || 'zh',
    ref_audio_path: ref,
    prompt_text: profile.tts.promptText || '',
    prompt_lang: profile.tts.promptLang || 'zh',
    media_type: 'wav',
    streaming_mode: 'false',
  })

  try {
    const r = await fetch(base + '/tts?' + params.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return { ok: false, error: '试合成 HTTP ' + r.status + ' ' + String(t).slice(0, 160) }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: '试合成失败：' + (error?.message ?? error) }
  }
}

/**
 * 查服务自报的显存占用（MiB）。拿不到返回 null。
 */
let vramCache = { at: 0, value: null }
const VRAM_CACHE_MS = 30000

export async function queryTtsVram(baseUrl, { timeoutMs = 2500 } = {}) {
  if (!baseUrl) return null
  const now = Date.now()
  // 前端每 1.5s 轮询一次 /status，但服务端日志会记下每一次 /vram 请求，
  // 30 秒内只真正打一次，日志噪音降一个数量级。
  if (vramCache.value !== null && now - vramCache.at < VRAM_CACHE_MS) return vramCache.value
  const base = String(baseUrl).replace(/\/+$/, '')
  try {
    const r = await fetch(base + '/vram', { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json()
    const v = Number(d?.vramMb)
    const out = Number.isFinite(v) && v >= 0 ? v : null
    vramCache = { at: now, value: out }
    return out
  } catch { return null }
}

/**
 * 合成一段文本，返回音频 Buffer。
 *
 * @param {object} opts 采样参数（temperature/topK/topP/fragmentInterval 等）。
 *   这些参数是 api_v2 的标准字段，对所有 GPT-SoVITS 模型通用，
 *   和具体角色无关。
 */
export async function synthesize(profile, baseUrl, text, opts = {}, { timeoutMs = 180000 } = {}) {
  if (!profile) return { ok: false, error: '没有可用角色' }
  const ref = profile.tts?.refAudio || ''
  if (!ref) return { ok: false, error: '该角色未配置参考音频' }
  const base = String(baseUrl).replace(/\/+$/, '')

  const params = new URLSearchParams({
    text,
    text_lang: profile.tts.textLang || 'zh',
    ref_audio_path: ref,
    prompt_text: profile.tts.promptText || '',
    prompt_lang: profile.tts.promptLang || 'zh',
    media_type: 'wav',
    streaming_mode: 'false',
    // 采样参数：缺省时用原版同款保守值
    temperature: String(opts.temperature ?? 0.7),
    top_k: String(opts.topK ?? 10),
    top_p: String(opts.topP ?? 0.9),
    repetition_penalty: String(opts.repetitionPenalty ?? 1.35),
    fragment_interval: String(opts.fragmentInterval ?? 0.4),
    speed_factor: String(opts.speed ?? 1),
  })

  try {
    const r = await fetch(base + '/tts?' + params.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return { ok: false, error: '合成 HTTP ' + r.status + ' ' + String(t).slice(0, 200) }
    }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) return { ok: false, error: '合成返回空音频' }
    return { ok: true, buffer: buf }
  } catch (error) {
    return { ok: false, error: '合成失败：' + (error?.message ?? error) }
  }
}
