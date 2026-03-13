import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ─── Types ─── */

export interface SpritePainterProps {
  /** Initial image to load onto canvas (data URL or http URL) */
  initialSrc?: string | null;
  /** Guideline text shown to the user */
  guideline?: string;
  /** Canvas pixel dimensions (default 96×96) */
  canvasSize?: number;
  /** Callback when user accepts the painted sprite — receives data URL */
  onAccept: (dataUrl: string) => void;
  /** Callback when user cancels */
  onCancel: () => void;
}

type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper';

const PALETTE = [
  '#000000', '#ffffff', '#ff0000', '#ff7700', '#ffdd00', '#00cc00',
  '#0055ff', '#8800ff', '#ff44aa', '#884400', '#ffaa88', '#aaddff',
  '#00cccc', '#999999', '#555555', '#cccccc',
  '#ff5555', '#ffaa00', '#ffff55', '#55ff55', '#55ffff', '#5555ff',
  '#ff55ff', '#aa5500', '#008800', '#000088', '#880088', '#888800',
  // Pokémon-common colors
  '#f08030', '#6890f0', '#78c850', '#f8d030', '#98d8d8', '#c03028',
  '#a040a0', '#e0c068', '#a890f0', '#f85888', '#a8b820', '#b8a038',
  '#705898', '#7038f8', '#705848', '#b8b8d0', '#ee99ac', '#a8a878',
];

const DEFAULT_SIZE = 96;
const GRID_PX = 96; // sprite is always 96×96 logical pixels

/* ─── Component ─── */

export function SpritePainter({
  initialSrc,
  guideline,
  canvasSize = DEFAULT_SIZE,
  onAccept,
  onCancel,
}: SpritePainterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(1);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [showGrid, setShowGrid] = useState(true);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);
  const prevColor = useRef(color);

  const displaySize = GRID_PX * zoom;

  // Initialize canvas
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.width = GRID_PX;
    cvs.height = GRID_PX;
    const ctx = cvs.getContext('2d')!;

    if (initialSrc) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.clearRect(0, 0, GRID_PX, GRID_PX);
        ctx.drawImage(img, 0, 0, GRID_PX, GRID_PX);
        pushUndo(ctx);
      };
      img.onerror = () => {
        ctx.clearRect(0, 0, GRID_PX, GRID_PX);
        pushUndo(ctx);
      };
      img.src = initialSrc;
    } else {
      ctx.clearRect(0, 0, GRID_PX, GRID_PX);
      pushUndo(ctx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushUndo = useCallback((ctx: CanvasRenderingContext2D) => {
    const data = ctx.getImageData(0, 0, GRID_PX, GRID_PX);
    setUndoStack(prev => [...prev.slice(-30), data]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    setUndoStack(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const current = prev[prev.length - 1];
      setRedoStack(r => [...r, current]);
      const restore = next[next.length - 1];
      if (restore) ctx.putImageData(restore, 0, 0);
      return next;
    });
  }, []);

  const redo = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      const restore = prev[prev.length - 1];
      if (restore) {
        ctx.putImageData(restore, 0, 0);
        setUndoStack(u => [...u, restore]);
      }
      return next;
    });
  }, []);

  // Convert mouse position to canvas pixel
  const toPixel = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs) return { x: 0, y: 0 };
    const rect = cvs.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_PX);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_PX);
    return { x: Math.max(0, Math.min(GRID_PX - 1, x)), y: Math.max(0, Math.min(GRID_PX - 1, y)) };
  }, []);

  const drawPixel = useCallback((x: number, y: number) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;

    if (tool === 'eyedropper') {
      const px = ctx.getImageData(x, y, 1, 1).data;
      const hex = '#' + [px[0], px[1], px[2]].map(c => c.toString(16).padStart(2, '0')).join('');
      setColor(hex);
      setTool('pen');
      return;
    }

    if (tool === 'eraser') {
      ctx.clearRect(x - Math.floor(brushSize / 2), y - Math.floor(brushSize / 2), brushSize, brushSize);
    } else if (tool === 'pen') {
      ctx.fillStyle = color;
      ctx.fillRect(x - Math.floor(brushSize / 2), y - Math.floor(brushSize / 2), brushSize, brushSize);
    }
  }, [tool, color, brushSize]);

  const floodFill = useCallback((startX: number, startY: number) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, GRID_PX, GRID_PX);
    const data = imageData.data;

    // Parse fill color
    const fillR = parseInt(color.slice(1, 3), 16);
    const fillG = parseInt(color.slice(3, 5), 16);
    const fillB = parseInt(color.slice(5, 7), 16);

    const idx = (startY * GRID_PX + startX) * 4;
    const targetR = data[idx];
    const targetG = data[idx + 1];
    const targetB = data[idx + 2];
    const targetA = data[idx + 3];

    if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === 255) return;

    const match = (i: number) =>
      data[i] === targetR && data[i + 1] === targetG && data[i + 2] === targetB && data[i + 3] === targetA;

    const stack = [[startX, startY]];
    const visited = new Set<number>();

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const i = (y * GRID_PX + x) * 4;
      if (x < 0 || x >= GRID_PX || y < 0 || y >= GRID_PX) continue;
      if (visited.has(i)) continue;
      if (!match(i)) continue;
      visited.add(i);
      data[i] = fillR;
      data[i + 1] = fillG;
      data[i + 2] = fillB;
      data[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    ctx.putImageData(imageData, 0, 0);
  }, [color]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = toPixel(e);
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;

    if (tool === 'fill') {
      pushUndo(ctx);
      floodFill(x, y);
      return;
    }

    if (tool === 'eyedropper') {
      drawPixel(x, y);
      return;
    }

    setIsDrawing(true);
    drawPixel(x, y);
  }, [toPixel, tool, drawPixel, floodFill, pushUndo]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const { x, y } = toPixel(e);
    drawPixel(x, y);
  }, [isDrawing, toPixel, drawPixel]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      const cvs = canvasRef.current;
      if (cvs) pushUndo(cvs.getContext('2d')!);
    }
  }, [isDrawing, pushUndo]);

  const handleClear = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    pushUndo(ctx);
    ctx.clearRect(0, 0, GRID_PX, GRID_PX);
  }, [pushUndo]);

  const handleAccept = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    onAccept(cvs.toDataURL('image/png'));
  }, [onAccept]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const toolButtons: { tool: Tool; icon: string; label: string }[] = [
    { tool: 'pen', icon: '✏️', label: 'Pen' },
    { tool: 'eraser', icon: '🧹', label: 'Eraser' },
    { tool: 'fill', icon: '🪣', label: 'Fill' },
    { tool: 'eyedropper', icon: '💧', label: 'Pick Color' },
  ];

  return (
    <div style={{
      display: 'grid', gap: 12,
      background: 'var(--panel-bg-dark, #111)',
      borderRadius: 10, padding: 16,
      border: '1px solid var(--accent, #444)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1.1em' }}>🎨 Sprite Painter</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="mini" onClick={undo} title="Undo (Ctrl+Z)" disabled={undoStack.length <= 1}>↩</button>
          <button className="mini" onClick={redo} title="Redo (Ctrl+Y)" disabled={redoStack.length === 0}>↪</button>
        </div>
      </div>

      {/* Guideline */}
      {guideline && (
        <div style={{
          padding: '8px 12px', borderRadius: 6,
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
          fontSize: '0.85em', color: '#a5b4fc',
        }}>
          <strong>Guideline:</strong> {guideline}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12 }}>
        {/* Canvas area */}
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{
            position: 'relative',
            width: displaySize, height: displaySize,
            border: '2px solid #555',
            borderRadius: 4,
            overflow: 'hidden',
            background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 16px 16px',
            cursor: tool === 'eyedropper' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'crosshair',
          }}>
            <canvas
              ref={canvasRef}
              style={{
                width: displaySize, height: displaySize,
                imageRendering: 'pixelated',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            {/* Grid overlay */}
            {showGrid && zoom >= 3 && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                pointerEvents: 'none',
                backgroundSize: `${zoom}px ${zoom}px`,
                backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
              }} />
            )}
          </div>

          {/* Zoom + grid toggle */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8em' }}>
            <span className="dim">Zoom</span>
            {[2, 3, 4, 5, 6].map(z => (
              <button
                key={z}
                className={zoom === z ? 'active' : 'mini'}
                onClick={() => setZoom(z)}
                style={{ padding: '2px 6px', fontSize: '0.85em', minWidth: 24 }}
              >
                {z}x
              </button>
            ))}
            <label style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showGrid} onChange={() => setShowGrid(!showGrid)} />
              Grid
            </label>
          </div>
        </div>

        {/* Tools panel */}
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          {/* Tool buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {toolButtons.map(tb => (
              <button
                key={tb.tool}
                className={tool === tb.tool ? 'active' : 'mini'}
                onClick={() => setTool(tb.tool)}
                title={tb.label}
                style={{ padding: '4px 10px', fontSize: '0.9em' }}
              >
                {tb.icon} {tb.label}
              </button>
            ))}
          </div>

          {/* Brush size */}
          {(tool === 'pen' || tool === 'eraser') && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85em' }}>
              <span className="dim">Size</span>
              {[1, 2, 3, 4, 5].map(s => (
                <button
                  key={s}
                  className={brushSize === s ? 'active' : 'mini'}
                  onClick={() => setBrushSize(s)}
                  style={{ padding: '2px 8px', fontSize: '0.85em', minWidth: 24 }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Color picker + palette */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="dim" style={{ fontSize: '0.85em' }}>Color</span>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ width: 32, height: 24, padding: 0, border: '1px solid #555', borderRadius: 3, cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.75em', color: '#888', fontFamily: 'monospace' }}>{color}</span>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 2,
            }}>
              {PALETTE.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 20, height: 20, padding: 0,
                    background: c,
                    border: color === c ? '2px solid #fff' : '1px solid #555',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Clear */}
          <button className="mini" onClick={handleClear} style={{ fontSize: '0.85em' }}>
            🗑️ Clear Canvas
          </button>
        </div>
      </div>

      {/* Accept / Cancel */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="mini" onClick={onCancel} style={{ padding: '8px 16px' }}>
          Cancel
        </button>
        <button onClick={handleAccept} style={{ padding: '8px 20px', fontWeight: 600, fontSize: '1em', borderRadius: 8 }}>
          ✅ Keep Sprite
        </button>
      </div>
    </div>
  );
}

export default SpritePainter;
