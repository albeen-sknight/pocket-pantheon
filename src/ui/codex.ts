// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The Codex (PLAN section 18): every power, creature, biome, trait, building
// and tech age. Entries unlock the first time the player meets them, link to
// each other, and stay unlocked in this browser.
import buildingData from "../../data/buildings.json";
import civData from "../../data/civ.json";
import cfg from "../../data/codex.json";
import creatures from "../../data/creatures.json";
import { UNIT_STRIDE, type Frame } from "../sim/protocol";
import type { Command } from "../sim/sim";
import { RACES, SPECIES, TRAIT_EFFECTS, TRAITS, type TraitEffects } from "../sim/species";
import { BIOMES } from "../world/biomes";
import type { World } from "../world/types";
import { $, el, toast } from "./dom";
import { fmt, t, type PlayKey } from "./i18n";

export type Category = "power" | "creature" | "biome" | "trait" | "building" | "age";
type Filter = Category | "all";

export interface Entry {
  id: string;
  cat: Category;
  key: string;
  name: PlayKey;
  summary: PlayKey;
  lore: PlayKey;
  stats: () => [string, string][];
  notes: () => string[]; // prerequisites that aren't entries
  refs: string[];
  prereq: string[];
}

const ppStore = "pp_codex_unlocked";
const CATS = cfg.categories as Category[];
const WILD: Record<string, { habitat: string[]; diet: string; prey?: string[]; hp: number; damage: number; speed: number; lifespan: number }> = {
  ...creatures.animals,
  ...creatures.monsters,
  ...creatures.specials,
};
const RACE_DATA: Record<string, { lifespan: number[]; adult: number; speed: number; biomes: string[] }> = creatures.races;
const BUILDINGS: Record<string, { size: number[]; wood: number; stone: number; housing: number; stage: number; age: number }> = buildingData;
const AGES = civData.ages;

// Powers reuse their shelf tooltip as the summary.
function powerKeys(group: string, k: string): { name: string; summary: string } {
  if (group === "wrath") return { name: `wrath_${k}`, summary: `tip_w_${k}` };
  if (group === "grace") return { name: `grace_${k}`, summary: `tip_${k}` };
  if (group === "shape") return { name: `tool_${k}`, summary: `tip_${k}` };
  if (group === "gene") return k === "trait" ? { name: "cx_gene_trait", summary: "cx_s_gene_trait" } : { name: `gene_${k}`, summary: `tip_${k}` };
  return { name: `tool_${k}`, summary: k === "peace" ? "tip_peace_k" : `tip_${k}` };
}

const years = (n: number) => t("cx_years", { n: fmt(Math.round(n)) });
const signed = (v: number) => {
  const n = Math.abs(v) < 1 ? `${Math.round(Math.abs(v) * 100)}%` : fmt(Math.abs(v));
  return t(v < 0 ? "cx_minus" : "cx_plus", { n });
};

function buildCatalog(): Entry[] {
  const out: Entry[] = [];
  const add = (cat: Category, key: string, name: string, summary: string, rest: Partial<Entry> = {}) =>
    out.push({ id: `${cat}:${key}`, cat, key, name: name as PlayKey, summary: summary as PlayKey, lore: `cx_l_${key}` as PlayKey, stats: () => [], notes: () => [], refs: [], prereq: [], ...rest });

  for (const [group, keys] of Object.entries(cfg.powers)) {
    for (const k of keys) {
      const { name, summary } = powerKeys(group, k);
      add("power", `${group}_${k}`, name, summary, { stats: () => [[t("cx_st_tab"), t(`tab_${group}` as PlayKey)]] });
    }
  }

  SPECIES.forEach((k) => {
    const race = RACE_DATA[k];
    const wild = WILD[k];
    const home = race?.biomes ?? wild?.habitat ?? [];
    add("creature", k, `kind_${k}`, `cx_s_${k}`, {
      refs: [...home.map((b) => `biome:${b}`), ...(wild?.prey ?? []).slice(0, 6).map((p) => `creature:${p}`)],
      notes: () => (cfg.godOnly.includes(k) ? [t("cx_pre_god")] : []),
      stats: () =>
        race
          ? [[t("cx_st_lifespan"), t("cx_years_range", { a: race.lifespan[0]!, b: race.lifespan[1]! })], [t("cx_st_adult"), years(race.adult)], [t("cx_st_speed"), fmt(race.speed)]]
          : [[t("cx_st_hp"), fmt(wild!.hp)], [t("cx_st_damage"), fmt(wild!.damage)], [t("cx_st_speed"), fmt(wild!.speed)], [t("cx_st_lifespan"), years(wild!.lifespan)], [t("cx_st_diet"), t(`cx_diet_${wild!.diet}` as PlayKey)]],
    });
  });

  for (const b of BIOMES) {
    const natives = SPECIES.filter((k) => (RACE_DATA[k]?.biomes ?? WILD[k]?.habitat ?? []).includes(b.key));
    add("biome", b.key, `biome_${b.key}`, `cx_s_${b.key}`, {
      refs: natives.map((k) => `creature:${k}`),
      stats: () => [[t("cx_st_ground"), t("water" in b && b.water ? "cx_water" : "cx_land")]],
    });
  }

  TRAITS.forEach((k, i) => {
    const effects = TRAIT_EFFECTS[i]!;
    add("trait", k, `trait_${k}`, `cx_s_${k}`, {
      refs: ["power:gene_trait", "power:gene_mutate"],
      stats: () => (Object.entries(effects) as [keyof TraitEffects, number][]).map(([e, v]) => [t(`cx_eff_${e}` as PlayKey), signed(v)]),
    });
  });
  for (const k of cfg.statuses) add("trait", k, `status_${k}`, `cx_s_${k}`);

  for (const [k, b] of Object.entries(BUILDINGS)) {
    add("building", k, `${k}_n`, `cx_s_${k}`, {
      prereq: b.age ? [`age:${AGES[b.age]!.key}`] : [],
      notes: () => (b.stage ? [t("cx_pre_stage", { stage: t(`stage_${b.stage}` as PlayKey) })] : []),
      stats: () => {
        const rows: [string, string][] = [[t("cx_st_size"), t("cx_tiles", { w: b.size[0]!, h: b.size[1]! })], [t("cx_st_wood"), fmt(b.wood)], [t("cx_st_stone"), fmt(b.stone)]];
        if (b.housing) rows.push([t("cx_st_housing"), t("cx_people", { n: b.housing })]);
        return rows;
      },
    });
  }

  AGES.forEach((a, i) => {
    add("age", a.key, `age_${a.key}`, `cx_s_${a.key}`, {
      prereq: i ? [`age:${AGES[i - 1]!.key}`] : [],
      refs: Object.entries(BUILDINGS)
        .filter(([, b]) => b.age === i && i > 0)
        .map(([k]) => `building:${k}`),
      stats: () => [[t("cx_st_research"), fmt(a.research)]],
    });
  });

  // Hand picked links from the data file, kept only when both ends exist.
  const ids = new Set(out.map((e) => e.id));
  const extra = cfg.refs as Record<string, string[]>;
  const pre = cfg.prereq as Record<string, string[]>;
  for (const e of out) {
    e.prereq = [...new Set([...e.prereq, ...(pre[e.id] ?? [])])].filter((id) => ids.has(id) && id !== e.id);
    e.refs = [...new Set([...e.refs, ...(extra[e.id] ?? [])])].filter((id) => ids.has(id) && id !== e.id && !e.prereq.includes(id));
  }
  return out;
}

export const CATALOG = buildCatalog();
const byId = new Map(CATALOG.map((e) => [e.id, e]));

// Which entries a player command reveals.
function commandIds(cmd: Command): string[] {
  switch (cmd.c) {
    case "wrath":
      return [`power:wrath_${cmd.power}`];
    case "grace":
      return [`power:grace_${cmd.power}`];
    case "spawn":
      return [`creature:${SPECIES[cmd.kind]}`];
    case "stroke":
      return [`power:shape_${cmd.stroke.tool}`, ...(cmd.stroke.tool === "paint" ? [`biome:${BIOMES[cmd.stroke.biome ?? -1]?.key}`] : [])];
    case "mutate":
    case "clone":
    case "split":
      return [`power:gene_${cmd.c}`];
    case "trait":
      return ["power:gene_trait", `trait:${TRAITS[cmd.trait]}`];
    case "possess":
    case "war":
    case "peace":
    case "ally":
      return [`power:cmd_${cmd.c}`];
    default:
      return [];
  }
}

export class Codex {
  private unlocked = new Set<string>();
  private fresh = new Set<string>();
  private quietUntil = 0;
  private newWorld = false;
  private lastScan = 0;
  private dlg = $<HTMLDialogElement>("#codex");
  private filter: Filter = "all";
  private query = "";
  private current: string | null = null;
  private search = el("input", { type: "search" });
  private list = el("ul", { className: "cx-list" });
  private article = el("article", { className: "cx-article" });
  private body = el("div", { className: "cx-body" });
  private cats = el("div", { className: "cx-cats", role: "group" });

  constructor(private icon: (e: Entry) => HTMLElement) {
    this.load();
    this.search.oninput = () => {
      this.query = this.search.value;
      this.renderList();
    };
    this.badge();
  }

  get isOpen(): boolean {
    return this.dlg.open;
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  // Discovery

  // A new or loaded world: whatever it holds at the start unlocks quietly.
  worldChanged(world: World) {
    this.newWorld = true;
    const present = new Set<number>(world.biome);
    this.unlock([...present].map((b) => `biome:${BIOMES[b]?.key}`), true);
  }

  onCommand(cmd: Command) {
    this.unlock(commandIds(cmd));
  }

  onFrame(f: Frame) {
    const now = performance.now();
    if (this.newWorld) {
      this.newWorld = false;
      this.quietUntil = now + cfg.quietMs;
    }
    const quiet = now < this.quietUntil;
    const found: string[] = [];
    for (let k = 1; k < f.tiles.length; k += 4) found.push(`biome:${BIOMES[f.tiles[k]!]?.key}`);
    for (const e of f.events) if (e.t === "chronicle" && e.entry.kind === "natural") found.push(`power:wrath_${e.entry.text.what}`);
    const u = f.selected;
    if (u) {
      found.push(`creature:${SPECIES[u.kind]}`, ...u.traits.map((i) => `trait:${TRAITS[i]}`));
      if (u.blessed) found.push("trait:blessed");
      if (u.sick) found.push("trait:sick");
      if (u.immune) found.push("trait:immune");
    }
    if (now - this.lastScan >= cfg.scanMs) {
      this.lastScan = now;
      found.push(...this.scan(f));
    }
    this.unlock(found, quiet);
  }

  // The slower look around, once a second: who lives here, what stands, how far kingdoms got.
  private scan(f: Frame): string[] {
    const kinds = new Set<number>();
    for (let i = 0; i < f.count; i++) kinds.add(f.units[i * UNIT_STRIDE + 3]!);
    const out = [...kinds].map((k) => `creature:${SPECIES[k]}`);
    for (const b of f.buildings ?? []) if (b.done) out.push(`building:${b.type}`);
    const top = Math.max(-1, ...(f.kingdoms ?? []).map((k) => k.age));
    for (let a = 0; a <= top; a++) out.push(`age:${AGES[a]?.key}`);
    return out;
  }

  unlock(ids: string[], quiet = false) {
    const added = [...new Set(ids)].filter((id) => byId.has(id) && !this.unlocked.has(id));
    if (!added.length) return;
    for (const id of added) {
      this.unlocked.add(id);
      if (!quiet) this.fresh.add(id);
    }
    this.save();
    this.badge();
    if (!quiet) this.announce(added);
    if (this.dlg.open) this.render();
  }

  private announce(ids: string[]) {
    const names = ids.slice(0, cfg.toastNames).map((id) => t(byId.get(id)!.name));
    const list = names.join(", ");
    toast(ids.length > names.length ? t("cx_new_more", { list, n: ids.length - names.length }) : t("cx_new", { list }));
  }

  // Storage. Anything unreadable or unknown is dropped, never trusted.

  private load() {
    try {
      const raw = localStorage.getItem(ppStore);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;
      const known = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string" && byId.has(id)) : []);
      this.unlocked = new Set(known((saved as { unlocked?: unknown }).unlocked));
      this.fresh = new Set(known((saved as { fresh?: unknown }).fresh).filter((id) => this.unlocked.has(id)));
    } catch {
      this.unlocked = new Set();
      this.fresh = new Set();
    }
  }

  private save() {
    try {
      localStorage.setItem(ppStore, JSON.stringify({ v: 1, unlocked: [...this.unlocked], fresh: [...this.fresh] }));
    } catch {
      // private mode or full storage: the Codex still works for this visit
    }
  }

  private badge() {
    const btn = document.querySelector<HTMLButtonElement>("#codex-btn");
    if (!btn) return;
    const n = this.fresh.size;
    const dot = $(".badge", btn);
    dot.textContent = n ? fmt(n) : "";
    dot.hidden = !n;
    btn.setAttribute("aria-label", n ? t("cx_open_new", { n }) : t("cx_open_a"));
  }

  // Panel

  open(id?: string) {
    this.build();
    if (!this.dlg.open) this.dlg.showModal();
    if (id) this.show(id);
    else this.search.focus();
  }

  relabel() {
    this.badge();
    if (this.dlg.open) this.build();
  }

  private build() {
    const close = el("button", { type: "button", className: "btn ghost small", textContent: t("close"), onclick: () => this.dlg.close() });
    const seen = el("button", {
      type: "button",
      className: "btn ghost small",
      textContent: t("cx_seen_all"),
      onclick: () => {
        this.fresh.clear();
        this.save();
        this.badge();
        this.render();
      },
    });
    seen.dataset.cx = "seen";
    this.search.placeholder = t("cx_search");
    this.search.setAttribute("aria-label", t("cx_search"));
    this.cats.setAttribute("aria-label", t("cx_filter"));
    const side = el("aside", { className: "cx-side" }, this.search, this.cats, this.list);
    this.body.replaceChildren(side, this.article);
    this.body.dataset.view = this.current && matchMedia("(max-width: 700px)").matches ? "article" : "list";
    this.dlg.replaceChildren(el("div", { className: "cx-head" }, el("h2", { textContent: t("cx_title") }), el("span", { className: "cx-progress" }), seen, close), this.body);
    this.render();
  }

  private render() {
    $(".cx-progress", this.dlg).textContent = t("cx_progress", { n: this.unlocked.size, total: CATALOG.length });
    $<HTMLButtonElement>("[data-cx=seen]", this.dlg).disabled = !this.fresh.size;
    this.cats.replaceChildren(
      ...(["all", ...CATS] as Filter[]).map((c) => {
        const b = el("button", { type: "button", textContent: t(`cx_cat_${c}` as PlayKey) });
        b.setAttribute("aria-pressed", String(c === this.filter));
        b.onclick = () => {
          this.filter = c;
          this.render();
        };
        return b;
      }),
    );
    this.renderList();
    this.renderArticle();
  }

  private visible(): Entry[] {
    const q = this.query.trim().toLocaleLowerCase();
    // discovered entries first, each group in catalog order
    const order = [...CATALOG.filter((e) => this.unlocked.has(e.id)), ...CATALOG.filter((e) => !this.unlocked.has(e.id))];
    return order.filter((e) => {
      if (this.filter !== "all" && e.cat !== this.filter) return false;
      if (!q) return true;
      // locked entries never match a search, so it can't leak their names
      return this.unlocked.has(e.id) && `${t(e.name)} ${t(e.summary)}`.toLocaleLowerCase().includes(q);
    });
  }

  private renderList() {
    const rows = this.visible();
    if (!rows.length) {
      this.list.replaceChildren(el("li", { className: "cx-empty", textContent: t(this.query.trim() ? "cx_none_search" : "cx_none") }));
      return;
    }
    this.list.replaceChildren(
      ...rows.map((e) => {
        const open = this.unlocked.has(e.id);
        const b = el("button", { type: "button", className: "cx-item" }, open ? this.icon(e) : el("span", { className: "cx-q", textContent: "?" }), el("span", { textContent: open ? t(e.name) : t("cx_unknown") }));
        b.dataset.id = e.id;
        b.dataset.locked = String(!open);
        b.setAttribute("aria-pressed", String(e.id === this.current));
        if (!open) b.setAttribute("aria-label", t("cx_locked_a", { cat: t(`cx_one_${e.cat}` as PlayKey) }));
        if (this.fresh.has(e.id)) b.append(el("i", { className: "cx-dot", title: t("cx_new_dot") }));
        b.onclick = () => this.show(e.id);
        return el("li", {}, b);
      }),
    );
  }

  // Jumps to an entry, clearing filters that would hide it.
  private show(id: string) {
    const e = byId.get(id);
    if (!e) return;
    if (!this.visible().includes(e)) {
      this.filter = "all";
      this.query = "";
      this.search.value = "";
    }
    this.current = id;
    if (this.unlocked.has(id) && this.fresh.delete(id)) {
      this.save();
      this.badge();
    }
    this.body.dataset.view = "article";
    this.render();
    this.list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private renderArticle() {
    const back = el("button", { type: "button", className: "btn ghost small cx-back", textContent: t("cx_back") });
    back.onclick = () => {
      this.body.dataset.view = "list";
      this.list.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(this.current ?? "")}"]`)?.focus();
    };
    const e = this.current ? byId.get(this.current) : undefined;
    if (!e) {
      this.article.replaceChildren(el("p", { className: "cx-empty", textContent: t("cx_pick") }));
      return;
    }
    const kind = el("small", { textContent: t(`cx_one_${e.cat}` as PlayKey) });
    if (!this.unlocked.has(e.id)) {
      this.article.dataset.locked = "true";
      this.article.replaceChildren(back, el("header", {}, el("span", { className: "cx-q big", textContent: "?" }), el("div", {}, el("h3", { textContent: t("cx_unknown") }), kind)), el("p", { textContent: t(`cx_locked_${e.cat}` as PlayKey) }));
      return;
    }
    this.article.dataset.locked = "false";
    const big = this.icon(e);
    big.classList.add("big");
    const parts: HTMLElement[] = [back, el("header", {}, big, el("div", {}, el("h3", { textContent: t(e.name) }), kind)), el("p", { className: "cx-sum", textContent: t(e.summary) }), el("p", { className: "cx-lore", textContent: t(e.lore) })];
    const stats = e.stats();
    if (stats.length) parts.push(el("dl", {}, ...stats.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })])));
    const notes = e.notes();
    if (e.prereq.length || notes.length) parts.push(el("h4", { textContent: t("cx_prereq") }), this.links(e.prereq, notes));
    if (e.refs.length) parts.push(el("h4", { textContent: t("cx_refs") }), this.links(e.refs, []));
    this.article.replaceChildren(...parts);
  }

  private links(ids: string[], notes: string[]): HTMLElement {
    return el(
      "ul",
      { className: "cx-links" },
      ...ids.map((id) => {
        const target = byId.get(id)!;
        const label = this.unlocked.has(id) ? t(target.name) : t("cx_locked_a", { cat: t(`cx_one_${target.cat}` as PlayKey) });
        const b = el("button", { type: "button", className: "link", textContent: label });
        b.dataset.ref = id;
        b.onclick = () => this.show(id);
        return el("li", {}, b);
      }),
      ...notes.map((n) => el("li", { textContent: n })),
    );
  }
}
