# Files Preview Sibling Center Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the terminal|preview horizontal split with a single faux file chip in the center tab strip and full-width `centerSurface` switching between terminals and `FilePreview`.

**Architecture:** Approach A from the approved spec. `App.tsx` owns `filePreview` plus `centerSurface: "terminal" | "preview"`. Opening a file (via existing `onOpenFilePreview`) sets/replaces preview content and flips surface to `"preview"`. A faux chip after terminal tabs toggles surface; terminal tab clicks set surface to `"terminal"` without clearing preview. Closing the chip (or optional preview header X) clears preview and returns to terminals. `TerminalTab` / warm mounts / persistence stay unchanged — preview is not a `TerminalTab`. No Rust.

**Tech Stack:** React 19, Vite, bun, TypeScript; existing `api.fsReadTextFile` / Files right-rail module unchanged.

## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agents for code edits.
- **No Rust changes.** FE only: mainly `src/App.tsx` + `src/components/FilePreview.tsx`.
- Single file preview chip; opening another file **replaces** label + content.
- Keep preview chip when switching terminal tabs and when `selectedContextId` / `filesRootPath` changes (remove clear-on-selection effect).
- Remove horizontal split and all `octopus.center-preview.width` persistence / resize chrome.
- Preview is **not** stuffed into `PaneManager` / `TerminalTab`.
- Chinese UI copy for close: `关闭预览` (chip X and optional header X).
- Non-goals: multi file tabs, Monaco, rich previews, write.

**Spec:** `docs/superpowers/specs/2026-09-29-files-preview-sibling-tab-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `src/App.tsx` | Add `centerSurface`; file chip in tab strip; open/close/toggle wiring; gate center body by surface; delete split + width persistence + clear-on-selection effect |
| `src/components/FilePreview.tsx` | Full-bleed preview body; optional header (chip is primary chrome); keep `关闭预览` |
| `src/lib/files/preview-chip.ts` (optional) | Tiny pure helpers: basename from `relPath`, close-preview next-state — TDD if extracted |
| `src/lib/files/preview-chip.test.ts` (optional) | Vitest for those helpers |
| `src/components/right-rail/modules/files.tsx` | **Do not change** — still calls `onOpenFilePreview` |
| Rust / `src-tauri/**` | **Do not touch** |

Strip order after change:

```
[ terminal tab(s) ] [ optional file chip ] [ + new terminal ]
```

---

### Task 1: `centerSurface` + file chip + remove split

**Files:**
- Modify: `src/App.tsx` (state ~351–356, clear effect ~566–568, open handler ~570–584, width persist ~168–171 / 251–260 / 444–460, tab strip ~1777–1825, center body ~1931–2074)
- Create (optional): `src/lib/files/preview-chip.ts`
- Test (optional): `src/lib/files/preview-chip.test.ts`

**Interfaces:**

```ts
// App state (replace width/resize refs with surface)
type FilePreviewState = {
  rootPath: string;
  relPath: string;
  content: string;
} | null;

type CenterSurface = "terminal" | "preview";

// Optional helper (keeps App thinner; share basename with FilePreview)
export function fileNameFromRel(relPath: string): string;
export function closePreviewState(surface: CenterSurface): {
  filePreview: null;
  centerSurface: CenterSurface;
};
// closePreviewState: always filePreview=null; if surface==="preview" → centerSurface="terminal", else keep surface
```

- [ ] **Step 1 (optional TDD): Write failing helper tests**

```ts
// src/lib/files/preview-chip.test.ts
import { describe, expect, it } from "vitest";
import { closePreviewState, fileNameFromRel } from "./preview-chip";

describe("preview-chip", () => {
  it("basename from relPath", () => {
    expect(fileNameFromRel("src/App.tsx")).toBe("App.tsx");
    expect(fileNameFromRel("README.md")).toBe("README.md");
  });

  it("close from preview returns to terminal", () => {
    expect(closePreviewState("preview")).toEqual({
      filePreview: null,
      centerSurface: "terminal",
    });
  });

  it("close while already on terminal still clears preview", () => {
    expect(closePreviewState("terminal")).toEqual({
      filePreview: null,
      centerSurface: "terminal",
    });
  });
});
```

- [ ] **Step 2 (optional): Run — expect FAIL**

```bash
bun test src/lib/files/preview-chip.test.ts
```

Expected: module not found / FAIL.

- [ ] **Step 3 (optional): Implement helpers**

```ts
// src/lib/files/preview-chip.ts
export type CenterSurface = "terminal" | "preview";

export function fileNameFromRel(relPath: string): string {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || relPath;
}

export function closePreviewState(surface: CenterSurface): {
  filePreview: null;
  centerSurface: CenterSurface;
} {
  return {
    filePreview: null,
    centerSurface: surface === "preview" ? "terminal" : surface,
  };
}
```

- [ ] **Step 4 (optional): `bun test src/lib/files/preview-chip.test.ts` — PASS**

If skipping the helper, inline the same basename/close logic in `App.tsx` / keep `fileNameFromRel` inside `FilePreview.tsx`.

- [ ] **Step 5: App state — add `centerSurface`, delete width/split machinery**

In `src/App.tsx`:

1. **Delete** constants/helpers/state/effects for center preview width:
   - `CENTER_PREVIEW_WIDTH_KEY`, `DEFAULT_CENTER_PREVIEW_WIDTH`, `MIN_CENTER_PREVIEW_WIDTH`, `MAX_CENTER_PREVIEW_WIDTH`
   - `readCenterPreviewWidth`
   - `centerPreviewWidth` / `isResizingCenterPreview` / `centerSplitRef` / `centerPreviewShellRef` / `centerPreviewResizePointerRef`
   - `useEffect` that `localStorage.setItem(CENTER_PREVIEW_WIDTH_KEY, …)`
   - Drop `isResizingCenterPreview` from the body `cursor`/`userSelect` effect (keep sidebar + right-rail only)

2. **Add:**

```ts
const [filePreview, setFilePreview] = useState<FilePreviewState>(null);
const [centerSurface, setCenterSurface] = useState<CenterSurface>("terminal");
```

3. **Delete** the clear-on-selection effect entirely:

```ts
// DELETE this block — supersedes old-spec “clears open preview” on left selection
// useEffect(() => { setFilePreview(null); }, [selectedContextId, filesRootPath]);
```

4. **Update open handler** — on success set preview **and** surface; on failure toast only (no chip/state change):

```ts
const handleOpenFilePreview = useCallback(
  async (args: { rootPath: string; relPath: string }) => {
    try {
      const content = await api.fsReadTextFile(args.rootPath, args.relPath);
      setFilePreview({
        rootPath: args.rootPath,
        relPath: args.relPath,
        content,
      });
      setCenterSurface("preview");
    } catch (error) {
      toast.error(invokeError(error));
    }
  },
  [],
);

const handleCloseFilePreview = useCallback(() => {
  const next = closePreviewState(centerSurface); // or inline equivalent
  setFilePreview(next.filePreview);
  setCenterSurface(next.centerSurface);
  // activeTabId unchanged — last terminal tab remains the active one when surface returns to terminal
}, [centerSurface]);
```

- [ ] **Step 6: Tab strip — file chip after terminal tabs, before `+`**

Inside `tabsContentRef` div, **after** `selectedTabs.map(...)`, **before** `{!tabsOverflowing && newTerminalButton}`:

```tsx
{filePreview ? (
  <div
    className={cn(
      "group flex h-9 max-w-48 shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-sm",
      centerSurface === "preview"
        ? "border-border bg-background text-foreground"
        : "border-transparent text-muted-foreground hover:bg-background/70",
    )}
  >
    <button
      type="button"
      className="min-w-0 flex-1 truncate text-left"
      title={filePreview.relPath}
      onClick={() => setCenterSurface("preview")}
    >
      {fileNameFromRel(filePreview.relPath)}
    </button>
    <button
      type="button"
      className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100"
      onClick={handleCloseFilePreview}
      aria-label="关闭预览"
      title="关闭预览"
    >
      <XIcon className="size-3.5" />
    </button>
  </div>
) : null}
```

Update **terminal tab** click + active styling so surface flips and chip wins when preview is showing:

```tsx
// active visual for a terminal tab:
const active = tab.id === activeTabId && centerSurface === "terminal";

// onClick terminal tab label:
onClick={() => {
  if (!selectedContextId) return;
  setActiveTabByContext((current) => ({
    ...current,
    [selectedContextId]: tab.id,
  }));
  setCenterSurface("terminal");
}}
```

`+` / `newTerminalButton` behavior unchanged (still creates a terminal tab).

- [ ] **Step 7: Center body — full-bleed by surface; delete split JSX**

Replace the `centerSplitRef` flex-row + separator + preview shell with a single full-bleed container:

```tsx
<div className="relative min-h-0 flex-1">
  {/* terminals: visible only when surface===terminal (and existing context/tab match) */}
  {terminalContexts.flatMap((context) =>
    (tabsByContext[context.id] ?? []).flatMap((tab) => {
      if (!warmMountKeys.has(warmMountKey(context.id, tab.id))) {
        return [];
      }
      const visible =
        centerSurface === "terminal" &&
        selectedContextId === context.id &&
        activeTabId === tab.id;
      return [
        <div
          key={`${context.id}::${tab.id}`}
          className={
            visible
              ? "absolute inset-0"
              : "pointer-events-none invisible absolute inset-0"
          }
        >
          <TerminalWorkspace
            tab={tab}
            cwdId={context.cwdId}
            active={visible}
            /* …existing onChange / onSplitLeaf / onCloseLeaf… */
          />
        </div>,
      ];
    }),
  )}

  {!showTerminal && centerSurface === "terminal" ? (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <EmptyMain /* …existing props… */ />
    </div>
  ) : null}

  {filePreview && centerSurface === "preview" ? (
    <div className="absolute inset-0">
      <FilePreview
        rootPath={filePreview.rootPath}
        relPath={filePreview.relPath}
        content={filePreview.content}
        onClose={handleCloseFilePreview}
      />
    </div>
  ) : null}
</div>
```

Delete the entire `{filePreview ? (<> separator … shell … </>) : null}` block and `centerSplitRef` wrapper.

- [ ] **Step 8: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: PASS (no leftover `CENTER_PREVIEW_*` / resize refs).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/lib/files/preview-chip.ts src/lib/files/preview-chip.test.ts
git commit -m "feat(files): preview as sibling center tab chip"
```

(Omit helper paths from `git add` if you inlined.)

---

### Task 2: FilePreview full-bleed polish + acceptance

**Files:**
- Modify: `src/components/FilePreview.tsx`
- Modify (if basename moved): re-export/import `fileNameFromRel` from `src/lib/files/preview-chip.ts`

**Interfaces:**

```ts
export type FilePreviewProps = {
  rootPath: string;
  relPath: string;
  content: string;
  onClose: () => void;
  /** When false, chip is sole chrome; default true keeps header X (same as chip close). */
  showHeader?: boolean;
};
```

- [ ] **Step 1: Polish `FilePreview` for full-bleed**

```tsx
export function FilePreview({
  relPath,
  content,
  onClose,
  showHeader = true,
}: FilePreviewProps) {
  const fileName = fileNameFromRel(relPath);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {showHeader ? (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
          <span className="min-w-0 flex-1 truncate text-sm" title={relPath}>
            {fileName}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭预览"
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
}
```

App may pass `showHeader={false}` once the strip chip is primary chrome, or leave default `true` (spec: header X if kept = same as chip X). Prefer keeping header initially for parity, then optionally hide in a follow-up if redundant.

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun test src/lib/files/preview-chip.test.ts
```

(Skip second command if helper not extracted.)

- [ ] **Step 3: Manual acceptance (match spec)**

Run: `bun run tauri:dev`

Checklist:

1. Open a text file from Files → one file chip appears **after** terminal tabs; center is **full-width** preview (`centerSurface = preview`).
2. Click a terminal tab → full-width terminals; file chip stays, inactive styling.
3. Click file chip → full-width preview again.
4. Close chip X (or header X) → preview gone; if surface was preview, terminals show with last active terminal tab.
5. Change left main/worktree selection → preview chip **remains** (not cleared).
6. Failed open (binary / oversize / missing) → toast only; chip/content unchanged.
7. No horizontal split; no drag handle; `octopus.center-preview.width` unused (constant/readers removed). Open a second file → chip label/content **replaced**, still one chip.
8. `+` still creates a new terminal tab only.

- [ ] **Step 4: Commit**

```bash
git add src/components/FilePreview.tsx src/App.tsx
git commit -m "feat(files): full-bleed FilePreview for sibling tab surface"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Single replaceable file chip after terminal tabs | 1 |
| `centerSurface` terminal \| preview | 1 |
| Open → set preview + surface=preview; fail → toast only | 1 |
| Terminal click → surface=terminal; chip stays | 1 |
| Chip click → surface=preview | 1 |
| Close chip/header → clear; if was preview, show terminals | 1–2 |
| Left selection does **not** clear preview | 1 (delete effect) |
| Remove horizontal split + `octopus.center-preview.width` | 1 |
| No Rust; Files module still `onOpenFilePreview` | respected |
| Full-bleed preview polish | 2 |
| Acceptance checklist | 2 |

## Placeholder scan

No TBD / “implement later” left in tasks.
