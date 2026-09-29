# Worktree node_modules Monorepo Multi-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 Phase 1 单路径软链，使创建时与侧栏均可扫描源 worktree 上的 package 级 `node_modules`、多选后批量软链到目标；`depLink` 改为 per-`relPath` 的 `links[]`，含旧数据迁移与聚合状态。

**Architecture:** 在现有 `dep_link.rs` 上增加扫描纯函数（深度 6、永不进入 `node_modules`、跳过 `.git`、上限 50 + truncated）与带 `relPath` 的 link/unlink/probe 原语；batch 命令循环单路径原语并一次写回 `links`。`NeedsConfirm` 携带冲突数 N。FE 创建对话框改为 master checkbox + 可展开多选；侧栏选源后多选（首次全选 / relink 偏好 recorded∩available）；hydrate 只校正已记录 `relPath`，不做全树重扫。

**Tech Stack:** Tauri 2 + Rust (`std::os::unix::fs::symlink`, `tempfile` for tests), React 19 + 现有 Dialog / AlertDialog / Checkbox / DropdownMenu, sonner toast。Phase 1 代码基线：`dep_link.rs` / `models.rs` DepLink / `commands.rs` link cmds / `store.rs` hydrate / `App.tsx` / `api.ts` / `Sidebar.tsx`。

**Spec:** `docs/superpowers/specs/2026-09-24-worktree-node-modules-monorepo-design.md`  
**Parent plan:** `docs/superpowers/plans/2026-09-24-worktree-node-modules-symlink.md`

## Global Constraints

- Local MacBook only (`/Users/ricolee/Desktop/rico/octopus`); no Cloud Agent / PR workflow.
- Discovery: depth max **6** (根下直接 `node_modules` 深度计为 1); **never enter** any directory named `node_modules`; always skip `.git`; soft cap **50** candidates + truncated notice; **do not** parse workspace yaml/json (`pnpm-workspace.yaml` / `package.json` workspaces / `lerna.json` / `nx.json`).
- Link: absolute symlinks only; `{target}/{relPath}/node_modules` → `{source}/{relPath}/node_modules`; **no** implicit `mkdir` of missing package parents (parent missing → that path fails, counted as error).
- `relPath` normalize: `""` or `"."` → `""` (根); reject any `..` segment; must stay under source/target root.
- Conflict: `force=false` 且任一选中路径冲突 → 整批 `NeedsConfirm { conflictCount: N }`；用户一次确认后 `force=true` 重试全部选中路径。
- Unlink: only remove symlinks recorded by this feature; real dir → skip + notice「本地安装，不是软链」; default unlink **all recorded** links for that worktree.
- Hydrate: **only** recorded `links[].relPath`; **forbid** full-tree `scan_*` on every snapshot/refresh.
- `create_worktree` stays git-only; FE batch-links after success; link failure does **not** roll back worktree.
- No auto `npm`/`pnpm`/`yarn`/`bun install`; no `.venv` / other dep kinds; no Windows junction special-case; no cross-project links.
- Phase 1 single-path commands remain as thin wrappers forwarding to batch with `relPaths: [""]` (or equivalent).
- Old store JSON: new fields `#[serde(default)]`; Phase 1 records without `links` migrate on read to `links: [{ relPath: "", ... }]`.
- Aggregate row status: any `broken` → `broken`; else any `linked` → `linked`; else `none`.
- Scan / batch commands may use `tokio::task::spawn_blocking` (or stay sync if fast); FE awaits once — no scan-progress polling protocol.
- Tests: `cargo test dep_link` (+ store hydrate tests); FE `bunx tsc --noEmit`; Vitest for FE helpers; manual Acceptance Task 8.
- Do not touch PTY / Agents / 右栏.

---

## File map

| File | Role |
|---|---|
| `src-tauri/src/dep_link.rs` | Extend: `normalize_rel_path`, scan, `*_at(rel)`, batch link/unlink pure helpers + TDD |
| `src-tauri/src/models.rs` | `DepLinkEntry`, `DepLink.links`, scan/batch result types; extend `NeedsConfirm` with `conflict_count` |
| `src-tauri/src/commands.rs` | `scan_worktree_node_modules`, `link_worktree_node_modules_batch`, `unlink_worktree_node_modules_batch`; Phase 1 cmds → thin wrappers |
| `src-tauri/src/store.rs` | Migrate on hydrate; probe **only** recorded `links[]`; recompute aggregate status |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/types.ts` | `DepLinkEntry`, `links`, scan/batch result types; `conflictCount` |
| `src/lib/api.ts` | FE wrappers for scan + batch link/unlink |
| `src/lib/dep-link/rel-path-label.ts` | Display label for `""` →「根」 |
| `src/lib/dep-link/rel-path-label.test.ts` | Vitest |
| `src/lib/dep-link/default-selected-rel-paths.ts` | First-link = all scan hits; relink = recorded ∩ available |
| `src/lib/dep-link/default-selected-rel-paths.test.ts` | Vitest |
| `src/App.tsx` | Create: master + expandable multi-select + post-create batch; sidebar picker: source → packages; overwrite N; unlink all recorded |
| `src/components/Sidebar.tsx` | Menus unchanged in intent; row icons still read aggregate `depLink.status` |

---

### Task 1: Rust scan pure helper (TDD)

**Files:**
- Modify: `src-tauri/src/dep_link.rs`
- Test: unit tests in `dep_link.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `std::fs`, existing `canonicalize_or` (optional for existence checks)
- Produces:

```rust
pub const SCAN_MAX_DEPTH: u32 = 6;
pub const SCAN_MAX_RESULTS: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanResult {
    /// Normalized relPaths (`""` for root). Sorted for stable UI.
    pub rel_paths: Vec<String>,
    pub truncated: bool,
}

/// BFS/DFS from `source_root`. Depth of `{root}/node_modules` = 1.
/// Never descends into a directory named `node_modules`.
/// Always skips directory entries named `.git`.
/// A hit is recorded only when `{source}/{rel}/node_modules` exists and
/// ultimately resolves as a directory (symlink-to-dir OK via `source_node_modules_ok_at` semantics).
/// Cap at 50; set `truncated=true` if more would qualify.
pub fn scan_package_node_modules(source_root: &Path) -> ScanResult;
```

- [ ] **Step 1: Write failing tests** at end of `dep_link.rs` tests module:

```rust
#[test]
fn scan_finds_root_and_package_nm_skips_nested() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("src");
    fs::create_dir_all(root.join("node_modules")).unwrap();
    fs::create_dir_all(root.join("packages/foo/node_modules")).unwrap();
    // nested inside package nm — must NOT appear as its own candidate
    fs::create_dir_all(root.join("packages/foo/node_modules/bar/node_modules")).unwrap();
    fs::create_dir_all(root.join(".git/node_modules")).unwrap(); // skipped via .git
    let result = scan_package_node_modules(&root);
    assert!(!result.truncated);
    assert_eq!(result.rel_paths, vec!["".to_string(), "packages/foo".to_string()]);
}

#[test]
fn scan_depth_limit_six() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("src");
    // depth 1: root/node_modules
    fs::create_dir_all(root.join("node_modules")).unwrap();
    // depth 6: a/b/c/d/e/node_modules  (e is depth 5 dir, node_modules depth 6)
    fs::create_dir_all(root.join("a/b/c/d/e/node_modules")).unwrap();
    // depth 7: a/b/c/d/e/f/node_modules — beyond limit
    fs::create_dir_all(root.join("a/b/c/d/e/f/node_modules")).unwrap();
    let result = scan_package_node_modules(&root);
    assert!(result.rel_paths.iter().any(|p| p == ""));
    assert!(result.rel_paths.iter().any(|p| p == "a/b/c/d/e"));
    assert!(!result.rel_paths.iter().any(|p| p == "a/b/c/d/e/f"));
}

#[test]
fn scan_caps_at_fifty_and_sets_truncated() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("src");
    fs::create_dir_all(&root).unwrap();
    for i in 0..55 {
        fs::create_dir_all(root.join(format!("pkg{i}/node_modules"))).unwrap();
    }
    let result = scan_package_node_modules(&root);
    assert_eq!(result.rel_paths.len(), 50);
    assert!(result.truncated);
}
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd src-tauri && cargo test scan_ -- --nocapture
```

Expected: compile error — `scan_package_node_modules` not found.

- [ ] **Step 3: Implement scan** in `dep_link.rs`:

```rust
pub const SCAN_MAX_DEPTH: u32 = 6;
pub const SCAN_MAX_RESULTS: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanResult {
    pub rel_paths: Vec<String>,
    pub truncated: bool,
}

fn is_skipped_dir_name(name: &str) -> bool {
    name == ".git" || name == "node_modules"
}

/// Returns true if `{root}/node_modules` exists and resolves as a directory.
fn package_nm_is_dir(package_root: &Path) -> bool {
    let nm = package_root.join("node_modules");
    let Ok(meta) = fs::symlink_metadata(&nm) else {
        return false;
    };
    if meta.file_type().is_symlink() {
        return fs::metadata(&nm).map(|m| m.is_dir()).unwrap_or(false);
    }
    meta.is_dir()
}

pub fn scan_package_node_modules(source_root: &Path) -> ScanResult {
    let mut rel_paths = Vec::new();
    let mut truncated = false;
    // queue: (dir_abs, rel_from_source, depth_of_this_dir)
    // source_root itself has depth 0; its child node_modules is depth 1.
    let mut stack = vec![(source_root.to_path_buf(), String::new(), 0u32)];

    while let Some((dir, rel, depth)) = stack.pop() {
        if rel_paths.len() >= SCAN_MAX_RESULTS {
            truncated = true;
            break;
        }
        // Check node_modules at this directory (depth+1 when counting the nm entry)
        if depth < SCAN_MAX_DEPTH && package_nm_is_dir(&dir) {
            if rel_paths.len() >= SCAN_MAX_RESULTS {
                truncated = true;
                break;
            }
            rel_paths.push(rel.clone());
        }
        if depth >= SCAN_MAX_DEPTH {
            continue;
        }
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if is_skipped_dir_name(&name) {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            // Follow only real directories (not files). Do not follow symlinked dirs into alien trees:
            // require is_dir on symlink_metadata without following, OR allow dir metadata.
            let meta = entry.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            // If the entry itself is named like a symlink to elsewhere, still OK if is_dir.
            let child_rel = if rel.is_empty() {
                name.to_string()
            } else {
                format!("{rel}/{name}")
            };
            stack.push((entry.path(), child_rel, depth + 1));
        }
    }

    rel_paths.sort();
    // If we stopped early due to cap mid-walk, truncated already true.
    // Also: if we filled exactly 50 but more siblings remain, best-effort:
    // re-check by seeing if walk aborted with cap — already set.
    ScanResult {
        rel_paths,
        truncated,
    }
}
```

Note for implementer: when cap hits mid-walk, set `truncated = true`. Prefer collecting into a buffer then truncate to 50 if you find it clearer — but tests require `len == 50` and `truncated == true` when 55 packages exist.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd src-tauri && cargo test scan_ -- --nocapture
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dep_link.rs
git commit -m "feat(dep-link): scan package-level node_modules with depth/cap"
```

---

### Task 2: Model — DepLinkEntry, links[], migration, aggregate status (TDD)

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/dep_link.rs` — pure `aggregate_status` + `migrate_dep_link_links` helpers (keep FS-free migration/aggregate testable without store)
- Modify: `src/types.ts`

**Interfaces:**
- Produces (Rust `models.rs`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DepLinkEntry {
    /// "" = repo root; never "."
    pub rel_path: String,
    pub status: DepLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepLink {
    pub kind: String,
    pub status: DepLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_at: Option<String>,
    #[serde(default)]
    pub links: Vec<DepLinkEntry>,
}
```

- Pure helpers in `dep_link.rs` (or `models.rs` if preferred — lock: **`dep_link.rs`** so store/commands call one place):

```rust
use crate::models::{DepLink, DepLinkEntry, DepLinkStatus};

/// any broken → Broken; else any linked → Linked; else None
pub fn aggregate_status(links: &[DepLinkEntry]) -> DepLinkStatus;

/// If `links` empty and top-level looks like Phase 1 (status Linked/Broken or linked_from set),
/// insert root entry from top-level fields. Always normalize `"."` → `""` on entries.
/// Returns true if mutation happened.
pub fn migrate_dep_link_links(dep: &mut DepLink) -> bool;

/// After per-path updates: set dep.status = aggregate; set dep.linked_from =
/// first linked entry's linked_from (or keep prior if all broken).
pub fn refresh_dep_link_aggregate(dep: &mut DepLink);
```

- FE `types.ts`:

```ts
export type DepLinkEntry = {
  relPath: string;
  status: DepLinkStatus;
  linkedFrom?: string | null;
};

export type DepLink = {
  kind: "node_modules";
  status: DepLinkStatus;
  linkedFrom?: string | null;
  linkedAt?: string | null;
  links?: DepLinkEntry[];
};
```

- [ ] **Step 1: Write failing tests** in `dep_link.rs`:

```rust
#[test]
fn aggregate_prefers_broken_then_linked() {
    use crate::models::{DepLinkEntry, DepLinkStatus};
    let links = vec![
        DepLinkEntry {
            rel_path: "".into(),
            status: DepLinkStatus::Linked,
            linked_from: Some("/a".into()),
        },
        DepLinkEntry {
            rel_path: "packages/foo".into(),
            status: DepLinkStatus::Broken,
            linked_from: Some("/a".into()),
        },
    ];
    assert_eq!(aggregate_status(&links), DepLinkStatus::Broken);
    let only_linked = vec![DepLinkEntry {
        rel_path: "".into(),
        status: DepLinkStatus::Linked,
        linked_from: None,
    }];
    assert_eq!(aggregate_status(&only_linked), DepLinkStatus::Linked);
    assert_eq!(aggregate_status(&[]), DepLinkStatus::None);
}

#[test]
fn migrate_phase1_single_path_into_links() {
    use crate::models::{DepLink, DepLinkStatus};
    let mut dep = DepLink {
        kind: "node_modules".into(),
        status: DepLinkStatus::Linked,
        linked_from: Some("/repo".into()),
        linked_at: None,
        links: vec![],
    };
    assert!(migrate_dep_link_links(&mut dep));
    assert_eq!(dep.links.len(), 1);
    assert_eq!(dep.links[0].rel_path, "");
    assert_eq!(dep.links[0].status, DepLinkStatus::Linked);
    assert_eq!(dep.links[0].linked_from.as_deref(), Some("/repo"));
    assert!(!migrate_dep_link_links(&mut dep)); // idempotent
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd src-tauri && cargo test aggregate_ migrate_ -- --nocapture
```

- [ ] **Step 3: Add types + implement helpers**

```rust
pub fn aggregate_status(links: &[crate::models::DepLinkEntry]) -> crate::models::DepLinkStatus {
    use crate::models::DepLinkStatus;
    if links.iter().any(|l| l.status == DepLinkStatus::Broken) {
        return DepLinkStatus::Broken;
    }
    if links.iter().any(|l| l.status == DepLinkStatus::Linked) {
        return DepLinkStatus::Linked;
    }
    DepLinkStatus::None
}

pub fn migrate_dep_link_links(dep: &mut crate::models::DepLink) -> bool {
    use crate::models::{DepLinkEntry, DepLinkStatus};
    let mut changed = false;
    for entry in &mut dep.links {
        if entry.rel_path == "." {
            entry.rel_path = String::new();
            changed = true;
        }
    }
    let needs_root = dep.links.is_empty()
        && (dep.status == DepLinkStatus::Linked
            || dep.status == DepLinkStatus::Broken
            || dep.linked_from.is_some());
    if needs_root {
        dep.links.push(DepLinkEntry {
            rel_path: String::new(),
            status: dep.status.clone(),
            linked_from: dep.linked_from.clone(),
        });
        changed = true;
    }
    changed
}

pub fn refresh_dep_link_aggregate(dep: &mut crate::models::DepLink) {
    dep.status = aggregate_status(&dep.links);
    if let Some(from) = dep
        .links
        .iter()
        .find(|l| l.status == crate::models::DepLinkStatus::Linked)
        .and_then(|l| l.linked_from.clone())
    {
        dep.linked_from = Some(from);
    } else if dep.status == crate::models::DepLinkStatus::None {
        dep.linked_from = None;
    }
}
```

Update every `DepLink { ... }` literal in the repo (`commands.rs`, `store.rs` tests) to include `links: vec![]` or appropriate entries — compile-driven.

- [ ] **Step 4: Mirror types in `src/types.ts`** (optional `links?` for back-compat reads).

- [ ] **Step 5: Run**

```bash
cd src-tauri && cargo test aggregate_ migrate_ && cargo check
bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/dep_link.rs src-tauri/src/commands.rs src-tauri/src/store.rs src/types.ts
git commit -m "feat(dep-link): DepLinkEntry links[] migration and aggregate status"
```

---

### Task 3: relPath-aware link/unlink + batch pure helpers (TDD)

**Files:**
- Modify: `src-tauri/src/dep_link.rs`
- Modify: `src-tauri/src/models.rs` — batch result / extended `LinkError` or batch error type used by commands later

**Interfaces:**
- Produces:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    OutsideProject,
    SourceMissing,
    SourceNotDir,
    NeedsConfirm { is_symlink: bool },
    /// Batch-only: force=false and N selected paths already exist
    NeedsConfirmBatch { conflict_count: usize },
    InvalidRelPath,
    TargetParentMissing,
    Io(String),
    NotASymlink,
}

/// Normalize user/scan relPath: trim, "." → "", reject empty segments and any ".." .
pub fn normalize_rel_path(rel: &str) -> Result<String, LinkError>;

pub fn package_dir(root: &Path, rel: &str) -> Result<PathBuf, LinkError>; // root.join(rel) after normalize; rel "" → root

pub fn source_node_modules_ok_at(source_root: &Path, rel: &str) -> bool;
pub fn probe_target_at(target_root: &Path, rel: &str) -> ProbeResult;

/// Symlink `{target}/{rel}/node_modules` → absolute `{source}/{rel}/node_modules`.
/// If `{target}/{rel}` missing → `TargetParentMissing` (do NOT mkdir).
/// Existing Phase 1 `link_node_modules` / `unlink_node_modules` / `probe_target` /
/// `source_node_modules_ok` become wrappers calling `*_at(..., "")`.
pub fn link_node_modules_at(
    target_root: &Path,
    source_root: &Path,
    rel_path: &str,
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError>;

pub fn unlink_node_modules_at(target_root: &Path, rel_path: &str) -> Result<(), LinkError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchUnlinkNotice {
    pub rel_path: String,
    pub kind: BatchUnlinkNoticeKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchUnlinkNoticeKind {
    NotASymlink,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchUnlinkResult {
    pub unlinked: Vec<String>,
    pub notices: Vec<BatchUnlinkNotice>,
}

/// force=false: count conflicts across rel_paths first; if >0 return NeedsConfirmBatch.
/// force=true: link each with force. Stop on first hard error (OutsideProject, InvalidRelPath,
/// SourceMissing, SourceNotDir, TargetParentMissing, Io) — do not partial-commit silently;
/// implementer may still leave already-linked paths on disk (document in command layer:
/// command should pre-validate sources before mutating when practical).
pub fn link_node_modules_batch(
    target_root: &Path,
    source_root: &Path,
    rel_paths: &[String],
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError>;

pub fn unlink_node_modules_batch(
    target_root: &Path,
    rel_paths: &[String],
) -> BatchUnlinkResult;
```

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn normalize_rel_path_rejects_dotdot() {
    assert!(matches!(
        normalize_rel_path("../x"),
        Err(LinkError::InvalidRelPath)
    ));
    assert_eq!(normalize_rel_path(".").unwrap(), "");
    assert_eq!(normalize_rel_path("packages/foo").unwrap(), "packages/foo");
}

#[test]
fn link_at_package_rel_path_absolute() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    fs::create_dir_all(main.join("packages/foo")).unwrap();
    fs::create_dir_all(main.join("packages/foo/node_modules")).unwrap();
    fs::create_dir_all(wt.join("packages/foo")).unwrap();
    link_node_modules_at(
        &wt,
        &main,
        "packages/foo",
        &main,
        &[wt.clone()],
        false,
    )
    .unwrap();
    let target = wt.join("packages/foo/node_modules");
    assert!(target.symlink_metadata().unwrap().file_type().is_symlink());
    assert!(fs::read_link(&target).unwrap().is_absolute());
}

#[test]
fn link_at_missing_parent_errors_without_mkdir() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    fs::create_dir_all(main.join("packages/foo/node_modules")).unwrap();
    fs::create_dir_all(&wt).unwrap();
    // wt/packages/foo does NOT exist
    let err = link_node_modules_at(
        &wt,
        &main,
        "packages/foo",
        &main,
        &[wt.clone()],
        false,
    )
    .unwrap_err();
    assert!(matches!(err, LinkError::TargetParentMissing));
    assert!(!wt.join("packages/foo").exists());
}

#[test]
fn batch_needs_confirm_with_conflict_count() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    fs::create_dir_all(main.join("node_modules")).unwrap();
    fs::create_dir_all(wt.join("node_modules")).unwrap(); // real dir conflict at root
    fs::create_dir_all(main.join("packages/foo/node_modules")).unwrap();
    fs::create_dir_all(wt.join("packages/foo/node_modules")).unwrap(); // real dir conflict
    let rels = vec!["".to_string(), "packages/foo".to_string()];
    let err = link_node_modules_batch(&wt, &main, &rels, &main, &[wt.clone()], false).unwrap_err();
    assert!(matches!(err, LinkError::NeedsConfirmBatch { conflict_count: 2 }));
}

#[test]
fn batch_unlink_skips_real_dir_with_notice() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    fs::create_dir_all(main.join("node_modules")).unwrap();
    fs::create_dir_all(&wt).unwrap();
    link_node_modules_at(&wt, &main, "", &main, &[wt.clone()], false).unwrap();
    fs::create_dir_all(wt.join("packages/foo/node_modules")).unwrap(); // real dir
    let result = unlink_node_modules_batch(
        &wt,
        &["".to_string(), "packages/foo".to_string()],
    );
    assert_eq!(result.unlinked, vec!["".to_string()]);
    assert!(result.notices.iter().any(|n| {
        n.rel_path == "packages/foo" && n.kind == BatchUnlinkNoticeKind::NotASymlink
    }));
    assert!(wt.join("packages/foo/node_modules").is_dir());
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd src-tauri && cargo test normalize_rel_path link_at_ batch_ -- --nocapture
```

- [ ] **Step 3: Implement**

```rust
pub fn normalize_rel_path(rel: &str) -> Result<String, LinkError> {
    let rel = rel.trim().trim_matches('/');
    if rel.is_empty() || rel == "." {
        return Ok(String::new());
    }
    let mut parts = Vec::new();
    for part in rel.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(LinkError::InvalidRelPath);
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

pub fn package_dir(root: &Path, rel: &str) -> Result<PathBuf, LinkError> {
    let rel = normalize_rel_path(rel)?;
    if rel.is_empty() {
        Ok(root.to_path_buf())
    } else {
        Ok(root.join(rel))
    }
}

pub fn link_node_modules_at(
    target_root: &Path,
    source_root: &Path,
    rel_path: &str,
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError> {
    let target_root = ensure_same_project(target_root, main_root, worktree_paths)?;
    let source_root = ensure_same_project(source_root, main_root, worktree_paths)?;
    if same_path(&target_root, &source_root) {
        return Err(LinkError::Io("不能链接到自身".into()));
    }
    let rel = normalize_rel_path(rel_path)?;
    let source_pkg = package_dir(&source_root, &rel)?;
    let target_pkg = package_dir(&target_root, &rel)?;
    if !target_pkg.is_dir() {
        return Err(LinkError::TargetParentMissing);
    }
    let source_nm = source_pkg.join("node_modules");
    if !source_nm.exists() {
        return Err(LinkError::SourceMissing);
    }
    if !source_node_modules_ok_at(&source_root, &rel) {
        return Err(LinkError::SourceNotDir);
    }
    let source_nm_abs = canonicalize_or(&source_nm);
    let target_nm = target_pkg.join("node_modules");
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

pub fn link_node_modules_batch(
    target_root: &Path,
    source_root: &Path,
    rel_paths: &[String],
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError> {
    let mut normalized = Vec::new();
    for rel in rel_paths {
        normalized.push(normalize_rel_path(rel)?);
    }
    if !force {
        let mut conflict_count = 0usize;
        for rel in &normalized {
            let target_pkg = package_dir(target_root, rel)?;
            let target_nm = target_pkg.join("node_modules");
            if target_nm.exists() || fs::symlink_metadata(&target_nm).is_ok() {
                conflict_count += 1;
            }
        }
        if conflict_count > 0 {
            return Err(LinkError::NeedsConfirmBatch { conflict_count });
        }
    }
    for rel in &normalized {
        link_node_modules_at(
            target_root,
            source_root,
            rel,
            main_root,
            worktree_paths,
            force,
        )?;
    }
    Ok(())
}

pub fn source_node_modules_ok_at(source_root: &Path, rel: &str) -> bool {
    let Ok(pkg) = package_dir(source_root, rel) else {
        return false;
    };
    package_nm_is_dir(&pkg)
}

pub fn probe_target_at(target_root: &Path, rel: &str) -> ProbeResult {
    let Ok(pkg) = package_dir(target_root, rel) else {
        return ProbeResult {
            status: ProbeStatus::None,
            linked_from: None,
        };
    };
    // Same logic as probe_target but on pkg.join("node_modules");
    // linked_from = source *worktree/main root* is NOT recoverable from package parent alone
    // when rel != "". Keep probe.linked_from = resolved.parent() of the nm path
    // (package dir). Hydrate prefers stored linked_from (source root) over probe.
    let nm = pkg.join("node_modules");
    let Ok(meta) = fs::symlink_metadata(&nm) else {
        return ProbeResult {
            status: ProbeStatus::None,
            linked_from: None,
        };
    };
    if !meta.file_type().is_symlink() {
        return ProbeResult {
            status: ProbeStatus::None,
            linked_from: None,
        };
    }
    match fs::canonicalize(&nm) {
        Ok(resolved) if resolved.is_dir() => ProbeResult {
            status: ProbeStatus::Linked,
            linked_from: resolved.parent().map(|p| p.to_path_buf()),
        },
        _ => ProbeResult {
            status: ProbeStatus::Broken,
            linked_from: None,
        },
    }
}

pub fn unlink_node_modules_at(target_root: &Path, rel_path: &str) -> Result<(), LinkError> {
    let pkg = package_dir(target_root, rel_path)?;
    let target_nm = pkg.join("node_modules");
    let meta = fs::symlink_metadata(&target_nm).map_err(|_| LinkError::NotASymlink)?;
    if !meta.file_type().is_symlink() {
        return Err(LinkError::NotASymlink);
    }
    fs::remove_file(&target_nm).map_err(|e| LinkError::Io(e.to_string()))
}

pub fn unlink_node_modules_batch(target_root: &Path, rel_paths: &[String]) -> BatchUnlinkResult {
    let mut unlinked = Vec::new();
    let mut notices = Vec::new();
    for rel in rel_paths {
        let Ok(norm) = normalize_rel_path(rel) else {
            notices.push(BatchUnlinkNotice {
                rel_path: rel.clone(),
                kind: BatchUnlinkNoticeKind::Missing,
            });
            continue;
        };
        match unlink_node_modules_at(target_root, &norm) {
            Ok(()) => unlinked.push(norm),
            Err(LinkError::NotASymlink) => {
                let pkg = package_dir(target_root, &norm).ok();
                let nm = pkg.map(|p| p.join("node_modules"));
                let exists = nm.as_ref().map(|p| p.exists()).unwrap_or(false);
                notices.push(BatchUnlinkNotice {
                    rel_path: norm,
                    kind: if exists {
                        BatchUnlinkNoticeKind::NotASymlink
                    } else {
                        BatchUnlinkNoticeKind::Missing
                    },
                });
            }
            Err(_) => notices.push(BatchUnlinkNotice {
                rel_path: norm,
                kind: BatchUnlinkNoticeKind::Missing,
            }),
        }
    }
    BatchUnlinkResult { unlinked, notices }
}

// Phase 1 wrappers:
pub fn link_node_modules(
    target_root: &Path,
    source_root: &Path,
    main_root: &Path,
    worktree_paths: &[PathBuf],
    force: bool,
) -> Result<(), LinkError> {
    link_node_modules_at(target_root, source_root, "", main_root, worktree_paths, force)
}

pub fn unlink_node_modules(target_root: &Path) -> Result<(), LinkError> {
    unlink_node_modules_at(target_root, "")
}

pub fn probe_target(target_root: &Path) -> ProbeResult {
    probe_target_at(target_root, "")
}

pub fn source_node_modules_ok(source_root: &Path) -> bool {
    source_node_modules_ok_at(source_root, "")
}
```

Refactor existing `link_node_modules` / `unlink_node_modules` / `probe_target` / `source_node_modules_ok` to call `*_at(..., "")` so Phase 1 tests keep passing. Extend `map_link_error` later in Task 4 for new variants: `InvalidRelPath` → `"非法相对路径"`, `TargetParentMissing` → `"目标 package 目录不存在"`, `NeedsConfirmBatch` handled by caller.

- [ ] **Step 4: Run all dep_link tests — expect PASS**

```bash
cd src-tauri && cargo test dep_link -- --nocapture
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dep_link.rs src-tauri/src/models.rs
git commit -m "feat(dep-link): relPath link/unlink primitives and batch helpers"
```

---

### Task 4: Tauri commands + api.ts (scan / batch / Phase 1 wrappers)

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (invoke_handler)
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Models:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanNodeModulesResult {
    pub rel_paths: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LinkNodeModulesResult {
    Ok { snapshot: AppSnapshot },
    /// Phase 1 single-path kept for compat; batch uses conflict_count
    NeedsConfirm {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        conflict: Option<String>, // "directory" | "symlink" for single-path wrapper
        #[serde(default)]
        conflict_count: usize,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkNodeModulesBatchResult {
    pub snapshot: AppSnapshot,
    pub notices: Vec<String>, // Chinese messages for skipped real dirs etc.
}
```

Locked serde for FE: `conflictCount` always present on `needsConfirm` (0 for unused). Phase 1 FE currently reads `result.conflict` — keep emitting `conflict` for single-path wrapper; batch sets `conflict: None` (or omit) and `conflict_count: N`. Update FE types:

```ts
export type LinkNodeModulesResult =
  | { status: "ok"; snapshot: AppSnapshot }
  | {
      status: "needsConfirm";
      conflict?: "directory" | "symlink" | string | null;
      conflictCount: number;
    };

export type ScanNodeModulesResult = {
  relPaths: string[];
  truncated: boolean;
};

export type UnlinkNodeModulesBatchResult = {
  snapshot: AppSnapshot;
  notices: string[];
};
```

- Commands:

```rust
#[tauri::command]
pub fn scan_worktree_node_modules(
    state: State<AppState>,
    source_path: String,
) -> Result<ScanNodeModulesResult, String>;

#[tauri::command]
pub fn link_worktree_node_modules_batch(
    state: State<AppState>,
    target_path: String,
    source_path: String,
    rel_paths: Vec<String>,
    force: bool,
) -> Result<LinkNodeModulesResult, String>;

#[tauri::command]
pub fn unlink_worktree_node_modules_batch(
    state: State<AppState>,
    target_path: String,
    rel_paths: Option<Vec<String>>,
) -> Result<UnlinkNodeModulesBatchResult, String>;
```

**Batch link behavior:**
1. `project_context_for_path(target)`.
2. Ensure `source_path` same project.
3. Call `link_node_modules_batch`.
4. On `NeedsConfirmBatch { conflict_count }` → `NeedsConfirm { conflict: None, conflict_count }`.
5. On success: find target worktree; set

```rust
let entries: Vec<DepLinkEntry> = rel_paths.iter().map(|rel| DepLinkEntry {
    rel_path: normalize_rel_path(rel).unwrap_or_default(),
    status: DepLinkStatus::Linked,
    linked_from: Some(source_path.clone()),
}).collect();
// Merge: upsert these rels into existing links (after migrate); remove? keep other recorded rels not in this batch.
worktree.dep_link = Some(DepLink { kind: "node_modules".into(), status: ..., linked_from: Some(source_path), linked_at: None, links: merged });
refresh_dep_link_aggregate(...);
store.hydrate_dep_links();
persist; return Ok { snapshot }
```

**Merge rule (locked):** upsert batch `rel_paths` as Linked from `source_path`; leave other existing `links` entries unchanged (allows partial add). Relink of overlapping paths updates their `linked_from`.

**Batch unlink behavior:**
1. Load worktree `dep_link`, `migrate_dep_link_links`.
2. `rel_paths` arg `None` or empty → use all `links[].rel_path`.
3. `unlink_node_modules_batch`; build Chinese notices for `NotASymlink` → `"{label}: 本地安装，不是软链"` where label is「根」or rel.
4. Remove successfully unlinked rels from `links`; if `links` empty set `dep_link = None`; else refresh aggregate.
5. hydrate + persist; return snapshot + notices.

**Phase 1 wrappers:**

Locked Phase 1 wrappers (keep command names; FE multi-path uses batch).
Implement shared helpers `link_batch_inner(&state, …)` / `unlink_batch_inner(&state, …)` used by both batch commands and thin wrappers — do **not** invoke one `#[tauri::command]` from another if `State` ownership is awkward:

```rust
#[tauri::command]
pub fn link_worktree_node_modules(
    state: State<AppState>,
    target_path: String,
    source_path: String,
    force: bool,
) -> Result<LinkNodeModulesResult, String> {
    let result = link_batch_inner(&state, &target_path, &source_path, &["".to_string()], force)?;
    match result {
        LinkNodeModulesResult::NeedsConfirm {
            conflict_count,
            conflict,
        } => {
            let conflict = conflict.or_else(|| {
                let nm = Path::new(&target_path).join("node_modules");
                let is_symlink = fs::symlink_metadata(&nm)
                    .map(|m| m.file_type().is_symlink())
                    .unwrap_or(false);
                Some(if is_symlink {
                    "symlink".into()
                } else {
                    "directory".into()
                })
            });
            Ok(LinkNodeModulesResult::NeedsConfirm {
                conflict,
                conflict_count: conflict_count.max(1),
            })
        }
        other => Ok(other),
    }
}

#[tauri::command]
pub fn unlink_worktree_node_modules(
    state: State<AppState>,
    target_path: String,
) -> Result<AppSnapshot, String> {
    // Phase 1 API returns snapshot only; notices ignored
    Ok(unlink_batch_inner(&state, &target_path, Some(vec!["".to_string()]))?.snapshot)
}

#[tauri::command]
pub fn link_worktree_node_modules_batch(
    state: State<AppState>,
    target_path: String,
    source_path: String,
    rel_paths: Vec<String>,
    force: bool,
) -> Result<LinkNodeModulesResult, String> {
    link_batch_inner(&state, &target_path, &source_path, &rel_paths, force)
}
```

On batch link success when `rel_paths == [""]`, persist `links: [DepLinkEntry { rel_path: "", status: Linked, linked_from: Some(source) }]`.

**list_node_modules_link_sources upgrade:** keep candidate roots; `source_ok` = `!scan_package_node_modules(path).rel_paths.is_empty()` (not only root nm). Status still from `probe_target` on root for the item (row-level; good enough for picker list).

- [ ] **Step 1: Add model result types; extend `LinkNodeModulesResult`.**

Update FE that switches on `needsConfirm` to read `conflictCount` (Task 5/6 will finish UI). Temporarily in App.tsx overwrite dialog, treat `conflictCount ?? (conflict ? 1 : 0)` so tsc passes after type change — do minimal compile fix here:

```ts
// App.tsx confirmLinkFromPicker / overwrite copy — temporary:
const n = result.conflictCount ?? 1;
```

Full N copy lands in Task 6.

- [ ] **Step 2: Implement three commands + adjust Phase 1 persist to write `links`.**

- [ ] **Step 3: Register in `lib.rs`:**

```rust
commands::scan_worktree_node_modules,
commands::link_worktree_node_modules_batch,
commands::unlink_worktree_node_modules_batch,
```

- [ ] **Step 4: api.ts**

```ts
scanWorktreeNodeModules: (sourcePath: string) =>
  invoke<ScanNodeModulesResult>("scan_worktree_node_modules", { sourcePath }),
linkWorktreeNodeModulesBatch: (
  targetPath: string,
  sourcePath: string,
  relPaths: string[],
  force: boolean,
) =>
  invoke<LinkNodeModulesResult>("link_worktree_node_modules_batch", {
    targetPath,
    sourcePath,
    relPaths,
    force,
  }),
unlinkWorktreeNodeModulesBatch: (targetPath: string, relPaths: string[] | null) =>
  invoke<UnlinkNodeModulesBatchResult>("unlink_worktree_node_modules_batch", {
    targetPath,
    relPaths,
  }),
```

Keep old `linkWorktreeNodeModules` / `unlinkWorktreeNodeModules` wrappers for any residual callers; prefer batch in new UI.

- [ ] **Step 5: Build check**

```bash
cd src-tauri && cargo test dep_link && cargo check
bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/lib/api.ts src/App.tsx
git commit -m "feat(dep-link): scan and batch link/unlink tauri commands"
```

---

### Task 5: FE create dialog — master checkbox + expandable multi-select

**Files:**
- Create: `src/lib/dep-link/rel-path-label.ts`
- Create: `src/lib/dep-link/rel-path-label.test.ts`
- Create: `src/lib/dep-link/default-selected-rel-paths.ts`
- Create: `src/lib/dep-link/default-selected-rel-paths.test.ts`
- Modify: `src/App.tsx` — create dialog state + UI + `confirmCreate` post-create batch link

**Interfaces:**

```ts
// rel-path-label.ts
export function relPathLabel(relPath: string): string {
  return relPath === "" || relPath === "." ? "根" : relPath;
}

// default-selected-rel-paths.ts
/** First link: all scan hits. Relink: recorded ∩ available; if intersection empty → all available. */
export function defaultSelectedRelPaths(args: {
  mode: "link" | "relink";
  available: string[];
  recorded: string[];
}): string[] {
  const available = args.available;
  if (args.mode === "link") {
    return [...available];
  }
  const set = new Set(available);
  const preferred = args.recorded.filter((r) => set.has(r));
  return preferred.length > 0 ? preferred : [...available];
}
```

App create state (replace single boolean probe-only flow):

```ts
const [linkNodeModules, setLinkNodeModules] = useState(false);
const [createScan, setCreateScan] = useState<ScanNodeModulesResult | null>(null);
const [createSelectedRels, setCreateSelectedRels] = useState<string[]>([]);
const [createPackagesOpen, setCreatePackagesOpen] = useState(false);
```

When based-on path changes: `api.scanWorktreeNodeModules(basedOnPath)` → set scan; if `relPaths.length === 0` disable master + clear selection; else default `linkNodeModules=true`, `createSelectedRels = relPaths`, toast if `truncated` once: `toast.message("已截断，仅显示前 50 个")`.

UI (after start-from block):

```tsx
<label className={cn("flex items-start gap-2 text-sm", !(createScan && createScan.relPaths.length) && "opacity-50")}>
  <Checkbox
    checked={linkNodeModules}
    disabled={!createScan || createScan.relPaths.length === 0}
    onCheckedChange={(v) => {
      const on = v === true;
      setLinkNodeModules(on);
      if (on && createScan) setCreateSelectedRels([...createScan.relPaths]);
    }}
  />
  <span className="grid gap-0.5 flex-1">
    <span className="flex items-center justify-between gap-2">
      <span>链接源的 node_modules</span>
      {linkNodeModules && createScan && createScan.relPaths.length > 0 ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => setCreatePackagesOpen((o) => !o)}
        >
          {createPackagesOpen ? "收起" : `已选 ${createSelectedRels.length}/${createScan.relPaths.length}`}
        </button>
      ) : null}
    </span>
    <span className="text-xs text-muted-foreground">
      {createScan && createScan.relPaths.length > 0
        ? `源：${basedOnLabel(project, basedOnPath, worktrees)}`
        : "源尚无 node_modules"}
    </span>
    {createPackagesOpen && createScan ? (
      <div className="mt-1 max-h-40 overflow-auto grid gap-1 border rounded-md p-2">
        {createScan.relPaths.map((rel) => (
          <label key={rel || "__root"} className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={createSelectedRels.includes(rel)}
              onCheckedChange={(v) => {
                setCreateSelectedRels((prev) => {
                  if (v === true) return prev.includes(rel) ? prev : [...prev, rel];
                  return prev.filter((x) => x !== rel);
                });
              }}
            />
            <span>{relPathLabel(rel)}</span>
          </label>
        ))}
      </div>
    ) : null}
  </span>
</label>
```

`confirmCreate` after successful create (no `mutation.error`):

```ts
} else if (linkNodeModules && focusedId && createSelectedRels.length > 0) {
  const created = mutation.snapshot.worktrees.find((w) => w.id === focusedId);
  const project = mutation.snapshot.projects.find((p) => p.id === createProjectId);
  if (created && project) {
    const source =
      created.basedOnPath ??
      resolveBasedOnPath(project, startFrom.trim(), mutation.snapshot.worktrees);
    try {
      const linkResult = await api.linkWorktreeNodeModulesBatch(
        created.path,
        source,
        createSelectedRels,
        false,
      );
      if (linkResult.status === "needsConfirm") {
        toast.error("目标已有 node_modules，请稍后在菜单中链接");
      } else {
        applySnapshot(linkResult.snapshot, focusedId);
      }
    } catch (error) {
      toast.error(`工作树已创建，但链接 node_modules 失败：${invokeError(error)}`);
    }
  }
}
```

Reset scan/selection in `openCreate`.

- [ ] **Step 1: Vitest for `relPathLabel` + `defaultSelectedRelPaths`.**

```ts
import { describe, expect, it } from "vitest";
import { relPathLabel } from "./rel-path-label";
import { defaultSelectedRelPaths } from "./default-selected-rel-paths";

describe("relPathLabel", () => {
  it("maps root", () => {
    expect(relPathLabel("")).toBe("根");
    expect(relPathLabel("packages/foo")).toBe("packages/foo");
  });
});

describe("defaultSelectedRelPaths", () => {
  it("link selects all", () => {
    expect(
      defaultSelectedRelPaths({
        mode: "link",
        available: ["", "packages/a"],
        recorded: [""],
      }),
    ).toEqual(["", "packages/a"]);
  });
  it("relink prefers recorded intersection", () => {
    expect(
      defaultSelectedRelPaths({
        mode: "relink",
        available: ["", "packages/a", "packages/b"],
        recorded: ["", "packages/b", "packages/gone"],
      }),
    ).toEqual(["", "packages/b"]);
  });
});
```

- [ ] **Step 2: `bun test src/lib/dep-link` — FAIL then implement — PASS.**

- [ ] **Step 3: Wire App create dialog + confirmCreate batch.**

- [ ] **Step 4: `bunx tsc --noEmit && bun test src/lib/dep-link`**

- [ ] **Step 5: Commit**

```bash
git add src/lib/dep-link src/App.tsx
git commit -m "feat(dep-link): create dialog multi-select package link"
```

---

### Task 6: FE sidebar — source pick → multi-select; overwrite N; unlink all recorded

**Files:**
- Modify: `src/App.tsx` — `LinkPickerState`, overwrite copy, unlink via batch
- Modify: `src/components/Sidebar.tsx` only if props need selected-count labels (menus stay link/relink/unlink)

**Interfaces:**

```ts
type LinkPickerState = {
  target: Worktree;
  mode: "link" | "relink";
  sources: DepLinkStatusItem[];
  selectedSource: string;
  availableRelPaths: string[];
  selectedRelPaths: string[];
  truncated: boolean;
} | null;

type OverwriteState = {
  targetPath: string;
  sourcePath: string;
  relPaths: string[];
  conflictCount: number;
  conflict?: string | null;
} | null;
```

**Flow `openLinkPicker`:**
1. `sources = await api.listNodeModulesLinkSources(wt.projectId, wt.path)` (backend already scan-based `source_ok`).
2. Default source = `basedOnPath` if in list else `sources[0]`.
3. `scan = await api.scanWorktreeNodeModules(selectedSource)`.
4. `recorded = (wt.depLink?.links ?? []).map(l => l.relPath)` (if no links but Phase 1 top-level linked, treat recorded as `[""]` client-side).
5. `selectedRelPaths = defaultSelectedRelPaths({ mode, available: scan.relPaths, recorded })`.
6. If `scan.truncated` → `toast.message("已截断，仅显示前 50 个")`.

When user changes `selectedSource` in dialog: re-scan and recompute defaults for current mode.

Dialog UI: radio/list of sources (existing) **plus** checkbox list of `availableRelPaths` (labels via `relPathLabel`). Confirm disabled if `selectedRelPaths.length === 0`.

`confirmLinkFromPicker`:

```ts
const result = await api.linkWorktreeNodeModulesBatch(
  targetPath,
  sourcePath,
  force ? overwrite.relPaths : picker.selectedRelPaths,
  force,
);
if (result.status === "needsConfirm") {
  setOverwriteConfirm({
    targetPath,
    sourcePath,
    relPaths: picker?.selectedRelPaths ?? overwrite?.relPaths ?? [],
    conflictCount: result.conflictCount,
    conflict: result.conflict,
  });
  ...
}
```

Overwrite AlertDialog copy:

```tsx
将覆盖 {overwriteConfirm.conflictCount} 个已存在的 node_modules 路径（含真实目录或旧软链），并链接到所选源。此操作不可从本应用撤销。
```

Buttons: 取消 / 覆盖并链接 → `confirmLinkFromPicker(true)`.

**Unlink:**

```ts
const result = await api.unlinkWorktreeNodeModulesBatch(target.path, null);
applySnapshot(result.snapshot);
for (const notice of result.notices) {
  toast.message(notice);
}
```

AlertDialog copy: `确定取消本工作树由本功能创建的全部 node_modules 软链？不会自动安装依赖。`

- [ ] **Step 1: Extend LinkPickerState + dialog UI (source + packages).**

- [ ] **Step 2: Wire batch confirm + overwrite N + unlink batch.**

- [ ] **Step 3: `bunx tsc --noEmit`**

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/lib/dep-link
git commit -m "feat(dep-link): sidebar multi-path link/relink/unlink UX"
```

---

### Task 7: Hydrate recorded-only + migration on read; row icons use aggregate

**Files:**
- Modify: `src-tauri/src/store.rs` — rewrite `hydrate_dep_links`
- Modify: `src-tauri/src/store.rs` tests
- Modify: `src/components/Sidebar.tsx` — icons already use `worktree.depLink?.status`; verify no per-path UI needed (spec: row icons = aggregate only)

**Interfaces:**
- Locked hydrate algorithm:

```rust
pub fn hydrate_dep_links(&mut self) {
    for wt in &mut self.worktrees {
        let Some(dep) = wt.dep_link.as_mut() else {
            continue; // do NOT invent links from disk when metadata absent
        };
        crate::dep_link::migrate_dep_link_links(dep);
        if dep.links.is_empty() {
            wt.dep_link = None;
            continue;
        }
        for entry in &mut dep.links {
            let probe = crate::dep_link::probe_target_at(Path::new(&wt.path), &entry.rel_path);
            match probe.status {
                crate::dep_link::ProbeStatus::None => {
                    entry.status = DepLinkStatus::None;
                    // keep linked_from for history? locked: clear per-path linked_from on None
                    entry.linked_from = None;
                }
                crate::dep_link::ProbeStatus::Linked => {
                    entry.status = DepLinkStatus::Linked;
                    // prefer existing entry.linked_from / dep.linked_from over probe parent
                    if entry.linked_from.is_none() {
                        entry.linked_from = dep.linked_from.clone().or_else(|| {
                            probe.linked_from.map(|p| p.to_string_lossy().into_owned())
                        });
                    }
                }
                crate::dep_link::ProbeStatus::Broken => {
                    entry.status = DepLinkStatus::Broken;
                }
            }
        }
        // Drop entries that are None (no symlink anymore)? Locked: remove None entries so aggregate stays clean.
        dep.links.retain(|e| e.status != DepLinkStatus::None);
        if dep.links.is_empty() {
            wt.dep_link = None;
        } else {
            crate::dep_link::refresh_dep_link_aggregate(dep);
        }
    }
}
```

**Important:** Do **not** call `scan_package_node_modules` inside hydrate.

- [ ] **Step 1: Write failing store test** — multi-path recorded hydrate + Phase 1 migration:

```rust
#[test]
fn hydrate_only_recorded_rel_paths_and_migrates_phase1() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    fs::create_dir_all(main.join("node_modules")).unwrap();
    fs::create_dir_all(main.join("packages/foo/node_modules")).unwrap();
    fs::create_dir_all(&wt).unwrap();
    fs::create_dir_all(wt.join("packages/foo")).unwrap();
    crate::dep_link::link_node_modules_at(&wt, &main, "", &main, &[wt.clone()], false).unwrap();
    crate::dep_link::link_node_modules_at(
        &wt,
        &main,
        "packages/foo",
        &main,
        &[wt.clone()],
        false,
    )
    .unwrap();

    // Phase 1 shaped metadata (empty links) — migrate to root only; ignore disk package link
    let mut store = Store {
        projects: vec![],
        worktrees: vec![Worktree {
            id: "wt1".into(),
            project_id: "proj".into(),
            display_name: "wt1".into(),
            branch_name: "feat".into(),
            start_from: None,
            path: wt.to_string_lossy().into_owned(),
            origin: WorktreeOrigin::App,
            status: WorktreeStatus::Ready,
            error_message: None,
            based_on_path: None,
            dep_link: Some(DepLink {
                kind: "node_modules".into(),
                status: DepLinkStatus::Linked,
                linked_from: Some(main.to_string_lossy().into_owned()),
                linked_at: None,
                links: vec![],
            }),
        }],
    };
    store.hydrate_dep_links();
    let dep = store.worktrees[0].dep_link.as_ref().unwrap();
    assert_eq!(dep.links.len(), 1);
    assert_eq!(dep.links[0].rel_path, "");
    assert_eq!(dep.links[0].status, DepLinkStatus::Linked);
    assert_eq!(dep.status, DepLinkStatus::Linked);
}

#[test]
fn hydrate_updates_all_recorded_rel_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join("main");
    let wt = tmp.path().join("wt");
    fs::create_dir_all(main.join("node_modules")).unwrap();
    fs::create_dir_all(main.join("packages/foo/node_modules")).unwrap();
    fs::create_dir_all(&wt).unwrap();
    fs::create_dir_all(wt.join("packages/foo")).unwrap();
    crate::dep_link::link_node_modules_at(&wt, &main, "", &main, &[wt.clone()], false).unwrap();
    crate::dep_link::link_node_modules_at(
        &wt,
        &main,
        "packages/foo",
        &main,
        &[wt.clone()],
        false,
    )
    .unwrap();

    let from = main.to_string_lossy().into_owned();
    let mut store = Store {
        projects: vec![],
        worktrees: vec![Worktree {
            id: "wt1".into(),
            project_id: "proj".into(),
            display_name: "wt1".into(),
            branch_name: "feat".into(),
            start_from: None,
            path: wt.to_string_lossy().into_owned(),
            origin: WorktreeOrigin::App,
            status: WorktreeStatus::Ready,
            error_message: None,
            based_on_path: None,
            dep_link: Some(DepLink {
                kind: "node_modules".into(),
                status: DepLinkStatus::Linked,
                linked_from: Some(from.clone()),
                linked_at: None,
                links: vec![
                    DepLinkEntry {
                        rel_path: "".into(),
                        status: DepLinkStatus::Linked,
                        linked_from: Some(from.clone()),
                    },
                    DepLinkEntry {
                        rel_path: "packages/foo".into(),
                        status: DepLinkStatus::Linked,
                        linked_from: Some(from),
                    },
                ],
            }),
        }],
    };
    store.hydrate_dep_links();
    let dep = store.worktrees[0].dep_link.as_ref().unwrap();
    assert_eq!(dep.links.len(), 2);
    assert!(dep.links.iter().all(|l| l.status == DepLinkStatus::Linked));
    assert_eq!(dep.status, DepLinkStatus::Linked);
}
```

Update existing `sample_worktree` helper in `store.rs` tests to include `links: vec![]` (or a root entry) so Phase 1 hydrate tests still compile after Task 2.

- [ ] **Step 2: Run — expect FAIL (old hydrate clears multi-path / ignores links).**

```bash
cd src-tauri && cargo test hydrate_only_recorded -- --nocapture
```

- [ ] **Step 3: Rewrite `hydrate_dep_links` as specified; fix existing hydrate tests** (they assume Phase 1 root-only — update to either empty links migrated or explicit `links: [{ rel_path: "", ...}]`).

- [ ] **Step 4: Confirm Sidebar icons still bind `worktree.depLink?.status` only (no code change if already correct).**

- [ ] **Step 5: `cargo test && bunx tsc --noEmit`**

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/store.rs src/components/Sidebar.tsx
git commit -m "feat(dep-link): hydrate recorded relPaths only with migration"
```

---

### Task 8: Manual acceptance checklist (spec Acceptance 1–10)

- [ ] **Step 1: Run app**

```bash
bun run tauri:dev
```

- [ ] **Step 2: Checklist**

1. Monorepo 源根与 `packages/*` 等处有多份 `node_modules` → 扫描列出对应 `relPath`；默认全选；创建勾选后目标各路径均为指向源的**绝对路径**软链。
2. 用户取消部分 package 后再链 → 仅选中路径有软链；未选中的目标路径不创建。
3. 创建后侧栏可选另一同源项目源并多选补链 / 换源；relink 默认偏好先前 recorded 且仍可用的路径。
4. 冲突：一次确认文案含 **N**，确认后全部冲突路径被 force 覆盖链接。
5. Unlink：只去掉本功能软链；真目录保留并有 notice；默认清掉该 worktree 全部 recorded 软链。
6. 嵌套：`packages/foo/node_modules/bar/...` 不会被当成独立候选；扫描不进入任何 `node_modules`。
7. 深度 > 6 或候选 > 50 → 受上限约束；超 50 有截断提示。
8. 旧 Phase 1 单路径元数据打开后行为等价于 `links: [{ relPath: "" }]`，根链接仍可用。
9. 刷新列表时 hydrate 只校正 recorded 路径；不以全树 scan 为每次刷新前提（可用日志/断点确认 `scan_*` 未在 refresh 路径调用）。
10. 项目外路径或含 `..` 的 `relPath` → 后端拒绝（可用命令/`cargo test` 已覆盖 InvalidRelPath / OutsideProject）。

- [ ] **Step 3: Fix bugs found; commit if needed**

```bash
git commit -m "fix(dep-link): <short bug description>"
```

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| Scan depth 6, never enter nm, skip .git, cap 50 + truncated | Task 1 |
| No workspace config parse | Global + Task 1 |
| `DepLink.links[]` per relPath + aggregate status | Task 2 + Task 7 |
| Phase 1 migration `links: [{ relPath: "" }]` | Task 2 + Task 7 |
| Batch link absolute symlink; no mkdir parents | Task 3 |
| NeedsConfirm with conflict count N; one confirm force all | Task 3 + Task 4 + Task 6 |
| Unlink recorded only; real dir notice; default all recorded | Task 3 + Task 4 + Task 6 |
| Commands scan + batch link/unlink; Phase 1 thin wrappers | Task 4 |
| Create master + expandable multi-select; default all; post-create batch | Task 5 |
| Sidebar source → multi-select; first all / relink recorded∩available | Task 5 helpers + Task 6 |
| Hydrate recorded-only; no full-tree scan on refresh | Task 7 |
| Row icons aggregate | Task 7 (existing Sidebar) |
| Acceptance 1–10 | Task 8 |
| Out of scope (venv/install/workspace parse/partial unlink UI/Windows) | — not planned |

## Placeholder scan

No TBD / “similar to Task N” left unresolved. Locked: depth=6, cap=50, relPath `""` for root, absolute symlinks, no package-parent mkdir, batch NeedsConfirmBatch count, hydrate recorded-only, Phase 1 cmds remain, merge upsert on batch link, unlink default all recorded.

## Ambiguities resolved

1. **Scan module file** → keep in `dep_link.rs` (not a separate file) to match Phase 1 locality; split only if file becomes unwieldy later.
2. **Phase 1 command retention** → keep symbols; implement via `*_at("", …)` / batch `[""]`; persist `links` root entry.
3. **Batch link merge** → upsert selected rels; do not delete other recorded links not in the batch (supports partial add from sidebar).
4. **Hydrate None entries** → drop from `links`; empty → `dep_link = None`.
5. **list sources `source_ok`** → true iff scan returns ≥1 path (not root-only).
6. **Overwrite copy** → always show N; optional directory/symlink distinction not required when N>1.
7. **`linked_at`** → remains always `None` (no chrono).

