# dsh-prompt-aio

DSH Prompt AIO — 一元包 + 三子包，一次安装三套上下文管控。

## 架构（4 个 npm 包）

| 包 | 职责 | 工具 |
| --- | --- | --- |
| `dsh-prompt-aio` | 元包（本文），仅含 patch + 图标，无自己的 client | — |
| `dsh-prompt-control` | 系统提示词管控 | `prompt_control` |
| `dsh-skill-control` | Skill 目录管控 | `skill_control` / `skill_search` / `skill_catalog` |
| `dsh-tool-control` | 工具面管控 | `tool_search` / `tool_catalog` |

每个子包是独立 bundle，各自携带 server + client + icon + locale。**三张设置卡片各自独立注册**（client id = 包名），不会像早期单包合并方案那样发生 slot key 冲突导致设置消失。

## 安装

用户只需装元包，npm 会自动拉入三个子依赖：

```bash
plugin_manager install_bundle dsh-prompt-aio
```

元包 patch 的三行分别挂载 `dsh-tool-control` / `dsh-prompt-control` / `dsh-skill-control`，config 内联在 patch 里。

## 为什么从合并改为 4 包

单包方案把三份 client 合并进同一个 `exports["./client"]`，导致 `plugins.bundle.config` 插槽的 key 冲突——三张设置卡片只能渲染一张，其余丢失。4 包方案每包一个 client id，各自注册，设置完整。

## 命名

工具名已全部 `*_gate` → `*_control`：`prompt_gate`→`prompt_control`、`skill_gate`→`skill_control`、`tool_gate`→`tool_control`。`dsh-prompt-aio` 及三个 control 包名 NPM 实测均未占用。建议用 `@<你的scope>/` 前缀防抢注。

## 本地开发

四个包都在 workspace 下，profile 用 `link:` 指向各自目录。子包生成脚本见 `test/gen-controls.cjs`。
