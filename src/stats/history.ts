// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Yearly samples of the world (PLAN section 17), kept in capped ring
// buffers so 1,000 years of history stay small, plus the reports the stats
// panel asks for.
import civData from "../../data/civ.json";
import cfg from "../../data/stats.json";
import { kingdom, kingdomOfTown } from "../civ/kingdoms";
import { religion } from "../civ/religion";
import type { Chronicle } from "../civ/types";
import { STAT, stat } from "../sim/genes";
import type { Sim } from "../sim/sim";
import { RACE_COUNT, RACES, SPECIES_INFO, type RaceKey } from "../sim/species";

export const CAUSES = ["age", "battle", "disease", "hunger", "fire", "drowning", "monster", "disaster", "god"] as const;
const FIXED = 3 + RACE_COUNT + CAUSES.length; // year, people, births, races, deaths

type Sparse = [number, number][]; // [id, value]

export interface HistoryJson {
  count: number;
  births: number;
  deaths: number[];
  kingdoms: Sparse[];
  religions: Sparse[];
  subspecies: Sparse[];
}

export class History {
  readonly cap = cfg.years;
  readonly fixed = new Float32Array(this.cap * FIXED);
  kingdoms: Sparse[] = new Array(this.cap);
  religions: Sparse[] = new Array(this.cap);
  subspecies: Sparse[] = new Array(this.cap);
  count = 0; // samples taken, may exceed cap
  births = 0;
  deaths = new Float32Array(CAUSES.length);

  onBirth() {
    this.births++;
  }

  onDeath(cause: number) {
    if (cause >= 0 && cause < CAUSES.length) this.deaths[cause]!++;
  }

  // Once a year: write one row, then reset the counters.
  sample(sim: Sim) {
    const slot = this.count % this.cap;
    const row = this.fixed.subarray(slot * FIXED, slot * FIXED + FIXED);
    row[0] = sim.year;
    row[1] = sim.population();
    row[2] = this.births;
    for (let r = 0; r < RACE_COUNT; r++) row[3 + r] = sim.speciesCount[r]!;
    row.set(this.deaths, 3 + RACE_COUNT);
    this.kingdoms[slot] = sim.civ.kingdoms.filter((k) => k.alive).map((k) => [k.id, k.pop]);
    this.religions[slot] = sim.civ.religions.filter((r) => r.alive && r.followers).map((r) => [r.id, r.followers]);
    const subs = new Map<number, number>();
    const u = sim.units;
    for (let s = 0; s < u.count; s++) if (u.alive[s] && u.subspecies[s]) subs.set(u.subspecies[s]!, (subs.get(u.subspecies[s]!) ?? 0) + 1);
    this.subspecies[slot] = [...subs.entries()];
    this.count++;
    this.births = 0;
    this.deaths.fill(0);
  }

  // Slots in time order, oldest first.
  rows(): number[] {
    const n = Math.min(this.count, this.cap);
    const start = this.count > this.cap ? this.count % this.cap : 0;
    return Array.from({ length: n }, (_, i) => (start + i) % this.cap);
  }

  field(slot: number, i: number): number {
    return this.fixed[slot * FIXED + i]!;
  }

  // Rough memory use in bytes, for the 30 MB budget: 8 bytes a number and
  // a small header per array.
  bytes(): number {
    let sparse = 0;
    for (const list of [this.kingdoms, this.religions, this.subspecies]) for (const l of list) sparse += l ? l.length * (2 * 8 + 16) + 16 : 0;
    return this.fixed.byteLength + sparse;
  }

  toJson(): HistoryJson {
    const keep = (l: Sparse[]) => Array.from({ length: this.cap }, (_, i) => l[i] ?? []);
    return { count: this.count, births: this.births, deaths: [...this.deaths], kingdoms: keep(this.kingdoms), religions: keep(this.religions), subspecies: keep(this.subspecies) };
  }

  restore(fixed: Float32Array, j: HistoryJson) {
    this.fixed.set(fixed.subarray(0, this.fixed.length));
    this.count = j.count;
    this.births = j.births;
    this.deaths.set(j.deaths);
    this.kingdoms = j.kingdoms;
    this.religions = j.religions;
    this.subspecies = j.subspecies;
  }
}

export interface Series {
  id: number; // 0 is "everyone else"
  name: string;
  color: string;
  values: number[];
}

export interface Pyramid {
  group: "race" | "kingdom";
  id: number;
  name: string;
  race: RaceKey;
  bands: number[]; // first age of each band
  male: number[];
  female: number[];
}

export interface WarReport {
  id: number;
  a: string;
  b: string;
  start: number; // years
  end: number | null;
  result: string;
  reason: string;
  casualties: [number, number];
  towns: [number, number];
  battles: number;
  log: { year: number; a: number; b: number }[];
}

export interface TreeNode {
  id: number;
  name: string;
  color: string;
  race: RaceKey;
  parent: number;
  capital: number; // town id
  founded: number;
  fell: number | null;
  peak: number;
  pop: number;
  alive: boolean;
}

export interface Leader {
  name: string;
  value: number;
  detail: string;
}

export interface StatsReport {
  year: number;
  ticksPerYear: number;
  years: number[];
  people: number[];
  births: number[];
  races: Series[];
  kingdoms: Series[];
  religions: Series[];
  subspecies: Series[];
  deaths: { decade: number; counts: number[] }[];
  pyramids: Pyramid[];
  wars: WarReport[];
  tree: TreeNode[];
  leaders: Record<"strongest" | "oldest" | "kills" | "smartest" | "richest" | "armies", Leader[]>;
  chronicle: Chronicle[];
  bytes: number;
}

const kingdomColor = (index: number) => civData.kingdomColors[index % civData.kingdomColors.length]!;

// Keeps the biggest few series by their peak and folds the rest into one
// "everyone else" series. Colours follow the entity, never its rank.
function topSeries(h: History, pick: (slot: number) => Sparse | undefined, name: (id: number) => string, color: (id: number, i: number) => string): Series[] {
  const rows = h.rows();
  const peak = new Map<number, number>();
  for (const slot of rows) for (const [id, v] of pick(slot) ?? []) peak.set(id, Math.max(peak.get(id) ?? 0, v));
  const top = [...peak.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, cfg.topSeries)
    .map(([id]) => id)
    .sort((a, b) => a - b);
  const out: Series[] = top.map((id, i) => ({ id, name: name(id), color: color(id, i), values: [] }));
  const other: Series = { id: 0, name: "", color: cfg.otherColor, values: [] };
  for (const slot of rows) {
    const row = new Map(pick(slot) ?? []);
    let rest = 0;
    row.forEach((v, id) => {
      if (!top.includes(id)) rest += v;
    });
    out.forEach((s) => s.values.push(row.get(s.id) ?? 0));
    other.values.push(rest);
  }
  if (other.values.some((v) => v > 0)) out.push(other);
  return out;
}

export function report(sim: Sim): StatsReport {
  const h = sim.history;
  const rows = h.rows();
  const civ = sim.civ;
  const kname = (id: number) => civ.kingdoms[id - 1]?.name ?? "";
  const tpy = sim.ticksPerYear;

  // Deaths grouped by decade for the stacked columns.
  const decades = new Map<number, number[]>();
  for (const s of rows) {
    const d = Math.floor(h.field(s, 0) / 10) * 10;
    const counts = decades.get(d) ?? new Array<number>(CAUSES.length).fill(0);
    for (let c = 0; c < CAUSES.length; c++) counts[c]! += h.field(s, 3 + RACE_COUNT + c);
    decades.set(d, counts);
  }

  const peaks = new Map<number, number>();
  for (const s of rows) for (const [id, v] of h.kingdoms[s] ?? []) peaks.set(id, Math.max(peaks.get(id) ?? 0, v));

  return {
    year: sim.year,
    ticksPerYear: tpy,
    years: rows.map((s) => h.field(s, 0)),
    people: rows.map((s) => h.field(s, 1)),
    births: rows.map((s) => h.field(s, 2)),
    races: RACES.map((race, r) => ({ id: r + 1, name: race, color: cfg.raceColors[race], values: rows.map((s) => h.field(s, 3 + r)) })),
    kingdoms: topSeries(h, (s) => h.kingdoms[s], kname, (id) => kingdomColor(civ.kingdoms[id - 1]?.color ?? 0)),
    religions: topSeries(h, (s) => h.religions[s], (id) => civ.religions[id - 1]?.name ?? "", (id) => kingdomColor(civ.religions[id - 1]?.color ?? 0)),
    subspecies: topSeries(h, (s) => h.subspecies[s], (id) => civ.subspecies[id - 1]?.name ?? "", (_, i) => cfg.seriesColors[i]!),
    deaths: [...decades.entries()].map(([decade, counts]) => ({ decade, counts })),
    pyramids: pyramids(sim),
    wars: civ.wars.map((w) => ({
      id: w.id,
      a: kname(w.a),
      b: kname(w.b),
      start: Math.floor(w.start / tpy),
      end: w.end ? Math.floor(w.end / tpy) : null,
      result: w.result,
      reason: w.reason,
      casualties: w.casualties,
      towns: w.towns,
      battles: w.battles,
      log: w.log ?? [],
    })),
    tree: civ.kingdoms.map((k) => ({
      id: k.id,
      name: k.name,
      color: kingdomColor(k.color),
      race: RACES[k.race]!,
      parent: k.parent,
      capital: k.capital,
      founded: Math.floor(k.founded / tpy),
      fell: k.alive ? null : Math.floor((k.fell ?? k.founded) / tpy),
      peak: Math.max(k.pop, peaks.get(k.id) ?? 0),
      pop: k.alive ? k.pop : 0,
      alive: k.alive,
    })),
    leaders: leaders(sim),
    chronicle: civ.log.slice(-cfg.chronicle),
    bytes: h.bytes(),
  };
}

// Age bands split by sex, for every race and every living kingdom. Each band
// is a tenth of that race's longest lifespan.
function pyramids(sim: Sim): Pyramid[] {
  const u = sim.units;
  const n = cfg.pyramidBands;
  const span = RACES.map((_, r) => SPECIES_INFO[r]!.lifespan[1]);
  const make = (group: Pyramid["group"], id: number, name: string, race: number): Pyramid => ({
    group,
    id,
    name,
    race: RACES[race]!,
    bands: Array.from({ length: n }, (_, i) => Math.round((span[race]! / n) * i)),
    male: new Array<number>(n).fill(0),
    female: new Array<number>(n).fill(0),
  });
  const races = RACES.map((race, r) => make("race", r + 1, race, r));
  const kingdoms = new Map<number, Pyramid>();
  for (const k of sim.civ.kingdoms) if (k.alive) kingdoms.set(k.id, make("kingdom", k.id, k.name, k.race));
  for (let s = 0; s < u.count; s++) {
    const kind = u.kind[s]!;
    if (!u.alive[s] || kind >= RACE_COUNT) continue;
    const band = Math.min(n - 1, Math.floor((u.age[s]! / span[kind]!) * n));
    const side = u.sex[s] ? "male" : "female";
    races[kind]![side][band]!++;
    const k = kingdomOfTown(sim, sim.town(u.town[s]!));
    const kp = k ? kingdoms.get(k.id) : undefined;
    if (kp) kp[side][band]!++;
  }
  return [...races, ...kingdoms.values()];
}

function leaders(sim: Sim): StatsReport["leaders"] {
  const u = sim.units;
  const people: number[] = [];
  for (let s = 0; s < u.count; s++) if (u.alive[s] && u.kind[s]! < RACE_COUNT) people.push(s);
  const where = (s: number) => kingdomOfTown(sim, sim.town(u.town[s]!))?.name ?? "";
  const top = (score: (s: number) => number, detail: (s: number) => string = where) =>
    people
      .map((s) => ({ s, v: score(s) }))
      .filter((p) => p.v > 0)
      .sort((a, b) => b.v - a.v || u.uid[a.s]! - u.uid[b.s]!)
      .slice(0, cfg.leaders)
      .map(({ s, v }) => ({ name: u.names[s]!, value: Math.round(v * 10) / 10, detail: detail(s) }));
  return {
    strongest: top((s) => stat(u.genesOf(s), STAT.strength)),
    oldest: top((s) => u.age[s]!),
    kills: top((s) => u.kills[s]!),
    smartest: top((s) => stat(u.genesOf(s), STAT.intelligence)),
    richest: sim.civ.kingdoms
      .filter((k) => k.alive)
      .sort((a, b) => b.gold - a.gold || a.id - b.id)
      .slice(0, cfg.leaders)
      .map((k) => ({ name: k.name, value: Math.round(k.gold), detail: religion(sim, k.religion)?.name ?? "" })),
    armies: sim.civ.armies
      .filter((a) => a.members.length)
      .sort((a, b) => b.members.length - a.members.length || a.id - b.id)
      .slice(0, cfg.leaders)
      .map((a) => ({ name: a.name, value: a.members.length, detail: kingdom(sim, a.kingdom)?.name ?? "" })),
  };
}
