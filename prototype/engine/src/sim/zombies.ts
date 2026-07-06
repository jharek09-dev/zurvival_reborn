/**
 * The zombie state machine + first distinct types (M2 task T25 · FR-CBT-06/07 · GDD IX).
 *
 * The walkers loitering at a node (`NodeState.walkers`, T15) were inert until the player arrived.
 * FR-CBT-06 makes them **simulated agents with states** — dormant, wandering, investigating, chasing,
 * feeding, hibernating — that transition on **senses**: what they *hear* (the T14 node noise), what
 * they can *reach* (the player at or next to the node), the *scent* of a bleeding player (GDD VI), and
 * the *time of day*. One aggregate `zombieState` per node (not per corpse) keeps the sim phone-cheap
 * while still giving the player a legible, systemic read — "the marina has woken up".
 *
 * FR-CBT-07 adds the first two distinct **types**, expressed as node `zombieTypes` and read here for
 * type-specific behaviour:
 *   - **Screamer** — harmless alone, but on reaching investigating/chasing it *rouses its neighbours*,
 *     depositing noise into adjacent nodes so the alarm cascades. The node-scale twin of a horde
 *     re-pathing to a gunshot (T26).
 *   - **Stalker** — patient and night-hunting: at night, with the player near, it drives hard toward
 *     chasing from a stimulus that would leave a plain node dormant by day.
 *
 * Arousal is a ladder — hibernating < dormant < wandering < investigating < chasing — that the dead
 * **snap up** when a stimulus spikes (a gunshot pulls them at once) and **relax down one rung per
 * tick** when it goes quiet (a nest you leave alone goes cold, eventually hibernating). Corpses divert
 * a roused node to *feeding*. The behaviour tags live here as engine constants — a bridge until a
 * zombie content table drives them (exactly as the T17 loot tables and the T15 walker stats do); the
 * matching `content/zombies/` defs ship for the schema gate and future content-driven tuning.
 *
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). No RNG, no clock — the machine is a
 * total function of the node's senses, so a seed reproduces every transition.
 */

import type { ContentId, GameState, NodeId, NodeState, ZombieState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { clampNoise } from "./noise.js";

/** The first three type ids (mirror `content/zombies/`). */
export const ZOMBIE_WALKER: ContentId = "zombie.walker";
export const ZOMBIE_SCREAMER: ContentId = "zombie.screamer";
export const ZOMBIE_STALKER: ContentId = "zombie.stalker";

/** Behaviour tags per type — the engine-side bridge until the content table drives tuning (ADR-0002). */
export interface ZombieBehaviour {
  /** On reaching investigating/chasing, deposit noise into neighbours (Screamer). */
  readonly rousesNeighbours: boolean;
  /** Hunts hard toward chasing at night when the player is near (Stalker). */
  readonly nightHunter: boolean;
}
export const ZOMBIE_BEHAVIOUR: { readonly [id: ContentId]: ZombieBehaviour } = {
  [ZOMBIE_WALKER]: { rousesNeighbours: false, nightHunter: false },
  [ZOMBIE_SCREAMER]: { rousesNeighbours: true, nightHunter: false },
  [ZOMBIE_STALKER]: { rousesNeighbours: false, nightHunter: true },
};

// --- stimulus thresholds & bonuses (tunable) ------------------------------------------------

/** Stimulus needed to reach each rung. */
export const WANDER_AT = 8;
export const INVESTIGATE_AT = 20;
export const CHASE_AT = 40;
/** Presence bonuses added to a node's ambient noise to form its stimulus. */
export const PLAYER_HERE_BONUS = 40;
export const PLAYER_ADJACENT_BONUS = 15;
export const SCENT_BONUS = 15;
/** A stalker's night-hunt bonus, and a screamer's per-neighbour noise deposit. */
export const STALKER_NIGHT_BONUS = 30;
export const SCREAM_NOISE = 20;

// --- the arousal ladder ---------------------------------------------------------------------

const RUNG: { readonly [s in ZombieState]: number } = {
  hibernating: 0,
  dormant: 1,
  wandering: 2,
  investigating: 3,
  chasing: 4,
  feeding: 3,
};
const BY_RUNG: readonly ZombieState[] = ["hibernating", "dormant", "wandering", "investigating", "chasing"];
const fromRung = (r: number): ZombieState => BY_RUNG[Math.max(0, Math.min(BY_RUNG.length - 1, r))]!;

/** The arousal rung a stimulus level pulls a node toward. */
export function desiredRung(stimulus: number): number {
  if (stimulus >= CHASE_AT) return 4;
  if (stimulus >= INVESTIGATE_AT) return 3;
  if (stimulus >= WANDER_AT) return 2;
  if (stimulus >= 1) return 1;
  return 0;
}

const hasTag = (node: NodeState, key: keyof ZombieBehaviour): boolean =>
  node.zombieTypes.some((t) => ZOMBIE_BEHAVIOUR[t]?.[key]);

/** Whether a node has any dead worth simulating (loitering walkers or a special type present). */
const isPresent = (node: NodeState): boolean => node.walkers > 0 || node.zombieTypes.length > 0;

/**
 * The stimulus a node feels this tick: its ambient noise, plus bonuses for the player being here or
 * adjacent, a scent trail from an untreated (bleeding) wound, and a stalker's night-hunt drive.
 */
export function stimulusAt(state: GameState, nodeId: NodeId, node: NodeState, graph?: RegionGraph): number {
  const playerHere = state.player.location === nodeId;
  const neighbours = graph ? neighborsOf(graph, nodeId) : [];
  const playerAdjacent = !playerHere && neighbours.includes(state.player.location);
  const playerNear = playerHere || playerAdjacent;
  const bleeding = state.player.condition.wounds.some((w) => w.treated < 100);
  const night = state.meta.phase === "night";

  let s = node.noise;
  if (playerHere) s += PLAYER_HERE_BONUS;
  else if (playerAdjacent) s += PLAYER_ADJACENT_BONUS;
  if (playerNear && bleeding) s += SCENT_BONUS;
  if (night && playerNear && hasTag(node, "nightHunter")) s += STALKER_NIGHT_BONUS;
  return s;
}

/** Inputs the transition function reads for one node. */
interface Senses {
  readonly stimulus: number;
  readonly corpses: number;
  readonly playerHere: boolean;
  readonly present: boolean;
}

/**
 * The FR-CBT-06 transition: snap up to the stimulus's rung, divert a roused node onto nearby corpses
 * to *feed*, otherwise relax one rung toward hibernating. A node with no dead is dormant. Total.
 */
export function nextZombieState(current: ZombieState, i: Senses): ZombieState {
  if (!i.present) return "dormant";
  const target = desiredRung(i.stimulus);
  const cur = RUNG[current];
  if (target > cur) return fromRung(target); // arousal snaps up
  if (i.corpses > 0 && !i.playerHere && cur >= RUNG.wandering) return "feeding"; // settle onto the dead
  if (target < cur) return fromRung(cur - 1); // relax one rung
  return current; // steady (stays chasing/feeding under sustained stimulus)
}

/**
 * The body of the `zombies` world-sim layer (pipeline stage 6, after noise): advance every node's
 * behavioural state from its senses, then let any roused Screamer rouse its neighbours. Needs the
 * `graph` for adjacency and scream-cascade; without one it still ticks each node from its own noise
 * and the player's presence. Inert on a zero-hour tick and on a node with no dead. Pure.
 */
export function tickZombies(state: GameState, hours: number, graph?: RegionGraph): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;

  // Pass 1 — each node's next behavioural state.
  let changed = false;
  const next: Record<NodeId, NodeState> = {};
  const rousers: NodeId[] = [];
  for (const [id, node] of Object.entries(state.nodes)) {
    const present = isPresent(node);
    const stimulus = present ? stimulusAt(state, id, node, graph) : 0;
    const ns = nextZombieState(node.zombieState, {
      stimulus,
      corpses: node.corpses,
      playerHere: state.player.location === id,
      present,
    });
    if (ns !== node.zombieState) {
      next[id] = { ...node, zombieState: ns };
      changed = true;
    } else {
      next[id] = node;
    }
    if (graph !== undefined && (ns === "investigating" || ns === "chasing") && hasTag(node, "rousesNeighbours")) {
      rousers.push(id);
    }
  }
  let nodes: Record<NodeId, NodeState> = changed ? next : (state.nodes as Record<NodeId, NodeState>);

  // Pass 2 — a Screamer calls the neighbourhood: deposit noise so adjacent nodes wake next tick.
  if (graph !== undefined && rousers.length > 0) {
    const bumped: Record<NodeId, NodeState> = { ...nodes };
    let bumpedChanged = false;
    for (const rid of rousers) {
      for (const nb of neighborsOf(graph, rid)) {
        const target = bumped[nb];
        if (target === undefined) continue;
        const noise = clampNoise(target.noise + SCREAM_NOISE);
        if (noise !== target.noise) {
          bumped[nb] = { ...target, noise };
          bumpedChanged = true;
        }
      }
    }
    if (bumpedChanged) {
      nodes = bumped;
      changed = true;
    }
  }

  return changed ? { ...state, nodes } : state;
}
