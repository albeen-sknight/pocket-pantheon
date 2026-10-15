// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Turns the latest sim frame into a sorted list of sprite instances for the
// current zoom (PLAN section 6.3). Below Town zoom units become markers, so
// sprites are never shrunk.
import { BLESSED, COLOR_SHIFT, F, ICONS, ICON_SHIFT, UNIT_STRIDE, type ArmyView, type BuildingView, type Frame, type TownView } from "../sim/protocol";
import type { Fx } from "../sim/sim";
import { RACE_COUNT } from "../sim/species";
import { RACE_TINT_ROWS, type SpriteSet } from "./atlas";
import type { Camera } from "./camera";

// Per instance: screen x, screen y (top left, device px), sprite, scale, flip, tint row (-1 none)
export const INST = 6;

const FX_SPRITE: Record<string, string> = {
  rain: "drop", heal: "plus", fertility: "love", bounty: "eat", peace: "love", fire: "flame", dust: "dust",
  ash: "puff", plague: "germ", zombie: "germ", volcano: "puff", flood: "drop", blizzard: "snow", drought: "dust",
  acid: "acid", earthquake: "dust", stomp: "dust", breath: "flame",
};
// Effects drawn their own way below, not as scattered sparkles.
const SPECIAL_FX = new Set(["talk", "arrow", "lightning", "boom", "mushroom", "nuke", "laser", "beam", "breath", "tornado", "meteor"]);
const FX_LIFE = 1.4; // seconds

export class Scene {
  data = new Float32Array(INST * 4096);
  count = 0;
  private keys = new Float32Array(4096);
  private order = new Uint32Array(4096);
  private tmp = new Float32Array(INST * 4096);

  constructor(private set: SpriteSet) {}

  build(cam: Camera, units: Float32Array, n: number, buildings: BuildingView[], towns: TownView[], selected: number, time: number, fx: { fx: Fx; at: number }[] = [], armies: ArmyView[] = [], selectedArmy = 0, storms: Frame["storms"] = []) {
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
    // Army banners, readable from any zoom.
    for (const a of armies) {
      const bk = full ? k : scale >= 8 ? 2 : 1;
      put(a.x, a.y - (full ? 1.2 : 0), s.banner, bk, 0, 0.2, 1, a.y + 0.5, s.keyed ? RACE_TINT_ROWS + a.color : -1);
      if (a.id === selectedArmy) put(a.x, a.y, s.ring, bk, 0, 0.5, 0.5, a.y + 0.4);
      // siege engines trail the banner once the army gets close enough to see them
      if (a.engines && scale >= 8) {
        put(a.x - 1.6, a.y + 0.6, s.catapult, bk, 0, 0.5, 1, a.y + 0.6);
        put(a.x + 1.4, a.y + 0.7, s.ram, bk, 0, 0.5, 1, a.y + 0.7);
      }
    }
    // Storms: tornado funnels, acid clouds, smoke over eruptions, falling meteors.
    for (const st of storms) {
      const sk = Math.max(1, Math.min(4, Math.floor(scale / 8)));
      if (st.kind === "tornado") {
        put(st.x + Math.sin(time * 9) * 0.3, st.y, s.fx("tornado"), sk, Math.floor(time * 8) & 1, 0.5, 1, st.y + 0.5);
      } else if (st.kind === "acid") {
        for (let i = 0; i < 12; i++) {
          const a = i * 2.4 + time * 0.3;
          put(st.x + Math.cos(a) * st.r * 0.7, st.y + Math.sin(a) * st.r * 0.5 - 2, s.fx("acid"), sk, 0, 0.5, 0.5, 1e6);
        }
      } else if (st.kind === "eruption") {
        for (let i = 0; i < 6; i++) put(st.x + Math.sin(time * 2 + i) * 1.5, st.y - 2 - ((time * 2 + i) % 4), s.fx("puff"), sk, 0, 0.5, 0.5, 1e6);
      } else if (st.kind === "meteor") {
        const up = st.ticks * 0.9;
        put(st.x - up, st.y - up, s.fx("meteor"), sk, 0, 0.5, 0.5, 1e6);
      }
    }
    // Grace effects: sparkles scattered over the area, drifting up as they fade.
    const fk = Math.max(1, Math.min(4, Math.floor(scale / 8)));
    for (const { fx: f, at } of fx) {
      const age = time - at;
      if (age < 0 || age > FX_LIFE) continue;
      if (f.kind === "talk") continue; // shown as a speech bubble by the UI
      if (SPECIAL_FX.has(f.kind) && f.kind !== "arrow") {
        this.special(f, age, fk, put);
        continue;
      }
      if (f.kind === "boulder") {
        const p = Math.min(1, age / 0.9);
        if (p >= 1) continue;
        const bx = f.x + ((f.tx ?? f.x) - f.x) * p;
        const by = f.y + ((f.ty ?? f.y) - f.y) * p - Math.sin(p * Math.PI) * 3;
        put(bx, by, s.fx("boulder"), Math.max(1, k), 0, 0.5, 0.5, 1e6);
        continue;
      }
      if (f.kind === "arrow") {
        const p = Math.min(1, age / 0.35);
        if (p >= 1) continue;
        const ax = f.x + ((f.tx ?? f.x) - f.x) * p;
        const ay = f.y + ((f.ty ?? f.y) - f.y) * p - Math.sin(p * Math.PI) * 0.8;
        put(ax, ay, s.fx("arrow"), Math.max(1, k), (f.tx ?? f.x) < f.x ? 1 : 0, 0.5, 0.5, 1e6);
        continue;
      }
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

  // Bolts, explosions, the mushroom cloud, beams and dragon breath.
  private special(f: Fx, age: number, k: number, put: (x: number, y: number, sprite: number, sc: number, flip: number, ax?: number, ay?: number, sort?: number) => void) {
    const s = this.set;
    const line = (sprite: number, steps: number) => {
      const tx = f.tx ?? f.x;
      const ty = f.ty ?? f.y;
      for (let i = 0; i <= steps; i++) put(f.x + ((tx - f.x) * i) / steps, f.y + ((ty - f.y) * i) / steps, sprite, k, 0, 0.5, 0.5, 1e6);
    };
    switch (f.kind) {
      case "lightning":
        if (age < 0.35) put(f.x, f.y, s.fx("bolt"), k * 2, Math.floor(age * 20) & 1, 0.5, 1, 1e6);
        return;
      case "boom": {
        if (age > 1.2) return;
        const r = f.r * Math.min(1, age * 2.5);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          put(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r * 0.6, s.fx("flame"), k, 0, 0.5, 0.5, 1e6);
        }
        put(f.x, f.y, s.fx("ring"), k * 2, 0, 0.5, 0.5, 1e6);
        return;
      }
      case "mushroom":
        put(f.x, f.y - Math.min(1.4, age) * 3, s.fx("mushroom"), k * 3, 0, 0.5, 1, 1e6);
        return;
      case "laser":
        if (age < 0.4) line(s.fx("laser"), 24);
        return;
      case "breath":
        if (age < 0.5) line(s.fx("flame"), 6);
        return;
      case "beam":
        if (age < 1) put(f.x, f.y, s.fx("beam"), k, 0, 0.5, 1, 1e6);
        return;
    }
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
