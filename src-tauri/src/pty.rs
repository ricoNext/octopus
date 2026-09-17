use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Box<dyn MasterPty + Send>,
    pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataEvent {
    id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    id: String,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn open(
        &self,
        app: AppHandle,
        id: String,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<bool, String> {
        {
            let sessions = self.sessions.lock().map_err(|_| "终端状态锁损坏".to_string())?;
            if sessions.contains_key(&id) {
                return Ok(true);
            }
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("无法创建终端：{err}"))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|err| format!("无法启动登录壳：{err}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|err| format!("无法读取终端：{err}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|err| format!("无法写入终端：{err}"))?;
        let pid = child.process_id();

        {
            let mut sessions = self.sessions.lock().map_err(|_| "终端状态锁损坏".to_string())?;
            sessions.insert(
                id.clone(),
                PtySession {
                    writer: Mutex::new(writer),
                    master: pair.master,
                    pid,
                },
            );
        }

        let emit_id = id.clone();
        let app_data = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = app_data.emit(
                            "pty-data",
                            PtyDataEvent {
                                id: emit_id.clone(),
                                data: buf[..n].to_vec(),
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });

        let wait_id = id.clone();
        let wait_sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            if let Ok(mut sessions) = wait_sessions.lock() {
                sessions.remove(&wait_id);
            }
            let _ = app.emit("pty-exit", PtyExitEvent { id: wait_id });
        });

        Ok(false)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "终端状态锁损坏".to_string())?;
        let session = sessions.get(id).ok_or_else(|| "终端未打开".to_string())?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "终端写入锁损坏".to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|err| format!("无法写入终端：{err}"))?;
        writer.flush().map_err(|err| format!("无法写入终端：{err}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "终端状态锁损坏".to_string())?;
        let session = sessions.get(id).ok_or_else(|| "终端未打开".to_string())?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("无法调整终端大小：{err}"))
    }

    pub fn kill(&self, id: &str) {
        let mut sessions = match self.sessions.lock() {
            Ok(sessions) => sessions,
            Err(_) => return,
        };
        if let Some(session) = sessions.remove(id) {
            if let Some(pid) = session.pid {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status();
            }
        }
    }

    pub fn kill_all(&self) {
        let mut sessions = match self.sessions.lock() {
            Ok(sessions) => sessions,
            Err(_) => return,
        };
        for (_, session) in sessions.drain() {
            if let Some(pid) = session.pid {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status();
            }
        }
    }
}
