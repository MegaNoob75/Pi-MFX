# Installing Pi-MFX

## What you need

- Raspberry Pi 5 (4 GB or more), dedicated to Pi-MFX
- Raspberry Pi OS **64-bit**, Bookworm or newer, Lite is ideal
- A USB class-compliant audio interface **or** an I2S audio HAT, with a real
  instrument input
- A network connection, wired or Wi-Fi
- Optionally, a touchscreen for kiosk mode, and a DIY foot controller

The Pi 5 has no analog audio output and HDMI is not a guitar path, so an
interface or HAT is not optional.

## 1. Write the OS

Use Raspberry Pi Imager, choose **Raspberry Pi OS Lite (64-bit)**, and in the
settings pane set the hostname, enable SSH, and configure your network. A
desktop image works, but Lite leaves more CPU for audio.

## 2. Prepare the audio hardware

**USB interface** — plug it directly into the Pi, not through a hub. Nothing
else to do; class-compliant devices need no driver.

**I2S HAT** — add your board's overlay to `/boot/firmware/config.txt`, comment
out the on-board audio, and reboot. Your vendor's documentation has the exact
line; the common ones look like:

```ini
# dtparam=audio=on          <- comment this out
dtoverlay=hifiberry-dacplusadc      # HiFiBerry DAC+ADC
# dtoverlay=audioinjector-wm8731-audio
# dtoverlay=iqaudio-codec
```

Pi-MFX ships no vendor overlay files. After the reboot, `arecord -l` should
list your card.

## 3. Install

The repo is private. Clone with SSH after the Pi’s public key is on GitHub
(`ssh -T git@github.com` should greet you). HTTPS will prompt for a username
and then fail.

```bash
git clone git@github.com:MegaNoob75/Pi-MFX.git
cd Pi-MFX
sudo bash ./scripts/pimfx.sh
```

Pick **1) Complete setup** for a first Pi with an attached touchscreen, or
**2) Install** for the engine and web UI only.

This builds the engine and the UI, creates a `pimfx` service account, installs
a systemd service, and tunes the OS for audio. Everything it changes is listed
in [LOW_LATENCY.md](LOW_LATENCY.md) and undone from the same menu (**Remove**).

Scripted options (no menu):

```bash
sudo bash ./scripts/pimfx.sh install
sudo bash ./scripts/pimfx.sh install --no-tuning
sudo bash ./scripts/pimfx.sh install --port 8000
sudo bash ./scripts/pimfx.sh update
sudo bash ./scripts/pimfx.sh display --display-user YOUR_LOGIN
```

Pi-MFX ships no effects. After the engine is running, open
**Settings → Plugins** to install LV2 packages from Raspberry Pi OS, add extra
apt repos, or download Raspberry Pi builds from PatchStorage. See
[PLUGIN_LICENSES.md](PLUGIN_LICENSES.md).

Reboot afterwards to pick up the `threadirqs` kernel option.

## 4. Open the UI

From any browser on the same network:

```
http://<pi-address>:8080
```

or `http://raspberrypi.local:8080` if mDNS is working. Phones, tablets, and
laptops are all first-class; the UI adapts to the screen.

## 5. Set up audio

**Settings → Audio**

1. Pick your interface or HAT. Duplex devices are listed first.
2. Set sample rate, period size, and period count. Start at 48000 / 64 / 3.
3. Reset the xrun counter and play hard for two minutes.
4. Zero xruns? Step down. Any xruns? Step back up.

The round-trip figure is measured from the driver, not calculated.

## 6. Build a chain

**Editor** → add effects. If the picker is empty, install LV2 plugins from
**Settings → Plugins**, then Rescan.

For amp captures and cabs you need a NAM-capable LV2 plugin and a convolution
plugin. Once installed, effects that take a `.nam` file or an impulse response
show a file button that opens the Pi-MFX library, including anything you
downloaded from TONE3000.

## 7. Optional: foot controller

**Settings → Controller**. See [DIY_CONTROLLER.md](DIY_CONTROLLER.md) to build
one. You do not need one — the browser is a complete control surface, and the
Performance screen gives you on-screen switches.

## Optional: touchscreen on the Pi

From the setup menu pick **5) Set up touchscreen display**, or:

```bash
sudo bash ./scripts/pimfx.sh display
```

That installs Labwc and Chromium, enables console auto-login for the account
you used with sudo, and opens `http://127.0.0.1:8080` fullscreen after reboot.
It does not use Chromium's strict kiosk mode. A tablet or phone on the LAN is
still a complete control surface if you skip this.

To undo just the screen session: menu item **6**, or
`sudo bash ./scripts/pimfx.sh display-remove`.

## Updating

After the first install, use the short update script (pull, rebuild, restart).
It does not redo apt or OS tuning.

```bash
cd ~/Pi-MFX
sudo bash ./scripts/pimfx.sh update
```

Or open the menu and pick **Update**. Day-to-day PC + Pi steps are in
[DEV_FLOW.md](DEV_FLOW.md).

Your banks, settings, models, and IRs live in `/var/lib/pimfx` and are not
touched by an update or a reinstall. Run install again only if you need new
system packages or want to re-apply tuning.

## Removing

From the menu pick **Remove Pi-MFX**, or:

```bash
sudo bash ./scripts/pimfx.sh remove          # keeps your data
sudo bash ./scripts/pimfx.sh remove --purge  # deletes /var/lib/pimfx too
```

## Troubleshooting

**The page does not load.** `systemctl status pimfx`, then
`journalctl -u pimfx -n 50`.

**No audio devices listed.** `arecord -l` and `aplay -l` on the Pi. If they show
nothing, the OS cannot see the hardware, which is a driver or overlay problem
rather than a Pi-MFX one.

**"Device or resource busy."** Something else has the card. Confirm the sound
servers are masked: `systemctl --global is-enabled pipewire.service`.

**The plugin picker is empty.** `lv2ls` lists what the system can see. If that
is empty too, no plugins are installed.

**`git pull` says local changes would be overwritten.** A copy from the PC left
files in `~/Pi-MFX` that differ from GitHub. From `~/Pi-MFX`:

```bash
git fetch origin
git reset --hard origin/dev
sudo bash ./scripts/pimfx.sh update
```

That throws away the copied files and matches GitHub. Banks stay in
`/var/lib/pimfx`. `update` must be run from the clone, not from `~`.

**Xruns.** See [LOW_LATENCY.md](LOW_LATENCY.md).

**Developing off the Pi.** The engine builds on Windows and macOS with a mock
audio backend, so the API and UI can be worked on without hardware:

```bash
cmake -S engine -B engine/build && cmake --build engine/build
cd ui && npm install && npm run dev
```
