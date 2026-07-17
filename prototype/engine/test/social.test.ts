import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  advanceWorld,
  loadGame,
  saveGame,
  startRun,
  socialActive,
  socialChoices,
  isSocialAction,
  resolveSocialAction,
  resolveEncounterAction,
  tickPeople,
  tickGroups,
  socialLine,
  remember,
  respectOf,
  fearOf,
  memoryOf,
  bondSeed,
  untoldLead,
  seedFactions,
  attitudeRead,
  companionUnease,
  shelterMoodRead,
  MEMORY_CAP,
  ALLY_SEED,
  RIVAL_SEED,
  DESERT_HOURS,
  BETRAY_STASH_UNITS,
  MOVE_HOURS,
  DEFAULT_RESPECT,
  type FactionDef,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../src/index.js";

/**
 * T53 — factions & inter-NPC relationships. The social system (memory → trust/respect/fear, ask-for-leads,
 * desertion/betrayal, inter-NPC bonds → morale, off-screen people-sim), content-driven over a `graph.factions`
 * pool. The load-bearing guarantee: INERT without a faction pool, so every prior run is byte-identical.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
// A 3-node line: start — mid — home. `node.home` is 2 hops out, so it is HIDDEN at spawn (reveal target).
const NODES: NodeDef[] = [
  { id: "node.start", regionId: "region.z", name: "Start", description: "s", adjacent: ["node.mid"], start: true },
  { id: "node.mid", regionId: "region.z", name: "Mid", description: "m", adjacent: ["node.start", "node.home"] },
  { id: "node.home", regionId: "region.z", name: "Home", description: "h", adjacent: ["node.mid"] },
];
const NPCS: NPCDef[] = [
  {
    id: "npc.sana",
    name: "Sana",
    description: "a steady medic",
    disposition: "friendly",
    homeNode: "node.start",
    knowledge: [{ id: "sana.home", hint: "There's a cache out at Home — nobody's cleared it.", reveals: "node.home", minTrust: 40 }],
  },
  { id: "npc.rex", name: "Rex", description: "a wary scavenger", disposition: "wary", homeNode: "node.start" },
];
const FACTIONS: FactionDef[] = [
  {
    id: "faction.kin",
    name: "Kin",
    archetype: "holdout",
    description: "the people who stayed",
    homeNode: "node.home",
    members: ["npc.sana", "npc.rex", "npc.vic"],
    baseline: { strength: 40, hostility: 5, reputation: 10 },
    rivalries: [{ a: "npc.rex", b: "npc.foe" }],
  },
  { id: "faction.foe", name: "Foe", archetype: "crew", description: "the other crew", homeNode: "node.mid", members: ["npc.foe"], baseline: { hostility: 60, reputation: -30 } },
];

const opts = { seed: "social-seed", createdAt: "2026-07-17T00:00:00Z" };
/** A run WITH the faction pool (social active). */
const social = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], FACTIONS);
/** A run WITHOUT a faction pool (social inert — the byte-identity baseline). */
const plain = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS);

const meet = (s: GameState, id: string): GameState => ({ ...s, npcs: { ...s.npcs, [id]: { ...s.npcs[id]!, met: true } } });
const setHumanity = (s: GameState, humanity: number): GameState => ({ ...s, player: { ...s.player, humanity } });

function withCompanion(s: GameState, id: string, patch: Partial<Survivor> = {}): GameState {
  const c: Survivor = {
    id,
    type: id,
    name: id.slice(2),
    trust: 80,
    condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
    location: s.player.location,
    groupId: null,
    relationships: {},
    inventory: [],
    flags: { companion: true },
    ...patch,
  };
  return { ...s, actors: { ...s.actors, [id]: c } };
}

// --- the master gate: inert without a faction pool (byte-identity) ----------------------------

describe("T53 · social system is inert without a faction pool", () => {
  it("socialActive reflects whether a faction pool is registered", () => {
    expect(socialActive(social().graph)).toBe(true);
    expect(socialActive(plain().graph)).toBe(false);
    expect(socialActive(undefined)).toBe(false);
  });

  it("a plain run writes NO respect/fear/memory field when a survivor is threatened", () => {
    const { state, graph } = plain();
    const threatened = resolveEncounterAction(state, { type: "threaten", params: { npc: "npc.sana" } }, graph);
    const npc = threatened.npcs["npc.sana"]!;
    expect(npc.trust).toBeLessThan(state.npcs["npc.sana"]!.trust); // T34 trust still drops
    expect(npc.respect).toBeUndefined();
    expect(npc.fear).toBeUndefined();
    expect(npc.memory).toBeUndefined();
  });

  it("offers no social choices and seeds no groups without a pool", () => {
    const { state, graph } = plain();
    expect(socialChoices(meet(state, "npc.sana"), graph)).toEqual([]);
    expect(state.groups).toEqual({});
    expect(state.player.reputation).toEqual({});
  });

  it("tickPeople / tickGroups are no-ops without a pool (same object)", () => {
    const { state, graph } = plain();
    expect(tickPeople(state, graph, 24)).toBe(state);
    expect(tickGroups(state, graph, 24)).toBe(state);
  });
});

// --- faction seeding --------------------------------------------------------------------------

describe("T53 · seedFactions populates groups + reputation (reserved shapes)", () => {
  it("a social run seeds a SurvivorGroup + player standing per faction", () => {
    const { state } = social();
    expect(Object.keys(state.groups).sort()).toEqual(["faction.foe", "faction.kin"]);
    expect(state.groups["faction.kin"]!.memberIds).toEqual(["npc.rex", "npc.sana", "npc.vic"]);
    expect(state.groups["faction.kin"]!.homeNodeId).toBe("node.home");
    expect(state.player.reputation["faction.kin"]).toBe(10);
    expect(state.player.reputation["faction.foe"]).toBe(-30);
  });

  it("seedFactions is inert on an empty def list (byte-identical)", () => {
    const { state } = plain();
    expect(seedFactions(state, [])).toBe(state);
  });
});

// --- memory → respect/fear (FR-NPC-02) --------------------------------------------------------

describe("T53 · memory drives respect/fear (FR-NPC-02)", () => {
  it("threatening a survivor spikes fear and records the memory (social run)", () => {
    const { state, graph } = social();
    const after = resolveEncounterAction(state, { type: "threaten", params: { npc: "npc.sana" } }, graph);
    const npc = after.npcs["npc.sana"]!;
    expect(fearOf(npc)).toBeGreaterThan(0);
    expect(memoryOf(npc).at(-1)?.kind).toBe("menaced-me");
  });

  it("sharing food raises respect and records kindness", () => {
    const { state, graph } = social();
    const s = { ...state, player: { ...state.player, inventory: [{ type: "item.canned-food", quantity: 2 }] }, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, needs: { hunger: 80, thirst: 10, fatigue: 10 } } } };
    const after = resolveEncounterAction(s, { type: "give-food", params: { npc: "npc.sana" } }, graph);
    const npc = after.npcs["npc.sana"]!;
    expect(respectOf(npc)).toBeGreaterThan(DEFAULT_RESPECT);
    expect(memoryOf(npc).at(-1)?.kind).toBe("kindness");
  });

  it("memory is bounded to MEMORY_CAP (oldest evicted)", () => {
    const { state } = social();
    let npc = state.npcs["npc.sana"]!;
    for (let i = 0; i < MEMORY_CAP + 5; i++) npc = remember(npc, "menaced-me", i);
    expect(memoryOf(npc)).toHaveLength(MEMORY_CAP);
    expect(memoryOf(npc)[0]!.turn).toBe(5); // first 5 evicted
    expect(fearOf(npc)).toBe(100); // saturated, clamped
  });
});

// --- ask for leads (FR-NPC-06) ----------------------------------------------------------------

describe("T53 · conversations that hint (FR-NPC-06)", () => {
  it("offers ask only when met, trusted, and the lead still resolves", () => {
    const { state, graph } = social();
    // Unmet → no ask.
    expect(socialChoices(state, graph).some((c) => c.id === "ask:npc.sana")).toBe(false);
    // Met + friendly (trust 60 ≥ 40) → ask offered.
    const met = meet(state, "npc.sana");
    expect(socialChoices(met, graph).some((c) => c.id === "ask:npc.sana")).toBe(true);
    // Below the lead's minTrust → not offered.
    const lowTrust = { ...met, npcs: { ...met.npcs, "npc.sana": { ...met.npcs["npc.sana"]!, trust: 20 } } };
    expect(untoldLead(lowTrust, graph, lowTrust.npcs["npc.sana"]!)).toBeNull();
  });

  it("resolving ask reveals the node, flags it told, and surfaces the hint", () => {
    const { state, graph } = social();
    const met = meet(state, "npc.sana");
    expect(met.nodes["node.home"]!.discovered).toBe(false);
    const after = resolveSocialAction(met, graph, { type: "ask", params: { npc: "npc.sana" } });
    expect(after.nodes["node.home"]!.discovered).toBe(true); // real world state, not a marker
    expect(after.player.flags["told:npc.sana:sana.home"]).toBe(true);
    expect(socialLine(after, graph)).toContain("cache out at Home");
    // Spent → no longer offered.
    expect(socialChoices(after, graph).some((c) => c.id === "ask:npc.sana")).toBe(false);
  });

  it("ask is a real, offered, resolvable turn end to end via applyAction", () => {
    const { state, graph } = social();
    const met = meet(state, "npc.sana");
    const ask = availableActions(met, graph).find((c) => c.id === "ask:npc.sana");
    expect(ask).toBeDefined();
    const { state: next } = applyAction(met, ask!.action, graph);
    expect(next.nodes["node.home"]!.discovered).toBe(true);
  });
});

// --- desertion & betrayal (FR-NPC-05) ---------------------------------------------------------

/** Run tickPeople for `hours` total in 6h steps (hours-based desertion pressure). */
function age(state: GameState, graph: RegionGraph, hours: number): GameState {
  for (let t = 0; t < hours; t += 6) state = tickPeople(state, graph, 6);
  return state;
}

describe("T53 · desertion & betrayal (FR-NPC-05)", () => {
  it("NEGLECT (individual mistreatment) deserts a companion even under a decent leader", () => {
    let { state } = social();
    const { graph } = social();
    // Decent humanity (40, not cruel) but the companion is starving → morale target sinks below the line ⇒
    // desertion driven by individual mistreatment, NOT a global bar. Default respect (30) ⇒ desert, not betray.
    state = setHumanity(state, 40);
    state = withCompanion(state, "c.dana", { condition: { needs: { hunger: 92, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 22 } } });
    state = age(state, graph, DESERT_HOURS);
    expect(state.actors["c.dana"]).toBeUndefined();
    expect(state.player.flags["left.c.dana"]).toBe(true);
    expect(state.history.some((h) => h.type === "social.deserted")).toBe(true);
    // FIX (audit): a deserter is NOT logged as a death.
    expect(state.history.some((h) => h.type === "companion.died")).toBe(false);
  });

  it("desertion under a CRUEL leader is a BETRAYAL — takes from the stash", () => {
    let { state } = social();
    const { graph } = social();
    state = setHumanity(state, 10); // cruel band ⇒ the deserter robs you
    state = { ...state, player: { ...state.player, stash: [{ type: "item.canned-food", quantity: 5 }] } };
    state = withCompanion(state, "c.gus", { condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 15 } } });
    state = age(state, graph, DESERT_HOURS);
    expect(state.actors["c.gus"]).toBeUndefined();
    expect(state.history.some((h) => h.type === "social.betrayed")).toBe(true);
    expect(state.history.some((h) => h.type === "companion.died")).toBe(false);
    const left = state.player.stash.find((e) => e.type === "item.canned-food")?.quantity ?? 0;
    expect(left).toBe(5 - BETRAY_STASH_UNITS);
  });

  it("a survivor MENACED before recruiting carries fear/respect and can betray (reachable path)", () => {
    let { state } = social();
    const { graph } = social();
    // Menace Sana repeatedly (fear climbs, respect falls), then she becomes a companion carrying those axes.
    let s: GameState = { ...state, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, trust: 90 } } };
    for (let i = 0; i < 5; i++) s = resolveEncounterAction(s, { type: "threaten", params: { npc: "npc.sana" } }, graph);
    const menaced = s.npcs["npc.sana"]!;
    expect(fearOf(menaced)).toBeGreaterThanOrEqual(85); // reaches BETRAY_FEAR
    expect(respectOf(menaced)).toBeLessThan(DEFAULT_RESPECT);
    // The carried fear rides onto the companion at recruit and drives desertion independent of humanity.
    const asComp: Survivor = { id: "npc.sana", type: "npc.sana", name: "Sana", trust: 90, respect: menaced.respect!, fear: menaced.fear!, memory: menaced.memory!, condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } }, location: state.player.location, groupId: null, relationships: {}, inventory: [], flags: { companion: true } };
    let run = setHumanity({ ...state, actors: { ...state.actors, "npc.sana": asComp } }, 60); // decent leader
    run = age(run, graph, DESERT_HOURS);
    expect(run.actors["npc.sana"]).toBeUndefined(); // high fear alone tips them out
  });

  it("NEGLECT erodes a companion's TRUST over time — the reachable low-trust path (bidirectional trust)", () => {
    let { state } = social();
    const { graph } = social();
    state = withCompanion(state, "c.hungry", { trust: 80, condition: { needs: { hunger: 90, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } } });
    const after = tickPeople(state, graph, 6); // one 6h step at severe need
    expect(after.actors["c.hungry"]!.trust!).toBeLessThan(80); // trust went DOWN (it only ever rose before T53)
  });

  it("a well-treated companion under a decent leader never deserts (pressure resets)", () => {
    let { state } = social();
    const { graph } = social();
    state = withCompanion(state, "c.ok"); // morale 60, needs 0, humanity 50 → steady
    state = age(state, graph, DESERT_HOURS + 24);
    expect(state.actors["c.ok"]).toBeDefined();
  });

  it("desertion pressure is time-invariant (one long fast-forward == many short ones)", () => {
    const mk = (): GameState => {
      const { state } = social();
      return withCompanion(setHumanity(state, 40), "c.x", { condition: { needs: { hunger: 92, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 22 } } });
    };
    const { graph } = social();
    const oneJump = tickPeople(mk(), graph, DESERT_HOURS);
    const manySteps = age(mk(), graph, DESERT_HOURS);
    // Both cross the threshold on the same elapsed hours.
    expect(oneJump.actors["c.x"]).toBeUndefined();
    expect(manySteps.actors["c.x"]).toBeUndefined();
  });
});

describe("T53 · attitude & morale are surfaced as prose (FR-NPC-02/07, no numbers)", () => {
  it("a frightened survivor reads as afraid; a steady one reads plainly", () => {
    const { state } = social();
    const afraid = { ...state.npcs["npc.sana"]!, fear: 80 };
    expect(attitudeRead(afraid)).toContain("afraid");
    expect(attitudeRead(state.npcs["npc.sana"]!)).toBeNull(); // untouched stranger → no overlay read
  });

  it("a miserable companion gives a desertion tell BEFORE they leave (fairness)", () => {
    const { state } = social();
    const c = withCompanion(state, "c.sad", { condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 20 } } }).actors["c.sad"]!;
    expect(companionUnease(c)).not.toBeNull();
  });

  it("shelter mood reads the resident mix (rivals on edge), words only", () => {
    let { state } = social();
    state = { ...state, player: { ...state.player, shelterId: state.player.location } };
    // Two rival residents at the base with low morale → an on-edge read.
    const lowMind = { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none" as const, progression: 0 }, mind: { stress: 0, morale: 20 } };
    state = withCompanion(state, "npc.rex", { condition: lowMind, relationships: { "npc.foe2": -30 } });
    state = withCompanion(state, "npc.foe2", { condition: lowMind, relationships: { "npc.rex": -30 } });
    const mood = shelterMoodRead(state);
    expect(mood).not.toBeNull();
    expect(mood!).toMatch(/edge|wearing down/);
    expect(mood!).not.toMatch(/[0-9]/); // no number leak
  });
});

// --- inter-NPC bonds → morale (FR-NPC-07) -----------------------------------------------------

describe("T53 · inter-NPC bonds and shelter morale (FR-NPC-07)", () => {
  it("bondSeed reads faction co-membership (+) and rivalry (−)", () => {
    const { graph } = social();
    expect(bondSeed(graph, "npc.sana", "npc.rex")).toBe(ALLY_SEED); // same faction
    expect(bondSeed(graph, "npc.rex", "npc.foe")).toBe(RIVAL_SEED); // named rivals
    expect(bondSeed(graph, "npc.sana", "npc.foe")).toBe(0); // different factions, no rivalry
  });

  it("two co-faction companions seed a positive bond and lift each other's morale", () => {
    let { state } = social();
    const { graph } = social();
    state = withCompanion(state, "npc.sana", { condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 50 } } });
    state = withCompanion(state, "npc.rex", { condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 50 } } });
    const after = tickPeople(state, graph, 6);
    expect(after.actors["npc.sana"]!.relationships["npc.rex"]).toBe(ALLY_SEED);
    // Allies present pull the target above 60, so morale rises from 50.
    expect(after.actors["npc.sana"]!.condition.mind.morale).toBeGreaterThan(50);
  });
});

// --- off-screen people-sim (PL-M3-02) ---------------------------------------------------------

describe("T53 · off-screen people-sim (PL-M3-02)", () => {
  it("non-party survivors drift their needs off-screen (they can starve in a district you skip)", () => {
    const { state, graph } = social();
    const before = state.npcs["npc.sana"]!.needs.hunger;
    const after = advanceWorld(state, 24, graph);
    expect(after.npcs["npc.sana"]!.needs.hunger).toBeGreaterThan(before);
  });

  it("off-screen drift is dark WITHOUT a faction pool (byte-identical)", () => {
    const { state, graph } = plain();
    const before = state.npcs["npc.sana"]!.needs.hunger;
    const after = advanceWorld(state, 24, graph);
    expect(after.npcs["npc.sana"]!.needs.hunger).toBe(before); // unchanged — the old behaviour
  });

  it("a survivor away from their faction home steps toward it", () => {
    const { state, graph } = social();
    // Place Sana out at node.home's far end is home; move her to node.start (away). Her faction home is node.home.
    const away = { ...state, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, location: "node.start", needs: { hunger: 0, thirst: 0, fatigue: 0 } } } };
    const stepped = tickGroups(away, graph, MOVE_HOURS);
    expect(stepped.npcs["npc.sana"]!.location).toBe("node.mid"); // one hop start → mid → (home)
  });
});

// --- save round-trip with social fields present -----------------------------------------------

describe("T53 · save round-trip is lossless with social state", () => {
  it("a run carrying memory/respect/fear round-trips deep-equal and stays v10 (no rung)", () => {
    const { state, graph } = social();
    const withMem = resolveEncounterAction(
      { ...state, player: { ...state.player, inventory: [{ type: "item.canned-food", quantity: 1 }] }, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, needs: { hunger: 90, thirst: 0, fatigue: 0 } } } },
      { type: "give-food", params: { npc: "npc.sana" } },
      graph,
    );
    expect(withMem.npcs["npc.sana"]!.memory).toBeDefined();
    const round = loadGame(saveGame(withMem));
    expect(round).toStrictEqual(withMem);
    expect(round.meta.version).toBe(10); // T53 adds no save-schema rung
  });
});

// --- isSocialAction routing -------------------------------------------------------------------

describe("T53 · action routing", () => {
  it("recognises only the ask action", () => {
    expect(isSocialAction({ type: "ask" })).toBe(true);
    expect(isSocialAction({ type: "move" })).toBe(false);
  });
});
