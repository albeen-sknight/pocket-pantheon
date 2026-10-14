// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The Wrath tab (PLAN sections 15 and 16). Every disaster leaves a visible
// effect in the same tick it lands, then plays out over time.
import dis from "../../data/disasters.json";
import { applyStroke } from "../world/edit";
import { B } from "../world/biomes";
import { LAKE, RIVER } from "../world/types";
import type { Sim } from "../sim/sim";
import { RACE_COUNT, SPECIES_INFO, speciesId } from "../sim/species";
import { DEATH } from "../sim/units";
import { HAZ, ignite, paintHazard } from "./hazards";

export const WRATH = ["lightning", "fire", "tornado", "earthquake", "meteor", "acid", "plague", "zombie", "volcano", "flood", "blizzard", "drought", "nuke"] as const;
export type WrathPower = (typeof WRATH)[number];
export type FrequencyKey = keyof typeof dis.frequency;

export interface Storm {
  id: number;
  kind: "tornado" | "acid" | "eruption" | "meteor";
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
  ticks: number;
}

// Units and buildings in a disc; buildings within reach of the disc count.
function eachUnit(sim: Sim, x: number, y: number, r: number, fn: (s: number, d: number) => void) {
  const u = sim.units;
  sim.grid.query(x, y, r, (s) => {
    const d = Math.hypot(u.x[s]! - x, u.y[s]! - y);
    if (u.alive[s] && d <= r) fn(s, d);
  });
}

function buildingsIn(sim: Sim, x: number, y: number, r: number) {
  return sim.buildings.filter((b) => Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y) <= r + 1);
}

function hurt(sim: Sim, s: number, dmg: number, cause: number = DEATH.disaster) {
  const u = sim.units;
  u.hp[s]! -= dmg;
  if (u.hp[s]! <= 0) sim.kill(s, cause);
}

export function wrath(sim: Sim, power: WrathPower, x: number, y: number, radius: number) {
  const r = sim.rng.chaos;
  sim.fx.push({ kind: power, x, y, r: Math.max(1, radius) });
  sim.lastNotable = sim.tick;
  switch (power) {
    case "lightning": {
      const L = dis.lightning;
      eachUnit(sim, x, y, L.radius + 0.5, (s) => hurt(sim, s, L.damage));
      if (r.chance(L.fireChance)) ignite(sim, Math.floor(y) * sim.world.w + Math.floor(x));
      return;
    }
    case "fire":
      for (let n = 0; n < Math.max(1, radius * radius); n++) {
        const a = r.next() * Math.PI * 2;
        const d = r.next() * radius;
        ignite(sim, Math.floor(y + Math.sin(a) * d) * sim.world.w + Math.floor(x + Math.cos(a) * d));
      }
      return;
    case "tornado": {
      const a = r.next() * Math.PI * 2;
      addStorm(sim, "tornado", x, y, dis.tornado.radius, dis.tornado.ticks, Math.cos(a) * dis.tornado.speed, Math.sin(a) * dis.tornado.speed);
      return;
    }
    case "earthquake":
      return earthquake(sim, x, y, Math.max(dis.earthquake.radius, radius * 2));
    case "meteor":
      addStorm(sim, "meteor", x, y, dis.meteor.radius, dis.meteor.fallTicks, 0, 0);
      return;
    case "acid":
      addStorm(sim, "acid", x, y, dis.acid.radius, dis.acid.ticks, (r.next() - 0.5) * 0.05, (r.next() - 0.5) * 0.05);
      return;
    case "plague":
      return infect(sim, x, y, false);
    case "zombie":
      return infect(sim, x, y, true);
    case "volcano":
      applyStroke(sim.world, { tool: "volcano", x, y, radius: dis.volcano.radius });
      sim.markAll(x, y, dis.volcano.infernalRadius + 4);
      addStorm(sim, "eruption", x, y, dis.volcano.radius, dis.volcano.eruptTicks, 0, 0);
      return;
    case "flood":
      return flood(sim, x, y, Math.max(dis.flood.radius, radius * 2));
    case "blizzard":
      paintHazard(sim, x, y, Math.max(dis.blizzard.radius, radius * 2), HAZ.snow, dis.blizzard.years);
      return;
    case "drought":
      paintHazard(sim, x, y, Math.max(dis.drought.radius, radius * 3), HAZ.drought, dis.drought.years);
      return;
    case "nuke":
      return nuke(sim, x, y);
  }
}

function addStorm(sim: Sim, kind: Storm["kind"], x: number, y: number, r: number, ticks: number, dx: number, dy: number) {
  sim.storms.push({ id: sim.nextStorm++, kind, x, y, dx, dy, r, ticks });
}

// Storms move and act every tick until they run out.
export function tickStorms(sim: Sim) {
  const w = sim.world;
  const rng = sim.rng.chaos;
  for (const s of sim.storms) {
    s.ticks--;
    s.x = Math.max(1, Math.min(w.w - 2, s.x + s.dx));
    s.y = Math.max(1, Math.min(w.h - 2, s.y + s.dy));
    if (s.kind === "tornado") {
      if (rng.chance(0.05)) {
        s.dx += (rng.next() - 0.5) * 0.08;
        s.dy += (rng.next() - 0.5) * 0.08;
      }
      const T = dis.tornado;
      eachUnit(sim, s.x, s.y, s.r, (u) => {
        if (sim.tick % 10) return;
        sim.units.x[u] = Math.max(0, Math.min(w.w - 1, sim.units.x[u]! + (rng.next() - 0.5) * T.throw));
        sim.units.y[u] = Math.max(0, Math.min(w.h - 1, sim.units.y[u]! + (rng.next() - 0.5) * T.throw));
        sim.units.paths[u] = null;
        hurt(sim, u, T.damage / 4);
      });
      for (const b of buildingsIn(sim, s.x, s.y, s.r)) if (rng.chance(T.roofChance)) sim.removeBuilding(b);
    } else if (s.kind === "acid") {
      const A = dis.acid;
      eachUnit(sim, s.x, s.y, s.r, (u) => hurt(sim, u, A.damagePerTick));
      for (const b of buildingsIn(sim, s.x, s.y, s.r)) if (rng.chance(A.buildingDamage)) sim.removeBuilding(b);
      if (s.ticks % 60 === 0) paintHazard(sim, s.x, s.y, s.r, HAZ.acid, A.infertileYears);
      if (s.ticks === 0) paintHazard(sim, s.x, s.y, 2, HAZ.acid, A.infertileYears, B.wasteland);
    } else if (s.kind === "eruption") {
      if (s.ticks % dis.volcano.lavaEvery === 0) {
        const a = rng.next() * Math.PI * 2;
        const lx = Math.floor(s.x + Math.cos(a) * 1.5);
        const ly = Math.floor(s.y + Math.sin(a) * 1.5);
        sim.hazards.set(ly * w.w + lx, HAZ.lava, dis.volcano.lavaTicks);
      }
      if (s.ticks % 40 === 0) sim.fx.push({ kind: "ash", x: s.x, y: s.y - 2, r: 3 });
    } else if (s.kind === "meteor" && s.ticks === 0) {
      impact(sim, s.x, s.y);
    }
  }
  sim.storms = sim.storms.filter((s) => s.ticks > 0);
}

function impact(sim: Sim, x: number, y: number) {
  const M = dis.meteor;
  const w = sim.world;
  sim.fx.push({ kind: "boom", x, y, r: M.radius });
  eachUnit(sim, x, y, M.radius, (s) => sim.kill(s, DEATH.disaster));
  for (const b of buildingsIn(sim, x, y, M.radius)) sim.removeBuilding(b);
  for (let ty = Math.floor(y - M.radius - 2); ty <= y + M.radius + 2; ty++) {
    for (let tx = Math.floor(x - M.radius - 2); tx <= x + M.radius + 2; tx++) {
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
      const d = Math.hypot(tx - x, ty - y);
      const i = ty * w.w + tx;
      if (d <= M.radius) w.height[i] = Math.max(0, w.height[i]! - M.depth * (1 - (d / M.radius) ** 2));
      else if (d <= M.radius + 2) ignite(sim, i);
    }
  }
  if (sim.rng.chaos.chance(M.ironChance)) w.ore[Math.floor(y) * w.w + Math.floor(x)] = 5;
  sim.reclassify(x, y, M.radius + 3);
}

function earthquake(sim: Sim, x: number, y: number, r: number) {
  const E = dis.earthquake;
  const w = sim.world;
  const rng = sim.rng.chaos;
  for (const b of buildingsIn(sim, x, y, r)) if (rng.chance(E.collapse)) sim.removeBuilding(b);
  eachUnit(sim, x, y, r, (s) => hurt(sim, s, 8));
  for (let ty = Math.floor(y - r); ty <= y + r; ty++) {
    for (let tx = Math.floor(x - r); tx <= x + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || Math.hypot(tx - x, ty - y) > r) continue;
      const i = ty * w.w + tx;
      if (w.height[i]! >= w.seaLevel && rng.chance(0.2)) w.height[i] = Math.max(w.seaLevel, w.height[i]! - rng.next() * E.crack);
    }
  }
  sim.reclassify(x, y, r);
  // Quakes under mountains can open a vent.
  const i = Math.floor(y) * w.w + Math.floor(x);
  if ((w.biome[i] === B.mountains || w.biome[i] === B.snowPeaks) && rng.chance(E.ventChance)) {
    addStorm(sim, "eruption", x, y, 2, dis.volcano.eruptTicks / 2, 0, 0);
  }
}

function flood(sim: Sim, x: number, y: number, r: number) {
  const F = dis.flood;
  const w = sim.world;
  for (let ty = Math.floor(y - r); ty <= y + r; ty++) {
    for (let tx = Math.floor(x - r); tx <= x + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || Math.hypot(tx - x, ty - y) > r) continue;
      const i = ty * w.w + tx;
      const low = w.height[i]! >= w.seaLevel && w.height[i]! < w.seaLevel + F.rise;
      const wet = w.flags[i]! & (RIVER | LAKE);
      if (low || (wet && w.height[i]! >= w.seaLevel)) sim.hazards.set(i, HAZ.flood, F.ticks);
    }
  }
  // Huts get washed away.
  for (const b of buildingsIn(sim, x, y, r)) {
    const i = (b.y + b.h - 1) * w.w + b.x;
    if (sim.hazards.kind[i] === HAZ.flood && (b.type === "house" || b.type === "farm") && sim.rng.chaos.chance(0.4)) sim.removeBuilding(b);
  }
}

function nuke(sim: Sim, x: number, y: number) {
  const N = dis.nuke;
  sim.fx.push({ kind: "boom", x, y, r: N.radius });
  sim.fx.push({ kind: "mushroom", x, y, r: N.radius });
  eachUnit(sim, x, y, N.radius, (s) => sim.kill(s, DEATH.disaster));
  for (const b of buildingsIn(sim, x, y, N.radius)) sim.removeBuilding(b);
  paintHazard(sim, x, y, N.radius, HAZ.fallout, N.healYears, B.wasteland);
  paintHazard(sim, x, y, N.fallout, HAZ.fallout, Math.round(N.healYears / 4));
  for (let n = 0; n < N.mutants; n++) {
    const a = sim.rng.chaos.next() * Math.PI * 2;
    sim.spawnUnit(speciesId("mutant"), x + Math.cos(a) * N.radius * 0.6, y + Math.sin(a) * N.radius * 0.6, 3);
  }
  sim.chronicle("nuke", {});
}

// Plague starts on the nearest person; zombie plague turns them.
function infect(sim: Sim, x: number, y: number, zombie: boolean) {
  const u = sim.units;
  let best = -1;
  let d = 12;
  sim.grid.query(x, y, d, (s) => {
    if (u.kind[s]! >= RACE_COUNT) return;
    const sd = Math.hypot(u.x[s]! - x, u.y[s]! - y);
    if (sd < d) {
      d = sd;
      best = s;
    }
  });
  if (best < 0) {
    if (zombie) sim.spawnUnit(speciesId("zombie"), x, y, 1);
    return;
  }
  if (zombie) return turn(sim, best);
  u.sick[best] = dis.plague.years;
  sim.chronicle("plague", { town: sim.town(u.town[best]!)?.name ?? "" });
}

// Someone bitten by a zombie gets up as one.
export function turn(sim: Sim, s: number) {
  const u = sim.units;
  const x = u.x[s]!;
  const y = u.y[s]!;
  const genes = u.genesOf(s).slice();
  sim.kill(s, DEATH.monster);
  const z = sim.spawnUnit(speciesId("zombie"), x, y, 1);
  if (z >= 0) u.genesOf(z).set(genes);
}

// Plague moves by contact. Each sick person may die, may recover immune.
export function tickPlague(sim: Sim) {
  if (sim.tick % 10) return;
  const u = sim.units;
  const P = dis.plague;
  const yearsPerCheck = 10 / sim.ticksPerYear;
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.sick[s]! <= 0) continue;
    sim.grid.query(u.x[s]!, u.y[s]!, P.radius, (o) => {
      if (o !== s && u.kind[o]! < RACE_COUNT && !u.immune[o] && u.sick[o]! <= 0 && sim.rng.chaos.chance(P.spread * yearsPerCheck * 10)) u.sick[o] = P.years;
    });
    u.sick[s] = u.sick[s]! - yearsPerCheck;
    if (sim.rng.chaos.chance((P.death / P.years) * yearsPerCheck)) {
      sim.kill(s, DEATH.disease);
      continue;
    }
    if (u.sick[s]! <= 0 && sim.rng.chaos.chance(P.immuneChance)) u.immune[s] = 1;
  }
}

// Natural disasters: the frequency setting, plus the Director when the
// world has been quiet for 10 years (PLAN section 12).
export function naturalEvents(sim: Sim) {
  const freq = dis.frequency[sim.disasterFrequency];
  if (!freq) return;
  const rng = sim.rng.chaos;
  const quiet = sim.tick - sim.lastNotable > dis.natural.quietYears * sim.ticksPerYear && sim.directorScale() > 0;
  if (!quiet && !rng.chance(dis.natural.perYear * freq)) return;
  const w = sim.world;
  // Pick a land spot and a disaster that suits it.
  for (let tries = 0; tries < 30; tries++) {
    const i = rng.int(0, w.biome.length - 1);
    if (w.height[i]! < w.seaLevel) continue;
    const x = (i % w.w) + 0.5;
    const y = Math.floor(i / w.w) + 0.5;
    const b = w.biome[i]!;
    const pick: WrathPower =
      b === B.mountains || b === B.snowPeaks ? (rng.chance(0.5) ? "earthquake" : "volcano")
      : b === B.infernal ? "volcano"
      : b === B.savanna || b === B.desert ? (rng.chance(0.5) ? "drought" : "fire")
      : b === B.tundra || b === B.permafrost || b === B.taiga ? "blizzard"
      : b === B.forest || b === B.jungle ? (rng.chance(0.6) ? "lightning" : "fire")
      : (["lightning", "tornado", "flood", "plague"] as const)[rng.int(0, 3)]!;
    wrath(sim, pick, x, y, 2);
    sim.chronicle("natural", { what: pick }, quiet ? "why_quiet" : undefined);
    return;
  }
}

// Monsters that light fires (dragons, demons) call this.
export function breatheFire(sim: Sim, x: number, y: number, tx: number, ty: number) {
  sim.fx.push({ kind: "breath", x, y, r: 0, tx, ty });
  const w = sim.world;
  for (let n = 0; n < 3; n++) {
    const fx = Math.floor(tx + (sim.rng.chaos.next() - 0.5) * 2);
    const fy = Math.floor(ty + (sim.rng.chaos.next() - 0.5) * 2);
    if (fx >= 0 && fy >= 0 && fx < w.w && fy < w.h) ignite(sim, fy * w.w + fx);
  }
  eachUnit(sim, tx, ty, 1.5, (s) => {
    if (!SPECIES_INFO[sim.units.kind[s]!]!.fire) hurt(sim, s, 15, DEATH.fire);
  });
}
