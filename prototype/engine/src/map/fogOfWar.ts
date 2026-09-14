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
 * Reveal `nodeId` and every node one route away — the effect of arriving somewhere.
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

/**
 * How many days a look stays worth quoting (T84). Two: long enough that scouting ahead is useful in a
 * run whose measured length is under four days, short enough that a node glanced at on day one is not
 * still reporting its dead on day four.
 */
export const SCOUT_MEMORY_DAYS = 2;

/**
 * The node has been looked at, not merely routed to (T84). Absent reads false — a pre-T84 save.
 *
 * **An explicit mark.** An earlier cut also returned true for `lastVisit !== null`, which meant walking
 * anywhere silently bought the intel the `scout` verb sells. `applyMove` writes the mark instead.
 */
export function isScouted(node: NodeState): boolean {
  return node.scouted === true;
}

/** Whether what the player knows about this place is recent enough to quote (T84). */
export function scoutIsFresh(node: NodeState, day: number): boolean {
  if (!isScouted(node)) return false;
  const on = node.scoutedOn;
  if (typeof on !== "number" || !Number.isFinite(on)) return false;
  return day - on <= SCOUT_MEMORY_DAYS;
}

/** Return a copy of `nodes` with `id` marked discovered **and** scouted on `day` (no-op if absent). */
function markScouted(nodes: NodeMap, id: NodeId, day: number): NodeMap {
  const node = nodes[id];
  if (node === undefined) return nodes;
  if (node.discovered && node.scouted === true && node.scoutedOn === day) return nodes;
  return { ...nodes, [id]: { ...node, discovered: true, scouted: true, scoutedOn: day } };
}

/** Mark the one node the player is standing in as looked at, today (T84 — `applyMove`'s half). */
export function markScoutedHere(nodes: NodeMap, id: NodeId, day: number): NodeMap {
  return markScouted(nodes, id, day);
}

/**
 * Ids within `hops` route steps of `from`, including `from` itself — a breadth-first walk of the
 * content graph. Sorted, so anything built from it is stable across runs and platforms.
 */
export function nodesWithin(graph: RegionGraph, from: NodeId, hops: number): readonly NodeId[] {
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  for (let d = 0; d < Math.max(0, Math.trunc(hops)); d += 1) {
    const nextFrontier: NodeId[] = [];
    for (const id of frontier) {
      for (const n of neighborsOf(graph, id)) {
        if (seen.has(n)) continue;
        seen.add(n);
        nextFrontier.push(n);
      }
    }
    frontier = nextFrontier;
  }
  return [...seen].sort();
}

/**
 * The effect of the `scout` verb (M5 task T84): everything within `hops` of `from` becomes both
 * discovered **and** scouted — on the map, and with what is standing in it known.
 *
 * The reveal radius is the cheap half. The measurement that set this verb's scope
 * (`measure/t84.ts --frontier`, pre-T84) found a run discovers **7.1 of 60** nodes and searches
 * **3.23** of them before ending on day 3.6 — so a wider map is territory the run will never walk, and
 * the brief's proposal to *stop* auto-revealing on arrival would have narrowed a travel menu that
 * already offers nothing on 52.7% of turns. What scouting actually sells is the **intel**: whether the
 * block you are about to walk into has four dead standing in it.
 */
export function scoutFrom(nodes: NodeMap, graph: RegionGraph, from: NodeId, hops: number, day = 0): NodeMap {
  let next = nodes;
  for (const id of nodesWithin(graph, from, hops)) next = markScouted(next, id, day);
  return next;
}
