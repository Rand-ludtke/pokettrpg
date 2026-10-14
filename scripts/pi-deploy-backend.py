"""
Deploy the updated battle engine (dist/sync-ps-engine.js) to the Pi backend.

Steps:
  1. Probe the Pi: deployed engine hash, tauri-app/public/data presence, dex payload dirs.
  2. Upload dist/sync-ps-engine.js via SFTP.
  3. Upload any missing data pack dirs the loader needs (pokeathlon override pack etc.).
  4. Restart pokettrpg-backend (sudo systemctl).
  5. Verify: health endpoint + journal shows the new loader lines.
"""
from __future__ import annotations

import hashlib
import os
import sys
import time

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "192.168.10.117"
USER = "randl"
PASSWORD = "shark55"

LOCAL_ENGINE = r"D:\GitHub\pokettrpg\pokemonttrpg-backend\dist\sync-ps-engine.js"
REMOTE_ENGINE = "/home/randl/pokettrpg/pokemonttrpg-backend/dist/sync-ps-engine.js"
LOCAL_SERVER = r"D:\GitHub\pokettrpg\pokemonttrpg-backend\dist\server\index.js"
REMOTE_SERVER = "/home/randl/pokettrpg/pokemonttrpg-backend/dist/server/index.js"
# Loader baseRoots on the Pi resolve to these (relative to dist/ and cwd):
REMOTE_DATA_ROOTS = [
    "/home/randl/pokettrpg/tauri-app/public/data",
]
# Override packs the fixed loader needs on the Pi (relative to data root):
REQUIRED_PACKS = [
    ("custom-overrides/generated", ["extra-pokemon.json", "moves.extra-pokemon.json"]),
    ("pokeathlon/generated", ["pokedex.pokeathlon.json"]),
    ("sage/generated", ["moves.custom.sage.json"]),
]

LOCAL_DATA_ROOT = r"D:\GitHub\pokettrpg\tauri-app\public\data"


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 30) -> str:
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    return (out + ("\n[stderr] " + err if err else ""))


def main() -> int:
    local_hash = sha256_of(LOCAL_ENGINE)
    print(f"[local] engine sha256 = {local_hash[:16]}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    print(f"[pi] connected to {HOST}")

    # ── 1. Probe ────────────────────────────────────────────────────────────
    remote_hash = run(ssh, f"sha256sum {REMOTE_ENGINE} 2>/dev/null | cut -d' ' -f1")
    print(f"[pi] deployed engine sha256 = {remote_hash[:16] if remote_hash else 'NONE'}...")
    remote_server_hash = run(ssh, f"sha256sum {REMOTE_SERVER} 2>/dev/null | cut -d' ' -f1")
    print(f"[pi] deployed server sha256 = {remote_server_hash[:16] if remote_server_hash else 'NONE'}...")
    if remote_hash == local_hash:
        print("[pi] engine already up to date — will still verify packs + restart")

    data_root = None
    for candidate in REMOTE_DATA_ROOTS:
        if run(ssh, f"[ -d {candidate} ] && echo yes").startswith("yes"):
            data_root = candidate
            break
    print(f"[pi] dex data root: {data_root or 'MISSING — will create under first candidate'}")
    data_root = data_root or REMOTE_DATA_ROOTS[0]

    missing: list[tuple[str, str, str]] = []  # (remote_dir, filename, local_path)
    for sub, files in REQUIRED_PACKS:
        for fn in files:
            remote_path = f"{data_root}/{sub}/{fn}"
            local_path = os.path.join(LOCAL_DATA_ROOT, *sub.split("/"), fn)
            remote_hash = run(ssh, f"sha256sum '{remote_path}' 2>/dev/null | cut -d' ' -f1")
            if not remote_hash or remote_hash != sha256_of(local_path):
                missing.append((f"{data_root}/{sub}", fn, local_path))
    if missing:
        print(f"[pi] missing data files: {[m[1] for m in missing]}")
    else:
        print("[pi] all override pack files already present")

    # ── 2-3. Upload ─────────────────────────────────────────────────────────
    sftp = ssh.open_sftp()
    run(ssh, f"mkdir -p /home/randl/pokettrpg/pokemonttrpg-backend/dist")
    sftp.put(LOCAL_ENGINE, REMOTE_ENGINE)
    print(f"[pi] uploaded engine ({REMOTE_ENGINE})")
    sftp.put(LOCAL_SERVER, REMOTE_SERVER)
    print(f"[pi] uploaded server ({REMOTE_SERVER})")

    for remote_dir, fn, local_path in missing:
        run(ssh, f"mkdir -p '{remote_dir}'")
        sftp.put(local_path, f"{remote_dir}/{fn}")
        print(f"[pi] uploaded {remote_dir}/{fn}")
    sftp.close()

    uploaded_hash = run(ssh, f"sha256sum {REMOTE_ENGINE} | cut -d' ' -f1")
    if uploaded_hash != local_hash:
        print("[!!] hash mismatch after upload — aborting restart")
        return 1
    uploaded_server_hash = run(ssh, f"sha256sum {REMOTE_SERVER} | cut -d' ' -f1")
    if uploaded_server_hash != sha256_of(LOCAL_SERVER):
        print("[!!] server hash mismatch after upload — aborting restart")
        return 1
    print("[pi] uploaded hashes verified")

    # ── 4. Restart service ──────────────────────────────────────────────────
    print("[pi] restarting pokettrpg-backend...")
    restart_out = run(ssh, f"echo {PASSWORD} | sudo -S systemctl restart pokettrpg-backend 2>&1 && sleep 3 && systemctl is-active pokettrpg-backend", timeout=60)
    print(f"[pi] service state: {restart_out}")

    # ── 5. Verify ───────────────────────────────────────────────────────────
    time.sleep(3)
    logs = run(ssh, "journalctl -u pokettrpg-backend --since '-60s' --no-pager | grep -E 'pokeathlon|soulstones-part1|custom-overrides|Move pack conflict|Loaded .* custom data' | tail -25")
    print("[pi] loader logs after restart:\n" + (logs or "(no matching lines yet)"))

    run(ssh, f"curl -s --max-time 5 http://127.0.0.1:3000/api/health", timeout=15)
    health = run(ssh, f"curl -s --max-time 5 http://127.0.0.1:3000/api/health")
    print(f"[pi] health: {health}")

    ssh.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
