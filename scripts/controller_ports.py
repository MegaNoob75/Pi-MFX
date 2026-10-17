#!/usr/bin/env python3
"""Read-only discovery for first-time controller installation, local or over SSH."""
import json
import re


def discover(ports):
    devices = []
    for port in ports:
        if not re.fullmatch(r"/dev/tty(?:ACM|USB)\d+", port.device):
            continue
        # Espressif ROM USB Serial/JTAG. This also exists on other ESP chips;
        # the uploader must still positively check ESP32-S3 before writing.
        native = port.vid == 0x303A and port.pid == 0x1001
        devices.append({"device": port.device, "description": port.description,
                        "serial": port.serial_number or "", "native": native})
    devices.sort(key=lambda item: item["device"])
    matches = [item for item in devices if item["native"]]
    return {"ports": devices, "suggested": matches[0]["device"] if len(matches) == 1 else ""}


if __name__ == "__main__":
    from serial.tools.list_ports import comports
    print(json.dumps(discover(comports())))
