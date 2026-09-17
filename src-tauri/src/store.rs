use std::fs;
use std::path::{Path, PathBuf};

use crate::git::{canonicalize_or, same_path, worktree_list};
use crate::models::{
    AppSnapshot, ProjectView, Store, WorktreeStatus, WorktreeView,
};

impl Store {
    pub fn load(path: &Path) -> Self {
        let Ok(text) = fs::read_to_string(path) else {
            return Self::default();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("无法写入本地数据：{err}"))?;
        }
        let text = serde_json::to_string_pretty(self)
            .map_err(|err| format!("无法序列化本地数据：{err}"))?;
        fs::write(path, text).map_err(|err| format!("无法写入本地数据：{err}"))
    }

    pub fn reconcile(&mut self) {
        let projects: Vec<(String, PathBuf)> = self
            .projects
            .iter()
            .map(|project| (project.id.clone(), PathBuf::from(&project.root_path)))
            .collect();
        for (project_id, root) in projects {
            if !root.exists() {
                continue;
            }
            let Ok(listed) = worktree_list(&root) else {
                continue;
            };
            for worktree in self
                .worktrees
                .iter_mut()
                .filter(|item| item.project_id == project_id)
            {
                let on_disk = listed
                    .iter()
                    .any(|item| same_path(&item.path, Path::new(&worktree.path)));
                if on_disk && worktree.status == WorktreeStatus::Creating {
                    worktree.status = WorktreeStatus::Ready;
                    worktree.error_message = None;
                }
                if !on_disk && worktree.status == WorktreeStatus::Creating {
                    worktree.status = WorktreeStatus::Error;
                    worktree.error_message =
                        Some("创建中断，工作树未出现在 git worktree 列表中。".into());
                }
            }
        }
    }

    pub fn snapshot(&self) -> AppSnapshot {
        let projects = self
            .projects
            .iter()
            .map(|project| {
                let root = PathBuf::from(&project.root_path);
                ProjectView {
                    project: project.clone(),
                    path_missing: !root.exists(),
                }
            })
            .collect();

        let worktrees = self
            .worktrees
            .iter()
            .map(|worktree| {
                let project = self
                    .projects
                    .iter()
                    .find(|item| item.id == worktree.project_id);
                let missing = match project {
                    Some(project) if PathBuf::from(&project.root_path).exists() => {
                        match worktree_list(Path::new(&project.root_path)) {
                            Ok(listed) => !listed
                                .iter()
                                .any(|item| same_path(&item.path, Path::new(&worktree.path))),
                            Err(_) => !PathBuf::from(&worktree.path).exists(),
                        }
                    }
                    _ => !PathBuf::from(&worktree.path).exists(),
                };
                WorktreeView {
                    worktree: worktree.clone(),
                    missing,
                }
            })
            .collect();

        AppSnapshot {
            projects,
            worktrees,
        }
    }

    pub fn has_root(&self, root: &Path) -> bool {
        let canon = canonicalize_or(root);
        self.projects
            .iter()
            .any(|project| canonicalize_or(Path::new(&project.root_path)) == canon)
    }
}
