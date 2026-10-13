// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { VERSION } from "./core/version";
import { App } from "./ui/app";

function boot() {
  void new App().start();
  console.log("⚡ [Pocket Pantheon] Engine initialized v" + VERSION);
}

boot();
