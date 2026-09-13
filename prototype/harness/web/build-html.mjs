/**
 * Assemble the single-file, self-contained browser-playable client.
 *
 *   node build-html.mjs <bundle.js> <contentDir> <out.html>
 *
 * Inlines: (1) the esbuild IIFE bundle (global `Zurvival`), (2) CONTENT built from content/*.json,
 * (3) styles.css, (4) ui.js. No external requests, no localStorage — everything lives in the one file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [bundlePath, contentDir, outHtml] = process.argv.slice(2);
if (!bundlePath || !contentDir || !outHtml) {
  console.error("usage: node build-html.mjs <bundle.js> <contentDir> <out.html>");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "styles.css"), "utf8");
const ui = fs.readFileSync(path.join(here, "ui.js"), "utf8");
const bundle = fs.readFileSync(bundlePath, "utf8");

const loadPool = (sub) =>
  fs.readdirSync(path.join(contentDir, sub))
    .filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(contentDir, sub, f), "utf8")));

// The pools the full-city beta registers (mirrors playCli.ts). `signals` <- content/radio.
const CONTENT = {
  regions: loadPool("regions"),
  nodes: loadPool("nodes"),
  npcs: loadPool("npcs"),
  encounters: loadPool("encounters"),
  signals: loadPool("radio"),
  recipes: loadPool("recipes"),
  jobs: loadPool("jobs"),
  factions: loadPool("factions"),
  weapons: loadPool("weapons"),
};

const guardScript = (s) => s.replace(/<\/script/gi, "<\\/script");
const contentJson = JSON.stringify(CONTENT).replace(/</g, "\u003c");

const SKELETON = `<!doctype html>
<html lang="en" data-contrast="normal">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Zurvival Reborn — Playable Beta</title>
<style>__CSS__</style>
</head>
<body>
<div id="app">
  <header id="topbar">
    <div class="bar">
      <div class="meta" id="meta"></div>
      <div class="topctl">
        <button class="btn" id="btn-new" title="Start a new run (N)">New</button>
        <button class="btn" id="btn-save" title="Save this run">Save</button>
        <button class="btn" id="btn-load" title="Load a saved run">Load</button>
        <button class="btn ghost iconbtn" id="btn-contrast" aria-label="Toggle high contrast" title="High contrast">◐</button>
        <button class="btn ghost iconbtn" id="btn-text" aria-label="Cycle larger text" title="Larger text">A+</button>
      </div>
    </div>
    <div class="mode" id="mode"></div>
  </header>
  <main id="stage">
    <div id="pane" role="region" aria-live="polite" aria-label="Scene"></div>
    <div id="choices" aria-label="Choices"></div>
  </main>
  <nav id="screens" aria-label="Depth screens"></nav>
</div>
<div id="modal-root"></div>
<noscript>This playable beta needs JavaScript enabled.</noscript>
<script>__BUNDLE__</script>
<script>window.CONTENT=__CONTENT__;</script>
<script>__UI__</script>
</body>
</html>
`;

const html = SKELETON
  .replace("__CSS__", () => css)
  .replace("__BUNDLE__", () => guardScript(bundle))
  .replace("__CONTENT__", () => contentJson)
  .replace("__UI__", () => guardScript(ui));

fs.writeFileSync(outHtml, html);
const counts = Object.fromEntries(Object.entries(CONTENT).map(([k, v]) => [k, v.length]));
console.log("Wrote " + outHtml + "  (" + (fs.statSync(outHtml).size / 1024).toFixed(1) + " KiB)");
console.log("Pools: " + JSON.stringify(counts));
