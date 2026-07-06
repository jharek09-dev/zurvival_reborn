# QA Review — M2 Part 2 (T28–T32 + surfacing)

_Reviewed 2026-07-05. Scope: the two newly-live world-sim layers and the systems around them —
`prototype/engine/src/sim/{timeOfDay,routes,director,history}.ts`, `src/telemetry/pacing.ts`, the
pipeline/state/save/scene wiring they touch, and the scene-surfacing pass in `actions/coreActions.ts` +
`harness/src/play.ts`. Focus: correctness, determinism + save-losslessness, FR adherence,
maintainability, and whether the reactive world is now actually **felt**._

## Verdict

Part 2 is in good shape and closes M2's mechanical scope: all six world-sim layers are now live, and the
two properties M2 puts most at risk — determinism and save-losslessness — still hold **end to end** with
five more systems in the loop. All suites are green in a clean Linux environment (**engine 239 ·
content-loader 9 · harness 39 · schema gate pass over 5 types / 15 entries · typecheck clean across all
three packages · harness empty-turn end-to-end**). An independent 60-turn Rivermouth run with every M2
system live reproduced **byte-for-byte** from its seed, round-tripped losslessly across the new
`SAVE_SCHEMA_VERSION` 3→4 bump, recorded its own Living History, and kept the FR-CORE-04 audit clean
(**0 no-op turns**). Exactly one schema bump landed this block, with one additive forward-only rung, per
the ADR-0003 ladder.

Two of the four Part-1 parking-lot items are addressed: the reactive world is now **surfaced** in the
Scene (H1 / PL-M2-01), and the director gives the world a **directed escalation bias** so an unwatched
district festers instead of calming (PL-M2-03) — demonstrated by a property test where an 8-day idle
`advanceWorld` leaves density measurably higher with the director on than off, both legal. The findings
below are limitations and owed work, not defects in what shipped.

---

## What was checked and is solid

- **Determinism + save-losslessness, end to end.** Two identical 60-turn real-content runs are
  byte-identical; `loadGame(saveGame(state))` is deep-equal after the living world moved; the v3→v4 rung
  (`migrateV3toV4`, seeds `routes: {}`) chains cleanly behind the v1→v2→v3 rungs and is unit-tested (an
  old save loads with an empty routes slice at version 4). No new RNG stream was added — time-of-day,
  routes, the director, and history are pure functions of existing state — so every Part-1 golden run is
  unchanged.
- **Legality of the director (the FR-SIM-10 DoD).** A property test over arbitrary pressure/density/hours
  shows the director never moves a dial outside 0–100; a disable flag (`world.flags["director.disabled"]`)
  turns the nudges off while the world still runs. The T32 telemetry harness then shows director-on vs
  director-off produce **different** pacing metrics from the same seed, with every sample in-bounds — the
  DoD, proven rather than asserted.
- **The six-layer substrate is now fully live.** `timeOfDay` and `director` graduated from no-ops by
  swapping their `tick`; the six ids and the pipeline stage order are unchanged (both order assertions
  green), and `tickWorld` still equals folding exactly the six layers by hand (routes are a stage-8
  effect, not a seventh layer).
- **Selective Living History.** The log records only notable events, so `history` is *not* a
  vacuously-always-changed system in the audit; append-only and never rewritten; save-lossless.
- **Surfacing is real and screen-reader-safe.** Weather, the danger tide, an approaching horde, a
  screamer's shriek, and each route's condition + added cost now reach `scene.narration` and the header,
  all in words — verified over shipped Rivermouth content.

---

## Medium

### M1 — The Screamer is now *narrated* but still fights like a plain walker (PL-M2-02 persists, now more visible)

The surfacing pass will announce *"a shriek goes up close by — a screamer"* when a screamer-typed node is
roused. But combat still begins a generic `WALKER_ENEMY` fight regardless of `zombieState` or
`zombieTypes` — the Part-1 M1 finding is untouched. The net effect is arguably *worse for expectations*
than before: the world now promises a distinct threat in prose that the encounter does not deliver. This
is filed Medium (not High) because it was explicitly out of Part-2 scope (PL-M2-02) and the surfacing is
otherwise honest, but coupling types to combat should be the very next M2 follow-up so narration and
mechanics agree.

### M2 — `RegionState.threat` now has a directed writer, softening T24's "threat is a consequence" model

T24 framed threat as derived (it relaxes toward `density/2 + fire/2`, never free-floating). The director
now adds a bounded ±1 directed nudge to threat on an escalate beat, so threat is no longer *purely* a
consequence of density/fire. This is intentional and bounded (and is exactly the PL-M2-03 fix), but a
reader of `regionDrift.ts` alone would not expect it; the coupling is only obvious from `director.ts`.
Acceptable, noted so the two writers are documented in one place when threat tuning happens in M5.

---

## Low

- **L1 — Escalation is player-region-only.** The director nudges only the region the player stands in, so
  with a single shipped region it drives the whole map, but a *truly* unwatched **other** region (M4+,
  multi-region) would not yet escalate on its own. The hook is there (it reads `player.location`'s
  region); generalising to "the most-neglected region" is M4 work.
- **L2 — The "rising threat" read is level-based, not delta-based.** `worldLead` surfaces a mounting
  district off an absolute threshold (threat ≥ 60), not an actual turn-to-turn rise, because `sceneOf` is
  stateless. The real deltas live in the Living History; the felt read is a proxy. Fine for now.
- **L3 — Living History is unbounded (PL-M2-06).** Append-only with no cap; a very long run grows the
  save. Faithful to "never rewritten," but a rolling window / summarisation is owed before long-session
  soak testing.
- **L4 — Combat slip/retreat ignore route conditions (PL-M2-05).** Fleeing uses `SLIP_COST`, not route
  wear, so a stealth escape is never blocked or made costlier by a flooded road. Deliberate — a fight
  must never strand the player behind a blocked route — but worth a conscious revisit.
- **L5 — Per-turn world cost grew again.** Every turn now also scans all routes (T29) and diffs
  before/after for history (T31), on top of Part-1's O(nodes + regions + hordes). Negligible at Rivermouth
  scale; on the watch-list against the "instant on a mid-range phone" target as the map/horde count grows.
- **L6 — In-run pacing over long sessions is under-exercised.** The T32 director-vs-director DoD and the
  escalation demonstration run **off-screen** via `advanceWorld` to sidestep the survival clock, which
  still ends a rest-only run around turn ~24 (the standing M1 "opening too calm / survival economy"
  note). The pacing baseline is sound; a long *played* pacing soak waits on survival-economy tuning.

---

## Suggested follow-ups (owner's call)

1. **Couple zombie state/types to combat (M1 / PL-M2-02)** — now the highest-value next step: the world
   both *drifts* and *narrates* distinct threats, but the encounter still doesn't read either. Give the
   machine and the types teeth; give the marina Stalker a body.
2. **Wire weather `noiseFactor` into the T14 deposit and loop `advanceWorld` hour-by-hour (PL-M2-04)** —
   the last Part-1 owed items; the hour-by-hour loop also makes the step-based layers (zombie ladder,
   weather) scale honestly over a large off-screen jump.
3. **Bound the Living History (PL-M2-06)** and generalise director escalation beyond the player's region
   ahead of M4's second region (L1).
