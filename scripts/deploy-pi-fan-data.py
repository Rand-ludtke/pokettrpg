"""Sync fan-game custom data (infinity/uranium/mariomon/insurgence) to Pi
plus the patched dist/sync-ps-engine.js with corrected load order.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = "192.168.1.251"
USER = "randl"
PASSWORD = "shark55"

REPO_ROOT = Path(__file__).resolve().parents[1]
PI_ROOT = "/home/randl/pokettrpg"

# Files to upload: (local, remote)
SINGLE_FILES = [
    (
        REPO_ROOT / "pokemonttrpg-backend/dist/sync-ps-engine.js",
        f"{PI_ROOT}/pokemonttrpg-backend/dist/sync-ps-engine.js",
    ),
]

# For each fan-game, upload its moves/abilities/pokedex JSONs only (skip large
# learnsets files — those aren't consumed by the backend).
FAN_GAMES = ["infinity", "uranium", "mariomon", "insurgence"]
FAN_FILE_PATTERNS = ["moves.custom.{g}.json", "abilities.custom.{g}.json", "pokedex.{g}.json"]


def run(ssh: paramiko.SSHClient, cmd: str, *, sudo: bool = False) -> tuple[int, str, str]:
    if sudo:
        cmd = f"echo {PASSWORD} | sudo -S {cmd}"
    _, stdout, stderr = ssh.exec_command(cmd, timeout=180)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def upload(sftp, ssh, local: Path, remote: str) -> None:
    size = local.stat().st_size
    print(f"  {local.name} ({size/1024:.1f} KB) -> {remote}")
    run(ssh, f"mkdir -p {os.path.dirname(remote)}")
    sftp.put(str(local), remote)


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {USER}@{HOST}...")
    ssh.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    sftp = ssh.open_sftp()
    try:
        print("Uploading patched dist files...")
        for local, remote in SINGLE_FILES:
            if local.exists():
                upload(sftp, ssh, local, remote)
            else:
                print(f"  !! missing {local}")

        for game in FAN_GAMES:
            print(f"Uploading {game} fan-game data...")
            local_dir = REPO_ROOT / f"tauri-app/public/data/{game}/generated"
            remote_dir = f"{PI_ROOT}/tauri-app/public/data/{game}/generated"
            if not local_dir.exists():
                print(f"  !! missing local dir {local_dir}")
                continue
            for pattern in FAN_FILE_PATTERNS:
                fname = pattern.format(g=game)
                local = local_dir / fname
                if not local.exists():
                    print(f"  -- {fname} not present locally, skip")
                    continue
                upload(sftp, ssh, local, f"{remote_dir}/{fname}")
    finally:
        sftp.close()

    print("Restarting pokettrpg-backend...")
    code, out, err = run(ssh, "systemctl restart pokettrpg-backend", sudo=True)
    print(f"  exit={code}")

    print("Waiting briefly then dumping startup logs...")
    code, out, _ = run(ssh, "sleep 4 && echo shark55 | sudo -S journalctl -u pokettrpg-backend -n 30 --no-pager")
    sys.stdout.buffer.write(out.encode("utf-8", "replace"))
    sys.stdout.flush()

    ssh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
