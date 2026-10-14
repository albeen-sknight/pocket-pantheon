// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The hazard layer: fire, lava, floods, acid, ash, snow, drought and fallout
// sit on top of the tiles for a while, spread by their own rules, and leave
// the land changed when they go (PLAN sections 7 and 16).
import dis from "../../data/disasters.json";
import { B } from "../world/biomes";
import type { Sim } from "../sim/sim";
import { SPECIES_INFO } from "../sim/species";
import { DEATH } from "../sim/units";
import { FARM, LAKE } from "../world/types";

export const HAZ = { none: 0, fire: 1, lava: 2, flood: 3, acid: 4, ash: 5, snow: 6, drought: 7, fallout: 8 } as const;

const FLAMMABLE = new Set([B.grassland, B.forest, B.jungle, B.savanna, B.taiga, B.grove, B.mushroom, B.hills, B.haunted]);
// Stone buildings shrug off fire.
const STONE = new Set(["hall", "tower", "keep", "well", "mine", "temple"]);

export class Hazards {
  kind: Uint8Array;
  timer: Uint16Array; // ticks for fire, lava and floods; years for the rest
  before: Uint8Array; // biome to restore when fallout or acid heals, + 1
  active = new Set<number>(); // fire, lava and flood tiles, which act every few ticks
  lasting = new Set<number>(); // tiles counted down once a year
  changed = new Set<number>();

  constructor(tiles: number) {
    this.kind = new Uint8Array(tiles);
    this.timer = new Uint16Array(tiles);
    this.before = new Uint8Array(tiles);
  }

  set(i: number, kind: number, timer: number) {
    if (this.kind[i] === kind && this.timer[i]! >= timer) return;
    this.kind[i] = kind;
    this.timer[i] = timer;
    this.changed.add(i);
    const ticking = kind === HAZ.fire || kind === HAZ.lava || kind === HAZ.flood;
    if (ticking) {
      this.active.add(i);
      this.lasting.delete(i);
    } else if (kind) {
      this.lasting.add(i);
      this.active.delete(i);
    } else {
      this.active.delete(i);
      this.lasting.delete(i);
    }
  }

  clear(i: number) {
    this.set(i, HAZ.none, 0);
  }
}

export function ignite(sim: Sim, i: number) {
  const w = sim.world;
  if (i < 0 || i >= w.biome.length || w.height[i]! < w.seaLevel || w.flags[i]! & LAKE) return;
  const h = sim.hazards;
  if (h.kind[i] === HAZ.fire || h.kind[i] === HAZ.lava || h.kind[i] === HAZ.flood || h.kind[i] === HAZ.snow) return;
  h.set(i, HAZ.fire, dis.fire.burnTicks);
}

function neighbours(w: Sim["world"], i: number, fn: (j: number) => void) {
  const x = i % w.w;
  const y = Math.floor(i / w.w);
  if (x > 0) fn(i - 1);
  if (x < w.w - 1) fn(i + 1);
  if (y > 0) fn(i - w.w);
  if (y < w.h - 1) fn(i + w.w);
}

// Every few ticks: fire spreads and burns, lava flows and cools, floods recede.
export function tickHazards(sim: Sim) {
  if (sim.tick % dis.fire.spreadEvery) return;
  const h = sim.hazards;
  const w = sim.world;
  const r = sim.rng.chaos;
  const step = dis.fire.spreadEvery;
  for (const i of [...h.active]) {
    const kind = h.kind[i]!;
    h.timer[i] = Math.max(0, h.timer[i]! - step);
    if (kind === HAZ.fire) burn(sim, i, r.next());
    else if (kind === HAZ.lava) flow(sim, i);
    hurtUnitsOn(sim, i, kind);
    if (h.timer[i]! > 0) continue;
    if (kind === HAZ.fire) {
      // Burnt land lies as ash for 5 to 10 years, then grows back.
      const [lo, hi] = dis.fire.regrowYears as [number, number];
      h.set(i, HAZ.ash, r.int(lo, hi));
    } else if (kind === HAZ.lava) {
      h.clear(i);
      sim.setBiome(i, B.infernal);
    } else {
      h.clear(i);
      w.fertility[i] = Math.min(255, w.fertility[i]! + dis.flood.silt);
    }
  }
}

function burn(sim: Sim, i: number, roll: number) {
  const w = sim.world;
  const drought = sim.hazards.kind[i] === HAZ.drought ? 2 : 1;
  neighbours(w, i, (j) => {
    if (FLAMMABLE.has(w.biome[j]!) && sim.rng.chaos.chance(dis.fire.spread * drought)) ignite(sim, j);
  });
  const b = sim.occ[i] ? sim.building(sim.occ[i]!) : undefined;
  if (b && !STONE.has(b.type) && roll < dis.fire.buildingBurn) {
    sim.removeBuilding(b);
    sim.fx.push({ kind: "fire", x: b.x + b.w / 2, y: b.y + b.h / 2, r: 1 });
  }
  if (w.flags[i]! & FARM) sim.setTileFlag(i, FARM, false);
  // Burnt forest turns to grass; the forest creeps back later.
  if (w.biome[i] === B.forest || w.biome[i] === B.jungle || w.biome[i] === B.taiga) sim.setBiome(i, B.grassland);
}

// Lava runs downhill one tile at a time, lighting what it touches; water
// turns it to rock.
function flow(sim: Sim, i: number) {
  const w = sim.world;
  const h = sim.hazards;
  let low = -1;
  let lowH = w.height[i]!;
  neighbours(w, i, (j) => {
    if (w.height[j]! < w.seaLevel || w.flags[j]! & LAKE) {
      h.clear(i);
      sim.setBiome(i, B.mountains);
      return;
    }
    if (FLAMMABLE.has(w.biome[j]!)) ignite(sim, j);
    if (w.height[j]! < lowH && h.kind[j] !== HAZ.lava) {
      lowH = w.height[j]!;
      low = j;
    }
  });
  if (low >= 0 && h.kind[i] === HAZ.lava && sim.rng.chaos.chance(0.6)) h.set(low, HAZ.lava, Math.max(40, h.timer[i]! - 20));
  const b = sim.occ[i] ? sim.building(sim.occ[i]!) : undefined;
  if (b) sim.removeBuilding(b);
}

function hurtUnitsOn(sim: Sim, i: number, kind: number) {
  const w = sim.world;
  const u = sim.units;
  const x = (i % w.w) + 0.5;
  const y = Math.floor(i / w.w) + 0.5;
  const dmg = kind === HAZ.lava ? 50 : kind === HAZ.fire ? dis.fire.damagePerTick * dis.fire.spreadEvery : 0.5;
  sim.grid.query(x, y, 1, (s) => {
    if (Math.floor(u.x[s]!) !== i % w.w || Math.floor(u.y[s]!) !== Math.floor(i / w.w)) return;
    const info = SPECIES_INFO[u.kind[s]!]!;
    if (info.flies || (info.fire && kind !== HAZ.flood)) return;
    // Zombies burn easily.
    u.hp[s]! -= dmg * (info.undead ? 3 : 1) * (kind === HAZ.flood && info.swims ? 0 : 1);
    if (u.hp[s]! <= 0) sim.kill(s, kind === HAZ.flood ? DEATH.drowning : DEATH.fire);
  });
}

// Once a year: ash regrows, acid fades, fallout heals, droughts and snow pass.
export function yearlyHazards(sim: Sim) {
  const h = sim.hazards;
  const w = sim.world;
  for (const i of [...h.lasting]) {
    const kind = h.kind[i]!;
    if (kind === HAZ.fallout || kind === HAZ.acid) hurtUnitsOn(sim, i, kind);
    h.timer[i] = Math.max(0, h.timer[i]! - 1);
    if (h.timer[i]! > 0) continue;
    if (h.before[i]) {
      sim.setBiome(i, h.before[i]! - 1);
      h.before[i] = 0;
    }
    if (kind === HAZ.ash && w.biome[i] === B.grassland && w.moisture[i]! > 0.55) sim.setBiome(i, B.forest);
    h.clear(i);
  }
}

// Paints a lasting hazard over a disc, remembering the biome underneath when
// the hazard also changes it.
export function paintHazard(sim: Sim, x: number, y: number, r: number, kind: number, years: number, biome?: number) {
  const w = sim.world;
  for (let ty = Math.floor(y - r); ty <= y + r; ty++) {
    for (let tx = Math.floor(x - r); tx <= x + r; tx++) {
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || Math.hypot(tx - x, ty - y) > r) continue;
      const i = ty * w.w + tx;
      if (kind !== HAZ.snow && w.height[i]! < w.seaLevel) continue;
      if (biome !== undefined && w.height[i]! >= w.seaLevel) {
        if (!sim.hazards.before[i]) sim.hazards.before[i] = w.biome[i]! + 1;
        sim.setBiome(i, biome);
      }
      sim.hazards.set(i, kind, years);
    }
  }
}

export function hazardAt(sim: Sim, x: number, y: number): number {
  const w = sim.world;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return 0;
  return sim.hazards.kind[ty * w.w + tx]!;
}

