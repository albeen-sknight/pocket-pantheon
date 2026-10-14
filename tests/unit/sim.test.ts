// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { packFrame, UNIT_STRIDE } from "../../src/sim/protocol";
import { Sim } from "../../src/sim/sim";
import { fromSnapshot, toSnapshot } from "../../src/sim/snapshot";
import { RACES, type RaceKey } from "../../src/sim/species";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions, ROAD, type SizeKey } from "../../src/world/types";

const YEAR = 120;

function makeSim(seed: number, races: RaceKey[], size: SizeKey = "small") {
  const world = generateWorld({ ...defaultOptions(seed), size });
  const sim = new Sim(world, seed);
  sim.disasterFrequency = "off";
  sim.populate(races);
  return sim;
}

function run(sim: Sim, years: number) {
  for (let k = 0; k < years * YEAR; k++) sim.step();
}

function unitHash(sim: Sim): string {
  const u = sim.units;
  let h = 0x811c9dc5;
  for (const arr of [u.x, u.y, u.hp, u.age, u.needs]) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  }
  return (h >>> 0).toString(16) + ":" + sim.tick;
}

describe("simulation", () => {
  it("is deterministic: same seed, same world after 15 years", () => {
    const a = makeSim(11, [...RACES]);
    const b = makeSim(11, [...RACES]);
    run(a, 15);
    run(b, 15);
    expect(unitHash(a)).toBe(unitHash(b));
    expect(a.population()).toBe(b.population());
  });

  // The Phase 2 gate: a village grows with no player input.
  it("grows a village on its own", () => {
    const sim = makeSim(4242, ["human"], "medium");
    const start = sim.population();
    run(sim, 60);
    const roads = sim.world.flags.reduce((n, f) => n + (f & ROAD ? 1 : 0), 0);
    expect(sim.population()).toBeGreaterThan(start * 2);
    expect(sim.buildings.filter((b) => b.done).length).toBeGreaterThan(5);
    expect(roads).toBeGreaterThan(0);
  }, 60_000);

  it("stays healthy across seeds: no NaN, under the cap, inside the tick budget", () => {
    for (const seed of [1, 2, 3]) {
      const sim = makeSim(seed, [...RACES]);
      const t = performance.now();
      run(sim, 60);
      const perTick = (performance.now() - t) / (60 * YEAR);
      const u = sim.units;
      for (let s = 0; s < u.count; s++) {
        if (!u.alive[s]) continue;
        expect(Number.isFinite(u.x[s]) && Number.isFinite(u.y[s]) && Number.isFinite(u.hp[s])).toBe(true);
      }
      expect(u.count).toBeLessThanOrEqual(u.capacity);
      expect(perTick).toBeLessThan(25);
    }
  }, 120_000);

  it("keeps animal numbers under their carrying capacity", () => {
    const sim = makeSim(5, []);
    run(sim, 40);
    for (let k = RACES.length; k < sim.speciesCount.length; k++) {
      expect(sim.speciesCount[k]!).toBeLessThanOrEqual(Math.ceil(sim.speciesCap[k]!) + 6);
    }
  }, 60_000);

  it("restores from a snapshot exactly", () => {
    const sim = makeSim(8, [...RACES]);
    run(sim, 10);
    const back = fromSnapshot(sim.world, 8, toSnapshot(sim));
    expect(unitHash(back)).toBe(unitHash(sim));
    expect(back.towns.length).toBe(sim.towns.length);
    expect(back.buildings.length).toBe(sim.buildings.length);
    run(back, 5);
    expect(back.population()).toBeGreaterThan(0);
  });

  it("packs a frame with every living unit", () => {
    const sim = makeSim(3, [...RACES]);
    run(sim, 2);
    const f = packFrame(sim, 0);
    let alive = 0;
    for (let s = 0; s < sim.units.count; s++) if (sim.units.alive[s]) alive++;
    expect(f.count).toBe(alive);
    expect(f.units.length).toBe(alive * UNIT_STRIDE);
  });

  it("genetics commands change the chosen unit", () => {
    const sim = makeSim(4, ["elf"]);
    const u = sim.units;
    const slot = [...Array(u.count).keys()].find((s) => u.alive[s] && u.kind[s] === 1)!;
    const uid = u.uid[slot]!;
    const before = u.genesOf(slot).slice();
    sim.apply({ c: "mutate", uid });
    expect(u.genesOf(slot)).not.toEqual(before);
    const pop = sim.population();
    sim.apply({ c: "clone", uid });
    expect(sim.population()).toBe(pop + 1);
  });
});
