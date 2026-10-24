/**
 * dsh-voice-studio-plugin — 设置页 Client 半边。
 *
 * 以 dsh.client bundle 格式加载（与 dsh-meme / our-free-model 同款）：
 * 在左下角头像打开的设置界面注册一个「语音」栏目。
 * 立绘入口关闭后，用户仍可在这里使用全部功能：说话、唱歌、歌源、
 * 模型市场、外观。
 *
 * UI 风格对齐其它 DSH 插件（dsh-meme 等）：全部使用 --dsw-alias-* 主题变量。
 */
window.__ModuleLoader__.load({
  id: 'dsh-voice-studio-plugin',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const logClient = (msg) => {
      try {
        fetch(ROUTE + '/clientlog', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msg: String(msg).slice(0, 500), level: 'info' }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* 忽略 */ }
    }
    const { createElement: h, useState, useEffect, useRef, useCallback } = React

    const ROUTE = '/voice-studio'

    const THEMES = [
      { value: 'whale', label: '鲸鱼娘', accent: '#4a7fd4' },
      { value: 'sakura', label: '樱粉', accent: '#ff7ab0' },
      { value: 'sky', label: '天青', accent: '#31c4d4' },
      { value: 'forest', label: '森绿', accent: '#9ece6a' },
      { value: 'amber', label: '暖橙', accent: '#e0a458' },
      { value: 'violet', label: '黛紫', accent: '#a78bfa' },
    ]

    const CSS = `
.vs-voice-speak-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:28px;padding:6px;line-height:1}.vs-voice-speak-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.vs-voice-speak-btn:disabled{opacity:.45;cursor:default}.vs-voice-speak-icon{display:inline-flex}.vs-voice-speak-icon.is-speaking{animation:vs-voice-speak-pulse 1s ease-in-out infinite}@keyframes vs-voice-speak-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.vs-voice{display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary);padding:2px 0}
.vs-voice-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.vs-voice-title{font-size:15px;font-weight:600;margin:0;line-height:1.4}
.vs-voice-status{display:flex;gap:8px;flex-wrap:wrap}
.vs-voice-tabs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%}
.vs-voice-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0;overflow-x:auto;scrollbar-width:none}
.vs-voice-tabs::-webkit-scrollbar{display:none}
.vs-voice-tab{border:none;background:transparent;cursor:pointer;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);padding:6px 12px;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:0;white-space:nowrap;transition:color .12s ease}
.vs-voice-tab:hover{color:var(--dsw-alias-label-primary);background:transparent;border-color:transparent;border-bottom-color:transparent}
.vs-voice-tab.active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.vs-voice-tab-hint{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:0 0 auto}
.vs-voice-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;line-height:1.6}
.vs-voice-pill i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.vs-voice-pill.on{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.vs-voice-sec{display:flex;flex-direction:column;gap:8px}
.vs-voice-sec-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.05em;margin:0}
.vs-voice-card{display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px}
.vs-f{display:flex;flex-direction:column;gap:6px;min-width:0}
.vs-f-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.vs-f-label{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.vs-f-name{font-size:12.5px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.vs-f-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;overflow-wrap:anywhere}
.vs-f-val{font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:0 0 auto;white-space:nowrap}
.vs-switch{position:relative;width:38px;height:21px;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer;transition:background .15s ease;flex:none;display:inline-block}
.vs-switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:inherit}
.vs-switch i{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s ease;pointer-events:none}
.vs-switch:has(input:checked){background:var(--dsw-alias-brand-primary)}
.vs-switch:has(input:checked) i{transform:translateX(17px)}
.vs-voice input[type=range]{accent-color:var(--dsw-alias-brand-primary);width:100%;margin:0}
.vs-voice select{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:12.5px;outline:none;transition:border-color .12s ease;width:100%;margin-top:2px}
.vs-voice select:focus{border-color:var(--dsw-alias-brand-primary)}
.vs-voice input[type=color]{width:40px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.vs-voice-actions{display:flex;gap:8px;flex-wrap:wrap}
.vs-voice-seg{display:inline-flex;align-items:stretch;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px;gap:2px}
.vs-voice-seg-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 14px;border-radius:999px;cursor:pointer;white-space:nowrap;transition:color .12s ease,background .12s ease}
.vs-voice-seg-btn.active{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent)}
.vs-voice button{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 14px;font-size:12.5px;font-family:inherit;cursor:pointer;transition:border-color .12s ease,background .12s ease,opacity .12s}
.vs-voice button:hover{border-color:var(--dsw-alias-brand-primary)}
.vs-voice button:disabled{opacity:.5;cursor:default}
.vs-voice button.btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.vs-voice button.btn-primary:hover{background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}
.vs-voice button.danger:hover{border-color:#e5484d;color:#e5484d}
.vs-voice-note{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:8px 12px}
.vs-voice-note.err{color:#ff9d9d;border-color:rgba(255,157,157,.35);background:rgba(255,157,157,.08)}
.vs-voice-loading{font-size:12px;color:var(--dsw-alias-label-secondary);padding:12px 0}
.vs-voice-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.vs-voice-meta b{color:var(--dsw-alias-label-primary);font-weight:600}
.vs-voice-models{display:flex;flex-direction:column;gap:8px}
.vs-voice-model{display:flex;flex-direction:column;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:10px 12px}
.vs-voice-model-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.vs-voice-model-title{font-size:12.5px;font-weight:600;overflow-wrap:anywhere}
.vs-voice-model-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vs-voice-model-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.vs-voice-badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);border-radius:999px;padding:1px 8px;line-height:1.6;flex:none}
.vs-voice-badge.warn{color:#c9a35f;border-color:rgba(201,163,95,.4);background:rgba(201,163,95,.1)}
.vs-voice-progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:4px}
.vs-voice-progress i{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;transition:width .3s ease}
`
    function installCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-voice-studio-plugin-settings"]')) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', 'dsh-voice-studio-plugin-settings')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    function Switch({ checked, onChange, label }) {
      return h('label', { className: 'vs-switch', title: label },
        h('input', { type: 'checkbox', checked: Boolean(checked), onChange: (e) => onChange(e.target.checked) }),
        h('i', null))
    }

    function Field({ name, hint, value, control }) {
      return h('div', { className: 'vs-f' },
        h('div', { className: 'vs-f-head' },
          h('div', { className: 'vs-f-label' },
            h('span', { className: 'vs-f-name' }, name),
            hint ? h('span', { className: 'vs-f-hint' }, hint) : null),
          value ? h('span', { className: 'vs-f-val' }, value) : null),
        control)
    }

    function SwitchRow({ name, hint, checked, onChange }) {
      return h('div', { className: 'vs-f' },
        h('div', { className: 'vs-f-head' },
          h('div', { className: 'vs-f-label' },
            h('span', { className: 'vs-f-name' }, name),
            hint ? h('span', { className: 'vs-f-hint' }, hint) : null),
          h(Switch, { checked, onChange, label: name })))
    }

    function RangeField({ name, hint, value, min, max, step, fmt, onChange }) {
      const display = fmt ? fmt(value) : String(value)
      return h(Field, {
        name, hint, value: display,
        control: h('input', {
          type: 'range', min: String(min), max: String(max), step: String(step),
          value: String(value),
          onChange: (e) => onChange(Number(e.target.value)),
        }),
      })
    }

    function SelectField({ name, value, options, onChange }) {
      return h(Field, {
        name, value: null,
        control: h('select', { value: String(value ?? ''), onChange: (e) => onChange(e.target.value) },
          options.map((o) => h('option', { key: o.value, value: o.value }, o.label))),
      })
    }

    function Section({ title, children }) {
      return h('div', { className: 'vs-voice-sec' }, [
        h('h3', { className: 'vs-voice-sec-title' }, title),
        h('div', { className: 'vs-voice-card' },
          Array.isArray(children) ? children : [children]),
      ])
    }

    const pct = (v) => v + '%'
    const x100 = (v) => (v / 100).toFixed(2)
    const mins = (v) => (v === 0 ? '从不' : v + ' 分钟')
    const px = (v) => v + ' px'
    function VoiceSettings() {
      const [cfg, setCfg] = useState(null)
      const [profiles, setProfiles] = useState([])
      const [status, setStatus] = useState(null)
      const [songs, setSongs] = useState([])
      const [market, setMarket] = useState(null)
      const [marketErr, setMarketErr] = useState('')
      const [progress, setProgress] = useState(null)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')
      const [saving, setSaving] = useState(false)
      const [tab, setTab] = useState('voice')
      const timer = useRef(null)
      const noticeTimer = useRef(null)

      const refresh = useCallback(() => {
        fetch(ROUTE + '/config')
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok) {
              setCfg(d.config)
              setProfiles(d.profiles || [])
            }
          })
          .catch(() => {})
        fetch(ROUTE + '/status')
          .then((r) => r.json())
          .then((d) => { if (d && d.ok) setStatus(d) })
          .catch(() => {})
      }, [])

      const save = useCallback((patch) => {
        setCfg((c) => (c ? { ...c, ...patch } : c))
        setSaving(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          fetch(ROUTE + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          }).catch(() => {}).finally(() => setSaving(false))
        }, 250)
      }, [])

      const post = useCallback((path) => {
        return fetch(ROUTE + path, { method: 'POST' })
          .then((r) => r.json())
          .catch(() => ({ ok: false, error: '请求失败' }))
      }, [])

      const notice2 = useCallback((msg) => {
        setNotice(msg || '')
        clearTimeout(noticeTimer.current)
        if (msg) noticeTimer.current = setTimeout(() => setNotice(''), 6000)
      }, [])

      const loadSongs = useCallback(() => {
        fetch(ROUTE + '/songs')
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok) setSongs(d.songs || [])
            else setSongs([])
          })
          .catch(() => setSongs([]))
      }, [])

      const loadMarket = useCallback(() => {
        setMarketErr('')
        fetch(ROUTE + '/market')
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok) setMarket(d)
            else setMarketErr((d && d.error) || '市场加载失败')
          })
          .catch(() => setMarketErr('市场加载失败'))
      }, [])

      const refreshAll = useCallback(() => {
        refresh()
        loadSongs()
        loadMarket()
      }, [refresh, loadSongs, loadMarket])

      useEffect(() => {
        refreshAll()
      }, [refreshAll])

      useEffect(() => {
        const t = setInterval(() => {
          if (!progress || !progress.id) return
          fetch(ROUTE + '/market/progress?id=' + encodeURIComponent(progress.id))
            .then((r) => r.json())
            .then((d) => {
              if (d && d.progress) setProgress((p) => (p && p.id === d.progress.id ? d.progress : p))
            })
            .catch(() => {})
        }, 900)
        return () => clearInterval(t)
      }, [progress && progress.id])

      if (!cfg) {
        return h('div', { className: 'vs-voice' },
          h('div', { className: 'vs-voice-loading' }, '加载中…'))
      }

      const themeAccent = (THEMES.find((t) => t.value === cfg.theme) || THEMES[0]).accent
      const ttsUp = Boolean(status && status.tts && status.tts.up)
      const svcUp = Boolean(status && status.svc && status.svc.up)
      const TABS = [
        { id: 'voice', label: '语音' },
        { id: 'sing', label: '唱歌' },
        { id: 'market', label: '模型市场' },
        { id: 'look', label: '外观' },
      ]
      const tabBar = h('div', { className: 'vs-voice-tabs-row' }, [
        h('div', { className: 'vs-voice-tabs', role: 'tablist' },
          TABS.map((t) => h('button', {
            key: t.id,
            type: 'button',
            role: 'tab',
            'aria-selected': String(tab === t.id),
            className: 'vs-voice-tab' + (tab === t.id ? ' active' : ''),
            onClick: () => setTab(t.id),
          }, t.label))),
        h('span', { className: 'vs-voice-tab-hint' }, saving ? '保存中…' : ''),
      ])

      const children = [
        h('div', { className: 'vs-voice-head' }, [
          h('h2', { className: 'vs-voice-title' }, '语音工作室'),
          h('div', { className: 'vs-voice-status' }, [
            h('span', { className: 'vs-voice-pill' + (ttsUp ? ' on' : '') }, [h('i', null), '说话 ' + (ttsUp ? '在线' : '离线')]),
            h('span', { className: 'vs-voice-pill' + (svcUp ? ' on' : '') }, [h('i', null), '唱歌 ' + (svcUp ? '在线' : '离线')]),
          ]),
        ]),
        tabBar,
        notice ? h('div', { className: 'vs-voice-note err' }, notice) : null,
        saving ? h('div', { className: 'vs-voice-note' }, '正在保存…') : null,
      ]

      if (tab === 'voice') {
        children.push(
          Section({
            title: '说话',
            children: [
              SwitchRow({ name: '说话开关', hint: '关闭后不会朗读', checked: cfg.enabled !== false, onChange: (v) => save({ enabled: v }) }),
              SwitchRow({ name: '自动读回复', hint: 'AI 回复后自动读出来', checked: cfg.autoSpeak === true, onChange: (v) => save({ autoSpeak: v }) }),
              RangeField({ name: '音量', value: Math.round(cfg.volume * 100), min: 0, max: 100, step: 5, fmt: pct, onChange: (v) => save({ volume: v / 100 }) }),
              RangeField({ name: '语速', value: Math.round(cfg.speed * 100), min: 50, max: 200, step: 5, fmt: (v) => (v / 100).toFixed(2) + '×', onChange: (v) => save({ speed: v / 100 }) }),
              RangeField({ name: '温度', hint: '越高越有起伏感，越低越平稳；情感主要靠参考音频', value: Math.round(cfg.temperature * 100), min: 5, max: 200, step: 5, fmt: x100, onChange: (v) => save({ temperature: v / 100 }) }),
              RangeField({ name: '句间停顿', hint: '句子之间停多久，停顿越长语速越从容', value: Math.round(cfg.fragmentInterval * 100), min: 0, max: 200, step: 5, fmt: (v) => x100(v) + ' 秒', onChange: (v) => save({ fragmentInterval: v / 100 }) }),
              RangeField({ name: '选词范围', hint: '每步从最可能的几个发音片段里挑：大=多变，小=稳定', value: cfg.topK, min: 1, max: 30, step: 1, onChange: (v) => save({ topK: v }) }),
              RangeField({ name: '选词概率', hint: '发音片段候选池大小：接近 1 自然，调小保守', value: Math.round(cfg.topP * 100), min: 10, max: 100, step: 5, fmt: x100, onChange: (v) => save({ topP: v / 100 }) }),
              RangeField({ name: '重复抑制', hint: '防止同一个音打转：越大越抑制重复发音，1 为不抑制', value: Math.round(cfg.repetitionPenalty * 100), min: 50, max: 200, step: 5, fmt: x100, onChange: (v) => save({ repetitionPenalty: v / 100 }) }),
              RangeField({ name: '闲置冷却', hint: '预热后长时间不用自动卸载', value: Math.round(cfg.idleUnloadMs / 60000), min: 0, max: 30, step: 1, fmt: mins, onChange: (v) => save({ idleUnloadMs: v * 60000 }) }),
              SwitchRow({ name: '退出卸载', hint: '退出程序后释放说话模型显存', checked: cfg.ttsUnloadOnExit !== false, onChange: (v) => save({ ttsUnloadOnExit: v }) }),
            ],
          }),
          Section({
            title: '模型与服务',
            children: [
              SelectField({
                name: '当前角色',
                value: cfg.profile || '',
                options: profiles.map((p) => ({ value: p.id, label: p.name + (p.engine === 'sapi' ? '（系统语音）' : '') })),
                onChange: (v) => save({ profile: v }),
              }),
              h('div', { className: 'vs-voice-actions' }, [
                h('button', { className: 'btn-primary', disabled: busy === 'tts', onClick: () => { setBusy('tts'); post('/tts-warm').then(() => { setBusy(''); refresh() }) } },
                  busy === 'tts' ? '处理中…' : (status && status.tts && status.tts.warm ? '取消预热说话' : '预热说话')),
                h('button', { disabled: busy === 'svc', onClick: () => { setBusy('svc'); post('/svc-toggle').then(() => { setBusy(''); refresh() }) } },
                  busy === 'svc' ? '处理中…' : (status && status.svc && status.svc.warm ? '取消预热唱歌' : '预热唱歌')),
              ]),
              SwitchRow({ name: 'QQ 桥接', hint: '允许 qq-bridge 自动唤醒语音/唱歌模型', checked: cfg.wakeEnabled !== false, onChange: (v) => save({ wakeEnabled: v }) }),
              h('div', { className: 'vs-voice-note' },
                '说话唱歌都会自动加载；手动打开后第一句不用等加载，打开后占用显存。'),
            ],
          }),
        )
      }

      if (tab === 'sing') {
        children.push(
          Section({
            title: '唱歌',
            children: [
              SwitchRow({ name: '唱歌开关', hint: '关闭后唱歌功能不可用', checked: cfg.svcEnabled !== false, onChange: (v) => save({ svcEnabled: v }) }),
              RangeField({ name: '扩散步数', hint: '越高越细腻，耗时也越长', value: cfg.svcSteps, min: 10, max: 60, step: 5, onChange: (v) => save({ svcSteps: v }) }),
              SelectField({ name: '伴奏处理', value: cfg.backing, options: [{ value: 'keep', label: '分离人声，唱完混回伴奏' }, { value: 'remove', label: '只输出人声' }], onChange: (v) => save({ backing: v }) }),
              RangeField({ name: '人声音量', value: Math.round(cfg.vocalGain * 100), min: 0, max: 150, step: 5, fmt: x100, onChange: (v) => save({ vocalGain: v / 100 }) }),
              RangeField({ name: '伴奏音量', value: Math.round(cfg.backingGain * 100), min: 0, max: 150, step: 5, fmt: x100, onChange: (v) => save({ backingGain: v / 100 }) }),
              SwitchRow({ name: '退出卸载', hint: '退出程序后释放唱歌模型显存', checked: cfg.svcUnloadOnExit !== false, onChange: (v) => save({ svcUnloadOnExit: v }) }),
            ],
          }),
          Section({
            title: '歌源',
            children: [
              h('div', { className: 'vs-voice-meta' }, [
                h('span', null, '可用歌曲 ', h('b', null, String(songs.length))),
                h('span', null, '目录 ', h('b', null, cfg.svcCwd ? String(cfg.svcCwd).replace(/\\/g, '/') + '/songs' : '唱歌服务目录下的 songs')),
              ]),
              h('div', { className: 'vs-voice-actions' }, [
                h('button', { onClick: () => { post('/open-folder?which=songs').then(() => notice2('已打开歌源文件夹')) } }, '打开歌源文件夹'),
                h('button', { onClick: () => { loadSongs(); notice2('已刷新歌源') } }, '刷新歌源'),
              ]),
              songs.length === 0
                ? h('div', { className: 'vs-voice-note' }, '歌源里还没有文件，把歌曲放到上面的目录里再刷新。')
                : null,
            ],
          }),
        )
      }

      if (tab === 'look') {
        children.push(
          Section({
            title: '外观',
            children: [
              SwitchRow({ name: '显示立绘', hint: '关闭后不再显示小立绘入口', checked: cfg.widgetVisible !== false, onChange: (v) => save({ widgetVisible: v }) }),
              SelectField({ name: '主题', value: cfg.theme, options: THEMES, onChange: (v) => save({ theme: v, accent: '' }) }),
              h(Field, {
                name: '主色', value: null,
                control: h('input', {
                  type: 'color',
                  value: cfg.accent || themeAccent,
                  onChange: (e) => save({ accent: e.target.value }),
                }),
              }),
              RangeField({ name: '立绘大小', value: cfg.widgetSize, min: 64, max: 240, step: 4, fmt: px, onChange: (v) => save({ widgetSize: v }) }),
              SwitchRow({ name: '左右翻转', hint: '翻转小立绘朝向', checked: cfg.widgetFlip !== false, onChange: (v) => save({ widgetFlip: v }) }),
              RangeField({ name: '毛玻璃', value: cfg.glassBlur, min: 0, max: 40, step: 2, fmt: (v) => (v === 0 ? '关' : v + ' px'), onChange: (v) => save({ glassBlur: v }) }),
            ],
          }),
        )
      }

      if (tab === 'market') {
        const models = (market && market.models) || []
        children.push(
          Section({
            title: '模型市场',
            children: [
              market && market.notice ? h('div', { className: 'vs-voice-note' }, market.notice) : null,
              marketErr ? h('div', { className: 'vs-voice-note err' }, marketErr) : null,
              market ? h('div', { className: 'vs-voice-meta' }, [
                h('span', null, '共 ', h('b', null, String(models.length)), ' 个模型'),
                h('span', null, '本地占用 ', h('b', null, market.profilesSize || '')),
              ]) : null,
              h('div', { className: 'vs-voice-actions' }, [
                h('button', { onClick: () => { post('/open-folder?which=profile').then(() => notice2('已打开模型文件夹')) } }, '打开模型文件夹'),
                h('button', { onClick: () => { loadMarket(); refresh(); notice2('已刷新') } }, '刷新'),
              ]),
              market
                ? h('div', { className: 'vs-voice-models' },
                  models.slice(0, 60).map((m) => {
                    const downloading = progress && progress.id === m.id
                    return h('div', { key: m.id, className: 'vs-voice-model' }, [
                      h('div', { className: 'vs-voice-model-head' }, [
                        h('div', { className: 'vs-voice-model-title' }, m.name),
                        m.installed
                          ? h('span', { className: 'vs-voice-badge' }, '已安装')
                          : (m.needsRef ? h('span', { className: 'vs-voice-badge warn' }, '需自备参考音频')
                            : (m.risk && m.risk !== 'safe' ? h('span', { className: 'vs-voice-badge warn' }, '注意版权') : null)),
                      ]),
                      h('div', { className: 'vs-voice-model-meta' },
                        (m.category ? m.category + ' · ' : '') + (m.source || '') + ' · ' + (m.language || '')
                        + ' · ' + (m.sizeBytes > 0 ? (m.sizeBytes >= 1048576 ? Math.round(m.sizeBytes / 1048576) + ' MB' : Math.round(m.sizeBytes / 1024) + ' KB') : m.fileCount + ' 个文件')),
                      m.description ? h('div', { className: 'vs-voice-model-desc' }, m.description) : null,
                      h('div', { className: 'vs-voice-actions' }, [
                        m.installed
                          ? h('button', {
                            className: 'danger',
                            disabled: m.id === 'builtin' || busy === 'uninstall',
                            onClick: () => {
                              setBusy('uninstall')
                              fetch(ROUTE + '/market/uninstall', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ id: m.id }),
                              })
                                .then((r) => r.json())
                                .then((d) => {
                                  setBusy('')
                                  notice2((d && d.ok) ? '已卸载 ' + m.name : ((d && d.error) || '卸载失败'))
                                  refreshAll()
                                })
                                .catch(() => { setBusy(''); notice2('卸载失败') })
                            },
                          }, '卸载')
                          : null,
                        !m.installed && m.fileCount > 0
                          ? h('div', { className: 'vs-voice-actions' }, [
                            h('button', {
                              className: 'btn-primary',
                              disabled: busy === m.id,
                              onClick: () => {
                                setBusy(m.id)
                                setProgress({ id: m.id, done: 0, total: m.fileCount, current: '准备中' })
                                fetch(ROUTE + '/market/download', {
                                  method: 'POST',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ id: m.id }),
                                })
                                  .then((r) => r.json())
                                  .then((d) => {
                                    setProgress(null)
                                    setBusy('')
                                    if (d && !d.ok) notice2((d && d.error) || '下载失败')
                                    else notice2('已安装 ' + m.name)
                                    refreshAll()
                                  })
                                  .catch(() => { setProgress(null); setBusy(''); notice2('下载失败') })
                              },
                            }, busy === m.id ? '下载中…' : '下载安装'),
                            busy === m.id
                              ? h('button', {
                                className: 'danger',
                                onClick: () => {
                                  fetch(ROUTE + '/market/cancel?id=' + encodeURIComponent(m.id))
                                    .then((r) => r.json())
                                    .then((d) => { notice2((d && d.ok) ? '已取消，正在停止…' : '取消失败') })
                                    .catch(() => notice2('取消失败'))
                                },
                              }, '取消')
                              : null,
                          ])
                          : null,
                      ]),
                      downloading ? h('div', { className: 'vs-voice-progress' }, [
                        h('i', { style: { width: Math.min(100, (progress.total > 0 ? (progress.done / progress.total) * 100 : 0)).toFixed(1) + '%' } }),
                      ]) : null,
                    ])
                  }))
                : null,
            ],
          }),
        )
      }

      return h('div', { className: 'vs-voice' }, children)
    }

    /**
     * 从会话消息树里按 messageId 提取 assistant 文本。
     * legacy.nodes 形如 [{kind:'assistant', messageId, blocks:[{kind:'text', text}]}]
     */
    function messageText(legacy, messageId) {
      if (!legacy || !Array.isArray(legacy.nodes)) return ''
      for (const node of legacy.nodes) {
        if (!node || node.kind !== 'assistant' || node.messageId !== messageId) continue
        if (Array.isArray(node.blocks)) {
          return node.blocks
            .filter((b) => b && b.kind === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('\n\n')
        }
        if (typeof node.text === 'string') return node.text
        if (typeof node.content === 'string') return node.content
      }
      return ''
    }

    /** 小喇叭按钮：读「当前这一条」AI 回复。 */
    function SpeakAction({ sessionId, messageId, useChat }) {
      const [busy, setBusy] = useState(false)
      const legacy = useChat ? useChat((chat) => chat.legacy) : null
      const text = legacy ? messageText(legacy, messageId) : ''
      // 诊断：记录一次槽位注入情况
      useEffect(() => {
        logClient('小喇叭注入: messageId=' + messageId + ' hasUseChat=' + !!useChat + ' nodes=' + (legacy && Array.isArray(legacy.nodes) ? legacy.nodes.length : 'null') + ' textLen=' + text.length)
      }, [])
      const onSpeak = useCallback(async () => {
        if (busy || !text) return
        setBusy(true)
        try {
          const g = window.__DSH_VOICE_STUDIO__
          const r = g && typeof g.speak === 'function'
            ? await g.speak(text, messageId)
            : { ok: false, error: '语音组件未就绪' }
          if (!r || !r.ok) console.warn('[voice-studio] 朗读失败:', r && r.error)
        } catch (e) {
          console.warn('[voice-studio] 朗读请求失败:', e && e.message)
        } finally {
          setBusy(false)
        }
      }, [busy, text, messageId])
      // 取不到文本也显示禁用喇叭，方便发现槽位是否注入成功
      if (!text) {
        return h('button', {
          type: 'button',
          className: 'vs-voice-speak-btn',
          title: '暂无文本',
          'data-voice-speak': '1',
          disabled: true,
        }, h('svg', {
          width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
          'aria-hidden': 'true',
        }, [
          h('path', { key: 'p1', d: 'M11 5L6 9H3v6h3l5 4V5z', fill: 'currentColor' }),
          h('path', { key: 'p2', d: 'M15.54 8.46a5 5 0 010 7.07', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
          h('path', { key: 'p3', d: 'M18.36 5.64a9 9 0 010 12.72', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
        ]))
      }
      return h('button', {
        type: 'button',
        className: 'vs-voice-speak-btn',
        title: busy ? '朗读中…' : '朗读此回复',
        'data-voice-speak': '1',
        onClick: onSpeak,
        disabled: busy,
      }, h('svg', {
        className: 'vs-voice-speak-icon' + (busy ? ' is-speaking' : ''),
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'p1', d: 'M11 5L6 9H3v6h3l5 4V5z', fill: 'currentColor' }),
        h('path', { key: 'p2', d: 'M15.54 8.46a5 5 0 010 7.07', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
        h('path', { key: 'p3', d: 'M18.36 5.64a9 9 0 010 12.72', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
      ]))
    }

    function apply(ctx) {
      installCss()
      let slots = null
      try { slots = ctx.get ? ctx.get('slots') : undefined } catch { slots = undefined }
      if (!slots) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'voice-studio', order: 30, label: '语音' },
        () => h(VoiceSettings, {}),
      ))
      // 对话消息操作行加小喇叭：跟在复制/赞/踩后面，直接读该条 AI 回复
      try {
        logClient('注册小喇叭槽位 assistant-actions')
        slots.inject('conversation.chat.assistant-actions', () => slots.register(
          { name: 'conversation.chat.assistant-actions', id: 'voice-studio-speak', order: 95 },
          (props) => {
            logClient('小喇叭槽位命中: ' + JSON.stringify({ id: props && props.messageId, hasChat: !!(props && props.useChat) }))
            return h(SpeakAction, props || {})
          },
        ))
      } catch (e) {
        logClient('小喇叭槽位注册失败: ' + (e && e.message))
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.name = 'dsh-voice-studio-plugin'
    return module.exports
  },
})
