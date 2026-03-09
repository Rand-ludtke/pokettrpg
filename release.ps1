Param(
	[string]$Version,
	[switch]$NoWait
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[i] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[x] $msg" -ForegroundColor Red }

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $RepoRoot 'tauri-app'
$TauriConfPath = Join-Path $AppDir 'src-tauri\tauri.conf.json'
$PkgPath = Join-Path $AppDir 'package.json'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
	Write-Err 'GitHub CLI (gh) is required. Install from https://cli.github.com and login with: gh auth login'
	exit 1
}

if (-not (Test-Path $PkgPath)) {
	Write-Err "Missing $PkgPath"
	exit 1
}
if (-not (Test-Path $TauriConfPath)) {
	Write-Err "Missing $TauriConfPath"
	exit 1
}

$pkg = Get-Content -Raw -Path $PkgPath | ConvertFrom-Json
$tauriConf = Get-Content -Raw -Path $TauriConfPath | ConvertFrom-Json

if (-not $Version) {
	$cur = [version]$pkg.version
	$Version = "{0}.{1}.{2}" -f $cur.Major, $cur.Minor, ($cur.Build + 1)
	Write-Info "No -Version specified; bumping patch: $($pkg.version) -> $Version"
}
else {
	Write-Info "Using provided version: $Version"
}

if ($pkg.version -ne $Version) {
	$pkg.version = $Version
	($pkg | ConvertTo-Json -Depth 20) | Set-Content -NoNewline -Path $PkgPath
	Write-Ok "Updated tauri-app/package.json version to $Version"
}
else {
	Write-Info "tauri-app/package.json already at $Version"
}

if ($tauriConf.version -ne $Version) {
	$tauriConf.version = $Version
	($tauriConf | ConvertTo-Json -Depth 20) | Set-Content -NoNewline -Path $TauriConfPath
	Write-Ok "Updated tauri-app/src-tauri/tauri.conf.json version to $Version"
}
else {
	Write-Info "tauri-app/src-tauri/tauri.conf.json already at $Version"
}

Set-Location $AppDir

Write-Info 'Installing/refreshing npm deps (tauri-app)'
npm install

Write-Info 'Building Windows installers locally with Tauri (nsis,msi)'
npm run tauri:build -- --bundles nsis,msi

$bundleRoot = Join-Path $AppDir 'src-tauri\target\release\bundle'
$nsisDir = Join-Path $bundleRoot 'nsis'
$msiDir = Join-Path $bundleRoot 'msi'

$exe = Get-ChildItem -Path $nsisDir -Filter "*_${Version}_x64-setup.exe" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) {
	$exe = Get-ChildItem -Path $nsisDir -Filter '*.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
$msi = Get-ChildItem -Path $msiDir -Filter "*_${Version}_x64_*.msi" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msi) {
	$msi = Get-ChildItem -Path $msiDir -Filter '*.msi' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if (-not $exe) { Write-Err "No NSIS .exe found in $nsisDir"; exit 1 }
if (-not $msi) { Write-Err "No MSI .msi found in $msiDir"; exit 1 }

Write-Ok "Windows artifacts ready (`n  exe: $($exe.Name)`n  msi: $($msi.Name))"

$tag = "v$Version"
Write-Info "Ensuring GitHub release $tag exists"
& gh release view $tag 1>$null 2>$null
$releaseExists = ($LASTEXITCODE -eq 0)

if (-not $releaseExists) {
	$targetRef = 'main'
	& gh release create $tag -t "Pokettrpg $Version" -n "Tauri desktop release ($Version)." --target $targetRef
	if ($LASTEXITCODE -ne 0) { Write-Err "Failed to create release $tag"; exit 1 }
	Write-Ok "Created release $tag"
}

Write-Info 'Uploading Windows artifacts to release'
& gh release upload $tag (Resolve-Path $exe.FullName).Path (Resolve-Path $msi.FullName).Path --clobber
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to upload Windows artifacts to $tag"; exit 1 }
Write-Ok 'Windows artifacts uploaded'

Write-Info 'Triggering mac GitHub Action (release.yml)'
& gh workflow run 'release.yml' -f "release_tag=$tag"
if ($LASTEXITCODE -ne 0) {
	Write-Warn 'Failed to trigger release.yml via release_tag input; retrying with --ref main'
	& gh workflow run 'release.yml' --ref 'main' -f "release_tag=$tag"
}

if ($LASTEXITCODE -eq 0) {
	if (-not $NoWait) {
		Write-Info 'Waiting for latest workflow run to finish...'
		& gh run watch --last
	}
	Write-Ok 'macOS GitHub Action triggered'
}
else {
	Write-Warn 'Could not trigger macOS workflow. Run manually in Actions: Release Tauri Desktop Apps'
}

Write-Info 'Release assets:'
& gh release view $tag --json assets -q ".assets[].name"
if ($LASTEXITCODE -ne 0) { Write-Warn "Could not list assets for $tag." }

Write-Ok "Done. Tauri release $tag prepared (Windows local + mac via GitHub Action)."