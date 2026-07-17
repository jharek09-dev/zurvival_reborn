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
import type { EncounterDef } from "../sim/events.js";
import type { SignalDef } from "../sim/radio.js";
import type { RecipeDef } from "../sim/economy.js";
import type { JobDef } from "../sim/jobs.js";
import type { FactionDef } from "../sim/social.js";
import type { NPCDef } from "../sim/npcs.js";

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
  /** Walkers loitering at run start — seeds an avoidable encounter here (FR-CBT-01, T15). */
  readonly walkers?: number;
  /** Location kind — selects the loot plausibility table for searches here (FR-ECO-02, T17). */
  readonly kind?: string;
  /** Distinct zombie type content ids present at this node (FR-CBT-07, T25); default none. */
  readonly zombieTypes?: readonly import("../state/types.js").ContentId[];
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
  /**
   * The run's registered encounter pool (M4 task T47) — transient content the client loaded from
   * `content/encounters/`, carried here so it reaches the pipeline the same way the node graph does.
   * Optional and defaulting to empty: a graph built without a pool leaves the encounter system inert,
   * so every prior run stays byte-identical. Never serialized (like the rest of the graph).
   */
  readonly encounters?: readonly EncounterDef[];
  /**
   * The run's registered radio signal pool (M4 task T50) — transient content the client loaded from
   * `content/radio/`, carried here so the radio interpreter reaches it the same way the node graph and
   * the encounter pool do. Optional and defaulting to empty: a graph built without it leaves the radio
   * system inert (the listen/broadcast verbs never appear), so every prior run stays byte-identical.
   * Never serialized.
   */
  readonly signals?: readonly SignalDef[];
  /**
   * The run's registered crafting-recipe pool (M4 task T51) — transient content the client loaded from
   * `content/recipes/`, carried here so the economy interpreter reaches it the same way the encounter and
   * radio pools do. Optional and defaulting to empty: a graph built without it leaves the whole economy
   * inert (no craft/repair/purify verbs, no spoilage tick, no durability wear, no loot gating), so every
   * prior run stays byte-identical. Never serialized.
   */
  readonly recipes?: readonly RecipeDef[];
  /**
   * The run's registered shelter-job pool (M4 task T52) — transient content the client loaded from
   * `content/jobs/`, carried here so the jobs interpreter reaches it the same way the recipe pool does.
   * Optional and defaulting to empty: a graph built without it leaves the whole shelter-jobs system inert
   * (no assign-job verbs, no production tick, no base feeding, no off-screen upkeep), so every prior run
   * stays byte-identical. Never serialized.
   */
  readonly jobs?: readonly JobDef[];
  /**
   * The run's registered faction pool (M4 task T53) — transient content the client loaded from
   * `content/factions/`, carried here so the social interpreter reaches it the same way the job pool does.
   * Optional and defaulting to empty: a graph built without it leaves the WHOLE social layer inert (no
   * memory/respect/fear, no ask, no desertion/betrayal, no morale drift, no off-screen people tick, no group
   * movement), so every prior run stays byte-identical. It is the master gate. Never serialized.
   */
  readonly factions?: readonly FactionDef[];
  /**
   * The run's survivor catalog (M4 task T53) — the same {@link NPCDef}s handed to `spawnNpcs`, carried here
   * so the `ask` verb can read a survivor's authored `knowledge` leads (FR-NPC-06) at action time. Read only
   * when the social system is active, so registering it changes no state bytes (the graph is never
   * serialized). Present only alongside a faction pool.
   */
  readonly people?: readonly NPCDef[];
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
