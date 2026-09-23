<h1 align="center">
  <img
    src="https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260921162734301.png"
    alt="octopus"
    width="64"
    valign="middle"
    height="64">
  octopus
</h1>

<p align="center">
  <a href="https://github.com/ricoNext/octopus"><img src="https://img.shields.io/github/stars/ricoNext/octopus?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars" /></a>

  <img src="https://img.shields.io/badge/macOS-4493F8?style=flat-square" alt="Supported platform: macOS" />
</p>

[友情链接：linux](https://linux.do)

octopus 是面向 macOS 的 Git Worktree 编排桌面应用。它把本地 Git 仓库、主工作区和多个真实 `git worktree` 集中到一个窗口里管理，每个工作区都有可恢复、可分屏的内嵌终端，右侧面板还能实时查看各终端里运行中的 AI Agent。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260921135740826.png)

## 运行环境

- macOS 12 或更高版本，目前优先支持 Apple Silicon
- 本机 `PATH` 中可执行的 `git`
- 若要使用「在编辑器中打开」，请先到设置中选择已安装的默认编辑器；访达为系统自带

## 安装

从 [GitHub Releases](https://github.com/ricoNext/octopus/releases) 下载最新 `.dmg`，把应用拖进「应用程序」后打开。

当前安装包默认未签名。若系统提示无法验证开发者，

Intel 系统：在访达中右键打开，或到「系统设置 → 隐私与安全性」中允许本次打开。

Apple Silicon 系统：在终端中运行：  

```shell
sudo xattr -dr com.apple.quarantine /Applications/octopus.app

```

## 使用

### 添加项目与导入已有工作树

侧栏「项目」旁点加号，用系统目录选择器选一个本地 Git 仓库。添加时会检查 Git、识别仓库根目录和默认分支。

如果仓库已经有通过 `git worktree` 创建的关联工作树，应用会列出它们。勾选需要在侧栏管理的条目后再添加项目；不勾选也可以只登记主工作区。导入只写入 octopus 的本机记录，不会移动、修改或重新创建已有工作树。

后续你在仓库里直接用 `git worktree` 新增或删除了工作树时，可以在项目菜单中点「刷新列表」重新对账：应用会移除磁盘上已消失的工作树记录，并导入新出现的关联工作树。

### 浏览与切换分支

每个项目的主工作区条目旁有分支菜单，按「最近」「本地」「远端」分组展示可用分支。对任一分支可执行以下操作：

- 切换主工作区到该分支
- 以该分支为起点新建工作树

切换本地分支时会执行 `git switch <分支>`。选择远端分支时，若对应的本地分支已存在则切换到本地分支；否则执行 `git switch --track <远端分支>` 创建跟踪分支。Git 对未提交改动、冲突或工作区状态的保护规则仍然生效，无法切换时会显示 Git 返回的错误。

分支列表读取的是本地已有的引用，应用不会自动执行 `git fetch`；需要最新远端分支时，请先在终端或其他 Git 工具中 fetch。

### 创建工作树

在项目旁点加号，填写显示名、起始分支，以及工作树父目录。也可以从分支菜单中选择「以此分支为起点新建工作树」，直接带入最近、本地或远端分支。

显示名同时作为新分支名。只能用 ASCII 字母、数字、`/`、`-`、`_` 和 `.`，不能用中文，也不能包含非法路径片段。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260921135849607.png)

普通创建窗口会列出并支持搜索本地分支；从分支菜单发起时也支持以远端跟踪分支为起点。起始分支必须已存在于本地引用或远端跟踪引用中。

默认父目录是：

```text
~/.octopus/worktree/<主仓库目录名>
```

例如主仓库为 `/Users/example/code/octopus`，默认父目录为：

```text
/Users/example/.octopus/worktree/octopus
```

最终路径是 `父目录/<显示名>`。创建时会执行：

```text
git worktree add -b <分支名> <工作树路径> <起始分支>
```

应用不会自动执行 `git fetch`、安装依赖或复制 `.env`。

创建失败时可以查看错误、重试或放弃。工作树路径丢失时，可从列表清理记录。

### 使用终端

选中主工作区或已就绪的工作树后，右侧会打开登录 Shell，当前目录固定在对应路径。路径丢失或工作树尚未就绪时，不会打开终端。

- 顶部可以新建、切换、关闭终端标签
- 每个项目或工作树至少保留一个标签
- `⌘D` 向右分屏、`⇧⌘D` 向下分屏；拖动分隔条可调整比例，分屏标题栏上有单独的关闭按钮
- 右键标签可以重命名，或关闭当前、其他、左侧、右侧标签
- 标签名、分屏布局、当前选择和活动标签会保存在本机；重启后会尝试恢复仍存在的会话
- 终端进程退出后可以重新打开

终端按 Unicode 11 计算字符宽度，中文、emoji 和制表符的显示与原生终端一致；PTY 默认开启 truecolor，明暗主题跟随应用设置。

### 右侧面板与 Agents

窗口右侧有一个可折叠、可拖拽调宽的面板，顶部活动栏负责切换面板模块。

- **Agents**：实时列出各内嵌终端会话中运行中的 AI Agent（目前支持识别 Codex 和 CodeBuddy 进程），显示所属项目、分支和所在终端标签
- 点击某个 Agent 条目，会自动切换到它所在的终端标签
- Agent 退出后条目自动消失；应用重启后会重新连接守护进程，仍在运行的 Agent 会继续显示

### 打开外部工具

侧栏每一项的菜单里可以：

- 在编辑器中打开该路径
- 在访达中显示该路径

### 删除工作树

删除前会确认，并可选择是否同时删除本地分支。工作区里还有未提交改动时，普通删除会失败，需要二次确认强制删除；强制删除会丢掉该工作树目录中的未提交内容。

### 取消登记项目

取消登记只从 octopus 忘掉这个仓库，不会删除磁盘上的 Git 数据。如果项目下还有本应用创建的工作树，会先要求确认；若要删掉工作树，请先逐个删除。

### 侧栏与外观

- 侧栏可以折叠，也可以拖拽或用方向键调整宽度
- 快捷键 `⌘B` / `Ctrl+B` 折叠或展开侧栏
- 底部「设置」里可选浅色、深色或跟随系统，也可以从支持列表中选择默认编辑器

## 数据与状态

- 项目和工作树元数据保存在应用数据目录的 `state.json` 中，一般位于 `~/Library/Application Support/dev.octopus.app/`
- 终端会话由常驻的终端守护进程管理；应用重启后会重新连接守护进程并恢复会话与 Agent 状态
- 启动时会重新读取 `git worktree list --porcelain`，把创建状态和磁盘实际状态对账
- 仓库或工作树目录被外部删除后，界面会标记为「路径丢失」，不会自动删除记录
- 删除工作树或项目时，会结束对应的终端会话

## 当前范围

octopus 是本机单用户工具，目前不包含：

- Windows、Linux、远程主机或 SSH 工作树
- 内嵌编辑器、文件树、LSP、调试器或浏览器
- 内置 Agent 启动器或模型网关（目前仅识别内嵌终端中的 Codex / CodeBuddy 进程）
- GitHub / GitLab、PR、Issue、CI 或账号系统
- 内嵌 diff 审查面板（当前主区域为终端工作区）
- 自动 fetch、依赖安装、环境初始化或共享 `node_modules`

后续逐步实现。
