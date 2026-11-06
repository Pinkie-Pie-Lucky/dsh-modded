# run-modded.ps1 - Launch the modded DeepSeek Harness with an isolated home dir.
#
# Usage (from the repo root):
#   .\run-modded.ps1                    # web UI
#   .\run-modded.ps1 -Mode headless     # command line
#   .\run-modded.ps1 -HomeDir 'D:\my-home' # custom home dir
#
# One-time prerequisites:
#   pnpm install
#   pnpm run build

param(
    [string]$HomeDir = 'U:\modded-home',
    [ValidateSet('web', 'headless')]
    [string]$Mode = 'web'
)

$ErrorActionPreference = 'Stop'

# Isolated home dir: sessions/settings/credentials live here, fully separate
# from the official ~/.dsh, so both can run at the same time.
$env:DSH_HOME = $HomeDir
New-Item -ItemType Directory -Force -Path $env:DSH_HOME | Out-Null
Write-Host "[modded] DSH_HOME = $env:DSH_HOME" -ForegroundColor Cyan

Set-Location $PSScriptRoot

if (-not (Test-Path 'node_modules')) {
    Write-Host '[modded] node_modules not found. Build first:' -ForegroundColor Yellow
    Write-Host '  pnpm install' -ForegroundColor Yellow
    Write-Host '  pnpm run build' -ForegroundColor Yellow
    exit 1
}

# Prefer a global pnpm; otherwise fall back to the one bundled with DSH runtime.
$globalPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($globalPnpm) {
    Write-Host '[modded] using global pnpm' -ForegroundColor DarkGray
    & pnpm dsh $Mode
}
else {
    $rtNode = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    $rtPnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
    if ((Test-Path $rtNode) -and (Test-Path $rtPnpm)) {
        Write-Host '[modded] using DSH runtime pnpm' -ForegroundColor DarkGray
        & $rtNode $rtPnpm dsh $Mode
    }
    else {
        Write-Host '[modded] pnpm not found. Run: corepack enable' -ForegroundColor Red
        exit 1
    }
}
