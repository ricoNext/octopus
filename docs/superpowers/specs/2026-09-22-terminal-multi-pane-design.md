# octopus 终端 Tab 内多 Pane 技术方案

- **日期**: 2026-09-22
- **状态**: 已实现（PR #8）
- **范围**: 仅内层——一个 terminal tab 内多 pane 分屏；外层 tab-group 多列不做
- **选型**: 方案 A——二叉 split 树 + 命令式 PaneManager
- **参考**: Orca（`ricoNext/orca`）tab 内多终端 / 快捷键体系；适配 octopus 现有 Tauri PTY daemon
- **仓库路径**: `/Users/ricolee/Desktop/rico/octopus`（本机）

---

## 1. 背景与现状

octopus 是面向 macOS 的 Git Worktree 编排桌面应用（Tauri 2 + React + Vite）。侧栏选中的是 **context**（project main 或 worktree）；每个 context 下已有多个 `TerminalTab`。

当前约束是 **一个 tab 一个终端**：

```text
TerminalTab ↔ TerminalPane ↔ PTY session = 1:1:1
sessionId === tab.id
```

关键现状（实现时以代码为准）：

| 区域 | 路径 / 行为 |
|---|---|
| Tab UI 状态 | `src/App.tsx`：`tabsByContext`、`activeTabByContext`（React state + localStorage） |
| 终端组件 | `src/components/TerminalPane.tsx`（xterm + FitAddon） |
| 前端 PTY API | `src/lib/api.ts`：`ptyOpen` / `ptyDetach` / `ptyWrite` / `ptyResize` / `ptyKill` |
| Rust PTY | `src-tauri/src/pty.rs`（portable-pty + terminal-daemon，按 sessionId 多路） |
| cwd | `workspace::session_cwd(store, cwdId)`，cwdId = projectId 或 worktreeId |
| 快捷键 | 仅 `⌘B` 切侧栏；无 keybindings 配置层 |
| 持久化 | `octopus.terminal.state`（selection + tabs + activeTab）；PTY scrollback 在 daemon |

**缺的是「单 tab 多 pane」**，不是「每 context 多 tab」（后者已有）。

---

## 2. 目标与非目标

### 目标

1. 同一个 terminal tab 内可左右 / 上下分出多个终端 pane
2. 每个 pane 独立 PTY、独立 xterm、可拖分隔条改比例
3. 快捷键：新建 tab、向右/向下分屏、关当前 pane、聚焦下一格
4. 应用刷新后布局与活跃 pane 可恢复
5. 已有「一 tab 一终端」的 localStorage / 存活 session 平滑迁移

### 非目标（本期不做）

- Orca 外层 tab-group 多列分屏
- 用户自定义快捷键文件（`~/.octopus/keybindings.json` 等）
- 单 pane 独立 cwd / SSH / 远程 PTY
- 引入 zustand 或大规模状态重构
- 改变「每个 context 至少保留 1 个 tab」的现有规则

---

## 3. 方案选型（已确认）

| 方案 | 要点 | 结论 |
|---|---|---|
| **A. 二叉 split 树 + PaneManager** | 任意分屏、可持久化、贴近 Orca、后续可加外层 | **采用** |
| B. 固定网格（最多 2×2） | 实现快，扩展差 | 不采用 |
| C. 双层（tab-group + pane）一次做完 | 过重，octopus 无 tab-group 模型 | 不采用 |

---

## 4. 数据模型

### 4.1 类型

将 `TerminalTab` 从 `{ id, label }` 升级为「tab 行 + 布局快照」：

```ts
type SplitDirection = "horizontal" | "vertical"

type PaneLayoutNode =
  | { type: "leaf"; id: string }
  | {
      type: "split"
      id: string
      direction: SplitDirection
      ratio: number // 0–1，first 子树占比
      first: PaneLayoutNode
      second: PaneLayoutNode
    }

type TerminalTab = {
  id: string
  label: string
  layout: PaneLayoutNode
  activeLeafId: string
  /** leafId → PTY sessionId；新建后立刻写入 */
  sessionByLeafId: Record<string, string>
}
```

### 4.2 约定

- `tab.id` 只标识 tab 行，**不再**作为 PTY `sessionId`
- `leaf.id` 是 pane 稳定键；逻辑键 `PaneKey = `${tab.id}:${leaf.id}``
- PTY `sessionId` 使用 `leaf.id`（`crypto.randomUUID()`）
- `cwdId` 仍为当前 context；分屏继承，不改 Rust `session_cwd`
- `direction` 与 CSS flex 对齐时在实现里写死映射表，避免与 Orca 命名歧义：
  - **向右分屏** → 左右两栏（建议 `direction: "vertical"` 表示分割线垂直）
  - **向下分屏** → 上下两栏（建议 `direction: "horizontal"` 表示分割线水平）
  - 代码注释必须写清「向右 / 向下」与枚举的对应，禁止只写 horizontal/vertical 不写产品语义

### 4.3 持久化与迁移

`localStorage` key 仍为 `octopus.terminal.state`，建议形状：

```ts
{
  version: 2,
  selection: Selection,
  tabsByContext: Record<string, TerminalTab[]>,
  activeTabByContext: Record<string, string>
}
```

**v1 → v2 迁移**（读到无 `version` 或旧结构时）：

1. 每个旧 tab `{ id, label }` 变为单 leaf 树：`layout = { type: "leaf", id: tab.id }`
2. `activeLeafId = tab.id`
3. `sessionByLeafId = { [tab.id]: tab.id }`
4. 这样 daemon 中仍存活的旧 session 可继续 `attach`，用户无感

写入时始终带 `version: 2`。

---

## 5. 渲染架构

### 5.1 为什么内层不用 React 树挂 xterm

xterm 是命令式实例。分屏、拖拽、切焦点若走 React reconciliation，容易 dispose/重挂、丢焦点、闪屏。Orca 因此将 pane 层做成命令式；octopus 同步该取舍。

### 5.2 分层

| 层 | 职责 |
|---|---|
| `App`（已有 tab 条） | 每 context 多 tab；「+」建 tab；每 tab 挂一个 `TerminalWorkspace` |
| `TerminalWorkspace`（新，React） | 持有该 tab 的 layout；根 DOM 交给 PaneManager；必要时 portal 挂轻量 overlay |
| `PaneManager`（新，命令式） | 按二叉树建 flex 容器 + 分隔条；每 leaf `new Terminal()` + FitAddon；split / 关 pane / 聚焦 / 读 ratio |
| 现有 `TerminalPane` | 拆出「单 leaf 的 xterm↔PTY 绑定」供 PaneManager 调用，不再「1 tab = 1 组件」 |

非当前 tab：沿用「访问过则挂载、CSS 隐藏」；隐藏时 detach UI 订阅，进程留在 daemon。

### 5.3 分屏算法

1. 取 `activeLeafId` 对应 leaf
2. 将该节点替换为 `split`：原 leaf → `first`，新 leaf → `second`，`ratio = 0.5`
3. 按快捷键/菜单决定向右或向下（见 4.2 方向映射）
4. 新 leaf：`sessionId = leaf.id`，`ptyOpen(sessionId, cwdId, cols, rows)`
5. 写回 `tab.layout`、`sessionByLeafId`、`activeLeafId = 新 leaf.id`
6. PaneManager 只增量插 DOM，不重建整棵无关子树的 xterm

### 5.4 关 pane

1. 从树摘掉该 leaf，兄弟节点提升替代原 split
2. `ptyKill(sessionByLeafId[leafId])`，删映射项
3. 若树空：走关 tab 流程（context 内至少留 1 个 tab，沿用现逻辑）
4. 更新 `activeLeafId`（优先兄弟，否则前序第一个 leaf）

### 5.5 分隔条

拖拽只改对应 split 的 `ratio`，**不** dispose xterm；`pointerup` 后再写入 React state / localStorage。

---

## 6. PTY 改造

Rust daemon 已按 `sessionId` 多路复用，**后端命令签名可保持不变**，改前端传入的 id。

| 现况 | 改后 |
|---|---|
| `ptyOpen(tab.id, contextId, …)` | `ptyOpen(leaf.id, contextId, …)` |
| 关 tab → `ptyKill(tab.id)` | 关 tab → 遍历 `sessionByLeafId` 全部 `ptyKill` |
| 删 worktree / project → `kill_context` | 不变 |
| 切 tab → `ptyDetach` | 对该 tab 下各 leaf 的 session detach（或 Workspace 统一 detach） |

`src/lib/api.ts` 四个方法签名不改，只改调用方。每个 leaf 独立 fit / `ptyResize`。

---

## 7. 快捷键

第一期：集中定义表 + `window` **捕获阶段** `keydown`（xterm 有焦点时也能收到）。不做用户配置文件。

建议文件：`src/lib/keybindings.ts`（definitions + match）。

| Action id | 默认（Mac） | 行为 |
|---|---|---|
| `tab.newTerminal` | ⌘T | 当前 context 新建 tab（单 leaf）并激活 |
| `terminal.splitRight` | ⌘D | 活跃 pane 向右分，新 pane 继承 cwd |
| `terminal.splitDown` | ⌘⇧D | 活跃 pane 向下分 |
| `terminal.closePane` | ⌘W | 关活跃 pane；仅剩一个 pane 时关 tab（最后一个 tab 仍拒绝） |
| `terminal.focusNextPane` | ⌘] | 前序遍历下一 leaf，末尾绕回 |
| （已有）侧栏 | ⌘B | 行为不变 |

规则：

- Mac 用 `metaKey`；重命名 tab / 普通 input 聚焦时不触发分屏类绑定
- xterm 内现有 ⌘Backspace/Delete → `^U` 保留，且优先级低于上表
- 第一期不做 per-platform 配置文件；表结构预留 `defaultBindings`，便于以后覆盖

---

## 8. 端到端链路

### 8.1 ⌘T / tab「+」新建 tab

1. `createTerminalTab`：新 `tab.id`，单 leaf，`leaf.id` 新 UUID
2. 写入 `tabsByContext`，设为 active
3. 挂载 `TerminalWorkspace` → `new PaneManager(rootEl, layout, …)`
4. `ptyOpen(leaf.id, contextId, cols, rows)` → daemon create + attach
5. `pty-data` → 该 leaf 的 xterm `write`

### 8.2 ⌘D / ⌘⇧D 分屏

1. `splitActivePane(direction)`
2. 改树 + PaneManager 插 DOM/xterm
3. 同一条 `ptyOpen`
4. 持久化 layout / session 映射 / activeLeafId

### 8.3 打开终端 → 上屏（多 pane 后）

与现网一致，仅 id 从 tab 换成 leaf：

1. 选 context → 保证至少一 tab
2. Workspace 按 layout 挂多个 leaf
3. 每 leaf：xterm + listen `pty-data`/`pty-exit`
4. active / 可见时 `ptyOpen`；cwd 仍由 contextId 解析
5. 键盘 → `ptyWrite`；输出 → `term.write`；ResizeObserver → `ptyResize`

---

## 9. 建议触及的文件

| 文件 | 变更 |
|---|---|
| `src/App.tsx` | tab 状态形状、迁移、挂 `TerminalWorkspace`、快捷键入口 |
| `src/components/TerminalWorkspace.tsx` | **新建** React 壳 |
| `src/lib/pane-manager/*` | **新建** PaneManager、split/close/focus、divider |
| `src/components/TerminalPane.tsx` | 拆成单 leaf 绑定或内聚进 pane-manager |
| `src/lib/keybindings.ts` | **新建** 定义与匹配 |
| `src/lib/api.ts` | 通常不改签名 |
| `src-tauri/src/pty.rs` 等 | 预期无改或仅日志；以联调为准 |
| `docs/superpowers/specs/2026-09-22-terminal-multi-pane-design.md` | 本文档 |

---

## 10. 分期与验收

### 分期

1. **模型 + 迁移**：`TerminalTab` 升级、v1→v2；单 leaf 行为与现网一致（无功能回归）
2. **PaneManager + 分屏 UI**：分隔条、关 pane、焦点、resize
3. **PTY 按 leaf 绑定**：关 tab 杀该 tab 全部 session
4. **快捷键表**：⌘T / ⌘D / ⌘⇧D / ⌘W / ⌘]
5. **（可选后续）** 右键菜单分屏；外层 tab-group；用户自定义键位

### 验收标准

- [ ] 同一 tab 能完成至少两层任意二叉分屏（例如形成近似 2×2）
- [ ] 拖分隔条改比例后，刷新应用格子比例与 `activeLeafId` 仍在
- [ ] 关某一 pane 只杀对应 PTY，其它 pane 输出与焦点正常
- [ ] ⌘T 新建 tab；⌘D / ⌘⇧D 分屏；⌘W / ⌘] 符合上表
- [ ] 从 v1 状态文件打开：旧单终端 tab 仍能 attach 原 session
- [ ] 每 context 最后一个 tab / 规则与现网一致（不能关到零 tab）

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 分屏时 React 重渲染弄丢 xterm | PaneManager 命令式 DOM；layout 更新尽量增量 |
| 旧 sessionId=tab.id 迁移后 attach 失败 | v1 迁移强制 `leaf.id = tab.id` |
| ⌘W 与系统关窗冲突 | 捕获阶段处理；仅终端工作区聚焦时生效；文档说明 |
| 隐藏 tab 多 pane 内存升高 | 沿用「访问过才挂载」；后续可再做卸载策略 |

---

## 12. 下一步

1. 用户确认本 spec 无异议
2. 用 writing-plans 拆实现计划到 `docs/superpowers/plans/`
3. 按分期落地，每期可独立验证
