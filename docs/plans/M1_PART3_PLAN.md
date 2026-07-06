# M1 Part 3 — implementation plan (T18–T21)

Working design note for the final third of M1 (Core loop playable). Part 1 (T10–T13) made the loop
*move* — a fog-of-war region graph, a real move/search/rest loop over Rivermouth, and a telemetry
audit proving every resolved turn changes a system. Part 2 (T14–T17) made the loop *bite* — noise,
avoidable combat, persistent named wounds, and a finite loot economy. Part 3 makes the loop
**playable and felt**: the pack that forces a leave-behind (T18), the story-first single-decision
client that presents the whole loop as narrative rather than a stat grid (T19), the accessibility
baseline built in from that first client rather than bolted on later (T20), and lossless quit/resume
at any turn boundary — the last M1 Definition-of-Done proof — feeding straight into the **Loop-Feel
Check** that closes the milestone (T21).

The split from Parts 1–2 is deliberate: T18 is the last engine system of M1, and T19–T21 are the
first *real client* plus the milestone gate. Everything here obeys the standing engine discipline
(ADR-0001): the engine stays pure, deterministic, dependency-free, integer-only, plain-JSON, and
save-round-trippable; all I/O, rendering, and input live in the client (DESIGN §3, ADR-0003). The
four Musts read here are FR-PLR-03, FR-UI-01/02/03/05, and NFR-ACC-01/02, and all four are read at
the M1 Loop-Feel Check (T21).

## Build order

The requested numbering **T18 → T19 → T20 → T21 is also the clean dependency order** — no reorder is
needed this time. T18 finishes the engine (the pack is the last consumer of the T17 loot economy);
T19 stands up the first client that renders that engine as a scene; T20 makes that client accessible
from its first shipped form; T21 proves the client can quit and resume losslessly at any turn
boundary and then runs the gate over the finished slice.

| Task | Deliverable | Layer | New/expanded state | Retires |
|------|-------------|-------|--------------------|---------|
| T18 | Weight-limited inventory | engine `src/sim/inventory.ts` | `player` carry weight (derived); item weights | FR-PLR-03 |
| T19 | Story-first single-decision client | client `prototype/harness` (playable driver) | — (client only) | FR-UI-01/02/03/05 |
| T20 | Accessibility baseline | client render + input | — (client only) | NFR-ACC-01/02 |
| T21 | Lossless quit/resume → Loop-Feel Check | client session + gate | — (uses T7 SaveFile) | M1 DoD, §4 Stage-1 gate |

## T18 — Weight-limited inventory (FR-PLR-03)

**Idea.** Loot being finite (T17) only bites once carrying it is finite too. The pack has a weight
budget; every item weighs something; and once the budget is full, a search that turns up a heavier
find than you can carry forces a real choice — drop something you already have, or leave the new
thing in the world. This is the point where the finite economy and the finite carry meet: a full
pack stops draining the region, so scavenging is self-limiting rather than a vacuum.

**Where it lives.** New module `src/sim/inventory.ts` owns the numbers; it is the T17 loot code's
one new dependency. `player.inventory` already exists (`InventoryEntry[]`), so no state-shape change
and **no `SAVE_SCHEMA_VERSION` bump** — carry weight is *derived* from the inventory, not stored, so
there is nothing new to migrate. Item weights are engine constants for M1 (`ITEM_WEIGHTS`, keyed to
the same `item.*` ids the T17 loot tables emit), a bridge until the item content set lands in M2 —
exactly as the loot-table item ids are today.

- `itemWeight(type)` — integer weight of one unit (unknown ⇒ a sane default).
- `inventoryWeight(inventory)` — summed `quantity × weight`.
- `CARRY_CAPACITY` — the pack budget in the same integer units.
- `addItemBounded(inventory, type)` → `{ inventory, carried: boolean }` — stack the item **only if
  it fits**; if it would exceed capacity the inventory is returned unchanged and `carried: false`.
- `dropItem(inventory, type)` — remove one unit of a carried stack (the leave-behind lever).

**Wiring.** `resolveSearchLoot` (T17) swaps its unconditional `addItem` for `addItemBounded`: when
the find fits, it is pocketed and the region is debited by exactly what was taken (unchanged
behaviour); when it does **not** fit, the item is left in the world and the region is **not** debited
— a full pack literally stops you drawing the well down, closing the FR-ECO/FR-PLR loop. A new
`drop` action joins `availableActions` (one choice per carried stack, stable-ordered) so the
leave-behind decision is a real, offered move; dropping costs no time and is inert on an empty pack.

**Numbers (tunable constants).** Weights are small integers so a starting pack holds a handful of
finds before the choice bites: light consumables (`item.bandage`, `item.painkillers`, `item.ammo`)
`1`; food/water (`item.canned-food`, `item.water`) `3`; bulky gear (`item.tools`, `item.fuel`,
`item.blanket`) `6`; a firearm (`item.pistol`) `8`. `CARRY_CAPACITY` `40` — enough that a fresh run
scavenges freely, tight enough that a full sweep of a rich node forces a drop. Unknown ids default
to weight `2`.

**DoD.** `inventoryWeight` never exceeds `CARRY_CAPACITY` after any sequence of searches (engine
property over random play). A search whose find would overflow the pack leaves the item in the world
and does **not** debit the region (proven against T17's accounting — the run pulls *less* from a
region once the pack is full, never more). `drop` frees exactly one unit of weight and re-enables the
next find. Deterministic, pure, integer-only; a picked-clean or over-weight search still resolves a
turn (time + noise) so the T13 no-op-turn audit stays green.

## T19 — Story-first single-decision client (FR-UI-01, FR-UI-02, FR-UI-03, FR-UI-05)

**Idea.** M1's whole bet is that *choosing an action is interesting*, and that can only be judged
through the interface it will actually ship behind — a short scene that resolves to one decision, not
a spreadsheet of bars. This task turns the M0 empty-turn harness into the **first real playable
client**: it renders each turn as prose answering the Four Questions, surfaces only the critical
state (and infection, when it exists, as symptom text — never a bar, FR-UI-02), lists the offered
choices with their *known* costs but hidden outcomes (FR-UI-03), and takes the player's pick to
resolve the next turn. It is the loop presented as story.

**Where it lives.** `prototype/harness/` grows from a one-shot demo into a driver: a pure
`renderScene(scene, state)` → lines (extending the M0 renderer with the status line, the pack, the
wounds-as-prose, and the loot/combat narration the engine already emits) and a pure
`playSession(state, graph, inputs)` that folds a list of chosen choice-ids into a sequence of
resolved turns, returning every Scene and the final state. `main.ts` becomes an interactive read-eval
loop over that pure core (the only impure shell), so a Vitest test drives the exact same code a human
plays. The engine is untouched — this is a client-only task (DESIGN §3).

**Screen shape (FR-UI-01).** Header (day · phase · clock · turn) → status (only critical needs, in
words not bars; the pack weight `X/40`; any wounds as short prose via the T16 `woundBurden`) → story
(the Scene narration — where you are, what changed, the threat lead) → choices (numbered, each with
its known time cost; combat/stealth/drop choices when the situation offers them) → footer (save
hint). No fake choices: every listed option is one the engine actually offers this turn (FR-UI-03).

**DoD.** A human can play a slice of Rivermouth end to end in the terminal — move, search, fill the
pack, hit a walker node and fight or slip past, drop to make room — reading only prose and picking a
number. Only critical stats appear and none as a raw infection number (FR-UI-02). The layout is a
single vertical column that reads top-to-bottom (FR-UI-05 one-hand/mobile-first shape; a real mobile
client is post-M1, but the layout contract starts here). The render and session core are pure and
unit-tested; a harness integration run plays a scripted multi-turn slice and asserts the scenes.

## T20 — Accessibility baseline (NFR-ACC-01, NFR-ACC-02)

**Idea.** Accessibility is a Must *from the first UI*, not an M5 retrofit (PRODUCTION §10). The first
client is text end to end, which is the strongest possible starting point — the work is to make that
text *carry all critical information on its own* and be cleanly navigable, and to keep it that way as
a contract the later clients inherit.

**Where it lives.** The T19 client render + input, plus a small `describeStatus`/`describeChoice`
seam so the accessible phrasing is the single source both the human render and a future screen-reader
view read from.

**What it guarantees.**
- **No color/audio-only information (NFR-ACC-01).** Every critical fact — threat, a full pack, a
  bleeding wound, a costed choice — is conveyed in words. The client uses no ANSI color as the sole
  carrier of meaning (any color is decorative and duplicated in text); nothing depends on a sound.
  A plain-text transcript of a session contains everything needed to play it.
- **Semantic, navigable text (NFR-ACC-02).** Choices are a stable, numbered list selectable by
  keyboard alone (type the number); the screen has a consistent, labelled region order
  (header/status/story/choices/footer) so a screen reader traverses it predictably; no choice is
  reachable only by a spatial or timed interaction.

**DoD.** Keyboard-only play is complete — a full slice is playable with number keys and enter, no
pointer, no timing. A test strips all styling from a rendered session and asserts every critical fact
(current threat, pack full/leave-behind, an active wound, each choice's cost) still appears in the
plain text (NFR-ACC-01). The region order is asserted stable across turn types (explore / combat /
over-weight), giving the navigable-structure guarantee (NFR-ACC-02) a regression test.

## T21 — Lossless quit/resume at any turn boundary → Loop-Feel Check (M1 DoD · §4 Stage-1 gate)

**Idea.** The last M1 Definition-of-Done proof: a player can stop after *any* turn and resume with
nothing lost (PRODUCTION §3, GDD safety-net determinism). The engine already round-trips a save
losslessly (T7) and the client owns the I/O (ADR-0003); T21 wires them into the play loop and proves
the property holds at *every* boundary of a real slice, then runs the gate that closes the milestone.

**Where it lives.** The T19 client session gains a save/resume seam: after each resolved turn it can
emit the T7 `SaveFile` string, and a run can be reconstructed from that string alone (the transient
region graph is rebuilt from content on load, never stored — as established since T11). `main.ts`
gets a quit-and-save path and a load path; the pure session core gets a `resumeSession` that starts
from a loaded state.

**DoD (the M1 exit criteria).**
- **Lossless quit/resume (proof).** For a scripted slice, saving after turn *n*, reconstructing, and
  continuing yields a run byte-identical to never having stopped — asserted at *every* turn boundary
  of the slice, across turn types (a mid-combat boundary included, since `combat` is now in state).
  This is the T7 round-trip elevated from a single state to the whole play sequence.
- **A full slice runs end to end** in the client over shipped Rivermouth (Part 1–3 systems all live):
  move, search under the weight cap, deplete/loot, take a wound, fight or slip past walkers, rest —
  every resolved turn still passes the T13 no-op-turn audit and every content file the schema gate.
- **Loop-Feel Check (§4 Stage-1 gate).** With the raw loop fully built and playable, answer the only
  question M1 exists to answer: *is picking an action interesting, turn to turn?* Record the verdict
  in the tracker's Fun-Gate log (build, date, the specific moment, go/no-go). A pass opens M2; a fail
  keeps scope **on the loop** — no world reactivity to paper over a boring core (§4's standing rule).

## Test & CI posture

Unchanged standing gate: every increment keeps **engine + content-loader + harness** green plus the
content schema gate (run all packages locally — the sandbox mount carries only partial deps). T18
adds engine unit + property tests and extends the T17 harness loot run to prove the pack caps the
draw. T19–T21 are client tasks: their tests drive the *pure* render/session core (no stdout, no
process) so a Vitest run asserts exactly what a human sees, plus harness integration runs over
shipped Rivermouth. The T13 100-turn telemetry audit and the zero-corruption save contract must stay
green throughout; T21's quit/resume proof is the save contract exercised at every boundary. No new
content types ship in Part 3, so the schema surface is unchanged — but the gate still runs, because
green is the floor, not the goal.
