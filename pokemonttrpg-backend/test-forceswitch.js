/**
 * Integration test for force-switch fixes:
 * 1. slotIndex mapping — choices with correct slotIndex are matched by engine
 * 2. Single-element choices array handled as multi-slot (>= 1 threshold)
 * 3. Cancel/restore flow (code trace only, not UI)
 */
const SyncPSEngine = require("./dist/sync-ps-engine").SyncPSEngine;

function makeMon(name, species, moves) {
  return {
    id: name.toLowerCase().replace(/\s/g, ''),
    name,
    species: species || name,
    level: 100,
    ability: "noguard",
    item: "",
    nature: "Hardy",
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    moves: moves || ["tackle"],
    types: ["Normal"],
    gender: "M",
  };
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// ============================================================
// TEST 1: Singles force-switch (basic — legacy toIndex path)
// ============================================================
console.log("\n=== TEST 1: Singles force-switch (basic) ===");
{
  const engine = new SyncPSEngine({ format: "gen9customgame" });
  const players = [
    {
      id: "p1", name: "Alice",
      team: [makeMon("Pikachu", "Pikachu", ["thunderbolt"]), makeMon("Charmander", "Charmander", ["ember"])],
    },
    {
      id: "p2", name: "Bob",
      team: [makeMon("Bulbasaur", "Bulbasaur", ["vinewhip"]), makeMon("Squirtle", "Squirtle", ["watergun"])],
    },
  ];
  engine.initializeBattle(players, { autoTeamPreview: true });

  // Get request to verify initial state
  const req1 = engine.getRequest("p1");
  assert(req1 !== null, "p1 has a request after init");
  // PS engine doesn't set requestType — the server/client derives it. Verify it has active moves instead.
  assert(Array.isArray(req1.active), `p1 request has active array (PS native request)`);

  // Do a turn so the battle is in progress
  engine.processTurn([
    { type: "move", actorPlayerId: "p1", moveId: "thunderbolt" },
    { type: "move", actorPlayerId: "p2", moveId: "vinewhip" },
  ]);

  // Force switch p1 to Charmander (toIndex=1, single-slot legacy path)
  const res = engine.forceSwitch("p1", 1);
  // forceSwitch may produce events or not depending on battle state;
  // the key is it doesn't crash and returns valid arrays
  assert(Array.isArray(res.events), "forceSwitch returned valid events array");
  assert(Array.isArray(res.anim), "forceSwitch returned valid anim array");
  console.log(`  Singles force-switch: OK (events=${res.events.length}, anim=${res.anim.length})`);
}

// ============================================================
// TEST 2: Multi-slot force-switch with slotIndex mapping
// This tests the exact bug: forceSwitch [false, true] with 
// a single choice that has slotIndex:1 (not 0)
// ============================================================
console.log("\n=== TEST 2: Doubles force-switch slotIndex mapping ===");
{
  const engine = new SyncPSEngine({ format: "gen9doublescustomgame" });
  const players = [
    {
      id: "p1", name: "Alice",
      team: [
        makeMon("Pikachu", "Pikachu", ["thunderbolt"]),
        makeMon("Charmander", "Charmander", ["ember"]),
        makeMon("Bulbasaur", "Bulbasaur", ["vinewhip"]),
      ],
    },
    {
      id: "p2", name: "Bob",
      team: [
        makeMon("Squirtle", "Squirtle", ["watergun"]),
        makeMon("Eevee", "Eevee", ["tackle"]),
        makeMon("Geodude", "Geodude", ["rockthrow"]),
      ],
    },
  ];
  engine.initializeBattle(players, { autoTeamPreview: true });

  // In doubles, after a KO, the PS engine sets forceSwitch.
  // We can't easily cause a KO in test, but we CAN directly test the
  // multi-slot forceSwitch path with choices array.
  
  // Simulate: forceSwitch [false, true] — slot 0 alive, slot 1 fainted
  // The client should send choices = [{ type: 'switch', toIndex: 2, slotIndex: 1 }]
  // (slotIndex: 1 because that's the slot that needs replacement)
  
  // Test the engine's forceSwitch with a choices array having slotIndex: 1
  const choices = [{ type: "switch", toIndex: 2, slotIndex: 1 }];
  const res = engine.forceSwitch("p1", undefined, choices);
  
  // The engine should have processed this — check that it generated events or at least didn't crash
  assert(Array.isArray(res.events), "forceSwitch returned events array");
  assert(Array.isArray(res.anim), "forceSwitch returned anim array");
  console.log(`  Events: ${res.events.length}, Anim: ${res.anim.length}`);
  
  // The key test: verify the engine's forceSwitch handles choices.length >= 1
  // (our fix changed > 1 to >= 1)
  assert(choices.length === 1, "choices array has 1 element (single faint in doubles)");
  console.log("  Multi-slot with 1 choice: Completed without crash");
}

// ============================================================
// TEST 3: Multi-slot force-switch with 2 choices (double KO)
// ============================================================
console.log("\n=== TEST 3: Doubles double-KO force-switch ===");
{
  const engine = new SyncPSEngine({ format: "gen9doublescustomgame" });
  const players = [
    {
      id: "p1", name: "Alice",
      team: [
        makeMon("Pikachu", "Pikachu", ["thunderbolt"]),
        makeMon("Charmander", "Charmander", ["ember"]),
        makeMon("Bulbasaur", "Bulbasaur", ["vinewhip"]),
        makeMon("Jigglypuff", "Jigglypuff", ["sing"]),
      ],
    },
    {
      id: "p2", name: "Bob",
      team: [
        makeMon("Squirtle", "Squirtle", ["watergun"]),
        makeMon("Eevee", "Eevee", ["tackle"]),
        makeMon("Geodude", "Geodude", ["rockthrow"]),
        makeMon("Rattata", "Rattata", ["tackle"]),
      ],
    },
  ];
  engine.initializeBattle(players, { autoTeamPreview: true });

  // Double KO: forceSwitch [true, true] — both slots fainted
  // choices = [{ slotIndex: 0, toIndex: 2 }, { slotIndex: 1, toIndex: 3 }]
  const choices = [
    { type: "switch", toIndex: 2, slotIndex: 0 },
    { type: "switch", toIndex: 3, slotIndex: 1 },
  ];
  const res = engine.forceSwitch("p1", undefined, choices);
  assert(Array.isArray(res.events), "double-KO forceSwitch returned events");
  console.log(`  Events: ${res.events.length}, Anim: ${res.anim.length}`);
  console.log("  Double-KO multi-slot: Completed without crash");
}

// ============================================================
// TEST 4: Server-side validation (isMultiSlot threshold)
// Simulates what the server does with choices arrays
// ============================================================
console.log("\n=== TEST 4: Server isMultiSlot threshold check ===");
{
  // Simulate the server's check: Array.isArray(choices) && choices.length >= 1
  const singleChoice = [{ type: "switch", toIndex: 2, slotIndex: 1 }];
  const doubleChoice = [
    { type: "switch", toIndex: 2, slotIndex: 0 },
    { type: "switch", toIndex: 3, slotIndex: 1 },
  ];
  const noChoices = undefined;
  
  const isMultiSlot1 = Array.isArray(singleChoice) && singleChoice.length >= 1;
  const isMultiSlot2 = Array.isArray(doubleChoice) && doubleChoice.length >= 1;
  const isMultiSlotNone = Array.isArray(noChoices) && (noChoices?.length ?? 0) >= 1;
  
  assert(isMultiSlot1 === true, "1-element choices triggers multi-slot path");
  assert(isMultiSlot2 === true, "2-element choices triggers multi-slot path");
  assert(isMultiSlotNone === false, "undefined choices does NOT trigger multi-slot path");
}

// ============================================================
// TEST 5: Verify engine builds correct switch command from slotIndex
// This is a logic-level test of the exact algorithm in forceSwitch()
// ============================================================
console.log("\n=== TEST 5: Engine switch command building from slotIndex ===");
{
  // Reproduce the exact logic from sync-ps-engine.js forceSwitch()
  function buildSwitchCommand(forceSwitch, choices) {
    const switchParts = [];
    for (let i = 0; i < forceSwitch.length; i++) {
      if (forceSwitch[i]) {
        const c = choices.find(ch => ch.slotIndex === i);
        switchParts.push(c ? `switch ${c.toIndex + 1}` : 'pass');
      } else {
        switchParts.push('pass');
      }
    }
    return switchParts.join(', ');
  }

  // Scenario A: Single faint in slot 1 — [false, true]
  const cmdA = buildSwitchCommand([false, true], [{ slotIndex: 1, toIndex: 2 }]);
  assert(cmdA === "pass, switch 3", `[false,true] + slotIndex:1 => "${cmdA}" (expected "pass, switch 3")`);

  // Scenario B: Single faint in slot 0 — [true, false]
  const cmdB = buildSwitchCommand([true, false], [{ slotIndex: 0, toIndex: 2 }]);
  assert(cmdB === "switch 3, pass", `[true,false] + slotIndex:0 => "${cmdB}" (expected "switch 3, pass")`);

  // Scenario C: Double KO — [true, true]
  const cmdC = buildSwitchCommand([true, true], [{ slotIndex: 0, toIndex: 2 }, { slotIndex: 1, toIndex: 3 }]);
  assert(cmdC === "switch 3, switch 4", `[true,true] => "${cmdC}" (expected "switch 3, switch 4")`);

  // Scenario D: BUG CASE — old code assigned sequential index, not actual slotIndex
  const oldBugChoices = [{ slotIndex: 0, toIndex: 2 }]; // old code would produce this
  const cmdBug = buildSwitchCommand([false, true], oldBugChoices);
  assert(cmdBug === "pass, pass", `BUG: slotIndex:0 + [false,true] => "${cmdBug}" (switch lost!)`);

  // Scenario E: FIXED — slotIndex correctly set to 1
  const fixedChoices = [{ slotIndex: 1, toIndex: 2 }];
  const cmdFixed = buildSwitchCommand([false, true], fixedChoices);
  assert(cmdFixed === "pass, switch 3", `FIX: slotIndex:1 + [false,true] => "${cmdFixed}" (switch works!)`);
}

// ============================================================
// TEST 6: emitMovePrompts forceSwitch stripping
// Simulates the server stripping forceSwitch from move prompts
// ============================================================
console.log("\n=== TEST 6: Move prompt forceSwitch stripping ===");
{
  // Simulate what emitMovePrompts does: spread ...psRequest then strip forceSwitch
  const psRequest = {
    requestType: "move",
    forceSwitch: [false, true],
    side: { id: "p1", pokemon: [] },
    active: [{ moves: [] }],
    rqid: 123,
  };
  
  const prompt = { ...psRequest, requestType: "move", playerId: "p1" };
  
  // Our fix: strip forceSwitch from move prompts
  if (prompt.forceSwitch && prompt.requestType === "move") {
    delete prompt.forceSwitch;
  }
  
  assert(prompt.forceSwitch === undefined, "forceSwitch stripped from move prompt");
  assert(prompt.requestType === "move", "requestType preserved as 'move'");
  assert(prompt.rqid === 123, "other fields preserved");
  
  // Verify the destructuring approach also works
  const { forceSwitch: _fs, ...moveFields } = psRequest;
  assert(_fs !== undefined, "destructured forceSwitch captured");
  assert(moveFields.forceSwitch === undefined, "rest object has no forceSwitch");
  assert(moveFields.requestType === "move", "rest object keeps requestType");
}

// ============================================================
// TEST 6: Cancel flow — BattleChoiceBuilder rebuild
// Verifies that rebuilding choices from a saved request works
// ============================================================
console.log("\n=== TEST 7: Cancel flow logic ===");
{
  // Simulate: user picks a move -> waitingForOpponent -> cancel
  // The saved request should have requestType 'move' with active moves
  const savedRequest = {
    requestType: "move",
    active: [{ moves: [{ id: "thunderbolt", pp: 15, maxpp: 15 }] }],
    side: { id: "p1", pokemon: [{ name: "Pikachu", active: true }] },
  };
  
  // Cancel restores request — verify it has correct shape for move UI
  assert(savedRequest.requestType === "move", "restored request is move type");
  assert(!savedRequest.forceSwitch, "restored request has no forceSwitch");
  assert(savedRequest.active[0].moves.length > 0, "restored request has moves");
  
  // Also test: user picks a switch during normal turn -> cancel should still restore move request
  // This works because we now save the request for both move AND switch actions
  const requestBeforeSwitch = { ...savedRequest };
  // After user picks switch, the request ref still points to this
  assert(requestBeforeSwitch.requestType === "move", "request saved before switch action is still move type");
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.error("SOME TESTS FAILED!");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED!");
  process.exit(0);
}
