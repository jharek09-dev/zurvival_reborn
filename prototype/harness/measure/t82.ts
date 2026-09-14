/**
 * T82 measurement runner — the combat-stakes numbers quoted in `combat/combat.ts`,
 * `sim/companions.ts`, `sim/survival.ts` and `docs/qa/QA_REVIEW_T82.md`, re-derivable on demand
 * (the T77–T81 discipline: a task's before/after figures are worthless if the thing that produced
 * them was a scratch script). It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t82.ts             # STRUCTURE: what combat can and cannot currently reach
 *   npx tsx measure/t82.ts --party     # a duel with 0/1/2/3 companions beside you — do they matter?
 *   npx tsx measure/t82.ts --cornered  # can the player EVER be out of escape options? (the trigger clause)
 *   npx tsx measure/t82.ts --burden    # woundBurden distribution — where a Last Stand threshold belongs
 *   npx tsx measure/t82.ts --play      # bot runs on the shipped city: what actually ends a run
 *
 * **It runs against the pre-T82 tree unchanged.** Everything T82 adds is looked up off the engine
 * namespace with a fallback, and a column that does not exist there reads `-`, so the "before" and
 * "after" outputs line up line for line. That is what makes the comparison a measurement rather
 * than a memory.
 *
 * `--party` resolves through `resolveCombatAction` directly (the `measure/t80.ts` rule): the question
 * is what one exchange costs, and routing it through the whole pipeline would mix the world's drift,
 * needs and events into the answer. `--cornered`, `--burden` and `--play` go through the real
 * pipeline, because there the question is exactly what a played run reaches.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPANION_FLAG,
  STRIKE_COST,
  STORY_ARCS,
  applyAction,
  availableActions,
  escapeTargets,
  resolveCombatAction,
  runEndReason,
  startRun,
  withRoster,
  woundBurden,
  type ActorId,
  type ContentId,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;

/**
 * T82 ships the GRABBED outcome, so `GRAB_CHANCE` is how the runner tells the two trees apart —
 * the same trick `measure/t81.ts` played with `category`.
 */
const HAS_T82 = ENGINE["GRAB_CHANCE"] !== undefined;
const LAST_STAND = (ENGINE["LAST_STAND_AT"] as number | undefined) ?? Number.POSITIVE_INFINITY;
const TREE = HAS_T82 ? "POST-T82" : "PRE-T82";

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

/** A shipped-city run. The weapon pool exists from T81 on, so it is always passed here. */
function city(seed: string): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-13T00:00:00.000Z" },
    load("regions"),
    load("nodes"),
    load("npcs"),
    STORY_ARCS.map((a) => a.id),
    load("encounters"),
    load("radio"),
    load("recipes"),
    load("jobs"),
    load("factions"),
    load("weapons"),
  );
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const dash = (n: number | null, f: (x: number) => string): string => (n === null ? "-".padStart(6) : f(n));
const RUNS = Number(process.env["T82_RUNS"] ?? 400);
/** Burden at which `prudent` stops fighting and starts leaving — half a Last Stand's worth. */
const PRUDENT_DISENGAGE_AT = Number(process.env["T82_DISENGAGE"] ?? 40);

// --- 1. structure -------------------------------------------------------------------------------

/**
 * The static half of the defect, read off the tree rather than recalled: does combat know companions
 * exist, can a fight end a run, and is `killCompanion` wired to anything.
 */
function structure(): void {
  const src = (rel: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "engine", "src", rel), "utf8");
  const combat = src("combat/combat.ts");
  const companions = src("sim/companions.ts");
  const survival = src("sim/survival.ts");

  console.log(`tree: ${TREE}\n`);

  const mentions = ["companion", "Companion", "actors", "killCompanion"].map((k) => [k, (combat.match(new RegExp(k, "g")) ?? []).length] as const);
  console.log("combat/combat.ts references to the party:");
  for (const [k, n] of mentions) console.log(`  ${k.padEnd(16)} ${n}`);

  // killCompanion's call sites across the whole engine — an export nothing calls is a promise with no
  // trigger, which is exactly what the design review found.
  const all = ["combat/combat.ts", "sim/companions.ts", "sim/social.ts", "sim/events.ts", "sim/overrun.ts", "sim/hordes.ts", "actions/coreActions.ts", "index.ts"];
  let callers = 0;
  for (const f of all) {
    const body = src(f);
    // a call, not the definition and not the re-export list
    const n = (body.match(/killCompanion\(/g) ?? []).length - (body.match(/export function killCompanion\(/g) ?? []).length;
    if (n > 0) { console.log(`  killCompanion called ${n}x in ${f}`); callers += n; }
  }
  console.log(`\nkillCompanion call sites in the engine: ${callers}`);
  console.log(`  (companions.ts also has ${(companions.match(/NEED_FATAL/g) ?? []).length} NEED_FATAL references — the starvation path, which is inlined, not routed through killCompanion)`);

  const reasons = /RunEndReason = ([^;]+);/.exec(survival);
  console.log(`\nRunEndReason = ${reasons?.[1] ?? "?"}`);
  console.log(`  a fight can end the run: ${/lastStand|last-stand|"overrun"/.test(survival) ? "YES" : "NO"}`);
  console.log(`\nCombatState fields: ${/interface CombatState \{([\s\S]*?)\n\}/.exec(src("state/types.ts"))?.[1]?.match(/readonly (\w+)\??:/g)?.join(" ") ?? "?"}`);
}

// --- 2. the party in a fight --------------------------------------------------------------------

const REGIONS: RegionDef[] = [{ id: "region.d", name: "Duel", description: "a fixture" }];
const NODES: NodeDef[] = [
  { id: "node.d.a", regionId: "region.d", name: "A", description: "here", adjacent: ["node.d.b"], start: true, walkers: 1 },
  { id: "node.d.b", regionId: "region.d", name: "B", description: "there", adjacent: ["node.d.a"] },
];
const ZOMBIE_FOR_ENEMY: Record<string, ContentId> = {
  "enemy.walker": "zombie.walker", "enemy.fresh": "zombie.fresh", "enemy.crawler": "zombie.crawler",
  "enemy.bloated": "zombie.bloated", "enemy.riot": "zombie.riot",
};

/** A party companion standing at the duel node, at a given trust and standing order. */
function companion(id: ActorId, trust: number, order: "follow" | "hold", at: string = "node.d.a"): Survivor {
  return {
    id,
    type: "npc.fixture",
    name: id.replace("npc.", ""),
    trust,
    condition: { needs: { hunger: 10, thirst: 10, fatigue: 10 }, wounds: [], infection: { progression: 0, stage: "none" }, mind: { stress: 0, morale: 60 } },
    location: at,
    groupId: null,
    relationships: {},
    inventory: [],
    flags: { [COMPANION_FLAG]: true, ...(order === "hold" ? { "order:hold": true } : {}) },
  } as unknown as Survivor;
}

function partyState(seed: string, enemy: ContentId, party: number, trust: number, order: "follow" | "hold"): { state: GameState; graph: RegionGraph } {
  const { state, graph } = startRun({ seed, createdAt: "2026-09-13T00:00:00.000Z" }, REGIONS, NODES);
  const here = state.nodes["node.d.a"]!;
  const nodes = { ...state.nodes, "node.d.a": withRoster(here, [ZOMBIE_FOR_ENEMY[enemy] ?? "zombie.walker"]) };
  const actors: Record<string, Survivor> = { ...(state.actors as Record<string, Survivor>) };
  for (let i = 0; i < party; i += 1) actors[`npc.p${i}`] = companion(`npc.p${i}` as ActorId, trust, order);
  return { state: { ...state, nodes, actors }, graph };
}

interface PartyResult {
  hours: number; playerWounds: number; bites: number;
  companionWounds: number; companionDeaths: number; won: boolean; grabbedTurns: number;
}

function partyDuel(seed: string, enemy: ContentId, party: number, trust: number, order: "follow" | "hold"): PartyResult {
  const { state: start, graph } = partyState(seed, enemy, party, trust, order);
  let state = start;
  let hours = 0;
  let grabbedTurns = 0;
  let buried = 0;
  // Counts the wounds of the LIVING party plus the wounds a dead companion took with them. Summing
  // only the survivors loses a casualty's three-plus wounds at the moment they die, which biases the
  // column low in exactly the cells where the party is taking the most damage — the cells the
  // COMPANION_SOAK tuning argument rests on.
  const cw = (s: GameState, buried: number): number =>
    Object.values(s.actors as Record<string, Survivor>)
      .filter((a) => a.flags[COMPANION_FLAG] === true)
      .reduce((sum, a) => sum + a.condition.wounds.length, 0) + buried;
  const alive = (s: GameState): number =>
    Object.values(s.actors as Record<string, Survivor>).filter((a) => a.flags[COMPANION_FLAG] === true).length;
  for (let n = 0; n < 80; n += 1) {
    if (state.combat === null && (state.nodes["node.d.a"]?.walkers ?? 0) === 0) break;
    const v = state.combat === null ? "fight" : "strike";
    const before = state;
    state = resolveCombatAction(state, graph, { type: v, choiceId: v, timeCost: STRIKE_COST, params: {} });
    hours += STRIKE_COST;
    for (const [id, a] of Object.entries(before.actors as Record<string, Survivor>)) {
      if (a.flags[COMPANION_FLAG] === true && (state.actors as Record<string, Survivor>)[id] === undefined) {
        buried += a.condition.wounds.length + 1; // +1: the blow that finished them
      }
    }
    // Counted AFTER the exchange, and before the run-over break. The first cut did both the other way
    // round and undercounted the column by 34% on the riot/party-0 cell (1.45 against an honest 2.19),
    // because the grabbed turn that ENDS the run is the one the loop exited on — the same
    // before-vs-after instrumentation error this file's `atRisk` field has a paragraph about. Getting
    // it right in one place and wrong three lines above it is how that lesson keeps costing.
    if ((state.combat as { grabbed?: boolean } | null)?.grabbed === true) grabbedTurns += 1;
    if (state === before) break;
    if (runEndReason(state) !== null) break;
  }
  return {
    hours,
    playerWounds: state.player.condition.wounds.length - start.player.condition.wounds.length,
    bites: state.player.condition.wounds.filter((w) => w.type === "wound.bite").length,
    companionWounds: cw(state, buried) - cw(start, 0),
    companionDeaths: alive(start) - alive(state),
    won: (state.nodes["node.d.a"]?.walkers ?? 0) === 0,
    grabbedTurns,
  };
}

function party(): void {
  const enemies = ["enemy.walker", "enemy.riot"] as const;
  console.log(`tree: ${TREE} · ${RUNS} duels per cell · strike only, fought to the end\n`);
  console.log(
    `  ${"enemy".padEnd(10)}${"party".padStart(6)}${"trust".padStart(7)}${"order".padEnd(9)}${"E[h]".padStart(7)}${"P(hurt)".padStart(8)}${"P(bite)".padStart(8)}${"cWounds".padStart(9)}${"cDeaths".padStart(9)}${"P(win)".padStart(8)}${"grabbed".padStart(9)}`,
  );
  for (const e of enemies) {
    for (const [n, trust, order] of [[0, 0, "follow"], [1, 70, "follow"], [1, 90, "follow"], [1, 90, "hold"], [2, 90, "follow"], [3, 90, "follow"]] as const) {
      const rs: PartyResult[] = [];
      // PAIRED on seed across every row of a block: the ONLY thing that differs between the
      // `party 0` row and the `party 3` row is the party, so an identical column is not a
      // coincidence of sampling — it is proof the party is not an input to the fight at all.
      for (let i = 0; i < RUNS; i += 1) rs.push(partyDuel(`t82-${e}-${i}`, e, n, trust, order));
      console.log(
        `  ${e.replace("enemy.", "").padEnd(10)}${String(n).padStart(6)}${String(trust).padStart(7)}  ${order.padEnd(7)}${f2(mean(rs.map((r) => r.hours)))}${pct(mean(rs.map((r) => (r.playerWounds > 0 ? 1 : 0))))}${pct(mean(rs.map((r) => (r.bites > 0 ? 1 : 0))))}${f2(mean(rs.map((r) => r.companionWounds)))}${f2(mean(rs.map((r) => r.companionDeaths)))}${pct(mean(rs.map((r) => (r.won ? 1 : 0))))}${f2(mean(rs.map((r) => r.grabbedTurns)))}`,
      );
    }
    console.log("");
  }
}

// --- the shared playthrough sampler -------------------------------------------------------------

interface Turn {
  readonly inCombat: boolean;
  readonly escapes: number;
  readonly burden: number;
  readonly grabbed: boolean;
}

interface Run {
  readonly turns: readonly Turn[];
  readonly endDay: number;
  readonly end: string | null;
  readonly maxBurden: number;
  readonly combats: number;
  /**
   * Turns that, **after the action resolved**, left the player grabbed and past the Last Stand line.
   *
   * Sampled after rather than before on purpose. The first cut of this diagnostic read the state at
   * the top of the loop and reported `0` for the brawler policy *while that same policy was ending 69
   * runs in a Last Stand* — because the turn that reaches the condition ends the run, so
   * `availableActions` returns nothing and the loop breaks before it can record anything. A
   * before-the-action probe can never see the state it is looking for. This is the T81 lesson in its
   * third form: the instrument decides what the measurement is capable of saying.
   */
  readonly atRisk: number;
  /** Companions who started the run vs. survived it — the bill the party pays for fighting beside you. */
  readonly partyStart: number;
  readonly partyEnd: number;
  readonly partyWounds: number;
}

/**
 * The two policies, because one number here would be a lie by omission.
 *
 * `brawler` fights everything it meets and never takes a retreat — the pessimistic bound, and the
 * policy every pre-T82 measurement in this file used, so the before/after comparison is like for like.
 * `prudent` plays the game the GDD actually asks for ("the best fight is the one avoided"): it fights
 * while the body can take it and **disengages once it is carrying real damage** — slipping past a
 * contested node, retreating out of a live fight — and treats when it can. The gap between their
 * run-end mixes is the answer to "is combat lethality now *punishing carelessness* or just *punishing
 * play*", which a single policy cannot tell you.
 *
 * A first cut of `prudent` simply preferred `slip` unconditionally and recorded **zero combat turns in
 * forty runs** — a policy that never fights cannot say anything about how lethal fighting is, and the
 * 0% it reported would have been an instrument reading dressed as a result (the T81 probe-defect
 * lesson, hit again). The disengage threshold is what makes it a player rather than a pacifist.
 */
type Policy = "brawler" | "prudent" | "escort";

/**
 * A generalist bot: fight what corners you, drink/eat/treat when it is offered, otherwise search or
 * walk. Deliberately NOT loot-hungry and with no free verb at the top of its preference list — the
 * T81 lesson is that a probe with a degenerate preference produces a clean trend that is entirely
 * the instrument.
 */
function playRun(seed: string, actions: number, policy: Policy = "brawler"): Run {
  let { state, graph } = city(seed);
  // `escort` is `brawler` with three trusted companions already at your side. Seeded rather than
  // recruited because recruitment depends on meeting the right survivor at the right trust, which
  // would make party size a property of the seed instead of the variable under test.
  if (policy === "escort") {
    const actors: Record<string, Survivor> = { ...(state.actors as Record<string, Survivor>) };
    for (let i = 0; i < 3; i += 1) actors[`npc.e${i}`] = companion(`npc.e${i}` as ActorId, 90, "follow", state.player.location);
    state = { ...state, actors };
  }
  const partyOf = (s: GameState): Survivor[] =>
    Object.values(s.actors as Record<string, Survivor>).filter((a) => a.flags[COMPANION_FLAG] === true);
  const partyStart = partyOf(state).length;
  const turns: Turn[] = [];
  let combats = 0;
  let maxBurden = 0;
  let atRisk = 0;
  let rng = 1;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  for (let i = 0; i < actions; i += 1) {
    if (runEndReason(state) !== null) break;
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    const burden = woundBurden(state.player.condition);
    if (burden > maxBurden) maxBurden = burden;
    const inCombat = state.combat !== null;
    if (inCombat) combats += 1;
    turns.push({
      inCombat,
      escapes: escapeTargets(state, graph).length,
      burden,
      grabbed: (state.combat as { grabbed?: boolean } | null)?.grabbed === true,
    });
    const prefer = (pre: string): (typeof choices)[number] | undefined => choices.find((c) => c.id.startsWith(pre));
    const moves = choices.filter((c) => c.id.startsWith("move"));
    const pick =
      policy === "prudent"
        // Fight while the body can take it; disengage once it cannot. It still swings when it is
        // grabbed, because at that point there is nothing else on offer — which is the whole point of
        // the grab, and the only way this policy ever reaches a Last Stand.
        ? (prefer("break")
           ?? (burden >= PRUDENT_DISENGAGE_AT ? (prefer("retreat") ?? prefer("slip")) : undefined)
           ?? prefer("treat") ?? prefer("drink") ?? prefer("eat")
           ?? prefer("strike") ?? prefer("fight") ?? prefer("search")
           ?? (moves.length > 0 ? moves[rand(moves.length)] : undefined) ?? choices[rand(choices.length)]!)
        : (prefer("break") ?? prefer("strike") ?? prefer("fight")
           ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? prefer("search")
           ?? (moves.length > 0 ? moves[rand(moves.length)] : undefined) ?? choices[rand(choices.length)]!);
    const before = state;
    state = applyAction(state, pick.action, graph).state;
    // Keep the escort FED. Without this the probe reported 360 of 360 companions dead and read like a
    // catastrophic combat-mortality result; every one of them had in fact starved, because
    // `tickCompanions` drifts their needs to `NEED_FATAL` and this bot never shares a can of food.
    // That death is T36's, not T82's, and leaving it in would have credited this task with it.
    if (policy === "escort") {
      const fed: Record<string, Survivor> = { ...(state.actors as Record<string, Survivor>) };
      let touched = false;
      for (const [id, a] of Object.entries(fed)) {
        if (a.flags[COMPANION_FLAG] !== true) continue;
        fed[id] = { ...a, condition: { ...a.condition, needs: { hunger: 10, thirst: 10, fatigue: 10 } } };
        touched = true;
      }
      if (touched) state = { ...state, actors: fed };
    }
    if (state.combat?.grabbed === true && woundBurden(state.player.condition) >= LAST_STAND) atRisk += 1;
    if (state === before) break;
  }
  const left = partyOf(state);
  return {
    turns, endDay: state.meta.day, end: runEndReason(state), maxBurden, combats, atRisk,
    partyStart, partyEnd: left.length,
    partyWounds: left.reduce((n, c) => n + c.condition.wounds.length, 0),
  };
}

// --- 3. cornered --------------------------------------------------------------------------------

/**
 * The trigger clause the brief specifies is "woundBurden ≥ threshold AND combat !== null AND **no
 * discovered escape target**". This asks whether that last clause is ever true. `escapeTargets` falls
 * back to every discovered neighbour when none is passable (the FR-CBT-05 fallback T77 installed),
 * and `relocatePlayer` reveals a node's neighbours on arrival — so the honest question is whether a
 * player standing anywhere on the shipped city can have zero of them.
 */
function cornered(): void {
  const N = Number(process.env["T82_PLAY"] ?? 40);
  console.log(`tree: ${TREE} · ${N} bot runs on the shipped city\n`);
  let combatTurns = 0, zeroEscape = 0, zeroEscapeInCombat = 0, grabbedTurns = 0, allTurns = 0;
  let minEscapes = Number.POSITIVE_INFINITY;
  for (let i = 0; i < N; i += 1) {
    const r = playRun(`t82-corner-${i}`, 600);
    for (const t of r.turns) {
      allTurns += 1;
      if (t.escapes === 0) zeroEscape += 1;
      if (t.escapes < minEscapes) minEscapes = t.escapes;
      if (t.inCombat) {
        combatTurns += 1;
        if (t.escapes === 0) zeroEscapeInCombat += 1;
        if (t.grabbed) grabbedTurns += 1;
      }
    }
  }
  console.log(`  turns observed                       ${allTurns}`);
  console.log(`  combat turns                         ${combatTurns}`);
  console.log(`  turns with ZERO escape targets       ${zeroEscape} (${((zeroEscape / Math.max(1, allTurns)) * 100).toFixed(1)}%)`);
  console.log(`  COMBAT turns with zero escape        ${zeroEscapeInCombat} (${((zeroEscapeInCombat / Math.max(1, combatTurns)) * 100).toFixed(1)}%)`);
  console.log(`  fewest escape targets ever offered   ${minEscapes === Number.POSITIVE_INFINITY ? "-" : minEscapes}`);
  console.log(`  combat turns GRABBED                 ${HAS_T82 ? `${grabbedTurns} (${((grabbedTurns / Math.max(1, combatTurns)) * 100).toFixed(1)}%)` : "- (pre-T82: no such state)"}`);
  console.log(
    zeroEscapeInCombat === 0
      ? `\n  => NOT OBSERVED: ${combatTurns} combat turns, ${allTurns} turns total, never fewer than ${minEscapes} escape targets.\n` +
        `     Not a proof of impossibility — but \`escapeTargets\` falls back to every DISCOVERED neighbour\n` +
        `     when none is passable, and \`relocatePlayer\` discovers a node's neighbours on arrival, so the\n` +
        `     brief's "no discovered escape target" clause needs a node with no discovered neighbour at all.`
      : `\n  => the brief's "no discovered escape target" clause IS reachable: ${zeroEscapeInCombat} combat turns.`,
  );
}

// --- 4. burden ----------------------------------------------------------------------------------

/** Where a Last Stand threshold belongs: what burden a played run actually reaches, and when. */
function burden(): void {
  const N = Number(process.env["T82_PLAY"] ?? 40);
  const THRESHOLDS = [40, 60, 80, 100, 120, 150];
  console.log(`tree: ${TREE} · ${N} bot runs on the shipped city\n`);
  const runs: Run[] = [];
  const POLICY = (process.env["T82_POLICY"] ?? "brawler") as Policy;
  for (let i = 0; i < N; i += 1) runs.push(playRun(`t82-burden-${i}`, 600, POLICY));
  const all = runs.flatMap((r) => r.turns);
  const inFight = all.filter((t) => t.inCombat);
  const sorted = [...all.map((t) => t.burden)].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  console.log(`  turns ${all.length} · combat turns ${inFight.length} · mean end day ${mean(runs.map((r) => r.endDay)).toFixed(2)}`);
  console.log(`  woundBurden over all turns: p50 ${q(0.5)} · p90 ${q(0.9)} · p99 ${q(0.99)} · max ${sorted[sorted.length - 1] ?? 0}`);
  console.log(`  max burden reached per run: mean ${mean(runs.map((r) => r.maxBurden)).toFixed(1)} · max ${Math.max(...runs.map((r) => r.maxBurden))}`);
  console.log(`\n  ${"threshold".padEnd(11)}${"% of all turns".padStart(16)}${"% of COMBAT turns".padStart(19)}${"runs that ever reach it".padStart(25)}`);
  for (const t of THRESHOLDS) {
    const runsHit = runs.filter((r) => r.maxBurden >= t).length;
    console.log(
      `  ${String(t).padEnd(11)}${pct(all.filter((x) => x.burden >= t).length / Math.max(1, all.length)).padStart(16)}${pct(inFight.filter((x) => x.burden >= t).length / Math.max(1, inFight.length)).padStart(19)}${`${runsHit}/${runs.length}`.padStart(25)}`,
    );
  }
  const ends: Record<string, number> = {};
  for (const r of runs) ends[r.end ?? "survived"] = (ends[r.end ?? "survived"] ?? 0) + 1;
  console.log(`\n  run ends: ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
}

// --- 5. play ------------------------------------------------------------------------------------

/** What actually ends a run today, and whether a fight is ever one of the answers. */
function play(): void {
  const N = Number(process.env["T82_PLAY"] ?? 40);
  console.log(`tree: ${TREE} · ${N} bot runs per policy on the shipped city\n`);
  for (const policy of ["brawler", "prudent", "escort"] as const) {
    const runs: Run[] = [];
    for (let i = 0; i < N; i += 1) runs.push(playRun(`t82-play-${i}`, 600, policy));
    const ends: Record<string, number> = {};
    for (const r of runs) ends[r.end ?? "survived"] = (ends[r.end ?? "survived"] ?? 0) + 1;
    const grabbed = runs.flatMap((r) => r.turns).filter((t) => t.grabbed).length;
    // The diagnostic that separates "a careful player is never cornered while hurt" (a design result)
    // from "the trigger is not wired" (a bug). A policy reporting 0 Last Stands must also report 0
    // here; a policy reporting turns here and 0 Last Stands would be a defect, not a finding.
    const atRisk = runs.reduce((n, r) => n + r.atRisk, 0);
    const combatTurns = runs.reduce((s, r) => s + r.combats, 0);
    console.log(`  ${policy}`);
    console.log(`    mean end day     ${mean(runs.map((r) => r.endDay)).toFixed(2)}`);
    console.log(`    combat turns     ${combatTurns}  (grabbed ${grabbed}, ${((grabbed / Math.max(1, combatTurns)) * 100).toFixed(1)}%)`);
    console.log(`    max burden/run   mean ${mean(runs.map((r) => r.maxBurden)).toFixed(1)}`);
    console.log(`    reached "grabbed AND burden >= ${LAST_STAND}": ${atRisk} times  [must equal the Last Stand count, or the trigger is not wired]`);
    console.log(`    run ends         ${Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    console.log(`    ended BY A FIGHT ${ends["lastStand"] ?? 0}/${N} (${(((ends["lastStand"] ?? 0) / N) * 100).toFixed(0)}%)`);
    const started = runs.reduce((n, r) => n + r.partyStart, 0);
    const survived = runs.reduce((n, r) => n + r.partyEnd, 0);
    console.log(`    companions       ${started} started · ${started - survived} DIED · ${runs.reduce((n, r) => n + r.partyWounds, 0)} open wounds on the survivors\n`);
  }
}

const arg = process.argv[2] ?? "";
if (arg === "--party") party();
else if (arg === "--cornered") cornered();
else if (arg === "--burden") burden();
else if (arg === "--play") play();
else structure();
