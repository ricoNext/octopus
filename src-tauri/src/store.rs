use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::git::{canonicalize_or, same_path, worktree_list};
use crate::models::{
    AppSnapshot, DepLink, DepLinkStatus, ProjectView, Store, WorktreeStatus, WorktreeView,
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
                        // clear per-path linked_from on None
                        entry.linked_from = None;
                    }
                    crate::dep_link::ProbeStatus::Linked => {
                        entry.status = DepLinkStatus::Linked;
                        // prefer existing entry.linked_from / dep.linked_from over probe parent
                        if entry.linked_from.is_none() {
                            entry.linked_from = dep.linked_from.clone().or_else(|| {
                                probe
                                    .linked_from
                                    .map(|p| p.to_string_lossy().into_owned())
                            });
                        }
                    }
                    crate::dep_link::ProbeStatus::Broken => {
                        entry.status = DepLinkStatus::Broken;
                    }
                }
            }
            // Drop None entries so aggregate stays clean.
            dep.links.retain(|e| e.status != DepLinkStatus::None);
            if dep.links.is_empty() {
                wt.dep_link = None;
            } else {
                crate::dep_link::refresh_dep_link_aggregate(dep);
            }
        }
    }

    pub fn snapshot(&self) -> AppSnapshot {
        let listed_by_project: HashMap<String, Vec<_>> = self
            .projects
            .iter()
            .filter_map(|project| {
                let root = PathBuf::from(&project.root_path);
                root.exists()
                    .then(|| worktree_list(&root).ok())
                    .flatten()
                    .map(|listed| (project.id.clone(), listed))
            })
            .collect();

        let projects = self
            .projects
            .iter()
            .map(|project| {
                let root = PathBuf::from(&project.root_path);
                let main_branch = listed_by_project
                    .get(&project.id)
                    .map(|listed| {
                        listed
                            .iter()
                            .find(|item| same_path(&item.path, &root))
                            .and_then(|item| item.branch.clone())
                    })
                    .unwrap_or_else(|| Some(project.default_branch.clone()));
                ProjectView {
                    project: project.clone(),
                    path_missing: !root.exists(),
                    main_branch,
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
                        listed_by_project
                            .get(&project.id)
                            .map(|listed| {
                                !listed
                                    .iter()
                                    .any(|item| same_path(&item.path, Path::new(&worktree.path)))
                            })
                            .unwrap_or_else(|| !PathBuf::from(&worktree.path).exists())
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


#[cfg(test)]
mod tests {
    use super::*;
    use crate::dep_link::link_node_modules;
    use crate::git::canonicalize_or;
    use crate::models::{DepLink, DepLinkEntry, DepLinkStatus, Worktree, WorktreeOrigin, WorktreeStatus};
    use std::fs;
    use std::path::Path;

    fn touch_nm(root: &Path) {
        fs::create_dir_all(root.join("node_modules")).unwrap();
    }

    fn sample_worktree(id: &str, path: &Path, linked_from: Option<String>) -> Worktree {
        Worktree {
            id: id.into(),
            project_id: "proj".into(),
            display_name: id.into(),
            branch_name: format!("branch-{id}"),
            start_from: None,
            path: path.to_string_lossy().into_owned(),
            origin: WorktreeOrigin::App,
            status: WorktreeStatus::Ready,
            error_message: None,
            based_on_path: None,
            dep_link: Some(DepLink {
                kind: "node_modules".into(),
                status: DepLinkStatus::Linked,
                linked_from,
                linked_at: None,
                links: vec![],
            }),
        }
    }

    /// C → B → A chain: probe canonicalize walks to A, but hydrate must keep B
    /// when the store already recorded the user-selected source.
    #[test]
    fn hydrate_keeps_stored_linked_from_on_chain_link() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        let c = tmp.path().join("c");
        for p in [&a, &b, &c] {
            fs::create_dir_all(p).unwrap();
        }
        touch_nm(&a);
        let roots = [b.clone(), c.clone()];
        link_node_modules(&b, &a, &a, &roots, false).unwrap();
        link_node_modules(&c, &b, &a, &roots, false).unwrap();

        // Probe alone would report A's parent (canonicalize walks the chain).
        let probe = crate::dep_link::probe_target(&c);
        assert_eq!(probe.status, crate::dep_link::ProbeStatus::Linked);
        assert_eq!(
            canonicalize_or(probe.linked_from.as_ref().unwrap()),
            canonicalize_or(&a)
        );

        let mut store = Store {
            projects: vec![],
            worktrees: vec![sample_worktree(
                "c",
                &c,
                Some(b.to_string_lossy().into_owned()),
            )],
        };
        store.hydrate_dep_links();

        let link = store.worktrees[0].dep_link.as_ref().unwrap();
        assert_eq!(link.status, DepLinkStatus::Linked);
        assert_eq!(
            canonicalize_or(Path::new(link.linked_from.as_ref().unwrap())),
            canonicalize_or(&b),
            "hydrate must keep user-selected B, not canonicalize parent A"
        );
    }

    #[test]
    fn hydrate_falls_back_to_probe_when_linked_from_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let c = tmp.path().join("c");
        for p in [&a, &c] {
            fs::create_dir_all(p).unwrap();
        }
        touch_nm(&a);
        link_node_modules(&c, &a, &a, &[c.clone()], false).unwrap();

        let mut store = Store {
            projects: vec![],
            worktrees: vec![sample_worktree("c", &c, None)],
        };
        store.hydrate_dep_links();

        let link = store.worktrees[0].dep_link.as_ref().unwrap();
        assert_eq!(link.status, DepLinkStatus::Linked);
        assert_eq!(
            canonicalize_or(Path::new(link.linked_from.as_ref().unwrap())),
            canonicalize_or(&a)
        );
    }

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
}
