// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Shape tab brushes (PLAN section 15). Each returns the rectangle it touched
// so the renderer only redraws what changed.
import { createRng } from "../core/rng";
import { B, isWaterBiome } from "./biomes";
import { classifyTile, SEA_LEVEL } from "./generate";
import { LAKE, RIVER, type World } from "./types";

export type ShapeTool = "raise" | "lower" | "flatten" | "smooth" | "paint" | "island" | "volcano" | "range";

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number;
}

export interface Stroke {
  tool: ShapeTool;
  x: number;
  y: number;
  radius: number;
  biome?: number; // for paint
  target?: number; // flatten height, taken where the stroke started
  seed?: number; // for stamps
}

const STEP = 0.014;
// Rare biomes the generator can't derive from climate, so edits leave them be.
const MAGIC = new Set([B.infernal, B.haunted, B.grove, B.mushroom, B.wasteland]);

export function strokeTarget(world: World, x: number, y: number): number {
  const i = Math.round(y) * world.w + Math.round(x);
  return world.height[i] ?? SEA_LEVEL;
}

export function applyStroke(world: World, s: Stroke): Rect | null {
  switch (s.tool) {
    case "raise":
      return sculpt(world, s, (h, f) => h + STEP * f);
    case "lower":
      return sculpt(world, s, (h, f) => h - STEP * f);
    case "flatten": {
      const target = s.target ?? strokeTarget(world, s.x, s.y);
      return sculpt(world, s, (h, f) => h + (target - h) * 0.35 * f);
    }
    case "smooth":
      return smooth(world, s);
    case "paint":
      return paint(world, s);
    case "island":
      return stamp(world, s, (d) => SEA_LEVEL + 0.06 * (1 - d * d) + 0.01);
    case "volcano":
      return volcano(world, s);
    case "range":
      return range(world, s);
  }
}

function rectAround(world: World, x: number, y: number, r: number): Rect | null {
  const x0 = Math.max(0, Math.floor(x - r));
  const y0 = Math.max(0, Math.floor(y - r));
  const x1 = Math.min(world.w, Math.ceil(x + r) + 1);
  const y1 = Math.min(world.h, Math.ceil(y + r) + 1);
  return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null;
}

// Calls fn for every tile in the brush with a soft falloff in (0, 1].
function eachInBrush(world: World, s: Stroke, fn: (i: number, falloff: number) => void): Rect | null {
  const r = Math.max(0.5, s.radius);
  const rect = rectAround(world, s.x, s.y, r);
  if (!rect) return null;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const d = Math.hypot(x - s.x, y - s.y) / (r + 0.5);
      if (d < 1) fn(y * world.w + x, 1 - d * d);
    }
  }
  return rect;
}

function sculpt(world: World, s: Stroke, change: (h: number, falloff: number) => number): Rect | null {
  const rect = eachInBrush(world, s, (i, f) => {
    world.height[i] = clampHeight(change(world.height[i]!, f));
  });
  return rect && reclassify(world, rect);
}

function smooth(world: World, s: Stroke): Rect | null {
  const { w, h, height } = world;
  const before = new Map<number, number>();
  const rect = eachInBrush(world, s, (i, f) => {
    const x = i % w;
    const y = (i / w) | 0;
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        sum += height[ny * w + nx]!;
        n++;
      }
    }
    before.set(i, height[i]! + (sum / n - height[i]!) * 0.5 * f);
  });
  before.forEach((v, i) => (height[i] = v));
  return rect && reclassify(world, rect);
}

function paint(world: World, s: Stroke): Rect | null {
  const biome = s.biome ?? B.grassland;
  const water = isWaterBiome(biome);
  return eachInBrush(world, s, (i) => {
    const h = world.height[i]!;
    // Painting sea onto land sinks it; painting land onto sea lifts it.
    if (water && h >= SEA_LEVEL) world.height[i] = SEA_LEVEL - (biome === B.coral ? 0.02 : 0.08);
    if (!water && h < SEA_LEVEL) world.height[i] = SEA_LEVEL + 0.01;
    if (water) world.flags[i] = 0;
    world.biome[i] = biome;
  });
}

function stamp(world: World, s: Stroke, shape: (d: number) => number, r = s.radius * 2.5 + 3): Rect | null {
  const rect = rectAround(world, s.x, s.y, r);
  if (!rect) return null;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const d = Math.hypot(x - s.x, y - s.y) / r;
      if (d >= 1) continue;
      const i = y * world.w + x;
      world.height[i] = clampHeight(Math.max(world.height[i]!, shape(d)));
    }
  }
  return reclassify(world, rect);
}

function volcano(world: World, s: Stroke): Rect | null {
  const r = s.radius * 2 + 4;
  const rect = stamp(world, s, (d) => SEA_LEVEL + 0.42 * (1 - d) - (d < 0.18 ? 0.12 * (1 - d / 0.18) : 0), r);
  if (!rect) return null;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      if (Math.hypot(x - s.x, y - s.y) < r * 0.75) world.biome[y * world.w + x] = B.infernal;
    }
  }
  return rect;
}

function range(world: World, s: Stroke): Rect | null {
  const rng = createRng(s.seed ?? 1);
  const angle = rng.next() * Math.PI;
  const length = s.radius * 5 + 8;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const reach = length / 2 + s.radius + 3;
  const rect = rectAround(world, s.x, s.y, reach);
  if (!rect) return null;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const dx = x - s.x;
      const dy = y - s.y;
      const along = (dx * ax + dy * ay) / (length / 2);
      const across = Math.abs(-dx * ay + dy * ax) / (s.radius + 2);
      const d = Math.max(Math.abs(along), across);
      if (d >= 1) continue;
      const i = y * world.w + x;
      const ridge = SEA_LEVEL + 0.36 * (1 - across) * (1 - along * along) + rng.next() * 0.02;
      world.height[i] = clampHeight(Math.max(world.height[i]!, ridge));
    }
  }
  return reclassify(world, rect);
}

// Recomputes biomes after a height change. Coasts look two tiles out, so the
// rectangle grows by two.
export function reclassify(world: World, r: Rect): Rect {
  const grown = {
    x0: Math.max(0, r.x0 - 2),
    y0: Math.max(0, r.y0 - 2),
    x1: Math.min(world.w, r.x1 + 2),
    y1: Math.min(world.h, r.y1 + 2),
  };
  for (let y = grown.y0; y < grown.y1; y++) {
    for (let x = grown.x0; x < grown.x1; x++) {
      const i = y * world.w + x;
      if (world.height[i]! < SEA_LEVEL) world.flags[i]! &= ~(RIVER | LAKE);
      const keep = MAGIC.has(world.biome[i]!) && world.height[i]! >= SEA_LEVEL;
      if (!keep) world.biome[i] = classifyTile(world, i);
    }
  }
  return grown;
}

function clampHeight(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
