import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BattlePokemon } from '../types';
import { withPublicBase } from '../utils/publicBase';
import { spriteUrl, computeRealStats } from '../data/adapter';

/* ── Types ─────────────────────────────────────────────────────────── */

type ContestFormat = 'singles' | 'doubles';
type ContestRound = 'setup' | 'round1' | 'round2';

interface ContestState {
  format: ContestFormat;
  round: ContestRound;
  selectedPokemon: (BattlePokemon | null)[];
  appeal: [number, number]; // [player, opponent]
  turnsRemaining: number;
  reactions: [number, number]; // reactions left [player, opponent]
  round1Scores: {
    entrance: number;
    cute: number;
    beauty: number;
    cool: number;
    tough: number;
    smart: number;
  };
  lockedMove: string | null;
  lockedApproach: string | null;
  moveHistory: string[];
  routineMoves: number[];
  supportChecks: Array<{ stat: string; roll: number | null }>;
  supportBonus: number;
}

const TYPE_BONUS_MAP: Record<string, string> = {
  Normal: 'Charm', Fire: 'Charm', Water: 'Fortitude', Electric: 'Athletics',
  Grass: 'Charm', Ice: 'Athletics', Fighting: 'Strength', Poison: 'Intelligence',
  Ground: 'Strength', Flying: 'Athletics', Psychic: 'Intelligence', Bug: 'Athletics',
  Rock: 'Fortitude', Ghost: 'Intelligence', Dragon: 'Strength', Dark: 'Intelligence',
  Steel: 'Fortitude', Fairy: 'Charm',
};

/* ── Stat Helpers ──────────────────────────────────────────────────── */

function ceilDiv(v: number, d: number) { return Math.ceil(v / d); }
function clampStat(v: number) { return Math.max(3, Math.min(20, v)); }

function getTypeBonus(statName: string, types: string[]): number {
  return Math.min(2, types.filter(t => TYPE_BONUS_MAP[t] === statName).length);
}

/** Field stats: use CALCULATED (level-adjusted) stats */
function calcFieldStats(mon: BattlePokemon) {
  const c = mon.computedStats || computeRealStats(mon);
  const types = mon.types || [];
  return {
    Strength: clampStat(ceilDiv(c.atk, 10) + getTypeBonus('Strength', types)),
    Athletics: clampStat(ceilDiv(c.spe, 10) + getTypeBonus('Athletics', types)),
    Intelligence: clampStat(ceilDiv(c.spa + c.spd, 20) + getTypeBonus('Intelligence', types)),
    Fortitude: clampStat(ceilDiv(c.hp + c.def, 20) + getTypeBonus('Fortitude', types)),
    Charm: clampStat(ceilDiv(c.hp + c.spd, 20) + getTypeBonus('Charm', types)),
  };
}

/** Contest battle stats: use CALCULATED stats */
function calcContestStats(mon: BattlePokemon) {
  const c = mon.computedStats || computeRealStats(mon);
  const types = mon.types || [];
  return {
    Strength: clampStat(ceilDiv(c.atk, 10) + getTypeBonus('Strength', types)),
    Athletics: clampStat(ceilDiv(c.spe, 10) + getTypeBonus('Athletics', types)),
    Intelligence: clampStat(ceilDiv(c.spa + c.spd, 20) + getTypeBonus('Intelligence', types)),
    Fortitude: clampStat(ceilDiv(c.hp + c.def, 20) + getTypeBonus('Fortitude', types)),
    Charm: clampStat(ceilDiv(c.hp + c.spd, 20) + getTypeBonus('Charm', types)),
  };
}

function contestBonus(stat: number) { return Math.ceil(stat / 2); }

function movePowerBonus(adjustedPower: number): number {
  if (adjustedPower >= 130) return 6;
  if (adjustedPower >= 110) return 5;
  if (adjustedPower >= 90) return 4;
  if (adjustedPower >= 70) return 3;
  if (adjustedPower >= 50) return 2;
  if (adjustedPower >= 30) return 1;
  return 0;
}

const APPEAL_LOSS_BANDS = [
  { label: 'Minor', dice: '1d4', min: 1, max: 4 },
  { label: 'Solid', dice: '2d6', min: 2, max: 12 },
  { label: 'Major', dice: '3d6', min: 3, max: 18 },
  { label: 'Reversal', dice: '4d6', min: 4, max: 24 },
] as const;

const APPROACHES = ['Attack', 'Block', 'Dodge', 'Setup', 'Reposition', 'Combo'] as const;

/* ── Main Component ────────────────────────────────────────────────── */

interface ContestTabProps {
  boxes: Array<Array<BattlePokemon | null>>;
}

const LS_KEY = 'ttrpg.contest';

function loadContestState(): ContestState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveContestState(state: ContestState) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function defaultState(): ContestState {
  return {
    format: 'singles',
    round: 'setup',
    selectedPokemon: [null],
    appeal: [60, 60],
    turnsRemaining: 5,
    reactions: [2, 2],
    round1Scores: { entrance: 0, cute: 0, beauty: 0, cool: 0, tough: 0, smart: 0 },
    lockedMove: null,
    lockedApproach: null,
    moveHistory: [],
    routineMoves: [],
    supportChecks: [],
    supportBonus: 0,
  };
}

export function ContestTab({ boxes }: ContestTabProps) {
  const [state, setState] = useState<ContestState>(() => loadContestState() || defaultState());
  const [showRules, setShowRules] = useState(false);
  const [rulesContent, setRulesContent] = useState('');
  const [rulesLoading, setRulesLoading] = useState(false);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const [pcSearch, setPcSearch] = useState('');

  // Persist state
  useEffect(() => { saveContestState(state); }, [state]);

  const update = useCallback((patch: Partial<ContestState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  // All pokemon from PC
  const allPokemon = useMemo(() => {
    const mons: BattlePokemon[] = [];
    for (const box of boxes) {
      for (const slot of box) {
        if (slot) mons.push(slot);
      }
    }
    return mons;
  }, [boxes]);

  const filteredPokemon = useMemo(() => {
    if (!pcSearch.trim()) return allPokemon;
    const q = pcSearch.toLowerCase();
    return allPokemon.filter(m =>
      (m.species || m.name).toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q)
    );
  }, [allPokemon, pcSearch]);

  // Load rules doc
  const loadRules = useCallback(() => {
    if (rulesContent) { setShowRules(true); return; }
    setRulesLoading(true);
    fetch(withPublicBase('docs/rules/Pokemon Contest & Showcase Draft.md'))
      .then(r => r.ok ? r.text() : 'Failed to load rules.')
      .then(t => { setRulesContent(t); setShowRules(true); setRulesLoading(false); })
      .catch(() => { setRulesContent('Could not load rules.'); setShowRules(true); setRulesLoading(false); });
  }, [rulesContent]);

  // Get sprite URL for display
  const getPokemonSprite = (mon: BattlePokemon) => {
    if (mon.sprite) return mon.sprite;
    const url = spriteUrl(mon.species || mon.name, mon.shiny);
    return url || '';
  };

  // Current selected pokemon (filtered non-null)
  const contestPokemon = state.selectedPokemon.filter((p): p is BattlePokemon => p !== null);

  /* ── Setup Screen ─────────────────────────────────────────────── */
  if (state.round === 'setup') {
    const maxPicks = state.format === 'doubles' ? 2 : 1;
    return (
      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 16px' }}>🎪 Contest Setup</h2>

        {/* Format selection */}
        <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 8px' }}>Format</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            {(['singles', 'doubles'] as const).map(f => (
              <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={state.format === f}
                  onChange={() => update({
                    format: f,
                    selectedPokemon: f === 'doubles' ? [state.selectedPokemon[0] || null, null] : [state.selectedPokemon[0] || null],
                  })}
                />
                <span style={{ textTransform: 'capitalize', fontWeight: state.format === f ? 600 : 400 }}>{f}</span>
                <span className="dim" style={{ fontSize: '0.8em' }}>({f === 'singles' ? '1 Pokémon' : '2 Pokémon'})</span>
              </label>
            ))}
          </div>
        </section>

        {/* Pokemon selection */}
        <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 8px' }}>Select Pokémon from PC</h3>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {Array.from({ length: maxPicks }, (_, i) => {
              const mon = state.selectedPokemon[i];
              return (
                <div
                  key={i}
                  onClick={() => setPickingSlot(pickingSlot === i ? null : i)}
                  style={{
                    width: 120, height: 140, border: `2px ${pickingSlot === i ? 'solid var(--accent)' : 'dashed #555'}`,
                    borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', background: mon ? 'rgba(233,69,96,0.08)' : 'transparent', transition: 'all .15s',
                  }}
                >
                  {mon ? (
                    <>
                      <img src={getPokemonSprite(mon)} alt={mon.name} style={{ width: 64, height: 64, imageRendering: 'pixelated' }} />
                      <div style={{ fontSize: '0.85em', fontWeight: 600, marginTop: 4 }}>{mon.name}</div>
                      <div className="dim" style={{ fontSize: '0.75em' }}>Lv.{mon.level}</div>
                    </>
                  ) : (
                    <div className="dim" style={{ textAlign: 'center', fontSize: '0.85em' }}>Slot {i + 1}<br />Click to pick</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* PC picker */}
          {pickingSlot !== null && (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 8, padding: 8, maxHeight: 300, overflowY: 'auto' }}>
              <input
                placeholder="Search PC…"
                value={pcSearch}
                onChange={e => setPcSearch(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #555', marginBottom: 8, background: 'var(--panel-bg)', color: 'inherit' }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                {filteredPokemon.map((mon, idx) => (
                  <div
                    key={`${mon.name}-${idx}`}
                    onClick={() => {
                      const next = [...state.selectedPokemon];
                      next[pickingSlot] = mon;
                      update({ selectedPokemon: next });
                      setPickingSlot(null);
                      setPcSearch('');
                    }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 6, border: '1px solid #444',
                      borderRadius: 8, cursor: 'pointer', transition: 'background .1s',
                    }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(233,69,96,0.15)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <img src={getPokemonSprite(mon)} alt={mon.name} style={{ width: 48, height: 48, imageRendering: 'pixelated' }} />
                    <div style={{ fontSize: '0.75em', fontWeight: 600, textAlign: 'center' }}>{mon.name}</div>
                    <div className="dim" style={{ fontSize: '0.65em' }}>Lv.{mon.level}</div>
                  </div>
                ))}
                {filteredPokemon.length === 0 && <div className="dim" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 12 }}>No Pokémon found</div>}
              </div>
            </div>
          )}
        </section>

        {/* Start buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            disabled={contestPokemon.length === 0}
            onClick={() => update({ round: 'round1', round1Scores: { entrance: 0, cute: 0, beauty: 0, cool: 0, tough: 0, smart: 0 }, routineMoves: [], supportChecks: [], supportBonus: 0 })}
            style={{ padding: '10px 24px', fontSize: '1em' }}
          >
            Start Round 1 — Appeal Stage
          </button>
          <button
            disabled={contestPokemon.length === 0}
            onClick={() => update({ round: 'round2', appeal: [60, 60], turnsRemaining: 5, reactions: [2, 2], lockedMove: null, lockedApproach: null, moveHistory: [] })}
            style={{ padding: '10px 24px', fontSize: '1em' }}
            className="secondary"
          >
            Skip to Round 2 — Contest Battle
          </button>
          <button onClick={loadRules} className="secondary" style={{ marginLeft: 'auto' }}>
            {rulesLoading ? 'Loading…' : '📖 Contest Rules'}
          </button>
        </div>

        {/* Rules viewer */}
        {showRules && (
          <section className="panel" style={{ marginTop: 12, padding: 12, maxHeight: 400, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Contest Rules</h3>
              <button className="mini" onClick={() => setShowRules(false)}>Close</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: '0.85em' }}>{rulesContent}</pre>
          </section>
        )}
      </div>
    );
  }

  /* ── Round 1: Appeal Stage ──────────────────────────────────────── */
  if (state.round === 'round1') {
    const scores = state.round1Scores;
    const total = scores.entrance + scores.cute + scores.beauty + scores.cool + scores.tough + scores.smart + state.supportBonus;
    const mon = contestPokemon[0];

    return (
      <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>🎤 Round 1 — Appeal Stage</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="mini" onClick={loadRules}>📖 Rules</button>
            <button className="mini secondary" onClick={() => update({ round: 'setup' })}>← Back</button>
          </div>
        </div>

        {showRules && (
          <section className="panel" style={{ marginBottom: 12, padding: 12, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>Contest Rules</strong>
              <button className="mini" onClick={() => setShowRules(false)}>Close</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: '0.8em' }}>{rulesContent}</pre>
          </section>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
          {/* Left: Pokemon info + field stats */}
          <section className="panel" style={{ padding: 12 }}>
            {mon && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <img src={getPokemonSprite(mon)} alt={mon.name} style={{ width: 80, height: 80, imageRendering: 'pixelated' }} />
                  <div style={{ fontWeight: 600 }}>{mon.name}</div>
                  <div className="dim" style={{ fontSize: '0.8em' }}>Lv.{mon.level} • {mon.types.join('/')}</div>
                </div>
                <h4 style={{ margin: '12px 0 6px' }}>Field Stats</h4>
                {(() => {
                  const stats = calcFieldStats(mon);
                  return Object.entries(stats).map(([name, val]) => (
                    <div key={name} style={{ display: 'grid', gridTemplateColumns: '85px 1fr 30px 30px', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.8em' }}>{name}</span>
                      <div style={{ background: '#333', borderRadius: 4, height: 12 }}>
                        <div style={{ width: `${(val / 20) * 100}%`, background: 'var(--accent)', borderRadius: 4, height: '100%' }} />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '0.85em', textAlign: 'right' }}>{val}</span>
                      <span className="dim" style={{ fontSize: '0.75em' }}>+{contestBonus(val)}</span>
                    </div>
                  ));
                })()}
                <h4 style={{ margin: '12px 0 6px' }}>Moves</h4>
                <div style={{ display: 'grid', gap: 4 }}>
                  {mon.moves.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', padding: '2px 4px', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }}>
                      <span>{m.name}</span>
                      <span className="dim">{m.type} {m.power > 0 ? `(${m.power})` : ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Right: Scoring lanes */}
          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ margin: '0 0 12px' }}>Appeal Scoring — {total}/30{state.supportBonus !== 0 ? ` (${state.supportBonus > 0 ? '+' : ''}${state.supportBonus} support)` : ''}</h3>

            {/* Routine Move Selection */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px' }}>Routine Moves</h4>
              {mon && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {mon.moves.map((m, i) => {
                    const sel = state.routineMoves.includes(i);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          const next = sel
                            ? state.routineMoves.filter(x => x !== i)
                            : state.routineMoves.length < 4
                              ? [...state.routineMoves, i]
                              : state.routineMoves;
                          update({ routineMoves: next, supportChecks: [] });
                        }}
                        style={{
                          padding: '6px 12px', borderRadius: 8,
                          border: sel ? '2px solid var(--accent)' : '1px solid #555',
                          background: sel ? 'rgba(233,69,96,0.2)' : 'transparent',
                          fontSize: '0.85em', cursor: 'pointer',
                        }}
                      >
                        {m.name}
                        <span className="dim" style={{ marginLeft: 6, fontSize: '0.8em' }}>
                          {m.type}{m.power > 0 ? ` (${m.power})` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="dim" style={{ fontSize: '0.8em' }}>
                Select up to 4 moves for the routine. {state.routineMoves.length <= 2 ? '1 support roll' : '2 support rolls'} available.
              </div>
            </div>

            {/* Support Check (Optional) */}
            {state.routineMoves.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, border: '1px dashed #666', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                <h4 style={{ margin: '0 0 8px' }}>🎲 Support Check <span className="dim" style={{ fontWeight: 400, fontSize: '0.8em' }}>(optional)</span></h4>
                <div className="dim" style={{ fontSize: '0.8em', marginBottom: 8 }}>
                  Pokémon rolls based on routine moves. Strong: +2 Appeal. Fail: −1 if visible.
                </div>
                {(() => {
                  const rollCount = state.routineMoves.length <= 2 ? 1 : 2;
                  const fStats = mon ? calcFieldStats(mon) : null;
                  return Array.from({ length: rollCount }, (_, i) => {
                    const check = state.supportChecks[i] || { stat: 'Intelligence', roll: null };
                    const statVal = fStats ? (fStats as Record<string, number>)[check.stat] || 0 : 0;
                    const bonus = Math.ceil(statVal / 2);
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85em', fontWeight: 600, minWidth: 50 }}>Roll {i + 1}:</span>
                        <select
                          value={check.stat}
                          onChange={e => {
                            const next = [...state.supportChecks];
                            next[i] = { ...check, stat: e.target.value, roll: null };
                            update({ supportChecks: next });
                          }}
                          style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--panel-bg)', color: 'inherit', border: '1px solid #555', fontSize: '0.85em' }}
                        >
                          <option value="Intelligence">Intelligence (planning)</option>
                          <option value="Charm">Handling (Charm)</option>
                          <option value="Fortitude">Style Kit (Fortitude)</option>
                          <option value="Strength">Strength</option>
                          <option value="Athletics">Athletics</option>
                        </select>
                        <span className="dim" style={{ fontSize: '0.8em' }}>+{bonus}</span>
                        <button
                          className="mini"
                          onClick={() => {
                            const roll = Math.floor(Math.random() * 12) + 1;
                            const next = [...state.supportChecks];
                            next[i] = { ...check, roll };
                            update({ supportChecks: next });
                          }}
                          style={{ padding: '4px 10px' }}
                        >
                          🎲 Roll d12
                        </button>
                        {check.roll !== null && (
                          <span style={{ fontWeight: 700, fontSize: '0.9em', color: (check.roll + bonus) >= 10 ? '#4fc3f7' : '#e94560' }}>
                            {check.roll} + {bonus} = {check.roll + bonus}
                            {check.roll === 12 && <span style={{ marginLeft: 4, color: '#ffa726' }}>NAT 12! (use +{statVal})</span>}
                          </span>
                        )}
                      </div>
                    );
                  });
                })()}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    className="mini"
                    onClick={() => update({ supportBonus: state.supportBonus + 2 })}
                    style={{ padding: '4px 12px', borderRadius: 6 }}
                  >
                    ✓ Strong (+2)
                  </button>
                  <button
                    className="mini secondary"
                    onClick={() => update({ supportBonus: state.supportBonus - 1 })}
                    style={{ padding: '4px 12px', borderRadius: 6 }}
                  >
                    ✗ Fail (−1)
                  </button>
                  {state.supportBonus !== 0 && (
                    <span style={{ fontSize: '0.85em', fontWeight: 600, color: state.supportBonus > 0 ? '#4fc3f7' : '#e94560', alignSelf: 'center' }}>
                      Bonus: {state.supportBonus > 0 ? '+' : ''}{state.supportBonus}
                    </span>
                  )}
                  {state.supportBonus !== 0 && (
                    <button className="mini secondary" onClick={() => update({ supportBonus: 0 })} style={{ padding: '4px 8px' }}>
                      Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              {([
                ['entrance', 'Entrance', 'Throw-out, arrival, first pose, visual impression.'],
                ['cute', 'Cute', 'Charm, sweetness, playful energy, emotional warmth.'],
                ['beauty', 'Beauty', 'Elegance, grace, poise, polish, visual balance.'],
                ['cool', 'Cool', 'Confidence, sharp timing, daring lines, presence.'],
                ['tough', 'Tough', 'Resilience, force, solidity, physical ownership.'],
                ['smart', 'Smart', 'Clever sequencing, illusions, feints, precision.'],
              ] as const).map(([key, label, desc]) => {
                const val = scores[key as keyof typeof scores];
                return (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div>
                        <strong>{label}</strong>
                        <span className="dim" style={{ fontSize: '0.75em', marginLeft: 8 }}>{desc}</span>
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '1.1em' }}>{val}/5</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0, 1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          onClick={() => update({ round1Scores: { ...scores, [key]: n } })}
                          style={{
                            width: 36, height: 32, borderRadius: 6,
                            border: n === val ? '2px solid var(--accent)' : '1px solid #555',
                            background: n === val ? 'var(--accent)' : n <= val ? 'rgba(233,69,96,0.2)' : 'transparent',
                            color: n === val ? '#fff' : 'inherit',
                            fontWeight: n === val ? 700 : 400,
                            cursor: 'pointer',
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total + Quick rubric */}
            <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--accent)', borderRadius: 8, background: 'rgba(233,69,96,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '1.2em' }}>Total Appeal: {total}/30</strong>
                <button
                  onClick={() => update({ round: 'round2', appeal: [60, 60], turnsRemaining: 5, reactions: [2, 2], lockedMove: null, lockedApproach: null, moveHistory: [] })}
                  style={{ padding: '8px 20px' }}
                  disabled={total === 0}
                >
                  Advance to Round 2 →
                </button>
              </div>
              <div className="dim" style={{ marginTop: 8, fontSize: '0.8em' }}>
                <strong>Quick rubric per lane:</strong> 0 = absent/undermined, 1 = barely present, 2 = present but weak, 3 = solid & readable, 4 = strong & memorable, 5 = standout
              </div>
            </div>

            {/* Role Helper */}
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: '0 0 8px' }}>🎭 Role Helper</h4>
              <div style={{ display: 'grid', gap: 6, fontSize: '0.85em' }}>
                <div style={{ padding: 8, border: '1px solid #555', borderRadius: 6 }}>
                  <strong>Main Check:</strong> Speech (default) — command presence, selling the plan.
                  <span className="dim"> Alt: Intelligence (choreography), Athletics (physical routines)</span>
                </div>
                <div style={{ padding: 8, border: '1px solid #555', borderRadius: 6 }}>
                  <strong>Support Check (optional):</strong> Intelligence (planning), Pokémon Handling (control), Style Kit (appearance).
                  <span className="dim"> Success: +2 Appeal. Fail: −1 if visible.</span>
                </div>
                <div style={{ padding: 8, border: '1px solid #555', borderRadius: 6 }}>
                  <strong>Contest Star Trait:</strong> +1 if ≥2 moves match flavor lane, +2 if ≥3 moves build same lane.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  /* ── Round 2: Contest Battle ────────────────────────────────────── */
  const mon = contestPokemon[0];
  const contestStats = mon ? calcContestStats(mon) : null;

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>⚔️ Round 2 — Contest Battle</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: '0.85em' }}>Turn {6 - state.turnsRemaining}/5</span>
          <button className="mini" onClick={loadRules}>📖 Rules</button>
          <button className="mini secondary" onClick={() => update({ round: 'round1' })}>← Round 1</button>
          <button className="mini secondary" onClick={() => setState(defaultState())}>Reset All</button>
        </div>
      </div>

      {showRules && (
        <section className="panel" style={{ marginBottom: 12, padding: 12, maxHeight: 250, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>Contest Rules</strong>
            <button className="mini" onClick={() => setShowRules(false)}>Close</button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: '0.8em' }}>{rulesContent}</pre>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 260px', gap: 16 }}>
        {/* Left: Player side */}
        <section className="panel" style={{ padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', textAlign: 'center', color: '#4fc3f7' }}>Player</h3>
          {mon && (
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <img src={getPokemonSprite(mon)} alt={mon.name} style={{ width: 72, height: 72, imageRendering: 'pixelated' }} />
              <div style={{ fontWeight: 600 }}>{mon.name}</div>
              <div className="dim" style={{ fontSize: '0.8em' }}>{mon.types.join('/')}</div>
            </div>
          )}

          {/* Appeal gauge */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', marginBottom: 4 }}>
              <span>Appeal</span>
              <strong style={{ color: state.appeal[0] <= 15 ? '#e94560' : state.appeal[0] <= 30 ? '#ffa726' : '#4fc3f7' }}>
                {state.appeal[0]}
              </strong>
            </div>
            <div style={{ background: '#333', borderRadius: 4, height: 16 }}>
              <div style={{
                width: `${Math.max(0, Math.min(100, (state.appeal[0] / 60) * 100))}%`,
                background: state.appeal[0] <= 15 ? '#e94560' : '#4fc3f7',
                borderRadius: 4, height: '100%', transition: 'width .3s',
              }} />
            </div>
          </div>

          {/* Quick adjust */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {[-1, -3, -5, -10].map(n => (
              <button key={n} className="mini secondary" onClick={() => update({ appeal: [Math.max(0, state.appeal[0] + n), state.appeal[1]] })}>
                {n}
              </button>
            ))}
            {[1, 3, 5, 10].map(n => (
              <button key={n} className="mini" onClick={() => update({ appeal: [Math.min(99, state.appeal[0] + n), state.appeal[1]] })}>
                +{n}
              </button>
            ))}
          </div>

          <div className="dim" style={{ fontSize: '0.8em', textAlign: 'center' }}>
            Reactions left: <strong>{state.reactions[0]}</strong>/2
            {state.reactions[0] > 0 && (
              <button className="mini secondary" style={{ marginLeft: 8 }}
                onClick={() => update({ reactions: [state.reactions[0] - 1, state.reactions[1]] })}>
                Use Reaction
              </button>
            )}
          </div>

          {/* Contest stats */}
          {contestStats && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.85em' }}>Contest Stats</h4>
              {Object.entries(contestStats).map(([name, val]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', padding: '2px 0' }}>
                  <span>{name}</span>
                  <span><strong>{val}</strong> <span className="dim">(+{contestBonus(val)})</span></span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Center: Battle controls */}
        <section className="panel" style={{ padding: 12 }}>
          {/* Turn tracker */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            {[1, 2, 3, 4, 5].map(t => {
              const current = 6 - state.turnsRemaining;
              const isTempo = t === 1 || t === 3 || t === 5;
              return (
                <div
                  key={t}
                  style={{
                    width: 48, height: 48, borderRadius: '50%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    border: t === current ? '2px solid var(--accent)' : '1px solid #555',
                    background: t < current ? 'rgba(233,69,96,0.2)' : t === current ? 'rgba(233,69,96,0.4)' : 'transparent',
                    fontSize: '0.85em', fontWeight: t === current ? 700 : 400,
                  }}
                >
                  <span>{t}</span>
                  {isTempo && <span style={{ fontSize: '0.55em', color: '#ffa726' }}>TEMPO</span>}
                </div>
              );
            })}
          </div>

          {/* Move lock-in */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px' }}>Lock In Move</h4>
            {mon && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {mon.moves.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => update({ lockedMove: state.lockedMove === m.name ? null : m.name })}
                    style={{
                      padding: '8px 10px', borderRadius: 8, textAlign: 'left',
                      border: state.lockedMove === m.name ? '2px solid var(--accent)' : '1px solid #555',
                      background: state.lockedMove === m.name ? 'rgba(233,69,96,0.2)' : 'transparent',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.9em' }}>{m.name}</div>
                    <div className="dim" style={{ fontSize: '0.75em' }}>
                      {m.type} • {m.category} {m.power > 0 ? `• Power ${m.power} (+${movePowerBonus(m.power)})` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Approach */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px' }}>Approach</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {APPROACHES.map(a => (
                <button
                  key={a}
                  onClick={() => update({ lockedApproach: state.lockedApproach === a ? null : a })}
                  className={state.lockedApproach === a ? 'active' : ''}
                  style={{
                    padding: '6px 14px', borderRadius: 16,
                    border: state.lockedApproach === a ? '2px solid var(--accent)' : '1px solid #555',
                    background: state.lockedApproach === a ? 'var(--accent)' : 'transparent',
                    color: state.lockedApproach === a ? '#fff' : 'inherit',
                    fontSize: '0.85em',
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Stat pick helper */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px' }}>🎭 Stat Pick Helper</h4>
            <div style={{ display: 'grid', gap: 4, fontSize: '0.8em' }}>
              <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}><strong>Strength:</strong> overpowering, charging, direct collision</div>
              <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}><strong>Athletics:</strong> dodging, weaving, evasive timing</div>
              <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}><strong>Intelligence:</strong> shaping, barriers, beam control, setup</div>
              <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}><strong>Fortitude:</strong> bracing, shielding, enduring force</div>
              <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}><strong>Charm:</strong> posture, feints, confidence, winning the room</div>
            </div>
          </div>

          {/* Appeal loss band roller */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px' }}>Appeal Loss Bands</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {APPEAL_LOSS_BANDS.map(band => (
                <button
                  key={band.label}
                  onClick={() => {
                    // Roll the dice
                    let roll = 0;
                    const numDice = band.label === 'Minor' ? 1 : band.label === 'Solid' ? 2 : band.label === 'Major' ? 3 : 4;
                    const sides = band.label === 'Minor' ? 4 : 6;
                    for (let d = 0; d < numDice; d++) roll += Math.floor(Math.random() * sides) + 1;
                    alert(`${band.label} loss: ${band.dice} = ${roll} Appeal Points`);
                  }}
                  className="secondary"
                  style={{ padding: '8px 6px', borderRadius: 6, fontSize: '0.8em' }}
                >
                  <div style={{ fontWeight: 600 }}>{band.label}</div>
                  <div className="dim">{band.dice}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Turn control */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12 }}>
            <button
              disabled={state.turnsRemaining <= 0}
              onClick={() => {
                const history = [...state.moveHistory];
                if (state.lockedMove) history.push(`T${6 - state.turnsRemaining}: ${state.lockedMove} (${state.lockedApproach || '?'})`);
                update({
                  turnsRemaining: state.turnsRemaining - 1,
                  lockedMove: null,
                  lockedApproach: null,
                  moveHistory: history,
                });
              }}
              style={{ padding: '10px 24px', fontSize: '1em' }}
            >
              {state.turnsRemaining > 0 ? `End Turn ${6 - state.turnsRemaining}` : 'Match Over'}
            </button>
          </div>

          {/* Match result */}
          {state.turnsRemaining <= 0 && (
            <div style={{ marginTop: 16, padding: 16, border: '2px solid var(--accent)', borderRadius: 12, textAlign: 'center', background: 'rgba(233,69,96,0.08)' }}>
              <h3 style={{ margin: '0 0 8px' }}>
                {state.appeal[0] > state.appeal[1] ? '🏆 Player Wins!' :
                  state.appeal[0] < state.appeal[1] ? '💀 Opponent Wins!' : '🤝 Tie!'}
              </h3>
              <div className="dim">Player: {state.appeal[0]} AP — Opponent: {state.appeal[1]} AP</div>
              <button className="secondary" style={{ marginTop: 12 }} onClick={() => setState(defaultState())}>
                New Contest
              </button>
            </div>
          )}

          {/* Move history */}
          {state.moveHistory.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 4px' }}>Move History</h4>
              <div style={{ fontSize: '0.8em' }}>
                {state.moveHistory.map((h, i) => <div key={i} className="dim">{h}</div>)}
              </div>
            </div>
          )}
        </section>

        {/* Right: Opponent side */}
        <section className="panel" style={{ padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', textAlign: 'center', color: '#e94560' }}>Opponent</h3>
          <div style={{ textAlign: 'center', marginBottom: 8, padding: 16 }}>
            <div className="dim" style={{ fontSize: '0.85em' }}>DM-controlled opponent</div>
          </div>

          {/* Opponent appeal gauge */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', marginBottom: 4 }}>
              <span>Appeal</span>
              <strong style={{ color: state.appeal[1] <= 15 ? '#e94560' : state.appeal[1] <= 30 ? '#ffa726' : '#e94560' }}>
                {state.appeal[1]}
              </strong>
            </div>
            <div style={{ background: '#333', borderRadius: 4, height: 16 }}>
              <div style={{
                width: `${Math.max(0, Math.min(100, (state.appeal[1] / 60) * 100))}%`,
                background: '#e94560',
                borderRadius: 4, height: '100%', transition: 'width .3s',
              }} />
            </div>
          </div>

          {/* Quick adjust opponent */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {[-1, -3, -5, -10].map(n => (
              <button key={n} className="mini secondary" onClick={() => update({ appeal: [state.appeal[0], Math.max(0, state.appeal[1] + n)] })}>
                {n}
              </button>
            ))}
            {[1, 3, 5, 10].map(n => (
              <button key={n} className="mini" onClick={() => update({ appeal: [state.appeal[0], Math.min(99, state.appeal[1] + n)] })}>
                +{n}
              </button>
            ))}
          </div>

          <div className="dim" style={{ fontSize: '0.8em', textAlign: 'center' }}>
            Reactions left: <strong>{state.reactions[1]}</strong>/2
            {state.reactions[1] > 0 && (
              <button className="mini secondary" style={{ marginLeft: 8 }}
                onClick={() => update({ reactions: [state.reactions[0], state.reactions[1] - 1] })}>
                Use Reaction
              </button>
            )}
          </div>

          {/* Common matchups reference */}
          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: '0.85em' }}>Common Matchups</h4>
            <div style={{ fontSize: '0.75em', display: 'grid', gap: 3 }}>
              <div className="dim">Attack → Block: STR vs FTD</div>
              <div className="dim">Ranged → Sidestep: INT/STR vs ATH</div>
              <div className="dim">Setup → Rush: INT vs ATH</div>
              <div className="dim">Wall → Break: FTD/INT vs STR</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
