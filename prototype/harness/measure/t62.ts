/**
 * T62 measurement runner — the failure-ending numbers quoted in the T62 build and
 * `docs/qa/QA_REVIEW_T62.md`, re-derivable on demand (the T77–T87/T61 discipline: a task's
 * before/after figures are worthless if the thing that produced them was a scratch script).
 * It asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t62.ts              # STRUCTURE: the failure surface as it stands
 *   npx tsx measure/t62.ts --reach      # where runs actually END, per policy
 *   npx tsx measure/t62.ts --stand      # THE CLAIM: turns of agency between entering the stand and the end
 *   npx tsx measure/t62.ts --hands      # WHAT IS IN HAND at the Last Stand frame (the GDD's three spends)
 *   npx tsx measure/t62.ts --sacrifice  # PL-M5-69: can a Last Stand happen at your own door?
 *   npx tsx measure/t62.ts --siege      # the breach: is the player ever HOME when the wall goes?
 *   npx tsx measure/t62.ts --infection  # PL-M4-20: the succumb path, and what the log holds for it
 *   npx tsx measure/t62.ts --identity   # byte-identity digest with no stand pool registered
 *
 * Every T62 lookup goes through a fallback, so BOTH trees run every mode line for line (the T87/T61
 * lesson: never copy the runner into the baseline — write it so it does not need copying).
 */

import { readFileSync, readdirSync } from "node:fs";
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
const HAS_T62 = ENGINE["standChoices"] !== undefined;
const TREE = HAS_T62 ? "POST-T62" : "PRE-T62";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = join(ROOT, "content");
const load = <T>(sub: string): T[] => {
  let files: string[];
  try { files = readdirSync(join(CONTENT, sub)); } catch { return []; }
  return files.filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);
};

function cityWith(seed: string, stands: unknown[]): { state: GameState; graph: RegionGraph } {
  const args: unknown[] = [
    { seed, createdAt: "2026-09-14T00:00:00.000Z" },
    load("regions"), load("nodes"), load("npcs"),
    (ENGINE["STORY_ARCS"] as { id: string }[]).map((a) => a.id),
    load("encounters"), load("radio"), load("recipes"), load("jobs"), load("factions"), load("weapons"),
    load("projects"), load("endings"),
  ];
  // T62 adds a 14th content argument (stands). Pre-T62 `startRun` ignores extra args, so one call
  // shape runs in both trees.
  args.push(stands);
  return (startRun as unknown as (...a: unknown[]) => { state: GameState; graph: RegionGraph })(...args);
}
const city = (seed: string): { state: GameState; graph: RegionGraph } => cityWith(seed, load("stands"));
/** The pre-T62 configuration in either tree — no stand pool. What `--identity` drives. */
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
/**
 * Endings registered, stands NOT — **exactly the shipped pre-T62 game**, in either tree. This is what
 * the before column of `--distinct` is measured against, so the comparison is T62's contribution alone
 * rather than T61's and T62's together.
 */
const cityNoStands = (seed: string): { state: GameState; graph: RegionGraph } => cityWith(seed, []);

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const RUNS = Number(process.env["T62_RUNS"] ?? 40);
const ACTIONS = Number(process.env["T62_ACTIONS"] ?? 600);

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

type Policy = "settler" | "drifter" | "brawler" | "homebody";

/** One frame's worth of what was true when the Last Stand opened. */
type StandFrame = {
  day: number;
  atBase: boolean;
  everClaimed: boolean;
  enemyId: string;
  enemyHp: number;
  companions: number;
  metSurvivors: number;
  wounds: number;
  burden: number;
  weapon: string;
  loadedFirearm: boolean;
  items: number;
  distinctItems: string[];
  nodeWalkers: number;
  choicesOffered: number;
  choiceIds: string[];
};

type Run = {
  seed: string;
  policy: Policy;
  endDay: number;
  turns: number;
  end: string | null;
  closing: string;
  closingChoices: number;
  everClaimed: boolean;
  atBase: boolean;
  turnsAtBase: number;
  combatAtBase: number;
  grabbedAtBase: number;
  nightsAtBase: number;
  breaches: number;
  breachAtHome: number;
  siegeBeats: number;
  companionsEver: number;
  metEver: number;
  /** Turns between the stand opening and the run ending. Pre-T62 this is 0 by construction. */
  standAgencyTurns: number;
  standFrame: StandFrame | null;
  infectionStage: string;
  infectionBeats: string[];
  history: string[];
  standBeats: string[];
  /** The act the stand was spent on, and the menu it was chosen from. */
  actTaken: string | null;
  menuSize: number;
  menu: string[];
  shape: string | null;
  clauseIds: string[];
};

function play(seed: string, actions: number, policy: Policy, immortal = false, stands = true): Run {
  let { state, graph } = stands ? city(seed) : cityNoStands(seed);
  let rng = 37;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  const claimables = Object.values(graph.nodes).filter((n) => (n as { claimable?: boolean }).claimable === true).map((n) => n.id);
  const dist = hops(graph, state.player.location);
  const target = [...claimables].sort((a, b) => (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || a.localeCompare(b))[0];
  let everClaimed = false;
  let turnsAtBase = 0, combatAtBase = 0, grabbedAtBase = 0, nightsAtBase = 0;
  let breachAtHome = 0;
  let standAgencyTurns = 0;
  let standFrame: StandFrame | null = null;
  const companionsEverSeen = new Set<string>();

  const inStand = ENGINE["inLastStand"] as ((s: GameState) => boolean) | undefined;
  const isOpen = ENGINE["standIsOpen"] as ((s: GameState) => boolean) | undefined;
  const isComp = ENGINE["isCompanion"] as ((a: unknown) => boolean) | undefined;
  const burdenOf = ENGINE["woundBurden"] as ((c: unknown) => number) | undefined;
  const weaponFor = ENGINE["weaponFor"] as ((s: GameState) => { id: string }) | undefined;
  const hasGun = ENGINE["hasLoadedFirearm"] as ((p: unknown) => boolean) | undefined;

  for (let k = 0; k < actions; k += 1) {
    if (immortal) {
      state = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } } };
    }
    if (runEndReason(state) !== null) break;
    if (standFrame !== null) standAgencyTurns += 1;

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
      prefer("stand:") ?? prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("claim")
      ?? prefer("craft:recipe.shelter.")
      ?? (here === target && (state.nodes[here]?.searchPct ?? 0) < 100 ? prefer("search") : undefined)
      ?? stepper()
      ?? prefer("sleep")
      ?? prefer("search")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    // `brawler` fights everything and never disengages — the policy T82 used to find the upper end of
    // the Last Stand rate, and the one that gets this task enough stands to say anything about them.
    const brawlerPick = () =>
      prefer("stand:") ?? prefer("strike") ?? prefer("heavy") ?? prefer("fight") ?? prefer("break")
      ?? prefer("drink") ?? prefer("eat")
      ?? (() => { const m = choices.filter((c) => c.id.startsWith("move")); return m.length > 0 ? m[rand(m.length)] : undefined; })()
      ?? choices[rand(choices.length)]!;
    // `homebody` claims the nearest base and then STAYS IN IT — the policy that asks whether a night at
    // home can ever become a fight (PL-M5-69), rather than whether a wanderer happens to be home.
    const homebodyPick = () =>
      prefer("stand:") ?? prefer("break") ?? prefer("strike") ?? prefer("fight")
      ?? prefer("drink") ?? prefer("eat") ?? prefer("treat")
      ?? prefer("claim")
      ?? (state.player.shelterId !== null && here !== state.player.shelterId
        ? (() => {
          const back = hops(graph, state.player.shelterId!);
          const dh = back.get(here) ?? 99;
          let best: typeof choices[number] | undefined; let bestD = dh;
          for (const m of choices.filter((c) => c.id.startsWith("move:"))) {
            const d = back.get(m.id.slice("move:".length)) ?? 99;
            if (d < bestD) { bestD = d; best = m; }
          }
          return best;
        })()
        : undefined)
      ?? prefer("fortify")
      ?? prefer("craft:recipe.shelter.")
      ?? prefer("sleep")
      ?? (state.player.shelterId === null ? stepper() : undefined)
      ?? (state.player.shelterId === null ? prefer("search") : undefined)
      ?? prefer("rest")
      ?? choices[rand(choices.length)]!;
    const pick = policy === "settler" ? settlerPick()
      : policy === "brawler" ? brawlerPick()
      : policy === "homebody" ? homebodyPick()
      : (prefer("stand:") ?? prefer("break") ?? prefer("drink") ?? prefer("eat") ?? prefer("treat") ?? choices[rand(choices.length)]!);

    const before = state;
    const hBefore = state.history.length;
    state = applyAction(state, pick.action, graph).state;
    if (state === before) break;
    if (state.player.shelterId !== null) everClaimed = true;
    // Capture the frame the stand opens on. `standIsOpen` covers all four deaths; `inLastStand` is the
    // pre-T62 fallback so the same line runs in a tree that has no stands at all (there it is the frame
    // the run ENDED on, which is the honest comparison).
    const opening = isOpen !== undefined ? isOpen(state) : (inStand !== undefined && inStand(state));
    if (standFrame === null && opening) {
      const ch = availableActions(state, graph);
      standFrame = {
        day: state.meta.day,
        atBase: state.player.shelterId !== null && state.player.location === state.player.shelterId,
        everClaimed,
        enemyId: (state.combat as { enemyId?: string } | null)?.enemyId ?? "?",
        enemyHp: (state.combat as { hp?: number } | null)?.hp ?? 0,
        companions: Object.values(state.actors).filter((a) => (isComp ? isComp(a) : true)).length,
        metSurvivors: Object.values(state.npcs).filter((n) => n.met).length,
        wounds: state.player.condition.wounds.length,
        burden: burdenOf ? burdenOf(state.player.condition) : -1,
        weapon: weaponFor ? weaponFor(state).id : "?",
        loadedFirearm: hasGun ? hasGun(state.player) : false,
        items: (state.player.inventory as { type: string; quantity: number }[]).reduce((a, e) => a + e.quantity, 0),
        distinctItems: (state.player.inventory as { type: string; quantity: number }[]).filter((e) => e.quantity > 0).map((e) => e.type).sort(),
        nodeWalkers: state.nodes[state.player.location]?.walkers ?? 0,
        choicesOffered: ch.length,
        choiceIds: ch.map((c) => c.id),
      };
    }

    const sid = state.player.shelterId;
    if (sid !== null && state.player.location === sid) {
      turnsAtBase += 1;
      if (state.combat !== null) combatAtBase += 1;
      if (state.combat?.grabbed === true) grabbedAtBase += 1;
      const h = state.meta.hour;
      if (h >= 21 || h <= 2) nightsAtBase += 1;
    }
    // A breach that landed while the player was standing in the base they were losing.
    for (const e of state.history.slice(hBefore)) {
      if (e.type === "siege.breached" && before.player.location === before.player.shelterId) breachAtHome += 1;
    }
    for (const id of Object.keys(state.actors)) companionsEverSeen.add(id);
  }

  const closing = sceneOf(state, graph);
  const shapeOf = ENGINE["endingShape"] as ((s: GameState, g: RegionGraph) => string | null) | undefined;
  const assemble = ENGINE["assembleEnding"] as ((s: GameState, g: RegionGraph) => { clauseIds: string[] } | null) | undefined;
  const taken = ENGINE["standTaken"] as ((h: readonly { type: string; data: unknown }[]) => { act: string } | null) | undefined;
  const ending = runEndReason(state) !== null && assemble ? assemble(state, graph) : null;
  return {
    seed, policy,
    endDay: state.meta.day,
    turns: state.meta.turn,
    end: runEndReason(state),
    closing: closing.narration,
    closingChoices: closing.choices.length,
    everClaimed,
    atBase: state.player.shelterId !== null && state.player.location === state.player.shelterId,
    turnsAtBase, combatAtBase, grabbedAtBase, nightsAtBase,
    breaches: state.history.filter((h) => h.type === "siege.breached").length,
    breachAtHome,
    siegeBeats: state.history.filter((h) => h.type.startsWith("siege.")).length,
    companionsEver: companionsEverSeen.size,
    metEver: Object.values(state.npcs).filter((n) => n.met).length,
    standAgencyTurns: standFrame === null ? -1 : standAgencyTurns,
    standFrame,
    infectionStage: state.player.condition.infection.stage,
    infectionBeats: state.history.filter((h) => h.type.startsWith("infection.")).map((h) => h.type),
    history: state.history.map((h) => h.type),
    standBeats: state.history.filter((h) => h.type.startsWith("stand.")).map((h) => h.type),
    actTaken: taken ? (taken(state.history as unknown as { type: string; data: unknown }[])?.act ?? null) : null,
    menuSize: standFrame === null ? 0 : standFrame.choicesOffered,
    menu: standFrame === null ? [] : standFrame.choiceIds,
    shape: shapeOf ? shapeOf(state, graph) : null,
    clauseIds: ending === null ? [] : [...ending.clauseIds],
  };
}

const POLICIES: Policy[] = ["settler", "drifter", "brawler", "homebody"];
const runsFor = (p: Policy, n = RUNS, imm = false, stands = true): Run[] =>
  Array.from({ length: n }, (_, i) => play(`t62-${p}-${i}`, ACTIONS, p, imm, stands));

// --- 1. structure ----------------------------------------------------------------------------------

function structure(): void {
  console.log(`tree: ${TREE}\n`);
  console.log("FR-STY-07 names THREE authored failure endings. What exists mechanically?\n");
  const reasons = (ENGINE["RUN_END_REASONS"] as string[] | undefined) ?? [];
  console.log(`  RunEndReason values:            ${reasons.join(" | ")}`);
  console.log(`    ...that are DEATHS:           ${reasons.filter((r) => r !== "escaped" && r !== "held").join(" | ")}`);
  console.log(`    an OVERRUN reason?            ${reasons.includes("overrun") ? "YES" : "NO — a horde wounds you; it never ends the run"}`);
  console.log(`    a SHELTER-LOSS reason?        ${reasons.includes("breached") ? "YES" : "NO — a breach TAKES THE BASE, never the survivor"}`);
  console.log(`\n  Engine exports the scene machinery would need:`);
  for (const k of ["inLastStand", "LAST_STAND_AT", "standChoices", "resolveStand", "STAND_BEATS", "assembleEnding", "endingShape"]) {
    console.log(`    ${k.padEnd(18)} ${ENGINE[k] !== undefined ? "present" : "ABSENT"}`);
  }
  const stands = load<{ id: string }>("stands");
  console.log(`\n  content/stands/ files:          ${stands.length}`);
}

// --- 2. reach --------------------------------------------------------------------------------------

function reach(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy, ${ACTIONS} actions\n`);
  console.log("WHERE RUNS END — the reach of anything T62 authors\n");
  console.log("  policy      n  |  lastStand   infection    starved  dehydrated     escaped        held       alive |  mean day");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    const share = (r: string | null) => pct(rs.filter((x) => x.end === r).length / rs.length);
    console.log(`  ${p.padEnd(9)}${String(rs.length).padStart(3)}  | ${share("lastStand")} ${share("infection")} ${share("starved")} ${share("dehydrated")} ${share("escaped")} ${share("held")} ${share(null)} | ${f1(mean(rs.map((r) => r.endDay)))}`);
  }
}

// --- 3. the stand ----------------------------------------------------------------------------------

function stand(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("THE CLAIM (PL-M5-44): the Last Stand is an ENDING, not a STAND.\n");
  console.log("  A stand is a STAND only if the player gets at least one turn of agency after the");
  console.log("  condition is met. `availableActions` returns [] once `isRunOver`, so pre-T62 the answer");
  console.log("  is 0 by construction — this measures it rather than asserting it.\n");
  console.log("  policy      n  |  runs reaching a stand |  turns of agency in it | choices at the closing frame");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    const stands = rs.filter((r) => r.end === "lastStand");
    const withFrame = rs.filter((r) => r.standFrame !== null);
    console.log(`  ${p.padEnd(9)}${String(rs.length).padStart(3)}  | ${pct(stands.length / rs.length)} (${String(stands.length).padStart(2)})        | ${f2(mean(withFrame.map((r) => r.standAgencyTurns)))}                | ${f2(mean(stands.map((r) => r.closingChoices)))}`);
  }
  const all = POLICIES.flatMap((p) => runsFor(p));
  const st = all.filter((r) => r.end === "lastStand");
  console.log(`\n  Across all policies: ${st.length} of ${all.length} runs end in a Last Stand.`);
  console.log(`  Of those, runs offering ANY choice on the closing frame: ${st.filter((r) => r.closingChoices > 0).length}`);
  const beats = new Set(all.flatMap((r) => r.standBeats));
  console.log(`  stand.* history beats seen: ${beats.size === 0 ? "none" : [...beats].join(", ")}`);
}

// --- 4. what is in hand ----------------------------------------------------------------------------

function hands(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("WHAT THE PLAYER HAS TO SPEND when the stand opens.\n");
  console.log("  GDD IX names three spends by way of example — 'hold the door so a companion gets out,");
  console.log("  take as many with you as you can, say the thing you never said'. Two of the three name");
  console.log("  a PERSON. This is whether those people are there.\n");
  const all = POLICIES.flatMap((p) => runsFor(p));
  const frames = all.map((r) => r.standFrame).filter((f): f is StandFrame => f !== null);
  // Pre-T62 no frame is ever captured (the run is over before the loop top sees it), so fall back to
  // reconstructing the same facts from the FINAL state of runs that ended in a stand.
  const src = frames.length > 0 ? frames : null;
  if (src === null) {
    console.log("  No live stand frame in this tree (the run ends on the frame the condition is met).");
    console.log("  Reconstructing the same facts from the final state of runs that ended in a stand:\n");
    const st = all.filter((r) => r.end === "lastStand");
    console.log(`    runs ending in a stand:            ${st.length} of ${all.length}`);
    console.log(`    ...with a companion standing:      ${st.filter((r) => r.companionsEver > 0).length}   (${pct(st.filter((r) => r.companionsEver > 0).length / Math.max(1, st.length))})`);
    console.log(`    ...with ANY survivor ever met:     ${st.filter((r) => r.metEver > 0).length}   (${pct(st.filter((r) => r.metEver > 0).length / Math.max(1, st.length))})`);
    console.log(`    ...at a base they still held:      ${st.filter((r) => r.atBase).length}   (${pct(st.filter((r) => r.atBase).length / Math.max(1, st.length))})`);
    console.log(`    ...that had EVER claimed a base:   ${st.filter((r) => r.everClaimed).length}   (${pct(st.filter((r) => r.everClaimed).length / Math.max(1, st.length))})`);
    console.log(`    mean day of the stand:             ${f1(mean(st.map((r) => r.endDay)))}`);
    return;
  }
  const n = src.length;
  console.log(`  stand frames captured: ${n}\n`);
  console.log(`    companions at your side:           ${f2(mean(src.map((f) => f.companions)))}  · any: ${pct(src.filter((f) => f.companions > 0).length / n)}`);
  console.log(`    survivors ever MET:                ${f2(mean(src.map((f) => f.metSurvivors)))}  · any: ${pct(src.filter((f) => f.metSurvivors > 0).length / n)}`);
  console.log(`    at a base you still hold:          ${pct(src.filter((f) => f.atBase).length / n)}`);
  console.log(`    had ever claimed one:              ${pct(src.filter((f) => f.everClaimed).length / n)}`);
  console.log(`    carrying a loaded firearm:         ${pct(src.filter((f) => f.loadedFirearm).length / n)}`);
  console.log(`    holding a weapon (not bare):       ${pct(src.filter((f) => f.weapon !== "weapon.bare").length / n)}`);
  console.log(`    items in the pack:                 ${f2(mean(src.map((f) => f.items)))}  · any: ${pct(src.filter((f) => f.items > 0).length / n)}`);
  console.log(`    other dead standing on the node:   ${f2(mean(src.map((f) => f.nodeWalkers)))}`);
  for (const k of [1, 2, 3, 4]) {
    console.log(`      ...at least ${k}:                    ${pct(src.filter((f) => f.nodeWalkers >= k).length / n)}`);
  }
  for (const k of [1, 2, 3]) {
    console.log(`    items >= ${k}:                         ${pct(src.filter((f) => f.items >= k).length / n)}`);
  }
  console.log(`    burden >= 120 / 200 / 300:         ${pct(src.filter((f) => f.burden >= 120).length / n)} ${pct(src.filter((f) => f.burden >= 200).length / n)} ${pct(src.filter((f) => f.burden >= 300).length / n)}`);
  console.log(`    wounds carried / burden:           ${f2(mean(src.map((f) => f.wounds)))} / ${f1(mean(src.map((f) => f.burden)))}`);
  console.log(`    mean day:                          ${f1(mean(src.map((f) => f.day)))}`);
  const items = new Map<string, number>();
  for (const f of src) for (const i of f.distinctItems) items.set(i, (items.get(i) ?? 0) + 1);
  console.log(`\n    what is actually IN the pack (share of stands carrying at least one):`);
  for (const [i, c] of [...items].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${i.padEnd(24)} ${pct(c / n)}`);
  if (items.size === 0) console.log(`      (nothing)`);
}

// --- 5. sacrifice ----------------------------------------------------------------------------------

function sacrifice(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("PL-M5-69: can a Last Stand happen at your own door?\n");
  console.log("  policy      n  | turns at a held base | in COMBAT there | GRABBED there | ended AT base");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    console.log(`  ${p.padEnd(9)}${String(rs.length).padStart(3)}  | ${f1(mean(rs.map((r) => r.turnsAtBase)))} (${pct(rs.filter((r) => r.turnsAtBase > 0).length / rs.length)}) | ${f2(mean(rs.map((r) => r.combatAtBase)))} (${pct(rs.filter((r) => r.combatAtBase > 0).length / rs.length)}) | ${f2(mean(rs.map((r) => r.grabbedAtBase)))}        | ${pct(rs.filter((r) => r.atBase).length / rs.length)}`);
  }
}

// --- 6. siege --------------------------------------------------------------------------------------

function siege(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("THE BREACH — GDD XIII's 'a shelter overrun' failure ending. Is the player ever THERE?\n");
  console.log("  policy      n  | claimed | nights AT base | siege beats | breaches | breached WHILE HOME");
  for (const p of POLICIES) {
    const rs = runsFor(p);
    console.log(`  ${p.padEnd(9)}${String(rs.length).padStart(3)}  | ${pct(rs.filter((r) => r.everClaimed).length / rs.length)} | ${f1(mean(rs.map((r) => r.nightsAtBase)))} (${pct(rs.filter((r) => r.nightsAtBase > 0).length / rs.length)}) | ${f2(mean(rs.map((r) => r.siegeBeats)))}      | ${f2(mean(rs.map((r) => r.breaches)))}   | ${f2(mean(rs.map((r) => r.breachAtHome)))} (${pct(rs.filter((r) => r.breachAtHome > 0).length / rs.length)})`);
  }
}

// --- 7. infection ----------------------------------------------------------------------------------

function infection(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("PL-M4-20: the succumb path, and what the log holds to close it with.\n");
  console.log("  policy      n  | ends by infection | ends feverish | infection beats per run");
  const kinds = new Map<string, number>();
  for (const p of POLICIES) {
    const rs = runsFor(p);
    for (const r of rs) for (const b of r.infectionBeats) kinds.set(b, (kinds.get(b) ?? 0) + 1);
    console.log(`  ${p.padEnd(9)}${String(rs.length).padStart(3)}  | ${pct(rs.filter((r) => r.end === "infection").length / rs.length)}           | ${pct(rs.filter((r) => r.infectionStage !== "none").length / rs.length)}       | ${f2(mean(rs.map((r) => r.infectionBeats.length)))}`);
  }
  console.log(`\n  infection.* beat types seen across all runs:`);
  for (const [k, c] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(28)} ${String(c).padStart(4)}`);
  if (kinds.size === 0) console.log(`    (none)`);
}

// --- 8. identity -----------------------------------------------------------------------------------

/** FNV-1a over the whole transcript — narration, choice ids and the save blob, every turn. */
function digest(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i += 1) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}

function identity(withEndings = false): void {
  console.log(`tree: ${TREE} · byte-identity with NO stand pool registered${withEndings ? ", ENDINGS ON" : ""}\n`);
  const saveGame = ENGINE["saveGame"] as ((s: GameState) => unknown) | undefined;
  const lines: string[] = [];
  for (const seed of ["id-a", "id-b", "id-c", "id-d", "id-e", "id-f"]) {
    let { state, graph } = withEndings ? cityNoStands(seed) : cityBare(seed);
    let rng = 11;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    for (let k = 0; k < 400; k += 1) {
      if (runEndReason(state) !== null) break;
      const sc = sceneOf(state, graph);
      lines.push(`${seed}|${k}|${sc.narration}|${sc.choices.map((c) => c.id).join(",")}`);
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const pick = choices[rand(choices.length)]!;
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
    }
    const sc = sceneOf(state, graph);
    lines.push(`${seed}|END|${sc.narration}|${sc.choices.map((c) => c.id).join(",")}`);
    if (saveGame) lines.push(`${seed}|SAVE|${JSON.stringify(saveGame(state))}`);
  }
  const blob = lines.join("\n");
  console.log(`  lines:  ${lines.length}`);
  console.log(`  chars:  ${blob.length}`);
  console.log(`  digest: ${digest(blob)}`);
}

// --- 9. acts --------------------------------------------------------------------------------------

function acts(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("WHAT THE STAND ACTUALLY DID — the after-table.\n");
  const all = POLICIES.flatMap((p) => runsFor(p));
  const died = all.filter((r) => r.end !== null && r.end !== "escaped" && r.end !== "held");
  const withStand = all.filter((r) => r.actTaken !== null);
  console.log(`  deaths:                             ${died.length} of ${all.length} runs`);
  console.log(`  ...that got a final set of choices: ${withStand.length}   (${pct(withStand.length / Math.max(1, died.length))})`);
  console.log(`  mean acts offered (incl. the floor):${f2(mean(withStand.map((r) => r.menuSize)))}`);
  console.log(`  distinct menus seen:                ${new Set(withStand.map((r) => r.menu.join("|"))).size}`);

  const byAct = new Map<string, number>();
  for (const r of withStand) byAct.set(r.actTaken!, (byAct.get(r.actTaken!) ?? 0) + 1);
  console.log(`\n  acts TAKEN (a bot picks uniformly from the menu, so this reads OFFER RATE):`);
  for (const [a, c] of [...byAct].sort((x, y) => y[1] - x[1])) console.log(`    ${a.padEnd(24)} ${String(c).padStart(3)}  ${pct(c / withStand.length)}`);

  const offered = new Map<string, number>();
  for (const r of withStand) for (const id of r.menu) offered.set(id, (offered.get(id) ?? 0) + 1);
  console.log(`\n  acts OFFERED (share of stands the act appeared on):`);
  for (const [a, c] of [...offered].sort((x, y) => y[1] - x[1])) console.log(`    ${a.padEnd(24)} ${String(c).padStart(3)}  ${pct(c / withStand.length)}`);

  console.log(`\n  ENDING SHAPES over all finished runs:`);
  const byShape = new Map<string, number>();
  for (const r of all.filter((x) => x.end !== null)) byShape.set(String(r.shape), (byShape.get(String(r.shape)) ?? 0) + 1);
  for (const [sh, c] of [...byShape].sort((x, y) => y[1] - x[1])) console.log(`    ${sh.padEnd(24)} ${String(c).padStart(3)}  ${pct(c / all.length)}`);

  const texts = new Set(all.filter((r) => r.end !== null).map((r) => r.closing));
  console.log(`\n  DISTINCT CLOSING TEXTS:              ${texts.size} from ${all.filter((r) => r.end !== null).length} finished runs`);
  const stands = all.filter((r) => r.end === "lastStand");
  console.log(`  distinct texts among Last Stands:   ${new Set(stands.map((r) => r.closing)).size} from ${stands.length}`);
  const fired = new Set(all.flatMap((r) => r.clauseIds));
  console.log(`  distinct ending clauses that fired: ${fired.size}`);
}

// --- 10. distinct ------------------------------------------------------------------------------------

function distinct(): void {
  console.log(`tree: ${TREE} · ${RUNS} runs a policy\n`);
  console.log("HOW MANY DIFFERENT WAYS A RUN CAN CLOSE — the same seeds, with and without a stand pool.");
  console.log("Both columns have T61's ending pool registered, so this is T62's contribution alone.\n");
  console.log("  policy       finished |  distinct texts WITHOUT stands | WITH stands | distinct shapes");
  for (const p of POLICIES) {
    const before = runsFor(p, RUNS, false, false).filter((r) => r.end !== null);
    const after = runsFor(p, RUNS, false, true).filter((r) => r.end !== null);
    const bt = new Set(before.map((r) => r.closing)).size;
    const at = new Set(after.map((r) => r.closing)).size;
    const sh = new Set(after.map((r) => String(r.shape))).size;
    console.log(`  ${p.padEnd(9)} ${String(after.length).padStart(8)} |  ${String(bt).padStart(27)} | ${String(at).padStart(11)} | ${String(sh).padStart(15)}`);
  }
  const b = POLICIES.flatMap((p) => runsFor(p, RUNS, false, false)).filter((r) => r.end !== null);
  const a = POLICIES.flatMap((p) => runsFor(p, RUNS, false, true)).filter((r) => r.end !== null);
  console.log(`\n  ALL POLICIES: ${new Set(b.map((r) => r.closing)).size} distinct texts without stands -> ${new Set(a.map((r) => r.closing)).size} with, over ${a.length} finished runs.`);
  const bs = b.filter((r) => r.end === "lastStand");
  const as_ = a.filter((r) => r.end === "lastStand");
  console.log(`  LAST STANDS:  ${new Set(bs.map((r) => r.closing)).size} -> ${new Set(as_.map((r) => r.closing)).size}, over ${as_.length} of them.`);
  const shb = new Map<string, number>(); const sha = new Map<string, number>();
  for (const r of b) shb.set(String(r.shape), (shb.get(String(r.shape)) ?? 0) + 1);
  for (const r of a) sha.set(String(r.shape), (sha.get(String(r.shape)) ?? 0) + 1);
  console.log(`\n  SHAPES          without stands    with stands`);
  for (const sh of ["escape", "entrenchment", "sacrifice", "fade"]) {
    console.log(`    ${sh.padEnd(14)} ${pct((shb.get(sh) ?? 0) / b.length)}        ${pct((sha.get(sh) ?? 0) / a.length)}`);
  }
}

const mode = process.argv[2] ?? "";
if (mode === "--reach") reach();
else if (mode === "--acts") acts();
else if (mode === "--distinct") distinct();
else if (mode === "--stand") stand();
else if (mode === "--hands") hands();
else if (mode === "--sacrifice") sacrifice();
else if (mode === "--siege") siege();
else if (mode === "--infection") infection();
else if (mode === "--identity") identity();
else if (mode === "--identity-endings") identity(true);
else structure();
