/**
 * 唱歌页。
 */

import { el, setChildren } from '../dom.js'
import { createSwitch, createSlider, createButton } from '../controls.js'
import { createDropdown } from '../dropdown.js'
import { state, emit } from '../store.js'
import { api } from '../api.js'

export function createSingPage({ onSing, onWarmToggle, onOpenFolder }) {
  const container = el('div', { class: 'vs-page' })
  let lastSig = ''
  let songDropdown = null

  /** 滑块改动防抖存盘：拖动时 input 事件很密，直接请求会打爆后端。 */
  let saveTimer = null
  function scheduleSave(patch) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void api.saveConfig(patch)
    }, 400)
  }

  // 唱歌开关：唱歌功能总开关（不直接加载模型）
  const switchSvcEnabled = createSwitch({
    label: '唱歌开关',
    hint: '关闭后唱歌功能不可用',
    value: state.svcEnabled !== false,
    onChange: async (v) => {
      state.svcEnabled = v
      await api.saveConfig({ svcEnabled: v })
      emit()
    },
  })

  // 模型预热：把模型加载进显存
  const switchWarm = createSwitch({
    label: '模型预热',
    hint: '唱歌自动加载，手动打开后第一首不用等加载，打开后占用显存',
    value: false,
    onChange: () => { void onWarmToggle() },
  })

  const switchExitUnload = createSwitch({
    label: '退出时卸载模型',
    hint: '退出程序后释放唱歌模型占用的显存',
    value: state.svcUnloadOnExit !== false,
    onChange: async (v) => {
      state.svcUnloadOnExit = v
      await api.saveConfig({ svcUnloadOnExit: v })
      emit()
    },
  })

  const sliderIdle = createSlider({
    label: '闲置冷却',
    hint: '预热后长时间不用，自动卸载模型释放显存',
    value: state.idleUnloadMs / 60000,
    min: 0, max: 30, step: 1,
    format: (v) => (v === 0 ? '从不' : v + ' 分钟'),
    onInput: (v) => {
      state.idleUnloadMs = v * 60000
      if (sliderIdle._t) clearTimeout(sliderIdle._t)
      sliderIdle._t = setTimeout(() => {
        void api.saveConfig({ idleUnloadMs: state.idleUnloadMs })
      }, 400)
    },
  })

  const stepsSlider = createSlider({
    label: '扩散步数',
    value: state.svcSteps,
    min: 10, max: 60, step: 5,
    onInput: (v) => {
      state.svcSteps = v
      scheduleSave({ svcSteps: v })
    },
  })

  const vocalSlider = createSlider({
    label: '人声音量',
    value: Math.round(state.vocalGain * 100),
    min: 0, max: 150, step: 5,
    format: (v) => (v / 100).toFixed(2),
    onInput: (v) => {
      state.vocalGain = v / 100
      scheduleSave({ vocalGain: state.vocalGain })
    },
  })

  const backingSlider = createSlider({
    label: '伴奏音量',
    value: Math.round(state.backingGain * 100),
    min: 0, max: 150, step: 5,
    format: (v) => (v / 100).toFixed(2),
    onInput: (v) => {
      state.backingGain = v / 100
      scheduleSave({ backingGain: state.backingGain })
    },
  })

  const backingItems = [
    { value: 'keep', label: '分离人声，唱完混回伴奏' },
    { value: 'remove', label: '只输出人声' },
  ]
  const backingDropdown = createDropdown({
    items: backingItems,
    value: state.backing,
    placeholder: '选择处理方式',
    onChange: (v) => {
      state.backing = v
      scheduleSave({ backing: v })
    },
  })

  const btnSing = createButton({
    label: '唱一首',
    variant: 'primary',
    onClick: onSing,
  })

  function signature() {
    return JSON.stringify({
      svcUrl: state.svc.url,
      up: state.svc.up,
      warm: state.svc.warm,
      singing: state.svc.singing,
      queueLen: state.svc.queueLen,
      pendingResult: state.svc.pendingResult,
      svcError: state.svc.lastError || '',
      lastSource: state.svc.lastSource || '',
      lastFile: state.svc.lastFile || '',
      songs: state.songs,
      song: state.song,
      configured: Boolean(state.svc.url),
      lastError: state.lastError || '',
      idleUnloadMs: state.idleUnloadMs,
      svcUnloadOnExit: state.svcUnloadOnExit,
      svcEnabled: state.svcEnabled,
      backing: state.backing,
    })
  }

  function render() {
    switchSvcEnabled.set(state.svcEnabled !== false)
    switchWarm.root.classList.toggle('is-warming', Boolean(state.svc.warming))
    switchWarm.set(Boolean(state.svc.warm))
    sliderIdle.set(state.idleUnloadMs / 60000)
    switchExitUnload.set(state.svcUnloadOnExit !== false)
    stepsSlider.set(state.svcSteps)
    vocalSlider.set(Math.round(state.vocalGain * 100))
    backingSlider.set(Math.round(state.backingGain * 100))

    const sig = signature()
    if (sig === lastSig) return
    lastSig = sig

    const configured = Boolean(state.svc.url)
    const songs = state.songs || []

    if (songDropdown) {
      songDropdown.setItems(songs.map((s) => ({ value: s, label: s })))
      if (state.song) songDropdown.setValue(state.song)
    } else {
      songDropdown = createDropdown({
        items: songs.map((s) => ({ value: s, label: s })),
        value: state.song,
        placeholder: songs.length ? '选择源歌曲' : '歌曲库里还没有文件',
        onChange: (v) => { state.song = v },
      })
    }

    // 同步伴奏处理下拉：配置加载可能改变 state.backing
    backingDropdown.setValue(state.backing)

    btnSing.disabled = !configured || !state.song
    btnSing.textContent = state.svc.singing
      ? '转换中…'
      : (state.svc.queueLen > 0
        ? '已加入队列（' + state.svc.queueLen + '）'
        : (state.svc.pendingResult > 0 ? '唱一首（还有 ' + state.svc.pendingResult + ' 首待播）' : '唱一首'))

    setChildren(container, [
      // 状态在最上面
      el('div', { class: 'vs-row' }, [
        el('span', { class: 'vs-row__label', text: '状态' }),
        el('span', {
          class: 'vs-row__value' + (state.svc.up ? ' is-ok' : ''),
          text: !configured ? '未配置' : (state.svc.up ? '在线' : '离线'),
        }),
      ]),
      // 唱歌开关
      switchSvcEnabled.root,
      // 模型预热
      switchWarm.root,
      // 退出时卸载
      switchExitUnload.root,
      el('div', { class: 'vs-sep' }),
      sliderIdle.root,
      el('div', { class: 'vs-sep' }),
      el('div', { class: 'vs-row' }, [
        el('span', { class: 'vs-row__label', text: '源歌曲' }),
        el('span', { class: 'vs-row__value', text: songs.length + ' 首' }),
        el('button', {
          class: 'vs-link', type: 'button', text: '打开文件夹',
          onclick: onOpenFolder,
        }),
      ]),
      songDropdown.root,
      state.lastError ? el('div', { class: 'vs-error', text: state.lastError }) : null,
      state.svc.lastError ? el('div', { class: 'vs-error', text: state.svc.lastError }) : null,
      // 转换完成 ≠ 已播放：把「上次唱好的是哪首」明确写出来，避免点了没反应的感觉
      state.svc.lastFile && !state.svc.lastError
        ? el('div', { class: 'vs-hint vs-hint--tight', text: '上次已唱好：' + (state.svc.lastSource || state.svc.lastFile) })
        : null,
      state.svc.pendingResult > 0
        ? el('div', { class: 'vs-hint vs-hint--tight', text: '还有 ' + state.svc.pendingResult + ' 首等待播放' })
        : null,
      el('div', { class: 'vs-sep' }),
      stepsSlider.root,
      el('div', {
        class: 'vs-hint vs-hint--tight',
        text: '扩散步数决定转换质量与耗时：太低（10~15）声音发糊，默认 30 够用，调高（40+）更细腻但慢一倍左右。',
      }),
      backingDropdown.root,
      el('div', { class: 'vs-sep' }),
      vocalSlider.root,
      backingSlider.root,
      btnSing,
      el('div', {
        class: 'vs-hint',
        text: '转换是重活：30 秒的歌约 15~60 秒，同一时刻只能处理一首。',
      }),
    ])
  }

  return { root: container, render }
}
