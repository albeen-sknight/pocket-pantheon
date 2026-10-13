// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Save file layout: "PPSV", a little endian u32 header length, a JSON header,
// then each tile field's raw bytes, 4 byte aligned. The whole thing is gzipped.
import { ENGINE, VERSION } from "../core/version";
import type { SimSnapshot } from "../sim/snapshot";
import { FIELDS, type Field, type World, type WorldOptions } from "../world/types";

// 1: tiles only. 2: adds the simulation (units, towns, buildings).
export const SAVE_VERSION = 2;
const MAGIC = [0x50, 0x50, 0x53, 0x56]; // PPSV

export interface SaveMeta {
  engine: string;
  version: string;
  saveVersion: number;
  created: string;
  name: string;
  seed: number;
  size: string;
  year: number;
}

interface Header {
  meta: SaveMeta;
  w: number;
  h: number;
  seaLevel: number;
  options: WorldOptions;
  fields: { name: Field; bytes: number }[];
  sim?: { json: SimSnapshot["json"]; arrays: { name: string; type: ArrType; bytes: number }[] };
}

type ArrType = "u8" | "u16" | "i32" | "f32";
type Arr = Uint8Array | Uint16Array | Int32Array | Float32Array;

const ARR = {
  u8: Uint8Array,
  u16: Uint16Array,
  i32: Int32Array,
  f32: Float32Array,
};

function arrType(a: Arr): ArrType {
  if (a instanceof Uint8Array) return "u8";
  if (a instanceof Uint16Array) return "u16";
  if (a instanceof Int32Array) return "i32";
  return "f32";
}

// Migrations from version N to N + 1, applied in order on load.
const migrations: Record<number, (header: Header) => Header> = {
  1: (h) => ({ ...h, meta: { ...h.meta, saveVersion: 2 } }), // a v1 save just has no sim yet
};

export function makeMeta(world: World, name: string, year = 0): SaveMeta {
  return {
    engine: ENGINE,
    version: VERSION,
    saveVersion: SAVE_VERSION,
    created: new Date().toISOString(),
    name,
    seed: world.options.seed,
    size: world.options.size,
    year,
  };
}

export function encodeWorld(world: World, meta: SaveMeta, sim?: SimSnapshot): Uint8Array {
  const fields = FIELDS.map((name) => ({ name, bytes: world[name].byteLength }));
  const simArrays = sim ? Object.entries(sim.arrays) : [];
  const header: Header = { meta, w: world.w, h: world.h, seaLevel: world.seaLevel, options: world.options, fields };
  if (sim) header.sim = { json: sim.json, arrays: simArrays.map(([name, a]) => ({ name, type: arrType(a), bytes: a.byteLength })) };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = align4(8 + json.length);
  const blobs: Arr[] = [...FIELDS.map((f) => world[f]), ...simArrays.map(([, a]) => a)];
  const total = blobs.reduce((sum, a) => sum + align4(a.byteLength), start);

  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let at = start;
  for (const arr of blobs) {
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), at);
    at += align4(arr.byteLength);
  }
  return out;
}

export function decodeWorld(bytes: Uint8Array): { world: World; meta: SaveMeta; sim?: SimSnapshot } {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("not a Pocket Pantheon save");
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  let header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as Header;
  if (header.meta.saveVersion > SAVE_VERSION) throw new Error("save comes from a newer version");
  for (let v = header.meta.saveVersion; v < SAVE_VERSION; v++) header = migrations[v]!(header);

  const n = header.w * header.h;
  const world: World = {
    w: header.w,
    h: header.h,
    seaLevel: header.seaLevel,
    options: header.options,
    height: new Float32Array(n),
    biome: new Uint8Array(n),
    flags: new Uint8Array(n),
    ore: new Uint8Array(n),
    fertility: new Uint8Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
  };
  let at = align4(8 + len);
  for (const f of header.fields) {
    const target = world[f.name];
    if (!target || target.byteLength !== f.bytes) throw new Error(`save field ${f.name} has the wrong size`);
    new Uint8Array(target.buffer).set(bytes.subarray(at, at + f.bytes));
    at += align4(f.bytes);
  }
  if (!header.sim) return { world, meta: header.meta };

  const arrays: SimSnapshot["arrays"] = {};
  for (const a of header.sim.arrays) {
    const Ctor = ARR[a.type];
    const copy = bytes.slice(at, at + a.bytes);
    arrays[a.name] = new Ctor(copy.buffer, 0, a.bytes / Ctor.BYTES_PER_ELEMENT);
    at += align4(a.bytes);
  }
  return { world, meta: header.meta, sim: { json: header.sim.json, arrays } };
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream("gzip"));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("gzip"));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function align4(n: number): number {
  return (n + 3) & ~3;
}
