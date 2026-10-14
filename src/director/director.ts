// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The World Director (PLAN section 12): once a year it checks that the
// world isn't going flat or dead and nudges the odds. It never edits a unit
// directly except to bring a lost race back, and it says why every time.
import civ from "../../data/civ.json";
import type { Sim } from "../sim/sim";
import { RACE_COUNT, RACES } from "../sim/species";
import { DEATH } from "../sim/units";

const D = civ.director;
export type DirectorMode = keyof typeof D.modes;

export function directorYear(sim: Sim) {
  const scale = sim.directorScale();
  if (!scale) return;
  reviveRaces(sim);
  crowding(sim, scale);
}

// A race that died out walks back in from the map edge after 20 years.
function reviveRaces(sim: Sim) {
  if (!sim.lifeReturns) return;
  for (let race = 0; race < RACE_COUNT; race++) {
    if (!sim.civ.everLived[race]) continue;
    if (sim.speciesCount[race]! > 0) {
      sim.civ.goneSince[race] = -1;
      continue;
    }
    if (sim.civ.goneSince[race]! < 0) {
      sim.civ.goneSince[race] = sim.year;
      continue;
    }
    if (sim.year - sim.civ.goneSince[race]! < D.reviveYears) continue;
    const at = edgeLand(sim);
    if (at < 0) continue;
    const [lo, hi] = D.reviveBand as [number, number];
    sim.spawnBand(race, (at % sim.world.w) + 0.5, Math.floor(at / sim.world.w) + 0.5, sim.rng.civ.int(lo, hi));
    sim.civ.goneSince[race] = -1;
    sim.chronicle("revive", { race: RACES[race]! }, "why_revive");
  }
}

function edgeLand(sim: Sim): number {
  const w = sim.world;
  const r = sim.rng.civ;
  for (let tries = 0; tries < 200; tries++) {
    const side = r.int(0, 3);
    const along = r.next();
    const depth = r.int(2, 10);
    const x = side === 0 ? depth : side === 1 ? w.w - 1 - depth : Math.floor(along * w.w);
    const y = side === 2 ? depth : side === 3 ? w.h - 1 - depth : Math.floor(along * w.h);
    const i = y * w.w + x;
    if (w.height[i]! >= w.seaLevel + 0.01 && sim.passable(0, i)) return i;
  }
  return -1;
}

// Near the unit cap, sickness thins the crowd until it drops.
function crowding(sim: Sim, scale: number) {
  const u = sim.units;
  if (u.count < u.capacity * D.crowded && sim.population() < u.capacity * D.crowded) return;
  let died = 0;
  for (let s = 0; s < u.count; s++) {
    if (u.alive[s] && u.kind[s]! < RACE_COUNT && sim.rng.civ.chance(D.sickness * scale)) {
      sim.kill(s, DEATH.disease);
      died++;
    }
  }
  if (died) sim.chronicle("sickness", { n: died }, "why_crowded");
}
