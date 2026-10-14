// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Canvas2D charts for the stats panel (PLAN section 17): lines over time,
// stacked columns, age pyramids and timelines, with a hover readout, direct
// labels and an image export. Text uses ink colours, never series colours.
import { el } from "./dom";
import { fmt } from "./i18n";

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

export interface TimelineRow {
  name: string;
  from: number;
  to: number | null; // still running
  color: string;
  parent?: number; // row index it branched from
  dim?: boolean;
}

export type ChartSpec =
  | { kind: "lines"; title: string; x: number[]; xName: (v: number) => string; series: ChartSeries[] }
  | { kind: "stacked"; title: string; x: string[]; series: ChartSeries[] }
  | { kind: "pyramid"; title: string; bands: string[]; left: ChartSeries; right: ChartSeries }
  | { kind: "timeline"; title: string; now: number; rows: TimelineRow[]; tip: (i: number) => string[]; selected?: number };

const INK = "#f0ebdc";
const MUT = "#a9aac6";
const GRID = "#363b6e";
const SURFACE = "#1d2044";
const FONT = "13px Outfit, system-ui, sans-serif";
const TITLE_FONT = "700 15px 'Pixelify Sans', monospace";
const ROW = 22;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Chart {
  readonly root: HTMLDivElement;
  readonly canvas = el("canvas");
  private tip = el("div", { className: "tip", hidden: true });
  private spec: ChartSpec | null = null;
  private plot: Box = { x: 0, y: 0, w: 0, h: 0 };
  private hover = -1;
  private width = 0;
  private height = 0;
  onPick: (index: number) => void = () => {};

  constructor() {
    this.root = el("div", { className: "chart" }, this.canvas, this.tip);
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerleave", () => this.setHover(-1));
    this.canvas.addEventListener("click", (e) => {
      this.move(e);
      if (this.hover >= 0 && this.spec?.kind === "timeline") this.onPick(this.hover);
    });
  }

  show(spec: ChartSpec) {
    this.spec = spec;
    if (spec.kind === "timeline" ? this.hover >= spec.rows.length : spec.kind !== "pyramid" && this.hover >= this.count()) this.hover = -1;
    this.draw();
  }

  png(): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }

  private count(): number {
    const s = this.spec;
    if (!s) return 0;
    if (s.kind === "lines" || s.kind === "stacked") return s.x.length;
    if (s.kind === "pyramid") return s.bands.length;
    return s.rows.length;
  }

  draw() {
    const s = this.spec;
    if (!s) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(280, this.root.clientWidth || 600);
    const h = s.kind === "timeline" ? 44 + Math.max(3, s.rows.length) * ROW + 28 : w < 520 ? 260 : 320;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    const c = this.canvas.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = SURFACE;
    c.fillRect(0, 0, w, h);
    c.fillStyle = INK;
    c.font = TITLE_FONT;
    c.textBaseline = "top";
    c.fillText(s.title, 8, 8);
    c.font = FONT;
    if (s.kind === "lines") this.drawLines(c, s);
    else if (s.kind === "stacked") this.drawStacked(c, s);
    else if (s.kind === "pyramid") this.drawPyramid(c, s);
    else this.drawTimeline(c, s);
    this.renderTip();
  }

  // Y axis with a few round ticks and recessive grid lines.
  private axis(c: CanvasRenderingContext2D, max: number): (v: number) => number {
    const top = niceMax(max);
    const p = this.plot;
    const y = (v: number) => p.y + p.h - (v / top) * p.h;
    c.strokeStyle = GRID;
    c.lineWidth = 1;
    c.fillStyle = MUT;
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (let k = 0; k <= 4; k++) {
      const v = (top / 4) * k;
      const yy = Math.round(y(v)) + 0.5;
      c.beginPath();
      c.moveTo(p.x, yy);
      c.lineTo(p.x + p.w, yy);
      c.stroke();
      c.fillText(short(v), p.x - 6, yy);
    }
    c.textAlign = "left";
    return y;
  }

  private drawLines(c: CanvasRenderingContext2D, s: Extract<ChartSpec, { kind: "lines" }>) {
    const labels = this.width >= 480;
    this.plot = { x: 48, y: 36, w: this.width - 48 - (labels ? 96 : 12), h: this.height - 36 - 28 };
    const p = this.plot;
    const n = s.x.length;
    const max = Math.max(1, ...s.series.flatMap((v) => v.values));
    const y = this.axis(c, max);
    const x = (i: number) => p.x + (n <= 1 ? p.w / 2 : (i / (n - 1)) * p.w);
    // year labels along the bottom
    c.fillStyle = MUT;
    c.textBaseline = "top";
    // as many year labels as fit, about 90 px apart
    const marks = Math.max(1, Math.min(n, Math.floor(p.w / 90) + 1, 6));
    for (let k = 0; k < marks; k++) {
      const i = n <= 1 ? 0 : Math.round(((n - 1) / Math.max(1, marks - 1)) * k);
      c.textAlign = k === 0 ? "left" : k === marks - 1 ? "right" : "center";
      c.fillText(s.xName(s.x[i]!), x(i), p.y + p.h + 8);
    }
    c.textAlign = "left";
    c.lineWidth = 2;
    c.lineJoin = "round";
    for (const line of s.series) {
      c.strokeStyle = line.color;
      c.beginPath();
      line.values.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
      c.stroke();
    }
    // direct labels at the line ends, nudged apart so they never overlap
    if (labels && n) {
      const ends = s.series.map((l) => ({ l, y: y(l.values[n - 1] ?? 0) })).sort((a, b) => a.y - b.y);
      for (let k = 1; k < ends.length; k++) ends[k]!.y = Math.max(ends[k]!.y, ends[k - 1]!.y + 15);
      c.textBaseline = "middle";
      for (const e of ends) {
        c.fillStyle = e.l.color;
        c.fillRect(p.x + p.w + 6, e.y - 4, 8, 8);
        c.fillStyle = INK;
        c.fillText(clip(e.l.name, 11), p.x + p.w + 18, e.y);
      }
    }
    if (this.hover >= 0 && this.hover < n) {
      const hx = Math.round(x(this.hover)) + 0.5;
      c.strokeStyle = MUT;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(hx, p.y);
      c.lineTo(hx, p.y + p.h);
      c.stroke();
      for (const line of s.series) dot(c, hx, y(line.values[this.hover] ?? 0), line.color);
    }
  }

  private drawStacked(c: CanvasRenderingContext2D, s: Extract<ChartSpec, { kind: "stacked" }>) {
    this.plot = { x: 48, y: 36, w: this.width - 48 - 12, h: this.height - 36 - 28 };
    const p = this.plot;
    const n = s.x.length;
    const totals = s.x.map((_, i) => s.series.reduce((a, l) => a + (l.values[i] ?? 0), 0));
    const y = this.axis(c, Math.max(1, ...totals));
    const slot = p.w / Math.max(1, n);
    const bw = Math.max(2, Math.min(28, slot - 2));
    c.fillStyle = MUT;
    c.textBaseline = "top";
    c.textAlign = "center";
    const every = Math.ceil(n / Math.max(1, Math.floor(p.w / 56)));
    s.x.forEach((label, i) => i % every === 0 && c.fillText(label, p.x + slot * (i + 0.5), p.y + p.h + 8));
    c.textAlign = "left";
    for (let i = 0; i < n; i++) {
      const left = p.x + slot * (i + 0.5) - bw / 2;
      let base = 0;
      const top = s.series.reduce((k, l, j) => ((l.values[i] ?? 0) > 0 ? j : k), -1);
      s.series.forEach((l, j) => {
        const v = l.values[i] ?? 0;
        if (v <= 0) return;
        const y0 = y(base);
        const y1 = y(base + v);
        base += v;
        // a 2 px surface gap between segments; the top segment gets round corners
        const hgt = Math.max(1, y0 - y1 - (j === top ? 0 : 2));
        c.fillStyle = l.color;
        c.beginPath();
        if (j === top && c.roundRect) c.roundRect(left, y1, bw, hgt, [Math.min(4, bw / 2), Math.min(4, bw / 2), 0, 0]);
        else c.rect(left, y1, bw, hgt);
        c.fill();
      });
      if (i === this.hover) {
        c.strokeStyle = INK;
        c.lineWidth = 1;
        c.strokeRect(left - 2.5, y(totals[i]!) - 2.5, bw + 5, y(0) - y(totals[i]!) + 5);
      }
    }
  }

  private drawPyramid(c: CanvasRenderingContext2D, s: Extract<ChartSpec, { kind: "pyramid" }>) {
    this.plot = { x: 12, y: 56, w: this.width - 24, h: this.height - 56 - 12 };
    const p = this.plot;
    const n = s.bands.length;
    const mid = p.x + p.w / 2;
    const gutter = 34; // band labels sit in the middle
    const half = p.w / 2 - gutter;
    const max = Math.max(1, ...s.left.values, ...s.right.values);
    const rowH = p.h / n;
    c.textBaseline = "top";
    c.fillStyle = INK;
    c.textAlign = "right";
    c.fillText(s.left.name, mid - gutter, 36);
    c.textAlign = "left";
    c.fillText(s.right.name, mid + gutter, 36);
    c.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const yy = p.y + p.h - (i + 1) * rowH; // youngest at the bottom
      const bh = Math.max(2, rowH - 2);
      const lw = (s.left.values[i]! / max) * half;
      const rw = (s.right.values[i]! / max) * half;
      c.fillStyle = s.left.color;
      c.beginPath();
      if (c.roundRect) c.roundRect(mid - gutter - lw, yy, lw, bh, [4, 0, 0, 4]);
      else c.rect(mid - gutter - lw, yy, lw, bh);
      c.fill();
      c.fillStyle = s.right.color;
      c.beginPath();
      if (c.roundRect) c.roundRect(mid + gutter, yy, rw, bh, [0, 4, 4, 0]);
      else c.rect(mid + gutter, yy, rw, bh);
      c.fill();
      c.fillStyle = i === this.hover ? INK : MUT;
      c.textAlign = "center";
      c.fillText(s.bands[i]!, mid, yy + bh / 2);
      if (i === this.hover) {
        c.strokeStyle = INK;
        c.strokeRect(p.x + 0.5, yy - 0.5, p.w - 1, bh + 1);
      }
    }
    c.textAlign = "left";
  }

  private drawTimeline(c: CanvasRenderingContext2D, s: Extract<ChartSpec, { kind: "timeline" }>) {
    // names sit in their own column on the left, bars to the right
    const names = Math.min(170, Math.round(this.width * 0.32));
    this.plot = { x: 12 + names, y: 40, w: this.width - 24 - names, h: s.rows.length * ROW };
    const p = this.plot;
    const from = Math.min(s.now, ...s.rows.map((r) => r.from));
    const span = Math.max(10, s.now - from);
    const x = (v: number) => p.x + ((v - from) / span) * p.w;
    // decade ticks
    c.strokeStyle = GRID;
    c.fillStyle = MUT;
    c.textBaseline = "top";
    const step = niceStep(span / 5);
    for (let v = Math.ceil(from / step) * step; v <= s.now; v += step) {
      const xx = Math.round(x(v)) + 0.5;
      c.beginPath();
      c.moveTo(xx, p.y - 4);
      c.lineTo(xx, p.y + p.h);
      c.stroke();
      c.textAlign = "center";
      c.fillText(String(v), xx, p.y + p.h + 6);
    }
    c.textAlign = "left";
    c.textBaseline = "middle";
    s.rows.forEach((r, i) => {
      const yy = p.y + i * ROW;
      const x0 = x(r.from);
      const x1 = Math.max(x0 + 4, x(r.to ?? s.now));
      if (r.parent !== undefined && r.parent >= 0) {
        // branch line from the parent's row at the year this one began
        c.strokeStyle = MUT;
        c.beginPath();
        c.moveTo(Math.round(x0) + 0.5, p.y + r.parent * ROW + ROW / 2);
        c.lineTo(Math.round(x0) + 0.5, yy + ROW / 2);
        c.stroke();
      }
      c.globalAlpha = r.dim ? 0.55 : 1;
      c.fillStyle = r.color;
      c.beginPath();
      if (c.roundRect) c.roundRect(x0, yy + 5, x1 - x0, ROW - 10, r.to === null ? [4, 0, 0, 4] : 4);
      else c.rect(x0, yy + 5, x1 - x0, ROW - 10);
      c.fill();
      c.globalAlpha = 1;
      if (i === this.hover || i === s.selected) {
        c.strokeStyle = INK;
        c.lineWidth = i === s.selected ? 2 : 1;
        c.strokeRect(x0 - 2, yy + 3, x1 - x0 + 4, ROW - 6);
        c.lineWidth = 1;
      }
      c.fillStyle = i === this.hover || i === s.selected ? INK : MUT;
      c.textAlign = "right";
      c.fillText(fit(c, r.name, names - 10), p.x - 8, yy + ROW / 2);
      c.textAlign = "left";
    });
  }

  private move(e: PointerEvent | MouseEvent) {
    const s = this.spec;
    if (!s) return;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const p = this.plot;
    let i = -1;
    if (s.kind === "lines") {
      const n = s.x.length;
      if (mx >= p.x - 8 && mx <= p.x + p.w + 8 && n) i = n <= 1 ? 0 : Math.round(((mx - p.x) / p.w) * (n - 1));
    } else if (s.kind === "stacked") {
      if (mx >= p.x && mx <= p.x + p.w) i = Math.floor(((mx - p.x) / p.w) * s.x.length);
    } else if (s.kind === "pyramid") {
      if (my >= p.y && my <= p.y + p.h) i = s.bands.length - 1 - Math.floor(((my - p.y) / p.h) * s.bands.length);
    } else if (my >= p.y && my < p.y + p.h) i = Math.floor((my - p.y) / ROW);
    this.setHover(Math.max(-1, Math.min(this.count() - 1, i)), mx, my);
  }

  private tipAt = { x: 0, y: 0 };

  private setHover(i: number, mx = 0, my = 0) {
    this.tipAt = { x: mx, y: my };
    if (i === this.hover && i < 0) return;
    this.hover = i;
    this.draw();
  }

  // The readout: a title line, then a swatch, name and value per series.
  private renderTip() {
    const s = this.spec;
    const i = this.hover;
    if (!s || i < 0) {
      this.tip.hidden = true;
      return;
    }
    const rows: [string, string, string][] = [];
    let head = "";
    if (s.kind === "lines") {
      head = s.xName(s.x[i]!);
      s.series.forEach((l) => rows.push([l.color, l.name, fmt(l.values[i] ?? 0)]));
    } else if (s.kind === "stacked") {
      head = s.x[i]!;
      s.series.forEach((l) => rows.push([l.color, l.name, fmt(l.values[i] ?? 0)]));
    } else if (s.kind === "pyramid") {
      head = s.bands[i]!;
      rows.push([s.left.color, s.left.name, fmt(s.left.values[i]!)], [s.right.color, s.right.name, fmt(s.right.values[i]!)]);
    } else {
      const lines = s.tip(i);
      head = lines[0] ?? "";
      lines.slice(1).forEach((l) => rows.push(["", l, ""]));
    }
    this.tip.replaceChildren(
      el("b", { textContent: head }),
      ...rows.map(([color, name, value]) =>
        el("div", {}, color ? el("i", { style: `background:${color}` }) : "", el("span", { textContent: name }), value ? el("em", { textContent: value }) : ""),
      ),
    );
    this.tip.hidden = false;
    const left = this.tipAt.x + 14;
    const flip = left + 200 > this.width;
    this.tip.style.left = (flip ? Math.max(4, this.tipAt.x - 214) : left) + "px";
    this.tip.style.top = Math.max(4, Math.min(this.height - 40, this.tipAt.y + 10)) + "px";
  }
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, color: string) {
  c.beginPath();
  c.arc(x, y, 4, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = SURFACE;
  c.stroke();
}

// Four round steps that reach at least v.
export function niceMax(v: number): number {
  return niceStep(v / 4) * 4;
}

export function niceStep(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function short(v: number): string {
  return v >= 10000 ? fmt(Math.round(v / 1000)) + "k" : fmt(Math.round(v));
}

// Shortens a label until it fits the given width.
function fit(c: CanvasRenderingContext2D, s: string, width: number): string {
  if (c.measureText(s).width <= width) return s;
  let out = s;
  while (out.length > 1 && c.measureText(out + "…").width > width) out = out.slice(0, -1);
  return out + "…";
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
