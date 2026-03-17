//! Game State Management - The Source of Truth
//! 
//! This module maintains all critical game state in Rust, preventing JS desync issues.
//! State is wrapped in Mutex for thread-safe access across Tauri commands and WebSocket handlers.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Connection status for the Pi backend
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

impl Default for ConnectionStatus {
    fn default() -> Self {
        Self::Disconnected
    }
}

/// Fusion sprite information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusionSprite {
    /// Head Pokemon ID (national dex number)
    pub head_id: u32,
    /// Body Pokemon ID (national dex number)
    pub body_id: u32,
    /// Currently selected sprite filename (e.g., "25.6.png" or "25.6_alt1.png")
    pub sprite_file: String,
    /// Available variant filenames for this fusion
    pub variants: Vec<String>,
    /// Optional custom sprite URL (for AI-generated or custom uploaded)
    pub custom_url: Option<String>,
}

impl FusionSprite {
    /// Create a new fusion sprite with default sprite selection
    pub fn new(head_id: u32, body_id: u32) -> Self {
        let base_file = format!("{}.{}.png", head_id, body_id);
        Self {
            head_id,
            body_id,
            sprite_file: base_file.clone(),
            variants: vec![base_file],
            custom_url: None,
        }
    }
    
    /// Generate the base sprite filename (HEAD.BODY.png)
    pub fn base_filename(&self) -> String {
        format!("{}.{}.png", self.head_id, self.body_id)
    }
    
    /// Check if this fusion has alternative sprites available
    pub fn has_variants(&self) -> bool {
        self.variants.len() > 1
    }
}

/// Player information in a battle/room
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub id: String,
    pub username: Option<String>,
    pub trainer_sprite: Option<String>,
    pub avatar: Option<String>,
    /// Active fusion pokemon for this player (pokemon_id -> FusionSprite)
    pub fusions: HashMap<String, FusionSprite>,
}

/// Battle state tracked by Rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BattleState {
    pub room_id: String,
    pub phase: String,
    pub deadline: Option<u64>,
    pub players: Vec<PlayerInfo>,
    pub started: bool,
    pub ended: bool,
    pub winner: Option<String>,
}

impl BattleState {
    pub fn new(room_id: String) -> Self {
        Self {
            room_id,
            phase: "waiting".to_string(),
            deadline: None,
            players: Vec::new(),
            started: false,
            ended: false,
            winner: None,
        }
    }
}

/// Room/lobby information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    pub id: String,
    pub name: String,
    pub players: Vec<PlayerInfo>,
    pub spectator_count: u32,
    pub battle_started: bool,
}

/// The main game state - Source of Truth
#[derive(Debug, Default)]
pub struct GameState {
    /// WebSocket connection status
    pub connection_status: ConnectionStatus,
    /// Server endpoint URL
    pub server_endpoint: String,
    /// Current user info
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub trainer_sprite: Option<String>,
    /// Rooms/lobbies
    pub rooms: HashMap<String, RoomInfo>,
    /// Active battle states
    pub battles: HashMap<String, BattleState>,
    /// All known fusion sprites (keyed by "head_id.body_id")
    pub fusion_cache: HashMap<String, FusionSprite>,
    /// Pending sprite selections to sync
    pub pending_sprite_sync: Vec<(String, String)>, // (pokemon_id, sprite_file)
    /// Last sync timestamp
    pub last_sync_timestamp: u64,
}

impl GameState {
    pub fn new() -> Self {
        Self {
            connection_status: ConnectionStatus::Disconnected,
            server_endpoint: "wss://pokettrpg.duckdns.org".to_string(),
            user_id: None,
            username: None,
            trainer_sprite: None,
            rooms: HashMap::new(),
            battles: HashMap::new(),
            fusion_cache: HashMap::new(),
            pending_sprite_sync: Vec::new(),
            last_sync_timestamp: 0,
        }
    }
    
    /// Get or create a fusion sprite entry
    pub fn get_or_create_fusion(&mut self, head_id: u32, body_id: u32) -> &mut FusionSprite {
        let key = format!("{}.{}", head_id, body_id);
        self.fusion_cache.entry(key).or_insert_with(|| FusionSprite::new(head_id, body_id))
    }
    
    /// Update fusion variants from the server
    pub fn update_fusion_variants(&mut self, head_id: u32, body_id: u32, variants: Vec<String>) {
        let fusion = self.get_or_create_fusion(head_id, body_id);
        fusion.variants = variants;
    }
    
    /// Select a specific sprite variant
    pub fn select_fusion_sprite(&mut self, head_id: u32, body_id: u32, sprite_file: String) -> bool {
        let fusion = self.get_or_create_fusion(head_id, body_id);
        if fusion.variants.contains(&sprite_file) || sprite_file.starts_with("http") {
            fusion.sprite_file = sprite_file.clone();
            // Queue for sync
            let key = format!("{}.{}", head_id, body_id);
            self.pending_sprite_sync.push((key, sprite_file));
            true
        } else {
            false
        }
    }
    
    /// Set custom URL for a fusion (AI-generated or uploaded)
    pub fn set_fusion_custom_url(&mut self, head_id: u32, body_id: u32, url: String) {
        let fusion = self.get_or_create_fusion(head_id, body_id);
        fusion.custom_url = Some(url.clone());
        fusion.sprite_file = url;
    }
    
    /// Update connection status
    pub fn set_connection_status(&mut self, status: ConnectionStatus) {
        self.connection_status = status;
    }
    
    /// Update battle state
    pub fn update_battle(&mut self, room_id: &str, update: BattleState) {
        self.battles.insert(room_id.to_string(), update);
    }
    
    /// Get pending sprite syncs and clear the queue
    pub fn drain_pending_sprite_syncs(&mut self) -> Vec<(String, String)> {
        std::mem::take(&mut self.pending_sprite_sync)
    }
}

/// Thread-safe wrapper for game state
pub type SyncState = Mutex<GameState>;

/// Create a new synchronized state instance
pub fn create_sync_state() -> SyncState {
    Mutex::new(GameState::new())
}

/// Sync event types emitted to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum SyncEvent {
    /// Connection status changed
    ConnectionChanged { status: ConnectionStatus },
    /// Fusion variants loaded for a pokemon
    FusionVariantsLoaded { 
        head_id: u32, 
        body_id: u32, 
        variants: Vec<String> 
    },
    /// A fusion sprite was selected (by us or another player)
    FusionSpriteSelected { 
        head_id: u32, 
        body_id: u32, 
        sprite_file: String,
        player_id: Option<String>,
    },
    /// Battle state updated
    BattleUpdated { room_id: String, state: BattleState },
    /// Full state sync completed
    FullSyncCompleted { timestamp: u64 },
    /// Error occurred
    Error { message: String },
}
