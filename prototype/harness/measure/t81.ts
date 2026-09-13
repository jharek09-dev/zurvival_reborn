/**
 * T81 measurement runner — the weapon-roster numbers quoted in `combat/weapons.ts`, `sim/loot.ts`
 * and `docs/qa/QA_REVIEW_T81.md`, re-derivable on demand (the T77–T80 discipline: a task's
 * before/after figures are worthless if the thing that produced them was a scratch script). It
 * asserts nothing and CI does not run it.
 *
 *   npx tsx measure/t81.ts              # the roster: every profile, whether it is REACHABLE, and the dominance check
 *   npx tsx measure/t81.ts --duel       # every equippable melee profile x every enemy, fought to the end
 *   npx tsx measure/t81.ts --loot       # search sampling on the SHIPPED city: P(weapon) per node kind
 *   npx tsx measure/t81.ts --play       # a scavenging bot on the shipped city: does a weapon ever reach a hand?
 *   npx tsx measure/t81.ts --legendary  # every police node searched clean: will a run ever hold the axe?
 *
 * **It runs against the pre-T81 tree unchanged.** Everything T81 adds is looked up off the engine
 * namespace with a fallback, and a row that does not exist there is simply absent from the table —
 * so the "before" run prints the same columns and the two outputs line up. That is what makes the
 * before/after comparison a measurement rather than a memory.
 *
 * A duel is resolved through `resolveCombatAction` directly (the `measure/t80.ts` rule): the question
 * is what one exchange costs, and routing it through the whole pipeline would mix the world's drift,
 * needs and events into the answer. `--loot` and `--play` go through the real pipeline, because there
 * the question is exactly whether the content is reachable by playing.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENEMIES,
  STRIKE_COST,
  WEAPON_SLOT,
  STORY_ARCS,
  applyAction,
  availableActions,
  resolveCombatAction,
  startRun,
  withRoster,
  lootTableFor,
  ITEM_WEIGHTS,
  type ContentId,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";
import * as engine from "../../engine/src/index.js";

const ENGINE = engine as unknown as Record<string, unknown>;

interface Profile {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly category?: string;
  readonly dmgMin: number;
  readonly dmgMax: number;
  readonly noise: number;
  readonly armorPierce: number;
  readonly durabilityCost: number;
  readonly retaliateModifier: number;
  readonly accuracy: number;
  readonly startDurability?: number | null;
  readonly lootWeight?: number;
  readonly lootKinds?: readonly string[];
}

const WEAPONS = (ENGINE["WEAPONS"] ?? {}) as Record<string, Profile>;
const HEAVY_COST = (ENGINE["HEAVY_COST"] as number | undefined) ?? STRIKE_COST;
/** T81 ships `category`; the pre-T81 table has none, which is how the runner tells the trees apart. */
const HAS_CATEGORIES = Object.values(WEAPONS).some((w) => w.category !== undefined);

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

/** A shipped-city run. The weapon pool is passed only when the tree has one (pre-T81 `startRun` takes 10 args). */
function city(seed: string): { state: GameState; graph: RegionGraph } {
  const args = [
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
  ] as unknown[];
  if (HAS_CATEGORIES) args.push(load("weapons"));
  return (startRun as unknown as (...a: unknown[]) => { state: GameState; graph: RegionGraph })(...args);
}

// --- 1. the roster ------------------------------------------------------------------------------

const MELEE_KINDS = ["generic", "store", "medical", "police", "residential", "industrial"] as const;

/**
 * Every item id any shipped loot table can emit, with radio + economy + (if present) weapons active.
 * Post-T81 the weighted builder is the real table, so ask that when the tree has one.
 */
function lootableItems(): Set<string> {
  const entriesFor = ENGINE["lootEntriesFor"] as ((k: string, r: boolean, e: boolean) => readonly { value: string; weight: number }[]) | undefined;
  const out = new Set<string>();
  for (const k of MELEE_KINDS) {
    if (entriesFor !== undefined) for (const e of entriesFor(k, true, true)) { if (e.weight > 0) out.add(e.value); }
    else for (const id of lootTableFor(k, true, true)) out.add(id);
  }
  return out;
}

/** Item ids a shipped recipe can mint. */
function craftableItems(): Set<string> {
  const out = new Set<string>();
  for (const r of load<{ output?: { item: string } }>("recipes")) if (r.output !== undefined) out.add(r.output.item);
  return out;
}

function roster(): void {
  const lootable = lootableItems();
  const craftable = craftableItems();
  console.log(`tree: ${HAS_CATEGORIES ? "POST-T81 (categories present)" : "PRE-T81 (no weapon content set)"}`);
  console.log(`WEAPONS rows: ${Object.keys(WEAPONS).length}\n`);
  console.log(
    `  ${"id".padEnd(24)}${"category".padEnd(12)}${"dmg".padEnd(7)}${"noise".padStart(6)}${"pierce".padStart(7)}${"wear".padStart(6)}${"retal".padStart(7)}${"dur".padStart(5)}${"wt".padStart(4)}${"  reachable"}`,
  );
  for (const w of Object.values(WEAPONS)) {
    const how =
      w.id === "weapon.bare" ? "always (empty hands)"
      : lootable.has(w.id) ? "LOOT"
      : craftable.has(w.id) ? "craft"
      : "NO — authored only";
    const wt = (ITEM_WEIGHTS as Record<string, number>)[w.id];
    console.log(
      `  ${w.id.padEnd(24)}${(w.category ?? w.kind).padEnd(12)}${`${w.dmgMin}-${w.dmgMax}`.padEnd(7)}${String(w.noise).padStart(6)}${String(w.armorPierce).padStart(7)}${String(w.durabilityCost).padStart(6)}${String(w.retaliateModifier).padStart(7)}${String(w.startDurability ?? "-").padStart(5)}${String(wt ?? "-").padStart(4)}  ${how}`,
    );
  }

  const melee = Object.values(WEAPONS).filter((w) => w.kind === "melee");
  console.log(`\nmelee profiles: ${melee.length} · reachable by play: ${melee.filter((w) => lootable.has(w.id) || craftable.has(w.id) || w.id === "weapon.bare").length}`);

  // The anti-power-tier check. A row DOMINATES another when it is at least as good on every axis the
  // player pays on (damage, noise, wear, retaliation, carry weight) and strictly better on one. The
  // GDD forbids power tiers — "weapons are tools with trade-offs, not power tiers" — so a dominated
  // row is a design defect, not a rarity.
  const axes = (w: Profile): number[] => [
    w.dmgMin + w.dmgMax, -w.noise, -w.durabilityCost, -w.retaliateModifier, w.armorPierce,
    // bare hands never break, which is a real advantage and has to count as one
    w.startDurability === null || w.startDurability === undefined ? Number.POSITIVE_INFINITY : w.startDurability,
    -((ITEM_WEIGHTS as Record<string, number>)[w.id] ?? 2),
  ];
  const dominated: string[] = [];
  for (const a of melee) {
    for (const b of melee) {
      if (a.id === b.id) continue;
      const xa = axes(a), xb = axes(b);
      if (xa.every((v, i) => v >= xb[i]!) && xa.some((v, i) => v > xb[i]!)) dominated.push(`${b.id} is strictly dominated by ${a.id}`);
    }
  }
  console.log(`dominance check: ${dominated.length === 0 ? "CLEAN — no melee row is strictly better than another" : `${dominated.length} DOMINATED ROWS`}`);
  for (const d of dominated) console.log(`  ! ${d}`);
}

// --- 2. duels -----------------------------------------------------------------------------------

const REGIONS: RegionDef[] = [{ id: "region.d", name: "Duel", description: "a fixture" }];
const NODES: NodeDef[] = [
  { id: "node.d.a", regionId: "region.d", name: "A", description: "here", adjacent: ["node.d.b"], start: true, walkers: 1 },
  { id: "node.d.b", regionId: "region.d", name: "B", description: "there", adjacent: ["node.d.a"] },
];
const ZOMBIE_FOR_ENEMY: Record<string, ContentId> = {
  "enemy.walker": "zombie.walker", "enemy.fresh": "zombie.fresh", "enemy.crawler": "zombie.crawler",
  "enemy.bloated": "zombie.bloated", "enemy.riot": "zombie.riot",
};

function duelState(seed: string, enemy: ContentId, weapon: string | null): { state: GameState; graph: RegionGraph } {
  const { state, graph } = startRun({ seed, createdAt: "2026-09-13T00:00:00.000Z" }, REGIONS, NODES);
  const here = state.nodes["node.d.a"]!;
  const nodes = { ...state.nodes, "node.d.a": withRoster(here, [ZOMBIE_FOR_ENEMY[enemy] ?? "zombie.walker"]) };
  let next: GameState = { ...state, nodes };
  if (weapon !== null) {
    const id = `${weapon}#fixture`;
    const dur = WEAPONS[weapon]?.startDurability;
    next = {
      ...next,
      items: { ...next.items, [id]: { type: weapon, quality: 100, durability: dur === undefined ? 100 : dur, metadata: {} } },
      player: {
        ...next.player,
        inventory: [...next.player.inventory, { type: weapon, quantity: 1, itemId: id }],
        equipment: { ...next.player.equipment, [WEAPON_SLOT]: id },
      },
    };
  }
  return { state: next, graph };
}

interface Result { hours: number; wounds: number; bites: number; noise: number; wear: number; won: boolean }

function duel(seed: string, enemy: ContentId, weapon: string | null, heavy: boolean): Result {
  const { state: start, graph } = duelState(seed, enemy, weapon);
  let state = start;
  let hours = 0;
  const verb = heavy ? "heavy" : "strike";
  for (let n = 0; n < 60; n += 1) {
    if (state.combat === null && (state.nodes["node.d.a"]?.walkers ?? 0) === 0) break;
    const v = state.combat === null && !heavy ? "fight" : verb;
    const cost = heavy ? HEAVY_COST : STRIKE_COST;
    const before = state;
    state = resolveCombatAction(state, graph, { type: v, choiceId: v, timeCost: cost, params: {} });
    hours += cost;
    if (state === before) break;
  }
  const durOf = (s: GameState): number => {
    const id = s.player.equipment[WEAPON_SLOT];
    return id === undefined ? 0 : (s.items[id]?.durability ?? 0);
  };
  return {
    hours,
    wounds: state.player.condition.wounds.length - start.player.condition.wounds.length,
    bites: state.player.condition.wounds.filter((w) => w.type === "wound.bite").length,
    // `resolveCombatAction` does not deposit noise — the pipeline does, from the action's `noise` param
    // — so the fixture node's own counter never moves here. The honest figure is therefore derived:
    // blows x the profile's per-blow deposit, which is exactly what the pipeline would have banked.
    noise: (hours / STRIKE_COST) * (WEAPONS[weapon ?? "weapon.bare"]?.noise ?? 0),
    wear: durOf(start) - durOf(state),
    won: (state.nodes["node.d.a"]?.walkers ?? 0) === 0,
  };
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`.padStart(7);
const f2 = (n: number): string => n.toFixed(2).padStart(6);
const RUNS = Number(process.env["T81_RUNS"] ?? 3000);

function duels(): void {
  const melee = Object.values(WEAPONS).filter((w) => w.kind === "melee");
  console.log(`${RUNS} duels per cell · strike only, fought to the end\n`);
  console.log(`  ${"weapon".padEnd(24)}${"enemy".padEnd(10)}${"E[h]".padStart(6)}${"P(hurt)".padStart(8)}${"P(bite)".padStart(8)}${"E[noise]".padStart(9)}${"wear".padStart(7)}${"P(win)".padStart(8)}`);
  for (const w of melee) {
    for (const e of Object.keys(ENEMIES)) {
      const weapon = w.id === "weapon.bare" ? null : w.id;
      const rs: Result[] = [];
      for (let i = 0; i < RUNS; i += 1) rs.push(duel(`t81-${w.id}-${e}-${i}`, e, weapon, false));
      console.log(
        `  ${w.id.padEnd(24)}${e.replace("enemy.", "").padEnd(10)}${f2(mean(rs.map((r) => r.hours)))}${pct(mean(rs.map((r) => (r.wounds > 0 ? 1 : 0))))}${pct(mean(rs.map((r) => (r.bites > 0 ? 1 : 0))))}${f2(mean(rs.map((r) => r.noise)))} ${f2(mean(rs.map((r) => r.wear)))}${pct(mean(rs.map((r) => (r.won ? 1 : 0))))}`,
      );
    }
    console.log("");
  }
}

// --- 3. loot ------------------------------------------------------------------------------------

const isWeaponItem = (id: string): boolean => {
  const w = WEAPONS[id];
  return w !== undefined && w.kind === "melee" && w.id !== "weapon.bare";
};

/**
 * Search the same node over and over on the SHIPPED city, counting what comes out. The node is
 * re-seeded every sample (searchPct and the region stock reset) so this measures the TABLE, not the
 * depletion curve; the depletion curve is `--play`'s question.
 */
function lootSample(): void {
  const kinds = load<{ id: string; kind?: string }>("nodes");
  console.log(`${RUNS} searches sampled per node kind on the shipped city\n`);
  console.log(`  ${"kind".padEnd(13)}${"node".padEnd(34)}${"P(weapon)".padStart(10)}  what came out`);
  for (const kind of MELEE_KINDS) {
    const node = kinds.find((n) => (n.kind ?? "generic") === kind);
    if (node === undefined) continue;
    const counts: Record<string, number> = {};
    let weapons = 0;
    const { state: base, graph } = city(`t81-loot-${kind}`);
    for (let i = 0; i < RUNS; i += 1) {
      // A fresh, un-searched node with a full region behind it, walked to directly.
      const here = base.nodes[node.id]!;
      const region = base.regions[here.regionId]!;
      const seeded: GameState = {
        ...base,
        meta: { ...base.meta, seed: `t81-loot-${kind}-${i}` },
        nodes: { ...base.nodes, [node.id]: { ...here, searchPct: 0, walkers: 0, roster: [], zombieTypes: [], discovered: true } },
        regions: { ...base.regions, [here.regionId]: { ...region, loot: 80 } },
        player: { ...base.player, location: node.id, inventory: [] },
      };
      const choices = availableActions(seeded, graph);
      const search = choices.find((c) => c.id === "search");
      if (search === undefined) continue;
      const after = applyAction(seeded, search.action, graph).state;
      for (const e of after.player.inventory) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (isWeaponItem(e.type)) weapons += 1;
      }
    }
    const found = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace("item.", "")} ${((v / RUNS) * 100).toFixed(1)}%`);
    console.log(`  ${kind.padEnd(13)}${node.id.replace("node.", "").padEnd(34)}${pct(weapons / RUNS)}  ${found.join(" · ")}`);
  }
}

// --- 4. does it reach a hand? -------------------------------------------------------------------

/**
 * A scavenger bot: search where you stand, otherwise walk to a discovered neighbour, fight what
 * corners you, eat/drink when offered. Deliberately loot-hungry — it is answering "can a player who
 * is TRYING to find a weapon find one", which is the generous end of the reachability question.
 */
function play(seed: string, actions: number): { day: number; firstWeaponDay: number | null; firstWeapon: string | null; firstWeaponSearch: number | null; sawAxe: boolean; searches: number; combats: number; armedCombats: number } {
  let { state, graph } = city(seed);
  let searches = 0, combats = 0, armedCombats = 0;
  let firstWeaponDay: number | null = null, firstWeapon: string | null = null, firstWeaponSearch: number | null = null;
  let sawAxe = false;
  let rng = 1;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  for (let i = 0; i < actions; i += 1) {
    const choices = availableActions(state, graph);
    if (choices.length === 0) break;
    if (state.combat !== null) {
      combats += 1;
      const held = state.player.equipment[WEAPON_SLOT];
      if (held !== undefined && state.items[held]?.durability !== 0) armedCombats += 1;
    }
    const prefer = (pre: string): (typeof choices)[number] | undefined => choices.find((c) => c.id.startsWith(pre));
    // NB: `equip` is deliberately NOT in this preference list. It is a free verb, so a bot that always
    // took it would ping-pong between two carried weapons forever and burn the action budget — which is
    // exactly the artifact that made an early cut of this probe report "more weapons ⇒ shorter runs".
    // Arming is covered without it: a found weapon is taken up on the spot when the hands are empty.
    const pick =
      prefer("strike") ?? prefer("fight") ?? prefer("run") ?? prefer("hold")
      ?? prefer("eat") ?? prefer("drink") ?? prefer("treat") ?? prefer("search")
      ?? choices.filter((c) => c.id.startsWith("move"))[rand(Math.max(1, choices.filter((c) => c.id.startsWith("move")).length))]
      ?? choices[rand(choices.length)]!;
    if (pick.id === "search") searches += 1;
    state = applyAction(state, pick.action, graph).state;
    if (state.player.inventory.some((e) => e.type === "item.axe-fire")) sawAxe = true;
    if (firstWeaponDay === null) {
      const w = state.player.inventory.find((e) => isWeaponItem(e.type));
      if (w !== undefined) { firstWeaponDay = state.meta.day; firstWeapon = w.type; firstWeaponSearch = searches; }
    }
  }
  return { day: state.meta.day, firstWeaponDay, firstWeapon, firstWeaponSearch, sawAxe, searches, combats, armedCombats };
}

function playProbe(): void {
  const RUNSN = Number(process.env["T81_PLAY_RUNS"] ?? 30);
  const ACTIONS = Number(process.env["T81_PLAY_ACTIONS"] ?? 300);
  console.log(`${RUNSN} scavenging runs x ${ACTIONS} actions on the shipped city\n`);
  const rows = [];
  for (let i = 0; i < RUNSN; i += 1) rows.push(play(`t81-play-${i}`, ACTIONS));
  const armedRuns = rows.filter((r) => r.firstWeaponDay !== null);
  console.log(`  runs that ever held a melee weapon : ${armedRuns.length}/${RUNSN} (${((armedRuns.length / RUNSN) * 100).toFixed(0)}%)`);
  console.log(`  mean day of the first weapon       : ${armedRuns.length === 0 ? "—" : mean(armedRuns.map((r) => r.firstWeaponDay!)).toFixed(2)}`);
  console.log(`  mean SEARCHES to the first weapon  : ${armedRuns.length === 0 ? "—" : mean(armedRuns.map((r) => r.firstWeaponSearch!)).toFixed(1)}`);
  console.log(`  mean searches per run              : ${mean(rows.map((r) => r.searches)).toFixed(1)}`);
  console.log(`  runs that ever saw the AXE         : ${rows.filter((r) => r.sawAxe).length}/${RUNSN}`);
  console.log(`  mean run length (days)             : ${mean(rows.map((r) => r.day)).toFixed(2)}`);
  const c = rows.reduce((a, r) => a + r.combats, 0), ac = rows.reduce((a, r) => a + r.armedCombats, 0);
  console.log(`  combat turns fought ARMED          : ${ac}/${c} (${c === 0 ? "—" : `${((ac / c) * 100).toFixed(1)}%`})`);
  const firsts: Record<string, number> = {};
  for (const r of armedRuns) firsts[r.firstWeapon!] = (firsts[r.firstWeapon!] ?? 0) + 1;
  console.log(`  first weapon found                 : ${Object.entries(firsts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace("item.", "")} x${v}`).join(" · ") || "—"}`);
}

/**
 * The legendary question, asked properly: the scavenging bot dies around day 4 with ten searches in it,
 * which cannot answer "will a player who works the whole city ever hold the firefighter's axe". So walk
 * a run through EVERY police node and search each one clean, which is the most police searches a run can
 * physically take (the node's `searchPct` caps it), and count.
 */
function legendaryProbe(): void {
  const RUNSN = Number(process.env["T81_LEG_RUNS"] ?? 200);
  const nodes = load<{ id: string; kind?: string }>("nodes").filter((n) => (n.kind ?? "generic") === "police");
  let sweeps = 0, axes = 0, searches = 0;
  const found: Record<string, number> = {};
  for (let i = 0; i < RUNSN; i += 1) {
    const { state: base, graph } = city(`t81-leg-${i}`);
    let state: GameState = { ...base, player: { ...base.player, inventory: [] } };
    let sawAxe = false;
    for (const n of nodes) {
      let taken = 0;
      for (let k = 0; k < 40 && taken < 12; k += 1) {
        // Re-clear the node and top the needs up before every search: repopulation walks bodies back in
        // (T75) and four days of searching would otherwise end the run of thirst. This probe is asking
        // what the TABLE yields over a full police sweep, not whether a player survives taking one.
        const here = state.nodes[n.id]!;
        state = {
          ...state,
          nodes: { ...state.nodes, [n.id]: { ...here, walkers: 0, roster: [], zombieTypes: [], discovered: true } },
          player: { ...state.player, location: n.id, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } },
        };
        const choices = availableActions(state, graph);
        if (choices.length === 0) break;
        const search = choices.find((c) => c.id === "search");
        if (search === undefined) {
          // An engaged encounter (or anything else) owns the turn — resolve it and come back. A node with
          // no search left at all is picked clean, which the `taken` counter distinguishes.
          if (choices.some((c) => c.id.startsWith("move") || c.id === "rest") && state.nodes[n.id]!.searchPct >= 100) break;
          state = applyAction(state, choices[0]!.action, graph).state;
          continue;
        }
        const before = state.player.inventory.length;
        state = applyAction(state, search.action, graph).state;
        searches += 1;
        taken += 1;
        if (state.player.inventory.length > before) {
          const got = state.player.inventory[state.player.inventory.length - 1]!.type;
          found[got] = (found[got] ?? 0) + 1;
          if (got === "item.axe-fire") sawAxe = true;
        }
        // keep the pack from filling and stopping the sweep
        state = { ...state, player: { ...state.player, inventory: state.player.inventory.filter((e) => e.type === "item.axe-fire") } };
      }
    }
    sweeps += 1;
    if (sawAxe) axes += 1;
  }
  console.log(`${sweeps} runs, each searching every police node in the city clean\n`);
  console.log(`  police searches available per run : ${(searches / sweeps).toFixed(1)}`);
  console.log(`  runs that found the AXE           : ${axes}/${sweeps} (${((axes / sweeps) * 100).toFixed(1)}%)`);
  console.log(`  what a police sweep yields        : ${Object.entries(found).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace("item.", "")} ${((v / searches) * 100).toFixed(1)}%`).join(" · ")}`);
}

// --- main ---------------------------------------------------------------------------------------

const arg = process.argv[2] ?? "";
if (arg === "--duel") duels();
else if (arg === "--loot") lootSample();
else if (arg === "--play") playProbe();
else if (arg === "--legendary") legendaryProbe();
else roster();
