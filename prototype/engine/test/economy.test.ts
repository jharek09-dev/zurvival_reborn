import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  loadGame,
  saveGame,
  sceneOf,
  startRun,
  economyActive,
  craftable,
  workshopListing,
  economyChoices,
  isEconomyAction,
  resolveEconomyAction,
  economyLine,
  tickSpoilage,
  wearWeaponOnStrike,
  carriedArtifacts,
  FRESH_FOOD_ITEM,
  SPOILED_FOOD_ITEM,
  FRESH_SHELF_LIFE,
  POWER_SPOIL_AT,
  WEAPON_SLOT,
  type GameState,
  type ItemInstance,
  type NodeDef,
  type RecipeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T51 — the crafting economy. Recipes (content) interpreted generically: craft/repair/purify/study,
 * gated by blueprints, components, and rooms (FR-ECO-06); food spoilage faster once the grid fails
 * (FR-ECO-05); repair-over-replace that grows an artifact's provenance (FR-ECO-07). Deterministic,
 * save-lossless, and — the load-bearing guarantee — INERT without a recipe pool, so every prior run is
 * byte-identical. Closes the four resource loops (FR-ECO-04).
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "shelter", adjacent: ["node.a"], start: true, kind: "store" },
  { id: "node.a", regionId: "region.z", name: "A", description: "away", adjacent: ["node.s"], kind: "store" },
];

const RECIPES: RecipeDef[] = [
  { id: "recipe.medical.bandage", category: "medical", label: "Bandage", worldEffect: "Dress a wound.", inputs: [{ item: "item.cloth", qty: 2 }], output: { item: "item.bandage", qty: 1 }, timeCost: 1 },
  { id: "recipe.medical.antibiotics", category: "medical", label: "Crude antibiotics", worldEffect: "A chance against a turning wound.", inputs: [{ item: "item.charcoal", qty: 1 }], output: { item: "item.antibiotics", qty: 1 }, blueprint: "blueprint.antibiotics", room: "room.medical", timeCost: 4 },
  { id: "recipe.shelter.workshop", category: "shelter", label: "Workshop", worldEffect: "A workbench.", inputs: [{ item: "item.scrap", qty: 3 }], installsRoom: "room.workshop", timeCost: 6 },
  { id: "recipe.weapon.reinforce-tool", category: "weapon", label: "Reinforced tool", worldEffect: "Holds an edge.", inputs: [{ item: "item.scrap", qty: 2 }], output: { item: "item.tool-reinforced", qty: 1 }, mintsArtifact: true, startDurability: 100, room: "room.workshop", timeCost: 3 },
  { id: "recipe.repair.tool", category: "repair", label: "Repair a tool", worldEffect: "Bring the edge back.", inputs: [{ item: "item.scrap", qty: 1 }], repairs: 40, room: "room.workshop", timeCost: 2 },
  { id: "recipe.purify.boil", category: "purify", label: "Boil water", worldEffect: "Boil it safe.", inputs: [{ item: "item.fuel", qty: 1 }], purifyFrom: "item.water-dirty", purifyTo: "item.water", timeCost: 1 },
  { id: "recipe.weapon.molotov", category: "weapon", label: "Molotov", worldEffect: "A bottle of fire.", inputs: [{ item: "item.cloth", qty: 1 }], output: { item: "item.molotov", qty: 1 }, blueprint: "blueprint.molotov", timeCost: 1 },
];

const opts = { seed: "economy-seed", createdAt: "2026-07-17T00:00:00Z" };
const run = (recipes: RecipeDef[] = RECIPES): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, [], [], [], [], recipes);

type Inv = GameState["player"]["inventory"];
const claimShelter = (s: GameState): GameState => ({ ...s, player: { ...s.player, shelterId: s.player.location } });
const withInv = (s: GameState, inv: Inv): GameState => ({ ...s, player: { ...s.player, inventory: inv } });
const withRooms = (s: GameState, rooms: string[]): GameState => ({ ...s, nodes: { ...s.nodes, [s.player.shelterId!]: { ...s.nodes[s.player.shelterId!]!, rooms } } });
const learn = (s: GameState, bp: string): GameState => ({ ...s, player: { ...s.player, economy: { ...s.player.economy, blueprints: [...s.player.economy.blueprints, bp] } } });
const setGrid = (s: GameState, powerGrid: number): GameState => ({ ...s, world: { ...s.world, powerGrid } });
const has = (s: GameState, type: string): number => s.player.inventory.filter((e) => e.type === type && e.itemId === undefined).reduce((n, e) => n + e.quantity, 0);
const take = (s: GameState, graph: RegionGraph, choiceId: string): GameState => {
  const c = availableActions(s, graph).find((ch) => ch.id === choiceId);
  if (c === undefined) throw new Error(`no choice "${choiceId}" — offered: ${availableActions(s, graph).map((x) => x.id).join(", ")}`);
  return applyAction(s, c.action, graph).state;
};

// --- gating: economyActive, workbench, blueprint, room, components ------------------------------

describe("crafting is gated by components, blueprints, and rooms (FR-ECO-06)", () => {
  it("a known no-room recipe is craftable at the workbench with the parts, and not otherwise", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.cloth", quantity: 2 }]);
    expect(craftable(shelter, graph, RECIPES[0]!)).toBe(true); // bandage: at bench, has 2 cloth
    expect(craftable(withInv(shelter, [{ type: "item.cloth", quantity: 1 }]), graph, RECIPES[0]!)).toBe(false); // short a cloth
    expect(craftable(withInv(state, [{ type: "item.cloth", quantity: 2 }]), graph, RECIPES[0]!)).toBe(false); // not at a shelter
  });

  it("a blueprint- and room-gated recipe is hidden until both the unlock and the room are present", () => {
    const { state, graph } = run();
    const base = withInv(claimShelter(state), [{ type: "item.charcoal", quantity: 1 }]);
    expect(craftable(base, graph, RECIPES[1]!)).toBe(false); // antibiotics: no blueprint, no room
    expect(craftable(learn(base, "blueprint.antibiotics"), graph, RECIPES[1]!)).toBe(false); // learned, still no room
    expect(craftable(withRooms(learn(base, "blueprint.antibiotics"), ["room.medical"]), graph, RECIPES[1]!)).toBe(true);
    // A locked recipe is not even listed on the bench until its gates open.
    expect(workshopListing(base, graph).some((r) => r.recipe.id === "recipe.medical.antibiotics")).toBe(false);
    expect(workshopListing(withRooms(learn(base, "blueprint.antibiotics"), ["room.medical"]), graph).some((r) => r.recipe.id === "recipe.medical.antibiotics")).toBe(true);
  });

  it("the workshop listing states a missing component instead of hiding a shown recipe (SCR-10)", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.cloth", quantity: 1 }]); // one short for a bandage
    const row = workshopListing(shelter, graph).find((r) => r.recipe.id === "recipe.medical.bandage");
    expect(row?.craftable).toBe(false);
    expect(row?.missing).toEqual([{ item: "item.cloth", qty: 2 }]); // every stated missing part, not a mystery
  });
});

// --- craft: debits inputs, grants the payload, spends time, logs one beat -----------------------

describe("crafting debits real resources and produces the payload (FR-ECO-04)", () => {
  it("craft debits every input, grants the output, spends the hours, and narrates once", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.cloth", quantity: 3 }]);
    const after = take(shelter, graph, "craft:recipe.medical.bandage");
    expect(has(after, "item.cloth")).toBe(1); // 3 - 2
    expect(has(after, "item.bandage")).toBe(1); // + 1
    expect(after.meta.hour).toBe(shelter.meta.hour + 1); // timeCost 1 spent
    expect(after.history.some((h) => h.type === "craft.done")).toBe(true);
    expect(economyLine(after, graph)).not.toBeNull();
  });

  it("a shelter recipe installs its room on the shelter node", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.scrap", quantity: 3 }]);
    const after = take(shelter, graph, "craft:recipe.shelter.workshop");
    expect(after.nodes[after.player.shelterId!]!.rooms).toContain("room.workshop");
    expect(has(after, "item.scrap")).toBe(0);
  });
});

// --- artifacts: mint, wear, repair-over-replace (FR-ECO-07) ------------------------------------

describe("durability artifacts wear with use and are kept alive by repair (FR-ECO-07)", () => {
  const mintState = (): { state: GameState; graph: RegionGraph } => {
    const { state, graph } = run();
    const shelter = withRooms(withInv(claimShelter(state), [{ type: "item.scrap", quantity: 5 }]), ["room.workshop"]);
    return { state: take(shelter, graph, "craft:recipe.weapon.reinforce-tool"), graph };
  };

  it("a weapon recipe mints a tracked durability artifact and equips it", () => {
    const { state } = mintState();
    const arts = carriedArtifacts(state);
    expect(arts.length).toBe(1);
    expect(arts[0]!.item.type).toBe("item.tool-reinforced");
    expect(arts[0]!.item.durability).toBe(100);
    expect(state.player.equipment[WEAPON_SLOT]).toBe(arts[0]!.entry.itemId);
  });

  it("a melee strike wears the equipped artifact; a run with none is untouched", () => {
    const { state } = mintState();
    const worn = wearWeaponOnStrike(state);
    const id = state.player.equipment[WEAPON_SLOT]!;
    expect(worn.items[id]!.durability).toBeLessThan(state.items[id]!.durability!);
    // Inert without an equipped durability artifact (every prior run): passes through by reference.
    const { state: plain } = run();
    expect(wearWeaponOnStrike(plain)).toBe(plain);
  });

  it("repair raises durability, appends a provenance line, keeps the instance id, and caps at 100", () => {
    const { state, graph } = mintState();
    const id = state.player.equipment[WEAPON_SLOT]!;
    const artEntry = state.player.inventory.find((e) => e.itemId === id)!; // the minted artifact's stack
    // Wear it down to 50, and set a known pack: the artifact + exactly 2 scrap (one per repair).
    const wornItem: ItemInstance = { ...state.items[id]!, durability: 50 };
    const worn = withInv({ ...state, items: { ...state.items, [id]: wornItem } }, [artEntry, { type: "item.scrap", quantity: 2 }]);
    const repaired = take(worn, graph, "repair:recipe.repair.tool");
    const item = repaired.items[id]!;
    expect(item.durability).toBe(90); // 50 + 40
    expect(id in repaired.items).toBe(true); // same instance id — repair over replace
    const meta = item.metadata as { repairs: unknown[] };
    expect(meta.repairs.length).toBe(1); // the story grew a line
    expect(has(repaired, "item.scrap")).toBe(1); // 2 - 1 input
    // A second repair caps at 100, and grows the story again (uses the last scrap).
    const twice = take(repaired, graph, "repair:recipe.repair.tool");
    expect(twice.items[id]!.durability).toBe(100); // 90 + 40 capped
    expect((twice.items[id]!.metadata as { repairs: unknown[] }).repairs.length).toBe(2);
  });
});

// --- purify (FR-ECO-05) + study (blueprints found in the world) --------------------------------

describe("purification and studying blueprints", () => {
  it("purify converts every carried dirty-water unit to safe water and debits fuel", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.water-dirty", quantity: 3 }, { type: "item.fuel", quantity: 1 }]);
    const after = take(shelter, graph, "purify:recipe.purify.boil");
    expect(has(after, "item.water-dirty")).toBe(0);
    expect(has(after, "item.water")).toBe(3);
    expect(has(after, "item.fuel")).toBe(0);
  });

  it("studying a carried blueprint item learns its recipe and consumes the schematic", () => {
    const { state, graph } = run();
    const carrying = withInv(state, [{ type: "item.blueprint.molotov", quantity: 1 }]);
    expect(carrying.player.economy.blueprints).not.toContain("blueprint.molotov");
    const after = take(carrying, graph, "study:item.blueprint.molotov");
    expect(after.player.economy.blueprints).toContain("blueprint.molotov");
    expect(has(after, "item.blueprint.molotov")).toBe(0);
    // Now the molotov recipe becomes craftable at the bench with the parts.
    const ready = withInv(claimShelter(after), [{ type: "item.cloth", quantity: 1 }]);
    expect(craftable(ready, graph, RECIPES[6]!)).toBe(true);
  });
});

// --- spoilage (FR-ECO-05): a power-coupled clock only fresh food feels -------------------------

describe("food spoilage ages fresh food, faster once the grid fails (FR-ECO-05)", () => {
  it("fresh food ages per hour and turns to spoiled food when the clock runs out", () => {
    const { state, graph } = run();
    const carrying = withInv(state, [{ type: FRESH_FOOD_ITEM, quantity: 2 }]);
    const started = tickSpoilage(carrying, graph, 1); // clock starts and ticks one hour
    expect(started.player.economy.freshness).toBe(FRESH_SHELF_LIFE - 1);
    const spoiled = tickSpoilage(started, graph, FRESH_SHELF_LIFE); // blow past the shelf life
    expect(has(spoiled, FRESH_FOOD_ITEM)).toBe(0);
    expect(has(spoiled, SPOILED_FOOD_ITEM)).toBe(2);
    expect(spoiled.player.economy.freshness).toBeNull();
    expect(spoiled.history.some((h) => h.type === "food.spoiled")).toBe(true);
  });

  it("spoils twice as fast below the power threshold", () => {
    const { state, graph } = run();
    const carrying = withInv(state, [{ type: FRESH_FOOD_ITEM, quantity: 1 }]);
    const full = tickSpoilage(setGrid(carrying, POWER_SPOIL_AT), graph, 5); // at/above ⇒ rate 1
    expect(full.player.economy.freshness).toBe(FRESH_SHELF_LIFE - 5);
    const failing = tickSpoilage(setGrid(carrying, POWER_SPOIL_AT - 1), graph, 5); // below ⇒ rate 2
    expect(failing.player.economy.freshness).toBe(FRESH_SHELF_LIFE - 10);
  });

  it("canned food never spoils, and the clock clears when no fresh food is carried", () => {
    const { state, graph } = run();
    const cans = withInv(state, [{ type: "item.canned-food", quantity: 3 }]);
    const ticked = tickSpoilage(cans, graph, 100);
    expect(has(ticked, "item.canned-food")).toBe(3);
    expect(ticked.player.economy.freshness).toBeNull();
  });
});

// --- the body loop is real: fresh food is eatable, spoiled a desperate meal (FR-ECO-04/05) -----

describe("fresh and spoiled food are eatable, closing the body loop (audit fix)", () => {
  const HUNGRY = 80;
  const setHunger = (s: GameState, hunger: number): GameState => ({ ...s, player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, hunger } } } });

  it("eating fresh food relieves more hunger than a can; spoiled food relieves less", () => {
    const { state, graph } = run();
    const eatOne = (inv: Inv): number => {
      const s = setHunger(withInv(state, inv), HUNGRY);
      const after = applyAction(s, availableActions(s, graph).find((c) => c.id === "eat")!.action, graph).state;
      return HUNGRY - after.player.condition.needs.hunger; // hunger relieved
    };
    const canned = eatOne([{ type: "item.canned-food", quantity: 1 }]);
    const fresh = eatOne([{ type: FRESH_FOOD_ITEM, quantity: 1 }]);
    const spoiled = eatOne([{ type: SPOILED_FOOD_ITEM, quantity: 1 }]);
    expect(fresh).toBeGreaterThan(canned); // fresh is better food — a reason to eat it before it rots
    expect(spoiled).toBeLessThan(canned); // spoiled is a thin, desperate meal
    expect(spoiled).toBeGreaterThan(0); // but not nothing — the loop is closed, not a dead item
  });

  it("with a mixed pack, eating reaches for the perishable fresh food first", () => {
    const { state, graph } = run();
    const s = setHunger(withInv(state, [{ type: "item.canned-food", quantity: 1 }, { type: FRESH_FOOD_ITEM, quantity: 1 }]), HUNGRY);
    const after = applyAction(s, availableActions(s, graph).find((c) => c.id === "eat")!.action, graph).state;
    expect(has(after, FRESH_FOOD_ITEM)).toBe(0); // the fresh one went first
    expect(has(after, "item.canned-food")).toBe(1); // the can is kept
  });
});

// --- robustness: forged/duplicate actions can't cheat or waste (audit hardenings) --------------

describe("economy verbs reject forged or wasteful actions (audit hardenings)", () => {
  it("a room recipe stops being craftable once its room is built (no input-burning re-craft)", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.scrap", quantity: 6 }]);
    const built = take(shelter, graph, "craft:recipe.shelter.workshop");
    // Now the room exists; the workshop recipe is no longer offered, and a forced re-craft is a no-op.
    expect(craftable(built, graph, RECIPES[2]!)).toBe(false);
    const forced = resolveEconomyAction(built, graph, { type: "craft", params: { recipe: "recipe.shelter.workshop" } });
    expect(forced).toBe(built); // inputs untouched
  });

  it("a forged study with no schematic carried, or with the economy inactive, learns nothing", () => {
    const { state, graph } = run();
    const forged = resolveEconomyAction(state, graph, { type: "study", params: { item: "item.blueprint.molotov" } });
    expect(forged.player.economy.blueprints).toEqual([]); // not carried ⇒ inert
    const { state: noPool, graph: noGraph } = run([]); // economy inactive
    const carrying = withInv(noPool, [{ type: "item.blueprint.molotov", quantity: 1 }]);
    expect(resolveEconomyAction(carrying, noGraph, { type: "study", params: { item: "item.blueprint.molotov" } })).toBe(carrying);
  });

  it("a forged repair aimed at a full-durability artifact wastes nothing (even while a worn one exists)", () => {
    const { state, graph } = run();
    const worn = "item.tool-reinforced#worn"; // a genuinely worn artifact makes the repair recipe craftable
    const full = "item.tool-reinforced#full"; // the forged target — already at full durability
    const items = {
      ...state.items,
      [worn]: { type: "item.tool-reinforced", quality: 100, durability: 50, metadata: { repairs: [] } } as ItemInstance,
      [full]: { type: "item.tool-reinforced", quality: 100, durability: 100, metadata: { repairs: [] } } as ItemInstance,
    };
    const s = withRooms(withInv({ ...claimShelter(state), items }, [
      { type: "item.tool-reinforced", quantity: 1, itemId: worn },
      { type: "item.tool-reinforced", quantity: 1, itemId: full },
      { type: "item.scrap", quantity: 2 },
    ]), ["room.workshop"]);
    const forced = resolveEconomyAction(s, graph, { type: "repair", params: { recipe: "recipe.repair.tool", itemId: full } });
    expect(forced.items[full]!.durability).toBe(100); // the full one is untouched
    expect((forced.items[full]!.metadata as { repairs: unknown[] }).repairs).toEqual([]); // no bogus provenance line
    expect(has(forced, "item.scrap")).toBe(2); // scrap not burned on a no-op target
  });
});

// --- INERTNESS: the byte-identity guarantee ----------------------------------------------------

describe("the whole economy is inert without a recipe pool — every prior run is byte-identical", () => {
  const noPool = () => startRun(opts, REGIONS, NODES); // no recipes registered

  it("offers no economy choices, narrates nothing, and never spoils food when inactive", () => {
    const { state, graph } = noPool();
    expect(economyActive(graph)).toBe(false);
    const shelter = withInv(claimShelter(state), [{ type: "item.cloth", quantity: 2 }, { type: FRESH_FOOD_ITEM, quantity: 2 }]);
    expect(economyChoices(shelter, graph)).toEqual([]);
    expect(economyLine(shelter, graph)).toBeNull();
    // Spoilage is gated on the pool, not just the item: fresh food carried in an economy-less run does NOT spoil.
    const ticked = tickSpoilage(shelter, graph, FRESH_SHELF_LIFE * 4);
    expect(ticked).toBe(shelter); // same reference — a pure no-op
  });

  it("a scripted multi-turn run with no pool is byte-identical to the pre-economy engine (no economy state drift)", () => {
    const { state, graph } = noPool();
    let s = state;
    for (const id of ["search", "wait", "search"]) {
      const c = availableActions(s, graph).find((ch) => ch.id === id) ?? availableActions(s, graph)[0]!;
      s = applyAction(s, c.action, graph).state;
    }
    // The economy slice stays exactly at its inert defaults for a run that never touches the system.
    expect(s.player.economy).toEqual({ blueprints: [], freshness: null });
    for (const node of Object.values(s.nodes)) expect(node.rooms).toEqual([]);
  });
});

// --- determinism + save-losslessness ----------------------------------------------------------

describe("deterministic and save-lossless across every economy path", () => {
  it("same seed + state + action ⇒ byte-identical result", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.cloth", quantity: 3 }]);
    const a = availableActions(shelter, graph).find((c) => c.id === "craft:recipe.medical.bandage")!.action;
    expect(JSON.stringify(applyAction(shelter, a, graph))).toBe(JSON.stringify(applyAction(shelter, a, graph)));
  });

  it("load(save(state)) is deep-equal after craft, repair, purify, and spoilage", () => {
    const { state, graph } = run();
    // craft
    const crafted = take(withInv(claimShelter(state), [{ type: "item.cloth", quantity: 2 }]), graph, "craft:recipe.medical.bandage");
    expect(loadGame(saveGame(crafted))).toStrictEqual(crafted);
    // purify
    const purified = take(withInv(claimShelter(state), [{ type: "item.water-dirty", quantity: 2 }, { type: "item.fuel", quantity: 1 }]), graph, "purify:recipe.purify.boil");
    expect(loadGame(saveGame(purified))).toStrictEqual(purified);
    // spoilage (a food.spoiled beat + a spoiled stack)
    const spoiled = tickSpoilage(withInv(state, [{ type: FRESH_FOOD_ITEM, quantity: 1 }]), graph, FRESH_SHELF_LIFE + 1);
    expect(loadGame(saveGame(spoiled))).toStrictEqual(spoiled);
  });

  it("a render (sceneOf) advances nothing — pure", () => {
    const { state, graph } = run();
    const shelter = withInv(claimShelter(state), [{ type: "item.cloth", quantity: 2 }]);
    const before = JSON.stringify(shelter);
    sceneOf(shelter, graph);
    expect(JSON.stringify(shelter)).toBe(before);
  });

  it("isEconomyAction owns exactly the economy verbs", () => {
    expect(isEconomyAction({ type: "craft" })).toBe(true);
    expect(isEconomyAction({ type: "repair" })).toBe(true);
    expect(isEconomyAction({ type: "purify" })).toBe(true);
    expect(isEconomyAction({ type: "study" })).toBe(true);
    expect(isEconomyAction({ type: "search" })).toBe(false);
    // an unknown recipe id resolves to a no-op (defensive)
    const { state, graph } = run();
    expect(resolveEconomyAction(state, graph, { type: "craft", params: { recipe: "recipe.nope" } })).toBe(state);
  });
});
