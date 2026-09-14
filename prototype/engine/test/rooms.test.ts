import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  startRun,
  applyAction,
  availableActions,
  saveGame,
  loadGame,
  shelterLine,
  roomsLine,
  canClaimShelter,
  craftable,
  purifyBatchSize,
  roomSlotsAuthored,
  roomSlotsOf,
  roomsAtShelter,
  freeRoomSlots,
  roomSlotFree,
  claimSalvage,
  demolishableRooms,
  demolishRecovery,
  resolveShelterAction,
  tickShelterOps,
  COMPANION_FLAG,
  CARRY_CAPACITY,
  ITEM_WEIGHTS,
  inventoryWeight,
  ROOM_SLOTS_DEFAULT,
  ROOM_SLOTS_MIN,
  ROOM_SLOTS_MAX,
  CLAIM_SALVAGE_BASE,
  CLAIM_SALVAGE_ITEM,
  DEMOLISH_RECOVERY_PCT,
  DEMOLISH_COST,
  SAVE_SCHEMA_VERSION,
  type GameState,
  type NodeDef,
  type RecipeDef,
  type JobDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T85 — room slots, the claim salvage, the demolish verb and per-unit purification.
 *
 * The whole layer is gated on the content set authoring `NodeDef.roomSlots` somewhere, and the purify
 * batch on the recipe authoring `purifyUnitsPerCraft`, so every one of these has an UNAUTHORED twin
 * proving the pre-T85 behaviour survives. No save-schema rung: `NodeState.stripped` is optional and
 * absent-reads-unstripped.
 */

const REGIONS: RegionDef[] = [{ id: "region.r", name: "R", description: "r", baseline: { loot: 80 } }];

/** No node authors `roomSlots`, so the T85 layer is DARK here — the pre-T85 shape. */
const BARE: NodeDef[] = [
  { id: "node.r.home", regionId: "region.r", name: "Home", description: "a depot", adjacent: ["node.r.b"], start: true, claimable: true },
  { id: "node.r.b", regionId: "region.r", name: "B", description: "a lot", adjacent: ["node.r.home"], claimable: true },
];
/** The same map with slots authored — the shipped-content shape, where the rule is LIVE. */
const AUTHORED: NodeDef[] = [
  { ...BARE[0]!, roomSlots: 2, richness: 100 },
  { ...BARE[1]!, roomSlots: 4, richness: 50 },
];

const ROOMS: RecipeDef[] = [
  { id: "recipe.a", category: "shelter", label: "A", worldEffect: "a", inputs: [{ item: "item.scrap", qty: 1 }], installsRoom: "room.a", timeCost: 1 },
  { id: "recipe.b", category: "shelter", label: "B", worldEffect: "b", inputs: [{ item: "item.scrap", qty: 2 }], installsRoom: "room.b", timeCost: 1 },
  { id: "recipe.c", category: "shelter", label: "C", worldEffect: "c", inputs: [{ item: "item.scrap", qty: 3 }], installsRoom: "room.c", timeCost: 1 },
  { id: "recipe.free", category: "shelter", label: "F", worldEffect: "f", inputs: [{ item: "item.cloth", qty: 1 }], installsRoom: "room.free", timeCost: 1 },
];
const PURIFY_PLAIN: RecipeDef = {
  id: "recipe.p.plain", category: "purify", label: "P", worldEffect: "p",
  inputs: [{ item: "item.fuel", qty: 1 }], purifyFrom: "item.water-dirty", purifyTo: "item.water", timeCost: 1,
};
const PURIFY_BATCHED: RecipeDef = { ...PURIFY_PLAIN, id: "recipe.p.batched", purifyUnitsPerCraft: 2 };

const opts = { seed: "rooms-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (nodes: NodeDef[] = AUTHORED, recipes: RecipeDef[] = ROOMS): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, nodes, [], [], [], [], recipes);

const HOME = "node.r.home";

/** Stand the player in a claimed HOME with `rooms` built and `scrap` in the pack. */
function based(state: GameState, patch: { rooms?: string[]; scrap?: number; cloth?: number; dirty?: number; fuel?: number } = {}): GameState {
  const inv: { type: string; quantity: number }[] = [];
  if (patch.scrap !== undefined) inv.push({ type: "item.scrap", quantity: patch.scrap });
  if (patch.cloth !== undefined) inv.push({ type: "item.cloth", quantity: patch.cloth });
  if (patch.dirty !== undefined) inv.push({ type: "item.water-dirty", quantity: patch.dirty });
  if (patch.fuel !== undefined) inv.push({ type: "item.fuel", quantity: patch.fuel });
  return {
    ...state,
    nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, rooms: patch.rooms ?? [], searchPct: 100 } },
    player: { ...state.player, shelterId: HOME, location: HOME, inventory: inv },
  };
}

/** A state standing on a searched-clean, never-claimed HOME — the moment before a claim. */
const readyToClaim = (state: GameState): GameState => ({
  ...state,
  nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, searchPct: 100 } },
  player: { ...state.player, shelterId: null, location: HOME, inventory: [] },
});

const units = (s: GameState, type: string): number =>
  s.player.inventory.filter((e) => e.type === type).reduce((a, e) => a + e.quantity, 0);

const claimOf = (s: GameState, g: RegionGraph) => availableActions(s, g).find((c) => c.id === "claim-shelter");

// --- the gate ----------------------------------------------------------------------------------

describe("T85 gate — a set that authors no roomSlots is untouched", () => {
  it("roomSlotsAuthored is false on the bare set and true on the authored one", () => {
    expect(roomSlotsAuthored(run(BARE).graph)).toBe(false);
    expect(roomSlotsAuthored(run(AUTHORED).graph)).toBe(true);
    expect(roomSlotsAuthored(undefined)).toBe(false);
  });

  it("slots are UNBOUNDED when dark: every room installs however many are already standing", () => {
    const { state, graph } = run(BARE);
    expect(freeRoomSlots(based(state, { rooms: ["room.a", "room.b", "room.c"] }), graph)).toBe(Infinity);
    // and a fourth is still craftable with the scrap for it
    const s = based(state, { rooms: ["room.a", "room.b", "room.c"], scrap: 9 });
    expect(craftable(s, graph, ROOMS[3]!)).toBe(false); // needs cloth, not scrap
    expect(craftable({ ...s, player: { ...s.player, inventory: [{ type: "item.cloth", quantity: 1 }] } }, graph, ROOMS[3]!)).toBe(true);
  });

  it("a claim pays NOTHING when the layer is dark, and does not mark the node", () => {
    const { state, graph } = run(BARE);
    expect(claimSalvage(graph, HOME)).toBe(0);
    const before = readyToClaim(state);
    const after = applyAction(before, claimOf(before, graph)!.action, graph).state;
    expect(after.player.shelterId).toBe(HOME);
    expect(units(after, CLAIM_SALVAGE_ITEM)).toBe(0);
    expect(after.nodes[HOME]!.stripped).toBeUndefined();
  });

  it("the demolish verb never appears when the layer is dark", () => {
    const { state, graph } = run(BARE);
    const s = based(state, { rooms: ["room.a"] });
    expect(demolishableRooms(s, graph)).toEqual([]);
    expect(availableActions(s, graph).some((c) => c.id.startsWith("demolish:"))).toBe(false);
  });

  it("roomsLine is silent when the layer is dark, and speaks when it is not", () => {
    expect(roomsLine(based(run(BARE).state, { rooms: [] }), run(BARE).graph)).toBeNull();
    expect(roomsLine(based(run(AUTHORED).state, { rooms: [] }), run(AUTHORED).graph)).not.toBeNull();
  });
});

// --- the slot arithmetic ------------------------------------------------------------------------

describe("T85 slots", () => {
  it("reads the authored count, clamped, with a default for an unauthored node", () => {
    const { graph } = run(AUTHORED);
    expect(roomSlotsOf(graph, HOME)).toBe(2);
    expect(roomSlotsOf(graph, "node.r.b")).toBe(4);
    expect(roomSlotsOf(graph, "node.nope")).toBe(ROOM_SLOTS_DEFAULT);
    expect(roomSlotsOf(undefined, HOME)).toBe(ROOM_SLOTS_DEFAULT);
  });

  it("clamps any authored number into ROOM_SLOTS_MIN..MAX (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), (n) => {
        const nodes: NodeDef[] = [{ ...AUTHORED[0]!, roomSlots: n }, AUTHORED[1]!];
        const s = roomSlotsOf(run(nodes).graph, HOME);
        return s >= ROOM_SLOTS_MIN && s <= ROOM_SLOTS_MAX;
      }),
    );
  });

  it("a NaN authored slot count reads as the default, not as NaN", () => {
    const nodes: NodeDef[] = [{ ...AUTHORED[0]!, roomSlots: Number.NaN }, AUTHORED[1]!];
    expect(roomSlotsOf(run(nodes).graph, HOME)).toBe(ROOM_SLOTS_DEFAULT);
  });

  it("free slots count down as rooms go in, and never go negative", () => {
    const { state, graph } = run(AUTHORED);
    expect(freeRoomSlots(based(state, { rooms: [] }), graph)).toBe(2);
    expect(freeRoomSlots(based(state, { rooms: ["room.a"] }), graph)).toBe(1);
    expect(freeRoomSlots(based(state, { rooms: ["room.a", "room.b"] }), graph)).toBe(0);
    expect(freeRoomSlots(based(state, { rooms: ["room.a", "room.b", "room.c"] }), graph)).toBe(0);
  });

  it("off a shelter there are no slots to fill", () => {
    const { state, graph } = run(AUTHORED);
    expect(freeRoomSlots({ ...state, player: { ...state.player, shelterId: null } }, graph)).toBe(0);
    expect(roomSlotFree({ ...state, player: { ...state.player, shelterId: null } }, graph)).toBe(false);
  });

  it("A FULL BUILDING REFUSES A ROOM THE PLAYER CAN OTHERWISE AFFORD — the whole point", () => {
    const { state, graph } = run(AUTHORED);
    const room = ROOMS[2]!; // recipe.c, 3 scrap
    const empty = based(state, { rooms: [], scrap: 9 });
    expect(craftable(empty, graph, room)).toBe(true);
    const full = based(state, { rooms: ["room.a", "room.b"], scrap: 9 });
    expect(freeRoomSlots(full, graph)).toBe(0);
    expect(craftable(full, graph, room)).toBe(false);
    // and the choice disappears from the offer, not merely from the resolver
    expect(availableActions(full, graph).some((c) => c.id === "craft:recipe.c")).toBe(false);
  });

  it("the SAME full building still allows non-room recipes — the gate is on installsRoom only", () => {
    const { state, graph } = run(AUTHORED, [...ROOMS, { id: "recipe.item", category: "survival", label: "I", worldEffect: "i", inputs: [{ item: "item.scrap", qty: 1 }], output: { item: "item.torch", qty: 1 }, timeCost: 1 }]);
    const full = based(state, { rooms: ["room.a", "room.b"], scrap: 9 });
    expect(availableActions(full, graph).some((c) => c.id === "craft:recipe.c")).toBe(false);
    expect(availableActions(full, graph).some((c) => c.id === "craft:recipe.item")).toBe(true);
  });

  it("a roomier building takes a room the cramped one refuses", () => {
    const { state, graph } = run(AUTHORED);
    const atB = (rooms: string[]): GameState => ({
      ...state,
      nodes: { ...state.nodes, "node.r.b": { ...state.nodes["node.r.b"]!, rooms, searchPct: 100 } },
      player: { ...state.player, shelterId: "node.r.b", location: "node.r.b", inventory: [{ type: "item.scrap", quantity: 9 }] },
    });
    expect(craftable(atB(["room.a", "room.b"]), graph, ROOMS[2]!)).toBe(true); // 4 slots, 2 used
    expect(craftable(based(state, { rooms: ["room.a", "room.b"], scrap: 9 }), graph, ROOMS[2]!)).toBe(false); // 2 slots, 2 used
  });
});

// --- the claim salvage ---------------------------------------------------------------------------

describe("T85 claim salvage — the entry fee the base economy never had", () => {
  it("pays CLAIM_SALVAGE_BASE scaled by the node's authored richness, truncating", () => {
    const { graph } = run(AUTHORED);
    expect(claimSalvage(graph, HOME)).toBe(CLAIM_SALVAGE_BASE); // richness 100
    expect(claimSalvage(graph, "node.r.b")).toBe(Math.trunc((CLAIM_SALVAGE_BASE * 50) / 100)); // richness 50
  });

  it("a building already picked to the bones pays nothing", () => {
    const nodes: NodeDef[] = [{ ...AUTHORED[0]!, richness: 10 }, AUTHORED[1]!];
    expect(claimSalvage(run(nodes).graph, HOME)).toBe(0);
  });

  it("a set with slots but NO richness pays the flat base, not zero", () => {
    const nodes: NodeDef[] = [{ ...BARE[0]!, roomSlots: 3 }, { ...BARE[1]!, roomSlots: 3 }];
    expect(claimSalvage(run(nodes).graph, HOME)).toBe(CLAIM_SALVAGE_BASE);
  });

  it("the claim actually hands the scrap over, into the PACK, and logs it", () => {
    const { state, graph } = run(AUTHORED);
    const before = readyToClaim(state);
    expect(units(before, CLAIM_SALVAGE_ITEM)).toBe(0);
    const after = applyAction(before, claimOf(before, graph)!.action, graph).state;
    expect(units(after, CLAIM_SALVAGE_ITEM)).toBe(CLAIM_SALVAGE_BASE);
    expect(after.player.stash).toEqual(before.player.stash); // the pack, not the cache
    expect(after.history.some((h) => h.type === "shelter.stripped")).toBe(true);
  });

  it("THE PAYOUT IS NOT FARMABLE — abandon and re-claim pays once (the --ceiling finding)", () => {
    const { state, graph } = run(AUTHORED);
    let s = readyToClaim(state);
    s = applyAction(s, claimOf(s, graph)!.action, graph).state;
    expect(units(s, CLAIM_SALVAGE_ITEM)).toBe(CLAIM_SALVAGE_BASE);
    expect(s.nodes[HOME]!.stripped).toBe(true);
    const leave = availableActions(s, graph).find((c) => c.id === "abandon-shelter")!;
    s = applyAction(s, leave.action, graph).state;
    expect(s.player.shelterId).toBeNull();
    s = { ...s, player: { ...s.player, location: HOME } };
    const again = claimOf(s, graph);
    expect(again).toBeDefined();
    s = applyAction(s, again!.action, graph).state;
    expect(s.player.shelterId).toBe(HOME);
    expect(units(s, CLAIM_SALVAGE_ITEM)).toBe(CLAIM_SALVAGE_BASE); // STILL the first payout, not doubled
  });

  it("the `stripped` mark survives a save round-trip without a schema rung", () => {
    const { state, graph } = run(AUTHORED);
    let s = readyToClaim(state);
    s = applyAction(s, claimOf(s, graph)!.action, graph).state;
    const blob = saveGame(s);
    expect(JSON.parse(blob).saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    const back = loadGame(blob);
    expect(back.nodes[HOME]!.stripped).toBe(true);
    expect(back).toEqual(s);
  });

  it("the claim line offers the material before the player commits", () => {
    const { state, graph } = run(AUTHORED);
    expect(shelterLine(readyToClaim(state), graph)).toMatch(/material still in its walls/);
    const poor: NodeDef[] = [{ ...AUTHORED[0]!, richness: 10 }, AUTHORED[1]!];
    const p = run(poor);
    expect(shelterLine(readyToClaim(p.state), p.graph)).not.toMatch(/material/);
  });

  it("the salvage really does pay for a room the player could not otherwise afford", () => {
    const { state, graph } = run(AUTHORED);
    let s = readyToClaim(state);
    expect(craftable({ ...s, player: { ...s.player, shelterId: HOME } }, graph, ROOMS[2]!)).toBe(false); // no scrap
    s = applyAction(s, claimOf(s, graph)!.action, graph).state;
    expect(craftable(s, graph, ROOMS[2]!)).toBe(true); // 3 scrap, from the walls
  });
});

// --- demolition ----------------------------------------------------------------------------------

describe("T85 demolish — what makes a slot a decision rather than a trap", () => {
  it("returns DEMOLISH_RECOVERY_PCT of the room's scrap cost, truncated", () => {
    const { graph } = run(AUTHORED);
    expect(demolishRecovery(graph, "room.c")).toBe(Math.trunc((3 * DEMOLISH_RECOVERY_PCT) / 100));
    expect(demolishRecovery(graph, "room.a")).toBe(0); // 1 scrap -> trunc(0.5) === 0
    expect(demolishRecovery(graph, "room.free")).toBe(0); // built from cloth: no scrap back
    expect(demolishRecovery(graph, "room.nope")).toBe(0);
  });

  it("frees the slot and hands the scrap back", () => {
    const { state, graph } = run(AUTHORED);
    const s = based(state, { rooms: ["room.c", "room.a"], scrap: 0 });
    expect(freeRoomSlots(s, graph)).toBe(0);
    const d = availableActions(s, graph).find((c) => c.id === "demolish:room.c")!;
    expect(d.timeCost).toBe(DEMOLISH_COST);
    const after = applyAction(s, d.action, graph).state;
    expect(roomsAtShelter(after)).toEqual(["room.a"]);
    expect(freeRoomSlots(after, graph)).toBe(1);
    expect(units(after, "item.scrap")).toBe(1);
    expect(after.history.some((h) => h.type === "shelter.demolished")).toBe(true);
  });

  it("a garden on day two can become the other room on day nine", () => {
    const { state, graph } = run(AUTHORED);
    let s = based(state, { rooms: ["room.a", "room.c"], scrap: 3 });
    expect(craftable(s, graph, ROOMS[1]!)).toBe(false); // full
    s = applyAction(s, availableActions(s, graph).find((c) => c.id === "demolish:room.a")!.action, graph).state;
    expect(craftable(s, graph, ROOMS[1]!)).toBe(true);
  });

  it("is offered only in your own shelter, and only for rooms that are actually there", () => {
    const { state, graph } = run(AUTHORED);
    const away = { ...based(state, { rooms: ["room.a"] }), player: { ...based(state, { rooms: ["room.a"] }).player, location: "node.r.b" } };
    expect(demolishableRooms(away, graph)).toEqual([]);
    expect(demolishableRooms(based(state, { rooms: [] }), graph)).toEqual([]);
  });

  it("the PIPELINE refuses a forged demolish outright — it is never even offered", () => {
    const { state, graph } = run(AUTHORED);
    const forge = (room: string) => ({ type: "demolish", choiceId: `demolish:${room}`, timeCost: DEMOLISH_COST, params: { room } });
    const s = based(state, { rooms: ["room.a"], scrap: 0 });
    expect(() => applyAction(s, forge("room.b"), graph)).toThrow(/not offered/);
    const away = { ...s, player: { ...s.player, location: "node.r.b" } };
    expect(() => applyAction(away, forge("room.a"), graph)).toThrow(/not offered/);
    const dark = run(BARE);
    expect(() => applyAction(based(dark.state, { rooms: ["room.a"] }), forge("room.a"), dark.graph)).toThrow(/not offered/);
  });

  it("and the RESOLVER is inert on its own, so a caller that skips the offer check changes nothing", () => {
    const { state, graph } = run(AUTHORED);
    const forge = (room: string) => ({ type: "demolish", choiceId: `demolish:${room}`, timeCost: DEMOLISH_COST, params: { room } });
    const s = based(state, { rooms: ["room.a"], scrap: 0 });
    expect(resolveShelterAction(s, forge("room.b"), graph)).toBe(s);            // room not built
    expect(resolveShelterAction(s, forge(""), graph)).toBe(s);                  // no room param
    const away = { ...s, player: { ...s.player, location: "node.r.b" } };
    expect(resolveShelterAction(away, forge("room.a"), graph)).toBe(away);      // not at the shelter
    const dark = run(BARE);
    const ds = based(dark.state, { rooms: ["room.a"], scrap: 0 });
    expect(resolveShelterAction(ds, forge("room.a"), dark.graph)).toBe(ds);     // layer dark
    const homeless = { ...s, player: { ...s.player, shelterId: null } };
    expect(resolveShelterAction(homeless, forge("room.a"), graph)).toBe(homeless);
  });

  it("demolishing is never a scrap printer: build-then-demolish always loses material (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROOMS.filter((r) => r.installsRoom !== undefined)), (recipe) => {
        const { state, graph } = run(AUTHORED);
        const cost = recipe.inputs.filter((i) => i.item === "item.scrap").reduce((a, i) => a + i.qty, 0);
        return demolishRecovery(graph, recipe.installsRoom!) < cost || cost === 0;
      }),
    );
  });
});

// --- the Scene line -------------------------------------------------------------------------------

describe("T85 legibility — the slot rule is visible, and never as a number pair", () => {
  it("says what there is space for, in words", () => {
    const { state, graph } = run(AUTHORED);
    expect(roomsLine(based(state, { rooms: [] }), graph)).toMatch(/space in it for two things/);
    expect(roomsLine(based(state, { rooms: ["room.a"] }), graph)).toMatch(/space in it for one more/);
    expect(roomsLine(based(state, { rooms: ["room.a", "room.b"] }), graph)).toMatch(/nothing left to build into it/);
  });

  it("never prints a bare integer (FR-UI-02)", () => {
    const { state, graph } = run(AUTHORED);
    for (const rooms of [[], ["room.a"], ["room.a", "room.b"]]) {
      expect(roomsLine(based(state, { rooms }), graph) ?? "").not.toMatch(/\d/);
    }
  });

  it("the base paragraph carries it", () => {
    const { state, graph } = run(AUTHORED);
    expect(shelterLine(based(state, { rooms: [] }), graph)).toMatch(/space in it for/);
  });
});

// --- per-unit purification -------------------------------------------------------------------------

describe("T85 purify — a batch, not a button", () => {
  const purifyRun = (recipe: RecipeDef) => run(AUTHORED, [recipe]);
  const purifyChoice = (s: GameState, g: RegionGraph, id: string) => availableActions(s, g).find((c) => c.id === `purify:${id}`);

  it("purifyBatchSize is Infinity for an unauthored recipe and the clamped integer otherwise", () => {
    expect(purifyBatchSize(PURIFY_PLAIN)).toBe(Infinity);
    expect(purifyBatchSize(PURIFY_BATCHED)).toBe(2);
    expect(purifyBatchSize({ ...PURIFY_PLAIN, purifyUnitsPerCraft: 0 })).toBe(1);
    expect(purifyBatchSize({ ...PURIFY_PLAIN, purifyUnitsPerCraft: -5 })).toBe(1);
    expect(purifyBatchSize({ ...PURIFY_PLAIN, purifyUnitsPerCraft: Number.NaN })).toBe(Infinity);
  });

  it("AN UNAUTHORED RECIPE STILL CONVERTS THE WHOLE STACK — the pre-T85 behaviour, exactly", () => {
    const { state, graph } = purifyRun(PURIFY_PLAIN);
    const s = based(state, { dirty: 7, fuel: 3 });
    const after = applyAction(s, purifyChoice(s, graph, PURIFY_PLAIN.id)!.action, graph).state;
    expect(units(after, "item.water")).toBe(7);
    expect(units(after, "item.water-dirty")).toBe(0);
    expect(units(after, "item.fuel")).toBe(2);
  });

  it("an authored recipe converts ONE BATCH and leaves the rest dirty", () => {
    const { state, graph } = purifyRun(PURIFY_BATCHED);
    const s = based(state, { dirty: 7, fuel: 3 });
    const after = applyAction(s, purifyChoice(s, graph, PURIFY_BATCHED.id)!.action, graph).state;
    expect(units(after, "item.water")).toBe(2);
    expect(units(after, "item.water-dirty")).toBe(5);
    expect(units(after, "item.fuel")).toBe(2);
  });

  it("a stack SHORTER than a batch converts what is there, and still costs one batch of inputs", () => {
    const { state, graph } = purifyRun(PURIFY_BATCHED);
    const s = based(state, { dirty: 1, fuel: 3 });
    const after = applyAction(s, purifyChoice(s, graph, PURIFY_BATCHED.id)!.action, graph).state;
    expect(units(after, "item.water")).toBe(1);
    expect(units(after, "item.water-dirty")).toBe(0);
    expect(units(after, "item.fuel")).toBe(2);
  });

  it("HOARDING NO LONGER PAYS: N units cost ceil(N/batch) crafts, not one (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), (n) => {
        const { state, graph } = purifyRun(PURIFY_BATCHED);
        let s = based(state, { dirty: n, fuel: 20 });
        let crafts = 0;
        for (let i = 0; i < 20; i += 1) {
          const c = purifyChoice(s, graph, PURIFY_BATCHED.id);
          if (c === undefined) break;
          s = applyAction(s, c.action, graph).state;
          crafts += 1;
        }
        return crafts === Math.ceil(n / 2) && units(s, "item.water") === n && units(s, "item.fuel") === 20 - crafts;
      }),
    );
  });

  it("the beat reports what was actually made, not what was carried", () => {
    const { state, graph } = purifyRun(PURIFY_BATCHED);
    const s = based(state, { dirty: 7, fuel: 3 });
    const after = applyAction(s, purifyChoice(s, graph, PURIFY_BATCHED.id)!.action, graph).state;
    const beat = [...after.history].reverse().find((h) => h.type === "purify.done");
    const data = beat?.data as { readonly [k: string]: unknown } | undefined;
    expect(data?.["made"]).toBe(2);
  });
});

// --- determinism / losslessness -------------------------------------------------------------------

describe("T85 stays deterministic and save-lossless", () => {
  it("the same seed builds and demolishes identically", () => {
    const a = run(AUTHORED);
    const b = run(AUTHORED);
    let sa = based(a.state, { rooms: [], scrap: 6 });
    let sb = based(b.state, { rooms: [], scrap: 6 });
    for (const id of ["craft:recipe.c", "demolish:room.c"]) {
      sa = applyAction(sa, availableActions(sa, a.graph).find((c) => c.id === id)!.action, a.graph).state;
      sb = applyAction(sb, availableActions(sb, b.graph).find((c) => c.id === id)!.action, b.graph).state;
    }
    expect(sa).toEqual(sb);
  });

  it("a built base round-trips through save/load", () => {
    const { state, graph } = run(AUTHORED);
    const s = applyAction(based(state, { rooms: [], scrap: 6 }), availableActions(based(state, { rooms: [], scrap: 6 }), graph).find((c) => c.id === "craft:recipe.c")!.action, graph).state;
    expect(loadGame(saveGame(s))).toEqual(s);
  });
});

// --- the water loop, end to end -------------------------------------------------------------------

describe("T85 — the water loop actually closes", () => {
  /**
   * The single question T85's water half turns on: before it, **nothing in the game produced water**
   * (`measure/t85.ts --water`), the player burned 0.87/day against a 0.39/day find rate, and each
   * resident cost 1.20/day at a worse exchange (40 relief per unit against the player's 55). Shipping
   * a room and a job is worth nothing unless the chain from catchment to canteen runs end to end —
   * cistern built -> resident assigned -> hours pass -> DIRTY water in the cache -> withdrawn ->
   * purified at the bench -> drunk. Every link is asserted, because a break anywhere leaves the same
   * dead end the task exists to remove.
   */
  const WATER_ROOM = "room.cistern";
  const CISTERN: RecipeDef = {
    id: "recipe.cistern", category: "shelter", label: "Cistern", worldEffect: "drums under the downpipe",
    inputs: [{ item: "item.scrap", qty: 3 }], installsRoom: WATER_ROOM, timeCost: 1,
  };
  const BOIL: RecipeDef = {
    id: "recipe.boil", category: "purify", label: "Boil", worldEffect: "boil it safe",
    inputs: [{ item: "item.fuel", qty: 1 }], purifyFrom: "item.water-dirty", purifyTo: "item.water",
    purifyUnitsPerCraft: 2, timeCost: 1,
  };
  const WATER_JOB: JobDef = {
    id: "job.water", label: "Work the catchment", worldEffect: "the tank comes up an inch",
    room: WATER_ROOM, produces: { item: "item.water-dirty", qty: 2 }, hoursPerCycle: 6,
  };

  const waterRun = () =>
    startRun(opts, REGIONS, AUTHORED, [], [], [], [], [CISTERN, BOIL], [WATER_JOB]);

  it("builds, works, banks DIRTY water, and the purify bench turns it into a drink", () => {
    const { state, graph } = waterRun();
    // 1. the cistern is buildable out of a claim's worth of scrap
    let s = based(state, { rooms: [], scrap: 3, fuel: 2 });
    const build = availableActions(s, graph).find((c) => c.id === `craft:${CISTERN.id}`);
    expect(build, "the cistern must be offered at the bench").toBeDefined();
    s = applyAction(s, build!.action, graph).state;
    expect(roomsAtShelter(s)).toContain(WATER_ROOM);

    // 2. a resident at the base can be put on it
    const worker = {
      id: "npc.worker", type: "npc.fixture", name: "Worker", trust: 80,
      condition: { needs: { hunger: 10, thirst: 10, fatigue: 10 }, wounds: [], infection: { progression: 0, stage: "none" as const }, mind: { stress: 0, morale: 60 } },
      location: HOME, groupId: null, relationships: {}, inventory: [], flags: { [COMPANION_FLAG]: true },
    };
    s = { ...s, actors: { ...s.actors, [worker.id]: worker } };
    const assign = availableActions(s, graph).find((c) => c.id.startsWith("assign-job:") && c.id.endsWith(WATER_JOB.id));
    expect(assign, "the cistern's job must be offered once the room stands").toBeDefined();
    s = applyAction(s, assign!.action, graph).state;

    // 3. hours pass and the catchment banks DIRTY water into the cache — not clean
    const after = tickShelterOps(s, graph, 12);
    expect(after, "twelve hours at a worked base must change something").not.toBe(s);
    const dirtyInCache = after.player.stash.filter((e) => e.type === "item.water-dirty").reduce((a, e) => a + e.quantity, 0);
    expect(dirtyInCache, "twelve hours of a 6h cycle is two cycles of two units").toBeGreaterThan(0);
    expect(after.player.stash.some((e) => e.type === "item.water"), "the catchment collects; it does not purify").toBe(false);

    // 4. the cache can be drawn on, and the bench turns it into water you can drink
    let t = after;
    for (let i = 0; i < dirtyInCache; i += 1) {
      const take = availableActions(t, graph).find((c) => c.id === "stash-withdraw:item.water-dirty");
      if (take === undefined) break;
      t = applyAction(t, take.action, graph).state;
    }
    expect(units(t, "item.water-dirty")).toBeGreaterThan(0);
    const boil = availableActions(t, graph).find((c) => c.id === `purify:${BOIL.id}`);
    expect(boil, "the purify bench must accept what the cistern banked").toBeDefined();
    t = applyAction(t, boil!.action, graph).state;
    expect(units(t, "item.water"), "THE LOOP CLOSES: a base can now make its own drinking water").toBeGreaterThan(0);
  });

  it("and the loop is dark without the room — no cistern, no job, no water", () => {
    const { state, graph } = waterRun();
    const s = based(state, { rooms: [], scrap: 0 });
    expect(availableActions(s, graph).some((c) => c.id.startsWith("assign-job:"))).toBe(false);
  });
});

// --- the pack-weight invariant (audit fixes, each with its own failing test) -----------------------

describe("T85 audit — the salvage respects the pack, and the mark respects the farm", () => {
  /**
   * `sim/inventory.ts` documents `inventoryWeight <= CARRY_CAPACITY` as an invariant, and an
   * unbounded grant in `claimShelter` was the one hole in it. Written against the UNFIXED shape: a
   * near-full pack claiming a rich building used to end over capacity.
   */
  const heavy = (state: GameState): GameState => {
    // fill the pack to within one scrap of capacity
    let inv: { type: string; quantity: number }[] = [];
    const w = ITEM_WEIGHTS["item.scrap"] ?? 2;
    inv = [{ type: "item.scrap", quantity: Math.floor((CARRY_CAPACITY - w) / w) }];
    return {
      ...state,
      nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, searchPct: 100 } },
      player: { ...state.player, shelterId: null, location: HOME, inventory: inv },
    };
  };

  it("A CLAIM NEVER BREAKS THE WEIGHT INVARIANT — what will not fit stays in the building", () => {
    const { state, graph } = run(AUTHORED);
    const before = heavy(state);
    expect(inventoryWeight(before.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
    const after = applyAction(before, claimOf(before, graph)!.action, graph).state;
    expect(inventoryWeight(after.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
    // it took SOME of it, not all of it
    const gained = units(after, "item.scrap") - units(before, "item.scrap");
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(CLAIM_SALVAGE_BASE);
  });

  it("the beat reports what was CARRIED and what was offered, so the loss is legible", () => {
    const { state, graph } = run(AUTHORED);
    const after = applyAction(heavy(state), claimOf(heavy(state), graph)!.action, graph).state;
    const beat = [...after.history].reverse().find((h) => h.type === "shelter.stripped");
    const data = beat?.data as { readonly [k: string]: unknown } | undefined;
    expect(data?.["offered"]).toBe(CLAIM_SALVAGE_BASE);
    expect(data?.["units"]).toBeLessThan(CLAIM_SALVAGE_BASE);
  });

  it("A FULL PACK STILL STRIPS THE BUILDING — arrive full, drop, re-claim must not pay twice", () => {
    const { state, graph } = run(AUTHORED);
    // a pack at exactly capacity: nothing fits
    const w = ITEM_WEIGHTS["item.scrap"] ?? 2;
    const full: GameState = {
      ...state,
      nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, searchPct: 100 } },
      player: { ...state.player, shelterId: null, location: HOME, inventory: [{ type: "item.scrap", quantity: Math.floor(CARRY_CAPACITY / w) }] },
    };
    const carried = units(full, "item.scrap");
    let s = applyAction(full, claimOf(full, graph)!.action, graph).state;
    expect(units(s, "item.scrap"), "nothing fitted").toBe(carried);
    expect(s.nodes[HOME]!.stripped, "the walls were still stripped").toBe(true);
    // drop everything, leave, come back: the building has nothing left to give
    s = { ...s, player: { ...s.player, inventory: [] } };
    s = applyAction(s, availableActions(s, graph).find((c) => c.id === "abandon-shelter")!.action, graph).state;
    s = { ...s, player: { ...s.player, location: HOME } };
    s = applyAction(s, claimOf(s, graph)!.action, graph).state;
    expect(units(s, "item.scrap"), "the farm stays closed").toBe(0);
  });

  it("demolition respects the pack too", () => {
    const { state, graph } = run(AUTHORED);
    const w = ITEM_WEIGHTS["item.scrap"] ?? 2;
    const s: GameState = {
      ...state,
      nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, rooms: ["room.c"], searchPct: 100 } },
      player: { ...state.player, shelterId: HOME, location: HOME, inventory: [{ type: "item.scrap", quantity: Math.floor(CARRY_CAPACITY / w) }] },
    };
    const after = applyAction(s, availableActions(s, graph).find((c) => c.id === "demolish:room.c")!.action, graph).state;
    expect(inventoryWeight(after.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
    expect(roomsAtShelter(after)).toEqual([]); // the room still came out
  });
});

describe("T85 audit — the claim line never promises walls that are already bare", () => {
  it("a building this run has already stripped makes no offer of material", () => {
    const { state, graph } = run(AUTHORED);
    let s = readyToClaim(state);
    expect(shelterLine(s, graph)).toMatch(/usable material still in its walls/);
    s = applyAction(s, claimOf(s, graph)!.action, graph).state;
    s = applyAction(s, availableActions(s, graph).find((c) => c.id === "abandon-shelter")!.action, graph).state;
    s = { ...s, player: { ...s.player, location: HOME } };
    expect(canClaimShelter(s, graph)).toBe(true);
    expect(shelterLine(s, graph), "the walls are bare now and the line must say so by omission").toBe(
      "You have searched this place clean; it could be made your own.",
    );
  });

  it("and the line is grammatical at every payout size", () => {
    for (const richness of [25, 50, 100, 250]) {
      const nodes: NodeDef[] = [{ ...AUTHORED[0]!, richness }, AUTHORED[1]!];
      const r = run(nodes);
      const line = shelterLine(readyToClaim(r.state), r.graph) ?? "";
      expect(line, `richness ${richness}`).not.toMatch(/enough of usable/);
      expect(line.endsWith("."), `richness ${richness}`).toBe(true);
    }
  });
});

// --- mutation round 1: the dials, pinned to BEHAVIOUR rather than to themselves -------------------

describe("T85 dials — pinned by consequence, not by their own symbol", () => {
  /**
   * Five of seven first-round mutation survivors were tests that asserted a constant against itself
   * (`expect(roomSlotsOf(...)).toBe(ROOM_SLOTS_DEFAULT)` cannot fail when the constant moves). That is
   * the T84 `corpses-per-kill-0` defect, and this is the FIFTH consecutive task to hit it. These pin
   * the numbers by what they do to the game instead.
   */

  it("an unauthored node holds THREE rooms — enough for a choice, never the whole tree", () => {
    const { state, graph } = run([{ ...BARE[0]!, roomSlots: 2 }, BARE[1]!]); // b authors nothing
    const atB = (rooms: string[]): GameState => ({
      ...state,
      nodes: { ...state.nodes, "node.r.b": { ...state.nodes["node.r.b"]!, rooms, searchPct: 100 } },
      player: { ...state.player, shelterId: "node.r.b", location: "node.r.b", inventory: [{ type: "item.scrap", quantity: 20 }] },
    });
    expect(freeRoomSlots(atB([]), graph)).toBe(3);
    expect(craftable(atB(["room.a", "room.b"]), graph, ROOMS[2]!), "the third room fits").toBe(true);
    expect(craftable(atB(["room.a", "room.b", "room.free"]), graph, ROOMS[2]!), "the fourth does not").toBe(false);
  });

  it("EVERY BASE HOLDS AT LEAST ONE ROOM — a zero or negative authored count is not a dead base", () => {
    for (const authored of [0, -1, -99]) {
      const { state, graph } = run([{ ...AUTHORED[0]!, roomSlots: authored }, AUTHORED[1]!]);
      expect(freeRoomSlots(based(state, { rooms: [] }), graph), `roomSlots ${authored}`).toBeGreaterThanOrEqual(1);
      expect(craftable(based(state, { rooms: [], scrap: 9 }), graph, ROOMS[0]!), `roomSlots ${authored}`).toBe(true);
    }
  });

  it("NO BASE HOLDS THE WHOLE TREE — an absurd authored count is still capped", () => {
    const { state, graph } = run([{ ...AUTHORED[0]!, roomSlots: 9999 }, AUTHORED[1]!]);
    const roomRecipes = ROOMS.filter((r) => r.installsRoom !== undefined).length;
    expect(freeRoomSlots(based(state, { rooms: [] }), graph)).toBeLessThan(1000);
    expect(freeRoomSlots(based(state, { rooms: [] }), graph)).toBeGreaterThanOrEqual(roomRecipes - 2);
    // the cap is what makes "a base is a set of choices" true of the SHIPPED city too
    expect(roomSlotsOf(graph, HOME)).toBeLessThanOrEqual(6);
  });

  it("TEARING A ROOM OUT COSTS REAL HOURS — every resolved verb does (FR-CORE-03/04)", () => {
    const { state, graph } = run(AUTHORED);
    const s = based(state, { rooms: ["room.c"], scrap: 0 });
    const d = availableActions(s, graph).find((c) => c.id === "demolish:room.c")!;
    expect(d.timeCost).toBeGreaterThan(0);
    const before = s.meta.hour + s.meta.day * 24;
    const after = applyAction(s, d.action, graph).state;
    expect(after.meta.hour + after.meta.day * 24, "the clock must actually move").toBeGreaterThan(before);
  });

  it("THE SALVAGE TRUNCATES, IT DOES NOT ROUND — a thin building never rounds up to a free room", () => {
    // richness 40 is the discriminator: 4 * 40 / 100 = 1.6 -> trunc 1, round 2.
    const { graph } = run([{ ...AUTHORED[0]!, richness: 40 }, AUTHORED[1]!]);
    expect(claimSalvage(graph, HOME)).toBe(1);
    // and at richness 15 the walls give up nothing at all rather than rounding to one
    const thin = run([{ ...AUTHORED[0]!, richness: 15 }, AUTHORED[1]!]);
    expect(claimSalvage(thin.graph, HOME)).toBe(0);
  });

  it("A HOMELESS PLAYER HAS NO ROOMS — not the rooms of wherever they happen to stand", () => {
    const { state } = run(AUTHORED);
    const homeless: GameState = {
      ...state,
      nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, rooms: ["room.a", "room.b"] } },
      player: { ...state.player, shelterId: null, location: HOME },
    };
    expect(roomsAtShelter(homeless)).toEqual([]);
  });

  it("the demolish recovery is a LOSS, not a wash: half the scrap, rounded down", () => {
    const { state, graph } = run(AUTHORED);
    const s = based(state, { rooms: [], scrap: 4 });
    const built = applyAction(s, availableActions(s, graph).find((c) => c.id === "craft:recipe.c")!.action, graph).state;
    expect(units(built, "item.scrap")).toBe(1); // 4 - 3
    const torn = applyAction(built, availableActions(built, graph).find((c) => c.id === "demolish:room.c")!.action, graph).state;
    expect(units(torn, "item.scrap"), "3 spent, 1 back — building and unbuilding must never be free").toBe(2);
    expect(units(torn, "item.scrap")).toBeLessThan(units(s, "item.scrap"));
  });
});
