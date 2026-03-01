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

## 2) Pi backend + storage setup (`192.168.1.251`)

SSH to Pi and run this full block exactly:

```bash
sudo apt update && sudo apt install -y git curl build-essential pkg-config libssl-dev caddy
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

cd ~
if [ ! -d ~/pokettrpg ]; then
  git clone https://github.com/Rand-ludtke/pokettrpg.git ~/pokettrpg
fi

mkdir -p ~/pokettrpg/.fusion-sprites-local
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
User=pi
WorkingDirectory=/home/pi/pokettrpg/pokemonttrpg-backend
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=FUSION_SPRITES_DIR=/home/pi/pokettrpg/.fusion-sprites-local
Environment=UNIFIED_SPRITES_ROOT=/home/pi/pokettrpg/.fusion-sprites-local/sprites
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

## 3) Caddy + HTTPS on Pi

Run on Pi:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
pokettrpg.duckdns.org {
    reverse_proxy 127.0.0.1:3000

    header {
        Access-Control-Allow-Origin *
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
        Access-Control-Allow-Headers "Content-Type, Authorization"
    }
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

## 4) App client setting

In Tauri app Lobby on your client machine, set:

`https://pokettrpg.duckdns.org`

This makes the app use Pi backend endpoints:

- `/fusion/variants`
- `/fusion/sprites`
- `/fusion/generate` (proxied by Pi to worker `192.168.1.17`)

---

## 5) Destructive regenerate on worker (Sage 2-way + triple + SDXL 10-batch)

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

## 6) Sync worker sprites to Pi storage

Run in **Git Bash** on worker (recommended for rsync):

```bash
cd /d/GitHub/pokettrpg
rsync -av --progress \
  "/d/GitHub/pokettrpg/.fusion-sprites-local/" \
  pi@192.168.1.251:"/home/pi/pokettrpg/.fusion-sprites-local/"
ssh pi@192.168.1.251 "sudo systemctl restart pokettrpg-backend && sudo systemctl status pokettrpg-backend --no-pager"
```

---

## 7) Quick verification

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
