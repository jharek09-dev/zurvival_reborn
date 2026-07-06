# M3 Part 1 — implementation plan (T33–T34)

Working design note for the first block of M3 (People, shelter & first story). M2 delivered a world
that **moves on its own** — off-screen drift, a zombie state machine, migrating hordes, weather,
time-of-day danger, a bounded director, a Living History — all deterministic and save-lossless, and it
passed its "the slice feels alive" read. M3's job is the next turn of the screw: **a run becomes a
story.** That needs people. Part 1 lays the *people substrate* the rest of M3 stands on — encounterable
survivors with their own state and needs (T33), and the trust model that will gate every later
interaction (T34). It is deliberately engine-first, exactly like M2 Part 1: no client surfacing ships
here; the survivors are proven at the engine layer and surfaced to the player in a later M3 block
(T35 dialogue, T41 story-in-the-Scene).

Everything obeys the standing engine discipline (ADR-0001): the engine stays pure, deterministic,
dependency-free, integer-only, plain-JSON, and save-round-trippable; all I/O lives in the client. The
one hard constraint this block adds is the FR-NPC line: **spawn and behaviour must be reproducible from
a named RNG stream** — a survivor pool that lands the same way from the same seed. The Musts read in
this block are the Vertical-Slice **subsets** of FR-NPC-01 (a handcrafted, named survivor pool) and
FR-NPC-02 (per-character trust); the full per-relationship trust/respect/fear memory and desertion
(FR-NPC-02 in full, FR-NPC-05) are MVP work and are called out under deferrals.

## Reconciling `npcs` with the existing `actors` placeholder

`GameState` has carried `actors: { [id]: Survivor }` and `groups: { [id]: SurvivorGroup }` since T3 —
rich but always-empty placeholders for the eventual companion/faction layer (GDD XII; pipeline stages
5 *updateCompanions* and 10 *moveGroups*). T33 introduces a **new, purpose-built `npcs` collection**
rather than populating `actors`, for three reasons:

1. **Shape.** The T33 note asks for a lightweight per-run `NPCState` (name, disposition, needs,
   location, alive, and — from T34 — trust). `Survivor` is a heavier record (full `CharacterState`
   with wounds/infection/mind, inventory, per-actor relationships) designed for a *recruited companion*,
   not a survivor you have merely met.
2. **Lifecycle.** An encounterable survivor and a party companion are different life-stages. Keeping
   `npcs` (met) distinct from `actors` (joined) lets T36 model recruitment as a real graduation rather
   than a flag flip on an over-heavy record.
3. **Blast radius.** A new additive slice is a clean, forward-only schema rung; repurposing `Survivor`
   would reshape an existing (if empty) type and muddy the audit.

`actors`/`groups` stay **reserved and untouched**. Reconciling them — a sufficiently-trusted `npcs`
entry graduating into a companion `actors` record — is explicitly T36's concern and is noted there.

## Build order

`T33 → T34` is the only sensible order: T34's trust scalar is a field *on* the T33 `NPCState` and its
starting value is **seeded from the disposition T33 introduces**. Both ship in one block, so the save
schema moves **exactly once** (v4 → v5) with one additive, forward-only rung `migrateV4toV5` (seeds
`npcs: {}`), per the ADR-0003 / T7 ladder — mirroring the single T25 bump in M2 Part 1.

| Task | Deliverable | Seam | New/expanded state | Retires |
|------|-------------|------|--------------------|---------|
| T33 | Survivor NPCs — encounterable people with state & needs | engine `src/sim/npcs.ts` + `content/npcs/` + stage-5 body | `GameState.npcs`, `NPCState` (**schema v5**) | FR-NPC-01 (VS subset) |
| T34 | Trust & disposition model | engine `src/sim/trust.ts` | `NPCState.trust` (same v5 shape) | FR-NPC-02 (VS subset) |

Only T33 breaks the state shape, and T34 rides the same bump, so `SAVE_SCHEMA_VERSION` moves once this
block (4 → 5). No existing RNG stream's sequence shifts: NPC **spawn** draws from a *new* named `npc`
stream, and NPC **needs drift** is a pure function of elapsed hours (no RNG) — so every M2 golden run
stays byte-identical.

## T33 — Survivor NPCs (FR-NPC-01, VS subset)

**Idea.** The reactive world M2 built can threaten only the player. T33 gives the danger *someone else
to fall on*: a curated pool of named survivors, seeded into the run as real per-run state, each with a
temperament, a place in the world, needs that grind on whether or not you visit, and a life that can
end. This is the substrate the whole of M3 leans on — you cannot have dialogue, recruitment, a shelter
worth defending, or an authored arc without people first.

**State.** A new `NPCState` on `GameState.npcs: { [npcId]: NPCState }`:

- `id` — per-run actor id.
- `type` — content id of the handcrafted survivor definition (never a content copy; DESIGN §8).
- `name` — the survivor's name, denormalised from content for a save that reads on its own.
- `disposition` — baseline temperament enum (`hostile · wary · neutral · friendly · desperate`),
  seeded from content; the fixed half of the attitude model (trust is the moving half, T34).
- `needs` — the shared `Needs` shape (hunger/thirst/fatigue, 0–100 ints).
- `location` — current `NodeId` (or `null` off-map).
- `alive` — boolean; the field T35 (threaten) and T36 (companion death) will flip. Stationary and
  always-true in Part 1 (see deferrals) — it exists so those transitions have somewhere to write.
- `trust` — the T34 scalar, shipped in the same v5 shape.

Additive only ⇒ `SAVE_SCHEMA_VERSION` **4 → 5** with one forward-only rung `migrateV4toV5` (every old
save gains `npcs: {}` — a pre-people run simply has no survivors, the safe default), and `npcs` joins
`TRACKED_SYSTEMS` for the FR-CORE-04 audit.

**Content.** New `content/npcs/*.json` plus `content/schemas/npc.schema.json` (schema-first, DESIGN §8).
Each definition carries id, name, description, a `disposition`, an optional `homeNode`, and the
FR-NPC-01 flavour that makes a survivor a *character* rather than a stat block — a one-line background,
a personality note, and a secret. Part 1 ships a small handcrafted Rivermouth set (e.g. Sarah the
paramedic, Marcus the ex-Guard, Ruth the shopkeeper); the schema gate validates them and the existing
malformed-content rejection test still holds.

**Where it lives / spawn.** New `src/sim/npcs.ts` owns `spawnNpcs`, called from `startRun` after the
nodes/routes seed. Placement is **deterministic from the new named `npc` RNG stream**: a survivor with a
`homeNode` is placed there; the rest are distributed across eligible nodes by draws from the `npc`
stream, threading `GameState.rng` through and back. Starting needs are modest, biased by disposition (a
`desperate` survivor starts hungrier). Same seed ⇒ identical pool, identical places.

**Behaviour (per-turn).** NPC needs drift with the hours an action spends — the same economy that
grinds the player down (T22) — wired into the **pipeline stage-5 body (`updateCompanions`)**, which was
an `identity` no-op. The stage *name* and the 14-stage order never change (the `pipeline.test` order
assertion stays green); only the body graduates from no-op to a real NPC tick, exactly as M2 graduated
its world stages. Drift is a pure function of the hours (no RNG), so a zero-hour `wait` leaves every
survivor untouched — the M0 empty-turn contract holds. Companions (T36) will later ride this same stage.

**DoD.** Survivors spawn deterministically into `npcs` from content (same seed ⇒ byte-identical pool and
placement); each has needs that measurably drift across in-game hours and are inert on a zero-hour tick;
a run carrying NPCs round-trips losslessly (T7); an old v4 save loads forward to v5 with `npcs: {}`; the
14-stage pipeline order is unchanged; `npcs` is audited by FR-CORE-04; the new content passes the schema
gate. Integer-only and plain-JSON throughout.

## T34 — Trust & disposition model (FR-NPC-02, VS subset)

**Idea.** A per-NPC **trust** scalar (0–100) that moves *only* from the player's actions — help, share,
and fair trade raise it; threaten, rob, and abandon lower it — and **never regenerates on its own**, so
a betrayal sticks. It is the gate every later people-system reads: whether a survivor will talk (T35)
and whether they will join (T36).

**State.** `trust: number` (0–100 int) on `NPCState`, shipped in the same v5 shape (no separate bump).
Its **starting value is seeded from disposition** — a `friendly` survivor opens more trusting than a
`hostile` one — which is what ties T33's fixed temperament to T34's moving scalar.

**Model.** `src/sim/trust.ts`, pure and integer:

- `TRUST_DELTAS` — an action-kind → signed step map, deliberately **asymmetric** so harm outweighs
  help (a betrayal costs more than a good turn earns): `help +15 · share +10 · trade +5 · threaten −20
  · rob −30 · abandon −25`.
- `adjustTrust(npc, delta)` — clamp to 0–100, return a new `NPCState`. There is **no free regen**:
  nothing ticks trust back toward a baseline (contrast needs, which drift every hour). The only mover is
  an explicit interaction — the mechanical meaning of "a betrayal sticks".
- `applyTrustEvent(npc, kind)` — `adjustTrust` by the mapped delta; the seam T35's dialogue choices call.
- `trustTier(trust)` — a legible band for prose/gating: `hostile <20 · wary <40 · neutral <60 · warm
  <80 · trusted ≥80`.
- `canRecruit(npc)` — `alive && trust ≥ RECRUIT_MIN` (70); the T36 recruitment gate. A lighter
  `canParley`/talk gate serves T35.

**Where it bites (later).** T34 ships the model, the numbers, and the gates only; the *choices* that
call them are T35, and the recruit that reads `canRecruit` is T36 — proven now by unit tests, exactly as
M2 proved each system at the engine layer before surfacing it.

**DoD.** help/share/trade raise trust and clamp at 100; threaten/rob/abandon lower it and clamp at 0; a
lowered value **stays lowered** across subsequent ticks (no regen — the betrayal-sticks property);
`trustTier` and `canRecruit` flip at their thresholds; starting trust tracks disposition; deterministic,
integer-only, save-lossless.

## Test & CI posture

Standing gate unchanged: every increment keeps **engine + content-loader + harness** green plus the
content schema gate, run in full in a clean environment (the sandbox mount carries only partial deps, so
packages are installed and tested in a clean copy). New engine unit + property tests cover NPC spawn
determinism and placement, needs drift over hours (and zero-hour inertia), the save round-trip with a
populated `npcs`, the v4→v5 migration rung (an old save loads with `npcs: {}` at version 5), and the
trust model (raise/lower, both clamps, the no-regen property, the tier and recruit gates, and
disposition→starting-trust). The schema gate is extended over `content/npcs/`. The `pipeline.test`
14-stage order assertion and the T13 100-turn FR-CORE-04 audit stay green — `npcs` is a tracked system
now, and NPC drift keeps resolved turns honest without making the audit vacuous (the player's needs
already guarantee that). No client changes ship in Part 1.

## What this block deliberately defers

- **Surfacing survivors in the Scene** — meeting a survivor as a Four-Questions lead, with talk/trade/
  help/threaten choices, is T35 (dialogue) and T41 (story-in-the-Scene); Part 1 is engine-only, mirroring
  M2 Part 1's silent substrate.
- **Off-screen NPC simulation** — survivors' needs drift only on the player's turns (stage 5); ticking
  them inside `advanceWorld` (they are *people*, not the world half that driver moves) waits on a later
  M3 block.
- **NPC movement & death** — Part-1 survivors are stationary and `alive` stays true. Movement (the
  people side of stage 10) and death (starvation, a threaten that turns lethal, companion loss) land with
  the interaction tasks (T35/T36) that actually write those transitions.
- **The full trust/respect/fear triad and desertion** — Part 1 ships the single trust scalar (the VS
  slice of FR-NPC-02); per-relationship respect/fear and low-trust desertion (FR-NPC-02 in full,
  FR-NPC-05) are MVP.
- **Reconciling `actors`/`groups`** — the reserved companion/faction placeholders stay untouched until
  T36 recruitment gives a survivor a reason to graduate.
