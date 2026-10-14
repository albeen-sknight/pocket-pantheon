// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Save slots in IndexedDB. Every call can fail (private mode, quota, blocked
// storage), so callers get a rejected promise and show a toast.
import type { SimSnapshot } from "../sim/snapshot";
import type { World } from "../world/types";
import { decodeWorld, encodeWorld, gunzip, gzip, makeMeta, type SaveMeta } from "./format";

const DB = "pocket-pantheon";
const STORE = "saves";

export type SlotId = "auto" | "1" | "2" | "3";

interface SlotRecord {
  slot: SlotId;
  meta: SaveMeta;
  data: Uint8Array;
}

let ppDb: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  ppDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "slot" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  ppDb.catch(() => (ppDb = null));
  return ppDb;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listSlots(): Promise<Map<SlotId, SaveMeta>> {
  const all = await run<SlotRecord[]>("readonly", (s) => s.getAll());
  return new Map(all.map((r) => [r.slot, r.meta]));
}

export interface Loaded {
  world: World;
  sim?: SimSnapshot;
}

export async function saveSlot(slot: SlotId, world: World, name: string, year = 0, sim?: SimSnapshot): Promise<SaveMeta> {
  const meta = makeMeta(world, name, year);
  const data = await gzip(encodeWorld(world, meta, sim));
  await run("readwrite", (s) => s.put({ slot, meta, data } satisfies SlotRecord));
  return meta;
}

export async function loadSlot(slot: SlotId): Promise<Loaded | null> {
  const rec = await run<SlotRecord | undefined>("readonly", (s) => s.get(slot));
  if (!rec) return null;
  return decodeWorld(await gunzip(rec.data));
}

export async function exportFile(world: World, name: string, year: number, sim?: SimSnapshot): Promise<Blob> {
  const data = await gzip(encodeWorld(world, makeMeta(world, name, year), sim));
  return new Blob([data as BlobPart], { type: "application/octet-stream" });
}

export async function importFile(file: Blob): Promise<Loaded> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeWorld(await gunzip(bytes));
}
