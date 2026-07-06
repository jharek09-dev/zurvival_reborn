# M1 Part 2 — implementation plan (T14–T17)

Working design note for the second half of M1 (Core loop playable). Part 1 (T10–T13) made the
loop *move*: a region graph with fog of war, a real move/search/rest loop over Rivermouth, and a
telemetry audit proving every resolved turn changes a system. Part 2 makes the loop *bite* — the
four systems that turn "walk and rummage" into "survive": noise, avoidable combat, persistent
wounds, and a finite loot economy. All four are Musts for the Vertical Slice (PRD §6.1) and all
four are read at the M1 Loop-Feel Check (T21).

Everything here obeys the standing engine discipline (ADR-0001): pure, deterministic,
dependency-free, integer-only, plain-JSON, save-round-trippable. Each system is a module operating
on a slice of `GameState`, sequenced by the fixed 14-stage pipeline (DESIGN §5) — the stages never
call each other ad hoc.

## Build order

The requested numbering is T14–T17, but the clean dependency order — the order the code actually
compiles and tests in — is **T14 → T16 → T15 → T17**. Combat (T15) deposits noise (T14) and, when
an enemy lands a blow, inflicts a named wound (T16); loot (T17) is what a searched node yields and
what combat spends. Each increment lands under its own task id in the CHANGELOG and `status.json`;
the reorder is purely so no task ships with a forward-reference stub.

| Task | System | Pipeline stage(s) | New/expanded state | Retires |
|------|--------|-------------------|--------------------|---------|
| T14 | Noise deposit model | 6 `updateNode` | `nodes[].noise` (exists) | FR-SIM-06 |
| T16 | Named wounds | 4 `updatePlayer` | `player.condition.wounds` (exists) | FR-INJ-01/04 |
| T15 | Avoidable combat + firearms + stealth | 1–3 (actions), 6 (noise) | `combat` slice; `nodes[].walkers` | FR-CBT-01/02/04/05 |
| T17 | Finite loot economy | 3 `resolvePlayerAction` | `regions[].loot` (exists); node yields | FR-ECO-01/02/03 |

## T14 — Noise deposit model (FR-SIM-06)

**Idea.** Loud actions leave sound behind in the place they were made; sound fades with time. A
gunshot "this turn" is what a horde re-paths toward "next turn" (DESIGN §5). For M1 the consumer
(hordes) is still M2, so the deliverable is the *deposit + decay* half plus one hard property: the
quiet path is legibly quieter.

**Where it lives.** `NodeState.noise` already exists (0–100 int, per the T3 shape). New module
`src/sim/noise.ts` owns the numbers; pipeline **stage 6 `updateNode`** stops being an identity
no-op and becomes: *decay every node's noise by the hours the turn spent, then deposit the action's
noise at the node the player is now standing on.* Decay-before-deposit keeps the fresh deposit at
full strength for the next turn's (future) horde read.

**Numbers (tunable constants).** `rest`/`wait` emit `0` (silence is the quiet path); `move` emits
`8` (you moved through rubble); `search` emits `25` (rummaging carries); firearms (T15) will emit
`~70` via an action-level override. Decay is `5`/hour, floored at 0.

**DoD.** A loud playthrough (repeated searches) ends with materially higher summed node noise than
a quiet one (rest/careful moves) over the same turn count — asserted by an engine property and a
harness A/B run. Stays inert for the M0 empty turn (0 hours, 0 noise ⇒ no change).

## T16 — Named wounds, treated not regenerated (FR-INJ-01, FR-INJ-04)

**Idea.** Damage is not a shrinking HP number; it is a discrete, *named* wound with a site and a
severity that persists until treated with an item and time. Health never ticks back up on its own
(FR-INJ-04) — the anti-regen invariant.

**Where it lives.** `player.condition.wounds: Wound[]` already exists (`{type, site, severity,
treated, inflictedDay}`). New module `src/sim/wounds.ts`: `inflictWound` (append a named wound),
`treatWound` (advance `treated` toward 100 using an item/time; a wound closes and is removed only at
`treated >= 100`), and a stage-4 `tickWounds` that does **not** heal — it only lets already-treated
wounds finish closing on their timeline and leaves untreated ones exactly where they are. A small
content set of wound types (`content/wounds/`, new `wound.schema.json`) names the vocabulary
(`wound.laceration`, `wound.sprain`, `wound.bite`, …) with per-type severity + treatment cost.

**DoD.** Inflicting a wound adds a named entry that survives turns and save/load; resting/moving
never lowers its severity; only `treat` (with the right item) advances `treated`, and a fully
treated wound is the only way one leaves the list. Property test: over a random no-treatment
playthrough, the multiset of wounds never shrinks and no severity decreases.

## T15 — Avoidable combat + loud firearms + stealth path (FR-CBT-01/02/04/05)

**Idea.** When walkers are present, the player is offered a fight *and* a way out. Combat is
turn-based exchange resolution against systems, not twitch (FR-CBT-02); it always spends scarce
resources (FR-CBT-01); firearms end it fast but are loud, dumping region-scale noise (FR-CBT-04 →
T14); and **every** encounter has a full stealth path — slip away, detection modulated by the
node's current noise and the day phase (FR-CBT-05). The stealth path existing through every
scenario is the task's Definition of Done.

**Where it lives.** Two state additions (⇒ `SAVE_SCHEMA_VERSION` 1→2, one forward-only migration
rung per ADR-0003/T7, and `"combat"` joins `TRACKED_SYSTEMS`):

- `NodeState.walkers: number` — walkers loitering at a node (node memory; persists; seeded from an
  optional node-content `walkers` baseline). Their presence is what opens an encounter.
- `GameState.combat: CombatState | null` — the active exchange: `{ node, enemy, hp, alerted }`.
  `null` outside a fight; migration sets it `null` on old saves.

**Actions.** With `combat === null` and `walkers > 0` at the current node, `availableActions`
surfaces: **Fight** (melee — begins/continues combat, costs stamina + weapon durability, small
noise), **Fire** (firearm — only if a loaded firearm is carried; big damage, region-scale noise,
spends ammo), and **Slip away** (stealth — leave to a discovered neighbor; a detection roll over
`node.noise` + phase decides clean escape vs. an *alerted* fight). While `combat !== null` the
Scene is the fight: Strike / Fire / Retreat. An enemy blow that lands inflicts a named wound (T16).
Winning clears `combat` and decrements `walkers`.

**DoD.** A stealth-only player can traverse the whole region and resolve every walker node without
ever entering combat; combat, when chosen, is turn-based and every option debits a real resource;
firing deposits far more noise than a melee strike (T14 A/B). Determinism: the detection/​damage
rolls come from named RNG streams (`combat`, `stealth`), so a seed reproduces a fight exactly.

## T17 — Finite, contested, depleting loot economy (FR-ECO-01/02/03)

**Idea.** Loot is a stock, not a spawn. It is finite per region/node, it goes *down* as it is
taken, and the world competes for it so scarcity is real (rivals draw the same well down off-screen
— the contest is scripted for M1, director-driven in M2). Search returns partial results and the
search-% persists (FR-ECO-03, already true since T12).

**Where it lives.** `RegionState.loot` already exists (finite richness, 0–100). New module
`src/sim/loot.ts`: a search resolves a *yield* against the node's `searchPct` progress and the
region's remaining `loot`, draws concrete items from a plausibility table by node type
(FR-ECO-02 — `content/loot/` tables keyed to node kinds), appends them to inventory (respecting
T18's weight cap once it lands), and **debits** the region's `loot`. A depleted region yields
nothing but time and noise. A light scripted "contest" tick lowers `loot` a touch each day to model
rivals, so a node left unsearched can be poorer when you return.

**DoD.** Total loot taken over a run never exceeds the region's starting stock; taking reduces what
a re-search finds; two runs on one seed loot identically; searching a picked-clean region yields
nothing. Feeds T18 (weight forces leave-behind) and T19 (the Scene narrates *what* you found).

## Test & CI posture

Per the standing CI gate: every increment keeps **engine + content-loader + harness** green plus
the content schema gate. New content (wound types, loot tables, node `walkers`) ships with schemas
so malformed data fails CI, never a run (FR-CNT-02). Each task adds engine unit + property tests
and at least one harness integration run over the *shipped* Rivermouth content, and the T13
100-turn telemetry audit must stay at zero violations throughout.
