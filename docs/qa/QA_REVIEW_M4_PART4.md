# QA Review — M4 Part 4 (T48): Repeat-suppression & recombination (the §4 repeat-rate gate)

**Scope:** T48 — tagged-pool weighting + cooldown suppression (FR-ENC-01/02), the Rule of Three at significant locations (FR-CNT-04), and the PRD §4 verbatim-repeat-rate gate — turned from a guess into a **measured, hard CI gate**.
**Build verified (clean sandbox):** engine **418** · content-loader **9** · harness **75** · typecheck clean ×3 · schema gate **127 entries / 8 types** · malformed rejected · empty-turn smoke exit 0.
**Save schema:** **no rung** — `SAVE_SCHEMA_VERSION` stays **8**. Pipeline: 14-stage order unchanged.
**Owner decisions:** a ~10–14 **demonstrator** ambient pool (not the launch pour); the §4 rate as a **hard CI gate** (not a reported-only signal).

## What shipped

T47 built the encounter interpreter but selected **by fit, deterministically** — no weighting, no cooldowns. T48 closes that. Selection is now **tiered**:

- **Scripted tier** — any eligible **one-shot** (`repeatable !== true`: every T47 encounter, every evolution/chain/multi-stage/moral beat) is picked **deterministically by fit, with no RNG draw**. A scripted beat is never randomized, never crowded out, never suppressed. ⟹ **every prior golden is byte-identical.**
- **Ambient tier** — when *only* `repeatable: true` encounters are eligible, apply **cooldowns** (drop any within its `cooldownHours`) and a **weighted random** pick from a new named **`encounter` RNG stream**, weighted to favour **fresh** (long since this id fired) and **tag-diverse** (long since a shared tag fired) content. A single candidate returns **without drawing** (no stream advance), so single-candidate scenes stay byte-identical too.

The whole anti-repeat store **rides the Living History**: T47 already logs an `encounter.begin` beat per engage, so cooldowns and the §4 metric are pure reads of `state.history` — **T48 adds no save-schema rung** and stays save-lossless; the `encounter` stream rides the existing open `rng.streams` map (lazily seeded, independent per T5, so it cannot shift another system's sequence). The per-turn look-back is **bounded** to the schema's 336h `cooldownHours` cap.

New content fields **`tags`** (FR-ENC-01 recombination/diversity handle) and **`weight`** on `EncounterDef` + `encounter.schema.json`; **`cooldownHours` is now enforced**. New engine module `telemetry/repetition.ts` (mirrors the T32 pacing baseline — pure, client-driven, off by default) folds the fires into **`verbatimRepeatRate`** and the variety signals. A small cadence rule in `applyAction`: **no new encounter opens on a turn spent resolving one** (inert for T47's sparse pool).

The requirements, and how each was proven:

- **FR-ENC-01 tagged pool filtered by state conditions** — the condition filter shipped in T47; T48 adds `tags`, used as the grouping key for cooldown/diversity so thematically similar beats (two false-alarms, two stranger-pleas) don't cluster. A harness drift guard asserts every repeatable carries ≥1 kebab-case tag and ≥1 tag is shared by ≥2 encounters (recombination is real).
- **FR-ENC-02 weighting + cooldowns favour fitting, non-repeated content** — the tiered weighted/cooldown selection. Engine tests prove: a repeatable within its cooldown window is ineligible and past it eligible again (read from history); a single candidate engages without drawing; ≥2 draw exactly the `encounter` stream (every other stream byte-identical); a scripted beat always wins over an eligible repeatable without drawing; and, across 200 seeds, a beat whose tag just fired loses the majority to a cold-tag beat (diversity suppresses the hot theme).
- **FR-CNT-04 Rule of Three at significant locations** — a harness guard asserts (a) every encounter-anchored node offers ≥3 approaches across its encounters, and (b) the `requiresShelter` class offers ≥3 distinct approaches (so every one of the 14 claimable safehouses does). The two authored anchors that sat at 2 choices (`a-name-on-the-wall`, `figure-in-the-window`) were each given a genuine third approach.
- **§4 verbatim variety < 5% within a full run** — the hard gate below.

## Verification — the §4 hard gate (measured, not guessed)

`harness/test/repetition.test.ts` registers the full shipped pool and drives a **deterministic full-run-length sweep of the city** (every node, in id order, over ~4h steps across ~54 days — synthetic navigation so the thing under test is the real engine selection path over a full run's worth of quiet-node opportunities, isolated from combat/attrition). `verbatimRepeatRate` is the fraction of fires that repeat an id the player already saw within a **48h recency window** — the window in which a re-fire reads as verbatim; cooldowns ≥ the window drive it toward zero, and a mis-set/absent cooldown would make it spike (so the gate is a real regression guard, not vacuous — proven by an engine test where the metric detects a 25% windowed-repeat case).

**Measured over the sweep:** **134 fires across 54 days ⇒ verbatimRepeatRate 0.00 %** (0 windowed repeats), **0 immediate repeats**, **20 distinct** encounters, **max single share 12.7 %**, categories `{environmental 46, story 32, exploration 24, psychological 18, social 14}`. The gate asserts `fires ≥ 40`, `rate < 5 %`, `immediate == 0`, `distinct ≥ 12`, `maxShare ≤ 25 %` — all pass with wide margin. The even per-encounter distribution (most ambient beats ~11 fires each; one-shots exactly once) shows the weighting spreads load rather than one beat dominating.

- **Byte-identity of prior runs.** The scripted tier never draws, and evaluateEvents stays strictly inert when nothing is eligible / the pool is empty, so the 402-engine / 65-harness T47 baseline stayed green **untouched** (now 418 / 75 with the T48 additions).
- **Determinism.** The sweep and every selection are seeded (`encounter` stream) → the gate reproduces byte-for-byte.
- **No save-schema rung.** Cooldowns + metric are history reads; the `encounter` stream is a lazy addition to an open map. A mid-run save round-trips deep-equal exactly as at v8.

## Adversarial content-quality audit

A subagent ran the **Golden Encounter Formula** over the 12 new ambient encounters + the two added anchor choices. Accessibility (non-audio / screen-reader) and human-only-undead canon were **clean** (the stray dog and the birds are living animals; every dead/undead referent is human). Category fit was clean. **Fixes applied:**

- **HIGH (3):** `across-the-street:hand` and `the-note:keep` were cost-free "obvious best" branches on moral beats → given a real cost (showing yourself to a stranger now rattles you; carrying a dead stranger's letter now weighs on you). `chalk-marks:scrub` was a strictly-dominated option whose label promised trail-covering safety its effects never delivered → now actually sets a trail-covered flag and settles you, a real alternative.
- **MED (5):** `chalk-marks:heed` (last cost-free branch) trimmed; `figure-in-the-window:call` (overpriced) re-balanced; and three near-duplicate skeletons re-flavoured/re-valued to break the clone feel — `tending-the-base` vs the one-shot `the-night-watch` (its scrap sink moved off defensive shoring to a morale-bearing improvement), `the-small-hours` vs `the-long-dark` (its relief routed partly through grief/morale, off the twin value), and `the-uncovered` vs `a-childs-schoolbag` (broke the byte-identical "leave = stress +2, 0h" branch and differentiated the numeric profile). Removing near-dups **is** the task's purpose, so these were worth applying.
- **LOW:** stock phrases and rule-of-three cadence tics varied; a label/effect feedback gap on `a-childs-schoolbag:look` closed with a history note.

The human voice/casting pass on the encounter prose remains the owner's beta gate (PL-M4-12/16).

## Parking lot

Carried forward: **PL-M4-15** (Humanity still has no consumers — T53/T61/T62 read it later). **PL-M4-16** (the deep launch pool is still the content pour behind the review-capacity cap + the voice pass; T48 ships the mechanism + a demonstrator that proves the gate, not launch breadth).

New this part:

- **PL-M4-18 — encounter cadence is uncapped.** On a quiet node an ambient fires whenever one is eligible (T47 behaviour); the fire *rate* self-regulates only via cooldowns (a burst, then quiet as the fresh pool goes on cooldown, then a refresh). T48 adds no fire-probability gate — its scope is *which* content fires and *not repeating*, not *how often*. A per-turn fire-chance lever (some quiet nodes are just quiet) is a natural M5-balance addition; the new same-turn anti-stack rule is the only cadence guard so far. First-pass ambient dials (cooldowns 72–120h, default weights, the 48h window, mind/humanity deltas) are untuned against a real cross-city run (T59/T60).
- **PL-M4-19 — the deep pool + a recombination lever are still owed.** T48's ~12 tagged demonstrator proves the mechanism holds the <5% gate, not launch-scale breadth. A future "narration-variant recombination" lever (one encounter, several interchangeable prose renderings) could stretch a compact pool further than tags/conditions/evolution alone — not needed to hit the windowed gate here.

## Definition-of-done checklist

- [x] Engine + content-loader + harness typecheck + test green; schema gate green; malformed rejected; empty-turn smoke exit 0.
- [x] The §4 hard gate green with the real numbers recorded (134 fires / 54 days ⇒ 0.00% verbatim).
- [x] Adversarial content-quality audit run; fixes applied; CI re-green.
- [x] `docs/plans/M4_PART4_PLAN.md`, this review, CHANGELOG, `docs/status.json` (T48 → done, banner, parkingLot PL-M4-18/19, risk note).
- [x] Format-patch built and verified by `git am` on a fresh baseline; changes synced to the mount.
- [x] Mission Control snapshot refreshed.
