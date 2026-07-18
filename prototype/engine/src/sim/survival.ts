/**
 * Survival pressure — the loop-feel tuning pass (M1 task T22 · FR-CORE-02 · FR-INJ-04/05 · GDD V/VI).
 *
 * The raw M1 loop moved and could fight, but choosing move/search/rest was frictionless: needs
 * drifted too softly to threaten and a wound cost nothing. This module makes the Survival Triangle
 * actually pull on every turn. Three closed loops:
 *
 *   1. **Needs bite, and can be fed.** Hunger/thirst/fatigue climb every hour (thirst fastest); at
 *      the ceiling you die (starve / dehydrate). Scavenged food and water are the counterplay — `eat`
 *      and `drink` spend an item to buy the needs back down, which is *why* the pack matters.
 *   2. **Wounds decline you while untreated (FR-INJ-04).** Every open wound tires you faster; a
 *      **bite drives an infection** that stages up toward a lethal terminal — the ticking clock the
 *      clinic's meds exist to stop. `treat` spends the right medical item to advance a wound's care
 *      (T16 `treatWound`), halting the decline.
 *   3. **Neglect ends the run.** Maxed hunger/thirst or a terminal infection is a real, avoidable
 *      death, so the moment-to-moment trade — search vs. drink vs. treat vs. push on — has stakes.
 *
 * Stays strictly on the loop (no world reactivity — that's M2). Item ids and wound effect/treatment
 * tables are engine constants for M1 (a bridge until content loads into the engine, as with loot).
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). No clock, no RNG.
 */

import type { GameState, Needs } from "../state/types.js";
import type { Action } from "../pipeline/contract.js";
import { isWounded, treatWound, woundRemainder, worstWound } from "./wounds.js";
import { advanceInfection, hasSuccumbed, stageFatigue } from "./infection.js";
import { profileOf, scaleInt } from "./difficulty.js";

// Infection is now a staged identity (T49 · `sim/infection.ts`). survival.ts keeps owning the needs +
// wound-decline drift and the run-end derivation, and re-exports the infection dials it drives so the
// engine's public surface (and the T22 tests) are unchanged.
export {
  stageFor,
  BITE_INFECT_RATE,
  INFECT_SYMPTOMATIC_AT,
  INFECT_TERMINAL_AT,
} from "./infection.js";

// --- needs drift (per in-game hour) ---------------------------------------------------------

export const HUNGER_RATE = 1;
export const THIRST_RATE = 2; // thirst is the sharpest clock
export const FATIGUE_RATE = 2;
/** Fatigue a single rest recovers (rest is the only thing that lowers fatigue). */
export const REST_RECOVERY = 45;
/** A need at this value is fatal — starvation / dehydration ends the run. */
export const NEED_FATAL = 100;

// --- consumables ----------------------------------------------------------------------------

export const FOOD_ITEM = "item.canned-food";
export const WATER_ITEM = "item.water";
export const EAT_COST = 1;
export const DRINK_COST = 1;
export const TREAT_COST = 2;
export const EAT_RELIEF = 45;
export const DRINK_RELIEF = 55;
/**
 * Perishable and spoiled food are eatable too (M4 task T51 · FR-ECO-04/05) — fresh food is *better* food
 * (a reason to eat it before it rots), spoiled food a thin, desperate meal (what a rotted ration is worth).
 * Only canned food exists in a pre-economy run, so `eat` is byte-identical there. Fresh/spoiled enter play
 * only via economy-active loot / the spoilage tick, so these branches never fire on a prior golden run.
 */
export const FRESH_EAT_RELIEF = 60;
export const SPOILED_EAT_RELIEF = 20;
/** Hunger relief per food id (canned stays {@link EAT_RELIEF} — the byte-identity anchor). */
const FOOD_RELIEF: { readonly [item: string]: number } = {
  [FOOD_ITEM]: EAT_RELIEF,
  "item.food-fresh": FRESH_EAT_RELIEF,
  "item.food-spoiled": SPOILED_EAT_RELIEF,
};
/** What `eat` reaches for, in order: fresh first (before it rots), then a shelf-stable can, then the spoiled last resort. */
const FOOD_PRIORITY: readonly string[] = ["item.food-fresh", FOOD_ITEM, "item.food-spoiled"];
/** Care a matching medical item applies to a wound; a generic item applies the lesser amount. */
export const TREAT_CARE = 25;
export const TREAT_CARE_GENERIC = 10;
/** A need must be at least this pressing before its eat/drink option is surfaced (avoids clutter). */
export const RELIEF_OFFER_AT = 34;

// --- wound effects (bridge: type id → effect / who treats it, mirroring content/wounds/) -----

export type WoundEffect = "bleed" | "slow" | "weaken" | "infect-risk";

export const WOUND_EFFECTS: { readonly [type: string]: WoundEffect } = {
  "wound.bite": "infect-risk",
  "wound.laceration": "bleed",
  "wound.sprain": "slow",
  "wound.fracture": "weaken",
};

export const WOUND_TREATED_BY: { readonly [type: string]: readonly string[] } = {
  "wound.bite": ["item.antiseptic", "item.antibiotics"],
  "wound.laceration": ["item.bandage", "item.suture-kit"],
  "wound.sprain": ["item.splint"],
  "wound.fracture": ["item.splint"],
};

/** Any item usable as generic first aid when no wound-specific item is carried. */
export const MED_ITEMS: readonly string[] = [
  "item.bandage",
  "item.antiseptic",
  "item.antibiotics",
  "item.painkillers",
  "item.suture-kit",
  "item.splint",
];

/** Extra fatigue per open wound per hour — being hurt wears you down faster. */
export const WOUND_FATIGUE_PER_WOUND = 1;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));
const hoursOf = (action: Action): number => Math.max(0, Math.trunc(action.timeCost ?? 0));
const carries = (state: GameState, type: string): boolean =>
  state.player.inventory.some((e) => e.type === type && e.quantity > 0);

/** Remove one unit of a carried item (consume). Same accounting as a drop; returns new inventory. */
function consume(state: GameState, type: string): GameState["player"]["inventory"] {
  const idx = state.player.inventory.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return state.player.inventory;
  const entry = state.player.inventory[idx]!;
  if (entry.quantity <= 1) return state.player.inventory.filter((_, i) => i !== idx);
  return state.player.inventory.map((e, i) => (i === idx ? { ...e, quantity: e.quantity - 1 } : e));
}

// --- needs drift + wound decline (pipeline stage 4) -----------------------------------------

/**
 * Drift needs by the hours spent; rest recovers fatigue instead of adding it. Pure.
 *
 * `drift` is the difficulty survivability dial (T56): it scales how fast hunger/thirst/fatigue *climb*
 * (rest recovery is unscaled — recovery is the counterplay, not the clock). It defaults to `1`, and
 * {@link scaleInt} short-circuits at `1`, so a Survivor / unset run — and every existing direct caller —
 * computes the identical integers with no multiply in the path (byte-identical to before T56).
 */
export function driftNeeds(needs: Needs, isRest: boolean, hours: number, drift = 1): Needs {
  if (hours === 0) return needs;
  return {
    hunger: clampPct(needs.hunger + scaleInt(HUNGER_RATE * hours, drift)),
    thirst: clampPct(needs.thirst + scaleInt(THIRST_RATE * hours, drift)),
    fatigue: isRest
      ? clampPct(needs.fatigue - REST_RECOVERY)
      : clampPct(needs.fatigue + scaleInt(FATIGUE_RATE * hours, drift)),
  };
}

/**
 * Stage-4 condition update: drift needs by the action's hours, then apply every open wound's decline
 * — extra fatigue per wound, an untreated bite driving the **staged** infection (T49), and the fever's
 * own per-stage fatigue drain. A zero-hour action (a bare `wait`) changes nothing, preserving the M0
 * empty-turn contract. A `quarantine` counts as a `rest` for fatigue recovery (isolation *is* rest).
 * Pure transform of GameState.
 */
export function updateCondition(state: GameState, action: Action): GameState {
  const hours = hoursOf(action);
  if (hours === 0) return state;

  const cond = state.player.condition;
  const isRest = action.type === "rest" || action.type === "quarantine";

  // Survivability dial (T56): scale how fast needs climb by the run's difficulty. Survivor / unset ⇒ 1 ⇒
  // driftNeeds computes exactly as before (byte-identical); harder modes bite faster, Story slower.
  let needs = driftNeeds(cond.needs, isRest, hours, profileOf(state).needDrift);

  // Wound decline: each open wound tires you; an untreated bite is the infection driver.
  const openWounds = cond.wounds.filter((w) => woundRemainder(w) > 0);
  let biteOpen = false;
  if (openWounds.length > 0) {
    needs = { ...needs, fatigue: clampPct(needs.fatigue + WOUND_FATIGUE_PER_WOUND * openWounds.length * hours) };
    biteOpen = openWounds.some((w) => WOUND_EFFECTS[w.type] === "infect-risk");
  }

  // Staged infection (T49 · FR-INJ-05/08): the driver advances it while an untreated bite is open, and
  // the fever's stage then adds its own fatigue — infection is a *harder way to keep playing*, felt as
  // consequence, not as a bar. Both inert while healthy, so every prior (bite-free) run is byte-identical.
  const infection = advanceInfection(cond.infection, biteOpen, hours);
  const feverFatigue = stageFatigue(infection.stage, hours);
  if (feverFatigue > 0) needs = { ...needs, fatigue: clampPct(needs.fatigue + feverFatigue) };

  return { ...state, player: { ...state.player, condition: { ...cond, needs, infection } } };
}

// --- eat / drink / treat --------------------------------------------------------------------

/** The food the player would eat right now (fresh first, then canned, then spoiled), or null if carrying none. */
const foodOnHand = (s: GameState): string | null => FOOD_PRIORITY.find((f) => carries(s, f)) ?? null;
export const canEat = (s: GameState): boolean => foodOnHand(s) !== null && s.player.condition.needs.hunger >= RELIEF_OFFER_AT;
export const canDrink = (s: GameState): boolean => carries(s, WATER_ITEM) && s.player.condition.needs.thirst >= RELIEF_OFFER_AT;

/** A medical item the player carries that best treats their worst wound, or null. */
export function treatmentItem(state: GameState): { readonly item: string; readonly care: number } | null {
  if (!isWounded(state.player.condition)) return null;
  const worst = worstWound(state.player.condition);
  if (worst === null) return null;
  const preferred = WOUND_TREATED_BY[worst.type] ?? [];
  for (const item of preferred) if (carries(state, item)) return { item, care: TREAT_CARE };
  for (const item of MED_ITEMS) if (carries(state, item)) return { item, care: TREAT_CARE_GENERIC };
  return null;
}
export const canTreat = (s: GameState): boolean => treatmentItem(s) !== null;

/**
 * Eat one ration: spend a food item to buy hunger down. Reaches for the most perishable food first (fresh
 * before it rots, then a shelf-stable can, then spoiled as a last resort), each with its own relief. Inert
 * if not carrying food. A pre-economy pack holds only cans, so this eats a can for {@link EAT_RELIEF} —
 * byte-identical to before. Pure.
 */
export function eat(state: GameState): GameState {
  const food = foodOnHand(state);
  if (food === null) return state;
  const inventory = consume(state, food);
  // Survivability dial (T56): scale how much a ration buys back. Survivor / unset ⇒ 1 ⇒ the exact prior
  // relief (byte-identical); Story feeds you more, harsher modes less.
  const relief = scaleInt(FOOD_RELIEF[food] ?? EAT_RELIEF, profileOf(state).needRelief);
  const needs = { ...state.player.condition.needs, hunger: clampPct(state.player.condition.needs.hunger - relief) };
  return { ...state, player: { ...state.player, inventory, condition: { ...state.player.condition, needs } } };
}

/** Drink: spend a water item to buy thirst down. Inert if not carrying water. Pure. */
export function drink(state: GameState): GameState {
  if (!carries(state, WATER_ITEM)) return state;
  const inventory = consume(state, WATER_ITEM);
  // Survivability dial (T56): Survivor / unset ⇒ 1 ⇒ the exact prior DRINK_RELIEF (byte-identical).
  const relief = scaleInt(DRINK_RELIEF, profileOf(state).needRelief);
  const needs = { ...state.player.condition.needs, thirst: clampPct(state.player.condition.needs.thirst - relief) };
  return { ...state, player: { ...state.player, inventory, condition: { ...state.player.condition, needs } } };
}

/**
 * Treat the worst wound with the best medical item carried (T16 `treatWound`). A wound-specific item
 * applies full care; a generic med applies less. Consumes the item. Halting a bite's care stops the
 * infection driver. Inert when unhurt or carrying nothing useful. Pure.
 */
export function treat(state: GameState): GameState {
  const pick = treatmentItem(state);
  if (pick === null) return state;
  const condition = treatWound(state.player.condition, pick.care);
  const inventory = consume(state, pick.item);
  return { ...state, player: { ...state.player, condition, inventory } };
}

// --- run-end (derived; no new state) --------------------------------------------------------

export type RunEndReason = "starved" | "dehydrated" | "infection";

/** Why the run has ended, or null if the survivor lives. Derived from condition — no stored flag. */
export function runEndReason(state: GameState): RunEndReason | null {
  const { needs, infection } = state.player.condition;
  // Infection no longer ends the run at terminal onset (T49 · FR-INJ-08) — terminal is the playable cure
  // race. The run ends by infection ONLY at the delayed `succumb` collapse, reached by neglecting the race.
  if (hasSuccumbed(infection)) return "infection";
  if (needs.thirst >= NEED_FATAL) return "dehydrated";
  if (needs.hunger >= NEED_FATAL) return "starved";
  return null;
}

export const isRunOver = (state: GameState): boolean => runEndReason(state) !== null;

/** The narration for an ended run — a plain-text death, no choices follow. */
export function endingNarration(reason: RunEndReason): string {
  switch (reason) {
    case "starved":
      return "Hunger hollowed you out until you could not go on. The city keeps what it takes.";
    case "dehydrated":
      return "Thirst won before the dead ever did. You stopped moving somewhere quiet.";
    case "infection":
      return "The fever crested and did not break. What the bite promised, it delivered.";
  }
}
