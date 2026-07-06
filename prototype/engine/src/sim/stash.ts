/**
 * Shared stash — the base warehouse (M3 task T39 · FR-SHL-03 / FR-PLR-04 · GDD XIII).
 *
 * The shelter (T37/T38) gave the run a place; the stash gives that place a *store*. Until now a run's
 * only holding was the weight-limited pack (T18): every surplus was a thing you had to leave in the world.
 * The stash is a second store kept **at your shelter** that the carry budget does not see — so a run can
 * bank surplus against a lean day — and, because it is a real pile of supplies at a known address, it is
 * the store the contested world can *raid*. That raid is where the first story's teeth land (T40): the
 * survivor you would not share with comes back for what you kept.
 *
 * State: one new field, `Player.stash` (the block's single v6→v7 rung). Deposit/withdraw are **free**
 * (0 hours) base/pack management — exactly like the T18 drop verb — so they change `player` without
 * advancing the clock or the world; the weight budget reads `player.inventory` only, so a stashed item
 * weighs nothing until it is withdrawn. Every function here is inert on an empty stash, so every prior
 * run — none of which have banked anything — is byte-identical.
 *
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). No clock, no RNG.
 */

import type { GameState, HistoryEvent, InventoryEntry } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { fits, itemName } from "./inventory.js";

/** Deposit/withdraw cost no in-game time — organising the base store, mirroring the T18 drop verb. */
export const STASH_MOVE_COST = 0;

// --- small plain-JSON helpers -----------------------------------------------------------------

/** Total item-units in a store (summed quantities of every stack). Pure. */
export function stashUnits(entries: readonly InventoryEntry[]): number {
  let total = 0;
  for (const e of entries) total += Math.max(0, Math.trunc(e.quantity));
  return total;
}

/** Remove one unit of a non-unique `type` from a store (drops the stack at its last unit). Pure. */
function removeOneUnit(entries: readonly InventoryEntry[], type: string): readonly InventoryEntry[] {
  const idx = entries.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return entries;
  const e = entries[idx]!;
  if (e.quantity <= 1) return entries.filter((_, i) => i !== idx);
  return entries.map((x, i) => (i === idx ? { ...x, quantity: x.quantity - 1 } : x));
}

/** Add one unit of a non-unique `type` to a store (stacking onto an existing same-type entry). Pure. */
function addOneUnit(entries: readonly InventoryEntry[], type: string): readonly InventoryEntry[] {
  const idx = entries.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return [...entries, { type, quantity: 1 }];
  return entries.map((x, i) => (i === idx ? { ...x, quantity: x.quantity + 1 } : x));
}

/** The distinct non-unique item types in a store, stable (sorted) order. */
function nonUniqueTypes(entries: readonly InventoryEntry[]): readonly string[] {
  return [...new Set(entries.filter((e) => e.itemId === undefined && e.quantity > 0).map((e) => e.type))].sort();
}

// --- gates ------------------------------------------------------------------------------------

/** The player is standing in the base they claimed — the only place the cache can be reached. */
export function atOwnShelter(state: GameState): boolean {
  const sid = state.player.shelterId;
  return sid !== null && sid === state.player.location;
}

/** Non-unique stacks the player carries and could bank (stable order). Empty away from the base. */
export function depositableTypes(state: GameState): readonly string[] {
  if (!atOwnShelter(state)) return [];
  return nonUniqueTypes(state.player.inventory);
}

/** Non-unique stash stacks that would still fit the pack if withdrawn (stable order). Empty away from base. */
export function withdrawableTypes(state: GameState): readonly string[] {
  if (!atOwnShelter(state)) return [];
  return nonUniqueTypes(state.player.stash).filter((t) => fits(state.player.inventory, t));
}

/** The stash choices offered from the player's current node, in stable order. Empty unless at your base. */
export function stashChoices(state: GameState): readonly SceneChoice[] {
  const choices: SceneChoice[] = [];
  for (const type of depositableTypes(state)) {
    choices.push({
      id: `stash-deposit:${type}`,
      label: `Stash ${itemName(type)}`,
      timeCost: STASH_MOVE_COST,
      action: { type: "stash-deposit", choiceId: `stash-deposit:${type}`, timeCost: STASH_MOVE_COST, params: { item: type } },
    });
  }
  for (const type of withdrawableTypes(state)) {
    choices.push({
      id: `stash-withdraw:${type}`,
      label: `Take ${itemName(type)} from the cache`,
      timeCost: STASH_MOVE_COST,
      action: { type: "stash-withdraw", choiceId: `stash-withdraw:${type}`, timeCost: STASH_MOVE_COST, params: { item: type } },
    });
  }
  return choices;
}

// --- dispatch (pipeline stage 3, from applyPlayerAction) --------------------------------------

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isStashAction(action: Action): boolean {
  return action.type === "stash-deposit" || action.type === "stash-withdraw";
}

/** Deposit one unit of `type` from the pack into the base cache. Inert away from base / with none carried. */
function deposit(state: GameState, type: string): GameState {
  if (!atOwnShelter(state)) return state;
  if (!state.player.inventory.some((e) => e.type === type && e.itemId === undefined && e.quantity > 0)) return state;
  const inventory = removeOneUnit(state.player.inventory, type);
  const stash = addOneUnit(state.player.stash, type);
  return { ...state, player: { ...state.player, inventory, stash } };
}

/** Withdraw one unit of `type` from the cache into the pack, only if it fits. Inert otherwise. */
function withdraw(state: GameState, type: string): GameState {
  if (!atOwnShelter(state)) return state;
  if (!state.player.stash.some((e) => e.type === type && e.itemId === undefined && e.quantity > 0)) return state;
  if (!fits(state.player.inventory, type)) return state;
  const stash = removeOneUnit(state.player.stash, type);
  const inventory = addOneUnit(state.player.inventory, type);
  return { ...state, player: { ...state.player, inventory, stash } };
}

/** Resolve a stash action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. Pure. */
export function resolveStashAction(state: GameState, action: Action): GameState {
  const item = typeof action.params?.["item"] === "string" ? (action.params["item"] as string) : null;
  if (item === null) return state;
  switch (action.type) {
    case "stash-deposit":
      return deposit(state, item);
    case "stash-withdraw":
      return withdraw(state, item);
    default:
      return state;
  }
}

// --- the raid / depletion hook (the contested-world seam, used by T40) -------------------------

/**
 * Take `count` item-units out of the stash — the FR-SHL-03 depletion hook a raid rides. Removes units
 * deterministically in stable type order (heaviest-nothing, just alphabetical for reproducibility) and
 * appends a single `stash.raided` beat to the Living History recording what was taken. Inert when the
 * stash is empty or `count <= 0`, so it never fabricates a change. Pure, integer-only, no RNG.
 */
export interface StashRemoval {
  readonly stash: readonly InventoryEntry[];
  /** Item type → units removed. */
  readonly taken: Record<string, number>;
  readonly removed: number;
}

/**
 * Peel up to `count` item-units off a store in stable type order (alphabetical, for reproducibility),
 * returning the reduced store and a tally of what came off. Pure and history-free — the raid hook
 * {@link depleteStash} wraps it with a Living-History beat; the T40 take-in draw uses it quietly.
 */
export function removeStashUnits(entries: readonly InventoryEntry[], count: number): StashRemoval {
  const want = Math.max(0, Math.trunc(count));
  let stash = entries;
  const taken: Record<string, number> = {};
  let removed = 0;
  while (removed < want && stashUnits(stash) > 0) {
    const type = nonUniqueTypes(stash)[0];
    if (type === undefined) break;
    stash = removeOneUnit(stash, type);
    taken[type] = (taken[type] ?? 0) + 1;
    removed += 1;
  }
  return { stash, taken, removed };
}

export function depleteStash(state: GameState, count: number): GameState {
  const want = Math.max(0, Math.trunc(count));
  if (want === 0 || stashUnits(state.player.stash) === 0) return state;

  const { stash, taken, removed } = removeStashUnits(state.player.stash, want);
  if (removed === 0) return state;

  const event: HistoryEvent = {
    day: state.meta.day,
    hour: state.meta.hour,
    turn: state.meta.turn,
    type: "stash.raided",
    subjects: state.player.shelterId !== null ? [state.player.shelterId] : [],
    data: { taken, units: removed, remaining: stashUnits(stash) },
  };
  return { ...state, player: { ...state.player, stash }, history: [...state.history, event] };
}

// --- narration (composed into shelterLine) ----------------------------------------------------

/**
 * A one-line read of the base cache when the player stands in their shelter — a words-only sense of how
 * stocked it is, never a number (FR-UI-02). Null away from the base. Surfaced through {@link shelterLine}.
 */
export function cacheRead(state: GameState): string | null {
  if (!atOwnShelter(state)) return null;
  const units = stashUnits(state.player.stash);
  if (units === 0) return "The cache here is bare.";
  if (units <= 3) return "A small cache of supplies sits in the corner.";
  if (units <= 8) return "Your cache holds a decent store of supplies.";
  return "Your cache is well stocked.";
}
