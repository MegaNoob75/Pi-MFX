#!/usr/bin/env python3
"""Publish pimfx.local through Avahi without renaming the Pi.

PiPedal uses pipedal.local the same way: mDNS so a tablet can open the UI
by name. This process watches IPv4 addresses and republishes when they change.
"""
from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time

NAME = os.environ.get("PIMFX_MDNS_NAME", "pimfx.local")
PORT = int(os.environ.get("PIMFX_PORT", "8080"))
INTERVAL = 15


def ipv4_addresses() -> list[str]:
    found: list[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("1.1.1.1", 80))
        ip = probe.getsockname()[0]
        probe.close()
        if ip and not ip.startswith("127.") and ip not in found:
            found.insert(0, ip)
    except OSError:
        pass
    return found


def main() -> int:
    procs: list[subprocess.Popen[bytes]] = []
    current = ""

    def stop(_signum=None, _frame=None) -> None:
        for proc in procs:
            proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    while True:
        ips = ipv4_addresses()
        key = ",".join(ips)
        if key != current:
            for proc in procs:
                proc.terminate()
            procs = []
            if ips:
                procs.append(subprocess.Popen(
                    ["avahi-publish", "-a", "-R", NAME, ips[0]],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ))
                procs.append(subprocess.Popen(
                    ["avahi-publish", "-s", "Pi-MFX", "_http._tcp", str(PORT), "path=/"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ))
            current = key
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
