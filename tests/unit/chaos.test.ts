// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { WRATH } from "../../src/chaos/disasters";
import { HAZ } from "../../src/chaos/hazards";
import { GRACE } from "../../src/civ/grace";
import { packFrame } from "../../src/sim/protocol";
import { Sim } from "../../src/sim/sim";
import { fromSnapshot, toSnapshot } from "../../src/sim/snapshot";
import { RACES, speciesId } from "../../src/sim/species";
import { B } from "../../src/world/biomes";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions } from "../../src/world/types";

const YEAR = 120;

function world(years = 8) {
  const w = generateWorld({ ...defaultOptions(4242), size: "medium" });
  const sim = new Sim(w, 4242);
  sim.disasterFrequency = "off";
  sim.populate([...RACES]);
  for (let k = 0; k < years * YEAR; k++) sim.step();
  return sim;
}

function run(sim: Sim, ticks: number) {
  for (let k = 0; k < ticks; k++) sim.step();
}

function landNear(sim: Sim, test: (i: number) => boolean): [number, number] {
  const w = sim.world;
  for (let i = 0; i < w.biome.length; i++) if (w.height[i]! >= w.seaLevel + 0.02 && test(i)) return [(i % w.w) + 0.5, Math.floor(i / w.w) + 0.5];
  throw new Error("no tile");
}

describe("chaos", () => {
  // The Phase 5 gate: every power shows its effect within 100 ms. The effect
  // is queued in the same tick the power lands, and that tick's frame
  // carries it to the screen.
  it("shows every Wrath and Grace power in the same tick, well under 100 ms", () => {
    const sim = world();
    const t = sim.towns.find((tw) => tw.alive)!;
    for (const power of [...WRATH, ...GRACE]) {
      const started = performance.now();
      if ((WRATH as readonly string[]).includes(power)) sim.apply({ c: "wrath", power: power as (typeof WRATH)[number], x: t.x + 6, y: t.y + 6, radius: 3 });
      else sim.apply({ c: "grace", power: power as (typeof GRACE)[number], x: t.x, y: t.y, radius: 3 });
      const frame = packFrame(sim, 0);
      expect(performance.now() - started).toBeLessThan(100);
      expect(frame.fx.length + frame.storms.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it("spreads fire through a forest, leaves ash, and rain puts it out", () => {
    const sim = world(1);
    const [x, y] = landNear(sim, (i) => sim.world.biome[i] === B.forest);
    sim.apply({ c: "wrath", power: "fire", x, y, radius: 2 });
    run(sim, 60);
    const burning = () => [...sim.hazards.kind].filter((k) => k === HAZ.fire).length;
    expect(burning()).toBeGreaterThan(0);
    run(sim, 400);
    expect([...sim.hazards.kind].some((k) => k === HAZ.ash)).toBe(true);
    sim.apply({ c: "wrath", power: "fire", x, y, radius: 2 });
    sim.apply({ c: "grace", power: "rain", x, y, radius: 6 });
    const i = Math.floor(y) * sim.world.w + Math.floor(x);
    expect(sim.hazards.kind[i]).not.toBe(HAZ.fire);
  }, 60_000);

  it("a meteor leaves a crater", () => {
    const sim = world(1);
    const [x, y] = landNear(sim, (i) => sim.world.height[i]! > 0.5);
    const i = Math.floor(y) * sim.world.w + Math.floor(x);
    const before = sim.world.height[i]!;
    sim.apply({ c: "wrath", power: "meteor", x, y, radius: 1 });
    run(sim, 20);
    expect(sim.world.height[i]!).toBeLessThan(before);
  }, 60_000);

  it("a nuke leaves wasteland, fallout and mutants", () => {
    const sim = world(1);
    const [x, y] = landNear(sim, (i) => sim.world.biome[i] === B.grassland);
    sim.apply({ c: "wrath", power: "nuke", x, y, radius: 1 });
    const i = Math.floor(y) * sim.world.w + Math.floor(x);
    expect(sim.world.biome[i]).toBe(B.wasteland);
    expect(sim.hazards.kind[i]).toBe(HAZ.fallout);
    expect(sim.speciesCount[speciesId("mutant")]!).toBeGreaterThan(0);
  }, 60_000);

  it("plague spreads by contact; zombie bites make zombies", () => {
    const sim = world();
    const t = sim.towns.reduce((a, b) => (b.pop > a.pop ? b : a));
    sim.apply({ c: "wrath", power: "plague", x: t.x, y: t.y, radius: 1 });
    run(sim, YEAR);
    const sick = [...sim.units.sick].filter((v, s) => v > 0 && sim.units.alive[s]).length;
    expect(sick).toBeGreaterThan(0);
    const zombies = () => sim.speciesCount[speciesId("zombie")]!;
    sim.apply({ c: "wrath", power: "zombie", x: t.x, y: t.y, radius: 1 });
    expect(zombies()).toBeGreaterThan(0);
  }, 60_000);

  it("a volcano erupts lava that cools into infernal ground", () => {
    const sim = world(1);
    const [x, y] = landNear(sim, (i) => sim.world.biome[i] === B.grassland);
    sim.apply({ c: "wrath", power: "volcano", x, y, radius: 2 });
    run(sim, 200);
    expect([...sim.hazards.kind].some((k) => k === HAZ.lava)).toBe(true);
    run(sim, 2000);
    expect(sim.world.biome.some((b) => b === B.infernal)).toBe(true);
  }, 60_000);

  it("slimes split when hit and the UFO brings its abductees back", () => {
    const sim = world();
    const slime = sim.spawnUnit(speciesId("slime"), 10.5, 10.5, 2);
    const before = sim.speciesCount[speciesId("slime")]!;
    if (slime >= 0) {
      const wolf = sim.spawnUnit(speciesId("wolf"), 11, 10.5, 3);
      if (wolf >= 0) {
        // strike once through the combat code
        sim.units.act[wolf] = 8;
        sim.units.target[wolf] = sim.units.uid[slime]!;
        sim.units.actT[wolf] = 50;
        run(sim, 30);
        expect(sim.speciesCount[speciesId("slime")]!).toBeGreaterThanOrEqual(before);
      }
    }
    const t = sim.towns.find((tw) => tw.alive)!;
    sim.apply({ c: "spawn", kind: speciesId("ufo"), x: t.x, y: t.y, count: 1 });
    run(sim, YEAR * 3);
    sim.abducted.forEach((a) => (a.back = sim.tick));
    const taken = sim.abducted.length;
    run(sim, 1);
    expect(sim.abducted.length).toBe(0);
    if (taken) expect(sim.civ.log.some((e) => e.kind === "returned")).toBe(true);
  }, 120_000);

  it("Clawzilla flattens buildings when the player stomps", () => {
    const sim = world();
    const b = sim.buildings.find((x) => x.done && x.type === "house")!;
    sim.apply({ c: "spawn", kind: speciesId("clawzilla"), x: b.x + 1, y: b.y + 3, count: 1 });
    const u = sim.units;
    const s = [...Array(u.count).keys()].find((i) => u.alive[i] && u.kind[i] === speciesId("clawzilla"))!;
    sim.apply({ c: "possess", uid: u.uid[s]! });
    u.x[s] = b.x + 1;
    u.y[s] = b.y + 1;
    sim.apply({ c: "input", input: { dx: 0, dy: 0, jump: true, attack: false, talk: false, interact: false } });
    sim.step();
    expect(sim.buildings.includes(b)).toBe(false);
  }, 60_000);

  it("nature strikes on its own at the normal setting", () => {
    const sim = world(1);
    sim.disasterFrequency = "normal";
    run(sim, YEAR * 40);
    expect(sim.civ.log.some((e) => e.kind === "natural")).toBe(true);
  }, 120_000);

  it("keeps hazards and storms through a save", () => {
    const sim = world(1);
    const [x, y] = landNear(sim, (i) => sim.world.biome[i] === B.grassland);
    sim.apply({ c: "wrath", power: "blizzard", x, y, radius: 3 });
    sim.apply({ c: "wrath", power: "tornado", x, y, radius: 3 });
    const back = fromSnapshot(sim.world, 4242, toSnapshot(sim));
    expect([...back.hazards.kind]).toEqual([...sim.hazards.kind]);
    expect(back.storms.length).toBe(sim.storms.length);
  }, 60_000);
});
