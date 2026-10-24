/**
 * 说话页。
 */

import { el, setChildren } from '../dom.js'
import { createSwitch, createSlider, createButton } from '../controls.js'
import { state, emit } from '../store.js'
import { api, logEvent } from '../api.js'

export function createSpeakPage({ onSayTest, onReplay, onStop, onProbe, onRefresh }) {
  const container = el('div', { class: 'vs-page' })
  let lastSig = ''

  // 控件只建一次，后续只更新值，避免重绘打断交互
  logEvent('说话页初始化')
  const switchEnabled = createSwitch({
    label: '说话开关',
    hint: '总开关，关闭后不会朗读',
    value: state.enabled,
    onChange: async (v) => {
      logEvent('说话开关切换 → ' + v)
      state.enabled = v
      await api.saveConfig({ enabled: v })
      emit()
    },
  })

  // 预热模型做成开关
  const warmSwitch = createSwitch({
    label: '模型预热',
    hint: '说话自动加载，手动打开后第一句不用等加载，打开后占用显存',
    value: false,
    disabled: false,
    onChange: () => {
      if (onRefresh) void onRefresh()
    },
  })

  const switchAuto = createSwitch({
    label: '自动读回复',
    hint: 'AI 回复后自动朗读',
    value: state.autoSpeak,
    disabled: !state.enabled,
    onChange: async (v) => {
      if (!state.enabled) return
      state.autoSpeak = v
      await api.saveConfig({ autoSpeak: v })
      emit()
    },
  })

  const sliderVolume = createSlider({
    label: '音量',
    value: Math.round(state.volume * 100),
    min: 0, max: 100, step: 5,
    format: (v) => v + '%',
    onInput: (v) => { state.volume = v / 100 },
  })

  const sliderSpeed = createSlider({
    label: '语速',
    value: Math.round(state.speed * 100),
    min: 50, max: 200, step: 5,
    format: (v) => (v / 100).toFixed(2) + '×',
    onInput: (v) => { state.speed = v / 100 },
  })

  // 采样参数：温度与句间停顿（对所有 GPT-SoVITS 模型通用）
  const sliderTemp = createSlider({
    label: '温度',
    hint: '越高越有起伏感，越低越平稳；情感主要靠参考音频',
    value: Math.round(state.temperature * 100),
    min: 5, max: 200, step: 5,
    format: (v) => (v / 100).toFixed(2),
    onInput: (v) => { state.temperature = v / 100 },
  })

  const sliderGap = createSlider({
    label: '句间停顿',
    hint: '句子之间停多久，停顿越长语速越从容',
    value: Math.round(state.fragmentInterval * 100),
    min: 0, max: 200, step: 5,
    format: (v) => (v / 100).toFixed(2) + ' 秒',
    onInput: (v) => { state.fragmentInterval = v / 100 },
  })

  // 朗读采样细节：普通用户一般不用动，但面板里所有设置都要可调
  const sliderTopK = createSlider({
    label: '选词范围',
    hint: '每步从最可能的几个发音片段里挑：大=多变，小=稳定',
    value: state.topK,
    min: 1, max: 30, step: 1,
    onInput: (v) => { state.topK = v },
  })

  const sliderTopP = createSlider({
    label: '选词概率',
    hint: '发音片段候选池大小：接近 1 自然，调小保守',
    value: Math.round(state.topP * 100),
    min: 10, max: 100, step: 5,
    format: (v) => (v / 100).toFixed(2),
    onInput: (v) => { state.topP = v / 100 },
  })

  const sliderRep = createSlider({
    label: '重复抑制',
    hint: '防止同一个音打转：越大越抑制重复发音，1 为不抑制',
    value: Math.round(state.repetitionPenalty * 100),
    min: 50, max: 200, step: 5,
    format: (v) => (v / 100).toFixed(2),
    onInput: (v) => { state.repetitionPenalty = v / 100 },
  })

  // 退出 DSH 时自动卸载模型（默认开）
  const switchExitUnload = createSwitch({
    label: '退出时卸载模型',
    hint: '退出程序后释放说话模型占用的显存',
    value: state.ttsUnloadOnExit !== false,
    onChange: async (v) => {
      state.ttsUnloadOnExit = v
      await api.saveConfig({ ttsUnloadOnExit: v })
      emit()
    },
  })

  // 闲置冷却：0 = 从不
  const sliderIdle = createSlider({
    label: '闲置冷却',
    hint: '预热后长时间不用，自动卸载模型释放显存',
    value: state.idleUnloadMs / 60000,
    min: 0, max: 30, step: 1,
    format: (v) => (v === 0 ? '从不' : v + ' 分钟'),
    onInput: (v) => { state.idleUnloadMs = v * 60000 },
  })

  // 滑块松手才存盘，避免拖动时打爆后端
  const saveSliders = async () => {
    await api.saveConfig({
      volume: state.volume,
      speed: state.speed,
      temperature: state.temperature,
      topK: state.topK,
      topP: state.topP,
      repetitionPenalty: state.repetitionPenalty,
      fragmentInterval: state.fragmentInterval,
      idleUnloadMs: state.idleUnloadMs,
      ttsUnloadOnExit: state.ttsUnloadOnExit,
    })
  }
  for (const sl of [sliderVolume, sliderSpeed, sliderTemp, sliderGap, sliderTopK, sliderTopP, sliderRep, sliderIdle]) {
    sl.root.querySelector('input')?.addEventListener('change', saveSliders)
  }

  const rowStatus = el('div', { class: 'vs-hint' })

  function signature() {
    return JSON.stringify({
      enabled: state.enabled,
      autoSpeak: state.autoSpeak,
      ttsUp: state.tts.up,
      ttsWarm: state.tts.warm,
      engine: state.profile ? state.profile.engine : '',
      synthesizing: state.synthesizing,
      speaking: state.speaking,
      temperature: state.temperature,
      fragmentInterval: state.fragmentInterval,
      topK: state.topK,
      topP: state.topP,
      repetitionPenalty: state.repetitionPenalty,
      idleUnloadMs: state.idleUnloadMs,
    })
  }

  function render() {
    switchEnabled.set(state.enabled)
    switchAuto.set(state.autoSpeak)
    warmSwitch.root.classList.toggle('is-warming', Boolean(state.tts.warming))
    warmSwitch.set(Boolean(state.tts.warm))
    sliderVolume.set(Math.round(state.volume * 100))
    sliderSpeed.set(Math.round(state.speed * 100))
    sliderTemp.set(Math.round(state.temperature * 100))
    sliderGap.set(Math.round(state.fragmentInterval * 100))
    sliderTopK.set(state.topK)
    sliderTopP.set(Math.round(state.topP * 100))
    sliderRep.set(Math.round(state.repetitionPenalty * 100))
    sliderIdle.set(state.idleUnloadMs / 60000)
    switchExitUnload.set(state.ttsUnloadOnExit !== false)

    const sig = signature()
    if (sig === lastSig) return
    lastSig = sig

    const engine = state.profile ? state.profile.engine : ''
    let statusText = ''
    if (engine === 'sapi') {
      statusText = '使用系统内置语音，无需外部服务'
    } else if (!state.profile) {
      statusText = '还没有可用角色，去「模型」页下载一个'
    } else if (!state.tts.up) {
      statusText = '语音服务未启动，点「预热」会自动拉起'
    } else {
      statusText = state.tts.warm ? '服务在线 · 模型已预热' : '服务在线'
    }

    setChildren(container, [
      // 服务状态行放在最上面
      el('div', { class: 'vs-row' }, [
        el('span', { class: 'vs-row__label', text: '服务' }),
        el('span', {
          class: 'vs-row__value' + (state.tts.up || engine === 'sapi' ? ' is-ok' : ''),
          text: engine === 'sapi' ? '系统语音' : (state.tts.up ? '在线' : '离线'),
        }),
      ]),

      // ── 开关模块 ──
      switchEnabled.root,
      // 预热开关在说话开关和自动读回复之间
      engine === 'sapi' ? null : warmSwitch.root,
      switchAuto.root,
      // 退出时卸载：开关模块的最后一个
      engine === 'sapi' ? null : switchExitUnload.root,
      rowStatus,
      el('div', { class: 'vs-sep' }),

      // ── 按钮模块：四个按钮放两行，都在滑块上面 ──
      el('div', { class: 'vs-actions' }, [
        createButton({ label: '说一句试试', variant: 'primary', onClick: onSayTest }),
        createButton({ label: '停止', onClick: onStop }),
      ]),
      el('div', { class: 'vs-actions' }, [
        createButton({ label: '听上一句', onClick: onReplay }),
        engine === 'sapi' ? null : createButton({ label: '检测服务', variant: 'ghost', onClick: onProbe }),
      ]),
      el('div', { class: 'vs-sep' }),

      // ── 滑块模块 ──
      sliderVolume.root,
      sliderSpeed.root,
      engine === 'sapi' ? null : sliderTemp.root,
      engine === 'sapi' ? null : sliderGap.root,
      engine === 'sapi' ? null : sliderTopK.root,
      engine === 'sapi' ? null : sliderTopP.root,
      engine === 'sapi' ? null : sliderRep.root,
      el('div', { class: 'vs-sep' }),
      sliderIdle.root,
      el('div', { class: 'vs-hint vs-hint--tight', text: '预热后长时间不用，会自动卸载模型释放显存' }),
    ])
  }

  return {
    root: container,
    render,
    setError(msg) {
      rowStatus.textContent = msg || ''
      rowStatus.className = msg ? 'vs-hint is-error' : 'vs-hint'
      rowStatus.style.color = msg ? '#ff9d9d' : ''
    },
    setFailed(failed) {
      if (!failed) return
      rowStatus.className = 'vs-hint is-error'
      rowStatus.style.color = '#ff9d9d'
    },
  }
}
