mod agent_catalog;
mod agent_settings;
mod agent_detect;
mod commands;
mod dep_link;
mod fs_browser;
mod git;
mod models;
mod paths;
mod pty;
mod store;
mod workspace;
mod tasks;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Emitter, Manager};


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::init_state(app.handle()).map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            tasks::init(app.handle()).map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;

            let split_right = MenuItem::with_id(
                app,
                "terminal-split-right",
                "向右分屏",
                true,
                Some("CmdOrCtrl+D"),
            )?;
            let split_down = MenuItem::with_id(
                app,
                "terminal-split-down",
                "向下分屏",
                true,
                Some("CmdOrCtrl+Shift+D"),
            )?;
            let new_tab = MenuItem::with_id(
                app,
                "terminal-new-tab",
                "新建终端",
                true,
                Some("CmdOrCtrl+T"),
            )?;
            let focus_next = MenuItem::with_id(
                app,
                "terminal-focus-next",
                "下一个窗格",
                true,
                Some("CmdOrCtrl+]"),
            )?;
            let close_pane = MenuItem::with_id(
                app,
                "terminal-close-pane",
                "关闭窗格",
                true,
                Some("CmdOrCtrl+Shift+W"),
            )?;

            let terminal_menu = Submenu::with_id_and_items(
                app,
                "terminal",
                "终端",
                true,
                &[&new_tab, &split_right, &split_down, &focus_next, &close_pane],
            )?;

            let menu = Menu::default(app.handle())?;
            menu.append(&terminal_menu)?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let action = match event.id().as_ref() {
                    "terminal-split-right" => Some("splitRight"),
                    "terminal-split-down" => Some("splitDown"),
                    "terminal-new-tab" => Some("newTerminal"),
                    "terminal-focus-next" => Some("focusNextPane"),
                    "terminal-close-pane" => Some("closePane"),
                    _ => None,
                };
                if let Some(action) = action {
                    let _ = app.emit("octopus://terminal-shortcut", action);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(manager) = window.app_handle().try_state::<tasks::TaskManager>() {
                    if !manager.exit_allowed.load(std::sync::atomic::Ordering::SeqCst) && manager.has_running() {
                        api.prevent_close();
                        let _ = window.emit("tasks-exit-requested", ());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            tasks::tasks_list,
            tasks::tasks_save,
            tasks::tasks_run,
            tasks::tasks_message,
            tasks::tasks_stop,
            tasks::tasks_complete,
            tasks::tasks_labels,
            tasks::tasks_exit,
            commands::load_snapshot,
            commands::inspect_repo,
            commands::default_worktree_parent,
            commands::add_project,
            commands::create_worktree,
            commands::retry_worktree,
            commands::abandon_worktree,
            commands::delete_worktree,
            commands::remove_missing_worktree,
            commands::refresh_project_worktrees,
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
            commands::list_agent_presence,
            commands::agents_get_state,
            commands::agents_save_settings,
            commands::agents_refresh_detection,
            commands::agents_resolve_launch,
            commands::link_worktree_node_modules,
            commands::unlink_worktree_node_modules,
            commands::scan_worktree_node_modules,
            commands::link_worktree_node_modules_batch,
            commands::unlink_worktree_node_modules_batch,
            commands::get_worktree_dep_link_status,
            commands::list_node_modules_link_sources,
            commands::fs_read_dir,
            commands::fs_read_text_file,
            commands::fs_write_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("启动应用失败")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(manager) = app.try_state::<tasks::TaskManager>() {
                    if !manager.exit_allowed.load(std::sync::atomic::Ordering::SeqCst) && manager.has_running() {
                        api.prevent_exit();
                        if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
                        let _ = app.emit("tasks-exit-requested", ());
                    }
                }
            }
        });
}

pub fn run_terminal_daemon() {
    pty::run_terminal_daemon();
}

pub fn run_task_worker(root: &std::path::Path, id: &str, run_id: &str) {
    tasks::run_worker(root, id, run_id);
}
