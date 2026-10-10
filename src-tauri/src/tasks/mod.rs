mod changes;
mod runner;
mod storage;

pub use runner::run_worker;

use crate::{agent_catalog, commands::AppState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State};
use uuid::Uuid;

pub const LABELS: [&str; 5] = ["待运行", "执行中", "待处理", "待验收", "已完成"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    pub description: String,
    pub acceptance: String,
    pub constraints: String,
    pub agent_id: String,
    pub directories: Vec<String>,
    pub primary_directory: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    pub text: String,
    pub at: u64,
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub id: String,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub outcome: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    #[serde(flatten)]
    pub input: TaskInput,
    pub phase: String,
    pub reason: Option<String>,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub started_at: Option<u64>,
    pub session_id: Option<String>,
    pub run_id: Option<String>,
    pub stop_requested: bool,
    pub messages: Vec<Message>,
    pub executions: Vec<Execution>,
    pub pending_messages: Vec<String>,
    pub summary: Option<String>,
    pub changes: Vec<changes::FileChange>,
    pub change_notices: Vec<String>,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl Task {
    pub fn message(&mut self, role: &str, text: impl Into<String>) {
        self.messages.push(Message {
            id: Uuid::new_v4().to_string(),
            role: role.into(),
            text: text.into(),
            at: now(),
            run_id: self.run_id.clone(),
        });
        self.updated_at = now();
    }
    pub fn attention(&mut self, reason: &str, error: Option<String>) {
        self.phase = "attention".into();
        self.reason = Some(reason.into());
        self.error = error;
        self.updated_at = now();
    }
}

pub struct TaskManager {
    pub root: PathBuf,
    pub exit_allowed: AtomicBool,
    pub quitting: AtomicBool,
}

impl TaskManager {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        storage::private_dir(&root)?;
        Ok(Self {
            root,
            exit_allowed: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        })
    }
    pub fn list(&self) -> Result<Vec<Task>, String> {
        let mut tasks = Vec::new();
        for entry in std::fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().to_string();
            if Uuid::parse_str(&id).is_err() || !entry.path().join("task.json").exists() {
                continue;
            }
            let task = storage::edit(&self.root, &id, |task| {
                if task.phase == "running"
                    && now()
                        .saturating_sub(task.executions.last().map(|r| r.started_at).unwrap_or(0))
                        > 10_000
                    && !storage::worker_alive(&entry.path())?
                {
                    task.attention(
                        "failed",
                        Some(
                            "后台执行进程已中断。已保留会话和文件，请重试；无法恢复时会显示错误。"
                                .into(),
                        ),
                    );
                    if let Some(run) = task.executions.last_mut() {
                        run.ended_at = Some(now());
                        run.outcome = Some("failed".into());
                    }
                    task.message("system", "检测到后台执行中断");
                }
                Ok(())
            })?;
            tasks.push(task);
        }
        tasks.sort_by_key(|t| std::cmp::Reverse(t.created_at));
        Ok(tasks)
    }
    pub fn has_running(&self) -> bool {
        self.list()
            .map(|v| v.iter().any(|t| t.phase == "running"))
            .unwrap_or(true)
    }
}

fn validate(
    input: &mut TaskInput,
    settings: &agent_catalog::AgentUserSettings,
) -> Result<(), String> {
    input.title = input.title.trim().into();
    if input.title.is_empty() || input.title.chars().count() > 200 {
        return Err("标题需要 1–200 个字符".into());
    }
    if input.description.trim().is_empty()
        || input.acceptance.trim().is_empty()
        || input.constraints.trim().is_empty()
    {
        return Err("请填写目标描述、验收标准和约束条件；没有额外约束可填写“无”".into());
    }
    if input.description.len() + input.acceptance.len() + input.constraints.len() > 100_000 {
        return Err("任务描述过长".into());
    }
    let agent = agent_catalog::parse_catalog_id(&input.agent_id).ok_or("请选择已配置的 Agent")?;
    if !agent_catalog::is_enabled(settings, agent) {
        return Err("所选 Agent 已禁用，请在设置中启用".into());
    }
    if input.directories.is_empty() || input.directories.len() > 32 {
        return Err("请选择 1–32 个工作目录".into());
    }
    let canonical = |p: &str| -> Result<String, String> {
        let p = Path::new(p)
            .canonicalize()
            .map_err(|e| format!("无法访问目录 {p}：{e}"))?;
        if !p.is_dir() {
            return Err(format!("不是目录：{}", p.display()));
        }
        Ok(p.to_string_lossy().into())
    };
    input.primary_directory = canonical(&input.primary_directory)?;
    input.directories = input
        .directories
        .iter()
        .map(|p| canonical(p))
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen = std::collections::HashSet::new();
    input.directories.retain(|p| seen.insert(p.clone()));
    if !input.directories.contains(&input.primary_directory) {
        return Err("主工作目录必须属于关联目录".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn tasks_list(manager: State<'_, TaskManager>) -> Result<Vec<Task>, String> {
    manager.list()
}

#[tauri::command]
pub async fn tasks_save(
    manager: State<'_, TaskManager>,
    app_state: State<'_, AppState>,
    id: Option<String>,
    mut input: TaskInput,
) -> Result<Task, String> {
    let settings = app_state
        .agent_settings
        .lock()
        .map_err(|_| "Agent 设置不可用")?
        .clone();
    validate(&mut input, &settings)?;
    if let Some(id) = id {
        storage::edit(&manager.root, &id, |task| {
            if task.started_at.is_some() {
                return Err("首次运行后请通过对话补充要求，目录已锁定".into());
            }
            if task.input.agent_id != input.agent_id {
                return Err("创建任务后不能更换 Agent".into());
            }
            task.input = input;
            task.updated_at = now();
            Ok(())
        })
    } else {
        let task = Task {
            id: Uuid::new_v4().to_string(),
            input,
            phase: "pending".into(),
            reason: None,
            error: None,
            created_at: now(),
            updated_at: now(),
            started_at: None,
            session_id: None,
            run_id: None,
            stop_requested: false,
            messages: vec![],
            executions: vec![],
            pending_messages: vec![],
            summary: None,
            changes: vec![],
            change_notices: vec![],
        };
        storage::create(&manager.root, &task)?;
        Ok(task)
    }
}

#[derive(Serialize, Deserialize)]
pub struct Launch {
    cmd: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
}

#[tauri::command]
pub async fn tasks_run(
    manager: State<'_, TaskManager>,
    app_state: State<'_, AppState>,
    id: String,
    message: Option<String>,
) -> Result<Task, String> {
    if manager.quitting.load(Ordering::SeqCst) {
        return Err("应用正在退出".into());
    }
    let settings = app_state
        .agent_settings
        .lock()
        .map_err(|_| "Agent 设置不可用")?
        .clone();
    let run_id = Uuid::new_v4().to_string();
    let task = storage::edit(&manager.root, &id, |task| {
        if !matches!(task.phase.as_str(), "pending" | "attention" | "review") {
            return Err("当前阶段无法启动任务".into());
        }
        if storage::worker_alive(&storage::task_dir(&manager.root, &id)?)? {
            return Err("上一轮执行正在收尾，请稍后重试".into());
        }
        if (task.phase == "review" || task.reason.as_deref() == Some("waiting"))
            && message.as_deref().unwrap_or("").trim().is_empty()
        {
            return Err("请填写回复或修改意见".into());
        }
        validate(&mut task.input, &settings)?;
        let agent = agent_catalog::parse_catalog_id(&task.input.agent_id).ok_or("Agent 不存在")?;
        let resolved = agent_catalog::resolve_launch(&settings, agent);
        let dir = storage::task_dir(&manager.root, &id)?;
        storage::write_json(
            &dir.join("launch.json"),
            &Launch {
                cmd: resolved.cmd,
                args: resolved.args,
                env: resolved.env,
            },
        )?;
        task.run_id = Some(run_id.clone());
        if !task.executions.is_empty() && task.session_id.is_none() {
            task.message(
                "system",
                "上一轮未取得可恢复的会话标识。本轮将创建新会话，并携带原任务与已保存的补充要求。",
            );
        }
        if let Some(message) = message.as_ref().filter(|m| !m.trim().is_empty()) {
            if message.len() > 100_000 {
                return Err("消息过长".into());
            }
            task.message("user", message.trim());
            task.pending_messages.push(message.trim().into());
        }
        task.started_at.get_or_insert(now());
        task.phase = "running".into();
        task.reason = None;
        task.error = None;
        task.stop_requested = false;
        task.executions.push(Execution {
            id: run_id.clone(),
            started_at: now(),
            ended_at: None,
            outcome: None,
        });
        task.message("system", "正在准备执行环境");
        Ok(())
    })?;
    let spawn = Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
        .arg("--task-worker")
        .arg(&manager.root)
        .arg(&id)
        .arg(&run_id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
    match spawn {
        Ok(mut child) => {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(task)
        }
        Err(e) => storage::edit(&manager.root, &id, |t| {
            t.attention("failed", Some(format!("无法启动后台执行：{e}")));
            Ok(())
        }),
    }
}

#[tauri::command]
pub async fn tasks_message(
    manager: State<'_, TaskManager>,
    id: String,
    message: String,
) -> Result<Task, String> {
    if message.trim().is_empty() || message.len() > 100_000 {
        return Err("请输入有效消息".into());
    }
    storage::edit(&manager.root, &id, |task| {
        if task.phase != "running" || task.stop_requested {
            return Err("任务当前不在执行，请使用回复或继续执行".into());
        }
        task.message("user", message.trim());
        task.pending_messages.push(message.trim().into());
        Ok(())
    })
}

#[tauri::command]
pub async fn tasks_stop(manager: State<'_, TaskManager>, id: String) -> Result<Task, String> {
    request_stop(&manager.root, &id)
}

fn request_stop(root: &Path, id: &str) -> Result<Task, String> {
    storage::edit(root, id, |task| {
        if task.phase != "running" {
            return Err("任务当前未运行".into());
        }
        task.stop_requested = true;
        task.message("system", "已请求停止，正在等待执行进程退出");
        Ok(())
    })
}

#[tauri::command]
pub async fn tasks_complete(manager: State<'_, TaskManager>, id: String) -> Result<Task, String> {
    storage::edit(&manager.root, &id, |task| {
        if task.phase != "review" {
            return Err("只有待验收任务可以确认完成".into());
        }
        task.phase = "done".into();
        task.message("system", "用户已确认完成");
        Ok(())
    })
}

#[tauri::command]
pub async fn tasks_labels(
    manager: State<'_, TaskManager>,
    labels: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let path = manager.root.join("labels.json");
    if let Some(labels) = labels {
        if labels.len() != 5
            || labels
                .iter()
                .any(|l| l.trim().is_empty() || l.chars().count() > 20)
        {
            return Err("请为五个阶段分别填写 1–20 个字符的名称".into());
        }
        let labels: Vec<String> = labels.iter().map(|l| l.trim().into()).collect();
        storage::write_json(&path, &labels)?;
        Ok(labels)
    } else if path.exists() {
        storage::read_json(&path)
    } else {
        Ok(LABELS.iter().map(|l| l.to_string()).collect())
    }
}

#[tauri::command]
pub async fn tasks_exit(
    app: tauri::AppHandle,
    manager: State<'_, TaskManager>,
    stop: bool,
) -> Result<(), String> {
    manager.quitting.store(true, Ordering::SeqCst);
    if stop {
        for task in manager.list()? {
            if task.phase == "running" {
                let _ = request_stop(&manager.root, &task.id);
            }
        }
        for _ in 0..100 {
            if !manager.has_running() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if manager.has_running() {
            manager.quitting.store(false, Ordering::SeqCst);
            return Err("仍有任务正在停止，请稍后再退出".into());
        }
    }
    manager.exit_allowed.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tasks");
    app.manage(TaskManager::new(root)?);
    Ok(())
}

#[cfg(test)]
mod tests;
