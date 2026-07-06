/**
 * Turn-change telemetry — the FR-CORE-04 audit (M1 task T13 · DESIGN §11).
 *
 * The Definition-of-Done invariant for the core loop is that there are **no no-op turns**: every
 * *resolved* turn must move at least one real system, not merely tick the clock (PRD FR-CORE-04,
 * GDD III "low rate of no-consequence turns"). This module makes that provable by machine rather
 * than by hand — it diffs the turn's before/after {@link GameState} and reports which tracked
 * systems changed, so the pipeline can attach the finding to every turn and a test harness can
 * audit a long run in bulk ("a telemetry audit of 100 turns shows every turn mutated at least one
 * tracked system", PRD §6.1).
 *
 * What counts as a "system": the simulation slices of GameState — the player, the world and its
 * regions/nodes, actors/groups/hordes, items, and the story. `meta` is deliberately **excluded**:
 * it is bookkeeping (seed, timestamps, and the always-advancing clock + turn counter). Counting
 * the clock would make the invariant vacuously true — a turn that only spent time would "pass" —
 * which is exactly the no-consequence turn this audit exists to catch. Time advancing is already
 * guaranteed separately by FR-CORE-03; this audit asks the harder question: did anything *else*?
 *
 * Comparison is by **value** (structural deep-equal over plain JSON), not by reference. A pure
 * pipeline stage may allocate a fresh slice object whose contents are identical (e.g. re-deriving
 * needs that were already clamped at their bounds); reference equality would mis-report that as a
 * change. Deep-equal keeps the telemetry honest — it reports a system changed only when a player
 * would actually observe a difference. GameState is all plain JSON (no Map/Set/Date/undefined, by
 * the T3 discipline), so a compact recursive compare is total and safe.
 *
 * Pure and dependency-free (ADR-0001): no clock, no RNG, no mutation of the inputs.
 */

import type { GameState } from "../state/types.js";

/**
 * The GameState slices audited for FR-CORE-04, in a stable order. These are the "systems" a
 * resolved turn is expected to move. `meta`, `rng`... note: `rng` *is* included — consuming a
 * random draw is a real state change a turn is entitled to make. Only `meta` (clock/bookkeeping)
 * is omitted, for the reason in the module doc.
 */
export const TRACKED_SYSTEMS = [
  "player",
  "world",
  "regions",
  "nodes",
  "actors",
  "groups",
  "hordes",
  "combat",
  "items",
  "story",
  "history",
  "queue",
  "rng",
] as const satisfies readonly (keyof GameState)[];

/** A tracked system key (one of {@link TRACKED_SYSTEMS}). */
export type TrackedSystem = (typeof TRACKED_SYSTEMS)[number];

/** The telemetry produced for one turn by {@link auditTurn}. */
export interface TurnAudit {
  /** The `meta.turn` value *after* the turn resolved (the turn this record describes). */
  readonly turn: number;
  /**
   * Whether the pipeline treated this as a resolved turn — i.e. the turn counter advanced. A
   * zero-cost `wait` does not advance the counter and so is not a resolved turn; FR-CORE-04 makes
   * no demand of it and {@link TurnAudit.ok} stays true.
   */
  readonly resolved: boolean;
  /** The tracked systems whose value changed this turn, in {@link TRACKED_SYSTEMS} order. */
  readonly changedSystems: readonly TrackedSystem[];
  /**
   * The FR-CORE-04 verdict: `true` when the turn was not a resolved turn, or when it was and at
   * least one tracked system changed. `false` marks a no-consequence resolved turn — the exact
   * thing the invariant forbids.
   */
  readonly ok: boolean;
}

/**
 * Structural deep-equality for plain-JSON values. Total over anything GameState can hold
 * (objects, arrays, strings, finite numbers, booleans, null). Key order is irrelevant. Not a
 * general-purpose deep-equal — it assumes the T3 plain-JSON discipline and does not handle
 * Map/Set/Date/undefined/functions, which GameState never contains.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false; // one is null, the other isn't (a === b handled both-null)
  if (typeof a !== "object") return false; // distinct primitives

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * The tracked systems whose value differs between two states, in {@link TRACKED_SYSTEMS} order.
 * The heart of the audit; {@link meta} is never inspected.
 */
export function diffSystems(before: GameState, after: GameState): readonly TrackedSystem[] {
  const changed: TrackedSystem[] = [];
  for (const key of TRACKED_SYSTEMS) {
    if (!jsonEqual(before[key], after[key])) changed.push(key);
  }
  return changed;
}

/**
 * Audit one turn's before/after state for FR-CORE-04. A turn is "resolved" when its counter
 * advanced (`after.meta.turn > before.meta.turn`); a resolved turn must have changed ≥ 1 tracked
 * system to pass. Pure — inspects, never mutates.
 */
export function auditTurn(before: GameState, after: GameState): TurnAudit {
  const resolved = after.meta.turn > before.meta.turn;
  const changedSystems = diffSystems(before, after);
  return {
    turn: after.meta.turn,
    resolved,
    changedSystems,
    ok: !resolved || changedSystems.length > 0,
  };
}
