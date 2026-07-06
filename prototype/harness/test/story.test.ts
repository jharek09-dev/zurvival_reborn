import { describe, expect, it } from "vitest";
import {
  startRun,
  sceneOf,
  availableActions,
  THE_LAST_CUSTOMER,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
} from "../../engine/src/index.js";
import { renderRegions, renderScene, playSession, transcript, parseCommand } from "../src/index.js";

/**
 * T40/T41 surfacing (FR-STORY-01 · FR-UI-STORY · NFR-ACC-01): the authored arc "The Last Customer" reads
 * as a story in the single-decision screen — the plea in the story region, its costed fork as numbered
 * choices — so the plain-text transcript carries the whole beat with no colour or pointer.
 */

const REGIONS: RegionDef[] = [{ id: "region.rm", name: "Rivermouth", description: "a drowned district", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.base", regionId: "region.rm", name: "Safehouse", description: "a shuttered pharmacy", adjacent: ["node.store"], start: true },
  { id: "node.store", regionId: "region.rm", name: "Corner Store", description: "a looted store", adjacent: ["node.base"] },
];
const NPCS: NPCDef[] = [
  { id: "npc.ruth", name: "Ruth", description: "a shopkeeper", disposition: "desperate", homeNode: "node.store" },
];
const ARC = THE_LAST_CUSTOMER.id;
const opts = { seed: "harness-story", createdAt: "2026-07-06T00:00:00Z" };

/** A mid-run state: base claimed, cache stocked, Ruth met and starving — one turn from her plea. */
function primed(): { state: GameState; graph: ReturnType<typeof startRun>["graph"] } {
  const { state, graph } = startRun(opts, REGIONS, NODES, NPCS, [ARC]);
  const here = state.player.location; // node.base
  const s: GameState = {
    ...state,
    player: { ...state.player, shelterId: here, stash: [{ type: "item.canned-food", quantity: 3 }] },
    npcs: { ...state.npcs, "npc.ruth": { ...state.npcs["npc.ruth"]!, met: true, needs: { hunger: 78, thirst: 78, fatigue: 40 } } },
  };
  return { state: s, graph };
}

describe("the authored arc reads as a story in the Scene (T40/T41)", () => {
  it("after the plea fires, the story region carries it and the fork is offered with costs", () => {
    const { state, graph } = primed();
    const afterTurn = playSession(state, graph, ["rest"]); // stage 13 fires the plea this turn
    const scene = afterTurn.final;
    const regions = renderRegions(sceneOf(scene, graph), scene);
    expect(regions.story.join(" ")).toContain("barricade"); // the plea prose
    const choiceText = regions.choices.join("\n");
    expect(choiceText).toContain("Take Ruth in");
    expect(choiceText).toContain("Turn Ruth away");
    // each arc choice advertises a known time cost (FR-UI-03)
    const help = renderScene(sceneOf(scene, graph), scene).find((l) => l.includes("Take Ruth in"))!;
    expect(help).toMatch(/\(2h\)/);
  });

  it("the whole plea → take-her-in beat lands in the plain-text transcript (NFR-ACC-01)", () => {
    const { state, graph } = primed();
    const session = playSession(state, graph, ["rest", `story-help:${ARC}`]);
    const text = transcript(session).join("\n");
    expect(text).toContain("Ruth sways at your barricade");
    expect(text).toContain(`you chose: story-help:${ARC}`);
    expect(text).toContain("resting under your roof"); // the helped beat, surfaced after the choice
  });

  it("the plea's choices are reachable by number key alone (NFR-ACC-02)", () => {
    const { state, graph } = primed();
    const pleaState = playSession(state, graph, ["rest"]).final;
    const scene = sceneOf(pleaState, graph);
    const helpIdx = scene.choices.findIndex((c) => c.id === `story-help:${ARC}`);
    expect(helpIdx).toBeGreaterThanOrEqual(0);
    // typing the choice's 1-based number selects exactly it — no pointer, no timing
    const cmd = parseCommand(scene, String(helpIdx + 1));
    expect(cmd).toEqual({ kind: "choice", choiceId: `story-help:${ARC}` });
  });
});
