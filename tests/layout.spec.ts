// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Layout checks at the awkward sizes the UI audit found problems with.
import { expect, test, type Page } from "@playwright/test";

type Hooks = { frame(): unknown };

// Isolation comes from a shim that reloads the page once, early on. It
// sometimes doesn't isolate at all, and the game runs fine without it, so a
// page that has had a frame and no reload for 8 seconds counts as ready.
const ready = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __pp?: Hooks }).__pp?.frame() && (window.crossOriginIsolated || performance.now() > 8000), null, { timeout: 45_000 });

// The sizes are set here, so one browser project is enough.
test.beforeEach(({ page: _ }, info) => test.skip(info.project.name !== "desktop", "sizes are set per test"));

const onScreen = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }),
  );

test("a phone held sideways shows all eight tabs", async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await page.addInitScript(() => localStorage.setItem("pp_tutorial_completed", "1"));
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  expect(await onScreen(page, "#tabs button")).toEqual(new Array(8).fill(true));
  // and no tab hides under the shelf
  const overlap = await page.evaluate(() => {
    const shelf = document.querySelector("#shelf")!.getBoundingClientRect();
    return [...document.querySelectorAll("#tabs button")].some((b) => b.getBoundingClientRect().bottom > shelf.top + 1);
  });
  expect(overlap).toBe(false);
});

test("the smallest phone keeps the top bar on screen and the tutorial buttons in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.removeItem("pp_tutorial_completed"));
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  await expect(page.locator("#tutorial")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await onScreen(page, "#top button")).not.toContain(false);
  expect(await onScreen(page, "[data-tutorial-action]")).toEqual([true, true]);
  // icon only buttons still have names
  for (const id of ["#stats-btn", "#settings-btn", "#codex-btn"]) await expect(page.locator(id)).toHaveAccessibleName(/\S/);
});
