/**
 * The core action loop — move / search / rest (M1 task T12 · FR-CORE-01,02,03,05,07 · FR-MAP-03).
 *
 * This is the real body of the pipeline's player-facing stages: it decides which actions a node
 * offers (`availableActions`), rejects an action that wasn't offered (`assertLegal` — enforces
 * the "no direct choice→scene edge", FR-CORE-01), applies the chosen action's world effect
 * (`applyPlayerAction`), drifts the player's needs by the hours spent (`tickNeeds`), and renders
 * the next Scene answering the Four Questions (`sceneOf`, FR-CORE-05).
 *
 * Costs: moving a route, searching a node, and resting each spend hours (FR-CORE-03), so time
 * always advances and every resolved action changes at least one system (needs always drift;
 * moving changes location + node memory + fog; searching changes node memory; resting recovers
 * fatigue). Pure and deterministic — no RNG here (loot/encounter rolls arrive in later tasks).
 */

import type { GameState, NodeId } from "../state/types.js";
import type { Action, Scene, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { discoverAround } from "../map/fogOfWar.js";

/** Time cost, in in-game hours, of each core action (FR-CORE-03). */
export const MOVE_COST = 2;
export const SEARCH_COST = 3;
export const REST_COST = 6;

/** How much a single search advances a node's searchPct (3 searches exhaust a node). */
export const SEARCH_GAIN = 34;
/** Fatigue a single rest recovers. */
export const REST_RECOVERY = 40;

/** Thrown when a submitted action was not among the Scene's offered choices (FR-CORE-01). */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * The actions the player may take from their current node, in a stable order (moves first, by
 * target id, then search, then rest). Moves are offered only to *discovered* neighbors — you can
 * travel to somewhere you know exists (FR-MAP-02/03). Empty when the player is not on a real node
 * (e.g. the pre-content skeleton), which is what keeps an empty run's Scene empty.
 */
export function availableActions(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const here = state.player.location;
  const node = state.nodes[here];
  if (node === undefined) return [];

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

  choices.push({
    id: "rest",
    label: "Rest and recover",
    timeCost: REST_COST,
    action: { type: "rest", choiceId: "rest", timeCost: REST_COST },
  });

  return choices;
}

/** Reject an action the current node did not offer (stage 1, FR-CORE-01). */
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
 * Apply the chosen action's world effect (stage 3). Rest has no world effect — its recovery is a
 * player-needs change handled by {@link tickNeeds}. Unknown/`wait` actions are inert.
 */
export function applyPlayerAction(state: GameState, graph: RegionGraph, action: Action): GameState {
  switch (action.type) {
    case "move": {
      const to = action.params?.["to"];
      return typeof to === "string" ? applyMove(state, graph, to) : state;
    }
    case "search":
      return applySearch(state);
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
  const hours = Math.max(0, Math.trunc(action.timeCost ?? 0));
  if (hours === 0) return state;

  const { needs } = state.player.condition;
  const hunger = clampPct(needs.hunger + hours);
  const thirst = clampPct(needs.thirst + hours);
  const fatigue =
    action.type === "rest" ? clampPct(needs.fatigue - REST_RECOVERY) : clampPct(needs.fatigue + hours);

  return {
    ...state,
    player: {
      ...state.player,
      condition: { ...state.player.condition, needs: { hunger, thirst, fatigue } },
    },
  };
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/**
 * Render the Scene for a state (stage 14, and the client's source for the *first* scene before
 * any action). With a graph and the player on a real node it answers the Four Questions; without
 * one it is the empty skeleton Scene (preserving the M0 contract). Pure — a projection of state.
 */
export function sceneOf(state: GameState, graph?: RegionGraph): Scene {
  const { turn, day, hour, phase } = state.meta;
  const here = state.player.location;
  const node = graph ? state.nodes[here] : undefined;

  if (graph === undefined || node === undefined) {
    return { turn, day, hour, phase, narration: "", choices: [] };
  }

  const name = graph.nodes[here]?.name ?? here;
  const where = graph.nodes[here]?.description ?? "";
  const searched =
    node.searchPct >= 100 ? " It has been searched clean." : node.searchPct > 0 ? " You have searched here before." : "";
  const narration = `${where}${searched} (Day ${day}, ${phase} ${pad2(hour)}:00 — at ${name}.)`;

  return { turn, day, hour, phase, location: here, narration, choices: availableActions(state, graph) };
}
