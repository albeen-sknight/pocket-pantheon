// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import data from "../../data/biomes.json";

export const BIOMES = data.biomes;
export type BiomeKey = (typeof BIOMES)[number]["key"];

const index = new Map(BIOMES.map((b, i) => [b.key, i]));

export function biomeId(key: string): number {
  const id = index.get(key);
  if (id === undefined) throw new Error(`unknown biome ${key}`);
  return id;
}

export const B = {
  deepOcean: biomeId("deep_ocean"),
  coral: biomeId("coral"),
  beach: biomeId("beach"),
  grassland: biomeId("grassland"),
  forest: biomeId("forest"),
  jungle: biomeId("jungle"),
  savanna: biomeId("savanna"),
  desert: biomeId("desert"),
  badlands: biomeId("badlands"),
  swamp: biomeId("swamp"),
  taiga: biomeId("taiga"),
  tundra: biomeId("tundra"),
  permafrost: biomeId("permafrost"),
  snowPeaks: biomeId("snow_peaks"),
  mountains: biomeId("mountains"),
  hills: biomeId("hills"),
  infernal: biomeId("infernal"),
  haunted: biomeId("haunted"),
  grove: biomeId("grove"),
  mushroom: biomeId("mushroom"),
  wasteland: biomeId("wasteland"),
};

export function isWaterBiome(id: number): boolean {
  return BIOMES[id]?.water ?? false;
}

export interface Climate {
  height: number; // above sea level, 0 at the coast
  temp: number;
  wet: number;
  coast: boolean;
}

export interface Bands {
  beachHeight: number;
  hillsHeight: number;
  mountainHeight: number;
  snowHeight: number;
}

// The temperature and moisture lookup from PLAN section 7.
export function landBiome(c: Climate, bands: Bands): number {
  if (c.height > bands.snowHeight) return B.snowPeaks;
  if (c.height > bands.mountainHeight) return c.temp < 0.2 ? B.snowPeaks : B.mountains;
  if (c.coast && c.height < bands.beachHeight && c.temp > 0.25) return B.beach;

  if (c.temp < 0.12) return B.permafrost;
  if (c.temp < 0.28) return c.wet > 0.45 ? B.taiga : B.tundra;

  if (c.height > bands.hillsHeight) {
    if (c.temp > 0.68 && c.wet < 0.32) return B.badlands;
    return B.hills;
  }

  if (c.temp > 0.68) {
    if (c.wet > 0.66) return B.jungle;
    if (c.wet > 0.36) return B.savanna;
    return B.desert;
  }
  if (c.wet > 0.78 && c.height < bands.beachHeight * 3) return B.swamp;
  if (c.wet > 0.55) return B.forest;
  if (c.wet < 0.2) return c.temp > 0.5 ? B.desert : B.tundra;
  return B.grassland;
}

export function waterBiome(depth: number, temp: number, shallowDepth: number): number {
  return depth < shallowDepth && temp > 0.62 ? B.coral : B.deepOcean;
}
