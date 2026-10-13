// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { SimHost } from "./host";
import type { ToWorker } from "./protocol";

const host = new SimHost((msg, transfer) => self.postMessage(msg, { transfer: transfer ?? [] }));
self.onmessage = (e: MessageEvent<ToWorker>) => host.handle(e.data);
