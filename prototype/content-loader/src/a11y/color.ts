/**
 * Colour math for the accessibility gate (M4 task T56 pt 2 · ACCESSIBILITY §11/§12 · NFR-ACC-01/03).
 *
 * Pure, dependency-free colour utilities: sRGB hex parsing, WCAG 2.x relative luminance + contrast ratio,
 * CIELAB conversion + CIE76 ΔE, and Machado-2009 colour-vision-deficiency (CVD) simulation. Used by the
 * palette validator to check `design/tokens.css` against the ACCESSIBILITY §11 contrast table and to prove
 * the rationed hues stay distinguishable under protanopia / deuteranopia / tritanopia. No I/O, no state.
 */

export interface Rgb {
  readonly r: number; // 0–255
  readonly g: number;
  readonly b: number;
}

/** Parse a `#RGB` or `#RRGGBB` hex string. Throws on anything else (a malformed token fails the gate). */
export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

/** sRGB 0–255 channel → linear 0–1 (the WCAG / CIE gamma-decode). */
function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB colour (0–1). */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG 2.x contrast ratio between two colours (1–21). Symmetric; order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Round a contrast ratio to 2 dp (for readable reports / stable comparisons with the §11 table). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

// --- CIELAB + ΔE (perceptual distance, for the CVD separation check) ------------------------

interface Lab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** Linear-RGB (0–1) → CIE XYZ (D65). */
function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  return [
    0.4124 * r + 0.3576 * g + 0.1805 * b,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    0.0193 * r + 0.1192 * g + 0.9505 * b,
  ];
}

const D65 = { Xn: 0.95047, Yn: 1.0, Zn: 1.08883 };
const labF = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function xyzToLab(X: number, Y: number, Z: number): Lab {
  const fx = labF(X / D65.Xn);
  const fy = labF(Y / D65.Yn);
  const fz = labF(Z / D65.Zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** sRGB hex → CIELAB. */
export function hexToLab(hex: string): Lab {
  const c = parseHex(hex);
  const [X, Y, Z] = linearRgbToXyz(toLinear(c.r), toLinear(c.g), toLinear(c.b));
  return xyzToLab(X, Y, Z);
}

/** CIE76 ΔE between two Lab colours (the straight-line perceptual distance). */
export function deltaE76(p: Lab, q: Lab): number {
  return Math.sqrt((p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2);
}

// --- CVD simulation (Machado, Oliveira & Fernandes 2009, severity 1.0) ----------------------

export type CvdType = "protanopia" | "deuteranopia" | "tritanopia";

/** Machado-2009 severity-1.0 matrices, applied to LINEAR RGB. */
const CVD_MATRIX: { readonly [k in CvdType]: readonly [number, number, number, number, number, number, number, number, number] } = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Simulate how a colour appears under a dichromacy, returning the CIELAB of the perceived colour. */
export function hexToCvdLab(hex: string, cvd: CvdType): Lab {
  const c = parseHex(hex);
  const [r, g, b] = [toLinear(c.r), toLinear(c.g), toLinear(c.b)];
  const m = CVD_MATRIX[cvd];
  const rr = clamp01(m[0] * r + m[1] * g + m[2] * b);
  const gg = clamp01(m[3] * r + m[4] * g + m[5] * b);
  const bb = clamp01(m[6] * r + m[7] * g + m[8] * b);
  const [X, Y, Z] = linearRgbToXyz(rr, gg, bb);
  return xyzToLab(X, Y, Z);
}

export const CVD_TYPES: readonly CvdType[] = ["protanopia", "deuteranopia", "tritanopia"];
