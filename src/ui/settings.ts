// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The Settings dialog (PLAN section 19): sound levels, screen shake and
// flashes, language and the tutorial. Sound settings live in the audio
// engine; the rest are stored here.
import type { AudioEngine, AudioSettings } from "../audio/engine";
import { $, el } from "./dom";
import { lang, t, toggleLang, type PlayKey } from "./i18n";

const ppStore = "pp_settings";

export interface Prefs {
  shake: boolean; // screen shake and flashes on big hits
}

export function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ppStore) ?? "null");
    const shake = raw && typeof raw === "object" ? (raw as { shake?: unknown }).shake : undefined;
    return { shake: typeof shake === "boolean" ? shake : true };
  } catch {
    return { shake: true };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(ppStore, JSON.stringify(p));
  } catch {
    // the choice still holds for this visit
  }
}

export class Settings {
  prefs = loadPrefs();
  private dlg = $<HTMLDialogElement>("#settings");

  constructor(private audio: AudioEngine, private replayTutorial: () => void) {}

  get isOpen(): boolean {
    return this.dlg.open;
  }

  open() {
    this.audio.unlock();
    this.build();
    if (!this.dlg.open) this.dlg.showModal();
    // the context resumes a moment after the gesture, so look again
    setTimeout(() => {
      const note = this.dlg.querySelector("#set-audio-note");
      if (note) note.textContent = this.audioNote();
    }, 300);
  }

  relabel() {
    if (this.dlg.open) this.build();
  }

  private build() {
    const s = this.audio.settings;
    const slider = (key: "master" | "effects" | "music", label: PlayKey) => {
      const id = `set-${key}`;
      const out = el("output", { htmlFor: id, textContent: `${s[key]}%` });
      const input = el("input", { type: "range", id, min: "0", max: "100", step: "5", value: String(s[key]) });
      input.setAttribute("aria-valuetext", `${s[key]}%`);
      input.oninput = () => {
        this.audio.set({ [key]: Number(input.value) } as Partial<AudioSettings>);
        out.textContent = `${this.audio.settings[key]}%`;
        input.setAttribute("aria-valuetext", out.textContent);
      };
      return el("div", { className: "f" }, el("label", { htmlFor: id, textContent: t(label) }), input, out);
    };
    const check = (id: string, label: PlayKey, on: boolean, change: (v: boolean) => void) => {
      const box = el("input", { type: "checkbox", id, checked: on });
      box.onchange = () => change(box.checked);
      return el("label", { className: "toggle", htmlFor: id }, box, el("span", { textContent: t(label) }));
    };
    const status = el("p", { className: "note", id: "set-audio-note", textContent: this.audioNote() });
    const mute = check("set-mute", "set_mute", s.muted, (v) => this.audio.set({ muted: v }));
    const shake = check("set-shake", "set_shake", this.prefs.shake, (v) => {
      this.prefs = { ...this.prefs, shake: v };
      savePrefs(this.prefs);
    });
    const language = el(
      "div",
      { className: "row start", role: "group" },
      ...(["en", "es"] as const).map((l) => {
        const b = el("button", { type: "button", className: "btn ghost small", textContent: l.toUpperCase() });
        b.setAttribute("aria-pressed", String(lang() === l));
        b.onclick = () => lang() !== l && toggleLang("play");
        return b;
      }),
    );
    const replay = el("button", { type: "button", className: "btn ghost small", textContent: t("tut_replay") });
    replay.onclick = () => {
      this.dlg.close();
      this.replayTutorial();
    };
    const close = el("button", { type: "button", className: "btn", textContent: t("close"), onclick: () => this.dlg.close() });
    this.dlg.replaceChildren(
      el("h2", { textContent: t("set_title") }),
      el("h3", { textContent: t("set_sound") }),
      status,
      mute,
      slider("master", "set_master"),
      slider("effects", "set_effects"),
      slider("music", "set_music"),
      el("h3", { textContent: t("set_screen") }),
      shake,
      el("h3", { textContent: t("set_language") }),
      language,
      el("h3", { textContent: t("set_help") }),
      el("div", { className: "row start" }, replay),
      el("div", { className: "row" }, close),
    );
  }

  private audioNote(): string {
    if (this.audio.failed) return t("set_audio_none");
    return this.audio.running ? t("set_audio_on") : t("set_audio_wait");
  }
}
