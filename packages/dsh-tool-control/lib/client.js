/**
 * dsh-tool-control client half — the plugin's card on the Plugins settings page.
 *
 * The Host half declares its Config with schemastery; the volatile fields are
 * served live by the Host's settings service under the entry namespace
 * `tool-control-row`. This file binds that namespace onto a form card and
 * registers it into the `plugins.bundle.config` slot, keyed on the bundle
 * package name — the same pattern dsh-context uses (configForms binding plus a
 * `whileServed` guard so the card vanishes where the Host serves no namespace).
 *
 * Controls come from `@deepseek-ai/dsh-client-ui-primitives` — the SAME Switch
 * and SegmentedControl every other settings row uses. An earlier revision
 * hand-rolled a button+span toggle, which looked and behaved unlike the rest of
 * the page (no design-token styling, no keyboard semantics, no pressed-state
 * animation). Reusing the primitives is what keeps this card indistinguishable
 * from a first-party settings surface.
 *
 * Nothing here invents storage: reads and writes go through
 * `ctx.configForms.get("tool-control-row")`, whose `set` persists to the
 * Host and whose snapshot already carries schema defaults. Edits take effect on
 * the NEXT REQUEST — the Host reshapes the tool list during prompt assembly, so
 * a mode switch needs no restart and no re-registration.
 *
 * @module dsh-tool-control/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-tool-control',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var el = React.createElement

    // ── 轻量线性图标：与 dsh-prompt-control / dsh-skill-control 同一套 ──────
    var ICON_PATHS = {
      toolbox: ['M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1', 'M3 12h18', 'M10 12v2h4v-2'],
      chevronUp: ['M6 15l6-6 6 6'],
      chevronDown: ['M6 9l6 6 6-6'],
    }
    function icon(name) {
      var paths = ICON_PATHS[name] || []
      return el('svg', {
        key: 'ico-' + name,
        className: 'dsh-tc-ico',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true',
      }, paths.map(function (d, i) { return el('path', { key: i, d: d }) }))
    }
    // Official primitives. A deployment without this package degrades to plain
    // elements rather than a blank card, so the fallbacks below are deliberate.
    var primitives = (function () {
      try { return require('@deepseek-ai/dsh-client-ui-primitives') || {} } catch (_) { return {} }
    })()

    var NAMESPACE = 'tool-control-row'
    var NS = 'toolControl'
    var DICTS = {
      zh: {
        sectionTitle: '工具管理',
        bundleTitle: 'Tool Control',
        switchPreset: '切换预设:',
        allPresets: '全部预设',
        enableSlimming: '工具瘦身',
        enableSlimmingDesc: '把低频工具的完整说明从每次请求里省下来；工具仍可调用，参数按需读取。',
        enableSlimmingSwitch: '启用工具瘦身',
        fallbackMode: '其余工具',
        fallbackModeDesc: '不匹配任何规则的插件工具怎么处理 —— 包括以后新装插件带来的工具。',
        fallbackModeDescFull: '（full = 一律保留完整，不隐藏任何东西）',
        fallbackModeLabel: '其余工具的处理方式',
        perToolSettings: '逐个工具设置',
        scanHistoryUpdating: '更新历史调用',
        scanHistoryLoad: '载入历史调用',
        scanHistoryScanning: '扫描中…',
        scanHistoryTitle: '从 ~/.dsh/sessions 扫描历史会话中的工具调用次数',
        refreshTools: '刷新',
        refreshToolsTitle: '重新读取工具列表（新装插件的工具会出现）',
        aiOptimize: 'AI优化',
        aiOptimizeHint: '打开新会话，让 Agent 根据 tool-control-optimize 技能自动优化工具可见性配置',
        aiOptimizeCopied: '已复制优化指令',
        aiOptimizePrompt: '/tool-control-optimize 请根据 tool-control-optimize 技能检查当前工具清单与历史调用次数，按最优方案调整工具可见性模式并持久化保存，然后汇报优化前后工具上下文 Token 变化。',
        statusFailed: '读取失败',
        statusLoading: '读取中…',
        searchPlaceholder: '搜索工具名、说明、来源插件或预设…',
        sort: '排序',
        scope: '只看',
        restrictedPresets: '限定工具集的预设：',
        loadError: '读取工具列表遇到问题：{error}。点击「刷新」重试，或检查服务连接。下方规则配置依然生效。',
        noTools: '当前没有可展示的工具。',
        noMatchingTools: '没有符合当前筛选条件的工具。',
        batchFull: '全保留',
        batchStub: '全Stub',
        batchHidden: '全隐藏',
        batchFullTitle: '将该插件的所有工具设为保留完整',
        batchStubTitle: '将该插件的所有工具设为只留名字',
        batchHiddenTitle: '将该插件的所有工具设为隐藏',
        pinnedTag: '已指定',
        orderedTag: '已排序',
        presetPrefixTag: '预设: ',
        allPresetsTag: '全部预设',
        moveUp: '在提示词中上移',
        moveDown: '在提示词中下移',
        clearOrder: '移出手动顺序',
        footerNote: '改动保存后立即生效，无需重启。调用次数包含当前运行与 ~/.dsh/sessions 历史所有会话，开机自动统计。',
        mode_full: '保留完整',
        mode_stub: '只留名字',
        mode_hidden: '隐藏',
        mode_name: 'API 延迟',
        mode_disabled: '禁用',
        sort_calls: '按调用次数',
        sort_name: '按名称',
        sort_size: '按体积',
        sort_mode: '按模式',
        sort_custom: '手动顺序',
        scope_all: '全部',
        scope_hidden: '仅隐藏',
        scope_stub: '仅只留名字',
        scope_full: '仅保留完整',
        scope_disabled: '仅禁用',
        scope_used: '有调用',
        sourceBuiltin: '内置',
        statsSummary: '{prefix}{total} 个工具 · {resident} 保留 · {stub} 只留名字 · {hidden} 隐藏 · {called} 个有调用记录{history}',
        historySessions: '（已载入 {count} 个历史会话）',
        statsDisabled: '{prefix}瘦身未启用 · 提示词包含全部工具（约 {tokens} tokens）',
        statsSaved: '{prefix}工具上下文：原 {full} → 现 {prompt} tokens（节省 {percent}% · 约 {saved} tokens）'
      },
      en: {
        sectionTitle: 'Tool control',
        bundleTitle: 'Tool Control',
        switchPreset: 'Preset:',
        allPresets: 'All presets',
        enableSlimming: 'Tool reduction',
        enableSlimmingDesc: 'Omit verbose schemas of low-frequency tools from requests; tools remain callable and discoverable on demand.',
        enableSlimmingSwitch: 'Enable tool reduction',
        fallbackMode: 'Other tools',
        fallbackModeDesc: 'Reduction mode for tools with no explicit override, including newly installed plugins.',
        fallbackModeDescFull: ' (full = keep full schema resident)',
        fallbackModeLabel: 'Default reduction mode',
        perToolSettings: 'Per-tool settings',
        scanHistoryUpdating: 'Update usage history',
        scanHistoryLoad: 'Load usage history',
        scanHistoryScanning: 'Scanning…',
        scanHistoryTitle: 'Scan tool invocations across ~/.dsh/sessions history',
        refreshTools: 'Refresh',
        refreshToolsTitle: 'Reload tool list from current profile',
        aiOptimize: 'AI Optimize',
        aiOptimizeHint: 'Start a new session and let the agent optimize tool settings via tool-control-optimize',
        aiOptimizeCopied: 'Prompt copied',
        aiOptimizePrompt: '/tool-control-optimize Please use the tool-control-optimize skill to audit the current tool surface and usage history, apply and persist the optimal tool visibility modes, and summarize the estimated token savings.',
        statusFailed: 'Read failed',
        statusLoading: 'Loading…',
        searchPlaceholder: 'Search tool name, description, source, or preset…',
        sort: 'Sort',
        scope: 'Scope',
        restrictedPresets: 'Restricted tool set presets: ',
        loadError: 'Error loading tools: {error}. Click Refresh to retry. Rules below remain active.',
        noTools: 'No tools available.',
        noMatchingTools: 'No tools match current filters.',
        batchFull: 'All full',
        batchStub: 'All stub',
        batchHidden: 'All hidden',
        batchFullTitle: 'Set all tools in this package to full',
        batchStubTitle: 'Set all tools in this package to stub',
        batchHiddenTitle: 'Set all tools in this package to hidden',
        pinnedTag: 'Override',
        orderedTag: 'Ordered',
        presetPrefixTag: 'Presets: ',
        allPresetsTag: 'All',
        moveUp: 'Move up in prompt',
        moveDown: 'Move down in prompt',
        clearOrder: 'Remove from manual order',
        footerNote: 'Changes take effect immediately without restart. Invocations include live runtime and historical ~/.dsh/sessions.',
        mode_full: 'Full',
        mode_stub: 'Stub',
        mode_hidden: 'Hidden',
        mode_name: 'Defer',
        mode_disabled: 'Disabled',
        sort_calls: 'By calls',
        sort_name: 'By name',
        sort_size: 'By size',
        sort_mode: 'By mode',
        sort_custom: 'Custom order',
        scope_all: 'All',
        scope_hidden: 'Hidden only',
        scope_stub: 'Stub only',
        scope_full: 'Full only',
        scope_disabled: 'Disabled only',
        scope_used: 'Called only',
        sourceBuiltin: 'Built-in',
        statsSummary: '{prefix}{total} tools · {resident} full · {stub} stub · {hidden} hidden · {called} called{history}',
        historySessions: ' (loaded {count} historical sessions)',
        statsDisabled: '{prefix}Reduction off · Prompt includes all tools (~{tokens} tokens)',
        statsSaved: '{prefix}Context: original {full} → current {prompt} tokens ({percent}% saved · ~{saved} tokens)'
      }
    }

    function useLocaleListener(ctx) {
      var locale = ctx && ctx.get ? ctx.get('locale') : null
      var state = React.useState(0)
      var setTick = state[1]
      React.useEffect(function () {
        if (!locale || typeof locale.subscribe !== 'function') return
        return locale.subscribe(function () {
          setTick(function (n) { return n + 1 })
        })
      }, [locale])
    }

    function createTranslator(ctx) {
      var locale = ctx && ctx.get ? ctx.get('locale') : null
      if (locale && typeof locale.bind === 'function') {
        return locale.bind(NS)
      }
      var active = (locale && locale.getSnapshot) ? locale.getSnapshot().active : 'zh'
      var dict = DICTS[active] || DICTS.en || DICTS.zh
      return function (key, params) {
        var val = dict[key] || DICTS.en[key] || DICTS.zh[key] || key
        if (params) {
          return val.replace(/\{(\w+)\}/g, function (m, k) { return k in params ? String(params[k]) : m })
        }
        return val
      }
    }


    // ── the bound form hook ─────────────────────────────────────────────────
    // Mirrors dsh-context's `useContextSettings`: subscribe to the Host-served
    // namespace, expose {status, fields, writable} plus a setter.
    function useForm(form) {
      var state = React.useState(function () {
        var snap = form.getSnapshot()
        return { status: snap.status, value: snap.value, writable: snap.writable }
      })
      var current = state[0]
      var setCurrent = state[1]
      React.useEffect(function () {
        return form.subscribe(function () {
          var snap = form.getSnapshot()
          setCurrent({ status: snap.status, value: snap.value, writable: snap.writable })
        })
      }, [form])
      var setField = React.useCallback(function (field, value) {
        form.set(field, value).catch(function () { /* the snapshot shows the conflict */ })
      }, [form])
      return [current, setField]
    }

    // ── controls ─────────────────────────────────────────────────────────────
    function Row(props) {
      return el('div', { style: ROW_STYLE },
        el('div', { style: { flex: '1 1 240px', minWidth: 0 } },
          el('div', { style: TITLE_STYLE }, props.title),
          props.desc ? el('div', { style: DESC_STYLE }, props.desc) : null),
        el('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' } }, props.control))
    }

    /**
     * The official segmented control, matching every other settings row.
     * Falls back to plain buttons only if the primitives package is absent, so
     * a trimmed deployment still gets a usable control.
     */
    function Segmented(props) {
      if (typeof primitives.SegmentedControl === 'function') {
        return el(primitives.SegmentedControl, {
          value: props.value,
          options: props.items,
          onChange: props.onChange,
          disabled: props.disabled,
          label: props.label,
        })
      }
      return el('div', { style: { display: 'inline-flex', gap: '4px' } },
        props.items.map(function (item) {
          return el('button', {
            key: item.value,
            type: 'button',
            onClick: function () { if (!props.disabled) props.onChange(item.value) },
            disabled: props.disabled || item.disabled,
            style: { fontSize: '12px' },
          }, item.label)
        }))
    }

    /** The official on/off switch. */
    function Switch(props) {
      if (typeof primitives.Switch === 'function') {
        return el(primitives.Switch, {
          checked: Boolean(props.checked),
          onChange: props.onChange,
          disabled: props.disabled,
          label: props.label,
        })
      }
      return el('input', {
        type: 'checkbox',
        checked: Boolean(props.checked),
        disabled: props.disabled,
        onChange: function (event) { props.onChange(event.target.checked) },
      })
    }

    /** Text input with official theme styling and bulletproof onChange handling. */
    function TextInput(props) {
      function handleChange(e) {
        var val = (e && e.target && typeof e.target.value === 'string')
          ? e.target.value
          : (e && e.currentTarget && typeof e.currentTarget.value === 'string')
            ? e.currentTarget.value
            : (typeof e === 'string' ? e : '')
        props.onChange(val)
      }
      return el('input', {
        type: 'search',
        value: props.value || '',
        placeholder: props.placeholder,
        disabled: props.disabled,
        onChange: handleChange,
        onInput: handleChange,
        className: 'dsh-tg-input',
      })
    }

    /** The official pill, used for the clickable sort / granularity filters. */
    function Pill(props) {
      if (typeof primitives.Pill === 'function') {
        return el(primitives.Pill, {
          active: Boolean(props.active),
          onClick: props.disabled ? undefined : props.onClick,
          title: props.title,
        }, props.children)
      }
      return el('button', {
        type: 'button',
        disabled: props.disabled,
        onClick: props.onClick,
        style: { fontSize: '11px', fontWeight: props.active ? 600 : 400 },
      }, props.children)
    }

    /** The official small tag, for read-only metadata chips (source, size…). */
    function Tag(props) {
      if (typeof primitives.Tag === 'function') {
        return el(primitives.Tag, { tone: props.tone || 'outline' }, props.children)
      }
      return el('span', { style: { fontSize: '10px' } }, props.children)
    }

    // ── the live tool inventory ──────────────────────────────────────────────
    // The tool list lives in the HOST, not in the config schema, so it comes
    // over the plugin's own HTTP route. Fetched on demand (and refreshable),
    // never cached: that is what makes a tool from a plugin installed later
    // show up here without a restart.
    var TOOLS_ROUTE = '/api/dsh-tool-control/tools'

    function useTools(manualTick) {
      var pair = React.useState({ status: 'loading', tools: [], presets: [], historyStats: null, contextStats: null, error: null })
      var state = pair[0]
      var setState = pair[1]

      var scanningPair = React.useState(false)
      var scanning = scanningPair[0]
      var setScanning = scanningPair[1]

      var reload = React.useCallback(function () {
        setState(function (prev) {
          return {
            status: 'loading',
            tools: prev.tools,
            presets: prev.presets,
            historyStats: prev.historyStats,
            contextStats: prev.contextStats,
            error: null,
          }
        })
        var controller = typeof AbortController === 'function' ? new AbortController() : null
        var timer = controller ? setTimeout(function () { controller.abort() }, 10000) : null
        fetch(TOOLS_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: controller ? controller.signal : undefined,
        })
          .then(function (res) {
            if (timer) clearTimeout(timer)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then(function (body) {
            var value = body && body.ok === true ? body.value : null
            if (!value || !Array.isArray(value.tools)) throw new Error('malformed payload')
            setState({
              status: 'ready',
              tools: value.tools,
              presets: Array.isArray(value.presets) ? value.presets : [],
              historyStats: value.historyStats || null,
              contextStats: value.contextStats || null,
              error: null,
            })
          })
          .catch(function (err) {
            if (timer) clearTimeout(timer)
            setState({ status: 'failed', tools: [], presets: [], historyStats: null, contextStats: null, error: String(err && err.message ? err.message : err) })
          })
      }, [])

      var scanHistory = React.useCallback(function () {
        setScanning(true)
        var controller = typeof AbortController === 'function' ? new AbortController() : null
        var timer = controller ? setTimeout(function () { controller.abort() }, 30000) : null
        fetch(TOOLS_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'scan-history' }),
          signal: controller ? controller.signal : undefined,
        })
          .then(function (res) {
            if (timer) clearTimeout(timer)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then(function (body) {
            var value = body && body.ok === true ? body.value : null
            if (!value || !Array.isArray(value.tools)) throw new Error('malformed payload')
            setState({
              status: 'ready',
              tools: value.tools,
              presets: Array.isArray(value.presets) ? value.presets : [],
              historyStats: value.historyStats || null,
              contextStats: value.contextStats || null,
              error: null,
            })
          })
          .catch(function (err) {
            if (timer) clearTimeout(timer)
            console.warn('tool-control: failed to scan history', err)
          })
          .finally(function () {
            setScanning(false)
          })
      }, [])

      React.useEffect(function () {
        // Initial load automatically scans history if not yet loaded
        fetch(TOOLS_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'scan-history' }),
        })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (body) {
            var value = body && body.ok === true ? body.value : null
            if (value && Array.isArray(value.tools)) {
              setState({
                status: 'ready',
                tools: value.tools,
                presets: Array.isArray(value.presets) ? value.presets : [],
                historyStats: value.historyStats || null,
                contextStats: value.contextStats || null,
                error: null,
              })
            } else {
              reload()
            }
          })
          .catch(function () { reload() })
      }, [reload, manualTick])
      return [state, reload, scanHistory, scanning]
    }

    // The per-row control offers four states. `name` stays reachable through
    // the config file (it is the API-level defer flag, only meaningful on the
    // DeepSeek Messages route) but is out of the default row: a fifth button
    // would crowd the control without being useful on most deployments.
    var MODE_ORDER = ['full', 'stub', 'hidden', 'disabled']

    function getModeLabels(t) {
      return {
        full: t ? t('mode_full') : '保留完整',
        stub: t ? t('mode_stub') : '只留名字',
        hidden: t ? t('mode_hidden') : '隐藏',
        name: t ? t('mode_name') : 'API 延迟',
        disabled: t ? t('mode_disabled') : '禁用',
      }
    }

    function getSorts(t) {
      return [
        { value: 'calls', label: t ? t('sort_calls') : '按调用次数' },
        { value: 'name', label: t ? t('sort_name') : '按名称' },
        { value: 'size', label: t ? t('sort_size') : '按体积' },
        { value: 'mode', label: t ? t('sort_mode') : '按模式' },
        { value: 'custom', label: t ? t('sort_custom') : '手动顺序' },
      ]
    }

    function getScopes(t) {
      return [
        { value: 'all', label: t ? t('scope_all') : '全部' },
        { value: 'hidden', label: t ? t('scope_hidden') : '仅隐藏' },
        { value: 'stub', label: t ? t('scope_stub') : '仅只留名字' },
        { value: 'full', label: t ? t('scope_full') : '仅保留完整' },
        { value: 'disabled', label: t ? t('scope_disabled') : '仅禁用' },
        { value: 'used', label: t ? t('scope_used') : '有调用' },
      ]
    }

    var MODE_RANK = { full: 0, name: 1, stub: 2, hidden: 3, disabled: 4 }

    /** Human-readable size for the "what does keeping this cost" column. */
    function formatBytes(n) {
      if (typeof n !== 'number' || n <= 0) return ''
      return n >= 1024 ? (Math.round(n / 102.4) / 10) + ' KB' : n + ' B'
    }

    /** Compare two tools under the chosen sort. */
    function compareTools(sort, a, b) {
      switch (sort) {
        case 'calls':
          // Most-called first; ties broken by recency then name, so the list is
          // stable rather than arbitrary.
          return (b.calls - a.calls) || (b.lastCall - a.lastCall) || a.name.localeCompare(b.name)
        case 'size':
          return (b.bytes - a.bytes) || a.name.localeCompare(b.name)
        case 'mode':
          return (MODE_RANK[a.mode] - MODE_RANK[b.mode]) || a.name.localeCompare(b.name)
        case 'custom':
          // Tools with a manual position come first, in that order; the rest
          // keep name order. `order` is null when a tool was never placed.
          if (a.order !== null && b.order !== null) return a.order - b.order
          if (a.order !== null) return -1
          if (b.order !== null) return 1
          return a.name.localeCompare(b.name)
        default:
          return a.name.localeCompare(b.name)
      }
    }

    function launchAiOptimize(ctx, promptText, closeSettings, onFallbackCopied) {
      try {
        var uiWorkspace = null
        if (ctx && typeof ctx.get === 'function') {
          uiWorkspace = ctx.get('uiWorkspace') || (ctx.root && typeof ctx.root.get === 'function' ? ctx.root.get('uiWorkspace') : null)
        }
        if (!uiWorkspace && ctx && ctx.uiWorkspace) uiWorkspace = ctx.uiWorkspace
        if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
          if (typeof closeSettings === 'function') {
            try { closeSettings() } catch (_) {}
          }
          uiWorkspace.startSession(undefined, {
            prompt: promptText,
            clearPreviousDraft: true,
          })
          return true
        }
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('dsh-tool-control: failed to start AI optimize session:', err)
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(promptText).then(function () {
          if (typeof onFallbackCopied === 'function') onFallbackCopied()
        }).catch(function () {})
      }
      return false
    }

    // ── the card ─────────────────────────────────────────────────────────────
    function ToolControlCard(props) {
      useLocaleListener(props.ctx)
      var t = props.t || createTranslator(props.ctx)
      var MODE_LABELS = getModeLabels(t)
      var SORTS = getSorts(t)
      var SCOPES = getScopes(t)
      var pair = useForm(props.form)
      var state = pair[0]
      var setField = pair[1]
      var toolsState = useTools(0)
      var inventory = toolsState[0]
      var reloadTools = toolsState[1]
      var scanHistory = toolsState[2]
      var scanningHistory = toolsState[3]
      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var sortState = React.useState('calls')
      var sort = sortState[0]
      var setSort = sortState[1]
      var scopeState = React.useState('all')
      var scope = scopeState[0]
      var setScope = scopeState[1]
      var presetTabState = React.useState('all')
      var activePresetTab = presetTabState[0]
      var setActivePresetTab = presetTabState[1]
      var aiCopiedState = React.useState(false)
      var aiCopied = aiCopiedState[0]
      var setAiCopied = aiCopiedState[1]

      function handleAiOptimize() {
        launchAiOptimize(props.ctx, t('aiOptimizePrompt'), props.closeSettings, function () {
          setAiCopied(true)
          setTimeout(function () { setAiCopied(false) }, 2200)
        })
      }

      if (state.status !== 'ready' || state.value === null || typeof state.value !== 'object') {
        return el('div', { style: NOTE_STYLE },
          state.status === 'loading' ? '…' : '设置在此主机不可用。')
      }

      var value = state.value
      var disabled = !state.writable
      var enabled = value.enabled !== false
      var mode = typeof value.mode === 'string' ? value.mode : 'stub'
      var toolModes = value.toolModes !== null && typeof value.toolModes === 'object' && !Array.isArray(value.toolModes)
        ? value.toolModes : {}
      var fallbackMode = typeof value.fallbackMode === 'string' ? value.fallbackMode : 'full'
      var toolOrder = Array.isArray(value.toolOrder)
        ? value.toolOrder.filter(function (n) { return typeof n === 'string' })
        : []
      // The route echoes the order it was built with; prefer it so the manual
      // order shown is the one the Host currently has.
      var orderList = Array.isArray(inventory.toolOrder) ? inventory.toolOrder : toolOrder

      /** Write one tool's mode. */
      function setToolMode(name, next) {
        var copy = Object.assign({}, toolModes)
        if (next === '__default__') delete copy[name]
        else copy[name] = next
        setField('toolModes', copy)
      }

      /** Batch set mode for a whole source group. */
      function setGroupMode(groupTools, targetMode) {
        var copy = Object.assign({}, toolModes)
        for (var i = 0; i < groupTools.length; i++) {
          copy[groupTools[i].name] = targetMode
        }
        setField('toolModes', copy)
      }

      /** Move a tool one step up/down in the manual prompt order. */
      function moveInOrder(name, delta) {
        var list = orderList.slice()
        var at = list.indexOf(name)
        if (at < 0) {
          // Not ordered yet: append at the front when moving up (it becomes the
          // most important), or at the very end when moving down.
          if (delta < 0) list.unshift(name)
          else list.push(name)
        } else {
          var target = at + delta
          if (target < 0 || target >= list.length) return
          var moved = list[at]
          list[at] = list[target]
          list[target] = moved
        }
        setField('toolOrder', list)
      }

      /** Drop a tool from the manual order entirely (it falls back to the tail). */
      function clearOrder(name) {
        setField('toolOrder', orderList.filter(function (n) { return n !== name }))
      }

      // Defensive: the card renders once before the route answers, and a
      // missing or partial payload must show an empty list, never crash the
      // whole Plugins page.
      var tools = Array.isArray(inventory.tools) ? inventory.tools : []
      var presets = Array.isArray(inventory.presets) ? inventory.presets : []

      /** A tool's effective mode, honouring an unsaved pin. */
      function modeOf(tool) {
        return Object.prototype.hasOwnProperty.call(toolModes, tool.name)
          ? toolModes[tool.name]
          : tool.mode
      }

      var needle = query.trim().toLowerCase()
      var filtered = tools.filter(function (t) {
        var matchesQuery = needle === '' ||
          t.name.toLowerCase().indexOf(needle) !== -1 ||
          String(t.description || '').toLowerCase().indexOf(needle) !== -1 ||
          String((!t.source || t.source === 'builtin') ? t('sourceBuiltin') : t.source).toLowerCase().indexOf(needle) !== -1 ||
          (Array.isArray(t.presets) && t.presets.join(' ').toLowerCase().indexOf(needle) !== -1)
        if (!matchesQuery) return false
        if (activePresetTab !== 'all') {
          var matchedPreset = presets.find(function (p) { return p.id === activePresetTab })
          var targetName = matchedPreset ? matchedPreset.name : activePresetTab
          if (!Array.isArray(t.presets) || (!t.presets.includes(targetName) && !t.presets.includes(activePresetTab))) {
            return false
          }
        }
        var current = modeOf(t)
        if (scope === 'hidden') return current === 'hidden'
        if (scope === 'stub') return current === 'stub' || current === 'name'
        if (scope === 'full') return current === 'full'
        if (scope === 'disabled') return current === 'disabled'
        if (scope === 'used') return (t.calls || 0) > 0
        return true
      })

      // Apply the chosen sort ONCE over the filtered set, then group for
      // display. Grouping first would re-impose source order inside each
      // group and hide the sort the user asked for.
      var ordered = filtered.slice().sort(function (a, b) { return compareTools(sort, a, b) })

      var groups = []
      var bySource = {}
      for (var i = 0; i < ordered.length; i++) {
        var tool = ordered[i]
        var source = (!tool.source || tool.source === 'builtin') ? t('sourceBuiltin') : tool.source
        if (!bySource[source]) {
          bySource[source] = { source: source, tools: [] }
          groups.push(bySource[source])
        }
        bySource[source].tools.push(tool)
      }
      // In a usage sort the first group should be the one with the most-used
      // tool; in the other sorts, alphabetical is the predictable default.
      if (sort !== 'calls' && sort !== 'size' && sort !== 'custom') {
        groups.sort(function (a, b) { return a.source.localeCompare(b.source) })
      }

      // Tools relevant to the active preset
      var presetTools = tools.filter(function (t) {
        if (activePresetTab === 'all') return true
        var matchedPreset = presets.find(function (p) { return p.id === activePresetTab })
        var targetName = matchedPreset ? matchedPreset.name : activePresetTab
        return Array.isArray(t.presets) && (t.presets.includes(targetName) || t.presets.includes(activePresetTab))
      })

      var hiddenCount = presetTools.filter(function (t) { return modeOf(t) === 'hidden' }).length
      var stubCount = presetTools.filter(function (t) {
        var m = modeOf(t)
        return m === 'stub' || m === 'name'
      }).length
      var residentCount = presetTools.filter(function (t) { return modeOf(t) === 'full' }).length
      var calledCount = presetTools.filter(function (t) { return (t.calls || 0) > 0 }).length

      var activePresetObj = presets.find(function (p) { return p.id === activePresetTab })
      var presetPrefix = activePresetTab === 'all' ? '' : '【' + (activePresetObj ? activePresetObj.name : activePresetTab) + '】'

      var summary = inventory.status === 'ready'
        ? t('statsSummary', {
            prefix: presetPrefix,
            total: presetTools.length,
            resident: residentCount,
            stub: stubCount,
            hidden: hiddenCount,
            called: calledCount,
            history: inventory.historyStats ? t('historySessions', { count: inventory.historyStats.totalSessions }) : ''
          })
        : null

      // Presets that restrict their tool set are worth naming once; an
      // unrestricted preset exposes every tool and would otherwise tag every
      // row with the same chip.
      var restrictedPresets = presets.filter(function (p) { return p.restricted })

      function formatTokens(t) {
        if (typeof t !== 'number' || t < 0) return '0'
        return t >= 1000 ? (t / 1000).toFixed(1) + 'k' : String(t)
      }

      // Calculate context statistics dynamically for the active preset
      var fullBytes = 0
      var promptBytes = 0
      var reducedCount = 0
      for (var pi = 0; pi < presetTools.length; pi++) {
        var pt = presetTools[pi]
        var pmode = modeOf(pt)
        var orig = pt.bytes || 0
        fullBytes += orig
        if (pmode === 'full' || pmode === 'name') {
          promptBytes += orig
        } else if (pmode === 'stub') {
          reducedCount += 1
          // Estimated collapsed stub bytes (~220 bytes)
          promptBytes += Math.min(orig, 220)
        } else if (pmode === 'hidden' || pmode === 'disabled') {
          reducedCount += 1
        }
      }
      if (enabled && reducedCount > 0) {
        promptBytes += 1500
      }
      var fullTokens = Math.round(fullBytes / 3.8)
      var promptTokens = Math.round(promptBytes / 3.8)
      var savedTokens = Math.max(0, fullTokens - promptTokens)
      var savedPercent = fullTokens > 0 ? Math.round((savedTokens / fullTokens) * 100) : 0

      var statsText = null
      if (inventory.status === 'ready') {
        if (!enabled) {
          statsText = t('statsDisabled', { prefix: presetPrefix ? presetPrefix + ' ' : '', tokens: formatTokens(fullTokens) })
        } else {
          statsText = t('statsSaved', { prefix: presetPrefix ? presetPrefix + ' ' : '', full: formatTokens(fullTokens), prompt: formatTokens(promptTokens), percent: savedPercent, saved: formatTokens(savedTokens) })
        }
      }


      return el('div', { className: 'dsh-tc-card' },
        el('div', { className: 'dsh-tc-header' },
          el('div', { className: 'dsh-tc-header-main' },
            el('div', { className: 'dsh-tc-header-title' },
              el('span', { className: 'dsh-tc-title-main' }, icon('toolbox'), t('sectionTitle'))
            ),
            el('div', { className: 'dsh-tc-header-desc' }, summary || t('enableSlimmingDesc')),
            el('div', { className: 'dsh-tc-badges-row' },
              el('span', { className: 'dsh-tc-badge' }, enabled ? '已启用' : '已停用'),
              statsText ? el('span', { className: 'dsh-tc-badge dsh-tc-badge-gray' }, statsText) : null
            ),
          ),
          el('div', { className: 'dsh-tc-header-actions' },
            el('button', {
              type: 'button',
              className: 'dsh-tc-btn dsh-tc-btn-ai',
              title: t('aiOptimizeHint'),
              onClick: handleAiOptimize,
            }, aiCopied ? t('aiOptimizeCopied') : t('aiOptimize')),
            el(Switch, {
              checked: enabled, disabled: disabled, label: t('enableSlimmingSwitch'),
              onChange: function (next) { setField('enabled', next) },
            })
          )
        ),
        // 预设切换栏：与提示词管理同一套样式
        presets.length > 0 ? el('div', { className: 'dsh-tc-preset-bar' },
          el('span', { className: 'dsh-tc-preset-label' }, t('switchPreset')),
          el('div', { className: 'dsh-tc-preset-tabs' },
            [ { id: 'all', name: t('allPresets') } ].concat(presets).map(function (p) {
              var isSelected = activePresetTab === p.id
              var count = p.id === 'all'
                ? tools.length
                : tools.filter(function (t) {
                    return Array.isArray(t.presets) && (t.presets.includes(p.name) || t.presets.includes(p.id))
                  }).length
              return el('button', {
                key: p.id,
                type: 'button',
                disabled: disabled,
                className: 'dsh-tc-preset-tab' + (isSelected ? ' active' : ''),
                onClick: function () { setActivePresetTab(p.id) },
              }, p.name + ' (' + count + ')')
            })
          )
        ) : null,
        enabled ? el(React.Fragment, null,
          el(Row, {
            title: t('fallbackMode'),
            desc: t('fallbackModeDesc') +
              (fallbackMode === 'full' ? t('fallbackModeDescFull') : ''),
            control: el(Segmented, {
              value: fallbackMode, disabled: disabled, label: t('fallbackModeLabel'),
              items: [
                { value: 'full', label: '保留' },
                { value: 'stub', label: 'Stub' },
                { value: 'hidden', label: '隐藏' },
              ],
              onChange: function (next) { setField('fallbackMode', next) },
            }),
          }),
          el('div', { style: BLOCK_STYLE },
            el('div', { style: ROW_HEAD_STYLE },
              el('div', { style: TITLE_STYLE }, t('perToolSettings')),
              el('div', { style: { flex: '0 0 auto', display: 'flex', gap: '8px', alignItems: 'center' } },
                el('button', {
                  type: 'button', onClick: scanHistory, disabled: disabled || scanningHistory,
                  className: 'dsh-tg-link', title: t('scanHistoryTitle'),
                }, scanningHistory ? t('scanHistoryScanning') : (inventory.historyStats ? t('scanHistoryUpdating') : t('scanHistoryLoad'))),
                el('button', {
                  type: 'button', onClick: reloadTools, disabled: disabled,
                  className: 'dsh-tg-link', title: t('refreshToolsTitle'),
                }, t('refreshTools')),
                el('span', { style: TOOL_COUNT_STYLE }, inventory.status === 'ready'
                  ? ordered.length + '/' + presetTools.length
                  : inventory.status === 'failed' ? t('statusFailed') : t('statusLoading')))),
            el(TextInput, {
              value: query, disabled: disabled,
              placeholder: t('searchPlaceholder'),
              onChange: function (val) { setQuery(val) },
            }),
            // Sort + granularity, both as pills: two small independent filters
            // read better than a second row of labels.
            el('div', { style: FILTER_ROW_STYLE },
              el('span', { style: FILTER_LABEL_STYLE }, t('sort')),
              SORTS.map(function (option) {
                return el(Pill, {
                  key: option.value, active: sort === option.value, disabled: disabled,
                  onClick: function () { setSort(option.value) },
                }, option.label)
              })),
            el('div', { style: FILTER_ROW_STYLE },
              el('span', { style: FILTER_LABEL_STYLE }, t('scope')),
              SCOPES.map(function (option) {
                return el(Pill, {
                  key: option.value, active: scope === option.value, disabled: disabled,
                  onClick: function () { setScope(option.value) },
                }, option.label)
              })),
            restrictedPresets.length > 0
              ? el('div', { style: HINT_LINE_STYLE },
                  '限定工具集的预设：' + restrictedPresets.map(function (p) { return p.name }).join('、'))
              : null,
            inventory.status === 'failed'
              ? el('div', { style: WARN_STYLE },
                  t('loadError', { error: inventory.error }))
              : null,
            inventory.status === 'ready' && tools.length === 0
              ? el('div', { style: DESC_STYLE }, t('noTools'))
              : null,
            inventory.status === 'ready' && tools.length > 0 && ordered.length === 0
              ? el('div', { style: DESC_STYLE }, t('noMatchingTools'))
              : null,
            groups.map(function (group) {
              return el('div', { key: group.source, style: GROUP_STYLE },
                el('div', { style: GROUP_HEAD_CONTAINER_STYLE },
                  el('div', { style: GROUP_HEAD_STYLE },
                    group.source + ' (' + group.tools.length + ')'),
                  el('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } },
                    el('button', {
                      type: 'button', disabled: disabled, className: 'dsh-tg-link',
                      onClick: function () { setGroupMode(group.tools, 'full') },
                      title: t('batchFullTitle'),
                    }, t('batchFull')),
                    el('button', {
                      type: 'button', disabled: disabled, className: 'dsh-tg-link',
                      onClick: function () { setGroupMode(group.tools, 'stub') },
                      title: t('batchStubTitle'),
                    }, t('batchStub')),
                    el('button', {
                      type: 'button', disabled: disabled, className: 'dsh-tg-link',
                      onClick: function () { setGroupMode(group.tools, 'hidden') },
                      title: t('batchHiddenTitle'),
                    }, t('batchHidden')))),
                group.tools.map(function (tool) {
                  var pinned = Object.prototype.hasOwnProperty.call(toolModes, tool.name)
                  var current = pinned ? toolModes[tool.name] : tool.mode
                  var inOrder = orderList.indexOf(tool.name) >= 0
                  var calls = tool.calls || 0
                  return el('div', { key: tool.name, className: 'dsh-tg-row' },
                    el('div', { className: 'dsh-tg-info' },
                      el('div', { style: TOOL_META_STYLE },
                        // Usage first: "how often was this actually called" is
                        // the fact that justifies the mode next to it.
                        calls > 0
                          ? el('span', { style: CALL_BADGE_STYLE, title: '调用次数（含当前运行与历史会话）' }, '×' + calls)
                          : null,
                        el('span', { style: TOOL_NAME_STYLE, title: tool.name }, tool.name),
                        el(Tag, { tone: 'outline' }, (!tool.source || tool.source === 'builtin') ? t('sourceBuiltin') : tool.source),
                        pinned ? el(Tag, { tone: 'solid' }, t('pinnedTag')) : null,
                        inOrder ? el(Tag, { tone: 'outline' }, t('orderedTag')) : null,
                        (tool.presets && tool.presets.length > 0 && activePresetTab === 'all')
                          ? el(Tag, { tone: 'outline' }, t('presetPrefixTag') + (
                              tool.presets.length === presets.length
                                ? t('allPresetsTag')
                                : tool.presets.join('、')
                            ))
                          : null,
                        tool.bytes > 0 ? el('span', { style: SIZE_STYLE }, formatBytes(tool.bytes)) : null),
                      tool.description
                        ? el('div', { style: TOOL_DESC_STYLE, title: tool.description }, tool.description)
                        : null),
                    el('div', { className: 'dsh-tg-actions' },
                      // Manual prompt order, available per row. The arrows are
                      // only meaningful under the "手动顺序" sort, so they are
                      // shown always but titled accordingly.
                      el('button', {
                        type: 'button', disabled: disabled, className: 'dsh-tg-link',
                        title: t('moveUp'), onClick: function () { moveInOrder(tool.name, -1) },
                      }, icon('chevronUp')),
                      el('button', {
                        type: 'button', disabled: disabled, className: 'dsh-tg-link',
                        title: t('moveDown'), onClick: function () { moveInOrder(tool.name, 1) },
                      }, icon('chevronDown')),
                      inOrder
                        ? el('button', {
                            type: 'button', disabled: disabled, className: 'dsh-tg-link',
                            title: t('clearOrder'), onClick: function () { clearOrder(tool.name) },
                          }, '×')
                        : null,
                      el(Segmented, {
                        value: current, disabled: disabled, label: tool.name + ' 的处理方式',
                        items: MODE_ORDER.map(function (m) { return { value: m, label: MODE_LABELS[m] } }),
                        onChange: function (next) { setToolMode(tool.name, next) },
                      })))
                }))
            }))) : null,
        el('div', { style: FOOTER_STYLE },
          '改动保存后立即生效，无需重启。调用次数包含当前运行与 ~/.dsh/sessions 历史所有会话，开机自动统计。'))
    }

    // One-line explanations, shown as the row's tooltip.
    var MODE_DESCRIPTIONS = {
      full: '保留完整说明（默认）。',
      stub: '名字 + 一句话说明，参数经 tool_search 按需读取。',
      hidden: '整个不发给模型，但仍注册、仍可被 tool_search 找到并调用。',
      disabled: '完全不注册：模型看不到、调不了，tool_search 也不返回。',
      name: '只发名字（API defer_loading）。仅 DeepSeek 官方通道支持。',
    }

    // ── styles ────────────────────────────────────────────────────────────────
    // Only LAYOUT lives here. Anything that expresses the theme (colors,
    // borders, focus rings, hover) comes from the host's design tokens via the
    // stylesheet injected below, so this card follows light/dark and any future
    // theme change the same way a first-party settings row does.
    var CARD_STYLE = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }
    var ROW_STYLE = {
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px',
      padding: '9px 0', minHeight: '40px',
      borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.15))',
    }
    var TITLE_STYLE = { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, inherit)' }
    var DESC_STYLE = { fontSize: '12px', lineHeight: 1.5, marginTop: '2px', color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))' }
    var BLOCK_STYLE = { padding: '9px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.15))' }
    var FOOTER_STYLE = { padding: '8px 0 2px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.6))' }
    var NOTE_STYLE = { padding: '8px 0', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))' }
    var ROW_HEAD_STYLE = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', justifyContent: 'space-between' }
    var TOOL_COUNT_STYLE = {
      fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.6))',
      fontVariantNumeric: 'tabular-nums',
    }
    var WARN_STYLE = {
      marginTop: '6px', padding: '6px 8px', fontSize: '11px', borderRadius: '6px',
      background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))',
      color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))',
    }
    var FILTER_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginTop: '8px' }
    var FILTER_LABEL_STYLE = {
      fontSize: '11px', minWidth: '28px',
      color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))',
    }
    var HINT_LINE_STYLE = {
      marginTop: '6px', fontSize: '11px',
      color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))',
    }
    var GROUP_STYLE = { marginTop: '10px' }
    var GROUP_HEAD_CONTAINER_STYLE = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 8px',
      paddingBottom: '3px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.15))',
    }
    var GROUP_HEAD_STYLE = {
      fontSize: '11px', fontWeight: 600, letterSpacing: '.02em',
      color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))',
      fontFamily: 'ui-monospace, monospace',
    }
    var TOOL_ROW_STYLE = {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '5px 0', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.08))',
    }
    var TOOL_META_STYLE = { display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, flexWrap: 'wrap' }
    var TOOL_NAME_STYLE = {
      fontSize: '12px', fontFamily: 'ui-monospace, monospace',
      color: 'var(--dsw-alias-label-primary, inherit)',
      fontWeight: 600,
      flex: '0 0 auto',
    }
    var TOOL_DESC_STYLE = {
      fontSize: '11px', marginTop: '1px', color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.85))',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }
    var CALL_BADGE_STYLE = {
      fontSize: '10px', fontWeight: 600, padding: '0 4px', borderRadius: '3px',
      background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15))',
      color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,.9))',
      fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
    }
    var SIZE_STYLE = {
      fontSize: '10px', flex: '0 0 auto',
      color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,.6))',
      fontVariantNumeric: 'tabular-nums',
    }
    var STATS_BADGE_STYLE = {
      marginTop: '4px',
      fontSize: '11px',
      fontWeight: 500,
      color: 'var(--dsw-alias-brand-primary, #3b82f6)',
      fontVariantNumeric: 'tabular-nums',
    }

    /**
     * The one bit of styling the primitives cannot express: this card's own
     * text links (刷新 / 全隐藏 / ×). Declaring a real stylesheet keyed on a
     * scoped class is better than inline colors, because hover and the focus
     * ring then come from the tokens like every other interactive element.
     */
    var STYLE_ID = 'dsh-tool-control/style'
    // 样式每次挂载都比对同步，避免热更新后旧样式残留
    function ensureStyles() {
      if (typeof document === 'undefined') return
      var style = document.getElementById(STYLE_ID)
      if (style === null) {
        style = document.createElement('style')
        style.id = STYLE_ID
        document.head.appendChild(style)
      }
      var next = [
        '.dsh-tc-ico { width: 15px; height: 15px; flex: 0 0 auto; stroke-width: 1.7; opacity: .7; }',
        '.dsh-tc-card { display: flex; flex-direction: column; gap: 14px; font-size: 13px; color: var(--dsw-alias-text-primary, #e2e8f0); }',
        '.dsh-tc-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: nowrap; gap: 10px 14px; padding-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,.18)); }',
        '.dsh-tc-header-main { display: flex; flex-direction: column; gap: 7px; flex: 1 1 0; min-width: 0; }',
        '.dsh-tc-header-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; line-height: 1.35; min-width: 0; }',
        '.dsh-tc-header-desc { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-text-tertiary, #8b95a6); }',
        '.dsh-tc-badges-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }',
        '.dsh-tc-badge-gray { color: var(--dsw-alias-text-tertiary, #8b95a6); border-style: dashed; background: transparent; }',
        '.dsh-tc-header-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: nowrap; }',
        '.dsh-tc-preset-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 6px 10px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09)); border: 1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,.18)); border-radius: 8px; }',
        '.dsh-tc-preset-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-secondary, #94a3b8); white-space: nowrap; }',
        '.dsh-tc-preset-tabs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }',
        '.dsh-tc-preset-tab { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-text-secondary, #94a3b8); transition: background .14s ease, color .14s ease, border-color .14s ease; white-space: nowrap; }',
        '.dsh-tc-preset-tab:hover:not(.active):not(:disabled) { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.16)); color: var(--dsw-alias-text-primary, #e2e8f0); }',
        '.dsh-tc-preset-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(128,128,128,.26); }',
        '.dsh-tc-preset-tab.active { background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.22)); border-color: var(--dsw-alias-border-default, rgba(128,128,128,.28)); color: var(--dsw-alias-text-primary, #e2e8f0); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.16); }',
        '.dsh-tc-preset-tab:disabled { opacity: .45; cursor: not-allowed; }',
        '.dsh-tc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.28)); background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.22)); color: var(--dsw-alias-text-primary, #e2e8f0); transition: background .14s ease, border-color .14s ease; white-space: nowrap; }',
        '.dsh-tc-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(128,128,128,.26); }',
        '.dsh-tc-btn-ai { background: rgba(56,189,248,.14); border-color: rgba(56,189,248,.45); color: var(--dsw-alias-text-accent, #38bdf8); font-weight: 600; }',
        '.dsh-tc-btn-ai:hover:not(:disabled) { background: rgba(56,189,248,.22); border-color: rgba(56,189,248,.65); }',
        '.dsh-tc-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 14px; }',
        '.dsh-tc-entry-main { display: flex; flex-direction: column; gap: 5px; flex: 1 1 auto; min-width: 0; }',
        '.dsh-tc-entry-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; flex-wrap: wrap; }',
        '.dsh-tc-title-main { display: inline-flex; align-items: center; gap: 8px; }',
        '.dsh-tc-entry-desc { font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-text-tertiary, #8b95a6); }',
        '.dsh-tc-badge { display: inline-flex; align-items: center; height: 19px; padding: 0 6px; box-sizing: border-box; border-radius: 4px; font-size: 10.5px; font-weight: 500; white-space: nowrap; border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.28)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09)); color: var(--dsw-alias-text-secondary, #94a3b8); }',
        '.dsh-tg-input {',
        '  width: 100%; box-sizing: border-box; height: 28px; padding: 0 8px;',
        '  font: inherit; font-size: 12px; border-radius: 6px;',
        '  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));',
        '  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));',
        '  color: var(--dsw-alias-label-primary, inherit);',
        '  outline: none; transition: border-color .15s, box-shadow .15s;',
        '}',
        '.dsh-tg-input:focus {',
        '  border-color: var(--dsw-alias-brand-primary, #3b82f6);',
        '  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary, #3b82f6);',
        '}',
        '.dsh-tg-input::placeholder {',
        '  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.6));',
        '}',
        '.dsh-tg-row {',
        '  display: flex; align-items: center; justify-content: space-between;',
        '  gap: 12px; padding: 6px 0;',
        '  border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.08));',
        '  flex-wrap: wrap;',
        '}',
        '.dsh-tg-info {',
        '  flex: 1 1 240px; min-width: 0;',
        '}',
        '.dsh-tg-actions {',
        '  flex: 0 0 auto; display: flex; align-items: center; gap: 4px; margin-left: auto;',
        '}',
        '.dsh-tg-link {',
        '  border: none; background: transparent; font: inherit; cursor: pointer;',
        '  padding: 1px 5px; border-radius: 4px; font-size: 10px; line-height: 1.6;',
        '  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.7));',
        '  transition: background .12s, color .12s;',
        '}',
        '.dsh-tg-link:hover:not(:disabled) {',
        '  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15));',
        '  color: var(--dsw-alias-label-primary, inherit);',
        '}',
        '.dsh-tg-link:focus-visible {',
        '  outline: 2px solid var(--dsw-alias-brand-primary, var(--color-blue-500));',
        '  outline-offset: 1px;',
        '}',
        '.dsh-tg-link:disabled { opacity: .45; cursor: default; }',
        '.dsh-tg-btn-ai {',
        '  display: inline-flex; align-items: center; justify-content: center; gap: 4px;',
        '  height: 26px; padding: 0 10px; border-radius: 6px; font: inherit; font-size: 12px;',
        '  font-weight: 600; cursor: pointer; white-space: nowrap;',
        '  background: rgba(56,189,248,.14); border: 1px solid rgba(56,189,248,.45);',
        '  color: #38bdf8; transition: background .12s, border-color .12s, color .12s;',
        '}',
        '.dsh-tg-btn-ai:hover:not(:disabled) {',
        '  background: rgba(56,189,248,.24); border-color: rgba(56,189,248,.7); color: #7dd3fc;',
        '}',
      ].join('\n')
      if (style.textContent !== next) style.textContent = next
    }

    // ── plugin card: entry switch only ───────────────────────────────────────
    function ToolControlEntryCard(props) {
      useLocaleListener(props.ctx)
      var t = props.t || createTranslator(props.ctx)
      var formState = useForm(props.form)
      var current = formState[0]
      var setField = formState[1]
      var config = current.value || {}
      var enabled = config.enabled !== false
      return el('div', { className: 'dsh-tc-entry' },
        el('div', { className: 'dsh-tc-entry-main' },
          el('div', { className: 'dsh-tc-entry-title' },
            el('span', { className: 'dsh-tc-title-main' }, icon('toolbox'), t('sectionTitle')),
            el('span', { className: 'dsh-tc-badge' }, enabled ? '已启用' : '已停用')
          ),
          el('div', { className: 'dsh-tc-entry-desc' },
            '详细设置已移到「设置 → 工具管理」；这里只保留插件入口开关。')
        ),
        el(Switch, {
          checked: enabled,
          label: t('enableSlimmingSwitch'),
          onChange: function (val) { setField('enabled', val) },
        })
      )
    }

    exports.ToolControlCard = ToolControlCard

    // ── plugin definition ─────────────────────────────────────────────────────
    exports.name = 'dsh-tool-control'
    exports.inject = ['slots', 'configForms', 'locale']

    exports.apply = function (ctx) {
      // Register the scoped stylesheet before anything renders, so the card's
      // link buttons never flash unstyled.
      ensureStyles()
      var slots = ctx.get('slots')
      var configForms = ctx.get('configForms')
      var locale = ctx.get('locale')
      if (!slots || typeof slots.inject !== 'function' ||
          !configForms || typeof configForms.get !== 'function' ||
          typeof configForms.whileServed !== 'function') return

      if (locale && typeof locale.register === 'function') {
        ctx.effect(function () {
          return locale.register(NS, DICTS)
        }, 'tool-control: dictionaries')
      }

      // The bound form, per dsh-context: one controller per namespace, alive
      // while the Host serves it.
      var form = configForms.get(NAMESPACE)
      var store = {
        subscribe: function (listener) { return form.subscribe(listener) },
        getSnapshot: function () { return form.getSnapshot() },
        set: function (field, value) { return form.set(field, value) },
      }

      // The detailed "工具管理" menu now lives in dsh-prompt-control's settings
      // sections. This plugin only keeps its Plugins-page entry switch, so the
      // full card does not appear twice.
      ctx.effect(function () {
        return configForms.whileServed([NAMESPACE], function () {
          var unregBundleConfig = slots.inject('plugins.bundle.config', function () {
            return slots.register({
              name: 'plugins.bundle.config',
              key: 'dsh-tool-control',
              locale: NS,
              label: function () { return createTranslator(ctx)('bundleTitle') },
            }, function (props) { return el(ToolControlEntryCard, { form: store, ctx: ctx, t: (props && props.t) || createTranslator(ctx) }) })
          })

          return function () {
            if (typeof unregBundleConfig === 'function') unregBundleConfig()
          }
        })
      }, 'tool-control: plugins.bundle.config entry card')
    }

    return module.exports
  },
})
