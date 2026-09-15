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
  WEAPONS,
  ITEM_WEIGHTS,
  LOOT_CONTEST_DIVISOR,
  lootTableFor,
  LOOT_TABLES,
  weaponLootFor,
  DIRECTOR_THREAT_BEATS,
  type EncounterDef,
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

/**
 * Integration (T81): the weapon content set is complete, mirrors the engine's authoritative dials with no
 * drift in either direction, and is actually reachable — the check the pre-T81 build would have failed
 * outright, because `content/weapons/` was an empty directory and the roster it should have held was the
 * emptiest hole in the game (design review 2026-09, finding V).
 */
describe("shipped content — the weapon roster (T81 · FR-CBT-04 · GDD IX)", () => {
  interface WeaponJson {
    id: string; name: string; description: string; kind: string; category: string;
    dmgMin: number; dmgMax: number; noise: number; armorPierce?: number; durabilityCost?: number;
    retaliateModifier?: number; accuracy?: number; startDurability?: number | null;
    lootWeight?: number; lootKinds?: string[];
  }
  const weapons = loadDefs<WeaponJson>("weapons");

  it("ships every profile the engine knows, and knows every profile it ships (no orphan either way)", () => {
    expect(new Set(weapons.map((w) => w.id))).toEqual(new Set(Object.keys(WEAPONS)));
  });

  it("every dial mirrors the engine's authoritative table (no drift)", () => {
    for (const w of weapons) {
      const d = WEAPONS[w.id]!;
      expect(d, w.id).toBeDefined();
      expect(w.kind, w.id).toBe(d.kind);
      expect(w.category, w.id).toBe(d.category);
      expect(w.dmgMin, w.id).toBe(d.dmgMin);
      expect(w.dmgMax, w.id).toBe(d.dmgMax);
      expect(w.noise, w.id).toBe(d.noise);
      expect(w.armorPierce ?? 0, w.id).toBe(d.armorPierce);
      expect(w.durabilityCost ?? 0, w.id).toBe(d.durabilityCost);
      expect(w.retaliateModifier ?? 0, w.id).toBe(d.retaliateModifier);
      expect(w.accuracy ?? 1, w.id).toBe(d.accuracy);
      expect(w.startDurability ?? null, w.id).toBe(d.startDurability);
      expect(w.lootWeight ?? 0, w.id).toBe(d.lootWeight);
      expect(w.lootKinds ?? [], w.id).toEqual(d.lootKinds);
      expect(typeof w.description === "string" && w.description.length > 0, w.id).toBe(true);
    }
  });

  it("the GDD's three melee families are all shipped, the axe among them", () => {
    const melee = weapons.filter((w) => w.kind === "melee");
    expect(new Set(melee.map((w) => w.category))).toEqual(new Set(["improvised", "bladed", "blunt"]));
    expect(melee.length).toBeGreaterThanOrEqual(8);
    const axe = weapons.find((w) => w.id === "item.axe-fire");
    expect(axe, "the firefighter's axe the GDD names three times").toBeDefined();
    expect(axe!.lootKinds).toEqual(["police"]);
  });

  it("every weapon is reachable: placed in a real node kind, or minted at the bench", () => {
    const kinds = new Set(Object.keys(LOOT_TABLES));
    for (const w of weapons) {
      if (w.id === "weapon.bare" || w.id === "item.tool-reinforced") continue; // hands, and the crafted one
      expect((w.lootWeight ?? 0) > 0, `${w.id} has a loot weight`).toBe(true);
      expect((w.lootKinds ?? []).length > 0, `${w.id} has somewhere to be found`).toBe(true);
      for (const k of w.lootKinds ?? []) expect(kinds.has(k), `${w.id} -> unknown node kind "${k}"`).toBe(true);
      // and the placement round-trips through the table builder the engine actually draws from
      expect(weaponLootFor(w.lootKinds![0]!).map((e) => e.id)).toContain(w.id);
    }
  });

  it("every placeable weapon has a carry weight — the fifth axis it trades on", () => {
    for (const w of weapons) {
      if (w.id === "weapon.bare") continue;
      expect(ITEM_WEIGHTS[w.id], `${w.id} carry weight`).toBeGreaterThan(0);
    }
  });

  it("every node kind a weapon is authored for exists somewhere in the shipped city", () => {
    const nodes = loadDefs<NodeDef>("nodes");
    const live = new Set(nodes.map((n) => n.kind ?? "generic"));
    for (const w of weapons) for (const k of w.lootKinds ?? []) expect(live.has(k), `${w.id} -> "${k}" is in no shipped node`).toBe(true);
    // the axe's home: the fire station's own description names the tool wall it comes off
    const station = nodes.find((n) => n.id === "node.the-terraces.fire-station")!;
    expect(station.kind).toBe("police");
  });
});

describe("shipped content — the base tradeoff layer (T85 · FR-SHL-04 · GDD XI)", () => {
  interface RecipeJson {
    id: string; category: string; inputs: { item: string; qty: number }[];
    installsRoom?: string; room?: string; timeCost: number; description?: string;
    purifyFrom?: string; purifyTo?: string; purifyUnitsPerCraft?: number;
  }
  interface JobJson { id: string; room: string; produces?: { item: string; qty: number }; consumes?: { item: string; qty: number }; hoursPerCycle?: number }
  const nodes = loadDefs<NodeDef>("nodes");
  const recipes = loadDefs<RecipeJson>("recipes");
  const jobs = loadDefs<JobJson>("jobs");

  it("EVERY node authors roomSlots, so the T85 layer is live across the whole city", () => {
    const missing = nodes.filter((n) => typeof n.roomSlots !== "number").map((n) => n.id);
    expect(missing, "nodes with no authored roomSlots").toEqual([]);
    expect(nodes.length).toBe(60);
  });

  it("slots are in band, and the SAFEHOUSES are spread rather than uniform", () => {
    for (const n of nodes) {
      expect(n.roomSlots! >= 1 && n.roomSlots! <= 6, `${n.id} roomSlots ${n.roomSlots}`).toBe(true);
    }
    const safe = nodes.filter((n) => n.claimable === true);
    expect(safe.length).toBe(14);
    const distinct = new Set(safe.map((n) => n.roomSlots));
    expect(distinct.size, "every safehouse holding the same number would make the claim a non-choice").toBeGreaterThanOrEqual(4);
  });

  it("NO SAFEHOUSE HOLDS THE WHOLE TREE — a base is a set of choices, not a checklist", () => {
    const roomRecipes = recipes.filter((r) => r.installsRoom !== undefined).length;
    const roomiest = Math.max(...nodes.filter((n) => n.claimable === true).map((n) => n.roomSlots!));
    expect(roomRecipes).toBeGreaterThan(roomiest);
  });

  it("ships a water source, and it produces DIRTY water so purification is the recurring sink", () => {
    const cistern = recipes.find((r) => r.installsRoom === "room.cistern");
    expect(cistern, "room.cistern").toBeDefined();
    const water = jobs.find((j) => j.room === "room.cistern");
    expect(water, "job.water").toBeDefined();
    expect(water!.produces?.item).toBe("item.water-dirty");
    // Before T85 nothing in the game produced water of either kind.
    expect(jobs.filter((j) => j.produces?.item.startsWith("item.water")).length).toBe(1);
  });

  it("the cistern is payable out of a claim's own salvage — the defect its first cut re-created", () => {
    const cistern = recipes.find((r) => r.installsRoom === "room.cistern")!;
    // Scrap only: cloth drops in store/residential, which a settler reaches in 12.5% of runs, so a
    // cloth cost would make the room that fixes water unreachable for the same reason water is.
    expect(cistern.inputs.every((i) => i.item === "item.scrap")).toBe(true);
    expect(cistern.inputs.reduce((a, i) => a + i.qty, 0)).toBeLessThanOrEqual(4);
  });

  it("a resident's day is covered by less than one worked cistern cycle", () => {
    const water = jobs.find((j) => j.room === "room.cistern")!;
    const perDay = (24 / (water.hoursPerCycle ?? 6)) * water.produces!.qty;
    expect(perDay, "a resident drinks 1.20/day; a base that cannot cover one is not a base").toBeGreaterThan(1.2);
  });

  it("EVERY purify recipe authors a batch size — none converts the whole stack any more", () => {
    const purifies = recipes.filter((r) => r.category === "purify");
    expect(purifies.length).toBeGreaterThan(0);
    for (const r of purifies) {
      expect(typeof r.purifyUnitsPerCraft, r.id).toBe("number");
      expect(r.purifyUnitsPerCraft! >= 1, r.id).toBe(true);
    }
  });

  it("a FIELD recipe can be assembled from what one kind of place yields", () => {
    /**
     * T59 mutation survivor: removing `item.cloth` from the generic loot table changed nothing any test
     * could see. That row is not decoration — it is what makes `recipe.purify.filter` assemblable at
     * all. Its two components used to drop in DISJOINT node kinds (charcoal in generic/industrial,
     * cloth in store/residential), so a settler searching almost entirely generic held both at once on
     * 0.00 turns a run while carrying dirty water on 36% of them. This is the T85 cistern defect, and
     * the property that stops it recurring.
     *
     * Scoped to the categories craftable AWAY from the bench (`sim/economy.ts#BENCHLESS_CATEGORIES`),
     * deliberately. A bench recipe is assembled over days out of a stash and may legitimately want
     * components from opposite ends of the city; a field recipe is what you make from what is in the
     * building you are standing in.
     */
    const kindsWith = (item: string): Set<string> => {
      const out = new Set<string>();
      for (const kind of Object.keys(LOOT_TABLES)) {
        if (lootTableFor(kind, true, true).includes(item)) out.add(kind);
      }
      return out;
    };
    const field = recipes.filter((r) => r.category === "purify");
    expect(field.length, "there are field recipes to check").toBeGreaterThan(0);
    for (const r of field) {
      const sets = r.inputs.map((io) => kindsWith(io.item));
      const shared = [...sets[0]!].filter((k) => sets.every((set) => set.has(k)));
      expect(shared, `${r.id}: no single node kind yields ${r.inputs.map((i) => i.item).join(" + ")}`).not.toEqual([]);
    }
  });

  it("no district strips itself before a run can reach it", () => {
    /**
     * T59 mutation survivor: `LOOT_CONTEST_DIVISOR` could go back to 50 and nothing failed. The number
     * on its own is a magnitude and pinning it would be a test asserting a constant against itself
     * (T85's lesson). What IS assertable is the relationship between the dial and the CONTENT: with the
     * player asleep, rivals take `activity x 24 / DIVISOR` points a day, and a district that empties
     * itself inside the Shock phase (GDD XVI's first phase) was never contested — it was already over.
     * Five days is the floor; at the pre-T59 50 the two liveliest districts emptied on days 2.1 and 2.3.
     *
     * This fails if the dial drifts OR if a content pass authors a district the dial cannot support,
     * which is the pair that actually has to agree.
     */
    for (const r of loadDefs<{ id: string; baseline?: { loot?: number; survivorActivity?: number } }>("regions")) {
      const loot = r.baseline?.loot ?? 0;
      const activity = r.baseline?.survivorActivity ?? 0;
      if (activity === 0) continue; // a district nobody else is working never empties on its own
      const days = loot / ((activity * 24) / LOOT_CONTEST_DIVISOR);
      expect(days, `${r.id} empties itself on day ${days.toFixed(1)}`).toBeGreaterThanOrEqual(5);
    }
  });

  it("a recipe's description never contradicts its own fields", () => {
    /**
     * T59 audit finding: `recipe.purify.boil` shipped `purifyUnitsPerCraft: 3` with a description that
     * still read *"Converts up to 2 carried dirty-water units per batch"* — and it was embedded verbatim
     * in the built single-file client, where a player would read it. Prose is a claim about mechanics
     * (T61's lesson), so it gets a gate like any other claim. The check is narrow on purpose: it reads
     * the numbers a description actually states about its own fields, and says nothing about the rest.
     */
    for (const r of recipes) {
      const batch = /\bup to (\d+) carried\b/.exec(r.description ?? "");
      if (batch !== null) {
        expect(Number(batch[1]), `${r.id} description states a batch size`).toBe(r.purifyUnitsPerCraft);
      }
      for (const io of r.inputs) {
        const label = io.item.replace("item.", "").replace(/-/g, " ");
        const stated = new RegExp(`(\\d+)\\s*(?:x|\u00d7)\\s*${label}\\b`, "i").exec(r.description ?? "");
        if (stated !== null) expect(Number(stated[1]), `${r.id} states ${io.item}`).toBe(io.qty);
      }
    }
  });

  it("the two purify paths are a real choice: neither strictly dominates the other", () => {
    const boil = recipes.find((r) => r.id === "recipe.purify.boil")!;
    const filter = recipes.find((r) => r.id === "recipe.purify.filter")!;
    /**
     * **T59 INVERTED THIS, because the pre-T59 assertion was satisfied by a recipe that dominated.**
     * The filter used to yield MORE per craft (3 against 2) while also spending cheaper, lighter and
     * commoner inputs — `item.charcoal` and `item.cloth` weigh 1 each against `item.fuel`'s 6 — so
     * "two components against one" was not a cost at all and the boil was strictly dominated. A recipe
     * that is worse on every axis is a power tier, which GDD Part IX forbids for weapons and this
     * file's own sibling description claims not to be ("a real economy choice").
     *
     * They now trade honestly: the boil is the rare, heavy, single-component, BIG batch; the filter the
     * common, light, two-component, small one. The test asserts the trade rather than a direction, so
     * it cannot be satisfied again by one side simply being better.
     */
    const weight = (r: typeof boil): number =>
      r.inputs.reduce((n, io) => n + (ITEM_WEIGHTS[io.item] ?? 2) * Math.max(1, io.qty), 0);
    expect(boil.purifyUnitsPerCraft!).toBeGreaterThan(filter.purifyUnitsPerCraft!); // boil: the bigger batch
    expect(filter.inputs.length).toBeGreaterThan(boil.inputs.length);                // filter: more parts
    expect(weight(filter)).toBeLessThan(weight(boil));                               // filter: lighter parts
  });

  it("every room recipe's inputs can actually be found somewhere in the city", () => {
    const findable = new Set<string>();
    for (const kind of Object.keys(LOOT_TABLES)) for (const id of LOOT_TABLES[kind]!) findable.add(id);
    // economy-pool items are appended by `lootTableFor`; assert against the base tables plus the
    // economy additions the shipped run registers.
    for (const id of ["item.food-fresh", "item.water-dirty", "item.charcoal", "item.cloth", "item.blueprint.antibiotics", "item.blueprint.molotov"]) findable.add(id);
    for (const r of recipes.filter((x) => x.installsRoom !== undefined)) {
      for (const i of r.inputs) expect(findable.has(i.item), `${r.id} needs ${i.item}, which no loot table holds`).toBe(true);
    }
  });
});

describe("shipped content — the director's ambient tones (T60 · GDD Part IV)", () => {
  const encounters = loadDefs<EncounterDef>("encounters");
  const repeatables = encounters.filter((e) => e.repeatable === true);

  it("every repeatable declares a tone, so the director's lean has a full table to work on", () => {
    // The lean is gated on `tonesAuthored`, which is satisfied by ONE toned row — so a pool where most
    // rows are silently `neutral` would pass the gate and then read as a director that barely leans.
    // Either the set is authored or it is not; this asserts the former for the shipped city.
    const untoned = repeatables.filter((e) => e.tone === undefined).map((e) => e.id);
    expect(untoned).toEqual([]);
    expect(repeatables.length).toBeGreaterThanOrEqual(13);
  });

  it("all three tones are represented, and no single tone owns the pool", () => {
    const by = (tone: string): number => repeatables.filter((e) => e.tone === tone).length;
    for (const tone of ["tension", "relief", "neutral"]) expect(by(tone)).toBeGreaterThanOrEqual(3);
    // "biases, never forces" is a claim about the TABLE as much as about the arithmetic: a pool that is
    // three-quarters one tone leaves the lean nothing to choose between.
    for (const tone of ["tension", "relief", "neutral"]) expect(by(tone) / repeatables.length).toBeLessThan(0.5);
  });

  it("the pool has something kind to offer at night, when the director most often asks for relief", () => {
    // Measured on the shipped city (`measure/t60.ts --lean`, table (c)): when the director asks for
    // relief it has **0.72** relief-toned rows eligible on average — the FEWEST of any beat — against
    // **1.36** tension rows, the MOST. The cause is in the requirements, not in the lean:
    // `the-small-hours` is a tension scene gated ON stress, so it becomes eligible exactly when the
    // player is in trouble, while every relief scene was gated to dawn/morning, to a shelter, or to a
    // node kind. A lean can only choose between rows that are eligible, so no multiplier can fix that
    // — only content can. This asserts the shape of the fix; PL-M5-83 tracks the magnitude.
    // AUTHORED for the night, not merely phase-agnostic. A first cut defaulted a missing `phases` to
    // `["night"]`, so `the-stray` and `across-the-street` — both ungated, both pre-T60 — satisfied it on
    // their own: an audit deleted the scene this test exists for and the suite stayed green.
    const nightly = (e: EncounterDef): boolean => {
      const req = (e.requirements ?? {}) as { phases?: string[]; requiresShelter?: boolean };
      return req.phases?.includes("night") === true && req.requiresShelter !== true;
    };
    const kindAtNight = repeatables.filter((e) => e.tone === "relief" && nightly(e));
    expect(kindAtNight.map((e) => e.id)).toContain("encounter.common.someone-elses-light");
    // ...and the tense, stress-gated scene it answers is still there — this is a counterweight, not a
    // replacement. If that scene is ever removed, this pair should be re-read rather than half-deleted.
    expect(repeatables.some((e) => e.id === "encounter.common.the-small-hours" && e.tone === "tension")).toBe(true);
  });

  it("no authored `logHistory` event forges an engine beat the director treats as a threat", () => {
    // `logHistory` appends a history beat whose `type` is whatever the content says, and the schema
    // constrains it to `minLength: 1`. So a choice effect of `{"kind":"logHistory","event":
    // "combat.cleared"}` counterfeits a threat, pins `turnsSinceThreat` at 0 and suppresses the
    // escalate beat for as long as that scene keeps firing — an audit demonstrated it end to end. The
    // engine cannot police this without breaking every authored beat type, so the guard lives here,
    // where the shipped content is the thing under test.
    const authored = new Set<string>();
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) { for (const y of x) walk(y); return; }
      if (x === null || typeof x !== "object") return;
      const o = x as { kind?: unknown; event?: unknown };
      if (o.kind === "logHistory" && typeof o.event === "string") authored.add(o.event);
      for (const v of Object.values(x as Record<string, unknown>)) walk(v);
    };
    for (const sub of ["encounters", "radio", "jobs", "projects", "stands", "endings", "npcs", "arcs"]) {
      try { walk(loadDefs<unknown>(sub)); } catch { /* a content type this build does not ship */ }
    }
    expect(authored.size).toBeGreaterThan(0); // the scan found something, so a green result means something
    const forged = [...authored].filter((e) => DIRECTOR_THREAT_BEATS.has(e));
    expect(forged).toEqual([]);
  });
});
