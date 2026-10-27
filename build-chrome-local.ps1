[CmdletBinding()]
param(
    [string]$OutputDirectory = "build-output"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "manifest.json not found: $manifestPath"
}

$sourceManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$sourceManifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "manifest.json does not contain a version"
}

$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory
} else {
    Join-Path $projectRoot $OutputDirectory
}

$stageDirectory = Join-Path $outputRoot "chrome"
$zipPath = Join-Path $outputRoot "trilium-web-clipper-$version-chrome-local.zip"

Write-Host "Building Trilium Web Clipper Plus for Chrome..."
Write-Host "Version: $version"

Remove-Item -LiteralPath $stageDirectory -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
New-Item -Path $stageDirectory -ItemType Directory -Force | Out-Null

$runtimeFiles = @(
    "background.js",
    "content.js",
    "offscreen.html",
    "offscreen.js",
    "trilium_server_facade.js",
    "utils.js",
    "manifest.json"
)

$runtimeDirectories = @(
    "content",
    "i18n",
    "icons",
    "lib",
    "options",
    "popup"
)

foreach ($file in $runtimeFiles) {
    $sourcePath = Join-Path $projectRoot $file
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required runtime file not found: $sourcePath"
    }
    Copy-Item -LiteralPath $sourcePath -Destination $stageDirectory
}

foreach ($directory in $runtimeDirectories) {
    $sourcePath = Join-Path $projectRoot $directory
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
        throw "Required runtime directory not found: $sourcePath"
    }
    Copy-Item -LiteralPath $sourcePath -Destination $stageDirectory -Recurse
}

$buildManifestPath = Join-Path $stageDirectory "manifest.json"
$buildManifest = Get-Content -LiteralPath $buildManifestPath -Raw | ConvertFrom-Json
$buildManifest.name = "Trilium Web Clipper Plus"
$buildManifest.PSObject.Properties.Remove("browser_specific_settings")

$buildManifest |
    ConvertTo-Json -Depth 20 |
    Set-Content -LiteralPath $buildManifestPath -Encoding utf8

Compress-Archive `
    -Path (Join-Path $stageDirectory "*") `
    -DestinationPath $zipPath `
    -CompressionLevel Optimal

$zipSize = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)
Write-Host "Chrome package created: $zipPath ($zipSize KB)"
Write-Host "Load unpacked directory: $stageDirectory"
