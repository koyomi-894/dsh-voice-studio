/**
 * 模型市场：读清单、下载权重、生成角色目录。
 *
 * 约束：
 *   · 只索引下载地址，不托管任何权重文件。
 *   · 下载要支持断点续传（大文件网络容易断）。
 *   · 卸载必须防路径穿越。
 */

import fs from 'node:fs'
import path from 'node:path'

const trim = (u) => String(u || '').replace(/\/+$/, '')

/** 读市场清单。 */
export function readMarket(marketDir) {
  const file = path.join(marketDir, 'index.json')
  try {
    if (!fs.existsSync(file)) return { ok: false, error: '找不到市场清单：' + file }
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    const models = Array.isArray(d?.models) ? d.models : []
    return {
      ok: true,
      notice: typeof d?.notice === 'string' ? d.notice : '',
      updatedAt: typeof d?.updatedAt === 'string' ? d.updatedAt : '',
      models: models.map((m) => ({
        id: String(m.id || ''),
        name: String(m.name || m.id || ''),
        source: String(m.source || ''),
        description: String(m.description || ''),
        language: String(m.language || ''),
        category: String(m.category || ''),
        needsRef: m.needsRef === true,
        license: String(m.license || ''),
        risk: String(m.risk || 'nca'),
        riskNote: String(m.riskNote || ''),
        sizeMb: Number(m.sizeMb) || 0,
        sizeBytes: Number(m.sizeBytes) || (Number(m.sizeMb) || 0) * 1048576,
        engine: String(m.engine || 'gpt-sovits'),
        files: Array.isArray(m.files) ? m.files : [],
        refAudio: String(m.refAudio || ''),
        promptText: String(m.promptText || ''),
        ttsBaseUrl: String(m.ttsBaseUrl || ''),
        svc: m.svc && typeof m.svc === 'object' ? m.svc : null,
      })).filter((m) => m.id),
    }
  } catch (error) {
    return { ok: false, error: '解析清单失败：' + (error?.message ?? error) }
  }
}

export function findModel(marketDir, id) {
  const r = readMarket(marketDir)
  if (!r.ok) return r
  const m = r.models.find((x) => x.id === id)
  return m ? { ok: true, model: m } : { ok: false, error: '清单里没有这个模型：' + id }
}

// ── 下载进度（内存） ────────────────────────────────────────────────────

const progress = new Map()

export function getProgress(id) {
  return progress.get(id) || null
}

/** 请求取消某个下载。正在下载的循环会在下一次读块时停下并清理 .part。 */
export function cancelDownload(id) {
  const cur = progress.get(id)
  if (!cur) return false
  cur.cancelled = true
  progress.set(id, cur)
  return true
}

function setProgress(id, patch) {
  const cur = progress.get(id) || { done: 0, total: 0, current: '', error: '' }
  progress.set(id, { ...cur, ...patch })
}

export function clearProgress(id) {
  progress.delete(id)
}

/**
 * 下载单个文件，支持 Range 续传。
 */
async function downloadFile(url, dest, { minBytes = 0, onProgress, isCancelled } = {}) {
  const part = dest + '.part'
  let startByte = 0
  try {
    if (fs.existsSync(part)) startByte = fs.statSync(part).size
  } catch { startByte = 0 }

  const headers = {}
  if (startByte > 0) headers.Range = 'bytes=' + startByte + '-'

  let res
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(600000) })
  } catch (error) {
    return { ok: false, error: '连接失败：' + (error?.message ?? error) }
  }

  // 206 = 续传成功；200 = 服务器不支持 Range，从头下
  if (res.status !== 200 && res.status !== 206) {
    return { ok: false, error: 'HTTP ' + res.status }
  }
  if (res.status === 200 && startByte > 0) startByte = 0

  const total = Number(res.headers.get('content-length')) || 0
  let done = startByte

  try {
    const writeStream = fs.createWriteStream(part, startByte > 0 ? { flags: 'a' } : { flags: 'w' })
    const reader = res.body.getReader()

    for (;;) {
      if (isCancelled && isCancelled()) {
        try { writeStream.destroy() } catch { /* 忽略 */ }
        try { fs.unlinkSync(part) } catch { /* 忽略 */ }
        return { ok: false, error: '已取消下载' }
      }
      const { done: finished, value } = await reader.read()
      if (finished) break
      writeStream.write(Buffer.from(value))
      done += value.length
      if (onProgress) onProgress(done, total + startByte)
    }
    await new Promise((resolve, reject) => {
      writeStream.end((err) => (err ? reject(err) : resolve()))
    })
  } catch (error) {
    return { ok: false, error: '写入失败：' + (error?.message ?? error) }
  }

  // 校验大小，防止把错误页当权重存下来
  let size = 0
  try { size = fs.statSync(part).size } catch { size = 0 }
  if (minBytes > 0 && size < minBytes) {
    try { fs.unlinkSync(part) } catch { /* 忽略 */ }
    return { ok: false, error: '文件过小（' + size + ' < ' + minBytes + '），可能不是有效权重' }
  }

  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
    fs.renameSync(part, dest)
  } catch (error) {
    return { ok: false, error: '落盘失败：' + (error?.message ?? error) }
  }
  return { ok: true, size, bytes: size }
}

/**
 * 下载并安装模型。
 * @param {string} marketDir
 * @param {string} profilesRoot
 * @param {string} id
 */
export async function downloadModel(marketDir, profilesRoot, id) {
  const found = findModel(marketDir, id)
  if (!found.ok) return found
  const model = found.model
  if (!model.files.length) return { ok: false, error: '这个模型没有可下载的文件' }

  const dir = path.join(profilesRoot, id)
  const modelsDir = path.join(dir, 'models')
  try {
    fs.mkdirSync(modelsDir, { recursive: true })
  } catch (error) {
    return { ok: false, error: '创建目录失败：' + (error?.message ?? error) }
  }

  const total = model.files.length
  let done = 0
  setProgress(id, { done: 0, total, current: '准备中', error: '' })

  const saved = {}
  for (const f of model.files) {
    const kind = String(f.kind || 'file')
    const filename = String(f.filename || (kind + '.bin')).replace(/[^\w.-]/g, '_')
    const dest = path.join(modelsDir, filename)
    setProgress(id, { done, total, current: '下载 ' + kind })

    if (progress.get(id)?.cancelled) {
      setProgress(id, { error: '已取消下载' })
      return { ok: false, error: '已取消下载' }
    }
    const r = await downloadFile(String(f.url || ''), dest, {
      minBytes: Number(f.minBytes) || 0,
      isCancelled: () => progress.get(id)?.cancelled === true,
      onProgress: (d, t) => setProgress(id, { done, total, current: kind + ' ' + Math.round(d / 1048576) + 'MB' }),
    })
    if (!r.ok) {
      setProgress(id, { error: r.error })
      return { ok: false, error: kind + ' 下载失败：' + r.error }
    }
    saved[kind] = dest
    done += 1
    setProgress(id, { done, total, current: '已完成 ' + kind })
  }

  // 写 profile.json
  const profile = {
    id,
    name: model.name,
    description: model.description,
    builtin: false,
    assets: {},
    tts: {
      engine: model.engine === 'sapi' ? 'sapi' : 'gpt-sovits',
      baseUrl: model.ttsBaseUrl || 'http://127.0.0.1:9880',
      refAudio: saved.ref || '',
      promptText: model.promptText || '',
      promptLang: 'zh',
      textLang: 'zh',
    },
    svc: model.svc
      ? {
        baseUrl: model.svc.baseUrl || '',
        refAudio: model.svc.refAudio || '',
        backing: model.svc.backing || 'keep',
        steps: Number(model.svc.steps) || 30,
      }
      : { baseUrl: '', refAudio: '', backing: 'keep', steps: 30 },
    // 下载到的微调权重路径：预热/合成前会推给 GPT-SoVITS 加载（/set_*_weights）
    modelFiles: {
      gpt: saved.gpt || '',
      sovits: saved.sovits || '',
    },
  }

  try {
    fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile, null, 2), 'utf8')
  } catch (error) {
    return { ok: false, error: '写 profile.json 失败：' + (error?.message ?? error) }
  }

  setProgress(id, { done: total, total, current: '完成' })

  // 回写真实大小：把这次下载的文件总字节数记进市场清单，下次显示真实占用
  try {
    const manifestPath = path.join(marketDir, 'index.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    let realBytes = 0
    for (const kind of Object.keys(saved)) {
      try { realBytes += fs.statSync(saved[kind]).size } catch { /* 忽略 */ }
    }
    if (realBytes > 0) {
      const entry = (manifest.models || []).find((m) => m.id === id)
      if (entry) {
        entry.sizeBytes = realBytes
        entry.sizeMb = Math.round(realBytes / 1048576 * 10) / 10
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
      }
    }
  } catch { /* 回写失败不影响安装结果 */ }

  return { ok: true, id }
}

/**
 * 卸载模型：删整个角色目录。
 *
 * 安全约束：只允许删 profiles/ 的直接子目录，不接受路径穿越。
 */
export function uninstallModel(profilesRoot, id) {
  const clean = String(id || '').trim()
  if (!clean) return { ok: false, error: '缺少模型 id' }
  if (!/^[a-zA-Z0-9_-]+$/.test(clean)) return { ok: false, error: 'id 含非法字符' }
  if (clean === 'builtin') return { ok: false, error: '内置语音是系统角色，不能卸载' }

  const root = path.resolve(profilesRoot)
  const dir = path.resolve(path.join(profilesRoot, clean))
  // 必须正好是 profiles/ 的一级子目录
  if (path.dirname(dir) !== root) return { ok: false, error: '非法的模型路径' }
  if (!fs.existsSync(dir)) return { ok: false, error: '没有安装这个模型' }

  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return { ok: true, id: clean }
  } catch (error) {
    return { ok: false, error: '删除失败：' + (error?.message ?? error) }
  }
}
