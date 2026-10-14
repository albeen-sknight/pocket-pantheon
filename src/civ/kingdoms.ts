// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Kingdoms (PLAN section 11): a capital plus vassal towns under one ruler.
// Loyalty drifts with food, distance, faith and the ruler's charm; towns that
// fall too low rebel and split off as a new kingdom.
import civ from "../../data/civ.json";
import { G, PERSONALITY, STAT, stat } from "../sim/genes";
import type { Sim, Town } from "../sim/sim";
import { RACES, SPECIES_INFO } from "../sim/species";
import { makeLanguage, placeName } from "./language";
import type { Culture, Kingdom } from "./types";

const L = civ.loyalty;

export function newCulture(sim: Sim, race: number): Culture {
  const c: Culture = { id: sim.civ.cultures.length + 1, race, lang: makeLanguage(RACES[race]!, sim.rng.civ.int(1, 1e9)) };
  sim.civ.cultures.push(c);
  return c;
}

export function culture(sim: Sim, id: number): Culture | undefined {
  return sim.civ.cultures[id - 1];
}

export function kingdom(sim: Sim, id: number): Kingdom | undefined {
  const k = id > 0 ? sim.civ.kingdoms[id - 1] : undefined;
  return k?.alive ? k : undefined;
}

export function kingdomOfTown(sim: Sim, town: Town | undefined): Kingdom | undefined {
  return town ? kingdom(sim, town.kingdom) : undefined;
}

// The least used colour, so neighbours rarely match.
function pickColor(sim: Sim): number {
  const used = new Array(civ.kingdomColors.length).fill(0);
  for (const k of sim.civ.kingdoms) if (k.alive) used[k.color]++;
  let best = 0;
  for (let i = 1; i < used.length; i++) if (used[i] < used[best]) best = i;
  return best;
}

export function newKingdom(sim: Sim, capital: Town, culture: Culture, parent = 0, why = parent ? "rebellion" : "kingdom"): Kingdom {
  const r = sim.rng.civ;
  const traits: number[] = [];
  while (traits.length < 2) {
    const t = r.int(0, civ.cultureTraits.length - 1);
    if (!traits.includes(t)) traits.push(t);
  }
  const old = parent ? sim.civ.kingdoms[parent - 1] : undefined;
  const k: Kingdom = {
    id: sim.civ.kingdoms.length + 1,
    name: placeName(culture.lang, r),
    culture: culture.id,
    race: capital.race,
    color: pickColor(sim),
    capital: capital.id,
    ruler: 0,
    heir: 0,
    rulerName: "",
    age: old ? old.age : 0,
    research: old ? old.research : 0,
    gold: 0,
    traits,
    religion: old ? old.religion : 0,
    founded: sim.tick,
    parent,
    alive: true,
    towns: 1,
    pop: capital.pop,
  };
  sim.civ.kingdoms.push(k);
  capital.kingdom = k.id;
  capital.loyalty = 100;
  chooseRuler(sim, k);
  sim.chronicle(why, { name: k.name, town: capital.name, old: old?.name ?? "" });
  return k;
}

export function hasTrait(k: Kingdom, trait: string): boolean {
  return k.traits.includes(civ.cultureTraits.indexOf(trait));
}

// The ruler is the best scoring adult in the capital: Charisma, Intelligence
// and Ambition. The heir is their eldest grown child, or the runner up.
export function chooseRuler(sim: Sim, k: Kingdom) {
  const u = sim.units;
  const heir = u.find(k.heir);
  let best = heir >= 0 && u.town[heir] && sim.town(u.town[heir]!)?.kingdom === k.id ? heir : -1;
  if (best < 0) {
    let bestScore = -1;
    for (let s = 0; s < u.count; s++) {
      if (!u.alive[s] || u.town[s] !== k.capital || u.age[s]! < SPECIES_INFO[u.kind[s]!]!.adult) continue;
      const g = u.genesOf(s);
      const score = stat(g, STAT.charisma) + stat(g, STAT.intelligence) + g[G.personality + PERSONALITY.ambition]! / 20;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
  }
  if (best < 0) return;
  const changed = k.ruler !== u.uid[best];
  k.ruler = u.uid[best]!;
  k.rulerName = u.names[best]!;
  k.heir = eldestChild(sim, k.ruler);
  if (changed) sim.chronicle("ruler", { name: k.rulerName, kingdom: k.name });
}

function eldestChild(sim: Sim, uid: number): number {
  const u = sim.units;
  let best = 0;
  let age = -1;
  for (let s = 0; s < u.count; s++) {
    if (!u.alive[s] || (u.mother[s] !== uid && u.father[s] !== uid)) continue;
    if (u.age[s]! > age) {
      age = u.age[s]!;
      best = u.uid[s]!;
    }
  }
  return best;
}

// Who each tile belongs to. Towns claim a circle that grows with them; the
// nearest claimant wins.
export function updateTerritory(sim: Sim) {
  const w = sim.world;
  const owner = sim.civ.owner;
  const next = new Uint16Array(owner.length);
  const best = new Float32Array(owner.length).fill(Infinity);
  for (const t of sim.towns) {
    if (!t.alive || !t.kingdom) continue;
    const r = 3 + Math.sqrt(t.pop) * 1.6 + t.stage * 2;
    const x0 = Math.max(0, Math.floor(t.x - r));
    const x1 = Math.min(w.w - 1, Math.ceil(t.x + r));
    const y0 = Math.max(0, Math.floor(t.y - r));
    const y1 = Math.min(w.h - 1, Math.ceil(t.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y) / r;
        const i = y * w.w + x;
        if (d >= 1 || d >= best[i]! || w.height[i]! < w.seaLevel) continue;
        best[i] = d;
        next[i] = t.kingdom;
      }
    }
  }
  sim.civ.borders.clear();
  for (let y = 0; y < w.h; y++) {
    for (let x = 1; x < w.w; x++) {
      const i = y * w.w + x;
      const a = next[i]!;
      const b = next[i - 1]!;
      if (a && b && a !== b) sim.civ.borders.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  let changed = false;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== next[i]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  owner.set(next);
  sim.civ.ownerChanged = true;
}

// Yearly: count towns, settle successions, move loyalty, and let unhappy towns rebel.
export function updateKingdoms(sim: Sim) {
  const towns = sim.towns.filter((t) => t.alive);
  for (const k of sim.civ.kingdoms) {
    if (!k.alive) continue;
    const mine = towns.filter((t) => t.kingdom === k.id);
    k.towns = mine.length;
    k.pop = mine.reduce((n, t) => n + t.pop, 0);
    if (!mine.length) {
      k.alive = false;
      k.fell = sim.tick;
      sim.chronicle("fallen", { name: k.name });
      continue;
    }
    if (!sim.town(k.capital)) {
      k.capital = mine.reduce((a, b) => (b.pop > a.pop ? b : a)).id;
      chooseRuler(sim, k);
    }
    if (sim.units.find(k.ruler) < 0) chooseRuler(sim, k);
  }
  const total = towns.length;
  for (const t of towns) loyalty(sim, t, total);
  for (const t of towns) if (t.loyalty < L.rebelBelow && t.pop >= L.rebelMinPop) rebel(sim, t);
}

function loyalty(sim: Sim, t: Town, totalTowns: number) {
  const k = kingdom(sim, t.kingdom);
  if (!k) return;
  const capital = sim.town(k.capital);
  if (!capital || capital.id === t.id) {
    t.loyalty = 100;
    return;
  }
  const u = sim.units;
  const ruler = u.find(k.ruler);
  const charm = ruler >= 0 ? (stat(u.genesOf(ruler), STAT.charisma) - 10) * L.charisma : 0;
  let target = L.base + charm + Math.hypot(capital.x - t.x, capital.y - t.y) * L.distancePerTile;
  if (t.food < t.pop * 0.5) target += L.famine;
  // A crown stretched over many towns is harder to love.
  target += Math.max(0, k.towns - L.comfortTowns) * L.perTownOver;
  const faith = townReligion(sim, t);
  if (k.religion && faith) target += faith === k.religion ? L.sameReligion : L.otherReligion;
  // The Director leans on empires that own more than half the world.
  if (k.towns > totalTowns * civ.director.dominance) target += L.dominance * sim.directorScale();
  t.loyalty += (Math.max(0, Math.min(100, target)) - t.loyalty) * L.pull;
}

function rebel(sim: Sim, t: Town) {
  const old = kingdom(sim, t.kingdom);
  if (!old || old.capital === t.id) return;
  const fresh = newKingdom(sim, t, culture(sim, old.culture)!, old.id);
  for (const o of sim.towns) {
    if (!o.alive || o.kingdom !== old.id || o.id === old.capital) continue;
    if (o.loyalty < L.joinBelow && Math.hypot(o.x - t.x, o.y - t.y) < L.joinRange) {
      o.kingdom = fresh.id;
      o.loyalty = 70;
    }
  }
}

// Most common faith among a town's people, 0 if none.
export function townReligion(sim: Sim, t: Town): number {
  const u = sim.units;
  const counts = new Map<number, number>();
  for (let s = 0; s < u.count; s++) {
    if (u.alive[s] && u.town[s] === t.id && u.religion[s]) counts.set(u.religion[s]!, (counts.get(u.religion[s]!) ?? 0) + 1);
  }
  let best = 0;
  let n = 0;
  counts.forEach((c, id) => {
    if (c > n) {
      n = c;
      best = id;
    }
  });
  return best;
}
