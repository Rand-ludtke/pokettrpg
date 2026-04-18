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

type PlayableGame = Exclude<Game, 'menu'>;

interface GameMeta {
  id: PlayableGame;
  label: string;
  desc: string;
  icon: string;
  banner: string;
  scene: string;
  decorLeft: string;
  decorRight: string;
  accent: string;
}

const GAMES: GameMeta[] = [
  {
    id: 'slots',
    label: 'Slot Machine',
    desc: 'Spin the reels on a cabinet styled around the original machine art and payoff table.',
    icon: gamecornerAsset('slot_machine/menu.png'),
    banner: gamecornerAsset('slot_machine/menu.png'),
    scene: gamecornerAsset('slot_machine/reel_time_machine.png'),
    decorLeft: gamecornerAsset('slot_machine/digital_display.png'),
    decorRight: gamecornerAsset('slot_machine/reel_time_pikachu.png'),
    accent: '#d79334',
  },
  {
    id: 'roulette',
    label: 'Roulette',
    desc: 'A Rogue-style wheel and betting table framed like the original Game Corner roulette layout.',
    icon: gamecornerAsset('roulette/wheel.png'),
    banner: gamecornerAsset('roulette/wheel.png'),
    scene: gamecornerAsset('roulette/wheel.png'),
    decorLeft: gamecornerAsset('roulette/credit.png'),
    decorRight: gamecornerAsset('roulette/ball_counter.png'),
    accent: '#db8b43',
  },
  {
    id: 'voltorb',
    label: 'Voltorb Flip',
    desc: 'Flip cards against the original board art instead of a blank panel.',
    icon: gamecornerAsset('voltorbflip/gameboard.png'),
    banner: gamecornerAsset('voltorbflip/gameboard.png'),
    scene: gamecornerAsset('voltorbflip/gameboard.png'),
    decorLeft: gamecornerAsset('voltorbflip/coins.png'),
    decorRight: gamecornerAsset('voltorbflip/sprites.png'),
    accent: '#d7aa5e',
  },
  {
    id: 'blackjack',
    label: 'Blackjack',
    desc: 'Card play now sits on a darker felt-and-tile stage using the repo blackjack assets.',
    icon: gamecornerAsset('blackjack/facedown.png'),
    banner: gamecornerAsset('blackjack/background_tiles.png'),
    scene: gamecornerAsset('blackjack/background_tiles.png'),
    decorLeft: gamecornerAsset('blackjack/popup.png'),
    decorRight: gamecornerAsset('blackjack/option_1.png'),
    accent: '#6aa26f',
  },
  {
    id: 'plinko',
    label: 'Pachinko',
    desc: 'The peg board is staged with the original pachinko signage and board texture.',
    icon: gamecornerAsset('pachinko/title.png'),
    banner: gamecornerAsset('pachinko/title.png'),
    scene: gamecornerAsset('pachinko/bgtiles.png'),
    decorLeft: gamecornerAsset('pachinko/multiplier.png'),
    decorRight: gamecornerAsset('pachinko/arrow.png'),
    accent: '#efb453',
  },
  {
    id: 'pinball',
    label: 'Pinball',
    desc: 'Emerald-style pinball machines deserve their own cabinet floor art, not a plain wrapper.',
    icon: gamecornerAsset('pinball/bg_tiles_meowth.png'),
    banner: gamecornerAsset('pinball/bg_tiles_meowth.png'),
    scene: gamecornerAsset('pinball/bg_tiles_meowth.png'),
    decorLeft: gamecornerAsset('pinball/bg_tiles_gengar.png'),
    decorRight: gamecornerAsset('pinball/bg_tiles_seel.png'),
    accent: '#e2b560',
  },
  {
    id: 'snake',
    label: 'Snake',
    desc: 'The arcade shell now uses the actual snake board art and start screen as room decor.',
    icon: gamecornerAsset('snake/onix-head.png'),
    banner: gamecornerAsset('snake/start.png'),
    scene: gamecornerAsset('snake/snake-bg.png'),
    decorLeft: gamecornerAsset('snake/menu.png'),
    decorRight: gamecornerAsset('snake/gameover.png'),
    accent: '#91ba6a',
  },
  {
    id: 'flappy',
    label: 'Flappy Bird',
    desc: 'The cabinet shell now pulls from the repo arcade screen and parallax background art.',
    icon: gamecornerAsset('flappybird/arcade-screen.png'),
    banner: gamecornerAsset('flappybird/arcade-screen.png'),
    scene: gamecornerAsset('flappybird/flappy-bg.png'),
    decorLeft: gamecornerAsset('flappybird/start.png'),
    decorRight: gamecornerAsset('flappybird/flappy-fg.png'),
    accent: '#8bc3ea',
  },
  {
    id: 'stacker',
    label: 'Block Stacker',
    desc: 'Rhydon and the original tile art now anchor the stacker cabinet instead of a pale panel.',
    icon: gamecornerAsset('block_stacker/title.png'),
    banner: gamecornerAsset('block_stacker/title.png'),
    scene: gamecornerAsset('block_stacker/blockbgtiles.png'),
    decorLeft: gamecornerAsset('block_stacker/rhydon.png'),
    decorRight: gamecornerAsset('block_stacker/commands.png'),
    accent: '#c2a06a',
  },
  {
    id: 'derby',
    label: 'Derby',
    desc: 'The race and betting slip art finally frame the derby like a proper corner attraction.',
    icon: gamecornerAsset('derby/selection.png'),
    banner: gamecornerAsset('derby/selection.png'),
    scene: gamecornerAsset('derby/race_bg.png'),
    decorLeft: gamecornerAsset('derby/betslip_bg.png'),
    decorRight: gamecornerAsset('derby/payout.png'),
    accent: '#d99558',
  },
  {
    id: 'gacha',
    label: 'Gacha Machine',
    desc: 'The machine shell now uses the actual gacha cabinet pieces and digital panels from the repo.',
    icon: gamecornerAsset('gacha/menu_1.png'),
    banner: gamecornerAsset('gacha/menu_1.png'),
    scene: gamecornerAsset('gacha/bg_middle.png'),
    decorLeft: gamecornerAsset('gacha/bg_left.png'),
    decorRight: gamecornerAsset('gacha/bg_right.png'),
    accent: '#f0c870',
  },
];

const GAMES_BY_ID: Record<PlayableGame, GameMeta> = GAMES.reduce((acc, game) => {
  acc[game.id] = game;
  return acc;
}, {} as Record<PlayableGame, GameMeta>);

const ROOM_STYLE = {
  '--gamble-room-primary': `url("${gamecornerAsset('room/building_tiles.png')}")`,
  '--gamble-room-secondary': `url("${gamecornerAsset('room/mauville_tiles.png')}")`,
} as React.CSSProperties;

const MENU_SCENE = {
  banner: gamecornerAsset('slot_machine/menu.png'),
  scene: gamecornerAsset('room/mauville_tiles.png'),
  decorLeft: gamecornerAsset('roulette/wheel.png'),
  decorRight: gamecornerAsset('slot_machine/reel_time_machine.png'),
  accent: '#d79334',
};

function getSceneStyle(scene: { scene: string; accent: string }): React.CSSProperties {
  return {
    '--gamble-scene-image': `url("${scene.scene}")`,
    '--gamble-scene-accent': scene.accent,
  } as React.CSSProperties;
}

export function GambleTab() {
  const { coins, setCoins, addCoins, spendCoins } = useCoins();
  const [game, setGame] = useState<Game>('menu');
  const [editingCoins, setEditingCoins] = useState(false);
  const [coinInput, setCoinInput] = useState('');
  const coinInputRef = useRef<HTMLInputElement>(null);
  const activeGame = game === 'menu' ? null : GAMES_BY_ID[game];

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

  const renderGame = () => {
    switch (game) {
      case 'slots':
        return <SlotMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'roulette':
        return <Roulette coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'voltorb':
        return <VoltorbFlip coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'blackjack':
        return <Blackjack coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'plinko':
        return <Plinko coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'pinball':
        return <Pinball coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'snake':
        return <SnakeGame coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'flappy':
        return <FlappyBird coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'stacker':
        return <BlockStacker coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'derby':
        return <Derby coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'gacha':
        return <GachaMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      default:
        return null;
    }
  };

  return (
    <div className="gamble-tab panel" style={ROOM_STYLE}>
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
        <div className="gamble-scene gamble-menu" style={getSceneStyle(MENU_SCENE)}>
          <div className="gamble-scene-decor gamble-scene-decor-left" aria-hidden="true">
            <img src={MENU_SCENE.decorLeft} alt="" />
          </div>
          <div className="gamble-scene-decor gamble-scene-decor-right" aria-hidden="true">
            <img src={MENU_SCENE.decorRight} alt="" />
          </div>
          <div className="gamble-scene-header">
            <div className="gamble-scene-marquee" aria-hidden="true">
              <img src={MENU_SCENE.banner} alt="" />
            </div>
            <div className="gamble-scene-copy">
              <p className="gamble-scene-kicker">Mauville Floor</p>
              <h2>Game Corner</h2>
              <p>Built around the original repo&apos;s machine art and Mauville Game Corner tiles so the whole tab reads like one room instead of disconnected widgets.</p>
            </div>
          </div>
          <div className="gamble-grid">
            {GAMES.map(g => (
              <button
                key={g.id}
                className="gamble-card"
                onClick={() => setGame(g.id)}
                style={{
                  '--card-accent': g.accent,
                  '--card-scene-image': `url("${g.scene}")`,
                } as React.CSSProperties}
              >
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

      {activeGame && (
        <div className={`gamble-stage gamble-stage-${game}`} style={getSceneStyle(activeGame)}>
          <div className="gamble-scene-decor gamble-scene-decor-left" aria-hidden="true">
            <img src={activeGame.decorLeft} alt="" />
          </div>
          <div className="gamble-scene-decor gamble-scene-decor-right" aria-hidden="true">
            <img src={activeGame.decorRight} alt="" />
          </div>
          <div className="gamble-scene-header gamble-stage-header">
            <div className="gamble-scene-marquee gamble-stage-marquee" aria-hidden="true">
              <img src={activeGame.banner} alt="" />
            </div>
            <div className="gamble-scene-copy">
              <p className="gamble-scene-kicker">{activeGame.label}</p>
              <p>{activeGame.desc}</p>
            </div>
          </div>
          <div className="gamble-stage-body">
            {renderGame()}
          </div>
        </div>
      )}
    </div>
  );
}
