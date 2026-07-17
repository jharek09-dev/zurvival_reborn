import { describe, expect, it } from "vitest";
import {
  encounterFires,
  summarizeRepetition,
  summarizeRunRepetition,
  RECENCY_WINDOW_HOURS,
  VERBATIM_REPEAT_TARGET,
  type EncounterFire,
  type GameState,
} from "../src/index.js";

/**
 * T48 — the PRD §4 verbatim-repeat-rate instrumentation. A pure, client-driven fold of the run's
 * `encounter.begin` beats into the §4 metric + variety signals. This is the source of truth the hard CI
 * gate asserts against; here we prove the math (including that it can DETECT a repeat, so a green gate is
 * meaningful, not vacuous).
 */

const fire = (encounter: string, day: number, hour: number, category = "exploration"): EncounterFire => ({ turn: day * 24 + hour, day, hour, encounter, category });

describe("summarizeRepetition — the §4 metric math (T48 · PRD §4)", () => {
  it("no fires ⇒ everything zero", () => {
    const s = summarizeRepetition([]);
    expect(s).toMatchObject({ fires: 0, distinct: 0, verbatimRepeatRate: 0, windowedRepeats: 0, immediateRepeats: 0, maxSingleShare: 0 });
  });

  it("all-distinct fires ⇒ zero repeat rate", () => {
    const s = summarizeRepetition([fire("a", 1, 0), fire("b", 1, 4), fire("c", 1, 8)]);
    expect(s.fires).toBe(3);
    expect(s.distinct).toBe(3);
    expect(s.verbatimRepeatRate).toBe(0);
    expect(s.immediateRepeats).toBe(0);
  });

  it("a same-id re-fire WITHIN the recency window is a verbatim repeat — the metric detects it", () => {
    // 'a' at h0, again at h20 (≤ 48h) ⇒ 1 windowed repeat of 4 fires = 25% (well over the §4 target)
    const s = summarizeRepetition([fire("a", 1, 0), fire("b", 1, 10), fire("a", 1, 20), fire("c", 1, 30)]);
    expect(s.windowedRepeats).toBe(1);
    expect(s.verbatimRepeatRate).toBeCloseTo(0.25, 5);
    expect(s.verbatimRepeatRate).toBeGreaterThan(VERBATIM_REPEAT_TARGET);
  });

  it("a same-id re-fire OUTSIDE the window (spaced by a cooldown) is NOT a verbatim repeat", () => {
    // 'a' at day1 h0, again day4 h0 (72h > the 48h window) — exactly what a cooldown ≥ window buys
    const s = summarizeRepetition([fire("a", 1, 0), fire("a", 4, 0)]);
    expect(s.windowedRepeats).toBe(0);
    expect(s.verbatimRepeatRate).toBe(0);
    expect(s.distinct).toBe(1);
    expect(s.maxSingleShare).toBe(1);
  });

  it("the window boundary is inclusive at exactly RECENCY_WINDOW_HOURS", () => {
    const atWindow = summarizeRepetition([fire("a", 1, 0), fire("a", 1, RECENCY_WINDOW_HOURS)]);
    expect(atWindow.windowedRepeats).toBe(1); // exactly 48h apart still counts
    const pastWindow = summarizeRepetition([fire("a", 1, 0), fire("a", 1, RECENCY_WINDOW_HOURS + 1)]);
    expect(pastWindow.windowedRepeats).toBe(0);
  });

  it("immediateRepeats counts back-to-back same id; byCategory tallies the mix", () => {
    const s = summarizeRepetition([fire("a", 1, 0, "story"), fire("a", 1, 1, "story"), fire("b", 1, 2, "combat")]);
    expect(s.immediateRepeats).toBe(1);
    expect(s.byCategory).toEqual({ story: 2, combat: 1 });
    expect(s.maxSingleShare).toBeCloseTo(2 / 3, 5);
  });

  it("a custom window can be passed (a stricter or looser verbatim definition)", () => {
    const fires = [fire("a", 1, 0), fire("a", 1, 30)];
    expect(summarizeRepetition(fires, 24).windowedRepeats).toBe(0); // 30h apart, 24h window
    expect(summarizeRepetition(fires, 48).windowedRepeats).toBe(1); // 30h apart, 48h window
  });
});

describe("encounterFires — reading the beats off a run (T48)", () => {
  it("pulls encounter.begin beats in order, ignoring other history", () => {
    const state = {
      history: [
        { day: 1, hour: 0, turn: 1, type: "weather.turn", subjects: [], data: {} },
        { day: 1, hour: 2, turn: 2, type: "encounter.begin", subjects: ["encounter.z", "node.q"], data: { encounter: "encounter.z", category: "social" } },
        { day: 1, hour: 5, turn: 3, type: "horde.move", subjects: [], data: {} },
        { day: 2, hour: 1, turn: 9, type: "encounter.begin", subjects: ["encounter.y", "node.q"], data: { encounter: "encounter.y", category: "shelter" } },
      ],
    } as unknown as GameState;
    const f = encounterFires(state);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ encounter: "encounter.z", category: "social", day: 1, hour: 2 });
    expect(f[1]).toMatchObject({ encounter: "encounter.y", category: "shelter", day: 2, hour: 1 });
    expect(summarizeRunRepetition(state).fires).toBe(2);
  });

  it("falls back to subjects[0] when a beat carries no data.encounter", () => {
    const state = { history: [{ day: 1, hour: 0, turn: 1, type: "encounter.begin", subjects: ["encounter.legacy", "node.q"], data: null }] } as unknown as GameState;
    expect(encounterFires(state)[0]?.encounter).toBe("encounter.legacy");
  });
});
