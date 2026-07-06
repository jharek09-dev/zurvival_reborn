import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  auditTurn,
  availableActions,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../../engine/src/index.js";

/**
 * Integration (T13 · FR-CORE-04 · PRD §6.1): the "telemetry audit of 100 turns" acceptance
 * criterion, run by machine over the *shipped* Rivermouth content. A deterministic 100-turn
 * playthrough is audited turn by turn; the run passes only if EVERY resolved turn moved at least
 * one tracked system — no no-consequence turns.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

/**
 * A deterministic survival-aware survivor: stay alive first (drink, eat, treat when offered), then
 * explore — search, move, rest. Since T22 the loop is mortal, so a heedless survivor would die of
 * thirst; this one manages needs and lasts as long as the finite region can sustain them.
 */
function pickChoice(state: GameState, graph: ReturnType<typeof startRun>["graph"]) {
  const choices = availableActions(state, graph);
  return (
    choices.find((c) => c.id === "drink") ??
    choices.find((c) => c.id === "eat") ??
    choices.find((c) => c.id === "treat") ??
    choices.find((c) => c.id === "search") ??
    choices.find((c) => c.id.startsWith("move:")) ??
    choices.find((c) => c.id === "rest") ??
    choices[0]
  );
}

describe("100-turn telemetry audit over Rivermouth (T13)", () => {
  const regions = load<RegionDef>("regions");
  const nodes = load<NodeDef>("nodes");

  it("every resolved turn of a survival run (up to 100) changes >= 1 tracked system", () => {
    let { state, graph } = startRun({ seed: "audit-100", createdAt: "2026-07-05T00:00:00Z" }, regions, nodes);

    let resolved = 0;
    const violations: Array<{ turn: number; systems: readonly string[] }> = [];

    for (let i = 0; i < 100; i++) {
      const choice = pickChoice(state, graph);
      if (!choice) break; // the run ended (death / no actions) — audit what actually happened
      const before = state;
      const res = applyAction(before, choice.action, graph);
      state = res.state;

      const audit = auditTurn(before, state);
      expect(res.changed).toEqual(audit.changedSystems); // pipeline telemetry == fresh audit
      if (audit.resolved) {
        resolved++;
        if (!audit.ok) violations.push({ turn: audit.turn, systems: audit.changedSystems });
      }
    }

    expect(resolved).toBeGreaterThanOrEqual(20); // a substantial multi-turn audit really ran
    expect(violations).toEqual([]); // FR-CORE-04: no no-consequence turns, however long the run
    expect(state.meta.turn).toBe(resolved); // every resolved turn advanced the clock
  });
});
