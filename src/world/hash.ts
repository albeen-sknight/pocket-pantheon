// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { FIELDS, type World } from "./types";

// FNV-1a over every tile field. Used by the determinism check (PLAN section 22).
export function worldHash(world: World): string {
  let h = 0x811c9dc5;
  for (const field of FIELDS) {
    const arr = world[field];
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
