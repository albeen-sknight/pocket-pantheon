// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Folds the built game into one offline file, dist/pocketpantheon.html
// (PLAN section 23): scripts, workers, fonts and the icon all inline, so it
// runs from a double click with no server and no network.
import { readFile, writeFile } from "node:fs/promises";

export const FONTS = [
  ["Pixelify Sans", 500, "@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff2"],
  ["Pixelify Sans", 700, "@fontsource/pixelify-sans/files/pixelify-sans-latin-700-normal.woff2"],
  ["Outfit", 400, "@fontsource/outfit/files/outfit-latin-400-normal.woff2"],
  ["Outfit", 600, "@fontsource/outfit/files/outfit-latin-600-normal.woff2"],
];

// A script body can't contain "</script" inside an inline tag.
function inlineSafe(code, name) {
  const clean = code.replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  if (/<\/script/i.test(clean)) throw new Error(`${name} contains </script and can't be inlined`);
  return clean;
}

function replaceOnce(text, find, replacement, what) {
  if (!text.includes(find)) throw new Error(`single file: ${what} not found`);
  return text.replace(find, () => replacement);
}

export async function buildSingle(root, out, files) {
  const read = (path) => readFile(out + path, "utf8");
  let html = await read("play/index.html");
  let main = inlineSafe(await read(`play/${files.main}`), files.main);
  const gen = inlineSafe(await read(`play/${files.gen}`), files.gen);
  const sim = inlineSafe(await read(`play/${files.sim}`), files.sim);

  // Workers start from Blob URLs made from text kept in the page.
  const blob = (id) => `URL.createObjectURL(new Blob([document.getElementById(${JSON.stringify(id)}).textContent],{type:"text/javascript"}))`;
  main = replaceOnce(main, JSON.stringify(files.gen), blob("pp-gen-worker"), "gen worker name");
  main = replaceOnce(main, JSON.stringify(files.sim), blob("pp-sim-worker"), "sim worker name");

  const faces = [];
  for (const [family, weight, path] of FONTS) {
    const data = (await readFile(root + "node_modules/" + path)).toString("base64");
    faces.push(`@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2")}`);
  }
  const icon = (await readFile(out + "favicon.svg")).toString("base64");

  // No service worker (file pages can't have one), no manifest, no web fonts.
  html = html.replace(/<script src="coi-serviceworker\.min\.js"><\/script>\n?/, "");
  html = html.replace(/<link rel="(apple-touch-icon|manifest)"[^>]*>/g, "");
  html = html.replace(/<link rel="icon"[^>]*>/g, "");
  html = replaceOnce(html, '<link rel="stylesheet" href="../fonts.css">', `<link rel="icon" href="data:image/svg+xml;base64,${icon}"><style>${faces.join("")}</style>`, "fonts link");
  html = html.replace(/<a href="\.\.\/" id="back"[^>]*><\/a>/, "");
  html = replaceOnce(
    html,
    `<script src="${files.main}"></script>`,
    `<script type="text/plain" id="pp-gen-worker">${gen}</script>\n<script type="text/plain" id="pp-sim-worker">${sim}</script>\n<script>${main}</script>`,
    "main script tag",
  );
  await writeFile(out + "pocketpantheon.html", html);
}
