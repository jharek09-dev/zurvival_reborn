/**
 * T77 measurement runner — the numbers quoted in `sim/detection.ts`, `sim/zombies.ts`,
 * `combat/combat.ts` and `docs/qa/QA_REVIEW_T77.md`, re-derivable on demand.
 *
 * This exists because a previous pass's audit made a fair complaint: the before/after figures a task
 * writes into its comments are unverifiable if the thing that produced them was a throwaway script in
 * a scratch directory. It is a measurement tool, not a test — it asserts nothing and CI does not run
 * it. It plays the **shipped city** (`content/`), not a fixture, because every number worth quoting is
 * a statement about the real content.
 *
 *   npx tsx measure/t77.ts            # the escape/arousal/route census, three policies
 *   npx tsx measure/t77.ts --curve    # how the stealth read escalates across one run
 *   npx tsx measure/t77.ts --roads    # how far weather degrades roads, and when routes block
 *
 * The policies are deliberately crude and deliberately *bad* at the game — they never treat a wound
 * unless told to, and they slip at every opportunity. They are a worst-case probe of the stealth path,
 * not a model of skilled play, and the figures should be read that way.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  conditionOf,
  detectChance,
  extraCostOf,
  isBlocked,
  isRunOver,
  routeWear,
  runEndReason,
  startRun,
  stealthRead,
  woundBurden,
  STORY_ARCS,
  type GameState,
  type RegionGraph,
  type SceneChoice,
} from "../../engine/src/index.js";

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

function boot(seed: string): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-12T00:00:00.000Z" },
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

type Policy = "avoid" | "careful" | "fight";

interface Tally {
  turns: number;
  endDay: number;
  endReason: string;
  endBurden: number;
  slips: number;
  slipWounds: number;
  retreats: number;
  retreatWounds: number;
  flees: number;
  fleeWounds: number;
  fights: number;
  treats: number;
  escapeOffers: number;
  blockedOffers: number;
  wornOffers: number;
  wornTaken: number;
  /** Hours an escape dodged that a `move` over the same edge would have charged. The PL-M2-05 number. */
  hoursDodged: number;
  arousalAtSlip: Record<string, number>;
  reads: { kind: string; base: number; arousal: number; scent: number; pack: number; alerted: number; total: number }[];
  maxWear: number;
}

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

export function playRun(seed: string, maxTurns: number, policy: Policy): Tally {
  const { state: start, graph } = boot(seed);
  const rnd = policyRng(`policy:${seed}`);
  let state = start;
  const t: Tally = {
    turns: 0, endDay: 0, endReason: "alive", endBurden: 0,
    slips: 0, slipWounds: 0, retreats: 0, retreatWounds: 0, flees: 0, fleeWounds: 0,
    fights: 0, treats: 0, escapeOffers: 0, blockedOffers: 0, wornOffers: 0, wornTaken: 0,
    hoursDodged: 0, arousalAtSlip: {}, reads: [], maxWear: 0,
  };

  for (let i = 0; i < maxTurns && !isRunOver(state); i += 1) {
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const here = state.player.location;
    const node = state.nodes[here];
    const by = (p: string): SceneChoice[] => choices.filter((c) => c.id.startsWith(p));
    const eq = (id: string): SceneChoice[] => choices.filter((c) => c.id === id);

    for (const c of choices) {
      const m = /^(?:slip|retreat|flee):(.+)$/.exec(c.id);
      if (m === null) continue;
      t.escapeOffers += 1;
      const w = routeWear(state, here, m[1]!);
      if (isBlocked(w)) t.blockedOffers += 1;
      else if (extraCostOf(w) > 0) t.wornOffers += 1;
    }

    const burdenBefore = woundBurden(state.player.condition);
    const flee = by("flee:"), hold = eq("hold"), retreat = by("retreat:"), slip = by("slip:");
    const strike = eq("strike"), fight = eq("fight"), move = by("move:");
    const treat = eq("treat"), eat = eq("eat"), drink = eq("drink"), search = eq("search");

    let chosen: SceneChoice;
    let kind: "slip" | "retreat" | "flee" | "other" = "other";
    if (flee.length > 0) { chosen = pick(rnd, flee); kind = "flee"; }
    else if (hold.length > 0) chosen = hold[0]!;
    else if (retreat.length > 0) {
      if (policy === "fight" && strike.length > 0 && rnd() < 0.6) { chosen = strike[0]!; t.fights += 1; }
      else { chosen = pick(rnd, retreat); kind = "retreat"; }
    } else if (slip.length > 0) {
      if (policy === "fight" && fight.length > 0 && rnd() < 0.7) { chosen = fight[0]!; t.fights += 1; }
      else { chosen = pick(rnd, slip); kind = "slip"; }
    }
    else if (policy === "careful" && treat.length > 0) { chosen = treat[0]!; t.treats += 1; }
    else if (eat.length > 0 && state.player.condition.needs.hunger >= 70) chosen = eat[0]!;
    else if (drink.length > 0 && state.player.condition.needs.thirst >= 70) chosen = drink[0]!;
    else if (search.length > 0 && rnd() < 0.35) chosen = search[0]!;
    else if (move.length > 0) chosen = pick(rnd, move);
    else chosen = choices[0]!;

    if (kind !== "other" && node !== undefined) {
      const to = /^\w+:(.+)$/.exec(chosen.id)?.[1];
      if (to !== undefined) {
        const w = routeWear(state, here, to);
        if (extraCostOf(w) > 0 && !isBlocked(w)) t.wornTaken += 1;
        t.hoursDodged += Math.max(0, 2 + extraCostOf(w) - (chosen.timeCost ?? 0));
      }
      const base = detectChance(node.noise, state.meta.phase, state.world.weather);
      const r = stealthRead(state, base, kind === "retreat" ? { alerted: true } : {});
      t.reads.push({ kind, base: +base.toFixed(3), arousal: r.arousal, scent: r.scent, pack: r.pack, alerted: r.alerted, total: +r.total.toFixed(3) });
      if (kind === "slip") t.arousalAtSlip[node.zombieState] = (t.arousalAtSlip[node.zombieState] ?? 0) + 1;
    }

    state = applyAction(state, chosen.action, graph).state;
    t.turns += 1;
    const hurt = woundBurden(state.player.condition) > burdenBefore ? 1 : 0;
    if (kind === "slip") { t.slips += 1; t.slipWounds += hurt; }
    else if (kind === "retreat") { t.retreats += 1; t.retreatWounds += hurt; }
    else if (kind === "flee") { t.flees += 1; t.fleeWounds += hurt; }
  }

  t.endDay = state.meta.day;
  t.endReason = runEndReason(state) ?? "alive";
  t.endBurden = woundBurden(state.player.condition);
  t.maxWear = Math.max(0, ...Object.values(state.routes).map((r) => r.wear));
  return t;
}

const SEEDS = ["t77-a", "t77-b", "t77-c", "t77-d", "t77-e", "t77-f", "t77-g", "t77-h"];
const TURNS = 400;
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3));

function census(): void {
  for (const policy of ["avoid", "careful", "fight"] as const) {
    const runs = SEEDS.map((s) => playRun(s, TURNS, policy));
    const sum = (k: keyof Tally): number => runs.reduce((a, r) => a + (r[k] as number), 0);
    const arousal: Record<string, number> = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.arousalAtSlip)) arousal[k] = (arousal[k] ?? 0) + v;
    const reads = runs.flatMap((r) => r.reads);
    console.log(`\n===== policy "${policy}" — ${SEEDS.length} seeds x ${TURNS} turns, shipped city =====`);
    console.log(`  mean end day ${(sum("endDay") / runs.length).toFixed(1)}; ends ${JSON.stringify(runs.reduce<Record<string, number>>((a, r) => ({ ...a, [r.endReason]: (a[r.endReason] ?? 0) + 1 }), {}))}`);
    console.log(`  slips    ${sum("slips")} wounded ${sum("slipWounds")} (${pct(sum("slipWounds"), sum("slips"))})`);
    console.log(`  retreats ${sum("retreats")} wounded ${sum("retreatWounds")} (${pct(sum("retreatWounds"), sum("retreats"))})`);
    console.log(`  flees    ${sum("flees")} wounded ${sum("fleeWounds")} (${pct(sum("fleeWounds"), sum("flees"))})`);
    console.log(`  arousal at slip: ${JSON.stringify(arousal)}`);
    console.log(`  escape offers ${sum("escapeOffers")}; blocked ${sum("blockedOffers")}; worn ${sum("wornOffers")}, taken ${sum("wornTaken")}`);
    console.log(`  HOURS DODGED vs the same move (PL-M2-05): ${sum("hoursDodged")}   max route wear seen ${Math.max(...runs.map((r) => r.maxWear))}`);
    if (reads.length > 0) {
      for (const k of ["base", "arousal", "scent", "pack", "alerted", "total"] as const) {
        console.log(`    mean ${k.padEnd(8)} ${mean(reads.map((r) => r[k]))}  max ${Math.max(...reads.map((r) => r[k]))}`);
      }
      console.log(`    saturated at the ceiling: ${reads.filter((r) => r.total >= 0.9).length}/${reads.length}`);
    }
  }
}

/** How the read escalates as a run wears the player down — the gradient the task is really about. */
function curve(): void {
  const buckets: Record<string, number[]> = { "slip 1": [], "slips 2-3": [], "slips 4-9": [], "slips 10+": [] };
  const arousal: Record<string, Record<string, number>> = {};
  for (let k = 0; k < 40; k += 1) {
    const t = playRun(`curve-${k}`, 400, "avoid");
    let n = 0;
    for (const r of t.reads) {
      if (r.kind !== "slip") continue;
      n += 1;
      const b = n === 1 ? "slip 1" : n <= 3 ? "slips 2-3" : n <= 9 ? "slips 4-9" : "slips 10+";
      buckets[b]!.push(r.total);
      arousal[b] = arousal[b] ?? {};
    }
  }
  console.log("\n===== how the stealth read escalates over one run (40 seeds, avoid policy) =====");
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(10)} n=${String(v.length).padStart(4)}  mean detect ${mean(v)}`);
}

/** Roads decay monotonically and never recover — this is what makes `blocked` reachable. */
function roads(): void {
  console.log("\n===== road decay: when does a route actually block? =====");
  for (const weather of ["weather.clear", "weather.snow", "weather.storm"]) {
    for (const seed of ["r1", "r2", "r3"]) {
      let { state, graph } = boot(seed);
      state = { ...state, world: { ...state.world, weather } };
      let blockedDay = -1;
      let worst = 0;
      for (let d = 0; d < 600 && blockedDay < 0; d += 1) {
        const cs = availableActions(state, graph);
        if (cs.length === 0) break;
        state = applyAction(state, cs[cs.length - 1]!.action, graph).state;
        state = { ...state, world: { ...state.world, weather } };
        const w = Math.max(0, ...Object.values(state.routes).map((r) => r.wear));
        worst = Math.max(worst, w);
        if (isBlocked(w)) blockedDay = state.meta.day;
        if (isRunOver(state)) state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } } };
      }
      const minRoads = Math.min(...Object.values(state.regions).map((r) => r.roads));
      console.log(`  ${weather.padEnd(14)} seed ${seed}: min roads ${minRoads}, worst wear ${worst} (${conditionOf(worst)})${blockedDay > 0 ? `, BLOCKED on day ${blockedDay}` : ""}`);
    }
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--curve")) curve();
else if (argv.includes("--roads")) roads();
else census();
