param(
  [int]$Port = 3000,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$SpritesDir = "",
  [string]$BaseSpritesDir = "",
  [string]$PythonBin = "python",
  [ValidateSet("ai", "splice", "splice+ai")][string]$Mode = "ai",
  [int]$Workers = 2,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$backendDir = Join-Path $RepoRoot "pokemonttrpg-backend"
$scriptsDir = Join-Path $RepoRoot "scripts"

if (-not (Test-Path $backendDir)) {
  throw "Backend folder not found: $backendDir"
}
if (-not (Test-Path $scriptsDir)) {
  throw "Scripts folder not found: $scriptsDir"
}

if ([string]::IsNullOrWhiteSpace($SpritesDir)) {
  $SpritesDir = Join-Path $RepoRoot ".fusion-sprites-local"
}

if ([string]::IsNullOrWhiteSpace($BaseSpritesDir)) {
  $packCandidate = Join-Path $RepoRoot "Full Sprite pack 1-121 (December 2025)\sprites"
  if (Test-Path $packCandidate) {
    $BaseSpritesDir = $packCandidate
  } else {
    $fallback = Join-Path $RepoRoot "tauri-app\public\vendor\showdown\sprites\gen5"
    if (Test-Path $fallback) {
      $BaseSpritesDir = $fallback
    } else {
      throw "Could not find base sprites. Set -BaseSpritesDir explicitly."
    }
  }
}

# Prefer the repo venv python when available (has fusion deps like numpy/torch),
# unless caller explicitly passed a different -PythonBin.
if ($PythonBin -eq "python") {
  $venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
  if (Test-Path $venvPython) {
    $PythonBin = $venvPython
  }
}

if (-not (Get-Command $PythonBin -ErrorAction SilentlyContinue)) {
  throw "Python executable not found: $PythonBin"
}

New-Item -ItemType Directory -Force -Path $SpritesDir | Out-Null
$spritesRoot = Resolve-Path $SpritesDir
$baseSpritesRoot = Resolve-Path $BaseSpritesDir
$scriptsRoot = Resolve-Path $scriptsDir

$env:NODE_ENV = "production"
$env:PORT = [string]$Port
$env:FUSION_SPRITES_DIR = $spritesRoot.Path
$env:UNIFIED_SPRITES_ROOT = (Join-Path $spritesRoot.Path "sprites")
$env:FUSION_GEN_SCRIPTS = $scriptsRoot.Path
$env:FUSION_GEN_BASE_SPRITES = $baseSpritesRoot.Path
$env:FUSION_GEN_PYTHON = $PythonBin
$env:FUSION_GEN_MODE = $Mode
$env:FUSION_GEN_WORKERS = [string]$Workers
$env:FUSION_GEN_REMOTE_BASE = ""

Write-Host "[Worker] Repo root: $RepoRoot"
Write-Host "[Worker] Backend: $backendDir"
Write-Host "[Worker] Port: $($env:PORT)"
Write-Host "[Worker] Sprites: $($env:FUSION_SPRITES_DIR)"
Write-Host "[Worker] Base sprites: $($env:FUSION_GEN_BASE_SPRITES)"
Write-Host "[Worker] Scripts: $($env:FUSION_GEN_SCRIPTS)"
Write-Host "[Worker] Fusion mode: $($env:FUSION_GEN_MODE) workers=$($env:FUSION_GEN_WORKERS)"

Push-Location $backendDir
try {
  if (-not $SkipInstall) {
    npm ci
  }
  npm run build
  npm run start:server
} finally {
  Pop-Location
}
