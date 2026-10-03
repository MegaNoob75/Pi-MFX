#!/usr/bin/env python3
"""Root helper for Pi-MFX plugin apt, extra-repo, updates, Wi-Fi, and power.

The audio engine runs as an unprivileged user with NoNewPrivileges, so it
cannot call apt, nmcli, reboot, or shutdown. This process listens on a UNIX
socket owned by that user, accepts one JSON command per connection, and
replies with one JSON object.

It only installs packages on the curated list. Repo lines must be HTTPS and
include a signing key. Hotspot and Wi-Fi commands only run the installed
hotspot.py helper. Power commands talk to systemd/logind. It never runs a
shell with user text.
"""
from __future__ import annotations

import glob
import json
import os
import pwd
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request

SOCK_PATH = sys.argv[1] if len(sys.argv) > 1 else "/run/pimfx/plugin-helper.sock"
PIMFX_USER = os.environ.get("PIMFX_USER", "pimfx")
DATA_ROOT = os.environ.get("PIMFX_DATA_ROOT", "/var/lib/pimfx")
PREFIX = os.environ.get("PIMFX_PREFIX", "/usr/local")
HOTSPOT_SCRIPT = os.path.join(PREFIX, "libexec/pimfx/hotspot.py")
REPO_DIR = os.environ.get("PIMFX_REPO", "")
UPDATE_STATUS_PATH = "/run/pimfx/update-status.json"
UPDATE_LOG_PATH = "/run/pimfx/update.log"
LV2_UPDATE_STATUS_PATH = os.path.join(DATA_ROOT, "lv2-update-status.json")
SOURCE_REPO_PATH = os.path.join(DATA_ROOT, "source-repo")
PUBLIC_REPO_URL = "https://github.com/MegaNoob75/Pi-MFX.git"
PATCHSTORAGE_PATCH_URL = "https://patchstorage.com/api/beta/patches/{patch_id}/"
PIPEDAL_LATEST_RELEASE_URL = "https://api.github.com/repos/rerdavies/pipedal/releases/latest"
LV2_CHECK_TTL_SECONDS = 6 * 60 * 60
SOURCES_DIR = "/etc/apt/sources.list.d"
KEYRING_DIR = "/usr/share/keyrings"

PACKAGE_RE = re.compile(r"^[a-z0-9][a-z0-9.+-]{0,79}$")
REPO_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
SUITE_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
COMPONENT_RE = re.compile(r"^[A-Za-z0-9._/-]+$")

SUGGESTED = {
    "calf-plugins",
    "x42-plugins",
    "zam-plugins",
    "guitarix-lv2",
    "gxplugins",
    "lsp-plugins-lv2",
    "eq10q",
    "dragonfly-reverb",
    "tap-plugins",
    "swh-lv2",
    "invada-studio-plugins-lv2",
    "mda-lv2",
    "dpf-plugins",
    "infamous-plugins",
    "rubberband-lv2",
    "toobamp",
}

PLUGIN_NAME_HINTS = ("lv2", "guitarix", "gxplugin", "calf", "zam-plugin", "x42", "toobamp")
DEB_PACKAGES = {"toobamp"}
HEAVY_OPS = {
    "apt-install",
    "apt-remove",
    "apt-update",
    "deb-install",
    "repo-add",
    "repo-remove",
    "update-install",
    "lv2-update-install-apt",
}
HEAVY_LOCK = threading.Lock()
STATUS_LOCK = threading.Lock()
FETCH_LOCK = threading.Lock()
INSTALL_LOCK = threading.Lock()
_fetch_running = False
_fetch_error = ""
_install_running = False
LV2_CHECK_LOCK = threading.Lock()
_lv2_check_running = False


def reply(conn: socket.socket, payload: dict) -> None:
    conn.sendall((json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8"))


def fail(conn: socket.socket, message: str) -> None:
    reply(conn, {"ok": False, "error": message})


# apt-get's file/http methods drop to _apt (uid 42). The helper is a locked-down
# systemd unit, so that seteuid fails. Stay root and still use apt-get so local
# .deb installs pull dependencies (ToobAmp requires apt-get, not apt or dpkg).
APT_GET = [
    "apt-get",
    "-o", "APT::Sandbox::User=root",
    "-o", "Dpkg::Use-Pty=0",
]


def run(
    args: list[str],
    timeout: int,
    env: dict[str, str] | None = None,
    cwd: str | None = None,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged["DEBIAN_FRONTEND"] = "noninteractive"
    if env:
        merged.update(env)
    return subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=merged,
        cwd=cwd,
        input=input_text,
    )


def apt_get(args: list[str], timeout: int, cwd: str | None = None) -> subprocess.CompletedProcess[str]:
    return run([*APT_GET, *args], timeout=timeout, cwd=cwd)


def valid_https(url: str) -> bool:
    return (
        url.startswith("https://")
        and " " not in url
        and ".." not in url
        and len(url) < 300
        and "\n" not in url
        and "\r" not in url
    )


def is_plugin_package(name: str, description: str = "") -> bool:
    return name in SUGGESTED or name in DEB_PACKAGES


def apt_show_description(name: str) -> str:
    result = run(["apt-cache", "show", name], timeout=20)
    if result.returncode != 0:
        return ""
    for line in result.stdout.splitlines():
        if line.startswith("Description"):
            return line.split(":", 1)[-1].strip()
    return ""


def allow_package(name: str) -> tuple[bool, str]:
    if not PACKAGE_RE.match(name):
        return False, "that is not a valid package name"
    if name in SUGGESTED or name in DEB_PACKAGES:
        return True, ""
    return False, "that package is not on the Pi-MFX install list"


def allow_deb_path(path: str) -> tuple[bool, str]:
    if not path or "\n" in path or "\0" in path:
        return False, "that package path is not allowed"
    roots = {
        os.path.realpath(os.path.join(DATA_ROOT, "downloads")),
        os.path.realpath("/var/lib/pimfx/downloads"),
    }
    real = os.path.realpath(path)
    if not real.endswith(".deb"):
        return False, "that is not a .deb file"
    if not any(real == root or real.startswith(root + os.sep) for root in roots):
        return False, "that package is not in the Pi-MFX downloads folder"
    if not os.path.isfile(real):
        return False, "that package file is missing"
    return True, ""


def package_installed(name: str) -> bool:
    result = run(["dpkg-query", "-W", "-f=${Status}", name], timeout=10)
    return result.returncode == 0 and "install ok installed" in result.stdout


def parse_search_lines(text: str) -> list[dict]:
    packages = []
    seen = set()
    for line in text.splitlines():
        if " - " not in line:
            continue
        name, description = line.split(" - ", 1)
        name = name.strip()
        description = description.strip()
        if not PACKAGE_RE.match(name) or name in seen:
            continue
        if not is_plugin_package(name, description):
            continue
        seen.add(name)
        packages.append(
            {
                "name": name,
                "description": description,
                "installed": package_installed(name),
            }
        )
    return packages


def repo_path(repo_id: str) -> str:
    return os.path.join(SOURCES_DIR, f"pimfx-{repo_id}.list")


def key_path(repo_id: str) -> str:
    return os.path.join(KEYRING_DIR, f"pimfx-{repo_id}.gpg")


def list_repos() -> list[dict]:
    repos = []
    for path in sorted(glob.glob(os.path.join(SOURCES_DIR, "pimfx-*.list"))):
        name = os.path.basename(path)
        repo_id = name[len("pimfx-") : -len(".list")]
        try:
            with open(path, encoding="utf-8") as handle:
                line = handle.read().strip()
        except OSError:
            line = ""
        repos.append({"id": repo_id, "line": line, "path": path})
    return repos


def download_key(repo_id: str, key_url: str, timeout: int) -> str:
    if not valid_https(key_url):
        raise ValueError("the signing key URL must be HTTPS")
    os.makedirs(KEYRING_DIR, exist_ok=True)
    raw_path = key_path(repo_id) + ".src"
    dest = key_path(repo_id)
    request = urllib.request.Request(key_url, headers={"User-Agent": "Pi-MFX-plugin-helper"})
    with urllib.request.urlopen(request, timeout=min(timeout, 30)) as response:
        data = response.read(256 * 1024)
    with open(raw_path, "wb") as handle:
        handle.write(data)
    if data.lstrip().startswith(b"-----BEGIN"):
        result = run(["gpg", "--dearmor", "-o", dest, raw_path], timeout=20)
        os.remove(raw_path)
        if result.returncode != 0:
            raise ValueError(result.stderr.strip() or "could not dearmor that signing key")
        return dest
    os.replace(raw_path, dest)
    return dest


def power_pi(action: str) -> dict:
    """Reboot or power off through logind, then systemctl if that fails."""
    if action == "reboot":
        method = "Reboot"
        unit = "reboot"
        message = "Rebooting…"
    elif action == "poweroff":
        method = "PowerOff"
        unit = "poweroff"
        message = "Shutting down…"
    else:
        return {"ok": False, "error": "unknown power action"}

    result = run(
        [
            "busctl",
            "call",
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
            method,
            "b",
            "false",
        ],
        timeout=8,
    )
    if result.returncode != 0:
        fallback = run(["systemctl", unit, "--no-block"], timeout=8)
        if fallback.returncode != 0:
            detail = (
                (result.stderr or "")
                or (fallback.stderr or "")
                or (result.stdout or "")
                or (fallback.stdout or "")
            ).strip()
            return {"ok": False, "error": detail or f"could not {action} this Pi"}
    return {"ok": True, "action": action, "message": message}


def read_json_file(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_json_atomic(path: str, value: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(value, handle, separators=(",", ":"))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def get_json(url: str, timeout: int = 30) -> dict:
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json, application/json",
        "User-Agent": "Pi-MFX-update-checker",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read(2 * 1024 * 1024)
    value = json.loads(data.decode("utf-8"))
    return value if isinstance(value, dict) else {}


def apt_policy(package: str) -> tuple[str, str]:
    result = run(["apt-cache", "policy", package], timeout=20)
    if result.returncode != 0:
        return "", ""
    installed = ""
    candidate = ""
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("Installed:"):
            installed = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Candidate:"):
            candidate = stripped.split(":", 1)[1].strip()
    return installed, candidate


def version_is_newer(installed: str, candidate: str) -> bool:
    if not installed or not candidate or candidate == "(none)":
        return False
    result = run(["dpkg", "--compare-versions", installed, "lt", candidate], timeout=10)
    return result.returncode == 0


def installed_lv2_apt_packages() -> list[str]:
    result = run([
        "dpkg-query", "-S",
        "/usr/lib/lv2/*",
        "/usr/lib/aarch64-linux-gnu/lv2/*",
        "/usr/local/lib/lv2/*",
    ], timeout=45)
    packages: set[str] = set()
    for line in result.stdout.splitlines():
        owner = line.split(": ", 1)[0]
        for raw in owner.split(","):
            name = raw.strip().split(":", 1)[0]
            if PACKAGE_RE.match(name) and package_installed(name):
                packages.add(name)
    # Packages installed through the Pi-MFX curated list remain discoverable
    # even when dpkg-query does not expand a distro-specific LV2 path.
    for name in SUGGESTED:
        if package_installed(name):
            files = run(["dpkg-query", "-L", name], timeout=15)
            if any(".lv2/" in line or line.endswith(".lv2") for line in files.stdout.splitlines()):
                packages.add(name)
    return sorted(packages)


def apt_lv2_update_items() -> list[dict]:
    items = []
    for name in installed_lv2_apt_packages():
        installed, candidate = apt_policy(name)
        update_available = version_is_newer(installed, candidate)
        items.append({
            "source": "apt",
            "id": name,
            "title": name,
            "installedVersion": installed,
            "latestVersion": candidate,
            "updateAvailable": update_available,
        })
    return items


def choose_patchstorage_arm64_file(patch: dict) -> dict:
    files = patch.get("files")
    if not isinstance(files, list):
        return {}
    for item in files:
        if not isinstance(item, dict):
            continue
        target = item.get("target")
        slug = target.get("slug") if isinstance(target, dict) else ""
        if str(slug).lower() == "rpi-aarch64":
            return item
    return {}


def bundle_identity(bundle: dict) -> str:
    for key in ("fileId", "assetId", "releaseTag", "fileModified", "filename"):
        value = bundle.get(key)
        if value not in (None, "", 0):
            return str(value)
    return ""


def patchstorage_update_items(registry: dict) -> list[dict]:
    items = []
    bundles = registry.get("bundles")
    if not isinstance(bundles, list):
        return items
    for bundle in bundles:
        if not isinstance(bundle, dict) or bundle.get("source") != "patchstorage":
            continue
        patch_id = int(bundle.get("patchId") or 0)
        if patch_id <= 0:
            continue
        item = {
            "source": "patchstorage",
            "id": patch_id,
            "title": str(bundle.get("title") or f"PatchStorage {patch_id}"),
            "installedVersion": bundle_identity(bundle),
            "latestVersion": "",
            "updateAvailable": False,
        }
        try:
            patch = get_json(PATCHSTORAGE_PATCH_URL.format(patch_id=patch_id), timeout=30)
            latest = choose_patchstorage_arm64_file(patch)
            latest_identity = str(
                latest.get("id")
                or latest.get("updated_at")
                or latest.get("modified")
                or latest.get("filename")
                or ""
            )
            item["latestVersion"] = latest_identity
            if not item["installedVersion"]:
                item["updateAvailable"] = bool(latest_identity)
                item["versionUnknown"] = True
            else:
                item["updateAvailable"] = bool(latest_identity and latest_identity != item["installedVersion"])
        except Exception as exc:  # noqa: BLE001 - keep checking the remaining plugins
            item["error"] = str(exc)
        items.append(item)
    return items


def pick_pipedal_arm64_asset(release: dict) -> dict:
    assets = release.get("assets")
    if not isinstance(assets, list):
        return {}
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "").lower()
        if name.endswith("_arm64.deb") or name.endswith("_aarch64.deb"):
            return asset
    return {}


def toob_update_items(registry: dict) -> list[dict]:
    bundles = registry.get("bundles")
    if not isinstance(bundles, list):
        return []
    installed = next((item for item in bundles if isinstance(item, dict)
                      and item.get("source") == "pipedal-release"), None)
    if not installed:
        return []
    item = {
        "source": "pipedal-bundle",
        "id": "toobamp",
        "title": "ToobAmp",
        "provider": "pipedal-bundle",
        "installedVersion": bundle_identity(installed),
        "latestVersion": "",
        "updateAvailable": False,
    }
    try:
        release = get_json(PIPEDAL_LATEST_RELEASE_URL, timeout=30)
        asset = pick_pipedal_arm64_asset(release)
        latest_identity = str(asset.get("id") or release.get("tag_name") or asset.get("name") or "")
        item["latestVersion"] = latest_identity
        item["releaseTag"] = str(release.get("tag_name") or "")
        if not item["installedVersion"]:
            item["updateAvailable"] = bool(latest_identity)
            item["versionUnknown"] = True
        else:
            item["updateAvailable"] = bool(latest_identity and latest_identity != item["installedVersion"])
    except Exception as exc:  # noqa: BLE001
        item["error"] = str(exc)
    return [item]


def read_lv2_update_status() -> dict:
    status = read_json_file(LV2_UPDATE_STATUS_PATH)
    with LV2_CHECK_LOCK:
        status["checking"] = _lv2_check_running
    status.setdefault("items", [])
    status.setdefault("updateCount", 0)
    status["ok"] = True
    return status


def collect_lv2_update_status() -> dict:
    errors = []
    apt_refresh = apt_get(["update", "-qq"], timeout=180)
    if apt_refresh.returncode != 0:
        errors.append((apt_refresh.stderr or apt_refresh.stdout).strip() or "apt metadata refresh failed")
    registry = read_json_file(os.path.join(DATA_ROOT, "plugins.json"))
    items = apt_lv2_update_items()
    items.extend(patchstorage_update_items(registry))
    items.extend(toob_update_items(registry))
    payload = {
        "ok": True,
        "checkOk": not errors,
        "checkedAt": int(time.time()),
        "checking": False,
        "items": items,
        "updateCount": sum(1 for item in items if item.get("updateAvailable")),
    }
    if errors:
        payload["error"] = "\n".join(errors)
    write_json_atomic(LV2_UPDATE_STATUS_PATH, payload)
    return payload


def start_lv2_update_check(force: bool = False) -> dict:
    global _lv2_check_running
    current = read_json_file(LV2_UPDATE_STATUS_PATH)
    checked_at = int(current.get("checkedAt") or 0)
    fresh = checked_at > 0 and time.time() - checked_at < LV2_CHECK_TTL_SECONDS
    with LV2_CHECK_LOCK:
        already_running = _lv2_check_running
        if not already_running and not (fresh and not force):
            _lv2_check_running = True
    if already_running or (fresh and not force):
        current["checking"] = already_running
        current.setdefault("items", [])
        current.setdefault("updateCount", 0)
        current["ok"] = True
        return current

    def work() -> None:
        global _lv2_check_running
        try:
            while fetch_in_progress() or install_in_progress():
                time.sleep(0.25)
            with HEAVY_LOCK:
                collect_lv2_update_status()
        except Exception as exc:  # noqa: BLE001
            write_json_atomic(LV2_UPDATE_STATUS_PATH, {
                "ok": True,
                "checkOk": False,
                "checkedAt": int(time.time()),
                "checking": False,
                "items": [],
                "updateCount": 0,
                "error": str(exc),
            })
        finally:
            with LV2_CHECK_LOCK:
                _lv2_check_running = False

    threading.Thread(target=work, daemon=True, name="pimfx-lv2-update-check").start()
    current["checking"] = True
    current.setdefault("items", [])
    current.setdefault("updateCount", 0)
    current["ok"] = True
    return current


def install_apt_lv2_updates(timeout: int) -> dict:
    status = collect_lv2_update_status()
    if not status.get("checkOk", True):
        return {"ok": False, "error": str(status.get("error") or "could not refresh apt metadata")}
    packages = [
        str(item.get("id") or "")
        for item in status.get("items", [])
        if item.get("source") == "apt" and item.get("updateAvailable")
    ]
    if not packages:
        return {"ok": True, "packages": [], "message": "Apt LV2 plugins are already up to date."}
    if any(not PACKAGE_RE.match(name) for name in packages):
        return {"ok": False, "error": "the derived LV2 package list was invalid"}
    result = apt_get(["install", "-y", "--only-upgrade", "--no-install-recommends", *packages], timeout=timeout)
    if result.returncode != 0:
        return {"ok": False, "error": (result.stderr or result.stdout).strip() or "LV2 package update failed"}
    return {"ok": True, "packages": packages, "message": "Updated apt LV2 plugins."}


def handle(request: dict) -> dict:
    op = request.get("op") or ""
    timeout = int(request.get("timeout") or 60)
    max_timeout = 1800 if op == "update-install" else (900 if op == "lv2-update-install-apt" else 300)
    timeout = max(10, min(timeout, max_timeout))

    if op == "ping":
        return {"ok": True, "version": 1}

    if op == "apt-search":
        query = str(request.get("query") or "").strip()
        args = ["apt-cache", "search"]
        args.append(query if query else "lv2")
        result = run(args, timeout=timeout)
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip() or "apt-cache search failed"}
        packages = parse_search_lines(result.stdout)
        if query:
            extra = run(["apt-cache", "search", "lv2"], timeout=timeout)
            if extra.returncode == 0:
                existing = {item["name"] for item in packages}
                for item in parse_search_lines(extra.stdout):
                    blob = f"{item['name']} {item['description']}".lower()
                    if query.lower() in blob and item["name"] not in existing:
                        packages.append(item)
        packages.sort(key=lambda item: item["name"])
        return {"ok": True, "packages": packages[:80]}

    if op == "apt-list":
        packages = []
        # Query dpkg once. The old implementation started dpkg-query once for
        # every suggested package and then repeated the work after apt-cache,
        # which could stall the engine's web/control loop for several seconds.
        result = run(
            ["dpkg-query", "-W", "-f=${Package}\\t${Status}\\t${binary:Summary}\\n"],
            timeout=timeout,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                fields = line.split("\t", 2)
                if len(fields) < 2:
                    continue
                name = fields[0].strip()
                if name not in SUGGESTED or fields[1].strip() != "install ok installed":
                    continue
                packages.append(
                    {
                        "name": name,
                        "description": fields[2].strip() if len(fields) > 2 else "",
                        "installed": True,
                    }
                )
        packages.sort(key=lambda item: item["name"])
        return {"ok": True, "packages": packages}

    if op == "package-status":
        name = str(request.get("package") or "")
        if not PACKAGE_RE.match(name):
            return {"ok": False, "error": "that is not a valid package name"}
        return {"ok": True, "package": name, "installed": package_installed(name)}

    if op == "deb-install":
        path = str(request.get("path") or "")
        allowed, message = allow_deb_path(path)
        if not allowed:
            return {"ok": False, "error": message}
        path = os.path.realpath(path)
        info = run(["dpkg-deb", "-f", path, "Package"], timeout=10)
        if info.returncode != 0:
            return {"ok": False, "error": info.stderr.strip() or "could not read that .deb"}
        package = info.stdout.strip()
        if package not in DEB_PACKAGES:
            return {"ok": False, "error": f"{package} is not a recommended Pi-MFX plugin pack"}
        arch = run(["dpkg-deb", "-f", path, "Architecture"], timeout=10)
        architecture = arch.stdout.strip()
        if architecture not in {"arm64", "all"}:
            return {"ok": False, "error": "that package is not an arm64 build"}
        directory, filename = os.path.split(path)
        update = apt_get(["update"], timeout=min(timeout, 90))
        # ToobAmp: apt-get install ./package.deb so dependencies are resolved.
        result = apt_get(["install", "-y", f"./{filename}"], timeout=timeout, cwd=directory)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip() or "apt-get install failed"
            if update.returncode != 0:
                detail = ((update.stderr or update.stdout).strip() + "\n" + detail).strip()
            return {"ok": False, "error": detail}
        return {"ok": True, "package": package, "installed": True}

    if op == "apt-install":
        name = str(request.get("package") or "")
        allowed, message = allow_package(name)
        if not allowed:
            return {"ok": False, "error": message}
        update = apt_get(["update"], timeout=min(timeout, 90))
        result = apt_get(["install", "-y", "--no-install-recommends", name], timeout=timeout)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip() or "apt-get install failed"
            if update.returncode != 0:
                detail = ((update.stderr or update.stdout).strip() + "\n" + detail).strip()
            return {"ok": False, "error": detail}
        return {"ok": True, "package": name, "installed": True}

    if op == "apt-remove":
        name = str(request.get("package") or "")
        allowed, message = allow_package(name)
        if not allowed:
            return {"ok": False, "error": message}
        result = apt_get(["remove", "-y", name], timeout=timeout)
        if result.returncode != 0:
            return {"ok": False, "error": (result.stderr or result.stdout).strip() or "apt-get remove failed"}
        return {"ok": True, "package": name, "installed": False}

    if op == "apt-update":
        result = apt_get(["update"], timeout=timeout)
        if result.returncode != 0:
            return {"ok": False, "error": (result.stderr or result.stdout).strip() or "apt-get update failed"}
        return {"ok": True}

    if op == "lv2-update-status":
        if bool(request.get("refresh")):
            return start_lv2_update_check(force=bool(request.get("force")))
        status = read_lv2_update_status()
        checked_at = int(status.get("checkedAt") or 0)
        if checked_at <= 0 or time.time() - checked_at >= LV2_CHECK_TTL_SECONDS:
            return start_lv2_update_check(force=False)
        return status

    if op == "lv2-update-install-apt":
        return install_apt_lv2_updates(timeout)

    if op == "repo-list":
        return {"ok": True, "repos": list_repos()}

    if op == "repo-add":
        repo_id = str(request.get("id") or "").strip()
        uri = str(request.get("uri") or "").strip().rstrip("/")
        suite = str(request.get("suite") or "").strip()
        components = str(request.get("components") or "main").strip()
        key_url = str(request.get("keyUrl") or "").strip()
        if not REPO_ID_RE.match(repo_id):
            return {"ok": False, "error": "repo id must be lowercase letters, digits, and dashes"}
        if not valid_https(uri):
            return {"ok": False, "error": "the repo URL must be HTTPS"}
        if not SUITE_RE.match(suite):
            return {"ok": False, "error": "that suite name is not allowed"}
        parts = components.split()
        if not parts or any(not COMPONENT_RE.match(part) for part in parts):
            return {"ok": False, "error": "that component list is not allowed"}
        options = "arch=arm64"
        if key_url:
            try:
                key = download_key(repo_id, key_url, timeout)
            except Exception as exc:  # noqa: BLE001 — return the reason to the UI
                return {"ok": False, "error": str(exc)}
            options += f" signed-by={key}"
        else:
            return {"ok": False, "error": "a signing key URL is required"}
        line = f"deb [{options}] {uri} {suite} {' '.join(parts)}\n"
        path = repo_path(repo_id)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(line)
        update = apt_get(["update"], timeout=timeout)
        if update.returncode != 0:
            return {
                "ok": False,
                "error": (update.stderr or update.stdout).strip() or "apt-get update failed after adding the repo",
            }
        return {"ok": True, "repos": list_repos()}

    if op == "repo-remove":
        repo_id = str(request.get("id") or "").strip()
        if not REPO_ID_RE.match(repo_id):
            return {"ok": False, "error": "that repo id is not allowed"}
        path = repo_path(repo_id)
        key = key_path(repo_id)
        if os.path.exists(path):
            os.remove(path)
        if os.path.exists(key):
            os.remove(key)
        apt_get(["update"], timeout=timeout)
        return {"ok": True, "repos": list_repos()}

    if op in {"hotspot-status", "hotspot-apply", "wifi-scan", "wifi-connect", "wifi-disconnect"}:
        if not os.path.isfile(HOTSPOT_SCRIPT):
            return {"ok": False, "error": "hotspot support is not installed"}
        action = {
            "hotspot-status": "status",
            "hotspot-apply": "apply",
            "wifi-scan": "wifi-scan",
            "wifi-connect": "wifi-connect",
            "wifi-disconnect": "wifi-disconnect",
        }[op]
        cmd = ["/usr/bin/python3", HOTSPOT_SCRIPT, action]
        if op == "hotspot-apply":
            cmd.append("--nowait")
        if op == "wifi-connect":
            ssid = str(request.get("ssid") or "")
            password = str(request.get("password") or "")
            if not re.match(r"^[\x20-\x7e]{1,32}$", ssid):
                return {"ok": False, "error": "the network name must be 1 to 32 printable characters"}
            if password and not re.match(r"^[\x20-\x7e]{8,63}$", password):
                return {"ok": False, "error": "the Wi-Fi password must be 8 to 63 printable characters"}
            result = run(
                cmd,
                timeout=timeout,
                input_text=json.dumps({"ssid": ssid, "password": password}),
            )
            raw = (result.stdout or "").strip()
            if not raw:
                return {
                    "ok": False,
                    "error": (result.stderr or "").strip() or "the hotspot helper returned no status",
                }
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                return {"ok": False, "error": "the hotspot helper returned invalid JSON"}
            if not isinstance(payload, dict):
                return {"ok": False, "error": "the hotspot helper returned invalid JSON"}
            payload.setdefault("ok", True)
            if payload.get("error"):
                payload["ok"] = False
            return payload
        result = run(cmd, timeout=timeout)
        raw = (result.stdout or "").strip()
        if not raw:
            return {
                "ok": False,
                "error": (result.stderr or "").strip() or "the hotspot helper returned no status",
            }
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {"ok": False, "error": "the hotspot helper returned invalid JSON"}
        if not isinstance(payload, dict):
            return {"ok": False, "error": "the hotspot helper returned invalid JSON"}
        payload.setdefault("ok", True)
        if op in {"hotspot-apply", "wifi-connect", "wifi-disconnect"} and payload.get("error"):
            payload["ok"] = False
        return payload

    if op == "update-status":
        return git_update_status(
            bool(request.get("fetch")),
            str(request.get("branch") or ""),
            str(request.get("installedCommit") or ""),
        )

    if op == "update-install":
        return git_update_install(
            timeout,
            str(request.get("branch") or ""),
            str(request.get("installedCommit") or ""),
        )

    if op == "reboot":
        return power_pi("reboot")

    if op == "shutdown":
        return power_pi("poweroff")

    return {"ok": False, "error": f"unknown helper op: {op}"}


def read_request(conn: socket.socket) -> dict:
    chunks: list[bytes] = []
    total = 0
    while True:
        piece = conn.recv(4096)
        if not piece:
            break
        chunks.append(piece)
        total += len(piece)
        if total > 64 * 1024:
            raise ValueError("request too large")
    raw = b"".join(chunks).decode("utf-8").strip()
    if not raw:
        raise ValueError("empty request")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("request must be a JSON object")
    return parsed


def serve() -> None:
    directory = os.path.dirname(SOCK_PATH)
    if directory:
        os.makedirs(directory, exist_ok=True)
    try:
        os.unlink(SOCK_PATH)
    except FileNotFoundError:
        pass

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(SOCK_PATH)
    os.chmod(SOCK_PATH, 0o660)
    try:
        pw = pwd.getpwnam(PIMFX_USER)
        os.chown(SOCK_PATH, pw.pw_uid, pw.pw_gid)
    except KeyError:
        pass
    sock.listen(8)

    # The UI requests Git discovery as soon as it connects. Keep this short
    # delayed fallback so headless boots still check for code and LV2 updates.
    # The service-level CPU/I/O priorities keep this work behind realtime audio.
    def boot_update_check() -> None:
        time.sleep(10)
        repo = find_repo()
        if repo_is_clone(repo):
            start_origin_fetch(repo)
        start_lv2_update_check(force=False)

    threading.Thread(target=boot_update_check, daemon=True, name="pimfx-boot-update-check").start()

    while True:
        conn, _unused = sock.accept()
        thread = threading.Thread(target=handle_connection, args=(conn,), daemon=True)
        thread.start()


def handle_connection(conn: socket.socket) -> None:
    try:
        try:
            request = read_request(conn)
            op = str(request.get("op") or "")
            if op in HEAVY_OPS:
                with HEAVY_LOCK:
                    reply(conn, handle(request))
            else:
                reply(conn, handle(request))
        except subprocess.TimeoutExpired:
            fail(conn, "that apt command timed out")
        except Exception as exc:  # noqa: BLE001 — never crash the helper
            fail(conn, str(exc))
    finally:
        conn.close()


def write_update_status(payload: dict) -> None:
    try:
        os.makedirs(os.path.dirname(UPDATE_STATUS_PATH), exist_ok=True)
        with STATUS_LOCK:
            with open(UPDATE_STATUS_PATH, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
    except OSError:
        pass


def write_update_log(text: str, append: bool = False) -> None:
    try:
        os.makedirs(os.path.dirname(UPDATE_LOG_PATH), exist_ok=True)
        with STATUS_LOCK:
            with open(UPDATE_LOG_PATH, "a" if append else "w", encoding="utf-8") as handle:
                handle.write(text)
    except OSError:
        pass


def read_update_log() -> str:
    try:
        with STATUS_LOCK:
            with open(UPDATE_LOG_PATH, encoding="utf-8", errors="replace") as handle:
                return handle.read()
    except OSError:
        return ""


def read_update_status() -> dict:
    data: dict = {}
    try:
        with STATUS_LOCK:
            with open(UPDATE_STATUS_PATH, encoding="utf-8") as handle:
                stored = json.load(handle)
        if isinstance(stored, dict):
            data = stored
    except (OSError, json.JSONDecodeError):
        pass
    log = read_update_log()
    if log:
        data["log"] = log
    return data


def repo_is_clone(path: str) -> bool:
    return bool(path) and os.path.isdir(os.path.join(path, ".git")) and os.path.isfile(os.path.join(path, "scripts", "update.sh"))


def find_repo() -> str:
    candidates = [os.environ.get("PIMFX_REPO", ""), REPO_DIR]
    try:
        with open(SOURCE_REPO_PATH, encoding="utf-8") as handle:
            candidates.append(handle.read().strip())
    except OSError:
        pass
    candidates.extend(sorted(glob.glob("/home/*/Pi-MFX")))
    candidates.append("/opt/Pi-MFX")
    seen: set[str] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        if repo_is_clone(path):
            return path
    return ""


def normalize_branch(value: str) -> str:
    name = (value or "").strip()
    if name == "master":
        return "main"
    if name in ("main", "dev"):
        return name
    return ""


def git_in_repo(args: list[str], timeout: int = 30, repo: str = "") -> subprocess.CompletedProcess[str]:
    root = repo or find_repo()
    if not repo_is_clone(root):
        raise ValueError("Pi-MFX source clone is not configured")
    owner = pwd.getpwuid(os.stat(root).st_uid)
    if owner.pw_uid != 0:
        command = [
            "runuser", "-u", owner.pw_name, "--", "env",
            f"HOME={owner.pw_dir}", "GIT_TERMINAL_PROMPT=0",
            "git", "-C", root, *args,
        ]
    else:
        command = ["git", "-c", f"safe.directory={root}", "-C", root, *args]
    return run(command, timeout=timeout)


def git_error(result: subprocess.CompletedProcess[str], fallback: str) -> str:
    return ((result.stderr or "") or (result.stdout or "")).strip() or fallback


def ensure_update_origin(repo: str) -> None:
    result = git_in_repo(["remote", "get-url", "origin"], repo=repo)
    if result.returncode != 0:
        added = git_in_repo(["remote", "add", "origin", PUBLIC_REPO_URL], repo=repo)
        if added.returncode != 0:
            raise ValueError(git_error(added, "could not configure the Pi-MFX GitHub remote"))
    # Preserve an existing authenticated SSH or HTTPS remote. Rewriting it can
    # break private/fork deployments and is unnecessary for update discovery.


def install_in_progress() -> bool:
    with INSTALL_LOCK:
        return _install_running


def fetch_in_progress() -> bool:
    with FETCH_LOCK:
        return _fetch_running


def last_fetch_error() -> str:
    with FETCH_LOCK:
        return _fetch_error


def start_origin_fetch(repo: str) -> None:
    global _fetch_error, _fetch_running
    with FETCH_LOCK:
        if _fetch_running or install_in_progress():
            return
        _fetch_running = True
        _fetch_error = ""

    def work() -> None:
        global _fetch_error, _fetch_running
        error = ""
        try:
            ensure_update_origin(repo)
            result = git_in_repo([
                "fetch", "--prune", "origin",
                "+refs/heads/main:refs/remotes/origin/main",
                "+refs/heads/dev:refs/remotes/origin/dev",
            ], timeout=60, repo=repo)
            if result.returncode != 0:
                error = git_error(result, "could not fetch Pi-MFX from GitHub")
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
        finally:
            with FETCH_LOCK:
                _fetch_error = error
                _fetch_running = False

    threading.Thread(target=work, daemon=True, name="pimfx-git-fetch").start()


def git_refs(repo: str, branch_wanted: str = "", deployed_commit: str = "") -> dict:
    current_result = git_in_repo(["rev-parse", "--abbrev-ref", "HEAD"], repo=repo)
    installed_result = git_in_repo(["rev-parse", "--short", "HEAD"], repo=repo)
    installed_full_result = git_in_repo(["rev-parse", "HEAD"], repo=repo)
    for result in (current_result, installed_result, installed_full_result):
        if result.returncode != 0:
            raise ValueError(git_error(result, "could not read the installed Pi-MFX revision"))
    current = current_result.stdout.strip()
    source_commit = installed_result.stdout.strip()
    deployed_commit = deployed_commit.strip()
    installed = deployed_commit if re.match(r"^[0-9a-fA-F]+(?:-local)?$", deployed_commit) else source_commit
    installed_full = installed_full_result.stdout.strip()
    wanted = normalize_branch(branch_wanted) or normalize_branch(current) or "dev"
    remote = f"origin/{wanted}"
    latest_result = git_in_repo(["rev-parse", "--verify", "--quiet", "--short", remote], repo=repo)
    latest = latest_result.stdout.strip() if latest_result.returncode == 0 else ""
    switching = bool(current and current != wanted)
    return {
        "repo": repo,
        "branch": current,
        "requestedBranch": wanted,
        "installedCommit": installed,
        "installedCommitFull": installed_full,
        "latestCommit": latest,
        "updateAvailable": switching or bool(latest and latest != installed),
        "message": "" if latest else f"origin/{wanted} was not found.",
    }


def git_update_status(fetch: bool, branch_wanted: str = "", deployed_commit: str = "") -> dict:
    stored = read_update_status()
    repo = find_repo()
    if not repo_is_clone(repo):
        return {
            "ok": False,
            "error": "Pi-MFX source clone is not configured. Run sudo bash ./scripts/pimfx.sh update --branch dev from the clone.",
            "jobState": stored.get("jobState") or "idle",
            "log": stored.get("log") or "",
            "fetching": False,
        }
    installing = install_in_progress()
    job_state = stored.get("jobState") or "idle"
    if job_state == "installing" and not installing:
        job_state = "idle"
    if fetch and not installing:
        start_origin_fetch(repo)
    payload = {
        "ok": True,
        "jobState": job_state,
        "log": stored.get("log") or "",
        "message": stored.get("message") or "",
        "fetching": fetch_in_progress(),
    }
    try:
        payload.update(git_refs(repo, branch_wanted, deployed_commit))
        payload["jobState"] = job_state
        payload["fetching"] = fetch_in_progress()
        fetch_error = last_fetch_error()
        if fetch_error and not payload["fetching"] and not installing:
            payload["ok"] = False
            payload["error"] = fetch_error
        if job_state != "idle" and stored.get("message"):
            payload["message"] = stored.get("message")
    except Exception as exc:  # noqa: BLE001
        if installing:
            payload["ok"] = True
            payload["error"] = ""
        else:
            payload["ok"] = False
            payload["error"] = str(exc)
    return payload


def git_update_install(timeout: int, branch: str = "", deployed_commit: str = "") -> dict:
    global _install_running
    del timeout  # the job runs in the background; the HTTP thread must not wait
    repo = find_repo()
    if not repo_is_clone(repo):
        return {
            "ok": False,
            "error": "Pi-MFX source clone is not configured. Run sudo bash ./scripts/pimfx.sh update --branch dev from the clone.",
        }
    try:
        ensure_update_origin(repo)
        refs = git_refs(repo, branch, deployed_commit)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    if not refs.get("updateAvailable"):
        wanted = refs.get("requestedBranch") or normalize_branch(branch) or "dev"
        commit = refs.get("installedCommit") or "the latest commit"
        return {
            **refs,
            "ok": True,
            "jobState": "idle",
            "message": f"Pi-MFX is already up to date on {wanted} ({commit}).",
        }
    with INSTALL_LOCK:
        if _install_running:
            stored = read_update_status()
            stored["ok"] = True
            stored["jobState"] = stored.get("jobState") or "installing"
            stored["message"] = stored.get("message") or "Update already running"
            return stored
        _install_running = True
    write_update_log("Starting update...\n")
    write_update_status({"ok": True, "jobState": "installing", "message": "Updating"})
    script = os.path.join(repo, "scripts", "update.sh")
    env = os.environ.copy()
    env["DEBIAN_FRONTEND"] = "noninteractive"
    env["PIMFX_UPDATE_FROM_HELPER"] = "1"
    wanted = normalize_branch(branch)
    if wanted:
        env["PIMFX_BRANCH"] = wanted

    try:
        proc = subprocess.Popen(
            ["/bin/bash", script],
            cwd=repo,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
    except OSError as exc:
        with INSTALL_LOCK:
            _install_running = False
        write_update_log(f"Failed to start update: {exc}\n")
        payload = {"ok": False, "jobState": "failed", "error": str(exc), "message": str(exc)}
        write_update_status(payload)
        return payload

    def wait_for_update() -> None:
        global _install_running
        code = 1
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                write_update_log(line, append=True)
            code = proc.wait(timeout=2400)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except OSError:
                proc.kill()
            code = 1
            write_update_log("\nUpdate timed out.\n", append=True)
        except Exception as exc:  # noqa: BLE001
            code = 1
            write_update_log(f"\n{exc}\n", append=True)
        write_update_log(
            "\nUpdate finished successfully.\n" if code == 0 else f"\nUpdate failed (exit code {code}).\n",
            append=True,
        )
        payload = {
            "ok": code == 0,
            "jobState": "idle" if code == 0 else "failed",
            "message": "Update finished" if code == 0 else "update failed",
        }
        if code != 0:
            payload["error"] = payload["message"]
        write_update_status(payload)
        with INSTALL_LOCK:
            _install_running = False

    threading.Thread(target=wait_for_update, daemon=True, name="pimfx-update").start()
    return {
        "ok": True,
        "jobState": "installing",
        "log": "Starting update...\n",
        "message": "Updating",
    }


if __name__ == "__main__":
    serve()
