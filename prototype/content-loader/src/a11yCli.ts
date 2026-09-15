/**
 * Accessibility palette gate — CLI (M4 task T56 pt 2 · T63 · ACCESSIBILITY §11/§12 · NFR-ACC-01/03/04).
 *
 * The command CI runs to guarantee the design palette stays accessible: it reads `design/tokens.css` and
 * exits non-zero the moment a contrast or colour-blindness invariant is violated — a body-text token dropping
 * below AA, a contrast drift from the ACCESSIBILITY §11 table, or two hues collapsing under colour-blindness
 * outside the documented warm-cluster allow-list. Green means the palette is WCAG-conformant and CVD-legible;
 * red blocks the merge. Warnings (the large-only lint, the expected warm-hue CVD convergence) print but do not
 * fail. Mirrors the content schema gate (`validateCli.ts`).
 *
 * T63 adds the CLIENT lint (`a11y/client.ts`) over the stylesheet the player actually receives: token drift from
 * tokens.css, `--danger`/`--info` never as a text colour, body tokens on every reading surface, and a
 * reduced-motion off switch for any motion.
 *
 * Usage:
 *   node --import tsx src/a11yCli.ts [tokens.css] [--client <styles.css>]
 * Defaults to `<repo>/design/tokens.css` and `<repo>/prototype/harness/web/styles.css`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateTokensCss } from "./a11y/validate.js";
import { validateClientCss } from "./a11y/client.js";

const here = dirname(fileURLToPath(import.meta.url)); // prototype/content-loader/src
const repo = resolve(here, "..", "..", "..");

function main(argv: readonly string[]): number {
  const rest = argv.slice(2);
  const ci = rest.indexOf("--client");
  const clientPath = ci !== -1 && rest[ci + 1] ? resolve(rest[ci + 1]!) : resolve(repo, "prototype", "harness", "web", "styles.css");
  const positional = rest.filter((a, i) => a !== "--client" && (ci === -1 || i !== ci + 1));
  const tokensPath = positional[0] ? resolve(positional[0]) : resolve(repo, "design", "tokens.css");
  process.stdout.write(`Accessibility palette gate — validating ${tokensPath}\n`);

  let css: string;
  let clientCss: string;
  try {
    css = readFileSync(tokensPath, "utf8");
    clientCss = readFileSync(clientPath, "utf8");
  } catch (err) {
    process.stderr.write(`✗ a11y gate errored: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }

  let report;
  let client;
  try {
    report = validateTokensCss(css);
    client = validateClientCss(clientCss, css);
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
  } else {
    process.stderr.write(`✗ a11y palette gate FAILED — ${errors.length} error(s):\n`);
    for (const e of errors) process.stderr.write(`  [${e.code}] ${e.message}\n`);
  }

  process.stdout.write(`Client stylesheet lint — validating ${clientPath}\n`);
  const cErrors = client.issues.filter((i) => i.level === "error");
  const cWarns = client.issues.filter((i) => i.level === "warn");
  for (const w of cWarns) process.stdout.write(`  ⚠ [${w.code}] ${w.message}\n`);
  if (client.ok) {
    process.stdout.write(
      `✓ client OK — ${client.checked.tokens} colour tokens match tokens.css, ${client.checked.textRules} text-colour ` +
        `declarations linted, ${client.checked.surfacePairs} token/surface pairs, ${client.checked.motionRules} moving rule(s) behind reduced-motion, ` +
        `${cWarns.length} warning(s)\n`,
    );
  } else {
    process.stderr.write(`✗ client stylesheet lint FAILED — ${cErrors.length} error(s):\n`);
    for (const e of cErrors) process.stderr.write(`  [${e.code}] ${e.message}\n`);
  }
  return report.ok && client.ok ? 0 : 1;
}

process.exit(main(process.argv));
