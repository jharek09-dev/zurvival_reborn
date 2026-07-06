# QA Review — M3 Part 4 (T39–T42)

_Reviewed 2026-07-06. Scope: the shared stash (T39), the first authored story arc (T40), the arc surfaced
in the Scene (T41), and the Slice Fun Gate **prepared, not passed** (T42). New engine modules
`prototype/engine/src/sim/stash.ts` and `prototype/engine/src/sim/story.ts`, the state/save/pipeline/
scene/shelter/startRun wiring they touch (`state/types.ts`, `state/createInitialState.ts`,
`save/saveGame.ts`, `pipeline/applyAction.ts`, `actions/coreActions.ts`, `sim/shelter.ts`,
`map/seedWorld.ts`, `index.ts`), new authored content (`content/arcs/…` + `content/schemas/arc.schema.json`),
and the tests (`engine/test/{stash,story}.test.ts`, `harness/test/{story,content}.test.ts`). An
independent adversarial subagent review of the engine diff was run; its one material finding was fixed
and regression-tested (below). Focus: correctness, determinism + save-losslessness, the one additive
schema rung vs. the reserved-shape reuse, FR adherence (FR-SHL-03/FR-PLR-04/FR-STORY-01/FR-UI-STORY), and
whether **a run now reads as a story**._

## Verdict

Part 4 closes the M3 build. The base gets a **warehouse** (`player.stash`) it can bank surplus into and
that the contested world can raid; the run gets its **first authored story** — *The Last Customer*, a
deterministic trigger chain in which Ruth turns up desperate at the base you fortified, you spend the
cache you banked to take her in or turn her away, and a day later she repays you or comes back for what
you would not give; and that story is **legible in the Scene** — the plea and its costed fork read in the
same plain-text, keyboard-only screen as the weather and the horde. The four M3 promises — people,
shelter, a shared stash, a story — stand in one frame.

The properties M3 most puts at risk hold. **Determinism:** no RNG stream is opened (every trigger is a
predicate, every consequence a fixed transform), and stash ordering is stable-sorted, so the whole arc
replays byte-for-byte from a seed. **Inert on prior state:** the stash is empty, `story.progress` is `{}`,
and `queue` is `[]` in every prior run, so `evaluateArcs`, `resolveDueStoryEvents`, `stashChoices`,
`storyChoices`, and the two graduated pipeline stages are true no-ops there — every M0–M3P3 golden run is
byte-identical. **Save-losslessness:** the block adds exactly **one** additive schema rung — `player.stash`,
`v6 → v7` — with a forward-only idempotent migration; `story.progress` and `queue` rode reserved-and-inert
T3 shapes and needed **no rung**. A stashed, mid-arc run round-trips deep-equal, and an old v6 save loads
forward with an empty cache.

All suites are green in a clean Linux environment (**engine 348 (+26) · content-loader 9 · harness 47
(+5) · typecheck clean across all three packages · schema gate pass over 7 types / 19 entries · malformed
content still rejected · harness empty-turn end-to-end**). The 14-stage pipeline order and names are
unchanged — stages 12 (`resolveQueue`) and 13 (`evaluateStory`) graduated their bodies only, exactly as
M2 graduated its world stages. FR-CORE-04 stays clean: a plea-trigger turn moves `story` + `history`, a
help/refuse turn moves `player`/`npcs`/`story`/`queue`/`history`, and a due-consequence turn moves the
same — and deposit/withdraw are 0-hour (like the T18 drop), correctly outside the resolved-turn audit
while still changing `player`.

An end-to-end playthrough (`docs/qa/FUN_GATE_SLICE.md`, both branches) reads as a story start to finish
and is the input to T42 — **the owner's human verdict, which this block deliberately does not render.**

## What was checked and is solid

- **The stash banks surplus off the weight budget.** Deposit/withdraw are offered only while standing in
  your own shelter (`shelterId === here`), one per relevant stack, **free** (0h — base management, mirroring
  the T18 drop). A deposit lightens the pack by exactly the item's weight while the cache adds none
  (`inventoryWeight` reads `inventory` only), so a run banks surplus and **weight still bites on the road**;
  withdraw is gated on `fits()` so it can never overflow the pack. Away from the base, nothing is offered.
- **The raid hook is real and reproducible.** `depleteStash(state, n)` peels `n` units in stable
  (alphabetical) type order via the shared `removeStashUnits` and logs a single `stash.raided` beat; it is
  inert on an empty cache or `n ≤ 0` (no fabricated change). T40's cold branch rides it.
- **The arc is opt-in, so nothing prior is disturbed.** An arc exists in a run only once `registerArcs`
  seeds `story.progress[arcId]` (threaded through `startRun`'s new `arcIds`); with no arc registered,
  `activeArcs` is empty and every arc function returns the same reference / an equal value. A registered
  arc's plea fires only when the full predicate holds — you hold a shelter, you have met the subject, she
  is alive, and her T33 needs crossed `needThreshold` **at your base** — and it cannot double-fire
  (guarded on `beat === ARC_DORMANT`).
- **The costed fork bites and the consequence ripples.** Take-her-in spends `stashDraw` cache units + time,
  eases her needs, lifts trust `+25`, and enqueues the good repayment; turn-her-away drops trust `−35`
  below parley (a betrayal that sticks — `canParley` false) and enqueues the cold return. Both early-return
  unless `beat === ARC_PLEA`, so a stale/duplicate action is inert. The good branch (take-in) is offered
  only when the cache can cover the draw, so **the stash you banked gates the kind ending** — a lovely
  systemic tie between T39 and T40.
- **The delayed consequence resolves once, when due.** Stage 12 (`resolveQueue`) resolves a story event
  when `dueDay/dueHour` are reached (inclusive on the exact hour), applies the ripple (good: supplies
  cached back + more trust; cold: `depleteStash` + a barricade hit — the raided-stash beat), advances the
  beat to its terminal value, appends a closing `story.beat`, and **removes the event from the queue**;
  non-story and not-yet-due queue events are preserved. It cannot resolve twice (the beat no longer
  matches) or leak (dropped on resolution).
- **The run reads as a story, in words, by number key.** `storyLine` composes the live beat into
  `sceneOf`'s narration after the world/people/shelter leads; the arc's choices arrive via
  `availableActions`. The existing T19 client renders both with no rewrite; the harness proves the plea in
  the story region, the fork as numbered choices with costs, and selection by number alone (NFR-ACC-01/02).
- **Authored content is validated and drift-guarded.** `content/arcs/arc.rivermouth.the-last-customer.json`
  + `content/schemas/arc.schema.json` grow the schema gate to 7 types / 19 entries; a harness integrity
  test asserts the content's subject is a real survivor and its dials match the engine's authoritative VS
  constant, so content and the trigger chain cannot silently diverge.

## Findings

### Fixed this block

- **[MAJOR — found by the adversarial subagent review, fixed] `storyLine` dropped the payoff line on busy
  turns.** The "resolved this turn" check peeked only the *last* history slot, but stage 13 appends world
  events (weather/nightfall/horde/route) *after* the stage-12 story beat, and a 12-hour-delayed
  consequence always lands on a time-advancing turn — so any co-occurring world event pushed the climactic
  "she left supplies…" / "she came back for what you would not give" line out of the last slot and it
  silently vanished. Fixed to **scan** for this arc's beat at `meta.turn` rather than rely on last-slot
  adjacency (`story.ts` `storyLine`), with a regression test that appends a trailing world event and
  asserts the payoff still shows. The live slice confirms it: the cold payoff renders even with a
  horde-lead in the same narration.

### Simplifications & deferrals (by design — not defects)

- **M1 — The raid is narrated, not defended (PL-M3-08).** The cold consequence resolves off a rest as a
  stat-and-prose beat (cache + barricades), not a played, moment-to-moment defense of the base. It is the
  *first thing that attacks the shelter* (retiring the "payoff inferred from absence of danger" note from
  Part 3), but the live night-siege is still deferred to the M4 contested world.
- **M2 — One arc, one subject (PL-M3-09).** The slice tells *a* story well, but a second run tells the
  *same* story; retellability across runs — the real target of the "one more day" test — is unproven by a
  single authored arc (the arc *library* is post-gate M4 content by design). This is the central question
  the Fun Gate must weigh with real playtesters, and it is called out plainly in `FUN_GATE_LOG.md`.
- **L1 — Help gated on the cache can leave refuse the only branch (PL-M3-10).** At plea time with a cache
  below `stashDraw`, only "turn away" is offered (never a hard lock — refuse is always available). Intended
  for the VS ("she came back for what you would not give"), but a "you have nothing to give" third path is
  a lever.
- **L2 — The arc is authored engine-side with content mirroring the dials (PL-M3-10).** `src/sim/story.ts`
  holds the authoritative VS logic + dials; `content/arcs` carries the surfaced prose and mirrors the dials
  (harness-guarded against drift), exactly as the T17 loot tables and NPC flavour are engine/authored
  bridges today. Reading dials *from* content is post-VS.
- **L3 — The companion payoff is implicit (PL-M3-10).** Helping Ruth lifts her trust toward the T36
  recruit gate, but the arc doesn't surface "she becomes your companion" as its reward.
- **L4 — Off-screen stash upkeep / raids deferred.** The stash is depleted by the arc's on-turn stage-12
  consequence, not inside `advanceWorld`; an abandoned base is not raided off-screen (rides with the
  standing off-screen-people-sim deferral, PL-M3-02/05, keeping `advanceWorld` byte-identical).
- **L5 — Arc dials are first-pass.** `needThreshold 60`, `delayHours 12`, `stashDraw 2`, `raidUnits 3`,
  `barricadeHit 20`, `helpTrust +25`, `refuseTrust −35` are reasoned, not balanced against a real run —
  the dials the T42 Fun Gate / M5 balance pass will move.

## Suggested follow-ups (owner's call)

1. **Run the Slice Fun Gate (T42).** The build is prepped: a playable two-branch slice
   (`FUN_GATE_SLICE.md`) and a log with criteria + a candid provisional read (`FUN_GATE_LOG.md`).
   Recommendation in the log: a short *real* playtest focused on the "one more day" pull before signing —
   because if the slice needs more content to grip, the gate's own rule says that is a *fail*, not a
   shopping list. **M3 stays active until it is signed.**
2. **A second arc + a live base defense** — the two levers most likely to move a "conditional" gate read:
   variety across runs (PL-M3-09) and a *played* raid rather than a narrated one (PL-M3-08). Both are M4,
   gated behind the pass by design.
3. **Surface the companion payoff of the good branch (PL-M3-10)** — walk a helped Ruth into the recruit
   gate so kindness has a mechanical reward the player can see.
4. **Balance the stash + arc dials at the Fun Gate (L5)** — against a real Rivermouth run.
