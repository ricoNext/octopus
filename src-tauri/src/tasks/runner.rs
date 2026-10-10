use super::{changes, now, storage, Launch, Task};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

struct RunningChild(std::process::Child);
impl std::ops::Deref for RunningChild {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for RunningChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for RunningChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            unsafe {
                libc::kill(-(self.0.id() as i32), libc::SIGKILL);
            }
            let _ = self.0.wait();
        }
    }
}

fn schema() -> Value {
    json!({"type":"object","properties":{"status":{"type":"string","enum":["needs_input","review"]},"message":{"type":"string"}},"required":["status","message"],"additionalProperties":false})
}

fn prompt(task: &Task) -> String {
    let messages = task
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| m.text.clone())
        .collect::<Vec<_>>();
    format!("你正在 Octopus 中执行开发任务。请用中文交流。\n标题：{}\n目标：{}\n验收标准：{}\n约束：{}\n主工作目录：{}\n关联可读写目录：{}\n只修改关联目录中的工作文件。不要自行提交、发布或合并，除非任务要求。需要用户澄清时，不要猜测或调用交互式提问工具，以结构化结果 status=needs_input、message=具体问题结束本轮。工作完成后，以 status=review、message=结果摘要和验证情况结束本轮，等待用户验收，不要宣称已经通过人工验收。所有最终结果必须符合指定 JSON 格式。\n本轮补充要求：\n{}",
        task.input.title, task.input.description, task.input.acceptance, task.input.constraints, task.input.primary_directory, task.input.directories.join("\n"),
        if messages.is_empty() { "请继续完成任务。".into() } else { format!("以下是按时间顺序保存的全部补充要求，后续修正优先：\n{}", messages.join("\n\n")) })
}

fn command(task: &Task, launch: &Launch, dir: &Path) -> Result<Command, String> {
    let mut cmd = Command::new(&launch.cmd);
    cmd.args(&launch.args)
        .envs(&launch.env)
        .current_dir(&task.input.primary_directory);
    if task.input.agent_id == "codex" {
        let roots = serde_json::to_string(&task.input.directories).map_err(|e| e.to_string())?;
        cmd.args([
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"workspace-write\"",
            "-c",
            &format!("sandbox_workspace_write.writable_roots={roots}"),
            "exec",
        ]);
        if let Some(session) = &task.session_id {
            cmd.arg("resume").arg(session);
        }
        cmd.args(["--json", "--skip-git-repo-check", "--output-schema"])
            .arg(dir.join("schema.json"))
            .arg("-");
    } else if task.input.agent_id == "codebuddy" {
        cmd.args([
            "--print",
            "--verbose",
            "--output-format",
            "stream-json",
            "--permission-mode",
            "acceptEdits",
            "--json-schema",
            &schema().to_string(),
        ]);
        if let Some(session) = &task.session_id {
            cmd.arg("--resume").arg(session);
        }
        for path in &task.input.directories {
            if path != &task.input.primary_directory {
                cmd.arg("--add-dir").arg(path);
            }
        }
    } else {
        return Err("此 Agent 尚未提供任务执行适配器".into());
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    Ok(cmd)
}

#[derive(Default)]
struct Parsed {
    session: Option<String>,
    message: Option<String>,
    result: Option<Value>,
    error: Option<String>,
}

fn parse(line: &str, agent: &str) -> Parsed {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return Parsed::default();
    };
    let mut out = Parsed::default();
    if agent == "codex" {
        match v["type"].as_str().unwrap_or("") {
            "thread.started" => {
                out.session = v["thread_id"].as_str().map(str::to_string);
            }
            "item.completed" => {
                let item = &v["item"];
                if item["type"] == "agent_message" {
                    if let Some(text) = item["text"].as_str() {
                        if let Ok(result) = serde_json::from_str::<Value>(text) {
                            if valid_result(&result) {
                                out.result = Some(result);
                            }
                        }
                        if out.result.is_none() {
                            out.message = Some(text.into());
                        }
                    }
                } else if item["type"] == "command_execution" {
                    out.message = Some(format!(
                        "执行命令：{}\n退出码：{}",
                        item["command"].as_str().unwrap_or(""),
                        item["exit_code"]
                    ));
                } else if item["type"] == "file_change" {
                    out.message = Some(format!("文件更新：{}", item["changes"]));
                }
            }
            "turn.failed" => {
                out.error = Some(
                    v["error"]["message"]
                        .as_str()
                        .unwrap_or("Agent 执行失败")
                        .into(),
                )
            }
            "error" => out.error = Some(v["message"].as_str().unwrap_or("Agent 返回错误").into()),
            _ => {}
        }
    } else {
        out.session = v["session_id"].as_str().map(str::to_string);
        if v["type"] == "assistant" {
            if let Some(content) = v["message"]["content"].as_array() {
                let text = content
                    .iter()
                    .filter_map(|c| c["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                if !text.is_empty() {
                    out.message = Some(text);
                }
            }
        }
        if v["type"] == "result" {
            if v["is_error"] == true {
                out.error = Some(
                    v["result"]
                        .as_str()
                        .unwrap_or("Agent 执行失败或无法恢复会话")
                        .into(),
                );
            } else if valid_result(&v["structured_output"]) {
                out.result = Some(v["structured_output"].clone());
            } else if let Some(text) = v["result"].as_str() {
                if let Ok(result) = serde_json::from_str::<Value>(text) {
                    if valid_result(&result) {
                        out.result = Some(result);
                    }
                }
            }
        }
    }
    out
}

fn valid_result(v: &Value) -> bool {
    matches!(v["status"].as_str(), Some("needs_input" | "review"))
        && v["message"].as_str().is_some_and(|s| !s.trim().is_empty())
}

fn tail(s: &str, max: usize) -> String {
    let chars: Vec<_> = s.chars().collect();
    chars[chars.len().saturating_sub(max)..].iter().collect()
}

fn execute(root: &Path, id: &str, run_id: &str) -> Result<(), String> {
    let dir = storage::task_dir(root, id)?;
    let mut task = storage::edit(root, id, |_| Ok(()))?;
    if task.run_id.as_deref() != Some(run_id) || task.phase != "running" {
        return Err("执行标识已失效".into());
    }
    changes::ensure_baseline(&dir, &task)?;
    storage::write_json(&dir.join("schema.json"), &schema())?;
    let launch: Launch = storage::read_json(&dir.join("launch.json"))?;
    // 配置含环境变量，读取后立即移除短期传递文件。
    let _ = fs::remove_file(dir.join("launch.json"));
    loop {
        task = storage::edit(root, id, |t| {
            t.pending_messages.clear();
            Ok(())
        })?;
        if task.stop_requested {
            return finish_stopped(root, id, &dir);
        }
        let mut child = RunningChild(
            command(&task, &launch, &dir)?
                .spawn()
                .map_err(|e| format!("无法启动 {}：{e}", task.input.agent_id))?,
        );
        let pid = child.id() as i32;
        if let Some(mut stdin) = child.stdin.take() {
            if let Err(e) = stdin.write_all(prompt(&task).as_bytes()) {
                unsafe {
                    libc::kill(-pid, libc::SIGKILL);
                }
                let _ = child.wait();
                return Err(format!("无法发送任务要求：{e}"));
            }
        }
        storage::edit(root, id, |t| {
            t.message(
                "system",
                "Agent 已启动；执行中的补充要求会在本轮结束后自动接续处理",
            );
            Ok(())
        })?;
        let (tx, rx) = mpsc::channel();
        for (is_error, stream) in [
            (
                false,
                Box::new(child.stdout.take().ok_or("缺少输出流")?) as Box<dyn std::io::Read + Send>,
            ),
            (
                true,
                Box::new(child.stderr.take().ok_or("缺少错误流")?) as Box<dyn std::io::Read + Send>,
            ),
        ] {
            let tx = tx.clone();
            thread::spawn(move || {
                for line in BufReader::new(stream).lines() {
                    match line {
                        Ok(line) => {
                            if tx.send((is_error, line)).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }
        drop(tx);
        let mut result = None;
        let mut failure = None;
        let mut stderr = String::new();
        let mut stopped_at = None;
        let mut exit = None;
        let mut exit_at = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok((is_error, line)) => {
                    if is_error {
                        stderr = tail(&format!("{stderr}\n{line}"), 6000);
                    } else {
                        let parsed = parse(&line, &task.input.agent_id);
                        if parsed.session.is_some() || parsed.message.is_some() {
                            storage::edit(root, id, |t| {
                                if let Some(session) = parsed.session {
                                    t.session_id = Some(session);
                                }
                                if let Some(message) = parsed.message {
                                    t.message("assistant", tail(&message, 16000));
                                }
                                Ok(())
                            })?;
                        }
                        if parsed.result.is_some() {
                            result = parsed.result;
                        }
                        if parsed.error.is_some() {
                            failure = parsed.error;
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if exit.is_some() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(30));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let current: Task = storage::read_json(&dir.join("task.json"))?;
            if current.stop_requested && stopped_at.is_none() {
                unsafe {
                    libc::kill(-pid, libc::SIGTERM);
                }
                stopped_at = Some(Instant::now());
            }
            if stopped_at.is_some_and(|t| t.elapsed() > Duration::from_secs(2)) {
                unsafe {
                    libc::kill(-pid, libc::SIGKILL);
                }
            }
            if exit.is_none() {
                exit = child.try_wait().map_err(|e| e.to_string())?;
                if exit.is_some() {
                    exit_at = Some(Instant::now());
                }
            }
            // 子工具可能继承输出句柄；主进程结束后限制排空等待。
            if exit_at.is_some_and(|t| t.elapsed() > Duration::from_secs(2)) {
                break;
            }
        }
        if stopped_at.is_some() {
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            let _ = child.wait();
            return finish_stopped(root, id, &dir);
        }
        let exit = exit.ok_or("无法读取 Agent 退出状态")?;
        if !exit.success() {
            return Err(format!(
                "Agent 执行或会话恢复失败（{}）：{}",
                exit.code()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "被信号终止".into()),
                failure.unwrap_or(stderr)
            ));
        }
        let result = result.ok_or_else(|| {
            failure.unwrap_or_else(|| {
                format!(
                    "Agent 未返回有效的任务结果，任务不会自动完成。{}",
                    tail(&stderr, 2000)
                )
            })
        })?;
        let message = result["message"].as_str().unwrap_or("").to_string();
        let current = storage::edit(root, id, |t| {
            t.message("assistant", &message);
            Ok(())
        })?;
        if current.stop_requested {
            return finish_stopped(root, id, &dir);
        }
        if !current.pending_messages.is_empty() {
            if current.session_id.is_none() {
                return Err(
                    "Agent 未提供可恢复的会话标识，无法自动接续补充要求；消息已保留".into(),
                );
            }
            continue;
        }
        let diff = changes::collect(&dir, &current);
        let mut continue_pending = false;
        storage::edit(root, id, |t| {
            if !t.pending_messages.is_empty() {
                continue_pending = true;
                return Ok(());
            }
            if t.stop_requested {
                t.attention("stopped", None);
            } else if result["status"] == "needs_input" {
                t.attention("waiting", None);
            } else {
                t.phase = "review".into();
                t.reason = None;
                t.summary = Some(message);
            }
            apply_diff(t, diff);
            end_run(t);
            Ok(())
        })?;
        if continue_pending {
            continue;
        }
        return Ok(());
    }
}

fn apply_diff(task: &mut Task, diff: Result<(Vec<changes::FileChange>, Vec<String>), String>) {
    match diff {
        Ok((changes, notices)) => {
            task.changes = changes;
            task.change_notices = notices;
        }
        Err(e) => {
            task.change_notices = vec![format!("本轮差异收集失败，已有差异可能过时：{e}")];
        }
    }
}
fn end_run(task: &mut Task) {
    if let Some(run) = task.executions.last_mut() {
        run.ended_at = Some(now());
        run.outcome = Some(task.reason.clone().unwrap_or_else(|| task.phase.clone()));
    }
    task.updated_at = now();
}
fn finish_stopped(root: &Path, id: &str, dir: &Path) -> Result<(), String> {
    let task: Task = storage::read_json(&dir.join("task.json"))?;
    let diff = changes::collect(dir, &task);
    storage::edit(root, id, |t| {
        t.attention("stopped", None);
        t.stop_requested = false;
        apply_diff(t, diff);
        end_run(t);
        t.message("system", "执行已停止，已保留对话和文件修改");
        Ok(())
    })?;
    Ok(())
}

pub fn run_worker(root: &Path, id: &str, run_id: &str) {
    let Ok(dir) = storage::task_dir(root, id) else {
        return;
    };
    let Ok(Some(_worker_lock)) = storage::lock(&dir.join("worker.lock"), true) else {
        return;
    };
    if let Err(error) = execute(root, id, run_id) {
        let _ = storage::edit(root, id, |t| {
            if t.run_id.as_deref() == Some(run_id) {
                t.attention("failed", Some(error.clone()));
                end_run(t);
                t.message("system", error);
            }
            Ok(())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_questions_results_and_sessions_without_using_exit_as_completion() {
        assert_eq!(
            parse(
                r#"{"type":"thread.started","thread_id":"session-1"}"#,
                "codex"
            )
            .session
            .as_deref(),
            Some("session-1")
        );
        let q = json!({"type":"item.completed","item":{"type":"agent_message","text":json!({"status":"needs_input","message":"需要支持哪些版本？"}).to_string()}});
        assert_eq!(
            parse(&q.to_string(), "codex").result.unwrap()["status"],
            "needs_input"
        );
        assert!(parse(r#"{"type":"turn.completed"}"#, "codex")
            .result
            .is_none());
        let r = json!({"type":"result","session_id":"s","structured_output":{"status":"review","message":"修改完成"}});
        assert_eq!(
            parse(&r.to_string(), "codebuddy").result.unwrap()["status"],
            "review"
        );
        assert!(parse(
            r#"{"type":"result","is_error":true,"result":"恢复失败"}"#,
            "codebuddy"
        )
        .error
        .is_some());
    }

    fn prepare(script: &str, agent: &str) -> (tempfile::TempDir, Task) {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("work");
        fs::create_dir(&work).unwrap();
        let mut task = super::super::tests::sample_task(work.to_str().unwrap());
        task.input.agent_id = agent.into();
        task.phase = "running".into();
        task.started_at = Some(now());
        task.run_id = Some("run-1".into());
        task.executions.push(super::super::Execution {
            id: "run-1".into(),
            started_at: now(),
            ended_at: None,
            outcome: None,
        });
        storage::create(temp.path(), &task).unwrap();
        let dir = storage::task_dir(temp.path(), &task.id).unwrap();
        let script_path = temp.path().join("fixture.sh");
        fs::write(&script_path, script).unwrap();
        storage::write_json(
            &dir.join("launch.json"),
            &Launch {
                cmd: "/bin/sh".into(),
                args: vec![script_path.to_string_lossy().into()],
                env: Default::default(),
            },
        )
        .unwrap();
        (temp, task)
    }

    #[test]
    fn real_worker_collects_changes_and_requires_human_review_for_both_adapters() {
        for (agent, output) in [
            (
                "codex",
                r#"{"type":"thread.started","thread_id":"fixture-session"}
{"type":"item.completed","item":{"type":"agent_message","text":"{\"status\":\"review\",\"message\":\"验证完成\"}"}}"#,
            ),
            (
                "codebuddy",
                r#"{"type":"result","session_id":"fixture-session","structured_output":{"status":"review","message":"验证完成"}}"#,
            ),
        ] {
            let script = format!("cat >/dev/null\nprintf '修改内容' > result.txt\ncat <<'RESULT'\n{output}\nRESULT\n");
            let (temp, task) = prepare(&script, agent);
            run_worker(temp.path(), &task.id, "run-1");
            let task = storage::edit(temp.path(), &task.id, |_| Ok(())).unwrap();
            assert_eq!(task.phase, "review");
            assert_eq!(task.session_id.as_deref(), Some("fixture-session"));
            assert_eq!(task.changes.len(), 1);
            assert_eq!(task.changes[0].after.as_deref(), Some("修改内容"));
            assert!(task.executions[0].ended_at.is_some());
        }
    }

    #[test]
    fn exit_zero_without_result_is_failure_and_question_is_attention() {
        let (temp, task) = prepare("cat >/dev/null\nexit 0\n", "codex");
        run_worker(temp.path(), &task.id, "run-1");
        assert_eq!(
            storage::edit(temp.path(), &task.id, |_| Ok(()))
                .unwrap()
                .reason
                .as_deref(),
            Some("failed")
        );
        let (temp, task) = prepare("cat >/dev/null\nprintf '%s\\n' '{\"type\":\"result\",\"structured_output\":{\"status\":\"needs_input\",\"message\":\"请指定版本\"}}'\n", "codebuddy");
        run_worker(temp.path(), &task.id, "run-1");
        assert_eq!(
            storage::edit(temp.path(), &task.id, |_| Ok(()))
                .unwrap()
                .reason
                .as_deref(),
            Some("waiting")
        );
    }

    #[test]
    fn stop_terminates_process_group_and_preserves_files() {
        let (temp, task) = prepare("cat >/dev/null\nprintf '停止前的修改' > changed.txt\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"recoverable\"}'\nsleep 30\n", "codex");
        let root = temp.path().to_path_buf();
        let id = task.id.clone();
        let worker = thread::spawn(move || run_worker(&root, &id, "run-1"));
        for _ in 0..100 {
            if Path::new(&task.input.primary_directory)
                .join("changed.txt")
                .exists()
            {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        super::super::request_stop(temp.path(), &task.id).unwrap();
        worker.join().unwrap();
        let stopped = storage::edit(temp.path(), &task.id, |_| Ok(())).unwrap();
        assert_eq!(stopped.reason.as_deref(), Some("stopped"));
        assert_eq!(stopped.session_id.as_deref(), Some("recoverable"));
        assert_eq!(stopped.changes[0].after.as_deref(), Some("停止前的修改"));
    }
}
