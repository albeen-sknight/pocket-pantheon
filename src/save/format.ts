// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Save file layout: "PPSV", a little endian u32 header length, a JSON header,
// then each tile field's raw bytes, 4 byte aligned. The whole thing is gzipped.
import { ENGINE, VERSION } from "../core/version";
import { FIELDS, type Field, type World, type WorldOptions } from "../world/types";

export const SAVE_VERSION = 1;
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
}

// Migrations from version N to N + 1, applied in order on load.
const migrations: Record<number, (header: Header) => Header> = {};

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

export function encodeWorld(world: World, meta: SaveMeta): Uint8Array {
  const fields = FIELDS.map((name) => ({ name, bytes: world[name].byteLength }));
  const header: Header = { meta, w: world.w, h: world.h, seaLevel: world.seaLevel, options: world.options, fields };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = align4(8 + json.length);
  const total = fields.reduce((sum, f) => sum + align4(f.bytes), start);

  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let at = start;
  for (const f of fields) {
    const arr = world[f.name];
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), at);
    at += align4(f.bytes);
  }
  return out;
}

export function decodeWorld(bytes: Uint8Array): { world: World; meta: SaveMeta } {
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
  return { world, meta: header.meta };
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
