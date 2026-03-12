# Changelog

All notable changes to this project will be documented in this file.

## [1.4.8] - 2026-03-13

### Features
- Enhanced move selector UI in PC: single-click opens detailed move browser with type, power, accuracy, PP, priority, contact, secondary effects, and description; searchable learnable move list shows learn method (Lv, TM, Tutor, Egg, etc.).
- PC sprite selection now propagates into battles via Dex.getSpriteData monkey-patch.

### Bug Fixes
- Fixed level-up move prompt appearing for the wrong Pokémon when switching in PC (race condition between async selected-reset and sync level-detection effects).
- Fixed fusion generation endpoint returning unavailable in remote-proxy mode; added 30 s retry when previously unavailable.
- Fixed Sage evolution data: corrected 24 doubled third-stage entries, removed 8 redundant evoConditions on levelMove evolutions.
- Added cross-stage deduplication safety net in Pokédex evolution chain renderer.

## [1.4.0] - 2026-03-08

### Performance
- Switched Socket.IO to websocket-only transport (removed polling fallback).
- Wrapped 116 console.log calls in PSBattlePanel behind a `PS_DEBUG` flag — eliminates object allocation and string formatting overhead during live battles.
- Disabled DIAG-PROTOCOL event log accumulation when `PS_DEBUG` is off.

### Bug Fixes
- Fixed circular JSON crash in BugReporter console capture with `safeSerialize()` (handles circular refs, Error objects, and unserializable values).

### Evolution System
- Evolution buttons now show colored status indicators: green (ready), gray (level/condition not met), red (missing item).
- Evolution item checks now read from Character Sheet inventory instead of held item.
- Evolving with an item consumes it from inventory and dispatches a storage event for cross-component sync.

### Pokedex
- Improved evolution condition text clarity (e.g. "Use {item}", "Level up while holding {item}", "Trade while using {item}").

## [1.2.5] - 2025-11-10

### UI/UX
- Character Sheet switched to light seafoam theme; removed dark backgrounds.
- Tightened stat grid spacing; more compact layout overall.
- Inventory tabs replaced with icons; consolidated Items section.
- Added Starter Pokémon panel below Traits with sprite preview.
- PC panel restyled: seafoam sprite area, lighter shiny star, compact flex layout.
- ZoomableSprite now zoom-only with +/- controls; zoom level persists; wheel listener is passive.
- Fixed Modifiers column overlap in PC stats.

### Mechanics
- De-mega toggle now only applies for stone-based Mega forms (corrected logic).

### Badge Case
- Rebuilt with equal lid/base sizing.
- Larger pinned badges layered above the rings to reduce blank space.
- State persists across sessions.

### Polish
- Updated brand string in app shell to “v1.2.5”.
- Minor spacing and style harmonization across panels.

### Build/Repo
- Cleaned repository history to remove large binaries (node_modules and release artifacts) from tracking.
- Added ignores to prevent accidental inclusion of build and release outputs.

### Notes
- No breaking changes expected.
- If you see stale styling, clear cache or reset user settings from the app menu.

[1.2.5]: https://github.com/Rand-ludtke/pokettrpg/releases/tag/v1.2.5