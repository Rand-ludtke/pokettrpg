"""Verify the deployed backend on the Pi picked up the add-only-injection fix.

Checks:
  1. systemd service active
  2. on-Pi dex probe: vanilla moves still have priority/target/handlers
  3. live HTTP health endpoint
"""
from __future__ import annotations

import sys

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "192.168.10.117"
USER = "randl"
PASSWORD = "shark55"

PROBE_JS = r"""
const path = '/home/randl/pokettrpg/pokemonttrpg-backend/node_modules/pokemon-showdown';
const ps = require(path);
const Dex = ps.Dex;
// Force-load the data exactly like sync-ps-engine does is not needed here; instead
// require the deployed sync engine and inspect its injected registry indirectly via
// a battle-independent check: load SyncPSEngine and dump Dex after construction.
const mod = require('/home/randl/pokettrpg/pokemonttrpg-backend/dist/sync-ps-engine.js');
const Eng = mod.SyncPSEngine || mod.default || mod;
let eng = null;
try { eng = new Eng({ players: [], format: 'customgame' }); } catch (e) { console.log('construct-skip', e.message); }
const M = Dex.data.Moves, A = Dex.data.Abilities;
const out = [];
const mv = (id) => { const m = M[id]; return m ? { pri: m.priority|0, tgt: m.target||'?', flags: Object.keys(m.flags||{}).length, baseTarget:m.baseTarget } : null; };
out.push(['protect', 'stealthrock', 'stickyweb', 'leechseed', 'dragondance', 'machpunch', 'bulletpunch', 'extremespeed'].map(id => id + '=' + JSON.stringify(mv(id))).join(' | '));
out.push('destinybond-handler=' + (typeof (M['destinybond']||{}).onPrepareHit === 'function' || typeof (M['destinybond']||{}).beforeTurnCallback === 'function' ? 'yes' : JSON.stringify(Object.keys(M['destinybond']||{}))));
out.push('magicbounce-onTryHit=' + (typeof ((A['magicbounce']||{}).onTryHit) === 'function'));
out.push('sturdy-key=' + ('onAnyDamage' in (A['sturdy']||{}) || 'onTryHit' in (A['sturdy']||{}) ? 'yes' : Object.keys(A['sturdy']||{}).join(',')));
out.push(['nectartap','nagaskin','odetojoy'].map(id => id + '=heal:' + JSON.stringify((M[id]||{}).heal) + ' tgt:' + (M[id]&&M[id].target) + ' flags:' + JSON.stringify((M[id]||{}).flags)).join(' | '));
const bb = Dex.species.get('Boss Brolder'), mo = Dex.species.get('Mothim-Orion');
out.push('weights: bossbrolder=' + (bb && bb.exists ? bb.weightkg : 'MISSING') + ' mothimorion=' + (mo && mo.exists ? mo.weightkg : 'MISSING'));

// End-to-end battle probe: Boss Brolder Heat Crash vs Mothim-Orion on the Pi.
(async () => {
  try {
    const mk = (o) => Object.assign({ name:'Mon', species:'Mon', level:50, ability:'Immunity', item:'', nature:'Hardy', gender:'M', shiny:false, evs:{}, ivs:{}, moves:[] }, o);
    const eng2 = new Eng({ seed: [7,13,29,51], format: 'gen9customgame' });
    await eng2.initializeBattle([
      { id: 'p1', name: 'T1', team: [mk({ name:'Mothim-Orion', species:'Mothim-Orion', level:54, ability:'Attunement', item:'Flame Orb', moves:['stickyweb'] })], activeIndex: 0 },
      { id: 'p2', name: 'T2', team: [mk({ name:'Boss Brolder', species:'Boss Brolder', level:55, ability:'Steam Engine', moves:['heatcrash'] })], activeIndex: 0 },
    ], { seed: [7,13,29,51], autoTeamPreview: true });
    eng2.processTurn([
      { type: 'move', actorPlayerId: 'p1', playerId: 'p1', pokemonId: 'mothimorion', moveId: 'stickyweb' },
      { type: 'move', actorPlayerId: 'p2', playerId: 'p2', pokemonId: 'bossbrolder', moveId: 'heatcrash' },
    ]);
    const log = eng2.getState().log || [];
    const bp = log.find(l => l.includes('|debug|BP:'));
    const dmg = log.find(l => l.startsWith('|-damage|p1a: Mothim-Orion|'));
    out.push('battle: ' + (bp ? bp.trim() : 'NO-BP-LINE') + ' | ' + (dmg ? dmg.trim() : 'NO-DMG-LINE'));
    const nan = log.find(l => /NaN|undefined/.test(l));
    if (nan) out.push('battle-NAN-LINE: ' + nan);
  } catch (e) { out.push('battle-error: ' + (e && e.message)); }
  console.log(out.join('\n'));
})();

"""


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 120):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    code, out, _ = run(ssh, "systemctl is-active pokettrpg-backend; systemctl show -p ActiveEnterTimestamp --value pokettrpg-backend")
    print("[service]", out.strip().replace("\n", " since "))

    # Write probe to remote /tmp and execute with the backend's node_modules
    sftp = ssh.open_sftp()
    with sftp.open("/tmp/pi-dex-probe.js", "w") as f:
        f.write(PROBE_JS)
    sftp.close()
    code, out, err = run(ssh, "cd /home/randl/pokettrpg/pokemonttrpg-backend && node /tmp/pi-dex-probe.js", timeout=180)
    print("[dex-probe]\n" + (out or "").strip())
    if err.strip():
        print("[probe stderr]\n" + err.strip()[:2000])

    code, out, _ = run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/health || curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/")
    print("[http-health]", out.strip())

    ssh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
