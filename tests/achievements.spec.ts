// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { expect, test, type Page } from "@playwright/test";

type Hooks = { frame(): unknown };

// Isolation comes from a shim that reloads the page once, early on. It
// sometimes doesn't isolate at all, and the game runs fine without it, so a
// page that has had a frame and no reload for 8 seconds counts as ready.
const ready = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __pp?: Hooks }).__pp?.frame() && (window.crossOriginIsolated || performance.now() > 8000), null, { timeout: 45_000 });
const loaded = (page: Page) => page.waitForFunction(() => (window as unknown as { __pp?: Hooks }).__pp?.frame(), null, { timeout: 45_000 });

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem("pp_tutorial_completed", "1"));
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
}

async function achievementsTab(page: Page) {
  await page.locator("#stats-btn").click();
  await page.locator("#stats").getByRole("tab", { name: "Achievements" }).click();
  return page.locator("#stats .st-ach li");
}

test("dropping the bomb earns an achievement that stays earned", async ({ page }) => {
  await start(page);
  await page.locator("#tabs button[data-tab=wrath]").click();
  await page.locator("#shelf button", { hasText: "Atomic bomb" }).click();
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#toast")).toContainText("Achievement earned: Big red button");

  const items = await achievementsTab(page);
  await expect(items).toHaveCount(19);
  await expect(items.filter({ hasText: "Big red button" })).toHaveAttribute("data-earned", "true");
  await expect(items.filter({ hasText: "Second chances" })).toHaveAttribute("data-earned", "false");

  await page.goto("./");
  await page.goto("./play/?seed=4242&size=small");
  await loaded(page);
  const again = await achievementsTab(page);
  await expect(again.filter({ hasText: "Big red button" })).toHaveAttribute("data-earned", "true");
});

test("broken saved achievements are ignored", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("pp_achievements", JSON.stringify({ got: { nuke: "yesterday", made_up: 5, war: 1 }, wrath: "all" })));
  await start(page);
  const items = await achievementsTab(page);
  await expect(items.filter({ hasText: "Big red button" })).toHaveAttribute("data-earned", "false");
  await expect(items.filter({ hasText: "Drums of war" })).toHaveAttribute("data-earned", "true");
});
