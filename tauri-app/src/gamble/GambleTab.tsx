import React, { useState } from 'react';
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
import './GambleStyles.css';

type Game = 'menu' | 'slots' | 'voltorb' | 'blackjack' | 'plinko' | 'snake' | 'flappy' | 'stacker' | 'derby' | 'gacha';

const GAMES: { id: Game; label: string; desc: string; icon: string }[] = [
  { id: 'slots',    label: 'Slot Machine',   desc: 'Spin the reels! Match symbols to win.',        icon: '🎰' },
  { id: 'voltorb',  label: 'Voltorb Flip',   desc: 'Flip cards — avoid the Voltorb!',             icon: '⚡' },
  { id: 'blackjack',label: 'Blackjack',       desc: 'Beat the dealer to 21.',                      icon: '🃏' },
  { id: 'plinko',   label: 'Plinko',          desc: 'Drop a ball through pegs for prizes.',         icon: '📍' },
  { id: 'snake',    label: 'Snake',            desc: 'Eat coins, grow longer, don\'t crash.',       icon: '🐍' },
  { id: 'flappy',   label: 'Flappy Bird',     desc: 'Fly through pipes — how far can you go?',     icon: '🐦' },
  { id: 'stacker',  label: 'Block Stacker',   desc: 'Stack blocks to reach the top.',               icon: '🧱' },
  { id: 'derby',    label: 'Derby',            desc: 'Bet on Pokémon in a race!',                   icon: '🏇' },
  { id: 'gacha',    label: 'Gacha Machine',   desc: 'Spend coins for random prizes.',               icon: '🎲' },
];

export function GambleTab() {
  const { coins, setCoins, addCoins, spendCoins } = useCoins();
  const [game, setGame] = useState<Game>('menu');

  const back = () => setGame('menu');

  return (
    <div className="gamble-tab panel">
      {/* Coin bar */}
      <div className="gamble-coin-bar">
        <span className="gamble-coins">🪙 {coins.toLocaleString()} coins</span>
        {game !== 'menu' && <button className="mini" onClick={back}>← Back to Menu</button>}
        <button className="mini" style={{ marginLeft: 'auto' }}
          onClick={() => addCoins(100)}
          title="Add 100 coins (debug)">+ 100</button>
      </div>

      {game === 'menu' && (
        <div className="gamble-menu">
          <h2 style={{ margin: '0 0 12px' }}>Game Corner</h2>
          <div className="gamble-grid">
            {GAMES.map(g => (
              <button key={g.id} className="gamble-card" onClick={() => setGame(g.id)}>
                <span className="gamble-card-icon">{g.icon}</span>
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
      {game === 'snake'     && <SnakeGame coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'flappy'    && <FlappyBird coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'stacker'   && <BlockStacker coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'derby'     && <Derby coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
      {game === 'gacha'     && <GachaMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />}
    </div>
  );
}
