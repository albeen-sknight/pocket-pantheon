// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The town planner (PLAN section 10): looks at shortages and decides what to
// build next, hands out jobs, and sends settlers off when a town fills up.
import buildingData from "../../data/buildings.json";
import civ from "../../data/civ.json";
import config from "../../data/sim.json";
import { hasTrait, kingdomOfTown } from "../civ/kingdoms";
import { RES } from "../civ/types";
import { B } from "../world/biomes";
import type { BuildingType, Sim, Town } from "./sim";
import { SPECIES_INFO } from "./species";
import { walkTo } from "./mind";
import { ACT, JOB } from "./units";

const T = config.town;
const STAGES = [0, T.villagePop, T.townPop, T.cityPop];
const TREES = new Set([B.forest, B.jungle, B.taiga, B.grove]);
const ROCK = new Set([B.hills, B.mountains, B.badlands, B.snowPeaks]);

export function planTowns(sim: Sim) {
  const members = membersByTown(sim);
  for (const town of sim.towns) {
    if (!town.alive) continue;
    const people = members.get(town.id) ?? [];
    town.pop = people.length;
    if (town.pop === 0) {
      if (sim.tick - town.founded > config.ticksPerYear * 2) town.alive = false;
      continue;
    }
    town.housing = housingOf(sim, town);
    updateStage(sim, town);
    assignJobs(sim, town, people);
    build(sim, town);
    sendSettlers(sim, town, people);
  }
}

function membersByTown(sim: Sim): Map<number, number[]> {
  const u = sim.units;
  const out = new Map<number, number[]>();
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.town[s]! <= 0) continue;
    const list = out.get(u.town[s]!);
    if (list) list.push(s);
    else out.set(u.town[s]!, [s]);
  }
  return out;
}

export function updateTownStats(sim: Sim) {
  for (const town of sim.towns) if (town.alive) town.housing = housingOf(sim, town);
  assignHomes(sim);
}

function housingOf(sim: Sim, town: Town): number {
  let n = 0;
  for (const b of sim.buildings) if (b.town === town.id && b.done) n += buildingData[b.type].housing;
  return n;
}

function updateStage(sim: Sim, town: Town) {
  let stage = 0;
  STAGES.forEach((min, i) => {
    if (town.pop >= min) stage = i;
  });
  if (stage > town.stage) {
    town.stage = stage;
    sim.events.push({ t: "stage", town: town.id, stage, tick: sim.tick });
  }
}

function assignJobs(sim: Sim, town: Town, people: number[]) {
  const u = sim.units;
  const adults = people.filter((s) => u.age[s]! >= SPECIES_INFO[u.kind[s]!]!.adult);
  const has = (type: BuildingType) => sim.buildings.filter((b) => b.town === town.id && b.type === type && b.done).length;
  // Jobs in priority order: food first, then the trades the town has room for.
  const plan: [number, number][] = [
    [JOB.farmer, Math.min(adults.length, has("farm") * 2)],
    [JOB.woodcutter, Math.max(1, Math.ceil(adults.length / (town.wood < 10 ? 3 : 6)))],
    [JOB.miner, has("mine") * 2],
    [JOB.smith, has("smithy")],
    [JOB.priest, has("temple") * 2],
    [JOB.scholar, has("library") * 2],
  ];
  let i = 0;
  for (const [job, n] of plan) {
    for (let k = 0; k < n && i < adults.length; k++) u.job[adults[i++]!] = job;
  }
  while (i < adults.length) u.job[adults[i++]!] = JOB.gatherer;
}

// Up to two constructions at a time, picked from the biggest shortage first.
// If the top choice has no site or wood, the next one gets a turn.
function build(sim: Sim, town: Town) {
  const pending = sim.buildings.filter((b) => b.town === town.id && !b.done).length;
  if (pending >= 2) return;
  const count = (type: BuildingType) => sim.buildings.filter((b) => b.town === town.id && b.type === type).length;
  for (const choice of wishes(sim, town, count)) {
    const { wood, stone } = buildingData[choice];
    if (town.wood < wood || town.res[RES.stone!]! < stone) continue;
    const site = siteFor(sim, town, choice);
    if (!site) continue;
    town.wood -= wood;
    town.res[RES.stone!]! -= stone;
    sim.place(choice, site[0], site[1], town.id, town.race);
    return;
  }
}

function wishes(sim: Sim, town: Town, count: (t: BuildingType) => number): BuildingType[] {
  const out: BuildingType[] = [];
  const k = kingdomOfTown(sim, town);
  const age = k?.age ?? 0;
  const unlocked = (type: BuildingType) => town.stage >= buildingData[type].stage && age >= buildingData[type].age;
  const farmsWanted = Math.ceil(town.pop / T.farmPerPeople);
  const hungry = town.food < town.pop * 4;
  if (hungry && count("farm") < farmsWanted) out.push("farm");
  if (town.housing - town.pop < 2) out.push("house");
  if (count("farm") < farmsWanted) out.push("farm");
  if (count("lumber") === 0) out.push("lumber");
  if (unlocked("mine") && count("mine") === 0) out.push("mine");
  if (unlocked("temple") && count("temple") === 0 && (!k || !hasTrait(k, "nomadic"))) out.push("temple");
  if (k && hasTrait(k, "devout") && unlocked("temple") && count("temple") < 2) out.push("temple");
  if (unlocked("well") && count("well") === 0) out.push("well");
  if (unlocked("smithy") && count("smithy") === 0) out.push("smithy");
  if (unlocked("market") && count("market") === 0) out.push("market");
  if (unlocked("library") && count("library") === 0) out.push("library");
  const atWar = !!k && sim.civ.wars.some((w) => !w.end && (w.a === k.id || w.b === k.id));
  const hawk = !!k && hasTrait(k, "militaristic");
  if (unlocked("tower") && count("tower") < (atWar || hawk ? 2 : 1)) out.push("tower");
  if (unlocked("barracks") && (atWar || hawk) && count("barracks") === 0) out.push("barracks");
  if (unlocked("keep") && k?.capital === town.id && count("keep") === 0) out.push("keep");
  // one wonder per kingdom, raised in the capital
  if (unlocked("wonder") && k?.capital === town.id && !sim.buildings.some((b) => b.type === "wonder" && sim.town(b.town)?.kingdom === k.id)) out.push("wonder");
  if (town.food > town.pop * 3 && town.wood > 20) out.push("house");
  if (k && hasTrait(k, "builder") && town.wood > 30) out.push("house");
  return out;
}

function siteFor(sim: Sim, town: Town, type: BuildingType): [number, number] | null {
  const w = sim.world;
  const cx = Math.round(town.x) - 1;
  const cy = Math.round(town.y) - 1;
  if (type === "farm") {
    return sim.findSite(type, cx, cy, 3, 16, (x, y) => avg(sim, x, y, 3, 3, (i) => w.fertility[i]!) > 40);
  }
  if (type === "lumber") {
    return sim.findSite(type, cx, cy, 3, 14, (x, y) => near(sim, x, y, 5, (i) => TREES.has(w.biome[i]!)));
  }
  if (type === "mine") {
    return sim.findSite(type, cx, cy, 3, 16, (x, y) => near(sim, x, y, 4, (i) => ROCK.has(w.biome[i]!)));
  }
  return sim.findSite(type, cx, cy, 2, 14);
}

function avg(sim: Sim, x: number, y: number, bw: number, bh: number, f: (i: number) => number): number {
  let sum = 0;
  for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) sum += f((y + dy) * sim.world.w + x + dx);
  return sum / (bw * bh);
}

function near(sim: Sim, x: number, y: number, r: number, test: (i: number) => boolean): boolean {
  const w = sim.world;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w.w && ny < w.h && test(ny * w.w + nx)) return true;
    }
  }
  return false;
}

// Homeless people move into houses with room.
function assignHomes(sim: Sim) {
  const u = sim.units;
  const used = new Map<number, number>();
  for (let s = 0; s < u.count; s++) if (u.alive[s] && u.home[s]! >= 0) used.set(u.home[s]!, (used.get(u.home[s]!) ?? 0) + 1);
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.town[s]! <= 0 || u.home[s]! >= 0) continue;
    const house = sim.buildings.find((b) => b.town === u.town[s] && b.done && buildingData[b.type].housing > (used.get(b.id) ?? 0));
    if (!house) continue;
    u.home[s] = house.id;
    used.set(house.id, (used.get(house.id) ?? 0) + 1);
  }
}

// A full town sends a small band off to found a new one (PLAN section 11).
function sendSettlers(sim: Sim, town: Town, people: number[]) {
  const u = sim.units;
  if (town.pop < T.settleMinPop || town.pop < town.housing * T.settleAtHousing) return;
  if (sim.tick - town.lastSettle < config.ticksPerYear * 10) return;
  const r = sim.rng.towns;
  const [lo, hi] = T.settleRange as [number, number];
  const angle = r.next() * Math.PI * 2;
  const dist = r.int(lo, hi);
  const tx = town.x + Math.cos(angle) * dist;
  const ty = town.y + Math.sin(angle) * dist;
  const w = sim.world;
  const i = Math.floor(Math.min(w.h - 1, Math.max(0, ty))) * w.w + Math.floor(Math.min(w.w - 1, Math.max(0, tx)));
  if (!sim.passable(town.race, i)) return;
  const adults = people.filter((s) => u.age[s]! >= SPECIES_INFO[u.kind[s]!]!.adult);
  const band = adults.slice(-T.settleBand);
  if (band.length < T.foundMinPeople) return;
  town.lastSettle = sim.tick;
  if (town.kingdom) sim.civ.settlements.push({ x: tx, y: ty, kingdom: town.kingdom, until: sim.tick + config.ticksPerYear * 15 });
  for (const s of band) {
    u.town[s] = -1;
    u.home[s] = -1;
    u.job[s] = 0;
    u.act[s] = ACT.settle;
    walkTo(sim, s, tx, ty, 1);
  }
  town.pop -= band.length;
}
