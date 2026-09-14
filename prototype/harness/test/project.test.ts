import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  runEndReason,
  ENDING_FLAG_HELD,
  ENDING_FLAG_ESCAPED,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type ProjectDef,
  type HistoryEvent,
} from "../../engine/src/index.js";
import { describeSoundscape } from "../src/soundscape.js";
import { historyLine, renderDepthScreen } from "../src/screens.js";

/**
 * T87 — the CLIENT half of the terminal project: what the player actually hears and reads when a run
 * ends well.
 *
 * Both cases here are integration-audit findings, and both are the same defect wearing two faces:
 * **`isRunOver` stopped being a synonym for "the player died" and two renderers had not been told.**
 * The soundscape played the loss one-shot over a won ending, and the Living History — the log T61 is
 * meant to assemble an ending FROM — printed the most important beat a run can write as two
 * contextless words. Each was run against the unfixed tree and observed to fail there.
 */

const REGIONS: RegionDef[] = [{ id: "region.r", name: "R", description: "r", baseline: { threat: 10, zombieDensity: 10, loot: 80 } }];
const NODES: NodeDef[] = [
  { id: "node.r.home", regionId: "region.r", name: "Home", description: "a depot", adjacent: ["node.r.b"], start: true, claimable: true },
  { id: "node.r.b", regionId: "region.r", name: "B", description: "a lot", adjacent: ["node.r.home"] },
];
const HOLDOUT: ProjectDef = {
  id: "project.holdout.test", kind: "holdout", label: "The Test Block", premise: "stay",
  stages: [{ id: "only", label: "Only stage", worldEffect: "it holds", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 2 }],
  ending: "THE BLOCK ENDING.",
};
const ESCAPE: ProjectDef = {
  id: "project.departure.test", kind: "escape", label: "The Test Road", premise: "go",
  stages: [{ id: "only", label: "Only stage", worldEffect: "it runs", accepts: [{ item: "item.scrap", qty: 1 }], timeCost: 2 }],
  ending: "THE ROAD ENDING.",
};

const boot = (projects: ProjectDef[]): { state: GameState; graph: RegionGraph } =>
  startRun({ seed: "harness-t87", createdAt: "2026-09-14T00:00:00Z" }, REGIONS, NODES, [], [], [], [], [], [], [], [], projects);

/** Play a one-stage project all the way to its ending, from a claimed base. */
function won(project: ProjectDef): { state: GameState; graph: RegionGraph } {
  const { state, graph } = boot([project]);
  let s: GameState = {
    ...state,
    player: {
      ...state.player, location: "node.r.home", shelterId: "node.r.home",
      inventory: [{ type: "item.scrap", quantity: 4 }],
      condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 } },
    },
  };
  for (const prefix of ["project-commit:", "project-advance:"]) {
    const c = availableActions(s, graph).find((x) => x.id.startsWith(prefix))!;
    expect(c, prefix).toBeDefined();
    s = applyAction(s, c.action, graph).state;
  }
  return { state: s, graph };
}

describe("a won run is not rendered as a death", () => {
  it("plays HOPE, not the loss one-shot, when the run is won", () => {
    for (const [project, reason] of [[HOLDOUT, "held"], [ESCAPE, "escaped"]] as const) {
      const { state, graph } = won(project);
      expect(runEndReason(state)).toBe(reason);
      const sound = describeSoundscape(state, graph);
      expect(sound.tone, reason).not.toBeNull();
      expect(sound.tone, reason).not.toMatch(/falls away|held note/i);
      // the authored hope line, unreachable since T56 for want of exactly this event
      expect(sound.tone, reason).toMatch(/hope/i);
    }
  });

  it("still plays the loss one-shot for a death", () => {
    const { state, graph } = boot([HOLDOUT]);
    const dead: GameState = {
      ...state,
      player: { ...state.player, condition: { ...state.player.condition, needs: { ...state.player.condition.needs, thirst: 100 } } },
    };
    expect(runEndReason(dead)).toBe("dehydrated");
    expect(describeSoundscape(dead, graph).tone).toMatch(/falls away|held note/i);
  });

  it("the run is OVER either way, so the loop still stops and nothing further is offered", () => {
    const { state, graph } = won(HOLDOUT);
    expect(availableActions(state, graph)).toEqual([]);
    expect(state.story.endingFlags[ENDING_FLAG_HELD]).toBe(true);
  });

  it("closes on the project's own words, not on a death line", () => {
    const { state, graph } = won(ESCAPE);
    const scene = sceneOf(state, graph);
    expect(scene.narration).toBe(ESCAPE.ending);
    expect(scene.choices).toEqual([]);
    expect(state.story.endingFlags[ENDING_FLAG_ESCAPED]).toBe(true);
  });
});

describe("the Living History reads the project's beats as sentences", () => {
  const beat = (type: string, data: HistoryEvent["data"]): HistoryEvent => ({ day: 4, hour: 10, turn: 9, type, subjects: ["player"], data });

  it("renders all three project beats without falling through to the raw key", () => {
    const lines = [
      historyLine(beat("project.committed", { project: "project.departure.test", kind: "escape" })),
      historyLine(beat("project.stage", { project: "project.departure.test", stage: "cast-off", paid: "item.scrap", qty: 2 })),
      historyLine(beat("project.complete", { project: "project.departure.test", kind: "escape" })),
    ];
    for (const l of lines) {
      // the `default:` arm humanises the type key, which is what the audit caught: "project stage."
      expect(l).not.toMatch(/— project (stage|complete|committed)\.$/);
      expect(l.length).toBeGreaterThan(30);
    }
    expect(lines[0]).toMatch(/way out/);
    expect(lines[2]).toMatch(/took it/);
  });

  it("tells a holdout run apart from an escape one", () => {
    const esc = historyLine(beat("project.complete", { project: "p", kind: "escape" }));
    const held = historyLine(beat("project.complete", { project: "p", kind: "holdout" }));
    expect(esc).not.toBe(held);
    expect(held).toMatch(/held/);
  });

  it("reports project work on the base screen's news, where base news belongs", () => {
    const { state, graph } = won(HOLDOUT);
    const shelter = renderDepthScreen("shelter", state, graph).join("\n");
    expect(shelter).toMatch(/worth holding|walls were finished/);
  });
});
