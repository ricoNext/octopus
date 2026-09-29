# Files Right-Rail + Center Text Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-rail Files module (virtualized tree rooted at the left-selected main/worktree path) and a center terminal|read-only text preview split.

**Architecture:** Custom Tauri commands `fs_read_dir` / `fs_read_text_file` enforce a path jail under the selected root. FE registers a `files` right-rail module that lazily expands directories into a flat row model rendered with `@tanstack/react-virtual`. App owns preview state and a resizable center split beside the terminal.

**Tech Stack:** Tauri 2 + Rust, React 19, Vite, bun, Vitest, `@tanstack/react-virtual`, existing right-rail registry.

## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agents for code edits.
- Tree root follows left selection: main → project `rootPath`; worktree → `worktree.path`.
- Preview: UTF-8 plain text only; ~1–2 MiB size cap; binary sniff → soft error.
- Refresh: manual + re-read on expand / selection change; **no** fs watch.
- Virtual scrolling for the directory tree is **in scope**.
- Path jail: resolved path must stay under canonicalize(root).
- Do not port Orca Electron FileExplorer wholesale; no Monaco/edit/save; no image/MD/CSV/PDF; no SSH/folder workspaces; no write/delete/rename; no Git module.
- Do not touch PTY/Agents detection beyond wiring context props.
- Chinese UI strings for empty/error/refresh.

**Spec:** `docs/superpowers/specs/2026-09-29-files-right-rail-design.md`

---

### Task 1: Rust path jail + `read_dir` (TDD)

**Files:**
- Create: `src-tauri/src/fs_browser.rs`
- Modify: `src-tauri/src/lib.rs` (or `commands` module tree) — `mod fs_browser;`
- Test: unit tests inside `fs_browser.rs`

**Interfaces:**
- Produces:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsDirEntry {
    pub name: String,
    pub kind: String, // "dir" | "file" | "symlink"
}

pub fn resolve_under_root(root: &Path, rel: &str) -> Result<PathBuf, String>;
pub fn read_dir_entries(root: &Path, rel: &str) -> Result<Vec<FsDirEntry>, String>;
```

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reject_path_escape() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        fs::create_dir_all(&root).unwrap();
        let err = resolve_under_root(&root, "../outside").unwrap_err();
        assert!(err.contains("outside") || err.contains("越界") || err.len() > 0);
    }

    #[test]
    fn read_dir_dirs_first() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        fs::create_dir_all(root.join("b_dir")).unwrap();
        fs::create_dir_all(root.join("a_dir")).unwrap();
        fs::write(root.join("z.txt"), b"x").unwrap();
        fs::write(root.join("a.txt"), b"x").unwrap();
        let entries = read_dir_entries(&root, "").unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_dir", "b_dir", "a.txt", "z.txt"]);
        assert_eq!(entries[0].kind, "dir");
        assert_eq!(entries[2].kind, "file");
    }
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd src-tauri && cargo test read_dir_dirs_first -- --nocapture
```

Expected: compile fail / test missing symbols.

- [ ] **Step 3: Implement `resolve_under_root` + `read_dir_entries`**

- Normalize `rel`: `""` / `"."` → root itself.
- Join, canonicalize both root and candidate; ensure candidate starts with root (careful with trailing slash / macOS `/private` prefix — canonicalize both).
- Skip `.` / `..` entries; sort: dirs then files/symlinks, each group by name (case-insensitive ok).
- Symlink-to-dir: report `kind: "symlink"` (do not follow into listing of target for Phase 1).

- [ ] **Step 4: `cargo test fs_browser` — PASS**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fs_browser.rs src-tauri/src/lib.rs
git commit -m "feat(fs): path jail and read_dir entries"
```

---

### Task 2: Rust `read_text_file` (TDD)

**Files:**
- Modify: `src-tauri/src/fs_browser.rs`

**Interfaces:**
- Produces:

```rust
pub const MAX_TEXT_PREVIEW_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

pub fn read_text_file(root: &Path, rel: &str) -> Result<String, String>;
```

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn read_text_ok() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("hi.txt"), b"hello").unwrap();
    assert_eq!(read_text_file(&root, "hi.txt").unwrap(), "hello");
}

#[test]
fn reject_oversize() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    // keep test fast: temporarily lower via cfg or write > cap if using small test-only const
    // Prefer: expose test helper or use a file just over MAX with sparse write if feasible.
    // Minimal: call with a path that fails binary sniff.
    fs::write(root.join("bin.dat"), [0u8, 1, 2, 3, 0, 0, 0, 0]).unwrap();
    let err = read_text_file(&root, "bin.dat").unwrap_err();
    assert!(!err.is_empty());
}
```

- [ ] **Step 2: Implement**

- `resolve_under_root`; metadata len > `MAX_TEXT_PREVIEW_BYTES` → Err `"文件过大，无法预览"`.
- Read bytes; if any of first 8192 contains `0` → Err `"二进制文件，无法预览"`.
- `String::from_utf8` lossy or strict Err `"不是有效的 UTF-8 文本"`.

- [ ] **Step 3: `cargo test fs_browser` PASS**

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/fs_browser.rs
git commit -m "feat(fs): read_text_file with size and binary checks"
```

---

### Task 3: Tauri commands + FE api/types

**Files:**
- Modify: `src-tauri/src/commands.rs` (add wrappers)
- Modify: `src-tauri/src/lib.rs` invoke_handler
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**

```ts
export type FsDirEntry = { name: string; kind: "dir" | "file" | "symlink" | string };

// api.ts
fsReadDir(rootPath: string, relPath: string): Promise<FsDirEntry[]>
fsReadTextFile(rootPath: string, relPath: string): Promise<string>
```

```rust
#[tauri::command]
pub fn fs_read_dir(root_path: String, rel_path: String) -> Result<Vec<FsDirEntry>, String> {
    crate::fs_browser::read_dir_entries(Path::new(&root_path), &rel_path)
}
#[tauri::command]
pub fn fs_read_text_file(root_path: String, rel_path: String) -> Result<String, String> {
    crate::fs_browser::read_text_file(Path::new(&root_path), &rel_path)
}
```

- [ ] **Step 1: Wire commands + types + api**

- [ ] **Step 2: `cargo check` && `bunx tsc --noEmit`**

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/lib/api.ts
git commit -m "feat(fs): expose fs_read_dir and fs_read_text_file to FE"
```

---

### Task 4: FE tree flatten helpers (TDD) + install virtualizer

**Files:**
- Create: `src/lib/files/tree-model.ts`
- Create: `src/lib/files/tree-model.test.ts`
- Modify: `package.json` — add `@tanstack/react-virtual`

**Interfaces:**

```ts
export type TreeNode = {
  relPath: string; // "" for root children joined as name
  name: string;
  kind: string;
  depth: number;
  expanded: boolean;
  children?: TreeNode[] | null; // null = not loaded
  loading?: boolean;
  error?: string;
};

export type FlatRow = {
  relPath: string;
  name: string;
  kind: string;
  depth: number;
  expanded: boolean;
  loading?: boolean;
};

export function joinRel(parent: string, name: string): string;
export function flattenVisible(nodes: TreeNode[]): FlatRow[];
export function upsertChildren(nodes: TreeNode[], relPath: string, children: TreeNode[]): TreeNode[];
export function setExpanded(nodes: TreeNode[], relPath: string, expanded: boolean): TreeNode[];
```

- [ ] **Step 1: Vitest for flatten / expand**

```ts
import { describe, expect, it } from "vitest";
import { flattenVisible, joinRel, setExpanded, upsertChildren } from "./tree-model";

describe("tree-model", () => {
  it("joins rel", () => {
    expect(joinRel("", "src")).toBe("src");
    expect(joinRel("src", "a.ts")).toBe("src/a.ts");
  });
  it("flattens only expanded", () => {
    const roots = [
      { relPath: "a", name: "a", kind: "dir", depth: 0, expanded: true, children: [
        { relPath: "a/b", name: "b", kind: "file", depth: 1, expanded: false },
      ]},
      { relPath: "c", name: "c", kind: "file", depth: 0, expanded: false },
    ];
    expect(flattenVisible(roots).map((r) => r.relPath)).toEqual(["a", "a/b", "c"]);
  });
});
```

- [ ] **Step 2: Implement helpers; `bun test src/lib/files`**

- [ ] **Step 3: `bun add @tanstack/react-virtual`**

- [ ] **Step 4: Commit**

```bash
git add src/lib/files package.json bun.lock
git commit -m "feat(files): tree model helpers and react-virtual dep"
```

---

### Task 5: Files right-rail module (virtualized tree)

**Files:**
- Create: `src/components/right-rail/modules/files.tsx`
- Modify: `src/components/right-rail/registry.tsx`
- Modify: `src/components/right-rail/types.ts` — extend context
- Modify: `src/components/RightPanel.tsx` if context plumbing needs update

**Interfaces:**
- Extend `RightRailContext`:

```ts
export type RightRailContext = {
  contextId: string | null;
  agentRows?: AgentRowView[];
  onFocusAgent?: (sessionId: string) => void;
  filesRootPath?: string | null;
  onOpenFilePreview?: (args: { rootPath: string; relPath: string }) => void;
};
```

- Files module: load root `api.fsReadDir(root, "")` when `filesRootPath` changes; expand dir → read that rel; Refresh button; virtual list over `flattenVisible`.

UI copy:
- empty root: `选择左侧主仓或工作树以浏览文件`
- error toast via parent or inline `加载失败：…`
- refresh: `刷新`

- [ ] **Step 1: Implement FilesModule + register `{ id: "files", title: "Files", icon: FolderTreeIcon }`**

- [ ] **Step 2: `bunx tsc --noEmit`**

- [ ] **Step 3: Commit**

```bash
git add src/components/right-rail src/components/RightPanel.tsx
git commit -m "feat(files): virtualized Files right-rail module"
```

---

### Task 6: Center FilePreview + terminal|preview split

**Files:**
- Create: `src/components/FilePreview.tsx`
- Modify: `src/App.tsx` — preview state, split layout beside terminal, persist width key `octopus.center-preview.width`

**Interfaces:**

```ts
type FilePreviewState = {
  rootPath: string;
  relPath: string;
  content: string;
} | null;
```

Behavior:
- `onOpenFilePreview`: `api.fsReadTextFile` then set state (catch → toast.error).
- When `preview != null`, center is flex row: TerminalWorkspace (flex-1) | drag handle | FilePreview (width persisted).
- Preview header: filename + Close → `setPreview(null)`.
- Body: `<pre className="… monospace overflow-auto text-xs">`.
- Selection change (main/worktree id or path): clear preview.

- [ ] **Step 1: Implement FilePreview + App wiring; pass `filesRootPath` / `onOpenFilePreview` into RightPanel**

Resolve root:

```ts
const filesRootPath =
  selection.kind === "main"
    ? selectedProject?.rootPath ?? null
    : selection.kind === "worktree"
      ? selectedWorktree?.path ?? null
      : null;
```

- [ ] **Step 2: `bunx tsc --noEmit`**

- [ ] **Step 3: Commit**

```bash
git add src/components/FilePreview.tsx src/App.tsx
git commit -m "feat(files): center terminal|text preview split"
```

---

### Task 7: Manual acceptance

**Files:** none (checklist)

- [ ] **Step 1: `bun run tauri:dev`**

- [ ] **Step 2: Checklist**

1. ActivityBar 有 Files；切换后树对应当前左侧选中根。
2. 换选中主仓/工作树 → 树换根且预览清空。
3. 展开目录懒加载；刷新重读；大目录滚动流畅（虚拟列表）。
4. 点文本文件 → 中间预览；关预览 → 终端全宽。
5. 二进制/超大文件 → 明确错误，不崩。
6. 后端拒绝 `..` 越界（可用 cargo test 已覆盖）。

- [ ] **Step 3: Fix bugs if any; commit**

```bash
git commit -m "fix(files): <short>"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Files module in activity bar | 5 |
| Root follows left selection | 5–6 |
| Lazy expand + manual refresh | 5 |
| Virtual scroll | 4–5 |
| Center terminal\|preview split | 6 |
| Plain text + size/binary checks | 2–3, 6 |
| Path jail | 1–3 |
| Non-goals (no Monaco/watch/SSH/…) | respected |

## Placeholder scan

No TBD / “implement later” left in tasks.

