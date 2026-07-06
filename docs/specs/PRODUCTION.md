# Zurvival Reborn — Production Plan

**Version:** 1.0 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`GDD.md`](GDD.md) (what & why) · [`PRD.md`](PRD.md) (what to build & when) · [`../DESIGN.md`](../../DESIGN.md) (how it's built)
**Companion tracker:** [`scope-control-tracker.xlsx`](../plans/scope-control-tracker.xlsx) · **Visual:** [`../design/diagrams/roadmap.svg`](../../design/diagrams/roadmap.svg)

---

## 1. What this document is

The GDD says *what the game is*. The PRD says *what to build and in what order*. The technical
design says *how it's built*. This plan says **how it actually ships without drowning** — the
milestone ladder as executable work, the gates that decide go/no-go, and the machinery that
holds scope when a deep design tempts endless expansion.

It is deliberately **effort-based, not calendar-based**. Per the PRD, dates are omitted until
staffing is real; the commitment here is *sequence, exit criteria, and scope discipline*, not a
date. Effort is expressed in relative bands (§Appendix) so a milestone can be reasoned about and
re-planned without pretending to a schedule that doesn't exist yet.

This document changes. It is a plan, not a contract. When the GDD or PRD moves, the affected
milestone and its budget move with it.

---

## 2. The operating reality: solo + AI

Everything below is designed around one honest constraint: **one person, with AI as a force
multiplier.** That changes what the plan optimizes for.

- **AI multiplies output, not judgment.** AI can generate a hundred schema-valid encounters
  overnight, scaffold engine modules, write test harnesses, and crunch balance telemetry. It
  cannot decide whether the game is *fun*, hold the tonal voice, or make the integration calls
  that keep six systems coherent.
- **The real bottleneck is review capacity, not typing speed.** The scarce resource is the
  owner's hours spent reviewing, integrating, playtesting, and taste-checking. A solo dev drowns
  not in work they can't produce but in work they can't *verify*. Every budget in this plan
  protects review capacity first.
- **Depth-before-breadth is survival, not preference.** For a solo builder, a broad half-built
  shell is fatal — nothing is playable, nothing can be gated, motivation dies. The plan keeps a
  *playable build at every milestone* so there is always something to test and feel.
- **Determinism is the solo dev's safety net.** The deterministic core (DESIGN §2) means any bug
  reproduces from seed+state, any AI-generated regression is caught by golden-run tests, and any
  session can be saved and resumed. Protect it ruthlessly; it is what makes one person able to
  debug a simulation.

The golden rule from GDD Part XIX still governs: **a small, complete, stable, fun game beats a
huge, broken one.** Every milestone must be *complete* (no dead ends), *stable* (it doesn't
break), and *fun* (worth playing) at its own scope.

---

## 3. The milestone ladder

Six milestones, then post-launch. Numbering follows the PRD's M1–M5 exactly and adds an explicit
**M0 — Foundation** for the pre-code skeleton the PRD folds into its M1. Each milestone is a
*vertical* increment: it produces a thing you can run, not a horizontal layer you can't feel.

| # | Milestone | Theme | Horizon | Retires the risk | Effort |
| --- | --- | --- | --- | --- | --- |
| **M0** | Foundation | The skeleton runs | pre-VS | Undecided stack / analysis paralysis | M |
| **M1** | Core loop playable | The loop is satisfying | Vertical Slice | — *(loop-feel check)* | L |
| **M2** | Reactive world | The world moves on its own | Vertical Slice | "Impressive but static" | L |
| **M3** | People, shelter & first story | A run becomes a story | **Vertical Slice — complete** | **Systemic but not fun** | XL |
| **M4** | Content-complete city | Breadth without repetition | MVP / public beta | Content volume | XL |
| **M5** | Release candidate | Balanced, accessible, hardened | v1.0 launch | Balance fragility · save churn | XL |
| **P+** | Post-launch | Content cadence + new clients | live | Long-tail relevance | ongoing |

The line between **M3 and M4 is the decisive gate** (§4). Everything up to M3 proves the core is
fun at tiny scope. Nothing pours content until it has.

### M0 — Foundation *(the skeleton runs; no game yet)*

**Goal.** Close pre-production and stand up the deterministic core so real work can begin.

**In scope.** Accept ADR-0001 (engine language/runtime) against its §10 criteria; ADR-0002
(content data format). Build: `GameState` shape, the turn pipeline shell (all 14 stages present
as no-ops), seeded RNG with named streams, the content loader + first schemas, save/load
round-trip, and CI that fails on malformed content. A terminal harness that runs an empty turn.

**Out (defer).** Any actual gameplay system. Any client beyond a terminal. Any content beyond one
throwaway test region.

**Entry.** GDD/PRD/DESIGN accepted (done). ADR-0001 criteria written (done, PRD §10).

**Definition of done.** `applyAction(state, action)` runs the full pipeline order deterministically;
same seed+state → byte-identical result (test-proven); a save round-trips losslessly; CI rejects a
deliberately malformed content file. **The skeleton runs.**

**Solo + AI.** AI scaffolds the module structure, the RNG stream plumbing, and the test harness.
Human owns the ADR-0001 decision — time-box it (§10) and *decide*; this is the #1 stall risk.

### M1 — Core loop playable *(Vertical Slice, part 1)*

**Goal.** Prove the moment-to-moment choosing is satisfying before any world reactivity.

**In scope.** One region, 5–8 nodes with real memory (FR-SIM-02); the real loop — move / search /
fight-or-avoid / rest (FR-CORE-01..05,07); time cost per action (FR-CORE-03); noise deposit
(FR-SIM-06); named wounds treated not regenerated (FR-INJ-01,04); finite, contested, depleting loot
(FR-ECO-01..03); weight-limited inventory (FR-PLR-03); turn-based avoidable combat with loud firearms
(FR-CBT-01,02,04,05); fog-of-war node graph (FR-MAP-01..03,06); the story-first single-decision UI
(FR-UI-01,02,03,05); accessibility baseline begins here, not later (NFR-ACC-01,02).

**Out (defer).** Off-screen world evolution, hordes, weather, director → M2. Companions, shelter,
survivors → M3. Infection-as-identity, radio, encounter breadth → M4.

**Entry.** M0 done.

**Definition of done.** A player can run a slice of turns end to end in the terminal/first client;
every resolved turn changes ≥ 1 system (FR-CORE-04, telemetry-audited); quit/resume at any turn
boundary is lossless; a stealth path exists through the combat scenarios. → **Loop-Feel Check (§4).**

**Solo + AI.** AI generates the first encounter batch, item/weapon data, and unit tests. Human
plays it daily and asks the only question that matters yet: *is picking an action interesting?*

### M2 — Reactive world *(Vertical Slice, part 2)*

**Goal.** Make the world move whether or not the player is watching.

**In scope.** The six simulation layers updatable independently (FR-SIM-01); regional threat/density/
loot drift off-screen (FR-SIM-03); migrating hordes that re-path to noise (FR-SIM-07, FR-CBT-08);
zombie state machine + first distinct types (FR-CBT-06,07); weather with multi-system effects
(FR-SIM-05); time-of-day danger (FR-SIM-04); the Apocalypse Director biasing pacing without breaking
logic (FR-SIM-10); Living History append-only log (FR-SIM-11); route conditions (FR-MAP-04).
**Telemetry instrumentation goes in here** (PRD §4 proxies) so later balance has a baseline.

**Out (defer).** People and shelter → M3. Infection staging, radio, full encounter categories → M4.

**Entry.** M1 done and past the Loop-Feel Check.

**Definition of done.** A region's threat measurably changes across days with the player absent; a
logged gunshot re-paths a nearby horde in the target share of cases; disabling the director changes
pacing metrics but never produces an impossible state; the same slice run now feels *alive*.

**Solo + AI.** AI is strong on the state-machine boilerplate and the telemetry pipeline. Human
guards determinism — every new system must keep `(state, action, seed)` reproducible.

### M3 — People, shelter & first story *(Vertical Slice — complete)*

**Goal.** Turn a systemic slice into a *story a player wants to retell*. This is the whole bet.

**In scope.** A 3–5 survivor subset from the handcrafted pool (FR-NPC-01 subset); one recruitable
companion with autonomous AI and permanent, remembered death (FR-NPC-03,04); one claimable shelter
node with integrity/population/morale and a daily report of off-screen activity (FR-SHL-01,02,10);
first night-attack defensive scene (FR-SHL-06); the mind model surfaced via behaviour not bars
(FR-INJ-09); the Storyteller surfacing relationship/history threads (FR-NPC-09); a first authored
failure ending so death is a scene, not a card (FR-STY-07, FR-CBT-10).

**Out (defer).** The full 60–100 survivors, faction diplomacy, jobs/rooms breadth, romance,
memorial wall → M4/M5/Won't-now.

**Entry.** M2 done; telemetry live.

**Definition of done.** A single full slice run generates an emergent, retellable story and the
companion's fate lands; the daily report reflects real simulated activity; losing the shelter is a
heavy but survivable state, not an auto game-over. → **Slice Fun Gate (§4) — the decisive go/no-go.**

**Solo + AI.** AI drafts survivor bios, dialogue, and the daily-report copy at volume against the
schema; human does the casting and voice pass — the characters are the heart and cannot be
auto-approved. **Do not start M4 until the Fun Gate passes.**

### M4 — Content-complete city *(MVP / public beta)*

**Goal.** Breadth — the full first city — without the repetition that kills an emergent game.

**In scope.** The full launch Content Bible for **one city**: all regions, nodes, the target
survivor pool, full encounter categories with chains and multi-stage flows (FR-ENC-03..08), infection
as staged identity (FR-INJ-05..08), the radio network (FR-STY-03), crafting/rooms/jobs economy
(FR-ECO-04..07, FR-SHL-03,04), factions and inter-NPC relationships (FR-NPC-02,05,06,07), depth
screens (FR-UI-04), the adaptive audio mix with non-audio equivalents (FR-AUD-01,02,06), difficulty
modes, and the accessibility baseline complete. **All content schema-validated in CI** (FR-CNT-02).

**Out (defer).** Additional cities, vehicles, trade depth, romance, epilogues → v1.0-Could or
Won't-now. Full 100-survivor cap may be a *defined beta subset* if review capacity requires (§7).

**Entry.** M3 done **and Fun Gate passed.** Content schemas frozen (blocks large authoring).

**Definition of done.** The first city is content-complete and schema-valid; verbatim encounter
repetition sits under the PRD §4 target across a full run; infection-as-identity plays as *a harder
way to keep going*, comprehension-tested with players; the beta is stable enough to hand out.

**Solo + AI.** This milestone *is* the content-volume risk, and AI is the mitigation — generate
against schema at volume, then gate through the five-question test + Rule of Three. **Review
capacity, not generation, is the ceiling** — see the content budget (§7).

### M5 — Release candidate *(v1.0 launch)*

**Goal.** Balanced, accessible, localized, hardened, and finished.

**In scope.** Staged balance passes (survivability → scarcity → pacing/director → difficulty modes →
accessibility, GDD XVI); multiple endings assembled from run components + failure endings with
closure (FR-STY-06,08); full accessibility (NFR-ACC-01..04); localization externalization complete
(NFR-LOC-01); save migration proven across a schema change (NFR-SAVE-02); crash-free ≥ 99.5%,
zero save-corruption (NFR-REL-01); the polish and UI-restraint pass (FR-UI-06). Monetization and
licensing decided (Open Questions 5, 8).

**Out (defer).** Native/Steam/chat-bot clients and any second city → Post-launch unless promoted.

**Entry.** M4 beta stable; art/audio direction locked (blocks polish).

**Definition of done.** Every Must requirement met at its release; balance targets hit in telemetry;
a save survives a real migration; accessibility verified with assistive tech; the "one more day"
test passes with external players, not just the author.

### P+ — Post-launch

Content cadence on the expansion hooks that need *no engine rewrite* (new regions, survivors,
encounters, radio per DESIGN §14 / GDD IV); then the native and chat-bot clients (ADR-0004 order);
then second-city and deeper-faction expansions. The headless engine (DESIGN §3) is what makes new
clients additive rather than a rewrite.

---

## 4. The two-stage fun gate

The single most important control in this plan. "Systemic but not fun" is the project's top risk;
the fun gate is how it's retired. There are two checks, deliberately separated — an early cheap read
and a later decisive verdict.

**Stage 1 — Loop-Feel Check (after M1).** The PRD's M1→M2 gate. Cheap, internal, fast: with only
the raw loop built, is *choosing an action* interesting turn to turn? If no, **stay on the loop** —
do not add world reactivity to paper over a boring core. This check gates the *style* of the fun
(the verbs), not the whole experience.

**Stage 2 — Slice Fun Gate (after M3) — decisive.** The complete vertical slice — loop + reactive
world + one companion + one shelter — must produce an emergent, retellable story and pass the
**"one more day" test** with real playtesters (GDD XVI, XIX). This is go/no-go for the entire
content phase.

> **The gate's authority over scope.** If the Slice Fun Gate fails, the answer is **never "add more
> content."** Scope re-invests in the loop, the director, the characters, or the pacing until the
> slice grips. Content stays frozen. A failing gate that gets "fixed" by pouring content is how
> emergent games die — this plan forbids it.

Record every gate verdict in the tracker's **Fun-Gate Log** with build, date, the specific
retellable moment (or its absence), and the decision.

---

## 5. Definition of Done

Nothing is "done" because it was built. Done has a global bar and a per-type checklist.

**Global (every milestone).** *Complete* — no dead ends or placeholder stubs in the shipped path.
*Stable* — it doesn't break; determinism and save/load hold. *Fun* — it's worth playing at this
scope. A milestone that fails any of the three is not done, regardless of how much was built.

**Per-type, before a work item is marked done in the tracker:**

- **Engine system** — deterministic (golden-run test passes), unit-tested, integrated into the
  pipeline in the correct stage, and it can't produce an invalid state (property test).
- **Content entry** (encounter/item/survivor/etc.) — schema-valid (CI green), passes the
  five-question test, meets the Rule of Three where it's a significant location, tone-checked by a
  human, and localization-externalized.
- **UI screen** — critical info conveyed without colour or audio alone (NFR-ACC-01), screen-reader
  navigable (NFR-ACC-02), one-hand mobile layout holds, no fake choices.
- **Balance change** — justified by telemetry or a logged playtest, not intuition alone; re-checked
  against the Survival Triangle (no strategy escapes a trade).

---

## 6. Scope control — the machine

A deep design tempts endless expansion; a solo builder can be buried by their own ambition. Scope
control here is not a vibe, it is a set of mechanisms with tripwires. This is the "no machine."

### 6.1 The cut filter — the six principles as a *no* machine

Every feature, every content idea, every "wouldn't it be cool if" passes one gate: **does it serve
at least one of the six principles?** (Systemic core loop · Injuries are stories · Nodes with memory
· The Survival Triangle · Handcrafted social simulation · Artifacts over XP.) If it serves none, it
**waits or dies** — it does not enter a milestone. If it serves one but costs more review capacity
than the milestone's budget allows, it defers. The principles are the acceptance lens for the whole
product (PRD §14); here they are also the rejection lens.

### 6.2 MoSCoW discipline

Every requirement carries a MoSCoW priority (PRD §7) and every backlog item inherits one.
The rule the plan enforces:

- **Must** — the milestone is *not done* without it. Musts are never cut to hit a milestone; if a
  Must can't fit, the *milestone* is re-scoped, not shipped broken.
- **Should** — cut *first* under pressure. A slipped Should does not kill a milestone.
- **Could** — done only when ahead of budget. The default answer to a Could mid-milestone is "next."
- **Won't-now** — frozen (§6.3).

Under pressure, the cut order is fixed: **Coulds, then Shoulds, then re-scope the milestone. Never
extend by cutting a Must or skipping the fun gate.**

### 6.3 The Won't-Now register

The PRD §6 out-of-scope list — multiplayer/PvP, UGC marketplace, cities beyond the launch city,
full faction territory wars, animal ecosystems, deep vehicle modification — is a **frozen register**,
not a backlog. Its purpose is to *stop relitigation*. Reopening an item requires a formal change
request (§6.5) evaluated only at a milestone boundary. Recording an idea here is not rejecting it
forever; it is refusing to let it derail the current horizon. New "great ideas" land here by default.

### 6.4 Budgets — the caps that make "no" automatic

Two budgets convert scope discipline from willpower into arithmetic.

**Content budget (per milestone).** Hard caps on how much content a milestone may contain. Caps
protect *review capacity* (§2) — the true ceiling for a solo+AI dev. Exact numbers are set once the
schema and the first authored batch reveal the real cost-per-item; the cap existing is the point.

| Content type | M1 | M2 | M3 (slice) | M4 (city) | M5 |
| --- | --- | --- | --- | --- | --- |
| Regions | 1 | 1 | 1 | full city (≈4–6) | freeze |
| Nodes | 5–8 | 5–8 | 5–8 | ≈40–60 | freeze |
| Survivors | 0–1 | 0–1 | 3–5 | target pool *(or defined beta subset)* | freeze |
| Companions | 0 | 0 | 1 | several | freeze |
| Zombie types | 1–2 | 3–4 | 3–4 | full set | freeze |
| Encounters | 12–20 | 25–35 | 40–60 | large target *(§4 repeat-rate gated)* | freeze |
| Radio stations | 0 | 0 | 1–2 | full network | freeze |

> Going over a cap is not allowed by adding hours; it is resolved by cutting Shoulds/Coulds or
> moving the excess to the next milestone. A cap hit *early* is a signal the slice is rich enough —
> stop authoring and go playtest.

**Effort budget (per milestone).** Each milestone has an effort band (§3 table). If tracked effort
exceeds the band by **> 25%**, that is a **tripwire**: stop, run a scope review, cut to the band —
do **not** silently extend. Overrun is information about scope, not a reason to work more.

### 6.5 Change control — the parking lot

New scope does not enter a milestone in flight. The process:

1. **Capture.** Any new idea/feature/"cool if" goes straight to the tracker's **Parking Lot** — never
   into the current milestone. Capturing it is how you stop thinking about it.
2. **Triage at boundaries only.** Ideas are evaluated **only at milestone boundaries**, never
   mid-milestone (defects excepted). This preserves the current milestone's integrity.
3. **Score.** Each candidate is scored against the cut filter (§6.1): which principle it serves, its
   review-capacity cost, and which existing Should/Could it would displace. Nothing is added without
   naming what it *replaces* — scope is zero-sum against review capacity.
4. **Route.** Scheduled into a future milestone, deferred to the Won't-now register, or killed. The
   decision and its reason are logged so it is not relitigated.

### 6.6 WIP limits — the solo dev's discipline

Solo builders die from too many half-finished systems, not from too few started. Therefore:

- **One milestone in flight.** No starting M4 authoring "to get ahead" while M3 is unproven.
- **Finish-to-done before starting new.** Within a milestone, limit systems worked in parallel;
  drive each to the per-type DoD (§5) before opening the next. A half-built system is not progress,
  it is unverified risk.
- **Always a playable build.** Never a long integration-less stretch. If the build hasn't been
  played in a week, that's a tripwire.

### 6.7 Anti-pattern tripwires

Named traps for *this* game, each with a tripwire and a fixed response:

| Trap | Tripwire | Response |
| --- | --- | --- |
| Systemic but not fun | Slice Fun Gate fails | Freeze content; re-invest in loop/director/characters |
| Content-hunger repetition | Verbatim-repeat rate > §4 target | Recombination, cooldowns, encounter evolution — *not* raw volume |
| Infection confusion | Playtesters can't act without the hidden number | Strengthen symptoms + optional diagnosis; never require the number |
| Stack analysis paralysis | ADR-0001 open at M0 exit | Force the time-boxed decision; pick and move |
| Ambition creep | New idea enters a live milestone | Route to Parking Lot; triage only at the boundary |
| Solo overreach | Build unplayed > 1 week, or 3+ systems half-done | Stop; drive one to done; play it |

---

## 7. Solo + AI operating model

How the one-person-plus-AI reality maps onto the work.

**What AI carries.** Schema-valid content generation at volume (encounters, items, weapons,
survivor bios, dialogue, radio scripts) — the direct mitigation for the content-volume risk;
engine boilerplate (state machines, RNG plumbing, loaders); test scaffolding (unit, property,
golden-run); refactors; balance-telemetry crunching; and keeping the docs coherent with the code.

**What stays human — never delegated.** The fun verdict at both gate stages. The tonal voice and
character casting (the people are the heart). Systemic integration calls that keep six systems
coherent. Balance intuition seeded by real playtest. And every *cut* decision — the "no machine"
is run by the owner, not automated.

**The review-capacity budget.** AI can generate faster than one human can quality-gate. So the
plan budgets **review throughput, not generation throughput.** The content budget (§6.4) is
really a review-capacity budget in disguise: it caps content at what one person can actually
taste-check, tone-pass, and integrate. When generation outruns review, the answer is to *slow
generation*, never to merge unreviewed content.

**Guardrails on AI output.** Nothing AI-generated merges unreviewed. Every generated content entry
must pass schema CI + the five-question test + a human tone pass. Determinism and golden-run tests
are the backstop against AI-introduced nondeterminism or balance drift. The CI gate (malformed
content fails the build) means volume can't corrupt a player's run.

---

## 8. Cadence & operating rhythm

Effort-based, so cadence is a *loop*, not a calendar.

**The weekly loop.** Plan (pull the next items from the current milestone's backlog, respecting WIP
and the cut filter) → Build (AI-assisted) → Verify (tests green + a real self-playtest) → Review
(what's done to DoD, what's stuck, what to cut). If a week passes without a playable build being
played, that's a tripwire (§6.6).

**Playtest cadence.** Self-playtest continuously from M1. External playtest at each fun-gate stage
and before beta. Telemetry instrumented from **M2** so balance in M4–M5 has a real baseline, not
intuition (PRD §4).

**Balance passes.** Staged, per GDD XVI, concentrated in M4–M5: survivability → scarcity →
pacing/director → difficulty modes → accessibility. Each pass is justified by telemetry or a logged
playtest, never by feel alone.

**Milestone retro.** At each boundary: run the gate (if any), reconcile scope (what was cut and
why), triage the Parking Lot, burn down the milestone's risk (§10), and re-band the next milestone's
effort with what was learned.

---

## 9. Decision-gate schedule (ADRs)

Open decisions are tracked as ADRs (`design/decisions/`, PRD §15). Each is tied to the milestone it
*must* be resolved by, so none silently stalls delivery.

| ADR / decision | Question | Resolve by | Blocks if open |
| --- | --- | --- | --- |
| **ADR-0001** | Engine language & runtime | **M0** (time-boxed) | *All code.* The top stall risk. |
| **ADR-0002** | Content data format (JSON/YAML/custom) | M0 | Content authoring tooling |
| **ADR-0003** | Save storage & versioning | M1 | Save migration design |
| **ADR-0004** | Platform ordering (native/Steam/bot) | M4 | Post-launch client work |
| Monetization / business model | Premium / free+cosmetic / episodic | M5 | Launch planning |
| Cross-run memory persistence | How much Living History carries between runs | M4 | Endings & meta-progression |
| Numeric metric thresholds | Exact §4 targets | after M2 telemetry baseline | Balance sign-off |
| Licensing | Proprietary / source-available / open | before any public release (M4 beta) | Public distribution |

**The one to force:** ADR-0001. Doc and design work proceed without it, but no `prototype/` code
begins until it's accepted. Time-box the decision against the PRD §10 criteria (web-deploy story,
deterministic-core testing, shared core across web + bot) and **decide** — an open stack at M0 exit
is the defined tripwire (§6.7).

---

## 10. Risk burn-down mapped to milestones

Each PRD §13 risk is retired (or actively managed) at a specific milestone, so risk reduction is
scheduled, not hoped for.

| Risk | Retired / managed at | How |
| --- | --- | --- |
| Undecided stack stalls delivery | **M0** | Time-boxed ADR-0001; decide and move |
| Systemic but not fun | **M3 Fun Gate** | Prove the slice grips before any content pour |
| Impressive but static world | M2 | Off-screen evolution + director produce visibly reactive turns |
| Content volume / repetition | M4 (managed continuously) | AI-at-volume *behind* the review-capacity cap; recombination, Rule of Three, cooldowns; measure repeat rate |
| Scope creep | every boundary | Cut filter + Won't-now register + parking-lot change control |
| Balance fragility | M5 (staged passes) | Director + comeback mechanics; telemetry on death timing/causes/margins |
| Infection-as-identity confusing | M4 | Strong symptom design + optional diagnosis; comprehension-tested |
| Accessibility retrofit | from **M1** | NFR-ACC is Must from the first UI; never bolted on late |
| Save-schema churn | M1 onward | Versioned saves + migration path from the first save format |

---

## 11. Tracking & health

Light-touch for a solo dev — enough signal to steer, not a reporting burden. Tracked in
[`scope-control-tracker.xlsx`](../plans/scope-control-tracker.xlsx):

- **Backlog** — every FR/NFR as a work item, mapped to milestone, MoSCoW, the principle it serves,
  effort band, AI-assist flag, and status. Traces back to the PRD by ID.
- **Content budget** — caps vs. actual counts per milestone; headroom computed. A red cell = stop
  authoring, go playtest.
- **Risk burn-down** — the §10 table as living status.
- **Decision gates** — the §9 ADR schedule with decisions logged.
- **Fun-Gate log** — every gate verdict: build, date, the retellable moment, go/no-go.
- **Parking lot / Won't-now** — captured ideas, triage decision, and reason.

**Health signals to watch:** every-turn-changes-a-system rate (FR-CORE-04); verbatim-repeat rate
(§4); crash-free rate; the "one more day" verdict; effort-vs-band per milestone. Numbers serve the
gate; the gate serves the game.

---

## 12. How to run this plan

1. Work the current milestone's backlog only; respect WIP (one milestone in flight).
2. Run every idea through the cut filter before it touches a milestone; park what doesn't fit.
3. Drive each item to its per-type Definition of Done; don't count half-built systems.
4. Keep a playable build and play it weekly.
5. At the boundary: hit the gate, reconcile scope, triage the parking lot, burn down risk, re-band next.
6. **Never** extend a milestone by cutting a Must or skipping a fun gate. Cut Coulds, then Shoulds,
   then re-scope.

---

## Appendix — Effort band key

Relative bands for *sequencing and triggering scope reviews*, not date promises. Calibrate the
week-values to real velocity after M1.

| Band | Rough size (solo + AI) | Use |
| --- | --- | --- |
| **XS** | < ½ week | a single content batch or small fix |
| **S** | ~1 week | one contained system or screen |
| **M** | ~2–3 weeks | a milestone of foundation/plumbing scope |
| **L** | ~4–6 weeks | a milestone with several integrated systems |
| **XL** | ~8+ weeks | a content-heavy or hardening milestone |

Overrunning a milestone's band by **> 25%** is a tripwire (§6.4): stop and re-scope to the band,
don't extend.

---

*End of Production Plan. This plan tracks the GDD and PRD; when they move, re-scope the affected
milestone and its budget. The gate is the point. Keep it small, complete, stable, and fun.*
