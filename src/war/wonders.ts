// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// World wonders and their Ancient Guardian (PLAN sections 8 and 10), and the
// siege engines of the Steel Age (section 13).
import war from "../../data/war.json";
import { kingdom } from "../civ/kingdoms";
import type { Building, Sim, Town } from "../sim/sim";
import { speciesId, SPECIES_INFO } from "../sim/species";
import { STONE_WALL, WALL } from "../world/types";
import type { Army } from "./armies";

const SG = war.siege;

export function wonderOf(sim: Sim, townId: number): Building | undefined {
  return sim.buildings.find((b) => b.town === townId && b.type === "wonder" && b.done);
}

// Wonders bring prestige: every town of a kingdom that owns one is prouder.
export function hasWonder(sim: Sim, kingdomId: number): boolean {
  return sim.buildings.some((b) => b.type === "wonder" && b.done && sim.town(b.town)?.kingdom === kingdomId);
}

// The first attack on a wonder wakes a Guardian beside it, once per wonder.
export function wakeGuardian(sim: Sim, b: Building) {
  if (b.guarded) return;
  b.guarded = true;
  const kind = speciesId("guardian");
  const at = sim.spawnUnit(kind, b.x + b.w / 2, b.y + b.h + 1, SPECIES_INFO[kind]!.adult);
  const t = sim.town(b.town);
  sim.fx.push({ kind: "dust", x: b.x + b.w / 2, y: b.y + b.h + 1, r: 2 });
  if (at >= 0) sim.chronicle("guardian", { town: t?.name ?? "", kingdom: kingdom(sim, t?.kingdom ?? 0)?.name ?? "" });
}

export function hasEngines(sim: Sim, kingdomId: number): boolean {
  return (kingdom(sim, kingdomId)?.age ?? 0) >= SG.age;
}

// A Steel Age army lobs a boulder every so often: at the nearest enemy wall
// if there is one, otherwise at a building.
export function bombard(sim: Sim, a: Army, t: Town) {
  if (!hasEngines(sim, a.kingdom)) return;
  a.engines = (a.engines ?? 0) + war.army.orderEvery;
  if (a.engines < SG.every) return;
  a.engines = 0;
  const wall = nearestWall(sim, a, t);
  if (wall >= 0) {
    const w = sim.world;
    const x = (wall % w.w) + 0.5;
    const y = Math.floor(wall / w.w) + 0.5;
    sim.fx.push({ kind: "boulder", x: a.x, y: a.y, r: 0, tx: x, ty: y });
    const left = (sim.civ.wallHp[wall] ?? 0) - SG.wallDamage;
    sim.civ.wallHp[wall] = Math.max(0, left);
    if (left <= 0) {
      sim.setTileFlag(wall, WALL, false);
      sim.setTileFlag(wall, STONE_WALL, false);
      sim.fx.push({ kind: "dust", x, y, r: 1 });
    }
    return;
  }
  const targets = sim.buildings.filter((b) => b.town === t.id && b.type !== "hall");
  if (!targets.length) return;
  const b = targets.reduce((p, q) => (Math.hypot(q.x - a.x, q.y - a.y) < Math.hypot(p.x - a.x, p.y - a.y) ? q : p));
  sim.fx.push({ kind: "boulder", x: a.x, y: a.y, r: 0, tx: b.x + b.w / 2, ty: b.y + b.h / 2 });
  if (sim.rng.civ.chance(SG.buildingChance)) {
    sim.fx.push({ kind: "dust", x: b.x + b.w / 2, y: b.y + b.h / 2, r: 1.2 });
    sim.removeBuilding(b);
  }
}

function nearestWall(sim: Sim, a: Army, t: Town): number {
  const w = sim.world;
  const r = war.defense.wallRadius + t.stage * 2 + 1;
  let best = -1;
  let bestD = Infinity;
  for (let y = Math.max(0, Math.floor(t.y - r)); y <= Math.min(w.h - 1, t.y + r); y++) {
    for (let x = Math.max(0, Math.floor(t.x - r)); x <= Math.min(w.w - 1, t.x + r); x++) {
      const i = y * w.w + x;
      if (!(w.flags[i]! & WALL) || sim.civ.owner[i] === a.kingdom) continue;
      const d = Math.hypot(x - a.x, y - a.y);
      if (d < bestD) [best, bestD] = [i, d];
    }
  }
  return best;
}
