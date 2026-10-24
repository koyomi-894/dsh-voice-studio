/**
 * WAV 尾静音裁剪。
 *
 * 背景：GPT-SoVITS 的时长预测偶发抽风——16 字的短句能合成出 40 多秒音频，
 * 实际只有开头一两秒是语音，后面全是近乎静音的底噪，挂件会傻播全程。
 * 合成/缓存命中后裁掉结尾长静音，只保留最后一个有效样本 + 一小段自然收尾。
 *
 * 只处理 16bit PCM RIFF；其他格式原样返回，绝不因为裁剪失败丢音频。
 */

/** 读取 wav 时长（秒）。解析失败返回 null。 */
export function wavDurationSec(buf) {
  try {
    if (!buf || buf.length < 44) return null
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
    for (let o = 12; o + 8 <= buf.length; ) {
      const id = buf.toString('ascii', o, o + 4)
      const sz = buf.readUInt32LE(o + 4)
      if (id === 'fmt ') {
        const rate = buf.readUInt32LE(o + 12)
        const bits = buf.readUInt16LE(o + 22)
        // data 块在后面；先找 data
        for (let p = o + 8 + sz + (sz % 2); p + 8 <= buf.length; ) {
          const pid = buf.toString('ascii', p, p + 4)
          const psz = buf.readUInt32LE(p + 4)
          if (pid === 'data') {
            if (!rate || bits !== 16) return null
            return Math.min(psz, buf.length - p - 8) / (rate * 2)
          }
          p += 8 + psz + (psz % 2)
        }
        return null
      }
      o += 8 + sz + (sz % 2)
    }
    return null
  } catch {
    return null
  }
}

/** 裁掉 wav 结尾的静音段。返回裁剪后的 Buffer（可能就是原 Buffer）。 */
export function trimWavTail(buf, { threshold = 600, padMs = 300 } = {}) {
  try {
    if (!buf || buf.length < 44) return buf
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return buf

    // 找 fmt 与 data 块
    let dataOff = -1
    let dataSz = 0
    let sampleRate = 0
    let bits = 16
    let ch = 1
    for (let o = 12; o + 8 <= buf.length; ) {
      const id = buf.toString('ascii', o, o + 4)
      const sz = buf.readUInt32LE(o + 4)
      if (id === 'fmt ') {
        ch = buf.readUInt16LE(o + 10)
        sampleRate = buf.readUInt32LE(o + 12)
        bits = buf.readUInt16LE(o + 22)
      }
      if (id === 'data') {
        dataOff = o + 8
        dataSz = Math.min(sz, buf.length - dataOff)
        break
      }
      o += 8 + sz + (sz % 2)
    }
    if (dataOff < 0 || dataSz <= 0) return buf
    if (bits !== 16 || ch < 1 || !sampleRate) return buf

    const bytesPerFrame = 2 * ch
    const frames = Math.floor(dataSz / bytesPerFrame)

    // 从尾往前找最后一个超过阈值的帧
    let lastLoud = -1
    for (let i = frames - 1; i >= 0; i--) {
      const off = dataOff + i * bytesPerFrame
      for (let c = 0; c < ch; c++) {
        if (Math.abs(buf.readInt16LE(off + c * 2)) > threshold) { lastLoud = i; break }
      }
      if (lastLoud >= 0) break
    }
    // 全程低于阈值：可能是纯气声，不动它
    if (lastLoud < 0) return buf

    // 保留到最后一个有效帧 + padMs 自然收尾
    const keepFrames = Math.min(frames, lastLoud + 1 + Math.ceil((padMs * sampleRate) / 1000))
    const keepBytes = keepFrames * bytesPerFrame
    if (keepBytes >= dataSz) return buf

    const out = Buffer.from(buf.subarray(0, dataOff + keepBytes))
    out.writeUInt32LE(keepBytes, dataOff - 4)      // data 块长度
    out.writeUInt32LE(dataOff - 8 + keepBytes, 4)  // RIFF 总长
    return out
  } catch {
    return buf
  }
}
