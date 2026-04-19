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
import { GachaMachine, GachaTierId } from './GachaMachine';
import { Pinball, PinballThemeId } from './Pinball';
import { gamecornerAsset } from './assets';
import './GambleStyles.css';

type Game = 'menu' | 'slots' | 'roulette' | 'voltorb' | 'blackjack' | 'plinko' | 'snake' | 'flappy' | 'stacker' | 'derby' | 'gacha' | 'pinball';

type PlayableGame = Exclude<Game, 'menu'>;

interface GameMeta {
  id: PlayableGame;
  label: string;
  titleArt: string;
  stageArt: string;
  accent: string;
}

interface StationMeta {
  id: string;
  section: string;
  zone: string;
  game: PlayableGame;
  label: string;
  subtitle: string;
  cost: string;
  menuArt: string;
  titleArt: string;
  stageArt: string;
  accent: string;
  pinballTheme?: PinballThemeId;
  gachaTier?: GachaTierId;
}

const GAMES: GameMeta[] = [
  {
    id: 'slots',
    label: 'Slot Machine',
    titleArt: gamecornerAsset('slot_machine/menu.png'),
    stageArt: gamecornerAsset('slot_machine/reel_time_machine.png'),
    accent: '#d79334',
  },
  {
    id: 'roulette',
    label: 'Roulette',
    titleArt: gamecornerAsset('roulette/headers.png'),
    stageArt: gamecornerAsset('roulette/wheel.png'),
    accent: '#db8b43',
  },
  {
    id: 'voltorb',
    label: 'Voltorb Flip',
    titleArt: gamecornerAsset('voltorbflip/coins.png'),
    stageArt: gamecornerAsset('voltorbflip/gameboard.png'),
    accent: '#d7aa5e',
  },
  {
    id: 'blackjack',
    label: 'Blackjack',
    titleArt: gamecornerAsset('blackjack/popup.png'),
    stageArt: gamecornerAsset('blackjack/background_tiles.png'),
    accent: '#6aa26f',
  },
  {
    id: 'plinko',
    label: 'Pachinko',
    titleArt: gamecornerAsset('pachinko/title.png'),
    stageArt: gamecornerAsset('pachinko/bgtiles.png'),
    accent: '#efb453',
  },
  {
    id: 'pinball',
    label: 'Pinball',
    titleArt: gamecornerAsset('pinball/bg_cover_tiles.png'),
    stageArt: gamecornerAsset('pinball/bg_tiles_meowth.png'),
    accent: '#e2b560',
  },
  {
    id: 'snake',
    label: 'Snake',
    titleArt: gamecornerAsset('snake/menu.png'),
    stageArt: gamecornerAsset('snake/snake-bg.png'),
    accent: '#91ba6a',
  },
  {
    id: 'flappy',
    label: 'Flappy Bird',
    titleArt: gamecornerAsset('flappybird/start.png'),
    stageArt: gamecornerAsset('flappybird/flappy-bg.png'),
    accent: '#8bc3ea',
  },
  {
    id: 'stacker',
    label: 'Block Stacker',
    titleArt: gamecornerAsset('block_stacker/title.png'),
    stageArt: gamecornerAsset('block_stacker/blockbgtiles.png'),
    accent: '#c2a06a',
  },
  {
    id: 'derby',
    label: 'Derby',
    titleArt: gamecornerAsset('derby/selection.png'),
    stageArt: gamecornerAsset('derby/race_bg.png'),
    accent: '#d99558',
  },
  {
    id: 'gacha',
    label: 'Gacha Machine',
    titleArt: gamecornerAsset('gacha/menu_1.png'),
    stageArt: gamecornerAsset('gacha/bg_middle.png'),
    accent: '#f0c870',
  },
];

const GAMES_BY_ID: Record<PlayableGame, GameMeta> = GAMES.reduce((acc, game) => {
  acc[game.id] = game;
  return acc;
}, {} as Record<PlayableGame, GameMeta>);

const STATIONS: StationMeta[] = [
  {
    id: 'slots-bank',
    section: 'Main Floor',
    zone: 'Slot Bank',
    game: 'slots',
    label: 'Slot Machine Row',
    subtitle: 'The reel bank from Mauville.',
    cost: 'Variable bet',
    menuArt: gamecornerAsset('slot_machine/menu.png'),
    titleArt: gamecornerAsset('slot_machine/menu.png'),
    stageArt: gamecornerAsset('slot_machine/reel_time_machine.png'),
    accent: '#d79334',
  },
  {
    id: 'roulette-table',
    section: 'Main Floor',
    zone: 'Table Games',
    game: 'roulette',
    label: 'Roulette Table',
    subtitle: 'Pick a square, row, or column.',
    cost: '1 or 3 coins',
    menuArt: gamecornerAsset('roulette/wheel.png'),
    titleArt: gamecornerAsset('roulette/headers.png'),
    stageArt: gamecornerAsset('roulette/wheel.png'),
    accent: '#db8b43',
  },
  {
    id: 'blackjack-dealer',
    section: 'Main Floor',
    zone: 'Dealer Counter',
    game: 'blackjack',
    label: 'Blackjack Dealer',
    subtitle: 'Hit, stand, double, or insure.',
    cost: 'Table bet',
    menuArt: gamecornerAsset('blackjack/popup.png'),
    titleArt: gamecornerAsset('blackjack/popup.png'),
    stageArt: gamecornerAsset('blackjack/background_tiles.png'),
    accent: '#6aa26f',
  },
  {
    id: 'voltorb-station',
    section: 'Arcade Row',
    zone: 'Puzzle Machines',
    game: 'voltorb',
    label: 'Voltorb Flip',
    subtitle: 'Source board with escalating levels.',
    cost: '50 coins',
    menuArt: gamecornerAsset('voltorbflip/gameboard.png'),
    titleArt: gamecornerAsset('voltorbflip/coins.png'),
    stageArt: gamecornerAsset('voltorbflip/gameboard.png'),
    accent: '#d7aa5e',
  },
  {
    id: 'pachinko-station',
    section: 'Arcade Row',
    zone: 'Puzzle Machines',
    game: 'plinko',
    label: 'Pachinko Machine',
    subtitle: 'Drop into the tile-built board.',
    cost: 'Board entry',
    menuArt: gamecornerAsset('pachinko/title.png'),
    titleArt: gamecornerAsset('pachinko/title.png'),
    stageArt: gamecornerAsset('pachinko/bgtiles.png'),
    accent: '#efb453',
  },
  {
    id: 'snake-station',
    section: 'Arcade Row',
    zone: 'Arcade Machines',
    game: 'snake',
    label: 'Snake Cabinet',
    subtitle: 'Onix run from the arcade row.',
    cost: '25 coins',
    menuArt: gamecornerAsset('snake/menu.png'),
    titleArt: gamecornerAsset('snake/menu.png'),
    stageArt: gamecornerAsset('snake/snake-bg.png'),
    accent: '#91ba6a',
  },
  {
    id: 'flappy-station',
    section: 'Arcade Row',
    zone: 'Arcade Machines',
    game: 'flappy',
    label: 'Butterfree Cabinet',
    subtitle: 'Arcade-screen flier from the repo.',
    cost: '25 coins',
    menuArt: gamecornerAsset('flappybird/start.png'),
    titleArt: gamecornerAsset('flappybird/start.png'),
    stageArt: gamecornerAsset('flappybird/flappy-bg.png'),
    accent: '#8bc3ea',
  },
  {
    id: 'stacker-station',
    section: 'Arcade Row',
    zone: 'Arcade Machines',
    game: 'stacker',
    label: 'Block Stacker',
    subtitle: 'Rhydon stacker lane.',
    cost: '25 coins',
    menuArt: gamecornerAsset('block_stacker/title.png'),
    titleArt: gamecornerAsset('block_stacker/title.png'),
    stageArt: gamecornerAsset('block_stacker/blockbgtiles.png'),
    accent: '#c2a06a',
  },
  {
    id: 'derby-station',
    section: 'Arcade Row',
    zone: 'Race Desk',
    game: 'derby',
    label: 'Derby Desk',
    subtitle: 'Bet on the race lineup.',
    cost: 'Race wager',
    menuArt: gamecornerAsset('derby/selection.png'),
    titleArt: gamecornerAsset('derby/selection.png'),
    stageArt: gamecornerAsset('derby/race_bg.png'),
    accent: '#d99558',
  },
  {
    id: 'pinball-meowth',
    section: 'Pinball Line',
    zone: 'Pinball Tables',
    game: 'pinball',
    label: 'Meowth Table',
    subtitle: 'The standard 25-coin table.',
    cost: '25 coins',
    menuArt: gamecornerAsset('pinball/bg_tiles_meowth.png'),
    titleArt: gamecornerAsset('pinball/bg_cover_tiles.png'),
    stageArt: gamecornerAsset('pinball/bg_tiles_meowth.png'),
    accent: '#e2b560',
    pinballTheme: 'meowth',
  },
  {
    id: 'pinball-diglett',
    section: 'Pinball Line',
    zone: 'Pinball Tables',
    game: 'pinball',
    label: 'Diglett Table',
    subtitle: 'The 50-coin diglett board.',
    cost: '50 coins',
    menuArt: gamecornerAsset('pinball/bg_tiles_diglett.png'),
    titleArt: gamecornerAsset('pinball/bg_cover_tiles.png'),
    stageArt: gamecornerAsset('pinball/bg_tiles_diglett.png'),
    accent: '#d0a15c',
    pinballTheme: 'diglett',
  },
  {
    id: 'pinball-seel',
    section: 'Pinball Line',
    zone: 'Pinball Tables',
    game: 'pinball',
    label: 'Seel Table',
    subtitle: 'The ship-theme 25-coin board.',
    cost: '25 coins',
    menuArt: gamecornerAsset('pinball/bg_tiles_seel.png'),
    titleArt: gamecornerAsset('pinball/bg_cover_tiles.png'),
    stageArt: gamecornerAsset('pinball/bg_tiles_seel.png'),
    accent: '#76b1d7',
    pinballTheme: 'seel',
  },
  {
    id: 'pinball-gengar',
    section: 'Pinball Line',
    zone: 'Pinball Tables',
    game: 'pinball',
    label: 'Gengar Table',
    subtitle: 'The 100-coin haunted board.',
    cost: '100 coins',
    menuArt: gamecornerAsset('pinball/bg_tiles_gengar.png'),
    titleArt: gamecornerAsset('pinball/bg_cover_tiles.png'),
    stageArt: gamecornerAsset('pinball/bg_tiles_gengar.png'),
    accent: '#9d72cc',
    pinballTheme: 'gengar',
  },
  {
    id: 'gacha-basic',
    section: 'Prize Corner',
    zone: 'Gacha Counter',
    game: 'gacha',
    label: 'Basic Capsule Machine',
    subtitle: 'Tier 1 capsule draw.',
    cost: '50 coins',
    menuArt: gamecornerAsset('gacha/menu_1.png'),
    titleArt: gamecornerAsset('gacha/menu_1.png'),
    stageArt: gamecornerAsset('gacha/bg_middle.png'),
    accent: '#b9b9b9',
    gachaTier: 'basic',
  },
  {
    id: 'gacha-great',
    section: 'Prize Corner',
    zone: 'Gacha Counter',
    game: 'gacha',
    label: 'Great Capsule Machine',
    subtitle: 'Tier 2 capsule draw.',
    cost: '250 coins',
    menuArt: gamecornerAsset('gacha/menu_2.png'),
    titleArt: gamecornerAsset('gacha/menu_1.png'),
    stageArt: gamecornerAsset('gacha/bg_middle.png'),
    accent: '#4f9ae8',
    gachaTier: 'great',
  },
  {
    id: 'gacha-ultra',
    section: 'Prize Corner',
    zone: 'Gacha Counter',
    game: 'gacha',
    label: 'Ultra Capsule Machine',
    subtitle: 'Tier 3 capsule draw.',
    cost: '1000 coins',
    menuArt: gamecornerAsset('gacha/menu_2.png'),
    titleArt: gamecornerAsset('gacha/menu_1.png'),
    stageArt: gamecornerAsset('gacha/bg_middle.png'),
    accent: '#f0c04f',
    gachaTier: 'ultra',
  },
  {
    id: 'gacha-master',
    section: 'Prize Corner',
    zone: 'Gacha Counter',
    game: 'gacha',
    label: 'Master Capsule Machine',
    subtitle: 'Tier 4 capsule draw.',
    cost: '4500 coins',
    menuArt: gamecornerAsset('gacha/menu_2.png'),
    titleArt: gamecornerAsset('gacha/menu_1.png'),
    stageArt: gamecornerAsset('gacha/bg_middle.png'),
    accent: '#b66bf2',
    gachaTier: 'master',
  },
];

const STATION_SECTIONS = Array.from(new Set(STATIONS.map((station) => station.section)));

const ROOM_STYLE = {
  '--gamble-room-primary': `url("${gamecornerAsset('room/building_tiles.png')}")`,
  '--gamble-room-secondary': `url("${gamecornerAsset('room/mauville_tiles.png')}")`,
} as React.CSSProperties;

function getStageStyle(scene: { stageArt: string; accent: string }): React.CSSProperties {
  return {
    '--gamble-scene-image': `url("${scene.stageArt}")`,
    '--gamble-scene-accent': scene.accent,
  } as React.CSSProperties;
}

export function GambleTab() {
  const { coins, setCoins, addCoins, spendCoins } = useCoins();
  const [game, setGame] = useState<Game>('menu');
  const [activeStation, setActiveStation] = useState<StationMeta | null>(null);
  const [editingCoins, setEditingCoins] = useState(false);
  const [coinInput, setCoinInput] = useState('');
  const coinInputRef = useRef<HTMLInputElement>(null);
  const activeGame = activeStation ?? (game === 'menu' ? null : GAMES_BY_ID[game]);

  const openStation = (station: StationMeta) => {
    setActiveStation(station);
    setGame(station.game);
  };

  const back = () => {
    setGame('menu');
    setActiveStation(null);
  };

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
        return <Pinball coins={coins} addCoins={addCoins} spendCoins={spendCoins} initialThemeId={activeStation?.pinballTheme} />;
      case 'snake':
        return <SnakeGame coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'flappy':
        return <FlappyBird coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'stacker':
        return <BlockStacker coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'derby':
        return <Derby coins={coins} addCoins={addCoins} spendCoins={spendCoins} />;
      case 'gacha':
        return <GachaMachine coins={coins} addCoins={addCoins} spendCoins={spendCoins} initialTierId={activeStation?.gachaTier} />;
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
        <div className="gamble-menu-shell">
          <div className="gamble-menu-content">
            <div className="gamble-menu-header">
              <div className="gamble-menu-copy">
                <p className="gamble-scene-kicker">Mauville Floor</p>
                <h2>Game Corner</h2>
                <p>Walk up to a station. This layout follows the Mauville floor script instead of a flat launcher.</p>
              </div>
              <div className="gamble-room-preview" aria-hidden="true">
                <img src={gamecornerAsset('room/mauville_tiles.png')} alt="" />
              </div>
            </div>
            <div className="gamble-station-sections">
              {STATION_SECTIONS.map((section) => (
                <section key={section} className="gamble-station-section">
                  <div className="gamble-station-section-head">
                    <h3>{section}</h3>
                    <p>{STATIONS.filter((station) => station.section === section)[0]?.zone}</p>
                  </div>
                  <div className="gamble-grid gamble-station-grid">
                    {STATIONS.filter((station) => station.section === section).map((station) => (
                      <button
                        key={station.id}
                        className="gamble-machine-card gamble-station-card"
                        onClick={() => openStation(station)}
                        style={{ '--card-accent': station.accent } as React.CSSProperties}
                      >
                        <span className="gamble-machine-screen">
                          <img src={station.menuArt} alt="" />
                        </span>
                        <span className="gamble-machine-bar">
                          <span className="gamble-machine-label">{station.label}</span>
                          <span className="gamble-machine-cost">{station.cost}</span>
                        </span>
                        <span className="gamble-machine-subtitle">{station.subtitle}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeGame && (
        <div className={`gamble-stage gamble-stage-${game}`} style={getStageStyle(activeGame)}>
          <div className="gamble-stage-chrome">
            <div className="gamble-stage-banner" aria-hidden="true">
              <img src={activeGame.titleArt} alt="" />
            </div>
            <div className="gamble-stage-nameplate">
              <p className="gamble-scene-kicker">Mauville Floor</p>
              <strong>{activeGame.label}</strong>
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
