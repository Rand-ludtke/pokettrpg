// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod sync;

use std::sync::Mutex;
use sync::fusion::FusionSpriteIndex;
use sync::state::create_sync_state;
use sync::websocket::{start_websocket_manager, WebSocketConfig};
use sync::commands::{
    get_fusion_variants,
    request_fusion_variants,
    select_fusion_sprite,
    get_fusion_state,
    set_fusion_custom_sprite,
    get_sync_status,
    set_sync_endpoint,
    build_sprite_index,
    calculate_fusion_stats,
    build_sprite_url,
    set_sync_identity,
};

/// Clear stale WebView2 cache when the app version changes.
/// This preserves localStorage/IndexedDB (user data) but removes compiled
/// JS bytecode and HTTP caches that cause breakage after upgrades.
fn clear_webview_cache_on_upgrade(app_version: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::fs;
        use std::path::PathBuf;

        let local_app_data = match std::env::var("LOCALAPPDATA") {
            Ok(v) => PathBuf::from(v),
            Err(_) => return,
        };

        let data_dir = local_app_data.join("com.pokettrpg.desktop");
        let version_file = data_dir.join(".app_version");

        // Read stored version
        let stored_version = fs::read_to_string(&version_file).unwrap_or_default();

        if stored_version.trim() != app_version {
            // Version changed — clear WebView2 caches
            let webview_default = data_dir.join("EBWebView").join("Default");
            let cache_dirs = ["Cache", "Code Cache", "GPUCache", "Service Worker"];

            for dir_name in &cache_dirs {
                let cache_path = webview_default.join(dir_name);
                if cache_path.exists() {
                    let _ = fs::remove_dir_all(&cache_path);
                }
            }

            // Write current version
            let _ = fs::create_dir_all(&data_dir);
            let _ = fs::write(&version_file, app_version);

            eprintln!(
                "Cleared WebView2 cache for upgrade: {} -> {}",
                stored_version.trim(),
                app_version
            );
        }
    }
}

fn main() {
    // Clear stale WebView2 cache before the window opens
    let app_version = env!("CARGO_PKG_VERSION");
    clear_webview_cache_on_upgrade(app_version);

    tauri::Builder::default()
        .setup(|app| {
            // Initialize logging plugin
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
            // Initialize sync state (Source of Truth)
            let sync_state = create_sync_state();
            app.manage(sync_state);
            
            // Initialize fusion sprite index
            let sprite_index = Mutex::new(FusionSpriteIndex::new("", ""));
            app.manage(sprite_index);
            
            // Start WebSocket manager for Pi connectivity
            // This runs in background and emits "sync-event" when state changes
            let ws_config = WebSocketConfig::default();
            let ws_sender = start_websocket_manager(app.handle().clone(), ws_config);
            app.manage(ws_sender);
            
            log::info!("Pokettrpg app initialized with Rust sync layer");
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Fusion commands
            get_fusion_variants,
            request_fusion_variants,
            select_fusion_sprite,
            get_fusion_state,
            set_fusion_custom_sprite,
            calculate_fusion_stats,
            build_sprite_url,
            build_sprite_index,
            // Sync commands
            get_sync_status,
            set_sync_endpoint,
            set_sync_identity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

