# Monaco File Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace read-only `FilePreview` body with Monaco so file center tabs are editable with syntax highlight, explicit save (Cmd+S + button), dirty tab marker, and dirty-close confirm; theme follows App light/dark.

**Architecture:** Keep `CenterTab` file tabs and focus-existing. Add path-jailed Rust `write_text_file` + Tauri cmd + `api.fsWriteTextFile`. FE hosts Monaco in `FileEditor` (replace `FilePreview` usage), tracks baseline/buffer/`dirty` per tab id in App, wires Save + close modal. Language from extension map; unknown → plaintext.

**Tech Stack:** React 19, Vite 8, TypeScript, Vitest, Tauri 2, Rust (`fs_browser`), `@monaco-editor/react` + `monaco-editor` (Vite worker setup).

## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agents for code edits.
- Spec: `docs/superpowers/specs/2026-09-30-files-monaco-editor-design.md`.
- Explicit save only — **no** autosave. Dirty close → Save / Don’t save / Cancel.
- Write uses **same path jail** as `read_text_file` (`resolve_under_root`).
- Size / UTF-8 / binary rules for **read** unchanged (`MAX_TEXT_PREVIEW_BYTES`). Write: reject escape; write UTF-8 bytes; do not create parent dirs outside existing file path (overwrite existing file only — if path missing, return clear error; no mkdir in this phase unless file already existed for edit).
- Do **not** persist dirty buffers across restart; paths-only persist stays.
- Do **not** change Files tree, PaneManager, or terminal split menus.
- Chinese UI: 保存 / 不保存 / 取消; save control 保存; close still 关闭 where applicable.
- Common language pack; unmapped → plaintext.
- Theme: follow App light/dark (`vs` / `vs-dark` or equivalent).

**Spec:** `docs/superpowers/specs/2026-09-30-files-monaco-editor-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `src-tauri/src/fs_browser.rs` | `write_text_file(root, rel, content)` + unit tests |
| `src-tauri/src/commands.rs` | `fs_write_text_file` command |
| `src-tauri/src/lib.rs` | Register command |
| `src/lib/api.ts` | `fsWriteTextFile(rootPath, relPath, content)` |
| `src/lib/files/language-from-path.ts` | Extension → Monaco language id |
| `src/lib/files/language-from-path.test.ts` | Vitest map cases |
| `src/components/FileEditor.tsx` | Monaco host: value, onChange, language, theme, Save, Cmd+S |
| `src/components/FilePreview.tsx` | Remove from App path (delete or thin re-export); prefer delete after FileEditor lands |
| `src/App.tsx` | Dirty map; FileEditor wiring; save handler; dirty close modal; tab dot |
| `vite.config.ts` / deps | Monaco + Vite worker plugin as needed |
| `package.json` | Add monaco deps via bun |

---

### Task 1: Rust `write_text_file` + Tauri cmd + api (TDD)

**Files:**
- Modify: `src-tauri/src/fs_browser.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: existing `resolve_under_root`
- Produces:
  - `pub fn write_text_file(root: &Path, rel: &str, content: &str) -> Result<(), String>`
  - `#[tauri::command] fn fs_write_text_file(root_path: String, rel_path: String, content: String) -> Result<(), String>`
  - `api.fsWriteTextFile(rootPath, relPath, content): Promise<void>`

- [ ] **Step 1: Write failing Rust tests** in `fs_browser.rs` tests module

```rust
#[test]
fn write_text_ok_roundtrip() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("a.txt"), b"old").unwrap();
    write_text_file(&root, "a.txt", "new").unwrap();
    assert_eq!(read_text_file(&root, "a.txt").unwrap(), "new");
}

#[test]
fn write_rejects_escape() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let err = write_text_file(&root, "../x.txt", "no").unwrap_err();
    assert!(!err.is_empty());
}
```

- [ ] **Step 2: Run tests — expect fail** (`write_text_file` missing)

```bash
cd src-tauri && cargo test write_text -- --nocapture
```

- [ ] **Step 3: Implement `write_text_file`**

```rust
pub fn write_text_file(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let path = resolve_under_root(root, rel)?;
    // Require existing regular file (edit-only); clear Chinese errors
    let meta = fs::metadata(&path).map_err(|e| format!("无法写入文件: {e}"))?;
    if !meta.is_file() {
        return Err("不是普通文件，无法保存".into());
    }
    fs::write(&path, content.as_bytes()).map_err(|e| format!("无法写入文件: {e}"))?;
    Ok(())
}
```

- [ ] **Step 4: Re-run tests — pass**

- [ ] **Step 5: Wire command + register + api**

```rust
// commands.rs
pub fn fs_write_text_file(
    root_path: String,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    fs_browser::write_text_file(Path::new(&root_path), &rel_path, &content)
}
```

```ts
// api.ts
fsWriteTextFile: (rootPath: string, relPath: string, content: string) =>
  invoke<void>("fs_write_text_file", { rootPath, relPath, content }),
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/fs_browser.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "feat(fs): path-jailed write_text_file for Monaco save"
```

---

### Task 2: Language map helper (TDD)

**Files:**
- Create: `src/lib/files/language-from-path.ts`
- Create: `src/lib/files/language-from-path.test.ts`

**Interfaces:**
- Produces: `export function languageFromRelPath(relPath: string): string`  
  Returns Monaco language id (`typescript`, `javascript`, `json`, `markdown`, `css`, `html`, `rust`, `toml`, `yaml`, `plaintext`, …).

- [ ] **Step 1: Failing tests** for `foo.ts` → `typescript`, `a.JSX` → `javascript`, `x.unknown` → `plaintext`, nested `src/a.tsx` → `typescript`

- [ ] **Step 2: Implement map** (case-insensitive extension; take final `.ext`)

- [ ] **Step 3: `bun test src/lib/files/language-from-path.test.ts`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(files): map relPath extension to Monaco language"
```

---

### Task 3: Monaco dependency + `FileEditor` component

**Files:**
- Modify: `package.json` / lockfile via bun
- Modify: `vite.config.ts` (worker / monaco plugin if required for build)
- Create: `src/components/FileEditor.tsx`
- Modify or delete: `src/components/FilePreview.tsx` (App switches to FileEditor in Task 4; this task can keep FilePreview until then)

**Interfaces:**
- Produces:

```tsx
export type FileEditorProps = {
  rootPath: string;
  relPath: string;
  value: string;
  theme: "light" | "dark"; // or boolean dark
  onChange: (next: string) => void;
  onSave: () => void | Promise<void>;
  dirty: boolean;
  saving?: boolean;
};
```

- [ ] **Step 1: Install**

```bash
bun add monaco-editor @monaco-editor/react
# add vite-plugin-monaco-editor OR configure `?worker` per current Vite 8 docs — document chosen approach in commit message
```

- [ ] **Step 2: Implement `FileEditor`**
  - Full-bleed Monaco (`height: 100%` wrapper `min-h-0 flex-1`)
  - `language={languageFromRelPath(relPath)}`
  - `theme` → `vs` / `vs-dark`
  - Toolbar: 保存 button (disabled when `!dirty || saving`)
  - Cmd+S / Ctrl+S: `preventDefault` + `onSave` (use Monaco `addCommand` or window keydown while focused)
  - `onChange` from editor; do not show duplicate filename header (strip owns chrome)
  - `options`: `minimap: { enabled: false }`, word wrap on if matching old preview comfort (optional `wordWrap: "on"`)

- [ ] **Step 3: Smoke `bun run build` or `tsc --noEmit`** after Vite worker config so Monaco loads

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(files): FileEditor Monaco host with save + language"
```

---

### Task 4: App dirty state, save, tab marker, close confirm

**Files:**
- Modify: `src/App.tsx`
- Optionally: small confirm dialog component if none exists (reuse existing UI dialog primitive under `src/components/ui/`)

**Interfaces:**
- Consumes: `api.fsWriteTextFile`, `FileEditor`, `isFileTab`, existing `fileContentByTabId`
- Behavior:
  - `dirtyByTabId: Record<string, boolean>` (or derive if you keep baseline map)
  - On Monaco `onChange`: update `fileContentByTabId[id]`, set dirty if ≠ `baselineByTabId[id]`
  - On successful open/read: set baseline = content, dirty false
  - `saveFileTab(id)`: write; on ok baseline=content, dirty false; on err toast
  - Strip: if file + dirty, show dot beside label
  - `closeCenterTab`: if file && dirty → open modal; branches Save (await save then close) / Don’t save / Cancel
  - Pass App theme into FileEditor
  - Replace `<FilePreview …>` with `<FileEditor …>`

- [ ] **Step 1: Wire state + save + FileEditor render**

- [ ] **Step 2: Dirty dot in strip** (CSS circle; accessible `title` 未保存)

- [ ] **Step 3: Dirty close dialog** (保存 / 不保存 / 取消)

- [ ] **Step 4: `tsc --noEmit` / relevant vitest still pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(files): dirty marker, explicit save, close confirm for Monaco tabs"
```

---

### Task 5: Polish + acceptance checklist

**Files:**
- Create: `.superpowers/sdd/files-monaco-acceptance-checklist.md` (or under docs if preferred)
- Fix: remove dead `FilePreview` if unused; ensure no header filename duplication

- [ ] **Step 1: Checklist** covering spec acceptance (highlight, save, dirty close, theme, plaintext unknown, terminal unchanged)

- [ ] **Step 2: Manual notes for `tauri:dev`** — open ts file, edit, Cmd+S, close dirty, toggle theme

- [ ] **Step 3: Commit checklist**

```bash
git commit -m "docs: Monaco file editor acceptance checklist"
```

---

## Execution handoff

After plan commit, ask user: **Subagent-driven** (recommended) vs **inline executing-plans**.

Do not invent GUI acceptance results; Task 5 manual GUI is user-owned.
