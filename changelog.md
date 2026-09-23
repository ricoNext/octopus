# 更新日志

所有重要变更都会记录在这里。

## [0.1.17] - 2026-09-23

### 变更
- docs: 同步分屏、Agents 面板与刷新工作树到 README (227e1f8)
- chore: 忽略 .superpowers 工作目录 (ac2b18b)
- fix(agents): keep presence across app relaunch (986f23c)
- fix(agents): hydrate presence list on app relaunch (429d8cf)
- chore(right-rail): remove unused files and git placeholders (c4963a4)
- fix(agents): use single BSD ps -o format string on macOS (74c3a72)
- fix(agents): replace stale terminal daemon lacking presence protocol (ac921c9)
- feat(agents): FE presence store, Agents rail module, click-to-focus (1125433)
- feat(agents): daemon presence poll and agent-presence bridge (a13485f)
- feat(agents): rust whitelist match and process-tree helpers (3870da8)
- docs: Agents right-rail Phase 1 implementation plan (008400c)
- docs: Agents right-rail Phase 1 design (daemon process poll) (9893ee9)

## [0.1.16] - 2026-09-23

### 变更
- feat(worktrees): 新增刷新项目工作树功能 (20ee570)
- feat(terminal): phase 0–1 warm retain caps and metrics (871c6a6)
- docs: add terminal parking / warm-retain design (Orca-lite) (73b19d3)

## [0.1.15] - 2026-09-22

### 变更
- feat(right-rail): 新增右侧面板框架与终端渲染优化 (81afd29)

## [0.1.14] - 2026-09-22

### 变更
- feat(terminal): 新增窗格标题栏分屏关闭操作与 PTY 事件总线 (4d827bd)
- docs(terminal): mark multi-pane plan implemented (2a1b017)
- fix(terminal): avoid remounting PaneManager on onChange identity (7fbb199)
- feat(terminal): wire multi-pane workspace and shortcuts (24f4854)
- fix(terminal): remount panes on layout sync and keep all leaves attached (901c52e)
- feat(terminal): add imperative PaneManager for multi-pane xterm (5fa0666)
- feat(terminal): add keybinding matcher for pane shortcuts (3368ec1)
- feat(terminal): persist v2 tab layout shape with single-leaf parity (a02a52f)
- feat(terminal): add TerminalTab v2 model and v1 migration (9eeb762)
- feat(terminal): add pane layout tree helpers and vitest (b87b1a1)

## [未发布]

### 新增
- feat(terminal): 终端 tab 内多 pane 分屏支持
  - 同一 tab 内支持左右/上下任意二叉分屏
  - 快捷键：⌘T 新建 tab、⌘D 向右分屏、⌘⇧D 向下分屏、⌘W 关闭 pane、⌘] 切换焦点
  - 拖拽分隔条调整比例，刷新后保持布局
  - 每个 pane 独立 PTY 和 xterm 实例
  - v1 数据自动迁移，保持现有 session 连续性

## [0.1.13] - 2026-09-21

### 变更
- fix(ci): inject Tauri signing secrets into macOS build workflow (4284129)

## [0.1.12] - 2026-09-21

### 变更
- chore(release): add temporary handling for Tauri signing keys in workflow (3a7053a)

## [0.1.11] - 2026-09-21

### 变更
- chore(release): ensure environment variables for Tauri signing are set at job level (2279d3a)

## [0.1.10] - 2026-09-21

### 变更
- fix(updater): update public key in tauri configuration (da63eab)
- chore(release): add TAURI_SIGNING_PRIVATE_KEY_PASSWORD to release workflow (762728e)

## [0.1.9] - 2026-09-21

### 变更
- chore(release): remove unused TAURI_SIGNING_PRIVATE_KEY_PASSWORD from release workflow (08623a3)
- chore(cleanup): remove unused slugify functions and dependencies from paths.rs, update .gitignore to include .workbuddy directory (d644217)

## [0.1.8] - 2026-09-21

### 变更
- chore(docs): refine README formatting by removing unnecessary link and adjusting logo alignment (ddcc0f4)
- chore(docs): update README with new logo and improve formatting (9980294)
- chore(docs): enhance README formatting and emphasize application name (067711e)
- fix(updater): correct formatting of public key in tauri configuration (c05af70)
- chore(docs): update README to reflect supported platform changes and remove unnecessary badges (0948c64)

## [0.1.7] - 2026-09-21

### 变更
- chore(docs): update README layout and add badges for GitHub stars, downloads, license, and community links (23d4c09)
- ci(release): 缺少签名私钥时提前失败并给出配置指引 (7549ae6)

## [0.1.6] - 2026-09-21

### 变更
- fix(updater): update public key for the updater plugin in tauri configuration (1cd7abe)
- feat(updater): 应用内版本更新能力 (8916313)

## [0.1.5] - 2026-09-21

### 变更
- refactor(build): simplify version retrieval in macOS workflow by removing redundant step (205fd8c)

## [0.1.4] - 2026-09-21

### 变更
- refactor(release): update macOS build workflow to trigger on version tags and streamline release process (aafb19b)
- feat(editor): 添加默认编辑器设置功能，更新相关文档和界面 (a4513dd)
- Update README.md (047246b)
- chore(release): v0.1.3 (886bf32)
- feat(branches): 支持远程与最近分支选择及主分支切换 (2e5a3a3)

## [0.1.3] - 2026-09-21

### 变更
- feat(branches): 支持远程与最近分支选择及主分支切换 (2e5a3a3)
- chore(release): v0.1.2 (6dcbce7)
- feat(release): 版本变更时自动创建 GitHub Release 并上传构建产物 (66f5b4b)
- chore(release): v0.1.1 (a985558)
- feat(release): 新增版本发布脚本与 macOS GitHub Actions 构建 (a403344)
- chore: 从版本库取消跟踪 docs 与 design 目录 (6a9d44b)
- chore: 忽略 docs 与 design 目录并移除设计素材 (79ee90e)
- feat(terminal): 实现终端会话持久化架构并更新界面与图标 (1a372a7)
- feat: 实现 macOS 工作树编排 MVP (8fbd4ce)
- 将 Tauri、React、Vite 与 bun 技术栈写入规格 (183105f)
- 将删除分支、导入工作树、起始分支三条规格标为已定 (ac57459)
- 将产品文档改为由仓库 docs 目录随 git 跟踪 (152dcbc)
- 将产品设计文档放入仓库 docs 目录 (2993be3)
- first commit (a072185)

## [0.1.2] - 2026-09-20

### 变更
- feat(release): 版本变更时自动创建 GitHub Release 并上传构建产物 (66f5b4b)
- chore(release): v0.1.1 (a985558)
- feat(release): 新增版本发布脚本与 macOS GitHub Actions 构建 (a403344)
- chore: 从版本库取消跟踪 docs 与 design 目录 (6a9d44b)
- chore: 忽略 docs 与 design 目录并移除设计素材 (79ee90e)
- feat(terminal): 实现终端会话持久化架构并更新界面与图标 (1a372a7)
- feat: 实现 macOS 工作树编排 MVP (8fbd4ce)
- 将 Tauri、React、Vite 与 bun 技术栈写入规格 (183105f)
- 将删除分支、导入工作树、起始分支三条规格标为已定 (ac57459)
- 将产品文档改为由仓库 docs 目录随 git 跟踪 (152dcbc)
- 将产品设计文档放入仓库 docs 目录 (2993be3)
- first commit (a072185)

## [0.1.1] - 2026-09-20

### 变更
- feat(release): 新增版本发布脚本与 macOS GitHub Actions 构建 (a403344)
- chore: 从版本库取消跟踪 docs 与 design 目录 (6a9d44b)
- chore: 忽略 docs 与 design 目录并移除设计素材 (79ee90e)
- feat(terminal): 实现终端会话持久化架构并更新界面与图标 (1a372a7)
- feat: 实现 macOS 工作树编排 MVP (8fbd4ce)
- 将 Tauri、React、Vite 与 bun 技术栈写入规格 (183105f)
- 将删除分支、导入工作树、起始分支三条规格标为已定 (ac57459)
- 将产品文档改为由仓库 docs 目录随 git 跟踪 (152dcbc)
- 将产品设计文档放入仓库 docs 目录 (2993be3)
- first commit (a072185)

## [0.1.0] - 2026-09-20

### 变更

- 初始版本。
