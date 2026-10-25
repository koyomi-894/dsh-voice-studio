/**
 * 前端入口。
 *
 * 约定（对应踩过的坑）：
 *   · 挂件用 Shadow DOM 隔离样式，:host 是唯一定位宿主的入口
 *   · 面板/菜单挂 body，样式额外注入到 document.head
 *   · 三段 transform 分层：翻转 / 抖动 / 缩放互不覆盖
 *   · 状态轮询靠内容签名跳过无变化重绘，避免打断 hover
 */

import { api, logEvent } from './src/api.js'
import { el } from './src/dom.js'
import { state, emit, subscribe } from './src/store.js'
import { createPlayer } from './src/player.js'
import { createSpeakPage } from './src/pages/speak.js'
import { createSingPage } from './src/pages/sing.js'
import { createMarketPage } from './src/pages/market.js'
import { createLookPage, THEMES } from './src/pages/look.js'
import { closeAllDropdowns } from './src/dropdown.js'

const ROUTE = '/voice-studio'
const ROUTE_ASSET = ROUTE
const POS_KEY = 'dsh-voice-studio-plugin-pos'
const SNAP_PX = 24
const POLL_MS = 1500

const TABS = [
  { id: 'main', label: '说话' },
  { id: 'sing', label: '唱歌' },
  { id: 'market', label: '模型' },
  { id: 'look', label: '外观' },
]

function boot() {
  if (window.__DSH_VOICE_STUDIO__) return
  window.__DSH_VOICE_STUDIO__ = {}

  // 未捕获异常上报到后端日志：Electron 里前端 console 外部不可见
  window.addEventListener('error', (e) => {
    logEvent('未捕获异常: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0), 'error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    logEvent('未处理的 Promise 拒绝: ' + (r && r.message ? r.message : String(r)), 'error')
  })

  const player = createPlayer()

  /**
   * 由小喇叭按钮调用：朗读指定消息。
   * 统一从这里走后端，主脚本才能同步 warming / speaking / messageId，
   * 面板的灰色闪烁提示和喇叭→方块的切换才有数据来源。
   */
  async function speakMessage(text, messageId) {
    if (!text) return { ok: false, error: '没有可朗读的文本' }
    // 面板模型预热开关显示灰色闪烁
    state.tts.warming = true
    emit()
    // 喇叭点起的预热也弹云朵冒泡：加载中全程挂，完成/失败再替换
    showBubble('warm', '说话模型加载中，详见面板', false)
    try {
      const r = await api.speak(text)
      if (!r || !r.ok) {
        // 失败：替换成错误冒泡（2 秒关）
        showBubble('error', '朗读失败，详见面板')
        return r || { ok: false, error: '朗读请求失败' }
      }
      // 成功：替换成完成冒泡（2 秒自动关）
      showBubble('warm', '说话模型已就绪，详见面板')
      // 进入队列，轮询到音频后 tick() 会沿用这个 messageId 显示方块
      return { ok: true }
    } finally {
      state.tts.warming = false
      emit()
    }
  }

  // 把 speak 挂到全局，小喇叭按钮通过它与主脚本通信
  window.__DSH_VOICE_STUDIO__.speak = speakMessage

  // ── 构建 DOM ────────────────────────────────────────────────────────
  const host = el('div', { class: 'vs-host' })
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('link')
  style.rel = 'stylesheet'
  style.href = ROUTE + '/panel.css?v=' + Date.now()
  shadow.appendChild(style)

  const wrap = el('div', { class: 'vs-wrap' })

  // 立绘按钮
  const btn = el('button', {
    class: 'vs-widget',
    type: 'button',
    draggable: 'false',
    'aria-label': '语音助手',
  })
  // ── 立绘动图 ─────────────────────────────────────────────────────
  // 待机：从 14 个 idle 里随机挑一个循环播放
  // 说话：切换到 voice 动图，说完切回
  // ── 立绘冒泡 ─────────────────────────────────────────────────────
  // 白色云朵形状，和 dsh-whale-widget 的经典云朵同一套几何（FRAME_CLASSIC_BIG_D）。
  // 云朵用 SVG path 画，文字居中放里面。
  // 椭圆冒泡：简洁。190×130，细蓝圈
  const bubble = el('div', { class: 'vs-bubble', 'data-role': 'bubble' }, [
    el('svg', { class: 'vs-bubble__svg', viewBox: '0 0 190 130', 'aria-hidden': 'true' }, [
      el('ellipse', {
        class: 'vs-bubble__shape',
        cx: '95',
        cy: '65',
        rx: '90',
        ry: '55',
        fill: '#FFFFFF',
        stroke: '#203170',
        'stroke-opacity': '0.5',
        'stroke-width': '2.5',
      }),
    ]),
    el('div', { class: 'vs-bubble__text' }),
  ])
  let bubbleTimer = null
  let bubbleKey = null

  /**
   * 弹云朵冒泡：
   *   kind = 'error' → 报错，6 秒自动关闭
   *   kind = 'warm'  → 预热中/完成，3 秒自动关闭
   */
  /**
   * 弹云朵冒泡。
   *   autoClose = true（默认）→ 2 秒后自动关闭（完成/错误）
   *   autoClose = false        → 一直挂着（加载中），等后续调用覆盖或关闭
   */
  function showBubble(kind, text, autoClose) {
    if (!text) return
    clearTimeout(bubbleTimer)
    bubbleTimer = null
    bubbleKey = kind
    bubble.className = 'vs-bubble is-open is-' + kind
    bubble.querySelector('.vs-bubble__text').textContent = text
    wrap.appendChild(bubble)
    positionBubble()
    if (autoClose !== false) {
      bubbleTimer = setTimeout(hideBubble, 2000)
    }
  }

  function hideBubble() {
    clearTimeout(bubbleTimer)
    bubbleTimer = null
    bubbleKey = null
    bubble.className = 'vs-bubble'
    try { if (bubble.parentNode) bubble.parentNode.removeChild(bubble) } catch { /* 忽略 */ }
  }

  const mood = {
    loaded: false,
    list: [],          // { key, name, tag }
    idle: [],
    voice: [],
    curIdle: null,
    curVoice: null,
    playingVoice: false,
    switchTimer: null,     // 说话→待机 的兜底定时器
    rotateTimer: null,     // 待机随机轮换定时器
    lastProfileId: null,   // 用于检测「换了声音模型」
    preloaded: {},         // 已预加载的动图 key
  }

  // 随机轮换间隔：5 分钟 ~ 30 分钟
  const ROTATE_MIN_MS = 5 * 60 * 1000
  const ROTATE_MAX_MS = 30 * 60 * 1000

  /** 生成下一次轮换的随机延迟。 */
  function nextRotateDelay() {
    return ROTATE_MIN_MS + Math.floor(Math.random() * (ROTATE_MAX_MS - ROTATE_MIN_MS))
  }

  /** 随机挑一个和当前不同的 idle，避免连续重复。 */
  function pickIdle() {
    const pool = mood.idle.filter((m) => m.key !== mood.curIdle)
    const src = pool.length ? pool : mood.idle
    if (!src.length) return null
    return src[Math.floor(Math.random() * src.length)]
  }

  /** 预加载一张动图，避免切图时闪白。 */
  function preload(key) {
    if (!key || mood.preloaded[key]) return
    mood.preloaded[key] = true
    try { const im = new Image(); im.src = api.moodUrl(key, state.assetVersion || 0) } catch { /* 忽略 */ }
  }

  /** 把某个动图应用到立绘上。key 为空则回退到角色静态图。 */
  function applyMood(key, ver) {
    if (!key) {
      const pid = state.profile ? state.profile.id : '_'
      const v = pid + '-' + (state.assetVersion || 0)
      btn.style.backgroundImage = 'url("' + api.assetUrl('icon', v) + '")'
      return
    }
    btn.style.backgroundImage = 'url("' + api.moodUrl(key, ver) + '")'
  }

  /** 排下一次待机轮换（5~30 分钟随机）。立绘隐藏时不排，省流量。 */
  function scheduleRotate() {
    clearTimeout(mood.rotateTimer)
    mood.rotateTimer = null
    if (state.widgetVisible === false) return
    mood.rotateTimer = setTimeout(() => {
      if (state.widgetVisible === false) return
      // 说话中就先跳过，等说完再重新排
      if (mood.playingVoice) {
        scheduleRotate()
        return
      }
      rollIdle(true)
    }, nextRotateDelay())
  }

  /** 换一张待机图。说话期间不换；换完自动排下一次轮换。 */
  function rollIdle(force) {
    if (mood.playingVoice && !force) return
    const m = pickIdle()
    if (!m) return
    mood.curIdle = m.key
    applyMood(m.key, state.assetVersion || 0)
    // 顺手预加载下一张，切图时不闪
    const next = pickIdle()
    if (next) preload(next.key)
    scheduleRotate()
  }

  /**
   * 开始播放某个 voice 动图。
   * voice 动图本身只有 0.5~1.6 秒，说话几秒会重复播很多轮；
   * 用 CSS animation-duration 配合 timeScale 放慢，让它看起来像「持续说话」。
   */
  function playVoiceMood() {
    if (!mood.voice.length) return
    if (mood.playingVoice) return   // 已在播，别打断
    const m = mood.voice[Math.floor(Math.random() * mood.voice.length)]
    mood.curVoice = m.key
    mood.playingVoice = true
    preload(m.key)
    applyMood(m.key, state.assetVersion || 0)
    // 兜底：即使 state.speaking 异常，最多 30 秒后回待机
    clearTimeout(mood.switchTimer)
    mood.switchTimer = setTimeout(() => { stopVoiceMood() }, 30000)
  }

  /** 结束说话图，回到待机。 */
  function stopVoiceMood() {
    if (!mood.playingVoice) return
    mood.playingVoice = false
    mood.curVoice = null
    clearTimeout(mood.switchTimer)
    mood.switchTimer = null
    rollIdle(true)
  }

  /** 拉取立绘素材清单。失败就继续用静态图。 */
  async function loadMoods() {
    if (mood.loaded) return
    try {
      const r = await api.moods()
      const list = (r && r.moods) || []
      if (!Array.isArray(list) || !list.length) return
      mood.list = list
      mood.idle = list.filter((m) => m.tag === 'idle')
      mood.voice = list.filter((m) => m.tag === 'voice')
      mood.loaded = true
      mood.lastProfileId = state.profile ? state.profile.id : null
      logEvent('立绘素材加载: idle=' + mood.idle.length + ' voice=' + mood.voice.length)
      // 每次启动 DSH 都换一张（不沿用上次）
      rollIdle(true)
    } catch (e) {
      logEvent('立绘素材加载失败: ' + (e && e.message ? e.message : String(e)), 'warn')
    }
  }

  // 三段 transform 分层：翻转 → 抖动 → 缩放
  const shakebox = el('div', { class: 'vs-shakebox' }, btn)
  const flip = el('div', { class: 'vs-flip' }, shakebox)

  // 面板
  const titleEl = el('div', { class: 'vs-title' })
  const subEl = el('div', { class: 'vs-sub' })
  const vramEl = el('div', { class: 'vs-vram' })
  const tabBar = el('div', { class: 'vs-tabs' })
  const body = el('div', { class: 'vs-body' })

  const head = el('div', { class: 'vs-head' }, [
    el('div', { class: 'vs-head__text' }, [titleEl, subEl]),
    el('button', {
      class: 'vs-reload', type: 'button', text: '重载脚本',
      onclick: () => { window.location.reload() },
    }),
  ])

  const panel = el('div', { class: 'vs-panel' }, [head, vramEl, tabBar, body])
  wrap.appendChild(panel)
  wrap.appendChild(flip)
  shadow.appendChild(wrap)

  // ── 页面实例 ────────────────────────────────────────────────────────
  let currentTab = null
  let appearanceTimer = null
  let lastTabSig = ''
  let lockPanel = null
  let noticeTimer = null

  /** 页面内联提示 + 立绘冒泡（报错 / 预热）。 */
  function showNotice(msg, kind) {
    try {
      if (msg) {
        if (pages.main && pages.main.setError) pages.main.setError(msg)
        else state.lastError = msg
        if (kind === 'error' || kind === 'warm') showBubble(kind, msg)
      } else {
        if (pages.main && pages.main.setError) pages.main.setError('')
        state.lastError = ''
        hideBubble()
      }
      emit()
    } catch { /* 忽略 */ }
  }

  async function refreshStatus() {
    const r = await api.status()
    if (!r || r.ok === false) return
    state.enabled = Boolean(r.enabled)
    state.autoSpeak = Boolean(r.autoSpeak)
    state.widgetVisible = typeof r.widgetVisible === 'boolean' ? r.widgetVisible : state.widgetVisible
    state.wakeEnabled = typeof r.wakeEnabled === 'boolean' ? r.wakeEnabled : state.wakeEnabled
    state.volume = Number(r.volume) || 0
    state.speed = Number(r.speed) || 1
    state.synthesizing = Boolean(r.synthesizing)
    state.svc.singing = Boolean(r.svc?.singing)
    state.svc.queueLen = Number(r.svc?.queueLen) || 0
    state.tts.up = Boolean(r.tts?.up)
    state.tts.warm = Boolean(r.tts?.warm)
    state.svc.up = Boolean(r.svc?.up)
    state.svc.warm = Boolean(r.svc?.warm)
    state.svc.url = r.svc?.url || ''
    state.tts.url = r.tts?.url || ''
    state.gpu = r.gpu || null
    state.profile = r.profile || state.profile
    emit()
  }

  async function loadConfig() {
    const r = await api.config()
    if (!r || r.ok === false) return
    state.profiles = r.profiles || []
    state.profileErrors = r.profileErrors || []
    if (r.config) {
      state.enabled = Boolean(r.config.enabled)
      state.autoSpeak = Boolean(r.config.autoSpeak)
      state.volume = typeof r.config.volume === 'number' ? r.config.volume : 1
      state.speed = typeof r.config.speed === 'number' ? r.config.speed : 1
      if (typeof r.config.theme === 'string' && r.config.theme) state.theme = r.config.theme
      if (typeof r.config.accent === 'string') state.accent = r.config.accent
      if (typeof r.config.widgetSize === 'number') state.widgetSize = r.config.widgetSize
      if (typeof r.config.widgetFlip === 'boolean') state.widgetFlip = r.config.widgetFlip
      if (typeof r.config.widgetVisible === 'boolean') state.widgetVisible = r.config.widgetVisible
      if (typeof r.config.wakeEnabled === 'boolean') state.wakeEnabled = r.config.wakeEnabled
      if (typeof r.config.glassBlur === 'number') state.glassBlur = r.config.glassBlur
      // 唱歌参数也要恢复，否则调好的步数/音量重启就没了
      if (typeof r.config.svcSteps === 'number') state.svcSteps = r.config.svcSteps
      if (typeof r.config.backing === 'string') state.backing = r.config.backing
      if (typeof r.config.vocalGain === 'number') state.vocalGain = r.config.vocalGain
      if (typeof r.config.backingGain === 'number') state.backingGain = r.config.backingGain
      // 朗读采样参数 + 闲置冷却
      if (typeof r.config.temperature === 'number') state.temperature = r.config.temperature
      if (typeof r.config.topK === 'number') state.topK = r.config.topK
      if (typeof r.config.topP === 'number') state.topP = r.config.topP
      if (typeof r.config.repetitionPenalty === 'number') state.repetitionPenalty = r.config.repetitionPenalty
      if (typeof r.config.fragmentInterval === 'number') state.fragmentInterval = r.config.fragmentInterval
      if (typeof r.config.idleUnloadMs === 'number') state.idleUnloadMs = r.config.idleUnloadMs
      if (typeof r.config.ttsUnloadOnExit === 'boolean') state.ttsUnloadOnExit = r.config.ttsUnloadOnExit
      if (typeof r.config.svcUnloadOnExit === 'boolean') state.svcUnloadOnExit = r.config.svcUnloadOnExit
      if (typeof r.config.svcEnabled === 'boolean') state.svcEnabled = r.config.svcEnabled
    }
    const prevProfileId = state.profile ? state.profile.id : null
    state.profile = r.effective && r.effective.profile ? r.effective.profile : null
    // 换了声音模型 → 换一张立绘
    const nextProfileId = state.profile ? state.profile.id : null
    if (nextProfileId !== prevProfileId && mood.loaded && nextProfileId !== mood.lastProfileId) {
      mood.lastProfileId = nextProfileId
      rollIdle(true)
    } else if (nextProfileId !== mood.lastProfileId) {
      mood.lastProfileId = nextProfileId
    }
    if (r.effective) {
      state.tts.url = r.effective.ttsUrl || ''
      state.svc.url = r.effective.svcUrl || ''
    }
    state.configLoaded = true
    lastTabSig = ''
    emit()
    // 配置到了才拿到 svc.url —— 如果用户已经停在唱歌页，
    // 之前那次 loadSongs 会因 url 为空而白跑，这里补一次。
    if (state.tab === 'sing' && !state.songs.length) void loadSongs()
  }

  async function loadSongs() {
    if (!state.svc.url) {
      // 未配置唱歌服务：清空歌曲列表，避免残留旧角色的歌
      state.songs = []
      emit()
      return
    }
    const r = await api.songs()
    if (r && r.ok) {
      state.songs = r.songs || []
      // 之前选中的歌可能已被删除/改名：回落到第一首，避免下拉框停在失效值上
      if (state.songs.length && !state.songs.includes(state.song)) state.song = state.songs[0]
      if (!state.songs.length) state.song = ''
      state.lastError = ''
    } else {
      // 服务离线/未启动时给个友好提示，用户才知道为什么列表是空的
      state.songs = []
      state.lastError = (r && r.error) === 'fetch failed'
        ? '唱歌服务没在运行，点「模型预载」会自动拉起'
        : ((r && r.error) || '歌曲库加载失败')
    }
  }

  async function loadMarket() {
    if (state.marketLoading) return
    state.marketLoading = true
    try {
      const r = await api.market()
      if (r && r.ok) {
        // 内置语音置顶由渲染层处理，这里保持原始顺序
        state.marketModels = r.models || []
        state.marketNotice = r.notice || ''
        state.marketError = ''
        state.profilesSize = r.profilesSize || ''
      } else {
        state.marketError = (r && r.error) || '市场加载失败'
      }
    } finally {
      state.marketLoading = false
      state.marketLoaded = true
      emit()
    }
  }

  async function refreshAll() {
    state.refreshing = true
    state.marketLoaded = false
    emit()
    await Promise.all([loadMarket(), loadConfig()])
    setTimeout(() => {
      state.refreshing = false
      emit()
    }, 500)
  }

  // ── 页面 ────────────────────────────────────────────────────────────
  const pages = {
    main: createSpeakPage({
      onSayTest: async () => {
        player.unlock()
        // 说一句试试也可能触发拉起预热，给开关一样的启动中反馈
        if (!state.tts.warm && state.profile && state.profile.engine !== 'sapi') {
          state.tts.warming = true
          emit()
        }
        if (state.tts.warming) {
          pages.main.setError('正在加载语音模型，第一次要几十秒，请稍候…')
          emit()
        }
        const r = await api.speak('你好，我是你的语音助手，现在可以说话了。')
        if (state.tts.warming) {
          state.tts.warming = false
          emit()
        }
        if (r && r.ok === false) {
          pages.main.setError(r.error || '朗读失败')
        } else if (r && r.ok) {
          pages.main.setError('')
        }
      },
      onReplay: async () => {
        player.unlock()
        if (!state.tts.warm && state.profile && state.profile.engine !== 'sapi') {
          state.tts.warming = true
          pages.main.setError('正在加载语音模型，第一次要几十秒，请稍候…')
          emit()
        }
        const r = await api.speak('')
        if (state.tts.warming) {
          state.tts.warming = false
          emit()
        }
        if (r && r.ok === false) {
          pages.main.setError(r.error || '重读失败')
        } else if (r && r.ok) {
          pages.main.setError('')
        } else {
          pages.main.setError('重读请求失败')
        }
        // 没成功时给状态行一个明确失败态（红字），否则容易被忽略
        if (pages.main && pages.main.setFailed) pages.main.setFailed(r && r.ok === false)
        emit()
      },
      onStop: async () => {
        player.stop()
        await api.clear()
        state.speaking = 0
        emit()
      },
      onProbe: async () => {
        const r = await api.probe()
        if (!r || r.ok === false) { showNotice('检测失败，详见面板', 'error'); return }
        state.lastError = ''
        showNotice('系统语音 ' + (r.sapi?.ok ? '可用' : '不可用')
          + ' · 语音服务 ' + (r.tts ? (r.tts.ok ? '在线' : '离线') : '未配置')
          + ' · 唱歌服务 ' + (r.svc ? (r.svc.ok ? '在线' : '离线') : '未配置'))
      },
      onRefresh: async () => {
        state.tts.warming = true
        emit()
        // 预热中：冒泡挂着，告诉用户模型在加载
        showBubble('warm', '说话模型加载中，详见面板', false)
        const r = await api.ttsWarm()
        state.tts.warming = false
        if (!r || !r.ok) {
          showNotice('预热失败，详见面板', 'error')
          return
        }
        state.lastError = ''
        showNotice('说话模型已就绪，详见面板', 'warm')
        await refreshStatus()
      },
    }),
    sing: createSingPage({
      onSing: async () => {
        if (!state.song) return
        const r = await api.sing({
          source: state.song,
          steps: state.svcSteps,
          backing: state.backing,
          vocalGain: state.vocalGain,
          backingGain: state.backingGain,
        })
        if (!r || !r.ok) { showNotice('转换失败，详见面板', 'error'); return }
        showNotice('转换完成，详见面板')
      },
      onWarmToggle: async () => {
        state.svc.warming = true
        emit()
        // 预热中：冒泡挂着
        showBubble('warm', '唱歌模型加载中，详见面板', false)
        const r = await api.svcToggle()
        state.svc.warming = false
        if (!r || !r.ok) {
          showNotice('唱歌预热失败，详见面板', 'error')
          return
        }
        showNotice('唱歌模型已就绪，详见面板', 'warm')
        await refreshStatus()
      },
      onOpenFolder: () => { void api.openFolder('songs') },
    }),
    market: createMarketPage({ onRefresh: refreshAll }),
    look: createLookPage({
      onAppearanceChange: () => {
        applyAppearance()
        if (appearanceTimer) clearTimeout(appearanceTimer)
        appearanceTimer = setTimeout(() => {
          void api.saveConfig({
            theme: state.theme,
            accent: state.accent,
            widgetSize: state.widgetSize,
            widgetFlip: state.widgetFlip,
            widgetVisible: state.widgetVisible,
            glassBlur: state.glassBlur,
          })
        }, 400)
      },
    }),
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  function currentTheme() {
    const t = THEMES[state.theme] || THEMES.whale
    return state.accent ? { ...t, accent: state.accent } : t
  }

  let lastLoggedSize = -1

  function applyAppearance() {
    const t = currentTheme()
    // 立绘形态：none=隐藏；mini=小按钮；full=完整立绘。
    // widgetVisible 为 false 时强制隐藏（旧开关兼容）。
    // 立绘只贴边：visible=false 隐藏，否则正常显示（不再有 mini 模式）
    host.style.display = state.widgetVisible === false ? 'none' : 'block'
    host.classList.remove('is-mini')
    wrap.classList.remove('is-mini')
    wrap.style.setProperty('--accent', t.accent)
    wrap.style.setProperty('--bg', t.bg)
    wrap.style.setProperty('--title', t.title)
    wrap.style.setProperty('--sub', t.sub)
    wrap.style.setProperty('--size', state.widgetSize + 'px')
    wrap.style.setProperty('--flip', state.widgetFlip ? '-1' : '1')
    wrap.style.setProperty('--glass', state.glassBlur + 'px')
    panel.classList.toggle('is-solid', !state.glassBlur)

    // 尺寸变化时保持贴边侧锚定，避免立绘向右下扩张导致面板位移
    const prevW = host.offsetWidth
    const prevH = host.offsetHeight
    const next = state.widgetSize
    if (prevW && prevH && (prevW !== next || prevH !== next)) {
      const r = host.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const maxL = Math.max(0, vw - prevW)
      const maxT = Math.max(0, vh - prevH)
      // 先判断当前贴在哪条边，尺寸变化后仍贴同一条边
      const dockLeft = r.left <= 1
      const dockRight = r.left >= maxL - 1
      const dockTop = r.top <= 1
      const dockBottom = r.top >= maxT - 1

      host.style.width = next + 'px'
      host.style.height = next + 'px'

      const maxLeft = Math.max(0, vw - next)
      const maxTop = Math.max(0, vh - next)
      let left
      if (dockLeft) left = 0
      else if (dockRight) left = maxLeft
      else {
        // 未贴边：按中心点缩放，保持视觉位置
        const cx = r.left + prevW / 2
        left = Math.max(0, Math.min(cx - next / 2, maxLeft))
      }
      let top
      if (dockTop) top = 0
      else if (dockBottom) top = maxTop
      else {
        const cy = r.top + prevH / 2
        top = Math.max(0, Math.min(cy - next / 2, maxTop))
      }
      setPos(left, top)
    } else {
      host.style.width = next + 'px'
      host.style.height = next + 'px'
    }

    // 图片 URL 带版本号，换图后不会命中旧缓存
    const pid = state.profile ? state.profile.id : '_'
    const ver = pid + '-' + (state.assetVersion || 0)
    // 立绘优先用动图素材；没有素材才回退到角色静态图
    if (mood.loaded) {
      const hasImg = btn.style.backgroundImage && btn.style.backgroundImage !== 'none'
      if (!hasImg) rollIdle(true)
    } else {
      btn.style.backgroundImage = 'url("' + api.assetUrl('icon', ver) + '")'
    }
    panel.style.backgroundImage = 'url("' + api.assetUrl('background', ver) + '")'

    if (lastLoggedSize !== state.widgetSize) {
      lastLoggedSize = state.widgetSize
      logEvent('立绘大小生效: ' + state.widgetSize + 'px')
    }
  }

  function renderVram() {
    const g = state.gpu
    if (!g || !g.total) { vramEl.replaceChildren(); return }
    const total = Number(g.total) || 1
    const pct = (v) => Math.min(100, ((Number(v) || 0) / total) * 100).toFixed(2) + '%'

    vramEl.replaceChildren(
      el('div', { class: 'vs-vram__head' }, [
        el('span', { text: '显存占用' }),
        el('b', { text: (g.usedText || '') + ' / ' + (g.totalText || '') }),
      ]),
      el('div', { class: 'vs-vram__bar' }, [
        Number(g.tts) > 0 ? el('i', { class: 'is-tts', style: { width: pct(g.tts) } }) : null,
        Number(g.svc) > 0 ? el('i', { class: 'is-svc', style: { width: pct(g.svc) } }) : null,
        el('i', { class: 'is-other', style: { width: pct(g.other) } }),
      ]),
      el('div', { class: 'vs-vram__legend' }, [
        el('span', {}, [el('em', { class: 'is-tts' }), '说话 ' + (g.ttsText || '0')]),
        el('span', {}, [el('em', { class: 'is-svc' }), '唱歌 ' + (g.svcText || '0')]),
        el('span', {}, [el('em', { class: 'is-other' }), '其他 ' + (g.otherText || '')]),
      ]),
    )
  }

  function renderTabs() {
    if (lastTabSig === state.tab) return
    lastTabSig = state.tab
    tabBar.replaceChildren(...TABS.map((t) => el('button', {
      class: 'vs-tab' + (state.tab === t.id ? ' is-active' : ''),
      type: 'button',
      text: t.label,
      'data-tab': t.id,
    })))
  }

  function renderBody() {
    const tabChanged = currentTab !== state.tab
    if (tabChanged) {
      closeAllDropdowns()
      currentTab = state.tab
      body.replaceChildren(pages[state.tab].root)
    }
    pages[state.tab].render()

    // 数据按需加载：不依赖点击事件，避免回调被打断
    if (state.tab === 'market' && !state.marketLoaded) void loadMarket()
    // 唱歌页：列表为空要拉；切回该页也要重拉 —— 用户多半是切出去往 songs/
    // 里丢了新歌再切回来，只在「空」时拉的话永远看不到新放进去的歌。
    if (state.tab === 'sing' && (tabChanged || !state.songs.length)) void loadSongs()
  }

  function positionPanel() {
    // 冒泡始终跟着立绘走（与面板开关无关）
    positionBubble()
    if (!state.panelOpen) return
    if (lockPanel) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const r = host.getBoundingClientRect()
    const size = r.width || state.widgetSize
    const below = r.top < vh / 2
    panel.classList.toggle('is-below', below)

    // 立绘在左半边 → 面板从立绘右侧伸出；在右半边 → 面板从立绘左侧伸出
    const onLeft = r.left + size / 2 < vw / 2
    const gap = 12
    const maxW = Math.min(272, vw - 16)
    panel.style.width = maxW + 'px'
    if (onLeft) {
      panel.style.left = Math.round(Math.min(r.left + size + gap, vw - maxW - 8)) + 'px'
      panel.style.right = 'auto'
    } else {
      panel.style.right = Math.round(Math.min(vw - r.left + gap, vw - 8)) + 'px'
      panel.style.left = 'auto'
    }
    if (below) {
      panel.style.top = Math.round(Math.min(r.top + size + gap, vh - 16)) + 'px'
      panel.style.bottom = 'auto'
    } else {
      panel.style.bottom = Math.round(Math.min(vh - r.top + gap, vh - 8)) + 'px'
      panel.style.top = 'auto'
    }
  }

  function render() {
    const p = state.profile
    titleEl.textContent = p ? p.name : '未安装模型'
    subEl.textContent = p ? (p.description || '语音合成 · 歌声转换') : '到「模型」页下载一个'

    // 说话时不再抖动：改用 voice 动图表达「正在说话」，
    // 两者叠加会晃得难受。
    shakebox.classList.remove('is-shaking')
    // 唱歌状态同步：唱起来切 voice 动图，唱完回待机
    syncSingingMood()
    btn.classList.toggle('is-on', state.enabled)
    btn.classList.toggle('is-off', !state.enabled)

    panel.classList.toggle('is-open', state.panelOpen)

    applyAppearance()
    renderVram()
    renderTabs()
    renderBody()
    positionPanel()
  }

  // ── 位置与拖拽 ──────────────────────────────────────────────────────
  /** 冒泡定位：贴着立绘最近的一侧。 */
  function positionBubble() {
    if (bubbleKey === null) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const r = host.getBoundingClientRect()
    const size = r.width || state.widgetSize
    const bw = 190
    const bh = 120
    const gap = 4
    // 水平：冒泡中心对齐立绘中心，钳制在窗口内
    const centerX = r.left + size / 2
    bubble.style.left = Math.round(Math.max(8, Math.min(centerX - bw / 2, vw - bw - 8))) + 'px'
    bubble.style.right = 'auto'
    // 垂直：立绘在上半屏 → 冒泡在脚下；在下半屏 → 冒泡在头顶
    if (r.top + size / 2 < vh / 2) {
      bubble.style.top = Math.round(Math.min(r.top + size + gap, vh - bh - 8)) + 'px'
      bubble.style.bottom = 'auto'
    } else {
      bubble.style.bottom = Math.round(Math.min(vh - r.top + gap, vh - 8)) + 'px'
      bubble.style.top = 'auto'
    }
  }

  /** 直接落位，不做吸附。用于「已知要贴哪条边」的场景。 */
  function setPos(x, y) {
    host.style.left = Math.round(x) + 'px'
    host.style.top = Math.round(y) + 'px'
    positionPanel()
  }

  /**
   * 吸附到最近的一条边（上/下/左/右均可）：
   * 只吸附距离最近的那一个维度，另一维度保持原值。
   * 这样既能吸到上下边的中间，也能吸到左右边的中间，还会自然吸到角落。
   */
  function snapToEdge(left, top) {
    const w = host.offsetWidth || state.widgetSize
    const h = host.offsetHeight || state.widgetSize
    const maxLeft = Math.max(0, window.innerWidth - w)
    const maxTop = Math.max(0, window.innerHeight - h)
    const x0 = Math.min(Math.max(0, left), maxLeft)
    const y0 = Math.min(Math.max(0, top), maxTop)
    const distLeft = x0
    const distRight = maxLeft - x0
    const distTop = y0
    const distBottom = maxTop - y0
    const minDist = Math.min(distLeft, distRight, distTop, distBottom)
    let x = x0
    let y = y0
    if (minDist === distLeft) x = 0
    else if (minDist === distRight) x = maxLeft
    else if (minDist === distTop) y = 0
    else y = maxTop
    return { x, y }
  }

  function place(left, top, snap) {
    const w = host.offsetWidth || state.widgetSize
    const h = host.offsetHeight || state.widgetSize
    const maxLeft = Math.max(0, window.innerWidth - w)
    const maxTop = Math.max(0, window.innerHeight - h)
    let x = Math.min(Math.max(0, left), maxLeft)
    let y = Math.min(Math.max(0, top), maxTop)

    // 自由摆放：拖到中间就停中间。
    // 只有「拖拽松手」和「窗口尺寸变化」时吸附到最近边。
    if (snap) {
      const snapped = snapToEdge(x, y)
      x = snapped.x
      y = snapped.y
    }

    host.style.left = Math.round(x) + 'px'
    host.style.top = Math.round(y) + 'px'
    positionPanel()
  }

  function savePos() {
    try {
      const r = host.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const maxLeft = Math.max(0, vw - r.width)
      const maxTop = Math.max(0, vh - r.height)
      localStorage.setItem(POS_KEY, JSON.stringify({
        left: r.left <= 0,
        right: r.left >= maxLeft - 1,
        top: r.top <= 0,
        bottom: r.top >= maxTop - 1,
        x: Math.round(r.left),
        y: Math.round(r.top),
      }))
    } catch { /* 忽略 */ }
  }

  function restorePos() {
    const w = state.widgetSize
    const maxLeft = Math.max(0, window.innerWidth - w)
    const maxTop = Math.max(0, window.innerHeight - w)
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null') } catch { saved = null }

    if (!saved) { place(maxLeft, maxTop, true); return }
    const x = saved.right ? maxLeft : (saved.left ? 0 : Math.min(saved.x || 0, maxLeft))
    const y = saved.bottom ? maxTop : (saved.top ? 0 : Math.min(saved.y || 0, maxTop))
    // 恢复时尊重保存的位置（含中间），不做吸附
    place(x, y, false)
  }

  let drag = null

  btn.addEventListener('dragstart', (e) => e.preventDefault())
  btn.addEventListener('selectstart', (e) => e.preventDefault())

  // ── 左键连点 5 次 → 换一张立绘 ────────────────────────────────────
  const CLICK_WINDOW_MS = 900       // 连点窗口
  const CLICK_NEEDED = 5            // 需要几次
  let clickCount = 0
  let clickTimer = null

  /** 记一次点击；够 5 次就轮到下一张。 */
  function registerClick() {
    clickCount += 1
    clearTimeout(clickTimer)
    if (clickCount >= CLICK_NEEDED) {
      clickCount = 0
      if (mood.loaded) rollIdle(true)
      return
    }
    // 超时清零，避免慢慢点也算连点
    clickTimer = setTimeout(() => { clickCount = 0 }, CLICK_WINDOW_MS)
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const r = host.getBoundingClientRect()
    drag = {
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      moved: false,
      x: e.clientX,
      y: e.clientY,
      baseLeft: r.left,
      baseTop: r.top,
      pid: e.pointerId,
    }
    try { btn.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
    btn.classList.add('is-pressed')
  })

  btn.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    btn.classList.remove('is-pressed')
    btn.classList.add('is-dragging')

    const w = host.offsetWidth || state.widgetSize
    const h = host.offsetHeight || state.widgetSize
    const left = Math.min(Math.max(0, drag.baseLeft + dx), window.innerWidth - w)
    const top = Math.min(Math.max(0, drag.baseTop + dy), window.innerHeight - h)
    // 拖拽过程中自由移动，松手再吸边
    host.style.left = Math.round(left) + 'px'
    host.style.top = Math.round(top) + 'px'
  })

  btn.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pid) return
    try { btn.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
    if (drag.moved) {
      const r = host.getBoundingClientRect()
      // 自由位置：松手就停在松手处，不吸边（只有窗口尺寸变化才吸附）
      place(r.left, r.top, false)
      savePos()
    } else {
      // 纯点击（没拖动）才算一次；连点 5 次换立绘
      registerClick()
    }
    playRelease()
    drag = null
  })

  btn.addEventListener('pointercancel', () => {
    btn.classList.remove('is-pressed', 'is-dragging')
    drag = null
  })

  /** 松手回弹：先冲过 1.0 再回落。 */
  function playRelease() {
    btn.classList.remove('is-pressed', 'is-dragging')
    btn.classList.remove('is-released')
    void btn.offsetWidth
    btn.classList.add('is-released')
    const done = () => {
      btn.classList.remove('is-released')
      btn.removeEventListener('animationend', done)
    }
    btn.addEventListener('animationend', done)
    setTimeout(done, 1000)
  }

  // 右键开关面板；点外面关闭
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    state.panelOpen = !state.panelOpen
    if (state.panelOpen) {
      player.unlock()
      void loadConfig()
    } else {
      // 关面板时必须收起还开着的下拉，否则菜单会孤零零挂在屏幕上
      closeAllDropdowns()
    }
    emit()
  })

  // ── 左键按下期间冻结面板坐标 ────────────────────────────────────────
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.panelOpen) return
    const r = panel.getBoundingClientRect()
    lockPanel = { left: r.left, top: r.top }
    panel.classList.add('is-locked')
  })

  function unlockPanel() {
    if (!lockPanel) return
    lockPanel = null
    panel.classList.remove('is-locked')
    panel.style.position = ''
    panel.style.left = ''
    panel.style.top = ''
    panel.style.right = ''
    panel.style.bottom = ''
    positionPanel()
  }

  document.addEventListener('pointerup', unlockPanel)
  document.addEventListener('pointercancel', unlockPanel)

  function restorePanelPos() {
    if (!lockPanel || !state.panelOpen) return
    panel.style.position = 'fixed'
    panel.style.left = lockPanel.left + 'px'
    panel.style.top = lockPanel.top + 'px'
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  }

  // ── 标签栏（事件委托，挂在不重建的容器上） ──────────────────────────
  function switchTab(id) {
    if (state.tab === id) return
    logEvent('切换标签 → ' + id)
    state.tab = id
    currentTab = null
    renderTabs()
    renderBody()
  }

  tabBar.addEventListener('click', (e) => {
    const target = e.target
    const btn2 = target && typeof target.closest === 'function' ? target.closest('[data-tab]') : null
    if (!btn2) return
    switchTab(btn2.getAttribute('data-tab'))
  })

  // ── 音频轮询 ────────────────────────────────────────────────────────
  let pollTimer = null
  let polling = false

  // 唱歌状态变化 → 同步立绘
  let lastSinging = false
  function syncSingingMood() {
    const singing = Boolean(state.svc && state.svc.singing)
    if (singing === lastSinging) return
    lastSinging = singing
    if (singing) playVoiceMood()
    else stopVoiceMood()
  }

  async function tick() {
    if (polling) return
    polling = true
    try {
      // 先取音频，再取状态（取到音频要立刻播）
      const r = await api.poll()
      if (r && r.ok && r.audio) {
        state.speaking += 1
        // 说话时切换到 voice 动图
        playVoiceMood()
        emit()
        const res = await player.play(r.audio)
        if (!res.ok) logEvent('播放失败: ' + res.error, 'warn')
        if (res.duration) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(200, res.duration * 1000)))
        }
        state.speaking = Math.max(0, state.speaking - 1)
        // 说完回到待机动图
        stopVoiceMood()
        emit()
        polling = false
        return
      }
      await refreshStatus()
    } catch { /* 下一轮再试 */ } finally {
      polling = false
    }
  }

  function startPolling() {
    if (pollTimer) return
    tick()
    pollTimer = setInterval(tick, POLL_MS)
  }

  // ── 挂载 ────────────────────────────────────────────────────────────
  function mount() {
    if (!document.body) { setTimeout(mount, 100); return }
    logEvent('前端启动完成，挂载成功')
    document.body.appendChild(host)
    applyAppearance()
    restorePos()
    render()

    void loadConfig()
    // 立绘动图素材（失败自动回退静态图，不影响其他功能）
    void loadMoods()
    // 启动就拉市场，用户点进模型页时数据已在内存
    void loadMarket()

    startPolling()

    // 最大化/恢复会触发一连串 resize。
    // 关键：记录「resize 开始前」的屏幕坐标，窗口变化后尽量保持屏幕位置不变；
    // 只有新窗口装不下时才钳制回窗口内。绝不在过程中用中间态窗口尺寸重算位置。
    let resizeTimer = null
    let resizeBase = null
    window.addEventListener('resize', () => {
      if (!resizeBase) {
        try {
          const r = host.getBoundingClientRect()
          const vw0 = window.innerWidth
          const vh0 = window.innerHeight
          const w = r.width || state.widgetSize
          const h = r.height || state.widgetSize
          const maxL0 = Math.max(0, vw0 - w)
          const maxT0 = Math.max(0, vh0 - h)
          // 记录 resize 前贴在哪条边（旧窗口尺寸下的贴边判定）
          resizeBase = {
            left: r.left,
            top: r.top,
            w,
            h,
            dockLeft: r.left <= 1,
            dockRight: r.left >= maxL0 - 1,
            dockTop: r.top <= 1,
            dockBottom: r.top >= maxT0 - 1,
          }
        } catch { /* 忽略 */ }
      }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try {
          if (!resizeBase) return
          const vw = window.innerWidth
          const vh = window.innerHeight
          const w = resizeBase.w
          const h = resizeBase.h
          const maxLeft = Math.max(0, vw - w)
          const maxTop = Math.max(0, vh - h)
          const base = resizeBase
          // 先钳制到新窗口内
          const clamped = {
            x: Math.max(0, Math.min(base.left, maxLeft)),
            y: Math.max(0, Math.min(base.top, maxTop)),
          }
          const wasDocked = base.dockLeft || base.dockRight || base.dockTop || base.dockBottom
          let x = clamped.x
          let y = clamped.y
          if (wasDocked) {
            // 已经贴边：保持原来的边，另一维投影到新窗口内。
            // 这样右下角/右边中间在最大化-恢复来回时不会跳到另一边。
            if (base.dockLeft) x = 0
            else if (base.dockRight) x = maxLeft
            if (base.dockTop) y = 0
            else if (base.dockBottom) y = maxTop
          } else {
            // 完全自由：吸到离它最近的边上的最近点（垂直投影）。
            const snapped = snapToEdge(clamped.x, clamped.y)
            x = snapped.x
            y = snapped.y
          }
          setPos(x, y)
          positionPanel()
          render()
          savePos()
        } finally {
          resizeBase = null
        }
      }, 150)
    })
  }

  subscribe(() => {
    try {
      render()
      restorePanelPos()
    } catch (error) {
      logEvent('render 异常: ' + (error && error.message ? error.message : String(error)), 'error')
    }
  })

  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
}

boot()
