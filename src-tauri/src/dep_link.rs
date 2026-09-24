use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use crate::git::{canonicalize_or, same_path};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepLinkKind {
    NodeModules,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeStatus {
    None,
    Linked,
    Broken,
}

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

pub fn project_roots<'a>(main_root: &'a Path, worktree_paths: &'a [PathBuf]) -> Vec<&'a Path> {
    let mut roots = vec![main_root];
    for worktree in worktree_paths {
        if !roots.iter().any(|root| same_path(root, worktree)) {
            roots.push(worktree);
        }
    }
    roots
}

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

/// BFS/DFS from `source_root`. Depth of `{root}/node_modules` = 1.
/// Never descends into a directory named `node_modules`.
/// Always skips directory entries named `.git`.
/// A hit is recorded only when `{source}/{rel}/node_modules` exists and
/// ultimately resolves as a directory (symlink-to-dir OK via `source_node_modules_ok_at` semantics).
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

pub fn probe_target(target_root: &Path) -> ProbeResult {
    let nm = target_root.join("node_modules");
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
        Ok(resolved) if resolved.is_dir() => {
            let linked_from = resolved.parent().map(|p| p.to_path_buf());
            ProbeResult {
                status: ProbeStatus::Linked,
                linked_from,
            }
        }
        _ => ProbeResult {
            status: ProbeStatus::Broken,
            linked_from: None,
        },
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


use crate::models::{DepLink, DepLinkEntry, DepLinkStatus};

/// any broken → Broken; else any linked → Linked; else None
pub fn aggregate_status(links: &[DepLinkEntry]) -> DepLinkStatus {
    if links.iter().any(|l| l.status == DepLinkStatus::Broken) {
        return DepLinkStatus::Broken;
    }
    if links.iter().any(|l| l.status == DepLinkStatus::Linked) {
        return DepLinkStatus::Linked;
    }
    DepLinkStatus::None
}

/// If `links` empty and top-level looks like Phase 1 (status Linked/Broken or linked_from set),
/// insert root entry from top-level fields. Always normalize `"."` → `""` on entries.
/// Returns true if mutation happened.
pub fn migrate_dep_link_links(dep: &mut DepLink) -> bool {
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

/// After per-path updates: set dep.status = aggregate; set dep.linked_from =
/// first linked entry's linked_from (or keep prior if all broken).
pub fn refresh_dep_link_aggregate(dep: &mut DepLink) {
    dep.status = aggregate_status(&dep.links);
    if let Some(from) = dep
        .links
        .iter()
        .find(|l| l.status == DepLinkStatus::Linked)
        .and_then(|l| l.linked_from.clone())
    {
        dep.linked_from = Some(from);
    } else if dep.status == DepLinkStatus::None {
        dep.linked_from = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::Path;

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
        assert_eq!(
            canonicalize_or(&points),
            canonicalize_or(&main.join("node_modules"))
        );
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
        assert!(wt
            .join("node_modules")
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
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
        let err =
            link_node_modules(&wt, &main, &main, &[wt.clone(), other.clone()], false).unwrap_err();
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
}
