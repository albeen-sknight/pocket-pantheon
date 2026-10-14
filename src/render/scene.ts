// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Turns the latest sim frame into a sorted list of sprite instances for the
// current zoom (PLAN section 6.3). Below Town zoom units become markers, so
// sprites are never shrunk.
import { BLESSED, COLOR_SHIFT, F, ICONS, ICON_SHIFT, UNIT_STRIDE, type BuildingView, type TownView } from "../sim/protocol";
import type { Fx } from "../sim/sim";
import { RACE_COUNT } from "../sim/species";
import { RACE_TINT_ROWS, type SpriteSet } from "./atlas";
import type { Camera } from "./camera";

// Per instance: screen x, screen y (top left, device px), sprite, scale, flip, tint row (-1 none)
export const INST = 6;

const FX_SPRITE: Record<string, string> = { rain: "drop", heal: "plus", fertility: "love", bounty: "eat", peace: "love" };
const FX_LIFE = 1.4; // seconds

export class Scene {
  data = new Float32Array(INST * 4096);
  count = 0;
  private keys = new Float32Array(4096);
  private order = new Uint32Array(4096);
  private tmp = new Float32Array(INST * 4096);

  constructor(private set: SpriteSet) {}

  build(cam: Camera, units: Float32Array, n: number, buildings: BuildingView[], towns: TownView[], selected: number, time: number, fx: { fx: Fx; at: number }[] = []) {
    this.count = 0;
    const scale = cam.scale;
    const s = this.set;
    const full = scale >= 32;
    const region = scale >= 8 && !full;
    const k = full ? Math.max(1, Math.floor(scale / 32)) : region ? Math.max(1, Math.floor(scale / 8)) : 1;
    const margin = 96;

    const put = (wx: number, wy: number, sprite: number, sc: number, flip: number, ax = 0.5, ay = 1, sort = wy, tint = -1) => {
      const sp = s.atlas.sprites[sprite]!;
      const sx = Math.round((wx - cam.x) * scale - sp.w * sc * ax);
      const sy = Math.round((wy - cam.y) * scale - sp.h * sc * ay);
      if (sx > cam.viewW + margin || sy > cam.viewH + margin || sx + sp.w * sc < -margin || sy + sp.h * sc < -margin) return;
      this.ensure(this.count + 1);
      const o = this.count * INST;
      this.tmp[o] = sx;
      this.tmp[o + 1] = sy;
      this.tmp[o + 2] = sprite;
      this.tmp[o + 3] = sc;
      this.tmp[o + 4] = flip;
      this.tmp[o + 5] = tint;
      this.keys[this.count] = sort;
      this.count++;
    };

    if (!full && !region) {
      for (const t of towns) put(t.x, t.y, s.town(t.race), scale >= 3 ? 2 : 1, 0, 0.5, 0.5, t.y + 1000);
    } else {
      for (const b of buildings) {
        if (b.type === "farm" && b.done) continue; // the terrain draws the crops
        if (full) put(b.x + b.w / 2, b.y + b.h, s.building(b.type, b.race, b.done), k, 0, 0.5, 1, b.y + b.h - 0.01);
        else put(b.x + b.w / 2, b.y + b.h / 2, s.icon(b.done ? b.type : "site", b.race), k, 0, 0.5, 0.5, b.y);
      }
    }

    for (let i = 0; i < n; i++) {
      const o = i * UNIT_STRIDE;
      const kind = units[o + 3]!;
      if (!full && !region && kind >= RACE_COUNT) continue;
      const x = units[o + 1]!;
      const y = units[o + 2]!;
      const flags = units[o + 4]!;
      if (!full) {
        put(x, y, s.dot(kind), region ? Math.max(2, Math.floor(scale / 6)) : 1, 0, 0.5, 0.5, y);
        continue;
      }
      const uid = units[o]!;
      const moving = flags & F.moving;
      const frame = moving ? Math.floor(time * 6 + uid) & 1 : 0;
      const sprite = s.unit(kind, flags, (flags >> 8) & 3, frame);
      if (flags & BLESSED) put(x, y + 0.08, s.aura, k, 0, 0.5, 0.5, y - 0.002);
      if (uid === selected) put(x, y + 0.08, s.ring, k, 0, 0.5, 0.5, y - 0.001);
      const color = (flags >> COLOR_SHIFT) & 15;
      const tint = kind >= RACE_COUNT || !s.keyed ? -1 : color ? RACE_TINT_ROWS + color - 1 : kind;
      put(x, y, sprite, k, flags & F.left ? 1 : 0, 0.5, 1, y, tint);
      const icon = (flags >> ICON_SHIFT) & 15;
      if (icon) {
        const sp = s.atlas.sprites[sprite]!;
        put(x, y - (sp.h * k) / scale - 0.05, s.action(ICONS[icon]!), k, 0, 0.5, 1, y + 0.001);
      }
    }
    // Grace effects: sparkles scattered over the area, drifting up as they fade.
    const fk = Math.max(1, Math.min(4, Math.floor(scale / 8)));
    for (const { fx: f, at } of fx) {
      const age = time - at;
      if (age < 0 || age > FX_LIFE) continue;
      const sprite = s.fx(FX_SPRITE[f.kind] ?? "sparkle");
      const count = Math.min(40, Math.round(6 + f.r * f.r));
      for (let i = 0; i < count; i++) {
        const a = i * 2.39996;
        const d = Math.sqrt((i + 0.5) / count) * f.r;
        put(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d - age * 1.2, sprite, fk, 0, 0.5, 0.5, 1e6);
      }
    }
    this.sort();
  }

  private ensure(n: number) {
    if (n <= this.keys.length) return;
    const size = this.keys.length * 2;
    const keys = new Float32Array(size);
    keys.set(this.keys);
    this.keys = keys;
    const tmp = new Float32Array(size * INST);
    tmp.set(this.tmp);
    this.tmp = tmp;
    this.data = new Float32Array(size * INST);
    this.order = new Uint32Array(size);
  }

  // Painter's order: things lower on screen draw on top.
  private sort() {
    const n = this.count;
    const order = this.order.subarray(0, n);
    for (let i = 0; i < n; i++) order[i] = i;
    const keys = this.keys;
    order.sort((a, b) => keys[a]! - keys[b]!);
    for (let i = 0; i < n; i++) this.data.set(this.tmp.subarray(order[i]! * INST, order[i]! * INST + INST), i * INST);
  }
}
