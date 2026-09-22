# bump-version.ps1 — Incrementa el ?v=N de un módulo en todos sus importadores.
# Uso:  .\scripts\bump-version.ps1 karaoke.js
#       .\scripts\bump-version.ps1 karaoke.js -NewVersion 14

param(
  [Parameter(Mandatory=$true)][string]$File,
  [int]$NewVersion
)

$Root = Split-Path $PSScriptRoot -Parent
$TargetBase = Split-Path $File -Leaf

# Buscar archivos a escanear
$allFiles = @()
$allFiles += Get-ChildItem -Path $Root -Filter "*.html" -File
$allFiles += Get-ChildItem -Path $Root -Filter "*.js" -File
$allFiles += Get-ChildItem -Path (Join-Path $Root "modules") -Filter "*.js" -File -Recurse

# Encontrar versión actual
$currentVersion = 0
$pattern = [regex]::Escape($TargetBase) + '\?v=(\d+)'

foreach ($f in $allFiles) {
  $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  if ($content -match $pattern) {
    $currentVersion = [int]$Matches[1]
    break
  }
}

if ($currentVersion -eq 0) {
  Write-Host "No se encontro referencia a $TargetBase?v= en el proyecto." -ForegroundColor Red
  exit 1
}

if ($NewVersion) {
  $target = $NewVersion
} else {
  $target = $currentVersion + 1
}

Write-Host ""
Write-Host "  $TargetBase : v$currentVersion -> v$target" -ForegroundColor Cyan
Write-Host ""

$oldStr = "$TargetBase?v=$currentVersion"
$newStr = "$TargetBase?v=$target"
$regex = [regex]::Escape($oldStr)
$changed = 0

foreach ($f in $allFiles) {
  $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  if ($content -match $regex) {
    $updated = $content -replace $regex, $newStr
    Set-Content -Path $f.FullName -Value $updated -NoNewline -Encoding UTF8
    $short = $f.FullName.Replace($Root + "\", "")
    Write-Host "  OK $short" -ForegroundColor Green
    $changed++
  }
}

# AGENTS.md
$agentsPath = Join-Path $Root "AGENTS.md"
if (Test-Path $agentsPath) {
  $content = Get-Content $agentsPath -Raw -ErrorAction SilentlyContinue
  if ($content -match $regex) {
    $updated = $content -replace $regex, $newStr
    Set-Content -Path $agentsPath -Value $updated -NoNewline -Encoding UTF8
    Write-Host "  OK AGENTS.md" -ForegroundColor Green
    $changed++
  }
}

Write-Host ""
Write-Host "  $changed archivo(s) actualizado(s). Vigente: $TargetBase?v=$target" -ForegroundColor Yellow
