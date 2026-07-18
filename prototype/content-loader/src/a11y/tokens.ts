/**
 * Parse `design/tokens.css` into the palette the a11y gate validates (M4 task T56 pt 2).
 *
 * The gate reads the machine source of truth (`tokens.css`) directly, so a colour change there is what the
 * gate checks — no hand-copied hex. Extracts the `:root` token hexes and the `[data-contrast="high"]`
 * overrides; ignores the rgba tint/`--*-wash` tokens and the type/spacing tokens (only `#hex` values matter).
 */

export interface PaletteTokens {
  /** `:root` token → hex (e.g. `text` → `#EDE7DB`). */
  readonly root: Readonly<Record<string, string>>;
  /** `[data-contrast="high"]` overrides → hex. */
  readonly highContrast: Readonly<Record<string, string>>;
}

// Exactly 3- or 6-digit hex only — a malformed 4/5-digit value is SKIPPED here (so a required token then
// surfaces as `missing-token`/`no-bg`) rather than extracted and thrown on by parseHex in the validator.
const HEX_TOKEN = /--([\w-]+):\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\b/g;

function extract(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(HEX_TOKEN)) out[m[1]!] = m[2]!;
  return out;
}

/**
 * Parse the token CSS. The `[data-contrast="high"]` block (if present) is split off so its `--text` override
 * is captured separately from the `:root` `--text`. Throws if there is no `:root` palette at all.
 */
export function parseTokensCss(css: string): PaletteTokens {
  const hcIdx = css.indexOf('[data-contrast="high"]');
  const rootPart = hcIdx === -1 ? css : css.slice(0, hcIdx);
  const hcPart = hcIdx === -1 ? "" : css.slice(hcIdx);
  const root = extract(rootPart);
  if (Object.keys(root).length === 0) throw new Error("no palette tokens found (is this design/tokens.css?)");
  return { root, highContrast: extract(hcPart) };
}
