# Copy this Windows tree to the Pi and rebuild there. No git commit or push.
#
#   .\scripts\sync-to-pi.ps1 pi@pimfx.local
#   .\scripts\sync-to-pi.ps1 192.168.1.50
#   .\scripts\sync-to-pi.ps1 -NoRebuild
#
# First successful target is saved in .pimfx-remote so later runs can omit it.
# Banks and settings on the Pi stay in /var/lib/pimfx.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Target = "",
    [string]$User = "pi",
    [string]$RemotePath = "~/Pi-MFX",
    [switch]$NoRebuild
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$RemoteFile = Join-Path $Repo ".pimfx-remote"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not on PATH. Install OpenSSH Client (Windows Settings -> Optional features)."
    }
}

Require-Command ssh
Require-Command scp
Require-Command tar

if (-not $Target) {
    if (Test-Path $RemoteFile) {
        $Target = (Get-Content $RemoteFile -Raw).Trim()
    }
}
if (-not $Target) {
    $guess = "pi@pimfx.local"
    $typed = Read-Host "Pi SSH target [$guess]"
    if ($typed) {
        $Target = $typed.Trim()
    } else {
        $Target = $guess
    }
}
if ($Target -notmatch "@") {
    $Target = "$User@$Target"
}

Write-Host ""
Write-Host "Pi-MFX  —  sync this PC to the Pi (no git push)" -ForegroundColor Cyan
Write-Host "From    $Repo"
Write-Host "To      ${Target}:$RemotePath"
Write-Host ""

$archive = Join-Path $env:TEMP "pimfx-sync.tgz"
if (Test-Path $archive) {
    Remove-Item $archive -Force
}

Write-Host "==> Packing source (skipping .git, node_modules, build, dist)"
$excludes = @(
    "--exclude=.git",
    "--exclude=.cursor",
    "--exclude=node_modules",
    "--exclude=ui/node_modules",
    "--exclude=ui/dist",
    "--exclude=engine/build",
    "--exclude=__pycache__",
    "--exclude=*.pyc"
)
& tar -c -z -f $archive @excludes -C $Repo .
if ($LASTEXITCODE -ne 0) {
    throw "tar failed"
}

Write-Host "==> Copying archive"
& scp $archive "${Target}:/tmp/pimfx-sync.tgz"
if ($LASTEXITCODE -ne 0) {
    throw "scp failed. Check SSH (ssh $Target) and that the Pi is on the LAN."
}

Write-Host "==> Unpacking on the Pi"
$unpack = "mkdir -p $RemotePath && tar -xzf /tmp/pimfx-sync.tgz -C $RemotePath && rm -f /tmp/pimfx-sync.tgz"
& ssh $Target $unpack
if ($LASTEXITCODE -ne 0) {
    throw "unpack on the Pi failed"
}

Set-Content -Path $RemoteFile -Value $Target -NoNewline
Remove-Item $archive -Force -ErrorAction SilentlyContinue

if ($NoRebuild) {
    Write-Host ""
    Write-Host "Files are on the Pi. Rebuild when ready:"
    Write-Host "  ssh -t $Target `"cd $RemotePath && sudo SKIP_PULL=1 bash ./scripts/pimfx.sh rebuild`""
    exit 0
}

Write-Host "==> Rebuilding on the Pi (no git pull)"
Write-Host "    sudo may ask for the Pi password"
& ssh -t $Target "cd $RemotePath && sudo SKIP_PULL=1 bash ./scripts/pimfx.sh rebuild"
if ($LASTEXITCODE -ne 0) {
    throw "rebuild on the Pi failed"
}

Write-Host ""
Write-Host "Done. Open http://pimfx.local:8080 and hard-refresh (Ctrl+Shift+R)."
Write-Host "Next time:  .\scripts\sync-to-pi.ps1"
