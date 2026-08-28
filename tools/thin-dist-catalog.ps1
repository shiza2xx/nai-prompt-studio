param(
  [string]$DistRoot = (Join-Path $PSScriptRoot '..\dist\catalog')
)

$resolvedDist = [IO.Path]::GetFullPath($DistRoot)
if (-not (Test-Path -LiteralPath $resolvedDist -PathType Container)) { throw "Thin catalog: dist catalog directory was not found: $resolvedDist" }
$catalogJson = Join-Path $resolvedDist 'catalog.json'
$guideManifest = Join-Path $resolvedDist 'guide\manifest.json'
if (-not (Test-Path -LiteralPath $catalogJson -PathType Leaf)) { throw "Thin catalog: catalog.json is required" }
if (-not (Test-Path -LiteralPath $guideManifest -PathType Leaf)) { throw "Thin catalog: guide/manifest.json is required" }

# Packaged builds retain compact metadata and the guide manifest only. Image
# bytes are independently downloaded as ASAR components after first launch.
$cards = Join-Path $resolvedDist 'cards'
if (Test-Path -LiteralPath $cards) { Remove-Item -LiteralPath $cards -Recurse -Force }
$guide = Join-Path $resolvedDist 'guide'
Get-ChildItem -LiteralPath $guide -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(?:png|jpe?g|webp|gif)$' } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
Write-Host "Thin catalog: retained catalog.json and guide/manifest.json; removed bundled card and guide image payloads."
