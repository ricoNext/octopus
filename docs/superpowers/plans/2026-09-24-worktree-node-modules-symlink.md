# Worktree node_modules Symlink Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 / 已有 worktree 可把 `node_modules` 软链到同项目「基于」目录（或其它有依赖的源），创建时可勾选，创建后菜单可补链 / 换源 / 取消；不做自动 install。

**Architecture:** Rust 纯模块 `dep_link.rs` 负责同项目校验、源探测、绝对路径 symlink / unlink（`force` 覆盖）。Tauri 命令包装并写回 `Worktree.basedOnPath` + `depLink`。`create_worktree` 仍只跑 `git worktree add`，但创建时解析并持久化 `basedOnPath`；FE 勾选成功后再调 `link_*`。侧栏菜单 + 源选择 + 覆盖确认；刷新时用磁盘实况校正 `depLink.status`。

**Tech Stack:** Tauri 2 + Rust (`std::os::unix::fs::symlink`, `tempfile` for tests), React 19 + 现有 Dialog / AlertDialog / Checkbox / DropdownMenu, sonner toast。

**Spec:** `docs/superpowers/specs/2026-09-24-worktree-node-modules-symlink-design.md`
**Monorepo extension plan:** `docs/superpowers/plans/2026-09-24-worktree-node-modules-monorepo.md`


## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agent / PR workflow.
- Phase 1 **仅** `node_modules`（无 `.venv` / `vendor` / 包管理器缓存）。
- 创建时勾选 + 创建后菜单（链接 / 重新链接 / 取消链接）；不做「强制默认自动链」。
- 默认源 = `basedOnPath`（创建时解析写入）。
- 目标已存在（真目录或软链）→ **先询问再覆盖**（`force=false` 返回 `NeedsConfirm`）。
- 取消链接 / 源消失 → **只 unlink**；**禁止**自动 `npm`/`pnpm`/`yarn`/`bun install`。
- 源与目标必须同属当前 git 项目（主仓 `root_path` + 已登记 worktree）；项目外路径拒绝。
- 软链使用**绝对路径**（`std::os::unix::fs::symlink(abs_source_nm, abs_target_nm)`）。
- `create_worktree` **保持只做 git**；链接由 FE 成功后另调；链接失败**不回滚** worktree。
- `basedOnPath` 解析：`start_from` 分支名 → 同项目 `worktrees` 中 `branch_name` 匹配者的 `path`；否则 `project.root_path`（含 `start_from == default_branch`）。
- 旧 store JSON：新字段必须 `#[serde(default)]`，缺省可加载。
- Tests: Rust `cargo test dep_link`（TDD）；FE `bunx tsc --noEmit`；手动验收见 Task 7。
- 不触及 PTY / Agents / 右栏。

---

## File map

| File | Role |
|---|---|
| `src-tauri/src/dep_link.rs` | Pure: same-project check, probe status, link/unlink with force, source ok |
| `src-tauri/src/lib.rs` | `mod dep_link;` + register new commands |
| `src-tauri/src/models.rs` | `DepLink` / `DepLinkStatus` / `LinkNodeModulesResult` / `DepLinkStatusItem`; extend `Worktree` |
| `src-tauri/src/workspace.rs` | Set `based_on_path` on create; fill new fields at all `Worktree { ... }` sites |
| `src-tauri/src/commands.rs` | Tauri cmds: link / unlink / get status / list sources; persist `dep_link` |
| `src-tauri/src/store.rs` | `hydrate_dep_links` — probe disk and correct `dep_link.status` |
| `src-tauri/src/git.rs` | Reuse `canonicalize_or` / `same_path` (no API change) |
| `src/types.ts` | `DepLink`, `DepLinkStatus`, extend `Worktree`; result types |
| `src/lib/api.ts` | FE wrappers for new commands |
| `src/lib/dep-link/resolve-based-on.ts` | FE mirror of basedOn resolution (create dialog default + label) |
| `src/lib/dep-link/resolve-based-on.test.ts` | Vitest |
| `src/App.tsx` | Create checkbox + post-create link; overwrite / source-picker dialogs; hydrate calls |
| `src/components/Sidebar.tsx` | Menu items + broken/linked icon on row |

---

### Task 1: Rust `dep_link` pure module (TDD)

**Files:**
- Create: `src-tauri/src/dep_link.rs`
- Modify: `src-tauri/src/lib.rs` — add `mod dep_link;`
- Test: unit tests inside `dep_link.rs` (`#[cfg(test)]`) using `tempfile`

**Interfaces:**
- Consumes: `crate::git::{canonicalize_or, same_path}`
- Produces:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepLinkKind { NodeModules }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeStatus { None, Linked, Broken }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeResult {
    pub status: ProbeStatus,
    /// 源 worktree/主仓根（软链指向的 node_modules 的父目录）；仅 Linked 时有意义
    pub linked_from: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    OutsideProject,
    SourceMissing,
    SourceNotDir,
    NeedsConfirm { is_symlink: bool },
    Io(String),
    NotASymlink,
}

pub fn project_roots<'a>(
    main_root: &'a Path,
    worktree_paths: &'a [PathBuf],
) -> Vec<&'a Path>;

/// 规范化后，`candidate` 必须等于某个 root（不允许 root 的子路径冒充「另一个 root」以外的逃逸）。
pub fn ensure_same_project(
    candidate: &Path,
    main_root: &Path,
    worktree_paths: &[PathBuf],
) -> Result<PathBuf, LinkError>;

pub fn source_node_modules_ok(source_root: &Path) -> bool;

pub fn probe_target(target_root: &Path) -> ProbeResult;

/// `force=false` 且目标已存在 → `NeedsConfirm`；`force=true` 先移除再链。
/// 成功后目标 `{target}/node_modules` → 绝对路径 `{source}/node_modules`。
pub fn link_node_modules(
    target_root: &Path,
    source_root: &Path,
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError>;

pub fn unlink_node_modules(target_root: &Path) -> Result<(), LinkError>;
```

- [ ] **Step 1: Write failing tests** in `dep_link.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

    fn touch_nm(root: &Path) {
        fs::create_dir_all(root.join("node_modules")).unwrap();
    }

    #[test]
    fn rejects_outside_project() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        let outside = tmp.path().join("other");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&wt).unwrap();
        fs::create_dir_all(&outside).unwrap();
        touch_nm(&main);
        let err = link_node_modules(&wt, &outside, &main, &[wt.clone()], false).unwrap_err();
        assert!(matches!(err, LinkError::OutsideProject));
    }

    #[test]
    fn links_with_absolute_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&wt).unwrap();
        touch_nm(&main);
        link_node_modules(&wt, &main, &main, &[wt.clone()], false).unwrap();
        let target = wt.join("node_modules");
        assert!(target.symlink_metadata().unwrap().file_type().is_symlink());
        let points = fs::read_link(&target).unwrap();
        assert!(points.is_absolute());
        assert_eq!(canonicalize_or(&points), canonicalize_or(&main.join("node_modules")));
        let probe = probe_target(&wt);
        assert_eq!(probe.status, ProbeStatus::Linked);
        assert_eq!(
            canonicalize_or(probe.linked_from.as_ref().unwrap()),
            canonicalize_or(&main)
        );
    }

    #[test]
    fn needs_confirm_when_real_dir_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&wt).unwrap();
        touch_nm(&main);
        touch_nm(&wt);
        let err = link_node_modules(&wt, &main, &main, &[wt.clone()], false).unwrap_err();
        assert!(matches!(err, LinkError::NeedsConfirm { is_symlink: false }));
        link_node_modules(&wt, &main, &main, &[wt.clone()], true).unwrap();
        assert!(wt.join("node_modules").symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[test]
    fn needs_confirm_when_old_symlink_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let other = tmp.path().join("other");
        let wt = tmp.path().join("wt");
        for p in [&main, &other, &wt] {
            fs::create_dir_all(p).unwrap();
        }
        touch_nm(&main);
        touch_nm(&other);
        symlink(other.join("node_modules"), wt.join("node_modules")).unwrap();
        let err = link_node_modules(&wt, &main, &main, &[wt.clone(), other.clone()], false)
            .unwrap_err();
        assert!(matches!(err, LinkError::NeedsConfirm { is_symlink: true }));
    }

    #[test]
    fn unlink_only_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&wt).unwrap();
        touch_nm(&main);
        link_node_modules(&wt, &main, &main, &[wt.clone()], false).unwrap();
        unlink_node_modules(&wt).unwrap();
        assert!(!wt.join("node_modules").exists());
        touch_nm(&wt);
        let err = unlink_node_modules(&wt).unwrap_err();
        assert!(matches!(err, LinkError::NotASymlink));
    }

    #[test]
    fn probe_broken_when_source_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&wt).unwrap();
        touch_nm(&main);
        link_node_modules(&wt, &main, &main, &[wt.clone()], false).unwrap();
        fs::remove_dir_all(main.join("node_modules")).unwrap();
        assert_eq!(probe_target(&wt).status, ProbeStatus::Broken);
    }

    #[test]
    fn source_missing_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&wt).unwrap();
        let err = link_node_modules(&wt, &main, &main, &[wt.clone()], false).unwrap_err();
        assert!(matches!(err, LinkError::SourceMissing));
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd src-tauri && cargo test dep_link -- --nocapture
```

Expected: compile error / module missing.

- [ ] **Step 3: Implement `dep_link.rs`** minimal to pass:

```rust
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use crate::git::{canonicalize_or, same_path};

// ... enums + structs as in Interfaces ...

pub fn ensure_same_project(
    candidate: &Path,
    main_root: &Path,
    worktree_paths: &[PathBuf],
) -> Result<PathBuf, LinkError> {
    let cand = canonicalize_or(candidate);
    if same_path(&cand, main_root) {
        return Ok(cand);
    }
    for wt in worktree_paths {
        if same_path(&cand, wt) {
            return Ok(cand);
        }
    }
    Err(LinkError::OutsideProject)
}

pub fn source_node_modules_ok(source_root: &Path) -> bool {
    let nm = source_root.join("node_modules");
    let meta = fs::symlink_metadata(&nm);
    let Ok(meta) = meta else { return false };
    if meta.file_type().is_symlink() {
        return fs::metadata(&nm).map(|m| m.is_dir()).unwrap_or(false);
    }
    meta.is_dir()
}

pub fn probe_target(target_root: &Path) -> ProbeResult {
    let nm = target_root.join("node_modules");
    let Ok(meta) = fs::symlink_metadata(&nm) else {
        return ProbeResult { status: ProbeStatus::None, linked_from: None };
    };
    if !meta.file_type().is_symlink() {
        return ProbeResult { status: ProbeStatus::None, linked_from: None };
    }
    match fs::canonicalize(&nm) {
        Ok(resolved) if resolved.is_dir() => {
            let linked_from = resolved.parent().map(|p| p.to_path_buf());
            ProbeResult { status: ProbeStatus::Linked, linked_from }
        }
        _ => ProbeResult { status: ProbeStatus::Broken, linked_from: None },
    }
}

pub fn link_node_modules(
    target_root: &Path,
    source_root: &Path,
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError> {
    let target_root = ensure_same_project(target_root, main_root, worktree_paths)?;
    let source_root = ensure_same_project(source_root, main_root, worktree_paths)?;
    if same_path(&target_root, &source_root) {
        return Err(LinkError::Io("不能链接到自身".into()));
    }
    let source_nm = source_root.join("node_modules");
    if !source_nm.exists() {
        return Err(LinkError::SourceMissing);
    }
    if !source_node_modules_ok(&source_root) {
        return Err(LinkError::SourceNotDir);
    }
    let source_nm_abs = canonicalize_or(&source_nm);
    let target_nm = target_root.join("node_modules");
    if target_nm.exists() || fs::symlink_metadata(&target_nm).is_ok() {
        let is_symlink = fs::symlink_metadata(&target_nm)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if !force {
            return Err(LinkError::NeedsConfirm { is_symlink });
        }
        if is_symlink {
            fs::remove_file(&target_nm).map_err(|e| LinkError::Io(e.to_string()))?;
        } else {
            fs::remove_dir_all(&target_nm).map_err(|e| LinkError::Io(e.to_string()))?;
        }
    }
    symlink(&source_nm_abs, &target_nm).map_err(|e| LinkError::Io(e.to_string()))
}

pub fn unlink_node_modules(target_root: &Path) -> Result<(), LinkError> {
    let target_nm = target_root.join("node_modules");
    let meta = fs::symlink_metadata(&target_nm).map_err(|_| LinkError::NotASymlink)?;
    if !meta.file_type().is_symlink() {
        return Err(LinkError::NotASymlink);
    }
    fs::remove_file(&target_nm).map_err(|e| LinkError::Io(e.to_string()))
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd src-tauri && cargo test dep_link -- --nocapture
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dep_link.rs src-tauri/src/lib.rs
git commit -m "feat(dep-link): pure node_modules symlink helpers and tests"
```

---

### Task 2: Models + Tauri commands + api.ts

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (invoke_handler)
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: `crate::dep_link::{link_node_modules, unlink_node_modules, probe_target, source_node_modules_ok, LinkError, ProbeStatus}`
- Produces (Rust models):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DepLinkStatus {
    None,
    Linked,
    Broken,
}

impl Default for DepLinkStatus {
    fn default() -> Self { Self::None }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepLink {
    pub kind: String, // always "node_modules" in Phase 1
    pub status: DepLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LinkNodeModulesResult {
    Ok { snapshot: AppSnapshot },
    NeedsConfirm { conflict: String }, // "directory" | "symlink"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepLinkStatusItem {
    pub path: String,
    pub status: DepLinkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
    pub source_ok: bool, // `{path}/node_modules` usable as link source
}
```

- Commands:

```rust
#[tauri::command]
pub fn link_worktree_node_modules(
    state: State<AppState>,
    target_path: String,
    source_path: String,
    force: bool,
) -> Result<LinkNodeModulesResult, String>;

#[tauri::command]
pub fn unlink_worktree_node_modules(
    state: State<AppState>,
    target_path: String,
) -> Result<AppSnapshot, String>;

#[tauri::command]
pub fn get_worktree_dep_link_status(
    state: State<AppState>,
    paths: Vec<String>,
) -> Result<Vec<DepLinkStatusItem>, String>;

#[tauri::command]
pub fn list_node_modules_link_sources(
    state: State<AppState>,
    project_id: String,
    exclude_path: Option<String>,
) -> Result<Vec<DepLinkStatusItem>, String>;
```

Command behavior (FS + snapshot; **do not** write `Worktree.dep_link` until Task 3 adds the fields):
1. Resolve `project` from `target_path` matching `project.root_path` or a worktree `path` (via `same_path`).
2. Collect `worktree_paths` for that `project_id`.
3. `link_*`: call `dep_link::link_node_modules`; on `NeedsConfirm` return `LinkNodeModulesResult::NeedsConfirm { conflict: if is_symlink { "symlink" } else { "directory" } }`; on success return `Ok { snapshot: store.snapshot() }` (persist unchanged store is fine).
4. `unlink_*`: `unlink_node_modules`; return `store.snapshot()`.
5. `get_worktree_dep_link_status`: for each path `probe_target` + `source_node_modules_ok`. Map `ProbeStatus` → `DepLinkStatus`.
6. `list_node_modules_link_sources`: candidates = `[project.root_path] + worktree.paths` for `project_id`; skip `exclude_path` via `same_path`; keep only `source_ok`; return as `DepLinkStatusItem` (status from `probe_target` on that root).

Map non-confirm `LinkError` to Chinese strings: `"不在同一项目内"` / `"源没有 node_modules"` / `"源 node_modules 不是目录"` / `"目标不是软链，无法取消链接"` / Io `err` message / `"不能链接到自身"`.

**Phase 1 lock:** `DepLink.linked_at` always `None` when Task 3 starts writing metadata (no chrono / time crate).

- [ ] **Step 1: Add model types** to `models.rs` (`DepLinkStatus`, `DepLink`, `LinkNodeModulesResult`, `DepLinkStatusItem`) — standalone, not yet on `Worktree`.

- [ ] **Step 2: Implement commands** (FS only; return snapshot without mutating `dep_link`).

```rust
fn project_context_for_path<'a>(
    store: &'a Store,
    path: &str,
) -> Result<(&'a crate::models::Project, Vec<PathBuf>), String> {
    let p = PathBuf::from(path);
    if let Some(project) = store.projects.iter().find(|proj| same_path(Path::new(&proj.root_path), &p)) {
        let wts = store.worktrees.iter().filter(|w| w.project_id == project.id).map(|w| PathBuf::from(&w.path)).collect();
        return Ok((project, wts));
    }
    if let Some(wt) = store.worktrees.iter().find(|w| same_path(Path::new(&w.path), &p)) {
        let project = store.projects.iter().find(|proj| proj.id == wt.project_id).ok_or_else(|| "找不到该项目".to_string())?;
        let wts = store.worktrees.iter().filter(|w| w.project_id == project.id).map(|w| PathBuf::from(&w.path)).collect();
        return Ok((project, wts));
    }
    Err("路径不属于任何已登记项目".into())
}
```

- [ ] **Step 3: Register** in `lib.rs` invoke_handler:

```rust
commands::link_worktree_node_modules,
commands::unlink_worktree_node_modules,
commands::get_worktree_dep_link_status,
commands::list_node_modules_link_sources,
```

- [ ] **Step 4: FE types + api**

```ts
// types.ts
export type DepLinkStatus = "none" | "linked" | "broken";

export type DepLink = {
  kind: "node_modules";
  status: DepLinkStatus;
  linkedFrom?: string | null;
  linkedAt?: string | null;
};

export type LinkNodeModulesResult =
  | { status: "ok"; snapshot: AppSnapshot }
  | { status: "needsConfirm"; conflict: "directory" | "symlink" | string };

export type DepLinkStatusItem = {
  path: string;
  status: DepLinkStatus;
  linkedFrom?: string | null;
  sourceOk: boolean;
};
```

```ts
// api.ts additions
linkWorktreeNodeModules: (targetPath: string, sourcePath: string, force: boolean) =>
  invoke<LinkNodeModulesResult>("link_worktree_node_modules", { targetPath, sourcePath, force }),
unlinkWorktreeNodeModules: (targetPath: string) =>
  invoke<AppSnapshot>("unlink_worktree_node_modules", { targetPath }),
getWorktreeDepLinkStatus: (paths: string[]) =>
  invoke<DepLinkStatusItem[]>("get_worktree_dep_link_status", { paths }),
listNodeModulesLinkSources: (projectId: string, excludePath: string | null) =>
  invoke<DepLinkStatusItem[]>("list_node_modules_link_sources", { projectId, excludePath }),
```

Serde: Rust `DepLinkStatus::None` with `rename_all = "camelCase"` serializes as `"none"` — good. Enum variant `NeedsConfirm` → `"needsConfirm"`.

- [ ] **Step 5: Build check**

```bash
cd src-tauri && cargo test dep_link && cargo check
bunx tsc --noEmit
```

Expected: PASS / check OK / tsc OK.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/lib/api.ts
git commit -m "feat(dep-link): tauri link/unlink/status commands and FE api"
```

---

### Task 3: Persist `basedOnPath` + `depLink` on Worktree; set on create

**Files:**
- Modify: `src-tauri/src/models.rs` — extend `Worktree`
- Modify: `src-tauri/src/workspace.rs` — all `Worktree { ... }` literals + `create_worktree` resolution
- Modify: `src-tauri/src/commands.rs` — persist `dep_link` after link/unlink; hydrate on snapshot path optional
- Modify: `src-tauri/src/store.rs` — hydrate live probe into returned / stored `dep_link.status` in `snapshot()`
- Modify: `src/types.ts` — extend FE `Worktree`

**Interfaces:**
- Produces on `Worktree` (Rust):

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub based_on_path: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub dep_link: Option<DepLink>,
```

- FE:

```ts
export type Worktree = {
  // ...existing...
  basedOnPath?: string | null;
  depLink?: DepLink | null;
};
```

- `resolve_based_on_path` in `workspace.rs`:

```rust
fn resolve_based_on_path(store: &Store, project: &Project, start_branch: &str) -> String {
    store
        .worktrees
        .iter()
        .find(|wt| wt.project_id == project.id && wt.branch_name == start_branch)
        .map(|wt| wt.path.clone())
        .unwrap_or_else(|| project.root_path.clone())
}
```

In `create_worktree`, when pushing `Worktree { ... }`, set:

```rust
based_on_path: Some(resolve_based_on_path(store, &project, &start)),
dep_link: None,
```

Every other `Worktree { ... }` site (import / refresh): `based_on_path: None, dep_link: None`.

**Upgrade Task 2 commands** to persist metadata. After `link_worktree_node_modules` success: find worktree by `same_path` on `target_path`, set:

```rust
worktree.dep_link = Some(DepLink {
    kind: "node_modules".into(),
    status: DepLinkStatus::Linked,
    linked_from: Some(source_path.clone()),
    linked_at: None,
});
```

After unlink: `worktree.dep_link = None` (or status None).

Locked hydrate rule: add `Store::hydrate_dep_links(&mut self)` (below). Call it from `load_snapshot`, `refresh_project_worktrees`, and after successful link/unlink **before** `persist` + `snapshot()`. Disk is source of truth: `Linked` writes/refreshes `dep_link`; `Broken` keeps prior `linked_from` when present; `None` clears `dep_link` to `None`.

```rust
pub fn hydrate_dep_links(&mut self) {
    for wt in &mut self.worktrees {
        let probe = crate::dep_link::probe_target(Path::new(&wt.path));
        match probe.status {
            crate::dep_link::ProbeStatus::None => {
                // Real dir or missing: clear linked metadata status but keep None entry absent
                if wt.dep_link.is_some() {
                    wt.dep_link = None;
                }
            }
            crate::dep_link::ProbeStatus::Linked => {
                let from = probe
                    .linked_from
                    .map(|p| p.to_string_lossy().to_string())
                    .or_else(|| wt.dep_link.as_ref().and_then(|d| d.linked_from.clone()));
                wt.dep_link = Some(DepLink {
                    kind: "node_modules".into(),
                    status: DepLinkStatus::Linked,
                    linked_from: from,
                    linked_at: None,
                });
            }
            crate::dep_link::ProbeStatus::Broken => {
                wt.dep_link = Some(DepLink {
                    kind: "node_modules".into(),
                    status: DepLinkStatus::Broken,
                    linked_from: wt.dep_link.as_ref().and_then(|d| d.linked_from.clone()),
                    linked_at: None,
                });
            }
        }
    }
}
```

Call `hydrate_dep_links` from `load_snapshot` / `refresh_project_worktrees` / link / unlink before persist.

- [ ] **Step 1: Extend `Worktree` in Rust + TS; fix all struct literals** (compile-driven).

- [ ] **Step 2: Add `resolve_based_on_path` + set on create.**

- [ ] **Step 3: Persist dep_link in link/unlink commands + hydrate.**

- [ ] **Step 4: Unit test basedOn resolution** (add in `workspace.rs` tests or small test in dep_link-adjacent):

```rust
#[test]
fn based_on_prefers_matching_worktree_path() {
    // build Store with project root /p, worktree branch feat path /p-wt
    // resolve_based_on_path(..., "feat") == /p-wt
    // resolve_based_on_path(..., "main") == /p  (default)
}
```

Make `resolve_based_on_path` `pub(crate)` for test.

- [ ] **Step 5: Run**

```bash
cd src-tauri && cargo test && cargo check
bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/workspace.rs src-tauri/src/commands.rs src-tauri/src/store.rs src/types.ts
git commit -m "feat(dep-link): persist basedOnPath and depLink on worktrees"
```

---

### Task 4: Create dialog checkbox + post-create link

**Files:**
- Create: `src/lib/dep-link/resolve-based-on.ts`
- Create: `src/lib/dep-link/resolve-based-on.test.ts`
- Modify: `src/App.tsx` — create dialog UI + `confirmCreate` flow

**Interfaces:**
- Produces:

```ts
// resolve-based-on.ts
import type { Project, Worktree } from "@/types";

export function resolveBasedOnPath(
  project: Project,
  startFromBranch: string,
  worktrees: Worktree[],
): string {
  const match = worktrees.find(
    (wt) => wt.projectId === project.id && wt.branchName === startFromBranch,
  );
  return match?.path ?? project.rootPath;
}

export function basedOnLabel(
  project: Project,
  basedOnPath: string,
  worktrees: Worktree[],
): string {
  if (basedOnPath === project.rootPath) {
    return `${project.defaultBranch}（主仓）`;
  }
  const wt = worktrees.find((item) => item.path === basedOnPath);
  return wt?.branchName ?? basedOnPath;
}
```

- App state:

```ts
const [linkNodeModules, setLinkNodeModules] = useState(false);
const [basedOnSourceOk, setBasedOnSourceOk] = useState(false);
```

When `createProjectId` / `startFrom` / snapshot changes: compute `basedOnPath`, call `api.getWorktreeDepLinkStatus([basedOnPath])`, set `basedOnSourceOk = items[0]?.sourceOk ?? false`; if `sourceOk` default `linkNodeModules = true`, else `false`.

Checkbox UI (after start-from block, before footer):

```tsx
<label className={cn("flex items-start gap-2 text-sm", !basedOnSourceOk && "opacity-50")}>
  <Checkbox
    checked={linkNodeModules}
    disabled={!basedOnSourceOk}
    onCheckedChange={(v) => setLinkNodeModules(v === true)}
  />
  <span className="grid gap-0.5">
    <span>链接源的 node_modules</span>
    <span className="text-xs text-muted-foreground">
      {basedOnSourceOk
        ? `源：${basedOnLabel(project, basedOnPath, worktrees)}`
        : "源尚无 node_modules"}
    </span>
  </span>
</label>
```

`confirmCreate` after successful mutation **without** `mutation.error`:

```ts
const focusedId = mutation.focusedWorktreeId;
applySnapshot(mutation.snapshot, focusedId);
if (mutation.error) {
  toast.error(mutation.error);
} else if (linkNodeModules && focusedId) {
  const created = mutation.snapshot.worktrees.find((w) => w.id === focusedId);
  const project = mutation.snapshot.projects.find((p) => p.id === createProjectId);
  if (created && project) {
    const source =
      created.basedOnPath ??
      resolveBasedOnPath(project, startFrom.trim(), mutation.snapshot.worktrees);
    try {
      const linkResult = await api.linkWorktreeNodeModules(created.path, source, false);
      if (linkResult.status === "needsConfirm") {
        // create path: target should be empty — unexpected; toast and skip
        toast.error("目标已有 node_modules，请稍后在菜单中链接");
      } else {
        applySnapshot(linkResult.snapshot, focusedId);
      }
    } catch (error) {
      toast.error(`工作树已创建，但链接 node_modules 失败：${invokeError(error)}`);
    }
  }
}
setCreateProjectId(null);
setLinkNodeModules(false);
```

Reset checkbox state in `openCreate`.

- [ ] **Step 1: Write Vitest for `resolveBasedOnPath` / `basedOnLabel`.**

```ts
import { describe, expect, it } from "vitest";
import { basedOnLabel, resolveBasedOnPath } from "./resolve-based-on";

const project = {
  id: "p1",
  name: "demo",
  rootPath: "/repo",
  defaultBranch: "main",
  mainBranch: "main",
  pathMissing: false,
};

describe("resolveBasedOnPath", () => {
  it("uses matching worktree path", () => {
    const wts = [
      {
        id: "w1",
        projectId: "p1",
        displayName: "feat",
        branchName: "feat",
        startFrom: "main",
        path: "/repo-worktrees/feat",
        origin: "app" as const,
        status: "ready" as const,
        missing: false,
      },
    ];
    expect(resolveBasedOnPath(project, "feat", wts)).toBe("/repo-worktrees/feat");
    expect(resolveBasedOnPath(project, "main", wts)).toBe("/repo");
  });
});
```

- [ ] **Step 2: `bun test src/lib/dep-link` — expect FAIL then implement — PASS.**

- [ ] **Step 3: Wire App create dialog + confirmCreate.**

- [ ] **Step 4: `bunx tsc --noEmit && bun test src/lib/dep-link`**

- [ ] **Step 5: Commit**

```bash
git add src/lib/dep-link src/App.tsx
git commit -m "feat(dep-link): create-dialog checkbox and post-create link"
```

---

### Task 5: Sidebar menus + source picker + overwrite confirm

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx` — dialogs + handlers passed into Sidebar

**Interfaces:**
- Extend `WorktreeMenuItemsProps`:

```ts
type WorktreeMenuItemsProps = {
  // ...existing
  depLinkStatus?: DepLinkStatus; // from worktree.depLink?.status ?? "none"
  onLinkNodeModules: (worktree: Worktree) => void;
  onRelinkNodeModules: (worktree: Worktree) => void;
  onUnlinkNodeModules: (worktree: Worktree) => void;
};
```

Menu items (before delete):

```tsx
{!worktree.missing && worktree.status === "ready" ? (
  <>
    {depLinkStatus === "linked" ? (
      <DropdownMenuItem onClick={() => onRelinkNodeModules(worktree)}>
        重新链接 node_modules…
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem onClick={() => onLinkNodeModules(worktree)}>
        链接 node_modules…
      </DropdownMenuItem>
    )}
    {depLinkStatus === "linked" || depLinkStatus === "broken" ? (
      <DropdownMenuItem onClick={() => onUnlinkNodeModules(worktree)}>
        取消链接
      </DropdownMenuItem>
    ) : null}
    <DropdownMenuSeparator />
  </>
) : null}
```

App state for picker / overwrite:

```ts
type LinkPickerState = {
  target: Worktree;
  mode: "link" | "relink";
  sources: DepLinkStatusItem[];
  selectedSource: string;
} | null;

type OverwriteState = {
  targetPath: string;
  sourcePath: string;
  conflict: "directory" | "symlink" | string;
} | null;

type UnlinkConfirmState = Worktree | null;
```

Flow `onLinkNodeModules` / `onRelink`:
1. `sources = await api.listNodeModulesLinkSources(wt.projectId, wt.path)`
2. Default `selectedSource = wt.basedOnPath` if in sources, else `sources[0]?.path`
3. If no sources → `toast.error("同项目没有可用的 node_modules 源")`
4. Open Dialog listing sources (radio / button list): show branch/name via snapshot lookup; confirm → call `linkWorktreeNodeModules(target.path, selected, false)`
5. If `needsConfirm` → set `OverwriteState` with conflict; AlertDialog copy:
   - directory: `将删除现有真实 node_modules 目录，并链接到所选源。此操作不可从本应用撤销。`
   - symlink: `将替换现有 node_modules 软链。`
   Buttons: 取消 / 覆盖并链接 → `link(..., true)` → `applySnapshot`

Unlink: AlertDialog `确定取消 node_modules 软链？不会自动安装依赖。` → `api.unlinkWorktreeNodeModules` → applySnapshot. If backend `NotASymlink` → toast `本地安装，不是软链`.

- [ ] **Step 1: Extend Sidebar props + menu items.**

- [ ] **Step 2: Add picker Dialog + overwrite + unlink AlertDialogs in App; wire handlers.**

- [ ] **Step 3: `bunx tsc --noEmit`**

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(dep-link): sidebar link/relink/unlink menus and confirms"
```

---

### Task 6: Row status icon (linked / broken)

**Files:**
- Modify: `src/components/Sidebar.tsx` — worktree row chrome
- Modify: `src/App.tsx` — ensure snapshot hydration already carries status (from Task 3); optional explicit refresh after project refresh

**Interfaces:**
- Visual: next to worktree name, if `depLink?.status === "linked"` show small `LinkIcon` (lucide) muted; if `"broken"` show `Link2OffIcon` or `UnlinkIcon` with `text-destructive` / amber.
- Tooltip / `title`: `node_modules 已链接` / `node_modules 链接已损坏`.
- After `onRefreshProjectWorktrees` success, snapshot already hydrated via backend — no extra call required. Optional belt-and-suspenders: `getWorktreeDepLinkStatus` overlay map in App — **skip** if Task 3 hydrate is solid (YAGNI). Locked: **rely on snapshot hydrate**; icon reads `worktree.depLink?.status`.

Find the worktree row render (~650+) and add:

```tsx
{worktree.depLink?.status === "linked" ? (
  <LinkIcon className="size-3.5 text-muted-foreground" aria-label="node_modules 已链接" />
) : null}
{worktree.depLink?.status === "broken" ? (
  <UnlinkIcon className="size-3.5 text-amber-500" aria-label="node_modules 链接已损坏" />
) : null}
```

Import `LinkIcon`, `UnlinkIcon` from `lucide-react`.

- [ ] **Step 1: Add icons to worktree rows (both inline menu + context menu lists if duplicated).**

- [ ] **Step 2: `bunx tsc --noEmit`**

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(dep-link): sidebar linked/broken status icons"
```

---

### Task 7: Manual acceptance checklist

- [ ] **Step 1: Run app**

```bash
bun run tauri:dev
```

- [ ] **Step 2: Checklist（对照 spec Acceptance）**
  1. 基于有 `node_modules` 的 A（主仓或 worktree）创建 B 并勾选 → B 下 `node_modules` 为指向 A 的**绝对路径**软链；可在 B 跑脚本/dev。
  2. 未勾选创建 → B 无 `node_modules`；侧栏「链接 node_modules…」可选 A 或其它有依赖源；默认选中 `basedOnPath`。
  3. B 已有真目录或旧软链 → 出现覆盖确认（文案区分 directory vs symlink）；取消则不改；确认后覆盖。
  4. 「取消链接」→ 软链消失；无自动 install；真目录时菜单不提供取消或 toast「不是软链」。
  5. 删除/移走 A 的 `node_modules` 后刷新项目工作树 → B 显示 broken 图标；可取消链接或换源重链。
  6. 无法在 UI 选到项目外路径；若用命令强行传入 → 后端拒绝「不在同一项目内」。
  7. 链接失败（如源中途被删）→ worktree 仍在；toast 说明；可稍后补链。
  8. 旧 store 无新字段 → 应用仍可 `load_snapshot`。

- [ ] **Step 3: Fix bugs found; commit if needed**

```bash
git commit -m "fix(dep-link): <short bug description>"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Phase 1 only `node_modules` | Global + Task 1 kind |
| Create checkbox + after-create menu | Task 4 + Task 5 |
| Default source `basedOnPath` | Task 3 resolve + Task 4/5 defaults |
| Ask before overwrite | Task 1 NeedsConfirm + Task 5 dialog |
| Unlink only / no auto install | Task 1 unlink + Task 5 copy |
| Same git project only | Task 1 `ensure_same_project` |
| Absolute symlinks | Task 1 + Acceptance 1 |
| `create_worktree` git-only; FE links after | Task 3 metadata only + Task 4 |
| Data model `basedOnPath` + `depLink` | Task 3 |
| status none/linked/broken + refresh hydrate | Task 1 probe + Task 3 hydrate + Task 6 icon |
| Source picker same-project + source_ok | Task 2 list sources + Task 5 |
| Out of scope (venv/cache/Windows/cascade) | — not planned |
| Acceptance 1–6 | Task 7 |

## Placeholder scan

No TBD / “handle later”. Locked decisions: absolute symlinks; `linked_at: None` Phase 1; basedOn = matching `branch_name` path else `root_path`; hydrate in store on load/refresh/link/unlink; create stays git-only.

## Ambiguities resolved

1. **Absolute vs relative symlink** → absolute (spec non-binding note + user lock).
2. **`basedOnPath` when `start_from` is branch name only** → resolve at create: worktree with `branch_name == start_from`, else `project.root_path`.
3. **`linkedAt`** → field exists, always `None` in Phase 1 (no chrono dep).
4. **Hydrate** → backend `hydrate_dep_links` on load/refresh/link/unlink; FE icons read snapshot (no parallel overlay map).
