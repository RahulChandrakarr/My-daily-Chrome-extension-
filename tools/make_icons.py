#!/usr/bin/env python3
"""Draws the extension's icons (an amber check on a deep blue square) as PNGs.

Uses only the Python standard library. Run from anywhere:
    python3 tools/make_icons.py
"""
import os
import struct
import zlib

INK = (0x14, 0x1A, 0x2E)
AMBER = (0xF2, 0xB5, 0x44)
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'icons')

# The check mark, in a 0..1 square.
CHECK = [(0.27, 0.52), (0.43, 0.68), (0.74, 0.34)]
CHECK_WIDTH = 0.13
CORNER = 0.24


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def inside_rounded_square(x, y):
    r = CORNER
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def sample(x, y):
    """Colour and coverage of one sub-pixel."""
    if not inside_rounded_square(x, y):
        return None
    for (ax, ay), (bx, by) in zip(CHECK, CHECK[1:]):
        if segment_distance(x, y, ax, ay, bx, by) <= CHECK_WIDTH / 2:
            return AMBER
    return INK


def render(size):
    n = size * SUPERSAMPLE
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type: none
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    colour = sample((px * SUPERSAMPLE + sx + 0.5) / n, (py * SUPERSAMPLE + sy + 0.5) / n)
                    if colour:
                        r += colour[0]
                        g += colour[1]
                        b += colour[2]
                        a += 1
            count = SUPERSAMPLE * SUPERSAMPLE
            if a:
                row += bytes((r // a, g // a, b // a, round(255 * a / count)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return b''.join(rows)


def write_png(path, size, raw):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', header))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f'icon-{size}.png')
        write_png(path, size, render(size))
        print(f'  wrote {os.path.relpath(path)}')


if __name__ == '__main__':
    main()
