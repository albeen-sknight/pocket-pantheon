// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { expect, test, type Page } from "@playwright/test";

type Hooks = { world(): { w: number; h: number; height: Float32Array; options: { seed: number } } | null; renderer: string };

// The isolation service worker reloads the page once on a first visit, so
// wait for that before touching anything.
const ready = (page: Page) =>
  page.waitForFunction(() => window.crossOriginIsolated && (window as unknown as { __pp?: Hooks }).__pp?.world(), null, { timeout: 30_000 });

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
  await expect(page.locator("#tabs button[data-tab=life]")).toBeDisabled();
  await page.getByRole("button", { name: "ES" }).click();
  await expect(page.locator("#t-seed")).toHaveText("Semilla 4242");
  await expect(page.locator("#t-year")).toHaveText("Año 0");
  await expect(page.locator("#tabs button[data-tab=shape]")).toContainText("Moldear");
  expect(logs.some((l) => l.startsWith("⚡ [Pocket Pantheon] Engine initialized v"))).toBe(true);
});

test("raise brush changes the land under the cursor", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  const box = (await page.locator("#world").boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const read = () =>
    page.evaluate(({ x, y }) => {
      const pp = (window as unknown as { __pp: Hooks & { camera: { toWorld(x: number, y: number): [number, number] } } }).__pp;
      const [tx, ty] = pp.camera.toWorld(x * devicePixelRatio, y * devicePixelRatio);
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

test("inspect shows what is on a tile", async ({ page }) => {
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  await page.keyboard.press("8");
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#insp dl")).toContainText("Biome");
});
