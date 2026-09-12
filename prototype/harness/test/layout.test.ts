import { describe, expect, it } from "vitest";
import { startRun, sceneOf, type NodeDef, type RegionDef } from "../../engine/src/index.js";
import { layoutStory, renderScene, renderRegions } from "../src/index.js";

/**
 * T58 UI polish — narration reflow, shared by the terminal render and the browser client via `layoutStory`.
 * Presentation only: `scene.narration` and the `renderRegions` seam are left byte-identical (so determinism,
 * saves, and the T20 accessibility ordering are untouched); only `renderScene`'s story lines are reflowed —
 * the where/when locator lifted to lead, the body broken into short paragraphs.
 */

describe("layoutStory reflows one narration blob for reading (T58)", () => {
  it("lifts the (Day … at Place) locator out of the body into a dateline", () => {
    const n = "A short first beat. Another sentence to pad this out. (Day 2, dawn 05:00 — at Corner Store.)";
    const { dateline, paragraphs } = layoutStory(n);
    expect(dateline).toBe("(Day 2, dawn 05:00 — at Corner Store.)");
    expect(paragraphs.join(" ")).not.toContain("(Day");
    expect(paragraphs.join(" ")).toContain("A short first beat.");
  });

  it("breaks a multi-sentence body into more than one paragraph", () => {
    const n =
      "First short beat here. Second short beat here. A much longer descriptive sentence that clearly runs past the ninety-character threshold and therefore stands on its own line. Another short one.";
    expect(layoutStory(n).paragraphs.length).toBeGreaterThan(1);
  });

  it("returns nothing for empty / whitespace narration", () => {
    expect(layoutStory("")).toEqual({ dateline: null, paragraphs: [] });
    expect(layoutStory("   ")).toEqual({ dateline: null, paragraphs: [] });
  });
});

describe("renderScene leads the story with the dateline, then paragraphs (T58)", () => {
  const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
  const NODES: NodeDef[] = [
    {
      id: "node.x.a",
      regionId: "region.x",
      name: "Corner Store",
      description: "a looted store with its shutter half-down and the back room untouched",
      adjacent: [],
      start: true,
    },
  ];

  it("a standalone dateline line appears; the raw region seam is unchanged", () => {
    const { state, graph } = startRun({ seed: "layout", createdAt: "2026-07-18T00:00:00Z" }, REGIONS, NODES);
    const scene = sceneOf(state, graph);
    const lines = renderScene(scene, state, graph);
    // a line that is *exactly* the locator now exists (lifted to lead the story)
    expect(lines.some((l) => /^\(Day \d+.*at .*\)$/.test(l))).toBe(true);
    // renderRegions is left raw — its single story string still ends with the locator (AT seam stable)
    expect(renderRegions(scene, state, graph).story[0]).toMatch(/\(Day \d+.*\)$/);
  });
});
