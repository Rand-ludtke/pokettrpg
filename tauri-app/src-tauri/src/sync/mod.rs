// Sync module - Rust-side state management and WebSocket connectivity
// This module serves as the Source of Truth for game state, emitting events to the JS frontend

pub mod state;
pub mod websocket;
pub mod fusion;
pub mod commands;

