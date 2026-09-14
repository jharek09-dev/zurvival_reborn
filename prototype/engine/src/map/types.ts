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
import type { WeaponDef } from "../combat/weapons.js";
import type { ProjectDef } from "../sim/project.js";
import type { EndingDef } from "../sim/ending.js";
import type { StandDef } from "../sim/stand.js";
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
  /**
   * How deep this particular building's stock is, as a **percentage of the ordinary yield for its
   * region** (M5 task T84 · FR-ECO-02 · GDD X). `100` is "an ordinary place of its kind"; below it a
   * place already stripped or never worth much; above it the pharmacy at the end of the block nobody
   * got to. Clamped to {@link RICHNESS_MIN}..{@link RICHNESS_MAX} on read.
   *
   * **This is the node's only contribution to its own loot beyond `searchPct`, and before T84 it did
   * not exist.** Measured on the pre-T84 tree (`measure/t84.ts --cap`): the yield cap is
   * `trunc(regionLoot / 8) - trunc(searchPct / 34)`, so it has exactly **6 values** across the shipped
   * city — one per region — and a node's own progress moves it by at most **2**. Two nodes of the same
   * kind in the same district were arithmetically identical, and `region.ironworks` holds **eight**
   * interchangeable `industrial` nodes.
   *
   * Optional, and the whole multiply is gated on some node in the set authoring it
   * (`richnessAuthored`, the T83 `claimable` precedent), so a content set that omits it — every
   * fixture, every pre-T84 run — computes **exactly the prior cap**.
   *
   * That is a claim about the CAP, not about the run. T84 is **not byte-identical** and does not
   * pretend to be: `resolveSearch` now takes one table draw per unit instead of one per search, so the
   * `loot` stream advances differently for everyone, richness or no richness. An earlier draft of this
   * comment claimed run-level byte-identity in four places and an audit disproved it with a nine-action
   * probe. The gate buys a clean *arithmetic* baseline, which is what makes the before/after cap tables
   * comparable — not a frozen RNG.
   *
   * **Read from the graph, never stored.** The brief asked for `NodeDef.richness -> NodeState`; nothing
   * mutates it, so a mirrored copy would be dead save state and a schema rung bought for nothing (the
   * T79 `lastVisit` precedent: derive from what content already says).
   */
  readonly richness?: number;
  /**
   * How many rooms this building can hold (M5 task T85 · FR-SHL-04 · GDD Part XI). Clamped to
   * {@link ROOM_SLOTS_MIN}..{@link ROOM_SLOTS_MAX} on read; {@link ROOM_SLOTS_DEFAULT} when absent.
   *
   * A marina office holds fewer than a warehouse. Seven rooms exist and the roomiest building in the
   * city holds five, so a base is a **set of choices, not a checklist** — garden-or-cistern and
   * workshop-or-medical become real, and *which building you claimed* acquires a tail that lasts the
   * rest of the run.
   *
   * Optional, and the whole layer is gated on some node in the set authoring it
   * (`roomSlotsAuthored`, the T83 `claimable` / T84 `richness` precedent), so a content set that omits
   * it keeps the unbounded `NodeState.rooms` array every prior run had.
   *
   * **Read from the graph, never stored** — nothing mutates it, so a `NodeState` mirror would be dead
   * save state (the T79 derive-don't-store precedent).
   */
  readonly roomSlots?: number;
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
   * The run's registered weapon content set (M5 task T81) — transient content the client loaded from
   * `content/weapons/`, carried here exactly as the recipe and job pools are. Optional and defaulting to
   * empty: a graph built without it places **no weapons in loot**, so every prior run draws the identical
   * uniform table and stays byte-identical (the `floor(f·len)` pick hazard the radio and economy pools
   * are gated for). The combat dials themselves are engine-authoritative — this pool gates placement and
   * is drift-guarded against `combat/weapons.ts`, it does not supply the numbers. Never serialized.
   */
  readonly weapons?: readonly WeaponDef[];
  /**
   * The run's registered terminal-project pool (M5 task T87) — transient content the client loaded from
   * `content/projects/`, carried here exactly as the recipe, job and weapon pools are. Optional and
   * defaulting to empty: a graph built without it leaves the whole win-condition layer inert (no commit
   * or stage verbs, no `ending.*` flag, no project escalation, and `runEndReason` keeps its four losing
   * reasons), so every prior run stays byte-identical. Never serialized.
   */
  readonly projects?: readonly ProjectDef[];
  /**
   * The run's registered ending pool (M5 task T61) — transient content the client loaded from
   * `content/endings/`, carried here exactly as the project and weapon pools are. Optional and
   * defaulting to empty: a graph built without it closes every run on the plain reason scene
   * (`endingNarration` / `winNarration`), which is precisely what every run did before T61, so the
   * narration, the choice ids and the save all stay byte-identical. Never serialized.
   */
  readonly endings?: readonly EndingDef[];
  /**
   * The run's registered stand pool (M5 task T62) — transient content the client loaded from
   * `content/stands/`, carried here exactly as the ending and project pools are. Optional and
   * defaulting to empty: a graph built without it never arms a stand, so a death ends the run on the
   * frame it lands and `availableActions` returns `[]`, which is precisely what every run did before
   * T62. Never serialized. Note that the *gate* the engine actually reads at run-end is the
   * `stand.armed` flag `startRun` seeds from this pool, because `runEndReason` takes no graph — see
   * `sim/stand.ts`.
   */
  readonly stands?: readonly StandDef[];
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
