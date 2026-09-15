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
import { isWounded, treatWound, woundBurden, woundRemainder, worstWound } from "./wounds.js";
import { advanceInfection, BITE_INFECT_RATE, hasSuccumbed, stageFatigue } from "./infection.js";
import { wonEnding } from "./project.js";
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
/**
 * Fatigue recovered per hour of a full night's `sleep` at your base (T58). Unlike a flat `rest`, sleeping
 * scales with the hours slept, so a whole night restores far more than a pre-dawn hour — while hunger and
 * thirst still climb over those hours (you wake rested, but hungry). Only the new `sleep` action reads it.
 */
export const SLEEP_RECOVERY_PER_HOUR = 10;
/** A need at this value is fatal — starvation / dehydration ends the run. */
export const NEED_FATAL = 100;

/**
 * Care one in-game hour of a deliberate `rest` / `sleep` / `quarantine` applies to the worst open wound
 * (M5 task T59 · **GDD VI "Recovery, and dying anyway": _"Health is restored by treatment and rest, not
 * by walking it off."_**).
 *
 * ### Why a balance pass is shipping a mechanism
 *
 * Because the alternative was provably nothing. Two measurements, each over 96 bot runs across four
 * policies, both against the pre-T59 tree:
 *
 *   - **`REST_RECOVERY` 45 -> 5 and 45 -> 80 are BOTH byte-identical to doing nothing**, and
 *     `FATIGUE_RATE` 2 -> 1 likewise (2 -> 8 moves the mean run by 0.1 turns). Fatigue climbed, was
 *     displayed, was relieved by a four-hour action — and *no setting of either dial changed a single
 *     measured outcome*. The Survival Triangle had a corner that cost nothing, against GDD XVI rule 2
 *     ("no strategy escapes the triangle; every corner has a price").
 *   - A **cautious** bot that never enters a fight still takes **5.79 wounds a run and finds 0.13
 *     medical items** — a 45:1 deficit — and therefore treats **0.00** times. `woundBurden` is
 *     monotonic without an item, so {@link LAST_STAND_AT}'s 80 is a countdown for a player who has
 *     done nothing wrong: that bot ends at burden **157.7**, twice the line, having never chosen to
 *     fight anything. (Post-T59 the same bot reaches 288.3, because it lives long enough to slip away
 *     from twice as many things — the counterplay is now reachable, the curve is not fixed, and
 *     PL-M5-62/65 own the rest.)
 *
 * So the wound economy's only counterplay was an item the city does not produce. GDD VI names a second
 * one in so many words, and the engine did not have it.
 *
 * ### Why this is not FR-INJ-04
 *
 * FR-INJ-04 is *"health is treated, not **auto**-regenerated"*, and the word doing the work is `auto`.
 * Nothing here is automatic: the care is applied by {@link updateCondition} **only for an action the
 * player deliberately chose** — `rest`, `sleep`, `quarantine` — and every one of those costs hours, and
 * every hour costs hunger, thirst, the director's drift, the region's contest and a night moving
 * closer. Walking it off still does nothing; time still does nothing. What heals you is stopping, and
 * stopping is the most expensive thing in a game whose clocks are all per-hour. That is the Time corner
 * of the triangle finally having a price to pay with.
 *
 * `wounds.ts` keeps its invariant intact: nothing there regenerates, and this goes through the same
 * {@link treatWound} an item does, so a wound still leaves the body only when its care completes.
 *
 * **4 is the swept value** — a 4-hour rest applies 16 care, a little under a wound-specific item's
 * {@link TREAT_CARE} of 25 and a little over the generic {@link TREAT_CARE_GENERIC} of 10, and a bite's
 * severity of 40 therefore costs **ten in-game hours of lying still** to close by rest alone. See
 * `docs/qa/QA_REVIEW_T59.md`.
 */
export const REST_WOUND_CARE = 4;

/**
 * The most care ONE stop can apply, however long it is (M5 task T59).
 *
 * **This cap is an audit finding, and the number it prevents is embarrassing.** The dial above was
 * swept for the four-hour `rest` and then applied per hour to every stopping action alike, so what
 * actually shipped in the first cut was `rest` 16, `quarantine` 32 and a full night's `sleep` at a
 * claimed base **36** — one-and-a-half times {@link TREAT_CARE}, the best a wound-specific medical item
 * can do, for no item, every single night, in the pass whose entire scarcity thesis is that medical
 * items do not exist (0.13 a run). It also let `quarantine` double-dip: cure the infection AND close
 * the bite driving it, in two doses.
 *
 * 16 — one four-hour rest's worth — is the cap, so lying still LONGER rests you rather than operating
 * on you, and a matched medical item is still strictly the better medicine. The floor this leaves is
 * the one the design wants: stopping is how a survivor with nothing gets better, slowly, at the price
 * of every hour it takes.
 */
export const REST_WOUND_CARE_MAX = 16;

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
/**
 * The highest a need may climb before its relief is offered regardless (M5 task T59).
 *
 * The offer threshold is normally the relief's OWN value ({@link reliefOfferAt}) so that taking the
 * offer wastes nothing; this is the safety ceiling on that rule, so a future pass that raises a relief
 * past it cannot quietly push the prompt into the last hours of a life. At 70 the player still has 30
 * points of head-room — 15 in-game hours of thirst — between the first prompt and {@link NEED_FATAL}.
 */
export const RELIEF_OFFER_CEILING = 70;

/**
 * A need must be at least this pressing before its relief is surfaced — **the relief's own value**,
 * capped at {@link RELIEF_OFFER_CEILING}.
 *
 * ### The defect this replaces
 *
 * It was a flat 34 for every relief, and the needs are clamped at 0, so **the game invited the player
 * to waste the thing they die of.** A canteen buys {@link DRINK_RELIEF} = 55 points of thirst back;
 * offered at 34, taking it immediately threw away 21 of the 55 — **38% of every unit of water in the
 * game** — and a ration threw 11 of {@link EAT_RELIEF}'s 45 away. A player who waited got 60% more out
 * of the same pack than a player who trusted the interface, which is the interface teaching the wrong
 * play: GDD XVI's balancing method and ACCESSIBILITY §6 both rule that out ("difficulty should come
 * from meaningful scarcity and decisions, never from opaque text, fiddly input, or missable
 * information").
 *
 * ### Why it is derived rather than a second dial
 *
 * Because the two numbers are the same decision, and a balance pass should not leave behind a
 * threshold that can drift out of sync with the thing it thresholds. Raise {@link DRINK_RELIEF} in
 * T60 and the prompt follows it for free; there is no second constant to remember.
 *
 * **Callers must pass the relief that will ACTUALLY be applied, not the constant.** An audit found the
 * first cut passing the raw constant while `drink`/`eat` apply `scaleInt(relief, needRelief)` — so on
 * Story (needRelief 1.3) the prompt appeared 16 points early and poured 22.5% of the canteen away
 * after all, and on Nightmare (0.7) it was withheld for 17 points of thirst it did not need to be,
 * which is a survivability regression on the hardest mode inside the survivability pass. {@link canEat}
 * and {@link canDrink} therefore scale first and threshold second.
 *
 * Defensive against a nonsense relief: floored at 1 and truncated, so a hand-edited or NaN relief
 * cannot produce a threshold that is never (or always) met.
 */
export function reliefOfferAt(relief: number): number {
  const r = Number.isFinite(relief) ? Math.trunc(relief) : 1;
  return Math.min(Math.max(1, r), RELIEF_OFFER_CEILING);
}

/**
 * The pre-T59 flat threshold, kept only as the name the T22 tuning notes and several test files refer
 * to, and as the number the T59 write-up compares against.
 *
 * **It is not deprecated and it is not unused, and an audit caught a first draft claiming both.**
 * `sim/encounters.ts` gates `give-food` / `give-water` on it in four places, and **that is deliberate
 * and stays** — see the note at the first of those sites. Sharing is offered the moment someone is
 * visibly in need, because it is the moral verb GDD X's "last can" exists to protect, not an
 * efficiency one; the player's own eat/drink is the efficiency one and moved to {@link reliefOfferAt}.
 * Measured consequence of conflating them: `npc.ruth`, the Vertical Slice's desperate survivor, stops
 * being offered water at all, because her authored need sits between the two thresholds.
 */
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
  const isSleep = action.type === "sleep";

  // Survivability dial (T56): scale how fast needs climb by the run's difficulty. Survivor / unset ⇒ 1 ⇒
  // driftNeeds computes exactly as before (byte-identical); harder modes bite faster, Story slower.
  let needs = driftNeeds(cond.needs, isRest, hours, profileOf(state).needDrift);

  // A full night's `sleep` at the base (T58): fatigue recovers by the hours slept — not the flat rest amount —
  // while hunger/thirst keep the climb driftNeeds just applied, so you wake rested but hungry. Reached only by
  // the new `sleep` action (driftNeeds saw isRest=false, i.e. a fatigue climb, which this overrides), so every
  // prior run — no `sleep` type — is byte-identical.
  if (isSleep) {
    needs = { ...needs, fatigue: clampPct(cond.needs.fatigue - SLEEP_RECOVERY_PER_HOUR * hours) };
  }

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
  // T60: the fever's speed is the difficulty set's first CONSEQUENCE dial (PL-M4-57). Scaled here
  // rather than inside `advanceInfection`, which is pure and stateless and stays that way; `scaleInt`
  // short-circuits at 1, so a Survivor / unset run passes the flat `BITE_INFECT_RATE` and is
  // byte-identical. Against a base of 2 the four modes land on 1 / 2 / 3 / 4 — one whole step each.
  const infection = advanceInfection(cond.infection, biteOpen, hours, scaleInt(BITE_INFECT_RATE, profileOf(state).infectionRisk));
  const feverFatigue = stageFatigue(infection.stage, hours);
  if (feverFatigue > 0) needs = { ...needs, fatigue: clampPct(needs.fatigue + feverFatigue) };

  // T59: a deliberate rest/sleep/quarantine advances the worst wound's care (GDD VI). Applied LAST, so
  // this turn's wound-decline (the extra fatigue, the infection driver above) is charged against the
  // wounds as they were when the hours began — you were hurt for those hours whether or not you spent
  // them lying still. `isRest` already covers `quarantine` (isolation IS rest, T49).
  const restCare = isRest || isSleep ? Math.min(REST_WOUND_CARE * hours, REST_WOUND_CARE_MAX) : 0;
  const rested = restCare > 0 ? treatWound(cond, restCare) : cond;
  return { ...state, player: { ...state.player, condition: { ...rested, needs, infection } } };
}

// --- eat / drink / treat --------------------------------------------------------------------

/** The food the player would eat right now (fresh first, then canned, then spoiled), or null if carrying none. */
const foodOnHand = (s: GameState): string | null => FOOD_PRIORITY.find((f) => carries(s, f)) ?? null;
/**
 * T59: each relief is offered at the value it will ACTUALLY buy back — the constant run through the
 * run's own `needRelief` dial, exactly as `eat`/`drink` do when they apply it — so taking the offer the
 * moment it appears wastes (almost) nothing on every difficulty mode, not just Survivor. `canEat` reads
 * the relief of the food the player would actually reach for, which is fresh-first: a pack holding
 * fresh food (relief 60) prompts later than one holding only cans (45), which is correct, because the
 * better meal is worth waiting for.
 */
export const canEat = (s: GameState): boolean => {
  const food = foodOnHand(s);
  if (food === null) return false;
  const relief = scaleInt(FOOD_RELIEF[food] ?? EAT_RELIEF, profileOf(s).needRelief);
  return s.player.condition.needs.hunger >= reliefOfferAt(relief);
};
export const canDrink = (s: GameState): boolean =>
  carries(s, WATER_ITEM) && s.player.condition.needs.thirst >= reliefOfferAt(scaleInt(DRINK_RELIEF, profileOf(s).needRelief));

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

export type RunEndReason = "starved" | "dehydrated" | "infection" | "lastStand" | "escaped" | "held";

/**
 * Every reason a run can end, as a value — so a consumer can *enumerate* them instead of keeping its
 * own copy of the list.
 *
 * It exists because T82 found the duplicate the hard way: `prototype/testlab/src/checks.ts` held a
 * hand-written `new Set(["starved", "dehydrated", "infection"])`, and the moment a fourth reason
 * existed the Lab failed 11 of 24 soak runs with "run is over but runEndReason is lastStand" — a
 * *correct* run reported as a defect by a list nobody had remembered to update. The `Record` below is
 * the guard: it is typed over the union, so TypeScript refuses to compile the day someone adds a
 * fifth reason and forgets this line. Same shape as the T81 content drift guards.
 */
const ALL_END_REASONS: Record<RunEndReason, true> = {
  starved: true, dehydrated: true, infection: true, lastStand: true,
  // T87: the first two that are not deaths. `isRunOver` is true for a won run exactly as for a lost one
  // — the run is over either way, and every consumer that asks "is this finished" gets the right answer
  // without being taught a new question.
  escaped: true, held: true,
};
export const RUN_END_REASONS: readonly RunEndReason[] = Object.keys(ALL_END_REASONS) as RunEndReason[];

/**
 * The untreated wound burden past which a body being *held* cannot take another exchange — the Last
 * Stand line (T82 · GDD IX "Canonical: the Last Stand" · ADR-0007).
 *
 * **This is not a health bar, and the distinction is the whole of ADR-0007.** It is never shown, never
 * counted down, and on its own it does nothing at all: a player can walk the city at burden 400 for
 * days and the only thing it costs them is what an untreated wound has always cost — scent, drift,
 * a worse stealth roll. It becomes lethal only in combination with a *situation*: in a fight, with
 * something holding you, out of the retreats the fight would otherwise offer. Damage still never reads
 * as −10 HP; what reads is "you are carrying too much to win this one, and it will not let go".
 *
 * **80 is the measured number, not the obvious one.** The brief's own threshold sketch would have made
 * a fight lethal on a clock: measured on the pre-T82 tree over 40 bot runs, burden ≥ 80 is true on
 * 59.3% of all combat turns and 33 of 40 runs reach it, because wounds accumulate monotonically and
 * nothing but treatment removes them. On its own that is a second infection timer. It is the
 * `grabbed` conjunct that turns it back into a moment.
 *
 * Swept by rebuild at 60 / 80 / 120 / 160 over 120 bot runs a policy, as the share of runs ending in
 * a Last Stand — a bot that fights everything and never retreats, and one that disengages once it is
 * carrying real damage:
 *
 * | LAST_STAND_AT | fights everything | disengages when hurt |
 * | ------------- | ----------------- | -------------------- |
 * | 60            | 68%               | 20%                  |
 * | **80**        | **64%**           | **8%**               |
 * | 120           | 55%               | 3%                   |
 * | 160           | 48%               | **0%**               |
 *
 * The right-hand column chose it. At 160 a careful player is **absolutely immune** — 0 of 120 runs,
 * across 475 combat turns and 111 grabs — and a canonical death scene nobody can reach is worse than
 * not having one. At 60 the careful player dies one run in five, which stops being a punishment for
 * carelessness and becomes a punishment for playing. 80 is where the gradient is steepest with both
 * ends non-zero. Re-derive with `measure/t82.ts --play`.
 *
 * **It is currently an ENDING, not yet a STAND, and that is declared rather than papered over.**
 * `runEndReason` is read before any choice is offered, so the blow that completes the condition ends
 * the run on the same frame: there is no final turn and nothing the player can spend. `treat` is not
 * on the menu inside a fight either, so no bandage can be reached once the condition is met — the
 * bandage's job is to stop you ever meeting it. GDD IX's "final, heightened sequence where the player
 * spends whatever they have left" is **T62's to author**, and this is the trigger it hangs on
 * (PL-M5-44).
 *
 * **T60 gave it a difficulty dial** (`woundTolerance`), closing the headline half of PL-M5-45 after
 * four consecutive tasks had re-declared it flat. This constant is now the SURVIVOR value and the
 * identity; {@link lastStandAt} is what a run actually reads. Nothing should compare a burden against
 * this constant directly — a direct comparison is a mode-blind one, which is the defect PL-M5-45 named.
 */
export const LAST_STAND_AT = 80;

/**
 * Whether the player is in the Last Stand: held, hurt past {@link LAST_STAND_AT}, and therefore out of
 * the options a fight normally leaves open.
 *
 * Exported for **T62**, which authors the scene this predicate opens, and for tests — not because
 * anything reads it today. An earlier draft of this comment claimed it was "exported so the harness
 * can warn before it is fatal", which is both uncalled and impossible: see {@link LAST_STAND_AT} on
 * why there is no turn between reaching this state and the run ending. Naming an export's real
 * audience matters here, because this task's own headline finding is that `killCompanion` sat
 * exported and uncalled for two milestones while its module advertised what it did.
 *
 * Reads `combat.grabbed` directly rather than importing `combat/combat.ts`, which would close a cycle
 * (`combat` → `sim/companions` → `sim/survival`). The predicate is one field and a sum; the module
 * that owns the grab owns setting it, and this one owns what it costs.
 */
export function inLastStand(state: GameState): boolean {
  return state.combat?.grabbed === true && woundBurden(state.player.condition) >= lastStandAt(state);
}

/**
 * {@link LAST_STAND_AT} for THIS run — the flat threshold scaled by the mode's `woundTolerance`
 * (T60 · closes the headline half of PL-M5-45, which four consecutive tasks had re-declared).
 *
 * Lower is harsher, so this is the one dial in the set that runs downward with difficulty. Floored at
 * 1 rather than at 0: a threshold of 0 would mean every grab is instantly fatal regardless of injury,
 * which is not "harsh" but "broken". **That floor is declared, not tested** — the four shipped profiles
 * bottom out at 56, so a mutation sweep cannot tell `Math.max(1, …)` from the bare `scaleInt` and
 * neither can a test; it is a bound on a future retune (PL-M4-53), and it ships for that reason.
 * `scaleInt` short-circuits at 1, so Survivor / unset returns the flat 80 exactly.
 *
 * The dial's RESOLUTION is coarse and worth knowing before retuning it: see `woundTolerance`'s own doc
 * in `sim/difficulty.ts` for the 40-point atom in the burden distribution and the cliff at 0.5.
 */
export function lastStandAt(state: GameState): number {
  return Math.max(1, scaleInt(LAST_STAND_AT, profileOf(state).woundTolerance));
}

/**
 * The death (or win) condition that holds right now, **ignoring whether the survivor has had their
 * final turn**. Derived from condition — no stored flag.
 *
 * Split out of {@link runEndReason} by T62, which is the only caller that needs the raw answer: while
 * a Last Stand is open the run is *not over* but something is still killing the player, and the module
 * rendering that scene has to be able to ask which. Keeping one function and two readings of it is the
 * T82 `RUN_END_REASONS` discipline — two copies of "what is killing this player" is exactly the drift
 * that guard exists to prevent.
 */
export function deathReason(state: GameState): RunEndReason | null {
  const { needs, infection } = state.player.condition;
  // T82: a fight can finally be the answer. Checked FIRST because it is the most proximate cause — a
  // player who is held, badly hurt and also out of water died in the grapple, not of thirst, and the
  // scene the player is owed is the one they are standing in. Still derived: `combat.grabbed` and the
  // wound list are both already in `GameState`, so there is no stored death flag and no save rung.
  if (inLastStand(state)) return "lastStand";
  // T87: the terminal project. Checked AFTER the Last Stand and BEFORE the slow deaths, and the order is
  // a judgement, not an accident: hands on you in the dark beat a finished boat, because the grapple is
  // the thing happening *now*; a finished boat beats a fever or a dry canteen, because those are clocks
  // you were already outrunning and the last stage is what you did about them. A run that wins while
  // dying reports the win — the shade of it is in the Living History, which is what T61 assembles an
  // ending FROM (PL-M5-67). Read off `story.endingFlags` and nothing else, so this stays graph-free.
  const won = wonEnding(state);
  if (won !== null) return won;
  // Infection no longer ends the run at terminal onset (T49 · FR-INJ-08) — terminal is the playable cure
  // race. The run ends by infection ONLY at the delayed `succumb` collapse, reached by neglecting the race.
  if (hasSuccumbed(infection)) return "infection";
  if (needs.thirst >= NEED_FATAL) return "dehydrated";
  if (needs.hunger >= NEED_FATAL) return "starved";
  return null;
}

/**
 * Why the run has ended, or null if the survivor lives — **including the case where they are dying but
 * have not yet spent their last turn** (T62 · FR-CBT-10 · PL-M5-44).
 *
 * Before T62 this *was* {@link deathReason}: the blow that completed the Last Stand condition ended the
 * run on the same frame, so `availableActions` returned `[]` and the player got no final choice at all.
 * Now a death **opens a stand** — one heightened turn in which the survivor spends whatever they have
 * left — and this function reports null for exactly that window, so every consumer keeps the run alive
 * without being taught a new question. That is deliberate and it is the whole mechanism: `isRunOver`,
 * the harness loops, the Test Lab runner and `sceneOf` all go on meaning what they always meant.
 *
 * **Reads state and nothing else**, which is why the gate is a flag rather than a content check: this
 * function takes no graph (T87's note on the same constraint), so it cannot ask whether a stand pool is
 * registered. `startRun` seeds {@link STAND_ARMED_FLAG} when one is, and without it this expression is
 * byte-for-byte the pre-T62 one — a run built with no stands, and every save written before T62,
 * behaves exactly as it always did.
 *
 * The `deathReason` import is not circular: `sim/stand.ts` imports this module, and this function
 * reaches back only through two plain flag reads written out here rather than imported.
 */
export function runEndReason(state: GameState): RunEndReason | null {
  const flags = state.story.endingFlags;
  // **A SPENT STAND IS TERMINAL, WHATEVER IS TRUE OF THE BODY A FRAME LATER — and this is not a detail.**
  // The first cut asked the condition again after the act, and the act that puts down the thing holding
  // you *clears `state.combat`*, so `inLastStand` went false and the survivor walked away from their own
  // Last Stand: measured, the run carried on for another 15-30 turns and died of something else later.
  // A stand is not an exchange you can win. The death it was taken against is recorded when it is spent
  // and reported from then on, which is also what makes the ending reproducible from a save loaded on
  // the frame after.
  for (const reason of STAND_DEATH_LIST) {
    if (flags[`${STAND_DEATH_FLAG_PREFIX}${reason}`] === true) return reason;
  }
  const reason = deathReason(state);
  if (reason === null) return null;
  // The stand window. Inlined rather than imported from `sim/stand.ts` because that module imports
  // this one; the constants are re-exported there and asserted equal by a test, so the pair cannot
  // drift silently.
  if (flags[STAND_ARMED_FLAG] === true && flags[STAND_SPENT_FLAG] !== true && STAND_DEATHS.has(reason)) {
    return null;
  }
  return reason;
}

/**
 * @see sim/stand.ts — the canonical declarations. Duplicated here only to avoid an import cycle, and
 * `prototype/engine/test/stand.test.ts` asserts every one of them equal across the two modules, so the
 * duplication cannot drift silently.
 *
 * The three keys are **exact strings with disjoint prefixes**, deliberately: `stand.spent` is not a
 * prefix of `stand.death.lastStand`, and neither is a prefix of `stand.armed`. T87's audit found a
 * stage id of `committed` producing the commit flag itself and concluded that *any suffix rule has that
 * failure somewhere*; this is that conclusion applied before the fact.
 */
export const STAND_ARMED_FLAG = "stand.armed";
export const STAND_SPENT_FLAG = "stand.spent";
export const STAND_DEATH_FLAG_PREFIX = "stand.death.";
/** The four deaths that open a stand. The two wins (T87) close on the project's own authored ending. */
const STAND_DEATH_LIST: readonly RunEndReason[] = ["lastStand", "infection", "dehydrated", "starved"];
const STAND_DEATHS: ReadonlySet<RunEndReason> = new Set<RunEndReason>(STAND_DEATH_LIST);

export const isRunOver = (state: GameState): boolean => runEndReason(state) !== null;

/**
 * The narration for an ended run — plain text, no choices follow. Since T87 an ended run is not always
 * a death: two of the six reasons are wins, and `sceneOf` prefers the finished project's OWN ending over
 * the fallback here (`sim/project.ts#winNarration`).
 */
export function endingNarration(reason: RunEndReason): string {
  switch (reason) {
    case "starved":
      return "Hunger hollowed you out until you could not go on. The city keeps what it takes.";
    case "dehydrated":
      return "Thirst won before the dead ever did. You stopped moving somewhere quiet.";
    case "infection":
      return "The fever crested and did not break. What the bite promised, it delivered.";
    // Deliberately a *scene*, not a scoreboard (GDD IX rule 5: "death in combat is a scene, not a
    // screen"). It names what killed you — the hands, the weight you were already carrying — and
    // nothing else. T62 authors the heightened sequence this trigger exists to open; this is the
    // placeholder ending that makes the trigger real in the meantime, and it is the only line in
    // `endingNarration` that will be replaced rather than kept.
    case "lastStand":
      return "It had you, and you had nothing left to give it. You went down swinging, in the dark, and the city closed over the place where you had been.";
    // T87 — the two that are not deaths. Still scenes, not scoreboards: the *authored* ending belongs to
    // the project that was finished (`winNarration`), and these are the fallbacks for a won run whose
    // content is no longer in hand.
    case "escaped":
      return "You went out past the last of it and did not look back. Whatever the city is now, it is behind you.";
    case "held":
      return "The night came apart against what you had built, and when it was over the walls were still standing, and so were you.";
  }
}
