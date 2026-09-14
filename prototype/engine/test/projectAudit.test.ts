import { describe, expect, it } from "vitest";
import {
  startRun,
  buildRegionGraph,
  applyAction,
  availableActions,
  runEndReason,
  projectLine,
  projectChoices,
  projectStagesDone,
  projectAlarm,
  committedProject,
  hasCommitted,
  affordablePayment,
  resolveProjectAction,
  stageDone,
  nextStage,
  wonEnding,
  projectCommitFlag,
  projectStageFlag,
  PROJECT_ALARM_PER_STAGE,
  MapError,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type ProjectDef,
  type ItemInstance,
} from "../src/index.js";

/**
 * T87 — the adversarial audit's findings, each pinned by the test that FAILS against the unfixed code.
 *
 * Seven of the nine claims two audit subagents brought back were real. The rule this file exists for is
 * the one that has now arrived six tasks running (T77, T82, T83, T84, T85, T86): **an audit fix still
 * needs its own test, and the test must be run against the UNFIXED tree before it is believed.** Every
 * case below was run against a copy of the pre-fix tree at `/root/zb-unfixed` and observed to fail
 * there — T86's variant of this lesson was three tests that existed, passed, and were VACUOUS.
 */

const REGIONS: RegionDef[] = [
  { id: "region.r", name: "R", description: "r", baseline: { threat: 20, zombieDensity: 30, survivorActivity: 10, loot: 80 } },
  { id: "region.s", name: "S", description: "s", baseline: { threat: 20, zombieDensity: 30, survivorActivity: 10, loot: 80 } },
];
const NODES: NodeDef[] = [
  { id: "node.r.home", regionId: "region.r", name: "Home", description: "a depot", adjacent: ["node.r.b"], start: true, claimable: true },
  { id: "node.r.b", regionId: "region.r", name: "B", description: "a lot", adjacent: ["node.r.home", "node.s.c"] },
  { id: "node.s.c", regionId: "region.s", name: "C", description: "a yard", adjacent: ["node.r.b"] },
];
const ESCAPE: ProjectDef = {
  id: "project.departure.test", kind: "escape", label: "The Test Road", premise: "a way out",
  stages: [
    { id: "one", label: "Stage one", worldEffect: "it stands", accepts: [{ item: "item.scrap", qty: 2 }], timeCost: 2, escalation: { threat: 5, survivorActivity: 3 } },
    { id: "two", label: "Stage two", worldEffect: "it runs", accepts: [{ item: "item.scrap", qty: 2 }], timeCost: 2 },
    { id: "three", label: "Stage three", worldEffect: "it goes", accepts: [{ item: "item.scrap", qty: 2 }], timeCost: 2 },
  ],
  ending: "THE ROAD ENDING.",
};
const HOLDOUT: ProjectDef = {
  id: "project.holdout.test", kind: "holdout", label: "The Test Block", premise: "stay",
  stages: [{ id: "only", label: "Only stage", worldEffect: "it holds", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 2 }],
  ending: "THE BLOCK ENDING.",
};

const opts = { seed: "audit-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (projects: ProjectDef[] = [ESCAPE, HOLDOUT]): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], projects);

function based(state: GameState, inv: { type: string; quantity: number; itemId?: string }[]): GameState {
  const here = "node.r.home";
  return {
    ...state,
    player: {
      ...state.player, location: here, shelterId: here, inventory: inv,
      condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } },
    },
  };
}
const take = (state: GameState, graph: RegionGraph, prefix: string): GameState => {
  const c = availableActions(state, graph).find((x) => x.id.startsWith(prefix))!;
  expect(c, prefix).toBeDefined();
  return applyAction(state, c.action, graph).state;
};

// --- FINDING 1: the siting rule was enforced only in the CHOICE list --------------------------------

describe("the work is at the base, and the RESOLVER is where that is true", () => {
  it("refuses a forged advance submitted from another district", () => {
    const { state, graph } = run();
    let s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    const away: GameState = { ...s, player: { ...s.player, location: "node.s.c" } };
    expect(projectChoices(away, graph)).toEqual([]);
    const forged = { type: "project-advance", timeCost: 0, params: { project: ESCAPE.id, stage: "one" } };
    // Pipeline stage 1 runs `assertLegal` ONLY for an action carrying a choiceId, so this reaches the
    // resolver untouched. Before the fix it landed the stage, for free, in the wrong region.
    expect(resolveProjectAction(away, graph, forged)).toBe(away);
    expect(applyAction(away, forged, graph).state.story.endingFlags).toEqual(away.story.endingFlags);
    expect(stageDone(away, ESCAPE.id, "one")).toBe(false);
  });

  it("refuses the WHOLE project from another district — no free win", () => {
    const { state, graph } = run();
    let s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    s = { ...s, player: { ...s.player, location: "node.s.c" } };
    for (const stage of ESCAPE.stages) {
      s = applyAction(s, { type: "project-advance", timeCost: 0, params: { project: ESCAPE.id, stage: stage.id } }, graph).state;
    }
    expect(projectStagesDone(s)).toBe(0);
    expect(wonEnding(s)).toBeNull();
    expect(runEndReason(s)).toBeNull();
  });

  it("refuses a forged COMMIT from another district too", () => {
    const { state, graph } = run();
    const away: GameState = { ...based(state, [{ type: "item.scrap", quantity: 9 }]), player: { ...based(state, []).player, location: "node.s.c", shelterId: "node.r.home" } };
    expect(resolveProjectAction(away, graph, { type: "project-commit", timeCost: 1, params: { project: ESCAPE.id } })).toBe(away);
    expect(hasCommitted(away)).toBe(false);
  });

  /**
   * `escalate` was also changed to read the SHELTER's region rather than the player's current node's,
   * and that change is **deliberately unobservable** once the guard above exists: the resolver now
   * refuses any advance where `location !== shelterId`, so the two reads can never disagree. Declared
   * rather than "covered", because a test written for it would have to forge a state the engine can no
   * longer produce — and the audit's lesson this task is that a test which passes against the unfixed
   * code is worse than no test. (This first FAILED that standard: the version below passed against the
   * pre-fix tree, because the player is standing at the base in it.) What is pinned here is the
   * OUTCOME: a region-scoped stage lands on the base's region and nowhere else.
   */
  it("lands a region-scoped escalation on the base's region and nowhere else", () => {
    const { state, graph } = run();
    const s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    const beforeR = s.regions["region.r"]!.threat;
    const beforeS = s.regions["region.s"]!.threat;
    const after = resolveProjectAction(s, graph, { type: "project-advance", timeCost: 2, params: { project: ESCAPE.id, stage: "one" } });
    expect(after.regions["region.r"]!.threat).toBe(beforeR + 5);
    expect(after.regions["region.s"]!.threat).toBe(beforeS);
    // the invariant that makes the scope unambiguous, asserted directly
    expect(after.player.location).toBe(after.player.shelterId);
  });
});

// --- FINDING 2: a stage id could collide with the commit flag ---------------------------------------

describe("no author-supplied id can collide with the commitment", () => {
  const COLLIDER: ProjectDef = {
    id: "project.holdout.collide", kind: "holdout", label: "Collider", premise: "p",
    stages: [
      { id: "first", label: "First", worldEffect: "w", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 1 },
      { id: "committed", label: "Committed", worldEffect: "w", accepts: [{ item: "item.scrap", qty: 9 }], timeCost: 1, escalation: { threat: 9 } },
    ],
    ending: "COLLIDER ENDING.",
  };

  it("a stage literally named `committed` is NOT completed by committing", () => {
    const { state, graph } = run([COLLIDER]);
    const s = take(based(state, [{ type: "item.scrap", quantity: 1 }]), graph, "project-commit:project.holdout.collide");
    expect(hasCommitted(s)).toBe(true);
    expect(stageDone(s, COLLIDER.id, "committed")).toBe(false);
    expect(projectStagesDone(s)).toBe(0);
    expect(projectAlarm(s)).toBe(0);
    // ...and the run cannot be won out of the one scrap it is holding
    const after = take(s, graph, "project-advance:");
    expect(stageDone(after, COLLIDER.id, "first")).toBe(true);
    expect(wonEnding(after)).toBeNull();
    expect(nextStage(after, COLLIDER)?.id).toBe("committed");
    expect(affordablePayment(after, COLLIDER.stages[1]!)).toBeNull();
  });

  it("a ONE-stage project named `committed` is not silently unfinishable-and-silent", () => {
    const ONLY: ProjectDef = { ...COLLIDER, id: "project.holdout.only", stages: [COLLIDER.stages[1]!] };
    const { state, graph } = run([ONLY]);
    const s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.holdout.only");
    expect(nextStage(s, ONLY)?.id).toBe("committed");
    expect(projectChoices(s, graph).length).toBe(1);
    expect(projectLine(s, graph)).toBe("");
    const won = take(s, graph, "project-advance:");
    expect(wonEnding(won)).toBe("held");
  });
});

// --- FINDING 3: the base can be LOST after you commit ----------------------------------------------

describe("losing the base does not produce a sentence pointing at a base you do not have", () => {
  it("says there is no base, rather than sending you to one", () => {
    const { state, graph } = run();
    const s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    const homeless: GameState = { ...s, player: { ...s.player, shelterId: null } };
    const line = projectLine(homeless, graph);
    expect(line).not.toContain("at your base");
    expect(line).toContain("no base");
    expect(projectChoices(homeless, graph)).toEqual([]);
    // and the run is not soft-locked: the ordinary verbs are all still there
    expect(availableActions(homeless, graph).length).toBeGreaterThan(0);
  });
});

// --- FINDING 4: exclusivity was pool-relative, not save-relative ------------------------------------

describe("the fork is exclusive across a CONTENT CHANGE, because the flags are the save", () => {
  it("a commitment to a retired project still forecloses the other one", () => {
    const { state, graph } = run();
    const s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    // the escape project is retired from the set; only the holdout ships in the next build
    const { graph: g2 } = run([HOLDOUT]);
    expect(committedProject(s, g2)).toBeNull();
    expect(hasCommitted(s)).toBe(true);
    expect(projectChoices(s, g2)).toEqual([]);
    expect(resolveProjectAction(s, g2, { type: "project-commit", timeCost: 1, params: { project: HOLDOUT.id } })).toBe(s);
    expect(s.story.endingFlags[projectCommitFlag(HOLDOUT.id)]).toBeUndefined();
  });
});

// --- FINDING 5: duplicate stage ids -----------------------------------------------------------------

describe("ids that are save data are unique, and the graph refuses content where they are not", () => {
  it("throws on a project that repeats a stage id", () => {
    const dup: ProjectDef = { ...ESCAPE, stages: [ESCAPE.stages[0]!, { ...ESCAPE.stages[1]!, id: "one" }] };
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [dup])).toThrow(MapError);
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [dup])).toThrow(/stage id/);
  });

  it("throws on two projects sharing an id", () => {
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [ESCAPE, { ...HOLDOUT, id: ESCAPE.id }])).toThrow(MapError);
  });

  it("accepts the ordinary set", () => {
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [ESCAPE, HOLDOUT])).not.toThrow();
  });
});

// --- FINDING 7: a tracked artifact is not currency --------------------------------------------------

describe("a project is paid in STACKS — a tracked artifact is never spent as one", () => {
  const WEAPONISED: ProjectDef = {
    ...HOLDOUT, id: "project.holdout.weapon",
    stages: [{ id: "only", label: "Only", worldEffect: "w", accepts: [{ item: "item.pipe", qty: 1 }], timeCost: 1 }],
  };

  it("does not count, spend, or orphan an equipped artifact", () => {
    const { state, graph } = run([WEAPONISED]);
    const art: ItemInstance = { type: "item.pipe", quality: 100, durability: 80, metadata: {} };
    let s = based(state, [{ type: "item.pipe", quantity: 1, itemId: "art-1" }]);
    s = { ...s, items: { ...s.items, "art-1": art }, player: { ...s.player, equipment: { ...s.player.equipment, weapon: "art-1" } } };
    s = take(s, graph, "project-commit:project.holdout.weapon");
    expect(affordablePayment(s, WEAPONISED.stages[0]!)).toBeNull();
    expect(projectChoices(s, graph)).toEqual([]);
    // the artifact is untouched: still carried, still in the record, still in the hand
    expect(s.player.inventory.some((e) => e.itemId === "art-1")).toBe(true);
    expect(s.items["art-1"]).toBeDefined();
    // ...and a forged advance cannot spend it either
    const forged = resolveProjectAction(s, graph, { type: "project-advance", timeCost: 1, params: { project: WEAPONISED.id, stage: "only" } });
    expect(forged).toBe(s);
  });

  it("spends the ordinary stack and leaves the artifact of the same type alone", () => {
    const { state, graph } = run([WEAPONISED]);
    const art: ItemInstance = { type: "item.pipe", quality: 100, durability: 80, metadata: {} };
    let s = based(state, [{ type: "item.pipe", quantity: 1, itemId: "art-1" }, { type: "item.pipe", quantity: 2 }]);
    s = { ...s, items: { ...s.items, "art-1": art } };
    s = take(s, graph, "project-commit:project.holdout.weapon");
    expect(affordablePayment(s, WEAPONISED.stages[0]!)).toEqual({ item: "item.pipe", qty: 1 });
    const after = take(s, graph, "project-advance:");
    expect(after.player.inventory.find((e) => e.itemId === "art-1")?.quantity).toBe(1);
    expect(after.player.inventory.find((e) => e.type === "item.pipe" && e.itemId === undefined)?.quantity).toBe(1);
  });
});

// --- the module answers to its own verbs only -------------------------------------------------------

describe("resolveProjectAction is not a back door for other action types", () => {
  it("ignores an action that is not one of its two verbs, even carrying the right params", () => {
    const { state, graph } = run();
    const s = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    for (const t of ["move", "search", "craft", "rest"]) {
      expect(resolveProjectAction(s, graph, { type: t, timeCost: 1, params: { project: ESCAPE.id, stage: "one" } })).toBe(s);
    }
    expect(projectStagesDone(s)).toBe(0);
  });

  it("truncates a fractional qty on the READ as well as the debit", () => {
    const FRACTION: ProjectDef = {
      ...HOLDOUT, id: "project.holdout.fraction",
      stages: [{ id: "only", label: "Only", worldEffect: "w", accepts: [{ item: "item.scrap", qty: 1.5 } as unknown as { item: string; qty: number }], timeCost: 1 }],
    };
    const { state, graph } = run([FRACTION]);
    const s = take(based(state, [{ type: "item.scrap", quantity: 1 }]), graph, "project-commit:project.holdout.fraction");
    expect(affordablePayment(s, FRACTION.stages[0]!)).toEqual({ item: "item.scrap", qty: 1 });
    const after = take(s, graph, "project-advance:");
    expect(after.player.inventory.filter((e) => e.type === "item.scrap").reduce((a, e) => a + e.quantity, 0)).toBe(0);
  });
});
