import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  recruit,
  tickCompanions,
  companionName,
  companionOrderChoices,
  resolveCompanionOrder,
  orderOf,
  canRecruitEligible,
  partyIsFull,
  PARTY_CAP,
  ORDER_TRUST_MIN,
  COMPANION_SHARE_TRUST,
  SCAVENGE_ITEM,
  RECRUIT_MIN,
  saveGame,
  loadGame,
  sceneOf,
  type GameState,
  type NodeDef,
  type NPCDef,
  type NPCState,
  type RegionGraph,
  type RegionDef,
  type Survivor,
} from "../src/index.js";

/**
 * T45 — several recruitable companions with a bounded party, recruit eligibility, and trust-gated
 * standing orders (FR-NPC-03). Deterministic, integer-only, save-lossless; a default-order party is
 * byte-identical to the T36 one-companion slice.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "Base", description: "a base", adjacent: ["node.k"], start: true },
  { id: "node.k", regionId: "region.z", name: "Store", description: "a store", adjacent: ["node.s"] },
];
const NPCS: NPCDef[] = [
  { id: "npc.a", name: "Ana", description: "a nurse", disposition: "friendly", homeNode: "node.s" },
  { id: "npc.b", name: "Ben", description: "a mechanic", disposition: "neutral", homeNode: "node.s" },
  { id: "npc.c", name: "Cyd", description: "a cook", disposition: "wary", homeNode: "node.s" },
  { id: "npc.d", name: "Dot", description: "a teacher", disposition: "friendly", homeNode: "node.s" },
  { id: "npc.h", name: "Hix", description: "a thug", disposition: "hostile", homeNode: "node.s" },
];
const opts = { seed: "orders-seed", createdAt: "2026-07-16T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS);
const withNpc = (s: GameState, id: string, over: Partial<NPCState>): GameState => ({ ...s, npcs: { ...s.npcs, [id]: { ...s.npcs[id]!, ...over } } });
/** Mark a survivor met + trusted enough to recruit. */
const ready = (s: GameState, id: string, trust = RECRUIT_MIN + 5): GameState => withNpc(s, id, { met: true, trust });

// --- party cap + eligibility ----------------------------------------------------------------

describe("a bounded, eligible party (T45 · QA L3)", () => {
  it("recruits up to PARTY_CAP companions, then refuses the next", () => {
    let { state } = run();
    for (const id of ["npc.a", "npc.b", "npc.c"]) state = recruit(ready(state, id), id);
    expect(Object.keys(state.actors).length).toBe(PARTY_CAP);
    expect(partyIsFull(state)).toBe(true);
    // a fourth eligible survivor cannot join a full party — the recruit is inert
    const ready4 = ready(state, "npc.d");
    expect(canRecruitEligible(ready4, ready4.npcs["npc.d"]!)).toBe(false);
    const after = recruit(ready4, "npc.d");
    expect("npc.d" in after.actors).toBe(false);
    expect("npc.d" in after.npcs).toBe(true);
  });

  it("never recruits a hostile survivor, however high trust runs", () => {
    const { state } = run();
    const s = ready(state, "npc.h", 100); // maxed trust, but hostile
    expect(canRecruitEligible(s, s.npcs["npc.h"]!)).toBe(false);
    const after = recruit(s, "npc.h");
    expect("npc.h" in after.actors).toBe(false);
    // and the recruit offer is never surfaced for them
    const spoken = withNpc(s, "npc.h", { met: true });
    expect(availableActions(spoken, run().graph).some((c) => c.id === "recruit:npc.h")).toBe(false);
  });
});

// --- naming + trust carry-over --------------------------------------------------------------

describe("companions are named and carry their trust (T45 · closes L1)", () => {
  it("a recruit carries name + trust; the party prose names them at your side", () => {
    const { state, graph } = run();
    const after = recruit(ready(state, "npc.a", 84), "npc.a");
    const c = after.actors["npc.a"]!;
    expect(c.name).toBe("Ana");
    expect(c.trust).toBe(84);
    expect(companionName(c)).toBe("Ana");
    // the Scene names them (not the generic "your companion")
    const narration = sceneOf(after, graph).narration;
    expect(narration).toContain("Ana is with you");
    expect(narration).not.toContain("Your companion");
  });
});

// --- standing orders: offer gating ----------------------------------------------------------

describe("standing orders are offered by trust (T45 · FR-NPC-03)", () => {
  const companion = (trust: number, shelter: boolean): GameState => {
    let { state } = run();
    state = recruit(ready(state, "npc.a", trust), "npc.a");
    return shelter ? { ...state, player: { ...state.player, shelterId: state.player.location } } : state;
  };
  it("a freshly-recruited companion (trust 70) is offered follow/hold but not the dangerous orders", () => {
    const orders = companionOrderChoices(companion(70, true)).map((c) => c.action.params!["order"]);
    expect(orders).toContain("hold");
    expect(orders).not.toContain("scavenge");
    expect(orders).not.toContain("guard");
  });
  it("a trusted companion (≥ORDER_TRUST_MIN) with a base is offered scavenge + guard", () => {
    const orders = companionOrderChoices(companion(ORDER_TRUST_MIN, true)).map((c) => c.action.params!["order"]);
    expect(orders).toContain("scavenge");
    expect(orders).toContain("guard");
  });
  it("scavenge needs a base to bank into; guard does not", () => {
    const orders = companionOrderChoices(companion(ORDER_TRUST_MIN, false)).map((c) => c.action.params!["order"]);
    expect(orders).not.toContain("scavenge");
    expect(orders).toContain("guard");
  });
});

// --- standing orders: effect ----------------------------------------------------------------

const oneCompanion = (over: Partial<Survivor>, playerOver: Partial<GameState["player"]> = {}): GameState => {
  let { state } = run();
  state = recruit(ready(state, "npc.a", 90), "npc.a");
  const c = state.actors["npc.a"]!;
  return { ...state, actors: { ...state.actors, "npc.a": { ...c, ...over } }, player: { ...state.player, ...playerOver } };
};
const setOrder = (state: GameState, order: string): GameState =>
  resolveCompanionOrder(state, { type: "order", choiceId: `order:npc.a:${order}`, timeCost: 0, params: { companion: "npc.a", order } });

describe("standing orders change what a companion does (T45)", () => {
  it("follow tracks the player; hold keeps them where they are", () => {
    // companion left at node.k while the player is at node.s
    const left = oneCompanion({ location: "node.k" });
    expect(orderOf(left.actors["npc.a"]!)).toBe("follow");
    expect(tickCompanions(left, 2).actors["npc.a"]!.location).toBe("node.s"); // followed to the player
    const held = setOrder(left, "hold");
    expect(orderOf(held.actors["npc.a"]!)).toBe("hold");
    expect(tickCompanions(held, 2).actors["npc.a"]!.location).toBe("node.k"); // stayed put
  });

  it("a scavenger banks supplies into the base stash and drains faster", () => {
    const base = oneCompanion({}, { shelterId: "node.s", stash: [] });
    const scav = setOrder(base, "scavenge");
    const after = tickCompanions(scav, 6); // 6h ⇒ 3 units
    const banked = after.player.stash.find((e) => e.type === SCAVENGE_ITEM);
    expect(banked?.quantity).toBe(3);
    // ranged out ⇒ hungrier/thirstier than a follow companion over the same hours
    const follow = tickCompanions(base, 6).actors["npc.a"]!.condition.needs;
    const sneed = after.actors["npc.a"]!.condition.needs;
    expect(sneed.hunger).toBeGreaterThan(follow.hunger);
    expect(sneed.thirst).toBeGreaterThan(follow.thirst);
  });

  it("a guard maintains the barricades of the node it holds", () => {
    const barricaded = oneCompanion({ location: "node.s" }, { shelterId: "node.s" });
    const withBar: GameState = { ...barricaded, nodes: { ...barricaded.nodes, "node.s": { ...barricaded.nodes["node.s"]!, barricades: 50 } } };
    const guarding = setOrder(withBar, "guard");
    const after = tickCompanions(guarding, 6); // +1/h upkeep
    expect(after.nodes["node.s"]!.barricades).toBe(56);
  });

  it("the trust gate holds at resolve time too — a low-trust companion can't be sent to scavenge", () => {
    const lowTrust = oneCompanion({ trust: 50 }, { shelterId: "node.s" });
    const attempt = setOrder(lowTrust, "scavenge");
    expect(orderOf(attempt.actors["npc.a"]!)).toBe("follow"); // refused
  });
});

// --- feeding earns trust; save-lossless -----------------------------------------------------

describe("feeding a companion earns trust, and orders round-trip (T45)", () => {
  it("sharing food with a companion raises their trust", () => {
    const hungry = oneCompanion({ trust: 60, condition: { needs: { hunger: 70, thirst: 20, fatigue: 20 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } } }, {});
    const fed = { ...hungry, player: { ...hungry.player, inventory: [{ type: "item.canned-food", quantity: 2 }] } };
    const { graph } = run();
    const choice = availableActions(fed, graph).find((c) => c.id === "give-food:npc.a");
    expect(choice).toBeDefined();
    const after = applyAction(fed, choice!.action, graph).state;
    expect(after.actors["npc.a"]!.trust).toBe(60 + COMPANION_SHARE_TRUST);
  });

  it("a companion with a standing order saves and reloads losslessly", () => {
    const scav = setOrder(oneCompanion({}, { shelterId: "node.s" }), "scavenge");
    const reloaded = loadGame(saveGame(scav));
    expect(reloaded).toStrictEqual(scav);
    expect(orderOf(reloaded.actors["npc.a"]!)).toBe("scavenge");
  });
});
