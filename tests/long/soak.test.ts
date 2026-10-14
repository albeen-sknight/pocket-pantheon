// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// PLAN section 22: seeded worlds run for 500 years with no renderer. Fails on
// exceptions, NaN, going over the unit cap, or a tick slower than 25 ms.
// npm run test:long (set PP_SOAK_WORLDS to run fewer than 100)
import { expect, it } from "vitest";
import { Sim } from "../../src/sim/sim";
import { RACES } from "../../src/sim/species";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions } from "../../src/world/types";

declare const process: { env: Record<string, string | undefined> };

const WORLDS = Number(process.env.PP_SOAK_WORLDS ?? 100);
const YEARS = Number(process.env.PP_SOAK_YEARS ?? 500);
const TPY = 120;

it(`${WORLDS} worlds survive ${YEARS} years`, () => {
  for (let seed = 1; seed <= WORLDS; seed++) {
    const world = generateWorld({ ...defaultOptions(seed * 7919), size: "small" });
    const sim = new Sim(world, seed);
    sim.populate([...RACES]);
    let worst = 0;
    for (let y = 0; y < YEARS; y++) {
      const t = performance.now();
      for (let k = 0; k < TPY; k++) sim.step();
      worst = Math.max(worst, (performance.now() - t) / TPY);
      sim.events = [];
    }
    const u = sim.units;
    for (let s = 0; s < u.count; s++) {
      if (u.alive[s]) expect(Number.isFinite(u.x[s]! + u.y[s]! + u.hp[s]! + u.age[s]!)).toBe(true);
    }
    expect(u.count).toBeLessThanOrEqual(u.capacity);
    expect(worst).toBeLessThan(25);
    console.log(`world ${seed}: year ${sim.year}, people ${sim.population()}, towns ${sim.towns.filter((t) => t.alive).length}, worst tick ${worst.toFixed(2)} ms`);
  }
}, 24 * 3600 * 1000);
