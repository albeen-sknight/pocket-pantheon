// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The Grace tab (PLAN section 15): kind powers. Each one leaves a visible
// effect for the renderer within the same tick.
import civ from "../../data/civ.json";
import type { Sim } from "../sim/sim";
import { RACE_COUNT } from "../sim/species";
import { NEED, NEEDS } from "../sim/units";
import { HAZ } from "../chaos/hazards";
import { improve } from "./diplomacy";
import { kingdom } from "./kingdoms";

export const GRACE = ["rain", "bless", "heal", "fertility", "inspire", "bounty", "peace", "miracle"] as const;
export type GracePower = (typeof GRACE)[number];

const C = civ.grace;

export function grace(sim: Sim, power: GracePower, x: number, y: number, radius: number) {
  const r = Math.max(1.5, radius + 1);
  sim.fx.push({ kind: power, x, y, r });
  switch (power) {
    case "rain":
      return rain(sim, x, y, r);
    case "bless":
      return eachUnit(sim, x, y, r, (s) => (sim.units.blessed[s] = C.blessYears));
    case "heal":
      return eachUnit(sim, x, y, r, (s) => {
        const u = sim.units;
        u.hp[s] = sim.maxHp(s);
        u.needs.fill(0, s * NEEDS, s * NEEDS + NEEDS);
        u.starve[s] = 0;
      });
    case "fertility":
      return eachUnit(sim, x, y, r, (s) => (sim.units.fertile[s] = C.fertilityYears));
    case "inspire":
      return kingdomsIn(sim, x, y, r).forEach((id) => (kingdom(sim, id)!.research += civ.research.inspiration));
    case "bounty": {
      const t = nearestTown(sim, x, y);
      if (t) t.food += C.bounty * Math.max(1, radius);
      return;
    }
    case "peace": {
      const ids = kingdomsIn(sim, x, y, r + 20);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) improve(sim, ids[i]!, ids[j]!, civ.diplomacy.peacePower);
      return;
    }
    case "miracle":
      return miracle(sim, x, y, r);
  }
}

function eachUnit(sim: Sim, x: number, y: number, r: number, fn: (s: number) => void) {
  const u = sim.units;
  sim.grid.query(x, y, r, (s) => {
    if (u.alive[s] && Math.hypot(u.x[s]! - x, u.y[s]! - y) <= r) fn(s);
  });
}

function rain(sim: Sim, x: number, y: number, r: number) {
  const w = sim.world;
  const h = sim.hazards;
  for (let ty = Math.floor(y - r); ty <= y + r; ty++) {
    for (let tx = Math.floor(x - r); tx <= x + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || Math.hypot(tx - x, ty - y) > r) continue;
      const i = ty * w.w + tx;
      // Rain puts out fires and breaks droughts.
      if (h.kind[i] === HAZ.fire || h.kind[i] === HAZ.drought) h.clear(i);
      w.moisture[i] = Math.min(1, w.moisture[i]! + 0.1);
      if (w.fertility[i]! > 0) w.fertility[i] = Math.min(255, w.fertility[i]! + C.rainFertility);
    }
  }
  // Thirsty crops nearby get a boost.
  const t = nearestTown(sim, x, y);
  if (t && Math.hypot(t.x - x, t.y - y) < r + 12) t.food += 4 * r;
}

function kingdomsIn(sim: Sim, x: number, y: number, r: number): number[] {
  const out = new Set<number>();
  for (const t of sim.towns) if (t.alive && t.kingdom && Math.hypot(t.x - x, t.y - y) <= r + 6) out.add(t.kingdom);
  const owner = sim.civ.owner[Math.floor(y) * sim.world.w + Math.floor(x)];
  if (owner) out.add(owner);
  return [...out];
}

function nearestTown(sim: Sim, x: number, y: number) {
  let best = null;
  let d = Infinity;
  for (const t of sim.towns) {
    if (!t.alive) continue;
    const td = Math.hypot(t.x - x, t.y - y);
    if (td < d) {
      d = td;
      best = t;
    }
  }
  return best;
}

// Brings back people who died nearby, most recent first.
function miracle(sim: Sim, x: number, y: number, r: number) {
  const graves = sim.civ.graves;
  const u = sim.units;
  for (let i = graves.length - 1; i >= 0; i--) {
    const g = graves[i]!;
    if (Math.hypot(g.x - x, g.y - y) > r + 2) continue;
    const s = sim.spawnUnit(g.kind, g.x, g.y, 20);
    if (s < 0) continue;
    u.genesOf(s).set(g.genes);
    if (g.kind < RACE_COUNT) u.names[s] = g.name;
    if (sim.town(g.town)) u.town[s] = g.town;
    u.setNeed(s, NEED.hunger, 0);
    graves.splice(i, 1);
  }
}
