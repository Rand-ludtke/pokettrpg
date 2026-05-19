"""Deploy backend fixes to Pi (192.168.1.251).

Pushes the three patched files (and the canonical wylin customs JSON) to
/home/randl/pokettrpg/{pokemonttrpg-backend,tauri-app}/... and restarts the
pokettrpg-backend systemd service.
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

# (local_path, remote_path)
FILES = [
    (
        REPO_ROOT / "pokemonttrpg-backend/dist/sync-ps-engine.js",
        f"{PI_ROOT}/pokemonttrpg-backend/dist/sync-ps-engine.js",
    ),
    (
        REPO_ROOT / "pokemonttrpg-backend/dist/server/index.js",
        f"{PI_ROOT}/pokemonttrpg-backend/dist/server/index.js",
    ),
    (
        REPO_ROOT / "tauri-app/public/data/more-pokemon/generated/wylin-customs.generated.json",
        f"{PI_ROOT}/tauri-app/public/data/more-pokemon/generated/wylin-customs.generated.json",
    ),
]


def run(ssh: paramiko.SSHClient, cmd: str, *, sudo: bool = False) -> tuple[int, str, str]:
    if sudo:
        cmd = f"echo {PASSWORD} | sudo -S {cmd}"
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {USER}@{HOST}...")
    ssh.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    code, out, _ = run(ssh, "hostname; uname -m; ls -d /home/randl/pokettrpg")
    print(out.strip())

    sftp = ssh.open_sftp()
    try:
        for local, remote in FILES:
            if not local.exists():
                print(f"!! Local file missing, skipping: {local}")
                continue
            size = local.stat().st_size
            print(f"Uploading {local.name} ({size/1024:.1f} KB) -> {remote}")
            # Ensure remote dir exists
            run(ssh, f"mkdir -p {os.path.dirname(remote)}")
            sftp.put(str(local), remote)
    finally:
        sftp.close()

    print("Restarting pokettrpg-backend service...")
    code, out, err = run(ssh, "systemctl restart pokettrpg-backend", sudo=True)
    if code != 0:
        print(f"  restart exit={code}\n  stdout: {out}\n  stderr: {err}")
    else:
        print("  restart ok")

    print("Service status:")
    code, out, _ = run(ssh, "systemctl is-active pokettrpg-backend; systemctl status pokettrpg-backend --no-pager -n 20", sudo=True)
    print(out)

    print("Recent backend log:")
    code, out, _ = run(ssh, "journalctl -u pokettrpg-backend -n 40 --no-pager", sudo=True)
    print(out)

    ssh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
