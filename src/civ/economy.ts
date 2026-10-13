// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Taxes, trade and research (PLAN section 10). Towns keep stockpiles,
// kingdoms pool gold, and ideas spread along trade routes.
import buildingData from "../../data/buildings.json";
import civ from "../../data/civ.json";
import { STAT, stat } from "../sim/genes";
import type { Sim, Town } from "../sim/sim";
import { borrow } from "./language";
import { culture, hasTrait, kingdom } from "./kingdoms";
import { relation } from "./diplomacy";
import { RES, RESOURCES, type Kingdom } from "./types";

const E = civ.economy;
const R = civ.research;

export function count(sim: Sim, town: Town, type: keyof typeof buildingData): number {
  let n = 0;
  for (const b of sim.buildings) if (b.town === town.id && b.type === type && b.done) n++;
  return n;
}

export function yearlyEconomy(sim: Sim) {
  for (const t of sim.towns) {
    if (!t.alive) continue;
    const k = kingdom(sim, t.kingdom);
    if (k) k.gold += t.pop * E.taxPerPerson * (hasTrait(k, "mercantile") ? 1.5 : 1);
  }
  trade(sim);
  research(sim);
}

// Market towns swap surplus with friendly market towns nearby.
function trade(sim: Sim) {
  const markets = sim.towns.filter((t) => t.alive && count(sim, t, "market") > 0);
  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const a = markets[i]!;
      const b = markets[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) > E.tradeRange) continue;
      if (a.kingdom !== b.kingdom) {
        const rel = relation(sim, a.kingdom, b.kingdom);
        if (rel.state === "embargo" || rel.state === "rivals") continue;
        rel.trading = true;
        const ka = kingdom(sim, a.kingdom);
        const kb = kingdom(sim, b.kingdom);
        if (ka && kb && sim.rng.civ.chance(0.2)) borrow(culture(sim, ka.culture)!.lang, culture(sim, kb.culture)!.lang, sim.rng.civ);
      }
      balance(a, b);
    }
  }
}

function balance(a: Town, b: Town) {
  const move = (have: number, other: number) => (have - other) * E.tradeShare;
  const food = move(a.food, b.food);
  a.food -= food;
  b.food += food;
  const wood = move(a.wood, b.wood);
  a.wood -= wood;
  b.wood += wood;
  for (let r = 2; r < RESOURCES.length; r++) {
    const m = move(a.res[r]!, b.res[r]!);
    a.res[r]! -= m;
    b.res[r]! += m;
  }
}

function research(sim: Sim) {
  const u = sim.units;
  const points = new Map<number, number>();
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.town[s]! <= 0) continue;
    const t = sim.town(u.town[s]!);
    if (!t?.kingdom) continue;
    points.set(t.kingdom, (points.get(t.kingdom) ?? 0) + R.perCitizen * (stat(u.genesOf(s), STAT.intelligence) / 10));
  }
  for (const t of sim.towns) {
    if (!t.alive || !t.kingdom) continue;
    const extra = count(sim, t, "library") * R.library + count(sim, t, "temple") * R.temple;
    points.set(t.kingdom, (points.get(t.kingdom) ?? 0) + extra);
  }
  for (const k of sim.civ.kingdoms) {
    if (!k.alive) continue;
    let p = points.get(k.id) ?? 0;
    if (hasTrait(k, "scholarly")) p *= R.scholarly;
    k.research += p;
    spreadIdeas(sim, k);
    advance(sim, k);
  }
}

// Peaceful contact closes part of the gap to a more advanced trade partner.
function spreadIdeas(sim: Sim, k: Kingdom) {
  for (const rel of sim.civ.relations.values()) {
    if (!rel.trading || (rel.a !== k.id && rel.b !== k.id)) continue;
    const other = kingdom(sim, rel.a === k.id ? rel.b : rel.a);
    if (other && other.research > k.research) k.research += (other.research - k.research) * R.tradeSpread;
  }
}

export function advance(sim: Sim, k: Kingdom) {
  const next = civ.ages[k.age + 1];
  if (!next || k.research < next.research) return;
  k.age++;
  sim.chronicle("age", { kingdom: k.name, age: next.key });
}

export { RES };
