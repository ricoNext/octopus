#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--terminal-daemon") {
        octopus_lib::run_terminal_daemon();
        return;
    }
    octopus_lib::run()
}
