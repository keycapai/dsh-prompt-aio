# 发布流程

本仓库有**四个包**，发布顺序有硬性依赖：三个插件必须先发，元包最后发。

## 一次性配置

### npm Trusted Publishing（推荐，无需长期 token）

Trusted publishing 只能给**已存在**的包配置，所以要为**每一个包**单独配一次：

| 包 | 配置页 |
|---|---|
| dsh-tool-control | https://www.npmjs.com/package/dsh-tool-control/access |
| dsh-skill-control | https://www.npmjs.com/package/dsh-skill-control/access |
| dsh-prompt-control | https://www.npmjs.com/package/dsh-prompt-control/access |
| dsh-prompt-aio | https://www.npmjs.com/package/dsh-prompt-aio/access |

每个都填：

| 字段 | 值 |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `keycapai` |
| Repository | `dsh-prompt-aio` |
| Workflow filename | `release.yml` |
| Environment | 留空 |

### 备用：NPM_TOKEN

仓库 **Settings → Secrets and variables → Actions** 加 `NPM_TOKEN`（Granular，Read and write）。
`release.yml` 会自动回退到它。

## 首次发布

四个包都还没上过 npm，第一次必须手动推（Trusted Publishing 要求包已存在）：

```bash
npm login
node scripts/publish-all.mjs --publish
```

脚本会按 tool-control → skill-control → prompt-control → prompt-aio 的顺序发布，
任何一个失败就立刻停下——不会在依赖缺失的情况下把元包推上去。

## 之后的每次发布

```bash
# 1. 改版本号（元包版本就是这次 release 的版本）
npm version patch --workspace packages/dsh-prompt-aio --no-git-tag-version

# 2. 如果插件也有改动，各自升版本
npm version patch --workspace packages/dsh-tool-control --no-git-tag-version

# 3. 提交并打 tag
git commit -am "chore(release): v0.2.1"
git tag v0.2.1
git push --follow-tags
```

工作流会：跑全部测试 → 校验 tag 与元包版本一致 → 按依赖顺序发布 → 建 GitHub Release。

## 手动试跑

**Actions → Release → Run workflow**，`publish` 默认不勾：只打包不发布。

## 为什么顺序写死在脚本里

元包 `dsh-prompt-aio` 的 dependencies 指向另外三个包。如果先发元包，
`npm install dsh-prompt-aio` 会在一段时间里解析失败——用户看到的是一个装不上的包，
而原因在发布顺序上，很难查。`scripts/publish-all.mjs` 是唯一记录这个顺序的地方，
本地和 CI 调用的是同一个脚本。
