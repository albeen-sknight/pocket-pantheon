// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Lakes and rivers. A priority flood from the sea fills every basin (lakes)
// and leaves a drainage tree; summing rain down that tree gives river flow.
import { LAKE, RIVER } from "./types";

class MinHeap {
  private keys: Float32Array;
  private items: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  push(item: number, key: number) {
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.keys[i] = this.keys[parent]!;
      this.items[i] = this.items[parent]!;
      i = parent;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }

  pop(): number {
    const top = this.items[0]!;
    const key = this.keys[--this.size]!;
    const item = this.items[this.size]!;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1]! < this.keys[child]!) child++;
      if (this.keys[child]! >= key) break;
      this.keys[i] = this.keys[child]!;
      this.items[i] = this.items[child]!;
      i = child;
    }
    this.keys[i] = key;
    this.items[i] = item;
    return top;
  }
}

const EPSILON = 1e-5;
const MIN_LAKE_DEPTH = 0.012;

export function waterways(
  height: Float32Array,
  moisture: Float32Array,
  flags: Uint8Array,
  w: number,
  h: number,
  seaLevel: number,
  riverFlow: number,
) {
  const n = w * h;
  const filled = new Float32Array(height);
  const receiver = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const seen = new Uint8Array(n);
  const heap = new MinHeap(n);

  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (height[i]! < seaLevel || edge) {
      seen[i] = 1;
      heap.push(i, height[i]!);
    }
  }

  let popped = 0;
  while (heap.size > 0) {
    const i = heap.pop();
    order[popped++] = i;
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      filled[j] = Math.max(height[j]!, filled[i]! + EPSILON);
      receiver[j] = i;
      heap.push(j, filled[j]!);
    }
  }

  for (let i = 0; i < n; i++) {
    if (height[i]! >= seaLevel && filled[i]! - height[i]! > MIN_LAKE_DEPTH) flags[i]! |= LAKE;
  }

  // Walk the drainage tree from the highest tiles down, passing rain along.
  const flow = new Float32Array(n);
  for (let k = popped - 1; k >= 0; k--) {
    const i = order[k]!;
    if (height[i]! < seaLevel) continue;
    flow[i] = flow[i]! + 0.3 + moisture[i]!;
    const r = receiver[i]!;
    if (r >= 0) flow[r] = flow[r]! + flow[i]!;
    if (flow[i]! > riverFlow && !(flags[i]! & LAKE)) flags[i]! |= RIVER;
  }
}
