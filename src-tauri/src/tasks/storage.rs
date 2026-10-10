use super::Task;
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::{
        fd::AsRawFd,
        unix::fs::{OpenOptionsExt, PermissionsExt},
    },
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())
}

pub fn task_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "无效的任务标识")?;
    Ok(root.join(id))
}

pub fn lock(path: &Path, nonblock: bool) -> Result<Option<File>, String> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    let flags = libc::LOCK_EX | if nonblock { libc::LOCK_NB } else { 0 };
    if unsafe { libc::flock(file.as_raw_fd(), flags) } != 0 {
        let e = std::io::Error::last_os_error();
        if e.kind() == std::io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        return Err(e.to_string());
    }
    Ok(Some(file))
}

pub fn worker_alive(dir: &Path) -> Result<bool, String> {
    Ok(lock(&dir.join("worker.lock"), true)?.is_none())
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(
        &fs::read(path).map_err(|e| format!("无法读取 {}：{e}", path.display()))?,
    )
    .map_err(|e| format!("无法解析 {}：{e}", path.display()))
}

pub fn create(root: &Path, task: &Task) -> Result<(), String> {
    let dir = task_dir(root, &task.id)?;
    private_dir(&dir)?;
    write_json(&dir.join("task.json"), task)
}

pub fn edit(
    root: &Path,
    id: &str,
    f: impl FnOnce(&mut Task) -> Result<(), String>,
) -> Result<Task, String> {
    let dir = task_dir(root, id)?;
    let _lock = lock(&dir.join("state.lock"), false)?;
    let path = dir.join("task.json");
    let mut task: Task = read_json(&path)?;
    let before = serde_json::to_vec(&task).map_err(|e| e.to_string())?;
    f(&mut task)?;
    if serde_json::to_vec(&task).map_err(|e| e.to_string())? != before {
        write_json(&path, &task)?;
    }
    Ok(task)
}
