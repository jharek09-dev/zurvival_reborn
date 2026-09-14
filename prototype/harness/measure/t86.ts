/**
 * T86 measurement runner — the faction-reputation numbers quoted in `sim/social.ts`, `sim/events.ts`
 * and `docs/qa/QA_REVIEW_T86.md`, re-derivable on demand (the T77–T85 discipline: a task's
 * before/after figures are worthless if the thing that produced them was a scratch script).
 * It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t86.ts             # STRUCTURE: the faction pool as authored, and who is where
 *   npx tsx measure/t86.ts --dead      # brief claim (a): reputation/groups are WRITE-ONLY — enumerate readers
 *   npx tsx measure/t86.ts --kinds     # brief claim (b): dead TrustEventKind / SOCIAL_DELTAS entries
 *   npx tsx measure/t86.ts --reach     # does a real run ever STAND in faction territory / meet a member?
 *   npx tsx measure/t86.ts --ceiling   # the same, IMMORTAL — reach as a hard ceiling, not a bot artifact
 *   npx tsx measure/t86.ts --move      # does player.reputation ever move in a real run?
 *   npx tsx measure/t86.ts --diplomat  # the MAXIMUM-FAVOURABLE player: immortal, tours every faction
 *                                      # member, talks, feeds, waters, recruits. Can a faction
 *                                      # relationship exist AT ALL?
 *   npx tsx measure/t86.ts --rep       # POST: does reputation move, and what does it gate?
 *   npx tsx measure/t86.ts --standing  # POST: how far can a player who TRIES push standing? (3 policies)
 *   npx tsx measure/t86.ts --zealot    # POST: the CEILING — an immortal bot that tours every authored
 *                                      # standing act for one faction and takes the extreme choice each
 *                                      # time. Is REPUTATION_HOSTILE_AT / _WARM_AT crossable AT ALL?
 *
 * Every T86 lookup goes through a fallback, so both trees run the same modes line for line.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  runEndReason,
  startRun,
  socialActive,
  factionPool,
  SOCIAL_DELTAS,
  TRUST_DELTAS,
  type GameState,
  type RegionGraph,
  type FactionDef,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T86 = ENGINE["REPUTATION_HOSTILE_AT"] !== undefined;
const TREE = HAS_T86 ? "POST-T86" : "PRE-T86";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = join(ROOT, "content");
const ENGINE_SRC = join(ROOT, "prototype", "engine", "src");
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
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const RUNS = Number(process.env["T86_RUNS"] ?? 40);
const ACTIONS = Number(process.env["T86_ACTIONS"] ?? 600);

/** Every .ts file under engine/src, for the source-scan claims. */
function engineSources(dir = ENGINE_SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) engineSources(p, out);
    else if (e.endsWith(".ts")) out.push(p);
  }
  return out;
}
const rel = (p: string): string => p.slice(ENGINE_SRC.length + 1).replace(/\\/g, "/");

// --- 1. structure ---------------------------------------------------------------------------------

function structure(): void {
  const { state, graph } = city("t86-structure");
  const defs = load<FactionDef>("factions");
  console.log(`tree: ${TREE}\n`);
  console.log(`socialActive on the SHIPPED content: ${socialActive(graph)} (${factionPool(graph).length} factions)\n`);
  for (const d of [...defs].sort((a, b) => a.id.localeCompare(b.id))) {
    const g = state.groups[d.id];
    const region = d.homeNode === undefined ? "—" : (graph.nodes[d.homeNode]?.regionId ?? "?");
    console.log(`  ${d.id}`);
    console.log(`    archetype ${d.archetype.padEnd(12)} home ${String(d.homeNode ?? "—").padEnd(34)} region ${region}`);
    console.log(`    seeded: strength ${String(g?.strength ?? "?").padStart(3)} · hostility ${String(g?.hostility ?? "?").padStart(3)} · reputation ${String(state.player.reputation[d.id] ?? "?").padStart(4)}`);
    const members = d.members.map((m) => {
      const n = state.npcs[m];
      return `${m} (${n?.disposition ?? "ABSENT"} @ ${n?.location ?? "—"})`;
    });
    console.log(`    members: ${members.join("\n              ")}`);
    if ((d.rivalries ?? []).length > 0) console.log(`    rivalries: ${(d.rivalries ?? []).map((r) => `${r.a}↔${r.b}`).join(", ")}`);
    const rivalOf = (ENGINE["factionRivalsOf"] as ((g: RegionGraph, id: string) => readonly string[]) | undefined);
    if (rivalOf !== undefined) console.log(`    faction rivals: ${rivalOf(graph, d.id).join(", ") || "(none)"}`);
    console.log("");
  }
  const homeRegions = new Set(defs.map((d) => (d.homeNode === undefined ? "" : graph.nodes[d.homeNode]?.regionId ?? "")).filter((r) => r !== ""));
  console.log(`  faction home regions: ${[...homeRegions].sort().join(", ")} (${homeRegions.size} of ${Object.keys(graph.regions).length})`);
  const inFaction = new Set(defs.flatMap((d) => d.members));
  const allNpcs = Object.keys(state.npcs);
  console.log(`  survivors in a faction: ${inFaction.size} of ${allNpcs.length}; unaffiliated: ${allNpcs.filter((n) => !inFaction.has(n)).sort().join(", ")}`);
}

// --- 2. the write-only claim ----------------------------------------------------------------------

function dead(): void {
  console.log(`tree: ${TREE} · brief claim (a): player.reputation / state.groups are WRITE-ONLY\n`);
  const files = engineSources();
  for (const [label, re] of [
    ["player.reputation", /\breputation\b/],
    ["state.groups", /\bgroups\b/],
    ["group hostility", /\bhostility\b/],
    ["group strength", /\bstrength\b/],
  ] as const) {
    console.log(`  ${label}:`);
    let hits = 0;
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (!re.test(ln)) return;
        const isComment = /^\s*(\*|\/\/|\/\*)/.test(ln);
        if (isComment) return;
        hits += 1;
        console.log(`    ${rel(f)}:${i + 1}  ${ln.trim().slice(0, 118)}`);
      });
    }
    if (hits === 0) console.log(`    (no non-comment occurrence anywhere in engine/src)`);
    console.log("");
  }
  // exported-and-never-imported check for the faction reads
  for (const sym of ["factionArchetype", "factionOf", "factionPool", "areRivals", "bondSeed", "factionIdOfNpc"]) {
    const callers = files.filter((f) => {
      if (rel(f) === "index.ts" || rel(f) === "sim/social.ts") return false;
      return new RegExp(`\\b${sym}\\b`).test(readFileSync(f, "utf8"));
    }).map(rel);
    console.log(`  ${sym.padEnd(18)} used outside social.ts/index.ts by: ${callers.join(", ") || "NOTHING"}`);
  }
}

// --- 3. dead enum entries -------------------------------------------------------------------------

function kinds(): void {
  console.log(`tree: ${TREE} · brief claim (b): dead TrustEventKind / SOCIAL_DELTAS entries\n`);
  const files = engineSources();
  const blob = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const applied = new Set<string>();
  for (const m of blob.matchAll(/applyTrustEvent\([^)]*?,\s*"([a-z-]+)"/g)) applied.add(m[1]!);
  console.log(`  TrustEventKind — applyTrustEvent call sites use: ${[...applied].sort().join(", ") || "(none)"}`);
  for (const k of Object.keys(TRUST_DELTAS).sort()) {
    console.log(`    ${k.padEnd(10)} delta ${String(TRUST_DELTAS[k as keyof typeof TRUST_DELTAS]).padStart(4)}  ${applied.has(k) ? "REACHABLE" : "DEAD"}`);
  }
  const remembered = new Set<string>();
  for (const m of blob.matchAll(/remember\([^)]*?,\s*"([a-z-]+)"/g)) remembered.add(m[1]!);
  console.log(`\n  SOCIAL_DELTAS — remember() call sites use: ${[...remembered].sort().join(", ") || "(none)"}`);
  for (const k of Object.keys(SOCIAL_DELTAS).sort()) {
    const d = SOCIAL_DELTAS[k]!;
    console.log(`    ${k.padEnd(12)} respect ${String(d.respect).padStart(4)} fear ${String(d.fear).padStart(4)}  ${remembered.has(k) ? "REACHABLE" : "DEAD"}`);
  }
  // content-side: which encounter effects touch trust / humanity / reputation
  const encs = load<{ id: string; stages: { choices: { effects: { kind: string; delta?: number }[] }[] }[] }>("encounters");
  const count: Record<string, number> = {};
  const negHumanity: string[] = [];
  for (const e of encs) for (const s of e.stages) for (const c of s.choices) for (const ef of c.effects) {
    count[ef.kind] = (count[ef.kind] ?? 0) + 1;
    if (ef.kind === "adjustHumanity" && (ef.delta ?? 0) < 0 && !negHumanity.includes(e.id)) negHumanity.push(e.id);
  }
  console.log(`\n  authored encounter effects across ${encs.length} encounters:`);
  for (const [k, n] of [...Object.entries(count)].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(20)} ${String(n).padStart(3)}`);
  console.log(`\n  encounters with a NEGATIVE adjustHumanity (the saw-cruelty hook the brief wants): ${negHumanity.length}`);
  for (const id of negHumanity.sort()) console.log(`    ${id}`);
}

// --- 4. reach: does a real run ever stand in faction territory? ------------------------------------

type ReachRun = {
  atHome: Record<string, number>;      // turns spent standing on a faction homeNode
  inRegion: Record<string, number>;    // turns spent in a faction's home REGION
  met: string[];                       // faction members met
  recruited: string[];
  repStart: Record<string, number>;
  repEnd: Record<string, number>;
  encounters: number;
  talks: number;
  endDay: number;
  end: string | null;
};

function reachRun(seed: string, actions: number, directed: string | null, immortal = false): ReachRun {
  let { state, graph } = city(seed);
  let rng = 41;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const defs = load<FactionDef>("factions");
  const homeOf: Record<string, string> = {};
  const regionOf: Record<string, string> = {};
  for (const d of defs) if (d.homeNode !== undefined) { homeOf[d.id] = d.homeNode; regionOf[d.id] = graph.nodes[d.homeNode]?.regionId ?? ""; }
  const atHome: Record<string, number> = {};
  const inRegion: Record<string, number> = {};
  const repStart = { ...state.player.reputation };
  const met = new Set<string>();
  const recruited = new Set<string>();
  const members = new Set(defs.flatMap((d) => d.members));
  let encounters = 0;
  let talks = 0;
  const target = directed === null ? undefined : homeOf[directed];
  const toTarget = target === undefined ? undefined : hops(graph, target);
  for (let k = 0; k < actions; k += 1) {
    // The T85 probe lesson: an "immortal" bot that clears wounds but not `condition.infection` is not
    // immortal — it dies of infection at turn ~275 and answers a question about REACH with a fact
    // about its blood. Zero all three.
    if (immortal) {
      state = {
        ...state,
        player: {
          ...state.player,
          condition: {
            ...state.player.condition,
            needs: { hunger: 0, thirst: 0, fatigue: 0 },
            wounds: [],
            infection: { stage: "none", progression: 0 },
          },
        },
      };
    }
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const here = state.player.location;
    for (const [fid, node] of Object.entries(homeOf)) if (here === node) atHome[fid] = (atHome[fid] ?? 0) + 1;
    for (const [fid, reg] of Object.entries(regionOf)) if (graph.nodes[here]?.regionId === reg) inRegion[fid] = (inRegion[fid] ?? 0) + 1;
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    const stepper = (): typeof choices[number] | undefined => {
      if (toTarget === undefined) return undefined;
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
    const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("event:") ?? prefer("recruit:") ?? prefer("talk:")
      ?? stepper()
      ?? prefer("search") ?? prefer("sleep")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    if (pick.id.startsWith("event:")) encounters += 1;
    if (pick.id.startsWith("talk:")) talks += 1;
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    for (const id of members) {
      if (state.npcs[id]?.met === true) met.add(id);
      if (state.actors[id] !== undefined) recruited.add(id);
    }
  }
  return {
    atHome, inRegion, met: [...met].sort(), recruited: [...recruited].sort(),
    repStart, repEnd: { ...state.player.reputation }, encounters, talks,
    endDay: state.meta.day, end: runEndReason(state),
  };
}

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

function reportReach(label: string, runs: ReachRun[]): void {
  const defs = load<FactionDef>("factions");
  console.log(`  ${label}`);
  for (const d of [...defs].sort((a, b) => a.id.localeCompare(b.id))) {
    const home = runs.filter((r) => (r.atHome[d.id] ?? 0) > 0).length;
    const reg = runs.filter((r) => (r.inRegion[d.id] ?? 0) > 0).length;
    console.log(`    ${d.id.padEnd(26)} stood on its home node in ${pct(home / runs.length)} of runs (mean ${f2(mean(runs.map((r) => r.atHome[d.id] ?? 0)))} turns) · in its home REGION ${pct(reg / runs.length)}`);
  }
  const allMembers = new Set(defs.flatMap((d) => d.members));
  console.log(`    faction members MET      : mean ${f2(mean(runs.map((r) => r.met.length)))} of ${allMembers.size}`);
  console.log(`    faction members RECRUITED: mean ${f2(mean(runs.map((r) => r.recruited.length)))}`);
  console.log(`    talk: choices taken      : mean ${f2(mean(runs.map((r) => r.talks)))}`);
  console.log(`    encounter choices taken  : mean ${f2(mean(runs.map((r) => r.encounters)))}`);
  const ends: Record<string, number> = {};
  for (const r of runs) ends[r.end ?? "(survived)"] = (ends[r.end ?? "(survived)"] ?? 0) + 1;
  console.log(`    mean end day ${f1(mean(runs.map((r) => r.endDay)))} · ends: ${Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}

function reach(immortal = false): void {
  console.log(`tree: ${TREE} · ${RUNS} runs × ${ACTIONS} actions${immortal ? " · IMMORTAL (needs/wounds/infection zeroed each turn)" : ""} — does a real run reach faction territory?\n`);
  reportReach("UNDIRECTED (takes an encounter/recruit/talk when offered, otherwise wanders):",
    Array.from({ length: RUNS }, (_, i) => reachRun(`t86-reach-${i}`, ACTIONS, null, immortal)));
  console.log("");
  for (const d of load<FactionDef>("factions")) {
    reportReach(`GOAL-DIRECTED at ${d.id} (${d.homeNode}):`,
      Array.from({ length: RUNS }, (_, i) => reachRun(`t86-goal-${d.id}-${i}`, ACTIONS, d.id, immortal)));
    console.log("");
  }
}

// --- 5. does reputation ever move? ----------------------------------------------------------------

function move(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs × ${ACTIONS} actions — does player.reputation ever MOVE?\n`);
  const defs = load<FactionDef>("factions");
  const all: ReachRun[] = [];
  for (let i = 0; i < RUNS; i += 1) all.push(reachRun(`t86-move-${i}`, ACTIONS, null));
  for (const d of defs) for (let i = 0; i < RUNS; i += 1) all.push(reachRun(`t86-movegoal-${d.id}-${i}`, ACTIONS, d.id));
  let moved = 0;
  const deltas: Record<string, number[]> = {};
  for (const r of all) {
    let any = false;
    for (const k of Object.keys(r.repStart)) {
      const dlt = (r.repEnd[k] ?? 0) - (r.repStart[k] ?? 0);
      (deltas[k] ??= []).push(dlt);
      if (dlt !== 0) any = true;
    }
    if (any) moved += 1;
  }
  console.log(`  runs where ANY reputation changed: ${moved} of ${all.length} (${pct(moved / all.length)})`);
  for (const k of Object.keys(deltas).sort()) {
    const xs = deltas[k]!;
    console.log(`    ${k.padEnd(26)} mean Δ ${f2(mean(xs))} · min ${Math.min(...xs)} · max ${Math.max(...xs)} · runs that moved ${pct(xs.filter((x) => x !== 0).length / xs.length)}`);
  }
}

// --- 5b. the diplomat: the maximum-favourable social player ---------------------------------------
// The reach probe above never recruits a faction member in 320 runs (160 of them immortal), but it is
// an undirected wanderer wearing a social hat. This one is the ceiling: immortal, and it walks a tour
// of every faction member's node in turn, taking talk/give/recruit whenever offered. What it CANNOT
// do is a property of the engine, not of the bot.

function diplomat(): void {
  const defs = load<FactionDef>("factions");
  const members = [...new Set(defs.flatMap((d) => d.members))].sort();
  const SEEDS = Math.max(4, Math.trunc(RUNS / 4));
  console.log(`tree: ${TREE} · ONE IMMORTAL SUITOR PER SURVIVOR × ${SEEDS} seeds × ${ACTIONS} actions`);
  console.log(`(walks straight to that survivor, then talks / feeds / waters / recruits — nothing else)\n`);
  console.log(`  survivor                 faction                    disp       start  arrived    met   gave  RECRUITED  mean end trust`);
  const summary: { recruited: number; met: number }[] = [];
  for (const m of members) {
    const f = defs.find((d) => d.members.includes(m));
    let arrived = 0, met = 0, recruited = 0, gaveN = 0; const endTrust: number[] = []; let start = 0, disp = "?";
    for (let i = 0; i < SEEDS; i += 1) {
      let { state, graph } = city(`t86-dip-${m}-${i}`);
      let rng = 53;
      const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
      const target = state.npcs[m]?.location ?? null;
      start = state.npcs[m]?.trust ?? 0;
      disp = state.npcs[m]?.disposition ?? "?";
      const toTarget = target === null ? undefined : hops(graph, target);
      let here0 = false, gave = false;
      for (let k = 0; k < ACTIONS; k += 1) {
        state = {
          ...state,
          player: {
            ...state.player,
            condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } },
          },
        };
        if (runEndReason(state) !== null) break;
        const choices = availableActions(state, graph);
        if (choices.length === 0) break;
        const here = state.player.location;
        if (here === target) here0 = true;
        const prefer = (pfx: string) => choices.find((c) => c.id.startsWith(pfx));
        const stepper = (): typeof choices[number] | undefined => {
          if (toTarget === undefined) return undefined;
          const dh = toTarget.get(here) ?? 99;
          if (dh === 0) return undefined;
          let best: typeof choices[number] | undefined; let bestD = dh;
          for (const mv of choices.filter((c) => c.id.startsWith("move:"))) {
            const d = toTarget.get(mv.id.slice("move:".length)) ?? 99;
            if (d < bestD) { bestD = d; best = mv; }
          }
          return best;
        };
        const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
          ?? choices.find((c) => c.id === `recruit:${m}`)
          // `talk:` is offered ONLY while unmet, and `met` is the recruit gate — so it must outrank the
          // gives. The first cut preferred give-food, so the suitor fed every survivor to exactly
          // RECRUIT_MIN trust and was never offered the recruit, which is a fact about the BOT.
          ?? choices.find((c) => c.id === `talk:${m}`)
          ?? choices.find((c) => c.id === `give-food:${m}`)
          ?? choices.find((c) => c.id === `give-water:${m}`)
          ?? prefer("event:")
          ?? stepper()
          ?? prefer("search")
          ?? (() => { const mv = choices.filter((c) => c.id.startsWith("move")); return mv.length > 0 ? mv[rand(mv.length)] : undefined; })()
          ?? choices[rand(choices.length)]!;
        if (pick.id.startsWith("give-")) gave = true;
        const before = state;
        state = applyAction(state, pick.action, graph).state;
        if (state === before) break;
      }
      if (here0) arrived += 1;
      if (gave) gaveN += 1;
      if (state.npcs[m]?.met === true || state.actors[m] !== undefined) met += 1;
      if (state.actors[m] !== undefined) recruited += 1;
      endTrust.push(state.npcs[m]?.trust ?? (state.actors[m] as { trust?: number } | undefined)?.trust ?? start);
    }
    summary.push({ recruited, met });
    console.log(`  ${m.padEnd(24)} ${String(f?.id ?? "—").padEnd(26)} ${disp.padEnd(10)} ${String(start).padStart(4)} ${pct(arrived / SEEDS)} ${pct(met / SEEDS)} ${pct(gaveN / SEEDS)}  ${pct(recruited / SEEDS)}  ${f1(mean(endTrust))}`);
  }
  console.log(`\n  RECRUIT_MIN = ${String(ENGINE["RECRUIT_MIN"])} · PARLEY_MIN = ${String(ENGINE["PARLEY_MIN"])} · TRUST_DELTAS.share = ${String(TRUST_DELTAS.share)}`);
  console.log(`  survivors this maximum-favourable player could recruit at all: ${summary.filter((x) => x.recruited > 0).length} of ${members.length}`);
  console.log(`  survivors it could even MEET: ${summary.filter((x) => x.met > 0).length} of ${members.length}`);
}

// --- 6. POST modes ---------------------------------------------------------------------------------

function repPost(): void { move(); }

// --- 6. POST · how far can standing actually travel? ----------------------------------------------
// The `--move` bot takes whatever encounter choice comes first, which is a fact about the bot. This one
// runs three explicit POLICIES over the same seeds and reports the range: how far standing travels, and
// whether REPUTATION_HOSTILE_AT / REPUTATION_WARM_AT are ever crossed by a player who is trying.

type Policy = "first" | "kind" | "cruel";

/** Signed standing/humanity weight of an encounter choice, read off its authored effects. */
function choiceLean(graph: RegionGraph, encId: string, choiceId: string, encs: EncDef[]): number {
  const def = encs.find((e) => e.id === encId);
  if (def === undefined) return 0;
  for (const st of def.stages) {
    for (const c of st.choices) {
      if (c.id !== choiceId) continue;
      let lean = 0;
      for (const ef of c.effects) {
        if (ef.kind === "adjustReputation") lean += ef.delta ?? 0;
        else if (ef.kind === "adjustHumanity") lean += (ef.delta ?? 0) / 4;
      }
      return lean;
    }
  }
  return 0;
}

type EncDef = { id: string; stages: { id: string; choices: { id: string; effects: { kind: string; delta?: number }[] }[] }[] };

function standingRun(seed: string, actions: number, policy: Policy, immortal: boolean, encs: EncDef[]): {
  rep: Record<string, number>; start: Record<string, number>; hostileSeen: string[]; warmSeen: string[]; gatedFired: string[];
} {
  let { state, graph } = city(seed);
  let rng = 67;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const start = { ...state.player.reputation };
  const hostileSeen = new Set<string>();
  const warmSeen = new Set<string>();
  const gatedFired = new Set<string>();
  const HOSTILE = Number(ENGINE["REPUTATION_HOSTILE_AT"] ?? -50);
  const WARM = Number(ENGINE["REPUTATION_WARM_AT"] ?? 50);
  for (let k = 0; k < actions; k += 1) {
    if (immortal) {
      state = {
        ...state,
        player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } },
      };
    }
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    for (const [fid, v] of Object.entries(state.player.reputation)) {
      if (v <= HOSTILE) hostileSeen.add(fid);
      if (v >= WARM) warmSeen.add(fid);
    }
    const events = choices.filter((c) => c.id.startsWith("event:"));
    let ev: typeof choices[number] | undefined;
    if (events.length > 0) {
      for (const e of events) gatedFired.add(e.id.split(":")[1] ?? "");
      if (policy === "first") ev = events[0];
      else {
        const scored = events.map((e) => {
          const parts = e.id.split(":");
          return { e, lean: choiceLean(graph, parts[1] ?? "", parts[2] ?? "", encs) };
        });
        scored.sort((x, y) => (policy === "kind" ? y.lean - x.lean : x.lean - y.lean));
        ev = scored[0]!.e;
      }
    }
    const prefer = (pfx: string) => choices.find((c) => c.id.startsWith(pfx));
    const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? ev
      ?? (policy === "cruel" ? prefer("threaten:") : undefined)
      ?? (policy === "kind" ? (prefer("give-food:") ?? prefer("give-water:") ?? prefer("talk:")) : undefined)
      ?? prefer("search") ?? prefer("sleep")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
  }
  return { rep: { ...state.player.reputation }, start, hostileSeen: [...hostileSeen].sort(), warmSeen: [...warmSeen].sort(), gatedFired: [...gatedFired].sort() };
}

function standing(): void {
  if (!HAS_T86) { console.log("PRE-T86 tree — nothing to report; run --move instead."); return; }
  const encs = load<EncDef>("encounters");
  const gated = encs.filter((e) => {
    const r = (e as unknown as { requirements?: Record<string, unknown> }).requirements ?? {};
    return r["minReputation"] !== undefined || r["maxReputation"] !== undefined;
  }).map((e) => e.id);
  console.log(`tree: ${TREE} · ${RUNS} runs × ${ACTIONS} actions · how far can standing travel?`);
  console.log(`  HOSTILE_AT ${String(ENGINE["REPUTATION_HOSTILE_AT"])} · WARM_AT ${String(ENGINE["REPUTATION_WARM_AT"])} · spill ${String(ENGINE["REPUTATION_SPILL_PCT"])}%`);
  console.log(`  reputation-gated encounters authored: ${gated.join(", ") || "(none)"}\n`);
  for (const immortal of [false, true]) {
    for (const policy of ["first", "kind", "cruel"] as Policy[]) {
      const runs = Array.from({ length: RUNS }, (_, i) => standingRun(`t86-st-${policy}-${i}`, ACTIONS, policy, immortal, encs));
      const ids = Object.keys(runs[0]!.start).sort();
      const label = `${immortal ? "IMMORTAL" : "  MORTAL"} · ${policy.padEnd(5)}`;
      const parts = ids.map((id) => {
        const xs = runs.map((r) => r.rep[id] ?? 0);
        return `${id.replace("faction.", "").padEnd(16)} ${f1(mean(xs))} [${Math.min(...xs)}..${Math.max(...xs)}]`;
      });
      const hostile = runs.filter((r) => r.hostileSeen.length > 0).length;
      const warm = runs.filter((r) => r.warmSeen.length > 0).length;
      const fired = new Set(runs.flatMap((r) => r.gatedFired.filter((g) => gated.includes(g))));
      console.log(`  ${label} | ${parts.join(" | ")}`);
      console.log(`  ${" ".repeat(label.length)} | reached HATED in ${pct(hostile / runs.length)} of runs · KIN in ${pct(warm / runs.length)} · gated beats that fired: ${[...fired].join(", ") || "none"}`);
    }
    console.log("");
  }
}

// --- 7. POST · the standing CEILING --------------------------------------------------------------
// `--standing` shows what a bot with a temperament reaches. This shows what the CONTENT allows: for each
// faction and each sign, an immortal bot walks the nodes that carry an authored standing act for that
// faction (plus its members' spawn nodes), takes the most extreme choice on offer every time, and
// threatens or shares with every member it meets. If THIS cannot cross a threshold, the threshold is
// wrong — the T85 cistern rule: a cost nothing reaches has re-created the defect it was meant to fix.

/** Every node that carries an authored `adjustReputation` for `faction`, by the encounter's requirements. */
function standingNodes(encs: EncDef[], faction: string): string[] {
  const out = new Set<string>();
  for (const e of encs) {
    const req = (e as unknown as { requirements?: { nodeIds?: string[] } }).requirements ?? {};
    let touches = false;
    for (const st of e.stages) for (const c of st.choices) for (const ef of c.effects) {
      if (ef.kind === "adjustReputation" && (ef as unknown as { faction?: string }).faction === faction) touches = true;
    }
    if (!touches) continue;
    for (const n of req.nodeIds ?? []) out.add(n);
  }
  return [...out].sort();
}

function zealot(): void {
  if (!HAS_T86) { console.log("PRE-T86 tree — nothing to report."); return; }
  const encs = load<EncDef>("encounters");
  const defs = load<FactionDef>("factions");
  const SEEDS = Math.max(4, Math.trunc(RUNS / 4));
  console.log(`tree: ${TREE} · ${SEEDS} IMMORTAL CEILING runs × ${ACTIONS} actions per faction per sign`);
  console.log(`  HOSTILE_AT ${String(ENGINE["REPUTATION_HOSTILE_AT"])} · WARM_AT ${String(ENGINE["REPUTATION_WARM_AT"])}\n`);
  const HOSTILE = Number(ENGINE["REPUTATION_HOSTILE_AT"]);
  const WARM = Number(ENGINE["REPUTATION_WARM_AT"]);
  for (const d of [...defs].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const sign of [1, -1]) {
      const ends: number[] = []; const crossed: number[] = []; const acts: number[] = [];
      for (let i = 0; i < SEEDS; i += 1) {
        let { state, graph } = city(`t86-zeal-${d.id}-${sign}-${i}`);
        let rng = 71;
        const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
        const stops = [...standingNodes(encs, d.id), ...d.members.map((m) => state.npcs[m]?.location ?? "").filter((x) => x !== "")];
        let leg = 0; let n = 0; let best = state.player.reputation[d.id] ?? 0;
        for (let k = 0; k < ACTIONS; k += 1) {
          state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
          if (runEndReason(state) !== null) break;
          const choices = availableActions(state, graph);
          if (choices.length === 0) break;
          const here = state.player.location;
          const cur = state.player.reputation[d.id] ?? 0;
          best = sign > 0 ? Math.max(best, cur) : Math.min(best, cur);
          const target = stops.length === 0 ? undefined : stops[leg % stops.length];
          if (here === target) leg += 1;
          const toTarget = target === undefined ? undefined : hops(graph, target);
          const prefer = (pfx: string) => choices.find((c) => c.id.startsWith(pfx));
          const events = choices.filter((c) => c.id.startsWith("event:"));
          let ev: typeof choices[number] | undefined;
          if (events.length > 0) {
            const scored = events.map((e) => { const parts = e.id.split(":"); return { e, lean: choiceLean(graph, parts[1] ?? "", parts[2] ?? "", encs) }; });
            scored.sort((x, y) => (sign > 0 ? y.lean - x.lean : x.lean - y.lean));
            ev = scored[0]!.e;
            if (scored[0]!.lean !== 0) n += 1;
          }
          const member = (pfx: string) => choices.find((c) => c.id.startsWith(pfx) && d.members.includes(c.id.split(":")[1] ?? ""));
          const social = sign > 0
            ? (member("give-food:") ?? member("give-water:") ?? member("recruit:") ?? member("talk:"))
            : member("threaten:");
          const stepper = (): typeof choices[number] | undefined => {
            if (toTarget === undefined) return undefined;
            const dh = toTarget.get(here) ?? 99;
            if (dh === 0) return undefined;
            let bestM: typeof choices[number] | undefined; let bestD = dh;
            for (const mv of choices.filter((c) => c.id.startsWith("move:"))) {
              const dd = toTarget.get(mv.id.slice("move:".length)) ?? 99;
              if (dd < bestD) { bestD = dd; bestM = mv; }
            }
            return bestM;
          };
          const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
            ?? ev ?? social ?? stepper() ?? prefer("search")
            ?? (() => { const mv = choices.filter((c) => c.id.startsWith("move")); return mv.length > 0 ? mv[rand(mv.length)] : undefined; })()
            ?? choices[rand(choices.length)]!;
          if (social !== undefined && pick === social) n += 1;
          const before = state;
          state = applyAction(state, pick.action, graph).state;
          if (state === before) break;
        }
        ends.push(best); acts.push(n);
        if (sign > 0 ? best >= WARM : best <= HOSTILE) crossed.push(1);
      }
      const gate = sign > 0 ? `KIN (≥ ${WARM})` : `HATED (≤ ${HOSTILE})`;
      console.log(`  ${d.id.padEnd(26)} ${sign > 0 ? "toward" : "against"} · best standing reached: mean ${f1(mean(ends))} · range [${Math.min(...ends)}..${Math.max(...ends)}] · standing acts taken ${f1(mean(acts))}`);
      console.log(`  ${" ".repeat(26)} crossed ${gate} in ${pct(crossed.length / SEEDS)} of runs`);
    }
    console.log("");
  }
}

// --- dispatch ---------------------------------------------------------------------------------------

const mode = process.argv[2] ?? "";
if (mode === "--dead") dead();
else if (mode === "--kinds") kinds();
else if (mode === "--reach") reach();
else if (mode === "--ceiling") reach(true);
else if (mode === "--move") move();
else if (mode === "--diplomat") diplomat();
else if (mode === "--rep") repPost();
else if (mode === "--standing") standing();
else if (mode === "--zealot") zealot();
else structure();
