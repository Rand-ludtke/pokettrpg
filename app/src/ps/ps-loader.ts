/**
 * Pokemon Showdown Client Loader
 * 
 * This module loads the Pokemon Showdown battle engine and UI components
 * as global scripts, setting up all required dependencies.
 * 
 * The PS client expects certain globals like jQuery, Dex, PS, etc.
 * Script order is critical - must match PS's own loading order.
 */

declare global {
  interface Window {
    $: any;
    jQuery: any;
    Dex: any;
    BattleLog: any;
    Battle: any;
    Pokemon: any;
    Side: any;
    BattleScene: any;
    BattleSceneStub: any;
    BattleTooltips: any;
    BattleChoiceBuilder: any;
    BattleTextParser: any;
    BattleStatusAnims: any;
    BattleMoveAnims: any;
    BattleOtherAnims: any;
    BattleSound: any;
    BattleEffects: any;  // FX effect definitions
    Teams: any;
    toID: (text: any) => string;
    toUserid: (name: string) => string;
    Config: any;
    PS: any;
    PSPrefs: any;
    PSRouter: any;
    preact: any;
    psLoaded: boolean;
    psLoadPromise: Promise<void> | null;
    // Data globals
    BattlePokedex: any;
    BattlePokemonSprites: any;  // Sprite dimension data from pokedex-mini.js
    BattleMovedex: any;
    BattleAbilities: any;
    BattleItems: any;
    BattleTypeChart: any;
    BattleNatures: any;
    BattleFormats: any;
    BattleLearnsets: any;
    BattleAliases: any;
    BattleTeambuilderTable: any;
  }
}

import { withPublicBase } from '../utils/publicBase';

// Base URL for PS assets
const PS_BASE = withPublicBase('vendor/showdown').replace(/\/$/, '');

// List of scripts to load in order (matches PS's index.template.html)
const PS_SCRIPTS = [
  // jQuery first
  `${PS_BASE}/js/jquery-1.9.1.min.js`,
  
  // Core PS setup
  `${PS_BASE}/js/lib/ps-polyfill.js`,
  
  // Battle data (Dex, toID, Pokemon data)
  `${PS_BASE}/js/battledata.js`,
  
  // Battle text parser
  `${PS_BASE}/js/battle-text-parser.js`,
  
  // Battle log
  `${PS_BASE}/js/battle-log.js`,
  
  // Battle scene stub (minimal scene for non-animated mode)
  `${PS_BASE}/js/battle-scene-stub.js`,
  
  // Sound (needs PS.prefs)
  `${PS_BASE}/js/battle-sound.js`,
  
  // Battle core (Pokemon, Side, Battle classes)
  `${PS_BASE}/js/battle.js`,
  
  // Animations (needs Battle)
  `${PS_BASE}/js/battle-animations.js`,
  
  // Move animations
  `${PS_BASE}/js/battle-animations-moves.js`,
  
  // Choices (BattleChoiceBuilder)
  `${PS_BASE}/js/battle-choices.js`,
  
  // Tooltips
  `${PS_BASE}/js/battle-tooltips.js`,
  
  // Teams
  `${PS_BASE}/js/battle-teams.js`,
];

// Data scripts to load (CommonJS format - must be loaded and converted)
// These files use `exports.X = ...` format and need special handling
const PS_DATA_SCRIPTS: { url: string; globalName: string; exportName: string }[] = [
  { url: `${PS_BASE}/data/pokedex.js`, globalName: 'BattlePokedex', exportName: 'BattlePokedex' },
  { url: `${PS_BASE}/data/pokedex-mini.js`, globalName: 'BattlePokemonSprites', exportName: 'BattlePokemonSprites' },
  { url: `${PS_BASE}/data/moves.js`, globalName: 'BattleMovedex', exportName: 'BattleMovedex' },
];

// CSS files to load
const PS_STYLES = [
  // Core PS layout styles (required for ps-room/battle-log/controls UI)
  `${PS_BASE}/style/client.css`,
  `${PS_BASE}/style/font-awesome.css`,
  `${PS_BASE}/style/battle.css`,
  `${PS_BASE}/style/battle-log.css`,
  `${PS_BASE}/style/utilichart.css`,
  `${PS_BASE}/style/sim-types.css`,
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = src;
    script.async = false; // Maintain order
    script.onload = () => resolve();
    script.onerror = (err) => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadStyle(href: string): Promise<void> {
  return new Promise((resolve) => {
    // Check if already loaded
    const existing = document.querySelector(`link[href="${href}"]`);
    if (existing) {
      resolve();
      return;
    }
    
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // Don't fail on CSS errors
    document.head.appendChild(link);
  });
}

/**
 * Load a CommonJS data file and assign exports to window globals
 * PS data files use `exports.X = {...}` format which doesn't work in browser
 */
async function loadCommonJSDataFile(config: { url: string; globalName: string; exportName: string }): Promise<void> {
  const { url, globalName, exportName } = config;
  
  // Fetch the file content
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const code = await response.text();
  
  // Create a fake exports object and execute the code
  const exports: Record<string, any> = {};
  const module = { exports };
  
  // Wrap code in a function that provides exports and module
  // This mimics how CommonJS modules work
  try {
    const fn = new Function('exports', 'module', code) as (exports: Record<string, any>, module: { exports: Record<string, any> }) => void;
    fn(exports, module);
    
    // Get the exported value (either from exports.X or module.exports)
    const exportedValue = exports[exportName] || module.exports[exportName] || module.exports;
    
    // Assign to window global
    (window as any)[globalName] = exportedValue;
    console.log(`[PS Loader] Loaded ${globalName} from ${url} (${Object.keys(exportedValue || {}).length} entries)`);
  } catch (err) {
    console.error(`[PS Loader] Error loading CommonJS file ${url}:`, err);
    throw err;
  }
}

function setupPSGlobals(): void {
  // Determine the base URL for PS assets
  // In dev it's served from the same origin, in prod from /vendor/showdown/
  const psBase = '/vendor/showdown';
  
  // Set up PS Config before loading scripts
  window.Config = window.Config || {
    server: {
      id: 'showdown' as any,
      host: 'sim3.psim.us',
      port: 443,
      httpport: 8000,
      altport: 80,
      registered: true,
      prefix: '',
      protocol: 'wss',
    },
    defaultserver: {
      id: 'showdown' as any,
      host: 'sim3.psim.us',
      port: 443,
      httpport: 8000,
      altport: 80,
      registered: true,
      prefix: '',
      protocol: 'wss',
    },
    routes: {
      root: '/',
      // This is the key setting - it's used to build resourcePrefix
      client: window.location.host + psBase,
      dex: 'https://dex.pokemonshowdown.com/',
      replays: 'https://replay.pokemonshowdown.com/',
      users: 'https://pokemonshowdown.com/users/',
      teams: '',
    },
    customcolors: {},
  };
  
  // Create minimal PS global for battle engine
  window.PS = window.PS || {
    startTime: Date.now(),
    rooms: {},
    isOffline: true,
    server: window.Config.server,
    prefs: {
      bwgfx: false,
      noanim: false,
      nogif: false,
      mute: false,
      musicvolume: 50,
      effectvolume: 50,
      notifvolume: 50,
      // Methods needed by battle-sound.js
      subscribeAndRun: (cb: () => void) => { try { cb(); } catch(e) {} },
    },
    user: {
      get: () => ({ userid: '', named: false }),
    },
    send: () => {},
    receive: () => {},
    alert: (msg: string) => console.warn('[PS Alert]', msg),
    confirm: () => Promise.resolve(false),
    leftRoomWidth: 0,
    isVisible: true,
    focusRoom: () => {},
    update: () => {},
  };
}

/**
 * Load all PS scripts and styles
 */
export async function loadPokemonShowdown(): Promise<void> {
  // Return existing promise if already loading
  if (window.psLoadPromise) {
    return window.psLoadPromise;
  }
  
  // Return immediately if already loaded
  if (window.psLoaded) {
    return Promise.resolve();
  }
  
  window.psLoadPromise = (async () => {
    console.log('[PS Loader] Starting Pokemon Showdown client load...');
    
    // Set up globals first
    setupPSGlobals();
    
    // Load styles in parallel
    await Promise.all(PS_STYLES.map(loadStyle));
    console.log('[PS Loader] Styles loaded');
    
    // Load scripts sequentially (order matters!)
    for (const script of PS_SCRIPTS) {
      try {
        await loadScript(script);
        console.log('[PS Loader] Loaded:', script.split('/').pop());
      } catch (err) {
        console.error('[PS Loader] Failed to load script:', script, err);
        throw err;
      }
    }
    
    console.log('[PS Loader] Scripts loaded');
    
    // Load CommonJS data files (pokedex.js, pokedex-mini.js)
    // These must be loaded AFTER battledata.js which defines the Dex structure
    // but which only creates empty BattlePokedex if it doesn't exist
    console.log('[PS Loader] Loading data files...');
    for (const dataConfig of PS_DATA_SCRIPTS) {
      try {
        await loadCommonJSDataFile(dataConfig);
      } catch (err) {
        console.error('[PS Loader] Failed to load data file:', dataConfig.url, err);
        // Don't throw - data files are important but not critical for basic functionality
      }
    }
    console.log('[PS Loader] Data files loaded');
    
    // Verify critical globals exist
    const missing: string[] = [];
    if (typeof window.Battle !== 'function') missing.push('Battle');
    if (typeof window.toID !== 'function') missing.push('toID');
    if (!window.Dex) missing.push('Dex');
    
    if (missing.length) {
      console.warn('[PS Loader] Missing globals:', missing.join(', '));
      // Try to get Battle from global scope differently
      if (typeof (window as any).Battle === 'undefined') {
        console.error('[PS Loader] Battle class not available - check script loading');
      }
    }
    
    // CRITICAL: Fix resource paths after scripts load
    // The scripts compute these at load time with possibly wrong Config
    if (window.Dex) {
      window.Dex.resourcePrefix = `${PS_BASE}/`;
      window.Dex.fxPrefix = withPublicBase('fx/');
      console.log('[PS Loader] Fixed Dex paths:', {
        resourcePrefix: window.Dex.resourcePrefix,
        fxPrefix: window.Dex.fxPrefix,
      });
      
      // Re-apply fxPrefix to BattleEffects (the IIFE may have run with wrong prefix)
      if (window.BattleEffects) {
        for (const id in window.BattleEffects) {
          const effect = window.BattleEffects[id];
          if (effect.url && !effect.url.startsWith('/') && !effect.url.startsWith('http')) {
            // URL is relative, prepend the fx prefix
            effect.url = `${withPublicBase('fx/')}` + effect.url;
          }
        }
        console.log('[PS Loader] Fixed BattleEffects URLs');
      }
    }
    
    // Note: Data files are now loaded via loadCommonJSDataFile above
    // BattlePokedex contains full species data including forme info for correct sprite IDs
    // BattlePokemonSprites contains sprite dimension data
    console.log('[PS Loader] Sprite data ready:', {
      BattlePokedex: window.BattlePokedex ? Object.keys(window.BattlePokedex).length + ' species' : 'not loaded',
      BattlePokemonSprites: window.BattlePokemonSprites ? Object.keys(window.BattlePokemonSprites).length + ' sprites' : 'not loaded',
    });
    
    window.psLoaded = true;
    console.log('[PS Loader] Pokemon Showdown client fully loaded');
    console.log('[PS Loader] Available:', {
      Battle: typeof window.Battle,
      Dex: typeof window.Dex,
      BattleTooltips: typeof window.BattleTooltips,
      BattleScene: typeof window.BattleScene,
      toID: typeof window.toID,
      BattlePokedex: typeof window.BattlePokedex,
    });
  })();
  
  return window.psLoadPromise;
}

/**
 * Create a new PS Battle instance
 */
export function createPSBattle(options: {
  $frame: HTMLElement;
  $logFrame: HTMLElement;  // Required - Battle needs both or neither
  id?: string;
}): any {
  if (!window.psLoaded) {
    throw new Error('PS not loaded - call loadPokemonShowdown() first');
  }
  
  const { $frame, $logFrame, id = 'battle-1' } = options;
  
  if (!$frame || !$logFrame) {
    throw new Error('Both $frame and $logFrame are required for BattleScene');
  }
  
  // Create jQuery wrapper - jQuery must be loaded
  if (!window.$) {
    throw new Error('jQuery not loaded');
  }
  
  const $frameJQ = window.$($frame);
  const $logJQ = window.$($logFrame);
  
  console.log('[PS Loader] Creating Battle with frame:', $frame, 'and log:', $logFrame);
  
  // Create battle instance
  const battle = new window.Battle({
    $frame: $frameJQ,
    $logFrame: $logJQ,
    id: id,
  });
  
  console.log('[PS Loader] Battle instance created:', battle);
  
  return battle;
}

/**
 * Get the Dex instance for looking up Pokemon data
 */
export function getDex(): any {
  return window.Dex;
}

/**
 * Get the BattleTooltips class
 */
export function getBattleTooltips(): any {
  return window.BattleTooltips;
}

export function toID(text: any): string {
  if (window.toID) return window.toID(text);
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}
