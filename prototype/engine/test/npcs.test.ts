import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SAVE_SCHEMA_VERSION,
  applyAction,
  diffSystems,
  driftNpc,
  loadGame,
  saveGame,
  spawnNpcs,
  startingNeeds,
  startingTrust,
  startRun,
  tickNpcs,
  TRACKED_SYSTEMS,
  type GameState,
  type NodeDef,
  type NPCDef,
  type NPCState,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T33 — Survivor NPCs (FR-NPC-01, VS subset). People with per-run state and needs, spawned
 * deterministically from the named `npc` stream, drifting each turn via the player's survival economy.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "start", adjacent: ["node.k"], start: true },
  { id: "node.k", regionId: "region.z", name: "K", description: "k", adjacent: ["node.s"] },
];
const NPCS: NPCDef[] = [
  { id: "npc.home", name: "Homed", description: "a homed survivor", disposition: "friendly", homeNode: "node.k" },
  { id: "npc.drifter", name: "Drifter", description: "a placed survivor", disposition: "desperate" },
];
const opts = { seed: "npc-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS);

// --- spawn ----------------------------------------------------------------------------------

describe("spawnNpcs seeds the pool from content (T33 · FR-NPC-01)", () => {
  it("creates one NPCState per def with content-seeded fields", () => {
    const { state } = run();
    expect(Object.keys(state.npcs).sort()).toStrictEqual(["npc.drifter", "npc.home"]);
    const sarah = state.npcs["npc.home"]!;
    expect(sarah).toMatchObject({
      id: "npc.home",
      type: "npc.home",
      name: "Homed",
      disposition: "friendly",
      alive: true,
      trust: startingTrust("friendly"),
    });
    expect(sarah.needs).toStrictEqual(startingNeeds("friendly"));
  });

  it("places a homed survivor at its homeNode", () => {
    expect(run().state.npcs["npc.home"]!.location).toBe("node.k");
  });

  it("places a homeless survivor on a real node via the `npc` stream", () => {
    const { state } = run();
    const loc = state.npcs["npc.drifter"]!.location;
    expect(["node.s", "node.k"]).toContain(loc);
    // The stream was actually consumed for the homeless placement.
    expect(Object.keys(state.rng.streams)).toContain("npc");
  });

  it("is deterministic — same seed ⇒ byte-identical pool and placement", () => {
    expect(run().state.npcs).toStrictEqual(run().state.npcs);
    // A different seed can move the *homeless* survivor (proving the stream drives placement).
    const other = startRun({ ...opts, seed: "other-seed" }, REGIONS, NODES, NPCS).state;
    expect(other.npcs["npc.home"]!.location).toBe("node.k"); // homed is pinned regardless of seed
  });

  it("seeds no survivors when none are supplied (every M2 run is unchanged)", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    expect(state.npcs).toStrictEqual({});
    expect(Object.keys(state.rng.streams)).not.toContain("npc");
  });

  it("a desperate survivor opens hungrier than a steady one", () => {
    const { state } = run();
    expect(state.npcs["npc.drifter"]!.needs.hunger).toBeGreaterThan(state.npcs["npc.home"]!.needs.hunger);
  });
});

// --- needs drift ----------------------------------------------------------------------------

describe("NPC needs drift with the hours spent (T33)", () => {
  it("drifts a survivor's needs over hours, reusing the player economy", () => {
    const { state } = run();
    const drifted = tickNpcs(state, 2).npcs["npc.home"]!;
    // hunger +1/h, thirst +2/h, fatigue +2/h from the base {15,20,25}.
    expect(drifted.needs).toStrictEqual({ hunger: 17, thirst: 24, fatigue: 29 });
  });

  it("a zero-hour tick is inert (empty-turn contract)", () => {
    const { state } = run();
    expect(tickNpcs(state, 0)).toBe(state);
  });

  it("an empty pool is inert", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    expect(tickNpcs(state, 6)).toBe(state);
  });

  it("a dead survivor does not drift", () => {
    const { state } = run();
    const dead: NPCState = { ...state.npcs["npc.home"]!, alive: false };
    expect(driftNpc(dead, 12)).toBe(dead);
  });

  it("drift is wired into a resolved turn (pipeline stage 5)", () => {
    const { state, graph } = run();
    const before = state.npcs["npc.home"]!.needs;
    const res = applyAction(state, { type: "rest", choiceId: "rest", timeCost: 6 }, graph);
    const after = res.state.npcs["npc.home"]!.needs;
    expect(after.thirst).toBeGreaterThan(before.thirst);
    // npcs is an audited system and it moved this turn (FR-CORE-04).
    expect(TRACKED_SYSTEMS).toContain("npcs");
    expect(res.changed).toContain("npcs");
  });

  it("property — a living survivor's hunger/thirst never fall and stay in 0–100", () => {
    const { state } = run();
    const base = state.npcs["npc.home"]!;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 240 }), (hours) => {
        const d = driftNpc(base, hours).needs;
        expect(d.hunger).toBeGreaterThanOrEqual(base.needs.hunger);
        expect(d.thirst).toBeGreaterThanOrEqual(base.needs.thirst);
        for (const v of [d.hunger, d.thirst, d.fatigue]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
          expect(Number.isInteger(v)).toBe(true);
        }
      }),
    );
  });
});

// --- persistence ----------------------------------------------------------------------------

describe("NPCs are save-lossless and migration-safe (T33 · ADR-0003)", () => {
  it("a run carrying survivors round-trips deep-equal", () => {
    const { state } = run();
    const moved = applyAction(state, { type: "rest", choiceId: "rest", timeCost: 6 }, run().graph).state;
    expect(loadGame(saveGame(moved))).toStrictEqual(moved);
  });

  it("migrates a pre-people v4 save forward with an empty npcs slice", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    const { npcs, ...rest } = state as unknown as Record<string, unknown>;
    void npcs;
    const v4 = { ...rest, meta: { ...state.meta, version: 4 } };
    const blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 4, summary: "v4", state: v4 });
    const loaded = loadGame(blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded.npcs).toStrictEqual({});
  });
});
