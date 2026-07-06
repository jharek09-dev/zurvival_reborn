import { describe, expect, it } from "vitest";
import { SAVE_SCHEMA_VERSION, loadGame, startRun, type NodeDef, type NPCDef, type RegionDef } from "../src/index.js";

/** T35 · ADR-0003 ladder — the v5 -> v6 rung: a pre-interaction save's survivors gain `met: false`. */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: ["node.a"], start: true },
  { id: "node.a", regionId: "region.z", name: "A", description: "a", adjacent: ["node.s"] },
];
const NPCS: NPCDef[] = [{ id: "npc.sarah", name: "Sarah", description: "a paramedic", disposition: "friendly", homeNode: "node.s" }];
const opts = { seed: "mig6-seed", createdAt: "2026-07-06T00:00:00Z" };

describe("save migrates v5 -> v6 (T35 · ADR-0003 ladder)", () => {
  it("a pre-interaction v5 save's survivors load with met:false at version 6", () => {
    const { state } = startRun(opts, REGIONS, NODES, NPCS);
    // synthesize a v5 blob: strip the v6-only `met` field from every survivor and stamp version 5.
    const npcs: Record<string, unknown> = {};
    for (const [id, npc] of Object.entries(state.npcs as unknown as Record<string, Record<string, unknown>>)) {
      const { met, ...rest } = npc;
      void met;
      npcs[id] = rest;
    }
    const v5state = { ...(state as unknown as Record<string, unknown>), npcs, meta: { ...state.meta, version: 5 } };
    const blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 5, summary: "v5 save", state: v5state });

    const loaded = loadGame(blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION); // ladder chains ... v5 -> v6
    expect(loaded.npcs["npc.sarah"]!.met).toBe(false);
  });

  it("a v1 save still chains all the way forward to v6 (npcs empty, met absent → {} )", () => {
    const { state } = startRun(opts, REGIONS, NODES); // no survivors
    const strip = (k: string): Record<string, unknown> => {
      const { [k]: _drop, ...rest } = state as unknown as Record<string, unknown>;
      void _drop;
      return rest;
    };
    // v1 predates combat/zombieState/routes/npcs — but the loader only needs a coherent chain; use the
    // real state minus the post-v1 slices to prove the ladder still terminates at v6.
    let s: Record<string, unknown> = { ...(state as unknown as Record<string, unknown>) };
    delete s.routes; delete s.npcs;
    s = { ...s, meta: { ...state.meta, version: 1 }, combat: null };
    const blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 1, summary: "v1", state: s });
    const loaded = loadGame(blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded.npcs).toStrictEqual({});
  });
});
