import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  saveGame,
  loadGame,
  atOwnShelter,
  stashChoices,
  resolveStashAction,
  depleteStash,
  stashUnits,
  cacheRead,
  shelterLine,
  inventoryWeight,
  itemWeight,
  CARRY_CAPACITY,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T39 — Shared stash (FR-SHL-03 / FR-PLR-04): a base store separate from the T18 carry budget. Deposit
 * banks surplus off the pack (weightless while stored); withdraw pulls it back only when it fits; the
 * cache is offered only at your own shelter; `depleteStash` is the raid hook. One additive rung (v6→v7):
 * a deposited run is save-lossless and an old v6 save migrates forward with an empty cache. Inert on
 * every prior (cache-less) run.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"] },
];
const opts = { seed: "stash-seed", createdAt: "2026-07-06T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
const HERE = "node.x.a";

const withInv = (s: GameState, inv: GameState["player"]["inventory"]): GameState => ({ ...s, player: { ...s.player, inventory: inv } });
const withStash = (s: GameState, stash: GameState["player"]["stash"]): GameState => ({ ...s, player: { ...s.player, stash } });
const withShelter = (s: GameState, id: string | null): GameState => ({ ...s, player: { ...s.player, shelterId: id as GameState["player"]["shelterId"] } });
const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id);
const take = (s: GameState, g: RegionGraph, id: string) => {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (!c) throw new Error(`choice "${id}" not offered; got: ${ids(availableActions(s, g)).join(",")}`);
  return applyAction(s, c.action, g);
};

// --- the gate: only at your own base ----------------------------------------------------------

describe("stash gate — reachable only at your claimed base (T39)", () => {
  it("offers no stash choices with no shelter, or standing away from it", () => {
    const { state } = run();
    const carrying = withInv(state, [{ type: "item.scrap", quantity: 2 }]);
    expect(atOwnShelter(carrying)).toBe(false);
    expect(stashChoices(carrying)).toEqual([]);
    // shelter elsewhere, standing here → still not at your base
    const elsewhere = withShelter(carrying, "node.x.b");
    expect(atOwnShelter(elsewhere)).toBe(false);
    expect(stashChoices(elsewhere)).toEqual([]);
  });

  it("offers a deposit per carried non-unique stack once you stand in your own shelter", () => {
    const { state } = run();
    const atBase = withShelter(withInv(state, [{ type: "item.scrap", quantity: 2 }, { type: "item.water", quantity: 1 }]), HERE);
    expect(atOwnShelter(atBase)).toBe(true);
    const offered = ids(stashChoices(atBase));
    expect(offered).toContain("stash-deposit:item.scrap");
    expect(offered).toContain("stash-deposit:item.water");
  });
});

// --- deposit frees the pack; the stash is weightless ------------------------------------------

describe("deposit banks surplus off the weight budget (T39 · FR-PLR-04)", () => {
  it("moves one unit pack→cache, lightening the pack while the cache stays weightless", () => {
    const { state, graph } = run();
    const atBase = withShelter(withInv(state, [{ type: "item.tools", quantity: 1 }]), HERE); // tools weigh 6
    const beforeWeight = inventoryWeight(atBase.player.inventory);
    const res = take(atBase, graph, "stash-deposit:item.tools");
    // pack is lighter by exactly the item's weight; the cache carries the unit but adds no carry weight
    expect(inventoryWeight(res.state.player.inventory)).toBe(beforeWeight - itemWeight("item.tools"));
    expect(stashUnits(res.state.player.stash)).toBe(1);
    // total units conserved across the move (pack + cache)
    expect(stashUnits(res.state.player.inventory) + stashUnits(res.state.player.stash)).toBe(1);
  });

  it("is a free (0h) move that changes the player but does not advance the turn", () => {
    const { state, graph } = run();
    const atBase = withShelter(withInv(state, [{ type: "item.scrap", quantity: 1 }]), HERE);
    const res = take(atBase, graph, "stash-deposit:item.scrap");
    expect(res.state.meta.turn).toBe(atBase.meta.turn); // 0h ⇒ not a resolved turn
    expect(res.changed).toContain("player");
  });
});

// --- withdraw only when it fits ---------------------------------------------------------------

describe("withdraw pulls from the cache, but only when it fits the pack (T39)", () => {
  it("returns a stashed unit to the pack when there is room", () => {
    const { state, graph } = run();
    const atBase = withStash(withShelter(withInv(state, []), HERE), [{ type: "item.pistol", quantity: 1 }]);
    expect(ids(stashChoices(atBase))).toContain("stash-withdraw:item.pistol");
    const res = take(atBase, graph, "stash-withdraw:item.pistol");
    expect(res.state.player.inventory.some((e) => e.type === "item.pistol")).toBe(true);
    expect(stashUnits(res.state.player.stash)).toBe(0);
  });

  it("does not offer a withdraw that would overflow the carry budget", () => {
    const { state } = run();
    // pack already at capacity with tools (weight 6 each) — a heavy withdraw cannot fit
    const fullPack = Array.from({ length: Math.ceil(CARRY_CAPACITY / itemWeight("item.tools")) }, () => ({ type: "item.tools", quantity: 1 }));
    const atBase = withStash(withShelter(withInv(state, fullPack), HERE), [{ type: "item.pistol", quantity: 1 }]);
    expect(inventoryWeight(atBase.player.inventory)).toBeGreaterThanOrEqual(CARRY_CAPACITY - itemWeight("item.tools"));
    expect(ids(stashChoices(atBase))).not.toContain("stash-withdraw:item.pistol");
  });
});

// --- the raid / depletion hook ----------------------------------------------------------------

describe("depleteStash — the contested-world raid hook (T39 · FR-SHL-03)", () => {
  it("removes units in stable order and logs a single stash.raided beat", () => {
    const { state } = run();
    const stocked = withStash(withShelter(state, HERE), [
      { type: "item.water", quantity: 2 },
      { type: "item.canned-food", quantity: 2 },
    ]);
    const raided = depleteStash(stocked, 3);
    expect(stashUnits(raided.player.stash)).toBe(1); // 4 − 3
    const beats = raided.history.filter((e) => e.type === "stash.raided");
    expect(beats).toHaveLength(1);
    expect((beats[0]!.data as { units: number }).units).toBe(3);
  });

  it("is inert on an empty cache or a non-positive count (no fabricated change)", () => {
    const { state } = run();
    const empty = withShelter(state, HERE);
    expect(depleteStash(empty, 5)).toBe(empty);
    const stocked = withStash(empty, [{ type: "item.water", quantity: 1 }]);
    expect(depleteStash(stocked, 0)).toBe(stocked);
  });
});

// --- save-lossless through the new v7 rung ----------------------------------------------------

describe("save round-trip & the v6→v7 migration (T39)", () => {
  it("a stashed, sheltered run round-trips deep-equal through v7", () => {
    const { state } = run();
    const stashed = withStash(withShelter(state, HERE), [{ type: "item.scrap", quantity: 3 }, { type: "item.water", quantity: 1 }]);
    expect(loadGame(saveGame(stashed))).toEqual(stashed);
  });

  it("an old v6 save (no player.stash) migrates forward with an empty cache", () => {
    const { state } = run();
    const env = JSON.parse(saveGame(state)) as { saveSchemaVersion: number; state: { meta: { version: number }; player: Record<string, unknown> } };
    // Downgrade to a pre-Part-4 v6 blob: strip the stash, stamp both versions to 6.
    delete env.state.player.stash;
    env.saveSchemaVersion = 6;
    env.state.meta.version = 6;
    const loaded = loadGame(JSON.stringify(env));
    expect(loaded.player.stash).toEqual([]);
    expect(loaded.meta.version).toBe(7);
  });
});

// --- narration & inertness --------------------------------------------------------------------

describe("cache read & inertness (T39)", () => {
  it("shelterLine reads the cache when you stand in the base", () => {
    const { state } = run();
    const bare = withShelter(state, HERE);
    expect(cacheRead(bare)).toContain("bare");
    expect(shelterLine(bare)).toContain("cache");
    const stocked = withStash(bare, [{ type: "item.water", quantity: 2 }]);
    expect(cacheRead(stocked)).not.toBeNull();
    expect(cacheRead(stocked)).not.toContain("bare");
  });

  it("resolveStashAction is inert away from the base or with nothing to move", () => {
    const { state } = run();
    const homeless = withInv(state, [{ type: "item.scrap", quantity: 1 }]);
    expect(resolveStashAction(homeless, { type: "stash-deposit", params: { item: "item.scrap" } })).toBe(homeless);
    const atBaseEmpty = withShelter(withInv(state, []), HERE);
    expect(resolveStashAction(atBaseEmpty, { type: "stash-withdraw", params: { item: "item.water" } })).toBe(atBaseEmpty);
  });
});
