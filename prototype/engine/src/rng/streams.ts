/**
 * Named-stream RNG facade over GameState (M0 task T5 · DESIGN §9).
 *
 * All randomness in the core flows through here. Every draw is pure: it takes the current
 * `RngState`, the run seed, and a stream name, and returns a *new* `RngState` alongside the
 * value. Streams are seeded lazily on first use (from `seed + name`) and thereafter advance
 * from their serialized state, so:
 *   - the same seed + same sequence of named draws reproduces a run byte-for-byte (T7/T9);
 *   - independent streams ("loot", "encounter", "combat"…) never interfere, so adding a draw
 *     to one system can't shift another system's sequence.
 *
 * Nothing here reads a clock or a global RNG (ADR-0001). Callers thread the returned
 * `RngState` back into GameState.
 */

import type { RngState, RngStreamState } from "../state/types.js";
import { seedStreamState, stepFloat } from "./prng.js";

/** Existing stream state, or a freshly seeded one — deterministic either way. */
function streamFor(rng: RngState, runSeed: string, name: string): RngStreamState {
  return rng.streams[name] ?? seedStreamState(runSeed, name);
}

/** Replace one stream's state, returning a new RngState (input untouched). */
function withStream(rng: RngState, name: string, state: RngStreamState): RngState {
  return { streams: { ...rng.streams, [name]: state } };
}

/** A draw's result: the advanced RngState plus the produced value. */
export interface Draw<T> {
  readonly rng: RngState;
  readonly value: T;
}

/** Draw a float in [0, 1) from the named stream. */
export function drawFloat(rng: RngState, runSeed: string, name: string): Draw<number> {
  const { value, state } = stepFloat(streamFor(rng, runSeed, name));
  return { rng: withStream(rng, name, state), value };
}

/**
 * Draw an integer in the inclusive range [minInclusive, maxInclusive] from the named
 * stream. Integer-only result (ADR-0001 numeric discipline).
 */
export function drawInt(
  rng: RngState,
  runSeed: string,
  name: string,
  minInclusive: number,
  maxInclusive: number,
): Draw<number> {
  if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
    throw new RangeError("drawInt bounds must be integers");
  }
  if (maxInclusive < minInclusive) {
    throw new RangeError(`drawInt: max (${maxInclusive}) < min (${minInclusive})`);
  }
  const span = maxInclusive - minInclusive + 1;
  const { value: f, state } = stepFloat(streamFor(rng, runSeed, name));
  const value = minInclusive + Math.floor(f * span); // f ∈ [0,1) ⇒ result ∈ [min, max]
  return { rng: withStream(rng, name, state), value };
}

/**
 * Uniformly pick one element from a non-empty array via the named stream.
 * Returns the advanced RngState and the chosen element.
 */
export function drawPick<T>(
  rng: RngState,
  runSeed: string,
  name: string,
  items: readonly T[],
): Draw<T> {
  if (items.length === 0) throw new RangeError("drawPick: empty array");
  const { rng: rng2, value: idx } = drawInt(rng, runSeed, name, 0, items.length - 1);
  return { rng: rng2, value: items[idx]! };
}

/** One weighted candidate for {@link drawWeighted}. A non-positive weight can never be chosen. */
export interface Weighted<T> {
  readonly value: T;
  /** Integer weight (ADR-0001); relative to the other entries' weights, not a probability. */
  readonly weight: number;
}

/**
 * Pick one element in proportion to integer weights, via the named stream (M5 task T81).
 *
 * The rarity primitive `drawPick` could not express. A loot table of equals makes a pistol exactly as
 * likely as a bandage and a firefighter's axe exactly as likely as a chair leg, which is the "rough
 * tiers from common junk to rare finds" GDD Part X asks for and the build did not have.
 *
 * **It costs exactly one `drawInt` step, the same as {@link drawPick}** — one draw over the total
 * weight, then a walk down the (caller-ordered) entries. So swapping a uniform pick for a weighted one
 * advances the stream identically; only the chosen value differs. Entries with weight ≤ 0 are skipped
 * rather than treated as 1, so "never placed" is expressible. Throws on an empty set or a set whose
 * weights sum to nothing, which is a caller bug, not a draw outcome.
 */
export function drawWeighted<T>(
  rng: RngState,
  runSeed: string,
  name: string,
  entries: readonly Weighted<T>[],
): Draw<T> {
  let total = 0;
  for (const e of entries) total += Math.max(0, Math.trunc(e.weight));
  if (total <= 0) throw new RangeError("drawWeighted: no entry carries a positive weight");
  const { rng: rng2, value: roll } = drawInt(rng, runSeed, name, 0, total - 1);
  let seen = 0;
  for (const e of entries) {
    seen += Math.max(0, Math.trunc(e.weight));
    if (roll < seen) return { rng: rng2, value: e.value };
  }
  // Unreachable: `roll < total` and the weights sum to `total`. Kept total rather than asserted.
  return { rng: rng2, value: entries[entries.length - 1]!.value };
}
