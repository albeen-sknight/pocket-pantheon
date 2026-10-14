// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Monster habits (PLAN section 8). Each monster still hunts and wanders like
// an animal; these hooks add what makes it a monster.
import config from "../../data/sim.json";
import dis from "../../data/disasters.json";
import { B } from "../world/biomes";
import { mutate } from "../sim/genes";
import type { Sim } from "../sim/sim";
import { RACE_COUNT, SPECIES_INFO, speciesId } from "../sim/species";
import { ACT, DEATH, NEED } from "../sim/units";
import { breatheFire, turn } from "./disasters";
import { ignite } from "./hazards";

export function isNight(sim: Sim): boolean {
  return Math.sin(((sim.tick % config.dayTicks) / config.dayTicks) * Math.PI * 2) < -0.2;
}

// Called before the normal animal think. Returns true when the monster acted.
export function monsterThink(sim: Sim, s: number): boolean {
  const u = sim.units;
  const info = SPECIES_INFO[u.kind[s]!]!;
  if (info.night && !isNight(sim)) {
    // Skeletons crumble at dawn.
    sim.fx.push({ kind: "dust", x: u.x[s]!, y: u.y[s]!, r: 0.5 });
    sim.kill(s, DEATH.disaster);
    return true;
  }
  if (info.scares) scare(sim, s);
  if (info.heals) heal(sim, s);
  if (info.spreads && sim.rng.chaos.chance(0.05)) spread(sim, s, info.spreads);
  if (info.abducts) return ufo(sim, s);
  if (info.guards) return guard(sim, s);
  if (info.giant && info.wrecks) return roam(sim, s);
  if (info.key === "dragon") return dragon(sim, s);
  return false;
}

function nearCiv(sim: Sim, s: number, r: number): number {
  const u = sim.units;
  let best = -1;
  let d = r;
  sim.grid.query(u.x[s]!, u.y[s]!, r, (o) => {
    if (u.kind[o]! >= RACE_COUNT) return;
    const od = Math.hypot(u.x[o]! - u.x[s]!, u.y[o]! - u.y[s]!);
    if (od < d) {
      d = od;
      best = o;
    }
  });
  return best;
}

function scare(sim: Sim, s: number) {
  const u = sim.units;
  sim.grid.query(u.x[s]!, u.y[s]!, 4, (o) => {
    if (u.kind[o]! >= RACE_COUNT || u.act[o] === ACT.flee) return;
    u.setNeed(o, NEED.safety, 1);
    u.act[o] = ACT.idle; // they'll choose to run on their next think
  });
}

function heal(sim: Sim, s: number) {
  const u = sim.units;
  sim.grid.query(u.x[s]!, u.y[s]!, 3, (o) => {
    if (o === s) return;
    u.hp[o] = Math.min(sim.maxHp(o), u.hp[o]! + 5);
    if (sim.rng.chaos.chance(0.02)) u.blessed[o] = Math.max(u.blessed[o]!, 1);
  });
}

function spread(sim: Sim, s: number, biome: string) {
  const u = sim.units;
  const w = sim.world;
  const id = biome === "infernal" ? B.infernal : B.haunted;
  const tx = Math.floor(u.x[s]! + sim.rng.chaos.int(-2, 2));
  const ty = Math.floor(u.y[s]! + sim.rng.chaos.int(-2, 2));
  if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return;
  const i = ty * w.w + tx;
  if (w.height[i]! >= w.seaLevel && !sim.occ[i]) sim.setBiome(i, id);
  // Demons smoulder rather than blaze: the odd spark, not a wildfire a minute.
  if (SPECIES_INFO[u.kind[s]!]!.fire && sim.rng.chaos.chance(0.04)) ignite(sim, i);
}

// Dragons sleep on their peaks until hunger sends them raiding the nearest town.
function dragon(sim: Sim, s: number): boolean {
  const u = sim.units;
  const D = dis.dragon;
  if (u.need(s, NEED.hunger) < D.raidHunger) return false;
  const prey = nearCiv(sim, s, 14);
  if (prey >= 0 && (sim.tick + s) % D.breathEvery < 8) {
    if (Math.hypot(u.x[prey]! - u.x[s]!, u.y[prey]! - u.y[s]!) < D.breathRange) breatheFire(sim, u.x[s]!, u.y[s]! - 1, u.x[prey]!, u.y[prey]!);
    return false;
  }
  if (prey >= 0) return false;
  let town = null;
  let d = Infinity;
  for (const t of sim.towns) {
    if (!t.alive) continue;
    const td = Math.hypot(t.x - u.x[s]!, t.y - u.y[s]!);
    if (td < d) {
      d = td;
      town = t;
    }
  }
  if (!town || d > 80) return false;
  if (d < 3) sim.chronicle("dragon", { town: town.name });
  sim.goTo(s, town.x, town.y, 30);
  return true;
}

// Giants wander toward towns and flatten what they walk through.
function roam(sim: Sim, s: number): boolean {
  const u = sim.units;
  if (u.paths[s]) return true;
  let town = null;
  let d = Infinity;
  for (const t of sim.towns) {
    if (!t.alive) continue;
    const td = Math.hypot(t.x - u.x[s]!, t.y - u.y[s]!);
    if (td < d) {
      d = td;
      town = t;
    }
  }
  if (town && d > 2) sim.goTo(s, town.x + sim.rng.chaos.int(-3, 3), town.y + sim.rng.chaos.int(-3, 3), 20);
  else sim.goTo(s, u.x[s]! + sim.rng.chaos.int(-10, 10), u.y[s]! + sim.rng.chaos.int(-10, 10), 20);
  return true;
}

export function wreck(sim: Sim, s: number) {
  const u = sim.units;
  const info = SPECIES_INFO[u.kind[s]!]!;
  if (!info.wrecks || sim.tick % 6) return;
  for (const b of [...sim.buildings]) {
    if (Math.hypot(b.x + b.w / 2 - u.x[s]!, b.y + b.h / 2 - u.y[s]!) > 2.2) continue;
    if (!sim.rng.chaos.chance(dis.giant.wreckChance * 3)) continue;
    sim.fx.push({ kind: "dust", x: b.x + b.w / 2, y: b.y + b.h / 2, r: 1.2 });
    sim.removeBuilding(b);
  }
}

// The Ancient Guardian stands still and strikes anything hostile nearby.
function guard(sim: Sim, s: number): boolean {
  const u = sim.units;
  let foe = -1;
  sim.grid.query(u.x[s]!, u.y[s]!, 8, (o) => {
    const k = SPECIES_INFO[u.kind[o]!]!;
    if (o !== s && (k.monster || u.army[o]) && !k.guards) foe = o;
    return foe >= 0;
  });
  if (foe < 0) return true;
  u.act[s] = ACT.fight;
  u.target[s] = u.uid[foe]!;
  u.actT[s] = 60;
  return true;
}

// UFOs drift to a town, take someone, and bring them back years later,
// changed or wiser.
function ufo(sim: Sim, s: number): boolean {
  const u = sim.units;
  if (u.paths[s]) return true;
  const target = nearCiv(sim, s, 2);
  if (target >= 0 && sim.rng.chaos.chance(0.3)) {
    const [lo, hi] = dis.ufo.abductYears as [number, number];
    sim.abducted.push({
      kind: u.kind[target]!,
      genes: Array.from(u.genesOf(target)),
      name: u.names[target]!,
      town: u.town[target]!,
      back: sim.tick + sim.rng.chaos.int(lo, hi) * sim.ticksPerYear,
    });
    sim.fx.push({ kind: "beam", x: u.x[target]!, y: u.y[target]!, r: 1 });
    sim.chronicle("abducted", { name: u.names[target]! });
    sim.units.remove(target);
    sim.speciesCount[u.kind[target]!]!--;
  }
  const towns = sim.towns.filter((t) => t.alive);
  if (!towns.length) return true;
  const t = towns[sim.rng.chaos.int(0, towns.length - 1)]!;
  sim.goTo(s, t.x + sim.rng.chaos.int(-4, 4), t.y + sim.rng.chaos.int(-4, 4), 40);
  return true;
}

export function returnAbductees(sim: Sim) {
  const back = sim.abducted.filter((a) => a.back <= sim.tick);
  if (!back.length) return;
  sim.abducted = sim.abducted.filter((a) => a.back > sim.tick);
  for (const a of back) {
    const t = sim.town(a.town) ?? sim.towns.find((o) => o.alive);
    if (!t) continue;
    const s = sim.spawnUnit(a.kind, t.x + 1, t.y + 2, 25);
    if (s < 0) continue;
    const u = sim.units;
    u.genesOf(s).set(a.genes);
    u.names[s] = a.name;
    u.town[s] = t.id;
    // Half come back mutated; the rest bring back strange new knowledge.
    if (sim.rng.chaos.chance(dis.ufo.returnMutated)) mutate(u.genesOf(s), a.kind, sim.rng.chaos);
    else {
      const k = sim.civ.kingdoms[t.kingdom - 1];
      if (k) k.research += 40;
    }
    sim.fx.push({ kind: "beam", x: t.x + 1, y: t.y + 2, r: 1 });
    sim.chronicle("returned", { name: a.name });
  }
}

// What happens when a monster lands a blow. Returns true if it handled the death.
export function onHit(sim: Sim, attacker: number, target: number): boolean {
  const u = sim.units;
  const a = SPECIES_INFO[u.kind[attacker]!]!;
  const t = SPECIES_INFO[u.kind[target]!]!;
  if (a.freezes) u.stun[target] = 40;
  if (t.splits && u.hp[target]! > 4 && sim.speciesCount[u.kind[target]!]! < sim.speciesCap[u.kind[target]!]! * 3 + 10) {
    u.hp[target] = u.hp[target]! / 2;
    const twin = sim.spawnUnit(u.kind[target]!, u.x[target]! + 0.8, u.y[target]!, 2);
    if (twin >= 0) u.hp[twin] = u.hp[target]!;
  }
  if (a.bite && u.hp[target]! <= 0 && u.kind[target]! < RACE_COUNT) {
    turn(sim, target);
    return true;
  }
  return false;
}

// Wild monsters that don't breed top themselves up in their home biomes.
export function spawnMonsters(sim: Sim) {
  const w = sim.world;
  for (const key of ["skeleton", "ghost", "demon", "ice_golem"] as const) {
    const kind = speciesId(key);
    const info = SPECIES_INFO[kind]!;
    if (info.night && !isNight(sim)) continue;
    if (sim.speciesCount[kind]! >= sim.speciesCap[kind]!) continue;
    for (let tries = 0; tries < 20; tries++) {
      const i = sim.rng.chaos.int(0, w.biome.length - 1);
      if (!info.habitat.has(w.biome[i]!)) continue;
      sim.spawnUnit(kind, (i % w.w) + 0.5, Math.floor(i / w.w) + 0.5, 1);
      break;
    }
  }
}
