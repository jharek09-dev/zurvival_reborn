import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  activeEncounter,
  humanityOf,
  ACTIVE_ENCOUNTER_QUEST,
  ENCOUNTER_CATEGORIES,
  ENCOUNTER_EVENT_KIND,
  ITEM_WEIGHTS,
  type EncounterDef,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";

/**
 * Integration (T47 · FR-ENC-03..08): the shipped encounter pool is real, referentially sound, covers
 * every category, and plays through the actual engine — the evolution triple, the seedWalkers handoff to
 * a T15 fight, a moral Humanity swing, and a timed chain. Lives in the harness because reading `content/`
 * needs Node built-ins the dependency-free engine can't see. Registered opt-in, so default runs are inert.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const loadDefs = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = loadDefs<RegionDef>("regions");
const nodes = loadDefs<NodeDef>("nodes");
const npcs = loadDefs<NPCDef & { homeNode?: string }>("npcs");
const encounters = loadDefs<EncounterDef>("encounters");
const wounds = loadDefs<{ id: string }>("wounds");
const zombies = loadDefs<{ id: string }>("zombies");

const opts = { seed: "enc-harness", createdAt: "2026-07-16T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, regions, nodes, npcs, [], encounters);
// Teleport to a node for a probe. With the T48 ambient pool an intermediate tick can engage a transient
// ambient at the node you were on; leaving that node ends it, so drop any active-encounter slot on move.
const at = (s: GameState, node: string): GameState => ({ ...s, player: { ...s.player, location: node, quests: s.player.quests.filter((q) => q.id !== ACTIVE_ENCOUNTER_QUEST) } });
const withFlags = (s: GameState, ...flags: string[]): GameState => ({ ...s, player: { ...s.player, flags: { ...s.player.flags, ...Object.fromEntries(flags.map((f) => [f, true])) } } });
const withSearch = (s: GameState, node: string, pct: number): GameState => ({ ...s, nodes: { ...s.nodes, [node]: { ...s.nodes[node]!, searchPct: pct } } });
const tick = (s: GameState, g: RegionGraph): GameState => applyAction(s, { type: "wait" }, g).state;
const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id);
const take = (s: GameState, g: RegionGraph, id: string): GameState => {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (!c) throw new Error(`choice "${id}" not offered; got: ${ids(availableActions(s, g)).join(",")}`);
  return applyAction(s, c.action, g).state;
};

// --- shape / coverage / drift -----------------------------------------------------------------

describe("shipped encounters — coverage & referential soundness (T47)", () => {
  it("ships a proof set (≥12) spanning all seven FR-ENC-05 categories", () => {
    expect(encounters.length).toBeGreaterThanOrEqual(12);
    const cats = new Set(encounters.map((e) => e.category));
    for (const c of ENCOUNTER_CATEGORIES) expect(cats.has(c), `category ${c} missing`).toBe(true);
  });

  it("proves each mechanic is present: a chain, a multi-stage flow, a moral swing, a false beat, and an evolution triple", () => {
    const effectKinds = encounters.flatMap((e) => e.stages.flatMap((s) => s.choices.flatMap((c) => c.effects.map((f) => f.kind))));
    expect(effectKinds).toContain("setFlag"); // chains
    expect(effectKinds).toContain("scheduleFollowup"); // timed chain
    expect(effectKinds).toContain("advanceStage"); // multi-stage
    expect(effectKinds).toContain("adjustHumanity"); // moral
    expect(effectKinds).toContain("seedWalkers"); // combat handoff
    // an evolution triple: three encounters sharing one node id, gated on searchPct/flags
    const gc = encounters.filter((e) => (e.requirements?.nodeIds ?? []).includes("node.the-terraces.garden-center"));
    expect(gc.length).toBeGreaterThanOrEqual(3);
  });

  it("every referenced node / npc / region / wound / zombie / item id is real (no dangling content)", () => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const npcIds = new Set(npcs.map((n) => n.id));
    const regionIds = new Set(regions.map((r) => r.id));
    const woundIds = new Set(wounds.map((w) => w.id));
    const zombieIds = new Set(zombies.map((z) => z.id));
    const itemIds = new Set(Object.keys(ITEM_WEIGHTS));
    for (const e of encounters) {
      const req = e.requirements ?? {};
      for (const n of req.nodeIds ?? []) expect(nodeIds.has(n), `${e.id} → node ${n}`).toBe(true);
      for (const r of req.regionIds ?? []) expect(regionIds.has(r), `${e.id} → region ${r}`).toBe(true);
      if (req.npcHere) expect(npcIds.has(req.npcHere), `${e.id} → npc ${req.npcHere}`).toBe(true);
      if (req.metNpc) expect(npcIds.has(req.metNpc)).toBe(true);
      if (req.carriesItem) expect(itemIds.has(req.carriesItem), `${e.id} → item ${req.carriesItem}`).toBe(true);
      const stageIds = new Set(e.stages.map((s) => s.id));
      for (const st of e.stages) {
        for (const ch of st.choices) {
          for (const cn of ch.requirements?.carriesItem ? [ch.requirements.carriesItem] : []) expect(itemIds.has(cn)).toBe(true);
          for (const f of ch.effects) {
            if (f.kind === "adjustTrust") expect(npcIds.has(f.npc), `${e.id} → trust npc ${f.npc}`).toBe(true);
            if (f.kind === "inflictWound") expect(woundIds.has(f.wound), `${e.id} → wound ${f.wound}`).toBe(true);
            if (f.kind === "seedWalkers") for (const t of f.types ?? []) expect(zombieIds.has(t), `${e.id} → zombie ${t}`).toBe(true);
            if (f.kind === "grantItem" || f.kind === "takeItem") expect(itemIds.has(f.item), `${e.id} → item ${f.item}`).toBe(true);
            if (f.kind === "seedWalkers" && f.node) expect(nodeIds.has(f.node)).toBe(true);
            if (f.kind === "advanceStage") expect(stageIds.has(f.to), `${e.id} → advanceStage to unknown stage ${f.to}`).toBe(true);
          }
        }
      }
    }
  });

  it("the scavenger's subject is a real survivor homed where the encounter fires", () => {
    const scav = encounters.find((e) => e.id === "encounter.ironworks.the-scavenger")!;
    const subj = scav.requirements!.npcHere!;
    const npc = npcs.find((n) => n.id === subj)!;
    expect(npc).toBeDefined();
    expect(scav.requirements!.nodeIds).toContain(npc.homeNode);
  });
});

// --- opt-in inertness at the harness level ----------------------------------------------------

describe("opt-in: a run without the pool never engages an encounter", () => {
  it("startRun with no encounters leaves the system inert over shipped content", () => {
    const { state, graph } = startRun(opts, regions, nodes, npcs);
    let s = state;
    for (let i = 0; i < 5; i++) s = tick(s, graph);
    expect(activeEncounter(s)).toBeNull();
  });
});

// --- golden play over shipped content ---------------------------------------------------------

describe("the evolution triple plays through the real engine (FR-ENC-08)", () => {
  const GC = "node.the-terraces.garden-center";

  it("BEFORE fires on the fresh node; DURING seeds a real T15 fight; AFTER reads the aftermath", () => {
    const { state, graph } = run();
    // BEFORE — a fresh, entered-flag-free garden center
    const before = tick(at(state, GC), graph);
    expect(activeEncounter(before)!.encounter).toBe("encounter.the-terraces.garden-center-before");
    expect(sceneOf(before, graph).narration).toContain("greenhouse");
    const entered = take(before, graph, "event:encounter.the-terraces.garden-center-before:slip");
    expect(entered.player.flags["enc.gc.entered"]).toBe(true);

    // DURING — entered + searched; resolving it seeds walkers → the avoidable-fight prompt (T15)
    const during = tick(withSearch(entered, GC, 45), graph);
    expect(activeEncounter(during)!.encounter).toBe("encounter.the-terraces.garden-center-during");
    const drew = take(during, graph, "event:encounter.the-terraces.garden-center-during:grab");
    expect(drew.nodes[GC]!.walkers).toBeGreaterThan(0);
    expect(drew.player.flags["enc.gc.pack"]).toBe(true);
    expect(ids(availableActions(drew, graph)).some((id) => id.startsWith("fight") || id.startsWith("slip") || id.startsWith("fire"))).toBe(true);

    // AFTER — pack drawn, searched out, the dead cleared: the picked-over shell
    const cleared: GameState = { ...withSearch(drew, GC, 90), nodes: { ...drew.nodes, [GC]: { ...drew.nodes[GC]!, walkers: 0, searchPct: 90 } } };
    const after = tick(cleared, graph);
    expect(activeEncounter(after)!.encounter).toBe("encounter.the-terraces.garden-center-after");
    const done = take(after, graph, "event:encounter.the-terraces.garden-center-after:leave");
    expect(done.nodes[GC]!.discoveries).toContain("disc.gc.drawing");
    expect(done.player.humanity).toBeGreaterThan(50); // leaving the drawing preserves Humanity
  });
});

describe("a moral encounter swings Humanity (FR-ENC-06)", () => {
  it("abandoning the trapped stranger erodes it; the felt band surfaces at the low end", () => {
    const { state, graph } = run();
    const engaged = tick(at(state, "node.rivermouth.marina"), graph);
    expect(activeEncounter(engaged)!.encounter).toBe("encounter.rivermouth.marina-cabin");
    const left = take(engaged, graph, "event:encounter.rivermouth.marina-cabin:leave");
    expect(left.player.humanity).toBe(50 - 20);
    expect(humanityOf(left)).toBe(30);
  });
});

describe("a timed chain: a flag set now enables a follow-up later (FR-ENC-03)", () => {
  it("reading the wall schedules the payoff, which becomes eligible only after the delay", () => {
    const { state, graph } = run();
    // CHAIN START — the water tower
    const wall = tick(at(state, "node.the-terraces.water-tower"), graph);
    expect(activeEncounter(wall)!.encounter).toBe("encounter.the-terraces.a-name-on-the-wall");
    const read = take(wall, graph, "event:encounter.the-terraces.a-name-on-the-wall:read");
    expect(read.player.flags["chain.terraces.name-seen"]).toBe(true);
    expect(read.queue.some((e) => e.kind === ENCOUNTER_EVENT_KIND)).toBe(true);

    // the payoff is NOT yet eligible (time hasn't passed)
    const early = tick(at(read, "node.rivermouth.transit-plaza"), graph);
    expect(activeEncounter(early)?.encounter).not.toBe("encounter.rivermouth.the-one-who-scratched");

    // jump the clock past the follow-up's due time → stage 12 sets chain.terraces.time-passed
    const due = read.queue.find((e) => e.kind === ENCOUNTER_EVENT_KIND)!;
    const later = tick({ ...read, meta: { ...read.meta, day: due.dueDay + 1 } }, graph);
    expect(later.player.flags["chain.terraces.time-passed"]).toBe(true);

    // now, back at the plaza, the payoff engages — and burying the dead preserves Humanity
    const payoff = tick(at(later, "node.rivermouth.transit-plaza"), graph);
    expect(activeEncounter(payoff)!.encounter).toBe("encounter.rivermouth.the-one-who-scratched");
    const buried = take(payoff, graph, "event:encounter.rivermouth.the-one-who-scratched:bury");
    expect(buried.player.humanity).toBeGreaterThan(50);
  });
});
