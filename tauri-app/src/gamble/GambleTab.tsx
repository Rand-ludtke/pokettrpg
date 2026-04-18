import React, { useState, useRef, useEffect } from 'react';
import { useCoins } from './useCoins';
import { SlotMachine } from './SlotMachine';
import { Roulette } from './Roulette';
import { VoltorbFlip } from './VoltorbFlip';
import { Blackjack } from './Blackjack';
import { Plinko } from './Plinko';
import { SnakeGame } from './SnakeGame';
import { FlappyBird } from './FlappyBird';
import { BlockStacker } from './BlockStacker';
import { Derby } from './Derby';
import { GachaMachine } from './GachaMachine';
import { Pinball } from './Pinball';
import { gamecornerAsset } from './assets';
import './GambleStyles.css';

type Game = 'menu' | 'slots' | 'roulette' | 'voltorb' | 'blackjack' | 'plinko' | 'snake' | 'flappy' | 'stacker' | 'derby' | 'gacha' | 'pinball';

const GAMES: { id: Game; label: string; desc: string; icon: string }[] = [
  { id: 'slots',    label: 'Slot Machine',   desc: 'Spin the reels! Match symbols to win.',        icon: gamecornerAsset('slot_machine/menu.png') },
  { id: 'roulette', label: 'Roulette',       desc: 'Rogue-style wheel with color and Pokemon bets.', icon: gamecornerAsset('roulette/wheel.png') },
  { id: 'voltorb',  label: 'Voltorb Flip',   desc: 'Flip cards — avoid the Voltorb!',             icon: gamecornerAsset('voltorbflip/gameboard.png') },
  { id: 'blackjack',label: 'Blackjack',       desc: 'Beat the dealer to 21.',                      icon: gamecornerAsset('blackjack/facedown.png') },
  { id: 'plinko',   label: 'Pachinko',        desc: 'Drop balls through pegs for prizes.',          icon: gamecornerAsset('pachinko/title.png') },
  { id: 'pinball',  label: 'Pinball',         desc: 'Play the Emerald-style pinball machines.',     icon: gamecornerAsset('pinball/bg_tiles_meowth.png') },
  { id: 'snake',    label: 'Snake',            desc: 'Eat coins, grow longer, don\'t crash.',       icon: gamecornerAsset('snake/onix-head.png') },
  { id: 'flappy',   label: 'Flappy Bird',     desc: 'Fly through pipes — how far can you go?',     icon: gamecornerAsset('flappybird/arcade-screen.png') },
  { id: 'stacker',  label: 'Block Stacker',   desc: 'Stack blocks to reach the top.',               icon: gamecornerAsset('block_stacker/title.png') },
  { id: 'derby',    label: 'Derby',            desc: 'Bet on Pokemon in a race.',                   icon: gamecornerAsset('derby/selection.png') },
  { id: 'gacha',    label: 'Gacha Machine',   desc: 'Multi-tier prizes from the repo machine UI.',  icon: gamecornerAsset('gacha/menu_1.png') },
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
            {coins.toLocaleString()} coins
          </span>
        )}
        {game !== 'menu' && <button className="mini" onClick={back}>← Back to Menu</button>}
      </div>

      {game === 'menu' && (
        <div className="gamble-menu">
          <h2 style={{ margin: '0 0 12px' }}>Game Corner</h2>
          <div className="gamble-grid">
            {GAMES.map(g => (
              <button key={g.id} className="gamble-card" onClick={() => setGame(g.id)}>
                <span className="gamble-card-icon">
                  <img src={g.icon} alt="" className="gamble-card-icon-img" />
                </span>
                <span className="gamble-card-label">{g.label}</span>
                <span className="gamble-card-desc">{g.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {game === 'slots'     && <SlotMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
  {game === 'roulette'  && <Roulette coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'voltorb'   && <VoltorbFlip coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'blackjack' && <Blackjack coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'plinko'    && <Plinko coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'pinball'   && <Pinball coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'snake'     && <SnakeGame coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'flappy'    && <FlappyBird coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'stacker'   && <BlockStacker coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'derby'     && <Derby coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'gacha'     && <GachaMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
    </div>
  );
}
