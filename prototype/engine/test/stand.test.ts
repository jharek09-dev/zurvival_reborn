import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  assertLegal,
  sceneOf,
  saveGame,
  loadGame,
  runEndReason,
  deathReason,
  isRunOver,
  endingNarration,
  RUN_END_REASONS,
  LAST_STAND_AT,
  standsActive,
  standPool,
  standIsOpen,
  standReason,
  standChoices,
  standNarration,
  standFacts,
  standDefFor,
  admissibleActs,
  matchesStand,
  isStandAction,
  resolveStandAction,
  applyStandEffect,
  standTaken,
  standActLine,
  standArmed,
  standSpent,
  opensStand,
  standDeathFlag,
  endingShape,
  assembleEnding,
  STAND_ARMED_FLAG,
  STAND_SPENT_FLAG,
  STAND_DEATH_FLAG_PREFIX,
  STAND_BEAT,
  STAND_ACT_LIMIT,
  STAND_CHOICE_PREFIX,
  STAND_FLOOR_ID,
  STAND_COST,
  STAND_NOTE,
  STAND_NOTE_MAX,
  STAND_REQUIREMENT_KEYS,
  STAND_EFFECTS,
  NEED_FATAL,
  SAVE_SCHEMA_VERSION,
  MapError,
  buildRegionGraph,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type StandDef,
  type StandFacts,
  type StandRequirement,
  type EndingDef,
} from "../src/index.js";

/**
 * T62 — the Last Stand as a scene (FR-CBT-10 · FR-STY-07 · PL-M5-44).
 *
 * Six claims under test, in the order the task depends on them:
 *
 *   1. **The gate holds.** A content set that authors no stand is the pre-T62 game exactly: a death
 *      ends the run on the frame it lands, `availableActions` is empty, nothing is armed.
 *   2. **A death opens ONE turn, and it is a real one.** Choices are offered, the floor act is always
 *      among them, and every act ends the run.
 *   3. **A SPENT STAND IS TERMINAL** — even when the act removed the thing that was killing you. This
 *      is the defect the first cut shipped and the measurement caught, so it gets the most tests.
 *   4. **The menu is a menu.** Acts are admitted against measured facts, sorted totally, capped, and
 *      an act the run cannot pay for cannot be forged into existence.
 *   5. **The last act reaches the ending**, including the `sacrifice` shape T61 could not reach.
 *   6. **The content guard is the runtime door**, because neither shipping client runs the schema.
 */

const REGIONS: RegionDef[] = [
  { id: "region.r", name: "R", description: "r", baseline: { threat: 20, zombieDensity: 30, survivorActivity: 10, loot: 80 } },
];
const NODES: NodeDef[] = [
  { id: "node.r.home", regionId: "region.r", name: "Home", description: "a depot", adjacent: ["node.r.b"], start: true, claimable: true },
  { id: "node.r.b", regionId: "region.r", name: "B", description: "a lot", adjacent: ["node.r.home"] },
];

const ACT_FIGHT = { id: "fight-on", label: "Take it with you.", text: "YOU TOOK IT WITH YOU.", effect: "kill" as const, shape: "sacrifice", weight: 90, when: { requiresCombat: true } };
const ACT_DROP = { id: "drop-it", label: "Leave the pack.", text: "YOU LEFT THE PACK.", effect: "drop" as const, weight: 70, when: { minItems: 2 } };
const ACT_MARK = { id: "mark-it", label: "Mark the wall.", text: "YOU MARKED THE WALL.", effect: "mark" as const, weight: 50 };
const ACT_QUIET = { id: "quiet", label: "Say nothing.", text: "YOU SAID NOTHING.", weight: 10 };
const ACT_DEAD = { id: "needs-a-friend", label: "Hold the door.", text: "YOU HELD THE DOOR.", shape: "sacrifice", weight: 99, when: { minCompanions: 1 } };

const STANDS: StandDef[] = [
  { id: "stand.fight", reasons: ["lastStand"], opening: "THE FIGHT OPENING.", acts: [ACT_FIGHT, ACT_DROP, ACT_MARK, ACT_QUIET, ACT_DEAD] },
  { id: "stand.quiet", reasons: ["infection", "dehydrated", "starved"], opening: "THE QUIET OPENING.", acts: [ACT_DROP, ACT_MARK, ACT_QUIET] },
];

const ENDINGS: EndingDef[] = [
  { id: "ending.sacrifice", shape: "sacrifice", opening: "SACRIFICE OPENING.", clauses: [{ id: "c1", weight: 10, text: "SACRIFICE CLAUSE." }] },
  { id: "ending.fade", shape: "fade", opening: "FADE OPENING.", clauses: [{ id: "c2", weight: 10, text: "FADE CLAUSE." }] },
];

const opts = { seed: "stand-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (stands: StandDef[] = STANDS, endings: EndingDef[] = []): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], [], endings, stands);

const ids = (s: GameState, g: RegionGraph): string[] => availableActions(s, g).map((c) => c.id);

/** A player held by something, hurt past the line — the Last Stand condition, exactly. */
function grabbed(state: GameState): GameState {
  return {
    ...state,
    combat: { node: state.player.location, enemy: "enemy.walker", hp: 30, maxHp: 30, alerted: true, grabbed: true },
    player: {
      ...state.player,
      condition: {
        ...state.player.condition,
        needs: { hunger: 0, thirst: 0, fatigue: 0 },
        wounds: [{ type: "wound.bite", site: "arm", severity: LAST_STAND_AT + 20, treated: 0, inflictedDay: 1, inflictedHour: 8 }],
      },
    },
  };
}

/** A player dying of thirst, with nothing holding them. */
const parched = (state: GameState): GameState => ({
  ...state,
  player: { ...state.player, condition: { ...state.player.condition, needs: { ...state.player.condition.needs, thirst: NEED_FATAL } } },
});

/** A player whose fever has crested — the delayed collapse `runEndReason` reads (T49). */
const succumbing = (state: GameState): GameState => ({
  ...state,
  player: { ...state.player, condition: { ...state.player.condition, infection: { ...state.player.condition.infection, stage: "terminal", progression: 400 } } },
});

const withPack = (state: GameState, n: number): GameState => ({
  ...state,
  player: { ...state.player, inventory: [{ type: "item.scrap", quantity: n }] },
});

const take = (state: GameState, graph: RegionGraph, id: string): GameState => {
  const choice = availableActions(state, graph).find((c) => c.id === id);
  expect(choice, `no choice "${id}" in [${ids(state, graph).join(", ")}]`).toBeDefined();
  return applyAction(state, choice!.action, graph).state;
};

// --- 1. the gate ----------------------------------------------------------------------------------

describe("the gate: an unauthored content set is the pre-T62 game exactly", () => {
  it("registers no pool, arms nothing, and a death ends the run on the frame it lands", () => {
    const { state, graph } = startRun(opts, REGIONS, NODES);
    expect(standsActive(graph)).toBe(false);
    expect(standPool(graph)).toEqual([]);
    expect(standArmed(state)).toBe(false);
    expect(state.story.endingFlags).toEqual({});

    const dying = grabbed(state);
    expect(deathReason(dying)).toBe("lastStand");
    expect(runEndReason(dying)).toBe("lastStand");
    expect(isRunOver(dying)).toBe(true);
    expect(standIsOpen(dying)).toBe(false);
    expect(availableActions(dying, graph)).toEqual([]);
    expect(sceneOf(dying, graph).choices).toEqual([]);
    expect(sceneOf(dying, graph).narration).toBe(endingNarration("lastStand"));
  });

  it("an empty stand array is the same as no argument at all", () => {
    const { state, graph } = run([]);
    expect(standsActive(graph)).toBe(false);
    expect(standArmed(state)).toBe(false);
    expect(runEndReason(grabbed(state))).toBe("lastStand");
  });

  it("registering a pool arms the run, and costs no save rung", () => {
    const { state } = run();
    expect(standArmed(state)).toBe(true);
    expect(state.story.endingFlags).toEqual({ [STAND_ARMED_FLAG]: true });
    const round = loadGame(saveGame(state));
    expect(JSON.parse(saveGame(state)).saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(standArmed(round)).toBe(true);
  });

  it("a save written before T62 has no armed flag, so it keeps its old ending", () => {
    const { state, graph } = run();
    // Exactly what a v10 save from a pool-less client deserialises to.
    const old: GameState = { ...state, story: { ...state.story, endingFlags: {} } };
    expect(standArmed(old)).toBe(false);
    expect(runEndReason(grabbed(old))).toBe("lastStand");
    expect(availableActions(grabbed(old), graph)).toEqual([]);
  });
});

// --- 2. a death opens one turn --------------------------------------------------------------------

describe("a death opens ONE turn, and it is a real one", () => {
  it("runEndReason reports null while the stand is open, so every consumer keeps the run alive", () => {
    const { state } = run();
    const dying = grabbed(state);
    expect(deathReason(dying)).toBe("lastStand");
    expect(runEndReason(dying)).toBeNull();
    expect(isRunOver(dying)).toBe(false);
    expect(standIsOpen(dying)).toBe(true);
    expect(standReason(dying)).toBe("lastStand");
  });

  it("offers the admissible acts plus the floor, and NEVER an empty list", () => {
    const { state, graph } = run();
    const dying = withPack(grabbed(state), 3);
    const offered = ids(dying, graph);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).toContain(`${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
    expect(offered.every((i) => i.startsWith(STAND_CHOICE_PREFIX))).toBe(true);
  });

  it("the floor act is offered even when the content set authors nothing admissible", () => {
    const only: StandDef[] = [{ id: "stand.x", reasons: ["lastStand"], opening: "O.", acts: [ACT_DEAD] }];
    const { state, graph } = run(only);
    const offered = ids(grabbed(state), graph);
    expect(offered).toEqual([`${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`]);
  });

  it("the stand pre-empts the fight it happens inside — no strike, no break, no retreat", () => {
    const { state, graph } = run();
    const offered = ids(grabbed(state), graph);
    expect(offered).not.toContain("strike");
    expect(offered).not.toContain("break");
    expect(offered.some((i) => i.startsWith("retreat"))).toBe(false);
  });

  it("the scene opens on the pre-T62 death sentence VERBATIM, then the authored opening", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const narration = sceneOf(dying, graph).narration;
    expect(narration.startsWith(endingNarration("lastStand"))).toBe(true);
    expect(narration).toBe(`${endingNarration("lastStand")} THE FIGHT OPENING.`);
    expect(standNarration(dying, graph)).toBe(narration);
  });

  it("a def with a blank opening still prints the death sentence and nothing extra", () => {
    const blank: StandDef[] = [{ id: "stand.b", reasons: ["lastStand"], opening: "   ", acts: [ACT_QUIET] }];
    const { state, graph } = run(blank);
    expect(standNarration(grabbed(state), graph)).toBe(endingNarration("lastStand"));
  });

  it("all four DEATHS open a stand and neither WIN does", () => {
    for (const r of RUN_END_REASONS) {
      expect(opensStand(r)).toBe(r !== "escaped" && r !== "held");
    }
  });

  it("a quiet death opens the quiet stand, with no fight act on the menu", () => {
    const { state, graph } = run();
    const dying = withPack(parched(state), 3);
    expect(standReason(dying)).toBe("dehydrated");
    expect(standNarration(dying, graph)).toBe(`${endingNarration("dehydrated")} THE QUIET OPENING.`);
    const offered = ids(dying, graph);
    expect(offered).not.toContain(`${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(offered).toContain(`${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);
  });

  it("a stand act spends no hours — a terminal act cannot be farmed, and a tick would run the world after you are dead", () => {
    expect(STAND_COST).toBe(0);
    const { state, graph } = run();
    const dying = grabbed(state);
    const after = take(dying, graph, `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
    expect(after.meta.day).toBe(dying.meta.day);
    expect(after.meta.hour).toBe(dying.meta.hour);
  });

  it("taking an act ends the run and offers nothing further (the other half of the exit gate)", () => {
    const { state, graph } = run();
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
    expect(isRunOver(after)).toBe(true);
    expect(runEndReason(after)).toBe("lastStand");
    expect(availableActions(after, graph)).toEqual([]);
    expect(sceneOf(after, graph).choices).toEqual([]);
    expect(standIsOpen(after)).toBe(false);
  });

  it("the act writes exactly one beat, carrying the act, the shape and the death", () => {
    const { state, graph } = run();
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    const beats = after.history.filter((e) => e.type === STAND_BEAT);
    expect(beats).toHaveLength(1);
    expect(beats[0]!.data).toMatchObject({ act: ACT_FIGHT.id, shape: "sacrifice", reason: "lastStand" });
    expect(standTaken(after.history)).toEqual({ act: ACT_FIGHT.id, shape: "sacrifice", reason: "lastStand" });
  });

  it("an act with no declared shape writes no shape key at all", () => {
    const { state, graph } = run();
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    const beat = after.history.find((e) => e.type === STAND_BEAT)!;
    expect(Object.keys(beat.data as object)).not.toContain("shape");
    expect(standTaken(after.history)).toEqual({ act: ACT_MARK.id, shape: null, reason: "lastStand" });
  });
});

// --- 3. a spent stand is TERMINAL -----------------------------------------------------------------

describe("a spent stand is terminal, whatever is true of the body a frame later", () => {
  it("the act that KILLS the thing holding you does not let you walk away from your own Last Stand", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const after = take(dying, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    // The condition itself is gone — combat is cleared, so `inLastStand` is false and `deathReason`
    // finds nothing. This is the exact shape the first cut shipped, and it let the run carry on for
    // another 15-30 turns and die of something else.
    expect(after.combat).toBeNull();
    expect(deathReason(after)).toBeNull();
    // ...and the run is over anyway, for the reason the stand was taken against.
    expect(runEndReason(after)).toBe("lastStand");
    expect(isRunOver(after)).toBe(true);
    expect(availableActions(after, graph)).toEqual([]);
  });

  it("the death flag records WHICH death, and reports it forever after", () => {
    const { state, graph } = run();
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(after.story.endingFlags[STAND_SPENT_FLAG]).toBe(true);
    expect(after.story.endingFlags[standDeathFlag("lastStand")]).toBe(true);
    expect(standDeathFlag("lastStand")).toBe(`${STAND_DEATH_FLAG_PREFIX}lastStand`);
    // Even a state healed to full still reports the death it was spent against.
    const healed: GameState = {
      ...after,
      player: { ...after.player, condition: { ...after.player.condition, wounds: [], needs: { hunger: 0, thirst: 0, fatigue: 0 }, infection: { stage: "none", progression: 0 } } },
    };
    expect(deathReason(healed)).toBeNull();
    expect(runEndReason(healed)).toBe("lastStand");
  });

  it("a quiet death's flag names ITS death, not the fight's", () => {
    const { state, graph } = run();
    const after = take(withPack(parched(state), 3), graph, `${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);
    expect(after.story.endingFlags[standDeathFlag("dehydrated")]).toBe(true);
    expect(after.story.endingFlags[standDeathFlag("lastStand")]).toBeUndefined();
    expect(runEndReason(after)).toBe("dehydrated");
  });

  it("the three flag keys have DISJOINT prefixes — no key is a prefix of another", () => {
    const keys = [STAND_ARMED_FLAG, STAND_SPENT_FLAG, ...RUN_END_REASONS.map(standDeathFlag)];
    for (const a of keys) for (const b of keys) {
      if (a !== b) expect(b.startsWith(a), `"${b}" starts with "${a}"`).toBe(false);
    }
  });

  it("survives a save round-trip mid-stand and after it", () => {
    const { state, graph } = run();
    const dying = withPack(grabbed(state), 3);
    const mid = loadGame(saveGame(dying));
    expect(standIsOpen(mid)).toBe(true);
    expect(ids(mid, graph)).toEqual(ids(dying, graph));
    const after = loadGame(saveGame(take(dying, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`)));
    expect(runEndReason(after)).toBe("lastStand");
    expect(availableActions(after, graph)).toEqual([]);
  });
});

// --- 4. the menu is a menu ------------------------------------------------------------------------

describe("the menu: admitted against measured facts, sorted totally, capped", () => {
  it("caps the authored acts at STAND_ACT_LIMIT, floor excluded", () => {
    const { state, graph } = run();
    const dying = withPack(grabbed(state), 9);
    const authored = admissibleActs(dying, graph, "lastStand");
    expect(authored.length).toBe(STAND_ACT_LIMIT);
    expect(standChoices(dying, graph)).toHaveLength(STAND_ACT_LIMIT + 1);
  });

  it("sorts by weight descending, and the floor is always LAST", () => {
    const { state, graph } = run();
    const offered = standChoices(withPack(grabbed(state), 9), graph).map((c) => c.id);
    expect(offered[0]).toBe(`${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`); // 90
    expect(offered[1]).toBe(`${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);  // 70
    expect(offered[2]).toBe(`${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);  // 50
    expect(offered[offered.length - 1]).toBe(`${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
  });

  it("breaks weight ties on id, so the same save offers the same menu on two machines", () => {
    const tied: StandDef[] = [{ id: "stand.t", reasons: ["lastStand"], opening: "O.", acts: [
      { id: "zebra", label: "Z", text: "Z.", weight: 5 },
      { id: "alpha", label: "A", text: "A.", weight: 5 },
      { id: "mango", label: "M", text: "M.", weight: 5 },
    ] }];
    const { state, graph } = run(tied);
    expect(admissibleActs(grabbed(state), graph, "lastStand").map((a) => a.id)).toEqual(["alpha", "mango", "zebra"]);
  });

  it("a non-numeric weight sorts as 0 rather than making the comparator non-transitive", () => {
    // `buildRegionGraph` now refuses this at the door, so the coercion is reached only by a client that
    // builds a graph by hand — which `playCli.ts` and `web/build-html.mjs` effectively do. Kept because
    // a `NaN` comparison is FALSY, so such a pair fell through to the id tiebreak while numeric pairs
    // compared by weight: a non-transitive comparator whose result `Array.sort` may decide however it
    // likes, and which promoted the garbage act to the TOP slot rather than dropping it (T61 finding 6).
    const { state, graph } = run();
    const hand = { ...graph, stands: [{ id: "stand.w", reasons: ["lastStand"], opening: "O.", acts: [
      { id: "junk", label: "J", text: "J.", weight: "high" as unknown as number },
      { id: "real", label: "R", text: "R.", weight: 1 },
    ] }] } as RegionGraph;
    expect(admissibleActs(grabbed(state), hand, "lastStand").map((a) => a.id)).toEqual(["real", "junk"]);
  });

  it("an act with no prose is never offered — an empty text renders as a silent extra space", () => {
    const mute: StandDef[] = [{ id: "stand.m", reasons: ["lastStand"], opening: "O.", acts: [
      { id: "blank-text", label: "L", text: "   ", weight: 99 },
      { id: "blank-label", label: "", text: "T.", weight: 98 },
      { id: "speaks", label: "L", text: "T.", weight: 1 },
    ] }];
    const { state, graph } = run(mute);
    expect(admissibleActs(grabbed(state), graph, "lastStand").map((a) => a.id)).toEqual(["speaks"]);
  });

  it("an act the run cannot pay for is not offered", () => {
    const { state, graph } = run();
    const offered = ids(withPack(grabbed(state), 1), graph); // minItems 2 not met
    expect(offered).not.toContain(`${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);
    expect(offered).not.toContain(`${STAND_CHOICE_PREFIX}${ACT_DEAD.id}`); // minCompanions 1
  });

  it("a def covering no matching reason is not consulted", () => {
    const { graph } = run();
    expect(standDefFor(graph, "lastStand")?.id).toBe("stand.fight");
    expect(standDefFor(graph, "infection")?.id).toBe("stand.quiet");
    expect(standDefFor(graph, "escaped")).toBeNull();
  });

  it("a def with no acts array is a menu of one rather than a TypeError on the frame you died", () => {
    const broken = [{ id: "stand.x", reasons: ["lastStand"], opening: "O." } as unknown as StandDef];
    // Straight to the module, since `buildRegionGraph` rejects this shape — the guard below is the
    // door, and this is what is behind it for a client that builds a graph by hand.
    const { state } = run();
    const hand = { ...run().graph, stands: broken } as RegionGraph;
    expect(() => standChoices(grabbed(state), hand)).not.toThrow();
    expect(standChoices(grabbed(state), hand).map((c) => c.id)).toEqual([`${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`]);
  });
});

// --- 4b. the requirement vocabulary ---------------------------------------------------------------

describe("matchesStand: every predicate, and its bound is the one it names", () => {
  const F: StandFacts = {
    reason: "lastStand", inCombat: true, walkers: 3, companions: 2, met: 1, items: 4,
    atBase: true, claimed: true, feverish: true, burden: 200, humanity: 60, day: 5,
  };
  const yes = (r: StandRequirement): boolean => matchesStand(F, r);

  it("an absent requirement admits everything", () => {
    expect(matchesStand(F, undefined)).toBe(true);
    expect(yes({})).toBe(true);
  });

  it("each key admits at its bound and refuses one past it", () => {
    expect(yes({ reasons: ["lastStand"] })).toBe(true);
    expect(yes({ reasons: ["infection"] })).toBe(false);
    expect(yes({ requiresCombat: true })).toBe(true);
    expect(yes({ minWalkers: 3 })).toBe(true);
    expect(yes({ minWalkers: 4 })).toBe(false);
    expect(yes({ minCompanions: 2 })).toBe(true);
    expect(yes({ minCompanions: 3 })).toBe(false);
    expect(yes({ minMet: 1 })).toBe(true);
    expect(yes({ minMet: 2 })).toBe(false);
    expect(yes({ minItems: 4 })).toBe(true);
    expect(yes({ minItems: 5 })).toBe(false);
    expect(yes({ requiresAtBase: true })).toBe(true);
    expect(yes({ requiresClaimed: true })).toBe(true);
    expect(yes({ requiresFeverish: true })).toBe(true);
    expect(yes({ minBurden: 200 })).toBe(true);
    expect(yes({ minBurden: 201 })).toBe(false);
    expect(yes({ minHumanity: 60 })).toBe(true);
    expect(yes({ minHumanity: 61 })).toBe(false);
    expect(yes({ maxHumanity: 60 })).toBe(true);
    expect(yes({ maxHumanity: 59 })).toBe(false);
    expect(yes({ minDay: 5 })).toBe(true);
    expect(yes({ minDay: 6 })).toBe(false);
  });

  it("each boolean requirement refuses when the fact is false", () => {
    const G: StandFacts = { ...F, inCombat: false, atBase: false, claimed: false, feverish: false };
    expect(matchesStand(G, { requiresCombat: true })).toBe(false);
    expect(matchesStand(G, { requiresAtBase: true })).toBe(false);
    expect(matchesStand(G, { requiresClaimed: true })).toBe(false);
    expect(matchesStand(G, { requiresFeverish: true })).toBe(false);
    // `false` is not a demand — an author writing it means "do not care", as everywhere else.
    expect(matchesStand(G, { requiresCombat: false })).toBe(true);
  });

  it("the key list and the interface are the same set", () => {
    const probe: Record<string, unknown> = {
      reasons: ["infection"], requiresCombat: true, minWalkers: 99, minCompanions: 99, minMet: 99,
      minItems: 99, requiresAtBase: true, requiresClaimed: true, requiresFeverish: true,
      minBurden: 9999, minHumanity: 101, maxHumanity: -1, minDay: 999,
    };
    expect([...STAND_REQUIREMENT_KEYS].sort()).toEqual(Object.keys(probe).sort());
    const G: StandFacts = { ...F, inCombat: false, atBase: false, claimed: false, feverish: false };
    for (const key of STAND_REQUIREMENT_KEYS) {
      expect(matchesStand(G, { [key]: probe[key] } as StandRequirement), `key "${key}" is ignored by matchesStand`).toBe(false);
    }
  });

  it("standFacts reads the run, including a base claimed earlier and since lost", () => {
    const { state } = run();
    const lost: GameState = {
      ...state,
      history: [...state.history, { day: 1, hour: 1, turn: 1, type: "shelter.claimed", subjects: ["node.r.home"], data: {} }],
    };
    expect(standFacts(lost, "lastStand").claimed).toBe(true);
    expect(standFacts(lost, "lastStand").atBase).toBe(false);
    expect(standFacts(state, "lastStand").claimed).toBe(false);
  });
});

// --- 4c. the resolver re-validates its own gate ---------------------------------------------------

describe("the resolver trusts nothing: a forged action is a no-op returning the same object", () => {
  it("refuses a stand taken by a living survivor", () => {
    const { state, graph } = run();
    const forged = { type: "stand", choiceId: `${STAND_CHOICE_PREFIX}${ACT_QUIET.id}`, timeCost: 0, params: { act: ACT_QUIET.id } };
    expect(resolveStandAction(state, graph, forged)).toBe(state);
    expect(() => assertLegal(state, graph, forged)).toThrow();
  });

  it("refuses a SECOND stand — one spend, or the ending reads the wrong act", () => {
    const { state, graph } = run();
    const once = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    const again = { type: "stand", choiceId: `${STAND_CHOICE_PREFIX}${ACT_QUIET.id}`, timeCost: 0, params: { act: ACT_QUIET.id } };
    expect(resolveStandAction(once, graph, again)).toBe(once);
    expect(once.history.filter((e) => e.type === STAND_BEAT)).toHaveLength(1);
  });

  it("refuses an act the run cannot pay for, and leaves NO flags behind", () => {
    const { state, graph } = run();
    const dying = grabbed(state); // no pack, no companions
    const forged = { type: "stand", choiceId: `${STAND_CHOICE_PREFIX}${ACT_DEAD.id}`, timeCost: 0, params: { act: ACT_DEAD.id } };
    const after = resolveStandAction(dying, graph, forged);
    expect(after).toBe(dying);
    expect(after.story.endingFlags[STAND_SPENT_FLAG]).toBeUndefined();
    expect(runEndReason(after)).toBeNull();
  });

  it("refuses an unknown act id and a missing/non-string param", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    for (const params of [{ act: "no-such-act" }, { act: 7 }, {}, undefined]) {
      const forged = { type: "stand", choiceId: "stand:x", timeCost: 0, params } as never;
      expect(resolveStandAction(dying, graph, forged)).toBe(dying);
    }
  });

  it("answers to its own verb and nothing else", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    expect(isStandAction({ type: "stand", timeCost: 0 })).toBe(true);
    expect(isStandAction({ type: "strike", timeCost: 1 })).toBe(false);
    // Called directly with somebody else's verb, it hands back the very same object — so a dispatcher
    // that routed wrongly loses nothing rather than stamping a stand beat over another module's turn.
    expect(resolveStandAction(dying, graph, { type: "strike", timeCost: 1, params: { act: ACT_FIGHT.id } })).toBe(dying);
  });

  it("the FLOOR act is always payable, even forged, and is the only id the pool does not own", () => {
    const { state, graph } = run();
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
    // The floor act declares NO shape — it is what you do when there is nothing left to spend, not a
    // claim about what the run was. See STAND_FLOOR_SHAPE for the audit finding that forced this.
    expect(standTaken(after.history)).toEqual({ act: STAND_FLOOR_ID, shape: null, reason: "lastStand" });
    expect(standActLine(graph, STAND_FLOOR_ID)).not.toBeNull();
    expect(standPool(graph).some((d) => d.acts.some((a) => a.id === STAND_FLOOR_ID))).toBe(false);
  });
});

// --- 4d. the world effects ------------------------------------------------------------------------

describe("an act does only what it says, and each guard holds", () => {
  it("kill: clears the fight and leaves a body and a mess on the node", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const before = dying.nodes[dying.player.location]!;
    const after = take(dying, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    const node = after.nodes[after.player.location]!;
    expect(after.combat).toBeNull();
    expect(node.corpses).toBe(before.corpses + 1);
    expect(node.blood).toBeGreaterThan(before.blood);
    expect(node.blood).toBeLessThanOrEqual(100);
  });

  it("kill: blood is clamped at 100 rather than running past it", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const bloody: GameState = { ...dying, nodes: { ...dying.nodes, [dying.player.location]: { ...dying.nodes[dying.player.location]!, blood: 99 } } };
    const after = take(bloody, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(after.nodes[after.player.location]!.blood).toBe(100);
  });

  it("kill: is inert with no fight to end", () => {
    const { state } = run();
    expect(applyStandEffect(state, ACT_FIGHT, "lastStand")).toBe(state);
  });

  it("drop: empties the pack, and is inert on an empty one", () => {
    const { state, graph } = run();
    const dying = withPack(grabbed(state), 3);
    const after = take(dying, graph, `${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);
    expect(after.player.inventory).toEqual([]);
    const empty = { ...state, player: { ...state.player, inventory: [] } };
    expect(applyStandEffect(empty, ACT_DROP, "lastStand")).toBe(empty);
  });

  it("mark: pins the note, does not exceed the per-node cap, and is inert at it", () => {
    const { state, graph } = run();
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    expect(after.nodes[after.player.location]!.playerNotes).toContain(STAND_NOTE);
    const full: GameState = {
      ...state,
      nodes: { ...state.nodes, [state.player.location]: { ...state.nodes[state.player.location]!, playerNotes: Array.from({ length: STAND_NOTE_MAX }, (_, i) => `n${i}`) } },
    };
    expect(applyStandEffect(full, ACT_MARK, "lastStand")).toBe(full);
  });

  it("an act with no effect changes no field anywhere", () => {
    const { state } = run();
    expect(applyStandEffect(state, ACT_QUIET, "lastStand")).toBe(state);
  });

  it("an unknown effect is ignored rather than trusted", () => {
    const { state } = run();
    const weird = { ...ACT_QUIET, effect: "detonate" as unknown as "kill" };
    expect(applyStandEffect(state, weird, "lastStand")).toBe(state);
  });
});

// --- 4e. reading the beat back --------------------------------------------------------------------

describe("standTaken: reads the log, and a malformed beat reads as no act rather than throwing", () => {
  const beat = (data: unknown) => ({ day: 1, hour: 1, turn: 1, type: STAND_BEAT, subjects: [], data }) as never;

  it("returns null when no stand was taken", () => {
    expect(standTaken([])).toBeNull();
  });

  it("takes the NEWEST beat, so a hand-edited double spend resolves to the last one", () => {
    expect(standTaken([beat({ act: "first" }), beat({ act: "second", shape: "fade", reason: "infection" })]))
      .toEqual({ act: "second", shape: "fade", reason: "infection" });
  });

  it("a non-object, an array, a null and a missing act all read as no act", () => {
    for (const d of ["a string", ["an", "array"], null, 7, true, {}, { act: 9 }]) {
      expect(standTaken([beat(d)])).toBeNull();
    }
  });

  it("a non-string shape reads as no shape rather than reaching the ending", () => {
    expect(standTaken([beat({ act: "a", shape: 5 })])).toEqual({ act: "a", shape: null, reason: null });
    // An unrecognised reason is narrowed away rather than trusted into the prose lookup.
    expect(standTaken([beat({ act: "a", reason: "exploded" })])).toEqual({ act: "a", shape: null, reason: null });
  });
});

// --- 5. the last act reaches the ending -----------------------------------------------------------

describe("the ending reads what the survivor DID", () => {
  it("an act's declared shape decides the ending, reaching `sacrifice` away from any base", () => {
    const { state, graph } = run(STANDS, ENDINGS);
    const dying = grabbed(state);
    expect(standFacts(dying, "lastStand").atBase).toBe(false);
    const after = take(dying, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(endingShape(after, graph)).toBe("sacrifice");
  });

  it("an act with NO declared shape leaves T61's derivation exactly as it was", () => {
    const { state, graph } = run(STANDS, ENDINGS);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    expect(endingShape(after, graph)).toBe("fade");
  });

  it("an unrecognised shape on the beat falls through to the derivation rather than inventing one", () => {
    const { state, graph } = run(STANDS, ENDINGS);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    const forged: GameState = {
      ...after,
      history: [...after.history, { day: 1, hour: 1, turn: 1, type: STAND_BEAT, subjects: [], data: { act: ACT_MARK.id, shape: "apotheosis" } }],
    };
    expect(endingShape(forged, graph)).toBe("fade");
  });

  it("the act's own line is printed between the death sentence and the shape's opening", () => {
    const { state, graph } = run(STANDS, ENDINGS);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    const ending = assembleEnding(after, graph)!;
    expect(ending.lines[0]).toBe(endingNarration("lastStand"));
    expect(ending.lines[1]).toBe(ACT_FIGHT.text);
    expect(ending.lines[2]).toBe("SACRIFICE OPENING.");
  });

  it("a run played with NO stand pool prints no act line at all", () => {
    const { state, graph } = startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], [], ENDINGS);
    const ending = assembleEnding(grabbed(state), graph)!;
    expect(ending.lines[0]).toBe(endingNarration("lastStand"));
    expect(ending.lines[1]).toBe("FADE OPENING.");
  });

  it("stands registered WITHOUT endings still say what the survivor did", () => {
    const { state, graph } = run(STANDS, []);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(assembleEnding(after, graph)).toBeNull();
    expect(sceneOf(after, graph).narration).toBe(`${endingNarration("lastStand")} ${ACT_FIGHT.text}`);
  });

  it("an ending clause can be gated on the act that was taken", () => {
    const keyed: EndingDef[] = [{
      id: "ending.fade", shape: "fade", opening: "O.", clauses: [
        { id: "for-the-mark", weight: 50, when: { standActs: [ACT_MARK.id] }, text: "MARK CLAUSE." },
        { id: "for-the-fight", weight: 50, when: { standActs: [ACT_FIGHT.id] }, text: "FIGHT CLAUSE." },
      ],
    }];
    const { state, graph } = run(STANDS, keyed);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    expect(assembleEnding(after, graph)!.clauseIds).toEqual(["for-the-mark"]);
  });

  it("an act-gated clause never fires for a run that took no act", () => {
    const keyed: EndingDef[] = [{
      id: "ending.fade", shape: "fade", opening: "O.",
      clauses: [{ id: "for-the-mark", weight: 50, when: { standActs: [ACT_MARK.id] }, text: "MARK CLAUSE." }],
    }];
    const { state, graph } = startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], [], keyed);
    expect(assembleEnding(grabbed(state), graph)!.clauseIds).toEqual([]);
  });
});

// --- 6. the content guard is the runtime door -----------------------------------------------------

describe("buildRegionGraph refuses content the schema cannot catch from here", () => {
  const build = (stands: unknown[]): RegionGraph =>
    buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [], stands as StandDef[]);
  const ok = { id: "stand.a", reasons: ["lastStand"], opening: "O.", acts: [ACT_QUIET] };

  it("accepts the shipped shape", () => {
    expect(() => build([ok])).not.toThrow();
    expect(build([ok]).stands).toHaveLength(1);
  });

  it("refuses a duplicate stand id", () => {
    expect(() => build([ok, { ...ok, reasons: ["infection"] }])).toThrow(MapError);
  });

  it("refuses a def covering no reason", () => {
    expect(() => build([{ ...ok, reasons: [] }])).toThrow(/covers no run-end reason/);
    expect(() => build([{ id: "stand.b", opening: "O.", acts: [] }])).toThrow(/covers no run-end reason/);
  });

  it("refuses an unknown run-end reason", () => {
    expect(() => build([{ ...ok, reasons: ["exploded"] }])).toThrow(/unknown run-end reason/);
  });

  it("refuses a WIN — a won run closes on its project's own ending", () => {
    for (const win of ["escaped", "held"]) {
      expect(() => build([{ ...ok, reasons: [win] }])).toThrow(/which is a WIN/);
    }
  });

  it("refuses two defs claiming the same death, because the second would be unreachable", () => {
    expect(() => build([ok, { ...ok, id: "stand.b" }])).toThrow(/two stands claim reason/);
  });

  it("refuses a def with no acts array — the TypeError would be thrown on the frame you died", () => {
    expect(() => build([{ id: "stand.c", reasons: ["lastStand"], opening: "O." }])).toThrow(/no acts array/);
  });

  it("refuses a repeated act id, which would let the resolver pick a different act than the menu showed", () => {
    expect(() => build([{ ...ok, acts: [ACT_QUIET, { ...ACT_MARK, id: ACT_QUIET.id }] }])).toThrow(/repeats act id/);
  });

  it("refuses an act that shadows the engine's own floor act", () => {
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, id: STAND_FLOOR_ID }] }])).toThrow(/floor act/);
  });

  it("refuses an unknown ending shape, which sim/ending.ts would otherwise read as a shape the game lacks", () => {
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, shape: "apotheosis" }] }])).toThrow(/unknown shape/);
  });

  it("refuses an unknown effect, which would fall through and silently do nothing under prose that says otherwise", () => {
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, effect: "detonate" }] }])).toThrow(/unknown effect/);
    for (const e of ["kill", "drop", "mark"]) {
      const act = e === "kill" ? { ...ACT_QUIET, effect: e, when: { requiresCombat: true } } : { ...ACT_QUIET, effect: e };
      expect(() => build([{ ...ok, acts: [act] }])).not.toThrow();
    }
  });

  it("refuses an act that KILLS without requiring a fight", () => {
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, effect: "kill" }] }])).toThrow(/kills without requiring combat/);
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, effect: "kill", when: { minItems: 1 } }] }])).toThrow(/kills without requiring combat/);
  });

  it("refuses a non-numeric weight at the door as well as coercing it in the comparator", () => {
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, weight: "heavy" }] }])).toThrow(/non-numeric weight/);
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, weight: Number.NaN }] }])).toThrow(/non-numeric weight/);
  });

  it("refuses a typo'd requirement key, because an unread key makes the act UNCONDITIONAL", () => {
    expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, when: { minItem: 2 } }] }])).toThrow(/unknown requirement/);
    for (const key of STAND_REQUIREMENT_KEYS) {
      expect(() => build([{ ...ok, acts: [{ ...ACT_QUIET, when: { [key]: 1 } }] }])).not.toThrow();
    }
  });
});

// --- 7. the two modules agree ---------------------------------------------------------------------

describe("the flag constants duplicated into sim/survival.ts cannot drift", () => {
  it("armed, spent and the death prefix are the same strings on both sides", async () => {
    const survival = await import("../src/sim/survival.js");
    const stand = await import("../src/sim/stand.js");
    expect(survival.STAND_ARMED_FLAG).toBe(stand.STAND_ARMED_FLAG);
    expect(survival.STAND_SPENT_FLAG).toBe(stand.STAND_SPENT_FLAG);
    expect(survival.STAND_DEATH_FLAG_PREFIX).toBe(stand.STAND_DEATH_FLAG_PREFIX);
  });

  it("the deaths that open a stand are the same set on both sides", async () => {
    const stand = await import("../src/sim/stand.js");
    const { state, graph } = run();
    // The survival copy is private, so it is probed through behaviour: every reason `opensStand`
    // accepts must actually suppress `runEndReason` while armed and unspent, and no other may.
    for (const r of RUN_END_REASONS) {
      if (!stand.opensStand(r)) continue;
      const flagged: GameState = { ...state, story: { ...state.story, endingFlags: { [STAND_ARMED_FLAG]: true } } };
      const dying = r === "lastStand" ? grabbed(flagged) : r === "dehydrated" ? parched(flagged)
        : r === "starved" ? { ...flagged, player: { ...flagged.player, condition: { ...flagged.player.condition, needs: { ...flagged.player.condition.needs, hunger: NEED_FATAL } } } }
        : succumbing(flagged);
      expect(deathReason(dying), `deathReason for ${r}`).not.toBeNull();
      expect(runEndReason(dying), `runEndReason suppressed for ${r}`).toBeNull();
      expect(standIsOpen(dying), `stand open for ${r}`).toBe(true);
      expect(standSpent(dying)).toBe(false);
      expect(availableActions(dying, graph).length).toBeGreaterThan(0);
    }
  });
});

// --- 8. the audit fixes, each of which failed against the unfixed tree ----------------------------

/**
 * Every test below was run against `/root/zb-unfixed` — the tree as it stood the moment the audit
 * findings landed — and every one of them FAILED there. That is the eight-task-old lesson from
 * T77/T75: an audit fix still needs a test, and a test written after the fix is worth only what its
 * run against the unfixed code proves.
 */
describe("audit fixes", () => {
  it("1. the act's prose comes from the def covering THIS death, not whichever file sorts first", () => {
    const shared = "leave-it";
    const stands: StandDef[] = [
      { id: "stand.aaa-fever", reasons: ["infection"], opening: "F.", acts: [{ id: shared, label: "L", text: "THE FEVER WORDS.", weight: 9 }] },
      { id: "stand.zzz-fight", reasons: ["lastStand"], opening: "G.", acts: [{ id: shared, label: "L", text: "THE FIGHT WORDS.", weight: 9 }] },
    ];
    const { state, graph } = run(stands, ENDINGS);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${shared}`);
    expect(standTaken(after.history)!.reason).toBe("lastStand");
    expect(standActLine(graph, shared, "lastStand")).toBe("THE FIGHT WORDS.");
    expect(standActLine(graph, shared, "infection")).toBe("THE FEVER WORDS.");
    // ...and the ending prints the one that belongs to the death that happened.
    expect(assembleEnding(after, graph)!.lines[1]).toBe("THE FIGHT WORDS.");
  });

  it("1b. every shipped act id shared across defs resolves to its own file's prose", () => {
    // A guard over the content itself, not the mechanism: the shipped set authors four of these.
    const stands: StandDef[] = [
      { id: "stand.a", reasons: ["infection"], opening: "A.", acts: [{ id: "x", label: "L", text: "A-TEXT.", weight: 1 }] },
      { id: "stand.b", reasons: ["dehydrated"], opening: "B.", acts: [{ id: "x", label: "L", text: "B-TEXT.", weight: 1 }] },
      { id: "stand.c", reasons: ["starved"], opening: "C.", acts: [{ id: "x", label: "L", text: "C-TEXT.", weight: 1 }] },
    ];
    const { graph } = run(stands);
    expect(standActLine(graph, "x", "infection")).toBe("A-TEXT.");
    expect(standActLine(graph, "x", "dehydrated")).toBe("B-TEXT.");
    expect(standActLine(graph, "x", "starved")).toBe("C-TEXT.");
    // With no death to key on it still answers rather than throwing — the pre-fix behaviour, kept as
    // the fallback for a beat written without a reason.
    expect(standActLine(graph, "x")).toBe("A-TEXT.");
  });

  it("2. the FLOOR act declares no shape, so it cannot overwrite T61's derivation", () => {
    const { state, graph } = run(STANDS, ENDINGS);
    // A survivor who goes down inside a base they still hold is a `sacrifice` by T61's `atBase` rule.
    const home = state.player.location;
    const atHome: GameState = { ...grabbed(state), player: { ...grabbed(state).player, shelterId: home, location: home } };
    expect(standFacts(atHome, "lastStand").atBase).toBe(true);
    const after = take(atHome, graph, `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
    expect(endingShape(after, graph)).toBe("sacrifice");
  });

  it("2b. the floor act still derives `fade` for the ordinary rootless run — the same answer, for the right reason", () => {
    const { state, graph } = run(STANDS, ENDINGS);
    const after = take(grabbed(state), graph, `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
    expect(endingShape(after, graph)).toBe("fade");
  });

  it("4. emptying the pack also empties the hand and forgets the instance", () => {
    const { state, graph } = run();
    const armed: GameState = {
      ...withPack(grabbed(state), 2),
      items: { "item#1": { type: "item.pipe", quality: 80, durability: 60, metadata: {} } },
      player: {
        ...withPack(grabbed(state), 2).player,
        inventory: [{ type: "item.scrap", quantity: 2 }, { type: "item.pipe", quantity: 1, itemId: "item#1" }],
        equipment: { weapon: "item#1" },
      },
    };
    const after = take(armed, graph, `${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);
    expect(after.player.inventory).toEqual([]);
    expect(after.player.equipment).toEqual({});
    expect(after.items).toEqual({});
  });

  it("4b. an equipment slot pointing at something NOT in the pack is left alone", () => {
    const { state, graph } = run();
    const odd: GameState = {
      ...withPack(grabbed(state), 2),
      player: { ...withPack(grabbed(state), 2).player, equipment: { weapon: "item.bat" } },
    };
    const after = take(odd, graph, `${STAND_CHOICE_PREFIX}${ACT_DROP.id}`);
    expect(after.player.equipment).toEqual({ weapon: "item.bat" });
  });

  it("5. a final kill REMOVES the body, so the street really is one lighter", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const here = dying.player.location;
    const crowded: GameState = {
      ...dying,
      nodes: { ...dying.nodes, [here]: { ...dying.nodes[here]!, walkers: 3, zombieTypes: ["zombie.walker", "zombie.walker", "zombie.crawler"] } },
    };
    const after = take(crowded, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    const node = after.nodes[here]!;
    expect(node.walkers).toBe(2);
    expect(node.corpses).toBe(1);
  });

  it("5b. a kill on an EMPTY roster still counts the body, and never goes negative", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const here = dying.player.location;
    const empty: GameState = { ...dying, nodes: { ...dying.nodes, [here]: { ...dying.nodes[here]!, walkers: 0, zombieTypes: [] } } };
    const after = take(empty, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(after.nodes[here]!.walkers).toBe(0);
    expect(after.nodes[here]!.corpses).toBe(1);
  });

  it("5c. junk on the node is scrubbed rather than concatenated into NaN", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const here = dying.player.location;
    const junk: GameState = {
      ...dying,
      nodes: { ...dying.nodes, [here]: { ...dying.nodes[here]!, corpses: "lots" as unknown as number, blood: Number.NaN } },
    };
    const after = take(junk, graph, `${STAND_CHOICE_PREFIX}${ACT_FIGHT.id}`);
    expect(Number.isFinite(after.nodes[here]!.corpses)).toBe(true);
    expect(Number.isFinite(after.nodes[here]!.blood)).toBe(true);
    expect(after.nodes[here]!.corpses).toBe(1);
  });

  it("7. the mark is not written twice when the node already carries it", () => {
    const { state, graph } = run();
    const dying = grabbed(state);
    const here = dying.player.location;
    const marked: GameState = { ...dying, nodes: { ...dying.nodes, [here]: { ...dying.nodes[here]!, playerNotes: [STAND_NOTE] } } };
    const after = take(marked, graph, `${STAND_CHOICE_PREFIX}${ACT_MARK.id}`);
    expect(after.nodes[here]!.playerNotes).toEqual([STAND_NOTE]);
  });
});

// --- 9. the gaps the mutation run found -----------------------------------------------------------

/**
 * Nine mutants survived the first round. Six were test gaps, one was a real hole in `standSpent`, and
 * two were proved equivalent. These are the tests that close them — and, per the T77 rule, each was
 * run against the mutant it was written for.
 */
describe("mutation gaps", () => {
  it("a WIN never opens a stand, even while the body is failing (the 'pyrrhic win' state)", () => {
    // `deathReason` checks the finished project BEFORE the slow deaths, so a player who finishes the
    // road while dying of thirst reports `escaped`. Three separate mutants — dropping the
    // `STAND_DEATHS` membership test, widening the list to include a win, and dropping `opensStand`
    // from `standReason` — all made that run open a stand it could never close, because no stand def
    // covers a win. The run would simply never end.
    const { state, graph } = run();
    const winning: GameState = {
      ...parched(state),
      story: { ...parched(state).story, endingFlags: { ...parched(state).story.endingFlags, "ending.escaped": true } },
    };
    expect(deathReason(winning)).toBe("escaped");
    expect(standReason(winning)).toBeNull();
    expect(standIsOpen(winning)).toBe(false);
    expect(runEndReason(winning)).toBe("escaped");
    expect(isRunOver(winning)).toBe(true);
    expect(availableActions(winning, graph)).toEqual([]);
  });

  it("the menu offers THREE authored acts and a fourth that is the floor — the literal count", () => {
    // Pinned as a number, not against STAND_ACT_LIMIT: asserting a constant against itself is the
    // defect T85's audit found five times in one task.
    const { state, graph } = run();
    const dying = withPack(grabbed(state), 9);
    expect(admissibleActs(dying, graph, "lastStand")).toHaveLength(3);
    expect(standChoices(dying, graph)).toHaveLength(4);
    expect(STAND_ACT_LIMIT).toBe(3);
  });

  it("atBase is FALSE for a survivor who holds a base and dies somewhere else", () => {
    const { state } = run();
    const away: GameState = { ...state, player: { ...state.player, shelterId: "node.r.home", location: "node.r.b" } };
    expect(away.player.shelterId).not.toBeNull();
    expect(standFacts(away, "lastStand").atBase).toBe(false);
    expect(standFacts(away, "lastStand").claimed).toBe(true);
    const home: GameState = { ...away, player: { ...away.player, location: "node.r.home" } };
    expect(standFacts(home, "lastStand").atBase).toBe(true);
  });

  it("companions counts COMPANIONS, not every actor standing about", () => {
    const { state } = run();
    const bystander = {
      id: "npc.a", type: "npc.a", name: "A", location: state.player.location,
      condition: state.player.condition, inventory: [], groupId: null,
      relationships: {}, flags: {},
    } as unknown as GameState["actors"][string];
    const crowded: GameState = { ...state, actors: { ...state.actors, "npc.a": bystander } };
    expect(Object.keys(crowded.actors)).toHaveLength(1);
    expect(standFacts(crowded, "lastStand").companions).toBe(0);
    // ...and one that IS a companion counts.
    const party: GameState = {
      ...state,
      actors: { "npc.b": { ...bystander, id: "npc.b", flags: { companion: true } } },
    };
    expect(standFacts(party, "lastStand").companions).toBe(1);
  });

  it("a declared shape outranks the atBase derivation, in BOTH directions", () => {
    // The ordering mutant (standShape below atBase) survived because no shipped act declares a
    // NON-sacrifice shape, so the two orders agree on everything the content can produce. This is the
    // case that separates them, and it is the reason the order is what it is: the act the survivor
    // CHOSE is a more direct statement about the run than where they happened to be standing.
    const overriding: StandDef[] = [{ id: "stand.o", reasons: ["lastStand"], opening: "O.", acts: [
      { id: "quiet-end", label: "L", text: "T.", shape: "fade", weight: 9 },
    ] }];
    const { state, graph } = run(overriding, ENDINGS);
    const home = state.player.location;
    const atHome: GameState = { ...grabbed(state), player: { ...grabbed(state).player, shelterId: home, location: home } };
    expect(standFacts(atHome, "lastStand").atBase).toBe(true);
    const after = take(atHome, graph, `${STAND_CHOICE_PREFIX}quiet-end`);
    expect(endingShape(after, graph)).toBe("fade");
  });

  it("a half-written flag pair cannot leave the run both open and over", () => {
    // The real hole the mutation run exposed. A state carrying `stand.death.<reason>` without
    // `stand.spent` — a hand-edited save, or one written by a build that set only one — had
    // `standIsOpen` and `isRunOver` BOTH true, and which the player got depended on the order of two
    // branches in `availableActions`. `standSpent` now reads both halves.
    const { state, graph } = run();
    const half: GameState = {
      ...grabbed(state),
      story: { ...state.story, endingFlags: { [STAND_ARMED_FLAG]: true, [standDeathFlag("lastStand")]: true } },
    };
    expect(standSpent(half)).toBe(true);
    expect(standIsOpen(half)).toBe(false);
    expect(isRunOver(half)).toBe(true);
    expect(availableActions(half, graph)).toEqual([]);
    // ...and the mirror: `stand.spent` without a death flag closes the window without inventing a death.
    const other: GameState = {
      ...grabbed(state),
      story: { ...state.story, endingFlags: { [STAND_ARMED_FLAG]: true, [STAND_SPENT_FLAG]: true } },
    };
    expect(standIsOpen(other)).toBe(false);
    expect(runEndReason(other)).toBe("lastStand");
  });
});
