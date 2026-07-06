# M3 Part 2 — implementation plan (T35–T36)

Working design note for the second block of M3 (People, shelter & first story). Part 1 laid the
*people substrate* — encounterable survivors with their own state, needs, disposition, and a trust
scalar — but shipped it **silent**, exactly as M2 Part 1 shipped a silent reactive world. A player
could not yet meet Sarah, spend trust, feed a starving survivor, or lose one; `alive` was a field
nothing flipped and `canParley`/`canRecruit` were tested but had no caller. Part 2 is where the people
layer becomes **perceivable and consequential**: survivors reach the Scene as things you can talk to,
help, threaten, and recruit — and the needs and trust models T33/T34 proved finally bite.

This is the turn of the screw the M3 thesis rests on: *a run becomes a story.* A story needs someone
in it who can be helped or wronged, who can join you, and who can be lost. Part 2 delivers the first
recruitable companion and the first permanent, remembered death — the FR-NPC Musts the Vertical Slice
is scoped around (FR-NPC-03, FR-NPC-04) — on top of the T34 trust gates that decide whether any of it
is offered at all.

Everything obeys the standing engine discipline (ADR-0001): the engine stays pure, deterministic,
dependency-free, integer-only, plain-JSON, and save-round-trippable; all I/O lives in the client. No
new RNG stream is opened — every interaction is a deterministic function of the choice taken and the
state it acts on, so all M2/M3P1 golden runs stay byte-identical.

## The surfacing seam — how a person reaches the Scene

M2 Part 2 surfaced the *world* by teaching `sceneOf` to read reactive state into a lead line, and by
letting `availableActions` offer context-sensitive choices (a fight, a stealth slip). Part 2 reuses
exactly that seam for *people*, so the single-decision UI contract (FR-UI-01/03) is untouched:

- **`availableActions` gains a people branch.** In the explore branch (no active fight, no walkers —
  those still take priority; you cannot chat mid-encounter), the choices for every living person at the
  player's node are appended: talk, share food/water, threaten, and — when the T34 gate opens —
  recruit. Each advertises its known time cost and never its outcome, like every other choice.
- **`sceneOf` gains a people lead.** A survivor present is surfaced in narration — a first meeting reads
  from their content description, a known survivor from a shorter line, a dead one as the body they left.
  Screen-reader-safe: everything is words (NFR-ACC-01), and the harness renders it through the existing
  `describe*`/choice seam with **no client rewrite** — the people choices flow through automatically.

Because the offered set is still just `SceneChoice[]` and the render path is unchanged, the accessibility
transcript (T20) carries the whole new layer for free; Part 2 only adds *what* is offered, never *how*
it is shown.

## Build order

`T35 → T36` is the only sensible order: recruitment (T36) reads the trust a survivor accrues through
T35's help choices and is offered from the same node-encounter surface T35 builds. Both ship in one
block. Exactly one additive, forward-only schema rung lands (v5 → v6), for the single new fact Part 2
introduces about a survivor — whether the player has *spoken* with them.

| Task | Deliverable | Seam | New/expanded state | Retires |
|------|-------------|------|--------------------|---------|
| T35 | Survivor encounters — talk/share/threaten, and teeth for needs & trust | engine `src/sim/encounters.ts` + `availableActions`/`sceneOf` + stage-5 death | `NPCState.met` (**schema v6**); `alive` now flips | FR-NPC-01 surfacing, FR-NPC-06 (VS subset) |
| T36 | Recruitable companion + permanent, remembered death | engine `src/sim/companions.ts` + stage-5 companion tick + `actors` graduation | `GameState.actors` now populated (existing shape) | FR-NPC-03, FR-NPC-04 (VS subset) |

## The single schema bump (v5 → v6)

Only T35 changes the state *shape*, and by one field: **`NPCState.met: boolean`** — has the player
spoken with this survivor. It is the fact a `talk` writes, the reason a first meeting reads differently
from a later one, and a precondition on recruitment (you cannot ask a stranger to follow you into the
dark). Modelling it as real state rather than a string-keyed `player.flags` entry follows DESIGN §7
("prefer meaningful world state over flag sprawl").

Additive only ⇒ `SAVE_SCHEMA_VERSION` **5 → 6** with one forward-only rung `migrateV5toV6` (every
existing survivor in a v5 save gains `met: false` — a pre-Part-2 run has met no one, the safe default),
chaining cleanly behind the v1→…→v5 rungs per the ADR-0003 / T7 ladder. **T36 needs no shape change**:
a companion is a `Survivor` record (the shape reserved since T3) marked with a `flags.companion` entry,
recruitment *populates* the always-present `actors` collection, death *removes* from it, and both are
remembered in the append-only `history`. Populating an existing, always-`{}` collection is not a shape
change, so it rides no rung — an old v6 save with `actors: {}` is simply a run that has recruited no one.
No existing RNG stream shifts (interactions draw no randomness), so every prior golden run is unchanged.

## T35 — Survivor encounters (FR-NPC-01 surfacing, FR-NPC-06 VS subset)

**Idea.** Give the player the verbs that make a survivor a *character you have a relationship with*
rather than a stat block ticking in the dark. Standing at a survivor's node, you may:

- **Talk** (`talk:<id>`, gated by `canParley`, once) — hear who they were: the FR-NPC-01
  background/personality/**secret** the content has carried since T33 (the npc schema notes the secret is
  "surfaced via T35+" — this is where). Sets `met: true`. A one-shot per survivor (offered only while
  `!met`), so it is a real, non-farmable state change, never a no-consequence turn (FR-CORE-04).
- **Share food / water** (`give-food:<id>` / `give-water:<id>`) — the help verb, offered only when you
  carry the item and their need is actually pressing (`>= RELIEF_OFFER_AT`, mirroring the player's own
  eat/drink offer). Spends one of your items, buys their need down by the same `EAT_RELIEF`/`DRINK_RELIEF`
  the player gets, and raises trust (`applyTrustEvent "share"`). This is the **needs teeth** made
  positive: feeding a survivor is a genuine resource trade against your own scarce pack.
- **Threaten** (`threaten:<id>`) — the harm verb: `applyTrustEvent "threaten"` (−20). Push a survivor's
  trust below `PARLEY_MIN` and they have **turned** — `canParley` is now false, so talk/help/recruit stop
  being offered and the narration reads them as closed to you. The betrayal-sticks property (no regen,
  T34) means that door does not quietly reopen; you spent the relationship.

**Teeth on `alive` (needs become lethal).** `driftNpc` gains the consequence M3P1 deliberately withheld:
a living survivor whose hunger or thirst reaches `NEED_FATAL` (100) **dies** — `alive` flips to false,
their needs freeze, and they persist in `npcs` as a remembered body (dead survivors are skipped by the
tick, so this is stable and idempotent). This mirrors the player's own `runEndReason`, reusing the same
constant. It makes the T33 promise real — the reactive world now has *someone besides the player to fall
on* — and gives the help verb its stakes: a starving survivor you walk past can be gone when you return.

**Living History.** `recordHistory` (the pure stage-13 diff observer) learns three people events, in a
stable order after the existing world events: a survivor met (`npc.met`), a survivor died (`npc.died` —
detected as an `alive` true→false within `npcs`, so a *recruited* survivor leaving the pool is never
mistaken for a death), and the T36 companion events below. Selective as ever — a quiet turn writes
nothing and the FR-CORE-04 audit stays honest.

**DoD.** A survivor at the player's node is surfaced in the Scene and offers talk/share/threaten as its
gates allow; talking reveals their flavour and flips `met`; sharing spends a player item, relieves their
need, and raises trust; threatening lowers it and can turn them; a neglected survivor's needs climb to
lethal and they die, remembered in history; every interaction is a resolved turn that moves a tracked
system (no no-op); deterministic, integer-only, save-lossless across the v6 bump.

## T36 — Recruitable companion & remembered death (FR-NPC-03/04, VS subset)

**Idea.** A survivor you have earned the trust of (and spoken with) can be asked to **join you**, and a
companion who is lost stays lost. This is the emotional core the whole slice is a delivery mechanism for.

- **Recruit** (`recruit:<id>`, gated by `canRecruit` — `alive && trust >= RECRUIT_MIN` (70) — *and*
  `met`) — graduates the survivor from *met* to *joined*. The lightweight `NPCState` is promoted into the
  heavier `Survivor` record reserved since T3: its needs carry over, it takes a fresh `CharacterState`
  (no wounds/infection, a starting mind), it is placed at the player's node, and it is marked
  `flags.companion`. The `npcs` entry is removed — the graduation the M3P1 plan named as T36's concern,
  reconciling `npcs` (met) with `actors` (joined) as two real life-stages rather than a flag flip.
- **Autonomous behaviour (VS subset).** Pipeline **stage 5** (`updateCompanions`) already ticks NPC needs;
  it now also ticks companions — their needs drift on the same economy, and they **follow the player**
  (a companion's location tracks `player.location` after the turn's move resolves in stage 3). This is the
  VS reading of "autonomous AI": the companion lives in the sim, is fed from your pack via the same share
  verbs, and stays with you. *Followable orders* (FR-NPC-03's second half) are deliberately deferred (see
  below) — the slice proves recruitment, presence, upkeep, and loss.
- **Permanent, remembered death (FR-NPC-04).** A companion whose needs reach `NEED_FATAL` dies: removed
  from `actors` (permanent — no revival path exists), a `fallen.<id>` memory recorded on the player, and a
  `companion.died` event appended to the Living History. "Remembered by the community" is, for the VS, that
  the death is in the permanent log and the memory flag persists — the hook M4's memorial/relationship
  systems read. A `killCompanion` helper exposes the same transition for a future combat death.

**Where it bites.** Recruitment reads the exact `canRecruit` gate T34 shipped and unit-tested with no
caller; this is that caller. The companion's needs are relieved by the exact share verbs T35 builds. The
death reuses the exact `NEED_FATAL` lethality T35 gives survivors. Part 2 wires the pieces the prior two
blocks proved in isolation into one loop: **meet → earn trust → recruit → keep alive → grieve.**

**DoD.** A survivor at `trust >= 70` you have met can be recruited; recruiting removes them from `npcs`,
creates a `flags.companion` `Survivor` in `actors` at your node, and logs it; the companion's needs drift
and it follows you across moves; feeding it works through the T35 share verbs; a neglected companion dies,
is removed permanently, is remembered on the player and in history, and does not reappear; the reserved
`groups` placeholder stays untouched; deterministic, integer-only, save-lossless.

## Test & CI posture

Standing gate unchanged: every increment keeps **engine + content-loader + harness** green plus the
content schema gate, run in full in a clean environment (the sandbox mount carries only partial deps, so
packages are installed and tested in a clean copy). New engine unit + property tests cover: the four
interaction verbs and their trust/needs/inventory effects; the parley/recruit gates flipping talk/recruit
on and off; a threatened survivor turning (parley closes and stays closed — the no-regen property end to
end); NPC death at saturated needs and its history event; recruitment graduating `npcs → actors` with the
companion flag; companion needs drift, follow-the-player, and death (removed, remembered, non-returning);
the v5→v6 migration rung (an old save's survivors gain `met: false`); and a full-slice integration run
(meet → share → recruit → companion death) that stays byte-identical from its seed, round-trips losslessly
across the v6 bump, and keeps the FR-CORE-04 audit clean. The `pipeline.test` 14-stage order assertion and
the T13 100-turn audit stay green — stage 5's body grows but its name and the order do not. The harness
smoke (empty-turn end-to-end) and the malformed-content rejection both still hold.

## What this block deliberately defers

- **Followable companion orders & richer companion AI** — the VS ships a companion that follows, upkeeps,
  and can die; issuing orders (guard, scavenge, wait) and combat participation are MVP (FR-NPC-03 full).
- **The full trust/respect/fear triad, desertion, and inter-NPC relationships** — Part 2 stays on the
  single trust scalar; per-relationship memory (FR-NPC-02 full), low-trust desertion (FR-NPC-05), and NPC↔NPC
  bonds (FR-NPC-07) are MVP.
- **Trade of goods** — the "share" (give) verb ships as the help/trust lever; a two-sided goods exchange
  (FR-NPC-06's barter, FR-ECO trade) is later. `TRUST_DELTAS.trade` stays staged for it.
- **Off-screen people-sim & NPC movement** — survivors still drift only on the player's turns (stage 5),
  not inside `advanceWorld`, and non-companions stay put; the people side of stage 10 (`moveGroups`) and
  off-screen upkeep remain a later M3 block, as noted in M3 Part 1's deferrals.
- **Shelter, the night-attack defence, the mind model surfaced, and the first authored failure ending** —
  the remainder of the M3 scope (FR-SHL, FR-INJ-09, FR-STY-07) lands in later M3 blocks (T37–T42).
