// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The right hand card: a person or animal with needs bars, stats and traits
// like the preview, or what's on a tile.
import creatures from "../../data/creatures.json";
import type { UnitDetail } from "../sim/protocol";
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
  if (d.kills) info.push(["in_kills", fmt(d.kills)]);
  out.push(rows(info));

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
