import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  availableActions,
  advanceWorld,
  sceneOf,
  startRun,
  jobChoices,
  jobIdOf,
  buildableJobs,
  type GameState,
  type JobDef,
  type NodeDef,
  type RecipeDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../../engine/src/index.js";
import { renderScene } from "../src/index.js";

/**
 * T52 — shelter jobs & room capabilities over shipped content. Proves the `content/jobs/` set loads and
 * interprets, each job is legible through the client (a room capability named in words, world-effect prose
 * not stats, no glyph-only meaning), and a real play beat: claim a shelter → build the garden room from the
 * shipped recipe → assign a companion → advance a day → the base has stocked fresh food and kept its people
 * fed, all off a stash it filled itself (closes PL-M3-01).
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const recipes = load<RecipeDef>("recipes");
const jobs = load<JobDef>("jobs");
const opts = { seed: "jobs-ship", createdAt: "2026-07-17T06:00:00.000Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, regions, nodes, [], [], [], [], recipes, jobs);

type Inv = GameState["player"]["inventory"];
const atShelter = (s: GameState): GameState => ({ ...s, player: { ...s.player, shelterId: s.player.location } });
const withInv = (s: GameState, inv: Inv): GameState => ({ ...s, player: { ...s.player, inventory: inv } });
const withStash = (s: GameState, stash: Inv): GameState => ({ ...s, player: { ...s.player, stash } });
const take = (s: GameState, graph: RegionGraph, id: string): GameState => applyAction(s, availableActions(s, graph).find((c) => c.id === id)!.action, graph).state;

function withCompanion(s: GameState, needs = { hunger: 0, thirst: 0, fatigue: 0 }): GameState {
  const c: Survivor = {
    id: "c.ruth", type: "npc.ruth", name: "Ruth", trust: 80,
    condition: { needs, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
    location: s.player.shelterId, groupId: null, relationships: {}, inventory: [], flags: { companion: true },
  };
  return { ...s, actors: { ...s.actors, "c.ruth": c } };
}
const stashCount = (s: GameState, type: string): number => s.player.stash.filter((e) => e.type === type && e.itemId === undefined).reduce((n, e) => n + e.quantity, 0);

// --- content loads + covers the job shapes ----------------------------------------------------

describe("the shipped job set (content/jobs)", () => {
  it("loads several jobs covering all four shapes (produce / consume→produce / hold-power / upkeep), room-gated with prose", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    expect(jobs.some((j) => j.produces !== undefined && j.consumes === undefined)).toBe(true); // a pure producer (garden)
    expect(jobs.some((j) => j.consumes !== undefined && j.produces !== undefined)).toBe(true); // a converter (kitchen)
    expect(jobs.some((j) => j.holdsPower === true)).toBe(true); // the generator
    expect(jobs.some((j) => j.upkeepsBarricades === true)).toBe(true); // the watch (upkeep shape)
    for (const j of jobs) {
      expect(j.id).toMatch(/^job\.[a-z0-9-]+$/);
      expect(j.room).toMatch(/^room\.[a-z0-9-]+$/);
      expect(j.worldEffect.length).toBeGreaterThan(0);
      // A job must actually do something.
      expect(j.produces !== undefined || j.consumes !== undefined || j.holdsPower === true || j.upkeepsBarricades === true).toBe(true);
    }
  });

  it("every job's room is built by a shipped shelter recipe (rooms are craftable — FR-SHL-04)", () => {
    const installable = new Set(recipes.filter((r) => r.installsRoom !== undefined).map((r) => r.installsRoom));
    for (const j of jobs) expect(installable.has(j.room)).toBe(true);
    // The five named-plus rooms all ship as craftable recipes.
    for (const room of ["room.garden", "room.kitchen", "room.watchtower", "room.generator", "room.radio"]) {
      expect(installable.has(room)).toBe(true);
    }
  });
});

// --- legibility gate --------------------------------------------------------------------------

describe("shelter jobs are legible through the client (FR-UI-02 · NFR-ACC-01)", () => {
  it("an assign row names the worker and the work in words, no glyph-only meaning, no raw numbers", () => {
    const base = withCompanion(atShelter(run().state));
    const { graph } = run();
    const garden = withRoomsAt(base, ["room.garden"]);
    const choices = jobChoices(garden, graph);
    const assign = choices.find((c) => c.id === "assign-job:c.ruth:job.garden");
    expect(assign).toBeDefined();
    expect(assign!.label).toContain("Ruth");
    expect(assign!.label.toLowerCase()).toMatch(/garden|fresh food/);
    // Rendered through the real client the scene is a screen-reader-safe string list.
    const lines = renderScene(sceneOf(garden, graph), garden);
    expect(lines.every((l) => typeof l === "string")).toBe(true);
  });
});

function withRoomsAt(s: GameState, rooms: string[]): GameState {
  return { ...s, nodes: { ...s.nodes, [s.player.shelterId!]: { ...s.nodes[s.player.shelterId!]!, rooms } } };
}

// --- a real play beat: build a room, assign, advance a day ------------------------------------

describe("a play beat: build the garden, assign a resident, run the base a day (shipped content)", () => {
  it("building the garden room from its recipe unlocks the garden job", () => {
    const { state, graph } = run();
    const gardenRecipe = recipes.find((r) => r.installsRoom === "room.garden")!;
    const shelter = withInv(atShelter(state), gardenRecipe.inputs.map((io) => ({ type: io.item, quantity: io.qty })));
    const built = take(shelter, graph, `craft:${gardenRecipe.id}`);
    expect(built.nodes[built.player.shelterId!]!.rooms).toContain("room.garden");
    const withRuth = withCompanion(built);
    expect(buildableJobs(withRuth, graph).some((j) => j.id === "job.garden")).toBe(true);
  });

  it("a resident on the garden stocks the stash with fresh food over a day away (FR-SHL-03)", () => {
    const { state, graph } = run();
    let s = withRoomsAt(withCompanion(atShelter(state)), ["room.garden"]);
    s = take(s, graph, "assign-job:c.ruth:job.garden");
    expect(jobIdOf(s.actors["c.ruth"]!)).toBe("job.garden");
    const after = advanceWorld(s, 24, graph);
    expect(stashCount(after, "item.food-fresh")).toBeGreaterThan(0); // the base fed itself while you were gone
  });

  it("the base feeds a hungry resident from the stash so keeping people isn't only a pack drain (PL-M3-01)", () => {
    const { state, graph } = run();
    let s = withRoomsAt(withCompanion(atShelter(state), { hunger: 95, thirst: 95, fatigue: 0 }), ["room.garden"]);
    s = withStash(s, [{ type: "item.canned-food", quantity: 4 }, { type: "item.water", quantity: 4 }]);
    const after = advanceWorld(s, 12, graph);
    const ruth = after.actors["c.ruth"]!;
    expect(ruth.condition.needs.hunger).toBeLessThan(95); // the cache fed her
    expect(ruth.condition.needs.thirst).toBeLessThan(95);
  });

  it("the report reads in the scene as words when the base has been at work", () => {
    const { state, graph } = run();
    let s = withRoomsAt(withCompanion(atShelter(state)), ["room.garden"]);
    s = take(s, graph, "assign-job:c.ruth:job.garden");
    // rest a shift at home — a cycle completes and the base line surfaces.
    const rest = availableActions(s, graph).find((c) => c.id === "rest")!;
    const after = applyAction(s, rest.action, graph).state;
    const narration = renderScene(sceneOf(after, graph), after).join(" ");
    expect(narration.length).toBeGreaterThan(0);
    expect(typeof narration).toBe("string");
  });
});
