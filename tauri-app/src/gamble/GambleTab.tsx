import React, { useState, useRef, useEffect } from 'react';
import { useCoins } from './useCoins';
import { SlotMachine } from './SlotMachine';
import { VoltorbFlip } from './VoltorbFlip';
import { Blackjack } from './Blackjack';
import { Plinko } from './Plinko';
import { SnakeGame } from './SnakeGame';
import { FlappyBird } from './FlappyBird';
import { BlockStacker } from './BlockStacker';
import { Derby } from './Derby';
import { GachaMachine } from './GachaMachine';
import { Pinball } from './Pinball';
import { Roulette } from './Roulette';
import './GambleStyles.css';

type Game = 'menu' | 'slots' | 'voltorb' | 'blackjack' | 'plinko' | 'snake' | 'flappy' | 'stacker' | 'derby' | 'gacha' | 'pinball' | 'roulette';

const GAMES: { id: Game; label: string; desc: string; icon: string }[] = [
  { id: 'slots',    label: 'Slot Machine',   desc: 'Spin the reels! Match symbols to win.',        icon: '/gamecorner/slots/reel_pokeball.png' },
  { id: 'voltorb',  label: 'Voltorb Flip',   desc: 'Flip cards — avoid the Voltorb!',             icon: '/gamecorner/voltorbflip/gameboard.png' },
  { id: 'blackjack',label: 'Blackjack',       desc: 'Beat the dealer to 21.',                      icon: '/gamecorner/blackjack/facedown.png' },
  { id: 'plinko',   label: 'Plinko',          desc: 'Drop a ball through pegs for prizes.',         icon: '/gamecorner/pinball/ball_pokeball.png' },
  { id: 'pinball',  label: 'Pinball',         desc: 'Launch balls through pegs into scoring zones.', icon: '/gamecorner/pinball/flipper.png' },
  { id: 'roulette', label: 'Roulette',        desc: 'Bet on numbers or colors — spin the wheel!',   icon: '/gamecorner/pinball/ball_pokeball.png' },
  { id: 'snake',    label: 'Snake',            desc: 'Eat coins, grow longer, don\'t crash.',       icon: '/gamecorner/snake/onix-head.png' },
  { id: 'flappy',   label: 'Flappy Bird',     desc: 'Fly through pipes — how far can you go?',     icon: '/gamecorner/flappy/butterfree.png' },
  { id: 'stacker',  label: 'Block Stacker',   desc: 'Stack blocks to reach the top.',               icon: '/gamecorner/block_stacker/rhydon.png' },
  { id: 'derby',    label: 'Derby',            desc: 'Bet on Pokémon in a race!',                   icon: '/gamecorner/derby/ponyta_ow.png' },
  { id: 'gacha',    label: 'Gacha Machine',   desc: 'Multi-tier prizes — Basic to Master!',         icon: '/gamecorner/gacha/elekid.png' },
];

export function GambleTab() {
  const { coins, setCoins, addCoins, spendCoins } = useCoins();
  const [game, setGame] = useState<Game>('menu');
  const [editingCoins, setEditingCoins] = useState(false);
  const [coinInput, setCoinInput] = useState('');
  const coinInputRef = useRef<HTMLInputElement>(null);

  const back = () => setGame('menu');

  useEffect(() => {
    if (editingCoins && coinInputRef.current) coinInputRef.current.focus();
  }, [editingCoins]);

  const startEdit = () => {
    setCoinInput(String(coins));
    setEditingCoins(true);
  };

  const commitEdit = () => {
    const val = parseInt(coinInput, 10);
    if (!isNaN(val) && val >= 0) setCoins(val);
    setEditingCoins(false);
  };

  return (
    <div className="gamble-tab panel">
      {/* Coin bar */}
      <div className="gamble-coin-bar">
        {editingCoins ? (
          <input
            ref={coinInputRef}
            className="gamble-coin-edit"
            type="number"
            min={0}
            value={coinInput}
            onChange={e => setCoinInput(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCoins(false); }}
          />
        ) : (
          <span className="gamble-coins" onClick={startEdit} title="Click to edit coins">
            🪙 {coins.toLocaleString()} coins
          </span>
        )}
        {game !== 'menu' && <button className="mini" onClick={back}>← Back to Menu</button>}
      </div>

      {game === 'menu' && (
        <div className="gamble-menu">
          <h2 style={{ margin: '0 0 12px' }}>Gamble???</h2>
          <div className="gamble-grid">
            {GAMES.map(g => (
              <button key={g.id} className="gamble-card" onClick={() => setGame(g.id)}>
                <span className="gamble-card-icon">
                  <img src={g.icon} alt="" style={{ width: 32, height: 32, objectFit: 'cover', objectPosition: 'top', imageRendering: 'pixelated' }} />
                </span>
                <span className="gamble-card-label">{g.label}</span>
                <span className="gamble-card-desc">{g.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {game === 'slots'     && <SlotMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'voltorb'   && <VoltorbFlip coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'blackjack' && <Blackjack coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'plinko'    && <Plinko coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'pinball'   && <Pinball coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'roulette'  && <Roulette coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'snake'     && <SnakeGame coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'flappy'    && <FlappyBird coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'stacker'   && <BlockStacker coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'derby'     && <Derby coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'gacha'     && <GachaMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
    </div>
  );
}
