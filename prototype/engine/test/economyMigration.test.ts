import { describe, expect, it } from "vitest";
import {
  SAVE_SCHEMA_VERSION,
  loadGame,
  saveGame,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

/**
 * T51 — the crafting economy arrived at save schema v10. The player gained an `economy` slice (learned
 * blueprints + the carried-food spoilage clock) and every node gained a `rooms` list. A v9 save has
 * neither; the forward-only rung (migrateV9toV10) adds both at their inert empties, so a pre-economy save
 * loads forward and behaves identically. Mirrors the routes/stash/npcs "add an empty field, bump" rungs.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: ["node.a"], start: true },
  { id: "node.a", regionId: "region.z", name: "A", description: "a", adjacent: ["node.s"] },
];
const opts = { seed: "economy-mig-seed", createdAt: "2026-07-17T00:00:00Z" };

/** Synthesize a v9 save blob: a current run with the v10 economy shape stripped back to v9. */
function v9Blob(): string {
  const { state } = startRun(opts, REGIONS, NODES);
  // Strip player.economy and every node.rooms to reproduce a genuine pre-T51 (v9) state shape.
  const { economy: _drop, ...playerV9 } = state.player as GameState["player"] & { economy: unknown };
  const nodesV9: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(state.nodes)) {
    const { rooms: _r, ...nodeV9 } = node as GameState["nodes"][string] & { rooms: unknown };
    nodesV9[id] = nodeV9;
  }
  const v9 = { ...state, meta: { ...state.meta, version: 9 }, player: playerV9, nodes: nodesV9 };
  return JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 9, summary: "v9 save", state: v9 });
}

describe("save migrates v9 -> v10 — the economy slice + node rooms seed empty (T51 · ADR-0003 ladder)", () => {
  it("a v9 save loads forward, seeding player.economy and every node's rooms at their inert empties", () => {
    const loaded = loadGame(v9Blob());
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION); // chained ... v9 -> v10 (current)
    expect(loaded.player.economy).toEqual({ blueprints: [], freshness: null });
    for (const node of Object.values(loaded.nodes)) expect(node.rooms).toEqual([]);
  });

  it("the migrated run plays on identically — an inert economy is byte-stable", () => {
    const loaded = loadGame(v9Blob());
    // A migrated pre-economy save has no learned recipes and no fresh food, so nothing economy-related moves.
    expect(loaded.player.economy.blueprints).toEqual([]);
    expect(loaded.player.economy.freshness).toBeNull();
    // Round-trips deep-equal at the current version (the seeded empties are stable).
    expect(loadGame(saveGame(loaded))).toStrictEqual(loaded);
  });
});
