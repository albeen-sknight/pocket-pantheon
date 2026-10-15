// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Sprite maker ported from the concept preview: square pixels, light from the
// top left, a 3 tone bevel and a 1 px outline in a darker shade of the fill.
// Every colour snaps to the master palette.
import { pixels, snap, type Draw } from "./pixels";
import { rgb } from "./palette";

export { KEY, shade, snap, type Draw } from "./pixels";

export function mk(w: number, h: number, draw: Draw, scale = 3): HTMLCanvasElement {
  const image = pixels(w, h, draw);
  const cv = document.createElement("canvas");
  cv.width = image.width;
  cv.height = image.height;
  const ctx = cv.getContext("2d")!;
  const data = ctx.createImageData(image.width, image.height);
  image.colors.forEach((c, i) => {
    if (!c) return;
    const [r, g, b] = rgb(c);
    const p = i * 4;
    data.data[p] = r!;
    data.data[p + 1] = g!;
    data.data[p + 2] = b!;
    data.data[p + 3] = 255;
  });
  ctx.putImageData(data, 0, 0);
  cv.style.width = image.width * scale + "px";
  cv.style.height = image.height * scale + "px";
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
  share: (R) => { R(1, 4, 5, 2, "#5cc8e6"); R(1, 6, 2, 3, "#5cc8e6"); R(6, 6, 5, 2, "#5cc8e6"); R(9, 3, 2, 3, "#5cc8e6"); R(4, 5, 4, 2, WH); },
  restart: (R) => { R(3, 1, 6, 2, "#5fbf4a"); R(1, 3, 2, 6, "#5fbf4a"); R(3, 9, 6, 2, "#5fbf4a"); R(9, 7, 2, 2, "#5fbf4a"); R(8, 0, 2, 5, Y); R(6, 3, 4, 2, Y); },
  help: (R, E) => { E(6, 6, 5.5, 5.5, "#3b6fd4"); R(4, 2, 4, 2, WH); R(7, 4, 2, 2, WH); R(5, 6, 2, 2, WH); R(5, 9, 2, 2, WH); },
  gear: (R, E) => { E(6, 6, 5, 5, "#aab0bc"); R(5, 0, 2, 12, "#aab0bc"); R(0, 5, 12, 2, "#aab0bc"); E(6, 6, 2, 2, "#2b2233"); },
  book: (R) => { R(1, 1, 10, 10, "#b06be0"); R(2, 2, 1, 8, "#f4f0e8"); R(5, 4, 4, 1, "#f2c94c"); R(5, 6, 4, 1, "#f2c94c"); },
  stats: (R) => { R(0, 11, 12, 1, "#aab0bc"); R(1, 6, 2, 5, "#3b6fd4"); R(5, 2, 2, 9, "#f2c94c"); R(9, 4, 2, 7, "#d9453d"); },
  export: (R) => { R(5, 0, 2, 8, "#5fbf4a"); R(3, 5, 6, 2, "#5fbf4a"); R(0, 9, 12, 3, "#aab0bc"); },
  import: (R) => { R(5, 2, 2, 7, "#5cc8e6"); R(3, 3, 6, 2, "#5cc8e6"); R(0, 9, 12, 3, "#aab0bc"); },
  fit: (R) => { R(0, 0, 4, 2, WH); R(0, 0, 2, 4, WH); R(8, 0, 4, 2, WH); R(10, 0, 2, 4, WH); R(0, 10, 4, 2, WH); R(0, 8, 2, 4, WH); R(8, 10, 4, 2, WH); R(10, 8, 2, 4, WH); },
};
