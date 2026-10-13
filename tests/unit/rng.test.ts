// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { createRng, ppHash } from "../../src/core/rng";

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = createRng(4242);
    const b = createRng(4242);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it("gives different sequences for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 50 }, () => a.next() === b.next()).filter(Boolean);
    expect(same.length).toBeLessThan(2);
  });

  it("keeps int inside its bounds", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(1, 8);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(8);
    }
  });
});

describe("ppHash", () => {
  it("is stable and stays in [0, 1)", () => {
    expect(ppHash(3, 9, 1)).toBe(ppHash(3, 9, 1));
    for (let x = 0; x < 64; x++) {
      const v = ppHash(x, x * 7, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
