// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The simulation: units, towns and buildings on top of the world tiles.
// Deterministic: one seeded random stream per system, fixed iteration order,
// and every command applies at a known tick.
import buildingData from "../../data/buildings.json";
import civData from "../../data/civ.json";
import config from "../../data/sim.json";
import { yearlyDiplomacy, type LiveRelation } from "../civ/diplomacy";
import { yearlyEconomy } from "../civ/economy";
import { inherit } from "../civ/gear";
import { grace, type GracePower } from "../civ/grace";
import { culture, kingdom, kingdomOfTown, newCulture, newKingdom, updateKingdoms, updateTerritory } from "../civ/kingdoms";
import { personName, placeName } from "../civ/language";
import { yearlyReligion } from "../civ/religion";
import { checkSubspecies, rememberBaseline, split } from "../civ/subspecies";
import { RESOURCES, type Chronicle, type Culture, type Grave, type Kingdom, type Legend, type Religion, type Subspecies } from "../civ/types";
import { directorYear, type DirectorMode } from "../director/director";
import warData from "../../data/war.json";
import { moraleHit, raiseArmy, updateArmies, type Army, type Stance } from "../war/armies";
import { buildWalls, towersShoot, unitKingdom } from "../war/defense";
import { wakeGuardian } from "../war/wonders";
import { History } from "../stats/history";
import { NO_INPUT, possessTick, type PossessInput } from "../war/possess";
import { activeWar, declareWar, endWar, sideOf, yearlyWars, type War } from "../war/wars";
import { relation } from "../civ/diplomacy";
import { createRng, type Rng } from "../core/rng";
import { B, BIOMES, isWaterBiome } from "../world/biomes";
import { applyStroke, reclassify, type Rect, type Stroke } from "../world/edit";
import { naturalEvents, tickPlague, tickStorms, wrath, type FrequencyKey, type Storm, type WrathPower } from "../chaos/disasters";
import { Hazards, tickHazards, yearlyHazards } from "../chaos/hazards";
import { returnAbductees, spawnMonsters } from "../chaos/monsters";
import { walkTo } from "./mind";
import { FARM, LAKE, RIVER, ROAD, WALL, type World } from "../world/types";
import { inheritBrain, randomBrain } from "./brain";
import { addTrait, G, inheritGenes, mutate, randomGenes, removeTrait, STAT, stat } from "./genes";
import { thinkAll, moveAll } from "./mind";
import { Pathfinder } from "./path";
import { SpatialGrid } from "./spatial";
import { isCiv, RACE_COUNT, RACES, SPECIES, SPECIES_INFO, WILD, type RaceKey } from "./species";
import { planTowns, updateTownStats } from "./towns";
import { DEATH, Units } from "./units";

export type BuildingType = keyof typeof buildingData;
export const BUILDING_TYPES = Object.keys(buildingData) as BuildingType[];
export const TPY = config.ticksPerYear;

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  w: number;
  h: number;
  town: number;
  race: number;
  progress: number; // work done
  done: boolean;
  guarded?: boolean; // a wonder whose Guardian has woken
}

export interface Town {
  id: number;
  race: number;
  name: string;
  x: number;
  y: number;
  food: number;
  wood: number;
  pop: number;
  housing: number;
  stage: number; // 0 camp, 1 village, 2 town, 3 city
  founded: number;
  lastSettle: number;
  alive: boolean;
  kingdom: number;
  loyalty: number; // 0 to 100
  res: number[]; // stockpile per resource in data/civ.json (food and wood live above)
}

// Everything kingdoms, faiths and history need, kept together for saves.
export class CivState {
  cultures: Culture[] = [];
  raceCulture: number[] = []; // the culture wandering bands of each race speak
  kingdoms: Kingdom[] = [];
  relations = new Map<string, LiveRelation>();
  religions: Religion[] = [];
  subspecies: Subspecies[] = [];
  legends: Legend[] = [];
  graves: Grave[] = [];
  log: Chronicle[] = [];
  baseline: number[][] = [];
  everLived: boolean[] = [];
  goneSince: number[] = [];
  owner: Uint16Array;
  ownerChanged = true;
  borders = new Set<string>();
  settlements: { x: number; y: number; kingdom: number; until: number }[] = [];
  wars: War[] = [];
  armies: Army[] = [];
  warPairs = new Set<string>();
  lastWar = 0;
  nextArmy = 1;
  wallHp: Uint8Array;

  constructor(tiles: number) {
    this.owner = new Uint16Array(tiles);
    this.wallHp = new Uint8Array(tiles);
  }
}

export interface Fx {
  kind: string;
  x: number;
  y: number;
  r: number;
  tx?: number; // for arrows: where they land
  ty?: number;
}

export type ArmyOrder = "move" | "attack" | "defend" | "hold" | "retreat" | "stance";

export type SimEvent =
  | { t: "birth"; uid: number; kind: number; tick: number }
  | { t: "death"; uid: number; kind: number; cause: number; tick: number; name: string }
  | { t: "town"; town: number; race: number; tick: number; name: string }
  | { t: "built"; building: number; type: BuildingType; town: number; tick: number }
  | { t: "stage"; town: number; stage: number; tick: number }
  | { t: "marry"; a: number; b: number; tick: number }
  | { t: "chronicle"; entry: Chronicle };

export type Command =
  | { c: "spawn"; kind: number; x: number; y: number; count: number }
  | { c: "stroke"; stroke: Stroke }
  | { c: "mutate"; uid: number }
  | { c: "trait"; uid: number; trait: number; add: boolean }
  | { c: "clone"; uid: number }
  | { c: "kill"; uid: number }
  | { c: "grace"; power: GracePower; x: number; y: number; radius: number }
  | { c: "split"; uid: number }
  | { c: "director"; mode: DirectorMode; lifeReturns: boolean }
  | { c: "war"; a: number; b: number }
  | { c: "peace"; a: number; b: number }
  | { c: "ally"; a: number; b: number }
  | { c: "army"; id: number; order: ArmyOrder; x: number; y: number; town?: number; stance?: Stance }
  | { c: "recruit"; town: number }
  | { c: "possess"; uid: number }
  | { c: "release" }
  | { c: "input"; input: PossessInput }
  | { c: "wrath"; power: WrathPower; x: number; y: number; radius: number }
  | { c: "frequency"; value: FrequencyKey };

export class Sim {
  tick = 0;
  readonly units: Units;
  buildings: Building[] = [];
  towns: Town[] = [];
  readonly occ: Int32Array; // building id + 1 per tile, 0 empty
  readonly heat: Uint16Array; // footsteps, for roads
  readonly chops: Uint8Array; // trees cut per tile
  readonly grid: SpatialGrid;
  readonly paths: Pathfinder;
  readonly rng: { life: Rng; mind: Rng; genes: Rng; towns: Rng; spawn: Rng; civ: Rng; chaos: Rng };
  readonly civ: CivState;
  directorMode: DirectorMode = "normal";
  possessed = 0; // uid the player is driving
  readonly hazards: Hazards;
  readonly history = new History();
  storms: Storm[] = [];
  nextStorm = 1;
  lastNotable = 0; // tick of the last disaster, for the Director's quiet rule
  disasterFrequency: FrequencyKey = "normal";
  abducted: { kind: number; genes: number[]; name: string; town: number; back: number }[] = [];
  input: PossessInput = { ...NO_INPUT };
  jump = 0; // ticks left in the air
  lifeReturns = true;
  fx: Fx[] = [];
  events: SimEvent[] = [];
  changed = new Set<number>(); // tiles the sim changed since the last frame
  buildingsChanged = true;
  speciesCount: Int32Array;
  speciesCap: Float32Array;
  private nextBuilding = 1;
  private nextTown = 1;

  constructor(readonly world: World, seed: number, capacity = config.unitCaps[world.options.size]) {
    const n = world.w * world.h;
    this.units = new Units(capacity);
    this.occ = new Int32Array(n);
    this.heat = new Uint16Array(n);
    this.chops = new Uint8Array(n);
    this.grid = new SpatialGrid(world.w, world.h, capacity);
    this.paths = new Pathfinder(world.w, world.h);
    this.rng = {
      life: createRng(seed * 7 + 1),
      mind: createRng(seed * 7 + 2),
      genes: createRng(seed * 7 + 3),
      towns: createRng(seed * 7 + 4),
      spawn: createRng(seed * 7 + 5),
      civ: createRng(seed * 7 + 6),
      chaos: createRng(seed * 7 + 7),
    };
    this.hazards = new Hazards(n);
    this.civ = new CivState(n);
    for (let race = 0; race < RACE_COUNT; race++) {
      this.civ.raceCulture[race] = newCulture(this, race).id;
      this.civ.everLived[race] = false;
      this.civ.goneSince[race] = -1;
    }
    this.speciesCount = new Int32Array(SPECIES.length);
    this.speciesCap = new Float32Array(SPECIES.length);
    this.updateCaps();
  }

  get year(): number {
    return Math.floor(this.tick / TPY);
  }

  get ticksPerYear(): number {
    return TPY;
  }

  get ticksPerSecond(): number {
    return config.ticksPerSecond;
  }

  // World setup: animals at half their carrying capacity, and a band of each
  // starting race on land it likes.
  populate(startRaces: RaceKey[]) {
    const r = this.rng.spawn;
    for (let a = 0; a < WILD.length; a++) {
      const kind = RACE_COUNT + a;
      const want = Math.floor(this.speciesCap[kind]! * config.life.animalStartShare);
      for (let n = 0; n < want; n++) {
        const at = this.randomHabitatTile(kind, r);
        if (at >= 0) this.spawnUnit(kind, (at % this.world.w) + 0.5, Math.floor(at / this.world.w) + 0.5, r.int(0, SPECIES_INFO[kind]!.lifespan[0] - 1));
      }
    }
    for (const key of startRaces) {
      const kind = RACES.indexOf(key);
      const at = this.bestStart(kind, r);
      if (at >= 0) this.spawnBand(kind, (at % this.world.w) + 0.5, Math.floor(at / this.world.w) + 0.5, config.life.startBand);
    }
    rememberBaseline(this);
  }

  private countCasualty(slot: number) {
    moraleHit(this, slot);
    const kid = unitKingdom(this, slot);
    if (!kid) return;
    for (const w of this.civ.wars) {
      if (w.end) continue;
      const side = sideOf(w, kid);
      if (side === -1) continue;
      w.casualties[side]++;
      w.log ??= [];
      let row = w.log.at(-1);
      if (row?.year !== this.year) w.log.push((row = { year: this.year, a: 0, b: 0 }));
      if (side === 0) row.a++;
      else row.b++;
    }
  }

  // History, for the chronicle and the UI. Director entries carry a reason.
  chronicle(kind: string, text: Chronicle["text"], why?: string) {
    const entry: Chronicle = { tick: this.tick, kind, text, why };
    this.civ.log.push(entry);
    if (this.civ.log.length > 4000) this.civ.log.splice(0, 1000);
    this.events.push({ t: "chronicle", entry });
  }

  directorScale(): number {
    return civData.director.modes[this.directorMode];
  }

  private randomHabitatTile(kind: number, r: Rng): number {
    const s = SPECIES_INFO[kind]!;
    for (let tries = 0; tries < 60; tries++) {
      const i = r.int(0, this.world.biome.length - 1);
      if (s.habitat.has(this.world.biome[i]!) && this.passable(kind, i)) return i;
    }
    return -1;
  }

  private bestStart(kind: number, r: Rng): number {
    const s = SPECIES_INFO[kind]!;
    let best = -1;
    let bestScore = -Infinity;
    for (let tries = 0; tries < 400; tries++) {
      const i = r.int(0, this.world.biome.length - 1);
      if (!this.passable(kind, i) || isWaterBiome(this.world.biome[i]!)) continue;
      if (this.world.fertility[i]! < 80) continue;
      let score = s.habitat.has(this.world.biome[i]!) ? 2 : 0;
      score += this.world.fertility[i]! / 64;
      score -= this.distanceToTowns(i) < 30 ? 5 : 0;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private distanceToTowns(i: number): number {
    const x = i % this.world.w;
    const y = Math.floor(i / this.world.w);
    let d = Infinity;
    for (const t of this.towns) if (t.alive) d = Math.min(d, Math.hypot(t.x - x, t.y - y));
    return d;
  }

  // Units

  spawnBand(kind: number, x: number, y: number, count: number) {
    const r = this.rng.spawn;
    if (isCiv(kind)) this.civ.everLived[kind] = true;
    const adult = SPECIES_INFO[kind]!.adult;
    for (let n = 0; n < count; n++) {
      const slot = this.spawnUnit(kind, x + r.next() * 3 - 1.5, y + r.next() * 3 - 1.5, adult + r.int(0, Math.max(2, adult)));
      if (slot >= 0) this.units.sex[slot] = n % 2;
    }
  }

  spawnUnit(kind: number, x: number, y: number, age = 0, parents?: [number, number]): number {
    const u = this.units;
    const w = this.world;
    const tx = Math.min(w.w - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(w.h - 1, Math.max(0, Math.floor(y)));
    if (!this.passable(kind, ty * w.w + tx)) return -1;
    const slot = u.add(kind, tx + (x - Math.floor(x)), ty + (y - Math.floor(y)), this.tick);
    if (slot < 0) return -1;
    const r = this.rng.genes;
    u.sex[slot] = r.int(0, 1);
    u.age[slot] = age;
    if (parents) {
      const [m, f] = parents;
      const wild = w.biome[ty * w.w + tx] === B.mushroom || w.biome[ty * w.w + tx] === B.wasteland;
      inheritGenes(u.genesOf(m), u.genesOf(f), kind, r, wild, u.genesOf(slot));
      inheritBrain(u.brainOf(m), u.brainOf(f), r, u.brainOf(slot));
      u.mother[slot] = u.uid[m]!;
      u.father[slot] = u.uid[f]!;
      u.religion[slot] = u.religion[m]!;
      u.subspecies[slot] = u.subspecies[m]!;
    } else {
      randomGenes(kind, r, u.genesOf(slot));
      randomBrain(r, u.brainOf(slot));
    }
    u.hp[slot] = this.maxHp(slot);
    if (isCiv(kind)) u.names[slot] = this.makeName(kind, parents ? u.town[parents[0]]! : -1);
    if (isCiv(kind) && parents) this.history.onBirth();
    this.speciesCount[kind]!++;
    return slot;
  }

  maxHp(slot: number): number {
    const g = this.units.genesOf(slot);
    const base = SPECIES_INFO[this.units.kind[slot]!]!.hp;
    return base * (0.6 + stat(g, STAT.vitality) / 25 + stat(g, STAT.size) / 40);
  }

  kill(slot: number, cause: number) {
    const u = this.units;
    if (!u.alive[slot]) return;
    const kind = u.kind[slot]!;
    if (isCiv(kind)) {
      this.events.push({ t: "death", uid: u.uid[slot]!, kind, cause, tick: this.tick, name: u.names[slot]! });
      this.history.onDeath(cause);
      if (cause === DEATH.battle) this.countCasualty(slot);
      if (u.uid[slot] === this.possessed) this.possessed = 0;
      const graves = this.civ.graves;
      graves.push({ kind, x: u.x[slot]!, y: u.y[slot]!, name: u.names[slot]!, genes: Array.from(u.genesOf(slot)), town: u.town[slot]!, tick: this.tick });
      if (graves.length > civData.director.graveyard) graves.shift();
      if (u.gearQ[slot] === 4) inherit(this, u.uid[slot]!);
      const k = kingdomOfTown(this, this.town(u.town[slot]!));
      if (k && k.ruler === u.uid[slot]) this.chronicle("ruler_died", { name: u.names[slot]!, kingdom: k.name });
    }
    const spouse = u.find(u.spouse[slot]!);
    if (spouse >= 0) u.spouse[spouse] = 0;
    this.speciesCount[kind]!--;
    u.remove(slot);
  }

  // Names come from the language of the kingdom someone is born into, or
  // their race's wandering culture.
  private makeName(kind: number, townId: number): string {
    return personName(this.cultureFor(kind, townId).lang, this.rng.civ);
  }

  cultureFor(kind: number, townId: number): Culture {
    const k = kingdomOfTown(this, this.town(townId));
    return culture(this, k ? k.culture : this.civ.raceCulture[kind]!)!;
  }

  // Terrain

  passable(kind: number, i: number): boolean {
    const w = this.world;
    const s = SPECIES_INFO[kind]!;
    if (i < 0 || i >= w.biome.length) return false;
    const water = w.height[i]! < w.seaLevel || (w.flags[i]! & LAKE) !== 0;
    if (s.swims) return water;
    if (s.flies) return true;
    if (water) return false;
    if (w.biome[i] === B.snowPeaks && !s.climbs) return false;
    return true;
  }

  // Movement cost into a tile for pathfinding.
  moveCost(kind: number, i: number, kingdom = 0): number {
    if (!this.passable(kind, i)) return Infinity;
    const w = this.world;
    const s = SPECIES_INFO[kind]!;
    if (w.flags[i]! & WALL && !s.flies && this.civ.owner[i] !== kingdom) return Infinity;
    if (w.flags[i]! & ROAD) return 0.7;
    if (w.flags[i]! & RIVER && !s.flies) return 2.5;
    const b = w.biome[i]!;
    if (b === B.mountains || b === B.snowPeaks) return s.climbs ? 1.4 : 3;
    if (b === B.swamp) return 2;
    if (b === B.forest || b === B.jungle || b === B.taiga) return 1.3;
    return 1;
  }

  setTileFlag(i: number, flag: number, on: boolean) {
    const f = this.world.flags[i]!;
    const next = on ? f | flag : f & ~flag;
    if (next === f) return;
    this.world.flags[i] = next;
    this.changed.add(i);
  }

  setBiome(i: number, biome: number) {
    if (this.world.biome[i] === biome) return;
    this.world.biome[i] = biome;
    this.changed.add(i);
  }

  // Buildings

  canPlace(type: BuildingType, x: number, y: number): boolean {
    const [bw, bh] = buildingData[type].size as [number, number];
    const w = this.world;
    if (x < 1 || y < 1 || x + bw >= w.w - 1 || y + bh >= w.h - 1) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let dy = -1; dy <= bh; dy++) {
      for (let dx = -1; dx <= bw; dx++) {
        const i = (y + dy) * w.w + x + dx;
        if (this.occ[i]) return false; // keep a one tile gap for paths
        const inside = dx >= 0 && dy >= 0 && dx < bw && dy < bh;
        if (!inside) continue;
        if (w.height[i]! < w.seaLevel || w.flags[i]! & (LAKE | RIVER)) return false;
        const b = w.biome[i]!;
        if (b === B.snowPeaks || b === B.mountains) return false;
        lo = Math.min(lo, w.height[i]!);
        hi = Math.max(hi, w.height[i]!);
      }
    }
    return hi - lo < 0.05;
  }

  place(type: BuildingType, x: number, y: number, town: number, race: number, done = false): Building {
    const [bw, bh] = buildingData[type].size as [number, number];
    const b: Building = { id: this.nextBuilding++, type, x, y, w: bw, h: bh, town, race, progress: done ? buildingData[type].work : 0, done };
    this.buildings.push(b);
    for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) this.occ[(y + dy) * this.world.w + x + dx] = b.id;
    if (done) this.finish(b);
    this.buildingsChanged = true;
    return b;
  }

  finish(b: Building) {
    b.done = true;
    b.progress = buildingData[b.type].work;
    if (b.type === "farm") {
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) this.setTileFlag((b.y + dy) * this.world.w + b.x + dx, FARM, true);
    }
    this.events.push({ t: "built", building: b.id, type: b.type, town: b.town, tick: this.tick });
    this.buildingsChanged = true;
  }

  // A finished wonder shrugs off its first blow: the Guardian wakes instead.
  // Burning a conquered town forces it.
  removeBuilding(b: Building, force = false) {
    if (!force && b.type === "wonder" && b.done && !b.guarded) return wakeGuardian(this, b);
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const i = (b.y + dy) * this.world.w + b.x + dx;
        this.occ[i] = 0;
        this.setTileFlag(i, FARM, false);
      }
    }
    this.buildings = this.buildings.filter((o) => o !== b);
    const u = this.units;
    for (let s = 0; s < u.count; s++) if (u.alive[s] && u.home[s] === b.id) u.home[s] = -1;
    this.buildingsChanged = true;
  }

  // Puts a saved building back without events or construction.
  restoreBuilding(b: Building) {
    this.buildings.push(b);
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) this.occ[(b.y + dy) * this.world.w + b.x + dx] = b.id;
    this.buildingsChanged = true;
  }

  ids() {
    return { building: this.nextBuilding, town: this.nextTown };
  }

  setIds(building: number, town: number) {
    this.nextBuilding = building;
    this.nextTown = town;
  }

  // Species counts after loading.
  recount() {
    this.speciesCount.fill(0);
    const u = this.units;
    for (let s = 0; s < u.count; s++) if (u.alive[s]) this.speciesCount[u.kind[s]!]!++;
  }

  building(id: number): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  // Towns

  foundTown(race: number, x: number, y: number): Town | null {
    const hall = this.findSite("hall", Math.round(x) - 1, Math.round(y) - 1, 0, 8);
    if (!hall) return null;
    const settle = this.civ.settlements.find((p) => Math.hypot(p.x - x, p.y - y) < 12 && p.until > this.tick && kingdom(this, p.kingdom)?.race === race);
    const parentKingdom = settle ? kingdom(this, settle.kingdom) : undefined;
    const lang = culture(this, parentKingdom ? parentKingdom.culture : this.civ.raceCulture[race]!)!.lang;
    const t: Town = {
      id: this.nextTown++,
      race,
      name: placeName(lang, this.rng.civ),
      x: hall[0] + 1,
      y: hall[1] + 1,
      food: config.town.startFood,
      wood: config.town.startWood,
      pop: 0,
      housing: 0,
      stage: 0,
      founded: this.tick,
      lastSettle: this.tick,
      alive: true,
      kingdom: 0,
      loyalty: civData.loyalty.start,
      res: new Array(RESOURCES.length).fill(0),
    };
    this.towns.push(t);
    this.place("hall", hall[0], hall[1], t.id, race, true);
    this.events.push({ t: "town", town: t.id, race, tick: this.tick, name: t.name });
    // Settlers stay under their old crown if home is close enough; a band on
    // its own starts a kingdom with a culture and language of its own.
    const home = parentKingdom ? this.town(parentKingdom.capital) : undefined;
    if (parentKingdom && home && Math.hypot(home.x - t.x, home.y - t.y) < civData.loyalty.vassalRange) {
      t.kingdom = parentKingdom.id;
    } else {
      // Far flung settlers break away from the crown that sent them.
      newKingdom(this, t, parentKingdom ? culture(this, parentKingdom.culture)! : newCulture(this, race), parentKingdom?.id ?? 0, parentKingdom ? "independence" : "kingdom");
    }
    return t;
  }

  town(id: number): Town | undefined {
    return id > 0 ? this.towns.find((t) => t.id === id && t.alive) : undefined;
  }

  // Spiral out from (cx, cy) for the first spot the building fits.
  findSite(type: BuildingType, cx: number, cy: number, rMin: number, rMax: number, accept: (x: number, y: number) => boolean = () => true): [number, number] | null {
    for (let r = rMin; r <= rMax; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (this.canPlace(type, x, y) && accept(x, y)) return [x, y];
        }
      }
    }
    return null;
  }

  // Commands from the player

  apply(cmd: Command): Rect | null {
    const u = this.units;
    switch (cmd.c) {
      case "spawn": {
        if (isCiv(cmd.kind)) this.spawnBand(cmd.kind, cmd.x, cmd.y, cmd.count);
        else for (let n = 0; n < cmd.count; n++) this.spawnUnit(cmd.kind, cmd.x + this.rng.spawn.next() * 4 - 2, cmd.y + this.rng.spawn.next() * 4 - 2, SPECIES_INFO[cmd.kind]!.adult);
        return null;
      }
      case "stroke": {
        const rect = applyStroke(this.world, cmd.stroke);
        if (rect) this.afterTerrainEdit(rect);
        return rect;
      }
      case "kill": {
        const s = u.find(cmd.uid);
        if (s >= 0) this.kill(s, DEATH.god);
        return null;
      }
      case "mutate": {
        const s = u.find(cmd.uid);
        if (s >= 0) mutate(u.genesOf(s), u.kind[s]!, this.rng.genes);
        return null;
      }
      case "trait": {
        const s = u.find(cmd.uid);
        if (s < 0) return null;
        if (cmd.add) addTrait(u.genesOf(s), cmd.trait + 1);
        else removeTrait(u.genesOf(s), cmd.trait + 1);
        return null;
      }
      case "wrath":
        wrath(this, cmd.power, cmd.x, cmd.y, cmd.radius);
        return null;
      case "frequency":
        this.disasterFrequency = cmd.value;
        return null;
      case "grace":
        grace(this, cmd.power, cmd.x, cmd.y, cmd.radius);
        return null;
      case "split": {
        const s = u.find(cmd.uid);
        const t = s >= 0 ? this.town(u.town[s]!) : undefined;
        if (!t?.kingdom) return null;
        const slots: number[] = [];
        for (let o = 0; o < u.count; o++) if (u.alive[o] && u.town[o] === t.id && u.kind[o] === u.kind[s]) slots.push(o);
        split(this, t.kingdom, slots);
        return null;
      }
      case "director":
        this.directorMode = cmd.mode;
        this.lifeReturns = cmd.lifeReturns;
        return null;
      case "war":
        declareWar(this, cmd.a, cmd.b, "god");
        return null;
      case "peace": {
        const w = activeWar(this, cmd.a, cmd.b);
        if (w) endWar(this, w, "peace", 0);
        return null;
      }
      case "ally": {
        const w = activeWar(this, cmd.a, cmd.b);
        if (w) endWar(this, w, "peace", 0);
        const rel = relation(this, cmd.a, cmd.b);
        rel.opinion = Math.max(rel.opinion, civData.diplomacy.alliance + 10);
        rel.state = "alliance";
        this.chronicle("alliance", { a: kingdom(this, cmd.a)?.name ?? "", b: kingdom(this, cmd.b)?.name ?? "" });
        return null;
      }
      case "army":
        this.orderArmy(cmd);
        return null;
      case "recruit": {
        const t = this.town(cmd.town);
        const k = t ? kingdom(this, t.kingdom) : undefined;
        const R = warData.recruit;
        if (!t || !k || t.food < R.food || k.gold < R.gold) return null;
        t.food -= R.food;
        k.gold -= R.gold;
        raiseArmy(this, t, this.civ.wars.find((w) => !w.end && sideOf(w, k.id) >= 0) ?? null, 0.5);
        return null;
      }
      case "possess":
        this.possessed = u.find(cmd.uid) >= 0 ? cmd.uid : 0;
        this.input = { ...NO_INPUT };
        return null;
      case "release":
        this.possessed = 0;
        return null;
      case "input":
        this.input = { ...cmd.input, talk: cmd.input.talk || this.input.talk, interact: cmd.input.interact || this.input.interact };
        return null;
      case "clone": {
        const s = u.find(cmd.uid);
        if (s < 0) return null;
        const twin = this.spawnUnit(u.kind[s]!, u.x[s]! + 0.6, u.y[s]!, u.age[s]!, [s, s]);
        if (twin < 0) return null;
        u.genesOf(twin).set(u.genesOf(s));
        u.brainOf(twin).set(u.brainOf(s));
        u.sex[twin] = u.sex[s]!;
        u.town[twin] = u.town[s]!;
        const town = this.town(u.town[s]!);
        if (town) town.pop++;
        return null;
      }
    }
  }

  private orderArmy(cmd: Extract<Command, { c: "army" }>) {
    const a = this.civ.armies.find((x) => x.id === cmd.id);
    if (!a) return;
    a.player = cmd.order !== "retreat";
    switch (cmd.order) {
      case "stance":
        a.stance = cmd.stance ?? "aggressive";
        return;
      case "hold":
        a.state = "hold";
        return;
      case "retreat": {
        const home = this.town(a.home);
        a.state = "retreat";
        a.target = { town: a.home, x: home?.x ?? a.x, y: (home?.y ?? a.y) + 2 };
        return;
      }
      case "attack":
        a.state = "march";
        a.target = { town: cmd.town ?? 0, x: cmd.x, y: cmd.y };
        return;
      case "defend":
        a.state = "defend";
        a.target = { town: 0, x: cmd.x, y: cmd.y };
        return;
      default:
        a.state = "march";
        a.target = { town: 0, x: cmd.x, y: cmd.y };
    }
  }

  // Units in new water drown, buildings in new water wash away.
  private afterTerrainEdit(r: Rect) {
    const w = this.world;
    const u = this.units;
    for (const b of [...this.buildings]) {
      if (b.x + b.w < r.x0 || b.x > r.x1 || b.y + b.h < r.y0 || b.y > r.y1) continue;
      let wet = false;
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) if (w.height[(b.y + dy) * w.w + b.x + dx]! < w.seaLevel) wet = true;
      if (wet) this.removeBuilding(b);
    }
    for (let s = 0; s < u.count; s++) {
      if (!u.alive[s] || u.x[s]! < r.x0 || u.x[s]! > r.x1 || u.y[s]! < r.y0 || u.y[s]! > r.y1) continue;
      const i = Math.floor(u.y[s]!) * w.w + Math.floor(u.x[s]!);
      if (!this.passable(u.kind[s]!, i)) this.kill(s, DEATH.drowning);
      else u.paths[s] = null;
    }
  }

  // The tick

  step() {
    const u = this.units;
    this.tick++;
    this.grid.rebuild(u.alive, u.x, u.y, u.count);
    thinkAll(this);
    moveAll(this);
    if (this.possessed) possessTick(this);
    tickHazards(this);
    tickStorms(this);
    tickPlague(this);
    if (this.tick % 30 === 0) spawnMonsters(this);
    if (this.abducted.length) returnAbductees(this);
    towersShoot(this);
    if (this.tick % warData.army.orderEvery === 0) updateArmies(this);
    this.yearly();
    if (this.tick % config.town.plannerEvery === 0) planTowns(this);
    if (this.tick % config.roads.decayEvery === 0) this.coolRoads();
    if (this.tick % TPY === 0) {
      this.updateCaps();
      updateTownStats(this);
      updateTerritory(this);
      updateKingdoms(this);
      yearlyEconomy(this);
      yearlyDiplomacy(this);
      yearlyReligion(this);
      checkSubspecies(this);
      directorYear(this);
      yearlyWars(this);
      yearlyHazards(this);
      naturalEvents(this);
      for (const t of this.towns) if (t.alive) buildWalls(this, t);
      this.history.sample(this);
    }
  }

  // Each unit runs its yearly checks on its own tick, spread across the year.
  private yearly() {
    const u = this.units;
    const phase = this.tick % TPY;
    for (let s = phase; s < u.count; s += TPY) {
      if (!u.alive[s]) continue;
      this.ageUnit(s);
      if (u.alive[s]) this.breed(s);
    }
  }

  private ageUnit(s: number) {
    const u = this.units;
    const kind = u.kind[s]!;
    u.age[s]! += 1;
    const g = u.genesOf(s);
    const span = isCiv(kind)
      ? (SPECIES_INFO[kind]!.lifespan[0] + SPECIES_INFO[kind]!.lifespan[1]) / 2 * (g[G.lifespan]! / 128) * (0.8 + stat(g, STAT.vitality) / 50)
      : SPECIES_INFO[kind]!.lifespan[1];
    if (u.age[s]! > span) return this.kill(s, DEATH.age);
    if (u.starve[s]! > config.life.starveYears) return this.kill(s, DEATH.hunger);
    u.hp[s] = Math.min(this.maxHp(s), u.hp[s]! + this.maxHp(s) * 0.3);
    if (u.blessed[s]! > 0) u.blessed[s] = Math.max(0, u.blessed[s]! - 1);
    if (u.fertile[s]! > 0) u.fertile[s] = Math.max(0, u.fertile[s]! - 1);
  }

  private breed(s: number) {
    const u = this.units;
    const kind = u.kind[s]!;
    const info = SPECIES_INFO[kind]!;
    if (u.sex[s] !== 0 || u.age[s]! < info.adult || u.age[s]! > info.elder) return;
    const r = this.rng.life;

    if (!info.civ) {
      if (this.speciesCount[kind]! >= this.speciesCap[kind]!) return;
      let mate = -1;
      this.grid.query(u.x[s]!, u.y[s]!, 10, (o) => {
        if (u.kind[o] === kind && u.sex[o] === 1 && u.age[o]! >= info.adult) mate = o;
        return mate >= 0;
      });
      if (mate < 0 || !r.chance(0.6)) return;
      const litter = r.int(1, info.litter);
      for (let n = 0; n < litter; n++) this.spawnUnit(kind, u.x[s]! + r.next() - 0.5, u.y[s]! + r.next() - 0.5, 0, [s, mate]);
      return;
    }

    if (!u.spouse[s]) this.court(s);
    const mate = u.find(u.spouse[s]!);
    if (mate < 0 || u.town[mate] !== u.town[s]) return;
    const town = this.town(u.town[s]!);
    if (!town || town.pop >= town.housing + 2) return;
    const fert = (stat(u.genesOf(s), STAT.fertility) + stat(u.genesOf(mate), STAT.fertility)) / 20;
    const boost = u.fertile[s]! > 0 ? 2 : 1;
    if (!r.chance(config.life.birthChancePerYear * fert * boost * (town.food > 0 ? 1 : 0.3))) return;
    const baby = this.spawnUnit(kind, u.x[s]!, u.y[s]!, 0, [s, mate]);
    if (baby < 0) return;
    u.town[baby] = town.id;
    u.home[baby] = u.home[s]!;
    town.pop++;
    this.events.push({ t: "birth", uid: u.uid[baby]!, kind, tick: this.tick });
  }

  // Single adults in the same town pair up over time, not only when a chat
  // happens to land.
  private court(s: number) {
    const u = this.units;
    if (u.town[s]! <= 0 || !this.rng.life.chance(0.35)) return;
    const kind = u.kind[s]!;
    const adult = SPECIES_INFO[kind]!.adult;
    for (let o = 0; o < u.count; o++) {
      if (!u.alive[o] || u.kind[o] !== kind || u.sex[o] === u.sex[s] || u.spouse[o] || u.town[o] !== u.town[s] || u.age[o]! < adult) continue;
      u.spouse[s] = u.uid[o]!;
      u.spouse[o] = u.uid[s]!;
      if (u.home[o]! >= 0) u.home[s] = u.home[o]!;
      this.events.push({ t: "marry", a: u.uid[s]!, b: u.uid[o]!, tick: this.tick });
      return;
    }
  }

  // Plans a walk for a unit; monsters and the UI use this.
  goTo(s: number, x: number, y: number, ticks: number) {
    walkTo(this, s, x, y, ticks);
  }

  // After the sim reshapes land itself (craters, quakes), redo biomes and tell the renderer.
  reclassify(x: number, y: number, r: number) {
    const w = this.world;
    const rect = reclassify(w, {
      x0: Math.max(0, Math.floor(x - r)),
      y0: Math.max(0, Math.floor(y - r)),
      x1: Math.min(w.w, Math.ceil(x + r) + 1),
      y1: Math.min(w.h, Math.ceil(y + r) + 1),
    });
    for (let ty = rect.y0; ty < rect.y1; ty++) for (let tx = rect.x0; tx < rect.x1; tx++) this.changed.add(ty * w.w + tx);
  }

  markAll(x: number, y: number, r: number) {
    this.reclassify(x, y, r);
  }

  private updateCaps() {
    const counts = new Int32Array(BIOMES.length);
    for (let i = 0; i < this.world.biome.length; i++) counts[this.world.biome[i]!]!++;
    for (let k = RACE_COUNT; k < SPECIES.length; k++) {
      const info = SPECIES_INFO[k]!;
      let tiles = 0;
      info.habitat.forEach((b) => (tiles += counts[b]!));
      this.speciesCap[k] = (tiles / 100) * info.cap;
    }
  }

  stepOn(slot: number, i: number) {
    if (!isCiv(this.units.kind[slot]!)) return;
    const w = this.world;
    const h = Math.min(65535, this.heat[i]! + config.roads.heatPerStep);
    this.heat[i] = h;
    if (h > config.roads.threshold && !this.occ[i] && !(w.flags[i]! & (ROAD | FARM | LAKE)) && w.height[i]! >= w.seaLevel) {
      this.setTileFlag(i, ROAD, true);
    }
  }

  private coolRoads() {
    const heat = this.heat;
    const k = config.roads.decay;
    for (let i = 0; i < heat.length; i++) if (heat[i]) heat[i] = Math.floor(heat[i]! * k);
  }

  // Population of civilized units, for the top bar.
  population(): number {
    let n = 0;
    for (let k = 0; k < RACE_COUNT; k++) n += this.speciesCount[k]!;
    return n;
  }

}
