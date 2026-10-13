// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Fallback for devices without WebGL2: one pixel per tile, scaled up with no
// smoothing. Also paints the minimap.
import biomes from "../../data/biomes.json";
import { LAKE, RIVER, type World } from "../world/types";
import type { Rect } from "../world/edit";
import type { Camera } from "./camera";
import { rgb } from "./palette";
import type { Renderer } from "./renderer";

const TONES = biomes.biomes.map((b) => b.tones.map(rgb));
const FRESH = biomes.freshWater.map(rgb);
// same dimmed deep water the WebGL shader shows past the map edge
const OUTSIDE = "#173372";

export function paintTiles(world: World, img: ImageData, r: Rect) {
  const { w, height, biome, flags, seaLevel } = world;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = y * w + x;
      const tones = TONES[biome[i]!]!;
      let c: [number, number, number];
      if (height[i]! >= seaLevel && flags[i]! & (RIVER | LAKE)) {
        c = FRESH[0]!;
      } else if (height[i]! < seaLevel) {
        const depth = seaLevel - height[i]!;
        c = depth > 0.09 ? tones[2]! : depth > 0.03 ? tones[0]! : tones[1]!;
      } else {
        const right = height[Math.min(i + 1, height.length - 1)]! - height[Math.max(i - 1, 0)]!;
        const down = height[Math.min(i + w, height.length - 1)]! - height[Math.max(i - w, 0)]!;
        const shade = (right + down) * 14 + (((x + y) & 1) - 0.5) * 0.3;
        c = shade > 0.5 ? tones[1]! : shade < -0.5 ? tones[2]! : tones[0]!;
      }
      const o = i * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
}

export function createCanvasRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  const map = document.createElement("canvas");
  const mapCtx = map.getContext("2d")!;
  let img: ImageData | null = null;

  return {
    kind: "canvas2d",
    setWorld(world) {
      map.width = world.w;
      map.height = world.h;
      img = mapCtx.createImageData(world.w, world.h);
      paintTiles(world, img, { x0: 0, y0: 0, x1: world.w, y1: world.h });
      mapCtx.putImageData(img, 0, 0);
    },
    update(world, r) {
      if (!img) return;
      paintTiles(world, img, r);
      mapCtx.putImageData(img, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    },
    draw(cam: Camera) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = OUTSIDE;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      ctx.drawImage(map, -cam.x * cam.scale, -cam.y * cam.scale, map.width * cam.scale, map.height * cam.scale);
    },
  };
}
