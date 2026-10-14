// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import world from "../../data/world.json";

export type SizeKey = keyof typeof world.sizes;
export type Layout = "continent" | "islands" | "archipelago" | "pangaea" | "twin" | "ring" | "chaos";

export interface WorldOptions {
  seed: number;
  size: SizeKey;
  layout: Layout;
  land: number; // percent of tiles above sea level
  temperature: number; // 0 to 100, 50 is Earth like
  moisture: number; // 0 to 100
  magic: number; // 0 to 100, odds of rare magic patches
}

// Tile flags
export const RIVER = 1;
export const LAKE = 2;
export const ROAD = 4;
export const FARM = 8;

// Ore types, in rough order of rarity
export const ORES = ["none", "stone", "copper", "tin", "coal", "iron", "gold", "mythril", "adamantine"] as const;
export type Ore = (typeof ORES)[number];

export interface World {
  w: number;
  h: number;
  seaLevel: number;
  options: WorldOptions;
  height: Float32Array; // 0 to 1, water below seaLevel
  biome: Uint8Array;
  flags: Uint8Array;
  ore: Uint8Array;
  fertility: Uint8Array; // 0 to 255
  temperature: Float32Array; // 0 to 1
  moisture: Float32Array; // 0 to 1
}

export const FIELDS = ["height", "biome", "flags", "ore", "fertility", "temperature", "moisture"] as const;
export type Field = (typeof FIELDS)[number];

export function defaultOptions(seed: number): WorldOptions {
  const d = world.defaults;
  return {
    seed,
    size: d.size as SizeKey,
    layout: d.layout as Layout,
    land: d.land,
    temperature: d.temperature,
    moisture: d.moisture,
    magic: d.magic,
  };
}

export function emptyWorld(options: WorldOptions): World {
  const { w, h } = world.sizes[options.size];
  const n = w * h;
  return {
    w,
    h,
    seaLevel: 0.5,
    options,
    height: new Float32Array(n),
    biome: new Uint8Array(n),
    flags: new Uint8Array(n),
    ore: new Uint8Array(n),
    fertility: new Uint8Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
  };
}
