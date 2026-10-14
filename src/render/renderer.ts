// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import type { Rect } from "../world/edit";
import type { World } from "../world/types";
import type { Atlas } from "./atlas";
import type { Camera } from "./camera";
import type { Scene } from "./scene";

export interface Renderer {
  kind: "webgl2" | "canvas2d";
  setWorld(world: World): void;
  update(world: World, rect: Rect): void;
  draw(camera: Camera, time: number, season: number): void;
  drawSprites(scene: Scene, atlas: Atlas, camera: Camera): void;
}

// Packs one tile into the RGBA layout the terrain shader reads:
// biome, height high byte, height low byte, flags.
export function packTiles(world: World, rect: Rect, out: Uint8Array) {
  const rw = rect.x1 - rect.x0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = y * world.w + x;
      const o = ((y - rect.y0) * rw + (x - rect.x0)) * 4;
      const h = Math.round(Math.max(0, Math.min(1, world.height[i]!)) * 65535);
      out[o] = world.biome[i]!;
      out[o + 1] = h >> 8;
      out[o + 2] = h & 255;
      out[o + 3] = world.flags[i]!;
    }
  }
}
