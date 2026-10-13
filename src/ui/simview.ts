// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// What the main thread knows about the running sim: the last two frames, so
// units glide smoothly between ticks at any frame rate.
import { UNIT_STRIDE, type BuildingView, type Frame, type TownDetail, type TownView, type UnitDetail } from "../sim/protocol";
import type { Rect } from "../world/edit";
import type { World } from "../world/types";

export class SimView {
  frame: Frame | null = null;
  buildings: BuildingView[] = [];
  towns: TownView[] = [];
  selected: UnitDetail | null = null;
  town: TownDetail | null = null;
  private prev = new Map<number, number>(); // uid -> index into prevUnits
  private prevUnits: Float32Array = new Float32Array(0);
  private at = 0;
  private gap = 50;
  private mixed = new Float32Array(0);

  // Applies a frame. Returns the rectangle of tiles the sim changed, if any.
  receive(f: Frame, world: World | null): Rect | null {
    const now = performance.now();
    if (this.frame) {
      this.prev.clear();
      const u = this.frame.units;
      for (let i = 0; i < this.frame.count; i++) this.prev.set(u[i * UNIT_STRIDE]!, i);
      this.prevUnits = u;
      this.gap = Math.min(200, Math.max(16, now - this.at));
    }
    this.at = now;
    this.frame = f;
    if (f.buildings) this.buildings = f.buildings;
    if (f.townList) this.towns = f.townList;
    if (f.selected !== undefined) this.selected = f.selected;
    return world ? this.applyTiles(f.tiles, world) : null;
  }

  private applyTiles(tiles: Int32Array, world: World): Rect | null {
    if (!tiles.length) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < tiles.length; k += 3) {
      const i = tiles[k]!;
      world.biome[i] = tiles[k + 1]!;
      world.flags[i] = tiles[k + 2]!;
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { x0, y0, x1, y1 };
  }

  // Unit array with positions blended between the last two frames.
  units(now: number): Float32Array {
    const f = this.frame;
    if (!f) return this.mixed;
    const n = f.count * UNIT_STRIDE;
    if (this.mixed.length < n) this.mixed = new Float32Array(n * 2);
    const out = this.mixed;
    out.set(f.units.subarray(0, n));
    const t = Math.min(1, (now - this.at) / this.gap);
    if (t >= 1) return out;
    for (let i = 0; i < f.count; i++) {
      const o = i * UNIT_STRIDE;
      const p = this.prev.get(out[o]!);
      if (p === undefined) continue;
      const po = p * UNIT_STRIDE;
      const px = this.prevUnits[po + 1]!;
      const py = this.prevUnits[po + 2]!;
      // Skip the blend on long jumps, like a clone appearing or a teleport.
      if (Math.abs(px - out[o + 1]!) > 3 || Math.abs(py - out[o + 2]!) > 3) continue;
      out[o + 1] = px + (out[o + 1]! - px) * t;
      out[o + 2] = py + (out[o + 2]! - py) * t;
    }
    return out;
  }

  get count(): number {
    return this.frame?.count ?? 0;
  }

  // Nearest unit to a world point within r tiles, aiming a bit above the feet.
  nearest(x: number, y: number, r: number): number {
    const f = this.frame;
    if (!f) return 0;
    let best = 0;
    let bestD = r;
    for (let i = 0; i < f.count; i++) {
      const o = i * UNIT_STRIDE;
      const d = Math.hypot(f.units[o + 1]! - x, f.units[o + 2]! - 0.4 - y);
      if (d < bestD) {
        bestD = d;
        best = f.units[o]!;
      }
    }
    return best;
  }

  position(uid: number): [number, number] | null {
    const f = this.frame;
    if (!f) return null;
    for (let i = 0; i < f.count; i++) {
      const o = i * UNIT_STRIDE;
      if (f.units[o] === uid) return [f.units[o + 1]!, f.units[o + 2]!];
    }
    return null;
  }
}
