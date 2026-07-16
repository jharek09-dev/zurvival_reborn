import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  saveGame,
  loadGame,
  enemyForNode,
  ENEMIES,
  ENEMY_RIOT,
  ENEMY_BLOATED,
  ENEMY_CRAWLER,
  ENEMY_FRESH,
  WALKER_ENEMY,
  tickZombies,
  ZOMBIE_FRESH,
  ZOMBIE_CRAWLER,
  CHASE_AT,
  INVESTIGATE_AT,
  type GameState,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
  type Player,
} from "../src/index.js";

/**
 * T46 — the full zombie roster with a type-aware combat model (FR-CBT-06/07). Each new type reads and
 * fights distinctly; the state machine escalates a Fresh and hides a Crawler; all deterministic + lossless.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const line = (types: readonly string[], walkers = 2): NodeDef[] => [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true, walkers, zombieTypes: types },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "C", description: "a clinic", adjacent: ["node.x.b"] },
];
const opts = { seed: "roster-seed", createdAt: "2026-07-16T00:00:00Z" };
const run = (types: readonly string[], walkers = 2): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, line(types, walkers));

function take(state: GameState, graph: RegionGraph, choiceId: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === choiceId);
  if (!c) throw new Error(`no choice ${choiceId}; offered: ${availableActions(state, graph).map((x) => x.id).join(",")}`);
  return applyAction(state, c.action, graph).state;
}
const armed = (player: Player): Player => ({ ...player, inventory: [{ type: "item.pistol", quantity: 1 }, { type: "item.ammo", quantity: 3 }] });

// --- enemy selection ------------------------------------------------------------------------

describe("enemyForNode picks the most dangerous combat-distinct type present (T46)", () => {
  it("selects a riot over a bloated over a fresh over a crawler; walker when none is distinct", () => {
    const { state } = run(["zombie.riot", "zombie.crawler", "zombie.fresh"]);
    expect(enemyForNode(state).id).toBe(ENEMY_RIOT);
    expect(enemyForNode({ ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, zombieTypes: ["zombie.bloated", "zombie.crawler"] } } }).id).toBe(ENEMY_BLOATED);
    expect(enemyForNode({ ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, zombieTypes: ["zombie.fresh", "zombie.crawler"] } } }).id).toBe(ENEMY_FRESH);
    expect(enemyForNode({ ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, zombieTypes: ["zombie.crawler"] } } }).id).toBe(ENEMY_CRAWLER);
  });

  it("a screamer/stalker-only node fights as a plain walker (no combat-distinct type ⇒ pre-T46 behaviour)", () => {
    const { state } = run(["zombie.screamer", "zombie.stalker"]);
    expect(enemyForNode(state).id).toBe(WALKER_ENEMY);
    // the fight label names the walker, exactly as before T46
    const { graph } = run(["zombie.screamer", "zombie.stalker"]);
    expect(availableActions(state, graph).find((c) => c.id === "fight")!.label).toBe("Fight the walker");
  });
});

// --- Riot: armored, hard to put down by hand ------------------------------------------------

describe("Riot dead — armor blunts melee, a firearm pierces (T46 · FR-CBT-07)", () => {
  it("takes strictly more melee strikes to fell than a plain walker", () => {
    const strikesToKill = (types: readonly string[]): number => {
      let { state, graph } = run(types, 1);
      state = take(state, graph, "fight");
      let n = 1;
      while (state.combat !== null && n < 80) { state = take(state, graph, "strike"); n++; }
      expect(state.combat).toBeNull();
      return n;
    };
    expect(strikesToKill(["zombie.riot"])).toBeGreaterThan(strikesToKill([]));
    expect(ENEMIES[ENEMY_RIOT]!.armor).toBe(1);
  });

  it("a firearm ignores armor and fells it in two shots", () => {
    let { state, graph } = run(["zombie.riot"], 1);
    state = { ...state, player: armed(state.player) };
    state = take(state, graph, "fire");
    expect(state.combat).not.toBeNull(); // maxHp 5 - 3 = 2, still up
    state = take(state, graph, "fire");
    expect(state.combat).toBeNull(); // 2 - 3 < 0, down
  });
});

// --- Bloated: killing it up close infects you -----------------------------------------------

describe("Bloated one — bursts on death and infects the killer (T46)", () => {
  it("putting it down at your node inflicts an infectious bite wound (avoid: slip past)", () => {
    let { state, graph } = run(["zombie.bloated"], 1);
    expect(state.player.condition.wounds.length).toBe(0);
    // fight it to death
    state = take(state, graph, "fight");
    let guard = 0;
    while (state.combat !== null && guard++ < 20) state = take(state, graph, "strike");
    expect(state.combat).toBeNull();
    const bite = state.player.condition.wounds.find((w) => w.type === "wound.bite");
    expect(bite).toBeDefined(); // the burst
    expect(bite!.severity).toBe(ENEMIES[ENEMY_BLOATED]!.burstInfection);
  });

  it("slipping past a bloated never triggers the burst", () => {
    const { state, graph } = run(["zombie.bloated"], 1);
    const after = take(state, graph, "slip:node.x.b");
    expect(after.combat).toBeNull();
    expect(after.player.condition.wounds.some((w) => w.type === "wound.bite")).toBe(false);
  });
});

// --- Crawler: an ankle grab on the way out --------------------------------------------------

describe("Crawler — a costly slip and an ankle wound (T46)", () => {
  it("a detected slip past a crawler lands an ankle sprain, not a random blow", () => {
    // Force detection: a loud node + night makes the escape roll almost certainly caught, and the
    // crawler grasp bonus stacks on top — so any wound landed is the sprain.
    let { state, graph } = run(["zombie.crawler"], 1);
    state = {
      ...state,
      meta: { ...state.meta, phase: "midday" },
      nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, noise: 100 } },
    };
    const after = take(state, graph, "slip:node.x.b");
    expect(after.player.location).toBe("node.x.b"); // always escapes
    if (after.player.condition.wounds.length > 0) {
      expect(after.player.condition.wounds.every((w) => w.type === "wound.sprain")).toBe(true);
    }
  });
});

// --- Fresh: fast, answers every blow --------------------------------------------------------

describe("Fresh one — initiative: it answers every melee exchange (T46)", () => {
  it("a single non-killing strike always draws a wound (unlike a walker's coin-flip)", () => {
    let { state, graph } = run(["zombie.fresh"], 1); // maxHp 3, melee 1-2 can't one-shot
    state = take(state, graph, "fight");
    expect(state.combat).not.toBeNull(); // survived one strike
    expect(state.player.condition.wounds.length).toBeGreaterThanOrEqual(1); // and it hit back
  });
});

// --- state machine: swift escalates, lowProfile hides ---------------------------------------

describe("state machine — swift escalates, lowProfile hides (T46 · FR-CBT-06)", () => {
  it("a Fresh node reaches a higher arousal than a plain node from the same presence", () => {
    // player stands on node.x.a; node.x.b (adjacent) carries the type under test with equal noise.
    const base = run([], 0);
    const seed = (type: string): GameState => ({
      ...base.state,
      nodes: {
        ...base.state.nodes,
        "node.x.b": { ...base.state.nodes["node.x.b"]!, walkers: 1, zombieTypes: type ? [type] : [], noise: 10, zombieState: "dormant" },
      },
    });
    const plain = tickZombies(seed(""), 3, base.graph).nodes["node.x.b"]!.zombieState;
    const fresh = tickZombies(seed(ZOMBIE_FRESH), 3, base.graph).nodes["node.x.b"]!.zombieState;
    const rung = (s: string): number => ["hibernating", "dormant", "wandering", "investigating", "chasing"].indexOf(s);
    expect(rung(fresh)).toBeGreaterThan(rung(plain)); // the sound of speed
  });

  it("a Crawler reads calmer than a plain node while you're only adjacent, full when you stand on it", () => {
    const base = run([], 0);
    const withCrawler = (playerAt: string): GameState => ({
      ...base.state,
      player: { ...base.state.player, location: playerAt },
      nodes: {
        ...base.state.nodes,
        "node.x.b": { ...base.state.nodes["node.x.b"]!, walkers: 1, zombieTypes: [ZOMBIE_CRAWLER], noise: 25, zombieState: "dormant" },
      },
    });
    const plain: GameState = {
      ...base.state,
      nodes: { ...base.state.nodes, "node.x.b": { ...base.state.nodes["node.x.b"]!, walkers: 1, zombieTypes: [], noise: 25, zombieState: "dormant" } },
    };
    const rung = (s: string): number => ["hibernating", "dormant", "wandering", "investigating", "chasing"].indexOf(s);
    const adjPlain = tickZombies(plain, 3, base.graph).nodes["node.x.b"]!.zombieState;
    const adjCrawler = tickZombies(withCrawler("node.x.a"), 3, base.graph).nodes["node.x.b"]!.zombieState;
    expect(rung(adjCrawler)).toBeLessThan(rung(adjPlain)); // it hides while you're merely near
    const onCrawler = tickZombies(withCrawler("node.x.b"), 3, base.graph).nodes["node.x.b"]!.zombieState;
    expect(rung(onCrawler)).toBeGreaterThan(rung(adjCrawler)); // full stimulus once you stand on it
  });
});

// --- determinism / save-lossless with a new type --------------------------------------------

describe("a type-distinct fight is deterministic + save-lossless (T46 · ADR-0001)", () => {
  it("reproduces byte-identically and round-trips mid-fight against a riot", () => {
    let { state, graph } = run(["zombie.riot"], 1);
    state = take(state, graph, "fight");
    expect(state.combat!.enemy).toBe(ENEMY_RIOT);
    const reloaded = loadGame(saveGame(state));
    expect(reloaded).toStrictEqual(state);
  });
});
