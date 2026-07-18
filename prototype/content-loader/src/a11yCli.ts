/**
 * Accessibility palette gate — CLI (M4 task T56 pt 2 · ACCESSIBILITY §11/§12 · NFR-ACC-01/03).
 *
 * The command CI runs to guarantee the design palette stays accessible: it reads `design/tokens.css` and
 * exits non-zero the moment a contrast or colour-blindness invariant is violated — a body-text token dropping
 * below AA, a contrast drift from the ACCESSIBILITY §11 table, or two hues collapsing under colour-blindness
 * outside the documented warm-cluster allow-list. Green means the palette is WCAG-conformant and CVD-legible;
 * red blocks the merge. Warnings (the large-only lint, the expected warm-hue CVD convergence) print but do not
 * fail. Mirrors the content schema gate (`validateCli.ts`).
 *
 * Usage:
 *   node --import tsx src/a11yCli.ts [tokens.css]
 * Defaults to `<repo>/design/tokens.css`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateTokensCss } from "./a11y/validate.js";

function defaultTokensPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // prototype/content-loader/src
  return resolve(here, "..", "..", "..", "design", "tokens.css");
}

function main(argv: readonly string[]): number {
  const tokensPath = argv[2] ? resolve(argv[2]) : defaultTokensPath();
  process.stdout.write(`Accessibility palette gate — validating ${tokensPath}\n`);

  let css: string;
  try {
    css = readFileSync(tokensPath, "utf8");
  } catch (err) {
    process.stderr.write(`✗ a11y gate errored: cannot read ${tokensPath}: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }

  let report;
  try {
    report = validateTokensCss(css);
  } catch (err) {
    process.stderr.write(`✗ a11y gate errored: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }

  const errors = report.issues.filter((i) => i.level === "error");
  const warns = report.issues.filter((i) => i.level === "warn");
  for (const w of warns) process.stdout.write(`  ⚠ [${w.code}] ${w.message}\n`);

  if (report.ok) {
    process.stdout.write(
      `✓ palette OK — ${report.checked.contrastTokens} contrast tokens vs §11, ` +
        `${report.checked.cvdPairs} hue pairs CVD-checked, ${warns.length} warning(s)\n`,
    );
    return 0;
  }
  process.stderr.write(`✗ a11y palette gate FAILED — ${errors.length} error(s):\n`);
  for (const e of errors) process.stderr.write(`  [${e.code}] ${e.message}\n`);
  return 1;
}

process.exit(main(process.argv));
