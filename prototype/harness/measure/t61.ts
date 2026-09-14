/**
 * T61 measurement runner — the endings numbers quoted in `sim/ending.ts` and
 * `docs/qa/QA_REVIEW_T61.md`, re-derivable on demand (the T77–T87 discipline: a task's before/after
 * figures are worthless if the thing that produced them was a scratch script).
 * It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t61.ts              # STRUCTURE: the whole closing surface, as it stands
 *   npx tsx measure/t61.ts --distinct   # brief claim: two runs that end the same way read IDENTICALLY
 *   npx tsx measure/t61.ts --components # which run components actually CARRY SIGNAL at run end
 *   npx tsx measure/t61.ts --humanity   # PL-M4-15: does humanity move in real play, and how far?
 *   npx tsx measure/t61.ts --history    # is the Living History a usable source? type histogram
 *   npx tsx measure/t61.ts --pyrrhic    # PL-M5-67: how often does a run win WHILE dying?
 *   npx tsx measure/t61.ts --ceiling    # the same components, IMMORTAL — the reachable ceiling
 *
 * Every T61 lookup goes through a fallback, so BOTH trees run every mode line for line (the T87
 * lesson: never copy the runner into the baseline — write it so it does not need copying).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  runEndReason,
  sceneOf,
  startRun,
  type GameState,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T61 = ENGINE["assembleEnding"] !== undefined;
const TREE = HAS_T61 ? "POST-T61" : "PRE-T61";

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
    load("projects"),
  ];
  // T61 adds a 12th content argument (endings). Pre-T61 `startRun` ignores extra args, so one call
  // shape runs in both trees.
  args.push(load("endings"));
  return (startRun as unknown as (...a: unknown[]) => { state: GameState; graph: RegionGraph })(...args);
}

/**
 * The same city with **no ending pool registered** — the pre-T61 configuration, in either tree. This is
 * what `--identity` drives: with the pool absent T61 must be arithmetically invisible, so the narration,
 * the choice ids and the save blob have to match the pristine baseline byte for byte.
 */
function cityBare(seed: string): { state: GameState; graph: RegionGraph } {
  const args: unknown[] = [
    { seed, createdAt: "2026-09-14T00:00:00.000Z" },
    load("regions"), load("nodes"), load("npcs"),
    (ENGINE["STORY_ARCS"] as { id: string }[]).map((a) => a.id),
    load("encounters"), load("radio"), load("recipes"), load("jobs"), load("factions"), load("weapons"),
    load("projects"),
  ];
  return (startRun as unknown as (...a: unknown[]) => { state: GameState; graph: RegionGraph })(...args);
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const RUNS = Number(process.env["T61_RUNS"] ?? 40);
const ACTIONS = Number(process.env["T61_ACTIONS"] ?? 600);

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

// --- the bot ---------------------------------------------------------------------------------------

type Policy = "settler" | "drifter" | "zealot" | "holdout";

type Run = {
  seed: string;
  endDay: number;
  turns: number;
  end: string | null;
  closing: string;
  // components
  humanity: number;
  companionsAlive: number;
  companionsLost: number;
  npcsMet: number;
  npcsDied: number;
  shelterId: string | null;
  everClaimed: boolean;
  shelterLost: boolean;
  rooms: string[];
  barricades: number;
  kills: number;
  nodesVisited: number;
  searchedClean: number;
  committed: string | null;
  stages: number;
  endingFlags: Record<string, boolean>;
  hunger: number;
  thirst: number;
  infection: string;
  wounds: number;
  history: { type: string; day: number }[];
  reputation: number;
  arcs: Record<string, number>;
  lore: number;
  mysteries: number;
  shape: string | null;
  clauseIds: string[];
  admissible: number;
  atBase: boolean;
  nightsHeld: number;
  barricades2: number;
  combatAtBase: number;
  grabbedAtBase: number;
  turnsAtBase: number;
};

/** How many authored clauses this finished run ADMITS — the supply the ENDING_CLAUSE_LIMIT cap bites into. */
function admissibleCount(state: GameState, graph: RegionGraph): number {
  const shapeOf = ENGINE["endingShape"] as ((s: GameState) => string) | undefined;
  const summarize = ENGINE["summarizeRun"] as ((s: GameState, g: RegionGraph) => unknown) | undefined;
  const matches = ENGINE["matchesEnding"] as ((s: unknown, r: unknown) => boolean) | undefined;
  if (shapeOf === undefined || summarize === undefined || matches === undefined) return 0;
  if (runEndReason(state) === null) return 0;
  const def = (graph as { endings?: { shape: string; clauses: { when?: unknown }[] }[] }).endings
    ?.find((d) => d.shape === shapeOf(state));
  if (def === undefined) return 0;
  const sum = summarize(state, graph);
  return def.clauses.filter((c) => matches(sum, c.when)).length;
}

function play(seed: string, actions: number, policy: Policy, immortal = false): Run {
  let { state, graph } = city(seed);
  let rng = 37;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
  const dist = hops(graph, state.player.location);
  const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
  const visited = new Set<string>([state.player.location]);
  let kills = 0;
  let everClaimed = false;
  let companionsLost = 0;
  let combatAtBase = 0;
  let grabbedAtBase = 0;
  let turnsAtBase = 0;
  const seenCompanions = new Set<string>();

  for (let k = 0; k < actions; k += 1) {
    if (immortal) {
      state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
    }
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
      let best: typeof choices[number] | undefined;
      let bestD = dh;
      for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
        const d = toTarget.get(m.id.slice("move:".length)) ?? 99;
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    };
    const settlerPick = () =>
      prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("claim")
      ?? prefer("craft:recipe.shelter.")
      ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
      ?? stepper()
      ?? prefer("sleep")
      ?? prefer("search")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    const pick = policy === "settler"
      ? settlerPick()
      : policy === "zealot" || policy === "holdout"
        // `holdout` differs in ONE preference: which fork it takes. The two projects are exclusive, so a
        // bot that always takes the first commit choice offered only ever measures one of the two wins —
        // which is a property of the bot, not of the game, and saying so needs a bot that takes the other.
        ? (prefer("project-advance")
          ?? (policy === "holdout" ? prefer("project-commit:project.holdout") : undefined)
          ?? prefer("project-commit") ?? prefer("break") ?? prefer("strike") ?? prefer("fight")
          ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("claim") ?? settlerPick())
        : (prefer("break") ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? choices[rand(choices.length)]!);
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    visited.add(state.player.location);
    if (before.combat !== null && state.combat === null) kills += 1;
    if (state.player.shelterId !== null) everClaimed = true;
    if (state.player.shelterId !== null && state.player.location === state.player.shelterId) {
      turnsAtBase += 1;
      if (state.combat !== null) combatAtBase += 1;
      if (state.combat?.grabbed === true) grabbedAtBase += 1;
    }
    for (const id of Object.keys(state.actors)) seenCompanions.add(id);
    for (const id of seenCompanions) {
      if (before.actors[id] !== undefined && state.actors[id] === undefined) companionsLost += 1;
    }
  }

  const isComp = ENGINE["isCompanion"] as ((a: unknown) => boolean) | undefined;
  const companionsAlive = Object.values(state.actors).filter((a) => (isComp ? isComp(a) : true)).length;
  const humanityOf = ENGINE["humanityOf"] as ((s: GameState) => number) | undefined;
  const repOf = ENGINE["reputationOf"] as ((s: GameState) => number) | undefined;
  const cp = ENGINE["committedProject"] as ((s: GameState, g: RegionGraph) => { id: string } | null) | undefined;
  const flags = { ...state.story.endingFlags } as Record<string, boolean>;
  const sid = state.player.shelterId;
  const shapeOf = ENGINE["endingShape"] as ((s: GameState) => string) | undefined;
  const assemble = ENGINE["assembleEnding"] as ((s: GameState, g: RegionGraph) => { clauseIds: string[] } | null) | undefined;
  const ending = runEndReason(state) !== null && assemble ? assemble(state, graph) : null;
  return {
    seed,
    endDay: state.meta.day,
    turns: state.meta.turn,
    end: runEndReason(state),
    closing: sceneOf(state, graph).narration,
    humanity: humanityOf ? humanityOf(state) : (state.player as { humanity?: number }).humanity ?? 50,
    companionsAlive,
    companionsLost,
    npcsMet: Object.values(state.npcs).filter((n) => n.met).length,
    npcsDied: Object.values(state.npcs).filter((n) => !n.alive).length,
    shelterId: sid,
    everClaimed,
    shelterLost: everClaimed && sid === null,
    rooms: sid === null ? [] : [...((state.nodes[sid] as { rooms?: string[] })?.rooms ?? [])],
    barricades: sid === null ? 0 : state.nodes[sid]?.barricades ?? 0,
    kills,
    nodesVisited: visited.size,
    searchedClean: Object.values(state.nodes).filter((n) => n.searchPct >= 100).length,
    committed: cp ? (cp(state, graph)?.id ?? null) : null,
    stages: Object.keys(flags).filter((k) => k.startsWith("project.stage.")).length,
    endingFlags: flags,
    hunger: state.player.condition.needs.hunger,
    thirst: state.player.condition.needs.thirst,
    infection: state.player.condition.infection.stage,
    wounds: state.player.condition.wounds.length,
    history: state.history.map((h) => ({ type: h.type, day: h.day })),
    reputation: repOf ? repOf(state) : 0,
    arcs: { ...state.story.progress } as Record<string, number>,
    lore: state.story.lore.length,
    mysteries: Object.keys(state.story.mysteries).length,
    shape: shapeOf ? shapeOf(state) : null,
    clauseIds: ending === null ? [] : [...ending.clauseIds],
    admissible: admissibleCount(state, graph),
    atBase: sid !== null && state.player.location === sid,
    nightsHeld: state.history.filter((h) => h.type === "siege.held" || h.type === "siege.repelled").length,
    barricades2: sid === null ? 0 : state.nodes[sid]?.barricades ?? 0,
    combatAtBase, grabbedAtBase, turnsAtBase,
  };
}

// --- 1. structure ----------------------------------------------------------------------------------

function structure(): void {
  console.log(`tree: ${TREE}\n`);
  const files = engineSources();
  for (const [label, re] of [
    ["assembleEnding / Ending type", /\bassembleEnding\b|\binterface Ending\b|\btype Ending\b/],
    ["endingNarration", /\bendingNarration\b/],
    ["winNarration", /\bwinNarration\b/],
    ["epilogue", /\bepilogue/i],
    ["story.mysteries", /story\.mysteries|\bmysteries\b/],
    ["story.lore", /story\.lore/],
  ] as const) {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (re.test(line) && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//")) {
          hits.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 96)}`);
        }
      });
    }
    console.log(`  ${label} — ${hits.length} non-comment mention(s)`);
    for (const h of hits.slice(0, 14)) console.log(`      ${h}`);
    if (hits.length > 14) console.log(`      … ${hits.length - 14} more`);
    console.log();
  }
  const { state } = city("t61-structure");
  console.log(`  story at turn 0: ${JSON.stringify(state.story)}`);
  console.log(`  player.humanity at turn 0: ${(state.player as { humanity?: number }).humanity}`);
}

// --- 2. THE headline claim: do two runs that end the same way read the same? -----------------------

function distinct(policy: Policy, immortal = false): void {
  console.log(`tree: ${TREE} · ${policy}${immortal ? " IMMORTAL" : ""} · ${RUNS} runs × ${ACTIONS} actions`);
  console.log(`claim under test: the closing text is a FUNCTION OF THE REASON ALONE — two runs that end\n` +
    `the same way are byte-identical no matter what happened in them.\n`);
  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-distinct-${policy}-${i}`, ACTIONS, policy, immortal));
  const byReason = new Map<string, Run[]>();
  for (const r of runs) {
    const k = r.end ?? "(alive)";
    byReason.set(k, [...(byReason.get(k) ?? []), r]);
  }
  console.log(`  reason         runs   DISTINCT closings   distinct component fingerprints`);
  let totalDistinct = 0;
  for (const [reason, rs] of [...byReason.entries()].sort()) {
    const texts = new Set(rs.map((r) => r.closing));
    const fps = new Set(rs.map((r) => JSON.stringify([
      r.humanity, r.companionsAlive, r.companionsLost, r.npcsMet, r.npcsDied,
      r.everClaimed, r.shelterLost, r.rooms.length, r.kills, r.nodesVisited, r.stages, r.endDay,
    ])));
    totalDistinct += texts.size;
    console.log(`  ${reason.padEnd(12)} ${String(rs.length).padStart(5)}   ${String(texts.size).padStart(17)}   ${String(fps.size).padStart(31)}`);
  }
  const allTexts = new Set(runs.map((r) => r.closing));
  console.log(`\n  ${runs.length} runs → ${allTexts.size} distinct closing texts in total (${totalDistinct} within-reason).`);
  console.log(`  distinct component fingerprints across all runs: ${new Set(runs.map((r) => JSON.stringify([r.humanity, r.companionsAlive, r.npcsMet, r.npcsDied, r.everClaimed, r.rooms.length, r.kills, r.nodesVisited, r.stages]))).size}`);
  console.log(`\n  the texts:`);
  for (const t of [...allTexts].sort()) console.log(`    · ${t.slice(0, 150)}${t.length > 150 ? "…" : ""}`);
}

// --- 3. which components carry signal --------------------------------------------------------------

function components(policy: Policy, immortal: boolean): void {
  console.log(`tree: ${TREE} · ${policy}${immortal ? " IMMORTAL" : ""} · ${RUNS} runs × ${ACTIONS} actions`);
  console.log(`"an ending is assembled from components" is worth exactly what the components are worth.\n`);
  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-comp-${policy}-${i}`, ACTIONS, policy, immortal));
  const rows: [string, (r: Run) => number, string][] = [
    ["humanity (base 50)", (r) => r.humanity, "!=50"],
    ["companions alive at end", (r) => r.companionsAlive, ">0"],
    ["companions lost", (r) => r.companionsLost, ">0"],
    ["survivors MET", (r) => r.npcsMet, ">0"],
    ["survivors DIED", (r) => r.npcsDied, ">0"],
    ["base ever claimed", (r) => (r.everClaimed ? 1 : 0), ">0"],
    ["base LOST", (r) => (r.shelterLost ? 1 : 0), ">0"],
    ["rooms built", (r) => r.rooms.length, ">0"],
    ["barricades at end", (r) => r.barricades, ">0"],
    ["zombies killed", (r) => r.kills, ">0"],
    ["nodes visited", (r) => r.nodesVisited, ">0"],
    ["nodes searched clean", (r) => r.searchedClean, ">0"],
    ["project stages done", (r) => r.stages, ">0"],
    ["faction reputation", (r) => r.reputation, "!=0"],
    ["history events", (r) => r.history.length, ">0"],
    ["story.lore entries", (r) => r.lore, ">0"],
    ["story.mysteries entries", (r) => r.mysteries, ">0"],
    ["arcs past dormant", (r) => Object.values(r.arcs).filter((v) => v > 0).length, ">0"],
    ["end day", (r) => r.endDay, ">0"],
  ];
  console.log(`  component                    mean     min     max   runs with signal   DISTINCT values`);
  for (const [label, f, test] of rows) {
    const vs = runs.map(f);
    const signal = test === "!=50" ? vs.filter((v) => v !== 50) : test === "!=0" ? vs.filter((v) => v !== 0) : vs.filter((v) => v > 0);
    console.log(`  ${label.padEnd(26)} ${f2(mean(vs))} ${String(Math.min(...vs)).padStart(7)} ${String(Math.max(...vs)).padStart(7)}   ${pct(signal.length / runs.length)}          ${String(new Set(vs).size).padStart(6)}`);
  }
  const ends = new Map<string, number>();
  for (const r of runs) ends.set(r.end ?? "(alive)", (ends.get(r.end ?? "(alive)") ?? 0) + 1);
  console.log(`\n  end reasons: ${[...ends.entries()].sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
}

// --- 4. PL-M4-15 — humanity's teeth ----------------------------------------------------------------

function humanity(): void {
  console.log(`tree: ${TREE} · PL-M4-15: humanity is tracked and felt but nothing GATES on it.\n`);
  const enc = load<{ id: string; stages?: { choices?: { effects?: { kind?: string; delta?: number }[] }[] }[] }>("encounters");
  let effects = 0;
  let down = 0;
  let up = 0;
  let worst = 0;
  for (const e of enc) {
    const raw = JSON.stringify(e);
    for (const m of raw.matchAll(/"kind"\s*:\s*"adjustHumanity"\s*,\s*"delta"\s*:\s*(-?\d+)/g)) {
      effects += 1;
      const d = Number(m[1]);
      if (d < 0) { down += 1; worst += d; } else up += 1;
    }
  }
  console.log(`  authored adjustHumanity effects: ${effects} (${down} negative, ${up} positive)`);
  console.log(`  worst-case cumulative if every negative effect fired once: ${worst} (from a baseline of 50)`);
  for (const policy of ["settler", "drifter"] as Policy[]) {
    const runs: Run[] = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-hum-${policy}-${i}`, ACTIONS, policy));
    const vs = runs.map((r) => r.humanity);
    const moved = vs.filter((v) => v !== 50);
    console.log(`  ${policy.padEnd(8)} mean ${f1(mean(vs))}  min ${Math.min(...vs)}  max ${Math.max(...vs)}  moved in ${pct(moved.length / runs.length)} of runs  distinct ${new Set(vs).size}`);
  }
  const imm: Run[] = [];
  for (let i = 0; i < RUNS; i += 1) imm.push(play(`t61-hum-imm-${i}`, ACTIONS, "settler", true));
  const iv = imm.map((r) => r.humanity);
  console.log(`  IMMORTAL mean ${f1(mean(iv))}  min ${Math.min(...iv)}  max ${Math.max(...iv)}  moved in ${pct(iv.filter((v) => v !== 50).length / imm.length)} of runs  distinct ${new Set(iv).size}`);
}

// --- 5. the Living History as a source --------------------------------------------------------------

function history(immortal: boolean): void {
  console.log(`tree: ${TREE} · ${immortal ? "IMMORTAL " : ""}settler · what the append-only log actually holds\n`);
  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-hist-${i}`, ACTIONS, "settler", immortal));
  const counts = new Map<string, number[]>();
  for (const r of runs) {
    const per = new Map<string, number>();
    for (const h of r.history) per.set(h.type, (per.get(h.type) ?? 0) + 1);
    const seen = new Set([...per.keys(), ...counts.keys()]);
    for (const t of seen) counts.set(t, [...(counts.get(t) ?? []), per.get(t) ?? 0]);
  }
  console.log(`  events per run: mean ${f1(mean(runs.map((r) => r.history.length)))}  min ${Math.min(...runs.map((r) => r.history.length))}  max ${Math.max(...runs.map((r) => r.history.length))}`);
  console.log(`\n  type                     mean/run   runs with >=1`);
  for (const [t, vs] of [...counts.entries()].sort((a, b) => mean(b[1]) - mean(a[1]))) {
    while (vs.length < runs.length) vs.push(0);
    console.log(`  ${t.padEnd(24)} ${f2(mean(vs))}   ${pct(vs.filter((v) => v > 0).length / runs.length)}`);
  }
}

// --- 6. PL-M5-67 — the pyrrhic win ------------------------------------------------------------------

function pyrrhic(): void {
  console.log(`tree: ${TREE} · PL-M5-67: a run that WINS while dying reports the win. How often, and what\n` +
    `shade is sitting in the state that the closing text currently throws away?\n`);
  const runs: Run[] = [];
  for (let i = 0; i < RUNS * 3; i += 1) runs.push(play(`t61-pyr-${i}`, ACTIONS, "zealot", false));
  const wins = runs.filter((r) => r.end === "escaped" || r.end === "held");
  console.log(`  ${runs.length} zealot runs → ${wins.length} wins (${pct(wins.length / runs.length)})`);
  if (wins.length === 0) { console.log("  (no wins in this sample — re-run with T61_RUNS higher)"); return; }
  const hurt = wins.filter((r) => r.wounds > 0 || r.infection !== "none" || r.hunger >= 60 || r.thirst >= 60);
  const alone = wins.filter((r) => r.companionsAlive === 0);
  const bereaved = wins.filter((r) => r.npcsDied > 0 || r.companionsLost > 0);
  console.log(`  won while carrying wounds / fever / real hunger or thirst: ${hurt.length} (${pct(hurt.length / wins.length)})`);
  console.log(`  won ALONE (no companion at end):                          ${alone.length} (${pct(alone.length / wins.length)})`);
  console.log(`  won with someone dead behind them:                        ${bereaved.length} (${pct(bereaved.length / wins.length)})`);
  const texts = new Set(wins.map((r) => r.closing));
  console.log(`  DISTINCT closing texts across those ${wins.length} wins: ${texts.size}`);
}

// --- 7. the people component, at the source ---------------------------------------------------------

function people(): void {
  console.log(`tree: ${TREE} · who the city's authored people ARE at turn 0, and what becomes of them\n`);
  const { state } = city("t61-people");
  const n = Object.values(state.npcs);
  console.log(`  authored npcs: ${n.length} · alive at seed ${n.filter((x) => x.alive).length} · met at seed ${n.filter((x) => x.met).length}`);
  console.log(`  actors at seed: ${Object.keys(state.actors).length}`);
  for (const policy of ["settler", "drifter"] as Policy[]) {
    for (const immortal of [false, true]) {
      const runs: Run[] = [];
      for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-people-${policy}-${immortal}-${i}`, ACTIONS, policy, immortal));
      console.log(`  ${policy.padEnd(8)}${immortal ? " IMMORTAL" : "         "}  end day ${f1(mean(runs.map((r) => r.endDay)))}` +
        `  met ${f2(mean(runs.map((r) => r.npcsMet)))}  died ${f2(mean(runs.map((r) => r.npcsDied)))}` +
        `  companions ${f2(mean(runs.map((r) => r.companionsAlive)))}  runs with ANY met ${pct(runs.filter((r) => r.npcsMet > 0).length / runs.length)}`);
    }
  }
}

// --- dispatch ----------------------------------------------------------------------------------------

// --- 8. POST — the assembled ending -----------------------------------------------------------------

function endings(policy: Policy, immortal: boolean): void {
  console.log(`tree: ${TREE} · ${policy}${immortal ? " IMMORTAL" : ""} · ${RUNS} runs × ${ACTIONS} actions\n`);
  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-endings-${policy}-${i}`, ACTIONS, policy, immortal));
  const done = runs.filter((r) => r.end !== null);
  const shapes = new Map<string, number>();
  for (const r of done) shapes.set(r.shape ?? "(none)", (shapes.get(r.shape ?? "(none)") ?? 0) + 1);
  console.log(`  shape distribution over ${done.length} finished runs:`);
  for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(14)} ${String(v).padStart(4)}  ${pct(v / done.length)}`);
  }
  console.log(`\n  reason         runs   DISTINCT closings   distinct fingerprints`);
  const byReason = new Map<string, Run[]>();
  for (const r of done) byReason.set(r.end!, [...(byReason.get(r.end!) ?? []), r]);
  for (const [reason, rs] of [...byReason.entries()].sort()) {
    const texts = new Set(rs.map((r) => r.closing));
    const fps = new Set(rs.map((r) => JSON.stringify([r.humanity, r.companionsAlive, r.npcsMet, r.npcsDied, r.everClaimed, r.rooms.length, r.kills, r.nodesVisited, r.stages, r.endDay])));
    console.log(`  ${reason.padEnd(12)} ${String(rs.length).padStart(5)}   ${String(texts.size).padStart(17)}   ${String(fps.size).padStart(21)}`);
  }
  console.log(`\n  ${done.length} finished runs → ${new Set(done.map((r) => r.closing)).size} distinct closing texts`);
  console.log(`  clause SUPPLY per run (admissible): mean ${f2(mean(done.map((r) => r.admissible)))}` +
    `  min ${Math.min(...done.map((r) => r.admissible))}  max ${Math.max(...done.map((r) => r.admissible))}` +
    `  — runs where the cap BINDS: ${pct(done.filter((r) => r.admissible > 3).length / done.length)}`);
  const fired = new Map<string, number>();
  for (const r of done) for (const c of r.clauseIds) fired.set(c, (fired.get(c) ?? 0) + 1);
  console.log(`\n  clause                       fired in`);
  for (const [c, n] of [...fired.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(28)} ${pct(n / done.length)}`);
  }
  console.log(`\n  sample closings:`);
  for (const r of done.slice(0, 3)) console.log(`\n   [${r.shape}/${r.end}] ${r.closing}`);
}

// --- 9. POST — clause coverage: is anything authored-and-unselectable? --------------------------------

function coverage(): void {
  console.log(`tree: ${TREE} · every authored clause, across all policies and both mortality modes\n`);
  const defs = load<{ id: string; shape: string; clauses: { id: string }[] }>("endings");
  const admissible = new Map<string, number>();
  const fired = new Map<string, number>();
  for (const d of defs) for (const c of d.clauses) { admissible.set(`${d.shape}/${c.id}`, 0); fired.set(`${d.shape}/${c.id}`, 0); }
  let done = 0;
  for (const policy of ["settler", "drifter", "zealot", "holdout"] as Policy[]) {
    for (const immortal of [false, true]) {
      for (let i = 0; i < RUNS; i += 1) {
        const r = play(`t61-cov-${policy}-${immortal}-${i}`, ACTIONS, policy, immortal);
        if (r.end === null) continue;
        done += 1;
        for (const c of r.clauseIds) fired.set(`${r.shape}/${c}`, (fired.get(`${r.shape}/${c}`) ?? 0) + 1);
      }
    }
  }
  console.log(`  ${done} finished runs\n`);
  console.log(`  shape/clause                          FIRED in`);
  for (const [k, v] of [...fired.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${k.padEnd(38)} ${pct(v / done)}${v === 0 ? "   <-- NEVER SELECTED" : ""}`);
  }
  console.log(`\n  authored clauses: ${fired.size} · ever selected: ${[...fired.values()].filter((v) => v > 0).length}` +
    ` · never selected: ${[...fired.values()].filter((v) => v === 0).length}`);
  void admissible;
}

// --- 10. byte-identity with no pool registered --------------------------------------------------------

function identity(): void {
  const saveGame = ENGINE["saveGame"] as ((s: GameState) => string) | undefined;
  const lines: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    let { state, graph } = cityBare(`t61-identity-${i}`);
    let rng = 37;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    for (let k = 0; k < 400; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      lines.push(`${i}|${k}|${sceneOf(state, graph).narration}|${choices.map((c) => c.id).join(",")}`);
      const before = state;
      state = applyAction(state, choices[rand(choices.length)]!.action, graph).state;
      if (state === before) break;
    }
    lines.push(`${i}|END|${sceneOf(state, graph).narration}|${String(runEndReason(state))}`);
    if (saveGame !== undefined) lines.push(`${i}|SAVE|${saveGame(state)}`);
  }
  const blob = lines.join("\n");
  // A cheap order-sensitive digest — no crypto import, and the engine package is dependency-free.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < blob.length; i += 1) {
    h1 = Math.imul(h1 ^ blob.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + blob.charCodeAt(i) * (i + 1), 2246822519) >>> 0;
  }
  console.log(`tree: ${TREE} · NO ending pool registered`);
  console.log(`  lines: ${lines.length}  chars: ${blob.length}  digest: ${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`);
}

// --- 11. is the SACRIFICE shape reachable? ------------------------------------------------------------

function sacrifice(): void {
  console.log(`tree: ${TREE} · what a Last Stand actually looks like, and which sacrifice rule can fire\n`);
  const runs: Run[] = [];
  for (const policy of ["settler", "zealot", "holdout"] as Policy[]) {
    for (let i = 0; i < RUNS; i += 1) runs.push(play(`t61-sac-${policy}-${i}`, ACTIONS, policy, false));
  }
  const done = runs.filter((r) => r.end !== null);
  const ls = done.filter((r) => r.end === "lastStand");
  console.log(`  ${done.length} finished runs · ${ls.length} Last Stands (${pct(ls.length / done.length)})`);
  const rows: [string, (r: Run) => boolean][] = [
    ["lastStand AND at a base still held", (r) => r.end === "lastStand" && r.atBase],
    ["  … and walls standing", (r) => r.end === "lastStand" && r.atBase && r.barricades2 > 0],
    ["  … and a night held", (r) => r.end === "lastStand" && r.atBase && r.nightsHeld > 0],
    ["  … and EITHER (the shipped rule)", (r) => r.end === "lastStand" && r.atBase && (r.nightsHeld > 0 || r.barricades2 > 0)],
    ["lastStand AND ever claimed (the OLD rule)", (r) => r.end === "lastStand" && r.everClaimed],
  ];
  for (const [label, f] of rows) {
    const n = done.filter(f).length;
    console.log(`  ${label.padEnd(44)} ${String(n).padStart(4)}  ${pct(n / done.length)} of runs`);
  }
  const shapes = new Map<string, number>();
  for (const r of done) shapes.set(r.shape ?? "(none)", (shapes.get(r.shape ?? "(none)") ?? 0) + 1);
  console.log(`\n  shapes: ${[...shapes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / done.length)}`).join(" · ")}`);
  console.log(`  barricades > 0 at end, in any run: ${pct(done.filter((r) => r.barricades2 > 0).length / done.length)}`);
  console.log(`  nights held > 0, in any run:       ${pct(done.filter((r) => r.nightsHeld > 0).length / done.length)}`);
  console.log(`\n  WHY: is a fight at your own base even possible?`);
  console.log(`    turns spent standing in a held base:  ${f1(mean(done.map((r) => r.turnsAtBase)))} per run · runs with any: ${pct(done.filter((r) => r.turnsAtBase > 0).length / done.length)}`);
  console.log(`    turns IN COMBAT at a held base:       ${f2(mean(done.map((r) => r.combatAtBase)))} per run · runs with any: ${pct(done.filter((r) => r.combatAtBase > 0).length / done.length)}`);
  console.log(`    turns GRABBED at a held base:         ${f2(mean(done.map((r) => r.grabbedAtBase)))} per run · runs with any: ${pct(done.filter((r) => r.grabbedAtBase > 0).length / done.length)}`);
}

const mode = process.argv[2] ?? "";
if (mode === "--distinct") distinct("settler");
else if (mode === "--distinct-imm") distinct("settler", true);
else if (mode === "--components") components("settler", false);
else if (mode === "--ceiling") components("settler", true);
else if (mode === "--drifter") components("drifter", false);
else if (mode === "--humanity") humanity();
else if (mode === "--history") history(false);
else if (mode === "--history-imm") history(true);
else if (mode === "--pyrrhic") pyrrhic();
else if (mode === "--people") people();
else if (mode === "--endings") endings("settler", false);
else if (mode === "--coverage") coverage();
else if (mode === "--sacrifice") sacrifice();
else if (mode === "--identity") identity();
else if (mode === "--endings-zealot") endings("zealot", false);
else if (mode === "--endings-holdout") endings("holdout", false);
else if (mode === "--endings-imm") endings("settler", true);
else structure();
