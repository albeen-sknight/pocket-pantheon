// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Every creature kind gets one small integer id: the 4 races first, then the
// 15 animals, the 10 monsters and the 3 specials (PLAN section 8).
import creatures from "../../data/creatures.json";
import { BIOMES } from "../world/biomes";

export type RaceKey = keyof typeof creatures.races;
export type AnimalKey = keyof typeof creatures.animals;
export type MonsterKey = keyof typeof creatures.monsters;
export type SpecialKey = keyof typeof creatures.specials;
export type SpeciesKey = RaceKey | AnimalKey | MonsterKey | SpecialKey;

export const RACES = Object.keys(creatures.races) as RaceKey[];
export const ANIMALS = Object.keys(creatures.animals) as AnimalKey[];
export const MONSTERS = Object.keys(creatures.monsters) as MonsterKey[];
export const SPECIALS = Object.keys(creatures.specials) as SpecialKey[];
export const SPECIES: SpeciesKey[] = [...RACES, ...ANIMALS, ...MONSTERS, ...SPECIALS];
export const RACE_COUNT = RACES.length;
// Everything after the races that lives wild and keeps its own numbers up.
export const WILD = [...ANIMALS, ...MONSTERS];

export const STAT_NAMES = creatures.stats;
export const TRAITS = Object.keys(creatures.traits);
export type TraitEffects = Partial<Record<"size" | "speed" | "safety" | "armor" | "intelligence" | "lifespan" | "vitality" | "fertility" | "fire" | "hunger", number>>;
export const TRAIT_EFFECTS: TraitEffects[] = TRAITS.map((k) => (creatures.traits as Record<string, TraitEffects>)[k]!);

// Special behaviours a creature can have (data/creatures.json flags).
export interface Powers {
  fire: boolean; // breathes or sets fires
  undead: boolean;
  bite: boolean; // victims rise as zombies
  night: boolean; // only walks at night
  scares: boolean;
  spreads: string; // biome it spreads
  heals: boolean;
  splits: boolean;
  freezes: boolean;
  giant: boolean;
  wrecks: boolean; // flattens buildings it walks through
  abducts: boolean;
  guards: boolean;
}

export interface Species extends Powers {
  key: SpeciesKey;
  civ: boolean;
  monster: boolean;
  speed: number;
  hp: number;
  damage: number;
  lifespan: [number, number];
  adult: number;
  elder: number;
  litter: number;
  cap: number; // per 100 habitat tiles
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

const NO_POWERS: Powers = {
  fire: false, undead: false, bite: false, night: false, scares: false, spreads: "", heals: false,
  splits: false, freezes: false, giant: false, wrecks: false, abducts: false, guards: false,
};

function race(key: RaceKey): Species {
  const r = creatures.races[key] as (typeof creatures.races)[RaceKey] & { climbs?: boolean; plantsTrees?: boolean };
  return {
    ...NO_POWERS,
    key,
    civ: true,
    monster: false,
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

type WildData = {
  habitat: string[]; diet: string; speed: number; hp: number; damage: number; lifespan: number; adult: number; litter: number; cap: number;
  prey?: string[]; herd?: boolean; swims?: boolean; flies?: boolean;
} & Partial<Omit<Powers, "spreads">> & { spreads?: string };

function wild(key: SpeciesKey, a: WildData, monster: boolean): Species {
  const powers: Powers = { ...NO_POWERS };
  for (const p of Object.keys(NO_POWERS) as (keyof Powers)[]) if (a[p] !== undefined) (powers as unknown as Record<string, unknown>)[p] = a[p];
  return {
    ...powers,
    key,
    civ: false,
    monster,
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
    climbs: monster,
    meat: a.diet === "meat",
    prey: new Set((a.prey ?? []).map((p) => SPECIES.indexOf(p as SpeciesKey))),
    habitat: biomeSet(a.habitat),
    stats: [[5, 10], [5, 10], [1, 3], [5, 10], [1, 3], [1, 3], [5, 10], [5, 10]],
    plantsTrees: false,
  };
}

const table = { ...creatures.animals, ...creatures.monsters, ...creatures.specials } as Record<string, WildData>;

export const SPECIES_INFO: Species[] = SPECIES.map((k, i) =>
  i < RACE_COUNT ? race(k as RaceKey) : wild(k, table[k]!, i >= RACE_COUNT + ANIMALS.length),
);

export function speciesId(key: string): number {
  const i = SPECIES.indexOf(key as SpeciesKey);
  if (i < 0) throw new Error(`unknown species ${key}`);
  return i;
}

export function isCiv(kind: number): boolean {
  return kind < RACE_COUNT;
}
