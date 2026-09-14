import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  runEndReason,
  isRunOver,
  endingNarration,
  RUN_END_REASONS,
  driftAnchor,
  driftRegions,
  projectsActive,
  projectPool,
  committedProject,
  stageDone,
  nextStage,
  projectStagesDone,
  projectAlarm,
  wonEnding,
  affordablePayment,
  projectChoices,
  isProjectAction,
  resolveProjectAction,
  projectLine,
  winNarration,
  PROJECT_ALARM_PER_STAGE,
  PROJECT_ALARM_CAP,
  PROJECT_COMMIT_COST,
  PROJECT_STAGE_FLAG_PREFIX,
  PROJECT_COMMIT_FLAG_PREFIX,
  hasCommitted,
  ENDING_FLAG_ESCAPED,
  ENDING_FLAG_HELD,
  projectCommitFlag,
  projectStageFlag,
  NEED_FATAL,
  SAVE_SCHEMA_VERSION,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type ProjectDef,
} from "../src/index.js";

/**
 * T87 — the terminal project: the first way a run can end WELL.
 *
 * Five claims under test, in the order the task depends on them:
 *
 *   1. **The gate holds.** A content set that authors no project gets no verbs, no flags, no
 *      escalation and the same four losing run-end reasons it always had — and its drift anchor is
 *      arithmetically the pre-T87 one. Every assertion here has an unauthored twin.
 *   2. **The choice is a FORK, not a checklist.** Both projects are offered; committing to one
 *      forecloses the other, in the offered list AND at the resolve layer.
 *   3. **A stage is paid with ANY ONE of a menu, in order, and exactly that is debited.** This is the
 *      thing the measurement forced (see `sim/project.ts`), so it is the thing most worth pinning.
 *   4. **The last stage ENDS the run, well.** `runEndReason` reaches `escaped`/`held`, `isRunOver` is
 *      true, nothing further is offered, and the scene closes on the project's own words.
 *   5. **Every stage raises something**, and the standing lift is bounded, derived, and off by default.
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
    { id: "one", label: "Stage one", worldEffect: "it stands", accepts: [{ item: "item.scrap", qty: 2 }, { item: "item.cloth", qty: 1 }], timeCost: 2, escalation: { threat: 5, survivorActivity: 3 } },
    { id: "two", label: "Stage two", worldEffect: "it runs", accepts: [{ item: "item.scrap", qty: 3 }], timeCost: 2, noise: 30, escalation: { threat: 4, scope: "city" } },
  ],
  ending: "THE ROAD ENDING.",
};
const HOLDOUT: ProjectDef = {
  id: "project.holdout.test", kind: "holdout", label: "The Test Block", premise: "stay",
  stages: [{ id: "only", label: "Only stage", worldEffect: "it holds", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 2 }],
  ending: "THE BLOCK ENDING.",
};

const opts = { seed: "project-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (projects: ProjectDef[] = [ESCAPE, HOLDOUT]): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], projects);

/** Stand the player in a claimed base holding `inv`, with no clock pressure. */
function based(state: GameState, inv: { type: string; quantity: number }[]): GameState {
  const here = "node.r.home";
  return {
    ...state,
    player: {
      ...state.player,
      location: here,
      shelterId: here,
      inventory: inv,
      condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } },
    },
  };
}

const graphOf = (): RegionGraph => run().graph;
const ids = (state: GameState, graph: RegionGraph): string[] => availableActions(state, graph).map((c) => c.id);
const held = (s: GameState, t: string): number => s.player.inventory.filter((e) => e.type === t).reduce((a, e) => a + e.quantity, 0);
const take = (state: GameState, graph: RegionGraph, prefix: string): GameState => {
  const choice = availableActions(state, graph).find((c) => c.id.startsWith(prefix));
  expect(choice, `no choice starting "${prefix}" in [${ids(state, graph).join(", ")}]`).toBeDefined();
  return applyAction(state, choice!.action, graph).state;
};

// --- 1. the gate ----------------------------------------------------------------------------------

describe("the gate: an unauthored content set is the pre-T87 game exactly", () => {
  it("registers no pool, offers no verb, and leaves endingFlags empty", () => {
    const { state, graph } = run([]);
    expect(projectsActive(graph)).toBe(false);
    expect(projectPool(graph)).toEqual([]);
    const s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    expect(projectChoices(s, graph)).toEqual([]);
    expect(ids(s, graph).some((i) => i.startsWith("project-"))).toBe(false);
    // the house idiom, pinned by the mutation sweep: a pool-less graph carries NO `projects` key at
    // all, exactly as it carries no `weapons`/`recipes`/`jobs` key. An empty array would behave the
    // same today and quietly break the "is this system registered" read every other pool uses.
    expect("projects" in graph).toBe(false);
    expect(projectLine(s, graph)).toBe("");
    expect(s.story.endingFlags).toEqual({});
    expect(committedProject(s, graph)).toBeNull();
  });

  it("cannot reach a winning run-end reason, and a forged project action is a no-op", () => {
    const { state, graph } = run([]);
    const s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    expect(wonEnding(s)).toBeNull();
    expect(runEndReason(s)).toBeNull();
    const forged = { type: "project-commit", choiceId: "project-commit:project.departure.test", timeCost: 1, params: { project: "project.departure.test" } };
    expect(resolveProjectAction(s, graph, forged)).toBe(s);
  });

  it("the drift anchor with no alarm is arithmetically the T79 anchor", () => {
    const base = REGIONS[0]!.baseline;
    expect(driftAnchor(base, 5, 2, 3)).toEqual(driftAnchor(base, 5, 2, 3, 0));
    // ...and a run that has finished nothing supplies exactly that 0.
    const { state } = run([ESCAPE, HOLDOUT]);
    expect(projectAlarm(state)).toBe(0);
  });

  it("a whole unauthored run saves and reloads byte-identically to itself", () => {
    const { state, graph } = run([]);
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    for (let i = 0; i < 6 && !isRunOver(s); i += 1) {
      const c = availableActions(s, graph)[0];
      if (c === undefined) break;
      s = applyAction(s, c.action, graph).state;
    }
    expect(saveGame(loadGame(saveGame(s)))).toBe(saveGame(s));
    expect(s.meta.version).toBe(SAVE_SCHEMA_VERSION);
  });
});

// --- 2. the fork ----------------------------------------------------------------------------------

describe("committing is a FORK: one project per run, and the other is the road not taken", () => {
  it("offers every authored project at your own base, and nowhere else", () => {
    const { state, graph } = run();
    const s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    const offered = ids(s, graph).filter((i) => i.startsWith("project-commit:"));
    expect(offered).toEqual(["project-commit:project.departure.test", "project-commit:project.holdout.test"]);
    // away from the base there is no commit verb at all
    const away = { ...s, player: { ...s.player, location: "node.r.b" } };
    expect(projectChoices(away, graph)).toEqual([]);
    // and with no base there is none either
    const homeless = { ...s, player: { ...s.player, shelterId: null } };
    expect(projectChoices(homeless, graph)).toEqual([]);
  });

  it("committing sets exactly one flag, costs an hour, and withdraws BOTH commit offers", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    const commit = availableActions(s, graph).find((c) => c.id === "project-commit:project.departure.test")!;
    expect(commit.timeCost).toBe(PROJECT_COMMIT_COST);
    expect(PROJECT_COMMIT_COST).toBeGreaterThan(0);
    s = applyAction(s, commit.action, graph).state;
    expect(s.story.endingFlags[projectCommitFlag(ESCAPE.id)]).toBe(true);
    expect(s.story.endingFlags[projectCommitFlag(HOLDOUT.id)]).toBeUndefined();
    expect(committedProject(s, graph)?.id).toBe(ESCAPE.id);
    expect(ids(s, graph).filter((i) => i.startsWith("project-commit:"))).toEqual([]);
  });

  it("a FORGED second commit changes nothing", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.departure.test");
    const forged = { type: "project-commit", choiceId: "x", timeCost: 1, params: { project: HOLDOUT.id } };
    expect(resolveProjectAction(s, graph, forged)).toBe(s);
    expect(committedProject(s, graph)?.id).toBe(ESCAPE.id);
  });

  it("the road not taken cannot be worked on", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.departure.test");
    const forged = { type: "project-advance", choiceId: "x", timeCost: 2, params: { project: HOLDOUT.id, stage: "only" } };
    expect(resolveProjectAction(s, graph, forged)).toBe(s);
    expect(stageDone(s, HOLDOUT.id, "only")).toBe(false);
  });

  it("committing never narrows the way out — the no-soft-lock invariant (T57)", () => {
    const { state, graph } = run();
    const before = based(state, [{ type: "item.scrap", quantity: 0 }]);
    const beforeIds = ids(before, graph).filter((i) => !i.startsWith("project-"));
    const after = take(before, graph, "project-commit:project.departure.test");
    for (const id of beforeIds) expect(ids(after, graph)).toContain(id);
    expect(availableActions(after, graph).length).toBeGreaterThan(0);
  });
});

// --- 3. payment is a MENU ------------------------------------------------------------------------

describe("a stage is paid with ANY ONE of its menu, in order, and only that is debited", () => {
  const commit = (inv: { type: string; quantity: number }[]): { s: GameState; graph: RegionGraph } => {
    const { state, graph } = run();
    return { s: take(based(state, inv), graph, "project-commit:project.departure.test"), graph };
  };

  it("takes the FIRST affordable entry, not the cheapest or the last", () => {
    const { s, graph } = commit([{ type: "item.scrap", quantity: 2 }, { type: "item.cloth", quantity: 5 }]);
    expect(affordablePayment(s, ESCAPE.stages[0]!)).toEqual({ item: "item.scrap", qty: 2 });
    const after = take(s, graph, "project-advance:");
    expect(held(after, "item.scrap")).toBe(0);
    expect(held(after, "item.cloth")).toBe(5);
  });

  it("falls through to a later entry when the first is unaffordable", () => {
    const { s, graph } = commit([{ type: "item.scrap", quantity: 1 }, { type: "item.cloth", quantity: 2 }]);
    expect(affordablePayment(s, ESCAPE.stages[0]!)).toEqual({ item: "item.cloth", qty: 1 });
    const after = take(s, graph, "project-advance:");
    expect(held(after, "item.scrap")).toBe(1);
    expect(held(after, "item.cloth")).toBe(1);
  });

  it("offers NOTHING when no entry is affordable — and SAYS WHY (T86 finding 4)", () => {
    const { s, graph } = commit([{ type: "item.scrap", quantity: 1 }]);
    expect(affordablePayment(s, ESCAPE.stages[0]!)).toBeNull();
    expect(ids(s, graph).some((i) => i.startsWith("project-advance"))).toBe(false);
    const line = projectLine(s, graph);
    expect(line).not.toBe("");
    expect(line).toContain("scrap");
    expect(line).toContain("cloth");
    // ...but WITHOUT the digits. The choice row is the SCR-10 mono line and may carry a price; the
    // narration is prose and may not (FR-UI-02). The audit caught a first cut putting the whole
    // "2 scrap, 1 cloth · 2h" clause into `scene.narration`.
    expect(line).not.toMatch(/\d/);
    // The sentence reaches the PLAYER, not just the helper. Asserted as the whole line: the sweep
    // showed that dropping `projectLine` from `sceneOf` survived a `toContain("scrap")` check, because
    // other narration segments mention scrap too.
    expect(sceneOf(s, graph).narration).toContain(line);
    // and the CHOICE row, when there is one, does carry the price
    const payable = { ...s, player: { ...s.player, inventory: [{ type: "item.scrap", quantity: 2 }] } };
    expect(projectChoices(payable, graph)[0]!.label).toContain("2 scrap");
  });

  it("says where the work is when you are holding the price somewhere else", () => {
    const { s, graph } = commit([{ type: "item.scrap", quantity: 9 }]);
    const away = { ...s, player: { ...s.player, location: "node.r.b" } };
    expect(projectLine(away, graph)).toContain("at your base");
    expect(projectChoices(away, graph)).toEqual([]);
  });

  it("works the stages strictly in order, and a forged skip is a no-op", () => {
    const { s, graph } = commit([{ type: "item.scrap", quantity: 9 }]);
    expect(nextStage(s, ESCAPE)?.id).toBe("one");
    const skip = { type: "project-advance", choiceId: "x", timeCost: 2, params: { project: ESCAPE.id, stage: "two" } };
    expect(resolveProjectAction(s, graph, skip)).toBe(s);
    const after = take(s, graph, "project-advance:");
    expect(stageDone(after, ESCAPE.id, "one")).toBe(true);
    expect(nextStage(after, ESCAPE)?.id).toBe("two");
    // paying twice for the same stage is impossible: it is no longer next
    const repeat = { type: "project-advance", choiceId: "x", timeCost: 2, params: { project: ESCAPE.id, stage: "one" } };
    expect(resolveProjectAction(after, graph, repeat)).toBe(after);
  });

  it("a loud stage carries its noise into the action, like a molotov", () => {
    const { s, graph } = commit([{ type: "item.scrap", quantity: 9 }]);
    const after = take(s, graph, "project-advance:");
    const two = availableActions(after, graph).find((c) => c.id.startsWith("project-advance"))!;
    expect(two.action.params?.["noise"]).toBe(30);
    // ...and the quiet one does not carry the key at all
    const one = projectChoices(s, graph)[0]!;
    expect(one.action.params?.["noise"]).toBeUndefined();
  });
});

// --- 4. the run ends, WELL ------------------------------------------------------------------------

describe("the last stage ends the run, and it is not a death", () => {
  it("adds exactly two winning reasons to a list that had four losses and none", () => {
    expect(RUN_END_REASONS).toContain("escaped");
    expect(RUN_END_REASONS).toContain("held");
    expect(RUN_END_REASONS.filter((r) => r === "escaped" || r === "held")).toHaveLength(2);
  });

  it("finishing the holdout ends the run HELD, offers nothing further, and closes on the project's words", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.holdout.test");
    expect(runEndReason(s)).toBeNull();
    s = take(s, graph, "project-advance:");
    expect(s.story.endingFlags[ENDING_FLAG_HELD]).toBe(true);
    expect(s.story.endingFlags[ENDING_FLAG_ESCAPED]).toBeUndefined();
    expect(wonEnding(s)).toBe("held");
    expect(runEndReason(s)).toBe("held");
    expect(isRunOver(s)).toBe(true);
    expect(availableActions(s, graph)).toEqual([]);
    const scene = sceneOf(s, graph);
    expect(scene.choices).toEqual([]);
    expect(scene.narration).toBe(HOLDOUT.ending);
  });

  it("finishing the escape ends the run ESCAPED on its own words", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.departure.test");
    s = take(s, graph, "project-advance:");
    expect(runEndReason(s)).toBeNull();
    s = take(s, graph, "project-advance:");
    expect(runEndReason(s)).toBe("escaped");
    expect(sceneOf(s, graph).narration).toBe(ESCAPE.ending);
  });

  it("a won run whose pool is gone still closes on words, not on silence", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.holdout.test");
    s = take(s, graph, "project-advance:");
    const { graph: bare } = run([]);
    expect(winNarration(s, bare, "held").length).toBeGreaterThan(0);
    expect(winNarration(s, undefined, "escaped").length).toBeGreaterThan(0);
    expect(endingNarration("held").length).toBeGreaterThan(0);
    expect(endingNarration("escaped").length).toBeGreaterThan(0);
  });

  it("the grapple beats a finished project; a finished project beats thirst", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.holdout.test");
    s = take(s, graph, "project-advance:");
    expect(runEndReason(s)).toBe("held");
    // dying of thirst on the same frame does not take the win away
    const thirsty: GameState = { ...s, player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, thirst: NEED_FATAL } } } };
    expect(runEndReason(thirsty)).toBe("held");
    // ...but a Last Stand does, because it is the thing happening now
    const grabbed: GameState = {
      ...s,
      combat: {
        node: "node.r.home", enemy: "enemy.walker", hp: 5, maxHp: 10, alerted: true, grabbed: true,
      } as unknown as GameState["combat"],
      player: { ...s.player, condition: { ...s.player.condition, wounds: [
        { type: "wound.bite", site: "arm", severity: 90, treated: 0, inflictedDay: 1 }, { type: "wound.bite", site: "leg", severity: 90, treated: 0, inflictedDay: 1 },
      ] } },
    };
    expect(runEndReason(grabbed)).toBe("lastStand");
  });

  it("the flags cross a save at schema v10 — no migration rung", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.departure.test");
    s = take(s, graph, "project-advance:");
    const back = loadGame(saveGame(s));
    expect(back.meta.version).toBe(SAVE_SCHEMA_VERSION);
    expect(back.story.endingFlags).toEqual(s.story.endingFlags);
    expect(committedProject(back, graph)?.id).toBe(ESCAPE.id);
    expect(projectStagesDone(back)).toBe(1);
    expect(saveGame(back)).toBe(saveGame(s));
  });
});

// --- 5. every stage raises something --------------------------------------------------------------

describe("building toward the ending makes the city harder", () => {
  it("a region-scoped stage raises the SHELTER's region and leaves the others alone", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.departure.test");
    const beforeR = s.regions["region.r"]!;
    const beforeS = s.regions["region.s"]!;
    // Resolved directly, NOT through `applyAction`: the pipeline also drifts the world by the stage's
    // two hours, and a test that reads the sum is measuring the drift, not the escalation.
    const one = { type: "project-advance", choiceId: "x", timeCost: 2, params: { project: ESCAPE.id, stage: "one" } };
    const after = resolveProjectAction(s, graph, one);
    expect(after.regions["region.r"]!.threat).toBe(beforeR.threat + 5);
    expect(after.regions["region.r"]!.survivorActivity).toBe(beforeR.survivorActivity + 3);
    expect(after.regions["region.s"]!.threat).toBe(beforeS.threat);
    expect(after.regions["region.s"]!.survivorActivity).toBe(beforeS.survivorActivity);
  });

  it("END TO END, the turn a stage lands leaves the region strictly higher than the same turn without it", () => {
    const { state, graph } = run();
    const committed = take(based(state, [{ type: "item.scrap", quantity: 9 }]), graph, "project-commit:project.departure.test");
    const built = take(committed, graph, "project-advance:");
    // the same turn spent on anything else, from the identical state
    const other = availableActions(committed, graph).find((c) => c.id.startsWith("rest") || c.id.startsWith("search") || c.id.startsWith("move"))!;
    const idle = applyAction(committed, other.action, graph).state;
    expect(built.regions["region.r"]!.threat).toBeGreaterThan(idle.regions["region.r"]!.threat);
    expect(built.regions["region.r"]!.survivorActivity).toBeGreaterThan(idle.regions["region.r"]!.survivorActivity);
  });

  it("a city-scoped stage raises EVERY region", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.departure.test");
    s = take(s, graph, "project-advance:");
    const before = { r: s.regions["region.r"]!.threat, s: s.regions["region.s"]!.threat };
    // resolve stage two directly so the run-end does not swallow the observation
    const two = { type: "project-advance", choiceId: "x", timeCost: 2, params: { project: ESCAPE.id, stage: "two" } };
    const after = resolveProjectAction(s, graph, two);
    expect(after.regions["region.r"]!.threat).toBe(before.r + 4);
    expect(after.regions["region.s"]!.threat).toBe(before.s + 4);
  });

  it("the standing alarm is derived from the flags, scales per stage and is capped", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    expect(projectAlarm(s)).toBe(0);
    s = take(s, graph, "project-commit:project.departure.test");
    // committing raises NOTHING: it is a decision, not a stage of work
    expect(projectStagesDone(s)).toBe(0);
    expect(projectAlarm(s)).toBe(0);
    s = take(s, graph, "project-advance:");
    expect(projectStagesDone(s)).toBe(1);
    expect(projectAlarm(s)).toBe(PROJECT_ALARM_PER_STAGE);
    // the cap binds: a content set may author up to six stages
    const many: GameState = { ...s, story: { ...s.story, endingFlags: Object.fromEntries(
      [...Array(6)].map((_, i) => [`${PROJECT_STAGE_FLAG_PREFIX}p.s${i}`, true]),
    ) } };
    expect(projectStagesDone(many)).toBe(6);
    expect(projectAlarm(many)).toBe(PROJECT_ALARM_CAP);
    expect(6 * PROJECT_ALARM_PER_STAGE).toBeGreaterThan(PROJECT_ALARM_CAP);
  });

  it("the alarm raises the anchor's threat and density but never its survivorActivity", () => {
    const base = REGIONS[0]!.baseline;
    const quiet = driftAnchor(base, 1, 0, 0, 0);
    const loud = driftAnchor(base, 1, 0, 0, PROJECT_ALARM_PER_STAGE);
    expect(loud.threat).toBe(quiet.threat + PROJECT_ALARM_PER_STAGE);
    expect(loud.zombieDensity).toBe(quiet.zombieDensity + PROJECT_ALARM_PER_STAGE);
    expect(loud.survivorActivity).toBe(quiet.survivorActivity);
    // and it is bounded at the anchor too, so no caller can smuggle one in
    expect(driftAnchor(base, 1, 0, 0, 9999)).toEqual(driftAnchor(base, 1, 0, 0, PROJECT_ALARM_CAP));
    expect(driftAnchor(base, 1, 0, 0, -50)).toEqual(quiet);
    expect(driftAnchor(base, 1, 0, 0, Number.NaN)).toEqual(quiet);
  });

  it("the drift ACTUALLY READS the alarm, at full strength, and stops at the cap", () => {
    // Two gaps the mutation sweep found, one after the other. First: replacing `projectAlarm(state)`
    // with a literal 0 inside `driftRegions` survived every other test here — `projectAlarm` being
    // right is worth nothing if the thing that ticks the world never asks it. Then, with a
    // greater-than assertion in place, SWAPPING the `neglect` and `alarm` arguments at the call site
    // ALSO survived: both are non-negative ints added into the same lift, so the swap is invisible to
    // any test that only asks "is it bigger". It is visible in the arithmetic, because the two clamps
    // differ (NEGLECT_CAP 10, PROJECT_ALARM_CAP 20) — so the assertion is exact.
    const { state } = run();
    const HOURS = 12;
    const TICKS = 10;
    const settled = (stages: number): number => {
      let s: GameState = { ...based(state, []), story: { ...state.story, endingFlags: Object.fromEntries(
        [...Array(stages)].map((_, i) => [projectStageFlag(ESCAPE.id, `s${i}`), true]),
      ) } };
      expect(projectAlarm(s)).toBe(Math.min(PROJECT_ALARM_CAP, stages * PROJECT_ALARM_PER_STAGE));
      for (let i = 0; i < TICKS; i += 1) s = driftRegions(s, HOURS, graphOf());
      return s.regions["region.r"]!.threat;
    };
    const none = settled(0);
    expect(settled(1)).toBe(none + PROJECT_ALARM_PER_STAGE);
    expect(settled(2)).toBe(none + 2 * PROJECT_ALARM_PER_STAGE);
    // ...and the cap is not decoration: three stages is worth 24 and delivers 20.
    expect(3 * PROJECT_ALARM_PER_STAGE).toBeGreaterThan(PROJECT_ALARM_CAP);
    expect(settled(3)).toBe(none + PROJECT_ALARM_CAP);
  });

  it("a stage with no escalation moves no region at all", () => {
    const { state, graph } = run();
    let s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    s = take(s, graph, "project-commit:project.holdout.test");
    const before = s.regions;
    // Again resolved directly, so the assertion is about the escalation and not about two hours of drift.
    const only = { type: "project-advance", choiceId: "x", timeCost: 2, params: { project: HOLDOUT.id, stage: "only" } };
    const after = resolveProjectAction(s, graph, only);
    expect(after.regions).toBe(before);
  });
});

// --- 6. housekeeping -------------------------------------------------------------------------------

describe("the module owns its verbs and nothing else", () => {
  it("claims exactly the two project action types", () => {
    expect(isProjectAction({ type: "project-commit", choiceId: "x", timeCost: 1 })).toBe(true);
    expect(isProjectAction({ type: "project-advance", choiceId: "x", timeCost: 1 })).toBe(true);
    for (const t of ["move", "search", "craft", "claim", "equip", "rest"]) {
      expect(isProjectAction({ type: t, choiceId: "x", timeCost: 1 })).toBe(false);
    }
  });

  it("an unknown project id, a missing param and an empty project are all no-ops", () => {
    const { state, graph } = run();
    const s = based(state, [{ type: "item.scrap", quantity: 9 }]);
    expect(resolveProjectAction(s, graph, { type: "project-commit", choiceId: "x", timeCost: 1, params: { project: "project.departure.nope" } })).toBe(s);
    expect(resolveProjectAction(s, graph, { type: "project-commit", choiceId: "x", timeCost: 1 })).toBe(s);
    expect(resolveProjectAction(s, graph, { type: "project-advance", choiceId: "x", timeCost: 1, params: { project: ESCAPE.id } })).toBe(s);
  });

  it("the flag keys live in DISJOINT namespaces, so no author-supplied id can collide", () => {
    expect(projectCommitFlag("project.x.y")).toBe(`${PROJECT_COMMIT_FLAG_PREFIX}project.x.y`);
    expect(projectStageFlag("project.x.y", "s1")).toBe(`${PROJECT_STAGE_FLAG_PREFIX}project.x.y.s1`);
    // The audit's finding: a stage literally named `committed` used to produce the commit flag itself.
    expect(projectStageFlag("project.x.y", "committed")).not.toBe(projectCommitFlag("project.x.y"));
    expect(projectStageFlag("project.x.y", "committed").startsWith(PROJECT_COMMIT_FLAG_PREFIX)).toBe(false);
    // ...and so did a project whose own slug was `commit` or `stage`.
    for (const pid of ["project.departure.commit", "project.holdout.stage", "project.departure.x.committed"]) {
      expect(projectCommitFlag(pid).startsWith(PROJECT_STAGE_FLAG_PREFIX)).toBe(false);
      expect(projectStageFlag(pid, "committed").startsWith(PROJECT_STAGE_FLAG_PREFIX)).toBe(true);
    }
    expect(ENDING_FLAG_ESCAPED.startsWith(PROJECT_STAGE_FLAG_PREFIX)).toBe(false);
    expect(ENDING_FLAG_HELD.startsWith(PROJECT_STAGE_FLAG_PREFIX)).toBe(false);
    expect(ENDING_FLAG_ESCAPED.startsWith(PROJECT_COMMIT_FLAG_PREFIX)).toBe(false);
  });
});
