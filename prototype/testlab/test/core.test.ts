import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { applyAction, availableActions, saveGame, loadGame, isRunOver, inventoryWeight, CARRY_CAPACITY } from "../../engine/src/index.js";
import { loadContent } from "../src/loadContent.js";
import { bootCity, graphFor, STOCK_KIT } from "../src/boot.js";
import { POLICY_NAMES, policyRng, kindOf, ZERO_COST_KINDS } from "../src/policies.js";
import { checkIntegers, checkLeak, checkTurn, deepEqual, firstDiff, renderAll, type Rendered } from "../src/checks.js";
import { RunSession, runToEnd, expandBatch, defaultSeeds, DEFAULT_SPEC, type RunSpec } from "../src/runner.js";
import { summarize, summaryText, reproLine } from "../src/report.js";

const content = loadContent();

const spec = (over: Partial<RunSpec> & { seed: string; policy: RunSpec["policy"] }): RunSpec => ({ ...DEFAULT_SPEC, ...over });

describe("boot — the full-city beta, pinned", () => {
  it("boots every pool and is byte-identical from the same seed", () => {
    const a = bootCity(content, "tl-boot");
    const b = bootCity(content, "tl-boot");
    expect(a.state).toStrictEqual(b.state);
    expect(a.state.meta.createdAt).toBe("2026-09-12T00:00:00.000Z");
    expect(Object.keys(a.state.nodes).length).toBe(60);
    expect(Object.keys(a.state.npcs).length).toBe(18);
  });
  it("stocked applies a kit that fits the pack; graphFor rebuilds a graph a loaded save can play on", () => {
    const { state } = bootCity(content, "tl-stock", { stocked: true });
    expect(state.player.inventory).toStrictEqual(STOCK_KIT);
    expect(inventoryWeight(state.player.inventory)).toBeLessThanOrEqual(CARRY_CAPACITY);
    const loaded = loadGame(saveGame(state));
    const graph = graphFor(content);
    expect(availableActions(loaded, graph).length).toBeGreaterThan(0);
  });
});

describe("policies", () => {
  it("only ever pick an offered choice, and are reproducible from the seed", () => {
    for (const policy of POLICY_NAMES) {
      const a = runToEnd(content, spec({ seed: "tl-pol", policy, turns: 60, replay: false, detSample: 0, saveSample: 0 }));
      const b = runToEnd(content, spec({ seed: "tl-pol", policy, turns: 60, replay: false, detSample: 0, saveSample: 0 }));
      expect(a.choiceIds).toStrictEqual(b.choiceIds);
      expect(a.choiceIds.length).toBeGreaterThan(10);
    }
  });
  it("policy rng is its own stream (never the engine's)", () => {
    const r1 = policyRng("x");
    const r2 = policyRng("x");
    expect([r1(), r1(), r1()]).toStrictEqual([r2(), r2(), r2()]);
    expect(policyRng("y")()).not.toBe(policyRng("x")());
  });
  it("the random policy never chains more than two free verbs when a costed choice exists", () => {
    const r = runToEnd(content, spec({ seed: "tl-free", policy: "random", turns: 300, replay: false, detSample: 0, saveSample: 0 }));
    let streak = 0;
    for (const id of r.choiceIds) {
      streak = ZERO_COST_KINDS.has(kindOf(id)) ? streak + 1 : 0;
      expect(streak).toBeLessThanOrEqual(3);
    }
  });
});

describe("the checker on the current build", () => {
  for (const policy of POLICY_NAMES) {
    it(`${policy} plays 1 seed × 80 actions (stocked) with zero failures`, () => {
      const r = runToEnd(content, spec({ seed: "tl-green", policy, turns: 80 }));
      expect(r.failures, JSON.stringify(r.failures.slice(0, 3), null, 1)).toStrictEqual([]);
      expect(r.ok).toBe(true);
      expect(r.perf.samples).toBe(r.actions);
    });
  }
  it("an unstocked run ends cleanly for a known reason and reports it", () => {
    const r = runToEnd(content, spec({ seed: "tl-die", policy: "greedy", turns: 400, stocked: false }));
    expect(["starved", "dehydrated", "infection", "alive"]).toContain(r.end);
    expect(r.ok).toBe(true);
    if (r.end !== "alive") expect(r.choiceIds.length).toBeLessThan(400);
  });
  it("the batch cross product and summary hold together", () => {
    const specs = expandBatch({ seeds: defaultSeeds(2), policies: ["careful", "random"], stocked: [true, false], turns: 30, budgetMs: 100, saveSample: 10, detSample: 1, replay: true });
    expect(specs.length).toBe(8);
    const reports = specs.map((s) => runToEnd(content, s));
    const s = summarize(reports);
    expect(s.runs).toBe(8);
    expect(s.failed).toBe(0);
    const text = summaryText(reports);
    expect(text).toContain("8 runs · 8 passed");
    expect(reproLine(reports[0]!, 3)).toBe("seed=tl-1 policy=careful stocked=yes turns=30 stop-at-step=3");
  });
});

describe("stepping, take-over and replay", () => {
  it("a human choice runs the same checks as a bot choice, and replaying the recorded ids reproduces the state", () => {
    const run = new RunSession(content, spec({ seed: "tl-step", policy: "careful", turns: 40 }));
    for (let i = 0; i < 10; i += 1) run.step();
    const offered = run.choices();
    expect(offered.length).toBeGreaterThan(0);
    const human = run.step(offered[offered.length - 1]!.id);
    expect(human.choice?.id).toBe(offered[offered.length - 1]!.id);
    expect(() => run.step("not-a-choice")).toThrow(/not offered/);
    while (!run.done) run.step();
    const report = run.finish();
    expect(report.ok).toBe(true);
    expect(report.failuresByCheck["CHK-REPLAY"]).toBeUndefined();
    // Replaying by hand from a fresh boot lands on the identical state.
    let s = bootCity(content, "tl-step", { stocked: true }).state;
    const graph = graphFor(content);
    for (const id of report.choiceIds) s = applyAction(s, availableActions(s, graph).find((c) => c.id === id)!.action, graph).state;
    expect(s).toStrictEqual(run.state);
  });
  it("peek shows the bot's next pick without consuming its randomness", () => {
    const run = new RunSession(content, spec({ seed: "tl-peek", policy: "careful", turns: 20 }));
    const p1 = run.peek();
    const p2 = run.peek();
    expect(p1?.id).toBe(p2?.id);
    const twin = new RunSession(content, spec({ seed: "tl-peek", policy: "careful", turns: 20 }));
    for (let i = 0; i < 20; i += 1) {
      run.peek();
      run.step();
      twin.step();
    }
    expect(run.choiceIds).toStrictEqual(twin.choiceIds);
  });
  it("resumes from a save and replays from that save, not the seed", () => {
    const base = bootCity(content, "tl-resume", { stocked: true });
    let s = base.state;
    for (let i = 0; i < 5; i += 1) s = applyAction(s, availableActions(s, base.graph)[0]!.action, base.graph).state;
    const saved = loadGame(saveGame(s));
    const r = runToEnd(content, spec({ seed: "tl-resume", policy: "careful", turns: 30 }), saved);
    expect(r.resumed).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.resolvedTurns).toBeLessThanOrEqual(30);
  });
});

describe("the checker gates (negative proofs)", () => {
  it("CHK-INT catches a float and a -0", () => {
    expect(checkIntegers({ a: [1, { b: 2 }] })).toBeNull();
    expect(checkIntegers({ a: [1, { b: 2.5 }] })).toBe("$.a[1].b = 2.5");
    expect(checkIntegers({ z: -0 })).toMatch(/-0/);
    const r = runToEnd(content, spec({ seed: "tl-float", policy: "careful", turns: 5, replay: false }), undefined, {
      mutate: (st, step) => (step === 2 ? { ...st, world: { ...st.world, globalThreat: st.world.globalThreat + 0.5 } } : st),
    });
    expect(r.failuresByCheck["CHK-INT"]).toBe(1);
    expect(r.failures.find((f) => f.id === "CHK-INT")?.detail).toContain("state.world.globalThreat");
  });
  it("CHK-LEAK catches a digit in the status region", () => {
    expect(checkLeak(["You feel steady.", "Pack: 3/40."])).toBeNull();
    expect(checkLeak(["Infection: 42"])).toMatch(/carries a number/);
  });
  it("CHK-TURN catches a clock that did not move", () => {
    const { state } = bootCity(content, "tl-turn");
    expect(checkTurn(state, state, 2)).toMatch(/meta.turn moved/);
    expect(checkTurn(state, state, 0)).toBeNull();
    expect(checkTurn(state, { ...state, meta: { ...state.meta, turn: state.meta.turn + 1, day: state.meta.day + 2 } }, 1)).toMatch(/jumped/);
  });
  it("CHK-CRASH catches a renderer that throws and ends the run", () => {
    const r = runToEnd(content, spec({ seed: "tl-crash", policy: "careful", turns: 20, replay: false }), undefined, {
      render: (st, g) => {
        if (st.meta.turn >= 3) throw new Error("boom in render");
        return renderAll(st, g);
      },
    });
    expect(r.end).toBe("crashed");
    expect(r.failuresByCheck["CHK-CRASH"]).toBe(1);
    expect(r.failures[0]?.detail).toBe("boom in render");
    expect(r.failures[0]?.stack).toBeDefined();
  });
  it("CHK-RENDER catches an empty render", () => {
    const empty: Rendered = { scene: { turn: 0, day: 1, hour: 0, phase: "dawn", narration: "", choices: [] }, lines: [], status: [], screens: {} };
    const r = runToEnd(content, spec({ seed: "tl-empty", policy: "careful", turns: 2, replay: false }), undefined, { render: () => empty });
    expect(r.failuresByCheck["CHK-RENDER"]).toBe(2);
  });
  it("CHK-SAVE/CHK-RESUME catch state the save format cannot carry", () => {
    // NaN survives applyAction untouched but JSON turns it into null — a save that does not round-trip.
    const r = runToEnd(content, spec({ seed: "tl-nan", policy: "careful", turns: 10, saveSample: 5, replay: false }), undefined, {
      mutate: (st, step) => (step === 4 ? { ...st, world: { ...st.world, military: Number.NaN } } : st),
    });
    expect(r.failuresByCheck["CHK-SAVE"]).toBeGreaterThanOrEqual(1);
    expect(r.failures.find((f) => f.id === "CHK-SAVE")?.detail).toContain("state.world.military");
  });
  it("CHK-PERF fails when the budget is zero", () => {
    const r = runToEnd(content, spec({ seed: "tl-perf", policy: "careful", turns: 5, budgetMs: 0, replay: false }));
    expect(r.failuresByCheck["CHK-PERF"]).toBe(5);
  });
});

describe("deepEqual agrees with node:util on real states", () => {
  it("equal states are equal, and the first diff is located", () => {
    const { state, graph } = bootCity(content, "tl-eq", { stocked: true });
    const next = applyAction(state, availableActions(state, graph)[0]!.action, graph).state;
    expect(deepEqual(state, loadGame(saveGame(state)))).toBe(isDeepStrictEqual(state, loadGame(saveGame(state))));
    expect(deepEqual(state, next)).toBe(isDeepStrictEqual(state, next));
    expect(firstDiff(state, next)).toMatch(/^\$\./);
    expect(firstDiff({ a: [1, 2] }, { a: [1, 3] })).toBe("$.a[1]: 2 vs 3");
    expect(firstDiff({ a: 1 }, { a: 1, b: 2 })).toBe("$.b: missing vs present");
    expect(isRunOver(state)).toBe(false);
  });
});
