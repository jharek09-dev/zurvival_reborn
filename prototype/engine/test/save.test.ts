import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SAVE_FORMAT,
  SAVE_SCHEMA_VERSION,
  SaveError,
  applyAction,
  createInitialState,
  describeSave,
  drawInt,
  loadGame,
  saveGame,
  serializeSave,
} from "../src/index.js";
import type { Action, GameState } from "../src/index.js";

const newState = () =>
  createInitialState({ seed: "test-seed", createdAt: "2026-07-05T00:00:00Z" });

/** A state that exercises the non-trivial containers a save must preserve. */
function busyState(): GameState {
  const base = newState();
  // Advance the rng so a stream is actually serialized (not the empty default).
  const { rng } = drawInt(base.rng, base.meta.seed, "loot", 0, 1000);
  return {
    ...base,
    rng,
    meta: { ...base.meta, day: 4, hour: 19, phase: "evening", turn: 12 },
    player: {
      ...base.player,
      location: "node.transit-yard",
      condition: {
        ...base.player.condition,
        wounds: [
          { type: "wound.bite.forearm", site: "left-forearm", severity: 40, treated: 10, inflictedDay: 3 },
        ],
      },
    },
    history: [
      { day: 3, hour: 8, turn: 9, type: "wound.inflicted", subjects: ["player"], data: { by: "walker" } },
    ],
    queue: [{ id: "evt.dawn-raid", dueDay: 5, dueHour: 6, kind: "raid", data: {} }],
  };
}

describe("Save / load (T7 — NFR-SAVE-01/02, DESIGN §9)", () => {
  it("wraps state in a versioned, self-identifying envelope (TC-DET-07)", () => {
    const env = serializeSave(busyState());
    expect(env.format).toBe(SAVE_FORMAT);
    expect(env.saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(env.summary).toContain("Day 4");
    expect(env.summary).toContain("turn 12");
  });

  it("round-trips losslessly — deep-equal incl. rng, history, queue (TC-DET-05)", () => {
    const state = busyState();
    const restored = loadGame(saveGame(state));
    expect(restored).toStrictEqual(state);
  });

  it("round-trips for arbitrary post-turn states (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 50 }), (seed, turns) => {
        let s = createInitialState({ seed, createdAt: "2026-07-05T00:00:00Z" });
        const act: Action = { type: "wait" };
        for (let i = 0; i < turns; i++) s = applyAction(s, act).state;
        expect(loadGame(saveGame(s))).toStrictEqual(s);
      }),
    );
  });

  it("is deterministic — identical state ⇒ byte-identical save (ADR-0001, no clock)", () => {
    const state = busyState();
    expect(saveGame(state)).toBe(saveGame(state));
    // Two independently created equal states also serialize identically.
    expect(saveGame(newState())).toBe(saveGame(newState()));
  });

  it("pretty and compact forms both load back to the same state", () => {
    const state = busyState();
    expect(loadGame(saveGame(state, true))).toStrictEqual(state);
    expect(loadGame(saveGame(state, false))).toStrictEqual(state);
  });

  it("summary is derived purely from state and notes wounds", () => {
    expect(describeSave(newState())).toBe("Day 1, dawn (06:00) — turn 0 @ node.start");
    expect(describeSave(busyState())).toContain("1 wound");
  });

  it("rejects malformed JSON", () => {
    expect(() => loadGame("{not json")).toThrow(SaveError);
  });

  it("rejects a foreign / non-save object", () => {
    expect(() => loadGame(JSON.stringify({ hello: "world" }))).toThrow(SaveError);
    expect(() => loadGame(JSON.stringify({ format: "something-else" }))).toThrow(/format/);
  });

  it("rejects a save from a newer schema than this build understands", () => {
    const env = serializeSave(newState());
    const future = JSON.stringify({
      ...env,
      saveSchemaVersion: SAVE_SCHEMA_VERSION + 1,
      state: { ...env.state, meta: { ...env.state.meta, version: SAVE_SCHEMA_VERSION + 1 } },
    });
    expect(() => loadGame(future)).toThrow(/newer than this build/);
  });

  it("rejects a save whose envelope version disagrees with meta.version", () => {
    const env = serializeSave(newState());
    const tampered = JSON.stringify({ ...env, saveSchemaVersion: env.saveSchemaVersion + 0.0, state: { ...env.state, meta: { ...env.state.meta, version: 999 } } });
    expect(() => loadGame(tampered)).toThrow(SaveError);
  });
});
