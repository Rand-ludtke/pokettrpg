Param(
	[string]$Version,
	[switch]$NoWait
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[i] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[x] $msg" -ForegroundColor Red }

# Paths
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $RepoRoot 'app'
Set-Location $AppDir

# Ensure gh is available
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
	Write-Err 'GitHub CLI (gh) is required. Install from https://cli.github.com and login with: gh auth login'
	exit 1
}

# Read package.json and determine next version if not provided
$pkgPath = Join-Path $AppDir 'package.json'
$pkg = Get-Content -Raw -Path $pkgPath | ConvertFrom-Json
if (-not $Version) {
	$cur = [version]$pkg.version
	$Version = "{0}.{1}.{2}" -f $cur.Major, $cur.Minor, ($cur.Build + 1)
	Write-Info "No -Version specified; bumping patch: $($pkg.version) -> $Version"
}
else {
	Write-Info "Using provided version: $Version"
}

# Update package.json version if different
if ($pkg.version -ne $Version) {
	$pkg.version = $Version
	($pkg | ConvertTo-Json -Depth 20) | Set-Content -NoNewline -Path $pkgPath
	Write-Ok "Updated app/package.json version to $Version"
}
else {
	Write-Info "app/package.json already at $Version"
}

# Build web assets
Write-Info 'Building renderer (vite build)'
npm run -s build
Write-Ok 'Renderer built'

# Build Windows artifacts to a version-specific output folder to avoid locks
$outDir = "release-$Version"
Write-Info "Building Windows artifacts to $outDir"
# Provide GH_TOKEN to electron-builder so it can generate latest.yml and avoid publish errors
if (-not $env:GH_TOKEN) {
	try {
		$token = (gh auth token 2>$null)
		if ($LASTEXITCODE -eq 0 -and $token) { $env:GH_TOKEN = $token.Trim() }
	} catch {}
}
./node_modules/.bin/electron-builder -w --config.directories.output=$outDir | Write-Host

# Verify outputs
$exe = Join-Path $AppDir "$outDir/Pokettrpg-Setup-$Version.exe"
$zip = Join-Path $AppDir "$outDir/Pokettrpg-$Version-win.zip"
$block = Join-Path $AppDir "$outDir/Pokettrpg-Setup-$Version.exe.blockmap"
$latest = Join-Path $AppDir "$outDir/latest.yml"
foreach ($p in @($exe,$zip,$block)) { if (-not (Test-Path $p)) { Write-Err "Missing expected artifact: $p"; exit 1 } }
if (-not (Test-Path $latest)) { Write-Warn "latest.yml not found in $outDir; continuing without it." }
Write-Ok 'Windows artifacts ready'

# Create or update GitHub release
$tag = "v$Version"
Write-Info "Ensuring GitHub release $tag exists"
$releaseExists = $false
try {
	gh release view $tag | Out-Null
	$releaseExists = $true
} catch { $releaseExists = $false }

if (-not $releaseExists) {
	Write-Info 'Creating release with Windows assets'
	$args = @()
	if (Test-Path $latest) { $args += "$outDir/latest.yml" }
	$args += @(
		"$outDir/Pokettrpg-Setup-$Version.exe",
		"$outDir/Pokettrpg-Setup-$Version.exe.blockmap",
		"$outDir/Pokettrpg-$Version-win.zip"
	)
	gh release create $tag @args -t "Pokettrpg $Version" -n "Windows + mac (zip via workflow)." | Write-Host
}
else {
	Write-Info 'Release exists; uploading/updating Windows assets'
	$args = @()
	if (Test-Path $latest) { $args += "$outDir/latest.yml" }
	$args += @(
		"$outDir/Pokettrpg-Setup-$Version.exe",
		"$outDir/Pokettrpg-Setup-$Version.exe.blockmap",
		"$outDir/Pokettrpg-$Version-win.zip"
	)
	gh release upload $tag @args --clobber | Write-Host
}
Write-Ok 'Windows assets on release'

# Ensure mac workflow exists on remote; attempt to create/update using GH API
$wfLocal = Join-Path $RepoRoot '.github\workflows\release-mac.yml'
if (-not (Test-Path $wfLocal)) {
	Write-Warn 'Local mac workflow file not found; skipping CI setup.'
}
else {
	try {
		$wfContent = Get-Content -Raw -Path $wfLocal
		$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wfContent))
		Write-Info 'Ensuring mac workflow exists on remote (main)'
		$json = gh api -X GET "/repos/:owner/:repo/contents/.github/workflows/release-mac.yml?ref=main" | ConvertFrom-Json
		$sha = $json.sha
		Write-Info 'Workflow already present on remote; updating content'
		gh api -X PUT "/repos/:owner/:repo/contents/.github/workflows/release-mac.yml" `
			-f message="Update mac release workflow" `
			-f content=$b64 `
			-f sha=$sha `
			-f branch='main' | Out-Null
		Write-Ok 'Workflow updated on remote'
	}
	catch {
		try {
			Write-Info 'Creating mac workflow on remote (branch: main)'
			gh api -X PUT "/repos/:owner/:repo/contents/.github/workflows/release-mac.yml" `
				-f message="Add mac release workflow (CI auto-attach mac zip on release)" `
				-f content=$b64 `
				-f branch='main' | Out-Null
			Write-Ok 'Workflow created on remote'
		}
		catch {
			Write-Warn 'Could not create workflow on remote. Ensure gh has repo:contents write access: gh auth refresh -h github.com -s repo'
		}
	}
}

# Trigger mac workflow if available (retry with fallbacks on 422)
Write-Info 'Triggering mac workflow (workflow_dispatch)'
$triggered = $false

# Attempt 1: pass input tag_name
& gh workflow run 'release-mac.yml' -f "tag_name=$tag"
if ($LASTEXITCODE -eq 0) {
    $triggered = $true
} else {
    Write-Warn 'Dispatch with input tag_name failed; retrying with --ref only'
    # Attempt 2: no inputs, just ref
    & gh workflow run 'release-mac.yml' --ref "$tag"
    if ($LASTEXITCODE -eq 0) {
        $triggered = $true
    } else {
        Write-Warn 'Dispatch with --ref failed; retrying with input tag'
        # Attempt 3: alternate input name 'tag'
        & gh workflow run 'release-mac.yml' -f "tag=$tag"
        if ($LASTEXITCODE -eq 0) { $triggered = $true }
    }
}

if ($triggered) {
    if (-not $NoWait) {
        Write-Info 'Waiting for latest run to finish...'
        & gh run watch --last
    }
    Write-Ok 'Mac workflow triggered'
} else {
    Write-Warn 'Failed to trigger mac workflow. Verify it exists on GitHub and you have permission to trigger runs.'
}

# Show final assets
Write-Info 'Release assets:'
gh release view $tag --json assets -q ".assets[].name" | Write-Host

Write-Ok "Done. Release $tag prepared."
