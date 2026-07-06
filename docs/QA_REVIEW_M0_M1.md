# QA Review — M0 (Foundation) & M1 (Core loop playable)

_Reviewed 2026-07-05. Scope: `prototype/engine`, `prototype/content-loader`, `prototype/harness`, and shipped `content/`. Focus: correctness, design adherence (FR/NFR), maintainability, and gameplay/balance feel._

## Verdict

The build is in genuinely good shape. All suites are green in a clean environment (**engine 134 · content-loader 9 · harness 36 · schema gate pass · 3x typecheck clean**), and the core engineering discipline the whole design leans on — purity, determinism, integer/plain-JSON state, named-stream RNG, lossless save round-trip + migration ladder, and the no-op-turn telemetry audit — is implemented correctly and well-tested. Docs-to-code traceability (every module cites its FR/task) is excellent.

The one finding that matters: **before this review, the combat + injury slice was unreachable in real play.** It has been fixed. Details below, then the full list by severity. Items marked **[fixed]** were applied as part of this review; everything else is a recommendation.

---

## High

### H1 — Combat & injury slice was unreachable in validated content **[fixed]**

`node.schema.json` set `additionalProperties: false` and did **not** list a `walkers` property, while the engine's `NodeDef.walkers` (`engine/src/map/types.ts:47`) and `seedNodeState` (`engine/src/map/seedWorld.ts:70`) read `def.walkers` to seed encounters. Net effect:

- Every shipped Rivermouth node had **zero walkers**, so `npm run play` never surfaced an encounter.
- Any node that _added_ `walkers` would be **rejected by the schema gate** (verified with Ajv: `must NOT have additional properties`).
- The entire T15 combat / stealth / firearm loop and the T16 wound system were exercised **only by hand-built test districts** (`harness/test/combat.test.ts` constructs `NodeDef` objects in TS, bypassing the schema), never by the actual playable content.

This is the crux for the upcoming **Loop-Feel Check**: it would have judged a loop missing its central fight-or-avoid tension. The move/search/rest/loot half was reachable; the "read the threat, spend a resource, or slip past" half was not.

**Fix applied:**
- Added a `walkers` integer property (`minimum: 0`) to `content/schemas/node.schema.json`.
- Seeded `"walkers": 2` on `node.rivermouth.clinic` (the risk/reward node — its own notes call out "the reason the doors were chained").
- Verified: arriving at the clinic now offers `fight` plus two `slip:` routes (FR-CBT-05 escape holds), the schema gate still passes, and all 179 tests stay green.

**Follow-up (owner's call):** consider a walker at the police-post too, so the firearm's loud/quiet tension (loot the pistol there -> fight vs. fire elsewhere) is felt, not just theoretical. Tuning `walkers: 2` is a starting point, not a balance verdict.

---

## Medium

### M1 — No wound-treatment path in the playable loop
`treatWound()` (`engine/src/sim/wounds.ts:97`) is correct and tested, but **nothing calls it** — `availableActions` offers move/search/rest/drop/combat, never "treat." So once combat lands (now that H1 is fixed), wounds are inflicted but **cannot be treated within a run**. The wound defs point at `treatedBy` items (`item.antiseptic`, `item.splint`, `item.suture-kit`...) that don't exist as content yet and that no action consumes. Either add a "treat wound" action that spends a relevant item, or explicitly document treatment as deferred to M2 so the anti-regen invariant isn't mistaken for "wounds are permanent by design."

### M2 — Enemy stats in content are ignored by the engine
`content/enemies/enemy.walker.json` defines `maxHp: 3`, but combat hardcodes `WALKER_MAX_HP = 3` and `FIRE_DMG = 3` (`engine/src/combat/combat.ts:50,55`) and never reads the enemy def. Editing the JSON changes nothing — a silent content/engine divergence that contradicts the "stats are content" intent (ADR-0002). Thread the enemy def into `beginCombat` when the enemy content set is wired up.

### M3 — Loot points and items received are decoupled
A search debits region loot by the RNG draw (`1..cap`, where `cap ~= regionLoot/8`, up to ~12) but deposits exactly **one** item unit (`engine/src/sim/loot.ts:70-86`). Region richness drains up to ~12x faster than the pack fills, and the amount debited bears no relation to what the player actually got. The "can't pull more than the region held" invariant holds for abstract points but not for goods. Acceptable as an M1 abstraction; flag it for the M2 item/loot-table pass so the two line up.

### M4 — `searchPct` barely affects yield
`searchYieldCap` subtracts `trunc(searchPct/34)` — **at most -2** — against a `regionLoot/8` term of ~12 (`engine/src/sim/loot.ts:50-53`). The intended "a picked-over node yields less" is nearly imperceptible; region thinning dominates. Scale the node term up if re-searching the same node should show visible diminishing returns.

---

## Low

- **L1 — FR-CBT-05 (a stealth path always exists) is not structurally guaranteed.** `encounterChoices` only offers `slip:` to _discovered_ neighbors (`engine/src/combat/combat.ts:90-94`). It holds today only because you can occupy a node only after discovering its neighbors (start/move reveal them), so a slip target always exists. Add an assertion or a property test so a future fog/content change can't silently trap a player into a forced fight.
- **L2 — slip/retreat noise lands at the destination, not where you fled.** Stage 3 relocates before stage 6 deposits `noiseOf(action)` at `player.location` (`engine/src/pipeline/applyAction.ts` order + `sim/noise.ts:98-103`). Low impact (`SLIP_NOISE = 5`), but the sound semantically belongs at the walker's node.
- **L3 — dead branch in status render [fixed].** `describeStatus` computed a `"closing over"` case that `worstWound()` (which only returns wounds with remainder > 0) can never trigger (`harness/src/play.ts:94`). Removed.
- **L4 — `playByInputs` resolves the session twice.** It folds actions once to build the chosen-id list, then calls `playSession` to resolve them again (`harness/src/play.ts:276-294`). Deterministic, so harmless, but redundant.
- **L5 — resting at low fatigue is a pure loss.** "Rest and recover" is always offered; at fatigue 0 it burns 6h and raises hunger/thirst for no gain (`engine/src/actions/coreActions.ts:96-101`). Consider gating rest on fatigue, or offering a cheaper "wait/watch."
- **L6 — doc drift.** `docs/status.json` says "engine 133"; the suite is now 134. Trivial.

---

## What's solid (verified, not just asserted)

- **Determinism & purity.** No `Date.now`/`Math.random` in `engine/`; every stage is a value-in/value-out transform; the region graph is transient and never serialized.
- **RNG.** `sfc32` + `cyrb128` implemented correctly; named streams are independent and seeded purely from the run seed; state serializes as four uint32s.
- **Save/load.** Lossless round-trip incl. `rng`/`history`/`queue`; strict envelope validation; forward-only migration ladder with a real v1->v2 rung and loop-guard.
- **Telemetry audit (FR-CORE-04).** The no-op-turn invariant is enforced by machine with an honest by-value deep-equal, and `meta` is correctly excluded so the clock can't make it vacuous.
- **Map integrity.** Symmetry, single-start, and connectivity are all checked with clear `MapError`s — exactly the cross-file invariants JSON Schema can't express.
- **Fog of war.** The discovered-vs-visited two-tier model is clean and persists in node memory.

## Post-fix status

`engine 134 · content-loader 9 · harness 36` green · schema gate green · typecheck clean on all three packages, with the H1/L3 fixes in place.
