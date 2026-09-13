# Windows front end for Pi-MFX setup. SSH login is asked and saved locally
# in .pimfx-remote (gitignored). Pi work is always scripts/pimfx.sh on the Pi.
#
#   .\pimfx.cmd
#   .\scripts\pimfx-win.ps1
#   .\scripts\pimfx-win.ps1 -Action CopyRebuild
#   .\scripts\sync-to-pi.ps1

[CmdletBinding()]
param(
    [string]$Action = "",
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

function Escape-BashSingle([string]$Text) {
    return "'" + ($Text -replace "'", "'\''") + "'"
}

function Invoke-SshTool([string]$Exe, [string[]]$ExeArgs) {
    & $Exe @ExeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$Exe failed (exit $LASTEXITCODE)"
    }
}

function Get-SshOpts {
    return @(
        "-o", "PreferredAuthentications=password",
        "-o", "PubkeyAuthentication=no",
        "-o", "NumberOfPasswordPrompts=1",
        "-o", "StrictHostKeyChecking=accept-new"
    )
}

function Read-SavedLogin {
    if (-not (Test-Path $RemoteFile)) {
        return $null
    }
    $raw = (Get-Content $RemoteFile -Raw).Trim()
    if (-not $raw) {
        return $null
    }
    if ($raw.StartsWith("{")) {
        return $raw | ConvertFrom-Json
    }
    return [pscustomobject]@{ target = $raw; password = "" }
}

function Save-Login([string]$LoginTarget, [string]$Password) {
    $json = @{ target = $LoginTarget; password = $Password } | ConvertTo-Json -Compress
    Set-Content -Path $RemoteFile -Value $json -Encoding UTF8
}

function Ask-Login([switch]$Force) {
    $saved = Read-SavedLogin
    if (-not $Force -and $saved -and $saved.target) {
        $typed = Read-Host ("Pi SSH login [{0}]  Enter=use saved, C=change" -f $saved.target)
        if (-not $typed) {
            $script:Target = $saved.target
            if ($saved.password) {
                $script:Password = [string]$saved.password
                return
            }
        } elseif ($typed.Trim() -ne "C" -and $typed.Trim() -ne "c") {
            $script:Target = $typed.Trim()
        }
    }

    $hostName = ""
    $userName = ""
    while (-not $hostName) {
        $hostName = (Read-Host "Pi hostname or IP (for example pimfx.local)").Trim()
    }
    while (-not $userName) {
        $userName = (Read-Host "Pi username").Trim()
    }
    $script:Target = "$userName@$hostName"
    $script:Password = Read-Host "Pi password (shown as you type)"
    Save-Login $script:Target $script:Password
}

function Ensure-Login {
    if ($script:Target -and $script:Password) {
        return
    }
    if ($Target) {
        $script:Target = $Target
        if ($script:Target -notmatch "@") {
            $name = ""
            while (-not $name) {
                $name = (Read-Host "Pi username").Trim()
            }
            $script:Target = "$name@$($script:Target)"
        }
        if (-not $script:Password) {
            $saved = Read-SavedLogin
            if ($saved -and $saved.target -eq $script:Target -and $saved.password) {
                $script:Password = [string]$saved.password
            } else {
                $script:Password = Read-Host "Pi password (shown as you type)"
            }
        }
        Save-Login $script:Target $script:Password
        return
    }
    Ask-Login
}

function Enable-Askpass {
    $script:askFile = Join-Path $env:TEMP "pimfx-askpass.txt"
    $script:askCmd = Join-Path $env:TEMP "pimfx-askpass.cmd"
    [System.IO.File]::WriteAllText($script:askFile, $script:Password.Trim())
    $escaped = $script:askFile.Replace("\", "\\")
    $askBody = "@echo off`r`n`"$pwsh`" -NoProfile -NonInteractive -Command `"[Console]::Out.Write([IO.File]::ReadAllText('$escaped').Trim())`"`r`n"
    [System.IO.File]::WriteAllText($script:askCmd, $askBody)
    $env:SSH_ASKPASS = $script:askCmd
    $env:SSH_ASKPASS_REQUIRE = "force"
    $env:DISPLAY = "localhost:0"
}

function Disable-Askpass {
    Remove-Item $script:askFile, $script:askCmd -Force -ErrorAction SilentlyContinue
    Remove-Item Env:SSH_ASKPASS, Env:SSH_ASKPASS_REQUIRE, Env:DISPLAY -ErrorAction SilentlyContinue
}

function Reload-PiKiosk {
    $inc = Join-Path $PSScriptRoot "kiosk-reload.inc.sh"
    if (-not (Test-Path $inc)) {
        Write-Host "Kiosk refresh script is missing on this PC ($inc)."
        return
    }
    Ensure-Login
    Enable-Askpass
    $quotedPass = Escape-BashSingle $script:Password
    $remoteInc = Join-Path $env:TEMP "pimfx-kiosk-reload.inc.sh"
    try {
        Write-Host "==> Refreshing the Pi touchscreen browser"
        $text = [IO.File]::ReadAllText($inc) -replace "`r`n", "`n" -replace "`r", "`n"
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllBytes($remoteInc, $utf8.GetBytes(($text.TrimEnd() + "`n")))
        Invoke-SshTool scp ((Get-SshOpts) + @("-O", $remoteInc, "$($script:Target):/tmp/pimfx-kiosk-reload.inc.sh"))
        $remote = "printf '%s\n' $quotedPass | sudo -S -p '' bash -c '. /tmp/pimfx-kiosk-reload.inc.sh; reload_kiosk_browser; rm -f /tmp/pimfx-kiosk-reload.inc.sh'"
        Invoke-SshTool ssh ((Get-SshOpts) + @("-n", $script:Target, $remote))
    } catch {
        Write-Host "Could not refresh the Pi screen. Hard-refresh that display or reboot."
        Write-Host $_
    } finally {
        Remove-Item $remoteInc -Force -ErrorAction SilentlyContinue
        Disable-Askpass
    }
}

function Invoke-Pimfx([string]$ActionLine) {
    Ensure-Login
    Enable-Askpass
    $quotedPass = Escape-BashSingle $script:Password
    $remote = "cd $RemotePath; printf '%s\n' $quotedPass | sudo -S -p '' bash ./scripts/pimfx.sh $ActionLine"
    try {
        Invoke-SshTool ssh ((Get-SshOpts) + @("-n", $script:Target, $remote))
    } finally {
        Disable-Askpass
    }
}

function Copy-LocalTree([string]$Mode) {
    Require-Command git
    Ensure-Login
    Enable-Askpass
    $archive = Join-Path $env:TEMP "pimfx-sync.tgz"
    $apply = Join-Path $env:TEMP "pimfx-apply.sh"
    try {
        $sourceCommit = (& git -C $Repo rev-parse --short HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
            throw "Could not read the current Windows commit"
        }
        $sourceChanges = & git -C $Repo status --porcelain --untracked-files=normal
        if ($LASTEXITCODE -ne 0) {
            throw "Could not check the Windows working tree"
        }
        if ($sourceChanges) {
            $sourceCommit += "-local"
        }
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
        $quotedPass = Escape-BashSingle $script:Password
        $quotedCommit = Escape-BashSingle $sourceCommit
        $applyText = @"
#!/bin/bash
set -euo pipefail
DEST="$RemotePath"
mkdir -p "`$DEST"
tar -xzf /tmp/pimfx-sync.tgz -C "`$DEST"
rm -f /tmp/pimfx-sync.tgz
if [ "`$1" = "rebuild" ]; then
  cd "`$DEST"
  printf '%s\n' $quotedCommit > .pimfx-build-commit
  printf '%s\n' $quotedPass | sudo -S -p '' env SKIP_PULL=1 PIMFX_GIT_SHA=$quotedCommit bash ./scripts/pimfx.sh rebuild
fi
rm -f /tmp/pimfx-apply.sh
"@
        [System.IO.File]::WriteAllText($apply, ($applyText -replace "`r`n", "`n") + "`n")
        Write-Host "==> Copying archive"
        Invoke-SshTool scp ((Get-SshOpts) + @("-O", $archive, "$($script:Target):/tmp/pimfx-sync.tgz"))
        Invoke-SshTool scp ((Get-SshOpts) + @("-O", $apply, "$($script:Target):/tmp/pimfx-apply.sh"))
        Write-Host "==> Applying on the Pi"
        Invoke-SshTool ssh ((Get-SshOpts) + @("-n", $script:Target, "bash /tmp/pimfx-apply.sh $Mode"))
        Save-Login $script:Target $script:Password
        Write-Host "Done. Other browsers: hard-refresh http://pimfx.local:8080"
    } finally {
        Remove-Item $archive, $apply -Force -ErrorAction SilentlyContinue
        Disable-Askpass
    }
    if ($Mode -eq "rebuild") {
        Reload-PiKiosk
    }
}

function Show-BootScreenMenu {
    Write-Host ""
    Write-Host "  Boot screen"
    Write-Host "  1) Install PI-MFX logo and hide boot / shutdown text"
    Write-Host "  2) Remove logo and restore console messages"
    Write-Host "  3) Back"
    $c = Read-Host "Choose [1-3]"
    switch ($c) {
        "1" { Invoke-Pimfx "splash -y" }
        "2" { Invoke-Pimfx "splash-remove -y" }
    }
}

function Show-FasterBootMenu {
    Write-Host ""
    Write-Host "  Faster boot"
    Write-Host "  1) Skip waiting for a network connection at boot"
    Write-Host "  2) Disable unused printer, modem, VNC and file-share services"
    Write-Host "  3) Restore those boot-speed changes"
    Write-Host "  4) Back"
    $c = Read-Host "Choose [1-4]"
    switch ($c) {
        "1" { Invoke-Pimfx "boot-speed -y" }
        "2" { Invoke-Pimfx "boot-speed-unused -y" }
        "3" { Invoke-Pimfx "boot-speed-restore -y" }
    }
}

function Invoke-MenuAction([string]$Choice) {
    $userName = ""
    if ($script:Target -match "^(.*)@") {
        $userName = $Matches[1]
    }
    switch ($Choice) {
        "0" { Copy-LocalTree "rebuild" }
        "1" { Invoke-Pimfx ("complete -y --display-user " + $userName) }
        "2" { Invoke-Pimfx "install -y" }
        "3" { Invoke-Pimfx "update -y --branch dev"; Reload-PiKiosk }
        "4" { Invoke-Pimfx "rebuild -y"; Reload-PiKiosk }
        "5" { Invoke-Pimfx ("display -y --display-user " + $userName) }
        "5r" { Invoke-Pimfx "display-refresh -y" }
        "6" { Invoke-Pimfx "display-remove -y" }
        "7" { Show-BootScreenMenu }
        "7.1" { Invoke-Pimfx "splash -y" }
        "7.2" { Invoke-Pimfx "splash-remove -y" }
        "8" { Show-FasterBootMenu }
        "8.1" { Invoke-Pimfx "boot-speed -y" }
        "8.2" { Invoke-Pimfx "boot-speed-unused -y" }
        "8.3" { Invoke-Pimfx "boot-speed-restore -y" }
        "9" { Invoke-Pimfx "hotspot -y" }
        "10" { Invoke-Pimfx "status" }
        "11" {
            $purge = Read-Host "Also delete /var/lib/pimfx (banks, models, IRs)? [y/N]"
            if ($purge -match "^[yY]") {
                Invoke-Pimfx "remove -y --purge"
            } else {
                Invoke-Pimfx "remove -y"
            }
        }
        "12" { Invoke-Pimfx "reboot -y" }
        "L" { Ask-Login -Force }
        "l" { Ask-Login -Force }
        default { Write-Host "pick a listed item" }
    }
}

function Show-Menu {
    Require-Command ssh
    Require-Command scp
    Require-Command tar
    Ensure-Login
    while ($true) {
        Write-Host ""
        Write-Host "  +--------------------------------------------------+"
        Write-Host "  |  PI-MFX                                          |"
        Write-Host "  |  Raspberry Pi guitar multi-effects               |"
        Write-Host "  +--------------------------------------------------+"
        Write-Host ("  Login  {0}" -f $script:Target)
        Write-Host ""
        Write-Host "  This PC"
        Write-Host "  0) Copy this PC to the Pi and rebuild  (no git push)"
        Write-Host "  L) Change saved SSH login"
        Write-Host ""
        Write-Host "  Same as scripts/pimfx.sh on the Pi"
        Write-Host "  1) Complete setup  (install + touchscreen)"
        Write-Host "  2) Install / first-time setup"
        Write-Host "  3) Update  (fetch GitHub, then rebuild and restart)"
        Write-Host "  4) Rebuild local files  (no git pull)"
        Write-Host "  5) Set up touchscreen display"
        Write-Host "  5r) Refresh touchscreen (hard-refresh kiosk, hide pointer, hide keyboard)"
        Write-Host "  6) Remove touchscreen display"
        Write-Host "  7) Boot screen  (PI-MFX logo, hide boot text)"
        Write-Host "       7.1) Install PI-MFX logo and hide boot / shutdown text"
        Write-Host "       7.2) Remove logo and restore console messages"
        Write-Host "  8) Faster boot  (skip network wait, unused services)"
        Write-Host "       8.1) Skip waiting for a network connection at boot"
        Write-Host "       8.2) Disable unused printer, modem, VNC and file-share services"
        Write-Host "       8.3) Restore those boot-speed changes"
        Write-Host "  9) Wi-Fi hotspot support"
        Write-Host "  10) Status"
        Write-Host "  11) Remove Pi-MFX"
        Write-Host "  12) Reboot now"
        Write-Host "  13) Exit"
        Write-Host ""
        $choice = (Read-Host "Choose").Trim()
        if ($choice -eq "13" -or $choice -eq "q" -or $choice -eq "Q") {
            return
        }
        try {
            Invoke-MenuAction $choice
        } catch {
            Write-Host $_
        }
        if ($choice -ne "L" -and $choice -ne "l") {
            Write-Host ""
            Read-Host "Press Enter to return to the menu"
        }
    }
}

Require-Command ssh
Require-Command scp
Require-Command tar

if ($NoRebuild) {
    $Action = "CopyOnly"
}

if (-not $Action) {
    Show-Menu
} elseif ($Action -eq "CopyRebuild") {
    Copy-LocalTree "rebuild"
} elseif ($Action -eq "CopyOnly") {
    Copy-LocalTree "copy"
} else {
    Invoke-Pimfx $Action
}
