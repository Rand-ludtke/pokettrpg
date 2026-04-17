# Raspberry Pi Quick Setup (Pi backend/storage + Windows worker on-demand)

This is the exact copy/paste setup for your network:

- Pi backend + sprite storage: `192.168.1.251`
- Worker (this Windows PC) on-demand generator: `192.168.1.17`
- Repo path on worker: `D:\GitHub\pokettrpg`
- Canonical fusion storage: `.fusion-sprites-local`

---

## 1) Worker setup (Windows PC `192.168.1.17`)

Run in **PowerShell** on this PC:

```powershell
cd D:\GitHub\pokettrpg
& .\.venv\Scripts\Activate.ps1
python -m pip install -U numpy Pillow scikit-learn scipy diffusers==0.36.0 transformers==4.49.0 accelerate safetensors
python -m pip install --upgrade --index-url https://download.pytorch.org/whl/cu128 torch torchvision torchaudio
```

Allow inbound TCP 3000 on Windows Firewall (run once, admin PowerShell):

```powershell
New-NetFirewallRule -DisplayName "PokeTTRPG Worker 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Start worker backend (leave this terminal running):

```powershell
cd D:\GitHub\pokettrpg\pokemonttrpg-backend
$env:NODE_ENV="production"
$env:PORT="3000"
$env:FUSION_SPRITES_DIR="D:\GitHub\pokettrpg\.fusion-sprites-local"
npm ci
npm run build
npm run start:server
```

---

## 2) Pi base setup (`192.168.1.251`)

SSH to Pi and run this full block exactly (no GitHub clone):

```bash
sudo apt update && sudo apt install -y git curl build-essential pkg-config libssl-dev caddy
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

mkdir -p ~/pokettrpg
mkdir -p ~/pokettrpg/.fusion-sprites-local
```

## 3) Copy project files from this Windows PC to Pi (no GitHub)

Run in **Git Bash on this PC** (`192.168.1.17`):

```bash
cd /d/GitHub/pokettrpg
rsync -av --delete --progress \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.venv' \
  --exclude 'dist' \
  --exclude 'target' \
  --exclude '.fusion-sprites-local' \
  --exclude 'OneTrainer' \
  --exclude '.hf_cache' \
  /d/GitHub/pokettrpg/ \
  randl@192.168.1.251:/home/randl/pokettrpg/
ssh randl@192.168.1.251 "cd ~/pokettrpg/pokemonttrpg-backend && npm ci && npm run build && sudo systemctl restart pokettrpg-backend && sudo systemctl status pokettrpg-backend --no-pager"
rsync -av --progress \
  "/d/GitHub/pokettrpg/.fusion-sprites-local/" \
  randl@192.168.1.251:"/home/randl/pokettrpg/.fusion-sprites-local/"
ssh randl@192.168.1.251 "sudo systemctl restart pokettrpg-backend && sudo systemctl status pokettrpg-backend --no-pager"
```

Then on **Pi**:

```bash
cd ~/pokettrpg/pokemonttrpg-backend
npm ci
npm run build

sudo tee /etc/systemd/system/pokettrpg-backend.service > /dev/null <<'EOF'
[Unit]
Description=PokeTTRPG Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=randl
WorkingDirectory=/home/randl/pokettrpg/pokemonttrpg-backend
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=FUSION_SPRITES_DIR=/home/randl/pokettrpg/.fusion-sprites-local
Environment=UNIFIED_SPRITES_ROOT=/home/randl/pokettrpg/.fusion-sprites-local/sprites
Environment=FUSION_GEN_REMOTE_BASE=http://192.168.1.17:3000
ExecStart=/usr/bin/npm run start:server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pokettrpg-backend
sudo systemctl status pokettrpg-backend --no-pager
```

---

## 4) Caddy + HTTPS on Pi

Run on Pi:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
pokettrpg.duckdns.org {
    reverse_proxy 127.0.0.1:3000
}

:80 {
    redir https://{host}{uri} permanent
}
EOF

sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
curl -I https://pokettrpg.duckdns.org/
curl https://pokettrpg.duckdns.org/api/health
```

---

## 5) App client setting

In Tauri app Lobby on your client machine, set:

`https://pokettrpg.duckdns.org`

This makes the app use Pi backend endpoints:

- `/fusion/variants`
- `/fusion/sprites`
- `/fusion/generate` (proxied by Pi to worker `192.168.1.17`)

---

## 6) Destructive regenerate on worker (Sage 2-way + triple + SDXL 10-batch)

Run in **PowerShell** on worker (`D:\GitHub\pokettrpg`):

```powershell
cd D:\GitHub\pokettrpg
& .\.venv\Scripts\Activate.ps1

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "backup-fusions\\$ts"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
if (Test-Path "tauri-app/public/spliced-sprites") { Move-Item "tauri-app/public/spliced-sprites" "$backup/spliced-sprites" }
if (Test-Path "tauri-app/public/triple-fusions") { Move-Item "tauri-app/public/triple-fusions" "$backup/triple-fusions" }
New-Item -ItemType Directory -Force -Path "tauri-app/public/spliced-sprites" | Out-Null
New-Item -ItemType Directory -Force -Path "tauri-app/public/triple-fusions" | Out-Null

python scripts/generate_sage_spliced_fusions.py
python scripts/generate_triple_fusions.py

$label = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path ".fusion-sprites-local/generated/sage-2way/$label" | Out-Null
New-Item -ItemType Directory -Force -Path ".fusion-sprites-local/generated/triple-fusions/$label" | Out-Null
robocopy "tauri-app/public/spliced-sprites" ".fusion-sprites-local/generated/sage-2way/$label" *.png /E /R:1 /W:1 | Out-Null
robocopy "tauri-app/public/triple-fusions" ".fusion-sprites-local/generated/triple-fusions/$label" *.png /E /R:1 /W:1 | Out-Null

Get-ChildItem "tauri-app/public/spliced-sprites" -Filter *.png -File | ForEach-Object { Copy-Item $_.FullName ".fusion-sprites-local" -Force }

python scripts/build_sage_manifest.py
python scripts/runpod_fusion_batch.py generate --manifest pairs_manifest_sage_only.json --output .fusion-sprites-local/generated/sage-sdxl/$label --batch-size 10 --gpus 1
```

If VRAM OOM happens, rerun last command with `--batch-size 8` (then `6` if needed).

This Sage/triple flow does **not** delete or overwrite your existing large `.fusion-sprites-local` corpus.

---

## 7) Sync worker sprites to Pi storage

### One-time full sync (Git Bash on worker):

```bash
cd /d/GitHub/pokettrpg
rsync -av --progress \
  "/d/GitHub/pokettrpg/.fusion-sprites-local/" \
  randl@192.168.1.251:"/home/randl/pokettrpg/.fusion-sprites-local/"
ssh randl@192.168.1.251 "sudo systemctl restart pokettrpg-backend && sudo systemctl status pokettrpg-backend --no-pager"
```

### Continuous real-time sync (RECOMMENDED — keeps Pi always up to date):

**PowerShell (fastest on Windows):**
```powershell
cd D:\GitHub\pokettrpg
.\scripts\fusion-watch-sync.ps1
```

**Git Bash alternative:**
```bash
cd /d/GitHub/pokettrpg
bash scripts/fusion-watch-sync.sh
```

Both scripts watch `.fusion-sprites-local` for new/changed sprite files and push
**only** the changed files to the Pi within seconds. Much faster than re-scanning
the entire tree with `rsync -av`.

Leave the script running in a terminal while generating sprites. It auto-syncs
every 3 seconds when changes are detected. For initial run it does one full
incremental sync (`--update` flag = only newer files), then switches to watching.

---

## 8) Quick verification

Run on Pi:

```bash
curl "https://pokettrpg.duckdns.org/fusion/variants/1/4"
curl "https://pokettrpg.duckdns.org/fusion/gen-check/1/4"
```

Run on worker:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1'} | Select-Object IPAddress,InterfaceAlias
```

---

## Notes

- Do not use the legacy Electron `app/` folder.
- Run only `tauri-app` + `pokemonttrpg-backend`.
- Backend `/sprites` now uses a single on-disk root (`.fusion-sprites-local/sprites`), auto-caches sprites there, and prefers Full Pack numeric base sprites (`Other/BaseSprites`) when available.
- Tauri app sprite selection now downloads selected sprite assets into local custom storage, so chosen sprites are persisted in the physical app profile.
- Keep `FUSION_SPRITES_EXTRA_DIRS` unset for normal one-root operation.
- Only set `FUSION_SPRITES_EXTRA_DIRS` temporarily during migration if you must read legacy roots directly (colon-separated on Linux).
