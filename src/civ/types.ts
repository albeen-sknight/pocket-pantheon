// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import civ from "../../data/civ.json";
import type { Language } from "./language";

export const RES = Object.fromEntries(civ.resources.map((r, i) => [r, i])) as Record<string, number>;
export const RESOURCES = civ.resources;
export const AGES = civ.ages.map((a) => a.key);

export interface Culture {
  id: number;
  race: number;
  lang: Language;
}

export interface Kingdom {
  id: number;
  name: string; // place word in the culture's language
  culture: number;
  race: number;
  color: number; // index into civ.kingdomColors
  capital: number; // town id
  ruler: number; // uid, 0 none
  heir: number;
  rulerName: string;
  age: number; // tech age index
  research: number;
  gold: number;
  traits: number[]; // culture trait indices
  religion: number; // state religion, 0 none
  founded: number; // tick
  parent: number; // kingdom it split from, 0 none
  alive: boolean;
  fell?: number; // tick it lost its last town
  towns: number;
  pop: number;
}

export type RelationState = "none" | "trade" | "alliance" | "embargo" | "rivals";

export interface Relation {
  a: number;
  b: number;
  opinion: number; // minus 100 to 100
  state: RelationState;
}

export interface Religion {
  id: number;
  name: string;
  founder: string;
  doctrines: number[];
  color: number;
  parent: number; // the faith it split from, 0 none
  founded: number;
  kingdom: number;
  followers: number;
  alive: boolean;
}

export interface Subspecies {
  id: number;
  race: number;
  name: string;
  tint: number; // skin variant used for its people
  traits: number[];
  parent: number;
  founded: number;
  kingdom: number;
  count: number;
}

export interface Legend {
  id: number;
  name: string;
  tier: number;
  maker: string;
  owner: number; // uid
  kills: number;
  made: number;
}

export interface Grave {
  kind: number;
  x: number;
  y: number;
  name: string;
  genes: number[];
  town: number;
  tick: number;
}

// One line in the chronicle. The Director's entries carry a reason.
export interface Chronicle {
  tick: number;
  kind: string;
  text: Record<string, string | number>;
  why?: string;
}
