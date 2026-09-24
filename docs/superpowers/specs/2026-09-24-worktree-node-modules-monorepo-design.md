# Worktree 软链 `node_modules` — Monorepo 多路径扩展（Phase 1.5）

Date: 2026-09-24  
Status: approved  
Approach: **A** — batch multi-path symlinks；扩展 `depLink` 为 per-`relPath` 链接列表  
Parent: [Phase 1 单路径设计](./2026-09-24-worktree-node-modules-symlink-design.md)

## Goal

Phase 1 只把目标 worktree 根下的单个 `node_modules` 软链到源。Monorepo 下根与各 package 常各自有一份 `node_modules`。扩展为：用户从源 worktree/主仓扫描到的 **package 级** `node_modules` 中多选，再对每个相对路径批量软链到目标；创建时可勾选，创建后侧栏可补链 / 换源 / 取消。不解析 workspace 配置文件，不强制「全量镜像」。

## Product rules (locked)

| 项 | 决定 |
|---|---|
| 结构 | 根 **与** packages 均可各有 `node_modules` |
| 选择 | 用户挑选 packages；**不**强制无 UI 的 mirror-all |
| 何时 | **创建时** + **创建后侧栏**均可挑选 |
| 默认选中 | 扫描命中的全部可用 package 级源路径 |
| 发现 | 扫描源树中已存在的 `node_modules` 目录；**不**解析 workspace yaml/json |
| 范围 | **跳过嵌套**：永不进入任一 `node_modules`；只认 package 级（根 + packages/apps 等） |
| 方案 | **Approach A**：批量多路径软链；`depLink` 扩展为 per-`relPath` |
| 冲突 | 冲突路径需确认；产品默认 **一次确认覆盖全部冲突路径** 后 force 重试 |
| 取消 | 仅 unlink 本功能创建的软链；真目录跳过并提示 |
| 项目边界 | 与 Phase 1 相同（主仓 + 已登记 worktree） |

## Approach choice

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 批量多路径软链 + per-relPath 元数据（采用）** | 扫描 package 级源 → 用户多选 → 对每个 `relPath` 建 `{target}/{rel}/node_modules` → `{source}/{rel}/node_modules` | 对上 monorepo；与 Phase 1 语义一致 |
| B. 强制全量镜像无 UI | 源上有的全部链到目标 | 用户无法排除不需要的 package |
| C. 解析 pnpm-workspace / package.json workspaces | 从配置推 package 列表 | 配置格式多、易漏；本阶段明确不做 |

## Data model

### Per-worktree metadata（在 Phase 1 字段上扩展）

```text
basedOnPath: string | null
depLink: {
  kind: "node_modules"
  // 行级聚合：any broken → broken；else any linked → linked；else none
  status: "none" | "linked" | "broken"
  linkedFrom: string | null   // 当前选中的源根（worktree/主仓）；与 Phase 1 兼容
  linkedAt: string | null
  links: [
    {
      relPath: string         // "" 或 "." = 根；其它如 "packages/foo"
      status: "none" | "linked" | "broken"
      linkedFrom: string | null  // 该路径实际链自的源根绝对路径（通常等于顶层 linkedFrom）
    }
  ]
} | null
```

### Migration（旧单路径 → 多路径）

- Phase 1 无 `links` 的旧记录：读时视为  
  `links: [{ relPath: "", status: <旧 status>, linkedFrom: <旧 linkedFrom> }]`  
  并写回（lazy migrate on hydrate / next write）。
- 根相对路径规范：对外与元数据统一用 `""`；扫描结果展示可用 `"."` 或「根」，写入前归一为 `""`。

### Aggregate status

| 条件 | 行级 `depLink.status` |
|---|---|
| 任一 `links[].status === "broken"` | `broken` |
| 否则任一 `linked` | `linked` |
| 否则 | `none` |

侧栏行图标只看聚合状态（与 Phase 1 一致）。

## Link semantics

1. **选源**：先选源 worktree/主仓根（默认 `basedOnPath`）；再扫描其下 package 级 `node_modules`。
2. **扫描命中**：每个命中给出相对路径 `relPath`（根为 `""`）。仅当 `{source}/{relPath}/node_modules` 存在且最终解析为**目录**时列入候选。
3. **用户选择**：多选 `relPath`（默认全选扫描命中）。创建与侧栏均如此。
4. **链接**：对每个选中项  
   `symlink {target}/{relPath}/node_modules → {source}/{relPath}/node_modules`（**绝对路径**）。  
   源必须存在且解析为目录。目标侧 `{target}/{relPath}` 应为仓库内已有路径（worktree checkout 已带 package 目录）；若父目录缺失则该路径链接失败并计入错误，不隐式 mkdir 整棵包树。
5. **项目边界**：源与目标同属当前 git 项目；`relPath` 规范化后不得逃逸项目根（禁止 `..` 段）。
6. **覆盖**：任一选中路径上目标已存在（文件/目录/软链）且 `force=false` → 整批返回需确认，列出冲突数 N；用户一次确认后以 `force=true` 重试全部选中路径。`force=true` 时对冲突项先移除再链。
7. **取消链接**：仅 unlink 本功能记录在 `links` 中且目标当前为软链的路径；目标为真目录 → 跳过并 notice「本地安装，不是软链」。默认 unlink **该 worktree 上本功能创建的全部软链**（即全部 recorded linked 路径）。
8. **Hydrate**：只根据元数据中 **已记录的 `relPath`** 校正磁盘状态；**不**在每次 snapshot 做全树重扫。
9. 不做自动 `npm` / `pnpm` / `yarn` / `bun install`。

## Discovery rules

| 规则 | 值 |
|---|---|
| 起点 | 源 worktree/主仓根 |
| 深度上限 | **6**（从源根起的目录层级；根下直接 `node_modules` 深度计为 1） |
| 永不进入 | 名为 `node_modules` 的目录（命中后记录 `relPath` 并跳过其子树） |
| 其它跳过 | 必跳 `.git`（及同级 VCS 元数据若遇到）；其余噪音目录（如 `dist` / `build` / `.next`）可由实现追加，不改变「只认 package 级 node_modules」语义 |
| 软上限 | 候选列表最多 **50** 条；超出则截断并 UI notice「已截断，仅显示前 50 个」 |
| 不解析 | `pnpm-workspace.yaml`、`package.json` workspaces、`lerna.json`、`nx.json` 等 |

## UI

### Create worktree dialog

- **总控勾选**：链接源的 `node_modules`（master checkbox）。
- **可展开多选列表**：扫描 basedOn 源得到的 package 级路径；默认全选；可取消个别项。
- 源标识一行小字（分支名或路径缩写，与 Phase 1 / `mainBranch` 标签一致）。
- 源无任何可用 `node_modules` → master 禁用并旁注；有则默认打开。
- 顺序：先 `create_worktree` 成功 → 若勾选再调 batch link（仅选中的 `relPath`）。链接失败不回滚 worktree。

### Sidebar link / relink

1. 选源（默认 `basedOnPath`；列表仅同项目且扫描后至少有一个可用 `node_modules` 的主仓/worktree）。
2. 多选 packages：  
   - **首次链接**：默认全选当前扫描命中。  
   - **重新链接**：默认选中「先前 `links` 中记录且仍在本次扫描中可用」的路径；其它命中可选加选。
3. 确认后 batch link；有冲突走覆盖确认。

### Sidebar unlink

- 默认：unlink 该 worktree 上本功能记录的全部软链路径。
- 真目录跳过 + notice；仅软链被移除。
- 可选后续增强「只取消部分 package」不在本阶段必做；本阶段默认全量 recorded unlink。

### Row icons

- 按聚合 `depLink.status` 显示 `linked` / `broken`（与 Phase 1 相同粒度）。

### Overwrite confirm

- 文案说明将覆盖 **N** 个冲突路径（区分含真实目录 vs 仅旧软链时可汇总一句）。
- 一次确认 → 全部冲突路径 force 重试。
- 按钮：取消 / 覆盖并链接。

## Architecture

### Backend (Tauri / Rust)

| Command | 作用 |
|---|---|
| `scan_worktree_node_modules { sourcePath }` | 按 Discovery rules 异步扫描；返回 `{ relPath }[]`（及截断标志） |
| `link_worktree_node_modules_batch { targetPath, sourcePath, relPaths[], force }` | 同项目校验 → 逐路径检查源 → 按 force 处理冲突 → 批量 symlink → 写回 `links` |
| `unlink_worktree_node_modules_batch { targetPath, relPaths[]? }` | 缺省 = 元数据中全部 recorded；仅 unlink 软链；写回 |
| Phase 1 单路径命令 | 可保留为 batch 的 `relPaths: [""]` 薄封装，或内部转发 batch |

- 扫描与 batch 在 Rust 侧异步跑完再返回；FE **一次 await 命令结果**，不做「轮询扫描进度」类协议。
- 安全：路径规范化；`relPath` 无 `..`；源/目标落在主仓或已登记 worktree 根下。

### Frontend

- 创建对话框：master checkbox + 可展开多选；调用 `scan_*` + batch link。
- 侧栏：选源 → 多选 → link/relink/unlink；覆盖确认含 N。
- `api.ts`：scan + batch link/unlink；hydrate 只校正 recorded `relPath`。
- 旧 `depLink` 无 `links` 时按 Migration 规则视为根单路径。

### Hydrate / snapshot

- 列表刷新：对每个 worktree **仅**检查 `depLink.links` 中已记录的路径在磁盘上的软链实况，更新 per-path 与聚合 status。
- **禁止**每次 snapshot 对源或目标做全树 `scan_*`。

## Performance

| 项 | 约定 |
|---|---|
| 最大扫描深度 | **6** |
| 永不进入 `node_modules` | 是 |
| 候选软上限 | **50**；截断 + notice |
| 扫描 / batch | Rust 异步；命令返回即完成；FE 不轮询 |
| Hydrate | 只走 recorded `relPath`；不全树扫 |
| Snapshot 轮询 | 不触发全树 scan |

## Out of scope

- PTY / Agents / 右栏
- 自动 `install`
- 解析 workspace 配置做发现
- `.venv` / 其它依赖目录类型
- 跨项目链接
- Windows junction 特判（同 Phase 1）
- 删除源时级联推送（仅 hydrate 标 broken）
- 侧栏「按 package 勾选部分 unlink」作为必做（默认全量 recorded unlink 即可）
- lockfile 分叉警告

## Acceptance

1. Monorepo 源根与 `packages/*` 等处有多份 `node_modules` → 扫描列出对应 `relPath`；默认全选；创建勾选后目标各路径均为指向源的软链。
2. 用户取消部分 package 后再链 → 仅选中路径有软链；未选中的目标路径不创建。
3. 创建后侧栏可选另一同源项目源并多选补链 / 换源；relink 默认偏好先前 recorded 且仍可用的路径。
4. 冲突：一次确认文案含 N，确认后全部冲突路径被 force 覆盖链接。
5. Unlink：只去掉本功能软链；真目录保留并有 notice；默认清掉该 worktree 全部 recorded 软链。
6. 嵌套：`packages/foo/node_modules/bar/...` 不会被当成独立候选；扫描不进入任何 `node_modules`。
7. 深度 > 6 或候选 > 50 → 受上限约束；超 50 有截断提示。
8. 旧 Phase 1 单路径元数据打开后行为等价于 `links: [{ relPath: "" }]`，根链接仍可用。
9. 刷新列表时 hydrate 只校正 recorded 路径；不以全树 scan 为每次刷新前提。
10. 项目外路径或含 `..` 的 `relPath` → 后端拒绝。

## Implementation notes (non-binding)

- Batch 实现可以是「循环单路径原语 + 一次元数据写回」，对外仍暴露 batch 命令。
- 展示用标签：`relPath === ""` →「根」；否则显示相对路径。
- 与 Phase 1 主仓行 `mainBranch` 标签兼容；选源列表文案不回归。
