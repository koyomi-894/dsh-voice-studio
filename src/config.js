/**
 * 配置与角色加载。
 *
 * 约束：
 *   · 配置必须落盘（user-config.json），只存内存重启就丢。
 *   · 用户配置优先级高于宿主传入的初始配置。
 *   · 资源文件按任意图片扩展名查找，只认 png/jpg 会导致「上传成功但看不到」。
 */

import fs from 'node:fs'
import path from 'node:path'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

export const DEFAULTS = {
  enabled: true,
  autoSpeak: false,
  volume: 1,
  speed: 1,
  profile: '',
  ttsUrl: 'http://127.0.0.1:9880',
  svcUrl: '',
  wakePort: 9881,
  wakeEnabled: true,
  idleUnloadMs: 5 * 60 * 1000,
  // 退出 DSH 时分别控制说话/唱歌模型是否卸载，默认都开
  ttsUnloadOnExit: true,
  svcUnloadOnExit: true,
  // 唱歌功能开关（默认开）
  svcEnabled: true,
  maxCharsPerTurn: 1200,
  segmentChars: 120,
  // 外观
  theme: 'whale',
  accent: '',
  widgetSize: 104,
  widgetFlip: false,
  widgetVisible: true,
  glassBlur: 14,
  // 唱歌参数
  svcSteps: 30,
  backing: 'keep',
  vocalGain: 1,
  backingGain: 0.9,
  // 朗读采样参数（对所有 GPT-SoVITS 模型通用）
  temperature: 0.7,
  topK: 10,
  topP: 0.9,
  repetitionPenalty: 1.35,
  fragmentInterval: 0.4,
  // 服务部署路径（自动拉起用；留空 = 不自动拉起，只探测已在跑的服务）
  pythonPath: '',
  ttsScript: '',
  ttsCwd: '',
  svcScript: '',
  svcCwd: '',
}

const asBool = (v, d) => (typeof v === 'boolean' ? v : d)
const asStr = (v, d) => (typeof v === 'string' ? v : d)
const asNum = (v, d, min, max) => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return d
  return Math.min(max, Math.max(min, n))
}

/** 归一化全局配置。 */
export function normalizeConfig(raw) {
  const i = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: asBool(i.enabled, DEFAULTS.enabled),
    autoSpeak: asBool(i.autoSpeak, DEFAULTS.autoSpeak),
    volume: asNum(i.volume, DEFAULTS.volume, 0, 1),
    speed: asNum(i.speed, DEFAULTS.speed, 0.5, 2),
    profile: asStr(i.profile, DEFAULTS.profile),
    ttsUrl: asStr(i.ttsUrl, DEFAULTS.ttsUrl),
    svcUrl: asStr(i.svcUrl, DEFAULTS.svcUrl),
    wakePort: Math.round(asNum(i.wakePort, DEFAULTS.wakePort, 0, 65535)),
    wakeEnabled: asBool(i.wakeEnabled, DEFAULTS.wakeEnabled),
    idleUnloadMs: Math.round(asNum(i.idleUnloadMs, DEFAULTS.idleUnloadMs, 0, 30 * 60 * 1000)),
    maxCharsPerTurn: Math.round(asNum(i.maxCharsPerTurn, DEFAULTS.maxCharsPerTurn, 100, 8000)),
    segmentChars: Math.round(asNum(i.segmentChars, DEFAULTS.segmentChars, 40, 500)),
    theme: asStr(i.theme, DEFAULTS.theme),
    accent: asStr(i.accent, DEFAULTS.accent),
    widgetSize: Math.round(asNum(i.widgetSize, DEFAULTS.widgetSize, 64, 240)),
    widgetFlip: asBool(i.widgetFlip, DEFAULTS.widgetFlip),
    widgetVisible: asBool(i.widgetVisible, DEFAULTS.widgetVisible),
    glassBlur: Math.round(asNum(i.glassBlur, DEFAULTS.glassBlur, 0, 40)),
    // 唱歌参数：不写进 schema 的话存了也会被丢弃，重启必重置
    svcSteps: Math.round(asNum(i.svcSteps, DEFAULTS.svcSteps, 10, 60)),
    backing: ['keep', 'remove'].includes(i.backing) ? i.backing : DEFAULTS.backing,
    vocalGain: asNum(i.vocalGain, DEFAULTS.vocalGain, 0, 1.5),
    backingGain: asNum(i.backingGain, DEFAULTS.backingGain, 0, 1.5),
    // 朗读采样参数
    temperature: asNum(i.temperature, DEFAULTS.temperature, 0.05, 2),
    topK: Math.round(asNum(i.topK, DEFAULTS.topK, 1, 30)),
    topP: asNum(i.topP, DEFAULTS.topP, 0.1, 1),
    repetitionPenalty: asNum(i.repetitionPenalty, DEFAULTS.repetitionPenalty, 0.5, 2),
    fragmentInterval: asNum(i.fragmentInterval, DEFAULTS.fragmentInterval, 0, 2),
    ttsUnloadOnExit: asBool(i.ttsUnloadOnExit, DEFAULTS.ttsUnloadOnExit),
    svcUnloadOnExit: asBool(i.svcUnloadOnExit, DEFAULTS.svcUnloadOnExit),
    svcEnabled: asBool(i.svcEnabled, DEFAULTS.svcEnabled),
    // 服务部署路径
    pythonPath: asStr(i.pythonPath, DEFAULTS.pythonPath),
    ttsScript: asStr(i.ttsScript, DEFAULTS.ttsScript),
    ttsCwd: asStr(i.ttsCwd, DEFAULTS.ttsCwd),
    svcScript: asStr(i.svcScript, DEFAULTS.svcScript),
    svcCwd: asStr(i.svcCwd, DEFAULTS.svcCwd),
  }
}

/**
 * 读用户配置文件。启动时用它覆盖宿主传入的初始配置。
 */
export function loadUserConfig(file) {
  try {
    if (!fs.existsSync(file)) return {}
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data !== null && typeof data === 'object' ? data : {}
  } catch { return {} }
}

export function saveUserConfig(file, cfg) {
  try {
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8')
    return true
  } catch { return false }
}

/** 在目录里找某类图片（任意扩展名）。 */
function pickAssetAny(assetDir, basename) {
  for (const ext of IMAGE_EXTS) {
    const cand = path.join(assetDir, basename + '.' + ext)
    try { if (fs.existsSync(cand)) return cand } catch { /* 忽略 */ }
  }
  return ''
}

/**
 * 加载单个角色目录。
 * @returns {{ok:true, profile:object} | {ok:false, errors:string[]}}
 */
export function loadProfileDir(dir) {
  const manifest = path.join(dir, 'profile.json')
  if (!fs.existsSync(manifest)) {
    return { ok: false, errors: ['缺少 profile.json：' + dir] }
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  } catch (error) {
    return { ok: false, errors: ['profile.json 解析失败：' + (error?.message ?? error)] }
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, errors: ['profile.json 不是对象'] }
  }

  const id = String(raw.id || path.basename(dir)).replace(/[^a-zA-Z0-9_-]/g, '')
  if (!id) return { ok: false, errors: ['角色 id 非法'] }

  const assetDir = path.join(dir, 'assets')

  return {
    ok: true,
    profile: {
      id,
      name: asStr(raw.name, id),
      description: asStr(raw.description, ''),
      dir,
      background: asStr(raw.assets?.background, '') || pickAssetAny(assetDir, 'background'),
      icon: asStr(raw.assets?.icon, '') || pickAssetAny(assetDir, 'icon'),
      tts: {
        engine: raw.tts?.engine === 'sapi' ? 'sapi' : 'gpt-sovits',
        baseUrl: asStr(raw.tts?.baseUrl, ''),
        refAudio: asStr(raw.tts?.refAudio, ''),
        promptText: asStr(raw.tts?.promptText, ''),
        promptLang: asStr(raw.tts?.promptLang, 'zh'),
        textLang: asStr(raw.tts?.textLang, 'zh'),
      },
      svc: {
        baseUrl: asStr(raw.svc?.baseUrl, ''),
        refAudio: asStr(raw.svc?.refAudio, ''),
        backing: asStr(raw.svc?.backing, 'keep'),
        steps: Math.round(asNum(raw.svc?.steps, 30, 10, 60)),
      },
      // 微调权重：配置了才会在预热/合成前推给 GPT-SoVITS 加载（/set_*_weights）
      modelFiles: {
        gpt: asStr(raw.modelFiles?.gpt, ''),
        sovits: asStr(raw.modelFiles?.sovits, ''),
      },
      builtin: raw.builtin === true,
    },
  }
}

/** 扫描 profiles 目录下所有角色。 */
export function scanProfiles(profilesRoot) {
  const profiles = []
  const errors = []
  let names = []
  try {
    names = fs.readdirSync(profilesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch { return { profiles, errors } }

  for (const name of names.sort()) {
    // 模板目录跳过：它只是给用户复制用的示例，不是真实角色
    if (name.startsWith('_')) continue
    const r = loadProfileDir(path.join(profilesRoot, name))
    // 不适配的目录静默跳过：用户可能在 profiles/ 里放了别的东西，
    // 不该拿错误刷屏，只显示能用得上的模型。
    if (r.ok) profiles.push(r.profile)
  }
  return { profiles, errors: [] }
}

/** 合成「全局配置 + 角色」的实际生效配置。 */
export function resolveEffective(globalCfg, profile) {
  if (!profile) {
    return { ...globalCfg, profile: null, ttsUrl: globalCfg.ttsUrl, svcUrl: globalCfg.svcUrl }
  }
  // 前端要读 profile.engine 判断是否内置语音，所以这里补一个扁平字段。
  // 只靠 profile.tts.engine 的话，前后端各自拼的结构不一致，会判成 gpt-sovits。
  return {
    ...globalCfg,
    profile: {
      ...profile,
      engine: profile.tts.engine,
    },
    ttsUrl: profile.tts.baseUrl || globalCfg.ttsUrl,
    // 唱歌功能关掉时，svcUrl 置空，所有唱歌接口都会看到「未配置」
    svcUrl: globalCfg.svcEnabled === false ? '' : (profile.svc.baseUrl || globalCfg.svcUrl),
  }
}
