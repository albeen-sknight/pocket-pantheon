// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Synthesized sound (PLAN section 19): no audio files, just a few short
// Web Audio voices and a quiet generative music loop. Nothing starts until
// the player touches the page, and every failure leaves the game silent but
// running.
import cfg from "../../data/audio.json";

export type Sound = keyof typeof cfg.sounds;

export interface AudioSettings {
  master: number; // 0 to 100
  effects: number;
  music: number;
  muted: boolean;
}

export interface Mood {
  year: number;
  danger: boolean; // a disaster or storm is under way
}

const ppStore = "pp_audio_settings";
const DEFAULTS: AudioSettings = cfg.defaults;

const clamp = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback);

export function loadSettings(): AudioSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ppStore) ?? "null");
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    const s = raw as Partial<Record<keyof AudioSettings, unknown>>;
    return {
      master: clamp(s.master, DEFAULTS.master),
      effects: clamp(s.effects, DEFAULTS.effects),
      music: clamp(s.music, DEFAULTS.music),
      muted: typeof s.muted === "boolean" ? s.muted : DEFAULTS.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export class AudioEngine {
  settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sound, number>();
  private voices = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private mood: Mood = { year: 0, danger: false };
  private step = 0;
  failed = false;
  starts = 0; // how many times a context was created, for the tests
  played: Partial<Record<Sound, number>> = {}; // voices started per sound, for the tests

  // The first gesture creates the context. Later calls only resume it.
  unlock() {
    if (this.failed) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.failed = true;
      return;
    }
    try {
      const ctx = new Ctx();
      this.ctx = ctx;
      this.starts++;
      this.master = ctx.createGain();
      this.sfx = ctx.createGain();
      this.music = ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(ctx.destination);
      this.noise = whiteNoise(ctx);
      this.apply();
      ctx.resume().catch(() => {});
      this.loop = setInterval(() => this.playMusic(), cfg.music.everyMs);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  // The world pauses while the tab is hidden, so the music does too.
  pause(hidden: boolean) {
    if (!this.ctx) return;
    (hidden ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
  }

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  set(next: Partial<AudioSettings>) {
    this.settings = loadSettingsFrom({ ...this.settings, ...next });
    try {
      localStorage.setItem(ppStore, JSON.stringify(this.settings));
    } catch {
      // the new levels still apply for this visit
    }
    this.apply();
  }

  // Volume changes glide over a few milliseconds so they never click.
  private apply() {
    if (!this.ctx || !this.master || !this.sfx || !this.music) return;
    const s = this.settings;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master / 100, now, 0.02);
    this.sfx.gain.setTargetAtTime(s.effects / 100, now, 0.02);
    this.music.gain.setTargetAtTime((s.music / 100) * cfg.music.level, now, 0.05);
  }

  // Gains as they are right now, for the settings test.
  levels(): { master: number; effects: number; music: number } | null {
    if (!this.master || !this.sfx || !this.music) return null;
    const s = this.settings;
    return { master: s.muted ? 0 : s.master / 100, effects: s.effects / 100, music: (s.music / 100) * cfg.music.level };
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  // One shot effects. A sound can't repeat faster than its gap, and only a
  // few voices play at once, so a battle never turns into noise.
  play(name: Sound) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || this.settings.muted || !this.sfx) return;
    const spec = cfg.sounds[name];
    const now = performance.now();
    if (now - (this.last.get(name) ?? -Infinity) < spec.gap || this.voices >= cfg.maxVoices) return;
    this.last.set(name, now);
    this.played[name] = (this.played[name] ?? 0) + 1;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.sfx);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(spec.level, t + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, t + spec.length);
    const src = spec.noise ? this.noiseSource(ctx, spec.filter ?? 0) : ctx.createOscillator();
    if (src instanceof OscillatorNode) {
      src.type = spec.wave as OscillatorType;
      src.frequency.setValueAtTime(spec.from, t);
      src.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t + spec.length);
    }
    const node = src instanceof OscillatorNode ? src : src.node;
    (src instanceof OscillatorNode ? src : src.out).connect(out);
    this.voices++;
    node.onended = () => {
      this.voices--;
      out.disconnect();
    };
    node.start(t);
    node.stop(t + spec.length + 0.05);
  }

  private noiseSource(ctx: AudioContext, cutoff: number) {
    const node = ctx.createBufferSource();
    node.buffer = this.noise;
    if (!cutoff) return { node, out: node as AudioNode };
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    node.connect(filter);
    return { node, out: filter as AudioNode };
  }

  // A soft note every couple of seconds from a pentatonic scale. Young worlds
  // sit low and sparse; older ones climb; a disaster turns the scale minor.
  private playMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.music || this.settings.muted || !this.settings.music) return;
    const m = cfg.music;
    const scale = this.mood.danger ? m.minor : m.major;
    const lift = Math.min(m.maxLift, Math.floor(this.mood.year / m.yearsPerLift));
    this.step = (this.step + 1 + (this.step % 3 === 0 ? 2 : 0)) % scale.length;
    const semis = scale[this.step]! + lift;
    const freq = m.root * Math.pow(2, semis / 12);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + m.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + m.note);
    osc.connect(gain);
    gain.connect(this.music);
    osc.onended = () => gain.disconnect();
    osc.start(t);
    osc.stop(t + m.note + 0.05);
  }

  close() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

function loadSettingsFrom(s: AudioSettings): AudioSettings {
  return {
    master: clamp(s.master, DEFAULTS.master),
    effects: clamp(s.effects, DEFAULTS.effects),
    music: clamp(s.music, DEFAULTS.music),
    muted: !!s.muted,
  };
}

// One second of white noise, shared by every noisy sound.
function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // a fixed linear congruential sequence keeps this off Math.random
  let x = 12345;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (x / 0x3fffffff) - 1;
  }
  return buf;
}
