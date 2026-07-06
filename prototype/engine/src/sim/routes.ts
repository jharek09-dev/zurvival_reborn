/**
 * Route conditions — the edges between nodes gain weather-driven state (M2 task T29 · FR-MAP-04).
 *
 * In M1 every route was free and identical: two hops cost the same `MOVE_COST` whatever the sky or
 * the state of the roads. T29 makes a route a *thing that can go bad*. Each undirected route carries
 * an integer `wear` (0–100) in the new `GameState.routes` slice, keyed by the sorted node-id pair.
 * `wear` maps to a legible condition:
 *
 *   clear (`< 25`, +0 h) · costly (`< 50`, +1 h) · flooded (`< 80`, +2 h) · **blocked** (`>= 80`, not
 *   offered — the one availability change FR-MAP-04 calls for).
 *
 * Wear rises toward a **target** set by the world — weather's reserved `movementDelta` (T27), the
 * endpoint regions' `roads` passability, and any active `fire` — and it rises **fast** under a storm or
 * iced roads while recovering **slowly** once the weather clears, so a flood persists across turns
 * (hysteresis, not a light switch). A fresh run seeds every route at `wear: 0`, so the opening plays at
 * the exact M1 move cost; a route entry that is simply absent (an old save mid-run) reads as clear — a
 * graceful, non-breaking default.
 *
 * The endpoints' regions come straight off `NodeState.regionId`, so the tick needs no graph. Pure,
 * deterministic, integer-only (ADR-0001): no RNG, no clock — the same weather + roads reproduce the
 * same conditions. Inert on a zero-hour tick.
 */

import type { GameState, NodeId, RouteState } from "../state/types.js";
import { weatherEffect } from "./weather.js";

// --- condition thresholds & costs (tunable) -------------------------------------------------

/** Wear at/above which a route is impassable (dropped from the offered moves). */
export const ROUTE_BLOCKED_AT = 80;
/** Wear thresholds for the milder conditions. */
export const ROUTE_FLOODED_AT = 50;
export const ROUTE_COSTLY_AT = 25;

/** A route's condition, derived from its wear. */
export type RouteCondition = "clear" | "costly" | "flooded" | "blocked";

/** How fast wear climbs vs. recovers, and the hours that make one step. */
export const ROUTE_WEAR_RISE_PER_STEP = 6;
export const ROUTE_WEAR_RECOVER_PER_STEP = 2;
export const ROUTE_HOURS_PER_STEP = 3;
/** Points of wear each unit of weather `movementDelta` contributes to the target. */
export const ROUTE_WEATHER_WEIGHT = 15;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

// --- keys & lookups -------------------------------------------------------------------------

/** Canonical undirected key for the route between two nodes (order-independent). */
export function routeKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The stored wear of a route, or 0 (clear) when there is no entry — the safe M1 default. */
export function routeWear(state: GameState, a: NodeId, b: NodeId): number {
  return state.routes[routeKey(a, b)]?.wear ?? 0;
}

/** The condition a wear level reads as. */
export function conditionOf(wear: number): RouteCondition {
  if (wear >= ROUTE_BLOCKED_AT) return "blocked";
  if (wear >= ROUTE_FLOODED_AT) return "flooded";
  if (wear >= ROUTE_COSTLY_AT) return "costly";
  return "clear";
}

/** Extra hours a route's condition adds to a move (a blocked route is never offered, so 0). */
export function extraCostOf(wear: number): number {
  switch (conditionOf(wear)) {
    case "flooded":
      return 2;
    case "costly":
      return 1;
    default:
      return 0;
  }
}

/** Whether a route is impassable and should be dropped from the offered moves. */
export function isBlocked(wear: number): boolean {
  return wear >= ROUTE_BLOCKED_AT;
}

/** The condition between two nodes right now (convenience for the Scene layer). */
export function routeCondition(state: GameState, a: NodeId, b: NodeId): RouteCondition {
  return conditionOf(routeWear(state, a, b));
}

// --- the drift -------------------------------------------------------------------------------

/** Move `current` toward `target` by at most `maxStep`, at least one point when there is a gap. */
function stepToward(current: number, target: number, maxStep: number): number {
  const gap = target - current;
  if (gap === 0) return current;
  const mag = Math.min(Math.abs(gap), Math.max(1, maxStep));
  return current + Math.sign(gap) * mag;
}

/**
 * The wear a route trends toward, from the world: worse weather (movement delta), lower endpoint
 * `roads`, and any endpoint `fire`. Clamped 0–100. Full roads + clear sky ⇒ 0 (clear).
 */
export function targetWear(state: GameState, a: NodeId, b: NodeId): number {
  const regA = state.nodes[a]?.regionId;
  const regB = state.nodes[b]?.regionId;
  const roadsA = (regA !== undefined ? state.regions[regA]?.roads : undefined) ?? 100;
  const roadsB = (regB !== undefined ? state.regions[regB]?.roads : undefined) ?? 100;
  const fireA = (regA !== undefined ? state.regions[regA]?.fire : undefined) ?? 0;
  const fireB = (regB !== undefined ? state.regions[regB]?.fire : undefined) ?? 0;
  const weatherMove = weatherEffect(state.world.weather).movementDelta;
  return clampPct((100 - Math.min(roadsA, roadsB)) + Math.max(fireA, fireB) + weatherMove * ROUTE_WEATHER_WEIGHT);
}

/**
 * Drift every route's wear toward its world-driven target as the tick's hours pass — climbing fast
 * under bad weather / broken roads, recovering slowly once it clears. Returns the same state
 * reference when nothing moved or on a zero-hour tick. Pure; reads region roads/fire off state, so no
 * graph is needed. This runs as a stage-8 world effect (just after weather) and again off-screen in
 * `advanceWorld`, so routes shift whether or not the player is watching.
 */
export function tickRoutes(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const steps = Math.max(1, Math.trunc(h / ROUTE_HOURS_PER_STEP));
  const riseMax = steps * ROUTE_WEAR_RISE_PER_STEP;
  const recoverMax = steps * ROUTE_WEAR_RECOVER_PER_STEP;

  let changed = false;
  const routes: Record<string, RouteState> = {};
  for (const [key, route] of Object.entries(state.routes)) {
    const sep = key.indexOf("|");
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    const target = targetWear(state, a, b);
    const maxStep = target > route.wear ? riseMax : recoverMax;
    const wear = stepToward(route.wear, target, maxStep);
    if (wear !== route.wear) {
      routes[key] = { ...route, wear };
      changed = true;
    } else {
      routes[key] = route;
    }
  }
  return changed ? { ...state, routes } : state;
}

/** Seed the `routes` slice from a graph's undirected edges, every route clear (`wear: 0`). */
export function seedRoutes(adjacency: { readonly [id: NodeId]: readonly NodeId[] }): {
  readonly [key: string]: RouteState;
} {
  const out: Record<string, RouteState> = {};
  for (const [id, neighbours] of Object.entries(adjacency)) {
    for (const nb of neighbours) {
      out[routeKey(id, nb)] = { wear: 0 };
    }
  }
  return out;
}
