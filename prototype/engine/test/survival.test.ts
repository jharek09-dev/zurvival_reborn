import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  canDrink,
  canEat,
  canTreat,
  drink,
  driftNeeds,
  eat,
  endingNarration,
  isRunOver,
  loadGame,
  runEndReason,
  saveGame,
  sceneOf,
  stageFor,
  startRun,
  treat,
  treatmentItem,
  updateCondition,
  BITE_INFECT_RATE,
  DRINK_RELIEF,
  EAT_RELIEF,
  HUNGER_RATE,
  INFECT_SYMPTOMATIC_AT,
  INFECT_TERMINAL_AT,
  NEED_FATAL,
  REST_RECOVERY,
  THIRST_RATE,
  type GameState,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
  type Wound,
} from "../src/index.js";

/**
 * T22 — survival pressure. Needs bite and can be fed; an untreated bite drives a lethal infection
 * that treatment halts; neglect ends the run. The Survival Triangle actually pulls each turn.
 */

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { loot: 80, survivorActivity: 0 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a store", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a clinic", adjacent: ["node.x.a"], kind: "medical" },
];
const opts = { seed: "surv-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const bite = (): Wound => ({ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: 1 });
const withNeeds = (s: GameState, n: Partial<GameState["player"]["condition"]["needs"]>): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, ...n } } },
});
const withInv = (s: GameState, inv: [string, number][]): GameState => ({
  ...s,
  player: { ...s.player, inventory: inv.map(([type, quantity]) => ({ type, quantity })) },
});
const withBite = (s: GameState): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, wounds: [bite()] } },
});

// --- needs drift is felt (FR-CORE-02) -------------------------------------------------------

describe("needs drift by the hours spent (T22)", () => {
  it("hunger/thirst climb every hour; rest recovers fatigue instead", () => {
    const base = { hunger: 0, thirst: 0, fatigue: 20 };
    const active = driftNeeds(base, false, 3);
    expect(active.hunger).toBe(3 * HUNGER_RATE);
    expect(active.thirst).toBe(3 * THIRST_RATE);
    expect(active.fatigue).toBe(20 + 3 * 2);
    const rested = driftNeeds(base, true, 6);
    expect(rested.fatigue).toBe(Math.max(0, 20 - REST_RECOVERY));
    expect(rested.thirst).toBe(6 * THIRST_RATE); // resting still makes you thirsty
  });

  it("a real run raises thirst enough to matter within a handful of turns", () => {
    let { state, graph } = run();
    for (let i = 0; i < 6; i++) {
      const c = availableActions(state, graph).find((x) => x.id === "search") ?? availableActions(state, graph)[0]!;
      state = applyAction(state, c.action, graph).state;
    }
    expect(state.player.condition.needs.thirst).toBeGreaterThanOrEqual(34); // pressing, not "steady"
  });
});

// --- eat / drink buy needs back down (FR-CORE-02) -------------------------------------------

describe("eat and drink spend a scavenged item to relieve a need (T22)", () => {
  it("drink is offered only when thirsty and carrying water, and lowers thirst", () => {
    const dry = withInv(withNeeds(run().state, { thirst: 50 }), [["item.water", 2]]);
    expect(canDrink(dry)).toBe(true);
    const after = drink(dry);
    expect(after.player.condition.needs.thirst).toBe(50 - DRINK_RELIEF < 0 ? 0 : 50 - DRINK_RELIEF);
    expect(after.player.inventory.find((e) => e.type === "item.water")!.quantity).toBe(1); // one spent
    // not offered when not thirsty, or when carrying no water.
    expect(canDrink(withInv(withNeeds(run().state, { thirst: 0 }), [["item.water", 1]]))).toBe(false);
    expect(canDrink(withInv(withNeeds(run().state, { thirst: 80 }), [["item.scrap", 1]]))).toBe(false);
  });

  it("eat lowers hunger and consumes a ration", () => {
    const hungry = withInv(withNeeds(run().state, { hunger: 60 }), [["item.canned-food", 1]]);
    expect(canEat(hungry)).toBe(true);
    const after = eat(hungry);
    expect(after.player.condition.needs.hunger).toBe(Math.max(0, 60 - EAT_RELIEF));
    expect(after.player.inventory.some((e) => e.type === "item.canned-food")).toBe(false); // last one gone
  });
});

// --- wounds decline you; a bite is a lethal infection clock (FR-INJ-04/05) -------------------

describe("infection staging (T22)", () => {
  it("stages from progression thresholds", () => {
    expect(stageFor(0)).toBe("none");
    expect(stageFor(1)).toBe("incubating");
    expect(stageFor(INFECT_SYMPTOMATIC_AT)).toBe("symptomatic");
    expect(stageFor(INFECT_TERMINAL_AT)).toBe("terminal");
  });
});

describe("an untreated bite drives infection; treatment halts it (T22)", () => {
  it("infection progression climbs while an untreated bite is open", () => {
    const s = withBite(run().state);
    const after = updateCondition(s, { type: "rest", choiceId: "rest", timeCost: 6 });
    expect(after.player.condition.infection.progression).toBe(BITE_INFECT_RATE * 6);
    expect(after.player.condition.infection.stage).toBe("incubating");
  });

  it("no open bite ⇒ no infection driver", () => {
    const s = run().state; // no wound
    const after = updateCondition(s, { type: "rest", choiceId: "rest", timeCost: 6 });
    expect(after.player.condition.infection.progression).toBe(0);
  });

  it("treating the bite with antiseptic advances care and, once closed, stops the clock", () => {
    const s = withInv(withBite(run().state), [["item.antiseptic", 2]]);
    expect(canTreat(s)).toBe(true);
    expect(treatmentItem(s)!.item).toBe("item.antiseptic"); // the right medicine for a bite
    // two treatments (25 + 25 >= severity 40) close and remove the wound.
    const t1 = treat(s);
    expect(t1.player.condition.wounds[0]!.treated).toBeGreaterThan(0);
    const t2 = treat(t1);
    expect(t2.player.condition.wounds.length).toBe(0); // healed and removed (FR-INJ-04)
    // with the bite gone, an hour passing no longer feeds the infection.
    const later = updateCondition(t2, { type: "rest", choiceId: "rest", timeCost: 6 });
    expect(later.player.condition.infection.progression).toBe(t2.player.condition.infection.progression);
  });

  it("an untreated bite eventually kills — the clock combat's stealth path lets you dodge", () => {
    // Plenty of water so thirst never ends the run first; rest/drink to survive while infection wins.
    let state = withInv(withBite(run().state), [["item.water", 40]]);
    const graph = run().graph;
    let died = false;
    for (let i = 0; i < 60; i++) {
      const choices = availableActions(state, graph);
      if (choices.length === 0) { died = true; break; }
      const c = choices.find((x) => x.id === "drink") ?? choices.find((x) => x.id === "rest")!;
      state = applyAction(state, c.action, graph).state;
    }
    expect(died).toBe(true);
    expect(runEndReason(state)).toBe("infection"); // the bite, not thirst, took them
  });
});

// --- neglect ends the run (T22) -------------------------------------------------------------

describe("run-end is a real, derived stake (T22)", () => {
  it("maxed thirst / hunger / terminal infection each end the run", () => {
    expect(runEndReason(withNeeds(run().state, { thirst: NEED_FATAL }))).toBe("dehydrated");
    expect(runEndReason(withNeeds(run().state, { hunger: NEED_FATAL }))).toBe("starved");
    const terminal: GameState = {
      ...run().state,
      player: { ...run().state.player, condition: { ...run().state.player.condition, infection: { stage: "terminal", progression: 100 } } },
    };
    expect(runEndReason(terminal)).toBe("infection");
    expect(runEndReason(run().state)).toBeNull(); // a fresh survivor lives
  });

  it("an ended run offers no actions and the Scene narrates the death", () => {
    const { graph } = run();
    const dead = withNeeds(run().state, { thirst: NEED_FATAL });
    expect(isRunOver(dead)).toBe(true);
    expect(availableActions(dead, graph)).toEqual([]);
    const scene = sceneOf(dead, graph);
    expect(scene.choices).toEqual([]);
    expect(scene.narration).toBe(endingNarration("dehydrated"));
  });
});

// --- determinism + save ---------------------------------------------------------------------

describe("survival is deterministic and save-lossless (T22)", () => {
  it("a managed survival run round-trips through save/load", () => {
    let { state, graph } = run();
    for (let i = 0; i < 8; i++) {
      const choices = availableActions(state, graph);
      const c = choices.find((x) => x.id === "drink") ?? choices.find((x) => x.id === "search") ?? choices[0];
      if (!c) break;
      state = applyAction(state, c.action, graph).state;
      expect(loadGame(saveGame(state))).toStrictEqual(state);
    }
  });
});
