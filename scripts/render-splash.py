#!/usr/bin/env python3
"""Render a PI-MFX splash PNG with no extra packages.

Used only when branding/pimfx-splash.png is missing and SVG conversion is
unavailable. The shipped PNG is the artwork shown on the Pi.
"""
from __future__ import annotations

import struct
import sys
import zlib

WIDTH, HEIGHT = 1920, 1080
CYAN = (34, 211, 238, 255)
WHITE = (255, 255, 255, 255)
PURPLE = (167, 112, 228, 255)
BLACK = (0, 0, 0, 255)

# 5x7 capitals for PI-MFX.
GLYPHS = {
    "P": ["11110", "10001", "11110", "10000", "10000", "10000", "10000"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "M": ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    "F": ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
    "X": ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
}


def png_rgba(pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    rows = []
    for row in pixels:
        raw = bytearray(b"\x00")
        for red, green, blue, alpha in row:
            raw.extend((red, green, blue, alpha))
        rows.append(bytes(raw))
    compressed = zlib.compress(b"".join(rows), 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def plot(pixels: list[list[tuple[int, int, int, int]]], x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        pixels[y][x] = color


def draw_glyph(
    pixels: list[list[tuple[int, int, int, int]]],
    ch: str,
    origin_x: int,
    origin_y: int,
    scale: int,
    color: tuple[int, int, int, int],
) -> None:
    rows = GLYPHS[ch]
    for row_index, row in enumerate(rows):
        for col_index, bit in enumerate(row):
            if bit != "1":
                continue
            for dy in range(scale):
                for dx in range(scale):
                    plot(pixels, origin_x + col_index * scale + dx, origin_y + row_index * scale + dy, color)


def main() -> int:
    dest = sys.argv[1] if len(sys.argv) > 1 else "pimfx-splash.png"
    pixels = [[BLACK for _ in range(WIDTH)] for _ in range(HEIGHT)]
    text = "PI-MFX"
    scale = 28
    gap = scale
    glyph_w = 5 * scale
    total = len(text) * glyph_w + (len(text) - 1) * gap
    start_x = (WIDTH - total) // 2
    start_y = (HEIGHT - 7 * scale) // 2 + 40
    for index, ch in enumerate(text):
        color = WHITE if index < 3 else CYAN
        draw_glyph(pixels, ch, start_x + index * (glyph_w + gap), start_y, scale, color)
    wave_y = start_y - 90
    for x in range(WIDTH // 2 - 420, WIDTH // 2 + 420):
        phase = (x - WIDTH // 2) / 70.0
        y = int(wave_y + 18 * (1.6 * abs(phase) ** 1.4) * (0.35 + 0.65 * (1 if int(x / 18) % 2 == 0 else -0.2)))
        plot(pixels, x, y, CYAN if abs(x - WIDTH // 2) < 80 else PURPLE)
        plot(pixels, x, y + 1, CYAN if abs(x - WIDTH // 2) < 80 else PURPLE)
    with open(dest, "wb") as handle:
        handle.write(png_rgba(pixels))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
