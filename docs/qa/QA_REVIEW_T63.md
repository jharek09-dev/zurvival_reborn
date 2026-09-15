# QA Review — T63 · Full accessibility, verified with assistive technology

**Task** T63 (M5, `seq` 115) · **NFR-ACC-01..04** · **ACCESSIBILITY** §5–§13, Appendix A (M5 row) · **FR-AUD-06** ·
**FR-UI-04** · **WCAG 2.2 AA** as the yardstick for the browser client
**Date** 2026-09-15 · **Build** on T60 · **Closes** PL-M4-59 · **Partly closes** PL-M4-60, PL-M4-61, PL-M4-62 ·
**Declares** PL-M5-86..93
**CI** engine **1373** (+0) · harness **357** (+7) · content-loader **65** (+42) · testlab 22 · schema 191 across 17
types · a11y palette OK · **client lint OK** (new) · **web client check 131 assertions** (new; Chromium)
**Evidence** `docs/qa/at/` — Orca transcripts, post-T63 and pre-T63 · `prototype/harness/web/a11y-check.mjs`

> **No engine or content change.** `diff -r` of `prototype/engine/src` and `content/` against the T60 tree is empty,
> so every run is byte-identical by construction and there is no save rung. The harness changes are presentation:
> the depth-screen back hint's wording, an artifact's "found at" naming a place instead of printing a node id, a new
> pure `outlineScreen`, and the terminal client waiting on a depth screen (its resolved turns are unchanged — they
> are still exactly `playByInputs`' fold).

---

## 1. The thesis

**Before T63 the game had never been read by a screen reader, and the first one that read it could not follow a
turn.** The accessibility baseline was real but had been proved by construction — "the text client is linear and
AT-friendly", "every fact is in words", a palette gate over a file no player sees. T63 put a real screen reader in
front of both clients, and the reader's own log is the evidence.

Orca 46 on the pre-T63 browser client, taking one choice (`docs/qa/at/T63_PRE_web-turn.md`):

- focus fell to `<body>` — the button pressed no longer existed;
- the whole scene card was one `aria-live` region, emptied and refilled, so Orca spoke **sixteen fragments in the
  order the DOM happened to fire them**: the dateline, "Pack: 12/40.", the window title twice over, the whole
  soundscape block, "What do you do?", a landscape sentence, the district mood, a line of dialogue, "You feel
  steady.", a sound caption — and the encounter's first sentence thirteenth;
- "What you hear WHAT YOU HEAR" — an `aria-label` and a `text-transform: uppercase` label, both spoken;
- no choice count, and **H found no headings at all**.

After reading on inside a depth screen, Tab walked out of the dialog into the page behind it
(`T63_PRE_web-dialog-trap.md`). In the terminal client, opening Inventory, Orca never spoke the screen's title line and
ran the entire scene straight on after the screen — the client redrew the scene in the same tick, and the screen's
own last line said "[any other key returns to the story]" (`T63_PRE_cli-screen.md`).

None of that is visible to a test that asserts the DOM contains the right words. All of it is audible.

---

## 2. What T63 built

### The browser client (`prototype/harness/web/`) — the one rendered UI, so the runtime half of NFR-ACC lives here

- **Structure.** Landmarks; an `h1`; the scene heading (day, time, place) as `h2`; `h3`s for your condition, what you
  hear, the story; "What do you do?" as the `h2` naming the choices region; choices as an `<ol>` of buttons whose
  names end with the cost in words ("Travel to Corner Store, 2 hours"); two skip links.
- **A turn.** Focus moves to the new scene heading; ONE polite announcer (`#announcer`) speaks a digest in reading
  order — condition lines new this turn, "No longer: …" for lines that went away, new sounds, the story, the choice
  count. Settings: that, "Only what changed", or "Nothing". The digest survives a second turn or a dialog opening in
  its 250 ms delay. The page title follows the scene.
- **Dialogs.** Native `<dialog>` + `showModal()`: everything behind is inert, Escape (the `cancel` event) closes, Tab
  cycles, focus returns to the opener (re-armed if the opener was a heading), and neither live region is left holding
  text a reader would re-read on close.
- **Depth screens** render as headings and lists (`outlineScreen`, §4), not a `<pre>`; `✗` and `†` stay visible but
  are hidden from the accessibility tree beside the words that carry them.
- **Reader settings** (persist in `localStorage`, guarded; the run still never does): text 100–200%, contrast
  standard / high / follow the system (`prefers-contrast`), story font serif / sans, spacing standard / wide,
  announcement verbosity, single-key shortcuts on / off (WCAG 2.1.4).
- **Keyboard.** A held key is one press; shortcuts never fire in a field, in a dialog, or with Ctrl, Alt or Meta held.
- **Visual.** The soundscape captions and every error/run-over text moved off `--info`/`--danger` onto body colours,
  with the hue kept on the edge; controls ≥ 44 px (the top-bar and depth-screen-bar buttons were 36 px tall); a 3 px focus ring, and `Highlight`
  under forced colours; placeholder text and text-field edges to AA / 3:1; the pinned bars keep a scroll padding equal
  to their height and stop being pinned when together they would take a third of the window.
- **Motion.** The only motion is the toast fade; `prefers-reduced-motion` removes it (and any future animation).

### The terminal client

A depth screen now stays on screen until the next line. What that line DOES is unchanged — `playByInputs`' fold: a
choice number or S/Q acts, another screen key opens that screen — except that a line that is not a command (a bare
Enter) returns to the story instead of "(type a number …)". The back hint now says exactly that.

### Gates and tests

- **The client lint** (`content-loader/src/a11y/client.ts`, run by `npm run validate:a11y`). §3.
- **The web client check** (`harness/web/a11y-check.mjs`, a CI step). Chromium over the DevTools protocol, no npm
  dependency; sections A–I in its header. It FAILS, never skips, without a browser.
- **The Orca runner** (`harness/web/at/`, not CI). §5.
- Harness `screens.test.ts` +7 (the outline battery); content-loader `a11yClient.test.ts` 42.

---

## 3. The client lint — the palette gate's promise, kept

For two milestones `validate:a11y` printed *"--danger … never body copy (client lint enforces this)"*. There was no
client lint. Measured in the browser, the soundscape captions — FR-AUD-06's text equivalent for sound, the most
important accessibility text in the game — sat at **3.94:1** on the story card. The gate checked `design/tokens.css`,
which no player receives.

`client.ts` checks the sheet the player gets, against tokens.css: (1) every colour-valued custom property, wherever it
is declared, equals its token (or is a high-contrast text override that clears AAA and never lowers contrast), and a
colour it cannot measure is an error; (2) `--danger`/`--info` never colour text — through `var()` in any form, an alias
chain, or the hue written out; (3) body tokens clear AA on every reading surface, with the one hover pair below AA
(`--muted` on `--surface-3`, 4.2:1) a warning the rendered check proves unused; (4) motion needs a universal
`none !important` switch in exactly `@media (prefers-reduced-motion: reduce)`, and no other `!important` motion rule
may outrank it. CSS nesting is refused rather than skipped.

On the pre-T63 sheet (kept verbatim as `test/fixtures/bad-client.css`, a CI negative proof) it reports six errors:
**five real defects** — a drifted `--danger-wash`, and `--info`/`--danger` as the text colour of `.soundscape`,
`.ended h2`, `.msg.err`, `#toast.err` — **plus T63's stricter motion rule** (the old switch covered transitions, not
animations; it had no animations).

---

## 4. `outlineScreen` — structure recovered, not invented

The five depth screens are `string[]` renderers shared with the terminal. Rather than fork them, `outlineScreen`
recovers the structure from the shapes `frame`/`section` write — title bar, `Header:`, two-space rows, deeper
continuations, the back hint. It is total: title, every block's raw lines and the hint give the input back exactly,
asserted over the fixtures and 3 × 90-turn played runs. Its counts are checked against an **independent recount** of
the raw lines, not against itself, and the web check asserts the page renders exactly the outline's h3/ul/li/
continuation/glyph counts on a state that really has companions and a death.

It is a parser of rendered text — the T55 rule prefers structured data. Declared (PL-M5-90): it holds while
`screens.ts` owns both the writer and the reader, and the round-trip test is what catches a new line shape.

---

## 5. Verified with a screen reader — how, and what it found

**Orca 46.1** (a real screen reader, GNOME) over AT-SPI in the cloud container: Xvfb, a session bus, Chromium for the
page, xfce4-terminal for the CLI, real X key events via xdotool. What Orca said comes from its debug log's
`SPEECH OUTPUT:` lines; where focus went, from DevTools. Six scenarios, each step with `expect`/`forbid`/`focus`/
`assertJs`; all six hold on the final build (`docs/qa/at/T63_*.md`); three run unchanged on the pre-T63 clients
(`T63_PRE_*.md`, failures explained in `docs/qa/at/README.md`).

What the reader found that no DOM assertion would have — nine real defects, all fixed, seven of them in T63's OWN
first build (row 9 was a false alarm, and is listed because the harness trap behind it is worth knowing):

| # | found with Orca | fix |
|---|---|---|
| 1 | the pre-T63 jumbled scene, doubled label, focus on `<body>`, no headings | §2 structure + announcer |
| 2 | a `role="dialog"` div with a hand-made `inert`: the browse cursor walked out via the skip links (outside `#app`), Tab followed, Escape then did nothing | native `showModal()` |
| 3 | Chromium re-exposes an inert live region's content when the modal closes — closing Settings re-read the last turn's digest | clear both live regions on open; keep a pending digest separately |
| 4 | **`aria-haspopup="dialog"` makes a button a "focus mode widget"** — Orca switched to focus mode, stayed there, the NEXT dialog opened silently and H/L quick-nav stopped | removed from every trigger; the web check fails on any `aria-haspopup` |
| 5 | **the second dialog a page opened was silent**: Chromium put the text caret in the dialog's heading before firing focus, Orca took the caret as the locus and dropped the focus as "existing locus" | focus the first control; Close placed before the heading in DOM order (CSS `order` keeps it visually right) |
| 6 | a persistent `tabindex="-1"` made Chromium expose a click action — "heading level 2 **clickable**" everywhere | `focusStatic`: the attribute lives only while focused |
| 7 | the spelled cost as a sibling or nested span — "Corner Store **,** 2 hours" | an `aria-label` that starts with the visible label (WCAG 2.5.3) |
| 8 | the scene section named by its own heading — the day, time and place spoken twice a turn | the scene is no longer a named region |
| 9 | a radio group's legend not spoken on Tab in | turned out to be harness trap 2 below; with it fixed Orca says "Text size panel", and the workaround was removed |
| 10 | the terminal screen's dropped title and run-on scene | the screen waits |

**Three harness traps**, recorded so nobody re-learns them (`web/at/README.md`): Orca's debug file is block-buffered
(speech lands in the wrong step — run under `script` onto `/dev/tty`); with a null synthesiser a page-load say-all never
finishes and suppresses focus speech (`sayAllOnLoad` off in a private prefs dir); the terminal needs a UTF-8 locale.

**Orca behaviour a transcript reader should know:** browse mode keeps letters and digits for quick navigation, so the
page's single-key shortcuts are for sighted keyboard players (Tab/Enter always work); on opening a dialog Orca speaks
"dialog", the description and the focused control, not the dialog's name when the pressed button had the same name
("has same name as priorObj"); on the last turn it spoke the digest (ending "The run is over. Start a new run to play
again.") but not the focused heading separately.

---

## 6. The adversarial audit — 44 findings across three passes, every one fixed or declared

Taken on a `/root/zb-unfixed` snapshot of the finished build. **Engineering (12):** closing a dialog opened from the
focused scene heading dropped focus to `<body>` (the heading had lost its tabindex; `focus()` silently did nothing); the
digest was lost if a second turn or a dialog came within 250 ms, and "changes" mode then never spoke the first turn's
changes; the pinned bars covered focused choices at 1280×900, 400×760 and 200% text on a laptop (WCAG 2.4.11); a held
digit took a turn on every auto-repeat (4 turns for one press and three repeats); "changes" never said what went away and dropped the ending; Start run flashed focus through
the New run button; a text-selection drag onto the backdrop closed the Save dialog; no visible focus on "The run is
over."; placeholder 3.54:1 and field edges 1.63:1; opening a dialog wiped an error toast (reworded: it stays until you
act); the terminal hint was false once the screen waited; companions split into one-item lists.
**Honesty (16):** evidence files cited before they existed; "Everything works with Tab … Escape" (radios need arrows);
the digest described as "the whole scene" (it is the story plus what changed); "the one place" meaning sat in a
below-AA hue (there were four rules); "every hue here is an edge" (`.num`, `.k`, `.cost.free` colour words); the motion
lint's "no later rule can win" (an `!important` rule could); the large-only rule's reach (aliases, `rgb()`); "six real
defects" (five, plus a stricter rule); "dropped title and first line" (title only); a node id "spoken" (never
recorded); the check header over-claiming dialogs and target sizes; "keyboard-only" when openers were focused by
script; "pause and stop with no loss" (needs a save); "the page actually changes" asserted by a word that is a
substring of "not selected"; unverified CI Chrome and forced colours stated as fact; stale counts.
**Test teeth (16 reported, 17 items as listed here):** 33 mutants on the unfixed tree, **7 survived** — `aria-haspopup` restored, glyphs un-hidden (the
check met 0 glyphs: a fresh run has no companions), `var( --info )` with spaces, AA lowered to 4.3, the off switch on
any selector, "(nothing yet)" as a list row, a glyph left in the row text — plus the vacuous `motionRules > 0` bound, an
edge test that could not fail, contrast passes that never proved they measured anything, targets measured in 2 of 9
dialogs, and lint bypasses by alias, `rgb()`, `@media`-scoped tokens, `hsl()`, nesting and an outranking `!important`.

Run against the unfixed snapshot, the final check fails **16 of its 131 assertions** (one of them, the
named-scene-region assertion, is for Orca finding 8 rather than an audit finding) and passes all 131 on the build.
The finding counts in this section (12 / 16 / 16, and the teeth pass's 33 mutants with 7 survivors) come from the
audit session and cannot be re-derived from the tree or the committed evidence.

---

## 7. Mutants

Targeted, each run through its real gate. The session's own web-mutant runs used a check two edits older (129
assertions); all 58 were then re-run on a copy of the final tree after the last source change: **58 of 58 killed**.

| gate | mutants | killed | first-round survivors |
|---|---|---|---|
| web check (`ui.js`, `styles.css`; page rebuilt, check run) | 30 | 30 | 2 — N01 (no re-arm of a static opener: the fallback landed on the same heading) and N05 (Start run via `close()`: the dialog had been opened by script, so there was no opener to flash). Both were test gaps; the check now opens from the run-over heading and by keyboard, and both die |
| client lint (`client.ts`, vitest + tsc) | 18 | 18 | 0 (two first attempts were killed only by tsc and were rewritten to compile) |
| outline (`screens.ts`, vitest + tsc) | 10 | 10 | 0 (one first attempt killed by tsc, rewritten) |

---

## 8. What T63 did NOT verify

- **One screen reader, one platform.** NVDA, JAWS, VoiceOver and TalkBack (§12's matrix) were not run. The web check
  runs Chromium only; Firefox and Safari are unverified.
- **No human playtest with disabled players; no switch access; no Windows High Contrast** (Chromium's forced-colours
  emulation only).
- **CI's web check has not run on GitHub.** GitHub documents Chrome on `ubuntu-latest`; if it is absent the step fails
  loudly. It adds about a minute to CI.
- **Photosensitivity** is met only vacuously — nothing flashes because the designed flicker effects are unbuilt.
- Not built: shortcut remapping, an in-game motion toggle (nothing to toggle), a visual "what changed", mid-run
  difficulty.

---

## 9. Parking lot

- **[CLOSED by T63] PL-M4-59** — screen-reader runtime parity on the web client.
- **[PARTLY CLOSED by T63] PL-M4-60** — 200% text, high contrast, reduced motion, a sans story font: done. The one-hand
  mobile layout is verified only as reflow at 320–400 px.
- **[PARTLY CLOSED by T63] PL-M4-61** — `--danger`/`--info` never as text: linted. "Every hue paired with a word" is
  verified by audit and the rendered check, not linted over markup.
- **[PARTLY CLOSED by T63] PL-M4-62** — Orca on both clients, keyboard reachability, 200%/320 px reflow: done. The other
  four readers, switch access, flash-rate analysis and the human playtest: not.
- **PL-M5-86** Shortcut remapping (FR-UI-07 [I]).
- **PL-M5-87** A visual "what changed" for sighted players (ACCESSIBILITY §6 [I]).
- **PL-M5-88** The terminal client cannot hide glyphs from a screen reader: Orca passes `·` and `×` to the synthesiser as
  raw characters (`T63_cli-screen.md`) — how a synthesiser voices them was not recorded — and `†`/`✗` (the memorial,
  locked orders) did not occur in a recorded terminal run. The anomaly signal's label is "· · ·".
- **PL-M5-89** Opening a dialog by moving the browse cursor into it makes Chromium focus the `<dialog>`, and Orca then
  reads its whole text as one utterance.
- **PL-M5-90** `outlineScreen` parses rendered text; a structured screen model would remove the parser.
- **PL-M5-91** The web check has not run on a GitHub runner; NVDA/Firefox, VoiceOver/Safari untested.
- **PL-M5-92** `artifactProvenance`'s "repaired N times" branch is dead: loot writes `repairs: []` (an array), the branch
  tests for a number. Found while fixing its "found at" line; not an accessibility defect, so not touched.
- **PL-M5-93** T64 inherits new hard-coded player-facing strings in `ui.js` (Settings, the digest's "You hear:", "No
  longer:", "N choices.", dialog hints) and the new back hint.

---

## 10. Verdict

**NFR-ACC-01..04 are met on both clients and verified with a real screen reader — one reader, on one platform, stated
as such.** The browser client went from a page Orca could not follow to one where every scenario's expectations hold,
and the gates that would let it regress now look at what the player actually receives.
