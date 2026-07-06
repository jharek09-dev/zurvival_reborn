import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  auditTurn,
  availableActions,
  loadGame,
  saveGame,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../../engine/src/index.js";

/**
 * Integration (T17 · FR-ECO-01/02/03): the loot economy over the *shipped* Rivermouth content.
 * Rivermouth starts with loot 70 and survivorActivity 25; a scavenging run must take real items,
 * drive the region's stock down (never up), stay lossless to save, and never trip the T13 audit.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const itemCount = (s: GameState): number => s.player.inventory.reduce((n, e) => n + e.quantity, 0);

describe("loot over Rivermouth (T17)", () => {
  const regions = load<RegionDef>("regions");
  const nodes = load<NodeDef>("nodes");
  const opts = { seed: "loot-rivermouth", createdAt: "2026-07-05T00:00:00Z" };

  it("a scavenging run fills the pack while the district's stock only falls", () => {
    let { state, graph } = startRun(opts, regions, nodes);
    const startLoot = state.regions["region.rivermouth"]!.loot;
    let lastLoot = startLoot;

    for (let i = 0; i < 25; i++) {
      const choices = availableActions(state, graph);
      const c = choices.find((x) => x.id === "search") ?? choices.find((x) => x.id.startsWith("move:")) ?? choices.find((x) => x.id === "rest");
      if (!c) break;
      const before = state;
      state = applyAction(before, c.action, graph).state;
      expect(auditTurn(before, state).ok).toBe(true); // no no-op turns
      const loot = state.regions["region.rivermouth"]!.loot;
      expect(loot).toBeLessThanOrEqual(lastLoot); // finite + only depletes
      expect(loot).toBeGreaterThanOrEqual(0);
      lastLoot = loot;
      expect(loadGame(saveGame(state))).toStrictEqual(state); // safe to stop
    }

    expect(itemCount(state)).toBeGreaterThan(0); // scavenged something real
    expect(state.regions["region.rivermouth"]!.loot).toBeLessThan(startLoot); // the world gave it up
  });
});
