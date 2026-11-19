# dsh-prompt-aio

> 一个命令，装齐四个控制插件。让 agent 的上下文花在正事上。

[![npm](https://img.shields.io/npm/v/dsh-prompt-aio.svg)](https://www.npmjs.com/package/dsh-prompt-aio)
[![license](https://img.shields.io/npm/l/dsh-prompt-aio.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/dsh-prompt-aio.svg)](./package.json)

```bash
npm install dsh-prompt-aio
```

agent 每一轮都要把系统提示词、工具 schema、skill 目录塞进上下文。这三样里很大一部分
是**这一轮用不上**的。这个 bundle 把三个插件打包在一起，分别控制这三处的水位。

## 四个包的关系

| 包 | 作用 | 行数 |
|---|---|---|
| `dsh-tool-control` | 工具面：批量隐藏 MCP 与低频工具，按需 stub 展开 | ~4400 |
| `dsh-prompt-control` | 系统提示词：预设管理、来源分组、任意位置插入规则 | ~4400 |
| `dsh-skill-control` | Skill 目录：name-only 回落、描述长度上限 | ~2400 |
| `dsh-prompt-aio` | **元包**，只负责把上面三个装成一个单元 | 2 |

元包本身没有逻辑。它的价值在于 `install_bundle dsh-prompt-aio` 一条命令装齐，
`remove_bundle` 一条命令拆干净，且三个插件的设置卡片各自独立注册、互不冲突。

## 为什么要控制这三处

上下文预算不是无限的。一个装了几十个 MCP 工具的会话，光工具 schema 就能吃掉几万 token，
而其中绝大多数工具这一轮根本不会被调用。

三个插件解决的是同一个问题的三个面：

- **工具**：`tool_search` 找得到就行，不必一开始就把完整 schema 摊开；
- **提示词**：用不上的段落可以整段关掉，需要的规则可以插到指定位置；
- **Skill**：目录只显示名字，点开才看描述。

三者都默认**不改变**任何东西——`fallbackMode` 默认为 `full`，`enabled` 默认 `true`，
但配置里没有指定要削减什么。**是你决定削减什么，不是插件替你决定。**

## 快速上手

```bash
# 装整个 bundle
npm install dsh-prompt-aio

# 或者只装你需要的那个
npm install dsh-tool-control
```

装好后在 profile 的 `cordis.patch.yml` 里按需覆盖配置。bundle 自带的 patch 已经给了一套
保守的默认值（隐藏 `mcp__*` 和 `cordis_*`，stub 掉 `workflow` 和 `plugin_manager`）。

## 开发

这是一个 npm workspaces monorepo。

```bash
git clone https://github.com/keycapai/dsh-prompt-aio.git
cd dsh-prompt-aio
npm ci
npm test              # 跑全部四个包的测试
```

单独跑一个包：

```bash
npm test --workspace dsh-tool-control
```

### 发布

发布**必须按依赖顺序**：三个插件先发，元包后发。否则 `npm install dsh-prompt-aio`
会在一段时间里装不上。`scripts/publish-all.mjs` 把顺序写死在一处：

```bash
node scripts/publish-all.mjs            # 干跑：打包但不发布
node scripts/publish-all.mjs --publish  # 真的发布
```

打 tag 会触发 `.github/workflows/release.yml`，它跑测试、校验版本、然后调用同一个脚本。
详见 [docs/RELEASING.md](./docs/RELEASING.md)。

## 测试

四个包共 79 个用例，覆盖的是那些「错了会静默出错」的纯函数：模式归一化、分类、
哈希、变量替换、allow 列表解析。这些函数决定模型看到什么，写错了不会抛异常，
只会让 agent 悄悄少一个工具或者多付几千 token——所以它们必须有测试盯着。

```
dsh-prompt-control   29
dsh-skill-control    28
dsh-tool-control     22
```

## 许可证

[MIT](./LICENSE) © 2026 Keycap AI & Rentong Zhang
