PS Mini Battle Viewer

How to use:
1) Run npm run test-battle to generate output/battle-log.json
2) Run npm run serve to start the static server
3) Navigate to http://localhost:5173
4) Click File and open output/battle-log.json. Use default sprites URL or point to a local sprites dir (e.g., pokemon-showdown-client/play.pokemonshowdown.com/sprites/gen5)
5) Click Play or Step.

Notes:
- This viewer renders a tiny subset of the PS protocol: switch/drag/detailschange/move/-damage/-heal/-status/win.
- It is intentionally lightweight. For full fidelity, integrate the actual PS client code.
