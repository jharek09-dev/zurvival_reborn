/**
 * Deterministic PRNG core (M0 task T5 · DESIGN §9 · ADR-0001).
 *
 * Algorithm: `sfc32` (Small Fast Counter, 32-bit) seeded via `cyrb128`. Chosen because:
 * - Its whole state is four uint32s — plain-JSON integers that serialize inside GameState
 *   with zero special-casing (types.ts `RngStreamState`), so a save reproduces the exact
 *   next draw (T7). No BigInt, no floats-as-state, no host RNG.
 * - It is pure and self-contained: no `Math.random`, no `Date.now`, no global state — the
 *   two things ADR-0001 bans from `engine/`. Every draw is a value-in / value-out transform.
 * - Fast, tiny period-safe generator with good statistical quality for game randomness.
 *
 * This module is intentionally low-level and stream-agnostic. Named-stream plumbing over
 * GameState lives in `./streams.ts`.
 */

import type { RngStreamState } from "../state/types.js";

/** Force a JS number into an unsigned 32-bit integer (the only values we ever store). */
const u32 = (n: number): number => n >>> 0;

/**
 * cyrb128 — hash an arbitrary string to four well-mixed uint32 seeds. Used to turn
 * `seed + stream name` into an sfc32 starting state so each named stream is independent
 * yet fully determined by the run seed.
 */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [u32(h1), u32(h2), u32(h3), u32(h4)];
}

/**
 * Derive a fresh, deterministic stream state from the run seed and a stream name.
 * `seed + "::" + name` guarantees distinct streams (e.g. "loot" vs "encounter") never
 * share a sequence while both remain a pure function of the single run seed.
 */
export function seedStreamState(runSeed: string, streamName: string): RngStreamState {
  return { state: cyrb128(`${runSeed}::${streamName}`) };
}

/**
 * Advance one step. Returns the next float in [0, 1) and the successor stream state.
 * Pure: the input state is never mutated.
 */
export function stepFloat(stream: RngStreamState): {
  readonly value: number;
  readonly state: RngStreamState;
} {
  const s = stream.state;
  // A malformed/legacy stream (wrong arity) is a determinism hazard — fail loud.
  if (s.length !== 4) {
    throw new RangeError(`sfc32 stream state must hold exactly 4 uint32s, got ${s.length}`);
  }
  let a = s[0]! | 0;
  let b = s[1]! | 0;
  let c = s[2]! | 0;
  let d = s[3]! | 0;

  const t = ((a + b) | 0) + d | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;

  const value = u32(t) / 4294967296; // 2^32 → [0, 1)
  return { value, state: { state: [u32(a), u32(b), u32(c), u32(d)] } };
}
