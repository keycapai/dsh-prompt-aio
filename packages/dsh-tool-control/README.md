# dsh-tool-control

让模型按需查看工具说明，而不是每次都把全部工具的完整 schema 塞进上下文。

## 它解决什么问题

每个注册的工具都会把 **名称 + 描述 + JSON Schema** 发给模型。在本机实测：

| | 数量 | schema 字节 | 约占 token |
|---|---|---|---|
| 改动前工具总量 | 102 | 155,976 | ≈ 39,000 |
| 其中 `mcp__cua-driver-mcp__*` | 58 | 120,202 | ≈ 30,000（77%） |

也就是说，**每次请求**都要为这 58 个 GUI 自动化工具付出约 3 万 token，
哪怕这一轮只是改一个文件。

## 它怎么做到的

插件挂在 `system-prompt/assemble` 这个 waterfall 上。`dsh-system-prompt` **每次请求**都会把组装好的
assembly 过一遍这个 waterfall，而 assembly 里带的正是即将发给模型的那份
`{name, description, parameters}` 列表。插件在**这里**把命中规则的条目改写掉。

- **执行完全不受影响**（由结构保证）：注册表里始终保存 provider 自己的原始定义，
  调用照走真实实现与真实校验；插件只改模型**读到**的东西。
- **可回滚**：hook 用 `ctx.effect` 安装，停用插件即停止缩减，所有工具回到完整声明。
- **`passthrough` 名单内的工具永不触碰**，你想常驻可见的就保持常驻。

然后它注册两个始终可见的小工具，把省下的 schema 读回来：

- `tool_search` —— 按关键词或正则查找；`details: true` 返回完整 JSON Schema。**支持一次传多个空格分隔的关键词**（任意命中即返回、按命中词数排序，见下节），也可按名称、前缀、描述、正则匹配。
- `tool_catalog` —— 完整名称索引（区分「已加载」「已压缩」「仅名字」三态），调用成本极低。

另有一段**注入的系统提示词**，告知模型当前工具面被过滤、哪些工具被压缩到什么程度，并强调它们**都仍可调用**。详见下文《注入的系统提示词》。

## 为什么在「组装时」而不是「注册时」缩减

早期版本是包一层 `ctx.tools.register`，在工具**注册时**改写定义。这个做法有一个
**静默失效**的硬伤，本机实测确认过：

```
provider 先注册、插件后挂载  →  stubbed? false   （工具保持完整 schema）
试图补注册同名工具           →  "tool "x" is already registered"
```

两个原因叠加：

1. 在插件激活**之前**就已注册的工具永远不会经过包装层，所以它保持完整 schema；
2. 这类工具**无法事后补做** —— 注册表拒绝重名，重注册会偷走原插件的 disposer。

于是「把缩减放在注册时」这件事本身就不可能对所有工具成立。改成缩减**组装后的 wire 列表**
之后，覆盖率与激活顺序彻底解耦：无论工具何时注册，只要它出现在模型面前就会被改写。
顺带还解决了第二个问题 —— **设置页切换模式立即生效**（下一次请求组装时按新配置重新计算），
不需要重注册，更不需要重启。

`test/probe.mjs` 专门锁定这两条：预先注册且命中规则的工具必须被缩减，
停用插件后 wire 上必须恢复完整 schema。

### 注入的系统提示词（`promptNotice`）

只在「有工具被压缩」时才注入一段提示，且**按当前实际模式分别说明** —— 这不是可选的美化，
而是插件能否被正确使用的前提：模型看不到被压缩的工具，如果不告知，它会把这轮精简过的
工具列表当成完整目录，然后回答「我没有这个能力」。

两种压缩程度需要不同的读法，所以分开讲：

| 情形 | 模型看到什么 | 提示词告诉模型 |
|---|---|---|
| `stub` / `name` | 名字 + 一句话摘要 | **完全可调用**，只是参数 schema 没发过来 → 先 `tool_search { details: true }` 读参数再调；明确点出「别猜参数」是这里最常见的失败原因 |
| `hidden` | **什么都不发**（名字都不在列表里） | **同样完全可调用** —— 这不是禁用；提示词会明确告知「有未列出的工具且都可调用」，让模型用 `tool_search` **主动发现**它，再读参数并调用 |

两个关键点：

1. 提示词**从不**告诉模型某个工具不可用 —— `hidden` 是显示层省略而非撤销，
   说成「无法调用」会主动误导模型，让它拒绝做本来能做的事。
2. 对 `hidden` 还必须**主动说明列表是不完整的**：模型连名字都看不到，
   如果不告诉它「有未列出的工具」，它会把这轮精简过的列表当成完整目录。

此外还会说明：本轮工具列表是**被过滤**的（不等于全部）、先用 `tool_catalog` 看完整名单、以及 `tool_search` 的多关键词用法。

文本在每次请求组装时重新计算，所以它跟随**实时**的工具面与模式（设置页改模式后立刻反映），
而不是在激活时冻结。若没有任何工具被压缩，该段落自行置空（不占上下文）。`promptNotice: false` 可整段关闭。

## 多关键词搜索

`tool_search` 的 `query` 支持空格分隔的多个关键词，语义是 **OR + 覆盖度排序**：

- 只要命中**任意一个**关键词就会返回 —— 单个词打偏不会让结果变成空的（这正是「要全部命中」的旧语义的坑：模型据此误判「没有这个能力」）；
- 命中**越多**关键词排得越前，全部命中再按名字更短的优先；
- 重复词会先去重（`"click click click"` 与 `"click"` 完全等价），所以重复词不会虚增覆盖度、把某个工具顶到真实精确匹配的前面。

```
tool_search { query: "click screenshot" }              # 一步搜到「点击后截图」
tool_search { query: "click screenshot", details: true } # 顺带拿到可调用的参数 schema
```

`regex: true` 时整个字符串按单个正则处理，不做分词。

## 配置

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中：

```yaml
- insert:
    - id: tool-control
      name: "dsh-tool-control"
      config:
        enabled: true                  # 总开关，false = 完全恢复原样
        # 没有全局 mode 了：每条规则自带 mode（见下）
        deferMcpPrefixes:              # 按前缀命中（当前即 58 个 Cua 工具）
          - { match: "mcp__", mode: stub }
        deferNames:                    # 逐个点名
          - { match: workflow, mode: stub }
          - { match: plugin_manager, mode: stub }
          - replay_trajectory
          - start_recording
          - stop_recording
        deferPatterns:                 # 按正则匹配整个族系
          - { match: "^cordis_", mode: stub }
        passthrough:                   # 永不 defer（优先级最高）
          - tool_search
          - tool_catalog
          - read
          - write
          - edit
          - bash
          - glob
          - grep
          - ask_user_question
          - todo_write
        fallbackMode: full             # 不命中任何规则的插件工具怎么办（默认 full = 不隐藏）
        toolModes: {}                  # 逐个工具的指定，设置页会写入这里
        minSchemaBytes: 0              # >0 时，schema 超过该字节数的工具一律 defer
        promptNotice: true             # 注入一段提示：工具面被过滤 + 都仍可调用 + 如何搜索
```

模式解析优先级（高 → 低）：

| 顺序 | 来源 | 说明 |
|---|---|---|
| 1 | `toolModes[name]` | 设置页里逐个工具的指定，**永远优先** |
| 2 | `passthrough` | 运维者写死的常驻名单 |
| 3 | `deferNames` → `deferMcpPrefixes` → `deferPatterns` → `minSchemaBytes` | 第一条命中的规则决定（**规则自带 mode 与 match**） |
| 4 | `fallbackMode` | 全都没命中时的兜底（默认 `full`） |

**第 4 条是「其他插件的工具没被过滤」的正解。** 默认 `full` 意味着新装插件的工具不会被悄悄隐藏；
想全部瘦身就改成 `stub` 或 `hidden`，或在设置页里逐个点名。

### 五种状态

**没有全局默认模式了。** 每条规则、每个工具都带自己的 mode；写成裸字符串的规则会被拒绝（带警告），
因为它没有模式可承载 —— 以前会静默继承全局值，导致设置页改了看不出效果。

| mode | 模型看到的 | 可调用 | 注册表 | 每请求成本 | 适用 |
|---|---|---|---|---|---|
| `full` | 完整 schema | 是 | 注册 | 不变 | 常驻、要保留完整说明 |
| `name` | 完整 schema + `defer_loading` | 是 | 注册 | 取决于通道 | **仅 DeepSeek 官方通道**；其他适配器会剥掉标记、静默回退全量 |
| `stub`（规则默认） | 名字 + 一句话摘要 + 参数指引 | 是 | 注册 | 低（cua 工具集省 ~83%） | 任何协议通用 |
| `hidden` | **什么都不发**（名字也没有） | 是（经 `tool_search` 发现并读参数） | 注册 | 零 | 体积大、不需要开场介绍 |
| **`disabled`** | 什么都不发 | 否 | **不注册** | 零 | 彻底不该存在的工具 |

### `hidden` 与 `disabled` 的区别

这是最容易混淆的一对，区别在**注册**而不只在显示：

| | `hidden` | `disabled` |
|---|---|---|
| 出现在模型工具列表 | 否 | 否 |
| 仍在注册表里 | **是** | **否** |
| 模型能调用 | **能**（按名字或经 search） | 不能 |
| `tool_search` 能找到 | **能**（这是它被发现的途径） | **不能** |
| `tool_catalog` 会列出 | 会（标为「仅名字」） | 不会 |

一句话：`hidden` 是「**不给介绍，但仍然可用**」；`disabled` 是「**这个部署里没有这个工具**」。
`test/toolmodes.mjs` 有 10 项专门锁定这个差异（含 tool_search / tool_catalog 都必须不返回 disabled）。

### `stub` 与 `hidden` 的准确区别

两者都**不是禁用**，都**照常注册、照常可调用**、执行与校验都走原始定义。
区别只在**模型一开始能看到多少**：

| | `stub` | `hidden` |
|---|---|---|
| 工具**名字**出现在列表里 | 是 | **否** |
| 一句话摘要 | 是 | 否 |
| 参数 schema | 否（指向 `tool_search`） | 否 |
| 模型如何知道它存在 | 直接看到名字 | 靠 `tool_search` / `tool_catalog` **发现** |
| 调用方式 | 直接按名字调；先 search 读参数 | 先 search 找到它 → 读参数 → 调用 |

也就是说 `hidden` 省得更多（连名字都不发），代价是**模型必须主动搜**
才知道有这个东西 —— 所以注入的提示词会明确告诉它「有未列出的工具，且都可调用，用 search 去发现」。

实现上 `hidden` 只是把条目从**发给模型的那份列表**里去掉；工具仍留在注册表里，
而调用解析走的是注册表（`tools.get` / `resolveExecution`）而非那份列表，
所以「列表里没有」和「调不了」是两件事。`test/hidden-call.mjs` 完整锁定这条链路。

> 真要**禁用**某个工具，就别注册它 —— `hidden` 从不承担这个语义。

每条规则可单独覆盖全局模式，把裸字符串换成 `{ match, mode }`：

```yaml
deferNames:
  - workflow                        # 用全局 mode
  - { match: plugin_manager, mode: hidden }
```

执行与参数校验始终运行**原始定义**（stub/hidden 只改呈现面），所以模型传错参数会收到原始校验错误，可自行纠正；完整参数随时通过 `tool_search { query: "名字", details: true }` 读回。

### 设置页：逐个工具选择

> **1.8.2 集成说明**：详细的工具管理 UI 已并入 `dsh-prompt-control` 的「设置 → 工具管理」菜单
> （复用本插件的完整卡片）。本插件在 Plugins 页只保留一个 **入口开关（enabled）**，
> 避免插件卡片和设置菜单重复显示同一套控件。

设置菜单里列出**当前所有工具**，每个工具三选一：

| 选择 | 效果 |
|---|---|
| **保留完整** | 始终带完整说明（`full`） |
| **只留名字** | 名字 + 一句话摘要，参数经 `tool_search` 读取（`stub`） |
| **隐藏** | 整个不发给模型，但仍可调用（`hidden`） |

卡片特性：

- **搜索框** —— 按工具名或说明过滤，工具多时不用翻。
- **按族分组** —— `mcp__<server>__*` 自动聚成一组，60 个 CUA 工具读作一个区块而不是 60 行。
- **显示体积** —— 每个工具标注它常驻时的 schema 字节数，便于判断隐藏它能省多少。
- **`已指定` 标记** —— 区分「你手动指定过的」与「跟随规则的」。
- **刷新按钮** —— 重新读取工具列表；**新装插件带来的工具会自动出现在这里**（列表每次按需从注册表读取，不做快照）。
- **`其余工具` 选择器** —— 决定不匹配任何规则的插件工具怎么处理，默认 `保留`。

> 这里的选择写入 `toolModes`，**优先级高于所有规则**。
> 否则你把某个 MCP 工具设为「保留完整」后，会被 `deferMcpPrefixes: ["mcp__"]` 悄悄改回去。

### 常见调整

| 想做的事 | 改法 |
|---|---|
| 完全关闭 | `enabled: false` |
| 只处理 cua，其他都别动 | 删掉 `deferNames` / `deferPatterns`，只留 `deferMcpPrefixes: ["mcp__"]` |
| 让 `workflow` 重新常驻 | 把 `workflow` 从 `deferNames` 移到 `passthrough` |
| 浏览器类工具也想 defer | `deferPatterns` 加 `"^mcp__"`（已由前缀覆盖）或按名称点名 |
| 按体积自动处理 | `minSchemaBytes: 2000` |

## 回滚

三种粒度，任选：

1. **临时关闭**：把配置改成 `enabled: false`，重载或重启。
2. **整条移除**：删掉 `cordis.patch.yml` 里的 `tool-control` 行。
   （备份见 `cordis.patch.yml.bak-toolgate-*`）
3. **彻底卸载**：删除 `~/.dsh/plugins/dsh-tool-control/`，
   并从 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 与
   `dsh.profile.bundles` 中移除 `dsh-tool-control`。

无论哪种，插件停用后 hook 都会被拆除，模型看到的工具面回到完全展开状态。

## 测试

```bash
cd ~/.dsh/plugins/dsh-tool-control
node test/probe.mjs    # 25 项：缩减、直通、可执行性、搜索、拆除还原、顺序无关
node test/order.mjs    #  5 项：provider 先挂载时工具仍被缩减
node test/modes.mjs    # 29 项：full/name/stub/hidden 四种模式的精确契约
node test/wire.mjs     # 11 项：线上 schema 合规（每个可见工具必须是对象 schema）
node test/prompt.mjs   # 31 项：注入提示词（按模式区分）与多关键词搜索契约
node test/reload.mjs   # 18 项：设置页改配置后无需重启即生效（走真实 fiber.update）
node test/hidden-call.mjs # 9 项：隐藏的工具「列表里看不见，但仍能搜到并调用」
node test/toolmodes.mjs   # 29 项：逐个工具指定优先级、兜底模式、来源识别、数据接口
node test/ptc.mjs         # 18 项：PTC 模式适配（TypeScript/Python SDK codegen 瘦身与调用）
node test/usage.mjs       # 20 项：调用次数统计、手动提示词顺序、预设归属识别
```

所有测试都直接启动真实的 `dsh-tools` ToolRuntime 与 `dsh-system-prompt`，
不做任何 mock。`test/prompt.mjs` 还会走真实的 `systemPrompt.assemble()`，
并且只断言插件自己那一段（`tool-control:deferred`）——组装结果里必然还有
harness identity / persona 等无关段落，对整份提示词做断言会因为错误的原因通过。

测试需要一份 `app.asar` 的**解包副本**（核心包在运行时由 asar 内的加载器提供，
普通 Node 无法直接穿越 asar 路径）。解包位置由 `test/harness.mjs` **自动发现**：
优先 `~/.dsh/.asar-x`（持久，重启不丢），回退 `/tmp/asar-x`。两者都缺失时，
harness 会直接打印重建命令。重建（约 290 个包）：

```bash
mkdir -p ~/.dsh/.asar-x && npx --yes @electron/asar extract \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" ~/.dsh/.asar-x
```

## 已验证的端到端结果

对**真实** CuaDriver MCP 服务（`cua-driver v0.34.0`）实测：

```
total tools on surface : 60
cua tools              : 58
cua tools DEFERRED     : 58      ← 100%
cua schema bytes       : 121362
deferred share         : 100.0%
deferred tool executes : true    ← 已 defer 仍可正常调用
search retrieves schema: YES (3816 bytes)
```

## 实现说明

- **零外部依赖**：整个插件不 `import` 任何 `@deepseek-ai/*` 包，
  只通过 Cordis 的 `ctx` 取用服务。这样不受 asar 内 peer 解析方式变化的影响。
- **不碰任何内部字段**：只用公开的 `ctx.tools.register` / `schemas` / `get`、
  `ctx.on`、`ctx.effect`、`ctx.systemPrompt.section`。
- **无法事后改写已注册的工具**：注册表按引用存定义，且重名会被拒绝，
  强行替换会偷走原插件的 disposer。因此对「激活前就已同步注册」的工具，
  插件如实报告而不是假装覆盖（定时日志会点名它们）。

## 线上合规（1.2.1 修复）

部分上游对工具 schema 做严格校验，任何一个工具不合规都会**污染整批请求**。
实测 `workbuddy/deepseek-v4.1-flash`（腾讯上游，错误码 11129
「工具定义不合规，请新建任务重试」）的分界线：

| `tools[].parameters` 形状 | 结果 |
|---|---|
| `{"type":"object","properties":{...}}` | 200 |
| 缺 `type:"object"`（含裸属性表 `{name: propSchema}`） | **400，整批被拒** |
| 无 `parameters` 键 | 200 |

1.2.0 的缺陷恰好出在插件**自己**的两个常驻工具上：`tool_search` /
`tool_catalog` 的 `parameters` 用了 schemastery 风格的裸属性表
（没有 `type:"object"` 包装，`required` 也写在属性内部），
导致启用插件后发给该上游的每个请求都被拒——而被压缩的 58 个 cua
stub 一直是合规的。traework 等渠道不做此校验，所以同模型没事。

1.2.1 的修复与保障：

- `tool_search` / `tool_catalog` 改为标准 JSON Schema
  （`type:"object"` + `properties` + 对象级 `required`）；
- stub 的 `parameters` 补上显式 `properties: {}`，任何校验器都接受；
- `test/wire.mjs` 锁定线上契约：**表面上每个可见工具**的 `parameters`
  必须是对象 schema，任何回归都会在这里先失败。

## 1.3.0：按模式注入提示词 + 多关键词搜索

两处改动都针对同一类失败：模型不知道工具被动了手脚，于是把「看不到」当成「不存在」。

**1. 注入的提示词改为按模式区分。** 旧版只有一段，且只统计 `deferred`，
在 `hidden` 模式下**一个字都不输出** —— 工具全被藏起来的会话里，模型完全不知道
还有东西可查。新版：

- `hidden` 也计入并**单独成段**（后续又修正为「省略但可调用」，见下节）；
- 仍可调用的那部分继续说明「先 search 读参数再调用」，并点出猜参数是主要失败原因；
- 新增「本轮工具列表是被过滤的」总述与多关键词用法提示。

区分两种情形不是措辞问题，而是**动作相反**：deferred 应当立刻调用，
hidden 调用必然失败。混为一谈就会出现插件最想避免的结果——对根本没注册的工具发起自信的调用。

**2. `tool_search` 的多关键词语义由 AND 改为 OR + 覆盖度排序。**

- 旧语义要求全部命中，一个词打偏就返回空，模型据此判定「没有这个能力」；
- 新语义任意命中即返回，命中词数越多排越前，全部命中仍居首；
- 重复词先去重，保证 `"click click click"` 与 `"click"` 等价，
  不会因重复而虚增覆盖度、把真实精确匹配挤下去。

`test/prompt.mjs`（31 项）锁定上面全部契约，包括「hidden-only 的工具面也必须产生提示」
和「无关键词命中时仍须返回空而不是全部」。

## 1.3.0：改为组装时缩减（修掉两个静默失效）

1.2.x 在**注册时**改写工具定义，本机实测确认了两个会静默失效的问题：

| 现象 | 实测证据 | 根因 |
|---|---|---|
| `stub` 好像没生效 | provider 先注册 → `stubbed? false` | 激活前就已注册的工具永远不经过包装层 |
| 设置里切换模式没反应 | 切到 `full` 后 schema 仍是 stub | 工具本来就没被 stub，切换自然看不出变化 |

而且这类工具**无法事后补救**：注册表拒绝重名（实测 `tool "x" is already registered`），
重注册会偷走原插件的 disposer。

1.3.0 把缩减移到 `system-prompt/assemble` waterfall，在**每次请求组装时**改写即将发给模型的那份
schema 列表：

- **覆盖率与激活顺序无关** —— 预先注册的工具同样被缩减，`test/probe.mjs` 锁定该用例；
- **设置页改模式立即生效**，无需重启（已端到端验证 `stub → full → hidden` 连续切换）；
- **执行面零改动** —— 注册表始终保留 provider 的原始定义，调用与校验照旧；
- 因此 `strictOrder` 配置项已删除（它只是用来报告这个已不存在的缺陷）。

### `hidden` 语义修正：是省略，不是禁用

`hidden` 经历过一次错误定义：最初是「完全不注册」，导致 `tool_search` 能搜到、
调用却必然失败 —— 比不提还糟。随后一度改成「只发名字」，但那仍然是多余的上下文开销。

最终语义：**把条目从发给模型的列表里整个去掉**（名字也不发），但工具**仍留在注册表**，
因此**照常可调用**。调用解析走注册表（`tools.get` / `resolveExecution`），
而不是那份列表 —— 所以「列表里没有」与「调不了」是两件事。配套改动：

- 注入提示词明确说明「有未列出的工具、它们都可调用、用 `tool_search` 去发现」；
- `tool_catalog` 三态为「已加载」「一句话摘要」「未列出（仍可调用）」；
- `test/hidden-call.mjs` 完整锁定「列表里看不见 → search 找到 → 调用成功」这条链路。

## 关于「切换模式要不要重启」

**不需要重启。** 完整链路是：

```
设置页保存 → dsh-settings 持久化 → configEditor.edit
          → reconcileProfilePatches → entry.update()
          → fiber.restart() → apply() 重新执行（读到新配置）
```

所以下一次请求组装时就会用新配置重新计算，插件里也没有任何缓存的模式状态
（`apply()` 每次激活只读一次 config，缩减在每次组装时现算）。

`test/reload.mjs`（17 项）专门锁定这条路径：它通过**真实的 `fiber.update()`**
做 `stub → hidden → full → name → passthrough → enabled:false` 连续切换，
而不是手工重新挂载插件 —— 这样一旦将来有人在模块级缓存配置、或把状态存进
无法被重启刷新的闭包里，该测试会立刻失败。

> 排查提示：改完配置请**新建会话**再观察。已经组装好的提示词不会回溯修改，
> 旧会话里那份工具说明是改动之前算出来的。

## 依赖与「插件突然失效」的排查

插件 **import `@deepseek-ai/schemastery`**（它提供 `Config` schema，设置页的表单就是从这份 schema 生成的）。
该依赖现已**显式声明**在 `package.json` 的 `dependencies` 里（`^3.18.2`）。

> 历史坑：早期 `package.json` 没有声明它，而插件目录下的
> `node_modules/@deepseek-ai/schemastery` 只是一个**手动指向 `/tmp` 的软链**。
> `/tmp` 在重启后被清空 → 软链变成悬空 → Node 解析不到该包 →
> **整个插件加载失败**，表现就是「插件突然失效」。
> 现在依赖已声明，Node 会沿 profile 根目录正常解析；测试侧的软链也改指向持久位置。

排查时按顺序看这三件事：

```bash
# 1. 插件能否加载（这一步失败 = 依赖解析问题，而非配置问题）
cd ~/.dsh/plugins/dsh-tool-control && node -e 'import("./lib/index.js").then(()=>console.log("OK"))'

# 2. 依赖解析到哪里（应指向 profile 或持久解包目录，而不是已消失的 /tmp 路径）
node -e 'const{createRequire}=require("module");const r=createRequire(process.cwd()+"/lib/index.js");console.log(r.resolve("@deepseek-ai/schemastery"))'

# 3. 配置是否生效
sed -n '/tool-control-row/,/promptNotice/p' ~/.dsh/profiles/desktop/cordis.patch.yml
```

测试harness 会**自动发现**解包目录（优先 `~/.dsh/.asar-x`，回退 `/tmp/asar-x`），
并在两者都缺失时给出明确的重建命令 —— 不再因为 `/tmp` 被清空而误报成插件故障。

## 1.4.0：逐个工具的三态设置 + 兜底模式

**问题 1：其他插件的工具没被过滤。** 默认规则只覆盖 `mcp__*`、几个点名工具和 `^cordis_`，
其余工具（`search_web`、`image_gen` 等）不命中任何规则就原样放过 —— 这是设计如此，
但缺一个兜底，于是看起来像「过滤不完全」。现在新增：

- `fallbackMode` —— 不命中任何规则时用什么模式。**默认 `full`**，即不会悄悄隐藏新装插件的工具；
  想全部瘦身就设成 `stub` / `hidden`。实测锁定「插件在 control 运行**之后**才注册的工具」也会被覆盖。
- 设置页新增 `其余工具` 选择器，直接改这一项。

**问题 2：设置页只能用文本框手打工具名。** 现改为完整列表：

- Host 新增 `POST /api/dsh-tool-control/tools` 路由，返回**实时**工具清单
  （名称 / 体积 / 描述 / 已解析的模式 / 是否被手动指定）。每次按需读取而非快照，
  所以**新装插件的工具会自动出现**，无需重启。
- 卡片改为可搜索、按族分组的三态选择器，并显示每个工具的体积与 `已指定` 标记。
- 新增 `toolModes` 配置项（设置页写入）：`name -> mode` 的显式指定，
  **优先级高于所有规则** —— 否则把某个 MCP 工具设为「保留完整」会被 `mcp__` 前缀规则改回去。

`test/toolmodes.mjs`（29 项）锁定完整优先级链、兜底模式覆盖、以及设置页数据接口的返回契约。

## 1.5.0：修复列表加载、支持 PTC 模式、展示来源插件与一键批量设置

**问题 1：设置页刷新「一直读取中出不来」。**
Host 端路由此前直接返回了纯 JavaScript 对象 `{ ok: true, value: ... }`，而不是标准 `Response.json(...)` 实例；
导致底层 `dsh-client-connection` 在调用 `response.headers.entries()` 时抛出未捕获 TypeError，连接被挂起未能响应。
现已修正为标准的 `Response.json(...)`，并在客户端 `fetch` 中附加 `credentials: 'same-origin'` 和超时保护，
设置页的工具列表即点即出。

**问题 2：PTC 模式下工具注入不同，未生效。**
在 PTC 模式（`mode: 'ptc'`）下，模型在 `assembly.tools` 中只能看到 `run_code`，
其余工具并不在 `assembly.tools` 里，而是由 `tools.sdkSchemas(scope)` 动态编译成 TypeScript 或 Python 的
类型定义代码，注入到系统提示词的 `tools:sdk` 区块中。此前只在 `system-prompt/assemble` 处理了 `assembly.tools`，
导致在 PTC 模式下所有 CUA 等工具依然以几十 KB 的全量类型代码塞进 Prompt。
在 1.5.0 中：
- 挂接 `tools.sdkSchemas` 拦截：
  - `hidden` 工具被完全移出生成的 SDK 代码，Prompt 零增加；
  - `stub` 工具压缩参数为 `Record<string, JsonValue>` / `dict[str, Any]`，保留单句摘要；
  - `run_code` 作为运行器受到全局保护，永不被隐藏或压缩；
- 经由 `run_code` 发起的程序调用走嵌套解析（`nested=true`），隐藏的工具在程序内部**照常调用执行**，原始参数校验全量生效。
- `test/ptc.mjs`（18 项）覆盖 TypeScript 与 Python 两种 PTC 运行时下的瘦身、调用与提示词注入。

**问题 3：显示工具的来源插件，并在列表中清晰归类。**
- 引入来源识别机制（识别 `mcp:<server>`、各内置包 `dsh-tool-fs`、`dsh-tool-web` 等、以及调用栈/Fiber 上下文中的第三方插件名）；
- 设置列表按来源插件自动分组（如 `mcp:cua-driver-mcp (58)`、`dsh-tool-fs (4)`、`dsh-tool-web (2)` 等），
  并在工具名称旁展示来源 Badge；
- 搜索框支持同时搜索**工具名、描述和来源插件名**；
- 在每个插件分组表头提供「全保留」「全Stub」「全隐藏」快捷按钮，58 个 CUA 工具只需一键即可全部隐藏。

## 1.6.0：官方组件、调用统计、手动排序、预设归属、列表颗粒度

**为什么不一致：** 之前的开关是手写 `button + span` 模拟的，而 DSH 设置页用的是
`@deepseek-ai/dsh-client-ui-primitives` 里的 `Switch` / `SegmentedControl`。
手写控件没有设计 token 配色、没有按压缩放动画、没有键盘语义，所以看起来「不一样」。
本次全部换成官方组件：

| 用途 | 组件 |
|---|---|
| 总开关 | `Switch` |
| 模式选择（保留完整 / 只留名字 / 隐藏） | `SegmentedControl` |
| 搜索框 | `Input` |
| 排序、颗粒度筛选 | `Pill` |
| 来源插件、预设、体积等元信息 | `Tag` |

只有「刷新 / 全隐藏 / ↑↓×」这些文字链用一条**作用域样式表**（`.dsh-tg-link`）着色，
hover 与聚焦环同样取自 token —— 不再写死内联颜色。

### 默认按调用次数排序

Host 监听 `session/event` 的 `tool/call` 事件累计每个工具被调用的次数
（只统计 `tool/call`，不统计 `tool/result`，否则每次调用会算两次）。
卡片默认按**调用次数从多到少**排列，次数相同则按最近使用、再按名称，
所以列表最上面就是这次部署真正在用的工具。

> 统计口径是**本次运行**：Host 重启后归零。卡片页脚已注明，不假装是历史总量。

### 工具排序

列表上方提供五种排序，随时切换：

| 排序 | 说明 |
|---|---|
| **按调用次数**（默认） | 用得多的在前 |
| 按名称 | 字母序 |
| 按体积 | schema 大的在前（适合找「藏哪个最省」） |
| 按模式 | 隐藏 → 只留名字 → 保留完整 |
| 手动顺序 | 你自己排的提示词顺序 |

### 手动调整提示词中的顺序

每个工具行右侧有 `↑` `↓`，把该工具在**提示词里的顺序**前移/后移，
`×` 取消手动位置。写入 `toolOrder` 配置项：

- 列表内的工具按这个顺序排在**最前面**，其余工具按名称跟随；
- 顺序在 `system-prompt/assemble` 阶段应用 —— harness 会先按名字排序，
  这个 hook 是最后一次改写顺序的机会，所以无需修改 `dsh-system-prompt`；
- **不是过滤器**：排序不会让被隐藏的工具重新出现；
- `toolOrder` 里已不存在的工具名会被忽略，不会凭空注入不存在的工具。

### 工具在哪些预设中被使用

读取 `agentPresets`，在每个工具上标注它会被哪些预设暴露：

- 预设声明了 `allow` 列表（块状或 `allow: [a, b]` 内联形式）→ 只在其列出的工具上显示；
- 预设没有任何工具限制 → 视为对**所有**工具可用，卡片顶部只提一次受限预设，不给每行都挂同样的标签；
- 没有 `agentPresets` 服务的部署 → 该列自动省略（用非严格 `ctx.get(name, false)` 读取，
  不会因为缺少服务而抛错）。

### 列表颗粒度：只看某一类

「只看」一行提供五种视图，配合排序可以快速审计：

| 视图 | 用途 |
|---|---|
| 全部 | 默认 |
| **仅隐藏** | 检查到底藏了哪些（最常用于「省得对不对」） |
| 仅只留名字 | 检查被打折的中间态 |
| 仅保留完整 | 检查还有谁在常驻 |
| 有调用 | 只看本次真正用过的工具 |

搜索框同时匹配**工具名、说明、来源插件、预设名**，配合视图可做到「只看某插件里被隐藏的工具」这种组合筛选。

`test/usage.mjs`（20 项）锁定调用计数（含「不重复计数」）、手动顺序（含「未缩减时也生效」
这个曾经被早退分支吞掉的用例）、预设归属（块状/内联/无限制三种形态），
以及没有预设服务时路由仍可用。

## 1.7.0：修复调用次数、去掉全局模式、新增「禁用」

**问题 1：调用次数看不到。** 根因不是统计没生效，而是**计数被存在 `apply()` 的闭包里**。
保存设置页的任何一项都会 `fiber.restart()` → `apply()` 重新执行 → 计数器清零，
所以你每次调完工具再去看设置，数字永远是 0。

修复：计数移到模块级 `USAGE`。它仍然随 Host 进程重启归零，但不再被「改一次设置」清空。
`test/usage.mjs` 有专门的用例复现并锁定这个场景。

**问题 2：默认缩减模式还有用吗。** 它仍在生效但语义很糟：设置页写着「默认缩减模式」，
可你的规则（比如 `deferMcpPrefixes`）各自已经决定了模式，改它根本不生效 —— 看起来像坏了一样。

已彻底移除。现在：

- **每条规则必须自带 `mode`**：`{ match: "mcp__", mode: hidden }`；
- 旧的裸字符串写法（`- mcp__`）会被**拒绝并打警告**，不再静默继承；
- 不匹配任何规则的工具有 `fallbackMode` 兜底；
- 你 profile 里的配置已自动迁移为显式写法（备份：`cordis.patch.yml.bak-toolgate-modes`）。

**问题 3：增加禁用功能。** 新增第五种状态 `disabled`，与 `hidden` 的关键差异是**不注册**：

| | `hidden` | `disabled` |
|---|---|---|
| 模型能调用 | 能 | 不能 |
| `tool_search` 能找到 | 能 | 不能 |
| 在注册表里 | 在 | 不在 |

设置页每个工具现在是四选一：**保留完整 / 只留名字 / 隐藏 / 禁用**。
`name`（API defer）仍可通过配置文件指定，但不占列表按钮 —— 它只在 DeepSeek 官方通道有意义。

## 1.8.0：修掉两个「看起来像插件坏了」的静默失效

**问题 1：改一次设置，工具目录就少了一大半。** 根因在 `sweep()`：它用
`tools.schemas(undefined)` 重建目录，而宿主的这个 API 只枚举**全局层** —— 按 agent
scope 注册的工具（`read` / `bash` / `glob` / `job_*` / `team_*` / `schedule_*` …）一个都拿不到。
插件首次激活时靠注册钩子还能凑齐，但**每次保存设置都会 `fiber.restart()`**，
新一次 `apply()` 只能靠 `sweep()` —— 于是 66 个工具里只剩 25 个，`tool_search` 连
`read`、`bash` 都搜不到。缩减本身没受影响（waterfall 直接作用于整条 wire），
但目录一残，`tool_search` 这条路就断了。

修复：把「收养未知工具」抽成 `adopt(schema, scope)`，在**每次组装**的
`system-prompt/assemble` 里对 `assembly.tools` 逐个收养，PTC 的 `tools.sdkSchemas`
包装里同样收养。组装携带的就是本轮完整工具面，所以不论激活顺序、中间重启过几次，
目录都能补齐。

**问题 2：`tool_control` 的 `set_mode` / `set_fallback` 只说不做。** 它写的是
`ctx.fiber.config` 这份 Loader 行，而宿主**只会**通过 `configEditor` 服务落盘：
直接改行内对象既不落盘，还会请求一次重启，重启再从 profile patch 读回旧值 ——
写入被丢掉，代价却照付，工具却回一句「Successfully updated」。

修复：

- 会话内的覆盖改存进模块级 `LIVE_OVERRIDES`，`modeFor` 以最高优先级读取，
  **下一次请求立刻生效**；`apply()` 一跑就清空（那时落盘的配置才是权威）；
- 落盘走 `configEditor.edit(entry, …)`：校验 → 重写 `cordis.patch.yml` → reconcile →
  重启 fiber，与设置页保存完全同一条链路；
- 返回值如实报告：`Written to the profile config…` 或 `In-process only (原因)…`，
  不再假报成功；
- 设置页与 `list` / `get` 的 「手动指定」标记也把会话内覆盖算进去。

**问题 3：PTC 模式下门控根本没落到渲染路径上。** `ptc` 预设里模型看不到原生 tool
schema，整份工具面由 `tools:sdk` 段落承载，而那段是 `render(registry.sdkSchemas(scope))`
渲染出来的。实测（2026-11-11，Host 重启后）：把 `edit` 从 `full` 改成 `hidden` 再 `reset`，
`tools:sdk` 始终 86370 字符不变，18 个 `hidden` 工具（`univer_*` / `schedule_*`）照样以完整
签名出现 —— 只 patch 服务实例上的 `sdkSchemas`，在本机并没有patch到真正在渲染的那个对象上。
于是提示词 22k 里 20.6k 全是未缩减的 SDK，和「插件没生效」几乎无法区分。

定位下来是版本错位：本机 app（v0.2.2-rc.1，11-04 构建）已经把 SDK 渲染搬进
`@deepseek-ai/dsh-tool-executor-ptc`，由 `PtcExecutor.renderSdk(definitions)` 渲染，
`tools.sdkSchemas` 这个方法**在新构建里根本不存在** —— 插件里那句
`if (typeof tools.sdkSchemas === "function")` 因此静默跳过，PTC 门控从来没跑过。
而 `~/.dsh/.asar-x`（10-15 的旧解包）里还有旧代码，`test/ptc.mjs` 一直绿，所以测试也发现不了。

修复：同时接两条缝，并且都打在**原型**上（一个类、所有实例，谁在渲染都覆盖得到）：

- 新构建：`PtcExecutor.prototype.renderSdk` —— 只影响 `tools:sdk` 文本，不动
  `tools.definitions()`（那条还喂 `run_code` 的 program bindings，隐藏工具必须仍可调用）；
  执行器由别的插件贡献、可能晚于本插件激活，所以在每次组装时补一次（幂等）；
- 旧构建：`tools.sdkSchemas`（实例 + 原型），保持向下兼容。

并在 `tool_control stats` 增加一行
`PTC SDK control: wrapped (renderSdk(prototype)); renderer calls: N; schemas in/out: 66/48`。
`renderer calls: 0` 就说明渲染器根本不走这两条缝 —— 有了这行数字，
这类「改了却没效果」的现场不必再靠猜。

`test/adopt.mjs` 新增 13 项，锁定「`schemas(undefined)` 只返回全局层时，目录仍能靠组装补齐」这条路径；
`test/agent-tool.mjs` 继续锁定「set_mode → 下一次组装就变」。全套 270 项全绿。

---

## 1.8.1：插件停用后，工具目录不再残留它的工具

**问题**：1.8.0 的 `adopt()` 把「组装时看到的工具」收进 `seen`，但这条路径没有注册钩子的
`disposer`。如果某个工具在 tool-control 激活**之前**就已注册（典型：核心工具、MCP 先连上、
或插件热重载前注册的工具），随后它的插件被停用 / 热卸载，工具从注册表消失了，`seen`
里的记录却还在 —— 设置页继续列它，`tool_search` / `tool_catalog` 继续介绍一个根本调不到的
工具。这和「提示词管理里还显示未启用插件的段落」是同一类残留。

**修复**：

- `adopt(schema, scope)` 把收养时的 `scope` 记到记录上，并标记 `adopted: true`；
- `tools/change` 时先做 `reconcile()`：对收养记录用 `tools.get(name, scope)` 回查注册表，
  已不存在就删掉；
- PTC SDK 投影不带 `scope`（`renderSdk(definitions)` 的参数里没有），这类记录标记为
  `verifiable: false`，不参与回查 —— 否则每次请求都会把按 agent scope 注册的工具误删，
  正好重演 1.8.0 修过的「目录少一大半」。

**测试**：`test/adopt.mjs` 新增 2 项 —— 收养的工具在 owner 注销后从设置页数据与
`tool_search` 同时消失；其余 268 项保持全绿。

## 1.8.3：第三方插件的工具不再显示成「内置」

**问题**：设置页把工具按「来源插件」分组，但免费搜索插件（`dsh-free-search`）的
`multi_search` / `advanced_search` / `platform_search` / `video_search` / `weather` /
`free_search_test` 全部显示成「内置」。用户看到的是一组 `内置 (6)`，点开却是一个第三方插件的工具。

**根因**（两层，缺一不可）：

1. 核心 `ToolsService.register()` 只保存 `{ definition, when }`，**注册表不记录 provenance**；
   唯一能拿到 owner 的地方是本插件的注册钩子里的 `this.ctx.fiber.name`。
2. bundle patch 行只能 **APPEND** 到条目列表，所以由更早的 bundle 挂载的 provider 一定先注册
   （本机 `cordis.patch.yml`：`dsh-free-search` 在第 826 行，`tool-control-row` 在第 964 行）。
   这些工具只能走 `adopt()` 收养，而收养路径没有 owner，于是落到 `resolveToolSource()` 的
   硬编码兜底 —— 字面量「内置」。

**修复**：

- `resolveToolSource(name, owner)` 的优先级改为：MCP server → `sourceOverrides` 显式指定 →
  注册钩子拿到的 fiber 名（去掉 `@scope/` 前缀，过滤 `root`/`tools`/`loader` 等无信息名字）→
  内置包表 → **已装插件包索引** → `builtin` 哨兵；
- 新增**来源索引**：扫描 `~/.dsh/plugins/*` 与 `~/.dsh/profiles/*/node_modules/*` 里带 `dsh` 清单字段的包，
  收集代码中的 `name: "<tool>"` 字面量，得到 tool → 插件包映射。一个名字被多个包同时声明时**不猜**
  （保持未解析），并跳过本插件自己的包 —— 它的文档会引用别人的工具名；
- 未识别的来源不再返回中文字面量，而是 `builtin` 哨兵，由客户端按语言渲染 `内置` / `Built-in`；
  之前英文界面也会显示中文；
- 索引在 `apply()` 后 1.5 秒异步预热，设置页首次请求不必等扫描（实测整轮 ~300 ms，缓存 60 s）；
- 新增配置 `sourceOverrides`（工具名 → 插件名），给自动识别失败的行一个显式出口。

**顺带修掉**：`patchedRegister(definition)` 之前只转发第一个参数，把注册的第二参数 `options`
（`when` 激活条件）吞掉了；现在原样透传。

**说明**：`web_search` / `web_fetch` 仍归属 `dsh-tool-web` —— 免费搜索插件接管的是 `ctx.web` 的
**provider**，工具本身还是内置那个。若希望这类工具按 provider 显示，
用 `sourceOverrides: { web_search: dsh-free-search }` 显式指定即可。

**验证**：本机实测 6 个 free-search 工具全部解析为 `dsh-free-search`（`web_search` 仍是
`dsh-tool-web`，未知工具仍是 `builtin` 哨兵）；索引一轮 ~300 ms / 417 条。
