// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Town defences (PLAN section 13): watchtowers and keeps shoot at enemies in
// range, and towns at war ring their core with walls that only their own
// people can pass. Enemies hack their way through; builders mend the gaps.
import war from "../../data/war.json";
import { kingdomOfTown } from "../civ/kingdoms";
import type { Sim, Town } from "../sim/sim";
import { RACE_COUNT, SPECIES_INFO } from "../sim/species";
import { DEATH } from "../sim/units";
import { FARM, LAKE, RIVER, ROAD, STONE_WALL, WALL } from "../world/types";
import { atWar } from "./wars";

const DF = war.defense;

export function unitKingdom(sim: Sim, s: number): number {
  return sim.town(sim.units.town[s]!)?.kingdom ?? 0;
}

// Towers and keeps loose an arrow at the nearest enemy now and then.
export function towersShoot(sim: Sim) {
  const u = sim.units;
  for (const b of sim.buildings) {
    if (!b.done || (b.type !== "tower" && b.type !== "keep")) continue;
    if ((sim.tick + b.id) % DF.towerEvery) continue;
    const kid = sim.town(b.town)?.kingdom ?? 0;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let target = -1;
    let d = DF.towerRange;
    sim.grid.query(cx, cy, DF.towerRange, (s) => {
      const hostile = u.kind[s]! < RACE_COUNT ? atWar(sim, kid, unitKingdom(sim, s)) : SPECIES_INFO[u.kind[s]!]!.meat;
      const sd = Math.hypot(u.x[s]! - cx, u.y[s]! - cy);
      if (hostile && sd < d) {
        d = sd;
        target = s;
      }
    });
    if (target < 0) continue;
    sim.fx.push({ kind: "arrow", x: cx, y: cy - 1, r: 0, tx: u.x[target]!, ty: u.y[target]! - 0.5 });
    u.hp[target]! -= DF.towerDamage * (b.type === "keep" ? 1.5 : 1);
    if (u.hp[target]! <= 0) sim.kill(target, u.kind[target]! < RACE_COUNT ? DEATH.battle : DEATH.monster);
  }
}

// A town at war builds a few wall tiles each time the planner runs. Roads
// stay open as gates.
export function buildWalls(sim: Sim, t: Town) {
  const k = kingdomOfTown(sim, t);
  if (!k || t.stage < 2 || k.age < 1) return;
  const threatened = sim.civ.wars.some((w) => !w.end && (w.a === k.id || w.b === k.id || w.allies.a.includes(k.id) || w.allies.b.includes(k.id)));
  if (!threatened) return;
  const w = sim.world;
  const r = DF.wallRadius + t.stage * 2;
  const level = Math.min(2, k.age - 1); // palisade, stone, fortified
  const hp = DF.wallHp[level]!;
  let placed = 0;
  for (let a = 0; a < 360 && placed < 6; a += 3) {
    const x = Math.round(t.x + Math.cos((a * Math.PI) / 180) * r);
    const y = Math.round(t.y + Math.sin((a * Math.PI) / 180) * r);
    if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) continue;
    const i = y * w.w + x;
    // roads stay open: they're the gates
    if (w.flags[i]! & (WALL | RIVER | LAKE | ROAD | FARM) || sim.occ[i] || w.height[i]! < w.seaLevel) continue;
    const cost = level ? 1 : 0.5;
    if (level ? t.res[2]! < cost : t.wood < cost) return;
    if (level) t.res[2]! -= cost;
    else t.wood -= cost;
    sim.setTileFlag(i, WALL, true);
    if (level) sim.setTileFlag(i, STONE_WALL, true);
    sim.civ.wallHp[i] = hp;
    placed++;
  }
}

// An enemy next to a wall it can't get past hits the wall instead.
export function hitWall(sim: Sim, s: number): boolean {
  const u = sim.units;
  const w = sim.world;
  const x = Math.floor(u.x[s]!);
  const y = Math.floor(u.y[s]!);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * w.w + x + dx;
      if (!(w.flags[i]! & WALL) || sim.civ.owner[i] === unitKingdom(sim, s)) continue;
      const left = (sim.civ.wallHp[i] ?? 0) - 6;
      sim.civ.wallHp[i] = Math.max(0, left);
      if (left <= 0) {
        sim.setTileFlag(i, WALL, false);
        sim.setTileFlag(i, STONE_WALL, false);
        sim.fx.push({ kind: "dust", x: x + dx + 0.5, y: y + dy + 0.5, r: 0.8 });
      }
      return true;
    }
  }
  return false;
}

// Defenders standing on or beside their own walls take less damage.
export function wallCover(sim: Sim, s: number): number {
  const u = sim.units;
  const w = sim.world;
  const x = Math.floor(u.x[s]!);
  const y = Math.floor(u.y[s]!);
  const kid = unitKingdom(sim, s);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * w.w + x + dx;
      if (i >= 0 && i < w.flags.length && w.flags[i]! & WALL && sim.civ.owner[i] === kid) return DF.wallArmor;
    }
  }
  return 0;
}
