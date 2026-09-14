import { describe, expect, it } from "vitest";
import {
  startRun,
  buildRegionGraph,
  MapError,
  runEndReason,
  endingNarration,
  assembleEnding,
  endingText,
  endingShape,
  shapeOfSummary,
  summarizeRun,
  matchesEnding,
  ENDING_REQUIREMENT_KEYS,
  NEED_FATAL,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type EndingDef,
  type ProjectDef,
} from "../src/index.js";

/**
 * T61 — the adversarial audit's findings, each pinned by a test that FAILS against the unfixed tree.
 *
 * Seven of nine claims were real. Every one of them was a case where the assembled ending said
 * something that was **not true of the run**, which for a feature whose entire premise is "the ending
 * reflects the run that actually happened" is the only kind of defect that matters. They are kept in
 * their own file, in finding order, for the same reason `projectAudit.test.ts` exists: a fix that is
 * not tested is a fix that comes back (the T75/T77 lesson, now eight tasks old — and in T87 it was the
 * WIRING rather than the module that went untested, so several of these assert across a seam).
 */

const REGIONS: RegionDef[] = [
  { id: "region.r", name: "R", description: "r", baseline: { threat: 20, zombieDensity: 30, survivorActivity: 10, loot: 80 } },
];
const NODES: NodeDef[] = [
  { id: "node.r.home", regionId: "region.r", name: "Home", description: "a depot", adjacent: ["node.r.b"], start: true, claimable: true },
  { id: "node.r.b", regionId: "region.r", name: "B", description: "a lot", adjacent: ["node.r.home"] },
];

const FADE: EndingDef = { id: "e.fade", shape: "fade", opening: "OPEN-FADE.", clauses: [{ id: "c", weight: 1, text: "FADE-C." }] };
const ENTRENCH: EndingDef = { id: "e.ent", shape: "entrenchment", opening: "OPEN-ENT.", clauses: [{ id: "c", weight: 1, text: "ENT-C." }] };
const SACRIFICE: EndingDef = { id: "e.sac", shape: "sacrifice", opening: "OPEN-SAC.", clauses: [{ id: "c", weight: 1, text: "SAC-C." }] };
const POOL = [FADE, ENTRENCH, SACRIFICE];

const opts = { seed: "audit-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (endings: EndingDef[] = POOL, projects: ProjectDef[] = []): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], [], [], [], [], [], [], projects, endings);

const parched = (s: GameState): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, thirst: NEED_FATAL } } },
});
const beat = (s: GameState, type: string): GameState => ({
  ...s,
  history: [...s.history, { day: s.meta.day, hour: s.meta.hour, turn: s.meta.turn, type, subjects: [], data: {} }],
});
/** Hold `node.r.home` as a base, with walls, standing wherever `at` says. */
const withBase = (s: GameState, at: string): GameState => ({
  ...s,
  player: { ...s.player, location: at, shelterId: "node.r.home" },
  nodes: { ...s.nodes, "node.r.home": { ...s.nodes["node.r.home"]!, barricades: 40 } },
});
/** Grabbed and carrying more than the Last Stand line. */
const grabbed = (s: GameState): GameState => ({
  ...s,
  combat: { enemy: "enemy.walker", node: s.player.location, hp: 5, maxHp: 5, alerted: true, grabbed: true },
  player: { ...s.player, condition: { ...s.player.condition, wounds: [
    { type: "wound.bite", site: "forearm", severity: 90, treated: 0, inflictedDay: 1 },
    { type: "wound.laceration", site: "shoulder", severity: 90, treated: 0, inflictedDay: 1 },
  ] } },
});

// --- finding 1 -----------------------------------------------------------------------------------

describe("finding 1 — a sacrifice is a death AT the door, not a death by someone who owns a door", () => {
  it("a Last Stand across the map from your own fortified base is NOT a sacrifice", () => {
    const { state, graph } = run();
    const away = grabbed(withBase(state, "node.r.b"));
    expect(runEndReason(away)).toBe("lastStand");
    expect(summarizeRun(away, graph).atBase).toBe(false);
    expect(endingShape(away, graph)).not.toBe("sacrifice");
    // …and the text no longer contradicts its own first line.
    expect(endingText(assembleEnding(away, graph)!)).not.toContain("OPEN-SAC.");
  });

  it("the same death IN the base still is one — walls or no walls", () => {
    const { state, graph } = run();
    const home = grabbed(withBase(state, "node.r.home"));
    expect(summarizeRun(home, graph).atBase).toBe(true);
    expect(endingShape(home, graph)).toBe("sacrifice");
    // The conjunct is `atBase` alone: a bare address with no barricades and no night held is still a
    // door you died in, and requiring the walls only narrowed a shape that is already unreachable.
    const bare = grabbed({ ...state, player: { ...state.player, location: "node.r.home", shelterId: "node.r.home" } });
    expect(summarizeRun(bare, graph).barricades).toBe(0);
    expect(summarizeRun(bare, graph).nightsHeld).toBe(0);
    expect(endingShape(bare, graph)).toBe("sacrifice");
  });

  it("a base you no longer hold cannot be the door you died at", () => {
    const { state, graph } = run();
    // Claimed once (in the log), gone now: `atBase` is false, so the shape cannot be a sacrifice.
    const lost = grabbed(beat(state, "shelter.claimed"));
    expect(summarizeRun(lost, graph).claimed).toBe(true);
    expect(summarizeRun(lost, graph).atBase).toBe(false);
    expect(endingShape(lost, graph)).toBe("entrenchment");
  });
});

// --- finding 2 -----------------------------------------------------------------------------------

describe("finding 2 — a breach TAKES the base, so it is not evidence of a wall you kept", () => {
  it("a breach alone never makes a sacrifice", () => {
    const { state, graph } = run();
    const breached = grabbed(beat(beat(state, "shelter.claimed"), "siege.breached"));
    expect(summarizeRun(breached, graph).breached).toBe(1);
    expect(endingShape(breached, graph)).not.toBe("sacrifice");
  });

  it("`maxBreached` exists so a general 'you lost it' line can be kept off the breach case", () => {
    const s = summarizeRun(run().state, run().graph);
    expect(matchesEnding({ ...s, breached: 0 }, { maxBreached: 0 })).toBe(true);
    expect(matchesEnding({ ...s, breached: 1 }, { maxBreached: 0 })).toBe(false);
    expect(ENDING_REQUIREMENT_KEYS).toContain("maxBreached");
  });
});

// --- finding 3 -----------------------------------------------------------------------------------

describe("finding 3 — a survivor who claimed a base is never told nothing was theirs", () => {
  it("claiming alone is entrenchment, with no rooms, no walls and no siege", () => {
    const { state, graph } = run();
    const settled = parched({ ...state, player: { ...state.player, location: "node.r.home", shelterId: "node.r.home" } });
    const s = summarizeRun(settled, graph);
    expect([s.rooms, s.barricades, s.nightsHeld, s.stages]).toEqual([0, 0, 0, 0]);
    expect(endingShape(settled, graph)).toBe("entrenchment");
  });

  it("`forbidsClaimed` exists so a rootless line can be kept off a settler", () => {
    const { state, graph } = run();
    const settled = parched({ ...state, player: { ...state.player, location: "node.r.home", shelterId: "node.r.home" } });
    const drifter = parched(state);
    expect(matchesEnding(summarizeRun(drifter, graph), { forbidsClaimed: true })).toBe(true);
    expect(matchesEnding(summarizeRun(settled, graph), { forbidsClaimed: true })).toBe(false);
    expect(ENDING_REQUIREMENT_KEYS).toContain("forbidsClaimed");
  });
});

// --- finding 4 -----------------------------------------------------------------------------------

describe("finding 4 — a malformed def is refused at the door, and cannot throw at the moment of death", () => {
  it("buildRegionGraph refuses a def with no clauses array", () => {
    const bad = { id: "e.bad", shape: "fade", opening: "O." } as unknown as EndingDef;
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [bad]))
      .toThrow(/has no clauses array/);
  });

  it("and assembleEnding survives one anyway, because a hand-built graph never passed the door", () => {
    const { state } = run();
    const graph = { ...run([]).graph, endings: [{ id: "e.bad", shape: "fade", opening: "O." } as unknown as EndingDef] };
    expect(() => assembleEnding(parched(state), graph)).not.toThrow();
    expect(endingText(assembleEnding(parched(state), graph)!)).toBe(`${endingNarration("dehydrated")} O.`);
  });
});

// --- finding 5 -----------------------------------------------------------------------------------

describe("finding 5 — content is not trusted: a typo cannot silently disable a rule", () => {
  it("refuses an unknown shape rather than silently dropping that shape's ending", () => {
    const typo = { ...FADE, id: "e.typo", shape: "entrenchement" } as unknown as EndingDef;
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [typo]))
      .toThrow(/unknown shape "entrenchement"/);
  });

  it("refuses an unknown requirement key rather than making the clause unconditional", () => {
    const typo: EndingDef = {
      ...FADE, id: "e.typo2",
      clauses: [{ id: "c", weight: 1, when: { minNights: 99 } as never, text: "T." }],
    };
    expect(() => buildRegionGraph(REGIONS, NODES, [], [], [], [], [], [], [], [], [typo]))
      .toThrow(/unknown requirement "minNights"/);
  });

  it("exports the canonical key list the guard and the schema are both checked against", () => {
    expect(ENDING_REQUIREMENT_KEYS.length).toBeGreaterThan(25);
    expect(ENDING_REQUIREMENT_KEYS).toContain("minNightsHeld");
    expect(ENDING_REQUIREMENT_KEYS).not.toContain("minNights");
  });
});

// --- finding 6 -----------------------------------------------------------------------------------

describe("finding 6 — a junk weight cannot jump the queue, and an empty clause cannot print", () => {
  it("a non-numeric weight sorts as zero instead of poisoning the comparator", () => {
    const junk: EndingDef = {
      id: "e.junk", shape: "fade", opening: "O.",
      clauses: [
        { id: "a-junk", weight: "nope" as unknown as number, text: "JUNK." },
        { id: "b-ten", weight: 10, text: "TEN." },
        { id: "c-twenty", weight: 20, text: "TWENTY." },
      ],
    };
    const { state, graph } = run([junk]);
    const e = assembleEnding(parched(state), graph)!;
    expect(e.clauseIds).toEqual(["c-twenty", "b-ten", "a-junk"]);
  });

  it("a clause with empty or missing prose is dropped, not printed as a gap", () => {
    const empty: EndingDef = {
      id: "e.empty", shape: "fade", opening: "O.",
      clauses: [
        { id: "a-blank", weight: 90, text: "   " },
        { id: "b-missing", weight: 80, text: undefined as unknown as string },
        { id: "c-real", weight: 10, text: "REAL." },
      ],
    };
    const { state, graph } = run([empty]);
    const e = assembleEnding(parched(state), graph)!;
    expect(e.clauseIds).toEqual(["c-real"]);
    expect(endingText(e)).toBe(`${endingNarration("dehydrated")} O. REAL.`);
    expect(endingText(e)).not.toContain("  ");
  });
});

// --- finding 7 -----------------------------------------------------------------------------------

describe("finding 7 — a summary of a LIVE run cannot name a death that has not happened", () => {
  it("reason is null and the shape is null while the survivor is standing", () => {
    const { state, graph } = run();
    const alive = withBase(beat(state, "shelter.claimed"), "node.r.home");
    expect(runEndReason(alive)).toBeNull();
    expect(summarizeRun(alive, graph).reason).toBeNull();
    expect(summarizeRun(alive, graph).won).toBe(false);
    expect(endingShape(alive, graph)).toBeNull();
    expect(shapeOfSummary(summarizeRun(alive, graph))).toBeNull();
  });

  it("a `reasons` gate FAILS on a live run rather than matching a stand-in", () => {
    const { state, graph } = run();
    const alive = summarizeRun(state, graph);
    expect(matchesEnding(alive, { reasons: ["lastStand"] })).toBe(false);
    expect(matchesEnding(alive, { reasons: ["starved", "dehydrated", "infection", "lastStand", "escaped", "held"] })).toBe(false);
    // …while a requirement that says nothing about the reason is unaffected.
    expect(matchesEnding(alive, { minDays: 1 })).toBe(true);
  });
});

// --- finding 8 -----------------------------------------------------------------------------------

describe("finding 8 — the shape and the clauses read ONE summary of the run", () => {
  /**
   * **Declared equivalence, honestly labelled.** The first two assertions here PASSED against the
   * unfixed tree and are kept anyway: before the fix `endingShape` and `assembleEnding` each folded
   * their own summary and agreed only because neither of them happened to read the one field
   * (`committed`) that needs the graph. The audit called that latent rather than live, and it was
   * right. What the fix changes is that they now agree **by construction** — one fold, handed to both —
   * so these are a forward guard that will fail the day a graph-fed component reaches the shape, not a
   * regression test of something that was broken. The third assertion is the regression test: the
   * single-fold API itself.
   */
  it("assembleEnding's shape is exactly endingShape's, graph and all", () => {
    const { state, graph } = run();
    for (const s of [parched(state), grabbed(withBase(state, "node.r.home")), parched(beat(state, "shelter.claimed"))]) {
      expect(assembleEnding(s, graph)!.shape).toBe(endingShape(s, graph));
    }
  });

  it("endingShape takes the graph, so a component that needs one cannot read differently in the two", () => {
    const project: ProjectDef = {
      id: "project.holdout.audit", kind: "holdout", label: "L", premise: "p",
      stages: [{ id: "only", label: "S", worldEffect: "w", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 1 }],
      ending: "AUDIT ENDING.",
    };
    const { state, graph } = run(POOL, [project]);
    const committed: GameState = {
      ...parched(state),
      story: { ...state.story, endingFlags: { "project.commit.project.holdout.audit": true } },
    };
    expect(summarizeRun(committed, graph).committed).toBe("project.holdout.audit");
    // Without the graph the pool is unreachable and the field is null — which is exactly why the two
    // call sites must not compute their own summaries.
    expect(summarizeRun(committed).committed).toBeNull();
    expect(assembleEnding(committed, graph)!.shape).toBe(endingShape(committed, graph));
  });

  it("exposes the summary-level shape function the single fold is built on", () => {
    const { state, graph } = run();
    const dead = parched(beat(state, "shelter.claimed"));
    const summary = summarizeRun(dead, graph);
    // The regression test proper: a caller that already holds a summary can get the shape from it
    // WITHOUT walking the run again. Before the fix there was no such entry point, so `assembleEnding`
    // had no way to do it either.
    expect(shapeOfSummary(summary)).toBe("entrenchment");
    expect(shapeOfSummary(summary)).toBe(endingShape(dead, graph));
    expect(shapeOfSummary({ ...summary, reason: null })).toBeNull();
  });
});
