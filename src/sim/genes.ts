// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// 24 genes per unit (PLAN section 9): 8 stats, 6 personality values, skin,
// hair and eye colour, lifespan, age of adulthood and 5 trait slots.
import sim from "../../data/sim.json";
import type { Rng } from "../core/rng";
import { SPECIES_INFO, TRAIT_EFFECTS, TRAITS } from "./species";

export const GENES = 24;
export const G = {
  stat: 0, // 8 stats, 1 to 20
  personality: 8, // aggression, ambition, curiosity, loyalty, greed, kindness, 0 to 255
  skin: 14,
  hair: 15,
  eye: 16,
  lifespan: 17, // 128 is the species average
  adulthood: 18, // 128 is the species average
  traits: 19, // 5 slots, 0 empty, otherwise trait index + 1
} as const;

export const STAT = { strength: 0, agility: 1, intelligence: 2, vitality: 3, charisma: 4, faith: 5, fertility: 6, size: 7 } as const;
export const PERSONALITY = { aggression: 0, ambition: 1, curiosity: 2, loyalty: 3, greed: 4, kindness: 5 } as const;

export function randomGenes(kind: number, rng: Rng, out: Uint8Array) {
  const s = SPECIES_INFO[kind]!;
  for (let i = 0; i < 8; i++) {
    const [lo, hi] = s.stats[i]!;
    out[G.stat + i] = rng.int(lo, hi);
  }
  for (let i = 0; i < 6; i++) out[G.personality + i] = rng.int(40, 215);
  out[G.skin] = rng.int(0, 255);
  out[G.hair] = rng.int(0, 255);
  out[G.eye] = rng.int(0, 255);
  out[G.lifespan] = rng.int(110, 146);
  out[G.adulthood] = rng.int(116, 140);
  for (let i = 0; i < 5; i++) out[G.traits + i] = 0;
  if (rng.chance(sim.genes.traitChance * 2)) out[G.traits] = rng.int(1, TRAITS.length);
}

// A child takes each gene from one parent, then each gene may mutate.
export function inheritGenes(a: Uint8Array, b: Uint8Array, kind: number, rng: Rng, wild: boolean, out: Uint8Array) {
  const s = SPECIES_INFO[kind]!;
  const rate = wild ? sim.genes.mutationWild : sim.genes.mutation;
  for (let i = 0; i < GENES; i++) {
    out[i] = rng.chance(0.5) ? a[i]! : b[i]!;
    if (!rng.chance(rate)) continue;
    if (i < 8) {
      const [lo, hi] = s.stats[i]!;
      out[i] = clamp(out[i]! + rng.int(-2, 2), Math.max(1, lo - 4), Math.min(20, hi + 4));
    } else if (i >= G.traits) {
      out[i] = rng.chance(0.5) ? 0 : rng.int(1, TRAITS.length);
    } else {
      out[i] = clamp(out[i]! + rng.int(-24, 24), 0, 255);
    }
  }
}

// The Genetics tab's mutate power: nudges a few genes and adds a trait.
export function mutate(genes: Uint8Array, kind: number, rng: Rng) {
  const s = SPECIES_INFO[kind]!;
  for (let n = 0; n < 3; n++) {
    const i = rng.int(0, G.eye);
    if (i < 8) genes[i] = clamp(genes[i]! + rng.int(-3, 3), 1, Math.min(20, s.stats[i]![1] + 4));
    else genes[i] = clamp(genes[i]! + rng.int(-40, 40), 0, 255);
  }
  addTrait(genes, rng.int(1, TRAITS.length));
}

export function hasTrait(genes: Uint8Array, trait: number): boolean {
  for (let i = 0; i < 5; i++) if (genes[G.traits + i] === trait + 1) return true;
  return false;
}

export function addTrait(genes: Uint8Array, traitPlusOne: number): boolean {
  for (let i = 0; i < 5; i++) if (genes[G.traits + i] === traitPlusOne) return false;
  for (let i = 0; i < 5; i++) {
    if (genes[G.traits + i] === 0) {
      genes[G.traits + i] = traitPlusOne;
      return true;
    }
  }
  genes[G.traits + 4] = traitPlusOne;
  return true;
}

export function removeTrait(genes: Uint8Array, traitPlusOne: number) {
  for (let i = 0; i < 5; i++) if (genes[G.traits + i] === traitPlusOne) genes[G.traits + i] = 0;
}

export function traitList(genes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < 5; i++) if (genes[G.traits + i]) out.push(genes[G.traits + i]! - 1);
  return out;
}

// A stat after trait bonuses.
export function stat(genes: Uint8Array, s: number): number {
  let v = genes[G.stat + s]!;
  const name = (["strength", "agility", "intelligence", "vitality", "charisma", "faith", "fertility", "size"] as const)[s]!;
  for (const t of traitList(genes)) v += TRAIT_EFFECTS[t]?.[name as "size"] ?? 0;
  return clamp(v, 1, 25);
}

export function traitEffect(genes: Uint8Array, effect: "speed" | "safety" | "armor" | "lifespan" | "fire" | "hunger"): number {
  let v = 0;
  for (const t of traitList(genes)) v += TRAIT_EFFECTS[t]?.[effect] ?? 0;
  return v;
}

export function lifespanYears(genes: Uint8Array, kind: number): number {
  const [lo, hi] = SPECIES_INFO[kind]!.lifespan;
  const base = (lo + hi) / 2;
  return base * (genes[G.lifespan]! / 128) * (1 + traitEffect(genes, "lifespan")) * (0.8 + stat(genes, STAT.vitality) / 50);
}

export function adultAge(genes: Uint8Array, kind: number): number {
  return SPECIES_INFO[kind]!.adult * (genes[G.adulthood]! / 128);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
