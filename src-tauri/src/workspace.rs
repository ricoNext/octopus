use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::git::{
    canonicalize_or, default_branch, existing_linked_worktrees, git, git_ok,
    local_branches, prefer_stderr, recent_branches, remote_branches, same_path, show_toplevel,
    worktree_list,
};
use crate::models::{
    DeleteResult, InspectResult, Project, RemoveProjectResult, Store, Worktree,
    WorktreeOrigin, WorktreeStatus,
};
use crate::paths::{default_worktree_parent, worktree_dest};

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
            start_from: None,
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

pub fn default_worktree_parent_for_project(store: &Store, project_id: &str) -> Result<String, String> {
    let project = store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "找不到该项目".to_string())?;
    Ok(default_worktree_parent(Path::new(&project.root_path))
        .to_string_lossy()
        .to_string())
}

pub enum CreateOutcome {
    Ready(String),
    Failed { id: String, stderr: String },
}

pub fn create_worktree(
    store: &mut Store,
    project_id: &str,
    display_name: String,
    start_from: Option<String>,
    parent_path: Option<String>,
) -> Result<CreateOutcome, String> {
    let display_name = display_name.trim().to_string();
    if display_name.is_empty() {
        return Err("显示名不能为空".into());
    }
    if !is_valid_branch_name(&display_name) {
        return Err("显示名只能包含英文字母、数字、/、-、_ 和 .，且不能包含非法路径片段".into());
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

    let parent = parent_path
        .map(PathBuf::from)
        .unwrap_or_else(|| default_worktree_parent(&root));
    if parent.as_os_str().is_empty() {
        return Err("工作树目录不能为空".into());
    }
    let branch = display_name.clone();
    let dest = worktree_dest(&parent, &display_name);
    if dest.exists() {
        return Err(format!(
            "目标路径已存在，创建失败：{}",
            dest.to_string_lossy()
        ));
    }
    let start = start_from
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| project.default_branch.clone());

    let local = local_branches(&root)?;
    let remote = remote_branches(&root)?;
    if !local.iter().any(|item| item == &start)
        && !remote.iter().any(|item| item == &start)
    {
        return Err(format!("起始分支不存在：{start}"));
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
        start_from: Some(start.clone()),
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
        current.start_from,
        Path::new(&current.path)
            .parent()
            .map(|path| path.to_string_lossy().to_string()),
    )
}

fn is_valid_branch_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/'))
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.contains("..")
        && !value.contains("//")
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


pub struct RefreshProjectWorktreesOutcome {
    pub removed: Vec<String>,
    pub imported: Vec<String>,
    pub removed_ids: Vec<String>,
}

pub fn refresh_project_worktrees(
    store: &mut Store,
    project_id: &str,
) -> Result<RefreshProjectWorktreesOutcome, String> {
    let project = store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "找不到该项目".to_string())?
        .clone();
    let root = PathBuf::from(&project.root_path);
    if !root.exists() {
        return Err("项目根目录不存在或已不可用".into());
    }
    // Ensure the root is a usable git repo by listing worktrees.
    let listed = worktree_list(&root).map_err(|err| {
        if err.is_empty() {
            "项目根目录不是可用的 git 仓库".to_string()
        } else {
            err
        }
    })?;

    let mut removed = Vec::new();
    let mut removed_ids = Vec::new();
    store.worktrees.retain(|worktree| {
        if worktree.project_id != project_id {
            return true;
        }
        let on_disk = listed
            .iter()
            .any(|item| same_path(&item.path, Path::new(&worktree.path)));
        if on_disk {
            true
        } else {
            removed.push(worktree.display_name.clone());
            removed_ids.push(worktree.id.clone());
            false
        }
    });

    let linked = existing_linked_worktrees(&root, &root)?;
    let mut imported = Vec::new();
    for item in linked {
        let canon = canonicalize_or(Path::new(&item.path));
        let already = store.worktrees.iter().any(|worktree| {
            worktree.project_id == project_id && same_path(Path::new(&worktree.path), &canon)
        });
        if already {
            continue;
        }
        let branch_name = item
            .branch_name
            .clone()
            .unwrap_or_else(|| item.head.chars().take(8).collect());
        let display_name = crate::git::display_name_from_path(&canon);
        imported.push(display_name.clone());
        store.worktrees.push(Worktree {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            display_name,
            branch_name,
            start_from: None,
            path: canon.to_string_lossy().to_string(),
            origin: WorktreeOrigin::Imported,
            status: WorktreeStatus::Ready,
            error_message: None,
        });
    }

    Ok(RefreshProjectWorktreesOutcome {
        removed,
        imported,
        removed_ids,
    })
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

pub fn list_branch_options(
    store: &Store,
    project_id: &str,
) -> Result<(Vec<String>, Vec<String>, Vec<String>), String> {
    let project = store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "找不到该项目".to_string())?;
    let root = Path::new(&project.root_path);
    if !root.exists() {
        return Err("路径丢失".into());
    }
    let local = local_branches(root)?;
    let recent = recent_branches(root, &local)?;
    let remote = remote_branches(root)?;
    Ok((recent, local, remote))
}

pub fn switch_main_branch(store: &Store, project_id: &str, branch: &str) -> Result<(), String> {
    let project = store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "找不到该项目".to_string())?;
    let root = Path::new(&project.root_path);
    if !root.exists() {
        return Err("路径丢失".into());
    }
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支不能为空".into());
    }

    let local = local_branches(root)?;
    let remote = remote_branches(root)?;
    let args: Vec<String>;
    let command_args: Vec<&str>;
    if local.iter().any(|item| item == branch) {
        args = vec!["switch".into(), branch.into()];
        command_args = args.iter().map(String::as_str).collect();
    } else if remote.iter().any(|item| item == branch) {
        let local_name = branch.split_once('/').map(|(_, name)| name).unwrap_or(branch);
        if local.iter().any(|item| item == local_name) {
            args = vec!["switch".into(), local_name.into()];
        } else {
            args = vec!["switch".into(), "--track".into(), branch.into()];
        }
        command_args = args.iter().map(String::as_str).collect();
    } else {
        return Err(format!("分支不存在：{branch}"));
    }

    let out = git(Some(root), &command_args)?;
    if out.success {
        Ok(())
    } else {
        Err(prefer_stderr(&out))
    }
}

pub fn open_in_editor(editor: &str, path: &str) -> Result<(), String> {
    let editor = editor.trim();
    if editor.is_empty() {
        return Err("请先到设置中配置默认编辑器".into());
    }

    let command_error = match Command::new(editor).arg(path).status() {
        Ok(status) if status.success() => return Ok(()),
        Ok(status) => format!("编辑器命令退出，状态码 {}", status.code().unwrap_or(-1)),
        Err(error) => error.to_string(),
    };

    // macOS 应用通常没有暴露 CLI 命令，允许用户直接填写应用名或 .app 路径。
    let open_status = Command::new("open")
        .args(["-a", editor, path])
        .status();
    match open_status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "无法打开编辑器“{editor}”（命令错误：{command_error}，open -a 状态码：{}）",
            status.code().unwrap_or(-1)
        )),
        Err(error) => Err(format!(
            "无法打开编辑器“{editor}”：{command_error}；{error}"
        )),
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

pub fn session_cwd<'a>(store: &'a Store, session_id: &str) -> Result<&'a str, String> {
    if let Some(worktree) = store.worktrees.iter().find(|item| item.id == session_id) {
        if worktree.status != WorktreeStatus::Ready {
            return Err("工作树尚未就绪".into());
        }
        return Ok(worktree.path.as_str());
    }
    if let Some(project) = store.projects.iter().find(|item| item.id == session_id) {
        if !Path::new(&project.root_path).exists() {
            return Err("路径丢失".into());
        }
        return Ok(project.root_path.as_str());
    }
    Err("找不到该工作树".into())
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
        let parent = tmp.path().join("worktrees");
        let CreateOutcome::Ready(wt_id) = create_worktree(
            &mut store,
            &project_id,
            "fix-login".into(),
            None,
            Some(parent.to_string_lossy().to_string()),
        )
        .unwrap() else {
            panic!("expected ready worktree");
        };
        let dest = worktree_dest(&parent, "fix-login");
        assert!(dest.is_dir());
        assert_eq!(store.worktrees[0].id, wt_id);
        assert_eq!(store.worktrees[0].status, WorktreeStatus::Ready);

        fs::write(dest.join("README"), "changed\n").unwrap();
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
        assert!(!branches.iter().any(|item| item == "fix-login"));

        let CreateOutcome::Ready(keep_id) = create_worktree(
            &mut store,
            &project_id,
            "keep-branch".into(),
            None,
            Some(parent.to_string_lossy().to_string()),
        )
        .unwrap() else {
            panic!("expected ready worktree");
        };
        let keep_dest = worktree_dest(&parent, "keep-branch");
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

    #[test]
    fn session_cwd_uses_project_root() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("acme");
        init_repo(&repo);
        let mut store = Store::default();
        add_project(&mut store, repo.to_str().unwrap(), Vec::new()).unwrap();
        let project_id = store.projects[0].id.clone();
        let cwd = session_cwd(&store, &project_id).unwrap();
        assert_eq!(Path::new(cwd), repo.canonicalize().unwrap());
        assert!(session_cwd(&store, "missing").is_err());
    }

    #[test]
    fn refresh_project_worktrees_removes_missing_and_imports_new() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("acme");
        init_repo(&repo);

        // Linked worktree that will be imported at add time, then later removed from git.
        let old_extra = tmp.path().join("acme-worktrees").join("old-one");
        assert!(
            Command::new("git")
                .args([
                    "-C",
                    repo.to_str().unwrap(),
                    "worktree",
                    "add",
                    "-b",
                    "old-one",
                    old_extra.to_str().unwrap(),
                    "main",
                ])
                .status()
                .unwrap()
                .success()
        );

        let mut store = Store::default();
        add_project(
            &mut store,
            repo.to_str().unwrap(),
            vec![old_extra.to_string_lossy().to_string()],
        )
        .unwrap();
        let project_id = store.projects[0].id.clone();
        assert_eq!(store.worktrees.len(), 1);
        assert_eq!(store.worktrees[0].display_name, "old-one");
        let old_id = store.worktrees[0].id.clone();

        // Simulate missing: remove from git worktree list and delete the directory.
        assert!(
            Command::new("git")
                .args([
                    "-C",
                    repo.to_str().unwrap(),
                    "worktree",
                    "remove",
                    "--force",
                    old_extra.to_str().unwrap(),
                ])
                .status()
                .unwrap()
                .success()
        );
        let _ = fs::remove_dir_all(&old_extra);

        // New linked worktree on disk that is not registered yet.
        let new_extra = tmp.path().join("acme-worktrees").join("new-one");
        assert!(
            Command::new("git")
                .args([
                    "-C",
                    repo.to_str().unwrap(),
                    "worktree",
                    "add",
                    "-b",
                    "new-one",
                    new_extra.to_str().unwrap(),
                    "main",
                ])
                .status()
                .unwrap()
                .success()
        );

        let outcome = refresh_project_worktrees(&mut store, &project_id).unwrap();
        assert_eq!(outcome.removed, vec!["old-one".to_string()]);
        assert_eq!(outcome.removed_ids, vec![old_id]);
        assert_eq!(outcome.imported, vec!["new-one".to_string()]);
        assert_eq!(store.worktrees.len(), 1);
        assert_eq!(store.worktrees[0].display_name, "new-one");
        assert_eq!(store.worktrees[0].origin, WorktreeOrigin::Imported);
        assert_eq!(store.worktrees[0].status, WorktreeStatus::Ready);
        assert!(store.worktrees[0].path.contains("new-one"));
    }
}
