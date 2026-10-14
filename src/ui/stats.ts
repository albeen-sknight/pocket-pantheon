// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The stats panel (PLAN section 17): population, ages, deaths, wars, the
// kingdom family tree, the chronicle and leaderboards, refreshed from the
// worker while open. Every chart also has a table view.
import cfg from "../../data/stats.json";
import type { Chronicle } from "../civ/types";
import { CAUSES, type Series, type StatsReport, type WarReport } from "../stats/history";
import { Chart, type ChartSeries, type ChartSpec } from "./charts";
import { $, el, toast } from "./dom";
import { fmt, t, type PlayKey } from "./i18n";
import { chronicleLine } from "./inspector";

type Tab = "pop" | "ages" | "deaths" | "wars" | "tree" | "chron" | "lead";
type By = "race" | "kingdom" | "religion" | "subspecies";
type Filter = "all" | "war" | "ruler" | "faith" | "disaster" | "director";

const TABS: Tab[] = ["pop", "ages", "deaths", "wars", "tree", "chron", "lead"];
const BY: By[] = ["race", "kingdom", "religion", "subspecies"];
const FILTERS: Filter[] = ["all", "war", "ruler", "faith", "disaster", "director"];
const LEADERS = ["strongest", "oldest", "kills", "smartest", "richest", "armies"] as const;

// Chronicle kinds by filter. Director entries are the ones it explains.
const KINDS: Record<Exclude<Filter, "all" | "director">, string[]> = {
  war: ["war", "war_truce", "war_peace", "war_won", "army", "retreat", "conquered", "razed", "fallen", "alliance", "rivals", "embargo", "friction"],
  ruler: ["ruler", "ruler_died", "kingdom", "rebellion", "independence", "legend", "age"],
  faith: ["faith", "sect", "state_faith", "faith_lost"],
  disaster: ["natural", "nuke", "plague", "sickness", "dragon", "abducted", "returned"],
};
const WAR_KINDS = new Set(["war_truce", "war_peace", "war_won", "army", "retreat", "conquered", "razed", "fallen"]);
const PYRAMID_COLORS = ["#3b6fd4", "#b06be0"];

export interface StatsHost {
  ask(): Promise<StatsReport>;
  exportName(): string;
  meta(): object | null;
  openKingdom(capital: number): void;
}

export class StatsPanel {
  private dlg = $<HTMLDialogElement>("#stats");
  private chart = new Chart();
  private tab: Tab = "pop";
  private by: By = "race";
  private pyramid = "race:1";
  private filter: Filter = "all";
  private query = "";
  private table = false;
  private war = -1;
  private opened = new Set<string>();
  private report: StatsReport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private body = el("div", { className: "st-body" });
  private controls = el("div", { className: "st-controls" });
  private legend = el("div", { className: "st-legend" });
  private extra = el("div", { className: "st-extra" });

  constructor(private host: StatsHost) {
    this.dlg.addEventListener("close", () => this.stop());
    window.addEventListener("resize", () => this.dlg.open && this.render());
  }

  get isOpen(): boolean {
    return this.dlg.open;
  }

  async open(tab?: Tab) {
    if (tab) this.tab = tab;
    this.build();
    if (!this.dlg.open) this.dlg.showModal();
    await this.refresh();
    this.stop();
    this.timer = setInterval(() => void this.refresh(), cfg.refreshMs);
  }

  // Text changes with the language, so rebuild everything.
  relabel() {
    if (this.dlg.open) {
      this.build();
      this.render();
    }
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh() {
    if (!this.dlg.open) return;
    this.report = await this.host.ask();
    this.render();
  }

  private build() {
    const tabs = el(
      "div",
      { className: "st-tabs", role: "tablist" },
      ...TABS.map((k) =>
        el("button", {
          type: "button",
          role: "tab",
          textContent: t(("st_" + k) as PlayKey),
          ariaSelected: String(k === this.tab),
          onclick: () => {
            this.tab = k;
            this.table = false;
            this.build();
            this.render();
          },
        }),
      ),
    );
    const tools = el(
      "div",
      { className: "row" },
      el("button", { type: "button", className: "btn ghost", textContent: t("st_png"), onclick: () => void this.savePng() }),
      el("button", { type: "button", className: "btn ghost", textContent: t("st_json"), onclick: () => this.saveJson() }),
      el("button", { type: "button", className: "btn", textContent: t("close"), onclick: () => this.dlg.close() }),
    );
    this.buildControls();
    this.dlg.replaceChildren(el("h2", { textContent: t("st_title") }), tabs, this.controls, this.body, tools);
  }

  private buildControls() {
    const parts: HTMLElement[] = [];
    const select = (label: string, value: string, options: [string, string][], set: (v: string) => void) => {
      const s = el("select", { onchange: () => (set(s.value), this.render()) }, ...options.map(([v, text]) => el("option", { value: v, textContent: text, selected: v === value })));
      return el("label", {}, el("span", { textContent: label }), s);
    };
    if (this.tab === "pop") parts.push(select(t("st_by"), this.by, BY.map((b) => [b, t(("st_by_" + b) as PlayKey)]), (v) => (this.by = v as By)));
    if (this.tab === "ages") {
      const groups = this.report?.pyramids ?? [];
      parts.push(
        select(
          t("st_for"),
          this.pyramid,
          groups.map((g) => [`${g.group}:${g.id}`, g.group === "race" ? t(("race_pl_" + g.race) as PlayKey) : g.name]),
          (v) => (this.pyramid = v),
        ),
      );
    }
    if (this.tab === "chron") {
      const search = el("input", { type: "search", value: this.query, placeholder: t("st_search"), ariaLabel: t("st_search") });
      search.oninput = () => {
        this.query = search.value;
        this.render();
      };
      parts.push(search, select(t("st_filter"), this.filter, FILTERS.map((f) => [f, t(("st_f_" + f) as PlayKey)]), (v) => (this.filter = v as Filter)));
    }
    if (["pop", "ages", "deaths"].includes(this.tab)) {
      const flip = el("button", { type: "button", className: "btn ghost small", textContent: t(this.table ? "st_as_chart" : "st_as_table") });
      flip.onclick = () => {
        this.table = !this.table;
        flip.textContent = t(this.table ? "st_as_chart" : "st_as_table");
        this.render();
      };
      parts.push(flip);
    }
    this.controls.replaceChildren(...parts);
    this.controls.hidden = !parts.length;
  }

  private render() {
    const r = this.report;
    if (!r) return;
    // the pyramid list depends on which kingdoms are alive
    if (this.tab === "ages" && this.controls.querySelector("select")?.options.length !== r.pyramids.length) this.buildControls();
    if (!r.years.length && this.tab !== "lead" && this.tab !== "chron") {
      this.body.replaceChildren(el("p", { className: "st-empty", textContent: t("st_empty") }));
      return;
    }
    if (this.tab === "pop") this.showSeries(r);
    else if (this.tab === "ages") this.showAges(r);
    else if (this.tab === "deaths") this.showDeaths(r);
    else if (this.tab === "wars") this.showWars(r);
    else if (this.tab === "tree") this.showTree(r);
    else if (this.tab === "chron") this.showChronicle(r);
    else this.showLeaders(r);
  }

  private named(list: Series[]): ChartSeries[] {
    return list.map((s) => ({
      name: s.id === 0 ? t("st_other") : this.by === "race" ? t(("race_pl_" + s.name) as PlayKey) : s.name,
      color: s.color,
      values: s.values,
    }));
  }

  private place(spec: ChartSpec, series: ChartSeries[], table: () => HTMLElement) {
    this.legend.replaceChildren(...(series.length > 1 ? series.map((s) => el("span", {}, el("i", { style: `background:${s.color}` }), s.name)) : []));
    if (this.table) {
      this.body.replaceChildren(table());
      return;
    }
    if (this.chart.root.parentElement !== this.body || this.body.firstChild !== this.legend) this.body.replaceChildren(this.legend, this.chart.root, this.extra);
    this.extra.replaceChildren();
    this.chart.show(spec);
  }

  private showSeries(r: StatsReport) {
    const series = this.named(r[this.by === "race" ? "races" : this.by === "kingdom" ? "kingdoms" : this.by === "religion" ? "religions" : "subspecies"]);
    if (!series.length) {
      this.body.replaceChildren(el("p", { className: "st-empty", textContent: t(("st_none_" + this.by) as PlayKey) }));
      return;
    }
    const year = (y: number) => t("year", { n: y });
    this.place({ kind: "lines", title: t("st_pop_title", { by: t(("st_by_" + this.by) as PlayKey) }), x: r.years, xName: year, series }, series, () =>
      table([t("st_col_year"), ...series.map((s) => s.name)], r.years.map((y, i) => [String(y), ...series.map((s) => fmt(s.values[i] ?? 0))]).reverse()),
    );
    if (r.years.length < cfg.fewYears) this.extra.replaceChildren(el("p", { className: "st-empty", textContent: t("st_young") }));
  }

  private showAges(r: StatsReport) {
    const g = r.pyramids.find((p) => `${p.group}:${p.id}` === this.pyramid) ?? r.pyramids[0]!;
    const bands = g.bands.map((b, i) => (i + 1 < g.bands.length ? t("st_band", { a: b, b: g.bands[i + 1]! - 1 }) : t("st_band_last", { a: b })));
    const left = { name: t("male"), color: PYRAMID_COLORS[0]!, values: g.male };
    const right = { name: t("female"), color: PYRAMID_COLORS[1]!, values: g.female };
    const name = g.group === "race" ? t(("race_pl_" + g.race) as PlayKey) : g.name;
    this.place({ kind: "pyramid", title: t("st_ages_title", { name }), bands, left, right }, [], () =>
      table([t("st_col_age"), left.name, right.name], bands.map((b, i) => [b, fmt(g.male[i]!), fmt(g.female[i]!)]).reverse()),
    );
  }

  private showDeaths(r: StatsReport) {
    const shown = cfg.deathShown.map((c) => CAUSES.indexOf(c as (typeof CAUSES)[number]));
    const series: ChartSeries[] = shown.map((c, k) => ({ name: t(("cause_" + CAUSES[c]) as PlayKey), color: cfg.deathColors[k]!, values: r.deaths.map((d) => d.counts[c]!) }));
    series.push({ name: t("st_cause_other"), color: cfg.otherColor, values: r.deaths.map((d) => d.counts.reduce((a, v, c) => a + (shown.includes(c) ? 0 : v), 0)) });
    const x = r.deaths.map((d) => String(d.decade));
    this.place({ kind: "stacked", title: t("st_deaths_title"), x, series }, series, () =>
      table([t("st_col_decade"), ...CAUSES.map((c) => t(("cause_" + c) as PlayKey))], r.deaths.map((d) => [String(d.decade), ...d.counts.map((v) => fmt(v))]).reverse()),
    );
    // every cause, including the ones folded into "other", with its total
    const totals = CAUSES.map((c, i) => [t(("cause_" + c) as PlayKey), r.deaths.reduce((a, d) => a + d.counts[i]!, 0)] as const).sort((a, b) => b[1] - a[1]);
    this.extra.replaceChildren(table([t("st_col_cause"), t("st_col_total")], totals.map(([n, v]) => [n, fmt(v)])));
  }

  private showWars(r: StatsReport) {
    if (!r.wars.length) {
      this.body.replaceChildren(el("p", { className: "st-empty", textContent: t("st_war_none") }));
      return;
    }
    const wars = r.wars.slice().reverse(); // newest first
    const rows = wars.map((w) => ({ name: t("st_war_row", { a: w.a, b: w.b }), from: w.start, to: w.end, color: "#d9453d", dim: w.end !== null }));
    const sel = wars.findIndex((w) => w.id === this.war);
    const spec: ChartSpec = { kind: "timeline", title: t("st_wars_title"), now: r.year, rows, selected: sel, tip: (i) => warLines(wars[i]!) };
    this.chart.onPick = (i) => {
      this.war = wars[i]?.id ?? -1;
      this.render();
    };
    this.place(spec, [], () => el("div"));
    this.legend.replaceChildren(el("span", { textContent: t("st_war_hint") }));
    const w = wars[sel];
    if (!w) return;
    const log = w.log.slice().reverse();
    this.extra.replaceChildren(
      el("h3", { textContent: t("st_war_row", { a: w.a, b: w.b }) }),
      el("p", { textContent: warLines(w).slice(1).join(" · ") }),
      el("h3", { textContent: t("st_war_log") }),
      log.length ? table([t("st_col_year"), w.a, w.b], log.map((l) => [String(l.year), fmt(l.a), fmt(l.b)])) : el("p", { className: "st-empty", textContent: t("st_war_nolog") }),
    );
  }

  private showTree(r: StatsReport) {
    if (!r.tree.length) {
      this.body.replaceChildren(el("p", { className: "st-empty", textContent: t("st_tree_none") }));
      return;
    }
    // depth first, so every kingdom sits under the one it split from
    const order: typeof r.tree = [];
    const kids = (id: number) => r.tree.filter((k) => k.parent === id).sort((a, b) => a.founded - b.founded || a.id - b.id);
    const walk = (k: (typeof r.tree)[number]) => {
      order.push(k);
      kids(k.id).forEach(walk);
    };
    kids(0).forEach(walk);
    r.tree.forEach((k) => !order.includes(k) && order.push(k));
    const index = new Map(order.map((k, i) => [k.id, i]));
    const rows = order.map((k) => ({ name: k.name, from: k.founded, to: k.alive ? null : k.fell, color: k.color, parent: k.parent ? index.get(k.parent) : undefined, dim: !k.alive }));
    const tip = (i: number) => {
      const k = order[i]!;
      const lines = [k.name, t("st_founded", { n: k.founded })];
      if (k.parent) lines.push(t("st_split_from", { name: r.tree[k.parent - 1]?.name ?? "" }));
      lines.push(k.alive ? t("st_people_now", { n: fmt(k.pop) }) : t("st_fell", { n: k.fell ?? 0 }), t("st_peak", { n: fmt(k.peak) }));
      if (k.alive) lines.push(t("st_open_kingdom"));
      return lines;
    };
    this.chart.onPick = (i) => {
      const k = order[i];
      if (k?.alive) {
        this.dlg.close();
        this.host.openKingdom(k.capital);
      }
    };
    this.place({ kind: "timeline", title: t("st_tree_title"), now: r.year, rows, tip }, [], () => el("div"));
    this.legend.replaceChildren(el("span", { textContent: t("st_tree_hint") }));
  }

  private showChronicle(r: StatsReport) {
    const q = this.query.trim().toLowerCase();
    const kinds = this.filter === "all" || this.filter === "director" ? null : new Set(KINDS[this.filter]);
    const list = r.chronicle
      .map((e) => ({ e, text: chronicleLine(e) }))
      .filter(({ e, text }) => (!kinds || kinds.has(e.kind)) && (this.filter !== "director" || !!e.why) && (!q || text.toLowerCase().includes(q)))
      .reverse()
      .slice(0, 300);
    if (!list.length) {
      this.body.replaceChildren(el("p", { className: "st-empty", textContent: t("st_chron_none") }));
      return;
    }
    const ul = el(
      "ul",
      { className: "st-chron" },
      ...list.map(({ e, text }) => {
        const key = `${e.tick}:${e.kind}:${text}`;
        const why = el("p", { className: "why", textContent: whyText(e, r), hidden: !this.opened.has(key) });
        const btn = el("button", { type: "button", className: "link", textContent: t("st_why"), ariaExpanded: String(this.opened.has(key)) });
        btn.onclick = () => {
          if (this.opened.has(key)) this.opened.delete(key);
          else this.opened.add(key);
          why.hidden = !this.opened.has(key);
          btn.setAttribute("aria-expanded", String(!why.hidden));
        };
        return el("li", {}, el("small", { textContent: t("year", { n: Math.floor(e.tick / r.ticksPerYear) }) }), el("span", { textContent: text }), btn, why);
      }),
    );
    const scroll = this.body.querySelector(".st-chron")?.scrollTop ?? 0;
    this.body.replaceChildren(ul);
    ul.scrollTop = scroll;
  }

  private showLeaders(r: StatsReport) {
    this.body.replaceChildren(
      el(
        "div",
        { className: "st-leaders" },
        ...LEADERS.map((k) => {
          const rows = r.leaders[k];
          return el(
            "section",
            {},
            el("h3", { textContent: t(("lead_" + k) as PlayKey) }),
            rows.length
              ? el("ol", {}, ...rows.map((l) => el("li", {}, el("span", {}, el("b", { textContent: l.name }), el("small", { textContent: l.detail })), el("em", { textContent: fmt(l.value) }))))
              : el("p", { className: "st-empty", textContent: t("st_lead_none") }),
          );
        }),
      ),
    );
  }

  private async savePng() {
    if (this.table || !this.chart.root.isConnected) return toast(t("st_png_none"));
    const blob = await this.chart.png();
    if (!blob) return toast(t("st_png_none"));
    download(blob, `${this.host.exportName()}-${this.tab}.png`);
    toast(t("st_png_done"));
  }

  private saveJson() {
    if (!this.report) return;
    const data = { meta: this.host.meta(), stats: this.report };
    download(new Blob([JSON.stringify(data)], { type: "application/json" }), `${this.host.exportName()}-stats.json`);
    toast(t("st_json_done"));
  }
}

function warLines(w: WarReport): string[] {
  const out = [t("st_war_row", { a: w.a, b: w.b }), w.end === null ? t("st_war_since", { n: w.start }) : t("st_war_years", { a: w.start, b: w.end })];
  if (w.reason) out.push(t("st_war_cause", { r: t(("reason_" + w.reason) as PlayKey) }));
  out.push(t("st_war_dead", { a: fmt(w.casualties[0]), b: fmt(w.casualties[1]) }));
  if (w.towns[0] + w.towns[1]) out.push(t("st_war_towns", { a: w.towns[0], b: w.towns[1] }));
  out.push(w.result ? t(("st_result_" + w.result) as PlayKey) : t("st_result_running"));
  return out;
}

// "Why did that happen?": the reason the sim recorded, or the war that was
// going on between the kingdoms named in the entry.
function whyText(e: Chronicle, r: StatsReport): string {
  if (e.why) return t(e.why as PlayKey);
  const year = Math.floor(e.tick / r.ticksPerYear);
  if (e.kind === "war" && typeof e.text.reason === "string" && e.text.reason) return t("st_why_reason", { r: t(("reason_" + e.text.reason) as PlayKey) });
  if (WAR_KINDS.has(e.kind)) {
    const names = Object.values(e.text).filter((v): v is string => typeof v === "string");
    const w = r.wars
      .filter((w) => w.start <= year && (w.end === null || w.end >= year) && (names.includes(w.a) || names.includes(w.b)))
      .at(-1);
    if (w) return t("st_why_war", { a: w.a, b: w.b, n: w.start, r: t(("reason_" + (w.reason || "god")) as PlayKey) });
  }
  if (e.kind === "rebellion" || e.kind === "independence") return t("st_why_loyalty");
  return t("st_why_none");
}

function table(head: string[], rows: string[][]): HTMLElement {
  return el(
    "div",
    { className: "st-table" },
    el(
      "table",
      {},
      el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { textContent: h, scope: "col" })))),
      el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c) => el("td", { textContent: c }))))),
    ),
  );
}

function download(blob: Blob, name: string) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
