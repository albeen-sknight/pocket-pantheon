// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Two finger gestures, sent through the browser's own touch input.
import { expect, test, type Page } from "@playwright/test";

type Hooks = { frame(): unknown; camera: { scale: number; target: number } };

// Isolation comes from a shim that reloads the page once, early on. It
// sometimes doesn't isolate at all, and the game runs fine without it, so a
// page that has had a frame and no reload for 8 seconds counts as ready.
const ready = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __pp?: Hooks }).__pp?.frame() && (window.crossOriginIsolated || performance.now() > 8000), null, { timeout: 45_000 });

test.beforeEach(({ page: _ }, info) => test.skip(info.project.name !== "phone", "touch only"));

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem("pp_tutorial_completed", "1"));
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  await page.locator("#tabs button[data-tab=wrath]").click();
  await page.locator("#shelf button", { hasText: "Lightning" }).click();
}

// The Codex unlocks Lightning the moment the power is used, so it tells us
// whether a gesture fired it.
const fired = (page: Page) => page.evaluate(() => (localStorage.getItem("pp_codex_unlocked") ?? "").includes("power:wrath_lightning"));

test("a pinch zooms the map and never fires the power", async ({ page }) => {
  await start(page);
  const box = (await page.locator("#world").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const before = await page.evaluate(() => (window as unknown as { __pp: Hooks }).__pp.camera.scale);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", d: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
    });
  await touch("touchStart", 20);
  for (let d = 30; d <= 120; d += 10) await touch("touchMove", d);
  await touch("touchEnd", 0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pp: Hooks }).__pp.camera.target)).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  expect(await fired(page)).toBe(false);
});

test("a quick tap still uses the power", async ({ page }) => {
  await start(page);
  const box = (await page.locator("#world").boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => fired(page)).toBe(true);
});
