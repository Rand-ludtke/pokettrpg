/**
 * SpriteWithHat - Renders a Pokemon sprite with an optional hat overlay
 * 
 * The hat is positioned relative to the sprite and can be offset for fine-tuning.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { spriteUrl, placeholderSpriteDataURL } from '../data/adapter';
import '../styles/sprite-with-hat.css';

// Available hat options with their overlay images
export const AVAILABLE_HATS = [
  { id: 'none', name: 'No Hat', icon: '❌' },
  { id: 'party', name: 'Party Hat', icon: '🎉', color: '#ff6b9d' },
  { id: 'tophat', name: 'Top Hat', icon: '🎩', color: '#1a1a1a' },
  { id: 'crown', name: 'Crown', icon: '👑', color: '#ffd700' },
  { id: 'cap', name: 'Baseball Cap', icon: '🧢', color: '#3b82f6' },
  { id: 'witch', name: 'Witch Hat', icon: '🧙', color: '#6b21a8' },
  { id: 'bow', name: 'Bow', icon: '🎀', color: '#ec4899' },
  { id: 'chef', name: 'Chef Hat', icon: '👨‍🍳', color: '#ffffff' },
  { id: 'santa', name: 'Santa Hat', icon: '🎅', color: '#dc2626' },
  { id: 'pirate', name: 'Pirate Hat', icon: '🏴‍☠️', color: '#292524' },
  { id: 'cowboy', name: 'Cowboy Hat', icon: '🤠', color: '#a16207' },
  { id: 'halo', name: 'Halo', icon: '😇', color: '#fef08a' },
  { id: 'flower', name: 'Flower Crown', icon: '🌸', color: '#f9a8d4' },
  { id: 'horns', name: 'Devil Horns', icon: '😈', color: '#b91c1c' },
  { id: 'bunny', name: 'Bunny Ears', icon: '🐰', color: '#fecdd3' },
  { id: 'glasses', name: 'Sunglasses', icon: '🕶️', color: '#1f2937' },
  { id: 'sunhat', name: 'Sun Hat', icon: '👒', color: '#facc15' },
  { id: 'beanie', name: 'Beanie', icon: '🧢', color: '#0ea5e9' },
  { id: 'beret', name: 'Beret', icon: '🧢', color: '#b91c1c' },
  { id: 'ranger', name: 'Ranger Hat', icon: '🧭', color: '#84cc16' },
  { id: 'tiara', name: 'Tiara', icon: '💎', color: '#a78bfa' },
] as const;

export type HatId = typeof AVAILABLE_HATS[number]['id'];

/**
 * Sprite mode determines how fusion sprites are sourced:
 * - 'ai-generated': Use AI-generated sprites from OneTrainer LoRA
 * - 'two-step': Use InfiniteFusion Calculator spliced sprites
 * - 'auto': Automatically select best available option
 */
export type SpriteMode = 'ai-generated' | 'two-step' | 'auto';

interface SpriteWithHatProps {
  species: string;
  shiny?: boolean;
  cosmeticForm?: string;
  back?: boolean;
  hatId?: HatId;
  /** Fusion data for displaying fusion sprites */
  fusion?: {
    headId: number;
    bodyId: number;
    spriteFile?: string;
  };
  /** Base URL for fusion sprites */
  fusionSpriteBase?: string;
  /** Sprite mode: 'ai-generated', 'two-step', or 'auto' */
  spriteMode?: SpriteMode;
  /** Base URL for AI-generated sprites (default: /ai-sprites) */
  aiSpritesBase?: string;
  /** Base URL for two-step spliced sprites (default: /spliced-sprites) */
  splicedSpritesBase?: string;
  /** Hat vertical offset from top (0-100% of sprite height), default 10 */
  hatYOffset?: number;
  /** Sprite dimensions */
  size?: number;
  /** Enable zoom on click */
  zoomEnabled?: boolean;
  /** Zoom scale factor (default: 2) */
  zoomScale?: number;
  /** Additional className */
  className?: string;
  /** Additional style */
  style?: React.CSSProperties;
  /** Alt text for accessibility */
  alt?: string;
}

/** Render a hat overlay as CSS shapes/gradients (no external images needed) */
function HatOverlay({ hatId, size }: { hatId: HatId; size: number }) {
  if (hatId === 'none') return null;
  
  const hat = AVAILABLE_HATS.find(h => h.id === hatId);
  if (!hat || !('color' in hat)) return null;
  
  const scale = size / 80; // Base size is 80px
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
    zIndex: 10,
  };
  
  // Different hat shapes using CSS
  switch (hatId) {
    case 'party':
      return (
        <div style={{
          ...baseStyle,
          top: -2 * scale,
          width: 0,
          height: 0,
          borderLeft: `${12 * scale}px solid transparent`,
          borderRight: `${12 * scale}px solid transparent`,
          borderBottom: `${28 * scale}px solid ${hat.color}`,
          filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))',
        }}>
          <div style={{
            position: 'absolute',
            bottom: -30 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 6 * scale,
            height: 6 * scale,
            background: '#fff',
            borderRadius: '50%',
          }} />
        </div>
      );
      
    case 'tophat':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -20 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 20 * scale,
            height: 22 * scale,
            background: hat.color,
            borderRadius: `${3 * scale}px ${3 * scale}px 0 0`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.4))',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 34 * scale,
            height: 4 * scale,
            background: hat.color,
            borderRadius: 2 * scale,
          }} />
          <div style={{
            position: 'absolute',
            top: -12 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 18 * scale,
            height: 3 * scale,
            background: '#c4a747',
            borderRadius: 1 * scale,
          }} />
        </div>
      );
      
    case 'crown':
      return (
        <div style={{
          ...baseStyle,
          top: -16 * scale,
          width: 30 * scale,
          height: 18 * scale,
        }}>
          <svg viewBox="0 0 30 18" style={{ width: '100%', height: '100%', filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.4))' }}>
            <polygon points="0,18 3,6 8,12 15,0 22,12 27,6 30,18" fill={hat.color} />
            <circle cx="3" cy="6" r="2" fill="#ef4444" />
            <circle cx="15" cy="2" r="2" fill="#22c55e" />
            <circle cx="27" cy="6" r="2" fill="#3b82f6" />
          </svg>
        </div>
      );
      
    case 'cap':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -6 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 28 * scale,
            height: 14 * scale,
            background: hat.color,
            borderRadius: `${14 * scale}px ${14 * scale}px 0 0`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.3))',
          }} />
          <div style={{
            position: 'absolute',
            top: 6 * scale,
            left: 14 * scale,
            width: 16 * scale,
            height: 4 * scale,
            background: hat.color,
            borderRadius: `0 ${6 * scale}px ${6 * scale}px 0`,
            filter: 'brightness(0.85)',
          }} />
        </div>
      );
      
    case 'witch':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -28 * scale,
            left: '50%',
            transform: 'translateX(-50%) rotate(8deg)',
            width: 0,
            height: 0,
            borderLeft: `${14 * scale}px solid transparent`,
            borderRight: `${14 * scale}px solid transparent`,
            borderBottom: `${32 * scale}px solid ${hat.color}`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.4))',
          }} />
          <div style={{
            position: 'absolute',
            top: 2 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 36 * scale,
            height: 5 * scale,
            background: hat.color,
            borderRadius: '50%',
          }} />
          <div style={{
            position: 'absolute',
            top: -10 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 24 * scale,
            height: 3 * scale,
            background: '#d97706',
            borderRadius: 2 * scale,
          }} />
        </div>
      );
      
    case 'bow':
      return (
        <div style={{
          ...baseStyle,
          top: -4 * scale,
        }}>
          <svg viewBox="0 0 32 16" style={{ width: 32 * scale, height: 16 * scale, filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))' }}>
            <ellipse cx="8" cy="8" rx="8" ry="6" fill={hat.color} />
            <ellipse cx="24" cy="8" rx="8" ry="6" fill={hat.color} />
            <circle cx="16" cy="8" r="4" fill={hat.color} filter="brightness(0.8)" />
          </svg>
        </div>
      );
      
    case 'chef':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -22 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 30 * scale,
            height: 22 * scale,
            background: hat.color,
            borderRadius: `${16 * scale}px ${16 * scale}px ${4 * scale}px ${4 * scale}px`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.2))',
            border: '1px solid #ddd',
          }} />
          <div style={{
            position: 'absolute',
            top: -2 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 34 * scale,
            height: 4 * scale,
            background: hat.color,
            border: '1px solid #ddd',
            borderTop: 'none',
          }} />
        </div>
      );
      
    case 'santa':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -16 * scale,
            left: '50%',
            transform: 'translateX(-50%) rotate(15deg)',
            width: 0,
            height: 0,
            borderLeft: `${12 * scale}px solid transparent`,
            borderRight: `${12 * scale}px solid transparent`,
            borderBottom: `${24 * scale}px solid ${hat.color}`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.3))',
          }}>
            <div style={{
              position: 'absolute',
              bottom: -28 * scale,
              left: 6 * scale,
              width: 8 * scale,
              height: 8 * scale,
              background: '#fff',
              borderRadius: '50%',
            }} />
          </div>
          <div style={{
            position: 'absolute',
            top: 4 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 34 * scale,
            height: 6 * scale,
            background: '#fff',
            borderRadius: 3 * scale,
          }} />
        </div>
      );
      
    case 'pirate':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -14 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 34 * scale,
            height: 16 * scale,
            background: hat.color,
            borderRadius: `${20 * scale}px ${20 * scale}px 0 0`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.4))',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 38 * scale,
            height: 4 * scale,
            background: '#713f12',
            borderRadius: 2 * scale,
          }} />
          <div style={{
            position: 'absolute',
            top: -8 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 10 * scale,
          }}>☠️</div>
        </div>
      );
      
    case 'cowboy':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -10 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 24 * scale,
            height: 12 * scale,
            background: hat.color,
            borderRadius: `${6 * scale}px ${6 * scale}px 0 0`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.3))',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 44 * scale,
            height: 5 * scale,
            background: hat.color,
            borderRadius: '50%',
            filter: 'brightness(0.9)',
          }} />
          <div style={{
            position: 'absolute',
            top: -4 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 20 * scale,
            height: 2 * scale,
            background: '#78350f',
            borderRadius: 1 * scale,
          }} />
        </div>
      );
      
    case 'halo':
      return (
        <div style={{
          ...baseStyle,
          top: -14 * scale,
          width: 28 * scale,
          height: 10 * scale,
          border: `3px solid ${hat.color}`,
          borderRadius: '50%',
          boxShadow: `0 0 ${8 * scale}px ${hat.color}`,
          background: 'transparent',
        }} />
      );
      
    case 'flower':
      return (
        <div style={{
          ...baseStyle,
          top: -8 * scale,
          display: 'flex',
          gap: 2 * scale,
          filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.2))',
        }}>
          {['#f9a8d4', '#fcd34d', '#a78bfa', '#6ee7b7', '#fca5a5'].map((c, i) => (
            <div key={i} style={{
              width: 8 * scale,
              height: 8 * scale,
              background: c,
              borderRadius: '50%',
            }} />
          ))}
        </div>
      );
      
    case 'horns':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -12 * scale,
            left: -8 * scale,
            width: 0,
            height: 0,
            borderLeft: `${6 * scale}px solid transparent`,
            borderRight: `${6 * scale}px solid transparent`,
            borderBottom: `${16 * scale}px solid ${hat.color}`,
            transform: 'rotate(-20deg)',
            filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))',
          }} />
          <div style={{
            position: 'absolute',
            top: -12 * scale,
            right: -8 * scale,
            width: 0,
            height: 0,
            borderLeft: `${6 * scale}px solid transparent`,
            borderRight: `${6 * scale}px solid transparent`,
            borderBottom: `${16 * scale}px solid ${hat.color}`,
            transform: 'rotate(20deg)',
            filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))',
          }} />
        </div>
      );
      
    case 'bunny':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -24 * scale,
            left: -6 * scale,
            width: 10 * scale,
            height: 24 * scale,
            background: hat.color,
            borderRadius: `${10 * scale}px ${10 * scale}px ${4 * scale}px ${4 * scale}px`,
            transform: 'rotate(-10deg)',
            filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.2))',
          }}>
            <div style={{
              position: 'absolute',
              top: 4 * scale,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 5 * scale,
              height: 16 * scale,
              background: '#fda4af',
              borderRadius: 3 * scale,
            }} />
          </div>
          <div style={{
            position: 'absolute',
            top: -24 * scale,
            right: -6 * scale,
            width: 10 * scale,
            height: 24 * scale,
            background: hat.color,
            borderRadius: `${10 * scale}px ${10 * scale}px ${4 * scale}px ${4 * scale}px`,
            transform: 'rotate(10deg)',
            filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.2))',
          }}>
            <div style={{
              position: 'absolute',
              top: 4 * scale,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 5 * scale,
              height: 16 * scale,
              background: '#fda4af',
              borderRadius: 3 * scale,
            }} />
          </div>
        </div>
      );
      
    case 'glasses':
      return (
        <div style={{
          ...baseStyle,
          top: 20 * scale,
          display: 'flex',
          gap: 2 * scale,
          filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))',
        }}>
          <div style={{
            width: 12 * scale,
            height: 10 * scale,
            background: hat.color,
            borderRadius: 2 * scale,
          }} />
          <div style={{
            width: 4 * scale,
            height: 2 * scale,
            background: hat.color,
            alignSelf: 'center',
          }} />
          <div style={{
            width: 12 * scale,
            height: 10 * scale,
            background: hat.color,
            borderRadius: 2 * scale,
          }} />
        </div>
      );

    case 'sunhat':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -10 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 26 * scale,
            height: 12 * scale,
            background: hat.color,
            borderRadius: `${12 * scale}px ${12 * scale}px 4px 4px`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.25))',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 40 * scale,
            height: 6 * scale,
            background: '#fde68a',
            borderRadius: '50%',
            border: `1px solid ${hat.color}`,
          }} />
          <div style={{
            position: 'absolute',
            top: -4 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 18 * scale,
            height: 3 * scale,
            background: '#f59e0b',
            borderRadius: 2 * scale,
          }} />
        </div>
      );

    case 'beanie':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -8 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 28 * scale,
            height: 14 * scale,
            background: hat.color,
            borderRadius: `${14 * scale}px ${14 * scale}px 6px 6px`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.25))',
          }} />
          <div style={{
            position: 'absolute',
            top: 4 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 30 * scale,
            height: 5 * scale,
            background: '#0f172a',
            borderRadius: 3 * scale,
          }} />
        </div>
      );

    case 'beret':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -8 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 30 * scale,
            height: 12 * scale,
            background: hat.color,
            borderRadius: `${20 * scale}px ${20 * scale}px 6px 6px`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.3))',
          }} />
          <div style={{
            position: 'absolute',
            top: -10 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 4 * scale,
            height: 4 * scale,
            background: '#111827',
            borderRadius: '50%',
          }} />
        </div>
      );

    case 'ranger':
      return (
        <div style={baseStyle}>
          <div style={{
            position: 'absolute',
            top: -12 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 26 * scale,
            height: 12 * scale,
            background: hat.color,
            borderRadius: `${10 * scale}px ${10 * scale}px 0 0`,
            filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.3))',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 38 * scale,
            height: 5 * scale,
            background: '#4d7c0f',
            borderRadius: '50%',
          }} />
          <div style={{
            position: 'absolute',
            top: -6 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 14 * scale,
            height: 2 * scale,
            background: '#14532d',
            borderRadius: 2 * scale,
          }} />
        </div>
      );

    case 'tiara':
      return (
        <div style={{
          ...baseStyle,
          top: -8 * scale,
          width: 28 * scale,
          height: 14 * scale,
        }}>
          <svg viewBox="0 0 28 14" style={{ width: '100%', height: '100%', filter: 'drop-shadow(1px 1px 2px rgba(0,0,0,0.35))' }}>
            <path d="M1,12 L4,6 L9,10 L14,2 L19,10 L24,6 L27,12" fill={hat.color} />
            <circle cx="4" cy="6" r="2" fill="#f472b6" />
            <circle cx="14" cy="2" r="2" fill="#38bdf8" />
            <circle cx="24" cy="6" r="2" fill="#a3e635" />
          </svg>
        </div>
      );
      
    default:
      return null;
  }
}

export function SpriteWithHat({
  species,
  shiny = false,
  cosmeticForm,
  back = false,
  hatId = 'none',
  fusion,
  fusionSpriteBase = '/fusion-sprites',
  spriteMode = 'auto',
  aiSpritesBase = '/ai-sprites',
  splicedSpritesBase = '/spliced-sprites',
  hatYOffset = 10,
  size = 80,
  zoomEnabled = false,
  zoomScale = 2,
  className = '',
  style = {},
  alt = '',
}: SpriteWithHatProps) {
  // Track whether we need to flip the sprite as a fallback for missing back sprite
  const [useFlipFallback, setUseFlipFallback] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [currentMode, setCurrentMode] = useState<SpriteMode>(spriteMode);
  
  // Determine sprite URL based on mode - fusion sprites take priority
  const getFusionUrl = useCallback((mode: SpriteMode = currentMode) => {
    if (!fusion) return null;
    const { headId, bodyId, spriteFile } = fusion;
    
    // If specific file provided, use it
    if (spriteFile) {
      return `${fusionSpriteBase}/${spriteFile}`;
    }
    
    const filename = `${headId}.${bodyId}.png`;
    
    switch (mode) {
      case 'ai-generated':
        return `${aiSpritesBase}/${filename}`;
      case 'two-step':
        return `${splicedSpritesBase}/${filename}`;
      case 'auto':
      default:
        // Auto mode tries fusion base first
        return `${fusionSpriteBase}/${filename}`;
    }
  }, [fusion, fusionSpriteBase, aiSpritesBase, splicedSpritesBase, currentMode]);
  
  const [imgSrc, setImgSrc] = useState(() => {
    const fusionUrl = getFusionUrl();
    if (fusionUrl) return fusionUrl;
    return spriteUrl(species, shiny, { cosmetic: cosmeticForm, back });
  });
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [fallbackLevel, setFallbackLevel] = useState(0);

  useEffect(() => {
    const fusionUrl = getFusionUrl();
    setFallbackUsed(false);
    setFallbackLevel(0);
    setUseFlipFallback(false);
    if (fusionUrl) {
      setImgSrc(fusionUrl);
      return;
    }
    setImgSrc(spriteUrl(species, shiny, { cosmetic: cosmeticForm, back }));
  }, [species, shiny, cosmeticForm, back, fusion, fusionSpriteBase, spriteMode, getFusionUrl]);
  
  // Reset zoom when sprite changes
  useEffect(() => {
    setIsZoomed(false);
  }, [species, fusion]);
  
  const handleError = useCallback(() => {
    setFallbackLevel(prev => prev + 1);
    
    // Fallback chain:
    // 1. If back sprite fails, try front sprite with flip
    // 2. If fusion fails, try alternative mode (AI -> two-step -> auto)
    // 3. Fall back to regular species sprite
    // 4. Fall back to gen5 set
    // 5. Use placeholder
    
    if (back && !useFlipFallback && fallbackLevel === 0) {
      // Back sprite failed - use front sprite with horizontal flip
      setUseFlipFallback(true);
      if (fusion) {
        const { headId, bodyId, spriteFile } = fusion;
        const filename = spriteFile || `${headId}.${bodyId}.png`;
        // Try front sprite (same filename, sprite provider should return front)
        setImgSrc(`${fusionSpriteBase}/${filename}`);
      } else {
        setImgSrc(spriteUrl(species, shiny, { cosmetic: cosmeticForm, back: false }));
      }
      return;
    }
    
    if (fusion && fallbackLevel < 3) {
      // Try alternative sprite modes for fusion
      if (currentMode === 'ai-generated' && fallbackLevel === 1) {
        setCurrentMode('two-step');
        setImgSrc(getFusionUrl('two-step')!);
        return;
      }
      if (currentMode === 'two-step' && fallbackLevel === 1) {
        setCurrentMode('ai-generated');
        setImgSrc(getFusionUrl('ai-generated')!);
        return;
      }
      if (fallbackLevel === 2) {
        // Try default fusion filename
        const defaultFusion = `${fusionSpriteBase}/${fusion.headId}.${fusion.bodyId}.png`;
        if (imgSrc !== defaultFusion) {
          setImgSrc(defaultFusion);
          return;
        }
      }
    }
    
    if (fallbackUsed) {
      setImgSrc(placeholderSpriteDataURL('?'));
      return;
    }
    setFallbackUsed(true);
    // Fall back to regular species sprite
    setImgSrc(spriteUrl(species, shiny, { setOverride: 'gen5', cosmetic: cosmeticForm, back: false }));
    setUseFlipFallback(back); // If we wanted back view, flip the fallback
  }, [species, shiny, cosmeticForm, back, fallbackUsed, fallbackLevel, fusion, fusionSpriteBase, imgSrc, useFlipFallback, currentMode, getFusionUrl]);
  
  const handleClick = useCallback(() => {
    if (zoomEnabled) {
      setIsZoomed(prev => !prev);
    }
  }, [zoomEnabled]);
  
  return (
    <div
      className={`sprite-with-hat ${className} ${zoomEnabled ? 'sprite-with-hat--zoomable' : ''} ${isZoomed ? 'sprite-with-hat--zoomed' : ''}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: zoomEnabled ? 'pointer' : 'default',
        transition: 'transform 0.2s ease',
        transform: isZoomed ? `scale(${zoomScale})` : 'scale(1)',
        zIndex: isZoomed ? 100 : 1,
        ...style,
      }}
      onClick={handleClick}
    >
      <img
        src={imgSrc}
        alt={alt || species}
        style={{
          imageRendering: 'pixelated',
          maxWidth: size,
          maxHeight: size,
          // Flip horizontally if using flip fallback for back view
          transform: useFlipFallback && back ? 'scaleX(-1)' : undefined,
        }}
        onError={handleError}
      />
      {hatId !== 'none' && (
        <div style={{
          position: 'absolute',
          top: `${hatYOffset}%`,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}>
          <HatOverlay hatId={hatId} size={size} />
        </div>
      )}
      {/* Sprite mode indicator (small, subtle) */}
      {fusion && currentMode !== spriteMode && (
        <div style={{
          position: 'absolute',
          bottom: 2,
          right: 2,
          fontSize: 10,
          opacity: 0.6,
          pointerEvents: 'none',
        }}>
          {currentMode === 'ai-generated' ? '🤖' : currentMode === 'two-step' ? '✂️' : '📁'}
        </div>
      )}
    </div>
  );
}

/** Hat picker component for selecting a hat */
export function HatPicker({
  selectedHat,
  onSelect,
  compact = false,
}: {
  selectedHat: HatId;
  onSelect: (hatId: HatId) => void;
  compact?: boolean;
}) {
  return (
    <div className={`hat-picker ${compact ? 'hat-picker--compact' : ''}`} style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: compact ? 4 : 8,
      padding: compact ? 4 : 8,
      background: 'var(--panel-bg, #1a1a2e)',
      borderRadius: 8,
      border: '1px solid var(--border-color, #333)',
    }}>
      {AVAILABLE_HATS.map(hat => (
        <button
          key={hat.id}
          onClick={() => onSelect(hat.id)}
          title={hat.name}
          style={{
            width: compact ? 28 : 36,
            height: compact ? 28 : 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: compact ? 14 : 18,
            borderRadius: 6,
            border: selectedHat === hat.id ? '2px solid var(--accent-color, #6366f1)' : '1px solid var(--border-color, #444)',
            background: selectedHat === hat.id ? 'rgba(99, 102, 241, 0.2)' : 'var(--btn-bg, #2a2a3e)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {hat.icon}
        </button>
      ))}
    </div>
  );
}

/** Sprite mode toggle for selecting AI-generated vs two-step spliced sprites */
export function SpriteModeToggle({
  mode,
  onModeChange,
  compact = false,
}: {
  mode: SpriteMode;
  onModeChange: (mode: SpriteMode) => void;
  compact?: boolean;
}) {
  const modes: { id: SpriteMode; name: string; icon: string; description: string }[] = [
    { id: 'auto', name: 'Auto', icon: '📁', description: 'Automatically select best available' },
    { id: 'ai-generated', name: 'AI', icon: '🤖', description: 'AI-generated sprites (OneTrainer LoRA)' },
    { id: 'two-step', name: 'Spliced', icon: '✂️', description: 'Two-step spliced sprites (InfiniteFusion style)' },
  ];

  return (
    <div className={`sprite-mode-toggle ${compact ? 'sprite-mode-toggle--compact' : ''}`} style={{
      display: 'flex',
      gap: compact ? 2 : 4,
      padding: compact ? 2 : 4,
      background: 'var(--panel-bg, #1a1a2e)',
      borderRadius: 6,
      border: '1px solid var(--border-color, #333)',
    }}>
      {modes.map(m => (
        <button
          key={m.id}
          onClick={() => onModeChange(m.id)}
          title={m.description}
          style={{
            padding: compact ? '4px 8px' : '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: compact ? 12 : 14,
            borderRadius: 4,
            border: mode === m.id ? '2px solid var(--accent-color, #6366f1)' : '1px solid transparent',
            background: mode === m.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            color: mode === m.id ? 'var(--accent-color, #6366f1)' : 'var(--text-color, #ccc)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <span>{m.icon}</span>
          {!compact && <span>{m.name}</span>}
        </button>
      ))}
    </div>
  );
}

export default SpriteWithHat;
