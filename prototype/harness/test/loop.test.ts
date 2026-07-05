import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  availableActions,
  loadGame,
  saveGame,
  sceneOf,
  startRun,
  type NodeDef,
  type RegionDef,
} from "../../engine/src/index.js";

/**
 * Integration (T12): play the real move/search/rest loop through the first client over the
 * *shipped* Rivermouth content. Proves the engine's action loop drives end to end — a starting
 * Scene offers real choices, each resolved turn advances time and stays autosave-lossless
 * (FR-CORE-07), and scouting opens new travel choices as fog lifts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

describe("play the core loop over Rivermouth (T12)", () => {
  const regions = load<RegionDef>("regions");
  const nodes = load<NodeDef>("nodes");

  it("opens with a readable scene offering real, costed choices", () => {
    const { state, graph } = startRun({ seed: "play", createdAt: "2026-07-05T00:00:00Z" }, regions, nodes);
    const scene = sceneOf(state, graph);
    expect(scene.location).toBe("node.rivermouth.transit-plaza");
    expect(scene.choices.length).toBeGreaterThanOrEqual(3); // 2 neighbors + search + rest
    expect(scene.choices.every((c) => c.timeCost > 0)).toBe(true);
  });

  it("plays a scripted run: time advances and every turn is autosave-lossless", () => {
    let { state, graph } = startRun({ seed: "play", createdAt: "2026-07-05T00:00:00Z" }, regions, nodes);
    const startClock = state.meta.day * 24 + state.meta.hour;

    // Search here, then travel out along whatever the first offered move is, a few times.
    const script = ["search", "search"];
    for (let i = 0; i < 4; i++) {
      const move = availableActions(state, graph).find((c) => c.id.startsWith("move:"));
      if (move) script.push(move.id);
    }

    let turns = 0;
    for (const id of script) {
      const choice = availableActions(state, graph).find((c) => c.id === id);
      if (!choice) continue;
      const before = state.meta.day * 24 + state.meta.hour;
      state = applyAction(state, choice.action, graph).state;
      expect(state.meta.day * 24 + state.meta.hour).toBeGreaterThan(before); // time advanced
      expect(loadGame(saveGame(state))).toStrictEqual(state); // safe to stop
      turns++;
    }

    expect(turns).toBeGreaterThanOrEqual(3);
    expect(state.meta.turn).toBe(turns);
    expect(state.meta.day * 24 + state.meta.hour).toBeGreaterThan(startClock);
    // Having moved off the plaza, more of the map is now discovered than at the start.
    const discovered = Object.values(state.nodes).filter((n) => n.discovered).length;
    expect(discovered).toBeGreaterThan(3);
  });
});
