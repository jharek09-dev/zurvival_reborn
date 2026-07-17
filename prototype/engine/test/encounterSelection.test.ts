import { describe, expect, it } from "vitest";
import {
  startRun,
  activeEncounter,
  eligibleEncounters,
  selectEncounter,
  chooseEncounter,
  evaluateEvents,
  ENCOUNTER_STREAM,
  type EncounterDef,
  type GameState,
  type HistoryEvent,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

/**
 * T48 — tagged-pool weighting + cooldown suppression (FR-ENC-01/02). Selection is now tiered: an eligible
 * one-shot (scripted) beat still wins deterministically by fit with NO RNG draw (so every prior golden is
 * byte-identical); only an all-repeatable eligible set runs the ambient model — cooldowns read from the
 * Living History, a single candidate returns without drawing, ≥2 draw one weighted pick from the
 * `encounter` stream favouring fresh + tag-diverse content.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { threat: 20, loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true, kind: "generic" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a"], kind: "store" },
];
const opts = { seed: "sel-seed", createdAt: "2026-07-17T00:00:00Z" };

const ambient = (id: string, tag: string, cd = 72): EncounterDef => ({
  id, category: "exploration", title: id, premise: id, repeatable: true, cooldownHours: cd, tags: [tag],
  requirements: { nodeIds: ["node.x.a"] },
  stages: [{ id: "s", narration: "an ambient beat", choices: [{ id: "ok", label: "ok", timeCost: 1, effects: [{ kind: "logHistory", event: "encounter.note" }] }] }],
});
const ONESHOT: EncounterDef = {
  id: "encounter.test.oneshot", category: "story", title: "scripted", premise: "scripted",
  requirements: { nodeIds: ["node.x.a"] },
  stages: [{ id: "s", narration: "a scripted beat", choices: [{ id: "ok", label: "ok", timeCost: 1, effects: [{ kind: "logHistory", event: "x" }] }] }],
};

const runWith = (pool: EncounterDef[], seed = opts.seed) => startRun({ ...opts, seed }, REGIONS, NODES, [], [], pool);
const atA = (s: GameState): GameState => ({ ...s, player: { ...s.player, location: "node.x.a" }, nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, walkers: 0 } } });
const beginBeat = (id: string, day: number, hour: number): HistoryEvent => ({ day, hour, turn: 1, type: "encounter.begin", subjects: [id, "node.x.a"], data: { encounter: id, category: "exploration" } });

describe("cooldown suppression is read from the Living History (T48 · FR-ENC-02)", () => {
  it("a repeatable within its cooldown window is ineligible; past it, eligible again", () => {
    const R = ambient("encounter.test.r", "x", 72);
    const { state, graph } = runWith([R]);
    const withFire = atA({ ...state, history: [...state.history, beginBeat(R.id, 1, 0)] }); // fired at abs 24
    const within = { ...withFire, meta: { ...withFire.meta, day: 3, hour: 0 } }; // abs 72 → 48h since fire < 72 ⇒ cooldown
    expect(eligibleEncounters(within, graph).map((e) => e.id)).not.toContain(R.id);
    const after = { ...withFire, meta: { ...withFire.meta, day: 5, hour: 0 } }; // abs 120 → 96h since fire ≥ 72 ⇒ eligible
    expect(eligibleEncounters(after, graph).map((e) => e.id)).toContain(R.id);
  });

  it("a one-shot ignores cooldown (its done-flag governs it) — cooldown only gates repeatables", () => {
    const { state, graph } = runWith([ONESHOT]);
    const s = atA({ ...state, history: [...state.history, beginBeat(ONESHOT.id, 1, 0)], meta: { ...state.meta, day: 1, hour: 6 } });
    expect(eligibleEncounters(s, graph).map((e) => e.id)).toContain(ONESHOT.id); // not suppressed by the recent beat
  });
});

describe("tiered selection: scripted deterministic, ambient weighted (T48)", () => {
  it("a single eligible repeatable engages WITHOUT drawing the encounter stream", () => {
    const R = ambient("encounter.test.solo", "x");
    const { state, graph } = runWith([R]);
    const s = atA(state);
    const chosen = chooseEncounter(s, graph);
    expect(chosen.def?.id).toBe(R.id);
    expect(chosen.rng).toBe(s.rng); // same reference — no draw happened
    const after = evaluateEvents(s, graph);
    expect(activeEncounter(after)?.encounter).toBe(R.id);
    expect(ENCOUNTER_STREAM in after.rng.streams).toBe(false); // the stream was never seeded
  });

  it("an eligible one-shot always wins over an eligible repeatable, without drawing", () => {
    const { state, graph } = runWith([ONESHOT, ambient("encounter.test.amb", "x")]);
    const s = atA(state);
    const chosen = chooseEncounter(s, graph);
    expect(chosen.def?.id).toBe(ONESHOT.id);
    expect(chosen.rng).toBe(s.rng);
    // selectEncounter (the deterministic fit view) agrees
    expect(selectEncounter(s, graph)?.id).toBe(ONESHOT.id);
  });

  it("≥2 eligible repeatables draw exactly the encounter stream, purely/deterministically", () => {
    const pool = [ambient("encounter.test.r1", "x"), ambient("encounter.test.r2", "y")];
    const { state, graph } = runWith(pool);
    const s = atA(state);
    const first = chooseEncounter(s, graph);
    expect([pool[0]!.id, pool[1]!.id]).toContain(first.def?.id);
    expect(ENCOUNTER_STREAM in first.rng.streams).toBe(true); // a draw happened
    // purity: same state ⇒ same pick
    expect(chooseEncounter(s, graph).def?.id).toBe(first.def?.id);
    // ONLY the encounter stream advanced — every other stream is byte-identical (stream independence, T5)
    for (const k of Object.keys(s.rng.streams)) expect(first.rng.streams[k]).toBe(s.rng.streams[k]);
  });

  it("nothing eligible ⇒ inert: no draw, no engage, no encounter stream", () => {
    const R = ambient("encounter.test.cd", "x", 72);
    const { state, graph } = runWith([R]);
    const s = atA({ ...state, history: [...state.history, beginBeat(R.id, 1, 5)], meta: { ...state.meta, day: 1, hour: 6 } }); // just fired ⇒ on cooldown
    const after = evaluateEvents(s, graph);
    expect(activeEncounter(after)).toBeNull();
    expect(ENCOUNTER_STREAM in after.rng.streams).toBe(false);
  });
});

describe("weighting favours the tag-diverse beat (T48 · FR-ENC-01/02)", () => {
  it("when a shared tag just fired, the cold-tag beat is favoured across seeds", () => {
    const R1 = ambient("encounter.test.hot", "hot"); // shares the freshly-fired tag
    const R2 = ambient("encounter.test.cold", "cold"); // its tag is cold
    const SIB = ambient("encounter.test.hotsib", "hot"); // fired 1h ago → tag 'hot' is hot, and SIB itself is on cooldown
    const pool = [R1, R2, SIB];
    let hot = 0;
    let cold = 0;
    for (let i = 0; i < 200; i++) {
      const { state, graph } = runWith(pool, `seed-${i}`);
      const s = atA({ ...state, history: [...state.history, beginBeat(SIB.id, state.meta.day, Math.max(0, state.meta.hour - 1))], meta: { ...state.meta, day: state.meta.day, hour: state.meta.hour } });
      const eligibleIds = eligibleEncounters(s, graph).map((e) => e.id);
      expect(eligibleIds).not.toContain(SIB.id); // SIB is on cooldown → only R1/R2 compete
      const pick = chooseEncounter(s, graph).def?.id;
      if (pick === R1.id) hot++;
      else if (pick === R2.id) cold++;
    }
    expect(cold).toBeGreaterThan(hot); // the cold-tag beat wins the majority — diversity suppresses the hot theme
  });
});
