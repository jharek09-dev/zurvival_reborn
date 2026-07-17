# QA Review — M4 Part 9 (T53): Factions & inter-NPC relationships

**Requirements:** FR-NPC-02 (Must), FR-NPC-05 (Should), FR-NPC-06 (Must), FR-NPC-07 (Should) · GDD Part XII.
**Dependency landed:** the off-screen people-sim (PL-M3-02 / PL-M4-08 remainder / PL-M4-35).
**Result:** one content-driven social system (`sim/social.ts`) over a `graph.factions` pool. CI green (engine 561,
content-loader 9, harness 111, schema gate 160/13 types, malformed rejected, smoke exit 0). No save-schema rung
(stays v10). Cross-tree byte-identity proven (13 seeds, raw, no normalization).

## What shipped

- **Memory → trust/respect/fear (FR-NPC-02).** `respect` + `fear` (0–100) beside T34's `trust`, moved by a bounded
  append-only `memory` (`MEMORY_CAP 12`); `trust` still moves via `applyTrustEvent` (T34/T35/T36 untouched). Surfaced
  as behaviour only (`attitudeRead`), never a number.
- **Ask-for-leads (FR-NPC-06).** `NPCDef.knowledge` authored leads; `ask` a met, trusting survivor and the lead
  **reveals a real node** or **marks a discovery**. 5 leads on cass/walt/sarah, all `reveals` of real, non-adjacent,
  lootable nodes. Told-tracking on `player.flags` (no rung); re-checks co-location.
- **Desertion & betrayal (FR-NPC-05).** Deterministic, hours-based pressure (`DESERT_HOURS 18`, chunk-invariant).
  Driven by the leader's humanity AND individual mistreatment — neglect (own unmet needs), terror (carried fear),
  distrust (neglect erodes companion trust — now bidirectional). A worn-down companion deserts (a legible
  `companionUnease` tell first); a malicious/terrified/cruelly-led one betrays (robs the stash). Never mis-logged as
  `companion.died`.
- **Inter-NPC bonds → shelter morale (FR-NPC-07).** Co-faction survivors bond, rivals clash; shelter morale (aggregate
  resident `mind.morale`) moves with who's home — surfaced as `shelterMoodRead`. 3 factions, two recruitable
  cross-faction rivalries that bite.
- **Off-screen people-sim.** `advanceWorld` drifts non-party survivor needs + the party (once) + morale/desertion;
  stage-10 `moveGroups` graduates from `identity` to a gated `tickGroups` (regroup toward faction home via BFS). All
  gated on `socialActive`.

## Verification

- **Full CI green** in a clean cloud sandbox (fresh `npm install` × 3): engine typecheck + 561 tests, content-loader
  typecheck + 9, harness typecheck + 111, `npm start` smoke exit 0, schema gate 160 entries / 13 types, malformed
  content rejected.
- **Cross-tree byte-identity (the load-bearing guarantee).** A fully-featured scripted run (encounters/radio/recipes/
  jobs pools all active, forced threaten/give paths, `advanceWorld` jumps, 13 seeds) with **no faction pool**, run on
  the pre-T53 baseline tree (extracted from `.sandbox/zb.tgz`) vs the edited tree, holding baseline content constant:
  **identical combined hash, raw, no normalization** (`1b57b308…`) — re-proven after every audit fix. Because a
  pool-less run writes none of the new optional fields, this is the T52-grade proof (stronger than T51's rung).
- **Engine `social.test.ts` (28 tests):** the master gate is inert without a pool (no respect/fear/memory written, no
  groups, tickPeople/tickGroups are no-ops); `seedFactions` populates groups + reputation; memory bounds + the
  trust/respect/fear deltas; `ask` reveals the node / flags told / surfaces the hint / re-offers nothing; desertion via
  neglect under a decent leader; betrayal under a cruel one (takes stash); the menace-then-recruit reachable betrayal
  path; neglect erodes companion trust (bidirectional); time-invariance of desertion pressure; bonds seed relationships
  + lift morale; attitude/unease/mood reads (no number leak); the off-screen needs drift + gated inertness + movement;
  save round-trip lossless at v10.
- **Harness content tests (+5):** ≥3 factions with valid members/home/rivalries over the real cast; membership
  unambiguous; every authored lead points at a real node; a full-content run with the pool turns social on + seeds
  groups; the same content without a pool is inert.

## Adversarial audit → fixes applied (two subagents, each with a follow-up verify pass)

The engineering lens (determinism/byte-identity/save/forged-edges) and the design lens (FR fidelity/no-number-leak/
loops-actually-close/voice) each ran, then re-verified the fixes. 0 BLOCKERs, but a high-value cluster of
"mechanically present but not reachable/surfaced" findings — all fixed and re-verified:

1. **False `companion.died` on desertion/betrayal** (HIGH, eng) — the Living-History death diff inferred death from a
   vanished actor. Fixed: guard on the `left.<id>` flag; genuine deaths still log correctly.
2. **Betrayal was dead code** (HIGH, both) — a companion's respect never fell, so `respect ≤ 20` was unreachable.
   Fixed: `menaced-me` now lowers respect (−6); `recruit()` carries respect/fear/memory onto the companion (a survivor
   menaced into joining stays afraid); betrayal also fires for a deserter under a cruel leader (`humanity ≤ 28`). Now
   reachable in real play.
3. **Desertion ignored individual mistreatment** (HIGH, design) — it read only global humanity, re-introducing the
   "global bar" FR-NPC-02 forbids. Fixed: `moraleTarget` now subtracts neglect (weighted ×1.5), terror, and distrust,
   and neglect erodes companion trust (bidirectional) so the "low trust" desertion FR-NPC-05 names is reachable.
4. **Hollow / dead leads** (HIGH, design) — two `marks`-only leads paid nothing (`node.discoveries` has no reader,
   PL-M4-17), and Walt's `elm-court` lead pointed at a node adjacent to where you ask him (always already discovered,
   so never offered). Fixed: all 5 shipped leads are now `reveals` of real, non-adjacent, lootable nodes.
5. **Respect/fear & shelter morale were write-only** (MED-HIGH, design) — no reader, no prose. Fixed: `attitudeRead`
   (survivors) + `companionUnease` (the desertion tell, a turn or two early — fairness) + `shelterMoodRead` wired into
   `peopleLine`, words only (FR-UI-02-safe).
6. **Per-tick desertion pressure** (LOW-MED, eng) — outcome depended on time-chunking. Fixed: hours-based accrual
   (`DESERT_HOURS`), chunk-invariant for sustained misery.
7. **Inert `dana↔gus` rivalry** (MED, design) — gus never recruits, so the pair never co-resides. Fixed: replaced with
   the recruitable `dana↔marcus`; two rivalries now bite.
8. **Forged `ask` co-location + factions-but-no-jobs off-screen party drift** (LOW, eng) — both re-gated.

**Verify pass verdict:** #1, #3 (individual drivers now real), #4, #5, #6, #7, #8 fully resolved; #2 betrayal reachable
end-to-end (verified firing through `advanceWorld` under cruelty). Residual, accepted as M5-balance parking-lot:
the morale-drift rate vs the need clock (total neglect can starve before it deserts — sustained partial neglect is the
reachable neglect-desertion regime), rivalry magnitude being sub-threshold to solo-cause desertion, and a bounded
desertion-timing granularity only when morale is drifting across the threshold (same class as PL-M4-36). Prose nits
fixed (garden-center spelling; Walt's re-themed gun-shop lead).

## Parking lot / deferrals

- **PL-M4-40** — social dials (M5 balance T59/T60), incl. the three accepted first-pass tuning gaps above.
- **PL-M4-41** — a `node.discoveries` reader so a `marks` lead pays out (extends PL-M4-17); all T53 shipped leads use
  `reveals`, so nothing hollow ships.
- **PL-M4-42** — FR-NPC-09 Storyteller surfacing, FR-NPC-08 personal quests/romance, FR-NPC-10 full faction diplomacy.
- **PL-M4-43** — consequential faction reputation (priced trade / raid stance) + `Survivor.groupId` wiring.
- **PL-M4-44** — respect's own reachable behavioral consequence (it currently reads mostly through the hard turns).
