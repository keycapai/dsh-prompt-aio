/**
 * dsh-skill-control client half — Skill 管理卡片
 *
 * 本插件的详细设置位于「设置 → Skill 管理」，该菜单由 dsh-prompt-control 承载并复用
 * 本文件导出的 SkillControlCard；本插件自身只在 Plugins 设置页保留一个入口开关卡片
 * （plugins.bundle.config，key = 'dsh-skill-control'）。
 *
 * 遵循 DSH 客户端规范：window.__ModuleLoader__.load 模块包装、React.createElement
 * 无 JSX、ES5 风格函数、自包含样式（dsh-sg- 前缀）、官方 UI Primitives 优先。
 *
 * @module dsh-skill-control/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-control',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var el = React.createElement

    // ── 轻量线性图标：与 dsh-prompt-control 保持同一套视觉语言 ──────────────
    var ICON_PATHS = {
      book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z', 'M4 5.5v15'],
      brain: ['M9.5 3.5A3 3 0 0 0 6.6 7a3 3 0 0 0-1 5.6A3 3 0 0 0 8 18h1.5', 'M14.5 3.5A3 3 0 0 1 17.4 7a3 3 0 0 1 1 5.6A3 3 0 0 1 16 18h-1.5', 'M12 3.5v17'],
    }
    function icon(name) {
      var paths = ICON_PATHS[name] || []
      return el('svg', {
        key: 'ico-' + name,
        className: 'dsh-sg-ico',
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

    var primitives = (function () {
      try { return require('@deepseek-ai/dsh-client-ui-primitives') || {} } catch (_) { return {} }
    })()

    var NAMESPACE = 'skill-control-row'
    var API_ROUTE = '/api/dsh-skill-control/skills'
    var NS = 'skillControl'
    var MODE_VALUES = ['full', 'name', 'hidden', 'disabled']

    var DICTS = {
      zh: {
        bundleTitle: 'Skill Control',
        entryDescription: '详细设置已移到「设置 → Skill 管理」；这里只保留插件入口开关。',
        headTitle: 'Skill 管理',
        headDesc: '按技能目录逐项控制模型可见性：完整介绍、只显示名字、隐藏或禁用。改动在下一个请求即时生效；不会修改技能文件。',
        enableLabel: '启用 Skill Control',
        enabledOn: '已启用',
        enabledOff: '已停用',
        totalBadge: '总数 {count}',
        visibleBadge: '显示 {count}',
        catalogVisibleBadge: '目录 {count}',
        catalogTokensBadge: '目录 {count} tok',
        fullCatalogTokensBadge: '全量 {count} tok',
        tokenNow: '当前 ~{count} tok',
        tokenFull: '完整 ~{count} tok',
        tokenBody: '正文 ~{count} tok',
        tokenNowHint: '当前模式下，此技能目录行大约消耗的 token（隐藏/禁用为 0）',
        tokenFullHint: '若改为完整介绍，此技能目录行大约消耗的 token',
        tokenBodyHint: '技能正文被 skill 工具加载时大约消耗的 token（只在加载时付费）',
        callsBadge: '调用 {count}',
        callsHint: '模型调用 {model} / 用户 /skill {user} / 历史 {history}',
        neverCalled: '未调用',
        scanHistory: '更新调用次数',
        scanning: '扫描中...',
        historyInfo: '{sessions} 个会话 · {calls} 次调用',
        filterLabel: '模式',
        usageLabel: '调用',
        sortLabel: '排序',
        filter_all: '全部',
        usage_called: '有调用',
        usage_never: '未调用',
        sort_calls: '按调用次数',
        sort_name: '按名称',
        sort_tokens: '按 token',
        sort_mode: '按模式',
        refresh: '刷新',
        refreshing: '⏳ 刷新中...',
        aiOptimize: 'AI优化',
        aiOptimizeHint: '打开新会话，让 Agent 根据 skill-control-optimize 技能自动优化 Skill 目录可见性配置',
        aiOptimizeCopied: '已复制优化指令',
        aiOptimizePrompt: '/skill-control-optimize 请根据 skill-control-optimize 技能检查当前 Skill 目录与历史调用频率，按最优方案设置各 Skill 的可见性模式并持久化保存，然后汇报优化前后预估 Token 变化。',
        fallbackLabel: '兜底模式',
        fallbackHint: '未单独固定的技能使用此模式',
        searchPlaceholder: '搜索技能名 / 描述 / 来源...',
        modeLabel: '技能模式',
        mode_full: '完整介绍',
        mode_name: '只显示名字',
        mode_hidden: '隐藏',
        mode_disabled: '禁用',
        pinnedTag: '已固定: {mode}',
        fallbackTag: '跟随兜底: {mode}',
        resetToFallback: '↺ 跟随兜底',
        resetHint: '清除此技能的单独设置，改为跟随兜底模式',
        observed: '当前目录已观测',
        notModelInvocable: '不可模型调用',
        notUserInvocable: '不可用户调用',
        noDescription: '(暂无技能描述)',
        loading: '正在读取技能目录...',
        errorPrefix: '读取技能目录失败: ',
        retry: '重试',
        empty: '当前没有可发现的技能；新会话或目录更新后会显示在这里。',
        noMatch: '没有匹配的技能',
        groupTitle: '技能列表',
        groupHint: '隐藏 / 禁用只影响模型发现与目录注入；skill 工具直调仍可能加载隐藏技能',
        limitLabel: '描述上限',
        limitHint: '目录里每个技能描述最多显示多少字符，默认 120；填 0 表示只显示技能名。',
        limitDefault: '默认 500 字符',
        limitChars: '{count} 字符',
        limitNameOnly: '仅显示名字',
        footer: '说明：隐藏 / 禁用的技能不会出现在模型看到的技能目录中；「隐藏」技能仍可通过 skill_search 发现并由 skill 工具加载，「禁用」技能不参与搜索且用户 /skill 调用会被拦截。技能目录来自当前会话观测与 skills 服务，新装技能在刷新后出现。Token 为近似估算：非 ASCII 约 1 tok/字符，ASCII 约 0.25 tok/字符；“正文”只在 skill 工具加载时计入。'
      },
      en: {
        bundleTitle: 'Skill Control',
        entryDescription: 'Detailed settings moved to Settings → Skill Manager; only the plugin entry switch remains here.',
        headTitle: 'Skill 管理',
        headDesc: 'Control what the model sees per skill: full description, name only, hidden, or disabled. Changes apply on the next request and never modify skill files.',
        enableLabel: 'Enable Skill Control',
        enabledOn: 'Enabled',
        enabledOff: 'Disabled',
        totalBadge: 'Total {count}',
        visibleBadge: 'Shown {count}',
        catalogVisibleBadge: 'Catalog {count}',
        catalogTokensBadge: '{count} tok',
        fullCatalogTokensBadge: 'full {count} tok',
        tokenNow: '~{count} tok now',
        tokenFull: '~{count} tok full',
        tokenBody: '~{count} tok body',
        tokenNowHint: 'Approximate tokens this catalog line costs under the current mode (0 when hidden/disabled)',
        tokenFullHint: 'Approximate tokens the catalog line would cost with a full description',
        tokenBodyHint: 'Approximate tokens of the loaded skill body (paid only when loaded)',
        callsBadge: 'calls {count}',
        callsHint: 'model {model} / user /skill {user} / history {history}',
        neverCalled: 'never called',
        scanHistory: 'Update calls',
        scanning: 'scanning...',
        historyInfo: '{sessions} sessions · {calls} calls',
        filterLabel: 'Mode',
        usageLabel: 'Usage',
        sortLabel: 'Sort',
        filter_all: 'All',
        usage_called: 'Called',
        usage_never: 'Never called',
        sort_calls: 'By calls',
        sort_name: 'By name',
        sort_tokens: 'By tokens',
        sort_mode: 'By mode',
        refresh: 'Refresh',
        refreshing: '⏳ Refreshing...',
        aiOptimize: 'AI Optimize',
        aiOptimizeHint: 'Start a new session and let the agent optimize skill catalog settings via skill-control-optimize',
        aiOptimizeCopied: 'Prompt copied',
        aiOptimizePrompt: '/skill-control-optimize Please use the skill-control-optimize skill to audit the current skill catalog and usage frequency, apply and persist the optimal visibility modes, and summarize the estimated token savings.',
        fallbackLabel: 'Fallback mode',
        fallbackHint: 'Skills without an explicit override use this mode',
        searchPlaceholder: 'Search skill name / description / source...',
        modeLabel: 'Skill mode',
        mode_full: 'Full',
        mode_name: 'Name only',
        mode_hidden: 'Hidden',
        mode_disabled: 'Disabled',
        pinnedTag: 'Pinned: {mode}',
        fallbackTag: 'Fallback: {mode}',
        resetToFallback: '↺ Use fallback',
        resetHint: 'Clear this skill override and follow the fallback mode',
        observed: 'Observed in current directory',
        notModelInvocable: 'Not model-invocable',
        notUserInvocable: 'Not user-invocable',
        noDescription: '(No description)',
        loading: 'Loading skill catalog...',
        errorPrefix: 'Failed to load skill catalog: ',
        retry: 'Retry',
        empty: 'No skills discovered yet; new skills appear after a refresh or a new session.',
        noMatch: 'No matching skills',
        groupTitle: 'Skills',
        groupHint: 'Hidden / disabled only affect model discovery and catalog injection; direct skill tool calls may still load hidden skills',
        limitLabel: 'Description limit',
        limitHint: 'Max characters of each skill description shown in the catalog (default 120). Use 0 to show names only.',
        limitDefault: 'Default 500 chars',
        limitChars: '{count} chars',
        limitNameOnly: 'Name only',
        footer: 'Note: hidden / disabled skills are omitted from the model-visible catalog. Hidden skills remain discoverable via skill_search and can still be loaded with the skill tool; disabled skills are excluded from search and user /skill calls are rejected. The catalog comes from the current session and the skills service; new skills appear after a refresh. Tokens are approximate: non-ASCII ~1 tok/char, ASCII ~0.25 tok/char; \"body\" is counted only when the skill is loaded.'
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

    function normalizeMode(value) {
      var mode = String(value || '').toLowerCase()
      return MODE_VALUES.indexOf(mode) >= 0 ? mode : 'full'
    }

    function modeLabel(t, mode) {
      return t('mode_' + normalizeMode(mode))
    }

    function modeItems(t) {
      return MODE_VALUES.map(function (mode) {
        return { value: mode, label: t('mode_' + mode) }
      })
    }

    // ── 基础样式（全部 dsh-sg- 前缀，跟随 DSH 主题变量） ───────────────────
    var STYLE_ID = 'dsh-skill-control/style'
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
        // ── 设计令牌：与 dsh-prompt-control 同一套，颜色全部取自 DSH 主题别名 ──
        '.dsh-sg-card, .dsh-sg-entry {',
        '  --dsg-r-xs: 4px; --dsg-r-sm: 6px; --dsg-r-md: 8px; --dsg-ctl: 28px; --dsg-ctl-sm: 24px;',
        '  --dsg-surface-1: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.045));',
        '  --dsg-surface-2: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09));',
        '  --dsg-surface-3: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.16));',
        '  --dsg-elevated: var(--dsw-alias-bg-elevated, rgba(128,128,128,.22));',
        '  --dsg-line: var(--dsw-alias-border-subtle, rgba(128,128,128,.18));',
        '  --dsg-line-2: var(--dsw-alias-border-default, rgba(128,128,128,.28));',
        '  --dsg-line-3: var(--dsw-alias-border-l1, rgba(128,128,128,.45));',
        '  --dsg-text-1: var(--dsw-alias-text-primary, #e2e8f0);',
        '  --dsg-text-2: var(--dsw-alias-text-secondary, #94a3b8);',
        '  --dsg-text-3: var(--dsw-alias-text-tertiary, #8b95a6);',
        '  --dsg-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
        '  --dsg-focus: 0 0 0 3px rgba(128,128,128,.26);',
        '}',
        '.dsh-sg-card { display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--dsg-text-1); }',
        '.dsh-sg-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: nowrap; gap: 8px 14px; padding-bottom: 10px; border-bottom: 1px solid var(--dsg-line); }',
        '.dsh-sg-header-main { display: flex; flex-direction: column; gap: 5px; flex: 1 1 0; min-width: 0; }',
        '.dsh-sg-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; line-height: 1.35; min-width: 0; }',
        '.dsh-sg-badges-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }',
        '.dsh-sg-subtitle { font-size: 11.5px; color: var(--dsg-text-3); line-height: 1.5; }',
        '.dsh-sg-header-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: nowrap; }',
        '.dsh-sg-control-label { font-size: 12px; font-weight: 600; color: var(--dsg-text-2); white-space: nowrap; }',
        '.dsh-sg-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; }',
        '.dsh-sg-toolbar-left { display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; min-width: 0; }',
        '.dsh-sg-toolbar-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; justify-content: flex-end; min-width: 0; margin-left: auto; }',
        '.dsh-sg-toolbar-filters { padding-top: 0; }',
        '.dsh-sg-search-row { display: flex; align-items: center; gap: 6px; width: 100%; }',
        '.dsh-sg-search-input { flex: 1 1 auto; min-width: 0; height: 26px; }',
        '.dsh-sg-search-btn { flex: 0 0 auto; }',
        '.dsh-sg-input-num { width: 64px; padding: 0 8px; }',
        '.dsh-sg-toolbar-filters .dsh-sg-toolbar-left { row-gap: 6px; }',
        '.dsh-sg-inline-check { cursor: help; }',
        '.dsh-sg-toolbar-right .dsh-sg-input { width: 190px; max-width: 100%; }',
        '.dsh-sg-input { height: var(--dsg-ctl); padding: 0 10px; font: inherit; font-size: 12px; border-radius: var(--dsg-r-sm); border: 1px solid var(--dsg-line-2); background: var(--dsg-surface-2); color: var(--dsg-text-1); outline: none; transition: border-color .14s ease, box-shadow .14s ease; }',
        '.dsh-sg-input::placeholder { color: var(--dsg-text-3); }',
        '.dsh-sg-input:focus { border-color: var(--dsg-line-3); box-shadow: var(--dsg-focus); }',
        '.dsh-sg-select { height: var(--dsg-ctl); padding: 0 8px; font: inherit; font-size: 12px; border-radius: var(--dsg-r-sm); border: 1px solid var(--dsg-line-2); background: var(--dsg-surface-2); color: var(--dsg-text-1); outline: none; cursor: pointer; }',
        '.dsh-sg-select:focus { border-color: var(--dsg-line-3); box-shadow: var(--dsg-focus); }',
        '.dsh-sg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: var(--dsg-ctl); padding: 0 10px; border-radius: var(--dsg-r-sm); font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--dsg-line-2); background: var(--dsg-elevated); color: var(--dsg-text-1); transition: background .14s ease, border-color .14s ease, color .14s ease; white-space: nowrap; }',
        '.dsh-sg-btn:hover:not(:disabled) { background: var(--dsg-surface-3); border-color: var(--dsg-line-3); }',
        '.dsh-sg-btn:focus-visible { outline: none; box-shadow: var(--dsg-focus); }',
        '.dsh-sg-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
        '.dsh-sg-btn-sm { height: var(--dsg-ctl-sm); padding: 0 7px; font-size: 11px; border-radius: var(--dsg-r-xs); }',
        '.dsh-sg-btn-ai { background: rgba(56,189,248,.14); border: 1px solid rgba(56,189,248,.45); color: var(--dsw-alias-text-accent, #38bdf8); font-weight: 600; }',
        '.dsh-sg-btn-ai:hover:not(:disabled) { background: rgba(56,189,248,.22); border-color: rgba(56,189,248,.65); }',
        '.dsh-sg-ico { width: 14px; height: 14px; flex: 0 0 auto; stroke-width: 1.7; opacity: .85; }',
        '.dsh-sg-title-main { display: inline-flex; align-items: center; gap: 8px; }',
        '.dsh-sg-title-main .dsh-sg-ico { width: 15px; height: 15px; opacity: .7; }',
        '.dsh-sg-badge { display: inline-flex; align-items: center; gap: 4px; height: 19px; padding: 0 6px; box-sizing: border-box; border-radius: var(--dsg-r-xs); font-size: 10.5px; font-weight: 500; font-family: var(--dsg-mono); white-space: nowrap; flex-shrink: 0; border: 1px solid var(--dsg-line-2); background: var(--dsg-surface-2); color: var(--dsg-text-2); }',
        '.dsh-sg-badge-blue, .dsh-sg-badge-green, .dsh-sg-badge-orange, .dsh-sg-badge-purple { color: var(--dsg-text-2); border-color: var(--dsg-line-2); background: var(--dsg-surface-2); }',
        '.dsh-sg-badge-gray { color: var(--dsg-text-3); border-color: var(--dsg-line-2); background: transparent; }',
        '.dsh-sg-badge-order { font-weight: 700; color: var(--dsg-text-1); border-color: var(--dsg-line-3); background: var(--dsg-surface-3); }',
        '.dsh-sg-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: var(--dsg-r-sm); background: var(--dsg-surface-2); border: 1px solid var(--dsg-line); }',
        '.dsh-sg-seg-btn { display: inline-flex; align-items: center; justify-content: center; height: 24px; padding: 0 9px; border-radius: var(--dsg-r-xs); font-size: 11px; font-weight: 500; border: 1px solid transparent; background: transparent; color: var(--dsg-text-2); cursor: pointer; transition: background .14s ease, color .14s ease; }',
        '.dsh-sg-seg-btn:hover:not(:disabled):not(.active) { color: var(--dsg-text-1); background: var(--dsg-surface-3); }',
        '.dsh-sg-seg-btn.active { background: var(--dsg-elevated); color: var(--dsg-text-1); border-color: var(--dsg-line-2); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.16); }',
        '.dsh-sg-seg-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
        '.dsh-sg-checkbox { width: 14px; height: 14px; accent-color: var(--dsw-alias-text-accent, #38bdf8); }',
        '.dsh-sg-inline-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsg-text-2); cursor: pointer; user-select: none; white-space: nowrap; }',
        '.dsh-sg-field { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }',
        '.dsh-sg-field .dsh-sg-control-label { cursor: pointer; }',
        '.dsh-sg-group { border: 1px solid var(--dsg-line); border-radius: var(--dsg-r-md); overflow: hidden; background: var(--dsg-surface-1); }',
        '.dsh-sg-group-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 10px; padding: 9px 12px; background: var(--dsg-surface-2); border-bottom: 1px solid var(--dsg-line); }',
        '.dsh-sg-group-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; margin-left: auto; }',
        '.dsh-sg-group-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--dsg-text-1); }',
        '.dsh-sg-group-hint { font-size: 11px; color: var(--dsg-text-3); line-height: 1.4; }',
        '.dsh-sg-group-body { display: flex; flex-direction: column; }',
        '.dsh-sg-item { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; border-bottom: 1px solid var(--dsg-line); transition: background .14s ease; }',
        '.dsh-sg-item-control { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; min-width: 0; padding-top: 2px; border-top: 1px dashed var(--dsg-line); }',
        '.dsh-sg-item-control > * { max-width: 100%; min-width: 0; }',
        '.dsh-sg-item:last-child { border-bottom: none; }',
        '.dsh-sg-item:hover { background: var(--dsg-surface-2); }',
        '.dsh-sg-item::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: transparent; }',
        '.dsh-sg-item:hover::before { background: var(--dsg-line-3); }',
        '.dsh-sg-item-pinned::before, .dsh-sg-item-pinned:hover::before { background: var(--dsg-line-3); }',
        '.dsh-sg-item-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }',
        '.dsh-sg-item-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
        '.dsh-sg-item-name { font-weight: 600; font-size: 13px; color: var(--dsg-text-1); word-break: break-word; }',
        '.dsh-sg-item-desc { font-size: 11.5px; color: var(--dsg-text-2); line-height: 1.5; word-break: break-word; }',
        '.dsh-sg-muted { opacity: .65; font-style: italic; }',
        '.dsh-sg-state { padding: 22px 16px; text-align: center; color: var(--dsg-text-3); font-size: 12.5px; line-height: 1.6; }',
        '.dsh-sg-state-error { color: var(--dsw-alias-state-error-primary, #ef4444); }',
        '.dsh-sg-state-actions { margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; }',
        '.dsh-sg-footer { font-size: 11.5px; color: var(--dsg-text-3); line-height: 1.65; padding: 0 4px; }',
        '.dsh-sg-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; flex-wrap: wrap; }',
        '.dsh-sg-entry-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }',
        '.dsh-sg-entry-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; flex-wrap: wrap; }',
        '.dsh-sg-entry-desc { font-size: 11.5px; color: var(--dsg-text-3); line-height: 1.5; }',
      ].join('\n')
      if (style.textContent !== next) style.textContent = next
    }

    // ── Form Hook（与 dsh-prompt-control 保持一致，form 缺失时安全降级） ───────
    function useForm(form) {
      var state = React.useState(function () {
        if (!form || typeof form.getSnapshot !== 'function') {
          return { status: 'ready', value: {}, writable: false }
        }
        var snap = form.getSnapshot()
        return { status: snap.status, value: snap.value || {}, writable: snap.writable }
      })
      var current = state[0]
      var setCurrent = state[1]
      React.useEffect(function () {
        if (!form || typeof form.subscribe !== 'function') return
        return form.subscribe(function () {
          var snap = form.getSnapshot()
          setCurrent({ status: snap.status, value: snap.value || {}, writable: snap.writable })
        })
      }, [form])
      var setField = React.useCallback(function (field, value) {
        if (!form || typeof form.set !== 'function') return Promise.resolve()
        return form.set(field, value).catch(function () {})
      }, [form])
      return [current, setField]
    }

    // ── 基础控件：官方 Primitives 优先，缺失时退化为原生控件 ───────────────
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
        className: 'dsh-sg-checkbox',
        checked: Boolean(props.checked),
        disabled: props.disabled,
        onChange: function (e) { props.onChange(e.target.checked) },
      })
    }

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
      return el('div', { className: 'dsh-sg-seg' },
        props.items.map(function (item) {
          return el('button', {
            key: item.value,
            type: 'button',
            className: 'dsh-sg-seg-btn' + (item.value === props.value ? ' active' : ''),
            disabled: props.disabled,
            onClick: function () { if (!props.disabled) props.onChange(item.value) },
          }, item.label)
        })
      )
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
          console.warn('dsh-skill-control: failed to start AI optimize session:', err)
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(promptText).then(function () {
          if (typeof onFallbackCopied === 'function') onFallbackCopied()
        }).catch(function () {})
      }
      return false
    }

    // ── Skill 管理主卡片（供 dsh-prompt-control 的菜单壳复用） ─────────────────
    function SkillControlCard(props) {
      useLocaleListener(props.ctx)
      var t = props.t || createTranslator(props.ctx)

      // props.form 由 dsh-prompt-control 包装层直接传入；也兼容只传 configForms 的用法。
      var resolvedForm = React.useMemo(function () {
        if (props.form) return props.form
        try {
          if (props.configForms && typeof props.configForms.get === 'function') {
            return props.configForms.get(NAMESPACE)
          }
        } catch (_) {}
        return null
      }, [props.form, props.configForms])

      var formState = useForm(resolvedForm)
      var current = formState[0]
      var setField = formState[1]
      var config = current.value || {}

      var serverState = React.useState({
        status: 'loading',
        skills: [],
        fallbackMode: 'full',
        enabled: true,
        catalogDescriptionMaxLength: 500,
        promptNotice: true,
        historyStats: null,
        error: null,
      })
      var server = serverState[0]
      var setServer = serverState[1]

      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]

      var sortState = React.useState('calls')
      var sort = sortState[0]
      var setSort = sortState[1]
      var modeFilterState = React.useState('all')
      var modeFilter = modeFilterState[0]
      var setModeFilter = modeFilterState[1]
      var usageFilterState = React.useState('all')
      var usageFilter = usageFilterState[0]
      var setUsageFilter = usageFilterState[1]
      var scanningState = React.useState(false)
      var scanning = scanningState[0]
      var setScanning = scanningState[1]
      var aiCopiedState = React.useState(false)
      var aiCopied = aiCopiedState[0]
      var setAiCopied = aiCopiedState[1]

      function handleAiOptimize() {
        launchAiOptimize(props.ctx, t('aiOptimizePrompt'), props.closeSettings, function () {
          setAiCopied(true)
          setTimeout(function () { setAiCopied(false) }, 2200)
        })
      }

      var fetchSkills = React.useCallback(function () {
        setServer(function (prev) {
          return Object.assign({}, prev, { status: prev.skills && prev.skills.length ? 'refreshing' : 'loading', error: null })
        })
        fetch(API_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'get-skills' }),
        })
          .then(function (res) { return res.json() })
          .then(function (body) {
            if (!body || !body.ok || !body.value) throw new Error('malformed skills payload')
            var value = body.value
            setServer({
              status: 'ready',
              skills: Array.isArray(value.skills) ? value.skills : [],
              fallbackMode: normalizeMode(value.fallbackMode),
              enabled: value.enabled !== false,
              catalogDescriptionMaxLength: typeof value.catalogDescriptionMaxLength === 'number' ? value.catalogDescriptionMaxLength : 500,
              promptNotice: value.promptNotice !== false,
              historyStats: value.historyStats || null,
              error: null,
            })
          })
          .catch(function (error) {
            setServer({
              status: 'error',
              skills: [],
              fallbackMode: 'full',
              enabled: true,
              catalogDescriptionMaxLength: 500,
              promptNotice: true,
              historyStats: null,
              error: String((error && error.message) || error),
            })
          })
      }, [])

      React.useEffect(function () { fetchSkills() }, [fetchSkills])

      var scanHistory = React.useCallback(function () {
        setScanning(true)
        fetch(API_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'scan-history' }),
        })
          .then(function () { return fetchSkills() })
          .catch(function () { fetchSkills() })
          .then(function () { setScanning(false) })
      }, [fetchSkills])

      var configModes = config.skillModes && typeof config.skillModes === 'object' ? config.skillModes : null
      var fallbackMode = normalizeMode(config.fallbackMode || server.fallbackMode)
      var enabled = config.enabled !== undefined ? config.enabled !== false : server.enabled !== false
      var descriptionLimit = config.catalogDescriptionMaxLength !== undefined
        ? config.catalogDescriptionMaxLength
        : server.catalogDescriptionMaxLength

      function isPinned(skill) {
        if (configModes) return Object.prototype.hasOwnProperty.call(configModes, skill.name)
        return Boolean(skill.pinned)
      }

      function modeOf(skill) {
        if (configModes && Object.prototype.hasOwnProperty.call(configModes, skill.name)) {
          return normalizeMode(configModes[skill.name])
        }
        if (!configModes && skill.pinned && skill.mode) {
          return normalizeMode(skill.mode)
        }
        return fallbackMode
      }

      // 读取最新表单快照，避免连续点击时用上次渲染的旧对象覆盖另一个技能的模式。
      function currentSkillModes() {
        if (resolvedForm && typeof resolvedForm.getSnapshot === 'function') {
          var snap = resolvedForm.getSnapshot()
          var latest = snap && snap.value && snap.value.skillModes
          if (latest && typeof latest === 'object') return latest
        }
        return configModes || {}
      }

      function setSkillMode(name, mode) {
        var next = Object.assign({}, currentSkillModes())
        next[name] = normalizeMode(mode)
        setField('skillModes', next)
      }

      function clearSkillMode(name) {
        var next = Object.assign({}, currentSkillModes())
        if (Object.prototype.hasOwnProperty.call(next, name)) delete next[name]
        setField('skillModes', next)
      }

      function setDescriptionLimit(value) {
        if (value === '') {
          setField('catalogDescriptionMaxLength', null)
          return
        }
        var parsed = Number(value)
        setField('catalogDescriptionMaxLength', Number.isInteger(parsed) && parsed >= 0 ? parsed : null)
      }

      var needle = query.trim().toLowerCase()
      var skills = server.skills.filter(function (skill) {
        if (!needle) return true
        return String(skill.name || '').toLowerCase().indexOf(needle) >= 0 ||
          String(skill.description || '').toLowerCase().indexOf(needle) >= 0 ||
          String(skill.source || '').toLowerCase().indexOf(needle) >= 0
      }).filter(function (skill) {
        return modeFilter === 'all' || modeOf(skill) === modeFilter
      }).filter(function (skill) {
        var called = Number(skill.calls) > 0
        return usageFilter === 'all' || (usageFilter === 'called' && called) || (usageFilter === 'never' && !called)
      }).slice().sort(function (a, b) {
        if (sort === 'tokens') return (Number(b.tokens) || 0) - (Number(a.tokens) || 0) || String(a.name).localeCompare(String(b.name))
        if (sort === 'name') return String(a.name).localeCompare(String(b.name))
        if (sort === 'mode') return MODE_VALUES.indexOf(modeOf(a)) - MODE_VALUES.indexOf(modeOf(b)) || String(a.name).localeCompare(String(b.name))
        return (Number(b.calls) || 0) - (Number(a.calls) || 0) || String(a.name).localeCompare(String(b.name))
      })

      var catalogVisible = server.skills.filter(function (skill) {
        var mode = modeOf(skill)
        return mode === 'full' || mode === 'name'
      }).length

      var catalogTokens = server.skills.reduce(function (sum, skill) {
        return sum + (Number(skill.tokens) || 0)
      }, 0)
      var fullCatalogTokens = server.skills.reduce(function (sum, skill) {
        return sum + (Number(skill.fullTokens) || 0)
      }, 0)

      var busy = server.status === 'loading' || server.status === 'refreshing'

      function renderSkillItem(skill, idx) {
        var pinned = isPinned(skill)
        var mode = modeOf(skill)
        return el('div', {
          key: skill.name,
          className: 'dsh-sg-item' + (pinned ? ' dsh-sg-item-pinned' : ''),
        },
          el('div', { className: 'dsh-sg-item-main' },
            el('div', { className: 'dsh-sg-item-head' },
              el('span', { className: 'dsh-sg-badge dsh-sg-badge-order' }, '#' + (idx + 1)),
              el('span', { className: 'dsh-sg-item-name' }, skill.name),
              el('span', { className: 'dsh-sg-badge dsh-sg-badge-blue' }, skill.source || 'skills'),
              el('span', {
                className: 'dsh-sg-badge' + (Number(skill.calls) > 0 ? '' : ' dsh-sg-badge-gray'),
                title: t('callsHint', { model: Number(skill.modelCalls) || 0, user: Number(skill.userCalls) || 0, history: Number(skill.historyCalls) || 0 }),
              }, Number(skill.calls) > 0 ? t('callsBadge', { count: skill.calls }) : t('neverCalled')),
              el('span', { className: 'dsh-sg-badge dsh-sg-badge-orange', title: t('tokenNowHint') }, t('tokenNow', { count: Number(skill.tokens) || 0 })),
              el('span', { className: 'dsh-sg-badge', title: t('tokenFullHint') }, t('tokenFull', { count: Number(skill.fullTokens) || 0 })),
              typeof skill.bodyTokens === 'number' ? el('span', { className: 'dsh-sg-badge dsh-sg-badge-gray', title: t('tokenBodyHint') }, t('tokenBody', { count: skill.bodyTokens })) : null,
              pinned
                ? el('span', { className: 'dsh-sg-badge dsh-sg-badge-purple' }, t('pinnedTag', { mode: modeLabel(t, mode) }))
                : el('span', { className: 'dsh-sg-badge' }, t('fallbackTag', { mode: modeLabel(t, mode) })),
              skill.observed ? el('span', { className: 'dsh-sg-badge dsh-sg-badge-green' }, t('observed')) : null,
              skill.modelInvocable === false ? el('span', { className: 'dsh-sg-badge dsh-sg-badge-orange' }, t('notModelInvocable')) : null,
              skill.userInvocable === false ? el('span', { className: 'dsh-sg-badge dsh-sg-badge-orange' }, t('notUserInvocable')) : null
            ),
            skill.description
              ? el('div', { className: 'dsh-sg-item-desc' }, skill.description)
              : el('div', { className: 'dsh-sg-item-desc dsh-sg-muted' }, t('noDescription'))
          ),
          el('div', { className: 'dsh-sg-item-control' },
            el(Segmented, {
              value: mode,
              items: modeItems(t),
              label: skill.name + ' ' + t('modeLabel'),
              onChange: function (nextMode) { setSkillMode(skill.name, nextMode) },
            }),
            pinned ? el('button', {
              className: 'dsh-sg-btn dsh-sg-btn-sm',
              type: 'button',
              title: t('resetHint'),
              onClick: function () { clearSkillMode(skill.name) },
            }, t('resetToFallback')) : null
          )
        )
      }

      var body = null
      if (server.status === 'loading') {
        body = el('div', { className: 'dsh-sg-state' }, t('loading'))
      } else if (server.status === 'error') {
        body = el('div', { className: 'dsh-sg-state dsh-sg-state-error' },
          el('div', null, t('errorPrefix') + server.error),
          el('div', { className: 'dsh-sg-state-actions' },
            el('button', { className: 'dsh-sg-btn', type: 'button', onClick: fetchSkills }, t('retry'))
          )
        )
      } else if (server.skills.length === 0) {
        body = el('div', { className: 'dsh-sg-state' }, t('empty'))
      } else if (skills.length === 0) {
        body = el('div', { className: 'dsh-sg-state' }, t('noMatch'))
      } else {
        body = el('div', { className: 'dsh-sg-group' },
          el('div', { className: 'dsh-sg-group-head' },
            el('div', { className: 'dsh-sg-group-title' },
              el('span', { className: 'dsh-sg-title-main' }, icon('book'), t('groupTitle')),
              el('span', { className: 'dsh-sg-badge' }, String(skills.length))
            ),
            el('div', { className: 'dsh-sg-group-actions' },
              server.historyStats ? el('span', { className: 'dsh-sg-badge dsh-sg-badge-gray' }, t('historyInfo', { sessions: server.historyStats.sessions || 0, calls: server.historyStats.calls || 0 })) : null,
              el('button', { className: 'dsh-sg-btn dsh-sg-btn-sm', type: 'button', disabled: scanning, onClick: scanHistory }, scanning ? t('scanning') : t('scanHistory'))
            )
          ),
          el('div', { className: 'dsh-sg-group-body' },
            skills.map(renderSkillItem)
          )
        )
      }

      var limitValue = descriptionLimit === null || descriptionLimit === undefined ? '120' : String(descriptionLimit)
      var limitOptions = [{
        value: '500',
        label: t('limitDefault'),
      }, {
        value: '200',
        label: t('limitChars', { count: 200 }),
      }, {
        value: '120',
        label: t('limitChars', { count: 120 }),
      }, {
        value: '80',
        label: t('limitChars', { count: 80 }),
      }, {
        value: '40',
        label: t('limitChars', { count: 40 }),
      }, {
        value: '0',
        label: t('limitNameOnly'),
      }]

      return el('div', { className: 'dsh-sg-card' },
        el('div', { className: 'dsh-sg-header' },
          el('div', { className: 'dsh-sg-header-main' },
            el('div', { className: 'dsh-sg-title' },
              el('span', { className: 'dsh-sg-title-main' }, icon('book'), t('headTitle'))
            ),
            el('div', { className: 'dsh-sg-subtitle' }, t('headDesc')),
            el('div', { className: 'dsh-sg-badges-row' },
              el('span', { className: 'dsh-sg-badge' }, t('totalBadge', { count: server.skills.length })),
              el('span', { className: 'dsh-sg-badge' }, t('catalogVisibleBadge', { count: catalogVisible })),
              el('span', { className: 'dsh-sg-badge' }, t('visibleBadge', { count: skills.length })),
              el('span', { className: 'dsh-sg-badge' }, t('catalogTokensBadge', { count: catalogTokens })),
              el('span', { className: 'dsh-sg-badge dsh-sg-badge-gray' }, t('fullCatalogTokensBadge', { count: fullCatalogTokens }))
            ),
          ),
          el('div', { className: 'dsh-sg-header-actions' },
            el('button', {
              className: 'dsh-sg-btn dsh-sg-btn-ai',
              type: 'button',
              title: t('aiOptimizeHint'),
              onClick: handleAiOptimize,
            }, aiCopied ? t('aiOptimizeCopied') : t('aiOptimize')),
            el(Switch, {
              checked: enabled,
              label: t('enableLabel'),
              onChange: function (val) { setField('enabled', val) },
            })
          )
        ),

        el('div', { className: 'dsh-sg-toolbar' },
          el('div', { className: 'dsh-sg-toolbar-left' },
            el('span', { className: 'dsh-sg-control-label' }, t('fallbackLabel')),
            el(Segmented, {
              value: fallbackMode,
              items: modeItems(t),
              label: t('fallbackLabel'),
              onChange: function (mode) { setField('fallbackMode', normalizeMode(mode)) },
            })
          )
        ),

        el('div', { className: 'dsh-sg-search-row' },
          el('input', {
            className: 'dsh-sg-input dsh-sg-search-input',
            type: 'search',
            placeholder: t('searchPlaceholder'),
            value: query,
            onChange: function (e) { setQuery(e.target.value) },
          }),
          el('button', {
            className: 'dsh-sg-btn dsh-sg-btn-sm dsh-sg-search-btn',
            type: 'button',
            disabled: busy,
            onClick: fetchSkills,
          }, busy ? t('refreshing') : t('refresh'))
        ),

        el('div', { className: 'dsh-sg-toolbar dsh-sg-toolbar-filters' },
          el('div', { className: 'dsh-sg-toolbar-left' },
            el('label', { className: 'dsh-sg-field', title: t('limitHint') },
              el('span', { className: 'dsh-sg-control-label' }, t('limitLabel')),
              el('input', {
                className: 'dsh-sg-input dsh-sg-input-num',
                type: 'number',
                min: '0',
                step: '10',
                placeholder: '120',
                value: limitValue,
                onChange: function (e) { setDescriptionLimit(e.target.value) },
              })
            ),
            el('label', { className: 'dsh-sg-field' },
              el('span', { className: 'dsh-sg-control-label' }, t('filterLabel')),
              el('select', {
                className: 'dsh-sg-select',
                value: modeFilter,
                onChange: function (e) { setModeFilter(e.target.value) },
              }, [['all', t('filter_all')]].concat(MODE_VALUES.map(function (mode) { return [mode, modeLabel(t, mode)] })).map(function (pair) {
                return el('option', { key: pair[0], value: pair[0] }, pair[1])
              })),
            ),
            el('label', { className: 'dsh-sg-field' },
              el('span', { className: 'dsh-sg-control-label' }, t('usageLabel')),
              el('select', {
                className: 'dsh-sg-select',
                value: usageFilter,
                onChange: function (e) { setUsageFilter(e.target.value) },
              }, [['all', t('filter_all')], ['called', t('usage_called')], ['never', t('usage_never')]].map(function (pair) {
                return el('option', { key: pair[0], value: pair[0] }, pair[1])
              })),
            ),
            el('label', { className: 'dsh-sg-field' },
              el('span', { className: 'dsh-sg-control-label' }, t('sortLabel')),
              el('select', {
                className: 'dsh-sg-select',
                value: sort,
                onChange: function (e) { setSort(e.target.value) },
              }, [['calls', t('sort_calls')], ['name', t('sort_name')], ['tokens', t('sort_tokens')], ['mode', t('sort_mode')]].map(function (pair) {
                return el('option', { key: pair[0], value: pair[0] }, pair[1])
              }))
            )
          ),
        ),
        body,

        el('div', { className: 'dsh-sg-footer' }, t('footer'))
      )
    }

    // ── Plugins 页入口卡片：只保留插件开关 ───────────────────────────────────
    function SkillControlEntryCard(props) {
      useLocaleListener(props.ctx)
      var t = props.t || createTranslator(props.ctx)
      var formState = useForm(props.form)
      var current = formState[0]
      var setField = formState[1]
      var config = current.value || {}
      var enabled = config.enabled !== false
      return el('div', { className: 'dsh-sg-entry' },
        el('div', { className: 'dsh-sg-entry-main' },
          el('div', { className: 'dsh-sg-entry-title' },
            el('span', { className: 'dsh-sg-title-main' }, icon('book'), 'Skill 管理'),
            el('span', { className: 'dsh-sg-badge' + (enabled ? '' : ' dsh-sg-badge-gray') }, enabled ? t('enabledOn') : t('enabledOff'))
          ),
          el('div', { className: 'dsh-sg-entry-desc' }, t('entryDescription'))
        ),
        el(Switch, {
          checked: enabled,
          label: t('enableLabel'),
          onChange: function (val) { setField('enabled', val) },
        })
      )
    }

    exports.SkillControlCard = SkillControlCard
    exports.SkillManagerCard = SkillControlCard

    // ── 客户端插件导出 ───────────────────────────────────────────────────────
    exports.name = 'dsh-skill-control'
    exports.inject = ['slots', 'configForms', 'locale']

    exports.apply = function (ctx) {
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
        }, 'skill-control: dictionaries')
      }

      var form = configForms.get(NAMESPACE)
      var store = {
        subscribe: function (listener) { return form.subscribe(listener) },
        getSnapshot: function () { return form.getSnapshot() },
        set: function (field, value) { return form.set(field, value) },
      }

      // 详细的「设置 → Skill 管理」菜单由 dsh-prompt-control 注册并复用 SkillControlCard；
      // 本插件只注册 Plugins 页的入口开关卡片，避免同一张完整卡片出现两次。
      ctx.effect(function () {
        return configForms.whileServed([NAMESPACE], function () {
          var unregBundleConfig = slots.inject('plugins.bundle.config', function () {
            return slots.register({
              name: 'plugins.bundle.config',
              key: 'dsh-skill-control',
              locale: NS,
              label: function () { return createTranslator(ctx)('bundleTitle') },
            }, function (props) {
              return el(SkillControlEntryCard, { form: store, ctx: ctx, t: (props && props.t) || createTranslator(ctx) })
            })
          })

          return function () {
            if (typeof unregBundleConfig === 'function') unregBundleConfig()
          }
        })
      }, 'skill-control: plugins.bundle.config entry card')
    }

    return module.exports
  },
})
