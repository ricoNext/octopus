use super::*;

pub fn sample_task(directory: &str) -> Task {
    Task {
        id: Uuid::new_v4().to_string(),
        input: TaskInput {
            title: "测试任务".into(),
            description: "实现目标".into(),
            acceptance: "验证通过".into(),
            constraints: "保留已有文件".into(),
            agent_id: "codex".into(),
            directories: vec![directory.into()],
            primary_directory: directory.into(),
        },
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
    }
}

#[test]
fn validates_arbitrary_directories_primary_and_disabled_agent() {
    let dir = tempfile::tempdir().unwrap();
    let mut input = sample_task(dir.path().to_str().unwrap()).input;
    let mut settings = agent_catalog::AgentUserSettings::default();
    assert!(validate(&mut input, &settings).is_ok());
    settings.disabled_agents.push("codex".into());
    assert!(validate(&mut input, &settings).is_err());
    settings.disabled_agents.clear();
    input.primary_directory = "/".into();
    assert!(validate(&mut input, &settings).is_err());
}

#[test]
fn storage_serializes_concurrent_messages_and_rejects_path_traversal() {
    let dir = tempfile::tempdir().unwrap();
    let task = sample_task(dir.path().to_str().unwrap());
    storage::create(dir.path(), &task).unwrap();
    let workers: Vec<_> = (0..8)
        .map(|i| {
            let root = dir.path().to_path_buf();
            let id = task.id.clone();
            std::thread::spawn(move || {
                storage::edit(&root, &id, |t| {
                    t.message("user", format!("消息 {i}"));
                    Ok(())
                })
                .unwrap()
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(
        storage::edit(dir.path(), &task.id, |_| Ok(()))
            .unwrap()
            .messages
            .len(),
        8
    );
    assert!(storage::task_dir(dir.path(), "../escape").is_err());
}

#[test]
fn stale_execution_becomes_failed_without_touching_live_worker() {
    let dir = tempfile::tempdir().unwrap();
    let manager = TaskManager::new(dir.path().to_path_buf()).unwrap();
    let mut task = sample_task(dir.path().to_str().unwrap());
    task.phase = "running".into();
    task.executions.push(Execution {
        id: "run".into(),
        started_at: 0,
        ended_at: None,
        outcome: None,
    });
    storage::create(dir.path(), &task).unwrap();
    let recovered = manager.list().unwrap();
    assert_eq!(recovered[0].reason.as_deref(), Some("failed"));
}
