# Pokémon TTRPG — MVP UI

Retro terminal + Pokédex-style UI for managing PC Boxes, a Team, and a simple Battle statblock.

## What’s here
- React + Vite + TS app under `app/`
- Retro UI theme (green/black, monospace)
- PC Box grid (6×5) with empty slots
- Side Panel summary and “Add to Team”
- Team view (remove, shows HP bar)
- Battle tab (single Pokémon statblock vs selected target)
- Team persistence in localStorage

## Run
1. Dev server
   - `npm i`
   - `npm run dev`
   - open http://localhost:5173

2. Build
   - `npm run build`
   - `npm run preview`

## Data
- Using `src/data/pokedex.sample.ts` for a tiny starter set
- Next: hook up Showdown’s public `pokedex.json` and sprites via remote URLs

## Next steps
- Box pagination (multiple boxes) + persistence
- Team drag-to-reorder
- Keyboard navigation (arrow keys, Enter, Space)
- Dice/damage helper with rules (STAB, type mults, stages)
- Status & stage controls (±6 clamp)
- Type chart UI
- Import/export boxes and teams (JSON)
- Optional sounds/beeps
