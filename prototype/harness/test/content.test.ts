import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildRegionGraph,
  startRun,
  isDiscovered,
  isVisited,
  THE_LAST_CUSTOMER,
  type NodeDef,
  type NPCDef,
  type RegionDef,
} from "../../engine/src/index.js";

/**
 * Integration (T11): prove the *shipped* Rivermouth content forms a valid, playable node graph.
 * The engine's `buildRegionGraph` enforces referential integrity across files (symmetry,
 * connectivity, single start) that the per-file JSON Schema can't. This lives in the harness —
 * the first real client — because reading `content/` needs Node built-ins the dependency-free
 * engine package deliberately can't see.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");

function loadDefs<T>(sub: string): T[] {
  const dir = join(contentDir, sub);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

describe("shipped content — the full city node graph (T44 · FR-MAP-01/FR-SIM-02)", () => {
  const regions = loadDefs<RegionDef>("regions");
  const nodes = loadDefs<NodeDef>("nodes");

  it("builds one connected, symmetric city graph within the M4 budget, single start", () => {
    // buildRegionGraph throws on any asymmetry, dangling edge, missing/multiple start, or a
    // disconnected node — so a clean build already proves the whole city is ONE connected graph.
    const g = buildRegionGraph(regions, nodes);
    const count = Object.keys(g.nodes).length;
    // M4 city budget (PRODUCTION §6.4): the full first city (~40–60 nodes) — supersedes the 5–8 slice.
    expect(count).toBeGreaterThanOrEqual(40);
    expect(count).toBeLessThanOrEqual(65);
    expect(Object.keys(g.regions).length).toBe(6);
    expect(g.startNodeId).toBe("node.rivermouth.transit-plaza");
  });

  it("populates every region and stitches them with cross-region routes", () => {
    const g = buildRegionGraph(regions, nodes);
    // Every shipped region carries at least one node...
    for (const rid of Object.keys(g.regions)) {
      expect(Object.values(g.nodes).some((n) => n.regionId === rid)).toBe(true);
    }
    // ...and at least one route crosses a region boundary, so the city is one graph, not islands.
    const crossRegion = Object.values(g.nodes).some((n) =>
      n.adjacent.some((a) => g.nodes[a]!.regionId !== n.regionId),
    );
    expect(crossRegion).toBe(true);
  });

  it("exposes several claimable safehouse nodes across the city (FR-MAP-06)", () => {
    expect(nodes.filter((n) => n.claimable === true).length).toBeGreaterThanOrEqual(5);
  });

  it("starts a run with fog revealed only around the start node", () => {
    const { state, graph } = startRun(
      { seed: "rivermouth", createdAt: "2026-07-05T00:00:00Z" },
      regions,
      nodes,
    );
    const start = graph.startNodeId;
    expect(state.player.location).toBe(start);
    expect(isVisited(state.nodes[start]!)).toBe(true);
    // Start + its immediate neighbors discovered; the rest of the ~60-node city stays fogged.
    for (const nbr of graph.nodes[start]!.adjacent) {
      expect(isDiscovered(state.nodes[nbr]!)).toBe(true);
    }
    const hidden = Object.values(state.nodes).filter((n) => !n.discovered);
    expect(hidden.length).toBeGreaterThan(0);
  });
});


/**
 * Integration (T40): the authored arc content is a real, referentially-sound story — its subject resolves
 * to a shipped survivor, and its dials match the engine's authoritative VS constant, so the content and
 * the trigger chain cannot drift apart unnoticed (the VS content/engine bridge).
 */
describe("shipped content — the authored arc (T40 · FR-STORY-01)", () => {
  interface ArcDef {
    id: string; subject: string; trigger: { needThreshold: number };
    choices: { help: { timeCost: number; stashDraw: number; trustDelta: number }; refuse: { timeCost: number; trustDelta: number } };
    consequences: { delayHours: number; good: { repay: { item: string; quantity: number }[]; trustDelta: number }; cold: { raidUnits: number; barricadeHit: number } };
  }
  const arcs = loadDefs<ArcDef>("arcs");
  const npcs = loadDefs<NPCDef>("npcs");

  it("ships exactly the VS arc, and its subject is a real survivor", () => {
    const arc = arcs.find((a) => a.id === THE_LAST_CUSTOMER.id);
    expect(arc).toBeDefined();
    expect(npcs.some((n) => n.id === arc!.subject)).toBe(true);
    expect(arc!.subject).toBe(THE_LAST_CUSTOMER.subject);
  });

  it("the content dials mirror the engine's authoritative arc (no drift)", () => {
    const arc = arcs.find((a) => a.id === THE_LAST_CUSTOMER.id)!;
    expect(arc.trigger.needThreshold).toBe(THE_LAST_CUSTOMER.needThreshold);
    expect(arc.choices.help.stashDraw).toBe(THE_LAST_CUSTOMER.stashDraw);
    expect(arc.choices.help.trustDelta).toBe(THE_LAST_CUSTOMER.helpTrust);
    expect(arc.choices.refuse.trustDelta).toBe(THE_LAST_CUSTOMER.refuseTrust);
    expect(arc.consequences.delayHours).toBe(THE_LAST_CUSTOMER.delayHours);
    expect(arc.consequences.cold.raidUnits).toBe(THE_LAST_CUSTOMER.raidUnits);
    expect(arc.consequences.cold.barricadeHit).toBe(THE_LAST_CUSTOMER.barricadeHit);
  });
});
