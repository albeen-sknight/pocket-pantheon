// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Every creature kind gets one small integer id: the 4 races first, then animals.
import creatures from "../../data/creatures.json";
import { BIOMES } from "../world/biomes";

export type RaceKey = keyof typeof creatures.races;
export type AnimalKey = keyof typeof creatures.animals;
export type SpeciesKey = RaceKey | AnimalKey;

export const RACES = Object.keys(creatures.races) as RaceKey[];
export const ANIMALS = Object.keys(creatures.animals) as AnimalKey[];
export const SPECIES: SpeciesKey[] = [...RACES, ...ANIMALS];
export const RACE_COUNT = RACES.length;

export const STAT_NAMES = creatures.stats;
export const TRAITS = Object.keys(creatures.traits);
export type TraitEffects = Partial<Record<"size" | "speed" | "safety" | "armor" | "intelligence" | "lifespan" | "vitality" | "fertility" | "fire" | "hunger", number>>;
export const TRAIT_EFFECTS: TraitEffects[] = TRAITS.map((k) => (creatures.traits as Record<string, TraitEffects>)[k]!);

export interface Species {
  key: SpeciesKey;
  civ: boolean;
  speed: number;
  hp: number;
  damage: number;
  lifespan: [number, number];
  adult: number;
  elder: number;
  litter: number;
  cap: number; // animals per 100 habitat tiles
  herd: boolean;
  swims: boolean;
  flies: boolean;
  climbs: boolean;
  meat: boolean;
  prey: Set<number>;
  habitat: Set<number>; // biome ids
  stats: [number, number][];
  plantsTrees: boolean;
}

const biomeIndex = new Map(BIOMES.map((b, i) => [b.key, i]));
const biomeSet = (keys: string[]) => new Set(keys.map((k) => biomeIndex.get(k)!).filter((v) => v !== undefined));

function race(key: RaceKey): Species {
  const r = creatures.races[key] as (typeof creatures.races)[RaceKey] & { climbs?: boolean; plantsTrees?: boolean };
  return {
    key,
    civ: true,
    speed: r.speed,
    hp: 40,
    damage: 5,
    lifespan: r.lifespan as [number, number],
    adult: r.adult,
    elder: r.elder,
    litter: 1,
    cap: 0,
    herd: false,
    swims: false,
    flies: false,
    climbs: !!r.climbs,
    meat: false,
    prey: new Set(),
    habitat: biomeSet(r.biomes),
    stats: r.stats as [number, number][],
    plantsTrees: !!r.plantsTrees,
  };
}

function animal(key: AnimalKey): Species {
  const a = creatures.animals[key] as (typeof creatures.animals)[AnimalKey] & { prey?: string[]; herd?: boolean; swims?: boolean; flies?: boolean };
  return {
    key,
    civ: false,
    speed: a.speed,
    hp: a.hp,
    damage: a.damage,
    lifespan: [a.lifespan * 0.8, a.lifespan * 1.2],
    adult: a.adult,
    elder: a.lifespan * 0.8,
    litter: a.litter,
    cap: a.cap,
    herd: !!a.herd,
    swims: !!a.swims,
    flies: !!a.flies,
    climbs: false,
    meat: a.diet === "meat",
    prey: new Set((a.prey ?? []).map((p) => SPECIES.indexOf(p as SpeciesKey))),
    habitat: biomeSet(a.habitat),
    stats: [[5, 10], [5, 10], [1, 3], [5, 10], [1, 3], [1, 3], [5, 10], [5, 10]],
    plantsTrees: false,
  };
}

export const SPECIES_INFO: Species[] = SPECIES.map((k, i) => (i < RACE_COUNT ? race(k as RaceKey) : animal(k as AnimalKey)));

export function speciesId(key: string): number {
  const i = SPECIES.indexOf(key as SpeciesKey);
  if (i < 0) throw new Error(`unknown species ${key}`);
  return i;
}

export function isCiv(kind: number): boolean {
  return kind < RACE_COUNT;
}
