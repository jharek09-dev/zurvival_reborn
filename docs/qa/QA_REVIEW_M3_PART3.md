# QA Review — M3 Part 3 (T37–T38)

_Reviewed 2026-07-06. Scope: shelter — the first place on the map that is yours. New engine module
`prototype/engine/src/sim/shelter.ts` (T37 claim + T38 fortify/upkeep) and the state/scene/pipeline/
history/zombie wiring it touches (`actions/coreActions.ts`, `pipeline/applyAction.ts`, `sim/zombies.ts`,
`sim/history.ts`, `index.ts`), plus `test/shelter.test.ts`. Focus: correctness, determinism +
save-losslessness, the **no-schema-rung** decision (reserved `player.shelterId` / `NodeState.barricades`
populated), FR adherence (FR-SHL-01/02 VS subsets), and whether "a base that is yours" actually changes
how a run plays._

## Verdict

Part 3 turns the map from uniformly hostile into somewhere with a fixed point you own. Claiming a
searched-clean node plants a flag (`player.shelterId`); fortifying it with scrap + time raises
`NodeState.barricades`, which decays and must be topped up; and a fortified base pays off in three
integer-scaled protections — it muffles its own noise (so hordes are less drawn — one mechanism, both
"dampen node noise" and "resist horde drift"), raises a detection floor against the dead (dormant by day
at full fortification; a stalker at night reduced, never nullified), and rests you deeper. The property
M3 most puts at risk holds: **determinism** — no RNG stream is opened and both reserved fields were inert
in every prior run, so all M2/M3P1/M3P2 golden runs are byte-identical. And for the first time a shelter
block ships with **no save-schema rung** — the shape was reserved in T3, so `SAVE_SCHEMA_VERSION` stays 6
and a claimed, fortified run round-trips losslessly with zero migration.

All suites are green in a clean Linux environment (**engine 322 (+26) · content-loader 9 · harness 42 ·
typecheck clean across all three packages · schema gate pass over 6 types / 18 entries · malformed
content still rejected · harness empty-turn end-to-end**). A scripted full slice —
search → claim → fortify → rest — reproduced **byte-for-byte** from its seed, round-tripped losslessly,
kept every numeric leaf an integer, and every resolved shelter turn moved a tracked system (FR-CORE-04
clean: claim moves `player`, fortify moves `nodes` + `player`). The 14-stage pipeline order is unchanged
(stage 6's body grew, its name did not), and every new code path is provably inert on an unsheltered
state, so nothing prior is disturbed.

The claim gate, one-shelter-per-run rule, fortify cost/cap, upkeep decay, noise muffle, detection floor,
and deeper rest all behave as the plan specifies. Findings below are about *reach* and *deliberate
deferrals*, not defects in what shipped.

---

## What was checked and is solid

- **Claim is earned and singular.** Offered only on a node you have **searched clean** (`searchPct >=
  100`) while you hold **no shelter yet** — so the start-node choice set (T12) is unchanged, and one
  active shelter per run is enforced (FR-SHL-01). Claiming sets `shelterId`, costs `CLAIM_COST` hours,
  logs `shelter.claimed`, and is a resolved `player`-changing turn (no no-op). Re-claim and unsearched
  claim are both inert.
- **Fortify is a real resource trade.** Offered only at your own base, carrying `item.scrap` (already in
  the T17 loot tables), below the cap. Spends **one scrap** and `FORTIFY_COST` hours to raise `barricades`
  by `FORTIFY_GAIN`, clamped at 100 (bare→full = 4 scrap + 12 hours). Through the pipeline it moves
  `nodes` + `player` and logs `shelter.fortified` only on a genuine rise (a decay-only turn logs nothing).
- **Upkeep has teeth.** `barricades` erode by `FORTIFY_DECAY_PER_HOUR` per hour in stage 6, floored at 0;
  a neglect run (rest at the base without re-fortifying) measurably drains the fortification over turns.
  Decay only ever touches a node with `barricades > 0` (in practice only the shelter), so every prior run
  — all barricades 0 — is untouched.
- **The payoff is real and legible, and scales from zero.** Every protection is
  `trunc(max * barricades / 100)` — nothing at a bare claim, full at 100. Noise muffle leaves a fortified
  base quieter after a loud search than an unfortified one (verified, and the mechanism the horde re-path
  reads). The `stimulusAt` detection floor is exactly `scaleByFort(SHELTER_DETECT_FLOOR_MAX, barricades)`:
  a full base goes **dormant by day** under the player's mere presence where an unprotected node would
  chase, while a **stalker at night stays a threat** (reduced, never nullified) — fortification helps, it
  is not god-mode. Deeper rest recovers a base bonus plus a fortification-scaled amount, only at the base.
- **No schema churn.** The two facts a shelter needs (`player.shelterId`, `NodeState.barricades`) were
  reserved in the T3 shape and never written before this block, so populating them is not a shape change —
  no rung, `SAVE_SCHEMA_VERSION` stays 6, and a claimed/fortified state round-trips deep-equal. This is
  the same "populate a reserved shape" move T36 made for `actors`.
- **Inert on old state, order intact.** `decayShelterFortification`, `muffleShelterNoise`,
  `applyShelterRest`, `shelterChoices`, and `shelterLine` all no-op on `shelterId === null`; the M0
  empty-turn contract and the 14-stage order (`pipeline.test`) are untouched, and the 322-test suite
  (including the T13 100-turn FR-CORE-04 audit) is green.

---

## Medium

### M1 — Fortification decays only on the player's turns, not off-screen

Upkeep decay lives in pipeline stage 6, so a base you walk away from does **not** erode while you are
elsewhere — `advanceWorld` (the off-screen fast-forward) leaves `barricades` untouched, kept that way this
block to preserve byte-identity. This is intended and consistent with the still-deferred off-screen
people-sim (PL-M3-02), but it means "upkeep" is currently a pressure you only feel while sitting at home;
a base is never weaker for having been abandoned for days. Flagged to land with off-screen upkeep.

### M2 — The base has no attacker yet, so its defence is only ever tested passively

A fortified shelter *resists* detection and horde drift, but nothing yet **assaults** it — there is no
night-raid or horde-siege event that turns the base's fortification into a defended fight, and no
raided-stash beat (the stash itself is T39). So the payoff is measurable in the sim (quieter node, lower
stimulus, dormant-by-day) but not yet dramatised as a scene the player sweats through. The reactive-world
hooks for that arrive with T39/T40; until then, fortification buys safety the player must infer from
*absence* of danger rather than survival of an attack.

---

## Low

- **L1 — `barricades` is reused as the fortification field.** The shelter's fortification level is the
  reserved generic `NodeState.barricades` (0–100). Clean for the VS (and the intended use of the reserved
  field), but if a later feature wants node-generic barricading (barricade any node briefly), the two
  meanings will need untangling — noted so the coupling is deliberate, not accidental.
- **L2 — Claim is once-per-run with no relocate or abandon verb.** You cannot move your base or give it
  up; the first place you claim is the only one. Fine for the one-shelter VS, but a player who claims early
  and then finds a better building is stuck. A relocate/abandon verb (and what happens to the old base's
  barricades/stash) is post-VS.
- **L3 — Fortifying is silent.** Building barricades deposits no noise, to protect the safe-base fantasy;
  the more realistic reading (hammering draws the dead) is a deliberate non-choice for the VS and a tuning
  lever if the base ever needs a build-time risk.
- **L4 — Tuning is first-pass.** Costs and rates (`CLAIM_COST 4`, `FORTIFY_COST 3`, `FORTIFY_GAIN 25`,
  `FORTIFY_DECAY_PER_HOUR 1`, the three `*_MAX` payoffs) are reasoned, not yet balanced against a real run;
  they are the dials the Slice Fun Gate (T42) and M5 balance pass will move.
- **L5 — The detection floor can discount ambient node noise, not just presence.** The floor subtracts
  from the *total* stimulus at the shelter, so at very high ambient noise it also blunts that a little, not
  only the presence/scent/night bonuses. Immaterial at slice scale (a base you keep muffled is quiet
  anyway), but worth noting the floor is total-stimulus, not presence-only.

---

## Suggested follow-ups (owner's call)

1. **Shared stash (T39 · FR-SHL-03/FR-PLR-04)** — the next block: a store at the base separate from the
   carry budget, so a run can bank surplus; its depletion/theft hooks are where M2 (the raid beat) starts
   to land.
2. **A night-raid / siege event (T40 contested-world hook)** — turn the base's fortification into a
   defended fight, so the payoff is dramatised, not only inferred (addresses M2).
3. **Off-screen shelter upkeep** — decay `barricades` inside `advanceWorld` alongside the deferred
   off-screen people-sim, so abandoning a base costs you (addresses M1 / PL-M3-05).
4. **Balance the shelter dials at the Fun Gate (T42)** — claim/fortify costs, decay rate, and the three
   payoff maxima against a real Rivermouth run (addresses L4).
