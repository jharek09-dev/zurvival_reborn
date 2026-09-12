/**
 * Zombie repopulation — density becomes bodies (M4 task T75 · design review 2026-09-12 step 2 ·
 * FR-SIM-03 / GDD IV/IX/XVI · closes PL-M4-10; ADVANCES, does not close, PL-M2-05 / PL-M4-26 —
 * those need T76's horde collision and T78's drift anchoring respectively).
 *
 * **The hole this closes.** Outside the v1->v2 save-migration rung, `NodeState.walkers` was written
 * in exactly three places — `seedWorld` (init), a kill in `combat.ts`, and the `seedWalkers` encounter
 * effect (four authored uses). Nothing in the director, the drift model, the hordes or the difficulty
 * dials ever added one back, so apart from those four scripted beats the player stripped a finite city
 * of 105 bodies and the map never refilled. Consequently
 * `region.zombieDensity` — the dial the whole escalation story runs on, the one the director nudges,
 * the one T24's relaxation moves, the one `directorAggression` scales — was read only by the
 * director, the drift model and pacing telemetry. Pin it at 100 and the only observable difference
 * was one line of narration. Density had no body.
 *
 * **The fix.** A repopulation pass inside the `regions` layer (pipeline stage 7), running after
 * T24's drift so it reads this tick's density. Per region, per banked period, one *attempt*: a roll
 * against the region's density decides whether a body arrives at all, a weighted pick decides where,
 * and a density-gated table decides what. Off-screen too — `advanceWorld` runs the same layer.
 *
 * **What this does NOT deliver, measured.** A district refills only while its density is high enough
 * for {@link regionCapacity} to exceed what is already standing. At the equilibrium densities T24's
 * drift model currently produces (measured over 30 off-screen days on shipped content: downtown
 * 80->21, mercy 85->17, ironworks 60->18, rivermouth 45->25, hillcrest 40->2, the-terraces 35->0) the
 * shipped city is ALREADY above its carrying capacity, so off-screen refill stops after ~3 days: 106
 * -> 125 bodies by day 3, then 126 and flat for 27 more (the pre-T75 baseline sits at 105 forever).
 * What survives is the refill that follows a **cull** — strip Downtown and it comes back 0 -> 12 over
 * 7 days. So T75 is a refill mechanic, not yet an escalation one, and the difficulty modes barely
 * separate: measured at day 30, Story 127 / Survivor 128 / Hardcore 128 / Nightmare 128 — a ONE-body
 * spread across the whole range, because the only dial that reaches this pass is `directorAggression`,
 * and drift pushes density down faster than the director's clamped +1 can push it up.
 *
 * The mechanism is not the weak part; its input is. Pinning density each tick over the same 30 days
 * gives 106 / 149 / 240 / 300 bodies at density 20 / 50 / 80 / 100 — and **20 is what T24's
 * equilibrium actually produces**. So **T78 — narrowing `playerDistressed` and anchoring drift on the
 * authored baseline — is a PREREQUISITE for T75's value, not a follow-up.** Until it lands, the
 * Riot/Bloated rows of the spawn table (gated at density 70) are effectively dormant too: measured +0
 * riots and +0 bloated over 30 days, against +14 walkers. Running the T57 exit-gate playtest against
 * T75 alone would be testing a system that switches itself off on day three. A difficulty dial for
 * repopulation is deliberately NOT added here: it would be a dead knob for exactly the same reason
 * (the T56 / T74 dead-knob lesson), and it belongs with T78's fix.
 *
 * **What it costs elsewhere.** `walkers` gates the whole explore branch (`coreActions.ts`) and all
 * encounter selection (`events.ts` refuses to fire on a node with a body), so repopulation shrinks the
 * quiet-node surface those systems need: measured 17/60 nodes at seed -> 12/60 after 30 off-screen
 * days (seed-dependent: 10-13 across six seeds), with **2 to 6** of the 9 node-gated authored encounter
 * bindings shadowed at day 30 depending on seed. That range understates the cost at the top end:
 * `node.the-terraces.garden-center` carries three of the nine on its own (the before/during/after
 * evolution triple, which is also where three of the four authored `seedWalkers` effects live), so one
 * body there shadows the whole chain. Nothing becomes unreachable — a contested node
 * always offers the fight, and the node the player is standing on can never gain a body under them, so
 * clearing where you stand keeps it clear while you are there — but an authored beat at a repopulated
 * node now costs a fight first. Measured on a scripted never-fight run over the same seed: 12 of 25
 * turns faced a fight prompt, against 9 of 25 pre-T75.
 *
 * **Bounded by construction (GDD XVI rule: the director biases, it never forces).** Three bounds,
 * each of which can only ever *deny* a spawn:
 *
 *   1. a **per-node ceiling** from density ({@link nodeCeiling}) — a low-density district spreads its
 *      dead across nodes instead of stacking an unwinnable pile on one;
 *   2. a **region-wide capacity** from density × node count ({@link regionCapacity}) — the district's
 *      carrying capacity, re-read every tick, so a region whose density drifts down stops refilling
 *      (it never culls: bodies already standing are never removed here);
 *   3. two **hard exclusions** — never the node the player is standing on, and never their claimed
 *      shelter. Materializing a fight under the player's feet mid-turn is forcing, not biasing; the
 *      shelter's night attacks are T83's to author, not this pass's to sneak in.
 *
 * **The clock (T74).** Attempts are banked hours, not `trunc(hours / N)`: `repopHours` carries the
 * remainder, so for a fixed density twelve 2-hour turns spawn exactly what one 24-hour fast-forward
 * does. It follows the uniform T74 idle rule — a region with **nothing to do** HOLDS its accumulator:
 * it neither accrues nor resets, so an idle world does not churn state, the save, or the FR-CORE-04
 * `changed` telemetry, and the pressure a capped region banked is released the moment the player culls
 * it. "Nothing to do" means all four ways a region can be unable to act: density 0, no nodes, already
 * at capacity, and — the one an audit caught — **no legal node left to spawn into**, which happens
 * whenever every node that is not the player's or their shelter has reached its ceiling while the
 * region is still under capacity. Reachable on shipped content, but it needs both exclusions inside one
 * district: the-terraces at density 39 (11 nodes, ceiling 2, capacity 21) settles at 21 with the player
 * elsewhere, and at **19** with the player standing in the district AND their shelter there too.
 * Missing that case rewrote the region slice on every tick, forever, in a world that could never
 * change.
 *
 * Attempts left over when capacity binds mid-tick are dropped, not re-banked — the same rule
 * `stepToward` keeps, and the reason a 30-day fast-forward cannot bank a flood.
 *
 * Disable the whole pass with `world.flags["repopulate.disabled"]`, exactly as the director is disabled
 * — so the T57 exit-gate playtest can A/B the keystone without a rebuild.
 *
 * **Determinism.** Every draw comes from a **new, named `repop:<regionId>` stream — one per region**.
 * Streams are keyed by name and advance independently (`rng/streams.ts`), so this cannot shift the
 * `loot`, `region`, `horde`, `combat`, `stealth` or `encounter` sequences — the PL-M4-54 /
 * byte-identity-loot-hazard lesson applied at the design level rather than discovered by an audit. The
 * stream is per-region, not global, for a second reason an audit caught on the first draft: on one
 * shared stream the regions INTERLEAVE their draws, and the interleaving order depends on how the hours
 * were chunked, so twelve 2-hour turns and one 24-hour advance consumed different slices of it
 * (measured on that draft: 121 vs 116 bodies) — and adding a region to the content set shifted every
 * other region's spawns. Per region, the pass is chunking-exact **while the region can act**: for a
 * fixed density, `12x2h`, `24x1h`, `8x3h` and `1x24h` all produce a byte-identical `nodes` map and an
 * identical `rng`. A region that SATURATES mid-span is the declared exception — the one-shot path banks
 * the whole span's remainder before its attempt loop begins, while the chunked path HOLDS its
 * accumulator the moment the region becomes unable to act. The two carries then differ by at most
 * `REPOP_HOURS_PER_STEP - 1` hours, i.e. at most one later attempt, and the difference is invisible
 * until the player culls the district (measured: 86h in one advance vs 43 x 2h, both settle at 12
 * bodies, then diverge to 7 vs 6 after a cull). Bounding it at one attempt is deliberate: re-banking
 * the unused hours instead would let a 200,000-hour advance carry an unbounded remainder into the save.
 *
 * Regions are visited in sorted id order and candidate nodes in sorted id order, so nothing depends on
 * object key order.
 *
 * The *game* is still not chunking-exact across a long fast-forward, and that is T74's declared limit 2,
 * not this pass: drift relaxes toward a MOVING target, so the two paths feed different density histories
 * into {@link regionCapacity} (measured over 30 days: 126 bodies on both paths, but distributed
 * differently — downtown 30 vs 33, the-terraces 15 vs 13).
 *
 * **Not surfaced in the Living History.** `recordHistory` (T31) diffs weather, nightfall, hordes,
 * routes, combat, people, shelter and infection; nothing reads `walkers`, `roster` or `zombieTypes`, so
 * a 30-day fast-forward logs exactly the same 811 beats before and after T75. The player sees the
 * refill at the node (the fight prompt, the narration) but the run's own history never mentions it.
 * Parked rather than bolted on here: a new history beat kind touches the history schema, the telemetry
 * and the harness screens, and it belongs with T78's escalation work, where a district filling up is
 * finally worth a line.
 *
 * T75 is an **intentional behaviour change**: the world now refills, so a seeded run diverges from a
 * pre-T75 build. Declared like T71/T72, not smuggled.
 *
 * Pure, deterministic, integer-only (ADR-0001). No clock, no I/O.
 */

import type { ContentId, GameState, NodeId, NodeState, RegionState } from "../state/types.js";
import { drawInt } from "../rng/streams.js";
import { bankHours, wholeHours } from "./clocks.js";
import { rosterOf, addBodies } from "./roster.js";
import {
  ZOMBIE_WALKER,
  ZOMBIE_FRESH,
  ZOMBIE_CRAWLER,
  ZOMBIE_SCREAMER,
  ZOMBIE_STALKER,
  ZOMBIE_BLOATED,
  ZOMBIE_RIOT,
} from "./zombies.js";

// --- tuning ---------------------------------------------------------------------------------

/**
 * The RNG stream prefix every repopulation draw comes from. New ⇒ no existing sequence shifts. Keyed
 * **per region** ({@link repopStream}) so a region's sequence is independent both of how the hours were
 * chunked and of how many other regions the content set has.
 */
export const REPOP_STREAM = "repop";

/** The named stream one region draws from. */
export const repopStream = (regionId: string): string => `${REPOP_STREAM}:${regionId}`;

/** `world.flags` key that switches the whole pass off (mirrors the director's `director.disabled`). */
export const REPOP_DISABLED_FLAG = "repopulate.disabled";

/** Whether repopulation is active for this run (default on). */
export function repopulateEnabled(state: GameState): boolean {
  return state.world.flags[REPOP_DISABLED_FLAG] !== true;
}

/** Hours between spawn *attempts* in a region. Banked, so any chunking of the same hours agrees. */
export const REPOP_HOURS_PER_STEP = 6;

/** A node holds `1 + density/PER` bodies, hard-capped. Density 0 ⇒ 1; 80 ⇒ 5; 100 ⇒ 6. */
export const REPOP_NODE_CEILING_PER = 20;
export const REPOP_NODE_CEILING_MAX = 6;

/** A region's carrying capacity is `nodeCount * density / PER`. Downtown (11 nodes @ 80) ⇒ 44. */
export const REPOP_CAPACITY_PER = 20;

/** Where the dead drift: noise pulls them, and a picked-over node reads as recent human traffic. */
export const REPOP_NOISE_PER_WEIGHT = 10;
export const REPOP_SEARCH_PER_WEIGHT = 20;
/** A node the player worked within this many days carries an extra draw of weight. */
export const REPOP_RECENT_DAYS = 2;
export const REPOP_RECENT_BIAS = 3;

/** Clamp to a 0–100 integer — the discipline every sim quantity keeps. */
const clampPct = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.trunc(n))) : 0);

/**
 * The density-gated spawn table. A quiet district only ever produces plain walkers; the specials
 * unlock as density climbs, and stay rare relative to walkers at every level — a high-density region
 * seeds Riot/Bloated/Fresh *among* its walkers rather than becoming a boss rush. Weights are drawn
 * against the sum of the ELIGIBLE rows only, so the walker share falls as the table opens up
 * (60/60 = 100% below density 30 → 60/100 = 60% at density 70+).
 */
export interface RepopTypeRow {
  readonly type: ContentId;
  /** Region density at or above which this type can appear at all. */
  readonly minDensity: number;
  /** Relative weight among the eligible rows. */
  readonly weight: number;
}
export const REPOP_TYPE_TABLE: readonly RepopTypeRow[] = [
  { type: ZOMBIE_WALKER, minDensity: 0, weight: 60 },
  { type: ZOMBIE_FRESH, minDensity: 30, weight: 12 },
  { type: ZOMBIE_CRAWLER, minDensity: 30, weight: 10 },
  { type: ZOMBIE_SCREAMER, minDensity: 50, weight: 6 },
  { type: ZOMBIE_STALKER, minDensity: 50, weight: 6 },
  { type: ZOMBIE_BLOATED, minDensity: 70, weight: 4 },
  { type: ZOMBIE_RIOT, minDensity: 70, weight: 2 },
];

/** The rows a region's density unlocks, in table order (walker always first, so never empty). */
export function typeTableFor(density: number): readonly RepopTypeRow[] {
  const d = clampPct(density);
  return REPOP_TYPE_TABLE.filter((r) => d >= r.minDensity);
}

/** How many bodies one node may hold at this region density. Only ever denies a spawn; never culls. */
export function nodeCeiling(density: number): number {
  return Math.min(REPOP_NODE_CEILING_MAX, 1 + Math.trunc(clampPct(density) / REPOP_NODE_CEILING_PER));
}

/** A region's carrying capacity in bodies, from its density and its node count. */
export function regionCapacity(density: number, nodeCount: number): number {
  const n = Math.max(0, Math.trunc(nodeCount));
  return Math.trunc((n * clampPct(density)) / REPOP_CAPACITY_PER);
}

/**
 * How strongly a node draws the dead: a base of 1, plus its ambient noise, plus how picked-over it is
 * (a stripped node is where the living have been), plus a bonus for a visit in the last
 * {@link REPOP_RECENT_DAYS} days. Always ≥ 1, so every eligible node keeps a chance — bias, not
 * determinism.
 */
export function spawnWeight(node: NodeState, day: number): number {
  const noise = Number.isFinite(node.noise) ? Math.max(0, Math.trunc(node.noise)) : 0;
  const searched = Number.isFinite(node.searchPct) ? Math.max(0, Math.trunc(node.searchPct)) : 0;
  const recent =
    node.lastVisit !== null && Number.isFinite(node.lastVisit) && day - node.lastVisit <= REPOP_RECENT_DAYS
      ? REPOP_RECENT_BIAS
      : 0;
  return 1 + Math.trunc(noise / REPOP_NOISE_PER_WEIGHT) + Math.trunc(searched / REPOP_SEARCH_PER_WEIGHT) + recent;
}

/** One weighted pick over `items`, drawing a single int from the repop stream. Items must be non-empty. */
function pickWeighted<T>(
  rng: GameState["rng"],
  seed: string,
  stream: string,
  items: readonly T[],
  weightOf: (item: T) => number,
): { readonly rng: GameState["rng"]; readonly value: T } {
  const weights = items.map((i) => Math.max(0, Math.trunc(weightOf(i))));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // Every weight floored to 0 — fall back to a uniform pick so the draw count stays constant.
    const d = drawInt(rng, seed, stream, 0, items.length - 1);
    return { rng: d.rng, value: items[d.value]! };
  }
  const d = drawInt(rng, seed, stream, 0, total - 1);
  let acc = 0;
  for (let i = 0; i < items.length; i += 1) {
    acc += weights[i]!;
    if (d.value < acc) return { rng: d.rng, value: items[i]! };
  }
  return { rng: d.rng, value: items[items.length - 1]! };
}

/** Node ids of a region, sorted — the stable iteration order every draw depends on. */
function nodeIdsOf(state: GameState, regionId: string): readonly NodeId[] {
  return Object.keys(state.nodes)
    .filter((id) => state.nodes[id]?.regionId === regionId)
    .sort();
}

/**
 * The repopulation half of the `regions` layer. Runs after T24's drift (so it reads this tick's
 * density) and before the T17 loot contest. Returns the same state reference when nothing moved and
 * no draw was taken. Inert on a zero-hour tick.
 */
export function repopulateRegions(state: GameState, hours: number): GameState {
  // `wholeHours`, not `Math.max(0, Math.trunc(hours))` — the latter lets a NaN through (`NaN !== 0`),
  // which would then let a banked carry spend a step on a "zero-hour" tick.
  const h = wholeHours(hours);
  if (h === 0 || !repopulateEnabled(state)) return state;

  let rng = state.rng;
  let nodes: Record<NodeId, NodeState> | null = null;
  let regions: Record<string, RegionState> | null = null;
  const day = Number.isFinite(state.meta.day) ? Math.trunc(state.meta.day) : 0;
  const shelterId = state.player.shelterId ?? null;
  const playerAt = state.player.location;

  // Regions drive the loop, so a node whose `regionId` names no live region is never repopulated — a
  // deliberate silent gap: a content set that referenced a missing region would have failed the graph
  // build long before this, and inventing a region here would be the pass manufacturing world state.
  for (const regionId of Object.keys(state.regions).sort()) {
    const region = state.regions[regionId]!;
    const density = clampPct(region.zombieDensity);
    const ids = nodeIdsOf(state, regionId);
    const read = (id: NodeId): NodeState => (nodes !== null ? nodes[id] ?? state.nodes[id]! : state.nodes[id]!);

    const capacity = regionCapacity(density, ids.length);
    const ceiling = nodeCeiling(density);
    let occupancy = ids.reduce((a, id) => a + rosterOf(read(id)).length, 0);
    /** The nodes a body could legally arrive at right now. Recomputed after each spawn. */
    const eligibleNow = (): readonly NodeId[] =>
      ids.filter((id) => id !== playerAt && id !== shelterId && rosterOf(read(id)).length < ceiling);

    // The T74 idle rule: a region with nothing to do HOLDS its accumulator — it neither accrues nor
    // resets. All four ways it can have nothing to do are checked here, INCLUDING an empty eligible
    // set: a region under capacity whose every legal node is at its ceiling is just as unable to act as
    // one that is full, and leaving it out of this test churned the region slice and the RNG on every
    // tick forever. The banked hours stay banked, and release the moment the player culls the district.
    if (density === 0 || ids.length === 0 || occupancy >= capacity || eligibleNow().length === 0) {
      const held = wholeHours(region.repopHours);
      if (held !== (region.repopHours ?? 0)) {
        // Only ever rewrites to scrub a NaN/negative/fractional carry off a hand-edited save.
        regions ??= { ...state.regions };
        regions[regionId] = { ...region, repopHours: held };
      }
      continue;
    }

    const stream = repopStream(regionId);
    const { steps, rest } = bankHours(region.repopHours, h, REPOP_HOURS_PER_STEP);
    if (rest !== (region.repopHours ?? 0)) {
      regions ??= { ...state.regions };
      regions[regionId] = { ...(regions[regionId] ?? region), repopHours: rest };
    }
    if (steps === 0) continue;

    const table = typeTableFor(density);
    for (let attempt = 0; attempt < steps; attempt += 1) {
      // Capacity is re-checked every attempt; leftover attempts are dropped, not re-banked, so a long
      // fast-forward can never bank a flood against a district that filled up halfway through it.
      if (occupancy >= capacity) break;
      const eligible = eligibleNow();
      if (eligible.length === 0) break; // nowhere legal left this tick — stop rolling

      // Density IS the spawn probability: a 35-density suburb produces a body on ~1 attempt in 3, a
      // 85-density hospital on ~5 in 6. The roll is taken whether or not it succeeds, so the ROLL count
      // per attempt is fixed; a successful attempt then takes two further draws, for where and what.
      const roll = drawInt(rng, state.meta.seed, stream, 0, 99);
      rng = roll.rng;
      if (roll.value >= density) continue;

      const where = pickWeighted(rng, state.meta.seed, stream, eligible, (id) => spawnWeight(read(id), day));
      rng = where.rng;
      const what = pickWeighted(rng, state.meta.seed, stream, table, (r) => r.weight);
      rng = what.rng;

      const target = read(where.value);
      const grown = addBodies(target, [what.value.type]);
      if (grown === target) continue; // defensive: no body added ⇒ no occupancy change
      nodes ??= { ...state.nodes };
      nodes[where.value] = grown;
      occupancy += 1;
    }
  }

  if (nodes === null && regions === null && rng === state.rng) return state;
  const next: GameState = { ...state, rng };
  return {
    ...next,
    ...(nodes !== null ? { nodes } : {}),
    ...(regions !== null ? { regions } : {}),
  };
}
