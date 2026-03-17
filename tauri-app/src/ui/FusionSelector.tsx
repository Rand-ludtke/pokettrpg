/**
 * FusionSelector - UI component for selecting fusion sprite variants
 * 
 * Displays available sprite variants for a fusion and allows selection.
 * Syncs automatically with other players via Rust backend.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useFusionSprite, useSyncStatus } from '../hooks/useFusionSync';
import type { FusionStats, PokemonStats } from '../types/fusion';
import { generateFusionName, calculateFusionStats } from '../types/fusion';

interface FusionSelectorProps {
  /** Head Pokemon ID */
  headId: number;
  /** Body Pokemon ID */
  bodyId: number;
  /** Head Pokemon name */
  headName: string;
  /** Body Pokemon name */
  bodyName: string;
  /** Head Pokemon base stats */
  headStats?: PokemonStats;
  /** Body Pokemon base stats */
  bodyStats?: PokemonStats;
  /** Base URL for sprite images */
  spriteBaseUrl?: string;
  /** Callback when sprite is selected */
  onSelect?: (spriteFile: string) => void;
  /** Callback for custom sprite upload */
  onCustomUpload?: (file: File) => Promise<string>;
  /** Show stats comparison */
  showStats?: boolean;
  /** Compact mode */
  compact?: boolean;
}

export function FusionSelector({
  headId,
  bodyId,
  headName,
  bodyName,
  headStats,
  bodyStats,
  spriteBaseUrl = '/fusion-sprites',
  onSelect,
  onCustomUpload,
  showStats = true,
  compact = false,
}: FusionSelectorProps) {
  const { sprite, variants, loading, error, selectVariant, setCustomUrl } = useFusionSprite(headId, bodyId);
  const syncStatus = useSyncStatus();
  
  const [uploading, setUploading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Generate fusion name
  const fusionName = useMemo(() => generateFusionName(headName, bodyName), [headName, bodyName]);

  // Calculate fusion stats
  const fusionStats = useMemo(() => {
    if (!headStats || !bodyStats) return null;
    return calculateFusionStats(headStats, bodyStats);
  }, [headStats, bodyStats]);

  // Get sprite URL
  const getSpriteUrl = useCallback((filename: string) => {
    if (filename.startsWith('http') || filename.startsWith('data:')) {
      return filename;
    }
    return `${spriteBaseUrl}/${filename}`;
  }, [spriteBaseUrl]);

  // Handle variant selection
  const handleSelect = useCallback(async (filename: string) => {
    const success = await selectVariant(filename);
    if (success && onSelect) {
      onSelect(filename);
    }
  }, [selectVariant, onSelect]);

  // Handle custom sprite upload
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onCustomUpload) return;
    
    setUploading(true);
    try {
      const url = await onCustomUpload(file);
      await setCustomUrl(url);
      onSelect?.(url);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [onCustomUpload, setCustomUrl, onSelect]);

  // Preview navigation
  const handlePreviewNav = useCallback((delta: number) => {
    if (variants.length === 0) return;
    setPreviewIndex(prev => {
      const next = prev + delta;
      if (next < 0) return variants.length - 1;
      if (next >= variants.length) return 0;
      return next;
    });
  }, [variants.length]);

  if (loading) {
    return (
      <div className="fusion-selector fusion-selector--loading">
        <div className="fusion-selector__spinner" />
        <span>Loading fusion sprites...</span>
      </div>
    );
  }

  return (
    <div className={`fusion-selector ${compact ? 'fusion-selector--compact' : ''}`}>
      {/* Header */}
      <div className="fusion-selector__header">
        <h3 className="fusion-selector__name">{fusionName}</h3>
        <span className={`fusion-selector__sync-badge fusion-selector__sync-badge--${syncStatus}`}>
          {syncStatus === 'connected' ? '● Synced' : syncStatus}
        </span>
      </div>

      {/* Main Preview */}
      <div className="fusion-selector__preview">
        {variants.length > 1 && (
          <button 
            className="fusion-selector__nav fusion-selector__nav--prev"
            onClick={() => handlePreviewNav(-1)}
            aria-label="Previous variant"
          >
            ‹
          </button>
        )}
        
        <div className="fusion-selector__sprite-container">
          <img
            className="fusion-selector__sprite"
            src={getSpriteUrl(variants[previewIndex] || sprite?.spriteFile || `${headId}.${bodyId}.png`)}
            alt={`${fusionName} sprite`}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/fallback-sprite.png';
            }}
          />
          {sprite?.customUrl && (
            <span className="fusion-selector__custom-badge">Custom</span>
          )}
        </div>

        {variants.length > 1 && (
          <button 
            className="fusion-selector__nav fusion-selector__nav--next"
            onClick={() => handlePreviewNav(1)}
            aria-label="Next variant"
          >
            ›
          </button>
        )}
      </div>

      {/* Variant counter */}
      {variants.length > 1 && (
        <div className="fusion-selector__counter">
          {previewIndex + 1} / {variants.length}
        </div>
      )}

      {/* Variant thumbnails */}
      {!compact && variants.length > 1 && (
        <div className="fusion-selector__variants">
          {variants.map((filename, idx) => (
            <button
              key={filename}
              className={`fusion-selector__variant ${
                filename === sprite?.spriteFile ? 'fusion-selector__variant--selected' : ''
              } ${idx === previewIndex ? 'fusion-selector__variant--preview' : ''}`}
              onClick={() => {
                setPreviewIndex(idx);
                handleSelect(filename);
              }}
              title={filename}
            >
              <img
                src={getSpriteUrl(filename)}
                alt={`Variant ${idx + 1}`}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Select button for compact mode */}
      {compact && variants.length > 0 && (
        <button
          className="fusion-selector__select-btn"
          onClick={() => handleSelect(variants[previewIndex])}
          disabled={variants[previewIndex] === sprite?.spriteFile}
        >
          {variants[previewIndex] === sprite?.spriteFile ? 'Selected' : 'Select'}
        </button>
      )}

      {/* Custom upload */}
      {onCustomUpload && (
        <div className="fusion-selector__upload">
          <label className="fusion-selector__upload-label">
            <input
              type="file"
              accept="image/png,image/gif"
              onChange={handleUpload}
              disabled={uploading}
            />
            <span>{uploading ? 'Uploading...' : '📤 Upload Custom Sprite'}</span>
          </label>
        </div>
      )}

      {/* Stats display */}
      {showStats && fusionStats && (
        <div className="fusion-selector__stats">
          <h4>Base Stats</h4>
          <div className="fusion-selector__stat-bars">
            <StatBar label="HP" value={fusionStats.hp} max={255} />
            <StatBar label="Atk" value={fusionStats.attack} max={190} />
            <StatBar label="Def" value={fusionStats.defense} max={230} />
            <StatBar label="SpA" value={fusionStats.spAttack} max={194} />
            <StatBar label="SpD" value={fusionStats.spDefense} max={230} />
            <StatBar label="Spe" value={fusionStats.speed} max={180} />
          </div>
          <div className="fusion-selector__stat-total">
            BST: {fusionStats.hp + fusionStats.attack + fusionStats.defense + 
                  fusionStats.spAttack + fusionStats.spDefense + fusionStats.speed}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="fusion-selector__error">
          {error}
        </div>
      )}

      {/* Parent Pokemon info */}
      {!compact && (
        <div className="fusion-selector__parents">
          <span className="fusion-selector__parent">
            <strong>Head:</strong> {headName} (#{headId})
          </span>
          <span className="fusion-selector__parent">
            <strong>Body:</strong> {bodyName} (#{bodyId})
          </span>
        </div>
      )}
    </div>
  );
}

// Stat bar component
function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  const percentage = Math.min(100, (value / max) * 100);
  const color = percentage > 80 ? '#4CAF50' : percentage > 50 ? '#FFC107' : '#F44336';
  
  return (
    <div className="fusion-selector__stat-row">
      <span className="fusion-selector__stat-label">{label}</span>
      <div className="fusion-selector__stat-bar">
        <div 
          className="fusion-selector__stat-fill" 
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
      <span className="fusion-selector__stat-value">{value}</span>
    </div>
  );
}

export default FusionSelector;
