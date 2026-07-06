import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  recruit,
  tickCompanions,
  killCompanion,
  isCompanion,
  companionIds,
  companionsHere,
  recordHistory,
  loadGame,
  saveGame,
  diffSystems,
  RECRUIT_MIN,
  NEED_FATAL,
  type GameState,
  type NodeDef,
  type NPCDef,
  type NPCState,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T36 — Recruitable companion & permanent, remembered death (FR-NPC-03/04, VS subset). A trusted, met
 * survivor graduates from `npcs` into an `actors` companion that follows the player and can be lost for
 * good. Deterministic, integer-only, save-lossless.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "Clinic", description: "a clinic", adjacent: ["node.k"], start: true },
  { id: "node.k", regionId: "region.z", name: "Store", description: "a store", adjacent: ["node.s"] },
];
const NPCS: NPCDef[] = [
  { id: "npc.sarah", name: "Sarah", description: "a paramedic", disposition: "friendly", homeNode: "node.s" },
];
const opts = { seed: "comp-seed", createdAt: "2026-07-06T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS);

const withNpc = (state: GameState, id: string, over: Partial<NPCState>): GameState => ({
  ...state,
  npcs: { ...state.npcs, [id]: { ...state.npcs[id]!, ...over } },
});
/** A run where Sarah is met and trusted enough to recruit. */
const recruitable = (): { state: GameState; graph: RegionGraph } => {
  const { state, graph } = run();
  return { state: withNpc(state, "npc.sarah", { met: true, trust: RECRUIT_MIN + 5 }), graph };
};

// --- recruit ----------------------------------------------------------------------------------

describe("recruit graduates a survivor npcs → actors (T36 · FR-NPC-03)", () => {
  it("moves the survivor out of npcs into actors as a flagged companion at the player's node", () => {
    const { state } = recruitable();
    const needs = state.npcs["npc.sarah"]!.needs;
    const after = recruit(state, "npc.sarah");
    expect("npc.sarah" in after.npcs).toBe(false);
    expect("npc.sarah" in after.actors).toBe(true);
    const c = after.actors["npc.sarah"]!;
    expect(isCompanion(c)).toBe(true);
    expect(c.location).toBe(after.player.location);
    expect(c.condition.needs).toStrictEqual(needs); // needs carry over from the met survivor
    expect(companionIds(after)).toStrictEqual(["npc.sarah"]);
  });

  it("is offered only when the T34 gate is open AND the survivor has been met", () => {
    const { state, graph } = run();
    const offered = (s: GameState): string[] => availableActions(s, graph).map((c) => c.id);
    // trusted but unmet — no recruit (you cannot ask a stranger).
    expect(offered(withNpc(state, "npc.sarah", { met: false, trust: 90 }))).not.toContain("recruit:npc.sarah");
    // met but under the trust floor — no recruit.
    expect(offered(withNpc(state, "npc.sarah", { met: true, trust: RECRUIT_MIN - 1 }))).not.toContain("recruit:npc.sarah");
    // met and trusted — recruit is offered.
    expect(offered(withNpc(state, "npc.sarah", { met: true, trust: RECRUIT_MIN }))).toContain("recruit:npc.sarah");
  });

  it("recruiting through the pipeline moves npcs and actors, and logs it", () => {
    const { state, graph } = recruitable();
    const action = availableActions(state, graph).find((c) => c.id === "recruit:npc.sarah")!.action;
    const res = applyAction(state, action, graph);
    expect(res.changed).toContain("npcs");
    expect(res.changed).toContain("actors");
    expect(companionIds(res.state)).toStrictEqual(["npc.sarah"]);
    expect(recordHistory(state, res.state).map((e) => e.type)).toContain("companion.recruited");
  });

  it("is inert on an unknown or dead survivor", () => {
    const { state } = run();
    expect(recruit(state, "npc.nobody")).toBe(state);
    const dead = withNpc(state, "npc.sarah", { alive: false });
    expect(recruit(dead, "npc.sarah")).toBe(dead);
  });
});

// --- upkeep: drift + follow -------------------------------------------------------------------

describe("companions live in the sim — drift and follow (T36)", () => {
  it("tickCompanions drifts a companion's needs by the hours spent", () => {
    const c = recruit(recruitable().state, "npc.sarah");
    const before = c.actors["npc.sarah"]!.condition.needs;
    const after = tickCompanions(c, 3).actors["npc.sarah"]!.condition.needs;
    expect(after.thirst).toBeGreaterThan(before.thirst);
    expect(after.hunger).toBeGreaterThan(before.hunger);
  });

  it("is inert on a zero-hour tick and on an empty party (empty-turn contract)", () => {
    const c = recruit(recruitable().state, "npc.sarah");
    expect(tickCompanions(c, 0)).toBe(c);
    const { state } = run();
    expect(tickCompanions(state, 6)).toBe(state); // no companions recruited yet
  });

  it("a companion follows the player across a move (stage 5, integration)", () => {
    const { state, graph } = recruitable();
    let s = recruit(state, "npc.sarah");
    expect(s.actors["npc.sarah"]!.location).toBe("node.s");
    const move = availableActions(s, graph).find((c) => c.id === "move:node.k")!.action;
    s = applyAction(s, move, graph).state;
    expect(s.player.location).toBe("node.k");
    expect(s.actors["npc.sarah"]!.location).toBe("node.k"); // followed
  });
});

// --- permanent, remembered death --------------------------------------------------------------

describe("permanent, remembered companion death (T36 · FR-NPC-04)", () => {
  const starve = (s: GameState): GameState => ({
    ...s,
    actors: {
      ...s.actors,
      "npc.sarah": {
        ...s.actors["npc.sarah"]!,
        condition: { ...s.actors["npc.sarah"]!.condition, needs: { hunger: NEED_FATAL - 1, thirst: 0, fatigue: 0 } },
      },
    },
  });

  it("a starved companion is removed for good and remembered on the player", () => {
    let s = recruit(recruitable().state, "npc.sarah");
    s = starve(s);
    const dead = tickCompanions(s, 6);
    expect("npc.sarah" in dead.actors).toBe(false); // removed permanently
    expect(dead.player.flags["fallen.npc.sarah"]).toBe(true); // remembered
    // Does not return on subsequent ticks.
    expect("npc.sarah" in tickCompanions(dead, 12).actors).toBe(false);
  });

  it("the death reaches the Living History as companion.died", () => {
    let s = recruit(recruitable().state, "npc.sarah");
    s = starve(s);
    const dead = tickCompanions(s, 6);
    expect(recordHistory(s, dead).map((e) => e.type)).toContain("companion.died");
  });

  it("killCompanion removes and remembers a companion (the combat/scripted seam)", () => {
    const s = recruit(recruitable().state, "npc.sarah");
    const after = killCompanion(s, "npc.sarah");
    expect("npc.sarah" in after.actors).toBe(false);
    expect(after.player.flags["fallen.npc.sarah"]).toBe(true);
    // Inert on a non-companion id.
    expect(killCompanion(after, "npc.sarah")).toBe(after);
  });
});

// --- persistence + full slice -----------------------------------------------------------------

describe("companions are save-lossless and the full slice runs (T36)", () => {
  it("a run carrying a companion round-trips deep-equal across the v6 save", () => {
    const s = recruit(recruitable().state, "npc.sarah");
    expect(loadGame(saveGame(s))).toStrictEqual(s);
  });

  it("meet → share → recruit → keep → grieve, deterministic and audit-clean", () => {
    const play = (): GameState => {
      const { state, graph } = recruitable();
      const seq = ["talk:npc.sarah", "recruit:npc.sarah", "move:node.k", "move:node.s"];
      let s = state;
      for (const id of seq) {
        const choice = availableActions(s, graph).find((c) => c.id === id);
        if (choice === undefined) continue; // talk may already be met
        const res = applyAction(s, choice.action, graph);
        // FR-CORE-04: every resolved turn moved at least one tracked system.
        expect(res.changed.length).toBeGreaterThan(0);
        s = res.state;
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(saveGame(a)).toStrictEqual(saveGame(b)); // byte-identical from the same seed
    expect(companionIds(a)).toStrictEqual(["npc.sarah"]); // Sarah joined and travelled with the player
    expect(a.actors["npc.sarah"]!.location).toBe("node.s");
  });
});
