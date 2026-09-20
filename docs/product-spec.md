# MVP 产品规格

状态：已拍板，可实现。未宣布开工前不写应用代码。
产品设计背景见 [产品设计](product-design.md)。
压缩备忘见 [项目上下文](project-context.md)。

实现以本文为准。与讨论稿冲突时，以本文为准。

## 1. 一句话

macOS 上的 Worktree 编排台：登记本地 git 仓，创建 /
列出 / 删除真实 `git worktree`；每个 worktree 一个
内嵌通用终端和一块只读 diff；重编辑用外部 Cursor。

## 2. 范围

### 2.1 做

- 只 macOS；单用户；单个主窗口。
- Tauri 2 桌面应用；中文 UI。前端 React、TypeScript、
  Vite。包管理 bun。
- Project = 一个本地 git 仓库。
- 创建、列出、导入、删除 worktree。
- 添加项目时必须扫描已有 worktree 并勾选导入
  （必做，不是可选项）。
- 删除工作树时用确认提示，让用户选择要不要同时
  删除对应 git 分支。
- 新建工作树的起始分支只列本地分支。
- 每 Worktree 一个内嵌 PTY，cwd 为该树根目录。
- 相对创建时记录的 start-from，展示只读 diff。
- 「在 Cursor 中打开」「在访达中显示」。
- 应用重启后恢复 Project / Worktree 列表（对账磁盘）。
- 固定默认 worktree 路径（实现常量，无配置 UI）。

### 2.2 不做

- Windows、Linux、多窗、托盘常驻。
- Agent 预设、agent 启动器、品牌 CLI 名单。
- 探测 agent 忙闲 / needs_input / idle。
- 高权限旗标、每项目权限开关。
- 目录配置 UI、全局 worktree 根设置。
- setup 脚本、复制 `.env`、共享 `node_modules`。
- GitHub / GitLab / Linear / Jira / PR / checks。
- 内嵌编辑器、文件树、LSP、调试器。
- 内嵌浏览器、Design Mode。
- 分屏、多终端标签、跨树看板。
- SSH、远程机、手机伴侣。
- 自动 `git fetch`；静默删除本地分支。
- 模型网关、账号系统、计费。
- 读或 fork Orca 源码。
  （未明确回复，按默认）
- 新 worktree 依赖安装。
  （未明确回复，按默认）

## 3. 平台与 Tauri 约束

- 目标：macOS。Apple Silicon 优先。不承诺 Intel。
- 不配置、不打包 Windows 或 Linux 目标。
- 依赖本机 `git` 在 PATH 中可用。缺少则在添加项目时
  明确报错，不内嵌 git 二进制。
- 终端：xterm.js + Rust `portable-pty`。登录壳（优先
  `$SHELL`，否则 `/bin/zsh`）。继承登录环境，便于
  用户自己敲 `claude` 等命令。应用不改 argv。
- 文件访问：用户选出的主仓、默认 worktrees 目录。
  用系统文件夹选择器添加项目。
- 关应用或删 Worktree 时结束对应 PTY，避免孤儿进程。
- 独立实现。禁止把 Orca 仓库当依赖或拷贝其源码。
  （未明确回复，按默认）
- 已定技术栈：Tauri 2（只 macOS）；前端 React +
  TypeScript + Vite；终端 xterm.js + Rust
  `portable-pty`；UI 用 Radix / shadcn 一类组件库；
  持久化本地 JSON；包管理 bun；git 用本机 PATH，
  不内嵌。前端跑在 Tauri 2 WebView 内。
- 正式产品名未定。窗标题临时用「工作树编排」。
- 仓库路径（已定）：本机
  `/Users/ricolee/Desktop/rico/octopus`。
  产品文档在本仓库 `docs/`，跟着 git 跟踪。

## 4. 对象

### 4.1 Project

字段：

- `id`：应用生成。
- `name`：默认用仓目录名，可在添加后保持不变（MVP
  不提供重命名 UI）。
- `rootPath`：主 checkout 绝对路径。
- `defaultBranch`：添加时读取，例如 `main`。

校验：`rootPath` 必须是 git 工作树根（
`git rev-parse --show-toplevel` 等于该路径）。同一
`rootPath` 不能加两次。

### 4.2 Worktree

字段：

- `id`：应用生成。
- `projectId`
- `displayName`：用户填写。
- `branchName`
- `startFrom`：创建时的起始 ref（完整本地分支名）。
- `path`：绝对路径。
- `origin`：`app`（本应用创建）或 `imported`。
- `status`：`creating` / `ready` / `error`。

主 checkout 在侧栏单独展示，不当作可删任务
Worktree。删除主仓不走「删除工作树」。

### 4.3 终端

不是可配置对象。每个 ready 的 Worktree 最多一个
PTY。无 Agent 字段。

## 5. 默认路径（非产品功能）

无设置项、无「更改目录」按钮。实现写死：

```text
{主仓父目录}/{仓目录名}-worktrees/{slug}
```

例：主仓 `/Users/star/code/acme`，显示名「修登录」，
slug `xiu-deng-lu`（见下），路径为
`/Users/star/code/acme-worktrees/xiu-deng-lu`。

slug：显示名经 NFC 规范化后，空白与非字母数字汉字
换成单个 `-`，去掉首尾 `-`。若为空则用 `wt`。若目标
路径已存在：创建失败并提示，不自动改名。

实现可在需要时 `mkdir -p` 父目录
`{仓目录名}-worktrees`。不要把该根做成可配置产品。

## 6. 界面

中文。单窗三区：左 Project / Worktree；中终端；右只读
diff（可折叠，默认打开）。

侧栏文案：

- 添加项目
- 新建工作树
- 删除工作树
- 在 Cursor 中打开
- 在访达中显示
- 主工作区（主 checkout 那一行）

创建对话框字段：

- 显示名（必填）
- 分支名（选填，空则用 slug）
- 起始分支（选填，默认 Project.defaultBranch）。
  已定：只列出本地分支；不自动 `git fetch`；
  不提供远程跟踪分支或 SHA 的单独 UI。

无 Agent 下拉。无「高权限」勾选。无路径输入框。

MVP 无设置页。

## 7. 主流程

### 7.1 添加项目

1. 系统文件夹对话框，用户选目录。
2. 确认安装了 `git`。
3. 解析 toplevel；失败则提示「这不是 git 仓库」。
4. 读默认分支：先
   `git symbolic-ref refs/remotes/origin/HEAD`，失败则
   `git branch --show-current`，再失败则 `main` 并在
   UI 提示「未读到默认分支，已用 main」。
5. 持久化 Project。
6. 必须跑 `git worktree list --porcelain`。除主仓外
   的条目列在确认列表，供用户勾选导入。此步是添加
   项目的必做流程，不是可选项；用户可以一个都不勾。

### 7.2 新建工作树

1. 计算 slug、path、branchName。
2. `status = creating`。
3. 在主仓执行：

   ```text
   git worktree add -b <branchName> <path> <startFrom>
   ```

4. 成功：`status = ready`，聚焦该行，打开 PTY。
5. 失败：`status = error`，展示 git stderr；允许重试
   或放弃（放弃不留半成品目录；若 git 已建出目录，
   调用 `git worktree remove --force` 尽力清理）。

已定：不执行 `git fetch`。`startFrom` 只来自本地
分支。不安装依赖。不复制 `.env`。
（依赖项未明确回复，按默认）

### 7.3 使用终端

选中 ready 的 Worktree 时：

- 若无 PTY 或已退出：自动开一个登录壳，cwd=`path`。
- 用户自行输入命令，包括任何 agent CLI。
- 进程退出后主区显示「终端已结束」和按钮
  「重新打开终端」。

应用退出时杀掉全部 PTY。下次不恢复终端历史。

### 7.4 只读 diff

对当前 Worktree 在其 `path` 下执行：

```text
git diff <startFrom>
```

展示纯文本 unified diff。无文件可为空态
「与起始分支没有差异」。不支持暂存、hunk 选择、
写评论。刷新：切回该树或点「刷新差异」。

### 7.5 在 Cursor 中打开

对当前路径：

1. 若 PATH 中有 `cursor`，执行 `cursor <path>`。
2. 否则 `open -a Cursor <path>`。
3. 都失败：提示「打不开 Cursor，请确认已安装」。

不把本应用做成 Cursor 扩展，不要求登录 Cursor。

### 7.6 在访达中显示

`open <path>`。

### 7.7 删除工作树

1. 确认对话框。文案说明：将删除磁盘上的工作树目录。
   让用户选择要不要同时删除对应 git 分支（例如勾选
   「同时删除本地分支」）。已定：不是静默删分支，
   也不是永远不删分支。
2. 先结束该树 PTY。
3. `git worktree remove <path>`（在主仓执行）。
4. 若因未提交改动失败：展示 stderr，提供
   「强制删除」二次确认，对应
   `git worktree remove --force`。
5. 工作树目录去掉后：若用户选择了同时删分支，再
   删除该本地分支；失败则展示 git stderr，不回滚
   已删除的工作树。
6. 从侧栏和本地元数据去掉该条。

禁止对主 checkout 走此流程。移除 Project：只从本应用
忘掉该仓，不删磁盘上的 git 数据；若仍有本应用创建的
worktree，先提示去删除或保留（保留则只取消登记）。

### 7.8 启动恢复

读取本地元数据。对每个 Project：路径不存在则标
「路径丢失」，不自动删。跑 `git worktree list`：

- 元数据有、磁盘无：标丢失，可「从列表移除」。
- 磁盘有、元数据无：不自动出现，除非用户再次导入。

## 8. 持久化

已定：本地 JSON。存 Project 与 Worktree 字段，不存
终端缓冲、不存 diff 缓存为产品数据。路径用绝对路径。
不做 SQLite。

## 9. 错误原则

- 所有 git / 打开外部 App 的失败都把可复制的 stderr
  或系统错误展示给用户。
- 不静默改盘。创建失败要尽力清理半成品。
- 并发：同一 Project 同时只能有一个创建任务；重复点
  `+` 在进行中时忽略或禁用按钮。

## 10. 验收

1. 添加一个真实本地仓，侧栏出现项目和主工作区。
2. 新建两个工作树，磁盘上出现两个 `git worktree`，
   路径符合第 5 节规则。
3. 每个工作树终端 cwd 正确，可执行 `pwd` 与 `git
   status`。
4. 在终端里手动开任意 CLI 时，应用不插入额外参数。
5. 改一个文件后，diff 区相对 start-from 能看到变更。
6. 「在访达中显示」打开正确文件夹。
7. Cursor 已安装时「在 Cursor 中打开」打开该路径。
8. 删除工作树后目录消失。确认时未选择删分支则本地
    分支仍在；选择了则对应分支也被删除。
9. 退出再打开，项目与仍存在的工作树还在。
10. UI 可见文案为中文。
11. 无设置项可改 worktree 根目录；无 Agent 名单。
12. 添加含已有 worktree 的仓时，出现勾选导入列表。
13. 新建工作树的起始分支只有本地分支，不发起 fetch。

## 11. 以后再说

下列不在 MVP，实现时不要顺手做：分屏、多 PTY、
agent 状态、PR、SSH、`.env` 钩子、目录设置、
Windows / Linux。
