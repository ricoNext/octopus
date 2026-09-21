mod commands;
mod git;
mod models;
mod paths;
mod pty;
mod store;
mod workspace;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            commands::init_state(app.handle()).map_err(|err| err.into())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_snapshot,
            commands::inspect_repo,
            commands::default_worktree_parent,
            commands::add_project,
            commands::create_worktree,
            commands::retry_worktree,
            commands::abandon_worktree,
            commands::delete_worktree,
            commands::remove_missing_worktree,
            commands::remove_project,
            commands::list_local_branches,
            commands::list_branch_options,
            commands::switch_main_branch,
            commands::open_in_editor,
            commands::reveal_in_finder,
            commands::pty_open,
            commands::pty_detach,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("启动应用失败")
        .run(|_, _| {});
}

pub fn run_terminal_daemon() {
    pty::run_terminal_daemon();
}
