#![allow(dead_code)] // wired in Task 2 daemon poll

//! Pure process-name matching for Phase 1 Agents presence (no IO).

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentId {
    Codex,
    CodeBuddy,
}

impl AgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentId::Codex => "codex",
            AgentId::CodeBuddy => "codebuddy",
        }
    }
}

pub type Pid = u32;

pub fn basename_of_comm(comm: &str) -> String {
    let trimmed = comm.trim();
    match trimmed.rsplit_once('/') {
        Some((_, name)) => name.to_string(),
        None => trimmed.to_string(),
    }
}

pub fn match_agent_names(names: &[String]) -> Option<AgentId> {
    let mut found_codex = false;
    for name in names {
        let base = basename_of_comm(name);
        if base.eq_ignore_ascii_case("codebuddy") {
            return Some(AgentId::CodeBuddy);
        }
        if base.eq_ignore_ascii_case("codex") {
            found_codex = true;
        }
    }
    if found_codex {
        Some(AgentId::Codex)
    } else {
        None
    }
}

/// Parse `ps -axo pid=,ppid=,comm=` style text.
/// Each line: pid, ppid, then remainder as comm (may contain spaces).
pub fn parse_ps_table(text: &str) -> Vec<(Pid, Pid, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(pid_s) = parts.next() else { continue };
        let Some(ppid_s) = parts.next() else { continue };
        let Ok(pid) = pid_s.parse::<Pid>() else { continue };
        let Ok(ppid) = ppid_s.parse::<Pid>() else { continue };
        let rest: Vec<&str> = parts.collect();
        if rest.is_empty() {
            continue;
        }
        let comm = rest.join(" ");
        out.push((pid, ppid, comm));
    }
    out
}

pub fn descendant_comms(root: Pid, rows: &[(Pid, Pid, String)]) -> Vec<String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    let mut comm_by_pid: HashMap<Pid, &str> = HashMap::new();
    for (pid, ppid, comm) in rows {
        children.entry(*ppid).or_default().push(*pid);
        comm_by_pid.insert(*pid, comm.as_str());
    }

    let mut names = Vec::new();
    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(root);
    while let Some(pid) = queue.pop_front() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(comm) = comm_by_pid.get(&pid) {
            names.push(basename_of_comm(comm));
        }
        if let Some(kids) = children.get(&pid) {
            for child in kids {
                queue.push_back(*child);
            }
        }
    }
    names
}

pub fn detect_agent_for_session(root_pid: Pid, ps_text: &str) -> Option<(AgentId, String)> {
    let rows = parse_ps_table(ps_text);
    let names = descendant_comms(root_pid, &rows);
    let id = match_agent_names(&names)?;
    let matched = names
        .into_iter()
        .find(|n| n.eq_ignore_ascii_case(id.as_str()))
        .unwrap_or_else(|| id.as_str().to_string());
    Some((id, matched))
}

pub fn presence_changed(prev: &Option<AgentId>, next: &Option<AgentId>) -> bool {
    prev != next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_strips_path() {
        assert_eq!(basename_of_comm("/usr/local/bin/codex"), "codex");
        assert_eq!(basename_of_comm("codebuddy"), "codebuddy");
    }

    #[test]
    fn match_priority_codebuddy_over_codex() {
        let names = vec!["codex".into(), "codebuddy".into()];
        assert_eq!(match_agent_names(&names), Some(AgentId::CodeBuddy));
    }

    #[test]
    fn match_case_insensitive() {
        assert_eq!(match_agent_names(&["Codex".into()]), Some(AgentId::Codex));
    }

    #[test]
    fn match_ignores_unknown() {
        assert_eq!(match_agent_names(&["zsh".into(), "node".into()]), None);
    }

    #[test]
    fn detect_walks_descendants() {
        let ps = "\
1 0 /bin/zsh
2 1 /usr/bin/node
3 2 /opt/homebrew/bin/codex
";
        let hit = detect_agent_for_session(1, ps).unwrap();
        assert_eq!(hit.0, AgentId::Codex);
        assert_eq!(hit.1, "codex");
    }

    #[test]
    fn presence_changed_only_on_diff() {
        assert!(!presence_changed(&Some(AgentId::Codex), &Some(AgentId::Codex)));
        assert!(presence_changed(&None, &Some(AgentId::Codex)));
        assert!(presence_changed(
            &Some(AgentId::Codex),
            &Some(AgentId::CodeBuddy)
        ));
    }
}
