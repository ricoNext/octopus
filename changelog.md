# 更新日志

所有重要变更都会记录在这里。

## [0.1.19] - 2026-10-10

### 变更
- fix(files): hydrate guard, save safety, write size cap for Monaco editor (aa4ee4a)
- docs: Monaco file editor acceptance checklist (449e74b)
- fix(files): block batch tab close when file tabs dirty (cb0e22d)
- feat(files): dirty marker, explicit save, close confirm for Monaco tabs (371a3f3)
- feat(files): FileEditor Monaco host with save + language (2d01e6e)
- feat(files): map relPath extension to Monaco language (1d77871)
- feat(fs): path-jailed write_text_file for Monaco save (a41462f)
- docs: Monaco file editor implementation plan (4fe5fa4)
- docs: Monaco editable file-tab design (ccd509b)
- fix(files): drop duplicate filename in FilePreview body (47ddfd1)
- feat(files): FilePreview polish for center file tabs (2f50ada)
- feat(files): unified center tabs for file preview (753287a)
- feat(tabs): CenterTab model and migrate helpers (581f1ac)
- docs(plan): unified center tabs for file preview (f60ee7a)
- docs(spec): unified center tabs for file preview (7baed3f)
- feat(files): full-bleed FilePreview for sibling tab surface (7f2371a)
- feat(files): preview as sibling center tab chip (b410ecf)
- docs(plan): files preview sibling center tab (cc9ffbe)
- docs(spec): files preview as sibling center tab (4e7e95a)
- feat(files): center FilePreview + terminal|preview split (4b2684a)
- feat(files): virtualized Files right-rail module (b2d725a)
- feat(files): tree model helpers and react-virtual dep (3bf34e6)
- feat(fs): expose fs_read_dir and fs_read_text_file to FE (0926b0c)
- feat(fs): read_text_file with size and binary checks (b8c3d8d)
- feat(fs): path jail and read_dir entries (4ff31bf)
- docs(plan): files right-rail + center text preview Phase 1 (ae6faaa)
- docs(spec): files right-rail + center text preview Phase 1 (38873f8)
- style(sidebar): emphasize project names over branch rows (88e6816)
- docs(spec): sidebar project vs row typography hierarchy (132dd76)
- feat(dep-link): sidebar multi-path link/relink/unlink UX (9f3dbf2)
- feat(dep-link): create dialog multi-select package link (bf93507)
- feat(dep-link): scan and batch link/unlink tauri commands (3ff5226)
- feat(dep-link): hydrate recorded relPaths only with migration (74b9a67)
- feat(dep-link): relPath link/unlink primitives and batch helpers (34df11b)
- feat(dep-link): DepLinkEntry links[] migration and aggregate status (a1e10cd)
- feat(dep-link): scan package-level node_modules with depth/cap (91f6d01)
- docs(plan): monorepo node_modules multi-path implementation plan (c19dbdd)
- docs(spec): monorepo node_modules multi-path link design (e0f9e45)
- fix(dep-link): label based-on main repo with current branch (8a1d11a)
- fix(dep-link): preserve checkbox choice and linkedFrom on hydrate (51043d9)
- feat(dep-link): sidebar linked/broken status icons (d25025d)
- feat(dep-link): sidebar link/relink/unlink menus and confirms (d44d5f6)
- feat(dep-link): create-dialog checkbox and post-create link (cf82c2b)
- feat(dep-link): persist basedOnPath and depLink on worktrees (cf164e6)
- feat(dep-link): tauri link/unlink/status commands and FE api (0320c6f)
- feat(dep-link): pure node_modules symlink helpers and tests (e21a1a7)
- docs: worktree node_modules symlink implementation plan (b892222)
- docs: worktree node_modules symlink design (b2a6a9f)

## [0.1.18] - 2026-09-23

### 变更
- chore(release): v0.1.17 (7984f0b)
- Update README.md (85333f2)
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
