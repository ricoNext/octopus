//! Path-jail filesystem browser helpers (Phase 1: read_dir).

use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsDirEntry {
    pub name: String,
    pub kind: String, // "dir" | "file" | "symlink"
}

/// Resolve `rel` under `root`, rejecting any path that escapes the canonical root.
///
/// - `""` / `"."` → the root itself
/// - Both root and (when it exists) the candidate are canonicalized so macOS
///   `/private` prefixes and symlink escapes are handled consistently
pub fn resolve_under_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("无法解析根路径: {e}"))?;

    let rel = rel.trim();
    if rel.is_empty() || rel == "." {
        return Ok(root);
    }

    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("路径越界".into());
    }

    // Lexical walk first: catch `..` escapes even when the target does not exist.
    let mut resolved = root.clone();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(c) => resolved.push(c),
            Component::CurDir => {}
            Component::ParentDir => {
                if !resolved.starts_with(&root) {
                    return Err("路径越界".into());
                }
                // Refuse to leave the root directory.
                if resolved == root {
                    return Err("路径越界".into());
                }
                if !resolved.pop() {
                    return Err("路径越界".into());
                }
                if !resolved.starts_with(&root) {
                    return Err("路径越界".into());
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("路径越界".into());
            }
        }
    }

    if !resolved.starts_with(&root) {
        return Err("路径越界".into());
    }

    // If the path exists, canonicalize to defeat symlink-based escapes.
    if resolved.exists() {
        let canon = fs::canonicalize(&resolved).map_err(|e| format!("无法解析路径: {e}"))?;
        if !canon.starts_with(&root) {
            return Err("路径越界".into());
        }
        return Ok(canon);
    }

    Ok(resolved)
}

/// List directory entries under `root`/`rel`, dirs-first then name-sorted.
/// Symlinks are reported as `kind: "symlink"` without following.
pub fn read_dir_entries(root: &Path, rel: &str) -> Result<Vec<FsDirEntry>, String> {
    let dir = resolve_under_root(root, rel)?;
    let rd = fs::read_dir(&dir).map_err(|e| format!("无法读取目录: {e}"))?;

    let mut entries = Vec::new();
    for ent in rd {
        let ent = ent.map_err(|e| format!("读取目录项失败: {e}"))?;
        let name = ent.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        // symlink_metadata: do not follow; symlink-to-dir stays "symlink".
        let meta = fs::symlink_metadata(ent.path())
            .map_err(|e| format!("读取元数据失败: {e}"))?;
        let ft = meta.file_type();
        let kind = if ft.is_symlink() {
            "symlink"
        } else if ft.is_dir() {
            "dir"
        } else {
            "file"
        }
        .to_string();
        entries.push(FsDirEntry { name, kind });
    }

    entries.sort_by(|a, b| {
        let a_dir = a.kind == "dir";
        let b_dir = b.kind == "dir";
        match (a_dir, b_dir) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => a
                .name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase()),
        }
    });

    Ok(entries)
}

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
