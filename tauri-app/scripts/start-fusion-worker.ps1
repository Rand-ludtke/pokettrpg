param(
  [int]$Port = 3000,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$SpritesDir = "",
  [string]$BaseSpritesDir = "",
  [string]$PythonBin = "python",
  [ValidateSet("ai", "splice", "splice+ai")][string]$Mode = "ai",
  [int]$Workers = 2,
  [switch]$SkipInstall,
  [switch]$SkipBuild
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

# The on-demand generator is SDXL diffusers only.
if ($Mode -ne "ai") {
  Write-Warning "Requested mode '$Mode' is not supported by the SDXL worker; forcing mode 'ai'."
  $Mode = "ai"
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

Write-Host "[Worker] Running Python fusion environment self-check..."
$checkCode = @'
import sys
issues = []

try:
  import torch
except Exception as e:
  issues.append(f"torch import failed: {e}")
else:
  print(f"python={sys.version.split()[0]} torch={torch.__version__} cuda={torch.cuda.is_available()}")

try:
  import diffusers
except Exception as e:
  issues.append(f"diffusers import failed: {e}")
else:
  print(f"diffusers={diffusers.__version__}")

try:
  import transformers
except Exception as e:
  issues.append(f"transformers import failed: {e}")
else:
  print(f"transformers={transformers.__version__}")
  major = int(str(transformers.__version__).split('.')[0])
  if major >= 5:
    issues.append("transformers>=5 detected; use transformers==4.49.0 for current diffusers pipeline compatibility")

try:
  from diffusers.pipelines.auto_pipeline import AutoPipelineForImage2Image, AutoPipelineForText2Image
  _ = (AutoPipelineForImage2Image, AutoPipelineForText2Image)
except Exception as e:
  issues.append(f"diffusers auto_pipeline import failed: {e}")

if issues:
  print("SELF_CHECK_ERRORS")
  for item in issues:
    print(item)
  sys.exit(2)

print("SELF_CHECK_OK")
'@

$checkOut = & $PythonBin -c $checkCode 2>&1
$checkText = ($checkOut | Out-String).Trim()
if ($checkText) { Write-Host $checkText }
if ($LASTEXITCODE -ne 0) {
  throw "Fusion environment self-check failed. Fix Python dependencies and retry."
}
Write-Host "[Worker] Self-check passed."

Push-Location $backendDir
try {
  if (-not $SkipInstall) {
    npm ci
  }
  if (-not $SkipBuild) {
    try {
      npm run build
    } catch {
      $distIndex = Join-Path $backendDir "dist\server\index.js"
      if (Test-Path $distIndex) {
        Write-Warning "Backend build failed, but existing dist found at $distIndex. Continuing startup with existing build output."
      } else {
        throw
      }
    }
  } else {
    Write-Host "[Worker] Skipping backend build (-SkipBuild)."
  }
  npm run start:server
} finally {
  Pop-Location
}
