// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import config from "../../data/world.json";
import { Camera } from "../render/camera";
import { createCanvasRenderer, paintTiles } from "../render/canvas2d";
import type { Renderer } from "../render/renderer";
import { mk, TAB_ICONS, TOOL_ICONS } from "../render/sprites";
import { createWebGLRenderer } from "../render/webgl";
import { exportFile, importFile, listSlots, loadSlot, saveSlot, type SlotId } from "../save/store";
import { BIOMES } from "../world/biomes";
import { generateAsync } from "../world/client";
import { applyStroke, strokeTarget, type Rect, type ShapeTool, type Stroke } from "../world/edit";
import { defaultOptions, LAKE, ORES, RIVER, type Layout, type SizeKey, type World, type WorldOptions } from "../world/types";
import { $, el, randomSeed, SAVE_SLOTS, toast, txt } from "./dom";
import { bindLangSwitch, fmt, onLangChange, t, toggleLang, type PlayKey } from "./i18n";
import { bindMapInput } from "./input";

type Tab = "shape" | "life" | "cmd" | "wrath" | "grace" | "gene" | "world" | "insp";
type Tool = ShapeTool | "pan" | "inspect";

// Which phase brings each tab to life (PLAN section 21).
const TABS: { key: Tab; phase: number }[] = [
  { key: "shape", phase: 1 }, { key: "life", phase: 2 }, { key: "cmd", phase: 4 }, { key: "wrath", phase: 5 },
  { key: "grace", phase: 3 }, { key: "gene", phase: 2 }, { key: "world", phase: 1 }, { key: "insp", phase: 1 },
];
const READY_PHASE = 1;
const CONTINUOUS: Tool[] = ["raise", "lower", "flatten", "smooth", "paint"];
const BRUSH = config.brush;

export class App {
  private canvas = $<HTMLCanvasElement>("#world");
  private cam = new Camera();
  private renderer!: Renderer;
  private world: World | null = null;
  private tab: Tab = "shape";
  private tool: Tool = "raise";
  private brush = BRUSH.default;
  private paintBiome = BIOMES.findIndex((b) => b.key === "grassland");
  private stroke: Stroke | null = null;
  private strokeSeed = 1;
  private dirty: Rect | null = null;
  private miniDirty = true;
  private unsaved = false;
  private inspected: [number, number] | null = null;
  private frames: number[] = [];
  private genMs = 0;
  private mini = $<HTMLCanvasElement>("#mini canvas");
  private miniImg: ImageData | null = null;
  private brushRing = el("div");

  async start() {
    this.renderer = createWebGLRenderer(this.canvas) ?? this.fallback();
    bindLangSwitch("play");
    onLangChange(() => this.refreshText());
    this.buildTabs();
    this.selectTab("shape");
    this.bindInput();
    this.bindDialogs();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.startAutosave();
    requestAnimationFrame((now) => this.frame(now, now));

    const params = new URLSearchParams(location.search);
    const fromUrl = params.has("seed");
    const resumed = fromUrl ? null : await loadSlot("auto").catch(() => null);
    if (resumed) {
      this.setWorld(resumed);
      toast(t("resumed"));
    } else {
      await this.generate(this.optionsFromUrl(params));
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

  // World lifecycle

  async generate(options: WorldOptions) {
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
    this.unsaved = true;
  }

  private setWorld(world: World) {
    this.world = world;
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

  // Frame loop

  private frame(now: number, last: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    this.frames.push(now);
    while (this.frames.length && this.frames[0]! < now - 1000) this.frames.shift();

    if (this.cam.update(dt)) this.cameraMoved();
    if (this.stroke && CONTINUOUS.includes(this.stroke.tool)) this.paintStroke(this.stroke);
    if (this.world && this.dirty) {
      this.renderer.update(this.world, this.dirty);
      if (this.miniImg) paintTiles(this.world, this.miniImg, this.dirty);
      this.dirty = null;
      this.miniDirty = true;
    }
    if (this.world) this.renderer.draw(this.cam, now / 400);
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

  // Tools

  private paintStroke(s: Stroke) {
    if (!this.world) return;
    const rect = applyStroke(this.world, s);
    if (!rect) return;
    this.unsaved = true;
    this.dirty = this.dirty
      ? { x0: Math.min(this.dirty.x0, rect.x0), y0: Math.min(this.dirty.y0, rect.y0), x1: Math.max(this.dirty.x1, rect.x1), y1: Math.max(this.dirty.y1, rect.y1) }
      : rect;
    if (this.inspected) this.renderInspector();
  }

  private bindInput() {
    let hoverAt = { x: -1, y: -1 };
    bindMapInput(this.canvas, this.cam, {
      isPanTool: () => this.tool === "pan",
      press: (tx, ty) => {
        if (!this.world) return;
        if (this.tool === "inspect") return this.inspect(tx, ty);
        if (this.tool === "pan") return;
        const s: Stroke = { tool: this.tool, x: tx, y: ty, radius: this.brush - 1, biome: this.paintBiome, seed: this.strokeSeed++ };
        if (this.tool === "flatten") s.target = strokeTarget(this.world, tx, ty);
        this.stroke = s;
        this.paintStroke(s); // first touch shows up right away, well under 100 ms
      },
      hold: (tx, ty) => {
        if (this.tool === "inspect") return this.inspect(tx, ty);
        if (this.stroke) {
          this.stroke.x = tx;
          this.stroke.y = ty;
        }
      },
      release: () => (this.stroke = null),
      hover: (sx, sy) => {
        hoverAt = { x: sx, y: sy };
        this.updateBrushRing(hoverAt);
      },
      moved: () => this.cameraMoved(),
    });
    this.brushRing.id = "brush";
    Object.assign(this.brushRing.style, { position: "fixed", pointerEvents: "none", border: "2px solid #f4f0e8", borderRadius: "50%", display: "none", boxShadow: "0 0 0 1px #2b2233" });
    document.body.append(this.brushRing);
    this.lastHover = () => hoverAt;

    this.mini.parentElement!.addEventListener("pointerdown", (e) => this.minimapJump(e));
    window.addEventListener("keydown", (e) => this.key(e));
  }

  private lastHover = () => ({ x: -1, y: -1 });

  private updateBrushRing(at = this.lastHover()) {
    const shaping = this.tab === "shape" && this.tool !== "pan";
    if (!shaping || at.x < 0) {
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
    const actions: Record<string, () => void> = {
      "[": () => this.setBrush(this.brush - 1),
      "]": () => this.setBrush(this.brush + 1),
      l: () => toggleLang("play"),
      "+": () => this.cam.zoomStep(1, cx, cy),
      "=": () => this.cam.zoomStep(1, cx, cy),
      "-": () => this.cam.zoomStep(-1, cx, cy),
      Home: () => this.cam.fit(),
      ArrowLeft: () => this.cam.pan(step, 0),
      ArrowRight: () => this.cam.pan(-step, 0),
      ArrowUp: () => this.cam.pan(0, step),
      ArrowDown: () => this.cam.pan(0, -step),
      a: () => this.cam.pan(step, 0),
      d: () => this.cam.pan(-step, 0),
      w: () => this.cam.pan(0, step),
      s: () => this.cam.pan(0, -step),
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

  // Tabs and shelf

  private buildTabs() {
    const nav = $("#tabs");
    for (const tab of TABS) {
      const b = el("button", { type: "button" });
      b.setAttribute("role", "tab");
      b.dataset.tab = tab.key;
      b.append(mk(14, 14, TAB_ICONS[tab.key === "world" ? "world" : tab.key]!, 2), Object.assign(txt(("tab_" + tab.key) as PlayKey), { className: "lbl" }));
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
    if (tab === "shape" && (this.tool === "inspect" || this.tool === "pan")) this.tool = "raise";
    if (tab === "insp") this.tool = "inspect";
    if (tab === "world") this.tool = "pan";
    this.buildShelf();
    this.renderInspector();
    this.refreshText();
  }

  private toolButton(key: string, label: PlayKey, tip: PlayKey, onClick: () => void, pressed?: boolean) {
    const b = el("button", { type: "button", onclick: onClick });
    b.dataset.it = tip;
    b.title = t(tip);
    b.append(mk(12, 12, TOOL_ICONS[key]!, 2), txt(label));
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    return b;
  }

  private buildShelf() {
    const shelf = $("#shelf");
    shelf.replaceChildren();
    const pick = (tool: Tool) => () => {
      this.tool = tool;
      this.buildShelf();
    };

    if (this.tab === "shape" || this.tab === "insp") {
      shelf.append(this.toolButton("pan", "tool_pan", "tip_pan", pick("pan"), this.tool === "pan"));
    }
    if (this.tab === "insp") {
      shelf.append(el("span", { className: "sep" }), el("label", {}, txt("in_hint")));
      if (this.tool === "pan") shelf.lastElementChild!.remove();
      return;
    }
    if (this.tab === "shape") {
      shelf.append(el("span", { className: "sep" }));
      for (const tool of ["raise", "lower", "flatten", "smooth", "paint"] as const) {
        shelf.append(this.toolButton(tool, `tool_${tool}`, `tip_${tool}`, pick(tool), this.tool === tool));
      }
      shelf.append(el("span", { className: "sep" }));
      for (const tool of ["island", "volcano", "range"] as const) {
        shelf.append(this.toolButton(tool, `tool_${tool}`, `tip_${tool}`, pick(tool), this.tool === tool));
      }
      shelf.append(el("span", { className: "sep" }), this.brushControl());
      if (this.tool === "paint") shelf.append(this.biomePicker());
      return;
    }
    if (this.tab === "world") {
      shelf.append(
        this.toolButton("new", "w_new", "tip_new", () => this.openNewWorld()),
        this.toolButton("saves", "w_saves", "tip_saves", () => this.openSaves()),
        this.toolButton("export", "w_export", "tip_export", () => this.exportWorld()),
        this.toolButton("import", "w_import", "tip_import", () => $<HTMLInputElement>("#import").click()),
        this.toolButton("fit", "w_fit", "tip_fit", () => {
          this.cam.fit();
          this.cameraMoved();
        }),
      );
    }
  }

  private brushControl() {
    const input = el("input", { type: "range", id: "brush-size", min: String(BRUSH.min), max: String(BRUSH.max), value: String(this.brush) });
    input.oninput = () => this.setBrush(Number(input.value));
    const label = el("label", { htmlFor: "brush-size" }, el("span", { id: "brush-label" }), input);
    return label;
  }

  private biomePicker() {
    const select = el("select", { id: "paint-biome" });
    BIOMES.forEach((b, i) => {
      const opt = el("option", { value: String(i) }, txt(("biome_" + b.key) as PlayKey));
      select.append(opt);
    });
    select.value = String(this.paintBiome);
    select.onchange = () => (this.paintBiome = Number(select.value));
    return el("label", { htmlFor: "paint-biome" }, txt("pick_biome"), select);
  }

  // Inspector

  private inspect(tx: number, ty: number) {
    if (!this.world) return;
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= this.world.w || y >= this.world.h) return;
    this.inspected = [x, y];
    this.renderInspector();
  }

  private renderInspector() {
    const box = $("#insp");
    box.classList.toggle("open", this.tab === "insp" && !!this.inspected);
    box.hidden = this.tab !== "insp";
    if (box.hidden) return;
    if (!this.world || !this.inspected) {
      box.replaceChildren(el("h3", {}, txt("in_title")), el("p", {}, txt("in_hint")));
      return;
    }
    const w = this.world;
    const [x, y] = this.inspected;
    const i = y * w.w + x;
    const above = w.height[i]! - w.seaLevel;
    const water = above < 0 ? t("water_sea") : w.flags[i]! & LAKE ? t("water_lake") : w.flags[i]! & RIVER ? t("water_river") : t("none");
    const ore = ORES[w.ore[i]!] ?? "none";
    const rows: [PlayKey, string][] = [
      ["in_tile", `${fmt(x)}, ${fmt(y)}`],
      ["in_biome", t(("biome_" + BIOMES[w.biome[i]!]!.key) as PlayKey)],
      ["in_height", t("pct", { n: Math.round(w.height[i]! * 100) })],
      ["in_water", water],
      ["in_temp", t("deg", { n: Math.round(w.temperature[i]! * 50 - 15) })],
      ["in_moist", t("pct", { n: Math.round(w.moisture[i]! * 100) })],
      ["in_fert", t("pct", { n: Math.round((w.fertility[i]! / 255) * 100) })],
      ["in_ore", ore === "none" ? t("none") : t(("ore_" + ore) as PlayKey)],
    ];
    const dl = el("dl");
    for (const [k, v] of rows) dl.append(el("dt", {}, txt(k)), el("dd", { textContent: v }));
    box.replaceChildren(el("h3", {}, txt("in_title")), dl);
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
    this.cam.centerOn(((e.clientX - r.left) / r.width) * this.world.w, ((e.clientY - r.top) / r.height) * this.world.h);
    this.cameraMoved();
  }

  // Text that carries numbers is rebuilt here; plain keys swap in applyLang.

  private refreshText() {
    const w = this.world;
    $("#t-year").textContent = t("year", { n: 0 });
    $("#t-pop").textContent = t("pop", { n: 0 });
    $("#t-kin").textContent = t("kin", { n: 0 });
    $("#t-seed").textContent = w ? t("seed", { n: String(w.options.seed) }) : "";
    this.updateZoomLabel();
    const label = document.querySelector("#brush-label");
    if (label) label.textContent = t("brush", { n: this.brush });
    document.querySelectorAll<HTMLButtonElement>("#tabs button[data-phase]").forEach((b) => {
      b.title = t("soon_tab", { n: b.dataset.phase! });
    });
    if (this.tab === "insp") this.renderInspector();
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
    dlg.addEventListener("close", () => {
      if (dlg.returnValue !== "go") return;
      const num = (id: string) => Number($<HTMLInputElement>(id).value);
      void this.generate({
        seed: Math.max(1, Math.round(num("#nw-seed")) || randomSeed()),
        size: $<HTMLSelectElement>("#nw-size").value as SizeKey,
        layout: $<HTMLSelectElement>("#nw-layout").value as Layout,
        land: num("#nw-land"),
        temperature: num("#nw-temp"),
        moisture: num("#nw-moist"),
        magic: num("#nw-magic"),
      });
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
      const info = meta ? `${t("seed", { n: String(meta.seed) })} · ${t(("size_" + meta.size) as PlayKey)} · ${new Date(meta.created).toLocaleString(document.documentElement.lang)}` : t("sv_empty");
      const load = el("button", { type: "button", textContent: t("sv_load"), disabled: !meta, onclick: () => this.loadFrom(id) });
      const save = el("button", { type: "button", textContent: t("sv_save"), onclick: () => this.saveTo(id) });
      if (id === "auto") save.hidden = true;
      list.append(el("li", {}, el("div", {}, el("b", { textContent: name }), el("small", { textContent: info })), save, load));
    }
    if (!dlg.open) dlg.showModal();
  }

  private async saveTo(slot: SlotId) {
    if (!this.world) return;
    try {
      await saveSlot(slot, this.world, t("sv_slot", { n: slot }));
      toast(t("sv_saved", { n: slot }));
      await this.openSaves();
    } catch {
      toast(t("sv_fail"));
    }
  }

  private async loadFrom(slot: SlotId) {
    try {
      const world = await loadSlot(slot);
      if (!world) return;
      this.setWorld(world);
      $<HTMLDialogElement>("#saves").close();
      toast(t("sv_loaded"));
    } catch {
      toast(t("sv_fail"));
    }
  }

  private async exportWorld() {
    if (!this.world) return;
    const blob = await exportFile(this.world, `seed ${this.world.options.seed}`);
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
      this.setWorld(await importFile(file));
      toast(t("sv_loaded"));
    } catch {
      toast(t("sv_bad_file"));
    }
  }

  private startAutosave() {
    const save = () => {
      if (!this.world || !this.unsaved) return;
      this.unsaved = false;
      saveSlot("auto", this.world, "auto").catch(() => (this.unsaved = true));
    };
    setInterval(save, config.autosaveSeconds * 1000);
    document.addEventListener("visibilitychange", () => document.hidden && save());
    window.addEventListener("pagehide", save);
  }

  // Read only hooks for the browser tests.
  private debug() {
    return {
      world: () => this.world,
      camera: this.cam,
      renderer: this.renderer.kind,
      fps: () => this.frames.length,
      genMs: () => this.genMs,
      generate: (o: Partial<WorldOptions>) => this.generate({ ...defaultOptions(randomSeed()), ...o }),
    };
  }
}

declare global {
  interface Window {
    __pp?: unknown;
  }
}
