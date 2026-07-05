import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PIPELINE_STAGES, applyAction, createInitialState } from "../src/index.js";
import type { Action } from "../src/index.js";

const newState = () =>
  createInitialState({ seed: "test-seed", createdAt: "2026-07-05T00:00:00Z" });

const noop: Action = { type: "wait" };

describe("Turn pipeline shell (T4, DESIGN §5)", () => {
  it("runs all 14 stages in the fixed invariant order", () => {
    expect(PIPELINE_STAGES.map((s) => s.name)).toStrictEqual([
      "validate",
      "advanceTime",
      "resolvePlayerAction",
      "updatePlayer",
      "updateCompanions",
      "updateNode",
      "updateRegion",
      "updateWorld",
      "moveHordes",
      "moveGroups",
      "tickDirector",
      "resolveQueue",
      "evaluateStory",
      "generateScene",
    ]);
  });

  it("returns a state and a Scene", () => {
    const { state, scene } = applyAction(newState(), noop);
    expect(state).toBeDefined();
    expect(scene).toMatchObject({ narration: "", choices: [] });
  });

  it("is deterministic: same seed+state+action ⇒ byte-identical result", () => {
    const a = applyAction(newState(), noop);
    const b = applyAction(newState(), noop);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is deterministic for arbitrary seeds and action types (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (seed, type) => {
        const s = () => createInitialState({ seed, createdAt: "2026-07-05T00:00:00Z" });
        const action: Action = { type };
        expect(JSON.stringify(applyAction(s(), action))).toBe(
          JSON.stringify(applyAction(s(), action)),
        );
      }),
    );
  });

  it("M0 skeleton: an empty turn leaves state unchanged (all stages no-op)", () => {
    const before = newState();
    const { state: after } = applyAction(before, noop);
    expect(after).toStrictEqual(before);
  });

  it("Scene mirrors the state clock", () => {
    const before = newState();
    const { scene } = applyAction(before, noop);
    expect(scene).toMatchObject({
      turn: before.meta.turn,
      day: before.meta.day,
      hour: before.meta.hour,
      phase: before.meta.phase,
    });
  });

  it("does not mutate the input state", () => {
    const before = newState();
    const snapshot = JSON.stringify(before);
    applyAction(before, noop);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
