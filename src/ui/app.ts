// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import config from "../../data/world.json";
import simConfig from "../../data/sim.json";
import { buildSprites, type SpriteSet } from "../render/atlas";
import { Camera } from "../render/camera";
import { createCanvasRenderer, paintTiles } from "../render/canvas2d";
import type { Renderer } from "../render/renderer";
import { Scene } from "../render/scene";
import { mk, TAB_ICONS, TOOL_ICONS } from "../render/sprites";
import { createWebGLRenderer } from "../render/webgl";
import { exportFile, importFile, listSlots, loadSlot, saveSlot, type Loaded, type SlotId } from "../save/store";
import { SimClient } from "../sim/client";
import type { Frame } from "../sim/protocol";
import type { SimSnapshot } from "../sim/snapshot";
import { RACES, SPECIES, TRAITS, type RaceKey } from "../sim/species";
import { BIOMES } from "../world/biomes";
import { generateAsync } from "../world/client";
import { applyStroke, strokeTarget, type Rect, type ShapeTool, type Stroke } from "../world/edit";
import { defaultOptions, type Layout, type SizeKey, type World, type WorldOptions } from "../world/types";
import { $, el, randomSeed, SAVE_SLOTS, toast, txt } from "./dom";
import { bindLangSwitch, fmt, onLangChange, t, toggleLang, type PlayKey } from "./i18n";
import { bindMapInput } from "./input";
import { kindName, tileCard, traitName, unitCard } from "./inspector";
import { SimView } from "./simview";

type Tab = "shape" | "life" | "cmd" | "wrath" | "grace" | "gene" | "world" | "insp";
type Tool = ShapeTool | "pan" | "inspect" | "spawn" | "pick";

// Which phase brings each tab to life (PLAN section 21).
const TABS: { key: Tab; phase: number }[] = [
  { key: "shape", phase: 1 }, { key: "life", phase: 2 }, { key: "cmd", phase: 4 }, { key: "wrath", phase: 5 },
  { key: "grace", phase: 3 }, { key: "gene", phase: 2 }, { key: "world", phase: 1 }, { key: "insp", phase: 1 },
];
const READY_PHASE = 2;
const CONTINUOUS: Tool[] = ["raise", "lower", "flatten", "smooth", "paint"];
const BRUSH = config.brush;
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
  private genMs = 0;
  private mini = $<HTMLCanvasElement>("#mini canvas");
  private miniImg: ImageData | null = null;
  private brushRing = el("div");
  private lastHover = { x: -1, y: -1 };

  async start() {
    this.renderer = createWebGLRenderer(this.canvas) ?? this.fallback();
    this.sprites = buildSprites();
    this.scene = new Scene(this.sprites);
    this.sim.onFrame = (f) => this.onFrame(f);
    bindLangSwitch("play");
    onLangChange(() => this.refreshText());
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
    for (const e of f.events) if (e.t === "town") toast(t("ev_town", { name: e.name }));
    if (f.selected === null && this.selected) this.select(0);
    this.updateTopBar();
    if (this.tab === "insp" || this.tab === "gene") this.renderInspector();
  }

  // Frame loop

  private frame(now: number, last: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    this.frames.push(now);
    while (this.frames.length && this.frames[0]! < now - 1000) this.frames.shift();

    if (this.following && this.selected) {
      const at = this.view.position(this.selected);
      if (at) this.cam.centerOn(at[0], at[1]);
    }
    if (this.cam.update(dt) || this.following) this.cameraMoved();
    if (this.stroke && CONTINUOUS.includes(this.stroke.tool)) this.paintStroke(this.stroke);
    if (this.world && this.dirty) {
      this.renderer.update(this.world, this.dirty);
      if (this.miniImg) paintTiles(this.world, this.miniImg, this.dirty);
      this.dirty = null;
      this.miniDirty = true;
    }
    if (this.world) {
      const year = this.view.frame ? (this.view.frame.tick % simConfig.ticksPerYear) / simConfig.ticksPerYear : 0;
      this.renderer.draw(this.cam, now / 400, year);
      this.scene.build(this.cam, this.view.units(now), this.view.count, this.view.buildings, this.view.towns, this.selected, now / 1000);
      this.renderer.drawSprites(this.scene, this.sprites.atlas, this.cam);
    }
    if (this.miniDirty) this.drawMinimap();
    requestAnimationFrame((next) => this.frame(next, now));
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.cam.setView(this.canvas.width, this.canvas.height);
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
  }

  private press(tx: number, ty: number) {
    if (!this.world) return;
    switch (this.tool) {
      case "inspect":
        return this.inspect(tx, ty);
      case "pick":
        return this.select(this.view.nearest(tx, ty, 1.5));
      case "pan":
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
    const brushy = (this.tab === "shape" && this.tool !== "pan") || (this.tab === "life" && this.tool === "spawn");
    if (!brushy || at.x < 0) {
      this.brushRing.style.display = "none";
      return;
    }
    const dpr = window.devicePixelRatio || 1;
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
    const n = Number(e.key);
    if (n >= 1 && n <= 8) {
      const tab = TABS[n - 1]!;
      if (tab.phase <= READY_PHASE) this.selectTab(tab.key);
      return;
    }
    const cx = this.cam.viewW / 2;
    const cy = this.cam.viewH / 2;
    const step = 80 * (window.devicePixelRatio || 1);
    const pan = (x: number, y: number) => () => {
      this.following = false;
      this.cam.pan(x, y);
    };
    const actions: Record<string, () => void> = {
      " ": () => this.setSpeed(this.speed ? 0 : 1),
      "[": () => this.setBrush(this.brush - 1),
      "]": () => this.setBrush(this.brush + 1),
      l: () => toggleLang("play"),
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

  private select(uid: number) {
    this.selected = uid;
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
    $("#t-kin").textContent = t("kin", { n: 0 });
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
    const defaults: Partial<Record<Tab, Tool>> = { shape: "raise", life: "spawn", gene: "pick", insp: "inspect", world: "pan" };
    const keep = (tab === "shape" && !["inspect", "pan", "spawn", "pick"].includes(this.tool)) || this.tool === "pan";
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
          const sprite = this.sprites.atlas.sprites[this.sprites.unit(kind, 0, 0, 0)]!;
          const icon = el("canvas", { width: 24, height: 24, className: "px" });
          const ctx = icon.getContext("2d")!;
          const k = Math.min(1, 24 / Math.max(sprite.w, sprite.h));
          ctx.imageSmoothingEnabled = false;
          const w = Math.round(sprite.w * k);
          const h = Math.round(sprite.h * k);
          ctx.drawImage(this.sprites.atlas.canvas, sprite.x, sprite.y, sprite.w, sprite.h, (24 - w) / 2, 24 - h, w, h);
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
        );
        return;
      case "insp":
        shelf.append(panButton(), this.iconButton("fit", "tool_pick", "in_hint", pick("inspect"), this.tool === "inspect"));
        return;
      case "world":
        shelf.append(
          this.iconButton("new", "w_new", "tip_new", () => this.openNewWorld()),
          this.iconButton("saves", "w_saves", "tip_saves", () => this.openSaves()),
          this.iconButton("export", "w_export", "tip_export", () => this.exportWorld()),
          this.iconButton("import", "w_import", "tip_import", () => $<HTMLInputElement>("#import").click()),
          this.iconButton("fit", "w_fit", "tip_fit", () => {
            this.following = false;
            this.cam.fit();
            this.cameraMoved();
          }),
        );
    }
  }

  private gene(cmd: Parameters<SimClient["command"]>[0]) {
    if (!this.selected) return toast(t("gene_none"));
    this.sim.command(cmd);
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

  private inspect(tx: number, ty: number) {
    if (!this.world) return;
    const uid = this.view.nearest(tx, ty, 1.5);
    if (uid) {
      this.inspected = null;
      return this.select(uid);
    }
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= this.world.w || y >= this.world.h) return;
    this.select(0);
    this.inspected = [x, y];
    this.renderInspector();
  }

  private renderInspector() {
    const box = $("#insp");
    const show = this.tab === "insp" || this.tab === "gene";
    box.hidden = !show;
    box.classList.toggle("open", show && (!!this.inspected || !!this.selected));
    if (!show) return;
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
      select: (uid: number) => this.select(uid),
      fmt,
    };
  }
}

declare global {
  interface Window {
    __pp?: unknown;
  }
}
