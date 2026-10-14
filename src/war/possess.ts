// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Possess (PLAN section 14): the player drives one unit with its real stats
// and gear while the world keeps running around it.
import dis from "../../data/disasters.json";
import war from "../../data/war.json";
import { ignite } from "../chaos/hazards";
import { DEATH } from "../sim/units";
import { B } from "../world/biomes";
import { strikeAt } from "../sim/mind";
import type { Sim } from "../sim/sim";
import { SPECIES_INFO } from "../sim/species";
import { ACT, NEED } from "../sim/units";
import { STAT, stat } from "../sim/genes";

const P = war.possess;
const TREES = new Set([B.forest, B.jungle, B.taiga, B.grove]);

export interface PossessInput {
  dx: number; // minus 1 to 1
  dy: number;
  jump: boolean;
  attack: boolean;
  talk: boolean;
  interact: boolean;
}

export const NO_INPUT: PossessInput = { dx: 0, dy: 0, jump: false, attack: false, talk: false, interact: false };

export function possessTick(sim: Sim) {
  const u = sim.units;
  const s = u.find(sim.possessed);
  if (s < 0) {
    sim.possessed = 0;
    return;
  }
  const input = sim.input;
  u.act[s] = ACT.idle;
  u.paths[s] = null;
  // Their body still needs looking after, but not urgently.
  u.setNeed(s, NEED.hunger, Math.min(u.need(s, NEED.hunger), 0.7));

  if (sim.jump > 0) sim.jump--;
  const len = Math.hypot(input.dx, input.dy);
  if (len > 0.05) move(sim, s, input.dx / len, input.dy / len);
  const giant = SPECIES_INFO[u.kind[s]!]!.giant;
  if (giant) {
    if (input.jump && sim.jump === 0) stomp(sim, s);
    if (input.attack && (sim.tick + s) % P.attackEvery === 0) sweep(sim, s);
    if (input.interact) laser(sim, s, input.dx, input.dy);
  } else {
    if (input.jump && sim.jump === 0) jump(sim, s, input.dx, input.dy);
    if (input.attack && (sim.tick + s) % P.attackEvery === 0) attack(sim, s);
  }
  if (input.talk) {
    sim.fx.push({ kind: "talk", x: u.x[s]!, y: u.y[s]!, r: 0 });
    sim.input.talk = false;
  }
  if (input.interact) {
    if (!giant) interact(sim, s);
    sim.input.interact = false;
  }
}

function move(sim: Sim, s: number, dx: number, dy: number) {
  const u = sim.units;
  const w = sim.world;
  const kind = u.kind[s]!;
  const speed = (SPECIES_INFO[kind]!.speed * P.speedBonus * (0.85 + stat(u.genesOf(s), STAT.agility) / 70)) / sim.ticksPerSecond;
  const here = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
  const nx = Math.min(w.w - 0.01, Math.max(0, u.x[s]! + dx * speed));
  const ny = Math.min(w.h - 0.01, Math.max(0, u.y[s]! + dy * speed));
  const i = Math.floor(ny) * w.w + Math.floor(nx);
  if (dx) u.facing[s] = dx < 0 ? 1 : 0;
  if (sim.jump === 0 && !sim.passable(kind, i)) return;
  u.x[s] = nx;
  u.y[s] = ny;
  if (i !== here) sim.stepOn(s, i);
}

// A hop clears one tile of water or rock and dodges blows while airborne.
function jump(sim: Sim, s: number, dx: number, dy: number) {
  const u = sim.units;
  const w = sim.world;
  sim.jump = P.jumpTicks;
  const len = Math.hypot(dx, dy) || 1;
  const fx = dx ? dx / len : u.facing[s] ? -1 : 1;
  const fy = dy / len;
  const lx = u.x[s]! + fx * 2;
  const ly = u.y[s]! + fy * 2;
  const i = Math.floor(ly) * w.w + Math.floor(lx);
  if (lx >= 0 && ly >= 0 && lx < w.w && ly < w.h && sim.passable(u.kind[s]!, i)) {
    u.x[s] = lx;
    u.y[s] = ly;
  }
  sim.fx.push({ kind: "dust", x: u.x[s]!, y: u.y[s]!, r: 0.5 });
}

function attack(sim: Sim, s: number) {
  const u = sim.units;
  let target = -1;
  let d = 1.6;
  sim.grid.query(u.x[s]!, u.y[s]!, 2, (o) => {
    if (o === s) return;
    const od = Math.hypot(u.x[o]! - u.x[s]!, u.y[o]! - u.y[s]!);
    if (od < d) {
      d = od;
      target = o;
    }
  });
  if (target >= 0) strikeAt(sim, s, target);
}

// Clawzilla's moves (PLAN section 14): stomp, claw sweep, eye laser.
function stomp(sim: Sim, s: number) {
  const u = sim.units;
  const G = dis.giant;
  sim.jump = P.jumpTicks * 2;
  sim.fx.push({ kind: "stomp", x: u.x[s]!, y: u.y[s]!, r: G.stompRadius });
  hitAround(sim, s, u.x[s]!, u.y[s]!, G.stompRadius, G.stompDamage);
}

function sweep(sim: Sim, s: number) {
  const u = sim.units;
  const G = dis.giant;
  const dir = u.facing[s] ? -1 : 1;
  const cx = u.x[s]! + dir * 1.5;
  sim.fx.push({ kind: "dust", x: cx, y: u.y[s]!, r: G.sweepRadius });
  hitAround(sim, s, cx, u.y[s]!, G.sweepRadius, G.sweepDamage);
}

function laser(sim: Sim, s: number, dx: number, dy: number) {
  const u = sim.units;
  const G = dis.giant;
  const len = Math.hypot(dx, dy);
  const fx = len > 0.1 ? dx / len : u.facing[s] ? -1 : 1;
  const fy = len > 0.1 ? dy / len : 0;
  const x0 = u.x[s]!;
  const y0 = u.y[s]! - 1.5;
  sim.fx.push({ kind: "laser", x: x0, y: y0, r: 0, tx: x0 + fx * G.laserRange, ty: y0 + fy * G.laserRange });
  for (let d = 2; d <= G.laserRange; d += 1) {
    const x = x0 + fx * d;
    const y = y0 + 1.5 + fy * d;
    hitAround(sim, s, x, y, 0.8, G.laserDamage / 4);
    if (d % 3 === 0) ignite(sim, Math.floor(y) * sim.world.w + Math.floor(x));
  }
}

function hitAround(sim: Sim, s: number, x: number, y: number, r: number, dmg: number) {
  const u = sim.units;
  sim.grid.query(x, y, r, (o) => {
    if (o === s || Math.hypot(u.x[o]! - x, u.y[o]! - y) > r) return;
    u.hp[o]! -= dmg;
    if (u.hp[o]! <= 0) sim.kill(o, DEATH.monster);
  });
  for (const b of [...sim.buildings]) if (Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y) <= r + 0.5) sim.removeBuilding(b);
}

// Chop a tree, pray at a temple, or eat from the town stores, whichever is closest.
function interact(sim: Sim, s: number) {
  const u = sim.units;
  const w = sim.world;
  const town = sim.town(u.town[s]!);
  const x = Math.floor(u.x[s]!);
  const y = Math.floor(u.y[s]!);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * w.w + x + dx;
      if (i < 0 || i >= w.biome.length || !TREES.has(w.biome[i]!)) continue;
      if (town) town.wood += 2;
      sim.fx.push({ kind: "dust", x: x + dx + 0.5, y: y + dy + 0.5, r: 0.5 });
      return;
    }
  }
  const b = sim.buildings.find((o) => o.done && Math.hypot(o.x + o.w / 2 - u.x[s]!, o.y + o.h - u.y[s]!) < 2.5);
  if (b?.type === "temple") u.setNeed(s, NEED.faith, 0);
  if (b?.type === "hall" && town && town.food >= 1) {
    town.food -= 1;
    u.setNeed(s, NEED.hunger, 0);
  }
  if (b) sim.fx.push({ kind: "bless", x: u.x[s]!, y: u.y[s]!, r: 0.6 });
}
