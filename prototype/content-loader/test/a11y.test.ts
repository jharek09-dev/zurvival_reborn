import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { parseHex, contrastRatio, round2 } from "../src/a11y/color.js";
import { validateTokensCss, validatePalette, type A11yReport } from "../src/a11y/validate.js";
import { parseTokensCss } from "../src/a11y/tokens.js";

/**
 * T56 pt 2 — the accessibility palette gate (ACCESSIBILITY §11/§12 · NFR-ACC-01/03). Proves the WCAG maths
 * matches the §11 table, the shipped palette PASSES, and — the gate's teeth — a malformed palette (a body
 * token below AA, two indistinguishable hues, a CVD collapse) is REJECTED.
 */

const here = dirname(fileURLToPath(import.meta.url));
const realTokens = readFileSync(resolve(here, "..", "..", "..", "design", "tokens.css"), "utf8");
const badTokens = readFileSync(join(here, "fixtures", "bad-tokens.css"), "utf8");
const errs = (r: A11yReport) => r.issues.filter((i) => i.level === "error");

describe("WCAG contrast math (ACCESSIBILITY §11)", () => {
  it("matches the §11 table exactly", () => {
    const bg = parseHex("#0E0F10");
    expect(round2(contrastRatio(parseHex("#EDE7DB"), bg))).toBe(15.58); // --text (AAA)
    expect(round2(contrastRatio(parseHex("#8B8981"), bg))).toBe(5.48); // --muted (AA)
    expect(round2(contrastRatio(parseHex("#D84334"), bg))).toBe(4.36); // --danger (fails normal)
    expect(round2(contrastRatio(parseHex("#5C7A94"), bg))).toBe(4.26); // --info (fails normal)
    expect(round2(contrastRatio(parseHex("#FFFDF7"), bg))).toBe(18.86); // high-contrast --text
  });
  it("white on black is 21, and a colour on itself is 1", () => {
    expect(round2(contrastRatio(parseHex("#FFFFFF"), parseHex("#000000")))).toBe(21);
    expect(contrastRatio(parseHex("#123456"), parseHex("#123456"))).toBe(1);
  });
  it("parses #RGB shorthand and rejects non-hex", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(() => parseHex("rebeccapurple")).toThrow();
  });
});

describe("the shipped palette passes the a11y gate", () => {
  const r = validateTokensCss(realTokens);
  it("has zero errors", () => {
    expect(errs(r).map((i) => i.message).join("; ")).toBe("");
    expect(r.ok).toBe(true);
    expect(r.checked).toEqual({ contrastTokens: 9, cvdPairs: 15 });
  });
  it("surfaces the large-only lint for --danger and --info (never body copy)", () => {
    const msgs = r.issues.filter((i) => i.code === "large-only").map((i) => i.message);
    expect(msgs.some((m) => m.includes("--danger"))).toBe(true);
    expect(msgs.some((m) => m.includes("--info"))).toBe(true);
  });
  it("warns (never errors) on the warm-hue CVD convergence — the redundancy rule covers it", () => {
    const conv = r.issues.filter((i) => i.code === "cvd-convergent");
    expect(conv.length).toBeGreaterThan(0);
    expect(conv.every((i) => i.level === "warn")).toBe(true);
  });
});

describe("the gate has teeth — a malformed palette is REJECTED", () => {
  const r = validateTokensCss(badTokens);
  it("fails the gate (ok=false)", () => expect(r.ok).toBe(false));
  it("catches a body token dropped below AA-normal", () => expect(r.issues.some((i) => i.code === "body-below-aa")).toBe(true));
  it("catches two hues that are indistinguishable even under normal vision", () => expect(r.issues.some((i) => i.code === "hues-too-similar")).toBe(true));
  it("flags the contrast drift from the §11 table", () => expect(r.issues.some((i) => i.code === "contrast-drift")).toBe(true));
});

describe("CVD separation gate distinguishes a regression from the documented convergence", () => {
  const palette = (hope: string, info: string) => ({
    root: { bg: "#0E0F10", text: "#EDE7DB", "text-2": "#B7B3A9", muted: "#8B8981", accent: "#F2803A", warning: "#E0A33B", hope, infection: "#93A63E", danger: "#D84334", info },
    highContrast: { text: "#FFFDF7" },
  });
  it("ERRORS on a non-allowlisted pair that collapses under colour-blindness (yet is distinct normally)", () => {
    // #4E9A3A (green) vs #9A6A2A (brown): normal ΔE 55.8, min-CVD ΔE 7.0 — a real red-green collapse.
    const r = validatePalette(palette("#4E9A3A", "#9A6A2A"));
    expect(r.issues.some((i) => i.code === "cvd-collapse")).toBe(true);
    expect(r.ok).toBe(false);
  });
  it("does NOT error when the real hope/info are used (they stay separable under CVD)", () => {
    const r = validatePalette(palette("#5FB3A1", "#5C7A94"));
    expect(r.issues.filter((i) => i.code === "cvd-collapse")).toHaveLength(0);
    expect(r.ok).toBe(true);
  });
});

describe("tokens.css parsing", () => {
  it("splits :root from the high-contrast override and ignores non-hex tokens", () => {
    const t = parseTokensCss(realTokens);
    expect(t.root["text"]).toBe("#EDE7DB");
    expect(t.highContrast["text"]).toBe("#FFFDF7");
    expect(t.root["font-serif"]).toBeUndefined(); // type tokens carry no hex
    expect(t.root["accent-wash"]).toBeUndefined(); // rgba tints are not hex
  });
  it("skips a malformed 4/5-digit hex rather than extracting it (so parseHex never throws in the validator)", () => {
    const t = parseTokensCss(":root{--bg:#0E0F10;--text:#EDE7DB;--muted:#1234;--accent:#12345;}");
    expect(t.root["bg"]).toBe("#0E0F10");
    expect(t.root["text"]).toBe("#EDE7DB");
    expect(t.root["muted"]).toBeUndefined(); // 4-digit — skipped
    expect(t.root["accent"]).toBeUndefined(); // 5-digit — skipped
  });
});
