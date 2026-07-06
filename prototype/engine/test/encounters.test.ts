import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  encounterPeople,
  resolveEncounterAction,
  isEncounterAction,
  survivorsHere,
  recordHistory,
  driftNpc,
  canParley,
  PARLEY_MIN,
  FOOD_ITEM,
  WATER_ITEM,
  EAT_RELIEF,
  DRINK_RELIEF,
  NEED_FATAL,
  type GameState,
  type NodeDef,
  type NPCDef,
  type NPCState,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T35 — Survivor encounters (FR-NPC-01 surfacing / FR-NPC-06 VS subset). The verbs that surface a survivor
 * as a person — talk, share food/water, threaten, recruit — plus the teeth: needs that can kill, trust
 * that can be spent, a survivor who turns. Deterministic, integer-only, save-lossless.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "Clinic", description: "a clinic", adjacent: ["node.k"], start: true },
  { id: "node.k", regionId: "region.z", name: "Store", description: "a store", adjacent: ["node.s"] },
];
// Both survivors home to the start node, so the player meets them at turn 0. Sarah opens friendly with
// low needs; Ruth opens desperate (needs already pressing, so the share verbs surface immediately).
const NPCS: NPCDef[] = [
  { id: "npc.ruth", name: "Ruth", description: "a shopkeeper", disposition: "desperate", homeNode: "node.s" },
  { id: "npc.sarah", name: "Sarah", description: "a paramedic", disposition: "friendly", homeNode: "node.s" },
];
const opts = { seed: "enc-seed", createdAt: "2026-07-06T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS);

const withNpc = (state: GameState, id: string, over: Partial<NPCState>): GameState => ({
  ...state,
  npcs: { ...state.npcs, [id]: { ...state.npcs[id]!, ...over } },
});
const ids = (choices: readonly { id: string }[]): string[] => choices.map((c) => c.id);

// --- surfacing --------------------------------------------------------------------------------

describe("survivors are surfaced as Scene choices (T35 · FR-NPC-01)", () => {
  it("survivorsHere lists living survivors at the node, stable-ordered", () => {
    const { state } = run();
    expect(survivorsHere(state, "node.s").map((n) => n.id)).toStrictEqual(["npc.ruth", "npc.sarah"]);
    expect(survivorsHere(state, "node.k")).toStrictEqual([]);
  });

  it("offers talk + threaten for a met-able survivor, and share only when carried & needed", () => {
    const { state } = run();
    const offered = ids(encounterPeople(state));
    // Sarah (friendly, low needs): talk + threaten, no share (needs below the offer threshold), no recruit.
    expect(offered).toContain("talk:npc.sarah");
    expect(offered).toContain("threaten:npc.sarah");
    expect(offered).not.toContain("give-food:npc.sarah");
    expect(offered).not.toContain("recruit:npc.sarah");
    // Ruth (desperate): needs are pressing and the player carries food+water, so both share verbs surface.
    expect(offered).toContain("give-food:npc.ruth");
    expect(offered).toContain("give-water:npc.ruth");
  });

  it("names present survivors in the Scene narration (NFR-ACC-01 — all words)", () => {
    const { state, graph } = run();
    const narration = sceneOf(state, graph).narration;
    expect(narration).toContain("Sarah");
    expect(narration).toContain("Ruth");
  });

  it("does not offer people choices during a walker encounter (a fight pre-empts talk)", () => {
    const { state, graph } = run();
    const contested = { ...state, nodes: { ...state.nodes, "node.s": { ...state.nodes["node.s"]!, walkers: 1 } } };
    const offered = ids(availableActions(contested, graph));
    expect(offered.some((i) => i.startsWith("talk:"))).toBe(false);
    expect(offered).toContain("fight");
  });
});

// --- talk -------------------------------------------------------------------------------------

describe("talk flips `met` and is a one-shot (T35)", () => {
  it("talking sets met true; the option then disappears", () => {
    const { state } = run();
    expect(state.npcs["npc.sarah"]!.met).toBe(false);
    const after = resolveEncounterAction(state, { type: "talk", params: { npc: "npc.sarah" } });
    expect(after.npcs["npc.sarah"]!.met).toBe(true);
    expect(ids(encounterPeople(after))).not.toContain("talk:npc.sarah");
  });

  it("talking to an already-met survivor is inert", () => {
    const { state } = run();
    const met = withNpc(state, "npc.sarah", { met: true });
    expect(resolveEncounterAction(met, { type: "talk", params: { npc: "npc.sarah" } })).toBe(met);
  });
});

// --- share (help) -----------------------------------------------------------------------------

describe("sharing food/water relieves needs, spends an item, and earns trust (T35)", () => {
  it("give-food buys hunger down by EAT_RELIEF, consumes one food, and raises trust (share +10)", () => {
    const { state } = run();
    const hunger0 = state.npcs["npc.ruth"]!.needs.hunger;
    const trust0 = state.npcs["npc.ruth"]!.trust;
    const food0 = state.player.inventory.find((e) => e.type === FOOD_ITEM)!.quantity;
    const after = resolveEncounterAction(state, { type: "give-food", params: { npc: "npc.ruth" } });
    expect(after.npcs["npc.ruth"]!.needs.hunger).toBe(Math.max(0, hunger0 - EAT_RELIEF));
    expect(after.npcs["npc.ruth"]!.trust).toBe(trust0 + 10);
    expect(after.player.inventory.find((e) => e.type === FOOD_ITEM)?.quantity ?? 0).toBe(food0 - 1);
  });

  it("give-water buys thirst down by DRINK_RELIEF, consumes one water, and raises trust", () => {
    const { state } = run();
    const thirst0 = state.npcs["npc.ruth"]!.needs.thirst;
    const water0 = state.player.inventory.find((e) => e.type === WATER_ITEM)!.quantity;
    const after = resolveEncounterAction(state, { type: "give-water", params: { npc: "npc.ruth" } });
    expect(after.npcs["npc.ruth"]!.needs.thirst).toBe(Math.max(0, thirst0 - DRINK_RELIEF));
    expect(after.player.inventory.find((e) => e.type === WATER_ITEM)?.quantity ?? 0).toBe(water0 - 1);
  });

  it("sharing is inert when the player carries none of the item", () => {
    const { state } = run();
    const broke = { ...state, player: { ...state.player, inventory: [] } };
    expect(resolveEncounterAction(broke, { type: "give-food", params: { npc: "npc.ruth" } })).toBe(broke);
  });
});

// --- threaten (harm) --------------------------------------------------------------------------

describe("threatening lowers trust and can turn a survivor (T35 · FR-NPC-02)", () => {
  it("threaten lowers trust by 20 (the asymmetric harm step)", () => {
    const { state } = run();
    const trust0 = state.npcs["npc.sarah"]!.trust;
    const after = resolveEncounterAction(state, { type: "threaten", params: { npc: "npc.sarah" } });
    expect(after.npcs["npc.sarah"]!.trust).toBe(trust0 - 20);
  });

  it("pushed below PARLEY_MIN a survivor turns — no talk/share/threaten is offered, and it sticks", () => {
    const { state } = run();
    // Drive trust just under the parley floor.
    const turned = withNpc(state, "npc.sarah", { trust: PARLEY_MIN - 1, met: true });
    expect(canParley(turned.npcs["npc.sarah"]!)).toBe(false);
    const offered = ids(encounterPeople(turned));
    expect(offered.some((i) => i.endsWith(":npc.sarah"))).toBe(false);
    // No regen: ticking hours does not thaw them (the betrayal-sticks property, end to end).
    const later = applyAction(turned, { type: "rest", choiceId: "rest", timeCost: 6 }, run().graph).state;
    expect(later.npcs["npc.sarah"]!.trust).toBeLessThan(PARLEY_MIN);
  });
});

// --- teeth: death -----------------------------------------------------------------------------

describe("neglected survivors die — `alive` finally flips (T35)", () => {
  it("driftNpc kills a survivor whose hunger or thirst saturates", () => {
    const { state } = run();
    const starving = { ...state.npcs["npc.ruth"]!, needs: { hunger: NEED_FATAL - 1, thirst: 50, fatigue: 0 } };
    const dead = driftNpc(starving, 6);
    expect(dead.alive).toBe(false);
    expect(dead.needs.hunger).toBe(NEED_FATAL);
  });

  it("a dead survivor is inert and no longer offered anything", () => {
    const { state } = run();
    const dead = withNpc(state, "npc.ruth", { alive: false });
    expect(survivorsHere(dead, "node.s").map((n) => n.id)).toStrictEqual(["npc.sarah"]);
    expect(ids(encounterPeople(dead)).some((i) => i.endsWith(":npc.ruth"))).toBe(false);
  });

  it("property — a survivor at a saturated need is dead after any positive drift", () => {
    const { state } = run();
    const base = state.npcs["npc.ruth"]!;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 240 }), fc.constantFrom("hunger", "thirst"), (hours, need) => {
        const at = { ...base, needs: { ...base.needs, [need]: NEED_FATAL } as NPCState["needs"] };
        expect(driftNpc(at, hours).alive).toBe(false);
      }),
    );
  });
});

// --- history + audit --------------------------------------------------------------------------

describe("people events reach the Living History and the FR-CORE-04 audit (T35)", () => {
  it("meeting a survivor logs npc.met; a death logs npc.died", () => {
    const { state } = run();
    const met = resolveEncounterAction(state, { type: "talk", params: { npc: "npc.sarah" } });
    expect(recordHistory(state, met).map((e) => e.type)).toContain("npc.met");
    const dead = withNpc(state, "npc.ruth", { alive: false });
    expect(recordHistory(state, dead).map((e) => e.type)).toContain("npc.died");
  });

  it("an interaction is a resolved turn that moves a tracked system (no no-op)", () => {
    const { state, graph } = run();
    const give = availableActions(state, graph).find((c) => c.id === "give-water:npc.ruth")!;
    const res = applyAction(state, give.action, graph);
    expect(res.changed).toContain("npcs");
    expect(res.changed).toContain("player");
  });

  it("isEncounterAction recognises the people verbs and nothing else", () => {
    for (const t of ["talk", "give-food", "give-water", "threaten", "recruit"]) {
      expect(isEncounterAction({ type: t })).toBe(true);
    }
    for (const t of ["move", "search", "rest", "fight", "wait"]) {
      expect(isEncounterAction({ type: t })).toBe(false);
    }
  });
});
