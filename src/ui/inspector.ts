// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The right hand card: a person or animal with needs bars, stats and traits
// like the preview, or what's on a tile.
import civ from "../../data/civ.json";
import creatures from "../../data/creatures.json";
import type { Chronicle } from "../civ/types";
import { TOPICS, type TownDetail, type UnitDetail } from "../sim/protocol";
import { RACES } from "../sim/species";
import { SPECIES, TRAITS } from "../sim/species";
import { BIOMES } from "../world/biomes";
import { LAKE, ORES, RIVER, type World } from "../world/types";
import { el, txt } from "./dom";
import { fmt, t, type PlayKey } from "./i18n";

const NEED_KEYS = ["hunger", "rest", "safety", "social", "faith", "purpose"] as const;
const NEED_COLORS = ["#d9453d", "#5cc8e6", "#b06be0", "#f2c94c", "#f4f0e8", "#5fbf4a"];
const PERSONALITY_KEYS = ["aggression", "ambition", "curiosity", "loyalty", "greed", "kindness"] as const;
const JOBS = ["none", "gatherer", "farmer", "woodcutter", "builder"] as const;
const ACTS = ["idle", "wander", "eat", "sleep", "work", "build", "social", "flee", "fight", "settle", "pray", "explore", "hunt"] as const;

export function kindName(kind: number): string {
  return t(("kind_" + SPECIES[kind]) as PlayKey);
}

export function traitName(trait: number): string {
  return t(("trait_" + TRAITS[trait]) as PlayKey);
}

function rows(list: [PlayKey, string][]): HTMLDListElement {
  const dl = el("dl");
  for (const [k, v] of list) dl.append(el("dt", {}, txt(k)), el("dd", { textContent: v }));
  return dl;
}

function bar(label: PlayKey, value: number, color: string): HTMLDivElement {
  const fill = el("i");
  fill.style.width = Math.round(value * 100) + "%";
  fill.style.background = color;
  return el("div", { className: "need" }, el("span", {}, txt(label)), el("b", {}, fill));
}

export function unitCard(d: UnitDetail, following: boolean, onFollow: () => void): HTMLElement[] {
  const civ = d.kind < 4;
  const title = civ ? d.name : kindName(d.kind);
  const sub = civ ? `${kindName(d.kind)} · ${t(d.sex ? "male" : "female")} · ${t("in_age")} ${fmt(d.age)}` : `${t(d.sex ? "male" : "female")} · ${t("in_age")} ${fmt(d.age)}`;
  const out: HTMLElement[] = [el("h3", { textContent: title }), el("small", { textContent: sub })];

  const info: [PlayKey, string][] = [
    ["in_health", `${fmt(d.hp)} / ${fmt(d.maxHp)}`],
    ["in_doing", t(("act_" + (ACTS[d.act] ?? "idle")) as PlayKey)],
  ];
  if (civ) {
    info.push(["in_job", t(("job_" + (JOBS[d.job] ?? "none")) as PlayKey)]);
    info.push(["in_town", d.town || t("nomad")]);
    info.push(["in_spouse", d.spouse || t("none")]);
    info.push(["in_children", fmt(d.children)]);
  }
  if (civ && d.kingdom) info.push(["in_kingdom", t("kingdom_of", { name: d.kingdom })]);
  if (d.faith) info.push(["in_faith", d.faith]);
  if (d.subspecies) info.push(["in_people", `${d.subspecies} ${t(("race_pl_" + RACES[d.kind]) as PlayKey)}`]);
  if (d.weapon) info.push(["in_weapon", `${gearName(d.weapon)} · ${t(("q_" + qualityKey(d.quality)) as PlayKey)}`]);
  if (d.armor) info.push(["in_armor", gearName(d.armor)]);
  if (d.legend) info.push(["in_legend", d.legend]);
  if (d.kills) info.push(["in_kills", fmt(d.kills)]);
  out.push(rows(info));
  if (d.says) {
    const say = el("q", {}, el("b", { textContent: `«${d.says}»` }), el("small", { textContent: t(("say_" + TOPICS[d.topic]) as PlayKey) }));
    out.push(say);
  }

  if (civ) {
    // Needs show how well each one is met, like the preview's bars.
    const needs = el("div", { className: "needs" });
    NEED_KEYS.forEach((k, i) => needs.append(bar(("need_" + k) as PlayKey, 1 - d.needs[i]!, NEED_COLORS[i]!)));
    out.push(needs);
  }

  const stats = el("div", { className: "stats" });
  creatures.stats.forEach((k, i) => stats.append(el("span", {}, txt(("stat_" + k) as PlayKey), el("b", { textContent: fmt(d.stats[i]!) }))));
  out.push(stats);

  if (civ) {
    const pers = el("div", { className: "needs" });
    PERSONALITY_KEYS.forEach((k, i) => pers.append(bar(("p_" + k) as PlayKey, d.personality[i]!, "#9a8fb8")));
    out.push(el("details", {}, el("summary", {}, txt("in_personality")), pers));
  }

  if (d.traits.length) {
    const tags = el("div", { className: "tags" });
    for (const tr of d.traits) tags.append(el("span", { textContent: traitName(tr) }));
    out.push(tags);
  }
  const follow = el("button", { type: "button", className: "btn ghost small", textContent: t(following ? "unfollow" : "follow"), onclick: onFollow });
  out.push(follow);
  return out;
}

function gearName(tierPlusOne: number): string {
  const g = civ.gear[tierPlusOne - 1];
  return g ? t(("gear_" + g.key) as PlayKey) : t("none");
}

function qualityKey(q: number): string {
  return civ.quality[q] ?? "common";
}

function swatch(color: number): HTMLElement {
  const i = el("i", { className: "swatch" });
  i.style.background = civ.kingdomColors[color] ?? "#f4f0e8";
  return i;
}

export function townCard(d: TownDetail): HTMLElement[] {
  const out: HTMLElement[] = [el("h3", { textContent: d.name }), el("small", { textContent: `${t(("stage_" + d.stage) as PlayKey)} · ${kindName(d.race)}` })];
  const info: [PlayKey, string][] = [
    ["in_people", fmt(d.pop)],
    ["in_loyalty", t("pct", { n: d.loyalty })],
  ];
  if (d.faith) info.push(["in_faith", d.faith]);
  out.push(rows(info));
  const stock: [PlayKey, string][] = [["res_food", fmt(d.food)], ["res_wood", fmt(d.wood)]];
  civ.resources.forEach((r, i) => {
    if (i >= 2 && d.res[i]) stock.push([("res_" + r) as PlayKey, fmt(d.res[i]!)]);
  });
  out.push(el("details", { open: true }, el("summary", {}, txt("in_stock")), rows(stock)));

  const k = d.kingdom;
  if (!k) return out;
  out.push(el("h3", { className: "sub" }, swatch(k.color), el("span", { textContent: t("kingdom_of", { name: k.name }) })));
  const kinfo: [PlayKey, string][] = [
    ["in_ruler", k.ruler || t("none")],
    ["in_capital", k.capital],
    ["in_towns", fmt(k.towns)],
    ["in_people", fmt(k.pop)],
    ["in_age_k", t(("age_" + civ.ages[k.age]!.key) as PlayKey)],
    ["in_research", fmt(k.research)],
    ["in_gold", fmt(k.gold)],
    ["in_culture", k.traits.map((tr) => t(("ct_" + civ.cultureTraits[tr]) as PlayKey)).join(", ")],
  ];
  if (k.faith) kinfo.push(["in_faith", k.faith]);
  kinfo.push(["in_language", k.words]);
  out.push(rows(kinfo));
  if (k.relations.length) {
    const rel: [PlayKey, string][] = k.relations.map((r) => [("rel_" + r.state) as PlayKey, `${r.name} (${r.opinion > 0 ? "+" : ""}${fmt(r.opinion)})`]);
    out.push(el("details", {}, el("summary", {}, txt("in_relations")), rows(rel)));
  }
  return out;
}

// Turns a chronicle entry into a sentence in the current language.
export function chronicleText(e: Chronicle): string {
  const vars: Record<string, string | number> = { ...e.text };
  if (typeof vars.race === "number") vars.race = t(("race_pl_" + RACES[vars.race]) as PlayKey);
  else if (typeof vars.race === "string") vars.race = t(("race_pl_" + vars.race) as PlayKey);
  if (typeof vars.age === "string") vars.age = t(("age_" + vars.age) as PlayKey);
  if (typeof vars.tier === "string") vars.tier = t(("gear_" + vars.tier) as PlayKey).toLowerCase();
  const text = t(("ev_" + e.kind) as PlayKey, vars);
  return e.why ? `${text} ${t(e.why as PlayKey)}` : text;
}

export function tileCard(w: World, x: number, y: number): HTMLElement[] {
  const i = y * w.w + x;
  const above = w.height[i]! - w.seaLevel;
  const water = above < 0 ? t("water_sea") : w.flags[i]! & LAKE ? t("water_lake") : w.flags[i]! & RIVER ? t("water_river") : t("none");
  const ore = ORES[w.ore[i]!] ?? "none";
  return [
    el("h3", {}, txt("in_title")),
    rows([
      ["in_tile", `${fmt(x)}, ${fmt(y)}`],
      ["in_biome", t(("biome_" + BIOMES[w.biome[i]!]!.key) as PlayKey)],
      ["in_height", t("pct", { n: Math.round(w.height[i]! * 100) })],
      ["in_water", water],
      ["in_temp", t("deg", { n: Math.round(w.temperature[i]! * 50 - 15) })],
      ["in_moist", t("pct", { n: Math.round(w.moisture[i]! * 100) })],
      ["in_fert", t("pct", { n: Math.round((w.fertility[i]! / 255) * 100) })],
      ["in_ore", ore === "none" ? t("none") : t(("ore_" + ore) as PlayKey)],
    ]),
  ];
}
