# Screenshots

These are the current Pi-MFX React views at **1024×600**, the target size for a
7-inch kiosk display. They use the read-only documentation fixture in
`ui/docs.html`, so the captures show representative banks, effects, tracks,
projects, patterns, and catalog entries without changing a Pi or user data.

Open `http://pimfx.local:8080` on a Pi for live audio, hardware, storage, and
network state. The fixture is visual documentation, not Raspberry Pi audio or
XRun validation.

## Shell and performance

![Navigation drawer](images/menu.png)

![Performance](images/performance.png)

![Performance snapshot mode](images/performance-snapshots.png)

## Transport and performance tools

![Tap Tempo and shared transport](images/transport.png)

![Backing Tracks](images/backing-tracks.png)

![Looper](images/looper.png)

![Looper options](images/looper-options.png)

![Saved loop library](images/looper-library.png)

![Multitrack Recorder](images/recorder.png)

![Drum Machine controls](images/drum-machine.png)

![Drum pattern editor](images/drum-pattern.png)

![Drum kit](images/drum-kit.png)

![Drum song chain](images/drum-song.png)

![Tuner](images/tuner.png)

## Presets and effects

![Banks and Presets](images/banks.png)

![Preset Editor chain](images/editor.png)

![Preset Editor controls](images/editor-controls.png)

![Preset Editor input and output](images/editor-io.png)

![Snapshots](images/snapshots.png)

![Community Presets catalog](images/community-presets.png)

![Share Preset](images/community-share.png)

## Models, plugins, and files

![Model Library](images/library.png)

![Plugins installed](images/plugins-installed.png)

![Plugins install](images/plugins-install.png)

![Files](images/files.png)

## Settings and controller

![Settings hub](images/settings.png)

![Controller hub](images/controller.png)

![Hardware Setup](images/hardware.png)

![Layout Performance stage](images/layout.png)

![Layout Snapshot stage](images/layout-snapshots.png)

![Theme Manager](images/theme.png)

![Keyboard](images/keyboard.png)

![PI-MFX UI settings](images/ui.png)

![Backup](images/backup.png)

![TONE3000 settings](images/model-library-settings.png)

## System

![System hub](images/system.png)

![Audio](images/audio.png)

![Wi-Fi and Hotspot](images/hotspot.png)

![Updates](images/updates.png)

![Realtime diagnostics](images/realtime.png)

## About

![About](images/about.png)

![About and Legal](images/about-legal.png)

How to use each screen: [USER_GUIDE.md](USER_GUIDE.md).

## Regenerating the gallery

From `ui/`, run `npm run dev`. On Windows, run
`powershell -ExecutionPolicy Bypass -File scripts/capture-docs.ps1` from the
repository root to replace the full gallery. Individual preview URLs include:

```text
http://127.0.0.1:5173/docs.html?view=performance
http://127.0.0.1:5173/docs.html?view=looper&variant=options
http://127.0.0.1:5173/docs.html?view=drums&variant=pattern
```

The preview uses the same components and CSS as the product. Update its fixture
when a screen needs new representative content, then capture at 1024×600.
