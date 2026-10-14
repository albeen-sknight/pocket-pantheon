// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  world(): { w: number; h: number; height: Float32Array; options: { seed: number } } | null;
  frame(): { pop: number; year: number } | null;
  renderer: string;
  ratio(): number;
};

// The isolation service worker reloads the page once on a first visit, so
// wait for that before touching anything.
const ready = (page: Page) =>
  page.waitForFunction(() => window.crossOriginIsolated && (window as unknown as { __pp?: Hooks }).__pp?.frame(), null, { timeout: 45_000 });

// Page errors are printed so a CI failure says what broke, not just that it timed out.
test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => console.log("page error:", e.message, e.stack?.slice(0, 400)));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`console ${m.type()}:`, m.text().slice(0, 300)));
});

test("landing page renders, switches language and links to the game", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("./");

  await expect(page.locator("h1")).toHaveText("Pocket Pantheon");
  await expect(page.locator("meta[name=generator]")).toHaveAttribute("content", "PocketPantheon-Core");
  await expect(page.locator("#roll")).toHaveText("Roll a new world");
  await expect(page.locator("#road li")).toHaveCount(9);
  await expect(page.locator("#play")).toHaveAttribute("href", "play/");

  await page.getByRole("button", { name: "ES" }).click();
  await expect(page.locator("#roll")).toHaveText("Genera un mundo nuevo");
  await expect(page.locator("#play")).toHaveText("Juega ya");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect(logs).toContain("⚡ [Pocket Pantheon] Preview initialized");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("the game builds a world and switches language in place", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);

  await expect(page.locator("#t-seed")).toHaveText("Seed 4242");
  await expect(page.locator("#tabs button:disabled")).toHaveCount(0);
  await page.getByRole("button", { name: "ES" }).click();
  await expect(page.locator("#t-seed")).toHaveText("Semilla 4242");
  await expect(page.locator("#t-year")).toHaveText(/^Año [0-9]+$/);
  await expect(page.locator("#tabs button[data-tab=shape]")).toContainText("Moldear");
  expect(logs.some((l) => l.startsWith("⚡ [Pocket Pantheon] Engine initialized v"))).toBe(true);
});

test("raise brush changes the land under the cursor", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small&races=");
  await ready(page);
  await page.keyboard.press("1");
  const box = (await page.locator("#world").boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const read = () =>
    page.evaluate(({ x, y }) => {
      const pp = (window as unknown as { __pp: Hooks & { camera: { toWorld(x: number, y: number): [number, number] } } }).__pp;
      const [tx, ty] = pp.camera.toWorld(x * pp.ratio(), y * pp.ratio());
      const w = pp.world()!;
      return w.height[Math.floor(ty) * w.w + Math.floor(tx)]!;
    }, at);
  const before = await read();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  expect(await read()).toBeGreaterThan(before);
});

test("saves to a slot and loads it back", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  await page.locator("#tabs button[data-tab=world]").click();
  await page.locator("#shelf button", { hasText: "Save and load" }).click();
  await page.locator(".slots li", { hasText: "Slot 1" }).getByRole("button", { name: "Save here" }).click();
  await expect(page.locator("#toast")).toContainText("Saved to slot 1.");

  await page.evaluate(() => (window as unknown as { __pp: { generate(o: object): Promise<void> } }).__pp.generate({ seed: 99, size: "small" }));
  await expect(page.locator("#t-seed")).toHaveText("Seed 99");
  await page.locator(".slots li", { hasText: "Slot 1" }).getByRole("button", { name: "Load" }).click();
  await expect(page.locator("#t-seed")).toHaveText("Seed 4242");
});

test("inspect shows what is under the cursor", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small&races=");
  await ready(page);
  await page.keyboard.press("8");
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // a tile, or whichever animal happened to wander under the click
  await expect(page.locator("#insp dl")).toContainText(/Biome|Health/);
});

test("spawning people from the Life tab adds to the population", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small&races=");
  await ready(page);
  const pop = () => page.evaluate(() => (window as unknown as { __pp: Hooks }).__pp.frame()!.pop);
  expect(await pop()).toBe(0);
  await page.locator("#tabs button[data-tab=life]").click();
  await page.locator("#shelf button", { hasText: "Human" }).click();
  // drop them on the first land tile near the middle of the view
  const at = await page.evaluate(() => {
    const pp = (window as unknown as { __pp: Hooks & { camera: { x: number; y: number; scale: number }; ratio(): number } }).__pp;
    const w = pp.world()!;
    const c = pp.camera;
    for (let r = 0; r < 60; r++) {
      for (let a = 0; a < 16; a++) {
        const tx = Math.floor(w.w / 2 + Math.cos(a) * r);
        const ty = Math.floor(w.h / 2 + Math.sin(a) * r);
        if (w.height[ty * w.w + tx]! > 0.45) return { x: ((tx + 0.5 - c.x) * c.scale) / pp.ratio(), y: ((ty + 0.5 - c.y) * c.scale) / pp.ratio() };
      }
    }
    return null;
  });
  expect(at).not.toBeNull();
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + at!.x, box.y + at!.y);
  await expect.poll(pop).toBeGreaterThan(0);
});

test("kingdoms are counted and Grace powers answer a click", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  await expect(page.locator("#t-kin")).toHaveText(/^Kingdoms [1-9]/);
  await page.locator("#tabs button[data-tab=grace]").click();
  await page.locator("#shelf button", { hasText: "Bless" }).click();
  await expect(page.locator("#shelf button", { hasText: "Bless" })).toHaveAttribute("aria-pressed", "true");
  const box = (await page.locator("#world").boundingBox())!;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("possessing someone lets the keyboard walk them around", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small&races=human");
  await ready(page);
  await page.locator("#tabs button[data-tab=cmd]").click();
  await page.locator("#shelf button", { hasText: "Possess" }).click();
  // pause so nobody walks away between aiming and clicking
  await page.evaluate(() => (window as unknown as { __pp: { speed(s: number): void } }).__pp.speed(0));
  await page.waitForTimeout(400);
  const box = (await page.locator("#world").boundingBox())!;
  // aim at the human nearest the middle of the screen
  const at = await page.evaluate(({ w, h }) => {
    const pp = (window as unknown as { __pp: { frame(): { units: Float32Array; count: number }; camera: { x: number; y: number; scale: number }; ratio(): number } }).__pp;
    const f = pp.frame();
    const c = pp.camera;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let i = 0; i < f.count; i++) {
      if (f.units[i * 5 + 3] !== 0) continue;
      const x = ((f.units[i * 5 + 1]! - c.x) * c.scale) / pp.ratio();
      const y = ((f.units[i * 5 + 2]! - 0.3 - c.y) * c.scale) / pp.ratio();
      if (x < 20 || y < 20 || x > w - 20 || y > h - 20) continue;
      const d = Math.hypot(x - w / 2, y - h / 2);
      if (d < bestD) [best, bestD] = [{ x, y }, d];
    }
    return best;
  }, { w: box.width, h: box.height });
  expect(at).not.toBeNull();
  await page.mouse.click(box.x + at!.x, box.y + at!.y);
  await expect(page.locator("#possess")).toBeVisible();
  await page.evaluate(() => (window as unknown as { __pp: { speed(s: number): void } }).__pp.speed(1));
  const where = () => page.evaluate(() => (window as unknown as { __pp: { frame(): { possessed: number } } }).__pp.frame().possessed);
  await expect.poll(where).toBeGreaterThan(0);
  const pos = () =>
    page.evaluate(() => {
      const f = (window as unknown as { __pp: { frame(): { units: Float32Array; count: number; possessed: number } } }).__pp.frame();
      for (let i = 0; i < f.count; i++) if (f.units[i * 5] === f.possessed) return f.units[i * 5 + 1]! + f.units[i * 5 + 2]!;
      return 0;
    });
  const before = await pos();
  for (const key of ["d", "s"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(400);
    await page.keyboard.up(key);
  }
  expect(Math.abs((await pos()) - before)).toBeGreaterThan(0.2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#possess")).toBeHidden();
  await expect.poll(where).toBe(0);
});

test("a Wrath power lands on the map", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small&races=");
  await ready(page);
  await page.locator("#tabs button[data-tab=wrath]").click();
  await page.locator("#shelf button", { hasText: "Meteor" }).click();
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // the falling rock shows up as a storm in the very next frames
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pp: { frame(): { storms: unknown[] } } }).__pp.frame().storms.length))
    .toBeGreaterThan(0);
});
