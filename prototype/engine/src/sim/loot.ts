/**
 * Finite, contested, depleting loot economy (M1 task T17 · FR-ECO-01/02/03 · GDD X).
 *
 * Loot is a *stock*, not a spawn. Three rules define it, and this module enforces all three:
 *
 *   1. **Finite & depleting (FR-ECO-01).** A region carries a `RegionState.loot` richness (0–100).
 *      Searching draws from it and **debits** it; it only ever goes down. Nothing refills it, so the
 *      total a run can pull from a region can never exceed its starting stock.
 *   2. **Contested (FR-ECO-01).** The world competes for the same stock. Each turn, rivals draw the
 *      region down a little in proportion to its `survivorActivity` — so a node you leave unsearched
 *      can be poorer when you come back. (M1 scripts this; the M2 director makes it reactive.)
 *   3. **Plausible & partial (FR-ECO-02/03).** A search returns a *portion*, scaled down as the node
 *      is picked over (its `searchPct`) and as the region thins, and the concrete item is drawn from
 *      a plausibility table keyed to the node's kind (a clinic yields medical, a store yields food).
 *
 * The item *ids* here are engine constants — a bridge until an item/loot-table content set lands in
 * M2; the finite accounting that matters (region loot points) is fully modelled now. Pure,
 * deterministic (named `loot` RNG stream), dependency-free, integer-only (ADR-0001).
 */

import type { ContentId, GameState, ItemInstance, NodeId, RegionState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { drawInt, drawPick, drawWeighted, type Weighted } from "../rng/streams.js";
import { addItemBounded, fits } from "./inventory.js";
import { WEAPONS, BASE_LOOT_WEIGHT, weaponLootFor } from "../combat/weapons.js";
import { WEAPON_SLOT } from "./economy.js";
import { profileOf, scaleInt } from "./difficulty.js";
import { bankHours } from "./clocks.js";

/**
 * Rivals draw a region down one point per this many banked *pressure-hours* (`survivorActivity` x hours).
 * T74: the remainder is carried on `RegionState.lootContestHours`, so ordinary turns accumulate instead
 * of truncating to nothing; the T56 scarcity dial shortens this period rather than scaling the points.
 */
export const LOOT_CONTEST_DIVISOR = 50;

/** Node kind → the item ids a search there can plausibly turn up (FR-ECO-02). */
export const LOOT_TABLES: { readonly [kind: string]: readonly string[] } = {
  generic: ["item.canned-food", "item.water", "item.scrap", "item.bandage"],
  store: ["item.canned-food", "item.water", "item.batteries", "item.lighter"],
  medical: ["item.bandage", "item.antiseptic", "item.antibiotics", "item.painkillers"],
  police: ["item.ammo", "item.pistol", "item.bandage"],
  residential: ["item.canned-food", "item.blanket", "item.batteries", "item.scrap"],
  industrial: ["item.scrap", "item.fuel", "item.tools", "item.batteries"],
};

/**
 * The scavenged radio (T50) is appended to these tables ONLY when the radio system is active (a signals
 * pool is registered on the run) — a `floor(f*len)` pick shifts every index when a table grows, so
 * mutating the shared tables would silently change loot draws in radio-less runs and break their
 * byte-identity. Gating it on the pool keeps every prior/radio-less run drawing exactly as before.
 */
export const RADIO_LOOT_ITEM = "item.radio";
const RADIO_LOOT_KINDS: ReadonlySet<string> = new Set(["store", "residential", "industrial"]);

/**
 * The economy items (T51) are appended to these tables ONLY when the crafting economy is active (a recipe
 * pool is registered) — exactly the radio discipline above, for exactly the same `floor(f*len)` reason: a
 * table that grows shifts every draw, so mutating the shared tables would break byte-identity for every
 * economy-less run. Gating on the pool keeps every prior run drawing as before. Per kind: perishable
 * `item.food-fresh` where food is, `item.water-dirty` where water is, the `cloth`/`charcoal` components,
 * and a rare blueprint schematic in the clinic (`antibiotics`) / the station (`molotov`).
 */
const ECONOMY_LOOT: { readonly [kind: string]: readonly string[] } = {
  generic: ["item.food-fresh", "item.water-dirty", "item.charcoal"],
  store: ["item.food-fresh", "item.cloth"],
  medical: ["item.blueprint.antibiotics"],
  police: ["item.blueprint.molotov"],
  residential: ["item.food-fresh", "item.cloth", "item.water-dirty"],
  industrial: ["item.charcoal", "item.water-dirty"],
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * The item pool for a node kind, falling back to the generic table for an unknown/absent kind. With
 * `includeRadio` (radio system active) the scavenged radio is appended to the store/residential/industrial
 * tables; with `includeEconomy` (crafting economy active) the economy items for the kind are appended
 * after it. Both are additive and gated, so a run with neither flag draws exactly as before — the append
 * order (base, radio, economy) is fixed so a run with both is itself deterministic.
 */
export function lootTableFor(kind: string | undefined, includeRadio = false, includeEconomy = false): readonly string[] {
  const base = (kind !== undefined && LOOT_TABLES[kind]) || LOOT_TABLES["generic"]!;
  const withRadio = includeRadio && kind !== undefined && RADIO_LOOT_KINDS.has(kind) ? [...base, RADIO_LOOT_ITEM] : base;
  const eco = kind !== undefined ? ECONOMY_LOOT[kind] : undefined;
  return includeEconomy && eco !== undefined ? [...withRadio, ...eco] : withRadio;
}

/**
 * The loot table as **weighted** entries (M5 task T81 · FR-CBT-04 · GDD X "rough tiers from common junk
 * to rare finds").
 *
 * Two things happen here and only when `includeWeapons` is true — i.e. only when the run registered a
 * weapon content set (`graph.weapons`), which no pre-T81 run and no pool-less fixture does:
 *
 *   1. **Every weapon leaves the flat table and re-enters at its own `lootWeight`.** That is the fix for
 *      the tier problem at its root: on the pre-T81 uniform police table `item.pistol` came out of
 *      **24.6%** of searches (measured, `measure/t81.ts --loot`) — a gun was exactly as likely as a
 *      bandage. It is filtered out of the base list first, so a weapon already sitting in a hand-written
 *      table is not counted twice.
 *   2. **Ordinary items carry {@link BASE_LOOT_WEIGHT} between them.** Under T81 each carried it
 *      individually, so the only relative frequency T81 changed was weapon-vs-not. **T84 tiers them
 *      against one another** ({@link tieredOrdinary}) while holding their total at exactly
 *      `rows x BASE_LOOT_WEIGHT` — so weapon-vs-ordinary is still precisely T81's number, and a
 *      weapon-free kind (`medical`) is no longer uniform but is still drawn only from ordinary rows.
 *
 * With the gate off the caller uses the untouched {@link lootTableFor} + `drawPick` path instead, so a
 * run without the pool draws bit-for-bit as before (the `floor(f·len)` hazard: see {@link lootTableFor}).
 */
export function lootEntriesFor(
  kind: string | undefined,
  includeRadio = false,
  includeEconomy = false,
): readonly Weighted<string>[] {
  const base = lootTableFor(kind, includeRadio, includeEconomy).filter((id) => WEAPONS[id] === undefined);
  // T84: ordinary items are no longer all equals — but their TOTAL is unchanged (`tieredOrdinary`), so
  // the weapon-vs-ordinary odds T81 swept are preserved exactly and only the mix among ordinary finds
  // moves. A kind whose whole table is untiered is still an exactly uniform draw at BASE_LOOT_WEIGHT.
  const entries: Weighted<string>[] = [...tieredOrdinary(base)];
  for (const w of weaponLootFor(kind)) entries.push({ value: w.id, weight: w.weight });
  return entries;
}

/**
 * A deterministic id for an artifact the world just handed you. Distinct prefix from the bench's mint
 * (`economy.ts`), because where a weapon came from is the first line of its provenance and two artifacts
 * minted on the same turn must not collide. One search costs ≥1h so the turn alone is near-unique; the
 * numeric suffix is the backstop.
 */
function foundArtifactId(state: GameState, type: string): string {
  const base = `${type}#found-t${state.meta.turn}`;
  if (!(base in state.items)) return base;
  let i = 2;
  while (`${base}.${i}` in state.items) i++;
  return `${base}.${i}`;
}

/**
 * Pocket a found weapon as a **tracked artifact** rather than a stack (T81).
 *
 * This is the second half of "there are no melee weapons in the game", and the half that is not content:
 * before T81 the only writer of `player.equipment[WEAPON_SLOT]` in the entire engine was the crafting
 * bench's mint, and `ItemInstance` was only ever created there too — so a weapon dropped into the pack by
 * `addItemBounded` would have been a *stack*, with no durability to wear, no ledger to repair, and no way
 * into a hand. Measured on the pre-T81 tree: **0 of 30 scavenging runs ever held a melee weapon**.
 *
 * A found weapon therefore arrives with a durability track at the profile's `startDurability`, the
 * provenance the repair ledger appends to (`foundDay`/`foundAt`, the Principle 6 shape `metadata` has
 * carried since T51), and **is taken up on the spot only when that is not a decision** — the hands are
 * empty, or what they hold has broken. Choosing *between* two working weapons is the `equip` verb's job
 * (`actions/gear.ts`); doing it here would quietly overwrite the axe with the chair leg you just found.
 *
 * Returns null when the pack cannot take the weight, which the caller treats exactly as the full-pack
 * rule always has: the find stays in the world and the region is **not** debited.
 */
function pocketWeapon(state: GameState, nodeId: NodeId, type: ContentId, startDurability: number): GameState | null {
  if (!fits(state.player.inventory, type)) return null;
  const id = foundArtifactId(state, type);
  const item: ItemInstance = {
    type,
    quality: 100,
    durability: startDurability,
    metadata: { foundDay: state.meta.day, foundAt: nodeId, repairs: [] },
  };
  const held = state.player.equipment[WEAPON_SLOT];
  const heldItem = held === undefined ? undefined : state.items[held];
  const handsFree = held === undefined || heldItem === undefined || heldItem.durability === 0;
  return {
    ...state,
    items: { ...state.items, [id]: item },
    player: {
      ...state.player,
      inventory: [...state.player.inventory, { type, quantity: 1, itemId: id }],
      ...(handsFree ? { equipment: { ...state.player.equipment, [WEAPON_SLOT]: id } } : {}),
    },
  };
}

/**
 * Rarity tiers for the **ordinary** items (M5 task T84 · GDD X "rough tiers from common junk to rare
 * finds"), against {@link BASE_LOOT_WEIGHT} for anything not listed.
 *
 * T81 gave the *weapons* tiers and the T84 brief asked for them again, which the measurement says was
 * already paid: on the police table a pistol comes out of **4.5%** of searches against a bandage's
 * **27.4%** (`measure/t84.ts --tiers`, pre-T84 tree). What that same measurement shows is still flat is
 * everything that is not a weapon — the medical table reads 20.9 / 20.4 / 20.0 / 19.6 / 19.1%, i.e. a
 * course of antibiotics is exactly as likely as a bandage and a blueprint exactly as likely as a
 * painkiller. These weights are that residue and nothing more: junk up, the things a survivor would
 * actually go looking for down.
 *
 * Read **only** from {@link lootEntriesFor}, which is itself reached only when the weapon content set
 * is registered — so a pool-less run still draws the untouched uniform table (the `floor(f·len)` pick
 * hazard the radio and economy pools are gated for).
 */
export const ITEM_LOOT_WEIGHT: { readonly [id: string]: number } = {
  // Rare finds — a real reason to search a clinic rather than a house.
  "item.antibiotics": 5,
  "item.blueprint.antibiotics": 4,
  "item.blueprint.molotov": 4,
  "item.ammo": 8,
  "item.fuel": 9,
  "item.tools": 9,
  "item.radio": 7,
  // Common junk — the bulk of any real sweep.
  "item.scrap": 30,
  "item.cloth": 28,
  "item.charcoal": 28,
  "item.water-dirty": 28,
};

/** The weight one ordinary item draws at BEFORE normalisation; {@link BASE_LOOT_WEIGHT} if untiered. */
export function itemLootWeight(id: string): number {
  const w = ITEM_LOOT_WEIGHT[id];
  return w === undefined ? BASE_LOOT_WEIGHT : w;
}

/**
 * The ordinary rows of one table, tiered against each other but summing to **exactly** what they
 * summed to before T84 (`rows x BASE_LOOT_WEIGHT`).
 *
 * ### Why the normalisation is not optional
 *
 * Weights are relative, and the weapons share the table. The first cut of this tiering simply wrote
 * the raw numbers in, which shrank each table's ordinary total — and therefore made **every weapon
 * commoner**, silently undoing T81's measured sweep. Caught by an adversarial audit re-running T81's
 * own instrument on both trees:
 *
 * ```
 *   runs that found the firefighter's axe   PRE-T84 32.5%   ->   raw-weight cut 43.5%
 *   item.pistol out of a police search      PRE-T84  4.2%   ->   raw-weight cut  7.8%
 * ```
 *
 * T81 had explicitly *rejected* an axe rate of 41% ("as likely as a pistol") when it swept that dial,
 * so the raw cut pushed a dial past a point another task had already refused — without touching it.
 * Holding each table's ordinary total fixed makes the weapon-vs-ordinary odds **exactly** T81's, so
 * this task changes only which ordinary item you get.
 *
 * Integer-only (ADR-0001): largest-remainder apportionment of the target total, ties broken by index
 * so the result is stable across runs and platforms. Every row keeps a positive weight, so tiering can
 * make a find rare but never removes it from the table.
 */
export function tieredOrdinary(ids: readonly string[]): readonly Weighted<string>[] {
  const n = ids.length;
  if (n === 0) return [];
  const raw = ids.map(itemLootWeight);
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  if (rawTotal <= 0) return ids.map((value) => ({ value, weight: BASE_LOOT_WEIGHT }));
  const target = n * BASE_LOOT_WEIGHT;
  const num = raw.map((w) => w * target);
  const out = num.map((x) => Math.floor(x / rawTotal));
  let deficit = target - out.reduce((a, b) => a + b, 0);
  const byRemainder = num
    .map((x, i) => ({ rem: x % rawTotal, i }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; k < byRemainder.length && deficit > 0; k += 1, deficit -= 1) {
    out[byRemainder[k]!.i] = out[byRemainder[k]!.i]! + 1;
  }
  // A row must stay drawable. On the shipped tables no floor lands below 1 (proved in
  // `exploration.test.ts`); this is the guard for a future table whose spread is wider than its size.
  return ids.map((value, i) => ({ value, weight: Math.max(1, out[i]!) }));
}

/** A node with no authored {@link NodeDef.richness} is an ordinary place of its kind. */
export const DEFAULT_RICHNESS = 100;
/** Authored richness is clamped into this band on read — a floor of nothing, a ceiling of 2.5x. */
export const RICHNESS_MIN = 0;
export const RICHNESS_MAX = 250;

/**
 * Whether this content set authors {@link NodeDef.richness} anywhere — the **active-system gate** for
 * the whole per-node loot axis (M5 task T84).
 *
 * Exactly the discipline T83 used for `NodeDef.claimable`: a set that says nothing about richness gets
 * the arithmetic it always had, so every fixture and every pre-T84 run computes the **identical cap**.
 * Not the identical RUN — the loot stream advances per unit now, which is a deliberate behaviour change
 * and is declared as one. Cheap: a scan of the already-indexed node defs, called once per search.
 */
export function richnessAuthored(graph: RegionGraph | undefined): boolean {
  if (graph === undefined) return false;
  for (const def of Object.values(graph.nodes)) {
    if (typeof def.richness === "number") return true;
  }
  return false;
}

/** A node def's richness, clamped; {@link DEFAULT_RICHNESS} when absent or not a number. */
export function richnessOf(graph: RegionGraph | undefined, nodeId: NodeId): number {
  const r = graph?.nodes[nodeId]?.richness;
  if (typeof r !== "number" || Number.isNaN(r)) return DEFAULT_RICHNESS;
  return Math.max(RICHNESS_MIN, Math.min(RICHNESS_MAX, Math.trunc(r)));
}

/**
 * The most loot (in region points) a single search can pull, given the region's remaining richness
 * and how picked-over the node already is. Diminishing on both axes; never more than what remains.
 * 0 ⇒ a thin region or an exhausted node yields nothing but time and noise (FR-ECO-03 partial).
 *
 * `richness` (T84) is the node's own multiplier, as a percentage — {@link DEFAULT_RICHNESS} is the
 * exact pre-T84 arithmetic (`trunc(cap * 100 / 100) === cap` for every integer cap), which is why an
 * unauthored set is byte-identical rather than approximately so.
 *
 * It scales the region's own term. Two earlier drafts of this comment were wrong about the
 * consequence, in opposite directions, so it is stated exactly: a rich node **is** the last place in a
 * thinning district to run dry (at `richness` 250 a region down to 4 points still gives 1, where an
 * ordinary node gives 0), and it is still **bounded by what the region actually has left** by the
 * `Math.min(regionLoot, …)` clamp. The finite stock is **redistributed across the places inside a
 * region, never conjured**: nothing here can hand out a point the district does not hold.
 */
export function searchYieldCap(regionLoot: number, searchPct: number, richness: number = DEFAULT_RICHNESS): number {
  // Richness scales the REGION's term only, never the picked-over penalty. `trunc(loot * 100 / 800)`
  // is `trunc(loot / 8)` for every integer, so the default is the pre-T84 formula exactly.
  //
  // The alternative — multiplying the whole expression, as the first cut did — was measured against
  // this one rather than argued about, because an audit raised zero-cap searches against it:
  //
  //   variant             empty (node, searchPct) pairs of 180        mean cap   class spread
  //                       stock x1   x0.75   x0.5   x0.35              at x1
  //   pre-T84                    0       0      0      32               6.62          0
  //   whole-expression           2      10     31      77               6.19       5.31
  //   region-term (this)        11      21     38      63               6.67       5.54
  //
  // Neither reaches zero and the pre-T84 tree does not either — a thin district has always been able
  // to offer a search worth nothing. What the region-term form buys is that authoring richness
  // **redistributes** a district's yield rather than shrinking it (mean cap 6.67 against a pre-T84
  // 6.62, where the whole-expression form loses 6.5% of the city), it separates two nodes of a kind
  // slightly further, and it degrades more gracefully exactly where a real run lives — a thinned
  // district. The early-game cost is paid in words instead: `availableActions` labels a search at a
  // zero cap "it looks stripped", because a choice the player is not warned about is the dishonest
  // half of a dead affordance.
  const cap = Math.trunc((regionLoot * richness) / 800) - Math.trunc(searchPct / 34);
  // The `Math.min(regionLoot, …)` is the pre-T84 clamp, kept — and it is worth being exact about what
  // it does now, because a mutation run removed it and nothing failed. It is **unreachable at today's
  // ceiling**: `cap <= trunc(loot * RICHNESS_MAX / 800) = trunc(0.3125 * loot) <= loot` for every
  // non-negative loot, so the arithmetic already guarantees what the clamp asserts. It is a backstop
  // tied to {@link RICHNESS_MAX}, and it starts binding the moment that ceiling passes 800.
  return Math.max(0, Math.min(regionLoot, cap));
}

/**
 * Region points per item carried out (M5 task T84 · FR-ECO-01/02 · GDD X).
 *
 * ### The defect this constant exists to close
 *
 * Before T84 the search draw `drawInt(1, rawCap)` decided **how much of the region's finite stock you
 * burned**, and the reward was always exactly one item. Measured (`measure/t84.ts --tax`, pre-T84):
 * items per search flat at **1.00** across every cap, while the mean take ran **1.00 → 5.45**. So the
 * roll was pure downside, and *the richer the district the more wasteful the search* — an inverted
 * incentive sitting under the whole scavenging loop.
 *
 * The fix is not a new number, it is an identity: **what you take out of the region is what you carry
 * away.** The draw is unchanged (same `drawInt`, same stream, same one step); it is now converted into
 * a haul rather than a fee. `ceil(points / POINTS_PER_ITEM)` with a floor of one item means a thin
 * region still pays out something when the cap allows a search at all, and a rich one pays out a
 * mixed handful.
 *
 * **Swept, not chosen** — see `docs/qa/QA_REVIEW_T84.md`. The competing pressure is the pack: pre-T84
 * peak load was **19 of 40** with PACK_HEAVY touched on **0.7%** of turns, so the GDD's "what do I leave
 * behind?" was never asked; too generous a divisor turns the pack from a question into a wall.
 */
export const LOOT_POINTS_PER_ITEM = 3;

/** How many items `points` of regional stock become. At least one whenever a search yields at all. */
export function unitsForPoints(points: number): number {
  // `points <= 0` is the only way to get nothing; above it `ceil(p / P) >= 1` for any positive P, so
  // there is no floor to apply and none is pretended (an audit flagged the first cut's `Math.max(1, …)`
  // as a guard that can never engage).
  //
  // Total about junk, because a hand-edited `region.loot` reaches here through the draw. A mutation
  // test caught the first guard (`!(points > 0)`) letting a STRING through — `"4" > 0` is true and
  // `Math.ceil("4" / 3)` is 2. `Number.isFinite` does not coerce, so it rejects a string, `undefined`,
  // `null`, NaN and both infinities on its own; a `typeof` check alongside it was a second mutant, and
  // a proven-redundant guard is one more thing a reader has to believe.
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.ceil(points / LOOT_POINTS_PER_ITEM);
}

/**
 * What one search actually returned (T84).
 *
 * **Honest scope.** An earlier draft of this comment called it "the shape the action layer narrates
 * from", and an audit correctly pointed out that nothing narrated from it: `applyPlayerAction` takes
 * `.state` and drops the rest, which is the T83 "a value threaded nowhere never reaches the player"
 * pattern. It is kept, and described for what it is — **the accurate return type of a search, and the
 * API a client renders a find list from**. The text harness does not render one (its Scene is one
 * decision and a pack screen); the player-facing consequence T84 actually owed them is the pack-room
 * line in `sceneOf`, which reads state and is live. A per-search "you came away with…" line is
 * PL-M5-55, a narration task, not a simulation one.
 */
export interface SearchHaul {
  readonly state: GameState;
  /** Item ids carried away, in draw order. Empty when the cap was 0 or the pack refused everything. */
  readonly found: readonly ContentId[];
  /** Region points the search would have taken had the pack been empty. */
  readonly offered: number;
  /** Region points actually debited — less than `offered` exactly when the pack ran out. */
  readonly taken: number;
  /** True when the pack refused at least one unit the node was willing to give (FR-PLR-03). */
  readonly packFull: boolean;
}

/**
 * Resolve the loot half of a search at `nodeId` (called by stage 3 after searchPct advances). Draws
 * against the region's remaining stock, the node's search progress and — from T84 — the node's own
 * authored {@link NodeDef.richness}; converts the points drawn into a **haul** of items; **debits** the
 * region by exactly what was carried away (finite + depleting); and drops them into the pack. A
 * depleted region or a picked-clean node yields nothing. Pure; consumes the `loot` RNG stream.
 *
 * ### What T84 changed, and what it deliberately did not
 *
 * The draw itself is untouched: one `drawInt(1, rawCap)` on the `loot` stream, exactly as before. What
 * changed is what the number means — it was the **fee** and it is now the **haul** (see
 * {@link LOOT_POINTS_PER_ITEM}). One `drawWeighted`/`drawPick` step follows **per unit** rather than
 * once, so a rich sweep comes back with a mixed handful rather than a single token find, and a rare row
 * gets as many chances as the haul is deep.
 *
 * The **full-pack rule is preserved exactly, generalized per unit**: the first unit that will not fit
 * ends the haul, the rest stay in the world, and the region is debited only for what left it. A full
 * pack still stops draining the well — the property that makes scavenging self-limiting rather than a
 * vacuum.
 *
 * It also, for the first time, makes carrying capacity something a run notices: PACK_HEAVY is touched
 * on **11.3%** of turns against a pre-T84 **0.7%** (`measure/t84.ts --haul`). Stated at that strength
 * and no higher — an audit rightly objected to a first draft that called it "a decision", because the
 * same instrument records **0.0 full-pack turns and 0.00 drops taken** across 40 bot runs. The pressure
 * is real and measurable; the leave-behind *choice* is not yet forced, and forcing it is a balance
 * question (T59/T60), not this task's.
 */
export function resolveSearch(
  state: GameState,
  nodeId: NodeId,
  kind: string | undefined,
  includeRadio = false,
  includeEconomy = false,
  includeWeapons = false,
  richness: number = DEFAULT_RICHNESS,
): SearchHaul {
  const empty = (s: GameState): SearchHaul => ({ state: s, found: [], offered: 0, taken: 0, packFull: false });
  const node = state.nodes[nodeId];
  if (node === undefined) return empty(state);
  const region = state.regions[node.regionId];
  if (region === undefined || region.loot <= 0) return empty(state);

  const rawCap = searchYieldCap(region.loot, node.searchPct, richness);
  // Scarcity FIND-RATE dial (T56): a harder mode's smaller yieldCap makes a THIN search come up empty — the
  // player finds less. Survivor / unset ⇒ lootYield 1 ⇒ yieldCap === rawCap and the guard is exactly the
  // prior `cap <= 0` (byte-identical). The finite-stock DEBIT below draws against the RAW cap, so the
  // region's depletion pacing stays owned by `lootContest`; lootYield gates find-success, not depletion. The
  // dial never touches the loot TABLE, so the floor(f·len) pick hazard (T50) never arises. drawInt is one
  // stream step regardless of range, so a Survivor search draws bit-identically.
  const yieldCap = scaleInt(rawCap, profileOf(state).lootYield);
  if (yieldCap <= 0) return empty(state);

  const drawn = drawInt(state.rng, state.meta.seed, "loot", 1, rawCap);
  const offered = Math.min(region.loot, drawn.value);
  const units = unitsForPoints(offered);

  const entries = includeWeapons ? lootEntriesFor(kind, includeRadio, includeEconomy) : undefined;
  const table = entries === undefined ? lootTableFor(kind, includeRadio, includeEconomy) : undefined;

  let rng = drawn.rng;
  let carried: GameState = state;
  const found: ContentId[] = [];
  let packFull = false;

  for (let i = 0; i < units; i += 1) {
    // T81: with the weapon content set registered the table is drawn by WEIGHT, which costs the identical
    // single `drawInt` step (see `drawWeighted`) — so the stream advances the same per unit either way and
    // only the chosen value can differ. Without it, the untouched uniform `drawPick` path.
    const pick = entries !== undefined
      ? drawWeighted(rng, state.meta.seed, "loot", entries)
      : drawPick(rng, state.meta.seed, "loot", table!);
    rng = pick.rng;

    // A weapon with a durability track is pocketed as a tracked ARTIFACT, not a stack (T81) — see
    // `pocketWeapon`. A refusal there is the full-pack rule, handled identically to a stack refusal.
    const def = WEAPONS[pick.value];
    if (entries !== undefined && def !== undefined && def.startDurability !== null) {
      const pocketed = pocketWeapon(carried, nodeId, def.id, def.startDurability);
      if (pocketed === null) { packFull = true; break; }
      carried = pocketed;
      found.push(pick.value);
      continue;
    }

    // Weight cap (T18 · FR-PLR-03): pocket the find only if it fits. What will not fit stays in the
    // world and is NOT debited — carrying is finite, so a full pack stops draining the well.
    const { inventory, carried: fitted } = addItemBounded(carried.player.inventory, pick.value);
    if (!fitted) { packFull = true; break; }
    carried = { ...carried, player: { ...carried.player, inventory } };
    found.push(pick.value);
  }

  // Debit what left the region, never what the pack refused. A full haul costs the whole draw; a
  // partial one costs `LOOT_POINTS_PER_ITEM` for each unit that actually left — which is the *maximum*
  // rate, where a complete haul pays somewhere between one and that. Leaving with a partial load is
  // therefore slightly wasteful of the district's stock, which is the right pressure: the well is
  // spent whether or not you had room for what came out of it.
  //
  // No clamp is needed and none is pretended: `units === ceil(offered / P)`, so a partial haul has
  // `found.length <= units - 1` and `found.length * P <= P * (units - 1) < offered` always, and
  // `found.length >= 1` on this branch. The first cut wrapped this in `Math.max(1, Math.min(offered,
  // ...))`, two guards an exhaustive probe over `offered` 1..60 showed can never engage — a comment
  // claiming protection that the arithmetic already gives is worse than no comment.
  const taken = found.length === 0 ? 0 : found.length === units ? offered : found.length * LOOT_POINTS_PER_ITEM;

  const next: GameState = {
    ...carried,
    rng,
    ...(taken > 0
      ? { regions: { ...carried.regions, [node.regionId]: { ...region, loot: clampPct(region.loot - taken) } } }
      : {}),
  };
  return { state: next, found, offered, taken, packFull };
}

/**
 * The state-only face of {@link resolveSearch} — the shape every caller before T84 used. Kept because
 * the haul detail is narration, not simulation: a caller that only needs the world moved on should not
 * have to unpack a record to get it.
 */
export function resolveSearchLoot(
  state: GameState,
  nodeId: NodeId,
  kind: string | undefined,
  includeRadio = false,
  includeEconomy = false,
  includeWeapons = false,
  richness: number = DEFAULT_RICHNESS,
): GameState {
  return resolveSearch(state, nodeId, kind, includeRadio, includeEconomy, includeWeapons, richness).state;
}

/**
 * Rivals thin one region by time passed (contest). Loot only ever falls; clamped at 0. Pure.
 *
 * `contest` is the difficulty scarcity dial (T56) on the draw-down; it defaults to `1` and {@link scaleInt}
 * short-circuits at `1`, so a Survivor / unset run — and every existing direct caller — debits exactly as
 * before (byte-identical). Harder modes let the world eat the stock faster.
 */
export function contestRegion(region: RegionState, hours: number, contest = 1): RegionState {
  // A picked-clean region has nothing left to lose, so its clock HOLDS rather than accruing (T74).
  if (region.loot <= 0) return region;
  // T74: this is the same remainder-discard the sites T74 enumerated had. `trunc(hours * activity / 50)`
  // was 0 on an ordinary 2-hour turn for FOUR of the six shipped regions (downtown 10, mercy-hospital 15,
  // ironworks 20, hillcrest 45) and for five of six on a 1-hour turn — so "a region you leave unsearched
  // gets thinner" simply did not happen during play, only across a fast-forward. Bank the pressure-hours
  // (activity x hours) exactly as the weather drains do, and one point falls due every DIVISOR of them.
  // The T56 scarcity dial rides the PERIOD, not the point count: scaling `banked.steps` per tick would
  // re-truncate every tick and break the very chunking-invariance this is here to buy (measured: Story
  // 0.6 at activity 10 still lost NOTHING on ordinary turns). A harsher contest shortens the period,
  // which is exact for any chunking. `contest === 1` short-circuits to the unchanged divisor, so a
  // Survivor / unset run and every existing direct caller debit exactly as before.
  const per = contest === 1 ? LOOT_CONTEST_DIVISOR : Math.max(1, Math.round(LOOT_CONTEST_DIVISOR / contest));
  const banked = bankHours(
    region.lootContestHours,
    Math.max(0, Math.trunc(hours)) * Math.max(0, Math.trunc(region.survivorActivity)),
    per,
  );
  const clockMoved = banked.rest !== (region.lootContestHours ?? 0);
  const drop = banked.steps;
  if (drop <= 0) return clockMoved ? { ...region, lootContestHours: banked.rest } : region;
  return { ...region, loot: clampPct(region.loot - drop), lootContestHours: banked.rest };
}

/**
 * The body of pipeline stage 7 (`updateRegion`) for the loot contest: every region loses a little
 * loot to off-screen rivals as the turn's hours pass. Returns the same state reference when nothing
 * changed (a zero-hour turn, or all regions already thinned), keeping the M0 empty turn inert.
 */
export function updateRegionContest(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  // Scarcity dial (T56): scale off-screen rivals' draw-down by difficulty. Survivor / unset ⇒ 1 ⇒ the exact
  // prior contest (byte-identical); harder modes eat the stock faster, Story slower.
  const contest = profileOf(state).lootContest;
  let changed = false;
  const regions: Record<string, RegionState> = {};
  for (const [id, region] of Object.entries(state.regions)) {
    const next = contestRegion(region, h, contest);
    if (next !== region) changed = true;
    regions[id] = next;
  }
  return changed ? { ...state, regions } : state;
}
