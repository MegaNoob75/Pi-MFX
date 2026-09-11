# Copy this Windows tree to the Pi and rebuild there. No git commit or push.
# The shared menu is scripts/pimfx-win.ps1 (same jobs as scripts/pimfx.sh).
#
#   .\sync-to-pi.cmd
#   .\pimfx.cmd

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Target = "",
    [string]$RemotePath = "~/Pi-MFX",
    [switch]$NoRebuild
)

$win = Join-Path $PSScriptRoot "pimfx-win.ps1"
if ($NoRebuild) {
    & $win -Action CopyOnly -Target $Target -RemotePath $RemotePath
} else {
    & $win -Action CopyRebuild -Target $Target -RemotePath $RemotePath
}
