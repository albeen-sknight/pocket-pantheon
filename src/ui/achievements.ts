// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Achievements: milestones the player reaches, earned from the same events
// the rest of the UI sees and kept in this browser.
import cfg from "../../data/achievements.json";
import { WRATH } from "../chaos/disasters";
import { GRACE } from "../civ/grace";
import type { Frame } from "../sim/protocol";
import type { Command } from "../sim/sim";
import { SPECIES } from "../sim/species";
import { toast } from "./dom";
import { t, type PlayKey } from "./i18n";

const ppStore = "pp_achievements";

type Rule = (typeof cfg.list)[number] & Partial<{ event: string; chronicle: string[]; age: number; pop: number; year: number; wrath: string; grace: string; allWrath: boolean; allGrace: boolean; possess: string; codex: number }>;
const RULES = cfg.list as Rule[];
const IDS = new Set(RULES.map((r) => r.id));

export interface AchievementView {
  id: string;
  name: string;
  detail: string;
  earned: number | null; // time it was earned
}

export class Achievements {
  private got = new Map<string, number>();
  private wrath = new Set<string>();
  private grace = new Set<string>();
  private lastCheck = 0;
  onEarn: (id: string) => void = () => {};

  constructor(private codexShare: () => number) {
    this.load();
  }

  onCommand(cmd: Command) {
    if (cmd.c === "wrath") {
      this.wrath.add(cmd.power);
      this.earnWhere((r) => r.wrath === cmd.power || (!!r.allWrath && WRATH.every((w) => this.wrath.has(w))));
      this.save();
    }
    if (cmd.c === "grace") {
      this.grace.add(cmd.power);
      this.earnWhere((r) => r.grace === cmd.power || (!!r.allGrace && GRACE.every((g) => this.grace.has(g))));
      this.save();
    }
  }

  onFrame(f: Frame) {
    for (const e of f.events) {
      if (e.t === "town") this.earnWhere((r) => r.event === "town");
      if (e.t === "chronicle") this.earnWhere((r) => !!r.chronicle?.includes(e.entry.kind));
    }
    const driving = f.possessed && f.selected?.uid === f.possessed ? SPECIES[f.selected.kind] : undefined;
    if (driving) this.earnWhere((r) => r.possess === driving);
    // thresholds only need a look now and then
    const now = performance.now();
    if (now - this.lastCheck < 1000) return;
    this.lastCheck = now;
    const age = Math.max(-1, ...(f.kingdoms ?? []).map((k) => k.age));
    const share = this.codexShare();
    this.earnWhere(
      (r) =>
        (r.age !== undefined && age >= r.age) ||
        (r.pop !== undefined && f.pop >= r.pop) ||
        (r.year !== undefined && f.year >= r.year) ||
        (r.codex !== undefined && share >= r.codex),
    );
  }

  private earnWhere(test: (r: Rule) => boolean) {
    for (const r of RULES) {
      if (this.got.has(r.id) || !test(r)) continue;
      this.got.set(r.id, Date.now());
      this.save();
      toast(t("ach_earned", { name: t(`ach_${r.id}_n` as PlayKey) }));
      this.onEarn(r.id);
    }
  }

  list(): AchievementView[] {
    return RULES.map((r) => ({ id: r.id, name: t(`ach_${r.id}_n` as PlayKey), detail: t(`ach_${r.id}_d` as PlayKey), earned: this.got.get(r.id) ?? null }));
  }

  get count(): number {
    return this.got.size;
  }

  // Storage. Unknown ids and bad values are dropped.

  private load() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(ppStore) ?? "null");
      if (!raw || typeof raw !== "object") return;
      const s = raw as { got?: unknown; wrath?: unknown; grace?: unknown };
      if (s.got && typeof s.got === "object") {
        for (const [id, at] of Object.entries(s.got)) if (IDS.has(id) && typeof at === "number") this.got.set(id, at);
      }
      const names = (v: unknown, known: readonly string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && known.includes(x)) : []);
      this.wrath = new Set(names(s.wrath, WRATH));
      this.grace = new Set(names(s.grace, GRACE));
    } catch {
      this.got.clear();
    }
  }

  private save() {
    try {
      localStorage.setItem(ppStore, JSON.stringify({ v: 1, got: Object.fromEntries(this.got), wrath: [...this.wrath], grace: [...this.grace] }));
    } catch {
      // still earned for this visit
    }
  }
}
