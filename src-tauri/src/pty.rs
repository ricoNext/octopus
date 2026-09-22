use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const PROTOCOL_VERSION: u8 = 1;
const MAX_HISTORY: usize = 200_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachResult {
    pub session_id: String,
    pub is_new: bool,
    pub recovery: String,
    pub scrollback_ansi: String,
    pub cols: u16,
    pub rows: u16,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    session_id: String,
    context_id: String,
    alive: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WireMessage {
    Request {
        version: u8,
        id: String,
        command: String,
        token: Option<String>,
        payload: Value,
    },
    Response {
        version: u8,
        id: String,
        ok: bool,
        result: Option<Value>,
        error: Option<String>,
    },
    Event {
        version: u8,
        event: String,
        session_id: String,
        data: Option<Vec<u8>>,
    },
}

impl WireMessage {
    fn response(id: String, result: Result<Value, String>) -> Self {
        match result {
            Ok(result) => Self::Response {
                version: PROTOCOL_VERSION,
                id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(error) => Self::Response {
                version: PROTOCOL_VERSION,
                id,
                ok: false,
                result: None,
                error: Some(error),
            },
        }
    }
}

#[derive(Clone)]
pub struct PtyManager {
    client: Arc<DaemonClient>,
    contexts: Arc<Mutex<HashMap<String, String>>>,
}

impl PtyManager {
    pub fn new(app: &AppHandle, app_data_dir: &Path) -> Result<Self, String> {
        let client = DaemonClient::connect_or_start(app, app_data_dir)?;
        Ok(Self {
            client: Arc::new(client),
            contexts: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn open(
        &self,
        id: String,
        context_id: String,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<AttachResult, String> {
        let result = self.client.open(&id, &context_id, cwd, cols, rows)?;
        self.contexts
            .lock()
            .map_err(|_| "终端状态锁损坏".to_string())?
            .insert(id, context_id);
        Ok(result)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        // Fire-and-forget like Orca's ipcRenderer.send('pty:write'): do not wait for
        // the daemon JSON-RPC response. Waiting made every keystroke pay a full RTT.
        self.client.notify("write", json!({ "sessionId": id, "data": data }))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.client.request(
            "resize",
            json!({ "sessionId": id, "cols": cols.max(1), "rows": rows.max(1) }),
        )?;
        Ok(())
    }

    pub fn detach(&self, id: &str) -> Result<(), String> {
        self.client.request("detach", json!({ "sessionId": id }))?;
        Ok(())
    }

    pub fn kill(&self, id: &str) {
        let _ = self.client.request("killSession", json!({ "sessionId": id }));
        if let Ok(mut contexts) = self.contexts.lock() {
            contexts.remove(id);
        }
    }

    pub fn kill_context(&self, context_id: &str) {
        let sessions = self.client.request("listSessions", json!([]));
        if let Ok(value) = sessions {
            if let Ok(items) = serde_json::from_value::<Vec<SessionInfo>>(value) {
                for item in items.into_iter().filter(|item| item.context_id == context_id) {
                    self.kill(&item.session_id);
                }
                return;
            }
        }
        let ids = self
            .contexts
            .lock()
            .ok()
            .map(|contexts| {
                contexts
                    .iter()
                    .filter(|(_, value)| value.as_str() == context_id)
                    .map(|(id, _)| id.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for id in ids {
            self.kill(&id);
        }
    }
}

struct DaemonClient {
    stream: Mutex<UnixStream>,
    pending: Arc<Mutex<HashMap<String, Arc<(Mutex<Option<Result<Value, String>>>, Condvar)>>>>,
    next_id: AtomicU64,
}

impl DaemonClient {
    fn connect_or_start(app: &AppHandle, app_data_dir: &Path) -> Result<Self, String> {
        let socket_path = app_data_dir.join("terminal-daemon.sock");
        let token_path = app_data_dir.join("terminal-daemon.token");
        fs::create_dir_all(app_data_dir).map_err(|err| format!("无法创建终端 daemon 目录：{err}"))?;
        let mut token = fs::read_to_string(&token_path).unwrap_or_default();
        token.truncate(token.trim_end_matches(['\r', '\n']).len());

        let stream = match connect_and_auth(&socket_path, &token) {
            Ok(stream) => stream,
            Err(_) => {
                if token.is_empty() {
                    token = Uuid::new_v4().to_string();
                    write_token(&token_path, &token)?;
                }
                let executable = std::env::current_exe()
                    .map_err(|err| format!("无法定位终端 daemon：{err}"))?;
                Command::new(executable)
                    .args([
                        "--terminal-daemon",
                        "--socket",
                        socket_path.to_string_lossy().as_ref(),
                        "--token",
                        token.as_str(),
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|err| format!("无法启动终端 daemon：{err}"))?;

                let mut connected = None;
                for _ in 0..60 {
                    if let Ok(stream) = connect_and_auth(&socket_path, &token) {
                        connected = Some(stream);
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                connected.ok_or_else(|| "终端 daemon 启动超时".to_string())?
            }
        };
        let client = Self {
            stream: Mutex::new(stream),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        };
        client.start_reader(app.clone())?;
        Ok(client)
    }

    fn start_reader(&self, app: AppHandle) -> Result<(), String> {
        let reader = self
            .stream
            .lock()
            .map_err(|_| "终端连接锁损坏".to_string())?
            .try_clone()
            .map_err(|err| format!("无法读取终端 daemon：{err}"))?;
        let pending = self.pending.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let Ok(message) = serde_json::from_str::<WireMessage>(&line) else {
                            continue;
                        };
                        match message {
                            WireMessage::Response { id, ok, result, error, .. } => {
                                if let Ok(mut pending) = pending.lock() {
                                    if let Some(waiter) = pending.remove(&id) {
                                        let (lock, signal) = &*waiter;
                                        if let Ok(mut value) = lock.lock() {
                                            *value = Some(if ok {
                                                Ok(result.unwrap_or(Value::Null))
                                            } else {
                                                Err(error.unwrap_or_else(|| "终端 daemon 请求失败".into()))
                                            });
                                            signal.notify_one();
                                        }
                                    }
                                }
                            }
                            WireMessage::Event { event, session_id, data, .. } => {
                                if event == "ptyData" {
                                    let bytes = data.unwrap_or_default();
                                    let _ = app.emit(
                                        "pty-data",
                                        PtyDataEvent {
                                            id: session_id,
                                            data: String::from_utf8_lossy(&bytes).into_owned(),
                                        },
                                    );
                                } else if event == "ptyExit" {
                                    let _ = app.emit("pty-exit", PtyExitEvent { id: session_id });
                                }
                            }
                            WireMessage::Request { .. } => {}
                        }
                    }
                }
            }
            if let Ok(mut pending) = pending.lock() {
                for (_, waiter) in pending.drain() {
                    let (lock, signal) = &*waiter;
                    if let Ok(mut value) = lock.lock() {
                        *value = Some(Err("终端 daemon 连接已断开".into()));
                        signal.notify_one();
                    }
                }
            }
        });
        Ok(())
    }

    fn open(
        &self,
        session_id: &str,
        context_id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<AttachResult, String> {
        let result = self.request(
            "createSession",
            json!({
                "sessionId": session_id,
                "contextId": context_id,
                "cwd": cwd.to_string_lossy(),
                "cols": cols.max(1),
                "rows": rows.max(1),
            }),
        )?;
        let is_new = result
            .get("isNew")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let attached = self.request("attachSession", json!({ "sessionId": session_id }))?;
        let mut attach = serde_json::from_value::<AttachResult>(attached)
            .map_err(|err| format!("终端 daemon 返回格式错误：{err}"))?;
        attach.is_new = is_new;
        Ok(attach)
    }

    /// Send a daemon command without waiting for its response (Orca-style keystroke path).
    fn notify(&self, command: &str, payload: Value) -> Result<(), String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let message = WireMessage::Request {
            version: PROTOCOL_VERSION,
            id,
            command: command.to_string(),
            token: None,
            payload,
        };
        let encoded = serde_json::to_vec(&message).map_err(|err| format!("无法编码终端请求：{err}"))?;
        let mut stream = self.stream.lock().map_err(|_| "终端连接锁损坏".to_string())?;
        stream
            .write_all(&encoded)
            .map_err(|err| format!("无法发送终端请求：{err}"))?;
        stream
            .write_all(b"\n")
            .map_err(|err| format!("无法发送终端请求：{err}"))?;
        stream
            .flush()
            .map_err(|err| format!("无法发送终端请求：{err}"))
    }

    fn request(&self, command: &str, payload: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let waiter = Arc::new((Mutex::new(None), Condvar::new()));
        self.pending
            .lock()
            .map_err(|_| "终端请求锁损坏".to_string())?
            .insert(id.clone(), waiter.clone());
        let message = WireMessage::Request {
            version: PROTOCOL_VERSION,
            id: id.clone(),
            command: command.to_string(),
            token: None,
            payload,
        };
        let encoded = serde_json::to_vec(&message).map_err(|err| format!("无法编码终端请求：{err}"))?;
        let write_result = (|| {
            let mut stream = self.stream.lock().map_err(|_| "终端连接锁损坏".to_string())?;
            stream.write_all(&encoded).map_err(|err| format!("无法发送终端请求：{err}"))?;
            stream.write_all(b"\n").map_err(|err| format!("无法发送终端请求：{err}"))?;
            stream.flush().map_err(|err| format!("无法发送终端请求：{err}"))
        })();
        if let Err(error) = write_result {
            self.pending.lock().ok().map(|mut pending| pending.remove(&id));
            return Err(error);
        }
        let (lock, signal) = &*waiter;
        let mut result = lock.lock().map_err(|_| "终端请求锁损坏".to_string())?;
        while result.is_none() {
            result = signal
                .wait(result)
                .map_err(|_| "终端请求锁损坏".to_string())?;
        }
        result.take().unwrap_or_else(|| Err("终端 daemon 未返回结果".into()))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataEvent {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    id: String,
}

fn connect_and_auth(socket_path: &Path, token: &str) -> Result<UnixStream, String> {
    let mut stream = UnixStream::connect(socket_path).map_err(|err| err.to_string())?;
    let request = WireMessage::Request {
        version: PROTOCOL_VERSION,
        id: "hello".into(),
        command: "hello".into(),
        token: Some(token.to_string()),
        payload: json!({}),
    };
    let data = serde_json::to_vec(&request).map_err(|err| err.to_string())?;
    stream.write_all(&data).map_err(|err| err.to_string())?;
    stream.write_all(b"\n").map_err(|err| err.to_string())?;
    stream.flush().map_err(|err| err.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|err| err.to_string())?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|err| err.to_string())?;
    let WireMessage::Response { ok: true, .. } = serde_json::from_str(&line).map_err(|err| err.to_string())? else {
        return Err("终端 daemon 身份校验失败".into());
    };
    Ok(stream)
}

fn write_token(path: &Path, token: &str) -> Result<(), String> {
    fs::write(path, token).map_err(|err| format!("无法写入终端 daemon token：{err}"))?;
    let mut permissions = fs::metadata(path)
        .map_err(|err| format!("无法读取终端 daemon token：{err}"))?
        .permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|err| format!("无法保护终端 daemon token：{err}"))
}

struct DaemonSession {
    context_id: String,
    cwd: String,
    cols: Mutex<u16>,
    rows: Mutex<u16>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    pid: Option<u32>,
    alive: AtomicBool,
    history: Mutex<Vec<u8>>,
    subscribers: Mutex<HashMap<u64, mpsc::Sender<WireMessage>>>,
    output_lock: Mutex<()>,
}

struct DaemonState {
    sessions: Mutex<HashMap<String, Arc<DaemonSession>>>,
    next_connection: AtomicU64,
}

pub fn run_terminal_daemon() {
    let args = std::env::args().collect::<Vec<_>>();
    let socket = arg_value(&args, "--socket").unwrap_or_else(|| "/tmp/octopus-terminal.sock".into());
    let token = arg_value(&args, "--token").unwrap_or_default();
    let socket_path = PathBuf::from(socket);
    if socket_path.exists() {
        let _ = fs::remove_file(&socket_path);
    }
    let Some(parent) = socket_path.parent() else { return };
    let _ = fs::create_dir_all(parent);
    let Ok(listener) = UnixListener::bind(&socket_path) else { return };
    let state = Arc::new(DaemonState {
        sessions: Mutex::new(HashMap::new()),
        next_connection: AtomicU64::new(1),
    });
    for stream in listener.incoming().flatten() {
        let state = state.clone();
        let token = token.clone();
        thread::spawn(move || handle_client(stream, &token, state));
    }
    let _ = fs::remove_file(socket_path);
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2).find(|pair| pair[0] == name).map(|pair| pair[1].clone())
}

fn handle_client(stream: UnixStream, token: &str, state: Arc<DaemonState>) {
    let connection_id = state.next_connection.fetch_add(1, Ordering::Relaxed);
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let (outgoing, outgoing_rx) = mpsc::channel::<WireMessage>();
    thread::spawn(move || write_messages(writer, outgoing_rx));
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let authenticated = match read_request(&mut reader, &mut line) {
        Some(WireMessage::Request { id, command, token: provided, .. }) if command == "hello" => {
            if provided.as_deref() == Some(token) {
                let _ = outgoing.send(WireMessage::response(id, Ok(json!({ "version": PROTOCOL_VERSION }))));
                true
            } else {
                let _ = outgoing.send(WireMessage::response(id, Err("终端 daemon 身份校验失败".into())));
                false
            }
        }
        _ => false,
    };
    if !authenticated {
        return;
    }
    while let Some(message) = read_request(&mut reader, &mut line) {
        let WireMessage::Request { id, command, payload, .. } = message else { continue };
        let result = handle_request(&command, payload, connection_id, &outgoing, &state);
        if outgoing.send(WireMessage::response(id, result)).is_err() {
            break;
        }
    }
    detach_connection(connection_id, &state);
}

fn read_request(reader: &mut BufReader<UnixStream>, line: &mut String) -> Option<WireMessage> {
    line.clear();
    if reader.read_line(line).ok()? == 0 {
        return None;
    }
    serde_json::from_str(line).ok()
}

fn write_messages(mut stream: UnixStream, receiver: mpsc::Receiver<WireMessage>) {
    for message in receiver {
        let Ok(data) = serde_json::to_vec(&message) else { break };
        if stream.write_all(&data).is_err() || stream.write_all(b"\n").is_err() || stream.flush().is_err() {
            break;
        }
    }
}

fn handle_request(
    command: &str,
    payload: Value,
    connection_id: u64,
    outgoing: &mpsc::Sender<WireMessage>,
    state: &Arc<DaemonState>,
) -> Result<Value, String> {
    match command {
        "createSession" => {
            let session_id = string_field(&payload, "sessionId")?;
            let context_id = string_field(&payload, "contextId")?;
            let cwd = string_field(&payload, "cwd")?;
            let cols = number_field(&payload, "cols");
            let rows = number_field(&payload, "rows");
            let mut sessions = state.sessions.lock().map_err(|_| "终端状态锁损坏".to_string())?;
            if let Some(existing) = sessions.get(&session_id) {
                if existing.alive.load(Ordering::Acquire) {
                    return Ok(json!({ "isNew": false }));
                }
            }
            let session = spawn_session(session_id.clone(), context_id, cwd, cols, rows)?;
            sessions.insert(session_id, session);
            Ok(json!({ "isNew": true }))
        }
        "attachSession" => {
            let session_id = string_field(&payload, "sessionId")?;
            let session = state
                .sessions
                .lock()
                .map_err(|_| "终端状态锁损坏".to_string())?
                .get(&session_id)
                .cloned()
                .ok_or_else(|| "终端会话不存在".to_string())?;
            let _output_guard = session
                .output_lock
                .lock()
                .map_err(|_| "终端输出锁损坏".to_string())?;
            let cols = *session.cols.lock().map_err(|_| "终端状态锁损坏".to_string())?;
            let rows = *session.rows.lock().map_err(|_| "终端状态锁损坏".to_string())?;
            let history = session.history.lock().map_err(|_| "终端历史锁损坏".to_string())?;
            session
                .subscribers
                .lock()
                .map_err(|_| "终端订阅锁损坏".to_string())?
                .insert(connection_id, outgoing.clone());
            Ok(json!(AttachResult {
                session_id,
                is_new: false,
                recovery: if session.alive.load(Ordering::Acquire) { "warm".into() } else { "fresh".into() },
                scrollback_ansi: String::from_utf8_lossy(&history).into_owned(),
                cols,
                rows,
                cwd: session.cwd.clone(),
            }))
        }
        "detach" => {
            let session_id = string_field(&payload, "sessionId")?;
            if let Some(session) = state.sessions.lock().ok().and_then(|sessions| sessions.get(&session_id).cloned()) {
                let _ = session.subscribers.lock().map(|mut subscribers| subscribers.remove(&connection_id));
            }
            Ok(Value::Null)
        }
        "write" => {
            let session = find_session(state, &payload)?;
            if !session.alive.load(Ordering::Acquire) {
                return Err("终端进程已结束".into());
            }
            let data = string_field(&payload, "data")?;
            let mut writer = session.writer.lock().map_err(|_| "终端写入锁损坏".to_string())?;
            writer.write_all(data.as_bytes()).map_err(|err| format!("无法写入终端：{err}"))?;
            writer.flush().map_err(|err| format!("无法写入终端：{err}"))?;
            Ok(Value::Null)
        }
        "resize" => {
            let session = find_session(state, &payload)?;
            let cols = number_field(&payload, "cols");
            let rows = number_field(&payload, "rows");
            session.master.lock().map_err(|_| "终端状态锁损坏".to_string())?.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|err| format!("无法调整终端大小：{err}"))?;
            *session.cols.lock().map_err(|_| "终端状态锁损坏".to_string())? = cols;
            *session.rows.lock().map_err(|_| "终端状态锁损坏".to_string())? = rows;
            Ok(Value::Null)
        }
        "killSession" => {
            let session_id = string_field(&payload, "sessionId")?;
            let session = state.sessions.lock().ok().and_then(|mut sessions| sessions.remove(&session_id));
            if let Some(session) = session {
                terminate(session.pid);
            }
            Ok(Value::Null)
        }
        "listSessions" => {
            let sessions = state.sessions.lock().map_err(|_| "终端状态锁损坏".to_string())?;
            let items = sessions.iter().map(|(session_id, session)| SessionInfo {
                session_id: session_id.clone(),
                context_id: session.context_id.clone(),
                alive: session.alive.load(Ordering::Acquire),
            }).collect::<Vec<_>>();
            serde_json::to_value(items).map_err(|err| format!("无法编码终端列表：{err}"))
        }
        _ => Err(format!("未知终端命令：{command}")),
    }
}

fn find_session(state: &Arc<DaemonState>, payload: &Value) -> Result<Arc<DaemonSession>, String> {
    let session_id = string_field(payload, "sessionId")?;
    state
        .sessions
        .lock()
        .map_err(|_| "终端状态锁损坏".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "终端会话不存在".into())
}

fn spawn_session(
    session_id: String,
    context_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<Arc<DaemonSession>, String> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }).map_err(|err| format!("无法创建终端：{err}"))?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut command = CommandBuilder::new(shell);
    command.arg("-l");
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(command).map_err(|err| format!("无法启动登录壳：{err}"))?;
    let reader = pair.master.try_clone_reader().map_err(|err| format!("无法读取终端：{err}"))?;
    let writer = pair.master.take_writer().map_err(|err| format!("无法写入终端：{err}"))?;
    let session = Arc::new(DaemonSession {
        context_id,
        cwd,
        cols: Mutex::new(cols.max(1)),
        rows: Mutex::new(rows.max(1)),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        pid: child.process_id(),
        alive: AtomicBool::new(true),
        history: Mutex::new(Vec::new()),
        subscribers: Mutex::new(HashMap::new()),
        output_lock: Mutex::new(()),
    });
    let reader_session = session.clone();
    let reader_id = session_id.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096];
        loop {
            match std::io::Read::read(&mut reader, &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let _output_guard = reader_session.output_lock.lock();
                    if let Ok(mut history) = reader_session.history.lock() {
                        history.extend_from_slice(&buffer[..size]);
                        if history.len() > MAX_HISTORY {
                            let excess = history.len() - MAX_HISTORY;
                            history.drain(..excess);
                        }
                    }
                    let event = WireMessage::Event { version: PROTOCOL_VERSION, event: "ptyData".into(), session_id: reader_id.clone(), data: Some(buffer[..size].to_vec()) };
                    if let Ok(subscribers) = reader_session.subscribers.lock() {
                        for sender in subscribers.values() {
                            let _ = sender.send(clone_event(&event));
                        }
                    }
                }
            }
        }
    });
    let exit_session = session.clone();
    thread::spawn(move || {
        let _ = child.wait();
        exit_session.alive.store(false, Ordering::Release);
        let event = WireMessage::Event { version: PROTOCOL_VERSION, event: "ptyExit".into(), session_id, data: None };
        if let Ok(subscribers) = exit_session.subscribers.lock() {
            for sender in subscribers.values() {
                let _ = sender.send(clone_event(&event));
            }
        }
    });
    Ok(session)
}

fn clone_event(event: &WireMessage) -> WireMessage {
    match event {
        WireMessage::Event { version, event, session_id, data } => WireMessage::Event { version: *version, event: event.clone(), session_id: session_id.clone(), data: data.clone() },
        _ => unreachable!(),
    }
}

fn detach_connection(connection_id: u64, state: &Arc<DaemonState>) {
    if let Ok(sessions) = state.sessions.lock() {
        for session in sessions.values() {
            if let Ok(mut subscribers) = session.subscribers.lock() {
                subscribers.remove(&connection_id);
            }
        }
    }
}

fn string_field(payload: &Value, field: &str) -> Result<String, String> {
    payload.get(field).and_then(Value::as_str).map(ToOwned::to_owned).ok_or_else(|| format!("终端请求缺少 {field}"))
}

fn number_field(payload: &Value, field: &str) -> u16 {
    payload.get(field).and_then(Value::as_u64).unwrap_or(1).clamp(1, u16::MAX as u64) as u16
}

fn terminate(pid: Option<u32>) {
    if let Some(pid) = pid {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}
