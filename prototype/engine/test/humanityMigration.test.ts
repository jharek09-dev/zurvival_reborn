import { describe, expect, it } from "vitest";
import { SAVE_SCHEMA_VERSION, HUMANITY_BASELINE, loadGame, saveGame, startRun, type GameState, type NodeDef, type RegionDef } from "../src/index.js";

/**
 * T47 — the Humanity system arrived at save schema v8. A pre-moral v7 save has no `player.humanity`;
 * the forward-only rung (migrateV7toV8) seeds it at the neutral baseline and stamps the version. One
 * pure, total N→N+1 rung, per the ADR-0003 / T7 ladder — every historical run keeps loading losslessly.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: ["node.a"], start: true },
  { id: "node.a", regionId: "region.z", name: "A", description: "a", adjacent: ["node.s"] },
];
const opts = { seed: "hum-mig-seed", createdAt: "2026-07-16T00:00:00Z" };

describe("save migrates v7 -> v8 (T47 · ADR-0003 ladder)", () => {
  it("a pre-Humanity v7 save loads with a neutral humanity and the current version", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    // synthesize a v7 blob: strip the v8-only `player.humanity` field and stamp version 7.
    const { humanity, ...restPlayer } = state.player as unknown as Record<string, unknown>;
    void humanity;
    const v7state = { ...state, player: restPlayer, meta: { ...state.meta, version: 7 } } as unknown as GameState;
    const blob = JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 7, summary: "v7 save", state: v7state });

    const loaded = loadGame(blob);
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION); // ladder chains ... v7 -> v8 (current)
    expect(loaded.player.humanity).toBe(HUMANITY_BASELINE);
  });

  it("a current-version run round-trips its humanity deep-equal", () => {
    const { state } = startRun(opts, REGIONS, NODES);
    const moved: GameState = { ...state, player: { ...state.player, humanity: 73 } };
    expect(loadGame(saveGame(moved))).toEqual(moved);
    expect(loadGame(saveGame(moved)).player.humanity).toBe(73);
  });
});
