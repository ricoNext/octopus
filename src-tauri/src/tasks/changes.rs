use super::{storage, Task};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::File, io::Read, path::Path};

const MAX_TEXT: u64 = 1024 * 1024;
const MAX_TOTAL_TEXT: usize = 32 * 1024 * 1024;
const MAX_FILES: usize = 30_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    hash: String,
    text: Option<String>,
    note: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    files: BTreeMap<String, Entry>,
    notices: Vec<String>,
}

fn snapshot(directories: &[String]) -> Result<Snapshot, String> {
    let mut files = BTreeMap::new();
    let mut notices = vec!["差异相对首次运行前的文件内容；忽略 Git 忽略项及 .git、node_modules、target 等生成目录。并行任务或外部编辑产生的修改也可能显示在这里。".into()];
    let mut total_text = 0;
    for root in directories {
        if !Path::new(root).is_dir() {
            return Err(format!("关联目录已丢失：{root}"));
        }
        let walker = ignore::WalkBuilder::new(root)
            .hidden(false)
            .require_git(false)
            .follow_links(false)
            .filter_entry(|entry| {
                entry.depth() == 0
                    || !matches!(
                        entry.file_name().to_str(),
                        Some(".git" | "node_modules" | "target" | ".next" | "dist")
                    )
            })
            .build();
        for result in walker {
            let entry = match result {
                Ok(e) => e,
                Err(e) => {
                    notices.push(format!("未能读取：{e}"));
                    continue;
                }
            };
            let Some(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                continue;
            }
            let path = entry.path().to_string_lossy().to_string();
            if files.contains_key(&path) {
                continue;
            }
            if files.len() >= MAX_FILES {
                return Err(
                    "关联目录中待检查文件超过 30000 个，请缩小目录范围或设置忽略规则".into(),
                );
            }
            if kind.is_symlink() {
                let target = std::fs::read_link(entry.path())
                    .map_err(|e| format!("无法读取链接 {path}：{e}"))?;
                let text = target.to_string_lossy().to_string();
                files.insert(
                    path,
                    Entry {
                        hash: format!("link:{text}"),
                        text: Some(text),
                        note: Some("符号链接，仅比较链接目标，不跟随读取".into()),
                    },
                );
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let read = (|| -> Result<Entry, String> {
                let mut file = File::open(entry.path()).map_err(|e| e.to_string())?;
                let size = file.metadata().map_err(|e| e.to_string())?.len();
                let capture = size <= MAX_TEXT && total_text + size as usize <= MAX_TOTAL_TEXT;
                let mut hasher = Sha256::new();
                let mut text_bytes = Vec::new();
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buf[..n]);
                    if capture && text_bytes.len() + n <= MAX_TEXT as usize {
                        text_bytes.extend_from_slice(&buf[..n]);
                    }
                }
                let text = if capture && !text_bytes.contains(&0) {
                    String::from_utf8(text_bytes).ok()
                } else {
                    None
                };
                if let Some(text) = &text {
                    total_text += text.len();
                }
                let note = text.is_none().then(|| {
                    "二进制、大文件或预览容量限制：仅记录内容指纹，无法显示文本差异".into()
                });
                Ok(Entry {
                    hash: format!("{:x}", hasher.finalize()),
                    text,
                    note,
                })
            })();
            match read {
                Ok(value) => {
                    files.insert(path, value);
                }
                Err(e) => {
                    return Err(format!("无法建立文件差异基线 {path}：{e}"));
                }
            }
        }
    }
    Ok(Snapshot { files, notices })
}

pub fn ensure_baseline(dir: &Path, task: &Task) -> Result<(), String> {
    if !dir.join("baseline.json").exists() {
        storage::write_json(
            &dir.join("baseline.json"),
            &snapshot(&task.input.directories)?,
        )?;
    }
    Ok(())
}

pub fn collect(dir: &Path, task: &Task) -> Result<(Vec<FileChange>, Vec<String>), String> {
    let before: Snapshot = storage::read_json(&dir.join("baseline.json"))?;
    let after = snapshot(&task.input.directories)?;
    let paths: std::collections::BTreeSet<_> =
        before.files.keys().chain(after.files.keys()).collect();
    let mut changes = vec![];
    for path in paths {
        let a = before.files.get(path);
        let b = after.files.get(path);
        if a.map(|e| &e.hash) == b.map(|e| &e.hash) {
            continue;
        }
        changes.push(FileChange {
            path: path.clone(),
            kind: if a.is_none() {
                "added"
            } else if b.is_none() {
                "deleted"
            } else {
                "modified"
            }
            .into(),
            before: a.and_then(|e| e.text.clone()),
            after: b.and_then(|e| e.text.clone()),
            note: a
                .and_then(|e| e.note.clone())
                .or_else(|| b.and_then(|e| e.note.clone())),
        });
    }
    let mut notices = before.notices;
    notices.extend(after.notices);
    notices.sort();
    notices.dedup();
    Ok((changes, notices))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn baseline_preserves_existing_edits_and_detects_new_deleted_binary() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("work");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("existing.txt"), "原先的修改").unwrap();
        std::fs::write(root.join("deleted.txt"), "删除前").unwrap();
        let before = snapshot(&[root.to_string_lossy().into()]).unwrap();
        assert_eq!(
            before.files[&root.join("existing.txt").to_string_lossy().to_string()]
                .text
                .as_deref(),
            Some("原先的修改")
        );
        storage::write_json(&temp.path().join("baseline.json"), &before).unwrap();
        std::fs::write(root.join("existing.txt"), "任务修改").unwrap();
        std::fs::write(root.join("new.txt"), "新文件").unwrap();
        std::fs::write(root.join("binary"), [0, 255]).unwrap();
        std::fs::remove_file(root.join("deleted.txt")).unwrap();
        let task = super::super::tests::sample_task(root.to_str().unwrap());
        let (changes, _) = collect(temp.path(), &task).unwrap();
        assert_eq!(changes.len(), 4);
        let modified = changes.iter().find(|c| c.kind == "modified").unwrap();
        assert_eq!(modified.before.as_deref(), Some("原先的修改"));
        assert!(changes.iter().any(|c| c.kind == "deleted"));
        assert!(changes
            .iter()
            .find(|c| c.path.ends_with("binary"))
            .unwrap()
            .note
            .is_some());
    }
}
