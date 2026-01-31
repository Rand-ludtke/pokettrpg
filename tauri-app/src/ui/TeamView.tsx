import React from 'react';
import { BattlePokemon } from '../types';
import { spriteUrl } from '../data/adapter';

export function TeamView({ team, onRemove, onMove }: {
  team: BattlePokemon[];
  onRemove: (name: string) => void;
  onMove?: (from: number, to: number) => void;
}) {
  return (
    <section className="panel">
      <h2>Active Team</h2>
      {team.length === 0 && <p>No Pokémon yet. Add from PC.</p>}
      <ul className="team">
        {team.map((p, idx) => {
          const onDragStart = (e: React.DragEvent) => {
            e.dataTransfer.setData('text/plain', String(idx));
            e.dataTransfer.effectAllowed = 'move';
          };
          const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
          const onDrop = (e: React.DragEvent) => {
            e.preventDefault();
            const fromStr = e.dataTransfer.getData('text/plain');
            const from = fromStr ? parseInt(fromStr, 10) : NaN;
            if (onMove && Number.isFinite(from) && from !== idx) onMove(from, idx);
          };
          return (
            <li key={p.name}
                draggable={!!onMove}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:8,alignItems:'center'}}>
              <div style={{width:80,height:80,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <img
                  style={{imageRendering:'pixelated',maxWidth:80,maxHeight:80}}
                  src={spriteUrl(p.species || p.name, !!p.shiny, (p as any).cosmeticForm ? { cosmetic: (p as any).cosmeticForm } : undefined)}
                  alt=""
                  onError={(e)=>{
                    const img = e.currentTarget as HTMLImageElement;
                    if ((img as any).dataset.fallback) return;
                    (img as any).dataset.fallback = '1';
                    img.src = spriteUrl(p.species || p.name, !!p.shiny, { setOverride: 'gen5', cosmetic: (p as any).cosmeticForm });
                  }}
                />
              </div>
              <div>
                <div><strong>{p.name}</strong> <span className="dim">Lv{p.level}</span></div>
                <div className="hpbar mini"><span style={{width: `${(p.currentHp/p.maxHp)*100}%`}} /></div>
              </div>
              <div>
                <div style={{display:'flex', gap:6}}>
                  {onMove && <>
                    <button className="secondary" onClick={()=> onMove(idx, Math.max(0, idx-1))} disabled={idx===0}>↑</button>
                    <button className="secondary" onClick={()=> onMove(idx, Math.min(team.length-1, idx+1))} disabled={idx===team.length-1}>↓</button>
                  </>}
                  <button onClick={() => onRemove(p.name)}>- Remove</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
