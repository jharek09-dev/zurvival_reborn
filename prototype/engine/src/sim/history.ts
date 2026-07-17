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
 * fight ending, a survivor met/lost, a companion recruited/fallen, the run ending. A quiet turn writes nothing.
 *
 * Pure, deterministic, dependency-free (ADR-0001): a diff of two plain-JSON states in a fixed order, no
 * RNG, no clock read beyond the `meta` already on the resolved state. Wired at pipeline stage 13
 * (`evaluateStory`) and inside `advanceWorld`, so off-screen fast-forwards leave a trace too.
 */

import type { GameState, HistoryEvent } from "../state/types.js";
import { conditionOf } from "./routes.js";
import { runEndReason } from "./survival.js";
import { isCompanion } from "./companions.js";
import { stageRank } from "./infection.js";

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

  // People (T35/T36): a survivor met, a survivor died of neglect, a companion recruited, a companion lost.
  // A recruited survivor leaves `npcs` entirely (moved to `actors`), so an `alive` flip within `npcs` is
  // an unambiguous death, never a graduation.
  for (const id of Object.keys(after.npcs).sort()) {
    const b = before.npcs[id];
    const a = after.npcs[id]!;
    if (b === undefined) continue;
    if (!b.met && a.met) events.push(stamp(after, "npc.met", [id], { name: a.name }));
    if (b.alive && !a.alive) events.push(stamp(after, "npc.died", [id], { name: a.name }));
  }
  for (const id of Object.keys(after.actors).sort()) {
    if (before.actors[id] === undefined && isCompanion(after.actors[id]!)) {
      events.push(stamp(after, "companion.recruited", [id], {}));
    }
  }
  for (const id of Object.keys(before.actors).sort()) {
    // A companion who VANISHED from `actors`. Distinguish death from the T53 hard turns: desertion/betrayal
    // set a `left.<id>` flag on the player before this diff runs, so a companion who *left* is never logged
    // as `companion.died` (the `social.deserted`/`social.betrayed` beats own that outcome). Only a genuine
    // death (combat loss / starvation removal) reaches here with no `left.` flag.
    if (after.actors[id] === undefined && isCompanion(before.actors[id]!) && after.player.flags[`left.${id}`] !== true) {
      events.push(stamp(after, "companion.died", [id], {}));
    }
  }

  // Shelter (T37/T38): a base claimed, or fortification raised. A claim flips shelterId from null; a fortify
  // raises the shelter node's barricades (a decay-only turn lowers them and logs nothing).
  const sid = after.player.shelterId;
  if (before.player.shelterId === null && sid !== null) {
    events.push(stamp(after, "shelter.claimed", [sid], {}));
  } else if (sid !== null && before.player.shelterId === sid) {
    const wasB = before.nodes[sid]?.barricades ?? 0;
    const nowB = after.nodes[sid]?.barricades ?? 0;
    if (nowB > wasB) events.push(stamp(after, "shelter.fortified", [sid], { from: wasB, to: nowB }));
  }

  // Infection deepened a stage this turn (T49 · FR-INJ-05): the fever crossing into symptomatic /
  // advanced / terminal is a moment the survivor remembers. Only on a *worsening* transition (rank rose);
  // a cure that pulls it back, or a steady turn, logs nothing — and no bite-free run ever reaches here.
  const stageBefore = before.player.condition.infection.stage;
  const stageAfter = after.player.condition.infection.stage;
  if (stageRank(stageAfter) > stageRank(stageBefore)) {
    events.push(stamp(after, "infection.staged", ["player"], { from: stageBefore, to: stageAfter }));
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
