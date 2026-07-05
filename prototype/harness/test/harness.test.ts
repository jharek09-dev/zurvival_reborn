import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { runEmptyTurn } from "../src/index.js";

const opts = { seed: "harness-test", createdAt: "2026-07-05T06:00:00.000Z" };

describe("Terminal harness — empty turn (T9, M0 exit)", () => {
  it("resolves one turn and produces a Scene", () => {
    const r = runEmptyTurn(opts);
    expect(r.scene).toBeDefined();
    // M0 skeleton: the turn is empty — every gameplay stage is a no-op.
    expect(r.scene.narration).toBe("");
    expect(r.scene.choices).toStrictEqual([]);
    expect(r.next.meta.day).toBe(1);
  });

  it("is deterministic: same seed+state+action ⇒ byte-identical result (M0 DoD)", () => {
    expect(runEmptyTurn(opts).deterministic).toBe(true);
    // And two independent harness runs on the same seed render identically.
    expect(runEmptyTurn(opts).lines).toStrictEqual(runEmptyTurn(opts).lines);
  });

  it("round-trips the post-turn state through save/load losslessly (NFR-SAVE-01)", () => {
    expect(runEmptyTurn(opts).saveRoundTrips).toBe(true);
  });

  it("holds both M0 exit proofs for arbitrary seeds (property)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const r = runEmptyTurn({ seed, createdAt: opts.createdAt });
        expect(r.deterministic).toBe(true);
        expect(r.saveRoundTrips).toBe(true);
      }),
    );
  });

  it("renders a non-empty terminal view a human can read", () => {
    const text = runEmptyTurn(opts).lines.join("\n");
    expect(text).toContain("Zurvival Reborn");
    expect(text).toContain("turn 0");
    expect(text).toMatch(/determinism.*✓/);
    expect(text).toMatch(/save round-trip.*✓/);
  });
});
