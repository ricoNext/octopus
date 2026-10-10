//! Persist `AgentUserSettings` to `agent-settings.json`.

use std::fs;
use std::path::Path;

use crate::agent_catalog::AgentUserSettings;

/// Load settings from `path`. Missing or invalid file → `Default`.
pub fn load(path: &Path) -> AgentUserSettings {
    let Ok(text) = fs::read_to_string(path) else {
        return AgentUserSettings::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// Pretty-print JSON to `path`, creating parent dirs as needed.
pub fn save(path: &Path, settings: &AgentUserSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法写入 Agent 设置：{err}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("无法序列化 Agent 设置：{err}"))?;
    fs::write(path, text).map_err(|err| format!("无法写入 Agent 设置：{err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_catalog::AgentOverride;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    #[test]
    fn load_missing_file_returns_default() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("agent-settings.json");
        let loaded = load(&path);
        assert_eq!(loaded, AgentUserSettings::default());
        assert_eq!(loaded.default_agent, "codex");
        assert!(loaded.disabled_agents.is_empty());
        assert!(loaded.agent_overrides.is_empty());
    }

    #[test]
    fn load_invalid_json_returns_default() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("agent-settings.json");
        fs::write(&path, "{not-json").unwrap();
        assert_eq!(load(&path), AgentUserSettings::default());
    }

    #[test]
    fn save_load_roundtrip() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("nested").join("agent-settings.json");

        let mut env = BTreeMap::new();
        env.insert("FOO".into(), "bar".into());
        let settings = AgentUserSettings {
            default_agent: "codebuddy".into(),
            disabled_agents: vec!["codex".into()],
            agent_overrides: BTreeMap::from([(
                "codebuddy".into(),
                AgentOverride {
                    cmd: Some("/opt/codebuddy".into()),
                    args: Some(vec!["--flag".into()]),
                    env: Some(env.clone()),
                },
            )]),
        };

        save(&path, &settings).expect("save");
        assert!(path.is_file());

        let loaded = load(&path);
        assert_eq!(loaded, settings);
        assert_eq!(loaded.default_agent, "codebuddy");
        assert_eq!(loaded.disabled_agents, vec!["codex".to_string()]);
        let ov = loaded.agent_overrides.get("codebuddy").unwrap();
        assert_eq!(ov.cmd.as_deref(), Some("/opt/codebuddy"));
        assert_eq!(ov.args.as_ref().unwrap(), &vec!["--flag".to_string()]);
        assert_eq!(ov.env.as_ref().unwrap(), &env);
    }
}
