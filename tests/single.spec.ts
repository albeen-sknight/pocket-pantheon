// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The offline single file (PLAN sections 22 and 23), opened straight from
// disk with the network switched off.
import { expect, test } from "@playwright/test";

type Hooks = { frame(): { year: number; pop: number } | null };

test("pocketpantheon.html runs from file:// with no network", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one browser is enough");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const blocked: string[] = [];
  await page.route(/^https?:/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  const file = "file:///" + `${info.project.testDir}/../dist/pocketpantheon.html`.replace(/\\/g, "/").replace(/^\/+/, "");
  await page.addInitScript(() => localStorage.setItem("pp_tutorial_completed", "1"));
  await page.goto(file);
  await page.waitForFunction(() => (window as unknown as { __pp?: Hooks }).__pp?.frame(), null, { timeout: 60_000 });
  await expect(page.locator("#t-year")).toHaveText(/^Year [0-9]+$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pp: Hooks }).__pp.frame()!.pop), { timeout: 20_000 }).toBeGreaterThan(0);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [document.fonts.check("16px 'Pixelify Sans'"), document.fonts.check("16px Outfit")];
  });
  expect(fonts).toEqual([true, true]);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});
