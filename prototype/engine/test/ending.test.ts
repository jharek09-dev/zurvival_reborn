import { describe, expect, it } from "vitest";
import {
  startRun,
  buildRegionGraph,
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  runEndReason,
  endingNarration,
  winNarration,
  MapError,
  RUN_END_REASONS,
  SAVE_SCHEMA_VERSION,
  HUMANITY_BASELINE,
  endingsActive,
  endingPool,
  assembleEnding,
  endingText,
  closingNarration,
  reasonScene,
  summarizeRun,
  endingShape,
  matchesEnding,
  ENDING_SHAPES,
  ENDING_CLAUSE_LIMIT,
  ENDING_NEED_PRESSURE,
  COMPANION_FLAG,
  NEED_FATAL,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type EndingDef,
  type RunSummary,
  type ProjectDef,
} from "../src/index.js";

/**
 * T61 — endings assembled from run components (FR-STY-06).
 *
 * Six claims under test, in the order the task depends on them:
 *
 *   1. **The gate holds.** A content set that authors no ending closes on exactly the pre-T61
 *      sentence — `endingNarration` for a death, `winNarration` for a win — and `assembleEnding`
 *      returns null. Every assertion here has an unauthored twin.
 *   2. **The seam is real.** `sceneOf` genuinely routes through `closingNarration`, `startRun`'s
 *      twelfth argument genuinely reaches the graph, and `lines[0]` is byte-for-byte the old text.
 *      (The seven-task-old T75/T77 lesson: the module being right proves nothing about the caller.)
 *   3. **The components are read off the LOG, not the final frame.** A base claimed and lost is still
 *      a base claimed — which is the whole reason the history is the source.
 *   4. **Selection is total, capped, and weight-ordered**, with an id tiebreak, so the same save
 *      closes on the same words on any machine.
 *   5. **The shape is derived from what the run WAS.** Two runs with the identical run-end reason
 *      resolve into different shapes — "there is no true ending" as an executable statement.
 *   6. **Nothing is stored.** No save rung, and an ending survives a save/load round trip unchanged.
 */

const REGIONS: RegionDef[] = [
  { id: "region.r", name: "R", description: "r", baseline: { threat: 20, zombieDensity: 30, survivorActivity: 10, loot: 80 } },
];
const NODES: NodeDef[] = [
  { id: "node.r.home", regionId: "region.r", name: "Home", description: "a depot", adjacent: ["node.r.b"], start: true, claimable: true },
  { id: "node.r.b", regionId: "region.r", name: "B", description: "a lot", adjacent: ["node.r.home"] },
];

const FADE: EndingDef = {
  id: "ending.test.fade", shape: "fade", opening: "OPEN-FADE.",
  clauses: [
    { id: "aaa-low", weight: 10, text: "LOW." },
    { id: "bbb-mid", weight: 50, when: { minFights: 1 }, text: "MID-FIGHTS." },
    { id: "ccc-high", weight: 90, when: { maxDays: 3 }, text: "HIGH-EARLY." },
    { id: "ddd-never", weight: 99, when: { minCompanions: 4 }, text: "NEVER." },
  ],
};
const ENTRENCH: EndingDef = {
  id: "ending.test.entrenchment", shape: "entrenchment", opening: "OPEN-ENTRENCH.",
  clauses: [{ id: "only", weight: 5, text: "ENTRENCH-ONLY." }],
};
const SACRIFICE: EndingDef = {
  id: "ending.test.sacrifice", shape: "sacrifice", opening: "OPEN-SACRIFICE.",
  clauses: [{ id: "only", weight: 5, text: "SACRIFICE-ONLY." }],
};
const POOL: EndingDef[] = [FADE, ENTRENCH, SACRIFICE];

const HOLDOUT: ProjectDef = {
  id: "project.holdout.test", kind: "holdout", label: "The Test Block", premise: "stay",
  stages: [{ id: "only", label: "Only stage", worldEffect: "it holds", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 2 }],
  ending: "THE BLOCK ENDING.",
};

const opts = { seed: "ending-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (endings: EndingDef[] = POOL, projects: ProjectDef[] = []): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], projects, endings);

/** Kill the run by thirst without touching anything else. */
const parched = (s: GameState): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, thirst: NEED_FATAL } } },
});

/** Put the player in a claimed base at `node.r.home`. */
const based = (s: GameState): GameState => ({ ...s, player: { ...s.player, location: "node.r.home", shelterId: "node.r.home" } });

const beat = (s: GameState, type: string): GameState => ({
  ...s,
  history: [...s.history, { day: s.meta.day, hour: s.meta.hour, turn: s.meta.turn, type, subjects: [], data: {} }],
});

// --- 1. the gate ------------------------------------------------------------------------------------

describe("the gate: an unauthored content set is the pre-T61 game exactly", () => {
  it("registers no pool and assembles nothing", () => {
    const { state, graph } = run([]);
    expect(graph.endings).toBeUndefined();
    expect(endingsActive(graph)).toBe(false);
    expect(endingPool(graph)).toEqual([]);
    expect(assembleEnding(parched(state), graph)).toBeNull();
  });

  it("closes a death on exactly endingNarration and a win on exactly winNarration", () => {
    const { state, graph } = run([]);
    const dead = parched(state);
    expect(sceneOf(dead, graph).narration).toBe(endingNarration("dehydrated"));
    expect(closingNarration(dead, graph, "dehydrated")).toBe(endingNarration("dehydrated"));

    const won = { ...state, story: { ...state.story, endingFlags: { "ending.held": true } } };
    expect(runEndReason(won)).toBe("held");
    expect(sceneOf(won, graph).narration).toBe(winNarration(won, graph, "held"));
  });

  it("an unregistered pool leaves availableActions and the save untouched", () => {
    const bare = run([]);
    const withPool = run(POOL);
    expect(availableActions(withPool.state, withPool.graph).map((c) => c.id))
      .toEqual(availableActions(bare.state, bare.graph).map((c) => c.id));
    expect(saveGame(withPool.state)).toBe(saveGame(bare.state));
  });

  it("is still the pre-T61 game for a live run even WITH a pool — an ending is only ever a close", () => {
    const { state, graph } = run(POOL);
    expect(runEndReason(state)).toBeNull();
    expect(assembleEnding(state, graph)).toBeNull();
  });
});

// --- 2. the seam ------------------------------------------------------------------------------------

describe("the seam: sceneOf really routes through the assembly, and startRun really carries the pool", () => {
  it("startRun's twelfth argument reaches graph.endings", () => {
    const { graph } = run(POOL);
    expect(graph.endings).toHaveLength(3);
    expect(endingsActive(graph)).toBe(true);
  });

  it("buildRegionGraph's eleventh argument reaches graph.endings (the resume path)", () => {
    const g = buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], POOL);
    expect(g.endings).toHaveLength(3);
    // …and is absent, not empty, when nothing is registered — the "is this system on" read every other
    // pool uses would silently answer "yes" to an attached empty array.
    expect(buildRegionGraph(REGIONS, NODES).endings).toBeUndefined();
  });

  it("sceneOf prints MORE than the reason scene once a pool is registered", () => {
    const { state, graph } = run(POOL);
    const dead = parched(state);
    const narration = sceneOf(dead, graph).narration;
    expect(narration).not.toBe(endingNarration("dehydrated"));
    expect(narration).toContain("OPEN-FADE.");
    // The seam, stated as arithmetic rather than as "it contains something": the scene IS the assembly.
    expect(narration).toBe(endingText(assembleEnding(dead, graph)!));
  });

  it("lines[0] is byte-for-byte the pre-T61 sentence, for a death and for a win", () => {
    const { state, graph } = run(POOL);
    const dead = parched(state);
    expect(assembleEnding(dead, graph)!.lines[0]).toBe(endingNarration("dehydrated"));
    expect(reasonScene(dead, graph, "dehydrated")).toBe(endingNarration("dehydrated"));

    const wonRun = startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], [HOLDOUT], POOL);
    const won = {
      ...wonRun.state,
      story: { ...wonRun.state.story, endingFlags: { "project.commit.project.holdout.test": true, "ending.held": true } },
    };
    expect(assembleEnding(won, wonRun.graph)!.lines[0]).toBe("THE BLOCK ENDING.");
  });

  it("an ended run still offers nothing (the no-soft-lock invariant is not touched)", () => {
    const { state, graph } = run(POOL);
    expect(sceneOf(parched(state), graph).choices).toEqual([]);
  });
});

// --- 3. the components come off the LOG ---------------------------------------------------------------

describe("summarizeRun reads the history, not the final frame", () => {
  it("counts a base that was claimed and then lost", () => {
    const { state, graph } = run(POOL);
    const lost = beat(parched(state), "shelter.claimed");
    const s = summarizeRun(lost, graph);
    expect(lost.player.shelterId).toBeNull();
    expect(s.claimed).toBe(true);
    expect(s.baseLost).toBe(true);
    // …and a base still held at the end is claimed but NOT lost.
    const kept = summarizeRun(based(parched(state)), graph);
    expect(kept.claimed).toBe(true);
    expect(kept.baseLost).toBe(false);
  });

  it("a run that never claimed anything has not LOST a base", () => {
    // The mutation sweep found this gap: `baseLost` without its `claimed &&` conjunct reports true for
    // every drifter who died in the street, because `shelterId` is null for them too — and
    // `requiresBaseLost` would then fire on a run that never had one.
    const { state, graph } = run(POOL);
    const drifter = summarizeRun(parched(state), graph);
    expect(drifter.claimed).toBe(false);
    expect(drifter.baseLost).toBe(false);
    expect(matchesEnding(drifter, { requiresBaseLost: true })).toBe(false);
  });

  it("counts nodes ENTERED, not nodes searched", () => {
    // Also a mutation-sweep gap. The two coincide for a bot that searches wherever it stands, so the
    // separation has to be asserted on a state where they differ: somewhere walked through and left.
    const { state, graph } = run(POOL);
    const walked: GameState = {
      ...parched(state),
      nodes: {
        ...state.nodes,
        "node.r.b": { ...state.nodes["node.r.b"]!, lastVisit: 1, searchPct: 0 },
        "node.r.home": { ...state.nodes["node.r.home"]!, lastVisit: 1, searchPct: 0 },
      },
    };
    const s = summarizeRun(walked, graph);
    expect(s.nodesSeen).toBe(2);
    expect(s.nodesCleaned).toBe(0);
    // …and the converse: a node searched to 100% that was never entered (a hand-built state) is not seen.
    const odd: GameState = {
      ...parched(state),
      nodes: {
        ...state.nodes,
        "node.r.b": { ...state.nodes["node.r.b"]!, lastVisit: null, searchPct: 100 },
        "node.r.home": { ...state.nodes["node.r.home"]!, lastVisit: null, searchPct: 0 },
      },
    };
    expect(summarizeRun(odd, graph).nodesSeen).toBe(0);
    expect(summarizeRun(odd, graph).nodesCleaned).toBe(1);
  });

  it("counts each beat kind into its own component and nothing else", () => {
    const { state, graph } = run(POOL);
    let s = parched(state);
    for (const t of ["combat.cleared", "combat.cleared", "npc.died", "moral", "horde.overrun", "encounter.begin", "siege.held", "siege.repelled", "siege.breached", "npc.met", "social.deserted", "social.betrayed", "companion.died"]) {
      s = beat(s, t);
    }
    const sum = summarizeRun(s, graph);
    expect(sum.fightsEnded).toBe(2);
    expect(sum.survivorsLost).toBe(1);
    expect(sum.moralActs).toBe(1);
    expect(sum.overruns).toBe(1);
    expect(sum.encounters).toBe(1);
    expect(sum.nightsHeld).toBe(2); // held + repelled, and NOT breached
    expect(sum.breached).toBe(1);
    expect(sum.met).toBe(1);
    expect(sum.departed).toBe(2); // deserted + betrayed
    expect(sum.companionsLost).toBe(1);
  });

  it("counts a HALF-searched node as seen but not cleaned", () => {
    // The `>= 100` boundary: a mutant reading `> 0` agrees with the truth on 0 and 100 alike, so the
    // assertion has to stand on a node in between.
    const { state, graph } = run(POOL);
    const half: GameState = {
      ...parched(state),
      nodes: {
        ...state.nodes,
        "node.r.home": { ...state.nodes["node.r.home"]!, lastVisit: 1, searchPct: 60 },
        "node.r.b": { ...state.nodes["node.r.b"]!, lastVisit: 1, searchPct: 100 },
      },
    };
    expect(summarizeRun(half, graph).nodesSeen).toBe(2);
    expect(summarizeRun(half, graph).nodesCleaned).toBe(1);
  });

  it("reads the base's rooms off the BASE, not off wherever the survivor is standing", () => {
    const { state, graph } = run(POOL);
    const away: GameState = {
      ...parched(state),
      player: { ...state.player, location: "node.r.b", shelterId: "node.r.home" },
      nodes: {
        ...state.nodes,
        "node.r.home": { ...state.nodes["node.r.home"]!, rooms: ["room.kitchen", "room.cistern"], barricades: 25 },
        "node.r.b": { ...state.nodes["node.r.b"]!, rooms: ["room.workshop"], barricades: 90 },
      },
    };
    const s = summarizeRun(away, graph);
    expect(s.atBase).toBe(false);
    expect(s.rooms).toBe(2);
    expect(s.barricades).toBe(25);
  });

  it("counts only COMPANIONS among the actors", () => {
    const { state, graph } = run(POOL);
    const survivor = (id: string, companion: boolean): unknown => ({
      id, name: id, location: "node.r.home", alive: true,
      condition: state.player.condition, inventory: [], stash: [], equipment: {},
      flags: companion ? { [COMPANION_FLAG]: true } : {},
      skills: {}, traits: [], trust: 0, morale: 50,
    });
    const withActors: GameState = {
      ...parched(state),
      actors: {
        "actor.stranger": survivor("actor.stranger", false) as never,
        "actor.friend": survivor("actor.friend", true) as never,
      },
    };
    // Two tracked survivors, one of them recruited: `companions` is one, not two.
    expect(Object.keys(withActors.actors)).toHaveLength(2);
    expect(summarizeRun(withActors, graph).companions).toBe(1);
    expect(matchesEnding(summarizeRun(withActors, graph), { requiresAlone: true })).toBe(false);
  });

  it("counts project STAGES, and only flags that are actually set", () => {
    const { state, graph } = run(POOL);
    const flags: GameState = {
      ...parched(state),
      story: {
        ...state.story,
        endingFlags: {
          "project.commit.project.x": true,      // a commit, not a stage
          "project.stage.project.x.one": true,   // counted
          "project.stage.project.x.two": true,   // counted
          "project.stage.project.x.three": false, // set to false — not counted
          "ending.escaped": false,
        },
      },
    };
    expect(summarizeRun(flags, graph).stages).toBe(2);
  });

  it("reads humanity as a value AND as a signed shift from the baseline", () => {
    const { state, graph } = run(POOL);
    const cruel = { ...parched(state), player: { ...parched(state).player, humanity: HUMANITY_BASELINE - 17 } };
    const s = summarizeRun(cruel, graph);
    expect(s.humanity).toBe(HUMANITY_BASELINE - 17);
    expect(s.humanityShift).toBe(-17);
    expect(summarizeRun(parched(state), graph).humanityShift).toBe(0);
  });

  it("both wins are wins", () => {
    const { state, graph } = run(POOL);
    for (const flag of ["ending.escaped", "ending.held"]) {
      const won = { ...state, story: { ...state.story, endingFlags: { [flag]: true } } };
      expect(summarizeRun(won, graph).won, flag).toBe(true);
    }
    expect(summarizeRun(parched(state), graph).won).toBe(false);
  });

  it("reads the body at the end, and `battered` is the disjunction of the four", () => {
    const { state, graph } = run(POOL);
    const base = parched(state);
    // Thirst at NEED_FATAL is already over the pressure line, so the plain parched run is battered.
    expect(ENDING_NEED_PRESSURE).toBeLessThan(NEED_FATAL);
    expect(summarizeRun(base, graph).parched).toBe(true);
    expect(summarizeRun(base, graph).battered).toBe(true);

    const clean: GameState = {
      ...base,
      story: { ...base.story, endingFlags: { "ending.escaped": true } },
      player: { ...base.player, condition: { ...base.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } } },
    };
    const cs = summarizeRun(clean, graph);
    expect(cs.hurt).toBe(false);
    expect(cs.feverish).toBe(false);
    expect(cs.battered).toBe(false);
    expect(cs.won).toBe(true);
    // …and any ONE of the four flips it.
    const fever = { ...clean, player: { ...clean.player, condition: { ...clean.player.condition, infection: { stage: "symptomatic" as const, progression: 40 } } } };
    expect(summarizeRun(fever, graph).feverish).toBe(true);
    expect(summarizeRun(fever, graph).battered).toBe(true);
  });
});

// --- 4. selection -------------------------------------------------------------------------------------

describe("clause selection is total, capped and weight-ordered", () => {
  it("takes the strongest ENDING_CLAUSE_LIMIT clauses, in weight order", () => {
    const { state, graph } = run(POOL);
    const s = beat(beat(parched(state), "combat.cleared"), "combat.cleared");
    const e = assembleEnding(s, graph)!;
    expect(ENDING_CLAUSE_LIMIT).toBe(3);
    // Four authored, one inadmissible (needs 4 companions), so all three admissible fire, high first.
    expect(e.clauseIds).toEqual(["ccc-high", "bbb-mid", "aaa-low"]);
    expect(e.lines).toEqual([endingNarration("dehydrated"), "OPEN-FADE.", "HIGH-EARLY.", "MID-FIGHTS.", "LOW."]);
  });

  it("never exceeds the cap however many clauses are admissible", () => {
    const many: EndingDef = {
      id: "ending.test.many", shape: "fade", opening: "O.",
      clauses: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, weight: i, text: `T${i}.` })),
    };
    const { state, graph } = run([many]);
    const e = assembleEnding(parched(state), graph)!;
    expect(e.clauseIds).toHaveLength(ENDING_CLAUSE_LIMIT);
    expect(e.clauseIds).toEqual(["c8", "c7", "c6"]);
  });

  it("breaks a weight tie on id, so the same save closes on the same words anywhere", () => {
    const tied: EndingDef = {
      id: "ending.test.tied", shape: "fade", opening: "O.",
      // Authored in an order that is NOT id order — directory order is not a contract.
      clauses: [
        { id: "zebra", weight: 40, text: "Z." },
        { id: "mango", weight: 40, text: "M." },
        { id: "apple", weight: 40, text: "A." },
        { id: "quince", weight: 40, text: "Q." },
      ],
    };
    const { state, graph } = run([tied]);
    expect(assembleEnding(parched(state), graph)!.clauseIds).toEqual(["apple", "mango", "quince"]);
  });

  it("a clause whose requirement fails is not printed", () => {
    const { state, graph } = run(POOL);
    const e = assembleEnding(parched(state), graph)!;
    expect(e.clauseIds).not.toContain("ddd-never");
    expect(endingText(e)).not.toContain("NEVER.");
    // …and MID-FIGHTS is absent too until a fight is in the log, which is the same rule seen from the
    // other side (this run has no `combat.cleared` beat).
    expect(e.clauseIds).not.toContain("bbb-mid");
  });

  it("a live pool with nothing authored for this shape still closes on the reason scene alone", () => {
    const { state, graph } = run([ENTRENCH]); // no `fade` def
    const e = assembleEnding(parched(state), graph)!;
    expect(e.shape).toBe("fade");
    expect(e.source).toBeNull();
    expect(e.lines).toEqual([endingNarration("dehydrated")]);
    expect(e.clauseIds).toEqual([]);
  });
});

// --- 4b. the requirement vocabulary --------------------------------------------------------------------

describe("matchesEnding: every predicate, and its bound is the one it names", () => {
  const S: RunSummary = {
    reason: "lastStand", won: false, days: 5, turns: 40,
    humanity: 60, humanityShift: 10, moralActs: 3,
    met: 1, survivorsLost: 4, companionsLost: 1, departed: 1, companions: 2,
    claimed: true, baseLost: false, rooms: 2, barricades: 30, atBase: true, nightsHeld: 2, breached: 1,
    fightsEnded: 6, overruns: 2, nodesSeen: 9, nodesCleaned: 3, encounters: 7,
    committed: null, stages: 2,
    hurt: true, feverish: false, starving: false, parched: false, battered: true,
  };
  const yes = (r: Parameters<typeof matchesEnding>[1]): boolean => matchesEnding(S, r);

  it("an absent requirement admits everything", () => {
    expect(yes(undefined)).toBe(true);
    expect(yes({})).toBe(true);
  });

  it("min and max are not interchangeable (the adjacent-argument trap)", () => {
    expect(yes({ minDays: 5 })).toBe(true);
    expect(yes({ minDays: 6 })).toBe(false);
    expect(yes({ maxDays: 5 })).toBe(true);
    expect(yes({ maxDays: 4 })).toBe(false);
    expect(yes({ minHumanity: 60 })).toBe(true);
    expect(yes({ minHumanity: 61 })).toBe(false);
    expect(yes({ maxHumanity: 60 })).toBe(true);
    expect(yes({ maxHumanity: 59 })).toBe(false);
    expect(yes({ minHumanityShift: 10 })).toBe(true);
    expect(yes({ minHumanityShift: 11 })).toBe(false);
    expect(yes({ maxHumanityShift: 10 })).toBe(true);
    expect(yes({ maxHumanityShift: 9 })).toBe(false);
  });

  it("every counting bound reads its OWN component", () => {
    const table: [Parameters<typeof matchesEnding>[1], Parameters<typeof matchesEnding>[1]][] = [
      [{ minMoralActs: 3 }, { minMoralActs: 4 }],
      [{ minMet: 1 }, { minMet: 2 }],
      [{ minSurvivorsLost: 4 }, { minSurvivorsLost: 5 }],
      [{ minCompanions: 2 }, { minCompanions: 3 }],
      [{ minCompanionsLost: 1 }, { minCompanionsLost: 2 }],
      [{ minDeparted: 1 }, { minDeparted: 2 }],
      [{ minRooms: 2 }, { minRooms: 3 }],
      [{ minNightsHeld: 2 }, { minNightsHeld: 3 }],
      [{ minBreached: 1 }, { minBreached: 2 }],
      [{ minFights: 6 }, { minFights: 7 }],
      [{ minOverruns: 2 }, { minOverruns: 3 }],
      [{ minNodesSeen: 9 }, { minNodesSeen: 10 }],
      [{ minNodesCleaned: 3 }, { minNodesCleaned: 4 }],
      [{ minEncounters: 7 }, { minEncounters: 8 }],
      [{ minStages: 2 }, { minStages: 3 }],
    ];
    for (const [pass, fail] of table) {
      expect(yes(pass), JSON.stringify(pass)).toBe(true);
      expect(yes(fail), JSON.stringify(fail)).toBe(false);
    }
  });

  it("the booleans, and their complements", () => {
    expect(yes({ reasons: ["lastStand"] })).toBe(true);
    expect(yes({ reasons: ["escaped", "held"] })).toBe(false);
    expect(yes({ requiresClaimed: true })).toBe(true);
    expect(yes({ requiresBaseLost: true })).toBe(false);
    expect(yes({ requiresBattered: true })).toBe(true);
    expect(yes({ forbidsBattered: true })).toBe(false);
    expect(yes({ requiresFeverish: true })).toBe(false);
    expect(yes({ requiresAlone: true })).toBe(false); // two companions
    expect(matchesEnding({ ...S, companions: 0 }, { requiresAlone: true })).toBe(true);
    expect(matchesEnding({ ...S, feverish: true }, { requiresFeverish: true })).toBe(true);
    // A `false` boolean is not an assertion of the negative — absent and false both mean "don't care".
    expect(yes({ requiresBaseLost: false })).toBe(true);
    expect(yes({ forbidsBattered: false })).toBe(true);
  });

  it("all set fields are AND-combined", () => {
    expect(yes({ minDays: 5, minFights: 6 })).toBe(true);
    expect(yes({ minDays: 5, minFights: 7 })).toBe(false);
    expect(yes({ minDays: 6, minFights: 6 })).toBe(false);
  });
});

// --- 5. the shape is derived from what the run WAS -----------------------------------------------------

describe("endingShape: no true ending", () => {
  it("names all four and nothing else", () => {
    expect([...ENDING_SHAPES].sort()).toEqual(["entrenchment", "escape", "fade", "sacrifice"]);
  });

  it("two runs with the IDENTICAL reason resolve into different shapes", () => {
    const { state } = run(POOL);
    const bare = parched(state);
    const home = based(parched(state));
    const withRoom: GameState = {
      ...home,
      nodes: { ...home.nodes, "node.r.home": { ...home.nodes["node.r.home"]!, rooms: ["room.kitchen"] } },
    };
    expect(runEndReason(bare)).toBe("dehydrated");
    expect(runEndReason(withRoom)).toBe("dehydrated");
    expect(endingShape(bare)).toBe("fade");
    expect(endingShape(withRoom)).toBe("entrenchment");
  });

  it("a Last Stand at a defended base is a sacrifice; the same death in the street is a fade", () => {
    const { state } = run(POOL);
    const grabbed = (s: GameState): GameState => ({
      ...s,
      combat: { enemy: "enemy.walker", node: s.player.location, hp: 5, maxHp: 5, alerted: true, grabbed: true },
      player: { ...s.player, condition: { ...s.player.condition, wounds: [
        { type: "wound.bite", site: "forearm", severity: 90, treated: 0, inflictedDay: 1 },
        { type: "wound.laceration", site: "shoulder", severity: 90, treated: 0, inflictedDay: 1 },
      ] } },
    });
    const street = grabbed(state);
    expect(runEndReason(street)).toBe("lastStand");
    expect(endingShape(street)).toBe("fade");

    const home = based(state);
    const door = grabbed({ ...home, nodes: { ...home.nodes, "node.r.home": { ...home.nodes["node.r.home"]!, barricades: 40 } } });
    expect(runEndReason(door)).toBe("lastStand");
    expect(endingShape(door)).toBe("sacrifice");
  });

  it("a sacrifice needs the Last Stand — dying of thirst at a defended base is entrenchment", () => {
    const { state } = run(POOL);
    const home = based(parched(state));
    const walled = { ...home, nodes: { ...home.nodes, "node.r.home": { ...home.nodes["node.r.home"]!, barricades: 40 } } };
    expect(runEndReason(walled)).toBe("dehydrated");
    expect(endingShape(walled)).toBe("entrenchment");
  });

  it("the two wins fix their own shapes", () => {
    const { state } = run(POOL);
    const escaped = { ...state, story: { ...state.story, endingFlags: { "ending.escaped": true } } };
    const held = { ...state, story: { ...state.story, endingFlags: { "ending.held": true } } };
    expect(endingShape(escaped)).toBe("escape");
    expect(endingShape(held)).toBe("entrenchment");
  });

  it("a nights-held record makes an entrenchment out of a run whose base is already gone", () => {
    const { state } = run(POOL);
    const s = beat(beat(parched(state), "shelter.claimed"), "siege.held");
    expect(s.player.shelterId).toBeNull();
    expect(endingShape(s)).toBe("entrenchment");
  });
});

// --- 6. nothing is stored ------------------------------------------------------------------------------

describe("no state, no rung, reproducible from the save", () => {
  it("the save schema version is unchanged by T61", () => {
    expect(SAVE_SCHEMA_VERSION).toBe(10);
  });

  it("an ending survives a save/load round trip byte for byte", () => {
    const { state, graph } = run(POOL);
    const dead = beat(beat(parched(state), "combat.cleared"), "shelter.claimed");
    const before = assembleEnding(dead, graph)!;
    const after = assembleEnding(loadGame(saveGame(dead)), graph)!;
    expect(after).toEqual(before);
    expect(endingText(after)).toBe(endingText(before));
  });

  it("assembling an ending mutates nothing", () => {
    const { state, graph } = run(POOL);
    const dead = parched(state);
    const snapshot = saveGame(dead);
    assembleEnding(dead, graph);
    sceneOf(dead, graph);
    expect(saveGame(dead)).toBe(snapshot);
  });

  it("is pure — the same state assembles the same ending every time", () => {
    const { state, graph } = run(POOL);
    const dead = parched(state);
    expect(assembleEnding(dead, graph)).toEqual(assembleEnding(dead, graph));
  });

  it("every RunEndReason closes on a non-empty scene (no bare 'You Died')", () => {
    const { state, graph } = run(POOL);
    for (const reason of RUN_END_REASONS) {
      const text = closingNarration(state, graph, reason);
      expect(text.length, reason).toBeGreaterThan(20);
    }
  });
});

// --- 7. the content guards ------------------------------------------------------------------------------

describe("buildRegionGraph refuses the ending collisions a JSON Schema cannot see", () => {
  it("refuses two defs with the same id", () => {
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [FADE, { ...FADE, shape: "escape" }]))
      .toThrow(MapError);
  });

  it("refuses two defs claiming the same SHAPE — a run resolves into one shape", () => {
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [FADE, { ...FADE, id: "ending.test.other" }]))
      .toThrow(/two endings claim shape "fade"/);
  });

  it("refuses a def that repeats a clause id", () => {
    const dup: EndingDef = { ...FADE, clauses: [{ id: "x", weight: 1, text: "A." }, { id: "x", weight: 2, text: "B." }] };
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [dup]))
      .toThrow(/repeats clause id "x"/);
  });

  it("accepts the same clause id in two DIFFERENT shapes (they are separate namespaces)", () => {
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [ENTRENCH, SACRIFICE])).not.toThrow();
  });
});

// --- 8. the whole thing, driven ---------------------------------------------------------------------------

describe("driven: a run that actually plays out closes on an assembled ending", () => {
  it("a bot run ends on more than one sentence, and the first is the old one", () => {
    let { state, graph } = run(POOL);
    for (let i = 0; i < 400 && runEndReason(state) === null; i += 1) {
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      const before = state;
      state = applyAction(state, choices[i % choices.length]!.action, graph).state;
      if (state === before) break;
    }
    const reason = runEndReason(state);
    if (reason === null) return; // a run that outlives the budget proves nothing either way
    const e = assembleEnding(state, graph)!;
    expect(e.lines[0]).toBe(reasonScene(state, graph, reason));
    expect(e.lines.length).toBeGreaterThan(1);
    expect(sceneOf(state, graph).narration).toBe(endingText(e));
  });
});
