"""
Live-probe the deployed backend on the Pi for Royjibiv's Spectrum + Prism Beam.

Uploads the local test-royjibiv.js harness and runs it against the Pi's
installed engine, so the exact battle behaviour players will see is verified.
"""
from __future__ import annotations

import sys

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "192.168.10.117"
USER = "randl"
PASSWORD = "shark55"

LOCAL_TEST = r"D:\GitHub\pokettrpg\pokemonttrpg-backend\test-royjibiv.js"
# Must live INSIDE the backend dir on the Pi so require('pokemon-showdown')
# resolves against its node_modules (node resolves from the script's dir).
REMOTE_TEST = "/home/randl/pokettrpg/pokemonttrpg-backend/test-royjibiv-live.js"


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    sftp = ssh.open_sftp()
    sftp.put(LOCAL_TEST, REMOTE_TEST)
    sftp.close()

    # The local harness requires('./dist/sync-ps-engine') relative paths — run
    # from the backend dir on the Pi so both pokemon-showdown and the engine resolve.
    _, stdout, stderr = ssh.exec_command(
        f"cd /home/randl/pokettrpg/pokemonttrpg-backend && node {REMOTE_TEST}",
        timeout=120,
    )
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    # Show only the harness's own report lines (drop engine boot logs)
    for line in out.splitlines():
        if line.startswith(("[dex]", "[battle]", "  beam line", "  effectiveness", "DONE")):
            print(line)
    if err.strip():
        print("[stderr]", err[:500])
    ssh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
