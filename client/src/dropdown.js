/**
 * 下拉菜单。
 *
 * 关键设计（每条都对应一个踩过的坑）：
 *   · 菜单挂到 document.body 并用 fixed 定位：面板是滚动容器，会把 absolute 子元素裁掉。
 *   · 挂到 body 前必须先把定位与尺寸写成内联样式，否则块级元素会撑开页面出现右滑条。
 *   · 选中项用 pointerdown 而不是 click：外部关闭监听也在 pointerdown，
 *     用 click 时元素可能已被移除，回调永远不触发。
 *   · value 用 let：曾写成 const 解构，导致 Assignment to constant variable。
 *   · 实例全局登记，切页面时统一关闭，避免菜单残留在 body 上关不掉。
 */

import { el } from './dom.js'
import { logEvent } from './api.js'

/** 所有活着的实例，用于统一关闭。 */
const registry = new Set()

/** 给 body 上的菜单补一份页面级样式（Shadow DOM 的 CSS 够不到它）。 */
let pageStylesReady = false
function ensurePageStyles() {
  if (pageStylesReady) return
  const id = 'vs-page-styles'
  if (document.getElementById(id)) { pageStylesReady = true; return }
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  const src = document.querySelector('script[src*="/voice-studio/main.js"]')
  const v = src ? (src.getAttribute('src') || '').split('v=')[1] || '' : ''
  link.href = '/voice-studio/panel.css' + (v ? '?v=' + v : '')
  document.head.appendChild(link)
  pageStylesReady = true
}

/** 关掉当前所有打开的下拉。切页面 / 切换面板时调用。 */
export function closeAllDropdowns() {
  for (const inst of registry) {
    try { inst.close() } catch { /* 忽略 */ }
  }
}

/**
 * @param {object} opts
 * @param {Array<{value:string,label:string}>} opts.items
 * @param {string} opts.value
 * @param {string} [opts.placeholder]
 * @param {(v:string)=>void} opts.onChange
 * @param {Node} [opts.action] 右侧附加按钮
 */
export function createDropdown(opts) {
  const { items = [], placeholder = '请选择', onChange, action } = opts
  // value 必须可写
  let value = opts.value ?? ''

  const label = el('span', { class: 'vs-dd__label' })
  const arrow = el('span', { class: 'vs-dd__arrow' })

  const button = el('button', {
    class: 'vs-dd__btn',
    type: 'button',
    onpointerdown: (e) => {
      // 标记本次 pointerdown 是点按钮，onOutside 看到后跳过 close
      justToggled = true
      e.preventDefault()
      e.stopPropagation()
      toggle()
      // 下一轮事件循环清标记，保证只保护本次事件
      setTimeout(() => { justToggled = false }, 0)
    },
  }, [label, arrow])

  const root = el('div', { class: 'vs-dd' }, [button, action || null])

  let menu = null
  let open = false
  // 本次 pointerdown 是否来自按钮/菜单项，用来跳过 onOutside 的 close
  let justToggled = false

  function renderLabel() {
    const cur = items.find((it) => it.value === value)
    label.textContent = cur ? cur.label : placeholder
    button.classList.toggle('vs-dd__btn--empty', !cur)
  }

  /** 选中：更新值、收起、通知外部。 */
  function pick(next) {
    value = next
    renderLabel()
    close()
    if (onChange) onChange(next)
  }

  function buildMenu() {
    const node = el('div', { class: 'vs-dd-menu' })
    if (!items.length) {
      node.appendChild(el('div', { class: 'vs-dd-menu__empty', text: placeholder }))
      return node
    }
    for (const it of items) {
      const selected = it.value === value
      node.appendChild(el('div', {
        class: 'vs-dd-menu__item' + (selected ? ' is-selected' : ''),
        text: it.label,
        onpointerdown: (e) => {
          justToggled = true
          e.preventDefault()
          e.stopPropagation()
          pick(it.value)
          setTimeout(() => { justToggled = false }, 0)
        },
      }))
    }
    return node
  }

  function position() {
    if (!menu) return
    const r = button.getBoundingClientRect()
    const width = Math.max(140, r.width)
    menu.style.position = 'fixed'
    menu.style.left = Math.max(6, Math.min(r.left, window.innerWidth - width - 6)) + 'px'
    menu.style.width = width + 'px'

    // 下方空间够就往下展开，否则往上翻
    const below = window.innerHeight - r.bottom - 10
    const above = r.top - 10
    const openUp = below < 160 && above > below
    const maxH = Math.max(80, Math.min(260, openUp ? above : below))
    menu.style.maxHeight = maxH + 'px'
    menu.style.top = openUp ? 'auto' : (r.bottom + 4) + 'px'
    menu.style.bottom = openUp ? (window.innerHeight - r.top + 4) + 'px' : 'auto'
  }

  function openMenu() {
    logEvent('下拉 openMenu 被调用, open=' + open)
    if (open) return
    ensurePageStyles()
    closeAllDropdowns()
    menu = buildMenu()
    // 关键：挂载前先写定位，否则会以块级元素撑开页面
    menu.style.position = 'fixed'
    menu.style.left = '0'
    menu.style.top = '0'
    menu.style.width = '0'
    menu.style.maxHeight = '0'
    menu.style.overflow = 'hidden'
    menu.style.margin = '0'
    menu.style.padding = '4px'
    menu.style.boxSizing = 'border-box'

    // 菜单挂在 body 上，拿不到面板的 CSS 变量。
    // 从立绘容器读取当前主题色，让菜单底/边框跟随角色背景，避免浅色背景时白边泛白。
    try {
      const wrap = document.querySelector('body > .vs-host')?.shadowRoot?.querySelector('.vs-wrap')
      if (wrap) {
        const cs = getComputedStyle(wrap)
        const bg = cs.getPropertyValue('--bg').trim() || '#1a2133'
        const line = cs.getPropertyValue('--line').trim() || 'rgba(255,255,255,.16)'
        menu.style.setProperty('--menu-bg', bg)
        menu.style.setProperty('--menu-line', line)
        const fg = cs.getPropertyValue('--fg').trim() || '#f2f5f8'
        const dim = cs.getPropertyValue('--dim').trim() || '#9aa4b2'
        menu.style.setProperty('--fg', fg)
        menu.style.setProperty('--dim', dim)
      }
    } catch { /* 读取失败用 CSS 默认值 */ }
    document.body.appendChild(menu)

    position()
    menu.style.overflow = 'auto'
    open = true
    button.classList.add('is-open')

    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
  }

  function close() {
    logEvent('下拉 close 被调用, open=' + open)
    if (!open) return
    open = false
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('scroll', onViewportChange, true)
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu)
    menu = null
    button.classList.remove('is-open')
  }

  function toggle() {
    logEvent('下拉 toggle: 当前 open=' + open + ' 即将 ' + (open ? 'close' : 'open'))
    if (open) close()
    else openMenu()
  }

  function onOutside(e) {
    const inRoot = root.contains(e.target)
    const inMenu = menu ? menu.contains(e.target) : false
    if (justToggled) return
    logEvent('下拉 onOutside: inRoot=' + inRoot + ' inMenu=' + inMenu + ' open=' + open)
    if (inRoot) return
    if (inMenu) return
    close()
  }

  function onViewportChange(e) {
    if (!open || !menu) return
    // 面板内部滚动不该关掉菜单
    if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('.vs-body')) {
      position()
      return
    }
    position()
  }

  renderLabel()

  const api = {
    root,
    get value() { return value },
    setValue(v) {
      value = v
      renderLabel()
    },
    setItems(next) {
      items.length = 0
      for (const it of next || []) items.push(it)
      renderLabel()
      // 菜单开着时直接重建菜单内容，不要 close+open，否则闪烁
      if (open && menu) {
        const nextMenu = buildMenu()
        menu.replaceWith(nextMenu)
        menu = nextMenu
        position()
      }
    },
    close,
    destroy() {
      close()
      registry.delete(api)
    },
  }

  registry.add(api)
  return api
}
