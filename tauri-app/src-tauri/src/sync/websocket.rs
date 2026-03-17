//! WebSocket Manager - Persistent connection to Raspberry Pi backend
//! 
//! Handles WebSocket connectivity with automatic reconnection,
//! message routing, and state synchronization.

use crate::sync::state::{ConnectionStatus, SyncEvent, SyncState};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio::time::{interval, timeout};

/// Messages from the Pi backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    /// Fusion variants available for a head/body combination
    #[serde(rename = "fusion-variants")]
    FusionVariants {
        head_id: u32,
        body_id: u32,
        variants: Vec<String>,
    },
    /// A player selected a fusion sprite
    #[serde(rename = "fusion-sprite-selected")]
    FusionSpriteSelected {
        head_id: u32,
        body_id: u32,
        sprite_file: String,
        player_id: String,
    },
    /// Battle state update
    #[serde(rename = "battle-update")]
    BattleUpdate {
        room_id: String,
        state: serde_json::Value,
    },
    /// Connection acknowledged
    #[serde(rename = "connected")]
    Connected { 
        server_version: Option<String>,
    },
    /// Ping/keepalive
    #[serde(rename = "ping")]
    Ping,
    /// Error from server
    #[serde(rename = "error")]
    Error { message: String },
}

/// Messages to send to the Pi backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    /// Request fusion variants for a head/body combo
    #[serde(rename = "get-fusion-variants")]
    GetFusionVariants { head_id: u32, body_id: u32 },
    /// Select a fusion sprite (broadcast to other players)
    #[serde(rename = "select-fusion-sprite")]
    SelectFusionSprite {
        head_id: u32,
        body_id: u32,
        sprite_file: String,
    },
    /// Identify this client
    #[serde(rename = "identify")]
    Identify {
        user_id: String,
        username: String,
        trainer_sprite: Option<String>,
    },
    /// Pong response
    #[serde(rename = "pong")]
    Pong,
}

/// Control commands for the WebSocket manager
#[derive(Debug, Clone)]
pub enum WsCommand {
    Send(ClientMessage),
    UpdateEndpoint(String),
}

/// WebSocket connection configuration
#[derive(Debug, Clone)]
pub struct WebSocketConfig {
    pub endpoint: String,
    pub reconnect_interval: Duration,
    pub max_reconnect_attempts: u32,
    pub ping_interval: Duration,
    pub connection_timeout: Duration,
}

impl Default for WebSocketConfig {
    fn default() -> Self {
        Self {
            endpoint: "wss://pokettrpg.duckdns.org/fusion-sync".to_string(),
            reconnect_interval: Duration::from_secs(5),
            max_reconnect_attempts: 10,
            ping_interval: Duration::from_secs(30),
            connection_timeout: Duration::from_secs(10),
        }
    }
}

/// Channel for sending messages to the WebSocket task
pub type WsSender = mpsc::Sender<WsCommand>;

/// Start the WebSocket manager in a background task
/// Returns a sender for queueing outbound messages
pub fn start_websocket_manager(
    app_handle: AppHandle,
    config: WebSocketConfig,
) -> WsSender {
    let (tx, rx) = mpsc::channel::<WsCommand>(100);
    
    // Spawn the connection manager task
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        websocket_loop(handle, config, rx).await;
    });
    
    tx
}

/// Main WebSocket connection loop with reconnection logic
async fn websocket_loop(
    app_handle: AppHandle,
    mut config: WebSocketConfig,
    mut rx: mpsc::Receiver<WsCommand>,
) {
    let mut reconnect_attempts = 0;
    
    loop {
        // Update connection status
        update_connection_status(&app_handle, ConnectionStatus::Connecting);
        
        log::info!("Attempting WebSocket connection to {}", config.endpoint);
        
        // Try to connect
        match connect_websocket(&config).await {
            Ok((mut ws_write, mut ws_read)) => {
                reconnect_attempts = 0;
                update_connection_status(&app_handle, ConnectionStatus::Connected);
                log::info!("WebSocket connected successfully");
                
                // Emit connected event to frontend
                let _ = app_handle.emit("sync-event", SyncEvent::ConnectionChanged {
                    status: ConnectionStatus::Connected,
                });
                
                // Send identification if we have user info
                let identify_msg_opt = if let Some(state) = app_handle.try_state::<SyncState>() {
                    let guard = state.lock().unwrap();
                    if let (Some(user_id), Some(username)) = (&guard.user_id, &guard.username) {
                        Some(ClientMessage::Identify {
                            user_id: user_id.clone(),
                            username: username.clone(),
                            trainer_sprite: guard.trainer_sprite.clone(),
                        })
                    } else {
                        None
                    }
                } else {
                    None
                };
                
                if let Some(identify_msg) = identify_msg_opt {
                    if let Ok(json) = serde_json::to_string(&identify_msg) {
                        let _ = ws_write.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await;
                    }
                }
                
                // Create ping interval
                let mut ping_timer = interval(config.ping_interval);
                
                // Message handling loop
                loop {
                    tokio::select! {
                        // Handle incoming messages from server
                        msg = ws_read.next() => {
                            match msg {
                                Some(Ok(ws_msg)) => {
                                    if let tokio_tungstenite::tungstenite::Message::Text(text) = ws_msg {
                                        handle_server_message(&app_handle, &text.to_string());
                                    }
                                }
                                Some(Err(e)) => {
                                    log::error!("WebSocket read error: {}", e);
                                    break;
                                }
                                None => {
                                    log::info!("WebSocket closed by server");
                                    break;
                                }
                            }
                        }
                        
                        // Handle outbound messages and control commands
                        Some(cmd) = rx.recv() => {
                            match cmd {
                                WsCommand::Send(client_msg) => {
                                    if let Ok(json) = serde_json::to_string(&client_msg) {
                                        if let Err(e) = ws_write.send(
                                            tokio_tungstenite::tungstenite::Message::Text(json.into())
                                        ).await {
                                            log::error!("Failed to send WebSocket message: {}", e);
                                            break;
                                        }
                                    }
                                }
                                WsCommand::UpdateEndpoint(new_endpoint) => {
                                    if new_endpoint.trim().is_empty() {
                                        log::warn!("Ignoring empty WebSocket endpoint update");
                                        continue;
                                    }
                                    if new_endpoint != config.endpoint {
                                        log::info!("WebSocket endpoint updated to {}", new_endpoint);
                                        config.endpoint = new_endpoint;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Periodic ping
                        _ = ping_timer.tick() => {
                            // Sync any pending sprite selections
                            if let Some(state) = app_handle.try_state::<SyncState>() {
                                let pending = {
                                    let mut guard = state.lock().unwrap();
                                    guard.drain_pending_sprite_syncs()
                                };
                                for (key, sprite_file) in pending {
                                    let parts: Vec<&str> = key.split('.').collect();
                                    if parts.len() == 2 {
                                        if let (Ok(head_id), Ok(body_id)) = (parts[0].parse(), parts[1].parse()) {
                                            let msg = ClientMessage::SelectFusionSprite {
                                                head_id,
                                                body_id,
                                                sprite_file,
                                            };
                                            if let Ok(json) = serde_json::to_string(&msg) {
                                                let _ = ws_write.send(
                                                    tokio_tungstenite::tungstenite::Message::Text(json.into())
                                                ).await;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                }
            }
            Err(e) => {
                log::error!("WebSocket connection failed: {}", e);
            }
        }
        
        // Connection lost or failed
        reconnect_attempts += 1;
        
        if reconnect_attempts >= config.max_reconnect_attempts {
            log::error!("Max reconnection attempts reached, giving up");
            update_connection_status(&app_handle, ConnectionStatus::Error);
            let _ = app_handle.emit("sync-event", SyncEvent::Error {
                message: "Failed to connect to server after multiple attempts".to_string(),
            });
            break;
        }
        
        update_connection_status(&app_handle, ConnectionStatus::Reconnecting);
        log::info!(
            "Reconnecting in {:?} (attempt {}/{})",
            config.reconnect_interval,
            reconnect_attempts,
            config.max_reconnect_attempts
        );
        
        tokio::time::sleep(config.reconnect_interval).await;
    }
}

/// Establish WebSocket connection
async fn connect_websocket(
    config: &WebSocketConfig,
) -> Result<(
    futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, tokio_tungstenite::tungstenite::Message>,
    futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>>,
), Box<dyn std::error::Error + Send + Sync>> {
    let connect_future = tokio_tungstenite::connect_async(&config.endpoint);
    
    let (ws_stream, _response) = timeout(config.connection_timeout, connect_future)
        .await
        .map_err(|_| "Connection timeout")?
        .map_err(|e| format!("WebSocket connect error: {}", e))?;
    
    Ok(ws_stream.split())
}

/// Handle incoming server messages
fn handle_server_message(app_handle: &AppHandle, text: &str) {
    match serde_json::from_str::<ServerMessage>(text) {
        Ok(msg) => {
            match msg {
                ServerMessage::FusionVariants { head_id, body_id, variants } => {
                    // Update state
                    if let Some(state) = app_handle.try_state::<SyncState>() {
                        let mut guard = state.lock().unwrap();
                        guard.update_fusion_variants(head_id, body_id, variants.clone());
                    }
                    
                    // Emit to frontend
                    let _ = app_handle.emit("sync-event", SyncEvent::FusionVariantsLoaded {
                        head_id,
                        body_id,
                        variants,
                    });
                }
                
                ServerMessage::FusionSpriteSelected { head_id, body_id, sprite_file, player_id } => {
                    // Update state
                    if let Some(state) = app_handle.try_state::<SyncState>() {
                        let mut guard = state.lock().unwrap();
                        let fusion = guard.get_or_create_fusion(head_id, body_id);
                        fusion.sprite_file = sprite_file.clone();
                    }
                    
                    // Emit to frontend
                    let _ = app_handle.emit("sync-event", SyncEvent::FusionSpriteSelected {
                        head_id,
                        body_id,
                        sprite_file,
                        player_id: Some(player_id),
                    });
                }
                
                ServerMessage::BattleUpdate { room_id, state: battle_state } => {
                    // Parse and update battle state
                    log::debug!("Battle update for room {}: {:?}", room_id, battle_state);
                    // Full battle state updates go through the JS client for now
                    // This is for fusion-specific state only
                }
                
                ServerMessage::Connected { server_version } => {
                    log::info!("Server acknowledged connection, version: {:?}", server_version);
                }
                
                ServerMessage::Ping => {
                    // Respond with pong - already handled in the loop
                }
                
                ServerMessage::Error { message } => {
                    log::error!("Server error: {}", message);
                    let _ = app_handle.emit("sync-event", SyncEvent::Error { message });
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to parse server message: {} - {}", e, text);
        }
    }
}

/// Update connection status in state and emit event
fn update_connection_status(app_handle: &AppHandle, status: ConnectionStatus) {
    if let Some(state) = app_handle.try_state::<SyncState>() {
        let mut guard = state.lock().unwrap();
        guard.set_connection_status(status);
    }
    
    let _ = app_handle.emit("sync-event", SyncEvent::ConnectionChanged { status });
}
