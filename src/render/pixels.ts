// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// DOM free pixel drawing shared by the renderer and build time artwork.
import palette from "../../data/palette.json";
import { COLORS, rgb } from "./palette";

export type Px = (x: number, y: number, c: string) => void;
export type Rect = (x: number, y: number, w: number, h: number, c: string) => void;
export type Ellipse = (cx: number, cy: number, rx: number, ry: number, c: string) => void;
export type Tri = (cx: number, y: number, hw: number, h: number, c: string) => void;
export type Draw = (R: Rect, E: Ellipse, P: Px, T: Tri) => void;
export type PixelImage = { width: number; height: number; colors: (string | null)[] };

const fromPreview: Record<string, string> = palette.fromPreview;
export const KEY = { base: "#ff00fe", light: "#ff60fe", dark: "#c000c0", outline: "#600060" };
const KEYS = new Set(Object.values(KEY));
const paletteLab = COLORS.map(rgb);

export function snap(hex: string): string {
  if (KEYS.has(hex)) return hex;
  const direct = fromPreview[hex.toLowerCase()];
  if (direct) return direct;
  const [r, g, b] = rgb(hex);
  let best = 0;
  let bestD = Infinity;
  paletteLab.forEach(([pr, pg, pb], i) => {
    const d = (pr - r) ** 2 * 0.3 + (pg - g) ** 2 * 0.59 + (pb - b) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return COLORS[best]!;
}

export function shade(hex: string, f: number): string {
  if (KEYS.has(hex)) return f > 0 ? KEY.light : f <= -0.4 ? KEY.outline : KEY.dark;
  const out = rgb(hex).map((v, i) => {
    const s = f > 0 ? v + (255 - v) * f : v * (1 + f) + (i === 2 ? -f * 30 : 0);
    return Math.min(255, Math.max(0, Math.round(s))).toString(16).padStart(2, "0");
  });
  return snap("#" + out.join(""));
}

export function pixels(w: number, h: number, draw: Draw): PixelImage {
  const W = w + 2;
  const H = h + 2;
  const grid: (string | null)[] = new Array(W * H).fill(null);
  const set: Px = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < w && y < h) grid[(y + 1) * W + x + 1] = c;
  };
  const R: Rect = (x, y, a, b, c) => {
    for (let j = 0; j < b; j++) {
      for (let i = 0; i < a; i++) {
        let f = 0;
        if (a >= 4 && b >= 4) {
          if (j === 0 || i === 0) f = 0.22;
          if (j === b - 1 || i === a - 1) f = -0.25;
        } else if (a >= 3 && b >= 3 && j === 0) f = 0.15;
        set(x + i, y + j, f ? shade(c, f) : snap(c));
      }
    }
  };
  const E: Ellipse = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        if (u * u + v * v > 1) continue;
        const t = u * 0.6 + v * 0.8;
        set(x, y, t < -0.5 ? shade(c, 0.22) : t > 0.5 ? shade(c, -0.25) : snap(c));
      }
    }
  };
  const T: Tri = (cx, y, hw, h2, c) => {
    for (let i = 0; i < h2; i++) {
      const a = Math.round((2 * hw * (i + 1)) / h2);
      R(cx - (a >> 1), y + i, a, 1, i % 3 === 2 ? shade(c, -0.15) : c);
    }
  };
  draw(R, E, set, T);

  const out = grid.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (grid[i]) continue;
      const n = [x > 0 && grid[i - 1], x < W - 1 && grid[i + 1], y > 0 && grid[i - W], y < H - 1 && grid[i + W]].find(Boolean);
      if (n) out[i] = shade(n, -0.6);
    }
  }
  return { width: W, height: H, colors: out };
}
