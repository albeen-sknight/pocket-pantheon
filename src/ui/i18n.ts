// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import en from "../../data/text/en.json";
import es from "../../data/text/es.json";

export type Lang = "en" | "es";
type Page = keyof typeof en;

const texts = { en, es };
const STORE_KEY = "pp-lang";

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

// Swaps every [data-i] and [data-ia] string on the page in place, no reload.
export function applyLang(page: Page, lang: Lang, root: ParentNode = document) {
  const dict: Record<string, string> = texts[lang][page];
  document.documentElement.lang = lang;
  if (dict.doc) document.title = dict.doc;

  root.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    const v = dict[el.dataset.i ?? ""];
    if (v != null) el.textContent = v;
  });
  root.querySelectorAll<HTMLElement>("[data-ia]").forEach((el) => {
    const v = dict[el.dataset.ia ?? ""];
    if (v != null) el.setAttribute("aria-label", v);
  });
  root.querySelectorAll<HTMLButtonElement>("#lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.l === lang));
  });
  saveLang(lang);
}

export function bindLangSwitch(page: Page) {
  document.querySelectorAll<HTMLButtonElement>("#lang button").forEach((b) => {
    b.onclick = () => isLang(b.dataset.l) && applyLang(page, b.dataset.l);
  });
  applyLang(page, loadLang());
}
