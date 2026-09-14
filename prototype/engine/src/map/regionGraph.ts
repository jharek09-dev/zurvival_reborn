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
import type { SignalDef } from "../sim/radio.js";
import type { RecipeDef } from "../sim/economy.js";
import type { JobDef } from "../sim/jobs.js";
import type { FactionDef } from "../sim/social.js";
import type { NPCDef } from "../sim/npcs.js";
import type { WeaponDef } from "../combat/weapons.js";
import type { ProjectDef } from "../sim/project.js";
import { ENDING_SHAPES, ENDING_REQUIREMENT_KEYS, type EndingDef, type EndingShape } from "../sim/ending.js";
import { STAND_REQUIREMENT_KEYS, STAND_EFFECTS, STAND_FLOOR_ID, opensStand, type StandDef } from "../sim/stand.js";
import { RUN_END_REASONS } from "../sim/survival.js";
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
  signalDefs: readonly SignalDef[] = [],
  recipeDefs: readonly RecipeDef[] = [],
  jobDefs: readonly JobDef[] = [],
  factionDefs: readonly FactionDef[] = [],
  peopleDefs: readonly NPCDef[] = [],
  weaponDefs: readonly WeaponDef[] = [],
  projectDefs: readonly ProjectDef[] = [],
  endingDefs: readonly EndingDef[] = [],
  standDefs: readonly StandDef[] = [],
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

  // T87 content guard: a project's id and every one of its stage ids must be unique, because BOTH are
  // save data — a stage flag is `project.stage.<projectId>.<stageId>`. Two stages sharing an id share a
  // flag, so paying for one silently completes the other (the audit built a three-stage project that a
  // single scrap finished two thirds of). The schema cannot express uniqueness across an array of
  // objects, so it is expressed here, where `indexById` already refuses duplicate node and region ids.
  const seenProjects = new Set<string>();
  for (const p of projectDefs) {
    if (seenProjects.has(p.id)) throw new MapError(`duplicate project id "${p.id}"`);
    seenProjects.add(p.id);
    const seenStages = new Set<string>();
    for (const st of p.stages) {
      if (seenStages.has(st.id)) throw new MapError(`project "${p.id}" repeats stage id "${st.id}" — stage ids are save data and must be unique within a project`);
      seenStages.add(st.id);
    }
  }

  // T61 content guard. Four things a JSON Schema structurally cannot check from here — it validates one
  // file at a time, and neither shipping client runs it at boot (`playCli.ts` and `web/build-html.mjs`
  // are bare `JSON.parse`), so the schema is a CI gate and THIS is the runtime one. Every failure below
  // was silent before the audit: a bad shape simply deleted an ending, a typo'd requirement key turned a
  // gated clause unconditional, and a missing `clauses` array threw a TypeError on the frame the player
  // died.
  const seenEndings = new Set<string>();
  const seenShapes = new Set<string>();
  for (const e of endingDefs) {
    if (seenEndings.has(e.id)) throw new MapError(`duplicate ending id "${e.id}"`);
    seenEndings.add(e.id);
    if (!ENDING_SHAPES.includes(e.shape)) {
      throw new MapError(`ending "${e.id}" claims unknown shape "${String(e.shape)}" — one of ${ENDING_SHAPES.join(", ")}`);
    }
    if (seenShapes.has(e.shape)) {
      throw new MapError(`two endings claim shape "${e.shape}" — a run resolves into one shape and must find one def`);
    }
    seenShapes.add(e.shape);
    if (!Array.isArray(e.clauses)) throw new MapError(`ending "${e.id}" has no clauses array`);
    const seenClauses = new Set<string>();
    for (const c of e.clauses) {
      if (seenClauses.has(c.id)) throw new MapError(`ending "${e.id}" repeats clause id "${c.id}"`);
      seenClauses.add(c.id);
      for (const key of Object.keys(c.when ?? {})) {
        if (!ENDING_REQUIREMENT_KEYS.includes(key)) {
          throw new MapError(`ending "${e.id}" clause "${c.id}" tests unknown requirement "${key}" — an unread key would make the clause unconditional`);
        }
      }
    }
  }

  // T62 content guard, the same runtime door for the same reason: neither shipping client runs the
  // schema at boot, and every failure below is silent without this. A duplicate act id would let the
  // resolver pick a different act than the menu showed; an unknown `shape` would be read by
  // `sim/ending.ts` as a shape the game does not have; a typo'd requirement key would make a gated act
  // UNCONDITIONAL, which is T61's audit finding 5 in the place it can least afford to happen — an act
  // offered to a survivor who cannot pay for it is a door held for a companion who is not there.
  const seenStands = new Set<string>();
  const coveredReasons = new Set<string>();
  for (const d of standDefs) {
    if (seenStands.has(d.id)) throw new MapError(`duplicate stand id "${d.id}"`);
    seenStands.add(d.id);
    if (!Array.isArray(d.reasons) || d.reasons.length === 0) {
      throw new MapError(`stand "${d.id}" covers no run-end reason — it could never be consulted`);
    }
    for (const r of d.reasons) {
      if (!RUN_END_REASONS.includes(r)) {
        throw new MapError(`stand "${d.id}" claims unknown run-end reason "${String(r)}" — one of ${RUN_END_REASONS.join(", ")}`);
      }
      if (!opensStand(r)) {
        throw new MapError(`stand "${d.id}" claims reason "${r}", which is a WIN — a won run closes on its project's own ending`);
      }
      if (coveredReasons.has(r)) {
        throw new MapError(`two stands claim reason "${r}" — a death finds one def, and the second would be unreachable`);
      }
      coveredReasons.add(r);
    }
    if (!Array.isArray(d.acts)) throw new MapError(`stand "${d.id}" has no acts array`);
    const seenActs = new Set<string>();
    for (const a of d.acts) {
      if (seenActs.has(a.id)) throw new MapError(`stand "${d.id}" repeats act id "${a.id}"`);
      seenActs.add(a.id);
      if (a.id === STAND_FLOOR_ID) {
        throw new MapError(`stand "${d.id}" authors act id "${STAND_FLOOR_ID}", which is the engine's own floor act — it would be offered twice`);
      }
      if (a.shape !== undefined && !ENDING_SHAPES.includes(a.shape as EndingShape)) {
        throw new MapError(`stand "${d.id}" act "${a.id}" claims unknown shape "${String(a.shape)}" — one of ${ENDING_SHAPES.join(", ")}`);
      }
      // The three the audit noticed were checked by the schema and NOT by this door — which matters
      // precisely because this door exists for the clients that never run the schema. An unknown
      // `effect` falls through `applyStandEffect`'s `default` and silently does nothing, so the act's
      // prose describes a world change that did not happen; a non-numeric `weight` is coerced to 0 and
      // sorts to the back rather than failing; and an act that KILLS without requiring a fight would be
      // offered at a death with nothing to kill.
      if (a.effect !== undefined && !STAND_EFFECTS.includes(a.effect)) {
        throw new MapError(`stand "${d.id}" act "${a.id}" claims unknown effect "${String(a.effect)}" — one of ${STAND_EFFECTS.join(", ")}`);
      }
      if (a.effect === "kill" && a.when?.requiresCombat !== true) {
        throw new MapError(`stand "${d.id}" act "${a.id}" kills without requiring combat — it would be offered at a death with nothing to kill`);
      }
      if (!Number.isFinite(a.weight)) {
        throw new MapError(`stand "${d.id}" act "${a.id}" has a non-numeric weight "${String(a.weight)}"`);
      }
      for (const key of Object.keys(a.when ?? {})) {
        if (!STAND_REQUIREMENT_KEYS.includes(key)) {
          throw new MapError(`stand "${d.id}" act "${a.id}" tests unknown requirement "${key}" — an unread key would make the act unconditional`);
        }
      }
    }
  }

  // Connectivity: every node reachable from start over the (now symmetric) edges.
  const reached = reachableFrom(nodes, startNodeId);
  if (reached.size !== nodeDefs.length) {
    const orphans = nodeDefs.filter((n) => !reached.has(n.id)).map((n) => `"${n.id}"`);
    throw new MapError(
      `region graph is disconnected: ${orphans.join(", ")} not reachable from start "${startNodeId}"`,
    );
  }

  // The encounter pool (T47) and radio signal pool (T50) are transient content — attached only when the
  // client registers one, so a graph built without them leaves those systems inert (every prior run
  // byte-identical). Each field is present only when non-empty, so an unregistered pool stays undefined.
  const graph: RegionGraph = { regions, nodes, startNodeId };
  return {
    ...graph,
    ...(encounterDefs.length > 0 ? { encounters: encounterDefs } : {}),
    ...(signalDefs.length > 0 ? { signals: signalDefs } : {}),
    ...(recipeDefs.length > 0 ? { recipes: recipeDefs } : {}),
    ...(jobDefs.length > 0 ? { jobs: jobDefs } : {}),
    // The faction pool (T53) is the social system's master gate — attached only when the client registers one,
    // so a graph without it leaves the whole social layer inert (every prior run byte-identical). The survivor
    // catalog rides alongside it (read for `ask` leads); present only with a faction pool.
    ...(factionDefs.length > 0 ? { factions: factionDefs } : {}),
    ...(factionDefs.length > 0 && peopleDefs.length > 0 ? { people: peopleDefs } : {}),
    // The weapon content set (T81) gates weapon placement in loot; without it a search draws the exact
    // pre-T81 uniform table, which is what keeps every prior run byte-identical.
    ...(weaponDefs.length > 0 ? { weapons: weaponDefs } : {}),
    // The terminal-project pool (T87) is the win condition's master gate — attached only when the client
    // registers one, so a graph without it has no way to end a run well, exactly as before.
    ...(projectDefs.length > 0 ? { projects: projectDefs } : {}),
    // The ending pool (T61) gates assembled endings; without it every run closes on the plain reason
    // scene, which is exactly what it closed on before T61.
    ...(endingDefs.length > 0 ? { endings: endingDefs } : {}),
    // The stand pool (T62) gates the final-choice scene. Attached only when non-empty, matching every
    // pool since T81 — and note that attaching it is NOT what arms a run: `startRun` seeds the
    // `stand.armed` flag from the same pool, because `runEndReason` cannot see a graph.
    ...(standDefs.length > 0 ? { stands: standDefs } : {}),
  };
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
