// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Pixel art for units, animals and buildings, drawn in code with the sprite
// maker. The race figures and buildings are ported from the concept preview.
import creatures from "../../data/creatures.json";
import { RACES, type RaceKey } from "../sim/species";
import { KEY, type Draw } from "./sprites";

const K1 = "#2b2233";
const WH = "#f4f0e8";
const WOOD = "#8a5a36";
const STEEL = "#aab0bc";
const GOLD = "#f2c94c";

export interface Figure {
  skin: string;
  hair?: string;
  cloth: string;
  pants: string;
  weapon?: string;
  ears?: boolean;
  tusks?: boolean;
  beard?: string;
  helm?: string;
  long?: boolean; // longer hair
}

export function raceFigure(race: RaceKey, skin: number, female: boolean, keyed = false): Figure {
  const r = creatures.races[race] as (typeof creatures.races)[RaceKey] & { ears?: boolean; tusks?: boolean; beard?: boolean; helm?: string };
  return {
    skin: r.skin[skin % r.skin.length]!,
    hair: r.hair[skin % r.hair.length],
    cloth: keyed ? KEY.base : r.cloth,
    pants: r.pants,
    weapon: female && race !== "dwarf" ? undefined : r.weapon,
    ears: r.ears,
    tusks: r.tusks,
    beard: r.beard ? r.hair[skin % r.hair.length] : undefined,
    helm: female ? undefined : r.helm,
    long: female,
  };
}

export function skinCount(race: RaceKey): number {
  return creatures.races[race].skin.length;
}

// 32 x 30 figure from the preview; frame 1 swaps the legs for walking.
export function figure(o: Figure, frame: number): Draw {
  const b = o.beard ? 2 : 0;
  return (R, E, P) => {
    if (o.weapon === "bow") {
      [[24, 3, 2, 2], [26, 5, 1, 3], [27, 8, 1, 8], [26, 16, 1, 3], [24, 19, 2, 2]].forEach((a) => R(a[0]! + b, a[1]!, a[2]!, a[3]!, WOOD));
      R(25 + b, 5, 1, 16, WH);
    }
    if (o.weapon === "sword") { R(24 + b, 4, 2, 15, "#c3d3de"); R(22 + b, 18, 6, 2, GOLD); }
    if (o.weapon === "axe") { R(24 + b, 6, 2, 16, WOOD); R(22 + b, 3, 6, 6, "#8a8f9a"); }
    if (o.weapon === "hammer") { R(24 + b, 9, 2, 13, WOOD); R(21 + b, 5, 8, 6, "#8a8f9a"); }
    const lift = frame ? 1 : 0; // walking: the left foot comes up
    R(9, 22, 4, 6 - lift, o.pants);
    R(15, 22, 4, 6, o.pants);
    R(8, 27 - lift, 5, 2, "#4a3a2a");
    R(15, 27, 5, 2, "#4a3a2a");
    R(7 - b, 12, 14 + 2 * b, 11, o.cloth);
    R(7 - b, 18, 14 + 2 * b, 2, WOOD);
    R(13, 18, 2, 2, GOLD);
    R(4 - b, 13, 3, 7, o.cloth);
    R(21 + b, 13, 3, 7, o.cloth);
    R(4 - b, 19, 3, 3, o.skin);
    R(21 + b, 19, 3, 3, o.skin);
    if (o.ears) { R(7, 6, 2, 2, o.skin); P(6, 5, o.skin); R(19, 6, 2, 2, o.skin); P(21, 5, o.skin); }
    E(14, 7, 5, 5, o.skin);
    if (o.hair) {
      R(9, 1, 10, 3, o.hair);
      R(9, 3, 2, o.long ? 10 : 5, o.hair);
      if (o.long) R(17, 3, 2, 10, o.hair);
      else if (o.ears) R(18, 3, 2, 6, o.hair);
    }
    if (o.beard) { E(14, 12, 5, 4, o.beard); R(8, 12, 2, 8, o.beard); R(18, 12, 2, 8, o.beard); }
    if (o.helm) { R(8, 0, 12, 4, o.helm); R(13, 0, 2, 2, GOLD); }
    P(12, 7, K1);
    P(16, 7, K1);
    if (o.tusks) { P(12, 10, WH); P(16, 10, WH); }
  };
}

// Children: a 16 x 18 figure, same colours, no gear.
export function child(o: Figure, frame: number): Draw {
  return (R, E, P) => {
    const l = frame ? 1 : 0;
    R(5, 13 - l, 2, 4 + l, o.pants);
    R(9, 13, 2, 4 - l, o.pants);
    R(3, 7, 10, 7, o.cloth);
    R(1, 8, 2, 4, o.cloth);
    R(13, 8, 2, 4, o.cloth);
    E(8, 4, 4, 4, o.skin);
    if (o.hair) R(5, 0, 7, 2, o.hair);
    if (o.ears) { P(3, 3, o.skin); P(12, 3, o.skin); }
    P(6, 4, K1);
    P(10, 4, K1);
  };
}

type AnimalArt = { w: number; h: number; draw: (f: number) => Draw };
const legs = (R: Parameters<Draw>[0], xs: number[], y: number, h: number, c: string, f: number) =>
  xs.forEach((x, i) => R(x, y + ((i + f) % 2 ? 0 : 1), 2, h - ((i + f) % 2 ? 0 : 1), c));

export const ANIMAL_ART: Record<string, AnimalArt> = {
  sheep: { w: 32, h: 20, draw: (f) => (R, E, P) => {
    legs(R, [7, 11, 18, 22], 14, 5, "#3a2f55", f);
    E(14, 9, 10, 6, WH);
    [[8, 5], [14, 4], [20, 5]].forEach(([x, y]) => E(x!, y!, 4, 3, WH));
    E(26, 10, 3, 4, "#3a2f55");
    R(24, 5, 4, 2, "#3a2f55");
    P(27, 9, WH);
  } },
  cow: { w: 32, h: 22, draw: (f) => (R, E, P) => {
    legs(R, [6, 10, 19, 23], 15, 6, "#6b5a4a", f);
    R(3, 6, 22, 10, WH);
    R(7, 7, 6, 5, K1);
    R(17, 10, 5, 4, K1);
    E(27, 9, 4, 4, WH);
    R(29, 10, 3, 3, "#f08bb4");
    R(25, 4, 2, 2, "#d8f0f8");
    R(30, 4, 2, 2, "#d8f0f8");
    P(27, 8, K1);
  } },
  chicken: { w: 14, h: 14, draw: (f) => (R, E, P) => {
    R(5, 11, 1, 3 - f, "#f08a2c");
    R(8, 11, 1, 2 + f, "#f08a2c");
    E(6, 7, 5, 4, WH);
    E(10, 4, 3, 3, WH);
    R(9, 0, 2, 2, "#d9453d");
    R(12, 4, 2, 1, "#f08a2c");
    P(10, 3, K1);
  } },
  rabbit: { w: 16, h: 14, draw: (f) => (R, E, P) => {
    R(4, 10 + f, 3, 3 - f, "#b38d55");
    R(10, 10, 3, 3, "#b38d55");
    E(8, 7, 6, 4, "#d4a94e");
    E(12, 4, 3, 3, "#d4a94e");
    R(11, 0, 1, 3, "#d4a94e");
    R(13, 0, 1, 3, "#d4a94e");
    E(2, 7, 2, 2, WH);
    P(13, 4, K1);
  } },
  deer: { w: 30, h: 26, draw: (f) => (R, E, P) => {
    legs(R, [7, 10, 18, 21], 18, 7, "#8a5a36", f);
    E(14, 14, 10, 5, "#b38d55");
    E(14, 16, 7, 2, "#f0d9a0");
    R(22, 6, 4, 9, "#b38d55");
    E(25, 6, 3, 3, "#b38d55");
    R(22, 0, 1, 4, WOOD);
    R(26, 0, 1, 4, WOOD);
    R(21, 1, 3, 1, WOOD);
    R(25, 1, 3, 1, WOOD);
    P(26, 5, K1);
  } },
  wolf: { w: 34, h: 22, draw: (f) => (R, E, P) => {
    R(1, 6, 6, 3, "#8a8f9a");
    R(0, 4, 3, 3, "#8a8f9a");
    legs(R, [8, 12, 20, 24], 15, 6, "#6c7482", f);
    E(15, 11, 10, 5, "#8a8f9a");
    E(15, 14, 7, 2, "#c3d3de");
    E(26, 9, 4, 4, "#8a8f9a");
    R(24, 3, 2, 3, "#8a8f9a");
    R(28, 3, 2, 3, "#8a8f9a");
    R(29, 10, 4, 3, "#8a8f9a");
    P(32, 10, K1);
    P(27, 8, GOLD);
  } },
  bear: { w: 34, h: 26, draw: (f) => (R, E, P) => {
    legs(R, [7, 12, 20, 25], 18, 7, "#4a3a2a", f);
    E(16, 13, 13, 8, "#6b5a4a");
    E(28, 10, 5, 5, "#6b5a4a");
    E(31, 12, 2, 2, "#b38d55");
    E(26, 5, 2, 2, "#6b5a4a");
    E(31, 5, 2, 2, "#6b5a4a");
    P(29, 9, K1);
  } },
  fox: { w: 30, h: 18, draw: (f) => (R, E, P) => {
    E(4, 8, 5, 3, "#d9822b");
    R(0, 7, 2, 2, WH);
    legs(R, [10, 13, 19, 22], 12, 5, "#2b2233", f);
    E(16, 9, 8, 4, "#d9822b");
    E(16, 11, 5, 1, WH);
    E(25, 7, 4, 3, "#d9822b");
    R(23, 2, 2, 3, "#d9822b");
    R(27, 2, 2, 3, "#d9822b");
    R(28, 8, 2, 2, WH);
    P(26, 6, K1);
  } },
  camel: { w: 34, h: 30, draw: (f) => (R, E, P) => {
    legs(R, [8, 11, 20, 23], 20, 9, "#b38d55", f);
    E(16, 16, 11, 5, "#d4a94e");
    E(13, 11, 4, 4, "#d4a94e");
    E(20, 11, 4, 4, "#d4a94e");
    R(26, 6, 3, 10, "#d4a94e");
    E(29, 5, 4, 3, "#d4a94e");
    P(30, 4, K1);
  } },
  penguin: { w: 18, h: 24, draw: (f) => (R, E, P) => {
    R(5, 21, 4, 2 - f, "#f08a2c");
    R(10, 21, 4, 1 + f, "#f08a2c");
    E(9, 13, 6, 9, "#3a2f55");
    E(9, 15, 4, 7, WH);
    E(9, 5, 4, 4, "#3a2f55");
    R(8, 6, 3, 2, "#f08a2c");
    P(7, 4, WH);
    P(11, 4, WH);
  } },
  fish: { w: 18, h: 10, draw: (f) => (R, E, P) => {
    E(8, 5, 6, 3, "#5cc8e6");
    E(8, 6, 4, 1, "#d8f0f8");
    R(1, 2 + f, 3, 6 - f * 2, "#3b78d8");
    P(12, 4, K1);
  } },
  crab: { w: 34, h: 22, draw: (f) => (R, E, P) => {
    R(5, 15 + f, 5, 2, "#b5602a");
    R(4, 18, 5, 2, "#b5602a");
    R(25, 15, 5, 2, "#b5602a");
    R(26, 18 - f, 5, 2, "#b5602a");
    R(8, 9, 6, 2, "#d9453d");
    R(20, 9, 6, 2, "#d9453d");
    E(5, 6, 5, 4, "#d9453d");
    E(29, 6, 5, 4, "#d9453d");
    R(12, 5, 2, 5, "#d9453d");
    R(21, 5, 2, 5, "#d9453d");
    E(17, 13, 10, 6, "#d9453d");
    E(13, 4, 2, 2, WH);
    E(22, 4, 2, 2, WH);
    P(13, 4, K1);
    P(22, 4, K1);
  } },
  snake: { w: 26, h: 12, draw: (f) => (R, E, P) => {
    for (let x = 0; x < 20; x++) {
      const y = 5 + Math.round(Math.sin((x + f * 2) * 0.6) * 2);
      R(x, y, 1, 3, x % 4 < 2 ? "#3f9f3a" : "#7bc24a");
    }
    E(22, 6, 3, 2, "#3f9f3a");
    P(23, 5, GOLD);
    R(25, 7, 1, 1, "#d9453d");
  } },
  parrot: { w: 18, h: 20, draw: (f) => (R, E, P) => {
    R(8, 13, 2, 7, "#3b6fd4");
    E(9, 9, 5, 5, "#d9453d");
    R(3 - f, 7, 4, 5, f ? "#f2c94c" : "#3b6fd4");
    E(11, 4, 3, 3, "#d9453d");
    R(13, 4, 3, 2, "#f2c94c");
    P(11, 3, K1);
  } },
  horse: { w: 34, h: 30, draw: (f) => (R, E, P) => {
    R(2, 9, 3, 8, "#4a3a2a");
    legs(R, [8, 11, 21, 24], 19, 10, "#6b5a4a", f);
    E(16, 15, 11, 5, "#8a5a36");
    R(24, 4, 5, 11, "#8a5a36");
    R(25, 3, 8, 4, "#8a5a36");
    R(22, 3, 2, 9, "#4a3a2a");
    P(29, 4, K1);
  } },
};

// Monsters and specials (PLAN section 8). Dragon, slime, ghost, UFO and the
// giant crab come from the concept preview.
const humanoid = (skin: string, cloth: string, extra: (R: Parameters<Draw>[0], P: Parameters<Draw>[2]) => void): ((f: number) => Draw) => (f) => (R, E, P) => {
  const l = f ? 1 : 0;
  R(9, 22, 4, 6 - l, cloth);
  R(15, 22, 4, 6, cloth);
  R(7, 12, 14, 11, cloth);
  R(4, 13, 3, 8, skin);
  R(21, 13, 3, 8, skin);
  E(14, 7, 5, 5, skin);
  extra(R, P);
};

export const MONSTER_ART: Record<string, AnimalArt> = {
  dragon: { w: 50, h: 34, draw: (f) => (R, E, P) => {
    R(2, 21, 12, 4, "#d9453d");
    R(0, 19, 4, 3, "#d9453d");
    E(18, f ? 7 : 9, 9, 7, "#5a2a30");
    E(24, 19, 13, 7, "#d9453d");
    E(26, 22, 10, 3, GOLD);
    R(15, 24, 4, 8, "#d9453d");
    R(30, 24, 4, 8, "#d9453d");
    R(14, 31, 6, 2, WH);
    R(29, 31, 6, 2, WH);
    R(33, 8, 6, 12, "#d9453d");
    R(36, 4, 10, 7, "#d9453d");
    R(44, 6, 5, 4, "#d9453d");
    R(40, 10, 8, 2, "#d9453d");
    R(41, 5, 2, 2, GOLD);
    P(42, 6, K1);
    R(36, 1, 2, 4, WH);
    R(40, 1, 2, 3, WH);
    P(47, 7, K1);
  } },
  zombie: { w: 28, h: 30, draw: humanoid("#7bc24a", "#6b5a4a", (R, P) => { P(12, 7, "#d9453d"); P(16, 7, "#d9453d"); R(4, 13, 3, 3, "#6b5a4a"); R(22, 11, 4, 3, "#7bc24a"); }) },
  skeleton: { w: 28, h: 30, draw: humanoid("#f4f0e8", "#dfe9ef", (R, P) => { P(12, 7, K1); P(16, 7, K1); R(12, 10, 5, 1, K1); for (let y = 14; y < 22; y += 2) R(8, y, 12, 1, "#8a8f9a"); }) },
  ghost: { w: 20, h: 24, draw: (f) => (R, E) => {
    E(10, 9, 7, 7, "#dfe9ef");
    R(3, 9, 14, 10, "#dfe9ef");
    R(3, 19, 3, 3 + f, "#dfe9ef");
    R(8, 19, 4, 4 - f, "#dfe9ef");
    R(14, 19, 3, 3 + f, "#dfe9ef");
    R(7, 8, 2, 3, K1);
    R(12, 8, 2, 3, K1);
    R(9, 13, 2, 2, K1);
  } },
  demon: { w: 28, h: 32, draw: (f) => (R, E, P, T) => {
    humanoid("#d9453d", "#2b2233", () => {})(f)(R, E, P, T);
    R(8, 0, 2, 4, "#f4f0e8");
    R(18, 0, 2, 4, "#f4f0e8");
    P(12, 7, GOLD);
    P(16, 7, GOLD);
    R(22, 22, 5, 2, "#d9453d");
    R(25, 18, 2, 4, "#f08a2c");
  } },
  fairy: { w: 16, h: 16, draw: (f) => (R, E, P) => {
    E(4, 6, 3, f ? 4 : 3, "#d8f0f8");
    E(12, 6, 3, f ? 4 : 3, "#d8f0f8");
    E(8, 9, 2, 4, "#b58cf0");
    E(8, 4, 2, 2, "#e0b184");
    P(8, 1, GOLD);
  } },
  slime: { w: 22, h: 16, draw: (f) => (R, E) => {
    E(11, 9 + f, 10, 6 - f, "#7bc24a");
    R(1, 10, 20, 5, "#7bc24a");
    R(5, 4 + f, 3, 2, "#8fd88f");
    R(7, 7, 2, 3, K1);
    R(13, 7, 2, 3, K1);
    R(10, 11, 3, 1, K1);
  } },
  ice_golem: { w: 30, h: 32, draw: (f) => (R) => {
    const l = f ? 1 : 0;
    R(7, 24, 6, 8 - l, "#5cc8e6");
    R(17, 24, 6, 8, "#5cc8e6");
    R(5, 10, 20, 15, "#d8f0f8");
    R(0, 11, 5, 12, "#5cc8e6");
    R(25, 11, 5, 12, "#5cc8e6");
    R(9, 2, 12, 9, "#d8f0f8");
    R(11, 5, 2, 2, "#3b6fd4");
    R(17, 5, 2, 2, "#3b6fd4");
  } },
  sea_serpent: { w: 40, h: 22, draw: (f) => (R, E, P) => {
    for (let x = 0; x < 30; x++) {
      const y = 12 + Math.round(Math.sin((x + f * 3) * 0.4) * 4);
      R(x, y, 1, 4, x % 6 < 3 ? "#2f8f3a" : "#1f8f4a");
    }
    E(34, 9, 5, 4, "#2f8f3a");
    R(32, 4, 2, 4, GOLD);
    P(36, 8, "#d9453d");
  } },
  mutant: { w: 28, h: 30, draw: humanoid("#8fd14f", "#5a5f6b", (R, P) => { R(17, 3, 4, 4, "#8fd14f"); P(11, 7, K1); P(14, 6, K1); P(19, 5, K1); R(22, 14, 4, 2, "#8fd14f"); }) },
  clawzilla: { w: 102, h: 66, draw: (f) => (R, E) => {
    const k = 3;
    const r = (x: number, y: number, w: number, h: number, c: string) => R(x * k, y * k, w * k, h * k, c);
    r(5, 15 + f, 5, 2, "#b5602a");
    r(4, 18, 5, 2, "#b5602a");
    r(25, 15, 5, 2, "#b5602a");
    r(26, 18 - f, 5, 2, "#b5602a");
    r(8, 9, 6, 2, "#f08a2c");
    r(20, 9, 6, 2, "#f08a2c");
    E(5 * k, 6 * k, 5 * k, 4 * k, "#f08a2c");
    E(29 * k, 6 * k, 5 * k, 4 * k, "#f08a2c");
    r(12, 5, 2, 5, "#f08a2c");
    r(21, 5, 2, 5, "#f08a2c");
    E(17 * k, 13 * k, 10 * k, 6 * k, "#f08a2c");
    E(13 * k, 4 * k, 2 * k, 2 * k, WH);
    E(22 * k, 4 * k, 2 * k, 2 * k, WH);
    r(13, 4, 1, 1, K1);
    r(22, 4, 1, 1, K1);
    r(12, 6, 2, 3, GOLD);
    r(16, 5, 2, 3, GOLD);
    r(20, 6, 2, 3, GOLD);
  } },
  ufo: { w: 32, h: 20, draw: (f) => (R, E) => {
    E(16, 6, 6, 5, "#5cc8e6");
    E(16, 11, 14, 4, "#8a8f9a");
    [5, 11, 16, 21, 27].forEach((x, i) => R(x, 11, 2, 2, (i + f) % 2 ? GOLD : "#f08a2c"));
  } },
  guardian: { w: 60, h: 80, draw: (f) => (R, E) => {
    const l = f ? 2 : 0;
    R(14, 56, 12, 24 - l, "#6c7482");
    R(34, 56, 12, 24, "#6c7482");
    R(10, 22, 40, 36, "#8a8f9a");
    R(0, 24, 10, 30, "#6c7482");
    R(50, 24, 10, 30, "#6c7482");
    R(18, 2, 24, 22, "#aab0bc");
    R(22, 10, 5, 4, "#5cc8e6");
    R(33, 10, 5, 4, "#5cc8e6");
    R(24, 36, 12, 8, "#5a5f6b");
    E(30, 40, 4, 3, "#5cc8e6");
  } },
};

// Effects for disasters, 7 to 40 pixels.
export const CHAOS_FX: Record<string, { w: number; h: number; draw: Draw }> = {
  bolt: { w: 9, h: 40, draw: (R) => {
    const zig = [[4, 0], [2, 6], [5, 12], [2, 18], [6, 24], [3, 30], [5, 36]];
    zig.forEach(([x, y]) => R(x!, y!, 2, 7, GOLD));
    zig.forEach(([x, y]) => R(x!, y! + 2, 1, 3, WH));
  } },
  meteor: { w: 18, h: 18, draw: (R, E) => {
    R(0, 0, 4, 4, "#f2c94c");
    R(3, 3, 4, 4, "#f08a2c");
    R(6, 6, 3, 3, "#d9453d");
    E(13, 13, 4.5, 4.5, "#6b5a4a");
    E(12, 12, 2, 2, "#8a8f9a");
  } },
  flame: { w: 7, h: 9, draw: (R) => { R(2, 0, 3, 9, "#f08a2c"); R(1, 3, 5, 6, "#d9453d"); R(3, 2, 1, 5, GOLD); } },
  puff: { w: 10, h: 8, draw: (R, E) => { E(5, 4, 4.5, 3.5, "#8a8f9a"); E(4, 3, 2, 1.5, "#aab0bc"); } },
  acid: { w: 12, h: 8, draw: (R, E) => { E(6, 4, 5.5, 3.5, "#7bc24a"); E(5, 3, 2.5, 1.5, "#8fd88f"); } },
  snow: { w: 5, h: 5, draw: (R) => { R(2, 0, 1, 5, WH); R(0, 2, 5, 1, WH); } },
  mushroom: { w: 40, h: 46, draw: (R, E) => {
    R(16, 20, 8, 26, "#aab0bc");
    E(20, 14, 18, 11, "#f08a2c");
    E(20, 12, 14, 8, "#f2c94c");
    E(20, 10, 8, 4, WH);
    R(8, 40, 24, 6, "#8a8f9a");
  } },
  ring: { w: 30, h: 16, draw: (R, E) => { E(15, 8, 14, 7, "#f4f0e8"); E(15, 8, 11, 5, "#f2c94c"); E(15, 8, 8, 3, "#f08a2c"); } },
  beam: { w: 12, h: 40, draw: (R) => { R(2, 0, 8, 40, "#f2e8a0"); R(4, 0, 4, 40, "#f4f0e8"); } },
  tornado: { w: 18, h: 30, draw: (R) => {
    for (let y = 0; y < 30; y += 3) {
      const w = Math.max(3, 18 - y * 0.5);
      R(Math.round(9 - w / 2 + Math.sin(y * 0.6) * 2), y, Math.round(w), 2, y % 6 ? "#aab0bc" : "#8a8f9a");
    }
  } },
  laser: { w: 6, h: 6, draw: (R) => { R(0, 1, 6, 4, "#d9453d"); R(0, 2, 6, 2, "#f4f0e8"); } },
  germ: { w: 7, h: 7, draw: (R, E) => { E(3, 3, 3, 3, "#7bc24a"); R(2, 2, 1, 1, K1); } },
};

// Building colours per race: walls, roof, trim
const LOOK: Record<RaceKey, { wall: string; roof: string; trim: string; flag: string }> = {
  human: { wall: "#d8b98a", roof: "#b5483a", trim: "#8a5a36", flag: "#3b6fd4" },
  elf: { wall: "#8a5a36", roof: "#2f8f3a", trim: "#5fbf4a", flag: "#2f8f3a" },
  orc: { wall: "#6b5a4a", roof: "#b38d55", trim: "#5a2a30", flag: "#d9453d" },
  dwarf: { wall: "#aab0bc", roof: "#5a5f6b", trim: "#8a8f9a", flag: "#f2c94c" },
};

export const BUILDING_ART: Record<string, { w: number; h: number; draw: (race: RaceKey) => Draw }> = {
  hall: { w: 62, h: 48, draw: (race) => {
    const k = LOOK[race];
    const stone = race === "dwarf" || race === "human" ? "#aab0bc" : k.wall;
    return (R) => {
      R(20, 16, 22, 30, stone);
      R(2, 20, 15, 26, "#8a8f9a");
      R(45, 20, 15, 26, "#8a8f9a");
      [2, 8, 13, 20, 26, 32, 38, 45, 51, 56].forEach((x) => R(x, x < 18 || x > 44 ? 15 : 11, 4, 5, "#6c7482"));
      R(30, 2, 1, 10, "#c3d3de");
      R(31, 2, 8, 5, k.flag);
      R(26, 32, 10, 14, "#3a2f55");
      R(8, 28, 3, 6, K1);
      R(51, 28, 3, 6, K1);
    };
  } },
  house: { w: 40, h: 32, draw: (race) => {
    const k = LOOK[race];
    return (R, E, P, T) => {
      R(28, 3, 4, 8, "#8a8f9a");
      R(7, 14, 26, 16, k.wall);
      for (let x = 10; x < 32; x += 4) R(x, 15, 1, 14, k.trim);
      T(20, 2, 19, 12, k.roof);
      R(17, 21, 6, 9, k.trim);
      R(10, 18, 4, 4, "#5cc8e6");
      R(26, 18, 4, 4, "#5cc8e6");
    };
  } },
  lumber: { w: 44, h: 30, draw: (race) => {
    const k = LOOK[race];
    return (R, E, P, T) => {
      R(4, 10, 18, 18, k.wall);
      T(13, 2, 11, 9, k.roof);
      R(10, 18, 6, 10, k.trim);
      for (let i = 0; i < 3; i++) {
        R(25, 16 + i * 4, 16, 3, WOOD);
        E(41, 17.5 + i * 4, 1.5, 1.5, "#d4a94e");
      }
      R(30, 4, 2, 10, WOOD);
      R(27, 3, 6, 4, "#8a8f9a");
    };
  } },
  well: { w: 24, h: 26, draw: (race) => {
    const k = LOOK[race];
    return (R, E, P, T) => {
      R(3, 16, 18, 8, "#8a8f9a");
      R(5, 17, 14, 2, "#3b78d8");
      R(4, 6, 2, 11, WOOD);
      R(18, 6, 2, 11, WOOD);
      T(12, 0, 11, 7, k.roof);
      R(11, 7, 2, 6, "#6b5a4a");
    };
  } },
  // Temple, smithy and mine come from the concept preview.
  temple: { w: 46, h: 40, draw: () => (R, E, P, T) => {
    R(2, 34, 42, 4, "#c3d3de");
    [6, 15, 25, 34].forEach((x) => R(x, 19, 4, 15, "#f4f0e8"));
    R(4, 16, 38, 3, "#dfe9ef");
    T(23, 5, 22, 11, "#f0d9a0");
    R(21, 1, 4, 4, GOLD);
    R(19, 24, 8, 10, "#3a2f55");
  } },
  smithy: { w: 40, h: 34, draw: (race) => {
    const k = LOOK[race];
    return (R, E, P, T) => {
      R(29, 0, 5, 9, "#5a5f6b");
      R(4, 14, 32, 18, "#8a8f9a");
      T(20, 6, 20, 9, k.roof);
      R(8, 22, 9, 9, "#f08a2c");
      R(10, 24, 5, 5, GOLD);
      R(24, 27, 9, 3, K1);
      R(25, 24, 5, 3, "#5a5f6b");
    };
  } },
  mine: { w: 42, h: 30, draw: () => (R, E, P) => {
    E(21, 28, 20, 22, "#8a8f9a");
    E(14, 12, 8, 5, "#aab0bc");
    R(14, 18, 14, 12, K1);
    R(12, 16, 18, 3, WOOD);
    R(12, 18, 2, 12, WOOD);
    R(28, 18, 2, 12, WOOD);
    P(32, 14, "#5cc8e6");
    P(8, 18, GOLD);
    P(34, 20, GOLD);
    R(18, 25, 7, 3, "#6c7482");
  } },
  market: { w: 44, h: 30, draw: (race) => {
    const k = LOOK[race];
    return (R) => {
      for (const x of [2, 24]) {
        R(x, 8, 18, 5, k.roof);
        R(x, 13, 2, 14, WOOD);
        R(x + 16, 13, 2, 14, WOOD);
        R(x + 2, 20, 14, 7, k.trim);
      }
      R(6, 17, 4, 3, "#e8c46a");
      R(12, 17, 3, 3, "#d9453d");
      R(28, 17, 4, 3, "#5fbf4a");
      R(34, 17, 4, 3, "#b38d55");
    };
  } },
  library: { w: 42, h: 40, draw: (race) => {
    const k = LOOK[race];
    return (R, E, P, T) => {
      R(4, 16, 34, 22, k.wall);
      T(21, 2, 20, 15, k.roof);
      R(18, 26, 6, 12, k.trim);
      for (const x of [8, 28]) {
        R(x, 20, 6, 6, "#5cc8e6");
        R(x + 2, 20, 1, 6, k.trim);
      }
      R(19, 8, 4, 4, GOLD);
    };
  } },
  tower: { w: 22, h: 46, draw: (race) => {
    const k = LOOK[race];
    const stone = race === "elf" || race === "orc" ? k.wall : "#aab0bc";
    return (R) => {
      R(9, 0, 1, 7, "#c3d3de");
      R(10, 1, 6, 4, k.flag);
      R(3, 12, 16, 32, stone);
      [1, 8, 15].forEach((x) => R(x, 7, 5, 6, stone));
      R(1, 12, 20, 3, "#8a8f9a");
      R(9, 21, 4, 6, K1);
      R(8, 36, 6, 8, WOOD);
    };
  } },
  barracks: { w: 48, h: 34, draw: (race) => {
    const k = LOOK[race];
    return (R, E, P, T) => {
      R(4, 14, 40, 18, k.wall);
      T(24, 4, 22, 11, k.roof);
      R(20, 22, 8, 10, k.trim);
      for (const x of [8, 34]) {
        R(x, 18, 1, 12, WOOD);
        R(x - 2, 17, 5, 2, "#c3d3de");
      }
      R(40, 2, 1, 12, WOOD);
      R(41, 2, 6, 4, k.flag);
    };
  } },
  keep: { w: 78, h: 60, draw: (race) => {
    const k = LOOK[race];
    return (R) => {
      R(24, 14, 30, 44, "#aab0bc");
      R(2, 24, 20, 34, "#8a8f9a");
      R(56, 24, 20, 34, "#8a8f9a");
      for (let x = 2; x < 76; x += 6) R(x, x < 22 || x > 54 ? 19 : 9, 4, 5, "#6c7482");
      R(38, 0, 1, 12, "#c3d3de");
      R(39, 0, 10, 6, k.flag);
      R(32, 40, 14, 18, "#3a2f55");
      R(10, 34, 3, 7, K1);
      R(65, 34, 3, 7, K1);
      R(36, 24, 6, 6, K1);
    };
  } },
  site: { w: 40, h: 30, draw: () => (R) => {
    R(2, 26, 36, 3, "#b38d55");
    R(4, 6, 2, 21, WOOD);
    R(34, 6, 2, 21, WOOD);
    R(4, 6, 32, 2, WOOD);
    R(4, 16, 32, 2, WOOD);
    for (let x = 8; x < 33; x += 6) R(x, 8, 1, 18, "#d4a94e");
    R(14, 20, 12, 6, "#aab0bc");
  } },
};

// Small icons for Region zoom, 8 x 8.
export const BUILDING_ICON: Record<string, (race: RaceKey) => Draw> = {
  hall: (race) => (R) => { R(1, 2, 6, 6, "#aab0bc"); R(3, 0, 1, 3, WH); R(4, 0, 3, 2, LOOK[race].flag); },
  house: (race) => (R, E, P, T) => { R(1, 4, 6, 4, LOOK[race].wall); T(4, 0, 4, 4, LOOK[race].roof); },
  lumber: () => (R) => { R(0, 3, 8, 2, WOOD); R(0, 6, 8, 2, WOOD); },
  well: () => (R) => { R(1, 4, 6, 4, "#8a8f9a"); R(2, 5, 4, 1, "#3b78d8"); },
  site: () => (R) => { R(0, 6, 8, 2, "#b38d55"); R(1, 1, 1, 6, WOOD); R(6, 1, 1, 6, WOOD); },
  tower: (race) => (R) => { R(2, 2, 4, 6, "#aab0bc"); R(1, 1, 6, 2, "#8a8f9a"); R(4, 0, 2, 1, LOOK[race].flag); },
  barracks: (race) => (R, E, P, T) => { R(0, 4, 8, 4, LOOK[race].wall); T(4, 0, 4, 4, LOOK[race].roof); R(3, 5, 2, 3, "#c3d3de"); },
  keep: (race) => (R) => { R(0, 2, 8, 6, "#8a8f9a"); R(2, 1, 4, 7, "#aab0bc"); R(3, 0, 3, 2, LOOK[race].flag); },
  temple: () => (R, E, P, T) => { R(1, 4, 6, 4, "#f4f0e8"); T(4, 0, 4, 4, "#f0d9a0"); R(3, 0, 2, 1, GOLD); },
  mine: () => (R, E) => { E(4, 6, 4, 3, "#8a8f9a"); R(3, 4, 3, 4, K1); },
  smithy: () => (R) => { R(1, 3, 6, 5, "#8a8f9a"); R(5, 0, 2, 3, "#5a5f6b"); R(2, 5, 2, 2, "#f08a2c"); },
  market: (race) => (R) => { R(0, 3, 8, 2, LOOK[race].roof); R(1, 5, 1, 3, WOOD); R(6, 5, 1, 3, WOOD); R(2, 6, 4, 2, "#d4a94e"); },
  library: (race) => (R, E, P, T) => { R(1, 3, 6, 5, LOOK[race].wall); T(4, 0, 4, 3, LOOK[race].roof); R(2, 5, 4, 1, "#3b6fd4"); },
};

// An army's banner in its kingdom's colour (drawn in the cloth key colour).
export const BANNER: Draw = (R) => {
  R(0, 0, 1, 16, WOOD);
  R(1, 0, 8, 6, KEY.base);
  R(1, 6, 6, 2, KEY.base);
  R(3, 2, 3, 2, GOLD);
};

// Grace power effects, 7 x 7.
export const FX_ICON: Record<string, Draw> = {
  arrow: (R) => { R(0, 3, 5, 1, WOOD); R(5, 2, 2, 3, STEEL); R(0, 2, 1, 1, WH); R(0, 4, 1, 1, WH); },
  fire: (R) => { R(2, 1, 3, 6, "#f08a2c"); R(1, 3, 5, 4, "#d9453d"); R(3, 0, 1, 2, GOLD); R(3, 4, 1, 2, GOLD); },
  dust: (R) => { R(1, 3, 5, 3, "#c9a46a"); R(2, 2, 3, 1, "#d4a94e"); },
  sparkle: (R) => { R(3, 0, 1, 7, GOLD); R(0, 3, 7, 1, GOLD); R(2, 2, 3, 3, WH); },
  drop: (R) => { R(3, 0, 1, 2, "#5cc8e6"); R(2, 2, 3, 3, "#5cc8e6"); R(3, 5, 1, 1, "#3b78d8"); },
  plus: (R) => { R(2, 0, 3, 7, "#5fbf4a"); R(0, 2, 7, 3, "#5fbf4a"); },
};

// Action icons above heads, 7 x 7.
export const ACTION_ICON: Record<string, Draw> = {
  sleep: (R) => { R(1, 0, 5, 1, WH); R(4, 1, 1, 1, WH); R(3, 2, 1, 1, WH); R(2, 3, 1, 1, WH); R(1, 4, 5, 1, WH); },
  love: (R) => { R(1, 1, 2, 2, "#d9453d"); R(4, 1, 2, 2, "#d9453d"); R(1, 2, 5, 2, "#d9453d"); R(2, 4, 3, 1, "#d9453d"); R(3, 5, 1, 1, "#d9453d"); },
  work: (R) => { R(3, 1, 1, 6, WOOD); R(1, 0, 4, 2, STEEL); },
  build: (R) => { R(3, 2, 1, 5, WOOD); R(1, 0, 5, 2, "#8a8f9a"); },
  pray: (R) => { R(3, 0, 1, 6, GOLD); R(1, 2, 5, 1, GOLD); },
  fight: (R) => { R(0, 0, 1, 1, STEEL); R(1, 1, 1, 1, STEEL); R(2, 2, 1, 1, STEEL); R(3, 3, 1, 1, STEEL); R(6, 0, 1, 1, STEEL); R(5, 1, 1, 1, STEEL); R(4, 2, 1, 1, STEEL); R(1, 5, 2, 1, WOOD); R(4, 5, 2, 1, WOOD); },
  flee: (R) => { R(3, 0, 1, 4, "#d9453d"); R(3, 5, 1, 1, "#d9453d"); },
  eat: (R) => { R(1, 2, 5, 3, "#d4a94e"); R(2, 1, 3, 1, "#e8c46a"); },
};

export const RACE_COLORS: Record<RaceKey, string> = {
  human: "#3b6fd4",
  elf: "#5fbf4a",
  orc: "#d9453d",
  dwarf: "#f2c94c",
};

export { RACES };
