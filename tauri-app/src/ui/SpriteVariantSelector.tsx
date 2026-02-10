/**
 * SpriteVariantSelector - Component for selecting sprite variants (AI-generated vs two-step spliced)
 * 
 * Features:
 * - Toggle between AI-generated and two-step approach sprites
 * - Select from available sprite variants (alt1, alt2, etc.)
 * - Preserves zooming and back-sprite behavior
 * - Fallback: flip front sprite if back sprite unavailable
 */
import React, { useState, useEffect, useCallback } from 'react';
import { spriteUrl, placeholderSpriteDataURL } from '../data/adapter';

export type SpriteMode = 'ai-generated' | 'two-step' | 'auto';

export interface SpriteVariant {
  filename: string;
  isAlt: boolean;
  variant?: string; // e.g., 'alt1', 'a', 'b'
  mode: SpriteMode;
}

export interface FusionSpriteConfig {
  headId: number;
  bodyId: number;
  availableVariants?: string[];
  selectedVariant?: string;
  mode?: SpriteMode;
}

interface SpriteVariantSelectorProps {
  /** Pokemon species (for non-fusion sprites) */
  species?: string;
  /** Fusion configuration */
  fusion?: FusionSpriteConfig;
  /** Show shiny variant */
  shiny?: boolean;
  /** Show back sprite */
  back?: boolean;
  /** Cosmetic form */
  cosmeticForm?: string;
  /** Base URL for fusion sprites */
  fusionSpriteBase?: string;
  /** Base URL for AI-generated sprites */
  aiSpriteBase?: string;
  /** Base URL for two-step spliced sprites */
  twoStepSpriteBase?: string;
  /** Sprite dimensions */
  size?: number;
  /** Enable zoom on hover */
  zoomOnHover?: boolean;
  /** Zoom scale factor */
  zoomScale?: number;
  /** Callback when variant changes */
  onVariantChange?: (variant: string, mode: SpriteMode) => void;
  /** Callback when back sprite fails (triggers flip fallback) */
  onBackSpriteFallback?: () => void;
  /** Additional className */
  className?: string;
  /** Additional style */
  style?: React.CSSProperties;
  /** Alt text */
  alt?: string;
}

/**
 * Parse variant info from filename
 * Supports: 25.6.png, 25.6_alt1.png, 25.6a.png
 */
function parseVariantFilename(filename: string): { headId: number; bodyId: number; variant?: string } | null {
  // Underscore format: 25.6_alt1.png
  const underscore = filename.match(/^(\d+)\.(\d+)_([A-Za-z0-9]+)\.png$/);
  if (underscore) {
    return { headId: Number(underscore[1]), bodyId: Number(underscore[2]), variant: underscore[3] };
  }
  // Suffix format: 25.6a.png
  const suffix = filename.match(/^(\d+)\.(\d+)([A-Za-z]+)\.png$/);
  if (suffix) {
    return { headId: Number(suffix[1]), bodyId: Number(suffix[2]), variant: suffix[3] };
  }
  // Base format: 25.6.png
  const base = filename.match(/^(\d+)\.(\d+)\.png$/);
  if (base) {
    return { headId: Number(base[1]), bodyId: Number(base[2]) };
  }
  return null;
}

/**
 * Build sprite URL based on mode and configuration
 */
function buildSpriteUrl(
  config: {
    fusion?: FusionSpriteConfig;
    species?: string;
    shiny?: boolean;
    back?: boolean;
    cosmeticForm?: string;
    mode?: SpriteMode;
    fusionSpriteBase?: string;
    aiSpriteBase?: string;
    twoStepSpriteBase?: string;
  }
): string {
  const {
    fusion,
    species,
    shiny,
    back,
    cosmeticForm,
    mode = 'auto',
    fusionSpriteBase = '/fusion-sprites',
    aiSpriteBase = '/ai-sprites',
    twoStepSpriteBase = '/spliced-sprites',
  } = config;

  if (fusion) {
    const { headId, bodyId, selectedVariant } = fusion;
    const filename = selectedVariant || `${headId}.${bodyId}.png`;
    
    // Determine base path based on mode
    let basePath = fusionSpriteBase;
    if (mode === 'ai-generated') {
      basePath = aiSpriteBase;
    } else if (mode === 'two-step') {
      basePath = twoStepSpriteBase;
    }
    
    // Handle back sprites for fusions
    if (back) {
      // Try back sprite path first
      const backFilename = filename.replace('.png', '_back.png');
      return `${basePath}/back/${backFilename}`;
    }
    
    return `${basePath}/${filename}`;
  }

  // Regular Pokemon sprite
  if (species) {
    return spriteUrl(species, shiny, { cosmetic: cosmeticForm, back });
  }

  return placeholderSpriteDataURL('?');
}

export function SpriteVariantSelector({
  species,
  fusion,
  shiny = false,
  back = false,
  cosmeticForm,
  fusionSpriteBase = '/fusion-sprites',
  aiSpriteBase = '/ai-sprites',
  twoStepSpriteBase = '/spliced-sprites',
  size = 96,
  zoomOnHover = true,
  zoomScale = 1.5,
  onVariantChange,
  onBackSpriteFallback,
  className = '',
  style = {},
  alt = '',
}: SpriteVariantSelectorProps) {
  const [mode, setMode] = useState<SpriteMode>(fusion?.mode || 'auto');
  const [selectedVariant, setSelectedVariant] = useState(fusion?.selectedVariant || '');
  const [imgSrc, setImgSrc] = useState('');
  const [isZoomed, setIsZoomed] = useState(false);
  const [useFlipFallback, setUseFlipFallback] = useState(false);
  const [loadAttempts, setLoadAttempts] = useState(0);

  // Build sprite URL when config changes
  useEffect(() => {
    const url = buildSpriteUrl({
      fusion: fusion ? { ...fusion, selectedVariant } : undefined,
      species,
      shiny,
      back: back && !useFlipFallback,
      cosmeticForm,
      mode,
      fusionSpriteBase,
      aiSpriteBase,
      twoStepSpriteBase,
    });
    setImgSrc(url);
    setLoadAttempts(0);
  }, [
    fusion,
    species,
    shiny,
    back,
    cosmeticForm,
    mode,
    selectedVariant,
    useFlipFallback,
    fusionSpriteBase,
    aiSpriteBase,
    twoStepSpriteBase,
  ]);

  // Handle image load error with fallback chain
  const handleError = useCallback(() => {
    const nextAttempt = loadAttempts + 1;
    setLoadAttempts(nextAttempt);

    // Fallback chain:
    // 1. If back sprite failed, try flip fallback
    // 2. If AI sprite failed, try two-step
    // 3. If two-step failed, try default fusion path
    // 4. If fusion failed, try regular species
    // 5. Finally, use placeholder

    if (back && !useFlipFallback && nextAttempt === 1) {
      // Back sprite not available - use flip fallback
      setUseFlipFallback(true);
      onBackSpriteFallback?.();
      return;
    }

    if (mode === 'ai-generated' && nextAttempt <= 2) {
      // Try two-step approach
      setMode('two-step');
      return;
    }

    if (mode === 'two-step' && nextAttempt <= 3) {
      // Try default fusion path
      setMode('auto');
      return;
    }

    if (fusion && nextAttempt <= 4) {
      // Try regular species fallback
      const regularUrl = spriteUrl(species || 'unown', shiny, { cosmetic: cosmeticForm, back: back && !useFlipFallback });
      setImgSrc(regularUrl);
      return;
    }

    // Final fallback: placeholder
    setImgSrc(placeholderSpriteDataURL('?'));
  }, [back, useFlipFallback, mode, fusion, species, shiny, cosmeticForm, loadAttempts, onBackSpriteFallback]);

  // Handle variant selection
  const handleVariantSelect = useCallback((variant: string) => {
    setSelectedVariant(variant);
    onVariantChange?.(variant, mode);
  }, [mode, onVariantChange]);

  // Handle mode toggle
  const handleModeChange = useCallback((newMode: SpriteMode) => {
    setMode(newMode);
    onVariantChange?.(selectedVariant, newMode);
  }, [selectedVariant, onVariantChange]);

  // Compute image style with zoom and flip
  const imgStyle: React.CSSProperties = {
    imageRendering: 'pixelated',
    maxWidth: '100%',
    maxHeight: '100%',
    transform: `scale(${isZoomed ? zoomScale : 1})${useFlipFallback && back ? ' scaleX(-1)' : ''}`,
    transition: 'transform 0.2s ease',
  };

  return (
    <div
      className={`sprite-variant-selector ${className}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...style,
      }}
    >
      {/* Sprite display */}
      <div
        className="sprite-display"
        onMouseEnter={() => zoomOnHover && setIsZoomed(true)}
        onMouseLeave={() => setIsZoomed(false)}
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: isZoomed ? 'visible' : 'hidden',
          zIndex: isZoomed ? 10 : 1,
        }}
      >
        <img
          src={imgSrc}
          alt={alt || species || 'Fusion'}
          style={imgStyle}
          onError={handleError}
        />
      </div>

      {/* Flip indicator when using fallback */}
      {useFlipFallback && back && (
        <div
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            fontSize: 10,
            background: 'rgba(0,0,0,0.6)',
            color: '#fbbf24',
            padding: '1px 4px',
            borderRadius: 3,
          }}
          title="Back sprite unavailable - using flipped front"
        >
          ↔️
        </div>
      )}

      {/* Mode indicator */}
      {fusion && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            fontSize: 10,
            background: mode === 'ai-generated' ? 'rgba(139, 92, 246, 0.8)' : 
                        mode === 'two-step' ? 'rgba(59, 130, 246, 0.8)' : 
                        'rgba(107, 114, 128, 0.8)',
            color: '#fff',
            padding: '1px 4px',
            borderRadius: 3,
          }}
          title={`Mode: ${mode}`}
        >
          {mode === 'ai-generated' ? '🤖' : mode === 'two-step' ? '✂️' : '📁'}
        </div>
      )}
    </div>
  );
}

/**
 * Variant picker for selecting sprite alternatives
 */
export function VariantPicker({
  variants,
  selectedVariant,
  onSelect,
  compact = false,
}: {
  variants: string[];
  selectedVariant: string;
  onSelect: (variant: string) => void;
  compact?: boolean;
}) {
  if (variants.length <= 1) return null;

  return (
    <div
      className={`variant-picker ${compact ? 'compact' : ''}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: compact ? 2 : 4,
        padding: compact ? 2 : 4,
      }}
    >
      {variants.map((variant, idx) => {
        const parsed = parseVariantFilename(variant);
        const label = parsed?.variant || 'Base';
        const isSelected = variant === selectedVariant || (!selectedVariant && idx === 0);

        return (
          <button
            key={variant}
            onClick={() => onSelect(variant)}
            style={{
              padding: compact ? '2px 6px' : '4px 8px',
              fontSize: compact ? 10 : 12,
              borderRadius: 4,
              border: isSelected ? '2px solid var(--accent-color, #6366f1)' : '1px solid var(--border-color, #444)',
              background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'var(--btn-bg, #2a2a3e)',
              color: 'var(--text-color, #fff)',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Mode toggle for switching between AI-generated and two-step sprites
 */
export function SpriteModeToggle({
  mode,
  onModeChange,
  compact = false,
}: {
  mode: SpriteMode;
  onModeChange: (mode: SpriteMode) => void;
  compact?: boolean;
}) {
  const modes: { id: SpriteMode; label: string; icon: string; description: string }[] = [
    { id: 'auto', label: 'Auto', icon: '📁', description: 'Use available sprites' },
    { id: 'ai-generated', label: 'AI', icon: '🤖', description: 'OneTrainer LoRA generated' },
    { id: 'two-step', label: '2-Step', icon: '✂️', description: 'InfiniteFusion spliced' },
  ];

  return (
    <div
      className="sprite-mode-toggle"
      style={{
        display: 'flex',
        gap: compact ? 2 : 4,
        padding: compact ? 2 : 4,
        background: 'var(--panel-bg, #1a1a2e)',
        borderRadius: 6,
        border: '1px solid var(--border-color, #333)',
      }}
    >
      {modes.map(({ id, label, icon, description }) => (
        <button
          key={id}
          onClick={() => onModeChange(id)}
          title={description}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: compact ? '3px 6px' : '5px 10px',
            fontSize: compact ? 10 : 12,
            borderRadius: 4,
            border: mode === id ? '2px solid var(--accent-color, #6366f1)' : '1px solid transparent',
            background: mode === id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            color: 'var(--text-color, #fff)',
            cursor: 'pointer',
          }}
        >
          <span>{icon}</span>
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

export default SpriteVariantSelector;
