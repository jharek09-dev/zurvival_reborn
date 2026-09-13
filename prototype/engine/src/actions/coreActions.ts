/**
 * The core action loop — move / search / rest, plus the T15 combat/stealth branch
 * (M1 tasks T12, T15 · FR-CORE-01,02,03,05,07 · FR-MAP-03 · FR-CBT-01/02/04/05).
 *
 * This is the real body of the pipeline's player-facing stages. `availableActions` decides which
 * choices a node offers; `assertLegal` rejects an unoffered one (FR-CORE-01); `applyPlayerAction`
 * applies the chosen effect; `tickNeeds` drifts needs by the hours spent; `sceneOf` renders the
 * next Scene (FR-CORE-05). Since T15 the offered set is context-sensitive: an active fight offers
 * combat choices, a contested node (walkers present) offers the avoidable encounter — fight, fire,
 * or a stealth slip-away — and an otherwise-quiet node offers the explore loop.
 *
 * Costs: every offered action spends hours (FR-CORE-03) so time always advances and every resolved
 * action changes at least one system. Move/search/rest are pure and RNG-free; the combat branch
 * threads named RNG streams and lives in `../combat/combat.ts`.
 */

import type { GameState, NodeId, NPCState } from "../state/types.js";
import type { Action, Scene, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { discoverAround } from "../map/fogOfWar.js";
import { resolveSearchLoot } from "../sim/loot.js";
import { dropItem, dropArtifact, inventoryWeight, itemName, CARRY_CAPACITY, PACK_HEAVY } from "../sim/inventory.js";
import { NOISE_SEARCH } from "../sim/noise.js";
import { phaseSearchNoise } from "../sim/timeOfDay.js";
import { routeWear, extraCostOf, isBlocked, conditionOf } from "../sim/routes.js";
import { ZOMBIE_SCREAMER } from "../sim/zombies.js";
import {
  updateCondition,
  eat as eatFood,
  drink as drinkWater,
  treat as treatWounds,
  canEat,
  canDrink,
  canTreat,
  isRunOver,
  runEndReason,
  endingNarration,
  EAT_COST,
  DRINK_COST,
  TREAT_COST,
} from "../sim/survival.js";
import {
  combatChoices,
  combatNarration,
  encounterChoices,
  isCombatAction,
  resolveCombatAction,
} from "../combat/combat.js";
import { isOverrun, isOverrunAction, overrunChoices, overrunNarration, resolveOverrunAction } from "../sim/overrun.js";
import { hordesEnabled } from "../sim/hordes.js";
import { encounterPeople, isEncounterAction, resolveEncounterAction } from "../sim/encounters.js";
import {
  shelterChoices,
  shelterLine,
  isShelterAction,
  resolveShelterAction,
  applyShelterRest,
} from "../sim/shelter.js";
import { stashChoices, isStashAction, resolveStashAction, atOwnShelter } from "../sim/stash.js";
import { carriedWeapons, gearChoices, isGearAction, resolveGearAction } from "./gear.js";
import { marksSuffix, weaponProfile, weaponsActive } from "../combat/weapons.js";
import { storyChoices, isStoryAction, resolveStoryAction, storyLine } from "../sim/story.js";
import {
  activeEncounter,
  eventChoices,
  eventLine,
  humanityBand,
  isEventAction,
  resolveEventAction,
} from "../sim/events.js";
import {
  companionsHere,
  companionName,
  companionOrderChoices,
  isCompanionOrderAction,
  resolveCompanionOrder,
  orderOf,
} from "../sim/companions.js";
import { canParley } from "../sim/trust.js";
import {
  infectionChoices,
  isInfectionAction,
  resolveInfectionAction,
  infectionSign,
  perceptionDistortion,
  infectionOutcomeLine,
} from "../sim/infection.js";
import { radioChoices, isRadioAction, resolveRadioAction, radioLine, radioPool } from "../sim/radio.js";
import { economyChoices, isEconomyAction, resolveEconomyAction, economyLine, economyActive } from "../sim/economy.js";
import { jobChoices, isJobAction, resolveJobAction, jobLine, jobIdOf, jobOf } from "../sim/jobs.js";
import { socialChoices, isSocialAction, resolveSocialAction, socialLine, socialActive, attitudeRead, companionUnease, shelterMoodRead } from "../sim/social.js";

// The core action time costs moved to the leaf module `actions/costs.ts` (T77) so the combat layer —
// which `coreActions` imports, and which must define `SLIP_COST` as `MOVE_COST + 1` — can read them
// without closing an import cycle. Re-exported here so every existing importer is unchanged.
export { MOVE_COST, SEARCH_COST, REST_COST, DROP_COST } from "./costs.js";
import { MOVE_COST, SEARCH_COST, REST_COST, DROP_COST } from "./costs.js";

/** How much a single search advances a node's searchPct (3 searches exhaust a node). */
export const SEARCH_GAIN = 34;
/** Fatigue a single rest recovers — re-exported from the survival module (T22 owns needs). */
export { REST_RECOVERY } from "../sim/survival.js";
/** Fatigue recovered per hour of sleep — re-exported from survival (T22/T58 owns needs). */
export { SLEEP_RECOVERY_PER_HOUR } from "../sim/survival.js";

/**
 * The nightly sleep window and wake time (T58, retuned T71 · GDD IV). You can bed down for the night only
 * at your own base and only within the window 21:00–03:00 (wraps midnight); a sleep always runs the clock
 * forward to the next {@link SLEEP_WAKE_HOUR} — 06:00. The action is still called "Sleep until morning"
 * even though 06:00 falls in the "dawn" phase (the wake time is the player-facing "morning", by design).
 * Hour-only and pure.
 */
export const SLEEP_WAKE_HOUR = 6;
export const SLEEP_WINDOW_FROM = 21;
export const SLEEP_WINDOW_TO = 3;

/** Normalize any integer hour into [0, 24). */
const normHour = (hour: number): number => ((Math.trunc(hour) % 24) + 24) % 24;

/** Whether `hour` falls in the nightly sleep window 21:00–03:00 (inclusive, wrapping midnight). */
export function inSleepWindow(hour: number): boolean {
  const h = normHour(hour);
  return h >= SLEEP_WINDOW_FROM || h <= SLEEP_WINDOW_TO;
}

/** Whole hours from `hour` forward to the next wake time (06:00) — always 1..24, never 0. */
export function hoursUntilWake(hour: number): number {
  const delta = (SLEEP_WAKE_HOUR - normHour(hour) + 24) % 24;
  return delta === 0 ? 24 : delta;
}

/** Thrown when a submitted action was not among the Scene's offered choices (FR-CORE-01). */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * The actions the player may take from their current state, in a stable order. Context-sensitive:
 *   1. an active fight (`state.combat !== null`) offers only combat choices;
 *   2. a contested node (`walkers > 0`) offers the avoidable encounter (fight / fire / slip away);
 *   3. otherwise the explore loop — moves to discovered neighbours (FR-MAP-02/03), then search,
 *      then rest.
 * Empty when the player is not on a real node (the pre-content skeleton), keeping an empty run's
 * Scene empty.
 */
export function availableActions(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const here = state.player.location;
  const node = state.nodes[here];
  if (node === undefined) return [];

  if (isRunOver(state)) return []; // the run has ended — no actions follow a death (T22)
  // A horde standing on you (T76) pre-empts EVERYTHING below, including a fight already in progress:
  // FR-CBT-08 says a mass is routed or fled, never out-traded, so there is no fight choice while one
  // is on your node — run, or go to ground. The branch sits above combat deliberately (a mass walking
  // into your duel does not queue behind it) and always returns at least the hold, so it can never
  // hand back an empty list. See `sim/overrun.ts`.
  if (isOverrun(state)) return overrunChoices(state, graph);
  if (state.combat !== null) return combatChoices(state, graph);
  // An engaged multi-stage encounter (T47) owns the turn until it resolves — its stage choices only,
  // plus a guaranteed way out (eventChoices). Sits above the walker prompt so a wanderer arriving
  // mid-negotiation can't shadow the active beat; below combat, which is always the most urgent.
  if (activeEncounter(state) !== null) return eventChoices(state, graph);
  if (node.walkers > 0) return encounterChoices(state, graph);

  const choices: SceneChoice[] = [];

  for (const to of [...neighborsOf(graph, here)].sort()) {
    const neighbor = state.nodes[to];
    if (neighbor === undefined || !neighbor.discovered) continue;
    // Route conditions (T29 · FR-MAP-04): a blocked route is not offered this turn; a rough or flooded
    // one costs extra hours. A clear/absent route is the free M1 move.
    const wear = routeWear(state, here, to);
    if (isBlocked(wear)) continue;
    const cost = MOVE_COST + extraCostOf(wear);
    const name = graph.nodes[to]?.name ?? to;
    const cond = conditionOf(wear);
    const suffix = cond === "costly" ? " — the road is rough" : cond === "flooded" ? " — the way is flooded" : "";
    choices.push({
      id: `move:${to}`,
      label: `Travel to ${name}${suffix}`,
      timeCost: cost,
      action: { type: "move", choiceId: `move:${to}`, timeCost: cost, params: { to } },
    });
  }

  if (node.searchPct < 100) {
    const name = graph.nodes[here]?.name ?? here;
    // A search in the dark is louder (T28): after dusk it deposits extra noise, so the dead are
    // likelier to hear you rummaging. Daytime keeps the T14 default deposit (no override, unchanged).
    const nightNoise = phaseSearchNoise(state.meta.phase);
    const searchAction: Action =
      nightNoise > 0
        ? { type: "search", choiceId: "search", timeCost: SEARCH_COST, params: { noise: NOISE_SEARCH + nightNoise } }
        : { type: "search", choiceId: "search", timeCost: SEARCH_COST };
    choices.push({ id: "search", label: `Search ${name}`, timeCost: SEARCH_COST, action: searchAction });
  }

  // Survival actions (T22): spend a scavenged item to buy a need back down / treat a wound. Offered
  // only when relevant (carrying the item and the need is pressing / a wound is open) — no clutter.
  if (canEat(state)) {
    choices.push({
      id: "eat",
      label: "Eat a ration",
      timeCost: EAT_COST,
      action: { type: "eat", choiceId: "eat", timeCost: EAT_COST },
    });
  }
  if (canDrink(state)) {
    choices.push({
      id: "drink",
      label: "Drink water",
      timeCost: DRINK_COST,
      action: { type: "drink", choiceId: "drink", timeCost: DRINK_COST },
    });
  }
  if (canTreat(state)) {
    choices.push({
      id: "treat",
      label: "Treat your wounds",
      timeCost: TREAT_COST,
      action: { type: "treat", choiceId: "treat", timeCost: TREAT_COST },
    });
  }

  // Infection (T49 · FR-INJ-07): diagnose the stage, dose antibiotics (the cure race), or quarantine at
  // your base — grouped with the self-care verbs. Inert unless infected, so every prior (bite-free) run
  // keeps the identical choice list; a fight / active encounter above already pre-empts this branch.
  for (const choice of infectionChoices(state)) choices.push(choice);

  choices.push({
    id: "rest",
    label: "Rest and recover",
    timeCost: REST_COST,
    action: { type: "rest", choiceId: "rest", timeCost: REST_COST },
  });

  // Sleep the night through at your own base (T58, retuned T71 · GDD IV): a dedicated wind-down offered only
  // while you stand in your claimed shelter within the nightly window (21:00–03:00). It runs the clock to the
  // next morning (06:00) and recovers fatigue by the hours slept (survival.ts) — hunger/thirst still climb, so
  // you wake rested but hungry. Gated (the `sleep` type, shelter-and-window only) and a fight / active
  // encounter / walkers above already pre-empt this branch.
  if (atOwnShelter(state) && inSleepWindow(state.meta.hour)) {
    const sleepHours = hoursUntilWake(state.meta.hour);
    choices.push({
      id: "sleep",
      label: "Sleep until morning",
      timeCost: sleepHours,
      action: { type: "sleep", choiceId: "sleep", timeCost: sleepHours },
    });
  }

  // Shelter (T37/T38 · FR-SHL): claim a searched-clean node as your base, or fortify the base you stand in.
  // Appended after rest — both are "at this place" actions — and before the people/drop blocks. Inert until a
  // node is searched clean (claim) or you stand in your own shelter with scrap (fortify).
  for (const choice of shelterChoices(state)) choices.push(choice);

  // Shared stash (T39 · FR-SHL-03/FR-PLR-04): bank surplus at the base or pull it back. Offered only while
  // standing in your own shelter, per carried/stashed stack, free like the T18 drop — inert everywhere else.
  for (const choice of stashChoices(state)) choices.push(choice);

  // Authored story (T40 · FR-STORY-01): a live arc beat's costed choices — e.g. the plea at your base.
  // Surfaced in the same at-your-place block; inert unless an arc has a decision waiting here.
  for (const choice of storyChoices(state)) choices.push(choice);

  // People here (T35 · FR-NPC): talk / share / threaten / recruit a survivor present, or feed a companion.
  // Offered in the explore branch only — an active fight or loitering walkers pre-empt it above — and
  // appended after the survival verbs so the world-danger and self-care choices lead the list.
  for (const choice of encounterPeople(state)) choices.push(choice);

  // Companion standing orders (T45 · FR-NPC-03): free management verbs to tell a companion at your side to
  // follow / hold / scavenge / guard — the dangerous two gated on earned trust. Appended after the people
  // block; inert unless a companion is with you.
  for (const choice of companionOrderChoices(state)) choices.push(choice);

  // The radio network (T50 · FR-STY-03): listen to the wider world's signals, or broadcast and reveal
  // yourself (a loud, unknown-audience risk). Gated on carrying a scavenged radio, so inert for every
  // prior run; offered only in this quiet explore branch — a fight / walkers / active encounter pre-empt it.
  for (const choice of radioChoices(state)) choices.push(choice);

  // The crafting economy (T51 · FR-ECO-04..07): craft / repair / purify at the workbench, or study a
  // carried blueprint. Gated on an active recipe pool AND (for the bench verbs) standing in your own
  // shelter with the parts, so inert for every prior run; offered only in this quiet explore branch.
  for (const choice of economyChoices(state, graph)) choices.push(choice);

  // Shelter jobs (T52 · FR-SHL-03/04): assign a companion at the base to a room's job (garden / kitchen /
  // salvage / infirmary / generator) so it produces or consumes the stash over time, or take one off duty.
  // Gated on an active job pool AND standing in your own shelter with a room built and a companion present,
  // so inert for every prior run; free base management like the T45 order and T39 stash verbs.
  for (const choice of jobChoices(state, graph)) choices.push(choice);

  // Social (T53 · FR-NPC-06): ask a met survivor here what they know — a costed verb whose payoff is real
  // world state (a revealed node / a marked discovery). Gated on an active faction pool, so inert for every
  // prior run; offered only in this quiet explore branch, after the base-management verbs.
  for (const choice of socialChoices(state, graph)) choices.push(choice);

  // Drop a carried item to reclaim weight (T18 · FR-PLR-03) — the leave-behind lever. Surfaced only
  // when the pack is heavy (>= PACK_HEAVY): below that there's ample room, so drops would just clutter
  // the single-decision screen (FR-UI). One choice per non-unique stack, stable-ordered by type; free.
  // Take up a carried weapon (T81 · FR-CBT-04): the verb that gets the roster out of the pack and into a
  // hand. Free like the T18 drop and the T39 stash, offered here in the quiet explore branch ONLY — a
  // fight, an overrun, an active encounter or loitering walkers all pre-empt this branch, so you fight
  // with what you walked in holding. Inert for any run carrying no weapon artifact (every pre-T81 run).
  for (const choice of gearChoices(state)) choices.push(choice);

  if (node && inventoryWeight(state.player.inventory) >= PACK_HEAVY) {
    for (const type of [...new Set(state.player.inventory.filter((e) => e.itemId === undefined).map((e) => e.type))].sort()) {
      choices.push({
        id: `drop:${type}`,
        label: `Drop ${itemName(type)}`,
        timeCost: DROP_COST,
        action: { type: "drop", choiceId: `drop:${type}`, timeCost: DROP_COST, params: { item: type } },
      });
    }
    // A tracked artifact is dropped by INSTANCE, not by type (T81): two found crowbars are two different
    // crowbars. Without this every junk weapon the world hands out would be welded into the pack for the
    // rest of the run — `dropItem` only ever touched non-unique stacks — and the carry-weight trade the
    // weapon roster is balanced on would ratchet shut. Same free cost and same PACK_HEAVY gate as above.
    for (const w of carriedWeapons(state)) {
      choices.push({
        id: `drop:${w.itemId}`,
        label: `Leave the ${weaponProfile(w.type).name}${marksSuffix(w.item)} behind`,
        timeCost: DROP_COST,
        action: { type: "drop", choiceId: `drop:${w.itemId}`, timeCost: DROP_COST, params: { itemId: w.itemId } },
      });
    }
  }

  return choices;
}

/** Reject an action the current situation did not offer (stage 1, FR-CORE-01). */
export function assertLegal(state: GameState, graph: RegionGraph, action: Action): void {
  const offered = availableActions(state, graph);
  if (!offered.some((c) => c.id === action.choiceId)) {
    throw new IllegalActionError(
      `action ${JSON.stringify(action.choiceId ?? action.type)} is not offered at ` +
        `"${state.player.location}"`,
    );
  }
}

/** Apply a move: relocate the player, mark the destination visited today, and lift its fog. */
function applyMove(state: GameState, graph: RegionGraph, to: NodeId): GameState {
  const node = state.nodes[to];
  if (node === undefined) return state;
  const visited = { ...node, lastVisit: state.meta.day };
  const nodes = discoverAround({ ...state.nodes, [to]: visited }, graph, to);
  return { ...state, player: { ...state.player, location: to }, nodes };
}

/** Apply a search: advance the current node's searchPct (node memory persists, FR-SIM-02). */
function applySearch(state: GameState): GameState {
  const here = state.player.location;
  const node = state.nodes[here];
  if (node === undefined) return state;
  const searchPct = clampPct(node.searchPct + SEARCH_GAIN);
  return { ...state, nodes: { ...state.nodes, [here]: { ...node, searchPct } } };
}

/**
 * Apply the chosen action's world effect (stage 3). Combat/stealth actions delegate to the combat
 * module; move/search apply their effect; rest and unknown/`wait` actions are inert here (rest's
 * recovery is a needs change handled by {@link tickNeeds}).
 */
export function applyPlayerAction(state: GameState, graph: RegionGraph, action: Action): GameState {
  if (isOverrunAction(action)) return resolveOverrunAction(state, graph, action);
  if (isCombatAction(action)) return resolveCombatAction(state, graph, action);
  if (isEventAction(action)) return resolveEventAction(state, graph, action);
  if (isEncounterAction(action)) return resolveEncounterAction(state, action, graph);
  if (isSocialAction(action)) return resolveSocialAction(state, graph, action);
  if (isCompanionOrderAction(action)) return resolveCompanionOrder(state, action);
  if (isShelterAction(action)) return resolveShelterAction(state, action);
  if (isStashAction(action)) return resolveStashAction(state, action);
  if (isGearAction(action)) return resolveGearAction(state, action);
  if (isStoryAction(action)) return resolveStoryAction(state, action);
  if (isInfectionAction(action)) return resolveInfectionAction(state, action);
  if (isRadioAction(action)) return resolveRadioAction(state, graph, action);
  if (isEconomyAction(action)) return resolveEconomyAction(state, graph, action);
  if (isJobAction(action)) return resolveJobAction(state, graph, action);
  switch (action.type) {
    case "move": {
      const to = action.params?.["to"];
      return typeof to === "string" ? applyMove(state, graph, to) : state;
    }
    case "search": {
      const searched = applySearch(state);
      const kind = graph.nodes[state.player.location]?.kind;
      // The scavenged radio (T50) is findable only when the radio system is active (a signals pool is
      // registered); the economy items (T51 — components / blueprints / fresh food / dirty water) only
      // when a recipe pool is. Both additive and gated, so a run with neither draws byte-identically (loot.ts).
      // T81: weapons are placed only when the weapon content set is registered (`graph.weapons`), and
      // then the table is drawn by WEIGHT rather than uniformly — one `drawInt` step either way, so a
      // pool-less run still draws bit-for-bit as before.
      return resolveSearchLoot(searched, state.player.location, kind, radioPool(graph).length > 0, economyActive(graph), weaponsActive(graph));
    }
    case "drop": {
      // T81: an `itemId` drops one tracked artifact by instance; the `item` form is the untouched T18
      // stack drop. Leaving a weapon behind also empties the hand that held it (the equipment slot would
      // otherwise point at an instance the pack no longer carries) and forgets the instance entirely —
      // its provenance goes with it, which is exactly what abandoning a thing means.
      const itemId = action.params?.["itemId"];
      if (typeof itemId === "string") {
        const inventory = dropArtifact(state.player.inventory, itemId);
        if (inventory === state.player.inventory) return state;
        const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => id !== itemId));
        const equipment = Object.fromEntries(Object.entries(state.player.equipment).filter(([, id]) => id !== itemId));
        return { ...state, items, player: { ...state.player, inventory, equipment } };
      }
      const item = action.params?.["item"];
      if (typeof item !== "string") return state;
      const inventory = dropItem(state.player.inventory, item);
      return inventory === state.player.inventory
        ? state
        : { ...state, player: { ...state.player, inventory } };
    }
    case "eat":
      return eatFood(state);
    case "drink":
      return drinkWater(state);
    case "treat":
      return treatWounds(state);
    default:
      return state;
  }
}

/**
 * Drift the player's needs by the hours spent (stage 4). Hunger and thirst rise with every hour
 * that passes; fatigue rises too, except a rest recovers it. A zero-cost action (`wait`) changes
 * nothing — this is what keeps the M0 empty turn a genuine no-op.
 */
export function tickNeeds(state: GameState, action: Action): GameState {
  // Stage 4: drift needs by the hours spent and apply wound decline / infection (T22). A zero-hour
  // action (bare `wait`) changes nothing, preserving the M0 empty-turn contract. A rest at your claimed
  // shelter then recovers extra fatigue (T37/T38) — applied here so survival.ts stays shelter-agnostic.
  return applyShelterRest(updateCondition(state, action), action);
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

// --- world surfacing (T31/T28/T26 made perceivable — addresses QA H1 / PL-M2-01) --------------

/** A one-line read of the sky for the current weather + phase — the atmosphere line. */
function weatherProse(weather: string, phase: string): string {
  switch (weather) {
    case "weather.rain": return "Rain sheets down, drumming on the ruins.";
    case "weather.storm": return "A storm hammers the district — wind, water, and dark.";
    case "weather.fog": return "Fog swallows the street a few yards out.";
    case "weather.snow": return "Snow falls, muffling the world to a hush.";
    case "weather.wind": return "A hard wind scours the empty streets.";
    case "weather.cloudy": return "Low cloud sits grey over the rooftops.";
    default: return phase === "night" ? "The night is clear and cold." : "The sky is washed and clear.";
  }
}

/** Atmosphere: the sky, plus a read on the city-wide tide (T28) when danger is up. */
function atmosphereLine(state: GameState): string {
  const sky = weatherProse(state.world.weather, state.meta.phase);
  const tide = state.world.globalThreat;
  const edge = tide >= 55 ? " A charged, dangerous quiet hangs over everything." : tide >= 35 ? " The streets feel restless, watchful." : "";
  return `${sky}${edge}`;
}

/**
 * The single sharpest world-danger lead to open on when there is no active fight: an approaching horde
 * (T26), then a roused/screaming node here or next door (T25), then a district whose threat has
 * mounted (T24/T30). Null when the world nearby is quiet. Level-based (the Living History carries the
 * turn-to-turn deltas); this is the felt read.
 */
function worldLead(state: GameState, graph: RegionGraph): string | null {
  const here = state.player.location;
  const neighbours = new Set(neighborsOf(graph, here));

  // 1. A horde bearing down — a mass ONE hop out. Two changes from the baseline rule, and the second
  //    one is the interesting one because the obvious version of it was measured and rejected:
  //
  //    (i) `h.pos === here` is dropped. A horde standing on this node is the overrun (T76), whose own
  //        line has already led the scene by the time this runs; repeating it here only restates it
  //        more weakly. With `hordes.disabled` there is no lead at all, which is correct — the whole
  //        system is off.
  //    (ii) `h.dest === here` is dropped too. That disjunct is the cry-wolf half: it fires for a mass
  //        thirty nodes away that merely happens to be pathing here, and with three masses instead of
  //        one it produced consecutive runs of up to 26 turns on a parked 100-turn run.
  //
  //    The tempting third change — widening to TWO hops, so a player gets four turns of warning rather
  //    than two — was tried and REVERTED on measurement: a parked player over 100 turns saw it on 23%
  //    of them, in runs of up to 20, which is worse cry-wolf than the very build this was meant to
  //    repair. More warning is not more legible if it never stops talking.
  //
  //    Measured end-to-end through `sceneOf`, parked player, 5 seeds × 100 turns, shipped city:
  //      · pre-T76 baseline — the lead fires **0 times in 500 turns**, and no mass ever arrives either;
  //        that is the real complaint, and it is invisibility, not crying wolf.
  //      · shipped rule — **7 fires in 500 turns, longest run 2**, against 10 actual overruns in the
  //        same runs. It fires about as often as the thing it warns about happens.
  //    And it is not merely quiet, it is early: across five scripted runs the one-hop lead preceded
  //    **18 of 18** overruns. A player who moves away when it fires takes 12 overruns over 304 turns
  //    where the same player ignoring it takes 18 over 261 — 3.9 per hundred turns against 6.9 — and
  //    survives about a sixth longer.
  if (hordesEnabled(state) && state.hordes.some((h) => neighbours.has(h.pos))) {
    return "You hear them before you see them — a horde on the move on the next street, and it is coming this way.";
  }

  // 2. A roused or screaming node here or one step away.
  const rousedProse = (nodeId: NodeId): string | null => {
    const n = state.nodes[nodeId];
    if (n === undefined) return null;
    const roused = n.zombieState === "investigating" || n.zombieState === "chasing";
    if (roused && n.zombieTypes.includes(ZOMBIE_SCREAMER)) {
      return "A shriek goes up close by — a screamer — and every dead thing that heard it is turning toward the sound.";
    }
    if (n.zombieState === "chasing") return "Something nearby has your scent; you can hear it moving with purpose.";
    if (n.zombieState === "investigating") return "Close by, the dead have stirred — shapes drifting toward a sound.";
    return null;
  };
  for (const id of [here, ...[...neighbours].sort()]) {
    const line = rousedProse(id);
    if (line !== null) return line;
  }

  // 3. A district that has turned.
  const region = state.regions[state.nodes[here]?.regionId ?? ""];
  if (region !== undefined && region.threat >= 60) {
    return "This district has turned — the danger here is mounting by the hour.";
  }
  return null;
}

// --- people surfacing (T35 · FR-NPC-01) -------------------------------------------------------

/** A first-sight read of a survivor's baseline temperament (the fixed half of the attitude model). */
function dispositionRead(d: NPCState["disposition"]): string {
  switch (d) {
    case "hostile": return "hostile, hands ready";
    case "wary": return "wary, watching your hands";
    case "desperate": return "desperate, sizing up what you carry";
    case "friendly": return "openly friendly";
    default: return "guarded";
  }
}

/** A pressing-need read for a survivor, or "" when nothing shows (surfaced only when it matters). */
function npcNeedRead(n: NPCState): string {
  if (n.needs.thirst >= 85 || n.needs.hunger >= 85) return ", and they look ready to drop";
  if (n.needs.thirst >= 60) return ", and they look parched";
  if (n.needs.hunger >= 60) return ", and they look half-starved";
  return "";
}

/**
 * A line naming the people at the player's node — companions at your side, a survivor to meet (their
 * temperament on first sight), one you already know, one who has turned cold, or the body of one who did
 * not make it. Null when no one is here. Self-sufficient from state (names/disposition/needs); the client
 * enriches a first meeting with the content description (T35+/T41). Screen-reader-safe — all words.
 */
function peopleLine(state: GameState, graph: RegionGraph | undefined): string | null {
  const here = state.player.location;
  const bits: string[] = [];

  // Companions with you, named, with their standing order — or their shelter job (T52) — read in words
  // (T45 · closes the "your companion" gap). A job read takes precedence over the plain "holding here".
  for (const c of companionsHere(state, here)) {
    const jobId = jobIdOf(c);
    const job = jobId !== null ? jobOf(graph, jobId) : undefined;
    const order = orderOf(c);
    const doing =
      job !== undefined ? ` — set to ${job.label.toLowerCase()} for the base` :
      order === "hold" ? " — holding here" :
      order === "guard" ? " — guarding the base" :
      order === "scavenge" ? " — ranging out for the base" : "";
    // A companion's unrest (T53 · FR-NPC-05): a legible desertion tell a turn or two before they leave, so a
    // departure never comes out of nowhere. Gated on the social system; silent for a steady companion.
    const unease = socialActive(graph) ? companionUnease(c) : null;
    bits.push(`${companionName(c)} is with you${doing}.${unease !== null ? ` They are ${unease}.` : ""}`);
  }

  let witness = companionsHere(state, here).length > 0;
  for (const id of Object.keys(state.npcs).sort()) {
    const n = state.npcs[id]!;
    if (n.location !== here) continue;
    if (!n.alive) { bits.push(`${n.name} lies where they fell.`); continue; }
    witness = true;
    if (!canParley(n)) { bits.push(`${n.name} will not meet your eye — past talking now.`); continue; }
    // A met survivor's attitude toward you (T53 · FR-NPC-02): respect/fear surfaced as behaviour, never a
    // number. Gated on the social system; a survivor you've done nothing to reads by disposition alone (T35).
    const att = n.met && socialActive(graph) ? attitudeRead(n) : null;
    bits.push(
      n.met
        ? `${n.name} is here${npcNeedRead(n)}${att !== null ? `, ${att}` : ""}.`
        : `Someone is here — ${n.name}, ${dispositionRead(n.disposition)}${npcNeedRead(n)}.`,
    );
  }

  // Others react to the visible sign of infection on you (T49 · FR-INJ-06): companions grow afraid,
  // strangers keep their distance. Only when someone is here to see it and the sign actually shows
  // (symptomatic+); null while healthy/asymptomatic so no prior scene is touched.
  const sign = infectionSign(state);
  if (witness && sign !== null) bits.push(`Those here keep their distance, wary of ${sign}.`);

  // Shelter mood (T53 · FR-NPC-07): when two or more of your people are home together, how the house feels —
  // close-knit, on edge with old grudges, or wearing down. Gated on the social system; null off the base.
  if (socialActive(graph)) {
    const mood = shelterMoodRead(state);
    if (mood !== null) bits.push(mood);
  }

  return bits.length > 0 ? bits.join(" ") : null;
}

/**
 * Render the Scene for a state (stage 14, and the client's source for the *first* scene before any
 * action). With a graph and the player on a real node it answers the Four Questions; a fight or a
 * threat leads the narration. Without a graph it is the empty skeleton Scene (M0 contract). Pure.
 */
export function sceneOf(state: GameState, graph?: RegionGraph): Scene {
  const { turn, day, hour, phase } = state.meta;
  const here = state.player.location;
  const node = graph ? state.nodes[here] : undefined;

  if (graph === undefined || node === undefined) {
    return { turn, day, hour, phase, narration: "", choices: [] };
  }

  // The run has ended (T22): narrate the death, offer nothing further.
  const end = runEndReason(state);
  if (end !== null) {
    return { turn, day, hour, phase, location: here, narration: endingNarration(end), choices: [] };
  }

  const name = graph.nodes[here]?.name ?? here;
  const threat = combatNarration(state);
  const where = graph.nodes[here]?.description ?? "";
  const searched =
    node.searchPct >= 100 ? " It has been searched clean." : node.searchPct > 0 ? " You have searched here before." : "";
  // A full pack is world feedback (you can't take more) — surface it in prose; the precise pack
  // count is the client's to render (T18/T19). Only the qualitative "full" belongs in narration.
  const pack = inventoryWeight(state.player.inventory) >= CARRY_CAPACITY ? " Your pack is full." : "";
  const setting = `${where}${searched}${pack} (Day ${day}, ${phase} ${pad2(hour)}:00 — at ${name}.)`;
  // Surface the reactive world (QA H1 / PL-M2-01): a fight or the sharpest world danger leads, then the
  // atmosphere line, then the place itself. Screen-reader-safe — everything critical is in words.
  // An engaged encounter (T47) is the scene — its stage narration leads, ahead of the ambient world
  // reads. The felt moral read (`moral`) rides with the atmosphere, surfaced only at the extremes.
  const event = eventLine(state, graph);
  // A horde on your node (T76) is the sharpest thing on the board — ahead of the fight read, which
  // would otherwise describe the one walker you can no longer choose to fight.
  const lead = overrunNarration(state) ?? threat ?? worldLead(state, graph);
  // Infection perception distortion (T49 · FR-INJ-06): at advanced/terminal the scene grows unreliable —
  // a hallucinated lead or a memory gap, framed as possibly-unreal. Suppressed whenever a REAL danger lead
  // is on the board, so a hallucinated "you hear them massing" can never sit beside — and undermine — a
  // genuine horde read (fairness). It colours only the quiet, never fabricates a real threat
  // (availableActions still keys off real state). Stateless/pure — no rng advance in a render.
  const halluc = lead === null ? perceptionDistortion(state) : null;
  // Honest, no-number feedback on a cure/quarantine taken THIS turn (did it clear / ease / merely hold?).
  const cure = infectionOutcomeLine(state);
  // The radio (T50 · FR-STY-03): on a listen turn, the on-air digest of the wider world; on a broadcast
  // turn, the "you put your voice out" read + its seeded outcome. Null on any non-radio turn, so an
  // ordinary scene is untouched. Re-derived, so a listen reflects the world as it is right now.
  const radio = radioLine(state, graph);
  // The economy (T51 · FR-ECO-04..07): on a craft/repair/purify/study turn, an honest one-line read of what
  // was made or restored; on the turn fresh food spoils, the loss. Null on any other turn, so an ordinary
  // scene is untouched.
  const economy = economyLine(state, graph);
  // Shelter jobs (T52 · FR-SHL-03/04): on a turn a companion is assigned/pulled off a job, or a turn the
  // base's jobs produced / fed its people / lost food to spoilage, an honest words-only "daily report".
  // Null on any other turn, so an ordinary scene is untouched.
  const jobs = jobLine(state, graph);
  // The social system (T53 · FR-NPC-05/06): on a turn a survivor confided a lead, or a companion deserted /
  // betrayed you, an honest words-only read. Null on any other turn, so an ordinary scene is untouched.
  const social = socialLine(state, graph);
  const people = peopleLine(state, graph);
  const shelter = shelterLine(state);
  const story = storyLine(state);
  const moral = humanityBand(state);
  const atmosphere = atmosphereLine(state);
  const narration = [event, lead, halluc, cure, radio, economy, jobs, social, people, shelter, story, moral, atmosphere, setting].filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");

  return { turn, day, hour, phase, location: here, narration, choices: availableActions(state, graph) };
}
