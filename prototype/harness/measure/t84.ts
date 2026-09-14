/**
 * T84 measurement runner — the exploration / node-identity / loot-yield numbers quoted in
 * `sim/loot.ts`, `map/fogOfWar.ts`, `actions/coreActions.ts` and `docs/qa/QA_REVIEW_T84.md`,
 * re-derivable on demand (the T77–T83 discipline: a task's before/after figures are worthless if
 * the thing that produced them was a scratch script). It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t84.ts              # STRUCTURE: what the loot/fog layers can and cannot reach
 *   npx tsx measure/t84.ts --cap        # the brief's claim 1: is a node's own contribution really <= 2?
 *   npx tsx measure/t84.ts --tax        # the brief's claim 2: is the search roll a tax with no upside?
 *   npx tsx measure/t84.ts --tiers      # the brief's claim 3: is a pistol as likely as a bandage?
 *   npx tsx measure/t84.ts --frontier   # the brief's claim 4: is the frontier always exactly one hop?
 *   npx tsx measure/t84.ts --deplete    # does a REAL run ever reach the bottom of a region's stock?
 *   npx tsx measure/t84.ts --consume    # who actually drains the stock — the player, or off-screen rivals?
 *   npx tsx measure/t84.ts --identity   # how much of the 60-node city does one run actually touch?
 *   npx tsx measure/t84.ts --haul       # POST: what a search returns, and what it costs the pack
 *   npx tsx measure/t84.ts --rich       # POST: does per-node richness separate two nodes of a kind?
 *   npx tsx measure/t84.ts --aftermath  # POST: corpses / blood written, and the `feeding` rung reachable
 *   npx tsx measure/t84.ts --scout      # POST: does buying the look actually pay?
 *   npx tsx measure/t84.ts --play       # bot runs on the shipped city: what actually ends a run
 *
 * It runs against the pre-T84 tree unchanged: everything T84 adds is looked up off the engine
 * namespace with a fallback, so the "before" and "after" outputs line up line for line.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  runEndReason,
  searchYieldCap,
  resolveSearchLoot,
  lootTableFor,
  inventoryWeight,
  CARRY_CAPACITY,
  PACK_HEAVY,
  startRun,
  type GameState,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T84 = ENGINE["SCOUT_COST"] !== undefined;
const TREE = HAS_T84 ? "POST-T84" : "PRE-T84";

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
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const med = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const RUNS = Number(process.env["T84_RUNS"] ?? 40);
const ACTIONS = Number(process.env["T84_ACTIONS"] ?? 600);

/** T84 lookups with a pre-T84 fallback, so every mode runs on BOTH trees and the tables line up. */
const richnessAuthoredSafe = (g: RegionGraph): boolean =>
  typeof ENGINE["richnessAuthored"] === "function" && (ENGINE["richnessAuthored"] as (g: RegionGraph) => boolean)(g);
const richnessOfSafe = (g: RegionGraph, id: string): number =>
  typeof ENGINE["richnessOf"] === "function" ? (ENGINE["richnessOf"] as (g: RegionGraph, id: string) => number)(g, id) : 100;
const capOf = (loot: number, spct: number, r: number): number =>
  (searchYieldCap as (a: number, b: number, c?: number) => number)(loot, spct, r);
const isScoutedSafe = (n: { scouted?: boolean; lastVisit: number | null }): boolean => n.scouted === true;
/**
 * The richness the PIPELINE would pass for this node — gate included. The first cut of these probes
 * omitted it, so `--tax`, `--tiers` and `--consume` measured the shipped city as if every node were an
 * ordinary 100, diverging from `coreActions.ts` which does pass it. That is the T81 probe-defect class
 * (an instrument that does not model the thing it is measuring) and an audit caught it here.
 */
const richnessFor = (g: RegionGraph, id: string): number | undefined =>
  richnessAuthoredSafe(g) ? richnessOfSafe(g, id) : undefined;

const src = (rel: string): string => readFileSync(join(ROOT, "prototype", "engine", "src", rel), "utf8");
const hsrc = (rel: string): string => readFileSync(join(ROOT, "prototype", "harness", "src", rel), "utf8");

// --- 1. structure -------------------------------------------------------------------------------

function structure(): void {
  console.log(`tree: ${TREE}\n`);

  // (a) A node's own identity in its loot. The cap reads the REGION's stock and the node's searchPct;
  //     the table reads the node's KIND. Nothing else about a node reaches a search.
  const nodes = load<{ id: string; regionId: string; kind?: string }>("nodes");
  const classes = new Set(nodes.map((n) => `${n.regionId}|${n.kind ?? "generic"}`));
  const kinds = new Set(nodes.map((n) => n.kind ?? "generic"));
  const regions = new Set(nodes.map((n) => n.regionId));
  console.log(`nodes ${nodes.length} · loot TABLE classes (kind) ${kinds.size} · yield-CAP classes (region) ${regions.size} · (region,kind) pairs ${classes.size}`);
  const biggest = new Map<string, number>();
  for (const n of nodes) {
    const k = `${n.regionId}|${n.kind ?? "generic"}`;
    biggest.set(k, (biggest.get(k) ?? 0) + 1);
  }
  const top = [...biggest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`largest interchangeable classes: ${top.map(([k, v]) => `${k}=${v}`).join(", ")}`);

  // (b) NodeDef.richness — declared? authored? read?
  const mapTypes = src("map/types.ts");
  const authored = readdirSync(join(CONTENT, "nodes")).filter((f) =>
    readFileSync(join(CONTENT, "nodes", f), "utf8").includes('"richness"'));
  // Code references only — `richness` also appears in loot.ts PROSE ("a RegionState.loot richness"),
  // and a doc-comment hit counted as a reader is exactly the kind of instrument defect T81 recorded.
  let reads = 0;
  for (const f of ["sim/loot.ts", "map/seedWorld.ts", "actions/coreActions.ts", "state/types.ts"]) {
    reads += (src(f).match(/(?:node|def|\.)\s*\.?richness\b|richness:/g) ?? []).length;
  }
  console.log(`NodeDef.richness: declared ${mapTypes.includes("richness")} · authored on ${authored.length}/${nodes.length} nodes · engine references ${reads}`);

  // (c) corpses / blood — the ledger's "seeded, never written" claim, counted.
  for (const field of ["corpses", "blood"] as const) {
    let writes = 0;
    const files = ["combat/combat.ts", "sim/events.ts", "sim/zombies.ts", "map/seedWorld.ts", "sim/repopulate.ts", "sim/hordes.ts", "sim/siege.ts"];
    const where: string[] = [];
    for (const f of files) {
      let body: string;
      try { body = src(f); } catch { continue; }
      // A WRITE into a NodeState literal, not an interface field declaration (`corpses: number`) and not
      // a read copied into a probe's own input shape (`corpses: node.corpses`, zombies.ts). Counting
      // either as a writer would be an instrument defect of exactly the T81 class, so the token after
      // the colon is captured and filtered rather than negative-looked-ahead (a `\\s*` before a lookahead
      // backtracks to zero width and lets everything through — which is how the first cut of this probe
      // reported three writers for a field that has one).
      const hits = [...body.matchAll(new RegExp(`${field}:\\s*([A-Za-z0-9_.]+)`, "g"))]
        .map((m) => m[1]!)
        .filter((tok) => tok !== "number" && tok !== `node.${field}`);
      const n = hits.length;
      if (n > 0) { where.push(`${f}x${n}`); writes += n; }
    }
    console.log(`NodeState.${field}: written at ${writes} site(s) [${where.join(", ")}]`);
  }

  // (d) playerNotes — the map screen advertises the verb; who writes the field?
  let noteWrites = 0;
  for (const f of ["actions/coreActions.ts", "map/seedWorld.ts", "sim/events.ts"]) {
    noteWrites += (src(f).match(/playerNotes:\s*/g) ?? []).length;
  }
  const advertises = hsrc("screens.ts").includes("add-a-note");
  console.log(`NodeState.playerNotes: written at ${noteWrites} site(s) · map screen advertises the verb: ${advertises}`);

  // (e) who lifts the fog, and how far?
  let reveal = 0;
  const revealWhere: string[] = [];
  for (const f of ["actions/coreActions.ts", "combat/combat.ts", "map/seedWorld.ts", "sim/social.ts"]) {
    const n = (src(f).match(/discoverAround\(/g) ?? []).length;
    if (n > 0) { revealWhere.push(`${f}x${n}`); reveal += n; }
  }
  console.log(`discoverAround callers: ${reveal} [${revealWhere.join(", ")}] · radius: 1 hop (fogOfWar.ts)`);
  const scoutVerb = src("actions/coreActions.ts").includes('"scout"');
  console.log(`a scout verb exists: ${scoutVerb}`);
}

// --- 2. the cap ---------------------------------------------------------------------------------

/**
 * The brief's claim 1: "a node's own progress subtracts at most 2 from a cap that starts at 8-10, so
 * two nodes of the same kind in the same district are mathematically identical."
 */
function cap(): void {
  console.log(`tree: ${TREE} · searchYieldCap(regionLoot, searchPct) over the shipped baselines\n`);
  const regions = load<{ id: string; name: string; baseline?: { loot?: number } }>("regions");
  const gain = Number(ENGINE["SEARCH_GAIN"] ?? 34);
  console.log(`  ${"region".padEnd(24)} loot   cap@0  cap@${gain}  cap@${gain * 2}  cap@100   node's own swing`);
  for (const r of regions.sort((a, b) => (b.baseline?.loot ?? 0) - (a.baseline?.loot ?? 0))) {
    const l = r.baseline?.loot ?? 0;
    const c = [0, gain, Math.min(100, gain * 2), 100].map((p) => searchYieldCap(l, p));
    console.log(`  ${r.id.padEnd(24)} ${String(l).padStart(4)}  ${String(c[0]).padStart(5)}  ${String(c[1]).padStart(5)}  ${String(c[2]).padStart(5)}  ${String(c[3]).padStart(6)}   ${String(c[0]! - c[3]!).padStart(3)}`);
  }
  console.log(`\n  at richness ${100}: the region's stock moves the cap over ${searchYieldCap(0, 0)}..${searchYieldCap(100, 0)}; the node's own searchPct moves it by at most ${searchYieldCap(100, 0) - searchYieldCap(100, 100)}.`);
  if (HAS_T84) console.log(`  with richness authored, the same region spans cap ${capOf(70, 0, 20)}..${capOf(70, 0, 200)} across its own nodes — see --rich.`);
}

// --- 3. the tax ----------------------------------------------------------------------------------

interface Search { cap: number; take: number; items: number; full: boolean }

/**
 * The brief's claim 2: "drawInt(1, rawCap) does not decide your reward — you always receive exactly
 * ONE item — it decides how many points of the finite, shared region stock you burn to get it."
 *
 * Measured by calling `resolveSearchLoot` directly on a pinned state, so no other pipeline stage can
 * confound the region delta (the contest tick runs in the same turn during play).
 */
function tax(): void {
  console.log(`tree: ${TREE} · ${RUNS * 20} direct resolveSearchLoot samples per (region loot, searchPct)\n`);
  const { state, graph } = city("t84-tax");
  const nodeId = Object.keys(state.nodes).find((id) => (graph.nodes[id]?.kind ?? "generic") === "store")!;
  const regionId = state.nodes[nodeId]!.regionId;
  console.log(`  probe node ${nodeId} (kind store, richness ${richnessFor(graph, nodeId) ?? "n/a — gate off"}) in ${regionId}\n`);
  console.log(`  ${"loot".padStart(5)} ${"pct".padStart(4)} ${"cap".padStart(4)}  ${"mean take".padStart(9)} ${"median".padStart(7)} ${"items/search".padStart(12)} ${"take per item".padStart(13)}`);
  for (const loot of [85, 70, 55, 40, 24, 8]) {
    for (const spct of [0, 34, 68]) {
      const rows: Search[] = [];
      for (let i = 0; i < RUNS * 20; i += 1) {
        const seeded: GameState = {
          ...state,
          meta: { ...state.meta, seed: `t84-tax-${loot}-${spct}-${i}` },
          nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId]!, searchPct: spct } },
          regions: { ...state.regions, [regionId]: { ...state.regions[regionId]!, loot } },
          player: { ...state.player, inventory: [] },
        };
        const after = resolveSearchLoot(seeded, nodeId, "store", false, true, true, richnessFor(graph, nodeId));
        const take = loot - after.regions[regionId]!.loot;
        const items = after.player.inventory.reduce((n, e) => n + e.quantity, 0);
        rows.push({ cap: capOf(loot, spct, richnessFor(graph, nodeId) ?? 100), take, items, full: items === 0 });
      }
      const c = rows[0]!.cap;
      const takes = rows.map((r) => r.take);
      const items = rows.map((r) => r.items);
      console.log(`  ${String(loot).padStart(5)} ${String(spct).padStart(4)} ${String(c).padStart(4)}  ${f2(mean(takes))} ${String(med(takes)).padStart(7)} ${f2(mean(items)).padStart(12)} ${f2(mean(items) === 0 ? 0 : mean(takes) / mean(items)).padStart(13)}`);
    }
  }
  console.log(
    HAS_T84
      ? `\n  the draw is a YIELD: items/search scales with the cap and the price per item is roughly flat.`
      : `\n  the draw is a FEE: items/search is flat at 1 while the take — the price of that one item — scales with the cap.`,
  );
}

// --- 4. tiers ------------------------------------------------------------------------------------

/** The brief's claim 3: "today a pistol is exactly as likely as a bandage at 25%." */
function tiers(): void {
  console.log(`tree: ${TREE} · ${RUNS * 50} direct draws per node kind (weapons pool REGISTERED)\n`);
  const { state, graph } = city("t84-tiers");
  for (const kind of ["generic", "store", "medical", "police", "residential", "industrial"]) {
    const nodeId = Object.keys(state.nodes).find((id) => (graph.nodes[id]?.kind ?? "generic") === kind);
    if (nodeId === undefined) { console.log(`  ${kind}: no node of this kind`); continue; }
    const regionId = state.nodes[nodeId]!.regionId;
    const counts = new Map<string, number>();
    const N = RUNS * 50;
    for (let i = 0; i < N; i += 1) {
      const seeded: GameState = {
        ...state,
        meta: { ...state.meta, seed: `t84-tiers-${kind}-${i}` },
        nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId]!, searchPct: 0 } },
        regions: { ...state.regions, [regionId]: { ...state.regions[regionId]!, loot: 80 } },
        player: { ...state.player, inventory: [] },
      };
      const after = resolveSearchLoot(seeded, nodeId, kind, false, true, true, richnessFor(graph, nodeId));
      for (const e of after.player.inventory) counts.set(e.type, (counts.get(e.type) ?? 0) + e.quantity);
      for (const id of Object.keys(after.items)) if (!(id in state.items)) {
        const t = after.items[id]!.type;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const flat = lootTableFor(kind, false, true).length;
    console.log(`  ${kind.padEnd(12)} uniform table would be ${pct(1 / flat)} each over ${flat} rows — actual:`);
    for (const [id, n] of rows) console.log(`      ${id.padEnd(30)} ${pct(n / N)}`);
  }
}

// --- 5. the frontier -----------------------------------------------------------------------------

interface Frontier { moves: number[]; discovered: number[]; unvisited: number[]; turns: number; endDay: number; end: string | null }

/**
 * The brief's claim 4: "fogOfWar reveals 1 hop on arrival, so the frontier is always exactly one hop
 * wide and 'explore' and 'move' are the same action — there is never a routing decision."
 *
 * `moves` is how many travel choices the Scene offered; `unvisited` is how many nodes are on the map
 * but have never been stood in — the size of the player's actual "where next" horizon.
 */
function frontierRun(seed: string, actions: number): Frontier {
  let { state, graph } = city(seed);
  const out: Frontier = { moves: [], discovered: [], unvisited: [], turns: 0, endDay: 0, end: null };
  let rng = 11;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  for (let i = 0; i < actions; i += 1) {
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    out.turns += 1;
    out.moves.push(choices.filter((c) => c.id.startsWith("move")).length);
    const ids = Object.keys(state.nodes);
    out.discovered.push(ids.filter((id) => state.nodes[id]!.discovered).length);
    out.unvisited.push(ids.filter((id) => state.nodes[id]!.discovered && state.nodes[id]!.lastVisit === null).length);
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    const pick =
      prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
      ?? prefer("search")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
  }
  out.endDay = state.meta.day;
  out.end = runEndReason(state);
  return out;
}

function frontier(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs, ${ACTIONS} actions each\n`);
  const runs: Frontier[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(frontierRun(`t84-frontier-${i}`, ACTIONS));
  const moves = runs.flatMap((r) => r.moves);
  const unv = runs.flatMap((r) => r.unvisited);
  const disc = runs.map((r) => r.discovered[r.discovered.length - 1] ?? 0);
  console.log(`  travel choices offered per turn: mean ${f2(mean(moves))} · median ${med(moves)} · max ${Math.max(...moves)} · 0 choices on ${pct(moves.filter((m) => m === 0).length / moves.length)} of turns`);
  console.log(`  nodes on the map but never entered: mean ${f2(mean(unv))} · median ${med(unv)} · max ${Math.max(...unv)}`);
  console.log(`  nodes discovered by the end of a run: mean ${f1(mean(disc))} of 60 · max ${Math.max(...disc)}`);
  console.log(`  mean end day ${f1(mean(runs.map((r) => r.endDay)))} · turns ${f1(mean(runs.map((r) => r.turns)))}`);
}

// --- 6. depletion --------------------------------------------------------------------------------

/** Does a REAL run ever reach the bottom of a region's finite stock, or does it die first? */
function deplete(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs · does the finite stock ever bind?\n`);
  const rows: { searches: number; lootStart: number; lootEnd: number; day: number; minLoot: number }[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t84-dep-${i}`);
    let rng = 13;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const start = Object.values(state.regions).reduce((n, r) => n + r.loot, 0);
    let searches = 0;
    let minLoot = 100;
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick =
        prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      if (pick.id === "search") searches += 1;
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      const here = state.nodes[state.player.location]!.regionId;
      minLoot = Math.min(minLoot, state.regions[here]!.loot);
    }
    rows.push({ searches, lootStart: start, lootEnd: Object.values(state.regions).reduce((n, r) => n + r.loot, 0), day: state.meta.day, minLoot });
  }
  console.log(`  searches per run: mean ${f1(mean(rows.map((r) => r.searches)))} · max ${Math.max(...rows.map((r) => r.searches))}`);
  console.log(`  city-wide loot points: ${rows[0]!.lootStart} at start -> mean ${f1(mean(rows.map((r) => r.lootEnd)))} at end (${pct(1 - mean(rows.map((r) => r.lootEnd)) / rows[0]!.lootStart)} consumed)`);
  console.log(`  lowest stock the player ever STOOD in: mean ${f1(mean(rows.map((r) => r.minLoot)))} · min ${Math.min(...rows.map((r) => r.minLoot))} · runs that ever saw a stock below 8 (cap 0): ${rows.filter((r) => r.minLoot < 8).length}/${rows.length}`);
  console.log(`  mean end day ${f1(mean(rows.map((r) => r.day)))}`);
}

// --- 6b. who actually eats the stock? -------------------------------------------------------------

/**
 * The brief calls the search roll "a tax on the finite, SHARED region stock". That framing only has
 * teeth if the player's own searching is a meaningful share of what drains a region. `--deplete` showed
 * 52.9% of the city consumed in a 3.6-day run against a mean of 9.8 searches, which cannot be the
 * player's doing — so this mode splits the two by measuring them separately on the same runs: the
 * region delta across the search turn's `resolveSearchLoot` alone, vs. the whole-run delta.
 */
function consume(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs · who drains the finite stock?\n`);
  let byPlayer = 0;
  let total = 0;
  let searches = 0;
  let start = 0;
  const emptySearches: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t84-con-${i}`);
    start = Object.values(state.regions).reduce((n, r) => n + r.loot, 0);
    let rng = 17;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    let empties = 0;
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick =
        prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      const before = state;
      // Isolate the search's own debit by resolving the loot half against a COPY, with the searchPct
      // advanced exactly as `applySearch` does — the live turn also runs the contest tick (stage 7),
      // so the live region delta cannot tell the two apart.
      if (pick.id === "search") {
        searches += 1;
        const here = state.player.location;
        const node = state.nodes[here]!;
        const rid = node.regionId;
        const gain = Number(ENGINE["SEARCH_GAIN"] ?? 34);
        const probeState: GameState = { ...state, nodes: { ...state.nodes, [here]: { ...node, searchPct: Math.min(100, node.searchPct + gain) } } };
        const probe = resolveSearchLoot(probeState, here, graph.nodes[here]?.kind, true, true, true, richnessFor(graph, here));
        const d = state.regions[rid]!.loot - probe.regions[rid]!.loot;
        byPlayer += d;
        if (d === 0) empties += 1;
      }
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
    }
    total += start - Object.values(state.regions).reduce((n, r) => n + r.loot, 0);
    emptySearches.push(empties);
  }
  console.log(`  city stock at start      ${String(start).padStart(6)} points`);
  console.log(`  consumed over the run    ${f1(total / RUNS)} points/run`);
  console.log(`  ...by the PLAYER's searches ${f1(byPlayer / RUNS)} (${pct(total === 0 ? 0 : byPlayer / total)})`);
  console.log(`  ...by off-screen RIVALS     ${f1((total - byPlayer) / RUNS)} (${pct(total === 0 ? 0 : (total - byPlayer) / total)})`);
  console.log(`  searches/run ${f1(searches / RUNS)} · of which yielded NOTHING (cap 0) ${f1(mean(emptySearches))}`);
}

// --- 6c. node identity in play --------------------------------------------------------------------

/** How many DISTINCT nodes does a run actually search, and does it ever come back to one? */
function identity(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs · how much of the city does a run touch?\n`);
  const distinct: number[] = [];
  const revisits: number[] = [];
  const kindsSeen: number[] = [];
  const exhausted: number[] = [];
  const packPeak: number[] = [];
  const packAtSearch: number[] = [];
  const refusals: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t84-id-${i}`);
    let rng = 19;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const searched = new Map<string, number>();
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick =
        prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      if (pick.id === "search") {
        searched.set(state.player.location, (searched.get(state.player.location) ?? 0) + 1);
        packAtSearch.push(inventoryWeight(state.player.inventory));
      }
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      packPeak.push(inventoryWeight(state.player.inventory));
    }
    refusals.push(0);
    distinct.push(searched.size);
    revisits.push([...searched.values()].filter((n) => n > 1).length);
    kindsSeen.push(new Set([...searched.keys()].map((id) => graph.nodes[id]?.kind ?? "generic")).size);
    exhausted.push(Object.values(state.nodes).filter((n) => n.searchPct >= 100).length);
  }
  console.log(`  distinct nodes searched per run: mean ${f2(mean(distinct))} of 60 · max ${Math.max(...distinct)}`);
  console.log(`  distinct node KINDS seen        : mean ${f2(mean(kindsSeen))} of 6 · max ${Math.max(...kindsSeen)}`);
  console.log(`  nodes searched more than once   : mean ${f2(mean(revisits))}`);
  console.log(`  nodes searched CLEAN (100%)     : mean ${f2(mean(exhausted))}`);
  console.log(`  pack load (of ${CARRY_CAPACITY}) at the moment of a search: mean ${f2(mean(packAtSearch))} · max ${Math.max(...packAtSearch)}`);
  console.log(`  pack load peak over a run                  : mean ${f2(mean(packPeak))} · max ${Math.max(...packPeak)} · turns at/over PACK_HEAVY ${pct(packPeak.filter((w) => w >= PACK_HEAVY).length / packPeak.length)}`);
}

// --- 6d. the haul, the pack, and the aftermath (POST-T84 modes) -----------------------------------

/**
 * What a search now returns, and what that does to the pack. The pre-T84 reading this is measured
 * against: **1.00 items per search at every cap**, pack peak **19.04 of 40**, PACK_HEAVY touched on
 * **0.7%** of turns — the GDD's "what do I leave behind?" never asked.
 */
function haul(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs · what a search returns and what it costs the pack\n`);
  const items: number[] = [];
  const packPeak: number[] = [];
  const packTurns: number[] = [];
  const fulls: number[] = [];
  const drops: number[] = [];
  const searches: number[] = [];
  const endDays: number[] = [];
  const ends: Record<string, number> = {};
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t84-haul-${i}`);
    let rng = 23;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    let n = 0, full = 0, drop = 0, gained = 0;
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick =
        prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      const before = state;
      const beforeUnits = state.player.inventory.reduce((a, e) => a + e.quantity, 0);
      if (pick.id === "search") n += 1;
      if (pick.id.startsWith("drop")) drop += 1;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      if (pick.id === "search") gained += Math.max(0, state.player.inventory.reduce((a, e) => a + e.quantity, 0) - beforeUnits);
      const w = inventoryWeight(state.player.inventory);
      packPeak.push(w);
      packTurns.push(w >= PACK_HEAVY ? 1 : 0);
      if (w >= CARRY_CAPACITY) full += 1;
    }
    searches.push(n);
    items.push(n === 0 ? 0 : gained / n);
    fulls.push(full);
    drops.push(drop);
    endDays.push(state.meta.day);
    const e = runEndReason(state) ?? "(alive)";
    ends[e] = (ends[e] ?? 0) + 1;
  }
  console.log(`  items gained per search : mean ${f2(mean(items))}`);
  console.log(`  searches per run        : mean ${f1(mean(searches))}`);
  console.log(`  pack load (of ${CARRY_CAPACITY})      : mean ${f2(mean(packPeak))} · max ${Math.max(...packPeak)} · turns at/over PACK_HEAVY ${pct(mean(packTurns))}`);
  console.log(`  turns with a FULL pack  : mean ${f1(mean(fulls))} · drops taken ${f2(mean(drops))}`);
  console.log(`  mean end day ${f1(mean(endDays))} · ends ${JSON.stringify(ends)}`);
}

/** Does per-node richness make two nodes of a kind different? The spread of caps across the city. */
function rich(): void {
  const { state, graph } = city("t84-rich");
  console.log(`tree: ${TREE} · the yield cap of every node at searchPct 0, on the shipped baselines\n`);
  const byRegion = new Map<string, { id: string; kind: string; r: number; cap: number }[]>();
  const authored = richnessAuthoredSafe(graph);
  for (const id of Object.keys(state.nodes)) {
    const node = state.nodes[id]!;
    const loot = state.regions[node.regionId]!.loot;
    const r = authored ? richnessOfSafe(graph, id) : 100;
    const cap = capOf(loot, 0, r);
    const arr = byRegion.get(node.regionId) ?? [];
    arr.push({ id, kind: graph.nodes[id]?.kind ?? "generic", r, cap });
    byRegion.set(node.regionId, arr);
  }
  let spreadSum = 0;
  let classes = 0;
  for (const [rid, rows] of [...byRegion.entries()].sort()) {
    rows.sort((a, b) => b.cap - a.cap);
    const caps = rows.map((x) => x.cap);
    console.log(`  ${rid}  cap ${Math.min(...caps)}..${Math.max(...caps)} over ${rows.length} nodes · distinct caps ${new Set(caps).size}`);
    console.log(`      richest ${rows[0]!.id.split(".").pop()} (${rows[0]!.kind}, r=${rows[0]!.r}) cap ${rows[0]!.cap}   ·   poorest ${rows[rows.length - 1]!.id.split(".").pop()} (${rows[rows.length - 1]!.kind}, r=${rows[rows.length - 1]!.r}) cap ${rows[rows.length - 1]!.cap}`);
    // The class the brief named: same kind, same district.
    const byKind = new Map<string, number[]>();
    for (const x of rows) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x.cap]);
    for (const [k, cs] of byKind) {
      if (cs.length < 2) continue;
      classes += 1;
      spreadSum += Math.max(...cs) - Math.min(...cs);
      console.log(`      ${cs.length} x ${k}: caps ${cs.sort((a, b) => b - a).join("/")}`);
    }
  }
  console.log(`\n  interchangeable (same kind, same district) classes: ${classes} · mean cap spread within a class ${f2(classes === 0 ? 0 : spreadSum / classes)}`);
}

/** The aftermath fields the design review's ledger called dead: are they written, and do they read? */
function aftermath(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs · corpses / blood, and what can now read them\n`);
  let kills = 0;
  const maxCorpses: number[] = [];
  const maxBlood: number[] = [];
  let feedingTurns = 0;
  let turns = 0;
  let nodesWithBody = 0;
  const eligibleNodes = new Set<string>();
  const firedRuns = new Set<number>();
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t84-after-${i}`);
    let rng = 29;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick =
        prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      turns += 1;
      for (const n of Object.values(state.nodes)) if (n.zombieState === "feeding") feedingTurns += 1;
      // Does the one authored beat that reads these fields ever become ELIGIBLE? Measured against the
      // engine's own requirement predicate rather than waiting for the weighted draw to pick it, so the
      // answer is about reachability and not about `PL-M5-03`'s uniform encounter weighting.
      for (const [id, n] of Object.entries(state.nodes)) {
        if (n.corpses >= 2 && n.blood >= 10 && n.walkers === 0) { eligibleNodes.add(`${i}:${id}`); }
      }
      for (const e of state.history) if (typeof e.type === "string" && e.type.startsWith("encounter.") && JSON.stringify(e.subjects).includes("killing-floor")) firedRuns.add(i);
    }
    const nodes = Object.values(state.nodes);
    maxCorpses.push(Math.max(0, ...nodes.map((n) => n.corpses)));
    maxBlood.push(Math.max(0, ...nodes.map((n) => n.blood)));
    nodesWithBody += nodes.filter((n) => n.corpses > 0).length;
    kills += nodes.reduce((a, n) => a + n.corpses, 0);
  }
  console.log(`  bodies left on the map per run : mean ${f2(kills / RUNS)} · nodes carrying one ${f2(nodesWithBody / RUNS)}`);
  console.log(`  deepest corpse count at a node : mean ${f2(mean(maxCorpses))} · max ${Math.max(...maxCorpses)}`);
  console.log(`  deepest blood at a node        : mean ${f2(mean(maxBlood))} · max ${Math.max(...maxBlood)}`);
  console.log(`  node-turns at zombieState "feeding" (0 before T84 by construction): ${feedingTurns} over ${turns} turns`);
  console.log(`  node-runs where \`encounter.common.the-killing-floor\` is ELIGIBLE (minCorpses 2 + minBlood 10 + quiet): ${eligibleNodes.size} · runs where it fired ${firedRuns.size}/${RUNS}`);
}

/** Does buying the look pay? A bot that scouts before it walks vs. one that never does. */
function scout(): void {
  console.log(`tree: ${TREE} · does scouting pay? ${RUNS} runs per style\n`);
  for (const style of ["scout", "blind"] as const) {
    const endDays: number[] = [];
    const ends: Record<string, number> = {};
    const fights: number[] = [];
    const known: number[] = [];
    const walkIns: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      let { state, graph } = city(`t84-scout-${i}`);
      let rng = 31;
      const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
      let fought = 0;
      let walkedIntoDead = 0;
      for (let k = 0; k < ACTIONS; k += 1) {
        if (runEndReason(state) !== null) break;
        const choices = availableActions(state, graph);
        if (choices.length === 0) break;
        const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
        // The scouting bot LOOKS first, then walks toward a quiet block it has seen; the blind one
        // never scouts and picks a neighbour at random, which is the pre-T84 player exactly.
        let walk: (typeof choices)[number] | undefined;
        const moves = choices.filter((c) => c.id.startsWith("move"));
        if (style === "scout") {
          const quiet = moves.filter((c) => {
            const to = (c.action.params as { to?: string } | undefined)?.to;
            const n = to === undefined ? undefined : state.nodes[to];
            return n !== undefined && isScoutedSafe(n) && n.walkers === 0;
          });
          walk = quiet.length > 0 ? quiet[rand(quiet.length)] : undefined;
        }
        const pick =
          prefer("break") ?? prefer("strike") ?? prefer("fight")
          ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
          ?? prefer("search")
          ?? (style === "scout" ? prefer("scout") : undefined)
          ?? walk
          ?? (moves.length > 0 ? moves[rand(moves.length)] : undefined)
          ?? choices[rand(choices.length)]!;
        if (pick.id.startsWith("strike") || pick.id.startsWith("fight")) fought += 1;
        const before = state;
        state = applyAction(state, pick.action, graph).state;
        if (state === before) break;
        if (pick.id.startsWith("move") && (state.nodes[state.player.location]?.walkers ?? 0) > 0) walkedIntoDead += 1;
      }
      endDays.push(state.meta.day);
      fights.push(fought);
      walkIns.push(walkedIntoDead);
      known.push(Object.values(state.nodes).filter((n) => n.discovered).length);
      const e = runEndReason(state) ?? "(alive)";
      ends[e] = (ends[e] ?? 0) + 1;
    }
    console.log(`  ${style.padEnd(6)} end day ${f1(mean(endDays))} · fight actions ${f1(mean(fights))} · walked INTO the dead ${f2(mean(walkIns))} · nodes on the map ${f1(mean(known))} · ends ${JSON.stringify(ends)}`);
  }
}

// --- 7. bot play ---------------------------------------------------------------------------------

function play(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs\n`);
  const runs: Frontier[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(frontierRun(`t84-play-${i}`, ACTIONS));
  const ends: Record<string, number> = {};
  for (const r of runs) ends[r.end ?? "(alive)"] = (ends[r.end ?? "(alive)"] ?? 0) + 1;
  console.log(`  mean end day ${f1(mean(runs.map((r) => r.endDay)))} · mean turns ${f1(mean(runs.map((r) => r.turns)))} · ends ${JSON.stringify(ends)}`);
}

// --- dispatch ------------------------------------------------------------------------------------

const mode = process.argv[2] ?? "";
if (mode === "--cap") cap();
else if (mode === "--tax") tax();
else if (mode === "--tiers") tiers();
else if (mode === "--frontier") frontier();
else if (mode === "--deplete") deplete();
else if (mode === "--consume") consume();
else if (mode === "--identity") identity();
else if (mode === "--haul") haul();
else if (mode === "--rich") rich();
else if (mode === "--aftermath") aftermath();
else if (mode === "--scout") scout();
else if (mode === "--play") play();
else structure();
