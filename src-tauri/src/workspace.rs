use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::git::{
    canonicalize_or, command_v, default_branch, existing_linked_worktrees, git, git_ok,
    local_branches, prefer_stderr, same_path, show_toplevel, worktree_list,
};
use crate::models::{
    DeleteResult, DiffResult, InspectResult, Project, RemoveProjectResult, Store, Worktree,
    WorktreeOrigin, WorktreeStatus,
};
use crate::paths::{slugify, worktree_dest};

pub fn inspect_repo(store: &Store, raw_path: &str) -> Result<InspectResult, String> {
    git_ok(None, &["--version"]).map_err(|_| "未找到 git，请确认已安装并在 PATH 中。".to_string())?;

    let selected = PathBuf::from(raw_path);
    let selected_canon = selected
        .canonicalize()
        .map_err(|_| "无法读取该目录".to_string())?;
    if !selected_canon.is_dir() {
        return Err("无法读取该目录".into());
    }

    let toplevel = show_toplevel(&selected_canon)?;
    let toplevel_canon = canonicalize_or(&toplevel);
    if toplevel_canon != selected_canon {
        return Err("这不是 git 仓库".into());
    }
    if store.has_root(&toplevel_canon) {
        return Err("该仓库已添加".into());
    }

    let name = toplevel_canon
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "project".into());
    let (default_branch, used_fallback_default_branch) = default_branch(&toplevel_canon);
    let existing_worktrees = existing_linked_worktrees(&toplevel_canon, &toplevel_canon)?;

    Ok(InspectResult {
        root_path: toplevel_canon.to_string_lossy().to_string(),
        name,
        default_branch,
        used_fallback_default_branch,
        existing_worktrees,
    })
}

pub fn add_project(
    store: &mut Store,
    raw_path: &str,
    import_paths: Vec<String>,
) -> Result<String, String> {
    let inspect = inspect_repo(store, raw_path)?;
    let project_id = Uuid::new_v4().to_string();
    let wanted: HashSet<String> = import_paths
        .into_iter()
        .map(|path| canonicalize_or(Path::new(&path)).to_string_lossy().to_string())
        .collect();

    for item in inspect.existing_worktrees {
        let canon = canonicalize_or(Path::new(&item.path));
        if !wanted.contains(&canon.to_string_lossy().to_string()) {
            continue;
        }
        let branch_name = item
            .branch_name
            .clone()
            .unwrap_or_else(|| item.head.chars().take(8).collect());
        store.worktrees.push(Worktree {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.clone(),
            display_name: crate::git::display_name_from_path(&canon),
            branch_name,
            start_from: inspect.default_branch.clone(),
            path: canon.to_string_lossy().to_string(),
            origin: WorktreeOrigin::Imported,
            status: WorktreeStatus::Ready,
            error_message: None,
        });
    }

    store.projects.push(Project {
        id: project_id.clone(),
        name: inspect.name,
        root_path: inspect.root_path,
        default_branch: inspect.default_branch,
    });
    Ok(project_id)
}

pub enum CreateOutcome {
    Ready(String),
    Failed { id: String, stderr: String },
}

pub fn create_worktree(
    store: &mut Store,
    project_id: &str,
    display_name: String,
    branch_name: Option<String>,
    start_from: Option<String>,
) -> Result<CreateOutcome, String> {
    let display_name = display_name.trim().to_string();
    if display_name.is_empty() {
        return Err("显示名不能为空".into());
    }
    let project = store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .cloned()
        .ok_or_else(|| "找不到该项目".to_string())?;
    let root = PathBuf::from(&project.root_path);
    if !root.exists() {
        return Err("路径丢失".into());
    }

    let slug = slugify(&display_name);
    let dest = worktree_dest(&root, &slug);
    if dest.exists() {
        return Err(format!(
            "目标路径已存在，创建失败：{}",
            dest.to_string_lossy()
        ));
    }
    let branch = branch_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| slug.clone());
    let start = start_from
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| project.default_branch.clone());

    let branches = local_branches(&root)?;
    if !branches.iter().any(|item| item == &start) {
        return Err(format!("起始分支不在本地分支中：{start}"));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建工作树目录：{err}"))?;
    }

    let worktree_id = Uuid::new_v4().to_string();
    store.worktrees.push(Worktree {
        id: worktree_id.clone(),
        project_id: project.id.clone(),
        display_name,
        branch_name: branch.clone(),
        start_from: start.clone(),
        path: dest.to_string_lossy().to_string(),
        origin: WorktreeOrigin::App,
        status: WorktreeStatus::Creating,
        error_message: None,
    });

    let dest_str = dest.to_string_lossy().to_string();
    let out = git(
        Some(&root),
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            &dest_str,
            &start,
        ],
    )?;

    let Some(worktree) = store
        .worktrees
        .iter_mut()
        .find(|item| item.id == worktree_id)
    else {
        return Err("创建后找不到工作树记录".into());
    };

    if out.success {
        worktree.status = WorktreeStatus::Ready;
        worktree.error_message = None;
        Ok(CreateOutcome::Ready(worktree_id))
    } else {
        let stderr = prefer_stderr(&out);
        if dest.exists() {
            let listed = worktree_list(&root).unwrap_or_default();
            let registered = listed.iter().any(|item| same_path(&item.path, &dest));
            if !registered {
                let _ = fs::remove_dir_all(&dest);
            }
        }
        worktree.status = WorktreeStatus::Error;
        worktree.error_message = Some(stderr.clone());
        Ok(CreateOutcome::Failed {
            id: worktree_id,
            stderr,
        })
    }
}

pub fn retry_worktree(store: &mut Store, worktree_id: &str) -> Result<CreateOutcome, String> {
    let current = store
        .worktrees
        .iter()
        .find(|item| item.id == worktree_id)
        .cloned()
        .ok_or_else(|| "找不到该工作树".to_string())?;
    cleanup_worktree_dir(store, &current);
    store.worktrees.retain(|item| item.id != worktree_id);
    create_worktree(
        store,
        &current.project_id,
        current.display_name,
        Some(current.branch_name),
        Some(current.start_from),
    )
}

fn cleanup_worktree_dir(store: &Store, current: &Worktree) {
    if let Some(project) = store
        .projects
        .iter()
        .find(|item| item.id == current.project_id)
    {
        let root = Path::new(&project.root_path);
        let path = Path::new(&current.path);
        if root.exists() && path.exists() {
            let _ = git(Some(root), &["worktree", "remove", "--force", &current.path]);
            if path.exists() {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
}

pub fn abandon_worktree(store: &mut Store, worktree_id: &str) -> Result<(), String> {
    let current = store
        .worktrees
        .iter()
        .find(|item| item.id == worktree_id)
        .cloned()
        .ok_or_else(|| "找不到该工作树".to_string())?;
    cleanup_worktree_dir(store, &current);
    store.worktrees.retain(|item| item.id != worktree_id);
    Ok(())
}

pub fn delete_worktree(
    store: &mut Store,
    worktree_id: &str,
    delete_branch: bool,
    force: bool,
) -> Result<DeleteResult, String> {
    let current = store
        .worktrees
        .iter()
        .find(|item| item.id == worktree_id)
        .cloned()
        .ok_or_else(|| "找不到该工作树".to_string())?;
    let project = store
        .projects
        .iter()
        .find(|item| item.id == current.project_id)
        .cloned()
        .ok_or_else(|| "找不到该项目".to_string())?;
    if same_path(Path::new(&project.root_path), Path::new(&current.path)) {
        return Err("不能删除主工作区".into());
    }
    let root = Path::new(&project.root_path);
    if !root.exists() {
        return Err("路径丢失".into());
    }

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(current.path.as_str());
    let out = git(Some(root), &args)?;
    if !out.success {
        if !force {
            return Ok(DeleteResult::NeedsForce {
                stderr: prefer_stderr(&out),
            });
        }
        return Err(prefer_stderr(&out));
    }

    let mut branch_error: Option<String> = None;
    if delete_branch {
        let branch_out = git(Some(root), &["branch", "-D", &current.branch_name])?;
        if !branch_out.success {
            branch_error = Some(prefer_stderr(&branch_out));
        }
    }

    store.worktrees.retain(|item| item.id != worktree_id);
    if let Some(stderr) = branch_error {
        return Err(format!(
            "工作树已删除，但删除本地分支失败：\n{stderr}"
        ));
    }
    Ok(DeleteResult::Ok {
        snapshot: store.snapshot(),
    })
}

pub fn remove_missing_worktree(store: &mut Store, worktree_id: &str) -> Result<(), String> {
    store.worktrees.retain(|item| item.id != worktree_id);
    Ok(())
}

pub fn remove_project(
    store: &mut Store,
    project_id: &str,
    forget: bool,
) -> Result<RemoveProjectResult, String> {
    if store.projects.iter().all(|item| item.id != project_id) {
        return Err("找不到该项目".into());
    }
    let app_count = store
        .worktrees
        .iter()
        .filter(|item| item.project_id == project_id && item.origin == WorktreeOrigin::App)
        .count();
    if app_count > 0 && !forget {
        return Ok(RemoveProjectResult::HasAppWorktrees { count: app_count });
    }
    store.worktrees.retain(|item| item.project_id != project_id);
    store.projects.retain(|item| item.id != project_id);
    Ok(RemoveProjectResult::Ok {
        snapshot: store.snapshot(),
    })
}

pub fn get_diff(store: &Store, worktree_id: &str) -> Result<DiffResult, String> {
    let worktree = store
        .worktrees
        .iter()
        .find(|item| item.id == worktree_id)
        .ok_or_else(|| "找不到该工作树".to_string())?;
    let path = Path::new(&worktree.path);
    if !path.exists() {
        return Err("工作树目录不存在".into());
    }
    let out = git(Some(path), &["diff", &worktree.start_from])?;
    if !out.success {
        return Err(prefer_stderr(&out));
    }
    Ok(DiffResult {
        empty: out.stdout.is_empty(),
        text: out.stdout,
    })
}

pub fn list_branches(store: &Store, project_id: &str) -> Result<Vec<String>, String> {
    let project = store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "找不到该项目".to_string())?;
    let root = Path::new(&project.root_path);
    if !root.exists() {
        return Err("路径丢失".into());
    }
    local_branches(root)
}

pub fn open_in_cursor(path: &str) -> Result<(), String> {
    if let Some(cursor) = command_v("cursor") {
        let status = Command::new(cursor)
            .arg(path)
            .status()
            .map_err(|err| format!("{err}"))?;
        if status.success() {
            return Ok(());
        }
    }
    let status = Command::new("open")
        .args(["-a", "Cursor", path])
        .status()
        .map_err(|err| format!("{err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("打不开 Cursor，请确认已安装".into())
    }
}

pub fn reveal_in_finder(path: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(path)
        .status()
        .map_err(|err| format!("{err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("无法在访达中显示：{path}"))
    }
}

pub fn worktree_cwd<'a>(store: &'a Store, worktree_id: &str) -> Result<&'a str, String> {
    let worktree = store
        .worktrees
        .iter()
        .find(|item| item.id == worktree_id)
        .ok_or_else(|| "找不到该工作树".to_string())?;
    if worktree.status != WorktreeStatus::Ready {
        return Err("工作树尚未就绪".into());
    }
    Ok(worktree.path.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git_user(repo: &Path) {
        let _ = Command::new("git")
            .args(["config", "user.email", "t@t.t"])
            .current_dir(repo)
            .status();
        let _ = Command::new("git")
            .args(["config", "user.name", "t"])
            .current_dir(repo)
            .status();
    }

    fn init_repo(repo: &Path) {
        fs::create_dir_all(repo).unwrap();
        assert!(
            Command::new("git")
                .args(["init", "-b", "main"])
                .current_dir(repo)
                .status()
                .unwrap()
                .success()
        );
        git_user(repo);
        fs::write(repo.join("README"), "hi\n").unwrap();
        assert!(
            Command::new("git")
                .args(["add", "."])
                .current_dir(repo)
                .status()
                .unwrap()
                .success()
        );
        assert!(
            Command::new("git")
                .args(["commit", "-m", "init"])
                .current_dir(repo)
                .status()
                .unwrap()
                .success()
        );
    }

    #[test]
    fn inspect_and_create_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("acme");
        init_repo(&repo);
        let mut store = Store::default();
        let inspect = inspect_repo(&store, repo.to_str().unwrap()).unwrap();
        assert_eq!(inspect.default_branch, "main");
        assert!(inspect.existing_worktrees.is_empty());
        add_project(&mut store, repo.to_str().unwrap(), Vec::new()).unwrap();
        let project_id = store.projects[0].id.clone();
        let CreateOutcome::Ready(wt_id) = create_worktree(
            &mut store,
            &project_id,
            "修登录".into(),
            None,
            None,
        )
        .unwrap() else {
            panic!("expected ready worktree");
        };
        let dest = worktree_dest(&repo, "修登录");
        assert!(dest.is_dir());
        assert_eq!(store.worktrees[0].id, wt_id);
        assert_eq!(store.worktrees[0].status, WorktreeStatus::Ready);

        fs::write(dest.join("README"), "changed\n").unwrap();
        let diff = get_diff(&store, &wt_id).unwrap();
        assert!(!diff.empty);
        assert!(diff.text.contains("changed"));

        match delete_worktree(&mut store, &wt_id, false, false).unwrap() {
            DeleteResult::NeedsForce { stderr } => {
                assert!(stderr.contains("--force") || stderr.contains("modified"));
            }
            DeleteResult::Ok { .. } => panic!("脏工作树应要求强制删除"),
        }
        match delete_worktree(&mut store, &wt_id, true, true).unwrap() {
            DeleteResult::Ok { .. } => {}
            DeleteResult::NeedsForce { stderr } => panic!("force failed: {stderr}"),
        }
        assert!(!dest.exists());
        let branches = local_branches(&repo).unwrap();
        assert!(!branches.iter().any(|item| item == "修登录"));

        let CreateOutcome::Ready(keep_id) = create_worktree(
            &mut store,
            &project_id,
            "keep-branch".into(),
            None,
            None,
        )
        .unwrap() else {
            panic!("expected ready worktree");
        };
        let keep_dest = worktree_dest(&repo, "keep-branch");
        match delete_worktree(&mut store, &keep_id, false, false).unwrap() {
            DeleteResult::Ok { .. } => {}
            DeleteResult::NeedsForce { stderr } => panic!("{stderr}"),
        }
        assert!(!keep_dest.exists());
        let branches = local_branches(&repo).unwrap();
        assert!(branches.iter().any(|item| item == "keep-branch"));

        let extra = tmp.path().join("acme-worktrees").join("manual");
        assert!(
            Command::new("git")
                .args([
                    "-C",
                    repo.to_str().unwrap(),
                    "worktree",
                    "add",
                    "-b",
                    "manual",
                    extra.to_str().unwrap(),
                    "main",
                ])
                .status()
                .unwrap()
                .success()
        );
        let mut store2 = Store::default();
        let inspect2 = inspect_repo(&store2, repo.to_str().unwrap()).unwrap();
        assert_eq!(inspect2.existing_worktrees.len(), 1);
        assert!(
            inspect2
                .existing_worktrees
                .iter()
                .any(|item| item.path.contains("manual"))
        );
        add_project(
            &mut store2,
            repo.to_str().unwrap(),
            inspect2
                .existing_worktrees
                .iter()
                .map(|item| item.path.clone())
                .collect(),
        )
        .unwrap();
        assert_eq!(store2.worktrees.len(), 1);
        assert_eq!(store2.worktrees[0].origin, WorktreeOrigin::Imported);
        assert!(!local_branches(&repo).unwrap().is_empty());
        let fetch_log = Command::new("git")
            .args(["-C", repo.to_str().unwrap(), "reflog", "show"])
            .output()
            .unwrap();
        let log_text = String::from_utf8_lossy(&fetch_log.stdout);
        assert!(!log_text.contains("fetch"));
    }
}
