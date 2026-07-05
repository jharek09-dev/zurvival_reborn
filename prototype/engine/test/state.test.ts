import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SAVE_SCHEMA_VERSION, createInitialState } from "../src/index.js";

/**
 * Recursively assert a value is plain JSON: object/array/string/finite number/
 * boolean/null. Rejects Map, Set, Date, class instances, functions, undefined,
 * NaN and ±Infinity — everything that would corrupt or lie through a save (T7)
 * or smuggle iteration-order/nondeterminism hazards into the core (ADR-0001).
 */
function assertPlainJson(value: unknown, path = "$"): void {
  if (value === null) return;
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertPlainJson(v, `${path}[${i}]`));
    return;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path}: non-plain object (${proto?.constructor?.name})`);
    }
    for (const [k, v] of Object.entries(value as object)) {
      if (v === undefined) throw new Error(`${path}.${k}: undefined`);
      assertPlainJson(v, `${path}.${k}`);
    }
    return;
  }
  throw new Error(`${path}: forbidden type ${t}`);
}

/** Every numeric leaf must be an integer (ADR-0001 numeric discipline). */
function assertIntegerLeaves(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`${path}: non-integer ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertIntegerLeaves(v, `${path}[${i}]`));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertIntegerLeaves(v, `${path}.${k}`);
  }
}

const newState = () =>
  createInitialState({ seed: "test-seed", createdAt: "2026-07-05T00:00:00Z" });

describe("GameState (T3 — single serializable state, TEC-04)", () => {
  it("is plain JSON throughout — no Map/Set/Date/undefined/class/non-finite", () => {
    assertPlainJson(newState());
  });

  it("survives a JSON round-trip losslessly", () => {
    const state = newState();
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });

  it("round-trips for arbitrary seeds and timestamps (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (seed, createdAt) => {
        const state = createInitialState({ seed, createdAt });
        expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
        expect(state.meta.seed).toBe(seed);
      }),
    );
  });

  it("uses integer math for all sim quantities", () => {
    assertIntegerLeaves(newState());
  });

  it("is versioned from the first format (feeds ADR-0003 / T7)", () => {
    const state = newState();
    expect(state.meta.version).toBe(SAVE_SCHEMA_VERSION);
    expect(SAVE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("starts at day 1, dawn, turn 0, with empty world containers", () => {
    const s = newState();
    expect(s.meta).toMatchObject({ day: 1, phase: "dawn", turn: 0 });
    expect(s.history).toStrictEqual([]);
    expect(s.queue).toStrictEqual([]);
    expect(s.hordes).toStrictEqual([]);
    expect(Object.keys(s.regions)).toHaveLength(0);
    expect(Object.keys(s.nodes)).toHaveLength(0);
  });
});
