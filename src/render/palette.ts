// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import biomes from "../../data/biomes.json";
import palette from "../../data/palette.json";

export const COLORS = palette.colors;

const index = new Map(COLORS.map((c, i) => [c, i]));

export function paletteIndex(hex: string): number {
  const i = index.get(hex.toLowerCase());
  if (i === undefined) throw new Error(`${hex} is not in the master palette`);
  return i;
}

export function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function paletteRGBA(): Uint8Array {
  const out = new Uint8Array(64 * 4);
  COLORS.forEach((c, i) => {
    out.set([...rgb(c), 255], i * 4);
  });
  return out;
}

export const DECO_SHAPES = ["none", "tree", "pine", "palm", "acacia", "cactus", "rock", "crystal", "mushroom", "dead", "reed", "flower", "coral", "lava"];

const DECO_DENSITY: Record<string, number> = {
  tree: 0.75, pine: 0.7, palm: 0.25, acacia: 0.18, cactus: 0.12, rock: 0.12, crystal: 0.3,
  mushroom: 0.45, dead: 0.35, reed: 0.5, flower: 0.6, coral: 0.5, lava: 0.25, none: 0,
};

export const FRESH_WATER = biomes.freshWater.map(paletteIndex);
export const FOAM = paletteIndex("#f4f0e8");
export const ROAD_TONES = ["#b38d55", "#d4a94e", "#8a5a36"].map(paletteIndex);
export const FARM_TONES = ["#8a5a36", "#7bc24a", "#e8c46a"].map(paletteIndex);

// 32 x 2 table: row 0 holds each biome's 4 tones as palette indices, row 1
// its decoration shape and density.
export function biomeTable(): Uint8Array {
  const out = new Uint8Array(32 * 2 * 4);
  biomes.biomes.forEach((b, i) => {
    out.set(b.tones.map(paletteIndex), i * 4);
    out.set([DECO_SHAPES.indexOf(b.deco), Math.round((DECO_DENSITY[b.deco] ?? 0) * 255), b.water ? 1 : 0, 0], (32 + i) * 4);
  });
  return out;
}
