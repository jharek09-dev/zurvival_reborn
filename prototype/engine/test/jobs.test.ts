import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  advanceWorld,
  loadGame,
  saveGame,
  sceneOf,
  startRun,
  jobsActive,
  jobChoices,
  jobIdOf,
  buildableJobs,
  isJobAction,
  resolveJobAction,
  tickShelterOps,
  offscreenShelterUpkeep,
  jobLine,
  GEN_POWER_PER_CYCLE,
  RESIDENT_FEED_AT,
  KITCHEN_ROOM,
  WATCHTOWER_ROOM,
  type GameState,
  type JobDef,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../src/index.js";

/**
 * T52 — shelter jobs & room capabilities. Jobs (content) interpreted generically: assign a companion at
 * the base to a room's job that produces/consumes the shared stash on your turns and off-screen
 * (FR-SHL-03); craftable rooms unlock capability (FR-SHL-04); the base feeds its residents (PL-M3-01);
 * off-screen barricade decay + the fridge/generator (PL-M3-05 · PL-M4-29). Deterministic, save-lossless,
 * and — the load-bearing guarantee — INERT without a job pool, so every prior run is byte-identical.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "Shelter", description: "home", adjacent: ["node.a"], start: true, kind: "residential" },
  { id: "node.a", regionId: "region.z", name: "Away", description: "away", adjacent: ["node.s"], kind: "store" },
];

const JOBS: JobDef[] = [
  { id: "job.garden", label: "Tend the garden", worldEffect: "Rooftop beds give up fresh food.", room: "room.garden", produces: { item: "item.food-fresh", qty: 1 }, hoursPerCycle: 6 },
  { id: "job.kitchen", label: "Cook and preserve", worldEffect: "Fresh food is put up in cans.", room: "room.kitchen", consumes: { item: "item.food-fresh", qty: 1 }, produces: { item: "item.canned-food", qty: 1 }, hoursPerCycle: 4 },
  { id: "job.salvage", label: "Salvage the ruins", worldEffect: "Scrap is stripped from the wrecks.", room: "room.workshop", produces: { item: "item.scrap", qty: 1 }, hoursPerCycle: 6 },
  { id: "job.generator", label: "Run the generator", worldEffect: "The generator holds the lights.", room: "room.generator", consumes: { item: "item.fuel", qty: 1 }, holdsPower: true, hoursPerCycle: 6 },
  { id: "job.watch", label: "Stand watch", worldEffect: "A lookout keeps the wall up.", room: "room.watchtower", upkeepsBarricades: true, hoursPerCycle: 6 },
];

const opts = { seed: "jobs-seed", createdAt: "2026-07-17T00:00:00Z" };
const base = (jobs: JobDef[] = JOBS): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, [], [], [], [], [], jobs);

type Stash = GameState["player"]["stash"];
const claim = (s: GameState): GameState => ({ ...s, player: { ...s.player, shelterId: s.player.location } });
const withRooms = (s: GameState, rooms: string[]): GameState => ({ ...s, nodes: { ...s.nodes, [s.player.location]: { ...s.nodes[s.player.location]!, rooms } } });
const withStash = (s: GameState, stash: Stash): GameState => ({ ...s, player: { ...s.player, stash } });
const setGrid = (s: GameState, powerGrid: number): GameState => ({ ...s, world: { ...s.world, powerGrid } });
const setBarricades = (s: GameState, barricades: number): GameState => ({ ...s, nodes: { ...s.nodes, [s.player.location]: { ...s.nodes[s.player.location]!, barricades } } });

function withCompanion(s: GameState, id = "c.ruth", loc: string | null = s.player.location, needs = { hunger: 0, thirst: 0, fatigue: 0 }): GameState {
  const c: Survivor = {
    id, type: "npc.ruth", name: "Ruth", trust: 80,
    condition: { needs, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
    location: loc, groupId: null, relationships: {}, inventory: [], flags: { companion: true },
  };
  return { ...s, actors: { ...s.actors, [id]: c } };
}

const stashCount = (s: GameState, type: string): number => s.player.stash.filter((e) => e.type === type && e.itemId === undefined).reduce((n, e) => n + e.quantity, 0);
const companion = (s: GameState, id = "c.ruth"): Survivor => s.actors[id]!;

/** Set up a shelter with the given rooms, a resident companion, and a stash — the standard fixture. */
function shelterWith(rooms: string[], stash: Stash = [], needs = { hunger: 0, thirst: 0, fatigue: 0 }): { state: GameState; graph: RegionGraph } {
  const { state, graph } = base();
  let s = claim(state);
  s = withRooms(s, rooms);
  s = withStash(s, stash);
  s = withCompanion(s, "c.ruth", s.player.location, needs);
  return { state: s, graph };
}

/** Take an offered choice by id and resolve the turn (full pipeline). */
const take = (s: GameState, graph: RegionGraph, choiceId: string): GameState => {
  const c = availableActions(s, graph).find((ch) => ch.id === choiceId);
  if (c === undefined) throw new Error(`no choice "${choiceId}" — offered: ${availableActions(s, graph).map((x) => x.id).join(", ")}`);
  return applyAction(s, c.action, graph).state;
};

// --- inertness: the whole system is dark without a job pool (byte-identity guarantee) ----------

describe("the jobs system is inert without a job pool (every prior run byte-identical)", () => {
  it("jobsActive is false and there are no job choices without a pool", () => {
    const { state, graph } = startRun(opts, REGIONS, NODES); // no jobs registered
    expect(jobsActive(graph)).toBe(false);
    const s = withCompanion(withRooms(claim(state), ["room.garden"]));
    expect(jobChoices(s, graph)).toHaveLength(0);
    expect(buildableJobs(s, graph)).toHaveLength(0);
  });

  it("tickShelterOps and offscreenShelterUpkeep are no-ops without a pool", () => {
    const { state, graph } = startRun(opts, REGIONS, NODES);
    const s = setBarricades(withStash(withCompanion(withRooms(claim(state), ["room.garden"])), [{ type: "item.food-fresh", quantity: 1 }]), 50);
    expect(tickShelterOps(s, graph, 24)).toBe(s);
    expect(offscreenShelterUpkeep(s, graph, 24)).toBe(s);
  });

  it("a pool is registered only when jobs are supplied", () => {
    expect(jobsActive(base().graph)).toBe(true);
    expect(jobsActive(startRun(opts, REGIONS, NODES).graph)).toBe(false);
  });

  it("with a pool but no shelter/rooms/companions, a normal turn is untouched (no job choices away from base)", () => {
    const { state, graph } = base();
    // player has no shelter — jobChoices empty, and availableActions carries no assign-* choice
    expect(jobChoices(state, graph)).toHaveLength(0);
    expect(availableActions(state, graph).some((c) => c.id.startsWith("assign-job"))).toBe(false);
  });
});

// --- assignment: the T45 flag idiom, gated ----------------------------------------------------

describe("assigning a companion to a room's job (FR-SHL-03)", () => {
  it("offers an assign choice only at the shelter with the room built and a companion present", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const choice = availableActions(state, graph).find((c) => c.id === "assign-job:c.ruth:job.garden");
    expect(choice).toBeDefined();
    expect(choice!.timeCost).toBe(0); // free base management, like orders/stash
    // no garden room → no garden job offered
    const noRoom = withRooms(state, []);
    expect(availableActions(noRoom, graph).some((c) => c.id.startsWith("assign-job"))).toBe(false);
    // companion away → not offered
    const away = { ...state, actors: { ...state.actors, "c.ruth": { ...companion(state), location: "node.a" } } };
    expect(availableActions(away, graph).some((c) => c.id.startsWith("assign-job"))).toBe(false);
  });

  it("assigning sets the job flag and forces the worker to hold at the base", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    expect(jobIdOf(companion(s))).toBe("job.garden");
    expect(companion(s).flags["order:hold"]).toBe(true);
  });

  it("buildableJobs is only the jobs whose room is built", () => {
    const { state, graph } = shelterWith(["room.garden", "room.workshop"]);
    expect(buildableJobs(state, graph).map((j) => j.id).sort()).toEqual(["job.garden", "job.salvage"]);
  });

  it("clear-job takes a worker off duty", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    let s = take(state, graph, "assign-job:c.ruth:job.garden");
    s = take(s, graph, "clear-job:c.ruth");
    expect(jobIdOf(companion(s))).toBeNull();
  });

  it("re-ordering a worker (T45) clears their job flag — orders and jobs never contradict", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    let s = take(state, graph, "assign-job:c.ruth:job.garden");
    expect(jobIdOf(companion(s))).toBe("job.garden");
    s = take(s, graph, "order:c.ruth:follow");
    expect(jobIdOf(companion(s))).toBeNull();
  });

  it("a forged assign for an absent companion / unbuilt room is inert", () => {
    const { state, graph } = shelterWith([]); // no rooms
    const forged = resolveJobAction(state, graph, { type: "assign-job", timeCost: 0, params: { companion: "c.ruth", job: "job.garden" } });
    expect(jobIdOf(companion(forged))).toBeNull();
    expect(isJobAction({ type: "assign-job", timeCost: 0 })).toBe(true);
    expect(isJobAction({ type: "move", timeCost: 2 })).toBe(false);
  });
});

// --- jobs produce/consume the stash over time -------------------------------------------------

describe("jobs produce and consume the shared stash (FR-SHL-03)", () => {
  it("a garden banks fresh food into the stash, one unit per cycle", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    const ticked = tickShelterOps(s, graph, 12); // 12h / 6h per cycle = 2 cycles
    expect(stashCount(ticked, "item.food-fresh")).toBe(2);
  });

  it("a kitchen consumes fresh food and banks canned", () => {
    const { state, graph } = shelterWith(["room.kitchen"], [{ type: "item.food-fresh", quantity: 3 }]);
    const s = take(state, graph, "assign-job:c.ruth:job.kitchen");
    const ticked = tickShelterOps(s, graph, 8); // 8h / 4h = 2 cycles
    expect(stashCount(ticked, "item.food-fresh")).toBe(1);
    expect(stashCount(ticked, "item.canned-food")).toBe(2);
  });

  it("a job short of its input stalls — it never drives the stash negative", () => {
    const { state, graph } = shelterWith(["room.kitchen"], [{ type: "item.food-fresh", quantity: 1 }]);
    const s = take(state, graph, "assign-job:c.ruth:job.kitchen");
    const ticked = tickShelterOps(s, graph, 24); // wants 6 cycles, only 1 fresh in the cache
    expect(stashCount(ticked, "item.food-fresh")).toBe(0);
    expect(stashCount(ticked, "item.canned-food")).toBe(1); // only the one cycle it could afford
  });

  it("the generator burns fuel and raises powerGrid", () => {
    const { state, graph } = shelterWith(["room.generator"], [{ type: "item.fuel", quantity: 2 }]);
    const s = setGrid(take(state, graph, "assign-job:c.ruth:job.generator"), 20);
    const ticked = tickShelterOps(s, graph, 6); // one cycle
    expect(ticked.world.powerGrid).toBe(20 + GEN_POWER_PER_CYCLE);
    expect(stashCount(ticked, "item.fuel")).toBe(1);
  });

  it("the generator stalls at a full grid — it never burns fuel for nothing", () => {
    const { state, graph } = shelterWith(["room.generator"], [{ type: "item.fuel", quantity: 2 }]);
    const s = setGrid(take(state, graph, "assign-job:c.ruth:job.generator"), 100);
    const ticked = tickShelterOps(s, graph, 24);
    expect(ticked).toBe(s); // no headroom ⇒ inert, fuel untouched
    expect(stashCount(ticked, "item.fuel")).toBe(2);
  });

  it("the watch job keeps the shelter's barricades up (the upkeep shape)", () => {
    const { state, graph } = shelterWith(["room.watchtower"]);
    const s = setBarricades(take(state, graph, "assign-job:c.ruth:job.watch"), 40);
    const ticked = tickShelterOps(s, graph, 12); // 2 cycles
    expect(ticked.nodes["node.s"]!.barricades).toBeGreaterThan(40);
    // A watch at a full wall has nothing to do — inert.
    const full = setBarricades(s, 100);
    expect(tickShelterOps(full, graph, 12).nodes["node.s"]!.barricades).toBe(100);
  });

  it("a sub-cycle tick banks nothing (the scavenge idiom)", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    expect(tickShelterOps(s, graph, 5)).toBe(s); // 5h < 6h per cycle
  });

  it("only a resident with the job flag works — an unassigned companion produces nothing", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    expect(tickShelterOps(state, graph, 24)).toBe(state); // no one assigned
  });
});

// --- the base feeds its residents (PL-M3-01) --------------------------------------------------

describe("the base feeds its residents from the stash (closes PL-M3-01)", () => {
  it("a hungry, thirsty resident is fed from the cache and relieved", () => {
    const { state, graph } = shelterWith(["room.garden"], [{ type: "item.canned-food", quantity: 3 }, { type: "item.water", quantity: 3 }], { hunger: 90, thirst: 90, fatigue: 0 });
    const ticked = tickShelterOps(state, graph, 6);
    expect(ticked.actors["c.ruth"]!.condition.needs.hunger).toBeLessThan(RESIDENT_FEED_AT);
    expect(ticked.actors["c.ruth"]!.condition.needs.thirst).toBeLessThan(RESIDENT_FEED_AT);
    expect(stashCount(ticked, "item.canned-food")).toBeLessThan(3); // the cache paid for it
  });

  it("an empty cache feeds no one (no negative stash, needs unchanged)", () => {
    const { state, graph } = shelterWith(["room.garden"], [], { hunger: 90, thirst: 0, fatigue: 0 });
    const ticked = tickShelterOps(state, graph, 6);
    expect(ticked.actors["c.ruth"]!.condition.needs.hunger).toBe(90);
  });

  it("fresh food is spent before cans (use it before it rots)", () => {
    const { state, graph } = shelterWith(["room.garden"], [{ type: "item.food-fresh", quantity: 1 }, { type: "item.canned-food", quantity: 1 }], { hunger: 80, thirst: 0, fatigue: 0 });
    const ticked = tickShelterOps(state, graph, 6);
    expect(stashCount(ticked, "item.food-fresh")).toBe(0); // fresh eaten first
    expect(stashCount(ticked, "item.canned-food")).toBe(1); // the can kept
  });
});

// --- the fridge + generator preserve base food (PL-M4-29) -------------------------------------

describe("the fridge and the generator preserve the base's food (PL-M4-29)", () => {
  it("stash fresh food spoils when the grid is down and nothing keeps it cold", () => {
    const { state, graph } = shelterWith(["room.garden"], [{ type: "item.food-fresh", quantity: 3 }]);
    const s = setGrid(state, 20); // below POWER_SPOIL_AT (40)
    const ticked = tickShelterOps(s, graph, 24); // 24h / 12h = 2 units lost
    expect(stashCount(ticked, "item.food-fresh")).toBe(1);
    expect(stashCount(ticked, "item.food-spoiled")).toBe(2);
  });

  it("a kitchen (the fridge) keeps stash fresh food from spoiling even with the grid down", () => {
    const { state, graph } = shelterWith([KITCHEN_ROOM], [{ type: "item.food-fresh", quantity: 3 }]);
    const s = setGrid(state, 20);
    const ticked = tickShelterOps(s, graph, 24);
    expect(stashCount(ticked, "item.food-fresh")).toBe(3); // refrigerated
  });

  it("a running generator lifts the grid out of the spoil band, so the food keeps", () => {
    const { state, graph } = shelterWith(["room.generator"], [{ type: "item.food-fresh", quantity: 2 }, { type: "item.fuel", quantity: 1 }]);
    const s = setGrid(state, 25); // 25 + 20 = 45 ≥ POWER_SPOIL_AT after the generator runs
    const ticked = tickShelterOps(take(s, graph, "assign-job:c.ruth:job.generator"), graph, 6);
    expect(stashCount(ticked, "item.food-fresh")).toBe(2);
  });

  it("a full grid never spoils base food", () => {
    const { state, graph } = shelterWith(["room.garden"], [{ type: "item.food-fresh", quantity: 3 }]);
    const ticked = tickShelterOps(state, graph, 48); // grid starts at 100
    expect(stashCount(ticked, "item.food-fresh")).toBe(3);
  });
});

// --- off-screen: the base runs while you're away (PL-M3-05 · PL-M4-08) ------------------------

describe("the base runs off-screen through advanceWorld (PL-M3-05)", () => {
  it("a day away runs the jobs and stocks the stash", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    const after = advanceWorld(s, 24, graph); // 24h / 6h = 4 cycles
    expect(stashCount(after, "item.food-fresh")).toBe(4);
  });

  it("off-screen barricades decay, and a watchtower halves the loss", () => {
    const { state, graph } = shelterWith([]);
    const bare = setBarricades(state, 100);
    const tower = setBarricades(withRooms(state, [WATCHTOWER_ROOM]), 100);
    const bareAfter = advanceWorld(bare, 24, graph).nodes["node.s"]!.barricades;
    const towerAfter = advanceWorld(tower, 24, graph).nodes["node.s"]!.barricades;
    expect(bareAfter).toBeLessThan(100);
    expect(towerAfter).toBeGreaterThan(bareAfter); // the lookout kept the wall up
  });

  it("material off-screen wall decay is never silent — it leaves a note in the report (PL-M3-05)", () => {
    const { state, graph } = shelterWith([]);
    const after = advanceWorld(setBarricades(state, 80), 24, graph);
    expect(after.history.some((h) => h.type === "shelter.weakened")).toBe(true);
    expect(jobLine(after, graph)).toContain("wall");
  });

  it("a posted watch holds the wall through a day away", () => {
    const { state, graph } = shelterWith(["room.watchtower"]);
    const s = setBarricades(take(state, graph, "assign-job:c.ruth:job.watch"), 50);
    const after = advanceWorld(s, 24, graph);
    expect(after.nodes["node.s"]!.barricades).toBeGreaterThanOrEqual(50); // the watcher rebuilt what the days took
  });

  it("off-screen upkeep is inert without a shelter or a job pool", () => {
    const { state, graph } = base();
    expect(offscreenShelterUpkeep(state, graph, 24)).toBe(state); // no shelter claimed
    const poolless = startRun(opts, REGIONS, NODES);
    const claimed = setBarricades(claim(poolless.state), 100);
    expect(advanceWorld(claimed, 24, poolless.graph).nodes["node.s"]!.barricades).toBe(100); // no pool ⇒ no off-screen decay
  });
});

// --- determinism & save-losslessness ----------------------------------------------------------

describe("deterministic and save-lossless (the acceptance line)", () => {
  it("same state + hours ⇒ byte-identical tick", () => {
    const { state, graph } = shelterWith(["room.garden", "room.kitchen"], [{ type: "item.food-fresh", quantity: 2 }]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    expect(JSON.stringify(tickShelterOps(s, graph, 18))).toBe(JSON.stringify(tickShelterOps(s, graph, 18)));
  });

  it("a run carried through an assign + a produced cycle round-trips deep-equal", () => {
    const { state, graph } = shelterWith(["room.garden"], [{ type: "item.canned-food", quantity: 2 }]);
    const s = tickShelterOps(take(state, graph, "assign-job:c.ruth:job.garden"), graph, 12);
    const round = loadGame(saveGame(s));
    expect(round).toEqual(s);
  });

  it("save schema stays v10 — no rung (assignment is a companion flag)", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    expect(s.meta.version).toBe(10);
    expect(loadGame(saveGame(s)).actors["c.ruth"]!.flags["job:job.garden"]).toBe(true);
  });
});

// --- narration (FR-UI-02: words, no numbers) --------------------------------------------------

describe("the daily report reads in words, never numbers (FR-UI-02)", () => {
  it("names the worker and their post on assignment", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    const line = jobLine(s, graph);
    expect(line).toContain("Ruth");
    expect(line).not.toMatch(/\d/);
  });

  it("reports production / feeding / spoilage as prose after a tick", () => {
    const { state, graph } = shelterWith(["room.garden"], [{ type: "item.canned-food", quantity: 2 }], { hunger: 90, thirst: 0, fatigue: 0 });
    const s = tickShelterOps(take(state, graph, "assign-job:c.ruth:job.garden"), graph, 12);
    const line = jobLine(s, graph);
    expect(line).not.toBeNull();
    expect(line).not.toMatch(/\d/);
    expect(line!.length).toBeGreaterThan(0);
  });

  it("a companion's job shows in the scene's people line", () => {
    const { state, graph } = shelterWith(["room.garden"]);
    const s = take(state, graph, "assign-job:c.ruth:job.garden");
    expect(sceneOf(s, graph).narration).toContain("garden");
  });
});
