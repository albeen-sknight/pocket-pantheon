// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Turns a running simulation into plain data for saves, and back.
import { WEIGHTS } from "./brain";
import { GENES } from "./genes";
import { Sim, type Building, type Town } from "./sim";
import { NEEDS, UNIT_ARRAYS } from "./units";
import type { World } from "../world/types";

type Arr = Uint8Array | Uint16Array | Int32Array | Float32Array;

export interface SimSnapshot {
  json: {
    tick: number;
    count: number;
    nextUid: number;
    nextBuilding: number;
    nextTown: number;
    names: string[];
    towns: Town[];
    buildings: Building[];
  };
  arrays: Record<string, Arr>;
}

// Fields with more than one value per unit
const STRIDE: Record<string, number> = { needs: NEEDS, genes: GENES, brain: WEIGHTS };

export function toSnapshot(sim: Sim): SimSnapshot {
  const u = sim.units;
  const arrays: Record<string, Arr> = {};
  for (const name of UNIT_ARRAYS) {
    const stride = STRIDE[name] ?? 1;
    arrays["u." + name] = (u[name] as Arr).slice(0, u.count * stride);
  }
  arrays.heat = sim.heat.slice();
  arrays.chops = sim.chops.slice();
  const ids = sim.ids();
  return {
    json: {
      tick: sim.tick,
      count: u.count,
      nextUid: u.nextUid,
      nextBuilding: ids.building,
      nextTown: ids.town,
      names: u.names.slice(0, u.count),
      towns: sim.towns.map((t) => ({ ...t })),
      buildings: sim.buildings.map((b) => ({ ...b })),
    },
    arrays,
  };
}

export function fromSnapshot(world: World, seed: number, snap: SimSnapshot): Sim {
  const sim = new Sim(world, seed);
  const u = sim.units;
  const j = snap.json;
  for (const name of UNIT_ARRAYS) {
    const src = snap.arrays["u." + name];
    if (src) (u[name] as Arr).set(src as never);
  }
  u.count = j.count;
  u.nextUid = j.nextUid;
  u.names = j.names.slice();
  u.paths = new Array(j.count).fill(null);
  u.reindex();
  sim.tick = j.tick;
  sim.towns = j.towns;
  for (const b of j.buildings) sim.restoreBuilding(b);
  sim.setIds(j.nextBuilding, j.nextTown);
  if (snap.arrays.heat) sim.heat.set(snap.arrays.heat as Uint16Array);
  if (snap.arrays.chops) sim.chops.set(snap.arrays.chops as Uint8Array);
  sim.recount();
  return sim;
}
