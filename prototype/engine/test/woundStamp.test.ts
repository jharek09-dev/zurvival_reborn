import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEncounterEffect,
  availableActions,
  startRun,
  woundAgeHours,
  woundPlayer,
  DIRECTOR_FRESH_WOUND_HOURS,
  ENEMY_BLOATED,
  ENEMIES,
  HORDE_AWARENESS,
  ZOMBIE_WALKER,
  type GameState,
  type Horde,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T78 — every LIVE wound source stamps `inflictedHour`. The director's "shock" clause (an open wound
 * younger than `DIRECTOR_FRESH_WOUND_HOURS`) reads that stamp; a source that forgets it produces a
 * wound that counts from 00:00 of its day and can only read OLDER than it is — so the clause would be
 * dead wiring for that source, silently. The T78 audit found all six call sites unprotected: a
 * mutation dropping `, state.meta.hour` from any one of them survived the whole suite. One test per
 * source, each running the real path (the pipeline, not `inflictWound` directly), plus the exported
 * `woundPlayer` helper, which the verification pass found as a seventh, unstamped source.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 40, loot: 50 } }];
const line = (types: readonly string[], walkers = 2): NodeDef[] => [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true, walkers, zombieTypes: types },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a", "node.x.c"] },
  { id: "node.x.c", regionId: "region.x", name: "C", description: "a clinic", adjacent: ["node.x.b"] },
];
const boot = (types: readonly string[], seed = "stamp-seed", walkers = 2): { state: GameState; graph: RegionGraph } =>
  startRun({ seed, createdAt: "2026-09-13T00:00:00Z" }, REGIONS, line(types, walkers));

function take(state: GameState, graph: RegionGraph, choiceId: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === choiceId);
  if (!c) throw new Error(`no choice ${choiceId}; offered: ${availableActions(state, graph).map((x) => x.id).join(",")}`);
  return applyAction(state, c.action, graph).state;
}
/** The clock the wound was opened under: the state AFTER the action's time cost was spent. */
const stampedLikeTheClock = (before: GameState, after: GameState): void => {
  const fresh = after.player.condition.wounds.slice(before.player.condition.wounds.length);
  expect(fresh.length).toBeGreaterThan(0);
  for (const w of fresh) {
    expect(w.inflictedDay).toBe(after.meta.day);
    expect(w.inflictedHour).toBe(after.meta.hour);
    expect(woundAgeHours(w, after.meta.day, after.meta.hour)).toBeLessThan(DIRECTOR_FRESH_WOUND_HOURS);
  }
};
/** Drive `step` from fresh boots over seeds until a NEW wound lands; the source under test must be reachable. */
function firstWound(types: readonly string[], step: (s: GameState, g: RegionGraph) => GameState, walkers = 2): { before: GameState; after: GameState } {
  for (let i = 0; i < 40; i++) {
    const { state, graph } = boot(types, `stamp-${i}`, walkers);
    const after = step(state, graph);
    if (after.player.condition.wounds.length > state.player.condition.wounds.length) return { before: state, after };
  }
  throw new Error("no seed in 40 produced a wound on this path");
}

describe("every live wound source stamps the hour the wound was opened (T78)", () => {
  it("combat: a walker's blow in a fight (`enemyRetaliate`)", () => {
    const { before, after } = firstWound([ZOMBIE_WALKER], (s, g) => {
      let cur = take(s, g, "fight");
      let guard = 0;
      while (cur.combat !== null && guard++ < 12 && cur.player.condition.wounds.length === 0) cur = take(cur, g, "strike");
      return cur;
    });
    stampedLikeTheClock(before, after);
  });

  it("combat: the Bloated one's burst on death (`resolveKill`)", () => {
    const { before, after } = firstWound(["zombie.bloated"], (s, g) => {
      let cur = take(s, g, "fight");
      let guard = 0;
      while (cur.combat !== null && guard++ < 20) cur = take(cur, g, "strike");
      return cur;
    }, 1);
    const burst = after.player.condition.wounds.find((w) => w.type === "wound.bite" && w.severity === ENEMIES[ENEMY_BLOATED]!.burstInfection);
    expect(burst).toBeDefined();
    expect(burst!.inflictedHour).toBe(after.meta.hour);
    stampedLikeTheClock(before, after);
  });

  it("combat: a detected slip past a Crawler — the ankle grab (`resolveSlip`, grasp branch)", () => {
    const loud = (s: GameState): GameState => ({
      ...s,
      meta: { ...s.meta, phase: "midday" },
      nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, noise: 100 } },
    });
    const { before, after } = firstWound(["zombie.crawler"], (s, g) => take(loud(s), g, "slip:node.x.b"), 1);
    expect(after.player.condition.wounds.every((w) => w.type === "wound.sprain")).toBe(true);
    stampedLikeTheClock(before, after);
  });

  it("combat: a detected slip past a walker — the parting blow (`resolveSlip`, table branch)", () => {
    const loud = (s: GameState): GameState => ({
      ...s,
      meta: { ...s.meta, phase: "midday" },
      nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, noise: 100 } },
    });
    const { before, after } = firstWound([ZOMBIE_WALKER], (s, g) => take(loud(s), g, "slip:node.x.b"));
    stampedLikeTheClock(before, after);
  });

  it("overrun: holding under a mass (`resolveOverrunAction`)", () => {
    const horde = (pos: string, size = 40): Horde => ({ id: "horde.1", size, pos, dest: null, speed: 1, awareness: HORDE_AWARENESS, types: [ZOMBIE_WALKER] });
    const { before, after } = firstWound([], (s, g) => {
      const under: GameState = {
        ...s,
        nodes: Object.fromEntries(Object.entries(s.nodes).map(([id, n]) => [id, { ...n, discovered: true }])),
        hordes: [horde(s.player.location)],
      };
      return take(under, g, "hold");
    }, 0);
    stampedLikeTheClock(before, after);
  });

  it("the public `woundPlayer` helper (the seventh source — unused in the engine today, but exported)", () => {
    const { state } = boot([], "stamp-helper", 0);
    const at: GameState = { ...state, meta: { ...state.meta, day: 2, hour: 9 } };
    const after = woundPlayer(at, { id: "wound.laceration", name: "cut", description: "", severity: 30, effect: "bleed" }, "arm");
    stampedLikeTheClock(at, after);
  });

  it("encounters: the `inflictWound` effect (`applyEncounterEffect`)", () => {
    const { state } = boot([], "stamp-effect", 0);
    const at: GameState = { ...state, meta: { ...state.meta, day: 4, hour: 17 } };
    const after = applyEncounterEffect(at, { kind: "inflictWound", wound: "wound.sprain", site: "ankle", severity: 20 }, { encounterId: "encounter.test", node: "node.x.a" });
    stampedLikeTheClock(at, after);
  });
});
