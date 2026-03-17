/**
 * SpriteWithHat - Renders a Pokemon sprite with an optional hat overlay
 * 
 * The hat is positioned relative to the sprite and can be offset for fine-tuning.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { spriteUrl, spriteUrlWithFallback, placeholderSpriteDataURL, getFusionApiBases } from '../data/adapter';
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
  /** Explicit front sprite URL/data URL for this specific Pokemon instance */
  spriteOverride?: string;
  /** Explicit back sprite URL/data URL for this specific Pokemon instance */
  backSpriteOverride?: string;
  hatId?: HatId;
  /** Use browser-native lazy loading (for grid/list contexts) */
  lazy?: boolean;
  /** Fusion data for displaying fusion sprites */
  fusion?: {
    headId: number;
    bodyId: number;
    spriteFile?: string;
    variants?: string[];
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
  /** Hat horizontal offset from center (-50 to 50, percentage), default 0 */
  hatXOffset?: number;
  /** Hat scale multiplier (default 1) */
  hatScale?: number;
  /** Sprite dimensions */
  size?: number;
  /** Enable zoom on click */
  zoomEnabled?: boolean;
  /** Zoom scale factor (default: 2) */
  zoomScale?: number;
  /** Callback when hat is dragged — provides new x/y offset percentages */
  onHatMove?: (xOffset: number, yOffset: number) => void;
  /** Callback when hat is resized via scroll wheel — provides new scale */
  onHatScale?: (scale: number) => void;
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
  spriteOverride,
  backSpriteOverride,
  hatId = 'none',
  lazy = false,
  fusion,
  fusionSpriteBase = '/fusion-sprites',
  spriteMode = 'auto',
  aiSpritesBase = '/ai-sprites',
  splicedSpritesBase = '/spliced-sprites',
  hatYOffset = 10,
  hatXOffset = 0,
  hatScale = 1,
  size = 96,
  zoomEnabled = false,
  zoomScale = 2,
  onHatMove,
  onHatScale,
  className = '',
  style = {},
  alt = '',
}: SpriteWithHatProps) {
  // Track whether we need to flip the sprite as a fallback for missing back sprite
  const [useFlipFallback, setUseFlipFallback] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [currentMode, setCurrentMode] = useState<SpriteMode>(spriteMode);
  const [fusionCandidateIndex, setFusionCandidateIndex] = useState(0);
  
  // Determine sprite URL based on mode - fusion sprites take priority
  const getFusionUrl = useCallback((mode: SpriteMode = currentMode) => {
    if (!fusion) return null;
    const { headId, bodyId, spriteFile } = fusion;

    // Normalize spriteFile: if it's a bare variant key (e.g. 'a', 'b', 'default'),
    // expand it to a proper filename using headId.bodyId
    let normalizedSpriteFile = spriteFile;
    if (normalizedSpriteFile && headId && bodyId) {
      const sf = normalizedSpriteFile.trim();
      if (sf === 'default' || sf === '') {
        normalizedSpriteFile = `${headId}.${bodyId}.png`;
      } else if (/^[a-zA-Z]$/.test(sf)) {
        // Single letter variant key → expand to full filename
        normalizedSpriteFile = `${headId}.${bodyId}${sf}.png`;
      } else if (/^v\d+$/.test(sf)) {
        // Version variant like 'v1', 'v2' → expand
        normalizedSpriteFile = `${headId}.${bodyId}${sf}.png`;
      }
    }

    const files: string[] = [];
    const addFile = (value: unknown) => {
      const v = String(value || '').trim();
      if (!v) return;
      if (!files.includes(v)) files.push(v);
    };
    addFile(normalizedSpriteFile);
    const variants = Array.isArray(fusion.variants) ? fusion.variants : [];
    for (const v of variants) addFile(v);
    addFile(`${headId}.${bodyId}v1.png`);
    addFile(`${headId}.${bodyId}v2.png`);
    addFile(`${headId}.${bodyId}v3.png`);
    addFile(`${headId}.${bodyId}.png`);
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      addFile(`${headId}.${bodyId}${letter}.png`);
    }
    
    // If specific file provided, use it
    if (spriteFile) {
      if (/^https?:\/\//i.test(spriteFile) || /^data:image\//i.test(spriteFile) || spriteFile.startsWith('/')) {
        return spriteFile;
      }
    }
    
    switch (mode) {
      case 'ai-generated':
        return `${aiSpritesBase}/${files[0] || `${headId}.${bodyId}.png`}`;
      case 'two-step':
        return `${splicedSpritesBase}/${files[0] || `${headId}.${bodyId}.png`}`;
      case 'auto':
      default:
        break;
    }

    const apiBases = getFusionApiBases();
    for (const apiBase of apiBases) {
      for (const file of files) {
        if (/^https?:\/\//i.test(file) || /^data:image\//i.test(file) || file.startsWith('/')) continue;
        return `${apiBase}/fusion/sprites/${file}`;
      }
    }

    return `${fusionSpriteBase}/${files[0] || `${headId}.${bodyId}.png`}`;
  }, [fusion, fusionSpriteBase, aiSpritesBase, splicedSpritesBase, currentMode]);

  const getFusionCandidates = useCallback(() => {
    if (!fusion) return [] as string[];
    const files: string[] = [];
    const addFile = (value: unknown) => {
      const v = String(value || '').trim();
      if (!v) return;
      if (!files.includes(v)) files.push(v);
    };
    // Normalize bare variant keys the same way as getFusionUrl
    let normalizedSF = fusion.spriteFile;
    if (normalizedSF && fusion.headId && fusion.bodyId) {
      const sf = normalizedSF.trim();
      if (sf === 'default' || sf === '') {
        normalizedSF = `${fusion.headId}.${fusion.bodyId}.png`;
      } else if (/^[a-zA-Z]$/.test(sf)) {
        normalizedSF = `${fusion.headId}.${fusion.bodyId}${sf}.png`;
      } else if (/^v\d+$/.test(sf)) {
        normalizedSF = `${fusion.headId}.${fusion.bodyId}${sf}.png`;
      }
    }
    addFile(normalizedSF);
    const variants = Array.isArray(fusion.variants) ? fusion.variants : [];
    for (const v of variants) addFile(v);
    addFile(`${fusion.headId}.${fusion.bodyId}v1.png`);
    addFile(`${fusion.headId}.${fusion.bodyId}v2.png`);
    addFile(`${fusion.headId}.${fusion.bodyId}v3.png`);
    addFile(`${fusion.headId}.${fusion.bodyId}.png`);
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      addFile(`${fusion.headId}.${fusion.bodyId}${letter}.png`);
    }

    const out: string[] = [];
    const push = (value: string) => {
      if (value && !out.includes(value)) out.push(value);
    };

    // Direct absolute/data file first if present
    if (fusion.spriteFile && (/^https?:\/\//i.test(fusion.spriteFile) || /^data:image\//i.test(fusion.spriteFile) || fusion.spriteFile.startsWith('/'))) {
      push(fusion.spriteFile);
    }

    const apiBases = getFusionApiBases();
    for (const apiBase of apiBases) {
      for (const file of files) {
        if (/^https?:\/\//i.test(file) || /^data:image\//i.test(file) || file.startsWith('/')) continue;
        push(`${apiBase}/fusion/sprites/${file}`);
      }
    }

    for (const file of files) {
      if (/^https?:\/\//i.test(file) || /^data:image\//i.test(file) || file.startsWith('/')) continue;
      push(`${fusionSpriteBase}/${file}`);
      push(`${aiSpritesBase}/${file}`);
      push(`${splicedSpritesBase}/${file}`);
    }

    return out;
  }, [fusion, fusionSpriteBase, aiSpritesBase, splicedSpritesBase]);

  const getRegularUrl = useCallback((preferBack: boolean) => {
    if (preferBack && backSpriteOverride) return backSpriteOverride;
    if (!preferBack && spriteOverride) return spriteOverride;
    if (preferBack && spriteOverride) return spriteOverride;
    return spriteUrl(species, shiny, { cosmetic: cosmeticForm, back: preferBack });
  }, [backSpriteOverride, spriteOverride, species, shiny, cosmeticForm]);

  // Build a comprehensive multi-base candidate list for regular (non-fusion) sprites
  const regularCandidates = useMemo(() => {
    if (fusion) return [] as string[];
    const chain = spriteUrlWithFallback(species, () => {}, { shiny, cosmetic: cosmeticForm, back });
    const urls: string[] = [];
    if (spriteOverride) urls.push(spriteOverride);
    if (backSpriteOverride && back) urls.push(backSpriteOverride);
    for (const c of chain.candidates) {
      if (!urls.includes(c)) urls.push(c);
    }
    return urls;
  }, [species, shiny, cosmeticForm, back, fusion, spriteOverride, backSpriteOverride]);
  
  const [imgSrc, setImgSrc] = useState(() => {
    const fusionUrl = getFusionUrl();
    if (fusionUrl) return fusionUrl;
    return regularCandidates[0] || getRegularUrl(back);
  });
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [fallbackLevel, setFallbackLevel] = useState(0);
  const [triedNonShinyFallback, setTriedNonShinyFallback] = useState(false);
  const regularIdxRef = useRef(0);

  useEffect(() => {
    const fusionUrl = getFusionUrl();
    setFusionCandidateIndex(0);
    setFallbackUsed(false);
    setFallbackLevel(0);
    setTriedNonShinyFallback(false);
    setUseFlipFallback(false);
    regularIdxRef.current = 0;
    if (fusionUrl) {
      setImgSrc(fusionUrl);
      return;
    }
    setImgSrc(regularCandidates[0] || getRegularUrl(back));
    setUseFlipFallback(!!(back && !backSpriteOverride && spriteOverride));
  }, [species, shiny, cosmeticForm, back, fusion, fusionSpriteBase, spriteMode, getFusionUrl, getRegularUrl, backSpriteOverride, spriteOverride, regularCandidates]);
  
  // Reset zoom when sprite changes
  useEffect(() => {
    setIsZoomed(false);
  }, [species, fusion]);
  
  const handleError = useCallback(() => {
    setFallbackLevel(prev => prev + 1);
    
    // Fusion sprites: cycle through fusion candidates first
    if (fusion && fallbackLevel < 3) {
      const candidates = getFusionCandidates();
      if (fusionCandidateIndex + 1 < candidates.length) {
        const next = fusionCandidateIndex + 1;
        setFusionCandidateIndex(next);
        setImgSrc(candidates[next]);
        return;
      }

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
        const defaultFusion = `${fusionSpriteBase}/${fusion.headId}.${fusion.bodyId}.png`;
        if (imgSrc !== defaultFusion) {
          setImgSrc(defaultFusion);
          return;
        }
      }
    }

    // Regular sprites: iterate through multi-base candidate list
    if (!fusion && regularCandidates.length > 0) {
      regularIdxRef.current++;
      if (regularIdxRef.current < regularCandidates.length) {
        const next = regularCandidates[regularIdxRef.current];
        // Detect if we should flip (back requested but trying front URL)
        setUseFlipFallback(back && !next.includes('-back'));
        setImgSrc(next);
        return;
      }
    }

    // Final placeholder
    setImgSrc(placeholderSpriteDataURL('?'));
  }, [species, shiny, cosmeticForm, back, fallbackLevel, fusion, fusionSpriteBase, imgSrc, useFlipFallback, currentMode, getFusionUrl, getFusionCandidates, getRegularUrl, spriteOverride, triedNonShinyFallback, fusionCandidateIndex, regularCandidates]);
  
  // ── Hat drag state ──
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const handleHatPointerDown = useCallback((e: React.PointerEvent) => {
    if (!onHatMove) return;
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: hatXOffset, oy: hatYOffset };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [onHatMove, hatXOffset, hatYOffset]);

  const handleHatPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !onHatMove || !containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    // Convert pixel delta to percentage of container size
    const newX = Math.round(Math.max(-50, Math.min(50, dragStartRef.current.ox + (dx / rect.width) * 100)));
    const newY = Math.round(Math.max(-30, Math.min(80, dragStartRef.current.oy + (dy / rect.height) * 100)));
    onHatMove(newX, newY);
  }, [onHatMove]);

  const handleHatPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleHatWheel = useCallback((e: React.WheelEvent) => {
    if (!onHatScale) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.3, Math.min(3, (hatScale ?? 1) + delta));
    onHatScale(Math.round(newScale * 10) / 10);
  }, [onHatScale, hatScale]);

  const handleClick = useCallback(() => {
    if (zoomEnabled) {
      setIsZoomed(prev => !prev);
    }
  }, [zoomEnabled]);
  
  const isDraggable = !!onHatMove;
  
  return (
    <div
      ref={containerRef}
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
        loading={lazy ? 'lazy' : undefined}
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
        <div
          style={{
            position: 'absolute',
            top: `${hatYOffset}%`,
            left: `${50 + (hatXOffset || 0)}%`,
            transform: `translateX(-50%) scale(${hatScale ?? 1})`,
            pointerEvents: isDraggable ? 'auto' : 'none',
            cursor: isDraggable ? (draggingRef.current ? 'grabbing' : 'grab') : 'default',
            userSelect: 'none',
            touchAction: 'none',
          }}
          onPointerDown={isDraggable ? handleHatPointerDown : undefined}
          onPointerMove={isDraggable ? handleHatPointerMove : undefined}
          onPointerUp={isDraggable ? handleHatPointerUp : undefined}
          onWheel={onHatScale ? handleHatWheel : undefined}
          title={isDraggable ? 'Drag to move hat • Scroll to resize' : undefined}
        >
          <HatOverlay hatId={hatId} size={size} />
          {/* Resize ring indicator when draggable */}
          {isDraggable && (
            <div style={{
              position: 'absolute',
              inset: -3,
              border: '1px dashed rgba(255,255,255,0.4)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }} />
          )}
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
