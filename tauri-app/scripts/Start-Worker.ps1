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

$target = Join-Path $PSScriptRoot "start-fusion-worker.ps1"
if (-not (Test-Path $target)) {
  throw "Expected worker script not found: $target"
}

# Backward-compatible entry point expected by older docs/scripts.
& $target @PSBoundParameters
