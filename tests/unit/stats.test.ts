// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { CAUSES, History, report } from "../../src/stats/history";
import { Sim } from "../../src/sim/sim";
import { fromSnapshot, toSnapshot } from "../../src/sim/snapshot";
import { RACES } from "../../src/sim/species";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions } from "../../src/world/types";

const YEAR = 120;
const MB = 1024 * 1024;

function world(years: number) {
  const w = generateWorld({ ...defaultOptions(4242), size: "medium" });
  const sim = new Sim(w, 4242);
  sim.disasterFrequency = "off";
  sim.populate([...RACES]);
  let deaths = 0;
  for (let k = 0; k < years * YEAR; k++) {
    sim.step();
    deaths += sim.events.filter((e) => e.t === "death").length;
    sim.events = [];
  }
  return { sim, deaths };
}

describe("stats", () => {
  it("samples once a year and counts every death by cause", () => {
    const { sim, deaths } = world(20);
    const r = report(sim);
    expect(r.years.length).toBe(20);
    expect(r.years.at(-1)).toBe(sim.year);
    // the population line ends at today's count
    expect(r.people.at(-1)).toBe(sim.population());
    expect(r.races.reduce((a, s) => a + s.values.at(-1)!, 0)).toBe(sim.population());
    const recorded = r.deaths.reduce((a, d) => a + d.counts.reduce((x, y) => x + y, 0), 0);
    expect(recorded).toBe(deaths);
    expect(r.deaths[0]!.counts.length).toBe(CAUSES.length);
    // pyramids hold everyone of each race
    for (const p of r.pyramids.filter((g) => g.group === "race")) {
      const n = p.male.reduce((a, b) => a + b, 0) + p.female.reduce((a, b) => a + b, 0);
      expect(n).toBe(sim.speciesCount[RACES.indexOf(p.race)]!);
    }
    expect(r.tree.length).toBe(sim.civ.kingdoms.length);
    expect(r.leaders.oldest.length).toBeGreaterThan(0);
  }, 120_000);

  it("keeps its history through a save", () => {
    const { sim } = world(8);
    const back = fromSnapshot(sim.world, 4242, toSnapshot(sim));
    expect(report(back).people).toEqual(report(sim).people);
    expect(back.history.count).toBe(sim.history.count);
  }, 120_000);

  it("logs battle deaths per year for each war", () => {
    const { sim } = world(10);
    const [a, b] = sim.civ.kingdoms.filter((k) => k.alive);
    sim.apply({ c: "war", a: a!.id, b: b!.id });
    for (let k = 0; k < 30 * YEAR; k++) sim.step();
    const w = report(sim).wars[0]!;
    const logged = w.log.reduce((n, l) => n + l.a + l.b, 0);
    expect(logged).toBe(w.casualties[0] + w.casualties[1]);
  }, 120_000);

  // The Phase 6 gate: 1,000 years of history fit in 30 MB. A busy world is
  // simulated by filling every year with far more kingdoms, faiths and
  // subspecies than a real one keeps alive at once.
  it("keeps 1,000 busy years under 30 MB", () => {
    const { sim } = world(2);
    const h = new History();
    const busy = (n: number) => Array.from({ length: n }, (_, i): [number, number] => [i + 1, 500 + i]);
    for (let y = 0; y < 1200; y++) {
      h.sample(sim);
      const slot = (h.count - 1) % h.cap;
      h.kingdoms[slot] = busy(60);
      h.religions[slot] = busy(30);
      h.subspecies[slot] = busy(40);
    }
    expect(h.rows().length).toBe(1000);
    expect(h.bytes()).toBeLessThan(30 * MB);
    // and the report sent to the panel stays small too
    const holder = sim as unknown as { history: History };
    Object.defineProperty(holder, "history", { value: h });
    expect(JSON.stringify(report(sim)).length).toBeLessThan(30 * MB);
  }, 120_000);
});
