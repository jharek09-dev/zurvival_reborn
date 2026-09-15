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
 *
 * **50 -> 120 (M5 task T59 · GDD X rule 4 "loot is finite and contested").** At 50 the city stripped
 * ITSELF, on a wall clock, faster than any run could reach it — measured off the shipped baselines,
 * with the player asleep: the-terraces empty on **day 2.1**, hillcrest **day 2.3**, the start district
 * **day 5.8**, the whole city by **day 17.7**. "The world can beat you to it" had become "the world
 * has already been". Measured with the same instrument on both trees (`measure/t59.ts --scarcity`),
 * the mean cap where the player actually stands runs **4.45 -> 9.15** and a whole run's haul
 * **4.2 -> 9.8 items**. At 120 the same districts last 5.0 / 5.6 / 14.0 days and downtown 42.5, so the
 * race is one the player is in. The contest is not weakened relative to the PLAYER — T59 roughly
 * doubles what a search draws (see {@link searchYieldCap}), so the district's stock now falls mostly
 * to the survivor standing in it, which is the pressure GDD X asks for.
 */
export const LOOT_CONTEST_DIVISOR = 120;

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
  // T59: `item.cloth` joins the generic table. `recipe.purify.filter` — the charcoal-and-cloth bridge
  // from the commoner find (dirty water) to the one that keeps you alive — priced its two components
  // out of DISJOINT node kinds: charcoal in generic/industrial, cloth in store/residential. Measured
  // over 24 pre-T59 runs, the player holds dirty water on **54% of turns** and holds charcoal AND
  // cloth on **1.25 turns a run**, so the bridge was unusable for want of a rag. This is the T85
  // cistern defect exactly ("a settler searches 97.5% generic"), one task later, in the recipe that
  // matters most. Rags are the most universal object in an abandoned city; this is where they were
  // always missing from. Measured pre-T59 (`measure/t59.ts --water`): a settler holds dirty water on
  // 36.1% of its turns and holds charcoal AND cloth together on **0.00** of them; post-T59, 1.42.
  generic: ["item.food-fresh", "item.water-dirty", "item.charcoal", "item.cloth"],
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
  waterLevel?: number,
): readonly Weighted<string>[] {
  const base = lootTableFor(kind, includeRadio, includeEconomy).filter((id) => WEAPONS[id] === undefined);
  // T84: ordinary items are no longer all equals — but their TOTAL is unchanged (`tieredOrdinary`), so
  // the weapon-vs-ordinary odds T81 swept are preserved exactly and only the mix among ordinary finds
  // moves. A kind whose whole table is untiered is still an exactly uniform draw at BASE_LOOT_WEIGHT.
  const entries: Weighted<string>[] = [...tieredOrdinary(base, waterLevel)];
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
  /**
   * **The one row a district scales** (M5 task T59 · GDD XVI "scarcity is the primary difficulty
   * driver" · FR-SIM-08). Written here at {@link WATER_LEVEL_NEUTRAL}'s worth and then multiplied by
   * how much drinkable water the district still has — see {@link itemLootWeight}.
   *
   * Before T59 it was untiered, i.e. {@link BASE_LOOT_WEIGHT} = 18 against `item.water-dirty`'s junk
   * tier of 28, so **the drink you cannot drink came out of a search oftener than the drink you can**
   * — measured over 120 runs across five policies (`measure/t59.ts --scarcity`), dirty water 0.57 a
   * run against clean 0.42, a ratio of 1.36; a settler alone read 0.67 against 0.46 while drinking
   * 1.92. T84 wrote that by accident: it tiered the junk and left water sitting at the base weight.
   *
   * **48 is swept, not chosen** (`measure/t59.ts --water`, five bot policies x 24 runs each), as the
   * share of a run's turns spent holding an empty canteen:
   *
   * |        | settler | forager | medic |
   * | ------ | ------- | ------- | ----- |
   * | **18** (pre-T59) | 30.0% | 39.4% | 32.4% |
   * | 36     | 17%     | 24%     |  8%   |
   * | **48** | **13.3%** | **19.7%** | **6.4%** |
   * | 60     | 10%     | 18%     |  5%   |
   *
   * 48 is where the death mix finally SPREADS — `starved` fires for the first time in the project's
   * measured history — while a run still spends a fifth of itself dry. At 60 the curve has flattened
   * and water has stopped being the pressure; GDD XVI rule 1 is "the player is always a little short",
   * so the dial stops at the value where they still are.
   */
  "item.water": 48,
};

// --- water as a property of PLACE (M5 task T59) -----------------------------------------------

/**
 * The one loot row a district's own water level scales — the *drinkable* half of the pair.
 *
 * `item.water-dirty` is deliberately NOT scaled. There is always a puddle, a toilet cistern, a
 * rain-butt; what a district's mains and wells decide is how much of its water you can drink without
 * boiling it. That asymmetry is the whole design: dirty water is universal, clean water is a place,
 * and `recipe.purify.*` is the bridge between them (which is why T59 also took those two recipes off
 * the workbench — see `sim/economy.ts#craftable`).
 */
export const CLEAN_WATER_ITEM = "item.water";

/**
 * The district water level at which {@link CLEAN_WATER_ITEM}'s weight is exactly what
 * {@link ITEM_LOOT_WEIGHT} states. Above it a district is wetter than the city's average, below it
 * drier. 50 is the midpoint of the 0-100 band the region baselines are authored in, and the six
 * shipped districts sit either side of it: downtown 10, rivermouth 20, mercy-hospital 30,
 * the-terraces 45, ironworks 55, hillcrest 80.
 */
export const WATER_LEVEL_NEUTRAL = 50;

/**
 * The `RegionState.water` a region that authors none is seeded with — {@link WATER_LEVEL_NEUTRAL}, i.e.
 * an ordinary district (M5 task T59).
 *
 * It defaulted to 0 from T3 until this task, which was harmless while nothing read the field and became
 * a silent statement the moment something did: without this, every fixture and every content set that
 * says nothing about water would be declaring itself a desert. Same spirit as {@link DEFAULT_RICHNESS}
 * — an unauthored thing is an ordinary thing, never the worst possible thing. All six shipped districts
 * author `baseline.water`, so the live city is untouched by this default.
 */
export const DEFAULT_REGION_WATER = WATER_LEVEL_NEUTRAL;

/**
 * Points of a district's drinkable-water stock one clean unit costs.
 *
 * Water is now **finite and contested exactly as loot is** (GDD X rule 4) — this is the debit that
 * makes it so, and it is the reason `RegionState.water` is a stock rather than a flag. The six shipped
 * districts hold **240 points** between them, which at 4 points a unit is **58 drinkable units** once
 * each district's floor is taken (`measure/t59.ts --water` prints the table) — about 66 player-days of
 * water if none of it is lost to a companion or to the mains failing. Drinking a district dry does not
 * take it to nothing: {@link itemLootWeight}'s floor leaves a 1-in-N trickle, which is a forgotten
 * bottle rather than a well, and is what keeps the table's SHAPE fixed. Swept — see
 * `docs/qa/QA_REVIEW_T59.md`.
 */
export const WATER_POINTS_PER_UNIT = 4;

/**
 * How much drinkable water a district still offers: **its own table, throttled by the city's mains.**
 *
 * `RegionState.water` and `world.water` have both existed since T3 and, until this task, **neither
 * had a single reader anywhere in the engine** — the 2026-09 design review's dead-wiring list missed
 * them, and FR-SIM-08 ("global infrastructure decay: power, water, roads, bridges") was therefore
 * two-thirds implemented: the grid drains, the roads wear, and the water simply sat there. The city
 * had authored where its water is (downtown 10 ... hillcrest 80) and nothing had ever asked.
 *
 * `world.water` is now drained alongside `world.powerGrid` by the weather tick (`sim/weather.ts`) —
 * the pumps stop when the power does — so the clean-water supply tightens across a run rather than
 * across a single search, which is the scarcity curve GDD XVI asks for and the loot stock alone cannot
 * give. No new state and no save rung: both fields were already in the shape.
 *
 * Defensive against a hand-edited save: both terms go through {@link waterPct}, which is total — a NaN,
 * an infinity or a negative degrades to 0 rather than propagating. `clampPct`, the module's existing
 * clamp, is NOT total (`Math.trunc(NaN)` is NaN and every comparison against it is false), and the
 * first cut of this function used it; T59's own test caught the hole, which is the third NaN-into-the-
 * save finding in three tasks (T83, T84, here) and the reason this one is spelled out.
 */
export function drinkableWaterOf(
  region: { readonly water: number },
  world: { readonly water: number } | undefined,
): number {
  const mains = world === undefined ? 100 : waterPct(world.water);
  return waterPct(Math.trunc((waterPct(region.water) * mains) / 100));
}

/** {@link clampPct}, made total: anything that is not a finite number reads as 0. */
function waterPct(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.trunc(n))) : 0;
}

/**
 * The weight one ordinary item draws at BEFORE normalisation; {@link BASE_LOOT_WEIGHT} if untiered.
 *
 * `waterLevel` (T59) scales {@link CLEAN_WATER_ITEM} **and no other row**; its absence is the plain
 * table lookup.
 *
 * **It is NOT "the exact pre-T59 lookup", and an audit was right to object to a first draft that said
 * so.** T59 also added `item.water` to {@link ITEM_LOOT_WEIGHT} at 48, where it previously fell
 * through to {@link BASE_LOOT_WEIGHT}'s 18 — so a no-level caller reads 48 now and read 18 before,
 * deliberately, and every table that contains water moved with it. T59 is a BALANCE PASS: it changes
 * what runs do, by design, and the only thing the optional parameter buys is that a caller with no
 * district in hand is not silently handed some other district's weather. Nothing here is byte-
 * identical and nothing claims to be.
 *
 * A floor of 1 keeps the row drawable in a bone-dry district: somebody always left a bottle in a
 * drawer, and a table row that vanishes would change the table's SHAPE rather than its odds (the
 * `floor(f*len)` hazard). Unlike the first cut's, this floor is reachable — at level 0 it is what
 * decides the weight.
 */
export function itemLootWeight(id: string, waterLevel?: number): number {
  const w = ITEM_LOOT_WEIGHT[id];
  const base = w === undefined ? BASE_LOOT_WEIGHT : w;
  if (waterLevel === undefined || id !== CLEAN_WATER_ITEM) return base;
  // **Linear in the district's level, and it really does reach the floor.** A first cut used a
  // compressed spread — `(NEUTRAL + level) / 2*NEUTRAL`, running x0.5 to x1.5 — so that the start
  // district would not read drier than it did before T59. An adversarial audit killed it with one
  // measurement: at x0.5 a bone-dry district in a dead city still weighted this row **24**, ABOVE the
  // pre-T59 flat 18, and 200 searches at `region.water = 0` and `world.water = 0` pulled **147 clean
  // units out of a stock the engine said was empty**. The district's water was decorative, the "and no
  // more" in {@link WATER_POINTS_PER_UNIT} was false, and the `Math.max(1, …)` below could never
  // engage — the exact dead-guard pattern `unitsForPoints` documents three screens down.
  //
  // Linear fixes all three at once, and the number that made the compressed form tempting survives
  // anyway: at {@link ITEM_LOOT_WEIGHT}'s 48 the START district (rivermouth, water 20) comes out at
  // **19 against the pre-T59 18**. T59 does not make the opening drier. It makes the rest of the city
  // wetter — hillcrest 76, ironworks 52 — and lets a district you have drunk dry fall to a 1-in-N
  // trickle, which is a bottle in a drawer rather than a well.
  return Math.max(1, Math.trunc((base * waterPct(waterLevel)) / WATER_LEVEL_NEUTRAL));
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
export function tieredOrdinary(ids: readonly string[], waterLevel?: number): readonly Weighted<string>[] {
  const n = ids.length;
  if (n === 0) return [];
  const raw = ids.map((id) => itemLootWeight(id, waterLevel));
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
  // **800 -> 400 and 34 -> 17 (M5 task T59).** The first halves the denominator, so a district's stock
  // buys twice the cap; the second tracks {@link SEARCH_GAIN}'s 34 -> 17, so the penalty is **one point
  // per SEARCH** in both trees — which is the property worth keeping, and is not the same as "one point
  // per third of the node" (an audit caught a first draft saying that: at searchPct 34, a third of the
  // way through, the penalty is now 2). Relative to the doubled base the curve is the shape it always
  // was, with one exception worth stating: a fully stripped node pays 5 where exact doubling of the old
  // 2 would be 4, so the last search of a node is slightly leaner than it used to be. Measured pre-T59 where the player was actually
  // STANDING, over 120 runs across five policies: the cap averaged **4.45** and a search returned
  // **1.20 items**, so a WHOLE RUN produced **4.2 items** — out of which the two-component recipes
  // (`recipe.purify.filter`, every `recipe.shelter.*`) simply cannot be assembled: a settler searching
  // the generic table held `item.charcoal` and `item.cloth` at the same time on **0.00 turns a run**.
  // After T59 the mean cap is 9.15, a search returns 1.58 and a run produces 9.8. The pair is set
  // together: doubling the cap without also slowing the contest (see {@link LOOT_CONTEST_DIVISOR})
  // would have emptied the city twice as fast.
  const cap = Math.trunc((regionLoot * richness) / 400) - Math.trunc(searchPct / 17);
  // The `Math.min(regionLoot, …)` is the pre-T84 clamp, kept — and it is worth being exact about what
  // it does now, because a mutation run removed it and nothing failed. It is **unreachable at today's
  // ceiling**: `cap <= trunc(loot * RICHNESS_MAX / 400) = trunc(0.625 * loot) <= loot` for every
  // non-negative loot, so the arithmetic already guarantees what the clamp asserts. It is a backstop
  // tied to {@link RICHNESS_MAX}, and T59's halving of the denominator moved the point at which it
  // starts binding from a ceiling above 800 to one above 400 — closer, and still out of reach.
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
 *
 * ### 3 -> 2 (M5 task T59), and the pressure it is set against
 *
 * An audit rightly objected that a first cut moved this silently, hiding behind T84's sweep while
 * halving it. The reason is the same one that moved {@link searchYieldCap}'s denominator: a whole
 * pre-T59 run produced **4.2 items**, out of which no two-component recipe in the game can be
 * assembled. The two dials are set together and are worth 9.6 items a run between them.
 *
 * The counter-pressure T84 names is the pack, and T59 measures it rather than assuming: `measure/t59.ts
 * --scarcity` reports peak load and the share of turns at or above `PACK_HEAVY`, on both trees. **It
 * bites now, and it did not before.** Share of a run's turns at or over `PACK_HEAVY`, pre -> post:
 * settler 0.9% -> 38.9%, forager 0.0% -> 26.6%, medic 6.1% -> 61.1%; peak load 22.0 -> 33.3 against a
 * `CARRY_CAPACITY` of 40. T84 shipped the haul and declared honestly that the leave-behind CHOICE was
 * not yet forced; this is the pass that forces it, and it is the one place where T59 made the game
 * harder rather than kinder.
 */
export const LOOT_POINTS_PER_ITEM = 2;

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
  if (rawCap <= 0) return empty(state);

  const drawn = drawInt(state.rng, state.meta.seed, "loot", 1, rawCap);
  const offered = Math.min(region.loot, drawn.value);
  /**
   * **Scarcity YIELD dial** (T56, re-sited by T60 · closes PL-M4-54).
   *
   * T56 spent this dial on the yield CAP, where it could only deny a search that was already nearly
   * empty-handed. Measured across 120 runs, that was worth **0.1 turns** at Nightmare's 0.6 against an
   * identity control — a dial the player cannot feel is a difficulty mode that does not exist, and
   * three of the five dials measured that way. The cap gate could not have worked: the draw is
   * `1..rawCap` and `rawCap` is large wherever there is anything to find, so `scaleInt(rawCap, 0.6)`
   * lands at zero only on a node that was about to give nothing anyway.
   *
   * It now scales the POINTS -> ITEMS conversion, which is the sentence the dial's name has always
   * claimed: the same rummage through the same district comes away with less. Nothing else moves —
   *
   * - the **draw** is untouched (`1..rawCap`, one stream step), so the district still offers what it
   *   always offered and only the haul changes;
   * - the **debit** below still charges the full `offered` for a complete haul, so how fast the world
   *   drains stays owned by `lootContest`, exactly as before. The two scarcity dials keep separate
   *   jobs: this one is what YOU get, that one is what the WORLD takes;
   * - the loot TABLE is never touched, so the `floor(f·len)` pick hazard (T50) cannot arise;
   * - `scaleInt` short-circuits at 1, so Survivor / unset is `unitsForPoints(offered)` unchanged and a
   *   baseline run draws and hauls bit-for-bit as before.
   *
   * The dial scales the **points**, not the units, and that is measured rather than taste. Units are a
   * small integer whose modal value is 1, and a multiplicative dial on a small integer is a switch, not
   * a dial: truncating one unit by 0.8 and by 0.6 both give NOTHING, so the first 20% of tightening
   * cost 3.3 items a run and the next 20% cost 1.5. Rounding instead of truncating fixes that end and
   * breaks the other — a one-unit haul then survives every multiplier down to 0.5, so 0.6 and 0.5
   * become the same dial (7.1 vs 7.0 items). Points are the larger number and carry the fraction:
   * scaled there, the haul runs **9.5 / 7.0 / 6.0 / 5.5** items a run at 1.0 / 0.8 / 0.6 / 0.5 —
   * monotone across the whole range, with no cliff at either end. (Rebuild sweep: the dial is edited
   * and the tree re-run, so `measure/t60.ts` cannot print it. What it does show is that the dial buys
   * items, not turns: survival sits at 49.4 turns against a 51.5 control at every setting below 1,
   * because after T59 a run is bounded by water rather than by what is in the pack.)
   *
   * A scaled-to-zero haul is a search that found nothing: the stream has still advanced its one step
   * (so the next search is a different draw, not the same one forever), and the district is debited
   * nothing, because nothing left it — the same rule the full-pack branch follows.
   */
  const units = unitsForPoints(scaleInt(offered, profileOf(state).lootYield));

  // T59: how much of this district's water you can drink without boiling it. Scales exactly one row of
  // the weighted table and is passed only on the weighted (weapon-pool) path — the untouched uniform
  // `drawPick` path below has no weights to scale, so a pool-less run is unaffected by this task too.
  const waterLevel = drinkableWaterOf(region, state.world);
  const entries = includeWeapons ? lootEntriesFor(kind, includeRadio, includeEconomy, waterLevel) : undefined;
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
  // No clamp is needed and none is pretended: `units <= ceil(offered / P)` (T60 scales it DOWN and
  // never up), so a partial haul has `found.length <= units - 1` and therefore
  // `found.length * P <= P * (units - 1) < offered` always, and `found.length >= 1` on this branch.
  // The first cut wrapped this in `Math.max(1, Math.min(offered, ...))`, two guards an exhaustive probe
  // over `offered` 1..60 showed can never engage — a comment claiming protection that the arithmetic
  // already gives is worse than no comment.
  //
  // `found.length === units` is a COMPLETE haul, scaled or not, and pays the whole `offered`: the
  // district was rummaged either way. That is what keeps `lootYield` out of the depletion rate.
  // T60: `units === 0` is the dial DENYING a haul, and it still costs the district what it offered —
  // the rummage happened, the shelf was turned over, the scaling is about what you could carry away
  // from it. Forgiving it made harder modes drain the world MORE SLOWLY than Survivor: an audit
  // measured Nightmare debiting 10.4% fewer points than Survivor over identical draws, slower in every
  // one of 14 (loot, searchPct) cells, which is backwards for a scarcity mode and contradicts this
  // site's own claim that depletion stays owned by `lootContest`. It is NOT the full-pack rule: there,
  // the goods really did stay in the world.
  const taken = units === 0 ? offered : found.length === 0 ? 0 : found.length === units ? offered : found.length * LOOT_POINTS_PER_ITEM;

  /**
   * T59: every clean unit that left also costs the district {@link WATER_POINTS_PER_UNIT} of its own
   * drinkable stock. Debited from `found`, i.e. from what was actually CARRIED AWAY — the same rule
   * the loot debit follows, and for the same reason: a unit the pack refused never left the district.
   * Dirty water costs nothing, because it was never the scarce thing.
   */
  const waterTaken = found.reduce((n, id) => (id === CLEAN_WATER_ITEM ? n + WATER_POINTS_PER_UNIT : n), 0);
  const regionNext =
    taken > 0 || waterTaken > 0
      ? {
          ...region,
          ...(taken > 0 ? { loot: clampPct(region.loot - taken) } : {}),
          // `waterPct`, not `clampPct`. An audit found the first cut writing `clampPct(NaN)` — which is
          // NaN — straight into the save from a hand-edited `region.water`, where it serialises as
          // `null` and the save no longer loads. That is the third NaN-into-the-save finding in three
          // tasks (T83, T84, T59) and the second in THIS task: the guard was written for the READ and
          // the defect was on the WRITE. If a field can come out of a save, clamp it totally on both.
          ...(waterTaken > 0 ? { water: waterPct(region.water - waterTaken) } : {}),
        }
      : region;

  const next: GameState = {
    ...carried,
    rng,
    ...(regionNext !== region ? { regions: { ...carried.regions, [node.regionId]: regionNext } } : {}),
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
