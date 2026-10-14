// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { Sim } from "../../src/sim/sim";
import { fromSnapshot, toSnapshot } from "../../src/sim/snapshot";
import { RACES } from "../../src/sim/species";
import { atWar } from "../../src/war/wars";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions, WALL } from "../../src/world/types";

const YEAR = 120;

function settled(years = 40) {
  const world = generateWorld({ ...defaultOptions(4242), size: "medium" });
  const sim = new Sim(world, 4242);
  sim.disasterFrequency = "off";
  sim.populate([...RACES]);
  for (let k = 0; k < years * YEAR; k++) sim.step();
  return sim;
}

function run(sim: Sim, years: number) {
  for (let k = 0; k < years * YEAR; k++) sim.step();
}

describe("war", () => {
  // The Phase 4 gate: a war ends in conquest, razing or a truce.
  it("ends a war in conquest, razing or a truce", () => {
    const sim = settled();
    const [a, b] = sim.civ.kingdoms.filter((k) => k.alive);
    sim.apply({ c: "war", a: a!.id, b: b!.id });
    const w = sim.civ.wars.at(-1)!;
    expect(atWar(sim, a!.id, b!.id)).toBe(true);
    run(sim, 2);
    expect(sim.civ.armies.length).toBeGreaterThan(0);
    for (let y = 0; y < 20 && !w.end; y++) run(sim, 1);
    expect(["conquest", "razing", "truce"]).toContain(w.result);
    expect(atWar(sim, a!.id, b!.id)).toBe(false);
    expect(sim.civ.armies.filter((x) => x.war === w.id)).toHaveLength(0);
  }, 120_000);

  it("makes peace and alliances on command", () => {
    const sim = settled(20);
    const [a, b] = sim.civ.kingdoms.filter((k) => k.alive);
    sim.apply({ c: "war", a: a!.id, b: b!.id });
    sim.apply({ c: "peace", a: a!.id, b: b!.id });
    expect(sim.civ.wars.at(-1)!.result).toBe("peace");
    sim.apply({ c: "ally", a: a!.id, b: b!.id });
    expect([...sim.civ.relations.values()].find((r) => r.a === Math.min(a!.id, b!.id) && r.b === Math.max(a!.id, b!.id))!.state).toBe("alliance");
  }, 60_000);

  it("obeys player orders and keeps armies through a save", () => {
    const sim = settled();
    const [a, b] = sim.civ.kingdoms.filter((k) => k.alive);
    sim.apply({ c: "war", a: a!.id, b: b!.id });
    run(sim, 1);
    const army = sim.civ.armies[0]!;
    sim.apply({ c: "army", id: army.id, order: "hold", x: army.x, y: army.y });
    expect(army.state).toBe("hold");
    expect(army.player).toBe(true);
    const back = fromSnapshot(sim.world, 4242, toSnapshot(sim));
    expect(back.civ.armies.map((x) => x.id)).toEqual(sim.civ.armies.map((x) => x.id));
    expect(atWar(back, a!.id, b!.id)).toBe(true);
  }, 60_000);

  it("lets the player drive a possessed unit", () => {
    const sim = settled(10);
    const u = sim.units;
    const s = [...Array(u.count).keys()].find((i) => u.alive[i] && u.kind[i] === 0)!;
    sim.apply({ c: "possess", uid: u.uid[s]! });
    const x = u.x[s]!;
    const y = u.y[s]!;
    let moved = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      sim.apply({ c: "input", input: { dx: dx!, dy: dy!, jump: false, attack: false, talk: false, interact: false } });
      for (let k = 0; k < 20; k++) sim.step();
      if (Math.hypot(u.x[s]! - x, u.y[s]! - y) > 0.5) moved = true;
    }
    expect(moved).toBe(true);
    sim.apply({ c: "input", input: { dx: 0, dy: 0, jump: false, attack: false, talk: true, interact: false } });
    sim.step();
    expect(sim.fx.some((f) => f.kind === "talk")).toBe(true);
    sim.apply({ c: "release" });
    expect(sim.possessed).toBe(0);
  }, 60_000);

  it("rings a town at war with walls, and enemies can't path through them", () => {
    const sim = settled(20);
    const [a, b] = sim.civ.kingdoms.filter((k) => k.alive);
    const t = sim.town(a!.capital)!;
    t.stage = 2;
    a!.age = 2;
    t.wood += 100;
    t.res[2]! += 100;
    sim.apply({ c: "war", a: a!.id, b: b!.id });
    run(sim, 1);
    const walls = [...sim.world.flags.keys()].filter((i) => sim.world.flags[i]! & WALL);
    expect(walls.length).toBeGreaterThan(0);
    const i = walls[0]!;
    expect(sim.moveCost(0, i, a!.id)).toBeLessThan(Infinity);
    expect(sim.moveCost(0, i, b!.id)).toBe(Infinity);
  }, 60_000);
});
