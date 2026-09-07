#!/usr/bin/env python3
"""Pi-MFX Wi-Fi hotspot control.

The engine is unprivileged. This script is run as root by systemd, the plugin
helper, or a NetworkManager dispatcher hook. It reads /var/lib/pimfx/hotspot.json.

Modes:
  off     stop the access point
  auto    start the AP when this Pi has no ethernet and no other Wi-Fi
  always  start the AP whenever Wi-Fi hardware is present
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import sys
import time

DATA_ROOT = os.environ.get("PIMFX_DATA_ROOT", "/var/lib/pimfx")
CONFIG_PATH = os.path.join(DATA_ROOT, "hotspot.json")
LOCK_PATH = "/run/pimfx-hotspot.lock"
STATUS_PATH = "/run/pimfx/hotspot-status.json"
CONN_NAME = "pimfx-hotspot"
SSID_RE = re.compile(r"^[\x20-\x7e]{1,32}$")
PSK_RE = re.compile(r"^[\x20-\x7e]{8,63}$")


def run(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        data = {}
    except (OSError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    mode = str(data.get("mode") or "off").strip().lower()
    if mode not in {"off", "auto", "always"}:
        mode = "off"
    ssid = str(data.get("ssid") or "PI-MFX").strip() or "PI-MFX"
    password = str(data.get("password") or "")
    return {"mode": mode, "ssid": ssid, "password": password}


def write_status(payload: dict) -> None:
    directory = os.path.dirname(STATUS_PATH)
    try:
        os.makedirs(directory, exist_ok=True)
        with open(STATUS_PATH, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    except OSError:
        pass


def nmcli(*args: str, timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return run(["/usr/bin/nmcli", *args], timeout=timeout)


def wifi_device() -> str:
    result = nmcli("-t", "-f", "DEVICE,TYPE,STATE", "device", "status")
    if result.returncode != 0:
        return ""
    fallback = ""
    for line in result.stdout.splitlines():
        parts = line.split(":")
        if len(parts) < 3 or parts[1] != "wifi":
            continue
        if parts[2] != "unavailable":
            return parts[0]
        fallback = parts[0]
    return fallback


def active_rows() -> list[tuple[str, str, str]]:
    result = nmcli("-t", "-f", "NAME,TYPE,DEVICE,STATE", "connection", "show", "--active")
    rows = []
    if result.returncode != 0:
        return rows
    for line in result.stdout.splitlines():
        parts = line.split(":")
        if len(parts) < 4:
            continue
        rows.append((parts[0], parts[1], parts[2]))
    return rows


def hotspot_active() -> bool:
    for name, _kind, _device in active_rows():
        if name == CONN_NAME:
            return True
    return False


def other_connection() -> bool:
    for name, kind, device in active_rows():
        if name == CONN_NAME or device == "lo":
            continue
        if "ethernet" in kind or kind == "802-3-ethernet":
            return True
        if "wireless" in kind or kind in {"wifi", "802-11-wireless"}:
            return True
    return False


def hotspot_ip() -> str:
    result = nmcli("-t", "-f", "IP4.ADDRESS", "connection", "show", CONN_NAME)
    if result.returncode != 0:
        return ""
    for line in result.stdout.splitlines():
        if ":" not in line:
            continue
        value = line.split(":", 1)[1].split("/", 1)[0].strip()
        if value:
            return value
    return ""


def connection_exists() -> bool:
    result = nmcli("-t", "-f", "NAME", "connection", "show")
    if result.returncode != 0:
        return False
    return any(line.strip() == CONN_NAME for line in result.stdout.splitlines())


def down() -> str:
    if not connection_exists():
        return ""
    result = nmcli("connection", "down", CONN_NAME, timeout=30)
    if result.returncode != 0:
        text = (result.stderr or result.stdout).strip()
        if "not active" in text.lower() or "not found" in text.lower():
            return ""
        return text or "could not stop the hotspot"
    return ""


def ensure_connection(device: str, ssid: str, password: str) -> str:
    if not SSID_RE.match(ssid):
        return "the hotspot name must be 1 to 32 printable characters"
    if not PSK_RE.match(password):
        return "the hotspot password must be 8 to 63 printable characters"
    if not connection_exists():
        added = nmcli(
            "connection",
            "add",
            "type",
            "wifi",
            "ifname",
            device,
            "con-name",
            CONN_NAME,
            "ssid",
            ssid,
            "autoconnect",
            "no",
            timeout=30,
        )
        if added.returncode != 0:
            return (added.stderr or added.stdout).strip() or "could not create the hotspot connection"
    modified = nmcli(
        "connection",
        "modify",
        CONN_NAME,
        "connection.interface-name",
        device,
        "802-11-wireless.ssid",
        ssid,
        "802-11-wireless.mode",
        "ap",
        "802-11-wireless.band",
        "bg",
        "ipv4.method",
        "shared",
        "ipv4.addresses",
        "10.42.0.1/24",
        "ipv6.method",
        "disabled",
        "wifi-sec.key-mgmt",
        "wpa-psk",
        "wifi-sec.psk",
        password,
        "connection.autoconnect",
        "no",
        timeout=30,
    )
    if modified.returncode != 0:
        return (modified.stderr or modified.stdout).strip() or "could not update the hotspot connection"
    return ""


def up(device: str, ssid: str, password: str) -> str:
    error = ensure_connection(device, ssid, password)
    if error:
        return error
    result = nmcli("connection", "up", CONN_NAME, timeout=40)
    if result.returncode != 0:
        return (result.stderr or result.stdout).strip() or "could not start the hotspot"
    return ""


def wait_for_other_connection(seconds: float = 40.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if other_connection():
            return True
        time.sleep(2.0)
    return other_connection()


def apply(wait: bool = True) -> dict:
    config = load_config()
    status = live_status(config)
    device = wifi_device()
    mode = config["mode"]
    if mode == "off":
        error = down()
        status = live_status(config)
        status["error"] = error
        write_status(status)
        return status
    if not PSK_RE.match(config["password"]):
        status["error"] = "set an 8-character hotspot password in Settings -> System -> Hotspot"
        write_status(status)
        return status
    if not device:
        status["error"] = "no Wi-Fi device was found"
        write_status(status)
        return status
    if mode == "auto":
        if wait:
            ready = wait_for_other_connection()
        else:
            ready = other_connection()
        if ready:
            error = down()
            status = live_status(config)
            status["error"] = error
            write_status(status)
            return status
    error = up(device, config["ssid"], config["password"])
    status = live_status(config)
    status["error"] = error
    write_status(status)
    return status


def engine_port() -> int:
    try:
        with open("/etc/systemd/system/pimfx.service", encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return 8080
    match = re.search(r"--port\s+(\d+)", text)
    return int(match.group(1)) if match else 8080


def split_nmcli(line: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    escaped = False
    for ch in line:
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    parts.append("".join(current))
    return parts


def station_ssid() -> str:
    if hotspot_active():
        return ""
    result = nmcli("-t", "-f", "IN-USE,SSID", "device", "wifi")
    if result.returncode != 0:
        return ""
    for line in result.stdout.splitlines():
        parts = split_nmcli(line)
        if len(parts) >= 2 and parts[0] == "*" and parts[1]:
            return parts[1]
    return ""


def wifi_scan() -> dict:
    nmcli("device", "wifi", "rescan", timeout=20)
    result = nmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", timeout=40)
    networks: list[dict] = []
    seen: set[str] = set()
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            parts = split_nmcli(line)
            if len(parts) < 4:
                continue
            ssid = parts[1].strip()
            if not ssid or ssid in seen:
                continue
            seen.add(ssid)
            security = parts[3].strip()
            signal = 0
            try:
                signal = int(parts[2] or "0")
            except ValueError:
                signal = 0
            networks.append({
                "ssid": ssid,
                "signal": signal,
                "security": security,
                "open": security in {"", "--", "-- "},
                "inUse": parts[0] == "*",
            })
    networks.sort(key=lambda item: item["signal"], reverse=True)
    status = live_status()
    status["networks"] = networks
    if result.returncode != 0:
        status["error"] = (result.stderr or result.stdout).strip() or "could not scan Wi-Fi"
    return status


def wifi_connect(ssid: str, password: str) -> dict:
    if not SSID_RE.match(ssid):
        status = live_status()
        status["error"] = "the network name must be 1 to 32 printable characters"
        return status
    if password and not PSK_RE.match(password):
        status = live_status()
        status["error"] = "the Wi-Fi password must be 8 to 63 printable characters"
        return status
    down()
    device = wifi_device()
    if not device:
        status = live_status()
        status["error"] = "no Wi-Fi device was found"
        return status
    args = ["device", "wifi", "connect", ssid, "ifname", device]
    if password:
        args.extend(["password", password])
    result = nmcli(*args, timeout=60)
    status = live_status()
    if result.returncode != 0:
        status["error"] = (result.stderr or result.stdout).strip() or "could not join that network"
    return status


def wifi_disconnect() -> dict:
    device = wifi_device()
    if device:
        result = nmcli("device", "disconnect", device, timeout=30)
        status = live_status()
        if result.returncode != 0:
            text = (result.stderr or result.stdout).strip()
            if "not active" not in text.lower():
                status["error"] = text or "could not disconnect Wi-Fi"
        return status
    status = live_status()
    status["error"] = "no Wi-Fi device was found"
    return status


def live_status(config: dict | None = None) -> dict:
    config = config or load_config()
    active = hotspot_active()
    address = hotspot_ip() if active else ""
    if active and not address:
        address = "10.42.0.1"
    port = engine_port()
    url = f"http://{address}:{port}" if address else ""
    station = station_ssid()
    return {
        "ok": True,
        "mode": config["mode"],
        "ssid": config["ssid"],
        "passwordSet": bool(config["password"]),
        "active": active,
        "device": wifi_device(),
        "ip": address,
        "url": url,
        "otherConnection": other_connection(),
        "stationSsid": station,
        "stationConnected": bool(station),
        "helper": os.path.abspath(__file__),
        "error": "",
    }


def uninstall() -> None:
    down()
    if connection_exists():
        nmcli("connection", "delete", CONN_NAME, timeout=20)
    try:
        os.remove(STATUS_PATH)
    except FileNotFoundError:
        pass


def dump(payload: dict) -> int:
    error = str(payload.get("error") or "")
    payload["ok"] = not error
    if error:
        payload["ok"] = False
    print(json.dumps(payload))
    return 0 if payload.get("ok") else 1


def with_lock() -> None:
    os.makedirs("/run", exist_ok=True)
    fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o644)
    fcntl.flock(fd, fcntl.LOCK_EX)
    globals()["_lock_fd"] = fd


def main() -> int:
    args = [item for item in sys.argv[1:] if item != "--nowait"]
    wait = "--nowait" not in sys.argv[1:]
    action = args[0] if args else "status"
    if action in {"apply", "up", "down", "uninstall", "wifi-scan", "wifi-connect", "wifi-disconnect"}:
        with_lock()
    if action == "status":
        return dump(live_status())
    if action == "apply":
        payload = apply(wait=wait)
        print(json.dumps(payload))
        return 0
    if action == "down":
        error = down()
        payload = live_status()
        payload["error"] = error
        write_status(payload)
        return dump(payload)
    if action == "uninstall":
        uninstall()
        return dump({"ok": True, "error": ""})
    if action == "wifi-scan":
        return dump(wifi_scan())
    if action == "wifi-connect":
        ssid = args[1] if len(args) > 1 else ""
        password = args[2] if len(args) > 2 else ""
        return dump(wifi_connect(ssid, password))
    if action == "wifi-disconnect":
        return dump(wifi_disconnect())
    print("Usage: hotspot.py [status|apply|down|uninstall|wifi-scan|wifi-connect|wifi-disconnect]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": "a NetworkManager command timed out"}))
        raise SystemExit(1)
    except Exception as exc:  # noqa: BLE001 — always return JSON to the helper
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1)
