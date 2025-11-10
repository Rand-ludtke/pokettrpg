import React from 'react';
import { BattlePokemon } from '../types';
import { spriteUrl, placeholderSpriteDataURL } from '../data/adapter';

export function BoxGrid({ pokes, onSelect, boxIndex, boxCount, onPrevBox, onNextBox, selectMode, selectedIndices, onToggleSelect, onShiftToggle, onDrop }: {
  pokes: Array<BattlePokemon | null>;
  onSelect: (p: BattlePokemon | null, index: number) => void;
  boxIndex: number;
  boxCount: number;
  onPrevBox: () => void;
  onNextBox: () => void;
  selectMode?: boolean;
  selectedIndices?: number[];
  onToggleSelect?: (index: number) => void;
  onShiftToggle?: (index: number) => void;
  onDrop?: (payload: { fromBox: number; indices: number[] }, targetIndex: number) => void;
}) {
  const cols = 6, rows = 5; const size = cols * rows;
  const slots = Array.from({ length: size }, (_, i) => pokes[i]);
  const selectedSet = new Set<number>(selectedIndices || []);
  // For hover auto-paging while dragging
  const prevHoverRef = React.useRef<number | null>(null);
  const nextHoverRef = React.useRef<number | null>(null);
  const prevTimerRef = React.useRef<any>(null);
  const nextTimerRef = React.useRef<any>(null);
  const startPrevAuto = () => {
    if (prevTimerRef.current) return;
    prevTimerRef.current = setInterval(() => onPrevBox(), 700);
  };
  const stopPrevAuto = () => { if (prevTimerRef.current) { clearInterval(prevTimerRef.current); prevTimerRef.current = null; } };
  const startNextAuto = () => {
    if (nextTimerRef.current) return;
    nextTimerRef.current = setInterval(() => onNextBox(), 700);
  };
  const stopNextAuto = () => { if (nextTimerRef.current) { clearInterval(nextTimerRef.current); nextTimerRef.current = null; } };
  return (
    <section className="panel box-grid">
      <div className="box-header">
        <button
          className="arrow-btn"
          title="Previous Box"
          onClick={onPrevBox}
          onDragEnter={() => startPrevAuto()}
          onDragLeave={() => stopPrevAuto()}
          onDragOver={(e)=>{ e.preventDefault(); startPrevAuto(); }}
        >
          ◄
        </button>
        <h2>PC BOX {boxIndex + 1} / {Math.max(1, boxCount)}</h2>
        <button
          className="arrow-btn"
          title="Next Box"
          onClick={onNextBox}
          onDragEnter={() => startNextAuto()}
          onDragLeave={() => stopNextAuto()}
          onDragOver={(e)=>{ e.preventDefault(); startNextAuto(); }}
        >
          ►
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {slots.map((p, i) => (
          <button
            key={i}
            className={`slot large${selectedSet.has(i) ? ' selected' : ''}`}
            onClick={(e) => {
              if ((e as any).shiftKey && p && onShiftToggle) { onShiftToggle(i); return; }
              if (selectMode && p && onToggleSelect) { onToggleSelect(i); return; }
              onSelect(p ?? null, i);
            }}
            title={p ? `${(p.types||[]).join('/') } • Lv${p.level} • HP ${p.currentHp}/${p.maxHp}` : 'Empty slot - click to add'}
            style={selectedSet.has(i) ? { outline: '2px solid var(--acc)', outlineOffset: -2, background: 'rgba(0,255,128,0.08)' } : undefined}
            draggable={!!p}
            onDragStart={(e)=>{
              if (!p) return;
              const payload = { fromBox: boxIndex, indices: (selectMode && selectedSet.has(i) && (selectedIndices||[]).length) ? (selectedIndices as number[]) : [i] };
              e.dataTransfer.setData('application/x-pc-drag', JSON.stringify(payload));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e)=>{
              e.preventDefault();
              try {
                const raw = e.dataTransfer.getData('application/x-pc-drag');
                const payload = JSON.parse(raw || '{}');
                if (onDrop && payload && payload.indices) onDrop(payload, i);
              } catch {}
            }}
          >
            {p ? (
              <>
                <div className="slot-sprite-wrap">
                  <img
                    className="pixel slot-sprite"
                    src={spriteUrl(p.species || p.name, !!p.shiny, (p as any).cosmeticForm ? { cosmetic: (p as any).cosmeticForm } : undefined)}
                    alt=""
                    onError={(e)=>{
                      const img = e.currentTarget as HTMLImageElement;
                      // prevent loop
                      if (img.dataset.fallback) return;
                      img.dataset.fallback = '1';
                      // show placeholder immediately
                      img.src = placeholderSpriteDataURL('?');
                      // then probe alternative source in background; if it loads, swap it in
                      const alt = spriteUrl(p.species || p.name, !!p.shiny, { setOverride: 'gen5', cosmetic: (p as any).cosmeticForm });
                      const probe = new Image();
                      probe.onload = () => { img.src = alt; };
                      probe.src = alt;
                    }}
                  />
                </div>
              </>
            ) : <span className="empty">—</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
