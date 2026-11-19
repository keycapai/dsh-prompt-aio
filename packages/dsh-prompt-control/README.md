# dsh-prompt-control

系统提示词管理插件（System Prompt Control），面向 DeepSeek Harness 的全局系统提示词精细化管理、在线编辑与智能优化套件。

---

## 核心特性

- **真实装配执行顺序可视化 (Top-to-Bottom Prompt Flow)**：
  - 严格按照大模型实际接收系统提示词的先后执行顺序（升序排序）清晰呈现每一段落。
  - 支持「按执行顺序流」与「按来源分类」双视图无缝切换。
  - 直接展示原提示词内容、字符数、预估 Token 消耗及段落元信息。

- **在原提示词基础上直接编辑与覆盖 (In-place Editing & Override)**：
  - 点击「在原词上编辑」自动将系统原生提示词载入编辑器，用户无需从零手写，只需在此基础上增删改。
  - 提供「恢复原词」与「对比原提示词」能力，修改随时可控、可逆、可还原。

- **动态插值变量占位符支持 (Dynamic Variable Placeholders)**：
  - 原生支持在任何提示词段落或自定义插入规则中使用模板变量：
    - `{{model}}`：当前会话激活的大模型标识（如 `antigravity/gemini-3.8-flash`）
    - `{{provider}}`：模型提供商标识（如 `magpie`）
    - `{{cwd}}`：当前 Agent 工作区根目录绝对路径
  - UI 编辑器与弹窗内置「快捷变量标签」，点击即可快速将占位符插入光标处。

- **任意位置插入自定义提示词规则 (Arbitrary Position Insertion)**：
  - 支持向系统提示词流中精准注入自定义规则（例如代码安全规范、架构准则、角色设定等）。
  - 支持四种灵活插入方式：
    - **置于最前 (Start)**
    - **置于最后 (End)**
    - **紧邻指定段落之前 (Before)**
    - **紧邻指定段落之后 (After)**
  - 可精准绑定生效预设（Preset）或应用于全预设。

- **多预设隔离与继承管理 (Multi-Preset Isolation)**：
  - 完整适配 DSH 内置与扩展的全部预设（`standard`、`ptc`、`minimal`、`cordis` 等）。
  - 支持设置全局通用规则，或针对特定预设配置专属覆盖规则。
  - 清晰标注段落是否纳入当前预设、是继承自全局还是预设专属覆盖。

- **完整系统提示词装配模拟器 (Real-time Assembly Simulator)**：
  - 支持即时模拟所选预设的完整装配管线，一键预览带真实变量插值后的最终系统提示词全文。
  - 提供全局字符数、预估 Token 总量统计及一键复制功能。

- **内置 Agent 交互工具 (`prompt_control`)**：
  - 为智能体赋予自省与自我提示词优化的超能力，支持 10 种细粒度指令操作：
    - `list`：列出当前预设所有提示词段落、状态与 Token 消耗。
    - `search`：按关键词模糊搜索提示词段落与正文匹配内容。
    - `get`：查看特定段落详情、当前生效提示词与原生默认提示词对照。
    - `preview`：模拟预览指定预设装配后的系统提示词全文。
    - `set_status`：即时启用或停用某个段落（支持全局或指定预设）。
    - `set_text`：修改或覆盖指定段落的提示词正文。
    - `reset`：清空定制，将指定段落完全还原为原生默认提示词。
    - `insert`：在任意位置（最前/最后/指定段落前/后）插入自定义提示词。
    - `delete_insert`：删除指定的自定义插入规则。
    - `analyze`：深度分析当前预设的系统提示词结构、Top 5 Token 大户、类别分布并给出智能瘦身建议。

---

## 智能体工具调用示例

Agent 可直接调用 `prompt_control` 工具进行系统提示词的自省与调优：

```json
// 1. 概览当前提示词段落清单
prompt_control({ "action": "list", "preset": "standard" })

// 2. 搜索涉及文件操作的提示词段落
prompt_control({ "action": "search", "query": "write" })

// 3. 在最前插入专属安全约束
prompt_control({
  "action": "insert",
  "name": "安全底线守则",
  "position": "start",
  "text": "## 核心准则\n在 {{model}} 环境下，严格遵守最小权限原则，禁止向外泄露内部信息。"
})

// 4. 深度分析系统提示词开销与瘦身建议
prompt_control({ "action": "analyze", "preset": "standard" })
```

---

## 架构设计

```
dsh-prompt-control/
├── lib/
│   ├── index.js      # Host 端 Cordis 插件：系统提示词装配钩子、变量插值、HTTP 接口与 prompt_control Agent 工具
│   └── client.js     # Web 客户端：设置页面独立入口、可视化流式顺序看板、内联编辑器与装配预览模态框
├── cordis.patch.yml  # Cordis Bundle 安装补丁与缺省参数配置
├── package.json      # 插件元信息与 DSH Client/Bundle 清单
└── README.md         # 详细技术与用户手册
```

---

## 访问入口

1. **设置中心独立页面**：点击 Web GUI 左下角「设置 (Settings)」→ 侧边栏「提示词管理」。
2. **插件管理卡片**：点击「设置」→「插件」→ 选择 `dsh-prompt-control` 即可打开管理看板。

---

## 0.2.0：写操作真落盘 · 原文基线 · 版本更新提醒

### 1. Agent 工具的写操作以前是「空操作」

`set_status` / `set_text` / `reset` / `insert` / `delete_insert` 都会回「成功」，
但实际什么都没发生。根因两条：

- 写的是 `ctx.fiber.config` 这份 **Loader 行**，而宿主只会通过 `configEditor` 服务落盘；
  直接改行内对象既不落盘，还会白等一次 fiber 重启，重启再从 profile patch 读回旧值。
- 持久化调用的是 `ctx.get("configForms")` —— **那是客户端 service，Host 侧不存在**，异常被 `catch {}` 吞掉。

现在：会话内覆盖写进模块级 `LIVE_STATE`（下一次装配立刻生效，`apply()` 重新执行时清空），
落盘走 `configEditor.edit(entry, …)`（校验 → 重写 `cordis.patch.yml` → reconcile → 重启 fiber，
与设置页保存同一条链路），返回值如实报 `已写入` 或 `仅在当前进程生效（原因）`。

### 2. 读的是激活时的冻结快照 → 现在读实时层

`list` / `get` / `search` / `preview` 与卡片数据都改用「实时配置 + 实时段落层」：
以前正文取自装配钩子观测的 `SEEN_SECTIONS`，很多段落只存到占位文本，
于是 `list` 报 45 段 ~2037 tok、`preview` 却是 27 段 ~31222 tok（差 15 倍）。
现在两者同源，卡片上的开销与段落正文字符数才是真的。

### 3. 原文基线 + 版本更新提醒（本轮重点）

`set_text` 写入定制时，会同时记下**此刻官方原文的指纹**：

```json
{ "text": "你的定制", "baseline": { "hash": "…", "length": 1234, "preset": "ptc", "at": "2026-11-11T…" } }
```

之后**插件 / DSH 版本更新改动了这段原生提示词**时：

- `prompt_control list` 在「定制状态」列标 `原文已更新`；
- `prompt_control get` 给出定制时字数 / 当前原文字数 / 记录时间，并给出两条命令；
- 设置页顶部出现黄色提示条（`drift` 字段由 `/api/dsh-prompt-control/data` 返回）；
- 新增 `drift` 动作逐条列出全部带基线的定制及其一致性。

用户的选择只有两个，都不会丢东西：

| 想保留原设置 | 想改用新原文 |
|---|---|
| `rebaseline`：文本不动，基线更新到当前原文，之后不再提示 | `accept_native`：删掉该段定制，回到官方新文本 |

**没有定制时不打扰**：`overrides` / `presetOverrides` 里没有 `text` 时，装配结果与原提示词完全一致
（`test/control-actions.mjs` 第 1 条锁死纯透传），`drift` 也只会回一句「无需处理」。

### 4. 顺带修掉的小问题

- `analyze` 以前在一行无条件 `return JSON.stringify(...)` 之后全是死代码（实际返回调试 JSON，
  文档里的 Top5 / 类别分布 / 瘦身建议从来没跑过）—— 已恢复，诊断代码回到 `debug-scopes` 动作。
- `category` 筛选：文档写 `core/tools/rules/teams/workspace/office/other`，实际产出 `identity/policy/tools/…`，
  导致 `category:"rules"` 恒为 0 段；现在内部代码、中文标签、旧别名三者都认。
- `preview` / `analyze` / `drift` 的默认预设从硬编码 `standard` 改为**调用方当前预设**。
- 文本定制允许显式 `text: ""`（以前空串被当成「没定制」，「把这段删掉」永远做不到）。
- `resolvePreset` 里的 service 取值加了保护，取不到时退回默认预设而不是让装配抛错。

### 测试

`node test/prompt-control.mjs` 37 项 + `node test/control-actions.mjs` 21 项，共 **58 项全绿**。
新增用例覆盖：空配置纯透传、写操作下次装配生效、基线记录、drift 检出、`rebaseline` / `accept_native`
两条出路、空串定制、`analyze` 真报告、`category` 三种写法。

---

## 0.3.0：工具说明移交 tool-control

**职责边界**：讲「某个工具怎么用」的段落（`tool:*`、`tools:*`、`mcp:*`、`tool-control:*`，
以及来源是 `dsh-tool-*` / 分类为「工具与能力」的段落）**归 tool-control 控制** —— 工具是保留完整、
只留名字、隐藏还是禁用，由 `tool_control` 决定它怎么进提示词。prompt-control 从此不列出、不改写这些段落。

### 具体行为

| 面 | 现在 |
|---|---|
| `prompt_control { action: "list" }` | 列表里不再出现工具说明，末尾补一行「另有 N 段工具说明由 tool-control 控制」 |
| `prompt_control { action: "search" }` | 跳过工具说明段落 |
| `prompt_control { action: "get", section: "tool:bash" }` | 明确说明该段归 tool-control，不再给编辑建议 |
| `set_status` / `set_text` | 对工具说明段落**拒绝执行**并指路 `tool_control` |
| `reset` | 仍允许（清掉历史遗留的旧定制，算清理路径） |
| `analyze` | Top5 / 类别分布不计入工具说明，另起一行说明它们占多少 tok |
| `preview` | 仍然渲染**完整**装配结果（预览要等于模型真实看到的），只是不再把工具说明算进统计 |
| 设置页卡片 | 不展示工具说明段落，指标条上标「工具说明 N 段归 tool-control 管」 |
| 装配（transform） | 不再对工具说明应用启用/停用与文本覆盖；**排序能力保留**（排序是装配顺序，不是内容归属） |
| `drift` | 跳过工具说明（它们已不归本插件管） |

**遗留旧配置不会坑你**：如果配置里还留着针对 `tool:*` 的旧定制，`list` 会提示「N 条针对工具说明的旧定制已不再生效」并给出 `reset` 清理命令；这些规则不会再影响装配。

### 判定函数

```js
promptGate.isToolOwnedSection("tool:bash")      // true
promptGate.isToolOwnedSection("tools:ptc-only")  // true
promptGate.isToolOwnedSection("mcp-resource-servers") // true
promptGate.isToolOwnedSection("team:policy")    // false
```

### 测试

`node test/prompt-control.mjs` 37 项 + `node test/control-actions.mjs` 32 项，共 **69 项全绿**。
新增用例：`isToolOwnedSection` 判定、`list`/`search` 不再出现工具说明、`get`/`set_text`/`set_status` 拒绝、
分类筛选对工具段返回 0 段，以及「工具说明仍然出现在装配结果里（只是归 tool-control）」这条边界。

---

## 0.4.0：未启用插件的段落不再出现在提示词管理里

**判据**：提示词管理只显示「当前真的注册在 `systemPrompt` 层里」的段落。
插件没启用 -> 它的段落不会注册 -> `list` / `search` / `get` / 设置页卡片都不会出现。
在「设置 → 插件」启用后，段落注册恢复，刷新提示词管理（或重新打开设置页）即可看到；
再次停用插件，段落随即重新隐藏。

| 面 | 行为 |
|---|---|
| `list` | 只列真实注册段落，不再用 `KNOWN_SECTIONS` 预填充；未启用插件零残留 |
| `search` | 搜索池同样只来自真实注册段落 |
| `get` | 查未启用插件的段落会明确提示「所属插件当前未启用」，并指路「设置 → 插件」 |
| `set_status` / `set_text` | 对未启用插件段落拒绝执行（否则只是写一份永远不生效的配置） |
| `reset` | 仍允许，方便清理历史遗留的旧定制 |
| `drift` | 跳过未启用插件段落；插件启用后重新参与检查，旧定制不会丢失 |
| 设置页卡片 | 只渲染真实注册段落；指标条显示「已隐藏 N 段未启用插件段落」 |
| `preview` | 仍然渲染完整装配结果（预览等于模型真实看到的），因此未启用插件自然不会出现 |

**为什么不在页面上灰显**：灰显会让人误以为还能配置、还能生效；未启用插件的段落本来就不在
模型收到的提示词里。隐藏它，启用后再出现，才是实际装配状态。

### 测试

`node test/plugin-visibility.mjs` 新增 17 项：未启用插件段落不出现在 `list` / `search` / `preview` / `get` /
设置页数据接口；注册（模拟插件启用）后出现；注销（模拟插件停用）后再次隐藏；
`set_status` / `set_text` 对未启用插件段落拒绝。
连同 `node test/prompt-control.mjs` 37 项 + `node test/control-actions.mjs` 32 项，共 **86 项全绿**。

---

## 0.5.0：运行时上下文 / 消息注入管理

提示词管理新增第三个视图 **运行时注入**，把两类以前只能看、不能管的东西变成开关：

1. **运行时上下文（systemPrompt.context）**
   - 按 context name 逐项启用/停用，例如 `sandbox:policy`、`approval:policy`、`harness:source`。
   - 顶部总开关「启用可选注入」关闭后，所有 optional context 一起隐藏。
   - `required`（`working-directory:current`、`subagent:identity`）锁定，不能关闭；即使手改配置，装配时也会按注册信息保住。
   - 实际生效点在 `system-prompt/assemble` 的 `assembly.contexts`，不依赖各 DSH 版本对 `suppressRuntimeContext()` 的 required 处理差异。

2. **消息注入源（agent/pre-step）**
   - 按 `source.kind` 逐项启用/停用，内置 `time-context`、`skill-catalog`、`oswyn-compaction`，其他观测到的 kind 自动追加。
   - 用 `prepend: true` 的 `agent/pre-step` 监听器在 `await next()` 之后过滤，因此能拦到下游 listener 追加的消息，包括 time-context。
   - 只统计真正进入历史的注入次数；被拦下的 time-context 每步重试不会把次数刷爆。

3. **工具管理菜单**（设置侧边栏 → 工具管理）
   - 通过 client-module 的 `require('dsh-tool-control')` 复用 `dsh-tool-control` 的完整 ToolControlCard；
   - 菜单顺序：提示词管理 22 / Skill 管理 23 / 工具管理 24；其中 Skill 管理菜单只做薄包装，复用 `dsh-skill-control` 的 `SkillControlCard`；
   - `dsh-tool-control` 自己不再注册设置菜单，Plugins 页卡片只保留 **入口开关**；
   - dsh-prompt-control 的 Plugins 页卡片也只保留入口开关，详细设置全部在上述三个设置菜单里。

### 配置

`contextInjections` 随 prompt-control 配置落盘：

```yaml
contextInjections:
  suppressOptional: false
  disabledContexts:
    - sandbox:policy
    - approval:policy
  disabledKinds:
    - time-context
```

### 边界

- **time-context 是「拦消息」不是「停来源」**：关闭后它仍在每个 eligible step 计算，只是不进入模型历史，`dsh-context` 也不会记录这条 Inject。要连计算/调度一起省掉，去 Agent 预设里把 `time-context` 的 `refreshIntervalMs` 调大或移除该行。
- **skill-catalog** 仍作为整体注入源展示，可一键关闭该注入；逐技能启用/停用请到「设置 → Skill 管理」（由独立插件 dsh-skill-control 提供）。**oswyn-compaction** 若走自己的 projection/compaction 管线，最稳仍是用 oswyn 自己的 `replySummaryEnabled` / `nudgeEnabled`。
- **required context 永远保留**，UI 锁死。

### 测试

`node test/context-injections.mjs` 10 项：逐项关闭 optional、required 保护、
`suppressOptional` 总开关、pre-step 按 source.kind 过滤、普通 user 消息不误删、overview 数据开关。
连同 `prompt-control` 37 项 + `control-actions` 32 项 + `plugin-visibility` 17 项，共 **96 项全绿**。

---

## 0.6.0：Skill 管理迁移到独立插件 dsh-skill-control

- 内嵌的 Skill 管理卡片、`disabledSkills` 配置、`get-skills` 接口与 `skill-catalog` 描述上限重写逻辑已全部移除，提示词管理专注提示词 / 上下文注入能力。
- 「设置 → Skill 管理」菜单保留（顺序 23），改为薄包装：通过 client-module 的 `require('dsh-skill-control')` 复用 `SkillControlCard`，与「工具管理」复用 `dsh-tool-control` 的方式一致。
- 未启用 dsh-skill-control 时，该菜单会提示先到「设置 → 插件」启用。
- `contextInjections` 仅保留 `suppressOptional` / `disabledContexts` / `disabledKinds`；`skill-catalog` 仍作为消息注入源展示，用于整体关闭该注入（逐技能开关请到 Skill 管理）。