/**
 * Encounter-variety telemetry — the PRD §4 "verbatim encounter repetition" health signal (M4 task T48 ·
 * FR-ENC-01/02 · PRD §4 · risk "Content volume").
 *
 * T48's job is to keep a full run's *verbatim* encounter repeats under the §4 target — **< 5% within a
 * single run** — by recombination + cooldowns, never raw volume. This module makes that "measured, not
 * guessed": it folds a run's `encounter.begin` beats (the Living History, T31) into the §4 rate and the
 * supporting variety metrics, so a harness test can assert the gate over a real full-run traversal.
 *
 * Like the T32 pacing baseline it is deliberately **client-driven** — nothing in the pipeline captures a
 * sample; a client/test calls {@link encounterFires} on the state it already has. Every read is a pure
 * function of the deterministic history, so a seeded run yields byte-identical numbers every time. No
 * RNG, no clock, no capture side effects, no new state.
 *
 * What "verbatim repeat" means here: a fired encounter whose *same id* the player already saw **within
 * `RECENCY_WINDOW_HOURS`** — the window in which a re-fire reads as verbatim. Cooldowns ≥ the window
 * (T48) push same-id re-fires outside it, so the windowed rate is driven toward zero; a mis-set or
 * missing cooldown makes it spike, which is exactly what the hard gate catches. (Recombination via tags/
 * conditions and evolution — different ids/text for the same place — reduce it further, since those
 * re-fires aren't the same id at all.)
 */

import type { GameState, HistoryEvent } from "../state/types.js";

/** The Living-History beat an engage logs (mirrors `events.ts`). */
export const ENCOUNTER_BEGIN = "encounter.begin";

/** The window within which a same-id re-fire counts as a verbatim repeat (hours). Two days. */
export const RECENCY_WINDOW_HOURS = 48;

/** The PRD §4 target — verbatim repetition must sit under this across a full run. */
export const VERBATIM_REPEAT_TARGET = 0.05;

/** One recorded encounter engagement, read back from history. */
export interface EncounterFire {
  readonly turn: number;
  readonly day: number;
  readonly hour: number;
  readonly encounter: string;
  readonly category: string;
}

const absHour = (day: number, hour: number): number => day * 24 + hour;

/** Pull one fire out of an `encounter.begin` beat (id from data.encounter, else subjects[0]). */
function fireOf(ev: HistoryEvent): EncounterFire | null {
  if (ev.type !== ENCOUNTER_BEGIN) return null;
  const data = typeof ev.data === "object" && ev.data !== null ? (ev.data as { encounter?: unknown; category?: unknown }) : {};
  const idRaw = data.encounter ?? ev.subjects[0];
  const id = typeof idRaw === "string" ? idRaw : "";
  if (id.length === 0) return null;
  const category = typeof data.category === "string" ? data.category : "";
  return { turn: ev.turn, day: ev.day, hour: ev.hour, encounter: id, category };
}

/** Every encounter the run has fired, oldest → newest (the order the player saw them). Pure. */
export function encounterFires(state: GameState): readonly EncounterFire[] {
  const out: EncounterFire[] = [];
  for (const ev of state.history) {
    const f = fireOf(ev);
    if (f !== null) out.push(f);
  }
  return out;
}

/** The §4 headline plus the supporting variety metrics a run's fires fold into. */
export interface RepetitionSummary {
  /** Total encounters fired in the run. */
  readonly fires: number;
  /** Distinct encounter ids fired. */
  readonly distinct: number;
  /**
   * The §4 metric: fraction of fires that repeat an id the player already saw within
   * `RECENCY_WINDOW_HOURS`. 0 when nothing (or nothing repeatable) fired. Must sit under
   * {@link VERBATIM_REPEAT_TARGET}.
   */
  readonly verbatimRepeatRate: number;
  /** Count behind the rate — same-id re-fires whose previous occurrence was inside the window. */
  readonly windowedRepeats: number;
  /** The harsher tic: a fire whose immediately-preceding fire was the same id (back-to-back). */
  readonly immediateRepeats: number;
  /** Largest single-encounter share of all fires (0–1) — concentration; low ⇒ the weighting spreads load. */
  readonly maxSingleShare: number;
  /** Fires per category (FR-ENC-05 mix health). */
  readonly byCategory: { readonly [category: string]: number };
}

/**
 * Fold a run's fires (oldest→newest) into the §4 metric + variety metrics. `windowHours` is the recency
 * window a same-id re-fire must beat to count as verbatim (defaults to {@link RECENCY_WINDOW_HOURS}).
 * Pure; deterministic over deterministic fires.
 */
export function summarizeRepetition(
  fires: readonly EncounterFire[],
  windowHours: number = RECENCY_WINDOW_HOURS,
): RepetitionSummary {
  const n = fires.length;
  const lastAbsById = new Map<string, number>();
  const countById = new Map<string, number>();
  const byCategory: { [category: string]: number } = {};
  let windowedRepeats = 0;
  let immediateRepeats = 0;
  let prevId: string | null = null;

  for (const f of fires) {
    const abs = absHour(f.day, f.hour);
    const last = lastAbsById.get(f.encounter);
    if (last !== undefined && abs - last <= windowHours) windowedRepeats++;
    if (prevId !== null && prevId === f.encounter) immediateRepeats++;
    lastAbsById.set(f.encounter, abs);
    countById.set(f.encounter, (countById.get(f.encounter) ?? 0) + 1);
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    prevId = f.encounter;
  }

  const maxCount = countById.size === 0 ? 0 : Math.max(...countById.values());
  return {
    fires: n,
    distinct: countById.size,
    verbatimRepeatRate: n === 0 ? 0 : windowedRepeats / n,
    windowedRepeats,
    immediateRepeats,
    maxSingleShare: n === 0 ? 0 : maxCount / n,
    byCategory,
  };
}

/** Convenience: read the fires off a state and summarize in one call. */
export function summarizeRunRepetition(state: GameState, windowHours: number = RECENCY_WINDOW_HOURS): RepetitionSummary {
  return summarizeRepetition(encounterFires(state), windowHours);
}
