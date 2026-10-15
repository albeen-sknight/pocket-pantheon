// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Main thread side of the simulation. Talks to the worker, or runs the sim
// right here when a worker can't start.
import type { World } from "../world/types";
import { SimHost } from "./host";
import type { Frame, FromWorker, ToWorker } from "./protocol";
import type { Command } from "./sim";
import type { SimSnapshot } from "./snapshot";
import type { StatsReport } from "../stats/history";
import type { RaceKey } from "./species";

declare const PP_SIM_WORKER: string;

export class SimClient {
  private worker: Worker | null = null;
  private local: SimHost | null = null;
  private waiting = new Map<number, (answer: never) => void>();
  private nextId = 1;
  onFrame: (f: Frame) => void = () => {};
  // Sees every command the player sends, before the worker does.
  onCommand: (cmd: Command) => void = () => {};

  constructor() {
    try {
      this.worker = new Worker(new URL(PP_SIM_WORKER, location.href));
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.fallBack();
      };
    } catch {
      this.fallBack();
    }
  }

  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    this.local = new SimHost((msg) => this.receive(msg));
  }

  private receive(msg: FromWorker) {
    if (msg.type === "frame") return this.onFrame(msg);
    this.waiting.get(msg.id)?.((msg.type === "saved" ? msg.snapshot : msg.report) as never);
    this.waiting.delete(msg.id);
  }

  private send(msg: ToWorker) {
    if (this.worker) this.worker.postMessage(msg);
    else this.local?.handle(msg);
  }

  // The worker gets its own copy of the tiles; the main thread keeps one to draw.
  init(world: World, races: RaceKey[], snapshot?: SimSnapshot) {
    const copy: World = {
      ...world,
      height: world.height.slice(),
      biome: world.biome.slice(),
      flags: world.flags.slice(),
      ore: world.ore.slice(),
      fertility: world.fertility.slice(),
      temperature: world.temperature.slice(),
      moisture: world.moisture.slice(),
    };
    this.send({ type: "init", world: copy, seed: world.options.seed, races, snapshot });
  }

  command(cmd: Command) {
    this.onCommand(cmd);
    this.send({ type: "cmd", cmd });
  }

  setSpeed(speed: number) {
    this.send({ type: "speed", speed });
  }

  select(uid: number) {
    this.send({ type: "select", uid });
  }

  selectTown(id: number) {
    this.send({ type: "selectTown", id });
  }

  snapshot(): Promise<SimSnapshot> {
    return this.ask<SimSnapshot>("save");
  }

  stats(): Promise<StatsReport> {
    return this.ask<StatsReport>("stats");
  }

  private ask<T>(type: "save" | "stats"): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve as (answer: never) => void);
      this.send({ type, id });
    });
  }
}
