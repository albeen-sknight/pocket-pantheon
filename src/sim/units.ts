// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Hot unit data lives in typed arrays indexed by slot (PLAN section 5).
// Names and paths are plain objects because they're read rarely.
import { WEIGHTS } from "./brain";
import { GENES } from "./genes";

export const NEEDS = 6;
export const NEED = { hunger: 0, rest: 1, safety: 2, social: 3, faith: 4, purpose: 5 } as const;

export const ACT = {
  idle: 0, wander: 1, eat: 2, sleep: 3, work: 4, build: 5, social: 6, flee: 7, fight: 8, settle: 9, pray: 10, explore: 11, hunt: 12, march: 13,
} as const;
export type Act = (typeof ACT)[keyof typeof ACT];

export const JOB = { none: 0, gatherer: 1, farmer: 2, woodcutter: 3, builder: 4, miner: 5, smith: 6, priest: 7, scholar: 8, soldier: 9 } as const;

export const DEATH = { age: 0, battle: 1, disease: 2, hunger: 3, fire: 4, drowning: 5, monster: 6, disaster: 7, god: 8 } as const;

// Fields that a save stores as raw arrays, in this order.
export const UNIT_ARRAYS = [
  "alive", "kind", "sex", "x", "y", "age", "hp", "needs", "act", "actT", "tx", "ty", "town", "home", "job",
  "carry", "spouse", "mother", "father", "uid", "starve", "target", "kills", "born", "genes", "brain", "mood", "facing",
  "religion", "subspecies", "weapon", "armor", "gearQ", "blessed", "fertile", "army",
] as const;

export class Units {
  count = 0; // highest slot in use + 1
  nextUid = 1;
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly sex: Uint8Array; // 0 female, 1 male
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly age: Float32Array; // years
  readonly hp: Float32Array;
  readonly needs: Float32Array; // NEEDS per unit, 0 met to 1 desperate
  readonly act: Uint8Array;
  readonly actT: Int32Array; // ticks left in the current action
  readonly tx: Float32Array; // action target
  readonly ty: Float32Array;
  readonly town: Int32Array; // town id, -1 none
  readonly home: Int32Array; // building id, -1 none
  readonly job: Uint8Array;
  readonly carry: Uint8Array; // 0 nothing, 1 food, 2 wood
  readonly spouse: Int32Array; // uid, 0 none
  readonly mother: Int32Array;
  readonly father: Int32Array;
  readonly uid: Int32Array;
  readonly starve: Float32Array;
  readonly target: Int32Array; // uid of a unit being chased, fought or fled
  readonly kills: Uint16Array;
  readonly born: Int32Array; // tick
  readonly genes: Uint8Array;
  readonly brain: Float32Array;
  readonly mood: Uint8Array;
  readonly facing: Uint8Array; // 0 right, 1 left
  readonly religion: Uint16Array; // religion id, 0 none
  readonly subspecies: Uint16Array; // 0 for the base race
  readonly weapon: Uint8Array; // gear tier + 1, 0 bare handed
  readonly armor: Uint8Array;
  readonly gearQ: Uint8Array; // quality of the weapon, 0 poor to 4 legendary
  readonly blessed: Float32Array; // years of blessing left
  readonly fertile: Float32Array; // years of the fertility power left
  readonly army: Uint16Array; // army id, 0 for none
  names: string[] = [];
  paths: (Int32Array | null)[] = [];
  pathAt: Int32Array;
  private free: number[] = [];
  readonly slotOf = new Map<number, number>();

  constructor(readonly capacity: number) {
    const c = capacity;
    this.alive = new Uint8Array(c);
    this.kind = new Uint8Array(c);
    this.sex = new Uint8Array(c);
    this.x = new Float32Array(c);
    this.y = new Float32Array(c);
    this.age = new Float32Array(c);
    this.hp = new Float32Array(c);
    this.needs = new Float32Array(c * NEEDS);
    this.act = new Uint8Array(c);
    this.actT = new Int32Array(c);
    this.tx = new Float32Array(c);
    this.ty = new Float32Array(c);
    this.town = new Int32Array(c).fill(-1);
    this.home = new Int32Array(c).fill(-1);
    this.job = new Uint8Array(c);
    this.carry = new Uint8Array(c);
    this.spouse = new Int32Array(c);
    this.mother = new Int32Array(c);
    this.father = new Int32Array(c);
    this.uid = new Int32Array(c);
    this.starve = new Float32Array(c);
    this.target = new Int32Array(c);
    this.kills = new Uint16Array(c);
    this.born = new Int32Array(c);
    this.genes = new Uint8Array(c * GENES);
    this.brain = new Float32Array(c * WEIGHTS);
    this.mood = new Uint8Array(c);
    this.facing = new Uint8Array(c);
    this.religion = new Uint16Array(c);
    this.subspecies = new Uint16Array(c);
    this.weapon = new Uint8Array(c);
    this.armor = new Uint8Array(c);
    this.gearQ = new Uint8Array(c);
    this.blessed = new Float32Array(c);
    this.fertile = new Float32Array(c);
    this.army = new Uint16Array(c);
    this.pathAt = new Int32Array(c);
  }

  get full(): boolean {
    return this.free.length === 0 && this.count >= this.capacity;
  }

  // Returns the new slot, or -1 when the world is at its unit cap.
  add(kind: number, x: number, y: number, tick: number): number {
    const slot = this.free.length ? this.free.pop()! : this.count < this.capacity ? this.count++ : -1;
    if (slot < 0) return -1;
    this.alive[slot] = 1;
    this.kind[slot] = kind;
    this.x[slot] = x;
    this.y[slot] = y;
    this.tx[slot] = x;
    this.ty[slot] = y;
    this.age[slot] = 0;
    this.act[slot] = ACT.idle;
    this.actT[slot] = 0;
    this.town[slot] = -1;
    this.home[slot] = -1;
    this.job[slot] = 0;
    this.carry[slot] = 0;
    this.spouse[slot] = 0;
    this.mother[slot] = 0;
    this.father[slot] = 0;
    this.starve[slot] = 0;
    this.target[slot] = 0;
    this.kills[slot] = 0;
    this.mood[slot] = 0;
    this.religion[slot] = 0;
    this.subspecies[slot] = 0;
    this.weapon[slot] = 0;
    this.armor[slot] = 0;
    this.gearQ[slot] = 0;
    this.blessed[slot] = 0;
    this.fertile[slot] = 0;
    this.army[slot] = 0;
    this.born[slot] = tick;
    this.needs.fill(0, slot * NEEDS, slot * NEEDS + NEEDS);
    const uid = this.nextUid++;
    this.uid[slot] = uid;
    this.slotOf.set(uid, slot);
    this.names[slot] = "";
    this.paths[slot] = null;
    this.pathAt[slot] = 0;
    return slot;
  }

  remove(slot: number) {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.slotOf.delete(this.uid[slot]!);
    this.paths[slot] = null;
    this.free.push(slot);
  }

  // Slot for a uid, or -1 if that unit is gone.
  find(uid: number): number {
    if (!uid) return -1;
    return this.slotOf.get(uid) ?? -1;
  }

  need(slot: number, n: number): number {
    return this.needs[slot * NEEDS + n]!;
  }

  setNeed(slot: number, n: number, v: number) {
    this.needs[slot * NEEDS + n] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  genesOf(slot: number): Uint8Array {
    return this.genes.subarray(slot * GENES, slot * GENES + GENES);
  }

  brainOf(slot: number): Float32Array {
    return this.brain.subarray(slot * WEIGHTS, slot * WEIGHTS + WEIGHTS);
  }

  // Rebuilds the free list and uid map after loading arrays from a save.
  reindex() {
    this.free = [];
    this.slotOf.clear();
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.alive[i]) this.slotOf.set(this.uid[i]!, i);
      else this.free.push(i);
    }
  }
}
