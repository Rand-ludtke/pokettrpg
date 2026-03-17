/**
 * Fusion Sync Hooks - React hooks for Rust-powered sync
 * 
 * These hooks listen to Tauri events from the Rust backend and provide
 * reactive state that stays in sync across all players.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type {
  ConnectionStatus,
  FusionSprite,
  FusionVariantsResponse,
  FusionStats,
  PokemonStats,
  SyncEvent,
  IndexBuildResult,
} from '../types/fusion';

/**
 * Hook for sync connection status
 */
export function useSyncStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  useEffect(() => {
    // Get initial status
    invoke<ConnectionStatus>('get_sync_status')
      .then(setStatus)
      .catch(console.error);

    // Listen for status changes
    let unlisten: UnlistenFn | undefined;
    
    listen<SyncEvent>('sync-event', (event) => {
      if (event.payload.type === 'ConnectionChanged') {
        setStatus(event.payload.payload.status);
      }
    }).then(fn => { unlisten = fn; });

    return () => {
      unlisten?.();
    };
  }, []);

  return status;
}

/**
 * Hook for fusion sprite variants and selection
 */
export function useFusionSprite(headId: number, bodyId: number) {
  const [sprite, setSprite] = useState<FusionSprite | null>(null);
  const [variants, setVariants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Load variants on mount or when IDs change
  useEffect(() => {
    if (!headId || !bodyId) return;
    
    setLoading(true);
    setError(null);
    
    invoke<FusionVariantsResponse>('get_fusion_variants', { headId, bodyId })
      .then((response) => {
        setVariants(response.variants);
        if (response.currentSelection) {
          setSprite({
            headId,
            bodyId,
            spriteFile: response.currentSelection,
            variants: response.variants,
          });
        }
      })
      .catch((e) => {
        setError(e.toString());
        // Try to fetch from server if local index is empty
        invoke('request_fusion_variants', { headId, bodyId }).catch(console.error);
      })
      .finally(() => setLoading(false));
  }, [headId, bodyId]);

  // Listen for variant updates from server
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    
    listen<SyncEvent>('sync-event', (event) => {
      const { type, payload } = event.payload;
      
      if (type === 'FusionVariantsLoaded') {
        const p = payload as { headId: number; bodyId: number; variants: string[] };
        if (p.headId === headId && p.bodyId === bodyId) {
          setVariants(p.variants);
        }
      } else if (type === 'FusionSpriteSelected') {
        const p = payload as { headId: number; bodyId: number; spriteFile: string; playerId?: string };
        if (p.headId === headId && p.bodyId === bodyId) {
          setSprite(prev => ({
            headId,
            bodyId,
            spriteFile: p.spriteFile,
            variants: prev?.variants || variants,
          }));
        }
      }
    }).then(fn => { unlisten = fn; });

    return () => {
      unlisten?.();
    };
  }, [headId, bodyId, variants]);

  // Select a sprite variant
  const selectVariant = useCallback(async (spriteFile: string) => {
    try {
      const success = await invoke<boolean>('select_fusion_sprite', {
        headId,
        bodyId,
        spriteFile,
      });
      
      if (success) {
        setSprite(prev => ({
          headId,
          bodyId,
          spriteFile,
          variants: prev?.variants || variants,
        }));
      }
      
      return success;
    } catch (e) {
      setError(e?.toString() || 'Failed to select sprite');
      return false;
    }
  }, [headId, bodyId, variants]);

  // Set custom sprite URL
  const setCustomUrl = useCallback(async (url: string) => {
    try {
      await invoke('set_fusion_custom_sprite', {
        headId,
        bodyId,
        customUrl: url,
      });
      
      setSprite(prev => ({
        headId,
        bodyId,
        spriteFile: url,
        variants: prev?.variants || variants,
        customUrl: url,
      }));
    } catch (e) {
      setError(e?.toString() || 'Failed to set custom sprite');
    }
  }, [headId, bodyId, variants]);

  return {
    sprite,
    variants,
    loading,
    error,
    selectVariant,
    setCustomUrl,
  };
}

/**
 * Hook for managing multiple fusion sprites
 */
export function useFusionManager() {
  const [fusions, setFusions] = useState<Map<string, FusionSprite>>(new Map());
  const [indexReady, setIndexReady] = useState(false);
  
  // Listen for all fusion events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    
    listen<SyncEvent>('sync-event', (event) => {
      const { type, payload } = event.payload;
      
      if (type === 'FusionSpriteSelected') {
        const p = payload as { headId: number; bodyId: number; spriteFile: string; playerId?: string };
        const key = `${p.headId}.${p.bodyId}`;
        
        setFusions(prev => {
          const next = new Map(prev);
          const existing = next.get(key);
          next.set(key, {
            headId: p.headId,
            bodyId: p.bodyId,
            spriteFile: p.spriteFile,
            variants: existing?.variants || [],
          });
          return next;
        });
      } else if (type === 'FusionVariantsLoaded') {
        const p = payload as { headId: number; bodyId: number; variants: string[] };
        const key = `${p.headId}.${p.bodyId}`;
        
        setFusions(prev => {
          const next = new Map(prev);
          const existing = next.get(key);
          next.set(key, {
            headId: p.headId,
            bodyId: p.bodyId,
            spriteFile: existing?.spriteFile || p.variants[0] || `${p.headId}.${p.bodyId}.png`,
            variants: p.variants,
          });
          return next;
        });
      }
    }).then(fn => { unlisten = fn; });

    return () => {
      unlisten?.();
    };
  }, []);

  // Build local sprite index
  const buildIndex = useCallback(async (basePath: string, customPath?: string) => {
    try {
      const result = await invoke<IndexBuildResult>('build_sprite_index', {
        basePath,
        customPath,
      });
      setIndexReady(true);
      return result;
    } catch (e) {
      console.error('Failed to build sprite index:', e);
      return null;
    }
  }, []);

  // Get fusion by key
  const getFusion = useCallback((headId: number, bodyId: number) => {
    return fusions.get(`${headId}.${bodyId}`);
  }, [fusions]);

  return {
    fusions,
    indexReady,
    buildIndex,
    getFusion,
  };
}

/**
 * Hook for sync errors
 */
export function useSyncErrors() {
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    
    listen<SyncEvent>('sync-event', (event) => {
      if (event.payload.type === 'Error') {
        const p = event.payload.payload as { message: string };
        setErrors(prev => [...prev.slice(-9), p.message]); // Keep last 10 errors
      }
    }).then(fn => { unlisten = fn; });

    return () => {
      unlisten?.();
    };
  }, []);

  const clearErrors = useCallback(() => setErrors([]), []);

  return { errors, clearErrors };
}

/**
 * Hook to set sync identity (called after user logs in)
 */
export function useSyncIdentity() {
  const setIdentity = useCallback(async (
    userId: string,
    username: string,
    trainerSprite?: string
  ) => {
    try {
      await invoke('set_sync_identity', { userId, username, trainerSprite });
    } catch (e) {
      console.error('Failed to set sync identity:', e);
    }
  }, []);

  return { setIdentity };
}

/**
 * Calculate fusion stats client-side (for immediate UI feedback)
 */
export function useFusionStats(head: PokemonStats | null, body: PokemonStats | null): FusionStats | null {
  return useCallback(() => {
    if (!head || !body) return null;
    
    return {
      hp: Math.floor((2 * head.hp + body.hp) / 3),
      attack: Math.floor((2 * body.attack + head.attack) / 3),
      defense: Math.floor((2 * body.defense + head.defense) / 3),
      spAttack: Math.floor((2 * head.spAttack + body.spAttack) / 3),
      spDefense: Math.floor((2 * head.spDefense + body.spDefense) / 3),
      speed: Math.floor((2 * body.speed + head.speed) / 3),
    };
  }, [head, body])();
}

/**
 * Build sprite URL from fusion IDs
 */
export async function buildSpriteUrl(
  headId: number, 
  bodyId: number, 
  variant?: string
): Promise<string> {
  try {
    return await invoke<string>('build_sprite_url', { headId, bodyId, variant });
  } catch {
    // Fallback to local construction
    const filename = variant
      ? (/^[A-Za-z]+$/.test(variant)
        ? `${headId}.${bodyId}${variant}.png`
        : `${headId}.${bodyId}_${variant}.png`)
      : `${headId}.${bodyId}.png`;
    return `/fusion-sprites/${filename}`;
  }
}
