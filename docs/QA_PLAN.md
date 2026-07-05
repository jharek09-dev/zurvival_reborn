# Zurvival Reborn — QA & Test Plan

**Version:** 1.0 · **Status:** Pre-production (draft for review) · **Owner:** Jharek
**Reads with:** [`docs/GDD.md`](GDD.md) (what & why) · [`docs/PRD.md`](PRD.md) (what to build & when) · [`DESIGN.md`](../DESIGN.md) (how) · [`docs/PRODUCTION.md`](PRODUCTION.md) (milestones & Definition of Done)

---

## 1. Purpose of this document

The PRD says *what we build and how we'll know it works*; the Technical Design says *how the
software is shaped*. This document says **how we prove it works, keep it working, and decide
what to fix first.** It turns the one-paragraph testing strategy in [`DESIGN.md`](../DESIGN.md)
§11 into a working QA plan: a test taxonomy, concrete test cases traced to requirement IDs, a
regression strategy, and a bug-triage framework.

It exists because this game makes an unusual promise — *a world that is simulated, remembers,
and never cheats* — and that promise is only as real as the tests behind it. A survival
roguelite whose save corrupts, whose "deterministic" core drifts, or whose world silently
forgets what the player did has broken its core pitch, not just a feature.

Scope of this version: a **complete QA framework** for every subsystem, with **detailed test
cases prioritized for the Vertical Slice** (milestones M1–M3). Systems that first appear at
MVP or v1.0 — infection-as-identity, the radio network, factions, endings, localization — get
coverage *notes and forward test hooks* here and full case sets when they enter development.
Like the PRD, this is a plan, not a contract; it tracks the PRD and DESIGN and is revisited
when they change.

### How this document is used

- **Before a requirement is "done"** — its milestone Definition of Done (PRODUCTION §5)
  requires the mapped tests in §6 to exist and pass. A *Must* requirement ships with tests.
- **On every change** — the regression strategy (§7) decides which suites run.
- **When something breaks** — the bug framework (§8) decides how bad it is and when it's fixed.
- **At a milestone gate** — the release-readiness checklist (§12) is the sign-off.

### ID scheme

Test artifacts use stable IDs so tickets, commits, and CI jobs can reference them, mirroring
the PRD's `FR-`/`NFR-` convention:

| Prefix | Meaning | Example |
| --- | --- | --- |
| `TC-<AREA>-##` | Test case (a specific, checkable behavior) | `TC-CORE-01` |
| `INV-##` | Invariant / property that must always hold | `INV-03` |
| `GR-##` | Golden run (fixed seed + scripted actions) | `GR-01` |
| `SEV` / `PRI` | Bug severity / priority band | `SEV-1`, `PRI-0` |

`<AREA>` matches the PRD functional areas (`CORE`, `SIM`, `MAP`, `PLR`, `INJ`, `ENC`, `CBT`,
`ECO`, `SHL`, `NPC`, `STY`, `UI`, `AUD`, `CNT`) plus `DET` (determinism/saves) and `NFR`
(cross-cutting non-functional). Every test case names the PRD requirement(s) it verifies, so
coverage is auditable in both directions (§13).

---

## 2. QA philosophy — the architecture *is* the test strategy

The four load-bearing constraints in DESIGN §2 are not just engineering choices; they decide
how this game is tested. Each one hands QA a lever most games don't have.

1. **Determinism is the master test.** Because `(state, action, seed) → (state', scene)` is a
   pure function (TEC-01), *every* behavior is reproducible from a seed plus a state snapshot.
   A bug report is a save file and an action; a fix is proven by re-running it. This makes the
   determinism suite (§6.2) the single most important thing in this plan: if determinism holds,
   almost everything else becomes checkable; if it breaks, nothing downstream can be trusted.

2. **Content can't be allowed to break the engine.** Content is external, schema-validated data
   (TEC-02). QA's job is to make malformed content fail *the build*, never the player's run
   (FR-CNT-02). The schema gate in CI is a QA control, not just a pipeline step.

3. **Test the simulation, not the pixels.** The core is headless (TEC-03); it emits a `Scene`,
   not a screen. The overwhelming majority of tests run against the core with no renderer at
   all — fast, deterministic, and CI-friendly. UI testing is a thin, separate layer over a
   well-tested contract (§6.13).

4. **The six principles are the acceptance lens.** A turn can pass every unit test and still
   fail the game. GDD Part II is the qualitative bar: does the world remember (Principle 3)?
   did the choice cost a corner of the Survival Triangle (Principle 4)? did the turn change
   something (Principle 1)? These are encoded as invariants where possible (§6, `INV-*`) and
   judged in playtest where they can't be (§6.17).

### Principles that follow from the above

- **Automation-first, because the team is solo + AI.** Per PRODUCTION §2, there is no manual QA
  department. The deterministic headless core is what makes that survivable: the AI writes and
  maintains the automated suites; the human spends scarce attention on exploratory play and the
  "one more day" fun gate, which no machine can judge. If a check *can* be automated, it must be.
- **Zero-tolerance defect classes exist.** Save corruption and determinism drift are not
  "high-severity bugs" to be prioritized against features — they are release-blocking by
  definition (§8.4), because they void the game's core guarantees (NFR-SAVE-02, NFR-REL-01).
- **A bug is not fixed until a test reproduces it.** Every fixed defect above SEV-3 leaves
  behind a regression test seeded from its repro, so it can never silently return (§7).
- **Hidden state is tested on behavior, not numbers.** Infection, stress, and morale are never
  surfaced as bars (FR-INJ-05, FR-UI-02). QA asserts on *symptoms and consequences* in the
  `Scene`, exactly as the player experiences them — never on a raw hidden value, which would
  test the wrong contract.

---

## 3. Test taxonomy — what we run and what each layer guards

The suite is a pyramid with an unusually strong foundation, because determinism lets the lower
layers carry more weight than in a typical game.

| Layer | What it is | Guards | Speed / cadence |
| --- | --- | --- | --- |
| **Determinism** | Same `(state, action, seed)` reproduces byte-identical `state'` and `Scene`. | The whole architecture (TEC-01, NFR-REL-01). | ms · every push |
| **Unit** | Pure transforms: each subsystem stage, each `effect` op, representative `requirements` predicates. | Subsystem correctness (DESIGN §6, §7). | ms · every push |
| **Property / invariant** | Generative tests over random states + action sequences; assert invariants (`INV-*`) always hold. | Emergent-state safety (no negative inventory, node memory never resets, every turn mutates ≥1 system). | s · every push |
| **Content validation** | Every content file checked against its schema; cross-reference integrity (ids resolve). | Content-as-data safety (FR-CNT-01/02/03). | s · every content change |
| **Golden run** | Fixed seed + scripted action list → expected run summary; committed as a fixture. | Regression / unintended balance & logic drift (§7). | s · every push (smoke) / nightly (full) |
| **Integration** | Full `applyAction` turn across all pipeline stages; save → serialize → load round-trip equality. | Pipeline wiring + save fidelity (FR-CORE-02, NFR-SAVE-01). | s · every push |
| **Scenario / system** | Scripted multi-turn situations that exercise a whole feature (a night attack, an infection arc, a horde re-path). | Feature-level behavior across subsystems. | s–min · pre-milestone + nightly |
| **Performance** | Turn-resolve time, load time, per-tick cost under stress (many hordes/regions). | NFR-PERF-01/02. | min · nightly + pre-release |
| **Accessibility** | Screen-reader semantics, no color/audio-only info, scalable text, reduced motion. | NFR-ACC-01..04. | manual + automated · pre-milestone |
| **Exploratory / playtest** | Unscripted human play; the "one more day" fun gate. | The six principles; fun; comprehension of hidden state. | per build / per milestone |

Rule of thumb: **push everything down the pyramid.** If a behavior can be asserted at the
determinism/unit level against the headless core, it is tested there and not left to a scenario
or a playtester. Playtest attention is the scarcest resource on a solo team and is spent only
where automation genuinely cannot reach.

---

## 4. Test environments, harness & data

The engine language is undecided (ADR-0001 is still open), so this section specifies
**capabilities the test harness must provide**, not a framework. Any stack chosen under ADR-0001
must satisfy these, and "good testing story for a deterministic core" is an explicit selection
criterion (PRD §10).

### 4.1 The harness (built on the debug tools in PRD TEC-04)

| Capability | Why QA needs it | Source |
| --- | --- | --- |
| **Seed setter** | Pin `meta.seed` so any run is reproducible on demand. | TEC-01 |
| **State inspector** | Read any slice of `GameState` to assert on hidden fields (infection stage, director bias) the player never sees. | TEC-04 |
| **State loader / snapshotter** | Start a test from an arbitrary saved `GameState` (the "given" of a test). | TEC-04, NFR-SAVE-01 |
| **Scripted action driver** | Feed a fixed action list turn-by-turn with no renderer. | TEC-03 |
| **Event / history reader** | Query the append-only Living History to assert what fired. | TEC-06 |
| **Simulation fast-forward** | Advance world time with the player idle, to test off-screen evolution (regions, groups). | FR-SIM-03/09 |
| **RNG stream introspection** | Confirm randomness is drawn only from named seeded streams, never wall-clock/global. | DESIGN §9 |

### 4.2 Test data & fixtures

- **Golden `GameState` snapshots** — a versioned library of saved states used as test "givens":
  a fresh start, mid-slice, a wounded player, a claimed shelter under threat, a terminal-stage
  infection, a save from each historical schema version (for migration tests).
- **Test content pack** — a small, stable, hand-authored content set (a few regions, nodes,
  items, encounters, NPCs) that exercises every schema field and every `effect` op, decoupled
  from shipping-content churn so content edits don't thrash the engine suites.
- **Golden run scripts** — `(seed, action[])` fixtures with their expected run-summary output
  (§7.1). These are the regression backbone.
- **Adversarial content** — deliberately malformed files (missing fields, dangling ids, out-of-range
  values) that must be *rejected* by the schema gate (FR-CNT-02). Validation that never sees bad
  input isn't validated.

### 4.3 Environments

| Environment | Purpose |
| --- | --- |
| **Local (headless core)** | The default. Determinism/unit/property/integration/golden — no renderer, no I/O. |
| **CI** | Runs the automated pyramid on every push; the schema gate; nightly full + performance + scenario suites. Red CI blocks merge. |
| **Client test** | The renderer(s) against a mocked/replayed core (`Scene` fixtures) for UI and accessibility. |
| **Device lab (thin)** | Real mid-range 2022-class phone + evergreen browsers for NFR-PERF-01 and one-hand/touch reality checks. Small, manual, pre-milestone. |

---

## 5. Milestone entry & exit criteria (QA gates)

QA gates map onto the milestone ladder in PRODUCTION §3 and the two-stage fun gate (§4 there).
Each milestone's exit criteria are additive — later milestones inherit all earlier gates and
never regress them.

| Milestone | QA entry | QA exit (gate) |
| --- | --- | --- |
| **M0 — Foundation** | Harness capabilities (§4.1) exist; CI runs. | Determinism suite green on a trivial state; save round-trip lossless; schema gate rejects adversarial content. The skeleton is *testable* before it's a game. |
| **M1 — Core loop** | Turn pipeline wired; test content pack loads. | §6.1–6.2 core cases pass; ≥1 golden run committed; every *Must* VS core requirement has a mapped passing test; **no open SEV-1/SEV-2**. |
| **M2 — Reactive world** | Six layers + director live. | §6.3–6.4 pass; off-screen region evolution and horde re-path proven by scenario tests; director on/off changes pacing metrics but never produces an invalid state. |
| **M3 — People, shelter & first story (VS complete)** | Companions, shelter, first survivor subset, Storyteller. | §6.5–6.11 slice cases pass; a full **end-to-end golden run** produces a coherent emergent story summary; **Stage-1 fun gate** (internal "one more day") recorded. |
| **M4 — Content-complete city (MVP/beta)** | All systems at moderate depth. | Full case sets for infection network, radio, encounters breadth, factions; content-complete city passes schema gate in CI; accessibility baseline automated; **crash-free ≥ 99.5% in closed test**. |
| **M5 — Release candidate (v1.0)** | Balanced, localized, accessible, hardened. | Full regression green; **zero save-corruption defects**; save-migration verified across all shipped versions; NFR-ACC/LOC suites pass; multiple + failure endings covered; **Stage-2 fun gate** passed; release-readiness checklist (§12) signed. |

**Blocking rule.** A milestone does not exit with an open bug in a **zero-tolerance class**
(§8.4) or with any *Must*-priority requirement for that milestone lacking a passing mapped test.
This is the QA half of the Definition of Done in PRODUCTION §5.

---

## 6. Test cases by subsystem

Format for every area: a short **test strategy** (what matters and where the risk lives), then a
table of **representative test cases**. Each case is `TC-<AREA>-##`, names the PRD requirement(s)
it verifies, a priority, and an expected behavior in Given/When/Then shorthand. These are
representative anchors, not the full enumeration — the living suite grows from them, and every
*Must* requirement carries at least one before its milestone gate (§13).

Priority in these tables is the **test's** priority (how essential the check is), using the same
bands as bug priority (§8): **P0** blocks the milestone, **P1** high, **P2** normal, **P3** nice.

Subsystems that first appear at MVP/v1 (infection network depth, radio, endings, factions, audio,
localization) carry **coverage notes** — the shape of their eventual suite — rather than full
cases, per the slice-first scope in §1.

### 6.1 Core loop & turn engine — *Vertical Slice* (FR-CORE-\*, GDD III/IV)

**Strategy.** This is the spine. Two things must be unbreakable: the pipeline runs the *same
fixed stage order every turn* (FR-CORE-02), and *every resolved turn changes ≥1 system with no
`choice→scene` shortcut* (FR-CORE-01/04). Most cases here run headless against `applyAction`.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-CORE-01 | Turn is a full loop, not a scripted edge | FR-CORE-01 | P0 | *Given* a Scene with choices *When* one is applied *Then* the engine resolves → applies consequences → advances time → emits a new Scene, with no direct choice→scene mapping. |
| TC-CORE-02 | Pipeline stage order is invariant | FR-CORE-02 | P0 | *Given* any valid state *When* a turn resolves *Then* stages 1–14 (DESIGN §5) execute in fixed order; noise deposited in stage 6 is consumed by horde movement in stage 9 (not before). |
| TC-CORE-03 | Time always advances | FR-CORE-03 | P0 | *Given* any action with a time cost *When* applied *Then* `meta.hour/day/phase` advance by exactly that cost; no zero-time non-micro action exists. |
| TC-CORE-04 | No no-op turns | FR-CORE-04, GDD III | P0 | *Given* 100 scripted turns *When* each resolves *Then* an audit shows every turn mutated ≥1 tracked system (`INV-01`). |
| TC-CORE-05 | Scenes answer the Four Questions | FR-CORE-05, FR-UI-01 | P1 | *Given* an emitted Scene *Then* it carries where / what's happening / what I can do / what changed — none empty. |
| TC-CORE-06 | Invalid action rejected against offered choices | FR-CORE-01, DESIGN §5.1 | P1 | *Given* a Scene offering choices {A,B} *When* action C is submitted *Then* it is rejected and state is unchanged. |
| TC-CORE-07 | Safe-to-stop at any turn boundary | FR-CORE-07, NFR-SAVE-01 | P0 | *Given* any resolved turn *When* the session ends immediately after *Then* an autosave exists and resuming reproduces the exact post-turn state. |
| TC-CORE-08 | Micro-choices are low/zero cost and inline | FR-CORE-06 | P2 | *Given* a scene with a micro-choice *When* taken *Then* it resolves inline at the declared low/zero cost without a full turn advance. *(MVP)* |

**Key acceptance criteria.** A telemetry audit of 100 turns shows every turn mutated ≥1 system;
QA can quit and resume at any boundary with zero state loss; identical state+seed reproduces the
turn (ties §6.2).

### 6.2 Determinism, RNG & saves — *the master suite* (TEC-01, NFR-SAVE-\*, NFR-REL-01)

**Strategy.** If this suite is green, the architecture holds and bug reports are reproducible; if
it is red, no other result can be trusted. It is the first thing that must pass at M0 and it runs
on every push. Save fidelity lives here because a save is just a serialized `GameState`.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-DET-01 | Byte-identical replay | TEC-01, NFR-REL-01 | P0 | *Given* a state + seed + action *When* `applyAction` runs twice *Then* both `state'` are byte-identical and both `Scene`s match. |
| TC-DET-02 | Full-run reproducibility | TEC-01 | P0 | *Given* a seed + a scripted action list *When* replayed from scratch *Then* the final state and run summary are identical every time. |
| TC-DET-03 | No wall-clock / global RNG | DESIGN §9 | P0 | *Given* the core under test *When* system clock and global RNG are perturbed *Then* outputs are unchanged; all randomness traces to named seeded streams. |
| TC-DET-04 | RNG streams serialize with state | DESIGN §9 | P0 | *Given* a save mid-run *When* loaded and continued *Then* subsequent rolls match an uninterrupted run (stream states restored, not reseeded). |
| TC-DET-05 | Save/load round-trip equality | NFR-SAVE-01 | P0 | *Given* any `GameState` *When* serialized then deserialized *Then* the result is deep-equal to the original (incl. history, queue, rng). |
| TC-DET-06 | Autosave at turn boundary | FR-CORE-07, NFR-SAVE-01 | P0 | *Given* a resolved turn *Then* an autosave snapshot is written atomically at the boundary; a kill mid-turn never yields a partial save. |
| TC-DET-07 | Version-stamped saves | NFR-SAVE-02 | P0 | *Given* a save *Then* it records `meta.version` (save-schema) + content version + a one-line "where you are" summary. |
| TC-DET-08 | Migration upgrades old saves | NFR-SAVE-02 | P0 | *Given* a save from schema version N-k *When* loaded by the current build *Then* it migrates to current with no data loss and no silent corruption (see §7.3). |
| TC-DET-09 | Corrupt/incompatible save fails safe | NFR-SAVE-02, NFR-REL-01 | P0 | *Given* a truncated or unmigratable save *When* loaded *Then* the engine refuses with a clear error and never overwrites it with garbage. |

**Key acceptance criteria.** Replaying the same actions on the same seed reproduces the run;
save/resume is lossless; every historical save version loads (or fails safe); **zero
save-corruption defects is a launch gate** (NFR-REL-01, §8.4).

### 6.3 World simulation — *Reactive world* (FR-SIM-\*, GDD IV)

**Strategy.** The bet of the game is that the world evolves *without the player*. The highest-value
tests use simulation fast-forward (§4.1) to prove regions and groups move on their own clock, and
that the noise model actually pulls hordes. The director is tested as a *bias*, never a *forcer*.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-SIM-01 | Six layers independently updatable | FR-SIM-01 | P1 | *Given* a turn *Then* player/companion/node/region/world/story layers each update through their own stage without cross-contamination. |
| TC-SIM-02 | Region evolves with player absent | FR-SIM-03 | P0 | *Given* a region at threat T on day N *When* the player spends K days elsewhere *Then* its threat/density/loot have measurably drifted per its own rules on day N+K. |
| TC-SIM-03 | Node memory persists all run | FR-SIM-02, GDD VII | P0 | *Given* a node damaged/searched on day N *When* revisited any later day *Then* damage, search %, corpses, discoveries are still present (`INV-02`: node state never resets mid-run). |
| TC-SIM-04 | Time-of-day changes danger | FR-SIM-04 | P1 | *Given* the same node at day vs night *Then* encounter odds, visibility and danger differ per the phase model. |
| TC-SIM-05 | Noise attracts/decays | FR-SIM-06 | P0 | *Given* a loud action at node X *Then* noise is deposited (stage 6), raises local attraction, and decays over subsequent turns. |
| TC-SIM-06 | Gunshot re-paths a horde | FR-SIM-06/07, FR-CBT-04 | P0 | *Given* a horde within range and a gunshot this turn *Then* next turn the horde re-paths toward the source in ≥ the design-target share of eligible cases. |
| TC-SIM-07 | Weather has multi-system effects | FR-SIM-05 | P2 | *Given* a weather change *Then* it affects ≥2 systems (e.g. visibility + scent/noise + travel). *(MVP)* |
| TC-SIM-08 | Infrastructure decay gates content | FR-SIM-08 | P2 | *Given* power loss in a region *Then* dependent content is removed/unlocked accordingly (e.g. faster spoilage, dark nodes). *(MVP)* |
| TC-SIM-09 | Off-screen groups act | FR-SIM-09 | P2 | *Given* a fast-forward *Then* survivor groups move/trade/fight/collapse without the player present. *(MVP)* |
| TC-SIM-10 | Director biases, never forces | FR-SIM-10, GDD XVI | P0 | *Given* the director on vs off over N runs *Then* pacing metrics differ but **no impossible/invalid state** ever occurs with it on (`INV-05`). |
| TC-SIM-11 | Living History is append-only & queryable | FR-SIM-11, TEC-06 | P1 | *Given* significant events *Then* each appends to history; history is never rewritten; callbacks can query it. *(MVP)* |

**Key acceptance criteria.** A region's threat measurably changes across days with the player
absent; a logged gunshot re-paths a nearby horde in ≥ target share; disabling the director
changes pacing metrics but never produces impossible states.

### 6.4 Exploration, map & travel — *Vertical Slice* (FR-MAP-\*, GDD VII)

**Strategy.** This is where "the world remembers" becomes visible to the player. The load-bearing
tests are node persistence across visits (shared backbone with §6.3) and that claiming/losing a
node drives the shelter loop.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-MAP-01 | Node graph + regions + routes | FR-MAP-01 | P1 | *Given* the loaded map *Then* nodes belong to regions and connect via routes with defined costs. |
| TC-MAP-02 | Fog of war | FR-MAP-02 | P1 | *Given* an unvisited node *Then* it is unrevealed until visited/known; visiting reveals it and it stays revealed. |
| TC-MAP-03 | Travel costs & travel events | FR-MAP-03 | P0 | *Given* node-to-node travel *Then* it spends time + stamina + emits noise and can trigger a travel encounter. |
| TC-MAP-04 | Route conditions track world state | FR-MAP-04 | P2 | *Given* a fire/flood in a region *Then* affected routes change to blocked/flooded/on-fire and travel reflects it. *(MVP)* |
| TC-MAP-05 | Map-as-journal notes persist | FR-MAP-05 | P2 | *Given* a player note pinned to a node *When* the map is reopened later/next session *Then* the note and auto-annotations render. *(MVP)* |
| TC-MAP-06 | Claim & lose a safehouse node | FR-MAP-06, FR-SHL-10 | P0 | *Given* a claimable node *When* claimed *Then* it is marked and enables the shelter loop; *When* overrun *Then* it can be lost without an auto game-over. |

**Key acceptance criteria.** Damage done to a node on day N is present on a later visit; player
notes persist and render; claiming a node enables the shelter loop.

### 6.5 Player systems & inventory — *Vertical Slice* (FR-PLR-\*, FR-ECO-01/02/03, GDD V/X)

**Strategy.** Two guarantees define this area: **no XP/levels anywhere** (FR-PLR-10 — a negative
requirement, so tested by asserting *absence*) and **weight/slot limits force real leave-behind
decisions** (FR-PLR-03). Inventory math is a prime home for property tests (`INV-*`).

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-PLR-01 | Persistent player state | FR-PLR-01 | P0 | *Given* a run *Then* condition, inventory, equipment, skills, traits, reputation persist and serialize with the save. |
| TC-PLR-02 | Only critical stats visible | FR-PLR-02, FR-UI-02 | P1 | *Given* the primary screen *Then* only the critical few stats surface; no bar overload; no hidden field is exposed. |
| TC-PLR-03 | Over-capacity forces a choice | FR-PLR-03 | P0 | *Given* a full inventory *When* a pickup exceeds weight/slots *Then* the player must explicitly drop/replace; silent auto-pickup never happens. |
| TC-PLR-04 | Growth is gear, not levels | FR-PLR-04 | P1 | *Given* two players *Then* capability differences trace to equipment, never to a level value. |
| TC-PLR-05 | **No XP/level exists anywhere** | FR-PLR-10 | P0 | *Given* the entire state model and every Scene *Then* no XP bar, level field, or level-up event exists (asserted on schema + UI). |
| TC-PLR-06 | Inventory never goes negative | FR-PLR-03, GDD X | P0 | *Given* random pickup/drop/consume sequences *Then* no count is ever negative and totals reconcile (`INV-04`, property test). |
| TC-PLR-07 | Artifact metadata attaches | FR-PLR-05 | P2 | *Given* a significant item *Then* provenance/history metadata attaches and two identical base items are not interchangeable. *(MVP)* |
| TC-PLR-08 | Durability wears & repairs | FR-PLR-06, FR-ECO-07 | P2 | *Given* use over turns *Then* gear degrades, can jam/break, and repair restores it. *(MVP)* |

### 6.6 Injuries, infection, health & mind — *slice subset, deepens at MVP* (FR-INJ-\*, GDD VI)

**Strategy.** The signature system, and the one most likely to be tested *wrong*. Golden rule:
**assert on symptoms and consequences in the Scene, never on the hidden numeric** (FR-INJ-05,
QA principle §2). The most important non-obvious behavior is the scent-trail: an untreated deep
cut must *demonstrably* increase zombie attraction along the traveled path (FR-INJ-03), and
reaching a severe infection stage must *open* play (a cure race), never end the run (FR-INJ-08).

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-INJ-01 | Damage → named wounds | FR-INJ-01 | P0 | *Given* a damaging event *Then* it produces a specific named wound (sprain/deep cut/fracture/burn/concussion/illness) with its own effects, not generic HP loss. |
| TC-INJ-02 | Health is treated, not regenerated | FR-INJ-04 | P0 | *Given* an untreated wound *When* time passes *Then* it does not self-heal; recovery requires treatment. |
| TC-INJ-03 | Deep cut leaves a scent trail | FR-INJ-03 | P1 | *Given* an untreated deep cut *When* the player travels *Then* nearby-zombie attraction along the path measurably increases vs an uninjured baseline. *(MVP)* |
| TC-INJ-04 | Bleeding ticks over time | FR-INJ-03 | P1 | *Given* a bleeding wound *Then* it worsens each turn until treated. *(MVP)* |
| TC-INJ-05 | Infection is staged identity, no bar | FR-INJ-05, FR-UI-02 | P0 | *Given* infection at any stage *Then* the client is sent symptoms, never a number; stage advances asymptomatic→symptomatic→advanced→terminal. *(MVP)* |
| TC-INJ-06 | Stage alters perception & dialogue | FR-INJ-06 | P2 | *Given* an advanced stage *Then* perception/available dialogue/visible symptoms change accordingly. *(MVP)* |
| TC-INJ-07 | Severe infection opens play, no auto-death | FR-INJ-08 | P0 | *Given* a severe/terminal stage *Then* the run continues as a harder mode (diagnosis/treatment/quarantine/cure race); it never triggers an instant Game Over. *(MVP)* |
| TC-INJ-08 | Mind surfaced via behavior, not bars | FR-INJ-09 | P2 | *Given* high stress/low morale *Then* it shows through behavior/dialogue/dreams and degraded options, never a numeric meter. *(MVP)* |

**Key acceptance criteria.** No numeric infection value is ever shown; an untreated deep cut
increases nearby-zombie attraction along the traveled path; reaching a severe stage opens new
play rather than ending the run.

### 6.7 Encounters & events — *Vertical Slice engine, breadth at MVP* (FR-ENC-\*, GDD VIII)

**Strategy.** The requirements engine (filter → weight → cooldown → select) is the anti-repetition
machine that protects the §4 "< 5% verbatim repeat" metric. Test the *selection logic*
deterministically; test *breadth/coverage* as content grows.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-ENC-01 | Requirements filter eligibility | FR-ENC-01, TEC-05 | P0 | *Given* an encounter requiring `infection.stage >= symptomatic` *When* the predicate is false *Then* it is not eligible; when true, it is. |
| TC-ENC-02 | Weighting + cooldown suppress repeats | FR-ENC-02 | P0 | *Given* a fixed seed and a full run *Then* verbatim encounter repetition stays under the §4 target; a just-seen encounter is on cooldown. |
| TC-ENC-03 | Effects apply & log uniformly | TEC-05, FR-SIM-11 | P0 | *Given* an encounter resolves *Then* each declared `effect` op (`adjust`/`set`/`spawnHorde`/…) applies to the correct `GameState` path and appends to history. |
| TC-ENC-04 | Encounter chains via flags | FR-ENC-03 | P2 | *Given* a flag set by encounter A *When* conditions later hold *Then* follow-up encounter B becomes eligible. *(MVP)* |
| TC-ENC-05 | Category coverage | FR-ENC-05 | P2 | *Given* the shipping pool *Then* exploration/combat/social/environmental/story/psychological/shelter categories are all represented. *(MVP)* |
| TC-ENC-06 | Encounter evolution by node state | FR-ENC-08 | P2 | *Given* one node before/during/after the player alters it *Then* it yields different encounter variants. *(MVP)* |

**Key acceptance criteria.** Every shipped encounter passes the five-question test (CONTRIBUTING /
FR-CNT-02); repeat-suppression holds verbatim repeats under the §4 target within a run.

### 6.8 Combat, stealth & zombie AI — *Vertical Slice* (FR-CBT-\*, GDD IX)

**Strategy.** Combat must always be *avoidable* and always *spend scarce resources* (FR-CBT-01) —
a stealth path must exist through every VS combat scenario. Firearms being loud is a systemic link
to §6.3 (a gun raises regional threat/noise). Zombie AI is a state machine driven by senses, so
it's testable deterministically.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-CBT-01 | Combat is avoidable | FR-CBT-01, FR-CBT-05 | P0 | *Given* every VS combat scenario *Then* at least one stealth/avoid path exists and is reachable. |
| TC-CBT-02 | Combat spends scarce resources | FR-CBT-01 | P0 | *Given* any combat action *Then* it consumes ≥1 of stamina/durability/ammo/noise/health; free attacks never exist. |
| TC-CBT-03 | Turn-based exchange resolution | FR-CBT-02 | P1 | *Given* a combat exchange *Then* attack/heavy/aim/push/retreat/hide resolve against systems (no twitch/timing input). |
| TC-CBT-04 | Firearms are region-loud | FR-CBT-04, FR-SIM-06 | P0 | *Given* a gun fired *Then* regional threat/noise rises measurably and can pull hordes (ties TC-SIM-06). |
| TC-CBT-05 | Stealth via sound/light/LOS | FR-CBT-05 | P1 | *Given* detection inputs (sound/light/line-of-sight) modulated by weather/dark *Then* detection resolves consistently with them. |
| TC-CBT-06 | Zombie state machine by senses | FR-CBT-06 | P1 | *Given* stimuli *Then* a zombie transitions dormant→wander→investigate→chase→feed→hibernate correctly; no illegal transitions. *(MVP)* |
| TC-CBT-07 | Screamer & Stalker behaviors | FR-CBT-07 | P2 | *Given* a Screamer alerted *Then* it calls others; *Given* night *Then* a Stalker hunts. *(MVP)* |
| TC-CBT-08 | Last Stand is a scene, not a card | FR-CBT-10, FR-STY-07 | P1 | *Given* terminal combat *Then* it resolves as a heightened final-choice sequence with ≥1 meaningful choice, never a bare "You Died". *(MVP)* |

**Key acceptance criteria.** A stealth path exists through the VS combat scenarios; firing a gun
raises regional threat/noise measurably; a Last Stand presents ≥1 meaningful final choice.

### 6.9 Inventory, crafting, loot & economy — *Vertical Slice core* (FR-ECO-\*, GDD X)

**Strategy.** Loot is **finite and contested** — taking removes it from the world and rivals can
beat the player to it (FR-ECO-01). Search must persist depletion (shared backbone with node
memory §6.3). The prized emergent outcome — the "last can" moral-scarcity moment — is a *balance*
target measured across runs (§7.5), not a scripted event.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-ECO-01 | Loot is finite & removed on take | FR-ECO-01 | P0 | *Given* an item taken from a node *Then* it is gone from that node's world state permanently. |
| TC-ECO-02 | Rivals can beat player to loot | FR-ECO-01 | P1 | *Given* a rival group targeting a node *When* they reach it first *Then* its loot is depleted before the player arrives. *(MVP)* |
| TC-ECO-03 | Search persists depletion | FR-ECO-03, FR-SIM-02 | P0 | *Given* a node searched to X% on day N *When* revisited *Then* search % is retained and further search yields diminishing returns. |
| TC-ECO-04 | Search costs & partial results | FR-ECO-03 | P1 | *Given* a search action *Then* it spends time/stamina/noise and returns partial (not all-or-nothing) results. |
| TC-ECO-05 | Plausibility-based loot tables | FR-ECO-02 | P1 | *Given* a location type *Then* loot is drawn from plausible tiered tables for that type (a pharmacy ≠ a hardware store). |
| TC-ECO-06 | Food spoilage & water purification | FR-ECO-05 | P2 | *Given* time (faster after power loss) *Then* food spoils; unpurified water is unsafe until treated. *(MVP)* |
| TC-ECO-07 | Crafting gated by blueprint/components/room | FR-ECO-06 | P2 | *Given* a missing blueprint/component/room *Then* the craft is unavailable; with all present it succeeds. *(MVP)* |

**Key acceptance criteria.** A second visit to a searched node reflects prior depletion; an NPC
hint resolves to real hidden loot in the slice; balanced runs produce a "last can" decision in a
majority of test runs (§7.5).

### 6.10 Shelter & community — *slice claim/lose, deepens at MVP* (FR-SHL-\*, GDD XI)

**Strategy.** The home is a system that **runs while the player is away** (daily report reflects
*actual* simulated job output — FR-SHL-02/03) and can be **lost without an auto game-over**
(FR-SHL-10). Night attacks must be legibly driven by prior preparation, which is a scenario test.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-SHL-01 | Shelter has evolving state | FR-SHL-01 | P0 | *Given* a claimed shelter *Then* it tracks integrity, population, morale, storage, rooms, and persists. |
| TC-SHL-02 | Daily report reflects real output | FR-SHL-02, FR-SHL-03 | P0 | *Given* assigned jobs over a day away *Then* the daily report equals the actual simulated produce/consume, not a canned summary. |
| TC-SHL-03 | Night attack driven by prep | FR-SHL-06 | P1 | *Given* two states differing only in barricades/defenders *When* attacked *Then* outcomes differ legibly by preparation, with real losses. *(MVP)* |
| TC-SHL-04 | Shelter can be lost, not auto-over | FR-SHL-10, FR-MAP-06 | P0 | *Given* an overrun/burned shelter *Then* it is lost into a survivable heavy state, never an instant Game Over. *(MVP)* |
| TC-SHL-05 | Rooms unlock capability | FR-SHL-04 | P2 | *Given* a built kitchen/medical/workshop/radio/watchtower/garden *Then* its capability becomes available. *(MVP)* |

**Key acceptance criteria.** The daily report reflects actual simulated job output; a night-attack
outcome is legibly driven by prior preparation; losing the shelter is survivable, not auto-over.

### 6.11 Survivors, companions & factions — *slice companion, deepens at MVP* (FR-NPC-\*, GDD XII)

**Strategy.** People are the story. The slice must prove **permanent companion death remembered by
the community** (FR-NPC-04) and **per-character memory, not a global reputation bar** (FR-NPC-02).
The highest-value narrative test: an NPC's offhand knowledge resolves to *actionable* loot/location
(FR-NPC-06) — talking must matter mechanically.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-NPC-01 | Handcrafted named survivors | FR-NPC-01 | P1 | *Given* the survivor pool (VS subset) *Then* each has background, personality, and a secret; the same survivor is recognizable across runs. |
| TC-NPC-02 | Recruit a companion, follow orders by trust | FR-NPC-03 | P0 | *Given* enough trust *Then* a companion is recruitable with autonomous AI and trust-gated orders. |
| TC-NPC-03 | Permanent death, remembered | FR-NPC-04 | P0 | *Given* a companion dies *Then* the death is permanent and later referenced by other survivors. |
| TC-NPC-04 | Per-character memory, not global bar | FR-NPC-02 | P1 | *Given* the player treats A well and B badly *Then* A and B hold independent trust/respect/fear; no single global reputation number drives them. *(MVP)* |
| TC-NPC-05 | Conversation hint → real loot/location | FR-NPC-06 | P1 | *Given* an NPC memory/knowledge line *When* acted on *Then* it resolves to actionable loot or a real location. *(MVP)* |
| TC-NPC-06 | Desertion/betrayal from low trust | FR-NPC-05 | P2 | *Given* sustained mistreatment/low trust *Then* desertion or betrayal can occur. *(MVP)* |

**Key acceptance criteria.** The same named survivor is recognizable across runs; ≥1 NPC hint
resolves to actionable loot/location; a companion's death is referenced later by others.

### 6.12 Story, radio & endings — *MVP/v1 · coverage notes* (FR-STY-\*, GDD XIII)

**Coverage notes (full cases at MVP/v1).** Story events fire on **world conditions, not a chapter
clock** (FR-STY-02) — test by driving world state to a threshold and asserting the event fires,
and by confirming it does *not* fire on time alone. Endings assemble from tracked run components,
with **no single "true ending"** (FR-STY-06): two survival endings driven by different tracked
components must differ (v1 test). Every failure (Last Stand / overrun / infection) must resolve as
an authored scene with closure — **never a bare "You Died"** (FR-STY-07, ties TC-CBT-08). Radio
signals evolve with world state (FR-STY-03); a non-audio equivalent exists for every broadcast
(FR-AUD-06, §6.14). Forward hooks: `TC-STY-01` story-on-condition, `TC-STY-02` no-true-ending
divergence, `TC-STY-03` authored-failure closure, `TC-STY-04` radio-evolves-with-state.

### 6.13 UI / UX — *Vertical Slice primary screen* (FR-UI-\*, GDD XVII)

**Strategy.** The client holds **no game logic** and derives everything from the `Scene` (DESIGN
§10) — so UI tests run against `Scene` fixtures, not a live core, and can't accidentally test
engine behavior. The two hard rules: **never show a fake choice** (FR-UI-03) and **never surface a
hidden number** (FR-UI-02).

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-UI-01 | Story-first single-decision screen | FR-UI-01 | P1 | *Given* a Scene *Then* header/status/story/choices/footer render with story primary and one decision in focus. |
| TC-UI-02 | Client holds no logic | DESIGN §10, NFR-PLAT-02 | P0 | *Given* only a `Scene` *Then* the client renders fully; given a malformed/hidden field it never derives game state locally. |
| TC-UI-03 | No infection bar / no hidden state | FR-UI-02, FR-INJ-05 | P0 | *Given* any Scene *Then* infection/stress/morale appear only as symptoms/text; no bar or number is rendered. |
| TC-UI-04 | Choices show known costs, never fake | FR-UI-03 | P0 | *Given* rendered choices *Then* each shows its known costs/risks and every presented choice is actually selectable. |
| TC-UI-05 | Mobile-first one-hand layout | FR-UI-05, NFR-PLAT-01 | P1 | *Given* a phone viewport *Then* the primary loop is one-hand reachable and scales up to desktop. |

### 6.14 Audio & atmosphere — *MVP/v1 · coverage notes* (FR-AUD-\*, GDD XVIII)

**Coverage notes.** The one **Must** here is accessibility-critical and tested at MVP:
**every meaningful sound cue has a non-audio equivalent** (FR-AUD-06) — audited alongside NFR-ACC-01.
Adaptive-mix layering, audio-as-information (noise direction/distance, zombie-type signatures), and
director-led silence/music (FR-AUD-01/02/03) get behavioral cases once audio is built. Forward hook:
`TC-AUD-01` non-audio-equivalent audit is a **P0 accessibility gate**, not a nicety.

### 6.15 Content pipeline — *the CI safety net* (FR-CNT-\*, TEC-02/05, GDD XIV/XV)

**Strategy.** This is QA-as-infrastructure. The schema gate is what lets a solo team author content
fast without fear: **malformed content fails the build, never the run** (FR-CNT-02). Adversarial
content fixtures (§4.2) are mandatory — a validator never fed bad input is not validated.

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-CNT-01 | Content is external data, loaded at runtime | FR-CNT-01, TEC-02 | P0 | *Given* a new location added as data *Then* it loads and plays with no engine code change. |
| TC-CNT-02 | Schema gate rejects malformed content | FR-CNT-02 | P0 | *Given* an adversarial file (missing field / bad type / out-of-range) *Then* CI fails the build with a clear error; it never reaches a player run. |
| TC-CNT-03 | Referential integrity | FR-CNT-02, TEC-04 | P0 | *Given* content referencing ids (item→node, encounter→region) *Then* every id resolves; a dangling id fails validation. |
| TC-CNT-04 | Requirements/effects are declarative | FR-CNT-03, TEC-05 | P0 | *Given* content gating on `requires` and declaring `effects` *Then* eligibility and consequences resolve from data with no hard-coded branch. |
| TC-CNT-05 | Content version pinned to save schema | NFR-SAVE-02 | P1 | *Given* a save *Then* its content version is recorded and checked on load (ties TC-DET-07/08). |

**Key acceptance criteria.** Every shipped content entry passes its schema and the five-question
test (CONTRIBUTING); a malformed encounter fails the build, never the player's run.

### 6.16 Non-functional — performance, platform, accessibility, localization, privacy (NFR-\*)

**Strategy.** These are cross-cutting and mostly gate at M4–M5, but three are **Must from M1** and
must not be retrofitted: accessibility semantics (NFR-ACC), the deterministic-core reliability
guarantee (NFR-REL-01, tested in §6.2), and externalized strings (NFR-LOC-01) built in from day one
to avoid a costly retrofit (PRD §13 risk).

| ID | Case | Traces | Pri | Given / When / Then |
| --- | --- | --- | --- | --- |
| TC-NFR-01 | Turn resolve + render < 100 ms | NFR-PERF-01 | P0 | *Given* a mid-range 2022 phone *When* a turn resolves and renders *Then* it completes < 100 ms; initial load < 3 s. |
| TC-NFR-02 | Per-tick cost bounded under stress | NFR-PERF-02 | P1 | *Given* many hordes/regions *Then* per-tick work stays bounded (amortized); no single turn spikes past NFR-PERF-01. |
| TC-NFR-03 | Runs on evergreen mobile + desktop | NFR-PLAT-01 | P1 | *Given* current evergreen browsers *Then* the game runs, mobile-first responsive. |
| TC-NFR-04 | Headless core enables other clients | NFR-PLAT-02, TEC-03 | P1 | *Given* the core *Then* it emits `Scene`/consumes `Action` with zero renderer coupling (a bot client is viable). |
| TC-NFR-05 | Playable offline for a session | NFR-PLAT-03 | P2 | *Given* no network *Then* a full session plays; no always-online requirement. |
| TC-NFR-06 | No color/audio-only critical info | NFR-ACC-01, FR-AUD-06 | P0 | *Given* any critical information *Then* it is available without relying on color or audio alone. |
| TC-NFR-07 | Full screen-reader support | NFR-ACC-02 | P0 | *Given* a screen reader *Then* the text UI is semantic and fully navigable. |
| TC-NFR-08 | Scalable text + contrast/colorblind themes | NFR-ACC-03 | P1 | *Given* text scaling / high-contrast / colorblind-safe modes *Then* layout holds and information survives. |
| TC-NFR-09 | Reduced-motion / reduced-flicker | NFR-ACC-04 | P2 | *Given* reduced-motion mode *Then* motion/flicker is minimized without losing information. |
| TC-NFR-10 | Strings externalized for localization | NFR-LOC-01 | P1 | *Given* the build *Then* no player-facing string is hard-coded; all are externalized. |
| TC-NFR-11 | Minimal data / opt-in telemetry / no PII | NFR-PRIV-01 | P1 | *Given* play *Then* no PII is required; any telemetry is clear opt-in. |

**Key acceptance criteria.** 100% of critical information available without color or audio;
turn < 100 ms and load < 3 s on target hardware; screen-reader-complete before the polish pass.

### 6.17 Exploratory play & the fun gate — *what automation cannot judge* (GDD II/XVI)

Automation proves the game *works*; only play proves it's *worth playing*. This is the human half
of QA and the reason playtest time is rationed for it.

- **The "one more day" test (PRD §4, PRODUCTION §4).** At session end, does the player want to
  continue? Stage-1 (internal) gates M3; Stage-2 gates M5. A slice that fails it sends scope back
  to the loop, not forward to content.
- **The six-principles acceptance lens (§2).** Per playtest, spot-check: did the world *remember*
  (Principle 3)? did each meaningful choice cost a corner of the Survival Triangle (Principle 4)?
  did the run produce a *retellable* story (Principle 1, PRD §4 story-recall ≥ 60%)?
- **Hidden-state comprehension.** The infection-as-identity risk (PRD §13) is a *comprehension*
  bug class, not a logic bug: if playtesters can't read their own decline from symptoms without a
  bar, that is filed and fixed as a real defect (§8.5), even though every unit test passes.
- **Structured exploratory charters.** Time-boxed sessions with a mission (e.g. "try to break node
  memory," "try to reach a no-consequence turn," "try to force the director to cheat") to hunt what
  scripted tests assume away.

### 6.18 Invariant register (`INV-*`)

Invariants are properties that must hold in **every** state the engine can reach; they are enforced
by property tests (§3) and re-checked by golden runs (§7). A violated invariant is at minimum SEV-2.

| ID | Invariant | Ties |
| --- | --- | --- |
| INV-01 | Every resolved turn mutates ≥1 tracked system (no no-op turns). | FR-CORE-04 |
| INV-02 | Node memory never resets within a run. | FR-SIM-02, GDD VII |
| INV-03 | Same `(state, action, seed)` ⇒ byte-identical `state'` (determinism). | TEC-01 |
| INV-04 | No inventory/resource count is ever negative; totals reconcile. | FR-PLR-03 |
| INV-05 | The director never produces an impossible/invalid state. | FR-SIM-10 |
| INV-06 | Living History is append-only (never rewritten). | TEC-06 |
| INV-07 | No hidden numeric (infection/stress/morale) is ever present in an emitted `Scene`. | FR-INJ-05, FR-UI-02 |
| INV-08 | Time is monotonic; it never runs backward. | FR-CORE-03 |
| INV-09 | Every content id referenced in state resolves to loaded content. | FR-CNT-02 |

---

## 7. Regression strategy

Regression is where a deterministic, content-as-data game has a decisive advantage — and a
specific set of failure modes to guard. The strategy has five pillars, a tiered run model, and a
change-type selection matrix so the right suites run at the right time.

**Governing rule.** Every defect fixed above SEV-3 ships with a regression test seeded from its
own repro (a saved `GameState` + action list). Because bugs are reproducible from state+seed
(TEC-01), this is nearly free — and it means **no fixed bug can silently return.**

### 7.1 Pillar 1 — the golden-run corpus (the backbone)

A **golden run** is a committed fixture: a fixed `seed`, a scripted `action[]`, and the **expected
run summary** it produces (final key state, the sequence of significant history events, death cause
if any, and headline balance numbers). Re-running it and diffing against the expected output is the
single most powerful regression signal this architecture offers — it catches *unintended* logic or
balance drift that unit tests, which only check what they assert, will miss.

- **Corpus composition.** A spread of scripted runs: a clean survival, an early death, a shelter
  siege, an infection arc, a companion loss, a director-heavy run. Each is a `GR-##` fixture.
- **On a diff.** A changed golden output is either a **regression** (fix the code) or an
  **intended change** (review, then re-bless the fixture in the same commit, with the reason in the
  message). Re-blessing is a deliberate, reviewed act — never automatic.
- **Cadence.** A small smoke subset runs on every push; the full corpus runs nightly and before
  every milestone gate.

| ID | Golden run | Primarily guards |
| --- | --- | --- |
| GR-01 | Clean vertical-slice survival to a safe stop | Core loop, node memory, save fidelity |
| GR-02 | Early death by horde after a gunshot | Noise→horde, combat cost, authored failure |
| GR-03 | Claim shelter → night attack → hold | Shelter loop, daily report, night-attack-by-prep |
| GR-04 | Infection asymptomatic → terminal cure race | Infection-as-identity, no auto-death *(MVP)* |
| GR-05 | Recruit companion → companion death | Per-character memory, remembered death *(MVP)* |
| GR-06 | Director-max pacing run | Director biases without invalid states *(MVP)* |

### 7.2 Pillar 2 — determinism regression

The determinism suite (§6.2) *is* a regression suite: any change that makes `(state, action, seed)`
non-reproducible is caught immediately by `TC-DET-01/02`. Because a single non-determinism bug
poisons the entire golden-run corpus (every expected output becomes unstable), **determinism runs
first in CI and a failure short-circuits the rest** — there's no point diffing golden runs when the
core is non-reproducible.

### 7.3 Pillar 3 — save-migration regression

Save-schema churn is a named project risk (PRD §13) and save corruption is a zero-tolerance defect
(§8.4). Every schema change adds a permanent test, never removes one:

- **Version corpus.** Keep a saved `GameState` from **every** shipped save-schema version (§4.2).
- **Every build** loads and migrates each historical save to current and asserts a valid, lossless
  result (`TC-DET-08`), plus a fail-safe refusal on a deliberately corrupt/unmigratable save
  (`TC-DET-09`).
- **Never delete a version fixture.** A save format, once shipped, is supported forever or migrated
  forever; the test corpus is the proof.
- **Round-trip on every push.** `TC-DET-05` (serialize→deserialize deep-equality) runs push-level,
  because it's cheap and it protects the most damaging defect class.

### 7.4 Pillar 4 — content regression

Because content is data behind a schema gate, content edits and engine changes have **different**
regression footprints:

- **On any content change** — the full schema + referential-integrity suite (§6.15) plus a
  **content smoke**: load the entire shipping pack, resolve every `requires`/`effects`, confirm no
  dangling ids (`INV-09`). A malformed encounter must fail *the build* (FR-CNT-02), never a run.
- **Engine changes** don't need the whole content pack thrashed — they run against the stable **test
  content pack** (§4.2) so engine regressions and content regressions don't mask each other.
- **New `effect` op or `requirement` type** — add a unit case (§6.7 TC-ENC-03 pattern) *and* a
  golden run that exercises it, so its behavior is pinned.

### 7.5 Pillar 5 — balance regression

Balance can rot without a single logic bug — scarcity tuning drifts a game from tense to trivial or
hopeless (PRD §13). Balance is regressed **quantitatively** off the golden runs and telemetry
targets (PRD §4):

- **Golden-run balance headlines.** Each `GR-##` records balance numbers (turns-to-first-crisis,
  death timing/cause, resource margins). A move outside tolerance flags a **balance regression** for
  review — sometimes intended (re-bless), sometimes not (fix).
- **Tracked balance metrics.** Verbatim encounter-repeat rate < §4 target; "last can" moral-scarcity
  moment occurs in a majority of balanced test runs (FR-ECO-10); low rate of no-consequence turns
  (INV-01 makes zero the floor; telemetry watches the *feel*).
- **Cadence.** Balance deltas are reviewed at each milestone gate and after any economy/director/
  encounter-weight change, not on every push (they're noisy at push granularity).

### 7.6 Regression suite tiers

| Tier | Contains | When it runs | Gate |
| --- | --- | --- | --- |
| **Smoke** | Determinism core, unit, integration round-trip, schema gate, golden-run subset (GR-01/02). | Every push / pre-merge. | Red blocks merge. |
| **Full** | Everything in smoke + full golden corpus, all property/invariant tests, scenario suite, content smoke on the full pack. | Nightly + on demand. | Red blocks the nightly "green build". |
| **Pre-milestone** | Full + performance (NFR-PERF), accessibility (NFR-ACC), save-migration across all versions, balance-delta review. | Before each milestone gate (§5). | Part of the exit gate. |
| **Release hardening** | Pre-milestone + device lab, soak/long-session runs, the full zero-tolerance sweep (§8.4), sign-off checklist (§12). | Before v1.0 / any public release. | Signs the release. |

### 7.7 Change-type → suites-to-run matrix

The selection rule that keeps CI fast without letting regressions through:

| Change type | Smoke | Content smoke | Full golden | Save-migration | Perf | A11y | Balance review |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Engine core / pipeline | ✅ | — | ✅ (nightly) | ✅ | ✅ (nightly) | — | on gate |
| Subsystem logic | ✅ | — | ✅ (nightly) | if state shape changed | — | — | if econ/director |
| `effect`/`requirement` runtime | ✅ | ✅ | ✅ | — | — | — | — |
| Content data only | ✅ (fast) | ✅ | — | — | — | — | if econ/encounter weights |
| Save-schema / state model | ✅ | — | ✅ | ✅ (mandatory) | — | — | — |
| Client / renderer | ✅ (Scene fixtures) | — | — | — | ✅ | ✅ | — |
| Content schema change | ✅ | ✅ (+adversarial) | — | if it changes state | — | — | — |

### 7.8 Flaky-test policy

In a deterministic core there is **no such thing as an acceptable flaky test.** A test that passes
and fails on identical inputs is not noise to be retried away — it is direct evidence of a
determinism bug (a stray wall-clock read, an unseeded stream, iteration-order nondeterminism). The
policy: a flake is filed as **at least SEV-2**, its root cause is found (not masked with a retry),
and the fix ships with a determinism test that pins it. Retries and `sleep`-based waits are banned
from the core suites; the headless core has no wall-clock to wait on.

### 7.9 What "done" means for regression

A change is regression-clean when: smoke is green pre-merge; the nightly full suite is green before
the change counts toward a milestone; any intended golden/balance change was reviewed and re-blessed
in the same commit with a reason; and any bug it fixed left behind a seeded regression test.

---

## 8. Bug severity, priority & triage

Two axes, kept separate on purpose. **Severity** is objective — how badly the game is hurt,
independent of anyone's plans. **Priority** is a decision — when we fix it, given the milestone and
the risk. A cosmetic issue on the launch screen can be low-severity but high-priority; a deep
edge-case crash can be high-severity but low-priority pre-alpha. Conflating them is how the wrong
things get fixed first.

### 8.1 Severity (`SEV-1` … `SEV-4`)

| Sev | Name | Definition | Zurvival examples |
| --- | --- | --- | --- |
| **SEV-1** | Critical | Voids a core guarantee, loses data, or halts play with no workaround. | Save corruption or data loss; **determinism drift** (`state'` not reproducible); hard crash / hang in the core loop; a content file crashes a live run instead of failing the build. |
| **SEV-2** | Major | A key feature is broken or a design guarantee is violated, but play continues. | Node memory resets on revisit (world "forgets"); a no-op turn occurs; a hidden numeric (infection) leaks into a Scene; a choice presented but not selectable; a companion death not remembered; an invariant (`INV-*`) violated. |
| **SEV-3** | Minor | Noticeable wrong behavior with a workaround; limited blast radius. | Loot table off for one location type; weather effect missing on one system; daily report miscounts a job; an encounter cooldown slightly wrong. |
| **SEV-4** | Trivial | Cosmetic or textual; no gameplay impact. | Typo in scene prose; minor spacing on the status bar; log message wording. |

**Severity anchors (non-negotiable classifications):**

- Anything that **loses or corrupts a save** is **SEV-1**, always (NFR-SAVE-02).
- Any **determinism break** is **SEV-1**, always — it poisons reproducibility and the golden
  corpus (TEC-01, §7.2).
- Any **`INV-*` invariant violation** is **at least SEV-2** (§6.18).
- A **crash** is SEV-1 if in the core/critical path, SEV-2 if isolated to a non-critical client view.

### 8.2 Priority (`PRI-0` … `PRI-3`)

| Pri | Meaning | Response expectation (solo + AI reality) |
| --- | --- | --- |
| **PRI-0** | Drop everything. Blocks the current milestone or a release; or is a zero-tolerance class (§8.4). | Fix before any new feature work; blocks the milestone gate (§5). |
| **PRI-1** | High. Hurts the current milestone's goal or a *Must* requirement. | Fixed within the current milestone; scheduled ahead of *Should* work. |
| **PRI-2** | Normal. Real but livable; tied to *Should*/*Could* scope or a later milestone. | Backlog for its target milestone; fixed as capacity allows. |
| **PRI-3** | Low. Cosmetic, rare, or beyond the current horizon. | Parking lot (PRODUCTION §6.5); fixed opportunistically or at polish. |

Priority is set with the **MoSCoW priority of the affected requirement** and the **current
milestone** in view: a bug in a *Must*/Vertical-Slice requirement outranks a bug in a *Could*/v1
one at equal severity.

### 8.3 Severity × Priority triage matrix (default starting point)

Severity suggests a starting priority; milestone context can raise it (rarely lowers it). Read this
as the default, then adjust for "is this requirement in scope *now*?"

| | *Must* / in current milestone | *Should* / next milestone | *Could* / beyond horizon |
| --- | --- | --- | --- |
| **SEV-1** | **PRI-0** | **PRI-0** | PRI-1 |
| **SEV-2** | **PRI-0 / PRI-1** | PRI-1 | PRI-2 |
| **SEV-3** | PRI-1 / PRI-2 | PRI-2 | PRI-3 |
| **SEV-4** | PRI-2 / PRI-3 | PRI-3 | PRI-3 |

SEV-1 is never below PRI-1 regardless of scope — a save-corruptor "in a system we'll build later"
is still a save-corruptor.

### 8.4 Zero-tolerance defect classes (release-blocking by definition)

These are not triaged against features. If one is open, the relevant milestone/release does not
ship — they are the QA expression of the game's core promises and PRD §4 stability targets.

1. **Save corruption or data loss** (NFR-SAVE-02, PRD §4: *zero save-corruption defects at launch*).
2. **Determinism drift** — `(state, action, seed)` not reproducible (TEC-01, NFR-REL-01).
3. **Crash in the core loop** (counts against crash-free ≥ 99.5%, NFR-REL-01).
4. **Content that crashes a live run** instead of failing the build (FR-CNT-02).
5. **Accessibility Must-failures** — critical info available only via color/audio, or a screen-reader
   dead-end (NFR-ACC-01/02).
6. **A `Scene` leaks hidden state** — an infection/stress number reaches the client (FR-INJ-05,
   FR-UI-02, `INV-07`).

A zero-tolerance bug is auto-`SEV-1` / auto-`PRI-0` and cannot be deferred past its milestone gate,
only fixed.

### 8.5 Special defect categories (game-specific)

Some defects don't fit the usual "it crashed" mold and need naming so they get filed instead of
shrugged off:

- **Balance bug vs logic bug.** A logic bug produces a *wrong* state; a balance bug produces a
  *valid but un-fun* one (trivial or hopeless runs). Balance bugs are real defects, usually SEV-3,
  found via balance regression (§7.5), and fixed by tuning + re-blessing golden runs — not code
  logic.
- **Comprehension bug.** Hidden-state design (infection-as-identity) fails if the player can't read
  their situation from symptoms. If playtesters consistently misread their own decline (PRD §13
  risk), that's a **SEV-2 comprehension defect** even though every unit test passes — fixed with
  symptom/diagnosis design, never by adding a bar.
- **"Is this a bug?" — false encounters & emergence.** A false encounter (tension without payoff,
  FR-ENC-07) and an unlucky-but-legal emergent outcome are **working as designed**, not defects. The
  test: does it violate an `INV-*`, a requirement, or a core promise? If not, it's the simulation
  doing its job. This distinction is written down so emergent harshness isn't "fixed" into
  blandness.
- **Content authoring error.** A dangling id or schema violation is a **content bug**, caught by the
  CI gate (§6.15) — filed against content, fixed in data, never worked around in the engine.

### 8.6 Bug report template (the determinism dividend)

Because any core behavior is reproducible from a seed and a state (TEC-01), a good report is
*self-contained and re-runnable*. A report missing the seed + state for a core bug is incomplete and
sent back. Minimum fields:

```
Title:        <one line, observable behavior>
Severity:     SEV-1 | SEV-2 | SEV-3 | SEV-4   (+ auto-flags if zero-tolerance §8.4)
Priority:     PRI-0 | PRI-1 | PRI-2 | PRI-3
Area / Req:   <FR-/NFR-/TEC- id(s) and subsystem>
Milestone:    <M0..M5>  Build/commit: <hash>

Repro (core bugs MUST include):
  seed:       <meta.seed>
  state:      <attached GameState snapshot / save file>   ← the "given"
  actions:    [<scripted action list to the failure>]
  content:    <content version>

Expected:     <what should happen — cite the requirement / INV>
Actual:       <what happened; attach the emitted Scene / history slice>
Regression?:  <new, or did a golden run / prior test miss it?>
Notes:        <invariant violated, first-bad-commit if known>
```

The payoff: triage attaches the snapshot to a failing test, the fix flips it green, and the same
snapshot becomes a permanent regression fixture (§7). Report → test → fix → guard is one motion.

### 8.7 Triage workflow & cadence

Fitted to the solo + AI operating model (PRODUCTION §2, §8) — lightweight, but with hard gates.

1. **Intake.** Every defect (from a failing test, a playtest, or exploratory charter) is filed with
   §8.6 fields. A failing automated test auto-files with its seed/state attached.
2. **Classify.** Assign severity (objective, per §8.1 anchors) then priority (per §8.3 + milestone).
   Apply zero-tolerance auto-flags (§8.4).
3. **Route.** PRI-0 interrupts current work. PRI-1 enters the current milestone. PRI-2/PRI-3 go to
   the backlog / parking lot (PRODUCTION §6.5) against their target milestone.
4. **Fix + guard.** Fix, add the seeded regression test (mandatory > SEV-3), re-bless any intended
   golden/balance change with a reason.
5. **Cadence.** A short triage pass each working session keeps intake from piling up; a full backlog
   + zero-tolerance sweep at each milestone gate (§5) and before any release (§7.6 hardening tier).
   WIP-limit discipline (PRODUCTION §6.6) applies: don't start a fix you won't finish.

---

## 9. Defect lifecycle

A defect moves through a small, explicit set of states. The transitions that matter for this
project are the ones that enforce "a bug is not fixed until a test guards it."

```
NEW → TRIAGED → IN PROGRESS → FIX + REGRESSION TEST → VERIFIED → CLOSED
                     │                                    │
                     └──────────── WON'T FIX / BY DESIGN ─┘   (emergence, false encounter §8.5)
                                                        REOPENED ← (regression / escaped)
```

| State | Enters when | Exit condition |
| --- | --- | --- |
| **New** | Filed with §8.6 fields (auto-filed by a failing test). | Severity + priority assigned. |
| **Triaged** | Classified (§8.1–8.4), routed to a milestone. | Work starts / deferred to backlog. |
| **In progress** | A fix is actively being worked (respect WIP limit). | Fix implemented. |
| **Fix + regression test** | Code changed. | A seeded regression test (> SEV-3) exists and fails without the fix, passes with it. |
| **Verified** | Smoke/full suite green with the new test. | Confirmed on the target build. |
| **Closed** | Verified and merged. | — |
| **Won't fix / By design** | Determined to be emergent-as-designed (§8.5) or out of horizon. | Documented reason; recorded so it isn't re-filed. |
| **Reopened** | An escaped defect or a returning regression. | Back to Triaged; ask why the guard test didn't catch it. |

A **Reopened** zero-tolerance defect additionally triggers a "why did this escape?" note — a missing
golden run or invariant is itself filed as a test-coverage gap.

---

## 10. QA health metrics

Tracked against the PRD §4 success metrics; these tell us whether QA itself is working, not just the
game. Reviewed at each milestone gate (PRODUCTION §11 tracking).

| Metric | Target | Source |
| --- | --- | --- |
| **Crash-free session rate** | ≥ 99.5% at launch | NFR-REL-01, PRD §4 |
| **Save-corruption defects** | **Zero** at launch (hard gate) | NFR-SAVE-02, PRD §4 |
| ***Must*-requirement test coverage** | 100% of in-scope *Must* reqs have ≥1 passing mapped test before their gate | §13 |
| **Determinism suite pass rate** | 100% (any failure is SEV-1, halts CI) | §6.2, §7.2 |
| **Golden-run pass rate** | 100% green (or an intended, re-blessed diff) | §7.1 |
| **Invariant pass rate** | 100% (`INV-*` never violated) | §6.18 |
| **Escaped-defect rate** | Downward trend; each escape adds a guard | §9 Reopened |
| **Verbatim encounter-repeat rate** | < 5% within a full run | PRD §4, FR-ENC-02 |
| **"Last can" occurrence** | Majority of balanced test runs | FR-ECO-10, §7.5 |
| **Turn resolve / load time** | < 100 ms / < 3 s on target phone | NFR-PERF-01 |
| **Accessibility Must-pass** | 100% of NFR-ACC-01/02 checks pass | §6.16 |
| **Story recall (playtest)** | ≥ 60% recount an unscripted moment unprompted | PRD §4 |

Numeric thresholds beyond the hard gates are finalized once a closed-test telemetry baseline exists
(PRD §4, §15.7) — the metric *definitions* hold now; the exact bars are set then.

---

## 11. Roles, ownership & cadence (solo + AI)

There is no separate QA team (PRODUCTION §2). Ownership is split by what each party is good at, and
the deterministic headless core is what makes the split viable.

| Responsibility | Owner | Notes |
| --- | --- | --- |
| Write & maintain automated suites (determinism, unit, property, golden, integration, content) | **AI**, reviewed by Jharek | The bulk of testing; regenerated as systems change. |
| Author adversarial content & invariants | **AI + Jharek** | Jharek defines the design intent; AI generates cases. |
| Triage & prioritize defects | **Jharek** (AI assists classify) | Priority is a scope decision; the human owns scope. |
| Exploratory play & the "one more day" fun gate | **Jharek** | Not automatable; the scarce human signal (§6.17). |
| Balance review & re-blessing golden runs | **Jharek** | Intended-vs-regression is a judgment call. |
| Accessibility & device-lab checks | **Jharek + AI** | Automated where possible; real-device manual pre-milestone. |
| CI ownership (gates, red-blocks-merge) | **AI-maintained, Jharek-owned** | The gate config is itself reviewed. |

**Cadence (fits PRODUCTION §8):**

- **Per push** — smoke tier (§7.6) must be green to merge.
- **Nightly** — full tier; a broken nightly is the first thing addressed next session.
- **Per working session** — a short defect-triage pass; respect WIP limits.
- **Per milestone gate** — pre-milestone tier + metrics review + release-readiness checklist (§12).
- **Per release** — hardening tier + full zero-tolerance sweep + sign-off.

---

## 12. Release-readiness checklist (sign-off gates)

A milestone or release is signed off only when its box is fully checked. Each gate inherits all
earlier gates (§5). This is the operational form of PRODUCTION §5 Definition of Done.

### 12.1 Every milestone gate (M1–M5)

- [ ] Smoke green on every merge into the milestone; latest nightly full suite green.
- [ ] Every in-scope *Must* requirement has ≥1 passing mapped test (§13).
- [ ] **No open SEV-1; no open zero-tolerance defect (§8.4).**
- [ ] All `INV-*` invariants passing.
- [ ] Golden runs green or intended diffs re-blessed with reasons.
- [ ] New/changed content passes the schema gate and the five-question test.
- [ ] Defect backlog triaged; no PRI-0 open.

### 12.2 M3 — Vertical Slice complete (adds)

- [ ] End-to-end golden run produces a coherent, retellable emergent story summary.
- [ ] **Stage-1 "one more day" fun gate** recorded as passed (PRODUCTION §4).
- [ ] Slice cases §6.1–6.11 passing; core loop, node memory, and save fidelity proven.

### 12.3 M4 — MVP / public beta (adds)

- [ ] Content-complete first city passes schema validation in CI.
- [ ] Infection network, radio, encounter breadth, factions have full case sets passing.
- [ ] **Crash-free ≥ 99.5% across closed-test sessions.**
- [ ] Accessibility baseline automated; every sound cue has a non-audio equivalent (FR-AUD-06).

### 12.4 M5 — v1.0 launch (adds)

- [ ] Full regression green (all tiers), including performance on target hardware.
- [ ] **Zero save-corruption defects; save migration verified across every shipped version.**
- [ ] NFR-ACC suites pass (screen-reader complete, contrast/colorblind, reduced-motion).
- [ ] NFR-LOC: all player-facing strings externalized; layout tolerates text expansion.
- [ ] Multiple endings + authored failure endings covered; no bare "You Died".
- [ ] **Stage-2 "one more day" fun gate** passed.
- [ ] Privacy: no PII required; telemetry opt-in verified (NFR-PRIV-01).
- [ ] Release-hardening tier (§7.6) complete and signed.

---

## 13. Traceability & coverage

Coverage is auditable in both directions, mirroring the PRD's traceability discipline (PRD §14).
The rule: **no in-scope *Must* requirement reaches its milestone gate without at least one passing
mapped test.**

| PRD area | Requirements | QA section | Anchor cases / notes |
| --- | --- | --- | --- |
| §7.1 Core loop | FR-CORE-01..07 | §6.1 | TC-CORE-01..08 |
| §7.2 World sim | FR-SIM-01..11 | §6.3 | TC-SIM-01..11 |
| §7.3 Exploration & map | FR-MAP-01..08 | §6.4 | TC-MAP-01..06 |
| §7.4 Player systems | FR-PLR-01..10 | §6.5 | TC-PLR-01..08 |
| §7.5 Injuries & infection | FR-INJ-01..11 | §6.6 | TC-INJ-01..08 |
| §7.6 Encounters | FR-ENC-01..10 | §6.7 | TC-ENC-01..06 |
| §7.7 Combat & stealth | FR-CBT-01..10 | §6.8 | TC-CBT-01..08 |
| §7.8 Economy | FR-ECO-01..10 | §6.9 | TC-ECO-01..07 |
| §7.9 Shelter | FR-SHL-01..10 | §6.10 | TC-SHL-01..05 |
| §7.10 Survivors & factions | FR-NPC-01..10 | §6.11 | TC-NPC-01..06 |
| §7.11 Story, radio, endings | FR-STY-01..09 | §6.12 | coverage notes (MVP/v1) |
| §7.12 UI/UX | FR-UI-01..07 | §6.13 | TC-UI-01..05 |
| §7.13 Audio | FR-AUD-01..06 | §6.14 | coverage notes; FR-AUD-06 = P0 a11y |
| §7.14 Content pipeline | FR-CNT-01..05 | §6.15 | TC-CNT-01..05 |
| §9 Non-functional | NFR-* | §6.16 | TC-NFR-01..11 |
| §10 Technical constraints | TEC-01..07 | §6.2, §4, §6.15 | Determinism suite + harness + content gate |
| Cross-cutting invariants | GDD II principles | §6.18 | INV-01..09 |

**Coverage gaps are tracked, not hidden.** Any *Must* requirement without a passing mapped test at
its milestone is itself a **PRI-0 coverage defect** — filed like any other bug (§8) until closed.

---

## 14. Appendices

### 14.A Document map

| This doc references | For |
| --- | --- |
| [`docs/GDD.md`](GDD.md) | The six principles (Part II) as the acceptance lens; system semantics. |
| [`docs/PRD.md`](PRD.md) | Requirement IDs (FR-/NFR-), success metrics §4, risks §13, milestones §11. |
| [`DESIGN.md`](../DESIGN.md) | State model §4, pipeline §5, subsystems §6, determinism/RNG/saves §9, engine↔client contract §10, testing strategy §11 (which this doc expands). |
| [`docs/PRODUCTION.md`](PRODUCTION.md) | Milestone ladder §3, fun gates §4, Definition of Done §5, scope control §6, cadence §8. |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | The five-question test every content entry must pass. |

### 14.B Glossary (QA-specific; complements DESIGN §15)

- **Golden run (`GR-##`)** — a committed `(seed, action[])` fixture with an expected run summary;
  the regression backbone (§7.1).
- **Invariant (`INV-##`)** — a property that must hold in every reachable state; enforced by
  property tests (§6.18).
- **Zero-tolerance defect** — a bug class that blocks release by definition (§8.4): save corruption,
  determinism drift, core crash, run-crashing content, accessibility Must-fail, hidden-state leak.
- **Re-bless** — the reviewed act of updating a golden-run/balance expected output after an
  *intended* change, recorded with a reason (§7.1).
- **Comprehension bug** — a defect where correct hidden-state logic is unreadable to the player
  (§8.5); fixed by design, never by adding a bar.
- **Fun gate** — the "one more day" playtest checkpoint (PRODUCTION §4); Stage-1 gates M3, Stage-2
  gates M5.
- **Master suite** — the determinism/RNG/saves tests (§6.2); if it's red, no other result is
  trusted.

---

*End of QA & Test Plan. This document tracks the PRD, DESIGN, and PRODUCTION plan; when a system's
requirements or architecture change, revisit the mapped cases (§6), the affected golden runs (§7),
and the traceability matrix (§13).*
