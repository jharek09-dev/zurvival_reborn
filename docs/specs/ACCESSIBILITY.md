# Zurvival Reborn — Accessibility Checklist

**Version:** 1.0 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`GDD.md`](GDD.md) (Part XVII UI/UX, XVIII Audio) · [`PRD.md`](PRD.md) (NFR-ACC-01…04) · [`../DESIGN.md`](../../DESIGN.md) (§10 Scene contract) · [`../design/colorway.md`](../../design/colorway.md) · [`../design/tokens.css`](../../design/tokens.css) · [`LOCALIZATION.md`](LOCALIZATION.md)

---

## 0a. Status — NFR-ACC at M5, verified with a screen reader (T63, 2026-09-15)

**What T63 verified, and with what.** Both clients were driven by **Orca 46** — a real screen reader, over AT-SPI —
and the transcripts are committed: the web client in Chromium, the terminal client in a VTE terminal
(`docs/qa/at/`, runner `prototype/harness/web/at/`). Every scenario asserts what Orca must say (and, for the web
client, where focus must land), and the three scenarios that run unchanged on the pre-T63 clients were run there too,
so those defects are on record in the reader's own words (`docs/qa/at/T63_PRE_*.md`). What a CI runner can repeat is `prototype/harness/web/a11y-check.mjs`: the built page in
headless Chromium, read through its accessibility tree (structure and Tab order · focus and announcements around a
turn · every dialog modal, named, trapping Tab, returning focus · single-key shortcuts off · rendered contrast in every
state it can reach · reflow at 320 px with 200% text and no focus hidden under the pinned bars · 44 px targets ·
reduced motion and forced colours · settings persistence). The palette gate now also lints the client
stylesheet the player actually receives (`content-loader/src/a11y/client.ts`).

**What it did NOT verify — say it before anyone ticks a box for it.** Only ONE screen reader on ONE platform: NVDA,
JAWS, VoiceOver and TalkBack (§12) have not been run. No switch-access device, no human playtest with disabled
players, no photosensitivity analysis (nothing in any client flashes; the designed flicker effects are unbuilt). The
CI check runs Chromium only. Details and the parked items are in `docs/qa/QA_REVIEW_T63.md`.

- **NFR-ACC-01 (no colour/audio-only info) — MET, and now checked in the RENDERED client.** No hue in the web client
  carries a fact on its own — every coloured edge, tint or word sits beside words that say the same thing — and
  `--danger`/`--info` can no longer colour text (client lint). The places text sat in those below-AA hues are fixed:
  the soundscape captions, FR-AUD-06's text for sound (`--info`, measured 3.94:1 on the story card), the run-over
  heading, and the error messages (`--danger`: 4.36:1 even on `--bg`, 3.35:1 for the error toast on `--surface-3`).
- **NFR-ACC-02 (full screen-reader support, semantic, navigable) — MET and verified with Orca** on both clients: a
  heading outline and landmarks; focus moves to the new scene's heading after a turn and ONE polite announcer speaks
  an ordered digest — what is new or no longer so about you, new sounds, the story, the number of choices (verbosity is
  a setting); choices are an ordered list of buttons whose names carry their cost in
  words; depth screens are modal dialogs rendered as headings and lists; the terminal client keeps a depth screen on
  screen until it is left.
- **NFR-ACC-03 (scalable text, high contrast, colourblind-safe) — MET in the runtime.** Text 100–200% (reflow verified
  at 320 px), standard / high / follow-the-system contrast, a sans-serif story font and wide spacing; reader settings
  persist; forced colours keep every boundary and the focus ring.
- **NFR-ACC-04 (reduced motion/flicker, Should) — MET for what exists.** The only motion in any client is a toast fade,
  and the OS reduced-motion preference removes it. The client lint fails the build if the sheet moves without a
  universal `none !important` switch in exactly `@media (prefers-reduced-motion: reduce)`, or if any other rule declares
  motion `!important` (which would outrank that switch); the rendered check confirms nothing moves under the
  preference. There is no in-game motion toggle, because there is nothing yet for it to switch.

## 0. Baseline status — NFR-ACC at M4 (T56 pt 2, 2026-07-18)

The NFR-ACC baseline is **complete at the M4 tier** and its Musts are tracked + machine-checked:

- **NFR-ACC-01 (no colour/audio-only info) — MET + gated.** Colour-independence: the text client renders
  zero ANSI (meaning never rides on colour), every fact is in words, and the design palette is contrast-
  and colourblind-validated by a CI gate (`prototype/content-loader` → `npm run validate:a11y` over
  `design/tokens.css`, the §11 table + a Machado CVD check). Audio-independence: the **FR-AUD-06
  cue-redundancy matrix** — every meaningful sound cue → a text equivalent — is enumerated in
  `prototype/harness/src/cueMatrix.ts`, proven cue-by-cue in `cueMatrix.test.ts`, and rendered to
  `docs/reference/AUDIO_CUE_MATRIX.md`. This is PRD §4's headline "100% of critical information available
  without colour or audio."
- **NFR-ACC-02 (semantic, navigable, keyboard) — MET for the text client.** Stable navigable region order,
  keyboard-only play, discoverable depth screens (T20/T54). Full web/native screen-reader *runtime* parity
  (aria-live, focus management) is an M5 item — there is no HTML client to instrument yet; the CLI is
  linear/AT-friendly text by construction.
- **NFR-ACC-03 (scalable text, high-contrast, colourblind-safe) — palette MET + gated; runtime M5.** The
  §11 contrast table and CVD separation are enforced by the a11y gate; the 200%-scaling / high-contrast
  *runtime* toggles live in the web/native client (`tokens.css` commits to them).
- **NFR-ACC-04 (reduced motion/flicker) — Should; policy catalogued, runtime M5.** The effects live in the
  not-yet-built animated client; the catalogue is in colorway "States & degradation".

The `[x]` items below are met + verified now; the unticked `[A]` / runtime items are the M5
release-candidate accessibility pass (Appendix A), deferred honestly — never a retrofit.

---

## 1. Purpose

A working checklist for making Zurvival Reborn accessible, anchored to the **Game Accessibility
Guidelines** (GAG) and its Basic / Intermediate / Advanced tiers. It turns the PRD's
accessibility requirements (**NFR-ACC-01…04**) and GDD Part XVII's "accessibility is core"
stance into concrete, checkable items mapped to *this* game's architecture. Accessibility is a
**Must from M1** (PRD risk register: "accessibility retrofit — bolted on late" is the failure
mode we are avoiding), so this list is meant to be worked from the vertical slice, not bolted on
at M5.

## 2. How to use this checklist

Each item is a checkbox tagged with its GAG tier and a status against our current design:

- **Tier** — `[B]` Basic (do first / widest benefit), `[I]` Intermediate, `[A]` Advanced.
- **Status** — where the *design* already stands (nothing is built yet; `prototype/` is empty):
  - **Designed-in** — the GDD/PRD/tokens already commit to it; the job is to not regress.
  - **Planned** — accepted as a Must/Should; needs building and verification.
  - **Gap / decision** — not yet specified, or needs a real design/UX decision. These are the
    ones to look at first.

Reference tags in parentheses point at the source requirement (e.g. `NFR-ACC-02`, `FR-UI-05`,
`tokens.css`). Target milestone (M1–M5, per PRD §6) is noted where it matters.

## 3. Why this game starts ahead — and where it doesn't

A text-first, turn-based, headless-engine game has structural accessibility advantages most games
have to fight for. Name them so we protect them:

- **No twitch, no wall-clock, turn-based** (PRD FR-CORE-03, TEC-01) → no reaction-time or
  timing-precision barriers by construction. Huge motor + cognitive win.
- **Safe-to-stop autosave at every turn boundary** (FR-CORE-07, NFR-SAVE-01) → "save anywhere"
  is free.
- **The renderer is separable text** (NFR-PLAT-02, DESIGN §10) → a screen reader is close to a
  first-class client, not a bolt-on. This is the game's biggest accessibility asset.
- **Color is never the sole signal** (colorway rule: every hue paired with a label or icon) →
  colorblind support is designed-in (NFR-ACC-01).
- **No numeric bar overload; symptoms in prose** (FR-UI-02, FR-PLR-02) → less HUD to make
  accessible.
- **`tokens.css` already ships** 44px tap targets, 200% text scaling, a high-contrast mode, and
  AAA body contrast.

Where it does **not** start ahead, and needs real work (see §10 Workstreams):

- **Screen-reader UX** for *dynamically generated* scene text + choices is a design problem, not
  a free win — reading order, live-region announcement, and focus management must be authored.
- **Photosensitivity / reduced motion** — the design deliberately uses flicker (a "failing
  light"), feverish letter-spacing drift, and power-out dimming (GDD XVII, colorway). Deliberate
  motion needs deliberate off-switches.
- **Cognitive load of literary prose + hidden state** — the "no bars, infection-as-identity"
  pillar (a strength) can also confuse (PRD's own risk row). Reconcile with an *optional* clarity
  layer, without dumbing down the writing.

## 4. Coverage summary

| Category | Items | Designed-in | Planned | Gap/decision |
| --- | --- | --- | --- | --- |
| Motor | 9 | 4 | 4 | 1 |
| Cognitive | 11 | 4 | 4 | 3 |
| Vision | 12 | 6 | 3 | 3 |
| Hearing | 8 | 2 | 4 | 2 |
| Speech | 2 | 2 | 0 | 0 |
| General / setup | 7 | 1 | 4 | 2 |
| **Total** | **49** | **19** | **19** | **11** |

The eleven gaps are the real agenda; they are pulled together in §10.

---

## 5. Motor

- [x] **[B]** Full **keyboard operation** of all gameplay and menus — every choice, drill-down,
  and setting reachable and actuatable by keyboard alone. *(Planned; NFR-ACC-02 implies it, but
  FR-UI-07 currently scopes keyboard/controller parity to v1 — pull the keyboard half forward to
  M1.)*
- [x] **[B]** **No timed or repeated inputs.** No button-mashing, no quick-time events, no choice
  that expires. *(T63: the web client has no timer that acts; an error notice no longer auto-dismisses.)* Turn-based by design. *(Designed-in; FR-CORE-03. Guard rule: if a future
  "micro-choice" (GDD III) is ever timed, the timer must be adjustable/removable.)*
- [x] **[B]** **Same input method for UI and gameplay** — no separate dexterity mode for menus vs.
  play. *(Designed-in; one story-first screen, FR-UI-01.)*
- [x] **[B]** **Large, stationary targets.** Choices are a static vertical list; honor the 44px
  minimum on every interactive row and control. *(Designed-in; `--tap-min: 44px`, FR-UI-05. T63: the top-bar
  and depth-screen-bar buttons were 36 px tall; every control on the page and in every dialog is now ≥ 44×44,
  asserted by `a11y-check.mjs` §G.)*
- [x] **[I]** **No simultaneous inputs required** (no chording, no hold-and-press). Single
  discrete activation per choice. *(Designed-in; single-decision model, FR-UI-01.)*
- [ ] **[I]** **Remappable controls / shortcuts**, including number-key or single-key choice
  selection on desktop. *(Planned; part of FR-UI-07. T63 PARTIAL: single-key shortcuts can be switched OFF (WCAG 2.1.4)
  and are advertised via `aria-keyshortcuts` only while on; they cannot be remapped.)*
- [ ] **[I]** **One-handed & reachable on mobile** — controls within thumb reach; nothing
  requires two-hand gestures or precise drags. *(Designed-in; "one-hand layout", FR-UI-05.)*
- [ ] **[A]** **Switch-access & assistive-tech compatible** — the choice list works with switch
  scanning and platform AT; no custom-canvas input that AT can't see. *(Planned; falls out of
  semantic HTML + keyboard operability, but must be tested.)*
- [x] **[A]** **Adjustable/auto-advance reading pace** — text that "arrives with weight"
  (GDD XVII) never forces the player to keep up; allow instant-reveal and no auto-dismiss.
  *(Gap/decision: specify text-reveal behavior and its off switch. T63: no client reveals text over time, and
  nothing auto-dismisses that the player needs — an error stays until the next render.)*

## 6. Cognitive

- [x] **[B]** **Difficulty options**, including a gentle mode. *(Designed-in; Story / Survivor /
  Hardcore / Nightmare + Ironman, GDD XVI.)*
- [x] **[B]** **Pause anytime & stop anytime** with no loss. *(T63 note: turn-based, so pausing is free; stopping
  without loss means saving first — S in the terminal, Save in the browser, which has no autosave.)* *(Designed-in; FR-CORE-07,
  NFR-SAVE-01.)*
- [x] **[B]** **No essential information conveyed only by a timed sequence.** *(Designed-in;
  no wall-clock, TEC-01.)*
- [x] **[B]** **Clear, consistent screen model** — one decision at a time; the same header /
  status / story / choices / footer stack every turn. *(Designed-in; FR-UI-01, GDD XVII. T63: in the web client the
  stack is a fixed heading outline — scene heading, condition, what you hear, the story, "What do you do?" — walked
  by heading in Orca, `docs/qa/at/T63_web-turn.md`.)*
- [ ] **[I]** **Always-available objective / "where am I" recap.** Surface the save's one-line
  "where you are" summary (DESIGN §9) on demand so a returning player re-orients. *(Planned.)*
- [ ] **[I]** **Optional tutorial & hints.** GDD XVI's "teach through pressure, not tutorials" is
  a design value that must not block players who need explicit guidance — provide opt-in tutorial
  prompts and a codex. *(Gap/decision: reconcile the no-tutorial ethos with an opt-in help layer.)*
- [ ] **[I]** **Codex / journal for terms, characters, and history.** The map-as-journal, Living
  History, and daily report (GDD VII, XIII, XI) already reduce memory load; expose a searchable
  codex of coined terms, survivors met, and what happened. *(Planned; leverages existing systems.)*
- [ ] **[I]** **"What changed" is always legible.** The Four Questions guarantee every scene
  answers *what changed* (GDD III) — make that summary explicit and consistent, not buried in
  prose, for players who can't infer it. *(Planned. T63 PARTIAL: for a screen-reader player the announcer's
  "Only what changed" setting speaks exactly the condition and sound lines that are new this turn; there is no visual
  equivalent yet.)*
- [ ] **[A]** **Difficulty adjustable mid-run**, not only at start. *(Gap/decision: interacts with
  Ironman/roguelite integrity — decide which modes allow it.)*
- [ ] **[A]** **Optional reading-load reduction.** The prose is the art and won't be "dumbed
  down," but offer a **concise mode / scene TL;DR** and a recap-after-absence so long literary
  scenes don't gate comprehension. *(Gap/decision — see §10; this is the subtlest item here.)*
- [ ] **[A]** **Reduce hidden-state confusion without breaking the pillar.** "No infection bar"
  is intentional (FR-INJ-05), but PRD flags it as a comprehension risk. Provide *optional*
  concrete readouts via diagnosis/medical skill and a clear symptom codex, so players who need
  certainty can opt in. *(Planned/decision; ties FR-INJ-07.)*

## 7. Vision

- [x] **[B]** **Resizable text to ≥200%** without loss of function or truncation. *(Designed-in;
  colorway "scales to 200%", `--type-*` scale — verify reflow at 200%, especially choice rows. T63: a Text size
  setting to 200% (it stopped at 130%); at 320 px wide and 200% nothing scrolls sideways or clips, asserted by
  `a11y-check.mjs` §F.)*
- [x] **[B]** **Legible default size & measured line length.** 19px story body, 1.62 line-height,
  64ch max measure. *(Designed-in; `tokens.css`. Note: `--measure` becomes per-script for
  CJK/Arabic, see LOCALIZATION §8.)*
- [x] **[B]** **High contrast, verified.** Body text clears WCAG **AAA**; ships a high-contrast
  mode. *(Designed-in; measured values in §11. Fix the one caveat: `--danger` and `--info` are
  below AA for normal-size body text — keep them to large text / icons / edges only, as
  `colorway.md` already states, and never set body prose in them.)*
- [x] **[B]** **No meaning by color alone.** Every hue is paired with a word or icon
  (`FEVERISH`, not just a green pixel). *(Designed-in; colorway core rule, NFR-ACC-01.)*
- [ ] **[B]** **Photosensitivity-safe.** No flashing >3 Hz; nothing in the saturated-red danger
  range flashes. The "flicker for a failing light" and similar effects must be capped and
  disable-able. *(Gap/decision; NFR-ACC-04 — see §10. T63: MET ONLY VACUOUSLY and so left unticked — nothing in any
  client flashes because none of the designed flicker effects is built. The client lint makes any future motion obey
  reduced-motion, but a 3 Hz cap is not yet enforced for players who have not set that preference.)*
- [ ] **[I]** **Reduced-motion mode.** Honor OS `prefers-reduced-motion` and an in-game toggle for
  text-arrival animation, feverish letter-spacing drift, power-out dimming, and Quiet-Screen
  transitions. *(Planned; NFR-ACC-04, effects catalogued in colorway "States & degradation". T63 PARTIAL: the OS
  preference is honoured and gated; the in-game toggle is deliberately not shipped while there is no effect for it to
  switch — a toggle that changes nothing is a dead affordance.)*
- [x] **[I]** **Colorblind-safe palette, validated.** The rationed palette is checked for deuteranopia/protanopia/tritanopia by the `validate:a11y` gate (Machado-2009 CVD simulation + CIELAB ΔE). *Finding (corrects the colorway's guess):* under red-green CVD the real convergent pairs are the **warm cluster** — `--accent`/`--infection`, `--accent`/`--warning`, `--danger`/`--infection`, `--infection`/`--warning` — **not** `--hope`/`--infection` (teal/bile), which stays separable. All are covered by the core rule that colour is never the sole signal (every hue paired with a label/icon); a *new* collapse outside that documented set fails the gate. Full ΔE table in [`../qa/QA_REVIEW_M4_PART13.md`](../qa/QA_REVIEW_M4_PART13.md). *(colorway's `--hope`/`--infection` adjacency caution stands as a separate visual-crowding rule.)*
- [ ] **[I]** **Scalable / themable UI, not just body text** — controls, tags, and meta scale with
  text; offer text/background theme choices beyond the two shipped. *(Planned. T63 PARTIAL: every control, tag and
  meta line is rem-sized and scales with the Text size setting; forced colours are supported; there are still only the
  two themes.)*
- [x] **[I]** **Distinct, visible focus indicator** for keyboard/AT users. *(Designed-in;
  `--focus-ring: 0 0 0 2px var(--accent)` — verify it's never suppressed and meets non-text
  contrast. T63: a 3 px `--accent` outline on `:focus-visible` (7.24:1 on `--bg`, over the 3:1 non-text minimum),
  `Highlight` under forced colours; only programmatic focus on a heading hides it.)*
- [x] **[A]** **Full screen-reader support for gameplay *and* menus** — semantic structure, new
  scene text announced via a polite live region, choices exposed as a labelled list/buttons,
  status changes announced, drill-downs as focus-managed dialogs. *(Planned — flagship item; the
  game is mostly text, so this should be exceptional. NFR-ACC-02, GDD XVII. See §10. T63: built and VERIFIED WITH
  ORCA on both clients (`docs/qa/at/`). Verified with that one reader only — the §12 matrix is not done.)*
- [x] **[A]** **Dyslexia-friendly reading options** — a toggle to a high-legibility sans for the
  story window (the default is a serif), adjustable letter/line/paragraph spacing. *(Gap/decision;
  the three-font system is deliberate — offer an accessible override, don't discard it. T63: Story font — serif or
  sans-serif — and Letter and line spacing — standard or wide (letter, word, line and paragraph spacing together);
  no dyslexia-specific typeface is bundled.)*
- [x] **[A]** **Audio description N/A / covered by text.** The world is described in prose already;
  ensure any purely-visual state (an icon-only tag) also has text. *(Designed-in.)*

## 8. Hearing

Audio in Zurvival is *information*, not garnish — noise direction/distance, zombie-type
signatures, the Fear heartbeat, radio timbre (GDD XVIII). That makes hearing-access a gameplay
requirement, and it is already a **Must**: **FR-AUD-06**, "non-audio equivalent for every
meaningful sound cue."

- [x] **[B]** **Nothing essential by sound alone.** Every audio cue has a visual/text equivalent.
  *(Designed-in as a requirement; FR-AUD-06, NFR-ACC-01 — the build must honor it cue-by-cue.)*
- [ ] **[B]** **Separate volume channels** (ambient / environmental / dynamic / player / music)
  with independent sliders and mutes. *(Planned; the layered mix, FR-AUD-01, makes this natural.)*
- [ ] **[I]** **Subtitles/captions for any diegetic speech** (radio voices, GDD XIII), legible
  with backing and speaker labels. *(Planned; shared with LOCALIZATION §12 — build once.)*
- [x] **[I]** **Captioned sound effects** for meaningful cues — e.g. `[gunshot · north · close]`,
  `[screamer nearby]`. *(Planned; directly satisfies FR-AUD-06 for the "audio as information"
  cues, GDD XVIII "sound as gameplay".)*
- [x] **[I]** **Visual direction/distance indicator.** Because "direction and distance of noise"
  is a mechanic (GDD XVIII), stereo panning must be mirrored by an on-screen textual/directional
  cue, so a deaf player reads what a hearing player hears. *(Gap/decision — see §10.)*
- [x] **[I]** **The Fear heartbeat has a visual form.** The heartbeat that rises with the Fear
  Meter (GDD IX/XVIII) needs a non-audio expression (text degradation already narrows options —
  make the *state* visible, not only audible). *(Gap/decision.)*
- [ ] **[I]** **Mono / stereo-balance option** so cues aren't lost to single-sided hearing.
  *(Planned.)*
- [x] **[A]** **Comprehensive cue-redundancy audit** — a tracked matrix proving every meaningful
  sound maps to a visual equivalent, tested end-to-end. *(Planned; the acceptance test for
  FR-AUD-06.)*

## 9. Speech

- [x] **[B]** **No speech input required.** Nothing is gated behind a microphone. *(Designed-in;
  single-player, choice-driven — note it so no future feature breaks it.)*
- [x] **[B]** **No mandatory voice chat.** No multiplayer at v1.0 (PRD §6 Won't-now). *(Designed-in.)*

## 10. Key workstreams (the real agenda)

The gaps above cluster into five design workstreams. These deserve owned design, not just a
checkbox.

1. **Screen-reader scene & choice model.** Design how a dynamically generated `Scene`
   (DESIGN §10) is exposed: semantic landmarks; new story text announced via an `aria-live`
   polite region without stealing focus; choices as a labelled list of buttons carrying their
   cost tags as accessible text (not color); status changes (a new symptom, a wound) announced
   succinctly; drill-downs (inventory, map, codex) as focus-trapped dialogs with a documented
   reading order. This is the single highest-leverage accessibility investment because the game
   *is* text. Prototype it in the M1 slice. *(NFR-ACC-02.)*

2. **Photosensitivity & reduced motion.** Catalogue every motion/flicker effect the design calls
   for — text-arrival weight, failing-light flicker, feverish letter-spacing drift, power-out
   dimming, Quiet-Screen fades (GDD XVII, colorway). For each: cap flash rate <3 Hz, keep it out
   of saturated red, and wire it to both `prefers-reduced-motion` and an in-game toggle.
   *(NFR-ACC-04.)*

3. **Cognitive clarity layer (without breaking the art).** Reconcile two GDD pillars — literary
   prose and hidden state — with players who need concreteness. Ship *optional*: a concise/recap
   view of the current scene, a "what changed" summary, a codex of terms/characters/history, and
   opt-in concrete readouts via in-world diagnosis. None of it alters the default experience.
   *(Ties FR-INJ-07, FR-UI-04; addresses PRD's "infection-as-identity is confusing" risk.)*

4. **Hearing = visual parity for informational audio.** Turn FR-AUD-06 from a principle into a
   cue-by-cue matrix: noise direction/distance → on-screen directional/text cue; zombie
   signatures → captioned tags; Fear heartbeat → visible state. Deaf and hard-of-hearing players
   must be able to play at no mechanical disadvantage. *(FR-AUD-06, NFR-ACC-01.)*

5. **Keyboard/switch operability pulled forward.** FR-UI-07 currently scopes full
   keyboard/controller parity to v1; the *keyboard + AT operability* half is a Must-from-M1
   foundation (semantic, focusable, operable), with controller polish allowed to trail.

## 11. Contrast reference (measured against `--bg` #0E0F10)

Verified WCAG contrast ratios for the shipped palette, so this checklist states real numbers.
"Normal" = 4.5:1 (AA) / 7:1 (AAA); "Large/UI" = 3:1.

| Token | Hex | Ratio | Normal-text rating | Use rule |
| --- | --- | --- | --- | --- |
| `--text` (bone) | #EDE7DB | **15.58** | AAA | body prose — the star |
| `--text-2` | #B7B3A9 | 9.17 | AAA | secondary copy |
| `--muted` | #8B8981 | 5.48 | AA | meta/labels only |
| `--accent` (ember) | #F2803A | **7.24** | AAA | interactive text, links, focus *(better than colorway's "AA" claim)* |
| `--warning` (amber) | #E0A33B | 8.65 | AAA | thresholds |
| `--hope` (clean water) | #5FB3A1 | 7.72 | AAA | relief/safe |
| `--infection` (bile) | #93A63E | 7.09 | AAA | infection tags |
| `--danger` (blood) | #D84334 | 4.36 | **fails Normal** | **large text / icons / edges only** |
| `--info` (steel) | #5C7A94 | 4.26 | **fails Normal** | **large text / icons / edges only** |
| high-contrast `--text` | #FFFDF7 | 18.86 | AAA | `[data-contrast="high"]` |

Action: encode "`--danger`/`--info` never used for normal-size body text" as a lint rule in the
client, matching what `colorway.md` already advises. Everything else clears AA for body, most at
AAA.

## 12. Testing & validation

Accessibility gets its own **balance pass** (GDD XIX lists accessibility as a staged pass) and CI
hooks alongside the localization gates (LOCALIZATION §13):

- **Automated (CI):** contrast assertions against `tokens.css` (the §11 table as tests);
  axe-core / Lighthouse on the web client; a focus-order and "every control has an accessible
  name" check; a lint rule for `--danger`/`--info` misuse on body text.
  **T63:** the §11 table ✅ (T56); the client lint ✅ (`content-loader/src/a11y/client.ts`); the focus / accessible-name
  / dialog / contrast / reflow / target / motion check ✅ (`prototype/harness/web/a11y-check.mjs`, Chromium's
  accessibility tree over CDP). **Not axe-core or Lighthouse** — no npm dependency was added; the rules they would
  add beyond these are not covered.
- **Manual, per milestone:** screen-reader passes on **NVDA + Firefox, JAWS + Chrome, VoiceOver
  (macOS/iOS), TalkBack (Android)**; keyboard-only run of a full turn + every drill-down;
  switch-access smoke test; 200% and 400% zoom reflow; reduced-motion and high-contrast runs;
  photosensitivity check (flash-rate analysis) on all motion effects.
  **T63:** Orca + Chromium and Orca + VTE terminal ✅ (`docs/qa/at/`); NVDA, JAWS, VoiceOver, TalkBack ❌ not run;
  keyboard: Tab reaches every control from a fresh load and each turn and drill-down is operated by key ✅
  (`a11y-check.mjs` §A–C; the Orca scenarios focus their starting control by script, then use keys); 200% text and
  320 px (the 400% reflow width) ✅; reduced motion ✅; high contrast ✅; forced colours in Chromium's emulation only;
  switch access ❌; flash-rate analysis — nothing flashes.
- **Human playtesting** with disabled players / an accessibility consultancy, folded into the
  M5 accessibility pass — and ideally the M1 slice screen-reader prototype.
- **Definition of done (per release):** NFR-ACC-01…04 satisfied; all `[B]` and `[I]` items met;
  the FR-AUD-06 cue matrix complete; zero known photosensitivity defects; screen-reader run of a
  full slice with no blockers. PRD §4's accessibility metric — "100% of critical information
  available without color or audio" — is the headline pass/fail, and must hold **in every locale**
  (LOCALIZATION §16).

## 13. Design rules for accessibility

1. The text game should be the *most* screen-reader-friendly game its players own — treat SR UX
   as a headline feature, not compliance.
2. Every meaning travels on at least two channels (text + color, text + audio) — never one.
3. Deliberate motion needs a deliberate off switch; no effect flashes fast, bright, or red.
4. Hidden state is a design choice, not a barrier — always offer an optional way to make it
   concrete.
5. Difficulty comes from scarcity and decisions, never from the interface, the reading load, or
   the input (GDD XVI).
6. Accessible from the first run: settings reachable before you need them, and they persist.
7. Build it from M1; a text game that retrofits accessibility has wasted its biggest advantage.

---

## Appendix A — GAG tier rollup by milestone

| Milestone | Accessibility commitment |
| --- | --- |
| **M1 — Vertical slice** | Semantic, keyboard-operable, screen-reader-prototyped slice; 44px targets; AAA body contrast; color-never-alone; no-timed-input guaranteed. All Motor `[B]`, Vision `[B]` (bar photosensitivity policy), Cognitive `[B]`. |
| **M2 — Reactive world** | Reduced-motion + photosensitivity policy across the growing effect set; focus indicators; volume channels. |
| **M3 — People & shelter** | Codex/journal clarity layer; "what changed" + recap; captioned SFX + speech subtitles as content grows. |
| **M4 — Content-complete** | ✅ **T56 pt 2 (2026-07-18):** FR-AUD-06 cue-redundancy matrix tracked + tested end-to-end (`cueMatrix.ts`/`.test.ts`, `docs/reference/AUDIO_CUE_MATRIX.md`); colourblind + contrast validation shipped as the `validate:a11y` CI gate over `tokens.css`; NFR-ACC-01 acceptance consolidated. Dyslexia / reading-load font options remain an M5 web-client concern. |
| **M5 — Release candidate** | Full screen-reader parity (gameplay + menus), human playtest with disabled players, all `[A]` items, accessibility statement. Satisfies PRD M5 "accessible (NFR-ACC)". **T63 (2026-09-15):** screen-reader support built and verified with Orca on both clients; reader settings; the client lint and the CI page check; the accessibility statement (`docs/ACCESSIBILITY_STATEMENT.md`). **Not done:** the other four screen readers (NVDA, JAWS, VoiceOver, TalkBack), the human playtest, switch access, and the `[A]`/`[I]` items still unticked above. |

## Appendix B — Reference map

| This checklist | Source |
| --- | --- |
| Screen reader, semantic text UI | NFR-ACC-02 · GDD XVII · DESIGN §10 |
| No color/audio-only information | NFR-ACC-01 · colorway.md · FR-AUD-06 |
| Scalable text, high-contrast, colorblind | NFR-ACC-03 · tokens.css |
| Reduced motion / reduced flicker | NFR-ACC-04 · colorway "States & degradation" |
| Save/stop anywhere, no time pressure | FR-CORE-03/07 · NFR-SAVE-01 · TEC-01 |
| Difficulty modes | GDD XVI |
| Non-audio equivalents for sound | FR-AUD-06 · GDD XVIII |
| 44px targets, one-hand, mobile-first | FR-UI-05 · tokens.css (`--tap-min`) |
| Keyboard/controller parity | FR-UI-07 (pull keyboard half to M1) |

*End of Accessibility Checklist. Work it from M1; revisit the effect catalogue (§10.2) and the
contrast table (§11) whenever `tokens.css` or the motion design changes.*
