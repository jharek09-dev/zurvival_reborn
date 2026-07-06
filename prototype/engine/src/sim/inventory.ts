/**
 * Weight-limited inventory — the pack that forces a leave-behind (M1 task T18 · FR-PLR-03 · GDD V).
 *
 * The T17 loot economy made loot finite; this makes *carrying* it finite too, and only then does
 * scavenging bite. The pack has a weight budget (`CARRY_CAPACITY`); every item weighs something
 * (`ITEM_WEIGHTS`); and once the budget is full a search that turns up more than fits forces a real
 * choice — drop what you already carry, or leave the new find in the world. This is where the two
 * finite systems meet: a full pack **stops draining the region** (the caller only debits loot for
 * what was actually pocketed), so scavenging is self-limiting rather than a vacuum.
 *
 * Carry weight is *derived* from `player.inventory`, never stored — so there is no new state and no
 * `SAVE_SCHEMA_VERSION` bump. Item weights are engine constants for M1 (a bridge until the item
 * content set lands in M2, exactly as the T17 loot-table item ids are today). Pure, deterministic,
 * dependency-free, integer-only (ADR-0001). No clock, no RNG.
 */

import type { InventoryEntry } from "../state/types.js";

/** The pack's weight budget, in the same integer units as {@link ITEM_WEIGHTS}. */
export const CARRY_CAPACITY = 40;

/** Weight of an item id with no explicit entry — a sane middleweight default. */
export const DEFAULT_ITEM_WEIGHT = 2;

/**
 * Weight of one unit of each item the M1 loot tables (T17) can emit. Small integers so a fresh run
 * scavenges freely but a full sweep of a rich node forces a drop: light consumables 1, food/water 3,
 * bulky gear 6, a firearm 8.
 */
export const ITEM_WEIGHTS: { readonly [type: string]: number } = {
  "item.bandage": 1,
  "item.painkillers": 1,
  "item.antiseptic": 1,
  "item.antibiotics": 1,
  "item.ammo": 1,
  "item.lighter": 1,
  "item.batteries": 1,
  "item.scrap": 2,
  "item.canned-food": 3,
  "item.water": 3,
  "item.blanket": 6,
  "item.tools": 6,
  "item.fuel": 6,
  "item.pistol": 8,
};

/** Weight of one unit of `type` (unknown ids fall back to {@link DEFAULT_ITEM_WEIGHT}). */
export function itemWeight(type: string): number {
  const w = ITEM_WEIGHTS[type];
  return w === undefined ? DEFAULT_ITEM_WEIGHT : w;
}

/** Total weight the pack is carrying: summed `quantity × unit weight`. Pure. */
export function inventoryWeight(inventory: readonly InventoryEntry[]): number {
  let total = 0;
  for (const e of inventory) total += Math.max(0, Math.trunc(e.quantity)) * itemWeight(e.type);
  return total;
}

/** How much more weight the pack can take before it is full (never negative). */
export function remainingCapacity(inventory: readonly InventoryEntry[]): number {
  return Math.max(0, CARRY_CAPACITY - inventoryWeight(inventory));
}

/** True when one more unit of `type` would fit within {@link CARRY_CAPACITY}. */
export function fits(inventory: readonly InventoryEntry[], type: string): boolean {
  return inventoryWeight(inventory) + itemWeight(type) <= CARRY_CAPACITY;
}

/** Result of a bounded add: the (possibly unchanged) inventory and whether the item was carried. */
export interface AddResult {
  readonly inventory: readonly InventoryEntry[];
  /** false ⇒ the item did not fit and was left where it was found (inventory unchanged). */
  readonly carried: boolean;
}

/**
 * Add one unit of `type` to the pack **only if it fits** within {@link CARRY_CAPACITY}, stacking onto
 * an existing same-type (non-unique) entry. When it does not fit the inventory is returned unchanged
 * with `carried: false` — the caller then leaves the find in the world (and does not debit the loot
 * economy for it). Pure; the weight invariant (`inventoryWeight <= CARRY_CAPACITY`) is preserved.
 */
export function addItemBounded(inventory: readonly InventoryEntry[], type: string): AddResult {
  if (!fits(inventory, type)) return { inventory, carried: false };
  const idx = inventory.findIndex((e) => e.type === type && e.itemId === undefined);
  const next =
    idx === -1
      ? [...inventory, { type, quantity: 1 }]
      : inventory.map((e, i) => (i === idx ? { ...e, quantity: e.quantity + 1 } : e));
  return { inventory: next, carried: true };
}

/**
 * Remove one unit of a carried, non-unique `type` — the leave-behind lever that reclaims weight so
 * the next find can fit. Decrements the stack (dropping the entry entirely at the last unit). Returns
 * the same reference when there is nothing of that type to drop, so a drop on an empty pack is inert.
 * Pure.
 */
export function dropItem(inventory: readonly InventoryEntry[], type: string): readonly InventoryEntry[] {
  const idx = inventory.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return inventory;
  const entry = inventory[idx]!;
  if (entry.quantity <= 1) return inventory.filter((_, i) => i !== idx);
  return inventory.map((e, i) => (i === idx ? { ...e, quantity: e.quantity - 1 } : e));
}
