/**
 * T79 measurement runner — the numbers quoted in `sim/regionDrift.ts` and `docs/qa/QA_REVIEW_T79.md`,
 * re-derivable on demand (the T77/T78 discipline: a task's before/after figures are worthless if the
 * thing that produced them was a scratch script). It asserts nothing and CI does not run it, and it
 * plays the **shipped city** (`content/`), never a fixture.
 *
 *   npx tsx measure/t79.ts              # 40 idle days parked at the start node: held district vs the five abandoned ones
 *   npx tsx measure/t79.ts --patrol     # the same 40 days twice: one district patrolled every 2 days vs abandoned
 *   npx tsx measure/t79.ts --cap        # the PL-M5-31 cap derivation: anchor decomposition, saturation, spread
 *   npx tsx measure/t79.ts --absent     # the design review's 400-turn absent claim, re-measured on this tree
 *
 * The same file runs against the pre-T79 tree: the neglect constants are read off the engine
 * namespace with fallbacks and the neglect-day columns are computed HERE by the same rule, so the
 * "before" run prints the identical diagnostics and the two outputs line up column for column.
 *
 * The cap sweep and the threat-only probe quoted in the review are taken by REBUILDING the engine with
 * the variant constant (`NEGLECT_CAP`, or a `driftAnchor` that leaves `zombieDensity` off the neglect
 * lift) and re-running `--cap` / the default mode against each — the runner prints whatever constants
 * the tree it is running against compiled in, which is what makes that sweep honest.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceClock,
  advanceWorld,
  startRun,
  STORY_ARCS,
  type GameState,
  type NodeState,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
/** The T79 constants, or the pre-T79 tree's absence of them (a cap of 0 = no neglect term at all). */
const NEGLECT_CAP = (ENGINE["NEGLECT_CAP"] as number | undefined) ?? 0;
const NEGLECT_GRACE_DAYS = (ENGINE["NEGLECT_GRACE_DAYS"] as number | undefined) ?? 2;
const NEGLECT_PER_DAY = (ENGINE["NEGLECT_PER_DAY"] as number | undefined) ?? 1;
const DAY_RAMP_PER_DAY = (ENGINE["DAY_RAMP_PER_DAY"] as number | undefined) ?? 0;
const DAY_RAMP_CAP = (ENGINE["DAY_RAMP_CAP"] as number | undefined) ?? 0;
const HAS_NEGLECT = ENGINE["NEGLECT_CAP"] !== undefined;

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

function boot(seed: string): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-13T00:00:00.000Z" },
    load("regions"),
    load("nodes"),
    load("npcs"),
    STORY_ARCS.map((a) => a.id),
    load("encounters"),
    load("radio"),
    load("recipes"),
    load("jobs"),
    load("factions"),
  );
}

const REGION_IDS = [
  "region.downtown",
  "region.mercy-hospital",
  "region.ironworks",
  "region.rivermouth",
  "region.hillcrest",
  "region.the-terraces",
];
const short = (id: string): string => id.replace("region.", "").padEnd(14);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2));
const bodies = (s: GameState): number =>
  Object.values(s.nodes).reduce((a, n) => a + n.walkers, 0) + s.hordes.reduce((a, h) => a + h.size, 0);

/**
 * Days since the player last stood in each region, by the SAME rule the engine derives (the region the
 * player is in reads 0; a region with no entered node reads from day 1) — computed here so the pre-T79
 * tree, which has no such function, prints the same column.
 */
function neglectDays(s: GameState): Record<string, number> {
  const here = s.nodes[s.player.location]?.regionId;
  const last: Record<string, number> = {};
  for (const n of Object.values(s.nodes) as NodeState[]) {
    if (n.lastVisit === null || !Number.isFinite(n.lastVisit)) continue;
    const d = Math.trunc(n.lastVisit);
    const seen = last[n.regionId];
    if (seen === undefined || d > seen) last[n.regionId] = d;
  }
  const out: Record<string, number> = {};
  for (const id of Object.keys(s.regions)) out[id] = id === here ? 0 : s.meta.day - (last[id] ?? 1);
  return out;
}

/** What the runner's own arithmetic says the neglect term should be — never read from the engine. */
const expectedLift = (days: number): number =>
  Math.min(NEGLECT_CAP, Math.max(0, (Math.trunc(days) - NEGLECT_GRACE_DAYS) * NEGLECT_PER_DAY));
const ramp = (day: number): number => Math.min(DAY_RAMP_CAP, Math.max(0, Math.trunc(day) - 1) * DAY_RAMP_PER_DAY);

interface Options {
  readonly days: number;
  /** Stamp `lastVisit` on one node of this region every `patrolEvery` days (a stand-in for travel). */
  readonly patrol?: string;
  readonly patrolEvery?: number;
}

/** Park the player on the start node and let the world run, advancing the clock alongside. */
function idleRun(seed: string, opts: Options): { snaps: Record<number, GameState>; graph: RegionGraph; start: GameState } {
  let { state, graph } = boot(seed);
  const start = state;
  const snaps: Record<number, GameState> = { 0: state };
  const patrolNode =
    opts.patrol === undefined ? undefined : Object.entries(state.nodes).find(([, n]) => n.regionId === opts.patrol)?.[0];
  for (let day = 1; day <= opts.days; day += 1) {
    state = { ...advanceWorld(state, 24, graph), meta: advanceClock(state.meta, 24) };
    if (patrolNode !== undefined && day % (opts.patrolEvery ?? 2) === 0) {
      const n = state.nodes[patrolNode]!;
      state = { ...state, nodes: { ...state.nodes, [patrolNode]: { ...n, lastVisit: state.meta.day } } };
    }
    snaps[day] = state;
  }
  return { snaps, graph, start };
}

function header(): void {
  console.log(
    `\nengine constants on this tree: neglect ${HAS_NEGLECT ? `cap ${NEGLECT_CAP}, grace ${NEGLECT_GRACE_DAYS}d, ${NEGLECT_PER_DAY}/day` : "ABSENT (pre-T79)"}; day ramp ${DAY_RAMP_PER_DAY}/day cap ${DAY_RAMP_CAP}`,
  );
}

function idle(opts: Options, title: string): void {
  const CHECK = [0, 3, 4, 7, 14, 23, 30, 40].filter((d) => d <= opts.days);
  header();
  for (const seed of ["t79-a", "t79-b"]) {
    const { snaps, graph, start } = idleRun(seed, opts);
    const baseline = Object.fromEntries(REGION_IDS.map((id) => [id, graph.regions[id]!.baseline!]));
    const here = start.nodes[start.player.location]!.regionId;
    console.log(`\n===== ${title}, seed ${seed} — threat/density; the player holds ${here.replace("region.", "")} =====`);
    console.log(`  ${"region".padEnd(14)} ${CHECK.map((d) => `d${d}`.padStart(8)).join("")}   authored`);
    for (const id of REGION_IDS) {
      const b = baseline[id]!;
      const cells = CHECK.map((d) => `${snaps[d]!.regions[id]!.threat}/${snaps[d]!.regions[id]!.zombieDensity}`.padStart(8));
      const tag = id === here ? " HELD" : "";
      console.log(`  ${short(id)} ${cells.join("")}   [${b.threat}/${b.zombieDensity}]${tag}`);
    }
    console.log(`  neglect days   ${CHECK.map((d) => {
      const n = neglectDays(snaps[d]!);
      const away = REGION_IDS.filter((id) => id !== here).map((id) => n[id]!);
      return String(Math.max(...away)).padStart(8);
    }).join("")}   (max over the abandoned districts)`);
    console.log(`  bodies         ${CHECK.map((d) => String(bodies(snaps[d]!)).padStart(8)).join("")}`);
    const meanThreat = (d: number): number => mean(REGION_IDS.map((id) => snaps[d]!.regions[id]!.threat));
    console.log(`  mean threat    ${CHECK.map((d) => String(meanThreat(d)).padStart(8)).join("")}`);
    console.log(`  at the clamp   ${CHECK.map((d) => String(REGION_IDS.filter((id) => snaps[d]!.regions[id]!.threat >= 100).length).padStart(8)).join("")}   (districts with threat 100)`);
    // The differential this task exists to produce: the held district against the same district's
    // authored point, versus every abandoned one against theirs.
    const over = (d: number, id: string): number => snaps[d]!.regions[id]!.threat - baseline[id]!.threat!;
    console.log(`  HELD over auth ${CHECK.map((d) => String(over(d, here)).padStart(8)).join("")}   (${here.replace("region.", "")})`);
    console.log(`  away over auth ${CHECK.map((d) => String(mean(REGION_IDS.filter((id) => id !== here).map((id) => over(d, id)))).padStart(8)).join("")}   (mean of the five abandoned)`);
    console.log(`  gap            ${CHECK.map((d) => String(+(mean(REGION_IDS.filter((id) => id !== here).map((id) => over(d, id))) - over(d, here)).toFixed(2)).padStart(8)).join("")}   <- the neglect differential`);
  }
}

/** The PL-M5-31 derivation: what the anchor is made of, day by day, and what the brief's cap would have done. */
function cap(): void {
  header();
  const { graph } = boot("t79-a");
  const DAYS = [1, 4, 7, 14, 21, 23, 30, 40];
  console.log(`\n===== the anchor, decomposed (authored + ramp + neglect), for a district abandoned from day 1 =====`);
  console.log(`  ${"region".padEnd(14)} ${"auth".padStart(5)} ${DAYS.map((d) => `d${d}`.padStart(9)).join("")}`);
  for (const id of REGION_IDS) {
    const b = graph.regions[id]!.baseline!.threat!;
    const cells = DAYS.map((d) => `${Math.min(100, b + ramp(d) + expectedLift(d))}`.padStart(9));
    console.log(`  ${short(id)} ${String(b).padStart(5)} ${cells.join("")}`);
  }
  console.log(`  ${"(ramp only)".padEnd(14)} ${"".padStart(5)} ${DAYS.map((d) => `+${ramp(d)}`.padStart(9)).join("")}`);
  console.log(`  ${"(neglect)".padEnd(14)} ${"".padStart(5)} ${DAYS.map((d) => `+${expectedLift(d)}`.padStart(9)).join("")}`);
  console.log(`\n  the brief's cap was ABSOLUTE — "capped at baseline.threat + 20". Against this anchor:`);
  for (const d of DAYS) {
    const rampOnly = ramp(d);
    console.log(
      `    day ${String(d).padStart(2)}: ramp alone = +${rampOnly}` +
        (rampOnly > 20 ? `  <-- an absolute cap of +20 would CLAMP THE RAMP DOWN by ${rampOnly - 20}` : ""),
    );
  }
  console.log(`\n===== 40 idle days: what each cap costs in saturation (this tree's cap is ${NEGLECT_CAP}) =====`);
  const { snaps } = idleRun("t79-a", { days: 40 });
  const end = snaps[40]!;
  const clamped = REGION_IDS.filter((id) => end.regions[id]!.threat >= 100);
  const ts = REGION_IDS.map((id) => end.regions[id]!.threat);
  console.log(`  d40 mean threat ${mean(ts)}; spread ${Math.max(...ts) - Math.min(...ts)}; at the clamp ${clamped.length} (${clamped.map((i) => i.replace("region.", "")).join(", ") || "none"}); bodies ${bodies(end)}`);
  const here = snaps[0]!.nodes[snaps[0]!.player.location]!.regionId;
  const overEnd = (id: string): number => end.regions[id]!.threat - graph.regions[id]!.baseline!.threat!;
  console.log(
    `  d40 held ${overEnd(here)} over authored; abandoned mean ${mean(REGION_IDS.filter((id) => id !== here).map(overEnd))} over authored; gap ${+(mean(REGION_IDS.filter((id) => id !== here).map(overEnd)) - overEnd(here)).toFixed(2)}`,
  );
}

/** The design review's own probe, re-measured: 400 turns with the player absent (no action at all). */
function absent(): void {
  header();
  const TURNS = 400;
  for (const seed of ["t79-a"]) {
    let { state, graph } = boot(seed);
    const b = Object.fromEntries(REGION_IDS.map((id) => [id, graph.regions[id]!.baseline!]));
    // The review's probe: 400 world turns of 2 hours, the player never acting.
    for (let i = 0; i < TURNS; i += 1) state = { ...advanceWorld(state, 2, graph), meta: advanceClock(state.meta, 2) };
    console.log(`\n===== ${TURNS} turns x 2h (day ${state.meta.day}), player absent, seed ${seed} =====`);
    for (const id of REGION_IDS) {
      console.log(
        `  ${short(id)} threat ${String(b[id]!.threat).padStart(3)} -> ${String(state.regions[id]!.threat).padStart(3)}   density ${String(b[id]!.zombieDensity).padStart(3)} -> ${String(state.regions[id]!.zombieDensity).padStart(3)}`,
      );
    }
    console.log(`  bodies ${bodies(state)}`);
  }
}

/**
 * The in-game differential, isolated: the SAME seed and the same 40 idle days run twice, once with one
 * district visited every other day and once with it abandoned. Everything else about the two runs is
 * identical, so the difference between the two columns is the neglect term and nothing else.
 *
 * The visit is synthetic — the runner stamps `lastVisit` on one of the district's nodes, which is
 * exactly what walking in does (`actions/coreActions.ts`) — because a policy that reliably tours six
 * districts for 40 days is a different experiment (the bots die on day 4; see `measure/t78.ts`).
 */
function patrol(regionId: string): void {
  header();
  const DAYS = [3, 4, 5, 7, 10, 14, 20, 30, 40];
  for (const seed of ["t79-a", "t79-b"]) {
    const held = idleRun(seed, { days: 40, patrol: regionId, patrolEvery: 2 });
    const away = idleRun(seed, { days: 40 });
    const b = held.graph.regions[regionId]!.baseline!;
    console.log(`\n===== ${regionId.replace("region.", "")} (authored ${b.threat}/${b.zombieDensity}) — patrolled every 2 days vs abandoned, seed ${seed} =====`);
    console.log(`  ${"".padEnd(14)} ${DAYS.map((d) => `d${d}`.padStart(9)).join("")}`);
    const row = (label: string, r: typeof held): void =>
      console.log(`  ${label.padEnd(14)} ${DAYS.map((d) => `${r.snaps[d]!.regions[regionId]!.threat}/${r.snaps[d]!.regions[regionId]!.zombieDensity}`.padStart(9)).join("")}`);
    row("patrolled", held);
    row("abandoned", away);
    console.log(`  ${"threat gap".padEnd(14)} ${DAYS.map((d) => String(away.snaps[d]!.regions[regionId]!.threat - held.snaps[d]!.regions[regionId]!.threat).padStart(9)).join("")}`);
    // What the player actually READS: `harness/src/screens.ts#threatWord` turns the dial into a word on
    // the travel list, so the day the two runs cross a threshold is the day neglect becomes visible.
    const word = (t: number): string => (t >= 75 ? "deadly" : t >= 50 ? "dangerous" : t >= 25 ? "uneasy" : "quiet");
    console.log(`  ${"patrolled word".padEnd(14)} ${DAYS.map((d) => word(held.snaps[d]!.regions[regionId]!.threat).padStart(9)).join("")}`);
    console.log(`  ${"abandoned word".padEnd(14)} ${DAYS.map((d) => word(away.snaps[d]!.regions[regionId]!.threat).padStart(9)).join("")}`);
    let split: number | null = null;
    for (let d = 1; d <= 40 && split === null; d += 1) {
      if (word(away.snaps[d]!.regions[regionId]!.threat) !== word(held.snaps[d]!.regions[regionId]!.threat)) split = d;
    }
    const differing = Array.from({ length: 40 }, (_, i) => i + 1).filter(
      (d) => word(away.snaps[d]!.regions[regionId]!.threat) !== word(held.snaps[d]!.regions[regionId]!.threat),
    );
    console.log(
      `  the player READS a different word on ${differing.length} of 40 days` +
        (differing.length > 0 ? ` (d${differing[0]}–d${differing[differing.length - 1]}) — the ramp carries the patrolled district over the same threshold later` : ""),
    );
    console.log(`  ${"bodies (city)".padEnd(14)} ${DAYS.map((d) => `${bodies(away.snaps[d]!)}/${bodies(held.snaps[d]!)}`.padStart(9)).join("")}   (abandoned/patrolled)`);
    let first: number | null = null;
    for (let d = 1; d <= 40 && first === null; d += 1) {
      if (away.snaps[d]!.regions[regionId]!.threat !== held.snaps[d]!.regions[regionId]!.threat) first = d;
    }
    console.log(`  first day the two runs differ in this district's threat: ${first ?? "never"}`);
  }
}

const arg = process.argv[2] ?? "";
if (arg.startsWith("--patrol")) patrol(arg.includes("=") ? arg.split("=")[1]! : "region.the-terraces");
else if (arg === "--cap") cap();
else if (arg === "--absent") absent();
else idle({ days: 40 }, "40 idle days off-screen");
