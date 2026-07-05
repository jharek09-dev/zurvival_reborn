/**
 * Content schema gate — CLI (M0 task T8 · DESIGN §8 · PRD FR-CNT-02, QA §5 M0 exit).
 *
 * The single command CI runs to guarantee "volume can never corrupt a run": it loads the
 * whole `content/` tree through `loadContent` (the same door the engine uses) and exits
 * non-zero the moment anything is malformed — bad JSON, a schema violation, a duplicate id,
 * or a populated type with no schema. Green means every content file is valid against its
 * JSON Schema; red blocks the merge.
 *
 * Usage:
 *   node --import tsx src/validateCli.ts [contentDir]
 * `contentDir` defaults to the repo's `content/` (three levels up from this file:
 * prototype/content-loader/src → repo root → content).
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadContent, ContentValidationError } from "./loadContent.js";

/** Default to `<repo>/content` when no path is given (prototype/content-loader/src → root). */
function defaultContentDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "content");
}

function main(argv: readonly string[]): number {
  const contentDir = argv[2] ? resolve(argv[2]) : defaultContentDir();
  process.stdout.write(`Content schema gate — validating ${contentDir}\n`);

  try {
    const registry = loadContent(contentDir);
    const types = Object.keys(registry);
    const entries = types.reduce((n, t) => n + Object.keys(registry[t]!).length, 0);
    process.stdout.write(
      `✓ content OK — ${entries} entr${entries === 1 ? "y" : "ies"} across ` +
        `${types.length} type${types.length === 1 ? "" : "s"} ` +
        `(${types.join(", ") || "none"})\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof ContentValidationError) {
      process.stderr.write(`✗ content schema gate FAILED — ${err.issues.length} issue(s):\n`);
      for (const i of err.issues) {
        process.stderr.write(`  [${i.type || "tree"}] ${i.file}: ${i.message}\n`);
      }
    } else {
      process.stderr.write(`✗ content schema gate errored: ${err instanceof Error ? err.stack : err}\n`);
    }
    return 1;
  }
}

process.exit(main(process.argv));
