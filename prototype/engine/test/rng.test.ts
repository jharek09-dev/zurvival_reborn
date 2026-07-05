import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { RngState } from "../src/index.js";
import { drawFloat, drawInt, drawPick } from "../src/index.js";

const empty = (): RngState => ({ streams: {} });

/** Draw `n` floats from one stream, threading state; returns the sequence. */
function sequence(runSeed: string, name: string, n: number): number[] {
  let rng = empty();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = drawFloat(rng, runSeed, name, );
    rng = r.rng;
    out.push(r.value);
  }
  return out;
}

describe("Seeded RNG — named streams (T5, DESIGN §9)", () => {
  it("is deterministic: same seed + same stream ⇒ identical sequence", () => {
    expect(sequence("run-A", "loot", 20)).toStrictEqual(sequence("run-A", "loot", 20));
  });

  it("different seeds diverge", () => {
    expect(sequence("run-A", "loot", 20)).not.toStrictEqual(sequence("run-B", "loot", 20));
  });

  it("named streams are independent — advancing one leaves others' first draw fixed", () => {
    // 'encounter' first draw must not depend on how many times 'loot' was drawn.
    let rng = empty();
    const encFirst = drawFloat(rng, "run-A", "encounter").value;
    for (let i = 0; i < 50; i++) rng = drawFloat(rng, "run-A", "loot").rng;
    const encAfterLootChurn = drawFloat(rng, "run-A", "encounter").value;
    expect(encAfterLootChurn).toBe(encFirst);
  });

  it("floats are in [0, 1)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        for (const v of sequence(seed, "s", 25)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
    );
  });

  it("drawInt stays within inclusive bounds and returns integers", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 0, max: 100 }),
        (seed, min, extra) => {
          const max = min + extra;
          let rng = empty();
          for (let i = 0; i < 15; i++) {
            const r = drawInt(rng, seed, "d", min, max);
            rng = r.rng;
            expect(Number.isInteger(r.value)).toBe(true);
            expect(r.value).toBeGreaterThanOrEqual(min);
            expect(r.value).toBeLessThanOrEqual(max);
          }
        },
      ),
    );
  });

  it("drawInt covers both endpoints of a small range over many draws", () => {
    let rng = empty();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const r = drawInt(rng, "coverage", "d", 0, 1);
      rng = r.rng;
      seen.add(r.value);
    }
    expect(seen).toStrictEqual(new Set([0, 1]));
  });

  it("drawPick chooses only from the array and is deterministic", () => {
    const items = ["a", "b", "c", "d"] as const;
    const pick = (rng: RngState) => drawPick(rng, "pick", "e", items).value;
    expect(pick(empty())).toBe(pick(empty()));
    expect(items).toContain(pick(empty()));
  });

  it("stream state serializes as plain-JSON integers and survives a round-trip", () => {
    const { rng } = drawFloat(empty(), "run-A", "loot");
    const restored: RngState = JSON.parse(JSON.stringify(rng));
    // Resuming from a serialized RngState yields the same next value.
    expect(drawFloat(restored, "run-A", "loot").value).toBe(
      drawFloat(rng, "run-A", "loot").value,
    );
    for (const [, s] of Object.entries(rng.streams)) {
      expect(s.state).toHaveLength(4);
      for (const n of s.state) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects an out-of-order integer range", () => {
    expect(() => drawInt(empty(), "s", "d", 5, 1)).toThrow(RangeError);
  });
});
