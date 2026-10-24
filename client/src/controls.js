/**
 * 通用控件：开关、滑块、按钮、颜色块。
 */

import { el } from './dom.js'

/** 开关。 */
export function createSwitch({ label, value = false, hint = '', disabled = false, onChange }) {
  const input = el('input', { type: 'checkbox', class: 'vs-switch__input' })
  input.checked = Boolean(value)
  input.disabled = Boolean(disabled)
  input.addEventListener('change', () => {
    if (onChange) onChange(input.checked)
  })

  const root = el('label', { class: 'vs-row vs-row--switch' + (disabled ? ' is-disabled' : '') }, [
    el('span', { class: 'vs-row__label' }, [
      el('span', { text: label }),
      hint ? el('span', { class: 'vs-row__hint', text: hint }) : null,
    ]),
    el('span', { class: 'vs-switch' }, [input, el('span', { class: 'vs-switch__knob' })]),
  ])

  return {
    root,
    set(v) { input.checked = Boolean(v) },
  }
}

/** 滑块。 */
export function createSlider({
  label, hint = '', value = 0, min = 0, max = 100, step = 1, format, disabled = false, onInput,
}) {
  const input = el('input', {
    type: 'range',
    class: 'vs-slider__input',
    min: String(min),
    max: String(max),
    step: String(step),
  })
  input.value = String(value)
  input.disabled = Boolean(disabled)

  const out = el('b', { class: 'vs-slider__value' })
  // 更新进度条填充比例：让背景色和滑块位置同步
  const updateFill = () => {
    const n = Number(input.value)
    const lo = Number(input.min)
    const hi = Number(input.max)
    const pct = hi > lo ? ((n - lo) / (hi - lo)) * 100 : 0
    input.style.setProperty('--fill', Math.max(0, Math.min(100, pct)) + '%')
  }

  const show = (v) => {
    out.textContent = format ? format(Number(v)) : String(v)
    updateFill()
  }
  show(input.value)

  input.addEventListener('input', () => {
    show(input.value)
    if (onInput) onInput(Number(input.value))
  })

  const root = el('div', { class: 'vs-row vs-row--slider' + (disabled ? ' is-disabled' : '') }, [
    el('div', { class: 'vs-row__head' }, [
      el('span', { class: 'vs-row__label' }, [
        el('span', { text: label }),
        hint ? el('span', { class: 'vs-row__hint', text: hint }) : null,
      ]),
      out,
    ]),
    input,
  ])

  return {
    root,
    set(v) { input.value = String(v); show(v) },
  }
}

/** 按钮。 */
export function createButton({ label, variant = 'default', disabled = false, onClick }) {
  const btn = el('button', {
    class: 'vs-btn' + (variant === 'primary' ? ' vs-btn--primary' : '')
      + (variant === 'ghost' ? ' vs-btn--ghost' : ''),
    type: 'button',
    text: label,
  })
  btn.disabled = Boolean(disabled)
  if (onClick) btn.addEventListener('click', onClick)
  return btn
}

/** 一行文字。 */
export function createRow(label, value, extra) {
  return el('div', { class: 'vs-row' }, [
    el('span', { class: 'vs-row__label', text: label }),
    el('span', { class: 'vs-row__value', text: String(value) }),
    extra || null,
  ])
}
