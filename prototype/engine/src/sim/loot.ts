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

import type { GameState, NodeId, RegionState } from "../state/types.js";
import { drawInt, drawPick } from "../rng/streams.js";
import { addItemBounded } from "./inventory.js";

/** Rivals draw a region down by `trunc(hours * survivorActivity / DIVISOR)` each turn. */
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

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * The item pool for a node kind, falling back to the generic table for an unknown/absent kind. With
 * `includeRadio` (only when the radio system is active), the scavenged radio is appended to the
 * store/residential/industrial tables so it becomes findable — additively, never in a radio-less run.
 */
export function lootTableFor(kind: string | undefined, includeRadio = false): readonly string[] {
  const base = (kind !== undefined && LOOT_TABLES[kind]) || LOOT_TABLES["generic"]!;
  return includeRadio && kind !== undefined && RADIO_LOOT_KINDS.has(kind) ? [...base, RADIO_LOOT_ITEM] : base;
}

/**
 * The most loot (in region points) a single search can pull, given the region's remaining richness
 * and how picked-over the node already is. Diminishing on both axes; never more than what remains.
 * 0 ⇒ a thin region or an exhausted node yields nothing but time and noise (FR-ECO-03 partial).
 */
export function searchYieldCap(regionLoot: number, searchPct: number): number {
  const cap = Math.trunc(regionLoot / 8) - Math.trunc(searchPct / 34);
  return Math.max(0, Math.min(regionLoot, cap));
}

/**
 * Resolve the loot half of a search at `nodeId` (called by stage 3 after searchPct advances). Draws
 * a yield against the region's remaining stock and the node's search progress, **debits** the region
 * by exactly what was taken (finite + depleting), and drops one plausible item into the inventory.
 * A depleted region or a picked-clean node yields nothing. Pure; consumes the `loot` RNG stream.
 */
export function resolveSearchLoot(state: GameState, nodeId: NodeId, kind: string | undefined, includeRadio = false): GameState {
  const node = state.nodes[nodeId];
  if (node === undefined) return state;
  const region = state.regions[node.regionId];
  if (region === undefined || region.loot <= 0) return state;

  const cap = searchYieldCap(region.loot, node.searchPct);
  if (cap <= 0) return state;

  const drawn = drawInt(state.rng, state.meta.seed, "loot", 1, cap);
  const take = Math.min(region.loot, drawn.value);
  const pick = drawPick(drawn.rng, state.meta.seed, "loot", lootTableFor(kind, includeRadio));

  // Weight cap (T18 · FR-PLR-03): pocket the find only if it fits. A full pack leaves it in the
  // world and the region is NOT debited — carrying is finite, so a full pack stops draining the well.
  const { inventory, carried } = addItemBounded(state.player.inventory, pick.value);
  const regions = carried
    ? { ...state.regions, [node.regionId]: { ...region, loot: clampPct(region.loot - take) } }
    : state.regions;

  return {
    ...state,
    rng: pick.rng,
    regions,
    player: { ...state.player, inventory },
  };
}

/** Rivals thin one region by time passed (contest). Loot only ever falls; clamped at 0. Pure. */
export function contestRegion(region: RegionState, hours: number): RegionState {
  const drop = Math.trunc((Math.max(0, Math.trunc(hours)) * region.survivorActivity) / LOOT_CONTEST_DIVISOR);
  if (drop <= 0 || region.loot <= 0) return region;
  return { ...region, loot: clampPct(region.loot - drop) };
}

/**
 * The body of pipeline stage 7 (`updateRegion`) for the loot contest: every region loses a little
 * loot to off-screen rivals as the turn's hours pass. Returns the same state reference when nothing
 * changed (a zero-hour turn, or all regions already thinned), keeping the M0 empty turn inert.
 */
export function updateRegionContest(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  let changed = false;
  const regions: Record<string, RegionState> = {};
  for (const [id, region] of Object.entries(state.regions)) {
    const next = contestRegion(region, h);
    if (next !== region) changed = true;
    regions[id] = next;
  }
  return changed ? { ...state, regions } : state;
}
