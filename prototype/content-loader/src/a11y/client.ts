/**
 * The CLIENT stylesheet lint (T63 · NFR-ACC-01/03/04 · ACCESSIBILITY §11 "encode … as a lint rule in the client").
 *
 * For two milestones the palette gate printed "--danger … never body copy (client lint enforces this)", and no
 * client lint existed anywhere. It mattered: the web client set the soundscape captions — FR-AUD-06's text
 * equivalent for every meaningful sound, critical information — in `--info`, measured in the browser at 3.94:1 on
 * the story card. The palette gate checks `design/tokens.css`, a file no player ever sees; this checks the sheet the
 * player actually gets (`prototype/harness/web/styles.css`) against it. Four rules, all pure:
 *
 *  1. **Token drift.** The client carries its own copy of the palette (it is a self-contained single file). EVERY
 *     custom property that holds a colour — wherever it is declared: `:root`, `html`, inside `@media`, a
 *     `[data-contrast="high"]` block however it is written — must equal the same token in tokens.css (the high-contrast
 *     value for a high-contrast block). The client may not invent a colour token, EXCEPT a high-contrast override of a
 *     text token tokens.css leaves alone, which must then clear AAA on `--bg` and be at least as strong as the token it
 *     overrides (a "high contrast" mode may never lower contrast). A colour written in a syntax this lint cannot
 *     measure (`hsl()`, `oklch()`, a named colour, 4/8-digit hex) is an error, not a pass.
 *  2. **Large-only hues are never a text colour.** `color`, `-webkit-text-fill-color` or `fill` resolving to `--danger`
 *     or `--info` is an error anywhere in the sheet — through `var()` in any spacing or case, with or without a
 *     fallback, through a custom property that aliases one of them (to any depth), or written out as the hue's hex or
 *     `rgb()`. A literal text colour the lint cannot compare is an error. The client has no large-text use for either
 *     hue, so the rule is the strict one: they may colour an edge, an outline, a background tint — never the words.
 *  3. **Text tokens on the surfaces they sit on.** Every body token (§11) must clear AA-normal on every READING
 *     surface (`--bg`, `--surface-1`, `--surface-2`), not just on `--bg` where §11 measures it. `--surface-3` is the
 *     hover / elevated surface: a token below AA there is reported as a WARNING naming the pair, and the rendered
 *     check (`web/a11y-check.mjs`, section E, which forces :hover) is what proves no such pair ships.
 *  4. **Motion has an off switch (NFR-ACC-04).** If the sheet moves at all — a `transition`, an `animation`,
 *     `@keyframes`, or `scroll-behavior: smooth` — it must contain a rule in exactly `@media (prefers-reduced-motion:
 *     reduce)` on the universal selector that sets `transition` and `animation` to `none !important`; and no rule
 *     OUTSIDE that block may declare a transition or animation `!important`, because a more specific `!important`
 *     rule beats the universal off switch. Nested rules (CSS nesting) are refused outright — this parser does not
 *     read inside them, and a lint that silently skips a block is not linting it.
 */

import { contrastRatio, parseHex, round2 } from "./color.js";
import type { A11yIssue } from "./validate.js";

export interface ClientReport {
  readonly ok: boolean;
  readonly issues: readonly A11yIssue[];
  readonly checked: { readonly tokens: number; readonly textRules: number; readonly surfacePairs: number; readonly motionRules: number };
}

export interface Rule {
  readonly selector: string;
  readonly media: string | null;
  readonly decls: readonly { readonly prop: string; readonly value: string }[];
  /** True when the rule's body itself contains a `{` — a nested rule this parser does not read inside. */
  readonly nested: boolean;
}

/** Strip comments, then walk braces: top-level rules, and rules nested inside at-rules (any depth). */
export function parseRules(css: string): { rules: Rule[]; keyframes: number } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let keyframes = 0;
  const walk = (text: string, media: string | null): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (/^@(-webkit-)?keyframes\b/i.test(head)) keyframes += 1;
      else if (head.startsWith("@")) walk(body, media === null ? head : `${media} ${head}`);
      else {
        const flat = body.replace(/\{[^{}]*\}/g, ";");
        const decls = flat.split(";").map((d) => d.trim()).filter((d) => d.includes(":")).map((d) => {
          const k = d.indexOf(":");
          return { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() };
        }).filter((d) => d.prop.length > 0 && !/[{}\s]/.test(d.prop));
        rules.push({ selector: head, media, decls, nested: body.includes("{") });
      }
      i = j;
    }
  };
  walk(src, null);
  return { rules, keyframes };
}

const MEASURABLE = /^(#(?:[0-9a-f]{3}|[0-9a-f]{6})|rgba?\(\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\))$/i;
const COLOURISH = /^(#[0-9a-f]+|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|color-mix\()/i;
const NAMED = /^(red|green|blue|white|black|gray|grey|orange|yellow|purple|teal|navy|maroon|olive|silver|aqua|fuchsia|lime|crimson|tomato|gold|pink|brown|transparent|currentcolor)$/i;
const norm = (v: string): string => v.replace(/!important/i, "").replace(/\s+/g, "").toLowerCase();
const isHighBlock = (selector: string): boolean => /\[\s*data-contrast\s*=\s*["']?high["']?\s*\]/i.test(selector);
const IMPORTANT = /!\s*important\s*$/i;

/** A measurable colour as [r, g, b] (alpha ignored — the tokens being compared are opaque), else null. */
function rgbOf(value: string): [number, number, number] | null {
  const v = value.replace(IMPORTANT, "").trim();
  if (/^#[0-9a-f]{3}$/i.test(v) || /^#[0-9a-f]{6}$/i.test(v)) {
    const c = parseHex(v);
    return [c.r, c.g, c.b];
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)/i.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function tokenBlock(rules: readonly Rule[], pick: (r: Rule) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rules) if (pick(r)) for (const d of r.decls) if (d.prop.startsWith("--")) out.set(d.prop.slice(2), d.value);
  return out;
}

/** The §11 body tokens — the ones allowed to set words. */
const BODY_TOKENS = ["text", "text-2", "muted", "accent", "warning", "hope", "infection"] as const;
const READING_SURFACES = ["bg", "surface-1", "surface-2"] as const;
const HOVER_SURFACES = ["surface-3"] as const;
const LARGE_ONLY = ["danger", "info"] as const;
const TEXT_PROPS = new Set(["color", "-webkit-text-fill-color", "fill"]);
export const AA = 4.5;
const AAA = 7;

/**
 * Lint the client stylesheet against the design tokens. `tokensCss` is `design/tokens.css`, `clientCss` the web
 * client's sheet. Pure; the CLI decides the exit code.
 */
export function validateClientCss(clientCss: string, tokensCss: string): ClientReport {
  const issues: A11yIssue[] = [];
  const err = (code: string, message: string): void => { issues.push({ level: "error", code, message }); };
  const warn = (code: string, message: string): void => { issues.push({ level: "warn", code, message }); };

  const client = parseRules(clientCss);
  const design = parseRules(tokensCss);
  const dRoot = tokenBlock(design.rules, (r) => r.media === null && r.selector.split(",").map((s) => s.trim()).includes(":root"));
  const dHigh = tokenBlock(design.rules, (r) => r.media === null && isHighBlock(r.selector));
  const hex = (v: string | undefined): string | null => (v !== undefined && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : null);
  const bgHex = dRoot.get("bg");

  for (const r of client.rules) {
    if (r.nested) err("client-nested-rule", `${r.selector} contains a nested rule — the client lint does not read inside CSS nesting, so the sheet may not use it`);
  }
  if (!client.rules.some((r) => r.media === null && r.selector.split(",").map((s) => s.trim()).includes(":root") && r.decls.some((d) => d.prop.startsWith("--")))) {
    err("client-no-root", "the client stylesheet declares no :root tokens");
  }

  // 1. Token drift — every colour-valued custom property, wherever it is declared.
  let tokens = 0;
  const declaredRoot = new Set<string>();
  for (const r of client.rules) {
    const high = isHighBlock(r.selector);
    for (const d of r.decls) {
      if (!d.prop.startsWith("--")) continue;
      const name = d.prop.slice(2);
      const value = d.value.replace(IMPORTANT, "").trim();
      if (/^var\(/i.test(value)) continue; // an alias — rule 2 resolves it
      const colourish = COLOURISH.test(value) || NAMED.test(value);
      if (!colourish) continue;
      tokens += 1;
      const where = `${r.selector}${r.media ? ` (in ${r.media})` : ""}`;
      if (!MEASURABLE.test(value)) { err("client-unmeasurable-colour", `--${name}: ${d.value} in ${where} is a colour this lint cannot measure — write it as #rrggbb or rgb()/rgba()`); continue; }
      if (!high) declaredRoot.add(name);
      const want = high ? (dHigh.get(name) ?? null) : (dRoot.get(name) ?? null);
      if (want !== null) {
        if (norm(want) !== norm(value)) err("client-token-drift", `${high ? "high-contrast " : ""}--${name} is ${value} in ${where} but ${want} in tokens.css`);
        continue;
      }
      if (!high) { err("client-invented-colour", `--${name}: ${value} in ${where} is a colour token tokens.css does not define — add it there first`); continue; }
      const base = hex(dRoot.get(name));
      const over = hex(value);
      if (base === null || over === null || bgHex === undefined) { err("client-invented-colour", `high-contrast --${name}: ${value} overrides no hex token in tokens.css`); continue; }
      const before = contrastRatio(parseHex(base), parseHex(bgHex));
      const after = contrastRatio(parseHex(over), parseHex(bgHex));
      if (after < AAA) err("client-hc-below-aaa", `high-contrast --${name} (${round2(after)}) must clear AAA (${AAA}) on --bg`);
      if (after < before) err("client-hc-lowers-contrast", `high-contrast --${name} (${round2(after)}) is LOWER contrast than the standard token (${round2(before)})`);
    }
  }
  for (const [name, want] of dRoot) {
    if (MEASURABLE.test(want.trim()) && ([...BODY_TOKENS, ...LARGE_ONLY, ...READING_SURFACES, ...HOVER_SURFACES] as readonly string[]).includes(name) && !declaredRoot.has(name)) {
      err("client-token-missing", `the client does not declare --${name} (tokens.css: ${want})`);
    }
  }

  // 2. Large-only hues never colour words. First, which custom properties alias a large-only hue (to any depth).
  const refs = (value: string): string[] => [...value.matchAll(/var\(\s*--([\w-]+)/gi)].map((m) => m[1]!.toLowerCase());
  const aliasOf = new Map<string, string>(); // custom property → the large-only token it resolves to
  for (const t of LARGE_ONLY) aliasOf.set(t, t);
  const defs: { name: string; value: string }[] = client.rules.flatMap((r) => r.decls.filter((d) => d.prop.startsWith("--")).map((d) => ({ name: d.prop.slice(2).toLowerCase(), value: d.value })));
  for (let pass = 0, grew = true; grew && pass < 16; pass += 1) {
    grew = false;
    for (const { name, value } of defs) {
      if (aliasOf.has(name)) continue;
      const hit = refs(value).find((x) => aliasOf.has(x));
      if (hit !== undefined) { aliasOf.set(name, aliasOf.get(hit)!); grew = true; }
    }
  }
  const largeRgb = LARGE_ONLY.map((t) => [t, rgbOf(dRoot.get(t) ?? "")] as const);
  let textRules = 0;
  for (const r of client.rules) {
    for (const d of r.decls) {
      if (!TEXT_PROPS.has(d.prop)) continue;
      textRules += 1;
      const where = `${r.selector}${r.media ? ` (in ${r.media})` : ""}`;
      const via = refs(d.value).find((x) => aliasOf.has(x));
      if (via !== undefined) {
        const t = aliasOf.get(via)!;
        err("client-large-only-as-text", `${where} sets ${d.prop}: ${d.value} — ${via === t ? `--${t}` : `--${via}, an alias of --${t},`} is below AA-normal and may colour an edge or a tint, never words`);
        continue;
      }
      const literal = d.value.replace(IMPORTANT, "").trim();
      if (/^var\(/i.test(literal) || /^(inherit|initial|unset|revert|currentcolor|transparent)$/i.test(literal)) continue;
      const rgb = rgbOf(literal);
      if (rgb === null) { err("client-unmeasurable-colour", `${where} sets ${d.prop}: ${d.value} — a literal text colour this lint cannot measure; use a token`); continue; }
      for (const [t, h] of largeRgb) {
        if (h !== null && h.every((c, k) => Math.round(c) === Math.round(rgb[k]!))) {
          err("client-large-only-as-text", `${where} sets ${d.prop}: ${d.value} — that is --${t}, written out`);
        }
      }
    }
  }

  // 3. Body tokens on the surfaces they sit on.
  let surfacePairs = 0;
  for (const t of BODY_TOKENS) {
    const th = hex(dRoot.get(t));
    if (th === null) continue;
    for (const s of [...READING_SURFACES, ...HOVER_SURFACES]) {
      const sh = hex(dRoot.get(s));
      if (sh === null) continue;
      surfacePairs += 1;
      const ratio = contrastRatio(parseHex(th), parseHex(sh));
      if (ratio >= AA) continue;
      if ((READING_SURFACES as readonly string[]).includes(s)) err("client-body-below-aa-on-surface", `--${t} is ${round2(ratio)}:1 on --${s}, a reading surface — below AA-normal (${AA})`);
      else warn("surface-hover-pair", `--${t} is ${round2(ratio)}:1 on --${s} (hover / elevated) — never set words in --${t} on it; the rendered check forces :hover to prove none ships`);
    }
  }

  // 4. Motion has an off switch, and nothing outranks it.
  const REDUCE = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i;
  const inReduce = (r: Rule): boolean => r.media !== null && REDUCE.test(r.media.trim());
  const movesDecl = (d: { prop: string; value: string }): boolean =>
    (/^(transition|animation)(-|$)/.test(d.prop) && !/^none\b/i.test(d.value) && !/^0s?\b/i.test(d.value)) ||
    (d.prop === "scroll-behavior" && /^smooth\b/i.test(d.value));
  const moving = client.rules.filter((r) => !inReduce(r) && r.decls.some(movesDecl));
  const offSwitch = client.rules.filter((r) => inReduce(r) && r.selector.split(",").map((s) => s.trim()).includes("*"));
  const kills = (p: string): boolean => offSwitch.some((r) => r.decls.some((d) => d.prop === p && /^none\s*!\s*important$/i.test(d.value)));
  if (moving.length > 0 || client.keyframes > 0) {
    if (!kills("transition") || !kills("animation")) {
      err("client-motion-no-off-switch", `the sheet moves (${moving.map((r) => r.selector).join(", ") || `${client.keyframes} @keyframes`}) but has no rule in exactly @media (prefers-reduced-motion: reduce) setting BOTH transition and animation to "none !important" on *`);
    }
  }
  for (const r of client.rules) {
    if (inReduce(r)) continue;
    for (const d of r.decls) {
      if (/^(transition|animation)(-|$)/.test(d.prop) && IMPORTANT.test(d.value) && !/^none\b/i.test(d.value)) {
        err("client-motion-outranks-off-switch", `${r.selector} declares ${d.prop}: ${d.value} — an !important motion rule more specific than * beats the reduced-motion off switch`);
      }
    }
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    checked: { tokens, textRules, surfacePairs, motionRules: moving.length },
  };
}
