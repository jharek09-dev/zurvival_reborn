/**
 * Room slots — what a building can hold, and what stripping it is worth (M5 task T85 · FR-SHL-04 ·
 * GDD Part XI "the base is a set of choices, not a checklist").
 *
 * ## What the measurement actually found, because it is the opposite of the brief
 *
 * The T85 brief says the base "is finished on day three and has no decisions in it", and asks for
 * slots so that garden-or-cistern becomes a real choice. Measured on the pre-T85 tree
 * (`measure/t85.ts --settle`, 40 runs) the base is not finished on day three — **it is never
 * started**:
 *
 * ```
 *   goal-directed settler (walk to the nearest safehouse, search it clean, claim, build everything)
 *     claimed a base              39 of 40 runs, mean day 1.6
 *     rooms standing at the end    0.00  (max 0)   <- ZERO of the seven rooms, in 40 runs
 *     item.scrap found per run     0.65            <- the cheapest room costs 3
 *     item.tools found per run     0.00            <- 0% of runs; tools drop only in `industrial`
 * ```
 *
 * An *undirected* bot claims a base in **0 of 40** (T83's `claimable`: 14 of 60 nodes, and not the
 * start node). So slots alone would have constrained an empty set — the classic "a fix that is not
 * measured is a guess" (T76). The deadlock underneath is exact and worth naming: **`job.salvage`
 * produces `item.scrap` and is gated behind `room.workshop`, which costs 3 scrap and an `item.tools`
 * that drops only where the player does not go.** The job that makes the resource is locked behind a
 * room that costs it.
 *
 * That is why this module ships **two** things and not one:
 *
 *   1. {@link roomSlotsOf} — a building holds a bounded number of rooms, so installing one is a
 *      choice against the others. The brief's ask.
 *   2. {@link claimSalvage} — **claiming a building you have stripped to `searchPct` 100 hands you
 *      its materials.** The entry fee, paid by work the player has already done. Without it (1)
 *      binds on nothing, because nothing is ever built.
 *
 * ## The gate
 *
 * Everything here is dark unless the content set authors {@link NodeDef.roomSlots} somewhere
 * ({@link roomSlotsAuthored}) — exactly the discipline T83 used for `claimable` and T84 for
 * `richness`. A set that says nothing about slots gets the unbounded array it always had and the
 * claim that grants nothing, so **every fixture and every pre-T85 run is untouched**. That is a
 * claim about the gate, and the tests hold it.
 *
 * Salvage is scaled by T84's authored {@link NodeDef.richness} rather than a second authored axis:
 * the same number that says how deep a building's stock is says how much is left in its walls. So
 * *which building you claimed* now carries three things at once — how many rooms it holds, what its
 * local loot table is, and what stripping it paid.
 *
 * Pure, deterministic, integer-only (ADR-0001). No clock, no RNG. **No save rung**: slots are read
 * off the graph and never mirrored into `NodeState` (the T79 derive-don't-store precedent that T84
 * followed for richness), and the salvage is ordinary inventory.
 */

import type { GameState, ContentId, NodeId } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { richnessAuthored, richnessOf, DEFAULT_RICHNESS } from "./loot.js";

/** A node that authors no {@link NodeDef.roomSlots} holds this many rooms once the system is active. */
export const ROOM_SLOTS_DEFAULT = 3;
/** Authored slots are clamped into this band on read: every base holds at least one room, none holds all seven. */
export const ROOM_SLOTS_MIN = 1;
export const ROOM_SLOTS_MAX = 6;

/**
 * Scrap a claim yields at an ordinary ({@link DEFAULT_RICHNESS}) building, before the richness scale.
 *
 * Chosen against the one number that matters: **the cheapest room costs 3 scrap**, and a settler run
 * finds 0.65. At 4, an ordinary claim buys exactly one room and leaves change; a stripped building
 * (richness 40) buys none on its own; a rich one (richness 200) buys two. So the first real decision
 * of the base layer arrives on the turn the base does. Swept in `measure/t85.ts --salvage`.
 */
export const CLAIM_SALVAGE_BASE = 4;
/** What a claim pays out in. Same item the fortify loop and half the rooms already spend. */
export const CLAIM_SALVAGE_ITEM = "item.scrap";

/** Fraction (as a percent) of a room's scrap cost that demolishing it returns — half, rounded down. */
export const DEMOLISH_RECOVERY_PCT = 50;
/** Hours it takes to pull a room back out of a building. Non-zero like every resolved verb (FR-CORE-03/04). */
export const DEMOLISH_COST = 2;

/**
 * Whether this content set authors {@link NodeDef.roomSlots} anywhere — the **active-system gate** for
 * the whole T85 layer (slots, the claim salvage, and the demolish verb).
 *
 * A scan of the already-indexed node defs, called on the paths that would otherwise change behaviour.
 * Cheap, and it is the reason a fixture that says nothing about slots still appends rooms to an
 * unbounded array and still claims for nothing.
 */
export function roomSlotsAuthored(graph: RegionGraph | undefined): boolean {
  if (graph === undefined) return false;
  for (const def of Object.values(graph.nodes)) {
    if (typeof def.roomSlots === "number") return true;
  }
  return false;
}

/** A node def's room slots, clamped; {@link ROOM_SLOTS_DEFAULT} when absent or not a number. */
export function roomSlotsOf(graph: RegionGraph | undefined, nodeId: NodeId): number {
  const s = graph?.nodes[nodeId]?.roomSlots;
  if (typeof s !== "number" || Number.isNaN(s)) return ROOM_SLOTS_DEFAULT;
  return Math.max(ROOM_SLOTS_MIN, Math.min(ROOM_SLOTS_MAX, Math.trunc(s)));
}

/** The rooms standing at the player's shelter (empty off a shelter) — the one reader of `NodeState.rooms` here. */
export function roomsAtShelter(state: GameState): readonly ContentId[] {
  const id = state.player.shelterId;
  return id !== null ? state.nodes[id]?.rooms ?? [] : [];
}

/**
 * Free room slots at the player's base. `Infinity` when the system is dark (an unauthored set keeps the
 * unbounded array), and 0 off a shelter — you cannot install a room into a building you do not hold.
 */
export function freeRoomSlots(state: GameState, graph: RegionGraph | undefined): number {
  if (!roomSlotsAuthored(graph)) return Infinity;
  const id = state.player.shelterId;
  if (id === null) return 0;
  return Math.max(0, roomSlotsOf(graph, id) - roomsAtShelter(state).length);
}

/** Is there room in the building for one more room? True when the system is dark. */
export function roomSlotFree(state: GameState, graph: RegionGraph | undefined): boolean {
  return freeRoomSlots(state, graph) > 0;
}

/**
 * The scrap a claim pays out at `nodeId`: `trunc(CLAIM_SALVAGE_BASE * richness / 100)`, **0 when the
 * T85 gate is closed**.
 *
 * Integer-only and deliberately truncating: a building at richness 24 or below pays nothing at all,
 * which is the right answer for a place that has already been picked to the walls. Reads T84's
 * richness through T84's own gate, so a set that authors slots but not richness pays the flat
 * {@link CLAIM_SALVAGE_BASE} rather than silently paying zero.
 */
export function claimSalvage(graph: RegionGraph | undefined, nodeId: NodeId): number {
  if (!roomSlotsAuthored(graph)) return 0;
  const r = richnessAuthored(graph) ? richnessOf(graph, nodeId) : DEFAULT_RICHNESS;
  return Math.max(0, Math.trunc((CLAIM_SALVAGE_BASE * r) / 100));
}
