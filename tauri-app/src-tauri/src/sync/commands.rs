//! Tauri Commands for Fusion and Sync Operations
//! 
//! Exposes Rust functionality to the frontend via Tauri commands.

use crate::sync::fusion::{FusionSpriteIndex, FusionStats, SpriteUrlBuilder};
use crate::sync::state::{ConnectionStatus, FusionSprite, SyncState};
use crate::sync::websocket::{ClientMessage, WsCommand, WsSender};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// Response type for fusion variant queries
#[derive(Debug, Serialize, Deserialize)]
pub struct FusionVariantsResponse {
    pub head_id: u32,
    pub body_id: u32,
    pub variants: Vec<String>,
    pub current_selection: Option<String>,
}

/// Get available sprite variants for a fusion
#[tauri::command]
pub fn get_fusion_variants(
    head_id: u32,
    body_id: u32,
    state: State<SyncState>,
    index: State<Mutex<FusionSpriteIndex>>,
) -> Result<FusionVariantsResponse, String> {
    // First check local index
    let variants = {
        let idx = index.lock().map_err(|e| e.to_string())?;
        idx.get_variant_filenames(head_id, body_id)
    };
    
    // Get current selection from state
    let current_selection = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        let key = format!("{}.{}", head_id, body_id);
        guard.fusion_cache.get(&key).map(|f| f.sprite_file.clone())
    };
    
    Ok(FusionVariantsResponse {
        head_id,
        body_id,
        variants,
        current_selection,
    })
}

/// Request fusion variants from the server (for sprites not in local index)
#[tauri::command]
pub async fn request_fusion_variants(
    head_id: u32,
    body_id: u32,
    ws_sender: State<'_, WsSender>,
) -> Result<(), String> {
    let msg = ClientMessage::GetFusionVariants { head_id, body_id };
    ws_sender.send(WsCommand::Send(msg)).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Select a specific fusion sprite variant
#[tauri::command]
pub async fn select_fusion_sprite(
    head_id: u32,
    body_id: u32,
    sprite_file: String,
    state: State<'_, SyncState>,
    ws_sender: State<'_, WsSender>,
) -> Result<bool, String> {
    // Update local state
    let success = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.select_fusion_sprite(head_id, body_id, sprite_file.clone())
    };
    
    if success {
        // Broadcast selection to other players via server
        let msg = ClientMessage::SelectFusionSprite {
            head_id,
            body_id,
            sprite_file,
        };
        let _ = ws_sender.send(WsCommand::Send(msg)).await;
    }
    
    Ok(success)
}

/// Get current fusion state
#[tauri::command]
pub fn get_fusion_state(
    head_id: u32,
    body_id: u32,
    state: State<SyncState>,
) -> Result<Option<FusionSprite>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let key = format!("{}.{}", head_id, body_id);
    Ok(guard.fusion_cache.get(&key).cloned())
}

/// Set a custom sprite URL for a fusion (AI-generated or uploaded)
#[tauri::command]
pub async fn set_fusion_custom_sprite(
    head_id: u32,
    body_id: u32,
    custom_url: String,
    state: State<'_, SyncState>,
    ws_sender: State<'_, WsSender>,
) -> Result<(), String> {
    // Update local state
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.set_fusion_custom_url(head_id, body_id, custom_url.clone());
    }
    
    // Broadcast to other players
    let msg = ClientMessage::SelectFusionSprite {
        head_id,
        body_id,
        sprite_file: custom_url,
    };
    let _ = ws_sender.send(WsCommand::Send(msg)).await;
    
    Ok(())
}

/// Get sync connection status
#[tauri::command]
pub fn get_sync_status(state: State<SyncState>) -> Result<ConnectionStatus, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.connection_status)
}

/// Set server endpoint
#[tauri::command]
pub fn set_sync_endpoint(
    endpoint: String,
    state: State<SyncState>,
    ws_sender: State<'_, WsSender>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.server_endpoint = endpoint;
    let _ = ws_sender.try_send(WsCommand::UpdateEndpoint(guard.server_endpoint.clone()));
    Ok(())
}

/// Build the local sprite index
#[tauri::command]
pub fn build_sprite_index(
    base_path: String,
    custom_path: Option<String>,
    index: State<Mutex<FusionSpriteIndex>>,
) -> Result<IndexBuildResult, String> {
    let mut idx = index.lock().map_err(|e| e.to_string())?;
    let custom = custom_path.unwrap_or_else(|| base_path.clone());
    *idx = FusionSpriteIndex::new(&base_path, &custom);
    
    let sprite_count = idx.build_index()?;
    let fusion_count = idx.fusion_count();
    
    Ok(IndexBuildResult {
        sprite_count,
        fusion_count,
    })
}

#[derive(Debug, Serialize)]
pub struct IndexBuildResult {
    pub sprite_count: usize,
    pub fusion_count: usize,
}

/// Calculate fusion stats
#[tauri::command]
pub fn calculate_fusion_stats(
    head_stats: FusionStats,
    body_stats: FusionStats,
) -> FusionStats {
    FusionStats::calculate(&head_stats, &body_stats)
}

/// Build sprite URL
#[tauri::command]
pub fn build_sprite_url(
    head_id: u32,
    body_id: u32,
    variant: Option<String>,
) -> String {
    let builder = SpriteUrlBuilder::default();
    builder.build_url(head_id, body_id, variant.as_deref())
}

/// Set user identity for sync
#[tauri::command]
pub fn set_sync_identity(
    user_id: String,
    username: String,
    trainer_sprite: Option<String>,
    state: State<SyncState>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.user_id = Some(user_id);
    guard.username = Some(username);
    guard.trainer_sprite = trainer_sprite;
    Ok(())
}
