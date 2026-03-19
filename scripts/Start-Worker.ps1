param(
  [int]$Port = 3000,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$SpritesDir = "",
  [string]$BaseSpritesDir = "",
  [string]$PythonBin = "python",
  [ValidateSet("ai", "splice", "splice+ai")][string]$Mode = "ai",
  [int]$Workers = 2,
  [switch]$SkipInstall,
  [switch]$SkipBuild
)

$target = Join-Path $RepoRoot "tauri-app\scripts\start-fusion-worker.ps1"
if (-not (Test-Path $target)) {
  throw "Expected worker script not found: $target"
}

# Backward-compatible root scripts entry point.
& $target @PSBoundParameters
