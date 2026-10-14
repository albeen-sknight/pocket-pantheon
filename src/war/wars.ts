// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Wars (PLAN sections 11 and 13): checked yearly, declared from rivalry,
// holy causes or an ambitious ruler with the bigger army, and ended by
// conquest, razing or an exhausted truce.
import civ from "../../data/civ.json";
import war from "../../data/war.json";
import { relation } from "../civ/diplomacy";
import { hasTrait, kingdom } from "../civ/kingdoms";
import type { Kingdom } from "../civ/types";
import { G, PERSONALITY } from "../sim/genes";
import type { Sim } from "../sim/sim";
import { disband } from "./armies";

const D = war.declare;

export interface War {
  id: number;
  a: number; // attacker kingdom
  b: number;
  allies: { a: number[]; b: number[] };
  start: number; // tick
  end: number; // 0 while running
  result: "" | "conquest" | "razing" | "truce" | "peace";
  casualties: [number, number];
  battles: number;
  towns: [number, number]; // towns taken by each side
  startPop: [number, number];
  reason: string;
  log?: { year: number; a: number; b: number }[]; // battle deaths per year, by side
}

export function sideOf(w: War, kid: number): 0 | 1 | -1 {
  if (w.a === kid || w.allies.a.includes(kid)) return 0;
  if (w.b === kid || w.allies.b.includes(kid)) return 1;
  return -1;
}

// Fast "are these two kingdoms fighting" lookup, rebuilt when wars change.
export function rebuildWarPairs(sim: Sim) {
  const pairs = sim.civ.warPairs;
  pairs.clear();
  for (const w of sim.civ.wars) {
    if (w.end) continue;
    for (const x of [w.a, ...w.allies.a]) for (const y of [w.b, ...w.allies.b]) pairs.add(x < y ? `${x}:${y}` : `${y}:${x}`);
  }
}

export function atWar(sim: Sim, a: number, b: number): boolean {
  if (!a || !b || a === b) return false;
  return sim.civ.warPairs.has(a < b ? `${a}:${b}` : `${b}:${a}`);
}

export function activeWar(sim: Sim, a: number, b: number): War | undefined {
  return sim.civ.wars.find((w) => !w.end && sideOf(w, a) >= 0 && sideOf(w, b) >= 0 && sideOf(w, a) !== sideOf(w, b));
}

export function yearlyWars(sim: Sim) {
  const alive = sim.civ.kingdoms.filter((k) => k.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) maybeDeclare(sim, alive[i]!, alive[j]!);
  }
  for (const w of sim.civ.wars) if (!w.end) checkEnd(sim, w);
  peaceTooLong(sim);
}

function maybeDeclare(sim: Sim, a: Kingdom, b: Kingdom) {
  if (atWar(sim, a.id, b.id) || a.pop < D.minPeople || b.pop < D.minPeople) return;
  const ca = sim.town(a.capital);
  const cb = sim.town(b.capital);
  if (!ca || !cb || Math.hypot(ca.x - cb.x, ca.y - cb.y) > D.range) return;
  const rel = relation(sim, a.id, b.id);
  if (rel.state === "alliance") return;
  const r = sim.rng.civ;
  const hawk = hasTrait(a, "militaristic") || hasTrait(b, "militaristic") ? D.militaristic : 1;
  let reason = "";
  if (rel.opinion < D.rivalOpinion && r.chance(D.chance * hawk)) reason = "rivalry";
  else if (holyCause(sim, a, b) && r.chance(D.holyWar)) reason = "holy";
  else if (ambitious(sim, a) && a.pop > b.pop * 1.5 && sim.civ.borders.has(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`) && r.chance(D.ambition)) reason = "ambition";
  if (!reason) return;
  // The stronger side usually starts it.
  const [att, def] = a.pop >= b.pop ? [a, b] : [b, a];
  declareWar(sim, att.id, def.id, reason);
}

function holyCause(sim: Sim, a: Kingdom, b: Kingdom): boolean {
  if (!a.religion || !b.religion || a.religion === b.religion) return false;
  const conquest = civ.doctrines.indexOf("conquest");
  const fa = sim.civ.religions[a.religion - 1];
  const fb = sim.civ.religions[b.religion - 1];
  return !!(fa?.doctrines.includes(conquest) || fb?.doctrines.includes(conquest));
}

function ambitious(sim: Sim, k: Kingdom): boolean {
  const s = sim.units.find(k.ruler);
  return s >= 0 && sim.units.genesOf(s)[G.personality + PERSONALITY.ambition]! > 190;
}

export function declareWar(sim: Sim, a: number, b: number, reason: string): War | null {
  const ka = kingdom(sim, a);
  const kb = kingdom(sim, b);
  if (!ka || !kb || a === b || atWar(sim, a, b)) return null;
  const w: War = {
    id: sim.civ.wars.length + 1,
    a,
    b,
    allies: { a: [], b: [] },
    start: sim.tick,
    end: 0,
    result: "",
    casualties: [0, 0],
    battles: 0,
    towns: [0, 0],
    startPop: [ka.pop, kb.pop],
    reason,
  };
  // Allies answer the call if they like the side that asks.
  for (const k of sim.civ.kingdoms) {
    if (!k.alive || k.id === a || k.id === b) continue;
    const ra = relation(sim, k.id, a);
    const rb = relation(sim, k.id, b);
    if (rb.state === "alliance" && rb.opinion > D.allyJoinOpinion) w.allies.b.push(k.id);
    else if (ra.state === "alliance" && ra.opinion > D.allyJoinOpinion) w.allies.a.push(k.id);
  }
  sim.civ.wars.push(w);
  sim.civ.lastWar = sim.tick;
  rebuildWarPairs(sim);
  relation(sim, a, b).opinion = Math.min(relation(sim, a, b).opinion, -60);
  sim.chronicle("war", { a: ka.name, b: kb.name, reason });
  return w;
}

function checkEnd(sim: Sim, w: War) {
  const ka = kingdom(sim, w.a);
  const kb = kingdom(sim, w.b);
  if (!ka || !kb) return endWar(sim, w, "conquest", ka ? w.a : w.b);
  const years = (sim.tick - w.start) / sim.ticksPerYear;
  const tired = (side: 0 | 1) => w.casualties[side] > Math.max(6, w.startPop[side] * war.end.exhaustion);
  if (years >= war.end.truceYears || tired(0) || tired(1)) endWar(sim, w, "truce", 0);
}

export function endWar(sim: Sim, w: War, result: War["result"], winner: number) {
  if (w.end) return;
  w.end = sim.tick;
  w.result = result;
  for (const army of [...sim.civ.armies]) if (army.war === w.id) disband(sim, army);
  rebuildWarPairs(sim);
  const rel = relation(sim, w.a, w.b);
  rel.opinion = Math.max(rel.opinion, -20);
  const names = { a: sim.civ.kingdoms[w.a - 1]!.name, b: sim.civ.kingdoms[w.b - 1]!.name, winner: winner ? sim.civ.kingdoms[winner - 1]!.name : "" };
  sim.chronicle(result === "truce" || result === "peace" ? `war_${result}` : "war_won", names);
}

// The Director: 80 years of peace raises friction between the two biggest neighbours.
function peaceTooLong(sim: Sim) {
  const scale = sim.directorScale();
  if (!scale || sim.tick - sim.civ.lastWar < war.director.peaceYears * sim.ticksPerYear) return;
  const big = sim.civ.kingdoms.filter((k) => k.alive).sort((x, y) => y.pop - x.pop);
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = big[i]!;
      const b = big[j]!;
      const ca = sim.town(a.capital);
      const cb = sim.town(b.capital);
      if (!ca || !cb || Math.hypot(ca.x - cb.x, ca.y - cb.y) > D.range) continue;
      relation(sim, a.id, b.id).opinion -= war.director.friction * scale;
      sim.civ.lastWar = sim.tick; // once per 80 years, not every year after
      sim.chronicle("friction", { a: a.name, b: b.name }, "why_peace");
      return;
    }
  }
}
