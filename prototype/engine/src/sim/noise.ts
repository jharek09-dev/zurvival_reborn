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

/**
 * Visible aftermath (`NodeState.blood`) fades by this many points per in-game hour (M5 task T84).
 *
 * Slower than sound by design, and the numbers are small, so state them rather than gesture: at
 * {@link BLOOD_PER_KILL} 18 and 2/hour, **one kill is visible for about nine hours and two for about
 * eighteen** — roughly twice as long as the noise that kill made (25 at 5/hour). That gap is the point:
 * a node still *looks* like something happened here after it has stopped sounding like it, which is the
 * only way the T25 `feeding` rung and the encounter `minBlood` gate can read as anything but a coin
 * flip. An earlier draft said "the better part of two days", which was simply wrong.
 *
 * **Blood is deposited in stage 3 (the kill) and decayed in stage 6, so some of a kill has already
 * dried by the end of the turn that made it** — a 2-hour fight leaves 14 of 18. Noise is the other way
 * round (decay, then deposit) and its module header explains why: a gunshot must stand at full strength
 * for the next turn's horde read. Blood has no such same-turn consumer, so the ordering is left as the
 * more physical one rather than special-cased, and it is declared here rather than discovered later.
 *
 * `NodeState.corpses` deliberately has no decay: bodies do not tidy themselves, and a node that has
 * been fought over stays a node that has been fought over for the rest of the run (GDD VII, "every
 * node remembers; nothing resets during a run").
 */
export const BLOOD_DECAY_PER_HOUR = 2;

/**
 * What one kill leaves on a node (M5 task T84). Both written by `combat/combat.ts#killEnemy`, the
 * single writer either field has ever had beyond the seed — before T84 the 2026-09 design review's
 * signal ledger listed both as **dead**, and `measure/t84.ts` confirmed one writer each.
 *
 * `CORPSES_PER_KILL` is 1 because it counts bodies and a kill produces one — not a dial.
 *
 * `BLOOD_PER_KILL` was swept at 6 / 12 / 18 / 30 against the one thing that reads it (the authored
 * `minBlood` gate on `encounter.common.the-killing-floor`). **6 is a guillotine** — two kills reach 12
 * and decay past the threshold of 10 within the hour, so the beat was eligible at 2 node-runs against
 * 49. **12, 18 and 30 are indistinguishable** on every consequence the build can currently read
 * (eligibility 50 / 49 / 49, fire rate 20 / 20 / 20 of 30 runs). 18 is therefore chosen for how long a
 * single kill stays visible (nine hours against six at 12) — a claim about headroom for a second
 * reader, not a measured improvement over 12, and it is worth saying which of those it is.
 * See `docs/qa/QA_REVIEW_T84.md`.
 */
export const CORPSES_PER_KILL = 1;
export const BLOOD_PER_KILL = 18;

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
  // T84: aftermath fades on the same clock, three times slower. It shares this stage rather than
  // taking one of its own because it is the same kind of quantity — a per-node trace of what happened,
  // decaying with the hours the turn spent — and one walk of the node map is cheaper than two.
  const faded = decayAllBlood(decayed, hours);
  const nodes = depositNoiseAt(faded, state.player.location, noiseOf(action));
  if (nodes === state.nodes) return state;
  return { ...state, nodes };
}

/**
 * Fade visible aftermath everywhere by the hours passed (T84). Same shape and same
 * same-reference-when-nothing-changed contract as {@link decayAllNoise}: a map with no blood on it
 * anywhere allocates nothing, which is what keeps the M0 empty turn and every pre-T84 fixture
 * byte-identical — `blood` is 0 on every node until something writes it.
 */
export function decayAllBlood(nodes: NodeMap, hours: number): NodeMap {
  const drop = Math.max(0, Math.trunc(hours)) * BLOOD_DECAY_PER_HOUR;
  if (drop === 0) return nodes;
  let changed = false;
  const next: Record<NodeId, NodeMap[string]> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.blood > 0) {
      next[id] = { ...node, blood: clampNoise(node.blood - drop) };
      changed = true;
    } else {
      next[id] = node;
    }
  }
  return changed ? next : nodes;
}
