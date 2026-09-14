/**
 * Assemble the single-file Test Lab page.
 *
 *   node web/build.mjs [out.html] [--minify] [--content DIR]
 *
 * 1. esbuild bundles `src/entry.ts` (engine + harness renderers + the Test Lab core) into one IIFE that
 *    exposes the global `ZL` — the same resolve-`.js`→`.ts` plugin the harness's `web/build-web.mjs` uses.
 * 2. The shipped content pools (`content/*.json`, `signals` <- radio) are inlined as `window.CONTENT`,
 *    exactly as `harness/web/build-html.mjs` does.
 * 3. `testlab.css` and `testlab.js` are inlined. No external requests, no CDN — the file works from
 *    `file://`, offline, by double-click.
 *
 * Output defaults to `dist/zurvival-testlab.html` (gitignored).
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const args = process.argv.slice(2);
const minify = args.includes("--minify");
const contentIdx = args.indexOf("--content");
const contentDir = contentIdx !== -1 && args[contentIdx + 1] ? path.resolve(args[contentIdx + 1]) : path.resolve(pkg, "..", "..", "content");
const outHtml = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--content") || path.join(pkg, "dist", "zurvival-testlab.html");

/** Resolve relative ".js" ESM specifiers to their real ".ts" (or "/index.ts") source. */
const resolveTs = {
  name: "resolve-ts",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === "entry-point" || !a.path.startsWith(".")) return;
      let p = path.resolve(a.resolveDir, a.path);
      if (p.endsWith(".js")) p = p.slice(0, -3);
      for (const c of [p + ".ts", p + ".tsx", path.join(p, "index.ts")]) {
        if (fs.existsSync(c)) return { path: c };
      }
      return;
    });
  },
};

const bundle = await esbuild.build({
  entryPoints: [path.join(pkg, "src", "entry.ts")],
  bundle: true,
  format: "iife",
  globalName: "ZL",
  platform: "browser",
  target: "es2020",
  legalComments: "none",
  minify,
  write: false,
  plugins: [resolveTs],
  logLevel: "warning",
});
const bundleJs = bundle.outputFiles[0].text;

const loadPool = (sub) =>
  fs.readdirSync(path.join(contentDir, sub))
    .filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(contentDir, sub, f), "utf8")));
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
};

const css = fs.readFileSync(path.join(here, "testlab.css"), "utf8");
const ui = fs.readFileSync(path.join(here, "testlab.js"), "utf8");
const skeleton = fs.readFileSync(path.join(here, "testlab.html"), "utf8");

const guardScript = (s) => s.replace(/<\/script/gi, "<\\/script");
const contentJson = JSON.stringify(CONTENT).replace(/</g, "<");
const built = new Date().toISOString();

const html = skeleton
  .replace("__CSS__", () => css)
  .replace("__BUNDLE__", () => guardScript(bundleJs))
  .replace("__CONTENT__", () => contentJson)
  .replace("__BUILT__", () => built)
  .replace("__UI__", () => guardScript(ui));

fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, html);
const counts = Object.fromEntries(Object.entries(CONTENT).map(([k, v]) => [k, v.length]));
console.log(`Wrote ${outHtml}  (${(fs.statSync(outHtml).size / 1024).toFixed(1)} KiB, minify=${minify})`);
console.log("Pools: " + JSON.stringify(counts));
