import { describe, expect, it } from "vitest";
import {
  startRun,
  sceneOf,
  availableActions,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
} from "../../engine/src/index.js";
import { renderRegions, renderScene, playSession, transcript } from "../src/index.js";

/**
 * T35 surfacing (FR-UI-01/02 · NFR-ACC-01): the story-first client shows a survivor present at the node —
 * named in the story region, with talk/share/threaten offered as numbered choices — all in plain words, so
 * the accessibility transcript carries the whole encounter with no colour or pointer.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "Clinic", description: "a clinic", adjacent: ["node.k"], start: true },
  { id: "node.k", regionId: "region.z", name: "Store", description: "a store", adjacent: ["node.s"] },
];
const NPCS: NPCDef[] = [
  { id: "npc.ruth", name: "Ruth", description: "a shopkeeper", disposition: "desperate", homeNode: "node.s" },
];
const opts = { seed: "harness-enc", createdAt: "2026-07-06T00:00:00Z" };
const run = (): { state: GameState; graph: ReturnType<typeof startRun>["graph"] } => startRun(opts, REGIONS, NODES, NPCS);

describe("a survivor encounter surfaces in the story-first screen (T35)", () => {
  it("names the survivor in the story region and offers the people verbs as choices", () => {
    const { state, graph } = run();
    const regions = renderRegions(sceneOf(state, graph), state);
    expect(regions.story.join(" ")).toContain("Ruth");
    const choiceText = regions.choices.join("\n");
    expect(choiceText).toContain("Speak with Ruth");
    expect(choiceText).toContain("Share food with Ruth");
    expect(choiceText).toContain("Threaten Ruth");
  });

  it("each people choice advertises a time cost (FR-UI-03 — known cost, hidden outcome)", () => {
    const { state, graph } = run();
    const lines = renderScene(sceneOf(state, graph), state);
    const talk = lines.find((l) => l.includes("Speak with Ruth"))!;
    expect(talk).toMatch(/\(1h\)/);
  });

  it("a talk turn is carried into the plain-text transcript (NFR-ACC-01)", () => {
    const { state, graph } = run();
    const talk = availableActions(state, graph).find((c) => c.id === "talk:npc.ruth")!;
    const session = playSession(state, graph, [talk.id]);
    const text = transcript(session).join("\n");
    expect(text).toContain("you chose: talk:npc.ruth");
    // After talking, the one-shot talk option is gone but Ruth is still named and interactable.
    expect(text).toContain("Ruth");
  });
});
