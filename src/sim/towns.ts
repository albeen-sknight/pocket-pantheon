// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The town planner (PLAN section 10): looks at shortages and decides what to
// build next, hands out jobs, and sends settlers off when a town fills up.
import buildingData from "../../data/buildings.json";
import config from "../../data/sim.json";
import { B } from "../world/biomes";
import type { BuildingType, Sim, Town } from "./sim";
import { SPECIES_INFO } from "./species";
import { walkTo } from "./mind";
import { ACT, JOB } from "./units";

const T = config.town;
const STAGES = [0, T.villagePop, T.townPop, T.cityPop];
const TREES = new Set([B.forest, B.jungle, B.taiga, B.grove]);

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
  const farms = sim.buildings.filter((b) => b.town === town.id && b.type === "farm" && b.done).length;
  const want = {
    farmer: Math.min(adults.length, farms * 2),
    woodcutter: Math.max(1, Math.ceil(adults.length / (town.wood < 10 ? 3 : 6))),
  };
  let farmers = 0;
  let cutters = 0;
  for (const s of adults) {
    if (farmers < want.farmer) {
      u.job[s] = JOB.farmer;
      farmers++;
    } else if (cutters < want.woodcutter) {
      u.job[s] = JOB.woodcutter;
      cutters++;
    } else {
      u.job[s] = JOB.gatherer;
    }
  }
}

// Up to two constructions at a time, picked from the biggest shortage first.
// If the top choice has no site or wood, the next one gets a turn.
function build(sim: Sim, town: Town) {
  const pending = sim.buildings.filter((b) => b.town === town.id && !b.done).length;
  if (pending >= 2) return;
  const count = (type: BuildingType) => sim.buildings.filter((b) => b.town === town.id && b.type === type).length;
  for (const choice of wishes(town, count)) {
    const cost = buildingData[choice].wood;
    if (town.wood < cost) continue;
    const site = siteFor(sim, town, choice);
    if (!site) continue;
    town.wood -= cost;
    sim.place(choice, site[0], site[1], town.id, town.race);
    return;
  }
}

function wishes(town: Town, count: (t: BuildingType) => number): BuildingType[] {
  const out: BuildingType[] = [];
  const farmsWanted = Math.ceil(town.pop / T.farmPerPeople);
  const hungry = town.food < town.pop * 4;
  if (hungry && count("farm") < farmsWanted) out.push("farm");
  if (town.housing - town.pop < 2) out.push("house");
  if (count("farm") < farmsWanted) out.push("farm");
  if (count("lumber") === 0) out.push("lumber");
  if (town.stage >= 1 && count("well") === 0) out.push("well");
  if (town.food > town.pop * 3 && town.wood > 20) out.push("house");
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
  for (const s of band) {
    u.town[s] = -1;
    u.home[s] = -1;
    u.job[s] = 0;
    u.act[s] = ACT.settle;
    walkTo(sim, s, tx, ty, 1);
  }
  town.pop -= band.length;
}
