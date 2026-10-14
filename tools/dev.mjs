// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Local server for dist/. Rebuilds when src, site or data change.
import { createServer } from "node:http";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const port = Number(process.env.PORT) || 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

let pending = null;
async function rebuild() {
  if (pending) return;
  pending = setTimeout(async () => {
    try {
      await buildSite({ dev: true });
      console.log("rebuilt");
    } catch (err) {
      console.error(err.message);
    }
    pending = null;
  }, 80);
}

async function serve(req, res) {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.endsWith("/") || path.endsWith("\\")) path += "index.html";
  const file = join(dist, path);
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

await buildSite({ dev: true });
for (const dir of ["src", "site", "data"]) watch(join(root, dir), { recursive: true }, rebuild);
createServer(serve).listen(port, () => console.log(`dev server on http://localhost:${port}/`));
