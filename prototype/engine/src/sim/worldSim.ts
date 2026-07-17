/**
 * The world simulation — six independently-tickable layers (M2 task T23 · FR-SIM-01 · DESIGN §4/§5).
 *
 * FR-SIM-01 asks for six *state* layers (player, companion, local, region, global, story) that are
 * **independently updatable**. Those slices already exist in `GameState`; what M1 lacked is the
 * second half — a way to advance the *world* side (local + region + global) on its own clock, with
 * no player action. In M1 the world only moved as a side effect of `applyAction`: noise decayed and
 * the loot contest ran because the *player's* action spent hours. This module lifts that into a
 * first-class abstraction so the same systems can be advanced by an arbitrary number of hours with
 * nothing submitted — the substrate every other M2 task (T24–T32) plugs a real behaviour into.
 *
 * The world half decomposes into the six operational layers M2 schedules (the T23 note's list):
 *
 *   | layer     | pipeline stage           | becomes real in |
 *   |-----------|--------------------------|-----------------|
 *   | zombies   | 6 updateNode (after noise) | T25            |
 *   | regions   | 7 updateRegion           | T24 (drift) / T17 (contest, live) |
 *   | weather   | 8 updateWorld            | T27             |
 *   | timeOfDay | 8 updateWorld            | T28             |
 *   | hordes    | 9 moveHordes             | T26             |
 *   | director  | 11 tickDirector          | T30             |
 *
 * `WORLD_SIM_LAYERS` is listed in **execution order**, which equals the fixed pipeline stage order
 * (DESIGN §5) — so a pipeline turn's world effect and {@link advanceWorld} over the same hours are
 * the *same* transform. The 14-stage pipeline names/order never change (the invariant `pipeline.test`
 * asserts); each stage's body simply delegates to its layer here, and a layer graduates from a no-op
 * to a real system by swapping its `tick` — the wiring stays put.
 *
 * Purity (ADR-0001): every layer is a pure transform of `GameState`; no clock, no global RNG. A layer
 * that needs randomness draws from its own **named** stream (`region`, `zombie`, `horde`, `weather`)
 * so adding a draw to one layer can never shift another's sequence, and a seed reproduces the whole
 * world byte-for-byte. RNG is threaded through `GameState.rng`, never through the context.
 */

import type { GameState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { decayAllNoise } from "./noise.js";
import { updateRegionContest } from "./loot.js";
import { driftRegions } from "./regionDrift.js";
import { tickZombies } from "./zombies.js";
import { tickHordes } from "./hordes.js";
import { tickWeather } from "./weather.js";
import { tickRoutes } from "./routes.js";
import { recordInto } from "./history.js";
import { tickTimeOfDay } from "./timeOfDay.js";
import { tickDirector } from "./director.js";
import { tickCompanions } from "./companions.js";
import { tickShelterOps, offscreenShelterUpkeep, jobsActive } from "./jobs.js";

/**
 * Everything a layer may read that is not already in `GameState`: the `hours` this tick spans (drives
 * every rate) and the transient region `graph` (present for a real run; absent off-screen or before
 * content loads — graph-dependent layers no-op without it). RNG is deliberately absent; it lives in
 * `GameState.rng`.
 */
export interface SimContext {
  /** In-game hours this tick spans (truncated, floored at 0 by callers). */
  readonly hours: number;
  /** Transient adjacency index for a real run; graph-dependent layers are inert without it. */
  readonly graph?: RegionGraph;
}

/** The six world-sim layers, in canonical execution order (= pipeline stage order). */
export type SimLayerId = "zombies" | "regions" | "weather" | "timeOfDay" | "hordes" | "director";

/** One world-sim layer: a named, pure transform of GameState — the pipeline-stage contract, addressable. */
export interface SimLayer {
  readonly id: SimLayerId;
  readonly tick: (state: GameState, ctx: SimContext) => GameState;
}


/**
 * Regions layer: off-screen threat/density drift (T24), then the T17 loot contest — every region
 * evolves on its own clock as the tick's hours pass, whether or not the player is present.
 */
const regionsLayer: SimLayer = {
  id: "regions",
  tick: (state, ctx) => updateRegionContest(driftRegions(state, ctx.hours), ctx.hours),
};

/**
 * The six layers in execution order — all live as of M2 Part 2 (the last two, timeOfDay and director,
 * landed in T28/T30). The canonical order and the six ids stay fixed; only the bodies changed.
 */
const zombiesLayer: SimLayer = {
  id: "zombies",
  tick: (state, ctx) => tickZombies(state, ctx.hours, ctx.graph),
};

const weatherLayer: SimLayer = {
  id: "weather",
  tick: (state, ctx) => tickWeather(state, ctx.hours),
};

/**
 * Time-of-day layer: relax `world.globalThreat` toward the current phase's danger target (T28) — the
 * diurnal tide that rises after dark and ebbs by day. Pure; touches only `world`.
 */
const timeOfDayLayer: SimLayer = {
  id: "timeOfDay",
  tick: (state, ctx) => tickTimeOfDay(state, ctx.hours),
};

const hordesLayer: SimLayer = {
  id: "hordes",
  tick: (state, ctx) => tickHordes(state, ctx.hours, ctx.graph),
};

/**
 * Director layer: a bounded pacing controller that nudges the current region's danger dials within
 * legal bounds (T30) — escalating a calm run, relieving an overwhelmed one, never impossible.
 */
const directorLayer: SimLayer = {
  id: "director",
  tick: (state, ctx) => tickDirector(state, ctx.hours),
};

export const WORLD_SIM_LAYERS: readonly SimLayer[] = [
  zombiesLayer,
  regionsLayer,
  weatherLayer,
  timeOfDayLayer,
  hordesLayer,
  directorLayer,
];

/** Look up a layer by id (throws on an unknown id — a programming error, never runtime data). */
export function getLayer(id: SimLayerId): SimLayer {
  const layer = WORLD_SIM_LAYERS.find((l) => l.id === id);
  if (layer === undefined) throw new Error(`worldSim: unknown layer "${id}"`);
  return layer;
}

/** Run one layer by id — the seam the pipeline's world stages call. Pure. */
export function runLayer(state: GameState, id: SimLayerId, ctx: SimContext): GameState {
  return getLayer(id).tick(state, ctx);
}

/** Fold every layer in canonical order. Pure; the same transform the pipeline applies across its world stages. */
export function tickWorld(state: GameState, ctx: SimContext): GameState {
  let next = state;
  for (const layer of WORLD_SIM_LAYERS) {
    next = layer.tick(next, ctx);
  }
  return next;
}

/**
 * The off-screen driver — advance the *world* by `hours` with **no player action** (FR-SIM-01's
 * "independently updatable"). Decays node noise by the hours (the passage-of-time half of stage 6,
 * without the action's deposit), then folds every layer for those hours. Leaves `meta` (the clock and
 * turn counter) to the caller: this moves the world, not the player's turn. Deterministic — same
 * (state, hours, seed) ⇒ byte-identical result — and save-lossless (it only ever writes plain-JSON
 * world slices). A zero-hour advance is inert.
 *
 * As of T52 the base runs off-screen too: with an active job pool, the party drifts and works its standing
 * orders (the off-screen half of PL-M4-08), the shelter runs its jobs and feeds its residents from the
 * stash, and its barricades decay (PL-M3-05). All of that is gated on `jobsActive(graph)`, so every
 * pool-free off-screen advance — every prior run and every existing off-screen suite — is byte-identical.
 */
export function advanceWorld(state: GameState, hours: number, graph?: RegionGraph): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const nodes = decayAllNoise(state.nodes, h);
  const decayed = nodes === state.nodes ? state : { ...state, nodes };
  const world = tickWorld(decayed, graph === undefined ? { hours: h } : { hours: h, graph });
  // Routes drift off-screen too — a storm blocks a road whether or not the player is there (T29).
  const ticked = tickRoutes(world, h);
  // The shelter half (T52) — inert without a job pool, so no prior run is touched. The party ticks (needs
  // drift + scavenge/guard orders), the shelter runs its jobs + feeds its residents, then barricades erode.
  // (Off-screen non-party survivors still don't drift — that people-sim half stays PL-M3-02/T53.)
  let shel = ticked;
  if (jobsActive(graph)) {
    // Feed + run the base first, then drift the party (a starving resident dies only after the cache has
    // had its chance to feed them — PL-M3-01), then decay the barricades.
    shel = tickShelterOps(shel, graph, h);
    shel = tickCompanions(shel, h);
    shel = offscreenShelterUpkeep(shel, graph, h);
  }
  // Off-screen fast-forwards leave a trace in the Living History too (T31).
  return recordInto(state, shel);
}
