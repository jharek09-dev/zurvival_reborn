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

describe("shipped content — region.rivermouth node graph (T11)", () => {
  const regions = loadDefs<RegionDef>("regions");
  const nodes = loadDefs<NodeDef>("nodes");

  it("builds a connected, symmetric graph of 5–8 nodes with one start", () => {
    const g = buildRegionGraph(regions, nodes);
    const count = Object.keys(g.nodes).length;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(8);
    expect(g.startNodeId).toBe("node.rivermouth.transit-plaza");
  });

  it("exposes a claimable safehouse node (FR-MAP-06)", () => {
    expect(nodes.some((n) => n.claimable === true)).toBe(true);
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
    // Start + its neighbors discovered; at least one node still hidden on a 6-node ring.
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
