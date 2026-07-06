/**
 * Living History — the append-only world log (M2 task T31 · FR-SIM-11 · GDD Part IV).
 *
 * `GameState.history` (the `HistoryEvent[]` that has existed since T3) starts recording. The world now
 * moves every turn — weather turns, hordes migrate, routes flood, the director paces, night falls — and
 * a survivor *remembers* the notable moments. This module is the single observer: it diffs the turn's
 * **before** and **after** and emits the events worth keeping, each stamped with the resolved clock,
 * then appends them. The log is **append-only and never rewritten** — the discipline the FR names — so
 * later story and telemetry can trust it as ground truth.
 *
 * It is deliberately **selective**. Logging every turn would bloat the save and make `history` a
 * vacuously-always-changed system in the FR-CORE-04 audit — so it records only what a person would
 * actually recall: a change in the sky, nightfall, a horde stepping, a route's condition turning, a
 * fight ending, the run ending. A quiet turn writes nothing.
 *
 * Pure, deterministic, dependency-free (ADR-0001): a diff of two plain-JSON states in a fixed order, no
 * RNG, no clock read beyond the `meta` already on the resolved state. Wired at pipeline stage 13
 * (`evaluateStory`) and inside `advanceWorld`, so off-screen fast-forwards leave a trace too.
 */

import type { GameState, HistoryEvent } from "../state/types.js";
import { conditionOf } from "./routes.js";
import { runEndReason } from "./survival.js";

/** Stamp an event with the resolved clock (day/hour/turn from the after-state). */
function stamp(after: GameState, type: string, subjects: readonly string[], data: HistoryEvent["data"]): HistoryEvent {
  return { day: after.meta.day, hour: after.meta.hour, turn: after.meta.turn, type, subjects, data };
}

/**
 * The notable events the turn produced, in a stable order (weather · nightfall · horde moves · route
 * turns · combat cleared · run ended). Empty when nothing worth remembering happened. Pure diff.
 */
export function recordHistory(before: GameState, after: GameState): readonly HistoryEvent[] {
  const events: HistoryEvent[] = [];

  // The sky turned.
  if (before.world.weather !== after.world.weather) {
    events.push(stamp(after, "weather.change", [], { from: before.world.weather, to: after.world.weather }));
  }

  // Night fell (the phase crossed into night this turn).
  if (before.meta.phase !== "night" && after.meta.phase === "night") {
    events.push(stamp(after, "nightfall", [], {}));
  }

  // Hordes that stepped to a new node.
  const beforeHorde: { readonly [id: string]: string } = Object.fromEntries(before.hordes.map((h) => [h.id, h.pos]));
  for (const h of [...after.hordes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const was = beforeHorde[h.id];
    if (was !== undefined && was !== h.pos) {
      events.push(stamp(after, "horde.move", [h.id], { from: was, to: h.pos, dest: h.dest }));
    }
  }

  // Routes whose *condition* (not just wear) changed.
  for (const key of Object.keys(after.routes).sort()) {
    const beforeWear = before.routes[key]?.wear ?? 0;
    const afterWear = after.routes[key]!.wear;
    const from = conditionOf(beforeWear);
    const to = conditionOf(afterWear);
    if (from !== to) {
      const sep = key.indexOf("|");
      events.push(stamp(after, "route.change", [key.slice(0, sep), key.slice(sep + 1)], { from, to }));
    }
  }

  // A fight cleared this turn.
  if (before.combat !== null && after.combat === null) {
    events.push(stamp(after, "combat.cleared", [before.combat.enemy], { at: before.combat.node }));
  }

  // The run ended this turn.
  const endBefore = runEndReason(before);
  const endAfter = runEndReason(after);
  if (endBefore === null && endAfter !== null) {
    events.push(stamp(after, "run.ended", ["player"], { reason: endAfter }));
  }

  return events;
}

/** Append events to the log (append-only; never rewrites). Same reference when there is nothing to add. */
export function appendHistory(state: GameState, events: readonly HistoryEvent[]): GameState {
  if (events.length === 0) return state;
  return { ...state, history: [...state.history, ...events] };
}

/** Convenience: diff a turn and append whatever it produced. Pure. */
export function recordInto(before: GameState, after: GameState): GameState {
  return appendHistory(after, recordHistory(before, after));
}
