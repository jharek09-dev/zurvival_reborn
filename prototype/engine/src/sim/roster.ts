/**
 * The per-node zombie roster — one entry per BODY (M4 task T75 · design review 2026-09-12 step 2).
 *
 * Before T75 a node carried two *divorced* facts: `walkers: number` (how many) and
 * `zombieTypes: ContentId[]` (which distinct kinds are around). Nothing reconciled them, so:
 *
 *   - a node with `zombieTypes: ["zombie.riot"]` and `walkers: 3` fought **three** armored dead
 *     (5 hp behind armor 1 — about ten hours of melee and a ~92% bite risk each) — the type applied
 *     to every body;
 *   - killing the riot decremented `walkers` but never removed the *type*, so the next fight was
 *     another riot, forever, until the count hit zero;
 *   - a node with a type and `walkers: 0` (`node.rivermouth.marina`, a stalker) was never offered
 *     as a fight at all, because every gate reads `walkers > 0`.
 *
 * The roster is the single source of truth that reconciles them: a list of zombie content ids, one
 * per standing body. `walkers` becomes its length and `zombieTypes` its distinct non-walker set, so
 * **every existing consumer of those two fields keeps working unchanged as code** — telemetry sums
 * `walkers`, the encounter gates compare `minWalkers`/`maxWalkers`, `hasTag` and the screamer prose
 * read `zombieTypes`. (Their *output* does change, because repopulation now moves `walkers`: see the
 * shadowing note in `sim/repopulate.ts`.)
 *
 * {@link withRoster} writes all three coherently and is the only writer inside the sim layers;
 * `map/seedWorld.ts` builds the same three fields in its node literal, which its own comment flags.
 * The invariant `roster.length === walkers` is therefore a **convention, not an enforced one** — a
 * hand-built test state or a hand-edited save can still divorce the pair, and `loadGame` is a
 * pass-through that would not repair it. {@link rosterOf} is where that is caught: it reconciles a
 * stored roster whose length disagrees with `walkers`, treating `walkers` as authoritative, because
 * `walkers` is what every *gate* in the codebase branches on.
 *
 * **Save shape (ADR-0003).** `roster` is an *optional-tolerated-absent* field — the `desertPressure`
 * idiom T74 leaned on — so schema v10 holds and there is no new migration rung. A pre-T75 save has
 * no roster; {@link rosterOf} synthesizes one on read (the listed types first, most dangerous first,
 * padded with plain walkers up to `walkers`), which reproduces exactly the enemy that save already
 * fought. Two honest asymmetries, documented rather than papered over:
 *
 *   1. A pre-T75 node with a type and `walkers: 0` synthesizes an EMPTY roster, so it stays
 *      un-fightable — the behaviour that save has always had. (A fresh run seeds the roster at
 *      `seedWorld`, where the same node does get its body.)
 *   2. Those orphaned types are **dropped** the first time anything writes that node's roster, and
 *      the drop is permanent for the run. This matters because a pre-T75 kill decremented `walkers`
 *      but never removed the type — the exact bug T75 exists to fix — so on a converted save every
 *      node the player had already CLEARED still claims its special is standing there. Measured on a
 *      faithfully converted save: 17 of 34 typed nodes lost their listed type within 10 days. Most of
 *      that is stale residue being swept up, which is right; but a genuinely authored ambient type on
 *      a node the player never touched is indistinguishable from residue in a v10 save, and is swept
 *      up with it. The visible cost is flavour — `hasTag` behaviour, the screamer prose, the
 *      soundscape's collective-moan cue — never a fight, because those nodes have no bodies.
 *
 * Pure, deterministic, integer-only (ADR-0001). No RNG, no clock.
 */

import type { ContentId, NodeState } from "../state/types.js";
import { ZOMBIE_WALKER } from "./zombies.js";

/** Whether two readonly id arrays are element-wise equal (reference-stability check). */
const sameIds = (a: readonly ContentId[] | undefined, b: readonly ContentId[]): boolean =>
  a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Combat-danger order, mirroring `COMBAT_PRIORITY` in `combat/combat.ts` (kept here rather than
 * imported so `roster.ts` stays free of a combat cycle; `repopulate.test.ts` asserts the two agree).
 * Used only when synthesizing a legacy roster whose type list is longer than its `walkers` count: the
 * types that survive the truncation must be the ones `enemyForNode` would have chosen pre-T75, or a
 * loaded save would suddenly face a weaker enemy than the save said was there.
 */
export const ROSTER_COMBAT_PRIORITY: readonly ContentId[] = [
  "zombie.riot",
  "zombie.bloated",
  "zombie.fresh",
  "zombie.crawler",
];

/** Order a type list most-dangerous-first, keeping non-combat types in their listed order behind. */
function byDanger(types: readonly ContentId[]): readonly ContentId[] {
  const rank = (t: ContentId): number => {
    const i = ROSTER_COMBAT_PRIORITY.indexOf(t);
    return i < 0 ? ROSTER_COMBAT_PRIORITY.length : i;
  };
  return types.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((e) => e.t);
}

/** Build `count` bodies from a type list: the listed types first (most dangerous first), then walkers. */
function bodiesFrom(types: readonly ContentId[], count: number): readonly ContentId[] {
  if (count === 0) return EMPTY;
  const out: ContentId[] = [];
  for (const t of byDanger(types)) {
    if (out.length >= count) break;
    out.push(t);
  }
  while (out.length < count) out.push(ZOMBIE_WALKER);
  return out;
}

/**
 * The bodies standing at a node, one entry per body.
 *
 * Returns the stored roster when it is present AND agrees with `walkers`. Absent (a pre-T75 save, or a
 * hand-built test state) — or present but disagreeing, which only a hand-edited save or a writer that
 * bypassed {@link withRoster} can produce — it is rebuilt from the legacy pair: the listed types first,
 * most dangerous first, padded out with plain `zombie.walker` to `walkers`. `walkers` is authoritative
 * in that reconciliation because it is the field every gate in the codebase branches on, so a state
 * that says "no walkers here" must not be able to hide bodies a kill would then delete in bulk.
 *
 * Total: a NaN/negative/fractional `walkers` off a hand-edited save floors to a whole non-negative
 * count.
 */
export function rosterOf(node: NodeState): readonly ContentId[] {
  const count = Number.isFinite(node.walkers) ? Math.max(0, Math.trunc(node.walkers)) : 0;
  if (node.roster !== undefined && node.roster.length === count) return node.roster;
  if (node.roster !== undefined) return bodiesFrom(node.roster, count);
  return bodiesFrom(node.zombieTypes, count);
}
const EMPTY: readonly ContentId[] = [];

/**
 * The distinct *special* types a roster contains, in first-appearance order. Plain walkers are
 * excluded, which is what keeps `zombieTypes` meaning exactly what it always meant — "empty for a
 * plain node of walkers" — so `hasTag`, the screamer prose and the encounter gates are untouched.
 */
export function distinctTypes(roster: readonly ContentId[]): readonly ContentId[] {
  const seen = new Set<ContentId>();
  const out: ContentId[] = [];
  for (const t of roster) {
    if (t === ZOMBIE_WALKER || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Write a roster onto a node, keeping `walkers` and `zombieTypes` coherent with it. Every sim-layer
 * write of the three fields goes through here (`seedWorld` builds the identical triple for a fresh
 * node), so within the engine the invariant `roster.length === walkers` and
 * `zombieTypes === distinctTypes(roster)` holds. It is a convention, not an enforced one: a
 * hand-built state or a hand-edited save can still divorce them, which {@link rosterOf} reconciles
 * on read rather than trusting.
 *
 * Returns the **same node reference** when nothing moved, so an idle tick never churns state, the
 * save, or the FR-CORE-04 `changed` telemetry.
 */
export function withRoster(node: NodeState, roster: readonly ContentId[]): NodeState {
  // Non-string / empty entries (only a corrupt save or a bad hand-built state can supply them) are
  // DROPPED, which shrinks `walkers` to match rather than persisting a body with no identity.
  const bodies: readonly ContentId[] = roster.filter((t) => typeof t === "string" && t.length > 0);
  const types = distinctTypes(bodies);
  if (bodies.length === node.walkers && sameIds(node.roster, bodies) && sameIds(node.zombieTypes, types)) {
    return node;
  }
  return { ...node, roster: bodies, walkers: bodies.length, zombieTypes: types };
}

/** Append bodies to a node's roster (the encounter `seedWalkers` effect, and repopulation). */
export function addBodies(node: NodeState, types: readonly ContentId[]): NodeState {
  if (types.length === 0) return node;
  return withRoster(node, [...rosterOf(node), ...types]);
}

/**
 * Remove the body at `index` from a node's roster. Out-of-range is a no-op rather than a throw — a
 * kill resolved against a node that has already been emptied (an encounter effect, a concurrent
 * horde pass) must not crash a turn.
 */
export function removeBodyAt(node: NodeState, index: number): NodeState {
  const roster = rosterOf(node);
  if (index < 0 || index >= roster.length) return node;
  return withRoster(node, [...roster.slice(0, index), ...roster.slice(index + 1)]);
}

/** Build the seed roster for a node def's legacy `walkers` + `zombieTypes` pair (see `seedWorld`). */
export function seedRoster(walkers: number | undefined, types: readonly ContentId[] | undefined): readonly ContentId[] {
  const listed = types ?? [];
  const count = Number.isFinite(walkers) ? Math.max(0, Math.trunc(walkers as number)) : 0;
  // Every authored type gets a BODY, even when the node's authored `walkers` count is smaller than
  // the type list (the marina's lone stalker at `walkers: 0`) — the type/population divorce, fixed at
  // the source. The remainder of the authored count fills out with plain walkers.
  const out: ContentId[] = [...listed];
  while (out.length < count) out.push(ZOMBIE_WALKER);
  return out;
}
