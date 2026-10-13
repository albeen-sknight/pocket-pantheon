// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Invented languages (PLAN section 11). Each culture draws 20 to 30 syllables
// from its race's sounds, picks a stress habit and a few word endings, and
// every name in that culture is built from them. No hyphens, no apostrophes.
import sounds from "../../data/language.json";
import { createRng, type Rng } from "../core/rng";
import type { RaceKey } from "../sim/species";

export interface Language {
  syllables: string[];
  endings: string[];
  stress: "first" | "last"; // which syllable gets the long vowel in a doubled form
  seed: number;
}

export function makeLanguage(race: RaceKey, seed: number): Language {
  const s = sounds[race];
  const r = createRng(seed);
  const pick = <T>(list: T[]) => list[r.int(0, list.length - 1)]!;
  const count = r.int(20, 30);
  const syllables = new Set<string>();
  for (let tries = 0; syllables.size < count && tries < 400; tries++) {
    syllables.add(pick(s.onsets) + pick(s.vowels) + (r.chance(0.5) ? pick(s.codas) : ""));
  }
  const endings = new Set<string>();
  while (endings.size < 3) endings.add(pick(s.endings));
  return { syllables: [...syllables], endings: [...endings], stress: r.chance(0.5) ? "first" : "last", seed };
}

function cap(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

// Smooths awkward joins like "kk" or three vowels in a row.
function tidy(word: string): string {
  return word.replace(/(.)\1\1+/g, "$1$1").replace(/([aeiouy]{3,})/g, (m) => m.slice(0, 2));
}

export function word(lang: Language, r: Rng, min = 1, max = 2): string {
  const n = r.int(min, max);
  let out = "";
  for (let i = 0; i < n; i++) out += lang.syllables[r.int(0, lang.syllables.length - 1)]!;
  return tidy(out);
}

export function personName(lang: Language, r: Rng): string {
  const given = cap(word(lang, r, 1, 2));
  const family = cap(word(lang, r, 1, 1) + lang.endings[r.int(0, lang.endings.length - 1)]!);
  return `${given} ${family}`;
}

export function placeName(lang: Language, r: Rng): string {
  return cap(tidy(word(lang, r, 1, 2) + lang.endings[r.int(0, lang.endings.length - 1)]!));
}

export function shortName(lang: Language, r: Rng): string {
  return cap(word(lang, r, 2, 2));
}

// The same topic always comes out as the same words in a given culture, so
// a speech bubble reads like a real phrase.
export function phrase(lang: Language, topic: number): string {
  const r = createRng(lang.seed * 31 + topic * 977);
  const words = r.int(2, 3);
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(word(lang, r, 1, 2));
  return cap(out.join(" ")) + (r.chance(0.4) ? "!" : "");
}

// Neighbours who trade slowly borrow each other's syllables.
export function borrow(into: Language, from: Language, r: Rng) {
  const s = from.syllables[r.int(0, from.syllables.length - 1)]!;
  if (into.syllables.includes(s)) return;
  into.syllables[r.int(0, into.syllables.length - 1)] = s;
}
