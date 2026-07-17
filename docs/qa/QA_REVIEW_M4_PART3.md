# QA Review — M4 Part 3 (T47): Encounter categories, chains & multi-stage flows

**Scope:** T47 — the data-driven encounter/event system (FR-ENC-03..08, FR-CNT-03) + the Humanity system (v7→v8 rung).
**Build verified (clean sandbox):** engine **402** · content-loader **9** · harness **65** · typecheck clean ×3 · schema gate **115 entries / 8 types** · malformed rejected · empty-turn smoke exit 0.
**Save schema:** `SAVE_SCHEMA_VERSION 7 → 8` (one forward-only rung, `migrateV7toV8`). Pipeline: 14-stage order unchanged.

## What shipped

The engine now decides *which slice of the simulation becomes this turn's scene*, from authored data. `prototype/engine/src/sim/events.ts` is a generic **interpreter** over a closed vocabulary — requirement predicates + effect verbs — with **no hard-coded per-encounter branching** (FR-CNT-03). Encounters are `content/encounters/*.json`, validated by `content/schemas/encounter.schema.json`, and threaded into the pure engine as **transient content on the graph** (`buildRegionGraph`/`startRun` gain an opt-in pool; an empty pool is inert).

The six sub-requirements, and how each was proven:

- **FR-ENC-05 categories** — a `category` tag ∈ the seven; a harness test asserts all seven ship.
- **FR-ENC-03 chains** — `setFlag` writes a `player.flags` fact a later `requiresFlags` reads; `scheduleFollowup` enqueues a *timed* flag on the existing `queue`, resolved in stage 12. Proven end-to-end (the water-tower name → a day's delay → the transit-plaza payoff).
- **FR-ENC-04 multi-stage** — `advanceStage` moves the active encounter, which persists across turns in the reserved `player.quests` slot; `seedWalkers` hands a stage off to a real T15 fight. Proven on `overpass-toll` (negotiate → fight → chase) and in engine unit tests.
- **FR-ENC-06 moral → Humanity** — a hidden `player.humanity` scalar (0–100, baseline 50), moved by `adjustHumanity` and logged as a `moral` beat; surfaced only as felt prose at the extremes (`humanityBand`).
- **FR-ENC-07 false encounters** — an encounter whose stage resolves to nothing (the door in the wind; the figure that isn't). Engine test asserts no state payoff beyond the beat + the one-shot flag.
- **FR-ENC-08 evolution** — three encounters sharing one node id (`garden-center`), gated on `searchPct`/flags, yielding before/during/after. Proven through the real engine.

**Humanity** was the one scope fork with lasting cost, and the owner chose a **stored scalar with a v7→v8 rung** (over a derived-from-history read). Implemented as a required `Player.humanity`, seeded at creation and by a pure/total `migrateV7toV8`; the encounter machinery itself adds no further rung (rides `player.quests`/`player.flags`/`queue`/`region.storyFlags`).

## Verification

- **Determinism / opt-in inertness.** Selection uses no RNG this part; the whole engage→resolve slice replays byte-identically. A run with no registered pool never engages an encounter (`evaluateEvents` is a strict no-op) — every prior golden is byte-identical, which is why the pre-existing 372 engine + 57 harness tests stayed green untouched.
- **Save-lossless.** A mid-multi-stage run (active encounter in `player.quests`) round-trips deep-equal; the reloaded run offers the same stage choices (pool rebuilt from content, slot from state). The v7→v8 rung round-trips and seeds a neutral humanity on a synthesized v7 blob.
- **Anti-softlock.** Every engaged stage offers a way out; when all authored choices are gated, the engine injects a single "Step away" (the T15/T40 rule that a way out always exists).
- **Combat handoff.** `seedWalkers` arms the node and the very next scene is the T15 avoidable-walker prompt (fight/slip/fire) — the fight is real combat, not a re-implementation.
- **Content soundness.** A harness drift-guard proves every referenced node/npc/region/wound/zombie/item id in the shipped pool is real, every `advanceStage` targets an existing stage, and all seven categories are present.

## Adversarial content-quality audit

A subagent ran the **Golden Encounter Formula** over all 14 encounters. Human-only-undead canon and non-audio/screen-reader legibility were **clean**. **11 fixes** applied:

- **Trades restored (5):** `first-light`/`stripped-bare`/`overpass-toll(bluff)`/… strictly-dominant "obvious best" choices given a real time-or-resource cost so no branch is free.
- **Moral cost on every branch (3):** the-one-who-scratched's "say a word", the toll bluff, the door "wait" — each given an ambivalent cost, so the designated no-clean-answer beats keep one.
- **Consistency (2):** the scavenger "split" now actually shares food (it granted none, inverting help↔rob); the marina rescue now leaves a run-memory trace like the cheaper lie already did.
- **Prose (1 + tics):** garden-center-after's label no longer names an ungranted bedroll; two repeated cadence tics ("— for now", "the dead") varied.

The audit also motivated the small `minStash` requirement key (gating "pay the toll" on actually holding a can — otherwise a broke player pays nothing).

## Parking lot (carried forward)

- **PL-M4-13** — **T48 owns the anti-repeat gate.** Selection this part is deterministic-by-fit; the tagged-pool **weighting**, **cooldown** suppression, and the §4 **verbatim-repeat-rate** instrumentation (FR-ENC-01/02) are the next part. The proof-set encounters are one-shot or state-gated so they don't spam without cooldowns; ambient/repeatable encounters wait for T48.
- **PL-M4-14** — **Encounters fire only on uncontested (walkers==0) nodes** — a deliberate seam so the active-encounter branch never shadows the T15 walker prompt, and an engaged encounter can't be walked away from mid-flow. The cost: encounters can't currently surface *while* the dead are present at a node. Revisit if a "fight interrupts the negotiation" beat is wanted inside one node.
- **PL-M4-15** — **Humanity has no consumers yet.** The scalar is tracked and felt (prose bands) but nothing reads it for a gate: ending assembly (T61/T62), companion desertion/refusal-to-stay (T53), and "how the world remembers you" are the intended readers. Wire them when those land.
- **PL-M4-16** — **First-pass encounter dials + a ~14 proof set, not the launch pool.** Humanity deltas, need/mind costs, walker counts, delay hours, and the band thresholds (≥85 / ≤28 / ≤12) are untuned against a real cross-city run (M5 balance T59/T60). The deep pool that makes a full run rarely repeat is the content pour, gated behind T48's repeat-rate signal and the review-capacity cap; the owner's human voice/casting pass on the encounter prose (as for characters, PL-M4-12) is still owed before beta.
- **PL-M4-17** — **`revealDiscovery` writes bare content ids into `node.discoveries`** (e.g. `disc.gc.drawing`) with no `content/discoveries` type or schema behind them yet — the prose lives in the encounter, the id is a hook for a future codex/journal (T54) and environmental-storytelling content. Author the discovery entries when the depth screens land.

## Definition-of-done checklist

- [x] Engine + content-loader + harness typecheck + test green; schema gate green; malformed rejected; empty-turn smoke exit 0.
- [x] Adversarial content-quality audit run; fixes applied.
- [x] `docs/plans/M4_PART3_PLAN.md`, this review, CHANGELOG, `docs/status.json` (T47 → done, banner, parking lot).
- [x] Format-patch built and verified by `git am` on a fresh baseline; changes synced to the mount.
- [x] Mission Control snapshot refreshed.
