# Files right-rail + center text preview (Phase 1)

**Date:** 2026-09-29  
**Status:** draft → pending user review  
**Approach:** A — custom Tauri fs commands + Files registry module + center terminal|preview split

> **Superseded (preview presentation only):** terminal\|preview horizontal split replaced by sibling center tab — see `docs/superpowers/specs/2026-09-29-files-preview-sibling-tab-design.md`.

## Goal

Add an Orca-inspired **Files** experience to Octopus:

1. Right-rail **Files** module: browse the directory tree of the currently selected left-sidebar workspace (main repo or worktree).
2. Center **persistent split**: `[Terminal | read-only text preview]`. Opening a file fills the preview pane; closing it restores terminal full width.
3. Tree uses **virtual scrolling** for large directories (Phase 1 requirement).

## Locked product choices

| Topic | Choice |
|---|---|
| Scope | File tree + read-only **plain text** preview |
| Preview placement | Persistent center split (terminal \| preview) |
| Tree root | Follows left selection: project main path **or** worktree path |
| Refresh | Manual / re-read on expand and on selection change (no fs watch) |
| Implementation | Custom Tauri `fs_read_dir` / `fs_read_text_file` + FE modules |
| Virtual scroll | **In scope** for the directory tree |

## Layout

```
[ Left sidebar | Center: Terminal | Preview | Right rail ]
```

- **Left:** selecting main or worktree sets Files `rootPath` and clears open preview.
- **Center:** when a file is open, show a resizable split; empty state when none; close control collapses preview so terminal is full width. Split ratio persisted (localStorage).
- **Right:** ActivityBar modules: existing `agents` + new `files`. Files module hosts the virtualized tree + refresh control.

## Data flow

```
FilesModule (expand / refresh)
  → api.fsReadDir(root, rel)
    → Tauri fs_read_dir
      → canonicalize; must stay under root
      → readdir; dirs-first sort; return DirEntry[]

click file
  → api.fsReadTextFile(root, rel)
    → Tauri fs_read_text_file
      → same path jail
      → size cap (~1–2 MiB); UTF-8; binary sniff → soft error "不可预览"
  → App sets preview { root, rel, content } → FilePreview pane
```

### Rust surfaces (sketch)

```rust
struct DirEntry { name: String, kind: "dir" | "file" | "symlink", /* optional */ }
fn fs_read_dir(root: PathBuf, rel: String) -> Result<Vec<DirEntry>, String>;
fn fs_read_text_file(root: PathBuf, rel: String) -> Result<String, String>;
```

Path jail: resolve `root/rel`, `canonicalize`, reject if outside `canonicalize(root)`.

### FE surfaces

- `src/components/right-rail/modules/files/` — tree + virtual list
- `src/components/FilePreview.tsx` (or similar) — monospace read-only
- Extend `RightRailContext` with `rootPath` / open-file callback
- Register `{ id: "files", title: "Files", ... }` in `registry.tsx`

Virtual list: flatten expanded nodes into rows; only mount visible rows (e.g. `@tanstack/react-virtual` or existing list primitive if present). Expand/collapse updates the flat model without mounting the whole tree DOM.

## Non-goals (Phase 1)

- Monaco edit / save
- Image / Markdown / CSV / PDF preview
- fs watch / auto refresh
- SSH / WSL / arbitrary folder workspaces (Orca `WorkspaceScope.folder`)
- Git right-rail module
- Porting Orca Electron FileExplorer components wholesale
- Write / delete / rename
- Full Orca 50MB binary pipeline

## Acceptance (Phase 1)

1. ActivityBar shows Files; switching to it shows tree for current left selection root.
2. Changing left selection reloads tree root and clears preview.
3. Expand directories lazily; Refresh re-reads open dirs / root.
4. Large directories stay scrollable/smooth via virtualization (no full DOM for every entry).
5. Clicking a text file opens center preview; binary/oversize shows clear error; Close returns terminal full width.
6. Paths outside the selected root are rejected by the backend.

## Open follow-ups (not Phase 1)

- Images / Markdown; Monaco; watch; folder/SSH workspaces; git module.
