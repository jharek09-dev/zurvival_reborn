/**
 * Survivor NPCs — encounterable people with state & needs (M3 task T33 · FR-NPC-01, VS subset · GDD XII).
 *
 * The reactive world M2 built could threaten only the player. T33 gives the danger someone else to fall
 * on: a curated pool of named survivors, seeded into the run as real per-run {@link NPCState} — a
 * temperament (`disposition`), a place (`location`), needs that grind on whether or not you visit, a
 * life that can end (`alive`), and (T34) a `trust` scalar toward the player. This is the substrate the
 * rest of M3 stands on: no dialogue, recruitment, defended shelter, or authored arc without people first.
 *
 * Two behaviours ship here, both deterministic (ADR-0001):
 *   - **Spawn** — {@link spawnNpcs} places the pool at run start. A survivor with a `homeNode` is placed
 *     there; the rest are distributed by draws from a new named **`npc`** RNG stream, so the pool lands
 *     the same way from the same seed and no existing stream's sequence shifts.
 *   - **Needs drift** — {@link tickNpcs} (the pipeline stage-5 body) grinds every living survivor's
 *     needs down with the hours an action spends, reusing the player's own {@link driftNeeds} economy
 *     (T22). It is a pure function of the hours — no RNG — so a zero-hour `wait` leaves every survivor
 *     untouched (the M0 empty-turn contract holds).
 *
 * Deferred to later M3 blocks (see M3_PART1_PLAN): off-screen drift inside `advanceWorld`
 * and NPC movement. As of T35 survivors are surfaced in the Scene and can die (saturated needs); they
 * remain stationary (no wandering) until the people side of stage 10 lands.
 */

import type {
  ActorId,
  ContentId,
  GameState,
  Needs,
  NodeId,
  NPCDisposition,
  NPCState,
} from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { driftNeeds, NEED_FATAL } from "./survival.js";
import { startingTrust } from "./trust.js";
import { drawPick } from "../rng/streams.js";

/** Named RNG stream that drives survivor placement — independent of loot/encounter/combat/etc. */
export const NPC_STREAM = "npc" as const;

/**
 * A survivor's static definition — mirrors `content/schemas/npc.schema.json`. The engine receives these
 * as already-validated plain objects from the client's content load (ADR-0002); it never parses JSON.
 * The `background`/`personality`/`secret` are the FR-NPC-01 flavour that makes a survivor a character
 * rather than a stat block (surfaced later, T35+); the engine reads only id/name/disposition/homeNode.
 */
export interface NPCDef {
  readonly id: ContentId;
  readonly name: string;
  readonly description: string;
  readonly disposition: NPCDisposition;
  /** Preferred starting node; when absent (or not in the graph) the `npc` stream picks one. */
  readonly homeNode?: NodeId;
  readonly background?: string;
  readonly personality?: string;
  readonly secret?: string;
  /**
   * Offhand knowledge this survivor will share once they trust you — the FR-NPC-06 "conversation is a
   * mechanic" leads (M4 task T53). Each is a real, actionable hint that reveals a node or marks a discovery
   * when `ask`ed (interpreted by `sim/social.ts`). Optional; a survivor without it simply has nothing to
   * confide. The engine reads it via the transient `graph.people` catalog, gated on an active faction pool,
   * so a run without the social system never surfaces it.
   */
  readonly knowledge?: readonly NpcLead[];
}

/**
 * One authored lead a survivor can share (M4 task T53 · FR-NPC-06 · GDD XII "conversations that hint").
 * `hint` is the verbatim prose ("the clinic on 4th had a safe in the back"); resolving it `reveals` a real
 * node on the map and/or `marks` a discovery into a node's memory — listening pays in world state, never a
 * quest marker. `minTrust` gates when they'll open up (default {@link import("./social.js").ASK_TRUST_MIN}).
 */
export interface NpcLead {
  /** Stable id of this lead — flagged `told:<id>` on the survivor once shared (open flags, no save rung). */
  readonly id: string;
  readonly hint: string;
  /** Node id to lift onto the player's map (fog reveal), if any. */
  readonly reveals?: NodeId;
  /** A discovery to mark into a node's memory, if any. */
  readonly marks?: { readonly node: NodeId; readonly discovery: ContentId };
  /** Trust the survivor needs before they'll share this (0–100); defaults to a warm-ish threshold. */
  readonly minTrust?: number;
}

/** A survivor's modest starting needs; a `desperate` one opens hungrier and thirstier (a story hook). */
const NPC_BASE_NEEDS: Needs = { hunger: 15, thirst: 20, fatigue: 25 };
const NPC_DESPERATE_NEEDS: Needs = { hunger: 45, thirst: 50, fatigue: 40 };

/** Starting needs for a freshly-spawned survivor of this disposition. */
export function startingNeeds(disposition: NPCDisposition): Needs {
  return disposition === "desperate" ? NPC_DESPERATE_NEEDS : NPC_BASE_NEEDS;
}

/** The node ids a homeless survivor may be placed on, in stable order (graph nodes, else state nodes). */
function eligibleNodes(state: GameState, graph?: RegionGraph): readonly NodeId[] {
  return (graph ? Object.keys(graph.nodes) : Object.keys(state.nodes)).sort();
}

/**
 * Seed the survivor pool into a fresh run (called by `startRun`). Deterministic: defs are processed in
 * id order, a `homeNode` (when present and in the graph) pins placement, and every other survivor draws
 * a node from the named `npc` stream — so the same seed yields the same pool in the same places. Threads
 * `GameState.rng` through the draws and back. Inert (state unchanged, no draw) when `defs` is empty, so
 * every run that ships no survivors — and every M2 golden run — is byte-identical to before.
 */
export function spawnNpcs(state: GameState, defs: readonly NPCDef[], graph?: RegionGraph): GameState {
  if (defs.length === 0) return state;

  const nodes = eligibleNodes(state, graph);
  const nodeSet = new Set(nodes);
  const ordered = [...defs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let rng = state.rng;
  const npcs: Record<ActorId, NPCState> = { ...state.npcs };
  for (const def of ordered) {
    let location: NodeId | null;
    if (def.homeNode !== undefined && nodeSet.has(def.homeNode)) {
      location = def.homeNode;
    } else if (nodes.length > 0) {
      const draw = drawPick(rng, state.meta.seed, NPC_STREAM, nodes);
      rng = draw.rng;
      location = draw.value;
    } else {
      location = null;
    }
    npcs[def.id] = {
      id: def.id,
      type: def.id,
      name: def.name,
      disposition: def.disposition,
      needs: startingNeeds(def.disposition),
      location,
      alive: true,
      met: false,
      trust: startingTrust(def.disposition),
    };
  }
  return { ...state, npcs, rng };
}

/**
 * Drift one survivor's needs by the hours spent, reusing the player's survival economy (T22). A dead or
 * zero-hour survivor is returned unchanged. Pure, integer-only, no RNG. Survivors never "rest" on the
 * player's command, so `isRest` is always false — their needs only climb until an interaction (T35+)
 * relieves them.
 */
export function driftNpc(npc: NPCState, hours: number): NPCState {
  const h = Math.max(0, Math.trunc(hours));
  if (!npc.alive || h === 0) return npc;
  const needs = driftNeeds(npc.needs, false, h);
  // Teeth (T35 · FR-NPC): a survivor whose hunger or thirst reaches the fatal ceiling dies — `alive`
  // flips false and needs freeze here. They persist in `npcs` as a remembered body (the tick skips the
  // dead), and the Living History records the death by diffing `alive`. Mirrors the player's own
  // starvation/dehydration end (`NEED_FATAL`).
  if (needs.hunger >= NEED_FATAL || needs.thirst >= NEED_FATAL) return { ...npc, needs, alive: false };
  return needs === npc.needs ? npc : { ...npc, needs };
}

/**
 * The body of pipeline stage 5 (`updateCompanions`): drift every living survivor's needs by the hours an
 * action spent. Inert on a zero-hour tick or an empty pool (empty-turn contract). Pure — the stage name
 * and 14-stage order never change; only this body graduated from a no-op, as M2's world stages did.
 */
export function tickNpcs(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const ids = Object.keys(state.npcs);
  if (ids.length === 0) return state;

  let changed = false;
  const next: Record<ActorId, NPCState> = {};
  for (const id of ids) {
    const npc = state.npcs[id]!;
    const drifted = driftNpc(npc, h);
    if (drifted !== npc) changed = true;
    next[id] = drifted;
  }
  return changed ? { ...state, npcs: next } : state;
}
