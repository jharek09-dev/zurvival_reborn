import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  loadGame,
  saveGame,
  sceneOf,
  startRun,
  stageFor,
  advanceInfection,
  stageFatigue,
  hasSuccumbed,
  isInfected,
  clampInfection,
  stageRank,
  stageInfo,
  infectionSign,
  infectionLine,
  infectionOutcomeLine,
  perceptionDistortion,
  canDiagnose,
  canCureInfection,
  canQuarantine,
  infectionChoices,
  isInfectionAction,
  resolveInfectionAction,
  runEndReason,
  INFECTION_STAGES,
  STAGE_ORDER,
  CURE_BY_STAGE,
  QUARANTINE_BY_STAGE,
  ANTIBIOTICS_ITEM,
  DIAGNOSED_FLAG,
  INFECTION_STREAM,
  BITE_INFECT_RATE,
  INFECT_SYMPTOMATIC_AT,
  INFECT_ADVANCED_AT,
  INFECT_TERMINAL_AT,
  INFECT_SUCCUMB_AT,
  INFECT_CEILING,
  type GameState,
  type Infection,
  type InfectionStage,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
  type Wound,
} from "../src/index.js";

/**
 * T49 — infection as staged identity. A hidden, staged sickness (asymptomatic → symptomatic → advanced →
 * terminal) that is a *harder way to keep playing* (FR-INJ-08), never an instant Game Over: it alters
 * perception (FR-INJ-06), and offers diagnosis / a cure race / quarantine (FR-INJ-07), late & uncertain.
 */

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { loot: 80, survivorActivity: 0 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a store", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a clinic", adjacent: ["node.x.a"], kind: "medical" },
];
const opts = { seed: "infect-seed", createdAt: "2026-07-17T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const bite = (): Wound => ({ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: 1 });
const withBite = (s: GameState): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, wounds: [bite()] } },
});
const withInf = (s: GameState, infection: Infection): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, infection } },
});
const withInv = (s: GameState, inv: [string, number][]): GameState => ({
  ...s,
  player: { ...s.player, inventory: inv.map(([type, quantity]) => ({ type, quantity })) },
});
const atStage = (s: GameState, stage: InfectionStage, progression: number): GameState =>
  withInf(s, { stage, progression });
const claimHere = (s: GameState): GameState => ({ ...s, player: { ...s.player, shelterId: s.player.location } });
const rest6 = { type: "rest", choiceId: "rest", timeCost: 6 } as const;

// --- FR-INJ-05: staged identity, no bar --------------------------------------------------------

describe("staged progression (T49 · FR-INJ-05)", () => {
  it("keeps the T22 thresholds and inserts `advanced` between symptomatic and terminal", () => {
    expect(stageFor(0)).toBe("none");
    expect(stageFor(1)).toBe("incubating");
    expect(stageFor(INFECT_SYMPTOMATIC_AT)).toBe("symptomatic");
    expect(stageFor(INFECT_ADVANCED_AT - 1)).toBe("symptomatic");
    expect(stageFor(INFECT_ADVANCED_AT)).toBe("advanced");
    expect(stageFor(INFECT_TERMINAL_AT - 1)).toBe("advanced");
    expect(stageFor(INFECT_TERMINAL_AT)).toBe("terminal");
    expect(stageFor(INFECT_SUCCUMB_AT)).toBe("terminal"); // succumb is a threshold *within* terminal
  });

  it("orders the five stages and ranks them monotonically", () => {
    expect(STAGE_ORDER).toEqual(["none", "incubating", "symptomatic", "advanced", "terminal"]);
    expect(stageRank("none")).toBeLessThan(stageRank("incubating"));
    expect(stageRank("advanced")).toBeLessThan(stageRank("terminal"));
  });

  it("clamps progression to 0..INFECT_CEILING (its own clamp, past 100)", () => {
    expect(clampInfection(-5)).toBe(0);
    expect(clampInfection(130)).toBe(130);
    expect(clampInfection(INFECT_CEILING + 50)).toBe(INFECT_CEILING);
  });

  it("has four authored stage identities, each with a distinct symptom past asymptomatic", () => {
    expect(INFECTION_STAGES.map((s) => s.key)).toEqual(["incubating", "symptomatic", "advanced", "terminal"]);
    expect(stageInfo("incubating")!.symptom).toBeNull(); // asymptomatic: nothing to feel yet
    const symptoms = INFECTION_STAGES.filter((s) => s.key !== "incubating").map((s) => s.symptom);
    expect(symptoms.every((t) => typeof t === "string" && t!.length > 0)).toBe(true);
    expect(new Set(symptoms).size).toBe(symptoms.length); // every stage reads differently
  });
});

// --- the driver + its consequences -------------------------------------------------------------

describe("the infection driver (T49)", () => {
  it("climbs while an untreated bite is open, and past terminal onset toward the ceiling", () => {
    const inf = advanceInfection({ stage: "none", progression: 0 }, true, 6);
    expect(inf.progression).toBe(BITE_INFECT_RATE * 6);
    // past 100: terminal onset does not cap it — it climbs on toward succumb.
    const late = advanceInfection({ stage: "terminal", progression: INFECT_TERMINAL_AT }, true, 10);
    expect(late.progression).toBe(INFECT_TERMINAL_AT + BITE_INFECT_RATE * 10);
    expect(late.stage).toBe("terminal");
  });

  it("does not advance with no open bite, or on a zero-hour turn", () => {
    expect(advanceInfection({ stage: "symptomatic", progression: 50 }, false, 6).progression).toBe(50);
    expect(advanceInfection({ stage: "symptomatic", progression: 50 }, true, 0).progression).toBe(50);
  });

  it("the fever adds stage-scaled fatigue (none/asymptomatic add nothing)", () => {
    expect(stageFatigue("none", 6)).toBe(0);
    expect(stageFatigue("incubating", 6)).toBe(0);
    expect(stageFatigue("symptomatic", 6)).toBeGreaterThan(0);
    expect(stageFatigue("advanced", 6)).toBeGreaterThan(stageFatigue("symptomatic", 6));
    expect(stageFatigue("terminal", 6)).toBeGreaterThan(stageFatigue("advanced", 6));
  });
});

// --- FR-INJ-08: no instant Game Over; a delayed succumb ----------------------------------------

describe("terminal is playable; the run ends only at a delayed succumb (T49 · FR-INJ-08)", () => {
  it("terminal onset does NOT end the run — it is the cure race", () => {
    expect(hasSuccumbed({ stage: "terminal", progression: INFECT_TERMINAL_AT })).toBe(false);
    expect(runEndReason(atStage(run().state, "terminal", INFECT_TERMINAL_AT))).toBeNull();
    const { state, graph } = run();
    const terminalOnset = atStage(state, "terminal", INFECT_TERMINAL_AT);
    expect(availableActions(terminalOnset, graph).length).toBeGreaterThan(0); // still playing
  });

  it("the run ends by infection only once progression reaches the succumb collapse", () => {
    expect(hasSuccumbed({ stage: "terminal", progression: INFECT_SUCCUMB_AT })).toBe(true);
    expect(runEndReason(atStage(run().state, "terminal", INFECT_SUCCUMB_AT))).toBe("infection");
  });

  it("an ignored bite runs the full arc — terminal reached, still playable, then succumbs", () => {
    let { state, graph } = run();
    state = withInv(withBite(state), [["item.water", 60], ["item.canned-food", 60]]);
    let reachedTerminal = false;
    let playedAtTerminal = 0;
    let died = false;
    for (let i = 0; i < 80; i++) {
      const choices = availableActions(state, graph);
      if (choices.length === 0) { died = true; break; }
      if (state.player.condition.infection.stage === "terminal") {
        reachedTerminal = true;
        playedAtTerminal++;
      }
      // survive needs; never treat the bite — let the infection win.
      const c = choices.find((x) => x.id === "drink") ?? choices.find((x) => x.id === "eat") ?? choices.find((x) => x.id === "rest")!;
      state = applyAction(state, c.action, graph).state;
    }
    expect(reachedTerminal).toBe(true);
    expect(playedAtTerminal).toBeGreaterThan(1); // a real window of play at terminal — not an instant loss
    expect(died).toBe(true);
    expect(runEndReason(state)).toBe("infection");
  });
});

// --- FR-INJ-07: diagnosis, cure race, quarantine ----------------------------------------------

describe("diagnosis (T49 · FR-INJ-07)", () => {
  it("is offered when infected and holding supplies; names the stage precisely once done", () => {
    const s = withInv(atStage(run().state, "advanced", 75), [["item.antiseptic", 1]]);
    expect(canDiagnose(s)).toBe(true);
    // before diagnosis, the line is the honest *symptom*, never the stage word.
    expect(infectionLine(s)).toBe(stageInfo("advanced")!.symptom);
    const after = resolveInfectionAction(s, { type: "diagnose", choiceId: "diagnose" });
    expect(after.player.flags[DIAGNOSED_FLAG]).toBe(true);
    expect(infectionLine(after)).toContain("advanced"); // now named
    expect(canDiagnose(after)).toBe(false); // already known
  });

  it("is not offered without supplies or while healthy", () => {
    expect(canDiagnose(atStage(run().state, "symptomatic", 50))).toBe(false); // no supplies
    expect(canDiagnose(withInv(run().state, [["item.antiseptic", 1]]))).toBe(false); // not infected
  });
});

describe("the cure race — costlier and less certain the deeper it goes (T49 · FR-INJ-07)", () => {
  it("an early cure is strong and certain — no RNG draw, so it is byte-identical from seed", () => {
    const s = withInv(atStage(run().state, "symptomatic", INFECT_SYMPTOMATIC_AT + 10), [[ANTIBIOTICS_ITEM, 2]]);
    expect(canCureInfection(s)).toBe(true);
    const after = resolveInfectionAction(s, { type: "treat-infection", choiceId: "treat-infection" });
    expect(after.player.condition.infection.progression).toBe(INFECT_SYMPTOMATIC_AT + 10 - CURE_BY_STAGE.symptomatic.amount < 0 ? 0 : INFECT_SYMPTOMATIC_AT + 10 - CURE_BY_STAGE.symptomatic.amount);
    expect(after.player.inventory.find((e) => e.type === ANTIBIOTICS_ITEM)!.quantity).toBe(1); // one dose spent
    expect(after.rng).toEqual(s.rng); // certain ⇒ no stream advanced
  });

  it("a late cure draws the `infection` stream — deterministic, and it advances ONLY that stream", () => {
    const s = withInv(atStage(run().state, "advanced", 80), [[ANTIBIOTICS_ITEM, 1]]);
    const a1 = resolveInfectionAction(s, { type: "treat-infection", choiceId: "treat-infection" });
    const a2 = resolveInfectionAction(s, { type: "treat-infection", choiceId: "treat-infection" });
    expect(a1.player.condition.infection.progression).toBe(a2.player.condition.infection.progression); // same seed ⇒ same
    const removed = 80 - a1.player.condition.infection.progression;
    expect([CURE_BY_STAGE.advanced.amount, CURE_BY_STAGE.advanced.partial]).toContain(removed);
    // only the infection stream moved — no other system's RNG sequence shifted.
    expect(a1.rng.streams[INFECTION_STREAM]).toBeDefined();
    for (const k of Object.keys(s.rng.streams)) {
      if (k !== INFECTION_STREAM) expect(a1.rng.streams[k]).toEqual(s.rng.streams[k]);
    }
  });

  it("the cure can reverse a stage (halt/reverse early stages, GDD VI)", () => {
    const s = withInv(atStage(run().state, "symptomatic", 45), [[ANTIBIOTICS_ITEM, 1]]);
    const after = resolveInfectionAction(s, { type: "treat-infection", choiceId: "treat-infection" });
    expect(stageRank(after.player.condition.infection.stage)).toBeLessThan(stageRank("symptomatic"));
  });
});

describe("quarantine — clean conditions, strong early, useless late (T49 · FR-INJ-07)", () => {
  it("is offered only in your own shelter while infected, and drops early-stage progression", () => {
    const notHome = atStage(run().state, "symptomatic", 55);
    expect(canQuarantine(notHome)).toBe(false); // no shelter here
    const home = claimHere(atStage(run().state, "symptomatic", 55));
    expect(canQuarantine(home)).toBe(true);
    const after = resolveInfectionAction(home, { type: "quarantine", choiceId: "quarantine" });
    expect(after.player.condition.infection.progression).toBe(55 - QUARANTINE_BY_STAGE.symptomatic);
  });

  it("is NOT even offered at terminal — clean conditions can't touch the late body (no dead-option trap)", () => {
    const home = claimHere(atStage(run().state, "terminal", 110));
    expect(canQuarantine(home)).toBe(false);
    expect(infectionChoices(home).map((c) => c.id)).not.toContain("quarantine");
    // resolving it anyway is inert — the gate holds, so no 8h are burned for nothing.
    const after = resolveInfectionAction(home, { type: "quarantine", choiceId: "quarantine" });
    expect(after.player.condition.infection.progression).toBe(110);
  });
});

describe("a cure/quarantine gives honest, no-number feedback (T49 · FR-INJ-07)", () => {
  it("logs an outcome beat and surfaces a legible result line the turn it happens", () => {
    // a partial-only late cure still tells the player it merely 'held'.
    const home = withInv(atStage(run().state, "advanced", 80), [[ANTIBIOTICS_ITEM, 1]]);
    const after = resolveInfectionAction(home, { type: "treat-infection", choiceId: "treat-infection" });
    const beat = after.history.find((h) => h.type === "infection.treated");
    expect(beat).toBeDefined();
    expect(["cleared", "eased", "held"]).toContain((beat!.data as { outcome: string }).outcome);
    // the outcome line reads for exactly this turn (turn-stamped).
    const stamped = { ...after, meta: { ...after.meta, turn: beat!.turn } };
    expect(infectionOutcomeLine(stamped)).not.toBeNull();
  });
});

// --- FR-INJ-06: perception, symptoms, dialogue ------------------------------------------------

describe("perception distortion is stateless and honest-symptom-gated (T49 · FR-INJ-06)", () => {
  it("only ever fires at advanced/terminal, never earlier", () => {
    expect(perceptionDistortion(atStage(run().state, "none", 0))).toBeNull();
    expect(perceptionDistortion(atStage(run().state, "incubating", 10))).toBeNull();
    expect(perceptionDistortion(atStage(run().state, "symptomatic", 50))).toBeNull();
  });

  it("is a pure function of state — the same state yields the same distortion (resume-safe)", () => {
    const s = atStage(run().state, "terminal", 120);
    expect(perceptionDistortion(s)).toBe(perceptionDistortion(s));
    // and a render never advances the rng: sceneOf twice is byte-identical narration.
    const graph = run().graph;
    expect(sceneOf(s, graph).narration).toBe(sceneOf(s, graph).narration);
  });

  it("colours the scene but never fabricates a real threat — a quiet node still offers explore, not combat", () => {
    const { state, graph } = run();
    // find a turn whose terminal state actually hallucinates, then prove it changed nothing real.
    let s = atStage(state, "terminal", 120);
    let sawHallucination = false;
    for (let t = 0; t < 30 && !sawHallucination; t++) {
      const probe = { ...s, meta: { ...s.meta, turn: t } };
      if (perceptionDistortion(probe) !== null) {
        sawHallucination = true;
        const choices = availableActions(probe, graph);
        expect(probe.nodes[probe.player.location]!.walkers).toBe(0); // no real walkers were created
        expect(choices.some((c) => c.id === "search" || c.id.startsWith("move:"))).toBe(true); // explore, not a forced fight
      }
    }
    expect(sawHallucination).toBe(true);
  });

  it("shows a visible sign only from symptomatic on; others react to it", () => {
    expect(infectionSign(atStage(run().state, "incubating", 10))).toBeNull();
    expect(infectionSign(atStage(run().state, "symptomatic", 50))).not.toBeNull();
    expect(infectionSign(atStage(run().state, "terminal", 110))).not.toBeNull();
  });
});

// --- action wiring ----------------------------------------------------------------------------

describe("infection actions are wired into the loop (T49)", () => {
  it("infectionChoices surface only when infected; none while healthy", () => {
    expect(infectionChoices(run().state)).toEqual([]);
    const sick = withInv(claimHere(atStage(run().state, "symptomatic", 50)), [[ANTIBIOTICS_ITEM, 1], ["item.antiseptic", 1]]);
    const ids = infectionChoices(sick).map((c) => c.id);
    expect(ids).toContain("treat-infection");
    expect(ids).toContain("quarantine");
    expect(ids).toContain("diagnose");
  });

  it("classifies its own action types and dispatches them", () => {
    expect(isInfectionAction({ type: "treat-infection" })).toBe(true);
    expect(isInfectionAction({ type: "quarantine" })).toBe(true);
    expect(isInfectionAction({ type: "diagnose" })).toBe(true);
    expect(isInfectionAction({ type: "rest" })).toBe(false);
  });

  it("isInfected reads the stage", () => {
    expect(isInfected(run().state)).toBe(false);
    expect(isInfected(atStage(run().state, "incubating", 5))).toBe(true);
  });

  it("offers NOTHING while asymptomatic — the hidden clock isn't leaked by a self-care option", () => {
    // incubating IS infected, but with antibiotics + at a shelter, no infection verb appears yet.
    const hidden = withInv(claimHere(atStage(run().state, "incubating", 20)), [[ANTIBIOTICS_ITEM, 1], ["item.antiseptic", 1]]);
    expect(infectionChoices(hidden)).toEqual([]);
    expect(isInfected(hidden)).toBe(true); // it's there — just not perceivable/actionable yet
  });
});

// --- determinism + save -----------------------------------------------------------------------

describe("infection is deterministic and save-lossless (T49)", () => {
  it("a run carrying a mid-terminal infection round-trips through save/load", () => {
    const s = withInv(atStage(withBite(run().state), "terminal", 120), [[ANTIBIOTICS_ITEM, 1]]);
    expect(loadGame(saveGame(s))).toStrictEqual(s);
  });

  it("a bite-driven arc through the pipeline is byte-identical on a replay", () => {
    const bootstrap = withInv(withBite(run().state), [["item.water", 40]]);
    const graph = run().graph;
    const play = (): GameState => {
      let st = bootstrap;
      for (let i = 0; i < 20; i++) {
        const cs = availableActions(st, graph);
        const c = cs.find((x) => x.id === "drink") ?? cs.find((x) => x.id === "rest");
        if (!c) break;
        st = applyAction(st, c.action, graph).state;
      }
      return st;
    };
    expect(play()).toStrictEqual(play());
  });

  it("records an `infection.staged` beat in the Living History when the fever deepens", () => {
    let { state, graph } = run();
    state = withInv(withBite(state), [["item.water", 40]]);
    let sawStaged = false;
    for (let i = 0; i < 40 && !sawStaged; i++) {
      const cs = availableActions(state, graph);
      const c = cs.find((x) => x.id === "drink") ?? cs.find((x) => x.id === "rest");
      if (!c) break;
      const res = applyAction(state, c.action, graph);
      state = res.state;
      if (state.history.some((h) => h.type === "infection.staged")) sawStaged = true;
    }
    expect(sawStaged).toBe(true);
  });
});
