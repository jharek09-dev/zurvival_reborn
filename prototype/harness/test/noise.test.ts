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
  NOISE_SEARCH,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../../engine/src/index.js";

/**
 * Integration (T14 · FR-SIM-06): the noise model over the *shipped* Rivermouth content. Proves the
 * loud/quiet split is legible end to end — a rummaging survivor leaves the district far noisier than
 * a careful one — and that noise is real, save-round-trippable node memory that never trips the
 * T13 no-no-op-turn audit.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const totalNoise = (s: GameState): number =>
  Object.values(s.nodes).reduce((sum, n) => sum + n.noise, 0);

describe("noise over Rivermouth (T14)", () => {
  const regions = load<RegionDef>("regions");
  const nodes = load<NodeDef>("nodes");
  const opts = { seed: "noise-rivermouth", createdAt: "2026-07-05T00:00:00Z" };

  it("a rummaging run is legibly louder than a resting run, and stays autosave-lossless", () => {
    // Loud: search wherever possible, else move to open new ground.
    let loud = startRun(opts, regions, nodes);
    let loudState = loud.state;
    for (let i = 0; i < 12; i++) {
      const choices = availableActions(loudState, loud.graph);
      const c = choices.find((x) => x.id === "search") ?? choices.find((x) => x.id.startsWith("move:"));
      if (!c) break;
      loudState = applyAction(loudState, c.action, loud.graph).state;
      expect(loadGame(saveGame(loudState))).toStrictEqual(loudState); // safe to stop
    }

    // Quiet: rest in place (until the survival clock ends the run — resting never makes noise).
    let quiet = startRun(opts, regions, nodes);
    let quietState = quiet.state;
    for (let i = 0; i < 12; i++) {
      const c = availableActions(quietState, quiet.graph).find((x) => x.id === "rest");
      if (!c) break; // run ended (T22) — a resting run stays silent however long it lasts
      quietState = applyAction(quietState, c.action, quiet.graph).state;
    }

    expect(totalNoise(quietState)).toBe(0);
    expect(totalNoise(loudState)).toBeGreaterThanOrEqual(NOISE_SEARCH);
    expect(totalNoise(loudState)).toBeGreaterThan(totalNoise(quietState));
  });

  it("every resolved turn of a loud run still moves >= 1 tracked system (T13 audit holds)", () => {
    let { state, graph } = startRun(opts, regions, nodes);
    for (let i = 0; i < 30; i++) {
      const choices = availableActions(state, graph);
      const c = choices.find((x) => x.id === "search") ?? choices.find((x) => x.id.startsWith("move:")) ?? choices.find((x) => x.id === "rest");
      if (!c) break;
      const before = state;
      state = applyAction(before, c.action, graph).state;
      expect(auditTurn(before, state).ok).toBe(true);
    }
  });
});
