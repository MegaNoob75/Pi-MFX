$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$output = Join-Path $repo "docs\images"
$preview = "http://127.0.0.1:5173/docs.html"
$edgeCandidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) {
    throw "Microsoft Edge was not found. Install Edge or update capture-docs.ps1 with a Chromium path."
}

try {
    Invoke-WebRequest -UseBasicParsing -Uri $preview -TimeoutSec 3 | Out-Null
} catch {
    throw "The UI dev server is not running. In ui/, run: npm run dev"
}

$shots = [ordered]@{
    "performance.png" = "view=performance"
    "performance-snapshots.png" = "view=performance&variant=snapshots"
    "menu.png" = "view=performance&variant=menu"
    "transport.png" = "view=transport"
    "backing-tracks.png" = "view=backingTracks"
    "looper.png" = "view=looper"
    "looper-options.png" = "view=looper&variant=options"
    "looper-library.png" = "view=looper&variant=library"
    "recorder.png" = "view=recorder"
    "drum-machine.png" = "view=drums"
    "drum-pattern.png" = "view=drums&variant=pattern"
    "drum-kit.png" = "view=drums&variant=kit"
    "drum-song.png" = "view=drums&variant=song"
    "community-presets.png" = "view=community"
    "community-share.png" = "view=community&variant=share"
    "tuner.png" = "view=tuner"
    "banks.png" = "view=banks"
    "editor.png" = "view=edit"
    "editor-controls.png" = "view=edit&variant=controls"
    "editor-io.png" = "view=edit&variant=io"
    "snapshots.png" = "view=snapshots"
    "library.png" = "view=library"
    "plugins-installed.png" = "view=plugins"
    "plugins-install.png" = "view=plugins&variant=install"
    "files.png" = "view=files"
    "settings.png" = "view=settings"
    "controller.png" = "view=controller"
    "hardware.png" = "view=controller&variant=hardware"
    "layout.png" = "view=layout"
    "layout-snapshots.png" = "view=layout&variant=snapshots"
    "theme.png" = "view=theme"
    "keyboard.png" = "view=keyboard"
    "ui.png" = "view=ui"
    "backup.png" = "view=backup"
    "model-library-settings.png" = "view=tone3000"
    "system.png" = "view=system"
    "audio.png" = "view=audio"
    "hotspot.png" = "view=hotspot"
    "updates.png" = "view=updates"
    "realtime.png" = "view=system&variant=realtime"
    "about.png" = "view=about"
    "about-legal.png" = "view=about&variant=legal"
}

New-Item -ItemType Directory -Force -Path $output | Out-Null
foreach ($entry in $shots.GetEnumerator()) {
    $path = Join-Path $output $entry.Key
    $temporaryPath = Join-Path $output ".capture-$PID-$($entry.Key)"
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    $arguments = @(
        "--headless=new"
        "--disable-gpu"
        "--hide-scrollbars"
        "--virtual-time-budget=2500"
        "--window-size=1024,600"
        "--screenshot=$temporaryPath"
        "$preview`?$($entry.Value)"
    )
    $process = Start-Process -FilePath $edge -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "Capture failed with exit code $($process.ExitCode): $($entry.Key)"
    }
    if (-not (Test-Path -LiteralPath $temporaryPath)) {
        throw "Capture failed: $($entry.Key)"
    }
    Move-Item -LiteralPath $temporaryPath -Destination $path -Force
    Write-Host "Captured $($entry.Key)"
}

Write-Host "Updated $($shots.Count) screenshots in $output"
