use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::models::{
    AppSnapshot, DeleteResult, DiffResult, InspectResult, RemoveProjectResult, Store,
};
use crate::pty::PtyManager;
use crate::workspace::{self, CreateOutcome};

pub struct AppState {
    pub store: Mutex<Store>,
    pub creating: Mutex<HashSet<String>>,
    pub ptys: PtyManager,
    pub store_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub snapshot: AppSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused_worktree_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct CreateGuard<'a> {
    set: &'a Mutex<HashSet<String>>,
    project_id: String,
}

impl<'a> CreateGuard<'a> {
    fn acquire(set: &'a Mutex<HashSet<String>>, project_id: String) -> Result<Self, String> {
        let mut guard = set.lock().map_err(|_| "创建锁损坏".to_string())?;
        if !guard.insert(project_id.clone()) {
            return Err("该项目正在创建工作树".into());
        }
        drop(guard);
        Ok(Self { set, project_id })
    }
}

impl Drop for CreateGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.set.lock() {
            guard.remove(&self.project_id);
        }
    }
}

fn persist(state: &AppState, store: &Store) -> Result<(), String> {
    store.save(&state.store_path)
}

fn locked_store(state: &AppState) -> Result<std::sync::MutexGuard<'_, Store>, String> {
    state.store.lock().map_err(|_| "数据锁损坏".to_string())
}

#[tauri::command]
pub fn load_snapshot(state: State<AppState>) -> Result<AppSnapshot, String> {
    let mut store = locked_store(&state)?;
    store.reconcile();
    persist(&state, &store)?;
    Ok(store.snapshot())
}

#[tauri::command]
pub fn inspect_repo(state: State<AppState>, path: String) -> Result<InspectResult, String> {
    let store = locked_store(&state)?;
    workspace::inspect_repo(&store, &path)
}

#[tauri::command]
pub fn add_project(
    state: State<AppState>,
    path: String,
    import_paths: Vec<String>,
) -> Result<MutationResult, String> {
    let mut store = locked_store(&state)?;
    workspace::add_project(&mut store, &path, import_paths)?;
    store.reconcile();
    persist(&state, &store)?;
    Ok(MutationResult {
        snapshot: store.snapshot(),
        focused_worktree_id: None,
        error: None,
    })
}

#[tauri::command]
pub fn create_worktree(
    state: State<AppState>,
    project_id: String,
    display_name: String,
    branch_name: Option<String>,
    start_from: Option<String>,
) -> Result<MutationResult, String> {
    let _guard = CreateGuard::acquire(&state.creating, project_id.clone())?;
    let mut store = locked_store(&state)?;
    let outcome = workspace::create_worktree(
        &mut store,
        &project_id,
        display_name,
        branch_name,
        start_from,
    )?;
    persist(&state, &store)?;
    Ok(mutation_from_create(store.snapshot(), outcome))
}

#[tauri::command]
pub fn retry_worktree(state: State<AppState>, worktree_id: String) -> Result<MutationResult, String> {
    let project_id = {
        let store = locked_store(&state)?;
        store
            .worktrees
            .iter()
            .find(|item| item.id == worktree_id)
            .map(|item| item.project_id.clone())
            .ok_or_else(|| "找不到该工作树".to_string())?
    };
    let _guard = CreateGuard::acquire(&state.creating, project_id)?;
    let mut store = locked_store(&state)?;
    let outcome = workspace::retry_worktree(&mut store, &worktree_id)?;
    persist(&state, &store)?;
    Ok(mutation_from_create(store.snapshot(), outcome))
}

fn mutation_from_create(snapshot: AppSnapshot, outcome: CreateOutcome) -> MutationResult {
    match outcome {
        CreateOutcome::Ready(id) => MutationResult {
            snapshot,
            focused_worktree_id: Some(id),
            error: None,
        },
        CreateOutcome::Failed { id, stderr } => MutationResult {
            snapshot,
            focused_worktree_id: Some(id),
            error: Some(stderr),
        },
    }
}

#[tauri::command]
pub fn abandon_worktree(
    state: State<AppState>,
    worktree_id: String,
) -> Result<AppSnapshot, String> {
    state.ptys.kill(&worktree_id);
    let mut store = locked_store(&state)?;
    workspace::abandon_worktree(&mut store, &worktree_id)?;
    persist(&state, &store)?;
    Ok(store.snapshot())
}

#[tauri::command]
pub fn delete_worktree(
    state: State<AppState>,
    worktree_id: String,
    delete_branch: bool,
    force: bool,
) -> Result<DeleteResult, String> {
    state.ptys.kill(&worktree_id);
    let mut store = locked_store(&state)?;
    let result = workspace::delete_worktree(&mut store, &worktree_id, delete_branch, force)?;
    persist(&state, &store)?;
    Ok(result)
}

#[tauri::command]
pub fn remove_missing_worktree(
    state: State<AppState>,
    worktree_id: String,
) -> Result<AppSnapshot, String> {
    state.ptys.kill(&worktree_id);
    let mut store = locked_store(&state)?;
    workspace::remove_missing_worktree(&mut store, &worktree_id)?;
    persist(&state, &store)?;
    Ok(store.snapshot())
}

#[tauri::command]
pub fn remove_project(
    state: State<AppState>,
    project_id: String,
    forget: bool,
) -> Result<RemoveProjectResult, String> {
    let ids = {
        let store = locked_store(&state)?;
        store
            .worktrees
            .iter()
            .filter(|item| item.project_id == project_id)
            .map(|item| item.id.clone())
            .collect::<Vec<_>>()
    };
    if forget {
        for id in &ids {
            state.ptys.kill(id);
        }
    }
    let mut store = locked_store(&state)?;
    let result = workspace::remove_project(&mut store, &project_id, forget)?;
    persist(&state, &store)?;
    Ok(result)
}

#[tauri::command]
pub fn list_local_branches(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let store = locked_store(&state)?;
    workspace::list_branches(&store, &project_id)
}

#[tauri::command]
pub fn get_diff(state: State<AppState>, worktree_id: String) -> Result<DiffResult, String> {
    let store = locked_store(&state)?;
    workspace::get_diff(&store, &worktree_id)
}

#[tauri::command]
pub fn open_in_cursor(path: String) -> Result<(), String> {
    workspace::open_in_cursor(&path)
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    workspace::reveal_in_finder(&path)
}

#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    state: State<AppState>,
    worktree_id: String,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    let cwd = {
        let store = locked_store(&state)?;
        PathBuf::from(workspace::worktree_cwd(&store, &worktree_id)?)
    };
    state.ptys.open(app, worktree_id, &cwd, cols, rows)
}

#[tauri::command]
pub fn pty_write(state: State<AppState>, worktree_id: String, data: String) -> Result<(), String> {
    state.ptys.write(&worktree_id, &data)
}

#[tauri::command]
pub fn pty_resize(
    state: State<AppState>,
    worktree_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.ptys.resize(&worktree_id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<AppState>, worktree_id: String) {
    state.ptys.kill(&worktree_id);
}

pub fn init_state(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录：{err}"))?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用数据目录：{err}"))?;
    let store_path = dir.join("state.json");
    let mut store = Store::load(&store_path);
    store.reconcile();
    let _ = store.save(&store_path);
    app.manage(AppState {
        store: Mutex::new(store),
        creating: Mutex::new(HashSet::new()),
        ptys: PtyManager::new(),
        store_path,
    });
    Ok(())
}
