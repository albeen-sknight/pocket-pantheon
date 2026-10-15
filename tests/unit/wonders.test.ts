// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { packFrame } from "../../src/sim/protocol";
import { Sim } from "../../src/sim/sim";
import { fromSnapshot, toSnapshot } from "../../src/sim/snapshot";
import { RACES, speciesId } from "../../src/sim/species";
import { planTowns } from "../../src/sim/towns";
import type { Army } from "../../src/war/armies";
import { bombard, hasWonder } from "../../src/war/wonders";
import { generateWorld } from "../../src/world/generate";
import { defaultOptions, WALL } from "../../src/world/types";

const YEAR = 120;

function settled(years = 25) {
  const world = generateWorld({ ...defaultOptions(4242), size: "medium" });
  const sim = new Sim(world, 4242);
  sim.disasterFrequency = "off";
  sim.populate([...RACES]);
  for (let k = 0; k < years * YEAR; k++) sim.step();
  return sim;
}

const guardians = (sim: Sim) => sim.speciesCount[speciesId("guardian")]!;

// A free 3 by 3 patch of dry land near a town, for a test wonder.
function spot(sim: Sim, x0: number, y0: number): [number, number] {
  const w = sim.world;
  for (let r = 3; r < 30; r++) {
    for (let y = y0 - r; y <= y0 + r; y++) {
      for (let x = x0 - r; x <= x0 + r; x++) {
        let ok = x > 1 && y > 1 && x < w.w - 4 && y < w.h - 4;
        for (let dy = 0; ok && dy < 3; dy++) for (let dx = 0; ok && dx < 3; dx++) {
          const i = (y + dy) * w.w + x + dx;
          ok = !sim.occ[i] && w.height[i]! > w.seaLevel + 0.01;
        }
        if (ok) return [x, y];
      }
    }
  }
  throw new Error("no room");
}

describe("wonders and sieges", () => {
  it("a Mythril Age capital plans a wonder, one per kingdom", () => {
    const sim = settled();
    const k = sim.civ.kingdoms.find((x) => x.alive)!;
    const capital = sim.town(k.capital)!;
    k.age = 4;
    capital.stage = 3;
    capital.wood = 500;
    capital.res[2] = 500;
    // builders take time, so finish what the capital has under way between rounds
    const finishPending = () => sim.buildings.filter((b) => b.town === capital.id && !b.done).forEach((b) => sim.finish(b));
    for (let n = 0; n < 40 && !sim.buildings.some((b) => b.type === "wonder"); n++) {
      finishPending();
      capital.wood = 500;
      capital.res[2] = 500;
      planTowns(sim);
    }
    const wonders = sim.buildings.filter((b) => b.type === "wonder");
    expect(wonders).toHaveLength(1);
    expect(wonders[0]!.town).toBe(capital.id);
    for (let n = 0; n < 20; n++) {
      finishPending();
      planTowns(sim);
    }
    expect(sim.buildings.filter((b) => b.type === "wonder")).toHaveLength(1);
  }, 120_000);

  it("the first blow on a wonder wakes the Guardian instead of breaking it", () => {
    const sim = settled();
    const k = sim.civ.kingdoms.find((x) => x.alive)!;
    const capital = sim.town(k.capital)!;
    const [x, y] = spot(sim, Math.round(capital.x), Math.round(capital.y));
    const wonder = sim.place("wonder", x, y, capital.id, capital.race, true);
    expect(hasWonder(sim, k.id)).toBe(true);
    const before = guardians(sim);
    sim.removeBuilding(wonder);
    expect(sim.buildings).toContain(wonder);
    expect(guardians(sim)).toBe(before + 1);
    expect(sim.civ.log.at(-1)!.kind).toBe("guardian");
    // it wakes once; the next blow lands
    sim.removeBuilding(wonder);
    expect(sim.buildings).not.toContain(wonder);
    expect(guardians(sim)).toBe(before + 1);
  }, 120_000);

  it("a Steel Age army's catapult knocks down enemy walls, and the flag survives a save", () => {
    const sim = settled();
    const [a, b] = sim.civ.kingdoms.filter((x) => x.alive);
    a!.age = 3;
    const target = sim.town(b!.capital)!;
    const w = sim.world;
    // a wall tile next to the town
    let wall = -1;
    for (let d = 4; d < 12 && wall < 0; d++) {
      const i = Math.round(target.y) * w.w + Math.round(target.x) + d;
      if (w.height[i]! > w.seaLevel && !sim.occ[i]) wall = i;
    }
    sim.setTileFlag(wall, WALL, true);
    sim.civ.wallHp[wall] = 60;
    sim.civ.owner[wall] = b!.id;
    const army = { id: 99, kingdom: a!.id, x: target.x + 6, y: target.y, engines: 59, members: [] } as unknown as Army;
    bombard(sim, army, target);
    expect(sim.fx.some((f) => f.kind === "boulder")).toBe(true);
    expect(sim.civ.wallHp[wall]).toBe(20);
    army.engines = 59;
    bombard(sim, army, target);
    expect(w.flags[wall]! & WALL).toBe(0);
    // a Bronze Age army has no engines
    a!.age = 1;
    sim.fx = [];
    army.engines = 59;
    bombard(sim, army, target);
    expect(sim.fx).toHaveLength(0);

    sim.civ.armies.push({ ...(army as object), name: "test", general: 0, members: [], target: { town: target.id, x: target.x, y: target.y }, state: "siege", stance: "aggressive", morale: 100, startSize: 1, player: false, siege: 0, war: 0, home: 0 } as unknown as Army);
    a!.age = 3;
    expect(packFrame(sim, 0).armies.find((x) => x.id === 99)!.engines).toBe(true);
    const back = fromSnapshot(sim.world, 4242, toSnapshot(sim));
    expect(back.civ.armies.find((x) => x.id === 99)!.engines).toBe(army.engines);
  }, 120_000);
});
