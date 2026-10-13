// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Camera in device pixels. Zoom glides between stops and always settles on a
// whole number scale so pixels stay square and sharp (PLAN section 6.2).
import config from "../../data/world.json";

export const ZOOM_STOPS = config.zoomStops;

export type ZoomLevel = "continent" | "region" | "town" | "close";

export class Camera {
  x = 0; // world tile at the top left of the screen
  y = 0;
  scale = 4; // device pixels per tile
  target = 4;
  private anchor = { sx: 0, sy: 0 };
  viewW = 1;
  viewH = 1;
  private fitted = true; // still showing the whole world, so a resize refits
  worldW = 1;
  worldH = 1;

  setView(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    if (this.fitted) this.fit();
    else this.clamp();
  }

  setWorld(w: number, h: number) {
    this.worldW = w;
    this.worldH = h;
    this.fit();
  }

  // Largest stop that shows the whole world, then centre it.
  fit() {
    const fits = ZOOM_STOPS.filter((s) => s * this.worldW <= this.viewW && s * this.worldH <= this.viewH);
    this.scale = this.target = fits.at(-1) ?? ZOOM_STOPS[0]!;
    this.centerOn(this.worldW / 2, this.worldH / 2);
    this.snap();
    this.fitted = true;
  }

  centerOn(tx: number, ty: number) {
    this.x = tx - this.viewW / this.scale / 2;
    this.y = ty - this.viewH / this.scale / 2;
    this.clamp();
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + sx / this.scale, this.y + sy / this.scale];
  }

  pan(dx: number, dy: number) {
    this.fitted = false;
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clamp();
  }

  // Steps to the next stop in or out, keeping the point under the cursor still.
  zoomStep(dir: 1 | -1, sx: number, sy: number) {
    const i = ZOOM_STOPS.indexOf(this.target);
    const next = ZOOM_STOPS[Math.max(0, Math.min(ZOOM_STOPS.length - 1, i + dir))]!;
    this.zoomTo(next, sx, sy);
  }

  zoomTo(target: number, sx: number, sy: number) {
    this.fitted = false;
    this.target = target;
    this.anchor = { sx, sy };
  }

  // Pinch zoom moves freely; release() snaps it to the nearest stop.
  zoomBy(factor: number, sx: number, sy: number) {
    const min = ZOOM_STOPS[0]!;
    const max = ZOOM_STOPS.at(-1)!;
    this.setScale(Math.max(min, Math.min(max, this.scale * factor)), sx, sy);
    this.target = this.scale;
    this.fitted = false;
  }

  release(sx: number, sy: number) {
    const nearest = ZOOM_STOPS.reduce((a, b) => (Math.abs(Math.log(b / this.scale)) < Math.abs(Math.log(a / this.scale)) ? b : a));
    this.zoomTo(nearest, sx, sy);
  }

  // Called once per frame. Returns true while still moving.
  update(dt: number): boolean {
    if (this.scale === this.target) return false;
    const k = 1 - Math.exp(-dt * 14);
    let next = Math.exp(Math.log(this.scale) + (Math.log(this.target) - Math.log(this.scale)) * k);
    if (Math.abs(next - this.target) < 0.02 * this.target) next = this.target;
    this.setScale(next, this.anchor.sx, this.anchor.sy);
    if (this.scale === this.target) this.snap();
    return true;
  }

  get level(): ZoomLevel {
    if (this.scale < 8) return "continent";
    if (this.scale < 32) return "region";
    if (this.scale < 64) return "town";
    return "close";
  }

  // Art pixels per tile for the terrain shader at this zoom.
  get art(): number {
    if (this.scale < 8) return 1;
    if (this.scale < 32) return 4;
    return 32;
  }

  private setScale(scale: number, sx: number, sy: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = scale;
    this.x = wx - sx / scale;
    this.y = wy - sy / scale;
    this.clamp();
  }

  // Lines the view up on whole device pixels.
  private snap() {
    this.x = Math.round(this.x * this.scale) / this.scale;
    this.y = Math.round(this.y * this.scale) / this.scale;
  }

  private clamp() {
    const vw = this.viewW / this.scale;
    const vh = this.viewH / this.scale;
    const margin = 0.25;
    this.x = vw >= this.worldW ? (this.worldW - vw) / 2 : Math.max(-vw * margin, Math.min(this.worldW - vw * (1 - margin), this.x));
    this.y = vh >= this.worldH ? (this.worldH - vh) / 2 : Math.max(-vh * margin, Math.min(this.worldH - vh * (1 - margin), this.y));
  }
}
