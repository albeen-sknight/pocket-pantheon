// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Faiths (PLAN section 11): a prophet with high Faith and Charisma founds one
// with 2 doctrines, temples and missionaries spread it, and faiths that
// stretch across kingdoms can splinter into sects.
import civ from "../../data/civ.json";
import { STAT, stat } from "../sim/genes";
import type { Sim, Town } from "../sim/sim";
import { SPECIES_INFO } from "../sim/species";
import { culture, kingdom, kingdomOfTown, townReligion } from "./kingdoms";
import { shortName } from "./language";
import type { Religion } from "./types";

const F = civ.religion;

export function religion(sim: Sim, id: number): Religion | undefined {
  return id > 0 ? sim.civ.religions[id - 1] : undefined;
}

export function yearlyReligion(sim: Sim) {
  countFollowers(sim);
  prophets(sim);
  stateReligions(sim);
  if (sim.year > 0 && sim.year % F.sectEvery === 0) sects(sim);
}

function countFollowers(sim: Sim) {
  const u = sim.units;
  for (const r of sim.civ.religions) r.followers = 0;
  for (let s = 0; s < u.count; s++) {
    const r = u.alive[s] ? religion(sim, u.religion[s]!) : undefined;
    if (r) r.followers++;
  }
  for (const r of sim.civ.religions) {
    if (r.alive && r.followers === 0 && sim.tick - r.founded > 1200) {
      r.alive = false;
      sim.chronicle("faith_lost", { faith: r.name });
    }
  }
}

function prophets(sim: Sim) {
  const u = sim.units;
  const r = sim.rng.civ;
  for (const t of sim.towns) {
    if (!t.alive || t.pop < F.minPeople || townReligion(sim, t)) continue;
    for (let s = 0; s < u.count; s++) {
      if (!u.alive[s] || u.town[s] !== t.id || u.religion[s] || u.age[s]! < SPECIES_INFO[u.kind[s]!]!.adult) continue;
      const g = u.genesOf(s);
      if (stat(g, STAT.faith) < F.prophetFaith || stat(g, STAT.charisma) < F.prophetCharisma) continue;
      if (!r.chance(F.prophetChance * t.pop)) continue;
      found(sim, s, t, 0);
      return; // one new faith a year is plenty
    }
  }
}

export function found(sim: Sim, prophet: number, t: Town, parent: number): Religion {
  const u = sim.units;
  const r = sim.rng.civ;
  const k = kingdomOfTown(sim, t);
  const lang = k ? culture(sim, k.culture)!.lang : sim.civ.cultures[0]!.lang;
  const old = religion(sim, parent);
  const doctrines = old ? [...old.doctrines] : [];
  if (old) doctrines[r.int(0, 1)] = r.int(0, civ.doctrines.length - 1);
  while (doctrines.length < 2) {
    const d = r.int(0, civ.doctrines.length - 1);
    if (!doctrines.includes(d)) doctrines.push(d);
  }
  const faith: Religion = {
    id: sim.civ.religions.length + 1,
    name: shortName(lang, r),
    founder: u.names[prophet] ?? "",
    doctrines,
    color: r.int(0, civ.kingdomColors.length - 1),
    parent,
    founded: sim.tick,
    kingdom: k?.id ?? 0,
    followers: 0,
    alive: true,
  };
  sim.civ.religions.push(faith);
  u.religion[prophet] = faith.id;
  // The prophet's town comes around to the new faith.
  for (let s = 0; s < u.count; s++) if (u.alive[s] && u.town[s] === t.id && r.chance(0.7)) u.religion[s] = faith.id;
  sim.chronicle(parent ? "sect" : "faith", { faith: faith.name, name: faith.founder, old: old?.name ?? "" });
  return faith;
}

function stateReligions(sim: Sim) {
  for (const k of sim.civ.kingdoms) {
    if (!k.alive) continue;
    const capital = sim.town(k.capital);
    const faith = capital ? townReligion(sim, capital) : 0;
    if (faith && faith !== k.religion) {
      k.religion = faith;
      sim.chronicle("state_faith", { kingdom: k.name, faith: religion(sim, faith)!.name });
    }
  }
}

// A faith whose followers sit in a distant kingdom may break away there.
function sects(sim: Sim) {
  const r = sim.rng.civ;
  for (const faith of [...sim.civ.religions]) {
    if (!faith.alive || !r.chance(F.sectChance)) continue;
    const home = kingdom(sim, faith.kingdom);
    const away = sim.towns.find((t) => {
      if (!t.alive || t.kingdom === faith.kingdom || townReligion(sim, t) !== faith.id) return false;
      const capital = home ? sim.town(home.capital) : undefined;
      return !capital || Math.hypot(capital.x - t.x, capital.y - t.y) > 40;
    });
    if (!away) continue;
    const u = sim.units;
    const leader = [...Array(u.count).keys()].find((s) => u.alive[s] && u.town[s] === away.id && u.religion[s] === faith.id);
    if (leader === undefined) continue;
    const sect = found(sim, leader, away, faith.id);
    for (let s = 0; s < u.count; s++) if (u.alive[s] && u.town[s] === away.id && u.religion[s] === faith.id) u.religion[s] = sect.id;
  }
}

// Praying at a temple can bring someone into the temple's faith.
export function prayAtTemple(sim: Sim, s: number, t: Town) {
  const faith = townReligion(sim, t);
  const u = sim.units;
  if (!faith || u.religion[s] === faith) return;
  if (sim.rng.civ.chance(F.convertAtTemple * (u.religion[s] ? 0.3 : 1))) u.religion[s] = faith;
}

// Priests preach to whoever is around them; now and then they walk to
// another town to do it.
export function preach(sim: Sim, priest: number) {
  const u = sim.units;
  const faith = u.religion[priest]!;
  if (!faith) return;
  sim.grid.query(u.x[priest]!, u.y[priest]!, 5, (o) => {
    if (o !== priest && u.kind[o]! < 4 && u.religion[o] !== faith && sim.rng.civ.chance(F.missionConvert)) u.religion[o] = faith;
  });
}
