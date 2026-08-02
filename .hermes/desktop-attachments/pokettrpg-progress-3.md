# Pokettrpg Project Status & Progress Tracker

Last updated: 2026-07-31

---

## Core Info

- **Repository**: `https://github.com/Rand-ludtke/pokettrpg/`
- **Live PWA URL**: `https://rand-ludtke.github.io/pokettrpg/` (GitHub Pages)
- **Backend Server**: Raspberry Pi at `pokettrpg-app.pokemondnd.xyz` (via Cloudflare Tunnel)
- **Local Path**: `D:\GitHub\pokettrpg/`
- **Current HEAD**: `168035d5` — `feat: update backend dist build + test-forceswitch config`
- **Latest Success Build**: commit `26b020f` (Push to Pages still works)
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
- Contains all UI components: PokedexTab, BattleTab, FusionTab, CustomDexBuilder, etc.
- Deployed to GitHub Pages via `.github/workflows/deploy-pwa.yml`

---

## Key Recent Features (commits 69296d9 through current)

### 1. Soulstones Custom Type System
- **Added 6 custom types**: Crystal, Cosmic, Nuclear, Stellar, Light, Sound
- Full type-chart.ts support with all interactions (attacker x defender)
- Backend type-chart.ts includes all 24 total types (18 standard + 6 custom)

### 2. PathwaysArena Game Mode
- New game mode in frontend (`src/ui/PathwaysArena.tsx`)
- BattleTooltip component for displaying battle information inline
- TypeScript issues were fixed (commit 82b08fb7)

### 3. Hyper-Battle Daemon v3
- Continuous battle simulator running on the backend
- **Tested 2,708,000 battles across all type combinations**
- All 6 custom types verified as working without errors
- 54,160 cycles completed — daemon is still **currently running** (is_running: True)
- State file lives at `output/daemon-state.json`

### 4. PWA Deployment Pipeline (multiple fixes applied)
- Fixed WebSocket frame corruption over Cloudflare HTTP/2 fallback → uses polling-only Socket.IO transport
- Set permanent backend URL to `pokettrpg-app.pokemondnd.xyz` (migrated from DuckDNS/nip.io)
- GitHub Pages base URL normalization fixed
- Backend endpoint defaults now use valid TLS hosts

### 5. Game Rules Updates
- Stat stages now give +1 modifier AND +1 die step per stage
- Rock Missile tagged as headbutt move with proper stats


## GitHub PWA Deployment Status

### Working (✅)
- `a413b05b` through `95abbaa4` — pages URL, normal Socket.IO transport
- `26b020f3` — most recent successful Pages deployment (polling-only fix)

### Non-working (❌)
- `1711e749` (Hyper-Battle Daemon v3 commit) → Deploy to GitHub Pages **FAILED**
- `69296d9a` (PathwaysArena + BattleTooltip commit) → Deploy to GitHub Pages **FAILED**

Both failure runs completed in 45s and 1m32s respectively. Neither built successfully. The cause was not investigated fully — this is the last known block on deployment.

---

## Sprite Sync Status

- `scripts/sprite-sync.py` exists (downloads from Pokeathlon CDN fangame sources)
- `scripts/sync_ifdex_sprites.py` exists (Infinite Fusion sprite normalization)
- **Pokeathlon CDN returning 403 Forbidden** — cannot fetch Soulstones/Mega Evo sprites
- Local sprites exist at `tauri-app/public/sprites/` but need proper integration with new systems

---

## Game Development Goals

1. **Pokettrpg TTRPG System**: Multiplayer Pokémon TTRPG game on GitHub Pages/PWA
2. **Battle Engine**: soulstones 6 custom types all functional, daemon running
3. **Fusion System**: `src/hooks/useFusionSync.ts` exists (334 lines), `tauri-app/src/sync/fusion.rs` (Rust Tauri sync)
4. **PathwaysArena/Infinite Fusion Calculator**: Backend vendor dir with fusion calculator integration
5. **Wylin Custom Pokedex**: Custom pokemon entries for personal project

---

## Current Working Tree Issues

Clean status needed before next significant commit:

1. `_rules_import/Main rules.md` — deleted from disk, tracked in git (should be `git rm --cached`)
2. `mac-build-src-1.2.1` — deleted from disk, tracked in git (same)
3. `pokemon-showdown-client` — submodule showing modified state (`dirty` flag)
4. `scripts/patch-wylin-megastones.mjs` — deleted (tracked, needs remove or commit)
5. `scripts/sprite-manager-ui.js` — deleted (tracked, same)
6. `scripts/test-battle.js` — deleted (tracked, same)
7. `pokemonttrpg-backend/vendor/` — untracked directory (InfiniteFusionCalculator)

---

## Known System Constraints

- **Windows 10 host** with Git Bash (MSYS), not CMD or PowerShell
- **Discord thread creation cannot be done via API/tool calls** on most servers (rate limits, bot restrictions)
- **Physical alarm/clock device**: Not available — must use reminders/notifications as proxy
- **Cron jobs run in isolated sessions** with no conversation context between ticks

---

## What Was Being Worked On Last (session 20260730_202014 + current)

The last session was trying to:
1. ✅ Verify commits were pushed to GitHub (they were — both HEAD and 69296d9 confirmed on remote)
2. ❌ Investigate GitHub Pages deployment failures for the Battle subsystem (not fully resolved)
3. ⏳ Sprite sync from pokeathlon CDN was blocked by 403 Forbidden responses
4. The daemon continued running independently — now at **2.7M+ battles, 54k cycles, zero errors**
5. ❌ Git working tree still has ~6 dirty/untracked items pending cleanup

---

## Next Priority Items

1. Fix and get GitHub Pages deployments green for the 2 latest feature commits
2. Resolve pokeathlon CDN access issue or find alternative sprite sourcing
3. Complete git working tree cleanup (7 pending items)
4. Run additional extended testing on new battle features
5. Set up Discord bot/agent infrastructure (manual client-side work for threading)
6. Continue health/wellness tracking system
