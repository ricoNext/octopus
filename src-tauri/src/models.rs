use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeOrigin {
    App,
    Imported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeStatus {
    Creating,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub default_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub project_id: String,
    pub display_name: String,
    pub branch_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_from: Option<String>,
    pub path: String,
    pub origin: WorktreeOrigin,
    pub status: WorktreeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub based_on_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dep_link: Option<DepLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    pub path_missing: bool,
    pub main_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeView {
    #[serde(flatten)]
    pub worktree: Worktree,
    pub missing: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub worktrees: Vec<Worktree>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub projects: Vec<ProjectView>,
    pub worktrees: Vec<WorktreeView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingWorktree {
    pub path: String,
    pub branch_name: Option<String>,
    pub head: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectResult {
    pub root_path: String,
    pub name: String,
    pub default_branch: String,
    pub used_fallback_default_branch: bool,
    pub existing_worktrees: Vec<ExistingWorktree>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DeleteResult {
    Ok { snapshot: AppSnapshot },
    NeedsForce { stderr: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RemoveProjectResult {
    Ok { snapshot: AppSnapshot },
    HasAppWorktrees { count: usize },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshProjectWorktreesResult {
    pub snapshot: AppSnapshot,
    pub removed: Vec<String>,
    pub imported: Vec<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DepLinkStatus {
    None,
    Linked,
    Broken,
}

impl Default for DepLinkStatus {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DepLinkEntry {
    /// "" = repo root; never "."
    pub rel_path: String,
    pub status: DepLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepLink {
    pub kind: String,
    pub status: DepLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_at: Option<String>,
    #[serde(default)]
    pub links: Vec<DepLinkEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LinkNodeModulesResult {
    Ok { snapshot: AppSnapshot },
    NeedsConfirm { conflict: String }, // "directory" | "symlink"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepLinkStatusItem {
    pub path: String,
    pub status: DepLinkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_from: Option<String>,
    pub source_ok: bool, // `{path}/node_modules` usable as link source
}
