// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Armies (PLAN section 13): the best fighters of a town gather under a
// general, march on an enemy town, besiege it, and come home when morale or
// numbers run out. The AI runs them unless the player gives an order.
import war from "../../data/war.json";
import { kingdom, kingdomOfTown } from "../civ/kingdoms";
import { STAT, stat } from "../sim/genes";
import { walkTo } from "../sim/mind";
import type { Sim, Town } from "../sim/sim";
import { RACES, SPECIES_INFO } from "../sim/species";
import { ACT, JOB } from "../sim/units";
import { activeWar, atWar, endWar, sideOf, type War } from "./wars";

const A = war.army;
const ORC = RACES.indexOf("orc");

export type Stance = "aggressive" | "defensive" | "hold";
export type ArmyState = "gather" | "march" | "siege" | "retreat" | "hold" | "defend";

export interface Army {
  id: number;
  kingdom: number;
  war: number;
  home: number; // town id
  name: string; // home town name
  general: number; // uid
  members: number[]; // uids
  x: number;
  y: number;
  target: { town: number; x: number; y: number };
  state: ArmyState;
  stance: Stance;
  morale: number;
  startSize: number;
  player: boolean; // following a player order, not the AI
  siege: number; // ticks with no defenders left at the target
}

export function army(sim: Sim, id: number): Army | undefined {
  return sim.civ.armies.find((a) => a.id === id);
}

// Who fights: adults sorted by Strength plus Agility, best first.
function fighters(sim: Sim, t: Town): number[] {
  const u = sim.units;
  const out: number[] = [];
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.town[s] !== t.id || u.army[s] || u.age[s]! < SPECIES_INFO[u.kind[s]!]!.adult) continue;
    out.push(s);
  }
  const g = (s: number) => stat(u.genesOf(s), STAT.strength) + stat(u.genesOf(s), STAT.agility);
  return out.sort((a, b) => g(b) - g(a) || a - b);
}

export function raiseArmy(sim: Sim, t: Town, w: War | null, share = A.share): Army | null {
  const k = kingdomOfTown(sim, t);
  if (!k) return null;
  const pool = fighters(sim, t);
  const n = Math.min(A.max, Math.max(A.min, Math.floor(pool.length * share)));
  if (pool.length < A.min) return null;
  const picked = pool.slice(0, n);
  const u = sim.units;
  const a: Army = {
    id: sim.civ.nextArmy++,
    kingdom: k.id,
    war: w?.id ?? 0,
    home: t.id,
    name: t.name,
    general: u.uid[picked[0]!]!,
    members: picked.map((s) => u.uid[s]!),
    x: t.x,
    y: t.y + 2,
    target: { town: 0, x: t.x, y: t.y + 2 },
    state: "gather",
    stance: "aggressive",
    morale: 80 + stat(u.genesOf(picked[0]!), STAT.charisma) * 0.5,
    startSize: picked.length,
    player: false,
    siege: 0,
  };
  for (const s of picked) {
    u.army[s] = a.id;
    u.job[s] = JOB.soldier;
  }
  sim.civ.armies.push(a);
  sim.chronicle("army", { name: a.name, kingdom: k.name, n: picked.length });
  return a;
}

export function disband(sim: Sim, a: Army) {
  const u = sim.units;
  for (const uid of a.members) {
    const s = u.find(uid);
    if (s < 0) continue;
    u.army[s] = 0;
    u.job[s] = JOB.gatherer;
    if (u.act[s] === ACT.march) u.act[s] = ACT.idle;
  }
  sim.civ.armies = sim.civ.armies.filter((o) => o !== a);
}

// Every orderEvery ticks: raise armies for wars that have none, then run each army.
export function updateArmies(sim: Sim) {
  for (const w of sim.civ.wars) {
    if (w.end) continue;
    for (const kid of [w.a, w.b]) {
      if (sim.civ.armies.some((a) => a.kingdom === kid && a.war === w.id)) continue;
      // Raise it from the kingdom's biggest town, which is usually the capital.
      let t: Town | undefined;
      for (const o of sim.towns) if (o.alive && o.kingdom === kid && (!t || o.pop > t.pop)) t = o;
      if (t) raiseArmy(sim, t, w);
    }
  }
  for (const a of [...sim.civ.armies]) runArmy(sim, a);
}

function runArmy(sim: Sim, a: Army) {
  const u = sim.units;
  a.members = a.members.filter((uid) => u.find(uid) >= 0);
  if (!a.members.length) return disband(sim, a);
  if (u.find(a.general) < 0) {
    a.general = a.members[0]!;
    a.morale = Math.min(100, a.morale + A.generalMorale);
  }
  let sx = 0;
  let sy = 0;
  for (const uid of a.members) {
    const s = u.find(uid);
    sx += u.x[s]!;
    sy += u.y[s]!;
  }
  a.x = sx / a.members.length;
  a.y = sy / a.members.length;
  a.morale = Math.min(100, a.morale + (A.moraleRecoverPerYear * A.orderEvery) / sim.ticksPerYear);

  const beaten = a.morale < A.retreatMorale || a.members.length < a.startSize * A.retreatStrength;
  if (beaten && a.state !== "retreat" && a.state !== "defend") {
    a.state = "retreat";
    a.player = false;
    const home = sim.town(a.home);
    a.target = { town: a.home, x: home?.x ?? a.x, y: (home?.y ?? a.y) + 2 };
    sim.chronicle("retreat", { name: a.name });
  }
  if (!a.player && a.state !== "retreat") aiOrders(sim, a);
  if (a.state === "retreat" && Math.hypot(a.x - a.target.x, a.y - a.target.y) < 4) return disband(sim, a);
  if (a.state === "siege" || (a.target.town && Math.hypot(a.x - a.target.x, a.y - a.target.y) < A.siegeRange)) siege(sim, a);
  if (a.state !== "hold") moveMembers(sim, a);
}

// The AI picks the nearest enemy town of any kingdom it's at war with.
function aiOrders(sim: Sim, a: Army) {
  const w = sim.civ.wars.find((x) => x.id === a.war);
  if (!w || w.end) return;
  let best: Town | undefined;
  let d = Infinity;
  for (const t of sim.towns) {
    if (!t.alive || !atWar(sim, a.kingdom, t.kingdom)) continue;
    const td = Math.hypot(t.x - a.x, t.y - a.y);
    if (td < d) {
      d = td;
      best = t;
    }
  }
  if (!best) return;
  if (a.state === "gather" || a.target.town !== best.id) a.state = "march";
  a.target = { town: best.id, x: best.x, y: best.y + 1 };
}

// Members walk to their slot in a loose block around the target.
function moveMembers(sim: Sim, a: Army) {
  const u = sim.units;
  const cols = Math.ceil(Math.sqrt(a.members.length));
  a.members.forEach((uid, i) => {
    const s = u.find(uid);
    if (u.act[s] === ACT.fight || u.act[s] === ACT.flee) return;
    const ox = ((i % cols) - cols / 2) * A.spread * 0.6;
    const oy = (Math.floor(i / cols) - cols / 2) * A.spread * 0.6;
    const tx = a.target.x + ox;
    const ty = a.target.y + oy;
    if (Math.hypot(u.x[s]! - tx, u.y[s]! - ty) < 1.5 && !u.paths[s]) return;
    u.act[s] = ACT.march;
    walkTo(sim, s, tx, ty, A.orderEvery * 2);
  });
}

// A town falls when no defender is left near its hall for a while.
function siege(sim: Sim, a: Army) {
  const t = sim.town(a.target.town);
  if (!t || !atWar(sim, a.kingdom, t.kingdom)) {
    a.state = a.player ? "hold" : "march";
    a.siege = 0;
    return;
  }
  a.state = "siege";
  const u = sim.units;
  let defenders = 0;
  sim.grid.query(t.x, t.y, 10, (s) => {
    if (u.kind[s]! < 4 && sim.town(u.town[s]!)?.kingdom === t.kingdom && u.age[s]! >= SPECIES_INFO[u.kind[s]!]!.adult) defenders++;
  });
  a.siege = defenders ? 0 : a.siege + A.orderEvery;
  if (a.siege < A.captureTicks) return;
  capture(sim, a, t);
}

function capture(sim: Sim, a: Army, t: Town) {
  const w = activeWar(sim, a.kingdom, t.kingdom);
  const victor = kingdom(sim, a.kingdom)!;
  const loser = kingdom(sim, t.kingdom);
  const side = w ? sideOf(w, a.kingdom) : 0;
  if (w && side !== -1) w.towns[side]++;
  // Conquerors of another race sometimes burn instead of rule; orcs twice as often.
  const raze = victor.race !== t.race && sim.rng.civ.chance(war.end.razeChance * (victor.race === ORC ? 2 : 1));
  if (raze) burn(sim, t);
  else {
    t.kingdom = victor.id;
    t.loyalty = 35;
  }
  sim.chronicle(raze ? "razed" : "conquered", { town: t.name, kingdom: victor.name, old: loser?.name ?? "" });
  a.siege = 0;
  a.target.town = 0;
  a.state = "march";
  sim.civ.ownerChanged = true;
  // Losing every town ends the war.
  if (w && loser && !sim.towns.some((o) => o.alive && o.kingdom === loser.id)) {
    loser.alive = false;
    endWar(sim, w, raze ? "razing" : "conquest", victor.id);
  }
}

// Buildings burn and the survivors scatter.
function burn(sim: Sim, t: Town) {
  for (const b of sim.buildings.filter((o) => o.town === t.id)) {
    sim.fx.push({ kind: "fire", x: b.x + b.w / 2, y: b.y + b.h / 2, r: 1.5 });
    sim.removeBuilding(b);
  }
  const u = sim.units;
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || u.town[s] !== t.id) continue;
    u.town[s] = -1;
    u.home[s] = -1;
    u.act[s] = ACT.idle;
  }
  t.alive = false;
  t.pop = 0;
}

export function moraleHit(sim: Sim, deadSlot: number) {
  const id = sim.units.army[deadSlot]!;
  const a = id ? army(sim, id) : undefined;
  if (a) a.morale -= A.moraleLossPerDeath;
}
