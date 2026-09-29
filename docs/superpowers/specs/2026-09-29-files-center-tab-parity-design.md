# Unified center tabs: file preview parity

**Date:** 2026-09-29  
**Status:** approved  
**Approach:** A — unify strip as `CenterTab` (`kind: "terminal" | "file"`); multi file tabs; drop faux chip + `centerSurface`  
**Supersedes:** preview *presentation* in `docs/superpowers/specs/2026-09-29-files-preview-sibling-tab-design.md` (and, transitively, the horizontal-split presentation noted there from `docs/superpowers/specs/2026-09-29-files-right-rail-design.md`). Files right-rail tree, fs commands, and read-only `FilePreview` content remain as specified in the right-rail / sibling-tab chain.

## Problem

Sibling-tab Approach A put file preview on a **faux strip chip** beside real `TerminalTab`s, gated by `centerSurface: "terminal" | "preview"`. That gives one replace-only file chip, split UX (real tabs vs fake chip), and no persistence for open files. The user wants file previews as **first-class center tabs** with the same strip select/close behavior as terminals, and **multiple** file tabs.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Model | Unify strip entries as `CenterTab` with `kind: "terminal" \| "file"` |
| Multi file | Multiple file tabs per context; reopen same `rootPath` + `relPath` **focuses** the existing tab (no duplicate) |
| Content | `terminal` → `TerminalWorkspace`; `file` → full-bleed `FilePreview` |
| Persistence | Persist in `tabsByContext`; migrate missing `kind` → `"terminal"`; file tabs store paths only, **re-read** content on activate |
| Remove | Faux chip, `centerSurface`, replace-only single `filePreview` surface switch |
| `+` button | Creates **terminal** tab only |
| Rust | **No** Rust / fs API changes |
| Non-goals | Monaco, rich previews, write/save, stuffing file into `PaneManager`, split menus on file tabs |

## Layout

```
[ center tab(s): terminal and/or file ] [ + new terminal ]
```

- One strip; file and terminal chips share select + close (X).
- Context menus / split actions remain **terminal-only** (file tabs have no pane split).
- `+` always appends a new terminal tab (unchanged label ordinal rules).

### Interaction

| Action | Result |
|---|---|
| Click terminal tab | Activate that tab; render `TerminalWorkspace` |
| Click file tab | Activate that tab; render full-bleed `FilePreview` (re-read if needed) |
| Close terminal tab | Existing terminal close / last-tab rules |
| Close file tab | Remove that file tab; activate a neighbor (prefer previous; else next; if none left in context, ensure at least one terminal tab per existing rules) |
| Open file from Files rail | If a file tab with same `rootPath` + `relPath` exists in current context → activate it; else append a new file tab and activate |
| Failed open / re-read | Toast; do **not** create or corrupt the tab (new open: no tab; activate re-read: keep tab, show error empty/prior UI per `FilePreview`) |
| Left selection change | Tabs stay keyed by `contextId` in `tabsByContext` (same as terminals); do not clear other contexts’ file tabs |

## State

Replace separate `filePreview` + `centerSurface` with a unified tab list already stored as `tabsByContext` / `activeTabByContext`.

```ts
type CenterTab =
  | {
      kind: "terminal";
      id: string;
      label: string;
      layout: PaneLayoutNode;
      activeLeafId: string;
      sessionByLeafId: Record<string, string>;
    }
  | {
      kind: "file";
      id: string;
      label: string; // basename of relPath
      rootPath: string;
      relPath: string;
      // content is NOT persisted; held in ephemeral UI state while active / after successful read
    };
```

Runtime content for the active file tab (ephemeral):

```ts
fileContentByTabId: Record<string, string> // or single activeFileContent; cleared/refreshed on activate
```

Rules:

- **Identity:** file tab uniqueness key = (`rootPath`, `relPath`) within a context.
- **Open:** `fsReadTextFile`; on success → create/focus file tab + set ephemeral content; on failure → toast only.
- **Activate existing file tab:** re-read from disk (simpler than stale cache); failure → toast, keep tab selected.
- **Terminal fields** unchanged for `kind: "terminal"` (warm mounts, PaneManager, parking).
- **Do not** treat file tabs as PTY sessions; no `sessionByLeafId` / layout on file kind.

## Persistence & migration

`octopus.terminal.state` continues to own `tabsByContext` / `activeTabByContext` (version bump only if needed for clarity; migration must be backward-compatible either way).

On load, for each tab entry:

1. If `kind` missing → treat as `"terminal"` (current shape).
2. If `kind === "file"` → require `id`, `rootPath`, `relPath`; derive `label` from basename if missing; **ignore** any persisted content blob.
3. Invalid file entries skipped; contexts must still satisfy “at least one terminal tab” — if a context would be file-only or empty after migrate, ensure a default terminal tab (same guarantee as today).

Write path: persist terminal tabs as today + file tabs as `{ kind: "file", id, label, rootPath, relPath }` only.

## Boundaries

- Touch mainly `App.tsx` tab strip / content switch, `terminal-tab` migrate helpers (or adjacent center-tab module), `FilePreview.tsx`, and remove `preview-chip` / `centerSurface` paths from sibling-tab Approach A.
- Files module still calls `onOpenFilePreview({ rootPath, relPath })`; App maps that to create-or-focus file `CenterTab`.
- **No Rust changes.**
- Non-goals: Monaco / syntax highlight, image/Markdown/etc., write/save, file-tab split or PaneManager integration, changing Files tree behavior.

## Acceptance

1. Opening a file adds a real strip tab (or focuses an existing same-path tab); center shows full-bleed `FilePreview`.
2. Multiple distinct files → multiple file tabs; same path reopen focuses, does not duplicate.
3. Clicking a terminal tab shows `TerminalWorkspace`; file tabs remain in the strip.
4. Clicking a file tab shows that file’s preview (content re-read on activate).
5. Closing a file tab removes it; strip/`+` behavior for terminals unchanged (`+` never creates a file tab).
6. Reload restores file tab chips (paths); activating re-reads content.
7. Old persisted tabs without `kind` still load as terminals.
8. Faux chip and `centerSurface` are gone; no horizontal terminal\|preview split.
9. Failed open/re-read toasts without inventing duplicate or corrupt tabs.

## Out of scope / follow-ups

- Dirty detection / watch-based refresh for open file tabs.
- Cross-context “same path” dedup.
- Drag-reorder mixed kinds beyond what the strip already supports for terminals.
