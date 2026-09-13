/**
 * T78 measurement runner — the numbers quoted in `sim/director.ts`, `sim/regionDrift.ts`,
 * `sim/timeOfDay.ts` and `docs/qa/QA_REVIEW_T78.md`, re-derivable on demand (the T77 discipline:
 * a task's before/after figures are worthless if the thing that produced them was a scratch script).
 * Two figures in `sim/director.ts` are marked as the FIRST CUT's (the dial-nudge-only tree the bias
 * replaced) and are not re-derivable from any shipped tree; everything else here is.
 *
 * It is a measurement tool, not a test — it asserts nothing and CI does not run it. It plays the
 * **shipped city** (`content/`), not a fixture, because every number worth quoting is a statement
 * about the real content.
 *
 *   npx tsx measure/t78.ts               # off-screen drift: 30 idle days, every region vs its baseline
 *   npx tsx measure/t78.ts --director    # the director's beat census under play, and what "distressed" means
 *   npx tsx measure/t78.ts --onoff       # the T30 DoD re-measured: disabling the director still changes pacing
 *   npx tsx measure/t78.ts --ramp        # an immortal idle run over 40 days: does day 40 differ from day 2?
 *   npx tsx measure/t78.ts --tide        # how far the diurnal threat tide actually swings (PL-M5-09)
 *
 * The policies are deliberately crude and deliberately *bad* at the game (the `measure/t77.ts`
 * discipline). Read the figures as a probe of the SYSTEMS, never as a model of skilled play.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceClock,
  advanceWorld,
  applyAction,
  availableActions,
  directorBeat,
  isRunOver,
  isSymptomatic,
  playerDistressed,
  pressureRead,
  runEndReason,
  startRun,
  woundBurden,
  DIRECTOR_LOW_BAND,
  DIRECTOR_HIGH_BAND,
  STORY_ARCS,
  type DifficultyMode,
  type GameState,
  type RegionGraph,
  type SceneChoice,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

/** `DIRECTOR_NEED_DISTRESS` was not exported before T78 (it is now); read it off the namespace so the same runner measures both trees. */
const DIRECTOR_NEED_DISTRESS = ((engine as unknown as Record<string, unknown>)["DIRECTOR_NEED_DISTRESS"] as number | undefined) ?? 70;
const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

function boot(seed: string, difficulty?: DifficultyMode): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-13T00:00:00.000Z", ...(difficulty === undefined ? {} : { difficulty }) },
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

/** A PRNG for the POLICY only — it never touches the engine's own deterministic streams. */
function policyRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2));
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
/** Every body in the city: standing in a node, or walking in a horde (T76 conserves the sum). */
const bodies = (s: GameState): number =>
  Object.values(s.nodes).reduce((a, n) => a + n.walkers, 0) + s.hordes.reduce((a, h) => a + h.size, 0);
const typed = (s: GameState, t: string): number =>
  Object.values(s.nodes).reduce((a, n) => a + (n.roster ?? []).filter((r) => r === t).length, 0);
const REGION_IDS = ["region.downtown", "region.mercy-hospital", "region.ironworks", "region.rivermouth", "region.hillcrest", "region.the-terraces"];
const short = (id: string): string => id.replace("region.", "").padEnd(14);

// --- off-screen drift ---------------------------------------------------------------------------

/**
 * Park the player at the start node and let the world run for 30 idle days, advancing the clock
 * alongside (advanceWorld leaves `meta` to its caller, and anything that reads `meta.day` must see the
 * days pass). Prints each region's dials against its authored baseline, and the body count.
 */
function offscreen(): void {
  const CHECK = [0, 3, 7, 14, 30];
  for (const seed of ["t78-a", "t78-b"]) {
    let { state, graph } = boot(seed);
    const baseline = Object.fromEntries(REGION_IDS.map((id) => [id, graph.regions[id]!.baseline!]));
    const snaps: Record<number, GameState> = { 0: state };
    for (let day = 1; day <= 30; day += 1) {
      state = { ...advanceWorld(state, 24, graph), meta: advanceClock(state.meta, 24) };
      if (CHECK.includes(day)) snaps[day] = state;
    }
    console.log(`\n===== 30 idle days off-screen, seed ${seed} (threat/density per region; authored in brackets) =====`);
    console.log(`  ${"region".padEnd(14)} ${CHECK.map((d) => `d${d}`.padStart(8)).join("")}   authored`);
    for (const id of REGION_IDS) {
      const b = baseline[id]!;
      const cells = CHECK.map((d) => `${snaps[d]!.regions[id]!.threat}/${snaps[d]!.regions[id]!.zombieDensity}`.padStart(8));
      console.log(`  ${short(id)} ${cells.join("")}   [${b.threat}/${b.zombieDensity}]`);
    }
    console.log(`  bodies         ${CHECK.map((d) => String(bodies(snaps[d]!)).padStart(8)).join("")}`);
    console.log(`  riot/bloated   ${CHECK.map((d) => `${typed(snaps[d]!, "zombie.riot")}/${typed(snaps[d]!, "zombie.bloated")}`.padStart(8)).join("")}`);
    const meanThreat = (d: number): number => mean(REGION_IDS.map((id) => snaps[d]!.regions[id]!.threat));
    console.log(`  mean threat    ${CHECK.map((d) => String(meanThreat(d)).padStart(8)).join("")}   (authored mean ${mean(REGION_IDS.map((id) => baseline[id]!.threat!))})`);
    const spread = (d: number): number => {
      const ts = REGION_IDS.map((id) => snaps[d]!.regions[id]!.threat);
      return Math.max(...ts) - Math.min(...ts);
    };
    console.log(`  threat spread  ${CHECK.map((d) => String(spread(d)).padStart(8)).join("")}   (authored ${Math.max(...REGION_IDS.map((id) => baseline[id]!.threat!)) - Math.min(...REGION_IDS.map((id) => baseline[id]!.threat!))}) — regional identity`);
  }
  console.log("\n===== day-30 bodies by difficulty, seed t78-a (PL-M5-11: does a dial reach the population?) =====");
  for (const mode of ["story", "survivor", "hardcore", "nightmare"] as const) {
    let { state, graph } = boot("t78-a", mode);
    for (let day = 1; day <= 30; day += 1) state = { ...advanceWorld(state, 24, graph), meta: advanceClock(state.meta, 24) };
    console.log(`  ${mode.padEnd(10)} bodies ${bodies(state)}  mean density ${mean(REGION_IDS.map((id) => state.regions[id]!.zombieDensity))}  riot/bloated ${typed(state, "zombie.riot")}/${typed(state, "zombie.bloated")}`);
  }
}

// --- the director under play --------------------------------------------------------------------

type Policy = "fight" | "careful";

interface Sample {
  day: number;
  pressure: number;
  beat: string;
  distressed: boolean;
  why: string;
  burden: number;
  bias: number;
}

/**
 * Why `playerDistressed` says yes, by the clause that fires first in the source's own order — the
 * T78 clauses (weight ≥ DIRECTOR_WOUND_DISTRESS, or an open wound younger than
 * DIRECTOR_FRESH_WOUND_HOURS), so the census describes the read the engine actually makes. On the
 * pre-T78 tree, where those two constants do not exist, the old `treated < 100` clause is what fires
 * and is what this reports (it mirrors whichever tree it runs on).
 */
function distressWhy(s: GameState): string {
  if (s.combat !== null) return "combat";
  const c = s.player.condition;
  const burden = woundBurden(c);
  if (WOUND_DISTRESS === undefined) {
    if (c.wounds.some((w) => w.treated < 100)) return `wound(burden ${burden})`;
  } else {
    if (burden >= WOUND_DISTRESS) return `wound(burden ${burden})`;
    if (c.wounds.some((w) => w.treated < w.severity && woundAge(w, s) < FRESH_HOURS)) return `fresh(burden ${burden})`;
  }
  const n = c.needs;
  if (n.hunger >= DIRECTOR_NEED_DISTRESS || n.thirst >= DIRECTOR_NEED_DISTRESS || n.fatigue >= DIRECTOR_NEED_DISTRESS) return "need";
  if (isSymptomatic(s)) return "infection";
  return "-";
}
// Read the T78 constants off the engine namespace so the SAME runner file measures both trees.
const ENGINE = engine as unknown as Record<string, unknown>;
const WOUND_DISTRESS = ENGINE["DIRECTOR_WOUND_DISTRESS"] as number | undefined;
const FRESH_HOURS = (ENGINE["DIRECTOR_FRESH_WOUND_HOURS"] as number | undefined) ?? 6;
const woundAge = (w: { inflictedDay: number; inflictedHour?: number }, s: GameState): number =>
  Math.max(0, (s.meta.day - 1) * 24 + s.meta.hour - ((w.inflictedDay - 1) * 24 + (w.inflictedHour ?? 0)));
/** The director's lean on the player's current region (0 on a tree without it). */
const biasHere = (s: GameState): number => {
  const r = s.regions[s.nodes[s.player.location]!.regionId] as unknown as Record<string, unknown>;
  const b = r["directorBias"];
  return typeof b === "number" && Number.isFinite(b) ? b : 0;
};

function playRun(seed: string, maxTurns: number, policy: Policy, immortal = false, untilDay = Infinity, directorOff = false): { samples: Sample[]; state: GameState } {
  const { state: start, graph } = boot(seed);
  const rnd = policyRng(`policy:${seed}`);
  let state = directorOff ? { ...start, world: { ...start.world, flags: { ...start.world.flags, "director.disabled": true } } } : start;
  const samples: Sample[] = [];
  for (let i = 0; i < maxTurns && (immortal || !isRunOver(state)) && state.meta.day <= untilDay; i += 1) {
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const by = (p: string): SceneChoice[] => choices.filter((c) => c.id.startsWith(p));
    const eq = (id: string): SceneChoice[] => choices.filter((c) => c.id === id);
    samples.push({
      day: state.meta.day,
      pressure: pressureRead(state),
      beat: directorBeat(state),
      distressed: playerDistressed(state),
      why: distressWhy(state),
      burden: woundBurden(state.player.condition),
      bias: biasHere(state),
    });
    let chosen: SceneChoice;
    const flee = by("flee:"), hold = eq("hold"), retreat = by("retreat:"), slip = by("slip:");
    const strike = eq("strike"), fight = eq("fight"), move = by("move:");
    const treat = eq("treat"), eat = eq("eat"), drink = eq("drink"), search = eq("search"), wait = eq("wait"), rest = eq("rest");
    if (immortal) {
      // The idle probe: stand still and let the days pass — rest (4h), or hold a fight, or whatever is first.
      // A wound from an encounter is left as it is: the probe measures the world's clock, and a wound is
      // exactly the thing the director's distress read is supposed to weigh.
      chosen = rest[0] ?? hold[0] ?? wait[0] ?? choices[0]!;
    } else if (flee.length > 0) chosen = pick(rnd, flee);
    else if (hold.length > 0) chosen = hold[0]!;
    else if (retreat.length > 0) chosen = policy === "fight" && strike.length > 0 && rnd() < 0.6 ? strike[0]! : pick(rnd, retreat);
    else if (slip.length > 0) chosen = policy === "fight" && fight.length > 0 && rnd() < 0.7 ? fight[0]! : pick(rnd, slip);
    else if (policy === "careful" && treat.length > 0) chosen = treat[0]!;
    else if (eat.length > 0 && state.player.condition.needs.hunger >= 70) chosen = eat[0]!;
    else if (drink.length > 0 && state.player.condition.needs.thirst >= 70) chosen = drink[0]!;
    else if (search.length > 0 && rnd() < 0.35) chosen = search[0]!;
    else if (move.length > 0) chosen = pick(rnd, move);
    else chosen = choices[0]!;
    state = applyAction(state, chosen.action, graph).state;
    if (immortal) {
      // Keep the probe alive and undistressed by NEEDS alone, so what it measures is the world's clock. A
      // body the run has ended (an infection run to terminal) is swapped for a fresh one — the world keeps
      // its clock; only the player's condition is reset.
      state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } } };
      if (isRunOver(state)) state = { ...state, player: { ...state.player, condition: start.player.condition } };
    }
  }
  return { samples, state };
}

function director(): void {
  const SEEDS = ["t78-a", "t78-b", "t78-c", "t78-d", "t78-e", "t78-f", "t78-g", "t78-h"];
  for (const policy of ["fight", "careful"] as const) {
    const runs = SEEDS.map((s) => playRun(s, 400, policy));
    const all = runs.flatMap((r) => r.samples);
    const beats: Record<string, number> = {};
    const whys: Record<string, number> = {};
    for (const s of all) {
      beats[s.beat] = (beats[s.beat] ?? 0) + 1;
      const w = s.why.replace(/\(.*\)/, "");
      whys[w] = (whys[w] ?? 0) + 1;
    }
    const ends = runs.reduce<Record<string, number>>((a, r) => { const e = runEndReason(r.state) ?? "alive"; return { ...a, [e]: (a[e] ?? 0) + 1 }; }, {});
    console.log(`\n===== director under play — policy "${policy}", ${SEEDS.length} seeds x 400 turns, shipped city =====`);
    console.log(`  turns ${all.length}; mean end day ${mean(runs.map((r) => r.state.meta.day))}; ends ${JSON.stringify(ends)}`);
    console.log(`  beats: ${Object.entries(beats).map(([k, v]) => `${k} ${v} (${pct(v, all.length)})`).join(" · ")}`);
    console.log(`  distressed ${pct(all.filter((s) => s.distressed).length, all.length)} of turns — by first clause: ${JSON.stringify(whys)}`);
    const wounded = all.filter((s) => s.why.startsWith("wound"));
    if (wounded.length > 0) {
      const burdens = wounded.map((s) => s.burden);
      console.log(`  wound-distress turns ${wounded.length}: burden mean ${mean(burdens)}, median ${burdens.sort((a, b) => a - b)[Math.floor(burdens.length / 2)]}, under 20: ${pct(burdens.filter((b) => b < 20).length, burdens.length)}`);
    }
    const ps = all.map((s) => s.pressure);
    console.log(`  pressure mean ${mean(ps)} min ${Math.min(...ps)} max ${Math.max(...ps)}; calm (<${DIRECTOR_LOW_BAND}) ${pct(ps.filter((p) => p < DIRECTOR_LOW_BAND).length, ps.length)}; high (>=${DIRECTOR_HIGH_BAND}) ${pct(ps.filter((p) => p >= DIRECTOR_HIGH_BAND).length, ps.length)}`);
    // first-wound → what fraction of the REMAINING turns are relief?
    let after = 0, afterRelief = 0;
    for (const r of runs) {
      const k = r.samples.findIndex((s) => s.burden > 0);
      if (k < 0) continue;
      for (const s of r.samples.slice(k)) { after += 1; if (s.beat === "relief") afterRelief += 1; }
    }
    console.log(`  after the first wound: ${after} turns, relief on ${pct(afterRelief, after)} of them`);
    const leans = all.map((s) => s.bias);
    console.log(`  director lean on the current region: mean ${mean(leans)} min ${Math.min(...leans)} max ${Math.max(...leans)}; turns at the floor (−10) ${pct(leans.filter((b) => b <= -10).length, leans.length)}`);
  }
}

/** The T30 DoD, re-measured: does disabling the director still change pacing metrics after T78? */
function onoff(): void {
  const SEEDS = ["t78-a", "t78-b", "t78-c", "t78-d", "t78-e", "t78-f", "t78-g", "t78-h"];
  console.log("\n===== director on vs off — fight policy, 8 seeds x 400 turns (the T30 DoD after T78) =====");
  for (const off of [false, true]) {
    const runs = SEEDS.map((sd) => playRun(sd, 400, "fight", false, Infinity, off));
    const all = runs.flatMap((r) => r.samples);
    const home = (r: { state: GameState }): number => r.state.regions[r.state.nodes[r.state.player.location]!.regionId]!.zombieDensity;
    const homeThreat = (r: { state: GameState }): number => r.state.regions[r.state.nodes[r.state.player.location]!.regionId]!.threat;
    console.log(`  director ${off ? "OFF" : "ON "}: turns ${all.length}, mean end day ${mean(runs.map((r) => r.state.meta.day))}, mean pressure ${mean(all.map((x) => x.pressure))}, end density/threat where the run ended ${mean(runs.map(home))}/${mean(runs.map(homeThreat))}, bodies at end ${mean(runs.map((r) => bodies(r.state)))}, mean lean ${mean(all.map((x) => x.bias))}`);
  }
  console.log("\n===== director on vs off — immortal idle probe, 20 days, 2 seeds =====");
  for (const off of [false, true]) {
    const runs = ["t78-a", "t78-b"].map((sd) => playRun(sd, 4000, "careful", true, 20, off));
    const home = (r: { state: GameState }): number => r.state.regions[r.state.nodes[r.state.player.location]!.regionId]!.zombieDensity;
    console.log(`  director ${off ? "OFF" : "ON "}: home density at day 21 ${runs.map(home).join("/")}, bodies ${runs.map((r) => bodies(r.state)).join("/")}, beats ${JSON.stringify(runs.flatMap((r) => r.samples).reduce<Record<string, number>>((a, x) => ({ ...a, [x.beat]: (a[x.beat] ?? 0) + 1 }), {}))}`);
  }
}

// --- the day ramp --------------------------------------------------------------------------------

/** An immortal idle run: is day 40 any different from day 2 for a player who just stands there? */
function ramp(): void {
  console.log("\n===== immortal idle probe, 40 days at the start node (4 seeds) =====");
  const DAYS = [2, 7, 14, 21, 30, 40];
  for (const seed of ["t78-a", "t78-b", "t78-c", "t78-d"]) {
    const { samples, state } = playRun(seed, 4000, "careful", true, 40);
    const byDay = (d: number): Sample[] => samples.filter((s) => s.day === d);
    const cell = (d: number): string => {
      const ss = byDay(d);
      if (ss.length === 0) return "-".padStart(16);
      const beats = ss.reduce<Record<string, number>>((a, s) => ({ ...a, [s.beat]: (a[s.beat] ?? 0) + 1 }), {});
      const tag = Object.entries(beats).map(([k, v]) => `${k[0]}${v}`).join("");
      const b = Math.max(...ss.map((s) => s.burden));
      return `p${mean(ss.map((s) => s.pressure))} ${tag}${b > 0 ? ` w${b}` : ""}`.padStart(18);
    };
    console.log(`  seed ${seed}: ${DAYS.map((d) => `d${d}: ${cell(d)}`).join(" | ")}`);
    const home = state.nodes[state.player.location]!.regionId;
    console.log(`     home ${home}: threat ${state.regions[home]!.threat} density ${state.regions[home]!.zombieDensity} at day ${state.meta.day}; bodies citywide ${bodies(state)}`);
  }
  console.log("  (p = mean pressureRead that day; e/r/h = escalate/relief/hold beats that day)");
}

// --- the diurnal tide ----------------------------------------------------------------------------

function tide(): void {
  console.log("\n===== globalThreat over idle days 8-12 of 2-hour searches (immortal probe, seed t78-a; days 1-7 are the climb from 0) =====");
  const { state: start, graph } = boot("t78-a");
  let state = start;
  const byPhase: Record<string, number[]> = {};
  const tideAll: number[] = [];
  const firstWeek: number[] = [];
  while (state.meta.day <= 12) {
    const cs = availableActions(state, graph);
    if (cs.length === 0) break;
    // A 2-hour turn every turn (search), so the tide is sampled on the real turn grain the game plays at.
    const c = cs.find((x) => x.id === "search") ?? cs.find((x) => x.id === "hold") ?? cs[0]!;
    state = applyAction(state, c.action, graph).state;
    state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } } };
    if (isRunOver(state)) state = { ...state, player: { ...state.player, condition: start.player.condition } };
    if (state.meta.day <= 7) { firstWeek.push(state.world.globalThreat); continue; }
    (byPhase[state.meta.phase] ??= []).push(state.world.globalThreat);
    tideAll.push(state.world.globalThreat);
  }
  console.log(`  days 1-7: ${Math.min(...firstWeek)}..${Math.max(...firstWeek)}   days 8-12 band ${Math.min(...tideAll)}..${Math.max(...tideAll)} (targets: midday 15, night 55)`);
  for (const [p, v] of Object.entries(byPhase)) console.log(`    ${p.padEnd(15)} mean ${mean(v)}  min ${Math.min(...v)}  max ${Math.max(...v)}`);
}

const argv = process.argv.slice(2);
if (argv.includes("--director")) director();
else if (argv.includes("--onoff")) onoff();
else if (argv.includes("--ramp")) ramp();
else if (argv.includes("--tide")) tide();
else offscreen();
