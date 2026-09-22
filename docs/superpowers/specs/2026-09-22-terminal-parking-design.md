# Terminal parking / warm retain (Orca-lite)

Date: 2026-09-22  
Status: approved (scheme B — phased Orca-lite)  
Reference: Orca `terminal-hidden-view-parking`, `terminal-hidden-worktree-retention`, hidden delivery gate, output backlog / scrollback limits

## Goal

给 octopus 终端加上可控的资源分层，避免「访问过的 Tab/Pane 永久暖挂 + 隐藏仍 `term.write`」在多 worktree / 多分屏下把前端撑爆；同时尽量保留短切 tab 的即时感。

终态对齐 Orca 思路，但按 Tauri + 本地 PTY daemon + 多 leaf 树改写，分阶段落地。

## Current behavior (baseline)

- `App` 用 `visited[]` 记录打开过的 main/worktree；访问过的 context 全部保持挂载（CSS `invisible`，不是 unmount）。
- `LeafSession`：首次 `setActive(true)` 才 `ptyOpen`；隐藏时**不** `ptyDetach`（warm park）；仅 `dispose()` 时 detach + `term.dispose()`。
- 隐藏 Tab 仍订阅 `pty-data` 并 `term.write`，无数量帽、无冷停靠、无投递闸。
- Daemon `MAX_HISTORY` ≈ 200KB 环形缓冲；xterm `scrollback: 5000`。

## Non-goals (overall program)

- 搬迁 Orca 的 Electron main「terminal model」整套 IPC。
- SSH / paired PTY 的可恢复性分类（本地 daemon 默认均可 snapshot 恢复）。
- 改变「关闭 Tab/Pane」语义（关 = 杀 session；停靠 ≠ 关闭）。
- Agent 右侧栏模块（独立需求）。

## Approach choice

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 一次完整移植 Orca | hysteresis + hot retain + cold unmount + parked watcher + gate + backlog | 工程面过大；闸门在 Electron main，octopus 需重做在 Rust daemon |
| **B. 分阶段 Orca-lite（采用）** | 先暖集帽 + 隐藏投递卫生，再完整冷停靠 | 每阶段可独立上线、有 kill switch |
| C. 仅前端 LRU dispose | 超额 `dispose()`，靠 scrollback 恢复 | 可作 Phase 1 子集，不宜终态 |

## Architecture (target)

### Layers

1. **Warm（暖挂）**  
   当前可见 + 最近隐藏的一小撮：继续挂 xterm/DOM，切换零成本；可继续收 `pty-data`（或仅暖集收流，见 Phase 2）。

2. **Evict / Cold park（超额或超时）**  
   卸 xterm/DOM；**daemon PTY + 环形历史保留**；再次进入用 attach + `scrollback_ansi`（或等价快照）恢复。

3. **Delivery interest（投递兴趣）**  
   无前端消费者时，daemon 只写 ring，不向 FE 推 `pty-data`。

4. **Counting unit**  
   策略以 **leaf / session** 为主（同时可约束 worktree / tab），避免「1 Tab × 8 pane」绕过 Tab 帽。

### Suggested constants (configurable; start aligned with Orca)

| 项 | 初值 |
|---|---|
| 冷停靠延迟 | `30_000` ms |
| Worktree 热保留 | 4 个 / `5 * 60_000` ms |
| Tab 热保留 | 6 个 / `5 * 60_000` ms |
| 隐藏 leaf 软顶（octopus 增补） | 建议 ≤ 12（可调） |
| 不可停靠兜底 | 4 个 / `15 * 60_000` ms（Phase 3 若需要） |
| Daemon 历史 | 提升至约 **512KB**（对齐 Orca session buffer 量级） |
| 渲染侧 backlog（若仍投递） | `max(2MB, scrollbackRows * 120)` 字符级 |

### Kill switches

- `octopus.terminalWarmRetain`（Phase 1）
- `octopus.terminalHiddenDeliveryGate`（Phase 2）
- `octopus.terminalColdPark`（Phase 3；可默认关至稳定）

实现可用 localStorage / 设置项；缺省时 Phase 1–2 建议默认开，Phase 3 先关或显式开。

### Eviction / park policy (target)

- **Last-active** worktree / tab（及当前可见 leaf）豁免冷停靠与强制回收。
- 排序：隐藏时长（或 `hiddenSince`）→ 最近激活序 → 稳定 id。
- **不要**在每次 hide 时 detach；只在超额 / 冷停靠时卸 UI。
- Remount 后应有短冷却，避免抖切导致反复 mount/dispose。

### Frontend ↔ daemon

| 状态 | 前端 | Daemon |
|---|---|---|
| 可见 / 暖挂 | xterm 挂载；有 delivery interest | 推 `pty-data` + 写 ring |
| 隐藏且已 dispose / 冷停靠 | 无 xterm；无 interest（或仅 parked watcher 旁路） | 只写 ring；不向 FE 推流 |
| 再次显示 | remount + attach + 灌 scrollback | 恢复推流 |

API 倾向：在现有 `ptyOpen` / `Detach` / `Write` / `Resize` / `Kill` 上扩展可选「投递兴趣」标记（例如 attach 标志或 `ptySetDeliveryInterest`），避免另起一套 Electron 式 model IPC。

## Phased delivery (ROI order)

### Phase 0 — Instrumentation

- 打点：mounted `LeafSession` 数、invisible 但仍在写的 session 数、daemon session 数、粗略内存（能拿则拿）。
- 功能开关桩就位，**行为不变**。
- 验收：开发者可在控制台/调试面板看到上述计数。

### Phase 1 — Warm retain caps（最高收益）

- 裁剪 `visited` / 隐藏 Tab（及 leaf）暖集：LRU + 数量帽（对齐上表；leaf 软顶一并考虑）。
- 超出：对该 Tab/workspace **`dispose()`**（卸 xterm，**不杀** daemon process）。
- 再进入：`ptyOpen`（或 re-attach）+ daemon scrollback 重建。
- 刚切走的一小撮保持暖挂，保住短切体感。
- 验收：大量打开 worktree/Tab 后，隐藏侧挂载数稳定在帽附近；切回最近几个仍即时。

### Phase 2 — Hidden output hygiene

- 非 active / 无 delivery interest：FE 取消 `pty-data` 订阅；daemon 不向无兴趣端推流，只写 ring。
- `MAX_HISTORY`（或等价）提到约 512KB。
- 可选：仍有投递时的 FE backlog 帽，防单次洪水。
- 验收：隐藏 Tab 刷屏时前端 CPU/内存不明显涨；切回内容在 ring 范围内连续。

### Phase 3 — Full cold park

- 隐藏 ≥ 30s 且超出热保留 → 卸 xterm（冷停靠）。
- 轻量 parked watcher（exit / bell / 标题等副作用，不跑完整 xterm）——若 Agent 侧栏等需要再优先。
- remount 冷却防抖。
- 验收：长时间挂很多后台 Tab，内存接近「可见 + 热保留」；切回延迟可接受（目标约百毫秒级）。

### Phase 4 — Polish

- Kill switch 文案与默认值、恢复告警、leaf 帽调参。
- e2e：隐藏刷屏 → 切回连续性。
- 必要时 session 持久化字节上限（对齐 Orca 512KB / store 5MB 量级，按需）。

## File touch map (expected)

| Area | Likely files |
|---|---|
| 暖集 / visited 策略 | `src/App.tsx`；新建纯函数模块如 `src/lib/terminal-warm-retain.ts`（便于单测） |
| Leaf 生命周期 | `src/lib/pane-manager/leaf-session.ts`, `pane-manager.ts`, `TerminalWorkspace.tsx` |
| Daemon 历史 / 投递 | `src-tauri/src/pty.rs`（及 attach/emit 路径） |
| 设置 / kill switch | 设置页或 localStorage helpers |
| 测试 | Vitest：retain 选择纯函数；Rust：history cap / 无 interest 不推流 |

具体路径在实现计划里按阶段再钉死。

## Risks

- Phase 1 若误在每次 hide 时 detach，会感觉变慢 → 必须「超额才 dispose」。
- 只做 Phase 1、暖集仍过大且无 Phase 2 闸门时，暖集内隐藏 Tab 仍会 `term.write` → 帽要够紧，并尽快接 Phase 2。
- `PaneManager` remount 与主动 dispose 必须对齐，避免孤儿 xterm。
- 多 pane：只按 Tab 计数会漏算 leaf → 必须 leaf 维度（或等价 session 数）。
- Daemon 200KB → 512KB 前，Phase 1/3 remount 的恢复保真度弱于 Orca。

## Success criteria (program-level)

1. 打开远超热保留数量的 worktree/Tab/分屏后，前端挂载的 xterm 数有硬顶（可配置）。
2. 隐藏刷屏不再等价于「后台全量 xterm 解析」。
3. 短切最近 Tab 仍接近现有暖挂体感；冷恢复可接受。
4. 每一阶段可用 kill switch 回退，且有可观测计数验证。

## Implementation order agreement

用户确认：按 **0 → 1 → 2** 优先；**3** 在 1/2 稳定后再开；**4** 收尾。  
本文件只锁定设计；实现计划另写 `docs/superpowers/plans/`（按所选阶段拆任务）。
