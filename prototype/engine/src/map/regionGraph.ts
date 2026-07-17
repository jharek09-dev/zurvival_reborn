/**
 * Region graph — build + integrity check + adjacency queries (M1 task T11 · FR-MAP-01).
 *
 * `buildRegionGraph` turns a set of validated region/node definitions into an indexed
 * {@link RegionGraph} and, in doing so, enforces the cross-file invariants JSON Schema can't:
 * every node points at a known region, every route points at a known node, routes are
 * symmetric, there is exactly one start node, and every node is reachable from it. A content
 * set that violates any of these throws {@link MapError} at run start rather than producing a
 * subtly broken world (a one-way corridor, an island node) discovered turns later.
 *
 * Pure and dependency-free: no I/O, no clock, no RNG. Order-independent — the same defs in any
 * order yield the same graph and the same integrity verdict.
 */

import type { NodeId } from "../state/types.js";
import type { EncounterDef } from "../sim/events.js";
import { MapError, type NodeDef, type RegionDef, type RegionGraph } from "./types.js";

/** Index an array of defs by id, rejecting duplicates. */
function indexById<T extends { readonly id: string }>(
  defs: readonly T[],
  what: string,
): { readonly [id: string]: T } {
  const byId: Record<string, T> = {};
  for (const def of defs) {
    if (byId[def.id] !== undefined) {
      throw new MapError(`duplicate ${what} id "${def.id}"`);
    }
    byId[def.id] = def;
  }
  return byId;
}

/**
 * Build and validate the region graph for one content set. Throws {@link MapError} on any
 * structural problem. `nodeDefs` must be non-empty (a run needs somewhere to stand).
 */
export function buildRegionGraph(
  regionDefs: readonly RegionDef[],
  nodeDefs: readonly NodeDef[],
  encounterDefs: readonly EncounterDef[] = [],
): RegionGraph {
  if (nodeDefs.length === 0) throw new MapError("no nodes: a region graph needs at least one node");

  const regions = indexById(regionDefs, "region");
  const nodes = indexById(nodeDefs, "node");

  // Every node belongs to a known region.
  for (const node of nodeDefs) {
    if (regions[node.regionId] === undefined) {
      throw new MapError(`node "${node.id}" references unknown region "${node.regionId}"`);
    }
  }

  // Edges: no self-loops, no dangling targets, and every edge is symmetric.
  for (const node of nodeDefs) {
    for (const other of node.adjacent) {
      if (other === node.id) {
        throw new MapError(`node "${node.id}" is adjacent to itself`);
      }
      const target = nodes[other];
      if (target === undefined) {
        throw new MapError(`node "${node.id}" has a route to unknown node "${other}"`);
      }
      if (!target.adjacent.includes(node.id)) {
        throw new MapError(
          `asymmetric route: "${node.id}" → "${other}" is not matched by "${other}" → "${node.id}"`,
        );
      }
    }
  }

  // Exactly one start node.
  const starts = nodeDefs.filter((n) => n.start === true);
  if (starts.length === 0) throw new MapError("no start node: exactly one node must set start:true");
  if (starts.length > 1) {
    throw new MapError(
      `multiple start nodes (${starts.map((n) => `"${n.id}"`).join(", ")}); exactly one allowed`,
    );
  }
  const startNodeId = starts[0]!.id;

  // Connectivity: every node reachable from start over the (now symmetric) edges.
  const reached = reachableFrom(nodes, startNodeId);
  if (reached.size !== nodeDefs.length) {
    const orphans = nodeDefs.filter((n) => !reached.has(n.id)).map((n) => `"${n.id}"`);
    throw new MapError(
      `region graph is disconnected: ${orphans.join(", ")} not reachable from start "${startNodeId}"`,
    );
  }

  // The encounter pool is transient content (T47) — attached only when the client registers one, so a
  // graph built without it leaves the encounter system inert (every prior run byte-identical).
  return encounterDefs.length === 0
    ? { regions, nodes, startNodeId }
    : { regions, nodes, startNodeId, encounters: encounterDefs };
}

/** Breadth-first set of node ids reachable from `from` over the graph's edges. */
function reachableFrom(
  nodes: { readonly [id: NodeId]: NodeDef },
  from: NodeId,
): ReadonlySet<NodeId> {
  const seen = new Set<NodeId>([from]);
  const stack: NodeId[] = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const next of nodes[id]?.adjacent ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * Node ids one travel step from `nodeId`. Returns a stable, de-duplicated copy (never the
 * content's own array). Unknown node → empty list.
 */
export function neighborsOf(graph: RegionGraph, nodeId: NodeId): readonly NodeId[] {
  return [...(graph.nodes[nodeId]?.adjacent ?? [])];
}

/** Whether two nodes are directly connected by a route. */
export function areAdjacent(graph: RegionGraph, a: NodeId, b: NodeId): boolean {
  return graph.nodes[a]?.adjacent.includes(b) ?? false;
}
