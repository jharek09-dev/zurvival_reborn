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
import { dropItem, inventoryWeight, itemName, CARRY_CAPACITY, PACK_HEAVY } from "../sim/inventory.js";
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
import { encounterPeople, isEncounterAction, resolveEncounterAction } from "../sim/encounters.js";
import {
  shelterChoices,
  shelterLine,
  isShelterAction,
  resolveShelterAction,
  applyShelterRest,
} from "../sim/shelter.js";
import { stashChoices, isStashAction, resolveStashAction } from "../sim/stash.js";
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

/** Time cost, in in-game hours, of each core action (FR-CORE-03). */
export const MOVE_COST = 2;
export const SEARCH_COST = 3;
export const REST_COST = 6;
/** Managing the pack costs no in-game time (T18). */
export const DROP_COST = 0;

/** How much a single search advances a node's searchPct (3 searches exhaust a node). */
export const SEARCH_GAIN = 34;
/** Fatigue a single rest recovers — re-exported from the survival module (T22 owns needs). */
export { REST_RECOVERY } from "../sim/survival.js";

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

  // Drop a carried item to reclaim weight (T18 · FR-PLR-03) — the leave-behind lever. Surfaced only
  // when the pack is heavy (>= PACK_HEAVY): below that there's ample room, so drops would just clutter
  // the single-decision screen (FR-UI). One choice per non-unique stack, stable-ordered by type; free.
  if (node && inventoryWeight(state.player.inventory) >= PACK_HEAVY) {
    for (const type of [...new Set(state.player.inventory.filter((e) => e.itemId === undefined).map((e) => e.type))].sort()) {
      choices.push({
        id: `drop:${type}`,
        label: `Drop ${itemName(type)}`,
        timeCost: DROP_COST,
        action: { type: "drop", choiceId: `drop:${type}`, timeCost: DROP_COST, params: { item: type } },
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
  if (isCombatAction(action)) return resolveCombatAction(state, graph, action);
  if (isEventAction(action)) return resolveEventAction(state, graph, action);
  if (isEncounterAction(action)) return resolveEncounterAction(state, action);
  if (isCompanionOrderAction(action)) return resolveCompanionOrder(state, action);
  if (isShelterAction(action)) return resolveShelterAction(state, action);
  if (isStashAction(action)) return resolveStashAction(state, action);
  if (isStoryAction(action)) return resolveStoryAction(state, action);
  if (isInfectionAction(action)) return resolveInfectionAction(state, action);
  switch (action.type) {
    case "move": {
      const to = action.params?.["to"];
      return typeof to === "string" ? applyMove(state, graph, to) : state;
    }
    case "search": {
      const searched = applySearch(state);
      const kind = graph.nodes[state.player.location]?.kind;
      return resolveSearchLoot(searched, state.player.location, kind);
    }
    case "drop": {
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

  // 1. A horde bearing down — at, next to, or headed for this node.
  if (state.hordes.some((h) => h.pos === here || neighbours.has(h.pos) || h.dest === here)) {
    return "You hear them before you see them — a horde on the move, and it is coming this way.";
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
function peopleLine(state: GameState): string | null {
  const here = state.player.location;
  const bits: string[] = [];

  // Companions with you, named, with their standing order read in words (T45 · closes the "your companion" gap).
  for (const c of companionsHere(state, here)) {
    const order = orderOf(c);
    const doing =
      order === "hold" ? " — holding here" :
      order === "guard" ? " — guarding the base" :
      order === "scavenge" ? " — ranging out for the base" : "";
    bits.push(`${companionName(c)} is with you${doing}.`);
  }

  let witness = companionsHere(state, here).length > 0;
  for (const id of Object.keys(state.npcs).sort()) {
    const n = state.npcs[id]!;
    if (n.location !== here) continue;
    if (!n.alive) { bits.push(`${n.name} lies where they fell.`); continue; }
    witness = true;
    if (!canParley(n)) { bits.push(`${n.name} will not meet your eye — past talking now.`); continue; }
    bits.push(
      n.met
        ? `${n.name} is here${npcNeedRead(n)}.`
        : `Someone is here — ${n.name}, ${dispositionRead(n.disposition)}${npcNeedRead(n)}.`,
    );
  }

  // Others react to the visible sign of infection on you (T49 · FR-INJ-06): companions grow afraid,
  // strangers keep their distance. Only when someone is here to see it and the sign actually shows
  // (symptomatic+); null while healthy/asymptomatic so no prior scene is touched.
  const sign = infectionSign(state);
  if (witness && sign !== null) bits.push(`Those here keep their distance, wary of ${sign}.`);

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
  const lead = threat ?? worldLead(state, graph);
  // Infection perception distortion (T49 · FR-INJ-06): at advanced/terminal the scene grows unreliable —
  // a hallucinated lead or a memory gap, framed as possibly-unreal. Suppressed whenever a REAL danger lead
  // is on the board, so a hallucinated "you hear them massing" can never sit beside — and undermine — a
  // genuine horde read (fairness). It colours only the quiet, never fabricates a real threat
  // (availableActions still keys off real state). Stateless/pure — no rng advance in a render.
  const halluc = lead === null ? perceptionDistortion(state) : null;
  // Honest, no-number feedback on a cure/quarantine taken THIS turn (did it clear / ease / merely hold?).
  const cure = infectionOutcomeLine(state);
  const people = peopleLine(state);
  const shelter = shelterLine(state);
  const story = storyLine(state);
  const moral = humanityBand(state);
  const atmosphere = atmosphereLine(state);
  const narration = [event, lead, halluc, cure, people, shelter, story, moral, atmosphere, setting].filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");

  return { turn, day, hour, phase, location: here, narration, choices: availableActions(state, graph) };
}
