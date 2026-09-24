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
}
