import { describe, expect, it } from "vitest";
import { SAVE_SCHEMA_VERSION, loadGame, startRun, type NodeDef, type RegionDef } from "../src/index.js";

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: ["node.a"], start: true },
  { id: "node.a", regionId: "region.z", name: "A", description: "a", adjacent: ["node.s"] },
];
const opts = { seed: "mig-seed", createdAt: "2026-07-05T00:00:00Z" };

describe("save migrates v3 -> v4 (T29 · ADR-0003 ladder)", () => {
  it("a pre-route v3 save loads with an empty routes slice and version 4", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    // synthesize a v3 blob: strip the v4-only `routes` slice and stamp version 3.
    const { routes, ...restState } = state as unknown as Record<string, unknown>;
    void routes;
    const v3state = { ...restState, meta: { ...state.meta, version: 3 } };
    const blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 3, summary: "v3 save", state: v3state });

    const loaded = loadGame(blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION); // ladder now chains ... v3 -> v4
    expect(loaded.routes).toStrictEqual({});
  });
});
