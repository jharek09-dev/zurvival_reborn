/**
 * Seed a run's world from content — regions, nodes, fog of war (M1 task T11 · FR-SIM-02, FR-MAP).
 *
 * `startRun` is the engine's real M1 run-bootstrap: it takes the validated region/node
 * definitions a client loaded (ADR-0002), builds + integrity-checks the graph, seeds the live
 * `GameState.regions` and `GameState.nodes` from the static baselines, places the player on the
 * start node, and reveals the fog around them. It composes {@link createInitialState} so the
 * base shape (meta/player/rng/...) stays defined in exactly one place.
 *
 * Pure and deterministic (ADR-0001): no clock, no RNG, no I/O. Integer discipline throughout —
 * every seeded quantity is a 0–100 int.
 */

import { createInitialState, type InitialStateOptions } from "../state/createInitialState.js";
import type { GameState, NodeState, RegionId, RegionState } from "../state/types.js";
import { buildRegionGraph } from "./regionGraph.js";
import { discoverAround } from "./fogOfWar.js";
import { seedStarterHordes } from "../sim/hordes.js";
import { seedRoutes } from "../sim/routes.js";
import { spawnNpcs, type NPCDef } from "../sim/npcs.js";
import { registerArcs } from "../sim/story.js";
import type { EncounterDef } from "../sim/events.js";
import type { NodeDef, RegionDef, RegionGraph } from "./types.js";

/** Clamp to a 0–100 integer; content baselines are already ints, this guards bad data. */
function pct(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

/** Live region state seeded from a region's static `baseline` (DESIGN §4). */
export function seedRegionState(regionDefs: readonly RegionDef[]): {
  readonly [id: RegionId]: RegionState;
} {
  const out: Record<RegionId, RegionState> = {};
  for (const def of regionDefs) {
    const b = def.baseline ?? {};
    out[def.id] = {
      threat: pct(b.threat, 0),
      zombieDensity: pct(b.zombieDensity, 0),
      loot: pct(b.loot, 0),
      survivorActivity: pct(b.survivorActivity, 0),
      power: pct(b.power, 0),
      water: pct(b.water, 0),
      fire: 0,
      // Roads start fully passable; they degrade during play, never tick up on their own.
      roads: 100,
      storyFlags: {},
    };
  }
  return out;
}

/**
 * Live node memory for every node, fog fully hidden and every counter zeroed. Nodes remember
 * from here on — this is the only point their state is initialized (GDD VII); nothing after
 * run start resets it.
 */
export function seedNodeState(nodeDefs: readonly NodeDef[]): { readonly [id: string]: NodeState } {
  const out: Record<string, NodeState> = {};
  for (const def of nodeDefs) {
    out[def.id] = {
      regionId: def.regionId,
      searchPct: 0,
      damage: 0,
      corpses: 0,
      blood: 0,
      barricades: 0,
      traps: [],
      occupants: [],
      discoveries: [],
      playerNotes: [],
      lastVisit: null,
      noise: 0,
      walkers: Math.max(0, Math.trunc(def.walkers ?? 0)),
      // Zombie behavioural state starts dormant; the machine (T25) rouses it from senses.
      zombieState: "dormant",
      zombieTypes: def.zombieTypes ? [...def.zombieTypes] : [],
      discovered: false,
    };
  }
  return out;
}

/** What `startRun` returns: the ready-to-play state plus the graph the client keeps for reveal. */
export interface RunStart {
  readonly state: GameState;
  /** Transient adjacency index (not serialized) — pass to reveal/travel helpers each turn. */
  readonly graph: RegionGraph;
}

/**
 * Create a fresh run seated in the given content. Builds + validates the graph (throws
 * {@link MapError} on a bad set), seeds regions and nodes, stands the player on the start node
 * (marked visited today), and reveals the start node and its neighbors. The returned `graph` is
 * transient: the client rebuilds it from content on load, it is never part of a save.
 */
export function startRun(
  opts: InitialStateOptions,
  regionDefs: readonly RegionDef[],
  nodeDefs: readonly NodeDef[],
  npcDefs: readonly NPCDef[] = [],
  arcIds: readonly string[] = [],
  encounterDefs: readonly EncounterDef[] = [],
): RunStart {
  const graph = buildRegionGraph(regionDefs, nodeDefs, encounterDefs);
  const base = createInitialState({ ...opts, startLocation: graph.startNodeId });

  const regions = seedRegionState(regionDefs);
  let nodes = seedNodeState(nodeDefs);

  // The player is standing on the start node from turn 0 — that counts as visited today.
  const start = nodes[graph.startNodeId]!;
  nodes = { ...nodes, [graph.startNodeId]: { ...start, lastVisit: base.meta.day } };

  // Reveal the start node and everything one step out.
  nodes = discoverAround(nodes, graph, graph.startNodeId);

  // Seed a clear route for every undirected edge in the graph (T29 · FR-MAP-04).
  const adjacency: Record<string, readonly string[]> = {};
  for (const def of nodeDefs) adjacency[def.id] = def.adjacent;
  const routes = seedRoutes(adjacency);

  const seeded: GameState = { ...base, regions, nodes, routes, hordes: seedStarterHordes(graph) };
  // Seed the survivor pool from the named `npc` stream (T33); inert when no npcDefs are supplied. Then
  // register any opt-in story arcs into `story.progress` (T40); inert when none are supplied, so every
  // prior run stays byte-identical.
  const peopled = spawnNpcs(seeded, npcDefs, graph);
  return { state: registerArcs(peopled, arcIds), graph };
}
