import { describe, expect, it } from "vitest";
import {
  BLOOD_DECAY_PER_HOUR,
  BLOOD_PER_KILL,
  CARRY_CAPACITY,
  CORPSES_PER_KILL,
  DEFAULT_RICHNESS,
  ITEM_LOOT_WEIGHT,
  LOOT_POINTS_PER_ITEM,
  NOTE_MAX_LENGTH,
  NOTE_MAX_PER_NODE,
  NOTE_PHRASE_LIST,
  RICHNESS_MAX,
  RICHNESS_MIN,
  SCOUT_COST,
  SEARCH_COST,
  advanceWorld,
  applyPlayerAction,
  itemWeight,
  tieredOrdinary,
  SCOUT_HOPS,
  SCOUT_MEMORY_DAYS,
  scoutIsFresh,
  SAVE_SCHEMA_VERSION,
  WEAPONS,
  applyAction,
  availableActions,
  decayAllBlood,
  inventoryWeight,
  isScouted,
  itemLootWeight,
  loadGame,
  lootEntriesFor,
  nodesWithin,
  resolveSearch,
  resolveSearchLoot,
  richnessAuthored,
  richnessOf,
  saveGame,
  scoutFrom,
  searchYieldCap,
  startRun,
  unitsForPoints,
  updateNodeNoise,
  type GameState,
  type NodeDef,
  type NodeState,
  type RegionDef,
  type RegionGraph,
  type WeaponDef,
} from "../src/index.js";

/**
 * T84 — exploration, node identity, and loot as a yield (FR-ECO-01/02/03 · FR-MAP-02 · GDD VII, X).
 *
 * Five claims, in the order the task depends on them:
 *
 *   1. **A node contributes something to its own loot.** `NodeDef.richness` scales the yield cap,
 *      behind an active-system gate — so a set that authors none computes the exact pre-T84 CAP, while
 *      the shipped city stops having six cap values. T84 is deliberately **not** byte-identical at run
 *      level (the loot stream now advances per unit); only the cap arithmetic is pinned.
 *   2. **The search roll is a yield, not a fee.** What leaves the region is what reaches the pack; the
 *      T18 full-pack rule survives intact, generalized per unit.
 *   3. **Ordinary items have tiers.** T81 gave weapons rarity; a course of antibiotics was still exactly
 *      as likely as a bandage.
 *   4. **Looking is a verb.** `scout` buys two hops of map and, the part that matters, what is standing
 *      in them — and arriving somewhere no longer tells you for free.
 *   5. **What a fight leaves behind is written down.** `corpses` and `blood` had one writer each (the
 *      seed, writing 0), which made the T25 `feeding` rung and the `minBlood`/`minCorpses` encounter
 *      gates unreachable by construction.
 *
 * Plus the shape rule every M5 task carries: **no new save rung**. `NodeState.scouted` is optional and
 * absent-reads-false, so a pre-T84 save loads.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];

/** A four-node line a -- b -- c -- d, so `nodesWithin(2)` has something to be wrong about. */
const PLAIN: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a yard", adjacent: ["node.x.a", "node.x.c"], kind: "store" },
  { id: "node.x.c", regionId: "region.x", name: "C", description: "a shop", adjacent: ["node.x.b", "node.x.d"], kind: "store" },
  { id: "node.x.d", regionId: "region.x", name: "D", description: "a lot", adjacent: ["node.x.c"], kind: "store" },
];

/** The same line, with richness authored — which is what turns the whole per-node axis on. */
const RICH: NodeDef[] = PLAIN.map((n) =>
  n.id === "node.x.b" ? { ...n, richness: 200 } : n.id === "node.x.c" ? { ...n, richness: 50 } : n,
);

const POOL: readonly WeaponDef[] = Object.values(WEAPONS);

function run(nodes: NodeDef[], seed = "t84", withWeapons = false): { state: GameState; graph: RegionGraph } {
  return startRun({ seed, createdAt: "2026-09-14T00:00:00Z" }, REGIONS, nodes, [], [], [], [], [], [], [], withWeapons ? POOL : []);
}

/** A region with stock and a node never searched — the shape a search needs. */
function searchable(state: GameState, nodeId: string, loot = 88): GameState {
  return {
    ...state,
    nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId]!, searchPct: 0, discovered: true } },
    regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot } },
    player: { ...state.player, location: nodeId, inventory: [] },
  };
}

const ids = (s: GameState, g: RegionGraph): string[] => availableActions(s, g).map((c) => c.id);
const units = (s: GameState): number => s.player.inventory.reduce((n, e) => n + e.quantity, 0);

// --- 1. node identity ----------------------------------------------------------------------------

describe("a node contributes to its own loot (T84 · FR-ECO-02)", () => {
  it("the gate is OFF for a set that authors no richness — the cap is the exact pre-T84 number", () => {
    const { graph } = run(PLAIN);
    expect(richnessAuthored(graph)).toBe(false);
    // The pre-T84 formula, spelled out rather than referenced, so a change to it has to come through here.
    for (const loot of [0, 8, 24, 50, 70, 85, 100]) {
      for (const pct of [0, 34, 68, 100]) {
        const expected = Math.max(0, Math.min(loot, Math.trunc(loot / 8) - Math.trunc(pct / 34)));
        expect(searchYieldCap(loot, pct)).toBe(expected);
        expect(searchYieldCap(loot, pct, DEFAULT_RICHNESS)).toBe(expected);
      }
    }
  });

  it("the gate is ON as soon as ONE node authors richness", () => {
    const { graph } = run(RICH);
    expect(richnessAuthored(graph)).toBe(true);
    expect(richnessOf(graph, "node.x.b")).toBe(200);
    expect(richnessOf(graph, "node.x.c")).toBe(50);
    expect(richnessOf(graph, "node.x.a")).toBe(DEFAULT_RICHNESS); // unauthored ⇒ an ordinary place
    expect(richnessOf(graph, "node.x.nope")).toBe(DEFAULT_RICHNESS); // and an unknown node too
  });

  it("richness multiplies the cap, and never conjures stock the region does not have", () => {
    expect(searchYieldCap(88, 0, 100)).toBe(11);
    expect(searchYieldCap(88, 0, 200)).toBe(22);
    expect(searchYieldCap(88, 0, 50)).toBe(5);
    expect(searchYieldCap(88, 0, 0)).toBe(0);
    // Richness scales the REGION's term, so a deep place is the LAST one in a thinning district to run
    // dry — where an ordinary node has already reached zero.
    expect(searchYieldCap(7, 0, DEFAULT_RICHNESS)).toBe(0);
    expect(searchYieldCap(7, 0, 250)).toBe(2);
    // ...but it can never hand out a point the district does not hold: the clamp to what remains binds.
    expect(searchYieldCap(0, 0, 250)).toBe(0);
    expect(searchYieldCap(1, 0, 250)).toBe(0);
    expect(searchYieldCap(4, 0, 250)).toBe(1);
    for (const loot of [0, 1, 2, 3, 5, 9, 17, 40]) {
      for (const r of [0, 50, 100, 250]) expect(searchYieldCap(loot, 0, r)).toBeLessThanOrEqual(loot);
    }
    // And the node's own picked-over penalty is NOT amplified by richness — a rich node loses the same
    // 1 per 34% searched that a poor one does, which is what keeps a low-richness node from reaching a
    // guaranteed-empty search the Scene would still offer.
    for (const r of [20, 100, 200]) {
      expect(searchYieldCap(88, 0, r) - searchYieldCap(88, 34, r)).toBe(1);
      expect(searchYieldCap(88, 34, r) - searchYieldCap(88, 68, r)).toBe(1);
    }
  });

  it("authored richness is clamped and total about junk (a hand-edited content set reaches here)", () => {
    const bad = PLAIN.map((n) => (n.id === "node.x.b" ? { ...n, richness: 9999 } : n));
    const worse = PLAIN.map((n) => (n.id === "node.x.b" ? { ...n, richness: -40 } : n));
    expect(richnessOf(run(bad).graph, "node.x.b")).toBe(RICHNESS_MAX);
    expect(richnessOf(run(worse).graph, "node.x.b")).toBe(RICHNESS_MIN);
    const nan = PLAIN.map((n) => (n.id === "node.x.b" ? { ...n, richness: Number.NaN } : n));
    expect(richnessOf(run(nan).graph, "node.x.b")).toBe(DEFAULT_RICHNESS);
  });

  it("a search that cannot pay says so, and is still offered (it is how a node is stripped clean)", () => {
    const { state, graph } = run(RICH, "stripped");
    // node.x.c is richness 50 in a region with just enough left that its cap lands on zero.
    const thin: GameState = {
      ...searchable(state, "node.x.c", 9),
      nodes: { ...state.nodes, "node.x.c": { ...state.nodes["node.x.c"]!, searchPct: 34, discovered: true } },
      player: { ...state.player, location: "node.x.c" },
    };
    expect(searchYieldCap(9, 34, richnessOf(graph, "node.x.c"))).toBe(0);
    const search = availableActions(thin, graph).find((c) => c.id === "search")!;
    expect(search.label).toContain("looks stripped");
    // Still offered, because searching is the only way to reach `searchPct` 100 — which is what
    // claiming a safehouse requires. Withdrawing it would strand a node in a thinned district.
    expect(search.timeCost).toBe(SEARCH_COST);
    const after = applyAction(thin, search.action, graph).state;
    expect(after.nodes["node.x.c"]!.searchPct).toBeGreaterThan(34);
    // A node that CAN pay is labelled plainly.
    const rich: GameState = { ...searchable(state, "node.x.b"), player: { ...state.player, location: "node.x.b" } };
    expect(availableActions(rich, graph).find((c) => c.id === "search")!.label).not.toContain("stripped");
  });

  it("two nodes of the SAME KIND in the SAME region are no longer identical", () => {
    const { graph } = run(RICH, "spread");
    // A pinned stock, not the fixture's (these REGIONS author no `baseline.loot`, so the seeded region
    // starts at 0 and every cap would be 0 — an instrument reading dressed as a result, the T81 lesson).
    const LOOT = 88;
    const cap = (id: string): number =>
      searchYieldCap(LOOT, 0, richnessAuthored(graph) ? richnessOf(graph, id) : DEFAULT_RICHNESS);
    // b, c and d are all `store` in `region.x` — before T84 the three caps were one number.
    expect(new Set([cap("node.x.b"), cap("node.x.c"), cap("node.x.d")]).size).toBe(3);
    expect(cap("node.x.b")).toBeGreaterThan(cap("node.x.d"));
    expect(cap("node.x.d")).toBeGreaterThan(cap("node.x.c"));
  });
});

// --- 2. loot as a yield --------------------------------------------------------------------------

describe("the search roll is a yield, not a fee (T84 · FR-ECO-01/03)", () => {
  it("points become items at the published rate, floored at one", () => {
    expect(unitsForPoints(0)).toBe(0);
    for (let p = 1; p <= 24; p += 1) expect(unitsForPoints(p)).toBe(Math.max(1, Math.ceil(p / LOOT_POINTS_PER_ITEM)));
    expect(unitsForPoints(-5)).toBe(0);
  });

  it("what leaves the region is what reaches the pack — the debit equals the haul", () => {
    const { state, graph } = run(PLAIN, "yield");
    let sawMulti = false;
    for (let i = 0; i < 60; i += 1) {
      const s = searchable({ ...state, meta: { ...state.meta, seed: `yield-${i}` } }, "node.x.a");
      const before = s.regions["region.x"]!.loot;
      const h = resolveSearch(s, "node.x.a", graph.nodes["node.x.a"]?.kind);
      expect(h.state.regions["region.x"]!.loot).toBe(before - h.taken);
      expect(h.found.length).toBe(units(h.state));
      if (!h.packFull) {
        // A haul that fit entirely costs exactly what was drawn, and is exactly that many items.
        expect(h.taken).toBe(h.offered);
        expect(h.found.length).toBe(unitsForPoints(h.offered));
      }
      if (h.found.length > 1) sawMulti = true;
    }
    // The whole point of the change: a search can return more than one thing. Pre-T84 this was 1.00
    // at every cap (`measure/t84.ts --tax`), which is what made the roll pure downside.
    expect(sawMulti).toBe(true);
  });

  it("a bigger cap means MORE ITEMS, not a bigger fee for the same one", () => {
    const { state, graph } = run(PLAIN, "scale");
    const meanItems = (loot: number): number => {
      let n = 0;
      for (let i = 0; i < 200; i += 1) {
        const s = searchable({ ...state, meta: { ...state.meta, seed: `scale-${loot}-${i}` } }, "node.x.a", loot);
        n += resolveSearch(s, "node.x.a", graph.nodes["node.x.a"]?.kind).found.length;
      }
      return n / 200;
    };
    const thin = meanItems(24);
    const rich = meanItems(88);
    expect(rich).toBeGreaterThan(thin * 1.4);
  });

  it("a FULL pack leaves the find in the world and does NOT debit the region (the T18 rule, intact)", () => {
    const { state, graph } = run(PLAIN, "full");
    // 13 units of water is 39 of a 40 budget; nothing in the store table fits in the last point.
    const loaded = {
      ...searchable(state, "node.x.a"),
      player: { ...state.player, location: "node.x.a", inventory: [{ type: "item.water", quantity: 13 }] },
    };
    expect(inventoryWeight(loaded.player.inventory)).toBe(39);
    const before = loaded.regions["region.x"]!.loot;
    const h = resolveSearch(loaded, "node.x.a", graph.nodes["node.x.a"]?.kind);
    expect(h.found).toEqual([]);
    expect(h.packFull).toBe(true);
    expect(h.taken).toBe(0);
    expect(h.state.regions["region.x"]!.loot).toBe(before); // the well is not drained
    expect(h.state.rng).not.toBe(loaded.rng); // ...but the draw happened
  });

  it("a PARTIAL haul debits only what was carried", () => {
    const { state, graph } = run(PLAIN, "partial");
    let sawPartial = false;
    for (let i = 0; i < 600 && !sawPartial; i += 1) {
      // Leave room for one light item and no more.
      const loaded = {
        ...searchable({ ...state, meta: { ...state.meta, seed: `partial-${i}` } }, "node.x.a"),
        // 12 water is 36 of the 40 budget: a light find or two fits, a third does not.
        player: { ...state.player, location: "node.x.a", inventory: [{ type: "item.water", quantity: 12 }] },
      };
      const before = loaded.regions["region.x"]!.loot;
      const h = resolveSearch(loaded, "node.x.a", graph.nodes["node.x.a"]?.kind);
      if (h.found.length === 0 || !h.packFull) continue;
      sawPartial = true;
      expect(h.taken).toBeGreaterThan(0);
      expect(h.taken).toBeLessThanOrEqual(h.offered);
      expect(h.taken).toBeLessThanOrEqual(h.found.length * LOOT_POINTS_PER_ITEM);
      expect(h.state.regions["region.x"]!.loot).toBe(before - h.taken);
      expect(inventoryWeight(h.state.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
    }
    expect(sawPartial).toBe(true);
  });

  it("an exhausted node and an empty region still yield nothing at all", () => {
    const { state, graph } = run(PLAIN, "empty");
    const clean = { ...searchable(state, "node.x.a"), nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 100 } } };
    const thin = { ...clean, regions: { ...clean.regions, "region.x": { ...clean.regions["region.x"]!, loot: 0 } } };
    const h = resolveSearch(thin, "node.x.a", graph.nodes["node.x.a"]?.kind);
    expect(h.found).toEqual([]);
    expect(h.taken).toBe(0);
    expect(h.state).toBe(thin); // an empty region does not even draw
  });

  it("the weight invariant holds across a long sequence of hauls", () => {
    const { state, graph } = run(PLAIN, "invariant", true);
    let s = searchable(state, "node.x.a");
    for (let i = 0; i < 80; i += 1) {
      s = resolveSearchLoot(
        { ...s, nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, searchPct: 0 } }, regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 88 } } },
        "node.x.a", graph.nodes["node.x.a"]?.kind, false, false, true,
      );
      expect(inventoryWeight(s.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
      for (const e of s.player.inventory) expect(e.quantity).toBeGreaterThan(0);
    }
  });
});

// --- 3. ordinary-item tiers ----------------------------------------------------------------------

describe("ordinary items have rough tiers too (T84 · GDD X)", () => {
  it("a tiered item is rarer than an untiered one, and an unknown id falls back to the base", () => {
    expect(itemLootWeight("item.bandage")).toBeGreaterThan(itemLootWeight("item.antibiotics"));
    expect(itemLootWeight("item.scrap")).toBeGreaterThan(itemLootWeight("item.bandage"));
    expect(itemLootWeight("item.nothing-like-this")).toBe(itemLootWeight("item.bandage"));
    // Every shipped table must normalise without any row falling out of the draw — the `Math.max(1, …)`
    // in `tieredOrdinary` is a backstop and this proves it is not load-bearing on today's content.
    for (const kind of ["generic", "store", "medical", "police", "residential", "industrial"]) {
      for (const eco of [false, true]) {
        const rows = lootEntriesFor(kind, true, eco).filter((e) => WEAPONS[e.value] === undefined);
        expect(rows.every((e) => e.weight >= 1), `${kind} eco=${eco}`).toBe(true);
        expect(rows.reduce((n, e) => n + e.weight, 0), `${kind} eco=${eco}`).toBe(rows.length * 18);
      }
    }
  });

  it("the tiers reach the actual draw", () => {
    const { state } = run(PLAIN, "tiers", true);
    const counts = new Map<string, number>();
    for (let i = 0; i < 1500; i += 1) {
      const s = searchable({ ...state, meta: { ...state.meta, seed: `tiers-${i}` } }, "node.x.a");
      for (const id of resolveSearch(s, "node.x.a", "medical", false, true, true).found) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const bandage = counts.get("item.bandage") ?? 0;
    const antibiotics = counts.get("item.antibiotics") ?? 0;
    expect(bandage).toBeGreaterThan(0);
    expect(antibiotics).toBeGreaterThan(0);
    expect(antibiotics).toBeLessThan(bandage / 2);
    // ...and every entry still comes from the ordinary table, not a weapon row, for a weapon-free kind.
    for (const e of lootEntriesFor("medical", false, true)) expect(WEAPONS[e.value]).toBeUndefined();
  });
});

// --- 4. scouting ----------------------------------------------------------------------------------

describe("looking before you walk (T84 · FR-MAP-02)", () => {
  it("nodesWithin walks the graph, sorted, including the origin", () => {
    const { graph } = run(PLAIN);
    expect(nodesWithin(graph, "node.x.a", 0)).toEqual(["node.x.a"]);
    expect(nodesWithin(graph, "node.x.a", 1)).toEqual(["node.x.a", "node.x.b"]);
    expect(nodesWithin(graph, "node.x.a", 2)).toEqual(["node.x.a", "node.x.b", "node.x.c"]);
    expect(nodesWithin(graph, "node.x.a", 99)).toEqual(["node.x.a", "node.x.b", "node.x.c", "node.x.d"]);
    expect(nodesWithin(graph, "node.x.a", -3)).toEqual(["node.x.a"]); // total about junk
  });

  it("arriving somewhere reveals one hop, scouts ONLY where you stand, and tells you nothing about the neighbours", () => {
    const { state, graph } = run(PLAIN, "arrive");
    // The brief proposed removing the free reveal. Measured (`measure/t84.ts --frontier`), travel already
    // offers NOTHING on 52.7% of turns, and `move` requires `discovered` — so removing it would strand
    // the explore loop against the testlab's "availableActions is never empty" invariant. It stays.
    expect(state.nodes["node.x.b"]!.discovered).toBe(true);
    expect(isScouted(state.nodes["node.x.b"]!)).toBe(false);
    expect(isScouted(state.nodes["node.x.a"]!)).toBe(true); // you are standing in it
    expect(state.nodes["node.x.c"]!.discovered).toBe(false);

    // ...and the same after an actual MOVE, which is what the first cut of this test never performed —
    // it asserted the seeded state and so could not have caught the predicate that made `lastVisit`
    // imply "scouted" and handed the verb's whole payload away for free.
    const move = availableActions(state, graph).find((c) => c.id === "move:node.x.b")!;
    const after = applyAction(state, move.action, graph).state;
    expect(after.player.location).toBe("node.x.b");
    expect(isScouted(after.nodes["node.x.b"]!)).toBe(true); // you are standing in it now
    expect(after.nodes["node.x.b"]!.scoutedOn).toBe(after.meta.day);
    expect(after.nodes["node.x.c"]!.discovered).toBe(true); // revealed by arriving...
    expect(isScouted(after.nodes["node.x.c"]!)).toBe(false); // ...but not looked at
    expect(availableActions(after, graph).find((c) => c.id === "move:node.x.c")!.label)
      .not.toContain("dead");
  });

  it("what you know goes stale — a look is a memory, not a camera", () => {
    const { state, graph } = run(PLAIN, "stale");
    const looked: GameState = {
      ...state,
      nodes: { ...scoutFrom(state.nodes, graph, "node.x.a", SCOUT_HOPS, state.meta.day), "node.x.b": { ...state.nodes["node.x.b"]!, walkers: 3, discovered: true, scouted: true, scoutedOn: state.meta.day } },
    };
    expect(scoutIsFresh(looked.nodes["node.x.b"]!, state.meta.day)).toBe(true);
    expect(availableActions(looked, graph).find((c) => c.id === "move:node.x.b")!.label).toContain("3 dead");
    // Same mark, four days later: still scouted, no longer quotable.
    const later: GameState = { ...looked, meta: { ...looked.meta, day: state.meta.day + SCOUT_MEMORY_DAYS + 1 } };
    expect(isScouted(later.nodes["node.x.b"]!)).toBe(true);
    expect(scoutIsFresh(later.nodes["node.x.b"]!, later.meta.day)).toBe(false);
    const label = availableActions(later, graph).find((c) => c.id === "move:node.x.b")!.label;
    expect(label).not.toContain("3 dead");
    expect(label).toContain("not lately");
    // ...and a stale look puts the verb back on the table.
    expect(ids(later, graph)).toContain("scout");
  });

  it("scouting reveals TWO hops and marks them looked-at", () => {
    const { state, graph } = run(PLAIN, "scout");
    const nodes = scoutFrom(state.nodes, graph, "node.x.a", SCOUT_HOPS);
    for (const id of ["node.x.a", "node.x.b", "node.x.c"]) {
      expect(nodes[id]!.discovered, id).toBe(true);
      expect(isScouted(nodes[id]!), id).toBe(true);
    }
    expect(nodes["node.x.d"]!.discovered).toBe(false);
    expect(isScouted(nodes["node.x.d"]!)).toBe(false);
    // Same reference when there is nothing left to look at — the empty-turn contract.
    expect(scoutFrom(nodes, graph, "node.x.a", SCOUT_HOPS)).toBe(nodes);
  });

  it("the verb costs an hour, deposits NO noise, and stops being offered once the block is known", () => {
    const { state, graph } = run(PLAIN, "verb");
    expect(ids(state, graph)).toContain("scout");
    const choice = availableActions(state, graph).find((c) => c.id === "scout")!;
    expect(choice.timeCost).toBe(SCOUT_COST);
    const after = applyAction(state, choice.action, graph).state;
    expect(after.meta.hour).not.toBe(state.meta.hour); // time passed
    // The one explore verb that leaves the block as quiet as it found it — the reason night's
    // concealment finally has a use.
    expect(after.nodes["node.x.a"]!.noise).toBe(0);
    expect(isScouted(after.nodes["node.x.c"]!)).toBe(true);
    // One scout from `a` exhausts everything within SCOUT_HOPS of `a` (node.x.d is three hops away and
    // is NOT revealed), so the verb correctly stops being offered here — spending an hour to learn
    // nothing is the dead affordance this task removes, not one it adds.
    expect(isScouted(after.nodes["node.x.d"]!)).toBe(false);
    expect(ids(after, graph)).not.toContain("scout");
    // ...and it comes back the moment there is something new within reach.
    const forgot = { ...after, nodes: { ...after.nodes, "node.x.c": { ...after.nodes["node.x.c"]!, scouted: false } } };
    expect(ids(forgot, graph)).toContain("scout");
  });

  it("a travel choice reports the dead ONLY where the player has actually looked", () => {
    const { state, graph } = run(PLAIN, "intel");
    const busy: GameState = { ...state, nodes: { ...state.nodes, "node.x.b": { ...state.nodes["node.x.b"]!, walkers: 3 } } };
    const blind = availableActions(busy, graph).find((c) => c.id === "move:node.x.b")!;
    expect(blind.label).not.toContain("3 dead");
    const looked: GameState = { ...busy, nodes: scoutFrom(busy.nodes, graph, "node.x.a", SCOUT_HOPS) };
    const informed = availableActions(looked, graph).find((c) => c.id === "move:node.x.b")!;
    expect(informed.label).toContain("3 dead");
    // A quiet scouted node says so — "I looked and it is fine" is information too.
    const quiet = availableActions({ ...state, nodes: scoutFrom(state.nodes, graph, "node.x.a", SCOUT_HOPS) }, graph)
      .find((c) => c.id === "move:node.x.b")!;
    expect(quiet.label).toContain("quiet");
  });
});

// --- 5. the map journal ---------------------------------------------------------------------------

describe("the map is a journal, and now something can write in it (T84 · GDD VII rule 5)", () => {
  it("exactly ONE note is offered at a time, and it is about this place", () => {
    const { state, graph } = run(PLAIN, "note");
    const offered = availableActions(state, graph).filter((c) => c.id === "note");
    expect(offered).toHaveLength(1);
    expect(offered[0]!.timeCost).toBe(0); // the T18 rule: managing what you already have is free
    const text = (offered[0]!.action.params as { text: string }).text;
    expect(NOTE_PHRASE_LIST).toContain(text);
  });

  it("the phrase follows the node: bodies on the floor read as a warning", () => {
    const { state, graph } = run(PLAIN, "phrase");
    const bloody: GameState = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, corpses: 2 } } };
    const c = availableActions(bloody, graph).find((x) => x.id === "note")!;
    expect((c.action.params as { text: string }).text).toBe("dead here — careful");
  });

  it("a note is pinned, deduplicated, and the offer stops when the node has said its piece", () => {
    const { state, graph } = run(PLAIN, "pin");
    let s = state;
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const c = availableActions(s, graph).find((x) => x.id === "note");
      if (c === undefined) break;
      seen.push((c.action.params as { text: string }).text);
      s = applyAction(s, c.action, graph).state;
    }
    const notes = s.nodes["node.x.a"]!.playerNotes;
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(notes).size).toBe(notes.length); // never the same line twice
    expect(notes.length).toBeLessThanOrEqual(NOTE_MAX_PER_NODE);
    expect(availableActions(s, graph).some((x) => x.id === "note")).toBe(false);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("the applier is total about what a hand-edited save can hand it", () => {
    const { state, graph } = run(PLAIN, "total");
    const before = state.nodes["node.x.a"]!.playerNotes;
    const apply = (params: Record<string, unknown>): GameState =>
      applyAction(state, { type: "note", choiceId: "note", timeCost: 0, params }, graph).state;
    expect(apply({}).nodes["node.x.a"]!.playerNotes).toBe(before);
    expect(apply({ text: 17 }).nodes["node.x.a"]!.playerNotes).toBe(before);
    expect(apply({ text: "   " }).nodes["node.x.a"]!.playerNotes).toBe(before);
    const long = apply({ text: "x".repeat(NOTE_MAX_LENGTH + 200) }).nodes["node.x.a"]!.playerNotes;
    expect(long[0]!.length).toBe(NOTE_MAX_LENGTH);
  });
});

// --- 6. aftermath ---------------------------------------------------------------------------------

describe("what a fight leaves behind is written down (T84 · PL-M5-25)", () => {
  it("a kill marks the node with a body and with blood", () => {
    const { state, graph } = run(PLAIN, "kill", true);
    const contested: GameState = {
      ...state,
      nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, walkers: 1, roster: ["zombie.walker"], zombieTypes: ["zombie.walker"] } },
    };
    let s = contested;
    const before = s.nodes["node.x.a"]!;
    expect(before.corpses).toBe(0);
    expect(before.blood).toBe(0);
    // Fight until the body is down (a walker takes a few strikes; the loop is bounded).
    for (let i = 0; i < 60 && s.nodes["node.x.a"]!.corpses === 0; i += 1) {
      const c = availableActions(s, graph).find((x) => x.id.startsWith("fight") || x.id.startsWith("strike"));
      if (c === undefined) break;
      s = applyAction(s, c.action, graph).state;
    }
    const after = s.nodes["node.x.a"]!;
    expect(after.corpses).toBe(CORPSES_PER_KILL);
    // Blood is deposited at the kill and then fades with the hours the turn spent, so assert the
    // deposit happened rather than its exact surviving value.
    expect(after.blood).toBeGreaterThan(0);
    expect(after.blood).toBeLessThanOrEqual(BLOOD_PER_KILL);
  });

  it("blood fades and corpses do not — a node remembers being fought over", () => {
    const { state } = run(PLAIN, "fade");
    const marked = { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, corpses: 3, blood: 40 } };
    const faded = decayAllBlood(marked, 5);
    expect(faded["node.x.a"]!.blood).toBe(40 - 5 * BLOOD_DECAY_PER_HOUR);
    expect(faded["node.x.a"]!.corpses).toBe(3);
    expect(decayAllBlood(faded, 0)).toBe(faded); // a zero-hour turn allocates nothing
    expect(decayAllBlood(marked, 100)["node.x.a"]!.blood).toBe(0); // floored, never negative
    // A map with no blood on it is untouched — which is what keeps every pre-T84 fixture identical.
    expect(decayAllBlood(state.nodes, 9)).toBe(state.nodes);
  });

  it("the aftermath fade rides the same stage as noise and leaves a clean map alone", () => {
    const { state } = run(PLAIN, "stage");
    const s: GameState = { ...state, nodes: { ...state.nodes, "node.x.b": { ...state.nodes["node.x.b"]!, blood: 30, noise: 30 } } };
    const after = updateNodeNoise(s, { type: "rest", timeCost: 4 });
    expect(after.nodes["node.x.b"]!.blood).toBe(30 - 4 * BLOOD_DECAY_PER_HOUR);
    expect(after.nodes["node.x.b"]!.noise).toBeLessThan(30);
  });
});

// --- 7. the shape rule ----------------------------------------------------------------------------

describe("T84 adds no save rung", () => {
  it("a pre-T84 save — no `scouted` anywhere — loads, and reads as unscouted", () => {
    const { state, graph } = run(PLAIN, "save");
    const scouted: GameState = { ...state, nodes: scoutFrom(state.nodes, graph, "node.x.a", SCOUT_HOPS, state.meta.day) };
    const round = loadGame(saveGame(scouted));
    expect(round.nodes["node.x.c"]!.scouted).toBe(true);
    expect(round.nodes["node.x.c"]!.scoutedOn).toBe(state.meta.day);
    // Now strip the field, as a save written before T84 has it: absent must read false, not crash.
    const legacy = JSON.parse(saveGame(scouted)) as { state: { nodes: Record<string, NodeState> } };
    for (const id of Object.keys(legacy.state.nodes)) {
      const { scouted: _drop, scoutedOn: _drop2, ...rest } = legacy.state.nodes[id]!;
      legacy.state.nodes[id] = rest as NodeState;
    }
    const old = loadGame(JSON.stringify(legacy));
    expect(old.nodes["node.x.c"]!.scouted).toBeUndefined();
    expect(old.nodes["node.x.c"]!.scoutedOn).toBeUndefined();
    expect(isScouted(old.nodes["node.x.c"]!)).toBe(false);
    expect(scoutIsFresh(old.nodes["node.x.c"]!, old.meta.day)).toBe(false);
    // A pre-T84 save has no marks at all — including on the node the player is standing in. That reads
    // as "not looked at", which is the safe direction: the scout verb is offered, nothing is quoted.
    expect(isScouted(old.nodes["node.x.a"]!)).toBe(false);
  });

  it("a T84 save is accepted by the version the tree already ships", () => {
    // Not `expect(SAVE_SCHEMA_VERSION).toBe(10)` — a constant against itself. The claim is that a save
    // written with the new optional fields round-trips through the CURRENT loader unchanged.
    const { state, graph } = run(PLAIN, "rung");
    const s: GameState = { ...state, nodes: scoutFrom(state.nodes, graph, "node.x.a", SCOUT_HOPS, 3) };
    const json = saveGame(s);
    expect(JSON.parse(json).saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(saveGame(loadGame(json))).toBe(json);
  });
});


// --- 8. round-2: the mutants round 1 let through ---------------------------------------------------

/**
 * Every test below exists because a mutation run survived without it. Three of them cover **audit
 * fixes that shipped with no test of their own** — the lesson T77 recorded, T82 hit again, T83 hit a
 * third time, and this task has now hit a fourth. The pattern is stable enough to be a rule: an audit
 * fix is a change like any other and does not get to skip the suite.
 */
describe("T84 round-2 — what the first mutation run got past", () => {
  it("the kill marks are TOTAL about a hand-edited save (audit fix, `clampNodePct`)", () => {
    const { state, graph } = run(PLAIN, "junk", true);
    // `assertSaveFile` is shallow, so these arrive as anything. `Math.min`/`Math.max` do NOT scrub NaN,
    // and a poisoned field is absorbing: it stays NaN through every later kill and reaches the save as
    // `null`, silently switching off the `feeding` rung, the encounter gates and the map-journal note.
    for (const junk of [undefined, null, Number.NaN, "3", {}, Number.POSITIVE_INFINITY]) {
      const poisoned: GameState = {
        ...state,
        nodes: {
          ...state.nodes,
          "node.x.a": { ...state.nodes["node.x.a"]!, walkers: 1, roster: ["zombie.walker"], zombieTypes: ["zombie.walker"],
            corpses: junk as unknown as number, blood: junk as unknown as number },
        },
      };
      let s = poisoned;
      for (let i = 0; i < 60; i += 1) {
        const c = availableActions(s, graph).find((x) => x.id.startsWith("fight") || x.id.startsWith("strike"));
        if (c === undefined) break;
        s = applyAction(s, c.action, graph).state;
        if (s.nodes["node.x.a"]!.walkers === 0) break; // the body is down; the mark is written
      }
      const n = s.nodes["node.x.a"]!;
      expect(Number.isFinite(n.corpses), `corpses after a kill from ${String(junk)}`).toBe(true);
      expect(Number.isFinite(n.blood), `blood after a kill from ${String(junk)}`).toBe(true);
      // A junk field is scrubbed to 0 BEFORE the increment, so the kill still leaves a body — where
      // clamping only the sum would turn `undefined + 1` into NaN and then into a scrubbed 0, losing
      // the very mark the kill was supposed to write.
      // A junk field is scrubbed to 0 BEFORE the increment, so the kill still leaves a body — where
      // clamping only the sum would turn `undefined + 1` into NaN and then into a scrubbed 0, losing
      // the very mark the kill was supposed to write.
      expect(n.corpses, `corpses after a kill from ${String(junk)}`).toBe(1);
      // `blood` is not pinned to an exact number here: `decayAllBlood` runs first and normalises an
      // infinite field to 100 on the way past, so the junk cases legitimately land at different
      // values. What must hold for all of them is that a mark was left and it is in range.
      expect(n.blood, `blood after a kill from ${String(junk)}`).toBeGreaterThan(0);
      expect(n.blood).toBeLessThanOrEqual(100);
      // ...and nothing NaN-shaped reaches the save as `null` (the T83 defect, in the same shape).
      expect(JSON.stringify(saveGame(s))).not.toContain('"corpses":null');
      expect(JSON.stringify(saveGame(s))).not.toContain('"blood":null');
    }
  });

  it("a kill really does leave a body — not `CORPSES_PER_KILL`, the number 1", () => {
    const { state, graph } = run(PLAIN, "one", true);
    const contested: GameState = {
      ...state,
      nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, walkers: 1, roster: ["zombie.walker"], zombieTypes: ["zombie.walker"] } },
    };
    let s = contested;
    for (let i = 0; i < 60 && s.nodes["node.x.a"]!.corpses === 0; i += 1) {
      const c = availableActions(s, graph).find((x) => x.id.startsWith("fight") || x.id.startsWith("strike"));
      if (c === undefined) break;
      s = applyAction(s, c.action, graph).state;
    }
    // The first cut asserted `toBe(CORPSES_PER_KILL)`, which a mutant setting that constant to 0 passed
    // against an initial value of 0 — a constant against itself.
    expect(s.nodes["node.x.a"]!.corpses).toBe(1);
    expect(s.nodes["node.x.a"]!.blood).toBeGreaterThan(0);
  });

  it("aftermath fades OFF-SCREEN at the same rate it fades on (audit fix, `advanceWorld`)", () => {
    const { state, graph } = run(PLAIN, "offscreen");
    const marked: GameState = { ...state, nodes: { ...state.nodes, "node.x.b": { ...state.nodes["node.x.b"]!, blood: 60, noise: 60 } } };
    const played = updateNodeNoise(marked, { type: "rest", timeCost: 6 });
    const skipped = advanceWorld(marked, 6, graph);
    // The T74 invariant: a played hour and a fast-forwarded hour cost a node the same thing.
    expect(skipped.nodes["node.x.b"]!.blood).toBe(60 - 6 * BLOOD_DECAY_PER_HOUR);
    expect(skipped.nodes["node.x.b"]!.blood).toBe(played.nodes["node.x.b"]!.blood);
    // ...and a map with no blood on it is untouched, so no pre-T84 off-screen advance moved.
    expect(advanceWorld(state, 6, graph).nodes["node.x.a"]!.blood).toBe(0);
  });

  it("the haul is a PREFIX of the draw, never a filter that skips what would not fit", () => {
    // The deterministic kill for `break`-vs-`continue` at the weapon refusal. Same seed, same node,
    // same stock: an empty pack takes the whole draw, a nearly-full one must take a leading run of it.
    // A `continue` would let the search step over a refused axe and pocket the knife behind it, turning
    // the T18 weight cap from "your pack is full" into "your pack filters for light loot".
    const { state } = run(PLAIN, "prefix", true);
    let sawTruncation = false;
    for (let i = 0; i < 300; i += 1) {
      const seeded = searchable({ ...state, meta: { ...state.meta, seed: `prefix-${i}` } }, "node.x.a");
      const full = resolveSearch(seeded, "node.x.a", "police", false, true, true).found;
      const loaded: GameState = { ...seeded, player: { ...seeded.player, inventory: [{ type: "item.water", quantity: 12 }] } };
      const part = resolveSearch(loaded, "node.x.a", "police", false, true, true);
      expect(part.found.length).toBeLessThanOrEqual(full.length);
      expect(full.slice(0, part.found.length), `seed ${i}`).toEqual(part.found);
      if (part.found.length < full.length) sawTruncation = true;
    }
    expect(sawTruncation).toBe(true);
  });

  it("a full pack ends the haul at the first refusal", () => {
    const { state, graph } = run(PLAIN, "endshaul", true);
    // Four points of room: a knife (1) fits, an axe (8) does not. A `continue` instead of a `break`
    // would keep drawing past the refusal and quietly turn a full pack into a filter for light loot.
    let sawRefusalEndIt = false;
    for (let i = 0; i < 400 && !sawRefusalEndIt; i += 1) {
      const loaded: GameState = {
        ...searchable({ ...state, meta: { ...state.meta, seed: `end-${i}` } }, "node.x.a"),
        player: { ...state.player, location: "node.x.a", inventory: [{ type: "item.water", quantity: 12 }] },
      };
      const h = resolveSearch(loaded, "node.x.a", "store", false, true, true);
      if (!h.packFull) continue;
      sawRefusalEndIt = true;
      // Whatever was drawn after the refusal was NOT taken: the haul is exactly what fit, in order,
      // and it stops at the first thing that did not.
      expect(h.found.length).toBeLessThan(unitsForPoints(h.offered));
      const room = 40 - 36;
      expect(h.found.reduce((n, id) => n + itemWeight(id), 0)).toBeLessThanOrEqual(room);
    }
    expect(sawRefusalEndIt).toBe(true);
    void graph;
  });

  it("standing still does not make the scout verb nag forever", () => {
    const { state, graph } = run(PLAIN, "still");
    // Look at everything within reach, then let the clock run past the memory window without moving.
    let s: GameState = { ...state, nodes: scoutFrom(state.nodes, graph, "node.x.a", SCOUT_HOPS, state.meta.day) };
    expect(ids(s, graph)).not.toContain("scout");
    s = { ...s, meta: { ...s.meta, day: s.meta.day + SCOUT_MEMORY_DAYS + 3 } };
    // Everything AROUND you has gone stale and is worth another look...
    expect(ids(s, graph)).toContain("scout");
    // ...but the node you are standing in never is, so it can never be the only reason the verb shows.
    const alone: GameState = {
      ...s,
      nodes: Object.fromEntries(Object.entries(s.nodes).map(([id, n]) =>
        [id, id === "node.x.a" ? n : { ...n, scouted: true, scoutedOn: s.meta.day }])) as GameState["nodes"],
    };
    expect(scoutIsFresh(alone.nodes["node.x.a"]!, alone.meta.day)).toBe(false);
    expect(ids(alone, graph)).not.toContain("scout");
  });

  it("nodesWithin is sorted, not merely in walk order", () => {
    // A star whose neighbours are declared out of alphabetical order: BFS insertion order and sorted
    // order differ, which the four-node line in the earlier test could not distinguish.
    const STAR: NodeDef[] = [
      { id: "node.x.m", regionId: "region.x", name: "M", description: "hub", adjacent: ["node.x.z", "node.x.a", "node.x.k"], start: true, kind: "store" },
      { id: "node.x.z", regionId: "region.x", name: "Z", description: "z", adjacent: ["node.x.m"], kind: "store" },
      { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.m"], kind: "store" },
      { id: "node.x.k", regionId: "region.x", name: "K", description: "k", adjacent: ["node.x.m"], kind: "store" },
    ];
    const { graph } = run(STAR, "star");
    expect(nodesWithin(graph, "node.x.m", 1)).toEqual(["node.x.a", "node.x.k", "node.x.m", "node.x.z"]);
  });

  it("the free-text note path is bounded and de-duplicated (the offered choices cannot reach these)", () => {
    const { state, graph } = run(PLAIN, "freetext");
    // Driven through `applyPlayerAction`, not `applyAction`: stage 1 rejects an action the Scene did
    // not offer, and `noteFor` stops offering at the same bound the cap enforces — so the cap is
    // unreachable through the full pipeline by construction. `applyPlayerAction` is public API a client
    // can drive directly, which is the case the cap actually guards.
    const note = (s: GameState, text: string): GameState =>
      applyPlayerAction(s, graph, { type: "note", choiceId: "note", timeCost: 0, params: { text } });
    // De-duplication: the same words twice is one note, however they arrive.
    let s = note(note(state, "the well is dry"), "the well is dry");
    expect(s.nodes["node.x.a"]!.playerNotes).toEqual(["the well is dry"]);
    // Trimming makes "  x  " and "x" the same note, so the dedupe cannot be walked around with spaces.
    s = note(s, "  the well is dry  ");
    expect(s.nodes["node.x.a"]!.playerNotes).toEqual(["the well is dry"]);
    // The cap: only the free-text path can reach it, and it holds.
    for (let i = 0; i < NOTE_MAX_PER_NODE + 5; i += 1) s = note(s, `line ${i}`);
    const notes = s.nodes["node.x.a"]!.playerNotes;
    expect(notes.length).toBe(NOTE_MAX_PER_NODE);
    expect(notes[notes.length - 1]).toBe(`line ${NOTE_MAX_PER_NODE + 4}`); // the newest survives
    expect(notes).not.toContain("the well is dry"); // ...and the oldest fell off
  });

  it("unitsForPoints is total: junk is nothing, not NaN", () => {
    for (const junk of [Number.NaN, undefined, null, "4"]) {
      expect(unitsForPoints(junk as unknown as number), String(junk)).toBe(0);
    }
    expect(unitsForPoints(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("`tieredOrdinary` keeps a row drawable even when the spread is wider than the table", () => {
    // No shipped table needs the `Math.max(1, …)` backstop (the test above proves every one normalises
    // with every row >= 1), so a mutant removing it survives on real content. This is the table that
    // needs it: one very common row against many very rare ones.
    const ids2 = ["item.scrap", "item.antibiotics", "item.blueprint.molotov", "item.blueprint.antibiotics"];
    const rows = tieredOrdinary(ids2);
    expect(rows.every((e: { weight: number }) => e.weight >= 1)).toBe(true);
    expect(rows.map((e: { value: string }) => e.value)).toEqual(ids2); // order preserved ⇒ deterministic
    // ...and the reason no SHIPPED table can need it, stated as the bound rather than as a hope: every
    // tiered weight sits in [min, max], so the smallest apportioned share of `n * BASE` is at least
    // `floor(min * n * BASE / (max * n))` = `floor(min * BASE / max)`, which is >= 1 while the spread
    // stays under BASE. A mutation run removing `Math.max(1, …)` therefore survives on real content,
    // and will go on surviving until a weight below that bound is authored — which is what it guards.
    const ws = Object.values(ITEM_LOOT_WEIGHT);
    const lo = Math.min(...ws);
    const hi = Math.max(...ws, 18);
    expect(Math.floor((lo * 18) / hi)).toBeGreaterThanOrEqual(1);
  });
});
