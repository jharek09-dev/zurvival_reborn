# QA Review — M3 Part 2 (T35–T36)

_Reviewed 2026-07-06. Scope: the people layer made perceivable and consequential —
`prototype/engine/src/sim/encounters.ts` (T35) and `src/sim/companions.ts` (T36), the state/save/scene/
pipeline/history wiring they touch (`state/types.ts`, `save/saveGame.ts`, `sim/npcs.ts`,
`actions/coreActions.ts`, `pipeline/applyAction.ts`, `sim/history.ts`, `index.ts`), and the harness
surfacing (`harness/test/encounters.test.ts`). Focus: correctness, determinism + save-losslessness, the
single additive schema bump, FR adherence (FR-NPC-01 surfacing, FR-NPC-03/04 VS subsets), and whether the
first recruit-and-lose loop actually lands._

## Verdict

Part 2 turns the silent people substrate into a played one, exactly as scoped: a survivor is now met,
fed, threatened, recruited, kept, and lost — and the needs and trust models T33/T34 proved in the dark
finally bite. The two properties M3 puts most at risk both hold: determinism (interactions open no RNG
stream, so every M2/M3P1 golden run is byte-identical) and a clean forward migration (one additive rung).
All suites are green in a clean Linux environment (**engine 296 (+31) · content-loader 9 · harness 42
(+3) · typecheck clean across all three packages · schema gate pass over 6 types / 18 entries · malformed
content still rejected · harness empty-turn end-to-end**). A scripted full-slice run — meet → recruit →
travel → keep — reproduced **byte-for-byte** from its seed, round-tripped losslessly across the new
`SAVE_SCHEMA_VERSION` 5→6 bump, and kept the FR-CORE-04 audit clean (every resolved interaction moved a
tracked system). Exactly one schema bump landed, one additive forward-only rung, per the ADR-0003 ladder.

The four interaction verbs, the `alive`/needs teeth, recruitment's `npcs → actors` graduation, companion
follow + upkeep + permanent remembered death, and the Living History events all behave as the plan
specifies. Findings below are about *reach* and *deliberate deferrals*, not defects in what shipped.

---

## What was checked and is solid

- **The verbs move the right state, and only offer when they make sense.** Talk flips `met` (a one-shot,
  gated by `canParley`); share food/water spends one player item, buys the survivor's need down by the
  same relief the player gets, and raises trust (`share +10`), offered only when carried and the need is
  pressing (`>= RELIEF_OFFER_AT`); threaten lowers trust (`−20`). Each interaction is a resolved turn that
  moves `npcs`/`player`/`actors` — no no-op turns (FR-CORE-04 verified through `applyAction`).
- **A survivor turns, and it sticks.** Pushed below `PARLEY_MIN`, `canParley` goes false, so talk/share/
  recruit/threaten stop being offered and the narration reads them as closed; ticking hundreds of hours
  does not thaw them (the no-regen "betrayal sticks" property, proven end to end).
- **`alive` finally flips.** `driftNpc` kills a survivor whose hunger or thirst saturates (`NEED_FATAL`),
  mirroring the player's own starvation/dehydration end; a property test confirms any positive drift at a
  saturated need is lethal, and the dead survivor persists as an inert, un-offered body.
- **Recruitment is a real graduation.** A `met` survivor at `trust >= 70` is promoted out of `npcs` into
  an `actors` `Survivor` flagged a companion, at the player's node, needs carried over; the `npcs` entry
  is removed. Gated correctly: unmet-but-trusted and met-but-untrusting both refuse the offer.
- **Companions live in the sim.** Stage 5 drifts their needs and keeps them at the player's side (verified:
  a companion follows across a move); they are fed from the player's pack through the same share verbs;
  both ticks stay inert on a zero-hour turn / empty party (empty-turn contract intact).
- **Permanent, remembered death (FR-NPC-04).** A neglected companion is removed from `actors` for good
  (does not return on later ticks), remembered by a `fallen.<id>` flag on the player, and logged
  `companion.died` in the append-only history; `killCompanion` exposes the same transition for a future
  combat death.
- **One clean schema bump.** `NPCState.met` is the only shape change; `migrateV5toV6` adds `met: false` to
  every survivor in an old save and chains cleanly behind v1→…→v5 (an old v5 save loads its survivors
  unmet at version 6; a v1 save still ladders all the way forward). `actors` is populated by runtime
  transition on an always-present, always-`{}` collection, so T36 rides no rung. Save round-trips are
  deep-equal with a live companion.
- **The 14-stage order and the reserved shapes are untouched.** Stage 5's body grew (npcs + companions)
  but its name and the 14-stage order are unchanged (`pipeline.test` green); `groups` was not touched.

---

## Medium

### M1 — A companion's only upkeep is your pack, so a supply-poor run loses them by design

Companions never eat on their own; their needs are relieved only by the player's `give-food`/`give-water`
(from a finite pack). Over a long stretch without resupply, a companion's needs climb to lethal and they
die — the FR-NPC-04 permanent death, reached by attrition. This is intended (it is what gives keeping a
companion real cost), and it is avoidable (feed them), but it means a companion is a **standing drain**
with no autonomy to feed itself. Flagged as the balance knob to watch once shelter/stores (T37+) give a
companion somewhere to draw from; until then, recruiting is a commitment the slice does not soften.

### M2 — The character flavour is unlocked but not yet surfaced by the engine

`talk` flips `met` and gates recruitment, but the FR-NPC-01 payload it exists to reveal —
background/personality/**secret** — lives in content the engine does not hold, so the engine narration
names a survivor and reads their disposition/needs but cannot speak their story. The harness carries the
name + verbs in plain text (surfacing test green), yet the *secret* reveal is deferred to the client /
T41 Storyteller (FR-NPC-09), as the plan states. Correct by scope, but it means the emotional half of a
"meeting" cannot be judged engine-only from Part 2 — the same call M2/M3P1 made about their silent halves.

---

## Low

- **L1 — A companion carries no `name` in state.** The recruited `Survivor` denormalises no name (it is
  recoverable from `type` via content), so engine-side companion prose is generic ("your companion") and
  labels read "Share food with your companion." Fine for a one-companion slice; multiple companions or a
  client that wants named party prose will want the name threaded (a `name` on the reserved shape, or a
  content lookup in the client).
- **L2 — Threaten has no upside yet.** It only spends trust; there is no intimidation payoff (info, a
  forced trade). `TRUST_DELTAS.threaten` is wired, but "threaten *for* something" is future work — today
  it is purely how you burn a relationship.
- **L3 — Recruitment reads trust but not disposition or capacity.** Any `met` survivor at `trust >= 70`
  can join, with no party cap and no check on whether a `hostile`-disposition survivor should be
  recruitable at all. One companion is the VS target, so unbounded party size is untested at scale.
- **L4 — No off-screen people-sim, and survivors still don't move.** Survivors and companions drift only
  on the player's turns (stage 5), not inside `advanceWorld`; non-companion survivors stay pinned to their
  node. Deferred by plan (the people side of stage 10), but a survivor you leave starving in a district
  you fast-forward past does not actually die until you return and spend a turn there.
- **L5 — A dead survivor lingers in `npcs` forever.** Bodies persist (by design, as a remembered corpse
  the narration reads), so the pool only grows. Negligible at slice scale; worth a sweep before the pool
  grows toward the FR-NPC-01 target of 60–100.

---

## Suggested follow-ups (owner's call)

1. **Shelter & stores (T37+)** — give a companion and the survivors somewhere to draw upkeep from, so
   keeping people is a base-building loop, not only a pack drain (addresses M1).
2. **Surface the secret as a narrative moment (T41 · FR-NPC-09)** — the Storyteller reveal that pays off
   `met`, so a meeting lands emotionally and not just mechanically (addresses M2).
3. **Off-screen people-sim + survivor movement (the people side of stage 10)** — let survivors get hungry,
   move, and die whether or not they are watched, as the world already does (addresses L4).
4. **Companion orders + combat participation (FR-NPC-03 full)** — the autonomy the VS deferred; the
   `killCompanion` seam is already in place for a combat death.
