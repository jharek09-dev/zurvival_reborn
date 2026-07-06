/**
 * Noise deposit model — the FR-SIM-06 sound layer (M1 task T14 · DESIGN §5, §6).
 *
 * Every place remembers how loud it was made to be. A loud action (searching, moving through
 * rubble, and — from T15 — firing a gun) *deposits* noise into the acting node's memory; time
 * passing *decays* it. This is the deposit + decay half of the model; the consumer — hordes that
 * re-path toward a fresh gunshot — arrives in M2 (pipeline stage 9). The invariant this task must
 * prove now is the one the Loop-Feel Check leans on: **the quiet path is legibly quieter.** A run
 * that rests and picks careful routes leaves far less sound behind than one that rummages every
 * node, and that difference is real state a later system can read.
 *
 * Noise lives in `NodeState.noise` (0–100 int, per the T3 shape). This module owns only the
 * numbers and the two pure transforms; the pipeline sequences them in stage 6 (`updateNode`):
 * decay every node by the hours the turn spent, *then* deposit the action's noise at the node the
 * player now stands on. Decay-before-deposit is deliberate — it keeps a just-made sound at full
 * strength for the next turn's read, exactly the "gunshot this turn → horde next turn" timing in
 * DESIGN §5.
 *
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). No clock, no RNG.
 */

import type { GameState, NodeId } from "../state/types.js";
import type { NodeMap } from "../map/fogOfWar.js";
import type { Action } from "../pipeline/contract.js";

/**
 * Noise (0–100) an action emits at the node where it is performed. Silence is the quiet path;
 * rummaging carries; moving through a broken city makes some sound. Firearms (T15) are far louder
 * and pass their level explicitly via `action.params.noise`, so this table stays about the core
 * loop and the combat layer owns its own volume.
 */
export const NOISE_MOVE = 8;
export const NOISE_SEARCH = 25;
export const NOISE_REST = 0;

/** Noise fades by this many points per in-game hour that passes, floored at 0. */
export const NOISE_DECAY_PER_HOUR = 5;

/** Clamp to a 0–100 integer — the discipline every sim quantity keeps. */
export function clampNoise(n: number): number {
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

/**
 * How loud an action is at the node it happens in. `move`/`search`/`rest` use the table above; a
 * `wait` (or anything unknown) is silent. An action may override with an integer `params.noise`
 * (used by firearms in T15) — the override wins so the combat layer can be as loud as it needs.
 */
export function noiseOf(action: Action): number {
  const override = action.params?.["noise"];
  if (typeof override === "number") return clampNoise(override);
  switch (action.type) {
    case "search":
      return NOISE_SEARCH;
    case "move":
      return NOISE_MOVE;
    default:
      return NOISE_REST; // rest, wait, and any silent action
  }
}

/**
 * Decay every node's noise by the hours elapsed. Returns a new `nodes` map, or the same reference
 * when nothing was loud enough to still be decaying (so a quiet world allocates nothing). Pure.
 */
export function decayAllNoise(nodes: NodeMap, hours: number): NodeMap {
  const drop = Math.max(0, Math.trunc(hours)) * NOISE_DECAY_PER_HOUR;
  if (drop === 0) return nodes;
  let changed = false;
  const next: Record<NodeId, NodeMap[string]> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.noise > 0) {
      next[id] = { ...node, noise: clampNoise(node.noise - drop) };
      changed = true;
    } else {
      next[id] = node;
    }
  }
  return changed ? next : nodes;
}

/**
 * Add `amount` of noise at one node (clamped). Returns a new `nodes` map, or the same reference if
 * the node is absent or the deposit is zero. Pure.
 */
export function depositNoiseAt(nodes: NodeMap, nodeId: NodeId, amount: number): NodeMap {
  const node = nodes[nodeId];
  if (node === undefined || amount <= 0) return nodes;
  return { ...nodes, [nodeId]: { ...node, noise: clampNoise(node.noise + amount) } };
}

/**
 * The body of pipeline stage 6 (`updateNode`) for the noise layer: decay the whole map by the
 * hours the action spent, then deposit that action's noise at the player's current node (their
 * location is already the move destination by stage 6). Pure transform of `GameState`; a zero-cost,
 * silent action (`wait`) returns the state untouched, preserving the M0 empty-turn contract.
 */
export function updateNodeNoise(state: GameState, action: Action): GameState {
  const hours = Math.max(0, Math.trunc(action.timeCost ?? 0));
  const decayed = decayAllNoise(state.nodes, hours);
  const nodes = depositNoiseAt(decayed, state.player.location, noiseOf(action));
  if (nodes === state.nodes) return state;
  return { ...state, nodes };
}
