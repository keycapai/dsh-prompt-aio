# dsh-skill-control

> 把 Skill 管理从「系统提示词管理」（dsh-prompt-control）中分离出来，像 dsh-tool-control 管理工具一样管理技能目录：可完整介绍、只显示名字、隐藏或禁用，并提供 `skill_search` / `skill_catalog` 搜索工具按需发现。

## 为什么需要它

DSH 的 `dsh-tool-skill` 会在会话开始时把一份 `<available_skills>` 技能目录作为持久 user 消息注入模型上下文。技能一多，每个技能的名称 + 描述都会长期占用输入 token；而完全删掉技能目录又会让模型无法发现任何技能。

`dsh-skill-control` 在 **不改变技能注册表**、**不修改 `source.entries`（目录摘要）** 的前提下，只改写模型实际看到的那条 `skill-catalog` 消息，并注册两个常驻小工具，让模型在需要时自行发现被折叠的技能。这与 `dsh-tool-control` 对工具面做的是同一件事。

## 功能

- **逐技能模式（per-skill mode）**
  - `full` — 完整介绍：保留技能名 + 完整描述（受 `catalogDescriptionMaxLength` 限制）。
  - `name` — 只显示名字：目录行只保留 `- \`技能名\``，不显示描述。
  - `hidden` — 隐藏：从 `<available_skills>` 中完全移除，但技能仍可被 `skill` 工具直接加载，并可通过 `skill_search` / `skill_catalog` 发现。
  - `disabled` — 禁用：从目录与搜索中移除，并拦截用户 `/技能名` 触发的 `skill-invocation` 注入。
- **兜底模式**：未单独配置的技能按 `fallbackMode` 处理，默认 `full`（不改变任何东西）。
- **搜索工具**
  - `skill_search` — 按关键词 / 正则搜索技能，`details: true` 返回完整描述。
  - `skill_catalog` — 完整技能名索引，按 full / name / hidden 分组。
- **运行时管理工具**：`skill_control`，支持 `list` / `get` / `set_mode` / `set_fallback` / `reset` / `stats`。
- **设置页卡片**：设置 → Skill 管理（由 dsh-prompt-control 的菜单壳复用本插件的 `SkillControlCard`），支持搜索、逐技能模式切换、兜底模式与描述长度调整；改动在下一个请求即时生效。
- **提示词通知**：当存在 `name` / `hidden` 技能时，自动追加一段系统提示，告诉模型技能目录被裁剪过、如何用 `skill_search` 找回；通知里**不会列出隐藏技能的名字**，避免它们以任何形式重新进入常驻提示词。
- **非持久化目录**：不再把 `<available_skills>` 写成持久 user message；过滤后的目录由 `system-prompt/assemble` 每次请求动态生成，隐藏技能名不会残留在新会话或 fork/resume 的上下文里。

## 模式一览

| 模式 | 目录中显示 | 描述 | `skill` 工具可加载 | `skill_search` 可发现 |
| --- | --- | --- | --- | --- |
| `full` | 名称 + 描述 | 完整（可截断） | 是 | 是 |
| `name` | 仅名称 | 无 | 是 | 是（details 返回完整描述） |
| `hidden` | 不显示 | 无 | 是 | 否 |
| `disabled` | 不显示 | 无 | 否（registry guard 拒绝） | 否 |

## Token 成本显示

设置页与 `skill_control` / `skill_search` 会显示每个技能的近似 token 成本：

- **当前**：按当前模式与目录描述上限，此技能在 `<available_skills>` 中实际占用的 token（隐藏 / 禁用为 0）。
- **完整**：把该技能恢复成「完整介绍」时，目录行大约占用的 token。
- **正文**：`skill` 工具加载技能正文时大约占用的 token；只有加载时才计入。

估算规则：非 ASCII 字符约 1 token，ASCII 字符约 0.25 token（与 `dsh-prompt-control` 一致）。页面顶部还会汇总「当前目录 token」和「全部完整介绍时的目录 token」。

## 调用次数与筛选

设置页与 `skill_control` 会显示每个技能的调用次数，并区分：

- `modelCalls`：模型调用 `skill` 工具加载该技能；
- `userCalls`：用户用 `/技能名` 直接触发；
- `historyCalls`：扫描 `~/.dsh/sessions` 历史会话得到的调用；
- `calls`：以上三项之和。

设置页提供按**模式**（全部 / 完整介绍 / 只显示名字 / 隐藏 / 禁用）、**调用情况**（全部 / 有调用 / 未调用）筛选，并支持按调用次数、名称、token 或模式排序。「更新调用次数」按钮会重新扫描历史会话。

## 安装

本插件是一个 bundle（自带 `cordis.patch.yml`）：

```bash
# 在 profile 的 package.json 中加入依赖
# "dsh-skill-control": "link:/Users/reno/.dsh/plugins/dsh-skill-control"
# 并把 "dsh-skill-control" 加入 dsh.profile.bundles
```

插件行（`cordis.patch.yml`）默认配置：

```yaml
- id: skill-control-row
  name: dsh-skill-control
  config:
    enabled: true
    skillModes: {}
    fallbackMode: full
    catalogDescriptionMaxLength: 500
    promptNotice: true
```

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关；关闭后技能目录恢复原样，搜索工具不注册。 |
| `skillModes` | object | `{}` | 技能名 → 模式映射，支持 `full` / `name` / `hidden` / `disabled`。 |
| `fallbackMode` | string | `full` | 未在 `skillModes` 中出现的技能使用的模式。 |
| `catalogDescriptionMaxLength` | number | `500` | 目录描述最大字符数；`0` 等价于只显示名字。 |
| `promptNotice` | boolean | `true` | 是否注入「目录已裁剪」的系统提示。 |

示例：

```yaml
- id: skill-control-row
  name: dsh-skill-control
  config:
    enabled: true
    fallbackMode: full
    skillModes:
      univer: hidden
      univer-doc: hidden
      office: name
      magpie-skills: full
    catalogDescriptionMaxLength: 120
    promptNotice: true
```

## 工具

### `skill_search`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 搜索词；多个空格分隔关键词按「任一命中」排序。 |
| `regex` | boolean | 把 `query` 当作正则。 |
| `details` | boolean | 返回完整描述；结果同时包含 `tokens`（当前目录行约多少 token）。 |
| `limit` | integer | 最多返回条数，默认 12，上限 100。 |
| `deferOnly` | boolean | 只搜索非 `full` 的技能。 |

### `skill_catalog`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `deferredOnly` | boolean | 只列出 `name` / `hidden` 技能。 |

### `skill_control`

| action | 说明 |
| --- | --- |
| `list` | 列出所有技能、模式、来源、调用次数，以及当前/完整目录行的约 token 数。 |
| `get` | 查看单个技能详情，含当前/完整/仅名字与正文的约 token 数。 |
| `set_mode` | 设置一个或一批技能的模式。 |
| `set_fallback` | 设置兜底模式。 |
| `reset` | 清除某个技能的显式模式。 |
| `stats` | 查看各模式数量、调用次数、当前目录 token、完整目录 token 与已加载正文 token 汇总。 |

## 与其它插件的关系

- **dsh-prompt-control**：只保留系统提示词段落管理、上下文注入管理与「Skill 管理」菜单壳；技能目录的可见性、描述长度与逐技能模式全部由本插件负责。
- **dsh-tool-control**：管理工具 schema 的可见性；本插件管理技能目录的可见性，二者互不重叠。
- **dsh-tool-skill / dsh-skill**：技能的实际注册与加载仍由官方技能插件负责；本插件只改变模型看到的目录文本。

## 技术原理

1. `dsh-tool-skill` 在 `agent/pre-step` 末尾发布 `source.kind = 'skill-catalog'` 的 user 消息，其中 `source.entries` 是目录摘要（用于判断是否需要重发），文本块是模型看到的 `<available_skills>`。
2. 本插件在 `agent/pre-step` 中丢弃 `dsh-tool-skill` 产生的持久 `skill-catalog` user message，避免任何未过滤目录被写进会话历史。
3. 过滤后的目录改由 `system-prompt/assemble` 动态生成：从当前 `skills` 服务读取条目，按 `skillModes` 保留 `full` / `name` 行，`hidden` / `disabled` 行完全不出现；该 section 每次请求重算，不是持久事件。
4. **不修改 `source.entries`**，也不会触发 `dsh-tool-skill` 的目录摘要反复重发。
5. `hidden` 技能仍保留在技能注册表中，`skill` 工具可以直接加载；模型通过 `skill_search` 发现它们。`disabled` 额外过滤 `source.kind = 'skill-invocation'`，并通过 `ctx.tools.guard` 拒绝 `skill { name }` 调用。
6. 对 fork / resume 继承下来的**持久化旧 skill-catalog 事件**，插件用 `session.append` 的 `surfaceOp: replace` 逐节点遮蔽（替换为中性占位），不再追加第二份目录；因此旧目录里的隐藏技能名不会继续留在模型上下文中。

## 测试

```bash
cd dsh-skill-control
node test/skill-control.mjs              # 单元/集成测试（Config、改写、工具、设置路由）
node test/integration-tool-skill.mjs  # 与真实 dsh-tool-skill 的端到端目录改写测试
```

测试使用与 dsh-prompt-control 相同的 `test/harness.mjs`，从 `~/.dsh/.asar-x` 加载 DSH 运行时模块。

## License

Private / internal use.
