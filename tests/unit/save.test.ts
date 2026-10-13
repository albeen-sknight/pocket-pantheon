// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { describe, expect, it } from "vitest";
import { decodeWorld, encodeWorld, gunzip, gzip, makeMeta, SAVE_VERSION } from "../../src/save/format";
import { generateWorld } from "../../src/world/generate";
import { worldHash } from "../../src/world/hash";
import { defaultOptions } from "../../src/world/types";

describe("save format", () => {
  const world = generateWorld({ ...defaultOptions(31), size: "small" });

  it("round trips a world through gzip", async () => {
    const packed = await gzip(encodeWorld(world, makeMeta(world, "test")));
    const { world: back, meta } = decodeWorld(await gunzip(packed));
    expect(worldHash(back)).toBe(worldHash(world));
    expect(back.options).toEqual(world.options);
    expect(meta.engine).toBe("PocketPantheon-Core");
    expect(meta.saveVersion).toBe(SAVE_VERSION);
  });

  it("compresses well", async () => {
    const raw = encodeWorld(world, makeMeta(world, "test"));
    const packed = await gzip(raw);
    expect(packed.length).toBeLessThan(raw.length * 0.6);
  });

  it("rejects files that aren't saves", () => {
    expect(() => decodeWorld(new TextEncoder().encode("hello there"))).toThrow();
  });

  it("rejects saves from a newer version", () => {
    const bytes = encodeWorld(world, { ...makeMeta(world, "test"), saveVersion: SAVE_VERSION + 1 });
    expect(() => decodeWorld(bytes)).toThrow();
  });
});
