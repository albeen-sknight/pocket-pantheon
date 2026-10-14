// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import civConfig from "../../data/civ.json";
import config from "../../data/world.json";
import simConfig from "../../data/sim.json";
import disConfig from "../../data/disasters.json";
import { WRATH, type FrequencyKey, type WrathPower } from "../chaos/disasters";
import { GRACE, type GracePower } from "../civ/grace";
import type { DirectorMode } from "../director/director";
import { paletteIndex } from "../render/palette";
import { figure, FX_ICON, raceFigure } from "../render/art";
import { buildSprites, type SpriteSet } from "../render/atlas";
import { Camera } from "../render/camera";
import { createCanvasRenderer, paintTiles } from "../render/canvas2d";
import type { Renderer } from "../render/renderer";
import { Scene } from "../render/scene";
import { mk, TAB_ICONS, TOOL_ICONS } from "../render/sprites";
import { createWebGLRenderer } from "../render/webgl";
import { makeMeta } from "../save/format";
import { exportFile, importFile, listSlots, loadSlot, saveSlot, type Loaded, type SlotId } from "../save/store";
import { SimClient } from "../sim/client";
import { TOPICS, type Frame } from "../sim/protocol";
import type { Fx } from "../sim/sim";
import type { SimSnapshot } from "../sim/snapshot";
import { RACES, SPECIES, SPECIES_INFO, TRAITS, type RaceKey } from "../sim/species";
import { BIOMES } from "../world/biomes";
import { generateAsync } from "../world/client";
import { applyStroke, strokeTarget, type Rect, type ShapeTool, type Stroke } from "../world/edit";
import { defaultOptions, type Layout, type SizeKey, type World, type WorldOptions } from "../world/types";
import { $, el, randomSeed, SAVE_SLOTS, toast, txt } from "./dom";
import { bindLangSwitch, fmt, onLangChange, t, toggleLang, type PlayKey } from "./i18n";
import { bindMapInput } from "./input";
import { StatsPanel } from "./stats";
import { armyCard, Command, type CmdTool } from "./command";
import { chronicleText, kindName, tileCard, townCard, traitName, unitCard } from "./inspector";
import { SimView } from "./simview";

type Tab = "shape" | "life" | "cmd" | "wrath" | "grace" | "gene" | "world" | "insp";
type Tool = ShapeTool | "pan" | "inspect" | "spawn" | "pick" | "grace" | "cmd" | "wrath";

// Which phase brings each tab to life (PLAN section 21).
const TABS: { key: Tab; phase: number }[] = [
  { key: "shape", phase: 1 }, { key: "life", phase: 2 }, { key: "cmd", phase: 4 }, { key: "wrath", phase: 5 },
  { key: "grace", phase: 3 }, { key: "gene", phase: 2 }, { key: "world", phase: 1 }, { key: "insp", phase: 1 },
];
const READY_PHASE = 5;
// Chronicle entries big enough to pop up as a toast.
const TOASTS = new Set([
  "kingdom", "rebellion", "independence", "fallen", "age", "faith", "sect", "alliance", "rivals", "subspecies", "legend", "revive", "sickness",
  "war", "war_truce", "war_peace", "war_won", "conquered", "razed", "friction",
  "nuke", "plague", "natural", "dragon", "abducted", "returned",
]);
const SHAKE = new Set(["earthquake", "boom", "stomp"]);
const FLASH = new Set(["lightning", "mushroom"]);
const WRATH_ICONS: Record<WrathPower, string> = {
  lightning: "bolt", fire: "flame", tornado: "tornado", earthquake: "dust", meteor: "meteor", acid: "acid", plague: "germ",
  zombie: "germ", volcano: "puff", flood: "drop", blizzard: "snow", drought: "dust", nuke: "ring",
};
const CMD_TOOLS: CmdTool[] = ["select", "move", "attack", "defend", "recruit", "possess", "war", "peace", "ally"];
const CMD_ICONS: Record<CmdTool, string> = {
  select: "fit", move: "pan", attack: "volcano", defend: "saves", recruit: "new", possess: "raise", war: "range", peace: "island", ally: "paint",
};
const CONTINUOUS: Tool[] = ["raise", "lower", "flatten", "smooth", "paint"];
const BRUSH = config.brush;
const RES = config.pixelRatio;
const SPEEDS = simConfig.speeds;

export class App {
  private canvas = $<HTMLCanvasElement>("#world");
  private cam = new Camera();
  private renderer!: Renderer;
  private sprites!: SpriteSet;
  private scene!: Scene;
  private sim = new SimClient();
  private view = new SimView();
  private world: World | null = null;
  private tab: Tab = "life";
  private tool: Tool = "spawn";
  private brush = BRUSH.default;
  private paintBiome = BIOMES.findIndex((b) => b.key === "grassland");
  private spawnKind = 0;
  private gracePower: GracePower = "bless";
  private wrathPower: WrathPower = "lightning";
  private frequency: FrequencyKey = "normal";
  private hazards: Uint8Array = new Uint8Array(0);
  private owner: Uint16Array = new Uint16Array(0);
  private ownerHaz: Uint16Array = new Uint16Array(0);
  private ownerDirty = false;
  private ownerSent = 0;
  private shakeUntil = 0;
  private selectedTown = 0;
  private fx: { fx: Fx; at: number }[] = [];
  private kingdomCount = 0;
  private directorMode: DirectorMode = "normal";
  private lifeReturns = true;
  private cmd = new Command(this.sim, () => this.view);
  private bubbleUntil = 0;
  private trait = 0;
  private stroke: Stroke | null = null;
  private strokeSeed = 1;
  private dirty: Rect | null = null;
  private miniDirty = true;
  private inspected: [number, number] | null = null;
  private selected = 0;
  private following = false;
  private speed = 1;
  private frames: number[] = [];
  private stats = new StatsPanel({
    ask: () => this.sim.stats(),
    exportName: () => `pocket-pantheon-${this.world?.options.seed ?? 0}`,
    meta: () => (this.world ? makeMeta(this.world, t("st_title"), this.view.frame?.year ?? 0) : null),
    openKingdom: (capital) => this.visitTown(capital),
  });
  // Canvas pixels per CSS pixel. Starts at the device ratio (capped) and steps
  // down while frames are slow, so weak phones draw fewer pixels instead.
  private res = Math.min(RES.max, window.devicePixelRatio || 1);
  private resCheck = performance.now() + RES.checkMs * 2;
  private genMs = 0;
  private mini = $<HTMLCanvasElement>("#mini canvas");
  private miniImg: ImageData | null = null;
  private brushRing = el("div");
  private lastHover = { x: -1, y: -1 };

  // On screen controls for possessing on a phone, and buttons for everyone.
  private bindPossessPad() {
    const pad = $("#possess");
    const buttons: [string, PlayKey, () => void][] = [
      ["jump", "poss_jump", () => this.cmd.tap("jump")],
      ["attack", "poss_attack", () => this.cmd.tap("attack")],
      ["talk", "poss_talk", () => this.cmd.tap("talk")],
      ["use", "poss_use", () => this.cmd.tap("interact")],
      ["release", "poss_release", () => this.endPossess()],
    ];
    const row = $(".pad-buttons", pad);
    for (const [, key, fn] of buttons) row.append(el("button", { type: "button", className: "btn ghost", onclick: fn }, txt(key)));
    const stick = $(".stick", pad);
    const knob = $(".knob", pad);
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2)));
      const y = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2)));
      this.cmd.stick = { x, y };
      knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
    };
    const stop = () => {
      this.cmd.stick = { x: 0, y: 0 };
      knob.style.transform = "";
    };
    stick.addEventListener("pointerdown", (e) => {
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener("pointermove", (e) => e.buttons && move(e));
    stick.addEventListener("pointerup", stop);
    stick.addEventListener("pointercancel", stop);
  }

  async start() {
    this.renderer = createWebGLRenderer(this.canvas) ?? this.fallback();
    this.sprites = buildSprites(this.renderer.kind === "webgl2");
    this.scene = new Scene(this.sprites);
    this.sim.onFrame = (f) => this.onFrame(f);
    bindLangSwitch("play");
    onLangChange(() => {
      this.refreshText();
      this.stats.relabel();
    });
    this.buildTabs();
    this.buildSpeed();
    this.selectTab("life");
    this.bindInput();
    this.bindDialogs();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.startAutosave();
    this.pauseWhenHidden();
    requestAnimationFrame((now) => this.frame(now, now));

    const params = new URLSearchParams(location.search);
    const fromUrl = params.has("seed");
    const resumed = fromUrl ? null : await loadSlot("auto").catch(() => null);
    if (resumed) {
      this.load(resumed);
      toast(t("resumed"));
    } else {
      await this.generate(this.optionsFromUrl(params), this.racesFromUrl(params));
    }
    window.__pp = this.debug();
  }

  private fallback(): Renderer {
    // A WebGL attempt leaves the canvas locked to that context, so swap it.
    const fresh = el("canvas", { id: "world" });
    fresh.setAttribute("role", "img");
    fresh.dataset.ia = "world_a";
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    setTimeout(() => toast(t("fallback")), 500);
    return createCanvasRenderer(fresh)!;
  }

  private optionsFromUrl(p: URLSearchParams): WorldOptions {
    const o = defaultOptions(Number(p.get("seed")) || randomSeed());
    const size = p.get("size");
    if (size && size in config.sizes) o.size = size as SizeKey;
    const layout = p.get("layout");
    if (layout && config.layouts.includes(layout)) o.layout = layout as Layout;
    return o;
  }

  private racesFromUrl(p: URLSearchParams): RaceKey[] {
    const races = p.get("races");
    if (races === null) return [...RACES];
    return races.split(",").filter((r): r is RaceKey => (RACES as string[]).includes(r));
  }

  // World lifecycle

  async generate(options: WorldOptions, races: RaceKey[] = [...RACES]) {
    const box = $("#loading");
    const bar = $(".barfill", box);
    const stage = $(".stage", box);
    box.hidden = false;
    const started = performance.now();
    const world = await generateAsync(options, (s, f) => {
      bar.style.width = Math.round(f * 100) + "%";
      stage.textContent = t(("stage_" + s) as PlayKey);
    });
    box.hidden = true;
    this.genMs = performance.now() - started;
    this.setWorld(world);
    this.sim.init(world, races);
  }

  private load(loaded: Loaded) {
    this.setWorld(loaded.world);
    this.sim.init(loaded.world, [], loaded.sim);
  }

  private setWorld(world: World) {
    this.world = world;
    this.hazards = new Uint8Array(world.w * world.h);
    this.owner = new Uint16Array(world.w * world.h);
    this.ownerDirty = true;
    this.view = new SimView();
    this.select(0);
    this.renderer.setWorld(world);
    this.cam.setWorld(world.w, world.h);
    this.mini.width = world.w;
    this.mini.height = world.h;
    this.miniImg = this.mini.getContext("2d")!.createImageData(world.w, world.h);
    paintTiles(world, this.miniImg, { x0: 0, y0: 0, x1: world.w, y1: world.h });
    this.miniDirty = true;
    this.inspected = null;
    this.refreshText();
  }

  private onFrame(f: Frame) {
    const rect = this.view.receive(f, this.world);
    if (rect) this.markDirty(rect);
    if (f.owner) {
      this.owner = f.owner;
      this.ownerDirty = true;
    }
    for (let k = 0; k < f.hazards.length; k += 2) this.hazards[f.hazards[k]!] = f.hazards[k + 1]!;
    if (f.hazards.length) this.ownerDirty = true;
    if (f.kingdoms) {
      this.kingdomCount = f.kingdoms.length;
      const colors = new Uint8Array(256);
      for (const k of f.kingdoms) colors[k.id % 256] = paletteIndex(civConfig.kingdomColors[k.color]!);
      this.renderer.setKingdomColors(colors);
    }
    const now = performance.now() / 1000;
    for (const fx of f.fx) this.fx.push({ fx, at: now });
    this.feel(f.fx);
    this.fx = this.fx.filter((e) => now - e.at < 2);
    for (const e of f.events) {
      if (e.t === "chronicle" && TOASTS.has(e.entry.kind)) toast(chronicleText(e.entry));
    }
    if (f.selected === null && this.selected) this.select(0);
    if (f.town !== undefined) this.view.town = f.town;
    if (this.cmd.possessed && f.possessed !== this.cmd.possessed && f.possessed === 0 && performance.now() - this.possessedAt > 1000) {
      toast(t("poss_lost"));
      this.endPossess();
    }
    if (f.fx.some((x) => x.kind === "talk")) this.bubbleUntil = performance.now() + 2500;
    // Giants have their own moves, so they get their own hint.
    const driving = this.cmd.possessed && this.view.selected?.uid === this.cmd.possessed ? this.view.selected : null;
    if (driving) $("#possess p").textContent = t(SPECIES_INFO[driving.kind]!.giant ? "poss_giant" : "poss_hint");
    this.updateTopBar();
    if (this.tab === "insp" || this.tab === "gene" || this.tab === "cmd") this.renderInspector();
  }

  private possessedAt = 0;

  // Territory and hazards share one texture: kingdom id below, hazard on top.
  // Uploads at most a dozen times a second.
  private uploadTerritory(now: number) {
    if (!this.ownerDirty || !this.world || now - this.ownerSent < 80) return;
    const n = this.world.w * this.world.h;
    if (this.ownerHaz.length !== n) this.ownerHaz = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.ownerHaz[i] = ((this.owner[i] ?? 0) & 4095) | ((this.hazards[i] ?? 0) << 12);
    this.renderer.setOwner(this.ownerHaz, this.world.w, this.world.h);
    this.ownerDirty = false;
    this.ownerSent = now;
  }

  // Big hits shake the screen and flash; both respect reduced motion.
  private feel(fx: Fx[]) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (fx.some((f) => SHAKE.has(f.kind))) this.shakeUntil = performance.now() + 450;
    if (fx.some((f) => FLASH.has(f.kind))) {
      const flash = $("#flash");
      flash.classList.remove("on");
      void flash.offsetWidth;
      flash.classList.add("on");
    }
  }

  private shake(now: number) {
    const left = this.shakeUntil - now;
    this.canvas.style.transform = left > 0 ? `translate(${(Math.random() - 0.5) * left * 0.04}px, ${(Math.random() - 0.5) * left * 0.04}px)` : "";
  }

  private startPossess(uid: number) {
    this.possessedAt = performance.now();
    this.select(uid);
    this.following = true;
    this.cam.zoomTo(64, this.cam.viewW / 2, this.cam.viewH / 2);
    $("#possess").hidden = false;
  }

  private endPossess() {
    if (this.cmd.possessed) this.cmd.release();
    this.following = false;
    $("#possess").hidden = true;
  }

  // The possessed unit's words float over their head.
  private drawBubble() {
    const box = $("#bubble");
    const d = this.view.selected;
    const at = this.selected ? this.view.position(this.selected) : null;
    if (!d?.says || !at || performance.now() > this.bubbleUntil) {
      box.hidden = true;
      return;
    }
    const dpr = this.res;
    box.hidden = false;
    box.replaceChildren(el("b", { textContent: d.says }), el("small", { textContent: t(("say_" + TOPICS[d.topic]) as PlayKey) }));
    box.style.left = ((at[0] - this.cam.x) * this.cam.scale) / dpr + "px";
    box.style.top = ((at[1] - this.cam.y) * this.cam.scale) / dpr - 70 - Math.max(16, (32 * Math.floor(this.cam.scale / 32)) / dpr) + "px";
  }

  // Frame loop

  private frame(now: number, last: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    this.frames.push(now);
    while (this.frames.length && this.frames[0]! < now - 1000) this.frames.shift();
    this.adaptResolution(now);

    if (this.following && this.selected) {
      const at = this.view.position(this.selected);
      if (at) this.cam.centerOn(at[0], at[1]);
    }
    if (this.cam.update(dt) || this.following) this.cameraMoved();
    if (this.stroke && CONTINUOUS.includes(this.stroke.tool)) this.paintStroke(this.stroke);
    this.cmd.pump(now);
    this.drawBubble();
    this.uploadTerritory(now);
    this.shake(now);
    if (this.world && this.dirty) {
      this.renderer.update(this.world, this.dirty);
      if (this.miniImg) paintTiles(this.world, this.miniImg, this.dirty);
      this.dirty = null;
      this.miniDirty = true;
    }
    if (this.world) {
      const year = this.view.frame ? (this.view.frame.tick % simConfig.ticksPerYear) / simConfig.ticksPerYear : 0;
      this.renderer.draw(this.cam, now / 400, year);
      this.scene.build(this.cam, this.view.units(now), this.view.count, this.view.buildings, this.view.towns, this.selected, now / 1000, this.fx, this.view.frame?.armies ?? [], this.cmd.army, this.view.frame?.storms ?? []);
      this.renderer.drawSprites(this.scene, this.sprites.atlas, this.cam);
    }
    if (this.miniDirty) this.drawMinimap();
    requestAnimationFrame((next) => this.frame(next, now));
  }

  private adaptResolution(now: number) {
    if (now < this.resCheck || document.hidden) return;
    this.resCheck = now + RES.checkMs;
    if (!this.world || this.frames.length >= RES.slowFps || this.res <= RES.min) return;
    this.res = Math.max(RES.min, this.res * RES.step);
    this.resize();
  }

  private resize() {
    const dpr = this.res;
    const f = Math.round(innerWidth * dpr) / (this.canvas.width || 1);
    const mid = this.cam.toWorld(this.cam.viewW / 2, this.cam.viewH / 2);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.cam.setView(this.canvas.width, this.canvas.height);
    if (Math.abs(f - 1) > 0.01) this.cam.rescale(f, mid);
    // The top bar wraps on narrow screens, so side panels sit under its real height.
    const top = $("#top").getBoundingClientRect();
    document.documentElement.style.setProperty("--below-top", Math.ceil(top.bottom + 8) + "px");
    this.cameraMoved();
  }

  private cameraMoved() {
    this.miniDirty = true;
    this.updateZoomLabel();
    this.updateBrushRing();
  }

  private markDirty(rect: Rect) {
    this.dirty = this.dirty
      ? { x0: Math.min(this.dirty.x0, rect.x0), y0: Math.min(this.dirty.y0, rect.y0), x1: Math.max(this.dirty.x1, rect.x1), y1: Math.max(this.dirty.y1, rect.y1) }
      : rect;
  }

  // Tools

  private paintStroke(s: Stroke) {
    if (!this.world) return;
    // Applied here for instant feedback, and in the sim, which owns the world.
    const rect = applyStroke(this.world, s);
    this.sim.command({ c: "stroke", stroke: { ...s } });
    if (!rect) return;
    this.markDirty(rect);
    if (this.inspected) this.renderInspector();
  }

  private bindInput() {
    bindMapInput(this.canvas, this.cam, {
      isPanTool: () => this.tool === "pan",
      press: (tx, ty) => this.press(tx, ty),
      hold: (tx, ty) => {
        if (this.tool === "inspect") return this.inspect(tx, ty);
        if (this.stroke) {
          this.stroke.x = tx;
          this.stroke.y = ty;
        }
      },
      release: () => (this.stroke = null),
      hover: (sx, sy) => {
        this.lastHover = { x: sx, y: sy };
        this.updateBrushRing();
      },
      moved: () => {
        this.following = false;
        this.cameraMoved();
      },
    });
    // The controls hint steps aside once you've started playing.
    this.canvas.addEventListener("pointerdown", () => ($("#help").hidden = true), { once: true });
    this.brushRing.id = "brush";
    document.body.append(this.brushRing);
    this.mini.parentElement!.addEventListener("pointerdown", (e) => this.minimapJump(e));
    window.addEventListener("keydown", (e) => this.key(e));
    window.addEventListener("keyup", (e) => this.cmd.key(e, false));
    this.bindPossessPad();
  }

  private press(tx: number, ty: number) {
    if (!this.world) return;
    if (this.cmd.possessed) return this.cmd.tap("attack");
    switch (this.tool) {
      case "cmd": {
        const r = this.cmd.click(tx, ty);
        if (r.possess) this.startPossess(r.possess);
        if (r.town !== undefined) {
          this.select(0);
          this.selectTown(r.town);
        }
        return this.renderInspector();
      }
      case "inspect":
        return this.inspect(tx, ty);
      case "pick":
        return this.select(this.view.nearest(tx, ty, 1.5));
      case "pan":
        return;
      case "grace":
        this.sim.command({ c: "grace", power: this.gracePower, x: tx, y: ty, radius: this.brush });
        return;
      case "wrath":
        this.sim.command({ c: "wrath", power: this.wrathPower, x: tx, y: ty, radius: this.brush });
        return;
      case "spawn": {
        const civ = this.spawnKind < RACES.length;
        const count = civ ? Math.max(2, this.brush * 2) : this.brush;
        this.sim.command({ c: "spawn", kind: this.spawnKind, x: tx, y: ty, count });
        return;
      }
      default: {
        const s: Stroke = { tool: this.tool, x: tx, y: ty, radius: this.brush - 1, biome: this.paintBiome, seed: this.strokeSeed++ };
        if (this.tool === "flatten") s.target = strokeTarget(this.world, tx, ty);
        this.stroke = s;
        this.paintStroke(s); // first touch shows up right away, well under 100 ms
      }
    }
  }

  private updateBrushRing() {
    const at = this.lastHover;
    const brushy = (this.tab === "shape" && this.tool !== "pan") || (this.tab === "life" && this.tool === "spawn") || (this.tab === "grace" && this.tool === "grace") || (this.tab === "wrath" && this.tool === "wrath");
    if (!brushy || at.x < 0) {
      this.brushRing.style.display = "none";
      return;
    }
    const dpr = this.res;
    const size = ((this.brush - 0.5) * 2 * this.cam.scale) / dpr;
    Object.assign(this.brushRing.style, {
      display: "block",
      width: size + "px",
      height: size + "px",
      left: at.x / dpr - size / 2 + "px",
      top: at.y / dpr - size / 2 + "px",
    });
  }

  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input, select, dialog")) return;
    if (this.cmd.key(e, true)) {
      e.preventDefault();
      if (!this.cmd.possessed) this.endPossess();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 8) {
      const tab = TABS[n - 1]!;
      if (tab.phase <= READY_PHASE) this.selectTab(tab.key);
      return;
    }
    const cx = this.cam.viewW / 2;
    const cy = this.cam.viewH / 2;
    const step = 80 * this.res;
    const pan = (x: number, y: number) => () => {
      this.following = false;
      this.cam.pan(x, y);
    };
    const actions: Record<string, () => void> = {
      " ": () => this.setSpeed(this.speed ? 0 : 1),
      "[": () => this.setBrush(this.brush - 1),
      "]": () => this.setBrush(this.brush + 1),
      l: () => toggleLang("play"),
      h: () => void this.stats.open(),
      "+": () => this.cam.zoomStep(1, cx, cy),
      "=": () => this.cam.zoomStep(1, cx, cy),
      "-": () => this.cam.zoomStep(-1, cx, cy),
      Home: () => this.cam.fit(),
      ArrowLeft: pan(step, 0),
      ArrowRight: pan(-step, 0),
      ArrowUp: pan(0, step),
      ArrowDown: pan(0, -step),
      a: pan(step, 0),
      d: pan(-step, 0),
      w: pan(0, step),
      s: pan(0, -step),
    };
    const act = actions[e.key] ?? actions[e.key.toLowerCase()];
    if (!act) return;
    e.preventDefault();
    act();
    this.cameraMoved();
  }

  private setBrush(size: number) {
    this.brush = Math.max(BRUSH.min, Math.min(BRUSH.max, size));
    const slider = document.querySelector<HTMLInputElement>("#brush-size");
    if (slider) slider.value = String(this.brush);
    this.refreshText();
    this.updateBrushRing();
  }

  private setSpeed(speed: number) {
    this.speed = speed;
    this.sim.setSpeed(speed);
    document.querySelectorAll<HTMLButtonElement>("#speed button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed)));
  }

  private selectTown(id: number) {
    this.selectedTown = id;
    this.view.town = null;
    this.sim.selectTown(id);
  }

  private select(uid: number) {
    this.selected = uid;
    if (uid) this.selectTown(0);
    if (!uid) this.following = false;
    this.sim.select(uid);
    this.view.selected = null;
    this.renderInspector();
  }

  // Top bar, tabs and shelf

  private buildSpeed() {
    const box = el("div", { id: "speed", role: "group" });
    box.dataset.ia = "tip_speed";
    for (const s of SPEEDS) {
      const b = el("button", { type: "button", onclick: () => this.setSpeed(s) });
      b.dataset.speed = String(s);
      if (s === 0) b.append(txt("speed_pause"));
      else b.textContent = t("speed_n", { n: s });
      b.setAttribute("aria-pressed", String(s === this.speed));
      box.append(b);
    }
    $("#t-zoom").after(box);
  }

  private updateTopBar() {
    const f = this.view.frame;
    $("#t-year").textContent = t("year", { n: f?.year ?? 0 });
    $("#t-pop").textContent = t("pop", { n: f?.pop ?? 0 });
    $("#t-kin").textContent = t("kin", { n: this.kingdomCount });
  }

  private buildTabs() {
    const nav = $("#tabs");
    for (const tab of TABS) {
      const b = el("button", { type: "button" });
      b.setAttribute("role", "tab");
      b.dataset.tab = tab.key;
      b.append(mk(14, 14, TAB_ICONS[tab.key]!, 2), Object.assign(txt(("tab_" + tab.key) as PlayKey), { className: "lbl" }));
      if (tab.phase > READY_PHASE) {
        b.disabled = true;
        b.dataset.phase = String(tab.phase);
      } else {
        b.onclick = () => this.selectTab(tab.key);
      }
      nav.append(b);
    }
  }

  private selectTab(tab: Tab) {
    this.tab = tab;
    document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const defaults: Partial<Record<Tab, Tool>> = { shape: "raise", life: "spawn", gene: "pick", insp: "inspect", world: "pan", grace: "grace", cmd: "cmd", wrath: "wrath" };
    const keep = (tab === "shape" && !["inspect", "pan", "spawn", "pick", "grace", "cmd", "wrath"].includes(this.tool)) || this.tool === "pan";
    if (!keep || tab === "world") this.tool = defaults[tab] ?? "pan";
    this.buildShelf();
    this.renderInspector();
    this.refreshText();
  }

  private toolButton(icon: HTMLCanvasElement, label: HTMLElement, tip: PlayKey | null, onClick: () => void, pressed?: boolean) {
    const b = el("button", { type: "button", onclick: onClick });
    if (tip) {
      b.dataset.it = tip;
      b.title = t(tip);
    }
    b.append(icon, label);
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    return b;
  }

  private iconButton(key: string, label: PlayKey, tip: PlayKey, onClick: () => void, pressed?: boolean) {
    return this.toolButton(mk(12, 12, TOOL_ICONS[key]!, 2), txt(label), tip, onClick, pressed);
  }

  private buildShelf() {
    const shelf = $("#shelf");
    shelf.replaceChildren();
    const pick = (tool: Tool) => () => {
      this.tool = tool;
      this.buildShelf();
      this.updateBrushRing();
    };
    const sep = () => el("span", { className: "sep" });
    const panButton = () => this.iconButton("pan", "tool_pan", "tip_pan", pick("pan"), this.tool === "pan");

    switch (this.tab) {
      case "shape":
        shelf.append(panButton(), sep());
        for (const tool of ["raise", "lower", "flatten", "smooth", "paint"] as const) {
          shelf.append(this.iconButton(tool, `tool_${tool}`, `tip_${tool}`, pick(tool), this.tool === tool));
        }
        shelf.append(sep());
        for (const tool of ["island", "volcano", "range"] as const) {
          shelf.append(this.iconButton(tool, `tool_${tool}`, `tip_${tool}`, pick(tool), this.tool === tool));
        }
        shelf.append(sep(), this.brushControl());
        if (this.tool === "paint") shelf.append(this.biomePicker());
        return;
      case "life":
        shelf.append(panButton(), sep());
        SPECIES.forEach((key, kind) => {
          // Races are drawn fresh in their own colours; the atlas holds key colours.
          const src = kind < RACES.length ? mk(32, 30, figure(raceFigure(RACES[kind]!, 0, false), 0), 1) : this.sprites.atlas.canvas;
          const sprite = kind < RACES.length ? { x: 0, y: 0, w: src.width, h: src.height } : this.sprites.atlas.sprites[this.sprites.unit(kind, 0, 0, 0)]!;
          const icon = el("canvas", { width: 24, height: 24, className: "px" });
          const ctx = icon.getContext("2d")!;
          const k = Math.min(1, 24 / Math.max(sprite.w, sprite.h));
          ctx.imageSmoothingEnabled = false;
          const w = Math.round(sprite.w * k);
          const h = Math.round(sprite.h * k);
          ctx.drawImage(src, sprite.x, sprite.y, sprite.w, sprite.h, (24 - w) / 2, 24 - h, w, h);
          icon.setAttribute("aria-hidden", "true");
          const b = this.toolButton(icon, txt(("kind_" + key) as PlayKey), "tip_life", () => {
            this.spawnKind = kind;
            this.tool = "spawn";
            this.buildShelf();
          }, this.tool === "spawn" && this.spawnKind === kind);
          shelf.append(b);
        });
        shelf.append(sep(), this.brushControl());
        return;
      case "gene":
        shelf.append(panButton(), this.iconButton("fit", "tool_pick", "tip_pick", pick("pick"), this.tool === "pick"), sep());
        shelf.append(
          this.iconButton("new", "gene_mutate", "tip_mutate", () => this.gene({ c: "mutate", uid: this.selected })),
          this.traitPicker(),
          this.iconButton("raise", "gene_add", "gene_add", () => this.gene({ c: "trait", uid: this.selected, trait: this.trait, add: true })),
          this.iconButton("lower", "gene_remove", "gene_remove", () => this.gene({ c: "trait", uid: this.selected, trait: this.trait, add: false })),
          this.iconButton("saves", "gene_clone", "tip_clone", () => this.gene({ c: "clone", uid: this.selected })),
          this.iconButton("range", "gene_split", "tip_split", () => this.gene({ c: "split", uid: this.selected })),
        );
        return;
      case "wrath":
        shelf.append(panButton(), sep());
        for (const power of WRATH) {
          const icon = this.atlasIcon(`fx.${WRATH_ICONS[power]}`);
          shelf.append(this.toolButton(icon, txt(`wrath_${power}`), `tip_w_${power}`, () => {
            this.wrathPower = power;
            this.tool = "wrath";
            this.buildShelf();
          }, this.tool === "wrath" && this.wrathPower === power));
        }
        shelf.append(sep(), this.brushControl());
        return;
      case "grace":
        shelf.append(panButton(), sep());
        for (const power of GRACE) {
          const icon = mk(12, 12, graceIcon(power), 2);
          const b = this.toolButton(icon, txt(`grace_${power}`), `tip_${power}`, () => {
            this.gracePower = power;
            this.tool = "grace";
            this.buildShelf();
          }, this.tool === "grace" && this.gracePower === power);
          shelf.append(b);
        }
        shelf.append(sep(), this.brushControl());
        return;
      case "cmd": {
        shelf.append(panButton(), sep());
        for (const tool of CMD_TOOLS) {
          shelf.append(this.iconButton(CMD_ICONS[tool], `tool_${tool}`, tool === "peace" ? "tip_peace_k" : `tip_${tool}`, () => {
            this.cmd.tool = tool;
            this.tool = "cmd";
            this.buildShelf();
          }, this.tool === "cmd" && this.cmd.tool === tool));
          if (tool === "defend") {
            shelf.append(
              this.iconButton("flatten", "tool_hold", "tip_hold", () => this.cmd.order("hold")),
              this.iconButton("lower", "tool_retreat", "tip_retreat", () => this.cmd.order("retreat")),
              this.stancePicker(),
              sep(),
            );
          }
          if (tool === "possess") shelf.append(sep());
        }
        return;
      }
      case "insp":
        shelf.append(panButton(), this.iconButton("fit", "tool_pick", "in_hint", pick("inspect"), this.tool === "inspect"));
        return;
      case "world":
        shelf.append(
          this.iconButton("new", "w_new", "tip_new", () => this.openNewWorld()),
          this.iconButton("saves", "w_saves", "tip_saves", () => this.openSaves()),
          this.iconButton("stats", "st_open", "st_open_a", () => void this.stats.open()),
          this.iconButton("export", "w_export", "tip_export", () => this.exportWorld()),
          this.iconButton("import", "w_import", "tip_import", () => $<HTMLInputElement>("#import").click()),
          this.iconButton("fit", "w_fit", "tip_fit", () => {
            this.following = false;
            this.cam.fit();
            this.cameraMoved();
          }),
          el("span", { className: "sep" }),
          this.directorControl(),
          this.frequencyControl(),
        );
    }
  }

  private gene(cmd: Parameters<SimClient["command"]>[0]) {
    if (!this.selected) return toast(t("gene_none"));
    this.sim.command(cmd);
  }

  // A small canvas icon cut from the sprite atlas.
  private atlasIcon(name: string) {
    const sp = this.sprites.atlas.sprites[this.sprites.atlas.id(name)]!;
    const icon = el("canvas", { width: 24, height: 24, className: "px" });
    const ctx = icon.getContext("2d")!;
    const k = Math.min(2, 24 / Math.max(sp.w, sp.h));
    ctx.imageSmoothingEnabled = false;
    const w = Math.round(sp.w * k);
    const h = Math.round(sp.h * k);
    ctx.drawImage(this.sprites.atlas.canvas, sp.x, sp.y, sp.w, sp.h, (24 - w) / 2, (24 - h) / 2, w, h);
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  private frequencyControl() {
    const select = el("select", { id: "frequency" });
    for (const f of Object.keys(disConfig.frequency)) select.append(el("option", { value: f }, txt(("freq_" + f) as PlayKey)));
    select.value = this.frequency;
    select.onchange = () => {
      this.frequency = select.value as FrequencyKey;
      this.sim.command({ c: "frequency", value: this.frequency });
    };
    return el("label", { htmlFor: "frequency", title: t("tip_frequency") }, txt("w_frequency"), select);
  }

  private stancePicker() {
    const select = el("select", { id: "stance" });
    for (const s of ["aggressive", "defensive", "hold"] as const) select.append(el("option", { value: s }, txt(`stance_${s}`)));
    select.value = this.cmd.selectedArmy()?.stance ?? "aggressive";
    select.onchange = () => this.cmd.stance(select.value as "aggressive");
    return el("label", { htmlFor: "stance" }, txt("in_stance"), select);
  }

  private directorControl() {
    const select = el("select", { id: "director" });
    for (const mode of Object.keys(civConfig.director.modes)) select.append(el("option", { value: mode }, txt(("dir_" + mode) as PlayKey)));
    select.value = this.directorMode;
    const life = el("input", { type: "checkbox", id: "life-returns", checked: this.lifeReturns });
    const send = () => {
      this.directorMode = select.value as DirectorMode;
      this.lifeReturns = life.checked;
      this.sim.command({ c: "director", mode: this.directorMode, lifeReturns: this.lifeReturns });
    };
    select.onchange = send;
    life.onchange = send;
    const box = el("label", { htmlFor: "director", title: t("tip_director") }, txt("w_director"), select);
    box.dataset.it = "tip_director";
    return el("div", { className: "director" }, box, el("label", { htmlFor: "life-returns" }, life, txt("life_returns")));
  }

  private brushControl() {
    const input = el("input", { type: "range", id: "brush-size", min: String(BRUSH.min), max: String(BRUSH.max), value: String(this.brush) });
    input.oninput = () => this.setBrush(Number(input.value));
    return el("label", { htmlFor: "brush-size" }, el("span", { id: "brush-label", textContent: t("brush", { n: this.brush }) }), input);
  }

  private biomePicker() {
    const select = el("select", { id: "paint-biome" });
    BIOMES.forEach((b, i) => select.append(el("option", { value: String(i) }, txt(("biome_" + b.key) as PlayKey))));
    select.value = String(this.paintBiome);
    select.onchange = () => (this.paintBiome = Number(select.value));
    return el("label", { htmlFor: "paint-biome" }, txt("pick_biome"), select);
  }

  private traitPicker() {
    const select = el("select", { id: "gene-trait" });
    TRAITS.forEach((_, i) => select.append(el("option", { value: String(i), textContent: traitName(i) })));
    select.value = String(this.trait);
    select.onchange = () => (this.trait = Number(select.value));
    return el("label", { htmlFor: "gene-trait" }, txt("gene_trait"), select);
  }

  // Inspector

  // From the kingdom tree: fly to a town and open it in the inspector.
  private visitTown(id: number) {
    const town = this.view.towns.find((tw) => tw.id === id);
    if (!town) return;
    this.select(0);
    this.inspected = null;
    this.cam.centerOn(town.x, town.y);
    this.cameraMoved();
    this.selectTown(id);
    this.renderInspector();
  }

  private inspect(tx: number, ty: number) {
    if (!this.world) return;
    const uid = this.view.nearest(tx, ty, 1.5);
    if (uid) {
      this.inspected = null;
      return this.select(uid);
    }
    // A click on a town hall opens the town and its kingdom.
    const hall = this.view.buildings.find((b) => b.type === "hall" && tx >= b.x - 0.5 && tx <= b.x + b.w + 0.5 && ty >= b.y - 1 && ty <= b.y + b.h + 0.5);
    const town = hall && this.view.towns.find((tw) => Math.abs(tw.x - (hall.x + 1)) < 1.5 && Math.abs(tw.y - (hall.y + 1)) < 1.5);
    if (town) {
      this.select(0);
      this.inspected = null;
      this.selectTown(town.id);
      return this.renderInspector();
    }
    this.selectTown(0);
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= this.world.w || y >= this.world.h) return;
    this.select(0);
    this.inspected = [x, y];
    this.renderInspector();
  }

  private renderInspector() {
    const box = $("#insp");
    const show = this.tab === "insp" || this.tab === "gene" || this.tab === "cmd";
    box.hidden = !show;
    box.classList.toggle("open", show && (!!this.inspected || !!this.selected || !!this.selectedTown));
    if (!show) return;
    const army = this.tab === "cmd" ? this.cmd.selectedArmy() : undefined;
    if (army) {
      box.replaceChildren(...armyCard(army));
      return;
    }
    if (this.selectedTown && this.view.town) {
      box.replaceChildren(...townCard(this.view.town));
      return;
    }
    const d = this.view.selected;
    if (this.selected && d) {
      box.replaceChildren(...unitCard(d, this.following, () => {
        this.following = !this.following;
        this.renderInspector();
      }));
      return;
    }
    if (this.world && this.inspected) {
      box.replaceChildren(...tileCard(this.world, this.inspected[0], this.inspected[1]));
      return;
    }
    box.replaceChildren(el("h3", {}, txt("in_title")), el("p", {}, txt(this.tab === "gene" ? "tip_pick" : "in_hint")));
  }

  // Minimap

  private drawMinimap() {
    this.miniDirty = false;
    if (!this.world || !this.miniImg) return;
    const ctx = this.mini.getContext("2d")!;
    ctx.putImageData(this.miniImg, 0, 0);
    ctx.strokeStyle = "#f4f0e8";
    ctx.lineWidth = 1;
    const vw = this.cam.viewW / this.cam.scale;
    const vh = this.cam.viewH / this.cam.scale;
    ctx.strokeRect(Math.round(this.cam.x) + 0.5, Math.round(this.cam.y) + 0.5, Math.round(vw), Math.round(vh));
  }

  private minimapJump(e: PointerEvent) {
    if (!this.world) return;
    const r = this.mini.getBoundingClientRect();
    this.following = false;
    this.cam.centerOn(((e.clientX - r.left) / r.width) * this.world.w, ((e.clientY - r.top) / r.height) * this.world.h);
    this.cameraMoved();
  }

  // Text that carries numbers is rebuilt here; plain keys swap in applyLang.

  private refreshText() {
    const w = this.world;
    this.updateTopBar();
    $("#t-seed").textContent = w ? t("seed", { n: String(w.options.seed) }) : "";
    this.updateZoomLabel();
    const label = document.querySelector("#brush-label");
    if (label) label.textContent = t("brush", { n: this.brush });
    document.querySelectorAll<HTMLButtonElement>("#tabs button[data-phase]").forEach((b) => {
      b.title = t("soon_tab", { n: b.dataset.phase! });
    });
    document.querySelectorAll<HTMLOptionElement>("#gene-trait option").forEach((o) => (o.textContent = traitName(Number(o.value))));
    this.renderInspector();
  }

  private updateZoomLabel() {
    $("#t-zoom").textContent = t(("zoom_" + this.cam.level) as PlayKey);
  }

  // Dialogs, saves, files

  private bindDialogs() {
    $("#stats-btn").onclick = () => void this.stats.open();
    const dlg = $<HTMLDialogElement>("#newworld");
    const out = (id: string) => {
      const input = $<HTMLInputElement>(id);
      const o = $<HTMLOutputElement>(`output[for=${id.slice(1)}]`);
      input.oninput = () => (o.textContent = input.value);
    };
    ["#nw-land", "#nw-temp", "#nw-moist", "#nw-magic"].forEach(out);
    $("#nw-roll").onclick = () => ($<HTMLInputElement>("#nw-seed").value = String(randomSeed()));
    const races = $("#nw-races");
    RACES.forEach((race, k) => {
      const box = el("input", { type: "checkbox", checked: true, value: race, id: `nw-race-${race}` });
      races.append(el("label", { htmlFor: box.id }, box, el("span", { textContent: kindName(k) })));
    });
    dlg.addEventListener("close", () => {
      if (dlg.returnValue !== "go") return;
      const num = (id: string) => Number($<HTMLInputElement>(id).value);
      const chosen = [...races.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value as RaceKey);
      void this.generate({
        seed: Math.max(1, Math.round(num("#nw-seed")) || randomSeed()),
        size: $<HTMLSelectElement>("#nw-size").value as SizeKey,
        layout: $<HTMLSelectElement>("#nw-layout").value as Layout,
        land: num("#nw-land"),
        temperature: num("#nw-temp"),
        moisture: num("#nw-moist"),
        magic: num("#nw-magic"),
      }, chosen);
    });

    $("#sv-close").onclick = () => $<HTMLDialogElement>("#saves").close();
    $<HTMLInputElement>("#import").onchange = (e) => this.importWorld(e);
  }

  private openNewWorld() {
    const o = this.world?.options ?? defaultOptions(randomSeed());
    const size = $<HTMLSelectElement>("#nw-size");
    const layout = $<HTMLSelectElement>("#nw-layout");
    size.replaceChildren(...Object.keys(config.sizes).map((k) => el("option", { value: k }, txt(("size_" + k) as PlayKey))));
    layout.replaceChildren(...config.layouts.map((k) => el("option", { value: k }, txt(("layout_" + k) as PlayKey))));
    size.value = o.size;
    layout.value = o.layout;
    $<HTMLInputElement>("#nw-seed").value = String(randomSeed());
    const set = (id: string, v: number) => {
      $<HTMLInputElement>(id).value = String(v);
      $(`output[for=${id.slice(1)}]`).textContent = String(v);
    };
    set("#nw-land", o.land);
    set("#nw-temp", o.temperature);
    set("#nw-moist", o.moisture);
    set("#nw-magic", o.magic);
    $("#nw-races").querySelectorAll("span").forEach((s, k) => (s.textContent = kindName(k)));
    $<HTMLDialogElement>("#newworld").showModal();
  }

  private async openSaves() {
    const dlg = $<HTMLDialogElement>("#saves");
    const list = $(".slots", dlg);
    const slots = await listSlots().catch(() => null);
    if (!slots) return toast(t("sv_fail"));
    list.replaceChildren();
    const ids: SlotId[] = ["auto", ...Array.from({ length: SAVE_SLOTS }, (_, i) => String(i + 1) as SlotId)];
    for (const id of ids) {
      const meta = slots.get(id);
      const name = id === "auto" ? t("sv_auto") : t("sv_slot", { n: id });
      const info = meta
        ? `${t("year", { n: meta.year })} · ${t("seed", { n: String(meta.seed) })} · ${t(("size_" + meta.size) as PlayKey)} · ${new Date(meta.created).toLocaleString(document.documentElement.lang)}`
        : t("sv_empty");
      const load = el("button", { type: "button", textContent: t("sv_load"), disabled: !meta, onclick: () => this.loadFrom(id) });
      const save = el("button", { type: "button", textContent: t("sv_save"), onclick: () => this.saveTo(id) });
      if (id === "auto") save.hidden = true;
      list.append(el("li", {}, el("div", {}, el("b", { textContent: name }), el("small", { textContent: info })), save, load));
    }
    if (!dlg.open) dlg.showModal();
  }

  private async snapshot(): Promise<SimSnapshot | undefined> {
    return Promise.race([this.sim.snapshot(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000))]);
  }

  private async saveTo(slot: SlotId) {
    if (!this.world) return;
    try {
      const snap = await this.snapshot();
      await saveSlot(slot, this.world, t("sv_slot", { n: slot }), this.view.frame?.year ?? 0, snap);
      toast(t("sv_saved", { n: slot }));
      await this.openSaves();
    } catch {
      toast(t("sv_fail"));
    }
  }

  private async loadFrom(slot: SlotId) {
    try {
      const loaded = await loadSlot(slot);
      if (!loaded) return;
      this.load(loaded);
      $<HTMLDialogElement>("#saves").close();
      toast(t("sv_loaded"));
    } catch {
      toast(t("sv_fail"));
    }
  }

  private async exportWorld() {
    if (!this.world) return;
    const blob = await exportFile(this.world, `seed ${this.world.options.seed}`, this.view.frame?.year ?? 0, await this.snapshot());
    const a = el("a", { href: URL.createObjectURL(blob), download: `pocket-pantheon-${this.world.options.seed}.ppworld` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(t("sv_exported"));
  }

  private async importWorld(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      this.load(await importFile(file));
      toast(t("sv_loaded"));
    } catch {
      toast(t("sv_bad_file"));
    }
  }

  private startAutosave() {
    const save = async () => {
      if (!this.world || !this.view.frame) return;
      const snap = await this.snapshot();
      saveSlot("auto", this.world, "auto", this.view.frame.year, snap).catch(() => {});
    };
    setInterval(save, config.autosaveSeconds * 1000);
    document.addEventListener("visibilitychange", () => document.hidden && void save());
  }

  // Browsers slow hidden tabs down anyway, so the world waits for you (PLAN section 12).
  private pauseWhenHidden() {
    document.addEventListener("visibilitychange", () => this.sim.setSpeed(document.hidden ? 0 : this.speed));
  }

  // Read only hooks for the browser tests.
  private debug() {
    return {
      world: () => this.world,
      camera: this.cam,
      renderer: this.renderer.kind,
      fps: () => this.frames.length,
      genMs: () => this.genMs,
      frame: () => this.view.frame,
      generate: (o: Partial<WorldOptions>, races?: RaceKey[]) => this.generate({ ...defaultOptions(randomSeed()), ...o }, races),
      speed: (s: number) => this.setSpeed(s),
      ratio: () => this.res,
      command: (c: Parameters<SimClient["command"]>[0]) => this.sim.command(c),
      select: (uid: number) => this.select(uid),
      fmt,
    };
  }
}

// Shelf icons for the Grace powers, built from the effect sprites.
function graceIcon(power: GracePower) {
  const name = power === "rain" ? "drop" : power === "heal" ? "plus" : "sparkle";
  return FX_ICON[name]!;
}

declare global {
  interface Window {
    __pp?: unknown;
  }
}
