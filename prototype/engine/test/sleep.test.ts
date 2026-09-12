import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  updateCondition,
  saveGame,
  phaseOf,
  SLEEP_WAKE_HOUR,
  SLEEP_RECOVERY_PER_HOUR,
  inSleepWindow,
  hoursUntilWake,
  type Action,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T58 — "Sleep until morning": a dedicated wind-down at your own base, offered only within the nightly
 * window (20:00–04:00), that runs the clock forward to 08:00 and recovers fatigue by the hours slept while
 * hunger/thirst still climb. Additive + gated behind a NEW `sleep` action type, so every prior run stays
 * byte-identical (the rest of the suite is that guard); these tests pin the new behaviour itself.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"] },
];
const opts = { seed: "sleep-seed", createdAt: "2026-07-06T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);
const HERE = "node.x.a";
const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id);
const sleepAction: Action = { type: "sleep", choiceId: "sleep", timeCost: 4 };

const withShelter = (s: GameState, id: string | null): GameState => ({
  ...s,
  player: { ...s.player, shelterId: id as GameState["player"]["shelterId"] },
});
const withHour = (s: GameState, h: number): GameState => ({
  ...s,
  meta: { ...s.meta, hour: h, phase: phaseOf(h) },
});
const withFatigue = (s: GameState, f: number): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, fatigue: f } } },
});

describe("sleep window + wake-time helpers (T58, retuned T71)", () => {
  it("inSleepWindow covers 21:00–03:00 and excludes the day", () => {
    for (const h of [21, 22, 23, 0, 2, 3]) expect(inSleepWindow(h)).toBe(true);
    for (const h of [4, 5, 8, 12, 19, 20]) expect(inSleepWindow(h)).toBe(false);
  });
  it("hoursUntilWake counts forward to 06:00, wrapping midnight", () => {
    expect(hoursUntilWake(21)).toBe(9);
    expect(hoursUntilWake(22)).toBe(8);
    expect(hoursUntilWake(0)).toBe(6);
    expect(hoursUntilWake(3)).toBe(3);
    expect(hoursUntilWake(5)).toBe(1);
  });
});

describe("Sleep-until-morning is gated to your base + the night window (T58)", () => {
  it("is offered at your own shelter within the window", () => {
    const { state, graph } = run();
    expect(ids(availableActions(withHour(withShelter(state, HERE), 22), graph))).toContain("sleep");
  });
  it("is NOT offered away from your shelter, even at night", () => {
    const { state, graph } = run();
    expect(ids(availableActions(withHour(state, 22), graph))).not.toContain("sleep");
  });
  it("is NOT offered at your shelter during the day (outside the window)", () => {
    const { state, graph } = run();
    expect(ids(availableActions(withHour(withShelter(state, HERE), 12), graph))).not.toContain("sleep");
  });
  it("advertises the hours to 06:00 as its time cost", () => {
    const { state, graph } = run();
    const sleep = availableActions(withHour(withShelter(state, HERE), 23), graph).find((c) => c.id === "sleep");
    expect(sleep?.timeCost).toBe(hoursUntilWake(23)); // 7
  });
});

describe("sleeping recovers by the hours slept and wakes you at morning (T58)", () => {
  it("fatigue drops by SLEEP_RECOVERY_PER_HOUR·hours; hunger/thirst still climb (updateCondition)", () => {
    const { state } = run();
    const s = withFatigue(withHour(withShelter(state, HERE), 4), 90);
    const before = s.player.condition.needs;
    const after = updateCondition(s, sleepAction).player.condition.needs;
    expect(after.fatigue).toBe(Math.max(0, 90 - SLEEP_RECOVERY_PER_HOUR * 4)); // 50
    expect(after.hunger).toBeGreaterThan(before.hunger);
    expect(after.thirst).toBeGreaterThan(before.thirst);
  });
  it("a longer sleep recovers more than a short one (recovery scales with hours)", () => {
    const { state } = run();
    const base = withFatigue(withShelter(state, HERE), 95);
    const short = updateCondition(base, { type: "sleep", choiceId: "sleep", timeCost: 4 }).player.condition.needs.fatigue;
    const long = updateCondition(base, { type: "sleep", choiceId: "sleep", timeCost: 10 }).player.condition.needs.fatigue;
    expect(long).toBeLessThan(short);
    expect(long).toBe(0); // 95 - 100, clamped
  });
  it("waking runs the clock forward to 06:00, across midnight", () => {
    const { state, graph } = run();
    const s = withHour(withShelter(state, HERE), 22);
    const sleep = availableActions(s, graph).find((c) => c.id === "sleep")!;
    const after = applyAction(s, sleep.action, graph).state;
    expect(after.meta.hour).toBe(SLEEP_WAKE_HOUR);
    expect(after.meta.day).toBe(s.meta.day + 1);
  });
  it("is a real turn (moves the survival system) and is deterministic", () => {
    const { state, graph } = run();
    const s = withFatigue(withHour(withShelter(state, HERE), 23), 70);
    const act = availableActions(s, graph).find((c) => c.id === "sleep")!.action;
    const a = applyAction(s, act, graph);
    const b = applyAction(s, act, graph);
    expect(a.changed.length).toBeGreaterThan(0);
    expect(saveGame(a.state)).toBe(saveGame(b.state));
  });
});
