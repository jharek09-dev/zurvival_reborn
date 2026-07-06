import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  availableActions,
  inflictWound,
  isWounded,
  loadGame,
  saveGame,
  startRun,
  treatWound,
  woundBurden,
  woundPlayer,
  woundRemainder,
  worstWound,
  type GameState,
  type NodeDef,
  type RegionGraph,
  type RegionDef,
  type WoundDef,
} from "../src/index.js";

/**
 * T16 — named wounds (FR-INJ-01, FR-INJ-04). Wounds are discrete, named, persistent, and leave the
 * body only through treatment; nothing in the passage of time heals them.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a"] },
];
const opts = { seed: "wound-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const LACERATION: WoundDef = { id: "wound.laceration", name: "Deep Laceration", description: "a cut", severity: 30, effect: "bleed" };
const BITE: WoundDef = { id: "wound.bite", name: "Bite Wound", description: "teeth", severity: 40, effect: "infect-risk" };

function take(state: GameState, graph: RegionGraph, choiceId: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === choiceId);
  if (!c) throw new Error(`no choice ${choiceId}`);
  return applyAction(state, c.action, graph).state;
}

describe("inflict (T16 · FR-INJ-01)", () => {
  it("adds a named wound carrying type id, site, severity, treated:0, and the day", () => {
    const { state } = run();
    const hurt = woundPlayer(state, LACERATION, "left-forearm");
    expect(hurt.player.condition.wounds).toHaveLength(1);
    const w = hurt.player.condition.wounds[0]!;
    expect(w).toMatchObject({ type: "wound.laceration", site: "left-forearm", severity: 30, treated: 0, inflictedDay: state.meta.day });
    expect(isWounded(hurt.player.condition)).toBe(true);
    expect(woundBurden(hurt.player.condition)).toBe(30);
  });

  it("accumulates: wounds stack, they do not merge into a bigger number", () => {
    const { state } = run();
    let c = inflictWound(state.player.condition, LACERATION, "arm", 1);
    c = inflictWound(c, BITE, "calf", 1);
    expect(c.wounds).toHaveLength(2);
    expect(woundBurden(c)).toBe(70);
    expect(worstWound(c)!.type).toBe("wound.bite"); // 40 > 30
  });

  it("survives save/load and is integer-only", () => {
    const hurt = woundPlayer(run().state, BITE, "calf");
    expect(loadGame(saveGame(hurt))).toStrictEqual(hurt);
    expect(Number.isInteger(hurt.player.condition.wounds[0]!.severity)).toBe(true);
  });
});

describe("treat, and only treat, closes a wound (T16 · FR-INJ-04)", () => {
  it("advances treated toward severity and removes the wound only at completion", () => {
    const { state } = run();
    let c = inflictWound(state.player.condition, LACERATION, "arm", 1); // severity 30
    c = treatWound(c, 10);
    expect(c.wounds[0]!.treated).toBe(10);
    expect(woundRemainder(c.wounds[0]!)).toBe(20);
    c = treatWound(c, 10);
    expect(c.wounds[0]!.treated).toBe(20);
    c = treatWound(c, 50); // overshoot caps at severity ⇒ closed & removed
    expect(c.wounds).toHaveLength(0);
    expect(isWounded(c)).toBe(false);
  });

  it("treats the worst wound, honoring a site filter, and no-ops when nothing matches", () => {
    let c = inflictWound(run().state.player.condition, LACERATION, "arm", 1);
    c = inflictWound(c, BITE, "calf", 1);
    c = treatWound(c, 5, "arm"); // only the arm laceration advances
    expect(c.wounds.find((w) => w.site === "arm")!.treated).toBe(5);
    expect(c.wounds.find((w) => w.site === "calf")!.treated).toBe(0);
    expect(treatWound(c, 5, "no-such-site")).toBe(c); // nothing at that site ⇒ unchanged ref
    // with no site, the worst (bite, 40) is chosen over the partly-treated laceration
    const c2 = treatWound(c, 5);
    expect(c2.wounds.find((w) => w.site === "calf")!.treated).toBe(5);
  });

  it("a zero/negative care amount is inert", () => {
    let c = inflictWound(run().state.player.condition, LACERATION, "arm", 1);
    expect(treatWound(c, 0)).toBe(c);
    expect(treatWound(c, -9)).toBe(c);
  });
});

describe("no auto-regeneration (T16 DoD · FR-INJ-04)", () => {
  it("playing the loop (move/search/rest) never lowers a wound's severity or remainder", () => {
    let { state, graph } = run();
    state = woundPlayer(state, BITE, "calf"); // severity 40, treated 0
    const before = state.player.condition.wounds[0]!;
    for (const id of ["search", "rest", "move:node.x.b", "rest", "search"]) {
      const choice = availableActions(state, graph).find((c) => c.id === id);
      if (!choice) continue;
      state = applyAction(state, choice.action, graph).state;
      const w = state.player.condition.wounds[0]!;
      expect(w.severity).toBe(before.severity); // fixed at infliction
      expect(w.treated).toBe(0); // time applied no care
      expect(woundRemainder(w)).toBe(40);
    }
  });

  it("property: over any no-treatment play, the wound multiset never shrinks", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("search", "rest", "move:node.x.b", "move:node.x.a"), { maxLength: 25 }), (script) => {
        let { state, graph } = run();
        state = woundPlayer(state, LACERATION, "arm");
        const startCount = state.player.condition.wounds.length;
        const startBurden = woundBurden(state.player.condition);
        for (const id of script) {
          const c = availableActions(state, graph).find((x) => x.id === id);
          if (!c) continue;
          state = applyAction(state, c.action, graph).state;
        }
        expect(state.player.condition.wounds.length).toBeGreaterThanOrEqual(startCount);
        expect(woundBurden(state.player.condition)).toBeGreaterThanOrEqual(startBurden);
      }),
    );
  });
});
