/**
 * T59 measurement runner — **balance pass 1 (survivability & scarcity)**, re-derivable on demand.
 *
 * Every figure quoted in the T59 build and in `docs/qa/QA_REVIEW_T59.md` comes from here (the
 * T77–T87 / T61 / T62 discipline: a task's before/after numbers are worthless if the thing that
 * produced them was a scratch script). It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t59.ts             # REACH: where, when and why runs end, per policy
 *   npx tsx measure/t59.ts --water     # the water ledger: demand, supply, and the city's own stock
 *   npx tsx measure/t59.ts --scarcity  # the supply side: the search cap, the haul, the city's drain clock
 *   npx tsx measure/t59.ts --offer     # the relief-offer arithmetic (how much of a canteen is wasted)
 *   npx tsx measure/t59.ts --slip      # PL-M5-27: what the cautious verb costs, and what pays for it
 *   npx tsx measure/t59.ts --dials     # the provably DEAD dials: fatigue, rest recovery, drink relief
 *   npx tsx measure/t59.ts --ceiling   # the immortal long run — what the city can support at all
 *
 * **Every T59 lookup goes through a fallback, so BOTH trees run every mode line for line** — the
 * T87/T61/T62 rule: never copy the runner into the baseline, write it so it does not need copying.
 * The tree prints as `PRE-T59` / `POST-T59` from a single probe (`reliefOfferAt`).
 *
 * The DIAL SWEEPS quoted in the review (`REST_RECOVERY` 45→5, `THIRST_RATE` 2→1, the water-weight
 * ladder …) are rebuild sweeps — a constant is edited, the tree re-run, the constant restored — and
 * `--dials` re-derives the arithmetic that explains each result rather than re-running the sweep.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  runEndReason,
  startRun,
  type GameState,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_T59 = ENGINE["reliefOfferAt"] !== undefined;
const TREE = HAS_T59 ? "POST-T59" : "PRE-T59";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = join(ROOT, "content");
const load = <T>(sub: string): T[] => {
  let files: string[];
  try { files = readdirSync(join(CONTENT, sub)); } catch { return []; }
  return files.filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);
};

function city(seed: string, difficulty?: string): { state: GameState; graph: RegionGraph } {
  const args: unknown[] = [
    { seed, createdAt: "2026-09-15T00:00:00.000Z", ...(difficulty === undefined ? {} : { difficulty }) },
    load("regions"), load("nodes"), load("npcs"),
    (ENGINE["STORY_ARCS"] as { id: string }[]).map((a) => a.id),
    load("encounters"), load("radio"), load("recipes"), load("jobs"), load("factions"), load("weapons"),
    load("projects"), load("endings"), load("stands"),
  ];
  return (startRun as unknown as (...a: unknown[]) => { state: GameState; graph: RegionGraph })(...args);
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const RUNS = Number(process.env["T59_RUNS"] ?? 24);
const ACTIONS = Number(process.env["T59_ACTIONS"] ?? 1200);

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

// --- the bots --------------------------------------------------------------------------------

/**
 * Five policies, and the spread between them is the point: a balance pass that only measures one way
 * of playing tunes the game for that way of playing.
 *
 *   settler  — walk to the nearest claimable building, strip it, claim it, build what it can.
 *   drifter  — survival verbs only, otherwise random. The floor: someone who does nothing on purpose.
 *   brawler  — fights everything and never disengages. T82's upper bound on the Last Stand rate.
 *   forager  — never fights (slips or flees), searches everything, rests when there is nothing else.
 *   medic    — the INTENDED play: drink/eat/purify/treat first, stop when hurt or exhausted, then search.
 */
export type Policy = "settler" | "drifter" | "brawler" | "forager" | "medic";
export const POLICIES: readonly Policy[] = ["settler", "drifter", "brawler", "forager", "medic"];

const burdenOf = (s: GameState): number => (ENGINE["woundBurden"] as (c: unknown) => number)(s.player.condition);

type Run = {
  seed: string;
  policy: Policy;
  end: string | null;
  day: number;
  turns: number;
  hours: number;
  /** clean water found / drunk, and the dirty water that could have become more of it */
  waterFound: number;
  dirtyFound: number;
  waterDrunk: number;
  foodFound: number;
  foodEaten: number;
  searches: number;
  searchOffers: number;
  items: number;
  /** turns spent with an empty canteen / an empty larder */
  dryTurns: number;
  hungryTurns: number;
  rests: number;
  purifies: number;
  purifyOffers: number;
  everClaimed: boolean;
  wounds: number;
  bites: number;
  medsFound: number;
  treats: number;
  combatTurns: number;
  maxBurden: number;
  /** slip-away actions taken, and the wounds/bites the parting blow landed on exactly those turns */
  slips: number;
  slipWounds: number;
  slipBites: number;
  /** turns holding dirty water, and turns holding it WITH a purify recipe's components in hand */
  turnsDirty: number;
  turnsCanBoil: number;
  turnsCanFilter: number;
  /** pack pressure — T84's named counter-pressure to a bigger haul, measured rather than assumed */
  peakLoad: number;
  heavyTurns: number;
  /** the cap a search would have paid, sampled every turn where the player stood */
  caps: number[];
  found: Record<string, number>;
  regionWater: Record<string, number>;
  regionLoot: Record<string, number>;
  worldWater: number;
};

const MED_SET = new Set(["item.bandage", "item.antiseptic", "item.antibiotics", "item.painkillers", "item.suture-kit", "item.splint"]);

/**
 * T60 extended this with `opts` — a difficulty mode and a per-turn hook — rather than writing a second
 * bot, because the T87/T61/T62 rule ("never copy the runner") applies across tasks as much as across
 * trees. Both fields are optional and default to the T59 behaviour exactly, so every figure `t59.ts`
 * prints is unmoved.
 */
export function play(
  seed: string,
  actions: number,
  policy: Policy,
  immortal = false,
  opts: { difficulty?: string; noDirector?: boolean; hook?: (s: GameState, g: RegionGraph, turn: number) => void } = {},
): Run {
  let { state, graph } = city(seed, opts.difficulty);
  // T60: the Apocalypse Director's kill switch, set on the STARTING state so the whole run is played
  // without it. It has to be here rather than in a hook — a hook sees a copy, and the run would go on
  // being directed. `directorEnabled` reads exactly this flag.
  if (opts.noDirector === true) {
    state = { ...state, world: { ...state.world, flags: { ...state.world.flags, "director.disabled": true } } };
  }
  let rng = 37;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
  const dist = hops(graph, state.player.location);
  const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];

  const yieldCap = ENGINE["searchYieldCap"] as (l: number, p: number, r?: number) => number;
  const richnessOf = ENGINE["richnessOf"] as (g: RegionGraph, n: string) => number;
  const inv = (s: GameState, t: string): number => s.player.inventory.filter((e) => e.type === t).reduce((a, e) => a + e.quantity, 0);

  const r: Run = {
    seed, policy, end: null, day: 0, turns: 0, hours: 0,
    waterFound: 0, dirtyFound: 0, waterDrunk: 0, foodFound: 0, foodEaten: 0,
    searches: 0, searchOffers: 0, items: 0, dryTurns: 0, hungryTurns: 0, rests: 0,
    purifies: 0, purifyOffers: 0, everClaimed: false,
    wounds: 0, bites: 0, medsFound: 0, treats: 0, combatTurns: 0, maxBurden: 0,
    slips: 0, slipWounds: 0, slipBites: 0, turnsDirty: 0, turnsCanBoil: 0, turnsCanFilter: 0,
    peakLoad: 0, heavyTurns: 0,
    caps: [], found: {}, regionWater: {}, regionLoot: {}, worldWater: 0,
  };

  for (let k = 0; k < actions; k += 1) {
    if (immortal) {
      state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
    }
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    r.turns += 1;
    opts.hook?.(state, graph, r.turns); // T60: read the state at the TOP of the turn, before the action
    const here = state.player.location;
    const prefer = (p: string): typeof choices[number] | undefined => choices.find((c) => c.id.startsWith(p));
    if (prefer("search") !== undefined) r.searchOffers += 1;
    if (prefer("purify") !== undefined) r.purifyOffers += 1;
    if (state.combat !== null) r.combatTurns += 1;

    const node = state.nodes[here];
    const region = node === undefined ? undefined : state.regions[node.regionId];
    if (node !== undefined && region !== undefined) {
      r.caps.push(yieldCap(region.loot, node.searchPct, richnessOf(graph, here)));
    }

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
    const rnd = (): typeof choices[number] | undefined => {
      const m = choices.filter((c) => c.id.startsWith("move"));
      return m.length > 0 ? m[rand(m.length)] : undefined;
    };
    const unsearched = (state.nodes[here]?.searchPct ?? 0) < 100;

    const pick =
      policy === "settler"
        ? (prefer("stand:") ?? prefer("break") ?? prefer("strike") ?? prefer("fight")
          ?? prefer("drink") ?? prefer("eat") ?? prefer("purify") ?? prefer("treat")
          ?? prefer("claim") ?? prefer("craft:recipe.shelter.")
          ?? (here === target && unsearched ? prefer("search") : undefined)
          ?? stepper() ?? prefer("sleep") ?? prefer("search") ?? rnd() ?? choices[rand(choices.length)]!)
        : policy === "brawler"
          ? (prefer("stand:") ?? prefer("strike") ?? prefer("heavy") ?? prefer("fight") ?? prefer("break")
            ?? prefer("drink") ?? prefer("eat") ?? rnd() ?? choices[rand(choices.length)]!)
          : policy === "forager"
            ? (prefer("stand:") ?? prefer("drink") ?? prefer("eat") ?? prefer("purify") ?? prefer("treat")
              ?? prefer("slip") ?? prefer("flee") ?? prefer("break") ?? prefer("strike")
              ?? (unsearched ? prefer("search") : undefined) ?? prefer("rest") ?? rnd() ?? choices[rand(choices.length)]!)
            : policy === "medic"
              ? (prefer("stand:") ?? prefer("drink") ?? prefer("eat") ?? prefer("purify") ?? prefer("treat")
                ?? prefer("slip") ?? prefer("flee") ?? prefer("break") ?? prefer("strike")
                ?? (burdenOf(state) >= 40 || state.player.condition.needs.fatigue >= 60 ? (prefer("sleep") ?? prefer("rest")) : undefined)
                ?? (unsearched ? prefer("search") : undefined)
                ?? prefer("claim") ?? prefer("craft:recipe.shelter.") ?? rnd() ?? prefer("rest") ?? choices[rand(choices.length)]!)
              : (prefer("stand:") ?? prefer("break") ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? choices[rand(choices.length)]!);

    const before = state;
    const bw = inv(state, "item.water"), bf = inv(state, "item.canned-food"), bd = inv(state, "item.water-dirty");
    const bm = state.player.inventory.filter((e) => MED_SET.has(e.type)).reduce((a, e) => a + e.quantity, 0);
    const bWounds = state.player.condition.wounds.length;
    const isSearch = pick.id.startsWith("search");
    if (pick.id.startsWith("rest") || pick.id.startsWith("sleep")) r.rests += 1;
    if (pick.id.startsWith("purify")) r.purifies += 1;
    if (pick.id.startsWith("treat")) r.treats += 1;
    const isSlip = pick.id.startsWith("slip");
    if (isSlip) r.slips += 1;

    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;

    const aw = inv(state, "item.water"), af = inv(state, "item.canned-food"), ad = inv(state, "item.water-dirty");
    if (aw > bw) r.waterFound += aw - bw;
    if (aw < bw) r.waterDrunk += bw - aw;
    if (af > bf) r.foodFound += af - bf;
    if (af < bf) r.foodEaten += bf - af;
    if (ad > bd) r.dirtyFound += ad - bd;
    const am = state.player.inventory.filter((e) => MED_SET.has(e.type)).reduce((a, e) => a + e.quantity, 0);
    if (am > bm) r.medsFound += am - bm;
    const aWounds = state.player.condition.wounds.length;
    if (aWounds > bWounds) {
      r.wounds += aWounds - bWounds;
      for (const w of state.player.condition.wounds.slice(bWounds)) if (w.type === "wound.bite") r.bites += 1;
      if (isSlip) {
        r.slipWounds += aWounds - bWounds;
        for (const w of state.player.condition.wounds.slice(bWounds)) if (w.type === "wound.bite") r.slipBites += 1;
      }
    }
    if (isSearch) {
      r.searches += 1;
      const gained = state.player.inventory.reduce((a, e) => a + e.quantity, 0) - before.player.inventory.reduce((a, e) => a + e.quantity, 0);
      r.items += Math.max(0, gained);
      for (const e of state.player.inventory) {
        const b = before.player.inventory.find((x) => x.type === e.type && x.itemId === e.itemId);
        const d = e.quantity - (b?.quantity ?? 0);
        if (d > 0) r.found[e.type] = (r.found[e.type] ?? 0) + d;
      }
    }
    if (state.player.shelterId !== null) r.everClaimed = true;
    const dirty = inv(state, "item.water-dirty");
    if (dirty > 0) {
      r.turnsDirty += 1;
      if (inv(state, "item.fuel") > 0) r.turnsCanBoil += 1;
      if (inv(state, "item.charcoal") > 0 && inv(state, "item.cloth") > 0) r.turnsCanFilter += 1;
    }
    if (inv(state, "item.water") === 0) r.dryTurns += 1;
    if (inv(state, "item.canned-food") === 0) r.hungryTurns += 1;
    r.maxBurden = Math.max(r.maxBurden, burdenOf(state));
    const load = (ENGINE["inventoryWeight"] as (i: unknown) => number)(state.player.inventory);
    r.peakLoad = Math.max(r.peakLoad, load);
    if (load >= (ENGINE["PACK_HEAVY"] as number)) r.heavyTurns += 1;
  }

  opts.hook?.(state, graph, r.turns + 1); // and once more at the end, so the last turn is sampled too
  r.end = runEndReason(state);
  r.day = state.meta.day;
  r.hours = state.meta.day * 24 + state.meta.hour;
  for (const [id, reg] of Object.entries(state.regions)) {
    r.regionWater[id] = reg.water;
    r.regionLoot[id] = reg.loot;
  }
  r.worldWater = state.world.water;
  return r;
}

const runsFor = (p: Policy, immortal = false): Run[] =>
  Array.from({ length: RUNS }, (_, i) => play(`t59-${i}`, ACTIONS, p, immortal));

const endMix = (rs: Run[]): string => {
  const ends: Record<string, number> = {};
  for (const x of rs) ends[String(x.end)] = (ends[String(x.end)] ?? 0) + 1;
  return Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
};

// --- REACH -----------------------------------------------------------------------------------

function reach(): void {
  console.log(`\n== WHERE RUNS END (${TREE}, ${RUNS} runs a policy, ${ACTIONS}-action cap)\n`);
  console.log("policy    turns(mean) turns(med)    day     dry%  srch  items  rest  purify  base%   ends");
  const all: Run[] = [];
  for (const p of POLICIES) {
    const rs = runsFor(p);
    all.push(...rs);
    console.log(
      `${p.padEnd(9)} ${f1(mean(rs.map((x) => x.turns)))}     ${String(median(rs.map((x) => x.turns))).padStart(5)}  ` +
      `${f2(mean(rs.map((x) => x.day)))}  ${pct(mean(rs.map((x) => x.dryTurns)) / Math.max(1, mean(rs.map((x) => x.turns))))}  ` +
      `${f1(mean(rs.map((x) => x.searches)))} ${f1(mean(rs.map((x) => x.items)))} ${f1(mean(rs.map((x) => x.rests)))}  ` +
      `${f2(mean(rs.map((x) => x.purifies)))}  ${pct(rs.filter((x) => x.everClaimed).length / rs.length)}  ${endMix(rs)}`,
    );
  }
  console.log(`\nALL POLICIES: ${all.length} runs · mean ${mean(all.map((x) => x.turns)).toFixed(1)} turns, median ${median(all.map((x) => x.turns))} · mean day ${mean(all.map((x) => x.day)).toFixed(2)}`);
  console.log(`  end mix: ${endMix(all)}`);
  const ends: Record<string, number> = {};
  for (const x of all) ends[String(x.end)] = (ends[String(x.end)] ?? 0) + 1;
  const top = Object.entries(ends).sort((a, b) => b[1] - a[1])[0];
  console.log(`  commonest cause: ${top?.[0]} at ${pct((top?.[1] ?? 0) / all.length)} — GDD XVI asks for death TIMING AND CAUSES to be tuned, i.e. no single cause owning the run`);
  console.log(`  search offered on ${pct(mean(all.map((x) => x.searchOffers)) / mean(all.map((x) => x.turns)))} of turns · taken ${f1(mean(all.map((x) => x.searches)))} a run`);
}

// --- WATER -----------------------------------------------------------------------------------

function water(): void {
  console.log(`\n== THE WATER LEDGER (${TREE})\n`);
  const THIRST = ENGINE["THIRST_RATE"] as number;
  const RELIEF = ENGINE["DRINK_RELIEF"] as number;
  const HUNGER = ENGINE["HUNGER_RATE"] as number;
  const EAT = ENGINE["EAT_RELIEF"] as number;
  console.log(`  demand: thirst ${THIRST}/h x 24 = ${THIRST * 24}/day against a canteen's ${RELIEF} ⇒ ${(THIRST * 24 / RELIEF).toFixed(2)} units a day`);
  console.log(`          hunger ${HUNGER}/h x 24 = ${HUNGER * 24}/day against a ration's ${EAT} ⇒ ${(HUNGER * 24 / EAT).toFixed(2)} units a day`);
  console.log(`  so THIRST IS THE SHARPEST CLOCK by a factor of ${((THIRST * 24 / RELIEF) / (HUNGER * 24 / EAT)).toFixed(2)} — which is by design (GDD V), and is why the supply below decides the run.\n`);

  console.log("policy    W found  W drunk  W/day  need/day   dirty  purified   F found  F eaten   items/search");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    const days = Math.max(0.01, mean(rs.map((x) => x.day)));
    console.log(
      `${p.padEnd(9)} ${f2(mean(rs.map((x) => x.waterFound)))}  ${f2(mean(rs.map((x) => x.waterDrunk)))}  ` +
      `${f2(mean(rs.map((x) => x.waterFound)) / days)}    ${(THIRST * 24 / RELIEF).toFixed(2)}    ` +
      `${f2(mean(rs.map((x) => x.dirtyFound)))}   ${f2(mean(rs.map((x) => x.purifies)))}    ` +
      `${f2(mean(rs.map((x) => x.foodFound)))}  ${f2(mean(rs.map((x) => x.foodEaten)))}     ` +
      `${f2(mean(rs.map((x) => x.items)) / Math.max(0.01, mean(rs.map((x) => x.searches))))}`,
    );
  }

  console.log(`\n-- the purify bridge: dirty water is the commoner find, and this is how often it can be crossed --\n`);
  console.log("policy    turns holding dirty   ...with fuel (boil)   ...with charcoal+cloth (filter)   purify offered   taken");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    const t = Math.max(1, mean(rs.map((x) => x.turns)));
    console.log(
      `${p.padEnd(9)} ${f1(mean(rs.map((x) => x.turnsDirty)))} (${pct(mean(rs.map((x) => x.turnsDirty)) / t).trim()})      ` +
      `${f2(mean(rs.map((x) => x.turnsCanBoil)))}              ${f2(mean(rs.map((x) => x.turnsCanFilter)))}                  ` +
      `${f2(mean(rs.map((x) => x.purifyOffers)))}       ${f2(mean(rs.map((x) => x.purifies)))}`,
    );
  }

  console.log(`\n-- water as a PROPERTY OF PLACE (RegionState.water · world.water · FR-SIM-08) --\n`);
  const drinkable = ENGINE["drinkableWaterOf"] as ((r: { water: number }, w: { water: number } | undefined) => number) | undefined;
  const weightOf = ENGINE["itemLootWeight"] as (id: string, level?: number) => number;
  const clean = (ENGINE["CLEAN_WATER_ITEM"] as string | undefined) ?? "item.water";
  const perUnit = ENGINE["WATER_POINTS_PER_UNIT"] as number | undefined;
  const regions = load<{ id: string; baseline?: { water?: number; loot?: number; survivorActivity?: number } }>("regions");
  if (drinkable === undefined) {
    console.log("  PRE-T59: `RegionState.water` and `world.water` have NO READER anywhere in the engine.");
    console.log("  The city authors where its water is and nothing asks. FR-SIM-08's water third is unimplemented.");
  }
  console.log("  district            authored water   drinkable now   weight of item.water   stock (units)");
  let total = 0;
  for (const def of [...regions].sort((a, b) => a.id.localeCompare(b.id))) {
    const w = def.baseline?.water ?? 0;
    const eff = drinkable === undefined ? w : drinkable({ water: w }, { water: 100 });
    const wt = drinkable === undefined ? weightOf(clean) : weightOf(clean, eff);
    const units = perUnit === undefined ? Number.NaN : Math.floor(w / perUnit);
    if (Number.isFinite(units)) total += units;
    console.log(`  ${def.id.replace("region.", "").padEnd(20)} ${String(w).padStart(6)}        ${String(eff).padStart(6)}            ${String(wt).padStart(6)}             ${Number.isFinite(units) ? String(units).padStart(5) : "  n/a"}`);
  }
  console.log(`  ${"".padEnd(20)} ${"".padStart(6)}        ${"".padStart(6)}            ${"".padStart(6)}      total ${Number.isFinite(total) ? total : "n/a"}`);
  if (perUnit !== undefined) {
    const daily = (THIRST * 24) / RELIEF;
    console.log(`\n  The whole city therefore holds ${total} drinkable units — ${(total / daily).toFixed(0)} player-days of water, drunk to the last drop,`);
    console.log(`  before a single point is spent on a companion or lost to the mains failing. Finite, exactly as the loot is (GDD X rule 4).`);
  }
}

// --- SCARCITY --------------------------------------------------------------------------------

function scarcity(): void {
  console.log(`\n== THE SUPPLY SIDE (${TREE})\n`);
  const DIV = ENGINE["LOOT_CONTEST_DIVISOR"] as number;
  const PER = ENGINE["LOOT_POINTS_PER_ITEM"] as number;
  console.log(`-- the city's own drain clock: rivals take one point per ${DIV} pressure-hours (activity x hours), with the player ASLEEP --\n`);
  const regions = load<{ id: string; baseline?: { loot?: number; survivorActivity?: number } }>("regions");
  console.log("  district            loot  activity   pts/day   empty on day");
  for (const def of [...regions].sort((a, b) => a.id.localeCompare(b.id))) {
    const loot = def.baseline?.loot ?? 0;
    const act = def.baseline?.survivorActivity ?? 0;
    const perDay = (act * 24) / DIV;
    console.log(`  ${def.id.replace("region.", "").padEnd(20)} ${String(loot).padStart(4)}  ${String(act).padStart(6)}     ${perDay.toFixed(2).padStart(6)}        ${perDay > 0 ? (loot / perDay).toFixed(1).padStart(5) : "never"}`);
  }
  console.log(`\n  Every district's stock is a race between the player and the world. A city that strips itself before the`);
  console.log(`  run reaches it is not "contested" (GDD X rule 4), it is already over — which is what ${DIV === 50 ? "this clock is" : "the pre-T59 clock at 50 was"}.`);

  console.log(`\n-- what a search is worth WHERE THE PLAYER ACTUALLY STANDS (${RUNS} runs x ${POLICIES.length} policies) --\n`);
  const caps: number[] = [];
  const found: Record<string, number> = {};
  let searches = 0, items = 0, runs = 0;
  for (const p of POLICIES) {
    for (const r of runsFor(p)) {
      caps.push(...r.caps);
      searches += r.searches; items += r.items; runs += 1;
      for (const [k, v] of Object.entries(r.found)) found[k] = (found[k] ?? 0) + v;
    }
  }
  const hist: Record<number, number> = {};
  for (const c of caps) hist[c] = (hist[c] ?? 0) + 1;
  console.log(`  search cap: ${Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 12).map(([k, v]) => `${k}:${((v / caps.length) * 100).toFixed(0)}%`).join(" ")}  mean ${mean(caps).toFixed(2)}`);
  console.log(`  ${LOOT_POINTS_LABEL(PER)}`);
  console.log(`  searches ${(searches / runs).toFixed(1)} a run · items ${(items / runs).toFixed(1)} a run · ${(items / Math.max(1, searches)).toFixed(2)} an item per search`);
  console.log(`\n  THE PACK — T84's named counter-pressure to a bigger haul (CARRY_CAPACITY ${ENGINE["CARRY_CAPACITY"]}, PACK_HEAVY ${ENGINE["PACK_HEAVY"]}):`);
  console.log("  policy    peak load   turns at/over PACK_HEAVY   share of the run");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    const t = Math.max(1, mean(rs.map((x) => x.turns)));
    console.log(`  ${p.padEnd(9)} ${f1(mean(rs.map((x) => x.peakLoad)))}      ${f1(mean(rs.map((x) => x.heavyTurns)))}                  ${pct(mean(rs.map((x) => x.heavyTurns)) / t)}`);
  }
  console.log(`  found mix (per run): ${Object.entries(found).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace("item.", "")} ${(v / runs).toFixed(2)}`).join(" · ")}`);
}
const LOOT_POINTS_LABEL = (per: number): string =>
  `a search converts region points into items at ${per} points each, so a cap of C pays ceil(draw(1..C)/${per}) items`;

// --- OFFER -----------------------------------------------------------------------------------

function offer(): void {
  console.log(`\n== THE RELIEF-OFFER ARITHMETIC (${TREE})\n`);
  const at = ENGINE["reliefOfferAt"] as ((r: number) => number) | undefined;
  // `RELIEF_OFFER_AT` is not on the engine's public surface in either tree; 34 is its value, quoted here
  // so the pre-T59 column is arithmetic rather than a hole.
  const flat = (ENGINE["RELIEF_OFFER_AT"] as number | undefined) ?? 34;
  const rows: [string, number][] = [
    ["drink (water)", ENGINE["DRINK_RELIEF"] as number],
    ["eat (canned)", ENGINE["EAT_RELIEF"] as number],
    ["eat (fresh)", (ENGINE["FRESH_EAT_RELIEF"] as number | undefined) ?? 60],
    ["eat (spoiled)", (ENGINE["SPOILED_EAT_RELIEF"] as number | undefined) ?? 20],
  ];
  console.log("  action           relief   offered at   wasted if taken at once   share of the unit");
  for (const [label, relief] of rows) {
    const threshold = at === undefined ? flat : at(relief);
    const wasted = Math.max(0, relief - threshold);
    console.log(`  ${label.padEnd(16)} ${String(relief).padStart(5)}   ${String(threshold).padStart(9)}   ${String(wasted).padStart(21)}   ${pct(wasted / relief)}`);
  }
  console.log(`\n  A need is clamped at 0, so everything above the threshold is poured on the ground. At a FLAT ${flat}`);
  console.log(`  — the pre-T59 rule for every relief alike — a player who takes the offer the moment the interface makes`);
  console.log(`  it throws away more than a third of every unit of water in the game, and a player who waits does not.`);
  console.log(`  That is the interface teaching the wrong play, which GDD XVI's balancing method and ACCESSIBILITY §6`);
  console.log(`  both rule out. ${at === undefined ? "This tree has the FLAT rule." : "This tree offers each relief at its OWN value, capped by RELIEF_OFFER_CEILING."}`);
  if (at !== undefined) {
    console.log(`\n  For comparison, the same table under the pre-T59 flat ${flat}:`);
    for (const [label, relief] of rows) {
      const wasted = Math.max(0, relief - flat);
      console.log(`  ${label.padEnd(16)} ${String(relief).padStart(5)}   ${String(flat).padStart(9)}   ${String(wasted).padStart(21)}   ${pct(wasted / relief)}`);
    }
  }
}

// --- SLIP (PL-M5-27) -------------------------------------------------------------------------

function slip(): void {
  console.log(`\n== PL-M5-27 — WHAT THE CAUTIOUS VERB COSTS (${TREE})\n`);
  console.log(`  The 'forager' policy never enters a fight: it slips away or flees from everything. That is the play the`);
  console.log(`  Survival Triangle sells as buying Safety with Time, and T77 roughly doubled the chance it is detected`);
  console.log(`  (29.9% -> 60.5%) without retuning the table the parting blow draws from.\n`);
  console.log("policy    combat turns   wounds   bites   meds found   treats   max burden   LAST_STAND_AT   ends");
  for (const p of ["forager", "medic", "brawler"] as Policy[]) {
    const rs = runsFor(p);
    console.log(
      `${p.padEnd(9)} ${f1(mean(rs.map((x) => x.combatTurns)))}       ${f2(mean(rs.map((x) => x.wounds)))}  ${f2(mean(rs.map((x) => x.bites)))}  ` +
      `${f2(mean(rs.map((x) => x.medsFound)))}       ${f2(mean(rs.map((x) => x.treats)))}   ${f1(mean(rs.map((x) => x.maxBurden)))}        ` +
      `${String(ENGINE["LAST_STAND_AT"]).padStart(3)}         ${endMix(rs)}`,
    );
  }
  console.log(`\n  THE PARTING BLOW ITSELF — wounds landed on the very turn a slip away was taken:`);
  console.log("  policy    slips   parting wounds   of which bites   bite share of a detected slip");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    const sl = mean(rs.map((x) => x.slips));
    const sw = mean(rs.map((x) => x.slipWounds));
    const sb = mean(rs.map((x) => x.slipBites));
    console.log(`  ${p.padEnd(9)} ${f2(sl)}   ${f2(sw)}            ${f2(sb)}           ${sw > 0 ? pct(sb / sw) : "      —"}`);
  }
  const care = ENGINE["REST_WOUND_CARE"] as number | undefined;
  console.log(`\n  A wound leaves the body only when its care completes. ${care === undefined
    ? "In this tree the ONLY source of care is a medical item — so the deficit above is the whole story."
    : `In this tree a deliberate rest also applies ${care} care an hour (GDD VI), so a bite's severity of 40 costs ${Math.ceil(40 / care)} in-game hours of lying still.`}`);
}

// --- DIALS -----------------------------------------------------------------------------------

function dials(): void {
  console.log(`\n== THE DIALS THAT DO NOTHING (${TREE})\n`);
  console.log(`  Measured by REBUILD SWEEP (edit the constant, re-run 96 runs across four policies, restore):`);
  console.log(`    REST_RECOVERY   45 -> 5   : byte-identical to doing nothing`);
  console.log(`    REST_RECOVERY   45 -> 80  : byte-identical to doing nothing`);
  console.log(`    FATIGUE_RATE     2 -> 1   : byte-identical to doing nothing`);
  console.log(`    FATIGUE_RATE     2 -> 8   : mean run moves 43.3 -> 43.4 turns`);
  console.log(`    DRINK_RELIEF    55 -> 80  : byte-identical (everything above the offer threshold is clamped away)`);
  console.log(`  ...against a control that proves the instrument: HUNGER_RATE 1 -> 12 ends 95 of 96 runs in 'starved' by day 1.25.\n`);
  console.log(`  Why fatigue is inert, re-derived here rather than asserted:`);
  const FAT = ENGINE["FATIGUE_RATE"] as number;
  const REC = ENGINE["REST_RECOVERY"] as number;
  console.log(`    - fatigue climbs ${FAT}/h and is relieved ${REC} by a rest, and NEED_FATAL (${ENGINE["NEED_FATAL"]}) does not apply to it:`);
  console.log(`      maxed fatigue is not a death, unlike maxed hunger or thirst.`);
  console.log(`    - grep the engine: nothing reads \`needs.fatigue\` for a combat, stealth, carry or accuracy malus.`);
  const care = ENGINE["REST_WOUND_CARE"] as number | undefined;
  console.log(`    - so a rest bought back a number that nothing spends. ${care === undefined
    ? "The Survival Triangle's Time corner has no price (GDD XVI rule 2)."
    : `T59 gave the rest verb the job GDD VI assigns it — ${care} wound-care an hour — so stopping now buys something and costs hours.`}`);
  console.log(`\n  Turns spent at fatigue >= 80, and what they cost, per policy:`);
  for (const p of POLICIES) {
    const rs = runsFor(p);
    console.log(`    ${p.padEnd(9)} rests ${f1(mean(rs.map((x) => x.rests)))} of ${f1(mean(rs.map((x) => x.turns)))} turns · max burden ${f1(mean(rs.map((x) => x.maxBurden)))}`);
  }
}

// --- CEILING ---------------------------------------------------------------------------------

function ceiling(): void {
  console.log(`\n== THE CEILING — an IMMORTAL survivor, to see what the city can support at all (${TREE})\n`);
  console.log(`  Needs, wounds and infection are cleared every turn, so nothing but the world itself stops the run.`);
  console.log(`  This is the upper bound a balance pass is tuning TOWARD, and the honest read of how much game is there.\n`);
  console.log("policy    turns    day    searches  items   region loot at end                             world.water");
  for (const p of ["forager", "settler"] as Policy[]) {
    const rs = Array.from({ length: Math.max(4, Math.floor(RUNS / 4)) }, (_, i) => play(`t59-${i}`, 1500, p, true));
    const loot: Record<string, number[]> = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.regionLoot)) (loot[k] ??= []).push(v);
    console.log(
      `${p.padEnd(9)} ${f1(mean(rs.map((x) => x.turns)))} ${f1(mean(rs.map((x) => x.day)))} ${f1(mean(rs.map((x) => x.searches)))}   ${f1(mean(rs.map((x) => x.items)))}   ` +
      Object.entries(loot).sort().map(([k, v]) => `${k.replace("region.", "").slice(0, 4)} ${mean(v).toFixed(0)}`).join(" ") +
      `   ${f1(mean(rs.map((x) => x.worldWater)))}`,
    );
  }
}

// --- main ------------------------------------------------------------------------------------

// T60: run the dispatch only when this file IS the command. `measure/t60.ts` imports `play` from here,
// and an unguarded top-level `else reach()` meant every T60 invocation first executed 120 full T59 runs
// and printed the T59 table — roughly doubling its runtime and printing something its header never
// promised. An audit found it. `process.argv[1]` is the script node was asked to run.
const invokedDirectly = (process.argv[1] ?? "").endsWith("t59.ts") || (process.argv[1] ?? "").endsWith("t59.js");
const argv = process.argv.slice(2);
const has = (f: string): boolean => argv.includes(f);
if (!invokedDirectly) { /* imported as a library — print nothing */ }
else if (has("--water")) water();
else if (has("--scarcity")) scarcity();
else if (has("--offer")) offer();
else if (has("--slip")) slip();
else if (has("--dials")) dials();
else if (has("--ceiling")) ceiling();
else reach();
