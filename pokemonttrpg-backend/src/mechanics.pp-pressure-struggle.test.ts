import { describe, it, expect } from "vitest";
import Engine from "./engine";
import { Player, MoveAction } from "./types";
import { defaultStats, sampleMon, TACKLE } from "./samples";

describe("PP + Pressure + Struggle", () => {
  it("Pressure causes -2 PP per use; Struggle is used when no PP remains and applies recoil", () => {
    const p1mon = sampleMon("p1-1", "A", ["Normal"], defaultStats({ hp: 100, atk: 50 }), [TACKLE]);
    // Keep target very bulky so it does not faint before PP reaches 0.
    const p2mon = sampleMon("p2-1", "B", ["Normal"], defaultStats({ hp: 500, def: 300 }), [TACKLE]);
    // Give Pressure to target
    p2mon.ability = "pressure";

    const p1: Player = { id: "p1", name: "P1", activeIndex: 0, team: [p1mon] };
    const p2: Player = { id: "p2", name: "P2", activeIndex: 0, team: [p2mon] };
    const engine = new Engine({ seed: 1 });
    engine.initializeBattle([p1, p2], { seed: 1 });

    // Default PP for tackle is 10; with Pressure, two uses should reduce to 6
    engine.processTurn([
      { type: "move", actorPlayerId: "p1", pokemonId: "p1-1", moveId: TACKLE.id, targetPlayerId: "p2", targetPokemonId: "p2-1" } as MoveAction,
    ]);
    const r2 = engine.processTurn([
      { type: "move", actorPlayerId: "p1", pokemonId: "p1-1", moveId: TACKLE.id, targetPlayerId: "p2", targetPokemonId: "p2-1" } as MoveAction,
    ]);
    // Can't directly inspect PP; ensure still usable. We'll simulate draining all PP quickly
    // 5 successful uses at -2 PP each drains Tackle from 10 -> 0.
    for (let i = 0; i < 3; i++) {
      engine.processTurn([
        { type: "move", actorPlayerId: "p1", pokemonId: "p1-1", moveId: TACKLE.id, targetPlayerId: "p2", targetPokemonId: "p2-1" } as MoveAction,
      ]);
    }
    // Next attempt should say no PP left unless Struggle triggers (we still have other moves? no)
    const hpBeforeStruggle = p1mon.currentHP;
    const res = engine.processTurn([
      { type: "move", actorPlayerId: "p1", pokemonId: "p1-1", moveId: TACKLE.id, targetPlayerId: "p2", targetPokemonId: "p2-1" } as MoveAction,
    ]);
    const joined = res.events.join("\n");
    // With no other moves and no PP left on Tackle, Struggle should be used and cause recoil
    expect(/used Struggle/i.test(joined) || /no PP left/i.test(joined)).toBe(true);
    expect(/recoil/i.test(joined)).toBe(true);
    expect(p1mon.currentHP).toBeLessThan(hpBeforeStruggle);
  });
});
