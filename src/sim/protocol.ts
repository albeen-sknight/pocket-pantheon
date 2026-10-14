// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Messages between the main thread and the simulation worker (PLAN section 4).
// Commands go in with the tick they apply to; frames come out with packed
// unit positions, tile changes and anything the UI needs.
import buildingData from "../../data/buildings.json";
import type { World } from "../world/types";
import { G, GENES, stat, traitList } from "./genes";
import type { Command, Sim, SimEvent } from "./sim";
import type { SimSnapshot } from "./snapshot";
import { isCiv, SPECIES_INFO, type RaceKey } from "./species";
import { ACT, NEEDS } from "./units";

export const UNIT_STRIDE = 5; // uid, x, y, kind, flags

export const F = { left: 1, child: 2, female: 4, moving: 8 } as const;
export const ICON_SHIFT = 4;
export const ICONS = ["none", "sleep", "love", "work", "build", "pray", "fight", "flee", "eat"] as const;

export type ToWorker =
  | { type: "init"; world: World; seed: number; races: RaceKey[]; snapshot?: SimSnapshot }
  | { type: "cmd"; cmd: Command }
  | { type: "speed"; speed: number }
  | { type: "select"; uid: number }
  | { type: "save"; id: number };

export interface BuildingView {
  id: number;
  type: keyof typeof buildingData;
  x: number;
  y: number;
  w: number;
  h: number;
  race: number;
  done: boolean;
  progress: number; // 0 to 1
}

export interface TownView {
  id: number;
  race: number;
  name: string;
  x: number;
  y: number;
  pop: number;
  stage: number;
}

export interface UnitDetail {
  uid: number;
  name: string;
  kind: number;
  sex: number;
  age: number;
  hp: number;
  maxHp: number;
  needs: number[];
  stats: number[];
  personality: number[];
  traits: number[];
  job: number;
  act: number;
  town: string;
  spouse: string;
  kills: number;
  children: number;
  x: number;
  y: number;
}

export interface Frame {
  type: "frame";
  tick: number;
  year: number;
  pop: number;
  towns: number;
  count: number;
  units: Float32Array;
  tiles: Int32Array; // index, biome, flags triples
  buildings?: BuildingView[];
  townList?: TownView[];
  events: SimEvent[];
  selected?: UnitDetail | null;
}

export type FromWorker = Frame | { type: "saved"; id: number; snapshot: SimSnapshot };

export function packFrame(sim: Sim, selected: number): Frame {
  const u = sim.units;
  let n = 0;
  for (let s = 0; s < u.count; s++) if (u.alive[s]) n++;
  const units = new Float32Array(n * UNIT_STRIDE);
  let k = 0;
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s]) continue;
    const kind = u.kind[s]!;
    let flags = u.facing[s]! ? F.left : 0;
    if (u.age[s]! < SPECIES_INFO[kind]!.adult) flags |= F.child;
    if (u.sex[s] === 0) flags |= F.female;
    if (u.paths[s]) flags |= F.moving;
    flags |= iconFor(sim, s) << ICON_SHIFT;
    flags |= (u.genes[s * GENES + G.skin]! & 3) << 8;
    units[k++] = u.uid[s]!;
    units[k++] = u.x[s]!;
    units[k++] = u.y[s]!;
    units[k++] = kind;
    units[k++] = flags;
  }

  const tiles = new Int32Array(sim.changed.size * 3);
  let t = 0;
  for (const i of sim.changed) {
    tiles[t++] = i;
    tiles[t++] = sim.world.biome[i]!;
    tiles[t++] = sim.world.flags[i]!;
  }
  sim.changed.clear();

  const frame: Frame = {
    type: "frame",
    tick: sim.tick,
    year: sim.year,
    pop: sim.population(),
    towns: sim.towns.filter((tw) => tw.alive).length,
    count: n,
    units,
    tiles,
    events: sim.events,
  };
  sim.events = [];
  if (sim.buildingsChanged || sim.tick % 20 === 0) {
    sim.buildingsChanged = false;
    frame.buildings = sim.buildings.map((b) => ({
      id: b.id, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, race: b.race, done: b.done,
      progress: Math.min(1, b.progress / buildingData[b.type].work),
    }));
    frame.townList = sim.towns.filter((tw) => tw.alive).map((tw) => ({ id: tw.id, race: tw.race, name: tw.name, x: tw.x, y: tw.y, pop: tw.pop, stage: tw.stage }));
  }
  if (selected) frame.selected = detail(sim, selected);
  return frame;
}

function iconFor(sim: Sim, s: number): number {
  const u = sim.units;
  if (u.paths[s]) return u.act[s] === ACT.flee ? 7 : 0;
  switch (u.act[s]) {
    case ACT.sleep: return 1;
    case ACT.social: return isCiv(u.kind[s]!) ? 2 : 0;
    case ACT.work: return 3;
    case ACT.build: return 4;
    case ACT.pray: return 5;
    case ACT.fight: case ACT.hunt: return 6;
    case ACT.eat: return 8;
    default: return 0;
  }
}

export function detail(sim: Sim, uid: number): UnitDetail | null {
  const u = sim.units;
  const s = u.find(uid);
  if (s < 0) return null;
  const g = u.genesOf(s);
  let children = 0;
  for (let o = 0; o < u.count; o++) if (u.alive[o] && (u.mother[o] === uid || u.father[o] === uid)) children++;
  const spouse = u.find(u.spouse[s]!);
  return {
    uid,
    name: u.names[s] ?? "",
    kind: u.kind[s]!,
    sex: u.sex[s]!,
    age: Math.floor(u.age[s]!),
    hp: Math.round(u.hp[s]!),
    maxHp: Math.round(sim.maxHp(s)),
    needs: Array.from(u.needs.subarray(s * NEEDS, s * NEEDS + NEEDS)),
    stats: Array.from({ length: 8 }, (_, i) => stat(g, i)),
    personality: Array.from({ length: 6 }, (_, i) => g[G.personality + i]! / 255),
    traits: traitList(g),
    job: u.job[s]!,
    act: u.act[s]!,
    town: sim.town(u.town[s]!)?.name ?? "",
    spouse: spouse >= 0 ? u.names[spouse]! : "",
    kills: u.kills[s]!,
    children,
    x: u.x[s]!,
    y: u.y[s]!,
  };
}
