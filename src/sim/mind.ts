// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// How units decide and act (PLAN section 9). Needs rise over time, a utility
// score per action picks what to do, and each unit's small brain tilts the
// scores. Actions walk to a spot, take some ticks, then apply their effect.
import buildingData from "../../data/buildings.json";
import config from "../../data/sim.json";
import { B } from "../world/biomes";
import { FARM, ROAD } from "../world/types";
import { GROUP, HIDDEN, INPUTS, OUTPUTS, think } from "./brain";
import { G, PERSONALITY, STAT, stat, traitEffect } from "./genes";
import type { Building, Sim, Town } from "./sim";

import { isCiv, SPECIES_INFO } from "./species";
import { ACT, DEATH, JOB, NEED, NEEDS, type Act } from "./units";

const N = config.needs;
const T = config.town;
const EVERY = config.thinkEvery;
const TPY = config.ticksPerYear;
const DT = EVERY / TPY; // years per think

const input = new Float32Array(INPUTS);
const hidden = new Float32Array(HIDDEN);
const output = new Float32Array(OUTPUTS);

const TREES = new Set([B.forest, B.jungle, B.taiga, B.grove]);

export function thinkAll(sim: Sim) {
  const u = sim.units;
  const phase = sim.tick % EVERY;
  for (let s = phase; s < u.count; s += EVERY) {
    if (!u.alive[s]) continue;
    if (isCiv(u.kind[s]!)) thinkCiv(sim, s);
    else thinkAnimal(sim, s);
  }
}

// Needs

function riseNeeds(sim: Sim, s: number) {
  const u = sim.units;
  const g = u.genesOf(s);
  const o = s * NEEDS;
  const sleeping = u.act[s] === ACT.sleep && !u.paths[s];
  u.needs[o + NEED.hunger] = Math.min(1, u.needs[o + NEED.hunger]! + N.hungerPerYear * DT * (1 + traitEffect(g, "hunger")));
  u.needs[o + NEED.rest] = sleeping ? u.needs[o + NEED.rest]! : Math.min(1, u.needs[o + NEED.rest]! + N.restPerYear * DT);
  u.needs[o + NEED.social] = Math.min(1, u.needs[o + NEED.social]! + N.socialPerYear * DT);
  u.needs[o + NEED.faith] = Math.min(1, u.needs[o + NEED.faith]! + N.faithPerYear * DT * (stat(g, STAT.faith) / 10));
  u.needs[o + NEED.purpose] = Math.min(1, u.needs[o + NEED.purpose]! + N.purposePerYear * DT);
  u.needs[o + NEED.safety] = Math.max(0, u.needs[o + NEED.safety]! - N.safetyRecoverPerYear * DT);
  const starving = u.needs[o + NEED.hunger]! >= 1;
  u.starve[s] = starving ? u.starve[s]! + DT : Math.max(0, u.starve[s]! - DT);
}

// Threats

// A hungry predator that eats this kind, within r tiles. Returns its slot.
function findThreat(sim: Sim, s: number, r: number): number {
  const u = sim.units;
  const kind = u.kind[s]!;
  let threat = -1;
  sim.grid.query(u.x[s]!, u.y[s]!, r, (o) => {
    const info = SPECIES_INFO[u.kind[o]!]!;
    if (!info.meat || !info.prey.has(kind)) return false;
    if (Math.hypot(u.x[o]! - u.x[s]!, u.y[o]! - u.y[s]!) > r) return false;
    threat = o;
    return true;
  });
  return threat;
}

function countNear(sim: Sim, s: number, r: number, same: boolean): number {
  const u = sim.units;
  const kind = u.kind[s]!;
  let n = 0;
  sim.grid.query(u.x[s]!, u.y[s]!, r, (o) => {
    if (o !== s && (u.kind[o] === kind) === same && (same || isCiv(u.kind[o]!) === false)) n++;
  });
  return n;
}

// Civilized minds

function thinkCiv(sim: Sim, s: number) {
  const u = sim.units;
  riseNeeds(sim, s);
  const threat = findThreat(sim, s, 6);
  if (threat >= 0) u.setNeed(s, NEED.safety, 1);
  const busy = u.act[s] !== ACT.idle;
  if (busy && threat < 0) return;
  if (busy && (u.act[s] === ACT.flee || u.act[s] === ACT.fight)) return;

  const g = u.genesOf(s);
  const o = s * NEEDS;
  const town = sim.town(u.town[s]!);
  const home = u.home[s]! >= 0 ? sim.building(u.home[s]!) : undefined;
  const adult = u.age[s]! >= SPECIES_INFO[u.kind[s]!]!.adult;

  for (let i = 0; i < NEEDS; i++) input[i] = u.needs[o + i]!;
  input[6] = u.hp[s]! / sim.maxHp(s);
  input[7] = Math.min(1, countNear(sim, s, 6, true) / 5);
  input[8] = threat >= 0 ? 1 : 0;
  input[9] = u.carry[s] ? 1 : 0;
  input[10] = town ? Math.min(1, Math.hypot(u.x[s]! - town.x, u.y[s]! - town.y) / 30) : 1;
  input[11] = Math.sin(((sim.tick % config.dayTicks) / config.dayTicks) * Math.PI * 2);
  think(u.brainOf(s), input, hidden, output);
  const bias = (group: number) => 1 + 0.4 * output[group]!;
  const pers = (p: number) => g[G.personality + p]! / 255;

  const hunger = u.needs[o + NEED.hunger]!;
  const rest = u.needs[o + NEED.rest]!;
  let best: Act = ACT.wander;
  let bestScore = (0.15 + pers(PERSONALITY.curiosity) * 0.15) * bias(GROUP.explore);
  const consider = (act: Act, score: number) => {
    if (score > bestScore) {
      best = act;
      bestScore = score;
    }
  };

  if (threat >= 0) {
    const brave = pers(PERSONALITY.aggression) * 1.2 + stat(g, STAT.strength) / 20 - (adult ? 0 : 2);
    consider(ACT.fight, brave * bias(GROUP.fight));
    consider(ACT.flee, (1 + (1 - pers(PERSONALITY.aggression)) * 0.8) * bias(GROUP.flee));
  }
  consider(ACT.eat, hunger ** 1.5 * 2 * bias(GROUP.survive));
  consider(ACT.sleep, rest ** 1.5 * 1.6 * (input[11]! < -0.3 ? 1.3 : 1) * bias(GROUP.survive));
  consider(ACT.social, u.needs[o + NEED.social]! * 0.9 * bias(GROUP.social));
  if (town) {
    consider(ACT.pray, u.needs[o + NEED.faith]! * 0.7 * bias(GROUP.worship));
    if (adult && u.job[s]) consider(ACT.work, (0.35 + u.needs[o + NEED.purpose]! * 0.6) * bias(GROUP.work));
    if (adult && pendingBuilding(sim, town)) consider(ACT.build, (0.5 + pers(PERSONALITY.ambition) * 0.3) * bias(GROUP.build));
  } else {
    consider(ACT.settle, 1.5);
  }
  consider(ACT.explore, pers(PERSONALITY.curiosity) * 0.2 * bias(GROUP.explore));

  start(sim, s, best, threat, town, home);
}

function pendingBuilding(sim: Sim, town: Town): Building | undefined {
  return sim.buildings.find((b) => b.town === town.id && !b.done);
}

function start(sim: Sim, s: number, act: Act, threat: number, town: Town | undefined, home: Building | undefined) {
  const u = sim.units;
  const r = sim.rng.mind;
  u.act[s] = act;
  u.target[s] = 0;
  const x = u.x[s]!;
  const y = u.y[s]!;
  switch (act) {
    case ACT.flee: {
      const dx = x - u.x[threat]!;
      const dy = y - u.y[threat]!;
      const d = Math.hypot(dx, dy) || 1;
      return go(sim, s, x + (dx / d) * 7, y + (dy / d) * 7, 1);
    }
    case ACT.fight:
      u.target[s] = u.uid[threat]!;
      return go(sim, s, u.x[threat]!, u.y[threat]!, 60);
    case ACT.eat:
      if (town && town.food >= 1) return go(sim, s, town.x, town.y + 1, 10);
      return goForage(sim, s, 20);
    case ACT.sleep:
      if (home) return go(sim, s, home.x + home.w / 2, home.y + home.h, 50);
      if (town) return go(sim, s, town.x, town.y + 1, 50);
      return go(sim, s, x, y, 50);
    case ACT.pray:
      return go(sim, s, town!.x, town!.y + 1, 20);
    case ACT.social: {
      let mate = -1;
      sim.grid.query(x, y, 10, (o) => {
        if (o !== s && u.kind[o] === u.kind[s]) mate = o;
        return mate >= 0;
      });
      if (mate < 0) return go(sim, s, x + r.int(-4, 4), y + r.int(-4, 4), 10);
      u.target[s] = u.uid[mate]!;
      return go(sim, s, u.x[mate]!, u.y[mate]!, 20);
    }
    case ACT.work:
      return startWork(sim, s, town!);
    case ACT.build: {
      const b = pendingBuilding(sim, town!);
      if (!b) return idle(u, s);
      u.target[s] = b.id;
      return go(sim, s, b.x + b.w / 2, b.y + b.h, 30);
    }
    case ACT.settle:
      return startSettle(sim, s);
    case ACT.explore:
      return go(sim, s, x + r.int(-16, 16), y + r.int(-16, 16), 5);
    default: {
      const cx = town ? town.x : x;
      const cy = town ? town.y : y;
      return go(sim, s, cx + r.int(-6, 6), cy + r.int(-6, 6), 15);
    }
  }
}

function startWork(sim: Sim, s: number, town: Town) {
  const u = sim.units;
  const w = sim.world;
  // Carrying something: take it home first.
  if (u.carry[s]) return go(sim, s, town.x, town.y + 1, 5);
  switch (u.job[s]) {
    case JOB.farmer: {
      const farms = sim.buildings.filter((b) => b.town === town.id && b.type === "farm" && b.done);
      if (!farms.length) return goForage(sim, s, 30);
      const f = farms[sim.rng.mind.int(0, farms.length - 1)]!;
      return go(sim, s, f.x + sim.rng.mind.int(0, f.w - 1) + 0.5, f.y + sim.rng.mind.int(0, f.h - 1) + 0.5, 40);
    }
    case JOB.woodcutter: {
      const tree = nearestTile(sim, u.x[s]!, u.y[s]!, 14, (i) => TREES.has(w.biome[i]!));
      if (tree < 0) return goForage(sim, s, 30);
      return go(sim, s, (tree % w.w) + 0.5, Math.floor(tree / w.w) + 0.5, 30);
    }
    default:
      return goForage(sim, s, 30);
  }
}

function startSettle(sim: Sim, s: number) {
  const u = sim.units;
  const kind = u.kind[s]!;
  // A town of our people nearby? Walk there and join.
  let near: Town | undefined;
  let nearD = 30;
  for (const t of sim.towns) {
    if (!t.alive || t.race !== kind) continue;
    const d = Math.hypot(t.x - u.x[s]!, t.y - u.y[s]!);
    if (d < nearD) {
      near = t;
      nearD = d;
    }
  }
  if (near) return go(sim, s, near.x, near.y + 1, 1);
  // Settlers sent out by a town already carry a destination in tx, ty.
  return go(sim, s, u.tx[s]!, u.ty[s]!, 1);
}

function goForage(sim: Sim, s: number, ticks: number) {
  const u = sim.units;
  const w = sim.world;
  const spot = nearestTile(sim, u.x[s]!, u.y[s]!, 8, (i) => w.fertility[i]! > 60 && !(w.flags[i]! & ROAD));
  if (spot < 0) return go(sim, s, u.x[s]! + sim.rng.mind.int(-5, 5), u.y[s]! + sim.rng.mind.int(-5, 5), ticks);
  return go(sim, s, (spot % w.w) + 0.5, Math.floor(spot / w.w) + 0.5, ticks);
}

// Samples random tiles near a point and keeps the closest match. Cheap and
// spreads workers out instead of everyone queueing on one tree.
function nearestTile(sim: Sim, x: number, y: number, r: number, ok: (i: number) => boolean): number {
  const w = sim.world;
  const rng = sim.rng.mind;
  let best = -1;
  let bestD = Infinity;
  for (let n = 0; n < 24; n++) {
    const tx = Math.floor(x + rng.int(-r, r));
    const ty = Math.floor(y + rng.int(-r, r));
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
    const i = ty * w.w + tx;
    if (!ok(i)) continue;
    const d = Math.hypot(tx - x, ty - y);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function idle(u: Sim["units"], s: number) {
  u.act[s] = ACT.idle;
  u.actT[s] = 0;
  u.paths[s] = null;
}

// Plans a walk to (x, y), then `ticks` of doing the action there.
function go(sim: Sim, s: number, x: number, y: number, ticks: number) {
  const u = sim.units;
  const w = sim.world;
  const gx = Math.min(w.w - 1, Math.max(0, Math.floor(x)));
  const gy = Math.min(w.h - 1, Math.max(0, Math.floor(y)));
  const from = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
  const kind = u.kind[s]!;
  const path = sim.paths.find(from, gy * w.w + gx, (i) => sim.moveCost(kind, i), Math.hypot(gx - u.x[s]!, gy - u.y[s]!) > 20 ? 6000 : 1500);
  u.tx[s] = gx + 0.5;
  u.ty[s] = gy + 0.5;
  u.paths[s] = path && path.length ? path : null;
  u.pathAt[s] = 0;
  u.actT[s] = ticks;
}

// Animal minds

function thinkAnimal(sim: Sim, s: number) {
  const u = sim.units;
  const info = SPECIES_INFO[u.kind[s]!]!;
  const r = sim.rng.mind;
  if (info.meat) {
    u.needs[s * NEEDS + NEED.hunger] = Math.min(1, u.needs[s * NEEDS + NEED.hunger]! + N.hungerPerYear * 1.5 * DT);
    u.starve[s] = u.needs[s * NEEDS + NEED.hunger]! >= 1 ? u.starve[s]! + DT : 0;
  }
  if (u.act[s] === ACT.hunt || u.act[s] === ACT.flee) return;

  const threat = findThreat(sim, s, 5);
  if (threat >= 0) return start(sim, s, ACT.flee, threat, undefined, undefined);

  if (info.meat && u.needs[s * NEEDS + NEED.hunger]! > 0.5) {
    const prey = findPrey(sim, s, 12);
    if (prey >= 0) {
      u.act[s] = ACT.hunt;
      u.target[s] = u.uid[prey]!;
      return go(sim, s, u.x[prey]!, u.y[prey]!, 120);
    }
    // Lean times: scavenge, find berries and roots, eat what's around.
    if (r.chance(0.25)) u.setNeed(s, NEED.hunger, u.need(s, NEED.hunger) - 0.2);
  }
  if (u.act[s] !== ACT.idle) return;

  // Wander, preferring home biomes. Herds drift toward each other.
  const w = sim.world;
  let tx = u.x[s]! + r.int(-5, 5);
  let ty = u.y[s]! + r.int(-5, 5);
  if (info.herd) {
    let mate = -1;
    sim.grid.query(u.x[s]!, u.y[s]!, 8, (o) => {
      if (o !== s && u.kind[o] === u.kind[s]) mate = o;
      return mate >= 0;
    });
    if (mate >= 0) {
      tx = (tx + u.x[mate]!) / 2;
      ty = (ty + u.y[mate]!) / 2;
    }
  }
  const i = Math.floor(Math.min(w.h - 1, Math.max(0, ty))) * w.w + Math.floor(Math.min(w.w - 1, Math.max(0, tx)));
  if (!info.habitat.has(w.biome[i]!) && r.chance(0.7)) return;
  u.act[s] = ACT.wander;
  go(sim, s, tx, ty, 10 + r.int(0, 30));
}

function findPrey(sim: Sim, s: number, r: number): number {
  const u = sim.units;
  const info = SPECIES_INFO[u.kind[s]!]!;
  let prey = -1;
  let bestD = r;
  sim.grid.query(u.x[s]!, u.y[s]!, r, (o) => {
    if (!info.prey.has(u.kind[o]!)) return;
    // Villagers only get picked off when they're alone.
    if (isCiv(u.kind[o]!) && countNear(sim, o, 4, true) > 0) return;
    const d = Math.hypot(u.x[o]! - u.x[s]!, u.y[o]! - u.y[s]!);
    if (d < bestD) {
      prey = o;
      bestD = d;
    }
  });
  return prey;
}

// Movement and doing, every tick

export function moveAll(sim: Sim) {
  const u = sim.units;
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s]) continue;
    if (u.act[s] === ACT.fight || u.act[s] === ACT.hunt) {
      chase(sim, s);
      continue;
    }

    const path = u.paths[s];
    if (path) {
      walk(sim, s, path);
      continue;
    }
    if (u.act[s] === ACT.idle) continue;
    if (u.actT[s]! > 0) {
      u.actT[s]!--;
      if (u.actT[s]! > 0) continue;
    }
    finish(sim, s);
  }
}

function walk(sim: Sim, s: number, path: Int32Array) {
  const u = sim.units;
  const w = sim.world;
  const kind = u.kind[s]!;
  const info = SPECIES_INFO[kind]!;
  const at = u.pathAt[s]!;
  const next = path[at]!;
  const nx = (next % w.w) + 0.5;
  const ny = Math.floor(next / w.w) + 0.5;
  const here = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
  const cost = sim.moveCost(kind, next);
  if (cost === Infinity) {
    u.paths[s] = null; // the land changed under our feet
    return;
  }
  const g = u.genesOf(s);
  const speed = (info.speed * (1 + traitEffect(g, "speed")) * (0.85 + stat(g, STAT.agility) / 70)) / config.ticksPerSecond / cost;
  const dx = nx - u.x[s]!;
  const dy = ny - u.y[s]!;
  const d = Math.hypot(dx, dy);
  if (dx !== 0) u.facing[s] = dx < 0 ? 1 : 0;
  if (d <= speed) {
    u.x[s] = nx;
    u.y[s] = ny;
    u.pathAt[s] = at + 1;
    if (at + 1 >= path.length) u.paths[s] = null;
  } else {
    u.x[s]! += (dx / d) * speed;
    u.y[s]! += (dy / d) * speed;
  }
  const now = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
  if (now !== here) sim.stepOn(s, now);
}

// Keeps a fighter or hunter on its target: steer straight at it when close,
// follow a path when far, strike when touching.
function chase(sim: Sim, s: number) {
  const u = sim.units;
  const t = u.find(u.target[s]!);
  if (t < 0 || u.actT[s]! <= 0) return idle(u, s);
  u.actT[s]!--;
  const d = Math.hypot(u.x[t]! - u.x[s]!, u.y[t]! - u.y[s]!);
  if (d > 24) return idle(u, s);
  if (d < 1.1) {
    u.paths[s] = null;
    if ((sim.tick + s) % 10 === 0) strike(sim, s, t);
    return;
  }
  if (d < 5) {
    u.paths[s] = null;
    return steer(sim, s, u.x[t]!, u.y[t]!);
  }
  const path = u.paths[s];
  if (!path || (sim.tick + s) % 15 === 0) {
    const keep = u.actT[s]!;
    go(sim, s, u.x[t]!, u.y[t]!, keep);
  }
  if (u.paths[s]) walk(sim, s, u.paths[s]!);
}

// Moves straight toward a point if the next tile is passable.
function steer(sim: Sim, s: number, tx: number, ty: number) {
  const u = sim.units;
  const w = sim.world;
  const kind = u.kind[s]!;
  const dx = tx - u.x[s]!;
  const dy = ty - u.y[s]!;
  const d = Math.hypot(dx, dy) || 1;
  const g = u.genesOf(s);
  const step = (SPECIES_INFO[kind]!.speed * (1 + traitEffect(g, "speed"))) / config.ticksPerSecond;
  const nx = u.x[s]! + (dx / d) * step;
  const ny = u.y[s]! + (dy / d) * step;
  const i = Math.floor(ny) * w.w + Math.floor(nx);
  if (!sim.passable(kind, i)) return;
  const here = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
  u.x[s] = nx;
  u.y[s] = ny;
  u.facing[s] = dx < 0 ? 1 : 0;
  if (i !== here) sim.stepOn(s, i);
}

function strike(sim: Sim, s: number, t: number) {
  const u = sim.units;
  const g = u.genesOf(s);
  const info = SPECIES_INFO[u.kind[s]!]!;
  const armour = 1 - Math.min(0.6, traitEffect(u.genesOf(t), "armor"));
  const dodge = sim.rng.mind.chance(stat(u.genesOf(t), STAT.agility) / 80);
  if (dodge) return;
  const dmg = info.damage * (1 + stat(g, STAT.strength) / 40) * armour;
  u.hp[t]! -= dmg;
  // The victim fights back or runs.
  if (u.act[t] !== ACT.fight && u.act[t] !== ACT.flee) {
    u.act[t] = ACT.idle;
    u.paths[t] = null;
  }
  if (u.hp[t]! > 0) return;
  u.kills[s]!++;
  const cause = isCiv(u.kind[s]!) ? DEATH.battle : DEATH.monster;
  sim.kill(t, cause);
  if (info.meat) {
    u.setNeed(s, NEED.hunger, 0);
    u.starve[s] = 0;
  }
  idle(u, s);
}

function finish(sim: Sim, s: number) {
  const u = sim.units;
  const town = sim.town(u.town[s]!);
  const act = u.act[s];
  idle(u, s);
  switch (act) {
    case ACT.eat:
      if (town && town.food >= 1) {
        town.food -= 1;
        u.setNeed(s, NEED.hunger, 0);
      } else {
        u.setNeed(s, NEED.hunger, u.need(s, NEED.hunger) - 0.5);
      }
      return;
    case ACT.sleep:
      u.setNeed(s, NEED.rest, 0);
      return;
    case ACT.pray:
      u.setNeed(s, NEED.faith, 0);
      return;
    case ACT.social:
      return finishSocial(sim, s);
    case ACT.work:
      return town && finishWork(sim, s, town);
    case ACT.build:
      return town && finishBuild(sim, s);
    case ACT.settle:
      return finishSettle(sim, s);
    case ACT.flee:
      u.setNeed(s, NEED.safety, 0.5);
      return;
  }
}

function finishSocial(sim: Sim, s: number) {
  const u = sim.units;
  u.setNeed(s, NEED.social, 0);
  const o = u.find(u.target[s]!);
  if (o < 0 || Math.hypot(u.x[o]! - u.x[s]!, u.y[o]! - u.y[s]!) > 3) return;
  u.setNeed(o, NEED.social, 0);
  const info = SPECIES_INFO[u.kind[s]!]!;
  const single = (x: number) => !u.spouse[x] && u.age[x]! >= info.adult;
  if (u.sex[s] !== u.sex[o] && single(s) && single(o) && u.town[s] === u.town[o] && u.town[s]! > 0) {
    u.spouse[s] = u.uid[o]!;
    u.spouse[o] = u.uid[s]!;
    if (u.home[o]! >= 0) u.home[s] = u.home[o]!;
    else u.home[o] = u.home[s]!;
    sim.events.push({ t: "marry", a: u.uid[s]!, b: u.uid[o]!, tick: sim.tick });
  }
}

function finishWork(sim: Sim, s: number, town: Town) {
  const u = sim.units;
  const w = sim.world;
  u.setNeed(s, NEED.purpose, 0);
  if (u.carry[s]) {
    if (u.carry[s] === 1) town.food += 1;
    else town.wood += T.woodPerChop * 2;
    u.carry[s] = 0;
    return;
  }
  const i = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
  const skill = 0.7 + stat(u.genesOf(s), STAT.intelligence) / 40;
  if (u.job[s] === JOB.farmer && w.flags[i]! & FARM) {
    town.food += (T.foodPerFarmPerYear / T.farmPerPeople) * 0.6 * skill;
    return;
  }
  if (u.job[s] === JOB.woodcutter && TREES.has(w.biome[i]!)) {
    u.carry[s] = 2;
    if (SPECIES_INFO[u.kind[s]!]!.plantsTrees) return plantNear(sim, s);
    sim.chops[i]!++;
    if (sim.chops[i]! >= T.chopsToClear) {
      sim.chops[i] = 0;
      sim.setBiome(i, B.grassland);
    }
    return;
  }
  // Gathering berries and roots
  if (w.fertility[i]! > 60) u.carry[s] = 1;
}

// Elves never fell living trees; they plant new ones instead.
function plantNear(sim: Sim, s: number) {
  const w = sim.world;
  const u = sim.units;
  if (!sim.rng.mind.chance(0.25)) return;
  const spot = nearestTile(sim, u.x[s]!, u.y[s]!, 4, (i) => w.biome[i] === B.grassland && !sim.occ[i] && !(w.flags[i]! & (ROAD | FARM)));
  if (spot >= 0) sim.setBiome(spot, B.forest);
}

function finishBuild(sim: Sim, s: number) {
  const u = sim.units;
  const b = sim.building(u.target[s]!);
  u.setNeed(s, NEED.purpose, 0);
  if (!b || b.done) return;
  b.progress += 6 * (0.6 + stat(u.genesOf(s), STAT.strength) / 25);
  if (b.progress >= buildingData[b.type].work) sim.finish(b);
}

function finishSettle(sim: Sim, s: number) {
  const u = sim.units;
  const kind = u.kind[s]!;
  for (const t of sim.towns) {
    if (t.alive && t.race === kind && Math.hypot(t.x - u.x[s]!, t.y - u.y[s]!) < 8) {
      join(sim, s, t);
      return;
    }
  }
  // Found a town if there are enough of us here.
  let band = 0;
  sim.grid.query(u.x[s]!, u.y[s]!, 8, (o) => {
    if (u.kind[o] === kind && u.town[o]! < 0) band++;
  });
  if (band < T.foundMinPeople) {
    u.tx[s] = u.x[s]! + sim.rng.mind.int(-10, 10);
    u.ty[s] = u.y[s]! + sim.rng.mind.int(-10, 10);
    return;
  }
  const t = sim.foundTown(kind, u.x[s]!, u.y[s]!);
  if (t) join(sim, s, t);
}

export function join(sim: Sim, s: number, t: Town) {
  const u = sim.units;
  u.town[s] = t.id;
  u.home[s] = -1;
  t.pop++;
}

export { go as walkTo };
