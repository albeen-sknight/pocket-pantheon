// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Runs a Sim on a timer and answers messages. Used inside the worker, and on
// the main thread when workers aren't available.
import config from "../../data/sim.json";
import { packFrame, type FromWorker, type ToWorker } from "./protocol";
import { Sim } from "./sim";
import { fromSnapshot, toSnapshot } from "./snapshot";

const STEP_MS = 1000 / config.ticksPerSecond;
// Never fall further behind than this many ticks, so a slow device slows the
// world down instead of locking up.
const MAX_CATCH_UP = 16;

export class SimHost {
  private sim: Sim | null = null;
  private speed = 1;
  private selected = 0;
  private selectedTown = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private debt = 0;

  constructor(private post: (msg: FromWorker, transfer?: Transferable[]) => void) {}

  handle(msg: ToWorker) {
    switch (msg.type) {
      case "init": {
        this.sim = msg.snapshot ? fromSnapshot(msg.world, msg.world.options.seed, msg.snapshot) : new Sim(msg.world, msg.seed);
        if (!msg.snapshot) this.sim.populate(msg.races);
        this.start();
        this.send();
        return;
      }
      case "cmd": {
        this.sim?.apply(msg.cmd);
        this.send();
        return;
      }
      case "speed":
        this.speed = msg.speed;
        return;
      case "select":
        this.selected = msg.uid;
        this.send();
        return;
      case "selectTown":
        this.selectedTown = msg.id;
        this.send();
        return;
      case "save":
        if (this.sim) this.post({ type: "saved", id: msg.id, snapshot: toSnapshot(this.sim) });
        return;
    }
  }

  private start() {
    if (this.timer) clearInterval(this.timer);
    this.last = performance.now();
    this.timer = setInterval(() => this.loop(), STEP_MS);
  }

  private loop() {
    const now = performance.now();
    this.debt += ((now - this.last) / STEP_MS) * this.speed;
    this.last = now;
    if (!this.sim || this.speed === 0) {
      this.debt = 0;
      return;
    }
    let ticks = Math.min(MAX_CATCH_UP, Math.floor(this.debt));
    this.debt = Math.min(this.debt - ticks, MAX_CATCH_UP);
    if (ticks <= 0) return;
    while (ticks-- > 0) this.sim.step();
    this.send();
  }

  private send() {
    if (!this.sim) return;
    const frame = packFrame(this.sim, this.selected, this.selectedTown);
    const transfer = [frame.units.buffer as ArrayBuffer, frame.tiles.buffer as ArrayBuffer, frame.hazards.buffer as ArrayBuffer];
    if (frame.owner) transfer.push(frame.owner.buffer as ArrayBuffer);
    this.post(frame, transfer);
  }
}
