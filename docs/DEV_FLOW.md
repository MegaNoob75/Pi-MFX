# Daily build and test flow

Two machines, one job:

| Machine | What it is for |
| --- | --- |
| **This Windows PC** | Edit the current feature set on **`dev`** or a short-lived feature branch |
| **Raspberry Pi 5** | Real audio, LV2 plugins, latency. Pull, rebuild, open the UI in a browser |

You do **not** need to build the C++ engine on Windows. Guitar I/O only exists on the Pi.

---

## One-time: Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. Enable SSH and set Wi-Fi or Ethernet.
2. Plug a USB audio interface **directly** into the Pi (no hub), or add your I2S HAT overlay and reboot. See [INSTALL.md](INSTALL.md).
3. SSH in (`ssh YOUR_USER@<pi-address>` — the account you created in Imager, not necessarily `pi`). Clone the public repository over HTTPS; no GitHub
   account, password, token, or personal SSH key is needed on the Pi.

```bash
sudo apt update
sudo apt install -y git
git clone -b dev https://github.com/MegaNoob75/Pi-MFX.git
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

Set a Pi-MFX password before remote use. Remote browsers sign in; the attached
loopback touchscreen stays unlocked. See [REMOTE_ACCESS.md](REMOTE_ACCESS.md).

5. **Settings → System → Audio**: pick the card, start conservatively (for
   example **48000 / 128 / 3**), play and watch XRuns before reducing buffers.

Write down the Pi’s IP (`hostname -I` on the Pi) so you can reuse it if mDNS is not available.

---

## Every day (the loop)

### On Windows (how to develop without MobaXterm)

1. Install **OpenSSH Client** (Windows Settings → Optional features) so `ssh` and `scp` work in a Command Prompt.
2. Clone this repo on the PC (GitHub Desktop or `git clone -b dev …`).
3. Confirm you can log into the Pi from a prompt: `ssh YOUR_USER@YOUR_PI_HOST` (hostname `pimfx.local` or the Pi’s IP).
4. Double-click **`pimfx.cmd`** at the repo root.

First run asks for **hostname or IP**, **username**, and **password** (shown as you type). Those are saved in **`.pimfx-remote` in this clone only**. That file is gitignored — never commit it. Later runs offer the saved login; press Enter to keep it, or **L** in the menu to change it.

Most numbered items match **`scripts/pimfx.sh` on the Pi**. The Windows menu runs
work over SSH; firmware choices stage source and call the controller helper on
the Pi. Builds and flashing happen on the Pi. Keep both menus aligned when
changing their entries; maintenance numbering differs as noted below.

| Windows `pimfx.cmd` | What it runs on the Pi |
| --- | --- |
| C | Copy this PC’s tree over SSH, then `pimfx.sh rebuild` (no git pull, no push) |
| 1 | `pimfx.sh complete` (install + touchscreen) |
| 2 | `pimfx.sh install` |
| 3 | Choose `dev` for development or `main` for a release, then update |
| 4 | `pimfx.sh rebuild` |
| 5 | First-time ESP32-S3 USB installation; source selection, automatic detection, confirmation and verification |
| 6 | Update controller firmware from GitHub; choose Main, Dev or Workstation |
| 7 | Update controller firmware from this PC, including local edits |
| 8 | `pimfx.sh display` |
| 9 | `pimfx.sh display-refresh` |
| 10 | `pimfx.sh display-remove` |
| 11 | Boot logo install / remove (`splash`) |
| 12 | Faster boot skip-wait / unused / restore |
| 13 | Hotspot helper |
| 14 | Status |
| 15 | Reboot the Pi |
| 16 | Remove Pi-MFX; the Pi menu instead uses 16 for backup restore and 17 for removal |
| L | Change saved SSH login |
| 0 | Exit |

**`sync-to-pi.cmd`** performs the copy + rebuild operation available as **C**.
Use it for a tight edit/test loop after the Pi is already installed.

For a blank controller, the sequence is **1 (or 2) → 5 → Hardware Setup**.
Connect the ESP32-S3 to the Pi, hold BOOT, tap RESET and release BOOT when
prompted. A single matching Espressif download port is selected automatically;
otherwise choose the Pi port from the list. Check the target and type `INSTALL`.
No Arduino IDE is required. Options 6/7 remain updates for controllers that already
have a compatible receiver. See [Flash once](DIY_CONTROLLER.md#flash-once).
Initial USB provisioning still needs physical validation on the Pi and controller.

```powershell
.\pimfx.cmd
.\sync-to-pi.cmd
.\scripts\pimfx-win.ps1 -Action "update -y --branch dev"
```

After a copy or update, open `http://pimfx.local:8080` (or `http://<pi-ip>:8080`) and hard-refresh.

### On the PC (when you do want GitHub)

1. GitHub Desktop: use **`dev`** for the integrated feature set, or a
   short-lived feature branch for isolated work.
2. Edit in Cursor.
3. Desktop: **Commit** → **Push origin**.

### On the Pi (after a GitHub push)

SSH in, then:

```bash
cd ~/Pi-MFX
sudo bash ./scripts/pimfx.sh
```

Pick **3) Update** and choose the branch, or run `sudo bash
./scripts/pimfx.sh update --branch dev` **from `~/Pi-MFX`**. That
pulls the selected branch, rebuilds, copies the binary and UI, and restarts the
service. Your banks and settings in `/var/lib/pimfx` are left alone. The same
job is **Settings → System → Updates** in the UI.

If the Pi has copies from this PC (`sync-to-pi.ps1` or MobaXterm), `git pull` can refuse to overwrite them. Either pick **4) Rebuild local files** (no pull), or throw the copies away and match GitHub:

```bash
cd ~/Pi-MFX
git fetch origin
git reset --hard origin/dev
sudo bash ./scripts/pimfx.sh update --branch dev
```

### Test

Open `http://pimfx.local:8080` (phone, tablet, or this PC). Hard-refresh the page (**Ctrl+Shift+R**) so the browser does not keep an old UI.

For 1.0 stabilization, use [V1_READINESS.md](V1_READINESS.md). Record the exact
running commit, audio settings, plugins/models, duration, and results. All
native compilation and runtime testing for this workflow are done by the
maintainer on the Pi 5; CMake is not installed on this Windows workstation.
Static review and documentation edits do not count as completed device tests.

Quick check on the Pi:

```bash
./scripts/status.sh
journalctl -u pimfx -n 40 --no-pager
```

---

## Branch flow

All current features belong to `dev`. Separate branches were used to test
individual features during development; they are not product release stages.
Freeze new feature work while preparing 1.0; use the readiness report
to prioritize fixes. Continue current work from `dev`, using a short-lived
feature branch when isolation is useful. Move `main` only when intentionally
promoting a tested release. To make a Pi track `main` instead:

```bash
cd ~/Pi-MFX
git checkout main
git pull
sudo bash ./scripts/update.sh
```

For the current feature set, keep both the PC and Pi on **`dev`** unless you
are deliberately testing the released `main` branch. The old `workstation`
branch is historical and is retained only for compatibility.

---

## Optional: look at the UI on Windows only

The normal page expects an engine at port 8080. For documentation and visual
work without an engine, use the read-only fixture:

```powershell
cd ui
npm install
npm run dev
```

Open `http://127.0.0.1:5173/docs.html?view=performance`. Neither workflow tests
Pi audio, LV2 loading, physical controls, latency, or XRuns.
The screenshot assets are excluded from this review and were not regenerated.

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
| `scripts/dev-pc.ps1` | Windows, optional | Prints the PC-side checklist and current branch |
