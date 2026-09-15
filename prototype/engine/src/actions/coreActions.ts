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
import { nodesWithin } from "../map/fogOfWar.js";
import { discoverAround, scoutFrom, isScouted, scoutIsFresh, markScoutedHere } from "../map/fogOfWar.js";
import { resolveSearch, richnessAuthored, richnessOf, searchYieldCap } from "../sim/loot.js";
import { dropItem, dropArtifact, inventoryWeight, itemName, CARRY_CAPACITY, PACK_HEAVY } from "../sim/inventory.js";
import { NOISE_SEARCH } from "../sim/noise.js";
import { phaseSearchNoise } from "../sim/timeOfDay.js";
import { profileOf, scaleInt } from "../sim/difficulty.js";
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
// NOTE: `effectiveDisposition` is deliberately NOT read here. The standing-hostile branch a few
// lines below `continue`s before this point is ever reached, so calling it would be dead code dressed
// up as a guarantee — mutation testing proved the call equivalent to the plain authored read.
import { standingIsHostile, standingLine } from "../sim/reputation.js";
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
import { projectChoices, isProjectAction, resolveProjectAction, projectLine } from "../sim/project.js";
import { standIsOpen, standChoices, standNarration, isStandAction, resolveStandAction } from "../sim/stand.js";
import { closingNarration } from "../sim/ending.js";

// The core action time costs moved to the leaf module `actions/costs.ts` (T77) so the combat layer —
// which `coreActions` imports, and which must define `SLIP_COST` as `MOVE_COST + 1` — can read them
// without closing an import cycle. Re-exported here so every existing importer is unchanged.
export { MOVE_COST, SEARCH_COST, REST_COST, DROP_COST, SCOUT_COST, NOTE_COST } from "./costs.js";
import { MOVE_COST, SEARCH_COST, REST_COST, DROP_COST, SCOUT_COST, NOTE_COST } from "./costs.js";

/**
 * How much a single search advances a node's searchPct (**six** searches exhaust a node).
 *
 * **34 -> 17 (M5 task T59), set together with `SEARCH_COST` 2 -> 1.** The pair holds the node's time
 * economy EXACTLY: a node took 3 searches x 2h = 6h to strip clean before this task and takes 6 x 1h =
 * 6h after it. Nothing about how long the city takes to pick over changed; what changed is that the
 * player gets **six decisions where they had three**, which is the only lever in the build that buys
 * run length in *decisions* (the GDD's "full run: 2-6 hours") without buying it in survival hours.
 *
 * It matters because the search verb is rarer than its central place in the game suggests: measured
 * pre-T59 over 120 runs across five policies (`measure/t59.ts`), `search` was offered on **28.1% of
 * turns** — a fight, a walker, an active encounter or a node already stripped pre-empt it — and taken
 * **3.5 times in a whole run**, which is the entire scavenging content of a life. After T59 it is
 * offered on 31.2% of turns and taken 6.2 times — the offer rate barely moves, because what pre-empts
 * a search is a fight or a walker, not the clock; what moved is how much of a node is left to search.
 *
 * `claim` requires `searchPct >= 100`, so a safehouse now costs six searches rather than three; the
 * settler policy's claim rate moves **83.3% -> 62.5%** of runs, which is a price paid deliberately for
 * the decisions (and measured, rather than discovered later). PL-M5-57/58 already record that the base
 * layer does not bind for want of materials rather than for want of a base, so this is the cheaper of
 * the two things to spend.
 */
export const SEARCH_GAIN = 17;

/**
 * How far the `scout` verb sees (M5 task T84 · FR-MAP-02). Two route steps: one further than arriving
 * somewhere already gives you for free, so the verb buys a frontier the walk does not.
 */
export const SCOUT_HOPS = 2;

/**
 * The notes a player can pin to a node (M5 task T84 · GDD Part VII design rule 5, Principle 3).
 *
 * `NodeState.playerNotes` has been in the shape since T3 and the map screen has advertised the verb in
 * so many words — *"Travel (with its time and noise) and add-a-note appear in your choices"* — since
 * T54, while the field had **exactly one writer in the engine: the seed, writing `[]`** (PL-M4-46,
 * verified `measure/t84.ts`). This is that line made true.
 *
 * A fixed phrase set rather than free text, because the engine's contract is a *choice* list: the
 * client picks an id, it does not type. The engine still accepts any string on `params.text`, so a GUI
 * client can offer the handwriting the GDD describes — these are what the text harness can offer, and
 * they are the GDD's own examples ("safehouse here", "gun store, came back empty").
 *
 * **Exactly one is ever offered at a time**, chosen from the node by `noteFor` — see the offer site.
 */
export const NOTE_PHRASES = {
  safehouse: "safehouse here",
  empty: "came back empty",
  again: "worth another look",
  dead: "dead here — careful",
} as const;

/** Every phrase the text harness can pin, for a client that wants to render the vocabulary. */
export const NOTE_PHRASE_LIST: readonly string[] = Object.values(NOTE_PHRASES);

/** Longest note the engine will store, so a hand-edited save cannot put a novel in a node. */
export const NOTE_MAX_LENGTH = 120;
/**
 * Most notes one node will hold. A **backstop, not a working limit**: the harness offers four distinct
 * phrases and `noteFor` stops offering once the node carries them all, so on the shipped vocabulary the
 * `.slice()` below can never truncate. It exists for the free-text path a GUI client can use
 * (`params.text` accepts any string), which has no such ceiling.
 */
export const NOTE_MAX_PER_NODE = 6;
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

  // **The Last Stand (T62 · FR-CBT-10 · PL-M5-44).** A death no longer ends the run on the frame it
  // lands: it opens one heightened turn in which the survivor spends whatever they have left. This sits
  // ABOVE the run-over check because the two are mutually exclusive by construction — `runEndReason`
  // returns null for exactly the window `standIsOpen` is true — and above the overrun and combat
  // branches because nothing outranks dying. Every act on the menu ends the run, so the window cannot
  // be held open, and the menu always carries the floor act, so this branch can never hand back an
  // empty list (the T57 exit-gate invariant, in the one place a player can least afford to lose it).
  if (standIsOpen(state)) return standChoices(state, graph);
  if (isRunOver(state)) return []; // the run has ended — nothing follows it (a death T22, or a T87 win)
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
    // T84: what you know about where you are going. A node you have SCOUTED (stood in, or looked at
    // from a block away) reports its dead before you commit two hours to walking in; a merely
    // *discovered* one is a name and a direction, which is all walking ever bought you. This is the
    // whole return on `scout` — the reveal radius is the cheap half (see `map/fogOfWar.ts#scoutFrom`).
    // Only a FRESH look is quoted. The count itself is read live, which is why the freshness window
    // matters: without it a node glanced at on day one went on reporting its day-four population, which
    // is a surveillance channel the game does not otherwise have. A stale mark says so and no more.
    const intel = scoutIsFresh(neighbor, state.meta.day)
      ? neighbor.walkers > 0
        ? ` — ${neighbor.walkers === 1 ? "one of the dead" : `${neighbor.walkers} dead`} standing there`
        : " — you looked: it is quiet"
      : isScouted(neighbor)
        ? " — you have been, but not lately"
        : "";
    choices.push({
      id: `move:${to}`,
      label: `Travel to ${name}${suffix}${intel}`,
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
    // T84: say when a place has nothing left to give. Searching a stripped node is NOT a dead
    // affordance — it still advances `searchPct`, which is the prerequisite for claiming a safehouse —
    // but it will not pay in goods, and a Scene that offers two hours and 25 noise without saying so is
    // lying by omission. Measured: at full regional stock 11 of 180 (node, searchPct) pairs on the
    // shipped city have a zero cap, rising as the district thins — and the pre-T84 tree reaches 32 of
    // 180 once a region is down to a third, so this is a pre-existing shape that per-node richness
    // makes visible earlier, not one it invents.
    //
    // T60: the label reads the DIFFICULTY DIAL too, because T60 re-sited `lootYield` onto the
    // points→items conversion and re-opened this exact dishonesty for two of the four modes. On
    // Hardcore and Nightmare a node whose cap is 1 can only ever offer one point, which scales to a
    // haul of zero — the node is unyieldable and was still advertised as "Search A". `scaleInt` is the
    // best case (the cap, not the draw), so this says "it looks stripped" only when NO draw could pay,
    // never when an unlucky one merely did not. Survivor / unset short-circuits to the T84 test
    // exactly. This is the T56 gate formula in its proper place: an honest label, not the dial itself.
    const stock = state.regions[node.regionId]?.loot ?? 0;
    const cap = searchYieldCap(stock, node.searchPct, richnessAuthored(graph) ? richnessOf(graph, here) : undefined);
    const yieldable = scaleInt(cap, profileOf(state).lootYield) > 0;
    const searchLabel = yieldable ? `Search ${name}` : `Search ${name} — it looks stripped`;
    choices.push({ id: "search", label: searchLabel, timeCost: SEARCH_COST, action: searchAction });
  }

  // Scout (T84 · FR-MAP-02): one hour, no noise, look two route steps out. Offered only while there is
  // something left to look at — a neighbourhood already scouted to the last block would be an hour spent
  // on nothing, and a choice that cannot change the state is the dead affordance this task is here to
  // remove, not add. Placed after `search` so the explore branch reads walk / search / look / eat.
  if (unscoutedWithin(state, graph, here) > 0) {
    choices.push({
      id: "scout",
      label: "Scout the surrounding blocks",
      timeCost: SCOUT_COST,
      action: { type: "scout", choiceId: "scout", timeCost: SCOUT_COST, params: { noise: 0 } },
    });
  }

  // Add a note (T84 · GDD Part VII rule 5): the map is a journal, and until now nothing could write in
  // it. Free (the T18 pack-management rule) and — deliberately — **exactly one choice**, carrying the
  // phrase this place has earned (`noteFor`). The first cut offered every phrase in the vocabulary on
  // every quiet turn — four extra lines on a screen FR-UI-01 asks to hold one decision, and a
  // random-picking bot would have journalled instead of playing a proportionate share of the time, an
  // instrument defect of exactly the T81 class. Caught by `loop.test.ts` before it reached a
  // measurement, which is the assertion earning its keep.
  const noteText = noteFor(state, graph, node);
  if (noteText !== null) {
    choices.push({
      id: "note",
      label: `Note on the map: "${noteText}"`,
      timeCost: NOTE_COST,
      action: { type: "note", choiceId: "note", timeCost: NOTE_COST, params: { text: noteText } },
    });
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
  for (const choice of shelterChoices(state, graph)) choices.push(choice);

  // Shared stash (T39 · FR-SHL-03/FR-PLR-04): bank surplus at the base or pull it back. Offered only while
  // standing in your own shelter, per carried/stashed stack, free like the T18 drop — inert everywhere else.
  for (const choice of stashChoices(state)) choices.push(choice);

  // Authored story (T40 · FR-STORY-01): a live arc beat's costed choices — e.g. the plea at your base.
  // Surfaced in the same at-your-place block; inert unless an arc has a decision waiting here.
  for (const choice of storyChoices(state)) choices.push(choice);

  // People here (T35 · FR-NPC): talk / share / threaten / recruit a survivor present, or feed a companion.
  // Offered in the explore branch only — an active fight or loitering walkers pre-empt it above — and
  // appended after the survival verbs so the world-danger and self-care choices lead the list.
  for (const choice of encounterPeople(state, graph)) choices.push(choice);

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

  // The terminal project (T87 · FR-STY-06 groundwork · GDD XVI "Legacy"). Appended near the end because
  // it is the one thing on the list that is not about getting through today: the survival verbs lead, and
  // the way out sits under them. Empty unless the content set authors projects AND the player is standing
  // in their own base. See `sim/project.ts`.
  for (const choice of projectChoices(state, graph)) choices.push(choice);

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
  // Arriving still reveals one hop — the brief proposed removing that and the measurement refused it
  // (travel already offers nothing on 52.7% of turns, and `move` requires `discovered`). What arriving
  // does NOT do is tell you about the neighbours: only the node you are standing in is marked looked-at
  // (T84), which is what leaves `scout` something to sell.
  const revealed = discoverAround({ ...state.nodes, [to]: visited }, graph, to);
  const nodes = markScoutedHere(revealed, to, state.meta.day);
  return { ...state, player: { ...state.player, location: to }, nodes };
}

/**
 * The one phrase this place has earned, or null when the node already carries everything it could say
 * (or is full). The map is a journal, not a form: what the player pins should be *about here*, which
 * is why this reads the node rather than offering a menu.
 *
 * Ordered most-specific first, so a defensible node the player has just fought over reads as the
 * warning it is rather than as an estate agent's note.
 */
function noteFor(state: GameState, graph: RegionGraph, node: GameState["nodes"][string]): string | null {
  const notes = node.playerNotes ?? [];
  if (notes.length >= NOTE_MAX_PER_NODE) return null;
  const here = state.player.location;
  const candidates: string[] = [];
  // `walkers > 0` is deliberately NOT read here: `availableActions` hands that state to
  // `encounterChoices` before the explore branch is reached, so a note is never offered at a contested
  // node and a condition on it would be unreachable (an audit caught the first cut asserting it).
  // Bodies on the floor are a different thing — they outlive the fight, which is the point of T84
  // writing `corpses` at all.
  if (node.corpses > 0) candidates.push(NOTE_PHRASES.dead);
  if (graph.nodes[here]?.claimable === true && state.player.shelterId !== here) candidates.push(NOTE_PHRASES.safehouse);
  if (node.searchPct >= 100) candidates.push(NOTE_PHRASES.empty);
  // The fallback, and the only phrase that needs no condition. The first cut pushed it twice — once
  // behind `0 < searchPct < 100`, once unconditionally — which was exactly redundant.
  candidates.push(NOTE_PHRASES.again);
  for (const text of candidates) if (!notes.includes(text)) return text;
  return null;
}

/**
 * How many nodes within {@link SCOUT_HOPS} of `from` the player has not yet looked at — the gate on
 * offering `scout` at all, and the reason the verb quietly disappears once a neighbourhood is known.
 */
function unscoutedWithin(state: GameState, graph: RegionGraph, from: NodeId): number {
  let n = 0;
  for (const id of nodesWithin(graph, from, SCOUT_HOPS)) {
    if (id === from) continue; // you are standing in it; looking again buys nothing
    const node = state.nodes[id];
    // A place never looked at, or one whose look has gone stale, is a place worth the hour.
    if (node !== undefined && !scoutIsFresh(node, state.meta.day)) n += 1;
  }
  return n;
}

/**
 * Apply a scout: everything within {@link SCOUT_HOPS} becomes discovered and scouted (T84). Costs an
 * hour and deposits no noise (the action carries `params.noise: 0`, which stage 6 honours), so it is
 * the one explore verb that leaves the block exactly as quiet as it found it.
 */
function applyScout(state: GameState, graph: RegionGraph): GameState {
  const nodes = scoutFrom(state.nodes, graph, state.player.location, SCOUT_HOPS, state.meta.day);
  return nodes === state.nodes ? state : { ...state, nodes };
}

/**
 * Apply a note: pin the player's own words to this node (T84 · GDD Part VII rule 5). Trimmed, length-
 * capped and de-duplicated; the oldest falls off once the node holds {@link NOTE_MAX_PER_NODE}. Total
 * about its input because a hand-edited save reaches here — an empty or non-string `text` writes
 * nothing rather than pinning `undefined` to the map.
 */
function applyNote(state: GameState, text: unknown): GameState {
  if (typeof text !== "string") return state;
  const trimmed = text.trim().slice(0, NOTE_MAX_LENGTH);
  if (trimmed.length === 0) return state;
  const here = state.player.location;
  const node = state.nodes[here];
  if (node === undefined) return state;
  const existing = node.playerNotes ?? [];
  if (existing.includes(trimmed)) return state;
  const notes = [...existing, trimmed].slice(-NOTE_MAX_PER_NODE);
  return { ...state, nodes: { ...state.nodes, [here]: { ...node, playerNotes: notes } } };
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
  if (isShelterAction(action)) return resolveShelterAction(state, action, graph);
  if (isStashAction(action)) return resolveStashAction(state, action);
  if (isGearAction(action)) return resolveGearAction(state, action);
  if (isStoryAction(action)) return resolveStoryAction(state, action);
  if (isInfectionAction(action)) return resolveInfectionAction(state, action);
  if (isRadioAction(action)) return resolveRadioAction(state, graph, action);
  if (isEconomyAction(action)) return resolveEconomyAction(state, graph, action);
  if (isJobAction(action)) return resolveJobAction(state, graph, action);
  if (isProjectAction(action)) return resolveProjectAction(state, graph, action);
  if (isStandAction(action)) return resolveStandAction(state, graph, action);
  switch (action.type) {
    case "move": {
      const to = action.params?.["to"];
      return typeof to === "string" ? applyMove(state, graph, to) : state;
    }
    case "scout":
      return applyScout(state, graph);
    case "note":
      return applyNote(state, action.params?.["text"]);
    case "search": {
      const searched = applySearch(state);
      const kind = graph.nodes[state.player.location]?.kind;
      // The scavenged radio (T50) is findable only when the radio system is active (a signals pool is
      // registered); the economy items (T51 — components / blueprints / fresh food / dirty water) only
      // when a recipe pool is. Both additive and gated, so a run with neither draws byte-identically (loot.ts).
      // T81: weapons are placed only when the weapon content set is registered (`graph.weapons`), and
      // then the table is drawn by WEIGHT rather than uniformly — one `drawInt` step either way, so a
      // pool-less run still draws bit-for-bit as before.
      // T84: the node's own authored depth, behind the active-system gate — a content set that authors
      // no `richness` computes the identical pre-T84 cap, so every fixture stays byte-identical.
      const richness = richnessAuthored(graph) ? richnessOf(graph, state.player.location) : undefined;
      return resolveSearch(
        searched,
        state.player.location,
        kind,
        radioPool(graph).length > 0,
        economyActive(graph),
        weaponsActive(graph),
        richness,
      ).state;
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
    // T86 · a door the STANDING closed, not the trust. The Scene has to say which, or the player is
    // looking at a survivor who was friendly an hour ago and has no idea why the choices went away
    // (the T85 "when the engine acquires a constraint, the screen acquires the sentence" rule).
    if (standingIsHostile(state, graph, id)) {
      bits.push(`${standingLine(state, graph, id, n.name) ?? `${n.name} wants nothing to do with you.`}${npcNeedRead(n)}`);
      continue;
    }
    // A met survivor's attitude toward you (T53 · FR-NPC-02): respect/fear surfaced as behaviour, never a
    // number. Gated on the social system; a survivor you've done nothing to reads by disposition alone (T35).
    const att = n.met && socialActive(graph) ? attitudeRead(n) : null;
    // How their PEOPLE hold you (T86) — added only when the faction has a strong view, so an unknown
    // standing reads exactly as it did before.
    const standing = socialActive(graph) ? standingLine(state, graph, id, n.name) : null;
    bits.push(
      n.met
        ? `${n.name} is here${npcNeedRead(n)}${att !== null ? `, ${att}` : ""}.`
        : `Someone is here — ${n.name}, ${dispositionRead(n.disposition)}${npcNeedRead(n)}.`,
    );
    if (standing !== null) bits.push(standing);
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

  // T62: the survivor is dying but has not yet spent their last turn. The scene is the heightened one,
  // and the choices are the final ones — this is the whole of "death is a scene, not a card". `lines[0]`
  // of that narration is byte-for-byte the sentence this branch used to print below, so the authored
  // death scenes are extended rather than replaced (T61's gate, reused).
  const standing = standNarration(state, graph);
  if (standing !== null) {
    return { turn, day, hour, phase, location: here, narration: standing, choices: standChoices(state, graph) };
  }

  // The run has ended (T22): narrate how — a death, or since T87 a way out taken, offer nothing further.
  const end = runEndReason(state);
  if (end !== null) {
    // T61: the run closes on an ending ASSEMBLED from what it actually was — the shape it resolved into
    // plus the strongest clauses the run earns — when the client registered an `content/endings/` pool.
    // Without one, `closingNarration` is the identical pre-T61 expression: the finished project's own
    // words for a win (falling back so a won run is never an empty string), the authored death scene
    // otherwise. The whole gate lives in that one function, and its first line is byte-for-byte the line
    // this branch printed before, so the authored scenes are extended rather than replaced.
    const closing = closingNarration(state, graph, end);
    return { turn, day, hour, phase, location: here, narration: closing, choices: [] };
  }

  const name = graph.nodes[here]?.name ?? here;
  const threat = combatNarration(state);
  const where = graph.nodes[here]?.description ?? "";
  const searched =
    node.searchPct >= 100 ? " It has been searched clean." : node.searchPct > 0 ? " You have searched here before." : "";
  // A full pack is world feedback (you can't take more) — surface it in prose; the precise pack
  // count is the client's to render (T18/T19). Only the qualitative "full" belongs in narration.
  //
  // T84 added the middle band, and it is not decoration. A search now hands over a HAUL rather than a
  // single token find, so the pack stops the search part-way far more often than it used to — measured,
  // turns at or over PACK_HEAVY went from 0.7% to 11.3%. Without a word for "there is nearly no room
  // left" the player would simply receive less from each search and never be told why. Still
  // qualitative, still state-derived, still one clause.
  const room = CARRY_CAPACITY - inventoryWeight(state.player.inventory);
  const pack =
    room <= 0
      ? " Your pack is full."
      : inventoryWeight(state.player.inventory) >= PACK_HEAVY
        ? " Your pack has barely any room left in it."
        : "";
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
  const shelter = shelterLine(state, graph);
  // The terminal project (T87): what the base is for, or what the next stage is waiting on. Empty on
  // every turn there is nothing to say — and, per T86's audit finding 4, NOT empty on the turn a stage
  // is priced out of reach, because a verb that silently stops being offered tells the player nothing.
  const project = projectLine(state, graph);
  const story = storyLine(state);
  const moral = humanityBand(state);
  const atmosphere = atmosphereLine(state);
  const narration = [event, lead, halluc, cure, radio, economy, jobs, social, people, shelter, project, story, moral, atmosphere, setting].filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");

  return { turn, day, hour, phase, location: here, narration, choices: availableActions(state, graph) };
}
