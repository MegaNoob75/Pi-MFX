#!/usr/bin/env python3
"""Build bundled source without root; update only a positively identified
Pi-MFX USB-MIDI receiver. Imported by the privileged helper; also used by
update.sh. No browser-supplied paths, commands, images or MIDI ports accepted.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import queue
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

PREFIX = (0x7D, 0x4D, 0x46)
BEGIN, DATA, FINISH, ACK, QUERY, INFO, ABORT = range(0x40, 0x47)
ACTIVE = {"preparing", "building", "flashing", "verifying"}
GITHUB_API = "https://api.github.com/repos/MegaNoob75/Pi-MFX"
GITHUB_RAW = "https://raw.githubusercontent.com/MegaNoob75/Pi-MFX"
GITHUB_BRANCHES = {"main", "dev", "workstation"}


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w") as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)


def target_version(repo):
    text = (Path(repo) / "firmware/esp32s3/PiMFX_Controller/Protocol.h").read_text()
    return version_from_text(text)


def version_from_text(text):
    fields = [re.search(r"^\s*constexpr\s+uint8_t\s+kFirmware" + part + r"\s*=\s*(\d+)\s*;", text, re.MULTILINE)
              for part in ("Major", "Minor")]
    if not all(fields):
        raise ValueError("Controller firmware version is missing or invalid")
    version = tuple(int(field[1]) for field in fields)
    if any(value > 127 for value in version):
        raise ValueError("Firmware version fields must fit in MIDI's seven-bit format")
    return version


def github_download(path, raw=False, limit=2 * 1024 * 1024):
    request = urllib.request.Request((GITHUB_RAW if raw else GITHUB_API) + path,
        headers={"User-Agent": "Pi-MFX-controller-updater", "Accept": "application/vnd.github+json" if not raw else "text/plain"})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError("GitHub firmware response exceeds the size limit")
    return data


def github_latest(branch):
    if branch not in GITHUB_BRANCHES:
        raise ValueError("Choose main, dev or workstation for firmware updates")
    commit = json.loads(github_download(f"/commits/{branch}"))["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("GitHub returned an invalid firmware commit")
    header = github_download(f"/{commit}/firmware/esp32s3/PiMFX_Controller/Protocol.h", raw=True).decode()
    recipe = json.loads(github_download(f"/{commit}/firmware/controller-build.json", raw=True))
    if not isinstance(recipe, dict) or (recipe.get("protocol"), recipe.get("board")) != (1, 1):
        raise RuntimeError("This GitHub branch does not contain compatible controller firmware")
    if not {"arduinoCli", "cliSha256", "index", "core", "fqbn", "libraries"}.issubset(recipe):
        raise RuntimeError("GitHub controller build configuration is incomplete")
    return {"latestVersion": ".".join(map(str, version_from_text(header))), "latestCommit": commit,
            "latestBranch": branch, "checkedAt": time.time()}


def github_source(commit, root):
    """Download only firmware files from the checked commit, never remote updater code."""
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid GitHub firmware commit")
    cache = Path(root) / "controller-github"
    cache.mkdir(exist_ok=True)
    source = cache / commit
    if cache.is_symlink() or source.is_symlink():
        raise RuntimeError("Invalid firmware source cache path")
    if (source / ".complete").is_file():
        build_recipe(source)
        target_version(source)
        return source
    if source.exists():
        if source.is_symlink() or source.resolve().parent != cache.resolve():
            raise RuntimeError("Invalid firmware source cache path")
        shutil.rmtree(source)  # Incomplete download of this validated commit only.
    tree = json.loads(github_download(f"/git/trees/{commit}?recursive=1", limit=8 * 1024 * 1024))
    if tree.get("truncated"):
        raise RuntimeError("GitHub returned an incomplete source listing")
    with tempfile.TemporaryDirectory(prefix="pimfx-github-") as temporary:
        stage = Path(temporary)
        count = total = 0
        for entry in tree.get("tree", []):
            path = entry["path"]
            if not path.startswith("firmware/") or entry.get("type") != "blob":
                continue
            if path != "firmware/controller-build.json" and not (path.startswith("firmware/esp32s3/PiMFX_Controller/")
                    and Path(path).suffix in {".h", ".hpp", ".cpp", ".ino"}):
                continue
            if ".." in Path(path).parts or entry.get("mode") == "120000":
                raise RuntimeError("Invalid firmware source path on GitHub")
            data = github_download(f"/{commit}/{urllib.parse.quote(path, safe='/')}", raw=True)
            count += 1; total += len(data)
            if count > 128 or total > 16 * 1024 * 1024:
                raise RuntimeError("GitHub firmware source exceeds the size limit")
            target = stage / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        build_recipe(stage)
        target_version(stage)
        if not (stage / "firmware/esp32s3/PiMFX_Controller/PiMFX_Controller.ino").is_file():
            raise RuntimeError("GitHub branch has no controller sketch")
        # Write only into a new commit directory; an interrupted download is not cached.
        source.mkdir()
        try:
            shutil.copytree(stage / "firmware", source / "firmware")
            (source / ".complete").write_text(commit)
        except Exception:
            if source.resolve().parent == cache.resolve() and not source.is_symlink():
                shutil.rmtree(source)
            raise
    return source


def number(value):
    return [(value >> (7 * i)) & 127 for i in range(4)]


def unpack_number(data):
    return sum(v << (7 * i) for i, v in enumerate(data))


def pack(data):
    out = []
    for start in range(0, len(data), 7):
        group = data[start:start + 7]
        out.append(sum((v >> 7) << i for i, v in enumerate(group)))
        out.extend(v & 127 for v in group)
    return out


class Link:
    def __init__(self, mido, name):
        self.mido = mido
        self.messages = queue.Queue(maxsize=512)
        # In Mido's RtMidi backend client_name implies virtual=True: that makes
        # disconnected virtual ports instead of subscribing to the USB device.
        self.port = mido.open_ioport(name, callback=self.receive, virtual=False)
        self.token = secrets.randbelow(16383) + 1

    def receive(self, message):
        if message.type == "sysex" and tuple(message.data[:3]) == PREFIX:
            try:
                self.messages.put_nowait(tuple(message.data))
            except queue.Full:
                pass

    def close(self):
        self.port.close()

    def send(self, command, payload=()):
        data = (*PREFIX, command, self.token & 127, self.token >> 7, *payload)
        self.port.send(self.mido.Message("sysex", data=data))

    def wait(self, command, timeout=3, request=None, offset=None):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                data = self.messages.get(timeout=max(0.001, end - time.monotonic()))
            except queue.Empty:
                break
            if len(data) < 6 or data[3] != command or data[4:6] != (self.token & 127, self.token >> 7):
                continue
            if request is not None and (len(data) != 12 or data[6] != request):
                continue
            if offset is not None and data[7] == 0 and unpack_number(data[8:12]) != offset:
                continue  # delayed ACK from the previous chunk
            return data[6:]
        raise TimeoutError("Controller did not acknowledge the firmware transfer")

    def info(self):
        self.send(QUERY)
        data = self.wait(INFO, 1.5)
        if len(data) != 21 or data[0:2] != (1, 1):
            raise RuntimeError("Unsupported controller update protocol or board")
        if not re.fullmatch(rb"[0-9A-F]{12}", bytes(data[8:20])):
            raise RuntimeError("Controller returned an invalid device identity")
        return {"version": (data[2], data[3]), "capacity": unpack_number(data[4:8]),
                "deviceId": bytes(data[8:20]).decode("ascii"), "busy": bool(data[20])}

    def exchange(self, command, payload=(), offset=None):
        # Data retries are idempotent. Never retry Begin or Finish blindly.
        for attempt in range(3 if command == DATA else 1):
            self.send(command, payload)
            try:
                data = self.wait(ACK, request=command, offset=offset)
            except TimeoutError:
                if command == DATA and attempt < 2:
                    continue
                raise
            if data[1]:
                raise RuntimeError(f"Controller rejected firmware command {command:#x} (error {data[1]})")
            got = unpack_number(data[2:6])
            if offset is not None and got != offset:
                # A delayed duplicate ACK may still be in the queue.
                continue
            return
        raise RuntimeError("Controller firmware offset did not match")


def midi_backend():
    import mido
    mido.set_backend("mido.backends.rtmidi/LINUX_ALSA")
    return mido


def candidates(mido):
    return [name for name in mido.get_ioport_names()
            if any(word in name.lower() for word in ("pi-mfx", "pimfx", "esp32", "espressif", "tinyusb"))
            and raw_port(name)]  # Kernel card only, never Pi-MFX's own software port.


def seq_port(name):
    match = re.search(r"(\d+):(\d+)\s*$", name)
    if not match:
        raise RuntimeError("Cannot identify the controller ALSA sequencer port")
    return f"seq:{match[1]}:{match[2]}"


def raw_port(name):
    # Resolve the ALSA kernel client's card rather than assuming its numeric
    # sequencer ID is also the raw-MIDI card ID. This sketch has one MIDI port.
    import ctypes
    alsa = ctypes.CDLL("libasound.so.2")
    pointer = ctypes.c_void_p
    alsa.snd_seq_open.argtypes = [ctypes.POINTER(pointer), ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
    alsa.snd_seq_client_info_malloc.argtypes = [ctypes.POINTER(pointer)]
    alsa.snd_seq_get_any_client_info.argtypes = [pointer, ctypes.c_int, pointer]
    alsa.snd_seq_client_info_get_card.argtypes = [pointer]
    alsa.snd_seq_client_info_get_card.restype = ctypes.c_int
    alsa.snd_seq_client_info_free.argtypes = [pointer]
    alsa.snd_seq_close.argtypes = [pointer]
    client = int(seq_port(name).split(":")[1])
    seq, info = pointer(), pointer()
    if alsa.snd_seq_open(ctypes.byref(seq), b"default", 3, 1) < 0:
        return ""
    try:
        if alsa.snd_seq_client_info_malloc(ctypes.byref(info)) < 0:
            return ""
        if alsa.snd_seq_get_any_client_info(seq, client, info) < 0:
            return ""
        card = alsa.snd_seq_client_info_get_card(info)
        return f"hw:{card},0,0" if card >= 0 else ""
    finally:
        if info:
            alsa.snd_seq_client_info_free(info)
        alsa.snd_seq_close(seq)


def canonical_raw_port(port):
    """Compare a saved ALSA card-name address with the sequencer's card number."""
    match = re.fullmatch(r"hw:(?:CARD=)?([^,]+),(?:DEV=)?0(?:,(?:SUBDEV=)?0)?", port)
    if not match:
        return ""
    card = match[1]
    if card.isdecimal():
        return f"hw:{int(card)},0,0"
    import ctypes
    alsa = ctypes.CDLL("libasound.so.2")
    alsa.snd_card_get_index.argtypes = [ctypes.c_char_p]
    alsa.snd_card_get_index.restype = ctypes.c_int
    index = alsa.snd_card_get_index(card.encode())
    return f"hw:{index},0,0" if index >= 0 else ""


def engine_request(command, payload=None):
    port = os.environ.get("PIMFX_PORT", "")
    if not port:
        try:
            unit = Path("/etc/systemd/system/pimfx.service").read_text()
            match = re.search(r"--port\s+(\d+)", unit)
            port = match[1] if match else "8080"
        except OSError:
            port = "8080"
    request = urllib.request.Request(f"http://127.0.0.1:{int(port)}/api/{command}",
        data=json.dumps(payload or {}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.load(response)
    if not value.get("ok", False):
        raise RuntimeError(value.get("error", "Pi-MFX refused the MIDI connection change"))
    return value


def share_controller_port(root, names, report):
    # Raw MIDI is exclusive. The engine and firmware worker must both use the
    # same ALSA sequencer device, never competing raw/sequencer handles.
    saved = read_json(Path(root) / "settings.json").get("controller", {}).get("midiPort", "")
    if not saved.startswith("hw:") or not names:
        return
    raw = canonical_raw_port(saved)
    matches = [name for name in names if raw and raw_port(name) == raw]
    if len(matches) != 1:
        return
    try:
        ports = engine_request("midi/ports")
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, ConnectionRefusedError):
            # A stopped engine owns no raw-MIDI handle (e.g. a CLI-only update).
            return
        raise RuntimeError("Could not prepare the controller connection through Pi-MFX") from exc
    if not ports.get("connected") or ports.get("activePort") != saved:
        return
    state = engine_request("state")
    controller = state.get("controller", {})
    phase = controller.get("boardSetup", {}).get("phase")
    if controller.get("learning") or phase in {"reading", "searching", "proposing", "review", "saving"}:
        raise RuntimeError("Finish or cancel Hardware Setup before updating controller firmware")
    target = seq_port(matches[0])
    if not any(p.get("id") == target and p.get("input") and p.get("output") for p in ports.get("ports", [])):
        raise RuntimeError("The controller's shared MIDI connection is unavailable")
    report("preparing", "Preparing the controller's shared MIDI connection")
    try:
        engine_request("controller/connect", {"port": target})
    except Exception:
        with contextlib.suppress(Exception):
            engine_request("controller/connect", {"port": saved})
        raise


def build_recipe(repo):
    path = Path(repo) / "firmware/controller-build.json"
    try:
        config = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Cannot read controller build configuration: {path}: {exc}") from exc
    required = {"arduinoCli", "cliSha256", "index", "core", "fqbn", "libraries"}
    if not isinstance(config, dict) or not required.issubset(config):
        raise RuntimeError(f"Controller build configuration is incomplete: {path}")
    return config


@contextlib.contextmanager
def readable_build_source(repo):
    # The source checkout may be under a private login home. Copy only firmware
    # into a fresh root-owned temp directory; never relax the home permissions
    # or copy as root into the service user's writable build cache.
    build_recipe(repo)
    with tempfile.TemporaryDirectory(prefix="pimfx-firmware-source-") as directory:
        source = Path(directory)
        shutil.copytree(Path(repo) / "firmware", source / "firmware",
                        ignore=shutil.ignore_patterns("build", "bin", "dist", "out", "obj", "__pycache__", "*.pyc", "*.o", "*.bin"))
        source.chmod(0o755)
        for folder, directories, files in os.walk(source):
            Path(folder).chmod(0o755)
            for name in files:
                (Path(folder) / name).chmod(0o644)
        yield source


def first_install_port(port):
    """Only an explicitly selected, existing USB serial character device."""
    path = Path(port).resolve(strict=True)
    if not re.fullmatch(r"/dev/tty(?:ACM|USB)\d+", str(path)) or not stat.S_ISCHR(path.stat().st_mode):
        raise ValueError("Select an ESP32-S3 USB serial port on the Pi (/dev/ttyACM… or /dev/ttyUSB…)")
    return path


def first_install_recipe(config):
    if (config.get("protocol"), config.get("board")) != (1, 1) or not config["fqbn"].startswith("esp32:esp32:esp32s3:"):
        raise ValueError("First-time installation supports only the Pi-MFX ESP32-S3 image")
    options = dict(item.split("=", 1) for item in config["fqbn"].split(":", 3)[3].split(","))
    if options.get("PartitionScheme") != "min_spiffs" or options.get("FlashSize") != "4M":
        raise ValueError("First-time installation requires the supported 4MB OTA partition layout")
    if options.get("EraseFlash", "none") != "none" or options.get("USBMode", "default") != "default" or options.get("CDCOnBoot", "default") != "default":
        raise ValueError("First-time installation requires native USB-MIDI with full-flash erase disabled")


def build(repo, cache, upload_port=""):
    """Runs as the service user, never root. All dependency versions are pinned."""
    if os.geteuid() == 0:
        raise RuntimeError("Firmware builds must run as the unprivileged Pi-MFX user")
    config = build_recipe(repo)
    port_identity = None
    if upload_port:
        first_install_recipe(config)
        port = first_install_port(upload_port)
        port_identity = (port, port.stat().st_rdev, port.stat().st_ino)
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    cli = cache / ("arduino-cli-" + config["arduinoCli"])
    if not cli.exists():
        print("==> Downloading Arduino CLI", flush=True)
        arch = {"aarch64": "ARM64", "armv7l": "ARMv7", "x86_64": "64bit"}.get(platform.machine())
        if not arch:
            raise RuntimeError("No Arduino CLI package configured for this Pi architecture")
        archive = f'arduino-cli_{config["arduinoCli"]}_Linux_{arch}.tar.gz'
        base = f'https://github.com/arduino/arduino-cli/releases/download/v{config["arduinoCli"]}/'
        with urllib.request.urlopen(base + archive, timeout=60) as response:
            blob = response.read(40 * 1024 * 1024)
        expected = config["cliSha256"][arch]
        if hashlib.sha256(blob).hexdigest() != expected:
            raise RuntimeError("Arduino CLI download checksum mismatch")
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
            member = tar.getmember("arduino-cli")
            if not member.isfile() or member.size > 100 * 1024 * 1024:
                raise RuntimeError("Invalid Arduino CLI archive")
            binary = tar.extractfile(member).read()
        temporary_cli = cli.with_suffix(".download")
        temporary_cli.write_bytes(binary)
        temporary_cli.chmod(0o755)
        os.replace(temporary_cli, cli)
    env = os.environ.copy()
    env.update(ARDUINO_DIRECTORIES_DATA=str(cache / "data"),
               ARDUINO_DIRECTORIES_DOWNLOADS=str(cache / "downloads"),
               ARDUINO_DIRECTORIES_USER=str(cache / "user"),
               ARDUINO_NETWORK_CONNECTION_TIMEOUT="600s")
    base = [str(cli), "--additional-urls", config["index"]]

    def command(args, timeout=1200):
        subprocess.run(base + args, env=env, check=True, timeout=timeout)

    stamp = cache / "dependencies.json"
    if read_json(stamp) != config:
        print("==> Refreshing board package index", flush=True)
        command(["core", "update-index"])
        print("==> Installing ESP32 build tools (first download can be several hundred MB)", flush=True)
        command(["core", "install", config["core"]])
        print("==> Refreshing library index", flush=True)
        command(["lib", "update-index"])
        print("==> Installing controller libraries", flush=True)
        command(["lib", "install", *config["libraries"]])
        atomic_json(stamp, config)
    else:
        print("==> Reusing installed ESP32 tools and controller libraries", flush=True)
    sketch = Path(repo) / "firmware/esp32s3/PiMFX_Controller"
    out = cache / "output"
    print("==> Compiling controller firmware", flush=True)
    command(["compile", "--verbose", "--fqbn", config["fqbn"], "--jobs", "2",
             "--output-dir", str(out), str(sketch)], 1800)
    image = out / "PiMFX_Controller.ino.bin"
    if not image.is_file():
        raise RuntimeError("Arduino did not produce the application firmware image")
    print(f"==> Firmware build complete ({image.stat().st_size:,} bytes)", flush=True)
    if upload_port:
        port = first_install_port(upload_port)
        if (port, port.stat().st_rdev, port.stat().st_ino) != port_identity:
            raise RuntimeError("The selected USB port changed during the build. Select the controller again.")
        for suffix in ("bootloader.bin", "partitions.bin"):
            if not (out / f"PiMFX_Controller.ino.{suffix}").is_file():
                raise RuntimeError(f"Build is missing the initial-install {suffix}; nothing was flashed")
        print(f"==> Writing initial ESP32-S3 firmware to {port} (keep USB connected)", flush=True)
        # The pinned ESP32 core supplies esptool, the chip check, all image
        # offsets and OTA initialization. Do not hard-code these or erase NVS.
        command(["upload", "--verbose", "--fqbn", config["fqbn"], "--port", str(port),
                 "--protocol", "serial", "--input-dir", str(out), "--verify", str(sketch)], 300)


def first_install(repo, root, user, port):
    """Explicit CLI-only provisioning; never called by the background updater."""
    import pwd
    root = Path(root)
    log_path = root / "controller-firmware.log"
    log_path.write_text("")
    version = target_version(repo)

    def report(state, message, **extra):
        atomic_json(root / "controller-firmware-status.json", {
            "state": state, "message": message, "updatedAt": time.time(),
            "targetVersion": ".".join(map(str, version)), **extra})
        with log_path.open("a") as log:
            log.write(message + "\n")
        print(message, flush=True)

    try:
        first_install_recipe(build_recipe(repo))
        first_install_port(port)
        state = engine_request("state")
        controller = state.get("controller", {})
        if controller.get("learning") or controller.get("boardSetup", {}).get("phase") in {"reading", "searching", "proposing", "review", "saving"}:
            raise RuntimeError("Finish or cancel Hardware Setup before installing controller firmware")
        account = pwd.getpwnam(user)
        if account.pw_uid == 0:
            raise RuntimeError("Pi-MFX service user must not be root")
        cache = root / "controller-build"
        cache.mkdir(exist_ok=True)
        os.chown(cache, account.pw_uid, account.pw_gid)
        report("building", "Building the initial controller image; first use downloads the ESP32 tools")
        with readable_build_source(repo) as source:
            run_logged_build(["runuser", "-u", user, "--", sys.executable, "-u", str(Path(__file__).resolve()),
                              "--build", "--upload-port", port, "--repo", str(source), "--data", str(cache)], log_path)
        report("verifying", "USB flash completed. Waiting for the controller; tap RESET or reconnect native USB if needed.")
        # Firmware's ESP.getEfuseMac() is formatted as a little-endian uint64.
        macs = re.findall(r"\bMAC:\s*((?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})", log_path.read_text())
        if not macs:
            raise RuntimeError("USB upload completed, but its chip identity was not reported; controller operation is not verified. Review the log.")
        expected_id = "".join(reversed(macs[-1].split(":"))).upper()
        mido = midi_backend()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            names = candidates(mido)
            share_controller_port(root, names, report)
            for name in names:
                try:
                    link = Link(mido, name)
                    try:
                        info = link.info()
                    finally:
                        link.close()
                    if info["deviceId"] == expected_id and info["version"] == version and info["capacity"] > 0:
                        report("current", "First-time controller installation verified. Open Hardware Setup to configure controls.",
                               installedVersion=".".join(map(str, version)))
                        return
                except (OSError, RuntimeError, TimeoutError):
                    continue
            time.sleep(1)
        raise RuntimeError("USB upload completed, but the flashed controller did not reply with the expected identity, version and OTA capacity. Reconnect its native USB port and check Hardware Setup.")
    except Exception as exc:
        report("failed", str(exc))
        raise


def run_logged_build(command, log_path, timeout=2400):
    """Keep the durable/UI log while forwarding build output live over SSH."""
    stopped = threading.Event()
    started = time.monotonic()
    with Path(log_path).open("a") as log, Path(log_path).open("r", errors="replace") as reader:
        reader.seek(0, os.SEEK_END)
        def follow():
            last_output = time.monotonic()
            while True:
                output = reader.read()
                if output:
                    print(output, end="", flush=True)
                    last_output = time.monotonic()
                elif time.monotonic()-last_output >= 15:
                    print(f"==> Firmware build still running ({int(time.monotonic()-started)}s elapsed)", flush=True)
                    last_output = time.monotonic()
                if stopped.is_set():
                    # Process has exited and its output handle has been closed.
                    output = reader.read()
                    if output: print(output, end="", flush=True)
                    return
                stopped.wait(0.2)
        worker = threading.Thread(target=follow, daemon=True, name="controller-build-output")
        worker.start()
        try:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=timeout)
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(f"Controller firmware build failed (exit {exc.returncode}). Review the build output above and retry.") from exc
        finally:
            log.flush()
            stopped.set()
            worker.join()


def transfer(link, image, info, version, report):
    blob = Path(image).read_bytes()
    if not blob or blob[0] != 0xE9 or len(blob) > info["capacity"]:
        raise RuntimeError("Firmware image does not fit the controller's inactive OTA slot")
    if info["busy"]:
        raise RuntimeError("Finish Hardware Setup before updating controller firmware")
    digest = hashlib.md5(blob).hexdigest().encode("ascii")
    started = False
    try:
        link.exchange(BEGIN, [*number(len(blob)), *digest, 1, 1], offset=0)
        started = True
        last_percent = -1
        for offset in range(0, len(blob), 42):
            chunk = blob[offset:offset + 42]
            link.exchange(DATA, [*number(offset), *pack(chunk)], offset=offset + len(chunk))
            percent = (offset + len(chunk)) * 100 // len(blob)
            if percent != last_percent:
                report("flashing", f"Writing controller firmware: {percent}%", progress=percent)
                last_percent = percent
        report("verifying", "Checking firmware checksum and restarting controller")
        try:
            link.exchange(FINISH)
        except TimeoutError:
            # The reboot can precede receipt of the final ACK. Read back the
            # device identity/version before deciding whether it succeeded.
            pass
        started = False
    finally:
        if started:
            with contextlib.suppress(Exception):
                link.send(ABORT)


def perform(repo, root, user):
    root = Path(root)
    version = target_version(repo)
    status_path = root / "controller-firmware-status.json"
    log_path = root / "controller-firmware.log"
    log_path.write_text("")

    def report(state, message, **extra):
        payload = {"state": state, "message": message, "updatedAt": time.time(),
                   "targetVersion": ".".join(map(str, version)), **extra}
        atomic_json(status_path, payload)
        with log_path.open("a") as log:
            log.write(message + "\n")
        print(message, flush=True)

    report("preparing", "Checking connected Pi-MFX controller")
    try:
        recipe = read_json(Path(repo) / "firmware/controller-build.json")
        if recipe and (recipe.get("protocol"), recipe.get("board")) != (1, 1):
            raise RuntimeError("This Pi-MFX updater does not support the bundled firmware protocol/board")
        mido = midi_backend()
        names = candidates(mido)
        share_controller_port(root, names, report)
        found = []
        legacy = False
        for name in names:
            link = Link(mido, name)
            try:
                try:
                    info = link.info()
                    found.append((name, info))
                except TimeoutError:
                    # Legacy firmware needs a one-time bootstrap, never an
                    # attempted write to an unidentified MIDI device.
                    link.port.send(mido.Message("sysex", data=(*PREFIX, 0x01)))
                    end = time.monotonic() + 1
                    while time.monotonic() < end:
                        try:
                            reply = link.messages.get(timeout=0.1)
                            legacy |= len(reply) == 11 and reply[3] == 0x10
                        except queue.Empty:
                            pass
            finally:
                link.close()
        if not found:
            report("bootstrap" if legacy else "pending", "Upload the current controller firmware once with Arduino IDE and an OTA partition scheme."
                   if legacy else "The controller MIDI port is present, but its firmware updater did not reply. Finish Hardware Setup or reconnect the controller and retry."
                   if names else "Controller update pending. Connect a supported Pi-MFX USB-MIDI controller.")
            return
        if len(found) != 1:
            raise RuntimeError("Connect only one Pi-MFX controller while updating firmware")
        name, info = found[0]
        if info["version"] >= version:
            report("current", "Controller firmware is up to date", installedVersion=".".join(map(str, info["version"])))
            return
        if not info["capacity"]:
            report("bootstrap", "Controller has no inactive OTA slot. Upload once with an OTA partition scheme in Arduino IDE.")
            return
        if info.get("busy"):
            raise RuntimeError("Finish Hardware Setup before updating controller firmware")
        previous_port = seq_port(name)
        previous_raw_port = raw_port(name)
        report("building", "Building controller firmware from bundled source (first build downloads tools)")
        import pwd
        account = pwd.getpwnam(user)
        if account.pw_uid == 0:
            raise RuntimeError("Pi-MFX service user must not be root")
        cache = root / "controller-build"
        cache.mkdir(exist_ok=True)
        os.chown(cache, account.pw_uid, account.pw_gid)
        with readable_build_source(repo) as build_source:
            run_logged_build(["runuser", "-u", user, "--", sys.executable, "-u", str(Path(__file__).resolve()),
                              "--build", "--repo", str(build_source), "--data", str(cache)], log_path)
        # Re-query after the long build. Never use a stale card/port identity.
        link = Link(mido, name)
        try:
            fresh = link.info()
            if fresh["deviceId"] != info["deviceId"]:
                raise RuntimeError("The connected controller changed during the build")
            if fresh["version"] >= version:
                report("current", "Controller firmware is up to date", installedVersion=".".join(map(str, fresh["version"])))
                return
            transfer(link, cache / "output/PiMFX_Controller.ino.bin", fresh, version, report)
        finally:
            link.close()
        end = time.monotonic() + 45
        while time.monotonic() < end:
            time.sleep(1)
            for candidate in candidates(mido):
                try:
                    check = Link(mido, candidate)
                    try:
                        result = check.info()
                    finally:
                        check.close()
                    if result["deviceId"] == info["deviceId"] and result["version"] == version:
                        atomic_json(root / "controller-firmware-reconnect.json",
                                    {"id": secrets.token_hex(16), "previousPort": previous_port,
                                     "previousRawPort": previous_raw_port, "rawPort": raw_port(candidate),
                                     "port": seq_port(candidate), "deviceId": info["deviceId"], "createdAt": time.time()})
                        report("current", "Controller update verified", installedVersion=".".join(map(str, version)))
                        return
                except (OSError, RuntimeError, TimeoutError):
                    continue
        raise RuntimeError("Firmware was sent, but the controller did not reconnect with the expected version. Reconnect it and retry.")
    except Exception as exc:
        report("failed", str(exc))
        raise


class Manager:
    """One worker process, durable policy/status, quiet retries on connection.
    Explicit failures wait for Retry; reconnecting never causes a flash loop.
    """
    def __init__(self, repo, root, user, busy=lambda: False):
        self.repo, self.root, self.user, self.busy = repo, Path(root), user, busy
        self.lock = threading.Lock()
        self.process = None
        self.github_lock = threading.Lock()
        self.github_checks = read_json(self.root / "controller-firmware-github.json")

    def github_status(self, branch, refresh=False):
        if branch not in GITHUB_BRANCHES:
            return {"latestError": "Choose main, dev or workstation", "latestBranch": branch}
        with self.github_lock:
            entry = self.github_checks.setdefault(branch, {})
            ttl = 60 if entry.get("latestError") else 600
            if not entry.get("latestChecking") and (refresh or time.time()-entry.get("attemptedAt", 0) > ttl):
                entry["latestChecking"] = True
                def check():
                    try:
                        result = {**github_latest(branch), "latestError": ""}
                    except Exception as exc:
                        result = {"latestError": f"Could not check GitHub: {exc}"}
                    with self.github_lock:
                        self.github_checks[branch].update(result, latestChecking=False, attemptedAt=time.time())
                        saved = {key: {k: v for k, v in value.items() if k != "latestChecking"}
                                 for key, value in self.github_checks.items()}
                        atomic_json(self.root / "controller-firmware-github.json", saved)
                threading.Thread(target=check, daemon=True, name="controller-github-check").start()
            return {**entry, "latestBranch": branch}

    def status(self, branch=None, refresh=False):
        value = read_json(self.root / "controller-firmware-status.json")
        if value.get("state") in ACTIVE and time.time() - value.get("updatedAt", 0) > 15:
            import fcntl
            with (self.root / "controller-firmware.lock").open("a") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    value.update(state="failed", message="Controller update was interrupted. Reconnect the controller and retry.")
                    atomic_json(self.root / "controller-firmware-status.json", value)
        policy = read_json(self.root / "controller-firmware-policy.json")
        value["automatic"] = bool(policy.get("enabled"))
        repo = policy.get("sourceRepo") or self.repo()
        try:
            value["bundledVersion"] = ".".join(map(str, target_version(repo))) if repo else "Unknown"
        except (OSError, ValueError, TypeError):
            value["bundledVersion"] = "Unknown"
        value.setdefault("state", "idle")
        value.setdefault("message", "Controller firmware is built and updated automatically with Pi-MFX.")
        try:
            value["log"] = (self.root / "controller-firmware.log").read_text()[-24000:]
        except OSError:
            pass
        if branch is not None:
            value.update(self.github_status(branch, refresh))
        return value

    def start(self, arm=False, github=False, branch="dev"):
        with self.lock:
            if self.process and self.process.poll() is None:
                return self.status()
            if self.busy() or update_locked():
                return {**self.status(), "message": "Wait for the Pi-MFX update to finish"}
            policy = read_json(self.root / "controller-firmware-policy.json")
            repo = policy.get("sourceRepo") or self.repo()
            github_ref = policy.get("githubRef", "")
            github_branch = policy.get("githubBranch", "")
            if github:
                latest = self.github_status(branch)
                if latest.get("latestChecking") or latest.get("latestError") or not latest.get("latestCommit"):
                    return {**self.status(), **latest, "message": latest.get("latestError") or "Checking GitHub for controller firmware…"}
                github_ref, github_branch = latest["latestCommit"], branch
            if not repo and not github_ref:
                return {"state": "failed", "message": "Pi-MFX source folder is unavailable"}
            if arm:
                policy = {"enabled": True, "sourceRepo": repo}
                if github_ref:
                    policy.update(githubRef=github_ref, githubBranch=github_branch)
                atomic_json(self.root / "controller-firmware-policy.json", policy)
            atomic_json(self.root / "controller-firmware-status.json",
                        {"state": "preparing", "message": "Checking controller firmware", "updatedAt": time.time()})
            command = [sys.executable, str(Path(__file__).resolve()),
                "--run", "--repo", repo or "", "--data", str(self.root), "--user", self.user]
            if github_ref:
                command += ["--github-ref", github_ref]
            self.process = subprocess.Popen(command,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return self.status()

    def monitor(self):
        def work():
            while True:
                time.sleep(30)
                try:
                    state = self.status()
                    if state["automatic"] and state["state"] != "failed" and not self.busy():
                        self.start()
                except Exception:
                    pass
        threading.Thread(target=work, daemon=True, name="pimfx-controller-update").start()


def update_locked():
    import fcntl
    try:
        with open("/run/pimfx/update-build.lock", "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return False
            except BlockingIOError:
                return True
    except FileNotFoundError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--user", default="pimfx")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--arm", action="store_true")
    parser.add_argument("--first-install-port", default="")
    parser.add_argument("--confirm-first-install", action="store_true")
    parser.add_argument("--upload-port", default="")
    parser.add_argument("--github-ref", default="")
    args = parser.parse_args()
    if args.build:
        build(args.repo, args.data, args.upload_port)
        return
    if args.first_install_port and not args.confirm_first_install:
        parser.error("First-time installation requires explicit --confirm-first-install")
    import fcntl
    root = Path(args.data)
    root.mkdir(parents=True, exist_ok=True)
    # update.sh holds this gate across its entire source/build transaction;
    # its --arm child is the only worker allowed within that transaction.
    gate = None
    if not args.arm:
        gate = open("/run/pimfx/update-build.lock", "a")
        try:
            fcntl.flock(gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.first_install_port:
                raise RuntimeError("Another update is running. Wait and retry first-time installation.")
            return
    # Shared across CLI updater, helper restarts, and pending-update monitor.
    with (root / "controller-firmware.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.first_install_port:
                raise RuntimeError("Another controller operation is running. Wait and retry first-time installation.")
            return
        if args.first_install_port:
            first_install(args.repo, root, args.user, args.first_install_port)
            return
        if args.arm:
            atomic_json(root / "controller-firmware-policy.json", {"enabled": True, "sourceRepo": args.repo})
        repo = args.repo
        if args.github_ref:
            (root / "controller-firmware.log").write_text("Downloading controller firmware source from GitHub\n")
            atomic_json(root / "controller-firmware-status.json", {"state": "preparing",
                "message": "Downloading controller firmware source from GitHub", "updatedAt": time.time()})
            try:
                repo = github_source(args.github_ref, root)
            except Exception as exc:
                with (root / "controller-firmware.log").open("a") as log:
                    log.write(str(exc) + "\n")
                atomic_json(root / "controller-firmware-status.json", {"state": "failed", "message": str(exc), "updatedAt": time.time()})
                raise
        perform(repo, root, args.user)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
        sys.exit(f"Controller firmware update failed: {exc}")
