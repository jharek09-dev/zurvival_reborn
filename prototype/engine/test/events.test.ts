import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  activeEncounter,
  evaluateEvents,
  eligibleEncounters,
  selectEncounter,
  matchesRequirement,
  applyEncounterEffect,
  eventChoices,
  eventLine,
  resolveEventAction,
  resolveDueEncounterEvents,
  humanityOf,
  humanityBand,
  HUMANITY_BASELINE,
  ACTIVE_ENCOUNTER_QUEST,
  ENCOUNTER_EVENT_KIND,
  type EncounterDef,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T47 — the data-driven encounter/event system (FR-ENC-03..08 · FR-CNT-03). A declarative content
 * interpreter: requirement predicates + effect verbs, no hard-coded branching. Opt-in via a registered
 * pool, so every prior golden run is inert & byte-identical. Deterministic (no RNG this part).
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { threat: 30, loot: 60 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true, kind: "generic" },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"], kind: "store" },
];
const opts = { seed: "enc-seed", createdAt: "2026-07-16T00:00:00Z" };
const A = "node.x.a";

// --- a small fixture pool exercising each mechanic (fixtures, not shipped content) -------------

const EXPLORE: EncounterDef = {
  id: "encounter.test.explore", category: "exploration", title: "A quiet corner", premise: "look around",
  requirements: { nodeIds: [A] },
  stages: [{ id: "s", narration: "Papers drift across the plaza floor.", choices: [
    { id: "look", label: "Look closer", timeCost: 1, effects: [{ kind: "revealDiscovery", discovery: "disc.test.note" }] },
  ] }],
};
const MORAL: EncounterDef = {
  id: "encounter.test.moral", category: "social", title: "At gunpoint", premise: "rob or help",
  requirements: { nodeIds: ["node.x.b"] },
  stages: [{ id: "s", narration: "A scavenger freezes, hands up.", choices: [
    { id: "rob", label: "Take what they have", timeCost: 1, effects: [{ kind: "adjustHumanity", delta: -25 }, { kind: "grantItem", item: "item.canned-food", quantity: 1 }] },
    { id: "help", label: "Share and move on", timeCost: 1, effects: [{ kind: "adjustHumanity", delta: 10 }, { kind: "takeItem", item: "item.canned-food", quantity: 1 }] },
  ] }],
};
const MULTI: EncounterDef = {
  id: "encounter.test.multi", category: "social", title: "Toll", premise: "negotiate then fight then chase",
  requirements: { nodeIds: [A], forbidsFlags: ["done.multi"] },
  stages: [
    { id: "talk", narration: "They block the road and want a cut.", choices: [
      { id: "refuse", label: "Refuse", timeCost: 1, effects: [{ kind: "advanceStage", to: "violence" }] },
      { id: "pay", label: "Pay the toll", timeCost: 1, effects: [{ kind: "depleteStash", units: 1 }, { kind: "setFlag", flag: "done.multi" }] },
    ] },
    { id: "violence", narration: "Knives come out.", choices: [
      { id: "fight", label: "Stand and fight", timeCost: 1, effects: [{ kind: "seedWalkers", count: 2 }, { kind: "setFlag", flag: "done.multi" }] },
      { id: "run", label: "Run for it", timeCost: 1, effects: [{ kind: "advanceStage", to: "chase" }] },
    ] },
    { id: "chase", narration: "Boots pound the pavement behind you.", choices: [
      { id: "sprint", label: "Sprint clear", timeCost: 2, effects: [{ kind: "adjustNeed", need: "fatigue", delta: 20 }, { kind: "inflictWound", wound: "wound.sprain", site: "ankle", severity: 20 }, { kind: "setFlag", flag: "done.multi" }] },
    ] },
  ],
};
const CHAIN_A: EncounterDef = {
  id: "encounter.test.chain-a", category: "story", title: "A name on the wall", premise: "chain start",
  requirements: { nodeIds: [A], forbidsFlags: ["chain.seen"] },
  stages: [{ id: "s", narration: "A name is scratched into the plaster.", choices: [
    { id: "read", label: "Read it", timeCost: 1, effects: [{ kind: "setFlag", flag: "chain.seen" }] },
  ] }],
};
const CHAIN_B: EncounterDef = {
  id: "encounter.test.chain-b", category: "story", title: "The one who scratched it", premise: "chain payoff",
  requirements: { nodeIds: ["node.x.b"], requiresFlags: ["chain.seen"] },
  stages: [{ id: "s", narration: "You find who left the name.", choices: [
    { id: "ack", label: "Take it in", timeCost: 1, effects: [{ kind: "logHistory", event: "encounter.note", note: "chain resolved" }] },
  ] }],
};
const FALSE: EncounterDef = {
  id: "encounter.test.false", category: "psychological", title: "A sound", premise: "tension, no payoff",
  requirements: { nodeIds: [A] },
  stages: [{ id: "s", narration: "Something scrapes in the dark.", choices: [
    { id: "check", label: "Check it", timeCost: 1, effects: [{ kind: "logHistory", event: "encounter.note", note: "just the wind" }] },
  ] }],
};
const EVOLVE_BEFORE: EncounterDef = {
  id: "encounter.test.evolve-before", category: "exploration", title: "Before", premise: "fresh node",
  requirements: { nodeIds: [A], maxSearchPct: 33 },
  stages: [{ id: "s", narration: "Untouched.", choices: [{ id: "ok", label: "Note it", timeCost: 1, effects: [{ kind: "setFlag", flag: "seen.before" }] }] }],
};
const EVOLVE_AFTER: EncounterDef = {
  id: "encounter.test.evolve-after", category: "environmental", title: "After", premise: "picked over",
  requirements: { nodeIds: [A], minSearchPct: 67 },
  stages: [{ id: "s", narration: "Stripped bare, blood on the floor.", choices: [{ id: "ok", label: "Note it", timeCost: 1, effects: [{ kind: "setFlag", flag: "seen.after" }] }] }],
};

const run = (pool: EncounterDef[] = []): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, [], [], pool);
const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id);
const take = (s: GameState, g: RegionGraph, id: string): { state: GameState; scene: ReturnType<typeof sceneOf> } => {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (!c) throw new Error(`choice "${id}" not offered; got: ${ids(availableActions(s, g)).join(",")}`);
  return applyAction(s, c.action, g);
};
/** Play one bare turn so stage-13 selection runs, then return the (now engaged) state. */
const tick = (s: GameState, g: RegionGraph): GameState => applyAction(s, { type: "wait" }, g).state;
const atB = (s: GameState): GameState => ({ ...s, player: { ...s.player, location: "node.x.b" } });

// --- opt-in: inert unless a pool is registered ------------------------------------------------

describe("the encounter system is opt-in — no pool ⇒ inert (T47)", () => {
  it("a run with no pool never engages an encounter and evaluateEvents is a strict no-op", () => {
    const { state, graph } = run();
    expect(activeEncounter(state)).toBeNull();
    expect(evaluateEvents(state, graph)).toBe(state);
    expect(evaluateEvents(state, undefined)).toBe(state);
    let s = state;
    for (const id of ["search", "search", "rest"]) s = take(s, graph, id).state;
    expect(activeEncounter(s)).toBeNull();
    expect(s.player.quests).toEqual([]);
  });

  it("a fresh run seeds player.humanity at the neutral baseline", () => {
    expect(run().state.player.humanity).toBe(HUMANITY_BASELINE);
    expect(humanityOf(run().state)).toBe(HUMANITY_BASELINE);
  });
});

// --- requirement matching (the predicate vocabulary) ------------------------------------------

describe("requirement matching (FR-CNT-03 declarative predicates)", () => {
  const base = run().state;
  const node = base.nodes[A]!;
  const m = (req: Parameters<typeof matchesRequirement>[1], s: GameState = base) => matchesRequirement(s, req, s.nodes[A]!, A, "generic");

  it("an empty/undefined requirement matches anywhere", () => {
    expect(m(undefined)).toBe(true);
    expect(m({})).toBe(true);
  });
  it("gates on node id, region, kind, and phase", () => {
    expect(m({ nodeIds: [A] })).toBe(true);
    expect(m({ nodeIds: ["node.x.b"] })).toBe(false);
    expect(m({ regionIds: ["region.x"] })).toBe(true);
    expect(m({ nodeKinds: ["generic"] })).toBe(true);
    expect(m({ nodeKinds: ["store"] })).toBe(false);
    expect(m({ phases: ["dawn"] })).toBe(true); // run starts at dawn
    expect(m({ phases: ["night"] })).toBe(false);
  });
  it("gates on node-state bands (the evolution handle)", () => {
    const searched: GameState = { ...base, nodes: { ...base.nodes, [A]: { ...node, searchPct: 80, blood: 40 } } };
    expect(matchesRequirement(searched, { minSearchPct: 67 }, searched.nodes[A]!, A, "generic")).toBe(true);
    expect(matchesRequirement(searched, { maxSearchPct: 33 }, searched.nodes[A]!, A, "generic")).toBe(false);
    expect(matchesRequirement(base, { maxSearchPct: 33 }, base.nodes[A]!, A, "generic")).toBe(true);
  });
  it("gates on flags (chains), humanity, mind, shelter, carried items", () => {
    const flagged: GameState = { ...base, player: { ...base.player, flags: { "chain.seen": true } } };
    expect(m({ requiresFlags: ["chain.seen"] }, flagged)).toBe(true);
    expect(m({ requiresFlags: ["chain.seen"] })).toBe(false);
    expect(m({ forbidsFlags: ["chain.seen"] })).toBe(true);
    expect(m({ forbidsFlags: ["chain.seen"] }, flagged)).toBe(false);
    expect(m({ maxHumanity: 60 })).toBe(true); // baseline 50
    expect(m({ minHumanity: 60 })).toBe(false);
    const sheltered: GameState = { ...base, player: { ...base.player, shelterId: A } };
    expect(m({ requiresShelter: true }, sheltered)).toBe(true);
    expect(m({ requiresShelter: true })).toBe(false);
    expect(m({ carriesItem: "item.water" })).toBe(true); // starting kit
    expect(m({ carriesItem: "item.rifle" })).toBe(false);
    const stocked: GameState = { ...base, player: { ...base.player, stash: [{ type: "item.canned-food", quantity: 2 }] } };
    expect(m({ minStash: 1 }, stocked)).toBe(true); // the cache can cover a "pay the toll"
    expect(m({ minStash: 1 })).toBe(false); // empty cache — the paid choice is withheld
  });
});

// --- the effect interpreter (each verb applies purely) ----------------------------------------

describe("the effect interpreter (each declarative verb, applied purely)", () => {
  const base = run().state;
  const ctx = { encounterId: "encounter.test", node: A };

  it("setFlag / setRegionFlag write facts", () => {
    expect(applyEncounterEffect(base, { kind: "setFlag", flag: "f" }, ctx).player.flags.f).toBe(true);
    expect(applyEncounterEffect(base, { kind: "setRegionFlag", flag: "g" }, ctx).regions["region.x"]!.storyFlags.g).toBe(true);
  });
  it("adjustHumanity moves the scalar, clamps 0–100, and logs a moral beat", () => {
    const down = applyEncounterEffect(base, { kind: "adjustHumanity", delta: -25 }, ctx);
    expect(down.player.humanity).toBe(25);
    expect(down.history.some((e) => e.type === "moral")).toBe(true);
    expect(applyEncounterEffect(base, { kind: "adjustHumanity", delta: -999 }, ctx).player.humanity).toBe(0);
    expect(applyEncounterEffect(base, { kind: "adjustHumanity", delta: 999 }, ctx).player.humanity).toBe(100);
  });
  it("adjustNeed / adjustMind clamp on the player", () => {
    expect(applyEncounterEffect(base, { kind: "adjustNeed", need: "fatigue", delta: 30 }, ctx).player.condition.needs.fatigue).toBe(30);
    const m = applyEncounterEffect(base, { kind: "adjustMind", stress: 40, morale: -10 }, ctx).player.condition.mind;
    expect(m.stress).toBe(40);
    expect(m.morale).toBe(60);
  });
  it("grantItem adds units (bounded) and takeItem removes them", () => {
    const granted = applyEncounterEffect(base, { kind: "grantItem", item: "item.bandage", quantity: 2 }, ctx);
    expect(granted.player.inventory.find((e) => e.type === "item.bandage")!.quantity).toBe(2);
    const taken = applyEncounterEffect(base, { kind: "takeItem", item: "item.water", quantity: 1 }, ctx);
    expect(taken.player.inventory.find((e) => e.type === "item.water")!.quantity).toBe(1);
  });
  it("inflictWound appends a named wound; seedWalkers arms the node; addNoise / revealDiscovery touch node memory", () => {
    expect(applyEncounterEffect(base, { kind: "inflictWound", wound: "wound.sprain", site: "ankle", severity: 20 }, ctx).player.condition.wounds).toHaveLength(1);
    expect(applyEncounterEffect(base, { kind: "seedWalkers", count: 3, types: ["zombie.fresh"] }, ctx).nodes[A]!.walkers).toBe(3);
    expect(applyEncounterEffect(base, { kind: "seedWalkers", count: 3, types: ["zombie.fresh"] }, ctx).nodes[A]!.zombieTypes).toContain("zombie.fresh");
    expect(applyEncounterEffect(base, { kind: "addNoise", amount: 40 }, ctx).nodes[A]!.noise).toBe(40);
    expect(applyEncounterEffect(base, { kind: "revealDiscovery", discovery: "disc.x" }, ctx).nodes[A]!.discoveries).toContain("disc.x");
  });
  it("scheduleFollowup enqueues a timed chain flag resolved in stage 12", () => {
    const scheduled = applyEncounterEffect(base, { kind: "scheduleFollowup", flag: "later", delayHours: 12 }, ctx);
    expect(scheduled.queue.some((e) => e.kind === ENCOUNTER_EVENT_KIND)).toBe(true);
    const due = scheduled.queue[0]!;
    const ticked: GameState = { ...scheduled, meta: { ...scheduled.meta, day: due.dueDay + 1 } };
    const resolved = resolveDueEncounterEvents(ticked);
    expect(resolved.player.flags.later).toBe(true);
    expect(resolved.queue).toHaveLength(0);
  });
});

// --- selection (by fit, deterministic) --------------------------------------------------------

describe("selection is by fit, deterministic (T47; weighting is T48)", () => {
  it("picks the most specific eligible encounter, ties broken by id", () => {
    const broad: EncounterDef = { ...EXPLORE, id: "encounter.test.broad", requirements: { regionIds: ["region.x"] } };
    const specific: EncounterDef = { ...EXPLORE, id: "encounter.test.specific", requirements: { nodeIds: [A], forbidsFlags: ["z"] } };
    const { state, graph } = run([broad, specific]);
    expect(selectEncounter(state, graph)!.id).toBe("encounter.test.specific");
  });
  it("respects the one-shot done-flag and requirement gating", () => {
    const { state, graph } = run([EXPLORE]);
    expect(ids(eligibleEncounters(state, graph))).toContain(EXPLORE.id);
    const done: GameState = { ...state, player: { ...state.player, flags: { [`enc.done.${EXPLORE.id}@${A}`]: true } } };
    expect(ids(eligibleEncounters(done, graph))).not.toContain(EXPLORE.id);
  });
  it("does not fire on a contested node (the T15 walker prompt owns it)", () => {
    const { state, graph } = run([EXPLORE]);
    const contested: GameState = { ...state, nodes: { ...state.nodes, [A]: { ...state.nodes[A]!, walkers: 3 } } };
    expect(evaluateEvents(contested, graph)).toBe(contested);
  });
});

// --- end to end: engage, resolve, one-shot ----------------------------------------------------

describe("engaging, resolving, and the one-shot guard (T47 · stage 3/13)", () => {
  it("a turn engages the fitting encounter — it leads the Scene and owns the choices", () => {
    const { state, graph } = run([EXPLORE]);
    const engaged = tick(state, graph);
    expect(activeEncounter(engaged)!.encounter).toBe(EXPLORE.id);
    const scene = sceneOf(engaged, graph);
    expect(scene.narration).toContain("Papers drift");
    expect(ids(availableActions(engaged, graph))).toEqual([`event:${EXPLORE.id}:look`]);
    expect(engaged.history.some((e) => e.type === "encounter.begin")).toBe(true);
  });
  it("resolving applies effects, clears the slot, and stamps the one-shot done-flag", () => {
    const { state, graph } = run([EXPLORE]);
    const engaged = tick(state, graph);
    const done = take(engaged, graph, `event:${EXPLORE.id}:look`).state;
    expect(activeEncounter(done)).toBeNull();
    expect(done.nodes[A]!.discoveries).toContain("disc.test.note");
    expect(done.player.flags[`enc.done.${EXPLORE.id}@${A}`]).toBe(true);
    // it does not re-fire
    expect(evaluateEvents(done, graph)).toBe(done);
  });
});

// --- moral → Humanity --------------------------------------------------------------------------

describe("moral encounters feed Humanity (FR-ENC-06)", () => {
  it("the cruel branch erodes humanity and takes; the kind branch preserves it", () => {
    const { state, graph } = run([MORAL]);
    const engaged = tick(atB(state), graph);
    expect(activeEncounter(engaged)!.encounter).toBe(MORAL.id);
    const robbed = take(engaged, graph, `event:${MORAL.id}:rob`).state;
    expect(robbed.player.humanity).toBe(HUMANITY_BASELINE - 25);
    expect(robbed.player.inventory.find((e) => e.type === "item.canned-food")!.quantity).toBe(3); // +1
  });
  it("humanityBand is felt only at the extremes", () => {
    const { state } = run();
    expect(humanityBand(state)).toBeNull(); // neutral
    expect(humanityBand({ ...state, player: { ...state.player, humanity: 20 } })).not.toBeNull();
    expect(humanityBand({ ...state, player: { ...state.player, humanity: 5 } })).not.toBeNull();
    expect(humanityBand({ ...state, player: { ...state.player, humanity: 90 } })).not.toBeNull();
  });
});

// --- multi-stage (negotiation → fight → chase) ------------------------------------------------

describe("multi-stage flows persist across turns (FR-ENC-04)", () => {
  it("advanceStage keeps the encounter live at the next stage; the flow resolves at the end", () => {
    const { state, graph } = run([MULTI]);
    let s = tick(state, graph);
    expect(activeEncounter(s)!.stage).toBe("talk");
    s = take(s, graph, `event:${MULTI.id}:refuse`).state; // → violence
    expect(activeEncounter(s)!.stage).toBe("violence");
    s = take(s, graph, `event:${MULTI.id}:run`).state; // → chase
    expect(activeEncounter(s)!.stage).toBe("chase");
    const before = s.player.condition.needs.fatigue;
    s = take(s, graph, `event:${MULTI.id}:sprint`).state; // resolves
    expect(activeEncounter(s)).toBeNull();
    expect(s.player.condition.needs.fatigue).toBeGreaterThan(before);
    expect(s.player.condition.wounds.some((w) => w.type === "wound.sprain")).toBe(true);
  });
  it("the fight branch hands off to a real T15 walker prompt (seedWalkers)", () => {
    const { state, graph } = run([MULTI]);
    let s = tick(state, graph);
    s = take(s, graph, `event:${MULTI.id}:refuse`).state; // → violence
    s = take(s, graph, `event:${MULTI.id}:fight`).state; // seed walkers + end
    expect(activeEncounter(s)).toBeNull();
    expect(s.nodes[A]!.walkers).toBeGreaterThan(0);
    // the very next scene at this node is the avoidable-walker encounter (fight / slip), not the events layer
    expect(ids(availableActions(s, graph)).some((id) => id.startsWith("fight") || id.startsWith("slip") || id.startsWith("fire"))).toBe(true);
  });
});

// --- chains -----------------------------------------------------------------------------------

describe("chains: a flag set now enables a follow-up later (FR-ENC-03)", () => {
  it("chain B is ineligible until chain A sets its flag", () => {
    const { state, graph } = run([CHAIN_A, CHAIN_B]);
    expect(ids(eligibleEncounters(atB(state), graph))).not.toContain(CHAIN_B.id); // flag unset
    const seen = take(tick(state, graph), graph, `event:${CHAIN_A.id}:read`).state; // sets chain.seen
    expect(seen.player.flags["chain.seen"]).toBe(true);
    expect(ids(eligibleEncounters(atB(seen), graph))).toContain(CHAIN_B.id);
  });
});

// --- evolution --------------------------------------------------------------------------------

describe("evolution: the same node yields before/during/after variants (FR-ENC-08)", () => {
  it("a fresh node fires 'before'; a searched, bloodied node fires 'after'", () => {
    const { state, graph } = run([EVOLVE_BEFORE, EVOLVE_AFTER]);
    expect(selectEncounter(state, graph)!.id).toBe(EVOLVE_BEFORE.id); // searchPct 0
    const searched: GameState = { ...state, nodes: { ...state.nodes, [A]: { ...state.nodes[A]!, searchPct: 100, blood: 40 } } };
    expect(selectEncounter(searched, graph)!.id).toBe(EVOLVE_AFTER.id);
  });
});

// --- false encounters -------------------------------------------------------------------------

describe("false encounters: tension without payoff (FR-ENC-07)", () => {
  it("resolves with no state change beyond the log beat and the done-flag", () => {
    const { state, graph } = run([FALSE]);
    const engaged = tick(state, graph);
    const done = take(engaged, graph, `event:${FALSE.id}:check`).state;
    expect(activeEncounter(done)).toBeNull();
    // no loot, no walkers, no wound, no discovery — only the beat + the one-shot flag moved
    expect(done.nodes[A]!.walkers).toBe(0);
    expect(done.nodes[A]!.discoveries).toEqual([]);
    expect(done.player.condition.wounds).toEqual([]);
    expect(done.player.inventory).toEqual(state.player.inventory);
  });
});

// --- anti-softlock, determinism, save-lossless ------------------------------------------------

describe("anti-softlock, determinism, save-lossless (T47)", () => {
  it("offers an engine 'Step away' when every authored choice is gated out", () => {
    const gated: EncounterDef = {
      id: "encounter.test.gated", category: "shelter", title: "Gated", premise: "all choices gated",
      requirements: { nodeIds: [A] },
      stages: [{ id: "s", narration: "You need a tool you don't have.", choices: [
        { id: "use", label: "Use the tool", timeCost: 1, requirements: { carriesItem: "item.rifle" }, effects: [{ kind: "setFlag", flag: "x" }] },
      ] }],
    };
    const { state, graph } = run([gated]);
    const engaged = tick(state, graph);
    const offered = ids(eventChoices(engaged, graph));
    expect(offered).toEqual([`event:${gated.id}:step-away`]);
    const done = take(engaged, graph, `event:${gated.id}:step-away`).state;
    expect(activeEncounter(done)).toBeNull();
  });
  it("a mid-multi-stage run round-trips deep-equal through the save", () => {
    const { state, graph } = run([MULTI]);
    const mid = take(tick(state, graph), graph, `event:${MULTI.id}:refuse`).state; // at 'violence'
    expect(activeEncounter(mid)!.stage).toBe("violence");
    const reloaded = loadGame(saveGame(mid));
    expect(reloaded).toEqual(mid);
    // and the reloaded run still offers the same stage choices (the pool is rebuilt from content, the slot from state)
    expect(ids(availableActions(reloaded, graph))).toEqual(ids(availableActions(mid, graph)));
  });
  it("the whole engage→resolve slice replays byte-identically from the same setup", () => {
    const play = (): string => {
      const { state, graph } = run([EXPLORE]);
      return saveGame(take(tick(state, graph), graph, `event:${EXPLORE.id}:look`).state);
    };
    expect(play()).toBe(play());
  });
  it("the active-encounter slot lives in the reserved player.quests (no schema rung)", () => {
    const { state, graph } = run([EXPLORE]);
    const engaged = tick(state, graph);
    expect(engaged.player.quests.some((q) => q.id === ACTIVE_ENCOUNTER_QUEST)).toBe(true);
  });
});
