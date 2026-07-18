# M4 Part 13 — NFR-ACC accessibility baseline (T56 pt 2 of 2 · "finished from M1, not retrofit")

Accessibility is a **Must from M1** on this project — the PRD risk register names "accessibility retrofit,
bolted on late" as the failure mode to avoid, and ACCESSIBILITY.md is worked from the vertical slice, not
the end. T56's second half **completes the NFR-ACC baseline** (NFR-ACC-01…04) at the M4 tier: it turns the
principles into *tracked, machine-checked acceptances* and marks the checklist honestly — the M4 commitments
met and proven, the M5 release-candidate items (full web screen-reader parity, human playtest with disabled
players) deferred as the spec's own Appendix A already schedules them. This lands part 2 of 2, so **T56 flips
to done** and only T57 (the M4 exit) remains in the milestone.

## What NFR-ACC asks for, and where it already stands

> **NFR-ACC-01 (Must)** — All critical info conveyed without reliance on colour or audio alone.
> **NFR-ACC-02 (Must)** — Full screen-reader support; semantic, navigable text UI.
> **NFR-ACC-03 (Must)** — Scalable text and high-contrast / colourblind-safe themes.
> **NFR-ACC-04 (Should)** — Reduced-motion and reduced-flicker modes.

The build is a headless engine + a **text CLI** harness (+ `design/tokens.css`/`colorway.md` for the future
web client). That is a structural accessibility advantage (ACCESSIBILITY §3): turn-based (no reaction-time
barrier), save-anywhere, the renderer *is* separable text, colour is never the sole signal, no numeric-bar
overload. NFR-ACC-01/02 already have baseline coverage from T20 (`accessibility.test.ts`: zero ANSI, every
fact in words, stable navigable region order, keyboard-only play) extended by T54 (depth screens
keyboard-reachable) and T55 (the soundscape as the sound-off channel). What's **not yet done at the M4 tier**
(ACCESSIBILITY.md Appendix A — "M4 · Content-complete: Full FR-AUD-06 cue-redundancy matrix; colourblind
validation at content scale; dyslexia/reading-load options") is the part this delivers.

## Scope — the M4 tier, honestly bounded

Delivered here (all buildable + provable NOW, byte-identity by construction — no engine/content change):
1. **The FR-AUD-06 cue-redundancy matrix** — the exhaustive, tracked matrix proving *every* meaningful sound
   cue maps to a text equivalent, tested end-to-end (the acceptance test for FR-AUD-06, ACCESSIBILITY §10.4).
2. **The colour gate** — a palette **contrast + colourblind validator** run as a **CI gate** against
   `design/tokens.css` (the ACCESSIBILITY §11 table as tests; the `--danger`/`--info`-never-for-body-text
   lint; deuteranopia/protanopia/tritanopia separation of the rationed hues) — NFR-ACC-01/03.
3. **The consolidated NFR-ACC-01 acceptance** — the two halves (colour-independence + audio-independence)
   tied to PRD §4's headline metric: "100% of critical information available without colour or audio."
4. **The completed checklist + a QA acceptance** — `docs/specs/ACCESSIBILITY.md` ticks the now-met `[B]`/`[I]`
   items and its M4 rollup; `docs/qa/QA_REVIEW_M4_PART13.md` maps NFR-ACC-01…04 to evidence.

**Honestly deferred to M5** (as Appendix A schedules — not silently dropped): full web/native screen-reader
*runtime* parity (aria-live, focus management — there is no HTML client to add it to yet; the CLI is
linear/AT-friendly text by construction), the one-hand mobile *layout* and `prefers-reduced-motion` *runtime*
(web/native CSS concerns that `tokens.css` already commits to — 44px targets, 200% scaling, high-contrast,
reduced-motion catalogue), a dyslexia font override, and the human playtest with disabled players. NFR-ACC-04
(reduced motion) is a Should whose effects live in the not-yet-built animated client; the policy is catalogued
(colorway "States & degradation"), the runtime is M5.

## Architecture — harness matrix + a content-loader colour gate, zero engine touch

**Byte-identity by construction (the T54/T55 shape).** Nothing in `prototype/engine/src` or `content/` is
edited, so `diff -r` of both against the pre-part-2 baseline is **empty** and every engine golden + the
cross-tree `saveGame` proof hold by construction. The work is: a harness cue-matrix module + tests, a
content-loader **a11y validation gate** (a build tool, not shipped runtime — like the schema gate), and docs.

### 1 · FR-AUD-06 cue-redundancy matrix (harness)
`prototype/harness/src/cueMatrix.ts` — a tracked enumeration of every meaningful AUDIO-bible sound cue as
`CueMatrixEntry{ id, sound, audioRef (§), channel (bed/environmental/dynamic/body/tone), text }`, spanning
all five soundscape layers: the ambient bed (region×phase×threat, the five weather masks, shelter tone, dead
grid), environmental one-shots (fire, the dead/flies, barricades, a groaning frame), the informational layer
(the Screamer shriek, hordes on-you/by-distance, the node states chasing/investigating/feeding, the **seven
zombie-type tells**, the walker moan, "it's loud here", positioned noise spikes, the Stalker night wrongness),
the body (the heartbeat's four Fear bands, breath, snow footsteps, the infection distortion by stage), and the
music/tone (the six themes × intensity, level-0 silence). Plus `renderCueMatrix()` → the markdown table
delivered as `docs/reference/AUDIO_CUE_MATRIX.md`. The soundscape (T55) is 100% text and has **no non-text
channel**, so "every meaningful sound has a non-audio equivalent" is *structural*; the matrix + per-cue
triggering tests prove each category is actually **produced** (not silently dropped), and the design audit
proves the matrix is **complete** against the AUDIO bible. If a cue is found with no text form, the fix is in
the harness (`soundscape.ts`) — still no engine touch.

### 2 · Palette contrast + colourblind gate (content-loader)
A self-contained validator in `prototype/content-loader/src/a11y/` (pure colour math — sRGB→linear→XYZ→Lab,
WCAG contrast, a standard CVD simulation, ΔE), a CLI `src/a11yCli.ts` + `npm run validate:a11y`, and a **new
CI step** mirroring the schema gate (+ a malformed-tokens-must-be-rejected step). It parses `design/tokens.css`
and asserts:
- **Contrast (ACCESSIBILITY §11):** each text/semantic token's WCAG ratio vs `--bg` matches the table's rating
  — body-safe tokens (`--text`/`--text-2`/`--muted`/`--accent`/`--warning`/`--hope`/`--infection`) clear
  AA-normal (≥4.5), the high-contrast `--text` clears AAA (≥7); a body-safe token dropping below AA is a hard
  FAIL (regression gate).
- **The lint rule:** `--danger` and `--info` are below AA-normal (4.36 / 4.26) — the validator confirms the
  fact and enforces the policy that they are large-text/icon/edge only, never body copy.
- **Colourblind (NFR-ACC-03):** simulate protanopia/deuteranopia/tritanopia on the six rationed hues and check
  pairwise ΔE separation; the documented `--hope`/`--infection` (teal/bile) blur is acknowledged as
  redundancy-required (colour never the sole signal — the design mandates a paired label), while any *new*
  collapse is a FAIL. The gate proves the palette stays CVD-legible as it evolves.

### 3 · Consolidated NFR-ACC-01 acceptance + docs
`accessibility.test.ts` gains the explicit NFR-ACC-01 acceptance (colour-independence: zero ANSI + every
meaning in words across turn types + the palette gate; audio-independence: the FR-AUD-06 matrix), framed as
PRD §4's 100%-without-colour-or-audio headline. `ACCESSIBILITY.md` ticks the met items + M4 rollup;
`QA_REVIEW_M4_PART13.md` maps each NFR-ACC line to its evidence and states the M5 deferrals plainly.

## Test plan

- `harness/test/cueMatrix.test.ts` (new) — for **every** `CUE_MATRIX` entry, build a state that triggers it,
  render `soundscapeCaptions`, and assert the text surfaces; the seven zombie tells each show; the tone themes
  and level-0 silence; the four heartbeat bands; the infection stages; determinism (same state ⇒ same
  captions); **no number leaks**; and a completeness guard (every soundscape channel has ≥1 matrix entry).
- `harness/test/accessibility.test.ts` (extended) — the consolidated NFR-ACC-01 acceptance.
- `content-loader/test/a11y.test.ts` (new) — the WCAG math against known values (e.g. `--text` ≈ 15.58,
  `--danger` ≈ 4.36), the §11 ratings, the `--danger`/`--info` lint, CVD separation, and — the gate's teeth —
  a **malformed `tokens.css` (a body token pushed below AA, and a hue collapsed) is REJECTED** (nonzero exit),
  mirroring the schema gate's malformed check.
- CI: engine typecheck+test + content-loader typecheck+test + `validate` (schema) + **`validate:a11y` (new)** +
  both malformed checks + harness typecheck+test + `npm start` smoke — all green. Engine/content test counts
  **unchanged** (nothing outside the harness/content-loader/docs moved).
- **Byte-identity:** `diff -r prototype/engine/src` and `diff -r content` vs the pre-part-2 baseline = empty.

## Definition of done

Code + tests + this plan + `docs/qa/QA_REVIEW_M4_PART13.md` + `docs/reference/AUDIO_CUE_MATRIX.md` +
`docs/specs/ACCESSIBILITY.md` (checklist ticked) + `CHANGELOG.md`; `docs/status.json` **T56 → done** (both
halves shipped) with the refreshed banner + parking-lot items, under the concurrency guard; Zurvival Mission
Control refreshed; a verified `git format-patch` delivered; changed files synced to the E: mount. Two-subagent
adversarial audit + a verify pass each — **engineering** (the colour math is correct; the gate CATCHES a
malformed palette, not a rubber stamp; no engine/content drift; crash-safe) and **design** (the FR-AUD-06
matrix is COMPLETE — every meaningful AUDIO-bible cue enumerated AND surfaced in real play, no audio-only cue;
the NFR-ACC acceptance is honest — M4 met, M5 deferred not faked; the checklist ticks are truthful).

## Parking lot / deferrals (M5 · release-candidate accessibility, per Appendix A)

- **Full web/native screen-reader runtime parity** (aria-live scene announcements, focus-managed dialogs) —
  needs the HTML client; the CLI is linear/AT-friendly text now. (NFR-ACC-02 runtime.)
- **One-hand mobile layout + `prefers-reduced-motion` runtime** — `tokens.css` commits to 44px targets, 200%
  scaling, high-contrast, and the reduced-motion catalogue; the runtime is the web/native client. (NFR-ACC-03/04.)
- **Dyslexia-friendly font override** + concise/TL;DR reading-load reduction — web-client toggles.
- **Human playtest with disabled players / an accessibility consultancy** — the M5 accessibility pass.
- **Caption-verbosity / reduce-startle toggle** (PL-M4-51) — a harness a11y settings surface; folded into the
  M5 settings work (the "Also add settings surface" scope was not taken this part).
