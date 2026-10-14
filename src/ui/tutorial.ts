// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { el } from "./dom";
import { t, type PlayKey } from "./i18n";

export type TutorialAction = "camera" | "shape" | "spawnHuman" | "inspect" | "spawnRival" | "army" | "possess" | "disaster" | "stats" | "save";

type TutorialStep = { title: PlayKey; body: PlayKey; prompt: PlayKey; target: string; action: TutorialAction };

const ppCompleteKey = "pp_tutorial_completed";
const ppSteps: TutorialStep[] = [
  { title: "tut_camera_h", body: "tut_camera_p", prompt: "tut_camera_a", target: "#t-zoom", action: "camera" },
  { title: "tut_shape_h", body: "tut_shape_p", prompt: "tut_shape_a", target: '[data-tutorial="shape-raise"]', action: "shape" },
  { title: "tut_spawn_h", body: "tut_spawn_p", prompt: "tut_spawn_a", target: '[data-tutorial="spawn-human"]', action: "spawnHuman" },
  { title: "tut_inspect_h", body: "tut_inspect_p", prompt: "tut_inspect_a", target: "#world", action: "inspect" },
  { title: "tut_rivals_h", body: "tut_rivals_p", prompt: "tut_rivals_a", target: '[data-tutorial="spawn-rival"]', action: "spawnRival" },
  { title: "tut_army_h", body: "tut_army_p", prompt: "tut_army_a", target: '[data-tutorial="army-command"]', action: "army" },
  { title: "tut_possess_h", body: "tut_possess_p", prompt: "tut_possess_a", target: '[data-tutorial="possess-tool"]', action: "possess" },
  { title: "tut_disaster_h", body: "tut_disaster_p", prompt: "tut_disaster_a", target: '[data-tutorial="disaster"]', action: "disaster" },
  { title: "tut_stats_h", body: "tut_stats_p", prompt: "tut_stats_a", target: "#stats-btn", action: "stats" },
  { title: "tut_save_h", body: "tut_save_p", prompt: "tut_save_a", target: '[data-tutorial="save-world"]', action: "save" },
];

export class Tutorial {
  private ppActive = false;
  private ppAutoTried = false;
  private ppIndex = 0;
  private ppFrame = 0;
  private ppHighlight = el("span", { className: "tutorial-highlight", hidden: true });
  private ppArrow = el("span", { className: "tutorial-arrow", textContent: "➤", hidden: true });
  private ppCard: HTMLElement | null = null;

  constructor(private root: HTMLElement, private prepare: (step: number) => void) {}

  autoStart() {
    if (this.ppAutoTried) return;
    this.ppAutoTried = true;
    if (this.completed()) return;
    this.show(0);
  }

  replay() {
    this.ppAutoTried = true;
    this.show(0);
  }

  close() {
    this.ppActive = false;
    this.root.hidden = true;
    if (this.ppFrame) cancelAnimationFrame(this.ppFrame);
    this.ppFrame = 0;
  }

  next() {
    if (!this.ppActive) return;
    if (this.ppIndex === ppSteps.length - 1) return this.finish();
    this.show(this.ppIndex + 1);
  }

  skip() {
    if (this.ppActive) this.finish();
  }

  action(action: TutorialAction) {
    if (!this.ppActive || ppSteps[this.ppIndex]!.action !== action) return;
    this.next();
  }

  refresh() {
    if (!this.ppActive) return;
    this.render();
  }

  relayout() {
    if (!this.ppActive) return;
    this.schedulePosition();
  }

  private show(index: number) {
    this.ppActive = true;
    this.ppIndex = index;
    this.prepare(index);
    this.render();
  }

  private finish() {
    try {
      localStorage.setItem(ppCompleteKey, "1");
    } catch {
      // The tutorial still closes when browser storage is unavailable.
    }
    this.close();
  }

  private completed() {
    try {
      return localStorage.getItem(ppCompleteKey) === "1";
    } catch {
      return false;
    }
  }

  private render() {
    const step = ppSteps[this.ppIndex]!;
    const card = el("section", { id: "tutorial-card", className: "tutorial-card" });
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-labelledby", "tutorial-title");
    const close = el("button", { type: "button", className: "tutorial-close", textContent: "×", onclick: () => this.close() });
    close.setAttribute("aria-label", t("tut_close"));
    const title = el("h2", { id: "tutorial-title", textContent: t(step.title) });
    const body = el("p", { id: "tutorial-body", textContent: t(step.body) });
    const prompt = el("p", { id: "tutorial-action", className: "tutorial-prompt", textContent: t(step.prompt) });
    const count = el("p", { id: "tutorial-count", className: "tutorial-count", textContent: t("tut_count", { n: this.ppIndex + 1, total: ppSteps.length }) });
    const checklist = el("ol", { className: "tutorial-checklist" });
    checklist.setAttribute("aria-label", t("tut_checklist"));
    ppSteps.forEach((item, i) => {
      const entry = el("li", { className: "tutorial-check" });
      entry.setAttribute("aria-label", t(item.title));
      entry.dataset.done = String(i < this.ppIndex);
      entry.dataset.current = String(i === this.ppIndex);
      if (i === this.ppIndex) entry.setAttribute("aria-current", "step");
      entry.append(el("span", { className: "tutorial-mark", textContent: i < this.ppIndex ? "✓" : String(i + 1) }));
      checklist.append(entry);
    });
    const actions = el("div", { className: "tutorial-actions" });
    const next = el("button", { type: "button", className: "btn", textContent: t(this.ppIndex === ppSteps.length - 1 ? "tut_finish" : "tut_next"), onclick: () => this.next() });
    next.dataset.tutorialAction = "next";
    const skip = el("button", { type: "button", className: "btn ghost", textContent: t("tut_skip"), onclick: () => this.skip() });
    skip.dataset.tutorialAction = "skip";
    actions.append(next, skip);
    card.append(close, count, title, body, prompt, checklist, actions);
    this.ppCard = card;
    this.root.dataset.step = String(this.ppIndex + 1);
    this.root.hidden = false;
    this.root.replaceChildren(this.ppHighlight, this.ppArrow, card);
    this.schedulePosition();
  }

  private schedulePosition() {
    if (this.ppFrame) cancelAnimationFrame(this.ppFrame);
    this.ppFrame = requestAnimationFrame(() => {
      this.ppFrame = 0;
      this.positionTarget();
    });
  }

  private positionTarget() {
    if (!this.ppActive) return;
    const target = document.querySelector<HTMLElement>(ppSteps[this.ppIndex]!.target);
    if (!target || !target.getClientRects().length) {
      this.ppHighlight.hidden = true;
      this.ppArrow.hidden = true;
      return;
    }
    if (target.closest("#shelf")) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = target.getBoundingClientRect();
    Object.assign(this.ppHighlight.style, {
      left: `${rect.left - 5}px`, top: `${rect.top - 5}px`, width: `${rect.width + 10}px`, height: `${rect.height + 10}px`,
    });
    this.ppHighlight.hidden = false;
    if (!this.ppCard) return;
    const card = this.ppCard.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - (card.left + card.width / 2);
    const dy = y - (card.top + card.height / 2);
    if (rect.left < card.right && rect.right > card.left && rect.top < card.bottom && rect.bottom > card.top) {
      this.ppArrow.hidden = true;
      return;
    }
    const length = Math.hypot(dx, dy) || 1;
    const vx = dx / length;
    const vy = dy / length;
    const edge = Math.min(card.width / 2 / Math.max(Math.abs(vx), 0.01), card.height / 2 / Math.max(Math.abs(vy), 0.01)) + 18;
    Object.assign(this.ppArrow.style, {
      left: `${card.left + card.width / 2 + vx * edge}px`,
      top: `${card.top + card.height / 2 + vy * edge}px`,
      transform: `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`,
    });
    this.ppArrow.hidden = false;
  }
}
