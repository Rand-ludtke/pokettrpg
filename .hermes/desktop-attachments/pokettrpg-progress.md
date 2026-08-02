# Pokettrpg Project Status & Progress Tracker

Last updated: 2026-08-01 (Session 20260801)

---

## Core Info

- **Repository**: `https://github.com/Rand-ludtke/pokettrpg/`
- **Live PWA URL**: `https://rand-ludtke.github.io/pokettrpg/` (GitHub Pages)
- **Backend Server**: Raspberry Pi at `pokettrpg-app.pokemondnd.xyz` (via Cloudflare Tunnel)
- **Local Path**: `D:\GitHub\pokettrpg/`
- **Current HEAD**: `d3396bc5` — `cleanup: remove obsolete submodule/deleted entries from index`
- **Frontend Version**: 1.5.5

---

## Architecture Overview

Two major folders in the mono-repo:

### pokeamonttrpg-backend/
- Express + pokemon-showdown battle engine on the Pi server
- Handles multiplayer socket.io communication, backend game state
- Deployed to Pi via cloudflare tunnel (no package.json present — deps must be installed separately)

### tauri-app/
- Frontend client built with React/TypeScript/Vite/Tauri
- Contains all UI components: PokedexTab, BattleTab, FusionTab, CustomDexBuilder, PathwaysArena.tsx
- Deployed to GitHub Pages via `.github/workflows/deploy-pwa.yml`

---

## Current Session Work (2026-08-01)

What was accomplished this session:

### 1. Pokeathlon CDN Data Integration ✅
The pokeathlon API is **confirmed working** for data (not sprites):
- `https://play.pokeathlon.com/data/pokedex.js` → returns `exports.BattlePokedex = {...}` with all pokemon data (200 OK, ~1.4MB)
- `https://play.pokeathlon.com/data/abilities.js` → returns abilities map (200 OK, ~146KB)

### 2. Files Created This Session (Untracked — NOT committed/pushed):

#### a) `tauri-app/src/data/soulstones.ts` (4543 bytes — created BEFORE this session)
Soulstone data file with **6 hardcoded base Pokémon**:
| # | Name | Types | Dex Id |
|---|------|-------|--------|
| 1 | Amethystor | Crystal/Light | 801 |
| 2 | Cosmivine | Cosmic/Sound | 802 |
| 3 | Nuclearis | Nuclear/Cosmic | 803 |
| 4 | Stellara | Stellar/Crystal | 804 |
| 5 | Lumineth | Light/Sound | 805 |
| 6 | Sonix | Sound/Nuclear | 806 |

Each has baseStats, full move sets (Crystal Beam, Cosmic Pulse, etc.), and converts to `BattlePokemon[]` via `SOULSTONE_BATTLE_POKEMON`. Also exports types: Crystal, Cosmic, Nuclear, Stellar, Light, Sound.

**IMPORTANT**: These are the ONLY soulstone pokemon with canonical forms — all other 1100+ variants come from pokeathlon fangame source (Orion/Temporal regional forms).

#### b) `tauri-app/src/data/pokeathlon-dex-loader.ts` (12509 bytes — new)
**FULLY CREATED** by orchestrator subagent during this session. Contains:
- `extractBattlePokedex(rawText)` — parses pokeathlon's BattlePokedex object from JS module string using brace-counting
- `loadPokeathlonDex()` → fetches, parses, and categorizes pokeathlon data into soulstone/cap/regional keys
- `injectPokeathlonDex(dex, result)` → injects non-canonical entries (isNonstandard='Custom') into a DexIndex
- `registerPokeathlonSpriteSource(sourceMap, result)` — registers sprite source tags
- `pokeathlonSpriteUrl(type, spriteId, direction?)` → generates CDN sprite URLs:
  - Icons: `https://play.pokeathlon.com/sprites/fangame-sprites/{tag}/iconsprites/{spriteid}.png`
  - Back: `https://play.pokeathlon.com/sprites/fangame-sprites/{tag}/backsprites/{spriteid}.png`

#### c) `tauri-app/src/data/pokeathlonsouls.ts` (8369 bytes — new)
LoadSoulstones function that fetches pokeathlon pokedex.js at runtime, filters by soulstone types + custom species criteria, normalizes to DexSpecies format. Second-pass adds forme variants. Key logic:
- `hasSoulstoneType(types)` checks for Crystal/Cosmic/Nuclear/Stellar/Light/Sound
- `isCustomSpecies(e)` catches high dex (≥2500) non-standard primary types as custom/brand-new

### 3. Adapter.ts Patching (Staged — NOT committed/pushed):
**49 lines added to adapter.ts** via the subagent pass:
- Inline pokeathlon fetching in `loadShowdownDex()` (fetch at boot, parse BattlePokedex object)
- Inject of only non-canonical (`isNonstandard='Custom'`) entries from pokeathlon into merged dex
- Registration of 'pokeathlon' sprite source tag for resolution

### 4. Helper Scripts Created This Session:
- `scripts/parse_pokeathlon.js` (3992 bytes) - helper to parse pokeathlon pokedex data
- `scripts/parse_pokedex.js` (6595 bytes) - generic dex parser

---

## What the Pokeathlon Contains (Verified via API fetch):

The pokedex.js contains ALL soulstone forms embedded. The structure uses:
- `tags: ["Soulstones"]` marker for soulstone pokemon
- `-Orion` or `-Temporal` suffix naming for regional variants  
- All form names: e.g., `castformorion`, `morpekoorion`, `snorlaxtemporal`, `mawileorionmega`

**Sprite URLs pattern**:
- Icons: `https://play.pokeathlon.com/sprites/fangame-sprites/soulstones/iconsprites/{name}.png`
- Back: `https://play.pokeathlon.com/sprites/fangame-sprites/soulstones/backsprites/{name}.png` or `/back/{name}/spriteid.png`

---

## Critical Problem — What's NOT Working Yet:

### ❌ Soulstone Pokemon DO NOT Appear in Pokedex
The soulstone types exist in the type chart, and data loading infrastructure was created — but **nobody actually hooked these into loadShowdownDex()**. The injected pokeathlon entries need to be registered through `gFangameSpriteSource` and resolved via `bestSpriteBaseForId()` for sprites.

### ❌ Sprite Access (403 Forbidden on Pokeathlon CDN)
Direct sprite fetch from pokeathlon returns 403:
- `https://play.pokeathlon.com/sprites/fangame-sprites/soulstones/iconsprites/{name}.png` → 403 Forbidden
The API data endpoints work fine, but sprites are blocked. Workaround options:
1. Hotlink (may break later), 2. Use pokeathlon domain as sprite url fallback in adapter.ts, 3. Find alternative CDN mirror

### ❌ GitHub Pages Build Failures Still Not Fixed
Commits `69296d9a` and `1711e749` both failed to deploy to GitHub Pages (completed in 45s/1m32s but didn't build successfully). Cause was not fully investigated. Likely TS compilation issues from soulstone type chart additions.

---

## RogueMode Game Tab — NOT CREATED YET

A subagent was dispatched to create `src/ui/RogueModeGame.tsx` but it was **interrupted** (background pool at capacity, ran synchronously instead). Key requirements:
- Pokerogue-style dungeon crawl UI
- Load all pokeathlon/Soulstone pokemon via loadShowdownDex
- Random wild encounters per floor with XP/level progression
- 2+ gym leaders per Soulstone type (Crystal/Cosmic/Nuclear/Stellar/Light/Sound)
- Boss fights between floors + final boss

---

## Sprite URL Configuration Required

pokeathlon sprites live at:
```
Icons: https://play.pokeathlon.com/sprites/fangame-sprites/{tag}/iconsprites/{spriteid}.png
Backs: https://play.pokeathlon.com/sprites/fangame-sprites/{tag}/backsprites/{spriteid}.png
```

For soulstone pokemon, tag = `soulstones`. Pokeathlon registers sprites via `gFangameSpriteSource` map — this needs to return 'pokeathlon' for all registered species IDs so bestSpriteBaseForId() resolves them.

---

## Current Working Tree Status

### Modified (not committed):
1. `tauri-app/src/data/adapter.ts` — 49 lines added (pokeathlon inline fetching + injection)

### Untracked (new files, need review):
1. `tauri-app/src/data/soulstones.ts` — base soulstone pokemon data (6 entries)
2. `tauri-app/src/data/pokeathlon-dex-loader.ts` — full pokeathlon CDN loader
3. `tauri-app/src/data/pokeathlonsouls.ts` — runtime soulstone filter function
4. `scripts/parse_pokeathlon.js` — helper script
5. `scripts/parse_pokedex.js` — helper script
6. `.hermes/desktop-attachments/pokettrpg-progress.md` + `pokettrpg-progress-2.md` — progress docs
7. `tmp/cap_raw.json`, `tmp/parse_pokeathlon.js`, `tmp/soulstone_raw.json` — test data
8. `pokemonttrpg-backend/vendor/InfiniteFusionCalculator/` — existing untracked vendor dir

---

## Next Priority Items

### MUST DO FIRST:
1. **Build locally** to verify the adapter.ts patches compile (run `cd tauri-app && npx tsc --noEmit`)
2. **Add pokeathlon sprite URL resolution** — ensure bestSpriteBaseForId() returns URLs for pokeathlon-registered species
3. Fix any TS compilation issues from the adapter.ts changes
4. Test that Soulstone pokemon appear in PokedexTab at runtime
5. Commit all new files + patches, push to GitHub Pages

### After Build Green:
6. Create RogueModeGame.tsx (the interrupted subagent plan)
7. Add gym leaders for each Soulstone type using pokeathlon fangame species
8. Wire the RogueMode tab into the main nav/sidebar
9. Run extended testing on new battle features against live deployment
10. Complete git working tree cleanup (existing items from progress doc)

---

## Known System Constraints (unchanged)

- **Windows 10 host** with Git Bash (MSYS), not CMD or PowerShell
- **Discord thread creation cannot be done via API/tool calls** on most servers
- **Physical alarm/clock device**: Not available — must use reminders/notifications as proxy
- **Cron jobs run in isolated sessions** with no conversation context between ticks

---

## Hyper-Battle Daemon v3 Status (from prior sessions)

- Continuous battle simulator running on the backend Pi server
- **Tested 2,708,000 battles across all type combinations** (verified before this session)
- All 6 custom types verified as working without errors
- State file: `output/daemon-state.json` — is_running: True
- Note: daemon runs independently and should be checked on next backend access

### GitHub PWA Deployment Status

#### Working (✅):
- Commits `a413b05b` through `95abbaa4` — pages URL, normal Socket.IO transport
- `26b020f3` — most recent successful Pages deployment (polling-only fix)
- `d3396bc5` — needs verification (just cleaned the index this session)

#### Non-working (❌):
- `1711e749` (Hyper-Battle Daemon v3 commit) → Deploy FAILED (completed in 45s, didn't build)
- `69296d9a` (PathwaysArena + BattleTooltip commit) → Deploy FAILED (completed in 1m32s, didn't build)

---

## Soulstone Design Rules

**CRITICAL GAME DESIGN RULE**: Soulstone pokemon have NO canon base forms. Only regional variants:
- Orion variants (e.g., `castformorion`, `morpekoorion`) from pokeathlon fangame
- Temporal variants (e.g., `snorlaxtemporal`, `lycanroctemporal`) from pokeathlon fangame  
- Tagged with `tags: ["Soulstones"]` and `eggGroups: ["Soulstones"]`

---

## Quick Reference — Pokeathlon CDN Endpoints

```
Data API (WORKING): https://play.pokeathlon.com/data/pokedex.js
Abilities API (WORKING): https://play.pokeathlon.com/data/abilities.js
Icon Sprites (403 BLOCKED): https://play.pokeathlon.com/sprites/fangame-sprites/{tag}/iconsprites/{spriteid}.png
Back Sprites (403 BLOCKED): https://play.pokeathlon.com/sprites/fangame-sprites/{tag}/backsprites/{spriteid}.png

Sprite URLs to use in adapter.ts:
- pokeathlon icon: https://play.pokeathlon.com/sprites/fangame-sprites/soulstones/iconsprites/{spriteid}
- pokeathlon back: https://play.pokeathlon.com/sprites/fangame-sprites/soulstones/backsprites/{spriteid}
```

---

## Session Artifacts & Notes

**This session also had an orchestrator subagent that ran for ~2 hours** and created the pokeathlon-dex-loader.ts infrastructure. That subagent hit max_iterations on final execute_code calls but successfully:
1. Created pokeathlon-dex-loader.ts with full parsing + filtering logic
2. Patched adapter.ts with inline fetch/injection code
3. Tested pokeathlon CDN connectivity (confirmed data API works)

The **RogueModeGame tab** was interrupted and never created. This remains the highest priority remaining UI task after the pokeathlon integration is verified working.

### Key Decision Points for Next Session:
- Should we commit all new files as one batch, or staged commits?
- Sprite 403 error — try hotlinking via CSS img fallback, or find CDN mirror?
- RogueModeGame design — full dungeon crawler or simplified battle trainer mode?
- How many gym leaders per Soulstone type (user said at least 2)?

---

END OF PROGRESS TRACKER
