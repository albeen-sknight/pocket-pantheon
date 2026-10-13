// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { B, isWaterBiome } from "../../src/world/biomes";
import { applyStroke } from "../../src/world/edit";
import { generateWorld, SEA_LEVEL } from "../../src/world/generate";
import { defaultOptions } from "../../src/world/types";

const fresh = () => generateWorld({ ...defaultOptions(4242), size: "small" });

function findTile(w: ReturnType<typeof fresh>, test: (i: number) => boolean): [number, number] {
  for (let y = 10; y < w.h - 10; y++) for (let x = 10; x < w.w - 10; x++) if (test(y * w.w + x)) return [x, y];
  throw new Error("no tile found");
}

describe("shape brushes", () => {
  it("raise lifts the centre and reports the touched area", () => {
    const w = fresh();
    const [x, y] = findTile(w, (i) => w.height[i]! > SEA_LEVEL + 0.05 && w.height[i]! < 0.8);
    const before = w.height[y * w.w + x]!;
    const rect = applyStroke(w, { tool: "raise", x, y, radius: 2 })!;
    expect(w.height[y * w.w + x]).toBeGreaterThan(before);
    expect(rect.x0).toBeLessThanOrEqual(x);
    expect(rect.x1).toBeGreaterThan(x);
  });

  it("lowering land far enough turns it into sea", () => {
    const w = fresh();
    const [x, y] = findTile(w, (i) => w.height[i]! > SEA_LEVEL && w.height[i]! < SEA_LEVEL + 0.02);
    for (let n = 0; n < 20; n++) applyStroke(w, { tool: "lower", x, y, radius: 1 });
    expect(isWaterBiome(w.biome[y * w.w + x]!)).toBe(true);
  });

  it("paint sets the biome and lifts sea tiles to land", () => {
    const w = fresh();
    const [x, y] = findTile(w, (i) => w.height[i]! < SEA_LEVEL);
    applyStroke(w, { tool: "paint", x, y, radius: 0, biome: B.desert });
    const i = y * w.w + x;
    expect(w.biome[i]).toBe(B.desert);
    expect(w.height[i]).toBeGreaterThanOrEqual(SEA_LEVEL);
  });

  it("an island stamp makes land in open sea", () => {
    const w = fresh();
    const [x, y] = findTile(w, (i) => w.height[i]! < SEA_LEVEL - 0.1);
    applyStroke(w, { tool: "island", x, y, radius: 3 });
    expect(w.height[y * w.w + x]).toBeGreaterThan(SEA_LEVEL);
  });

  it("a volcano leaves infernal ground", () => {
    const w = fresh();
    const [x, y] = findTile(w, (i) => w.height[i]! > SEA_LEVEL + 0.05);
    applyStroke(w, { tool: "volcano", x, y, radius: 2 });
    expect(w.biome[(y + 2) * w.w + x]).toBe(B.infernal);
  });

  it("flatten pulls heights toward the target", () => {
    const w = fresh();
    const [x, y] = findTile(w, (i) => w.height[i]! > 0.7);
    for (let n = 0; n < 30; n++) applyStroke(w, { tool: "flatten", x, y, radius: 2, target: 0.5 });
    expect(Math.abs(w.height[y * w.w + x]! - 0.5)).toBeLessThan(0.01);
  });
});
