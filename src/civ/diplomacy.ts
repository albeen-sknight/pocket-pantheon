// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Every pair of kingdoms keeps an opinion from minus 100 to 100 (PLAN
// section 11). Trade, shared faith and race pull it up; borders pull it down.
import civ from "../../data/civ.json";
import type { Sim } from "../sim/sim";
import { hasTrait, kingdom } from "./kingdoms";
import type { Relation, RelationState } from "./types";

const D = civ.diplomacy;

export interface LiveRelation extends Relation {
  trading?: boolean;
}

export function relation(sim: Sim, a: number, b: number): LiveRelation {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  let rel = sim.civ.relations.get(key);
  if (!rel) {
    rel = { a: Math.min(a, b), b: Math.max(a, b), opinion: 0, state: "none" };
    sim.civ.relations.set(key, rel);
  }
  return rel;
}

export function yearlyDiplomacy(sim: Sim) {
  const alive = sim.civ.kingdoms.filter((k) => k.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;
      const ca = sim.town(a.capital);
      const cb = sim.town(b.capital);
      if (!ca || !cb || Math.hypot(ca.x - cb.x, ca.y - cb.y) > D.range) continue;
      const rel = relation(sim, a.id, b.id);
      let drift = a.race === b.race ? D.sameRace : D.otherRace;
      if (a.religion && b.religion) drift += a.religion === b.religion ? D.sameReligion : D.otherReligion;
      if (sim.civ.borders.has(`${rel.a}:${rel.b}`)) drift += D.border * (hasTrait(a, "militaristic") || hasTrait(b, "militaristic") ? 1.5 : 1);
      if (rel.trading) drift += D.trade;
      if (hasTrait(a, "isolationist") || hasTrait(b, "isolationist")) drift += D.isolationist;
      rel.opinion = clamp(rel.opinion * (1 - D.decay) + drift + (sim.rng.civ.next() - 0.5) * 2);
      rel.trading = false;
      setState(sim, rel);
    }
  }
}

function setState(sim: Sim, rel: LiveRelation) {
  const o = rel.opinion;
  const next: RelationState = o >= D.alliance ? "alliance" : o >= D.tradePact ? "trade" : o <= D.rivals ? "rivals" : o <= D.embargo ? "embargo" : "none";
  if (next === rel.state) return;
  const was = rel.state;
  rel.state = next;
  const a = kingdom(sim, rel.a);
  const b = kingdom(sim, rel.b);
  if (!a || !b) return;
  if (next === "alliance") sim.chronicle("alliance", { a: a.name, b: b.name });
  else if (next === "rivals") sim.chronicle("rivals", { a: a.name, b: b.name });
  else if (next === "embargo" && was !== "rivals") sim.chronicle("embargo", { a: a.name, b: b.name });
  else if (next === "trade" && was === "none") sim.chronicle("trade", { a: a.name, b: b.name });
}

export function improve(sim: Sim, a: number, b: number, amount: number) {
  const rel = relation(sim, a, b);
  rel.opinion = clamp(rel.opinion + amount);
  setState(sim, rel);
}

function clamp(v: number): number {
  return v < -100 ? -100 : v > 100 ? 100 : v;
}
