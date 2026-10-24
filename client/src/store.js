/**
 * 全局状态。
 *
 * 只有一份可变对象，改动后调 emit() 触发订阅者重绘。
 * 页面各自用内容签名跳过无变化的重绘，避免轮询打断 hover。
 */

export const state = {
  // 会话
  configLoaded: false,
  profiles: [],
  profile: null,

  // 朗读
  enabled: true,
  autoSpeak: false,
  volume: 1,
  speed: 1,
  speaking: 0,
  synthesizing: false,
  lastError: '',

  // 服务
  tts: { url: '', up: false, warm: false, warming: false },
  svc: { url: '', up: false, warm: false, singing: false, warming: false, queueLen: 0 },
  gpu: null,

  // 唱歌
  songs: [],
  song: '',
  svcSteps: 30,
  backing: 'keep',
  vocalGain: 1,
  backingGain: 0.9,

  // 市场
  marketModels: [],
  marketNotice: '',
  marketError: '',
  profilesSize: '',
  profileErrors: [],
  marketDebug: '',
  marketLoaded: false,
  marketLoading: false,
  downloadingId: '',
  downloadProgress: null,
  refreshing: false,
  marketCat: '全部',

  // 外观
  theme: 'whale',
  accent: '',
  widgetSize: 104,
  widgetFlip: false,
  widgetVisible: true,
  glassBlur: 14,
  // 朗读采样参数（对所有 GPT-SoVITS 模型通用）
  temperature: 0.7,
  topK: 10,
  topP: 0.9,
  repetitionPenalty: 1.35,
  fragmentInterval: 0.4,
  // 空闲多久自动卸载模型释放显存（毫秒），0 = 从不
  idleUnloadMs: 300000,
  // 退出 DSH 时分别控制说话/唱歌模型，默认都开
  ttsUnloadOnExit: true,
  svcUnloadOnExit: true,
  svcEnabled: true,
  assetVersion: 0,
  wakeEnabled: true,

  // 界面
  tab: 'main',
  panelOpen: false,
}

const listeners = new Set()

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emit() {
  for (const fn of listeners) {
    try { fn() } catch { /* 单个订阅者出错不影响其他 */ }
  }
}
