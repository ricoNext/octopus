# octopus

octopus 是一个面向 macOS 的 Git Worktree 编排桌面应用。它把本地 Git 仓库、主工作区和多个真实 `git worktree` 集中到一个窗口中管理，并为每个工作区提供可恢复的内嵌终端。

当前应用窗口标题为「工作树编排」，产品名称仍可能调整。

## 当前功能

### 项目与工作树

- 通过系统目录选择器登记本地 Git 仓库。
- 添加仓库时自动检查 Git、识别仓库根目录和默认分支。
- 扫描已有的 `git worktree`，可在确认列表中选择要导入的工作树。
- 在本地分支基础上创建真实的 `git worktree`。
- 创建时可填写工作树显示名、选择起始本地分支，并自定义工作树父目录。
- 在侧栏查看主工作区、工作树分支、来源和创建状态。
- 创建失败时可查看错误、重试或放弃；工作树路径丢失时可从列表清理记录。
- 删除工作树前显示确认，可选择是否同时删除本地分支；工作区有未提交改动时支持二次确认强制删除。
- 取消登记项目只移除 octopus 的记录，不会删除仓库本身；如果项目仍有本应用创建的工作树，会先要求确认。

### 内嵌终端

- 主工作区和每个已就绪的工作树都可以打开登录 Shell，终端当前目录固定为对应目录。
- 基于 xterm.js 和 Rust `portable-pty`，支持终端输入、输出、尺寸自适应以及终端进程退出后的重新打开。
- 每个项目或工作树支持多个终端标签。
- 支持新建、关闭、重命名终端标签，以及关闭当前、其他、左侧或右侧标签。
- 终端标签、当前选择和活动标签会保存到本地，应用重启后尝试恢复仍存在的会话。

### 工作区与外部工具

- 可在 Cursor 中打开项目或工作树路径。
- 可在 Finder（访达）中显示路径。
- 侧栏支持折叠、拖拽或键盘调整宽度；项目列表支持单独折叠。
- 设置页支持浅色、深色和跟随系统三种主题。

## 技术栈

- 桌面容器：Tauri 2（当前仅支持 macOS）
- 前端：React 19、TypeScript、Vite
- UI：Tailwind CSS、Radix/shadcn 风格组件、Lucide 图标
- 终端：xterm.js、Rust `portable-pty`、独立 terminal daemon
- 数据：应用数据目录中的本地 JSON；前端布局、主题和终端标签偏好使用浏览器本地存储
- Git：调用本机 `PATH` 中的 `git`，不内置 Git 二进制
- 包管理：bun

## 环境要求

- macOS 12 或更高版本
- [bun](https://bun.sh/)
- Rust 与 Cargo
- Xcode Command Line Tools
- 本机 `PATH` 中可执行的 `git`
- 若要使用外部打开功能，需要安装 Cursor；Finder 为 macOS 系统自带

Apple Silicon 优先，当前未配置 Windows 或 Linux 构建目标。

## 本地开发

在仓库根目录执行：

```bash
bun install
bun run tauri:dev
```

`tauri:dev` 会启动 Vite 开发服务器并编译 Rust 后端。首次启动可能需要较长时间，成功后会打开「工作树编排」窗口。

### 常用命令

```bash
# 仅启动前端开发服务器
bun run dev

# 类型检查并构建前端生产包
bun run build

# 预览前端生产构建
bun run preview

# 查看 Tauri CLI 命令
bun run tauri --help
```

## 发布流程

发布前请确认工作区干净，并在当前分支执行版本发布命令：

```bash
# 自动递增 patch 版本，也支持 minor、major 或完整版本号（例如 1.2.3）
bun run release -- patch
```

该命令会同步更新 `package.json`、`src-tauri/tauri.conf.json`、
`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 的版本号，在 `changelog.md` 顶部生成本次变更记录，
然后创建发布提交并推送当前分支到 `origin`。推送后创建 Pull Request，合并到
`main` 分支即可触发 GitHub Actions。

合并到 `main` 后，`.github/workflows/build-macos.yml` 会在 macOS runner 上安装
Bun 和 Rust，构建 Tauri 的 `.dmg` 与 `.app`，并将它们作为 Actions 构件上传。该
工作流默认生成未签名安装包；如果需要分发给其他用户，还需要补充 Apple Developer
签名和公证所需的仓库密钥。

## 工作树路径规则

新建工作树时，默认父目录为：

```text
~/.octopus/worktree/<主仓库目录名>
```

例如主仓库为 `/Users/example/code/octopus`，默认父目录为：

```text
/Users/example/.octopus/worktree/octopus
```

最终工作树路径是 `父目录/<显示名>`。显示名同时作为新分支名，当前只允许 ASCII 字母、数字、`/`、`-`、`_` 和 `.`，并拒绝非法路径片段。创建过程使用本机 Git 执行：

```text
git worktree add -b <分支名> <工作树路径> <起始本地分支>
```

应用不会自动执行 `git fetch`、安装依赖或复制 `.env`。

## 数据与恢复

- 项目和工作树元数据保存在 Tauri 应用数据目录的 `state.json` 中。
- 启动时会重新读取 `git worktree list --porcelain`，将创建状态与磁盘实际状态对账。
- 仓库或工作树目录被外部删除后，界面会标记为「路径丢失」，不会自动删除记录。
- 终端 daemon 使用应用数据目录中的 Unix socket 和令牌文件；删除工作树或项目时会结束对应终端会话。

## 当前范围与限制

octopus 目前是本机单用户工具，不包含以下能力：

- Windows、Linux、远程主机或 SSH 工作树
- 内嵌编辑器、文件树、LSP、调试器或浏览器
- 内置 Agent 启动器、Agent 状态识别和模型网关
- GitHub/GitLab、PR、Issue、CI 或账号系统
- 内嵌 diff 审查面板（当前主区域为终端工作区）
- 自动 fetch、依赖安装、环境初始化或共享 `node_modules`

## 相关文档

- [项目上下文](docs/project-context.md)
- [产品设计](docs/product-design.md)
- [MVP 产品规格](docs/product-spec.md)
- [性能治理记录](docs/performance-governance.md)
- [终端会话持久化设计](docs/terminal-session-persistence-design.md)
