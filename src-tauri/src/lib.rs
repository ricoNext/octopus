mod commands;
mod git;
mod models;
mod paths;
mod pty;
mod store;
mod workspace;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::Emitter;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::init_state(app.handle()).map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;

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
        ])
        .build(tauri::generate_context!())
        .expect("启动应用失败")
        .run(|_, _| {});
}

pub fn run_terminal_daemon() {
    pty::run_terminal_daemon();
}
