import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type RegionGraph,
  type DifficultyMode,
} from "../../engine/src/index.js";
import { renderCodex, renderDepthScreen } from "../src/index.js";

/**
 * T56 — the difficulty floor must be SURFACED to the player (reachable AND surfaced, the design-audit
 * lens · GDD XVI). It rides the Codex (L) depth screen's "This run" readout so a returning player
 * re-orients (ACCESSIBILITY §6), words-only (no dial number leaks, FR-UI-02), and the screen stays a
 * free read-only overlay (the T54 invariant). Selection at boot is covered by the engine `startRun` opts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const npcs = load<NPCDef>("npcs");
const encounters = load<EncounterDef>("encounters");
const signals = load<SignalDef>("radio");
const recipes = load<RecipeDef>("recipes");
const jobs = load<JobDef>("jobs");
const factions = load<FactionDef>("factions");

function run(difficulty?: DifficultyMode, ironman?: boolean): { state: GameState; graph: RegionGraph } {
  return startRun(
    {
      seed: "diff-surface",
      createdAt: "2026-07-18T06:00:00.000Z",
      ...(difficulty ? { difficulty } : {}),
      ...(ironman ? { ironman } : {}),
    },
    regions,
    nodes,
    npcs,
    [],
    encounters,
    signals,
    recipes,
    jobs,
    factions,
  );
}

/** The rows of the Codex "This run:" section (its header line to the next blank line). */
function thisRunRows(lines: readonly string[]): string[] {
  const i = lines.findIndex((l) => l.trim() === "This run:");
  if (i === -1) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && lines[j]!.trim() !== ""; j++) out.push(lines[j]!);
  return out;
}

const DIGIT = /[0-9]/;
const ESC = String.fromCharCode(27);

describe("T56 — difficulty surfaced in the Codex (reachable AND surfaced · GDD XVI)", () => {
  it("defaults to Survivor with a words-only gloss and no Ironman line", () => {
    const { state, graph } = run();
    const rows = thisRunRows(renderCodex(state, graph));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.join("\n")).toContain("Survivor");
    expect(DIGIT.test(rows.join(" "))).toBe(false); // no dial number leaks into the readout
    expect(rows.join("\n")).not.toContain("Ironman");
  });

  it("shows the chosen mode label + gloss for every mode, words-only", () => {
    for (const m of ["story", "hardcore", "nightmare"] as DifficultyMode[]) {
      const { state, graph } = run(m);
      const rows = thisRunRows(renderCodex(state, graph)).join("\n");
      expect(rows.toLowerCase()).toContain(m);
      expect(DIGIT.test(rows)).toBe(false);
    }
  });

  it("surfaces Ironman only when chosen, words-only", () => {
    const { state, graph } = run("nightmare", true);
    const on = thisRunRows(renderCodex(state, graph)).join("\n");
    expect(on).toContain("Nightmare");
    expect(on).toContain("Ironman");
    expect(on).toContain("no take-backs");
    // Honesty (design audit): state the rule + who enforces it; don't assert permadeath the demo can't deliver.
    expect(on.toLowerCase()).toContain("full client");
    expect(on).not.toContain("Death is final.");
    expect(DIGIT.test(on)).toBe(false);
  });

  it("the Codex is a free overlay — rendering it mutates no state (T54 invariant holds)", () => {
    const { state, graph } = run("hardcore", true);
    const snap = JSON.stringify(state);
    renderDepthScreen("codex", state, graph);
    expect(JSON.stringify(state)).toBe(snap);
  });

  it("carries no ANSI escape sequences", () => {
    const { state, graph } = run("nightmare");
    expect(renderCodex(state, graph).join("\n")).not.toContain(ESC);
  });
});
