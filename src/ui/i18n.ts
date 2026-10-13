// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import en from "../../data/text/en.json";
import es from "../../data/text/es.json";

export type Lang = "en" | "es";
type Page = keyof typeof en;
export type PlayKey = keyof typeof en.play;

const texts = { en, es };
const STORE_KEY = "pp-lang";
const listeners: (() => void)[] = [];
let current: Lang = "en";

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "es";
}

export function pickLang(saved: string | null, browser: string): Lang {
  if (isLang(saved)) return saved;
  return /^es\b/i.test(browser) ? "es" : "en";
}

export function loadLang(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORE_KEY);
  } catch {
    // storage blocked, fall back to the browser language
  }
  return pickLang(saved, navigator.language || "");
}

function saveLang(lang: Lang) {
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    // not fatal: the choice just won't survive a reload
  }
}

export function lang(): Lang {
  return current;
}

// Formats a number the local way: 3,184 in English, 3.184 in Spanish.
// es-ES leaves 4 digit numbers ungrouped, so Spanish borrows de-DE, which
// uses the same separators and always groups.
export function fmt(n: number): string {
  return new Intl.NumberFormat(current === "es" ? "de-DE" : "en-US").format(n);
}

// Game text by key, with {n} style slots filled in.
export function t(key: PlayKey, vars: Record<string, string | number> = {}): string {
  const raw: string = texts[current].play[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined ? "" : typeof v === "number" ? fmt(v) : v;
  });
}

export function onLangChange(fn: () => void) {
  listeners.push(fn);
}

// Swaps every [data-i], [data-ia] and [data-it] string on the page in place, no reload.
export function applyLang(page: Page, next: Lang, root: ParentNode = document) {
  current = next;
  const dict: Record<string, string> = texts[next][page];
  document.documentElement.lang = next;
  if (dict.doc) document.title = dict.doc;

  root.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    const v = dict[el.dataset.i ?? ""];
    if (v != null) el.textContent = v;
  });
  root.querySelectorAll<HTMLElement>("[data-ia]").forEach((el) => {
    const v = dict[el.dataset.ia ?? ""];
    if (v != null) el.setAttribute("aria-label", v);
  });
  root.querySelectorAll<HTMLElement>("[data-it]").forEach((el) => {
    const v = dict[el.dataset.it ?? ""];
    if (v != null) el.title = v;
  });
  root.querySelectorAll<HTMLButtonElement>("#lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.l === next));
  });
  saveLang(next);
  listeners.forEach((fn) => fn());
}

export function bindLangSwitch(page: Page) {
  document.querySelectorAll<HTMLButtonElement>("#lang button").forEach((b) => {
    b.onclick = () => isLang(b.dataset.l) && applyLang(page, b.dataset.l);
  });
  applyLang(page, loadLang());
}

export function toggleLang(page: Page) {
  applyLang(page, current === "en" ? "es" : "en");
}
