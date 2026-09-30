# Files center tab: Monaco editor (editable + highlight + explicit save)

**Date:** 2026-09-30  
**Status:** Approved (design dialogue)  
**Approach:** A — embed Monaco in existing `CenterTab` file tabs  

**Builds on:** `docs/superpowers/specs/2026-09-29-files-center-tab-parity-design.md` (tab model, strip, focus-existing). Files tree / `fs_read_*` remain as in the right-rail chain.

**Supersedes (for file-tab content):** Phase-1 “plain monospace `FilePreview` only” and prior **non-goals** that barred Monaco and write/save for the file surface. Tab chrome parity and terminal|file model stay.

## Goals

- File tabs open text in an **editable** Monaco editor with **syntax highlight** from extension → language map (common dev languages; unknown → plaintext).
- **Explicit save only:** Cmd+S and a Save control; **no** autosave.
- **Dirty marker** on the file tab (e.g. dot beside filename) while buffer ≠ last-saved baseline.
- Closing a **dirty** file tab shows **Save / Don’t save / Cancel**.
- Editor theme follows **App light/dark**.

## Non-goals (this phase)

- Autosave
- Image / binary preview, Markdown rendered preview
- LSP, IntelliSense, format-on-save, git blame, minimap-as-product-requirement
- Stuffing file editors into `PaneManager` / split menus on file tabs
- Changing Files right-rail tree behavior
- Dedicated huge-file Monaco performance program beyond existing read limits

## Architecture

| Piece | Role |
|-------|------|
| `FileEditor` (replace or wrap `FilePreview`) | Hosts Monaco; language from `relPath`; theme from App |
| `CenterTab` `kind: "file"` | Unchanged identity / open / focus-existing / strip close |
| Rust `fs_write_text_file` | Same path jail as `fs_read_text_file` |
| FE `api` | Thin invoke wrapper for write |

### State (per file tab / App ownership)

- **Baseline:** last successfully loaded or saved text
- **Buffer:** Monaco model value
- **`dirty`:** buffer ≠ baseline; drives tab dot and close guard
- Save success → baseline = buffer, clear dirty; failure → toast, keep dirty + buffer

### Data flow

1. Open / activate file tab → `fs_read_text_file` → set Monaco value + language + theme (re-read rules stay consistent with center-tab parity where applicable).
2. Edits → set dirty → show tab marker.
3. Cmd+S or Save → `fs_write_text_file(rootPath, relPath, text)`.
4. Close dirty → modal: Save (write then close) / Don’t save (discard close) / Cancel (stay).
5. Switching away from a dirty tab does **not** autosave; dirty persists.

## Interaction

| Action | Behavior |
|--------|----------|
| Open same `rootPath+relPath` | Focus existing file tab |
| `+` | Terminal tab only |
| Save when not dirty | No-op or brief “already saved” (implementation choice; must not error) |
| Save fails | Toast; tab stays open and dirty |
| Close dirty + Save fails | Do **not** close |
| Read fails on new open | Toast; no new tab (existing Files rule) |

## Language map (common pack)

Map by extension (illustrative, finalize in plan): e.g. `js`/`jsx` → javascript, `ts`/`tsx` → typescript, `json`, `md`/`markdown`, `css`, `html`, `rs` → rust, `toml`, `yml`/`yaml`, etc. Unmapped → `plaintext`.

## Errors

- Write: permission / jail / IO → toast; preserve buffer + dirty.
- Oversized / truncated reads: follow existing read limits; show what was loaded.

## Acceptance (manual)

1. Open `.ts` / `.js` → highlight visible; cursor/selection work.
2. Edit → dirty dot; Save / Cmd+S clears dot and persists on disk.
3. Dirty close → Save / Don’t save / Cancel behave as specified.
4. Toggle App light/dark → Monaco theme follows.
5. Unknown extension opens as editable plaintext.
6. Terminal tabs and strip parity unchanged.

## Out of scope notes for implementers

- Prefer `@monaco-editor/react` or equivalent Vite-friendly Monaco setup with worker config documented in the plan.
- Persist only paths (existing); do **not** persist dirty buffers across app restart in this phase (dirty lost on quit is acceptable unless we later add recovery).
