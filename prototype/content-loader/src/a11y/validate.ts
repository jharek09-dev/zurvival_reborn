/**
 * The accessibility palette gate (M4 task T56 pt 2 · ACCESSIBILITY §11/§12 · NFR-ACC-01/03).
 *
 * Validates `design/tokens.css` against the ACCESSIBILITY §11 contrast table and proves the rationed hues
 * stay colour-vision-deficiency (CVD) safe. Three checks, all pure:
 *
 *  1. **Contrast (the §11 table as tests).** Each text/semantic token's WCAG ratio vs `--bg` must match the
 *     documented §11 value; every *body-safe* token must clear AA-normal (≥ 4.5) and the high-contrast
 *     `--text` must clear AAA (≥ 7). A body token dropping below AA is an ERROR (a readability regression).
 *  2. **The lint rule.** `--danger`/`--info` are below AA-normal (4.36 / 4.26) — confirmed as a fact and
 *     surfaced as the policy the client lint enforces: large text / icons / edges only, never body copy.
 *  3. **Colourblind (NFR-ACC-03).** The six rationed hues must be clearly distinct under NORMAL vision
 *     (ΔE ≥ 20); under protanopia/deuteranopia/tritanopia the warm hues converge (that is *why* the colorway
 *     rule is "colour is never the sole signal" — every hue paired with a label/icon), so a known set of
 *     warm-cluster pairs is allow-listed and reported as a WARNING; any NEW CVD collapse is an ERROR
 *     (a regression that would add a hue the redundancy rule doesn't already cover).
 *
 * The gate reads the design tokens only; it touches no engine or content, so it cannot affect a run.
 *
 * Scope note: check 1 pins each token's contrast *ratio* (and CVD ΔE for the hues), not its exact hex — a
 * contrast-preserving hue change to a *neutral* text token (`--text`/`--text-2`/`--muted`, which carry no
 * CVD backstop) would pass. That is deliberate (the gate's remit is legibility, not brand fidelity); the
 * drift message tells the author to update the §11 table + this gate together on any intentional change.
 */

import { parseHex, contrastRatio, round2, hexToLab, hexToCvdLab, deltaE76, CVD_TYPES } from "./color.js";
import { parseTokensCss, type PaletteTokens } from "./tokens.js";

export interface A11yIssue {
  readonly level: "error" | "warn";
  readonly code: string;
  readonly message: string;
}

export interface A11yReport {
  readonly ok: boolean;
  readonly issues: readonly A11yIssue[];
  readonly checked: { readonly contrastTokens: number; readonly cvdPairs: number };
}

/** WCAG normal-text thresholds. */
const AA_NORMAL = 4.5;
const AAA_NORMAL = 7.0;
/** Contrast-drift tolerance vs the documented §11 ratio (rounding + hex-vs-computed slack). */
const CONTRAST_TOL = 0.06;

/**
 * The ACCESSIBILITY §11 contrast table (against `--bg` #0E0F10), encoded as tests. `role` is how the token
 * may be used: `body` must clear AA-normal; `large-only` is deliberately below it (icons/edges/large text).
 */
const CONTRAST_TABLE: readonly { token: string; ratio: number; role: "body" | "large-only" }[] = [
  { token: "text", ratio: 15.58, role: "body" },
  { token: "text-2", ratio: 9.17, role: "body" },
  { token: "muted", ratio: 5.48, role: "body" },
  { token: "accent", ratio: 7.24, role: "body" },
  { token: "warning", ratio: 8.65, role: "body" },
  { token: "hope", ratio: 7.72, role: "body" },
  { token: "infection", ratio: 7.09, role: "body" },
  { token: "danger", ratio: 4.36, role: "large-only" },
  { token: "info", ratio: 4.26, role: "large-only" },
];
/** The high-contrast (`[data-contrast="high"]`) `--text` override must clear AAA. */
const HC_TEXT_RATIO = 18.86;

/** The six rationed semantic hues checked for CVD separability. */
const SEMANTIC_HUES = ["accent", "danger", "infection", "hope", "info", "warning"] as const;
/** Distinctness thresholds (CIE76 ΔE): clearly distinct under normal vision; "glanceable" under CVD. */
const NORMAL_MIN_DE = 20;
const CVD_MIN_DE = 11;
/**
 * Warm hues that converge under red-green CVD — expected, and covered by the colorway's "colour never the
 * sole signal" rule (every hue paired with a label/icon). A NEW pair outside this set collapsing is a
 * regression. (Derived from the shipped palette; see docs/qa/QA_REVIEW_M4_PART13.md.)
 */
const KNOWN_CVD_CONVERGENT: ReadonlySet<string> = new Set([
  "accent/warning",
  "infection/warning",
  "accent/infection",
  "danger/infection",
]);

const pairKey = (a: string, b: string): string => [a, b].sort().join("/");

/** Run the palette a11y gate over parsed tokens. Pure — returns a report; the CLI decides the exit code. */
export function validatePalette(tokens: PaletteTokens): A11yReport {
  const issues: A11yIssue[] = [];
  const { root, highContrast } = tokens;
  const bgHex = root["bg"];
  if (bgHex === undefined) {
    return { ok: false, issues: [{ level: "error", code: "no-bg", message: "--bg is missing from the palette" }], checked: { contrastTokens: 0, cvdPairs: 0 } };
  }
  const bg = parseHex(bgHex);

  // 1 + 2. Contrast table + the large-only lint.
  for (const row of CONTRAST_TABLE) {
    const hex = root[row.token];
    if (hex === undefined) {
      issues.push({ level: "error", code: "missing-token", message: `--${row.token} is missing from the palette` });
      continue;
    }
    const ratio = round2(contrastRatio(parseHex(hex), bg));
    if (Math.abs(ratio - row.ratio) > CONTRAST_TOL) {
      issues.push({
        level: "error",
        code: "contrast-drift",
        message: `--${row.token} contrast is ${ratio} vs the §11 table's ${row.ratio} — if this hex change is intentional, update tokens.css, ACCESSIBILITY.md §11, and this gate together`,
      });
    }
    if (row.role === "body" && ratio < AA_NORMAL) {
      issues.push({ level: "error", code: "body-below-aa", message: `--${row.token} (${ratio}) is body-text-safe per §11 but no longer clears AA-normal (${AA_NORMAL}) — a readability regression` });
    }
    if (row.role === "large-only") {
      if (ratio >= AA_NORMAL) {
        issues.push({ level: "warn", code: "lint-may-relax", message: `--${row.token} (${ratio}) now clears AA-normal — the large-only-never-body lint could relax` });
      } else {
        issues.push({ level: "warn", code: "large-only", message: `--${row.token} (${ratio}) is below AA-normal — large text / icons / edges only, never body copy (client lint enforces this)` });
      }
    }
  }

  // High-contrast --text must clear AAA.
  const hcText = highContrast["text"];
  if (hcText === undefined) {
    issues.push({ level: "warn", code: "no-hc-text", message: `no [data-contrast="high"] --text override found` });
  } else {
    const ratio = round2(contrastRatio(parseHex(hcText), bg));
    if (Math.abs(ratio - HC_TEXT_RATIO) > CONTRAST_TOL) {
      issues.push({ level: "error", code: "contrast-drift", message: `high-contrast --text is ${ratio} vs the §11 table's ${HC_TEXT_RATIO}` });
    }
    if (ratio < AAA_NORMAL) {
      issues.push({ level: "error", code: "hc-below-aaa", message: `high-contrast --text (${ratio}) must clear AAA (${AAA_NORMAL})` });
    }
  }

  // 3. Colourblind separability.
  const present = SEMANTIC_HUES.filter((h) => root[h] !== undefined);
  let cvdPairs = 0;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i]!;
      const b = present[j]!;
      cvdPairs++;
      const key = pairKey(a, b);
      const normalDe = deltaE76(hexToLab(root[a]!), hexToLab(root[b]!));
      if (normalDe < NORMAL_MIN_DE) {
        issues.push({ level: "error", code: "hues-too-similar", message: `--${a} and --${b} are too similar even under normal vision (ΔE ${round2(normalDe)} < ${NORMAL_MIN_DE}) — they cannot be told apart` });
        continue; // a normal-vision collapse dominates; don't also warn on CVD
      }
      const cvdDe = Math.min(...CVD_TYPES.map((t) => deltaE76(hexToCvdLab(root[a]!, t), hexToCvdLab(root[b]!, t))));
      if (cvdDe < CVD_MIN_DE) {
        if (KNOWN_CVD_CONVERGENT.has(key)) {
          issues.push({ level: "warn", code: "cvd-convergent", message: `--${a}/--${b} converge under colour-blindness (min ΔE ${round2(cvdDe)}) — relies on the "colour never the sole signal" rule (a paired label/icon)` });
        } else {
          issues.push({ level: "error", code: "cvd-collapse", message: `--${a} and --${b} collapse under colour-blindness (min ΔE ${round2(cvdDe)} < ${CVD_MIN_DE}) and are NOT in the documented warm-cluster allow-list — a CVD regression` });
        }
      }
    }
  }

  return { ok: !issues.some((i) => i.level === "error"), issues, checked: { contrastTokens: CONTRAST_TABLE.length, cvdPairs } };
}

/** Convenience: parse the CSS and validate in one call. */
export function validateTokensCss(css: string): A11yReport {
  return validatePalette(parseTokensCss(css));
}
