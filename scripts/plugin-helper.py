#!/usr/bin/env python3
"""Root helper for Pi-MFX plugin apt, extra-repo, and Wi-Fi hotspot operations.

The audio engine runs as an unprivileged user with NoNewPrivileges, so it
cannot call apt or nmcli. This process listens on a UNIX socket owned by that
user, accepts one JSON command per connection, and replies with one JSON object.

It only installs packages whose names look like Debian packages and that look
like LV2 plugins (name, description, or the suggested set). Repo lines must be
HTTPS. Hotspot and Wi-Fi commands only run the installed hotspot.py helper. It
never runs a shell with user text.
"""
from __future__ import annotations

import glob
import json
import os
import pwd
import re
import socket
import subprocess
import sys
import urllib.request

SOCK_PATH = sys.argv[1] if len(sys.argv) > 1 else "/run/pimfx/plugin-helper.sock"
PIMFX_USER = os.environ.get("PIMFX_USER", "pimfx")
DATA_ROOT = os.environ.get("PIMFX_DATA_ROOT", "/var/lib/pimfx")
PREFIX = os.environ.get("PIMFX_PREFIX", "/usr/local")
HOTSPOT_SCRIPT = os.path.join(PREFIX, "libexec/pimfx/hotspot.py")
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
    lower = f"{name} {description}".lower()
    if name in SUGGESTED:
        return True
    return any(hint in lower for hint in PLUGIN_NAME_HINTS)


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
    if is_plugin_package(name):
        return True, ""
    description = apt_show_description(name)
    if is_plugin_package(name, description):
        return True, ""
    return False, "that package does not look like an LV2 plugin"


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


def handle(request: dict) -> dict:
    op = request.get("op") or ""
    timeout = int(request.get("timeout") or 60)
    timeout = max(10, min(timeout, 300))

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
        for name in sorted(SUGGESTED):
            if package_installed(name):
                packages.append(
                    {
                        "name": name,
                        "description": apt_show_description(name),
                        "installed": True,
                    }
                )
        result = run(["apt-cache", "search", "lv2"], timeout=timeout)
        if result.returncode == 0:
            existing = {item["name"] for item in packages}
            for item in parse_search_lines(result.stdout):
                if item["installed"] and item["name"] not in existing:
                    packages.append(item)
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
        result = apt_get(["install", "-y", "--no-install-recommends", name], timeout=timeout)
        if result.returncode != 0:
            return {"ok": False, "error": (result.stderr or result.stdout).strip() or "apt-get install failed"}
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
            options += " trusted=yes"
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
            cmd.append(ssid)
            if password:
                cmd.append(password)
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
    sock.listen(4)

    while True:
        conn, _unused = sock.accept()
        try:
            try:
                request = read_request(conn)
                reply(conn, handle(request))
            except subprocess.TimeoutExpired:
                fail(conn, "that apt command timed out")
            except Exception as exc:  # noqa: BLE001 — never crash the helper
                fail(conn, str(exc))
        finally:
            conn.close()


if __name__ == "__main__":
    serve()
