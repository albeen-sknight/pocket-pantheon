// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import world from "../../data/world.json";
import { BIOMES } from "../../src/world/biomes";
import { generateWorld, SEA_LEVEL } from "../../src/world/generate";
import { worldHash } from "../../src/world/hash";
import { defaultOptions, FIELDS, type Layout } from "../../src/world/types";

describe("generateWorld", () => {
  it("builds the same world from the same seed", () => {
    const a = generateWorld({ ...defaultOptions(4242), size: "small" });
    const b = generateWorld({ ...defaultOptions(4242), size: "small" });
    expect(worldHash(a)).toBe(worldHash(b));
  });

  it("builds a different world from a different seed", () => {
    const a = generateWorld({ ...defaultOptions(1), size: "small" });
    const b = generateWorld({ ...defaultOptions(2), size: "small" });
    expect(worldHash(a)).not.toBe(worldHash(b));
  });

  it("generates a Large world in under 4 seconds", () => {
    const t = performance.now();
    generateWorld({ ...defaultOptions(77), size: "large" });
    expect(performance.now() - t).toBeLessThan(4000);
  });

  it.each(world.layouts)("%s layout respects the land slider and stays valid", (layout) => {
    for (const land of [25, 60]) {
      const w = generateWorld({ ...defaultOptions(9), size: "small", layout: layout as Layout, land });
      let above = 0;
      for (let i = 0; i < w.height.length; i++) {
        if (w.height[i]! >= SEA_LEVEL) above++;
        expect(Number.isFinite(w.height[i])).toBe(true);
        expect(w.biome[i]).toBeLessThan(BIOMES.length);
      }
      expect(Math.abs(above / w.height.length - land / 100)).toBeLessThan(0.02);
    }
  });

  it("makes rivers and a spread of biomes", () => {
    const w = generateWorld({ ...defaultOptions(4242), size: "medium" });
    const seen = new Set(w.biome);
    expect(seen.size).toBeGreaterThanOrEqual(14);
    expect(w.flags.some((f) => f & 1)).toBe(true);
  });

  it("keeps every field the right length", () => {
    const w = generateWorld({ ...defaultOptions(5), size: "small" });
    for (const f of FIELDS) expect(w[f].length).toBe(w.w * w.h);
  });
});
