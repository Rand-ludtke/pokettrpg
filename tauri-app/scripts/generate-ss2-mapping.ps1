#!/usr/bin/env pwsh
# Generate PS2 PBS to Orion/Templeton mapping data

$ErrorActionPreference = "Stop"

# Paths
$pokedexPath = "tauri-app/public/data/pokeathlon/generated/pokedex.pokeathlon.json"
$ps2PokemonPath = "C:\Users\Rand L\Downloads\SS2 Latest Patch - v2.05\PBS\pokemon.txt"
$outputDir = "tauri-app/public/data/ss2-patch/generated"

# Ensure output directory exists
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

Write-Host "Loading Orion/Templeton pokedex..."
$jsonContent = Get-Content $pokedexPath -Raw
$pokemonDex = $jsonContent | ConvertFrom-Json

Write-Host "Parsing PS2 PBS pokemon.txt..."
$content = Get-Content $ps2PokemonPath -Raw
$lines = $content.Split([Environment]::NewLine)

# Parse PS2 PBS data
$ps2Data = @{}
for ($i=0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '^\[(.*?)\]$') {
        $name = $matches[1]
        $types = $null
        for ($j=$i+1; $j -lt [Math]::Min($i+20, $lines.Length); $j++) {
            if ($lines[$j] -match '^Types\s*=\s*(.*)$') {
                $types = $matches[1]
                break
            }
        }
        if ($types) {
            $ps2Data[$name] = @{
                types = $types
                lineStart = $i
            }
        }
    }
}

Write-Host "Found $($ps2Data.Count) PS2 species entries"

# Get all Orion/Templeton keys (both Orion and Temporal forms)
# Match keys ending with orion or temporal (lowercase, as in pokeathlon data)
$orionTempletonKeys = $pokemonDex.PSObject.Properties.Name | Where-Object { $_ -match 'orion$' -or $_ -match 'temporal$' }
Write-Host "Found $($orionTempletonKeys.Count) Orion/Templeton entries"

# Create mapping based on matching base name AND exact types
$mappings = @{}
foreach ($key in $orionTempletonKeys) {
    $entry = $pokemonDex.$key
    $types = $entry.types -join ","
    
    # Extract base name and form type (Orion or Temporal)
    if ($key -match '^(.+?)(orion|temporal)$') {
        $baseName = $matches[1]
        $formType = $matches[2]
        
        $ps2Key = $baseName.ToUpper()
        
        if ($ps2Data.ContainsKey($ps2Key)) {
            $ps2Types = $ps2Data[$ps2Key].types
            if ($ps2Types -eq $types) {
                $mappings[$key] = @{
                    ps2Species = $ps2Key
                    orionTempletonKey = $key
                    types = $types
                    formType = $formType
                }
            }
        }
    }
}

Write-Host "Found $($mappings.Count) matching entries"

# Output mappings to JSON
$mappingList = @()
foreach ($m in $mappings.Values) {
    $mappingList += [PSCustomObject]@{
        ps2Species = $m.ps2Species
        orionTempletonKey = $m.orionTempletonKey
        types = $m.types
    }
}

$mappingList | ConvertTo-Json -Depth 10 | Set-Content "$outputDir/mapping.json"
Write-Host "Saved mapping to $outputDir/mapping.json"

# Generate pokedex with PS2 data mapped to Orion/Templeton entries
$pokedexOutput = @{}

foreach ($m in $mappings.Values) {
    # Get the Orion/Templeton entry
    $orionKey = $m.orionTempletonKey
    $orionEntry = $pokemonDex.$orionKey
    
    # Create a copy with PS2 species name as key (lowercase, matching Orion/Templeton format)
    # Orion/Templeton keys don't have hyphens between base name and form type
    $ps2Key = "$($m.ps2Species.ToLower())$($m.formType)"
    
    # Copy basic info from Orion/Templeton entry
    $pokedexOutput[$ps2Key] = @{
        num = $orionEntry.num
        name = $orionEntry.name
        types = @($orionEntry.types)
        baseStats = [PSCustomObject]$orionEntry.baseStats
        abilities = if ($orionEntry.abilities) { [PSCustomObject]$orionEntry.abilities } else { @{} }
        heightm = $orionEntry.heightm
        weightkg = $orionEntry.weightkg
        color = $orionEntry.color
        eggGroups = @($orionEntry.eggGroups)
        tags = @("Soulstones")
        tier = "Illegal"
        isNonstandard = "Custom"
        gen = 9
    }
}

# Save pokedex (learnsets will be loaded from base Showdown data via adapter)
$pokedexOutput | ConvertTo-Json -Depth 10 | Set-Content "$outputDir/pokedex.ss2-soulstones.json"

Write-Host "Generated $($pokedexOutput.Count) PS2 soulstone entries"

Write-Host "Saved pokedex to $outputDir/pokedex.ss2-soulstones.json"
Write-Host "Saved learnsets to $outputDir/learnsets.ss2-soulstones.json"

# Output summary
Write-Host ""
Write-Host "=== Summary ==="
Write-Host "PS2 species entries: $($ps2Data.Count)"
Write-Host "Orion/Templeton entries: $($orionTempletonKeys.Count)"
Write-Host "Matching entries (name + types): $($mappings.Count)"
