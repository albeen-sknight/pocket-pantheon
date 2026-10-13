// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Grid A* with a node budget. Scratch arrays are shared and reset by a
// generation stamp, so a search allocates only its result.
import sim from "../../data/sim.json";

export type CostFn = (i: number) => number; // movement cost into a tile, Infinity if blocked

const DIRS = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
const DIAG = Math.SQRT2;

export class Pathfinder {
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private gen = 0;
  private heapKey: Float32Array;
  private heapItem: Int32Array;

  constructor(private w: number, private h: number) {
    const n = w * h;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.heapKey = new Float32Array(sim.path.maxNodes * 8 + 16);
    this.heapItem = new Int32Array(sim.path.maxNodes * 8 + 16);
  }

  // Tile indices from start (excluded) to goal (included), or null.
  find(start: number, goal: number, cost: CostFn, maxNodes = sim.path.maxNodes): Int32Array | null {
    if (start === goal) return new Int32Array(0);
    if (cost(goal) === Infinity) return null;
    const { w, h, g, from, stamp, heapKey, heapItem } = this;
    const gen = ++this.gen;
    const gx = goal % w;
    const gy = (goal / w) | 0;
    const heur = (i: number) => {
      const dx = Math.abs((i % w) - gx);
      const dy = Math.abs(((i / w) | 0) - gy);
      return dx + dy + (DIAG - 2) * Math.min(dx, dy);
    };

    let size = 0;
    const push = (item: number, key: number) => {
      if (size >= heapKey.length) return;
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p]! <= key) break;
        heapKey[i] = heapKey[p]!;
        heapItem[i] = heapItem[p]!;
        i = p;
      }
      heapKey[i] = key;
      heapItem[i] = item;
    };
    const pop = () => {
      const top = heapItem[0]!;
      const key = heapKey[--size]!;
      const item = heapItem[size]!;
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && heapKey[c + 1]! < heapKey[c]!) c++;
        if (heapKey[c]! >= key) break;
        heapKey[i] = heapKey[c]!;
        heapItem[i] = heapItem[c]!;
        i = c;
      }
      heapKey[i] = key;
      heapItem[i] = item;
      return top;
    };

    stamp[start] = gen;
    g[start] = 0;
    from[start] = -1;
    push(start, heur(start));
    let expanded = 0;

    while (size > 0 && expanded++ < maxNodes) {
      const cur = pop();
      if (cur === goal) return this.trace(goal);
      const cx = cur % w;
      const cy = (cur / w) | 0;
      const base = g[cur]!;
      for (let d = 0; d < 16; d += 2) {
        const nx = cx + DIRS[d]!;
        const ny = cy + DIRS[d + 1]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const c = cost(ni);
        if (c === Infinity) continue;
        const diag = d >= 8;
        // no cutting corners past blocked tiles
        if (diag && (cost(cy * w + nx) === Infinity || cost(ny * w + cx) === Infinity)) continue;
        const ng = base + c * (diag ? DIAG : 1);
        if (stamp[ni] === gen && ng >= g[ni]!) continue;
        stamp[ni] = gen;
        g[ni] = ng;
        from[ni] = cur;
        push(ni, ng + heur(ni));
      }
    }
    return null;
  }

  private trace(goal: number): Int32Array {
    let n = 0;
    for (let i = goal; this.from[i] !== -1; i = this.from[i]!) n++;
    const out = new Int32Array(n);
    let k = n;
    for (let i = goal; this.from[i] !== -1; i = this.from[i]!) out[--k] = i;
    return out;
  }
}
