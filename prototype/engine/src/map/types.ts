/**
 * Map content shapes + the runtime region graph (M1 task T11 · DESIGN §4, §7 · FR-MAP-01..03,06).
 *
 * The node graph is *content*, not state: the dependency-free engine stores content ids in
 * `GameState`, never copies of the static definitions (DESIGN §4). These interfaces describe the
 * shape of the already-validated plain objects a client hands the engine after `loadContent`
 * (ADR-0002) — the engine never parses or validates JSON itself, it only receives typed data.
 *
 * `RegionGraph` is a transient in-memory index built from those definitions (adjacency lookups
 * for reveal + travel). It is NOT part of `GameState` and is never serialized, so it is free to
 * use whatever representation is convenient — here plain records, to stay obviously JSON-safe.
 */

import type { NodeId, RegionId } from "../state/types.js";

/** A region's static definition — mirrors `content/schemas/region.schema.json`. */
export interface RegionDef {
  readonly id: RegionId;
  readonly name: string;
  readonly description: string;
  /** Initial 0–100 integer state used to seed `GameState.regions[id]`. All fields optional. */
  readonly baseline?: {
    readonly threat?: number;
    readonly zombieDensity?: number;
    readonly loot?: number;
    readonly survivorActivity?: number;
    readonly power?: number;
    readonly water?: number;
  };
  /** Region-to-region adjacency (unused until a second region ships, M4). */
  readonly adjacent?: readonly RegionId[];
}

/** A node's static definition — mirrors `content/schemas/node.schema.json`. */
export interface NodeDef {
  readonly id: NodeId;
  readonly regionId: RegionId;
  readonly name: string;
  readonly description: string;
  /** Undirected graph edges: node ids one travel step away. Symmetry is enforced at build. */
  readonly adjacent: readonly NodeId[];
  /** True on exactly one node across the set — the run's starting location. */
  readonly start?: boolean;
  /** True if the node can be claimed as a safehouse (FR-MAP-06). */
  readonly claimable?: boolean;
}

/**
 * A validated, indexed view of one content set: node/region defs by id, plus the resolved start
 * node. Built once per run by {@link buildRegionGraph}; passed to reveal/travel helpers that need
 * adjacency. Transient — recomputed from content on load, never stored in a save.
 */
export interface RegionGraph {
  readonly regions: { readonly [id: RegionId]: RegionDef };
  readonly nodes: { readonly [id: NodeId]: NodeDef };
  /** The single node whose `start` is true. */
  readonly startNodeId: NodeId;
}

/**
 * Thrown when a content set can't form a valid node graph — a dangling edge, an asymmetric
 * route, a missing/duplicate start, an unknown region, or a disconnected node. This is the
 * referential-integrity check the JSON Schema structurally cannot express (it validates one file
 * at a time); it runs in the engine so a bad graph fails loudly at run start, not mid-play.
 */
export class MapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapError";
  }
}
