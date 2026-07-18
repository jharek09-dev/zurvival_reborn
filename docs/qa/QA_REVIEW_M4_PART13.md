# QA Review — M4 Part 13 (T56 pt 2/2 · NFR-ACC accessibility baseline)

**Scope:** complete the NFR-ACC baseline (NFR-ACC-01…04) at the **M4 tier** — the FR-AUD-06 cue-redundancy
matrix (tracked + tested), a palette contrast + colourblind CI gate over `design/tokens.css`, the
consolidated NFR-ACC-01 acceptance, and the completed ACCESSIBILITY.md checklist — honestly deferring the
M5 web-client-runtime items. This is the second half of T56; with it shipped, **T56 → done**.

**Verdict:** ✅ Ship. Zero BLOCKERs. Two-subagent adversarial audit (engineering + design) with a verify
pass; all actionable findings fixed. **Byte-identity holds by construction** — nothing in
`prototype/engine/src` or `content/` is edited (`diff -r` of both vs the pre-part-2 baseline is empty), so
every engine golden and the cross-tree `saveGame` proof hold; the work is harness + a content-loader
validation tool + docs.

## Architecture verified

- **FR-AUD-06 cue-redundancy matrix** (harness): `prototype/harness/src/cueMatrix.ts` enumerates every
  meaningful sound cue the T55 soundscape emits (48 cues across the five layers) → its text equivalent,
  cross-referenced to its AUDIO section. `cueMatrix.test.ts` proves each surfaces (a scenario triggers each)
  AND — the **drift guard** — that every line the soundscape can emit maps back to a matrix entry, so no cue
  can slip in untracked. `renderCueMatrix()` emits `docs/reference/AUDIO_CUE_MATRIX.md`. Cues the AUDIO bible
  names but the soundscape does not yet produce are recorded in `DEFERRED_CUES` (→ M5), so the requirement
  *tracks* the gap rather than implying none. The captions are the only channel (no separate audio track), so
  redundancy is structural; a sound-off player reads what a hearing player hears.
- **Palette a11y gate** (content-loader): `src/a11y/{color,tokens,validate}.ts` + CLI `src/a11yCli.ts` +
  `npm run validate:a11y`, wired into CI (a gate step + a malformed-rejected step, mirroring the schema
  gate). Pure colour math (WCAG contrast, CIELAB ΔE, Machado-2009 CVD). It reads `design/tokens.css`
  directly, so a colour change there is what it checks.
- **NFR-ACC-01 acceptance** consolidated in `accessibility.test.ts`; `ACCESSIBILITY.md` §0 status block + 10
  ticks + Appendix A M4 row done.

## CI (clean cloud sandbox)

- engine typecheck + test — **580 (+0, untouched)**
- content-loader typecheck + test — **23** (+14: `a11y.test.ts`); schema gate `validate` — 160 / 13;
  **a11y gate `validate:a11y` — palette OK**; both malformed checks reject
- harness typecheck + test — **232** (+57: `cueMatrix.test.ts` 54 + `accessibility.test.ts` +3);
  `npm start` smoke exit 0
- **Byte-identity by construction:** `diff -r prototype/engine/src` and `diff -r content` vs the pre-part-2
  baseline are **both empty**.

## NFR-ACC-01…04 → evidence

| Requirement | Status | Evidence |
| --- | --- | --- |
| **NFR-ACC-01** — no colour/audio-only info (Must) | **MET + gated** | Colour: zero ANSI + every fact in words (`accessibility.test.ts`), palette contrast+CVD gated (`validate:a11y`). Audio: the FR-AUD-06 cue matrix (48 cues, `cueMatrix.test.ts` + drift guard). PRD §4's "100% without colour or audio." |
| **NFR-ACC-02** — semantic, navigable, keyboard (Must) | **MET for the text client** | Stable navigable region order, keyboard-only play, discoverable depth screens (T20/T54). Web/native screen-reader *runtime* parity → M5 (no HTML client yet; CLI is linear/AT-friendly text). |
| **NFR-ACC-03** — scalable text, high-contrast, colourblind (Must) | **palette MET + gated; runtime M5** | §11 contrast table + CVD separation enforced by the a11y gate; high-contrast `--text` clears AAA. 200%-scaling / high-contrast *runtime* toggles live in the web client (`tokens.css` commits to them). |
| **NFR-ACC-04** — reduced motion/flicker (Should) | **policy catalogued; runtime M5** | Effects live in the not-yet-built animated client; catalogue in colorway "States & degradation". |

## Colourblind ΔE reference (Machado CVD, min across protan/deuter/tritan)

Normal-vision min separation across the six rationed hues is **ΔE 26.8** (all clearly distinct). Under
red-green CVD the **warm cluster** converges — these are the pairs the `validate:a11y` gate allow-lists
(warns, does not fail) because meaning never rides on hue alone (colour + a paired label/icon):

| Pair | min-CVD ΔE | |
| --- | --- | --- |
| `--accent` / `--warning` | 4.6 | warm convergence (allow-listed) |
| `--infection` / `--warning` | 6.0 | warm convergence (allow-listed) |
| `--accent` / `--infection` | 7.8 | warm convergence (allow-listed) |
| `--danger` / `--infection` | 9.8 | warm convergence (allow-listed) |
| `--accent` / `--danger` | 17.9 | distinguishable |
| `--hope` / `--infection` | 33.9 | **separable** (corrects the colorway's guessed blur) |

A hue pair **outside** this allow-list dropping below ΔE 11, or two hues too similar under normal vision
(ΔE < 20), or a body token below AA-normal, **fails** the gate (a regression). Proven by the malformed
fixture `test/fixtures/bad-tokens.css` and a synthetic non-allow-listed CVD collapse in `a11y.test.ts`.

## Two-subagent adversarial audit + verify

**Engineering** (colour math / gate teeth / no drift): the WCAG math matches the §11 table to 4 dp
(independently re-derived); CVD/CIELAB applied to linear RGB (no gamma bug); the gate rejects the malformed
fixture and hand-built malformed palettes with the right codes (not a rubber stamp); the cue-matrix test is
non-vacuous (breaking 5 soundscape branches fails exactly those 5); crash-safe over odd tokens.css; engine +
content byte-identical. Fixes applied: tightened the hex regex to exactly 3/6 digits (a 4/5-digit token is
skipped, never thrown on); corrected the fixture comment; documented the ratio-not-hex scope of the drift
check.

**Design** (matrix completeness / honesty): the matrix is complete against what the soundscape emits (all 48
rows surface — driven live), and the deaf/HoH parity holds for the load-bearing threat cues (Screamer,
horde, positioned shot, Stalker, Fear heartbeat all carry danger + direction/distance/type in text). Fixes
applied: **reworded the over-claim** "complete against the AUDIO bible" → "every cue the soundscape emits" +
added the tracked `DEFERRED_CUES` list; **added the drift guard** (so "machine-checked completeness" is
honest); **wrote this QA doc** (the gate's CVD allow-list references it); **corrected the CVD-pair prose**
(the real convergent set is the warm cluster, not hope/infection). The ACCESSIBILITY.md ticks and the §0
per-NFR claims were verified honest (M4 met, M5 runtime items left unticked).

## Parking lot / deferrals

- **Authored-but-unreachable soundscape tone lines (T55 gap the matrix surfaced):** the Hope theme is never
  selected by `buildTone` (needs a rescue/cure/radio event to drive it), and the danger theme renders only
  L3/L4 (its L0–L2 lines "The air pulls taut" / "The air has gone taut" are unreachable — the level floor is
  `max(2, …)`), as is exploration L2. No player *information* is lost (the
  reachable lines carry the danger, and the matrix cites only reachable lines) — it is wasted authored text +
  a §4.3 "builds 1→2→3" fidelity miss. Deferred to an M5 audio-tone polish (lower the danger floor; wire a
  Hope trigger; or trim the dead lines).
- **AUDIO-bible cues not yet emitted (in `DEFERRED_CUES`):** hearing-damage/tinnitus (a played perception
  mechanic → engine, PL-M4-52), radio speech captions (PL-M4-50), combat/weapon SFX texture, Dynamic Audio
  Memory (PL-M4-49), further §6.7 one-shots. Each earns its text equivalent when its system lands.
- **M5 web-client-runtime accessibility** (Appendix A M5): full screen-reader parity (aria-live, focus
  management), one-hand mobile layout, `prefers-reduced-motion` runtime, a dyslexia font override, the
  colour-only client-lint the CVD redundancy premise assumes, and the human playtest with disabled players.
- **Caption-verbosity / reduce-startle toggle** (PL-M4-51) — the harness a11y settings surface, not taken
  this part (the "settings surface" scope option was declined).
