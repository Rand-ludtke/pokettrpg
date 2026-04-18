import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameProps } from './types';
import { gamecornerAsset } from './assets';

type TableId = 'left' | 'right';
type RowId = 'orange' | 'green' | 'purple';
type PokemonId = 'wynaut' | 'azurill' | 'skitty' | 'makuhita';
type SelectionId = string;

interface TableDef {
  id: TableId;
  label: string;
  minBet: number;
  themeClass: string;
}

interface SlotDef {
  slotId: number;
  row: RowId;
  pokemon: PokemonId;
  icon: string;
}

const ASSET_ROOT = gamecornerAsset('roulette').replace(/\/$/, '');
const BALLS_PER_ROUND = 6;
const MAX_MULTIPLIER = 12;
const MULTIPLIER_TABLE = [0, 3, 4, 6, MAX_MULTIPLIER];
const DIGIT_WIDTH = 8;
const DIGIT_HEIGHT = 8;
const GRID_ICON_SIZE = 16;
const HEADER_ICON_SIZE = 16;
const CURSOR_SIZE = 16;
const MULTIPLIER_WIDTH = 24;
const MULTIPLIER_HEIGHT = 16;
const POKEMON_HEADER_FRAME: Record<PokemonId, number> = {
  wynaut: 4,
  azurill: 5,
  skitty: 6,
  makuhita: 7,
};
const ROW_HEADER_FRAME: Record<RowId, number> = {
  orange: 8,
  green: 9,
  purple: 10,
};
const MULTIPLIER_FRAME: Record<number, number> = {
  3: 0,
  4: 1,
  6: 2,
  12: 3,
};

const TABLES: TableDef[] = [
  { id: 'left', label: 'Left Table', minBet: 1, themeClass: 'roulette-theme-left' },
  { id: 'right', label: 'Right Table', minBet: 3, themeClass: 'roulette-theme-right' },
];

const ROW_META: Record<RowId, { label: string; colorClass: string }> = {
  orange: { label: 'Orange', colorClass: 'roulette-row-orange' },
  green: { label: 'Green', colorClass: 'roulette-row-green' },
  purple: { label: 'Purple', colorClass: 'roulette-row-purple' },
};

const POKEMON_META: Record<PokemonId, { label: string; icon: string }> = {
  wynaut: { label: 'Wynaut', icon: `${ASSET_ROOT}/wynaut.png` },
  azurill: { label: 'Azurill', icon: `${ASSET_ROOT}/azurill.png` },
  skitty: { label: 'Skitty', icon: `${ASSET_ROOT}/skitty.png` },
  makuhita: { label: 'Makuhita', icon: `${ASSET_ROOT}/makuhita.png` },
};

const POKEMON_ORDER: PokemonId[] = ['wynaut', 'azurill', 'skitty', 'makuhita'];
const ROW_ORDER: RowId[] = ['orange', 'green', 'purple'];

const SLOTS: SlotDef[] = [
  { slotId: 0, row: 'orange', pokemon: 'wynaut', icon: POKEMON_META.wynaut.icon },
  { slotId: 1, row: 'green', pokemon: 'azurill', icon: POKEMON_META.azurill.icon },
  { slotId: 2, row: 'purple', pokemon: 'skitty', icon: POKEMON_META.skitty.icon },
  { slotId: 3, row: 'orange', pokemon: 'makuhita', icon: POKEMON_META.makuhita.icon },
  { slotId: 4, row: 'green', pokemon: 'wynaut', icon: POKEMON_META.wynaut.icon },
  { slotId: 5, row: 'purple', pokemon: 'azurill', icon: POKEMON_META.azurill.icon },
  { slotId: 6, row: 'orange', pokemon: 'skitty', icon: POKEMON_META.skitty.icon },
  { slotId: 7, row: 'green', pokemon: 'makuhita', icon: POKEMON_META.makuhita.icon },
  { slotId: 8, row: 'purple', pokemon: 'wynaut', icon: POKEMON_META.wynaut.icon },
  { slotId: 9, row: 'orange', pokemon: 'azurill', icon: POKEMON_META.azurill.icon },
  { slotId: 10, row: 'green', pokemon: 'skitty', icon: POKEMON_META.skitty.icon },
  { slotId: 11, row: 'purple', pokemon: 'makuhita', icon: POKEMON_META.makuhita.icon },
];

function slotSelection(slotId: number): SelectionId {
  return `slot:${slotId}`;
}

function columnSelection(pokemon: PokemonId): SelectionId {
  return `column:${pokemon}`;
}

function rowSelection(row: RowId): SelectionId {
  return `row:${row}`;
}

function parseSelection(selectionId: SelectionId): { kind: 'slot' | 'column' | 'row'; value: string } {
  const [kind, value] = selectionId.split(':');
  if (kind === 'slot' || kind === 'column' || kind === 'row') {
    return { kind, value };
  }
  return { kind: 'slot', value: '0' };
}

function firstOpenSelection(hitSet: Set<number>): SelectionId {
  const nextSlot = SLOTS.find((slot) => !hitSet.has(slot.slotId));
  return slotSelection(nextSlot ? nextSlot.slotId : 0);
}

function selectionMatchesSlot(selectionId: SelectionId, slot: SlotDef): boolean {
  const selection = parseSelection(selectionId);
  if (selection.kind === 'slot') return Number(selection.value) === slot.slotId;
  if (selection.kind === 'column') return selection.value === slot.pokemon;
  return selection.value === slot.row;
}

function wheelSlotStyle(slotId: number): React.CSSProperties {
  const angle = -90 + slotId * 30;
  return {
    transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-92px) rotate(${-angle}deg)`,
  };
}

function normalizeAngle(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function SpriteFrame({
  src,
  width,
  height,
  x = 0,
  y = 0,
  scale = 1,
  className = '',
  alt = '',
}: {
  src: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  scale?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <span className={`roulette-sprite-frame ${className}`.trim()} style={{ width: width * scale, height: height * scale }}>
      <img
        src={src}
        alt={alt}
        style={{
          left: -x * scale,
          top: -y * scale,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </span>
  );
}

function DigitDisplay({ value, minDigits = 1 }: { value: number; minDigits?: number }) {
  const digits = Math.max(0, Math.floor(value)).toString().padStart(minDigits, '0');
  return (
    <span className="roulette-digit-strip" aria-label={digits}>
      {digits.split('').map((digit, index) => (
        <SpriteFrame
          key={`${digit}-${index}`}
          src={`${ASSET_ROOT}/numbers.png`}
          width={DIGIT_WIDTH}
          height={DIGIT_HEIGHT}
          x={Number(digit) * DIGIT_WIDTH}
          scale={2}
        />
      ))}
    </span>
  );
}

function MultiplierBadge({ multiplier }: { multiplier: number }) {
  return (
    <SpriteFrame
      src={`${ASSET_ROOT}/multiplier.png`}
      width={MULTIPLIER_WIDTH}
      height={MULTIPLIER_HEIGHT}
      y={(MULTIPLIER_FRAME[multiplier] ?? 0) * MULTIPLIER_HEIGHT}
      scale={2}
      className="roulette-multiplier-sprite"
    />
  );
}

function HelperSprite({ tableId }: { tableId: TableId }) {
  if (tableId === 'left') {
    return <SpriteFrame src={`${ASSET_ROOT}/shroomish.png`} width={24} height={16} scale={2} className="roulette-helper-sprite" />;
  }
  return <SpriteFrame src={`${ASSET_ROOT}/tailow.png`} width={32} height={16} scale={2} className="roulette-helper-sprite" />;
}

function GridIcon({ slotId, scale = 2 }: { slotId: number; scale?: number }) {
  return (
    <SpriteFrame
      src={`${ASSET_ROOT}/grid_icons.png`}
      width={GRID_ICON_SIZE}
      height={GRID_ICON_SIZE}
      y={slotId * GRID_ICON_SIZE}
      scale={scale}
      className="roulette-grid-icon"
    />
  );
}

function HeaderIcon({ frame, scale = 2 }: { frame: number; scale?: number }) {
  return (
    <SpriteFrame
      src={`${ASSET_ROOT}/headers.png`}
      width={HEADER_ICON_SIZE}
      height={HEADER_ICON_SIZE}
      y={frame * HEADER_ICON_SIZE}
      scale={scale}
      className="roulette-header-icon"
    />
  );
}

function wheelBallStyle(angle: number, radius: number): React.CSSProperties {
  return {
    transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px)`,
  };
}

function BallSprite({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <span className={`roulette-ball-sprite ${dimmed ? 'dimmed' : ''}`}>
      <img src={`${ASSET_ROOT}/ball.png`} alt="" />
    </span>
  );
}

export function Roulette({ coins, addCoins, spendCoins }: GameProps) {
  const [tableId, setTableId] = useState<TableId>('left');
  const [selectedSelectionId, setSelectedSelectionId] = useState<SelectionId>(slotSelection(0));
  const [hitSlotIds, setHitSlotIds] = useState<number[]>([]);
  const [ballsUsed, setBallsUsed] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [needsBoardClear, setNeedsBoardClear] = useState(false);
  const [winningSlotId, setWinningSlotId] = useState<number | null>(null);
  const [message, setMessage] = useState('The minimum wager changes by table. Pick a square, row, or column to place a Rogue-style bet.');
  const [wheelAngle, setWheelAngle] = useState(0);
  const [ballAngle, setBallAngle] = useState(-90);
  const [ballRadius, setBallRadius] = useState(96);

  const wheelAngleRef = useRef(0);
  const ballAngleRef = useRef(-90);
  const animationFrameRef = useRef<number | null>(null);

  const currentTable = TABLES.find((table) => table.id === tableId) ?? TABLES[0];
  const hitSet = useMemo(() => new Set(hitSlotIds), [hitSlotIds]);

  const rowHits = useMemo(() => {
    const counts: Record<RowId, number> = { orange: 0, green: 0, purple: 0 };
    for (const slotId of hitSlotIds) {
      const slot = SLOTS[slotId];
      if (slot) counts[slot.row] += 1;
    }
    return counts;
  }, [hitSlotIds]);

  const columnHits = useMemo(() => {
    const counts: Record<PokemonId, number> = { wynaut: 0, azurill: 0, skitty: 0, makuhita: 0 };
    for (const slotId of hitSlotIds) {
      const slot = SLOTS[slotId];
      if (slot) counts[slot.pokemon] += 1;
    }
    return counts;
  }, [hitSlotIds]);

  const getMultiplier = useCallback((selectionId: SelectionId) => {
    const selection = parseSelection(selectionId);
    if (selection.kind === 'row') {
      const row = selection.value as RowId;
      if (rowHits[row] >= POKEMON_ORDER.length) return 0;
      return MULTIPLIER_TABLE[rowHits[row] + 1];
    }
    if (selection.kind === 'column') {
      const pokemon = selection.value as PokemonId;
      if (columnHits[pokemon] >= ROW_ORDER.length) return 0;
      return MULTIPLIER_TABLE[columnHits[pokemon] + 2];
    }
    const slotId = Number(selection.value);
    return hitSet.has(slotId) ? 0 : MAX_MULTIPLIER;
  }, [columnHits, hitSet, rowHits]);

  const selectedMultiplier = getMultiplier(selectedSelectionId);
  const ballsRemaining = BALLS_PER_ROUND - ballsUsed;

  const resetBoard = useCallback((nextMessage: string) => {
    wheelAngleRef.current = 0;
    ballAngleRef.current = -90;
    setHitSlotIds([]);
    setBallsUsed(0);
    setNeedsBoardClear(false);
    setWinningSlotId(null);
    setSelectedSelectionId(slotSelection(0));
    setMessage(nextMessage);
    setWheelAngle(0);
    setBallAngle(-90);
    setBallRadius(96);
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const changeTable = useCallback((nextTableId: TableId) => {
    if (spinning || tableId === nextTableId) return;
    setTableId(nextTableId);
    resetBoard(`Switched to the ${TABLES.find((table) => table.id === nextTableId)?.label ?? 'selected'} roulette table.`);
  }, [resetBoard, spinning, tableId]);

  const clearBoard = useCallback(() => {
    resetBoard('The board was cleared after six balls, just like the Rogue table flow.');
  }, [resetBoard]);

  const spin = useCallback(() => {
    if (spinning) return;
    if (needsBoardClear) {
      setMessage('Board clear is pending. Start the next board before placing another wager.');
      return;
    }
    if (selectedMultiplier === 0) {
      setSelectedSelectionId(firstOpenSelection(hitSet));
      setMessage('That wager is already closed by the current board state. Pick a live square, row, or column.');
      return;
    }
    if (!spendCoins(currentTable.minBet)) {
      setMessage(`Not enough coins. ${currentTable.label} requires a minimum wager of ${currentTable.minBet}.`);
      return;
    }

    const landedSlot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
    const selectionAtSpin = selectedSelectionId;
    const multiplierAtSpin = selectedMultiplier;
    const hitSetAtSpin = new Set(hitSet);
    const currentAngle = wheelAngleRef.current;
    const targetAngle = normalizeAngle(-landedSlot.slotId * 30);
    const currentNormalized = normalizeAngle(currentAngle);
    let delta = targetAngle - currentNormalized;
    if (delta < 0) delta += 360;

    const fullSpins = currentTable.id === 'left' ? 4 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 2);
    const endAngle = currentAngle + fullSpins * 360 + delta;
    const duration = currentTable.id === 'left' ? 3800 : 3200;
    const startTime = performance.now();
    const startBallAngle = ballAngleRef.current;
    const startBallRadius = currentTable.id === 'left' ? 116 : 112;
    const endBallAngle = startBallAngle - (currentTable.id === 'left' ? 6 : 7) * 360;
    const endBallRadius = 94;

    setSpinning(true);
    setWinningSlotId(null);
    setBallRadius(startBallRadius);
    setMessage('The wheel is spinning. Follow the ball to the winning slot.');

    const animate = (timestamp: number) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const ballEase = 1 - Math.pow(1 - progress, 2.2);
      const dropProgress = Math.max(0, (progress - 0.55) / 0.45);
      const dropEase = 1 - Math.pow(1 - dropProgress, 2.4);
      const nextAngle = currentAngle + (endAngle - currentAngle) * eased;
      const nextBallAngle = startBallAngle + (endBallAngle - startBallAngle) * ballEase;
      const nextBallRadius = startBallRadius + (endBallRadius - startBallRadius) * dropEase;
      wheelAngleRef.current = nextAngle;
      ballAngleRef.current = nextBallAngle;
      setWheelAngle(nextAngle);
      setBallAngle(nextBallAngle);
      setBallRadius(nextBallRadius);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const nextHitSet = new Set(hitSetAtSpin);
      nextHitSet.add(landedSlot.slotId);
      const nextBallsUsed = ballsUsed + 1;
      const won = selectionMatchesSlot(selectionAtSpin, landedSlot);
      const payout = currentTable.minBet * multiplierAtSpin;

      wheelAngleRef.current = endAngle;
  ballAngleRef.current = endBallAngle;
      setWheelAngle(endAngle);
  setBallAngle(endBallAngle);
  setBallRadius(endBallRadius);
      setSpinning(false);
      setWinningSlotId(landedSlot.slotId);
      setHitSlotIds(Array.from(nextHitSet));
      setBallsUsed(nextBallsUsed);
      setSelectedSelectionId(firstOpenSelection(nextHitSet));

      if (won) {
        addCoins(payout);
      }

      if (nextBallsUsed >= BALLS_PER_ROUND) {
        setNeedsBoardClear(true);
      }

      if (won && multiplierAtSpin === MAX_MULTIPLIER) {
        setMessage(`Jackpot. ${POKEMON_META[landedSlot.pokemon].label} on ${ROW_META[landedSlot.row].label.toLowerCase()} paid ${payout} coins.${nextBallsUsed >= BALLS_PER_ROUND ? ' The board will be cleared next.' : ''}`);
      } else if (won) {
        setMessage(`It's a hit. ${POKEMON_META[landedSlot.pokemon].label} on ${ROW_META[landedSlot.row].label.toLowerCase()} paid ${payout} coins.${nextBallsUsed >= BALLS_PER_ROUND ? ' The board will be cleared next.' : ''}`);
      } else {
        setMessage(`Nothing doing. The ball stopped on ${POKEMON_META[landedSlot.pokemon].label} / ${ROW_META[landedSlot.row].label}.${nextBallsUsed >= BALLS_PER_ROUND ? ' The board will be cleared next.' : ''}`);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [addCoins, ballsUsed, currentTable, hitSet, needsBoardClear, selectedMultiplier, selectedSelectionId, spendCoins, spinning]);

  return (
    <div className={`roulette ${currentTable.themeClass}`}>
      <h2>Roulette</h2>

      <div className="roulette-status">
        <div className="roulette-table-picker">
          {TABLES.map((table) => (
            <button
              key={table.id}
              className={`roulette-table-btn ${table.id === tableId ? 'active' : ''}`}
              onClick={() => changeTable(table.id)}
              disabled={spinning}
            >
              <span>{table.label}</span>
              <span>Min {table.minBet}</span>
            </button>
          ))}
        </div>

        <div className="roulette-readouts">
          <div className="roulette-window-panel roulette-credit-panel">
            <SpriteFrame src={`${ASSET_ROOT}/credit.png`} width={48} height={11} scale={2} className="roulette-credit-label" />
            <DigitDisplay value={coins} minDigits={4} />
          </div>

          <div className="roulette-window-panel roulette-summary-panel">
            <div className="roulette-summary-item">
              <span className="roulette-summary-label">Wager</span>
              <DigitDisplay value={currentTable.minBet} />
            </div>
            <div className="roulette-summary-item">
              <span className="roulette-summary-label">Payout</span>
              {selectedMultiplier > 0 ? <MultiplierBadge multiplier={selectedMultiplier} /> : <span className="roulette-closed-label">Closed</span>}
            </div>
          </div>

          <div className="roulette-window-panel roulette-balls-panel">
            <img src={`${ASSET_ROOT}/ball_counter.png`} alt="" className="roulette-ball-counter-art" />
            <div className="roulette-ball-strip" aria-label="Balls remaining this round">
              {Array.from({ length: BALLS_PER_ROUND }, (_, index) => (
                <BallSprite key={index} dimmed={index < ballsUsed} />
              ))}
            </div>
            <div className="roulette-balls-remaining">Board balls: <strong>{ballsRemaining}</strong></div>
          </div>
        </div>
      </div>

      <div className="roulette-message">{message}</div>

      <div className="roulette-layout">
        <div className="roulette-wheel-shell">
          <div className="roulette-wheel-stage">
            <div className="roulette-pointer" />
            <div className="roulette-wheel-rotor" style={{ transform: `rotate(${wheelAngle}deg)` }}>
              <img src={`${ASSET_ROOT}/wheel.png`} alt="" className="roulette-wheel-base" />
              {SLOTS.map((slot) => (
                <button
                  key={slot.slotId}
                  type="button"
                  className={`roulette-wheel-icon ${ROW_META[slot.row].colorClass} ${winningSlotId === slot.slotId ? 'winner' : ''}`}
                  style={wheelSlotStyle(slot.slotId)}
                  onClick={() => !spinning && setSelectedSelectionId(slotSelection(slot.slotId))}
                  disabled={spinning}
                  title={`${POKEMON_META[slot.pokemon].label} / ${ROW_META[slot.row].label}`}
                >
                  <img src={slot.icon} alt="" className="roulette-pokemon-icon" />
                  {selectedSelectionId === slotSelection(slot.slotId) && (
                    <SpriteFrame
                      src={`${ASSET_ROOT}/cursor.png`}
                      width={CURSOR_SIZE}
                      height={CURSOR_SIZE}
                      scale={1.4}
                      className="roulette-wheel-cursor"
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="roulette-wheel-ball" style={wheelBallStyle(ballAngle, ballRadius)}>
              <SpriteFrame src={`${ASSET_ROOT}/shadow.png`} width={16} height={8} scale={2} className="roulette-ball-shadow" />
              <BallSprite />
            </div>
            <img src={`${ASSET_ROOT}/center.png`} alt="" className="roulette-wheel-center" />
          </div>

          <div className="roulette-actions">
            <button className="roulette-spin-btn" onClick={spin} disabled={spinning || needsBoardClear}>
              {spinning ? 'Spinning...' : `Spin (${currentTable.minBet} coin${currentTable.minBet === 1 ? '' : 's'})`}
            </button>
            {needsBoardClear && (
              <div className="roulette-clear-helper">
                <div className="roulette-helper-stack">
                  <SpriteFrame src={`${ASSET_ROOT}/shadow.png`} width={16} height={8} scale={2} className="roulette-helper-shadow" />
                  <HelperSprite tableId={tableId} />
                </div>
                <button className="mini" onClick={clearBoard}>
                  Clear Board
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="roulette-board">
          <div className="roulette-board-grid">
            <div className="roulette-board-corner">Bet</div>
            {POKEMON_ORDER.map((pokemon) => {
              const selectionId = columnSelection(pokemon);
              const multiplier = getMultiplier(selectionId);
              return (
                <button
                  key={pokemon}
                  className={`roulette-bet-button roulette-column-button ${selectedSelectionId === selectionId ? 'selected' : ''} ${multiplier === 0 ? 'closed' : ''}`}
                  onClick={() => setSelectedSelectionId(selectionId)}
                  disabled={spinning}
                >
                  <HeaderIcon frame={POKEMON_HEADER_FRAME[pokemon]} />
                  <span>{POKEMON_META[pokemon].label}</span>
                  {multiplier > 0 ? <MultiplierBadge multiplier={multiplier} /> : <span className="roulette-badge">Closed</span>}
                  {selectedSelectionId === selectionId && (
                    <SpriteFrame
                      src={`${ASSET_ROOT}/cursor.png`}
                      width={CURSOR_SIZE}
                      height={CURSOR_SIZE}
                      scale={3.2}
                      className="roulette-selection-cursor"
                    />
                  )}
                </button>
              );
            })}

            {ROW_ORDER.map((row) => {
              const rowSelectionId = rowSelection(row);
              return (
                <React.Fragment key={row}>
                  <button
                    className={`roulette-bet-button roulette-row-button ${ROW_META[row].colorClass} ${selectedSelectionId === rowSelectionId ? 'selected' : ''} ${getMultiplier(rowSelectionId) === 0 ? 'closed' : ''}`}
                    onClick={() => setSelectedSelectionId(rowSelectionId)}
                    disabled={spinning}
                  >
                    <HeaderIcon frame={ROW_HEADER_FRAME[row]} />
                    <span>{ROW_META[row].label}</span>
                    {getMultiplier(rowSelectionId) > 0 ? <MultiplierBadge multiplier={getMultiplier(rowSelectionId)} /> : <span className="roulette-badge">Closed</span>}
                    {selectedSelectionId === rowSelectionId && (
                      <SpriteFrame
                        src={`${ASSET_ROOT}/cursor.png`}
                        width={CURSOR_SIZE}
                        height={CURSOR_SIZE}
                        scale={3.2}
                        className="roulette-selection-cursor"
                      />
                    )}
                  </button>

                  {POKEMON_ORDER.map((pokemon) => {
                    const slot = SLOTS.find((entry) => entry.row === row && entry.pokemon === pokemon);
                    if (!slot) return null;
                    const selectionId = slotSelection(slot.slotId);
                    const hit = hitSet.has(slot.slotId);
                    return (
                      <button
                        key={selectionId}
                        className={`roulette-bet-button roulette-slot-button ${ROW_META[row].colorClass} ${selectedSelectionId === selectionId ? 'selected' : ''} ${hit ? 'hit' : ''} ${winningSlotId === slot.slotId ? 'winner' : ''}`}
                        onClick={() => setSelectedSelectionId(selectionId)}
                        disabled={spinning}
                      >
                        <GridIcon slotId={slot.slotId} />
                        {getMultiplier(selectionId) > 0 ? <MultiplierBadge multiplier={getMultiplier(selectionId)} /> : <span className="roulette-badge">Closed</span>}
                        {selectedSelectionId === selectionId && (
                          <SpriteFrame
                            src={`${ASSET_ROOT}/cursor.png`}
                            width={CURSOR_SIZE}
                            height={CURSOR_SIZE}
                            scale={3.2}
                            className="roulette-selection-cursor"
                          />
                        )}
                        {hit && <span className="roulette-hit-token"><BallSprite /></span>}
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>

          <div className="vf-help dim roulette-help">
            Rogue rules: twelve fixed slots, row or column multipliers rise as those lanes fill, exact-square bets always pay 12x until hit, and the board clears after six balls.
          </div>
        </div>
      </div>
    </div>
  );
}
