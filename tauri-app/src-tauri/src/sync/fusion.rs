//! Fusion Sprite Resolver - Dynamic Asset Resolution for Infinite Fusion
//! 
//! Handles the massive sprite dataset with variant support:
//! - Standard: HEAD_ID.BODY_ID.png
//! - Alternates: HEAD_ID.BODY_ID_alt1.png, HEAD_ID.BODY_ID_alt2.png, etc.
//! - Custom: User-uploaded or AI-generated sprites

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Parsed fusion sprite info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusionSpriteInfo {
    /// Original filename
    pub filename: String,
    /// Head Pokemon national dex ID
    pub head_id: u32,
    /// Body Pokemon national dex ID
    pub body_id: u32,
    /// Variant identifier (None for base, Some("alt1"), Some("alt2"), etc.)
    pub variant: Option<String>,
    /// Is this a custom/user sprite
    pub is_custom: bool,
    /// Full path to the sprite
    pub path: PathBuf,
}

/// Fusion sprite index - maps head.body to available variants
#[derive(Debug, Default)]
pub struct FusionSpriteIndex {
    /// Map of "head_id.body_id" -> list of available sprites
    sprites: HashMap<String, Vec<FusionSpriteInfo>>,
    /// Base directory for sprites
    base_path: PathBuf,
    /// Custom sprites directory
    custom_path: PathBuf,
}

impl FusionSpriteIndex {
    /// Create a new index with the given base paths
    pub fn new<P: AsRef<Path>>(base_path: P, custom_path: P) -> Self {
        Self {
            sprites: HashMap::new(),
            base_path: base_path.as_ref().to_path_buf(),
            custom_path: custom_path.as_ref().to_path_buf(),
        }
    }
    
    /// Build the index by scanning the sprite directories
    pub fn build_index(&mut self) -> Result<usize, String> {
        self.sprites.clear();
        
        let pattern = Regex::new(r"^(\d+)\.(\d+)(?:_([A-Za-z0-9]+)|([A-Za-z]+))?\.png$")
            .map_err(|e| format!("Invalid regex: {}", e))?;
        
        let mut count = 0;
        
        // Scan base sprite directory
        if self.base_path.exists() {
            for entry in WalkDir::new(&self.base_path)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
            {
                if let Some(info) = Self::parse_sprite_filename(entry.path(), &pattern, false) {
                    let key = format!("{}.{}", info.head_id, info.body_id);
                    self.sprites.entry(key).or_default().push(info);
                    count += 1;
                }
            }
        }
        
        // Scan custom sprite directory
        if self.custom_path.exists() {
            for entry in WalkDir::new(&self.custom_path)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
            {
                if let Some(info) = Self::parse_sprite_filename(entry.path(), &pattern, true) {
                    let key = format!("{}.{}", info.head_id, info.body_id);
                    self.sprites.entry(key).or_default().push(info);
                    count += 1;
                }
            }
        }
        
        // Sort variants: base first, then alts in order
        for sprites in self.sprites.values_mut() {
            sprites.sort_by(|a, b| {
                match (&a.variant, &b.variant) {
                    (None, None) => std::cmp::Ordering::Equal,
                    (None, Some(_)) => std::cmp::Ordering::Less,
                    (Some(_), None) => std::cmp::Ordering::Greater,
                    (Some(va), Some(vb)) => va.cmp(vb),
                }
            });
        }
        
        Ok(count)
    }
    
    /// Parse a sprite filename into FusionSpriteInfo
    fn parse_sprite_filename(path: &Path, pattern: &Regex, is_custom: bool) -> Option<FusionSpriteInfo> {
        let filename = path.file_name()?.to_str()?;
        let caps = pattern.captures(filename)?;
        
        let head_id: u32 = caps.get(1)?.as_str().parse().ok()?;
        let body_id: u32 = caps.get(2)?.as_str().parse().ok()?;
        let variant = caps.get(3)
            .or_else(|| caps.get(4))
            .map(|m| m.as_str().to_string());
        
        Some(FusionSpriteInfo {
            filename: filename.to_string(),
            head_id,
            body_id,
            variant,
            is_custom,
            path: path.to_path_buf(),
        })
    }
    
    /// Get all variants for a fusion
    pub fn get_variants(&self, head_id: u32, body_id: u32) -> Vec<&FusionSpriteInfo> {
        let key = format!("{}.{}", head_id, body_id);
        self.sprites.get(&key).map_or(Vec::new(), |v| v.iter().collect())
    }
    
    /// Get variant filenames only
    pub fn get_variant_filenames(&self, head_id: u32, body_id: u32) -> Vec<String> {
        self.get_variants(head_id, body_id)
            .into_iter()
            .map(|v| v.filename.clone())
            .collect()
    }
    
    /// Get the base sprite for a fusion (no variant)
    pub fn get_base_sprite(&self, head_id: u32, body_id: u32) -> Option<&FusionSpriteInfo> {
        self.get_variants(head_id, body_id)
            .into_iter()
            .find(|v| v.variant.is_none())
    }
    
    /// Check if a fusion has any sprites
    pub fn has_fusion(&self, head_id: u32, body_id: u32) -> bool {
        let key = format!("{}.{}", head_id, body_id);
        self.sprites.contains_key(&key)
    }
    
    /// Get total number of fusions indexed
    pub fn fusion_count(&self) -> usize {
        self.sprites.len()
    }
    
    /// Get total number of sprites indexed
    pub fn sprite_count(&self) -> usize {
        self.sprites.values().map(|v| v.len()).sum()
    }
    
    /// List all indexed fusion keys (head.body)
    pub fn list_fusions(&self) -> Vec<(u32, u32)> {
        self.sprites.keys()
            .filter_map(|k| {
                let parts: Vec<&str> = k.split('.').collect();
                if parts.len() == 2 {
                    Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
                } else {
                    None
                }
            })
            .collect()
    }
}

/// Sprite URL builder for different sources
#[derive(Debug, Clone)]
pub struct SpriteUrlBuilder {
    /// Base URL for remote sprites
    pub remote_base: String,
    /// Local asset path prefix
    pub local_prefix: String,
}

impl Default for SpriteUrlBuilder {
    fn default() -> Self {
        Self {
            remote_base: "https://pokettrpg.duckdns.org/fusion-sprites".to_string(),
            local_prefix: "/fusion-sprites".to_string(),
        }
    }
}

impl SpriteUrlBuilder {
    /// Build URL for a fusion sprite
    pub fn build_url(&self, head_id: u32, body_id: u32, variant: Option<&str>) -> String {
        let filename = match variant {
            Some(v) if v.chars().all(|c| c.is_ascii_alphabetic()) => {
                format!("{}.{}{}.png", head_id, body_id, v)
            }
            Some(v) => format!("{}.{}_{}.png", head_id, body_id, v),
            None => format!("{}.{}.png", head_id, body_id),
        };
        format!("{}/{}", self.local_prefix, filename)
    }
    
    /// Build remote URL for a fusion sprite
    pub fn build_remote_url(&self, head_id: u32, body_id: u32, variant: Option<&str>) -> String {
        let filename = match variant {
            Some(v) if v.chars().all(|c| c.is_ascii_alphabetic()) => {
                format!("{}.{}{}.png", head_id, body_id, v)
            }
            Some(v) => format!("{}.{}_{}.png", head_id, body_id, v),
            None => format!("{}.{}.png", head_id, body_id),
        };
        format!("{}/{}", self.remote_base, filename)
    }
}

/// Fusion calculation result (following InfiniteFusionCalculator logic)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusionResult {
    /// Resulting Pokemon name (e.g., "Pikasaur" for Pikachu head + Bulbasaur body)
    pub name: String,
    /// Head Pokemon info
    pub head: FusionPart,
    /// Body Pokemon info
    pub body: FusionPart,
    /// Calculated base stats
    pub stats: FusionStats,
    /// Primary type
    pub type1: String,
    /// Secondary type (if any)
    pub type2: Option<String>,
    /// Ability options
    pub abilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusionPart {
    pub id: u32,
    pub name: String,
}

/// Calculated fusion stats following Infinite Fusion formula:
/// - HEAD dominates: HP, Sp. Atk, Sp. Def
/// - BODY dominates: Attack, Defense, Speed
/// - Formula per stat: floor((2 * dominant + other) / 3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusionStats {
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub sp_attack: u32,
    pub sp_defense: u32,
    pub speed: u32,
}

impl FusionStats {
    /// Calculate fusion stats from head and body stats
    /// Using the Infinite Fusion formula
    pub fn calculate(head: &FusionStats, body: &FusionStats) -> Self {
        Self {
            hp: (2 * head.hp + body.hp) / 3,
            attack: (2 * body.attack + head.attack) / 3,
            defense: (2 * body.defense + head.defense) / 3,
            sp_attack: (2 * head.sp_attack + body.sp_attack) / 3,
            sp_defense: (2 * head.sp_defense + body.sp_defense) / 3,
            speed: (2 * body.speed + head.speed) / 3,
        }
    }
    
    /// Calculate base stat total
    pub fn total(&self) -> u32 {
        self.hp + self.attack + self.defense + self.sp_attack + self.sp_defense + self.speed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fusion_stats_calculation() {
        let pikachu = FusionStats {
            hp: 35, attack: 55, defense: 40, sp_attack: 50, sp_defense: 50, speed: 90,
        };
        let bulbasaur = FusionStats {
            hp: 45, attack: 49, defense: 49, sp_attack: 65, sp_defense: 65, speed: 45,
        };
        
        let fusion = FusionStats::calculate(&pikachu, &bulbasaur);
        
        // Verify calculation follows the formula
        assert_eq!(fusion.hp, (2 * 35 + 45) / 3); // 38
        assert_eq!(fusion.attack, (2 * 49 + 55) / 3); // 51
    }
}
