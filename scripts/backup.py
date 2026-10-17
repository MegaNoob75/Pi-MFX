#!/usr/bin/env python3
"""Pi-MFX recovery archives and supervised jobs. Never imported by the audio thread.

The helper owns the workspace outside the replaceable data root. Archives are
ZIP64, optionally wrapped in authenticated AES-256-GCM encryption. Extraction
never uses extractall, archive names never name host destinations, and restore
requires an explicit trusted-archive confirmation before installing executable
plugin packages. CLI and HTTP use the same validation and restore machinery.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
from concurrent.futures import ThreadPoolExecutor
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import pwd
import re
import shlex
import shutil
import stat
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
import zipfile

DATA = Path(os.environ.get("PIMFX_DATA_ROOT", "/var/lib/pimfx")).absolute()
if DATA.parent == DATA or len(DATA.parts) < 3:
    raise ValueError("recovery requires a dedicated Pi-MFX data directory")
STATE = DATA.parent / (DATA.name + "-recovery")
PREFIX = Path(os.environ.get("PIMFX_PREFIX", "/usr/local"))
USER = os.environ.get("PIMFX_USER", "pimfx")
MAGIC = b"PIMFXENC\x01"
BLOCK = 1024 * 1024
MAX_FILES = 250000
MAX_MANIFEST = 64 * BLOCK
CATEGORIES = {
    "banks": "Banks, presets and snapshots", "models": "NAM and AIDA-X models",
    "irs": "Impulse responses", "plugins": "Plugins and dependencies",
    "settings": "Audio, controller and interface settings", "layouts": "Layouts and themes",
    "profiles": "Setup and controller profiles", "backing": "Backing tracks and set lists",
    "loops": "Saved loops", "recordings": "Recording projects and takes",
    "drums": "Drum samples, kits, patterns and songs", "connections": "Accounts, Wi-Fi and access password",
    "exports": "Saved exports", "other": "Other persistent Pi-MFX files",
    "installation": "Touchscreen, boot and installation options",
}
DIR_CATEGORIES = {
    "banks": "banks", "models": "models", "aidax": "models", "irs": "irs", "lv2": "plugins",
    ".lv2": "plugins",
    "layouts": "layouts", "virtual-control-layouts": "layouts", "themes": "layouts",
    "controller-profiles": "profiles", "setup-profiles": "profiles", "backing-tracks": "backing",
    "loops": "loops", "recordings": "recordings", "drums": "drums", "bank-exports": "exports",
    "plugin-runtime": "plugins",
}
FILE_CATEGORIES = {"settings.json": "settings", "plugins.json": "plugins",
                   "credentials.json": "connections", "access.json": "connections", "hotspot.json": "connections",
                   "backup-session.json": "banks", "tone3000-assets.json": "models"}
SKIP = {"engine-running", "source-repo", "banks-transaction.json", "backup-session.pending.json",
        "patchstorage-cache.json", "tone3000-cache.json", "lv2-update-status.json",
        "controller-firmware-status.json", "controller-firmware-policy.json",
        "controller-firmware-reconnect.json", "controller-firmware.lock", "controller-firmware-github.json"}
# Only these root-owned configuration files can ever be written by a restore.
SYSTEM_FILES = {
    "wifi": "/etc/NetworkManager/system-connections/pimfx-wifi.nmconnection",
    "hotspot": "/etc/NetworkManager/system-connections/pimfx-hotspot.nmconnection",
    "audio-rules": "/etc/udev/rules.d/95-pimfx-audio.rules",
    "audio-limits": "/etc/security/limits.d/95-pimfx-audio.conf",
    "usb-audio": "/etc/modprobe.d/95-pimfx-audio.conf",
}
PACKAGE = re.compile(r"^[a-z0-9][a-z0-9.+-]*(?::[a-z0-9_-]+)?$")
ID = re.compile(r"^[a-f0-9]{32}$")


def system_target(key):
    if key in SYSTEM_FILES:
        return Path(SYSTEM_FILES[key])
    if re.fullmatch(r"wifi-[a-f0-9]{32}", key):
        return Path("/etc/NetworkManager/system-connections") / ("pimfx-" + key + ".nmconnection")
    raise ValueError("unapproved system configuration file")


def connection_key(key):
    return key == "hotspot" or key.startswith("wifi")


def command(args, timeout=120, check=True, cwd=None):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout, cwd=cwd,
                            env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"})
    if check and result.returncode:
        raise ValueError(result.stderr.strip()[-2000:] or f"{args[0]} failed")
    return result


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "w", encoding="utf-8", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out, ensure_ascii=False, separators=(",", ":"))
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    sync_dir(path.parent)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError:
        return {} if default is None else default


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(BLOCK), b""):
            h.update(chunk)
    return h.hexdigest()


def job_dir(job):
    if not isinstance(job, str) or not ID.fullmatch(job):
        raise ValueError("invalid recovery job")
    return STATE / "jobs" / job


def status(job, **values):
    directory = job_dir(job)
    previous = read_json(directory / "status.json")
    previous.update(values, id=job, updatedAt=time.time())
    write_json(directory / "status.json", previous)
    return previous


def category(relative):
    p = PurePosixPath(relative)
    return FILE_CATEGORIES.get(relative, DIR_CATEGORIES.get(p.parts[0], "other"))


def excluded(relative):
    p = PurePosixPath(relative)
    return (p.parts[0] in {"downloads", "backups", ".backup-upload", "controller-build", "controller-source", "controller-github"} or relative in SKIP
            or any(s.endswith((".tmp", ".part", ".log")) or s == "__pycache__" for s in p.parts))


def regular_files(root, skip_data=False):
    """Do not follow links to secrets or devices outside an owned data tree."""
    root = Path(root)
    if root.is_symlink():
        raise ValueError(f"symbolic link needs attention before backup: {root}")
    if not root.exists():
        return
    for directory, dirs, files in os.walk(root, followlinks=False):
        if skip_data:
            dirs[:] = [name for name in dirs if not excluded((Path(directory) / name).relative_to(root).as_posix())]
            files = [name for name in files if not excluded((Path(directory) / name).relative_to(root).as_posix())]
        for name in sorted(dirs + files):
            path = Path(directory) / name
            if path.is_symlink():
                # File aliases contained in the tree can be archived as ordinary
                # files. Never follow links outside the selected library.
                resolved = path.resolve()
                if name in dirs or not resolved.is_relative_to(root.resolve()) or not resolved.is_file():
                    raise ValueError(f"symbolic link needs attention before backup: {path}")
        dirs.sort()
        for name in sorted(files):
            path = Path(directory) / name
            if not path.is_file():
                raise ValueError(f"unsupported special file: {path}")
            yield path


def system_identity():
    info = {}
    for line in Path("/etc/os-release").read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            if key in {"ID", "VERSION_ID"}:
                info[key] = value.strip('"')
    return {"os": info, "machine": platform.machine(),
            "architecture": command(["dpkg", "--print-architecture"]).stdout.strip()}


def hardware_identity(settings):
    result = {}
    for section, key in (("audio", "device"), ("audio", "captureDevice"), ("controller", "midiPort")):
        value = settings.get(section, {}).get(key, "")
        match = re.fullmatch(r"((?:plug)?hw:)([0-9]+)((?:,[0-9]+){0,2})", value) if isinstance(value, str) else None
        if not match:
            continue
        path = Path("/proc/asound") / ("card" + match.group(2)) / "id"
        if path.is_file():
            result[section + "." + key] = {"prefix": match.group(1), "card": path.read_text().strip(), "suffix": match.group(3)}
    return result


def restore_hardware(settings, hardware):
    for field, identity in hardware.items():
        if field not in {"audio.device", "audio.captureDevice", "controller.midiPort"} or not isinstance(identity, dict):
            raise ValueError("invalid hardware identity")
        card, prefix, suffix = identity.get("card", ""), identity.get("prefix", ""), identity.get("suffix", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", card) or prefix not in {"hw:", "plughw:"} or not re.fullmatch(r"(?:,[0-9]+){0,2}", suffix):
            raise ValueError("invalid ALSA hardware identity")
        matches = [path.parent.name.removeprefix("card") for path in Path("/proc/asound").glob("card[0-9]*/id") if path.read_text().strip() == card]
        # A missing card keeps its stable name instead of opening an unrelated
        # interface that happened to receive the old numeric card index.
        target = matches[0] if len(matches) == 1 else card
        section, key = field.split(".")
        settings.setdefault(section, {})[key] = prefix + target + suffix
    return settings


def service_running():
    return command(["systemctl", "is-active", "--quiet", "pimfx.service"], check=False).returncode == 0


def promote_session(root):
    pending = root / "backup-session.pending.json"
    if pending.is_file() and not pending.is_symlink():
        os.replace(pending, root / "backup-session.json")
        sync_dir(root)


def prepare_engine():
    if not service_running():
        return {}
    line = command(["systemctl", "show", "pimfx.service", "--property=ExecStart", "--value"]).stdout
    match = re.search(r"--port\s+(\d+)", line)
    port = int(match.group(1)) if match else 8080
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/backup/prepare", data=b"{}",
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=45) as response:
        value = json.load(response)
    if value.get("ok") is not True:
        raise ValueError(value.get("error", "could not prepare the engine for recovery"))
    return value


@contextlib.contextmanager
def stopped_engine(job):
    was_running = service_running()
    status(job, message="Pausing audio and finishing disk writes")
    command(["systemctl", "stop", "pimfx.service"])
    try:
        if read_json(job_dir(job) / "status.json").get("action") == "create" and (DATA / "banks-transaction.json").exists():
            raise ValueError("bank storage has an unfinished transaction; recover it before backing up")
        yield
    finally:
        if was_running:
            journal = read_json(STATE / "restore-journal.json")
            if journal.get("job") != job or journal.get("phase") == "committed":
                promote_session(DATA)
                command(["systemctl", "start", "pimfx.service"])


def devices():
    """Mounted USB/removable filesystems, on a different disk from the data root."""
    tree = json.loads(command(["lsblk", "--json", "--paths", "--output", "NAME,PKNAME,TRAN,RM,MOUNTPOINTS"]).stdout)
    mounts = []
    source_devices = {os.path.realpath(command(["findmnt", "-n", "-o", "SOURCE", "-T", path]).stdout.strip().split("[")[0]) for path in (DATA, Path("/"))}
    rows = []
    def walk(items, disk=None, removable=False):
        for item in items:
            name = item["name"]
            owner = disk or name
            portable = removable or bool(item.get("rm")) or item.get("tran") == "usb"
            rows.append((name, owner, portable, item.get("mountpoints") or []))
            walk(item.get("children") or [], owner, portable)
    walk(tree.get("blockdevices", []))
    protected_disks = {owner for name, owner, _, _ in rows if os.path.realpath(name) in source_devices}
    if not protected_disks:
        return []  # Unknown backing device must not be treated as an external drive.
    for name, owner, portable, points in rows:
        if not portable or owner in protected_disks:
            continue
        for mount in points:
            if not mount or not mount.startswith(("/media/", "/run/media/", "/mnt/")):
                continue
            path = Path(mount)
            if path.is_symlink() or not os.path.ismount(path):
                continue
            mounts.append({"id": hashlib.sha256((name + mount).encode()).hexdigest()[:32],
                           "name": path.name, "mount": mount, "freeBytes": shutil.disk_usage(path).free})
    return mounts


def usb_destination(device):
    match = next((item for item in devices() if item["id"] == device), None)
    if not match:
        raise ValueError("USB drive is missing or is on the same disk as Pi-MFX")
    path = Path(match["mount"]) / "Pi-MFX Backups"
    if path.is_symlink():
        raise ValueError("backup folder cannot be a symbolic link")
    path.mkdir(exist_ok=True)
    return path


def crypt_file(source, destination, password, encrypt):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    if not password or len(password) > 1024:
        raise ValueError("enter the backup password (maximum 1024 characters)")
    with open(source, "rb") as inp, open(destination, "wb") as out:
        if encrypt:
            salt, nonce = os.urandom(16), os.urandom(8)
            header = MAGIC + salt + nonce
        else:
            header = inp.read(len(MAGIC) + 24)
            if len(header) != len(MAGIC) + 24 or not header.startswith(MAGIC):
                raise ValueError("invalid encrypted backup header")
            salt, nonce = header[len(MAGIC):len(MAGIC)+16], header[-8:]
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=600000).derive(password.encode())
        cipher = AESGCM(key)
        counter = 0
        if encrypt:
            out.write(header)
        try:
            while True:
                sequence = struct.pack(">I", counter)
                if encrypt:
                    block = inp.read(BLOCK)
                    record = cipher.encrypt(nonce + sequence, block, header + sequence)
                    out.write(struct.pack(">I", len(record)))
                    out.write(record)
                    if not block:  # Authenticated end marker rejects truncation at a record boundary.
                        break
                else:
                    length = inp.read(4)
                    if len(length) != 4:
                        raise ValueError("missing authenticated backup end marker")
                    count = struct.unpack(">I", length)[0]
                    if not 16 <= count <= BLOCK + 16:
                        raise ValueError("invalid encrypted record size")
                    record = inp.read(count)
                    block = cipher.decrypt(nonce + sequence, record, header + sequence)
                    if not block:
                        if inp.read(1):
                            raise ValueError("unexpected data after backup end marker")
                        break
                    out.write(block)
                counter += 1
        except Exception as exc:
            raise ValueError("incorrect password or damaged encrypted backup") from exc
        out.flush()
        os.fsync(out.fileno())


def package_specs(names):
    if not names:
        return []
    result = command(["apt-cache", "depends", "--installed", "--recurse", "--no-recommends", "--no-suggests",
                      "--no-conflicts", "--no-breaks", "--no-replaces", "--no-enhances", *sorted(names)])
    candidates = set(names)
    candidates.update(line for line in result.stdout.splitlines() if PACKAGE.fullmatch(line))
    result = command(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n",
                      *sorted(candidates)], check=False)
    specs = []
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) == 4 and fields[3] == "installed":
            specs.append({"name": fields[0], "version": fields[1], "architecture": fields[2]})
    if not names.issubset({p["name"].split(":")[0] for p in specs}):
        raise ValueError("could not identify every installed plugin package")
    return specs


def plugin_uris(root):
    paths = [root / "lv2", root / ".lv2", Path("/usr/lib/lv2"), Path("/usr/lib/aarch64-linux-gnu/lv2"),
             Path("/usr/local/lib/lv2"), Path("/usr/local/lib/aarch64-linux-gnu/lv2")]
    result = command(["runuser", "-u", USER, "--", "env", "LV2_PATH=" + ":".join(map(str, paths)), "lv2ls"])
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def referenced_plugins(root, imported):
    required = set()
    for path in imported:
        if path.parent == root / "banks":
            presets = read_json(path).get("presets", [])
        elif path.name == "backup-session.json":
            session = read_json(path)
            presets = [*session.get("drafts", []), session.get("livePreset", {})]
        else:
            continue
        for preset in presets:
            for slot in preset.get("chain", []):
                if slot.get("kind", "effect") != "mixer" and slot.get("uri"):
                    required.add(slot["uri"])
    return required


def check_plugins(root, imported, planned=()):
    required = referenced_plugins(root, imported)
    if required:
        missing = required - plugin_uris(root) - set(planned)
        if missing:
            raise ValueError("required plugins are missing: " + ", ".join(sorted(missing)) + ". Include Plugins and dependencies or install them first.")


def collect_plugins(snapshot, job):
    """Inventory exact Debian versions and retain unmanaged bundles and their state."""
    packages = set()
    pinned = set()
    # Full recovery also carries the optional Pi-MFX display/boot dependencies.
    for name in ("labwc", "chromium", "wtype", "squeekboard", "plymouth", "plymouth-themes", "librsvg2-bin"):
        installed = command(["dpkg-query", "-W", "-f=${db:Status-Status}", name], check=False)
        if installed.returncode == 0 and installed.stdout == "installed":
            packages.add(name)
    system_roots = [Path(p) for p in ("/usr/lib/lv2", "/usr/lib/aarch64-linux-gnu/lv2",
                                    "/usr/local/lib/lv2", "/usr/local/lib/aarch64-linux-gnu/lv2")]
    roots = [DATA / "lv2", DATA / ".lv2", *system_roots]
    libraries = {}
    result = command(["ldconfig", "-p"], check=False)
    for line in result.stdout.splitlines():
        if " => " in line:
            left, right = line.split(" => ", 1)
            libraries.setdefault(left.strip().split()[0], right.strip())
    for root in roots:
        if not root.exists():
            continue
        for bundle in sorted(root.glob("*.lv2")):
            if bundle.is_symlink():
                raise ValueError(f"plugin bundle link needs attention: {bundle}")
            owner = command(["dpkg-query", "-S", str(bundle / "manifest.ttl")], check=False)
            owners = {line.split(": ", 1)[0].split(":")[0] for line in owner.stdout.splitlines() if ": " in line}
            if owner.returncode == 0 and owners:
                packages.update(owners)
                pinned.update(owners)
                continue
            destination = snapshot / "data" / "lv2" / bundle.name
            if root not in {DATA / "lv2", DATA / ".lv2"}:
                if destination.exists():
                    raise ValueError(f"two unmanaged plugins share the bundle name {bundle.name}")
                # Reject links rather than allowing a root backup to follow arbitrary user links.
                list(regular_files(bundle))
                shutil.copytree(bundle, destination)
            for binary in regular_files(bundle):
                with open(binary, "rb") as stream:
                    elf = stream.read(4) == b"\x7fELF"
                if not elf:
                    continue
                needed = command(["readelf", "-d", binary], check=False)
                for name in re.findall(r"\(NEEDED\).*?\[(.*?)\]", needed.stdout):
                    if any(path.name == name for path in bundle.rglob(name)):
                        continue
                    library = libraries.get(name)
                    if not library:
                        raise ValueError(f"{bundle.name} requires missing library {name}")
                    result = command(["dpkg-query", "-S", library], check=False)
                    if result.returncode:
                        result = command(["dpkg-query", "-S", os.path.realpath(library)], check=False)
                    found = {line.split(": ", 1)[0].split(":")[0] for line in result.stdout.splitlines() if ": " in line}
                    if not found:
                        raise ValueError(f"cannot archive the installation dependency {library}")
                    packages.update(found)
    specs = package_specs(packages)
    for item in specs:
        item["pinned"] = item["name"].split(":")[0] in pinned
    return specs


def valid_package_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 33 for c in value):
        return False
    try:
        parsed = urllib.parse.urlsplit(value)
        return (parsed.scheme in {"http", "https"} and bool(parsed.hostname) and not parsed.username
                and not parsed.password and not parsed.fragment)
    except ValueError:
        return False


def package_download_record(package):
    """Keep the repository's exact location and SHA-256 without fetching the .deb."""
    spec = package["name"] + "=" + package["version"]
    result = command(["apt-get", "--print-uris", "download", spec], check=False)
    if result.returncode:
        return None
    rows = []
    for line in result.stdout.splitlines():
        if line.startswith("'"):
            try:
                rows.append(shlex.split(line))
            except ValueError:
                return None
    if len(rows) != 1 or len(rows[0]) < 3 or not valid_package_url(rows[0][0]):
        return None
    url, _, size = rows[0][:3]
    if not size.isdecimal() or not 0 < int(size) <= 1024**5:
        return None
    metadata = command(["apt-cache", "show", spec], check=False)
    hashes = set()
    for stanza in metadata.stdout.split("\n\n"):
        fields = dict(line.split(": ", 1) for line in stanza.splitlines() if ": " in line and not line.startswith(" "))
        if (fields.get("Package") == package["name"].split(":")[0] and fields.get("Version") == package["version"]
                and fields.get("Architecture") == package["architecture"] and fields.get("Size") == size
                and PurePosixPath(fields.get("Filename", "")).name == PurePosixPath(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).name
                and re.fullmatch(r"[a-f0-9]{64}", fields.get("SHA256", ""))):
            hashes.add(fields["SHA256"])
    if metadata.returncode or len(hashes) != 1:
        return None
    return {"url": url, "bytes": int(size), "sha256": hashes.pop()}


def download_packages(snapshot, job, specs):
    package_dir = snapshot / "packages"
    package_dir.mkdir(exist_ok=True)
    for index, item in enumerate(specs):
        status(job, message=f"Including plugin dependency {index + 1}/{len(specs)}: {item['name']}")
        cache = list(Path("/var/cache/apt/archives").glob("*.deb")) + list((DATA / "downloads").rglob("*.deb"))
        found = None
        for path in cache:
            if path.is_symlink():
                continue
            fields = command(["dpkg-deb", "-f", path, "Package", "Version", "Architecture"], check=False).stdout
            parsed = dict(line.split(": ", 1) for line in fields.splitlines() if ": " in line)
            if (parsed.get("Package") == item["name"].split(":")[0] and parsed.get("Version") == item["version"]
                    and parsed.get("Architecture") == item["architecture"]):
                found = path
                break
        target = package_dir / f"{index:05d}.deb"
        if found:
            shutil.copyfile(found, target)
        else:
            download_dir = snapshot / "download-package"
            download_dir.mkdir(exist_ok=True)
            result = command(["apt-get", "-o", "APT::Sandbox::User=root", "download",
                              item["name"] + "=" + item["version"]], timeout=300, check=False, cwd=download_dir)
            candidates = list(download_dir.glob("*.deb"))
            if result.returncode or len(candidates) != 1:
                for path in candidates:
                    path.unlink()
                # Old/private plugin releases need not remain on an apt server.
                # Repack their installed payload when the original .deb is gone.
                repack = command(["dpkg-repack", item["name"]], timeout=600, check=False, cwd=download_dir)
                candidates = list(download_dir.glob("*.deb"))
                if repack.returncode or len(candidates) != 1:
                    raise ValueError(f"full recovery cannot collect or repack {item['name']}={item['version']}")
            shutil.move(candidates[0], target)
        item["path"] = "packages/" + target.name
        actual = command(["dpkg-deb", "-f", target, "Package", "Version", "Architecture"]).stdout
        fields = dict(line.split(": ", 1) for line in actual.splitlines() if ": " in line)
        if (fields.get("Package") != item["name"].split(":")[0] or fields.get("Version") != item["version"]
                or fields.get("Architecture") != item["architecture"]):
            raise ValueError("a package changed during collection; retry the backup")
    return specs


def collect_package_sources(snapshot, job, specs, plugin_mode):
    embedded = []
    for index, package in enumerate(specs):
        status(job, message=f"Recording plugin dependency {index + 1}/{len(specs)}: {package['name']}")
        record = package_download_record(package) if plugin_mode == "online" else None
        if record:
            package["download"] = record
        else:
            # Manual/private/retired packages must never silently disappear.
            embedded.append(package)
    if embedded:
        download_packages(snapshot, job, embedded)


def plugin_recovery_summary(manifest):
    packages = manifest.get("packages", [])
    online = [p for p in packages if "download" in p]
    return {"pluginMode": manifest.get("pluginMode", "self-contained"), "onlinePackages": len(online),
            "bundledPackages": len(packages) - len(online), "downloadBytes": sum(p["download"]["bytes"] for p in online)}


def create_backup(job, request):
    started = time.monotonic()
    selected = selected_categories(request)
    plugin_mode = request.get("pluginMode", "online")
    if plugin_mode not in {"online", "self-contained"}:
        raise ValueError("choose a valid plugin recovery option")
    password = str(request.get("password") or "")
    if selected & {"connections", "plugins", "other"} and len(password) < 8:
        raise ValueError("backups containing credentials or installed package payloads need a password of at least 8 characters")
    directory = job_dir(job)
    snapshot = directory / "snapshot"
    snapshot.mkdir()
    (snapshot / "data").mkdir()
    required = sum(path.stat().st_size for path in regular_files(DATA, skip_data=True)
                   if category(path.relative_to(DATA).as_posix()) in selected)
    if shutil.disk_usage(directory).free < required * 3 + 128 * BLOCK:
        raise ValueError("not enough free space for a consistent copy and the exported archive")
    with stopped_engine(job):
        status(job, message="Taking a consistent copy; audio will resume when copying finishes")
        for path in regular_files(DATA, skip_data=True):
            relative = path.relative_to(DATA).as_posix()
            if excluded(relative) or category(relative) not in selected:
                continue
            target = snapshot / "data" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        pending = DATA / "backup-session.pending.json"
        if "banks" in selected and pending.is_file():
            shutil.copyfile(pending, snapshot / "data" / "backup-session.json")
            if "loops" not in selected:
                session = read_json(snapshot / "data" / "backup-session.json")
                session["loopFile"] = ""
                write_json(snapshot / "data" / "backup-session.json", session)
        system_sources = dict(SYSTEM_FILES)
        for path in Path("/etc/NetworkManager/system-connections").glob("pimfx-wifi-*.nmconnection"):
            key = path.stem.removeprefix("pimfx-")
            if re.fullmatch(r"wifi-[a-f0-9]{32}", key):
                system_sources[key] = str(path)
        for key, source in system_sources.items():
            group = "connections" if connection_key(key) else "settings"
            path = Path(source)
            if group in selected and path.is_file() and not path.is_symlink():
                target = snapshot / "system" / key
                target.parent.mkdir(exist_ok=True)
                shutil.copyfile(path, target)
        install = {"touchscreen": Path("/var/lib/pimfx-touchscreen/configured-user").is_file(),
                   "quietSplash": Path("/var/lib/pimfx-boot/quiet-splash-applied").is_file(),
                   "skipWait": Path("/var/lib/pimfx-boot/skip-wait-applied").is_file(),
                   "unusedServices": Path("/var/lib/pimfx-boot/unused-services-applied").is_file(),
                   "port": request.get("port", 8080)}
        configured = Path("/var/lib/pimfx-touchscreen/configured-user")
        if configured.is_file():
            install["displayUser"] = configured.read_text().strip()
        settings_file = snapshot / "data" / "settings.json"
        if "settings" in selected and settings_file.exists():
            settings = read_json(settings_file)
            prefs = settings.get("ui", {}).get("browserPreferences", {})
            if prefs.get("version") != 1:
                if configured.is_file():
                    raise ValueError("refresh the Pi touchscreen once so its keyboard and interface preferences can be included, then retry the backup")
                settings.setdefault("ui", {})["browserPreferences"] = {"version": 1, "values": {}}
                write_json(settings_file, settings)
        # Capture installed bundles before audio resumes, so the package inventory
        # cannot describe a different rig from the copied presets.
        specs = collect_plugins(snapshot, job) if "plugins" in selected else []
        catalog_uris = sorted(plugin_uris(DATA)) if "plugins" in selected else []
    if specs:
        collect_package_sources(snapshot, job, specs, plugin_mode)
    if {"banks", "plugins"}.issubset(selected):
        bank_files = list((snapshot / "data" / "banks").glob("*.json"))
        if (snapshot / "data" / "backup-session.json").exists():
            bank_files.append(snapshot / "data" / "backup-session.json")
        missing = referenced_plugins(snapshot / "data", bank_files) - set(catalog_uris)
        if missing:
            raise ValueError("full recovery cannot include missing installed plugins: " + ", ".join(sorted(missing)))
    manifest = {"format": "pimfx-system-backup", "version": 2, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sourceRoot": str(DATA), "system": system_identity(), "application": request.get("application", {}),
                "categories": sorted(selected), "hardware": hardware_identity(read_json(snapshot / "data" / "settings.json")), "pluginUris": catalog_uris,
                "installation": install if "installation" in selected else {}, "pluginMode": plugin_mode, "packages": specs, "files": []}
    paths = [p for base in (snapshot / "data", snapshot / "system", snapshot / "packages") for p in regular_files(base)]
    def describe_file(path):
        relative = path.relative_to(snapshot).as_posix()
        group = (category(relative[5:]) if relative.startswith("data/") else "plugins" if relative.startswith("packages/")
                 else "connections" if connection_key(path.name) else "settings")
        return {"path": relative, "category": group, "bytes": path.stat().st_size,
                "mode": stat.S_IMODE(path.stat().st_mode) & 0o777, "sha256": digest(path)}
    # Hash independent files concurrently. Bound both workers and submitted work;
    # keep the consistent copy and ZIP writer sequential to avoid SD-card seeks
    # and concurrent writes to the same archive.
    workers = max(1, min(4, os.cpu_count() or 1))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for offset in range(0, len(paths), 32):
            manifest["files"].extend(pool.map(describe_file, paths[offset:offset + 32]))
            status(job, message=f"Checking files {min(offset + 32, len(paths))}/{len(paths)}")
    raw = directory / "archive.zip"
    status(job, message="Building recovery archive")
    with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
        for item in manifest["files"]:
            archive.write(snapshot / item["path"], item["path"])
    output = directory / ("Pi-MFX-" + time.strftime("%Y-%m-%d-%H%M%S", time.gmtime()) + ".pimfx-backup")
    if password:
        status(job, message="Encrypting backup")
        crypt_file(raw, output, password, True)
        raw.unlink()
    else:
        os.replace(raw, output)
    output_hash = digest(output)
    result = {"name": output.name, "bytes": output.stat().st_size, "sha256": output_hash,
              "encrypted": bool(password), "categories": sorted(selected), "exported": False,
              "fileCount": len(paths), "hashWorkers": workers, **plugin_recovery_summary(manifest)}
    if request.get("device"):
        destination = usb_destination(request["device"])
        if shutil.disk_usage(destination).free < output.stat().st_size + 16 * BLOCK:
            raise ValueError("USB drive does not have enough free space")
        target = destination / output.name
        created = False
        try:
            with open(output, "rb") as inp, open(target, "xb") as out:
                created = True
                shutil.copyfileobj(inp, out, BLOCK)
                out.flush()
                os.fsync(out.fileno())
            sync_dir(destination)
        except Exception:
            if created:
                target.unlink(missing_ok=True)
            raise
        if digest(target) != output_hash:
            target.unlink()
            raise ValueError("USB backup verification failed")
        result.update(exported=True, destination=str(target))
        output.unlink()
    else:
        # Downloadable only by the engine user; neither secrets nor a public static URL.
        account = pwd.getpwnam(USER)
        os.chown(output, account.pw_uid, account.pw_gid)
        os.chmod(output, 0o400)
        os.chmod(STATE, 0o711)
        os.chmod(STATE / "jobs", 0o711)
        os.chmod(directory, 0o711)
    shutil.rmtree(snapshot)
    result["elapsedSeconds"] = round(time.monotonic() - started)
    status(job, state="complete", message="USB backup saved and verified" if result["exported"] else "Saving to your chosen destination", result=result)


def selected_categories(request):
    selected = request.get("categories", list(CATEGORIES))
    if not isinstance(selected, list) or not selected or any(item not in CATEGORIES for item in selected):
        raise ValueError("select at least one valid backup category")
    return set(selected)


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or "\\" in name or "\0" in name or path.is_absolute() or ".." in path.parts
            or str(path) != name or len(name) > 2048):
        raise ValueError("unsafe archive entry")
    return path


def verified_archive(job, password):
    directory = job_dir(job)
    source = directory / "upload"
    with open(source, "rb") as stream:
        encrypted = stream.read(len(MAGIC)) == MAGIC
    raw = directory / "checked.zip"
    if encrypted:
        status(job, message="Decrypting and authenticating backup")
        crypt_file(source, raw, password, False)
    else:
        shutil.copyfile(source, raw)
    with zipfile.ZipFile(raw) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_FILES or len({i.filename for i in entries}) != len(entries):
            raise ValueError("too many files or duplicate archive entries")
        info = archive.getinfo("manifest.json")
        if info.file_size > MAX_MANIFEST:
            raise ValueError("backup manifest is too large")
        manifest = json.loads(archive.read(info))
        validate_manifest(manifest)
        expected = {i["path"]: i for i in manifest["files"]}
        if set(expected) | {"manifest.json"} != {i.filename for i in entries}:
            raise ValueError("archive files do not match its manifest")
        total = sum(i["bytes"] for i in manifest["files"])
        if shutil.disk_usage(directory).free < total + 32 * BLOCK:
            raise ValueError("not enough free space to verify and stage this backup")
        stage = directory / "verified"
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir()
        for index, info in enumerate(entries):
            safe_name(info.filename)
            if info.filename == "manifest.json":
                continue
            item = expected[info.filename]
            mode = (info.external_attr >> 16) & 0o170000
            if mode not in (0, stat.S_IFREG) or info.file_size != item["bytes"] or info.flag_bits & 1:
                raise ValueError("unsupported or inconsistent archive file")
            target = stage / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            with archive.open(info) as inp, open(target, "xb") as out:
                count = 0
                for chunk in iter(lambda: inp.read(BLOCK), b""):
                    count += len(chunk)
                    if count > item["bytes"]:
                        raise ValueError("archive expanded beyond its declared size")
                    h.update(chunk)
                    out.write(chunk)
            if count != item["bytes"] or h.hexdigest() != item["sha256"]:
                raise ValueError(f"backup checksum failed: {info.filename}")
            os.chmod(target, 0o700 if item.get("mode", 0) & 0o111 else 0o600)
            if index % 100 == 0:
                status(job, message=f"Verifying files {index + 1}/{len(entries)}")
    raw.unlink()
    write_json(directory / "manifest.json", manifest)
    return manifest


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get("format") != "pimfx-system-backup" or manifest.get("version") not in {1, 2}:
        raise ValueError("unsupported Pi-MFX backup format")
    if not isinstance(manifest.get("files"), list) or len(manifest["files"]) > MAX_FILES:
        raise ValueError("invalid backup file list")
    if not isinstance(manifest.get("sourceRoot"), str) or not manifest["sourceRoot"].startswith("/"):
        raise ValueError("invalid source data directory")
    if not isinstance(manifest.get("categories"), list) or any(c not in CATEGORIES for c in manifest["categories"]):
        raise ValueError("invalid backup categories")
    uris = manifest.get("pluginUris", [])
    if not isinstance(uris, list) or any(not isinstance(uri, str) or len(uri) > 4096 for uri in uris):
        raise ValueError("invalid plugin catalog")
    install = manifest.get("installation", {})
    if not isinstance(install, dict) or (install and (type(install.get("port")) is not int or not 1 <= install["port"] <= 65535)):
        raise ValueError("invalid installation options")
    for key in ("touchscreen", "quietSplash", "skipWait", "unusedServices"):
        if key in install and not isinstance(install[key], bool):
            raise ValueError("invalid installation option")
    seen = set()
    for item in manifest["files"]:
        if not isinstance(item, dict):
            raise ValueError("invalid file record")
        path = str(item.get("path", ""))
        p = safe_name(path)
        if len(p.parts) < 2 or p.parts[0] not in {"data", "system", "packages"} or path in seen:
            raise ValueError("invalid or duplicated backup path")
        seen.add(path)
        if item.get("category") not in manifest["categories"]:
            raise ValueError("file has an invalid category")
        if not isinstance(item.get("bytes"), int) or not 0 <= item["bytes"] <= 1024**5:
            raise ValueError("invalid file size")
        if not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", ""))):
            raise ValueError("invalid file checksum")
        if p.parts[0] == "data":
            relative = str(p.relative_to("data"))
            if excluded(relative) or category(relative) != item["category"]:
                raise ValueError("backup file belongs to the wrong category")
        elif p.parts[0] == "system":
            key = p.name
            system_target(key)
            if len(p.parts) != 2 or item["category"] != ("connections" if connection_key(key) else "settings"):
                raise ValueError("unapproved system configuration file")
        elif item["category"] != "plugins" or len(p.parts) != 2 or not re.fullmatch(r"[0-9]{5}\.deb", p.name):
            raise ValueError("invalid plugin installation package")
    packages = manifest.get("packages", [])
    if not isinstance(packages, list) or len(packages) > MAX_FILES or (packages and "plugins" not in manifest["categories"]):
        raise ValueError("invalid plugin package inventory")
    if manifest.get("pluginMode", "self-contained") not in {"online", "self-contained"}:
        raise ValueError("invalid plugin recovery option")
    names = set()
    for package in packages:
        if (not isinstance(package, dict) or not PACKAGE.fullmatch(str(package.get("name", "")))
                or not re.fullmatch(r"[0-9][A-Za-z0-9.+:~\-]*", str(package.get("version", "")))
                or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", str(package.get("architecture", "")))
                or package["name"] in names or type(package.get("pinned", False)) is not bool):
            raise ValueError("invalid plugin package record")
        names.add(package["name"])
        if "download" in package:
            record = package["download"]
            if (manifest["version"] != 2 or manifest.get("pluginMode") != "online" or "path" in package
                    or not isinstance(record, dict) or not valid_package_url(record.get("url"))
                    or type(record.get("bytes")) is not int or not 0 < record["bytes"] <= 1024**5
                    or not re.fullmatch(r"[a-f0-9]{64}", str(record.get("sha256", "")))):
                raise ValueError("invalid plugin download record")
        elif not str(package.get("path", "")).startswith("packages/") or package.get("path") not in seen:
            raise ValueError("invalid plugin package payload")
    package_paths = [p["path"] for p in packages if "path" in p]
    if len(set(package_paths)) != len(package_paths) or set(package_paths) != {p for p in seen if p.startswith("packages/")}:
        raise ValueError("plugin package inventory does not match the archived payloads")


def selectable_files(directory, manifest, group):
    rows = []
    for item in manifest.get("files", []):
        if item["category"] != group or not item["path"].startswith("data/"):
            continue
        if group == "banks" and not item["path"].startswith("data/banks/"):
            continue
        row = dict(item)
        row["label"] = item["path"][5:]
        rows.append(row)
        if group == "banks" and item["path"].startswith("data/banks/"):
            bank = read_json(directory / "verified" / item["path"])
            row["label"] = "Bank: " + str(bank.get("name", item["path"]))
            for preset in bank.get("presets", []):
                token = "preset:" + hashlib.sha256((item["path"] + "\0" + str(preset.get("id"))).encode()).hexdigest()
                rows.append({"path": token, "file": item["path"], "preset": preset.get("id"), "category": "banks",
                             "bytes": len(json.dumps(preset).encode()), "label": str(bank.get("name", "Bank")) + " / " + str(preset.get("name", "Preset"))})
    return rows


def strings(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)
    elif isinstance(value, str):
        yield value


def validate_rig(root, imported):
    """Reject format loss and missing referenced assets before replacing data."""
    bank_ids, preset_ids = set(), set()
    for path in (root / "banks").glob("*.json"):
        bank = read_json(path)
        if not isinstance(bank, dict) or not isinstance(bank.get("id"), str) or not isinstance(bank.get("presets"), list):
            raise ValueError(f"invalid bank: {path.name}")
        if bank["id"] in bank_ids:
            raise ValueError("two banks have the same identity; use Import as copies")
        bank_ids.add(bank["id"])
        for preset in bank["presets"]:
            if not isinstance(preset, dict) or preset.get("routingFormat") != 1 or not isinstance(preset.get("id"), str):
                raise ValueError(f"unsupported preset format in {path.name}; install a compatible Pi-MFX version")
            if preset["id"] in preset_ids:
                raise ValueError("two presets have the same identity; use Import as copies")
            preset_ids.add(preset["id"])
    for path in imported:
        group = category(path.relative_to(root).as_posix())
        if path.suffix != ".json" or group not in {"banks", "settings", "recordings", "drums", "backing"}:
            continue
        value = read_json(path)
        if path.name == "settings.json" and (not isinstance(value, dict) or value.get("version") != 4):
            raise ValueError("unsupported settings version; install a compatible Pi-MFX version")
        for text in strings(value):
            if text.startswith(str(DATA) + "/"):
                target = root / text[len(str(DATA)) + 1:]
                if not target.exists():
                    raise ValueError(f"missing referenced file: {text}. Include its model, IR or media category.")


def durable_tree(root):
    for directory, _, files in os.walk(root):
        for name in files:
            path = Path(directory) / name
            if path.is_symlink():
                continue
            with open(path, "rb") as stream:
                os.fsync(stream.fileno())
        sync_dir(directory)


def apply_installation(options, job):
    """Recreate Pi-MFX-owned OS choices through the installed setup scripts."""
    repo_file = DATA / "source-repo"
    if not repo_file.is_file():
        raise ValueError("installation restore needs the fresh Pi-MFX installer checkout")
    repo = Path(repo_file.read_text().strip())
    script = repo / "scripts" / "pimfx.sh"
    if not script.is_file():
        raise ValueError("the fresh installer checkout cannot be found")
    env = {**os.environ, "PIMFX_RECOVERY_OFFLINE": "1"}
    # Port changes are applied by the installer on a fresh OS. Retain an existing
    # connection until the final reboot, and display the recovered port clearly.
    port = options.get("port", 8080)
    override = Path("/etc/systemd/system/pimfx.service.d/50-recovery-port.conf")
    override.parent.mkdir(parents=True, exist_ok=True)
    override.write_text(f'[Service]\nExecStart=\nExecStart="{PREFIX}/bin/pimfx" --port {port}\n')
    mdns = Path("/etc/systemd/system/pimfx-mdns.service.d/50-recovery-port.conf")
    mdns.parent.mkdir(parents=True, exist_ok=True)
    mdns.write_text(f"[Service]\nEnvironment=PIMFX_PORT={port}\n")
    command(["systemctl", "daemon-reload"])
    display_user = options.get("displayUser")
    try:
        account = pwd.getpwnam(display_user) if isinstance(display_user, str) else None
    except KeyError:
        account = None
    if account is None or not 1000 <= account.pw_uid < 65534:
        account = next((p for p in pwd.getpwall() if 1000 <= p.pw_uid < 65534), None)
    calls = []
    if options.get("touchscreen"):
        if not account:
            raise ValueError("touchscreen recovery needs a normal login user on the fresh OS")
        calls.append(["bash", script, "display", "--display-user", account.pw_name, "--yes"])
    elif Path("/var/lib/pimfx-touchscreen/configured-user").exists():
        calls.append(["bash", script, "display-remove", "--yes"])
    if options.get("quietSplash"):
        calls.append(["bash", repo / "scripts/boot-splash.sh", "install", "--yes"])
    elif Path("/var/lib/pimfx-boot/quiet-splash-applied").exists():
        calls.append(["bash", repo / "scripts/boot-splash.sh", "remove", "--yes"])
    # Undo existing Pi-MFX boot-speed choices before applying the recorded ones.
    calls.append(["bash", repo / "scripts/boot-speed.sh", "restore", "--yes"])
    if options.get("skipWait"):
        calls.append(["bash", repo / "scripts/boot-speed.sh", "skip-wait", "--yes"])
    if options.get("unusedServices"):
        calls.append(["bash", repo / "scripts/boot-speed.sh", "unused", "--yes"])
    for args in calls:
        status(job, message="Restoring touchscreen and boot options")
        result = subprocess.run([str(a) for a in args], env=env, capture_output=True, text=True, timeout=600,
                                stdin=subprocess.DEVNULL)
        if result.returncode:
            raise ValueError(result.stderr.strip()[-1500:] or "installation option could not be restored")


def inspect_backup(job, request):
    manifest = verified_archive(job, str(request.get("password") or ""))
    current = system_identity()
    compatible = manifest.get("system") == current
    available = set(manifest["categories"])
    summary = [{"id": c, "label": CATEGORIES[c], "count": sum(i["category"] == c for i in manifest["files"]),
                "bytes": sum(i["bytes"] for i in manifest["files"] if i["category"] == c)} for c in CATEGORIES if c in available]
    status(job, state="complete", action="inspect", message="Backup verified; choose what to restore",
           result={"createdAt": manifest.get("createdAt"), "application": manifest.get("application", {}),
                   "categories": summary, "compatible": compatible, "system": manifest.get("system"),
                   "installation": manifest.get("installation", {}), "fileCount": len(manifest["files"]),
                   **plugin_recovery_summary(manifest),
                   "warning": "" if compatible else "OS or architecture differs. Plugins, system settings, connections and installation options are blocked; portable libraries can still be restored."})


def rewrite(value, old_root, id_map=None, path_map=None):
    if isinstance(value, dict):
        return {rewrite(k, old_root, id_map, path_map): rewrite(v, old_root, id_map, path_map) for k, v in value.items()}
    if isinstance(value, list):
        return [rewrite(v, old_root, id_map, path_map) for v in value]
    if isinstance(value, str):
        if value in (id_map or {}):
            return id_map[value]
        if value.startswith(old_root.rstrip("/") + "/"):
            value = str(DATA) + value[len(old_root.rstrip("/")):]
        return (id_map or {}).get(value, (path_map or {}).get(value, value))
    return value


def chown_tree(root):
    account = pwd.getpwnam(USER)
    for directory, dirs, files in os.walk(root):
        os.chown(directory, account.pw_uid, account.pw_gid)
        os.chmod(directory, 0o750)
        for name in files:
            path = Path(directory) / name
            os.chown(path, account.pw_uid, account.pw_gid)
            os.chmod(path, 0o700 if path.stat().st_mode & 0o111 else 0o600)


def rollback(journal):
    """Idempotent recovery after an exception, process death, or power loss."""
    old = Path(journal["old"])
    candidate = Path(journal["candidate"])
    if old.exists():
        if DATA.exists():
            failed = candidate.with_name(candidate.name + ".failed")
            if failed.exists():
                shutil.rmtree(failed)
            os.replace(DATA, failed)
        os.replace(old, DATA)
        sync_dir(DATA.parent)
    if DATA.exists():
        promote_session(DATA)
    for item in journal.get("system", []):
        target = system_target(item["key"])
        if item["existed"]:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item["saved"], target)
            os.chmod(target, 0o600 if connection_key(item["key"]) else 0o644)
        else:
            target.unlink(missing_ok=True)


class PackageRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not valid_package_url(newurl):
            raise ValueError("plugin download redirected to an unsupported location")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_recorded_package(record, target):
    """Download only the recorded bytes, verifying the saved repository SHA-256."""
    partial = target.with_suffix(".part")
    opener = urllib.request.build_opener(PackageRedirectHandler())
    size, checksum = 0, hashlib.sha256()
    deadline = time.monotonic() + 600
    try:
        with opener.open(record["url"], timeout=90) as response, open(partial, "xb") as out:
            while True:
                chunk = response.read(min(BLOCK, record["bytes"] - size + 1))
                if not chunk:
                    break
                size += len(chunk)
                if size > record["bytes"] or time.monotonic() > deadline:
                    raise ValueError("plugin download exceeded its recorded size or time limit")
                checksum.update(chunk)
                out.write(chunk)
            if size != record["bytes"] or checksum.hexdigest() != record["sha256"]:
                raise ValueError("plugin download does not match the backup checksum")
            out.flush()
            os.fsync(out.fileno())
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)


def prepare_package_files(job, directory, packages, mode):
    paths = []
    downloads = job_dir(job) / "restore-packages"
    for index, package in enumerate(packages):
        installed = command(["dpkg-query", "-W", "-f=${db:Status-Status}\t${Version}", package["name"]], check=False)
        current = installed.stdout.split("\t")
        if len(current) == 2 and current[0] == "installed":
            if current[1] == package["version"]:
                continue
            if ((not package.get("pinned", False) or mode in {"keep", "copy"})
                    and command(["dpkg", "--compare-versions", current[1], "ge", package["version"]], check=False).returncode == 0):
                continue  # Retain compatible newer OS dependencies.
        if "download" in package:
            downloads.mkdir(mode=0o700, exist_ok=True)
            source = downloads / f"{index:05d}.deb"
            status(job, message=f"Downloading recorded plugin dependency {index + 1}/{len(packages)}: {package['name']}")
            try:
                fetch_recorded_package(package["download"], source)
            except Exception as exc:
                raise ValueError(f"cannot recover {package['name']}={package['version']}: {exc}. Check internet access; this exact release must still be available. Rig data has not been replaced.") from exc
        else:
            source = directory / "verified" / package["path"]
        fields = command(["dpkg-deb", "-f", source, "Package", "Version", "Architecture"]).stdout
        parsed = dict(line.split(": ", 1) for line in fields.splitlines() if ": " in line)
        if (parsed.get("Package") != package["name"].split(":")[0] or parsed.get("Version") != package["version"]
                or parsed.get("Architecture") != package["architecture"]):
            raise ValueError("plugin package identity does not match the manifest")
        paths.append(source)
    return paths


def restore_backup(job, request):
    if request.get("trusted") is not True:
        raise ValueError("confirm this is a trusted backup before restoring plugins or configuration")
    directory = job_dir(request.get("source", ""))
    manifest = read_json(directory / "manifest.json")
    validate_manifest(manifest)
    selected = selected_categories(request)
    if not selected.issubset(set(manifest["categories"])):
        raise ValueError("selected categories are not in this backup")
    if manifest.get("system") != system_identity() and selected & {"plugins", "settings", "connections", "installation"}:
        raise ValueError("OS/architecture differs; select portable libraries only")
    full = request.get("full") is True
    if full and selected != set(CATEGORIES):
        raise ValueError("this archive is not a full-system backup")
    mode = request.get("conflicts", "replace")
    if mode not in {"replace", "keep", "copy"}:
        raise ValueError("invalid conflict option")
    if full:
        mode = "replace"
    only = request.get("files", [])
    individual = selectable_files(directory, manifest, "banks")
    preset_choices = {i["path"]: i for i in individual if i["path"].startswith("preset:")}
    known = {i["path"] for i in manifest["files"]} | set(preset_choices)
    if not isinstance(only, list) or any(p not in known for p in only) or (full and only):
        raise ValueError("invalid file selection")
    preset_selection = {}
    for token in only:
        if token in preset_choices:
            choice = preset_choices[token]
            preset_selection.setdefault(choice["file"], set()).add(choice["preset"])
    entries = [i for i in manifest["files"] if i["category"] in selected and (not only or i["path"] in only or i["path"] in preset_selection
               or i["category"] in {"plugins", "models", "irs"})]
    if only:
        if not any(i["path"] in only or i["path"] in preset_selection for i in entries):
            raise ValueError("none of the selected files belong to a selected category")
        selected = {i["category"] for i in entries} | (selected & {"plugins"})
    if mode == "copy" and selected & {"recordings", "drums", "backing", "other"}:
        raise ValueError("Import as copies supports banks, models, IRs, layouts and profiles. Use Keep or Replace for media projects and other files.")
    total = sum(i["bytes"] for i in entries)
    if not full:
        total += sum(p.stat().st_size for p in regular_files(DATA))
    packages = manifest.get("packages", []) if "plugins" in selected else []
    total += sum(p["download"]["bytes"] for p in packages if "download" in p)
    if shutil.disk_usage(DATA.parent).free < total + 64 * BLOCK:
        raise ValueError("not enough free space for staged restore and rollback")
    # Recheck staged hashes immediately before applying anything.
    for item in entries:
        if digest(directory / "verified" / item["path"]) != item["sha256"]:
            raise ValueError("verified recovery files changed; import the archive again")
    # Finish network access and verify package identities before stopping audio or
    # changing any packages/data. A retired release must fail without a partial rig.
    package_paths = prepare_package_files(job, directory, packages, mode)
    candidate = DATA.parent / (".pimfx-restore-" + job)
    old = DATA.parent / (".pimfx-before-" + job)
    journal_path = STATE / "restore-journal.json"
    journal = {"job": job, "old": str(old), "candidate": str(candidate), "system": [], "phase": "staging",
               "source": request["source"], "installation": manifest.get("installation", {}) if "installation" in selected else {}}
    with stopped_engine(job):
        if full:
            candidate.mkdir(mode=0o700)
        else:
            list(regular_files(DATA))
            shutil.copytree(DATA, candidate)
            (candidate / "engine-running").unlink(missing_ok=True)
            if "banks" not in selected:
                promote_session(candidate)
            else:
                (candidate / "backup-session.pending.json").unlink(missing_ok=True)
        if (DATA / "source-repo").is_file():
            shutil.copyfile(DATA / "source-repo", candidate / "source-repo")
        if not full and mode == "replace" and not only:
            for name, group in DIR_CATEGORIES.items():
                if group in selected and (candidate / name).exists():
                    shutil.rmtree(candidate / name)
        id_map, path_map, imported = {}, {}, []
        for item in entries:
            if not item["path"].startswith("data/"):
                continue
            relative = item["path"][5:]
            target = candidate / relative
            source = directory / "verified" / item["path"]
            partial_bank = item["path"] in preset_selection and item["path"] not in only
            existing_bank = read_json(target) if partial_bank and target.exists() else None
            if target.exists() and not partial_bank and (mode == "keep" or (mode == "copy" and item["category"] in {"plugins", "settings", "connections"})):
                continue
            if target.exists() and mode == "copy":
                if item["category"] == "settings" or relative in FILE_CATEGORIES:
                    continue
                target = target.with_name(target.stem + "-import-" + job[:8] + target.suffix)
                path_map[str(DATA / relative)] = str(DATA / target.relative_to(candidate))
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            if partial_bank:
                bank = read_json(target)
                wanted = preset_selection[item["path"]]
                incoming = [p for p in bank.get("presets", []) if p.get("id") in wanted]
                if existing_bank and mode != "copy":
                    previous = existing_bank.get("presets", [])
                    known_ids = {p.get("id") for p in previous}
                    if mode == "replace":
                        replacements = {p["id"]: p for p in incoming}
                        previous = [replacements.pop(p.get("id"), p) for p in previous]
                        incoming = list(replacements.values())
                    else:
                        incoming = [p for p in incoming if p.get("id") not in known_ids]
                    bank = existing_bank
                    incoming = previous + incoming
                bank["presets"] = incoming
                write_json(target, bank)
            imported.append(target)
            if mode == "copy" and item["category"] == "banks" and target.suffix == ".json":
                bank = read_json(target)
                bank["name"] = str(bank.get("name", "Bank")) + " (copy)"
                write_json(target, bank)
                for value in [bank, *bank.get("presets", [])]:
                    if isinstance(value, dict) and isinstance(value.get("id"), str):
                        id_map[value["id"]] = ("bank-" if value is bank else "preset-") + uuid.uuid4().hex
        if mode == "copy":
            for index, path in enumerate(imported):
                if path.parent == candidate / "banks" and path.suffix == ".json":
                    bank = read_json(path)
                    target = path.with_name(id_map.get(bank["id"], bank["id"]) + ".json")
                    previous_path = str(DATA / path.relative_to(candidate))
                    final_path = str(DATA / target.relative_to(candidate))
                    for original, mapped in list(path_map.items()):
                        if mapped == previous_path:
                            path_map[original] = final_path
                    os.replace(path, target)
                    imported[index] = target
        for path in imported:
            if path.suffix == ".json":
                try:
                    value = read_json(path)
                except (ValueError, UnicodeError):
                    continue  # A NAM/model may use a JSON suffix; its bytes must stay intact.
                if path.name == "tone3000-assets.json" or category(path.relative_to(candidate).as_posix()) not in {"models", "irs"}:
                    write_json(path, rewrite(value, manifest["sourceRoot"], id_map, path_map))
        if manifest.get("legacy"):
            current = read_json(DATA / "settings.json")
            partial = read_json(candidate / "settings.json")
            for key, value in partial.items():
                if key in {"ui", "system", "controller", "virtualControls"}:
                    current[key] = {**current.get(key, {}), **value}
            write_json(candidate / "settings.json", current)
        if not full and "loops" not in selected:
            original_session = read_json(DATA / "backup-session.pending.json")
            session_path = candidate / "backup-session.json"
            session = read_json(session_path, {"version": 1, "drafts": []})
            session["loopFile"] = original_session.get("loopFile", "")
            write_json(session_path, session)
        settings_path = candidate / "settings.json"
        if "settings" in selected and not manifest.get("legacy") and settings_path.exists():
            write_json(settings_path, restore_hardware(read_json(settings_path), manifest.get("hardware", {})))
        if "banks" not in selected and settings_path.exists():
            settings = read_json(settings_path)
            previous = read_json(DATA / "settings.json")
            for key in ("activeBankId", "activePresetId"):
                settings[key] = previous.get(key, "")
            if "settings" in selected:
                settings.setdefault("controller", {})["presetAssignments"] = previous.get("controller", {}).get("presetAssignments", {})
            write_json(settings_path, settings)
        if "banks" in selected:
            ids = set()
            for file in (candidate / "banks").glob("*.json"):
                bank = read_json(file)
                ids.update(str(p.get("id")) for p in bank.get("presets", []))
            if settings_path.exists():
                settings = read_json(settings_path)
                if settings.get("activePresetId") not in ids:
                    settings["activePresetId"] = ""
                write_json(settings_path, settings)
        validate_rig(candidate, imported)
        chown_tree(candidate)
        check_plugins(candidate, imported, manifest.get("pluginUris", []) if "plugins" in selected else [])
        # Packages are executable input. Explicit trusted confirmation above is mandatory.
        if package_paths:
            status(job, message="Restoring exact plugin packages and their dependencies")
            command(["apt-get", "-o", "APT::Sandbox::User=root", "--no-download", "--no-remove", "--allow-downgrades", "install", "-y", *package_paths], timeout=1800)
        check_plugins(candidate, imported)
        for item in entries:
            if item["path"].startswith("system/"):
                key = PurePosixPath(item["path"]).name
                target = system_target(key)
                if target.exists() and mode in {"keep", "copy"}:
                    continue
                if target.is_symlink():
                    raise ValueError("system configuration destination is a symbolic link")
                saved = job_dir(job) / ("before-" + key)
                if target.exists():
                    shutil.copyfile(target, saved)
                journal["system"].append({"key": key, "existed": target.exists(), "saved": str(saved)})
        durable_tree(candidate)
        for item in journal["system"]:
            if item["existed"]:
                with open(item["saved"], "rb") as stream:
                    os.fsync(stream.fileno())
        write_json(journal_path, journal)
        try:
            status(job, message="Applying verified restore; reconnecting when the engine returns")
            os.replace(DATA, old)
            sync_dir(DATA.parent)
            os.replace(candidate, DATA)
            sync_dir(DATA.parent)
            for item in journal["system"]:
                target = system_target(item["key"])
                target.parent.mkdir(parents=True, exist_ok=True)
                with open(directory / "verified" / "system" / item["key"], "rb") as inp:
                    temporary = target.with_name(target.name + ".pimfx-restore")
                    with open(temporary, "wb") as out:
                        shutil.copyfileobj(inp, out, BLOCK)
                        out.flush()
                        os.fsync(out.fileno())
                    os.chmod(temporary, 0o600 if connection_key(item["key"]) else 0o644)
                    os.replace(temporary, target)
                    sync_dir(target.parent)
            journal["phase"] = "applied"
            write_json(journal_path, journal)
            command(["systemctl", "start", "pimfx.service"])
            time.sleep(3)
            if not service_running():
                raise ValueError("Pi-MFX did not restart after restore")
            journal["phase"] = "committed"
            write_json(journal_path, journal)
        except Exception:
            command(["systemctl", "stop", "pimfx.service"], check=False)
            rollback(journal)
            journal_path.unlink(missing_ok=True)
            raise
    install_error = ""
    if "installation" in selected and mode == "replace":
        try:
            apply_installation(manifest.get("installation", {}), job)
        except Exception as exc:
            install_error = str(exc)
    status(job, state="complete" if not install_error else "attention", message="Restore complete. Reconnect using the restored access password if requested." if not install_error else "Rig data restored; an installation option needs attention",
           result={"restored": len(entries), "rollbackAvailable": True, "rebootRecommended": bool(selected & {"settings", "connections", "plugins", "installation"}),
                   "installation": manifest.get("installation", {}),
                   "note": install_error or "Wi-Fi and installation options are restored. Reboot to activate OS changes.", "port": manifest.get("installation", {}).get("port", 8080)})


def recover_interrupted():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STATE / "operation.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return  # An independently supervised restore is still active.
        _recover_interrupted_unlocked()


def _recover_interrupted_unlocked():
    journal_path = STATE / "restore-journal.json"
    journal = read_json(journal_path)
    if journal and journal.get("phase") != "committed":
        rollback(journal)
        journal_path.unlink()
        status(journal["job"], state="failed", message="Interrupted restore recovered", error="Previous Pi-MFX data restored. Plugin package changes may need review.")
    latest = read_json(STATE / "latest.json")
    if latest.get("id"):
        last = read_json(job_dir(latest["id"]) / "status.json")
        if last.get("state") in {"queued", "running"}:
            committed = journal.get("phase") == "committed" and journal.get("job") == latest["id"]
            status(latest["id"], state="attention" if committed else "failed", message="Interrupted recovery job needs review",
                   error="The Pi restarted before this job finished. Re-import the backup to retry safely.",
                   result={"rollbackAvailable": bool(committed), "note": "Rig data was restored; OS setup was interrupted. Restore again to finish installation options." if committed else ""})


def rollback_job(job, request):
    journal_path = STATE / "restore-journal.json"
    journal = read_json(journal_path)
    if journal.get("phase") != "committed" or not Path(journal.get("old", "/nonexistent")).is_dir():
        raise ValueError("there is no previous restored rig to roll back")
    with stopped_engine(job):
        journal.update(phase="rolling-back", job=job)
        write_json(journal_path, journal)
        rollback(journal)
        journal_path.unlink()
    status(job, state="complete", message="Previous Pi-MFX data restored", result={"note": "Plugin package and OS installation changes remain; the previous Pi-MFX data has been recovered."})


def recovery_busy():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(STATE / "operation.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
    return False


def usb_files(device):
    directory = usb_destination(device)
    return [{"id": hashlib.sha256(path.name.encode()).hexdigest()[:32], "name": path.name, "bytes": path.stat().st_size}
            for path in sorted(directory.glob("*.pimfx-backup")) if path.is_file() and not path.is_symlink()][:500]


def import_usb(job, request):
    directory = usb_destination(request.get("device"))
    match = next((item for item in usb_files(request.get("device")) if item["id"] == request.get("file")), None)
    if not match:
        raise ValueError("USB backup is missing")
    if shutil.disk_usage(STATE).free < match["bytes"] * 2 + 64 * BLOCK:
        raise ValueError("not enough space to import this USB backup")
    source = directory / match["name"]
    with open(source, "rb", opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW)) as inp:
        with open(job_dir(job) / "upload", "xb") as out:
            shutil.copyfileobj(inp, out, BLOCK)
    inspect_backup(job, request)


def import_legacy(job, request):
    value = request.get("contents")
    if not isinstance(value, dict) or value.get("format") != "pimfx-ui-backup" or value.get("version") != 1:
        raise ValueError("this is not a supported old Pi-MFX configuration backup")
    partial = {key: value[key] for key in ("ui", "controller", "system", "virtualControls") if isinstance(value.get(key), dict)}
    ui = partial.setdefault("ui", {})
    if isinstance(value.get("customThemes"), list):
        ui["customThemes"] = value["customThemes"]
    if isinstance(value.get("localTheme"), dict) and isinstance(value["localTheme"].get("name"), str):
        ui["themeId"] = value["localTheme"]["name"]
        themes = ui.setdefault("customThemes", [])
        if not any(t.get("name") == value["localTheme"]["name"] for t in themes if isinstance(t, dict)):
            themes.append(value["localTheme"])
    values = {}
    for old, key in (("keyboardMode", "pimfx-keyboard-mode"), ("keyboardAppearance", "pimfx-keyboard-appearance"),
                     ("uiBehavior", "pimfx-ui-behavior"), ("keyboardThemes", "pimfx-custom-keyboard-themes-v1")):
        if old in value:
            values[key] = value[old] if isinstance(value[old], str) else json.dumps(value[old], separators=(",", ":"))
    ui["browserPreferences"] = {"version": 1, "values": values}
    directory = job_dir(job)
    target = directory / "verified" / "data" / "settings.json"
    write_json(target, partial)
    manifest = {"format": "pimfx-system-backup", "version": 1, "legacy": True,
                "createdAt": "Old configuration backup", "sourceRoot": str(DATA), "system": system_identity(),
                "categories": ["settings"], "files": [{"path": "data/settings.json", "category": "settings", "bytes": target.stat().st_size, "sha256": digest(target)}], "packages": []}
    write_json(directory / "manifest.json", manifest)
    status(job, state="complete", action="inspect", message="Old configuration verified; audio and libraries remain as currently configured",
           result={"createdAt": manifest["createdAt"], "categories": [{"id": "settings", "label": CATEGORIES["settings"], "count": 1, "bytes": target.stat().st_size}],
                   "compatible": True, "fileCount": 1, "warning": "This old backup contains only interface/controller/system configuration. It does not recover models, IRs, banks, plugins or media."})


def launch(request, action, source=None):
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = STATE / "operation.lock"
    with open(lock_path, "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("another backup or restore is running") from exc
        latest = read_json(STATE / "latest.json")
        if latest.get("id"):
            last = read_json(job_dir(latest["id"]) / "status.json")
            if last.get("state") in {"queued", "running"} and time.time() - last.get("updatedAt", 0) < 10:
                raise ValueError("another recovery job is starting")
        job = source or uuid.uuid4().hex
        directory = job_dir(job)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        write_json(directory / "request.json", {**request, "action": action})
        status(job, state="queued", action=action, message="Recovery job queued", result={}, source=request.get("source", ""))
        write_json(STATE / "latest.json", {"id": job})
        # Separate process survives engine and helper restarts. No password in argv or environment.
        try:
            command(["systemd-run", "--quiet", "--collect", "--unit=pimfx-recovery-" + job,
                     "--property=Nice=15", "--property=IOSchedulingClass=idle", "--property=UMask=0077",
                     "--setenv=PIMFX_DATA_ROOT=" + str(DATA), "--setenv=PIMFX_USER=" + USER,
                     "--setenv=PIMFX_PREFIX=" + str(PREFIX),
                     sys.executable, str(Path(__file__).resolve()), "worker", job])
        except Exception as exc:
            (directory / "request.json").unlink(missing_ok=True)
            status(job, state="failed", error=str(exc))
            raise
    return {"ok": True, "id": job}


def handle(request):
    op = str(request.get("op", "")).removeprefix("backup-")
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if op == "status":
        job = request.get("id") or read_json(STATE / "latest.json").get("id")
        return {"ok": True, "job": read_json(job_dir(job) / "status.json") if job else {"state": "idle"}}
    if op == "options":
        return {"ok": True, "categories": [{"id": k, "label": v} for k, v in CATEGORIES.items()], "devices": devices()}
    if op == "usb-files":
        return {"ok": True, "files": usb_files(request.get("device"))}
    if op == "import-usb":
        return launch(request, "import-usb")
    if op == "legacy":
        if len(json.dumps(request)) > 512 * 1024:
            raise ValueError("old configuration backup is larger than the supported 512 KiB")
        return launch(request, "legacy")
    if op == "create":
        selected_categories(request)
        if selected_categories(request) & {"connections", "plugins", "other"} and len(str(request.get("password", ""))) < 8:
            raise ValueError("set a backup password of at least 8 characters")
        return launch(request, "create")
    if op == "upload-begin":
        size = request.get("bytes")
        if not isinstance(size, int) or not 0 < size < 1024**5 or shutil.disk_usage(STATE).free < size + 64 * BLOCK:
            raise ValueError("invalid backup size or insufficient space")
        job = uuid.uuid4().hex
        directory = job_dir(job)
        directory.mkdir(mode=0o700, parents=True)
        write_json(directory / "upload.json", {"bytes": size})
        (directory / "upload").touch(mode=0o600)
        return {"ok": True, "id": job}
    if op == "upload-chunk":
        directory = job_dir(request.get("id", ""))
        expected = read_json(directory / "upload.json")["bytes"]
        block = base64.b64decode(request.get("data", ""), validate=True)
        if not 0 < len(block) <= BLOCK:
            raise ValueError("invalid upload chunk")
        with open(directory / "upload", "r+b") as out:
            fcntl.flock(out, fcntl.LOCK_EX)
            out.seek(0, os.SEEK_END)
            if out.tell() != request.get("offset") or out.tell() + len(block) > expected:
                raise ValueError("upload position changed; import the backup again")
            out.write(block)
        return {"ok": True}
    if op == "inspect":
        job = request.get("id", "")
        directory = job_dir(job)
        if (directory / "upload").stat().st_size != read_json(directory / "upload.json")["bytes"]:
            raise ValueError("backup upload is incomplete")
        return launch(request, "inspect", job)
    if op == "files":
        directory = job_dir(request.get("id", ""))
        manifest = read_json(directory / "manifest.json")
        group = request.get("category", "banks")
        offset = max(0, int(request.get("offset", 0)))
        files = selectable_files(directory, manifest, group)
        return {"ok": True, "files": files[offset:offset+100], "total": len(files)}
    if op == "restore":
        return launch(request, "restore")
    if op == "rollback":
        return launch(request, "rollback")
    if op == "download":
        directory = job_dir(request.get("id", ""))
        state = read_json(directory / "status.json")
        result = state.get("result", {})
        if state.get("state") != "complete" or state.get("action") != "create" or result.get("exported"):
            raise ValueError("backup is not ready for download")
        path = directory / Path(result.get("name", "")).name
        if not path.is_file():
            raise ValueError("temporary backup has expired")
        return {"ok": True, "path": str(path), "name": path.name, "bytes": path.stat().st_size}
    if op == "exported":
        job = request.get("id", "")
        directory = job_dir(job)
        state = read_json(directory / "status.json")
        result = state.get("result", {})
        if state.get("state") != "complete" or state.get("action") != "create":
            raise ValueError("backup is not ready for export completion")
        if not result.get("exported"):
            (directory / Path(result.get("name", "")).name).unlink(missing_ok=True)
            result.update(exported=True, destination=str(request.get("destination") or "Chosen browser file"))
            status(job, message="Backup saved off the Pi; temporary archive removed", result=result)
        return {"ok": True}
    if op == "discard":
        directory = job_dir(request.get("id", ""))
        job = read_json(directory / "status.json")
        if job.get("state") in {"running", "queued"} or recovery_busy():
            raise ValueError("wait for the recovery job to finish")
        shutil.rmtree(directory)
        return {"ok": True}
    raise ValueError("unknown recovery operation")


def worker(job):
    with open(STATE / "operation.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        request_path = job_dir(job) / "request.json"
        request = read_json(request_path)
        request_path.unlink(missing_ok=True)
        status(job, state="running")
        try:
            time.sleep(2)  # Let the engine send the accepted response before stopping it.
            if request["action"] in {"create", "restore", "rollback"}:
                prepared = prepare_engine()
                for key in ("application", "port"):
                    if key in prepared:
                        request[key] = prepared[key]
            {"create": create_backup, "inspect": inspect_backup, "restore": restore_backup,
             "import-usb": import_usb, "legacy": import_legacy, "rollback": rollback_job}[request["action"]](job, request)
        except Exception as exc:
            # Release large staging files before recording ENOSPC failures.
            for name in ("checked.zip", "archive.zip"):
                (job_dir(job) / name).unlink(missing_ok=True)
            for name in ("snapshot", "verified", "restore-packages"):
                path = job_dir(job) / name
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
            for path in job_dir(job).glob("*.pimfx-backup"):
                path.unlink(missing_ok=True)
            safe_restart = True
            journal = read_json(STATE / "restore-journal.json")
            if journal.get("job") == job and journal.get("phase") != "committed":
                try:
                    rollback(journal)
                    (STATE / "restore-journal.json").unlink(missing_ok=True)
                except Exception:
                    safe_restart = False  # Leave the durable journal for the boot guard.
            candidate = DATA.parent / (".pimfx-restore-" + job)
            if safe_restart and candidate.is_dir() and not candidate.is_symlink():
                shutil.rmtree(candidate)
            status(job, state="failed", error=str(exc), message="Recovery operation failed. Existing data was retained or rolled back; package changes may need review." if safe_restart else "Recovery needs disk repair; previous data and the restore journal were retained")
            # Also clears an engine preparation gate if failure happened before stop.
            if safe_restart and request.get("action") in {"create", "restore", "rollback"}:
                promote_session(DATA)
                command(["systemctl", "restart", "pimfx.service"], check=False)
        finally:
            shutil.rmtree(job_dir(job) / "restore-packages", ignore_errors=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Pi-MFX full and selective recovery")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("recover")
    sub.add_parser("worker").add_argument("job")
    create = sub.add_parser("backup")
    create.add_argument("destination", help="mounted external USB backup directory")
    create.add_argument("--categories", nargs="+", choices=list(CATEGORIES), default=list(CATEGORIES))
    create.add_argument("--plugin-mode", choices=["online", "self-contained"], default="online",
                        help="online records repository packages; self-contained includes their installers")
    restore = sub.add_parser("restore")
    restore.add_argument("archive")
    restore.add_argument("--categories", nargs="+", choices=list(CATEGORIES))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("run this recovery tool with sudo")
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if args.action == "recover":
        recover_interrupted()
        return
    if args.action == "worker":
        worker(args.job)
        return
    password = getpass.getpass("Backup password: ")
    if args.action == "backup":
        target = Path(args.destination).resolve()
        device = next((item for item in devices() if target == Path(item["mount"]) or target == Path(item["mount"]) / "Pi-MFX Backups"), None)
        if not device:
            parser.error("destination must be a mounted USB drive on a different physical disk")
        result = handle({"op": "backup-create", "password": password, "categories": args.categories,
                         "pluginMode": args.plugin_mode, "device": device["id"]})
    else:
        path = Path(args.archive)
        upload = handle({"op": "backup-upload-begin", "bytes": path.stat().st_size})
        shutil.copyfile(path, job_dir(upload["id"]) / "upload")
        result = handle({"op": "backup-inspect", "id": upload["id"], "password": password})
    while True:
        value = handle({"op": "backup-status", "id": result["id"]})["job"]
        print(value.get("message", ""), flush=True)
        if value["state"] in {"complete", "failed", "attention"}:
            break
        time.sleep(2)
    if value["state"] == "failed":
        raise SystemExit(value.get("error"))
    if args.action == "restore":
        print(json.dumps(value["result"], indent=2))
        if value["result"].get("onlinePackages"):
            print("Plugin recovery requires internet access and the recorded package versions must still be available.")
        if input("Restore this trusted backup and replace the selected content? Type RESTORE: ") != "RESTORE":
            return
        selected = args.categories or [item["id"] for item in value["result"]["categories"]]
        result = handle({"op": "backup-restore", "source": result["id"], "categories": selected,
                         "trusted": True, "conflicts": "replace", "full": set(selected) == set(CATEGORIES)})
        while True:
            value = handle({"op": "backup-status", "id": result["id"]})["job"]
            print(value.get("message", ""), flush=True)
            if value["state"] in {"complete", "failed", "attention"}:
                if value["state"] == "failed":
                    raise SystemExit(value.get("error"))
                print(json.dumps(value.get("result", {}), indent=2))
                if value["state"] == "attention":
                    raise SystemExit("Rig data restored; finish the installation item described above")
                break
            time.sleep(2)


if __name__ == "__main__":
    main()
