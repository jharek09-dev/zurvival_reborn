import { describe, expect, it } from "vitest";
import {
  CHASE_AT,
  SAVE_SCHEMA_VERSION,
  SCREAM_NOISE,
  ZOMBIE_SCREAMER,
  ZOMBIE_STALKER,
  desiredRung,
  loadGame,
  nextZombieState,
  startRun,
  tickZombies,
  type GameState,
  type NodeDef,
  type NodeState,
  type RegionDef,
  type RegionGraph,
  type ZombieState,
} from "../src/index.js";

/**
 * T25 — zombie state machine (FR-CBT-06) + first distinct types Screamer/Stalker (FR-CBT-07). The
 * dead are senses-driven agents: they snap awake to noise/presence and settle when it goes quiet.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "start", adjacent: ["node.k", "node.b"], start: true },
  { id: "node.k", regionId: "region.z", name: "K", description: "stalker lair", adjacent: ["node.s"], zombieTypes: [ZOMBIE_STALKER] },
  { id: "node.b", regionId: "region.z", name: "B", description: "screamer nest", adjacent: ["node.s", "node.a"], walkers: 2, zombieTypes: [ZOMBIE_SCREAMER] },
  { id: "node.a", regionId: "region.z", name: "A", description: "quiet walkers", adjacent: ["node.b"], walkers: 2 },
];
const opts = { seed: "zed-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const patchNode = (state: GameState, id: string, patch: Partial<NodeState>): GameState => ({
  ...state,
  nodes: { ...state.nodes, [id]: { ...state.nodes[id]!, ...patch } },
});
const zState = (s: GameState, id: string): ZombieState => s.nodes[id]!.zombieState;

// --- the ladder & transition function -------------------------------------------------------

describe("desiredRung maps stimulus to arousal (T25)", () => {
  it("climbs with stimulus", () => {
    expect(desiredRung(0)).toBe(0);
    expect(desiredRung(3)).toBe(1);
    expect(desiredRung(10)).toBe(2);
    expect(desiredRung(25)).toBe(3);
    expect(desiredRung(60)).toBe(4);
  });
});

describe("nextZombieState — snap up, relax down, feed (T25 · FR-CBT-06)", () => {
  const present = { present: true, corpses: 0, playerHere: false };
  it("snaps up to the stimulus rung in one step", () => {
    expect(nextZombieState("dormant", { ...present, stimulus: 60 })).toBe("chasing");
  });
  it("relaxes one rung per tick when quiet", () => {
    expect(nextZombieState("chasing", { ...present, stimulus: 0 })).toBe("investigating");
    expect(nextZombieState("investigating", { ...present, stimulus: 0 })).toBe("wandering");
    expect(nextZombieState("wandering", { ...present, stimulus: 0 })).toBe("dormant");
    expect(nextZombieState("dormant", { ...present, stimulus: 0 })).toBe("hibernating");
  });
  it("diverts a roused node onto corpses to feed", () => {
    expect(nextZombieState("chasing", { present: true, stimulus: 0, corpses: 3, playerHere: false })).toBe("feeding");
  });
  it("a node with no dead is dormant regardless of noise", () => {
    expect(nextZombieState("chasing", { present: false, stimulus: 99, corpses: 0, playerHere: false })).toBe("dormant");
  });
});

// --- tickZombies over a real graph ----------------------------------------------------------

describe("tickZombies drives node states from senses (T25)", () => {
  it("a loud node with walkers snaps to chasing, then relaxes when quiet", () => {
    const { state, graph } = run();
    const loud = patchNode(state, "node.a", { noise: 80 });
    const roused = tickZombies(loud, 1, graph);
    expect(zState(roused, "node.a")).toBe("chasing");
    // now silence it and step: it steps back down the ladder
    const quiet = patchNode(roused, "node.a", { noise: 0 });
    expect(zState(tickZombies(quiet, 1, graph), "node.a")).toBe("investigating");
  });

  it("is inert on a zero-hour tick and deterministic", () => {
    const { state, graph } = run();
    const loud = patchNode(state, "node.a", { noise: 80 });
    expect(tickZombies(loud, 0, graph)).toBe(loud);
    expect(JSON.stringify(tickZombies(loud, 1, graph))).toBe(JSON.stringify(tickZombies(loud, 1, graph)));
  });

  it("a quiet node with no dead never leaves dormant", () => {
    const { state, graph } = run();
    const loud = patchNode(state, "node.s", { noise: 90 }); // start node has no walkers/types
    expect(zState(tickZombies(loud, 1, graph), "node.s")).toBe("dormant");
  });
});

describe("Screamer rouses its neighbours (T25 · FR-CBT-07)", () => {
  it("a roused screamer deposits noise into adjacent nodes; a plain node does not", () => {
    const { state, graph } = run();
    // node.b is a screamer with walkers — make it loud so it reaches chasing.
    const loud = patchNode(state, "node.b", { noise: 80 });
    const before = loud.nodes["node.a"]!.noise; // node.a is adjacent to node.b
    const after = tickZombies(loud, 1, graph);
    expect(zState(after, "node.b")).toBe("chasing");
    expect(after.nodes["node.a"]!.noise).toBe(before + SCREAM_NOISE);

    // control: node.a is a plain walker node; when it is the loud one, no neighbour gets roused-noise.
    const loudA = patchNode(state, "node.a", { noise: 80 });
    const afterA = tickZombies(loudA, 1, graph);
    expect(afterA.nodes["node.b"]!.noise).toBe(loudA.nodes["node.b"]!.noise);
  });
});

describe("Stalker hunts at night (T25 · FR-CBT-07)", () => {
  it("reaches chasing at night from a stimulus that leaves it calm by day", () => {
    const { state, graph } = run(); // player is at node.s, adjacent to the stalker node.k
    const day = { ...state, meta: { ...state.meta, phase: "midday" as const } };
    const night = { ...state, meta: { ...state.meta, phase: "night" as const } };
    expect(zState(tickZombies(day, 1, graph), "node.k")).not.toBe("chasing");
    expect(zState(tickZombies(night, 1, graph), "node.k")).toBe("chasing");
  });
});

// --- save-schema migration v2 -> v3 ---------------------------------------------------------

describe("save migrates v2 -> v3 (T25 · ADR-0003 ladder)", () => {
  it("a pre-zombie-machine v2 save loads with every node dormant and no types", () => {
    const { state } = startRun(opts, REGIONS, [
      { id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: ["node.a"], start: true },
      { id: "node.a", regionId: "region.z", name: "A", description: "a", adjacent: ["node.s"] },
    ]);
    // synthesize a v2 blob: strip the v3-only node fields and stamp version 2.
    const v2nodes: Record<string, unknown> = {};
    for (const [id, n] of Object.entries(state.nodes)) {
      const { zombieState, zombieTypes, ...rest } = n as unknown as Record<string, unknown>;
      void zombieState; void zombieTypes;
      v2nodes[id] = rest;
    }
    const v2state = { ...state, meta: { ...state.meta, version: 2 }, nodes: v2nodes };
    const blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 2, summary: "v2 save", state: v2state });

    const loaded = loadGame(blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION);
    for (const n of Object.values(loaded.nodes)) {
      expect(n.zombieState).toBe("dormant");
      expect(n.zombieTypes).toStrictEqual([]);
    }
  });
});
