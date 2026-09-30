# Unified Center Tabs: File Preview Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file previews first-class center strip tabs (`CenterTab` with `kind: "terminal" | "file"`), support multiple file tabs with same-path focus, and remove the faux preview chip + `centerSurface`.

**Architecture:** Approach A from the approved spec. Widen `tabsByContext` / `activeTabByContext` to a `CenterTab` discriminated union. Terminal tabs keep layout/session fields; file tabs store `{ id, label, rootPath, relPath }` only and re-read content on activate into ephemeral UI state. App renders one unified strip (select + close for both kinds); `+` still creates terminals only. Context menus / split / warm mounts / agents session lookup stay terminal-only via type guards. No Rust.

**Tech Stack:** React 19, Vite, bun, TypeScript, Vitest; existing `api.fsReadTextFile` / Files right-rail module unchanged.

## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agents for code edits.
- **No Rust / fs API changes.** FE only.
- Multi file tabs per context; reopen same `rootPath` + `relPath` **focuses** existing (no duplicate).
- Persist paths only for file tabs; **re-read** on activate; ignore any persisted content blob.
- Migrate missing `kind` → `"terminal"`; invalid file entries skipped; each context must still have ≥1 terminal tab after migrate / close.
- Remove faux chip, `centerSurface`, replace-only single `filePreview` surface switch, and `preview-chip` close helpers that encode surface switching.
- `+` creates **terminal** tabs only; file tabs have no pane split / context-menu split actions.
- Do **not** stuff file tabs into `PaneManager` / PTY; no Monaco, rich previews, write/save.
- Chinese UI copy for close: `关闭预览` (file tab X / optional header X).
- Files module still calls `onOpenFilePreview({ rootPath, relPath })`; App maps to create-or-focus file `CenterTab`.
- Supersedes preview *presentation* in sibling-tab plan/spec; Files tree + read-only `FilePreview` content remain.

**Spec:** `docs/superpowers/specs/2026-09-29-files-center-tab-parity-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/terminal/terminal-tab.ts` | Add `CenterTab` union; `kind` on create; migrate missing `kind`→terminal / validate file tabs; helpers: `isTerminalTab`, `isFileTab`, `findFileTabByPath`, `closeFileTabResult` (neighbor activation), ensure ≥1 terminal |
| `src/lib/terminal/terminal-tab.test.ts` | Vitest for migrate + helpers (TDD) |
| `src/App.tsx` | `tabsByContext: Record<string, CenterTab[]>`; unified strip; remove chip/`centerSurface`/`filePreview`; open create-or-focus + ephemeral content; content switch; gate warm mounts / split / close-terminal / rename / context menu to terminal kind |
| `src/components/FilePreview.tsx` | Full-bleed body for active file tab; keep optional header; import basename from surviving helper |
| `src/lib/files/preview-chip.ts` | Keep `fileNameFromRel` (or move next to terminal-tab / a tiny `file-name.ts`); **delete** `CenterSurface` / `closePreviewState` |
| `src/lib/files/preview-chip.test.ts` | Drop surface tests; keep basename tests (or relocate with helper) |
| `src/lib/agents/resolve-session.ts` | Accept `CenterTab[]`; skip non-terminal when walking `sessionByLeafId` |
| `src/lib/agents/build-rows.ts` | Type as `CenterTab[]` (or keep working via guard in resolve-session) |
| `src/components/right-rail/modules/files.tsx` | **Do not change** — still `onOpenFilePreview` |
| Rust / `src-tauri/**` | **Do not touch** |

Strip order after change:

```
[ center tab(s): terminal and/or file ] [ + new terminal ]
```

---

### Task 1: `CenterTab` model + migrate + helpers (TDD)

**Files:**
- Modify: `src/lib/terminal/terminal-tab.ts`
- Modify: `src/lib/terminal/terminal-tab.test.ts`
- Modify (types only if needed later): callers still compile after Task 2; this task keeps `TerminalTab` as the terminal member and exports `CenterTab`

**Interfaces:**

```ts
import { createLeaf, type PaneLayoutNode } from "./pane-layout";
import { fileNameFromRel } from "@/lib/files/preview-chip"; // or local basename helper

export type TerminalTab = {
  kind: "terminal";
  id: string;
  label: string;
  layout: PaneLayoutNode;
  activeLeafId: string;
  sessionByLeafId: Record<string, string>;
};

export type FileTab = {
  kind: "file";
  id: string;
  label: string; // basename(relPath)
  rootPath: string;
  relPath: string;
};

export type CenterTab = TerminalTab | FileTab;

export function isTerminalTab(tab: CenterTab): tab is TerminalTab;
export function isFileTab(tab: CenterTab): tab is FileTab;

/** Same rootPath+relPath within one context's tab list. */
export function findFileTabByPath(
  tabs: readonly CenterTab[],
  rootPath: string,
  relPath: string,
): FileTab | undefined;

/**
 * Remove file tab by id. Prefer previous neighbor as next active; else next;
 * if list empty after remove, append a default terminal tab and activate it.
 * Does not kill PTYs (file tabs have none).
 */
export function closeFileTabResult(
  tabs: readonly CenterTab[],
  fileTabId: string,
): { tabs: CenterTab[]; activeTabId: string } | null;

export function createTerminalTab(index: number): TerminalTab; // adds kind: "terminal"
export function createFileTab(args: {
  rootPath: string;
  relPath: string;
  id?: string;
}): FileTab;

export function migrateCenterTab(raw: unknown): CenterTab | null;
export function migrateTabsByContext(raw: unknown): Record<string, CenterTab[]>;
// After migrate per context: if zero terminal tabs remain, prepend/append createTerminalTab(1)
// and leave active pointing at a terminal if previous active was dropped.

export function sessionIdsForTab(tab: TerminalTab): string[]; // unchanged; terminal-only
```

- [x] **Step 1: Write failing tests**

Extend `src/lib/terminal/terminal-tab.test.ts`:

```ts
import {
  closeFileTabResult,
  createFileTab,
  createTerminalTab,
  findFileTabByPath,
  isFileTab,
  isTerminalTab,
  migrateCenterTab,
  migrateTabsByContext,
  nextTerminalTabIndex,
  sessionIdsForTab,
} from "./terminal-tab";

describe("center-tab", () => {
  it("createTerminalTab sets kind terminal", () => {
    const tab = createTerminalTab(1);
    expect(tab.kind).toBe("terminal");
    expect(isTerminalTab(tab)).toBe(true);
  });

  it("createFileTab derives label from basename", () => {
    const tab = createFileTab({ rootPath: "/repo", relPath: "src/App.tsx" });
    expect(tab).toMatchObject({
      kind: "file",
      rootPath: "/repo",
      relPath: "src/App.tsx",
      label: "App.tsx",
    });
    expect(tab.id).toBeTruthy();
    expect(isFileTab(tab)).toBe(true);
  });

  it("migrate missing kind → terminal (v2 shape)", () => {
    const tab = migrateCenterTab({
      id: "t1",
      label: "终端 1",
      layout: { type: "leaf", id: "l1" },
      activeLeafId: "l1",
      sessionByLeafId: { l1: "l1" },
    });
    expect(tab?.kind).toBe("terminal");
    expect(tab && isTerminalTab(tab) && tab.activeLeafId).toBe("l1");
  });

  it("migrate missing kind v1 {id,label} → terminal", () => {
    const tab = migrateCenterTab({ id: "old", label: "终端 1" });
    expect(tab?.kind).toBe("terminal");
  });

  it("migrate file tab keeps paths; ignores content blob; derives label", () => {
    const tab = migrateCenterTab({
      kind: "file",
      id: "f1",
      rootPath: "/repo",
      relPath: "a/b.ts",
      content: "STALE",
    });
    expect(tab).toEqual({
      kind: "file",
      id: "f1",
      label: "b.ts",
      rootPath: "/repo",
      relPath: "a/b.ts",
    });
  });

  it("migrate skips invalid file entries; ensures ≥1 terminal per context", () => {
    const out = migrateTabsByContext({
      ctx: [
        { kind: "file", id: "bad" }, // missing paths
        {
          kind: "file",
          id: "f1",
          rootPath: "/r",
          relPath: "x.ts",
          label: "x.ts",
        },
      ],
    });
    expect(out.ctx!.some(isTerminalTab)).toBe(true);
    expect(out.ctx!.filter(isFileTab)).toHaveLength(1);
  });

  it("findFileTabByPath matches root+rel within list", () => {
    const tabs = [
      createTerminalTab(1),
      createFileTab({ rootPath: "/r", relPath: "a.ts" }),
      createFileTab({ rootPath: "/r", relPath: "b.ts" }),
    ];
    expect(findFileTabByPath(tabs, "/r", "b.ts")?.relPath).toBe("b.ts");
    expect(findFileTabByPath(tabs, "/r", "missing.ts")).toBeUndefined();
  });

  it("closeFileTabResult prefers previous neighbor", () => {
    const t1 = createTerminalTab(1);
    const f1 = createFileTab({ rootPath: "/r", relPath: "a.ts", id: "fa" });
    const f2 = createFileTab({ rootPath: "/r", relPath: "b.ts", id: "fb" });
    const tabs = [t1, f1, f2];
    const result = closeFileTabResult(tabs, "fb");
    expect(result?.tabs.map((t) => t.id)).toEqual([t1.id, "fa"]);
    expect(result?.activeTabId).toBe("fa");
  });

  it("closeFileTabResult on last remaining tab ensures a terminal", () => {
    const f1 = createFileTab({ rootPath: "/r", relPath: "only.ts", id: "fa" });
    const result = closeFileTabResult([f1], "fa");
    expect(result?.tabs).toHaveLength(1);
    expect(result?.tabs[0] && isTerminalTab(result.tabs[0])).toBe(true);
    expect(result?.activeTabId).toBe(result?.tabs[0]?.id);
  });
});
```

Keep existing `nextTerminalTabIndex` / `sessionIdsForTab` tests; update `migrateTerminalTab` usages to `migrateCenterTab` or keep a thin alias.

- [x] **Step 2: Run — expect FAIL**

```bash
bun test src/lib/terminal/terminal-tab.test.ts
```

Expected: missing exports / `kind` assertions fail.

- [x] **Step 3: Implement model + migrate + helpers**

In `terminal-tab.ts`:

1. Define `TerminalTab` / `FileTab` / `CenterTab` as above.
2. `createTerminalTab`: add `kind: "terminal"` (rest unchanged).
3. `createFileTab`: `id = args.id ?? crypto.randomUUID()`, `label = fileNameFromRel(relPath)`.
4. `migrateCenterTab`:
   - If `kind === "file"`: require string `id`, `rootPath`, `relPath`; `label` from field or basename; return `FileTab` (never persist/return content).
   - Else (missing kind or `"terminal"`): existing v1/v2 terminal migrate + set `kind: "terminal"`.
   - Invalid → `null`.
5. `migrateTabsByContext`: map with `migrateCenterTab`; then for each context with tabs, if `!tabs.some(isTerminalTab)`, append `createTerminalTab(1)`.
6. Implement `findFileTabByPath`, `closeFileTabResult` (neighbor: index-1 then index, else ensure terminal).
7. `sessionIdsForTab(tab: TerminalTab)` unchanged.

Optional: keep `migrateTerminalTab` as deprecated alias calling `migrateCenterTab` + assert terminal for old tests.

- [x] **Step 4: Run — expect PASS**

```bash
bun test src/lib/terminal/terminal-tab.test.ts
```

- [x] **Step 5: Commit**

```bash
git add src/lib/terminal/terminal-tab.ts src/lib/terminal/terminal-tab.test.ts
git commit -m "feat(tabs): CenterTab model and migrate helpers"
```

---

### Task 2: App strip — unified tabs; remove chip/`centerSurface`; open + content switch

**Files:**
- Modify: `src/App.tsx` (state ~316–342, persist ~159–164 / 258–289 / 635–659, open/close ~544–565, ensure-tab ~690–694, add/close/split/rename ~863–1054, strip ~1755–1835, warm body ~1943–2006, FilePreview mount, agents types)
- Modify: `src/lib/agents/resolve-session.ts` (and tests if types break)
- Modify: `src/lib/agents/build-rows.ts` (import `CenterTab` if needed)
- Modify/delete helpers: `src/lib/files/preview-chip.ts` (+ test) — remove `CenterSurface` / `closePreviewState`

**Interfaces (App):**

```ts
import {
  type CenterTab,
  type FileTab,
  type TerminalTab,
  closeFileTabResult,
  createFileTab,
  createTerminalTab,
  findFileTabByPath,
  isFileTab,
  isTerminalTab,
  migrateTabsByContext,
  nextTerminalTabIndex,
  sessionIdsForTab,
} from "@/lib/terminal/terminal-tab";

type PersistedTerminalState = {
  version?: number;
  selection?: Selection;
  tabsByContext?: Record<string, CenterTab[]>;
  activeTabByContext?: Record<string, string>;
};

// Ephemeral only — not written to octopus.terminal.state
// Prefer map keyed by tab id so inactive file tabs can drop content freely
const [fileContentByTabId, setFileContentByTabId] = useState<Record<string, string>>({});
```

Rules to wire:

| Concern | Behavior |
|---|---|
| Persist write | Same `version: 2` (or bump if you prefer clarity; migration is backward-compatible either way). Serialize terminal fields + file `{ kind, id, label, rootPath, relPath }` only — strip any content. |
| Open file | `findFileTabByPath` in current context → if hit, set active + re-read into `fileContentByTabId[id]`; else `fsReadTextFile` success → append `createFileTab` + activate + store content; failure → toast only (no tab). |
| Activate file tab (click) | Set `activeTabByContext`; re-read; on failure toast, keep tab selected (content empty/prior per FilePreview). |
| Activate terminal tab | Set active; render workspace (no surface flag). |
| Close file tab | `closeFileTabResult`; update state; clear that id from `fileContentByTabId`. |
| Close terminal tab | Existing rules but count **terminal** tabs for “at least one terminal”: never close the last terminal even if file tabs remain; `sessionIdsForTab` only on `isTerminalTab`; disable X when `selectedTabs.filter(isTerminalTab).length <= 1` **for terminal chips**; file chip X always enabled (helper ensures terminal if last). |
| Context menu / rename / split | Only for `isTerminalTab`; ignore or no-op on file tabs (no context menu on file, or menu items hidden). |
| `+` / `addTerminalTab` | Unchanged; still `createTerminalTab(nextTerminalTabIndex(...))` — ordinals ignore file labels naturally. |
| Warm mounts flatMap | Skip `!isTerminalTab(tab)`; visible when `activeTabId === tab.id` (no `centerSurface`). |
| Center body | If active tab is file → full-bleed `FilePreview`; else terminal warm mounts / empty as today. |
| Left selection | Tabs remain keyed by `contextId` (no clear of other contexts’ file tabs). |

- [x] **Step 1: Narrow agents lookup for mixed tabs**

```ts
// resolve-session.ts
import type { CenterTab } from "@/lib/terminal/terminal-tab";
import { isTerminalTab } from "@/lib/terminal/terminal-tab";

export function findSessionLocation(
  tabsByContext: Record<string, CenterTab[]>,
  sessionId: string,
): SessionLocation | null {
  for (const [contextId, tabs] of Object.entries(tabsByContext)) {
    for (const tab of tabs) {
      if (!isTerminalTab(tab)) continue;
      for (const [leafId, sid] of Object.entries(tab.sessionByLeafId)) {
        if (sid === sessionId) {
          return { contextId, tabId: tab.id, leafId };
        }
      }
    }
  }
  return null;
}
```

Update `build-rows.ts` / tests to `CenterTab[]` (fixtures get `kind: "terminal"`).

- [x] **Step 2: Replace App preview surface state**

Remove:

- `FilePreviewState` / `filePreview` / `centerSurface`
- imports of `CenterSurface`, `closePreviewState`
- faux chip JSX after terminal map
- all `setCenterSurface(...)` call sites

Add:

- `tabsByContext` typed `Record<string, CenterTab[]>`
- `fileContentByTabId` state
- `handleOpenFilePreview` create-or-focus + read
- `activateCenterTab(tabId)` that re-reads when target is file
- `closeCenterTab(tabId)` dispatching file vs terminal close

Sketch — open:

```ts
const handleOpenFilePreview = useCallback(
  async (args: { rootPath: string; relPath: string }) => {
    if (!selectedContextId) return;
    const tabs = tabsByContext[selectedContextId] ?? [];
    const existing = findFileTabByPath(tabs, args.rootPath, args.relPath);
    try {
      const content = await api.fsReadTextFile(args.rootPath, args.relPath);
      if (existing) {
        setActiveTabByContext((c) => ({ ...c, [selectedContextId]: existing.id }));
        setFileContentByTabId((c) => ({ ...c, [existing.id]: content }));
        return;
      }
      const tab = createFileTab(args);
      setTabsByContext((c) => ({
        ...c,
        [selectedContextId]: [...(c[selectedContextId] ?? []), tab],
      }));
      setActiveTabByContext((c) => ({ ...c, [selectedContextId]: tab.id }));
      setFileContentByTabId((c) => ({ ...c, [tab.id]: content }));
    } catch (error) {
      toast.error(invokeError(error));
    }
  },
  [selectedContextId, tabsByContext],
);
```

Sketch — unified strip map (both kinds):

```tsx
{selectedTabs.map((tab) => {
  const active = tab.id === activeTabId;
  const isFile = isFileTab(tab);
  return (
    <div
      key={tab.id}
      ref={active ? activeTabElementRef : undefined}
      className={cn(
        "group flex h-9 max-w-48 shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-sm",
        active
          ? "border-border bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:bg-background/70",
      )}
      onContextMenu={
        isFile
          ? undefined
          : (event) => {
              event.preventDefault();
              setTabContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
            }
      }
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        title={isFile ? tab.relPath : undefined}
        onClick={() => void activateCenterTab(tab.id)}
      >
        {tab.label}
      </button>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
        onClick={() => closeCenterTab(tab.id)}
        disabled={!isFile && selectedTabs.filter(isTerminalTab).length <= 1}
        aria-label={isFile ? "关闭预览" : `关闭${tab.label}`}
        title={
          isFile
            ? "关闭预览"
            : selectedTabs.filter(isTerminalTab).length <= 1
              ? "至少保留一个终端"
              : `关闭${tab.label}`
        }
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
})}
```

Sketch — content switch (replace chip gate):

```tsx
{(() => {
  const activeTab = selectedTabs.find((t) => t.id === activeTabId);
  if (activeTab && isFileTab(activeTab)) {
    return (
      <div className="absolute inset-0">
        <FilePreview
          rootPath={activeTab.rootPath}
          relPath={activeTab.relPath}
          content={fileContentByTabId[activeTab.id] ?? ""}
          onClose={() => closeCenterTab(activeTab.id)}
        />
      </div>
    );
  }
  return null;
})()}
```

Warm `TerminalWorkspace` flatMap: `if (!isTerminalTab(tab)) return [];` and `visible = selectedContextId === context.id && activeTabId === tab.id` (drop `centerSurface === "terminal"`).

Split / close pane / rename: early-return unless `isTerminalTab(tab)`.

`closeTerminalTabs`: when computing “would remove all tabs”, instead refuse if it would remove the **last terminal** (`tabs.filter(isTerminalTab)`); file tabs may remain. When killing sessions, only iterate terminal tabs in `idsToClose`.

- [x] **Step 3: Delete surface helpers from preview-chip**

Keep `fileNameFromRel` export (FilePreview + `createFileTab` may import it). Remove `CenterSurface` and `closePreviewState`. Update `preview-chip.test.ts` to basename-only tests.

- [x] **Step 4: Typecheck + unit tests**

```bash
bunx tsc --noEmit
bun test src/lib/terminal/terminal-tab.test.ts src/lib/files/preview-chip.test.ts src/lib/agents/
```

Expected: PASS; no remaining `centerSurface` / `filePreview` / `closePreviewState` references.

- [x] **Step 5: Commit**

```bash
git add src/App.tsx src/lib/terminal/terminal-tab.ts src/lib/agents/resolve-session.ts src/lib/agents/build-rows.ts src/lib/agents/*.test.ts src/lib/files/preview-chip.ts src/lib/files/preview-chip.test.ts
git commit -m "feat(files): unified center tabs for file preview"
```

---

### Task 3: FilePreview polish + tsc + manual acceptance

**Files:**
- Modify: `src/components/FilePreview.tsx` (minor polish only if needed)
- Touch App only if header `showHeader` wiring desired

**Interfaces:** keep existing props; optional `showHeader={false}` once strip is primary chrome (spec allows header X = same as tab X). Prefer keep header initially for parity.

- [x] **Step 1: Confirm FilePreview full-bleed**

Ensure parent is `absolute inset-0` / `h-full min-h-0`; `pre` scrolls. No chip-specific copy beyond `关闭预览`.

- [x] **Step 2: Final verify**

```bash
bunx tsc --noEmit
bun test src/lib/terminal/terminal-tab.test.ts src/lib/files/preview-chip.test.ts src/lib/agents/
```

- [ ] **Step 3: Manual acceptance (match spec)**

Run: `bun run tauri:dev`

Checklist:

1. Open a text file from Files → real strip tab appears (or focuses existing same path); center full-bleed `FilePreview`.
2. Open a second distinct file → second file tab; both remain in strip with terminals.
3. Re-open the first path → focuses existing file tab; no duplicate.
4. Click a terminal tab → `TerminalWorkspace`; file tabs stay in strip.
5. Click a file tab → that preview; content re-read on activate.
6. Close a file tab → removed; neighbor activates (prefer previous); `+` still terminal-only.
7. Close last file when it was the only tab → a default terminal tab remains/created.
8. Cannot close the last **terminal** tab while file tabs exist (or alone).
9. Reload → file tab chips restore (paths); activate re-reads content.
10. Old persisted tabs without `kind` load as terminals.
11. Faux chip and `centerSurface` gone; no horizontal terminal\|preview split.
12. Failed open → toast, no new tab; failed re-read → toast, tab stays selected.
13. Left selection change does not clear other contexts’ file tabs.
14. File tabs: no split context menu; Agents session jump still finds terminal sessions only.

- [x] **Step 4: Commit** (if polish diffs remain)

```bash
git add src/components/FilePreview.tsx src/App.tsx
git commit -m "feat(files): FilePreview polish for center file tabs"
```

(Skip empty commit if Task 2 already covered polish.)

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| `CenterTab` `kind: terminal \| file` | 1 |
| Multi file tabs; same path focuses | 2 |
| Content: terminal→Workspace; file→FilePreview | 2–3 |
| Persist paths; re-read on activate; migrate missing kind→terminal | 1–2 |
| Remove faux chip + `centerSurface` | 2 |
| `+` terminal only | 2 |
| Close file → neighbor / ensure terminal | 1–2 |
| Failed open/re-read toasts without corrupt tabs | 2 |
| No Rust; Files module unchanged | respected |
| Acceptance checklist | 3 |

## Placeholder scan

No TBD / “implement later” left in tasks.
