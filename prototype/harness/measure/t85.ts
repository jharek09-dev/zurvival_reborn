/**
 * T85 measurement runner — the base-tradeoff / water / jobs numbers quoted in `sim/shelter.ts`,
 * `sim/economy.ts`, `sim/jobs.ts` and `docs/qa/QA_REVIEW_T85.md`, re-derivable on demand (the
 * T77–T84 discipline: a task's before/after figures are worthless if the thing that produced them
 * was a scratch script). It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t85.ts             # STRUCTURE: the room/recipe/job graph as it actually is
 *   npx tsx measure/t85.ts --tree      # brief claim (a): what the REACHABLE tree costs, and is anything exclusive
 *   npx tsx measure/t85.ts --jobs      # brief claim (b): "only 2 of 6 jobs can ever be unlocked"
 *   npx tsx measure/t85.ts --water     # brief claim (c): the water arithmetic, from the constants
 *   npx tsx measure/t85.ts --purify    # brief claim: purify converts the WHOLE stack for one input cost
 *   npx tsx measure/t85.ts --scavenge  # brief claim: order:scavenge strictly dominates the jobs system
 *   npx tsx measure/t85.ts --kitchen   # brief claim: spoilage cannot happen (powerGrid never < POWER_SPOIL_AT)
 *   npx tsx measure/t85.ts --find      # what a REAL run actually finds: water, tools, the room inputs
 *   npx tsx measure/t85.ts --build     # a settle-and-build bot: what gets built, when, and what is left over
 *   npx tsx measure/t85.ts --slots     # POST: do room slots actually bind?
 *   npx tsx measure/t85.ts --cistern   # POST: does a water source change the water balance?
 *
 * Every T85 lookup goes through a fallback, so both trees run the same modes line for line.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  runEndReason,
  startRun,
  driftNeeds,
  THIRST_RATE,
  HUNGER_RATE,
  DRINK_RELIEF,
  EAT_RELIEF,
  RESIDENT_FEED_RELIEF,
  RESIDENT_FEED_AT,
  SCAVENGE_HOURS_PER_UNIT,
  SCAVENGE_EXTRA_DRAIN,
  POWER_SPOIL_AT,
  lootTableFor,
  type GameState,
  type RegionGraph,
  type RecipeDef,
  type JobDef,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T85 = ENGINE["ROOM_SLOTS_DEFAULT"] !== undefined;
const TREE = HAS_T85 ? "POST-T85" : "PRE-T85";

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
const RUNS = Number(process.env["T85_RUNS"] ?? 40);
const ACTIONS = Number(process.env["T85_ACTIONS"] ?? 600);

const KINDS = ["generic", "store", "medical", "police", "residential", "industrial"] as const;

/** Every recipe / job, off the content set (the pool the engine is handed). */
const RECIPES = (): RecipeDef[] => load<RecipeDef>("recipes");
const JOBS = (): JobDef[] => load<JobDef>("jobs");

/** T85 lookups with a pre-T85 fallback. */
const slotsAuthoredSafe = (g: RegionGraph): boolean =>
  typeof ENGINE["roomSlotsAuthored"] === "function" && (ENGINE["roomSlotsAuthored"] as (g: RegionGraph) => boolean)(g);
const roomSlotsOfSafe = (g: RegionGraph, id: string): number =>
  typeof ENGINE["roomSlotsOf"] === "function" ? (ENGINE["roomSlotsOf"] as (g: RegionGraph, id: string) => number)(g, id) : Infinity;

// --- 1. structure ---------------------------------------------------------------------------------

function structure(): void {
  const recipes = RECIPES();
  const jobs = JOBS();
  console.log(`tree: ${TREE}\n`);
  console.log(`RECIPES (${recipes.length}) — what each one needs and what it installs\n`);
  console.log(`  ${"recipe".padEnd(32)} ${"needs room".padEnd(16)} ${"installs".padEnd(18)} ${"h".padStart(2)}  inputs`);
  for (const r of [...recipes].sort((a, b) => a.id.localeCompare(b.id))) {
    const ins = r.inputs.map((i) => `${i.qty}x${i.item.replace("item.", "")}`).join(" + ");
    console.log(
      `  ${r.id.padEnd(32)} ${(r.room ?? "-").padEnd(16)} ${(r.installsRoom ?? r.output?.item ?? (r.purifyTo ?? "-")).padEnd(18)} ${String(r.timeCost).padStart(2)}  ${ins}${r.blueprint !== undefined ? ` [bp:${r.blueprint}]` : ""}`,
    );
  }
  console.log(`\nJOBS (${jobs.length}) — the room each one needs\n`);
  for (const j of [...jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${j.id.padEnd(18)} room ${(j.room ?? "-").padEnd(18)} consumes ${(j.consumes ? `${j.consumes.qty}x${j.consumes.item}` : "-").padEnd(24)} produces ${j.produces ? `${j.produces.qty}x${j.produces.item}` : (j.holdsPower === true ? "(power)" : j.upkeepsBarricades === true ? "(walls)" : "-")}`);
  }
  console.log(`\nLOOT — which node kinds can turn up each room input (economy pool active)\n`);
  const inputs = new Set<string>();
  for (const r of recipes) for (const i of r.inputs) inputs.add(i.item);
  for (const item of [...inputs].sort()) {
    const where = KINDS.filter((k) => lootTableFor(k, true, true).includes(item));
    console.log(`  ${item.padEnd(22)} ${where.length === 0 ? "** NOWHERE **" : where.join(", ")}`);
  }
  const g = city("t85-structure").graph;
  console.log(`\nROOM SLOTS: authored on this content set? ${slotsAuthoredSafe(g) ? "yes" : "NO — rooms are unbounded"}`);
}

// --- 2. the reachable tree ------------------------------------------------------------------------

function tree(): void {
  const recipes = RECIPES();
  const shelter = recipes.filter((r) => r.installsRoom !== undefined);
  console.log(`tree: ${TREE} · the base upgrade tree as a dependency graph\n`);
  const bare = shelter.filter((r) => r.room === undefined);
  const gated = shelter.filter((r) => r.room !== undefined);
  console.log(`  buildable in a BARE shelter (${bare.length}):`);
  for (const r of bare) console.log(`    ${r.installsRoom!.padEnd(18)} ${String(r.timeCost).padStart(2)}h  ${r.inputs.map((i) => `${i.qty}x${i.item.replace("item.", "")}`).join(" + ")}`);
  console.log(`  gated behind another room (${gated.length}):`);
  for (const r of gated) console.log(`    ${r.installsRoom!.padEnd(18)} ${String(r.timeCost).padStart(2)}h  needs ${r.room}  ${r.inputs.map((i) => `${i.qty}x${i.item.replace("item.", "")}`).join(" + ")}`);
  // The full cost of building EVERY room.
  const totals = new Map<string, number>();
  let hours = 0;
  for (const r of shelter) {
    hours += r.timeCost;
    for (const i of r.inputs) totals.set(i.item, (totals.get(i.item) ?? 0) + i.qty);
  }
  console.log(`\n  BUILD EVERYTHING: ${hours}h + ${[...totals.entries()].sort().map(([k, v]) => `${v}x${k.replace("item.", "")}`).join(" + ")}`);
  console.log(`  rooms in the tree: ${shelter.length} · rooms a node can hold: ${HAS_T85 ? String(ENGINE["ROOM_SLOTS_DEFAULT"]) + " (authored per node)" : "UNBOUNDED (NodeState.rooms is a plain array)"}`);
  console.log(`  mutually exclusive pairs: ${HAS_T85 ? "slots force a choice — see --slots" : "NONE — nothing competes for anything"}`);
}

// --- 3. jobs reachability -------------------------------------------------------------------------

function jobsMode(): void {
  const recipes = RECIPES();
  const jobs = JOBS();
  console.log(`tree: ${TREE} · the brief says "only 2 of 6 jobs can ever be unlocked"\n`);
  const installer = new Map<string, RecipeDef>();
  for (const r of recipes) if (r.installsRoom !== undefined) installer.set(r.installsRoom, r);
  let reachable = 0;
  for (const j of [...jobs].sort((a, b) => a.id.localeCompare(b.id))) {
    const room = j.room ?? "";
    const rec = installer.get(room);
    if (rec === undefined) { console.log(`  ${j.id.padEnd(16)} room ${room.padEnd(18)} ** NO RECIPE INSTALLS IT **`); continue; }
    // walk the room prerequisite chain
    const chain: string[] = [];
    let cur: RecipeDef | undefined = rec;
    const seen = new Set<string>();
    let broken = "";
    while (cur !== undefined) {
      chain.push(cur.id);
      if (cur.room === undefined) break;
      if (seen.has(cur.room)) { broken = `cycle at ${cur.room}`; break; }
      seen.add(cur.room);
      const nxt: RecipeDef | undefined = installer.get(cur.room);
      if (nxt === undefined) { broken = `nothing installs ${cur.room}`; break; }
      cur = nxt;
    }
    // are every input of every recipe in the chain findable?
    const missing: string[] = [];
    for (const id of chain) {
      const r = recipes.find((x) => x.id === id)!;
      for (const i of r.inputs) {
        const where = KINDS.filter((k) => lootTableFor(k, true, true).includes(i.item));
        if (where.length === 0) missing.push(i.item);
      }
    }
    const ok = broken === "" && missing.length === 0;
    if (ok) reachable += 1;
    console.log(`  ${j.id.padEnd(16)} room ${room.padEnd(18)} chain ${chain.reverse().join(" -> ").padEnd(54)} ${ok ? "REACHABLE" : `BLOCKED (${broken}${missing.length > 0 ? ` unfindable: ${[...new Set(missing)].join(",")}` : ""})`}`);
  }
  console.log(`\n  reachable jobs: ${reachable} of ${jobs.length}`);
}

// --- 4. the water arithmetic ----------------------------------------------------------------------

function water(): void {
  console.log(`tree: ${TREE} · the water balance, straight off the constants\n`);
  const dayThirstPlayer = THIRST_RATE * 24;
  const dayHungerPlayer = HUNGER_RATE * 24;
  console.log(`  PLAYER   thirst ${THIRST_RATE}/h -> ${dayThirstPlayer}/day · a drink relieves ${DRINK_RELIEF} -> ${f2(dayThirstPlayer / DRINK_RELIEF)} water/day`);
  console.log(`           hunger ${HUNGER_RATE}/h -> ${dayHungerPlayer}/day · a meal relieves ${EAT_RELIEF} -> ${f2(dayHungerPlayer / EAT_RELIEF)} food/day`);
  // A resident drifts on the same clock; the base feeds at RESIDENT_FEED_RELIEF.
  const probe = { hunger: 0, thirst: 0, fatigue: 0 };
  const after = driftNeeds(probe, false, 24);
  console.log(`  RESIDENT thirst ${after.thirst}/day (driftNeeds, 24h) · a canteen relieves ${RESIDENT_FEED_RELIEF} -> ${f2(after.thirst / RESIDENT_FEED_RELIEF)} water/day`);
  console.log(`           hunger ${after.hunger}/day · a ration relieves ${RESIDENT_FEED_RELIEF} -> ${f2(after.hunger / RESIDENT_FEED_RELIEF)} food/day`);
  console.log(`           (fed only once a need reaches ${RESIDENT_FEED_AT}, so the true rate is the drift rate, not the threshold)`);
  const ratio = (after.thirst / RESIDENT_FEED_RELIEF) / (dayThirstPlayer / DRINK_RELIEF);
  console.log(`\n  a resident costs ${f2(ratio)}x what the player does in water (${DRINK_RELIEF} vs ${RESIDENT_FEED_RELIEF} relief per unit)`);
  console.log(`\n  WATER SOURCES`);
  for (const k of KINDS) {
    const t = lootTableFor(k, true, true);
    const clean = t.filter((i) => i === "item.water").length;
    const dirty = t.filter((i) => i === "item.water-dirty").length;
    console.log(`    ${k.padEnd(12)} table ${String(t.length).padStart(2)} rows · item.water ${clean > 0 ? "YES" : "no "} · item.water-dirty ${dirty > 0 ? "YES" : "no "}`);
  }
  const withClean = KINDS.filter((k) => lootTableFor(k, true, true).includes("item.water"));
  console.log(`    -> clean water is in ${withClean.length} of ${KINDS.length} kinds (${withClean.join(", ")})`);
  // NB the question is "water of EITHER kind", not "clean water". The first cut asked only about
  // `item.water` and duly reported "NONE" on the post-T85 tree, where `job.water` banks
  // `item.water-dirty` on purpose — a probe that does not model the thing it measures (the T81 class).
  const makers = JOBS().filter((j) => (j.produces?.item ?? "").startsWith("item.water"));
  console.log(`    -> a PRODUCED water source: ${makers.length === 0 ? "NONE — no job makes water of any kind" : makers.map((j) => `${j.id} -> ${j.produces!.qty}x${j.produces!.item}/${j.hoursPerCycle ?? 6}h`).join(", ")}`);
}

// --- 5. purify ------------------------------------------------------------------------------------

function purifyMode(): void {
  console.log(`tree: ${TREE} · does one set of inputs purify one unit, or the whole stack?\n`);
  const grantAll = (s: GameState, item: string, qty: number): GameState => ({
    ...s,
    player: { ...s.player, inventory: [...s.player.inventory, { type: item, quantity: qty }] },
  });
  for (const stack of [1, 2, 5, 10]) {
    let { state, graph } = city("t85-purify");
    // The bench is the shelter: `craftable` requires shelterId === location. Settle where we stand.
    state = { ...state, player: { ...state.player, shelterId: state.player.location } };
    state = grantAll(state, "item.water-dirty", stack);
    state = grantAll(state, "item.fuel", 3);
    const before = state.player.inventory.find((e) => e.type === "item.fuel")?.quantity ?? 0;
    const choice = availableActions(state, graph).find((c) => c.id === "purify:recipe.purify.boil");
    if (choice === undefined) { console.log(`  stack ${String(stack).padStart(2)}: purify not offered`); continue; }
    const out = applyAction(state, choice.action, graph).state;
    const clean = out.player.inventory.find((e) => e.type === "item.water")?.quantity ?? 0;
    const fuelLeft = out.player.inventory.find((e) => e.type === "item.fuel")?.quantity ?? 0;
    console.log(`  dirty stack ${String(stack).padStart(2)} -> clean ${String(clean).padStart(2)} · fuel ${before} -> ${fuelLeft} (spent ${before - fuelLeft}) · water per fuel: ${f2(clean / Math.max(1, before - fuelLeft))}`);
  }
  console.log(
    HAS_T85
      ? `\n  a batch, not a button: the yield stops at the recipe's authored batch, so N units cost ceil(N/batch) crafts.`
      : `\n  the correct play under this rule is to hoard dirty water to the pack limit and purify ONCE.`,
  );
}

// --- 6. scavenge vs the jobs system ---------------------------------------------------------------

function scavengeMode(): void {
  console.log(`tree: ${TREE} · order:scavenge against the jobs it is said to dominate\n`);
  const perDay = 24 / SCAVENGE_HOURS_PER_UNIT;
  console.log(`  order:scavenge  ${perDay}/day of item.canned-food · no room, no build · trust >= 80 + a claimed base`);
  const probe = { hunger: 0, thirst: 0, fatigue: 0 };
  const plain = driftNeeds(probe, false, 24);
  const extra = SCAVENGE_EXTRA_DRAIN * 24;
  const scavHunger = plain.hunger + extra;
  const scavThirst = plain.thirst + extra;
  console.log(`    its own upkeep: hunger ${plain.hunger} -> ${scavHunger}/day · thirst ${plain.thirst} -> ${scavThirst}/day (SCAVENGE_EXTRA_DRAIN ${SCAVENGE_EXTRA_DRAIN}/h)`);
  console.log(`    = ${f2(scavHunger / RESIDENT_FEED_RELIEF)} food/day and ${f2(scavThirst / RESIDENT_FEED_RELIEF)} WATER/day out of the stash`);
  console.log(`    NET food ${f1(perDay - scavHunger / RESIDENT_FEED_RELIEF)}/day · NET water ${f1(-scavThirst / RESIDENT_FEED_RELIEF)}/day`);
  for (const j of JOBS()) {
    const h = j.hoursPerCycle ?? 6;
    const out = j.produces !== undefined ? `${f1((24 / h) * j.produces.qty)}/day of ${j.produces.item}` : j.holdsPower === true ? `${f1(24 / h)} power cycles/day` : `${f1(24 / h)} wall cycles/day`;
    const cost = j.consumes !== undefined ? `${f1((24 / h) * j.consumes.qty)}/day of ${j.consumes.item}` : "nothing";
    const idle = driftNeeds(probe, false, 24);
    console.log(`  ${j.id.padEnd(16)} ${out.padEnd(34)} consumes ${cost.padEnd(30)} upkeep ${f2(idle.thirst / RESIDENT_FEED_RELIEF)} water/day`);
  }
}

// --- 7. the kitchen / spoilage claim --------------------------------------------------------------

function kitchen(): void {
  console.log(`tree: ${TREE} · "refrigerated is always true — powerGrid never falls below ${POWER_SPOIL_AT}"\n`);
  const lows: number[] = [];
  const belowTurns: number[] = [];
  let turns = 0;
  let below = 0;
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t85-kitchen-${i}`);
    let rng = 11;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    let lo = state.world.powerGrid;
    let runBelow = 0;
    let runTurns = 0;
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick = prefer("break") ?? prefer("strike") ?? prefer("drink") ?? prefer("eat") ?? prefer("sleep") ?? prefer("search") ?? choices[rand(choices.length)]!;
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      runTurns += 1; turns += 1;
      lo = Math.min(lo, state.world.powerGrid);
      if (state.world.powerGrid < POWER_SPOIL_AT) { runBelow += 1; below += 1; }
    }
    lows.push(lo);
    belowTurns.push(runTurns === 0 ? 0 : runBelow / runTurns);
  }
  console.log(`  ${RUNS} runs · powerGrid MINIMUM reached: mean ${f1(mean(lows))} · lowest of all ${Math.min(...lows)}`);
  console.log(`  turns with powerGrid < ${POWER_SPOIL_AT}: ${pct(below / Math.max(1, turns))} of ${turns} turns · runs that ever dipped: ${lows.filter((l) => l < POWER_SPOIL_AT).length} of ${RUNS}`);
  console.log(`  => a kitchen's refrigeration is ${below === 0 ? "WORTHLESS (spoilage genuinely cannot happen)" : "load-bearing on the turns below the line"}`);
  console.log(`  fresh(60) -> canned(${EAT_RELIEF}) conversion: job.kitchen destroys ${60 - EAT_RELIEF} relief per unit either way.`);
}

// --- 8. what a real run finds ---------------------------------------------------------------------

function find(): void {
  console.log(`tree: ${TREE} · ${RUNS} scavenging bot runs · what the base economy's inputs actually cost to find\n`);
  const TRACK = ["item.water", "item.water-dirty", "item.scrap", "item.tools", "item.cloth", "item.fuel", "item.batteries", "item.charcoal"];
  const found: Record<string, number[]> = {};
  for (const t of TRACK) found[t] = [];
  const days: number[] = [];
  const searches: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t85-find-${i}`);
    let rng = 7;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const got: Record<string, number> = {};
    let ns = 0;
    for (let k = 0; k < ACTIONS; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
        ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("sleep")
        ?? prefer("search")
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? choices[rand(choices.length)]!;
      if (pick.id === "search") ns += 1;
      const before = state;
      const beforeCounts: Record<string, number> = {};
      for (const t of TRACK) beforeCounts[t] = before.player.inventory.filter((e) => e.type === t).reduce((a, e) => a + e.quantity, 0);
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      for (const t of TRACK) {
        const now = state.player.inventory.filter((e) => e.type === t).reduce((a, e) => a + e.quantity, 0);
        if (now > (beforeCounts[t] ?? 0)) got[t] = (got[t] ?? 0) + (now - (beforeCounts[t] ?? 0));
      }
    }
    for (const t of TRACK) found[t]!.push(got[t] ?? 0);
    days.push(state.meta.day);
    searches.push(ns);
  }
  console.log(`  mean end day ${f1(mean(days))} · mean searches ${f1(mean(searches))}\n`);
  console.log(`  ${"item".padEnd(20)} ${"per run".padStart(8)} ${"per day".padStart(8)} ${"runs that found ANY".padStart(20)}`);
  for (const t of TRACK) {
    const xs = found[t]!;
    console.log(`  ${t.padEnd(20)} ${f2(mean(xs))} ${f2(mean(xs) / Math.max(1, mean(days)))} ${pct(xs.filter((x) => x > 0).length / xs.length)}`);
  }
  const need = (THIRST_RATE * 24) / DRINK_RELIEF;
  console.log(`\n  the player needs ${f2(need)} clean water/day; found ${f2(mean(found["item.water"]!) / Math.max(1, mean(days)))}/day.`);
}

// --- 9. the settle-and-build bot ------------------------------------------------------------------

interface BuildRun { readonly rooms: readonly string[]; readonly claimDay: number | null; readonly endDay: number; readonly end: string | null; readonly builds: readonly { room: string; day: number }[] }

function buildRun(seed: string, actions: number): BuildRun {
  let { state, graph } = city(seed);
  let rng = 23;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  let claimDay: number | null = null;
  const builds: { room: string; day: number }[] = [];
  for (let k = 0; k < actions; k += 1) {
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("claim")
      ?? prefer("craft:recipe.shelter.")   // build every room the bench will offer
      ?? prefer("sleep")
      ?? prefer("search")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    const before = state;
    const beforeRooms = state.player.shelterId === null ? [] : (state.nodes[state.player.shelterId]?.rooms ?? []);
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    if (claimDay === null && state.player.shelterId !== null) claimDay = state.meta.day;
    if (state.player.shelterId !== null) {
      const now = state.nodes[state.player.shelterId]?.rooms ?? [];
      for (const r of now) if (!beforeRooms.includes(r)) builds.push({ room: r, day: state.meta.day });
    }
  }
  const rooms = state.player.shelterId === null ? [] : (state.nodes[state.player.shelterId]?.rooms ?? []);
  return { rooms, claimDay, endDay: state.meta.day, end: runEndReason(state), builds };
}

function build(): void {
  console.log(`tree: ${TREE} · ${RUNS} settle-and-build bot runs (claim, then build every room offered)\n`);
  const runs: BuildRun[] = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(buildRun(`t85-build-${i}`, ACTIONS));
  const claimed = runs.filter((r) => r.claimDay !== null);
  console.log(`  runs that claimed a base: ${claimed.length} of ${RUNS} (mean claim day ${f1(mean(claimed.map((r) => r.claimDay!)))})`);
  console.log(`  rooms standing at end    : mean ${f2(mean(runs.map((r) => r.rooms.length)))} · max ${Math.max(...runs.map((r) => r.rooms.length))}`);
  const built: Record<string, number> = {};
  const firstDay: Record<string, number[]> = {};
  for (const r of runs) for (const b of r.builds) { built[b.room] = (built[b.room] ?? 0) + 1; (firstDay[b.room] ??= []).push(b.day); }
  console.log(`  which rooms actually get built:`);
  for (const [room, n] of [...Object.entries(built)].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${room.padEnd(18)} ${pct(n / RUNS)} of runs · mean day ${f1(mean(firstDay[room]!))}`);
  }
  const never = RECIPES().filter((r) => r.installsRoom !== undefined && built[r.installsRoom] === undefined);
  if (never.length > 0) console.log(`    NEVER BUILT: ${never.map((r) => r.installsRoom).join(", ")}`);
  console.log(`  mean end day ${f1(mean(runs.map((r) => r.endDay)))}`);
}


// --- 9b. a GOAL-DIRECTED settler ------------------------------------------------------------------
// The wandering bot above claims a base in 0 of 40 runs (T83's `NodeDef.claimable` finding: 14 of 60
// nodes are claimable and the START node is not one, and claiming also needs searchPct 100). So the
// base layer cannot be exercised by an undirected bot at all. This one walks to the nearest claimable
// node, searches it clean, claims it, then builds everything the bench will offer — the most
// favourable player the engine permits. What it CANNOT reach is a hard ceiling, not a bot artifact.

/** BFS hop distance from `from` to every node, over graph adjacency (route conditions ignored). */
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

function settleRun(seed: string, actions: number): BuildRun & { searchesAtBase: number; kindsSearched: string[]; inputsSeen: Record<string, number> } {
  let { state, graph } = city(seed);
  let rng = 31;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
  const dist = hops(graph, state.player.location);
  // nearest claimable by hop count; ties by id for stability
  const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
  let claimDay: number | null = null;
  const builds: { room: string; day: number }[] = [];
  let searchesAtBase = 0;
  const kinds = new Set<string>();
  const inputsSeen: Record<string, number> = {};
  const TRACK = ["item.water", "item.scrap", "item.tools", "item.cloth", "item.fuel", "item.batteries"];
  for (let k = 0; k < actions; k += 1) {
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
    const here = state.player.location;
    // walk the hop gradient toward the target while we have no base
    const toTarget = target === undefined ? undefined : hops(graph, target);
    const stepper = (): typeof choices[number] | undefined => {
      if (state.player.shelterId !== null || toTarget === undefined) return undefined;
      const dh = toTarget.get(here) ?? 99;
      if (dh === 0) return undefined;
      const moves = choices.filter((c) => c.id.startsWith("move:"));
      let best: typeof choices[number] | undefined;
      let bestD = dh;
      for (const m of moves) {
        const to = m.id.slice("move:".length);
        const d = toTarget.get(to) ?? 99;
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    };
    const pick = prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("claim")
      ?? prefer("craft:recipe.shelter.")
      ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
      ?? stepper()
      ?? prefer("sleep")
      ?? prefer("search")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    if (pick.id === "search") { kinds.add(graph.nodes[here]?.kind ?? "generic"); if (here === target) searchesAtBase += 1; }
    const before = state;
    const beforeRooms = state.player.shelterId === null ? [] : (state.nodes[state.player.shelterId]?.rooms ?? []);
    const bc: Record<string, number> = {};
    for (const t of TRACK) bc[t] = before.player.inventory.filter((e) => e.type === t).reduce((a, e) => a + e.quantity, 0);
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    for (const t of TRACK) {
      const now = state.player.inventory.filter((e) => e.type === t).reduce((a, e) => a + e.quantity, 0);
      if (now > (bc[t] ?? 0)) inputsSeen[t] = (inputsSeen[t] ?? 0) + (now - (bc[t] ?? 0));
    }
    if (claimDay === null && state.player.shelterId !== null) claimDay = state.meta.day;
    if (state.player.shelterId !== null) {
      const now = state.nodes[state.player.shelterId]?.rooms ?? [];
      for (const r of now) if (!beforeRooms.includes(r)) builds.push({ room: r, day: state.meta.day });
    }
  }
  const rooms = state.player.shelterId === null ? [] : (state.nodes[state.player.shelterId]?.rooms ?? []);
  return { rooms, claimDay, endDay: state.meta.day, end: runEndReason(state), builds, searchesAtBase, kindsSearched: [...kinds], inputsSeen };
}

function settle(): void {
  console.log(`tree: ${TREE} · ${RUNS} GOAL-DIRECTED settler runs (walk to the nearest safehouse, search it clean, claim, build)\n`);
  const runs = Array.from({ length: RUNS }, (_, i) => settleRun(`t85-settle-${i}`, ACTIONS));
  const claimed = runs.filter((r) => r.claimDay !== null);
  console.log(`  claimed a base : ${claimed.length} of ${RUNS}${claimed.length > 0 ? ` · mean claim day ${f1(mean(claimed.map((r) => r.claimDay!)))}` : ""}`);
  console.log(`  searches spent on the base node before it was claimable: mean ${f1(mean(runs.map((r) => r.searchesAtBase)))}`);
  console.log(`  rooms standing at end: mean ${f2(mean(runs.map((r) => r.rooms.length)))} · max ${Math.max(...runs.map((r) => r.rooms.length))}`);
  const built: Record<string, number> = {};
  const dayOf: Record<string, number[]> = {};
  for (const r of runs) for (const b of r.builds) { built[b.room] = (built[b.room] ?? 0) + 1; (dayOf[b.room] ??= []).push(b.day); }
  for (const [room, n] of [...Object.entries(built)].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${room.padEnd(18)} built in ${pct(n / RUNS)} of runs · mean day ${f1(mean(dayOf[room]!))}`);
  }
  const never = RECIPES().filter((r) => r.installsRoom !== undefined && built[r.installsRoom] === undefined).map((r) => r.installsRoom!);
  if (never.length > 0) console.log(`    NEVER BUILT: ${never.join(", ")}`);
  console.log(`\n  room INPUTS the settler actually found (per run):`);
  for (const t of ["item.scrap", "item.water", "item.cloth", "item.tools", "item.fuel", "item.batteries"]) {
    const xs = runs.map((r) => r.inputsSeen[t] ?? 0);
    console.log(`    ${t.padEnd(18)} mean ${f2(mean(xs))} · runs that found ANY ${pct(xs.filter((x) => x > 0).length / xs.length)}`);
  }
  const kinds: Record<string, number> = {};
  for (const r of runs) for (const k of r.kindsSearched) kinds[k] = (kinds[k] ?? 0) + 1;
  console.log(`  node KINDS the settler searched: ${[...Object.entries(kinds)].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n / RUNS)}`).join(" · ")}`);
  console.log(`  mean end day ${f1(mean(runs.map((r) => r.endDay)))} · ends ${JSON.stringify(runs.reduce<Record<string, number>>((a, r) => { const e = r.end ?? "(alive)"; a[e] = (a[e] ?? 0) + 1; return a; }, {}))}`);
}


// --- 9c. can the base economy be PAID FOR at all? -------------------------------------------------
// `--settle` shows the most favourable player the engine permits building 0 of 7 rooms. This isolates
// why: is the loot table stingy, or is the run simply too short to pay a 3-scrap entry fee?

function afford(): void {
  console.log(`tree: ${TREE} · can the cheapest room's entry fee be paid?\n`);
  const { graph } = city("t85-afford");
  // 1. how far is the nearest node of each kind from the start, and from the nearest safehouse?
  const start = city("t85-afford").state.player.location;
  const d = hops(graph, start);
  const byKind = new Map<string, number[]>();
  for (const n of Object.values(graph.nodes)) {
    const k = n.kind ?? "generic";
    const hh = d.get(n.id);
    if (hh !== undefined) (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(hh);
  }
  console.log(`  hops from the start node to the NEAREST node of each kind:`);
  for (const [k, xs] of [...byKind.entries()].sort()) console.log(`    ${k.padEnd(12)} nearest ${Math.min(...xs)} hops · ${xs.length} nodes in the city`);
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true);
  console.log(`  claimable nodes: ${claimables.length} · nearest ${Math.min(...claimables.map((n) => d.get(n.id) ?? 99))} hops · kinds ${[...new Set(claimables.map((n) => n.kind ?? "generic"))].join(", ")}`);

  // 2. per-search yield of the room inputs, sampled straight off `resolveSearchLoot` (the t84 --tax
  //    discipline: call the resolver on a pinned state so no other pipeline stage confounds it).
  const resolve = ENGINE["resolveSearchLoot"] as (s: GameState, nodeId: string, kind: string, a: boolean, b: boolean, c: boolean, r?: number) => GameState;
  const richnessFor = (g: RegionGraph, id: string): number | undefined =>
    typeof ENGINE["richnessAuthored"] === "function" && (ENGINE["richnessAuthored"] as (x: RegionGraph) => boolean)(g)
      ? (ENGINE["richnessOf"] as (x: RegionGraph, i: string) => number)(g, id)
      : undefined;
  const base = city("t85-afford2");
  console.log(`\n  items per SEARCH at a FULL-STOCK node of each kind (${RUNS * 20} direct resolveSearchLoot samples):`);
  console.log(`    ${"kind".padEnd(12)} ${"items".padStart(6)} ${"scrap".padStart(6)} ${"water".padStart(6)} ${"tools".padStart(6)} ${"fuel".padStart(6)} ${"cloth".padStart(6)} ${"batt".padStart(6)}`);
  for (const k of KINDS) {
    const nodeId = Object.keys(base.state.nodes).find((id) => (graph.nodes[id]?.kind ?? "generic") === k);
    if (nodeId === undefined) continue;
    const regionId = base.state.nodes[nodeId]!.regionId;
    const tally: Record<string, number> = {};
    let items = 0;
    const N = RUNS * 20;
    for (let i = 0; i < N; i += 1) {
      const seeded: GameState = {
        ...base.state,
        meta: { ...base.state.meta, seed: `t85-af-${k}-${i}` },
        nodes: { ...base.state.nodes, [nodeId]: { ...base.state.nodes[nodeId]!, searchPct: 0 } },
        regions: { ...base.state.regions, [regionId]: { ...base.state.regions[regionId]!, loot: 85 } },
        player: { ...base.state.player, inventory: [] },
      };
      const after = resolve(seeded, nodeId, k, false, true, true, richnessFor(graph, nodeId));
      for (const e of after.player.inventory) { tally[e.type] = (tally[e.type] ?? 0) + e.quantity; items += e.quantity; }
    }
    const per = (id: string) => f2((tally[id] ?? 0) / N);
    console.log(`    ${k.padEnd(12)} ${f2(items / N)} ${per("item.scrap")} ${per("item.water")} ${per("item.tools")} ${per("item.fuel")} ${per("item.cloth")} ${per("item.batteries")}`);
  }
  console.log(`\n  the cheapest room (room.watchtower) costs 3 scrap. A settler run makes ~10 searches.`);
}


// --- 9d. the CEILING: does the tree bind, given time? ---------------------------------------------
// `--settle` dies on day 3.5 with one room standing, which cannot tell "slots never bind" apart from
// "runs are too short to reach them" (PL-M5-54 — run length is T59/T60's). This one removes death
// from the question: needs are zeroed every turn and fights are fled, so the only things that can
// stop the build are materials, room prerequisites and SLOTS. Whatever it cannot reach is a property
// of the tree, not of the bot.

/** Could the pack pay for any room not yet standing? (Drives the immortal settler home to the bench.) */
function packCanBuild(state: GameState): boolean {
  const have: Record<string, number> = {};
  for (const e of state.player.inventory) have[e.type] = (have[e.type] ?? 0) + e.quantity;
  const sid = state.player.shelterId;
  const rooms = sid === null ? [] : (state.nodes[sid]?.rooms ?? []);
  return RECIPES().some((r) => r.installsRoom !== undefined && !rooms.includes(r.installsRoom)
    && (r.room === undefined || rooms.includes(r.room))
    && r.inputs.every((i) => (have[i.item] ?? 0) >= i.qty));
}

function ceiling(): void {
  console.log(`tree: ${TREE} · ${RUNS} IMMORTAL settler runs (needs zeroed each turn) — what does the tree allow?\n`);
  const roomsEnd: number[] = [];
  const slotsAt: number[] = [];
  const built: Record<string, number> = {};
  const full: number[] = [];
  let blockedBySlots = 0;
  const turnsTaken: number[] = [];
  const endReasons: Record<string, number> = {};
  const packEnd: Record<string, number> = {};
  for (let i = 0; i < RUNS; i += 1) {
    let { state, graph } = city(`t85-ceil-${i}`);
    let rng = 41;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
    const d0 = hops(graph, state.player.location);
    const target = [...claimables].sort((a, b) => (d0.get(a) ?? 99) - (d0.get(b) ?? 99) || a.localeCompare(b))[0];
    const toTarget = target === undefined ? undefined : hops(graph, target);
    let sawSlotBlock = false;
    let took = 0;
    for (let k = 0; k < ACTIONS; k += 1) {
      took = k;
      // Immortality: zero the needs AND clear wounds AND reset the infection each turn, so only the
      // ECONOMY can stop us. The first cut cleared wounds but not `condition.infection`, and all 40
      // runs duly ended in `infection` at turn ~275 — a probe that answers a question about the
      // economy with a fact about the bot's blood (the T81 probe-defect class).
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
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const prefer = (p: string) => choices.find((c) => c.id.startsWith(p));
      const here = state.player.location;
      const stepper = (): typeof choices[number] | undefined => {
        // before a base: walk to the safehouse. After one: walk HOME whenever the pack can pay for a
        // room, because the bench is only at the shelter (`atWorkbench`).
        const goalMap = state.player.shelterId === null ? toTarget : (packCanBuild(state) ? hops(graph, state.player.shelterId) : undefined);
        if (goalMap === undefined) return undefined;
        const toTargetLocal = goalMap;
        const dh = toTargetLocal.get(here) ?? 99;
        if (dh === 0) return undefined;
        let best: typeof choices[number] | undefined; let bestD = dh;
        for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
          const dd = toTargetLocal.get(m.id.slice("move:".length)) ?? 99;
          if (dd < bestD) { bestD = dd; best = m; }
        }
        return best;
      };
      // Once based, it FORAGES: it searches where there is still stock and walks on when there is not,
      // returning to the bench whenever the bench has something to offer. A bot that sits at its own
      // exhausted base and "searches" measures its own policy, not the tree — the first cut did that
      // and reported a ceiling of 0.72 rooms that was really a ceiling on where it stood.
      const stockHere = (state.nodes[here]?.searchPct ?? 100) < 100;
      const pick = prefer("flee") ?? prefer("run") ?? prefer("break") ?? prefer("strike")
        ?? prefer("claim")
        ?? prefer("craft:recipe.shelter.")
        ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
        ?? stepper()
        ?? (stockHere ? prefer("search") : undefined)
        ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
        ?? prefer("search")
        ?? choices[rand(choices.length)]!;
      const beforeRooms = state.player.shelterId === null ? [] : (state.nodes[state.player.shelterId]?.rooms ?? []);
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
      if (state.player.shelterId !== null) {
        const now = state.nodes[state.player.shelterId]?.rooms ?? [];
        for (const r of now) if (!beforeRooms.includes(r)) built[r] = (built[r] ?? 0) + 1;
        // did the slot rule ever refuse a room the player could otherwise afford?
        if (HAS_T85 && now.length >= roomSlotsOfSafe(graph, state.player.shelterId)) sawSlotBlock = true;
      }
    }
    const sid = state.player.shelterId;
    const rooms = sid === null ? [] : (state.nodes[sid]?.rooms ?? []);
    turnsTaken.push(took);
    const er = runEndReason(state) ?? "(alive)";
    endReasons[er] = (endReasons[er] ?? 0) + 1;
    for (const e of state.player.inventory) packEnd[e.type] = (packEnd[e.type] ?? 0) + e.quantity;
    roomsEnd.push(rooms.length);
    if (sid !== null) { slotsAt.push(roomSlotsOfSafe(graph, sid)); if (rooms.length >= roomSlotsOfSafe(graph, sid)) full.push(1); else full.push(0); }
    if (sawSlotBlock) blockedBySlots += 1;
  }
  console.log(`  turns actually taken: mean ${f1(mean(turnsTaken))} of ${ACTIONS} · ends ${JSON.stringify(endReasons)}`);
  console.log(`  pack at end (mean units): ${Object.entries(packEnd).sort().map(([k, v]) => `${k.replace("item.", "")} ${f2(v / RUNS)}`).join(" · ")}`);
  console.log(`  rooms standing at end: mean ${f2(mean(roomsEnd))} · max ${Math.max(...roomsEnd)}`);
  if (slotsAt.length > 0) console.log(`  slots at the base they chose: mean ${f2(mean(slotsAt))} · bases filled to capacity ${pct(mean(full))}`);
  console.log(`  runs where the SLOT RULE actually refused a room: ${blockedBySlots} of ${RUNS}`);
  console.log(`  rooms built (share of runs):`);
  for (const [room, n] of [...Object.entries(built)].sort((a, b) => b[1] - a[1])) console.log(`    ${room.padEnd(18)} ${pct(n / RUNS)}`);
  const never = RECIPES().filter((r) => r.installsRoom !== undefined && built[r.installsRoom] === undefined).map((r) => r.installsRoom!);
  if (never.length > 0) console.log(`    NEVER BUILT even immortal: ${never.join(", ")}`);
}

// --- POST-T85 modes -------------------------------------------------------------------------------

function slots(): void {
  if (!HAS_T85) { console.log("pre-T85 tree: room slots do not exist."); return; }
  const g = city("t85-slots").graph;
  console.log(`tree: ${TREE} · authored room slots across the 60-node city\n`);
  const byKind = new Map<string, number[]>();
  const hist = new Map<number, number>();
  for (const n of Object.values(g.nodes)) {
    const s = roomSlotsOfSafe(g, n.id);
    hist.set(s, (hist.get(s) ?? 0) + 1);
    const k = n.kind ?? "generic";
    (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(s);
  }
  console.log(`  slot histogram: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}:${n}`).join("  ")}`);
  for (const [k, xs] of [...byKind.entries()].sort()) console.log(`    ${k.padEnd(12)} mean ${f2(mean(xs))} · min ${Math.min(...xs)} · max ${Math.max(...xs)}`);
  const claimable = Object.values(g.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true);
  console.log(`  CLAIMABLE nodes (${claimable.length}): ${claimable.map((n) => `${n.name} ${roomSlotsOfSafe(g, n.id)}`).join(" · ")}`);
  const rooms = RECIPES().filter((r) => r.installsRoom !== undefined).length;
  console.log(`  rooms in the tree ${rooms} · the roomiest base holds ${Math.max(...[...hist.keys()])} => ${rooms - Math.max(...[...hist.keys()])} must be given up`);
}

function cistern(): void {
  if (!HAS_T85) { console.log("pre-T85 tree: no water source exists."); return; }
  console.log(`tree: ${TREE} · does the water source change the balance?\n`);
  const wj = JOBS().filter((j) => j.produces?.item === "item.water" || j.produces?.item === "item.water-dirty");
  for (const j of wj) console.log(`  ${j.id} produces ${j.produces!.qty}x${j.produces!.item} per ${j.hoursPerCycle ?? 6}h = ${f2((24 / (j.hoursPerCycle ?? 6)) * j.produces!.qty)}/day${j.consumes !== undefined ? ` consuming ${j.consumes.qty}x${j.consumes.item}` : ""}`);
  const resident = (driftNeeds({ hunger: 0, thirst: 0, fatigue: 0 }, false, 24).thirst) / RESIDENT_FEED_RELIEF;
  const made = wj.reduce((a, j) => a + (24 / (j.hoursPerCycle ?? 6)) * (j.produces?.qty ?? 0), 0);
  console.log(`\n  a resident drinks ${f2(resident)}/day of CLEAN water; the catchment banks ${f2(made)}/day of DIRTY.`);
  // What the catchment banks is not drinkable, and saying "supports 6.7 residents" off the raw rate is
  // the whole point missed: the bill is the purification. An earlier cut printed exactly that number.
  for (const r of RECIPES().filter((x) => x.category === "purify")) {
    const per = r.purifyUnitsPerCraft ?? Infinity;
    const crafts = Math.ceil(made / per);
    const bill = r.inputs.map((i) => `${crafts * i.qty}x${i.item.replace("item.", "")}`).join(" + ");
    console.log(`    boiled/filtered by ${r.id.padEnd(22)} ${crafts} crafts/day = ${bill}/day, and ${r.timeCost * crafts}h of somebody's time`);
  }
  console.log(`  => the catchment's whole output supports ${f1(made / resident)} residents, and ONLY if the fuel or the charcoal is there.`);
  console.log(`     THAT is the X-or-Y: fuel burned on water is fuel not burned on the generator or on molotovs.`);
}

// --- dispatch -------------------------------------------------------------------------------------

const mode = process.argv[2] ?? "";
if (mode === "--tree") tree();
else if (mode === "--jobs") jobsMode();
else if (mode === "--water") water();
else if (mode === "--purify") purifyMode();
else if (mode === "--scavenge") scavengeMode();
else if (mode === "--kitchen") kitchen();
else if (mode === "--find") find();
else if (mode === "--build") build();
else if (mode === "--settle") settle();
else if (mode === "--afford") afford();
else if (mode === "--ceiling") ceiling();
else if (mode === "--slots") slots();
else if (mode === "--cistern") cistern();
else structure();
