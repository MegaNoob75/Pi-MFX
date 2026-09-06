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

```bash
git clone https://github.com/MegaNoob75/Pi-MFX.git
cd Pi-MFX
sudo ./scripts/install.sh
```

This builds the engine and the UI, creates a `pimfx` service account, installs
a systemd service, and tunes the OS for audio. Everything it changes is listed
in [LOW_LATENCY.md](LOW_LATENCY.md) and undone by `scripts/uninstall.sh`.

Useful options:

```bash
sudo ./scripts/install.sh --with-plugins   # also install a starter LV2 set
sudo ./scripts/install.sh --no-tuning      # service only, no system changes
sudo ./scripts/install.sh --port 8000      # different web port
```

Pi-MFX ships no effects. `--with-plugins` installs packages from the Raspberry
Pi OS repositories under their own licenses; see
[PLUGIN_LICENSES.md](PLUGIN_LICENSES.md). You can skip it and install plugins
yourself later — anything LV2 shows up in the picker.

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

**Editor** → add effects. If the picker is empty, no LV2 plugins are installed;
install some and press Rescan.

For amp captures and cabs you need a NAM-capable LV2 plugin and a convolution
plugin. Once installed, effects that take a `.nam` file or an impulse response
show a file button that opens the Pi-MFX library, including anything you
downloaded from TONE3000.

## 7. Optional: foot controller

**Settings → Controller**. See [DIY_CONTROLLER.md](DIY_CONTROLLER.md) to build
one. You do not need one — the browser is a complete control surface, and the
Performance screen gives you on-screen switches.

## Optional: kiosk mode on a local touchscreen

On a Pi with the desktop installed:

```bash
sudo apt install -y chromium-browser unclutter
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/pimfx-kiosk.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Pi-MFX
Exec=chromium-browser --kiosk --incognito --noerrdialogs --disable-infobars http://localhost:8080
X-GNOME-Autostart-enabled=true
EOF
```

A desktop session costs CPU. If latency matters more than a local screen, use
Lite and control Pi-MFX from a tablet.

## Updating

After the first install, use the short update script (pull, rebuild, restart).
It does not redo apt or OS tuning.

```bash
cd ~/Pi-MFX
sudo bash ./scripts/update.sh
```

Day-to-day PC + Pi steps are in [DEV_FLOW.md](DEV_FLOW.md).

Your banks, settings, models, and IRs live in `/var/lib/pimfx` and are not
touched by an update or a reinstall. Run `sudo ./scripts/install.sh` again only
if you need new system packages or want to re-apply tuning.

## Removing

```bash
sudo ./scripts/uninstall.sh          # keeps your data
sudo ./scripts/uninstall.sh --purge  # deletes /var/lib/pimfx too
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

**Xruns.** See [LOW_LATENCY.md](LOW_LATENCY.md).

**Developing off the Pi.** The engine builds on Windows and macOS with a mock
audio backend, so the API and UI can be worked on without hardware:

```bash
cmake -S engine -B engine/build && cmake --build engine/build
cd ui && npm install && npm run dev
```
