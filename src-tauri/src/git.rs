use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use crate::models::ExistingWorktree;

static GIT_BIN: OnceLock<Result<PathBuf, String>> = OnceLock::new();

pub fn git_bin() -> Result<PathBuf, String> {
    match GIT_BIN.get_or_init(discover_git) {
        Ok(path) => Ok(path.clone()),
        Err(err) => Err(err.clone()),
    }
}

fn discover_git() -> Result<PathBuf, String> {
    if let Some(path) = command_v("git") {
        return Ok(path);
    }
    Err("未找到 git，请确认已安装并在 PATH 中。".into())
}

pub fn command_v(name: &str) -> Option<PathBuf> {
    let output = Command::new("/bin/zsh")
        .args(["-lc", &format!("command -v {}", shell_single_quote(name))])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub struct GitOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub fn git(repo: Option<&Path>, args: &[&str]) -> Result<GitOutput, String> {
    let bin = git_bin()?;
    let mut cmd = Command::new(bin);
    if let Some(repo) = repo {
        cmd.arg("-C").arg(repo);
    }
    cmd.args(args);
    let output = cmd
        .output()
        .map_err(|err| format!("无法执行 git：{err}"))?;
    Ok(GitOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

pub fn git_ok(repo: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let out = git(repo, args)?;
    if out.success {
        Ok(out.stdout)
    } else {
        Err(prefer_stderr(&out))
    }
}

pub fn prefer_stderr(out: &GitOutput) -> String {
    if !out.stderr.is_empty() {
        out.stderr.clone()
    } else if !out.stdout.is_empty() {
        out.stdout.clone()
    } else {
        "git 命令失败。".into()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedWorktree {
    pub path: PathBuf,
    pub head: String,
    pub branch: Option<String>,
}

pub fn worktree_list(repo: &Path) -> Result<Vec<ListedWorktree>, String> {
    let stdout = git_ok(Some(repo), &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_porcelain(&stdout))
}

pub fn parse_worktree_porcelain(stdout: &str) -> Vec<ListedWorktree> {
    let mut items = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_head = String::new();
    let mut current_branch: Option<String> = None;

    let push_current = |items: &mut Vec<ListedWorktree>,
                        path: &mut Option<PathBuf>,
                        head: &mut String,
                        branch: &mut Option<String>| {
        if let Some(path) = path.take() {
            items.push(ListedWorktree {
                path,
                head: std::mem::take(head),
                branch: branch.take(),
            });
        }
    };

    for line in stdout.lines() {
        if line.is_empty() {
            push_current(
                &mut items,
                &mut current_path,
                &mut current_head,
                &mut current_branch,
            );
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            push_current(
                &mut items,
                &mut current_path,
                &mut current_head,
                &mut current_branch,
            );
            current_path = Some(PathBuf::from(path));
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            current_head = head.to_string();
        } else if let Some(branch) = line.strip_prefix("branch ") {
            current_branch = Some(
                branch
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch)
                    .to_string(),
            );
        } else if line == "detached" {
            current_branch = None;
        }
    }
    push_current(
        &mut items,
        &mut current_path,
        &mut current_head,
        &mut current_branch,
    );
    items
}

pub fn existing_linked_worktrees(
    repo: &Path,
    main_root: &Path,
) -> Result<Vec<ExistingWorktree>, String> {
    let listed = worktree_list(repo)?;
    let main_canon = canonicalize_or(main_root);
    Ok(listed
        .into_iter()
        .filter(|item| canonicalize_or(&item.path) != main_canon)
        .map(|item| ExistingWorktree {
            path: item.path.to_string_lossy().to_string(),
            branch_name: item.branch,
            head: item.head,
        })
        .collect())
}

pub fn local_branches(repo: &Path) -> Result<Vec<String>, String> {
    let stdout = git_ok(Some(repo), &["branch", "--format=%(refname:short)"])?;
    Ok(stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

pub fn remote_branches(repo: &Path) -> Result<Vec<String>, String> {
    let stdout = git_ok(
        Some(repo),
        &["branch", "--remotes", "--format=%(refname:short)"],
    )?;
    Ok(stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.ends_with("/HEAD"))
        .map(ToString::to_string)
        .collect())
}

pub fn recent_branches(repo: &Path, local: &[String]) -> Result<Vec<String>, String> {
    let out = git(Some(repo), &["reflog", "--format=%gs", "-n", "50", "HEAD"])?;
    if !out.success {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for line in out.stdout.lines() {
        let Some((_, target)) = line.rsplit_once(" to ") else {
            continue;
        };
        let target = target.trim();
        if local.iter().any(|item| item == target) && !result.iter().any(|item| item == target) {
            result.push(target.to_string());
        }
    }
    if let Ok(current) = git_ok(Some(repo), &["branch", "--show-current"]) {
        let current = current.trim();
        if local.iter().any(|item| item == current) && !result.iter().any(|item| item == current) {
            result.insert(0, current.to_string());
        }
    }
    Ok(result)
}

pub fn default_branch(repo: &Path) -> (String, bool) {
    if let Ok(sym) = git_ok(Some(repo), &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let name = sym
            .trim()
            .strip_prefix("refs/remotes/origin/")
            .unwrap_or(sym.trim());
        if !name.is_empty() {
            return (name.to_string(), false);
        }
    }
    if let Ok(current) = git_ok(Some(repo), &["branch", "--show-current"]) {
        if !current.is_empty() {
            return (current, false);
        }
    }
    ("main".into(), true)
}

pub fn show_toplevel(path: &Path) -> Result<PathBuf, String> {
    let out = git(Some(path), &["rev-parse", "--show-toplevel"])?;
    if !out.success {
        return Err("这不是 git 仓库".into());
    }
    Ok(PathBuf::from(out.stdout))
}

pub fn canonicalize_or(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    canonicalize_or(a) == canonicalize_or(b)
}

pub fn display_name_from_path(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "worktree".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_two_worktrees() {
        let input = "\
worktree /Users/star/code/acme
HEAD abc
branch refs/heads/main

worktree /Users/star/code/acme-worktrees/xiu-deng-lu
HEAD def
branch refs/heads/xiu-deng-lu
";
        let listed = parse_worktree_porcelain(input);
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].branch.as_deref(), Some("main"));
        assert_eq!(
            listed[1].path,
            PathBuf::from("/Users/star/code/acme-worktrees/xiu-deng-lu")
        );
    }

    #[test]
    fn parse_detached() {
        let input = "\
worktree /tmp/repo
HEAD abcdef
detached
";
        let listed = parse_worktree_porcelain(input);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].branch, None);
    }
}
