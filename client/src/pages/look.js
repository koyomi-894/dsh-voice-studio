/**
 * 外观页。
 *
 * 角色切换在「模型」页做，这里只管外观，避免重复入口。
 */

import { el, setChildren } from '../dom.js'
import { createSwitch, createSlider } from '../controls.js'
import { createDropdown } from '../dropdown.js'
import { state, emit } from '../store.js'
import { api } from '../api.js'

export const THEMES = {
  whale: { name: '鲸鱼娘', accent: '#4a7fd4', bg: '#141b2e', title: '#f0f4fc', sub: '#8ba3c7' },
  sakura: { name: '樱粉', accent: '#ff7ab0', bg: '#14161d', title: '#ffd6e8', sub: '#cba6ba' },
  sky: { name: '天青', accent: '#31c4d4', bg: '#12181d', title: '#c9f3f8', sub: '#8fc3cb' },
  forest: { name: '森绿', accent: '#9ece6a', bg: '#141a14', title: '#dcf0c8', sub: '#a8bf96' },
  amber: { name: '暖橙', accent: '#e0a458', bg: '#1a1512', title: '#ffe0b8', sub: '#c9ab8c' },
  violet: { name: '黛紫', accent: '#a78bfa', bg: '#17141f', title: '#e4dcff', sub: '#aca3cf' },
}

export function createLookPage({ onAppearanceChange }) {
  const container = el('div', { class: 'vs-page' })
  let lastSig = ''
  let themeDropdown = null
  let fileInput = null
  // 外观页只显示自己的上传错误，不显示共享的 lastError（唱歌服务报错不该出现在这里）
  let uploadError = ''

  const glassSlider = createSlider({
    label: '毛玻璃',
    value: state.glassBlur,
    min: 0, max: 40, step: 2,
    format: (v) => (v === 0 ? '关闭' : v + ' px'),
    onInput: (v) => {
      state.glassBlur = v
      onAppearanceChange()
    },
  })

  const sizeSlider = createSlider({
    label: '立绘大小',
    value: state.widgetSize,
    min: 64, max: 240, step: 4,
    format: (v) => v + ' px',
    onInput: (v) => {
      state.widgetSize = v
      onAppearanceChange()
    },
  })

  const flipSwitch = createSwitch({
    label: '左右翻转',
    value: state.widgetFlip,
    hint: state.widgetFlip ? '已左右翻转' : '原始朝向',
    onChange: (v) => {
      state.widgetFlip = v
      onAppearanceChange()
      emit()
    },
  })

  // 立绘开关：关闭后完全隐藏，设置页仍可使用
  const visibleSwitch = createSwitch({
    label: '立绘开关',
    value: state.widgetVisible !== false,
    hint: '关闭后不再显示小立绘',
    onChange: (v) => {
      state.widgetVisible = v
      onAppearanceChange()
      emit()
    },
  })
  const visibleHint = el('div', { class: 'vs-hint vs-hint--tight', text: '关闭后可到左下角头像打开的设置页重新显示' })

  function signature() {
    return JSON.stringify({
      theme: state.theme,
      accent: state.accent,
      size: state.widgetSize,
      flip: state.widgetFlip,
      visible: state.widgetVisible,
      glass: state.glassBlur,
      err: uploadError,
    })
  }

  function render() {
    glassSlider.set(state.glassBlur)
    sizeSlider.set(state.widgetSize)
    flipSwitch.set(state.widgetFlip)
    visibleSwitch.set(state.widgetVisible !== false)

    // 主题下拉复用实例
    const items = Object.keys(THEMES).map((k) => ({ value: k, label: THEMES[k].name }))
    if (!themeDropdown) {
      themeDropdown = createDropdown({
        items,
        value: state.theme,
        placeholder: '选择主题',
        onChange: (v) => {
          state.theme = v
          state.accent = ''
          onAppearanceChange()
          emit()
        },
      })
    } else {
      themeDropdown.setValue(state.theme)
    }

    const sig = signature()
    if (sig === lastSig) return
    lastSig = sig

    const cur = THEMES[state.theme] || THEMES.whale
    const swatches = el('div', { class: 'vs-swatches' },
      Object.keys(THEMES).map((k) => el('span', {
        class: 'vs-swatch' + (state.accent
          ? (state.accent === THEMES[k].accent ? ' is-selected' : '')
          : (k === state.theme ? ' is-selected' : '')),
        style: { background: THEMES[k].accent },
        title: THEMES[k].name,
        onclick: () => {
          state.accent = THEMES[k].accent
          onAppearanceChange()
          emit()
        },
      })),
    )

    const accentPicker = el('input', {
      class: 'vs-color',
      type: 'color',
      value: state.accent || cur.accent,
      oninput: (e) => {
        state.accent = e.target.value
        onAppearanceChange()
      },
    })

    if (!fileInput) {
      fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } })
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0]
        if (!f) return
        if (f.size > 8 * 1024 * 1024) {
          uploadError = '图片超过 8MB'
          emit()
          return
        }
        const reader = new FileReader()
        reader.onload = async () => {
          const r = await api.upload(fileInput.dataset.which, String(reader.result))
          if (!r || !r.ok) {
            uploadError = (r && r.error) || '上传失败'
          } else {
            // 递增版本号，让图片 URL 变化，绕开浏览器缓存
            state.assetVersion = (state.assetVersion || 0) + 1
            uploadError = ''
            onAppearanceChange()
          }
          emit()
        }
        reader.readAsDataURL(f)
      })
    }

    setChildren(container, [
      el('div', { class: 'vs-field' }, [
        el('div', { class: 'vs-field__head' }, [
          el('span', { class: 'vs-field__label', text: '主题' }),
        ]),
        themeDropdown.root,
      ]),
      el('div', { class: 'vs-field' }, [
        el('div', { class: 'vs-field__head' }, [
          el('span', { class: 'vs-field__label', text: '主色' }),
        ]),
        swatches,
        el('div', { class: 'vs-color-row' }, [
          accentPicker,
          el('button', {
            class: 'vs-link', type: 'button', text: '恢复默认',
            onclick: () => {
              state.accent = ''
              onAppearanceChange()
              emit()
            },
          }),
        ]),
      ]),
      el('div', { class: 'vs-sep' }),
      visibleSwitch.root,
      visibleHint,
      sizeSlider.root,
      glassSlider.root,
      flipSwitch.root,
      el('div', { class: 'vs-sep' }),
      el('div', { class: 'vs-field' }, [
        el('div', { class: 'vs-field__head' }, [
          el('span', { class: 'vs-field__label', text: '图片' }),
        ]),
        el('div', { class: 'vs-actions' }, [
          el('button', {
            class: 'vs-btn', type: 'button', text: '修改背景图',
            onclick: () => { fileInput.dataset.which = 'background'; fileInput.click() },
          }),
          el('button', {
            class: 'vs-btn', type: 'button', text: '修改立绘',
            onclick: () => { fileInput.dataset.which = 'icon'; fileInput.click() },
          }),
        ]),
        fileInput,
        el('div', { class: 'vs-hint', text: '图片会存进角色目录的 assets/，下次打开自动生效。' }),
      ]),
      uploadError ? el('div', { class: 'vs-error', text: uploadError }) : null,
    ])
  }

  return { root: container, render }
}
