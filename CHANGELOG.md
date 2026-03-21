# Changelog

All notable changes to this project will be documented in this file.

## [1.5.2] - 2026-03-19

### Boss Battles (2v1 / 3v1)
- Added boss battle format support: 2v1 (Doubles) and 3v1 (Triples).
- Boss player can field 2-3 active Pokémon with teams up to 12/18.
- Challenger controls their side's active slots with standard team of 6.
- Engine auto-selects PS format from player format rules (gen9doublescustomgame / gen5triplescustomgame).
- Multi-slot move selection UI: progressive slot-by-slot choice with "Slot X of Y" indicator.
- Multi-slot force switch support for doubles/triples.
- Correct gametype protocol emission (doubles/triples) for PS battle renderer.
- Boss format hint in lobby challenge UI.

### Sprite Regeneration
- Fixed on-demand fusion sprite regeneration: clicking Generate now creates a new sprite instead of showing the cached one.

## [1.5.1] - 2026-03-19

### Fusion Generation
- Enforced SDXL Diffusers pipeline for on-demand fusion generation.
- Removed splice-only behavior from worker generator path.
- Improved img2img conditioning to favor single fused creature outputs.

### Worker Reliability
- Added startup self-check for Python fusion dependencies and compatibility.
- Added startup guardrails for incompatible worker mode and stale build fallback.

### Release
- Aligned PWA + desktop app versions and visible UI version labels to 1.5.1.

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
[1.5.1]: https://github.com/Rand-ludtke/pokettrpg/releases/tag/v1.5.1