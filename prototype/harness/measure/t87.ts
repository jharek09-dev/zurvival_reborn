/**
 * T87 measurement runner — the terminal-project numbers quoted in `sim/project.ts` and
 * `docs/qa/QA_REVIEW_T87.md`, re-derivable on demand (the T77–T86 discipline: a task's before/after
 * figures are worthless if the thing that produced them was a scratch script).
 * It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t87.ts            # STRUCTURE: the run-end surface and what endingFlags holds
 *   npx tsx measure/t87.ts --dead     # brief claim: no win path; endingFlags is a write-nobody stub
 *   npx tsx measure/t87.ts --items    # brief claim: batteries/lighter/blanket/charcoal/tools are DEAD
 *   npx tsx measure/t87.ts --surplus  # what does a real run actually END holding? (the sink's budget)
 *   npx tsx measure/t87.ts --ceiling  # the same, IMMORTAL — accumulation as a ceiling, not a bot artifact
 *   npx tsx measure/t87.ts --arc      # brief claim: "hour 20 has a NARROWER decision space than hour 2"
 *   npx tsx measure/t87.ts --drain    # brief claim: regions empty themselves on a wall clock
 *   npx tsx measure/t87.ts --project  # POST: is the terminal project reached, staged, finished?
 *   npx tsx measure/t87.ts --escal    # POST: does finishing a stage actually RAISE anything?
 *   npx tsx measure/t87.ts --zealot   # POST: the CEILING — an immortal bot that drives straight at
 *                                     # the project. Is a win reachable AT ALL, and on what day?
 *
 * Every T87 lookup goes through a fallback, so both trees run the same modes line for line.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  runEndReason,
  startRun,
  RUN_END_REASONS,
  type GameState,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T87 = ENGINE["PROJECT_STAGE_FLAG_PREFIX"] !== undefined;
const TREE = HAS_T87 ? "POST-T87" : "PRE-T87";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = join(ROOT, "content");
const ENGINE_SRC = join(ROOT, "prototype", "engine", "src");
const load = <T>(sub: string): T[] => {
  let files: string[];
  try { files = readdirSync(join(CONTENT, sub)); } catch { return []; }
  return files.filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);
};

function city(seed: string): { state: GameState; graph: RegionGraph } {
  const args: unknown[] = [
    { seed, createdAt: "2026-09-14T00:00:00.000Z" },
    load("regions"), load("nodes"), load("npcs"),
    (ENGINE["STORY_ARCS"] as { id: string }[]).map((a) => a.id),
    load("encounters"), load("radio"), load("recipes"), load("jobs"), load("factions"), load("weapons"),
  ];
  // T87 adds an 11th content argument (projects). Pre-T87 `startRun` ignores extra args, so one call
  // shape runs in both trees.
  args.push(load("projects"));
  return (startRun as unknown as (...a: unknown[]) => { state: GameState; graph: RegionGraph })(...args);
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const RUNS = Number(process.env["T87_RUNS"] ?? 40);
const ACTIONS = Number(process.env["T87_ACTIONS"] ?? 600);

function engineSources(dir = ENGINE_SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) engineSources(p, out);
    else if (e.endsWith(".ts")) out.push(p);
  }
  return out;
}
const rel = (p: string): string => p.slice(ENGINE_SRC.length + 1).replace(/\\/g, "/");

function hops(graph: RegionGraph, from: string): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  const q = [from];
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const nb of graph.nodes[cur]?.adjacent ?? []) {
      if (d.has(nb)) continue;
      d.set(nb, d.get(cur)! + 1);
      q.push(nb);
    }
  }
  return d;
}

const held = (state: GameState, type: string): number =>
  state.player.inventory.filter((e) => e.type === type).reduce((a, e) => a + e.quantity, 0)
  + state.player.stash.filter((e) => e.type === type).reduce((a, e) => a + e.quantity, 0);

// --- 1. structure ---------------------------------------------------------------------------------

function structure(): void {
  const { state } = city("t87-structure");
  console.log(`tree: ${TREE}\n`);
  console.log(`  RUN_END_REASONS (${RUN_END_REASONS.length}): ${RUN_END_REASONS.join(", ")}`);
  console.log(`  story.endingFlags at turn 0: ${JSON.stringify(state.story.endingFlags)}`);
  console.log(`  story.progress   at turn 0: ${JSON.stringify(state.story.progress)}`);
  const defs = load<{ id: string; label?: string; stages?: unknown[] }>("projects");
  console.log(`\n  authored projects: ${defs.length}`);
  for (const d of defs) console.log(`    ${d.id.padEnd(34)} ${String(d.label ?? "")} — ${(d.stages ?? []).length} stages`);
  const active = ENGINE["projectsActive"] as ((g: RegionGraph) => boolean) | undefined;
  if (active !== undefined) {
    const { graph } = city("t87-structure");
    console.log(`  projectsActive on the SHIPPED content: ${active(graph)}`);
  }
}

// --- 2. the no-win claim --------------------------------------------------------------------------

function dead(): void {
  console.log(`tree: ${TREE} · brief claim: there is no way to WIN, and endingFlags is a stub\n`);
  const files = engineSources();
  for (const [label, re] of [
    ["endingFlags", /\bendingFlags\b/],
    ["win / victory / escape / evac / extraction", /\b(victory|extraction|evacuat|escaped?)\b/i],
  ] as const) {
    console.log(`  ${label}:`);
    let hits = 0;
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (!re.test(ln)) return;
        if (/^\s*(\*|\/\/|\/\*)/.test(ln)) return;
        hits += 1;
        console.log(`    ${rel(f)}:${i + 1}  ${ln.trim().slice(0, 118)}`);
      });
    }
    if (hits === 0) console.log(`    (no non-comment occurrence anywhere in engine/src)`);
    console.log("");
  }
  console.log(`  RUN_END_REASONS: ${RUN_END_REASONS.join(", ")}`);
  console.log(`    ways to lose: ${RUN_END_REASONS.filter((r) => r !== "escaped" && r !== "held").length}`);
  console.log(`    ways to win : ${RUN_END_REASONS.filter((r) => r === "escaped" || r === "held").length}`);
}

// --- 3. the dead-item claim -----------------------------------------------------------------------

const WATCH = [
  "item.batteries", "item.lighter", "item.blanket", "item.charcoal", "item.tools",
  "item.fuel", "item.scrap", "item.cloth", "item.canned-food", "item.water", "item.bandage",
];

function items(): void {
  console.log(`tree: ${TREE} · brief claim: batteries/lighter/blanket/charcoal have ZERO consumers, tools has one\n`);
  const files = engineSources();
  const recipes = load<{ id: string; label: string; inputs: { item: string; qty: number }[]; installsRoom?: string; requiresRoom?: string }>("recipes");
  const jobs = load<{ id: string; label: string; consumes?: { item: string } }>("jobs");
  const projects = load<{ id: string; stages?: { inputs?: { item: string; qty: number }[] }[] }>("projects");
  for (const it of WATCH) {
    const code = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((ln, i) => ({ f, i, ln })))
      .filter(({ ln }) => ln.includes(`"${it}"`) && !/^\s*(\*|\/\/|\/\*)/.test(ln));
    const asLoot = code.filter(({ f }) => rel(f) === "sim/loot.ts").length;
    const asWeight = code.filter(({ f }) => rel(f) === "sim/inventory.ts").length;
    const other = code.filter(({ f }) => rel(f) !== "sim/loot.ts" && rel(f) !== "sim/inventory.ts").map(({ f, i }) => `${rel(f)}:${i + 1}`);
    const rec = recipes.filter((r) => r.inputs.some((io) => io.item === it)).map((r) => r.id);
    const job = jobs.filter((j) => j.consumes?.item === it).map((j) => j.id);
    const proj = projects.filter((p) => (p.stages ?? []).some((s) => (s.inputs ?? []).some((io) => io.item === it))).map((p) => p.id);
    console.log(`  ${it.padEnd(18)} loot ${asLoot} · weight ${asWeight} · other code [${other.join(", ") || "none"}]`);
    console.log(`  ${"".padEnd(18)} recipes: ${rec.join(", ") || "NONE"}`);
    if (job.length > 0) console.log(`  ${"".padEnd(18)} jobs:    ${job.join(", ")}`);
    if (proj.length > 0) console.log(`  ${"".padEnd(18)} projects: ${proj.join(", ")}`);
    console.log("");
  }
}

// --- 4. what a run ends holding -------------------------------------------------------------------

type Policy = "settler" | "drifter";

type EndRun = {
  endDay: number;
  end: string | null;
  claimDay: number | null;
  rooms: string[];
  holds: Record<string, number>;
  found: Record<string, number>;
  spent: number;
  choicesEarly: number;
  choicesLate: number;
  choicesByDay: Map<number, number[]>;
  flags: Record<string, boolean>;
};

function endRun(seed: string, actions: number, policy: Policy, immortal = false): EndRun {
  let { state, graph } = city(seed);
  let rng = 37;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
  const dist = hops(graph, state.player.location);
  const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
  let claimDay: number | null = null;
  const found: Record<string, number> = {};
  let spent = 0;
  let choicesEarly = 0;
  let choicesLate = 0;
  const choicesByDay = new Map<number, number[]>();
  for (let k = 0; k < actions; k += 1) {
    if (immortal) {
      state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
    }
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    if (k === 1) choicesEarly = choices.length;
    choicesLate = choices.length;
    const byDay = choicesByDay.get(state.meta.day) ?? [];
    byDay.push(choices.length);
    choicesByDay.set(state.meta.day, byDay);
    const here = state.player.location;
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    const toTarget = target === undefined ? undefined : hops(graph, target);
    const stepper = (): typeof choices[number] | undefined => {
      if (state.player.shelterId !== null || toTarget === undefined) return undefined;
      const dh = toTarget.get(here) ?? 99;
      if (dh === 0) return undefined;
      let best: typeof choices[number] | undefined;
      let bestD = dh;
      for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
        const d = toTarget.get(m.id.slice("move:".length)) ?? 99;
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    };
    const pick = policy === "settler"
      ? (prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
        ?? prefer("claim")
        ?? prefer("craft:recipe.shelter.")
        ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
        ?? stepper()
        ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!)
      : (prefer("break") ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? choices[rand(choices.length)]!);
    const before = state;
    const bc: Record<string, number> = {};
    for (const t of WATCH) bc[t] = held(before, t);
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    for (const t of WATCH) {
      const now = held(state, t);
      if (now > (bc[t] ?? 0)) found[t] = (found[t] ?? 0) + (now - (bc[t] ?? 0));
      if (now < (bc[t] ?? 0)) spent += (bc[t] ?? 0) - now;
    }
    if (claimDay === null && state.player.shelterId !== null) claimDay = state.meta.day;
  }
  const holds: Record<string, number> = {};
  for (const t of WATCH) holds[t] = held(state, t);
  const rooms = state.player.shelterId === null ? [] : [...(state.nodes[state.player.shelterId]?.rooms ?? [])];
  return { endDay: state.meta.day, end: runEndReason(state), claimDay, rooms, holds, found, spent, choicesEarly, choicesLate, choicesByDay, flags: { ...state.story.endingFlags } };
}

function surplus(immortal = false): void {
  const label = immortal ? "IMMORTAL settler (the CEILING)" : "goal-directed settler";
  console.log(`tree: ${TREE} · ${label} · ${RUNS} runs × ${ACTIONS} actions\n`);
  const runs: EndRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(endRun(`t87-surplus-${i}`, ACTIONS, "settler", immortal));
  const ends: Record<string, number> = {};
  for (const r of runs) ends[r.end ?? "alive"] = (ends[r.end ?? "alive"] ?? 0) + 1;
  console.log(`  end day            ${f1(mean(runs.map((r) => r.endDay)))}   (max ${Math.max(...runs.map((r) => r.endDay))})`);
  console.log(`  end reasons        ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`  claimed a base     ${runs.filter((r) => r.claimDay !== null).length} of ${runs.length}   mean day ${f1(mean(runs.filter((r) => r.claimDay !== null).map((r) => r.claimDay!)))}`);
  console.log(`  rooms at the end   ${f2(mean(runs.map((r) => r.rooms.length)))}   (max ${Math.max(...runs.map((r) => r.rooms.length))})`);
  console.log(`  units spent        ${f2(mean(runs.map((r) => r.spent)))}\n`);
  console.log(`  item                 found/run   HELD at end   max held   runs holding >0`);
  for (const t of WATCH) {
    const h = runs.map((r) => r.holds[t] ?? 0);
    console.log(`  ${t.padEnd(18)} ${f2(mean(runs.map((r) => r.found[t] ?? 0)))}      ${f2(mean(h))}        ${String(Math.max(...h)).padStart(3)}       ${pct(h.filter((x) => x > 0).length / h.length)}`);
  }
  const flagged = runs.filter((r) => Object.keys(r.flags).length > 0).length;
  console.log(`\n  runs with ANY story.endingFlags set: ${flagged} of ${runs.length}`);
}

// --- 5. the decision-space claim ------------------------------------------------------------------

function arc(): void {
  console.log(`tree: ${TREE} · brief claim: "hour 20 has a NARROWER decision space than hour 2"\n`);
  const runs: EndRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(endRun(`t87-arc-${i}`, ACTIONS, "settler", true));
  console.log(`  IMMORTAL settler, ${RUNS} runs — mean number of availableActions offered, by day:`);
  const days = new Set<number>();
  for (const r of runs) for (const d of r.choicesByDay.keys()) days.add(d);
  for (const d of [...days].sort((a, b) => a - b).slice(0, 20)) {
    const xs = runs.flatMap((r) => r.choicesByDay.get(d) ?? []);
    if (xs.length === 0) continue;
    console.log(`    day ${String(d).padStart(2)}   ${f2(mean(xs))}  (min ${Math.min(...xs)}, max ${Math.max(...xs)}, n ${xs.length})`);
  }
}

// --- 6. the wall-clock drain claim ----------------------------------------------------------------

function drain(): void {
  console.log(`tree: ${TREE} · brief claim: regions empty themselves on a wall clock whether you visit or not\n`);
  let { state, graph } = city("t87-drain");
  const regionIds = Object.keys(state.regions).sort();
  const snap = (): string => regionIds.map((r) => `${String(state.regions[r]?.loot ?? "?").padStart(4)}`).join(" ");
  console.log(`  regions: ${regionIds.map((r) => r.slice(0, 8).padStart(4)).join(" ")}`);
  console.log(`  day  0: ${snap()}`);
  // A bot that NEVER searches and never leaves the start node: pure wall clock.
  for (let k = 0; k < 900; k += 1) {
    if (runEndReason(state) !== null) break;
    state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
    const choices = availableActions(state, graph);
    const wait = choices.find((c) => c.id.startsWith("rest")) ?? choices.find((c) => c.id.startsWith("sleep")) ?? choices.find((c) => c.id.startsWith("wait"));
    const pick = wait ?? choices[0];
    if (pick === undefined) break;
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    if (state.meta.day !== before.meta.day && state.meta.day % 2 === 0 && state.meta.day <= 20) {
      console.log(`  day ${String(state.meta.day).padStart(2)}: ${snap()}`);
    }
    if (state.meta.day > 20) break;
  }
  console.log(`\n  survivorActivity by region at the end:`);
  for (const r of regionIds) console.log(`    ${r.padEnd(18)} ${String((state.regions[r] as { survivorActivity?: number })?.survivorActivity ?? "?").padStart(4)}  lootRemaining ${String(state.regions[r]?.loot ?? "?").padStart(4)}`);
}


// --- 7. the full ledger: what does the city ACTUALLY hand a run? -----------------------------------

function ledger(immortal: boolean): void {
  console.log(`tree: ${TREE} · ${immortal ? "IMMORTAL" : "mortal"} settler · FULL item ledger + base economy · ${RUNS} runs\n`);
  const foundAll: Record<string, number[]> = {};
  const kinds: Record<string, number> = {};
  const resid: number[] = [];
  const jobsRun: number[] = [];
  const stashN: number[] = [];
  const days: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t87-ledger-${i}`);
    let rng = 53;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
    const dist = hops(graph, state.player.location);
    const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
    const got: Record<string, number> = {};
    for (let k = 0; k < ACTIONS; k += 1) {
      if (immortal) state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const here = state.player.location;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const toTarget = target === undefined ? undefined : hops(graph, target);
      const stepper = (): typeof choices[number] | undefined => {
        if (state.player.shelterId !== null || toTarget === undefined) return undefined;
        const dh = toTarget.get(here) ?? 99;
        if (dh === 0) return undefined;
        let best: typeof choices[number] | undefined; let bestD = dh;
        for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
          const d = toTarget.get(m.id.slice("move:".length)) ?? 99;
          if (d < bestD) { bestD = d; best = m; }
        }
        return best;
      };
      const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
        ?? prefer("claim") ?? prefer("craft:recipe.shelter.")
        ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
        ?? stepper() ?? prefer("sleep") ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      if (pick.id.startsWith("search")) kinds[graph.nodes[here]?.kind ?? "generic"] = (kinds[graph.nodes[here]?.kind ?? "generic"] ?? 0) + 1;
      const before = state;
      const bc: Record<string, number> = {};
      for (const e of [...before.player.inventory, ...before.player.stash]) bc[e.type] = (bc[e.type] ?? 0) + e.quantity;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      const ac: Record<string, number> = {};
      for (const e of [...state.player.inventory, ...state.player.stash]) ac[e.type] = (ac[e.type] ?? 0) + e.quantity;
      for (const t of new Set([...Object.keys(bc), ...Object.keys(ac)])) {
        const d = (ac[t] ?? 0) - (bc[t] ?? 0);
        if (d > 0) got[t] = (got[t] ?? 0) + d;
      }
    }
    for (const [t, n] of Object.entries(got)) (foundAll[t] ??= []).push(n);
    for (const t of Object.keys(foundAll)) if (got[t] === undefined) foundAll[t]!.push(0);
    resid.push(Object.values(state.npcs).filter((n) => (n as { status?: string }).status === "companion").length);
    jobsRun.push(Object.keys((state.player as unknown as { jobs?: Record<string, unknown> }).jobs ?? {}).length);
    stashN.push(state.player.stash.reduce((a, e) => a + e.quantity, 0));
    days.push(state.meta.day);
  }
  console.log(`  end day ${f1(mean(days))} · companions ${f2(mean(resid))} · stash units at end ${f2(mean(stashN))}\n`);
  console.log(`  EVERY item type gained, mean per run (sorted):`);
  const rows = Object.entries(foundAll).map(([t, xs]) => [t, mean(xs), Math.max(...xs), xs.filter((x) => x > 0).length / xs.length] as const)
    .sort((a, b) => b[1] - a[1]);
  for (const [t, m, mx, share] of rows) console.log(`    ${t.padEnd(26)} ${f2(m)}   max ${String(mx).padStart(3)}   in ${pct(share)} of runs`);
  console.log(`\n  node kinds SEARCHED (total across runs):`);
  const tot = Object.values(kinds).reduce((a, b) => a + b, 0);
  for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(14)} ${String(n).padStart(5)}  ${pct(n / Math.max(1, tot))}`);
}


// --- 8. POST: is the project reached, staged, finished? --------------------------------------------

type ProjRun = {
  endDay: number;
  end: string | null;
  claimDay: number | null;
  committed: string | null;
  commitDay: number | null;
  stages: number;
  stageDays: number[];
  won: boolean;
  blockedTurns: number;      // turns at base with a committed project and no affordable payment
  anchorLift: number;        // projectAlarm at the end
  threatEnd: number;         // mean region threat at the end
};

/**
 * One run of a bot that WANTS the ending. `zeal` decides how hard it pushes:
 *  - "settler": the T85 settler, unchanged, plus "take a project verb if one is on the list".
 *  - "zealot" : as settler, but it also hunts the districts whose tables hold what the next stage wants.
 */
function projRun(seed: string, actions: number, zeal: "settler" | "zealot", immortal: boolean): ProjRun {
  let { state, graph } = city(seed);
  let rng = 61;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
  const dist = hops(graph, state.player.location);
  const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
  const alarmOf = ENGINE["projectAlarm"] as ((s: GameState) => number) | undefined;
  const doneOf = ENGINE["projectStagesDone"] as ((s: GameState) => number) | undefined;
  let claimDay: number | null = null;
  let committed: string | null = null;
  let commitDay: number | null = null;
  const stageDays: number[] = [];
  let blockedTurns = 0;
  let lastStages = 0;
  for (let k = 0; k < actions; k += 1) {
    if (immortal) state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const here = state.player.location;
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    // A zealot that has committed and cannot pay goes shopping: walk toward the nearest node whose kind
    // is one the next stage's payments drop in, and search it.
    const wantKinds = (): string[] => {
      if (committed === null) return [];
      return ["industrial", "residential", "store", "generic"];
    };
    const shop = (): typeof choices[number] | undefined => {
      if (zeal !== "zealot" || committed === null) return undefined;
      const kinds = new Set(wantKinds());
      if (kinds.has(graph.nodes[here]?.kind ?? "generic") && (state.nodes[here]?.searchPct ?? 0) < 100) return prefer("search");
      let best: typeof choices[number] | undefined;
      let bestScore = -1;
      for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
        const to = m.id.slice("move:".length);
        const kind = graph.nodes[to]?.kind ?? "generic";
        const fresh = (state.nodes[to]?.searchPct ?? 0) < 100;
        const score = (kind === "industrial" ? 3 : kind === "residential" ? 3 : kind === "store" ? 2 : 1) + (fresh ? 2 : 0);
        if (score > bestScore) { bestScore = score; best = m; }
      }
      return best;
    };
    const toTarget = target === undefined ? undefined : hops(graph, target);
    const stepper = (): typeof choices[number] | undefined => {
      if (state.player.shelterId !== null || toTarget === undefined) return undefined;
      const dh = toTarget.get(here) ?? 99;
      if (dh === 0) return undefined;
      let best: typeof choices[number] | undefined; let bestD = dh;
      for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
        const d = toTarget.get(m.id.slice("move:".length)) ?? 99;
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    };
    // A zealot that is away and CAN pay walks home.
    const homeward = (): typeof choices[number] | undefined => {
      const sh = state.player.shelterId;
      if (zeal !== "zealot" || sh === null || here === sh || committed === null) return undefined;
      const toHome = hops(graph, sh);
      const dh = toHome.get(here) ?? 99;
      let best: typeof choices[number] | undefined; let bestD = dh;
      for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
        const d = toHome.get(m.id.slice("move:".length)) ?? 99;
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    };
    const advance = prefer("project-advance");
    const commit = zeal === "zealot" ? prefer("project-commit:project.holdout") ?? prefer("project-commit") : prefer("project-commit");
    const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("claim")
      ?? advance
      ?? commit
      ?? (zeal === "zealot" ? (homeward() ?? shop()) : undefined)
      ?? prefer("craft:recipe.shelter.")
      ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
      ?? stepper() ?? prefer("sleep") ?? prefer("search")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    // blocked: standing at base, committed, and no advance on offer
    if (committed !== null && state.player.shelterId === here && advance === undefined) blockedTurns += 1;
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    if (claimDay === null && state.player.shelterId !== null) claimDay = state.meta.day;
    if (committed === null && pick.id.startsWith("project-commit:")) { committed = pick.id.slice("project-commit:".length); commitDay = state.meta.day; }
    const nowStages = doneOf?.(state) ?? 0;
    while (nowStages > lastStages) { stageDays.push(state.meta.day); lastStages += 1; }
  }
  const end = runEndReason(state);
  const threats = Object.values(state.regions).map((r) => r.threat);
  return {
    endDay: state.meta.day, end, claimDay, committed, commitDay,
    stages: doneOf?.(state) ?? 0, stageDays, won: end === "escaped" || end === "held",
    blockedTurns, anchorLift: alarmOf?.(state) ?? 0,
    threatEnd: mean(threats),
  };
}

function project(zeal: "settler" | "zealot", immortal: boolean): void {
  console.log(`tree: ${TREE} · ${zeal}${immortal ? " · IMMORTAL (the CEILING)" : ""} · ${RUNS} runs x ${ACTIONS} actions\n`);
  const runs: ProjRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(projRun(`t87-proj-${i}`, ACTIONS, zeal, immortal));
  const ends: Record<string, number> = {};
  for (const r of runs) ends[r.end ?? "alive"] = (ends[r.end ?? "alive"] ?? 0) + 1;
  const comm = runs.filter((r) => r.committed !== null);
  console.log(`  end day              ${f1(mean(runs.map((r) => r.endDay)))}  (max ${Math.max(...runs.map((r) => r.endDay))})`);
  console.log(`  end reasons          ${Object.entries(ends).sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`  claimed a base       ${runs.filter((r) => r.claimDay !== null).length}/${runs.length}`);
  console.log(`  COMMITTED            ${comm.length}/${runs.length}  ${pct(comm.length / runs.length)}   mean day ${f1(mean(comm.map((r) => r.commitDay ?? 0)))}`);
  const byProj: Record<string, number> = {};
  for (const r of comm) byProj[r.committed!] = (byProj[r.committed!] ?? 0) + 1;
  for (const [k, v] of Object.entries(byProj).sort()) console.log(`      ${k.padEnd(36)} ${v}`);
  console.log(`  stages finished      ${f2(mean(runs.map((r) => r.stages)))}  (max ${Math.max(...runs.map((r) => r.stages))})`);
  for (let st = 1; st <= 3; st += 1) {
    const got = runs.filter((r) => r.stages >= st);
    console.log(`      stage ${st} reached   ${String(got.length).padStart(3)}/${runs.length}  ${pct(got.length / runs.length)}   mean day ${f1(mean(got.map((r) => r.stageDays[st - 1] ?? 0)))}`);
  }
  console.log(`  WON                  ${runs.filter((r) => r.won).length}/${runs.length}  ${pct(runs.filter((r) => r.won).length / runs.length)}`);
  console.log(`  blocked turns @base  ${f2(mean(runs.map((r) => r.blockedTurns)))}  (committed but nothing payable)`);
  console.log(`  project alarm at end ${f2(mean(runs.map((r) => r.anchorLift)))}`);
  console.log(`  mean region threat   ${f1(mean(runs.map((r) => r.threatEnd)))}`);
}

// --- 9. POST: does finishing a stage actually RAISE anything? --------------------------------------

function escal(): void {
  console.log(`tree: ${TREE} · does a completed stage move the world? PAIRED runs, same seed, SAMPLED AT FIXED DAYS\n`);
  const alarmOf = ENGINE["projectAlarm"] as ((s: GameState) => number) | undefined;
  if (alarmOf === undefined) { console.log("  (pre-T87 tree: no escalation to measure)"); return; }
  // The T81 probe lesson: a first cut read threat at RUN END and produced a clean FALSE trend, because
  // the project arm WINS and therefore ends on a different (earlier) day than the arm that cannot. The
  // only honest comparison is at the same clock, so both arms are sampled at the same fixed days and the
  // bot is immortal so neither arm drops out early.
  const DAYS = [3, 5, 8, 12, 16];
  type Sample = { threat: number; dens: number; act: number; loot: number; stages: number; alarm: number };
  const read = (seed: string, doProject: boolean): Map<number, Sample> => {
    let { state, graph } = city(seed);
    let rng = 61;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
    const dist = hops(graph, state.player.location);
    const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
    const out = new Map<number, Sample>();
    const sample = (): Sample => {
      const rs = Object.values(state.regions);
      return {
        threat: mean(rs.map((r) => r.threat)), dens: mean(rs.map((r) => r.zombieDensity)),
        act: mean(rs.map((r) => r.survivorActivity)), loot: mean(rs.map((r) => r.loot)),
        stages: (ENGINE["projectStagesDone"] as (s: GameState) => number)(state), alarm: alarmOf(state),
      };
    };
    for (let k = 0; k < ACTIONS; k += 1) {
      state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
      for (const d of DAYS) if (state.meta.day >= d && !out.has(d)) out.set(d, sample());
      // A WON run stops: its world stops moving too, so the last sample is carried forward rather than
      // invented. That is the honest shape — the arm that wins simply has no day 16.
      if (runEndReason(state) !== null) break;
      const all = availableActions(state, graph);
      const choices = doProject ? all : all.filter((c) => !c.id.startsWith("project-"));
      if (choices.length === 0) break;
      const here = state.player.location;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const toTarget = target === undefined ? undefined : hops(graph, target);
      const stepper = (): typeof choices[number] | undefined => {
        if (state.player.shelterId !== null || toTarget === undefined) return undefined;
        const dh = toTarget.get(here) ?? 99;
        if (dh === 0) return undefined;
        let best: typeof choices[number] | undefined; let bestD = dh;
        for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
          const d = toTarget.get(m.id.slice("move:".length)) ?? 99;
          if (d < bestD) { bestD = d; best = m; }
        }
        return best;
      };
      const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("claim")
        ?? prefer("project-advance") ?? prefer("project-commit")
        ?? prefer("craft:recipe.shelter.")
        ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
        ?? stepper() ?? prefer("sleep") ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
    }
    for (const d of DAYS) if (!out.has(d)) out.set(d, sample());
    return out;
  };
  const on: Map<number, Sample[]> = new Map(DAYS.map((d) => [d, []]));
  const off: Map<number, Sample[]> = new Map(DAYS.map((d) => [d, []]));
  for (let i = 0; i < RUNS; i += 1) {
    const a = read(`t87-escal-${i}`, true);
    const b = read(`t87-escal-${i}`, false);
    for (const d of DAYS) { on.get(d)!.push(a.get(d)!); off.get(d)!.push(b.get(d)!); }
  }
  console.log(`  IMMORTAL bot, ${RUNS} paired runs. The ONLY difference between arms is whether the project verbs were taken.\n`);
  console.log(`  day  stages  alarm |  threat ON / OFF  delta |  density ON / OFF  delta |  activity ON/OFF delta |  loot ON / OFF`);
  for (const d of DAYS) {
    const A = on.get(d)!, B = off.get(d)!;
    const m = (xs: Sample[], k: keyof Sample) => mean(xs.map((x) => x[k]));
    console.log(
      `  ${String(d).padStart(3)}  ${f2(m(A, "stages"))}  ${f2(m(A, "alarm"))} | ` +
      ` ${f1(m(A, "threat"))} /${f1(m(B, "threat"))} ${f1(m(A, "threat") - m(B, "threat"))} | ` +
      ` ${f1(m(A, "dens"))} /${f1(m(B, "dens"))} ${f1(m(A, "dens") - m(B, "dens"))} | ` +
      ` ${f1(m(A, "act"))} /${f1(m(B, "act"))} ${f1(m(A, "act") - m(B, "act"))} | ` +
      ` ${f1(m(A, "loot"))} /${f1(m(B, "loot"))}`);
  }
}

// --- dispatch -------------------------------------------------------------------------------------

const mode = process.argv[2] ?? "";
if (mode === "--dead") dead();
else if (mode === "--items") items();
else if (mode === "--surplus") surplus(false);
else if (mode === "--ceiling") surplus(true);
else if (mode === "--arc") arc();
else if (mode === "--drain") drain();
else if (mode === "--ledger") ledger(false);
else if (mode === "--ledger-immortal") ledger(true);
else if (mode === "--project") project("settler", false);
else if (mode === "--zealot") project("zealot", true);
else if (mode === "--zealot-mortal") project("zealot", false);
else if (mode === "--escal") escal();
else structure();
