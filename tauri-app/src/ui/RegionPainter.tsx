import React, { useCallback, useEffect, useRef, useState } from 'react';

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

const ERASER = 0;
const CANVAS_SIZE = 96; // native sprite pixel grid
const MIN_ZOOM = 2;
const MAX_ZOOM = 12;

/* ───────── Helpers ───────── */

/** Blend region bitmask into an overlay RGBA */
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

/* ───────── Component ───────── */

interface RegionPainterProps {
  /** Optional callback when the user saves region data */
  onSave?: (regionData: Uint8Array, width: number, height: number) => void;
  /** Optional initial sprite image URL */
  initialSrc?: string;
  /** Optional initial region data (Uint8Array of bitmasks, one per pixel) */
  initialRegions?: Uint8Array;
  /** Width/height of the sprite (default 96) */
  spriteSize?: number;
}

export function RegionPainter({ onSave, initialSrc, initialRegions, spriteSize = CANVAS_SIZE }: RegionPainterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [zoom, setZoom] = useState(6);
  const [tool, setTool] = useState<RegionKey | 'eraser'>('HEAD');
  const [brushSize, setBrushSize] = useState(1);
  const [overlap, setOverlap] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [spriteImg, setSpriteImg] = useState<HTMLImageElement | null>(null);
  const [spriteWidth, setSpriteWidth] = useState(spriteSize);
  const [spriteHeight, setSpriteHeight] = useState(spriteSize);

  // Region data: Uint8Array, one byte per pixel, bitmask of regions
  const regionsRef = useRef<Uint8Array>(initialRegions ?? new Uint8Array(spriteSize * spriteSize));
  const paintingRef = useRef(false);

  /* ───────── Load sprite ───────── */
  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSpriteImg(img);
      const w = img.naturalWidth || spriteSize;
      const h = img.naturalHeight || spriteSize;
      setSpriteWidth(w);
      setSpriteHeight(h);
      // Resize region data if needed
      if (regionsRef.current.length !== w * h) {
        regionsRef.current = new Uint8Array(w * h);
      }
    };
    img.src = src;
  }, [spriteSize]);

  useEffect(() => {
    if (initialSrc) loadImage(initialSrc);
  }, [initialSrc, loadImage]);

  /* ───────── Render ───────── */
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

    // Draw sprite
    if (spriteImg) {
      ctx.drawImage(spriteImg, 0, 0, w * z, h * z);
    }

    // Draw region overlay
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

    // Grid lines at higher zoom
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

  const onMouseUp = useCallback(() => {
    paintingRef.current = false;
  }, []);

  /* ───────── Auto-detect outlines ───────── */
  const autoDetectOutline = useCallback(() => {
    if (!spriteImg) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = spriteWidth;
    tempCanvas.height = spriteHeight;
    const tctx = tempCanvas.getContext('2d')!;
    tctx.drawImage(spriteImg, 0, 0);
    const imgData = tctx.getImageData(0, 0, spriteWidth, spriteHeight);
    const pixels = imgData.data;
    const regions = regionsRef.current;
    const w = spriteWidth;
    const h = spriteHeight;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = pixels[i + 3];
        if (a < 30) continue; // transparent — skip

        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const brightness = (r + g + b) / 3;

        // Dark pixels near edges are likely outlines
        if (brightness < 60) {
          // Check if this is an edge pixel (adjacent to transparent)
          let isEdge = false;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) { isEdge = true; break; }
            const na = pixels[(ny * w + nx) * 4 + 3];
            if (na < 30) { isEdge = true; break; }
          }
          if (isEdge || brightness < 35) {
            regions[y * w + x] |= REGION.OUTLINE;
          }
        }
      }
    }
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

  /* ───────── File loading ───────── */
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

  /* ───────── Save / Export ───────── */
  const handleSave = () => {
    if (onSave) {
      onSave(new Uint8Array(regionsRef.current), spriteWidth, spriteHeight);
    }
    // Also save to localStorage for persistence
    const key = `ttrpg.regionPainter.${spriteWidth}x${spriteHeight}`;
    try {
      const arr = Array.from(regionsRef.current);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch {}
  };

  const exportAsImage = () => {
    const w = spriteWidth;
    const h = spriteHeight;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = w;
    exportCanvas.height = h;
    const ctx = exportCanvas.getContext('2d')!;
    const imgData = ctx.createImageData(w, h);
    const regions = regionsRef.current;

    for (let i = 0; i < w * h; i++) {
      const [r, g, b, a] = bitmaskToColor(regions[i]);
      imgData.data[i * 4] = r;
      imgData.data[i * 4 + 1] = g;
      imgData.data[i * 4 + 2] = b;
      imgData.data[i * 4 + 3] = regions[i] ? 255 : 0;
    }
    ctx.putImageData(imgData, 0, 0);

    const link = document.createElement('a');
    link.download = 'region_map.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  const clearAll = () => {
    regionsRef.current.fill(0);
    render();
  };

  const { counts, painted, total } = regionCoverage();

  const S: Record<string, React.CSSProperties> = {
    wrapper: { display: 'grid', gap: 12, padding: 12 },
    toolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    toolBtn: { padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '2px solid transparent', fontSize: '0.9em', fontWeight: 600 },
    toolBtnActive: { borderColor: 'var(--accent)', background: 'rgba(0,255,128,0.12)' },
    canvasWrap: { position: 'relative', display: 'inline-block', border: '2px solid var(--panel-outer)', borderRadius: 8, overflow: 'auto', maxWidth: '100%', maxHeight: 'calc(100vh - 300px)' },
    overlay: { position: 'absolute', top: 0, left: 0, cursor: 'crosshair' },
    legend: { display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '4px 12px', fontSize: '0.85em' },
    stats: { display: 'flex', gap: 12, fontSize: '0.82em', color: 'var(--fg-dim)', flexWrap: 'wrap' },
  };

  return (
    <div style={S.wrapper}>
      <h3 style={{ margin: 0 }}>🗺️ Region Painter</h3>

      {/* File input */}
      <div style={S.toolbar}>
        <button className="mini" onClick={() => fileInputRef.current?.click()}>📂 Load Sprite</button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
        <span className="dim" style={{ fontSize: '0.8em' }}>
          {spriteImg ? `${spriteWidth}×${spriteHeight}` : 'No sprite loaded'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: '0.8em' }}>Zoom:</span>
          <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 80 }} />
          <span className="dim" style={{ fontSize: '0.8em' }}>{zoom}x</span>
        </div>
      </div>

      {/* Region tools */}
      <div style={S.toolbar}>
        <span className="dim" style={{ fontSize: '0.85em' }}>Paint:</span>
        {(Object.keys(REGION_META) as RegionKey[]).map(k => (
          <button
            key={k}
            className="mini"
            style={{ ...S.toolBtn, ...(tool === k ? S.toolBtnActive : {}) }}
            onClick={() => setTool(k)}
            title={REGION_META[k].label}
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

      {/* Canvas */}
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

      {/* Actions */}
      <div style={{ ...S.toolbar, flexWrap: 'wrap' }}>
        <button className="mini" onClick={autoDetectOutline} title="Auto-detect dark outline pixels">🔮 Auto-Detect Outlines</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85em', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} /> Show Overlay
        </label>
        <span style={{ borderLeft: '1px solid var(--panel-outer)', height: 20 }} />
        <button className="mini secondary" onClick={clearAll}>🗑️ Clear All</button>
        <button className="mini" onClick={exportAsImage}>📥 Export Map</button>
        <button className="mini" onClick={handleSave} style={{ fontWeight: 700 }}>💾 Save</button>
      </div>

      {/* Coverage stats */}
      <div style={S.stats}>
        <span>Painted: {painted}/{total} ({total ? Math.round(painted / total * 100) : 0}%)</span>
        {(Object.keys(REGION_META) as RegionKey[]).map(k => (
          <span key={k}>{REGION_META[k].emoji} {REGION_META[k].label}: {counts[k]} ({total ? Math.round(counts[k] / total * 100) : 0}%)</span>
        ))}
      </div>

      {/* Legend */}
      <div style={{ fontSize: '0.8em', color: 'var(--fg-dim)' }}>
        <strong>Legend:</strong> 🔴 Head — face, eyes, horns, crest &nbsp;|&nbsp; 🔵 Body — torso, limbs, wings, tail &nbsp;|&nbsp; 🟢 Accent — markings, patterns, special features &nbsp;|&nbsp; ⚪ Outline — edge pixels (auto-detect)
      </div>
    </div>
  );
}
