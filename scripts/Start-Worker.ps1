# PokeTTRPG Worker Auto-Start Script
# Place a shortcut to this file in shell:startup to run on login.
#
#   To create the shortcut (run once in PowerShell):
#     $ws = (New-Object -ComObject WScript.Shell)
#     $sc = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\PokeTTRPG-Worker.lnk")
#     $sc.TargetPath = "pwsh.exe"
#     $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"D:\GitHub\pokettrpg\scripts\Start-Worker.ps1`""
#     $sc.WorkingDirectory = "D:\GitHub\pokettrpg\pokemonttrpg-backend"
#     $sc.Save()

$RepoRoot   = "D:\GitHub\pokettrpg"
$BackendDir = Join-Path $RepoRoot "pokemonttrpg-backend"

# Environment
$env:NODE_ENV           = "production"
$env:PORT               = "3000"
$env:FUSION_SPRITES_DIR = Join-Path $RepoRoot ".fusion-sprites-local"
$env:UNIFIED_SPRITES_ROOT = Join-Path $RepoRoot ".fusion-sprites-local\sprites"

# Fusion generation config
$env:FUSION_GEN_SCRIPTS     = Join-Path $RepoRoot "scripts"
$env:FUSION_GEN_BASE_SPRITES = Join-Path $RepoRoot ".fusion-sprites-local\Other\BaseSprites"
$env:FUSION_GEN_MODE        = "ai"
$env:FUSION_GEN_PYTHON      = "python"

Set-Location $BackendDir

# Ensure dependencies are installed (tsc lives in node_modules/.bin)
if (-not (Test-Path (Join-Path $BackendDir "node_modules\.bin\tsc.cmd"))) {
    Write-Host "[Worker] Installing dependencies..." -ForegroundColor Cyan
    npm ci
}

# Build only if dist/ is missing or older than src/
$distIndex = Join-Path $BackendDir "dist\server\index.js"
$srcDir    = Join-Path $BackendDir "src"
$needsBuild = (-not (Test-Path $distIndex)) -or
              ((Get-Item $distIndex).LastWriteTime -lt (Get-ChildItem $srcDir -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime)

if ($needsBuild) {
    Write-Host "[Worker] Building backend..." -ForegroundColor Cyan
    npx tsc -p tsconfig.json
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Worker] Build failed — exiting." -ForegroundColor Red
        Start-Sleep 10
        exit 1
    }
}

Write-Host "[Worker] Starting PokeTTRPG backend on port $env:PORT..." -ForegroundColor Green
node dist/server/index.js
