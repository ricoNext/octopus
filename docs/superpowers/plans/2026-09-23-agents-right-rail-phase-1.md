# Agents Right-Rail Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live global list of terminals currently running `codex` or `codebuddy`, and click a row to focus that context / tab / pane.

**Architecture:** PTY daemon polls ~300ms, walks each session’s process tree, matches whitelist basenames, and emits presence only on change over the existing Unix-socket wire protocol. Tauri host bridges to `agent-presence`. Frontend keeps a live map and renders a new right-rail `agents` module; row labels come from App snapshot + `tabsByContext`.

**Tech Stack:** Tauri 2 + Rust daemon (`src-tauri/src/pty.rs`), React 19 + Vitest, existing right-rail registry.

**Spec:** `docs/superpowers/specs/2026-09-23-agents-right-rail-design.md`

## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agent / PR workflow.
- Whitelist Phase 1: **`codebuddy` > `codex` only** (no claude / cursor).
- Live-only global list; no history; no idle/working/blocked.
- Eviction / warm retain: detection must keep working after UI unmount (`ptyDetach`); clear on `ptyKill` / session destroy.
- Probe failure: keep last frame; do not clear the whole map.
- Presence events must reach the host even when no session attach subscriber exists (broadcast to authenticated daemon clients).
- Event names: wire `agentPresence` → Tauri `agent-presence` (kebab like `pty-data`).
- Tests: `bun test` / `npm test` (Vitest) for TS; `cargo test` for Rust pure matching.
- Do not implement kill switch in Phase 1.

---

## File map

| File | Role |
|---|---|
| `src-tauri/src/agent_detect.rs` | Pure: parse `ps`, walk tree, match whitelist, presence diff |
| `src-tauri/src/pty.rs` | Daemon poll thread, client broadcast, wire bridge, clear on kill |
| `src-tauri/src/lib.rs` | `mod agent_detect;` |
| `src/lib/agents/types.ts` | `AgentId`, `AgentPresenceEvent`, `AgentRowView` |
| `src/lib/agents/labels.ts` | Display names |
| `src/lib/agents/resolve-session.ts` | `sessionId` → `{ contextId, tabId, leafId }` |
| `src/lib/agents/build-rows.ts` | Presence map + snapshot + tabs → rows |
| `src/lib/agents/*.test.ts` | Vitest |
| `src/lib/agents/presence-store.ts` | Listen `agent-presence`, hold `Map` |
| `src/components/right-rail/modules/agents.tsx` | List UI |
| `src/components/right-rail/types.ts` | Extend `RightRailContext` |
| `src/components/right-rail/registry.tsx` | Register `agents` |
| `src/components/RightPanel.tsx` | Pass extended ctx |
| `src/App.tsx` | Subscribe store, build rows, `focusAgentSession` |

---

### Task 1: Rust agent match pure module (TDD)

**Files:**
- Create: `src-tauri/src/agent_detect.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod agent_detect;`)
- Test: unit tests inside `agent_detect.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `pub enum AgentId { Codex, CodeBuddy }` with `as_str()` → `"codex"` / `"codebuddy"`
  - `pub fn basename_of_comm(comm: &str) -> String` (strip path; last `/` segment)
  - `pub fn match_agent_names(names: &[String]) -> Option<AgentId>` — priority CodeBuddy > Codex; case-insensitive exact basename match against `codebuddy` / `codex`
  - `pub type Pid = u32`
  - `pub fn parse_ps_table(text: &str) -> Vec<(Pid, Pid, String)>` — lines of `pid ppid comm` (whitespace-separated; comm may contain spaces → take remainder after ppid)
  - `pub fn descendant_comms(root: Pid, rows: &[(Pid, Pid, String)]) -> Vec<String>` — root + all descendants’ basenames
  - `pub fn detect_agent_for_session(root_pid: Pid, ps_text: &str) -> Option<(AgentId, String)>` — returns `(id, matched_basename)`
  - `pub fn presence_changed(prev: &Option<AgentId>, next: &Option<AgentId>) -> bool`

- [ ] **Step 1: Write failing tests** in `agent_detect.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_strips_path() {
        assert_eq!(basename_of_comm("/usr/local/bin/codex"), "codex");
        assert_eq!(basename_of_comm("codebuddy"), "codebuddy");
    }

    #[test]
    fn match_priority_codebuddy_over_codex() {
        let names = vec!["codex".into(), "codebuddy".into()];
        assert_eq!(match_agent_names(&names), Some(AgentId::CodeBuddy));
    }

    #[test]
    fn match_case_insensitive() {
        assert_eq!(match_agent_names(&["Codex".into()]), Some(AgentId::Codex));
    }

    #[test]
    fn match_ignores_unknown() {
        assert_eq!(match_agent_names(&["zsh".into(), "node".into()]), None);
    }

    #[test]
    fn detect_walks_descendants() {
        let ps = "\
1 0 /bin/zsh
2 1 /usr/bin/node
3 2 /opt/homebrew/bin/codex
";
        let hit = detect_agent_for_session(1, ps).unwrap();
        assert_eq!(hit.0, AgentId::Codex);
        assert_eq!(hit.1, "codex");
    }

    #[test]
    fn presence_changed_only_on_diff() {
        assert!(!presence_changed(&Some(AgentId::Codex), &Some(AgentId::Codex)));
        assert!(presence_changed(&None, &Some(AgentId::Codex)));
        assert!(presence_changed(&Some(AgentId::Codex), &Some(AgentId::CodeBuddy)));
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd src-tauri && cargo test agent_detect -- --nocapture
```

Expected: compile error / module missing.

- [ ] **Step 3: Implement `agent_detect.rs`** minimal to pass (no IO).

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd src-tauri && cargo test agent_detect -- --nocapture
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_detect.rs src-tauri/src/lib.rs
git commit -m "feat(agents): rust whitelist match and process-tree helpers"
```

---

### Task 2: Daemon poll + wire emit + host bridge

**Files:**
- Modify: `src-tauri/src/pty.rs`
- Consumes: `crate::agent_detect::{detect_agent_for_session, presence_changed, AgentId}`

**Interfaces:**
- Produces (wire): `Event { event: "agentPresence", session_id, data: Some(json_bytes) }`  
  JSON body (UTF-8 in `data`):  
  `{"contextId":"<id>","agentId":"codex"|"codebuddy"|null,"processName":"<basename>"|null}`
- Produces (Tauri): `app.emit("agent-presence", AgentPresenceEvent { session_id, context_id, agent_id, process_name })` with `#[serde(rename_all = "camelCase")]`
- Add `DaemonState.clients: Mutex<HashMap<u64, mpsc::Sender<WireMessage>>>` — register on auth success; remove on disconnect; **broadcast presence to all clients** (not only session attach subscribers).
- Store `last_presence: Mutex<HashMap<String, Option<AgentId>>>` on `DaemonState`.
- On session remove / kill path: set presence None, emit if changed, remove map entry.

**Design notes for implementer:**
- Start a daemon thread after bind in `run_terminal_daemon`: loop `sleep(300ms)` → snapshot sessions `(session_id, context_id, pid)` → for each `Some(pid)`, `Command::new("ps").args(["-axo","pid=","ppid=","comm="]).output()` once per tick (shared) → `detect_agent_for_session` → if `presence_changed`, update map + `broadcast_agent_presence(...)`.
- If `ps` fails: **skip the tick** (do not clear `last_presence`).
- Host `start_reader` `WireMessage::Event` arm: add `else if event == "agentPresence"` parse JSON from `data`, emit Tauri event. Include `contextId` from JSON.
- When session has `pid: None` or `!alive`: treat as `None` agent.

- [ ] **Step 1: Add `AgentPresenceEvent` struct** next to `PtyExitEvent`:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentPresenceEvent {
    session_id: String,
    context_id: String,
    agent_id: Option<String>,
    process_name: Option<String>,
}
```

- [ ] **Step 2: Wire clients map + broadcast helper + poller thread** in daemon (as above).

- [ ] **Step 3: Bridge in `start_reader`.**

- [ ] **Step 4: Clear presence on session destroy** (kill / remove from `sessions` map).

- [ ] **Step 5: Build check**

```bash
cd src-tauri && cargo test agent_detect && cargo check
```

Expected: PASS / check OK.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/agent_detect.rs
git commit -m "feat(agents): daemon presence poll and agent-presence bridge"
```

---

### Task 3: FE types + pure row/focus helpers (TDD)

**Files:**
- Create: `src/lib/agents/types.ts`
- Create: `src/lib/agents/labels.ts`
- Create: `src/lib/agents/resolve-session.ts`
- Create: `src/lib/agents/build-rows.ts`
- Create: `src/lib/agents/labels.test.ts`
- Create: `src/lib/agents/resolve-session.test.ts`
- Create: `src/lib/agents/build-rows.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type AgentId = "codex" | "codebuddy";

export type AgentPresenceEvent = {
  sessionId: string;
  contextId: string;
  agentId: AgentId | null;
  processName?: string | null;
};

export type AgentPresence = {
  sessionId: string;
  contextId: string;
  agentId: AgentId;
  processName?: string;
};

export type AgentRowView = {
  sessionId: string;
  contextId: string;
  agentId: AgentId;
  agentLabel: string;
  projectName: string;
  branchName: string;
  terminalLabel: string;
};
```

```ts
// labels.ts
export function agentDisplayName(id: AgentId): string {
  return id === "codebuddy" ? "CodeBuddy" : "Codex";
}
```

```ts
// resolve-session.ts
import type { TerminalTab } from "@/lib/terminal/terminal-tab";

export type SessionLocation = {
  contextId: string;
  tabId: string;
  leafId: string;
};

export function findSessionLocation(
  tabsByContext: Record<string, TerminalTab[]>,
  sessionId: string,
): SessionLocation | null;
```

Logic: iterate contexts → tabs → `Object.entries(tab.sessionByLeafId)`; if value === sessionId, return `{ contextId, tabId: tab.id, leafId }`.

```ts
// build-rows.ts
import type { AppSnapshot } from "@/types";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";
import type { AgentPresence, AgentRowView } from "./types";
import { agentDisplayName } from "./labels";
import { findSessionLocation } from "./resolve-session";

export function buildAgentRows(
  presenceBySession: ReadonlyMap<string, AgentPresence>,
  snapshot: AppSnapshot,
  tabsByContext: Record<string, TerminalTab[]>,
): AgentRowView[];
```

Row rules:
- Skip presence whose `findSessionLocation` is null (orphan until daemon clears).
- `contextId` equals project id → main: `projectName = project.name`, `branchName = project.mainBranch ?? project.defaultBranch ?? ""`.
- `contextId` equals worktree id → `projectName = projects.find(p => p.id === wt.projectId)?.name ?? ""`, `branchName = wt.branchName`.
- `terminalLabel`: tab.label; if tab has >1 session keys, append ` · ${leafId.slice(0, 4)}`.
- Sort: `projectName`, then `terminalLabel`, then `sessionId` (stable).

- [ ] **Step 1: Write the three test files** covering: labels; findSessionLocation hit/miss; build rows for main + worktree; skip orphan; multi-pane suffix.

- [ ] **Step 2: Run — expect FAIL**

```bash
bun test src/lib/agents
```

- [ ] **Step 3: Implement the four modules.**

- [ ] **Step 4: Run — expect PASS**

```bash
bun test src/lib/agents
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents
git commit -m "feat(agents): FE row builders and session resolve helpers"
```

---

### Task 4: Presence store (listen `agent-presence`)

**Files:**
- Create: `src/lib/agents/presence-store.ts`
- Optional test: pure reducer if extracted — prefer thin store mirroring `pty-event-bus` listen pattern.

**Interfaces:**
- Produces:

```ts
export function subscribeAgentPresence(
  onChange: (map: ReadonlyMap<string, AgentPresence>) => void,
): () => void;

export function getAgentPresenceSnapshot(): ReadonlyMap<string, AgentPresence>;
```

Behavior:
- Single Tauri `listen<AgentPresenceEvent>("agent-presence", ...)`.
- On event: if `agentId == null`, delete `sessionId`; else set `{ sessionId, contextId, agentId, processName?: ... }`.
- Ignore malformed `agentId` strings that are not `codex`|`codebuddy`.
- Call `onChange` with a new `Map` copy after each applied event.
- Refcount listeners; unlisten when zero (same idea as `pty-event-bus.ts`).

- [ ] **Step 1: Implement store.**

- [ ] **Step 2: Smoke-typecheck**

```bash
bunx tsc --noEmit
```

Expected: no errors from new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/presence-store.ts
git commit -m "feat(agents): frontend agent-presence subscription store"
```

---

### Task 5: Agents module UI + registry

**Files:**
- Modify: `src/components/right-rail/types.ts`
- Create: `src/components/right-rail/modules/agents.tsx`
- Modify: `src/components/right-rail/registry.tsx`
- Modify: `src/components/RightPanel.tsx` (only if props must forward — prefer richer `RightRailContext`)

**Interfaces:**
- Extend:

```ts
export type RightRailContext = {
  contextId: string | null;
  agentRows?: AgentRowView[];
  onFocusAgent?: (sessionId: string) => void;
};
```

- Registry entry:

```tsx
{
  id: "agents",
  title: "Agents",
  icon: BotIcon, // from lucide-react
  render: (ctx) => (
    <AgentsModule rows={ctx.agentRows ?? []} onFocus={ctx.onFocusAgent} />
  ),
}
```

Place **`agents` first** in `RIGHT_RAIL_MODULES` so default active module becomes Agents (acceptable per spec).

- `AgentsModule` UI:
  - Empty: centered muted text `暂无运行中的 agent`
  - Else: scrollable list; each row button showing  
    `[●] {projectName} · {branchName}`  
    second line: `{terminalLabel} / {agentLabel}`  
  - `onClick` → `onFocus?.(row.sessionId)`
  - Use existing sidebar/muted Tailwind tokens like placeholders.

- [ ] **Step 1: Implement module + types + registry.**

- [ ] **Step 2: `bunx tsc --noEmit`**

- [ ] **Step 3: Commit**

```bash
git add src/components/right-rail
git commit -m "feat(agents): right-rail Agents module and registry entry"
```

---

### Task 6: App wiring — rows + click-to-focus

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/RightPanel.tsx` — accept `agentRows` + `onFocusAgent` and pass into `ctx`

**Interfaces:**
- Consumes: `subscribeAgentPresence`, `buildAgentRows`, `findSessionLocation`
- Produces: `focusAgentSession(sessionId: string)`:

```ts
function focusAgentSession(sessionId: string) {
  const loc = findSessionLocation(tabsByContext, sessionId);
  if (!loc) return;
  const { contextId, tabId, leafId } = loc;
  // 1) selection: if contextId matches a worktree id → {kind:"worktree", worktreeId}
  //    else if matches a project id → {kind:"main", projectId}
  // 2) setActiveTabByContext(prev => ({...prev, [contextId]: tabId}))
  // 3) set tabsByContext activeLeafId for that tab to leafId
  // 4) ensure visited LRU includes contextId (existing warm-retain path)
  // 5) after paint: PaneManager focusLeaf if exposed; else rely on activeLeafId + remount
}
```

If PaneManager instance isn’t globally reachable, set `activeLeafId` in state (already drives which leaf is active on next syncLayout). Prefer matching existing split/focus patterns in `App.tsx`.

Wire:

```tsx
const [presenceMap, setPresenceMap] = useState(() => new Map());
useEffect(() => subscribeAgentPresence(setPresenceMap), []);
const agentRows = useMemo(
  () => buildAgentRows(presenceMap, snapshot, tabsByContext),
  [presenceMap, snapshot, tabsByContext],
);
// RightPanel agentRows={agentRows} onFocusAgent={focusAgentSession}
```

- [ ] **Step 1: Extend RightPanel props + ctx.**

- [ ] **Step 2: Implement subscribe + `focusAgentSession` in App.**

- [ ] **Step 3: Typecheck + unit tests**

```bash
bunx tsc --noEmit && bun test
```

Expected: all existing + new tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/RightPanel.tsx src/lib/agents src/components/right-rail
git commit -m "feat(agents): wire presence list and click-to-focus in App"
```

---

### Task 7: Manual verification checklist

- [ ] **Step 1: Run app**

```bash
bun run tauri:dev
```

- [ ] **Step 2: Checklist**
  1. Open Agents module — empty state visible.
  2. In a worktree terminal run `codex` (or `codebuddy`) → row appears with project / branch / `终端 N` / agent label within ~1s.
  3. Quit the agent → row disappears.
  4. Click row from another context → switches context + tab + pane.
  5. Open >4 worktrees so warm-retain unmounts an older one that still runs an agent → row remains; click remounts and focuses.
  6. Run a non-whitelist process (`node`, `vim`) → no row.

- [ ] **Step 7: Fix any bugs found; commit if needed**

```bash
git commit -m "fix(agents): <short bug description>"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Architecture A daemon ~300ms poll | Task 2 |
| Emit on change only | Task 1 `presence_changed` + Task 2 |
| Broadcast despite detach | Task 2 clients map |
| FE live map | Task 4 |
| Whitelist codex + codebuddy, priority | Task 1 |
| Process tree under shells | Task 1 + Task 2 `ps` |
| Row fields | Task 3 + Task 5 |
| Click-to-focus | Task 6 |
| Live-only / clear on kill | Task 2 |
| Probe failure keeps last frame | Task 2 |
| No idle/working / no kill switch | — out of scope |
| Warm retain compatible | Task 2 + Task 7.5 |
| Manual + automated verify | Tasks 1,3,7 |

## Placeholder scan

No TBD / “handle later” steps. Event name locked to `agentPresence` / `agent-presence`.

