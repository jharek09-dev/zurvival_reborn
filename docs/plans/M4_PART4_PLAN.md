# M4 Part 4 — Repeat-suppression & recombination (T48 · the §4 repeat-rate gate)

**Milestone:** M4 (Content-complete city) · **Task:** T48 · **Requirements:** FR-ENC-01/02 (Must, VS),
FR-CNT-04 (Should, MVP), the §4 *Encounter variety* metric, the "Content-hunger repetition" tripwire.
**Depends on:** T47 (the data-driven encounter interpreter `events.ts` + `encounter.schema.json`), T5
(named-stream RNG), T31 (Living History — the `encounter.begin` beat is the cooldown/metric source),
T32 (the client-driven telemetry pattern `pacing.ts` mirrors).
**Owner decisions (this part):** demonstrator ambient pool (~10–14), *not* the full launch pour (that
stays deferred behind the review-capacity cap, PL-M4-16); the §4 rate is a **hard CI gate** (a build-
breaking test), not a reported-only signal.

## Goal

T47 built the interpreter but selected **by fit, deterministically** — no weighting, no cooldowns
(`selectEncounter`/`specificity` carry the "T48 replaces this" note; `EncounterDef.cooldownHours` is
"reserved for T48, not enforced"). T48 closes that: **tagged-pool weighting + cooldown suppression**
so a full run keeps *verbatim* encounter repeats under the PRD §4 target — **< 5% within a single full
run** — by **recombination + cooldowns, never raw volume** (the tripwire's own words). And it makes the
gate **measured, not guessed**: a repeat-rate instrument (mirroring the T32 pacing telemetry) folds a
run's `encounter.begin` beats into the §4 number, and a harness test asserts it over a full-run-length
city traversal (the hard gate).

The disciplined constraint: this is **the mechanism + a demonstrator pool that proves the gate**, not
the launch content pour. "This is where AI-at-volume sits behind the review-capacity cap" — the deep
pool is authored later, gated behind this repeat-rate signal and the owner's voice pass (PL-M4-12/16).

## The requirements and how each is met

- **FR-ENC-01 — Tagged encounter pool filtered by state conditions** (Must, VS). The condition-filter
  (the requirements engine) already ships (T47). T48 adds the **tags**: an optional `tags: string[]`
  on `EncounterDef` (+ schema), used as the grouping key for cooldown/diversity so *thematically*
  similar beats don't cluster (two "false-alarm" fake-outs won't land back to back even if their ids
  differ). Tags are the recombination handle: the same small situation set, tagged and state-
  conditioned, presents as many *fitting* scenes.
- **FR-ENC-02 — Weighting + cooldowns favor fitting, non-repeated content** (Must, VS). The core.
  Selection becomes **tiered**:
  - **Scripted tier** — any eligible **one-shot** encounter (`repeatable !== true`: every T47
    encounter, and all evolution/chain/multi-stage/moral beats) is picked **deterministically by fit**
    exactly as T47 does (most-specific-then-id, **no RNG draw**). A scripted beat is never randomized,
    never crowded out, never suppressed. ⟹ **every T47 golden + test is byte-identical.**
  - **Ambient tier** — when *only* `repeatable: true` encounters are eligible (the quiet-node filler
    the launch pour fills), apply **cooldowns** (drop any within its own `cooldownHours`) and a
    **weighted random** pick from the new named **`encounter` RNG stream**, weighted to favor
    *fresh* (long since this id fired) and *tag-diverse* (long since anything sharing a tag fired)
    content. A single eligible candidate is returned **without drawing** (no stream advance), so
    single-candidate scenarios stay byte-identical too.
- **FR-CNT-04 — Rule of Three: significant locations support ≥ 3 approaches/outcomes** (Should, MVP).
  A **significant location** = a claimable safehouse or an encounter-anchor node. The guard: each
  offers ≥ 3 distinct approaches/outcomes, satisfied by either a single encounter with ≥ 3 choices, an
  evolution set (before/during/after ≥ 3 variants, FR-ENC-08 — already proven on the garden-center),
  or ≥ 3 encounters keyed there. A harness test enumerates the significant locations and asserts the
  ≥ 3 bar.
- **§4 Encounter variety — < 5% verbatim repetition within a full run** (the metric this task exists
  to hit). Instrumented in a new `telemetry/repetition.ts` and enforced by the hard CI gate (below).

## Architecture

### Cooldowns & the metric ride the Living History — **no save-schema rung**

T47 already logs an `encounter.begin` beat to `state.history` on every engage, stamped
`{day, hour, turn}` with `subjects:[id, node]` and `data:{encounter, category}`. That is the whole
persistence T48 needs:

- **Cooldown** = "has this encounter id fired within `cooldownHours`, per the history beats." Read, not
  stored.
- **Tag diversity** = "how long since any encounter sharing a tag fired" (id → tags resolved from the
  in-hand pool).
- **The §4 metric** = a pure fold of the `encounter.begin` beats.

History is already serialized and round-trips (T7/T31), so cooldowns and the metric are **save-lossless
with no new state**. The `encounter` RNG stream rides the existing **open** `rng.streams` map (seeded
lazily on first use — `streams.ts` already names "encounter" as an example), so adding it needs **no
migration**. ⟹ **T48 adds zero save-schema rungs** (stays at v8), consistent with the "ride reserved-
and-inert shapes" discipline (T37/T38/T40/T47).

Bounded scan: cooldowns/staleness read history **backward, stopping past the max window** (schema cap
`cooldownHours ≤ 336h = 14 days`), so the per-turn cost is bounded, not O(whole history) — noted
against PL-M2-06 (the history-growth watch).

### Engine surface (`sim/events.ts`)

- `EncounterDef` gains `tags?: readonly string[]` and `weight?: number` (base ambient weight, default
  `BASE_WEIGHT`); `cooldownHours?` is now **enforced**.
- `eligibleEncounters(state, graph)` — unchanged for one-shots; additionally drops a **repeatable**
  within its `cooldownHours` (read from history). No existing fixture is repeatable ⟹ existing results
  unchanged.
- `selectEncounter(state, graph): EncounterDef | null` — kept as the **deterministic fit view** (used
  by tests/tools): scripted tier if any, else ambient by fit. For one-shot fixtures it returns exactly
  what it returned in T47.
- **`chooseEncounter(state, graph): { def, rng }`** (new) — the runtime pick used by the pipeline:
  scripted → deterministic, `rng` untouched; ambient 0 → null; ambient 1 → that one, `rng` untouched;
  ambient ≥ 2 → **weighted draw** from the `encounter` stream. Integer weight:
  `BASE * (1 + idScore + 2·tagScore)` where `idScore`/`tagScore` are hours-since-last capped at a
  week (fresh ⇒ full), so tag-diversity dominates and a just-fired theme is strongly suppressed.
- `evaluateEvents(state, graph)` — switches to `chooseEncounter` and folds the returned `rng` back.
  When no draw happens (empty pool, nothing eligible, or a single candidate) `rng === state.rng`, so
  the whole path stays **strictly inert / byte-identical** for every prior run. The `walkers === 0`
  quiet-node guard, the run-over/combat/active guards, and the 14-stage order are unchanged.
- `specificity` — kept (it now orders the scripted tier); its "T48 replaces this" note is removed.

### Telemetry (`telemetry/repetition.ts`, new — mirrors `pacing.ts`)

Pure, **client-driven, off by default** (nothing in the pipeline captures), so it can't perturb
determinism.

- `encounterFires(state): readonly EncounterFire[]` — the `encounter.begin` beats as
  `{ turn, day, hour, encounter, category }`.
- `summarizeRepetition(fires): RepetitionSummary` — `{ fires, distinct, verbatimRepeatRate,
  windowedRepeats, immediateRepeats, byCategory, maxSingleShare }`.
- **`verbatimRepeatRate`** — the §4 headline: the fraction of fires that repeat an encounter the player
  **already saw within `RECENCY_WINDOW_HOURS` (48h)** — the window in which a repeat reads as verbatim.
  Cooldowns ≥ the window drive this to ~0; a mis-set/absent cooldown makes it spike, so the gate is a
  real regression guard (not vacuous). `= 0` when `fires === 0`.
- `VERBATIM_REPEAT_TARGET = 0.05` (PRD §4).
- Secondary reported signals (health, not gated): `distinct`/`maxSingleShare` (pool coverage &
  concentration — proves the *weighting* spreads load), `immediateRepeats` (back-to-back same id —
  gated at 0).

### Content — the demonstrator ambient pool (~10–14 repeatables)

Broadly-but-fittingly conditioned, `repeatable: true`, each with `tags` + `cooldownHours ≥ 72h` (> the
48h recency window), spread across six of the seven categories (no ambient combat beat — encounters
fire only on uncontested nodes) and the districts, in the established grounded
second-person, non-audio, real-trade-on-every-branch voice. Conditioned on common quiet-node states
(by `nodeKinds`, `phases`, region, node-state bands) so they surface often enough across a traversal to
*exercise* the gate, and diverse/tagged enough that verbatim repeats stay rare. Existing T47 one-shots
gain `tags` where useful (e.g. a shared `false-alarm` tag on the two fake-outs) — behaviour unchanged
(still one-shot, scripted tier). Rule-of-Three coverage is completed at the significant locations.

### Integration & save schema

No pipeline-order change (still the 14 stages; selection still stage 13). No `applyAction` call-site
change (the pool rides `graph`). **Save schema stays v8** — no rung. content-loader schema gate stays
**8 types** (new fields on the existing `encounter` type; entry count grows with the new content).

## Test plan

- **Engine** (`events.test.ts` extended + a focused selection/telemetry suite):
  cooldown-from-history suppression (a repeatable within its window is dropped; past it, eligible
  again); tag diversity (a just-fired-tag sibling is down-weighted); **single-candidate no-draw**
  byte-identity (rng untouched); weighted determinism (same seed ⇒ same pick; the draw only advances
  the `encounter` stream, never `combat`/`loot`/etc.); **scripted tier never crowded out** (a chain
  payoff / evolution beat still fires with an eligible repeatable present); `summarizeRepetition` math
  over a synthesized history.
- **Harness** — **the hard §4 gate**: register the full shipped pool, drive a deterministic
  full-run-length city traversal (many quiet nodes over many days), collect `encounterFires`, assert
  `fires ≥ 30` (non-vacuous), `verbatimRepeatRate < 0.05`, `immediateRepeats === 0`, and a variety
  floor (`distinct` sensible, `maxSingleShare` bounded — the weighting spreads load). Plus the
  **Rule-of-Three** guard (every significant location ≥ 3 approaches/outcomes) and a **drift guard**
  (every shipped `tags`/`weight`/`cooldownHours` valid & in range).
- **content-loader** — schema gate auto-picks the new fields; type count stays 8, entry count updated.
- Full CI green in a clean sandbox (engine + content-loader + harness typecheck + test, validate over
  real content, malformed-rejected, empty-turn smoke) **before** packaging. Prior 402/9/65 goldens must
  stay byte-identical (the scripted tier + empty-pool inertness guarantee it).

## Definition of done

CI green in a clean sandbox; the §4 hard gate green with the real numbers recorded; format-patch built
+ verified by `git am` on a fresh baseline + diff-empty; changed files synced to the E: mount;
`docs/status.json` T48 → done + banner + parkingLot; `CHANGELOG.md`; `docs/qa/QA_REVIEW_M4_PART4.md`
(with the measured repeat-rate numbers); Mission Control snapshot refreshed. An adversarial content-
quality subagent audit on the new ambient encounters (Golden Encounter Formula, category fit,
near-duplicate/verbatim risk, non-audio/screen-reader legibility, human-only-undead canon,
real-trade-on-every-branch).

## Parking lot / deferrals

- The **deep launch pool** (dozens of encounters so a run rarely repeats even unwindowed) stays the
  content pour behind the review-capacity cap + the owner's voice pass (extends PL-M4-16).
- **FR-ENC-09** (rare/legendary weighting) and **FR-ENC-10** (director-injected encounters) remain
  later M4/M5.
- **Narration-variant recombination** (one encounter, several interchangeable prose renderings for
  extra freshness) is a possible future lever beyond tags/conditions/evolution; not needed to hit the
  windowed §4 gate here.
- Humanity's consumers (T61/T62 endings, T53 desertion) still read the scalar later (PL-M4-15).
