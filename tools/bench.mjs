// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Phase gate check: generation time and frame rate at each zoom level, in a
// real Chromium with the GPU on. Run `npm run dev` first, then `npm run bench`.
import { chromium } from "@playwright/test";

const url = process.env.PP_URL ?? "http://localhost:5173/play/";
const size = process.argv[2] ?? "large";

const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=default"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${url}?seed=4242&size=${size}`);
await page.waitForFunction(() => window.__pp?.world());

const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
});
const genMs = await page.evaluate(() => window.__pp.genMs());
console.log(`gpu: ${gpu}`);
console.log(`${size} world generated in ${Math.round(genMs)} ms`);

for (const scale of [3, 12, 32, 96]) {
  await page.evaluate((s) => {
    const cam = window.__pp.camera;
    cam.zoomTo(s, cam.viewW / 2, cam.viewH / 2);
  }, scale);
  await page.waitForTimeout(1500);
  const fps = await page.evaluate(() => window.__pp.fps());
  console.log(`zoom ${scale} px per tile: ${fps} fps`);
}
await browser.close();
