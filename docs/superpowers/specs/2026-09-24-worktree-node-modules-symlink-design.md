# Worktree 软链 `node_modules`

Date: 2026-09-24  
Status: approved  
Approach: **A** — symlink + remember `basedOnPath` + create checkbox + after-create menu

> Monorepo extension (Phase 1.5): see [2026-09-24-worktree-node-modules-monorepo-design.md](./2026-09-24-worktree-node-modules-monorepo-design.md).

## Goal

新建 git worktree 时目录里通常没有依赖。允许 worktree **B**（基于 **A** 创建）把 `node_modules` **软链**到 A（或同项目其它已有依赖的目录），避免在 B 再装一份。支持创建时勾选，也支持建好后补链 / 换源 / 取消链接。

## Product rules (locked)

| 项 | 决定 |
|---|---|
| 链接目标 | Phase 1 **仅** `node_modules` |
| 何时 | **创建时可勾选** + **创建后菜单补链 / 换源 / 取消** |
| 默认源 | **创建时所基于**的主仓或 worktree（`basedOnPath`） |
| 已有冲突 | **先询问再覆盖**（真目录或旧软链） |
| 取消 / 源消失 | **只解除软链**；不自动 `install` |
| 自动链 | 不做「创建时默认强制自动链」；有可用源时勾选可默认打开，用户可关掉 |

## Approach choice

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 软链 + basedOn + 创建勾选 + 事后菜单（采用）** | `symlink` 指向源 `node_modules`；元数据记源与状态 | 对上场景；实现面可控 |
| B. 仅创建时勾选 | 更少 UI | 不满足「事后也能链」 |
| C. 包管理器共享缓存 | pnpm store / bun cache 等 | Phase 1 过重；且不保证立刻有可用 `node_modules` |

## Data model

### Per-worktree metadata（持久化在项目侧已有 worktree 记录上）

```text
basedOnPath: string | null     // 创建时写入的「基于谁」绝对路径
depLink: {
  kind: "node_modules"
  status: "none" | "linked" | "broken"
  linkedFrom: string | null    // 源绝对路径（含 …/node_modules 的父目录，即源 worktree/主仓根）
  linkedAt: string | null      // ISO 时间，可选
} | null
```

- `basedOnPath`：创建 worktree 时由 UI/命令传入并保存；之后默认源优先用它。
- `depLink.status`：
  - `none`：目标无软链（可能也无真目录，或有本地真目录但未由本功能链接）
  - `linked`：目标 `node_modules` 是软链且解析成功
  - `broken`：目标是软链但解析失败（源被删等）

刷新 worktree 列表时用磁盘实况校正 `status`（以文件系统为准，元数据为辅）。

### Link semantics

1. 源：`{sourceRoot}/node_modules` 必须存在，且最终解析为**目录**（允许源本身是指向真实目录的软链）。
2. 目标：在 `{targetRoot}/node_modules` 创建软链 → 源的 `node_modules`。
3. 范围：源与目标必须同属**当前 git 项目**（主仓 + 已登记 worktree）；拒绝项目外路径。
4. 覆盖：`force=false` 且目标已存在（文件/目录/软链任一）→ 返回需确认错误；`force=true` → 先移除目标再链。
5. 取消链接：仅当目标是软链时 `unlink`；若是真目录 → 不提供「取消链接」，或提示「本地安装，不是软链」。
6. 不做自动 `npm` / `pnpm` / `yarn` / `bun install`。

## UI

### Create worktree dialog

- 现有字段下增加勾选：**链接源的 `node_modules`**。
- 若 `basedOn` 存在且有可用 `node_modules` → 勾选**默认打开**；否则不勾且**禁用**，旁注「源尚无 node_modules」。
- 勾选旁一行小字：源标识（分支名或相对路径缩写）。
- 顺序：先 `git worktree add`（现有 `create_worktree`）成功 → 若勾选再调 `link_*`。链接失败**不回滚** worktree，toast 说明原因；用户可稍后菜单补链。

### Sidebar worktree row menu

| 项 | 何时显示 | 行为 |
|---|---|---|
| 链接 node_modules… | `none` / `broken`，或无软链 | 小面板选源；默认 `basedOn`；列表仅「同项目且有可用 node_modules」的主仓/worktree |
| 重新链接… | `linked` | 同上；换源前走覆盖确认 |
| 取消链接 | 目标当前是软链 | 确认后 unlink；不安装 |

行上轻量状态图标：`linked` / `broken`（不强加长文案）。

### Overwrite confirm

- 文案区分「将删除现有真实 `node_modules`」vs「将替换现有软链」。
- 按钮：取消 / 覆盖并链接。

## Architecture

### Backend (Tauri / Rust)

新命令（名称可微调）：

| Command | 作用 |
|---|---|
| `link_worktree_node_modules { targetPath, sourcePath, force }` | 校验同项目 → 检查源 → 按 force 处理冲突 → `symlink` |
| `unlink_worktree_node_modules { targetPath }` | 仅当目标为软链时 unlink |
| `get_worktree_dep_link_status { paths[] }` | 批量：是否软链、解析目标、`linked` / `broken` / `none` |

创建：`create_worktree` **保持只做 git**；FE 在成功后按勾选调用 `link_*`，并写入 `basedOnPath`。

安全：路径规范化后必须落在主仓或其已登记 worktree 根之下；禁止 `..` 逃逸到项目外。

### Frontend

- 创建对话框勾选与禁用逻辑。
- 侧栏菜单 + 源选择 + 覆盖确认。
- 刷新 worktree 时顺带拉 link status，更新图标与菜单项。

### Parking / Agents / 其它

本功能不触及 PTY、Agents、右栏；仅项目侧栏与 worktree 元数据。

## Out of scope (Phase 1)

- `.venv` / `venv` / `vendor` 及其它依赖目录
- 包管理器共享缓存策略
- 跨项目链接
- 删除源 worktree 时级联通知所有链向它的目标（仅刷新时标 `broken`）
- Windows junction / 权限特判（本机主路径为 macOS；若后续要支持再补）
- 自动检测 lockfile 分叉并警告（可 Phase 2）

## Acceptance

1. 基于有 `node_modules` 的 A 创建 B 并勾选 → B 下为指向 A 的软链，可直接跑脚本/dev。
2. 未勾选创建 → B 无 `node_modules`；事后菜单可补链到 A（或其它有依赖的同项目源）。
3. B 已有真目录或旧软链 → 必须确认后才能覆盖。
4. 取消链接 → 软链消失；无自动安装。
5. 删除 A（或移走其 `node_modules`）后刷新 → B 显示 `broken`；可取消链接或换源重链。
6. 试图链到项目外路径 → 后端拒绝。

## Implementation notes (non-binding)

- 软链可用绝对路径，避免 worktree 相对位移带来的困惑；若团队更偏好相对路径可在实现时二选一并写进计划。
- `basedOnPath` 在「从主仓创建」时为主仓根；「从某 worktree 上下文创建」时为该 worktree 根（与当前创建入口一致即可）。
