import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { validateClientCss, parseRules, AA } from "../src/a11y/client.js";
import { contrastRatio, parseHex } from "../src/a11y/color.js";

/**
 * T63 — the client stylesheet lint (NFR-ACC-01/03/04). The palette gate said "client lint enforces this" for two
 * milestones and there was no client lint. These tests prove the shipped sheet passes, that each rule fails on
 * exactly the defect it names (one mutation of the REAL sheet per rule, so a rule cannot pass vacuously), that the
 * ways a real stylesheet could dodge a rule are caught, and that the sheet as it shipped before T63 is rejected: five
 * real defects, plus the motion rule it fails only because T63's off switch is stricter than the one it had.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const tokens = readFileSync(join(repo, "design", "tokens.css"), "utf8");
const client = readFileSync(join(repo, "prototype", "harness", "web", "styles.css"), "utf8");
const preT63 = readFileSync(join(here, "fixtures", "bad-client.css"), "utf8");
const codes = (css: string, t = tokens): string[] => validateClientCss(css, t).issues.filter((i) => i.level === "error").map((i) => i.code);

/** Replace exactly one occurrence — a mutation that silently matched nothing would make the test vacuous. */
function mutate(src: string, from: string, to: string): string {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor ${JSON.stringify(from)} occurs ${n} times`);
  return src.replace(from, to);
}

describe("the shipped web client sheet passes the client lint", () => {
  const r = validateClientCss(client, tokens);
  it("has zero errors", () => {
    expect(r.issues.filter((i) => i.level === "error").map((i) => i.message)).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("checked every colour token, every text-colour declaration, the surface matrix and the motion", () => {
    const declared = [...client.matchAll(/--[\w-]+:\s*(#[0-9A-Fa-f]{3,6}|rgba?\([^)]*\))/g)].length;
    expect(r.checked.tokens).toBe(declared);
    const colourDecls = parseRules(client).rules.flatMap((x) => x.decls).filter((d) => d.prop === "color" || d.prop === "-webkit-text-fill-color").length;
    expect(r.checked.textRules).toBe(colourDecls);
    expect(r.checked.surfacePairs).toBe(7 * 4);
    // recomputed from the parsed sheet, not bounded: rules outside the reduced-motion block that declare motion
    const moving = parseRules(client).rules.filter((x) => !/prefers-reduced-motion/.test(x.media ?? "") &&
      x.decls.some((d) => /^(transition|animation)/.test(d.prop) && !/^none/.test(d.value))).length;
    expect(moving).toBe(1); // the toast's fade
    expect(r.checked.motionRules).toBe(moving);
  });
  it("names the one sub-AA hover pair as a warning, not an error", () => {
    const w = r.issues.filter((i) => i.code === "surface-hover-pair");
    expect(w.map((i) => i.level)).toEqual(["warn"]);
    expect(w[0]!.message).toContain("--muted is 4.2:1 on --surface-3");
  });
});

describe("each rule fails on exactly its defect", () => {
  it("token drift — a client hex that differs from tokens.css", () => {
    expect(codes(mutate(client, "--text-2:#B7B3A9", "--text-2:#B7B3A8"))).toEqual(["client-token-drift"]);
  });
  it("token drift — in the high-contrast block too", () => {
    expect(codes(mutate(client, '[data-contrast="high"]{ --text:#FFFDF7;', '[data-contrast="high"]{ --text:#FFFDF6;'))).toEqual(["client-token-drift"]);
  });
  it("an invented colour token", () => {
    expect(codes(mutate(client, "--line-strong:#3A3D45;", "--line-strong:#3A3D45; --blood-2:#AA0000;"))).toEqual(["client-invented-colour"]);
  });
  it("a missing body or surface token", () => {
    expect(codes(mutate(client, " --hope:#5FB3A1;", ""))).toEqual(["client-token-missing"]);
  });
  it("a high-contrast override that is not AAA, or that LOWERS contrast", () => {
    expect(codes(mutate(client, "--text-2:#D9D5CC;", "--text-2:#9A968D;"))).toEqual(["client-hc-below-aaa", "client-hc-lowers-contrast"]);
  });
  it("--info as a text colour", () => {
    expect(codes(mutate(client, ".soundscape li{ color:var(--text-2);", ".soundscape li{ color:var(--info);"))).toEqual(["client-large-only-as-text"]);
  });
  it("--danger as a text colour, even written as its literal hex", () => {
    expect(codes(mutate(client, ".ended h2{ margin:0 0 var(--s2); font-family:var(--font-serif); color:var(--text);", ".ended h2{ margin:0 0 var(--s2); font-family:var(--font-serif); color:#D84334;"))).toEqual(["client-large-only-as-text"]);
  });
  it("…but the same hues on an EDGE, an outline or a tint are fine", () => {
    const edges = client + "\n.x{ border-left:3px solid var(--info); outline:2px solid var(--danger); background:var(--danger-wash); }";
    expect(codes(edges)).toEqual([]);
    expect(codes(edges + "\n.y{ color:var(--info); }")).toEqual(["client-large-only-as-text"]); // and the same sheet still has teeth
  });
  it("a body token that falls below AA on a reading surface (tokens.css changed)", () => {
    const darker = mutate(tokens, "--surface-2:    #1E2024;", "--surface-2:    #4A4D55;");
    const clientDarker = mutate(client, "--surface-2:#1E2024;", "--surface-2:#4A4D55;");
    expect(codes(clientDarker, darker)).toContain("client-body-below-aa-on-surface");
  });
  it("the AA threshold is 4.5 exactly — a pair between 4.3 and 4.5 on a reading surface fails", () => {
    expect(AA).toBe(4.5);
    // pick a surface for --muted (#8B8981) that lands in [4.3, 4.5): the check must call it below AA
    const surface = "#222429"; // --muted on it: 4.43:1
    const ratio = contrastRatio(parseHex("#8B8981"), parseHex(surface));
    expect(ratio).toBeGreaterThanOrEqual(4.3);
    expect(ratio).toBeLessThan(4.5);
    const t = mutate(tokens, "--surface-2:    #1E2024;", `--surface-2:    ${surface};`);
    const c = mutate(client, "--surface-2:#1E2024;", `--surface-2:${surface};`);
    expect(codes(c, t)).toEqual(["client-body-below-aa-on-surface"]);
  });
  it("motion with no off switch — dropping `animation:none` alone is enough to fail", () => {
    expect(codes(mutate(client, " animation:none !important;", ""))).toEqual(["client-motion-no-off-switch"]);
  });
  it("motion with an off switch that is not !important", () => {
    expect(codes(mutate(client, "transition:none !important;", "transition:none;"))).toEqual(["client-motion-no-off-switch"]);
  });
  it("the off switch must be on the universal selector, in exactly the reduced-motion query", () => {
    expect(codes(mutate(client, "*, *::before, *::after{ transition:none !important;", ".choice{ transition:none !important;"))).toEqual(["client-motion-no-off-switch"]);
    expect(codes(mutate(client, "@media (prefers-reduced-motion: reduce){", "@media (prefers-reduced-motion: reduce) and (min-width:99999px){"))).toEqual(["client-motion-no-off-switch"]);
  });
  it("a more specific !important motion rule, which would beat the off switch, is refused", () => {
    expect(codes(client + "\n#toast{ transition:opacity 3s !important; }")).toEqual(["client-motion-outranks-off-switch"]);
  });
  it("smooth scrolling counts as motion", () => {
    const still = mutate(mutate(client, "transition:opacity .2s;", ""), "@media (prefers-reduced-motion: reduce){", "@media (min-width: 1px){");
    expect(codes(still)).toEqual([]);
    expect(codes(still + "\nhtml{ scroll-behavior:smooth; }")).toEqual(["client-motion-no-off-switch"]);
  });
  it("a @keyframes needs the off switch even with no transition declared", () => {
    const still = mutate(client, "transition:opacity .2s;", "");
    const noSwitch = mutate(still, "@media (prefers-reduced-motion: reduce){", "@media (min-width: 1px){");
    expect(codes(noSwitch)).toEqual([]);
    expect(codes(noSwitch + "\n@keyframes flicker{ from{opacity:1} to{opacity:.4} }")).toEqual(["client-motion-no-off-switch"]);
  });
});

describe("the ways a stylesheet could dodge the large-only rule are all caught", () => {
  const dodge = (css: string): string[] => codes(client + "\n" + css);
  it.each([
    ["spaces inside var()", ".a{ color: var( --info ); }"],
    ["a fallback", ".a{ color: var(--info, #fff); }"],
    ["upper case", ".a{ color: VAR(--INFO); }"],
    ["!important", ".a{ color: var(--danger) !important; }"],
    ["an alias", ":root{ --caption: var(--info); } .a{ color: var(--caption); }"],
    ["an alias of an alias", ".z{ --c1: var(--danger); --c2: var(--c1); } .a{ color: var(--c2); }"],
    ["the hex written out", ".a{ color: #5c7a94; }"],
    ["rgb()", ".a{ color: rgb(92, 122, 148); }"],
    ["rgba() with alpha", ".a{ color: rgba(216,67,52,1); }"],
    ["-webkit-text-fill-color", ".a{ -webkit-text-fill-color: var(--info); }"],
    ["fill (SVG text)", ".a{ fill: var(--danger); }"],
    ["inside @media", "@media (min-width: 1px){ .a{ color: var(--info); } }"],
  ])("%s", (_label, css) => {
    expect(dodge(css)).toContain("client-large-only-as-text");
  });
  it("a text colour the lint cannot measure is refused rather than passed", () => {
    expect(dodge(".a{ color: hsl(208 23% 47%); }")).toEqual(["client-unmeasurable-colour"]);
    expect(dodge(".a{ color: #5C7A94FF; }")).toEqual(["client-unmeasurable-colour"]);
  });
  it("CSS nesting is refused outright — the lint does not read inside it", () => {
    expect(dodge(".a{ .p{ color: var(--info); } }")).toContain("client-nested-rule");
  });
});

describe("token overrides are checked wherever they are declared", () => {
  const drift = (css: string): string[] => codes(client + "\n" + css);
  it.each([
    ["inside @media", "@media (min-width: 1px){ :root{ --text: #FFFFFF; } }", "client-token-drift"],
    ["on html", "html{ --text-2: #C0C0C0; }", "client-token-drift"],
    ["a high-contrast block written :root[data-contrast=high]", ':root[data-contrast="high"]{ --text: #FFFFFF; }', "client-token-drift"],
    ["an invented token on another selector", ".x{ --blood-3: #990000; }", "client-invented-colour"],
    ["hsl()", ":root{ --text: hsl(40 30% 90%); }", "client-unmeasurable-colour"],
    ["oklch()", ".x{ --glow: oklch(0.7 0.1 50); }", "client-unmeasurable-colour"],
    ["an 8-digit hex", ":root{ --text: #EDE7DBFF; }", "client-unmeasurable-colour"],
  ])("%s", (_label, css, code) => {
    expect(drift(css)).toContain(code);
  });
});

describe("the web client sheet as it shipped before T63 is rejected", () => {
  it("for its five real defects, and for the stricter motion rule", () => {
    const r = validateClientCss(preT63, tokens);
    const errs = r.issues.filter((i) => i.level === "error");
    expect(errs.map((i) => i.code).sort()).toEqual([
      "client-large-only-as-text", "client-large-only-as-text", "client-large-only-as-text", "client-large-only-as-text",
      "client-motion-no-off-switch", "client-token-drift",
    ]);
    const text = errs.map((i) => i.message).join("\n");
    expect(text).toContain(".soundscape sets color: var(--info)"); // FR-AUD-06's captions, 3.94:1 in the browser
    expect(text).toContain("--danger-wash");
    // The motion error is T63's stricter rule, not a defect the old sheet shipped: it already had a reduced-motion
    // transition kill switch and no animations; it fails only because the switch did not also cover `animation`.
    expect(preT63).toMatch(/prefers-reduced-motion: reduce\)\{ \*\{ transition:none !important; \} \}/);
    expect(parseRules(preT63).keyframes).toBe(0);
  });
});

describe("the rule parser", () => {
  it("strips comments, reads nested @media rules and counts @keyframes", () => {
    const { rules, keyframes } = parseRules("/* a{color:red} */ b{color:var(--x)} @media (x){ c{ transition: all 1s } } @keyframes k{ from{opacity:0} }");
    expect(rules.map((r) => [r.selector, r.media])).toEqual([["b", null], ["c", "@media (x)"]]);
    expect(keyframes).toBe(1);
  });
});
