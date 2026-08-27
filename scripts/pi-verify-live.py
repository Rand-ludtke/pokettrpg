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
console.log(out.join('\n'));
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
