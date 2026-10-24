/**
 * 模型市场页。
 */

import { el, setChildren } from '../dom.js'
import { createDropdown } from '../dropdown.js'
import { createButton } from '../controls.js'
import { state, emit } from '../store.js'
import { api } from '../api.js'

export function createMarketPage({ onRefresh }) {
  const container = el('div', { class: 'vs-page' })
  let lastSig = ''
  let profileDropdown = null
  let refreshBtn = null

  /** 切换当前角色：只更新配置，不重拉市场。 */
  /** 检测本地模型目录：重新扫描 profiles/ 并刷新下拉和卡片状态。 */
  async function detectLocalModels() {
    state.marketError = ''
    // 重新拉配置（会重新扫描 profiles，返回 profileErrors）
    const cfg = await api.config()
    if (cfg && cfg.ok !== false) {
      state.profiles = cfg.profiles || state.profiles
      state.profile = cfg.effective && cfg.effective.profile ? cfg.effective.profile : null
      if (cfg.effective) {
        state.tts.url = cfg.effective.ttsUrl || ''
        state.svc.url = cfg.effective.svcUrl || ''
      }
    }
    // 再刷一次市场，更新「已安装」标记
    await onRefresh()
  }

  async function switchProfile(id) {
    const r = await api.saveConfig({ profile: id })
    if (r && r.ok === false) {
      state.marketError = r.error || '切换失败'
      emit()
      return
    }
    const cfg = await api.config()
    if (cfg && cfg.ok !== false) {
      state.profiles = cfg.profiles || state.profiles
      state.profile = cfg.effective && cfg.effective.profile ? cfg.effective.profile : null
      if (cfg.effective) {
        state.tts.url = cfg.effective.ttsUrl || ''
        state.svc.url = cfg.effective.svcUrl || ''
      }
      state.marketError = ''
    }
    lastSig = ''
    emit()
  }

  /** 卸载模型。 */
  async function uninstall(m) {
    const lines = [
      '确定卸载「' + m.name + '」吗？',
      '',
      '会删除 profiles/' + m.id + '/ 整个目录（含模型权重），无法恢复。',
    ]
    if (!window.confirm(lines.join(String.fromCharCode(10)))) return

    const r = await api.marketUninstall(m.id)
    if (!r || !r.ok) {
      state.marketError = (r && r.error) || '卸载失败'
      emit()
      return
    }
    await onRefresh()
  }

  async function startDownload(id) {
    if (state.downloadingId) return
    state.downloadingId = id
    state.downloadProgress = { done: 0, total: 1, current: '准备中' }
    state.marketError = ''
    emit()

    // 轮询进度
    const timer = setInterval(async () => {
      try {
        const p = await api.marketProgress(id)
        if (p && p.progress) {
          state.downloadProgress = {
            done: p.progress.done || 0,
            total: p.progress.total || 1,
            current: p.progress.current || '',
          }
          emit()
        }
      } catch { /* 忽略 */ }
    }, 800)

    const r = await api.marketDownload(id)
    clearInterval(timer)
    state.downloadingId = ''
    state.downloadProgress = null
    if (!r || !r.ok) state.marketError = (r && r.error) || '下载失败'
    await onRefresh()
  }

  function fmtSize(n) {
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(0) + ' MB'
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
    return n + ' B'
  }

  function signature() {
    return JSON.stringify({
      profiles: state.profiles.map((p) => p.id),
      current: state.profile ? state.profile.id : '',
      models: state.marketModels.map((m) => [m.id, m.installed, m.fileCount, m.sizeBytes]),
      wakeEnabled: state.wakeEnabled,
      marketCat: state.marketCat || '全部',
      dl: state.downloadingId,
      prog: state.downloadProgress,
      err: state.marketError,
      refreshing: state.refreshing,
      debug: state.marketDebug || '',
    })
  }

  function buildCard(m) {
    const downloading = state.downloadingId === m.id
    let footer = null

    if (downloading) {
      const p = state.downloadProgress
      const pct = p && p.total ? Math.min(100, (p.done / p.total) * 100) : 0
      footer = el('div', { class: 'vs-card__progress' }, [
        el('div', { class: 'vs-bar' }, [
          el('i', { style: { width: pct.toFixed(1) + '%' } }),
        ]),
        el('div', {
          class: 'vs-card__progress-text',
          text: (p && p.current ? p.current + ' · ' : '') + (p ? p.done + '/' + p.total : '准备中'),
        }),
        el('button', {
          class: 'vs-link', type: 'button', text: '取消下载',
          onclick: async (e) => {
            e.stopPropagation()
            const c = await api.marketCancel(m.id)
            if (c && c.ok) {
              state.marketError = '已请求取消，正在停止…'
              emit()
            }
          },
        }),
      ])
    } else if (!m.installed && m.fileCount > 0) {
      footer = createButton({
        label: '下载并安装',
        variant: 'primary',
        onClick: () => { void startDownload(m.id) },
      })
    }

    const head = el('div', { class: 'vs-card__head' }, [
      el('div', { class: 'vs-card__title-wrap' }, [
        el('div', { class: 'vs-card__title', text: m.name }),
        el('div', {
          class: 'vs-card__meta',
          text: (m.category ? m.category + ' · ' : '') + (m.source || '') + ' · ' + (m.language || ''),
        }),
      ]),
      m.needsRef && !m.installed
        ? el('span', { class: 'vs-badge-ref', text: '需自备参考音频' })
        : m.installed
        ? el('span', { class: 'vs-card__installed' }, [
          el('span', { class: 'vs-badge-ok', text: '已安装' }),
          // 内置角色没有实体文件，不给卸载
          m.id === 'builtin' ? null : el('span', { class: 'vs-card__sep', text: '|' }),
          m.id === 'builtin' ? null : el('button', {
            class: 'vs-uninstall',
            type: 'button',
            text: '卸载',
            onclick: (e) => { e.stopPropagation(); void uninstall(m) },
          }),
        ])
        : el('span', {
          class: 'vs-card__size',
          text: m.fileCount > 0 ? (m.sizeBytes > 0 ? '约 ' + fmtSize(m.sizeBytes) : '可下载') : '自备',
        }),
    ])

    const desc = el('div', { class: 'vs-card__desc' }, [
      el('span', { text: m.description }),
      // 有版权风险时挂一个小圆点，说明放 title 里
      m.risk && m.risk !== 'safe'
        ? el('span', { class: 'vs-risk vs-risk--' + m.risk, title: m.riskNote || '可能涉及第三方版权' })
        : null,
    ])

    return el('div', { class: 'vs-card' }, [head, desc, footer])
  }

  function render() {
    if (!refreshBtn) {
      refreshBtn = el('button', {
        class: 'vs-icon-btn',
        type: 'button',
        title: '刷新列表',
        onclick: (e) => {
          e.stopPropagation()
          if (!state.refreshing) onRefresh()
        },
      }, el('img', { src: api.iconUrl('refresh'), alt: '', draggable: 'false' }))
    }
    refreshBtn.classList.toggle('is-spinning', Boolean(state.refreshing))

    const items = state.profiles.map((p) => ({ value: p.id, label: p.name }))
    const cur = state.profile ? state.profile.id : ''

    if (!profileDropdown) {
      profileDropdown = createDropdown({
        items,
        value: cur,
        placeholder: '还没有已安装的模型',
        action: refreshBtn,
        onChange: (id) => { void switchProfile(id) },
      })
    } else {
      profileDropdown.setItems(items)
      profileDropdown.setValue(cur)
    }

    const sig = signature()
    if (sig === lastSig) return
    lastSig = sig

    // 按分类过滤 + 内置语音置顶
    const cat = state.marketCat || '全部'
    let pool = state.marketModels.filter((m) => cat === '全部' || (m.category || '其他') === cat)
    const ordered = [
      ...pool.filter((m) => m.id === 'builtin'),
      ...pool.filter((m) => m.id !== 'builtin'),
    ]

    setChildren(container, [
      // 模型市场标题
      el('div', { class: 'vs-market-title' }, [
        el('div', { class: 'vs-market-title__main', text: '模型市场' }),
        el('div', {
          class: 'vs-market-title__sub',
          text: '仅供学习交流使用。模型版权归原作者所有，请遵守各模型的使用许可，',
        }),
        el('div', {
          class: 'vs-market-title__sub',
          text: '勿用于商业用途。下载即表示你已知晓并同意承担相应责任。',
        }),
      ]),

      el('div', { class: 'vs-cats' }, [
        // 分类从实际数据里取，避免出现空分类
        (() => {
          const cats = ['全部']
          const seen = new Set()
          for (const m of state.marketModels) {
            const c = m.category || '其他'
            if (!seen.has(c)) { seen.add(c); cats.push(c) }
          }
          return cats
        })().map((c) => {
          const btn = el('button', {
            class: 'vs-cat' + ((state.marketCat || '全部') === c ? ' is-active' : ''),
            type: 'button',
            text: c,
            onclick: () => {
              state.marketCat = c
              lastSig = ''
              emit()
            },
          })
          return btn
        }),
      ]),
      el('div', { class: 'vs-field' }, [
        el('div', { class: 'vs-field__head' }, [
          el('span', { class: 'vs-field__label', text: '当前模型' }),
          state.profilesSize
            ? el('span', { class: 'vs-field__hint', text: '本地占用 ' + state.profilesSize })
            : null,
        ]),
        profileDropdown.root,
        el('div', { class: 'vs-actions vs-actions--local' }, [
          el('button', {
            class: 'vs-link vs-link--local',
            type: 'button',
            text: '打开模型文件夹',
            onclick: () => { void api.openFolder('profile') },
          }),
          el('button', {
            class: 'vs-link vs-link--local',
            type: 'button',
            text: '刷新本地模型',
            onclick: () => { void detectLocalModels() },
          }),
        ]),
      ]),
      el('div', { class: 'vs-field' }, [
        el('div', { class: 'vs-field__head' }, [
          el('span', { class: 'vs-field__label', text: 'QQ 桥接' }),
        ]),
        el('label', { class: 'vs-row vs-row--switch' }, [
          el('span', { class: 'vs-row__label' }, [
            el('span', { text: '允许 QQ bot 唤醒' }),
            el('span', { class: 'vs-row__hint', text: '打开后 qq-bridge 可自动拉起语音/唱歌模型' }),
          ]),
          el('span', { class: 'vs-switch' }, [
            (() => {
              const input = el('input', { type: 'checkbox', class: 'vs-switch__input' })
              input.checked = state.wakeEnabled !== false
              input.addEventListener('change', async () => {
                state.wakeEnabled = input.checked
                await api.saveConfig({ wakeEnabled: input.checked })
                emit()
              })
              return input
            })(),
            el('span', { class: 'vs-switch__knob' }),
          ]),
        ]),
      ]),
      state.marketError ? el('div', { class: 'vs-error', text: state.marketError }) : null,
      !state.marketModels.length
        ? el('div', {
          class: 'vs-hint',
          text: state.marketError ? '' : '正在加载…',
        })
        : null,
      el('div', { class: 'vs-sep' }),
      ...ordered.map(buildCard),
    ])
  }

  return { root: container, render }
}
