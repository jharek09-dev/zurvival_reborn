# M4 Part 7 — The economy: resource loops, spoilage, crafting, repairs (T51 · "always a little short")

**Milestone:** M4 (Content-complete city) · **Task:** T51 · **Requirements:** FR-ECO-04, FR-ECO-05,
FR-ECO-06, FR-ECO-07 (all Should, MVP). GDD **Part X** ("Inventory, Crafting, Loot & Economy" — the four
loops, spoilage, the crafting/repair practice, "the last can") and **Part XI** (crafting rooms unlock
capabilities). The M4 wireframe **SCR-10** (Workshop — Crafting & Repair: honest text recipes, *time is
the real price*, missing parts stated not greyed, **repair beats replace** — each repair adds a line to
the artifact's provenance, no celebration).
**Depends on:** T17 (the loot tables + the `includeRadio` additive-gating idiom this mirrors for finding
components / blueprints / fresh food), T22 (the per-hour needs tick in `survival.ts` — where carried-food
spoilage hooks, exactly beside `advanceInfection`), T27 (`world.powerGrid` — the "faster once power fails"
signal, read not written), T39 (`player.stash` — the base store, and the seam for deferred base spoilage),
T3 (the `ItemInstance {quality, durability, metadata}` shape — durability declared since v1 and never yet
mutated; metadata is the repair provenance ledger), T47/T50 (the content-pool-on-the-`RegionGraph`
registration idiom + the four-part `Choices/isAction/resolve/Line` seam this copies), T5 (named-stream RNG
— **none is added**; every economy option is a deterministic conversion, so the economy draws no stream).

## What FR-ECO-04..07 ask for

The economy is "the pulse the player takes every day … always feel slightly short — never comfortable,
rarely empty — so that every can of food is a small decision" (GDD X). Four requirements, one system:

- **FR-ECO-04 — four resource loops, each with a drain *and* a sink.** body (food/water), safety
  (ammo/materials/durability), health (medicine), power (fuel/components). The audit before this part:
  body & health already have honest sinks (needs drift ↔ eat/drink/treat); **safety** has ammo + scrap
  sinks but gear **durability is declared and never spent**; **power** has *no sink at all* — `item.fuel`
  is lootable but nothing consumes it and `world.powerGrid` only ever falls from weather. This part gives
  the two thin loops real sinks so all four close.
- **FR-ECO-05 — food spoilage (faster after power loss) + water purification.** Perishable food ages and
  is lost; dirty water must be made safe before it counts.
- **FR-ECO-06 — crafting (medical / weapon / shelter / survival), gated by blueprints, components, and
  the right room.** Practical recipes, not a tech tree to a win button.
- **FR-ECO-07 — repairs keep artifacts alive.** The reason to protect a good weapon rather than discard
  it; repair-over-replace, and the artifact's *story grows* with each repair (SCR-10, Principle 6).

"Every option debits a real resource; deterministic; save-lossless" (the task's own acceptance line) is
the spine: no recipe is free, time included, and nothing here reads a clock or a global RNG.

## The one system that closes all four loops

Rather than bolt four unrelated meters on, T51 ships **one content-driven crafting/repair/spoilage
system** whose sinks *are* the four loops made legible:

| Loop | existing drain | **sink this part adds / completes** |
| --- | --- | --- |
| **body** | hunger/thirst rise per hour (T22) | **food spoilage** — perishable `item.food-fresh` ages out (the passive body sink) |
| **safety** | combat, threat | **gear durability** — an equipped artifact wears with use; **repair** restores it |
| **health** | wounds, infection | **crafted medical** — bandages / antiseptic / crude antibiotics off the workbench |
| **power** | grid decay from weather (T27) | **fuel burn** — running the workshop / boiling water **debits `item.fuel`** |

So "each with drains and sinks" is satisfied *by construction*: every craft, repair, and purification
debits real components/fuel/**time**, and spoilage is the passive food sink. The workbench is where the
four loops meet — exactly the GDD's framing.

## The economy is content (`content/recipes/*.json`), interpreted generically

Faithful to the milestone theme ("all content schema-validated in CI") and GDD XV (scripts as data), a
recipe is authored JSON and the engine ships a **generic interpreter** — no per-recipe branching, the T47
/ T50 pattern. The pool rides the transient `RegionGraph` (`graph.recipes`, mirroring `graph.signals`),
so **a graph built without it leaves the whole system inert and every prior run byte-identical**. One new
content type **`content/recipes/`** + **`content/schemas/recipe.schema.json`** takes the schema gate
**10 → 11 types**.

A `RecipeDef` carries: `id` (`recipe.<category>.<slug>`), `category`
(`medical`|`weapon`|`shelter`|`survival`|`repair`|`purify`), `label` (the row name, SCR-10 "Reinforced
plank"), `worldEffect` (the *what-it-does-in-the-world* prose — "Boards the east window"; never a stat),
`inputs` (a list of `{item, qty}` — the full known cost in mono), an optional `output` (`{item, qty}` for
item-producing recipes), an optional `installsRoom` (a **shelter** recipe whose product is a room, not an
item), a `repairs` flag (a **repair** recipe targets a carried durability artifact instead of consuming
inputs into an output), an optional required `blueprint` (omit ⇒ known from the start — survival basics),
an optional required `room` (omit ⇒ craftable in your shelter with no room), `timeCost` (hours — *the real
price*), an optional `noise` (a molotov is very loud), and an optional `missingHint` (the amber
"needs: fuel ×1" line — a scavenging goal, never a mystery). Rooms and blueprints are **`ContentId`
strings threaded through recipes**, not separate content folders — a room is *built by* a shelter recipe
(`installsRoom`) and *required by* another (`room`); a blueprint is *learned* into player state and
*required by* a recipe (`blueprint`). This collapses "gated by blueprints, components, and rooms" into one
schema without three content types.

## Save schema — one forward-only rung, **v9 → v10**

The economy needs three genuinely new facts, none derivable from existing shapes, so unlike T50 this part
takes a rung. All three seed **empty**, so a migrated pre-economy save is inert and byte-identical:

- **`player.economy = { blueprints: ContentId[], freshness: number | null }`** — the learned recipe
  unlocks, and the single hours-until-spoil countdown for the carried `item.food-fresh` stack (`null` when
  none). One nested slice (future shelter-jobs / trade depth extend it) rather than two loose fields.
- **`NodeState.rooms: ContentId[]`** — the crafting rooms installed at a node (only ever the shelter node
  has any). Mirrors `walkers` / `zombieTypes` (a per-node list added empty at a rung).

`migrateV9toV10` seeds `player.economy = {blueprints: [], freshness: null}` and every node `rooms: []`,
stamps `meta.version = 10` — the `migrateV6toV7` (stash) × `migrateV1toV2` (per-node field) pattern,
pure and total. `SAVE_SCHEMA_VERSION → 10`; the ladder gains one entry; a v9→v10 migration test proves a
pre-economy save loads forward, seeds the empties, and stays behaviorally identical.

## Spoilage — a derived, power-coupled countdown that only fresh food ever feels

Perishability is **not** smeared across the inventory. Canned food (`item.canned-food`, in every prior
golden) is shelf-stable and **never spoils** — so even before gating, no existing run is touched. Only a
new **`item.food-fresh`** (which enters play *only* via economy-active loot, gated exactly like
`item.radio`) perishes. `player.economy.freshness` is one integer: set to `FRESH_SHELF_LIFE` when fresh
food is first carried, decremented each hour in **stage 4** (beside `advanceInfection`) by
`1 × (world.powerGrid < POWER_SPOIL_AT ? POWER_SPOIL_MULT : 1)` — so "faster once power fails" falls out
of a signal the world *already* drifts (T27), with no new bookkeeping. At `≤ 0` the carried fresh stack
converts to **`item.food-spoiled`** (weightless-risk flavour, a `food.spoiled` History beat — no confetti,
SCR-10 §"no celebration"). The whole tick is gated `if (!economyActive(graph)) return state;` **and**
guarded on carrying fresh food — double-dark on every prior run.

## Water purification — a `purify` recipe, dirty ⇒ safe

`item.water-dirty` (found at wells / ponds / broken mains via economy-active loot) is not the safe
`item.water` the body loop drinks. A `purify` recipe converts it — the SCR-10 water-filter path
(`1 charcoal · 1 cloth` to build a filter is a **shelter** recipe; boiling is a **purify** recipe costing
`item.fuel` + time). Drinking `item.water-dirty` directly is never offered; purification is the honest
gate, and it debits the **power** loop (fuel) — a second sink for the thinnest loop.

## The seam — `economyChoices` / `isEconomyAction` / `resolveEconomyAction` / `economyLine`

Mirrors `radioChoices` exactly, wired into the same four sites in `coreActions.ts` (offer in the explore
branch; dispatch in the stage-3 `applyPlayerAction` chain; narrate in `sceneOf`). Every choice is gated on
a predicate **false in every prior golden run**, so the available-action list is byte-identical unless the
player is standing in their own shelter with the components in hand:

- **`craft-<id>`** (`recipe.timeCost` h) — offered only when: `economyActive(graph)` **and** the player is
  at `player.shelterId` (the workbench is home) **and** every `input` is carried **and** the `blueprint`
  (if any) is in `player.economy.blueprints` **and** the `room` (if any) is in the shelter node's `rooms`.
  A recipe missing *only* a component is surfaced with its `missingHint` (amber, SCR-10) but not craftable
  — a stated goal, never a greyed-out taunt. Resolve: debit every input (deterministic `consume`, first
  matching stack), grant the `output` / `installsRoom`, spend the hours, log a terse `craft.done` beat.
- **`repair-<slot>`** (repair recipe's `timeCost`) — offered when a carried/equipped **durability
  artifact** (`ItemInstance.durability !== null`, an economy-only condition) is below full and its repair
  inputs are carried and a workshop room is present. Resolve: debit inputs, raise `durability` toward 100,
  and **append a provenance line to `metadata`** (`repairs: [...prior, {day, note}]`) — the artifact
  persists and its story grows (SCR-10: "third repair — its story grows"). Repair-over-replace by
  construction: the instance id never changes.
- **`purify`** (fuel + time) — offered when carrying `item.water-dirty` + `item.fuel` in shelter. Resolve:
  convert N dirty → N safe, debit fuel, spend hours.
- **`study-<bp>`** — when carrying an `item.blueprint.<slug>` (a rare economy-active find), a "study the
  blueprint" choice consumes it and adds the unlock to `player.economy.blueprints` (the eat/drink pattern:
  consume item ⇒ state change). This is *how* recipes are "gated by blueprints the player finds or is
  taught."

`economyLine(state, graph)` contributes to `sceneOf` narration **only on an economy turn** (a `craft.*` /
`food.spoiled` / `repair.*` beat exists for `state.meta.turn` — the this-turn scan `radioLine` uses), so
the workbench never clutters an ordinary scene. All words; the cost chip is prose ("2 scrap · 30m ·
quiet"); no rarity colors, no crafting grid, **no raw numbers the design forbids** (FR-UI-02 / NFR-ACC-01).

## Durability & the repair sink (FR-ECO-07, the honest part)

`ItemInstance.durability` has existed since v1 and is mutated **nowhere** — so *any* run today carries
zero durability artifacts (all stack items have `durability: null`). That is the byte-identity dividend:
a minimal, gated hook — *an equipped artifact weapon with non-null durability loses 1 on a melee strike*
— is **inert on every prior golden** (none has such an artifact) while giving repair a real reason to
exist. Economy artifacts (a crafted reinforced tool, the legendary firefighter's-axe seed) are the only
things that wear, and the `repair` recipe is the only thing that restores them. If the combat hook proves
to touch the fight loop in a way the audit dislikes, the fallback is a use-counter sink outside combat;
the repair recipe + provenance growth is tested directly either way.

## Determinism, RNG, and byte-identity (the discipline)

- **No new RNG stream, no loot-table mutation of the shared arrays.** Crafting/repair/purify are pure
  deterministic conversions (`consume` picks the first matching stack — the existing byte-stable order).
  New lootable economy items (`item.food-fresh`, `item.water-dirty`, `item.cloth`, `item.charcoal`,
  `item.blueprint.*`, components) are made findable the **`includeRadio` way** — appended to a copy of the
  relevant loot table behind an `includeEconomy` flag = `economyActive(graph)`, computed at the one search
  call site, **never** by growing the shared `LOOT_TABLES` constant (that would shift every `floor(f·len)`
  draw and break radio-less byte-identity — the [[zurvival-byte-identity-loot-hazard]] rule).
- **The whole system is dark without a recipe pool.** `economyActive(graph) = recipePool(graph).length > 0`.
  Golden generators (`playSlice.ts`) don't pass recipes, so: no economy choices, no spoilage tick, no
  durability wear, no loot gating, no scene lines. Adding the empty v10 state fields changes save *bytes*
  (legitimately, as every prior rung did — walkers/npcs/stash/humanity) but **no behavior** — and there
  are no frozen `*.snap` goldens, only behavioral suites, so the 471/9 stay green.
- **Save-lossless across every new path** (`load(save(state))` deep-equal after a craft, a repair that
  grew metadata, a purify, a spoil, a study).

## Test plan

- **Engine** (`sim/economy.test.ts`): the generic interpreter over shipped-shaped recipes — craft debits
  every input + grants the output + spends the hours + logs one beat; a recipe missing a component is
  offered-with-hint but **not** craftable; blueprint-gated and room-gated recipes are hidden until the
  unlock/room is present; **repair** raises durability + appends a provenance line + keeps the instance id
  (repair-over-replace) + never exceeds 100; **purify** converts dirty→safe and debits fuel; **study**
  learns a blueprint and consumes the item. Spoilage: fresh food ages per hour, **twice as fast** below
  `POWER_SPOIL_AT`, converts to spoiled at 0, logs `food.spoiled`; canned food never ages. **Inertness**:
  with no recipe pool `economyChoices` is empty, `economyLine` null, spoilage a no-op, and a scripted
  run's turns are byte-identical to the pre-economy engine (the key guarantee). Determinism: same
  seed+state+action ⇒ byte-identical; a render never advances anything; **save-lossless** across each path.
- **Save** (`economyMigration.test.ts`): a synthesized **v9** blob loads forward to v10, seeds
  `player.economy = {blueprints:[], freshness:null}` + every node `rooms: []`, and a healthy migrated run
  plays on identically; a v10 save round-trips deep-equal after a metadata-growing repair.
- **Harness** (`economy.test.ts`): the shipped `content/recipes/` loads and interprets; a **legibility
  gate** — a recipe row is all words, states its full cost and world-effect, and shows a *stated* missing
  part (never a bare greyed row); a **shipped-content play beat** — reach a shelter, build the workshop
  room, craft a bandage (watch a component leave the pack), purify dirty water, let fresh food spoil after
  the grid drops, repair an artifact and see its provenance line grow.
- **content-loader**: the schema gate auto-counts the new type (**11 types**); a malformed recipe is
  rejected (rides the existing malformed-content gate).
- Full CI green in the cloud sandbox before packaging; every prior **471 / 9** golden byte-identical (the
  no-pool inertness guarantees it), harness smoke + determinism + save round-trip still ✓.

## Definition of done

CI green in a clean sandbox; the legibility gate green; format-patch built + verified (`git am` on a fresh
baseline + `diff -r` empty); changed files synced to the E: mount; `docs/status.json` T51 → done + banner
+ parkingLot; `CHANGELOG.md`; `docs/qa/QA_REVIEW_M4_PART7.md`; Mission Control snapshot refreshed. An
adversarial two-subagent audit (engineering: determinism / save-losslessness / **byte-identity of every
prior golden** / loot-draw non-shift / edge cases; design: SCR-10 fidelity — time-as-price, repair-over-
replace, missing-parts-stated, no-celebration, no-number-leak — and "always a little short" fairness).

## Parking lot / deferrals

- **Base / stash spoilage (GDD X "the fridge")** — T51 spoils only the *carried* fresh stack; food banked
  in `player.stash` is abstracted as preserved. The community fridge that fails with the grid is **T52**
  (shelter depth — jobs, storage, the daily report that says "what broke"), where per-stash spoilage and a
  fuel-burning generator that *holds* `powerGrid` up belong.
- **Jobs that produce/consume while you're away (GDD XI, FR-SHL)** — residents cooking/foraging/building
  is the T52 shelter-economy loop; T51 is the *player's* workbench only.
- **Trading (FR-ECO-08, Could/v1)** — scarcity/reputation-priced exchange with groups needs factions
  (T53); T51 ships production + repair, not exchange.
- **"The last can" balance (FR-ECO-10) & the scarcity curve** — the moral-scarcity moment is an *emergent*
  balance target (M5 T59/T60); T51 installs the sinks that *can* produce it but tunes none of the dials
  (`FRESH_SHELF_LIFE`, `POWER_SPOIL_AT`/`POWER_SPOIL_MULT`, recipe costs/times, durability wear, the loot
  rates for components) against a real cross-city run.
- **Hidden loot + NPC hints (FR-ECO-09)** — curiosity-rewarding caches and the survivor tip that resolves
  to real loot is its own beat (a T54 depth-screen / radio-rumor tie-in), not this part.
- **First-pass recipe set + rooms** — a demonstrator across all six categories (medical/weapon/shelter/
  survival/repair/purify) + the workshop & medical rooms, not the launch cookbook; the deep pour (a
  fitting recipe tree per district, legendary-item repair chains) is post-gate content behind the
  review-capacity cap + the owner's voice pass (as PL-M4-12).
- **Legendary items (GDD X)** — the firefighter's-axe repair chain is seeded as the durability/provenance
  demonstrator; the full legendary set (what each *enables*, the history it accrues) is post-gate.
