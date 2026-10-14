// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Subspecies (PLAN section 9). Every 25 years each race is grouped by
// kingdom; a group that lives apart and has drifted far enough from its
// race's starting genome becomes its own subspecies.
import civ from "../../data/civ.json";
import { GENES, G } from "../sim/genes";
import type { Sim } from "../sim/sim";
import { RACE_COUNT } from "../sim/species";
import { culture, kingdom } from "./kingdoms";
import { word } from "./language";
import type { Subspecies } from "./types";

const S = civ.subspecies;

export function subspecies(sim: Sim, id: number): Subspecies | undefined {
  return id > 0 ? sim.civ.subspecies[id - 1] : undefined;
}

// Mean of the first 14 genes (stats and personality), scaled to 0 to 1.
function meanGenome(sim: Sim, slots: number[]): Float32Array {
  const out = new Float32Array(14);
  const u = sim.units;
  for (const s of slots) for (let i = 0; i < 14; i++) out[i]! += u.genes[s * GENES + i]! / (i < 8 ? 20 : 255);
  for (let i = 0; i < 14; i++) out[i]! /= Math.max(1, slots.length);
  return out;
}

export function rememberBaseline(sim: Sim) {
  for (let race = 0; race < RACE_COUNT; race++) {
    const u = sim.units;
    const slots: number[] = [];
    for (let s = 0; s < u.count; s++) if (u.alive[s] && u.kind[s] === race) slots.push(s);
    if (slots.length) sim.civ.baseline[race] = Array.from(meanGenome(sim, slots));
  }
}

export function checkSubspecies(sim: Sim) {
  if (sim.year === 0 || sim.year % S.every !== 0) return;
  const u = sim.units;
  const groups = new Map<number, number[]>();
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.kind[s]! >= RACE_COUNT) continue;
    const t = sim.town(u.town[s]!);
    if (!t?.kingdom) continue;
    const list = groups.get(t.kingdom);
    if (list) list.push(s);
    else groups.set(t.kingdom, [s]);
  }
  groups.forEach((slots, kid) => {
    const k = kingdom(sim, kid);
    if (!k || slots.length < S.minGroup) return;
    const base = sim.civ.baseline[k.race];
    if (!base) return;
    const mean = meanGenome(sim, slots);
    let drift = 0;
    for (let i = 0; i < 14; i++) drift += Math.abs(mean[i]! - base[i]!);
    drift /= 14;
    const current = u.subspecies[slots[0]!]!;
    const parent = subspecies(sim, current);
    if (drift < S.drift * (parent ? 2 : 1) || !isolated(sim, k.id, k.race)) return;
    split(sim, kid, slots);
  });
}

function isolated(sim: Sim, kid: number, race: number): boolean {
  const k = kingdom(sim, kid)!;
  const capital = sim.town(k.capital);
  if (!capital) return false;
  for (const o of sim.civ.kingdoms) {
    if (!o.alive || o.id === kid || o.race !== race) continue;
    const c = sim.town(o.capital);
    if (c && Math.hypot(c.x - capital.x, c.y - capital.y) < S.isolation) return false;
  }
  return true;
}

export function split(sim: Sim, kid: number, slots: number[]): Subspecies | null {
  const k = kingdom(sim, kid);
  if (!k || !slots.length) return null;
  const u = sim.units;
  const r = sim.rng.civ;
  const traitCount = new Map<number, number>();
  for (const s of slots) {
    for (let i = 0; i < 5; i++) {
      const t = u.genes[s * GENES + G.traits + i]!;
      if (t) traitCount.set(t - 1, (traitCount.get(t - 1) ?? 0) + 1);
    }
  }
  const traits = [...traitCount.entries()].filter(([, n]) => n > slots.length * 0.3).map(([t]) => t);
  const lang = culture(sim, k.culture)!.lang;
  const name = word(lang, r, 2, 2);
  const sub: Subspecies = {
    id: sim.civ.subspecies.length + 1,
    race: k.race,
    name: name[0]!.toUpperCase() + name.slice(1),
    tint: r.int(0, 3),
    traits,
    parent: u.subspecies[slots[0]!]!,
    founded: sim.tick,
    kingdom: kid,
    count: slots.length,
  };
  sim.civ.subspecies.push(sub);
  for (const s of slots) {
    u.subspecies[s] = sub.id;
    u.genes[s * GENES + G.skin] = sub.tint;
  }
  sim.chronicle("subspecies", { name: sub.name, race: k.race, kingdom: k.name });
  return sub;
}
