// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { generateWorld, type Progress } from "./generate";
import type { World, WorldOptions } from "./types";

declare const PP_GEN_WORKER: string;

type Reply = { type: "progress"; stage: string; fraction: number } | { type: "done"; world: World };

// Generates in a worker when it can, on the main thread when it can't
// (file:// pages, old browsers).
export function generateAsync(options: WorldOptions, progress: Progress): Promise<World> {
  let worker: Worker;
  try {
    worker = new Worker(new URL(PP_GEN_WORKER, location.href));
  } catch {
    return Promise.resolve(generateWorld(options, progress));
  }
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<Reply>) => {
      if (e.data.type === "progress") return progress(e.data.stage, e.data.fraction);
      worker.terminate();
      resolve(e.data.world);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      resolve(generateWorld(options, progress));
    };
    worker.postMessage(options);
  });
}
