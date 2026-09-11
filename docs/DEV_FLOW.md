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
3. SSH in (`ssh YOUR_USER@<pi-address>` — the account you created in Imager, not necessarily `pi`). The repo is private, so clone with SSH
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

### On Windows (how to develop without MobaXterm)

1. Install **OpenSSH Client** (Windows Settings → Optional features) so `ssh` and `scp` work in a Command Prompt.
2. Clone this repo on the PC (GitHub Desktop or `git clone -b dev …`).
3. Confirm you can log into the Pi from a prompt: `ssh YOUR_USER@YOUR_PI_HOST` (hostname `pimfx.local` or the Pi’s IP).
4. Double-click **`pimfx.cmd`** at the repo root.

First run asks for **hostname or IP**, **username**, and **password** (shown as you type). Those are saved in **`.pimfx-remote` in this clone only**. That file is gitignored — never commit it. Later runs offer the saved login; press Enter to keep it, or **L** in the menu to change it.

The numbered items match **`scripts/pimfx.sh` on the Pi**. The Windows script only SSHs and runs that file (plus item 0, which is PC-only). If you change install/update/display behaviour, change `pimfx.sh` (and the scripts it calls), not a second copy of the logic.

| Windows `pimfx.cmd` | What it runs on the Pi |
| --- | --- |
| 0 | Copy this PC’s tree over SSH, then `pimfx.sh rebuild` (no git pull, no push) |
| 1 | `pimfx.sh complete` (install + touchscreen) |
| 2 | `pimfx.sh install` |
| 3 | `pimfx.sh update --branch dev` |
| 4 | `pimfx.sh rebuild` |
| 5 | `pimfx.sh display` |
| 5r | `pimfx.sh display-refresh` |
| 6 | `pimfx.sh display-remove` |
| 7.1 / 7.2 | Boot logo install / remove (`splash`) |
| 8.1 / 8.2 / 8.3 | Faster boot skip-wait / unused / restore |
| 9 | Hotspot helper |
| 10 | Status |
| 11 | Remove Pi-MFX (asks before deleting `/var/lib/pimfx`) |
| 12 | Reboot the Pi |
| L | Change saved SSH login |
| 13 | Exit |

**`sync-to-pi.cmd`** is only item 0 (copy + rebuild). Use it for a tight edit/test loop after the Pi is already installed.

```powershell
.\pimfx.cmd
.\sync-to-pi.cmd
.\scripts\pimfx-win.ps1 -Action "update -y --branch dev"
```

After a copy or update, open `http://pimfx.local:8080` (or `http://<pi-ip>:8080`) and hard-refresh.

### On the PC (when you do want GitHub)

1. GitHub Desktop: branch **`dev`** (not `main`).
2. Edit in Cursor.
3. Desktop: **Commit** → **Push origin**.

### On the Pi (after a GitHub push)

SSH in, then:

```bash
cd ~/Pi-MFX
sudo bash ./scripts/pimfx.sh
```

Pick **3) Update**, or run `sudo bash ./scripts/pimfx.sh update` **from `~/Pi-MFX`**. That pulls `dev`, rebuilds, copies the binary and UI, and restarts the service. Your banks and settings in `/var/lib/pimfx` are left alone. The same job is **Settings → System → Updates** in the UI.

If the Pi has copies from this PC (`sync-to-pi.ps1` or MobaXterm), `git pull` can refuse to overwrite them. Either pick **4) Rebuild local files** (no pull), or throw the copies away and match GitHub:

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
| `pimfx.cmd` will not start | Install OpenSSH Client. `ssh` must work in Command Prompt. |
| Permission denied (publickey,password) | Wrong Pi username or password. Try `ssh USER@HOST` by hand. Not necessarily `pi`. |
| `git pull` refused | On the Pi you have local edits (often a copy from the PC). `git status`. Use menu **4** or reset only if you meant those files to come from GitHub. |
| No sound card in the UI | `arecord -l` on the Pi. If empty, the OS cannot see the hardware. |
| Empty plugin list | `lv2ls`. If empty, open **Plugins** and install from apt or PatchStorage |
| Clicks / xruns | [LOW_LATENCY.md](LOW_LATENCY.md). Raise frames or periods. |

---

## Scripts

| Script | Where | What |
| --- | --- | --- |
| `scripts/pimfx.sh` | Pi, usual entry | Menu: install, update, touchscreen, boot logo, hotspot, status, remove |
| `pimfx.cmd` / `scripts/pimfx-win.ps1` | Windows | Same menu over SSH, plus copy-this-PC. Login saved in `.pimfx-remote` (not git) |
| `sync-to-pi.cmd` | Windows | Shortcut: copy this folder to the Pi and rebuild |
| `scripts/install.sh` | Pi | Same as menu item Install |
| `scripts/update.sh` | Pi | Same as menu item Update |
| `scripts/boot-splash.sh` | Pi | PI-MFX boot / shutdown logo and quiet kernel text |
| `scripts/boot-speed.sh` | Pi | Skip network-wait and unused services |
| `scripts/install-hotspot.sh` | Pi | Wi-Fi hotspot helper used by Settings |
| `scripts/status.sh` | Pi, any time | Branch, service, cards |
| `scripts/uninstall.sh` | Pi | Same as menu item Remove |
| `scripts/dev-pc.ps1` | Windows, optional | Reminds you of the PC steps and checks you are on `dev` |
