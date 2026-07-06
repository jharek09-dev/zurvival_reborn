# M3 Part 4 — implementation plan (T39–T42)

Working design note for the fourth and final block of M3 (People, shelter & first story). Parts 1–2
built the *people* layer (survivors you can meet, help, wrong, recruit, lose); Part 3 built the
*shelter* — the first place that is yours, claimed and fortified against the reactive world. Part 4
closes the milestone. It gives the base a **warehouse** (T39, the shared stash — bank surplus at home,
and expose it to being raided), it tells the run's **first authored story** (T40, a survivor in trouble
→ a costed choice → a consequence that ripples back through the systems), it makes that story **legible
in the Scene** (T41 — a run should *read* as a story, not a stat sheet), and it walks the whole slice up
to the **Slice Fun Gate** (T42), the owner's human go/no-go that is the exit of M3 and the gate on all
content pours to come.

This is the block where the four M3 promises — people, shelter, a shared stash, a story — finally stand
in one frame: a survivor you met on the road turns up at the base you claimed and fortified, hungry, and
what you do about it (out of the stash you banked) changes how the run goes. That is the thing the Fun
Gate is asked to feel.

Everything obeys the standing engine discipline (ADR-0001): the engine stays pure, deterministic,
dependency-free, integer-only, plain-JSON, save-round-trippable; all I/O lives in the client. **No new
RNG stream is opened** — the stash verbs and the arc are deterministic functions of the choice taken and
the state it acts on — so every M0/M1/M2/M3P1–P3 golden run stays byte-identical.

## One schema rung this block — the stash — and two reserved shapes populated for free

Part 3 needed no rung; Parts 2 and this block need exactly one each. **Part 4's single additive rung is
T39's stash** (v6 → **v7**). T40 and T41 need none.

- **T39 · `Player.stash: readonly InventoryEntry[]` — the block's one rung (v6→v7).** A store *separate
  from the carry budget* has no reserved home in the T3 shape: `player.inventory` is the pack, and there
  is no second array. So T39 adds one field, forward-only. `migrateV6toV7` appends `stash: []` to every
  loaded save's `player`; `createInitialState` seeds it empty; `SAVE_SCHEMA_VERSION` becomes **7**. Empty
  is the safe default — a pre-Part-4 run simply has no cache — so **every prior run is inert** (an empty
  stash weighs nothing, is offered nothing, and round-trips as `[]`).
- **T40 · `Story.progress` + `queue` — reserved and inert since T3, so NO rung.** The two facts the arc
  needs already exist, untouched by any system: `story.progress: { [arcId]: number }` (the beat counter)
  and `queue: readonly ScheduledEvent[]` (the delayed consequence). This is the exact move T37/T38 made
  with `shelterId`/`barricades` and T36 made with `actors`: populating a reserved shape is not a shape
  change. Because both are empty in every prior run (`progress {}`, `queue []`), the new pipeline bodies
  are **inert on old state** and all prior goldens stay byte-identical.
- **T41 · no state at all.** Pure surfacing — one more narration lead and the arc's choices flow through
  the seam T35/T37 already built.

`SAVE_SCHEMA_VERSION` therefore ends the block at **7**, with one clean rung. A claimed, fortified,
stashed run mid-story round-trips losslessly (the round-trip test deep-equals the whole state, `stash`,
`progress`, and `queue` included).

## The surfacing seam — reused, not rebuilt (T41)

Part 4 adds nothing to the single-decision UI contract (FR-UI-01/03). `sceneOf` already composes its
narration from `[lead, people, shelter, atmosphere, setting]`; T41 inserts a **story lead** in that list
(the active arc's current beat, in words) and `availableActions` appends the arc's **costed choices** in
the same block the shelter/people verbs use. The T19 play client renders both for free — the `story`
region already prints `scene.narration`, and choices already list with their known cost — so there is
**no client rewrite**, and the T20 transcript carries the story plainly, keyboard-only (NFR-ACC).

## Build order

`T39 → T40 → T41 → T42` is the only sensible order. The arc's consequences *spend and raid the stash*,
so the warehouse must exist first; the story must resolve over the systems before it can be surfaced;
and the Fun Gate can only judge the finished, playable, legible slice.

| Task | Deliverable | Seam | State touched | Retires |
|------|-------------|------|---------------|---------|
| T39 | Shared stash: deposit/withdraw at the base + a raid/deplete hook | `src/sim/stash.ts` + `availableActions`/`applyPlayerAction` + `shelterLine` | **`Player.stash` (new field — v6→v7 rung)** | FR-SHL-03 / FR-PLR-04 |
| T40 | First authored arc: survivor-in-trouble → costed choice → rippling consequence | `src/sim/story.ts` + pipeline **stage 12 `resolveQueue`** (real) + **stage 13 `evaluateStory`** (arc trigger) + `applyPlayerAction` + `content/arcs` + schema | `Story.progress`, `queue` (**reserved, no rung**) | FR-STORY-01 |
| T41 | The arc read in the Scene: a story lead + its choices, plain-text | `sceneOf` (`storyLine`) + `availableActions` | none | FR-UI-STORY |
| T42 | Slice Fun Gate — the owner's human verdict; M3 exit | `docs/qa/FUN_GATE_LOG.md` + a playable end-to-end slice | none | PRODUCTION §4 Stage-2 |

## T39 — Shared stash (FR-SHL-03 / FR-PLR-04)

**Idea.** Give the base a warehouse. Until now a run's only store was the pack, and the T18 weight budget
means every surplus can becomes a thing left in the world. The stash is a second store **at your shelter**
that the weight budget does not see — so a run can *bank surplus* against a lean day — and, crucially, a
store the contested world can *reach*: a stash is a thing that can be raided, which is where the story's
teeth (T40) bite.

- **Deposit / withdraw** (`src/sim/stash.ts`) — offered only while **standing in your own shelter**
  (`shelterId === here`). Deposit moves one unit of a carried non-unique stack into `player.stash`;
  withdraw moves one unit back into the pack **only if it fits** the carry budget (reuses `fits`). Both
  cost **0 hours** — base/pack management, exactly like the T18 drop verb — so they are convenience
  moves, not resolved turns (they change `player` but do not advance the clock or demand an FR-CORE-04
  system beyond the one they move). One choice per relevant stack, stable-ordered, surfaced only when it
  can act (carrying something to bank / holding something that fits to pull) so the single-decision
  screen stays clean.
- **The stash is weightless while stored.** `inventoryWeight` reads `player.inventory` only, so banking
  a load frees the pack and **weight still bites on the road** — the stash is a home store, not a bag of
  holding you carry.
- **The depletion / raid hook** (`depleteStash`) — a pure function that removes a deterministic number
  of item-units from the stash in stable order and logs a `stash.raided` beat. It is the **contested-
  world hook** the FR names: T40's arc calls it as the cold-branch consequence (the survivor you turned
  away comes back for what you would not share), and a future off-screen raid rides the same function.
- **Surfacing** — `shelterLine` gains a read of the cache when you stand in the base (*"Your cache holds
  a few supplies"* … *"the cache is bare"*), so the warehouse is legible without a number.

**DoD.** Standing in your shelter carrying loot, "stash …" is offered and moves the item into a store the
pack-weight no longer counts; withdraw returns it only when it fits; neither is offered away from your
base; `depleteStash` removes units and logs a raid; a deposited run round-trips losslessly through the
new v7 rung; every prior run byte-identical (empty stash, offered nothing).

## T40 — First authored story arc (FR-STORY-01)

**Idea.** Prove the systems can carry a *story* — one scripted, multi-beat arc that is not a cutscene but
a **deterministic trigger chain over the sim**: it watches the state the other systems produce, fires a
beat when the world has set the stage, hands the player a **costed choice**, and pays out a **consequence
that ripples back** into trust, the shelter, the stash, and the world. Append-only into the Living
History (T31); reproducible byte-for-byte from a seed; save-lossless.

**The arc — "The Hollow Man" (`arc.rivermouth.the-hollow-man`).** A survivor you have met is driven to
your door. The beats, tracked in `story.progress[arcId]` (an int; the arc is *opt-in registered* into a
run by seeding `progress[arcId] = 0`, so a run that does not enable it — every prior golden — has no
active arc and is untouched):

- **0 — dormant** (registered, waiting).
- **1 — the plea** (auto-trigger, pipeline stage 13): when the systems have produced *a survivor in
  trouble at your base* — you hold a shelter, you have met the subject survivor, they are alive, and
  their need has ground past a threshold (the T33 needs the world already drives) — the arc fires: sets
  `progress = 1`, appends a `story.beat`. The Scene now surfaces the plea and **two costed choices**.
- **1 → 2 — take them in** (player choice, costed): spend hours **and draw from the stash** to feed and
  shelter them; their trust climbs (T34), their need eases, `progress = 2`, and a **good** consequence is
  enqueued (`queue`).
- **1 → 3 — turn them away** (player choice, costed): spend hours, keep your supplies; their trust falls
  hard — below parley they *turn* (T34 betrayal-sticks) — `progress = 3`, and a **cold** consequence is
  enqueued.
- **2/3 → 4/5 — the consequence** (delayed, pipeline stage 12 `resolveQueue`): when the enqueued event
  comes due, it resolves. **Good:** the survivor repays — a supply cached back into your stash and a small
  easing of the run (a beat of relief). **Cold:** the one you turned away comes back for it — `depleteStash`
  raids your cache and knocks the barricades — the *raided-stash story beat* the FR-SHL-03 hook was built
  for. Either way a closing `story.beat` lands and `progress` reaches its terminal value.

**Why this shape.** It reuses the reserved `queue` for the delay (the designed home for timed events) and
turns **two identity stages real** the way M2 turned its world stages real — the stage names and the
14-stage order never move, only the bodies graduate:

- **Stage 12 `resolveQueue`** (was `identity`): resolve any due story events. Inert when `queue` is empty
  — every prior run untouched.
- **Stage 13 `evaluateStory`** (was history-only): first evaluate the arc's auto-triggers (the plea),
  then record the Living History as before. Inert when no arc is active.

The costed choices dispatch through `applyPlayerAction` (stage 3) exactly as the shelter/encounter verbs
do. No RNG: every trigger is a pure predicate, every consequence a fixed transform, so the whole arc
replays byte-identically from its seed.

**Content.** `content/arcs/arc.rivermouth.the-hollow-man.json` + `content/schemas/arc.schema.json` make
the arc *authored, validated content* (the schema gate grows 18→19 entries, 6→7 types). The engine reads
the arc's identity and dials; the beat **prose** is authored there for the client to localize (surfaced
client-side, exactly as `NPCDef.background`/`personality`/`secret` are deferred), while the VS engine
carries a plain-text beat line so the harness transcript reads without the client (mirrors `shelterLine`).

**DoD.** With the arc registered, a met survivor grinding hungry at your claimed base triggers the plea in
the Scene; take-them-in spends stash + time and lifts trust; turn-them-away costs trust and later raids
the stash; each beat lands once in the Living History; the arc is save-lossless (progress + queue
round-trip) and byte-identical from its seed; a run that does not register the arc — and every prior
golden — is untouched.

## T41 — Story surfaced in the Scene (FR-UI-STORY)

**Idea.** Make the run *read* as a story. The arc's current beat must appear where the player already
looks — in the Scene's narration, alongside the weather/threat/horde world-lead (T31 made perceivable),
the people line, and the shelter line — and its choices must sit in the same single-decision list, in
words, reachable by number key alone.

- **`storyLine(state)`** — a one-line read of the active arc's live beat (*"A figure sways at your
  barricade — it's Ruth, and she's in a bad way."* … *"The cache is lighter than you left it; someone
  has been here."*). Null when no arc beat is live. Composed into `sceneOf`'s narration list, placed after
  the world/people/shelter leads and before the atmosphere, so danger still leads but the story is
  impossible to miss.
- **The arc's choices** already arrive through `availableActions` (T40). T41 only assures they render with
  their cost and read as a story moment, not a menu item.
- **Screen-reader-safe** — everything is words in the fixed `header → status → story → choices → footer`
  region order the T20 client already traverses; the `story` region now genuinely carries a story. No new
  client code.

**DoD.** A live arc beat shows in the Scene narration and in the plain-text transcript; its choices are
selectable by number with visible costs; with no active arc the narration is exactly as before (prior
scenes unchanged); nothing critical is color- or glyph-only (NFR-ACC-01/02).

## T42 — Slice Fun Gate (PRODUCTION §4, Stage-2)

**Idea.** The decisive, un-automatable checkpoint: the owner plays the finished slice and judges whether
*a run becomes a story*. It is the exit of M3 and the authority over all future scope — a pass opens M4
(content-complete city); a fail **freezes content** and re-invests in loop/director/people/story
(PRODUCTION §4). It cannot be auto-passed, and this plan does not pass it.

What this block ships *for* the gate (the verdict stays the owner's):

- A **playable end-to-end slice** — search → claim → fortify → stash → meet a survivor → the arc's plea →
  a costed choice → its rippling consequence — captured as a readable, keyboard-only transcript, so the
  gate is judged against the real thing.
- A **Fun-Gate log** (`docs/qa/FUN_GATE_LOG.md`) with the gate's criteria and a place to record the
  verdict, per PRODUCTION §4.
- A candid **provisional read** (a self-assessment: where the slice earns "a run becomes a story", where
  it is thin, which first-pass dials the gate should move) — *input* to the owner's call, not the call.

**DoD.** The slice is playable and legible start to finish; the log and the provisional read are in
`docs/qa/`; the pass/fail line is left for the owner. M3 stays *active* until it is signed.

## Test & CI posture

The standing gate is unchanged: every increment keeps **engine + content-loader + harness** green plus
the content schema gate, run in full in a clean sandbox copy (the mount carries only partial/host-OS
deps). New coverage:

- **`test/stash.test.ts`** — deposit moves a stack pack→stash and frees carry weight; withdraw returns it
  only when it fits; both offered only at your own base; the stash is weightless (`inventoryWeight`
  unchanged by a deposit); `depleteStash` removes units in stable order and logs `stash.raided`; a
  deposited run is save-lossless through **v7**; the **v6→v7 migration** adds `stash: []` and an old save
  loads forward; every prior run inert (empty stash offered nothing).
- **`test/story.test.ts`** — an unregistered arc never fires (prior goldens); a registered arc fires the
  plea only when the full predicate holds; take-them-in spends stash + lifts trust and enqueues the good
  consequence; turn-them-away drops trust below parley and enqueues the cold one; **stage 12** resolves
  the due event (good caches a supply / cold raids the stash + dents barricades); each beat logs once;
  the whole arc is **byte-identical from its seed** and save-lossless (progress + queue); `story` and
  `queue` register in the FR-CORE-04 audit on the turns they move; the arc is inert on a zero-hour `wait`
  and on the M0 empty turn.
- **`pipeline.test`** — the **14-stage order and names are unchanged** (only stage 12/13 bodies graduate);
  the T13 100-turn FR-CORE-04 audit stays clean; the M0 empty-turn / no-graph turn stays a strict no-op.
- **Harness** — a scripted slice plays the full chain and asserts the **transcript surfaces the story**
  (the plea line and the arc choices appear, keyboard-only); the T20 accessibility and T21 resume suites
  stay green; the schema gate accepts the new arc (19 entries / 7 types) and still rejects malformed
  content.

The save round-trip, malformed-content rejection, and empty-turn smoke all stay green; the only schema
change is the additive v6→v7 stash rung and the new arc content type.

## What this block deliberately defers

- **Off-screen stash upkeep / off-screen raids** — the stash is depleted by the arc's on-turn consequence
  (stage 12), not yet inside `advanceWorld`; a rival group raiding a base you have abandoned rides with
  the deferred off-screen people-sim (M3 Part 1/2 deferral), keeping `advanceWorld` byte-identical.
- **A second arc / arc content breadth** — one authored arc proves the substrate; the arc *library* and
  the radio-network / faction arcs are M4 content, gated behind the Fun Gate by design.
- **NPC movement into the base** — the plea reads the survivor "at your door" from state; survivors are
  still stationary (the people side of stage 10 is the standing M3 deferral), so the arc anchors to a
  survivor already reachable, not one that walks in.
- **Localized beat prose / the Storyteller companion (FR-NPC-09)** — the engine carries a plain VS beat
  line; the authored content prose and the companion who *tells* the story are client/M4 surface, as the
  Part-2 QA noted.
- **Stash capacity limits, per-node stashes, multiple bases** — the VS stash is a single uncapped home
  store (the safe-base fantasy); a capacity dial, node-local caches, and relocation are post-VS levers.
- **The Fun-Gate verdict itself (T42)** — prepared, not passed; the owner's to sign.
