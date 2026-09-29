# Files preview as sibling center tab

**Date:** 2026-09-29  
**Status:** approved  
**Approach:** A — lightweight faux strip chip + `centerSurface: "terminal" | "preview"`  
**Supersedes:** preview *presentation* portion of `docs/superpowers/specs/2026-09-29-files-right-rail-design.md` (terminal|preview horizontal split). Files right-rail tree, fs commands, and read-only text preview content remain as specified there.

## Problem

Phase 1 FilePreview used a terminal|preview **horizontal split** under the tab strip (`octopus.center-preview.width`). The user wants preview as a **sibling tab chip** in the **same strip** as terminal tabs — not nested inside terminal content.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Preview tabs | **Single** file preview tab; opening another file **replaces** chip label + content |
| Switch away | Keep preview tab when switching to a terminal tab |
| Left selection | Keep preview tab when `selectedContextId` / `filesRootPath` (main/worktree) changes |
| Presentation | Approach A: faux strip chip + `centerSurface` |
| Remove | Horizontal split and `octopus.center-preview.width` persistence |

## Layout

Tab strip order:

```
[ terminal tab(s) ] [ optional file chip ] [ + new terminal ]
```

- File chip sits **after** terminal tabs; **+** stays for new terminal.
- File chip shows filename + close (X).

### Interaction

| Action | Result |
|---|---|
| Click terminal tab | Full-width terminals; `centerSurface = "terminal"`; file chip stays (inactive) |
| Click file chip | Full-width `FilePreview`; `centerSurface = "preview"` |
| Close file chip (X) | Clear `filePreview`; if surface was `"preview"`, activate last terminal tab |
| Open another file | Replace chip label/content; `centerSurface = "preview"` |
| Close via FilePreview header X (if kept) | Same as chip X |

## State

```ts
filePreview: { rootPath: string; relPath: string; content: string } | null
centerSurface: "terminal" | "preview"
```

Rules:

- **Do NOT** clear `filePreview` on `selectedContextId` / `filesRootPath` change (supersedes old-spec “clears open preview” on left selection).
- Open: `fsReadTextFile`; on failure → toast; **no** chip update.
- On success → set `filePreview` + `centerSurface = "preview"`.
- `TerminalTab` / warm mounts / persistence **unchanged**; preview is **not** a `TerminalTab`.

## Boundaries

- Touch mainly `App.tsx` + `FilePreview.tsx`.
- Files module still calls `onOpenFilePreview`.
- **No Rust changes.**
- Non-goals: multi file tabs, Monaco, rich previews, write, stuffing preview into `PaneManager`.

## Acceptance

1. Opening a file adds/replaces one file chip after terminal tabs; center shows full-width preview.
2. Clicking a terminal tab shows full-width terminals; file chip remains inactive.
3. Clicking the file chip returns to full-width preview.
4. Closing the chip (or header X) removes preview; if surface was preview, last terminal tab activates.
5. Changing left selection does **not** clear the preview chip.
6. Failed open shows toast only; chip/content unchanged.
7. No horizontal split; `octopus.center-preview.width` unused/removed.
