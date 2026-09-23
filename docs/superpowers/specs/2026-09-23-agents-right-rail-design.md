# Right-rail Agents（进程存在列表）

Date: 2026-09-23  
Status: approved (architecture A — PTY daemon process poll)  
References: herdr observation-only agent detection; octopus right-rail shell (`docs/superpowers/specs/2026-09-22-right-rail-design.md`); terminal warm retain / parking

## Goal

在主界面右侧栏展示「当前哪些终端里正在跑 coding agent」，一眼看全局，并支持点击跳到对应终端。Phase 1 只做**进程存在检测**（谁在跑哪种 agent），不做 idle / working / blocked 细状态。

## Product rules (locked)

| 项 | 决定 |
|---|---|
| 列表范围 | **全局**：所有 context / tab / pane，不限当前 worktree |
| 行存活 | **live-only**：agent 进程退出即删行，不留历史 |
| 点击 | 聚焦到该 `session` 对应的 context → tab → leaf |
| 检测方式 | **观察式**进程识别；不要求 agent 配合 / 不接 lifecycle hook |
| Phase 1 状态 | 仅「在跑」一种；idle / working / blocked 留 Phase 2（屏显 / OSC） |

## Approach choice

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. PTY daemon ~300ms 轮询（采用）** | Daemon 持有 shell pid，扫子进程 / 前台组，变化时 push 事件 | 与 warm retain / parking 兼容（UI 卸掉后 daemon 仍在）；对齐 herdr 思路 |
| B. 前端定时 invoke | UI 按已知 session 调 Tauri 做 `ps` | 改动小，但未挂载 / 未 visited session 易漏 |
| C. 先做屏显 / OSC | 读 buffer / 标题分类状态 | Phase 1 过重；卸载后无 buffer；作 Phase 2 |

## Architecture

### Ownership

1. **PTY daemon（Rust）**  
   - 每个 session 已知 shell `pid`（已有）。  
   - 约每 **300ms** 扫描 session 进程树（含前台进程组优先，必要时整棵子树）。  
   - 用进程 basename 匹配白名单。  
   - **仅在 presence 变化时** emit（有/无、agent 种类变），避免每帧刷 UI。  
   - Session 销毁 / `ptyKill` 时清掉对应 presence 并 emit 清空。

2. **Frontend**  
   - 订阅 `agent-presence`（名称可最终定为 `agent-presence` / `pty-agent-presence`）。  
   - 维护全局 live map：`sessionId → AgentPresence | null`。  
   - 右栏 Agents 模块只读 map 渲染；点击时反查导航。

3. **Parking 关系**  
   - Warm-retain 卸 xterm 后 daemon 仍跑 → 探测与列表行继续存在。  
   - 点击被卸掉的 session：走正常 remount（`ptyOpen` + scrollback）再 `focusLeaf`。

### Event shape (draft)

```text
agent-presence {
  sessionId: string
  contextId: string | null   // daemon 侧已有时带上，便于 FE 少一次反查
  agentId: "codex" | "codebuddy" | null
  processName?: string       // 诊断用 basename
}
```

`agentId: null` 表示该 session 当前无白名单 agent（用于删行）。

### Frontend model

```text
AgentPresence {
  sessionId: string
  contextId: string
  agentId: "codex" | "codebuddy"
  processName?: string
}
```

行展示字段拼装：

| UI | 来源 |
|---|---|
| 状态图标 | Phase 1 固定「在跑」 |
| 项目名 | `contextId` → snapshot project |
| 分支 | worktree / main 的 `branchName` |
| 终端名 | `tabsByContext` 中 `sessionByLeafId` 反查 → tab `label`；多分屏可加 leaf 区分 |
| agent 名 | `codex` → Codex；`codebuddy` → CodeBuddy |

### Click-to-focus

1. 用 `sessionId` 反查 `(contextId, tabId, leafId)`。  
2. 选中 context → `setActiveTabByContext` → 设 `activeLeafId` → PaneManager `focusLeaf`。  
3. 若 UI 尚未暖挂：先进入 visited / warm set 触发 remount，再 focus。  
4. 映射丢失（tab 已关、daemon 尚未清）：忽略点击，等下次清空事件删行。

## Agent whitelist (Phase 1)

只匹配：

- `codex`
- `codebuddy`

规则：

- 取可执行路径 basename（忽略目录）；大小写按平台惯例规范化。  
- 可匹配进程树中任一节点，不要求前台进程必须是 agent 本体（兼容 nvm / bunx / node 包装）。  
- 同一 session 多个命中时优先级：**`codebuddy` > `codex`**（可调）。  
- 名单先做 daemon 常量表；后续可再抽配置。  
- **不在 Phase 1**：`claude`、`cursor-agent`、其它 CLI。

## UI

- Registry 新增模块 `agents`（图标：Bot 一类），与现有 `files` / `git` 并列。  
- 可滚动列表；行可点击；空态文案：「暂无运行中的 agent」。  
- **非目标（本阶段）**：过滤、排序偏好、右键菜单、状态色细分、历史记录、默认强制切到 Agents 模块（可默认选中，但非硬性）。

## Edge cases

| 情况 | 行为 |
|---|---|
| 双命中 | 按优先级取一个 |
| Shell 包装 | 扫进程树 basename |
| Warm-retain 卸 UI | 行保留；点击 remount + focus |
| `ptyKill` / 关 tab | daemon 清 session → emit null → 删行 |
| 单轮 `ps` 失败 | 跳过本轮，**保留上一帧**，不清整表 |
| Kill switch | Phase 1 **不做**；需要时再加 |

## Non-goals (Phase 1)

- idle / working / blocked（屏显 / OSC / lifecycle）  
- agent 主动上报、herdr 式 integration install  
- 历史归档 / 已结束会话列表  
- 远程 SSH pane 探测差异化  
- 把探测挪到纯前端或仅依赖 OSC title

## Phasing

| Phase | 内容 |
|---|---|
| **1（本稿）** | Daemon 进程轮询 + presence 事件 + FE live map + Agents 模块列表 + 点击聚焦；白名单 codex / codebuddy |
| 2 | 屏显 / OSC（或后续 hook）细状态；可扩白名单 |
| 3+ | 配置化名单、过滤排序、与 parking 指标联动等 |

## Verification

### Automated

- 进程名匹配纯函数（basename、优先级、大小写）。  
- presence「无变化不 emit / 有变化才 emit」逻辑（可测的纯函数或小模块）。

### Manual

1. 某终端跑 `codex` 或 `codebuddy` → 右栏出现正确项目 / 分支 / 终端名 / agent 名。  
2. 退出进程 → 行消失。  
3. 点击行 → 切到对应 worktree / tab / pane。  
4. 超过暖挂帽后再点旧终端上的 agent 行 → remount 并聚焦。  
5. 未跑白名单进程时列表为空态。

## Implementation sketch (not a plan)

- Rust：`pty` daemon 探测循环 + whitelist + emit；必要时补 `list_sessions` / 初始 snapshot 以便 FE 冷启动对齐。  
- FE：`agent-presence` 订阅 store；`right-rail/modules/agents.tsx`；registry 注册；App 提供 focus 回调（context/tab/leaf）。  
- 详细任务拆解见后续 `docs/superpowers/plans/`（writing-plans 阶段）。
