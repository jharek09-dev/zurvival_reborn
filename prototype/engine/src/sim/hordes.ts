/**
 * Migrating hordes that re-path to noise (M2 task T26 · FR-SIM-07, FR-CBT-08 · GDD IV/IX).
 *
 * Above the node-local zombie machine (T25) sit **hordes** — moving masses with a size, position,
 * destination, speed, and awareness (`GameState.hordes`, shaped since T3 but never populated). Two
 * requirements:
 *   - **Evaluate noise, re-path (FR-SIM-07).** Each tick a horde scans the nodes within its
 *     `awareness` hops; if one is loud enough (a logged gunshot clears the bar, ordinary footsteps do
 *     not), it becomes the new destination — the "fire a gun and pull the horde" lever, now at map
 *     scale. Otherwise the horde keeps migrating toward a wander destination.
 *   - **Routed, not out-traded (FR-CBT-08).** A horde is a thing you funnel, flee, or lead away with
 *     noise — never a stack of hit points. Nothing here lets the player *fight* it; the systemic
 *     handle is the same noise the player already understands.
 *
 * Movement is a shortest walk over the region node graph, one node per {@link HORDE_HOURS_PER_STEP}
 * hours at speed 1, so a horde re-paths the turn a shot is fired and *arrives* over the following
 * turns — the DESIGN §5 "gunshot this turn, consequence next turn" timing, at the horde layer.
 * On arrival a horde clears its destination and wanders anew; coupling a horde's presence to node
 * danger is a later M2 concern — T26 owns the movement and the noise-driven re-path.
 *
 * Pure, deterministic, integer-only (ADR-0001). Re-pathing and movement are total functions of the
 * graph and node noise; only the wander destination consumes randomness, from the named `horde`
 * stream, so a seed reproduces every migration. Needs the transient `graph`; inert without one.
 */

import type { GameState, Horde, NodeId, RngState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { drawInt } from "../rng/streams.js";
import { ZOMBIE_WALKER } from "./zombies.js";

// --- tuning (bridge constants until a horde content set lands, as with the T17 loot tables) ------

export const STARTER_HORDE_SIZE = 24;
export const HORDE_SPEED = 1;
/** How many hops out a horde can "hear". */
export const HORDE_AWARENESS = 2;
/** Hours to advance one node at speed 1 — hordes are slow. */
export const HORDE_HOURS_PER_STEP = 4;
/** Minimum node noise that redirects a horde — a gunshot (T15 FIRE_NOISE = 75) clears it; a step (8) does not. */
export const REPATH_NOISE = 30;

// --- graph helpers (transient; Set/array use is fine in a pure fn, only GameState is plain-JSON) --

/** Node ids within `depth` hops of `from` (excludes `from`), reached by breadth-first walk. */
function nodesWithin(graph: RegionGraph, from: NodeId, depth: number): readonly NodeId[] {
  const visited = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  const out: NodeId[] = [];
  for (let d = 0; d < depth; d++) {
    const next: NodeId[] = [];
    for (const cur of frontier) {
      for (const nb of neighborsOf(graph, cur)) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        out.push(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return out;
}

/** Shortest node path `from` -> `to` (inclusive), or null if unreachable. Ties broken by sorted id. */
function shortestPath(graph: RegionGraph, from: NodeId, to: NodeId): readonly NodeId[] | null {
  if (from === to) return [from];
  const visited = new Set<NodeId>([from]);
  const parent: Record<NodeId, NodeId> = {};
  const queue: NodeId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of [...neighborsOf(graph, cur)].sort()) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      parent[nb] = cur;
      if (nb === to) {
        const path: NodeId[] = [to];
        let p: NodeId = to;
        while (p !== from) {
          p = parent[p]!;
          path.push(p);
        }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return null;
}

/** The loudest node within a horde's hearing whose noise clears the re-path bar, or null. */
export function loudestAudible(state: GameState, graph: RegionGraph, from: NodeId, awareness: number): NodeId | null {
  const audible = nodesWithin(graph, from, Math.max(1, awareness)).filter(
    (id) => (state.nodes[id]?.noise ?? 0) >= REPATH_NOISE,
  );
  if (audible.length === 0) return null;
  audible.sort((a, b) => (state.nodes[b]!.noise - state.nodes[a]!.noise) || (a < b ? -1 : 1));
  return audible[0]!;
}

/** Advance `from` toward `to` by up to `steps` nodes along the shortest path. */
function advanceAlong(graph: RegionGraph, from: NodeId, to: NodeId, steps: number): NodeId {
  if (steps <= 0 || from === to) return from;
  const path = shortestPath(graph, from, to);
  if (path === null || path.length <= 1) return from;
  return path[Math.min(steps, path.length - 1)]!;
}

/** Pick a wander destination (any node but the current one) from the named horde stream. */
function pickWander(rng: RngState, seed: string, nodeIds: readonly NodeId[], pos: NodeId): { rng: RngState; value: NodeId } {
  const options = nodeIds.filter((id) => id !== pos);
  if (options.length === 0) return { rng, value: pos };
  const draw = drawInt(rng, seed, "horde", 0, options.length - 1);
  return { rng: draw.rng, value: options[draw.value]! };
}

// --- seeding ---------------------------------------------------------------------------------

/**
 * A small starter set of hordes for a fresh run — one roaming mass placed away from the start node,
 * with no destination yet (it wanders until noise pulls it). Engine constants for now, a bridge until
 * horde content lands (as with the T17 loot tables). Deterministic: placement is by sorted id.
 */
export function seedStarterHordes(graph: RegionGraph): readonly Horde[] {
  const ids = Object.keys(graph.nodes).sort();
  if (ids.length === 0) return [];
  const away = ids.filter((id) => id !== graph.startNodeId);
  const pos = (away.length > 0 ? away[away.length - 1] : ids[ids.length - 1])!;
  return [
    { id: "horde.1", size: STARTER_HORDE_SIZE, pos, dest: null, speed: HORDE_SPEED, awareness: HORDE_AWARENESS, types: [ZOMBIE_WALKER] },
  ];
}

// --- the layer -------------------------------------------------------------------------------

/**
 * The body of the `hordes` world-sim layer (pipeline stage 9). For each horde: re-path to a loud node
 * within hearing (a gunshot redirect), else keep a wander destination; step toward it along the graph
 * by the tick's hours; and on arrival clear the destination to wander anew. Inert without a graph,
 * with no hordes, or on a zero-hour tick. Touches only the `hordes` slice and the `horde` stream. Pure.
 */
export function tickHordes(state: GameState, hours: number, graph?: RegionGraph): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0 || graph === undefined || state.hordes.length === 0) return state;

  const nodeIds = Object.keys(graph.nodes).sort();
  let rng = state.rng;
  let moved = false;

  const hordes: Horde[] = state.hordes.map((horde) => {
    // 1. Evaluate noise: a loud node within hearing redirects the horde (FR-SIM-07).
    let dest: NodeId | null = horde.dest;
    const heard = loudestAudible(state, graph, horde.pos, horde.awareness);
    if (heard !== null) dest = heard;

    // 2. No destination (or already there): pick a wander target.
    if (dest === null || dest === horde.pos) {
      const draw = pickWander(rng, state.meta.seed, nodeIds, horde.pos);
      rng = draw.rng;
      dest = draw.value;
    }

    // 3. Step toward the destination by the tick's hours.
    const steps = Math.trunc((h * horde.speed) / HORDE_HOURS_PER_STEP);
    const pos = advanceAlong(graph, horde.pos, dest, steps);

    // 4. Arrival: clear the destination so it wanders next tick.
    const nextDest: NodeId | null = pos === dest ? null : dest;

    if (pos !== horde.pos || nextDest !== horde.dest) moved = true;
    return { ...horde, pos, dest: nextDest };
  });

  if (!moved && rng === state.rng) return state;
  return { ...state, hordes, rng };
}
