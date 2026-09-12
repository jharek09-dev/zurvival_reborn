# Design Review — gameplay audit of the T73 build

**Date** 2026-09-12 · **Build** `m4-part-14` + T70–T73 (owner-playtest stack) · **Reviewer** external design pass, commissioned by the owner
**Scope** Whole-game gameplay audit: engine (42 modules), harness, the full 160-entry content set, GDD / PRD / DESIGN, `FUN_GATE_LOG`, `FUN_GATE_SLICE`, `M4_EXIT_GATE`, `BETA`.
**Method** Every system traced from the value it computes to whatever reads that value back into a **player outcome**. Claims below were grepped or arithmetically simulated, not inferred from documentation.

**Outcome** M4 gains **T74–T77** (the reconnection work, to be playtested before the T57 exit verdict). M5 gains **T78–T87** and an explicit `seq` on every M5 task so the milestone reads in dependency order. Thirteen parking-lot deferrals are promoted to real tasks; six new `PL-M5-*` entries record what the tasks deliberately do not cover.

---

## 1. The finding

> **An excellent cause engine and almost no consequence engine. Most of the simulation terminates in narration.**

The `FUN_GATE_SLICE` transcript prints *"You hear them before you see them — a horde on the move, and it is coming this way"* on twenty consecutive turns, in both branches, while nothing ever arrives. That line is the review in miniature: the game threatens a consequence it has no machinery to deliver.

This is a better problem than the alternative. Almost every recommendation below is **connecting machinery that already exists**, and the four highest-leverage fixes are small.

### What is genuinely strong

Stated plainly, because the rest of this document is critical. The deterministic core with byte-identical repro-from-seed, lossless save at every turn boundary, 858 passing tests and 160 schema-validated content entries with zero dangling references is a better foundation than most shipped indie games have. **Infection-as-identity is a complete, faithful realization of the hardest idea in the GDD** — staged, unnumbered, perception-distorting, survivable at terminal, with diagnose / cure / quarantine all real. **`ask` → `NpcLead`** — spend an hour and a relationship, and a survivor tells you about a node you have not found, with `leadResolves` correctly suppressing the choice when the lead is already known — delivers Principle 5 exactly as written and is the best mechanic in the build. The QA culture is unusually honest: both gates document their own thin spots in their own words.

---

## 2. The signal ledger

Borrowing `radio.ts`'s own derived-status vocabulary. **Dead** = computed, consumed only by prose or telemetry. **Degraded** = wired, but arithmetic or tuning prevents it from mattering.

| System | Status | What actually consumes it |
|---|---|---|
| infection | **live** | Real staged clock, real verbs, real distortion |
| trust / `NpcLead` | **live** | `ask` reveals real map nodes |
| needs / survival | **live** | The only things that can end a run |
| noise → `detectChance` | **live** | `+0.005`/point on a slip roll — noise's one real consumer |
| loot contest | **live** | Regions drain on a wall clock whether you visit or not |
| encounters | **live** | 26 authored, 12 repeatable with tags + cooldowns |
| shelter jobs | degraded | `trunc(h/6)`, no accumulator → nothing on 1–2h turns |
| companion morale | degraded | Same; morale never leaves its recruit value |
| region drift | degraded | Equilibrium ignores authored baselines |
| Apocalypse Director | degraded | Pinned at one output; its dials are dead |
| routes / wear | degraded | A storm yields wear 15, still "clear" |
| weather | degraded | Only `detectionDelta` + `powerPressure` land |
| humanity | degraded | 17 effects move it; gates one betrayal branch and a prose band |
| equipped weapon | degraded | Durability wear only; damage is weapon-independent |
| `zombieState` ladder | **dead** | Three narration strings |
| hordes | **dead** | One narration line + telemetry + history |
| `zombieDensity` / `threat` | **dead** | Director + telemetry. Never becomes a zombie |
| `globalThreat` tide | **dead** | Oscillates 26–30 forever |
| faction reputation | **dead** | Write-only at seed |
| `combat.alerted` | **dead** | Written twice, never read |
| pack weight | **dead** | An inventory cap and nothing else |
| `corpses` / `blood` / `traps` | **dead** | Seeded, never written |
| wound type | **dead** | `bleed`/`slow`/`weaken` never branched on |
| win condition | **dead** | Does not exist |

---

## 3. Five structural findings

### I — The zombies are not the pressure

Four independent mechanisms, any one of which would be serious.

- **No player health.** `CharacterState` is `{needs, wounds, infection, mind}`. The only `hp` in the codebase belongs to `CombatState` — the enemy's. `runEndReason` returns `"starved" | "dehydrated" | "infection"`. **A zombie cannot kill you.**
- **Zombies never respawn.** `node.walkers` is written in exactly three places: `seedWorld.ts:79`, `combat.ts:269` (`−1` on a kill), and `events.ts:440` (`seedWalkers`, 4 uses in content). Nothing ever adds one back.
- **Hordes have no teeth.** One horde for 60 nodes, `trunc(h·speed/4)` = 0 steps on a normal turn, and arriving is not an event.
- **Two of seven zombie types are flavour.** Screamer and Stalker have no `ENEMIES` entry, so they fight as walkers.

**Open question → `PL-M5-01`.** "Injuries are stories, not −10 HP" taken to its limit *does* produce a game where zombies maim rather than kill, and that is defensible. But it is nowhere recorded as a decision, it contradicts the GDD's own core-stats list, and it makes the Last Stand structurally impossible rather than merely unbuilt. **Settle it first** — whether findings III–V are bugs or consequences depends on the answer.

### II — An integer division is switching off the base game

Nine sites compute `Math.trunc(h / N)` against the *current action's* hour cost with `N` = 2–12, discarding the remainder. Actions cost 1–2h. `trunc(2/6) = 0`.

| Site | Consequence |
|---|---|
| `jobs.ts:359` | Base economy produces nothing except during the 9h sleep. One gardener ≈ **1 fresh food/day** vs ~7 items/day scavenging |
| `social.ts:551` | Morale never drifts → `DESERT_MORALE` 25 vs a fed steady state of ~53 → **desertion and betrayal cannot occur** |
| `social.ts:674` | Off-screen NPC regroup (`trunc(h/12)`) never fires at all |
| `companions.ts:289` · `regionDrift.ts:71,74` · `timeOfDay.ts:114` · `jobs.ts:420` · `hordes.ts:165` | Scavenge, drift, the threat tide, spoilage, horde movement |

Stacked underneath: `stepToward`'s `Math.max(1, maxStep)` makes every `*_HOURS_PER_STEP` constant a no-op — everything moves exactly 1 point per turn regardless of hours.

→ **T74**. Closes `PL-M4-36` / `PL-M2-04`.

### III — The threat curve has a negative slope

- **Being hurt makes the world safer.** `playerDistressed` returns true for *any* wound with `treated < 100`, and wounds never self-heal. After your first fight the Director sits in `relief` permanently, pushing density down 1/turn.
- **Abandoning a region makes it safer.** Simulated 400 turns, player absent: Rivermouth 35 → 7; Downtown 70 → 11.
- **Regional identity has a ~4-day half-life.** Both shipped regions converge to ~threat 18 / density 28 regardless of their authored baselines.
- **Night is the safe phase.**

```
detectChance = clamp(0.25 + noise×0.005 − conceal/100 + weather/100, 0, 0.9)

midday, quiet node .....  25%
night,  quiet node .....  10%     (PHASE_CONCEALMENT night = 15)
night + fog ............   0%     (fog detectionDelta = −20 → clamped)
```

Night + fog is a guaranteed, riskless escape from any encounter in the game. The intended counterweight (`PHASE_THREAT_TARGET` 55 at night) feeds `globalThreat`, which oscillates 26–30 forever because of the `max(1, …)` bug.

→ **T78**, **T79**.

### IV — Several headline decisions have a dominant answer

**Firing is free.** `resolveFire` (`combat.ts:312`) never calls `enemyRetaliate`.

```
Melee a walker (3hp, dmg 1–2, retaliate p=0.5)
    E[time] 2.25h · P(wound) 56% · P(bite → infection) 30%
Fire
    E[time] 1h    · P(wound)  0% · P(bite)  0%  · cost 1 round
Riot (5hp, armor 1), melee
    E[time] 10h   · E[wounds] 4.5 · P(bite) 92.5%   — or 2 rounds, 2h, no risk
```

The designed counterweight, `FIRE_NOISE` 75 vs `MELEE_NOISE` 15, dead-ends in systems nothing reads.

**Slipping is free.** `SLIP_COST == MOVE_COST == 2`, walkers never pursue, and `escapeTargets` omits the `isBlocked` check that `move` performs — so walkers are a fast-travel network through blocked routes.

**Recruiting is always correct.** Zero companion references in `combat.ts`; no risk term anywhere.

**`order:scavenge` dominates the jobs system** — 1 item/2h, no prerequisite, ticks correctly, against `job.garden`'s 1/6h behind a build that does not tick.

Smaller: `job.kitchen` converts fresh (60 relief) → canned (45) against spoilage that cannot happen; `purify` converts the whole stack for one input cost; the freshness clock nulls at zero units, so dropping your last fresh item resets the 48h timer.

→ **T80**, **T81**, **T85**.

### V — There is nothing to build toward

No win condition. `endingFlags` is an empty stub. The reachable base tree is **5 scrap + 2 water + 12 hours**, finished on day 3, with no mutual exclusion and an unbounded `rooms` array — and an unbuildable half (no recipe installs `room.workshop`, so only 2 of 6 jobs are reachable). `item.batteries`, `item.lighter`, `item.blanket` and `item.charcoal` have **zero consumers anywhere in the codebase**.

Hour 20 therefore has a *narrower* decision space than hour 2. And there are **no melee weapons in the game** — the full roster is pistol / rifle / shotgun / molotov — so with XP correctly forbidden, the only progression axis is empty and the firefighter's axe the GDD names three times cannot exist.

→ **T87**, **T81**.

---

## 4. The build order

### M4 — reconnection, then playtest (T74 → T77 → T57)

| Task | Change | Unlocks |
|---|---|---|
| **T74** | Bank remainder hours; fix `stepToward` | Base economy ×5, morale drift, desertion, off-screen movement, horde movement, every pacing constant |
| **T75** | `zombieDensity` spawns walkers | **Keystone.** Director, drift, noise chain and all four difficulty dials acquire teeth at once |
| **T76** | Horde collision + 4–6 hordes + step 4→2h | Noise becomes the central strategic cost |
| **T77** | `zombieState`/`alerted`/`woundBurden`/pack weight → `detectChance` | Closes noise → arousal → detection into one causal chain |
| **T57** | *The existing exit gate* — owner playtest, now run against the above | The M4 verdict, fairly tested |

### M5 — systems, then endings, then balance, then hardening

`seq` 101–122, set in `docs/status.json`; no existing task renumbered (`T62` and `T66` are referenced by ID from engine comments and PRODUCTION scoping).

```
T78  director & drift correction          T61  multiple endings          ← needs T87
T79  neglected territory festers          T62  failure endings + Last Stand scene ← needs T82
T80  weapon profiles & combat verbs       T59  balance pass 1            ← needs the systems above
T81  melee weapon content                 T60  balance pass 2            ← needs T78/T79/T83
T82  combat stakes / Last Stand trigger   T63  accessibility
T83  night attacks & shelter loss         T64  localization
T84  exploration & node identity          T65  save migration
T85  base tradeoffs, water                T66  reliability & performance
T86  faction reputation                   T67  polish & UI restraint
T87  the terminal project (win)           T58  monetization decision
                                          T68  content freeze & Must audit
                                          T69  v1.0 launch gate
```

**The balance passes moved deliberately.** Tuning survivability and scarcity against the current build would fit dials to systems that are about to change shape — a game where firing cannot hurt you, slipping costs what walking costs, the Director eases off whenever you carry a wound, and the zombie population only ever falls.

---

## 5. Unpaid Must requirements

From the PRD's own MoSCoW tier — *"the release is not done without it"* — and, before this review, scheduled nowhere.

| ID | Requirement | Now |
|---|---|---|
| FR-SHL-06 | Night attacks as defensive scenes with real losses | **T83** |
| FR-SHL-10 | The shelter can be lost | **T83** |
| FR-STY-07 | Authored failure endings with real closure | **T62** (after T82) |
| FR-CBT-02 | Six combat verbs (heavy / aim / push / hide missing) | **T80** |
| FR-CBT-04 | Weapon categories with trade-offs | **T80** / **T81** |
| FR-CBT-10 | The Last Stand (*canonical*) | **T82** trigger → **T62** scene |
| FR-NPC-09 | The Storyteller (*canonical*) | Still unscheduled — `PL-M4-42` |

**Process note.** FR-SHL-06 was in M3's Definition of Done, slipped to M4 with an explicit promise (*"a survived siege is M4's contested world"*), then absent from the M4 exit gate entirely — not even as a deferral. Separately, the M4 gate verdict is still `PENDING` while T58–T73 (M5-tagged work) is already in the build.

**And the question deferred twice.** *"At session's end, did you want to start the next day?"* M3 hedged it; M4 defers it as Q2, still `_pending_`. It is the GDD's own non-negotiable health metric and it has never been answered by anyone but the owner — against a bar that reads *"with **real playtesters**."* The fun gate's own instruction applies: *"if it needs more content to grip, the gate's own rule says that's a fail, not a shopping list."* T74–T77 are what make that playtest worth running.

---

## 6. Do not break these

- **Infection, untouched.** The one system that fully realizes its requirement. Note that the real escape from terminal is closing the bite with plain `treat` (`advanceInfection` returns early when the wound is shut), while dosing at terminal nets E[−1.6] per 4h dose. That is an elegant lesson — *stop the driver, don't fight the fever* — and it is unsignposted. **Signpost it; do not retune the dials.** (`PL-M5-04`)
- **No XP, no levels, no visible bars.** Forbidden twice in the GDD and honoured rigorously. Under pressure to make progression feel better, the tempting fix is a stat. That is what T81 is for.
- **The full-pack rule.** An overflowing search leaves the find in the world *and* does not debit the region — genuinely elegant, self-limiting, and easy to lose in a loot rework.
- **Conversation that pays in map knowledge.** Extend it rather than replacing it: `SignalDef` should carry `reveals`/`marks` the same way `NpcLead` does (`PL-M5-05`).
- **The determinism discipline.** It is why this review could reason arithmetically instead of guessing. T74–T77 and most of M5 break byte-identity *intentionally* — declare them the way T71/T72 were, with semantic assertions rebaselined, rather than letting the change leak in.

---

## 7. New parking-lot entries

| ID | Subject |
|---|---|
| `PL-M5-01` | **Open question:** should the player have health? Settle before T82; log as an ADR |
| `PL-M5-02` | Wound type is inert; `bleed`/`slow`/`weaken` never branched on; the scent trail (FR-INJ-03) does not exist; 3 of 6 named wounds unshipped |
| `PL-M5-03` | Encounter weighting is uniform — no content sets `weight`; `metNpc`/`npcHere` never used, so no encounter is *about* someone you know |
| `PL-M5-04` | The infection cure race is unwinnable by its own verbs; the real escape is unsignposted |
| `PL-M5-05` | Radio pays in prose, not world state; `BROADCAST_OUTCOMES` is decorative |
| `PL-M5-06` | Dead exports and unreachable state (`advanceWorld`, `weatherNoiseFactor`, `woundBurden`, `factionArchetype`, `killCompanion`, six `NodeState` fields, the freshness-clock reset) |

**Promoted out of the parking lot:** `PL-M2-02` → T77 · `PL-M2-03` → T78 · `PL-M2-05` → T75/T76 · `PL-M3-05` → T79 · `PL-M3-06` → T83 · `PL-M3-08` → T83 · `PL-M4-07` → T82 · `PL-M4-15` → T61 · `PL-M4-26` → T75/T78 · `PL-M4-36` → T74 · `PL-M4-39` → T83 · `PL-M4-43` → T86 · `PL-M4-46` → T84.

---

## 8. One sentence

Four milestones built the causes and almost none built the bills — so the horde that has been coming this way for twenty turns is not a bug in that line, it is the only honest thing the game can currently say. **T74–T77 is roughly a week, requires no new ideas, and makes the sentence true.**
