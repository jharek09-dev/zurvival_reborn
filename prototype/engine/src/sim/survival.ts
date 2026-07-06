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

import type { GameState, Infection, Needs } from "../state/types.js";
import type { Action } from "../pipeline/contract.js";
import { isWounded, treatWound, woundRemainder, worstWound } from "./wounds.js";

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
/** Infection progression per hour while an untreated bite is open. */
export const BITE_INFECT_RATE = 2;
export const INFECT_SYMPTOMATIC_AT = 40;
export const INFECT_TERMINAL_AT = 100;

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

/** Drift needs by the hours spent; rest recovers fatigue instead of adding it. Pure. */
export function driftNeeds(needs: Needs, isRest: boolean, hours: number): Needs {
  if (hours === 0) return needs;
  return {
    hunger: clampPct(needs.hunger + HUNGER_RATE * hours),
    thirst: clampPct(needs.thirst + THIRST_RATE * hours),
    fatigue: isRest ? clampPct(needs.fatigue - REST_RECOVERY) : clampPct(needs.fatigue + FATIGUE_RATE * hours),
  };
}

/** Advance an infection's stage from its progression (never regresses stage on its own). Pure. */
export function stageFor(progression: number): Infection["stage"] {
  if (progression >= INFECT_TERMINAL_AT) return "terminal";
  if (progression >= INFECT_SYMPTOMATIC_AT) return "symptomatic";
  if (progression > 0) return "incubating";
  return "none";
}

/**
 * Stage-4 condition update: drift needs by the action's hours, then apply every open wound's decline
 * — extra fatigue per wound, and an untreated bite driving the infection track — and re-stage the
 * infection. A zero-hour action (a bare `wait`) changes nothing, preserving the M0 empty-turn
 * contract. Pure transform of GameState.
 */
export function updateCondition(state: GameState, action: Action): GameState {
  const hours = hoursOf(action);
  if (hours === 0) return state;

  const cond = state.player.condition;
  const isRest = action.type === "rest";

  let needs = driftNeeds(cond.needs, isRest, hours);

  // Wound decline: each open wound tires you; an untreated bite feeds the infection.
  const openWounds = cond.wounds.filter((w) => woundRemainder(w) > 0);
  let infectDelta = 0;
  if (openWounds.length > 0) {
    needs = { ...needs, fatigue: clampPct(needs.fatigue + WOUND_FATIGUE_PER_WOUND * openWounds.length * hours) };
    const biteOpen = openWounds.some((w) => WOUND_EFFECTS[w.type] === "infect-risk");
    if (biteOpen) infectDelta = BITE_INFECT_RATE * hours;
  }

  const progression = clampPct(cond.infection.progression + infectDelta);
  const infection: Infection = { progression, stage: stageFor(progression) };

  return { ...state, player: { ...state.player, condition: { ...cond, needs, infection } } };
}

// --- eat / drink / treat --------------------------------------------------------------------

export const canEat = (s: GameState): boolean => carries(s, FOOD_ITEM) && s.player.condition.needs.hunger >= RELIEF_OFFER_AT;
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

/** Eat one ration: spend a food item to buy hunger down. Inert if not carrying food. Pure. */
export function eat(state: GameState): GameState {
  if (!carries(state, FOOD_ITEM)) return state;
  const inventory = consume(state, FOOD_ITEM);
  const needs = { ...state.player.condition.needs, hunger: clampPct(state.player.condition.needs.hunger - EAT_RELIEF) };
  return { ...state, player: { ...state.player, inventory, condition: { ...state.player.condition, needs } } };
}

/** Drink: spend a water item to buy thirst down. Inert if not carrying water. Pure. */
export function drink(state: GameState): GameState {
  if (!carries(state, WATER_ITEM)) return state;
  const inventory = consume(state, WATER_ITEM);
  const needs = { ...state.player.condition.needs, thirst: clampPct(state.player.condition.needs.thirst - DRINK_RELIEF) };
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
  if (infection.stage === "terminal") return "infection";
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
