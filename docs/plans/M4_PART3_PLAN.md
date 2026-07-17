# M4 Part 3 — Encounter categories, chains & multi-stage flows (T47)

**Milestone:** M4 (Content-complete city) · **Task:** T47 · **Requirements:** FR-ENC-03..08, FR-CNT-03
**Depends on:** T15 combat, T22 survival/needs, T31 Living History, T33/T34/T35 survivors, T37/T38/T39 shelter, T40 arcs (the trigger-chain precedent).
**Deferred to T48:** FR-ENC-01/02 — the tagged-pool weighting, cooldown suppression, and the §4 verbatim-repeat-rate gate. Selection this part is deterministic-by-fit.

## Goal

Turn the simulation into a system that *speaks* in scenes. Build the engine that, from the full
state, selects an encounter whose conditions fit, resolves it against the systems, and records the
consequence — and prove it with a compact authored pool that exercises every mechanic. This is the
data-driven backbone the M4 content pour (T48+) fills.

The hard requirement is **FR-CNT-03: requirements + effects declared in data, no hard-coded
branching.** The engine ships an *interpreter*, not a switch statement of encounters. Encounters are
`content/encounters/*.json`, validated by a new schema, threaded into the pure engine as transient
content (exactly as the node graph is), and executed by a closed vocabulary of requirement
predicates and effect verbs.

## The six sub-requirements and how each is met

- **FR-ENC-05 Category coverage** (Must) — every encounter carries a `category` ∈
  {exploration, combat, social, environmental, story, psychological, shelter}. The proof set covers
  all seven; a harness test asserts coverage.
- **FR-ENC-03 Chains** — an effect `setFlag` writes a `player.flags` fact; another encounter's
  `requiresFlags` reads it. A `scheduleFollowup` effect enqueues a timed flag (via the existing
  `queue`, resolved in stage 12) for a *later* callback. The stranger you help resurfaces.
- **FR-ENC-04 Multi-stage** — an encounter has `stages[]`; a choice's `advanceStage` effect moves
  the *active encounter* to the next stage. The active encounter persists across turns in the
  reserved `player.quests` slot (like `combat` persists a fight). Negotiation → fight (a
  `seedWalkers` effect hands off to real T15 combat) → chase (a follow-up stage with a real cost).
- **FR-ENC-06 Moral → Humanity** — a new hidden `player.humanity` scalar (0–100, baseline 50, never
  shown as a bar; **v7→v8 save rung**, owner-chosen). An `adjustHumanity` effect moves it and logs a
  `moral` Living-History beat (the M5 endings, T61/T62, read the log). Moral encounters put the
  interesting cost on the table both ways.
- **FR-ENC-07 False encounters** — an encounter whose stage resolves to *nothing* (the knock that's
  the wind; the "survivor" already dead). Tension without payoff is a first-class authored shape.
- **FR-ENC-08 Evolution** — three encounters share `nodeIds` but gate on **node-state bands**
  (`searchPct`, `walkers`, `blood`, a flag). The same place yields before/during/after variants as
  the run changes it. Proven on `node.the-terraces.fire-station` — the GDD's own example.

## Architecture — `prototype/engine/src/sim/encounterSystem.ts`

New engine module (distinct from `encounters.ts`, which owns the T35 *survivor-interaction* verbs).
Pure, deterministic, integer-only, dependency-free — no RNG this part (selection is by fit, so a run
replays byte-for-byte from seed; T48 introduces the weighted `encounter` stream).

### Content-facing shapes (mirrored by `encounter.schema.json`)
```
EncounterDef  = { id, category, title, premise, requirements?, stages[], repeatable?, scope?, notes? }
EncounterStage= { id, narration, choices[] }
EncounterChoice = { id, label, timeCost, requirements?, effects[] }
Requirement   = { nodeIds?, regionIds?, nodeKinds?, phases?, min/maxSearchPct?, min/maxWalkers?,
                  min/maxBlood?, min/maxCorpses?, min/maxDay?, min/maxRegionThreat?,
                  min/maxHumanity?, min/maxStress?, min/maxMorale?, requiresFlags?, forbidsFlags?,
                  requiresShelter?, carriesItem?, metNpc?, npcHere? }   // all optional, AND-combined
Effect        = one of:
  setFlag{flag,value?} · setRegionFlag{flag,value?,region?} · adjustHumanity{delta} ·
  adjustTrust{npc,delta} · adjustNeed{need,delta} · adjustMind{stress?,morale?} ·
  grantItem{item,quantity} · takeItem{item,quantity} · depleteStash{units} ·
  inflictWound{wound,site,severity} · seedWalkers{count,node?,types?} · addNoise{amount} ·
  revealDiscovery{discovery} · logHistory{event,note?} · advanceStage{to} · endEncounter{} ·
  scheduleFollowup{flag,delayHours}
```

### Engine surface
- `evaluateEncounters(state, graph)` — **stage 13** selection. Guards: pool non-empty, run not over,
  no active combat, no active encounter, player on a real node. Eligible = requirements match and the
  one-shot done-flag (`enc.done.<id>@<node>`, or `@run` for `scope:"run"`) is unset. Pick =
  most-specific-then-id (deterministic). Activates the reserved `player.quests` slot at stage 0 and
  logs `encounter.begin`. Inert when no encounter pool is registered — every prior golden run is
  byte-identical.
- `encounterChoices(state, graph)` — the active stage's authored choices (choice `requirements`
  filtered), plus an engine-guaranteed **"Step away"** disengage (anti-softlock; the T40/T15 rule that
  a way out always exists). Empty when no encounter is active.
- `encounterLine(state)` — the active stage narration (screen-reader-safe prose lead).
- `isEncounterSystemAction` / `resolveEncounterSystemAction(state, graph, action)` — **stage 3**
  dispatch → applies the chosen choice's `effects[]` via the pure `applyEffect` fold. `advanceStage`
  keeps the slot live; `endEncounter` (implicit when a stage has no advance) clears it and stamps the
  done-flag.
- `humanityOf`, `humanityBand` (felt prose, never a number), `HUMANITY_BASELINE`.

### Integration (14-stage order unchanged)
- **stage 13** `evaluateStory` also runs `evaluateEncounters` (mirrors how it runs `evaluateArcs`).
- **stage 3** `applyPlayerAction` dispatches encounter actions before the core verbs.
- `availableActions`: `run-over → combat → walkers-encounter → **active-encounter** → explore`.
- `sceneOf`: `encounterLine` leads (after world-danger); `humanityBand` rides the atmosphere line.
- Transient content: `RegionGraph` gains an optional `encounters` pool; `buildRegionGraph(regions,
  nodes, encounters=[])` and `startRun(..., encounterDefs=[])` thread it (empty = inert). No
  `applyAction` call-site change — the pool rides the `graph` already passed each turn.

### Save schema — v7 → v8 (the rung the owner chose)
`SAVE_SCHEMA_VERSION=8`; `Player.humanity` added; `createInitialState` seeds `HUMANITY_BASELINE=50`;
`migrateV7toV8` seeds `humanity:50` on every historical save (a pre-moral run is neutral). One pure,
total N→N+1 rung, per ADR-0003 / T7 — the first rung since v7 (T39). The active-encounter slot and all
chain/evolution machinery ride reserved-and-inert shapes (`player.quests`, `player.flags`, `queue`,
`region.storyFlags`), so the rung carries exactly one field.

## Content — the proof set (~14 encounters, opt-in)

Homed on shipped nodes/npcs, registered only by the harness/tests and the interactive client, so
default golden runs stay inert. Covers all seven categories and every mechanic:

1. `encounter.rivermouth.first-light` — **exploration**, start-region ambient; a discovery reveal.
2. `encounter.the-terraces.fire-station-before` — **exploration/evolution BEFORE** (fire-station,
   searchPct 0): engines in the bay, a few wanderers; enter (setFlag) or move on.
3. `encounter.the-terraces.fire-station-during` — **combat/evolution DURING** (entered + searched):
   the noise draws a pack → `seedWalkers` + endEncounter → real T15 fight.
4. `encounter.the-terraces.fire-station-after` — **environmental/evolution AFTER** (searchPct≥100,
   blood>0): a picked-over shell, a squatter, a note you didn't leave → `revealDiscovery`.
5. `encounter.the-terraces.toll-crew` — **social + MULTI-STAGE** negotiation→fight→chase at
   `overlook-road`: pay `depleteStash` / bluff (morale-gated) / refuse → violence (`seedWalkers`) or
   run (`advanceStage` chase → fatigue + a possible sprain).
6. `encounter.mercy-hospital.the-locked-ward` — **moral** (no clean answer, feeds Humanity): free a
   trapped survivor (time/noise/risk, +humanity) / leave them (−humanity) / a mercy.
7. `encounter.ironworks.the-scavenger` — **moral**: rob a lone scavenger (+items, −humanity) / help
   (+humanity, share) / walk away — the Survival Triangle made personal.
8. `encounter.common.the-long-dark` — **psychological** (night + high stress): steady yourself
   (−stress) / push on (−morale). Reads/writes `mind`; all prose (non-audio).
9. `encounter.common.something-at-the-door` — **psychological/FALSE** (at shelter, night): it's the
   wind. Tension, no payoff.
10. `encounter.hillcrest.figure-in-the-window` — **environmental/FALSE**: a "survivor" already dead.
11. `encounter.common.the-barricade` — **shelter** (own shelter, night, barricades>0): shore it up
    (spend `item.scrap` → barricades+) / hold.
12. `encounter.the-terraces.a-name-on-the-wall` — **story/CHAIN start**: a name + plea scratched in
    plaster → `revealDiscovery` + `setFlag chain.the-terraces.name-seen`.
13. `encounter.the-terraces.the-one-who-scratched` — **story/CHAIN payoff** (requiresFlags
    name-seen): you learn the fate of the person from #12.
14. `encounter.common.stripped-bare` — **exploration** (searchPct≥100): "nothing left here" — the
    depleting-loot world, felt.

## Test plan

- **Engine** `events.test.ts` — requirement matching (each key), each effect kind, selection
  determinism + specificity, multi-stage advance, chain flag gate, evolution (same node, three
  bands), false encounter (no state payoff beyond the beat), moral clamp 0–100 + moral beat,
  `seedWalkers`→combat handoff, save-lossless with an active encounter, anti-softlock disengage.
  `humanityMigration.test.ts` — v7→v8 seeds humanity (mirrors routes/met migration tests).
- **Harness** `events.test.ts` — load shipped `content/encounters`, register the pool, play a run
  that surfaces + resolves an encounter over shipped Rivermouth/Terraces; assert category coverage
  (all 7), and a drift guard: every effect/requirement kind and every referenced node/npc/item/wound
  id in the shipped pool is known/real.
- **content-loader** — the schema gate auto-picks up the new type (schema-first); update the count
  assertion to 8 types.
- Full CI green in a clean sandbox before packaging (engine + content-loader + harness typecheck +
  test, validate over real content, malformed-rejected, empty-turn smoke).

## Definition of done

CI green; format-patch built + verified by `git am` on a fresh baseline; changed files synced to the
E: mount; `docs/status.json` T47→done + banner + parkingLot; `CHANGELOG.md`; `docs/qa/QA_REVIEW_M4_PART3.md`;
Mission Control snapshot refreshed. An adversarial content-quality subagent audit on the encounters
(Golden Encounter Formula, category fit, near-duplicates, accessibility/non-audio, human-only canon).

## Parking lot / deferrals

- T48 owns weighting, cooldowns, the §4 repeat-rate instrumentation, and the ambient-repeatable pool.
- FR-ENC-09 (rare/legendary) and FR-ENC-10 (director injection) are later M4/M5.
- Humanity's *consumers* — ending gates (T61/T62), companion desertion (T53) — read the scalar later;
  this part only tracks and surfaces it.
- The full launch pool (deep enough that a run rarely repeats) is the content pour, not this proof.
