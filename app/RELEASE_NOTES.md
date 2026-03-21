## 1.5.2

### Boss Battles
- Added 2v1 (Doubles) and 3v1 (Triples) boss battle formats.
- Boss fields multiple active Pokémon with enlarged teams (up to 12/18).
- Multi-slot move selection: choose moves for each active slot progressively.
- Correct PS battle rendering for doubles/triples gametype.
- Lobby hint for boss battle team sizes.

### Fixes
- Fixed sprite regeneration: Generate button now creates a new sprite instead of returning the cached image.

## 1.5.1

- Switched on-demand fusion generation to SDXL Diffusers (no splice fallback).
- Added worker startup self-check for Python/torch/diffusers/transformers compatibility.
- Improved SDXL fusion conditioning to produce a single merged creature sprite.
- Aligned PWA and desktop app release/version labels to 1.5.1.
