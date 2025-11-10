# Changelog

All notable changes to this project will be documented in this file.

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