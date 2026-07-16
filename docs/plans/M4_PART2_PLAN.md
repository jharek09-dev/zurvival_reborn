# M4 Part 2 — implementation plan (T45–T46)

Working design note for the second block of **M4 (Content-complete city)**. Part 1 (T43–T44) laid the
foundation: it resolved the three §9 decision gates and poured the city itself — 6 regions, 60 nodes —
but touched **no engine code**. Part 2 is the first M4 block to put **teeth** on that map: it fills the
city with **people** (T45) and **the dead** (T46), and — unlike Part 1 — it changes the engine to make
both play distinctly.

Both tasks were scoped by the owner up front. On each of three forks the owner chose the **fuller**
option, so Part 2 is a substantial content **and** engine block:

1. **T45 survivor pool size** → a **~15-survivor beta subset** (pool 3 → 18), toward the ~60–100 v1
   target, authored incrementally under the review-capacity cap (§7).
2. **T45 companion depth** → the **full FR-NPC-03**: a bounded party, recruit eligibility, **and**
   trust-gated standing orders (hold / follow / scavenge / guard).
3. **T46 roster depth** → the **full combat model**: the new types don't just read differently, they
   **fight** differently (armor, an infectious burst, an ankle-grab, initiative).

**No save-schema rung this whole part.** Every new fact rides a shape that already existed:
type-distinct combat is derived from `CombatState.enemy` (an id we have stored since T15); companion
orders live in the existing `Survivor.flags`; the two new companion fields (`name`, `trust`) are
optional and tolerated-absent. `SAVE_SCHEMA_VERSION` stays **7**, and a default-order party + a
walker fight are **byte-identical** to before this part.

---

## T46 — the full zombie roster with a type-aware combat model (FR-CBT-06/07 · FR-AUD-06)

M2 shipped three types (walker / screamer / stalker) whose distinction lived only in the **state
machine** (a screamer rouses neighbours; a stalker night-hunts). T46 completes the GDD §IX roster with
the four types whose distinction is **how you fight or flee them**, and makes combat read the node to
express it. All undead stay strictly **human-only** (canon, GDD IX — the QA "zombie dog" reframe).

### The four new types

| Type | Reads as | State-machine tell | Combat teeth |
|------|----------|--------------------|--------------|
| **Fresh** | recently turned, fast | `swift` — a presence surge (`SWIFT_BONUS`) drives it to *chasing* where a plain node only *investigates* | `initiative` — answers **every** melee exchange, not the walker coin-flip |
| **Crawler** | legless, low, easy to miss | `lowProfile` — reads calmer than it is while you're only *near* it (`LOWPROFILE_DAMPEN`), full the instant you stand on it | `graspWound` — a higher catch chance on a slip, and an **ankle sprain** rather than a random blow |
| **Bloated** | swollen, slow | none (walker-paced) | `burstInfection` — killing it at your node (melee **or** shot) sprays a bite-severity infectious wound → the T22 infection track; the lesson is to **slip past** |
| **Riot** | died in the gear, armored | none (walker-paced) | `armor` — blunt strikes are blunted to ~0 net; a **firearm pierces**, so the right answer is a bullet or a wide berth |

### What changed

- **Schemas.** `zombie.schema.json` gains `signature` (the FR-AUD-06 non-audio tell), `swift`,
  `lowProfile`. `enemies.schema.json` gains `armor`, `burstInfection`, `graspWound`, `initiative`.
  Both keep `additionalProperties: false`.
- **State machine (`sim/zombies.ts`).** The `ZombieBehaviour` table grows to all 7 types; `stimulusAt`
  applies `swift` (a `SWIFT_BONUS` when the player is near) and `lowProfile` (a `LOWPROFILE_DAMPEN`
  while the player is only adjacent, lifted when they're on the node). Pure, integer-only, no RNG.
- **Type-aware combat (`combat/combat.ts`).** A new authoritative `ENEMIES` dial table (the engine-side
  bridge, mirrored by `content/enemies/*.json` and guarded against drift by a harness test).
  `enemyForNode` picks the **most dangerous combat-distinct type present** — priority `riot > bloated >
  fresh > crawler`, else a walker. **Screamer/stalker have no combat-distinct profile, so they fight as
  walkers** — which is exactly what keeps every pre-T46 encounter byte-identical. `beginCombat` seeds
  from the chosen enemy; `resolveStrike` applies `armor` (floored at 0) and per-enemy retaliation;
  `killEnemy` fires the Bloated burst (a fixed `wound.bite`, **no new RNG draw**, so a seeded walker
  kill is unchanged); `resolveEscape` applies the Crawler grasp; `combatNarration` + the fight label
  name the type and give its signature.
- **City re-seed (26 nodes).** `zombieTypes` were re-passed across the **5 non-Rivermouth districts** so
  each district's menace fits its identity (PL-M4-02): Riot at the fallen civic/police lines (City Hall,
  the evac checkpoint, the fire station, a guarded substation); Bloated through the hospital and the
  waterworks (infection ground); Fresh where crowds turned fast (retail, the ER, the quad); Crawler in
  the homes and machine floors. Every combat-distinct node was given `walkers > 0` so it is a **live
  threat, not an inert tag** (closes PL-M2-02 for the seeded nodes). **Rivermouth is deliberately left
  unchanged** (its clinic screamer + marina stalker), so the slice/Rivermouth tests are undisturbed by
  the combat change.

**No save-schema rung.** `CombatState` already carries `enemy`/`hp`/`maxHp`; armor/burst/grasp/initiative
are all derived from the enemy id at resolution time, so nothing new is stored.

---

## T45 — the survivor pool + companions with trust-gated orders (FR-NPC-01/03/04)

### The pool (content)

**15 new handcrafted survivors** (pool 3 → 18), **3 per non-Rivermouth district**, each with a
`disposition`, a `homeNode`, a one-line `background` / `personality`, and a real withheld `secret` —
authored against `npc.schema.json`, in the Sarah/Marcus/Ruth voice (terse, sensory, melancholic). The
GDD-named **Dana** ("who won't say what she did before") ships. Dispositions spread across all five
temperaments (1 hostile, 5 wary, 4 neutral, 4 friendly, 4 desperate incl. the originals). Homing the new
pool entirely **outside Rivermouth** keeps the fun-gate slice's population stable (only the original 3),
so no golden shifts; and because every survivor is pinned to a `homeNode`, `spawnNpcs` draws **zero**
from the `npc` RNG stream — the sequence is untouched.

The human **casting / voice pass remains the owner's gate** (PRODUCTION §7 — "the characters are the
heart and cannot be auto-approved"). This part drafts and self-reviews them; the final voice pass is
yours.

### Companions (engine — `sim/companions.ts`, the full FR-NPC-03)

- **A bounded, eligible party (closes QA L3).** `PARTY_CAP = 3`; a fourth recruit is refused. A
  **hostile** survivor never joins, however high trust runs (they parley/trade/rob, but don't follow) —
  `canRecruitEligible` gates the offer and `recruit` re-checks defensively.
- **Named companions (closes QA L1).** A recruit carries `name` + `trust` from the `NPCState` onto the
  `Survivor` (both optional → no rung), so party prose names them ("Ana is with you") instead of the
  generic "your companion", and the order gate has a value to read.
- **Trust-gated standing orders.** Free (0-hour) management verbs, like the T18 drop / T39 stash:
  **follow** (default, tracks you), **hold** (waits here), **scavenge** (ranges out — banks a supply
  into the base stash every `SCAVENGE_HOURS_PER_UNIT` hours, drains faster for the exposure), **guard**
  (holds the base and maintains its barricades against the T38 decay). The two that put a companion in
  harm's way for you — scavenge & guard — are gated on **trust ≥ `ORDER_TRUST_MIN` (80)**: a fresh
  recruit (70) will follow and hold, but must be **earned up** (feeding a companion earns
  `COMPANION_SHARE_TRUST`) before they'll range out or hold the line — a felt gate, not a vacuous one.
  Orders live as `order:*` boolean flags on the companion, so they round-trip with **no schema change**.
- **Scavenge closes part of PL-M3-01.** A scavenging companion feeds the shared stash, so keeping people
  becomes a **base loop**, not only a pack drain.

Still deferred (by design): companion **combat participation** and full autonomy (FR-NPC-03 remainder),
the **off-screen people-sim** (PL-M3-02, orders tick only on the player's turns), and
**desertion/betrayal & inter-NPC bonds** (FR-NPC-02/05/07 → T53).

---

## Determinism, save, and the pipeline

- `SAVE_SCHEMA_VERSION` unchanged at **7**; no migration rung.
- **Byte-identity preserved** where it matters: a walker fight, a screamer/stalker node, and a
  default-order (`follow`) party all behave exactly as before this part; the whole 349-test engine
  baseline is untouched.
- The **14-stage pipeline order is unchanged** — stage 5 (`updateCompanions`) grew an order branch;
  stage 3 dispatch gained the `order` action; no stage was added or reordered.
- Pure / integer-only / dependency-free throughout; type-distinct combat draws the **same** RNG streams
  as a walker fight (armor/burst/grasp are arithmetic or fixed wounds, no new draws), so a seed still
  reproduces a fight.

## CI (clean sandbox)

**engine 372 (+23) · content-loader 9 · harness 57 (+9) · typecheck clean ×3 · schema gate 101 entries
/ 7 types · malformed rejected · empty-turn smoke exit 0.** New tests: `engine/test/roster.test.ts`
(type-aware combat + swift/lowProfile), `engine/test/orders.test.ts` (party cap, eligibility, orders,
scavenge/guard, trust gate, feeding, save-lossless), and `harness/test/content.test.ts` grew a roster
drift-guard (content mirrors the engine `ENEMIES`/`ZOMBIE_BEHAVIOUR`, every type has a signature, every
combat-distinct type is seeded live) + a survivor-pool guard (≥15, every region, background/personality/
secret, Dana, disposition variety).

An **adversarial content-quality subagent audit** ran over the new survivors + zombies; **11 fixes**
were applied (5 description rewrites to break a reused template, 4 secret rewrites to differentiate
overlapping "keeper-of-the-dead" beats and lift two below-bar secrets, 2 zombie polish). Canon
(human-only) and accessibility (FR-AUD-06) were clean on first pass. See `docs/qa/QA_REVIEW_M4_PART2.md`.

## What this retires / advances

- **FR-CBT-07** (distinct zombie types) at full-combat depth; **FR-CBT-06** senses extended;
  **FR-AUD-06** non-audio signatures for every type.
- **FR-NPC-01** (pool toward target, beta subset); **FR-NPC-03** (recruitable companions with
  trust-gated orders) at full depth; **FR-NPC-04** (permanent remembered death) intact.
- Closes **PL-M2-02** / **PL-M4-02** (type-only inert nodes → live, seeded to district identity),
  QA **L1** (companion naming) / **L3** (party cap + eligibility), and part of **PL-M3-01** (base loop
  via scavenge).
