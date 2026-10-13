// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Builds dist/: the landing page at the root and the game in dist/play/.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = root + "dist/";
const pkg = JSON.parse(await readFile(root + "package.json", "utf8"));

async function readText(lang) {
  return JSON.parse(await readFile(root + `data/text/${lang}.json`, "utf8"));
}

async function buildLanding(en, es) {
  const html = await readFile(root + "site/index.html", "utf8");
  const text = JSON.stringify({ en: en.landing, es: es.landing });
  if (!html.includes("/*PP_TEXT*/{}")) throw new Error("site/index.html lost its /*PP_TEXT*/{} marker");
  await writeFile(out + "index.html", html.replace("/*PP_TEXT*/{}", () => text));
}

async function bundle(entry, dev, define = {}) {
  const result = await build({
    entryPoints: [root + entry],
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: !dev,
    sourcemap: dev,
    entryNames: "[name].[hash]",
    outdir: out + "play",
    metafile: true,
    define: { PP_VERSION: JSON.stringify(pkg.version), ...define },
    logLevel: "warning",
  });
  return basename(Object.keys(result.metafile.outputs).find((f) => f.endsWith(".js")));
}

async function buildGame(dev) {
  const worker = await bundle("src/world/gen.worker.ts", dev);
  const main = await bundle("src/main.ts", dev, { PP_GEN_WORKER: JSON.stringify(worker) });
  const html = await readFile(root + "site/play/index.html", "utf8");
  await writeFile(out + "play/index.html", html.replace("__PP_MAIN__", main));
  await cp(root + "node_modules/coi-serviceworker/coi-serviceworker.min.js", out + "play/coi-serviceworker.min.js");
}

export async function buildSite({ dev = false } = {}) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out + "play", { recursive: true });
  const [en, es] = await Promise.all([readText("en"), readText("es")]);
  await buildLanding(en, es);
  await buildGame(dev);
  await writeFile(out + ".nojekyll", "");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = performance.now();
  await buildSite();
  console.log(`built dist/ in ${Math.round(performance.now() - t)} ms`);
}
