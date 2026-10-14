// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Draws every sprite once at load and packs them into one atlas canvas, padded
// so edges never bleed (PLAN section 6.2).
import { ANIMALS, RACES, RACE_COUNT } from "../sim/species";
import civ from "../../data/civ.json";
import creatures from "../../data/creatures.json";
import { ACTION_ICON, ANIMAL_ART, BANNER, BUILDING_ART, BUILDING_ICON, child, figure, FX_ICON, RACE_COLORS, raceFigure, skinCount } from "./art";
import { paletteIndex } from "./palette";
import { mk, shade, snap, type Draw } from "./sprites";

export interface Sprite {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 2;
const WIDTH = 1024;

export class Atlas {
  readonly canvas = document.createElement("canvas");
  readonly sprites: Sprite[] = [];
  private names = new Map<string, number>();
  private pending: { name: string; cv: HTMLCanvasElement }[] = [];

  // Index of a sprite by name.
  id(name: string): number {
    const i = this.names.get(name);
    if (i === undefined) throw new Error(`no sprite ${name}`);
    return i;
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  add(name: string, w: number, h: number, draw: Draw) {
    this.addCanvas(name, mk(w, h, draw, 1));
  }

  addCanvas(name: string, cv: HTMLCanvasElement) {
    this.names.set(name, this.names.size);
    this.pending.push({ name, cv });
  }

  // Solid squares for map markers, no outline.
  addDot(name: string, color: string, size: number) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    this.addCanvas(name, cv);
  }

  pack() {
    let x = PAD;
    let y = PAD;
    let row = 0;
    const order = this.pending.map((p, i) => i).sort((a, b) => this.pending[b]!.cv.height - this.pending[a]!.cv.height);
    const placed: Sprite[] = new Array(this.pending.length);
    for (const i of order) {
      const cv = this.pending[i]!.cv;
      if (x + cv.width + PAD > WIDTH) {
        x = PAD;
        y += row + PAD;
        row = 0;
      }
      placed[i] = { x, y, w: cv.width, h: cv.height };
      x += cv.width + PAD;
      row = Math.max(row, cv.height);
    }
    let height = 64;
    while (height < y + row + PAD) height *= 2;
    this.canvas.width = WIDTH;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d")!;
    this.pending.forEach((p, i) => ctx.drawImage(p.cv, placed[i]!.x, placed[i]!.y));
    this.sprites.push(...placed);
    this.pending = [];
  }
}

export interface SpriteSet {
  atlas: Atlas;
  unit(kind: number, flags: number, skin: number, frame: number): number;
  dot(kind: number): number;
  building(type: string, race: number, done: boolean): number;
  icon(type: string, race: number): number;
  town(race: number): number;
  action(icon: string): number;
  fx(name: string): number;
  ring: number;
  aura: number;
  banner: number;
  keyed: boolean;
}

// Cloth tint rows: 0 to 3 are each race's own colours, 4 onward the kingdom
// colours. Each row holds base, light, dark and outline palette indices.
export const RACE_TINT_ROWS = 4;

export function tintRamps(): Uint8Array {
  const colors = [...RACES.map((r) => creatures.races[r].cloth), ...civ.kingdomColors];
  const out = new Uint8Array(32 * 4);
  colors.forEach((c, i) => {
    out.set([paletteIndex(snap(c)), paletteIndex(shade(c, 0.22)), paletteIndex(shade(c, -0.25)), paletteIndex(shade(c, -0.6))], i * 4);
  });
  return out;
}

export function buildSprites(keyed = true): SpriteSet {
  const atlas = new Atlas();
  RACES.forEach((race) => {
    for (let skin = 0; skin < skinCount(race); skin++) {
      for (const female of [false, true]) {
        const fig = raceFigure(race, skin, female, keyed);
        for (const f of [0, 1]) atlas.add(`${race}.${skin}.${+female}.${f}`, 32, 30, figure(fig, f));
        for (const f of [0, 1]) atlas.add(`${race}.child.${skin}.${+female}.${f}`, 16, 18, child(fig, f));
      }
    }
    atlas.addDot(`dot.${race}`, RACE_COLORS[race], 3);
    atlas.add(`town.${race}`, 7, 7, (R, E, P, T) => {
      R(1, 3, 5, 4, "#f0d9a0");
      T(3, 0, 3, 3, RACE_COLORS[race]);
    });
    for (const type of Object.keys(BUILDING_ART)) {
      const art = BUILDING_ART[type]!;
      atlas.add(`b.${type}.${race}`, art.w, art.h, art.draw(race));
      atlas.add(`i.${type}.${race}`, 8, 8, BUILDING_ICON[type]!(race));
    }
  });
  for (const animal of ANIMALS) {
    const art = ANIMAL_ART[animal]!;
    for (const f of [0, 1]) atlas.add(`${animal}.${f}`, art.w, art.h, art.draw(f));
  }
  atlas.addDot("dot.animal", "#f0d9a0", 2);
  for (const [name, draw] of Object.entries(ACTION_ICON)) atlas.add(`act.${name}`, 7, 7, draw);
  atlas.add("ring", 18, 6, (R, E) => E(9, 3, 8.5, 2.5, "#f4f0e8"));
  atlas.add("aura", 20, 7, (R, E) => E(10, 3.5, 9.5, 3, "#f2c94c"));
  atlas.add("banner", 9, 16, BANNER);
  for (const [name, draw] of Object.entries(FX_ICON)) atlas.add(`fx.${name}`, 7, 7, draw);
  atlas.pack();

  // Lookup tables so the per frame code never builds strings.
  const unitTable: number[][] = [];
  for (let k = 0; k < RACE_COUNT; k++) {
    const race = RACES[k]!;
    const rows: number[] = [];
    for (let skin = 0; skin < 4; skin++) {
      const s = skin % skinCount(race);
      for (const female of [0, 1]) {
        for (const f of [0, 1]) rows.push(atlas.id(`${race}.${s}.${female}.${f}`));
        for (const f of [0, 1]) rows.push(atlas.id(`${race}.child.${s}.${female}.${f}`));
      }
    }
    unitTable.push(rows);
  }
  const animalTable = ANIMALS.map((a) => [atlas.id(`${a}.0`), atlas.id(`${a}.1`)]);
  const dots = RACES.map((r) => atlas.id(`dot.${r}`));
  const animalDot = atlas.id("dot.animal");
  const towns = RACES.map((r) => atlas.id(`town.${r}`));
  const buildings = new Map<string, number>();
  const icons = new Map<string, number>();
  RACES.forEach((race, k) => {
    for (const type of Object.keys(BUILDING_ART)) {
      buildings.set(`${type}.${k}`, atlas.id(`b.${type}.${race}`));
      icons.set(`${type}.${k}`, atlas.id(`i.${type}.${race}`));
    }
  });
  const actions = new Map(Object.keys(ACTION_ICON).map((n) => [n, atlas.id(`act.${n}`)]));

  return {
    atlas,
    unit(kind, flags, skin, frame) {
      if (kind >= RACE_COUNT) return animalTable[kind - RACE_COUNT]![frame]!;
      const female = flags & 4 ? 1 : 0;
      const isChild = flags & 2 ? 2 : 0;
      return unitTable[kind]![(skin & 3) * 8 + female * 4 + isChild + frame]!;
    },
    dot: (kind) => (kind < RACE_COUNT ? dots[kind]! : animalDot),
    building: (type, race, done) => buildings.get(`${done ? type : "site"}.${race}`) ?? buildings.get(`site.${race}`)!,
    icon: (type, race) => icons.get(`${type}.${race}`) ?? icons.get(`site.${race}`)!,
    town: (race) => towns[race]!,
    action: (name) => actions.get(name)!,
    fx: (name) => atlas.id(`fx.${name}`),
    ring: atlas.id("ring"),
    aura: atlas.id("aura"),
    banner: atlas.id("banner"),
    keyed,
  };
}
