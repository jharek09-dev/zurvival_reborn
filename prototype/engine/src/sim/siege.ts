/**
 * The night attack — a siege at the claimed base, and the way a base is lost (M5 task T83 ·
 * FR-SHL-06 / FR-SHL-10 · GDD XI · design review 2026-09-12 step 9).
 *
 * Until now `Player.shelterId` had **exactly one writer in the whole engine** (`claimShelter`) and no
 * clearer at all, so GDD XI's *"it can be lost — overrun, burned, or abandoned"* and *"home must feel
 * safe enough to fear losing"* had no mechanism behind them. Worse, the base was the one place immune
 * to every pressure M5 has spent five tasks building: repopulation hard-excludes it (T75), a mass will
 * not garrison it (T76), and `overrunsPlayer` exempted it outright (PL-M5-18).
 *
 * This module removes **one** of those three — the `overrunsPlayer` exemption, which is the one
 * PL-M5-18 named — and adds a pressure that none of the three protects against. The other two are
 * untouched and still unconditional: `repopulate.ts` will not spawn a body at the base and
 * `hordes.ts#massAction` will not shed one there, neither of them reading `barricades`. So a mass
 * standing ON the base is counted by {@link siegePressure} at hop 0 while still leaving nothing behind
 * it — declared here rather than quietly fixed. What the module does give the run is its **first loss
 * that is not a death**.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE BRIEF'S TRIGGER IS NOT THE ONE THAT SHIPPED — measured before a line was written
 * ---------------------------------------------------------------------------------------------
 * The task brief specified *"accumulated `NodeState.noise` at the shelter draws a horde during the
 * sleep window"*. That quantity cannot carry a threshold. Measured over **46 bedtimes in 60
 * homesteading bot runs — `npx tsx measure/t83.ts --noise` ON THE PRE-T83 TREE**, where a bot that
 * settles wherever it stands still can (post-T83 the `claimable` gate means that bot claims 2 of 60
 * times and reaches no bedtime at all, so this table cannot be re-derived on the shipped tree; it is a
 * measurement of the world the brief was written against):
 *
 *   base noise at bedtime   min 0 · median 10 · max 10      — against a 0–100 field
 *   bedtimes at or above 20                   0 (0.0%)
 *
 * Four independent reasons, each sufficient on its own:
 *   1. the base is **the one node a settled player never searches** — claiming it *requires*
 *      `searchPct >= 100`, and `search` (25) is the only loud verb in the core loop;
 *   2. every verb you perform at home — claim, fortify, deposit, withdraw, rest, sleep — is silent
 *      (`noiseOf` returns `NOISE_REST` 0 for all of them);
 *   3. arrival deposits `NOISE_MOVE` 8 and decay is `NOISE_DECAY_PER_HOUR` 5, so it is gone in two hours;
 *   4. a fortified base **muffles up to `SHELTER_NOISE_MUFFLE_MAX` 20 per tick** — twice the entire
 *      observed range of the thing the brief wanted to read.
 *
 * And the chain the brief assumes is already broken one layer down: **`REPATH_NOISE` is 30**, so a
 * claimed base can never redirect a horde toward itself whatever it does. A threshold on base noise is
 * a coin with one side — build it at 8 and it fires every night, at 20 and it never fires at all.
 * This is the same class of finding as T82's unreachable "no discovered escape target" conjunct and
 * T81's "content with no path to the player", three tasks running: **the brief's causal sentence was
 * describing a chain that the engine does not contain.**
 *
 * What is reachable at the same instant, measured on the same runs (same command, same tree):
 *
 *   carried horde mass within 2 hops of home   0 · 0 · 53  (mean 3.2)   ← real range, mostly zero
 *   home region zombieDensity                 40 · 47 · 49  (mean 46.4) ← the standing dead
 *   loudest node within ONE hop of home        0 · 10 · 95  (mean 12.5) ← where a run's sound lives
 *   walkers on home + its neighbours            0 ·  0 ·  2  (mean 0.2)
 *
 * So {@link siegePressure} reads all three of the first three, at the scale each actually has. The
 * mass term dominates because it is the only one that spikes; density is the floor that makes a bad
 * district bad; and **the noise term is the neighbourhood, not the doorstep** — a settled player's
 * sound lives on the blocks they work, never on the step they sleep on.
 *
 * **The bill is real, and it is thin — measured, not asserted.** A loud forager and a quiet one, 60
 * runs each (`measure/t83.ts --bill`, either tree — it measures pre-existing behaviour): a mass sits
 * within one hop of home on **16.0%** of the loud
 * run's days against **6.7%** of the quiet one's, and the loud base's neighbourhood carries 9.5 points
 * of noise against 2.2. The pull exists because a *night* search deposits 25 + 12 = 37, which clears
 * `REPATH_NOISE` where nothing at the base ever can. 2.4x is the honest size of "noise is the Survival
 * Triangle's bill for a run of loud, fast play" — a real gradient, not a dominant one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SHAPE
 * ---------------------------------------------------------------------------------------------
 *   - **One roll per night, banked in hours.** Night is phase-hours 21–02, six of them. A turn
 *     contributes the night hours its *span* covers (NOT the phase it resolves in — a 9-hour `sleep`
 *     from 21:00 lands at 06:00 in phase "dawn", so a resolved-phase gate would never fire on the one
 *     night the player actually sleeps through: a T74-class truncation trap). Those hours bank in
 *     `world.siegeHours`, and every completed {@link SIEGE_HOURS_PER_NIGHT} is one check — so a played
 *     night and a fast-forwarded one produce the same number of sieges, and a 240-hour advance resolves
 *     ten nights rather than one.
 *   - **Pressure vs defence.** {@link siegePressure} is what came; {@link siegeDefence} is the wall,
 *     the watch, the party and your own body standing in the doorway. The overflow is what the night
 *     costs you.
 *   - **Losses come out of the things a base IS**: `barricades` first, then the cache via
 *     {@link depleteStash} (FR-SHL-03's own depletion hook, and the T40 cold-raid prose template),
 *     then the people — a resident can die, through `killCompanion`, only its second caller ever.
 *   - **The breach.** When the wall is already down and the attack still overflows, `shelterId` is
 *     **cleared** — the first time in the project's history that field has gone back to null outside
 *     `createInitialState` — the cache scatters, and the dead are left standing in the rooms.
 *   - **`overrunsPlayer`'s exemption narrows to `barricades > 0`.** The wall is *literally* what keeps
 *     the horde out; a breached base is the open street, which is what PL-M5-18 was holding.
 *
 * **Determinism.** Every draw comes from a **new, named `siege` stream**. Streams are seeded lazily by
 * name (`rng/streams.ts`), so this cannot shift the `loot`, `region`, `horde`, `combat`, `stealth`,
 * `party` or `encounter` sequences — a run that never claims a base is byte-identical, which is most
 * of the existing suite (the T82 rule: genuinely new draws go on a new named stream).
 *
 * **No save rung.** `world.siegeHours` is optional and reads 0 when absent — the T74 accumulator
 * precedent listed in `World` itself — and every other field written here already existed.
 * `SAVE_SCHEMA_VERSION` stays **10**.
 *
 * Pure, deterministic, integer-only (ADR-0001). No clock; RNG threaded through `GameState.rng`.
 */

import type { ActorId, GameState, NodeId, Survivor } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { drawFloat } from "../rng/streams.js";
import { bankHours, wholeHours as whole } from "./clocks.js";
import { depleteStash, stashUnits } from "./stash.js";
import { isCompanion, killCompanion } from "./companions.js";
import { JOB_FLAG_PREFIX, jobIdOf } from "./jobs.js";
import { inflictNamedWound } from "./wounds.js";

/** The RNG stream every draw in this module comes from — new in T83, so no existing sequence moves. */
export const SIEGE_STREAM = "siege";

/**
 * The night window, in clock hours: 21, 22, 23, 00, 01, 02 — exactly the six hours `phaseOf` calls
 * "night". Six hours banked is one night resolved.
 */
export const SIEGE_HOURS_PER_NIGHT = 6;

/**
 * Hops out from the base that a mass counts as pressing on it.
 *
 * It is **not** a reach radius, and the first draft of this comment claimed it was ("matches
 * `HORDE_AWARENESS` — what can hear you can reach you"), which is wrong twice over: `HORDE_AWARENESS`
 * is the radius at which a horde hears *noise to re-path toward*, and `HORDE_HOURS_PER_STEP` is 4, so
 * in a six-hour night a mass covers exactly **one** hop. A mass two hops out is not arriving tonight.
 *
 * It is 2 because the sweep says so, not because of a symmetry. Swept by rebuild on 60 seeker runs:
 * at **1** the breach is nearly unreachable (1 of 11 landed nights, median pressure 24); at **2**,
 * 5 of 14 and median 30; at **3** it is a **dead knob** — 5 of 15 and median 32, because the third
 * ring almost never holds a mass the second does not. What the second ring buys is anticipation: the
 * mass that will be at the door tomorrow is already making tonight worse.
 */
export const SIEGE_HEARING = 2;

/**
 * Pressure terms. Each is a *scaled* read of a quantity whose real range was measured before these
 * numbers were chosen (see the header table) — the T79 lesson that a term outside its quantity's
 * actual range is an inert knob wearing a number.
 */
/**
 * Bodies of carried horde mass within {@link SIEGE_HEARING} per point of pressure. The spike term: a
 * mass is what turns an ordinary night into the one you lose the house on. Swept by rebuild.
 */
export const SIEGE_MASS_DIVISOR = 2;
/** The standing dead: `zombieDensity` (measured 40–49 at a shipped base) divided by this. ⇒ 6–8 points. */
export const SIEGE_DENSITY_DIVISOR = 6;
/** The bill for loud play: the loudest node within ONE hop of home (measured 0–95) divided by this. ⇒ 0–19 points. */
export const SIEGE_NOISE_DIVISOR = 5;
/**
 * Pressure is an integer 0–100 like every other sim quantity — and it does a second job: it is also the
 * denominator of the night's own coin in {@link resolveOneNight}, where `roll * SIEGE_PRESSURE_MAX >=
 * pressure` means a pressure of 30 is a 30% chance the night comes at all. The two uses are the same
 * scale on purpose, so "how bad tonight is" and "how likely tonight is" cannot drift apart.
 */
export const SIEGE_PRESSURE_MAX = 100;

/** A night below this much pressure is a quiet one — nothing comes, no draw is taken. */
export const SIEGE_MIN_PRESSURE = 12;

/**
 * Defence terms — the people and the building. **`barricades` is deliberately NOT one of them.**
 *
 * The first build put the wall in `siegeDefence` *and* had the overflow come off the wall, and the
 * fixture table found it: at 25 barricades the base lost **0.0 cache units against a mass of 120**,
 * total cache immunity bought with one scrap, because the same 25 points were subtracted twice — once
 * as defence and once as absorption. After the split that cell reads **1.9 units**.
 *
 * Be precise about what the split did NOT change, because the obvious symptom was never the double
 * count: the **breach** share at 25 barricades was 0.0% before and is 0.0% after. That is
 * `breached = wallBefore === 0 && …` at work — any standing wall is absolutely breach-proof, by design
 * — and it would have read the same with the wall counted three times. The wall now does exactly one
 * job: it is the **damage sink**, so a hundred points of wall absorbs a hundred points of night and
 * the number means what it says.
 */
/**
 * What the BUILDING itself is worth, before anyone lifts a hand — a door, a stairwell, a roof.
 *
 * This term exists because the first build did not have it. **The figures in the next sentence are a
 * design note, not a re-derivable measurement** — they describe a build that no longer exists, and
 * `measure/t83.ts` cannot reproduce them; the shipped tree prints 41 passed / 8 held / 1 repelled /
 * 5 breached over 55 nights. With `SIEGE_BASE_DEFENCE` absent, 60 seeker runs produced **34
 * `siege.passed` and 18 `siege.breached`, and zero `held` and zero `repelled`** — every single siege
 * that came took the base. Two facts combined to make it a guillotine, and both are properties of the
 * shipped economy rather than of this system:
 *
 *   - **`fortify` is economically out of reach.** Peak scrap carried across a whole run averages
 *     **0.3 units**, `fortify` is chosen **0.1 times per claimed run**, and a claimed base carries ANY
 *     wall at all on **4.2% of based turns** (109 of 2579; 5.6% under the `seeker` style, 69 of 1233
 *     — neither is above 6%). One scrap buys `FORTIFY_GAIN` 25 points, which
 *     `FORTIFY_DECAY_PER_HOUR` 1 erases in a day. So `barricades` is 0 essentially always. (That is
 *     T85's economy brief, not this task's, and it is recorded here rather than patched here.)
 *   - **A base you are not standing in had a defence of literally zero**, so `overflow` equalled the
 *     full pressure and the breach condition was met on the first night, every time.
 *
 * A building is not nothing. At 12 an unwalled, unattended base survives the quiet nights that make up
 * most of them and falls to the ones with a mass in them — which is the shape the GDD asks for.
 */
export const SIEGE_BASE_DEFENCE = 12;
/** Each resident posted to a barricade-upkeep job (`job.watch`) — the lookout who wakes the house. */
export const SIEGE_WATCH_DEFENCE = 20;
/** Each other living companion at the base — bodies against the door. */
export const SIEGE_COMPANION_DEFENCE = 8;
/** The player, standing in their own shelter when it comes. */
export const SIEGE_PLAYER_DEFENCE = 15;

/** Cache units taken per point of overflow that the wall could not absorb. */
export const SIEGE_STASH_LOSS_DIVISOR = 8;
/**
 * The **toll** — the night less the building less the wall, i.e. what reached the people regardless of
 * how many of them there were — at which a defender is hurt. Deliberately not read off the
 * party-inclusive overflow; see {@link resolveOneNight} for the measurement that forced the split.
 */
export const SIEGE_WOUND_AT = 20;
/** The wound a night attack deals a defender, and how bad. */
export const SIEGE_WOUND_TYPE = "wound.laceration";
export const SIEGE_WOUND_SEVERITY = 25;
/** Toll at which a resident is killed outright. Swept by rebuild against party sizes 0–3. */
export const SIEGE_FATAL_AT = 40;
/**
 * Overflow past the wall at which the base is actually LOST, rather than merely robbed and bloodied.
 *
 * The first build breached on `past > 0` — any overflow at all against a bare wall — which is why 18
 * of 18 sieges that landed were total losses with no gradient in between (again a design note from a
 * build that no longer exists, not a figure `measure/t83.ts` can re-derive). A night has to be able to
 * cost you the cache and a companion and still leave you the roof, or the base is a coin rather than
 * a place. Swept by rebuild; see the table in `docs/qa/QA_REVIEW_T83.md`.
 */
export const SIEGE_BREACH_AT = 30;
/** Bodies left standing in a breached base. */
export const SIEGE_BREACH_WALKERS = 2;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));
const normHour = (hour: number): number => ((Math.trunc(hour) % 24) + 24) % 24;

/** Is this clock hour one of the six the day's `night` phase covers (21–23, 00–02)? */
export function isNightHour(hour: number): boolean {
  const h = normHour(hour);
  return h >= 21 || h <= 2;
}

/**
 * How many of the `hours` starting at `fromHour` fall in the night window — the turn's **span**, not
 * the phase it resolves in. This is the whole reason a 9-hour sleep from 21:00 (which resolves at
 * 06:00, phase "dawn") is still a night: it covers all six night hours. Counting by resolved phase
 * would have made the one turn the brief is *about* the one turn that could never trigger it.
 */
export function nightHoursIn(fromHour: number, hours: number): number {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return 0;
  // Closed form, not a loop over the hours: `timeCost` reaches this from stage 2 unvalidated, and every
  // other clock in the engine is O(1) (`sim/clocks.ts`). Whole days contribute the full window; the
  // remainder is counted by walking at most 23 hours.
  const whole = Math.trunc(h / 24) * SIEGE_HOURS_PER_NIGHT;
  const rest = h % 24;
  let n = 0;
  for (let i = 0; i < rest; i += 1) if (isNightHour(fromHour + i)) n += 1;
  return whole + n;
}

/** Node ids within `hops` of `from` (inclusive of `from`). Breadth-first over the transient graph. */
function within(graph: RegionGraph, from: NodeId, hops: number): readonly NodeId[] {
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  for (let d = 0; d < Math.max(0, Math.trunc(hops)); d += 1) {
    const next: NodeId[] = [];
    for (const id of frontier) {
      for (const adj of graph.nodes[id]?.adjacent ?? []) {
        if (seen.has(adj)) continue;
        seen.add(adj);
        next.push(adj);
      }
    }
    frontier = next;
  }
  return [...seen];
}

/**
 * What is pressing on the base tonight, 0–100. Three terms, each measured before it was weighted:
 * the carried mass that walked into earshot, the district's standing density, and the noise the
 * player's own night left on the blocks around their door.
 *
 * Returns 0 without a claimed shelter or a graph, so every pool-free and shelter-free run is inert.
 */
export function siegePressure(state: GameState, graph: RegionGraph | undefined): number {
  const sid = state.player.shelterId;
  if (sid === null || graph === undefined || graph.nodes[sid] === undefined) return 0;

  const earshot = new Set(within(graph, sid, SIEGE_HEARING));
  // `whole` rather than `Math.trunc`: a hand-edited non-finite `size` must not become a non-finite
  // pressure, which `Math.max(0, Math.min(100, NaN))` does NOT scrub — it returns NaN, which then
  // fails `< SIEGE_MIN_PRESSURE`, reaches the beat, and serializes to `null`. `sim/hordes.ts` already
  // scrubs this at the source and `test/overrun.test.ts` has a test named for it; the audit caught this
  // module reintroducing the identical lossy-save bug one layer up.
  const mass = state.hordes.reduce((n, h) => (earshot.has(h.pos) ? n + whole(h.size) : n), 0);

  const regionId = graph.nodes[sid]!.regionId;
  const density = clampPct(state.regions[regionId]?.zombieDensity ?? 0);

  // The neighbourhood read, INCLUDING home: a settled player's sound lives on the blocks they work,
  // because the one node they never search is the one they sleep in.
  const neighbourhood = [sid, ...graph.nodes[sid]!.adjacent];
  const loudest = neighbourhood.reduce((n, id) => Math.max(n, state.nodes[id]?.noise ?? 0), 0);

  const pressure =
    Math.trunc(mass / SIEGE_MASS_DIVISOR) +
    Math.trunc(density / SIEGE_DENSITY_DIVISOR) +
    Math.trunc(loudest / SIEGE_NOISE_DIVISOR);
  return Math.max(0, Math.min(SIEGE_PRESSURE_MAX, pressure));
}

/** Living companions standing at the claimed base tonight. */
function defenders(state: GameState): readonly Survivor[] {
  const sid = state.player.shelterId;
  if (sid === null) return [];
  return Object.values(state.actors as Record<ActorId, Survivor>).filter(
    (a) => isCompanion(a) && a.location === sid,
  );
}

/** Is this defender posted to the barricade-upkeep job — the lookout on the wall? */
function isWatcher(graph: RegionGraph | undefined, actor: Survivor): boolean {
  const jobId = jobIdOf(actor);
  if (jobId === null) return false;
  return (graph?.jobs ?? []).some((j) => j.id === jobId && j.upkeepsBarricades === true);
}

/**
 * What stands between the pressure and the wall: the building, each lookout, each other body at the
 * base, and the player themselves if they are home when it comes. What gets past this meets the
 * barricades, and what gets past THOSE comes out of the cache and the people ({@link resolveOneNight}).
 *
 * Being away costs you the `SIEGE_PLAYER_DEFENCE` in the doorway, which is the entire argument for
 * leaving someone on watch: a lookout is set at 20 against your 15, so a posted resident more than
 * covers your absence. (Those are chosen constants, not measurements — the *measurement* is what they
 * produce, in `docs/qa/QA_REVIEW_T83.md`'s wall and party tables.)
 */
export function siegeDefence(state: GameState, graph: RegionGraph | undefined): number {
  const sid = state.player.shelterId;
  if (sid === null) return 0;
  let people = 0;
  for (const d of defenders(state)) {
    people += isWatcher(graph, d) ? SIEGE_WATCH_DEFENCE : SIEGE_COMPANION_DEFENCE;
  }
  const player = state.player.location === sid ? SIEGE_PLAYER_DEFENCE : 0;
  return SIEGE_BASE_DEFENCE + people + player;
}

/** What one night's attack did, for the Living History and the harness read. */
export interface SiegeOutcome {
  readonly pressure: number;
  readonly defence: number;
  /** Pressure the defence could not absorb. Zero ⇒ the night was held without loss. */
  readonly overflow: number;
  readonly wallLost: number;
  readonly stashLost: number;
  readonly wounded: boolean;
  readonly fallen: readonly ActorId[];
  readonly breached: boolean;
}

/**
 * Resolve ONE night against the base. Pure; draws once from the `siege` stream to decide whether the
 * night comes at all, and only when the pressure clears {@link SIEGE_MIN_PRESSURE} — so a quiet night
 * takes no draw and cannot shift the stream for the nights that follow.
 *
 * The order of losses is the order a base actually falls: the wall, then the cache, then the people,
 * then the ground itself.
 */
function resolveOneNight(state: GameState, graph: RegionGraph | undefined): GameState {
  const sid = state.player.shelterId;
  if (sid === null) return state;

  const pressure = siegePressure(state, graph);
  if (pressure < SIEGE_MIN_PRESSURE) return state;

  // The night's own coin: pressure/100 of a night that presses is a night that comes. A pressure of 12
  // is a bad dream; a pressure of 80 is a certainty. One draw, from this module's own stream.
  const roll = drawFloat(state.rng, state.meta.seed, SIEGE_STREAM);
  let next: GameState = { ...state, rng: roll.rng };
  if (roll.value * SIEGE_PRESSURE_MAX >= pressure) {
    // It passed the house by. The draw was still taken — a night that could have come and did not is
    // a night, and pretending otherwise would make the stream depend on the outcome it produced.
    return appendSiege(next, sid, {
      pressure, defence: siegeDefence(next, graph), overflow: 0,
      wallLost: 0, stashLost: 0, wounded: false, fallen: [], breached: false,
    }, "siege.passed");
  }

  const defence = siegeDefence(next, graph);
  const overflow = Math.max(0, pressure - defence);
  if (overflow === 0) {
    return appendSiege(next, sid, {
      pressure, defence, overflow: 0, wallLost: 0, stashLost: 0, wounded: false, fallen: [], breached: false,
    }, "siege.repelled");
  }

  // 1. The wall takes it first, and absorbs what it can.
  const node = next.nodes[sid];
  const wallBefore = clampPct(node?.barricades ?? 0);
  // Point for point, and deliberately NOT via a scaling constant: the first build had a
  // `SIEGE_WALL_LOSS_PER_POINT` here, which mixed units — `wallLost` is in barricade points and is then
  // subtracted from `overflow`, which is in pressure points, so at any value but 1 the constant drove
  // `past` NEGATIVE and silently killed every threshold downstream. A knob that is only correct at one
  // value is not a knob.
  const wallLost = Math.min(wallBefore, overflow);
  const past = overflow - wallLost;
  if (node !== undefined && wallLost > 0) {
    next = { ...next, nodes: { ...next.nodes, [sid]: { ...node, barricades: wallBefore - wallLost } } };
  }

  // 2. What got past the wall comes out of the cache — FR-SHL-03's own depletion hook.
  const stashBefore = stashUnits(next.player.stash);
  const wanted = Math.trunc(past / SIEGE_STASH_LOSS_DIVISOR);
  if (wanted > 0) next = depleteStash(next, wanted);
  const stashLost = stashBefore - stashUnits(next.player.stash);

  // 3. Then the people — and this reads a DIFFERENT quantity from the cache above, for a reason the
  //    measurement forced. `past` is what got through the wall *after the party's soak*, so every extra
  //    body at the base lowers it by `SIEGE_COMPANION_DEFENCE`. Reading the fatal threshold off `past`
  //    therefore made a party of two arithmetically immune: measured on the fixture, a defender died on
  //    69% of the heaviest nights at a party of ONE and on **0.0% at a party of two or three**, at every
  //    mass. That is T82's `COMPANION_FATAL_BURDEN` lesson — "a party you cannot lose is recruiting-is-
  //    free again" — recurring in a second system one task later.
  //
  //    So the toll is what reached the PEOPLE at all: the night, less the building, less whatever the
  //    wall absorbed. A bigger party still protects the stores (that is `past`, above) and still lowers
  //    the odds of a breach; it no longer makes the people who are standing in it unkillable.
  const toll = Math.max(0, pressure - SIEGE_BASE_DEFENCE - wallLost);

  //    The player is hurt only if they are actually home — being away costs you the base, not your
  //    skin, and that asymmetry is the point of leaving a watch behind.
  let wounded = false;
  if (toll >= SIEGE_WOUND_AT && next.player.location === sid) {
    next = {
      ...next,
      player: {
        ...next.player,
        condition: inflictNamedWound(
          next.player.condition, SIEGE_WOUND_TYPE, SIEGE_WOUND_SEVERITY, "arm", next.meta.day, next.meta.hour,
        ),
      },
    };
    wounded = true;
  }
  const fallen: ActorId[] = [];
  if (toll >= SIEGE_FATAL_AT) {
    // The first defender by sorted id, so the loss is reproducible without a second draw.
    const here = [...defenders(next)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const lost = here[0];
    if (lost !== undefined) {
      next = killCompanion(next, lost.id);
      fallen.push(lost.id);
    }
  }

  // 4. The breach: the wall was already down when this came, and what got past the building itself was
  //    more than a bad night — `SIEGE_BREACH_AT`. Both clauses matter. The wall clause is what makes
  //    `fortify` the answer (you cannot be broken through a standing barricade, only worn down to one
  //    that isn't); the threshold is what keeps a bare base a place you can be robbed in rather than a
  //    coin flipped once a night.
  const breached = wallBefore === 0 && past >= SIEGE_BREACH_AT;
  if (breached) {
    next = breachShelter(next, sid);
  }

  return appendSiege(
    next, sid,
    { pressure, defence, overflow, wallLost, stashLost, wounded, fallen, breached },
    breached ? "siege.breached" : "siege.held",
  );
}

/**
 * End a tenancy — the single place `shelterId` goes back to null (the first writes of null outside
 * `createInitialState` in the project's history; both of this task's, and both routed through here),
 * shared by the breach and by the `abandon-shelter` verb, because the three things that have to be cleaned up are the same either way
 * and the audit found the first cut leaving all three behind:
 *
 *   1. **The banked night.** `world.siegeHours` is an accumulator for a *specific* base. Carrying it
 *      across a loss means the five hours you banked at a base you no longer hold buy a siege check on
 *      the first hour of the next one. `sim/clocks.ts` is explicit that an assignment **ending** resets
 *      its clock rather than holding it; losing the base is that ending.
 *   2. **The jobs.** `withJob` forces `order:hold` on a worker, so a resident posted to a job never
 *      follows the player. Leaving the flag on strands them at a node that is not a base any more, with
 *      no job pool that can reach them (every job path is gated on `atOwnShelter`) and no order that
 *      would ever move them. Clearing the flag hands them back to the ordinary follow/hold logic.
 *   3. **The claim itself.**
 *
 * It does NOT move anyone: where the party is standing is the party's business, and a companion who
 * was at the base is still at that node — now an ordinary one.
 */
function releaseShelter(state: GameState): GameState {
  let actors = state.actors;
  for (const [id, a] of Object.entries(state.actors as Record<ActorId, Survivor>)) {
    if (!isCompanion(a) || jobIdOf(a) === null) continue;
    const flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(a.flags)) if (!k.startsWith(JOB_FLAG_PREFIX)) flags[k] = v as boolean;
    actors = { ...actors, [id]: { ...a, flags } };
  }
  const world = state.world.siegeHours === undefined ? state.world : { ...state.world, siegeHours: 0 };
  return {
    ...state,
    world,
    actors,
    player: { ...state.player, shelterId: null },
  };
}

/**
 * Lose the base: end the tenancy ({@link releaseShelter}), scatter whatever the cache still held, and
 * leave the dead standing in the rooms so the place reads as taken rather than merely un-owned.
 *
 * The cache is *scattered*, not transferred: a breached base's stores are gone. `depleteStash` logs
 * what went, so the Living History can tell the player exactly what they lost.
 */
export function breachShelter(state: GameState, sid: NodeId): GameState {
  let next = state;
  const held = stashUnits(next.player.stash);
  if (held > 0) next = depleteStash(next, held);
  const node = next.nodes[sid];
  if (node !== undefined) {
    next = {
      ...next,
      nodes: { ...next.nodes, [sid]: { ...node, barricades: 0, walkers: node.walkers + SIEGE_BREACH_WALKERS } },
    };
  }
  return releaseShelter(next);
}

/**
 * Give up the base voluntarily — the `abandon-shelter` half of PL-M3-07, exported for `sim/shelter.ts`
 * so both ways of ending a tenancy go through {@link releaseShelter}. The cache, the wall and the dead
 * are all left exactly as they stand: walking away is not being broken out.
 */
export function releaseShelterVoluntarily(state: GameState): GameState {
  return releaseShelter(state);
}

/** Append one night's beat to the Living History. */
function appendSiege(state: GameState, sid: NodeId, out: SiegeOutcome, type: string): GameState {
  const { day, hour, turn } = state.meta;
  return {
    ...state,
    history: [
      ...state.history,
      {
        day, hour, turn, type,
        subjects: [sid, ...out.fallen],
        data: {
          pressure: out.pressure, defence: out.defence, overflow: out.overflow,
          wallLost: out.wallLost, stashLost: out.stashLost,
          wounded: out.wounded, breached: out.breached,
        },
      },
    ],
  };
}

/**
 * The T83 hook, called from pipeline stage 9 (beside the horde walk, because a siege reads where the
 * masses ended up) and from `advanceWorld` (so a fast-forward can cost you the base while you are not
 * in it — the version of this system with actual teeth).
 *
 * Banks the night hours the turn's span covered and resolves one attack per completed night. Inert
 * without a claimed shelter, on a zero-hour turn, and on any turn whose span touches no night hour —
 * which is most of them, so the accumulator holds rather than churning the save (the T74 idle rule).
 *
 * `fromHour` is the turn's OPENING hour: the caller has already advanced the clock by the time this
 * runs, so the span has to be reconstructed from where it started.
 */
export function tickSiege(
  state: GameState,
  graph: RegionGraph | undefined,
  fromHour: number,
  hours: number,
): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  // No base, or no graph to read the world through. Both are fully inert, and the graph clause matters:
  // without it a graph-less advance banked hours and then SPENT them on nights that could not resolve
  // (`siegePressure` is 0 without a graph), so a pool-less fast-forward silently consumed the nights a
  // real one would have played. Neither case touches the accumulator.
  if (state.player.shelterId === null || graph === undefined) return state;
  const nightHours = nightHoursIn(fromHour, h);
  // Scrubbed on read like every other accumulator (`sim/clocks.ts` says holding sites must): the save
  // format validates `format`/`saveSchemaVersion`/`summary`/`meta` and nothing else, so a hand-edited
  // negative or fractional `siegeHours` reaches this untouched.
  const carried = whole(state.world.siegeHours);
  // Nothing to do: no night hours this turn AND nothing banked. Hold rather than rewrite the world.
  //
  // The `&& carried === 0` half is a **redundant fast path, and the mutation run proved it**: dropping
  // it survives every test, and it has to, because `bankHours` keeps `rest < per`, so a carry is always
  // 0–5 and `bankHours(carry, 0, 6)` yields `steps 0` and `rest === carry` — the function then returns
  // `state` by the other path anyway. Verified exhaustively over all 1026 (carry, startHour, hours)
  // triples with `nightHoursIn === 0`: the same object, 1026 of 1026. Kept because it skips the call,
  // declared here so nobody mistakes its survival for a missing test.
  if (nightHours === 0 && carried === 0) return state;
  const banked = bankHours(carried, nightHours, SIEGE_HOURS_PER_NIGHT);
  let next: GameState =
    banked.rest === carried ? state : { ...state, world: { ...state.world, siegeHours: banked.rest } };
  for (let n = 0; n < banked.steps; n += 1) {
    // A base already lost earlier in this same span cannot be besieged again. **Also a redundant fast
    // path, also proved by the mutation run**: `resolveOneNight`'s own first two lines return early on
    // a null `shelterId`, so removing this `break` can only ever skip work that is already a no-op —
    // verified over 400 ten-night spans, in which no beat ever follows a `siege.breached`.
    if (next.player.shelterId === null) break;
    next = resolveOneNight(next, graph);
  }
  return next;
}

// --- narration ---------------------------------------------------------------------------------

/**
 * A one-line read of what the night would cost the player if it came tonight — offered while they
 * stand in their own base during the dark. Words only, never a number (FR-UI-02).
 */
export function siegeLine(state: GameState, graph: RegionGraph | undefined): string | null {
  const sid = state.player.shelterId;
  if (sid === null || sid !== state.player.location) return null;
  if (!isNightHour(state.meta.hour)) return null;
  const pressure = siegePressure(state, graph);
  if (pressure < SIEGE_MIN_PRESSURE) return null;
  // The wall HAS to be in this read even though it is deliberately not in `siegeDefence`, because this
  // is the only sentence the player ever gets about the night and it is a sentence about the walls.
  // The first cut compared pressure against `siegeDefence` alone and therefore said "the walls will not
  // hold all of it" at a hundred barricades — wrong in exactly the case fortifying exists to fix.
  const stands = siegeDefence(state, graph) + clampPct(state.nodes[sid]?.barricades ?? 0);
  return pressure > stands
    ? "Something is moving out there, and the walls will not hold all of it."
    : "Something is moving out there. The walls should hold.";
}
