# Pi-MFX helper for the Windows PC.
# Does not build the audio engine (that runs on the Pi).
# Use this as a checklist before you commit and push from GitHub Desktop.

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo

Write-Host ""
Write-Host "Pi-MFX  —  PC side of the daily loop" -ForegroundColor Cyan
Write-Host "Repo    $Repo"

$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) {
    Write-Host "This folder is not a git repo." -ForegroundColor Red
    exit 1
}

Write-Host "Branch  $branch"
if ($branch -ne "dev") {
    Write-Host "You are not on 'dev'. In GitHub Desktop, switch to dev before committing." -ForegroundColor Yellow
}

Write-Host ""
git status -sb
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  Windows menu:  double-click pimfx.cmd"
Write-Host "  Copy+rebuild:  double-click sync-to-pi.cmd"
Write-Host "  Or commit/push, then on the Pi:  sudo bash ./scripts/pimfx.sh update"
Write-Host "  Browser:     http://<pi-address>:8080   (Ctrl+Shift+R)"
Write-Host ""
Write-Host "Full steps: docs/DEV_FLOW.md"
