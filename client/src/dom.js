/**
 * 极简 DOM 构建工具。
 */

/**
 * 创建元素。
 * @param {string} tag
 * @param {object} [attrs] 属性；on* 开头的当作事件，style 支持对象，
 *                         class 为类名，其余用 setAttribute
 * @param {Node|string|Array|null} [children]
 */
export function el(tag, attrs, children) {
  // SVG 元素必须用命名空间创建，否则放进 <svg> 里不渲染（云朵冒泡就靠它）
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const isSvg = tag === 'svg' || tag === 'path' || tag === 'rect' || tag === 'circle'
    || tag === 'ellipse' || tag === 'line' || tag === 'polyline' || tag === 'polygon' || tag === 'g'
  const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)
  const a = attrs || {}

  for (const key of Object.keys(a)) {
    const v = a[key]
    if (v === null || v === undefined) continue

    if (key === 'class' || key === 'className') {
      // SVG 元素没有 className 属性，class 必须走 setAttribute
      if (isSvg) node.setAttribute('class', String(v))
      else node.className = String(v)
    } else if (key === 'text') {
      node.textContent = String(v)
    } else if (key === 'style' && typeof v === 'object') {
      for (const sk of Object.keys(v)) {
        if (v[sk] === null || v[sk] === undefined) continue
        node.style.setProperty(sk, String(v[sk]))
      }
    } else if (key === 'dataset' && typeof v === 'object') {
      for (const dk of Object.keys(v)) node.dataset[dk] = String(v[dk])
    } else if (key.startsWith('on') && typeof v === 'function') {
      // onclick → click；onpointerdown → pointerdown
      node.addEventListener(key.slice(2).toLowerCase(), v)
    } else if (typeof v === 'boolean') {
      if (v) node.setAttribute(key, '')
    } else {
      node.setAttribute(key, String(v))
    }
  }

  append(node, children)
  return node
}

/** 追加子节点，忽略 null/false/undefined。 */
export function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent
  if (Array.isArray(children)) {
    for (const c of children) append(parent, c)
    return parent
  }
  if (children instanceof Node) {
    parent.appendChild(children)
    return parent
  }
  parent.appendChild(document.createTextNode(String(children)))
  return parent
}

/** 清空并设置子节点。 */
export function setChildren(parent, children) {
  parent.replaceChildren()
  append(parent, children)
  return parent
}
