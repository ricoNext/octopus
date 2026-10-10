//! Built-in agent catalog, enable/disable, override merge, and launch-line helpers.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CatalogAgentId {
    Codex,
    CodeBuddy,
}

impl CatalogAgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            CatalogAgentId::Codex => "codex",
            CatalogAgentId::CodeBuddy => "codebuddy",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CatalogEntry {
    pub id: CatalogAgentId,
    pub label: &'static str,
    pub detect_cmd: &'static str,
    pub launch_cmd: &'static str,
    pub process_match: &'static str,
    pub default_args: &'static [&'static str],
    pub default_env: &'static [(&'static str, &'static str)],
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cmd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserSettings {
    /// "codex" | "codebuddy" | "blank"
    pub default_agent: String,
    pub disabled_agents: Vec<String>,
    pub agent_overrides: BTreeMap<String, AgentOverride>,
}

impl Default for AgentUserSettings {
    fn default() -> Self {
        Self {
            default_agent: "codex".to_string(),
            disabled_agents: Vec::new(),
            agent_overrides: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedLaunch {
    pub cmd: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub shell_line: String,
}

static BUILTIN_CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: CatalogAgentId::Codex,
        label: "Codex",
        detect_cmd: "codex",
        launch_cmd: "codex",
        process_match: "codex",
        default_args: &[],
        default_env: &[],
    },
    CatalogEntry {
        id: CatalogAgentId::CodeBuddy,
        label: "CodeBuddy",
        detect_cmd: "codebuddy",
        launch_cmd: "codebuddy",
        process_match: "codebuddy",
        default_args: &[],
        default_env: &[],
    },
];

pub fn builtin_catalog() -> &'static [CatalogEntry] {
    BUILTIN_CATALOG
}

pub fn parse_catalog_id(s: &str) -> Option<CatalogAgentId> {
    match s {
        "codex" => Some(CatalogAgentId::Codex),
        "codebuddy" => Some(CatalogAgentId::CodeBuddy),
        _ => None,
    }
}

pub fn entry_for(id: CatalogAgentId) -> &'static CatalogEntry {
    builtin_catalog()
        .iter()
        .find(|e| e.id == id)
        .expect("catalog id missing from builtin catalog")
}

pub fn is_enabled(settings: &AgentUserSettings, id: CatalogAgentId) -> bool {
    !settings
        .disabled_agents
        .iter()
        .any(|d| d.eq_ignore_ascii_case(id.as_str()))
}

pub fn enabled_ids(settings: &AgentUserSettings) -> Vec<CatalogAgentId> {
    builtin_catalog()
        .iter()
        .filter(|e| is_enabled(settings, e.id))
        .map(|e| e.id)
        .collect()
}

/// Resolve the effective default agent id string ("codex" | "codebuddy" | "blank").
/// If the configured default is disabled or unknown, fall back to the first still-enabled
/// catalog id; if none remain enabled, return "blank".
pub fn resolve_default_agent(settings: &AgentUserSettings) -> String {
    let configured = settings.default_agent.as_str();
    if configured == "blank" {
        return "blank".to_string();
    }
    if let Some(id) = parse_catalog_id(configured) {
        if is_enabled(settings, id) {
            return id.as_str().to_string();
        }
    }
    if let Some(id) = enabled_ids(settings).first().copied() {
        return id.as_str().to_string();
    }
    "blank".to_string()
}

/// If `default_agent` points at a disabled/unknown id, rewrite it to the resolved fallback.
/// Returns true when the stored value changed.
pub fn coalesce_default_on_disable(settings: &mut AgentUserSettings) -> bool {
    let resolved = resolve_default_agent(settings);
    if resolved != settings.default_agent {
        settings.default_agent = resolved;
        true
    } else {
        false
    }
}

pub fn resolve_launch(settings: &AgentUserSettings, id: CatalogAgentId) -> ResolvedLaunch {
    let entry = entry_for(id);
    let ov = settings.agent_overrides.get(id.as_str());

    let cmd = ov
        .and_then(|o| o.cmd.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| entry.launch_cmd.to_string());

    let args = ov
        .and_then(|o| o.args.clone())
        .unwrap_or_else(|| {
            entry
                .default_args
                .iter()
                .map(|s| (*s).to_string())
                .collect()
        });

    let env = ov.and_then(|o| o.env.clone()).unwrap_or_else(|| {
        entry
            .default_env
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    });

    let shell_line = build_shell_line(&cmd, &args, &env);
    ResolvedLaunch {
        cmd,
        args,
        env,
        shell_line,
    }
}

/// POSIX-ish single-quote escaping for shell args.
pub fn shell_quote_arg(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    let needs_quote = s.chars().any(|c| {
        c.is_whitespace()
            || matches!(
                c,
                '\'' | '"'
                    | '\\'
                    | '$'
                    | '`'
                    | '!'
                    | '*'
                    | '?'
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | '('
                    | ')'
                    | ';'
                    | '&'
                    | '|'
                    | '<'
                    | '>'
                    | '#'
                    | '~'
            )
    });
    if !needs_quote {
        return s.to_string();
    }
    let mut out = String::from("'");
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// Build a shell line: optional `export KEY=VAL; ...` prefix + quoted cmd/args.
pub fn build_shell_line(cmd: &str, args: &[String], env: &BTreeMap<String, String>) -> String {
    let mut exports = Vec::new();
    for (k, v) in env {
        exports.push(format!(
            "export {}={}",
            shell_quote_arg(k),
            shell_quote_arg(v)
        ));
    }

    let mut cmd_parts = Vec::with_capacity(1 + args.len());
    cmd_parts.push(shell_quote_arg(cmd));
    for a in args {
        cmd_parts.push(shell_quote_arg(a));
    }
    let cmd_line = cmd_parts.join(" ");

    if exports.is_empty() {
        cmd_line
    } else {
        format!("{}; {}", exports.join("; "), cmd_line)
    }
}


/// Whether a presence `agent_id` string should be shown given user settings.
/// Unknown ids are never visible.
/// Used by tests and as the spec-facing pure check; runtime host filter uses [`enabled_id_set`].
#[allow(dead_code)]
pub fn presence_visible(agent_id: &str, settings: &AgentUserSettings) -> bool {
    match parse_catalog_id(agent_id) {
        Some(id) => is_enabled(settings, id),
        None => false,
    }
}

/// Enabled catalog ids as a string set (for host presence filtering).
pub fn enabled_id_set(settings: &AgentUserSettings) -> HashSet<String> {
    enabled_ids(settings)
        .into_iter()
        .map(|id| id.as_str().to_string())
        .collect()
}

/// PATH lookup for a bare command name; absolute paths use `Path::is_file`.
pub fn detect_installed(detect_cmd: &str) -> bool {
    let path = Path::new(detect_cmd);
    if path.is_absolute() {
        return path.is_file();
    }
    let Ok(path_env) = std::env::var("PATH") else {
        return false;
    };
    for dir in std::env::split_paths(&path_env) {
        let candidate = dir.join(detect_cmd);
        if candidate.is_file() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with(default: &str, disabled: &[&str]) -> AgentUserSettings {
        AgentUserSettings {
            default_agent: default.to_string(),
            disabled_agents: disabled.iter().map(|s| (*s).to_string()).collect(),
            agent_overrides: BTreeMap::new(),
        }
    }

    #[test]
    fn enabled_false_when_disabled() {
        let settings = settings_with("codex", &["codebuddy"]);
        assert!(is_enabled(&settings, CatalogAgentId::Codex));
        assert!(!is_enabled(&settings, CatalogAgentId::CodeBuddy));
    }

    #[test]
    fn resolve_default_falls_back_when_disabled() {
        let mut settings = settings_with("codebuddy", &["codebuddy"]);
        assert_eq!(resolve_default_agent(&settings), "codex");

        settings.disabled_agents = vec!["codex".into(), "codebuddy".into()];
        assert_eq!(resolve_default_agent(&settings), "blank");

        settings.default_agent = "codebuddy".into();
        assert!(coalesce_default_on_disable(&mut settings));
        assert_eq!(settings.default_agent, "blank");
    }

    #[test]
    fn override_cmd_and_args_merge() {
        let mut settings = AgentUserSettings::default();
        let mut env = BTreeMap::new();
        env.insert("FOO".into(), "bar".into());
        settings.agent_overrides.insert(
            "codex".into(),
            AgentOverride {
                cmd: Some("/opt/bin/codex".into()),
                args: Some(vec!["--yolo".into(), "with space".into()]),
                env: Some(env.clone()),
            },
        );

        let launch = resolve_launch(&settings, CatalogAgentId::Codex);
        assert_eq!(launch.cmd, "/opt/bin/codex");
        assert_eq!(
            launch.args,
            vec!["--yolo".to_string(), "with space".to_string()]
        );
        assert_eq!(launch.env, env);

        // missing override fields fall back to catalog defaults (empty)
        settings.agent_overrides.insert(
            "codebuddy".into(),
            AgentOverride {
                cmd: Some("/custom/codebuddy".into()),
                args: None,
                env: None,
            },
        );
        let launch2 = resolve_launch(&settings, CatalogAgentId::CodeBuddy);
        assert_eq!(launch2.cmd, "/custom/codebuddy");
        assert!(launch2.args.is_empty());
        assert!(launch2.env.is_empty());
    }

    #[test]
    fn build_shell_line_quotes_spaces_and_exports_env() {
        let mut env = BTreeMap::new();
        env.insert("A".into(), "1".into());
        let args = vec!["arg with spaces".to_string()];
        let line = build_shell_line("mycmd", &args, &env);
        assert!(
            line.contains("export A=1") || line.contains("export A='1'"),
            "expected export prefix, got: {line}"
        );
        assert!(
            line.contains("'arg with spaces'") || line.contains("\"arg with spaces\""),
            "expected quoted arg, got: {line}"
        );
        assert!(line.contains("mycmd"), "expected cmd, got: {line}");
    }

    #[test]
    fn detect_installed_absolute_missing_is_false() {
        assert!(!detect_installed("/no/such/agent-bin-octopus-test"));
    }

    #[test]
    fn builtin_catalog_has_codex_and_codebuddy() {
        let cat = builtin_catalog();
        assert_eq!(cat.len(), 2);
        assert_eq!(cat[0].id, CatalogAgentId::Codex);
        assert_eq!(cat[0].detect_cmd, "codex");
        assert_eq!(cat[0].launch_cmd, "codex");
        assert_eq!(cat[0].process_match, "codex");
        assert!(cat[0].default_args.is_empty());
        assert!(cat[0].default_env.is_empty());
        assert_eq!(cat[1].id, CatalogAgentId::CodeBuddy);
        assert_eq!(cat[1].detect_cmd, "codebuddy");
        assert_eq!(cat[1].process_match, "codebuddy");
    }

    #[test]
    fn default_settings_are_codex_empty_disabled() {
        let s = AgentUserSettings::default();
        assert_eq!(s.default_agent, "codex");
        assert!(s.disabled_agents.is_empty());
        assert!(s.agent_overrides.is_empty());
    }

    #[test]
    fn parse_catalog_id_known() {
        assert_eq!(parse_catalog_id("codex"), Some(CatalogAgentId::Codex));
        assert_eq!(
            parse_catalog_id("codebuddy"),
            Some(CatalogAgentId::CodeBuddy)
        );
        assert_eq!(parse_catalog_id("blank"), None);
        assert_eq!(parse_catalog_id("nope"), None);
    }

    #[test]
    fn presence_visible_respects_enabled_set() {
        let settings = settings_with("codex", &["codebuddy"]);
        assert!(presence_visible("codex", &settings));
        assert!(!presence_visible("codebuddy", &settings));
        assert!(!presence_visible("unknown", &settings));
        assert!(!presence_visible("blank", &settings));

        let all_disabled = settings_with("blank", &["codex", "codebuddy"]);
        assert!(!presence_visible("codex", &all_disabled));
        assert_eq!(enabled_id_set(&settings), HashSet::from(["codex".into()]));
        assert!(enabled_id_set(&all_disabled).is_empty());
    }
}
