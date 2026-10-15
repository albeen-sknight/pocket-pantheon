// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { expect, test, type Page } from "@playwright/test";

type Hooks = { frame(): unknown };

// Isolation comes from a shim that reloads the page once, early on. It
// sometimes doesn't isolate at all, and the game runs fine without it, so a
// page that has had a frame and no reload for 8 seconds counts as ready.
const ready = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __pp?: Hooks }).__pp?.frame() && (window.crossOriginIsolated || performance.now() > 8000), null, { timeout: 45_000 });
// After a reload the isolation shim sometimes doesn't isolate again, and the
// game runs fine without it, so only the first frame matters here.
const reloaded = (page: Page) => page.waitForFunction(() => (window as unknown as { __pp?: Hooks }).__pp?.frame(), null, { timeout: 45_000 });

// Every test starts with the tutorial done, so its card stays out of the way.
async function start(page: Page, stored?: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("pp_tutorial_completed", "1");
    if (value !== null && !sessionStorage.getItem("pp_codex_test_seeded")) {
      localStorage.setItem("pp_codex_unlocked", value);
      sessionStorage.setItem("pp_codex_test_seeded", "1");
    }
  }, stored ?? null);
  await page.goto("./play/?seed=4242&size=small&races=human");
  await ready(page);
}

const codex = (page: Page) => page.locator("#codex");

async function spawnDragon(page: Page) {
  await page.locator("#tabs button[data-tab=life]").click();
  await page.locator("#shelf button", { hasText: "Dragon" }).click();
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Writes Codex data from the landing page, which shares the origin but runs no
// game, so a running Codex can't save over it, then opens the game again.
async function storeAndReturn(page: Page, data: unknown) {
  await page.goto("./");
  await page.evaluate((d) => localStorage.setItem("pp_codex_unlocked", JSON.stringify(d)), data);
  await page.goto("./play/?seed=4242&size=small&races=human");
  await reloaded(page);
}

async function openEntry(page: Page, name: string) {
  await page.locator("#codex-btn").click();
  await codex(page).getByRole("searchbox").fill(name);
  await codex(page).locator(".cx-item", { hasText: name }).first().click();
  await expect(codex(page).locator(".cx-article h3")).toHaveText(name);
}

// Any page error fails the test, not just a log line.
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(`${e.message} ${e.stack?.slice(0, 300)}`));
});
test.afterEach(() => expect(errors).toEqual([]));

test("opens, shows locked entries without their secrets, and closes", async ({ page }) => {
  await start(page);
  await page.locator("#codex-btn").click();
  await expect(codex(page).getByRole("heading", { name: "Codex" })).toBeVisible();
  await expect(codex(page).locator(".cx-progress")).toContainText("of 121 discovered");

  await codex(page).getByRole("button", { name: "Creatures", exact: true }).click();
  const locked = codex(page).locator('.cx-item[data-locked="true"]');
  await expect(locked.first()).toHaveText("?Undiscovered");
  await locked.first().click();
  const article = codex(page).locator(".cx-article");
  await expect(article.locator("h3")).toHaveText("Undiscovered");
  await expect(article.locator(".cx-lore, dl, .cx-links")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(codex(page)).toBeHidden();
  await page.keyboard.press("c");
  await expect(codex(page)).toBeVisible();
  await codex(page).getByRole("button", { name: "Close" }).click();
  await expect(codex(page)).toBeHidden();
});

test("spawning a dragon unlocks it once, with one toast and a badge you can clear", async ({ page }) => {
  await start(page);
  // toasts fade after a few seconds, so keep a list of every one that appears
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { toasts: string[] }).toasts = []);
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => seen.push(n.textContent ?? "")))).observe(document.querySelector("#toast")!, { childList: true });
  });
  await spawnDragon(page);
  await expect(page.locator("#toast")).toContainText("New in the Codex: Dragon");
  const badge = page.locator("#codex-btn .badge");
  await expect(badge).toBeVisible();
  // the living world keeps making its own discoveries, so count the dragon, not the badge
  const fresh = () => page.evaluate(() => (JSON.parse(localStorage.getItem("pp_codex_unlocked")!) as { fresh: string[] }).fresh.filter((id) => id === "creature:dragon").length);

  // a second dragon is not news
  await spawnDragon(page);
  await page.waitForTimeout(1500);
  const toasts = await page.evaluate(() => (window as unknown as { toasts: string[] }).toasts);
  expect(toasts.filter((x) => x.includes("Dragon"))).toHaveLength(1);
  expect(await fresh()).toBe(1);

  await page.locator("#codex-btn").click();
  await codex(page).getByRole("searchbox").fill("Dragon");
  const item = codex(page).locator(".cx-item", { hasText: "Dragon" });
  await expect(item.locator(".cx-dot")).toHaveCount(1);
  await item.click();
  await expect(codex(page).locator(".cx-article .cx-lore")).toContainText("burn a village");
  await expect(item.locator(".cx-dot")).toHaveCount(0);
  expect(await fresh()).toBe(0);

  await codex(page).getByRole("button", { name: "Mark all as seen" }).click();
  await expect(badge).toBeHidden();
  await expect(page.locator("#codex-btn")).toHaveAttribute("aria-label", "Open the Codex");
});

test("cross references, search and category filters work together", async ({ page }) => {
  await start(page);
  await spawnDragon(page);
  await openEntry(page, "Dragon");
  await codex(page).locator(".cx-links button", { hasText: "Mountains" }).click();
  await expect(codex(page).locator(".cx-article h3")).toHaveText("Mountains");
  await expect(codex(page).locator(".cx-article small")).toHaveText("Biome");

  if (page.viewportSize()!.width <= 700) await codex(page).getByRole("button", { name: "Back to the list" }).click();
  await codex(page).getByRole("searchbox").fill("Human");
  await codex(page).getByRole("button", { name: "Creatures", exact: true }).click();
  await expect(codex(page).locator(".cx-item")).toHaveCount(1);
  await codex(page).getByRole("button", { name: "Biomes", exact: true }).click();
  await expect(codex(page).locator(".cx-empty")).toHaveText("No discovered entry matches that search.");
  // a locked entry never matches, so search can't give its name away
  await codex(page).getByRole("searchbox").fill("Clawzilla");
  await codex(page).getByRole("button", { name: "All", exact: true }).click();
  await expect(codex(page).locator(".cx-item")).toHaveCount(0);
});

test("an open article switches language in place", async ({ page }) => {
  await start(page);
  await openEntry(page, "Human");
  // the dialog is modal, so the switch is pressed directly
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#lang [data-l="es"]')!.click());
  await expect(codex(page).locator(".cx-article h3")).toHaveText("Humano");
  await expect(codex(page).locator(".cx-article .cx-sum")).toHaveText("Un pueblo adaptable que puede asentarse en cualquier tierra.");
  await expect(codex(page).getByRole("heading", { name: "Códice" })).toBeVisible();
  await expect(codex(page).locator("input[type=search]")).toHaveAttribute("placeholder", "Buscar en el Códice");
});

test("unlocks survive a reload", async ({ page }) => {
  await start(page);
  await spawnDragon(page);
  await expect(page.locator("#toast")).toContainText("Dragon");
  await page.reload();
  await reloaded(page);
  await openEntry(page, "Dragon");
  await expect(codex(page).locator(".cx-article .cx-sum")).toBeVisible();
});

test("broken saved Codex data is ignored safely", async ({ page }) => {
  await start(page, "{not json");
  await page.locator("#codex-btn").click();
  await expect(codex(page).locator(".cx-progress")).toContainText("of 121 discovered");
  await page.keyboard.press("Escape");
  // a well formed file with junk inside keeps only what it recognises
  await storeAndReturn(page, { unlocked: ["creature:dragon", 5, "creature:nothing"], fresh: "x" });
  await openEntry(page, "Dragon");
});

test("the layout fits the screen, with a list and article view on phones", async ({ page }) => {
  await start(page);
  await page.locator("#codex-btn").click();
  const fits = () => page.evaluate(() => {
    const d = document.querySelector("#codex")!;
    return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1;
  });
  expect(await fits()).toBe(true);
  await codex(page).locator(".cx-item", { hasText: "Human" }).click();
  const phone = page.viewportSize()!.width <= 700;
  await expect(codex(page).locator(".cx-side")).toBeVisible({ visible: !phone });
  await expect(codex(page).locator(".cx-article h3")).toHaveText("Human");
  if (phone) {
    await codex(page).getByRole("button", { name: "Back to the list" }).tap();
    await expect(codex(page).locator(".cx-side")).toBeVisible();
    await expect(codex(page).locator(".cx-article")).toBeHidden();
  }
  // every control is big enough to hit with a finger
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#codex button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 32).length,
  );
  expect(small).toBe(0);
  expect(await fits()).toBe(true);
});

test("every entry draws its icon and article once unlocked", async ({ page }) => {
  await start(page);
  await page.locator("#codex-btn").click();
  const ids = await codex(page).locator(".cx-item").evaluateAll((items) => items.map((b) => (b as HTMLElement).dataset.id!));
  expect(ids).toHaveLength(121);
  await storeAndReturn(page, { unlocked: ids, fresh: [] });
  await page.locator("#codex-btn").click();
  await expect(codex(page).locator(".cx-progress")).toHaveText("121 of 121 discovered");
  await expect(codex(page).locator('.cx-item[data-locked="true"]')).toHaveCount(0);
  // open every article; a broken icon or missing string would throw here
  const titles = await codex(page).locator(".cx-item").evaluateAll((items) =>
    items.map((b) => {
      (b as HTMLButtonElement).click();
      return document.querySelector("#codex .cx-article h3")!.textContent;
    }),
  );
  expect(titles.filter((x) => !x || x.startsWith("cx_") || x === "Undiscovered")).toEqual([]);
});
