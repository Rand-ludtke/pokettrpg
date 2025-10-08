param(
	[string]$Version,
	[switch]$NoTag,
	[switch]$NoPush,
	[switch]$LocalOnly,
	[switch]$NoUpdate
)

# Usage:
#   ./release.ps1 -Version 1.0.1          # bump version, commit, tag v1.0.1, push tags (triggers CI Win+Mac builds)
#   ./release.ps1 -Version 1.0.1 -LocalOnly # bump + local Windows build only, do not push
#   ./release.ps1 -Version 1.0.1 -NoUpdate  # bump but disable updater for packaged run
#   ./release.ps1 -Version 1.0.1 -NoTag -NoPush # bump and commit without tagging/pushing (useful for quick bugfix without publishing)

$ErrorActionPreference = 'Stop'

function Update-PackageJsonVersion($path, $version) {
	$json = Get-Content -Raw -Path $path | ConvertFrom-Json
	$json.version = $version
	($json | ConvertTo-Json -Depth 20) | Set-Content -Path $path -Encoding UTF8
}

# Ensure we're at repo root
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

# 1) Bump version in app/package.json if provided
if ($Version) {
	Write-Host "Bumping version to $Version"
	Update-PackageJsonVersion -path "app/package.json" -version $Version
	git add app/package.json
	git commit -m "chore(release): bump to $Version" | Out-Null
}

# 2) Optional tag
if (-not $NoTag -and $Version) {
	$tag = "v$Version"
	git tag $tag -f
}

# 3) Local builds
Set-Location app
npm ci
$env:POKETTRPG_DISABLE_UPDATER = $(if ($NoUpdate) { '1' } else { $env:POKETTRPG_DISABLE_UPDATER })

if ($LocalOnly) {
	Write-Host "Building Windows (local, unsigned)"
	npm run electron:make
	Write-Host "Building macOS (local, unsigned)"
	npx electron-builder -m
	Set-Location $repoRoot
	if (-not $NoTag -and $Version -and -not $NoPush) {
		git push origin main --tags
	}
	exit 0
}

# 4) Push and publish
Set-Location $repoRoot
if (-not $NoPush) {
	git push origin main
	if (-not $NoTag -and $Version) {
		git push origin refs/tags/v$Version --force
	} elseif ($Version) {
		git push origin --tags
	}
}

Write-Host "Done. CI will publish Windows and macOS artifacts to GitHub Releases when tag is pushed."

