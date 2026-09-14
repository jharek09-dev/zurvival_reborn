import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  startRun,
  runEndReason,
  sceneOf,
  assembleEnding,
  endingText,
  endingShape,
  endingsActive,
  summarizeRun,
  matchesEnding,
  reasonScene,
  ENDING_SHAPES,
  ENDING_CLAUSE_LIMIT,
  ENDING_REQUIREMENT_KEYS,
  RUN_END_REASONS,
  STORY_ARCS,
  type EndingDef,
  type EndingClauseDef,
  type EndingRequirement,
  type GameState,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type WeaponDef,
  type ProjectDef,
} from "../../engine/src/index.js";

/**
 * T61 — the SHIPPED endings, and the three guards this task exists because of.
 *
 * 1. **Every shape is authored.** A run resolves into one of four shapes and must find a def for it;
 *    a missing one degrades silently to the pre-T61 single sentence, which is the defect, not a
 *    fallback anyone would notice.
 * 2. **The schema's requirement vocabulary and the engine's do not drift apart.** The `when` keys a
 *    file may use are declared in `content/schemas/ending.schema.json`; the keys the engine reads are
 *    in `matchesEnding`. A key in the schema the engine ignores is an authored gate that silently does
 *    nothing — the failure mode T87 found in its own `endingFlags` and T86 in `player.reputation`. So
 *    the schema is parsed here and checked against a live probe of every key.
 * 3. **The shipped prose actually assembles.** Two runs that end the same way must be able to read
 *    differently, which is the PRD's acceptance criterion for FR-STY-06 in its own words.
 */

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

const ENDINGS = load<EndingDef>("endings");
const SCHEMA = JSON.parse(readFileSync(join(CONTENT, "schemas", "ending.schema.json"), "utf8")) as {
  $defs: { requirement: { properties: Record<string, unknown> } };
};

function city(seed: string): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-14T00:00:00.000Z" },
    load<RegionDef>("regions"), load<NodeDef>("nodes"), load<NPCDef>("npcs"),
    STORY_ARCS.map((a) => a.id),
    load<EncounterDef>("encounters"), load<SignalDef>("radio"), load<RecipeDef>("recipes"),
    load<JobDef>("jobs"), load<FactionDef>("factions"), load<WeaponDef>("weapons"),
    load<ProjectDef>("projects"), ENDINGS,
  );
}

const everyClause = (): { d: EndingDef; c: EndingClauseDef }[] => ENDINGS.flatMap((d) => d.clauses.map((c) => ({ d, c })));

// --- 1. coverage of the shapes ---------------------------------------------------------------------

describe("the shipped endings cover every shape a run can resolve into", () => {
  it("authors exactly one def per shape, and all four", () => {
    expect(ENDINGS).toHaveLength(ENDING_SHAPES.length);
    expect(ENDINGS.map((d) => d.shape).sort()).toEqual([...ENDING_SHAPES].sort());
  });

  it("registers as a live pool on the shipped content set", () => {
    const { graph } = city("ending-content");
    expect(endingsActive(graph)).toBe(true);
    expect(graph.endings).toHaveLength(4);
  });

  it("authors MORE clauses than the cap in every shape, so the weights actually decide", () => {
    for (const d of ENDINGS) {
      expect(d.clauses.length, d.id).toBeGreaterThan(ENDING_CLAUSE_LIMIT);
    }
  });

  it("gives every clause prose that is a sentence and a weight in range", () => {
    for (const { d, c } of everyClause()) {
      expect(c.text.trim().length, `${d.id}/${c.id}`).toBeGreaterThan(20);
      expect(c.text.trim().endsWith("."), `${d.id}/${c.id} ends in a full stop`).toBe(true);
      expect(c.weight, `${d.id}/${c.id}`).toBeGreaterThanOrEqual(0);
      expect(c.weight, `${d.id}/${c.id}`).toBeLessThanOrEqual(100);
    }
    for (const d of ENDINGS) expect(d.opening.trim().length, d.id).toBeGreaterThan(20);
  });

  it("never repeats a clause id inside a def, and never repeats a shape across the pool", () => {
    for (const d of ENDINGS) {
      expect(new Set(d.clauses.map((c) => c.id)).size, d.id).toBe(d.clauses.length);
    }
    expect(new Set(ENDINGS.map((d) => d.shape)).size).toBe(ENDINGS.length);
    expect(new Set(ENDINGS.map((d) => d.id)).size).toBe(ENDINGS.length);
  });

  it("names only real run-end reasons in every `reasons` gate", () => {
    for (const { d, c } of everyClause()) {
      for (const r of c.when?.reasons ?? []) {
        expect(RUN_END_REASONS, `${d.id}/${c.id}`).toContain(r);
      }
    }
  });
});

// --- 2. the drift guard ------------------------------------------------------------------------------

describe("the requirement vocabulary does not drift between the schema and the engine", () => {
  /**
   * A live probe per key rather than a hand-kept list: for each key the schema permits, build a
   * requirement that sets ONLY that key to a value the probe summary fails, and assert the engine
   * actually rejects it. A key the engine ignores admits everything and is caught here.
   */
  const PROBE = {
    reasons: ["escaped"], minDays: 999, maxDays: 0, minHumanity: 999, maxHumanity: 0,
    minHumanityShift: 99, maxHumanityShift: -99, minMoralActs: 999, minMet: 999,
    minSurvivorsLost: 999, minCompanions: 999, minCompanionsLost: 999, minDeparted: 999,
    minRooms: 999, minNightsHeld: 999, minBreached: 999, minFights: 999, minOverruns: 999,
    minNodesSeen: 999, minNodesCleaned: 999, minEncounters: 999, minStages: 999,
    maxBreached: -1,
    requiresClaimed: true, requiresBaseLost: true, requiresBattered: true, forbidsBattered: true,
    requiresAlone: true, requiresFeverish: true, requiresAtBase: true, forbidsClaimed: true,
    standActs: ["no-act-by-this-name"],
  } as const satisfies Record<string, unknown>;

  const NEUTRAL = {
    reason: "lastStand", won: false, days: 3, turns: 20,
    humanity: 50, humanityShift: 0, moralActs: 0,
    met: 0, survivorsLost: 0, companionsLost: 0, departed: 0, companions: 1,
    claimed: false, baseLost: false, rooms: 0, barricades: 0, atBase: false, nightsHeld: 0, breached: 0,
    fightsEnded: 0, overruns: 0, nodesSeen: 1, nodesCleaned: 0, encounters: 0,
    committed: null, stages: 0,
    hurt: false, feverish: false, starving: false, parched: false, battered: false,
    standAct: null, standShape: null,
  } as const;

  it("every key the schema permits is one the engine reads", () => {
    const schemaKeys = Object.keys(SCHEMA.$defs.requirement.properties).sort();
    expect(schemaKeys.length).toBeGreaterThan(20);
    for (const key of schemaKeys) {
      expect(Object.keys(PROBE), `probe covers schema key ${key}`).toContain(key);
      const req = { [key]: (PROBE as Record<string, unknown>)[key] } as EndingRequirement;
      // Two keys are satisfied by the neutral summary as written, so the probe flips the summary for
      // those rather than exempting the key from the guard.
      const summary = key === "forbidsBattered" ? { ...NEUTRAL, battered: true }
        : key === "forbidsClaimed" ? { ...NEUTRAL, claimed: true }
        : NEUTRAL;
      expect(matchesEnding(summary, req), `schema key "${key}" is ignored by matchesEnding`).toBe(false);
    }
  });

  it("the schema's key set and the ENGINE's canonical list are the SAME set, both ways", () => {
    // The strongest form of the guard, and the cheapest: the engine now exports the list its own
    // `matchesEnding` is typed over, so a key added to one side and not the other fails here rather
    // than turning an authored gate into a no-op somewhere in the field.
    expect([...Object.keys(SCHEMA.$defs.requirement.properties)].sort())
      .toEqual([...ENDING_REQUIREMENT_KEYS].sort());
  });

  it("every key a shipped clause uses is one the schema permits", () => {
    const schemaKeys = new Set(Object.keys(SCHEMA.$defs.requirement.properties));
    for (const { d, c } of everyClause()) {
      for (const key of Object.keys(c.when ?? {})) {
        expect(schemaKeys, `${d.id}/${c.id} uses "${key}"`).toContain(key);
      }
    }
  });
});

// --- 3. the shipped prose actually assembles ----------------------------------------------------------

/** Drive a bot to the end of a run and hand back the finished state. */
function played(seed: string, budget = 400): { state: GameState; graph: RegionGraph } {
  let { state, graph } = city(seed);
  let rng = 7;
  const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
  for (let i = 0; i < budget && runEndReason(state) === null; i += 1) {
    const choices = availableIds(state, graph);
    if (choices.length === 0) break;
    const before = state;
    state = applyPick(state, graph, choices[rand(choices.length)]!);
    if (state === before) break;
  }
  return { state, graph };
}

const availableIds = (s: GameState, g: RegionGraph): ReturnType<typeof availableActions> => availableActions(s, g);
const applyPick = (s: GameState, g: RegionGraph, c: ReturnType<typeof availableActions>[number]): GameState =>
  applyAction(s, c.action, g).state;

describe("FR-STY-06: two runs that end the same way can read differently", () => {
  const runs = Array.from({ length: 24 }, (_, i) => played(`ending-content-${i}`)).filter((r) => runEndReason(r.state) !== null);

  it("produced enough finished runs to say anything at all", () => {
    expect(runs.length).toBeGreaterThanOrEqual(12);
  });

  it("closes every finished run on an assembled ending whose first line is the pre-T61 one", () => {
    for (const { state, graph } of runs) {
      const reason = runEndReason(state)!;
      const e = assembleEnding(state, graph)!;
      expect(e.reason).toBe(reason);
      expect(e.shape).toBe(endingShape(state));
      expect(e.source).not.toBeNull();
      expect(e.lines[0]).toBe(reasonScene(state, graph, reason));
      expect(e.lines.length).toBeGreaterThan(1);
      expect(e.clauseIds.length).toBeLessThanOrEqual(ENDING_CLAUSE_LIMIT);
      expect(sceneOf(state, graph).narration).toBe(endingText(e));
    }
  });

  it("does NOT collapse to one text per reason — the defect T61 exists for", () => {
    const byReason = new Map<string, Set<string>>();
    for (const { state, graph } of runs) {
      const reason = runEndReason(state)!;
      const set = byReason.get(reason) ?? new Set<string>();
      set.add(sceneOf(state, graph).narration);
      byReason.set(reason, set);
    }
    // At least one reason must yield more than one closing. (Asserting it for EVERY reason would be a
    // test of the seed rather than of the code — a reason reached once cannot vary.)
    const varied = [...byReason.entries()].filter(([, texts]) => texts.size > 1);
    expect(varied.length, `reasons: ${[...byReason.entries()].map(([k, v]) => `${k}=${v.size}`).join(" ")}`)
      .toBeGreaterThan(0);
  });

  it("every clause it prints is one the run actually satisfies", () => {
    for (const { state, graph } of runs) {
      const e = assembleEnding(state, graph)!;
      const def = ENDINGS.find((d) => d.shape === e.shape)!;
      const summary = summarizeRun(state, graph);
      for (const id of e.clauseIds) {
        const clause = def.clauses.find((c) => c.id === id)!;
        expect(matchesEnding(summary, clause.when), `${def.id}/${id}`).toBe(true);
        expect(endingText(e)).toContain(clause.text);
      }
    }
  });

  it("prints the clauses in non-increasing weight order", () => {
    for (const { state, graph } of runs) {
      const e = assembleEnding(state, graph)!;
      const def = ENDINGS.find((d) => d.shape === e.shape)!;
      const weights = e.clauseIds.map((id) => def.clauses.find((c) => c.id === id)!.weight);
      expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    }
  });
});
