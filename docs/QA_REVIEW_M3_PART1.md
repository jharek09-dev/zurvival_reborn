# QA Review — M3 Part 1 (T33–T34)

_Reviewed 2026-07-06. Scope: the people substrate M3 stands on — `prototype/engine/src/sim/npcs.ts` and
`src/sim/trust.ts`, the state/save/seed/pipeline/telemetry wiring they touch
(`state/types.ts`, `state/createInitialState.ts`, `save/saveGame.ts`, `telemetry/turnAudit.ts`,
`map/seedWorld.ts`, `pipeline/applyAction.ts`, `index.ts`), the new `content/npcs/` +
`content/schemas/npc.schema.json`, and the harness `playCli` wiring. Focus: correctness, determinism +
save-losslessness, FR adherence (FR-NPC-01/02 VS subsets), and whether the substrate is clean enough to
carry T35–T42._

## Verdict

Part 1 is in good shape and lands the M3 people substrate exactly as scoped: a run now carries named
survivors with their own state, needs, disposition, and trust, all deterministic and save-lossless. The
two properties M3 puts most at risk — reproducibility with a new randomised system, and a clean forward
migration — both hold. All suites are green in a clean Linux environment (**engine 265 (+26) ·
content-loader 9 · harness 39 · typecheck clean across all three packages · schema gate pass over 6
types / 18 entries · malformed content still rejected · harness empty-turn end-to-end**). An independent
40-turn Rivermouth run with the shipped survivor pool reproduced **byte-for-byte** from its seed,
round-tripped losslessly across the new `SAVE_SCHEMA_VERSION` 4→5 bump, kept the FR-CORE-04 audit clean
(**0 no-op turns**), and left every survivor persisted and simulated. Exactly one schema bump landed
this block, with one additive forward-only rung, per the ADR-0003 ladder.

This is deliberately an **engine-first** block — no client surfacing ships, mirroring M2 Part 1. The
findings below are therefore about *reach* and *consequence*, not defects in what shipped.

---

## What was checked and is solid

- **Determinism with a new randomised system.** Spawn draws from a *new* named `npc` RNG stream, so no
  existing stream's sequence shifts — every M2 golden run and all 239 prior engine tests are unchanged,
  and two identical 40-turn runs are byte-identical. A homed survivor is pinned to its `homeNode`
  regardless of seed; a homeless one is stream-placed and moves with the seed (proving the stream, not
  luck, drives placement).
- **Save-losslessness + the migration rung.** `loadGame(saveGame(state))` is deep-equal with a populated
  `npcs`; the v4→v5 rung (`migrateV4toV5`, seeds `npcs:{}`) chains cleanly behind the v1→v2→v3→v4 rungs
  and is unit-tested (an old v4 save loads with an empty pool at version 5).
- **The empty-turn contract and the 14-stage order hold.** NPC needs drift is wired into the **stage-5
  body** (`updateCompanions`) with the name and the 14-stage order unchanged (the `pipeline.test` order
  assertion stays green); a zero-hour `wait` and an empty pool are both inert. `npcs` is now an audited
  system (FR-CORE-04) and a resolved turn that drifts a survivor reports it.
- **Trust behaves as specified (FR-NPC-02 VS subset).** Deltas are asymmetric (harm > help), both clamps
  hold, tiers and the `canParley`/`canRecruit` gates flip at their thresholds, and starting trust tracks
  disposition. The "no free regen — a betrayal sticks" property is proven, not asserted: a robbed
  survivor's trust is unchanged after ticking needs over hundreds of hours (property test), and unchanged
  across a full 40-turn run end-to-end.
- **Content is schema-first and honest.** `content/npcs/` sits behind `npc.schema.json`; the gate now
  validates 6 types / 18 entries and still rejects the malformed fixture. The three survivors carry the
  FR-NPC-01 character flavour (background, personality, secret) the later dialogue tasks will surface.
- **The `actors`/`groups` placeholders were left untouched.** `npcs` is a clean new slice, so the
  reconciliation with the reserved companion/faction records is deferred to T36 without muddying this bump.

---

## Medium

### M1 — Survivors are computed but invisible in play (the felt half waits on T35/T41)

Exactly as M2 Part 1 shipped a silent reactive world, Part 1 ships a silent people layer: a player
cannot yet meet Sarah, see her disposition, or spend trust — nothing reaches `scene.narration` or the
choice set. This is by design (the plan defers surfacing to T35 dialogue and T41 story-in-the-Scene), and
the substrate is correct underneath, but it means the *perceivable* half of the M3 fun-gate cannot be
judged from Part 1 at all. Filed Medium (expected, not a defect) and flagged as the highest-value next
step — the same call the M2 Part-1 review made about H1.

### M2 — The needs model is real but currently toothless (`alive` is inert; needs saturate)

Survivors' needs drift correctly, but in Part 1 there is no NPC eat/drink relief, no death, and no
behaviour change — so a survivor left alone simply climbs to fully-unmet needs and sits there. Over the
40-turn run Sarah's thirst reached 100 and she stayed alive and unchanged. The drift is honest and
deterministic, but it has **no consequence yet**: `alive` is a field nothing flips, and saturated needs
do nothing. This is intentional scope (death/relief are T35/T36 transitions), but it should be the very
next thing given teeth so the world's "someone to threaten besides the player" (the T33 note's promise)
is actually threatened.

---

## Low

- **L1 — `tickNpcs` re-allocates even at saturation.** `driftNeeds` always returns a fresh object, so a
  living survivor whose needs are already pinned still yields a new `NPCState` each resolved turn. The
  FR-CORE-04 audit is value-based (`jsonEqual`) so this is never miscounted as a change, but it is minor
  churn; a value-equality short-circuit in `driftNpc` would avoid it. On the watch-list with L5.
- **L2 — NPC instance id equals content id.** One instance per definition in the slice, so `npc.id ===
  npc.type`. Fine now; multiple instances of a type (or procedural survivors) will need a distinct
  actor-id scheme — the `ActorId`/`type` split already present on the reserved `Survivor` shape.
- **L3 — No off-screen NPC drift.** Survivors age only on the player's turns (stage 5), not inside
  `advanceWorld` (which is world-only). A survivor in a district you fast-forward past does not get
  hungrier. Deferred by plan; note before off-screen people-sim lands.
- **L4 — `canParley`/`canRecruit` are tested but unused.** No caller yet — dead-until-T35/T36 by design;
  flagged so they are wired, not forgotten.
- **L5 — Per-turn cost grew slightly.** Every resolved turn now also scans the pool for needs drift, on
  top of M2's per-turn world scans. Negligible at slice scale (three survivors); on the watch-list as the
  pool grows toward the FR-NPC-01 target of 60–100.

---

## Suggested follow-ups (owner's call)

1. **Surface survivors and their choices (T35)** — now the highest-value step: meeting a survivor as a
   Four-Questions lead with talk/trade/help/threaten choices, wiring `applyTrustEvent` and `canParley` to
   real, costed options. This is what lets the M3 "a run becomes a story" read begin to be felt.
2. **Give `alive` and needs teeth (T35/T36)** — a starving survivor can die or leave; feeding one is a
   real resource trade; a threatened one turns. Without consequence the needs and trust models are honest
   but inert.
3. **Off-screen NPC drift + movement** — tick survivors inside `advanceWorld` and let them move (the
   people side of stage 10), so the pool lives whether or not it is watched, as the world already does.
