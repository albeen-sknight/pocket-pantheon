// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { VERSION } from "./core/version";
import { bindLangSwitch } from "./ui/i18n";

function boot() {
  bindLangSwitch("play");
  console.log("⚡ [Pocket Pantheon] Engine initialized v" + VERSION);
}

boot();
