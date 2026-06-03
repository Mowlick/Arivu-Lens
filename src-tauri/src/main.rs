#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Listener};
use tauri_plugin_shell::ShellExt;
use std::sync::{Arc, Mutex};

fn start_backend_sidecar(app: &AppHandle) {
    let shell = app.shell();
    
    // Spawns the registered sidecar "compi-backend"
    match shell.sidecar("compi-backend") {
        Ok(command) => {
            let command = command
                .env("ARIVU_PRODUCTION", "TRUE")
                .env("PORT", "11411");
            match command.spawn() {
                Ok((mut rx, child)) => {
                    let child_arc = Arc::new(Mutex::new(Some(child)));
                    
                    // Listen for exit to kill the sidecar cleanly
                    let child_exit_clone = child_arc.clone();
                    app.listen("tauri://exit", move |_| {
                        if let Some(child) = child_exit_clone.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    });
                    
                    let child_destroy_clone = child_arc.clone();
                    app.listen("tauri://destroyed", move |_| {
                        if let Some(child) = child_destroy_clone.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    });

                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                    println!("Backend Sidecar: {}", String::from_utf8_lossy(&line));
                                }
                                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                    eprintln!("Backend Sidecar Error: {}", String::from_utf8_lossy(&line));
                                }
                                _ => {}
                            }
                        }
                    });
                }
                Err(err) => {
                    eprintln!("Failed to spawn backend sidecar: {}. Ensure PyInstaller sidecar binary is compiled.", err);
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to locate backend sidecar: {}. Running without sidecar process.", err);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Spawns the sidecar if not running in tests
            start_backend_sidecar(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
