// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// The Command tab (PLAN section 13) and Possess controls (section 14).
import type { SimClient } from "../sim/client";
import type { ArmyView, TownView } from "../sim/protocol";
import type { Stance } from "../war/armies";
import type { PossessInput } from "../war/possess";
import { el, toast, txt } from "./dom";
import { fmt, t, type PlayKey } from "./i18n";
import type { SimView } from "./simview";

export type CmdTool = "select" | "move" | "attack" | "defend" | "recruit" | "possess" | "war" | "peace" | "ally";

export class Command {
  tool: CmdTool = "select";
  army = 0;
  kingdom = 0;
  possessed = 0;
  private keys = new Set<string>();
  private sent = "";
  private lastSend = 0;
  private pulse: Partial<PossessInput> = {};
  stick = { x: 0, y: 0 }; // touch joystick, minus 1 to 1

  constructor(private sim: SimClient, private viewOf: () => SimView) {}

  private get view(): SimView {
    return this.viewOf();
  }

  selectedArmy(): ArmyView | undefined {
    return this.view.frame?.armies.find((a) => a.id === this.army);
  }

  private townAt(x: number, y: number): TownView | undefined {
    let best: TownView | undefined;
    let d = 4;
    for (const tw of this.view.towns) {
      const td = Math.hypot(tw.x - x, tw.y - y);
      if (td < d) {
        d = td;
        best = tw;
      }
    }
    return best;
  }

  private armyAt(x: number, y: number): ArmyView | undefined {
    let best: ArmyView | undefined;
    let d = 3;
    for (const a of this.view.frame?.armies ?? []) {
      const ad = Math.min(Math.hypot(a.x - x, a.y - y), Math.hypot(a.x - x, a.y - 1.2 - y));
      if (ad < d) {
        d = ad;
        best = a;
      }
    }
    return best;
  }

  // A click on the map with a Command tool. Returns a town id to show, if any.
  click(x: number, y: number): { town?: number; possess?: number } {
    const army = this.selectedArmy();
    const town = this.townAt(x, y);
    const needArmy = () => toast(t("cmd_pick_army"));
    switch (this.tool) {
      case "select": {
        const a = this.armyAt(x, y);
        if (a) {
          this.army = a.id;
          this.kingdom = a.kingdom;
          return {};
        }
        if (town) {
          this.army = 0;
          this.kingdom = town.kingdom;
          return { town: town.id };
        }
        return {};
      }
      case "move":
      case "defend":
        if (!army) return needArmy(), {};
        this.sim.command({ c: "army", id: army.id, order: this.tool, x, y });
        return {};
      case "attack":
        if (!army) return needArmy(), {};
        this.sim.command({ c: "army", id: army.id, order: "attack", x: town?.x ?? x, y: (town?.y ?? y) + 1, town: town?.id });
        return {};
      case "recruit":
        if (town) this.sim.command({ c: "recruit", town: town.id });
        return {};
      case "possess": {
        const uid = this.view.nearest(x, y, 1.5);
        if (!uid) return {};
        this.possessed = uid;
        this.sim.command({ c: "possess", uid });
        return { possess: uid };
      }
      default: {
        if (!this.kingdom) return toast(t("cmd_pick_kingdom")), {};
        if (!town || town.kingdom === this.kingdom) return {};
        const c = this.tool === "war" ? "war" : this.tool === "peace" ? "peace" : "ally";
        this.sim.command({ c, a: this.kingdom, b: town.kingdom });
        return {};
      }
    }
  }

  order(order: "hold" | "retreat") {
    const army = this.selectedArmy();
    if (!army) return toast(t("cmd_pick_army"));
    this.sim.command({ c: "army", id: army.id, order, x: army.x, y: army.y });
  }

  stance(stance: Stance) {
    const army = this.selectedArmy();
    if (!army) return toast(t("cmd_pick_army"));
    this.sim.command({ c: "army", id: army.id, order: "stance", x: army.x, y: army.y, stance });
  }

  // Possess input

  release() {
    this.possessed = 0;
    this.keys.clear();
    this.sim.command({ c: "release" });
  }

  // Keyboard while possessing. Returns true when the key was used.
  key(e: KeyboardEvent, down: boolean): boolean {
    if (!this.possessed) return false;
    const k = e.key.toLowerCase();
    if (k === "escape" && down) {
      this.release();
      return true;
    }
    const moves = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "];
    if (moves.includes(k)) {
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      return true;
    }
    if (!down) return ["j", "t", "e"].includes(k);
    if (k === "j") this.tap("attack");
    else if (k === "t") this.tap("talk");
    else if (k === "e") this.tap("interact");
    else return false;
    return true;
  }

  tap(what: "attack" | "talk" | "interact" | "jump") {
    this.pulse[what] = true;
  }

  // Called every frame; sends input when it changes, and keeps it fresh.
  pump(now: number) {
    if (!this.possessed) return;
    const has = (...k: string[]) => k.some((x) => this.keys.has(x));
    const input: PossessInput = {
      dx: (has("d", "arrowright") ? 1 : 0) - (has("a", "arrowleft") ? 1 : 0) + this.stick.x,
      dy: (has("s", "arrowdown") ? 1 : 0) - (has("w", "arrowup") ? 1 : 0) + this.stick.y,
      jump: has(" ") || !!this.pulse.jump,
      attack: !!this.pulse.attack,
      talk: !!this.pulse.talk,
      interact: !!this.pulse.interact,
    };
    const key = JSON.stringify(input);
    if (key === this.sent && now - this.lastSend < 500) return;
    this.sent = key;
    this.lastSend = now;
    this.pulse = {};
    this.sim.command({ c: "input", input });
  }
}

export function armyCard(a: ArmyView): HTMLElement[] {
  const rows: [PlayKey, string][] = [
    ["in_general", a.general || "?"],
    ["in_soldiers", fmt(a.size)],
    ["in_morale", t("pct", { n: a.morale })],
    ["in_order", t(("order_" + a.state) as PlayKey)],
    ["in_stance", t(("stance_" + a.stance) as PlayKey)],
  ];
  if (a.target) rows.push(["in_target", a.target]);
  const dl = el("dl");
  for (const [k, v] of rows) dl.append(el("dt", {}, txt(k)), el("dd", { textContent: v }));
  return [el("h3", { textContent: t("army_of", { name: a.name }) }), dl];
}
