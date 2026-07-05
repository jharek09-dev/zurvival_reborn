/**
 * Fog of war — what the player knows exists vs. where they've been (M1 task T11 · FR-MAP-02).
 *
 * Two tiers, both carried in `NodeState` so they persist for the whole run (FR-SIM-02):
 *   - **discovered** — the node is on the player's map: they know it exists and can route to it.
 *     Scouting a node discovers it and its immediate neighbors, so travel choices are always the
 *     edges of the known frontier.
 *   - **visited** — the player has actually stood there (`lastVisit !== null`). Only visiting a
 *     node makes its interior memory (searchPct, damage, corpses, ...) meaningful; a discovered
 *     but unvisited node is a name and a direction, not yet a known interior.
 *
 * These functions are pure transforms of the `nodes` map. They never invent nodes — reveal only
 * flips flags on nodes that already exist in state (seeded from content at run start).
 */

import type { GameState, NodeId, NodeState } from "../state/types.js";
import { neighborsOf } from "./regionGraph.js";
import type { RegionGraph } from "./types.js";

/** The `nodes` slice of GameState — node id → live per-node memory. */
export type NodeMap = GameState["nodes"];

/** The node is on the player's map (known to exist). */
export function isDiscovered(node: NodeState): boolean {
  return node.discovered;
}

/** The player has physically been to the node at least once. */
export function isVisited(node: NodeState): boolean {
  return node.lastVisit !== null;
}

/** Ids of every node currently revealed on the map, in a stable sorted order. */
export function discoveredNodeIds(nodes: NodeMap): readonly NodeId[] {
  return Object.keys(nodes)
    .filter((id) => nodes[id]!.discovered)
    .sort();
}

/** Return a copy of `nodes` with `id` marked discovered (no-op if already, or if absent). */
function markDiscovered(nodes: NodeMap, id: NodeId): NodeMap {
  const node = nodes[id];
  if (node === undefined || node.discovered) return nodes;
  return { ...nodes, [id]: { ...node, discovered: true } };
}

/**
 * Reveal `nodeId` and every node one route away — the effect of scouting from a location.
 * Pure: returns a new `nodes` map (or the same reference if nothing changed). Neighbors come
 * from the graph, so an edge added in content automatically widens what a stand reveals.
 */
export function discoverAround(nodes: NodeMap, graph: RegionGraph, nodeId: NodeId): NodeMap {
  let next = markDiscovered(nodes, nodeId);
  for (const neighbor of neighborsOf(graph, nodeId)) {
    next = markDiscovered(next, neighbor);
  }
  return next;
}
