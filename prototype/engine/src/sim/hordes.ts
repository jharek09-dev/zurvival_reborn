/**
 * Migrating hordes that re-path to noise, and the mass they carry (M2 task T26 · M4 task T76 ·
 * FR-SIM-07, FR-CBT-08 · GDD IV/IX).
 *
 * Above the node-local zombie machine (T25) sit **hordes** — moving masses with a size, position,
 * destination, speed, and awareness (`GameState.hordes`). Two original requirements:
 *
 *   - **Evaluate noise, re-path (FR-SIM-07).** Each tick a horde scans the nodes within its
 *     `awareness` hops; if one is loud enough (a logged gunshot clears the bar, ordinary footsteps do
 *     not), it becomes the new destination — the "fire a gun and pull the horde" lever, now at map
 *     scale. Otherwise the horde keeps migrating toward a wander destination.
 *   - **Routed, not out-traded (FR-CBT-08).** A horde is a thing you funnel, flee, or lead away with
 *     noise — never a stack of hit points. Nothing here lets the player *fight* it; the systemic
 *     handle is the same noise the player already understands.
 *
 * ## What T76 added: a horde that is *made of bodies*
 *
 * Through T75 a horde was a marker. `state.hordes` had no mechanical consumer anywhere: outside this
 * file it was read by one narration line in `coreActions.ts`, the pacing telemetry, the Living History
 * and the harness soundscape. A horde standing on the player's node spawned nothing, blocked nothing
 * and wounded nothing, so `FIRE_NOISE 75` vs `MELEE_NOISE 15` — the designed counterweight to the
 * firearm — re-pathed a mass that could not matter when it arrived.
 *
 * T76 gives the mass two mechanical halves, and they are deliberately different in kind:
 *
 *   1. **The collision is a consequence, not a fight** (`sim/overrun.ts`). When a horde stands where
 *      the player stands there is no fight choice at all: run, or go to ground, and either way a
 *      detection roll floored well above the ordinary stealth roll decides whether the mass lands
 *      blows on the way past. That module owns the player-facing half; this one owns the world.
 *   2. **A horde carries bodies and trades them with the ground it walks over** ({@link massAction}).
 *      Every node a horde *enters*, it either sheds one body onto that node (if the node is under the
 *      carrying capacity its region's density implies) or absorbs one off it (if the node is over).
 *      Nothing is created and nothing is destroyed — `sum(node.walkers) + sum(horde.size)` is
 *      invariant across a tick — so a horde is a **conveyor**, not a spawner: it drains crowded
 *      districts and seeds empty ones as it migrates. That is the mechanism by which the noise you
 *      make becomes bodies where you are standing, and it is bounded on both sides by construction
 *      (`nodeCeiling` is shared with T75's repopulation, so there is one definition of "how many
 *      bodies a node holds at this density" in the codebase) and by {@link HORDE_MIN_SIZE} /
 *      {@link HORDE_MAX_SIZE} on the horde itself.
 *
 * Two corrections T76 makes to its own task note, measured rather than argued — both recorded in
 * `docs/qa/QA_REVIEW_T76.md`:
 *
 *   - **`HORDE_HOURS_PER_STEP` stays 4.** The note asked for 4→2 "so a horde advances on a normal
 *     turn". T74's accumulator already delivered exactly that: measured on the shipped city, one horde
 *     takes **180 steps over 30 days of ordinary 2-hour turns** — one step every four hours, not zero.
 *     The stated reason for the retune no longer exists, and 2 would make a horde's 2h/node match the
 *     player's own `MOVE_COST` of 2, so a fleeing player could never gain ground on one — the opposite
 *     of "routed, funneled or fled" (FR-CBT-08). What was actually starving the system was the horde
 *     *count*: {@link seedStarterHordes} placed ONE mass on a 60-node city.
 *   - **On the full city the fun-gate symptom runs the other way.** "A horde on the move, and it is
 *     coming this way" printing turn after turn comes from the M3 fun-gate transcript, whose player
 *     walks a two-node itinerary next to the one seeded mass; on the shipped map, with a scripted
 *     player who moves, the same lead fired on **0 of 60 turns in four of five measured seeds**,
 *     because one horde is almost never within one hop of you. The honest complaint is that the horde
 *     was *invisible*, not that it cried wolf — and one seed did put it on the player's own node for
 *     **24 of that run's 72 turns, in stretches of up to four**, with, before T76, no consequence
 *     whatsoever. T76 must not trade one failure for the other, which is why the lead now carries
 *     distance and is bounded by the horde's own hearing range rather than firing on a destination at
 *     any distance (`coreActions.ts#worldLead`).
 *
 * ## Movement is now step-exact under any chunking
 *
 * Movement is a shortest walk over the region node graph, one node per {@link HORDE_HOURS_PER_STEP}
 * hours at speed 1, so a horde re-paths the turn a shot is fired and *arrives* over the following
 * turns — the DESIGN §5 "gunshot this turn, consequence next turn" timing, at the horde layer.
 * Before T76 a tick walked **at most to its current destination** and dropped the rest of its banked
 * steps, and the wander destination was picked once per *tick* rather than once per *arrival*: a
 * 240-hour one-shot advance therefore left the horde somewhere a chunked replay of the same 240 hours
 * never reached (measured: `node.ironworks.machine-shop` vs `node.ironworks.loading-canal`). Now the
 * walk is a loop of single steps, each re-picking a destination on arrival, so
 *
 *   > with nothing audible on the map, a horde's position after one N-hour advance equals its position
 *   > after any chunking of those N hours,
 *
 * which `test/hordes.test.ts` asserts directly — for a horde set that **shares a speed**, which is every
 * set the engine produces (`seedStarterHordes` stamps `HORDE_SPEED` on every mass and nothing else
 * writes the field). The interleave orders steps by step index, and that is hour order only while the
 * masses tick in lockstep; a hand-built set mixing speeds, or mixing `stepHours` carries, is not
 * chunk-exact and is not claimed to be.
 *
 * Two further **declared** chunking differences, both inherent to fast-forwarding rather than bugs in
 * the walk:
 *
 *   1. **The noise re-path** is evaluated once per tick against that tick's opening noise, and node
 *      noise is itself a function of the chunking (it decays per hour and is deposited per action), so
 *      a re-path can fire in a chunked replay that a one-shot advance never sees.
 *   2. **The mass traded** reads region density ONCE for the whole span — the value left by this
 *      tick's own drift, since the `regions` layer runs before `hordes` — because the drift that moves
 *      density runs in a pipeline stage a one-shot horde tick cannot interleave with. Positions stay
 *      exact; sizes and node counts do not, whenever density moves within the span. Measured with repopulation off and nothing audible over 240 hours: identical positions
 *      (transit-plaza / overlook-road / icu-tower both ways), sizes 23/29/37 one-shot against
 *      33/37/40 chunked, 112 map bodies against 91.
 *
 * `world.flags["hordes.disabled"]` switches the whole layer off — movement, mass and collision alike —
 * mirroring the director's `director.disabled` and T75's `repopulate.disabled`.
 *
 * Pure, deterministic, integer-only (ADR-0001). Only the wander destination consumes randomness, from
 * the named `horde` stream; the mass pass takes **no draw at all** (it sheds plain walkers and absorbs
 * off the tail of a roster), so it cannot shift any existing RNG sequence. Needs the transient `graph`;
 * inert without one.
 *
 * T76 is an **intentional behaviour change**: hordes now move differently and move bodies, so a seeded
 * run diverges from a pre-T76 build. Declared like T71/T72/T75, not smuggled.
 *
 * ## What the task note asked for and this pass did NOT do
 *
 *   - **Spawn, split and merge.** `state.hordes.length` is invariant for the life of a run: nothing
 *     creates a mass after `seedStarterHordes`, splits one, or merges two that have converged (they
 *     simply overlap, and {@link hordeMassAt} sums them). Parked as **PL-M5-17**.
 *   - **`Horde.types` remains dead state.** It is written once at seeding (`[ZOMBIE_WALKER]`) and read
 *     by nothing in the engine or the harness; the mass pass sheds plain walkers regardless of it and
 *     does not update it when it absorbs. Composition is deliberately out of scope here — a typed
 *     horde would want the shed to draw from it, which reintroduces an RNG draw into a pass that
 *     currently takes none. Parked with the spawn/split/merge work as PL-M5-17 rather than left as an
 *     undocumented field that looks live.
 *   - **"A horde on a high-density node grows."** The note's causal direction does not survive contact
 *     with the capacity model: a horde grows by absorbing from a node that is OVER its ceiling, and a
 *     *higher* density means a *higher* ceiling, so all else equal a dense district feeds a mass less
 *     readily than a stripped one. What grows a horde is an over-populated node, wherever it is.
 *     Recorded rather than quietly reworded.
 *   - **"A horde that sits on a node adds walkers to it per tick."** The trade fires on node ENTRY,
 *     not per tick of sitting. Entry is what carries the walk's chunk-exactness — a per-tick sit needs
 *     a second accumulator whose period does not divide the movement period, and it re-opens the
 *     oscillation the ceiling fixed point exists to close. A parked mass is inert against the ground
 *     it stands on; what it is not inert against is the player standing there.
 *   - **`HORDE_HOURS_PER_STEP` 4→2** — see above; the stated reason for the retune no longer exists.
 *   - **"CLOSES PL-M2-05 remainder."** It did not. PL-M2-05 is that slip and retreat ignore route
 *     conditions where `move` honours them, which `combat.ts#escapeTargets` did and which T77 owned;
 *     T76's flight reuses that same function and so inherited the hole rather than closing it.
 *     **T77 has since closed it** — `escapeTargets` now drops a blocked road while any other is
 *     passable and `escapeExtraCost` charges the worn ones — so the overrun's flight was fixed by
 *     that change without this file being touched, exactly as the shared-definition design intended.
 */

import type { ContentId, GameState, Horde, NodeId, NodeState, RegionId, RngState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { drawInt } from "../rng/streams.js";
import { ZOMBIE_WALKER } from "./zombies.js";
import { bankHours } from "./clocks.js";
import { rosterOf, addBodies, removeBodyAt } from "./roster.js";
import { nodeCeiling } from "./repopulate.js";

// --- tuning (bridge constants until a horde content set lands, as with the T17 loot tables) ------

/** The size a region with no authored `zombieDensity` seeds at. Kept from T26 for callers/tests. */
export const STARTER_HORDE_SIZE = 24;
export const HORDE_SPEED = 1;
/** How many hops out a horde can "hear". */
export const HORDE_AWARENESS = 2;
/**
 * Hours to advance one node at speed 1 — hordes are slow, and **deliberately half the player's pace**
 * (`MOVE_COST` is 2 hours a node), so a horde can be outrun on foot. See the header for why T76 did
 * not take the task note's 4→2 retune.
 */
export const HORDE_HOURS_PER_STEP = 4;
/** Minimum node noise that redirects a horde — a gunshot (T15 FIRE_NOISE = 75) clears it; a step (8) does not. */
export const REPATH_NOISE = 30;

/**
 * The band a horde's size lives in. A horde never sheds itself out of existence (it stops shedding at
 * the floor) and never balloons without bound (it stops absorbing at the ceiling).
 *
 * Two honest notes about which of these actually binds on shipped content, both measured:
 *
 *   - **{@link HORDE_MAX_SIZE} binds constantly.** All three seeded masses saturate at 40 within about
 *     a fortnight of off-screen time, after which they can only shed. It is a live bound, not a guard.
 *   - **{@link HORDE_MIN_SIZE} never binds, and cannot be reached by play.** Shedding requires a node
 *     that is *already contested* and under its ceiling, so walking a mass into a genuinely stripped
 *     district thins it by nothing at all. A horde therefore cannot presently be dispersed by any
 *     means, and the floor is a safety bound rather than a design one. Parked as **PL-M5-16** for
 *     T83, which owns the night-attack half of the same system.
 */
export const HORDE_MIN_SIZE = 8;
export const HORDE_MAX_SIZE = 40;

/**
 * A region whose **authored** density is below this seeds no horde at all. Set at 50 rather than the
 * 1 a "one per populated region" reading would give, and the difference is the whole early game:
 * on the shipped city it seeds Downtown (80), Mercy (85) and Ironworks (60) and leaves Rivermouth
 * (45) — **the region the player starts in** — Hillcrest (40) and the Terraces (35) horde-free. So a
 * mass is something you meet by pushing into the three richest, most dangerous districts, which is
 * where FR-CBT-08's "routed, funneled or fled" belongs, rather than something that finds you on your
 * own doorstep on day one.
 *
 * This is a measured deviation from the task note's "seed 4–6", and the counterfactual was run on the
 * FINISHED build rather than argued: same never-fight policy, same five seeds,
 * `HORDE_SEED_MIN_DENSITY` moved to 1 so all six regions seed.
 *
 *   - **At six:** overrun on **12–22 of 41–58 turns** — better than a third of every turn taken — for
 *     **12–28 wounds**, every seed dead on day 4 or 5.
 *   - **At three:** overrun on **0–8 of 40–60 turns** for **2–18 wounds**; two of the five seeds never
 *     met a mass at all in five days.
 *
 * Six does not make the horde deadlier so much as constant: it stops being an event you can be caught
 * by and becomes the loop. (Both counts pass the harness's "managing needs outlasts neglecting them"
 * invariant on the finished build — the six-horde build broke it only before the wound table and the
 * quiet-node bound below were corrected, so that is NOT offered as evidence here.)
 * See `docs/qa/QA_REVIEW_T76.md`.
 */
export const HORDE_SEED_MIN_DENSITY = 50;

/** `world.flags` key that switches the whole layer off (mirrors `director.disabled`/`repopulate.disabled`). */
export const HORDE_DISABLED_FLAG = "hordes.disabled";

/** Whether the horde layer is active for this run (default on). */
export function hordesEnabled(state: GameState): boolean {
  return state.world.flags[HORDE_DISABLED_FLAG] !== true;
}

/** Clamp to a 0–100 integer — the discipline every sim quantity keeps. */
const clampPct = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.trunc(n))) : 0);

/** A whole, finite, non-negative count — guards a hand-edited save's `NaN`/negative/fractional size. */
const wholeCount = (n: number | undefined): number =>
  Number.isFinite(n) ? Math.max(0, Math.trunc(n as number)) : 0;

/**
 * The size band a region's authored density maps to: {@link HORDE_MIN_SIZE} at density 0, rising
 * linearly to {@link HORDE_MAX_SIZE} at 100 — the 8–40 the task note asked for. Anchored on the
 * **authored** baseline rather than the live dial, so the seed reflects regional identity even though
 * T24's drift will have flattened the live density by day four (that half is T78's).
 *
 * On the shipped city this maps Mercy 85 → 35, Downtown 80 → 33, Ironworks 60 → 27, Rivermouth 45 →
 * 22, Hillcrest 40 → 20, the Terraces 35 → 19 — but only the first three are ever built, because the
 * other three fall below {@link HORDE_SEED_MIN_DENSITY}.
 */
export function hordeSizeFor(density: number): number {
  const d = clampPct(density);
  const span = HORDE_MAX_SIZE - HORDE_MIN_SIZE;
  return Math.max(HORDE_MIN_SIZE, Math.min(HORDE_MAX_SIZE, HORDE_MIN_SIZE + Math.trunc((d * span) / 100)));
}

// --- graph helpers (transient; Set/array use is fine in a pure fn, only GameState is plain-JSON) --

/** Node ids within `depth` hops of `from` (excludes `from`), reached by breadth-first walk. */
function nodesWithin(graph: RegionGraph, from: NodeId, depth: number): readonly NodeId[] {
  const visited = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  const out: NodeId[] = [];
  for (let d = 0; d < depth; d++) {
    const next: NodeId[] = [];
    for (const cur of frontier) {
      for (const nb of neighborsOf(graph, cur)) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        out.push(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return out;
}

/** Hop distance from `from` to every reachable node (`from` itself at 0). */
function hopsFrom(graph: RegionGraph, from: NodeId): { readonly [id: NodeId]: number } {
  const dist: Record<NodeId, number> = { [from]: 0 };
  let frontier: NodeId[] = [from];
  let d = 0;
  while (frontier.length > 0) {
    d += 1;
    const next: NodeId[] = [];
    for (const cur of frontier) {
      for (const nb of neighborsOf(graph, cur)) {
        if (dist[nb] !== undefined) continue;
        dist[nb] = d;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Shortest node path `from` -> `to` (inclusive), or null if unreachable. Ties broken by sorted id. */
function shortestPath(graph: RegionGraph, from: NodeId, to: NodeId): readonly NodeId[] | null {
  if (from === to) return [from];
  const visited = new Set<NodeId>([from]);
  const parent: Record<NodeId, NodeId> = {};
  const queue: NodeId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of [...neighborsOf(graph, cur)].sort()) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      parent[nb] = cur;
      if (nb === to) {
        const path: NodeId[] = [to];
        let p: NodeId = to;
        while (p !== from) {
          p = parent[p]!;
          path.push(p);
        }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return null;
}

/** The loudest node within a horde's hearing whose noise clears the re-path bar, or null. */
export function loudestAudible(state: GameState, graph: RegionGraph, from: NodeId, awareness: number): NodeId | null {
  const audible = nodesWithin(graph, from, Math.max(1, awareness)).filter(
    (id) => (state.nodes[id]?.noise ?? 0) >= REPATH_NOISE,
  );
  if (audible.length === 0) return null;
  audible.sort((a, b) => (state.nodes[b]!.noise - state.nodes[a]!.noise) || (a < b ? -1 : 1));
  return audible[0]!;
}

/** Pick a wander destination (any node but the current one) from the named horde stream. */
function pickWander(rng: RngState, seed: string, nodeIds: readonly NodeId[], pos: NodeId): { rng: RngState; value: NodeId } {
  const options = nodeIds.filter((id) => id !== pos);
  if (options.length === 0) return { rng, value: pos };
  const draw = drawInt(rng, seed, "horde", 0, options.length - 1);
  return { rng: draw.rng, value: options[draw.value]! };
}

// --- where the masses are ---------------------------------------------------------------------

/**
 * The horde standing on `nodeId` — the first by sorted id when (rarely) two have converged — or null.
 * The single definition of "a mass is here"; `sim/overrun.ts`, `sim/events.ts` and the Living History
 * all read it rather than open-coding the comparison.
 */
export function hordeAt(state: GameState, nodeId: NodeId): Horde | null {
  let found: Horde | null = null;
  for (const h of state.hordes) {
    if (h.pos !== nodeId) continue;
    if (found === null || h.id < found.id) found = h;
  }
  return found;
}

/** Total headcount standing on `nodeId` — every mass there, not just the first (they overlap rarely). */
export function hordeMassAt(state: GameState, nodeId: NodeId): number {
  return state.hordes.reduce((a, h) => (h.pos === nodeId ? a + wholeCount(h.size) : a), 0);
}

/**
 * Whether a mass is bearing down on the player **in a way that has consequences** — the single
 * definition of the collision, and the thing every dependent system must branch on rather than
 * open-coding `h.pos === player.location`.
 *
 * Three clauses, and each is load-bearing for a different consumer:
 *   1. the layer is enabled (`hordes.disabled` really does switch the whole system off);
 *   2. the player is not standing in their own claimed shelter (the base assault is T83's brief — see
 *      `sim/overrun.ts`);
 *   3. a mass is actually here.
 *
 * It lives in this module rather than in `sim/overrun.ts` so that `sim/events.ts` and `sim/history.ts`
 * can read it without importing the collision module, which would close an import cycle through
 * `events.ts`. `isOverrun` is this predicate plus the run-over check. The audit found both of those
 * consumers open-coding clause 3 alone, which meant a frozen mass still shut encounters out of a node
 * and a mass crossing your own base still wrote "a horde came down on you in the open" into the log
 * while nothing whatsoever happened.
 */
export function overrunsPlayer(state: GameState): boolean {
  if (!hordesEnabled(state)) return false;
  if (state.player.shelterId !== null && state.player.shelterId === state.player.location) return false;
  return hordeAt(state, state.player.location) !== null;
}

// --- seeding ---------------------------------------------------------------------------------

/**
 * The starter hordes for a fresh run: **one roaming mass per region** whose authored `zombieDensity`
 * clears {@link HORDE_SEED_MIN_DENSITY}, sized by that density ({@link hordeSizeFor}) and placed on the
 * node of that region *furthest by hop count from the start node* (ties by sorted id), so no mass
 * begins on top of the player.
 *
 * Before T76 this returned exactly ONE horde of 24 for the whole 60-node city, parked at the last node
 * by sorted id — which is most of why the horde layer read as inert in play: a single mass cannot be
 * within one hop of you often enough to matter. With {@link HORDE_SEED_MIN_DENSITY} at 50 the shipped
 * set seeds **three** — Mercy 35, Downtown 33, Ironworks 27, totalling 95 bodies of carried mass
 * against the city's 106 standing ones.
 *
 * Deterministic and RNG-free: placement is a breadth-first hop count and a sort, sizing is arithmetic
 * on the authored baseline. Every horde is composed of plain walkers — a mass is a mass, and the
 * distinct types are repopulation's business (T75) — which is also why the mass pass needs no draw.
 */
export function seedStarterHordes(graph: RegionGraph): readonly Horde[] {
  const ids = Object.keys(graph.nodes).sort();
  if (ids.length === 0) return [];
  const hops = hopsFrom(graph, graph.startNodeId);

  /** Region ids in a stable order, taken from the nodes so a region with no nodes is never seeded. */
  const regionIds = [...new Set(ids.map((id) => graph.nodes[id]!.regionId))].sort();
  const out: Horde[] = [];
  for (const regionId of regionIds) {
    const density = clampPct(graph.regions[regionId]?.baseline?.zombieDensity ?? 0);
    if (density < HORDE_SEED_MIN_DENSITY) continue;
    const candidates = ids.filter((id) => graph.nodes[id]!.regionId === regionId && id !== graph.startNodeId);
    if (candidates.length === 0) continue;
    // Furthest from the player's opening position, ties by sorted id. An unreachable node (impossible
    // on a graph `buildRegionGraph` accepted, which enforces connectivity) reads as distance -1 and so
    // is never preferred over a reachable one.
    let pos = candidates[0]!;
    for (const id of candidates) {
      if ((hops[id] ?? -1) > (hops[pos] ?? -1)) pos = id;
    }
    out.push({
      id: `horde.${regionId}`,
      size: hordeSizeFor(density),
      pos,
      dest: null,
      speed: HORDE_SPEED,
      awareness: HORDE_AWARENESS,
      types: [ZOMBIE_WALKER],
    });
  }
  // A content set that authors NO zombie density anywhere seeds no horde at all — the same rule T75's
  // repopulation keeps (`density === 0` ⇒ the region holds and never spawns). A region whose author
  // said "there are no dead here" does not get a mass of twenty-four invented for it, and before T76
  // it did: `seedStarterHordes` placed one unconditionally, which is why every two-node fixture in the
  // suite had a horde walking onto the player within a turn or two of the run starting.
  return out;
}

// --- the mass a horde trades with the ground ---------------------------------------------------

/** What one node-entry did to the mass: the (possibly new) node, and the horde's new size. */
export interface MassAction {
  readonly node: NodeState;
  readonly size: number;
}

/**
 * The body trade a horde makes with the node it has just walked onto, against that node's carrying
 * capacity ({@link nodeCeiling}, shared with T75's repopulation so the two systems agree on what a
 * district can hold):
 *
 *   - **contested and under** the ceiling ⇒ the horde **sheds** one walker onto the node
 *     (size −1, walkers +1), unless it is already down to {@link HORDE_MIN_SIZE};
 *   - **over** the ceiling ⇒ the horde **absorbs** the node's newest PLAIN WALKER (size +1,
 *     walkers −1), unless it is already at {@link HORDE_MAX_SIZE};
 *   - **quiet, at the ceiling, or over it with nothing but specials standing there** ⇒ nothing.
 *
 * ## Why a QUIET node is never seeded — the bound on PL-M5-10
 *
 * `nodeCeiling` bottoms out at **1**, not 0, because T75 uses it as a cap on a pass that only ever
 * adds. Used here as an equilibrium *target* it would mean a horde deposits a body on every empty node
 * it walks over, and `walkers > 0` gates the whole explore branch (`coreActions.ts`) and all encounter
 * selection (`events.ts`). Measured: with the plain under/over rule, thirty off-screen days took the
 * shipped city from 11 quiet nodes of 60 to **0 of 60** — the encounter system switched off
 * city-wide, the exact cost T75 flagged and bounded, blown open.
 *
 * So the shed requires a body to already be there, and **one tick can never turn a quiet node into a
 * contested one** — asserted directly in `hordes.test.ts`. Note the scope of that guarantee, because
 * it is easy to over-read and the audit did: it is a property of this function, **not** of the world.
 * Over thirty off-screen days the *net* effect on quiet-node count is seed-dependent — measured 11→10
 * and 12→11 on two seeds, 11→12 and 8→10 on two others — because absorbing bodies frees region
 * capacity and T75's repopulation then colonises nodes it would otherwise have skipped. T76 does not
 * shadow content directly; it can still shift how much T75 shadows.
 *
 * ## Why absorption takes a plain walker only
 *
 * The tail of a roster can be an authored special. Sweeping one up and later re-emitting it as a
 * `zombie.walker` (a horde is composed of walkers, and {@link Horde.types} is not updated by this
 * pass) would launder a Riot into a walker — which is precisely the type/population *incoherence*
 * T75 exists to remove. So the absorb looks for the last plain walker and does nothing when a node
 * holds only specials: the mass eats stragglers, never the thing that makes a node distinctive.
 *
 * ## Conservation
 *
 * The horde's size moves by the **actual** change in the node's reconciled body count, not by a
 * hard-coded 1. That matters because `withRoster` DROPS malformed roster entries (an empty string or
 * a non-string from a hand-edited save, or a `zombieTypes: ["", …]` typo in authored content, which
 * `seedRoster` copies through verbatim): crediting a flat ±1 there would delete bodies from the world.
 * Reading the delta makes `sum(rosterOf(node).length) + sum(horde.size)` invariant **by
 * construction**, including on those paths. The conserved quantity is the *reconciled* count
 * `rosterOf` returns — a hand-edited fractional `node.walkers` is floored on read, and the fraction is
 * lost by that reconciliation, not by this pass.
 *
 * No RNG.
 */
export function massAction(node: NodeState, size: number, density: number): MassAction {
  const ceiling = nodeCeiling(density);
  const bodies = rosterOf(node);
  const count = bodies.length;
  const mass = wholeCount(size);

  if (count > 0 && count < ceiling && mass > HORDE_MIN_SIZE) {
    const grown = addBodies(node, [ZOMBIE_WALKER]);
    return { node: grown, size: mass - (rosterOf(grown).length - count) };
  }
  if (count > ceiling && mass < HORDE_MAX_SIZE) {
    const idx = bodies.lastIndexOf(ZOMBIE_WALKER);
    if (idx < 0) return { node, size: mass }; // only specials stand here — the mass leaves them be
    const thinned = removeBodyAt(node, idx);
    // Clamped, because the delta can exceed 1 when `withRoster` drops malformed entries alongside the
    // body actually taken: an unclamped credit put a horde at 42 from a 39 in the audit's probe, which
    // would make {@link HORDE_MAX_SIZE}'s "never balloons without bound" false on exactly the input
    // the delta credit exists to handle. Clamping here means the *node* still loses only what it
    // loses; what is dropped is junk that was never a body.
    return { node: thinned, size: Math.min(HORDE_MAX_SIZE, mass + (count - rosterOf(thinned).length)) };
  }
  return { node, size: mass };
}

// --- the layer -------------------------------------------------------------------------------

/**
 * The body of the `hordes` world-sim layer (pipeline stage 9). For each horde, in `state.hordes`
 * order: re-path to a loud node within hearing (a gunshot redirect), then walk the hours the tick
 * banked one node at a time — re-picking a wander destination on each arrival — trading a body with
 * every node it enters ({@link massAction}).
 *
 * Writes the `hordes` and `nodes` slices and the `horde` RNG stream, and nothing else. Inert — the same
 * state reference — without a graph, with no hordes, on a zero-hour tick, or with
 * `world.flags["hordes.disabled"]` set. Those four early exits are the ONLY same-reference returns in
 * practice: any tick of an hour or more banks an hour against every horde's carry, so the carry write
 * alone makes the state new even when nothing visibly moved, and the `!moved` conjunct below is
 * reachable only for a horde of speed 0. Pure.
 */
export function tickHordes(state: GameState, hours: number, graph?: RegionGraph): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0 || graph === undefined || state.hordes.length === 0 || !hordesEnabled(state)) return state;

  const nodeIds = Object.keys(graph.nodes).sort();
  let rng = state.rng;
  let nodes: Record<NodeId, NodeState> | null = null;

  // One BFS per (from, to) pair per tick, not per step — a long fast-forward walks thousands of nodes
  // and would otherwise re-search the graph for each one. Transient, so it is free to be a Map.
  const pathMemo = new Map<string, readonly NodeId[] | null>();
  const pathTo = (from: NodeId, to: NodeId): readonly NodeId[] | null => {
    const key = `${from}|${to}`;
    if (!pathMemo.has(key)) pathMemo.set(key, shortestPath(graph, from, to));
    return pathMemo.get(key)!;
  };

  const shelterId = state.player.shelterId ?? null;

  /**
   * The LIVE density of the region a node belongs to (0 when either is unknown) — deliberately the
   * drifted dial, not the authored baseline `seedStarterHordes` sizes from: where a mass settles its
   * bodies is a fact about the district as it is now, where a mass STARTS is a fact about what the
   * author said the district is.
   */
  const densityAt = (id: NodeId): number => {
    const regionId: RegionId | undefined = (nodes !== null ? nodes[id] : state.nodes[id])?.regionId;
    return regionId === undefined ? 0 : clampPct(state.regions[regionId]?.zombieDensity ?? 0);
  };

  // 1. Evaluate noise: a loud node within hearing redirects the horde (FR-SIM-07). Once per tick per
  //    horde, against this tick's opening noise — the declared chunking difference (see the header).
  //    Then bank the tick's hours against each horde's carry (T74). Speed scales the hours banked, not
  //    the period — exact for the integer speeds the game produces (HORDE_SPEED is 1); a fractional
  //    speed from a future content set would truncate per tick rather than per span, so bank in tenths
  //    if one ever lands.
  const walk = state.hordes.map((horde) => {
    const heard = loudestAudible(state, graph, horde.pos, horde.awareness);
    return {
      pos: horde.pos,
      dest: heard !== null ? heard : horde.dest,
      size: wholeCount(horde.size),
      banked: bankHours(horde.stepHours, h * horde.speed, HORDE_HOURS_PER_STEP),
    };
  });

  // 2. Walk, ONE node at a time, INTERLEAVED across the hordes: every horde takes its first step
  //    before any takes its second. That ordering is not cosmetic — it is what a chunked replay does
  //    (each tick gives each horde at most one step, in `state.hordes` order), and since the hordes
  //    share the `nodes` slice and the `horde` RNG stream, letting one walk its whole span before the
  //    next started would change both what it found and the draw order. This is the same hazard T75
  //    hit with a single shared `repop` stream across regions, and it is why
  //
  //      > with nothing audible on the map, one N-hour advance lands exactly where any chunking of
  //      > those N hours lands
  //
  //    holds for a city of many masses and not just for one. Re-picking the destination on arrival
  //    (rather than once per tick, as before T76) and re-deriving the path from each node reached
  //    (rather than committing to one path for the whole tick) are the other two halves of it.
  const maxSteps = walk.reduce((a, w) => Math.max(a, w.banked.steps), 0);
  for (let step = 0; step < maxSteps; step += 1) {
    for (const w of walk) {
      if (w.banked.steps <= step) continue;

      if (w.dest === null || w.dest === w.pos) {
        const draw = pickWander(rng, state.meta.seed, nodeIds, w.pos);
        rng = draw.rng;
        w.dest = draw.value;
        // A one-node graph: nowhere to go, ever. Spend the step standing still, exactly as a
        // single-step tick would, rather than breaking out of a span the chunked path would replay.
        if (w.dest === w.pos) continue;
      }
      const path = pathTo(w.pos, w.dest);
      if (path === null || path.length <= 1) {
        // Unreachable (only a disconnected graph, which `buildRegionGraph` rejects). Give the
        // destination up and spend the step; the next one picks afresh — again, what a chunked replay
        // would do.
        w.dest = null;
        continue;
      }
      w.pos = path[1]!;
      if (w.pos === w.dest) w.dest = null;

      // The body trade happens at every node ENTERED, in the same order under any chunking of the
      // same hours — with one DECLARED exception, which the audit caught and this comment used to
      // deny: `densityAt` reads `state.regions` once and holds it for the whole span (the value this
      // tick's own stage-7 drift left, since `regions` runs before `hordes`), because that drift is in
      // a pipeline stage a one-shot horde tick cannot interleave with. So positions are chunk-exact; the *mass* traded
      // is not, whenever density moves within the span. Same class as T74's declared "a played hour ==
      // a fast-forwarded hour" limit and T75's saturation limit; recorded rather than papered over.
      // Measured (repopulation off, nothing audible, 240h): identical positions, sizes 23/29/37
      // one-shot against 33/37/40 chunked, 112 map bodies against 91.
      //
      // The player's own claimed shelter is skipped entirely. T75 hard-excluded it from
      // repopulation, and `repopulate.ts` is explicit that the base's night attacks are T83's to
      // author "not this pass's to sneak in" — a horde quietly leaving bodies inside the player's
      // base would be exactly that. A mass may still walk OVER the shelter; it just does not garrison
      // it. See `sim/overrun.ts` for the matching rule on the collision itself.
      const before = w.pos === shelterId ? undefined : (nodes !== null ? nodes[w.pos] : undefined) ?? state.nodes[w.pos];
      if (before !== undefined) {
        const acted = massAction(before, w.size, densityAt(w.pos));
        w.size = acted.size;
        if (acted.node !== before) {
          nodes ??= { ...state.nodes };
          nodes[w.pos] = acted.node;
        }
      }
    }
  }

  // 3. Nothing HAPPENED ⇒ the same horde object, so an idle tick never churns the state or the save.
  //    "Nothing happened" is `steps === 0` and an unmoved carry — deliberately not "the four fields
  //    came back equal". A horde that walked thirty nodes and wandered back to where it started has
  //    the same pos, dest and size as one that never left, but it must still write its `stepHours`,
  //    because a chunked replay of the same span wrote that field on the first tick that stepped. This
  //    is the last place the one-shot and chunked paths could differ, and the difference is visible:
  //    `stepHours: 0` present versus absent is a different save on the wire.
  let moved = false;
  const hordes: Horde[] = state.hordes.map((horde, i) => {
    const w = walk[i]!;
    if (w.banked.steps === 0 && w.banked.rest === (horde.stepHours ?? 0)) return horde;
    moved = true;
    return { ...horde, pos: w.pos, dest: w.dest, size: w.size, stepHours: w.banked.rest };
  });

  if (!moved && nodes === null && rng === state.rng) return state;
  const next: GameState = { ...state, hordes, rng };
  return nodes === null ? next : { ...next, nodes };
}
