// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Messages between the main thread and the simulation worker (PLAN section 4).
// Commands go in with the tick they apply to; frames come out with packed
// unit positions, tile changes and anything the UI needs.
import buildingData from "../../data/buildings.json";
import { culture, kingdom, townReligion } from "../civ/kingdoms";
import { phrase } from "../civ/language";
import { religion } from "../civ/religion";
import { subspecies } from "../civ/subspecies";
import type { StatsReport } from "../stats/history";
import type { World } from "../world/types";
import { G, GENES, stat, traitList } from "./genes";
import type { Command, Fx, Sim, SimEvent } from "./sim";
import type { SimSnapshot } from "./snapshot";
import { isCiv, SPECIES_INFO, type RaceKey } from "./species";
import { ACT, NEEDS } from "./units";

export const UNIT_STRIDE = 5; // uid, x, y, kind, flags

export const F = { left: 1, child: 2, female: 4, moving: 8 } as const;
// Bits 8 and 9 hold the skin variant, 10 to 13 the kingdom colour + 1, 14 a blessing.
export const COLOR_SHIFT = 10;
export const BLESSED = 1 << 14;
export const ICON_SHIFT = 4;
export const ICONS = ["none", "sleep", "love", "work", "build", "pray", "fight", "flee", "eat"] as const;

export type ToWorker =
  | { type: "init"; world: World; seed: number; races: RaceKey[]; snapshot?: SimSnapshot }
  | { type: "cmd"; cmd: Command }
  | { type: "speed"; speed: number }
  | { type: "select"; uid: number }
  | { type: "selectTown"; id: number }
  | { type: "save"; id: number }
  | { type: "stats"; id: number };

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
  kingdom: number;
}

export interface ArmyView {
  id: number;
  kingdom: number;
  color: number;
  name: string;
  x: number;
  y: number;
  size: number;
  morale: number;
  state: string;
  stance: string;
  general: string;
  target: string;
}

export interface WarView {
  id: number;
  a: string;
  b: string;
  aId: number;
  bId: number;
  start: number; // year
}

export interface KingdomView {
  id: number;
  name: string;
  color: number;
  race: number;
  towns: number;
  pop: number;
  age: number;
  capital: number;
}

export interface TownDetail {
  id: number;
  name: string;
  race: number;
  pop: number;
  stage: number;
  loyalty: number;
  food: number;
  wood: number;
  res: number[];
  faith: string;
  kingdom: {
    name: string;
    color: number;
    ruler: string;
    capital: string;
    age: number;
    research: number;
    gold: number;
    traits: number[];
    faith: string;
    towns: number;
    pop: number;
    words: string;
    relations: { name: string; opinion: number; state: string }[];
  } | null;
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
  kingdom: string;
  faith: string;
  subspecies: string;
  weapon: number;
  armor: number;
  quality: number;
  legend: string;
  says: string;
  topic: number;
  blessed: boolean;
}

export interface Frame {
  type: "frame";
  tick: number;
  year: number;
  pop: number;
  towns: number;
  count: number;
  units: Float32Array;
  tiles: Int32Array; // index, biome, flags, height x 65535
  hazards: Int32Array; // index, kind pairs
  storms: { kind: string; x: number; y: number; r: number; ticks: number }[];
  buildings?: BuildingView[];
  townList?: TownView[];
  events: SimEvent[];
  selected?: UnitDetail | null;
  kingdoms?: KingdomView[];
  wars?: WarView[];
  armies: ArmyView[];
  possessed: number;
  owner?: Uint16Array;
  fx: Fx[];
  town?: TownDetail | null;
}

export type FromWorker = Frame | { type: "saved"; id: number; snapshot: SimSnapshot } | { type: "stats"; id: number; report: StatsReport };

export function packFrame(sim: Sim, selected: number, selectedTown = 0): Frame {
  // Kingdom colour + 1 per town, so clothes can wear the banner colour.
  const townColor = new Map<number, number>();
  for (const t of sim.towns) {
    const k = t.alive ? kingdom(sim, t.kingdom) : undefined;
    if (k) townColor.set(t.id, k.color + 1);
  }
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
    flags |= (townColor.get(u.town[s]!) ?? 0) << COLOR_SHIFT;
    if (u.blessed[s]! > 0) flags |= BLESSED;
    units[k++] = u.uid[s]!;
    units[k++] = u.x[s]!;
    units[k++] = u.y[s]!;
    units[k++] = kind;
    units[k++] = flags;
  }

  const tiles = new Int32Array(sim.changed.size * 4);
  let t = 0;
  for (const i of sim.changed) {
    tiles[t++] = i;
    tiles[t++] = sim.world.biome[i]!;
    tiles[t++] = sim.world.flags[i]!;
    tiles[t++] = Math.round(Math.max(0, Math.min(1, sim.world.height[i]!)) * 65535);
  }
  sim.changed.clear();
  const hz = sim.hazards;
  const hazards = new Int32Array(hz.changed.size * 2);
  let h = 0;
  for (const i of hz.changed) {
    hazards[h++] = i;
    hazards[h++] = hz.kind[i]!;
  }
  hz.changed.clear();

  const frame: Frame = {
    type: "frame",
    tick: sim.tick,
    year: sim.year,
    pop: sim.population(),
    towns: sim.towns.filter((tw) => tw.alive).length,
    count: n,
    units,
    tiles,
    hazards,
    storms: sim.storms.map((s) => ({ kind: s.kind, x: s.x, y: s.y, r: s.r, ticks: s.ticks })),
    events: sim.events,
    fx: sim.fx,
    armies: sim.civ.armies.map((a) => ({
      id: a.id,
      kingdom: a.kingdom,
      color: kingdom(sim, a.kingdom)?.color ?? 0,
      name: a.name,
      x: a.x,
      y: a.y,
      size: a.members.length,
      morale: Math.round(Math.max(0, a.morale)),
      state: a.state,
      stance: a.stance,
      general: u.names[u.find(a.general)] ?? "",
      target: sim.town(a.target.town)?.name ?? "",
    })),
    possessed: sim.possessed,
  };
  sim.events = [];
  sim.fx = [];
  if (sim.civ.ownerChanged) {
    sim.civ.ownerChanged = false;
    frame.owner = sim.civ.owner.slice();
  }
  if (sim.buildingsChanged || sim.tick % 20 === 0) {
    sim.buildingsChanged = false;
    frame.buildings = sim.buildings.map((b) => ({
      id: b.id, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, race: b.race, done: b.done,
      progress: Math.min(1, b.progress / buildingData[b.type].work),
    }));
    frame.townList = sim.towns.filter((tw) => tw.alive).map((tw) => ({ id: tw.id, race: tw.race, name: tw.name, x: tw.x, y: tw.y, pop: tw.pop, stage: tw.stage, kingdom: tw.kingdom }));
    frame.wars = sim.civ.wars
      .filter((w) => !w.end)
      .map((w) => ({ id: w.id, a: kingdom(sim, w.a)?.name ?? "", b: kingdom(sim, w.b)?.name ?? "", aId: w.a, bId: w.b, start: Math.floor(w.start / sim.ticksPerYear) }));
    frame.kingdoms = sim.civ.kingdoms.filter((k) => k.alive).map((k) => ({ id: k.id, name: k.name, color: k.color, race: k.race, towns: k.towns, pop: k.pop, age: k.age, capital: k.capital }));
  }
  if (selectedTown) frame.town = townDetail(sim, selectedTown);
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
    kingdom: kingdom(sim, sim.town(u.town[s]!)?.kingdom ?? 0)?.name ?? "",
    faith: religion(sim, u.religion[s]!)?.name ?? "",
    subspecies: subspecies(sim, u.subspecies[s]!)?.name ?? "",
    weapon: u.weapon[s]!,
    armor: u.armor[s]!,
    quality: u.gearQ[s]!,
    legend: sim.civ.legends.find((l) => l.owner === uid)?.name ?? "",
    says: isCiv(u.kind[s]!) ? phrase(sim.cultureFor(u.kind[s]!, u.town[s]!).lang, topicOf(sim, s)) : "",
    topic: topicOf(sim, s),
    blessed: u.blessed[s]! > 0,
  };
}

// What someone would talk about right now: their most pressing need.
export const TOPICS = ["hungry", "tired", "scared", "lonely", "faith", "bored", "happy"] as const;

function topicOf(sim: Sim, s: number): number {
  const u = sim.units;
  let worst = -1;
  let level = 0.6;
  for (let n = 0; n < 6; n++) {
    const v = u.needs[s * NEEDS + n]!;
    if (v > level) {
      level = v;
      worst = n;
    }
  }
  return worst < 0 ? 6 : worst;
}

export function townDetail(sim: Sim, id: number): TownDetail | null {
  const t = sim.town(id);
  if (!t) return null;
  const k = kingdom(sim, t.kingdom);
  const lang = k ? culture(sim, k.culture)!.lang : null;
  return {
    id: t.id,
    name: t.name,
    race: t.race,
    pop: t.pop,
    stage: t.stage,
    loyalty: Math.round(t.loyalty),
    food: Math.floor(t.food),
    wood: Math.floor(t.wood),
    res: t.res.map((v) => Math.floor(v)),
    faith: religion(sim, townReligion(sim, t))?.name ?? "",
    kingdom: k
      ? {
          name: k.name,
          color: k.color,
          ruler: k.rulerName,
          capital: sim.town(k.capital)?.name ?? "",
          age: k.age,
          research: Math.floor(k.research),
          gold: Math.floor(k.gold),
          traits: k.traits,
          faith: religion(sim, k.religion)?.name ?? "",
          towns: k.towns,
          pop: k.pop,
          words: lang ? lang.syllables.slice(0, 6).join(" ") : "",
          relations: [...sim.civ.relations.values()]
            .filter((r) => (r.a === k.id || r.b === k.id) && kingdom(sim, r.a === k.id ? r.b : r.a))
            .sort((a, b) => Math.abs(b.opinion) - Math.abs(a.opinion))
            .slice(0, 4)
            .map((r) => ({ name: kingdom(sim, r.a === k.id ? r.b : r.a)!.name, opinion: Math.round(r.opinion), state: r.state })),
        }
      : null,
  };
}
