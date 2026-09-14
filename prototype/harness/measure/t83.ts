/**
 * T83 measurement runner — the night-attack / siege / shelter-loss numbers quoted in
 * `sim/siege.ts`, `sim/shelter.ts`, `sim/hordes.ts` and `docs/qa/QA_REVIEW_T83.md`, re-derivable
 * on demand (the T77–T82 discipline: a task's before/after figures are worthless if the thing that
 * produced them was a scratch script). It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t83.ts             # STRUCTURE: what the shelter layer can and cannot reach
 *   npx tsx measure/t83.ts --home      # a homesteading bot: does a run ever claim, and what is the base like?
 *   npx tsx measure/t83.ts --noise     # the brief's trigger: what noise does a base CARRY at bedtime?
 *   npx tsx measure/t83.ts --near      # how close does a mass ever come to a claimed base?
 *   npx tsx measure/t83.ts --bill      # does LOUD play pull a mass toward home? (the brief's thesis)
 *   npx tsx measure/t83.ts --siege     # the distribution the dials were set from
 *   npx tsx measure/t83.ts --wall      # a pinned wall against a pinned mass, on a fixture
 *   npx tsx measure/t83.ts --party     # does a bigger party make the base safe, or the party safe?
 *   npx tsx measure/t83.ts --play      # bot runs on the shipped city: what actually ends a run
 *
 * It runs against the pre-T83 tree unchanged: everything T83 adds is looked up off the engine
 * namespace with a fallback, so the "before" and "after" outputs line up line for line.
 *
 * **Every bot-play mode prints the policy style it ran, and honours `T83_STYLE`.** That is not
 * decoration: `normal` settles whatever node it is standing on and `seeker` walks to an authored
 * safehouse first, and the T83 `claimable` gate is precisely the difference between them — so a figure
 * quoted without its style is not reproducible. `--noise` and `--bill` default to `normal` (the style
 * whose numbers the `sim/siege.ts` header quotes); `--home`, `--near` and `--siege` default to
 * `seeker` (the only style that reaches the post-T83 system often enough to measure it).
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  inSleepWindow,
  runEndReason,
  startRun,
  stashUnits,
  type GameState,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T83 = ENGINE["SIEGE_MIN_PRESSURE"] !== undefined;
const TREE = HAS_T83 ? "POST-T83" : "PRE-T83";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = join(ROOT, "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

function city(seed: string): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-14T00:00:00.000Z" },
    load("regions"), load("nodes"), load("npcs"),
    (ENGINE["STORY_ARCS"] as { id: string }[]).map((a) => a.id),
    load("encounters"), load("radio"), load("recipes"), load("jobs"), load("factions"), load("weapons"),
  );
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const RUNS = Number(process.env["T83_RUNS"] ?? 60);
const ACTIONS = Number(process.env["T83_ACTIONS"] ?? 600);

// --- 1. structure -------------------------------------------------------------------------------

function structure(): void {
  const src = (rel: string): string => readFileSync(join(ROOT, "prototype", "engine", "src", rel), "utf8");
  console.log(`tree: ${TREE}\n`);

  const shelter = src("sim/shelter.ts");
  console.log("sim/shelter.ts hits for the missing system:");
  for (const k of ["raid", "attack", "breach", "siege", "horde", "assault"]) {
    const n = (shelter.match(new RegExp(k, "gi")) ?? []).length;
    console.log(`  ${k.padEnd(10)} ${n}`);
  }

  // shelterId: who WRITES it, anywhere in the engine. One writer and no clearer is the whole defect.
  const files = ["sim/shelter.ts", "sim/siege.ts", "state/createInitialState.ts", "sim/overrun.ts", "sim/events.ts", "sim/jobs.ts"];
  let writers = 0;
  let clearers = 0;
  for (const f of files) {
    let body: string;
    try { body = src(f); } catch { continue; }
    const w = (body.match(/shelterId:\s*/g) ?? []).length;
    const c = (body.match(/shelterId:\s*null/g) ?? []).length;
    if (w > 0) console.log(`  shelterId written ${w}x in ${f} (${c} of them to null)`);
    writers += w; clearers += c;
  }
  console.log(`\nshelterId writers: ${writers} · writers that CLEAR it: ${clearers}`);

  // NodeDef.claimable — declared and read by whom?
  let reads = 0;
  for (const f of ["sim/shelter.ts", "map/seedWorld.ts", "map/regionGraph.ts", "actions/coreActions.ts", "sim/siege.ts"]) {
    let body: string;
    try { body = src(f); } catch { continue; }
    const n = (body.match(/\bclaimable\b/g) ?? []).length;
    if (n > 0) console.log(`  claimable referenced ${n}x in ${f}`);
    reads += n;
  }
  const authored = readdirSync(join(CONTENT, "nodes")).filter((f) =>
    readFileSync(join(CONTENT, "nodes", f), "utf8").includes('"claimable"'));
  console.log(`NodeDef.claimable: declared in map/types.ts, authored on ${authored.length}/${readdirSync(join(CONTENT, "nodes")).length} nodes, referenced by ${reads} engine site(s) outside types.ts`);

  console.log(`\nRunEndReason = ${/RunEndReason = ([^;]+);/.exec(src("sim/survival.ts"))?.[1] ?? "?"}`);
  const hordes = src("sim/hordes.ts");
  console.log(`overrunsPlayer exempts the shelter: ${
    /SHELTER_SANCTUARY_AT/.test(hordes) ? "only while the WALL STANDS (T83)"
    : /shelterId === state.player.location\) return false/.test(hordes) ? "UNCONDITIONALLY (PL-M5-18)" : "not at all"}`);
}

// --- 2. the homesteading bot ---------------------------------------------------------------------

interface HomeRun {
  claimed: boolean; claimDay: number | null; claimNode: string | null;
  bedtimes: number; baseNoiseAtBed: number[]; hoodNoiseAtBed: number[]; maxBarricades: number;
  threatAtBed: number[]; densityAtBed: number[]; hoodWalkersAtBed: number[]; massWithin2AtBed: number[];
  stashAtEnd: number; endDay: number; end: string | null;
  nearestHordeHops: number[]; watchers: number; sieges: number; lostBase: boolean;
  fortifies: number; scrapSeen: number; turnsWithWall: number; turnsBased: number;
  siegeBeats: Record<string, number>;
  siegeRows: { type: string; pressure: number; defence: number; overflow: number; wallLost: number; stashLost: number; breached: boolean }[];
}

/** Hop distance from `from` to the nearest node in `targets` (-1 when none is reachable). */
function hopsToAny(graph: RegionGraph, from: string, targets: readonly string[]): number {
  if (targets.length === 0) return -1;
  const want = new Set(targets);
  if (want.has(from)) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length > 0) {
    d += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const adj of graph.nodes[id]?.adjacent ?? []) {
        if (seen.has(adj)) continue;
        if (want.has(adj)) return d;
        seen.add(adj); next.push(adj);
      }
    }
    frontier = next;
  }
  return -1;
}

/**
 * A bot that actually settles down: it searches a node clean, CLAIMS it, fortifies whenever it has
 * scrap, sleeps whenever the window opens, and otherwise forages out and comes home. Without a
 * policy that goes home, every shelter figure in this file would be zero for the trivial reason
 * that no bot ever claimed — an instrument reading dressed as a result (the T81 lesson).
 */
/**
 * The four probe styles. `seeker` is the one the T83 `claimable` gate forced into existence: with the
 * rule live, the greedy `normal` bot claimed in **2 of 60 runs**, because it settles whatever node it
 * happens to be standing on and the fourteen authored safehouses are somewhere else. That 3.3% would
 * have been an instrument reading dressed as a design verdict (the T81 lesson, third time). `seeker`
 * walks toward the nearest safehouse it can see and strips that one — what a player who has READ the
 * shelter line does — and is therefore the honest instrument for anything downstream of claiming.
 */
type Style = "normal" | "loud" | "quiet" | "seeker";

function homeRun(seed: string, actions: number, style: Style = "normal"): HomeRun {
  let { state, graph } = city(seed);
  const out: HomeRun = {
    claimed: false, claimDay: null, claimNode: null, bedtimes: 0, baseNoiseAtBed: [], hoodNoiseAtBed: [],
    threatAtBed: [], densityAtBed: [], hoodWalkersAtBed: [], massWithin2AtBed: [],
    maxBarricades: 0, stashAtEnd: 0, endDay: 0, end: null, nearestHordeHops: [],
    watchers: 0, sieges: 0, lostBase: false,
    fortifies: 0, scrapSeen: 0, turnsWithWall: 0, turnsBased: 0, siegeBeats: {}, siegeRows: [],
  };
  let rng = 7;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  let hadShelter = false;
  for (let i = 0; i < actions; i += 1) {
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    const sid = state.player.shelterId;
    if (sid !== null && !hadShelter) {
      hadShelter = true; out.claimed = true; out.claimDay = state.meta.day; out.claimNode = sid;
    }
    if (hadShelter && sid === null) out.lostBase = true;
    out.scrapSeen = Math.max(out.scrapSeen, state.player.inventory.filter((e) => e.type === "item.scrap").reduce((n, e) => n + e.quantity, 0));
    if (sid !== null) {
      out.turnsBased += 1;
      if ((state.nodes[sid]?.barricades ?? 0) > 0) out.turnsWithWall += 1;
      const node = state.nodes[sid];
      if (node !== undefined && node.barricades > out.maxBarricades) out.maxBarricades = node.barricades;
      // How close is the nearest mass to home, sampled once a day.
      if (state.hordes.length > 0) {
        out.nearestHordeHops.push(hopsToAny(graph, sid, state.hordes.map((h) => h.pos)));
      }
      // The brief's trigger, read at the exact moment the game offers the bed.
      if (state.player.location === sid && inSleepWindow(state.meta.hour) && prefer("sleep") !== undefined) {
        out.bedtimes += 1;
        out.baseNoiseAtBed.push(node?.noise ?? 0);
        // The neighbourhood read: the loudest node within one hop of home, INCLUDING home. The base
        // itself is the one node a settled player never searches (claiming it required stripping it),
        // so the sound of a run lives on the blocks around the door, not on the doorstep.
        out.hoodNoiseAtBed.push(Math.max(
          node?.noise ?? 0,
          ...(graph.nodes[sid]?.adjacent ?? []).map((a) => state.nodes[a]?.noise ?? 0), 0));
        const rid = graph.nodes[sid]?.regionId;
        const reg = rid === undefined ? undefined : state.regions[rid];
        out.threatAtBed.push(reg?.threat ?? 0);
        out.densityAtBed.push(reg?.zombieDensity ?? 0);
        const hood = [sid, ...(graph.nodes[sid]?.adjacent ?? [])];
        out.hoodWalkersAtBed.push(hood.reduce((n, a) => n + (state.nodes[a]?.walkers ?? 0), 0));
        // Carried mass within the horde layer's own hearing radius of home.
        const within2 = new Set<string>([sid]);
        for (const a of graph.nodes[sid]?.adjacent ?? []) {
          within2.add(a);
          for (const b of graph.nodes[a]?.adjacent ?? []) within2.add(b);
        }
        out.massWithin2AtBed.push(state.hordes.reduce((n, h) => n + (within2.has(h.pos) ? Math.trunc(h.size) : 0), 0));
      }
    }
    // `seeker`: while it has no base, head for the nearest node the content set marks claimable and
    // search only there. `graph.nodes[id].claimable` is authored data, not hidden state — it is exactly
    // what the T83 shelter line now tells the player when they stand on one.
    let seek: (typeof choices)[number] | undefined;
    if (style === "seeker" && sid === null) {
      const targets = Object.keys(graph.nodes).filter((id) => (graph.nodes[id] as { claimable?: boolean }).claimable === true);
      const here = state.player.location;
      if (!targets.includes(here)) {
        const d = hopsToAny(graph, here, targets);
        for (const c of choices) {
          if (!c.id.startsWith("move")) continue;
          const to = (c.action.params as { to?: string } | undefined)?.to;
          if (to === undefined) continue;
          if (hopsToAny(graph, to, targets) < d) { seek = c; break; }
        }
      }
    }
    const pick =
      prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("sleep")                       // bed down whenever the window is open
      ?? prefer("claim-shelter")               // settle the first clean node
      ?? seek                                  // (seeker) walk toward an authored safehouse
      ?? prefer("fortify")                     // and keep spending scrap on it
      ?? prefer("stash-deposit")
      // `quiet` still has to settle somewhere, and claiming REQUIRES searching a node clean — so it
      // searches until it has a base and never again. The first cut of this policy simply never
      // searched, which meant it never claimed, which meant it contributed ZERO samples and the A/B
      // printed a clean 0.0% that was entirely the instrument (the T81 probe-defect lesson).
      ?? (style === "quiet" && sid !== null ? undefined : prefer("search"))
      ?? (style === "quiet" ? prefer("rest") : undefined)
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    const before = state;
    if (pick.id.startsWith("fortify")) out.fortifies += 1;
    state = applyAction(state, pick.action, graph).state;
    for (const e of state.history.slice(before.history.length)) {
      if (e.type.startsWith("siege.") || e.type === "shelter.abandoned") {
        out.siegeBeats[e.type] = (out.siegeBeats[e.type] ?? 0) + 1;
        if (e.type !== "siege.passed" && e.type !== "shelter.abandoned") out.sieges += 1;
        if (e.type.startsWith("siege.")) out.siegeRows.push({ type: e.type, ...(e.data as Record<string, never>) } as never);
      }
    }
    if (state === before) break;
  }
  out.endDay = state.meta.day;
  out.end = runEndReason(state);
  out.stashAtEnd = stashUnits(state.player.stash);
  return out;
}

function home(): void {
  const style = (process.env["T83_STYLE"] as Style | undefined) ?? "seeker";
  console.log(`tree: ${TREE} · ${RUNS} \`${style}\` bot runs, ${ACTIONS} actions each\n`);
  const runs: HomeRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(homeRun(`t83-home-${i}`, ACTIONS, style));
  const claimed = runs.filter((r) => r.claimed);
  console.log(`runs that claimed a shelter      ${claimed.length}/${runs.length} (${pct(claimed.length / runs.length)})`);
  if (claimed.length > 0) {
    console.log(`  mean claim day                 ${f1(mean(claimed.map((r) => r.claimDay ?? 0)))}`);
    console.log(`  distinct nodes claimed         ${new Set(claimed.map((r) => r.claimNode)).size}`);
    console.log(`  mean peak barricades           ${f1(mean(claimed.map((r) => r.maxBarricades)))}`);
    console.log(`  mean nights bedded down        ${f1(mean(claimed.map((r) => r.bedtimes)))}`);
    console.log(`  runs that LOST the base        ${claimed.filter((r) => r.lostBase).length}`);
  }
  const beats: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.siegeBeats)) beats[k] = (beats[k] ?? 0) + v;
  console.log(`  mean fortify actions taken     ${f1(mean(claimed.map((r) => r.fortifies)))}`);
  console.log(`  peak scrap carried (mean)      ${f1(mean(runs.map((r) => r.scrapSeen)))}`);
  const based = runs.reduce((n, r) => n + r.turnsBased, 0);
  const walled = runs.reduce((n, r) => n + r.turnsWithWall, 0);
  console.log(`  based turns with ANY wall      ${walled}/${based}  ${pct(based === 0 ? 0 : walled / based)}`);
  console.log(`  siege beats                    ${JSON.stringify(beats)}`);
  console.log(`mean end day                     ${f1(mean(runs.map((r) => r.endDay)))}`);
  const ends: Record<string, number> = {};
  for (const r of runs) ends[r.end ?? "(alive)"] = (ends[r.end ?? "(alive)"] ?? 0) + 1;
  console.log(`run ends                         ${JSON.stringify(ends)}`);
}

// --- 3. the trigger: noise a base actually carries ------------------------------------------------

function noise(): void {
  console.log(`tree: ${TREE} · style \`${(process.env["T83_STYLE"] as Style | undefined) ?? "normal"}\` · the brief's trigger, measured: "accumulated NodeState.noise at the shelter"\n`);
  // Defaults to `normal` — the style this table's published figures were derived from, and the right
  // one for the question: what does a base a player SETTLED IN carry? An earlier cut hard-coded
  // `seeker` here while the module header quoted the `normal` numbers, so the cited command printed
  // different figures from the ones it was cited for. Overridable with T83_STYLE.
  const style = (process.env["T83_STYLE"] as Style | undefined) ?? "normal";
  const runs: HomeRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(homeRun(`t83-home-${i}`, ACTIONS, style));
  const all = runs.flatMap((r) => r.baseNoiseAtBed);
  console.log(`bedtimes observed                ${all.length} across ${runs.filter((r) => r.bedtimes > 0).length} runs`);
  if (all.length === 0) { console.log("  (no bedtime ever reached — nothing to read)"); return; }
  const sorted = [...all].sort((a, b) => a - b);
  console.log(`base noise at bedtime  min       ${sorted[0]}`);
  console.log(`                       median    ${sorted[Math.floor(sorted.length / 2)]}`);
  console.log(`                       max       ${sorted[sorted.length - 1]}`);
  console.log(`                       mean      ${f1(mean(all))}`);
  for (const t of [1, 10, 20, 30, 50]) {
    const n = all.filter((x) => x >= t).length;
    console.log(`  bedtimes with noise >= ${String(t).padStart(2)}      ${String(n).padStart(5)}  ${pct(n / all.length)}`);
  }
  // The alternative read: the loudest node within one hop of home. A settled player never searches
  // their own base (claiming it required stripping it clean), so the sound of a run lives NEXT DOOR.
  const hood = runs.flatMap((r) => r.hoodNoiseAtBed);
  const hs = [...hood].sort((a, b) => a - b);
  console.log(`\nloudest node within 1 hop of home, at bedtime:`);
  console.log(`  min / median / max             ${hs[0]} / ${hs[Math.floor(hs.length / 2)]} / ${hs[hs.length - 1]}`);
  console.log(`  mean                           ${f1(mean(hood))}`);
  for (const t of [10, 20, 25, 30, 50]) {
    const n = hood.filter((x) => x >= t).length;
    console.log(`  bedtimes with hood >= ${String(t).padStart(2)}       ${String(n).padStart(5)}  ${pct(n / hood.length)}`);
  }
  console.log(`\n(REPATH_NOISE, the bar a node must clear to redirect a horde, is ${String(ENGINE["REPATH_NOISE"])})`);

  // The quantities that DO have range at the same instant — the candidates a trigger can actually read.
  const col = (xs: number[], label: string): void => {
    if (xs.length === 0) return;
    const s2 = [...xs].sort((a, b) => a - b);
    console.log(`  ${label.padEnd(34)} min ${String(s2[0]).padStart(3)} · median ${String(s2[Math.floor(s2.length / 2)]).padStart(3)} · max ${String(s2[s2.length - 1]).padStart(3)} · mean ${f1(mean(xs))}`);
  };
  console.log(`\nwhat else is true at the same bedtime:`);
  col(runs.flatMap((r) => r.threatAtBed), "home region threat");
  col(runs.flatMap((r) => r.densityAtBed), "home region zombieDensity");
  col(runs.flatMap((r) => r.hoodWalkersAtBed), "walkers on home + neighbours");
  col(runs.flatMap((r) => r.massWithin2AtBed), "carried horde mass within 2 hops");
}

// --- 4b. the bill: does LOUD play actually pull a mass toward home? --------------------------------

/**
 * The brief's thesis sentence — "this is the task that makes noise the Survival Triangle's bill for a
 * run of loud, fast play" — stated as a testable claim and then tested. `loud` searches every node it
 * stands on; `quiet` never searches at all and rests instead. If the two produce the same distance
 * from home to the nearest mass, the bill does not exist yet and this task has to BUILD the pull
 * rather than inherit it.
 */
function bill(): void {
  console.log(`tree: ${TREE} · does loud play pull a mass toward the base? ${RUNS} runs a style\n`);
  for (const style of ["loud", "quiet"] as const) {
    const runs: HomeRun[] = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(homeRun(`t83-bill-${i}`, ACTIONS, style));
    const hops = runs.flatMap((r) => r.nearestHordeHops).filter((d) => d >= 0);
    const hood = runs.flatMap((r) => r.hoodNoiseAtBed);
    const near1 = hops.filter((d) => d <= 1).length;
    console.log(`  ${style.padEnd(6)} samples ${String(hops.length).padStart(5)} · mean hops ${f1(mean(hops))} · <=1 hop ${pct(hops.length === 0 ? 0 : near1 / hops.length)} · mean hood noise ${f1(mean(hood))} · mean end day ${f1(mean(runs.map((r) => r.endDay)))}`);
  }
}

// --- 4. how close does a mass come to home? -------------------------------------------------------

function near(): void {
  console.log(`tree: ${TREE} · style \`${(process.env["T83_STYLE"] as Style | undefined) ?? "seeker"}\` · hop distance from a claimed base to the nearest mass\n`);
  const style = (process.env["T83_STYLE"] as Style | undefined) ?? "seeker";
  const runs: HomeRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(homeRun(`t83-home-${i}`, ACTIONS, style));
  const all = runs.flatMap((r) => r.nearestHordeHops).filter((d) => d >= 0);
  if (all.length === 0) { console.log("  (no run ever held a base while a mass existed)"); return; }
  console.log(`samples                          ${all.length}`);
  console.log(`min hops ever                    ${Math.min(...all)}`);
  console.log(`mean hops                        ${f1(mean(all))}`);
  for (const d of [0, 1, 2, 3, 4]) {
    const n = all.filter((x) => x <= d).length;
    console.log(`  samples with a mass <= ${d} hop(s)  ${String(n).padStart(5)}  ${pct(n / all.length)}`);
  }
}

// --- 5. bot play ----------------------------------------------------------------------------------

function play(): void {
  console.log(`tree: ${TREE} · ${RUNS} bot runs per policy\n`);
  for (const label of ["homesteader"] as const) {
    const runs: HomeRun[] = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(homeRun(`t83-play-${i}`, ACTIONS));
    const ends: Record<string, number> = {};
    for (const r of runs) ends[r.end ?? "(alive)"] = (ends[r.end ?? "(alive)"] ?? 0) + 1;
    console.log(`  ${label}: mean end day ${f1(mean(runs.map((r) => r.endDay)))} · claimed ${runs.filter((r) => r.claimed).length}/${runs.length} · lost base ${runs.filter((r) => r.lostBase).length} · ends ${JSON.stringify(ends)}`);
  }
}

/**
 * The distribution the dials are set from: every night this system resolved, what pressed, what stood
 * against it, and what it cost. Written BEFORE the constants were chosen, not after (the T79 lesson:
 * never write a measured table before measuring it).
 */
function siege(): void {
  const style = (process.env["T83_STYLE"] as Style | undefined) ?? "seeker";
  const runs: HomeRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(homeRun(`t83-home-${i}`, ACTIONS, style));
  const rows = runs.flatMap((r) => r.siegeRows);
  console.log(`tree: ${TREE} · ${RUNS} \`${style}\` runs · ${rows.length} nights resolved\n`);
  if (rows.length === 0) { console.log("  (no night ever resolved)"); return; }
  const by: Record<string, number> = {};
  for (const r of rows) by[r.type] = (by[r.type] ?? 0) + 1;
  for (const [k, v] of Object.entries(by).sort()) console.log(`  ${k.padEnd(16)} ${String(v).padStart(4)}  ${pct(v / rows.length)}`);
  const col = (label: string, xs: number[]): void => {
    if (xs.length === 0) { console.log(`  ${label.padEnd(22)} (none)`); return; }
    const q = [...xs].sort((a, b) => a - b);
    console.log(`  ${label.padEnd(22)} min ${String(q[0]).padStart(3)} · median ${String(q[Math.floor(q.length / 2)]).padStart(3)} · max ${String(q[q.length - 1]).padStart(3)} · mean ${f1(mean(xs))}`);
  };
  console.log();
  col("pressure", rows.map((r) => r.pressure));
  col("defence", rows.map((r) => r.defence));
  const landed = rows.filter((r) => r.type !== "siege.passed");
  col("overflow (landed)", landed.map((r) => r.overflow));
  col("cache units lost", landed.map((r) => r.stashLost));
  console.log(`\n  landed nights that BREACHED    ${landed.filter((r) => r.breached).length}/${landed.length}`);
}

// --- 6. the wall, on a fixture ---------------------------------------------------------------------

/**
 * What a night costs at a PINNED wall and a PINNED mass — the question bot play cannot answer, because
 * no bot on the shipped economy ever fortifies (peak scrap carried averages 0.3 units a run). Resolved
 * through `tickSiege` on a two-node fixture rather than through the pipeline, for the `measure/t80.ts`
 * reason: the question is what ONE night costs, and routing it through fourteen stages would mix the
 * world's drift, needs and events into the answer.
 *
 * Each cell is `SIEGE_RUNS` seeds of one night: the share that breached, and the mean cache units lost.
 */
function wall(): void {
  const tickSiege = ENGINE["tickSiege"] as ((s: GameState, g: RegionGraph, h: number, n: number) => GameState) | undefined;
  if (tickSiege === undefined) { console.log(`tree: ${TREE} — no siege to measure`); return; }
  const REGIONS = [{ id: "region.s", name: "Siege", description: "a fixture", baseline: { zombieDensity: 46, threat: 40 } }];
  const NODES = [
    { id: "node.s.home", regionId: "region.s", name: "Home", description: "here", adjacent: ["node.s.near"], start: true },
    { id: "node.s.near", regionId: "region.s", name: "Near", description: "there", adjacent: ["node.s.home"] },
  ];
  const SEEDS = Number(process.env["T83_SIEGE_RUNS"] ?? 200);
  console.log(`tree: ${TREE} · one night, ${SEEDS} seeds a cell · rows = barricades, cols = mass within earshot\n`);
  console.log(`  wall  ${[0, 20, 40, 80, 120].map((m) => `mass ${String(m).padStart(3)}`.padStart(18)).join("")}`);
  for (const b of [0, 25, 50, 75, 100]) {
    const cells: string[] = [];
    for (const m of [0, 20, 40, 80, 120]) {
      let breached = 0;
      let lost = 0;
      let landed = 0;
      for (let i = 0; i < SEEDS; i += 1) {
        const { state, graph } = startRun({ seed: `t83-wall-${b}-${m}-${i}`, createdAt: "2026-09-14T00:00:00.000Z" }, REGIONS as never, NODES as never);
        const home = "node.s.home";
        let st: GameState = {
          ...state,
          // The player is AWAY. A base you are standing in has `SIEGE_PLAYER_DEFENCE` in the doorway
          // and is the easy case; the question this table exists to answer is what happens to the
          // house you left behind, which is the case bot play produces almost all of the time.
          player: { ...state.player, shelterId: home, location: "node.s.near", stash: [{ type: "item.canned-food", quantity: 10 }] as never },
          nodes: { ...state.nodes, [home]: { ...state.nodes[home]!, barricades: b } },
          meta: { ...state.meta, hour: 21 },
          ...(m > 0 ? { hordes: [{ id: "horde.1", size: m, pos: "node.s.near", dest: null, speed: 1, awareness: 2, types: [] }] as never } : {}),
        };
        const before = stashUnits(st.player.stash);
        st = tickSiege(st, graph, 21, SIEGE_HOURS);
        const beat = st.history.filter((e) => e.type.startsWith("siege."));
        if (beat.length === 0) continue;
        const last = beat[beat.length - 1]!;
        if (last.type !== "siege.passed") landed += 1;
        if ((last.data as { breached?: boolean }).breached === true) breached += 1;
        lost += before - stashUnits(st.player.stash);
      }
      cells.push(`${landed}/${SEEDS} ${pct(breached / SEEDS).trim()} ${f1(lost / SEEDS).trim()}`.padStart(18));
    }
    console.log(`  ${String(b).padStart(4)}  ${cells.join("")}`);
  }
  console.log(`\n  each cell: nights that LANDED / nights rolled · share BREACHED · mean cache units lost`);
}

const SIEGE_HOURS = (ENGINE["SIEGE_HOURS_PER_NIGHT"] as number | undefined) ?? 6;

/**
 * Does the party make the base safer, or does it make the party safe? Every body at the base adds
 * `SIEGE_COMPANION_DEFENCE` to what stands, which SUBTRACTS from the overflow that the fatal threshold
 * reads — so a bigger party is monotonically less likely to lose anyone, and past some size the loss
 * becomes arithmetically unreachable. That is the T82 `COMPANION_FATAL_BURDEN` lesson ("a party you
 * cannot lose is recruiting-is-free again") arriving in a second system, and this is the probe that
 * catches it. Rows are party size; the cell is the share of nights that killed someone.
 */
function party(): void {
  const tickSiege = ENGINE["tickSiege"] as ((s: GameState, g: RegionGraph, h: number, n: number) => GameState) | undefined;
  if (tickSiege === undefined) { console.log(`tree: ${TREE} — no siege to measure`); return; }
  const REGIONS = [{ id: "region.s", name: "Siege", description: "a fixture", baseline: { zombieDensity: 46, threat: 40 } }];
  const NODES = [
    { id: "node.s.home", regionId: "region.s", name: "Home", description: "here", adjacent: ["node.s.near"], start: true },
    { id: "node.s.near", regionId: "region.s", name: "Near", description: "there", adjacent: ["node.s.home"] },
  ];
  const SEEDS = Number(process.env["T83_SIEGE_RUNS"] ?? 200);
  const MASSES = [40, 80, 120];
  console.log(`tree: ${TREE} · one night, player AWAY, ${SEEDS} seeds a cell · rows = party at the base
`);
  console.log(`  party ${MASSES.map((m) => `mass ${String(m).padStart(3)}`.padStart(16)).join("")}`);
  for (const n of [0, 1, 2, 3]) {
    const cells: string[] = [];
    for (const m of MASSES) {
      let died = 0;
      let landed = 0;
      for (let i = 0; i < SEEDS; i += 1) {
        const { state, graph } = startRun({ seed: `t83-party-${n}-${m}-${i}`, createdAt: "2026-09-14T00:00:00.000Z" }, REGIONS as never, NODES as never);
        const home = "node.s.home";
        const actors: Record<string, unknown> = { ...state.actors };
        for (let k = 0; k < n; k += 1) {
          actors[`npc.${k}`] = {
            id: `npc.${k}`, type: "npc.fixture", name: `p${k}`, trust: 80,
            condition: { needs: { hunger: 10, thirst: 10, fatigue: 10 }, wounds: [], infection: { progression: 0, stage: "none" }, mind: { stress: 0, morale: 60 } },
            location: home, groupId: null, relationships: {}, inventory: [], flags: { companion: true },
          };
        }
        let st: GameState = {
          ...state,
          actors: actors as never,
          player: { ...state.player, shelterId: home, location: "node.s.near", stash: [{ type: "item.canned-food", quantity: 20 }] as never },
          meta: { ...state.meta, hour: 21 },
          hordes: [{ id: "horde.1", size: m, pos: "node.s.near", dest: null, speed: 1, awareness: 2, types: [] }] as never,
        };
        const before = Object.keys(st.actors).length;
        st = tickSiege(st, graph, 21, SIEGE_HOURS);
        const beat = st.history.filter((e) => e.type.startsWith("siege."));
        if (beat.length > 0 && beat[beat.length - 1]!.type !== "siege.passed") landed += 1;
        if (Object.keys(st.actors).length < before) died += 1;
      }
      cells.push(`${landed}/${SEEDS} lost ${pct(died / SEEDS).trim()}`.padStart(16));
    }
    console.log(`  ${String(n).padStart(5)} ${cells.join("")}`);
  }
  console.log(`
  each cell: nights that LANDED / nights rolled · share that killed a defender`);
}

const arg = process.argv[2];
if (arg === "--home") home();
else if (arg === "--noise") noise();
else if (arg === "--near") near();
else if (arg === "--bill") bill();
else if (arg === "--siege") siege();
else if (arg === "--wall") wall();
else if (arg === "--party") party();
else if (arg === "--play") play();
else structure();
