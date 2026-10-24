/**
 * 音频播放。
 *
 * 用 Web Audio 而不是 <audio>：Electron 的自动播放策略会拦截 <audio>.play()，
 * AudioContext 可以在用户首次交互时 unlock 后一直可用。
 */

export function createPlayer() {
  let ctx = null
  let source = null
  let gain = null
  let volume = 1

  function ensure() {
    if (ctx) return ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(ctx.destination)
    return ctx
  }

  /** 首次用户交互时调用，解锁音频上下文。 */
  function unlock() {
    try {
      const c = ensure()
      if (c && c.state === 'suspended') c.resume().catch(() => {})
    } catch { /* 忽略 */ }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0))
    if (gain) gain.gain.value = volume
  }

  function stop() {
    try {
      if (source) { source.stop(); source.disconnect() }
    } catch { /* 已经停了 */ }
    source = null
  }

  /**
   * 播放 base64 音频。
   * @returns {Promise<{ok:boolean, duration?:number, error?:string}>}
   */
  async function play(base64) {
    try {
      const c = ensure()
      if (!c) return { ok: false, error: '浏览器不支持 Web Audio' }
      if (c.state === 'suspended') await c.resume().catch(() => {})

      const bin = atob(String(base64 || ''))
      if (!bin.length) return { ok: false, error: '音频为空' }

      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

      const audioBuf = await c.decodeAudioData(bytes.buffer.slice(0))
      stop()

      source = c.createBufferSource()
      source.buffer = audioBuf
      source.connect(gain)
      source.start()
      return { ok: true, duration: audioBuf.duration }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  }

  return { unlock, play, stop, setVolume }
}
