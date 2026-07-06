# QA Review — M2 Part 1 (Reactive world, T23–T27)

_Reviewed 2026-07-05. Scope: the six-layer world-sim substrate and the first four systems that ride it — `prototype/engine/src/sim/{worldSim,regionDrift,zombies,hordes,weather}.ts`, the pipeline/state/save wiring they touch, and the new `content/zombies/`. Focus: correctness, determinism + save-losslessness, FR adherence, maintainability, and balance/reachability._

## Verdict

Part 1 is in good shape and the engineering discipline the whole design leans on held under a much busier world. All suites are green in a clean environment (**engine 196 · content-loader 9 · harness 39 · schema gate pass over 5 types / 15 entries · 3× typecheck clean · harness empty-turn end-to-end**), and the two properties M2 puts most at risk — determinism and save-losslessness — hold **end to end**, not just per unit: a 30-turn Rivermouth run with every M2 system live reproduces byte-for-byte from its seed, and a state carried through the living world round-trips losslessly across the new `SAVE_SCHEMA_VERSION` 2→3 bump. The FR-CORE-04 "no no-op turns" audit stayed clean over a 50-turn real-content run (0 no-consequence turns) even though the world now moves every turn. The six-layer substrate (`worldSim.ts`) is a clean seam: the fixed 14-stage pipeline names/order are unchanged, and each new system landed by swapping a layer body, exactly as designed.

The findings below are **not defects in what shipped** — the four systems are correct and tested. They are about *coupling and perception*: the reactive world is, so far, entirely engine-side. Nothing it does is read by the Scene or the combat layer yet, and the off-screen drift as tuned makes the shipped opening *calmer*, not tenser. Those are the things to resolve before M2's "the slice feels alive" gate can actually be judged.

---

## High

### H1 — The reactive world is invisible in play (surfacing is deferred, but it's now the critical path)

`generateScene` and the harness renderer (`prototype/engine/src/actions/coreActions.ts:sceneOf`, `prototype/harness/src/play.ts`) read **none** of the new state. Confirmed by inspection: `weather`, `NodeState.zombieState`/`zombieTypes`, `GameState.hordes`, and the drifting `RegionState.threat`/`zombieDensity` are computed each turn but never reach a `Scene` field or a line of narration (`grep` for these in the action/scene/client layer returns nothing but pre-existing walker-`threat` narration). So a player today sees an M1 loop; the world moving on its own is real in state and provable in tests, but **not perceivable**.

This is consistent with the Part 1 plan ("surfaced to the player in a later M2 block"), so it is a *planned* gap, not a regression. It is filed High because M2's Definition of Done is *"the same slice run now feels alive"* (PRODUCTION §M2), and that is a **human fun-gate** that cannot be evaluated while the world is silent — the same class of "is it actually reachable/feelable in play?" risk the M0/M1 review caught with combat. 

**Recommendation.** Make scene-surfacing the next M2 task (ahead of or alongside T28–T32): weather into the header/atmosphere line, a rising-threat/density read into the "what changed" narration (this is where drift becomes felt), a horde's approach as a threat lead, and a roused/screaming node as prose. Until then, hold the M2 "feels alive" verdict — the loop-feel of M1 is what a playtester would still be judging.

---

## Medium

### M1 — The zombie state machine + types are computed but not yet consumed by combat/encounters

`src/sim/zombies.ts` correctly advances `NodeState.zombieState` and reads `zombieTypes` for the Screamer/Stalker behaviours, and it is well-tested. But **nothing downstream reads `zombieState`**: `combat.ts` still begins a generic walker fight (`WALKER_ENEMY`, `WALKER_MAX_HP`) regardless of a node's behavioural state or its types, and `encounterChoices` keys only off `NodeState.walkers`. Consequences:

- A node in `chasing` is no more dangerous than one that is `dormant` — the machine has no teeth yet.
- A **Screamer** and a **Stalker** fight *identically to a plain walker*; their distinctness lives only in the population layer, not the encounter.
- The seeded **Stalker at the marina has `walkers: 0`** (verified), so `isPresent` is true (a type is present) and the machine dutifully drives it to `chasing` at night — but with no body, combat offers no encounter. It is a behavioural ghost: fully simulated, entirely inert in play.

This mirrors the M0/M1 review's "enemy stats are content but the engine ignores them" finding: the data/behaviour is right, the consumption is missing. It is Medium, not High, because T25's stated scope was the machine + types *existing and transitioning correctly*, which they do.

**Recommendation.** A follow-up task to couple the layer to danger — e.g. `zombieState` biases `detectChance`/encounter odds, `chasing` escalates a node to a forced-ish encounter, a Screamer's cascade raises neighbouring encounter chance, a Stalker changes the fight (night ambush). Until then, either give type-only nodes a body (marina Stalker `walkers ≥ 1`) so a shipped type isn't inert, or hold the marina seed and demonstrate types on a node that already has walkers (the clinic Screamer already does).

### M2 — Off-screen drift *de-escalates* the shipped opening (direction fights M2's intent)

Pure off-screen drift over Rivermouth (verified via `advanceWorld`, no player action) trends **threat 35 → 7 and density 45 → ~15 across seven idle days**. Leaving the district alone makes it *safer*. That is the opposite of the standing M1 exit note carried into M2 — *"the opening ~day is still too calm (land pressure by ~turn 3)"* — and of M2's whole pitch that an unwatched region *festers*. `equilibriumDensity`/`threatTarget` (`src/sim/regionDrift.ts`) pull Rivermouth's above-baseline seed values down toward a calm carrying capacity, and threat follows density down.

T24's Definition of Done — *"a region's threat measurably changes across days with the player absent"* — **is met** (it changes, and provably so), so this is a tuning/direction finding, not a broken system. But shipped as-is it makes the early game less tense over time, which is a regression against the design's own priority.

**Recommendation.** Bias drift toward escalation where it matters: raise the equilibrium (or floor threat near/above baseline for the opening region), and/or make player noise and `survivorActivity` *raise* regional threat rather than only cull density. The natural home for a directed "make it worse when the player is winning/absent" pressure is the **T30 Apocalypse Director** — this finding is a strong argument for wiring a mild escalation bias there, with T24 remaining the neutral relaxation substrate underneath it.

---

## Low

- **L1 — `advanceWorld` under-simulates step-based layers for a large single call.** Rate-based layers scale with `hours` (region drift steps `≈ hours/3`), but the zombie ladder relaxes only **one rung per tick** and weather makes **at most one transition per tick** regardless of the hours passed. So `advanceWorld(state, 48)` is not 48 hours of hourly evolution for those two layers. Harmless for the per-turn pipeline (small hours); a future "fast-forward N hours off-screen" should loop hour-by-hour, or those layers should scale their step count by `hours`.
- **L2 — Weather ignores `World.season`.** A 30-day autumn run produced snow (transitions are season-blind). Gate cold/snow transitions on season when seasons start mattering; low impact today.
- **L3 — Weather's `noiseFactor` is exposed but not yet consumed.** Only the detection modifier is wired (into `detectChance`, backward-compatibly). The T14 noise model still deposits at full volume in rain/storm, so the plan's "the T14 noise model reads the modifier" is not yet true. This was deliberately deferred to avoid perturbing the T14 deposit tests as weather can now change mid-run; note it as owed work (a weather-aware `noiseOf`), not a silent gap. `movementDelta` is likewise reserved for T29 route conditions.
- **L4 — Plan-doc overstatement [fixed].** `M2_PART1_PLAN.md` claimed a test asserts the pipeline-world-portion ≡ `advanceWorld` equivalence "directly." It isn't tested and isn't exact — `advanceWorld` runs the same layers in the same order but omits the action's own stage-6 noise deposit and the player stages. Wording corrected to describe the actual (approximate) relationship.
- **L5 — Per-turn cost is O(nodes + regions + hordes).** Every node's zombie state is recomputed each turn, every region drifts, and the `region`/`weather` streams draw each turn even at equilibrium. Fine at Rivermouth scale and well within budget; worth watching against the GDD's "instant response on a mid-range phone" target as the city grows (large-map/large-horde work is the known heavy path).
- **L6 — `driftRegions` always advances the `region` stream and rebuilds the `regions` map** even when no value moved (a jitter draw happens per region per tick). Determinism and the value-compare telemetry stay honest, so this is only a minor per-turn allocation + RNG-consumption; acceptable, noted for awareness.

---

## What was checked and is solid

- **Determinism + save-losslessness, end to end.** Two identical 30-turn real-content runs are byte-identical; `loadGame(saveGame(state))` is deep-equal after the living world has moved; the `SAVE_SCHEMA_VERSION` 2→3 rung (`migrateV2toV3`) chains cleanly behind the existing v1→v2 rung and is unit-tested (an old save loads with `zombieState: "dormant"`, `zombieTypes: []`).
- **The no-op-turn audit survives a living world.** 0 no-consequence turns over a 50-turn real run — every resolved turn still moves a real system, now more so.
- **Pipeline invariance.** The 14 stage names/order are unchanged (the order assertion is green); the six layers are the swap points.
- **Schema gate.** The new `content/zombies/` set and the `zombieTypes` node property validate; the malformed-content rejection still fires. 5 types, 15 entries.
- **Purity/integer/plain-JSON discipline** holds across all five new modules; RNG flows only through named streams (`region`, `zombie` — n/a, `horde`, `weather`), so adding a draw to one layer can't shift another's sequence.

## Suggested follow-ups (owner's call)

1. **Scene-surfacing pass (addresses H1)** — the highest-value next step; without it the M2 fun-gate can't be judged.
2. **Couple zombie state/types to encounters (addresses M1)** — give the machine and the types teeth; give the marina Stalker a body or move the seed.
3. **Escalation bias in the Director (addresses M2)** — let T30 push threat up so an unwatched region gets worse, with T24 as the neutral substrate.
4. Wire weather's `noiseFactor` into the noise model (L3); season-gate weather (L2); loop `advanceWorld` hour-by-hour for off-screen fast-forward (L1).
