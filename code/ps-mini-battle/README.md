# PS Mini Battle

A minimal, self-contained battle simulation runner and lightweight replay viewer using the official `pokemon-showdown` sim.

Inputs:
- format: e.g., `gen9randombattle`, `gen7customgame`
- p1.name, p2.name: usernames
- teams.p1, teams.p2: packed team strings or JSON array of sets
- seed: optional PRNG seed; array like `[1,2,3,4]` or full string `gen5,1,2,3,4`

Outputs:
- `output/battle-log.json`: spectator protocol lines for the battle

## Run a test battle

- Install deps once:
  - npm install (from this folder)
- Generate a battle log:
  - npm run test-battle
- View the log in a simple UI:
  - npm run serve
  - Open http://localhost:5173 and load `output/battle-log.json`
  - Set your sprites folder path (e.g., `pokemon-showdown-client/play.pokemonshowdown.com/sprites/gen5/`), then Play/Step

## Customize

Edit `data/test-config.json` to change format, usernames, seed, and teams.
