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

fn main() {
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

