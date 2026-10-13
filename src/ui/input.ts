// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Mouse, touch and pen on the map. Right or middle drag and two fingers pan,
// the wheel and pinch zoom, and a left press or one finger uses the tool.
import type { Camera } from "../render/camera";

export interface MapHandlers {
  isPanTool(): boolean;
  press(tx: number, ty: number): void; // tool starts
  hold(tx: number, ty: number): void; // pointer moved while pressed
  release(): void;
  hover(sx: number, sy: number): void;
  moved(): void; // camera changed
}

export function bindMapInput(canvas: HTMLCanvasElement, cam: Camera, h: MapHandlers) {
  const dpr = () => window.devicePixelRatio || 1;
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: "none" | "tool" | "pan" | "pinch" = "none";
  let pinchDist = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr(), y: (e.clientY - r.top) * dpr() };
  };

  const centre = () => {
    const ps = [...pointers.values()];
    return { x: (ps[0]!.x + ps[1]!.x) / 2, y: (ps[0]!.y + ps[1]!.y) / 2 };
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 2) {
      if (mode === "tool") h.release();
      mode = "pinch";
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1 || e.button === 2 || h.isPanTool()) {
      mode = "pan";
      canvas.classList.add("pan");
      return;
    }
    mode = "tool";
    const [tx, ty] = cam.toWorld(p.x, p.y);
    h.press(tx, ty);
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    h.hover(p.x, p.y);
    if (!prev) return;
    pointers.set(e.pointerId, p);

    if (mode === "pan") {
      cam.pan(p.x - prev.x, p.y - prev.y);
      h.moved();
    } else if (mode === "pinch" && pointers.size === 2) {
      const before = centre();
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      cam.pan((p.x - prev.x) / 2, (p.y - prev.y) / 2);
      if (pinchDist > 0) cam.zoomBy(dist / pinchDist, before.x, before.y);
      pinchDist = dist;
      h.moved();
    } else if (mode === "tool") {
      const [tx, ty] = cam.toWorld(p.x, p.y);
      h.hold(tx, ty);
    }
  });

  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const wasPinch = mode === "pinch";
    const at = pointers.size === 2 ? centre() : local(e);
    pointers.delete(e.pointerId);
    if (mode === "tool") h.release();
    if (wasPinch) cam.release(at.x, at.y);
    if (pointers.size === 0 || wasPinch) {
      mode = pointers.size === 0 ? "none" : "pan";
      canvas.classList.remove("pan");
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => h.hover(-1, -1));
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      cam.zoomStep(e.deltaY < 0 ? 1 : -1, p.x, p.y);
      h.moved();
    },
    { passive: false },
  );
}
