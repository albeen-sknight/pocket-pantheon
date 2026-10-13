// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Droplet erosion: each raindrop rolls downhill, picks up sediment where it
// speeds up and drops it where it slows down. Carves valleys, smooths coasts.
// TypeScript twin of the planned WebAssembly module (PLAN section 24).
import type { Rng } from "../core/rng";

export interface ErosionParams {
  drops: number;
  steps: number;
  strength: number;
}

const INERTIA = 0.05;
const CAPACITY = 4;
const MIN_CAPACITY = 0.01;
const DEPOSIT = 0.3;
const EVAPORATE = 0.02;
const GRAVITY = 4;

export function erode(height: Float32Array, w: number, h: number, rng: Rng, p: ErosionParams) {
  const sample = (x: number, y: number) => {
    const xi = x | 0;
    const yi = y | 0;
    const fx = x - xi;
    const fy = y - yi;
    const i = yi * w + xi;
    const a = height[i]!;
    const b = height[i + 1]!;
    const c = height[i + w]!;
    const d = height[i + w + 1]!;
    return {
      h: a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy,
      gx: (b - a) * (1 - fy) + (d - c) * fy,
      gy: (c - a) * (1 - fx) + (d - b) * fx,
    };
  };

  for (let n = 0; n < p.drops; n++) {
    let x = 1 + rng.next() * (w - 3);
    let y = 1 + rng.next() * (h - 3);
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let s = 0; s < p.steps; s++) {
      const here = sample(x, y);
      dx = dx * INERTIA - here.gx * (1 - INERTIA);
      dy = dy * INERTIA - here.gy * (1 - INERTIA);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;

      const ox = x;
      const oy = y;
      x += dx;
      y += dy;
      if (x < 1 || y < 1 || x >= w - 2 || y >= h - 2) break;

      const drop = sample(x, y).h - here.h;
      const capacity = Math.max(-drop * speed * water * CAPACITY, MIN_CAPACITY);
      const amount = sediment > capacity || drop > 0
        ? (drop > 0 ? Math.min(drop, sediment) : (sediment - capacity) * DEPOSIT)
        : -Math.min((capacity - sediment) * p.strength, -drop);

      spread(height, w, ox, oy, amount);
      sediment -= amount;
      speed = Math.sqrt(Math.max(0, speed * speed - drop * GRAVITY));
      water *= 1 - EVAPORATE;
    }
  }
}

// Adds (or removes, when negative) material across the 4 cells under a point.
function spread(height: Float32Array, w: number, x: number, y: number, amount: number) {
  const xi = x | 0;
  const yi = y | 0;
  const fx = x - xi;
  const fy = y - yi;
  const i = yi * w + xi;
  height[i] = height[i]! + amount * (1 - fx) * (1 - fy);
  height[i + 1] = height[i + 1]! + amount * fx * (1 - fy);
  height[i + w] = height[i + w]! + amount * (1 - fx) * fy;
  height[i + w + 1] = height[i + w + 1]! + amount * fx * fy;
}
