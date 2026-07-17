import { describe, expect, it } from "vitest";
import {
  SAVE_SCHEMA_VERSION,
  loadGame,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../src/index.js";

/**
 * T49 — infection became a staged identity at save schema v9, and the stage bands changed: an `advanced`
 * band was inserted at progression 70, and terminal onset no longer ends the run. A v8 save wrote
 * `infection.stage` under the OLD bands, so a mid-infection save with progression in [70,100) stored
 * `stage:"symptomatic"` — which now disagrees with the bands. The forward-only rung (migrateV8toV9)
 * re-derives `stage` from the stored `progression`, so a loaded run reads its infection correctly.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: ["node.a"], start: true },
  { id: "node.a", regionId: "region.z", name: "A", description: "a", adjacent: ["node.s"] },
];
const opts = { seed: "infect-mig-seed", createdAt: "2026-07-17T00:00:00Z" };

/** Synthesize a v8 save blob whose player infection is stored under the OLD bands. */
function v8Blob(stage: string, progression: number): string {
  const { state } = startRun(opts, REGIONS, NODES);
  const v8: GameState = {
    ...state,
    meta: { ...state.meta, version: 8 },
    player: { ...state.player, condition: { ...state.player.condition, infection: { stage: stage as never, progression } } },
  };
  return JSON.stringify({ format: "zurvival-save", saveSchemaVersion: 8, summary: "v8 save", state: v8 });
}

describe("save migrates v8 -> v9 — infection.stage re-derived under the new bands (T49 · ADR-0003 ladder)", () => {
  it("a v8 save with progression in the new `advanced` band, stored as `symptomatic`, loads as `advanced`", () => {
    const loaded = loadGame(v8Blob("symptomatic", 85)); // 85 was symptomatic under old bands; now advanced
    expect(loaded.meta.version).toBe(SAVE_SCHEMA_VERSION); // chained ... v8 -> v9 (current)
    expect(loaded.player.condition.infection.stage).toBe("advanced");
    expect(loaded.player.condition.infection.progression).toBe(85); // the hidden number is preserved
  });

  it("leaves a consistent save untouched (a healthy or already-correct stage is unchanged)", () => {
    expect(loadGame(v8Blob("none", 0)).player.condition.infection.stage).toBe("none");
    expect(loadGame(v8Blob("symptomatic", 50)).player.condition.infection.stage).toBe("symptomatic");
    // terminal onset (100) stays terminal — but now it is playable, not an instant loss (proven elsewhere).
    expect(loadGame(v8Blob("terminal", 100)).player.condition.infection.stage).toBe("terminal");
  });
});
