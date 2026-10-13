// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Bucket grid for "who is near me" queries, rebuilt every tick with no
// allocations: a counting sort of unit slots by cell.
const CELL = 8;

export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  private start: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;

  constructor(worldW: number, worldH: number, capacity: number) {
    this.cols = Math.ceil(worldW / CELL);
    this.rows = Math.ceil(worldH / CELL);
    this.start = new Int32Array(this.cols * this.rows + 1);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  rebuild(alive: Uint8Array, x: Float32Array, y: Float32Array, count: number) {
    const { cols, rows, start, items, cellOf } = this;
    start.fill(0);
    for (let i = 0; i < count; i++) {
      if (!alive[i]) {
        cellOf[i] = -1;
        continue;
      }
      const cx = Math.min(cols - 1, Math.max(0, (x[i]! / CELL) | 0));
      const cy = Math.min(rows - 1, Math.max(0, (y[i]! / CELL) | 0));
      const c = cy * cols + cx;
      cellOf[i] = c;
      start[c + 1]!++;
    }
    for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!;
    const fill = start.slice(0, cols * rows);
    for (let i = 0; i < count; i++) {
      const c = cellOf[i]!;
      if (c >= 0) items[fill[c]!++] = i;
    }
  }

  // Calls fn for every unit slot in the cells overlapping the circle.
  // Return true from fn to stop early.
  query(px: number, py: number, r: number, fn: (slot: number) => boolean | void) {
    const { cols, rows, start, items } = this;
    const x0 = Math.max(0, ((px - r) / CELL) | 0);
    const x1 = Math.min(cols - 1, ((px + r) / CELL) | 0);
    const y0 = Math.max(0, ((py - r) / CELL) | 0);
    const y1 = Math.min(rows - 1, ((py + r) / CELL) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * cols + cx;
        for (let k = start[c]!; k < start[c + 1]!; k++) if (fn(items[k]!)) return;
      }
    }
  }
}
