use std::path::{Path, PathBuf};

pub fn default_worktree_parent(root: &Path) -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.parent().unwrap_or(root).to_path_buf());
    let name = root.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    home.join(".octopus").join("worktree").join(name.as_ref())
}

pub fn worktree_dest(parent: &Path, name: &str) -> PathBuf {
    parent.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn dest_matches_spec_example() {
        let parent = PathBuf::from("/Users/star/.octopus/worktree/acme");
        assert_eq!(
            worktree_dest(&parent, "xiu-deng-lu"),
            PathBuf::from("/Users/star/.octopus/worktree/acme/xiu-deng-lu")
        );
    }
}
