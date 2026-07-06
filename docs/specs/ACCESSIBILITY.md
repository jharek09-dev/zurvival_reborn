# Zurvival Reborn — Accessibility Checklist

**Version:** 1.0 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`GDD.md`](GDD.md) (Part XVII UI/UX, XVIII Audio) · [`PRD.md`](PRD.md) (NFR-ACC-01…04) · [`../DESIGN.md`](../../DESIGN.md) (§10 Scene contract) · [`../design/colorway.md`](../../design/colorway.md) · [`../design/tokens.css`](../../design/tokens.css) · [`LOCALIZATION.md`](LOCALIZATION.md)

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

- [ ] **[B]** Full **keyboard operation** of all gameplay and menus — every choice, drill-down,
  and setting reachable and actuatable by keyboard alone. *(Planned; NFR-ACC-02 implies it, but
  FR-UI-07 currently scopes keyboard/controller parity to v1 — pull the keyboard half forward to
  M1.)*
- [ ] **[B]** **No timed or repeated inputs.** No button-mashing, no quick-time events, no choice
  that expires. Turn-based by design. *(Designed-in; FR-CORE-03. Guard rule: if a future
  "micro-choice" (GDD III) is ever timed, the timer must be adjustable/removable.)*
- [ ] **[B]** **Same input method for UI and gameplay** — no separate dexterity mode for menus vs.
  play. *(Designed-in; one story-first screen, FR-UI-01.)*
- [ ] **[B]** **Large, stationary targets.** Choices are a static vertical list; honor the 44px
  minimum on every interactive row and control. *(Designed-in; `--tap-min: 44px`, FR-UI-05.)*
- [ ] **[I]** **No simultaneous inputs required** (no chording, no hold-and-press). Single
  discrete activation per choice. *(Designed-in; single-decision model, FR-UI-01.)*
- [ ] **[I]** **Remappable controls / shortcuts**, including number-key or single-key choice
  selection on desktop. *(Planned; part of FR-UI-07.)*
- [ ] **[I]** **One-handed & reachable on mobile** — controls within thumb reach; nothing
  requires two-hand gestures or precise drags. *(Designed-in; "one-hand layout", FR-UI-05.)*
- [ ] **[A]** **Switch-access & assistive-tech compatible** — the choice list works with switch
  scanning and platform AT; no custom-canvas input that AT can't see. *(Planned; falls out of
  semantic HTML + keyboard operability, but must be tested.)*
- [ ] **[A]** **Adjustable/auto-advance reading pace** — text that "arrives with weight"
  (GDD XVII) never forces the player to keep up; allow instant-reveal and no auto-dismiss.
  *(Gap/decision: specify text-reveal behavior and its off switch.)*

## 6. Cognitive

- [ ] **[B]** **Difficulty options**, including a gentle mode. *(Designed-in; Story / Survivor /
  Hardcore / Nightmare + Ironman, GDD XVI.)*
- [ ] **[B]** **Pause anytime & stop anytime** with no loss. *(Designed-in; FR-CORE-07,
  NFR-SAVE-01.)*
- [ ] **[B]** **No essential information conveyed only by a timed sequence.** *(Designed-in;
  no wall-clock, TEC-01.)*
- [ ] **[B]** **Clear, consistent screen model** — one decision at a time; the same header /
  status / story / choices / footer stack every turn. *(Designed-in; FR-UI-01, GDD XVII.)*
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
  prose, for players who can't infer it. *(Planned.)*
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

- [ ] **[B]** **Resizable text to ≥200%** without loss of function or truncation. *(Designed-in;
  colorway "scales to 200%", `--type-*` scale — verify reflow at 200%, especially choice rows.)*
- [ ] **[B]** **Legible default size & measured line length.** 19px story body, 1.62 line-height,
  64ch max measure. *(Designed-in; `tokens.css`. Note: `--measure` becomes per-script for
  CJK/Arabic, see LOCALIZATION §8.)*
- [ ] **[B]** **High contrast, verified.** Body text clears WCAG **AAA**; ships a high-contrast
  mode. *(Designed-in; measured values in §11. Fix the one caveat: `--danger` and `--info` are
  below AA for normal-size body text — keep them to large text / icons / edges only, as
  `colorway.md` already states, and never set body prose in them.)*
- [ ] **[B]** **No meaning by color alone.** Every hue is paired with a word or icon
  (`FEVERISH`, not just a green pixel). *(Designed-in; colorway core rule, NFR-ACC-01.)*
- [ ] **[B]** **Photosensitivity-safe.** No flashing >3 Hz; nothing in the saturated-red danger
  range flashes. The "flicker for a failing light" and similar effects must be capped and
  disable-able. *(Gap/decision; NFR-ACC-04 — see §10.)*
- [ ] **[I]** **Reduced-motion mode.** Honor OS `prefers-reduced-motion` and an in-game toggle for
  text-arrival animation, feverish letter-spacing drift, power-out dimming, and Quiet-Screen
  transitions. *(Planned; NFR-ACC-04, effects catalogued in colorway "States & degradation".)*
- [ ] **[I]** **Colorblind-safe palette, validated.** The rationed palette must be checked for
  deuteranopia/protanopia/tritanopia — the colorway's own warning that `--hope` (teal) and
  `--infection` (bile-green) can blur is exactly the risk to test. *(Planned; keep the
  neutral-separation rule; redundancy already covers the worst case.)*
- [ ] **[I]** **Scalable / themable UI, not just body text** — controls, tags, and meta scale with
  text; offer text/background theme choices beyond the two shipped. *(Planned.)*
- [ ] **[I]** **Distinct, visible focus indicator** for keyboard/AT users. *(Designed-in;
  `--focus-ring: 0 0 0 2px var(--accent)` — verify it's never suppressed and meets non-text
  contrast.)*
- [ ] **[A]** **Full screen-reader support for gameplay *and* menus** — semantic structure, new
  scene text announced via a polite live region, choices exposed as a labelled list/buttons,
  status changes announced, drill-downs as focus-managed dialogs. *(Planned — flagship item; the
  game is mostly text, so this should be exceptional. NFR-ACC-02, GDD XVII. See §10.)*
- [ ] **[A]** **Dyslexia-friendly reading options** — a toggle to a high-legibility sans for the
  story window (the default is a serif), adjustable letter/line/paragraph spacing. *(Gap/decision;
  the three-font system is deliberate — offer an accessible override, don't discard it.)*
- [ ] **[A]** **Audio description N/A / covered by text.** The world is described in prose already;
  ensure any purely-visual state (an icon-only tag) also has text. *(Designed-in.)*

## 8. Hearing

Audio in Zurvival is *information*, not garnish — noise direction/distance, zombie-type
signatures, the Fear heartbeat, radio timbre (GDD XVIII). That makes hearing-access a gameplay
requirement, and it is already a **Must**: **FR-AUD-06**, "non-audio equivalent for every
meaningful sound cue."

- [ ] **[B]** **Nothing essential by sound alone.** Every audio cue has a visual/text equivalent.
  *(Designed-in as a requirement; FR-AUD-06, NFR-ACC-01 — the build must honor it cue-by-cue.)*
- [ ] **[B]** **Separate volume channels** (ambient / environmental / dynamic / player / music)
  with independent sliders and mutes. *(Planned; the layered mix, FR-AUD-01, makes this natural.)*
- [ ] **[I]** **Subtitles/captions for any diegetic speech** (radio voices, GDD XIII), legible
  with backing and speaker labels. *(Planned; shared with LOCALIZATION §12 — build once.)*
- [ ] **[I]** **Captioned sound effects** for meaningful cues — e.g. `[gunshot · north · close]`,
  `[screamer nearby]`. *(Planned; directly satisfies FR-AUD-06 for the "audio as information"
  cues, GDD XVIII "sound as gameplay".)*
- [ ] **[I]** **Visual direction/distance indicator.** Because "direction and distance of noise"
  is a mechanic (GDD XVIII), stereo panning must be mirrored by an on-screen textual/directional
  cue, so a deaf player reads what a hearing player hears. *(Gap/decision — see §10.)*
- [ ] **[I]** **The Fear heartbeat has a visual form.** The heartbeat that rises with the Fear
  Meter (GDD IX/XVIII) needs a non-audio expression (text degradation already narrows options —
  make the *state* visible, not only audible). *(Gap/decision.)*
- [ ] **[I]** **Mono / stereo-balance option** so cues aren't lost to single-sided hearing.
  *(Planned.)*
- [ ] **[A]** **Comprehensive cue-redundancy audit** — a tracked matrix proving every meaningful
  sound maps to a visual equivalent, tested end-to-end. *(Planned; the acceptance test for
  FR-AUD-06.)*

## 9. Speech

- [ ] **[B]** **No speech input required.** Nothing is gated behind a microphone. *(Designed-in;
  single-player, choice-driven — note it so no future feature breaks it.)*
- [ ] **[B]** **No mandatory voice chat.** No multiplayer at v1.0 (PRD §6 Won't-now). *(Designed-in.)*

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
- **Manual, per milestone:** screen-reader passes on **NVDA + Firefox, JAWS + Chrome, VoiceOver
  (macOS/iOS), TalkBack (Android)**; keyboard-only run of a full turn + every drill-down;
  switch-access smoke test; 200% and 400% zoom reflow; reduced-motion and high-contrast runs;
  photosensitivity check (flash-rate analysis) on all motion effects.
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
| **M4 — Content-complete** | Full FR-AUD-06 cue-redundancy matrix; colorblind validation at content scale; dyslexia/reading-load options. |
| **M5 — Release candidate** | Full screen-reader parity (gameplay + menus), human playtest with disabled players, all `[A]` items, accessibility statement. Satisfies PRD M5 "accessible (NFR-ACC)". |

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
