import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addItemBounded,
  applyAction,
  availableActions,
  CARRY_CAPACITY,
  dropItem,
  fits,
  inventoryWeight,
  itemWeight,
  loadGame,
  remainingCapacity,
  saveGame,
  startRun,
  type GameState,
  type InventoryEntry,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
} from "../src/index.js";

/**
 * T18 — weight-limited inventory (FR-PLR-03). The pack has a finite weight budget; a full pack forces
 * a leave-behind and stops draining the finite loot economy (T17). Carry weight is derived, never
 * stored, so there is no save-schema change.
 */

// A rich single-node region so searches keep turning up finds until the pack caps.
const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { loot: 100, survivorActivity: 0 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a store", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a"], kind: "store" },
];
const opts = { seed: "pack-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

function choose(state: GameState, graph: RegionGraph, id: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === id);
  if (!c) throw new Error(`no choice ${id}`);
  return applyAction(state, c.action, graph).state;
}
const inv = (types: [string, number][]): InventoryEntry[] => types.map(([type, quantity]) => ({ type, quantity }));

// --- weights & capacity ---------------------------------------------------------------------

describe("item weights and pack capacity (T18)", () => {
  it("knows item weights and falls back to a default for unknown ids", () => {
    expect(itemWeight("item.bandage")).toBe(1);
    expect(itemWeight("item.canned-food")).toBe(3);
    expect(itemWeight("item.pistol")).toBe(8);
    expect(itemWeight("item.nonsense")).toBe(2); // default
  });

  it("sums carried weight and reports remaining capacity", () => {
    const pack = inv([["item.canned-food", 2], ["item.bandage", 3]]); // 2*3 + 3*1 = 9
    expect(inventoryWeight(pack)).toBe(9);
    expect(remainingCapacity(pack)).toBe(CARRY_CAPACITY - 9);
    expect(inventoryWeight([])).toBe(0);
    expect(remainingCapacity([])).toBe(CARRY_CAPACITY);
  });
});

// --- bounded add only takes what fits (FR-PLR-03) -------------------------------------------

describe("addItemBounded respects the weight cap (T18 · FR-PLR-03)", () => {
  it("stacks a find that fits and reports it carried", () => {
    const r = addItemBounded(inv([["item.water", 1]]), "item.water");
    expect(r.carried).toBe(true);
    expect(r.inventory).toEqual(inv([["item.water", 2]]));
  });

  it("leaves a find that would overflow the pack, unchanged", () => {
    // fill to exactly capacity with pistols (8 each) → 40/40, no room for anything.
    const full = inv([["item.pistol", 5]]); // 5*8 = 40 = CARRY_CAPACITY
    expect(inventoryWeight(full)).toBe(CARRY_CAPACITY);
    expect(fits(full, "item.bandage")).toBe(false);
    const r = addItemBounded(full, "item.bandage");
    expect(r.carried).toBe(false);
    expect(r.inventory).toBe(full); // untouched reference
    expect(inventoryWeight(r.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
  });
});

// --- drop reclaims weight (the leave-behind lever) ------------------------------------------

describe("dropItem reclaims weight (T18)", () => {
  it("removes one unit and re-opens room for the next find", () => {
    const full = inv([["item.pistol", 5]]);
    const dropped = dropItem(full, "item.pistol");
    expect(inventoryWeight(dropped)).toBe(CARRY_CAPACITY - 8);
    expect(fits(dropped, "item.bandage")).toBe(true); // room again
  });

  it("drops the whole entry at the last unit and is inert on an empty/absent stack", () => {
    expect(dropItem(inv([["item.water", 1]]), "item.water")).toEqual([]);
    const pack = inv([["item.water", 1]]);
    expect(dropItem(pack, "item.absent")).toBe(pack); // nothing to drop ⇒ same ref
    expect(dropItem([], "item.water")).toEqual([]);
  });
});

// --- integration: the pack caps the loot draw (FR-ECO ↔ FR-PLR) -----------------------------

describe("a full pack stops draining the region (T18 ↔ T17)", () => {
  it("carried weight never exceeds capacity over a search-heavy run", () => {
    let { state, graph } = run();
    for (let i = 0; i < 40; i++) {
      // Prefer searching; when a node is picked clean, hop to the other store, else rest.
      const avail = availableActions(state, graph);
      if (avail.length === 0) break; // the run ended (T22 survival) — nothing more to do
      const id = avail.some((c) => c.id === "search") ? "search" : avail.some((c) => c.id === "move:node.x.b") ? "move:node.x.b" : avail[0]!.id;
      state = choose(state, graph, id);
      expect(inventoryWeight(state.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
    }
    // With a 100-loot region and a 40-weight pack, a long scavenge run must have filled the pack.
    expect(inventoryWeight(state.player.inventory)).toBeGreaterThan(0);
  });

  it("once the pack is full, a search no longer debits region loot", () => {
    let { state, graph } = run();
    // Pre-fill the pack to capacity so the very next find cannot be carried.
    state = { ...state, player: { ...state.player, inventory: inv([["item.pistol", 5]]) } };
    expect(inventoryWeight(state.player.inventory)).toBe(CARRY_CAPACITY);
    const before = state.regions["region.x"]!.loot;
    const after = choose(state, graph, "search");
    expect(after.regions["region.x"]!.loot).toBe(before); // nothing pocketed ⇒ nothing debited
    expect(inventoryWeight(after.player.inventory)).toBe(CARRY_CAPACITY); // still full, not over
  });

  it("no drop options clutter the screen while the pack has room (FR-UI)", () => {
    let { state, graph } = run();
    state = { ...state, player: { ...state.player, inventory: inv([["item.canned-food", 2]]) } }; // 6/40, light
    expect(availableActions(state, graph).some((c) => c.id.startsWith("drop:"))).toBe(false);
  });

  it("a drop is offered per stack once the pack is heavy, and reclaims weight through the pipeline", () => {
    let { state, graph } = run();
    // Heavy pack (>= PACK_HEAVY): 4 pistols = 32/40, plus a food stack to drop.
    state = { ...state, player: { ...state.player, inventory: inv([["item.pistol", 4], ["item.canned-food", 1]]) } };
    const drop = availableActions(state, graph).find((c) => c.id === "drop:item.canned-food");
    expect(drop).toBeDefined();
    expect(drop!.label).toBe("Drop canned food"); // humanized label, not the raw id
    expect(drop!.timeCost).toBe(0); // managing the pack costs no time
    const dayBefore = state.meta.day;
    const weightBefore = inventoryWeight(state.player.inventory);
    const after = applyAction(state, drop!.action, graph).state;
    expect(inventoryWeight(after.player.inventory)).toBe(weightBefore - 3); // one food unit gone
    expect(after.meta.day).toBe(dayBefore); // 0-hour: clock did not advance
  });
});

// --- determinism, save round-trip, and the capacity property --------------------------------

describe("weighted pack is deterministic and save-lossless (T18)", () => {
  it("inventory survives save/load", () => {
    let { state, graph } = run();
    state = choose(choose(state, graph, "search"), graph, "search");
    expect(loadGame(saveGame(state))).toStrictEqual(state);
  });

  it("property: no sequence of searches ever overfills the pack", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("search", "rest", "move:node.x.b", "move:node.x.a"), { maxLength: 40 }), (script) => {
        let { state, graph } = run();
        for (const id of script) {
          const c = availableActions(state, graph).find((x) => x.id === id);
          if (!c) continue;
          state = applyAction(state, c.action, graph).state;
          expect(inventoryWeight(state.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
        }
      }),
    );
  });
});
