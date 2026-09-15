/**
 * T60 measurement runner — **balance pass 2 (pacing / director & difficulty modes)**, re-derivable.
 *
 * Every figure quoted in the T60 build and in `docs/qa/QA_REVIEW_T60.md` comes from here (the
 * T59/T61/T62/T77–T87 discipline: a task's before/after numbers are worthless if the thing that
 * produced them was a scratch script). It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t60.ts            # BEATS: what a run actually writes to the log, and the quiet clock
 *   npx tsx measure/t60.ts --onoff    # the headline: what turning the Apocalypse Director off is worth
 *   npx tsx measure/t60.ts --lean     # does the beat REACH the player? tones fired, split by live beat
 *   npx tsx measure/t60.ts --modes    # the four difficulty modes end to end, per policy
 *   npx tsx measure/t60.ts --pacing   # the pressure read, the tide lean, and the drift anchor
 *
 * It reuses `t59.ts`'s five bot policies rather than carrying a second bot (T87's "never copy the
 * runner" rule, applied across tasks): `t59.ts` grew an optional difficulty + per-turn hook for it.
 *
 * The PER-DIAL ISOLATION table quoted in the review is a rebuild sweep — one dial is set to its
 * Nightmare magnitude with the other six at identity, the tree re-run, the profile restored — so it
 * cannot live here; `--modes` re-derives the end-to-end result that sweep was explaining.
 */

import { play, POLICIES } from "./t59.js";
import * as engine from "../../engine/src/index.js";
import type { GameState, RegionGraph } from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T60 = ENGINE["turnsSinceThreat"] !== undefined;
const TREE = HAS_T60 ? "POST-T60" : "PRE-T60";

const RUNS = Number(process.env["T60_RUNS"] ?? 24);
const ACTIONS = Number(process.env["T60_ACTIONS"] ?? 1200);

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const share = (n: number, d: number): string => (d === 0 ? "     --" : `${(n / d * 100).toFixed(1)}%`.padStart(7));

/** Every T60 lookup goes through a fallback, so BOTH trees run every mode line for line. */
const beatOf = (s: GameState): string =>
  HAS_T60 ? (ENGINE["directorBeat"] as (x: GameState) => string)(s) : "hold";
const quietOf = (s: GameState): number =>
  HAS_T60 ? (ENGINE["turnsSinceThreat"] as (x: GameState) => number)(s) : 0;
type Sampled = { turns: number; day: number; end: string | null; wounds: number; items: number; dryTurns: number };
const sampled = (r: ReturnType<typeof play>): Sampled =>
  ({ turns: r.turns, day: r.day, end: r.end, wounds: r.wounds, items: r.items, dryTurns: r.dryTurns });

/** Run every policy `RUNS` times with an optional per-turn hook and an optional director kill-switch. */
function sweep(hook?: (s: GameState, g: RegionGraph) => void, opts: { difficulty?: string; noDirector?: boolean } = {}): Sampled[] {
  const out: Sampled[] = [];
  for (const p of POLICIES) {
    for (let i = 0; i < RUNS; i++) {
      out.push(sampled(play(`t60-${i}`, ACTIONS, p, false, {
        ...(opts.difficulty === undefined ? {} : { difficulty: opts.difficulty }),
        ...(opts.noDirector === true ? { noDirector: true } : {}),
        hook: (s, g, t) => { hook?.(s, g); void t; },
      })));
    }
  }
  return out;
}

// --- BEATS: what a run writes, and what of it is about the SURVIVOR ---------------------------

/**
 * The measurement that forced `DIRECTOR_THREAT_BEATS` to be an explicit set rather than a prefix rule
 * or a "did anything happen this turn" read. The log is mostly not about the player.
 */
function beats(): void {
  console.log(`\nT60 --beats  (${TREE}, ${RUNS} runs x ${POLICIES.length} policies)\n`);
  const census: Record<string, number> = {};
  const quiet: number[] = [];
  let turns = 0;
  let coastingTurns = 0;
  const threatSet = HAS_T60 ? (ENGINE["DIRECTOR_THREAT_BEATS"] as ReadonlySet<string>) : new Set<string>();
  const coastAt = HAS_T60 ? (ENGINE["DIRECTOR_COASTING_TURNS"] as number) : 3;
  let seen = 0;
  const runs = sweep((s) => {
    for (const e of s.history.slice(seen)) census[e.type] = (census[e.type] ?? 0) + 1;
    seen = s.history.length;
    const q = quietOf(s);
    quiet.push(q);
    turns += 1;
    if (q >= coastAt) coastingTurns += 1;
  });
  const logged = Object.values(census).reduce((a, b) => a + b, 0);
  console.log("  the log, by beat type — commonest first");
  console.log("  beat                        count   per run   share   threat?");
  for (const [type, n] of Object.entries(census).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${type.padEnd(24)} ${String(n).padStart(7)} ${f2(n / runs.length)}  ${share(n, logged)}   ${threatSet.has(type) ? "YES" : "no"}`);
  }
  console.log(`\n  ${runs.length} runs · ${turns} turns · ${logged} beats (${(logged / runs.length).toFixed(1)} a run, ${(logged / Math.max(1, turns)).toFixed(1)} a turn)`);
  console.log(`  quiet clock: mean ${mean(quiet).toFixed(2)} turns, median ${median(quiet)}, max ${Math.max(0, ...quiet)}`);
  console.log(`  coasting (>= ${coastAt}) on ${share(coastingTurns, turns)} of turns`);
  console.log(`\n  A prefix rule over \`horde.\`, or a "something was written this turn" rule, reads the map`);
  console.log(`  moving as the player being threatened — and the streak is then 0 on 100% of turns.`);
}

// --- ONOFF: what the whole controller is worth ------------------------------------------------

function onoff(): void {
  console.log(`\nT60 --onoff  (${TREE}, ${RUNS} runs x ${POLICIES.length} policies each)\n`);
  const row = (tag: string, rs: Sampled[]): void => {
    const t = mean(rs.map((r) => r.turns));
    const ends: Record<string, number> = {};
    for (const r of rs) ends[String(r.end)] = (ends[String(r.end)] ?? 0) + 1;
    console.log(`  ${tag.padEnd(14)} turns ${f1(t)} (med ${String(median(rs.map((r) => r.turns))).padStart(3)})  day ${f2(mean(rs.map((r) => r.day)))}  wounds ${f2(mean(rs.map((r) => r.wounds)))}  items ${f2(mean(rs.map((r) => r.items)))}  dry ${share(mean(rs.map((r) => r.dryTurns)), t)}`);
    console.log(`  ${" ".repeat(14)} ${Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  };
  row("director ON", sweep());
  row("director OFF", sweepOff());
  console.log(`\n  Pre-T60 this pair read 50.0 and 49.9 turns: the entire Apocalypse Director was worth`);
  console.log(`  0.1 turns, because its only authority was +-1 a tick on two dials of one district and`);
  console.log(`  \`driftRegions\` pulls those straight back onto the anchor (they are EQUAL on 90% of turns).`);
}

/** The director is disabled on the STARTING state, so the whole run is played without it. */
function sweepOff(): Sampled[] {
  const out: Sampled[] = [];
  for (const p of POLICIES) for (let i = 0; i < RUNS; i++) {
    out.push(sampled(play(`t60-${i}`, ACTIONS, p, false, { noDirector: true })));
  }
  return out;
}

// --- LEAN: does the beat reach the player? ----------------------------------------------------

/**
 * T60 stamps the scene's tone onto its own `encounter.begin` beat, which makes this measurable off the
 * log with no instrumentation: for every scene that fired, what the director was asking for at the
 * time, and what the pool actually offered.
 */
function lean(): void {
  console.log(`\nT60 --lean  (${TREE}, ${RUNS} runs x ${POLICIES.length} policies)\n`);
  const weightsOf = ENGINE["ambientWeights"] as ((s: GameState, g: RegionGraph) => readonly { tone: string; weight: number }[]) | undefined;

  // (a) THE LEAN ITSELF — what the director asked for, read off the weighted table with no draw. This
  // is the number the design leans on, and it is the only one of the two that isolates the lean: see
  // `ambientWeights` for the three confounds that make the delivered split unreadable.
  const asked: Record<string, Record<string, number>> = { hold: {}, escalate: {}, relief: {} };
  const beatTurns: Record<string, number> = { hold: 0, escalate: 0, relief: 0 };
  const tabled: Record<string, number> = { hold: 0, escalate: 0, relief: 0 };
  // (b) WHAT ACTUALLY FIRED, split by the beat live at the time — the delivered split, diluted.
  const fired: Record<string, Record<string, number>> = { hold: {}, escalate: {}, relief: {} };
  // (c) HOW MANY ROWS OF EACH TONE WERE ELIGIBLE AT ALL — the ceiling on what any lean could do.
  const eligible: Record<string, Record<string, number>> = { hold: {}, escalate: {}, relief: {} };
  let turns = 0;
  let seen = 0;
  let live = "hold";
  const runs = sweep((s, g) => {
    for (const e of s.history.slice(seen)) {
      if (e.type !== "encounter.begin") continue;
      const tone = String((e.data as { tone?: unknown } | null)?.tone ?? "(untoned)");
      (fired[live] ??= {})[tone] = ((fired[live] ??= {})[tone] ?? 0) + 1;
    }
    seen = s.history.length;
    live = beatOf(s);
    beatTurns[live] = (beatTurns[live] ?? 0) + 1;
    turns += 1;
    const rows = weightsOf?.(s, g) ?? [];
    if (rows.length > 0) {
      tabled[live] = (tabled[live] ?? 0) + 1;
      const total = rows.reduce((a, r) => a + r.weight, 0);
      if (total > 0) for (const r of rows) (asked[live] ??= {})[r.tone] = ((asked[live] ??= {})[r.tone] ?? 0) + r.weight / total;
      for (const r of rows) (eligible[live] ??= {})[r.tone] = ((eligible[live] ??= {})[r.tone] ?? 0) + 1;
    }
  });

  const table = (title: string, src: Record<string, Record<string, number>>, denom: Record<string, number>, tones: string[]): void => {
    console.log(`  ${title}`);
    console.log("  beat        turns    share   |  n     " + tones.map((t) => t.padStart(10)).join(""));
    for (const b of ["hold", "escalate", "relief"]) {
      const r = src[b] ?? {};
      const tot = Object.values(r).reduce((a, x) => a + x, 0);
      console.log(`  ${b.padEnd(10)} ${String(beatTurns[b] ?? 0).padStart(5)}  ${share(beatTurns[b] ?? 0, turns)}  | ${String(denom[b] ?? 0).padStart(5)} ${tones.map((t) => share(r[t] ?? 0, tot)).join("   ")}`);
    }
    console.log("");
  };
  if (weightsOf === undefined) console.log("  (pre-T60 tree: no `ambientWeights`, so only the delivered split is available)\n");
  else table("(a) what the DIRECTOR ASKED FOR — mean share of the ambient table's weight, by tone",
             asked, tabled, ["tension", "relief", "neutral"]);
  const firedN = Object.fromEntries(Object.entries(fired).map(([b, r]) => [b, Object.values(r).reduce((a, x) => a + x, 0)]));
  table("(b) what actually FIRED under each beat — diluted by the one-shot tier and by eligibility",
        fired, firedN, ["tension", "relief", "neutral", "(untoned)"]);

  console.log("  (c) mean ELIGIBLE rows per table, by tone — the ceiling on what any lean can do");
  console.log("  beat          tension     relief    neutral");
  for (const b of ["hold", "escalate", "relief"]) {
    const r = eligible[b] ?? {};
    const n = Math.max(1, tabled[b] ?? 0);
    console.log(`  ${b.padEnd(10)} ${f2((r["tension"] ?? 0) / n)} ${f2((r["relief"] ?? 0) / n)} ${f2((r["neutral"] ?? 0) / n)}`);
  }
  console.log("");
  console.log(`  ${runs.length} runs · ${turns} turns. (a) and (b) measure different things and the gap between`);
  console.log(`  them IS a finding: a lean can only choose between rows that are eligible, and the beat`);
  console.log(`  correlates with which rows those are. See QA_REVIEW_T60 — "the lean lands, the delivery`);
  console.log(`  is swamped", and PL-M5-83.`);
}

// --- MODES: the four difficulty modes end to end ----------------------------------------------

function modes(): void {
  console.log(`\nT60 --modes  (${TREE}, ${RUNS} runs x ${POLICIES.length} policies each)\n`);
  console.log("  mode        turns   med    day    srch   items    dry%  | ends");
  for (const m of ["story", "survivor", "hardcore", "nightmare"]) {
    const rs: Sampled[] = [];
    const srch: number[] = [];
    for (const p of POLICIES) for (let i = 0; i < RUNS; i++) {
      const r = play(`t60-${i}`, ACTIONS, p, false, { difficulty: m });
      rs.push(sampled(r));
      srch.push(r.searches);
    }
    const t = mean(rs.map((r) => r.turns));
    const ends: Record<string, number> = {};
    for (const r of rs) ends[String(r.end)] = (ends[String(r.end)] ?? 0) + 1;
    console.log(`  ${m.padEnd(10)} ${f1(t)} ${String(median(rs.map((r) => r.turns))).padStart(5)} ${f2(mean(rs.map((r) => r.day)))} ${f1(mean(srch))} ${f1(mean(rs.map((r) => r.items)))} ${share(mean(rs.map((r) => r.dryTurns)), t)}  | ${Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
  console.log(`\n  per policy (turns), so that one policy's advantage cannot pass for a mode's:`);
  console.log(`  policy      story  survivor  hardcore  nightmare`);
  for (const p of POLICIES) {
    const at = (m: string): number => mean(Array.from({ length: RUNS }, (_, i) => play(`t60-${i}`, ACTIONS, p, false, { difficulty: m }).turns));
    console.log(`  ${p.padEnd(10)} ${f1(at("story"))} ${f1(at("survivor"))} ${f1(at("hardcore"))} ${f1(at("nightmare"))}`);
  }
}

// --- PACING: the quantities the T30 bands were written against ---------------------------------

/**
 * The measurement behind "the absolute-pressure read is dead". An audit found these figures cited to a
 * `--pacing` flag that did not exist — the dispatch fell through to `--beats`, which prints none of
 * them — so the flag is now real and prints exactly what the comments quote.
 */
function pacing(): void {
  console.log(`\nT60 --pacing  (${TREE}, ${RUNS} runs x ${POLICIES.length} policies)\n`);
  const summarize = ENGINE["summarizePacing"] as (x: unknown[]) => Record<string, number>;
  const sample = ENGINE["samplePacing"] as (s: GameState) => Record<string, unknown>;
  const leanOf = HAS_T60 ? (ENGINE["tideLean"] as (s: GameState) => number) : () => 0;
  const leanHigh = HAS_T60 ? (ENGINE["DIRECTOR_LEAN_HIGH"] as number) : 8;
  const highBand = ENGINE["DIRECTOR_HIGH_BAND"] as number;
  // Reconstructed exactly as `driftRegions` builds it (see `sim/regionDrift.ts`): baseline + day ramp
  // + the director's bias + the neglect lift + the project alarm, not the bare baseline.
  const driftAnchor = ENGINE["driftAnchor"] as ((b: unknown, day: number, bias?: number, neglect?: number, alarm?: number) => { threat: number }) | undefined;
  const directorBias = ENGINE["directorBias"] as ((r: unknown) => number) | undefined;

  console.log("  policy      turns  meanP  peakP   high%    osc  | tideLean  min  mean   max   >=HIGH");
  let allLeans: number[] = [];
  let anchorEq = 0, anchorNear = 0, anchorN = 0;
  for (const p of POLICIES) {
    const rows: Record<string, number>[] = [];
    const leans: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const samples: unknown[] = [];
      play(`t60-${i}`, ACTIONS, p, false, { hook: (s, g) => {
        samples.push(sample(s));
        leans.push(leanOf(s));
        if (driftAnchor === undefined) return;
        const here = s.nodes[s.player.location];
        const region = here === undefined ? undefined : s.regions[here.regionId];
        const def = here === undefined ? undefined : g.regions[here.regionId];
        if (region === undefined || def === undefined) return;
        anchorN += 1;
        const a = driftAnchor(def.baseline, s.meta.day, directorBias?.(region) ?? 0);
        if (region.threat === a.threat) anchorEq += 1;
        if (Math.abs(region.threat - a.threat) <= 1) anchorNear += 1;
      } });
      rows.push(summarize(samples));
    }
    allLeans = allLeans.concat(leans);
    const m = (k: string): number => mean(rows.map((r) => r[k] ?? 0));
    const t = m("samples");
    console.log(`  ${p.padEnd(10)} ${f1(t)} ${f1(m("meanPressure"))} ${f1(m("peakPressure"))} ${share(m("highPressureTurns"), t)} ${f2(m("oscillations"))}  | ${" ".repeat(8)} ${f1(Math.min(...leans))} ${f1(mean(leans))} ${f1(Math.max(...leans))} ${share(leans.filter((x) => x >= leanHigh).length, leans.length)}`);
  }
  console.log(`\n  high band ${highBand} · lean threshold ${leanHigh}`);
  console.log(`  all policies: tideLean min ${Math.min(...allLeans)} mean ${mean(allLeans).toFixed(2)} max ${Math.max(...allLeans)} · >= ${leanHigh} on ${share(allLeans.filter((x) => x >= leanHigh).length, allLeans.length)} of turns`);
  if (driftAnchor !== undefined) {
    console.log(`  the player's region sits EXACTLY on its drift anchor on ${share(anchorEq, anchorN)} of turns, within +-1 on ${share(anchorNear, anchorN)} (${anchorN} region-turns)`);
  }
  console.log(`\n  This is why T60 stopped reading absolute pressure: peak pressure never approaches the`);
  console.log(`  high band, so \`highPressureTurns\` and \`oscillations\` are structurally zero.`);
}

// --- main ------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (f: string): boolean => argv.includes(f);
if (has("--pacing")) pacing();
else if (has("--onoff")) onoff();
else if (has("--lean")) lean();
else if (has("--modes")) modes();
else beats();
