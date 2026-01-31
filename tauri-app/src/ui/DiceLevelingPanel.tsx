import React, { useState, useCallback, useRef, useEffect } from 'react';

interface DiceLevelingPanelProps {
  pendingLevels: number;
  onPendingLevelsChange: (levels: number) => void;
  levelingMode: boolean;
  onLevelingModeChange: (active: boolean) => void;
  levelingSelectionCount: number;
  onApplySelectedLevels: () => void;
  onClearLevelingSelection: () => void;
}

interface DiceRollResult {
  value: number;
  timestamp: number;
  staminaCost: number;
  levelsGained: number;
  rejected?: boolean;
}

const LS_KEY = 'ttrpg.character';

// Read current SP from character sheet localStorage
function getCharacterSP(): { current: number; max: number } {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (!stored) return { current: 0, max: 5 };
    const ch = JSON.parse(stored);
    const athletics = Number(ch.stats?.athletics || 0);
    const spMax = 5 + athletics;
    const spCurrent = Math.max(0, Math.min(spMax, Number(ch.spCurrent || 0)));
    return { current: spCurrent, max: spMax };
  } catch {
    return { current: 0, max: 5 };
  }
}

// Update SP in character sheet localStorage
function setCharacterSP(newSP: number) {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (!stored) return;
    const ch = JSON.parse(stored);
    const athletics = Number(ch.stats?.athletics || 0);
    const spMax = 5 + athletics;
    ch.spCurrent = Math.max(0, Math.min(spMax, newSP));
    localStorage.setItem(LS_KEY, JSON.stringify(ch));
  } catch {}
}

export function DiceLevelingPanel({ pendingLevels, onPendingLevelsChange, levelingMode, onLevelingModeChange, levelingSelectionCount, onApplySelectedLevels, onClearLevelingSelection }: DiceLevelingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [rollHistory, setRollHistory] = useState<DiceRollResult[]>([]);
  const [isRolling, setIsRolling] = useState(false);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [manualRollInput, setManualRollInput] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState(false);
  const rollAnimationRef = useRef<number | null>(null);
  
  // Read stamina from character sheet
  const [staminaData, setStaminaData] = useState(() => getCharacterSP());
  
  // Poll for stamina changes (in case user edits character sheet)
  useEffect(() => {
    const interval = setInterval(() => {
      setStaminaData(getCharacterSP());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const processRoll = useCallback((rollValue: number) => {
    const currentStamina = getCharacterSP().current;
    const staminaCost = rollValue;
    
    // Check if we have enough stamina - if not, go to 0 and reject
    if (currentStamina - staminaCost < 0) {
      // Set stamina to 0 and reject
      setCharacterSP(0);
      setStaminaData({ ...staminaData, current: 0 });
      
      setRollHistory(prev => [{
        value: rollValue,
        timestamp: Date.now(),
        levelsGained: 0,
        staminaCost: currentStamina, // Only deducts what we had
        rejected: true,
      }, ...prev].slice(0, 20));
      return;
    }
    
    // Deduct stamina
    const newStamina = currentStamina - staminaCost;
    setCharacterSP(newStamina);
    setStaminaData({ ...staminaData, current: newStamina });

    // Each successful roll gives exactly 1 level (not the roll value)
    const levelsGained = 1;
    onPendingLevelsChange(pendingLevels + levelsGained);
    
    // Auto-enable leveling mode when we have pending levels
    if (!levelingMode) {
      onLevelingModeChange(true);
    }
    
    setRollHistory(prev => [{
      value: rollValue,
      timestamp: Date.now(),
      levelsGained,
      staminaCost,
    }, ...prev].slice(0, 20));
  }, [staminaData, pendingLevels, onPendingLevelsChange, levelingMode, onLevelingModeChange]);

  const rollD12 = useCallback(() => {
    if (isRolling || staminaData.current <= 0) return;

    setIsRolling(true);
    
    // Animate the dice roll
    let count = 0;
    const maxIterations = 15;
    const animate = () => {
      setDiceValue(Math.floor(Math.random() * 12) + 1);
      count++;
      if (count < maxIterations) {
        rollAnimationRef.current = window.setTimeout(animate, 50 + count * 10);
      } else {
        // Final roll
        const finalValue = Math.floor(Math.random() * 12) + 1;
        setDiceValue(finalValue);
        setIsRolling(false);
        processRoll(finalValue);
      }
    };
    animate();
  }, [isRolling, staminaData.current, processRoll]);

  const handleManualRoll = useCallback(() => {
    const value = parseInt(manualRollInput, 10);
    if (isNaN(value) || value < 1 || value > 12) return;
    
    setDiceValue(value);
    processRoll(value);
    setManualRollInput('');
  }, [manualRollInput, processRoll]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (rollAnimationRef.current) {
        window.clearTimeout(rollAnimationRef.current);
      }
    };
  }, []);

  if (!expanded) {
    return (
      <section className="panel" style={{ padding: '8px 12px' }}>
        <button 
          onClick={() => setExpanded(true)}
          style={{ 
            background: 'none', 
            border: 'none', 
            color: 'var(--accent)', 
            cursor: 'pointer',
            padding: 0,
            fontSize: '1em',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          🎲 Level Up Dice Roller
          <span className="dim" style={{ fontSize: '0.85em' }}>(click to expand)</span>
          {pendingLevels > 0 && (
            <span style={{ background: '#4a9eff', padding: '2px 8px', borderRadius: 10, fontSize: '0.8em', color: '#fff' }}>
              {pendingLevels} pending
            </span>
          )}
        </button>
      </section>
    );
  }

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>🎲 Level Up Dice Roller</h3>
        <button
          onClick={() => setExpanded(false)}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '1.2em',
          }}
          title="Collapse"
        >
          ▲
        </button>
      </div>

      {/* Pending Levels Display */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        alignItems: 'center', 
        justifyContent: 'center',
        gap: 8,
        padding: 12,
        background: pendingLevels > 0 ? 'rgba(74, 158, 255, 0.15)' : 'rgba(0,0,0,0.2)',
        borderRadius: 8,
        border: pendingLevels > 0 ? '2px solid #4a9eff' : '2px solid transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="dim">Pending Levels:</span>
          <span style={{ 
            fontSize: '2em', 
            fontWeight: 'bold',
            color: pendingLevels > 0 ? '#4a9eff' : '#888',
          }}>
            {pendingLevels}
          </span>
        </div>
        {pendingLevels > 0 && (
          <div style={{ fontSize: '0.85em', color: '#4a9eff', textAlign: 'center' }}>
            Select up to 6 Pokémon in the PC, then apply levels.
          </div>
        )}
        {pendingLevels > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={levelingMode ? 'active' : 'secondary'}
              onClick={() => onLevelingModeChange(!levelingMode)}
              style={{ fontSize: '0.85em' }}
            >
              {levelingMode ? '✓ Leveling Mode ON' : 'Enable Leveling Mode'}
            </button>
            <button
              className="secondary mini"
              onClick={() => onPendingLevelsChange(0)}
              style={{ fontSize: '0.85em' }}
            >
              Clear
            </button>
          </div>
        )}
        {pendingLevels > 0 && levelingMode && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="dim" style={{ fontSize: '0.85em' }}>
              {levelingSelectionCount} selected
            </span>
            <button
              onClick={onApplySelectedLevels}
              disabled={levelingSelectionCount === 0}
              style={{ fontSize: '0.85em' }}
            >
              Apply Levels
            </button>
            <button
              className="secondary mini"
              onClick={onClearLevelingSelection}
              disabled={levelingSelectionCount === 0}
              style={{ fontSize: '0.85em' }}
            >
              Clear Selection
            </button>
            {levelingSelectionCount === 1 && (
              <span className="dim" style={{ fontSize: '0.8em' }}>
                (Double levels for single target)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stamina Display */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        alignItems: 'center', 
        justifyContent: 'center',
        gap: 8,
        padding: 12,
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="dim">Stamina (SP):</span>
          <span style={{ 
            fontSize: '1.8em', 
            fontWeight: 'bold',
            color: staminaData.current <= 0 ? '#f44' : staminaData.current <= 3 ? '#fa4' : '#4f8',
          }}>
            {staminaData.current}
          </span>
          <span className="dim">/ {staminaData.max}</span>
        </div>
        <div style={{ fontSize: '0.8em', opacity: 0.7, textAlign: 'center' }}>
          Uses SP from Character Sheet
        </div>
      </div>

      {/* Dice Display & Roll Button */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        background: 'linear-gradient(135deg, rgba(80,60,120,0.3), rgba(40,80,120,0.3))',
        borderRadius: 12,
      }}>
        {/* D12 Visual */}
        <div style={{
          width: 100,
          height: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isRolling 
            ? 'linear-gradient(135deg, #5a4a8a, #4a6a9a)'
            : 'linear-gradient(135deg, #3a3a5a, #2a4a5a)',
          borderRadius: '50%',
          border: '4px solid #666',
          boxShadow: isRolling 
            ? '0 0 20px rgba(100, 200, 255, 0.5)'
            : '0 4px 8px rgba(0,0,0,0.3)',
          transition: 'all 0.2s ease',
          transform: isRolling ? `rotate(${Math.random() * 30 - 15}deg)` : 'rotate(0deg)',
        }}>
          <span style={{
            fontSize: '2.5em',
            fontWeight: 'bold',
            color: '#fff',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
          }}>
            {diceValue || '?'}
          </span>
        </div>

        <div className="dim" style={{ fontSize: '0.85em', textAlign: 'center' }}>
          D12 • Roll = SP cost & Levels gained
        </div>

        <button
          onClick={rollD12}
          disabled={isRolling || staminaData.current <= 0}
          style={{
            padding: '12px 32px',
            fontSize: '1.1em',
            background: staminaData.current <= 0 
              ? '#555' 
              : 'linear-gradient(135deg, var(--accent), #4a9eff)',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            cursor: staminaData.current <= 0 ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
            boxShadow: staminaData.current > 0 ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
          }}
        >
          {isRolling ? '🎲 Rolling...' : staminaData.current <= 0 ? 'No Stamina!' : '🎲 Roll D12'}
        </button>

        {/* Manual Roll Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button
            className="mini secondary"
            onClick={() => setShowManualInput(v => !v)}
            title="Enter a pre-rolled value"
          >
            {showManualInput ? 'Hide' : 'Manual Roll'}
          </button>
        </div>
        
        {showManualInput && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input
              type="number"
              min={1}
              max={12}
              value={manualRollInput}
              onChange={e => setManualRollInput(e.target.value)}
              placeholder="1-12"
              style={{
                width: 60,
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid #555',
                background: '#222',
                color: '#fff',
                textAlign: 'center',
              }}
              onKeyDown={e => e.key === 'Enter' && handleManualRoll()}
            />
            <button
              onClick={handleManualRoll}
              disabled={
                !manualRollInput ||
                parseInt(manualRollInput, 10) < 1 ||
                parseInt(manualRollInput, 10) > 12 ||
                staminaData.current <= 0
              }
              className="mini"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {/* Roll History */}
      {rollHistory.length > 0 && (
        <div style={{
          maxHeight: 150,
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
          padding: 8,
        }}>
          <div className="dim" style={{ fontSize: '0.85em', marginBottom: 8 }}>Recent Rolls:</div>
          {rollHistory.map((roll, idx) => (
            <div 
              key={roll.timestamp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                fontSize: '0.85em',
                opacity: roll.rejected ? 0.5 : 1 - (idx * 0.03),
                background: roll.rejected ? 'rgba(255,0,0,0.1)' : 'transparent',
                borderRadius: 4,
              }}
            >
              <span style={{ 
                fontWeight: 'bold',
                width: 24,
                textAlign: 'center',
                color: roll.rejected ? '#f44' : roll.value >= 10 ? '#4f8' : roll.value <= 3 ? '#f84' : 'inherit',
              }}>
                {roll.value}
              </span>
              <span className="dim">→</span>
              {roll.rejected ? (
                <span style={{ color: '#f44' }}>REJECTED (SP → 0)</span>
              ) : (
                <span style={{ color: '#4f8' }}>+{roll.levelsGained} pending levels</span>
              )}
              <span className="dim" style={{ marginLeft: 'auto', fontSize: '0.8em' }}>
                -{roll.staminaCost} SP
              </span>
            </div>
          ))}
          <button
            className="secondary mini"
            onClick={() => setRollHistory([])}
            style={{ marginTop: 8 }}
          >
            Clear History
          </button>
        </div>
      )}

      {/* Quick Reference */}
      <div style={{ 
        fontSize: '0.8em', 
        color: '#888',
        padding: 8,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 6,
      }}>
        <strong>TTRPG Leveling Rules:</strong>
        <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
          <li><strong>Roll D12:</strong> Costs SP equal to roll, adds roll value to pending levels</li>
          <li><strong>Apply Levels:</strong> Click Pokémon in PC with Leveling Mode ON</li>
          <li><strong>Rejected:</strong> If roll exceeds SP, stamina goes to 0</li>
          <li><strong>SP:</strong> From Character Sheet (5 + Athletics)</li>
        </ul>
      </div>
    </section>
  );
}
