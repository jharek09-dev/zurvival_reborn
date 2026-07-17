import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildRegionGraph,
  startRun,
  isDiscovered,
  isVisited,
  socialActive,
  THE_LAST_CUSTOMER,
  ZOMBIE_BEHAVIOUR,
  ENEMIES,
  ENEMY_FOR_ZOMBIE,
  type FactionDef,
  type NodeDef,
  type NpcLead,
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

/**
 * Integration (T46): the full zombie roster is complete, its behaviour/combat dials mirror the engine's
 * authoritative tables (no content/engine drift), every type ships a non-audio signature (FR-AUD-06), and
 * the city actually seeds the new types as live threats (walkers > 0), closing PL-M2-02 / PL-M4-02.
 */
describe("shipped content — the full zombie roster (T46 · FR-CBT-06/07 · FR-AUD-06)", () => {
  interface ZombieDef { id: string; name: string; description: string; signature?: string; rousesNeighbours?: boolean; nightHunter?: boolean; swift?: boolean; lowProfile?: boolean; }
  interface EnemyDef { id: string; name: string; description: string; maxHp: number; armor?: number; burstInfection?: number; graspWound?: string; initiative?: boolean; }
  const zombies = loadDefs<ZombieDef>("zombies");
  const enemies = loadDefs<EnemyDef>("enemies");
  const nodes = loadDefs<NodeDef>("nodes");

  it("ships the complete 7-type roster (walker + screamer + stalker + the T46 four)", () => {
    const ids = new Set(zombies.map((z) => z.id));
    for (const id of ["zombie.walker", "zombie.screamer", "zombie.stalker", "zombie.fresh", "zombie.crawler", "zombie.bloated", "zombie.riot"]) {
      expect(ids.has(id)).toBe(true);
    }
    // engine behaviour table and shipped content agree 1:1 — no orphan either way.
    expect(new Set(Object.keys(ZOMBIE_BEHAVIOUR))).toEqual(ids);
  });

  it("every zombie type ships a non-audio signature so the game reads with sound off (FR-AUD-06)", () => {
    for (const z of zombies) expect(typeof z.signature === "string" && z.signature.length > 0).toBe(true);
  });

  it("zombie behaviour tags mirror the engine (no drift)", () => {
    for (const z of zombies) {
      const b = ZOMBIE_BEHAVIOUR[z.id]!;
      expect(b).toBeDefined();
      expect(!!z.rousesNeighbours).toBe(b.rousesNeighbours);
      expect(!!z.nightHunter).toBe(b.nightHunter);
      expect(!!z.swift).toBe(b.swift);
      expect(!!z.lowProfile).toBe(b.lowProfile);
    }
  });

  it("enemy combat dials mirror the engine's authoritative table (no drift)", () => {
    for (const e of enemies) {
      const d = ENEMIES[e.id]!;
      expect(d).toBeDefined();
      expect(e.maxHp).toBe(d.maxHp);
      expect(e.armor ?? 0).toBe(d.armor);
      expect(e.burstInfection ?? 0).toBe(d.burstInfection);
      expect(e.graspWound ?? null).toBe(d.graspWound);
      expect(!!e.initiative).toBe(d.initiative);
    }
  });

  it("each combat-distinct type is seeded somewhere in the city as a live threat (walkers > 0)", () => {
    for (const z of Object.keys(ENEMY_FOR_ZOMBIE)) {
      const live = nodes.some((n) => (n.zombieTypes ?? []).includes(z) && (n.walkers ?? 0) > 0);
      expect(live, `${z} has no live node`).toBe(true);
    }
  });
});

/**
 * Integration (T45): the survivor pool has grown to a reviewable beta subset — a spread of named,
 * fully-fleshed characters across the whole city, including the GDD-named Dana.
 */
describe("shipped content — the survivor pool (T45 · FR-NPC-01)", () => {
  const npcs = loadDefs<NPCDef & { background?: string; personality?: string; secret?: string }>("npcs");
  const regions = loadDefs<RegionDef>("regions");

  it("ships a beta-subset pool (≥15) toward the ~60–100 v1 target", () => {
    expect(npcs.length).toBeGreaterThanOrEqual(15);
  });

  it("every survivor is a real character — background, personality, and a secret", () => {
    for (const n of npcs) {
      expect(typeof n.background === "string" && n.background!.length > 0, `${n.id} background`).toBe(true);
      expect(typeof n.personality === "string" && n.personality!.length > 0, `${n.id} personality`).toBe(true);
      expect(typeof n.secret === "string" && n.secret!.length > 0, `${n.id} secret`).toBe(true);
    }
  });

  it("the pool is spread across every region of the city", () => {
    const homed = new Set(npcs.map((n) => n.homeNode).filter((h): h is string => typeof h === "string").map((h) => h.split(".")[1]));
    for (const r of regions) expect(homed.has(r.id.split(".")[1]!), `${r.id} has no survivor`).toBe(true);
  });

  it("ships the GDD-named Dana, and a variety of dispositions", () => {
    expect(npcs.some((n) => n.id === "npc.dana")).toBe(true);
    const dispositions = new Set(npcs.map((n) => n.disposition));
    expect(dispositions.size).toBeGreaterThanOrEqual(3);
  });
});

describe("shipped content — factions & inter-NPC relationships (T53 · FR-NPC-02/05/06/07)", () => {
  const regions = loadDefs<RegionDef>("regions");
  const nodes = loadDefs<NodeDef>("nodes");
  const npcs = loadDefs<NPCDef & { knowledge?: NpcLead[] }>("npcs");
  const factions = loadDefs<FactionDef>("factions");
  const nodeIds = new Set(nodes.map((n) => n.id));
  const npcIds = new Set(npcs.map((n) => n.id));

  it("ships at least three factions over the real cast, each with a valid home node", () => {
    expect(factions.length).toBeGreaterThanOrEqual(3);
    for (const f of factions) {
      expect(f.members.length, `${f.id} has members`).toBeGreaterThanOrEqual(1);
      for (const m of f.members) expect(npcIds.has(m), `${f.id} member ${m} is a real survivor`).toBe(true);
      if (f.homeNode !== undefined) expect(nodeIds.has(f.homeNode), `${f.id} home ${f.homeNode} is a real node`).toBe(true);
      for (const r of f.rivalries ?? []) {
        expect(npcIds.has(r.a), `rivalry ${r.a} is a real survivor`).toBe(true);
        expect(npcIds.has(r.b), `rivalry ${r.b} is a real survivor`).toBe(true);
      }
    }
  });

  it("every survivor belongs to at most one faction (membership is unambiguous)", () => {
    const seen = new Map<string, string>();
    for (const f of factions) {
      for (const m of f.members) {
        expect(seen.has(m), `${m} is in both ${seen.get(m)} and ${f.id}`).toBe(false);
        seen.set(m, f.id);
      }
    }
  });

  it("every authored knowledge lead points at a real node / discovery (FR-NPC-06)", () => {
    const withLeads = npcs.filter((n) => (n.knowledge?.length ?? 0) > 0);
    expect(withLeads.length, "some survivors carry knowledge leads").toBeGreaterThanOrEqual(3);
    for (const n of withLeads) {
      for (const lead of n.knowledge!) {
        expect(typeof lead.hint === "string" && lead.hint.length > 0, `${n.id} lead ${lead.id} has a hint`).toBe(true);
        if (lead.reveals !== undefined) expect(nodeIds.has(lead.reveals), `${n.id} lead reveals a real node`).toBe(true);
        if (lead.marks !== undefined) expect(nodeIds.has(lead.marks.node), `${n.id} lead marks a real node`).toBe(true);
      }
    }
  });

  it("a full-content run WITH the faction pool turns the social system on and seeds groups", () => {
    const { state, graph } = startRun(
      { seed: "content-social", createdAt: "2026-07-17T00:00:00Z" },
      regions,
      nodes,
      npcs,
      [],
      [],
      [],
      [],
      [],
      factions,
    );
    expect(socialActive(graph)).toBe(true);
    expect(Object.keys(state.groups).length).toBe(factions.length);
    for (const f of factions) expect(state.groups[f.id]).toBeDefined();
  });

  it("the same content WITHOUT a faction pool is inert (byte-identity — no groups, social off)", () => {
    const { state, graph } = startRun({ seed: "content-social", createdAt: "2026-07-17T00:00:00Z" }, regions, nodes, npcs);
    expect(socialActive(graph)).toBe(false);
    expect(state.groups).toEqual({});
    expect(state.player.reputation).toEqual({});
  });
});
