// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// World generator pipeline (PLAN section 7): heightmap, erosion, water,
// climate, biomes, resources. Pure and deterministic: same options, same world.
import config from "../../data/world.json";
import { createRng, ppHash } from "../core/rng";
import { B, isWaterBiome, landBiome, waterBiome } from "./biomes";
import { erode } from "./erosion";
import { waterways } from "./hydrology";
import { fbm, ppNoise } from "./noise";
import { emptyWorld, LAKE, ORES, RIVER, type Layout, type World, type WorldOptions } from "./types";

export const SEA_LEVEL = 0.4;
const G = config.gen;

export type Progress = (stage: string, fraction: number) => void;

export function generateWorld(options: WorldOptions, progress: Progress = () => {}): World {
  const world = emptyWorld(options);
  const rng = createRng(options.seed);

  progress("height", 0);
  heightmap(world, options.seed);
  progress("erosion", 0.25);
  const drops = Math.min(G.erosionMaxDrops, Math.round(world.w * world.h * G.erosionDropsPerTile));
  erode(world.height, world.w, world.h, rng, { drops, steps: G.erosionSteps, strength: G.erosionStrength });
  progress("water", 0.55);
  setSeaLevel(world, options.land / 100);
  progress("climate", 0.65);
  climate(world, options.seed);
  waterways(world.height, world.moisture, world.flags, world.w, world.h, SEA_LEVEL, G.riverFlow * (world.w / 320));
  progress("biomes", 0.8);
  classifyAll(world);
  magicPatches(world, rng);
  progress("resources", 0.92);
  resources(world, options.seed);
  progress("done", 1);
  return world;
}

function layoutMask(layout: Layout, u: number, v: number, warp: number): number {
  // u, v in [-1, 1]; returns a bias added to the noise height
  const r = Math.hypot(u * 0.85, v);
  switch (layout) {
    case "continent":
      return 0.55 - r * 0.9;
    case "pangaea":
      return 0.75 - r * 0.8;
    case "islands":
      return 0.05 - r * 0.35 + warp * 0.4;
    case "archipelago":
      return -0.05 - r * 0.2 + Math.abs(warp) * 0.7;
    case "twin": {
      const left = Math.hypot((u + 0.48) * 1.5, v);
      const right = Math.hypot((u - 0.48) * 1.5, v);
      return 0.5 - Math.min(left, right) * 1.05;
    }
    case "ring":
      return 0.45 - Math.abs(r - 0.6) * 1.9;
    case "chaos":
      return warp * 0.9 - r * 0.25;
  }
}

function heightmap(world: World, seed: number) {
  const { w, h, height } = world;
  const base = fbm(ppNoise(seed), G.octaves);
  const warpX = fbm(ppNoise(seed + 101), 3);
  const warpY = fbm(ppNoise(seed + 202), 3);
  const shape = fbm(ppNoise(seed + 303), 2);
  const layout = world.options.layout;

  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // same scale on both axes so features stay round on wide maps
      const sx = (x * G.noiseScale * 2) / w;
      const sy = (y * G.noiseScale * 2) / w;
      const wx = warpX(sx, sy) * G.warp * 4;
      const wy = warpY(sx, sy) * G.warp * 4;
      const n = base(sx + wx, sy + wy);
      const u = (x / (w - 1)) * 2 - 1;
      const v = (y / (h - 1)) * 2 - 1;
      const value = n + layoutMask(layout, u, v, shape(sx * 0.6, sy * 0.6));
      height[y * w + x] = value;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  const span = hi - lo || 1;
  for (let i = 0; i < height.length; i++) height[i] = (height[i]! - lo) / span;
}

// Remaps heights so the requested share of tiles sits above SEA_LEVEL.
function setSeaLevel(world: World, landShare: number) {
  const { height } = world;
  const sorted = Float32Array.from(height).sort();
  const cut = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - landShare)))]!;
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  for (let i = 0; i < height.length; i++) {
    const v = height[i]!;
    height[i] = v < cut
      ? (SEA_LEVEL * (v - lo)) / (cut - lo || 1)
      : SEA_LEVEL + ((1 - SEA_LEVEL) * (v - cut)) / (hi - cut || 1);
  }
  world.seaLevel = SEA_LEVEL;
}

function climate(world: World, seed: number) {
  const { w, h, height, temperature, moisture, options } = world;
  const tNoise = fbm(ppNoise(seed + 404), 3);
  const mNoise = fbm(ppNoise(seed + 505), 4);
  const tShift = (options.temperature - 50) / 100;
  const mShift = (options.moisture - 50) / 100;

  for (let y = 0; y < h; y++) {
    const lat = 1 - Math.abs(y / (h - 1) - 0.5) * 2;
    let carried = 1;
    let prev = SEA_LEVEL;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const above = Math.max(0, height[i]! - SEA_LEVEL);
      const sx = x * 4 / w;
      const sy = y * 4 / w;
      temperature[i] = clamp01(lat * 0.95 + 0.02 - above * 0.9 + tShift * 0.6 + tNoise(sx, sy) * 0.12);

      // Wind blows west to east: air soaks up water over sea and rains it
      // out on land, mostly where the ground rises (rain shadows).
      if (height[i]! < SEA_LEVEL) {
        carried = Math.min(1, carried + 0.06);
      } else {
        const rise = Math.max(0, height[i]! - prev);
        carried = Math.max(0, carried - 0.004 - rise * 6 * carried);
      }
      prev = Math.max(SEA_LEVEL, height[i]!);
      moisture[i] = mNoise(sx, sy) + carried * 0.5;
    }
  }
  spreadEvenly(moisture, height, mShift);
}

// Ranks land moisture so every world gets the full dry to wet range, then
// applies the player's moisture setting on top.
function spreadEvenly(moisture: Float32Array, height: Float32Array, shift: number) {
  const land: number[] = [];
  for (let i = 0; i < moisture.length; i++) if (height[i]! >= SEA_LEVEL) land.push(i);
  land.sort((a, b) => moisture[a]! - moisture[b]! || a - b);
  land.forEach((i, rank) => {
    moisture[i] = clamp01(rank / land.length + shift * 0.7);
  });
  for (let i = 0; i < moisture.length; i++) if (height[i]! < SEA_LEVEL) moisture[i] = 1;
}

function isCoast(world: World, i: number): boolean {
  const { w, h, height } = world;
  const x = i % w;
  const y = (i / w) | 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (height[ny * w + nx]! < SEA_LEVEL) return true;
    }
  }
  return false;
}

export function classifyTile(world: World, i: number): number {
  const above = world.height[i]! - SEA_LEVEL;
  const temp = world.temperature[i]!;
  if (above < 0) return waterBiome(-above, temp, G.shallowDepth);
  const wet = world.flags[i]! & (RIVER | LAKE) ? Math.min(1, world.moisture[i]! + 0.25) : world.moisture[i]!;
  return landBiome({ height: above, temp, wet, coast: isCoast(world, i) }, G);
}

function classifyAll(world: World) {
  for (let i = 0; i < world.biome.length; i++) world.biome[i] = classifyTile(world, i);
}

function magicPatches(world: World, rng: ReturnType<typeof createRng>) {
  const { w, h, biome } = world;
  const count = Math.round(w * h * G.magicPatchChance * (world.options.magic / 50));
  const [rMin, rMax] = G.magicPatchRadius as [number, number];

  for (let n = 0; n < count; n++) {
    const cx = rng.int(0, w - 1);
    const cy = rng.int(0, h - 1);
    const at = biome[cy * w + cx]!;
    if (isWaterBiome(at) || at === B.snowPeaks) continue;
    const kind = pickMagic(at, world.moisture[cy * w + cx]!, rng.next());
    const r = rng.int(rMin, rMax);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.hypot(x - cx, y - cy) / r + (ppHash(x, y, n) - 0.5) * 0.5;
        const i = y * w + x;
        if (d < 1 && !isWaterBiome(biome[i]!) && biome[i] !== B.snowPeaks) biome[i] = kind;
      }
    }
  }
}

function pickMagic(at: number, wet: number, roll: number): number {
  if (at === B.mountains || at === B.badlands) return roll < 0.7 ? B.infernal : B.haunted;
  if (wet > 0.6 && roll < 0.5) return B.mushroom;
  if (at === B.forest || at === B.grassland) return roll < 0.6 ? B.grove : B.haunted;
  return roll < 0.5 ? B.haunted : B.grove;
}

const ORE = Object.fromEntries(ORES.map((o, i) => [o, i])) as Record<(typeof ORES)[number], number>;

function resources(world: World, seed: number) {
  const { w, h, biome, ore, fertility, flags, moisture } = world;
  const veins = fbm(ppNoise(seed + 606), 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = biome[i]!;
      const roll = ppHash(x, y, seed + 7);
      const vein = veins(x * 0.12, y * 0.12);
      ore[i] = ORE.none;

      if (b === B.mountains || b === B.snowPeaks) {
        if (vein > 0.25) ore[i] = roll < 0.03 ? ORE.mythril : roll < 0.3 ? ORE.iron : roll < 0.5 ? ORE.coal : ORE.stone;
        if (b === B.snowPeaks && vein > 0.4 && roll < 0.02) ore[i] = ORE.adamantine;
      } else if (b === B.hills) {
        if (vein > 0.3) ore[i] = roll < 0.25 ? ORE.copper : roll < 0.45 ? ORE.tin : roll < 0.6 ? ORE.coal : ORE.stone;
      } else if (b === B.badlands && vein > 0.35) {
        ore[i] = ORE.copper;
      } else if (b === B.desert && roll < 0.004) {
        ore[i] = ORE.gold;
      } else if (b === B.infernal && vein > 0.4 && roll < 0.05) {
        ore[i] = ORE.adamantine;
      }

      fertility[i] = fertilityOf(b, moisture[i]!, nearWater(flags, w, h, x, y));
    }
  }
}

function nearWater(flags: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && flags[ny * w + nx]! & (RIVER | LAKE)) return true;
    }
  }
  return false;
}

const BASE_FERTILITY: Partial<Record<number, number>> = {
  [B.grassland]: 0.9, [B.forest]: 0.6, [B.jungle]: 0.6, [B.savanna]: 0.5, [B.swamp]: 0.4,
  [B.hills]: 0.4, [B.taiga]: 0.3, [B.beach]: 0.1, [B.desert]: 0.05, [B.tundra]: 0.1,
  [B.grove]: 0.7, [B.mushroom]: 0.5,
};

function fertilityOf(biome: number, wet: number, river: boolean): number {
  const base = BASE_FERTILITY[biome] ?? 0;
  return Math.round(clamp01(base * (0.7 + wet * 0.3) + (river && base > 0 ? 0.25 : 0)) * 255);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
