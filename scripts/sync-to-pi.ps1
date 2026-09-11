# Copy this Windows tree to the Pi and rebuild there. No git commit or push.
#
#   .\scripts\sync-to-pi.ps1 you@pimfx.local
#   .\scripts\sync-to-pi.ps1 192.168.1.50
#   .\scripts\sync-to-pi.ps1 -NoRebuild

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Target = "",
    [string]$RemotePath = "~/Pi-MFX",
    [switch]$NoRebuild
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$RemoteFile = Join-Path $Repo ".pimfx-remote"
$pwsh = Join-Path $PSHOME "powershell.exe"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not on PATH. Install OpenSSH Client (Windows Settings -> Optional features)."
    }
}

function Invoke-SshTool([string]$Exe, [string[]]$ExeArgs) {
    & $Exe @ExeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$Exe failed (exit $LASTEXITCODE)"
    }
}

function Escape-BashSingle([string]$Text) {
    return "'" + ($Text -replace "'", "'\''") + "'"
}

Require-Command ssh
Require-Command scp
Require-Command tar

$saved = ""
if (Test-Path $RemoteFile) {
    $saved = (Get-Content $RemoteFile -Raw).Trim()
}

if (-not $Target) {
    if ($saved) {
        $typed = Read-Host "Pi SSH login [$saved]"
        if ($typed) {
            $Target = $typed.Trim()
        } else {
            $Target = $saved
        }
    } else {
        while (-not $Target) {
            $typed = Read-Host "Pi SSH login (user@host, for example you@pimfx.local)"
            $Target = $typed.Trim()
        }
    }
}
if ($Target -notmatch "@") {
    $name = ""
    while (-not $name) {
        $name = (Read-Host "Pi username").Trim()
    }
    $Target = "$name@$Target"
}

Write-Host ""
Write-Host "Pi-MFX - sync this PC to the Pi (no git push)" -ForegroundColor Cyan
Write-Host "From    $Repo"
Write-Host "To      ${Target}:$RemotePath"
Write-Host ""
Write-Host "Type that account password. It will be shown as you type."
$Password = Read-Host "Password"

$archive = Join-Path $env:TEMP "pimfx-sync.tgz"
$apply = Join-Path $env:TEMP "pimfx-apply.sh"
$askFile = Join-Path $env:TEMP "pimfx-askpass.txt"
$askCmd = Join-Path $env:TEMP "pimfx-askpass.cmd"
$sshOpts = @(
    "-o", "PreferredAuthentications=password",
    "-o", "PubkeyAuthentication=no",
    "-o", "NumberOfPasswordPrompts=1",
    "-o", "StrictHostKeyChecking=accept-new"
)

try {
    [System.IO.File]::WriteAllText($askFile, $Password.Trim())
    $askBody = @"
@echo off
"$pwsh" -NoProfile -NonInteractive -Command "[Console]::Out.Write([IO.File]::ReadAllText('$($askFile.Replace('\','\\'))').Trim())"
"@
    [System.IO.File]::WriteAllText($askCmd, $askBody)
    $env:SSH_ASKPASS = $askCmd
    $env:SSH_ASKPASS_REQUIRE = "force"
    $env:DISPLAY = "localhost:0"

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

    $quotedPass = Escape-BashSingle $Password
    $applyText = @"
#!/bin/bash
set -euo pipefail
DEST="$RemotePath"
mkdir -p "`$DEST"
tar -xzf /tmp/pimfx-sync.tgz -C "`$DEST"
rm -f /tmp/pimfx-sync.tgz
if [ "`$1" = "rebuild" ]; then
  cd "`$DEST"
  printf '%s\n' $quotedPass | sudo -S -p '' env SKIP_PULL=1 bash ./scripts/pimfx.sh rebuild
fi
rm -f /tmp/pimfx-apply.sh
"@
    [System.IO.File]::WriteAllText($apply, ($applyText -replace "`r`n", "`n") + "`n")

    Write-Host "==> Copying archive"
    Invoke-SshTool scp ($sshOpts + @("-O", $archive, "${Target}:/tmp/pimfx-sync.tgz"))
    Invoke-SshTool scp ($sshOpts + @("-O", $apply, "${Target}:/tmp/pimfx-apply.sh"))

    Write-Host "==> Applying on the Pi"
    $mode = "rebuild"
    if ($NoRebuild) {
        $mode = "copy"
    }
    Invoke-SshTool ssh ($sshOpts + @("-n", $Target, "bash /tmp/pimfx-apply.sh $mode"))

    Set-Content -Path $RemoteFile -Value $Target -NoNewline
    Write-Host ""
    Write-Host "Done. Open http://pimfx.local:8080 and hard-refresh the page."
    Write-Host "Next time: double-click sync-to-pi.cmd"
}
finally {
    Remove-Item $archive, $apply, $askFile, $askCmd -Force -ErrorAction SilentlyContinue
    Remove-Item Env:SSH_ASKPASS, Env:SSH_ASKPASS_REQUIRE, Env:DISPLAY -ErrorAction SilentlyContinue
}
