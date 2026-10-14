// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { expect, test, type Page } from "@playwright/test";

type GameHooks = { frame(): unknown };

const ready = (page: Page) =>
  page.waitForFunction(() => window.crossOriginIsolated && (window as unknown as { __pp?: GameHooks }).__pp?.frame(), null, { timeout: 45_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pp_tutorial_test_reset")) return;
    localStorage.removeItem("pp_tutorial_completed");
    sessionStorage.setItem("pp_tutorial_test_reset", "1");
  });
  await page.goto("./play/?seed=4242&size=small");
  await ready(page);
  await expect(page.locator("#tutorial")).toBeVisible();
});

test("starts on a first visit and changes language in place", async ({ page }) => {
  const tutorial = page.locator("#tutorial");
  await expect(tutorial).toHaveAttribute("data-step", "1");
  await expect(tutorial.getByRole("heading", { name: "Camera controls" })).toBeVisible();
  await expect(page.locator("#tutorial-count")).toHaveText("Step 1 of 10");
  await expect(page.locator("#tutorial-action")).toHaveText("Drag the map or zoom with your wheel or two fingers.");
  await expect(page.locator(".tutorial-checklist li")).toHaveCount(10);
  await expect(page.locator('.tutorial-checklist li[aria-current="step"]')).toHaveCount(1);

  await page.getByRole("button", { name: "ES" }).click();
  await expect(tutorial.getByRole("heading", { name: "Controles de cámara" })).toBeVisible();
  await expect(page.locator("#tutorial-count")).toHaveText("Paso 1 de 10");
  await expect(page.locator("#tutorial-action")).toHaveText("Arrastra el mapa o usa la rueda o dos dedos para acercar y alejar.");
});

test("next advances and map actions complete steps", async ({ page }) => {
  const tutorial = page.locator("#tutorial");
  await page.locator('[data-tutorial-action="next"]').click();
  await expect(tutorial).toHaveAttribute("data-step", "2");
  await expect(page.locator('#tabs button[data-tab="shape"]')).toHaveAttribute("aria-selected", "true");

  await page.locator('[data-tutorial="shape-raise"]').click();
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tutorial).toHaveAttribute("data-step", "3");

  await page.locator('[data-tutorial="spawn-human"]').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tutorial).toHaveAttribute("data-step", "4");
});

test("can close, replay from World and skip", async ({ page }) => {
  const tutorial = page.locator("#tutorial");
  await page.getByRole("button", { name: "Close tutorial" }).click();
  await expect(tutorial).toBeHidden();

  await page.locator('#tabs button[data-tab="world"]').click();
  await page.getByRole("button", { name: "Replay tutorial" }).click();
  await expect(tutorial).toHaveAttribute("data-step", "1");
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await expect(tutorial).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("pp_tutorial_completed"))).toBe("1");

  await page.reload();
  await ready(page);
  await expect(tutorial).toBeHidden();
});
