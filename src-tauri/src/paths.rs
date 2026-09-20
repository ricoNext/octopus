use std::path::{Path, PathBuf};

use unicode_normalization::UnicodeNormalization;

pub fn slugify(input: &str) -> String {
    let nfc: String = input.nfc().collect();
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in nfc.chars() {
        if is_kept(ch) {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "wt".to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_kept(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || is_han(ch)
}

fn is_han(ch: char) -> bool {
    matches!(
        ch,
        '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{20000}'..='\u{2A6DF}'
            | '\u{2A700}'..='\u{2B73F}'
            | '\u{2B740}'..='\u{2B81F}'
            | '\u{2B820}'..='\u{2CEAF}'
            | '\u{30000}'..='\u{3134F}'
    )
}

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
    fn slug_keeps_han_and_ascii() {
        assert_eq!(slugify("修登录"), "修登录");
        assert_eq!(slugify("修 登录"), "修-登录");
        assert_eq!(slugify("Fix Login"), "Fix-Login");
        assert_eq!(slugify("Fix   Login!!"), "Fix-Login");
        assert_eq!(slugify("  "), "wt");
        assert_eq!(slugify("!!!"), "wt");
    }

    #[test]
    fn dest_matches_spec_example() {
        let parent = PathBuf::from("/Users/star/.octopus/worktree/acme");
        assert_eq!(
            worktree_dest(&parent, "xiu-deng-lu"),
            PathBuf::from("/Users/star/.octopus/worktree/acme/xiu-deng-lu")
        );
    }
}
