# Backup and restore

Recovery workflow: install a fresh supported Raspberry Pi OS, run the Pi-MFX
installer, then restore one exported `.pimfx-backup` file.

This implementation needs maintainer validation on the Pi 5 before relying on
it as the only recovery copy. Use a spare drive for the first full recovery test.

## Create a backup

Open **Settings → Backup & Restore → Back Up**. Choose **Full Backup** or
**Choose Content**, select an export destination, enter and confirm the backup
password, and select **Export Backup to USB** or **Prepare Backup Download**.

All backups use ZIP64 compression before optional encryption. Standard
compression (DEFLATE level 6) reduces compressible models, presets, settings and
audio; already compressed installers/media may shrink little further.

When including Plugins, choose how they will be recovered:

- **Smaller backup — reinstall downloadable plugins** (default): saves exact
  installed package versions, repository download locations, sizes and SHA-256
  checksums instead of those installers. Restore downloads only needed packages
  and verifies them before replacing rig data. Internet access is required, and
  the recorded versions must still be available; a removed release causes a
  clear failure rather than installing a different version.
- **Self-contained backup — include plugin installers**: includes the exact
  installers and dependencies so plugin restoration needs no downloads. This
  uses more space and is the safer choice for long-term recovery.

Both options retain manually installed LV2 bundles and plugin state. Packages
without an exact repository download record are bundled too. A name alone is
not sufficient to recover a private/manual plugin or a retired release. NAM,
AIDA-X and IR files are always copied when their categories are selected.
The completed backup and restore preview show the number of downloaded versus
bundled packages and the possible download size.

On the Pi touchscreen, export to a mounted USB drive. The destination must be
on a different physical disk from both the OS and Pi-MFX data. Connect and
mount the drive using the OS, then select **Refresh USB Drives**. Pi-MFX writes
to `Pi-MFX Backups/` on that drive, flushes the file and directory, and reads
the exported file back to verify its SHA-256 checksum.

Choose the destination before starting. From another computer/tablet, a supported
browser over a secure connection can offer a writable save-file picker. Pi-MFX
automatically streams the completed archive into that chosen file and deletes
its temporary archive only after the destination stream closes successfully.
The completion report remains available. Browsers without a writable picker,
including ordinary HTTP connections, can choose **Download to this computer /
tablet**. The browser controls the save prompt or Downloads-folder destination;
enable its "Ask where to save each file" setting before starting if desired.
The page requests the download when a new backup finishes and offers **Download
Backup** for blocked downloads or existing prepared archives. Wait for download
completion, check the saved file, then choose **I Have Checked the Saved Backup**
to remove the Pi's temporary archive. A requested download alone never confirms
export success or triggers cleanup. An interrupted/unconfirmed export retains
its archive for retry. The attached loopback browser cannot download onto the
Pi's own drive as a recovery destination.

Reports for older backups omit file count/duration when those fields are absent,
rather than displaying misleading zero values.

The Backup page stays visible through the engine's deliberate restart and shows
the finished report: destination, filename, size, file count, duration, encryption,
categories, plugin recovery information, and checksum. Up to four worker threads
hash independent files in bounded batches. Copying the consistent snapshot and
writing the ZIP remain serial to limit storage contention.

Full backups contain:

- Banks, presets, routing, snapshots, assignments and active selection.
- All NAM, AIDA-X and IR libraries, with their folder structure and provenance.
- User-installed LV2 bundles and exact installed Debian plugin package records.
  Plugin dependencies and optional display/boot packages follow the selected
  plugin recovery option. Bundled installers come from cached/downloaded
  packages, or repacked installed payloads when an old release is unavailable.
  A dependency that cannot be recorded or bundled fails the backup instead of
  being silently omitted.
- Audio settings/calibration, controller mappings, Virtual Controls, interface
  preferences, layouts, themes, keyboard themes and saved setup profiles.
- Backing tracks, metadata, playlists/set lists, saved loops, multitrack
  projects/takes/recovery files, drums, kits, patterns and songs.
- Pi-MFX account credentials, access password/session hashes and Pi-MFX-managed
  Wi-Fi/hotspot connections.
- Pi-MFX touchscreen, boot-speed, quiet-splash and web-port choices.
- Other persistent files in the data root, including Community metadata.

The engine captures unsaved preset drafts separately from stored base presets.
Restored drafts remain unsaved: **Reload** can still recover the stored base.
A current loop is saved as **Backup current loop** when preparing a backup or
restore. Undo history and running playback/transport positions are transient.
Stop recording/overdubbing and finish model downloads before starting.

Audio pauses while a consistent file copy and plugin inventory are taken. It
resumes while installation packages are collected and the archive is built.
Recovery jobs run independently of the engine and helper service, so engine
restarts or browser reconnection do not cancel the job.

Backups containing Connections, Plugins or Other Persistent Files require a
password of at least eight characters. The password is not stored with the
archive and cannot be recovered. Encryption is also available for smaller
library-only backups. Keep the password with your recovery records.

## Restore

Install Pi-MFX, open **Settings → Backup & Restore → Restore**, and import the
archive from your computer or browse `Pi-MFX Backups/` on the USB drive. Enter
the backup password before importing an encrypted archive.

Pi-MFX verifies archive paths, declared sizes, checksums, encryption and format
before offering the restore preview. Choose **Restore Everything** for a full
archive, or **Choose Content** to select categories and optional individual
files, banks or presets. Banks generally need their Models, IRs and Plugins;
missing referenced assets are reported before the data replacement. When
individual files/presets are selected, selected Models, IRs and Plugins are
included as dependencies; other unpicked categories are left alone.

Selective restore offers **Replace**, **Keep Existing** and **Import as Copies**.
Copies support banks/presets, models, IRs, layouts and profiles. Media projects
use Keep or Replace. Copied banks/presets receive new identities and matching
storage filenames; copied asset paths and imported references are remapped.
Settings-only restore keeps the current bank/preset selection and assignments.
Replacing a whole category intentionally removes its existing files; selecting
individual files/presets replaces only those items.

Restore only a trusted archive. Plugin packages contain executable software and
can run installation scripts. Pi-MFX stages the data, validates it, retains the
previous data directory, flushes the staged files, and records a durable journal
before applying the replacement. Required recorded packages are downloaded and
verified first, while audio is still running; then verified local installers
are applied with network downloads disabled. A missing/corrupt download fails
before rig replacement or package installation. Already installed exact
versions need no download. Exact plugin versions are restored; compatible
newer OS dependencies already installed on the destination are retained.

Full/settings/plugin/connection/installation restoration requires matching OS
identity/version and architecture. Portable libraries can be selected when
those differ. Unsupported archive/settings/preset formats are rejected. Numeric
ALSA card indices are mapped using the saved card identity; missing cards keep
their stable name so an unrelated interface is not selected by its old index.
Review Audio and Controller after restoring and reconnect missing hardware.

Pi-MFX reapplies optional touchscreen/boot choices through the fresh installer's
setup scripts. An unavailable normal login user or missing OS dependency is
reported as **needs attention**, separately from successful rig-data recovery.
Reboot after reviewing the restored settings to activate network, port and boot
changes. Use the restored Pi-MFX access password when reconnecting; an expired
TONE3000 login may require signing in again.

**Roll Back Pi-MFX Data** returns to the data retained before the last restore.
Package installations and OS setup changes remain and may need separate review.
If power fails before the data transaction commits, a boot guard restores the
previous data before the engine opens the rig. A committed restore interrupted
during OS setup is reported for review instead of remaining stuck as running.

The installer menu running directly on the Pi has **16) Restore an exported backup**.
The Windows menu's item 16 removes Pi-MFX; use the app's Backup & Restore screen
or run the Pi menu for recovery. The Pi restore option prompts for
the archive path and password, verifies it, shows the contents, and requires
typing `RESTORE`. The same workflow is available from:

```sh
sudo bash ./scripts/pimfx.sh restore
```

For selective command-line recovery, use the installed tool with category IDs:

```sh
sudo python3 /usr/local/libexec/pimfx/backup.py restore /media/USER/USB/Pi-MFX\ Backups/FILE.pimfx-backup --categories models irs
```

Command-line backups default to the smaller plugin option. Add
`--plugin-mode self-contained` to the installed tool's `backup` command to
include all plugin installers. New archives use format version 2; self-contained
version-1 recovery archives remain readable.

Old `pimfx-ui-backup` version-1 JSON files can be imported through **Old
Configuration Backup** or a computer upload. They restore only their original
configuration sections; they do not recover libraries, banks or media. Existing
bank/preset/theme/layout/profile exports remain available for sharing and setup
switching, and their saved files are included where applicable.

## Working space and recovery files

The helper owns a workspace beside the data root (`/var/lib/pimfx-recovery` for
the standard install). It is outside the replaceable rig directory. Consistent
copies, packages, the archive and verified imports use disk space there. Backup
preflight conservatively reserves three times the selected persistent file
size plus working space; bundled plugin packages need additional space. Restore needs
space for the imported archive, verified contents and a candidate data root
while retaining the previous data. Large media libraries therefore need
substantial free space even when exporting to USB.
Recorded plugin downloads also need temporary space during restore and are
removed when the restore job finishes or fails.

Generated backup archives, partial downloads, caches, logs, engine-running
markers and the old installer checkout path are not recursively archived. The
fresh installer checkout is retained on restore. Symlinks that escape a
library, special files, unsafe paths and archive entries outside approved
destinations are rejected. Ordinary file aliases inside a library are copied
as files. Failed/imported jobs and previous data copies remain available for
diagnosis; remove unneeded temporary archives with the UI, and manage retained
recovery history before it exhausts the drive.

## Maintainer validation on Pi 5

No Windows/native build or runtime sign-off accompanies the source change.
Python source parsing and `git diff --check` passed on Windows. The Windows
shell parser could not start because its MSYS runtime was denied access; shell
parsing, UI checks and runtime tests remain pending on the Pi.
After the normal Pi rebuild installs the helper/dependencies and guard unit:

```sh
python3 -B -m unittest discover -s scripts/tests -p test_backup.py
```

Parse the changed shell scripts on the Pi before running the setup changes:

```sh
for file in scripts/install-recovery.sh scripts/install.sh scripts/update.sh scripts/pimfx.sh scripts/boot-splash.sh scripts/uninstall.sh; do
    bash -n "$file" || exit 1
done
```

These fixture tests do not touch the live rig, services, apt or USB. Also run
the normal UI typecheck/regression checks and the existing native storage tests
on the Pi. Then perform the following device checks:

1. Full backup containing multiple banks, snapshots, unsaved drafts, NAM/IR
   files, layouts, custom keyboard themes, plugins, recording projects, drums,
   backing tracks, set lists, saved/current loops and credentials.
2. Export via USB and computer download; verify checksums and restore an archive
   larger than 4 GiB with bounded memory. Reject an export onto the OS/data disk.
3. Fresh OS on a spare drive → installer → restore → reboot. Compare file
   contents, identifiers, layouts, assignments, plugin versions, calibration,
   recording projects and sound. Check touchscreen/boot/port/network settings.
4. Restore individual presets with required dependencies, settings alone,
   libraries alone, Keep Existing and bank copies. Confirm unselected data and
   intentionally empty libraries survive correctly.
5. Wrong password, ciphertext/ZIP corruption, path traversal, unknown format,
   missing dependencies, OS mismatch, insufficient space and interrupted USB
   writes. Existing rig data must survive failures.
6. Engine/helper/browser reconnection, power interruption at each data-commit
   boundary, startup recovery and manual data rollback. Inspect package/OS
   changes separately when an installation step fails.
7. Missing/reordered USB audio and MIDI devices; expired external logins; active
   recording, overdubbing, file writes and downloads blocking preparation.
8. Both plugin recovery options: confirm smaller archives omit downloadable
   package payloads but retain manual/unavailable plugins. Restore with internet,
   with exact packages already installed, without internet, and with a recorded
   release removed or changed. Confirm failed downloads retain the current rig.
   Restore a self-contained archive with network disconnected, and import an
   earlier version-1 archive.
