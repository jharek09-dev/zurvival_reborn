/**
 * Assemble the single-file, self-contained browser-playable client.
 *
 *   node build-html.mjs <bundle.js> <contentDir> <out.html>
 *
 * Inlines: (1) the esbuild IIFE bundle (global `Zurvival`), (2) CONTENT built from content/*.json,
 * (3) styles.css, (4) ui.js. No external requests — everything lives in the one file. (The run is never stored;
 * since T63 the reader settings are, in localStorage — see ui.js `loadSettings`.)
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
  projects: loadPool("projects"),
  endings: loadPool("endings"),
  stands: loadPool("stands"),
};

const guardScript = (s) => s.replace(/<\/script/gi, "<\\/script");
const contentJson = JSON.stringify(CONTENT).replace(/</g, "\u003c");

// T63 (NFR-ACC-02): landmarks, a real heading outline, and ONE announcer. Before T63 the whole scene card was
// an aria-live region that was emptied and refilled every turn, so a screen reader (Orca, verified) spoke the
// status, the soundscape and the story interleaved out of order; now focus moves to the scene heading and the
// announcer speaks one ordered digest (ui.js `announceTurn`). The scene <section> is deliberately NOT a named region:
// named by its own heading, Orca said the day, time and place twice on every turn ("region Day 1 … / Day 1 … heading");
// the heading outline already lets a reader jump to it, and the choices keep their named region.
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
<a class="skip" href="#scene-title">Skip to the scene</a>
<a class="skip" href="#choices-title">Skip to your choices</a>
<div id="app">
  <header id="topbar">
    <div class="bar">
      <h1 class="brand">Zurvival Reborn</h1>
      <p class="meta" id="meta"></p>
      <div class="topctl">
        <button type="button" class="btn" id="btn-new">New run</button>
        <button type="button" class="btn" id="btn-save">Save</button>
        <button type="button" class="btn" id="btn-load">Load</button>
        <button type="button" class="btn" id="btn-settings">Settings</button>
      </div>
    </div>
    <p class="mode" id="mode"></p>
  </header>
  <main id="stage">
    <section id="scene"></section>
    <section id="choices-wrap" aria-labelledby="choices-title"></section>
  </main>
  <nav id="screens" aria-label="Depth screens"></nav>
</div>
<div id="modal-root"></div>
<div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="toast" role="status" aria-live="polite" aria-atomic="true"></div>
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
