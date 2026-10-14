// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { relation } from "../../src/civ/diplomacy";
import { makeLanguage, personName, phrase, placeName } from "../../src/civ/language";
import { createRng } from "../../src/core/rng";
import { Sim } from "../../src/sim/sim";
import { fromSnapshot, toSnapshot } from "../../src/sim/snapshot";
import { RACES, type RaceKey } from "../../src/sim/species";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions, type SizeKey } from "../../src/world/types";

const YEAR = 120;

function makeSim(seed: number, races: RaceKey[], size: SizeKey = "small") {
  const world = generateWorld({ ...defaultOptions(seed), size });
  const sim = new Sim(world, seed);
  sim.populate(races);
  return sim;
}

function run(sim: Sim, years: number, onEvent?: (kind: string) => void) {
  for (let k = 0; k < years * YEAR; k++) {
    sim.step();
    for (const e of sim.events) if (e.t === "chronicle") onEvent?.(e.entry.kind);
    sim.events = [];
  }
}

describe("languages", () => {
  it("build clean, repeatable names for every race", () => {
    for (const race of RACES) {
      const a = makeLanguage(race, 42);
      const b = makeLanguage(race, 42);
      expect(a).toEqual(b);
      expect(a.syllables.length).toBeGreaterThanOrEqual(20);
      expect(a.syllables.length).toBeLessThanOrEqual(30);
      const r = createRng(1);
      for (let i = 0; i < 50; i++) {
        for (const name of [personName(a, r), placeName(a, r), phrase(a, i)]) {
          expect(name).not.toMatch(/[-'’]/);
          expect(name.length).toBeGreaterThan(1);
        }
      }
    }
  });

  it("give each culture its own sound", () => {
    const a = makeLanguage("orc", 1);
    const b = makeLanguage("orc", 2);
    expect(a.syllables.join()).not.toBe(b.syllables.join());
  });
});

describe("civilization", () => {
  // The Phase 3 gate: kingdoms rise and split with no player input.
  it("raises kingdoms that split on their own", () => {
    const sim = makeSim(4242, [...RACES], "medium");
    const seen: Record<string, number> = {};
    run(sim, 150, (k) => (seen[k] = (seen[k] ?? 0) + 1));
    expect(seen.kingdom ?? 0).toBeGreaterThanOrEqual(4);
    expect((seen.independence ?? 0) + (seen.rebellion ?? 0)).toBeGreaterThan(0);
    expect(sim.civ.kingdoms.filter((k) => k.alive).length).toBeGreaterThan(4);
    expect(seen.ruler ?? 0).toBeGreaterThan(4);
    for (const k of sim.civ.kingdoms) expect(k.name).not.toMatch(/[-']/);
  }, 120_000);

  it("claims territory around towns", () => {
    const sim = makeSim(9, ["human"]);
    run(sim, 3);
    expect(sim.civ.owner.some((o) => o > 0)).toBe(true);
  });

  it("brings a lost race back when the Director allows it", () => {
    const sim = makeSim(6, ["elf"]);
    run(sim, 1);
    const u = sim.units;
    for (let s = 0; s < u.count; s++) if (u.alive[s] && u.kind[s] === 1) sim.kill(s, 8);
    expect(sim.speciesCount[1]).toBe(0);
    const seen: string[] = [];
    run(sim, 23, (k) => seen.push(k));
    expect(seen).toContain("revive");
    expect(sim.speciesCount[1]!).toBeGreaterThan(0);
  }, 60_000);

  it("keeps a lost race lost when the Director is off", () => {
    const sim = makeSim(6, ["elf"]);
    sim.apply({ c: "director", mode: "off", lifeReturns: true });
    run(sim, 1);
    const u = sim.units;
    for (let s = 0; s < u.count; s++) if (u.alive[s] && u.kind[s] === 1) sim.kill(s, 8);
    run(sim, 23);
    expect(sim.speciesCount[1]).toBe(0);
  }, 60_000);

  it("restores kingdoms, faiths and relations from a snapshot", () => {
    const sim = makeSim(4, [...RACES]);
    run(sim, 20);
    const back = fromSnapshot(sim.world, 4, toSnapshot(sim));
    expect(back.civ.kingdoms.map((k) => k.name)).toEqual(sim.civ.kingdoms.map((k) => k.name));
    expect(back.civ.relations.size).toBe(sim.civ.relations.size);
    expect(back.towns.map((t) => t.kingdom)).toEqual(sim.towns.map((t) => t.kingdom));
    run(back, 2);
  }, 60_000);
});

describe("grace powers", () => {
  function settled() {
    const sim = makeSim(4242, ["human", "dwarf"], "medium");
    run(sim, 6);
    const t = sim.towns.find((tw) => tw.alive)!;
    return { sim, t };
  }

  it("bless and fertility mark the people in the brush", () => {
    const { sim, t } = settled();
    sim.apply({ c: "grace", power: "bless", x: t.x, y: t.y, radius: 9 });
    sim.apply({ c: "grace", power: "fertility", x: t.x, y: t.y, radius: 9 });
    const u = sim.units;
    let blessed = 0;
    let fertile = 0;
    for (let s = 0; s < u.count; s++) {
      if (u.blessed[s]! > 0) blessed++;
      if (u.fertile[s]! > 0) fertile++;
    }
    expect(blessed).toBeGreaterThan(0);
    expect(fertile).toBeGreaterThan(0);
    expect(sim.fx.map((f) => f.kind)).toEqual(["bless", "fertility"]);
  }, 60_000);

  it("bounty fills the nearest town, inspire speeds research", () => {
    const { sim, t } = settled();
    const food = t.food;
    sim.apply({ c: "grace", power: "bounty", x: t.x, y: t.y, radius: 3 });
    expect(t.food).toBeGreaterThan(food);
    const k = sim.civ.kingdoms[t.kingdom - 1]!;
    const research = k.research;
    sim.apply({ c: "grace", power: "inspire", x: t.x, y: t.y, radius: 3 });
    expect(k.research).toBeGreaterThan(research);
  }, 60_000);

  it("miracle brings back the recently dead", () => {
    const { sim, t } = settled();
    const u = sim.units;
    const victim = [...Array(u.count).keys()].find((s) => u.alive[s] && u.town[s] === t.id)!;
    const name = u.names[victim];
    const x = u.x[victim]!;
    const y = u.y[victim]!;
    sim.kill(victim, 8);
    sim.apply({ c: "grace", power: "miracle", x, y, radius: 2 });
    expect(u.names.some((n, s) => n === name && u.alive[s])).toBe(true);
  }, 60_000);

  it("peace warms relations between nearby kingdoms", () => {
    const sim = makeSim(4242, [...RACES], "medium");
    run(sim, 10);
    const [a, b] = sim.civ.kingdoms.filter((k) => k.alive);
    const before = relation(sim, a!.id, b!.id).opinion;
    const ta = sim.town(a!.capital)!;
    const tb = sim.town(b!.capital)!;
    sim.apply({ c: "grace", power: "peace", x: (ta.x + tb.x) / 2, y: (ta.y + tb.y) / 2, radius: Math.hypot(ta.x - tb.x, ta.y - tb.y) / 2 });
    expect(relation(sim, a!.id, b!.id).opinion).toBeGreaterThan(before);
  }, 60_000);
});
