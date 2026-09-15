import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BASE_LOOT_WEIGHT,
  CLEAN_WATER_ITEM,
  DRINK_RELIEF,
  EAT_RELIEF,
  ITEM_LOOT_WEIGHT,
  PARTING_WOUNDS,
  profileOf,
  scaleInt,
  LOOT_CONTEST_DIVISOR,
  LOOT_POINTS_PER_ITEM,
  NEED_FATAL,
  RELIEF_OFFER_CEILING,
  REST_COST,
  REST_WOUND_CARE,
  SEARCH_COST,
  SEARCH_GAIN,
  WATER_LEVEL_NEUTRAL,
  WATER_POINTS_PER_UNIT,
  DEFAULT_REGION_WATER,
  REST_WOUND_CARE_MAX,
  WEAPONS,
  applyAction,
  resolveEconomyAction,
  workshopListing,
  availableActions,
  canDrink,
  canEat,
  craftable,
  drinkableWaterOf,
  itemLootWeight,
  lootEntriesFor,
  reliefOfferAt,
  resolveSearch,
  saveGame,
  loadGame,
  startRun,
  tickWeather,
  woundBurden,
  woundPlayer,
  type GameState,
  type NodeDef,
  type RecipeDef,
  type RegionDef,
  type RegionGraph,
  type WeaponDef,
  type WoundDef,
} from "../src/index.js";

/**
 * T59 — **balance pass 1: survivability & scarcity** (GDD XVI · PRODUCTION §8 · FR-SIM-08 · FR-ECO-05 ·
 * PL-M4-16/22/31/37/40/54 · PL-M5-27).
 *
 * A balance pass is mostly numbers, and numbers belong in `measure/t59.ts`, not in a test suite that
 * would then pin them against themselves (the T85 lesson: five of seven first-round mutation survivors
 * were tests asserting a constant against itself). What IS tested here is every **mechanism** the pass
 * added, and in each case the property rather than the magnitude:
 *
 *   1. **Water is a property of place.** `RegionState.water` and `world.water` had no reader anywhere
 *      in the engine — FR-SIM-08's water third was unimplemented. A district's authored water now
 *      scales exactly one loot row, the stock is finite and debited, and the mains follow the grid.
 *   2. **Purification left the workbench.** `recipe.purify.*` needs no room and no blueprint and its
 *      own content says "known from the start"; it was nevertheless unreachable outside a claimed base.
 *   3. **A relief is offered at its own value.** The flat threshold invited the player to pour away 38%
 *      of every canteen.
 *   4. **Stopping is worth something.** A deliberate rest applies wound care (GDD VI) — the Time corner
 *      of the Survival Triangle finally has a price to pay with. (The FR-INJ-04 reading lives in
 *      `wounds.test.ts`, where the requirement's own guardians are.)
 *
 * Plus the shape rule every M5 task carries: **no new save rung**. T59 adds no state at all.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 80, water: 50, survivorActivity: 20, threat: 10, zombieDensity: 0 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a yard", adjacent: ["node.x.a"], kind: "store", claimable: true },
];
const POOL: readonly WeaponDef[] = Object.values(WEAPONS);
const BOIL: RecipeDef = {
  id: "recipe.purify.boil", category: "purify", label: "Boil water",
  worldEffect: "boiled", inputs: [{ item: "item.fuel", qty: 1 }],
  purifyFrom: "item.water-dirty", purifyTo: "item.water", purifyUnitsPerCraft: 3, timeCost: 1,
};
const BENCHED: RecipeDef = {
  id: "recipe.survival.torch", category: "survival", label: "Torch",
  worldEffect: "lit", inputs: [{ item: "item.cloth", qty: 1 }], timeCost: 1,
};
const BITE: WoundDef = { id: "wound.bite", name: "Bite", description: "b", severity: 40, effect: "infect-risk" };

const run = (seed = "t59", recipes: readonly RecipeDef[] = []): { state: GameState; graph: RegionGraph } =>
  startRun({ seed, createdAt: "2026-09-15T00:00:00Z" }, REGIONS, NODES, [], [], [], [], recipes, [], [], POOL);

const withInv = (s: GameState, inv: [string, number][]): GameState =>
  ({ ...s, player: { ...s.player, inventory: inv.map(([type, quantity]) => ({ type, quantity })) } });

// --- 1. water is a property of place ------------------------------------------------------------

describe("water is a property of PLACE (T59 · FR-SIM-08 · GDD IV)", () => {
  it("drinkableWaterOf is the district's own table throttled by the city's mains", () => {
    expect(drinkableWaterOf({ water: 80 }, { water: 100 })).toBe(80);
    expect(drinkableWaterOf({ water: 80 }, { water: 50 })).toBe(40);
    expect(drinkableWaterOf({ water: 80 }, { water: 0 })).toBe(0);
    expect(drinkableWaterOf({ water: 0 }, { water: 100 })).toBe(0);
    // No world at all reads as full pressure, so a caller that has only a region is not punished for it.
    expect(drinkableWaterOf({ water: 45 }, undefined)).toBe(45);
  });

  it("is total about junk — a hand-edited save cannot put a NaN into a loot weight", () => {
    // T83 and T84 each shipped a NaN into the save and had it found by an audit. Both terms are clamped.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -40, 9999]) {
      const v = drinkableWaterOf({ water: bad }, { water: 100 });
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      const w = drinkableWaterOf({ water: 50 }, { water: bad });
      expect(Number.isInteger(w)).toBe(true);
    }
    expect(Number.isInteger(itemLootWeight(CLEAN_WATER_ITEM, Number.NaN))).toBe(true);
  });

  it("scales EXACTLY ONE loot row, and its absence is the exact pre-T59 lookup", () => {
    for (const id of Object.keys(ITEM_LOOT_WEIGHT)) {
      expect(itemLootWeight(id)).toBe(ITEM_LOOT_WEIGHT[id]);
      // With a level supplied, every row but the clean-water one is untouched.
      if (id !== CLEAN_WATER_ITEM) expect(itemLootWeight(id, 10)).toBe(ITEM_LOOT_WEIGHT[id]);
    }
    expect(itemLootWeight("item.not-a-real-item")).toBe(BASE_LOOT_WEIGHT);
    expect(itemLootWeight("item.not-a-real-item", 10)).toBe(BASE_LOOT_WEIGHT);
  });

  it("is linear in the district's level, reaches a real floor, and never falls below 1", () => {
    const base = ITEM_LOOT_WEIGHT[CLEAN_WATER_ITEM]!;
    expect(itemLootWeight(CLEAN_WATER_ITEM, WATER_LEVEL_NEUTRAL)).toBe(base);
    expect(itemLootWeight(CLEAN_WATER_ITEM, 100)).toBe(base * 2);
    // **The floor must ENGAGE.** A first cut used a compressed x0.5..x1.5 spread, so a district the
    // engine said was empty still weighted this row 24 — above the pre-T59 flat 18 — and 200 searches
    // at water 0 pulled 147 clean units out of nothing. The stock was decorative and the guard below
    // was dead code. This is the test that would have caught it.
    expect(itemLootWeight(CLEAN_WATER_ITEM, 0)).toBe(1);
    expect(itemLootWeight(CLEAN_WATER_ITEM, 1)).toBe(1);
    // Monotone, and a drunk-dry district still has a bottle in a drawer somewhere — a row that vanished
    // would change the table's SHAPE, which is the `floor(f*len)` hazard the pool gates exist for.
    let prev = 0;
    for (let level = 0; level <= 100; level += 1) {
      const w = itemLootWeight(CLEAN_WATER_ITEM, level);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    // ...and the START district reads at essentially the pre-T59 flat weight, which is what makes the
    // whole axis a redistribution rather than a nerf of the opening.
    expect(itemLootWeight(CLEAN_WATER_ITEM, 20)).toBeGreaterThanOrEqual(BASE_LOOT_WEIGHT);
  });

  it("a wetter district really does put more water in the table", () => {
    const dry = lootEntriesFor("store", false, true, 10);
    const wet = lootEntriesFor("store", false, true, 90);
    const share = (es: readonly { value: string; weight: number }[]): number => {
      const total = es.reduce((n, e) => n + e.weight, 0);
      return (es.find((e) => e.value === CLEAN_WATER_ITEM)?.weight ?? 0) / total;
    };
    expect(share(wet)).toBeGreaterThan(share(dry));
    // ...and the table still holds the same number of rows either way (shape unchanged, odds changed).
    expect(wet.length).toBe(dry.length);
  });

  it("a clean unit carried away DEBITS the district's water; a dirty one does not", () => {
    const { state } = run("t59-debit");
    let s: GameState = {
      ...state,
      nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 0 } },
      regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot: 90, water: 60 } },
      player: { ...state.player, inventory: [] },
    };
    let cleanTaken = 0;
    let dirtyTaken = 0;
    const startWater = s.regions["region.x"]!.water;
    for (let i = 0; i < 60; i += 1) {
      // `generic` is the kind whose economy table carries BOTH halves of the water pair.
      const haul = resolveSearch(s, "node.x.a", "generic", false, true, true, undefined);
      cleanTaken += haul.found.filter((f) => f === CLEAN_WATER_ITEM).length;
      dirtyTaken += haul.found.filter((f) => f === "item.water-dirty").length;
      s = { ...haul.state, nodes: { ...haul.state.nodes, "node.x.a": { ...haul.state.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...haul.state.regions, "region.x": { ...haul.state.regions["region.x"]!, loot: 90 } },
        player: { ...haul.state.player, inventory: [] } };
    }
    expect(cleanTaken, "the probe needs to have drawn some clean water at all").toBeGreaterThan(0);
    expect(dirtyTaken, "...and some dirty, so the asymmetry is what is under test").toBeGreaterThan(0);
    const spent = startWater - s.regions["region.x"]!.water;
    // Exactly the clean units, priced at WATER_POINTS_PER_UNIT — or the whole stock if it ran out first.
    expect(spent).toBe(Math.min(startWater, cleanTaken * WATER_POINTS_PER_UNIT));
    expect(s.regions["region.x"]!.water).toBeGreaterThanOrEqual(0);
  });

  it("the mains follow the grid: world.water falls exactly as world.powerGrid does", () => {
    const { state } = run("t59-mains");
    // A storm is the heaviest powerPressure in the table; 24 hours of it moves both dials together.
    const stormy: GameState = { ...state, world: { ...state.world, weather: "weather.storm", powerGrid: 100, water: 100 } };
    let s = stormy;
    for (let i = 0; i < 12; i += 1) s = tickWeather(s, 2);
    expect(s.world.powerGrid).toBeLessThan(100);
    expect(100 - s.world.water).toBe(100 - s.world.powerGrid);
    expect(s.world.water).toBeGreaterThanOrEqual(0);
  });

  it("a fair-weather run moves neither — the taps fail because the power does, not because time passes", () => {
    const { state } = run("t59-clear");
    let s: GameState = { ...state, world: { ...state.world, weather: "weather.clear", powerGrid: 100, water: 100 } };
    for (let i = 0; i < 12; i += 1) s = tickWeather(s, 2);
    expect(s.world.powerGrid).toBe(100);
    expect(s.world.water).toBe(100);
  });

  it("adds NO state: a save round-trips and every numeric leaf is still an integer", () => {
    const { state, graph } = run("t59-save");
    let s = state;
    for (let i = 0; i < 6; i += 1) {
      const c = availableActions(s, graph).find((x) => x.id === "search");
      if (c === undefined) break;
      s = applyAction(s, c.action, graph).state;
    }
    expect(loadGame(saveGame(s))).toStrictEqual(s);
    for (const r of Object.values(s.regions)) {
      expect(Number.isInteger(r.water)).toBe(true);
      expect(Number.isInteger(r.loot)).toBe(true);
    }
    expect(Number.isInteger(s.world.water)).toBe(true);
  });
});

// --- 2. purification left the workbench ---------------------------------------------------------

describe("purification is field work, every other recipe is bench work (T59 · FR-ECO-05 · GDD X)", () => {
  it("a purify recipe is craftable away from any shelter, with the parts and something to purify", () => {
    const { state, graph } = run("t59-purify", [BOIL, BENCHED]);
    const packed = withInv(state, [["item.fuel", 1], ["item.water-dirty", 2], ["item.cloth", 1]]);
    expect(packed.player.shelterId).toBeNull();
    expect(craftable(packed, graph, BOIL)).toBe(true);
    // ...and it is genuinely offered, not merely permitted by the predicate (the T87 lesson: the module
    // being right is not the wiring being right).
    expect(availableActions(packed, graph).some((c) => c.id === `purify:${BOIL.id}`)).toBe(true);
  });

  it("every other category still needs the bench — the exemption is exactly one word wide", () => {
    const { state, graph } = run("t59-bench", [BOIL, BENCHED]);
    const packed = withInv(state, [["item.fuel", 1], ["item.water-dirty", 2], ["item.cloth", 1]]);
    expect(craftable(packed, graph, BENCHED)).toBe(false);
    expect(availableActions(packed, graph).some((c) => c.id.startsWith("craft:"))).toBe(false);
  });

  it("the other gates are untouched: no dirty water, no parts, no pool ⇒ no purify", () => {
    const { state, graph } = run("t59-gates", [BOIL]);
    expect(craftable(withInv(state, [["item.fuel", 1]]), graph, BOIL)).toBe(false);          // nothing to purify
    expect(craftable(withInv(state, [["item.water-dirty", 2]]), graph, BOIL)).toBe(false);   // no fuel
    const { state: bare, graph: bareGraph } = run("t59-gates");                              // no recipe pool at all
    expect(craftable(withInv(bare, [["item.fuel", 1], ["item.water-dirty", 2]]), bareGraph, BOIL)).toBe(false);
  });
});

// --- 3. a relief is offered at its own value ----------------------------------------------------

describe("a relief is offered at its own value (T59 · ACCESSIBILITY §6 · GDD XVI)", () => {
  it("taking the offer the moment it appears wastes nothing", () => {
    expect(reliefOfferAt(DRINK_RELIEF)).toBe(DRINK_RELIEF);
    expect(reliefOfferAt(EAT_RELIEF)).toBe(EAT_RELIEF);
    const { state } = run("t59-offer");
    const brink = withInv({ ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { ...state.player.condition.needs, thirst: DRINK_RELIEF } } } }, [["item.water", 1]]);
    expect(canDrink(brink)).toBe(true);
    const short = { ...brink, player: { ...brink.player, condition: { ...brink.player.condition, needs: { ...brink.player.condition.needs, thirst: DRINK_RELIEF - 1 } } } };
    expect(canDrink(short)).toBe(false);
  });

  it("the ceiling keeps a future relief from pushing the prompt into the last hours of a life", () => {
    expect(reliefOfferAt(9999)).toBe(RELIEF_OFFER_CEILING);
    expect(RELIEF_OFFER_CEILING).toBeLessThan(NEED_FATAL);
  });

  it("the threshold is an integer in [1, CEILING] for any relief, junk included", () => {
    // Named explicitly rather than left to the generator: a mutation run showed `fc.double` was not
    // reliably producing NaN, so dropping the finite guard SURVIVED a property test that claimed to
    // cover it. The interesting inputs are a short list; write the list.
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5, 0.4, 1e309]) {
      const v = reliefOfferAt(junk);
      expect(Number.isInteger(v), `reliefOfferAt(${String(junk)})`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(RELIEF_OFFER_CEILING);
    }
    fc.assert(fc.property(fc.double({ noNaN: false, noDefaultInfinity: false }), (r) => {
      const v = reliefOfferAt(r);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(RELIEF_OFFER_CEILING);
    }));
  });
});

// --- 4. stopping is worth something -------------------------------------------------------------

describe("a deliberate rest is care (T59 · GDD VI 'restored by treatment and rest')", () => {
  it("the Time corner of the Survival Triangle now has a price to pay with", () => {
    const { state, graph } = run("t59-rest");
    const hurt = woundPlayer(state, BITE, "calf");
    const before = woundBurden(hurt.player.condition);
    const rest = availableActions(hurt, graph).find((c) => c.id === "rest")!;
    const after = applyAction(hurt, rest.action, graph).state;
    expect(before - woundBurden(after.player.condition)).toBe(REST_WOUND_CARE * REST_COST);
    // ...and it is not free: the hours it spent are the hours every other clock is denominated in.
    expect(after.player.condition.needs.thirst).toBeGreaterThan(hurt.player.condition.needs.thirst);
    expect(after.player.condition.needs.hunger).toBeGreaterThan(hurt.player.condition.needs.hunger);
  });

  it("an unhurt rest is inert on the wound list, and a rest cannot drive a wound negative", () => {
    const { state, graph } = run("t59-rest2");
    const rest = availableActions(state, graph).find((c) => c.id === "rest")!;
    expect(applyAction(state, rest.action, graph).state.player.condition.wounds).toEqual([]);
    let s = woundPlayer(state, BITE, "calf");
    for (let i = 0; i < 40; i += 1) {
      const c = availableActions(s, graph).find((x) => x.id === "rest");
      if (c === undefined) break;
      s = applyAction(s, c.action, graph).state;
      for (const w of s.player.condition.wounds) {
        expect(w.treated).toBeLessThanOrEqual(w.severity);
        expect(woundBurden(s.player.condition)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(woundBurden(s.player.condition)).toBe(0); // enough hours of lying still closes it
  });
});

// --- 5. what the adversarial audit found, each with the test that would have caught it ----------

/**
 * Every case below reproduces a defect a T59 audit found in the first cut. Each was checked against the
 * pre-fix tree (`/root/zb-unfixed`) and fails there — the nine-task-old T77 rule: **an audit fix still
 * needs its own test, and the test is only worth anything if it was run against the unfixed code.**
 */
describe("T59 audit fixes", () => {
  it("the district water STOCK is not decorative: a drunk-dry district pays a trickle, not a flood", () => {
    // Pre-fix: the compressed spread floored the weight at 24 — ABOVE the pre-T59 flat 18 — so 200
    // searches at `region.water: 0` pulled 147 clean units out of a stock the engine said was empty.
    expect(itemLootWeight(CLEAN_WATER_ITEM, 0)).toBe(1);
    const { state } = run("t59-dry");
    let s: GameState = {
      ...state,
      regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot: 90, water: 0 } },
      player: { ...state.player, inventory: [] },
    };
    let clean = 0;
    let items = 0;
    for (let i = 0; i < 120; i += 1) {
      const haul = resolveSearch(s, "node.x.a", "generic", false, true, true, undefined);
      clean += haul.found.filter((f) => f === CLEAN_WATER_ITEM).length;
      items += haul.found.length;
      s = { ...haul.state, nodes: { ...haul.state.nodes, "node.x.a": { ...haul.state.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...haul.state.regions, "region.x": { ...haul.state.regions["region.x"]!, loot: 90, water: 0 } },
        player: { ...haul.state.player, inventory: [] } };
    }
    expect(items).toBeGreaterThan(100); // the probe really did search
    // A trickle: comfortably under a twentieth of the haul, where the pre-fix build ran at an eighth.
    expect(clean / items).toBeLessThan(0.05);
  });

  it("the region.water DEBIT is total about junk — a NaN cannot reach the save", () => {
    // Pre-fix: the debit used the module's non-total `clampPct`, four lines under a comment saying not
    // to. `clampPct(NaN)` is NaN, it serialises as `null`, and the save no longer round-trips.
    const { state } = run("t59-nan");
    let s: GameState = {
      ...state,
      regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot: 90, water: Number.NaN } },
      player: { ...state.player, inventory: [] },
    };
    for (let i = 0; i < 40; i += 1) {
      const haul = resolveSearch(s, "node.x.a", "generic", false, true, true, undefined);
      s = { ...haul.state, nodes: { ...haul.state.nodes, "node.x.a": { ...haul.state.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...haul.state.regions, "region.x": { ...haul.state.regions["region.x"]!, loot: 90 } },
        player: { ...haul.state.player, inventory: [] } };
    }
    expect(Number.isInteger(s.regions["region.x"]!.water)).toBe(true);
    expect(loadGame(saveGame(s))).toStrictEqual(s);
  });

  it("ONE stop applies at most one rest's worth of care — a night's sleep is not surgery", () => {
    // Pre-fix: the dial was swept for a 4-hour rest (16) and applied per hour to every stop, so a
    // 9-hour sleep gave 36 — 1.44x the best wound-specific medical item — free, every night.
    // `TREAT_CARE` (a wound-specific medical item) is 25 — the cap must stay under it, or stopping is
    // strictly better medicine than medicine.
    expect(REST_WOUND_CARE_MAX).toBeLessThan(25);
    const { state, graph } = run("t59-cap");
    const hurt = woundPlayer(state, BITE, "calf");
    for (const hours of [1, 4, 8, 9, 24]) {
      const after = applyAction(hurt, { type: "rest", timeCost: hours }, graph).state;
      const applied = woundBurden(hurt.player.condition) - woundBurden(after.player.condition);
      expect(applied).toBeLessThanOrEqual(REST_WOUND_CARE_MAX);
      expect(applied).toBe(Math.min(REST_WOUND_CARE * hours, REST_WOUND_CARE_MAX));
    }
  });

  it("a FORGED craft cannot ride a benchless purify recipe across the map", () => {
    // Pre-fix: `{type:"craft", choiceId:"purify:recipe.purify.boil"}` was accepted anywhere, burned the
    // fuel, purified nothing and wrote a `craft.done` beat into the append-only Living History. T87's
    // forged-action finding in a smaller key; the fix re-derives the verb from the recipe's category.
    const { state, graph } = run("t59-forge", [BOIL, BENCHED]);
    const packed = withInv(state, [["item.fuel", 2], ["item.water-dirty", 2]]);
    const forged = resolveEconomyAction(packed, graph, {
      type: "craft", choiceId: `purify:${BOIL.id}`, timeCost: 1, params: { recipe: BOIL.id },
    });
    expect(forged).toBe(packed); // refused, and refused by identity — nothing was spent
    // ...and the honest verb still works, so the guard is not simply "refuse everything".
    expect(resolveEconomyAction(packed, graph, {
      type: "purify", choiceId: `purify:${BOIL.id}`, timeCost: 1, params: { recipe: BOIL.id },
    })).not.toBe(packed);
    // The mirror case: a purify verb aimed at a bench recipe is refused too.
    expect(resolveEconomyAction(withInv(packed, [["item.cloth", 2]]), graph, {
      type: "purify", choiceId: `craft:${BENCHED.id}`, timeCost: 1, params: { recipe: BENCHED.id },
    })).toStrictEqual(withInv(packed, [["item.cloth", 2]]));
  });

  it("the workshop listing STATES the shortfall for a field recipe, off the bench", () => {
    // Pre-fix: `workshopListing` was bench-only, so the two recipes T59 put in the player's hands were
    // the only two whose "needs: charcoal x1 · cloth x1" could never be shown (ACCESSIBILITY §6).
    const { state, graph } = run("t59-listing", [BOIL, BENCHED]);
    const short = withInv(state, [["item.water-dirty", 1]]); // dirty water, no fuel
    const rows = workshopListing(short, graph);
    expect(rows.map((r) => r.recipe.id)).toEqual([BOIL.id]);   // the bench recipe is not listed in the field
    expect(rows[0]!.craftable).toBe(false);
    expect(rows[0]!.missing.map((m) => m.item)).toEqual(["item.fuel"]);
    // With no recipe pool at all it is still empty.
    expect(workshopListing(short, run("t59-listing").graph)).toEqual([]);
  });

  it("the offer threshold follows the relief a run will ACTUALLY apply, not the constant", () => {
    // Pre-fix: the threshold used the raw constant while `drink` applies `scaleInt(relief, needRelief)`,
    // so Story poured 22.5% of the canteen away and Nightmare withheld the prompt for 17 points of
    // thirst it did not need to be withheld for — a survivability regression, in the survivability pass.
    const at = (mode: "story" | "survivor" | "nightmare", thirst: number): boolean => {
      const { state } = startRun({ seed: "t59-dial", createdAt: "2026-09-15T00:00:00Z", difficulty: mode }, REGIONS, NODES);
      return canDrink(withInv({ ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { ...state.player.condition.needs, thirst } } } }, [["item.water", 1]]));
    };
    // The magnitudes are READ from the profile, not written out here. T60 retuned `needRelief` (Story
    // 1.3 -> 1.5, Nightmare 0.7 -> 0.5) and a version of this test with the numbers inlined failed —
    // correctly in the letter and wrongly in the spirit, because the claim is "the threshold follows
    // the dial", not "the dial is 1.3". PL-M4-53 says every non-identity magnitude is provisional until
    // the M5 passes settle it, so a balance test that hard-codes one is a tripwire on the wrong wire.
    const scaled = (mode: "story" | "survivor" | "nightmare", base: number): number => {
      const { state } = startRun({ seed: "t59-dial", createdAt: "2026-09-15T00:00:00Z", difficulty: mode }, REGIONS, NODES);
      return scaleInt(base, profileOf(state).needRelief);
    };
    // Story's ration buys back MORE, so the prompt has to wait longer, not less.
    expect(scaled("story", DRINK_RELIEF)).toBeGreaterThan(DRINK_RELIEF);
    expect(at("story", DRINK_RELIEF)).toBe(false);
    expect(at("story", scaled("story", DRINK_RELIEF))).toBe(true);
    // Nightmare's buys back less, so the prompt comes EARLIER.
    expect(scaled("nightmare", DRINK_RELIEF)).toBeLessThan(DRINK_RELIEF);
    expect(at("nightmare", scaled("nightmare", DRINK_RELIEF))).toBe(true);
    expect(at("survivor", DRINK_RELIEF)).toBe(true);
    expect(at("survivor", DRINK_RELIEF - 1)).toBe(false);

    // ...and the same for FOOD, which a first cut of this test left uncovered — a mutation run then
    // showed `canEat` could drop the dial entirely and survive. Test both halves of a pair.
    const ate = (mode: "story" | "survivor" | "nightmare", hunger: number): boolean => {
      const { state } = startRun({ seed: "t59-dial", createdAt: "2026-09-15T00:00:00Z", difficulty: mode }, REGIONS, NODES);
      return canEat(withInv({ ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { ...state.player.condition.needs, hunger } } } }, [["item.canned-food", 1]]));
    };
    expect(ate("story", EAT_RELIEF)).toBe(false);
    expect(ate("story", scaled("story", EAT_RELIEF))).toBe(true);
    expect(ate("nightmare", scaled("nightmare", EAT_RELIEF))).toBe(true);
    expect(ate("survivor", EAT_RELIEF)).toBe(true);
    expect(ate("survivor", EAT_RELIEF - 1)).toBe(false);
  });

  it("a region that authors no water is an ORDINARY district, not a desert", () => {
    // Pre-fix: `pct(b.water, 0)` — harmless while nothing read the field, a silent declaration the
    // moment something did. Every unauthored fixture would have had its clean-water weight floored.
    const bare: RegionDef[] = [{ id: "region.y", name: "Y", description: "y" }];
    const nodes: NodeDef[] = [{ id: "node.y.a", regionId: "region.y", name: "A", description: "a", adjacent: [], start: true }];
    const { state } = startRun({ seed: "t59-bare", createdAt: "2026-09-15T00:00:00Z" }, bare, nodes);
    expect(state.regions["region.y"]!.water).toBe(DEFAULT_REGION_WATER);
    expect(itemLootWeight(CLEAN_WATER_ITEM, drinkableWaterOf(state.regions["region.y"]!, state.world)))
      .toBe(ITEM_LOOT_WEIGHT[CLEAN_WATER_ITEM]);
  });

  it("PL-M5-27: a parting blow bites one time in FOUR, and its table is not the fight's", () => {
    /**
     * Two mutants survived the first cut of this file: swapping `PARTING_WOUNDS` for `WALKER_WOUNDS` at
     * the slip site, and halving the table back to one-in-two. PL-M5-27 is the whole point of that
     * change and it had NO test. Both a structural claim and a played one, because either alone lets
     * one of those two mutants through.
     */
    expect(PARTING_WOUNDS.filter((w) => w.type === "wound.bite").length).toBe(1);
    expect(PARTING_WOUNDS.length).toBe(4);
    // ...and it is a DIFFERENT table from the one a chosen fight draws from — `sim/overrun.ts` set the
    // precedent that these three situations are three different risks.
    expect(PARTING_WOUNDS.filter((w) => w.type === "wound.bite").length / PARTING_WOUNDS.length).toBeLessThan(0.5);

    // Played: slip away from a contested node across many seeds and count what the parting blow leaves.
    let bites = 0;
    let wounds = 0;
    for (let seed = 0; seed < 220; seed += 1) {
      const { state, graph } = run(`t59-slip-${seed}`);
      const contested: GameState = {
        ...state,
        nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, walkers: 2, zombieState: "chasing" } },
      };
      const slip = availableActions(contested, graph).find((c) => c.id.startsWith("slip:"));
      if (slip === undefined) continue;
      const after = applyAction(contested, slip.action, graph).state;
      for (const w of after.player.condition.wounds) {
        wounds += 1;
        if (w.type === "wound.bite") bites += 1;
      }
    }
    expect(wounds, "the probe must actually take some parting blows").toBeGreaterThan(30);
    // A quarter, not a half. The band is wide enough to be stable and narrow enough to separate the two.
    expect(bites / wounds).toBeLessThan(0.4);
  });

  it("a WATER-ONLY change is not lost: the world reference must change when only the mains move", () => {
    // A mutation run dropped `water === state.world.water` from the identity check and survived — the
    // seam, not the function. Reachable whenever the grid has already bottomed out and the mains have
    // not: from there the only thing a tick can move is the water, and a stale reference eats it.
    // The discriminating tick is a narrow one and has to be constructed, not stumbled into: the grid
    // already at 0 (so `powerGrid` cannot change), the drain clock at 0 and exactly one period of
    // pressure in the tick (so `rest` returns to 0 and `powerClockMoved` is false), and the weather
    // NOT shifting (a shift rebuilds the world object and hides the bug). A first cut ticked six times
    // and let the weather wander, and the mutant survived it.
    let checked = 0;
    for (let seed = 0; seed < 200 && checked < 5; seed += 1) {
      const { state } = run(`t59-wateronly-${seed}`);
      // SNOW, not a storm: pressure 1 on both dials, so a 6-hour tick banks exactly one period of each
      // and both `rest` values return to 0. A storm's roadPressure 2 leaves a road remainder every
      // single tick, which rebuilds the world for another reason and hides the bug — a first cut used a
      // storm and the mutant survived it.
      const pinned: GameState = { ...state, world: { ...state.world, weather: "weather.snow", powerGrid: 0, water: 60, powerDrainHours: 0, roadDrainHours: 0 } };
      const after = tickWeather(pinned, 6);
      if (after.world.weather !== "weather.snow") continue; // the weather moved; not the case under test
      expect(after.world.powerDrainHours ?? 0).toBe(0); // ...and neither clock moved, which is the point
      expect(after.world.roadDrainHours ?? 0).toBe(0);
      checked += 1;
      expect(after.world.powerGrid).toBe(0); // nothing left to take from the grid
      expect(after.world.water).toBe(59);    // ...and the mains still fell, by exactly the banked point
      expect(after.world).not.toBe(pinned.world);
    }
    expect(checked, "no seed produced a stable-weather storm tick — the probe found nothing to test").toBeGreaterThan(0);
  });

  it("a district's AUTHORED water is what it yields — not every district the same", () => {
    // A mutation run replaced `pct(b.water, DEFAULT)` with the bare default and survived: the test
    // covered the unauthored case and not the authored one, so the whole geography could go flat.
    const many: RegionDef[] = [
      { id: "region.dry", name: "Dry", description: "d", baseline: { water: 10 }, adjacent: ["region.wet"] },
      { id: "region.wet", name: "Wet", description: "w", baseline: { water: 90 }, adjacent: ["region.dry"] },
    ];
    const nodes: NodeDef[] = [
      { id: "node.dry.a", regionId: "region.dry", name: "A", description: "a", adjacent: ["node.wet.a"], start: true },
      { id: "node.wet.a", regionId: "region.wet", name: "B", description: "b", adjacent: ["node.dry.a"] },
    ];
    const { state } = startRun({ seed: "t59-authored", createdAt: "2026-09-15T00:00:00Z" }, many, nodes);
    expect(state.regions["region.dry"]!.water).toBe(10);
    expect(state.regions["region.wet"]!.water).toBe(90);
    const w = (id: string): number => itemLootWeight(CLEAN_WATER_ITEM, drinkableWaterOf(state.regions[id]!, state.world));
    expect(w("region.wet")).toBeGreaterThan(w("region.dry"));
  });

  it("the mains fall with the grid and NEVER come back — a generator is not a pumping station", () => {
    // Pre-fix: the comment claimed "a run in which the grid never fails is a run in which the taps never
    // fail either", which `job.generator` (holdsPower) makes exactly backwards. The drain is monotone.
    const { state } = run("t59-monotone");
    let s: GameState = { ...state, world: { ...state.world, weather: "weather.storm", powerGrid: 100, water: 100 } };
    for (let i = 0; i < 12; i += 1) s = tickWeather(s, 2);
    const dropped = s.world.water;
    expect(dropped).toBeLessThan(100);
    // Hand the grid back to full — a generator's whole effect — and tick a clear day. Water must not rise.
    let restored: GameState = { ...s, world: { ...s.world, powerGrid: 100, weather: "weather.clear" } };
    for (let i = 0; i < 12; i += 1) restored = tickWeather(restored, 2);
    expect(restored.world.water).toBe(dropped);
    // ...and the grid really did move, so the probe is not vacuous.
    expect(restored.world.powerGrid).toBe(100);
  });
});

// --- 6. the dials this pass moved are, at least, coherent with one another ----------------------

describe("the pass's dials hold together (T59)", () => {
  it("a node still takes SIX in-game hours to strip clean, in six searches rather than three", () => {
    expect(Math.ceil(100 / SEARCH_GAIN) * SEARCH_COST).toBe(6);
  });

  it("the whole city's drinkable stock is finite and knowable", () => {
    // 6 shipped districts, but this fixture has one: the property is that the stock is bounded by the
    // authored water and priced in whole units, so "the city holds N days of water" is a real sentence.
    const { state } = run("t59-stock");
    const points = Object.values(state.regions).reduce((n, r) => n + r.water, 0);
    expect(points).toBe(REGIONS[0]!.baseline!.water);
    expect(Math.floor(points / WATER_POINTS_PER_UNIT)).toBeGreaterThan(0);
  });

  it("the scarcity constants are integers — ADR-0001, and a divisor that is not is a silent float", () => {
    for (const n of [LOOT_CONTEST_DIVISOR, LOOT_POINTS_PER_ITEM, WATER_POINTS_PER_UNIT, WATER_LEVEL_NEUTRAL, REST_WOUND_CARE, SEARCH_GAIN, SEARCH_COST, RELIEF_OFFER_CEILING]) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });
});
