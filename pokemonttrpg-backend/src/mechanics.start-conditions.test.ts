import { describe, expect, it } from "vitest";
import Engine from "./engine";
import { MoveAction, Player } from "./types";
import { TACKLE, defaultStats, sampleMon } from "./samples";

describe("Battle start conditions", () => {
  it("applies starting weather/terrain and hazards before first turn", () => {
    const p1: Player = {
      id: "p1",
      name: "P1",
      activeIndex: 0,
      team: [sampleMon("p1-1", "A", ["Normal"], defaultStats({ hp: 160 }), [TACKLE])],
    };
    const p2: Player = {
      id: "p2",
      name: "P2",
      activeIndex: 0,
      team: [sampleMon("p2-1", "B", ["Fire"], defaultStats({ hp: 160 }), [TACKLE])],
    };

    const engine = new Engine({ seed: 1 });
    const state = engine.initializeBattle([p1, p2], {
      seed: 1,
      startConditions: {
        field: {
          weather: { id: "rain", turnsLeft: 5 },
          terrain: { id: "grassy", turnsLeft: 4 },
        },
        side2: {
          sideHazards: { stealthRock: true },
        },
      },
    });

    expect(state.field.weather.id).toBe("rain");
    expect(state.field.weather.turnsLeft).toBe(5);
    expect(state.field.terrain.id).toBe("grassy");
    expect(state.field.terrain.turnsLeft).toBe(4);
    expect(state.players[1].sideHazards?.stealthRock).toBe(true);
    // Fire takes 25% from Stealth Rock on switch-in.
    expect(state.players[1].team[0].currentHP).toBe(120);
  });

  it("applies and decrements starting side condition timers", () => {
    const p1: Player = {
      id: "p1",
      name: "P1",
      activeIndex: 0,
      team: [sampleMon("p1-1", "A", ["Normal"], defaultStats({ hp: 140 }), [TACKLE])],
    };
    const p2: Player = {
      id: "p2",
      name: "P2",
      activeIndex: 0,
      team: [sampleMon("p2-1", "B", ["Normal"], defaultStats({ hp: 140 }), [TACKLE])],
    };

    const engine = new Engine({ seed: 7 });
    const initial = engine.initializeBattle([p1, p2], {
      seed: 7,
      startConditions: {
        side1: {
          sideConditions: {
            reflectTurns: 3,
            tailwindTurns: 2,
          },
        },
      },
    });

    expect(initial.players[0].sideConditions?.reflectTurns).toBe(3);
    expect(initial.players[0].sideConditions?.tailwindTurns).toBe(2);

    const a1: MoveAction = {
      type: "move",
      actorPlayerId: "p1",
      pokemonId: "p1-1",
      moveId: "tackle",
      targetPlayerId: "p2",
      targetPokemonId: "p2-1",
    };
    const a2: MoveAction = {
      type: "move",
      actorPlayerId: "p2",
      pokemonId: "p2-1",
      moveId: "tackle",
      targetPlayerId: "p1",
      targetPokemonId: "p1-1",
    };

    const res = engine.processTurn([a1, a2]);
    expect(res.state.players[0].sideConditions?.reflectTurns).toBe(2);
    expect(res.state.players[0].sideConditions?.tailwindTurns).toBe(1);
  });
});
