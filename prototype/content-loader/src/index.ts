export {
  loadContent,
  ContentValidationError,
  type ContentIssue,
  type ContentEntry,
  type ContentRegistry,
} from "./loadContent.js";

// The accessibility palette gate — contrast + colourblind validation of design/tokens.css (T56 pt 2 · NFR-ACC-01/03)
export { validatePalette, validateTokensCss, type A11yReport, type A11yIssue } from "./a11y/validate.js";
export { parseTokensCss, type PaletteTokens } from "./a11y/tokens.js";
export {
  parseHex,
  contrastRatio,
  relativeLuminance,
  hexToLab,
  hexToCvdLab,
  deltaE76,
  round2,
  CVD_TYPES,
  type Rgb,
  type CvdType,
} from "./a11y/color.js";
