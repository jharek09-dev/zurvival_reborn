/**
 * The stealth read — what the dead actually notice (M4 task T77 · FR-CBT-05 · PL-M2-02).
 *
 * Until this task the game had three systems that all described the same thing and never spoke to
 * each other:
 *
 *   - **Noise** (T14) deposited sound into node memory.
 *   - **Arousal** (T25/T46) turned that sound, plus the player's presence, the scent of a bleeding
 *     wound, a stalker's night-hunt and a Fresh's speed, into a five-rung `NodeState.zombieState`
 *     ladder — consumed by exactly three narration strings and the harness soundscape.
 *   - **Detection** (T15/T27/T28) rolled `detectChance(noise, phase, weather)` — three world inputs,
 *     and nothing at all about the dead standing in front of you or the state of the body carrying
 *     the pack.
 *
 * So a node that had *turned and started toward you* was the same stealth roll as one that had never
 * noticed you, a player bleeding from three untreated wounds slipped as cleanly as an unhurt one, and
 * a pack stuffed to the brim walked home exactly as quietly as an empty one. This module is the
 * closing link: it composes the T15 world roll with the things the fiction has been promising since
 * T25, so **noise → arousal → detection** is one causal chain.
 *
 * ### The terms
 *
 * Every term is expressed in **percentage points**, the unit `phaseConcealment` and
 * `weatherDetectionDelta` already use, and the sum is converted once and clamped to
 * {@link DETECT_MAX}. Nothing is ever certain: a night slip past a chasing node with a heavy pack and
 * an open wound is very likely to be spotted, never guaranteed.
 *
 *   | term        | source                               | range        |
 *   |-------------|--------------------------------------|--------------|
 *   | base        | `detectChance(noise, phase, weather)` | 0 … 0.9      |
 *   | arousal     | `NodeState.zombieState`              | +0 … +0.30   |
 *   | alerted     | `CombatState.alerted` on a retreat    | +0 … +0.15   |
 *   | scent       | `woundBurden` — a bleeding trail      | +0 … +0.10   |
 *   | pack        | weight over `PACK_HEAVY`              | +0 … +0.10   |
 *   | extra       | caller's own (the Crawler's grasp)    | caller's     |
 *
 * ### Two honest notes about the terms, because the brief's arithmetic was loose
 *
 * The task note asked for `woundBurden/10` and `max(0, (inventoryWeight − PACK_HEAVY)/10)` without
 * saying in what unit. Read as *probability* the first is absurd (a burden of 40 would add +4.0 to a
 * number that clamps at 0.9) and the second is inert (a brim-full pack would add +0.01). Both are
 * implemented here as **percentage points on the same 0–10 band**, which is the reading that makes
 * them comparable to each other and to the phase/weather terms they sit beside.
 *
 * That is one of **three** deliberate departures from the numbers the brief gave, all of them here and
 * all of them stated at the constant they affect: this one, {@link AROUSAL_DETECT} (5/15/30 for the
 * brief's 10/25/40, corrected on measurement), and {@link ALERTED_DETECT} (15 for the brief's 20).
 *
 * ### One thing is charged twice, on purpose
 *
 * An untreated wound reaches the roll by **two** routes: it raises the node's arousal rung
 * (`scentDraw` in `sim/zombies.ts` — worth up to a whole rung, so up to +15 points here), and it adds
 * its own {@link scentDetect} term (up to +10). That is double counting and it is meant: blood both
 * *rouses* the nest and makes you *trackable*, which are different facts, and the T25 fiction has
 * claimed the first since before the second existed. What matters is that the total is bounded and
 * known — at worst a bite moves one rung and adds ten points — rather than discovered later by
 * someone wondering why wounds hurt so much. Both halves were live in every measurement quoted below.
 *
 * Pure, deterministic, dependency-free (ADR-0001). No RNG, no clock: the caller draws, this decides
 * what it is drawing against.
 */

import type { CharacterState, GameState, InventoryEntry, ZombieState } from "../state/types.js";
import { woundBurden } from "./wounds.js";
import { inventoryWeight, PACK_HEAVY } from "./inventory.js";

// --- tuning -----------------------------------------------------------------------------------

/**
 * Points a node's arousal rung adds to the stealth roll — the T25 ladder's first mechanical consumer.
 *
 * **These are not the numbers the task note asked for, and the correction is measured.** The note
 * specified +0.10 / +0.25 / +0.40 for wandering / investigating / chasing. Those are sensible numbers
 * for a world where `chasing` is a *spike*. It is not one. With the `PLAYER_HERE_BONUS` collapse fixed
 * and the shipped city played out — 176 escapes sampled across 16 runs — the mean arousal term at an
 * escape was **38.0 out of a maximum of 40**: `chasing` is still the state **85%** of escapes happen
 * in, because the player is almost always bleeding (wounds never self-heal and bandages are scarce),
 * and a bleeding player standing on an occupied node clears `CHASE_AT` on presence + scent alone. At
 * +0.40 that is not a spike, it is the floor, and it put the mean whole-roll detection at **0.716**
 * with **15% of rolls saturated at the ceiling** — i.e. the roll stopped varying, which is the exact
 * failure this task exists to repair, arrived at from the other side.
 *
 * At 5 / 15 / 30 the rung is still decisively the largest single term and the ordering the note wanted
 * is intact; what changes is that the common case lands mid-band instead of pinned at the top, so the
 * *difference* between a calm node and a roused one is something a player can feel and act on.
 *
 * `feeding` sits *below* `investigating` on purpose even though the arousal ladder ranks them the
 * same: a node with its heads down in a corpse is awake but occupied, which is exactly what the
 * soundscape has always said about it ("the wet sounds of feeding — occupied, for now"). Giving it
 * `investigating`'s weight would make walking past a feeding nest as dangerous as walking past one
 * that has turned toward you, and would quietly delete the one moment of mercy the ladder offers.
 */
export const AROUSAL_DETECT: { readonly [s in ZombieState]: number } = {
  hibernating: 0,
  dormant: 0,
  wandering: 5,
  investigating: 15,
  chasing: 30,
  feeding: 5,
};

/**
 * Points added when breaking off a fight the dead are already alerted to. A retreat is not a slip:
 * they have hold of the situation and you are moving away from it.
 *
 * **Stated plainly, because it is easy to over-claim:** `CombatState.alerted` is presently true in
 * every reachable live fight — `beginCombat` seeds it false, but the same turn's strike or shot sets
 * it before any escape can be offered, and there is no other way into combat. So the observable
 * effect of this term today is a flat penalty on *retreat* over *slip*, which is a real and intended
 * distinction; what it is **not** is proof that a dormant flag has become a live two-valued input.
 * It becomes that the moment something can start a fight the dead have not noticed — an ambush, or
 * T82's grab — and this is the condition that will read it when that arrives. Until then the honest
 * summary is: the flag is finally *read* in a condition, and it is still always true. (PL-M5-22.)
 */
export const ALERTED_DETECT = 15;

/**
 * Scent: points per 10 points of untreated {@link woundBurden}, capped. The fiction already exists in
 * `sim/zombies.ts` — `SCENT_BONUS` has roused nodes off a bleeding player since T25 — and this is the
 * same trail reaching the stealth roll. A single untreated laceration (30) is +3 points; a body
 * carrying 100 or more of open wound is at the +10 cap.
 */
export const SCENT_DETECT_PER_BURDEN = 10;
export const SCENT_DETECT_MAX = 10;

/**
 * Pack weight: one point per unit carried over {@link PACK_HEAVY}, capped — a laden pack shifts,
 * clatters and slows you. `CARRY_CAPACITY` is 40 and `PACK_HEAVY` is 30, so a brim-full pack is
 * exactly the +10 cap and anything under three-quarters full is free. This is the first time
 * `inventoryWeight` has touched anything but the inventory cap.
 */
export const PACK_DETECT_PER_UNIT = 1;
export const PACK_DETECT_MAX = 10;

/** Nothing is ever certain — the ceiling `detectChance` has always kept, applied to the whole read. */
export const DETECT_MAX = 0.9;

// --- the terms, as pure functions of plain numbers ---------------------------------------------

/**
 * Clamp a point term to `[0, max]`, integer-only and **total**.
 *
 * The ordinary clamp already handles the infinities correctly and needs no help: `min(max, Infinity)`
 * is `max` and `max(0, -Infinity)` is `0`, which is the right reading of each — `JSON.parse` turns an
 * out-of-range literal into `Infinity`, so a hand-edited save really can carry `severity: 1e999`, and
 * an infinitely bleeding body must read as maximally alarming rather than as unhurt. Only `NaN` needs
 * the guard, because it poisons `min`/`max` alike; it carries no direction, so it reads as 0.
 *
 * (An explicit `POSITIVE_INFINITY` branch was written here first and then removed: mutation testing
 * showed deleting it changed nothing, because it only restated what `Math.min` already did.)
 */
const clampPoints = (n: number, max: number): number =>
  Number.isNaN(n) ? 0 : Math.max(0, Math.min(max, Math.trunc(n)));

/** Points a node's arousal rung contributes. An unknown/absent state reads as calm (0). */
export function arousalDetect(zombieState: ZombieState | undefined): number {
  return zombieState === undefined ? 0 : (AROUSAL_DETECT[zombieState] ?? 0);
}

/** Points a bleeding body contributes: `burden / 10`, floored at 0 and capped at {@link SCENT_DETECT_MAX}. */
export function scentDetect(burden: number): number {
  return clampPoints(Math.max(0, burden) / SCENT_DETECT_PER_BURDEN, SCENT_DETECT_MAX);
}

/** Points a laden pack contributes: one per unit over {@link PACK_HEAVY}, capped. Free below that. */
export function packDetect(weight: number): number {
  return clampPoints((Math.max(0, weight) - PACK_HEAVY) * PACK_DETECT_PER_UNIT, PACK_DETECT_MAX);
}

// --- the composed read --------------------------------------------------------------------------

/** Every term of one stealth roll, kept separate so a client can say *why* and a test can pin each. */
export interface StealthRead {
  /** The T15/T27/T28 world roll: node noise, phase light, weather. Already a probability. */
  readonly base: number;
  /** Points from the node's arousal rung. */
  readonly arousal: number;
  /** Points from breaking off an alerted fight. */
  readonly alerted: number;
  /** Points from an untreated, bleeding body. */
  readonly scent: number;
  /** Points from a pack loaded past {@link PACK_HEAVY}. */
  readonly pack: number;
  /** Probability the caller supplied on its own account (the Crawler's grasp bonus). */
  readonly extra: number;
  /** The whole roll, clamped to `[0, DETECT_MAX]`. */
  readonly total: number;
}

/** What the read needs beyond the state. The node is always the one the player is standing on — an
 * escape is always *out of here* — so there is no node parameter to get wrong. */
export interface StealthOpts {
  /** True when breaking off a fight the dead are alerted to (a retreat, not a slip). */
  readonly alerted?: boolean;
  /** Extra probability the caller owns — the Crawler's `GRASP_ESCAPE_BONUS`. Added before the clamp. */
  readonly extra?: number;
}

/**
 * Compose one stealth roll from plain parts. Split out from {@link stealthRead} so the arithmetic can
 * be pinned by a test without building a `GameState`, and so the base term stays the caller's to
 * supply (`detectChance` lives with the combat layer that owns the enemy table).
 */
export function composeStealth(
  base: number,
  parts: { readonly zombieState?: ZombieState; readonly burden?: number; readonly weight?: number; readonly alerted?: boolean; readonly extra?: number },
): StealthRead {
  const arousal = arousalDetect(parts.zombieState);
  const alerted = parts.alerted === true ? ALERTED_DETECT : 0;
  const scent = scentDetect(parts.burden ?? 0);
  const pack = packDetect(parts.weight ?? 0);
  const extra = Number.isFinite(parts.extra ?? 0) ? (parts.extra ?? 0) : 0;
  const safeBase = Number.isFinite(base) ? base : 0;
  const total = Math.max(0, Math.min(DETECT_MAX, safeBase + (arousal + alerted + scent + pack) / 100 + extra));
  return { base: safeBase, arousal, alerted, scent, pack, extra, total };
}

/**
 * The full read for the player's current situation. `base` is passed in rather than computed here so
 * this module stays free of the combat layer (which owns `detectChance` and the enemy table) — there
 * is no import cycle to close and no second copy of the world roll to keep in step.
 */
export function stealthRead(state: GameState, base: number, opts: StealthOpts = {}): StealthRead {
  const node = state.nodes[state.player.location];
  return composeStealth(base, {
    ...(node !== undefined ? { zombieState: node.zombieState } : {}),
    burden: woundBurden(state.player.condition as CharacterState),
    weight: inventoryWeight(state.player.inventory as readonly InventoryEntry[]),
    ...(opts.alerted === true ? { alerted: true } : {}),
    ...(opts.extra !== undefined ? { extra: opts.extra } : {}),
  });
}

/** Just the number — the form the escape rolls draw against. */
export function stealthDetectChance(state: GameState, base: number, opts: StealthOpts = {}): number {
  return stealthRead(state, base, opts).total;
}

/**
 * One short clause naming the loudest thing working against the player right now, or null when the
 * read is simply the world's. Exported so a client can *signpost* the chain rather than leaving the
 * player to infer it from wound rates — the "signpost, don't retune" discipline the design review
 * asks for. Never lists a term the read did not actually charge for.
 */
export function stealthTell(read: StealthRead): string | null {
  const terms: readonly { readonly points: number; readonly tell: string }[] = [
    { points: read.arousal, tell: "they have already turned toward you" },
    { points: read.alerted, tell: "this one has hold of you" },
    { points: read.pack, tell: "your pack shifts and clatters" },
    { points: read.scent, tell: "you are leaving blood behind you" },
  ];
  let worst: { points: number; tell: string } | null = null;
  for (const t of terms) {
    if (t.points > 0 && (worst === null || t.points > worst.points)) worst = { ...t };
  }
  return worst === null ? null : worst.tell;
}
