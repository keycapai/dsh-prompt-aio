/**
 * dsh-prompt-control client half — 提示词管理卡片
 *
 * 挂载于 Plugins 设置页面的 `plugins.bundle.config` 插槽，以及 `settings.section` 一级菜单。
 * 遵循 DSH 客户端规范，无缝集成官方 UI Primitives。
 *
 * @module dsh-prompt-control/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-prompt-control',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var el = React.createElement

    // ── 线性图标：统一视觉重量，替代各处的彩色 emoji ──
    var ICON_PATHS = {
      list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
      folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
      plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v5'],
      plus: ['M12 5v14', 'M5 12h14'],
      eye: ['M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
      refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v5h-5'],
      edit: ['M12 20h9', 'M16.6 3.4a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
      undo: ['M3 7v6h6', 'M3.6 13a9 9 0 1 0 2.7-8.4'],
      up: ['M12 19V5', 'M5 12l7-7 7 7'],
      down: ['M12 5v14', 'M19 12l-7 7-7-7'],
      alert: ['M12 8v5', 'M12 16.5h.01', 'M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
      brain: ['M9.5 3.5A3 3 0 0 0 6.6 7a3 3 0 0 0-1 5.6A3 3 0 0 0 8 18h1.5', 'M14.5 3.5A3 3 0 0 1 17.4 7a3 3 0 0 1 1 5.6A3 3 0 0 1 16 18h-1.5', 'M12 3.5v17'],
      user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8'],
      scroll: ['M7 3h9a3 3 0 0 1 3 3v11a3 3 0 0 0 3 3H9a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2z', 'M9 8h7', 'M9 12h7', 'M9 16h4'],
      wrench: ['M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.8 2.8 0 0 1-4-4z', 'M15 5l4 4'],
      package: ['M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z', 'M3.3 7 12 12l8.7-5', 'M12 22V12'],
      globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18'],
      puzzle: ['M10 3.5a2 2 0 0 1 4 0V5h2.5A1.5 1.5 0 0 1 18 6.5V9h1.5a2 2 0 0 1 0 4H18v2.5a1.5 1.5 0 0 1-1.5 1.5H14v1.5a2 2 0 0 1-4 0V17H7.5A1.5 1.5 0 0 1 6 15.5V13H4.5a2 2 0 0 1 0-4H6V6.5A1.5 1.5 0 0 1 7.5 5H10z'],
    }
    function icon(name) {
      var paths = ICON_PATHS[name] || []
      return el('svg', {
        key: 'ico-' + name,
        className: 'dsh-pg-ico',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true',
      }, paths.map(function (d, i) { return el('path', { key: i, d: d }) }))
    }

    var primitives = (function () {
      try { return require('@deepseek-ai/dsh-client-ui-primitives') || {} } catch (_) { return {} }
    })()

    var NAMESPACE = 'prompt-control-row'
    var API_ROUTE = '/api/dsh-prompt-control/data'
    var NS = 'promptControl'
    var DICTS = {
      zh: {
        sectionTitle: '提示词管理',
        skillSectionTitle: 'Skill 管理',
        toolSectionTitle: '工具管理',
        bundleTitle: 'Prompt Control',
        headTitle: '系统提示词管理 (System Prompt Control)',
        headDesc: '按实际装配顺序查看原提示词，支持在原提示词上修改、切换预设、使用 {{model}} 等变量占位符，并在任意位置插入定制规则。',
        enabledGlobal: '全局开启',
        disabledGlobal: '全局停用',
        currentPreset: '当前预设:',
        allPresets: '全部预设 (全局)',
        defaultTag: ' (默认)',
        viewSequence: '按实际顺序展示 (推荐)',
        viewCategory: '按来源分类展示',
        searchPlaceholder: '搜索段落名、提示词内容或标识...',
        insertRule: '新增提示词插入',
        previewPrompt: '预览装配全文',
        refresh: '刷新',
        aiOptimize: 'AI优化',
        aiOptimizeHint: '打开新会话，让 Agent 根据 prompt-control-optimize 技能自动优化系统提示词配置',
        aiOptimizeCopied: '已复制优化指令',
        aiOptimizePrompt: '/prompt-control-optimize 请根据 prompt-control-optimize 技能检查当前系统提示词与运行时上下文配置，按最优方案完成瘦身与持久化优化，并汇报优化前后预估 Token 变化。',
        knownSections: '已知段落: ',
        sectionsInPreset: '当前预设定义段落 [{preset}]: ',
        enabledCount: '生效启用: ',
        customCount: '自定义插入: ',
        estTokens: '预估当前装配 Tokens: ',
        supportedVars: '支持占位符: ',
        flowTitle: '实际装配执行顺序 (Top-to-Bottom Prompt Flow)',
        flowBadge: '{count} 个装配节点',
        flowDesc: '完全按照大模型接收提示词的真实先后次序排序',
        loadingPrompt: '正在加载系统提示词数据...',
        noMatchingSections: '没有匹配的提示词段落',
        customRulesGroup: '自定义插入规则 (Custom Insertions)',
        editContent: '修改内容',
        editOnDefault: '在原词上编辑',
        resetDefault: '还原默认',
        insertBefore: '之前插入',
        insertAfter: '之后插入',
        expandFull: '展开完整内容',
        collapse: '收起',
        viewDiff: '查看与原词对比',
        hideDiff: '隐藏对比',
        saveChanges: '保存修改',
        cancel: '取消',
        restoreDefault: '恢复系统默认原提示词',
        insertVarHint: '可点击插入动态变量：',
        overriddenTag: '已自定义覆盖',
        defaultSystemTag: '系统默认',
        noOriginalText: '(暂无原提示词内容)',
        insertModalTitle: '在任意位置插入系统提示词',
        ruleNameLabel: '提示词名称 / 标识:',
        ruleNamePlaceholder: '例如: 安全编码守则、专属角色要求',
        targetPresetLabel: '生效预设 (Preset):',
        positionLabel: '插入方式 (Position):',
        posAfter: '紧接在目标段落之后 (After)',
        posBefore: '紧接在目标段落之前 (Before)',
        posStart: '置于提示词最前 (At Start)',
        posEnd: '置于提示词最后 (At End)',
        anchorLabel: '锚点目标段落 (Target Section):',
        contentLabel: '提示词正文内容 (Markdown):',
        quickInsertVar: '快捷插入变量:',
        contentPlaceholder: '输入你想插入的提示词内容，例如：\n## 安全规范\n当前处于 {{model}} 模型环境，严禁向外部泄露内部敏感信息...',
        contentTip: '提示：在提示词中输入 {{model}}、{{provider}}、{{cwd}} 等占位符，DSH 装配时将自动替换为实时变量值。',
        confirmInsert: '确认插入',
        previewModalTitle: '完整提示词装配预览 ({preset})',
        totalSections: '段落总数: {count}',
        totalChars: '总字符数: {count}',
        estTokensShort: '预估 Tokens: ~{tokens}',
        varsInterpolated: '变量已完成实时插值模拟',
        copyAll: '复制全部',
        copied: '已复制到剪贴板',
        close: '关闭',
        deleteRule: '删除',
        varModel: '当前模型',
        varProvider: '服务商',
        varCwd: '工作目录'
      },
      en: {
        sectionTitle: 'Prompt control',
        skillSectionTitle: 'Skill manager',
        toolSectionTitle: 'Tool manager',
        bundleTitle: 'Prompt Control',
        headTitle: 'System Prompt Control',
        headDesc: 'Inspect prompts in actual assembly order, customize prompt sections, switch presets, use {{model}} variables, and insert rules at any position.',
        enabledGlobal: 'Globally enabled',
        disabledGlobal: 'Globally disabled',
        currentPreset: 'Preset:',
        allPresets: 'All presets (Global)',
        defaultTag: ' (default)',
        viewSequence: 'Assembly order (Recommended)',
        viewCategory: 'By category',
        searchPlaceholder: 'Search section name, prompt content or key...',
        insertRule: 'Insert rule',
        previewPrompt: 'Preview full prompt',
        refresh: 'Refresh',
        aiOptimize: 'AI Optimize',
        aiOptimizeHint: 'Start a new session and let the agent optimize prompt settings via prompt-control-optimize',
        aiOptimizeCopied: 'Prompt copied',
        aiOptimizePrompt: '/prompt-control-optimize Please use the prompt-control-optimize skill to audit and optimize the current system prompt and runtime context settings, persist the changes, and summarize the estimated token savings.',
        knownSections: 'Known sections: ',
        sectionsInPreset: 'Defined sections [{preset}]: ',
        enabledCount: 'Enabled: ',
        customCount: 'Custom insertions: ',
        estTokens: 'Est. tokens: ',
        supportedVars: 'Variables: ',
        flowTitle: 'Assembled prompt execution flow',
        flowBadge: '{count} nodes',
        flowDesc: 'Sorted strictly according to real LLM prompt assembly sequence',
        loadingPrompt: 'Loading prompt data...',
        noMatchingSections: 'No matching prompt sections found',
        customRulesGroup: 'Custom insertions',
        editContent: 'Edit content',
        editOnDefault: 'Edit on default',
        resetDefault: 'Reset default',
        insertBefore: 'Insert before',
        insertAfter: 'Insert after',
        expandFull: 'Expand full text',
        collapse: 'Collapse',
        viewDiff: 'View diff with default',
        hideDiff: 'Hide diff',
        saveChanges: 'Save changes',
        cancel: 'Cancel',
        restoreDefault: 'Restore system default',
        insertVarHint: 'Click to insert template variable: ',
        overriddenTag: 'Custom override',
        defaultSystemTag: 'System default',
        noOriginalText: '(No original prompt text)',
        insertModalTitle: 'Insert custom prompt rule',
        ruleNameLabel: 'Rule name / identifier:',
        ruleNamePlaceholder: 'e.g. Security guidelines, Role prompt',
        targetPresetLabel: 'Target preset:',
        positionLabel: 'Position:',
        posAfter: 'After target section (After)',
        posBefore: 'Before target section (Before)',
        posStart: 'At beginning (At Start)',
        posEnd: 'At end (At End)',
        anchorLabel: 'Anchor target section:',
        contentLabel: 'Prompt markdown:',
        quickInsertVar: 'Insert variable:',
        contentPlaceholder: 'Enter your custom prompt markdown here... Supports {{model}}, {{provider}}, {{cwd}}',
        contentTip: 'Tip: Enter placeholders like {{model}}, {{provider}}, {{cwd}} to dynamically substitute values during assembly.',
        confirmInsert: 'Confirm insert',
        previewModalTitle: 'Full assembled prompt preview ({preset})',
        totalSections: 'Total sections: {count}',
        totalChars: 'Total characters: {count}',
        estTokensShort: 'Est. Tokens: ~{tokens}',
        varsInterpolated: 'Variables evaluated with live simulation',
        copyAll: 'Copy all',
        copied: 'Copied to clipboard',
        close: 'Close',
        deleteRule: 'Delete',
        varModel: 'Current model',
        varProvider: 'Provider',
        varCwd: 'Working directory'
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


    // ── 基础样式 ─────────────────────────────────────────────────────────────
    var STYLE_ID = 'dsh-prompt-control/style'
    // 样式集中在 STYLE_TEXT，ensureStyles 每次都会比对并同步，避免热更新残留旧样式
    var STYLE_TEXT = `
/* ══ 设计令牌：全部取自 DSH 主题别名，与官方设置页保持一致 ══════════ */
.dsh-pg-card, .dsh-pg-modal-overlay {
  --dpg-r-xs: 4px; --dpg-r-sm: 6px; --dpg-r-md: 8px; --dpg-r-lg: 10px; --dpg-r-pill: 999px;
  --dpg-ctl: 28px; --dpg-ctl-sm: 24px;
  --dpg-surface-1: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.045));
  --dpg-surface-2: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09));
  --dpg-surface-3: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.16));
  --dpg-elevated: var(--dsw-alias-bg-elevated, rgba(128,128,128,.22));
  --dpg-line: var(--dsw-alias-border-subtle, rgba(128,128,128,.18));
  --dpg-line-2: var(--dsw-alias-border-default, rgba(128,128,128,.28));
  --dpg-line-3: var(--dsw-alias-border-l1, rgba(128,128,128,.45));
  --dpg-text-1: var(--dsw-alias-text-primary, #e2e8f0);
  --dpg-text-2: var(--dsw-alias-text-secondary, #94a3b8);
  --dpg-text-3: var(--dsw-alias-text-tertiary, #8b95a6);
  --dpg-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --dpg-focus: 0 0 0 3px rgba(128,128,128,.26);
  --dpg-ease: cubic-bezier(.22,.61,.36,1);
}
/* ══ 骨架 ═══════════════════════════════════════════════════════ */
.dsh-pg-card { display: flex; flex-direction: column; gap: 14px; font-size: 13px; color: var(--dpg-text-1); }
/* ══ 页头 ═══════════════════════════════════════════════════════ */
.dsh-pg-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: nowrap; gap: 10px 14px; padding-bottom: 12px; border-bottom: 1px solid var(--dpg-line); }
.dsh-pg-header-main { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.dsh-pg-header-title { font-weight: 600; font-size: 15px; line-height: 1.35; display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-pg-title-main { display: inline-flex; align-items: center; gap: 8px; }
.dsh-pg-title-main .dsh-pg-ico { width: 15px; height: 15px; opacity: .7; }
.dsh-pg-badges-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.dsh-pg-header-desc { font-size: 12px; line-height: 1.6; color: var(--dpg-text-3); }
.dsh-pg-header-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: nowrap; }
/* ══ 预设切换 ═══════════════════════════════════════════════════ */
.dsh-pg-preset-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 6px 10px; background: var(--dpg-surface-2); border: 1px solid var(--dpg-line); border-radius: var(--dpg-r-md); }
.dsh-pg-preset-label { font-size: 12px; font-weight: 600; color: var(--dpg-text-2); white-space: nowrap; }
.dsh-pg-preset-tabs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.dsh-pg-preset-tab { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: var(--dpg-r-xs); font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid transparent; background: transparent; color: var(--dpg-text-2); transition: background .14s var(--dpg-ease), color .14s var(--dpg-ease), border-color .14s var(--dpg-ease); white-space: nowrap; }
.dsh-pg-preset-tab:hover:not(.active) { background: var(--dpg-surface-3); color: var(--dpg-text-1); }
.dsh-pg-preset-tab:focus-visible { outline: none; box-shadow: var(--dpg-focus); }
.dsh-pg-preset-tab.active { background: var(--dpg-elevated); border-color: var(--dpg-line-2); color: var(--dpg-text-1); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.16); }
/* ══ 工具栏 ═════════════════════════════════════════════════════ */
.dsh-pg-toolbar { display: flex; flex-direction: column; gap: 8px; }
.dsh-pg-toolbar-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.dsh-pg-tab-group { display: inline-flex; align-items: center; gap: 2px; padding: 2px; background: var(--dpg-surface-2); border: 1px solid var(--dpg-line); border-radius: var(--dpg-r-sm); }
.dsh-pg-btn-tab { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: var(--dpg-r-xs); font-size: 11.5px; font-weight: 500; border: 1px solid transparent; background: transparent; color: var(--dpg-text-2); cursor: pointer; transition: background .14s var(--dpg-ease), color .14s var(--dpg-ease); white-space: nowrap; }
.dsh-pg-btn-tab:hover:not(.active) { background: var(--dpg-surface-3); color: var(--dpg-text-1); }
.dsh-pg-btn-tab:focus-visible { outline: none; box-shadow: var(--dpg-focus); }
.dsh-pg-btn-tab.active { background: var(--dpg-elevated); border-color: var(--dpg-line-2); color: var(--dpg-text-1); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.16); }
/* ══ 指标概览 ═══════════════════════════════════════════════════ */
.dsh-pg-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; padding: 7px 10px; background: var(--dpg-surface-2); border: 1px solid var(--dpg-line); border-radius: var(--dpg-r-md); font-size: 11.5px; }
.dsh-pg-stat-item { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; white-space: nowrap; color: var(--dpg-text-3); border: 1px solid transparent; border-radius: var(--dpg-r-xs); }
.dsh-pg-stat-item strong { font-weight: 600; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--dpg-text-1); }
.dsh-pg-stat-item code { padding: 1px 5px; border-radius: var(--dpg-r-xs); background: var(--dpg-surface-3); font-family: var(--dpg-mono); font-size: 10.5px; color: var(--dpg-text-2); }
.dsh-pg-stat-item.is-muted { color: var(--dpg-text-3); opacity: .85; }
/* ══ 表单控件 ═══════════════════════════════════════════════════ */
.dsh-pg-input { height: var(--dpg-ctl); padding: 0 10px; box-sizing: border-box; font: inherit; font-size: 12px; border-radius: var(--dpg-r-sm); border: 1px solid var(--dpg-line-2); background: var(--dpg-surface-2); color: var(--dpg-text-1); outline: none; transition: border-color .14s var(--dpg-ease), box-shadow .14s var(--dpg-ease); }
.dsh-pg-input::placeholder { color: var(--dpg-text-3); }
.dsh-pg-input:hover { border-color: var(--dpg-line-3); }
.dsh-pg-input:focus { border-color: var(--dpg-line-3); box-shadow: var(--dpg-focus); }
.dsh-pg-select { height: var(--dpg-ctl); padding: 0 8px; font: inherit; font-size: 12px; border-radius: var(--dpg-r-sm); border: 1px solid var(--dpg-line-2); background: var(--dpg-surface-2); color: var(--dpg-text-1); outline: none; cursor: pointer; }
.dsh-pg-select:focus { border-color: var(--dpg-line-3); box-shadow: var(--dpg-focus); }
/* ══ 按钮 ═══════════════════════════════════════════════════════ */
.dsh-pg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: var(--dpg-ctl); padding: 0 10px; border-radius: var(--dpg-r-sm); font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--dpg-line-2); background: var(--dpg-elevated); color: var(--dpg-text-1); transition: background .14s var(--dpg-ease), border-color .14s var(--dpg-ease), color .14s var(--dpg-ease); white-space: nowrap; }
.dsh-pg-btn:hover:not(:disabled) { background: var(--dpg-surface-3); border-color: var(--dpg-line-3); }
.dsh-pg-btn:active:not(:disabled) { transform: translateY(.5px); }
.dsh-pg-btn:focus-visible { outline: none; box-shadow: var(--dpg-focus); }
.dsh-pg-btn:disabled { opacity: .45; cursor: not-allowed; }
.dsh-pg-btn-sm { height: var(--dpg-ctl-sm); padding: 0 7px; gap: 4px; font-size: 11px; border-radius: var(--dpg-r-xs); }
.dsh-pg-item-actions .dsh-pg-btn-sm { background: transparent; border-color: transparent; color: var(--dpg-text-3); }
.dsh-pg-item:hover .dsh-pg-item-actions .dsh-pg-btn-sm { background: var(--dpg-surface-2); border-color: var(--dpg-line); color: var(--dpg-text-2); }
.dsh-pg-item-actions .dsh-pg-btn-sm:hover:not(:disabled), .dsh-pg-item-actions .dsh-pg-btn-sm:focus-visible { background: var(--dpg-surface-3); border-color: var(--dpg-line-2); color: var(--dpg-text-1); }
.dsh-pg-btn-primary { background: var(--dpg-surface-3); border-color: var(--dpg-line-3); font-weight: 600; }
.dsh-pg-btn-primary:hover:not(:disabled) { background: var(--dpg-elevated); border-color: var(--dpg-line-3); }
.dsh-pg-btn-ai { background: rgba(56,189,248,.14); border: 1px solid rgba(56,189,248,.45); color: var(--dsw-alias-text-accent, #38bdf8); font-weight: 600; }
.dsh-pg-btn-ai:hover:not(:disabled) { background: rgba(56,189,248,.22); border-color: rgba(56,189,248,.65); }
.dsh-pg-btn-danger { color: var(--dsw-alias-state-error-primary, #ef4444) !important; border-color: rgba(239,68,68,.3); background: transparent; }
.dsh-pg-btn-danger:hover:not(:disabled) { background: rgba(239,68,68,.12); }
/* ══ 图标 ═══════════════════════════════════════════════════════ */
.dsh-pg-ico { width: 14px; height: 14px; flex: 0 0 auto; stroke-width: 1.7; opacity: .85; }
.dsh-pg-btn-tab .dsh-pg-ico, .dsh-pg-btn-sm .dsh-pg-ico, .dsh-pg-badge .dsh-pg-ico { width: 13px; height: 13px; }
.dsh-pg-group-title-main .dsh-pg-ico { width: 15px; height: 15px; opacity: .7; }
/* ══ 变量占位符 ═════════════════════════════════════════════════ */
.dsh-pg-var-tag { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: var(--dpg-r-xs); font-size: 11px; font-family: var(--dpg-mono); background: var(--dpg-surface-2); color: var(--dpg-text-2); border: 1px dashed var(--dpg-line-2); cursor: pointer; user-select: none; transition: background .14s var(--dpg-ease), border-color .14s var(--dpg-ease), color .14s var(--dpg-ease); }
.dsh-pg-var-tag:hover { background: var(--dpg-surface-3); border-style: solid; border-color: var(--dpg-line-3); color: var(--dpg-text-1); }
.dsh-pg-var-tag:focus-visible { outline: none; box-shadow: var(--dpg-focus); }
/* ══ 分组容器 ═══════════════════════════════════════════════════ */
.dsh-pg-group { border: 1px solid var(--dpg-line); border-radius: var(--dpg-r-md); overflow: hidden; background: var(--dpg-surface-1); }
.dsh-pg-group-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; padding: 10px 12px; background: var(--dpg-surface-2); border-bottom: 1px solid var(--dpg-line); cursor: pointer; user-select: none; }
.dsh-pg-group-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-weight: 600; font-size: 13px; min-width: 0; color: var(--dpg-text-1); }
.dsh-pg-group-title-main { display: inline-flex; align-items: center; gap: 8px; }
.dsh-pg-group-desc { font-size: 11.5px; font-weight: 400; color: var(--dpg-text-3); }
.dsh-pg-group-body { display: flex; flex-direction: column; }
/* ══ 段落条目 ═══════════════════════════════════════════════════ */
.dsh-pg-item { position: relative; display: flex; flex-direction: column; padding: 12px; gap: 8px; border-bottom: 1px solid var(--dpg-line); transition: background .14s var(--dpg-ease); }
.dsh-pg-item:last-child { border-bottom: none; }
.dsh-pg-item:hover { background: var(--dpg-surface-2); }
.dsh-pg-item::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: transparent; }
.dsh-pg-item:hover::before { background: var(--dpg-line-3); }
.dsh-pg-item-custom { background: var(--dpg-surface-2); }
.dsh-pg-item-custom::before, .dsh-pg-item-custom:hover::before { background: var(--dpg-line-3); }
.dsh-pg-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; width: 100%; }
.dsh-pg-item-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--dpg-text-1); }
.dsh-pg-item-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap; }
.dsh-pg-item-desc { font-size: 12px; color: var(--dpg-text-2); line-height: 1.5; }
.dsh-pg-badges-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; width: 100%; }
/* ══ 徽标：统一中性灰，靠字重/底色区分层级 ══════════════════════ */
.dsh-pg-badge { display: inline-flex; align-items: center; gap: 4px; height: 19px; padding: 0 6px; box-sizing: border-box; border-radius: var(--dpg-r-xs); font-size: 10.5px; font-weight: 500; font-family: var(--dpg-mono); white-space: nowrap; flex-shrink: 0; border: 1px solid var(--dpg-line-2); background: var(--dpg-surface-2); color: var(--dpg-text-2); }
.dsh-pg-badge-order { font-weight: 700; color: var(--dpg-text-1); background: var(--dpg-surface-3); border-color: var(--dpg-line-3); }
.dsh-pg-badge-blue, .dsh-pg-badge-green, .dsh-pg-badge-orange, .dsh-pg-badge-purple { color: var(--dpg-text-2); border-color: var(--dpg-line-2); background: var(--dpg-surface-2); }
.dsh-pg-badge.is-inactive { color: var(--dpg-text-3); border-style: dashed; background: transparent; }
.dsh-pg-warn { display: inline-flex; align-items: center; color: var(--dsw-alias-state-warn-primary, #f59e0b); flex: 0 0 auto; }
.dsh-pg-warn .dsh-pg-ico { width: 15px; height: 15px; opacity: 1; }
/* ══ 提示词展示 / 编辑 ══════════════════════════════════════════ */
.dsh-pg-prompt-box { position: relative; background: var(--dpg-surface-2); border: 1px solid var(--dpg-line); border-radius: var(--dpg-r-sm); padding: 8px 10px; font-family: var(--dpg-mono); font-size: 11.5px; line-height: 1.55; color: var(--dpg-text-2); white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; }
.dsh-pg-prompt-box-empty { display: flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 10px; background: transparent; border-style: dashed; color: var(--dpg-text-3); font-family: inherit; font-size: 11.5px; }
.dsh-pg-textarea { width: 100%; min-height: 96px; box-sizing: border-box; padding: 9px 10px; font-family: var(--dpg-mono); font-size: 12px; line-height: 1.6; border-radius: var(--dpg-r-sm); border: 1px solid var(--dpg-line-2); background: var(--dpg-surface-2); color: var(--dpg-text-1); outline: none; resize: vertical; transition: border-color .14s var(--dpg-ease), box-shadow .14s var(--dpg-ease); }
.dsh-pg-textarea::placeholder { color: var(--dpg-text-3); }
.dsh-pg-textarea:focus { border-color: var(--dpg-line-3); box-shadow: var(--dpg-focus); }
/* ══ 状态胶囊 ═══════════════════════════════════════════════════ */
.dsh-pg-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--dpg-text-3); }
.dsh-pg-dot { width: 5px; height: 5px; border-radius: 50%; flex: 0 0 auto; background: currentColor; }
.dsh-pg-status.is-on .dsh-pg-dot { background: var(--dsw-alias-state-success-primary, #22c55e); }
.dsh-pg-status.is-off .dsh-pg-dot { background: var(--dpg-text-3); }
/* ══ 滚动条 ═════════════════════════════════════════════════════ */
.dsh-pg-prompt-box::-webkit-scrollbar, .dsh-pg-modal-body::-webkit-scrollbar { width: 10px; height: 10px; }
.dsh-pg-prompt-box::-webkit-scrollbar-track, .dsh-pg-modal-body::-webkit-scrollbar-track { background: transparent; }
.dsh-pg-prompt-box::-webkit-scrollbar-thumb, .dsh-pg-modal-body::-webkit-scrollbar-thumb { background: var(--dpg-line-2); border: 3px solid transparent; border-radius: var(--dpg-r-pill); background-clip: padding-box; }
.dsh-pg-prompt-box::-webkit-scrollbar-thumb:hover, .dsh-pg-modal-body::-webkit-scrollbar-thumb:hover { background: var(--dpg-line-3); border: 3px solid transparent; background-clip: padding-box; }
/* ══ 弹窗 ═══════════════════════════════════════════════════════ */
@keyframes dsh-pg-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes dsh-pg-pop { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.dsh-pg-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px; animation: dsh-pg-fade .14s var(--dpg-ease); }
.dsh-pg-modal { background: var(--dsw-alias-bg-layer-1, #1e293b); border: 1px solid var(--dpg-line-2); border-radius: var(--dpg-r-lg); width: 720px; max-width: 95vw; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 36px rgba(0,0,0,.55); animation: dsh-pg-pop .16s var(--dpg-ease); }
.dsh-pg-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--dpg-line); font-weight: 600; font-size: 14px; }
.dsh-pg-modal-body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.dsh-pg-modal-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dpg-line); }
/* ══ 无障碍 / 动效偏好 ══════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  .dsh-pg-modal-overlay, .dsh-pg-modal { animation: none !important; }
  .dsh-pg-card *, .dsh-pg-modal-overlay, .dsh-pg-modal { transition: none !important; }
}
`
    function ensureStyles() {
      if (typeof document === 'undefined') return
      var style = document.getElementById(STYLE_ID)
      if (style === null) {
        style = document.createElement('style')
        style.id = STYLE_ID
        document.head.appendChild(style)
      }
      if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT
    }

    // ── Form Hook ────────────────────────────────────────────────────────────
    function useForm(form) {
      var state = React.useState(function () {
        var snap = form.getSnapshot()
        return { status: snap.status, value: snap.value || {}, writable: snap.writable }
      })
      var current = state[0]
      var setCurrent = state[1]
      React.useEffect(function () {
        return form.subscribe(function () {
          var snap = form.getSnapshot()
          setCurrent({ status: snap.status, value: snap.value || {}, writable: snap.writable })
        })
      }, [form])
      var setField = React.useCallback(function (field, value) {
        return form.set(field, value).catch(function () {})
      }, [form])
      return [current, setField]
    }

    // ── 基础控件 ─────────────────────────────────────────────────────────────
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
        onChange: function (e) { props.onChange(e.target.checked) },
      })
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
          console.warn('dsh-prompt-control: failed to start AI optimize session:', err)
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(promptText).then(function () {
          if (typeof onFallbackCopied === 'function') onFallbackCopied()
        }).catch(function () {})
      }
      return false
    }

    // ── 主面板卡片 ───────────────────────────────────────────────────────────
    function PromptControlCard(props) {
      useLocaleListener(props.ctx)
      var t = props.t || createTranslator(props.ctx)
      var formState = useForm(props.form)
      var current = formState[0]
      var setField = formState[1]
      var config = current.value || {}

      var enabled = config.enabled !== false
      var overrides = config.overrides || {}
      var aiCopiedState = React.useState(false)
      var aiCopied = aiCopiedState[0]
      var setAiCopied = aiCopiedState[1]

      function handleAiOptimize() {
        launchAiOptimize(props.ctx, t('aiOptimizePrompt'), props.closeSettings, function () {
          setAiCopied(true)
          setTimeout(function () { setAiCopied(false) }, 2200)
        })
      }
      var presetOverrides = config.presetOverrides || {}
      var insertions = config.insertions || []

      // 选中的预设过滤器（all / standard / ptc / minimal / ...），默认匹配 DSH 主运行态 (ptc)
      var selectedPresetState = React.useState('ptc')
      var selectedPreset = selectedPresetState[0]
      var setSelectedPreset = selectedPresetState[1]
      var userPickedPresetRef = React.useRef(false)

      // 展示模式：'sequence' (按实际装配顺序) | 'category' (按来源分类分组)
      var viewModeState = React.useState('sequence')
      var viewMode = viewModeState[0]
      var setViewMode = viewModeState[1]

      // 搜索关键字
      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]

      // 展开全文段落的 key 集合 (key -> boolean)
      var expandedTextsState = React.useState({})
      var expandedTexts = expandedTextsState[0]
      var setExpandedTexts = expandedTextsState[1]

      // 查看原提示词对比状态 (key -> boolean)
      var showingOriginalState = React.useState({})
      var showingOriginal = showingOriginalState[0]
      var setShowingOriginal = showingOriginalState[1]

      // 当前正在编辑的段落 key (null 表示未在编辑)
      var editingKeyState = React.useState(null)
      var editingKey = editingKeyState[0]
      var setEditingKey = editingKeyState[1]

      var editingTextState = React.useState('')
      var editingText = editingTextState[0]
      var setEditingText = editingTextState[1]

      // 模态弹窗状态
      var showInsertModalState = React.useState(false)
      var showInsertModal = showInsertModalState[0]
      var setShowInsertModal = showInsertModalState[1]

      var showPreviewModalState = React.useState(false)
      var showPreviewModal = showPreviewModalState[0]
      var setShowPreviewModal = showPreviewModalState[1]

      var previewDataState = React.useState(null)
      var previewData = previewDataState[0]
      var setPreviewData = previewDataState[1]

      // 插入表单状态
      var insertFormState = React.useState({
        id: '',
        name: '',
        preset: 'all',
        targetSection: '<end>',
        position: 'after',
        text: '',
      })
      var insertForm = insertFormState[0]
      var setInsertForm = insertFormState[1]

      // 后端实时数据
      var liveDataState = React.useState({
        status: 'loading',
        presets: [{ id: 'all', name: '全部预设 (全局)' }],
        categories: [],
        sections: [],
        contexts: [],
        messageInjections: [],
        availableVariables: [
          { name: 'model', label: '当前模型', desc: 'LLM 模型标识', placeholder: '{{model}}' },
          { name: 'provider', label: '服务商', desc: '服务商名称', placeholder: '{{provider}}' },
          { name: 'cwd', label: '工作目录', desc: '工作目录路径', placeholder: '{{cwd}}' },
        ],
      })
      var liveData = liveDataState[0]
      var setLiveData = liveDataState[1]

      // 加载/刷新后端数据
      var fetchOverview = React.useCallback(function (preset) {
        var p = preset || selectedPreset
        fetch(API_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'get-overview', preset: p }),
        })
          .then(function (res) { return res.json() })
          .then(function (body) {
            if (body && body.ok && body.value) {
              if (!userPickedPresetRef.current && body.value.defaultPreset && selectedPreset !== body.value.defaultPreset) {
                setSelectedPreset(body.value.defaultPreset)
              }
              setLiveData({
                status: 'ready',
                presets: body.value.presets || [],
                categories: body.value.categories || [],
                sections: body.value.sections || [],
                contexts: body.value.contexts || [],
                messageInjections: body.value.messageInjections || [],
                contextInjections: body.value.contextInjections || {},
                insertions: body.value.insertions || [],
                toolOwnedCount: body.value.toolOwnedCount || 0,
                hiddenSectionCount: body.value.hiddenSectionCount || 0,
                drift: body.value.drift || [],
                enabled: body.value.enabled !== false,
                availableVariables: body.value.availableVariables || [],
              })
            }
          })
          .catch(function () {})
      }, [selectedPreset])

      React.useEffect(function () {
        fetchOverview(selectedPreset)
      }, [fetchOverview, selectedPreset])

      // 切换某段落启用/停用
      function handleToggleSection(key, currentEnabled) {
        var nextEnabled = !currentEnabled
        if (selectedPreset === 'all') {
          var nextOverrides = Object.assign({}, overrides)
          var currentRule = nextOverrides[key] || { enabled: true, text: '' }
          nextOverrides[key] = Object.assign({}, currentRule, { enabled: nextEnabled })
          setField('overrides', nextOverrides)
        } else {
          var nextPresetOverrides = Object.assign({}, presetOverrides)
          var pRuleMap = Object.assign({}, nextPresetOverrides[selectedPreset] || {})
          var cRule = pRuleMap[key] || { enabled: true, text: '' }
          pRuleMap[key] = Object.assign({}, cRule, { enabled: nextEnabled })
          nextPresetOverrides[selectedPreset] = pRuleMap
          setField('presetOverrides', nextPresetOverrides)
        }
        setTimeout(function () { fetchOverview(selectedPreset) }, 50)
      }

      // 开始编辑：关键修复 -> 自动预填充原提示词文本（如果在原提示词上修改）
      function handleStartEdit(sec) {
        setEditingKey(sec.key)
        // 优先使用当前自定义文本，若未修改过则预填充系统原生提示词 defaultText
        var initialText = sec.overridden
          ? (sec.currentText || sec.defaultText || '')
          : (sec.defaultText || sec.currentText || '')
        setEditingText(initialText)
      }

      // 插入变量占位符到当前正在编辑的文本末尾或光标处
      function handleInsertVariableToEdit(varName) {
        var token = '{{' + varName + '}}'
        setEditingText(function (prev) {
          return prev + (prev.length > 0 && !prev.endsWith(' ') ? ' ' : '') + token + ' '
        })
      }

      function handleInsertVariableToModal(varName) {
        var token = '{{' + varName + '}}'
        setInsertForm(function (prev) {
          var t = prev.text || ''
          return Object.assign({}, prev, {
            text: t + (t.length > 0 && !t.endsWith(' ') ? ' ' : '') + token + ' '
          })
        })
      }

      // 保存段落文本修改
      function handleSaveSectionText(key) {
        var text = editingText
        if (selectedPreset === 'all') {
          var nextOverrides = Object.assign({}, overrides)
          var currentRule = nextOverrides[key] || { enabled: true, text: '' }
          nextOverrides[key] = Object.assign({}, currentRule, { text: text })
          setField('overrides', nextOverrides)
        } else {
          var nextPresetOverrides = Object.assign({}, presetOverrides)
          var pRuleMap = Object.assign({}, nextPresetOverrides[selectedPreset] || {})
          var cRule = pRuleMap[key] || { enabled: true, text: '' }
          pRuleMap[key] = Object.assign({}, cRule, { text: text })
          nextPresetOverrides[selectedPreset] = pRuleMap
          setField('presetOverrides', nextPresetOverrides)
        }
        setEditingKey(null)
        setTimeout(function () { fetchOverview(selectedPreset) }, 50)
      }

      // 恢复某段落为系统默认原提示词
      function handleResetSection(key) {
        if (selectedPreset === 'all') {
          var nextOverrides = Object.assign({}, overrides)
          if (nextOverrides[key]) {
            delete nextOverrides[key]
            setField('overrides', nextOverrides)
          }
        } else {
          var nextPresetOverrides = Object.assign({}, presetOverrides)
          if (nextPresetOverrides[selectedPreset] && nextPresetOverrides[selectedPreset][key]) {
            delete nextPresetOverrides[selectedPreset][key]
            setField('presetOverrides', nextPresetOverrides)
          }
        }
        if (editingKey === key) setEditingKey(null)
        setTimeout(function () { fetchOverview(selectedPreset) }, 50)
      }

      // 快捷打开插入弹窗（指定在某段落前或后）
      function handleOpenInsertAt(position, targetKey) {
        setInsertForm({
          id: 'ins_' + Date.now().toString(36),
          name: '',
          preset: selectedPreset === 'all' ? 'all' : selectedPreset,
          targetSection: targetKey || '<end>',
          position: position || 'after',
          text: '',
        })
        setShowInsertModal(true)
      }

      // 提交新增自定义提示词
      function handleAddInsertion() {
        if (!insertForm.text || !insertForm.text.trim()) return
        var id = insertForm.id.trim() || ('ins_' + Date.now().toString(36))
        var newIns = {
          id: id,
          name: insertForm.name.trim() || '自定义提示词',
          enabled: true,
          preset: insertForm.preset || 'all',
          targetSection: insertForm.targetSection || '<end>',
          position: insertForm.position || 'after',
          text: insertForm.text,
        }
        var nextList = insertions.concat([newIns])
        setField('insertions', nextList)
        setShowInsertModal(false)
        setInsertForm({ id: '', name: '', preset: 'all', targetSection: '<end>', position: 'after', text: '' })
        setTimeout(function () { fetchOverview(selectedPreset) }, 50)
      }

      // 删除某条自定义提示词
      function handleDeleteInsertion(id) {
        var nextList = insertions.filter(function (ins) { return ins.id !== id })
        setField('insertions', nextList)
        setTimeout(function () { fetchOverview(selectedPreset) }, 50)
      }

      // 切换某条自定义提示词启停
      function handleToggleInsertion(id) {
        var nextList = insertions.map(function (ins) {
          if (ins.id === id) {
            return Object.assign({}, ins, { enabled: ins.enabled === false ? true : false })
          }
          return ins
        })
        setField('insertions', nextList)
        setTimeout(function () { fetchOverview(selectedPreset) }, 50)
      }

      // 运行时注入管理：统一写 contextInjections 配置，保存时随表单一起落盘。
      function currentInjectionConfig() {
        var raw = config && config.contextInjections && typeof config.contextInjections === 'object' ? config.contextInjections : {}
        var live = liveData && liveData.contextInjections && typeof liveData.contextInjections === 'object' ? liveData.contextInjections : {}
        return {
          suppressOptional: Boolean(raw.suppressOptional !== undefined ? raw.suppressOptional : live.suppressOptional),
          disabledContexts: Array.isArray(raw.disabledContexts)
            ? raw.disabledContexts
            : (Array.isArray(live.disabledContexts) ? live.disabledContexts : []),
          disabledKinds: Array.isArray(raw.disabledKinds)
            ? raw.disabledKinds
            : (Array.isArray(live.disabledKinds) ? live.disabledKinds : []),
        }
      }

      function toggleListValue(list, value, enabled) {
        var next = Array.isArray(list) ? list.slice() : []
        var index = next.indexOf(value)
        if (enabled && index < 0) next.push(value)
        if (!enabled && index >= 0) next.splice(index, 1)
        return next
      }

      function updateInjectionConfig(patch) {
        setField('contextInjections', Object.assign({}, currentInjectionConfig(), patch))
      }

      function handleToggleContext(context, enabled) {
        var current = currentInjectionConfig()
        updateInjectionConfig({
          disabledContexts: toggleListValue(current.disabledContexts, context.name, !enabled),
        })
      }

      function handleToggleInjection(kind, enabled) {
        var current = currentInjectionConfig()
        updateInjectionConfig({
          disabledKinds: toggleListValue(current.disabledKinds, kind, !enabled),
        })
      }

      function handleToggleOptionalContexts(enabled) {
        updateInjectionConfig({ suppressOptional: !enabled })
      }

      // 预览完整 Prompt
      function handleOpenPreview() {
        var targetP = selectedPreset === 'all' ? 'standard' : selectedPreset
        fetch(API_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'preview-prompt', preset: targetP }),
        })
          .then(function (res) { return res.json() })
          .then(function (body) {
            if (body && body.ok && body.value) {
              setPreviewData(body.value)
              setShowPreviewModal(true)
            }
          })
          .catch(function () {})
      }

      // 过滤 sections：严格仅展示代码中实际定义并挂载于当前选定预设的提示词
      var q = query.trim().toLowerCase()
      var filteredSections = liveData.sections.filter(function (sec) {
        // 如果当前选定了具体预设（非全局 all）：严格仅保留该预设代码中声明使用的段落
        if (selectedPreset !== 'all') {
          if (sec.inPreset === false) return false
          if (sec.presets && Array.isArray(sec.presets) && !sec.presets.includes('all') && !sec.presets.includes(selectedPreset)) {
            return false
          }
        }
        if (!q) return true
        return (
          sec.key.toLowerCase().indexOf(q) >= 0 ||
          (sec.name && sec.name.toLowerCase().indexOf(q) >= 0) ||
          (sec.source && sec.source.toLowerCase().indexOf(q) >= 0) ||
          (sec.categoryLabel && sec.categoryLabel.toLowerCase().indexOf(q) >= 0) ||
          (sec.defaultText && sec.defaultText.toLowerCase().indexOf(q) >= 0) ||
          (sec.currentText && sec.currentText.toLowerCase().indexOf(q) >= 0)
        )
      })

      // 自定义 insertions
      var matchingInsertions = insertions.filter(function (ins) {
        if (selectedPreset !== 'all' && ins.preset !== 'all' && ins.preset !== selectedPreset) {
          return false
        }
        if (!q) return true
        return (
          ins.name.toLowerCase().indexOf(q) >= 0 ||
          ins.id.toLowerCase().indexOf(q) >= 0 ||
          (ins.text && ins.text.toLowerCase().indexOf(q) >= 0)
        )
      })

      // 统计指标
      var totalEnabled = filteredSections.filter(function (s) { return s.enabled }).length
      var totalTokens = filteredSections
        .filter(function (s) { return s.enabled })
        .reduce(function (sum, s) { return sum + (s.tokenEstimate || 0) }, 0)
      // 加上启用的自定义插入 token
      matchingInsertions.filter(function (i) { return i.enabled !== false }).forEach(function (i) {
        totalTokens += Math.ceil((i.text || '').length / 3)
      })

      // ── 关键特性：构建「实际执行顺序」列表 ────────────────────
      // 按照真实装配流将 sections 与 matchingInsertions 融合在同一时间轴上
      var orderedFlow = []
      // 1. start 插入项
      matchingInsertions.filter(function (ins) {
        return ins.position === 'start' || ins.targetSection === '<start>'
      }).forEach(function (ins) {
        orderedFlow.push({ isCustom: true, data: ins })
      })

      // 2. 遍历顺序 sections，并在 before / after 插槽插入
      filteredSections.forEach(function (sec) {
        // before
        matchingInsertions.filter(function (ins) {
          return ins.position === 'before' && ins.targetSection === sec.key
        }).forEach(function (ins) {
          orderedFlow.push({ isCustom: true, data: ins })
        })

        // 核心段落
        orderedFlow.push({ isCustom: false, data: sec })

        // after
        matchingInsertions.filter(function (ins) {
          return ins.position === 'after' && ins.targetSection === sec.key
        }).forEach(function (ins) {
          orderedFlow.push({ isCustom: true, data: ins })
        })
      })

      // 3. end 插入项
      matchingInsertions.filter(function (ins) {
        return ins.position === 'end' || !ins.targetSection || ins.targetSection === '<end>'
      }).forEach(function (ins) {
        orderedFlow.push({ isCustom: true, data: ins })
      })

      // 渲染单条标准段落
      function renderSectionItem(sec, idxLabel) {
        var isEditing = editingKey === sec.key
        var hasOverride = sec.overridden
        var isExpanded = Boolean(expandedTexts[sec.key])
        var isShowOrig = Boolean(showingOriginal[sec.key])

        // 文本呈现：如果已修改，当前文本为 currentText；否则为 defaultText
        var displayBody = sec.currentText || sec.defaultText || '(暂无原提示词内容)'
        var previewSnippet = displayBody.length > 140 && !isExpanded
          ? displayBody.slice(0, 140) + '...'
          : displayBody

        return el('div', { key: sec.key, className: 'dsh-pg-item' },
          // 头部：左侧序号与名称，右侧操作按钮与开关
          el('div', { className: 'dsh-pg-item-head' },
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              idxLabel ? el('span', { className: 'dsh-pg-badge dsh-pg-badge-order' }, idxLabel) : null,
              el('span', { className: 'dsh-pg-item-name' }, sec.name)
            ),
            el('div', { className: 'dsh-pg-item-actions' },
              el(Switch, {
                checked: sec.enabled,
                onChange: function () { handleToggleSection(sec.key, sec.enabled) },
              }),
              !isEditing ? el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                title: '在系统原提示词的基础上进行修改与定制',
                onClick: function () { handleStartEdit(sec) },
              }, icon('edit'), hasOverride ? t('editContent') : t('editOnDefault')) : null,
              hasOverride ? el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                title: '清空覆盖，还原为系统原提示词',
                onClick: function () { handleResetSection(sec.key) },
              }, icon('undo'), '还原默认') : null,
              el('button', {
                className: 'dsh-pg-btn dsh-pg-btn-sm',
                type: 'button',
                title: '在当前段落之前插入自定义提示词',
                onClick: function () { handleOpenInsertAt('before', sec.key) },
              }, icon('up'), '之前插入'),
              el('button', {
                className: 'dsh-pg-btn dsh-pg-btn-sm',
                type: 'button',
                title: '在当前段落之后插入自定义提示词',
                onClick: function () { handleOpenInsertAt('after', sec.key) },
              }, icon('down'), '之后插入')
            )
          ),

          // 小标签聚合行：所有属性小标签统一整齐展示在一行内，不再受右侧按钮挤压换行
          el('div', { className: 'dsh-pg-badges-row' },
            el('span', { className: 'dsh-pg-badge' }, 'Order: ' + (sec.order ?? 0)),
            el('span', { className: 'dsh-pg-badge dsh-pg-badge-blue' }, sec.key),
            el('span', { className: 'dsh-pg-badge' }, '来源: ' + sec.source),
            el('span', { className: 'dsh-pg-badge' }, sec.categoryLabel || '核心'),
            hasOverride ? el('span', { className: 'dsh-pg-badge dsh-pg-badge-orange' }, '已修改原提示词') : null,
            selectedPreset !== 'all' && sec.isPresetOverride ? el('span', { className: 'dsh-pg-badge dsh-pg-badge-purple' }, '预设专属定制') : null,
            selectedPreset !== 'all' && sec.isInheritedFromGlobal ? el('span', { className: 'dsh-pg-badge' }, '继承全局') : null,
            selectedPreset !== 'all' && !sec.inPreset ? el('span', { className: 'dsh-pg-badge', style: { color: 'var(--dsw-alias-text-tertiary, #94a3b8)', borderColor: 'var(--dsw-alias-border-l1, #475569)' } }, '未包含在此预设') : null,
            el('span', { className: 'dsh-pg-badge' }, (sec.charCount || 0) + ' 字符 · ~' + (sec.tokenEstimate || 0) + ' tok')
          ),

          // 段落描述说明
          sec.description ? el('div', { className: 'dsh-pg-item-desc' }, sec.description) : null,

          // 提示词预览盒子（原提示词 / 当前覆盖提示词）
          !isEditing ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            el('div', { className: 'dsh-pg-prompt-box' + (previewSnippet ? '' : ' dsh-pg-prompt-box-empty') }, previewSnippet),
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' } },
              el('div', { style: { display: 'flex', gap: '10px' } },
                displayBody.length > 140 ? el('a', {
                  style: { color: 'var(--dsw-alias-text-accent, #38bdf8)', cursor: 'pointer', textDecoration: 'none' },
                  onClick: function () {
                    var nextExp = Object.assign({}, expandedTexts)
                    nextExp[sec.key] = !isExpanded
                    setExpandedTexts(nextExp)
                  },
                }, isExpanded ? '收起全文 ▲' : '展开阅读原提示词全文 (' + displayBody.length + ' 字符) ▼') : null,
                hasOverride && sec.defaultText ? el('a', {
                  style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)', cursor: 'pointer', textDecoration: 'none' },
                  onClick: function () {
                    var nextOrig = Object.assign({}, showingOriginal)
                    nextOrig[sec.key] = !isShowOrig
                    setShowingOriginal(nextOrig)
                  },
                }, isShowOrig ? '隐藏原词对比' : '查看原提示词对照') : null
              ),
              el('span', { className: 'dsh-pg-status' + (sec.enabled ? ' is-on' : ' is-off') },
                el('span', { className: 'dsh-pg-dot' }), sec.enabled ? '本段生效中' : '已停用此段'
              )
            ),
            // 原提示词对照盒子
            isShowOrig && sec.defaultText ? el('div', { style: { marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' } },
              el('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } }, '【系统原生默认提示词】：'),
              el('div', { className: 'dsh-pg-prompt-box', style: { borderStyle: 'dashed', borderColor: 'rgba(245,158,11,.4)' } }, sec.defaultText)
            ) : null
          ) : null,

          // 内联编辑器（在原提示词上编辑）
          isEditing ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' } },
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                el('span', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-text-accent, #38bdf8)' } }, '在原提示词基础上编辑修改:'),
                el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } }, '快捷插入变量占位符:')
              ),
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' } },
                (liveData.availableVariables || []).map(function (v) {
                  return el('span', {
                    key: v.name,
                    className: 'dsh-pg-var-tag',
                    title: v.desc + ' · 点击插入 ' + v.placeholder,
                    onClick: function () { handleInsertVariableToEdit(v.name) },
                  }, '+ ' + v.placeholder + ' (' + v.label + ')')
                })
              )
            ),
            el('textarea', {
              className: 'dsh-pg-textarea',
              value: editingText,
              onChange: function (e) { setEditingText(e.target.value) },
              placeholder: '输入提示词正文，支持 {{model}}、{{provider}}、{{cwd}} 等变量占位符...',
            }),
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } },
                el('span', null, '字符数: ' + editingText.length + ' · 预估 Tokens: ~' + Math.ceil(editingText.length / 3)),
                sec.defaultText && editingText !== sec.defaultText ? el('a', {
                  style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)', cursor: 'pointer' },
                  onClick: function () { setEditingText(sec.defaultText) },
                }, '恢复为原提示词文本') : null
              ),
              el('div', { style: { display: 'flex', gap: '6px' } },
                el('button', {
                  className: 'dsh-pg-btn dsh-pg-btn-primary',
                  type: 'button',
                  onClick: function () { handleSaveSectionText(sec.key) },
                }, '保存修改'),
                el('button', {
                  className: 'dsh-pg-btn',
                  type: 'button',
                  onClick: function () { setEditingKey(null) },
                }, '取消')
              )
            )
          ) : null
        )
      }

      // 渲染单条自定义插入项
      function renderCustomInsertionItem(ins, idxLabel) {
        var posLabel = ins.position === 'start' ? '置于最前 (Start)'
          : ins.position === 'end' ? '置于最后 (End)'
          : (ins.position === 'before' ? '紧邻之前' : '紧邻之后') + ' (' + ins.targetSection + ')'

        return el('div', { key: 'custom_' + ins.id, className: 'dsh-pg-item dsh-pg-item-custom' },
          el('div', { className: 'dsh-pg-item-head' },
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              idxLabel ? el('span', { className: 'dsh-pg-badge dsh-pg-badge-purple' }, idxLabel) : null,
              el('span', { style: { fontWeight: 600, fontSize: '14px', color: 'var(--dsw-alias-text-accent, #c084fc)' } }, '' + (ins.name || '自定义提示词'))
            ),
            el('div', { className: 'dsh-pg-item-actions' },
              el(Switch, {
                checked: ins.enabled !== false,
                onChange: function () { handleToggleInsertion(ins.id) },
              }),
              el('button', {
                className: 'dsh-pg-btn dsh-pg-btn-danger',
                type: 'button',
                onClick: function () { handleDeleteInsertion(ins.id) },
              }, '删除')
            )
          ),
          el('div', { className: 'dsh-pg-badges-row' },
            el('span', { className: 'dsh-pg-badge dsh-pg-badge-purple' }, 'custom:' + ins.id),
            el('span', { className: 'dsh-pg-badge' }, '预设: ' + (ins.preset === 'all' ? '全部预设' : ins.preset)),
            el('span', { className: 'dsh-pg-badge' }, '插入位置: ' + posLabel),
            el('span', { className: 'dsh-pg-badge' }, (ins.text || '').length + ' 字符 · ~' + Math.ceil((ins.text || '').length / 3) + ' tok')
          ),
          el('div', { className: 'dsh-pg-item-desc' }, '用户自主注入的自定义系统提示词规则，装配时将插入到指定位置。'),
          el('div', { className: 'dsh-pg-prompt-box', style: { borderStyle: 'dashed' } }, ins.text || '(暂无内容)')
        )
      }

      // 渲染单条运行时上下文
      function renderContextItem(context, idxLabel) {
        var injectionConfig = currentInjectionConfig()
        var enabled = context.required
          ? true
          : (!injectionConfig.suppressOptional && (injectionConfig.disabledContexts || []).indexOf(context.name) < 0)
        var body = context.text || '(暂无上下文内容)'
        var preview = body.length > 320 ? body.slice(0, 320) + '...' : body
        return el('div', { key: context.name, className: 'dsh-pg-item' },
          el('div', { className: 'dsh-pg-item-head' },
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              idxLabel ? el('span', { className: 'dsh-pg-badge dsh-pg-badge-order' }, idxLabel) : null,
              el('span', { style: { fontWeight: 600, fontSize: '14px', color: 'var(--dsw-alias-label-primary, var(--dsw-alias-label-primary, #f1f5f9))' } }, context.name)
            ),
            el('div', { className: 'dsh-pg-item-actions' },
              el(Switch, {
                checked: enabled,
                disabled: context.required || injectionConfig.suppressOptional,
                label: context.name + ' 运行时上下文',
                onChange: function (val) { handleToggleContext(context, val) },
              })
            )
          ),
          el('div', { className: 'dsh-pg-badges-row' },
            el('span', { className: 'dsh-pg-badge' }, 'Order: ' + (context.order ?? 0)),
            el('span', { className: 'dsh-pg-badge dsh-pg-badge-blue' }, context.source || 'system-prompt'),
            el('span', { className: 'dsh-pg-badge' + (context.required ? ' dsh-pg-badge-orange' : '') }, context.required ? '必需 (required)' : '可选'),
            (context.presets && context.presets.length > 0) ? el('span', { className: 'dsh-pg-badge' }, context.presets.join('、')) : null,
            el('span', { className: 'dsh-pg-badge' }, (context.text || '').length + ' 字符 · ~' + (context.tokens || 0) + ' tok')
          ),
          el('div', { className: 'dsh-pg-prompt-box', style: { borderStyle: context.required ? 'solid' : 'dashed' } }, preview)
        )
      }

      // 渲染单条消息注入源 (time-context / ...)
      function renderInjectionItem(injection, idxLabel) {
        var injectionConfig = currentInjectionConfig()
        var enabled = (injectionConfig.disabledKinds || []).indexOf(injection.kind) < 0
        var lastAt = injection.lastAt ? new Date(injection.lastAt).toLocaleTimeString() : '未观测'
        var warning = injection.kind === 'oswyn-compaction'
        return el('div', { key: injection.kind, className: 'dsh-pg-item' + (warning ? ' dsh-pg-item-custom' : '') },
          el('div', { className: 'dsh-pg-item-head' },
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              idxLabel ? el('span', { className: 'dsh-pg-badge dsh-pg-badge-order' }, idxLabel) : null,
              el('span', { style: { fontWeight: 600, fontSize: '14px', color: warning ? 'var(--dsw-alias-state-warn-primary, #f59e0b)' : 'var(--dsw-alias-label-primary, var(--dsw-alias-label-primary, #f1f5f9))' } }, injection.label || injection.kind)
            ),
            el('div', { className: 'dsh-pg-item-actions' },
              el(Switch, {
                checked: enabled,
                label: (injection.label || injection.kind) + ' 注入',
                onChange: function (val) { handleToggleInjection(injection.kind, val) },
              })
            )
          ),
          el('div', { className: 'dsh-pg-badges-row' },
            el('span', { className: 'dsh-pg-badge dsh-pg-badge-blue' }, 'source.kind: ' + injection.kind),
            el('span', { className: 'dsh-pg-badge' }, '已观测 ' + (injection.count || 0) + ' 次'),
            el('span', { className: 'dsh-pg-badge' }, '最近: ' + lastAt),
            injection.tokens ? el('span', { className: 'dsh-pg-badge' }, '约 ~' + injection.tokens + ' tok/次') : null
          ),
          injection.description ? el('div', { className: 'dsh-pg-item-desc' }, injection.description) : null,
          injection.sample ? el('div', { className: 'dsh-pg-prompt-box', style: { borderColor: warning ? 'rgba(245,158,11,.35)' : 'rgba(56,189,248,.25)' } }, injection.sample.slice(0, 320)) : null
        )
      }

      // 运行时注入视图的过滤结果
      var injectionNeedle = query.trim().toLowerCase()
      var filteredContexts = (liveData.contexts || []).filter(function (context) {
        if (!injectionNeedle) return true
        return context.name.toLowerCase().indexOf(injectionNeedle) >= 0 ||
          String(context.text || '').toLowerCase().indexOf(injectionNeedle) >= 0 ||
          String(context.source || '').toLowerCase().indexOf(injectionNeedle) >= 0
      })
      var filteredInjections = (liveData.messageInjections || []).filter(function (injection) {
        if (!injectionNeedle) return true
        return injection.kind.toLowerCase().indexOf(injectionNeedle) >= 0 ||
          String(injection.label || '').toLowerCase().indexOf(injectionNeedle) >= 0 ||
          String(injection.description || '').toLowerCase().indexOf(injectionNeedle) >= 0
      })
      var optionalContextCount = (liveData.contexts || []).filter(function (context) { return !context.required }).length
      var contextTokenTotal = (liveData.contexts || []).reduce(function (sum, context) { return sum + (context.tokens || 0) }, 0)

      return el('div', { className: 'dsh-pg-card' },
        // ── 顶部栏：总开关与全局动作 ──────────────────────────
        el('div', { className: 'dsh-pg-header' },
          el('div', { className: 'dsh-pg-header-main' },
            el('div', { className: 'dsh-pg-header-title' },
              el('span', { className: 'dsh-pg-title-main' }, icon('brain'), '系统提示词管理')
            ),
            el('div', { className: 'dsh-pg-header-desc' },
              '按实际装配顺序查看原提示词，支持在原提示词上修改、切换预设、使用 {{model}} 等变量占位符，并在任意位置插入定制规则。'
            ),
            el('div', { className: 'dsh-pg-badges-row' },
              el('span', { className: 'dsh-pg-badge' }, enabled ? '全局运行中' : '已停用'),
              el('span', { className: 'dsh-pg-badge' }, '支持变量占位符'),
              el('span', { className: 'dsh-pg-badge' }, '段落 ' + filteredSections.length + ' 个'),
              el('span', { className: 'dsh-pg-badge dsh-pg-badge-gray' }, '预估 ~' + totalTokens + ' tok')
            ),
          ),
          el('div', { className: 'dsh-pg-header-actions' },
            el('button', {
              className: 'dsh-pg-btn dsh-pg-btn-ai',
              type: 'button',
              title: t('aiOptimizeHint'),
              onClick: handleAiOptimize,
            }, aiCopied ? t('aiOptimizeCopied') : t('aiOptimize')),
            el(Switch, {
              checked: enabled,
              label: enabled ? t('enabledGlobal') : t('disabledGlobal'),
              onChange: function (val) { setField('enabled', val) },
            })
          )
        ),

        // ── 预设切换 Tab 栏 (Preset Tabs) ────────────────────────
        el('div', { className: 'dsh-pg-preset-bar' },
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } },
            el('span', { className: 'dsh-pg-preset-label' }, t('currentPreset'))
          ),
          el('div', { className: 'dsh-pg-preset-tabs' },
            liveData.presets.map(function (p) {
              var isCurrent = selectedPreset === p.id
              return el('button', {
                key: p.id,
                type: 'button',
                className: 'dsh-pg-preset-tab' + (isCurrent ? ' active' : ''),
                onClick: function () {
                  userPickedPresetRef.current = true
                  setSelectedPreset(p.id)
                  fetchOverview(p.id)
                },
              }, p.id === 'all' ? t('allPresets') : (p.name + (p.isDefault ? t('defaultTag') : '')))
            })
          )
        ),

        // ── 工具栏：视图切换、搜索与操作 ────────────
        el('div', { className: 'dsh-pg-toolbar' },
          el('div', { className: 'dsh-pg-toolbar-row' },
            el('div', { className: 'dsh-pg-tab-group' },
              el('button', {
                type: 'button',
                className: 'dsh-pg-btn-tab' + (viewMode === 'sequence' ? ' active' : ''),
                onClick: function () { setViewMode('sequence') },
              }, icon('list'), '按装配顺序'),
              el('button', {
                type: 'button',
                className: 'dsh-pg-btn-tab' + (viewMode === 'category' ? ' active' : ''),
                onClick: function () { setViewMode('category') },
              }, icon('folder'), '按来源分类'),
              el('button', {
                type: 'button',
                className: 'dsh-pg-btn-tab' + (viewMode === 'contexts' ? ' active' : ''),
                onClick: function () { setViewMode('contexts') },
              }, icon('plug'), '运行时注入')
            ),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
              el('button', {
                className: 'dsh-pg-btn dsh-pg-btn-primary',
                type: 'button',
                onClick: function () { handleOpenInsertAt('after', '<end>') },
              }, icon('plus'), '新增插入'),
              el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                onClick: handleOpenPreview,
              }, icon('eye'), '预览全文'),
              el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                onClick: function () { fetchOverview(selectedPreset) },
              }, icon('refresh'), '刷新')
            )
          ),
          el('input', {
            className: 'dsh-pg-input',
            type: 'search',
            placeholder: t('searchPlaceholder'),
            value: query,
            onChange: function (e) { setQuery(e.target.value) },
            style: { width: '100%' },
          })
        ),

        // ── 指标概览条 ─────────────────────────────────────────
        el('div', { className: 'dsh-pg-stats' },
          el('span', { className: 'dsh-pg-stat-item' }, selectedPreset === 'all' ? '全局段落:' : ('段落 [' + selectedPreset + ']:'), el('strong', null, filteredSections.length)),
          el('span', { className: 'dsh-pg-stat-item' }, '生效启用:', el('strong', null, totalEnabled)),
          el('span', { className: 'dsh-pg-stat-item' }, '自定义插入:', el('strong', null, matchingInsertions.length)),
          el('span', { className: 'dsh-pg-stat-item' }, '预估 Tokens:', el('strong', null, '~' + totalTokens)),
          (liveData.hiddenSectionCount || 0) > 0 ? el('span', { className: 'dsh-pg-stat-item is-muted' }, '已隐藏 ' + liveData.hiddenSectionCount + ' 段未启用插件') : null,
          (liveData.toolOwnedCount || 0) > 0 ? el('span', { className: 'dsh-pg-stat-item is-muted' }, '工具说明 ' + liveData.toolOwnedCount + ' 段归 tool-control') : null,
          el('span', { className: 'dsh-pg-stat-item is-muted' }, '占位符:',
            (liveData.availableVariables || []).map(function (v) {
              return el('code', { key: v.name, style: { color: 'var(--dsw-alias-text-primary, var(--dsw-alias-text-accent, #93c5fd))' } }, v.placeholder)
            })
          )
        ),

        // ── 版本更新提示：定制文本与官方新原文不一致 ──────────────
        (liveData.drift && liveData.drift.length > 0) ? el('div', {
          style: { display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 12px', borderRadius: '6px', fontSize: '11.5px', background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', color: 'var(--dsw-alias-text-primary, var(--dsw-alias-state-warn-primary, #fde68a))' }
        },
          el('span', { className: 'dsh-pg-warn' }, icon('alert')),
          el('div', null,
            el('div', { style: { fontWeight: 600 } }, '有 ' + liveData.drift.length + ' 处定制与官方新原文不一致（版本更新改动了原生提示词）'),
            el('div', { style: { opacity: 0.85, marginTop: '2px' } },
              liveData.drift.map(function (d) { return d.key + (d.preset === 'all' ? '' : '@' + d.preset) }).join('、'),
              ' —— 保留原设置：让 Agent 执行 prompt_control { action: "rebaseline", section: "<key>" }；改用新原文：{ action: "accept_native", section: "<key>" }。'
            )
          )
        ) : null,
        // ── 主体渲染：模式 1 - 按实际顺序展示 (Sequence View) ────
        viewMode === 'sequence' ? el('div', { className: 'dsh-pg-group' },
          el('div', { className: 'dsh-pg-group-head', style: { cursor: 'default' } },
            el('div', { className: 'dsh-pg-group-title' },
              el('span', { className: 'dsh-pg-group-title-main' }, icon('list'), '实际装配执行顺序'),
              el('span', { className: 'dsh-pg-badge dsh-pg-badge-blue' }, t('flowBadge', { count: orderedFlow.length }))
            ),
            el('span', { className: 'dsh-pg-group-desc' }, '完全按照大模型接收提示词的真实先后次序排序')
          ),
          el('div', { className: 'dsh-pg-group-body' },
            orderedFlow.length === 0 ? el('div', { style: { padding: '24px', textAlign: 'center', color: 'var(--dsw-alias-text-secondary, var(--dsw-alias-text-tertiary, #94a3b8))' } }, liveData.status === 'loading' ? t('loadingPrompt') : t('noMatchingSections'))
              : orderedFlow.map(function (item, idx) {
                var idxLabel = '#' + (idx + 1)
                if (item.isCustom) {
                  return renderCustomInsertionItem(item.data, idxLabel)
                }
                return renderSectionItem(item.data, idxLabel)
              })
          )
        ) : null,

        // ── 主体渲染：模式 2 - 按分类分组展示 (Category View) ────
        viewMode === 'category' ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          // 自定义插入项
          matchingInsertions.length > 0 ? el('div', { className: 'dsh-pg-group' },
            el('div', { className: 'dsh-pg-group-head' },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 } },
                el('span', null, '自定义插入规则 (Custom Insertions)'),
                el('span', { className: 'dsh-pg-badge dsh-pg-badge-purple' }, matchingInsertions.length)
              )
            ),
            el('div', { className: 'dsh-pg-group-body' },
              matchingInsertions.map(function (ins, idx) {
                return renderCustomInsertionItem(ins, '#' + (idx + 1))
              })
            )
          ) : null,

          // 各分类
          liveData.categories.map(function (cat) {
            var items = filteredSections.filter(function (s) { return s.category === cat.id })
            if (items.length === 0) return null

            return el('div', { key: cat.id, className: 'dsh-pg-group' },
              el('div', { className: 'dsh-pg-group-head' },
                el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 } },
                  el('span', { className: 'dsh-pg-group-title-main' }, icon(cat.icon || 'list'), cat.label),
                  el('span', { className: 'dsh-pg-badge' }, items.length),
                  el('span', { style: { fontSize: '11px', fontWeight: 400, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-text-tertiary, #94a3b8))' } }, cat.desc)
                )
              ),
              el('div', { className: 'dsh-pg-group-body' },
                items.map(function (sec, idx) {
                  return renderSectionItem(sec, '#' + (idx + 1))
                })
              )
            )
          })
        ) : null,

        // ── 主体渲染：模式 3 - 运行时上下文 / 消息注入 ─────────
        viewMode === 'contexts' ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          // 运行时上下文
          el('div', { className: 'dsh-pg-group' },
            el('div', { className: 'dsh-pg-group-head' },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, flexWrap: 'wrap' } },
                el('span', null, '运行时上下文 (Runtime Contexts)'),
                el('span', { className: 'dsh-pg-badge dsh-pg-badge-blue' }, filteredContexts.length),
                el('span', { style: { fontSize: '11px', fontWeight: 400, color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } },
                  '可选 ' + optionalContextCount + ' 个 · 合计 ~' + contextTokenTotal + ' tok')
              ),
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } }, '启用可选注入'),
                el(Switch, {
                  checked: currentInjectionConfig().suppressOptional !== true,
                  label: '启用全部可选运行时上下文',
                  onChange: function (val) { handleToggleOptionalContexts(val) },
                })
              )
            ),
            el('div', { className: 'dsh-pg-group-body' },
              filteredContexts.length === 0
                ? el('div', { style: { padding: '18px', textAlign: 'center', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } }, '当前预设没有注册运行时上下文')
                : filteredContexts.map(function (context, idx) { return renderContextItem(context, '#' + (idx + 1)) })
            )
          ),
          // 消息注入源
          el('div', { className: 'dsh-pg-group' },
            el('div', { className: 'dsh-pg-group-head' },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 } },
                el('span', null, '消息注入源 (agent/pre-step)'),
                el('span', { className: 'dsh-pg-badge dsh-pg-badge-purple' }, filteredInjections.length)
              ),
              el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } }, '关闭只拦消息，不停来源插件')
            ),
            el('div', { className: 'dsh-pg-group-body' },
              filteredInjections.length === 0
                ? el('div', { style: { padding: '18px', textAlign: 'center', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } }, '还没有观测到消息注入源')
                : filteredInjections.map(function (injection, idx) { return renderInjectionItem(injection, '#' + (idx + 1)) })
            )
          ),
          el('div', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)', lineHeight: 1.6, padding: '0 4px' } },
            '说明：关闭 time-context 只阻止它进入模型上下文，插件仍会计算；要减少计算/事件开销，请到 Agent 预设里把 time-context 的 refreshIntervalMs 调大或移除该行。oswyn 的注入关闭后会影响模型压缩行为，请谨慎操作。'
          )
        ) : null,

        // ── 弹窗：新增提示词插入 (Modal) ────────────────────────
        showInsertModal ? el('div', { className: 'dsh-pg-modal-overlay' },
          el('div', { className: 'dsh-pg-modal' },
            el('div', { className: 'dsh-pg-modal-head' },
              el('span', null, '在任意位置插入系统提示词'),
              el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                onClick: function () { setShowInsertModal(false) },
              }, '✕')
            ),
            el('div', { className: 'dsh-pg-modal-body' },
              el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                el('label', { style: { fontSize: '12px', fontWeight: 500 } }, '提示词名称 / 标识:'),
                el('input', {
                  className: 'dsh-pg-input',
                  placeholder: t('ruleNamePlaceholder'),
                  value: insertForm.name,
                  onChange: function (e) { setInsertForm(Object.assign({}, insertForm, { name: e.target.value })) },
                })
              ),
              el('div', { style: { display: 'flex', gap: '10px' } },
                el('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' } },
                  el('label', { style: { fontSize: '12px', fontWeight: 500 } }, '生效预设 (Preset):'),
                  el('select', {
                    className: 'dsh-pg-select',
                    value: insertForm.preset,
                    onChange: function (e) { setInsertForm(Object.assign({}, insertForm, { preset: e.target.value })) },
                  },
                    liveData.presets.map(function (p) {
                      return el('option', { key: p.id, value: p.id }, p.name)
                    })
                  )
                ),
                el('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' } },
                  el('label', { style: { fontSize: '12px', fontWeight: 500 } }, '插入方式 (Position):'),
                  el('select', {
                    className: 'dsh-pg-select',
                    value: insertForm.position,
                    onChange: function (e) { setInsertForm(Object.assign({}, insertForm, { position: e.target.value })) },
                  },
                    el('option', { value: 'after' }, t('posAfter')),
                    el('option', { value: 'before' }, t('posBefore')),
                    el('option', { value: 'start' }, t('posStart')),
                    el('option', { value: 'end' }, t('posEnd'))
                  )
                )
              ),
              (insertForm.position === 'before' || insertForm.position === 'after') ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                el('label', { style: { fontSize: '12px', fontWeight: 500 } }, '锚点目标段落 (Target Section):'),
                el('select', {
                  className: 'dsh-pg-select',
                  value: insertForm.targetSection,
                  onChange: function (e) { setInsertForm(Object.assign({}, insertForm, { targetSection: e.target.value })) },
                },
                  liveData.sections.map(function (s) {
                    return el('option', { key: s.key, value: s.key }, s.name + ' (' + s.key + ')')
                  })
                )
              ) : null,
              el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                  el('label', { style: { fontSize: '12px', fontWeight: 500 } }, '提示词正文内容 (Markdown):'),
                  el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
                    el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } }, '快捷插入变量:'),
                    (liveData.availableVariables || []).map(function (v) {
                      return el('span', {
                        key: v.name,
                        className: 'dsh-pg-var-tag',
                        title: v.desc + ' · 点击插入 ' + v.placeholder,
                        onClick: function () { handleInsertVariableToModal(v.name) },
                      }, '+ ' + v.placeholder)
                    })
                  )
                ),
                el('textarea', {
                  className: 'dsh-pg-textarea',
                  style: { minHeight: '140px' },
                  placeholder: t('contentPlaceholder'),
                  value: insertForm.text,
                  onChange: function (e) { setInsertForm(Object.assign({}, insertForm, { text: e.target.value })) },
                }),
                el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } },
                  '提示：在提示词中输入 {{model}}、{{provider}}、{{cwd}} 等占位符，DSH 装配时将自动替换为实时变量值。'
                )
              )
            ),
            el('div', { className: 'dsh-pg-modal-foot' },
              el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                onClick: function () { setShowInsertModal(false) },
              }, '取消'),
              el('button', {
                className: 'dsh-pg-btn dsh-pg-btn-primary',
                type: 'button',
                onClick: handleAddInsertion,
              }, t('confirmInsert'))
            )
          )
        ) : null,

        // ── 弹窗：完整系统提示词预览 (Preview Modal) ───────────
        showPreviewModal && previewData ? el('div', { className: 'dsh-pg-modal-overlay' },
          el('div', { className: 'dsh-pg-modal' },
            el('div', { className: 'dsh-pg-modal-head' },
              el('span', null, t('previewModalTitle', { preset: previewData.preset })),
              el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                onClick: function () { setShowPreviewModal(false) },
              }, '✕')
            ),
            el('div', { className: 'dsh-pg-modal-body' },
              el('div', { style: { display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)', flexWrap: 'wrap' } },
                el('span', null, t('totalSections', { count: (previewData.sections || []).length })),
                el('span', null, t('totalChars', { count: (previewData.rendered || '').length })),
                el('span', null, t('estTokensShort', { tokens: Math.ceil((previewData.rendered || '').length / 3) })),
                el('span', { style: { color: 'var(--dsw-alias-text-accent, #38bdf8)' } }, '变量已完成实时插值模拟')
              ),
              el('textarea', {
                className: 'dsh-pg-textarea',
                style: { height: '360px', userSelect: 'text' },
                readOnly: true,
                value: previewData.rendered || '',
              })
            ),
            el('div', { className: 'dsh-pg-modal-foot' },
              el('button', {
                className: 'dsh-pg-btn',
                type: 'button',
                onClick: function () {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(previewData.rendered || '')
                  }
                },
              }, '复制到剪贴板'),
              el('button', {
                className: 'dsh-pg-btn dsh-pg-btn-primary',
                type: 'button',
                onClick: function () { setShowPreviewModal(false) },
              }, '关闭')
            )
          )
        ) : null
      )
    }

    // ── 插件卡片：只保留入口开关 ─────────────────────────────────────────────
    function PromptControlEntryCard(props) {
      useLocaleListener(props.ctx)
      var t = props.t || createTranslator(props.ctx)
      var formState = useForm(props.form)
      var current = formState[0]
      var setField = formState[1]
      var config = current.value || {}
      var enabled = config.enabled !== false
      return el('div', { className: 'dsh-pg-card' },
        el('div', { className: 'dsh-pg-header' },
          el('div', { className: 'dsh-pg-header-main' },
            el('div', { className: 'dsh-pg-header-title' },
              el('span', { className: 'dsh-pg-title-main' }, icon('brain'), '提示词管理')
            ),
            el('div', { className: 'dsh-pg-header-desc' },
              '详细设置已移到左侧「设置」菜单：提示词管理 / Skill 管理 / 工具管理。这里只保留插件入口开关。'),
            el('div', { className: 'dsh-pg-badges-row' },
              el('span', { className: 'dsh-pg-badge' }, enabled ? '入口已开启' : '入口已关闭')
            ),
          ),
          el('div', { className: 'dsh-pg-header-actions' },
            el(Switch, {
              checked: enabled,
              label: '启用 Prompt Control',
              onChange: function (val) { setField('enabled', val) },
            })
          )
        )
      )
    }

    // ── Skill 管理：复用 dsh-skill-control 的完整卡片 ───────────────────────────
    function SkillManagerCard(props) {
      var client = null
      try { client = require('dsh-skill-control') } catch (_) {}
      var SkillControlCard = client && client.SkillControlCard
      var form = null
      try { form = props.configForms.get('skill-control-row') } catch (_) {}
      var store = React.useMemo(function () {
        if (!form) return null
        return {
          subscribe: function (listener) { return form.subscribe(listener) },
          getSnapshot: function () { return form.getSnapshot() },
          set: function (field, value) { return form.set(field, value) },
        }
      }, [form])

      if (!SkillControlCard || !store) {
        return el('div', { className: 'dsh-pg-card' },
          el('div', { className: 'dsh-pg-header' },
            el('div', { style: { fontWeight: 600, fontSize: '15px' } }, 'Skill 管理'),
            el('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } },
              'Skill 管理插件未启用；请先在「设置 → 插件」启用 dsh-skill-control。')
          )
        )
      }
      return el(SkillControlCard, { form: store, ctx: props.ctx, closeSettings: props.closeSettings })
    }

    // ── 工具管理：复用 dsh-tool-control 的完整卡片 ─────────────────────────────
    function ToolManagerCard(props) {
      var client = null
      try { client = require('dsh-tool-control') } catch (_) {}
      var ToolControlCard = client && client.ToolControlCard
      var form = null
      try { form = props.configForms.get('tool-control-row') } catch (_) {}
      var store = React.useMemo(function () {
        if (!form) return null
        return {
          subscribe: function (listener) { return form.subscribe(listener) },
          getSnapshot: function () { return form.getSnapshot() },
          set: function (field, value) { return form.set(field, value) },
        }
      }, [form])

      if (!ToolControlCard || !store) {
        return el('div', { className: 'dsh-pg-card' },
          el('div', { className: 'dsh-pg-header' },
            el('div', { style: { fontWeight: 600, fontSize: '15px' } }, '工具管理'),
            el('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-tertiary, #94a3b8)' } },
              '工具管理插件未启用或配置尚未就绪；请先在「设置 → 插件」启用 dsh-tool-control。')
          )
        )
      }
      return el(ToolControlCard, { form: store, ctx: props.ctx, closeSettings: props.closeSettings })
    }

    // ── 客户端插件导出 ───────────────────────────────────────────────────────
    exports.name = 'dsh-prompt-control'
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
        }, 'prompt-control: dictionaries')
      }

      var form = configForms.get(NAMESPACE)
      var store = {
        subscribe: function (listener) { return form.subscribe(listener) },
        getSnapshot: function () { return form.getSnapshot() },
        set: function (field, value) { return form.set(field, value) },
      }

      ctx.effect(function () {
        return configForms.whileServed([NAMESPACE], function () {
          // 1. 设置侧边栏专属页面入口 (设置 -> 提示词管理)
          var unregSettings = slots.inject('settings.section', function () {
            return slots.register({
              name: 'settings.section',
              id: 'prompt-control',
              locale: NS,
              label: function () { return createTranslator(ctx)('sectionTitle') },
              order: 22,
            }, function (props) {
              return el('div', { style: { padding: '4px 4px 16px', maxWidth: '960px', margin: '0 auto' } },
                el(PromptControlCard, { form: store, ctx: ctx, t: (props && props.t) || createTranslator(ctx), closeSettings: props && props.close })
              )
            })
          })

          // 2. 独立 Skill 管理菜单 (设置 -> Skill 管理)
          var unregSkillSettings = slots.inject('settings.section', function () {
            return slots.register({
              name: 'settings.section',
              id: 'skill-manager',
              locale: NS,
              label: function () { return createTranslator(ctx)('skillSectionTitle') },
              order: 23,
            }, function (props) {
              return el('div', { style: { padding: '4px 4px 16px', maxWidth: '960px', margin: '0 auto' } },
                el(SkillManagerCard, { ctx: ctx, configForms: configForms, closeSettings: props && props.close })
              )
            })
          })

          // 3. 工具管理菜单：复用 dsh-tool-control 的完整卡片
          var unregToolSettings = slots.inject('settings.section', function () {
            return slots.register({
              name: 'settings.section',
              id: 'tool-manager',
              locale: NS,
              label: function () { return createTranslator(ctx)('toolSectionTitle') },
              order: 24,
            }, function (props) {
              return el('div', { style: { padding: '4px 4px 16px', maxWidth: '960px', margin: '0 auto' } },
                el(ToolManagerCard, { ctx: ctx, configForms: configForms, closeSettings: props && props.close })
              )
            })
          })

          // 4. Bundle 专属配置页 (设置 -> 插件 -> dsh-prompt-control)
          var unregBundleConfig = slots.inject('plugins.bundle.config', function () {
            return slots.register({
              name: 'plugins.bundle.config',
              key: 'dsh-prompt-control',
              locale: NS,
              label: function () { return createTranslator(ctx)('bundleTitle') },
            }, function (props) {
              return el(PromptControlEntryCard, { form: store, ctx: ctx, t: (props && props.t) || createTranslator(ctx) })
            })
          })

          return function () {
            if (typeof unregSettings === 'function') unregSettings()
            if (typeof unregSkillSettings === 'function') unregSkillSettings()
            if (typeof unregToolSettings === 'function') unregToolSettings()
            if (typeof unregBundleConfig === 'function') unregBundleConfig()
          }
        })
      }, 'prompt-control: settings and plugins slots')
    }

    return module.exports
  },
})
