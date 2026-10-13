# Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
"""Builds the 48 colour master palette (PLAN section 6) and checks data against it.

  python tools/palette.py          merge preview + biome colours into data/palette.json
  python tools/palette.py --check  fail if any data colour is off palette
"""
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "docs" / "preview.html"
BIOMES = ROOT / "data" / "biomes.json"
PALETTE = ROOT / "data" / "palette.json"
SIZE = 48
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")

# Hues the preview relies on: outline, skin, kingdom colours, water, foam, snow.
PINNED = [
    "#2b2233", "#f4f0e8", "#ffffff", "#e0b184", "#7bc24a",
    "#e04040", "#3b6fd4", "#f2c94c", "#b06be0",
    "#2a5db0", "#3b78d8", "#5cc8e6", "#f0d9a0", "#d9453d", "#f08a2c",
]


def to_oklab(hex_colour):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(int(hex_colour[i:i + 2], 16)) for i in (1, 3, 5))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717530 * m - 0.8086757660 * s,
    )


def distance(a, b):
    return math.dist(to_oklab(a), to_oklab(b))


def biome_colours(data):
    for biome in data["biomes"]:
        yield from biome["tones"]
    yield from data["freshWater"]


def merge(counts, pinned):
    """Greedy agglomerative merge: fold the least used colour into its nearest
    neighbour until SIZE remain. Pinned colours never fold into anything."""
    keep = dict(counts)
    while len(keep) > SIZE:
        movable = [c for c in keep if c not in pinned]
        if not movable:
            sys.exit(f"palette: {len(keep)} pinned colours, more than {SIZE}")
        best = None
        for c in movable:
            near = min((o for o in keep if o != c), key=lambda o: distance(c, o))
            cost = distance(c, near) * math.sqrt(keep[c])
            if best is None or cost < best[0]:
                best = (cost, c, near)
        _, gone, into = best
        keep[into] += keep.pop(gone)
    return sorted(keep, key=lambda c: to_oklab(c)[0])


def nearest(colour, palette):
    return min(palette, key=lambda p: distance(colour, p))


def build():
    counts = Counter(c.lower() for c in HEX.findall(PREVIEW.read_text(encoding="utf-8")))
    data = json.loads(BIOMES.read_text(encoding="utf-8"))
    pinned = set(PINNED) | {c.lower() for c in biome_colours(data)}
    for c in pinned:
        counts[c] += 1
    palette = merge(counts, pinned)

    for biome in data["biomes"]:
        biome["tones"] = [nearest(c.lower(), palette) for c in biome["tones"]]
    data["freshWater"] = [nearest(c.lower(), palette) for c in data["freshWater"]]
    mapping = {c: nearest(c, palette) for c in sorted(counts)}

    PALETTE.write_text(json.dumps({"colors": palette, "fromPreview": mapping}, indent=2) + "\n", encoding="utf-8")
    BIOMES.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"palette: {len(counts)} colours merged into {len(palette)}")


def check():
    palette = set(json.loads(PALETTE.read_text(encoding="utf-8"))["colors"])
    if len(palette) > SIZE:
        print(f"palette has {len(palette)} colours, the limit is {SIZE}")
        return 1
    data = json.loads(BIOMES.read_text(encoding="utf-8"))
    off = sorted({c for c in biome_colours(data) if c not in palette})
    for c in off:
        print(f"off palette colour in biomes.json: {c}")
    if off:
        return 1
    print(f"palette ok: {len(palette)} colours, all biome tones on palette")
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    build()
