/**
 * 文本清洗与分段。
 *
 * 朗读前要处理掉 Markdown 标记、代码块、链接等，否则会念出一堆符号。
 */

/** 去掉不适合朗读的部分。 */
export function cleanForSpeech(input) {
  let s = String(input || '')

  // 代码块整段丢弃（念出来毫无意义）
  s = s.replace(/```[\s\S]*?```/g, '（代码略）')
  s = s.replace(/`([^`]+)`/g, '$1')

  // 图片/链接只留文字
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 标题、列表、引用符号
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  s = s.replace(/^\s{0,3}>\s?/gm, '')
  s = s.replace(/^\s{0,3}[-*+]\s+/gm, '')
  s = s.replace(/^\s{0,3}\d+\.\s+/gm, '')

  // 强调与删除线
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')
  s = s.replace(/(\*|_)(.*?)\1/g, '$2')
  s = s.replace(/~~(.*?)~~/g, '$1')

  // 表格分隔线与多余空行
  s = s.replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, '')
  s = s.replace(/\n{3,}/g, '\n\n')

  // 压缩空白
  s = s.replace(/[ \t]{2,}/g, ' ')

  return s.trim()
}

/** 截断过长文本，超限时保留开头并在末尾加省略。 */
export function truncateForTurn(input, maxChars) {
  const s = String(input || '')
  const max = Math.max(1, Number(maxChars) || 1200)
  if (s.length <= max) return s
  return s.slice(0, max) + '……'
}

/**
 * 按标点分段，避免一次合成太长导致卡顿。
 * 优先在句号/问号/感叹号/分号处断开。
 */
export function splitSegments(input, maxChars) {
  const s = String(input || '').trim()
  if (!s) return []
  const limit = Math.max(20, Number(maxChars) || 120)
  if (s.length <= limit) return [s]

  const out = []
  let buf = ''

  // 先按句末标点切
  const sentences = s.split(/(?<=[。！？!?；;\n])/)
  for (const raw of sentences) {
    const piece = raw.trim()
    if (!piece) continue
    if ((buf + piece).length <= limit) {
      buf += piece
      continue
    }
    if (buf) { out.push(buf); buf = '' }
    if (piece.length <= limit) { buf = piece; continue }
    // 单句仍然超长 → 按逗号再切
    for (const sub of piece.split(/(?<=[，,、：:])/)) {
      const t = sub.trim()
      if (!t) continue
      if ((buf + t).length <= limit) { buf += t; continue }
      if (buf) { out.push(buf); buf = '' }
      if (t.length <= limit) { buf = t; continue }
      // 还超长就硬切
      for (let i = 0; i < t.length; i += limit) out.push(t.slice(i, i + limit))
    }
  }
  if (buf) out.push(buf)
  return out.filter(Boolean)
}
