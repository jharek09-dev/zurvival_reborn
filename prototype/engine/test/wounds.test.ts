import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyAction,
  availableActions,
  inflictWound,
  REST_COST,
  REST_WOUND_CARE,
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
 * body only through applied care; nothing in the passage of time heals them. T59 added the second
 * source of care GDD Part VI names alongside treatment — a deliberate rest — which is still an action
 * the player chooses and pays hours for, never the clock. See the FR-INJ-04 block below.
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

/**
 * FR-INJ-04 is *"health is treated, not **auto**-regenerated"*, and T59 is where the word `auto` had to
 * be read carefully. GDD Part VI, "Recovery, and dying anyway", says in so many words: *"Health is
 * restored by treatment and rest, not by walking it off."* T59 gave `rest` / `sleep` / `quarantine` that
 * job (`sim/survival.ts#REST_WOUND_CARE`), because measurement showed the item route did not exist in
 * practice — a cautious bot takes 5.79 wounds a run and finds 0.13 medical items.
 *
 * So the requirement splits into two claims, and BOTH are tested below, which is strictly more than the
 * pre-T59 pair asserted:
 *
 *   1. **Walking it off still does nothing.** Time, movement and searching never lower a wound. This is
 *      the half FR-INJ-04 is actually about and it is unchanged.
 *   2. **Healing is never automatic.** Every point of care comes from an action the player CHOSE — a
 *      treatment, or stopping — and stopping costs the hours that every other clock in the game is
 *      denominated in.
 */
describe("no auto-regeneration (T16 DoD · FR-INJ-04 · T59)", () => {
  it("WALKING IT OFF does nothing: move/search never lower a wound's severity or remainder", () => {
    let { state, graph } = run();
    state = woundPlayer(state, BITE, "calf"); // severity 40, treated 0
    const before = state.player.condition.wounds[0]!;
    for (const id of ["search", "move:node.x.b", "search", "move:node.x.a", "search"]) {
      const choice = availableActions(state, graph).find((c) => c.id === id);
      if (!choice) continue;
      state = applyAction(state, choice.action, graph).state;
      const w = state.player.condition.wounds[0]!;
      expect(w.severity).toBe(before.severity); // fixed at infliction
      expect(w.treated).toBe(0); // time applied no care
      expect(woundRemainder(w)).toBe(40);
    }
  });

  it("STOPPING does: a deliberate rest applies REST_WOUND_CARE per hour, and nothing else does", () => {
    let { state, graph } = run();
    state = woundPlayer(state, BITE, "calf");
    const rest = availableActions(state, graph).find((c) => c.id === "rest");
    expect(rest, "rest must be offered on a quiet node").toBeDefined();
    const after = applyAction(state, rest!.action, graph).state;
    // The care is exactly the hours spent x the dial — not a flat amount, and not a fraction of severity.
    expect(after.player.condition.wounds[0]!.treated).toBe(REST_WOUND_CARE * REST_COST);
    // ...and the severity is still fixed at infliction. A wound is closed, never shrunk.
    expect(after.player.condition.wounds[0]!.severity).toBe(BITE.severity);
  });

  it("property: over any play, care only ever comes from a turn the player spent stopping", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("search", "rest", "move:node.x.b", "move:node.x.a"), { maxLength: 25 }), (script) => {
        let { state, graph } = run();
        state = woundPlayer(state, LACERATION, "arm");
        const startCount = state.player.condition.wounds.length;
        let burden = woundBurden(state.player.condition);
        for (const id of script) {
          const c = availableActions(state, graph).find((x) => x.id === id);
          if (!c) continue;
          const before = state;
          state = applyAction(state, c.action, graph).state;
          const now = woundBurden(state.player.condition);
          if (id === "rest") {
            // A rest may lower the burden, by at most the hours it spent x the dial.
            expect(burden - now).toBeLessThanOrEqual(REST_WOUND_CARE * (state.meta.turn > before.meta.turn ? REST_COST : 0));
          } else {
            // Everything else may only ever ADD to it (a new wound from an encounter), never subtract.
            expect(now).toBeGreaterThanOrEqual(burden);
          }
          burden = now;
        }
        // The wound LIST still only grows: a closed wound leaves the body, so this is the one claim
        // T59 genuinely weakened — it is asserted for the no-rest scripts, which is where it still holds.
        if (!script.includes("rest")) expect(state.player.condition.wounds.length).toBeGreaterThanOrEqual(startCount);
      }),
    );
  });
});
