// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Smiths turn ore into weapons and armour (PLAN section 10). The tier follows
// the kingdom's age and what's in the stockpile; dwarves work one tier
// better. A legendary weapon gets a name and outlives its owner.
import civ from "../../data/civ.json";
import { STAT, stat } from "../sim/genes";
import type { Sim, Town } from "../sim/sim";
import { SPECIES_INFO } from "../sim/species";
import { culture, kingdomOfTown } from "./kingdoms";
import { shortName } from "./language";
import { RES } from "./types";

const GEAR = civ.gear;

export function gearBonus(tierPlusOne: number): { damage: number; armor: number } {
  const g = GEAR[tierPlusOne - 1];
  return g ? { damage: g.damage, armor: g.armor } : { damage: 0, armor: 0 };
}

function affordable(t: Town, tier: number): boolean {
  const cost: Record<string, number | undefined> = GEAR[tier]!.cost;
  return Object.entries(cost).every(([res, n = 0]) => (res === "wood" ? t.wood : t.res[RES[res]!]!) >= n);
}

function pay(t: Town, tier: number) {
  const cost: Record<string, number | undefined> = GEAR[tier]!.cost;
  for (const [res, n = 0] of Object.entries(cost)) {
    if (res === "wood") t.wood -= n;
    else t.res[RES[res]!]! -= n;
  }
}

// One crafting session: the best tier the town can afford goes to the
// worst equipped adult.
export function craft(sim: Sim, smith: number, t: Town) {
  const k = kingdomOfTown(sim, t);
  if (!k) return;
  const u = sim.units;
  const dwarf = SPECIES_INFO[u.kind[smith]!]!.key === "dwarf" ? 1 : 0;
  let tier = -1;
  for (let i = GEAR.length - 1; i >= 0; i--) {
    if (GEAR[i]!.age <= k.age + dwarf && affordable(t, i)) {
      tier = i;
      break;
    }
  }
  if (tier < 0) return;

  let target = -1;
  let worst = Infinity;
  const armour = sim.rng.civ.chance(0.4);
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.town[s] !== t.id || u.age[s]! < SPECIES_INFO[u.kind[s]!]!.adult) continue;
    const have = armour ? u.armor[s]! : u.weapon[s]!;
    if (have < worst) {
      worst = have;
      target = s;
    }
  }
  if (target < 0 || worst >= tier + 1) return;
  pay(t, tier);
  if (armour) {
    u.armor[target] = tier + 1;
    return;
  }
  u.weapon[target] = tier + 1;
  u.gearQ[target] = quality(sim, smith);
  if (u.gearQ[target] === 4) legend(sim, smith, target, tier, t);
}

function quality(sim: Sim, smith: number): number {
  const skill = stat(sim.units.genesOf(smith), STAT.intelligence) / 20;
  const roll = sim.rng.civ.next() * 0.85 + skill * 0.15;
  return roll > 0.995 ? 4 : roll > 0.9 ? 3 : roll > 0.6 ? 2 : roll > 0.2 ? 1 : 0;
}

function legend(sim: Sim, smith: number, owner: number, tier: number, t: Town) {
  const k = kingdomOfTown(sim, t)!;
  const u = sim.units;
  const name = shortName(culture(sim, k.culture)!.lang, sim.rng.civ);
  sim.civ.legends.push({ id: sim.civ.legends.length + 1, name, tier, maker: u.names[smith]!, owner: u.uid[owner]!, kills: 0, made: sim.tick });
  sim.chronicle("legend", { name, maker: u.names[smith]!, tier: GEAR[tier]!.key });
}

// Heirlooms pass to the eldest child when their owner dies.
export function inherit(sim: Sim, deadUid: number) {
  const item = sim.civ.legends.find((l) => l.owner === deadUid);
  if (!item) return;
  const u = sim.units;
  let heir = -1;
  let age = -1;
  for (let s = 0; s < u.count; s++) {
    if (u.alive[s] && (u.mother[s] === deadUid || u.father[s] === deadUid) && u.age[s]! > age) {
      age = u.age[s]!;
      heir = s;
    }
  }
  item.owner = heir >= 0 ? u.uid[heir]! : 0;
  if (heir < 0) return;
  u.weapon[heir] = item.tier + 1;
  u.gearQ[heir] = 4;
}
