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
import { advanceInfection, hasSuccumbed, stageFatigue } from "./infection.js";
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
 * **Not balanced against difficulty modes** (`sim/difficulty.ts`): it is a flat number on Story and
 * Ironman alike, which is almost certainly wrong, and is T59/T60's to settle (PL-M5-45).
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
  return state.combat?.grabbed === true && woundBurden(state.player.condition) >= LAST_STAND_AT;
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
