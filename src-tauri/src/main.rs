#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--task-worker") {
        if args.len() == 5 { octopus_lib::run_task_worker(std::path::Path::new(&args[2]), &args[3], &args[4]); }
        return;
    }
    if std::env::args().any(|arg| arg == "--terminal-daemon") {
        octopus_lib::run_terminal_daemon();
        return;
    }
    octopus_lib::run()
}
