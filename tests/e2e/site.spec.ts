// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { expect, test } from "@playwright/test";

test("landing page renders and switches language in place", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("./");

  await expect(page.locator("h1")).toHaveText("Pocket Pantheon");
  await expect(page.locator("meta[name=generator]")).toHaveAttribute("content", "PocketPantheon-Core");
  await expect(page.locator("#roll")).toHaveText("Roll a new world");
  await expect(page.locator("#road li")).toHaveCount(9);

  await page.getByRole("button", { name: "ES" }).click();
  await expect(page.locator("#roll")).toHaveText("Genera un mundo nuevo");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect(logs).toContain("⚡ [Pocket Pantheon] Preview initialized");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("play placeholder works in both languages", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("./play/");

  await expect(page.locator("[data-i=soon]")).toHaveText("The world arrives in Phase 1.");
  await page.getByRole("button", { name: "ES" }).click();
  await expect(page.locator("[data-i=soon]")).toHaveText("El mundo llega en la Fase 1.");
  await expect.poll(() => logs.some((l) => l.startsWith("⚡ [Pocket Pantheon] Engine initialized v"))).toBe(true);

  await page.reload();
  await expect(page.locator("[data-i=soon]")).toHaveText("El mundo llega en la Fase 1.");
});
