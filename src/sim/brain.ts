// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The small brain (PLAN section 9): 12 inputs, 6 hidden neurons, 8 outputs,
// 134 weights per unit. It nudges the utility scores, and its weights are
// inherited with crossover and mutation, so populations drift over time.
import sim from "../../data/sim.json";
import type { Rng } from "../core/rng";

export const INPUTS = 12;
export const HIDDEN = 6;
export const OUTPUTS = 8;
export const WEIGHTS = INPUTS * HIDDEN + HIDDEN + HIDDEN * OUTPUTS + OUTPUTS; // 134

// Output groups, in order
export const GROUP = { survive: 0, work: 1, build: 2, social: 3, worship: 4, explore: 5, fight: 6, flee: 7 } as const;

export function randomBrain(rng: Rng, out: Float32Array) {
  for (let i = 0; i < WEIGHTS; i++) out[i] = (rng.next() * 2 - 1) * 0.5;
}

export function inheritBrain(a: Float32Array, b: Float32Array, rng: Rng, out: Float32Array) {
  const noise = sim.genes.brainNoise;
  for (let i = 0; i < WEIGHTS; i++) {
    let w = rng.chance(0.5) ? a[i]! : b[i]!;
    if (rng.chance(0.1)) w += (rng.next() * 2 - 1) * noise;
    out[i] = w < -2 ? -2 : w > 2 ? 2 : w;
  }
}

// Runs the network for one unit. `w` is that unit's slice of the weight pool.
export function think(w: Float32Array, input: Float32Array, hidden: Float32Array, out: Float32Array) {
  let k = 0;
  for (let h = 0; h < HIDDEN; h++) {
    let sum = 0;
    for (let i = 0; i < INPUTS; i++) sum += input[i]! * w[k++]!;
    hidden[h] = sum;
  }
  for (let h = 0; h < HIDDEN; h++) hidden[h] = Math.tanh(hidden[h]! + w[k++]!);
  for (let o = 0; o < OUTPUTS; o++) {
    let sum = 0;
    for (let h = 0; h < HIDDEN; h++) sum += hidden[h]! * w[k++]!;
    out[o] = sum;
  }
  for (let o = 0; o < OUTPUTS; o++) out[o] = Math.tanh(out[o]! + w[k++]!);
}
