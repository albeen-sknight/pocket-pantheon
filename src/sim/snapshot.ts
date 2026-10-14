// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Turns a running simulation into plain data for saves, and back.
import { WEIGHTS } from "./brain";
import { GENES } from "./genes";
import { culture, newCulture, newKingdom } from "../civ/kingdoms";
import { RESOURCES, type Chronicle, type Culture, type Grave, type Kingdom, type Legend, type Religion, type Subspecies } from "../civ/types";
import type { LiveRelation } from "../civ/diplomacy";
import type { DirectorMode } from "../director/director";
import type { Army } from "../war/armies";
import { rebuildWarPairs, type War } from "../war/wars";
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
    civ?: CivJson;
  };
  arrays: Record<string, Arr>;
}

interface CivJson {
  cultures: Culture[];
  raceCulture: number[];
  kingdoms: Kingdom[];
  relations: LiveRelation[];
  religions: Religion[];
  subspecies: Subspecies[];
  legends: Legend[];
  graves: Grave[];
  log: Chronicle[];
  baseline: number[][];
  everLived: boolean[];
  goneSince: number[];
  settlements: { x: number; y: number; kingdom: number; until: number }[];
  directorMode: DirectorMode;
  lifeReturns: boolean;
  wars?: War[];
  armies?: Army[];
  lastWar?: number;
  nextArmy?: number;
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
  arrays.owner = sim.civ.owner.slice();
  arrays.wallHp = sim.civ.wallHp.slice();
  const c = sim.civ;
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
      civ: structuredClone({
        cultures: c.cultures,
        raceCulture: c.raceCulture,
        kingdoms: c.kingdoms,
        relations: [...c.relations.values()],
        religions: c.religions,
        subspecies: c.subspecies,
        legends: c.legends,
        graves: c.graves,
        log: c.log.slice(-1500),
        baseline: c.baseline,
        everLived: c.everLived,
        goneSince: c.goneSince,
        settlements: c.settlements,
        directorMode: sim.directorMode,
        lifeReturns: sim.lifeReturns,
        wars: c.wars,
        armies: c.armies,
        lastWar: c.lastWar,
        nextArmy: c.nextArmy,
      }),
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
  if (snap.arrays.owner) sim.civ.owner.set(snap.arrays.owner as Uint16Array);
  if (snap.arrays.wallHp) sim.civ.wallHp.set(snap.arrays.wallHp as Uint8Array);
  sim.recount();
  if (j.civ) restoreCiv(sim, j.civ);
  else upgradeCiv(sim);
  return sim;
}

function restoreCiv(sim: Sim, c: CivJson) {
  const civ = sim.civ;
  civ.cultures = c.cultures;
  civ.raceCulture = c.raceCulture;
  civ.kingdoms = c.kingdoms;
  civ.relations = new Map(c.relations.map((r) => [`${r.a}:${r.b}`, r]));
  civ.religions = c.religions;
  civ.subspecies = c.subspecies;
  civ.legends = c.legends;
  civ.graves = c.graves;
  civ.log = c.log;
  civ.baseline = c.baseline;
  civ.everLived = c.everLived;
  civ.goneSince = c.goneSince;
  civ.settlements = c.settlements;
  sim.directorMode = c.directorMode;
  sim.lifeReturns = c.lifeReturns;
  civ.wars = c.wars ?? [];
  civ.armies = c.armies ?? [];
  civ.lastWar = c.lastWar ?? 0;
  civ.nextArmy = c.nextArmy ?? 1;
  rebuildWarPairs(sim);
}

// Saves from before Phase 3 have towns but no kingdoms: give each its own.
function upgradeCiv(sim: Sim) {
  for (const t of sim.towns) {
    t.res ??= new Array(RESOURCES.length).fill(0);
    t.loyalty ??= 80;
    if (!t.alive || t.kingdom) continue;
    t.kingdom = 0;
    newKingdom(sim, t, culture(sim, sim.civ.raceCulture[t.race]!) ?? newCulture(sim, t.race));
  }
}
