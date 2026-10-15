// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Sound can't be heard in a test browser, so these check the engine's state:
// when it starts, the levels it applies, what it stores and how often it plays.
import { expect, test, type Page } from "@playwright/test";

type Hooks = { frame(): unknown };
type Engine = {
  starts: number;
  failed: boolean;
  running: boolean;
  settings: { master: number; effects: number; music: number; muted: boolean };
  played: Record<string, number>;
  levels(): { master: number; effects: number; music: number } | null;
  play(name: string): void;
};

// Isolation comes from a shim that reloads the page once, early on. It
// sometimes doesn't isolate at all, and the game runs fine without it, so a
// page that has had a frame and no reload for 8 seconds counts as ready.
const ready = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __pp?: Hooks }).__pp?.frame() && (window.crossOriginIsolated || performance.now() > 8000), null, { timeout: 45_000 });
// After a reload the isolation shim sometimes doesn't isolate again, and the
// game runs fine without it, so only the first frame matters here.
const reloaded = (page: Page) => page.waitForFunction(() => (window as unknown as { __pp?: Hooks }).__pp?.frame(), null, { timeout: 45_000 });
const engine = <T>(page: Page, read: (a: Engine) => T) =>
  page.evaluate(`(${read.toString()})(window.__ppAudio)`) as Promise<T>;

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(`${e.message} ${e.stack?.slice(0, 300)}`));
});
test.afterEach(() => expect(errors).toEqual([]));

async function start(page: Page, init?: () => void) {
  await page.addInitScript(() => localStorage.setItem("pp_tutorial_completed", "1"));
  if (init) await page.addInitScript(init);
  await page.goto("./play/?seed=4242&size=small&races=human");
  await ready(page);
}

const settings = (page: Page) => page.locator("#settings");

async function openSettings(page: Page) {
  await page.locator("#settings-btn").click();
  await expect(settings(page).getByRole("heading", { name: "Settings" })).toBeVisible();
}

test("sound waits for a gesture, then starts exactly once", async ({ page }) => {
  await start(page);
  expect(await engine(page, (a) => a.starts)).toBe(0);
  const box = (await page.locator("#world").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("ArrowLeft");
  await page.locator("#speed button").first().click();
  expect(await engine(page, (a) => a.starts)).toBe(1);
  await expect.poll(() => engine(page, (a) => a.running)).toBe(true);
  await openSettings(page);
  await expect(settings(page).locator("#set-audio-note")).toHaveText("Sound is on.");
});

test("a browser without Web Audio stays silent and keeps playing", async ({ page }) => {
  await start(page, () => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined });
  });
  await openSettings(page);
  await expect(settings(page).locator("#set-audio-note")).toHaveText("This browser can't play the game's sound. Everything else works as usual.");
  await settings(page).getByLabel("Master volume").fill("30");
  await settings(page).getByRole("button", { name: "Close" }).click();
  expect(await engine(page, (a) => a.failed)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pp: { frame(): { year: number } } }).__pp.frame().year), { timeout: 20_000 }).toBeGreaterThan(1);
});

test("a blocked context that never resumes does no harm", async ({ page }) => {
  await start(page, () => {
    // a context the browser keeps suspended and refuses to resume
    const Real = AudioContext;
    class Blocked extends Real {
      constructor() {
        super();
        void super.suspend();
      }
      override resume() {
        return Promise.reject(new Error("blocked"));
      }
    }
    Object.defineProperty(window, "AudioContext", { value: Blocked });
  });
  await openSettings(page);
  await expect(settings(page).locator("#set-audio-note")).toHaveText("Sound starts after your first click or key press.");
  await settings(page).getByRole("button", { name: "Close" }).click();
  await page.evaluate(() => (window as unknown as { __ppAudio: Engine }).__ppAudio.play("boom"));
  expect(await engine(page, (a) => a.played.boom ?? 0)).toBe(0);
});

test("mute and the three sliders set their own levels and are remembered", async ({ page }) => {
  await start(page);
  await openSettings(page);
  await settings(page).getByLabel("Master volume").fill("40");
  await settings(page).getByLabel("Effects").fill("25");
  await settings(page).getByLabel("Music and ambience").fill("70");
  await expect(settings(page).locator("output[for=set-master]")).toHaveText("40%");
  let levels = await engine(page, (a) => a.levels());
  expect(levels!.master).toBeCloseTo(0.4);
  expect(levels!.effects).toBeCloseTo(0.25);
  expect(levels!.music).toBeCloseTo(0.7 * 0.18);

  await settings(page).getByLabel("Mute all sound").check();
  levels = await engine(page, (a) => a.levels());
  expect(levels!.master).toBe(0);
  // muted, nothing plays even though the effects slider is up
  await page.evaluate(() => (window as unknown as { __ppAudio: Engine }).__ppAudio.play("boom"));
  expect(await engine(page, (a) => a.played.boom ?? 0)).toBe(0);

  await page.reload();
  await reloaded(page);
  expect(await engine(page, (a) => a.settings)).toEqual({ master: 40, effects: 25, music: 70, muted: true });
  await openSettings(page);
  await expect(settings(page).getByLabel("Master volume")).toHaveValue("40");
  await expect(settings(page).getByLabel("Mute all sound")).toBeChecked();
});

test("stored levels are checked and clamped on the way in", async ({ page }) => {
  await start(page, () => {
    if (sessionStorage.getItem("pp_audio_test_seeded")) return;
    sessionStorage.setItem("pp_audio_test_seeded", "1");
    localStorage.setItem("pp_audio_settings", JSON.stringify({ master: 250, effects: -5, music: "loud", muted: "yes" }));
  });
  expect(await engine(page, (a) => a.settings)).toEqual({ master: 100, effects: 0, music: 50, muted: false });
  await page.evaluate(() => localStorage.setItem("pp_audio_settings", "{broken"));
  await page.reload();
  await reloaded(page);
  expect(await engine(page, (a) => a.settings)).toEqual({ master: 80, effects: 80, music: 50, muted: false });
});

test("one action plays one sound, and a flood of calls can't pile up", async ({ page }) => {
  await start(page);
  const box = (await page.locator("#world").boundingBox())!;
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => engine(page, (a) => a.running)).toBe(true);
  // dropping sheep through the Life tab plays the placing sound once
  await page.locator("#tabs button[data-tab=life]").click();
  await page.locator("#shelf button", { hasText: "Sheep" }).click();
  const placed = await engine(page, (a) => a.played.place ?? 0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => engine(page, (a) => a.played.place ?? 0)).toBe(placed + 1);
  await page.waitForTimeout(500);
  expect(await engine(page, (a) => a.played.place ?? 0)).toBe(placed + 1);
  // fifty calls in one go start a single voice
  const before = await engine(page, (a) => a.played.hit ?? 0);
  await page.evaluate(() => {
    const a = (window as unknown as { __ppAudio: Engine }).__ppAudio;
    for (let i = 0; i < 50; i++) a.play("hit");
  });
  expect((await engine(page, (a) => a.played.hit ?? 0)) - before).toBe(1);
  expect(await engine(page, (a) => a.starts)).toBe(1);
});

test("the settings dialog fits the screen and switches language", async ({ page }) => {
  await start(page);
  await openSettings(page);
  const fits = await page.evaluate(() => {
    const d = document.querySelector("#settings")!;
    const r = d.getBoundingClientRect();
    return d.scrollWidth <= d.clientWidth + 1 && r.right <= innerWidth + 1 && r.left >= -1;
  });
  expect(fits).toBe(true);
  await settings(page).getByRole("button", { name: "ES", exact: true }).click();
  await expect(settings(page).getByRole("heading", { name: "Ajustes" })).toBeVisible();
  await expect(settings(page).getByLabel("Volumen general")).toBeVisible();
  await expect(page.locator("#t-year")).toHaveText(/^Año [0-9]+$/);
});
