import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spriteUrl, loadShowdownDex, DexIndex } from '../data/adapter';

/* ───────── Region bitmask constants ───────── */
const REGION = {
  HEAD:    1,
  BODY:    2,
  ACCENT:  4,
  OUTLINE: 8,
} as const;

type RegionKey = keyof typeof REGION;

const REGION_META: Record<RegionKey, { label: string; emoji: string; rgba: [number, number, number, number] }> = {
  HEAD:    { label: 'Head',    emoji: '🔴', rgba: [220, 50, 50, 160] },
  BODY:    { label: 'Body',    emoji: '🔵', rgba: [50, 100, 220, 160] },
  ACCENT:  { label: 'Accent',  emoji: '🟢', rgba: [50, 200, 80, 160] },
  OUTLINE: { label: 'Outline', emoji: '⚪', rgba: [180, 180, 180, 160] },
};

const CANVAS_SIZE = 96;
const MIN_ZOOM = 2;
const MAX_ZOOM = 12;

const STORAGE_KEY_PREFIX = 'ttrpg.regions.';
const PROGRESS_KEY = 'ttrpg.regions.__progress__';

/* ───────── Helpers ───────── */

function bitmaskToColor(mask: number): [number, number, number, number] {
  if (!mask) return [0, 0, 0, 0];
  let r = 0, g = 0, b = 0, a = 0, count = 0;
  for (const k of Object.keys(REGION_META) as RegionKey[]) {
    if (mask & REGION[k]) {
      const c = REGION_META[k].rgba;
      r += c[0]; g += c[1]; b += c[2]; a += c[3];
      count++;
    }
  }
  if (!count) return [0, 0, 0, 0];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count), Math.round(a / count)];
}

/** RLE encode region data for compact localStorage storage */
function rleEncode(data: Uint8Array): number[] {
  if (data.length === 0) return [];
  const result: number[] = [];
  let current = data[0];
  let count = 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i] === current && count < 255) {
      count++;
    } else {
      result.push(current, count);
      current = data[i];
      count = 1;
    }
  }
  result.push(current, count);
  return result;
}

/** RLE decode */
function rleDecode(rle: number[], totalPixels: number): Uint8Array {
  const result = new Uint8Array(totalPixels);
  let idx = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i];
    const count = rle[i + 1];
    for (let j = 0; j < count && idx < totalPixels; j++) {
      result[idx++] = value;
    }
  }
  return result;
}

/** Save region data for a pokemon */
function saveRegionData(pokemonId: string, data: Uint8Array, w: number, h: number) {
  try {
    const rle = rleEncode(data);
    localStorage.setItem(STORAGE_KEY_PREFIX + pokemonId, JSON.stringify({ w, h, rle }));
    const progress = getProgress();
    progress[pokemonId] = true;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {}
}

/** Load region data for a pokemon */
function loadRegionData(pokemonId: string): { data: Uint8Array; w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + pokemonId);
    if (!raw) return null;
    const { w, h, rle } = JSON.parse(raw);
    return { data: rleDecode(rle, w * h), w, h };
  } catch {
    return null;
  }
}

function getProgress(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
  } catch {
    return {};
  }
}

/* ───────── Component ───────── */

interface PokemonEntry {
  id: string;
  name: string;
  num: number;
}

interface RegionPainterProps {
  dex?: Record<string, { name: string; num?: number; [k: string]: any }>;
}

export function RegionPainter({ dex: dexProp }: RegionPainterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [zoom, setZoom] = useState(6);
  const [tool, setTool] = useState<RegionKey | 'eraser'>('HEAD');
  const [brushSize, setBrushSize] = useState(1);
  const [overlap, setOverlap] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [spriteImg, setSpriteImg] = useState<HTMLImageElement | null>(null);
  const [spriteWidth, setSpriteWidth] = useState(CANVAS_SIZE);
  const [spriteHeight, setSpriteHeight] = useState(CANVAS_SIZE);
  const [dirty, setDirty] = useState(false);

  // Self-load dex if not provided
  const [loadedDex, setLoadedDex] = useState<DexIndex | null>(null);
  useEffect(() => {
    if (!dexProp) {
      loadShowdownDex().then(d => setLoadedDex(d.pokedex));
    }
  }, [dexProp]);
  const dex = dexProp ?? loadedDex;

  // Pokemon list & navigation
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchFilter, setSearchFilter] = useState('');
  const [showOnlyUnpainted, setShowOnlyUnpainted] = useState(false);
  const [progress, setProgress] = useState<Record<string, boolean>>(getProgress);
  const [loadingSprite, setLoadingSprite] = useState(false);

  const regionsRef = useRef<Uint8Array>(new Uint8Array(CANVAS_SIZE * CANVAS_SIZE));
  const paintingRef = useRef(false);

  /* ───────── Build Pokemon list from dex ───────── */
  const allPokemon: PokemonEntry[] = useMemo(() => {
    if (!dex) return [];
    const list: PokemonEntry[] = [];
    for (const [id, entry] of Object.entries(dex)) {
      if (!entry.name || !entry.num || entry.num < 1) continue;
      // Skip alternate formes — keep base species + regional forms
      if (id.includes('-')) {
        const suffix = id.split('-').slice(1).join('-');
        const isRegional = ['galar', 'alola', 'hisui', 'paldea'].includes(suffix);
        if (!isRegional) continue;
      }
      list.push({ id, name: entry.name, num: entry.num });
    }
    list.sort((a, b) => a.num - b.num || a.id.localeCompare(b.id));
    // Deduplicate by num (keep first for each dex number)
    const seen = new Set<number>();
    return list.filter(p => {
      if (seen.has(p.num)) return false;
      seen.add(p.num);
      return true;
    });
  }, [dex]);

  const filteredPokemon: PokemonEntry[] = useMemo(() => {
    let list = allPokemon;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        String(p.num).includes(q) ||
        p.id.includes(q)
      );
    }
    if (showOnlyUnpainted) {
      list = list.filter(p => !progress[p.id]);
    }
    return list;
  }, [allPokemon, searchFilter, showOnlyUnpainted, progress]);

  const currentPokemon = filteredPokemon[currentIndex] || null;

  /* ───────── Load sprite image ───────── */
  const loadImage = useCallback((src: string) => {
    setLoadingSprite(true);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSpriteImg(img);
      const w = img.naturalWidth || CANVAS_SIZE;
      const h = img.naturalHeight || CANVAS_SIZE;
      setSpriteWidth(w);
      setSpriteHeight(h);
      if (regionsRef.current.length !== w * h) {
        regionsRef.current = new Uint8Array(w * h);
      }
      setLoadingSprite(false);
    };
    img.onerror = () => setLoadingSprite(false);
    img.src = src;
  }, []);

  /* ───────── Navigate to a pokemon ───────── */
  const navigateTo = useCallback((index: number) => {
    if (index < 0 || index >= filteredPokemon.length) return;
    const pkmn = filteredPokemon[index];
    if (!pkmn) return;

    // Load saved region data if it exists
    const saved = loadRegionData(pkmn.id);
    if (saved) {
      regionsRef.current = saved.data;
    } else {
      regionsRef.current = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
    }

    setCurrentIndex(index);
    setDirty(false);

    const url = spriteUrl(pkmn.id, false);
    loadImage(url);
  }, [filteredPokemon, loadImage]);

  // Auto-navigate on mount
  useEffect(() => {
    if (filteredPokemon.length > 0 && !spriteImg) {
      navigateTo(0);
    }
  }, [filteredPokemon.length]); // eslint-disable-line

  /* ───────── Render canvas ───────── */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const w = spriteWidth;
    const h = spriteHeight;
    const z = zoom;
    canvas.width = w * z;
    canvas.height = h * z;
    overlay.width = w * z;
    overlay.height = h * z;

    const ctx = canvas.getContext('2d')!;
    const octx = overlay.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    octx.imageSmoothingEnabled = false;

    // Checkerboard background
    ctx.fillStyle = '#ccc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = '#ddd';
          ctx.fillRect(x * z, y * z, z, z);
        }
      }
    }

    if (spriteImg) {
      ctx.drawImage(spriteImg, 0, 0, w * z, h * z);
    }

    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (showOverlay) {
      const regions = regionsRef.current;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const mask = regions[y * w + x];
          if (!mask) continue;
          const [r, g, b, a] = bitmaskToColor(mask);
          octx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
          octx.fillRect(x * z, y * z, z, z);
        }
      }
    }

    if (z >= 4) {
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= w; x++) {
        ctx.beginPath(); ctx.moveTo(x * z, 0); ctx.lineTo(x * z, h * z); ctx.stroke();
      }
      for (let y = 0; y <= h; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * z); ctx.lineTo(w * z, y * z); ctx.stroke();
      }
    }
  }, [zoom, spriteImg, spriteWidth, spriteHeight, showOverlay]);

  useEffect(() => { render(); }, [render]);

  /* ───────── Paint ───────── */
  const paint = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((e.clientX - rect.left) / zoom);
    const py = Math.floor((e.clientY - rect.top) / zoom);
    const regions = regionsRef.current;
    const w = spriteWidth;
    const h = spriteHeight;
    const half = Math.floor(brushSize / 2);

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const idx = y * w + x;
        if (tool === 'eraser') {
          regions[idx] = 0;
        } else {
          const bit = REGION[tool];
          if (overlap) {
            regions[idx] |= bit;
          } else {
            regions[idx] = bit;
          }
        }
      }
    }
    setDirty(true);
    render();
  }, [zoom, tool, brushSize, overlap, spriteWidth, spriteHeight, render]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    paintingRef.current = true;
    paint(e);
  }, [paint]);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current) return;
    paint(e);
  }, [paint]);
  const onMouseUp = useCallback(() => { paintingRef.current = false; }, []);

  /* ───────── Auto-detect outlines ───────── */
  const autoDetectOutline = useCallback(() => {
    if (!spriteImg) return;
    const tc = document.createElement('canvas');
    tc.width = spriteWidth; tc.height = spriteHeight;
    const tctx = tc.getContext('2d')!;
    tctx.drawImage(spriteImg, 0, 0);
    const imgData = tctx.getImageData(0, 0, spriteWidth, spriteHeight);
    const px = imgData.data;
    const regions = regionsRef.current;
    const w = spriteWidth, h = spriteHeight;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (px[i + 3] < 30) continue;
        const brightness = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (brightness < 60) {
          let isEdge = false;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) { isEdge = true; break; }
            if (px[(ny * w + nx) * 4 + 3] < 30) { isEdge = true; break; }
          }
          if (isEdge || brightness < 35) {
            regions[y * w + x] |= REGION.OUTLINE;
          }
        }
      }
    }
    setDirty(true);
    render();
  }, [spriteImg, spriteWidth, spriteHeight, render]);

  /* ───────── Auto-detect head/body ───────── */
  const autoDetectHeadBody = useCallback(() => {
    if (!spriteImg) return;
    const tc = document.createElement('canvas');
    tc.width = spriteWidth; tc.height = spriteHeight;
    const tctx = tc.getContext('2d')!;
    tctx.drawImage(spriteImg, 0, 0);
    const imgData = tctx.getImageData(0, 0, spriteWidth, spriteHeight);
    const px = imgData.data;
    const regions = regionsRef.current;
    const w = spriteWidth, h = spriteHeight;

    let topY = h, bottomY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 30) {
          topY = Math.min(topY, y);
          bottomY = Math.max(bottomY, y);
        }
      }
    }

    const searchEnd = topY + Math.floor((bottomY - topY) * 0.6);
    let neckY = topY + Math.floor((bottomY - topY) * 0.4);
    let narrowest = w;
    for (let y = topY + 5; y <= searchEnd; y++) {
      let rowWidth = 0;
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 30) rowWidth++;
      }
      if (rowWidth > 0 && rowWidth < narrowest) {
        narrowest = rowWidth;
        neckY = y;
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] < 30) continue;
        const idx = y * w + x;
        if (y <= neckY) {
          regions[idx] |= REGION.HEAD;
        } else {
          regions[idx] |= REGION.BODY;
        }
      }
    }
    setDirty(true);
    render();
  }, [spriteImg, spriteWidth, spriteHeight, render]);

  /* ───────── Coverage stats ───────── */
  const regionCoverage = () => {
    const regions = regionsRef.current;
    const total = regions.length;
    const counts: Record<RegionKey, number> = { HEAD: 0, BODY: 0, ACCENT: 0, OUTLINE: 0 };
    let painted = 0;
    for (let i = 0; i < total; i++) {
      if (regions[i]) painted++;
      for (const k of Object.keys(counts) as RegionKey[]) {
        if (regions[i] & REGION[k]) counts[k]++;
      }
    }
    return { counts, painted, total };
  };

  /* ───────── File loading (manual) ───────── */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) loadImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  /* ───────── Save / Save & Next ───────── */
  const handleSave = () => {
    if (currentPokemon) {
      saveRegionData(currentPokemon.id, regionsRef.current, spriteWidth, spriteHeight);
      setDirty(false);
      setProgress(getProgress());
    }
  };

  const handleSaveAndNext = () => {
    handleSave();
    if (currentIndex < filteredPokemon.length - 1) {
      navigateTo(currentIndex + 1);
    }
  };

  /* ───────── Export/Import all ───────── */
  const handleExportAll = () => {
    const allData: Record<string, { w: number; h: number; rle: number[] }> = {};
    const prog = getProgress();
    for (const id of Object.keys(prog)) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
        if (raw) allData[id] = JSON.parse(raw);
      } catch {}
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = 'pokemon_region_annotations.json';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleImportAll = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          const prog: Record<string, boolean> = {};
          for (const [id, entry] of Object.entries(data)) {
            localStorage.setItem(STORAGE_KEY_PREFIX + id, JSON.stringify(entry));
            prog[id] = true;
          }
          localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...getProgress(), ...prog }));
          setProgress(getProgress());
          alert(`Imported region data for ${Object.keys(data).length} Pokemon!`);
          // Reload current pokemon to show imported data
          if (currentPokemon && data[currentPokemon.id]) {
            navigateTo(currentIndex);
          }
        } catch (err) {
          alert('Failed to import: ' + String(err));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const exportAsImage = () => {
    const w = spriteWidth, h = spriteHeight;
    const ec = document.createElement('canvas');
    ec.width = w; ec.height = h;
    const ctx = ec.getContext('2d')!;
    const imgData = ctx.createImageData(w, h);
    const regions = regionsRef.current;
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = bitmaskToColor(regions[i]);
      imgData.data[i * 4] = r;
      imgData.data[i * 4 + 1] = g;
      imgData.data[i * 4 + 2] = b;
      imgData.data[i * 4 + 3] = regions[i] ? 255 : 0;
    }
    ctx.putImageData(imgData, 0, 0);
    const link = document.createElement('a');
    link.download = `region_${currentPokemon?.id || 'unknown'}.png`;
    link.href = ec.toDataURL('image/png');
    link.click();
  };

  const clearAll = () => {
    regionsRef.current.fill(0);
    setDirty(true);
    render();
  };

  const { counts, painted, total } = regionCoverage();
  const completedCount = Object.keys(progress).length;

  /* ───────── Keyboard shortcuts ───────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case '1': setTool('HEAD'); break;
        case '2': setTool('BODY'); break;
        case '3': setTool('ACCENT'); break;
        case '4': setTool('OUTLINE'); break;
        case 'e': case 'E': setTool('eraser'); break;
        case 's': case 'S':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleSave(); }
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) { e.preventDefault(); navigateTo(currentIndex - 1); }
          break;
        case 'ArrowRight':
          if (e.ctrlKey) { e.preventDefault(); navigateTo(currentIndex + 1); }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, filteredPokemon]); // eslint-disable-line

  const S: Record<string, React.CSSProperties> = {
    container: { display: 'grid', gridTemplateColumns: '250px 1fr', gap: 12, padding: 12, height: '100%', overflow: 'hidden' },
    sidebar: { display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden', borderRight: '1px solid var(--panel-outer)', paddingRight: 12 },
    pokemonList: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
    pokemonItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85em', border: '1px solid transparent', flexShrink: 0 },
    pokemonItemActive: { background: 'rgba(0,255,128,0.12)', borderColor: 'var(--accent)' },
    mainArea: { display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', paddingLeft: 8 },
    toolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    toolBtn: { padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '2px solid transparent', fontSize: '0.9em', fontWeight: 600 },
    toolBtnActive: { borderColor: 'var(--accent)', background: 'rgba(0,255,128,0.12)' },
    canvasWrap: { position: 'relative', display: 'inline-block', border: '2px solid var(--panel-outer)', borderRadius: 8, overflow: 'auto', maxWidth: '100%', maxHeight: 'calc(100vh - 380px)' },
    overlay: { position: 'absolute', top: 0, left: 0, cursor: 'crosshair' },
    stats: { display: 'flex', gap: 12, fontSize: '0.82em', color: 'var(--fg-dim)', flexWrap: 'wrap' },
    progressBar: { height: 6, borderRadius: 3, background: 'rgba(128,128,128,0.3)', overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 3, background: 'var(--accent, #4f4)', transition: 'width 0.3s' },
    badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: '0.75em', fontWeight: 700 },
  };

  return (
    <div style={S.container}>
      {/* ─── Sidebar: Pokemon List ─── */}
      <div style={S.sidebar}>
        <h3 style={{ margin: 0 }}>🗺️ Region Painter</h3>
        <div style={{ fontSize: '0.82em', color: 'var(--fg-dim)' }}>
          {completedCount}/{allPokemon.length} painted
          <span style={{ marginLeft: 8 }}>
            ({allPokemon.length > 0 ? Math.round(completedCount / allPokemon.length * 100) : 0}%)
          </span>
        </div>
        <div style={S.progressBar}>
          <div style={{ ...S.progressFill, width: `${allPokemon.length > 0 ? (completedCount / allPokemon.length * 100) : 0}%` }} />
        </div>
        <input
          type="text"
          placeholder="Search Pokemon..."
          value={searchFilter}
          onChange={e => { setSearchFilter(e.target.value); setCurrentIndex(0); }}
          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--panel-outer)', fontSize: '0.85em', background: 'var(--input-bg, #222)', color: 'inherit' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82em', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOnlyUnpainted} onChange={e => { setShowOnlyUnpainted(e.target.checked); setCurrentIndex(0); }} />
          Show only unpainted
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="mini" onClick={handleExportAll} style={{ fontSize: '0.78em', flex: 1 }}>📤 Export All</button>
          <button className="mini" onClick={handleImportAll} style={{ fontSize: '0.78em', flex: 1 }}>📥 Import</button>
        </div>

        <div style={S.pokemonList}>
          {filteredPokemon.map((p, i) => (
            <div
              key={p.id}
              style={{
                ...S.pokemonItem,
                ...(i === currentIndex ? S.pokemonItemActive : {}),
              }}
              onClick={() => navigateTo(i)}
            >
              <img
                src={spriteUrl(p.id, false)}
                alt={p.name}
                style={{ width: 32, height: 32, imageRendering: 'pixelated' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>#{p.num}</span>{' '}
                <span>{p.name}</span>
              </span>
              {progress[p.id] && (
                <span style={{ ...S.badge, background: 'rgba(0,200,80,0.3)', color: '#4f4' }}>✓</span>
              )}
            </div>
          ))}
          {filteredPokemon.length === 0 && (
            <div style={{ padding: 12, fontSize: '0.85em', color: 'var(--fg-dim)' }}>
              {allPokemon.length === 0 ? 'Loading Pokemon list...' : 'No matching Pokemon'}
            </div>
          )}
        </div>
      </div>

      {/* ─── Main Area ─── */}
      <div style={S.mainArea}>
        {currentPokemon && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0 }}>#{currentPokemon.num} {currentPokemon.name}</h3>
            {dirty && <span style={{ ...S.badge, background: 'rgba(255,200,0,0.3)', color: '#fa0' }}>unsaved</span>}
            {progress[currentPokemon.id] && !dirty && <span style={{ ...S.badge, background: 'rgba(0,200,80,0.3)', color: '#4f4' }}>saved</span>}
            <span style={{ marginLeft: 'auto', fontSize: '0.85em', color: 'var(--fg-dim)' }}>
              {currentIndex + 1}/{filteredPokemon.length}
            </span>
          </div>
        )}

        <div style={S.toolbar}>
          <button className="mini" onClick={() => fileInputRef.current?.click()}>📂 Custom Sprite</button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
          <span className="dim" style={{ fontSize: '0.8em' }}>
            {spriteImg ? `${spriteWidth}×${spriteHeight}` : loadingSprite ? 'Loading...' : 'No sprite'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="dim" style={{ fontSize: '0.8em' }}>Zoom:</span>
            <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 80 }} />
            <span className="dim" style={{ fontSize: '0.8em' }}>{zoom}x</span>
          </div>
        </div>

        <div style={S.toolbar}>
          <span className="dim" style={{ fontSize: '0.85em' }}>Paint:</span>
          {(Object.keys(REGION_META) as RegionKey[]).map(k => (
            <button
              key={k}
              className="mini"
              style={{ ...S.toolBtn, ...(tool === k ? S.toolBtnActive : {}) }}
              onClick={() => setTool(k)}
              title={`${REGION_META[k].label} (${Object.keys(REGION).indexOf(k) + 1})`}
            >
              {REGION_META[k].emoji} {REGION_META[k].label}
            </button>
          ))}
          <button
            className="mini secondary"
            style={{ ...S.toolBtn, ...(tool === 'eraser' ? S.toolBtnActive : {}) }}
            onClick={() => setTool('eraser')}
          >
            🧹 Eraser
          </button>

          <span style={{ borderLeft: '1px solid var(--panel-outer)', height: 20 }} />
          <span className="dim" style={{ fontSize: '0.85em' }}>Brush:</span>
          {[1, 2, 3, 5].map(s => (
            <button
              key={s}
              className="mini"
              style={{ ...S.toolBtn, ...(brushSize === s ? S.toolBtnActive : {}), minWidth: 28 }}
              onClick={() => setBrushSize(s)}
            >
              {s}
            </button>
          ))}

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85em', cursor: 'pointer' }}>
            <input type="checkbox" checked={overlap} onChange={e => setOverlap(e.target.checked)} /> Overlap
          </label>
        </div>

        <div style={S.canvasWrap as React.CSSProperties}>
          <canvas ref={canvasRef} style={{ imageRendering: 'pixelated' }} />
          <canvas
            ref={overlayRef}
            style={{ ...(S.overlay as React.CSSProperties), imageRendering: 'pixelated' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>

        <div style={{ ...S.toolbar, flexWrap: 'wrap' }}>
          <button className="mini" onClick={autoDetectOutline}>🔮 Auto Outlines</button>
          <button className="mini" onClick={autoDetectHeadBody}>🔮 Auto Head/Body</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85em', cursor: 'pointer' }}>
            <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} /> Show Overlay
          </label>
          <span style={{ borderLeft: '1px solid var(--panel-outer)', height: 20 }} />
          <button className="mini secondary" onClick={clearAll}>🗑️ Clear</button>
          <button className="mini" onClick={exportAsImage}>📥 Export PNG</button>
          <span style={{ borderLeft: '1px solid var(--panel-outer)', height: 20 }} />
          <button className="mini" onClick={() => navigateTo(currentIndex - 1)} disabled={currentIndex <= 0}>⬅️ Prev</button>
          <button className="mini" onClick={handleSave} style={{ fontWeight: 700 }} disabled={!dirty}>💾 Save</button>
          <button className="mini" onClick={handleSaveAndNext} style={{ fontWeight: 700, background: dirty ? 'rgba(0,200,80,0.2)' : undefined }}>
            💾 Save & Next ➡️
          </button>
          <button className="mini" onClick={() => navigateTo(currentIndex + 1)} disabled={currentIndex >= filteredPokemon.length - 1}>➡️ Next</button>
        </div>

        <div style={S.stats}>
          <span>Painted: {painted}/{total} ({total ? Math.round(painted / total * 100) : 0}%)</span>
          {(Object.keys(REGION_META) as RegionKey[]).map(k => (
            <span key={k}>{REGION_META[k].emoji} {REGION_META[k].label}: {counts[k]} ({total ? Math.round(counts[k] / total * 100) : 0}%)</span>
          ))}
        </div>

        <div style={{ fontSize: '0.78em', color: 'var(--fg-dim)' }}>
          <strong>Shortcuts:</strong> 1=Head, 2=Body, 3=Accent, 4=Outline, E=Eraser, Ctrl+S=Save, Ctrl+←/→=Prev/Next
        </div>
        <div style={{ fontSize: '0.78em', color: 'var(--fg-dim)' }}>
          <strong>Workflow:</strong> Auto Outlines → Auto Head/Body → Refine with brushes → Save & Next
        </div>
      </div>
    </div>
  );
}
