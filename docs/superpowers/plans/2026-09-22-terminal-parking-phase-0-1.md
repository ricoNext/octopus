# Terminal Parking Phase 0–1 Implementation Plan

**Goal:** Cap warm-mounted terminal workspaces (context ≤4, tab ≤6) so switching away unmounts `TerminalWorkspace` → `dispose()` → `ptyDetach` (daemon stays alive). Add metrics + kill switch stubs.

**Spec:** `docs/superpowers/specs/2026-09-22-terminal-parking-design.md`

**Constraints:** Do not touch worktree-refresh hunks. Eviction must `ptyDetach`, never `ptyKill`. Kill switch `octopus.terminalWarmRetain` defaults ON (`"false"` only disables).

## File map

| File | Role |
|---|---|
| `src/lib/terminal/warm-retain.ts` | Pure selectWarmMountKeys + key helpers + limits |
| `src/lib/terminal/warm-retain.test.ts` | Vitest coverage |
| `src/lib/terminal/terminal-metrics.ts` | Counters + `window.__octopusTerminalMetrics` |
| `src/lib/terminal/terminal-feature-flags.ts` | `isTerminalWarmRetainEnabled()` |
| `src/lib/pane-manager/leaf-session.ts` | Bump leafActive/leafInactive/ptyOpen/leafDispose |
| `src/App.tsx` | LRU visited, tabActivationOrder, gate mount on warm keys |

---

## Phase 0 — Metrics + kill switch stubs

- [x] Create `terminal-metrics.ts` (`bump` / `set` / `get` / `reset`, browser install)
- [x] Create `terminal-feature-flags.ts` (localStorage key, default ON)
- [x] Wire LeafSession: `setActive` → leafActive/leafInactive; `openPty` success → ptyOpen; `dispose` → leafDispose
- [x] App: `setTerminalMetric` for visitedCount / warmKeyCount / mountedWorkspaceCount (after Phase 1 memo exists)

## Phase 1 — Warm retain caps

- [x] Write `warm-retain.test.ts` (disabled=all; selected always; context cap; tab cap; missing tabs skipped)
- [x] Implement `warm-retain.ts`
- [x] App: visited LRU bump on selection / applySnapshot focus / initial load (keep prune filter)
- [x] App: `tabActivationOrder` state + effect bump on active tab change
- [x] App: `useMemo(selectWarmMountKeys)` + mount loop only when `warmMountKeys.has(...)`
- [x] Run `bun test` / `npm test`; fix failures
- [x] Commit parking files only: `feat(terminal): phase 0–1 warm retain caps and metrics`

## Verify (UI)

1. Open >4 worktrees; older contexts should unmount (metrics: warmKeyCount ≤ contexts×tabs caps).
2. `window.__octopusTerminalMetrics` shows bumps on switch / open / dispose.
3. Return to an older context: remount + scrollback restore via ptyOpen.
4. Kill switch: `localStorage.setItem('octopus.terminalWarmRetain','false')` then reload → all visited tabs mount again.
