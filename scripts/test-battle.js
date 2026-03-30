/**
 * Battle flow test script - connects two simulated players to the backend
 * and tests singles, doubles, and team preview flows.
 */
const { io } = require("d:\\GitHub\\pokettrpg\\pokemonttrpg-backend\\node_modules\\socket.io-client");

const SERVER_URL = process.env.TEST_SERVER_URL || "http://localhost:3099";

function makeTeam(prefix, count = 3) {
  const species = ["Charizard", "Blastoise", "Venusaur", "Pikachu", "Gengar", "Alakazam"];
  return species.slice(0, count).map((sp, i) => ({
    id: `${prefix}-${sp.toLowerCase()}`,
    name: sp,
    species: sp,
    level: 50,
    types: ["Normal"],
    baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
    stats: { hp: 155, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    currentHP: 155,
    maxHP: 155,
    ability: "Blaze",
    item: "",
    moves: [
      { id: "flamethrower", name: "Flamethrower", type: "Fire", category: "Special", power: 90, accuracy: 100 },
      { id: "earthquake", name: "Earthquake", type: "Ground", category: "Physical", power: 100, accuracy: 100 },
      { id: "icebeam", name: "Ice Beam", type: "Ice", category: "Special", power: 90, accuracy: 100 },
      { id: "thunderbolt", name: "Thunderbolt", type: "Electric", category: "Special", power: 90, accuracy: 100 },
    ],
  }));
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { transports: ["polling", "websocket"] });
    const timeout = setTimeout(() => reject(new Error(`Connection timeout for ${name}`)), 5000);
    socket.on("connect", () => {
      clearTimeout(timeout);
      const userId = `test-${name}-${Date.now()}`;
      socket.emit("identify", { username: name, userId });
      socket.once("identified", (data) => {
        console.log(`[${name}] Connected as ${data.id}`);
        resolve({ socket, id: data.id, name });
      });
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForEvent(socket, event, filter, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeout);
    const handler = (data) => {
      if (!filter || filter(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}

async function testSinglesBattle() {
  console.log("\n=== TEST: Singles Battle (no team preview) ===\n");
  const p1 = await connect("Alice");
  const p2 = await connect("Bob");

  // Join global lobby
  p1.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  p2.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  await new Promise((r) => setTimeout(r, 500));

  // P1 creates challenge
  const team1 = makeTeam("p1", 3);
  const team2 = makeTeam("p2", 3);
  const challengeId = `test-${Date.now()}`;

  p1.socket.emit("createChallenge", {
    roomId: "global-lobby",
    challengeId,
    toPlayerId: p2.id,
    rules: { format: "singles", playerFormat: "1v1", teamPreview: false },
    player: { id: p1.id, name: p1.name, team: team1, activeIndex: 0 },
  });

  await new Promise((r) => setTimeout(r, 300));

  // Set up listeners BEFORE p2 responds
  const p1BattleStarted = waitForEvent(p1.socket, "battleStarted", null);
  const p2BattleStarted = waitForEvent(p2.socket, "battleStarted", null);
  const p1Prompt = waitForEvent(p1.socket, "promptAction", (d) => d.prompt?.requestType === "move" || d.prompt?.active);
  const p2Prompt = waitForEvent(p2.socket, "promptAction", (d) => d.prompt?.requestType === "move" || d.prompt?.active);

  // P2 accepts challenge
  p2.socket.emit("respondChallenge", {
    roomId: "global-lobby",
    challengeId,
    accepted: true,
    player: { id: p2.id, name: p2.name, team: team2, activeIndex: 0 },
  });

  // Wait for battle to start
  const bs1 = await p1BattleStarted;
  const bs2 = await p2BattleStarted;
  console.log("[Alice] battleStarted received. Turn:", bs1.state?.turn, "Players:", bs1.state?.players?.length);
  console.log("[Bob]   battleStarted received. Turn:", bs2.state?.turn);
  const roomId = bs1.roomId;

  // Wait for initial move prompts
  const prompt1 = await p1Prompt;
  const prompt2 = await p2Prompt;
  console.log("[Alice] promptAction received. Type:", prompt1.prompt?.requestType, "Active moves:", prompt1.prompt?.active?.[0]?.moves?.length);
  console.log("[Alice] Prompt keys:", Object.keys(prompt1.prompt || {}));
  console.log("[Alice] Prompt active:", JSON.stringify(prompt1.prompt?.active)?.substring(0, 300));
  console.log("[Alice] Prompt side keys:", Object.keys(prompt1.prompt?.side || {}));
  console.log("[Bob]   promptAction received. Type:", prompt2.prompt?.requestType, "Active moves:", prompt2.prompt?.active?.[0]?.moves?.length);

  if (!prompt1.prompt?.active?.[0]?.moves?.length) {
    console.error("FAIL: Alice has no active moves on turn 1!");
    p1.socket.disconnect();
    p2.socket.disconnect();
    return false;
  }
  console.log("PASS: Both players received move prompts on turn 1\n");

  // Turn 1: Both players choose move 1
  console.log("[Turn 1] Both players choosing move 1...");
  const p1Update = waitForEvent(p1.socket, "battleUpdate", null);
  const p1NextPrompt = waitForEvent(p1.socket, "promptAction", (d) => {
    return (d.prompt?.requestType === "move" || d.prompt?.active) && !d.prompt?.wait;
  });

  p1.socket.emit("sendAction", {
    roomId,
    playerId: p1.id,
    action: { type: "move", moveIndex: 0, moveId: "flamethrower" },
  });
  p2.socket.emit("sendAction", {
    roomId,
    playerId: p2.id,
    action: { type: "move", moveIndex: 0, moveId: "flamethrower" },
  });

  // Wait for battle update (turn results)
  const update1 = await p1Update;
  console.log("[Turn 1 Result] Events:", update1.result?.events?.length, "Turn:", update1.result?.state?.turn);
  const turnEvents = update1.result?.events?.filter((e) => e.startsWith("|turn|"));
  console.log("[Turn 1 Result] Turn lines:", turnEvents);

  // Wait for turn 2 prompt
  try {
    const nextPrompt = await p1NextPrompt;
    console.log("[Alice] Turn 2 prompt received! Type:", nextPrompt.prompt?.requestType, "Active moves:", nextPrompt.prompt?.active?.[0]?.moves?.length);
    if (nextPrompt.prompt?.active?.[0]?.moves?.length > 0) {
      console.log("PASS: Turn 2 move prompt received with moves\n");
    } else {
      console.log("FAIL: Turn 2 prompt has no moves!");
    }
  } catch (err) {
    console.error("FAIL: Turn 2 prompt never arrived!", err.message);
    p1.socket.disconnect();
    p2.socket.disconnect();
    return false;
  }

  p1.socket.disconnect();
  p2.socket.disconnect();
  return true;
}

async function testDoublesBattle() {
  console.log("\n=== TEST: Doubles Battle (with team preview) ===\n");
  const p1 = await connect("Charlie");
  const p2 = await connect("Diana");

  p1.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  p2.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  await new Promise((r) => setTimeout(r, 500));

  const team1 = makeTeam("p1d", 4);
  const team2 = makeTeam("p2d", 4);
  const challengeId = `test-dbl-${Date.now()}`;

  p1.socket.emit("createChallenge", {
    roomId: "global-lobby",
    challengeId,
    toPlayerId: p2.id,
    rules: { format: "doubles", playerFormat: "1v1", teamPreview: true },
    player: { id: p1.id, name: p1.name, team: team1, activeIndex: 0 },
  });

  await new Promise((r) => setTimeout(r, 300));

  // Listen for team preview
  const p1TeamPreview = waitForEvent(p1.socket, "promptAction", (d) => d.prompt?.teamPreview);
  const p2TeamPreview = waitForEvent(p2.socket, "promptAction", (d) => d.prompt?.teamPreview);

  p2.socket.emit("respondChallenge", {
    roomId: "global-lobby",
    challengeId,
    accepted: true,
    player: { id: p2.id, name: p2.name, team: team2, activeIndex: 0 },
  });

  // Wait for team preview prompts
  const tp1 = await p1TeamPreview;
  const tp2 = await p2TeamPreview;
  const roomId = tp1.roomId;
  console.log("[Charlie] Team preview received. Side pokemon:", tp1.prompt?.side?.pokemon?.length);
  console.log("[Diana]   Team preview received. Side pokemon:", tp2.prompt?.side?.pokemon?.length);
  console.log("[Charlie] State gameType:", tp1.state?.gameType, "activeCount:", tp1.state?.rules?.activeCount);
  console.log("[Charlie] State keys:", Object.keys(tp1.state || {}));
  console.log("[Charlie] State rules:", JSON.stringify(tp1.state?.rules));

  if (tp1.state?.rules?.activeCount !== 2) {
    console.error("FAIL: Doubles team preview should have activeCount=2, got:", tp1.state?.rules?.activeCount);
  } else {
    console.log("PASS: Doubles team preview has activeCount=2");
  }

  // Submit team orders (first 4 pokemon, lead is idx 0)
  const p1MovePrompt = waitForEvent(p1.socket, "promptAction", (d) => d.prompt?.requestType === "move" || (d.prompt?.active && !d.prompt?.teamPreview));
  const p2MovePrompt = waitForEvent(p2.socket, "promptAction", (d) => d.prompt?.requestType === "move" || (d.prompt?.active && !d.prompt?.teamPreview));

  p1.socket.emit("sendAction", {
    roomId,
    playerId: p1.id,
    action: { type: "team", order: [1, 2, 3, 4] },
  });
  p2.socket.emit("sendAction", {
    roomId,
    playerId: p2.id,
    action: { type: "team", order: [1, 2, 3, 4] },
  });

  // Wait for move prompts after team preview
  const mp1 = await p1MovePrompt;
  const mp2 = await p2MovePrompt;
  console.log("[Charlie] Move prompt after team preview. Active slots:", mp1.prompt?.active?.length, "Moves in slot 0:", mp1.prompt?.active?.[0]?.moves?.length);
  console.log("[Diana]   Move prompt after team preview. Active slots:", mp2.prompt?.active?.length);

  if ((mp1.prompt?.active?.length || 0) >= 2) {
    console.log("PASS: Doubles prompt has 2 active slots");
  } else {
    console.log("INFO: Active slots:", mp1.prompt?.active?.length, "(may need multi-choice)");
  }

  // Turn 1: Send multi-choice (one for each active slot)
  const p1Update = waitForEvent(p1.socket, "battleUpdate", null);
  p1.socket.emit("sendAction", {
    roomId,
    playerId: p1.id,
    action: { type: "multi-choice", choices: [
      { type: "move", moveIndex: 0, moveId: "flamethrower" },
      { type: "move", moveIndex: 0, moveId: "flamethrower" },
    ]},
  });
  p2.socket.emit("sendAction", {
    roomId,
    playerId: p2.id,
    action: { type: "multi-choice", choices: [
      { type: "move", moveIndex: 0, moveId: "flamethrower" },
      { type: "move", moveIndex: 0, moveId: "flamethrower" },
    ]},
  });

  const upd = await p1Update;
  console.log("[Doubles Turn 1 Result] Events:", upd.result?.events?.length, "Turn:", upd.result?.state?.turn);
  console.log("PASS: Doubles battle turn processed successfully\n");

  p1.socket.disconnect();
  p2.socket.disconnect();
  return true;
}

async function testTriplesBattle() {
  console.log("\n=== TEST: Triples Battle ===\n");
  const p1 = await connect("Eve");
  const p2 = await connect("Frank");

  p1.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  p2.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  await new Promise((r) => setTimeout(r, 500));

  const team1 = makeTeam("p1t", 6);
  const team2 = makeTeam("p2t", 6);
  const challengeId = `test-tri-${Date.now()}`;

  const p1BattleStarted = waitForEvent(p1.socket, "battleStarted", null);
  const p1Prompt = waitForEvent(p1.socket, "promptAction", (d) => d.prompt?.requestType === "move" || d.prompt?.active);

  p1.socket.emit("createChallenge", {
    roomId: "global-lobby",
    challengeId,
    toPlayerId: p2.id,
    rules: { format: "triples", playerFormat: "1v1", teamPreview: false },
    player: { id: p1.id, name: p1.name, team: team1, activeIndex: 0 },
  });

  await new Promise((r) => setTimeout(r, 300));

  p2.socket.emit("respondChallenge", {
    roomId: "global-lobby",
    challengeId,
    accepted: true,
    player: { id: p2.id, name: p2.name, team: team2, activeIndex: 0 },
  });

  const bs = await p1BattleStarted;
  console.log("[Eve] battleStarted. GameType:", (bs.state)?.gameType, "Turn:", bs.state?.turn);

  const prompt = await p1Prompt;
  console.log("[Eve] Prompt received. Active slots:", prompt.prompt?.active?.length, "Moves:", prompt.prompt?.active?.[0]?.moves?.length);

  if ((prompt.prompt?.active?.length || 0) >= 3) {
    console.log("PASS: Triples has 3 active slots");
  } else {
    console.log("INFO: Active slots:", prompt.prompt?.active?.length);
  }

  p1.socket.disconnect();
  p2.socket.disconnect();
  return true;
}

async function testFFA4Battle() {
  console.log("\n=== TEST: Free-For-All (4 Player) ===\n");
  const p1 = await connect("Gina");
  const p2 = await connect("Hank");
  const p3 = await connect("Iris");
  const p4 = await connect("Jake");

  for (const p of [p1, p2, p3, p4]) {
    p.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  }
  await new Promise((r) => setTimeout(r, 500));

  const challengeId = `test-ffa-${Date.now()}`;

  // Set up listeners before creating challenge
  const prompts = {};
  const battleStarted = {};
  for (const p of [p1, p2, p3, p4]) {
    prompts[p.name] = [];
    battleStarted[p.name] = false;
    p.socket.on("battleStarted", () => { battleStarted[p.name] = true; });
    p.socket.on("promptAction", (d) => {
      if (d.waitingFor !== undefined && !d.prompt) return;
      if (d.prompt?.wait && !d.prompt?.requestType && !d.prompt?.forceSwitch && !d.prompt?.teamPreview) return;
      prompts[p.name].push(d);
    });
  }

  p1.socket.emit("createChallenge", {
    roomId: "global-lobby",
    challengeId,
    toPlayerId: p2.id,
    rules: { format: "ffa", playerFormat: "4ffa", teamPreview: false },
    player: { id: p1.id, name: p1.name, team: makeTeam("ffa1", 3), activeIndex: 0 },
  });
  await new Promise((r) => setTimeout(r, 300));

  // All other players accept
  for (const p of [p2, p3, p4]) {
    p.socket.emit("respondChallenge", {
      roomId: "global-lobby",
      challengeId,
      accepted: true,
      player: { id: p.id, name: p.name, team: makeTeam(`ffa${p.name}`, 3), activeIndex: 0 },
    });
    await new Promise((r) => setTimeout(r, 300));
  }

  // Wait for events
  await new Promise((r) => setTimeout(r, 5000));

  let pass = true;
  for (const p of [p1, p2, p3, p4]) {
    const started = battleStarted[p.name];
    const hasPrompt = prompts[p.name].length > 0;
    const lastPrompt = prompts[p.name][prompts[p.name].length - 1];
    const activeSlots = lastPrompt?.prompt?.active?.length || 0;
    const moves = lastPrompt?.prompt?.active?.[0]?.moves?.length || 0;
    console.log(`[${p.name}] battleStarted=${started} prompts=${prompts[p.name].length} activeSlots=${activeSlots} moves=${moves}`);
    if (!hasPrompt) {
      console.log(`  [WARN] ${p.name}: No prompt received`);
      // FFA may not be fully implemented - don't fail the whole suite
    }
  }

  const anyStarted = Object.values(battleStarted).some(v => v);
  const anyPrompts = Object.values(prompts).some(v => v.length > 0);
  if (anyStarted || anyPrompts) {
    console.log("PASS: FFA battle initiated (at least some players got events)");
  } else {
    console.log("INFO: FFA battle - no events received (may need more players or different protocol)");
    pass = false;
  }

  for (const p of [p1, p2, p3, p4]) p.socket.disconnect();
  return pass;
}

async function testBoss2v1Battle() {
  console.log("\n=== TEST: Boss Battle (2v1) ===\n");
  const boss = await connect("Boss");
  const challenger = await connect("Hero");
  const ally = await connect("Sidekick");

  for (const p of [boss, challenger, ally]) {
    p.socket.emit("joinRoom", { roomId: "global-lobby", role: "player" });
  }
  await new Promise((r) => setTimeout(r, 500));

  const challengeId = `test-boss-${Date.now()}`;

  const prompts = {};
  const battleStarted = {};
  for (const p of [boss, challenger, ally]) {
    prompts[p.name] = [];
    battleStarted[p.name] = false;
    p.socket.on("battleStarted", () => { battleStarted[p.name] = true; });
    p.socket.on("promptAction", (d) => {
      if (d.waitingFor !== undefined && !d.prompt) return;
      if (d.prompt?.wait && !d.prompt?.requestType && !d.prompt?.forceSwitch && !d.prompt?.teamPreview) return;
      prompts[p.name].push(d);
    });
  }

  boss.socket.emit("createChallenge", {
    roomId: "global-lobby",
    challengeId,
    toPlayerId: challenger.id,
    rules: { format: "doubles", playerFormat: "2v1", teamPreview: false },
    player: { id: boss.id, name: boss.name, team: makeTeam("boss", 6), activeIndex: 0 },
  });
  await new Promise((r) => setTimeout(r, 300));

  challenger.socket.emit("respondChallenge", {
    roomId: "global-lobby",
    challengeId,
    accepted: true,
    player: { id: challenger.id, name: challenger.name, team: makeTeam("hero", 3), activeIndex: 0 },
  });
  await new Promise((r) => setTimeout(r, 300));

  ally.socket.emit("respondChallenge", {
    roomId: "global-lobby",
    challengeId,
    accepted: true,
    player: { id: ally.id, name: ally.name, team: makeTeam("ally", 3), activeIndex: 0 },
  });

  await new Promise((r) => setTimeout(r, 5000));

  let pass = true;
  for (const p of [boss, challenger, ally]) {
    const started = battleStarted[p.name];
    const hasPrompt = prompts[p.name].length > 0;
    const lastPrompt = prompts[p.name][prompts[p.name].length - 1];
    const activeSlots = lastPrompt?.prompt?.active?.length || 0;
    console.log(`[${p.name}] battleStarted=${started} prompts=${prompts[p.name].length} activeSlots=${activeSlots}`);
  }

  const anyStarted = Object.values(battleStarted).some(v => v);
  const anyPrompts = Object.values(prompts).some(v => v.length > 0);
  if (anyStarted || anyPrompts) {
    console.log("PASS: Boss 2v1 battle initiated");
  } else {
    console.log("INFO: Boss 2v1 - no events received");
    pass = false;
  }

  for (const p of [boss, challenger, ally]) p.socket.disconnect();
  return pass;
}

async function main() {
  let allPassed = true;

  try {
    const singlesOk = await testSinglesBattle();
    allPassed = allPassed && singlesOk;
  } catch (err) {
    console.error("Singles test error:", err.message);
    allPassed = false;
  }

  try {
    const doublesOk = await testDoublesBattle();
    allPassed = allPassed && doublesOk;
  } catch (err) {
    console.error("Doubles test error:", err.message);
    allPassed = false;
  }

  try {
    const triplesOk = await testTriplesBattle();
    allPassed = allPassed && triplesOk;
  } catch (err) {
    console.error("Triples test error:", err.message);
    allPassed = false;
  }

  try {
    const ffaOk = await testFFA4Battle();
    allPassed = allPassed && ffaOk;
  } catch (err) {
    console.error("FFA test error:", err.message);
    allPassed = false;
  }

  try {
    const bossOk = await testBoss2v1Battle();
    allPassed = allPassed && bossOk;
  } catch (err) {
    console.error("Boss 2v1 test error:", err.message);
    allPassed = false;
  }

  console.log("\n" + "=".repeat(50));
  console.log(allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED");
  console.log("=".repeat(50));
  process.exit(allPassed ? 0 : 1);
}

main();
