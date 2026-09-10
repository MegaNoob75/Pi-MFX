# Daily build and test flow

Two machines, one job:

| Machine | What it is for |
| --- | --- |
| **This Windows PC** | Edit code in Cursor, commit on **`dev`**, push with GitHub Desktop |
| **Raspberry Pi 5** | Real audio, LV2 plugins, latency. Pull, rebuild, open the UI in a browser |

You do **not** need to build the C++ engine on Windows. Guitar I/O only exists on the Pi.

---

## One-time: Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. Enable SSH and set Wi-Fi or Ethernet.
2. Plug a USB audio interface **directly** into the Pi (no hub), or add your I2S HAT overlay and reboot. See [INSTALL.md](INSTALL.md).
3. SSH in (`ssh pi@<pi-address>`). The repo is private, so clone with SSH
   (not `https://`). Generate a key on the Pi, add `~/.ssh/id_ed25519.pub` to
   GitHub → SSH keys, then `ssh -T git@github.com` until it greets you.

```bash
sudo apt update
sudo apt install -y git
git clone -b dev git@github.com:MegaNoob75/Pi-MFX.git
cd Pi-MFX
sudo bash ./scripts/pimfx.sh
sudo reboot
```

The menu can install, update, set up a local touchscreen, or remove Pi-MFX.
On a first Pi pick **1) Complete setup** or **2) Install**.

4. After reboot, from any browser on the same network:

```
http://pimfx.local:8080
http://<pi-address>:8080
```

Anyone on that LAN or hotspot can control the Pi (no login).

5. **Settings → Audio**: pick the card, start at **48000 / 64 / 3**, play and watch xruns.

Write down the Pi’s IP (`hostname -I` on the Pi) so you can reuse it if mDNS is not available.

---

## Every day (the loop)

### On the PC

1. GitHub Desktop: branch **`dev`** (not `main`).
2. Edit in Cursor.
3. Desktop: **Commit** → **Push origin**.

### On the Pi

SSH in, then:

```bash
cd ~/Pi-MFX
sudo bash ./scripts/pimfx.sh
```

Pick **3) Update**, or run `sudo bash ./scripts/pimfx.sh update` **from `~/Pi-MFX`**. That pulls `dev`, rebuilds, copies the binary and UI, and restarts the service. Your banks and settings in `/var/lib/pimfx` are left alone. The same job is **Settings → System → Updates** in the UI.

If you copied files onto the Pi with MobaXterm, `git pull` can refuse to overwrite them. Either pick **4) Rebuild local files** (no pull), or throw the copies away and match GitHub:

```bash
cd ~/Pi-MFX
git fetch origin
git reset --hard origin/dev
sudo bash ./scripts/pimfx.sh update
```

### Test

Open `http://pimfx.local:8080` (phone, tablet, or this PC). Hard-refresh the page (**Ctrl+Shift+R**) so the browser does not keep an old UI.

Quick check on the Pi:

```bash
./scripts/status.sh
journalctl -u pimfx -n 40 --no-pager
```

---

## When `dev` is good enough for `main`

1. On the PC, push `dev`.
2. GitHub Desktop: **Branch → Create pull request**, or open  
   https://github.com/MegaNoob75/Pi-MFX/pull/new/dev
3. Base **main** ← compare **dev**. Merge when you are happy.
4. On the Pi, if you ever want the Pi to track `main` instead:

```bash
cd ~/Pi-MFX
git checkout main
git pull
sudo bash ./scripts/update.sh
```

For day-to-day work, stay on **`dev`** on both the PC and the Pi.

---

## Optional: look at the UI on Windows only

This uses a **mock** audio backend (silence). Useful later when the UI folder has a full app. It will not test guitar latency.

```powershell
cd C:\Users\ross7\Documents\GitHub\Pi-MFX
cd ui
npm install
npm run dev
```

---

## If something breaks

| Symptom | What to do |
| --- | --- |
| Page will not load | `systemctl status pimfx` and `journalctl -u pimfx -n 50` |
| `update.sh` says not installed | First time: `sudo bash ./scripts/pimfx.sh` and pick Install |
| `git pull` refused | On the Pi you have local edits. `git status`. Do not fight it — stash or reset only if you meant those files to come from the PC. |
| No sound card in the UI | `arecord -l` on the Pi. If empty, the OS cannot see the hardware. |
| Empty plugin list | `lv2ls`. If empty, open **Plugins** and install from apt or PatchStorage |
| Clicks / xruns | [LOW_LATENCY.md](LOW_LATENCY.md). Raise frames or periods. |

---

## Scripts

| Script | Where | What |
| --- | --- | --- |
| `scripts/pimfx.sh` | Pi, usual entry | Menu: install, update, touchscreen, boot logo, hotspot, status, remove |
| `scripts/install.sh` | Pi | Same as menu item Install |
| `scripts/update.sh` | Pi | Same as menu item Update |
| `scripts/boot-splash.sh` | Pi | PI-MFX boot / shutdown logo and quiet kernel text |
| `scripts/boot-speed.sh` | Pi | Skip network-wait and unused services |
| `scripts/install-hotspot.sh` | Pi | Wi-Fi hotspot helper used by Settings |
| `scripts/status.sh` | Pi, any time | Branch, service, cards |
| `scripts/uninstall.sh` | Pi | Same as menu item Remove |
| `scripts/dev-pc.ps1` | Windows, optional | Reminds you of the PC steps and checks you are on `dev` |
