// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import config from "../../data/world.json";
import { t, type PlayKey } from "./i18n";

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

// A text node bound to a key; refreshText() rewrites it after a language switch.
export function txt(key: PlayKey): HTMLSpanElement {
  const span = el("span");
  span.dataset.i = key;
  span.textContent = t(key);
  return span;
}

export function toast(message: string) {
  const box = $("#toast");
  const note = el("div", { textContent: message });
  box.append(note);
  setTimeout(() => note.remove(), 3500);
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 1 + (buf[0]! % 999998);
}

export const SAVE_SLOTS = config.saveSlots;
