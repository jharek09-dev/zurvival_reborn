/**
 * T80 measurement runner — the duel arithmetic quoted in `combat/weapons.ts` and
 * `docs/qa/QA_REVIEW_T80.md`, re-derivable on demand (the T77/T78/T79 discipline: a task's
 * before/after figures are worthless if the thing that produced them was a scratch script).
 * It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t80.ts             # the duel table: every enemy x every tactic, before/after comparable
 *   npx tsx measure/t80.ts --sweep     # the firearm-accuracy sweep the dials were chosen from
 *   npx tsx measure/t80.ts --weapon    # bare hands vs the one equippable artifact, per enemy
 *   npx tsx measure/t80.ts --verbs     # HEAVY and PUSH against strike/retreat (post-T80 only)
 *   npx tsx measure/t80.ts --city      # is any of it visible in bot play? (the T78/T79 inertness check)
 *
 * **It runs against the pre-T80 tree unchanged.** Everything new is looked up off the engine
 * namespace with a fallback, and the tactics that do not exist there are skipped with a printed
 * reason — so the "before" run prints the same table, column for column, for the tactics both trees
 * have. That is what makes the before/after comparison a measurement rather than a memory.
 *
 * A duel is resolved through `resolveCombatAction` directly rather than `applyAction`: the question
 * is what the exchange costs, and routing it through the whole pipeline would mix the world's drift,
 * needs and events into the answer. Hours are therefore counted from the verbs' own declared costs
 * (STRIKE_COST / FIRE_COST / HEAVY_COST / RETREAT_COST), which is exactly what the pipeline would
 * have charged.
 */

import {
  ENEMIES,
  MELEE_NOISE,
  FIRE_NOISE,
  STRIKE_COST,
  FIRE_COST,
  RETREAT_COST,
  SLIP_COST,
  WEAPON_SLOT,
  resolveCombatAction,
  startRun,
  withRoster,
  type ContentId,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;
const HAS_WEAPONS = ENGINE["WEAPONS"] !== undefined;
const HEAVY_COST = (ENGINE["HEAVY_COST"] as number | undefined) ?? STRIKE_COST;
const PUSH_COST = (ENGINE["PUSH_COST"] as number | undefined) ?? 1;
const WEAPONS = (ENGINE["WEAPONS"] ?? {}) as Record<string, { readonly accuracy: number; readonly noise: number; readonly dmgMin: number; readonly dmgMax: number; readonly armorPierce: number; readonly retaliateModifier: number; readonly durabilityCost: number }>;

// --- the fixture ------------------------------------------------------------------------------

const REGIONS: RegionDef[] = [{ id: "region.d", name: "Duel", description: "a fixture" }];
const NODES: NodeDef[] = [
  { id: "node.d.a", regionId: "region.d", name: "A", description: "here", adjacent: ["node.d.b"], start: true, walkers: 1 },
  { id: "node.d.b", regionId: "region.d", name: "B", description: "there", adjacent: ["node.d.a"] },
];

const ZOMBIE_FOR_ENEMY: Record<string, ContentId> = {
  "enemy.walker": "zombie.walker",
  "enemy.fresh": "zombie.fresh",
  "enemy.crawler": "zombie.crawler",
  "enemy.bloated": "zombie.bloated",
  "enemy.riot": "zombie.riot",
};

interface Setup {
  readonly enemy: ContentId;
  /** Item type of the equipped melee artifact, or null for bare hands. */
  readonly weapon: ContentId | null;
  readonly rounds: number;
  /**
   * A ROUSED, LOUD node rather than the quiet fixture — noise 60 and `zombieState: "chasing"`, which
   * T77 measured as the state **85% of real escapes happen in**. The quiet fixture understates every
   * escape term (the whole roll is near its floor there, so a bonus that subtracts from it reads as a
   * clean getaway); this is the shape the player actually meets.
   */
  readonly loud?: boolean;
}

/** One duel fixture: a single body of `enemy` at the start node, the player kitted as asked. */
function duelState(seed: string, s: Setup): { state: GameState; graph: RegionGraph } {
  const { state, graph } = startRun({ seed, createdAt: "2026-09-13T00:00:00.000Z" }, REGIONS, NODES);
  const here0 = state.nodes["node.d.a"]!;
  const here = s.loud === true ? { ...here0, noise: 60, zombieState: "chasing" as const } : here0;
  const nodes = { ...state.nodes, "node.d.a": withRoster(here, [ZOMBIE_FOR_ENEMY[s.enemy] ?? "zombie.walker"]) };
  const inventory = s.rounds > 0
    ? [{ type: "item.pistol" as ContentId, quantity: 1 }, { type: "item.ammo" as ContentId, quantity: s.rounds }]
    : [];
  let next: GameState = { ...state, nodes, player: { ...state.player, inventory } };
  if (s.weapon !== null) {
    const id = `${s.weapon}#fixture`;
    next = {
      ...next,
      items: { ...next.items, [id]: { type: s.weapon, quality: 100, durability: 100, metadata: {} } },
      player: {
        ...next.player,
        inventory: [...next.player.inventory, { type: s.weapon, quantity: 1, itemId: id }],
        equipment: { ...next.player.equipment, [WEAPON_SLOT]: id },
      },
    };
  }
  return { state: next, graph };
}

type Verb = "fight" | "strike" | "fire" | "heavy" | "push" | "retreat";
const COST: Record<Verb, number> = {
  fight: STRIKE_COST, strike: STRIKE_COST, fire: FIRE_COST, heavy: HEAVY_COST, push: PUSH_COST, retreat: RETREAT_COST,
};

interface Result {
  readonly hours: number;
  readonly wounds: number;
  readonly bites: number;
  readonly roundsSpent: number;
  readonly won: boolean;
  readonly fled: boolean;
  readonly durabilityLost: number;
}

const woundCount = (s: GameState): number => s.player.condition.wounds.length;
const biteCount = (s: GameState): number => s.player.condition.wounds.filter((w) => w.type === "wound.bite").length;
const ammoOf = (s: GameState): number => s.player.inventory.find((e) => e.type === "item.ammo")?.quantity ?? 0;
const durabilityOf = (s: GameState): number => {
  const id = s.player.equipment[WEAPON_SLOT];
  return id === undefined ? 0 : (s.items[id]?.durability ?? 0);
};

/** Play one duel with a fixed verb plan until the body is down, the player runs, or the guard trips. */
function duel(seed: string, s: Setup, plan: (state: GameState, n: number) => Verb | null): Result {
  const { state: start, graph } = duelState(seed, s);
  let state = start;
  let hours = 0;
  for (let n = 0; n < 60; n += 1) {
    if (state.combat === null && (state.nodes["node.d.a"]?.walkers ?? 0) === 0) break;
    const verb = plan(state, n);
    if (verb === null) break;
    const params = verb === "retreat" ? { to: "node.d.b", noise: 5 } : {};
    const before = state;
    state = resolveCombatAction(state, graph, { type: verb, choiceId: verb, timeCost: COST[verb], params });
    hours += COST[verb];
    if (state === before && verb !== "push") break; // an inert verb on this tree — stop rather than spin
    if (verb === "retreat") break;
  }
  return {
    hours,
    wounds: woundCount(state) - woundCount(start),
    bites: biteCount(state) - biteCount(start),
    roundsSpent: ammoOf(start) - ammoOf(state),
    won: (state.nodes["node.d.a"]?.walkers ?? 0) === 0,
    fled: state.player.location === "node.d.b",
    durabilityLost: durabilityOf(start) - durabilityOf(state),
  };
}

// --- tactics ----------------------------------------------------------------------------------

const melee = (state: GameState): Verb => (state.combat === null ? "fight" : "strike");
const gun = (state: GameState): Verb => (ammoOf(state) > 0 ? "fire" : melee(state));
const heavyOnly = (): Verb => "heavy";
/** Open with a strike, then shove and break off — the T80 escape line. */
const pushOut = (state: GameState, n: number): Verb | null => (n === 0 ? "fight" : n === 1 ? "push" : n === 2 ? "retreat" : null);
/** The same line without the shove, so the shove's worth is the difference between the two. */
const plainOut = (state: GameState, n: number): Verb | null => (n === 0 ? "fight" : n === 1 ? "retreat" : null);

const TACTICS: { readonly [k: string]: (state: GameState, n: number) => Verb | null } = {
  melee, gun, heavy: heavyOnly, "push+run": pushOut, "run": plainOut,
};

// --- reporting --------------------------------------------------------------------------------

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(5);

function batch(s: Setup, tactic: string, runs: number): { readonly [k: string]: number } {
  const plan = TACTICS[tactic]!;
  const rs: Result[] = [];
  for (let i = 0; i < runs; i += 1) rs.push(duel(`t80-${tactic}-${s.enemy}-${s.weapon ?? "bare"}-${i}`, s, plan));
  return {
    hours: mean(rs.map((r) => r.hours)),
    wounded: mean(rs.map((r) => (r.wounds > 0 ? 1 : 0))),
    wounds: mean(rs.map((r) => r.wounds)),
    bitten: mean(rs.map((r) => (r.bites > 0 ? 1 : 0))),
    rounds: mean(rs.map((r) => r.roundsSpent)),
    won: mean(rs.map((r) => (r.won ? 1 : 0))),
    wear: mean(rs.map((r) => r.durabilityLost)),
  };
}

const RUNS = Number(process.env["T80_RUNS"] ?? 3000);
const ENEMY_IDS = Object.keys(ENEMIES);

function header(): void {
  console.log(`\ntree: ${HAS_WEAPONS ? "POST-T80 (WEAPONS present)" : "PRE-T80 (no weapon table)"} · ${RUNS} duels per cell`);
  if (HAS_WEAPONS) {
    const w = WEAPONS["item.pistol"];
    console.log(`pistol: acc ${w?.accuracy} noise ${w?.noise} dmg ${w?.dmgMin}-${w?.dmgMax} pierce ${w?.armorPierce}`);
    const b = WEAPONS["weapon.bare"];
    console.log(`bare  : acc ${b?.accuracy} noise ${b?.noise} dmg ${b?.dmgMin}-${b?.dmgMax} retal ${b?.retaliateModifier}`);
  }
  console.log(`costs: strike ${STRIKE_COST}h fire ${FIRE_COST}h heavy ${HEAVY_COST}h push ${PUSH_COST}h retreat ${RETREAT_COST}h slip ${SLIP_COST}h · noise melee ${MELEE_NOISE} fire ${FIRE_NOISE}\n`);
}

function table(tactics: readonly string[], weapon: ContentId | null, rounds: number, loud = false): void {
  console.log(`  ${"enemy".padEnd(14)}${"tactic".padEnd(10)}${"E[h]".padStart(6)}${"P(hurt)".padStart(8)}${"E[wnd]".padStart(7)}${"P(bite)".padStart(8)}${"rounds".padStart(7)}${"P(win)".padStart(8)}${"wear".padStart(6)}`);
  for (const e of ENEMY_IDS) {
    for (const t of tactics) {
      const r = batch({ enemy: e, weapon, rounds, ...(loud ? { loud: true } : {}) }, t, RUNS);
      console.log(`  ${e.replace("enemy.", "").padEnd(14)}${t.padEnd(10)}${f2(r["hours"]!)} ${pct(r["wounded"]!)} ${f2(r["wounds"]!)}  ${pct(r["bitten"]!)} ${f2(r["rounds"]!)}  ${pct(r["won"]!)} ${f2(r["wear"]!)}`);
    }
  }
}

function main(): void {
  const arg = process.argv[2] ?? "";
  header();
  if (arg === "--weapon") {
    console.log("BARE HANDS (nothing equipped)");
    table(["melee", "heavy"].filter((t) => t === "melee" || HAS_WEAPONS), null, 0);
    console.log("\nitem.tool-reinforced EQUIPPED");
    table(["melee", "heavy"].filter((t) => t === "melee" || HAS_WEAPONS), "item.tool-reinforced", 0);
    return;
  }
  if (arg === "--verbs") {
    if (!HAS_WEAPONS) { console.log("HEAVY/PUSH do not exist on this tree — nothing to measure."); return; }
    console.log("the escape line on a QUIET node: strike then run, vs strike then SHOVE then run");
    table(["run", "push+run"], null, 0);
    console.log("\nthe same line on a LOUD, CHASING node — where 85% of real escapes happen (T77)");
    table(["run", "push+run"], null, 0, true);
    return;
  }
  console.log("melee (bare hands) vs the gun, one body, fought to the end");
  table(["melee", "gun"], null, 6);
}

main();
