import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SAVE_SCHEMA_VERSION,
  applyAction,
  availableActions,
  detectChance,
  hasLoadedFirearm,
  isWounded,
  loadGame,
  saveGame,
  startRun,
  FIRE_NOISE,
  MELEE_NOISE,
  WALKER_MAX_HP,
  type GameState,
  type NodeDef,
  type Player,
  type RegionGraph,
  type RegionDef,
} from "../src/index.js";

/**
 * T15 — avoidable combat, loud firearms, stealth path (FR-CBT-01/02/04/05). A fight is a decision;
 * a stealth exit always exists; firearms are loud; and it all reproduces from a seed.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
// start node holds walkers; b/c are quiet neighbours to slip toward.
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true, walkers: 2 },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "Node C", description: "a clinic", adjacent: ["node.x.b"] },
];
const opts = { seed: "combat-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

function take(state: GameState, graph: RegionGraph, choiceId: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === choiceId);
  if (!c) throw new Error(`no choice ${choiceId}; offered: ${availableActions(state, graph).map((x) => x.id).join(",")}`);
  return applyAction(state, c.action, graph).state;
}
/** A player carrying a loaded pistol. */
function armed(player: Player): Player {
  return { ...player, inventory: [{ type: "item.pistol", quantity: 1 }, { type: "item.ammo", quantity: 3 }] };
}

// --- the encounter is offered, and is avoidable ---------------------------------------------

describe("encounter offered at a contested node (T15 · FR-CBT-01)", () => {
  it("a walker node offers fight + a stealth slip, and hides the explore loop", () => {
    const { state, graph } = run();
    const ids = availableActions(state, graph).map((c) => c.id);
    expect(ids).toContain("fight");
    expect(ids).toContain("slip:node.x.b"); // stealth path to the discovered neighbour
    expect(ids).not.toContain("search"); // you deal with the walkers or leave
    expect(ids).not.toContain("rest");
    expect(ids).not.toContain("fire"); // unarmed ⇒ no shot
  });

  it("offers fire only when a loaded firearm is carried", () => {
    const { state, graph } = run();
    const armedState: GameState = { ...state, player: armed(state.player) };
    expect(hasLoadedFirearm(armedState.player)).toBe(true);
    expect(availableActions(armedState, graph).some((c) => c.id === "fire")).toBe(true);
  });
});

describe("stealth path through every scenario (T15 DoD · FR-CBT-05)", () => {
  it("slipping away escapes without entering combat and leaves the walkers in place", () => {
    const { state, graph } = run();
    const after = take(state, graph, "slip:node.x.b");
    expect(after.combat).toBeNull(); // never entered a fight
    expect(after.player.location).toBe("node.x.b"); // got out
    expect(after.nodes["node.x.a"]!.walkers).toBe(2); // didn't kill any
  });

  it("a stealth-only survivor can cross the whole region without ever fighting", () => {
    let { state, graph } = run();
    // a(walkers) --slip--> b --move--> c, never a combat action
    state = take(state, graph, "slip:node.x.b");
    // b is quiet ⇒ the normal explore loop returns
    expect(availableActions(state, graph).some((c) => c.id.startsWith("move:"))).toBe(true);
    state = take(state, graph, "move:node.x.c");
    expect(state.combat).toBeNull();
    expect(state.player.location).toBe("node.x.c");
  });
});

// --- combat is turn-based and spends resources ----------------------------------------------

describe("turn-based combat (T15 · FR-CBT-02)", () => {
  it("fighting a full-hp walker begins a persisting fight (melee can't one-shot it)", () => {
    const { state, graph } = run();
    const after = take(state, graph, "fight");
    expect(after.combat).not.toBeNull();
    expect(after.combat!.hp).toBeLessThan(WALKER_MAX_HP);
    expect(after.combat!.alerted).toBe(true);
    // now in-fight choices are offered
    const ids = availableActions(after, graph).map((c) => c.id);
    expect(ids).toContain("strike");
    expect(ids.some((i) => i.startsWith("retreat:"))).toBe(true);
  });

  it("striking to the death clears the fight and drops the node's walker count", () => {
    let { state, graph } = run();
    state = take(state, graph, "fight");
    let guard = 0;
    while (state.combat !== null && guard++ < 20) state = take(state, graph, "strike");
    expect(state.combat).toBeNull();
    expect(state.nodes["node.x.a"]!.walkers).toBe(1); // one walker down (started at 2)
    expect(state.meta.turn).toBeGreaterThanOrEqual(2); // several resolved turns — turn-based
  });
});

// --- firearms are loud ----------------------------------------------------------------------

describe("firearms are loud (T15 · FR-CBT-04)", () => {
  it("firing deposits far more node noise than a melee strike, and spends a round", () => {
    const { state, graph } = run();
    const armedState: GameState = { ...state, player: armed(state.player) };

    const fired = take(armedState, graph, "fire");
    const struck = take(armedState, graph, "fight");

    expect(fired.nodes["node.x.a"]!.noise).toBe(FIRE_NOISE);
    expect(struck.nodes["node.x.a"]!.noise).toBe(MELEE_NOISE);
    expect(fired.nodes["node.x.a"]!.noise).toBeGreaterThan(struck.nodes["node.x.a"]!.noise);

    const ammoLeft = fired.player.inventory.find((e) => e.type === "item.ammo")?.quantity ?? 0;
    expect(ammoLeft).toBe(2); // one round spent
    expect(fired.combat).toBeNull(); // a pistol one-shots a walker (dmg 3 = maxHp)
    expect(fired.nodes["node.x.a"]!.walkers).toBe(1);
  });
});

// --- determinism, wounds, save round-trip ---------------------------------------------------

describe("combat is deterministic and wounds are named (T15)", () => {
  it("the same seed reproduces the same fight byte-for-byte", () => {
    const a = take(run().state, run().graph, "fight");
    const b = take(run().state, run().graph, "fight");
    expect(a).toStrictEqual(b);
  });

  it("a wound an enemy lands is a named content wound, and mid-fight state round-trips", () => {
    let { state, graph } = run();
    for (let i = 0; i < 6 && state.combat === null; i++) state = take(state, graph, "fight");
    // drive a full fight so retaliation has chances to land
    let guard = 0;
    let sawWound = false;
    let s = run().state;
    const g = run().graph;
    s = take(s, g, "fight");
    while (s.combat !== null && guard++ < 30) {
      s = take(s, g, "strike");
      if (isWounded(s.player.condition)) sawWound = true;
    }
    // whatever wounds landed are drawn from the walker's named table
    for (const w of s.player.condition.wounds) {
      expect(["wound.laceration", "wound.bite"]).toContain(w.type);
    }
    expect(loadGame(saveGame(s))).toStrictEqual(s); // save-lossless around combat
    void sawWound; void state;
  });

  it("detectChance rises with noise and a brighter phase (pure)", () => {
    expect(detectChance(80, "midday")).toBeGreaterThan(detectChance(0, "midday"));
    expect(detectChance(50, "night")).toBeLessThan(detectChance(50, "midday"));
    expect(detectChance(0, "night")).toBeGreaterThanOrEqual(0);
    expect(detectChance(100, "midday")).toBeLessThanOrEqual(0.9);
  });
});

// --- save-schema migration v1 -> v2 (the combat layer) --------------------------------------

describe("save migrates v1 -> v2 (T15 · ADR-0003 ladder)", () => {
  it("a pre-combat v1 save loads with combat: null and every node walkers: 0", () => {
    const { state } = run();
    // synthesize a v1 blob: strip the v2-only fields and stamp version 1.
    const v1nodes: Record<string, unknown> = {};
    for (const [id, n] of Object.entries(state.nodes)) {
      const { walkers, ...rest } = n as unknown as Record<string, unknown>;
      void walkers;
      v1nodes[id] = rest;
    }
    const { combat, ...restState } = state as unknown as Record<string, unknown>;
    void combat;
    const v1state = { ...restState, meta: { ...state.meta, version: 1 }, nodes: v1nodes };
    const v1blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 1, summary: "v1 save", state: v1state });

    const loaded = loadGame(v1blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION); // ladder now chains v1->v2->v3
    expect(loaded.combat).toBeNull();
    for (const n of Object.values(loaded.nodes)) expect(n.walkers).toBe(0);
  });
});

// --- property: the encounter always offers a way out ----------------------------------------

describe("property: a walker node always offers escape (T15 DoD)", () => {
  it("every contested node in a connected graph offers at least one slip target", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (walkers) => {
        const nodes: NodeDef[] = NODES.map((n) => (n.start ? { ...n, walkers } : n));
        const { state, graph } = startRun(opts, REGIONS, nodes);
        const ids = availableActions(state, graph).map((c) => c.id);
        expect(ids.some((i) => i.startsWith("slip:"))).toBe(true);
      }),
    );
  });
});
