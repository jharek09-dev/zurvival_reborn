/**
 * Bundle the web entry into one IIFE global `Zurvival` for the browser-playable client.
 *
 * The engine/harness use explicit `.js` extensions in their ESM imports, but the sources are `.ts`;
 * esbuild won't rewrite `./x.js` -> `./x.ts` on its own, so a tiny resolver plugin does. Pure bundle,
 * no game logic here.
 *
 *   node build-web.mjs [outfile] [--minify] [--node]
 *     default  -> browser IIFE global `Zurvival`
 *     --node   -> Node ESM (named exports), for the determinism-parity test
 */
import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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
      return; // fall through to esbuild's own resolver (errors loudly if truly missing)
    });
  },
};

const args = process.argv.slice(2);
const asNode = args.includes("--node");
const minify = args.includes("--minify");
const outfile = args.find((a) => !a.startsWith("--")) || path.resolve(process.cwd(), asNode ? "zurvival-node.mjs" : "zurvival-bundle.js");

await esbuild.build({
  entryPoints: [path.join(here, "webEntry.ts")],
  bundle: true,
  format: asNode ? "esm" : "iife",
  globalName: asNode ? undefined : "Zurvival",
  platform: asNode ? "node" : "browser",
  target: asNode ? "node18" : "es2020",
  legalComments: "none",
  minify,
  outfile,
  plugins: [resolveTs],
  logLevel: "warning",
});

const bytes = fs.statSync(outfile).size;
console.log(`Built ${outfile}  (${(bytes / 1024).toFixed(1)} KiB, node=${asNode}, minify=${minify})`);
