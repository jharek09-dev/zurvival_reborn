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

import type { GameState, NodeId } from "../state/types.js";
import type { Action, Scene, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { discoverAround } from "../map/fogOfWar.js";
import { resolveSearchLoot } from "../sim/loot.js";
import { dropItem, inventoryWeight, itemName, CARRY_CAPACITY, PACK_HEAVY } from "../sim/inventory.js";
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
  if (node.walkers > 0) return encounterChoices(state, graph);

  const choices: SceneChoice[] = [];

  for (const to of [...neighborsOf(graph, here)].sort()) {
    const neighbor = state.nodes[to];
    if (neighbor !== undefined && neighbor.discovered) {
      const name = graph.nodes[to]?.name ?? to;
      choices.push({
        id: `move:${to}`,
        label: `Travel to ${name}`,
        timeCost: MOVE_COST,
        action: { type: "move", choiceId: `move:${to}`, timeCost: MOVE_COST, params: { to } },
      });
    }
  }

  if (node.searchPct < 100) {
    const name = graph.nodes[here]?.name ?? here;
    choices.push({
      id: "search",
      label: `Search ${name}`,
      timeCost: SEARCH_COST,
      action: { type: "search", choiceId: "search", timeCost: SEARCH_COST },
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

  choices.push({
    id: "rest",
    label: "Rest and recover",
    timeCost: REST_COST,
    action: { type: "rest", choiceId: "rest", timeCost: REST_COST },
  });

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
  // action (bare `wait`) changes nothing, preserving the M0 empty-turn contract.
  return updateCondition(state, action);
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

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
  const narration = threat ? `${threat} ${setting}` : setting;

  return { turn, day, hour, phase, location: here, narration, choices: availableActions(state, graph) };
}
