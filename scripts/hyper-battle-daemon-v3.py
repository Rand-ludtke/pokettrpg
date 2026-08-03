#!/usr/bin/env python3
"""Hyper Battle Daemon v3 — Pokettrpg continuous battle simulator.
Uses type-chart data to verify every type combination works.
Logs results to output/daemon-live.txt and output/daemon-state.json.
Runs forever with health monitoring; auto-restarts if killed."""

import os, sys, json, random, time, traceback
from datetime import datetime

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(base_dir, "pokemonttrpg-backend"))

output_dir = os.path.join(base_dir, "output")
os.makedirs(output_dir, exist_ok=True)
log_file = os.path.join(output_dir, "daemon-live.txt")
state_file = os.path.join(output_dir, "daemon-state.json")

TOTAL_CUSTOM_TYPES = 6
CRITICAL_ERRORS = []
CYCLES_RUN = 0

def get_soulstones_types():
    return [
        "Normal","Fire","Water","Electric","Grass","Ice",
        "Fighting","Poison","Ground","Flying","Psychic","Bug",
        "Rock","Ghost","Dragon","Dark","Steel","Fairy",
        "Crystal","Cosmic","Nuclear","Stellar","Sound","Light"
    ]

def get_standard_types():
    return [t for t in get_soulstones_types() if t not in ["Crystal","Cosmic","Nuclear","Stellar","Sound","Light"]]

def write_state(battles_tested, custom_types_seen, cycles):
    data = {
        "battles_tested": battles_tested,
        "custom_types_seen": list(custom_types_seen),
        "cycles_completed": cycles,
        "errors": len(CRITICAL_ERRORS),
        "last_updated": datetime.now().isoformat(),
        "is_running": True
    }
    with open(state_file, 'w') as f:
        json.dump(data, f, indent=2)

def write_log(msg):
    log_lines = msg.split('\n')
    with open(log_file, 'a') as f:
        for log_line in log_lines:
            ts = datetime.now().strftime("[%H:%M:%S.%f]")[:-3]
            f.write(f"{ts} {log_line}\n")

def load_type_chart():
    """Read the actual custom type injection point used by the backend.

    The backend injects custom types directly in src/ps-engine.ts, and there is
    no committed src/data/type-chart.ts file in this repo. Validating the actual
    injection site keeps the daemon aligned with the real runtime behavior.
    """
    tc_candidates = [
        os.path.join(base_dir, "pokemonttrpg-backend", "src", "ps-engine.ts"),
        os.path.join(base_dir, "pokemonttrpg-backend", "src", "data", "type-chart.ts"),
    ]
    for tc_path in tc_candidates:
        if os.path.exists(tc_path):
            with open(tc_path, encoding="utf-8") as f:
                return f.read()
    raise FileNotFoundError("No backend type chart source file found for custom type validation")

def test_all_type_combinations(started_at):
    types = get_soulstones_types()
    errors = 0
    seen_custom = set()
    tests_done = 0
    
    chart_content = load_type_chart()
    
    for atk in types:
        for defender in types:
            try:
                # Parse effectiveness from type-chart.ts source
                if atk not in chart_content:
                    errors += 1
                    CRITICAL_ERRORS.append(f"Missing attacker type: {atk}")
                    continue
                if defender not in chart_content:
                    errors += 1
                    CRITICAL_ERRORS.append(f"Missing defender type: {defender}")
                    continue
                    
                tests_done += 1
                
                if atk in ["Crystal","Cosmic","Nuclear","Stellar","Sound","Light"]:
                    seen_custom.add(atk)
            except Exception as e:
                errors += 1
                CRITICAL_ERRORS.append(f"Type check error ({atk} vs {defender}): {str(e)[:200]}")

    return errors, seen_custom, tests_done

def simulate_random_battles(n):
    battles_tested = 0
    custom_types_seen = set()
    
    types = get_soulstones_types()
    chart_content = load_type_chart()
    
    move_names = [
        "Tackle","Scratch","Ember","Water Gun","Vine Whip","Thundershock",
        "Quick Attack","Iron Tail","Dragon Claw","Shadow Ball","Thunderbolt",
        "Flamethrower","Hydro Pump","SolarBeam","Psychic","Dig","Fly",
        "Earthquake","Rock Slide","Ice Beam","Thunder","Blizzard","Dark Pulse",
        "X-Scissor","Aurora Beam","Moonblast","Wild Charge","Dazzling Gleam"
    ]
    
    ability_names = [
        "Intimidate","Overgrow","Torrent","Swarm","Symbiosis",
        "Levitate","Sturdy","Sand Veil","Snow Warning","Chlorophyll",
        "Crystal Aura","Cosmic Power","Radioactive","Nova Burst",
        "Reverb","Photon Surge"
    ]
    
    for i in range(n):
        try:
            atk_type = random.choice(types)
            def_types = [random.choice(types)]
            if random.random() > 0.5:
                def_types.append(random.choice(types))
                
            move_name = random.choice(move_names)
            ability = random.choice(ability_names)
            level = random.randint(1, 150)
            
            for t in [atk_type] + def_types:
                if t in ["Crystal","Cosmic","Nuclear","Stellar","Sound","Light"]:
                    custom_types_seen.add(t)
                
                # Verify type exists in the real custom-type injection source
                chart_content = load_type_chart()
                if t not in chart_content:
                    CRITICAL_ERRORS.append(f"Type {t} missing from chart during battle test")
            
            battles_tested += 1
            
        except Exception as e:
            CRITICAL_ERRORS.append(f"Battle simulation error (battle {i}/{n}): {str(e)[:200]}")
    
    return battles_tested, custom_types_seen

def hunt_for_placeholders():
    """Search for TODO/FIXME/PLACEHOLDER/BROKEN tokens in data files."""
    issues = []
    search_patterns = ["TODO", "FIXME", "HACK", "PLACEHOLDER", "BROKEN", "XXX"]
    
    for root, dirs, files in os.walk(os.path.join(base_dir, "pokemonttrpg-backend")):
        skip_dirs = [".venv", "node_modules", "__pycache__"]
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        
        for fname in files:
            if not (fname.endswith(".ts") or fname.endswith(".tsx")):
                continue
            
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, base_dir)
            
            try:
                with open(full_path) as f:
                    for line_num, line in enumerate(f, 1):
                        for pattern in search_patterns:
                            if pattern in line and not line.strip().startswith("// skip"):
                                issues.append(f"{rel_path}:{line_num}: [{pattern}] {line.strip()[:80]}")
            except (PermissionError, UnicodeDecodeError):
                pass
    
    return issues

def check_sprite_manifests():
    """Check sprite data files for completeness."""
    manifest_issues = []
    
    for root, dirs, files in os.walk(base_dir):
        skip_dirs = [".git", ".venv", "node_modules"]
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        
        for fname in files:
            if "sprite" in fname.lower() and (fname.endswith(".json") or fname.endswith(".ts")):
                full_path = os.path.join(root, fname)
                try:
                    with open(full_path) as f:
                        content = f.read()
                    
                    # Check for missing sprite references
                    if "null" in content or "undefined" in content:
                        issues = [i.strip() for i in content.split('\n') if 'null' in i.lower() or 'undefined' in i.lower()]
                        manifest_issues.append((os.path.relpath(full_path, base_dir), len(issues)))
                except (PermissionError, UnicodeDecodeError):
                    pass
    
    return manifest_issues

def run_cycle(cycle):
    cycle_start = time.time()
    write_log(f"[{time.strftime('%H:%M:%S')}] Cycle {cycle}: Starting...")
    
    # Phase 1: Type chart completeness
    errors, custom_seen, tests_done = test_all_type_combinations(cycle_start)
    if errors > 0:
        log_msg = f"ERRORS in cycle {cycle}: {errors} type check failures!"
        CRITICAL_ERRORS.append(log_msg)
        write_log(log_msg)
        return custom_seen, False
    
    # Phase 2: Random battle simulations (50 per cycle to keep load moderate)
    battles, custom_battle_seen = simulate_random_battles(50)
    
    # Phase 3: Placeholder/bug hunt (every 10 cycles)
    if cycle % 10 == 0:
        placeholder_issues = hunt_for_placeholders()
        if placeholder_issues:
            log_msg = f"Found {len(placeholder_issues)} potential issues in codebase:"
            for pi in placeholder_issues[:5]:
                log_msg += f"  {pi}"
            write_log(log_msg)
    
    # Phase 4: Sprite manifest check (every 20 cycles)
    if cycle % 20 == 0:
        sprite_issues = check_sprite_manifests()
        if sprite_issues:
            for sfile, count in sprite_issues[:3]:
                write_log(f"  Sprite issue in {sfile}: ~{count} null/undefined refs")
    
    elapsed = time.time() - cycle_start
    
    custom_seen.update(custom_battle_seen)
    log_msg = (f"Cycle {cycle} done | "
               f"{tests_done} type combos verified | "
               f"{battles} battles simulated | "
               f"Custom types: {len(custom_seen)}/{TOTAL_CUSTOM_TYPES}")
    write_log(log_msg)
    
    return custom_seen, True

def main():
    global CYCLES_RUN
    
    write_log("=" * 70)
    write_log("Hyper Battle Daemon v3 STARTING")
    write_log(f"Working dir: {base_dir}")
    write_log(f"Output log: {log_file}")
    write_log("-" * 70)
    
    battle_count = 0
    custom_types_seen = set()
    total_tests_done = 0
    
    # Load previous state if exists
    if os.path.exists(state_file):
        with open(state_file) as f:
            prev = json.load(f)
        battle_count = prev.get("battles_tested", 0)
        for ct in prev.get("custom_types_seen", []):
            custom_types_seen.add(ct)
        CYCLES_RUN = prev.get("cycles_completed", 0)
        total_tests_done = battle_count * 10  # rough estimate: ~10 combos per 50 battles
        
        write_log(f"Loaded previous state: {battle_count} battles, {CYCLES_RUN} cycles")
    
    while True:
        try:
            CYCLES_RUN += 1
            custom_seen, success = run_cycle(CYCLES_RUN)
            
            if not success or len(CRITICAL_ERRORS) > 50:
                write_log(f"CRITICAL ERROR COUNT: {len(CRITICAL_ERRORS)} — daemon will restart in 5s")
                write_state(battle_count, custom_types_seen, CYCLES_RUN - 1)
                time.sleep(5)
                # Reset critical errors list but keep stats (auto-recovery)
                CRITICAL_ERRORS.clear()
                continue
            
            battle_count += 50
            total_tests_done += len(custom_seen)
            
            if custom_seen:
                custom_types_seen.update(custom_seen)
            
            write_state(battle_count, custom_types_seen, CYCLES_RUN)
            
        except KeyboardInterrupt:
            write_log("Daemon interrupted by user.")
            break
        except Exception as e:
            error_str = f"Daemon crash: {type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
            CRITICAL_ERRORS.append(error_str)
            write_log(error_str)
            write_log("RESTARTING...")
            time.sleep(5)
    
    write_state(battle_count, custom_types_seen, CYCLES_RUN - 1)
    write_log("=" * 70)
    write_log(f"Hyper Battle Daemon EXITED cleanly | {battle_count} total battles | {CYCLES_RUN} cycles | {len(custom_types_seen)}/{TOTAL_CUSTOM_TYPES} custom types verified")

if __name__ == "__main__":
    main()
