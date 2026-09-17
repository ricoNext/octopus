# 简易版 Agent Worktree 桌面工具设计

面向：Star Lee。对标：[Orca / Onorca](https://www.onorca.dev/)。
调研日期：2026-09-17。拍板日期：2026-09-17。

本文记录对标研究与已定设计。实现以
[MVP 产品规格](product-spec.md) 为准。压缩备忘见
[项目上下文](project-context.md)。未宣布开工前不写应用代码。
本仓库路径：`/Users/ricolee/Desktop/rico/octopus`。

## 1. Onorca 研究摘要

站点品牌是 **Orca**（域名 onorca.dev）。定位为 ADE
（Agent Development Environment）：给人和多个 coding agent
一起用的环境，而不是给一个人打字的传统 IDE。

### 1.1 它解决什么

核心痛点：同一仓库上并行多个 agent 时，共用一个
checkout 会互相改文件、要 stash、要切分支、会丢现场。

Orca 的答案：每个任务一个真实 `git worktree`，每个
worktree 自带 agent 终端、diff、浏览器标签。人可以：

- 让 3 个 agent 用同一 prompt 赛跑，再挑赢家。
- 认真审 AI diff，再 commit / push / 开 PR。
- 把已有 Claude Code、Codex、Cursor CLI 等订阅放进一个窗口。
- 可选把计算放到 SSH、自建 Orca Server、自有云 VM。

文档原话：它为已经会写代码、会看 diff、会管
worktree 的人设计；不是 no-code 工具。

### 1.2 核心对象

| 对象 | 含义 |
| --- | --- |
| Project / Repo | 一个 git 仓库，或含多仓的父文件夹组。有 base ref。 |
| Worktree / Workspace | 一次任务的磁盘 checkout + 分支。可钉选、休眠、归档。 |
| Agent | 可启动的 CLI（Claude Code、Codex、任意 CLI）。 |
| Session | 某一个 worktree 里某一个终端里的一次 agent 进程。 |
| Run / Task / Dispatch | 编排层：多 agent 分工、DAG、决策门。完整 ADE 才需要。 |
| Host | Local、SSH、Remote Orca Server。 |

Orca 里对象关系：

```text
Project 1──* Worktree 1──* Session（绑定一种 Agent）
```

Session 不是独立一级导航，而是挂在 worktree 卡片和
Agent Dashboard 上的状态。

### 1.3 主要界面（站点与文档可见）

主窗（文档配图）：左侧 worktree 列表；中间分屏；
agent 终端 + diff。状态栏有 agent 活动。未读 worktree 加粗。

首页可见模块：

- 侧栏任务卡：时长、分支名、进行中文案。
- 内嵌终端：agent 读写文件、跑测试；也可开 `pnpm dev`。
- 文件树与刷新速率 / SSH 状态。
- 工作区启动器：一键选 agent 或空终端。
- 手机伴侣：桌面在线状态、worktree 数、用量、继续终端。
- 能力表：并行 worktree、三端、MIT、GPU 终端、内嵌
  Chromium、SSH、inline diff 评论回传、约 27 种 agent、
  CLI、MCP / hooks / skills。

文档还描述：Create Workspace 对话框（Project、Run on、
Agent、任务链接）；`Cmd-J` 跳转；Resource Manager 清理；
每 worktree 自己的标签布局。

### 1.4 主工作流

文档把「第一个 3-agent session」当作最重要一页：

1. Add Repo：指向本地 checkout，读取默认分支作 base ref。
2. 创建 worktree：任务名、start-from、可选 agent。
3. 在该目录启动 CLI，带上已有订阅凭证。
4. 再开两个 worktree，换不同 agent，贴同一 prompt。
5. 分屏同时看三个终端。
6. 看 diff，给赢家写 inline 评论，commit / push；删掉失败者。

生命周期：创建 → 工作 → 相对 start-from 审 diff →
Ship → 归档或删除（目录 + 分支，需确认）。

创建是后台进行：关对话框后仍 `git fetch` /
`git worktree add`；侧栏有进度；失败可重试。

### 1.5 定价与能力边界

公开站点**没有**按座订阅价。`/pricing` 为 404。

能确认的是：

- 桌面端免费下载：macOS（Apple Silicon / Intel）、
  Windows、Linux（AppImage / deb / rpm）。Homebrew cask。
- [GitHub `stablyai/orca`](https://github.com/stablyai/orca)
  为 MIT。企业页写可自托管。
- **BYO 订阅**：Orca 不卖模型。钱花在 Claude / Codex 等。
- [Enterprise](https://www.onorca.dev/enterprise) 无价目表，
  走销售（安全、批准的 agent、组织默认项）。

Orca 明确「不是」：

- 不是模型，不夹在 prompt 中间。
- 不是 git 替代；worktree 可在普通终端里操作。
- 不是托管 VPS；远程机器由用户自己提供。

完整产品还包括：手机伴侣、GPU 终端、每树浏览器与
Design Mode、SSH、GitHub / Linear / Jira / GitLab、
`orca.yaml` 与 `.worktreeinclude`、Agent Dashboard、
orchestration CLI、用量。这些是完整 ADE，不是本产品 MVP。

### 1.6 对本产品的启示（已消化进规格）

要抄的是隔离模型，不是功能清单：

- 隔离单元是 git worktree，不是「多个终端同一目录」。
- 人的工作是派活、盯终端、审 diff、收口，不是再造 IDE。
- 本产品不替用户启动 agent；只给通用终端，cwd 为
  worktree 根。
- 删 worktree 必须有确认，避免误删未提交改动。

第一期不做：远程机群、手机、内嵌浏览器、多仓编排
DAG、Agent 预设、把 Cursor 替换成新 IDE。

## 2. 问题与目标

### 2.1 问题

Star Lee 的日常是：同一仓库多个 worktree 并行，同时开
多个 agent 工具。痛点：

- 目录、分支、终端窗口各管各的，对不上。
- 新建 worktree 要手打 `git worktree add`，步骤碎。
- 想对比两路实现时，切窗口成本高。

本产品不解决「自动识别 agent 忙闲」；状态以终端里
用户自己看到的输出为准。

### 2.2 目标

做一个 macOS 桌面编排台，让一个人在本机：

1. 把仓库登记为 Project，一键加 / 列 / 删 worktree。
2. 每个 Worktree 有一个内嵌通用终端（cwd 为该树根）。
3. 看该 worktree 相对起始 ref 的只读 diff。
4. 用外部 Cursor 打开该路径做重编辑。

成功标准：

- 从「已有本地仓」到「两个 worktree 各有终端」不必
  手打 `git worktree add`。
- 离开再回来，仍能认出 Project / Worktree。
- 磁盘上仍是普通 git worktree，无专有仓库格式。

## 3. 非目标

MVP 不做：

- 模型网关、API Key 代理、按 token 计费。
- 完整 IDE（多文件编辑、LSP、调试器）。
- 内嵌 Chromium / Design Mode。
- iOS / Android 伴侣。
- SSH / 自建 Server / 云 VM。
- Linear / Jira / GitLab / GitHub PR。
- 多 agent DAG、决策门、coordinator inbox。
- 企业 SSO、审计后台、组织策略。
- Agent 预设、启动器、高权限旗标、每项目权限开关。
- 目录配置 UI、setup 脚本、复制 `.env`、共享
  `node_modules`。
- 替换 `git`；只包装创建 / 删除 worktree。
- Windows / Linux。
- 读或 fork Orca 源码。

## 4. 核心概念

已定对象只有三个。没有 Agent、Session 看板、Host、
Run、Task。

### 4.1 Project

一个本地 git 仓库。绑定：

- 主 checkout 绝对路径。
- 登记时读到的默认分支，作为新 worktree 的默认
  start-from。

一个 git 仓库对应一个 Project。不做多仓父文件夹组。

### 4.2 Worktree

一次并行任务的隔离工作区。磁盘上是
`git worktree add` 的结果。绑定：

- 显示名、分支名、起始 ref、路径。
- 状态：creating / ready / error。

规则：

- 每个 Worktree 一个内嵌终端。
- 删除工作树时弹出确认，让用户选择要不要同时删
  对应 git 分支。不是静默删，也不是永远不删。
  目录用 `git worktree remove` 去掉。
- 用户用裸 git 建的 worktree，添加 Project 时必须
  扫描并勾选导入。

### 4.3 终端

每个 Worktree 一个 PTY。cwd 固定为该 worktree 根。
壳为用户登录壳（如 zsh）。应用不注入 agent 命令、
不注入权限旗标。用户自己输入 `claude`、`codex` 等。

不是产品对象：Agent 预设、Session 状态机
（running / needs_input / idle）。

## 5. 信息架构

单窗，三区。中文 UI。

```text
┌────────────┬──────────────────────────┬─────────────┐
│ 侧栏       │ 主区：当前树的终端        │ 检查区      │
│ Project    │                          │ 只读 Diff   │
│  └ Worktree│                          │ 可折叠      │
└────────────┴──────────────────────────┴─────────────┘
```

### 5.1 侧栏

- 按 Project 分组。
- Worktree 行：显示名、分支名。
- `+`：在当前 Project 建 Worktree。
- 右键：在访达中显示、在 Cursor 中打开、删除。
- 主 checkout 单独一行，与任务 worktree 分开。

### 5.2 主区

当前 Worktree 的内嵌终端。MVP 不分屏、不多标签、
不做跨树 Session 看板。

### 5.3 检查区

当前 Worktree 相对 start-from 的只读 diff。可折叠。
不可编辑、不可评论、不回传给 agent。

### 5.4 设置

MVP 无独立设置页。不提供目录根、Agent、权限开关。

## 6. 关键用户流程

### 6.1 登记仓库

1. 「添加项目」选本地 git 根目录。
2. 校验是 git 仓，读取默认分支。
3. 扫描 `git worktree list`，勾选导入。已定：添加
   项目时这一步必做，不是可选项。
4. 侧栏出现 Project。

失败：不是 git 仓、路径不可读、已添加过。只提示，
不静默改盘。

### 6.2 开一条并行任务

1. 在 Project 上点 `+`。
2. 填显示名；可选填分支名（空则从显示名生成）。
3. 可选改 start-from。已定：只给本地分支，不自动
   fetch，不提供远程跟踪 / SHA 的单独 UI。
4. 后台 `git worktree add` 到固定默认路径；侧栏出进度。
5. 完成后聚焦新 Worktree，打开通用终端。

无 Agent 选择步骤。

### 6.3 多路并行

用户开多个 Worktree，在各自终端里自己启动 agent。
一任务一树，避免改同一磁盘文件。同题赛跑同样靠多个
Worktree，应用不提供「一键开三个 agent」。

### 6.4 审与收口

1. 打开只读 Diff（对 start-from）。
2. 「在 Cursor 中打开」该路径。
3. 提交在终端或 Cursor 里自己做。
4. 不要的 Worktree：删除。确认时选择是否同时删
   对应 git 分支。脏工作区删除失败则提示，二次
   确认后可强制删除工作树目录。

### 6.5 重启与恢复

- 终端进程结束：提供「重新打开终端」，新开一个壳。
- 应用退出：记下 Project / Worktree 元数据；下次与
  `git worktree list` 对账。不恢复终端回滚缓冲，不
  复活已死进程。

## 7. 产品形态（已定）

已定方案 A：编排台。管 worktree、内嵌通用终端、只读
diff；重编辑交给 Cursor。

未选：

- 方案 B 迷你 ADE（MVP 分屏、文件树、布局记忆）。
- 方案 C 薄启动器（agent 丢到系统终端、应用内无
  PTY）。

## 8. MVP 与以后

### 8.1 已定 MVP

做：本机、单用户、单窗、只 macOS；Project = 单仓；
创建 / 列出 / 删除 worktree；添加项目时扫描并勾选
导入已有 worktree（必做）；每树一个通用终端；只读
diff；在 Cursor / 访达打开；重启后恢复侧栏。删除
工作树时确认是否同时删对应 git 分支。起始分支只
列本地分支，不自动 fetch。

不做：见第 3 节与规格清单。

### 8.2 以后再说（本期不拍板）

1. 同一 Worktree 多分屏终端。
2. 跨树状态看板。
3. `.env` 复制与 shared dirs。
4. 内嵌 commit 与 PR。
5. SSH、手机、编排 DAG。
6. Windows / Linux。

## 9. 技术栈（已定）

已定，不再做选型 spike：

- 桌面：Tauri 2，只 macOS。
- 前端：React + TypeScript + Vite。
- 终端：xterm.js + Rust `portable-pty`。
- UI：组件库（Radix / shadcn 一类）。
- 持久化：本地 JSON。
- 包管理：bun。
- git：本机 PATH 的 `git`，不内嵌。

git 子进程、关窗杀进程属于实现必做，不是产品
可选项。

未采纳：Electron、纯 SwiftUI、Wails、Flutter。

## 10. 已定决议

对应原开放问题。除 Orca 源码与依赖 / `.env` 两处
仍按默认外，均为用户拍板。

1. 平台：只 macOS。
2. 形态：编排台（内嵌终端 + 只读 diff；重编辑用
   外部 Cursor）。
3. 与 Cursor：独立 App。
4. Agent 预设：不做。无内置名单；只有通用终端。
5. 目录策略：不做产品功能。无配置 UI；实现用固定
   默认路径。
6. 权限：不做。不包高权限旗标，无每项目开关。
7. PR：不做。
8. 语言：中文 UI。正式名未定。
9. 技术栈：Tauri 2 + React + TypeScript + Vite；
   终端 xterm.js + `portable-pty`；UI 用 Radix /
   shadcn 一类；本地 JSON；包管理 bun；git 走 PATH。
10. Orca 源码：独立实现，不读不 fork。
    （未明确回复，按默认）
11. 新 worktree 依赖 / `.env`：不管，无 setup 脚本。
    （未明确回复，按默认）
12. 删除工作树：确认提示里选择是否同时删对应 git
    分支。不是静默删，也不是永远不删。
13. 添加项目：必须扫描 `git worktree list` 并勾选
    导入。必做，不是可选项。
14. 起始分支：只给本地分支；不自动 fetch；不提供
    远程跟踪 / SHA 的单独 UI。

## 11. 文档关系

产品文档在本仓库 `docs/`，跟着 git 跟踪。规格写完后，
实现计划另开，仍不在本文展开。拍板前的「请选字母」
流程已结束。代码只写在本仓库
（本机 `/Users/ricolee/Desktop/rico/octopus`）。

## 12. 调研来源

- [Orca 首页](https://www.onorca.dev/)
- [What is Orca](https://www.onorca.dev/docs)
- [Install](https://www.onorca.dev/docs/install)
- [Download](https://www.onorca.dev/download)
- [Enterprise](https://www.onorca.dev/enterprise)
- [First 3-agent session](https://www.onorca.dev/docs/first-session)
- [Worktrees](https://www.onorca.dev/docs/model/worktrees)
- [Agents and sessions](https://www.onorca.dev/docs/model/agents-sessions)
- [Tabs and splits](https://www.onorca.dev/docs/model/tabs-panes-splits)
- [Browser](https://www.onorca.dev/docs/browser/overview)
- [SSH worktrees](https://www.onorca.dev/docs/ssh)
- [CLI overview](https://www.onorca.dev/docs/cli/overview)
- [Orchestration](https://www.onorca.dev/docs/cli/orchestration)
- [GitHub stablyai/orca](https://github.com/stablyai/orca)

定价页 `https://www.onorca.dev/pricing` 在调研时为 404。
勿与 [Orca Security](https://orca.security/) 云安全产品混淆。
