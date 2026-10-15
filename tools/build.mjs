// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Builds dist/: the landing page at the root and the game in dist/play/.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { writeIcons } from "./icons.mjs";
import { buildSingle, FONTS } from "./single.mjs";

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
  const gen = await bundle("src/world/gen.worker.ts", dev);
  const sim = await bundle("src/sim/sim.worker.ts", dev);
  const main = await bundle("src/main.ts", dev, { PP_GEN_WORKER: JSON.stringify(gen), PP_SIM_WORKER: JSON.stringify(sim) });
  const html = await readFile(root + "site/play/index.html", "utf8");
  await writeFile(out + "play/index.html", html.replace("__PP_MAIN__", main));
  await cp(root + "node_modules/coi-serviceworker/coi-serviceworker.min.js", out + "play/coi-serviceworker.min.js");
  return { main, gen, sim };
}

// The two fonts ship with the site, so nothing loads from a font service.
async function copyFonts() {
  await mkdir(out + "fonts", { recursive: true });
  await cp(root + "site/fonts.css", out + "fonts.css");
  for (const [, , path] of FONTS) await cp(root + "node_modules/" + path, out + "fonts/" + basename(path));
}

export async function buildSite({ dev = false } = {}) {
  await rm(out, { recursive: true, force: true, maxRetries: 5 });
  await mkdir(out + "play", { recursive: true });
  const [en, es] = await Promise.all([readText("en"), readText("es")]);
  await buildLanding(en, es);
  const files = await buildGame(dev);
  await copyFonts();
  const iconBuild = await build({
    entryPoints: [root + "src/render/appIcon.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "warning",
  });
  const iconModule = await import(`data:text/javascript;base64,${Buffer.from(iconBuild.outputFiles[0].text).toString("base64")}`);
  await writeIcons(out, iconModule.appIcon());
  await cp(root + "site/manifest.webmanifest", out + "manifest.webmanifest");
  await cp(root + "site/share-preview.png", out + "share-preview.png");
  await buildSingle(root, out, files);
  await writeFile(out + ".nojekyll", "");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = performance.now();
  await buildSite();
  console.log(`built dist/ in ${Math.round(performance.now() - t)} ms`);
}
