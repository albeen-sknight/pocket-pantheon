// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// World generation worker: builds the world off the main thread and hands the
// tile buffers back without copying.
import { generateWorld } from "./generate";
import { FIELDS, type WorldOptions } from "./types";

self.onmessage = (e: MessageEvent<WorldOptions>) => {
  const world = generateWorld(e.data, (stage, fraction) => self.postMessage({ type: "progress", stage, fraction }));
  const buffers = FIELDS.map((f) => world[f].buffer as ArrayBuffer);
  self.postMessage({ type: "done", world }, { transfer: buffers });
};
