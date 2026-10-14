// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Sprite maker ported from the concept preview: square pixels, light from the
// top left, a 3 tone bevel and a 1 px outline in a darker shade of the fill.
// Every colour snaps to the master palette.
import palette from "../../data/palette.json";
import { COLORS, rgb } from "./palette";

type Px = (x: number, y: number, c: string) => void;
type Rect = (x: number, y: number, w: number, h: number, c: string) => void;
type Ellipse = (cx: number, cy: number, rx: number, ry: number, c: string) => void;
type Tri = (cx: number, y: number, hw: number, h: number, c: string) => void;
export type Draw = (R: Rect, E: Ellipse, P: Px, T: Tri) => void;

const fromPreview: Record<string, string> = palette.fromPreview;

// Clothes are drawn in these key colours; the sprite shader swaps them for
// the wearer's kingdom colour at draw time.
export const KEY = { base: "#ff00fe", light: "#ff60fe", dark: "#c000c0", outline: "#600060" };
const KEYS = new Set(Object.values(KEY));
const paletteLab = COLORS.map(rgb);

// Nearest palette colour, so bevel and outline shades stay on palette.
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

export function mk(w: number, h: number, draw: Draw, scale = 3): HTMLCanvasElement {
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

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  out.forEach((c, i) => {
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(i % W, (i / W) | 0, 1, 1);
  });
  cv.style.width = W * scale + "px";
  cv.style.height = H * scale + "px";
  cv.className = "px";
  cv.setAttribute("aria-hidden", "true");
  return cv;
}

const Y = "#f2c94c";
const WH = "#f4f0e8";

// The eight power tab icons from the preview, 14 x 14.
export const TAB_ICONS: Record<string, Draw> = {
  shape: (R, E, P, T) => { T(7, 2, 7, 12, "#8a8f9a"); T(7, 2, 2, 4, WH); },
  life: (R, E) => { R(6, 6, 2, 8, "#3f9f3a"); E(4, 6, 3, 2, "#5fbf4a"); E(10, 4, 3, 2, "#5fbf4a"); },
  cmd: (R) => { R(3, 0, 2, 14, "#8a5a36"); R(5, 1, 8, 6, "#3b6fd4"); },
  wrath: (R) => { R(7, 0, 5, 2, Y); R(6, 2, 4, 2, Y); R(4, 4, 8, 2, Y); R(6, 6, 4, 2, Y); R(5, 8, 3, 3, Y); R(4, 11, 2, 3, Y); },
  grace: (R, E, P) => {
    E(7, 7, 3.6, 3.6, Y);
    [[7, 0], [7, 13], [0, 7], [13, 7], [2, 2], [11, 2], [2, 11], [11, 11]].forEach(([x, y]) => P(x!, y!, snap(Y)));
  },
  gene: (R, E, P) => {
    for (let y = 0; y < 14; y++) {
      const s = Math.round(3 * Math.sin(y * 0.62));
      P(7 + s, y, snap("#b06be0"));
      P(6 - s, y, snap("#5cc8e6"));
      if (y % 3 === 1 && Math.abs(s) > 1) R(Math.min(7 + s, 6 - s) + 1, y, Math.abs(2 * s) - 1, 1, "#c8d0dc");
    }
  },
  world: (R, E) => { E(7, 7, 6, 6, "#3b78d8"); E(5, 5, 3, 2, "#5fbf4a"); E(9, 9, 2.5, 2, "#5fbf4a"); },
  insp: (R, E) => { E(5, 5, 4.5, 4.5, "#5cc8e6"); E(5, 5, 2, 2, "#d8f0f8"); R(9, 9, 2, 2, "#8a5a36"); R(11, 11, 3, 3, "#8a5a36"); },
};

// Shelf tool icons, 12 x 12.
export const TOOL_ICONS: Record<string, Draw> = {
  pan: (R) => { R(5, 0, 2, 12, WH); R(0, 5, 12, 2, WH); R(4, 1, 4, 1, WH); R(4, 10, 4, 1, WH); R(1, 4, 1, 4, WH); R(10, 4, 1, 4, WH); },
  raise: (R, E, P, T) => { T(6, 1, 6, 7, "#5fbf4a"); R(5, 8, 2, 4, Y); },
  lower: (R, E, P, T) => { R(0, 2, 12, 3, "#5fbf4a"); R(3, 5, 6, 3, "#3b78d8"); R(5, 8, 2, 4, Y); },
  flatten: (R) => { R(0, 6, 12, 3, "#5fbf4a"); R(0, 9, 12, 3, "#8a5a36"); R(1, 2, 10, 2, WH); },
  smooth: (R, E) => { E(6, 8, 6, 3, "#5fbf4a"); R(0, 9, 12, 3, "#8a5a36"); },
  paint: (R) => { R(5, 0, 2, 7, "#8a5a36"); R(4, 7, 4, 3, "#aab0bc"); R(4, 10, 4, 2, "#e04040"); },
  island: (R, E) => { R(0, 7, 12, 5, "#3b78d8"); E(6, 7, 4, 3, "#f0d9a0"); E(6, 6, 2, 2, "#5fbf4a"); },
  volcano: (R, E, P, T) => { T(6, 3, 6, 9, "#5a2a30"); R(5, 3, 2, 2, "#f08a2c"); R(4, 0, 2, 2, "#8a8f9a"); },
  range: (R, E, P, T) => { T(4, 3, 4, 9, "#8a8f9a"); T(8, 1, 4, 11, "#aab0bc"); T(8, 1, 1, 3, WH); },
  new: (R, E) => { E(6, 6, 5, 5, "#3b78d8"); E(4, 4, 2, 2, "#5fbf4a"); R(9, 0, 3, 1, Y); R(10, 0, 1, 3, Y); },
  saves: (R) => { R(1, 1, 10, 10, "#3b6fd4"); R(3, 1, 6, 4, WH); R(3, 7, 6, 4, "#2b2233"); },
  stats: (R) => { R(0, 11, 12, 1, "#aab0bc"); R(1, 6, 2, 5, "#3b6fd4"); R(5, 2, 2, 9, "#f2c94c"); R(9, 4, 2, 7, "#d9453d"); },
  export: (R) => { R(5, 0, 2, 8, "#5fbf4a"); R(3, 5, 6, 2, "#5fbf4a"); R(0, 9, 12, 3, "#aab0bc"); },
  import: (R) => { R(5, 2, 2, 7, "#5cc8e6"); R(3, 3, 6, 2, "#5cc8e6"); R(0, 9, 12, 3, "#aab0bc"); },
  fit: (R) => { R(0, 0, 4, 2, WH); R(0, 0, 2, 4, WH); R(8, 0, 4, 2, WH); R(10, 0, 2, 4, WH); R(0, 10, 4, 2, WH); R(0, 8, 2, 4, WH); R(8, 10, 4, 2, WH); R(10, 8, 2, 4, WH); },
};
