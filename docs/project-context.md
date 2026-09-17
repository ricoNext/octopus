# 项目上下文

Star Lee 的桌面端简易版 Agent Worktree 工具。
已拍板。实现以 [MVP 产品规格](product-spec.md) 为准；
背景见 [产品设计](product-design.md)。

## 目标

在本机用一个窗口管理同一 git 仓库的多个 worktree。
每个 worktree 内嵌通用终端和只读 diff；用户自己在
终端里开 agent。重编辑用外部 Cursor。不是完整 IDE。

对标 [Orca](https://www.onorca.dev/) 的隔离模型
（一任务一 worktree），不做它的完整 ADE 范围。

## 约束

- 未宣布开工前只维护规格与设计，不写应用代码。
- 产品文档在本仓库 `docs/`：
  `product-design.md`、`product-spec.md`、
  `project-context.md`。
- 应用代码与文档同一仓库，本机路径为
  `/Users/ricolee/Desktop/rico/octopus`。
- 不卖模型、不拦 prompt、不启动任何 agent CLI。
- Worktree 必须是真实 `git worktree`，可用普通 git。
- 自动生成的 Markdown 须能通过 markdownlint。
- 中文 UI。桌面栈已锁 Tauri。只做 macOS。
- 独立实现：不读、不 fork Orca 源码。

## 已确定事项

- 用户：Star Lee。场景：并行 worktree + 多 agent
  （agent 由用户在终端里自己开）。
- 平台：只 macOS。
- 形态：编排台。内嵌终端 + 只读 diff；重编辑用
  外部 Cursor。
- 与 Cursor：独立 App，不是扩展；Cursor 只是
  「打开此路径」的外部编辑器。
- Agent 预设：不做。无 Claude / Codex / Cursor CLI
  名单；Worktree 里只有通用终端。
- 目录策略：不做产品功能。无目录配置 UI；实现用
  一个固定默认路径（见规格）。
- 权限：不做。不包高权限旗标，无每项目权限开关。
- GitHub PR：不做。
- UI 语言：中文。正式产品名未定，不挡 MVP。
- 技术栈：Tauri。不再做选型 spike。
- Orca 源码：独立实现，不读不 fork。
  （未明确回复，按默认）
- 新 worktree 的依赖 / `.env`：不管，无 setup 脚本。
  （未明确回复，按默认）
- 实现目录：`/Users/ricolee/Desktop/rico/octopus`。
- 核心对象：Project、Worktree、终端。无 Agent 对象。
- 对标调研已完成。Orca 桌面端免费、MIT、BYO 订阅；
  无公开按座价；`/pricing` 为 404。

## 待定事项

- 正式产品名（不挡实现，可用临时中文窗标题）。
- MVP 之后的增强（分屏、SSH、浏览器等）不在本期，
  见规格「以后再说」；现不拍板。
