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
  type RegionGraph,
} from "../../engine/src/index.js";
import { playSession, resumeSession, saveState } from "../src/index.js";

/**
 * T21 — lossless quit/resume at any turn boundary, and a full slice end to end (M1 DoD). Saving after
 * turn n, reconstructing from the save string alone (the graph is rebuilt from content), and
 * continuing must be byte-identical to never having stopped — at *every* boundary, across turn types.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const opts = { seed: "resume-rivermouth", createdAt: "2026-07-05T06:00:00.000Z" };

/** Greedy scavenge/traverse script of length n from a state. */
function scriptFrom(state: GameState, graph: RegionGraph, n: number): string[] {
  const ids: string[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const cs = availableActions(s, graph);
    const c = cs.find((x) => x.id === "search") ?? cs.find((x) => x.id.startsWith("move:")) ?? cs.find((x) => x.id === "rest");
    if (!c) break;
    ids.push(c.id);
    s = applyAction(s, c.action, graph).state;
  }
  return ids;
}

/** Assert: for every prefix length k, save-after-k + resume + finish == the uninterrupted run. */
function assertResumableAtEveryBoundary(state: GameState, graph: RegionGraph, script: readonly string[]): void {
  const straight = playSession(state, graph, script).final;
  for (let k = 0; k <= script.length; k++) {
    const atK = playSession(state, graph, script.slice(0, k)).final;
    const saveText = saveState(atK);
    // reconstruct from the string alone, then finish the remaining choices.
    const resumed = resumeSession(saveText, graph, script.slice(k)).final;
    expect(resumed).toStrictEqual(straight); // byte-identical to never stopping
  }
}

describe("lossless quit/resume at any boundary (T21)", () => {
  it("an explore/scavenge slice resumes identically at every turn boundary", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    const script = scriptFrom(state, graph, 12);
    expect(script.length).toBeGreaterThan(6);
    assertResumableAtEveryBoundary(state, graph, script);
  });

  it("a mid-combat boundary resumes identically (combat is in state)", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    // Seed walkers at the start node so the slice enters a fight, then continues inside it.
    const here = state.player.location;
    const threatened: GameState = { ...state, nodes: { ...state.nodes, [here]: { ...state.nodes[here]!, walkers: 3 } } };
    // fight (enter combat) → strike (still fighting) — a boundary lands mid-fight.
    const script: string[] = [];
    let s = threatened;
    for (let i = 0; i < 4; i++) {
      const cs = availableActions(s, graph);
      const c = cs.find((x) => x.id === "fight") ?? cs.find((x) => x.id === "strike");
      if (!c) break;
      script.push(c.id);
      s = applyAction(s, c.action, graph).state;
    }
    expect(script).toContain("fight");
    // confirm a real mid-combat boundary exists in this script.
    const midCombat = playSession(threatened, graph, script.slice(0, 1)).final;
    expect(midCombat.combat).not.toBeNull();
    assertResumableAtEveryBoundary(threatened, graph, script);
  });

  it("the save string is the sole handoff — a fresh graph reconstructs the same run", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    const script = scriptFrom(state, graph, 8);
    const mid = playSession(state, graph, script.slice(0, 4)).final;
    const rebuiltGraph = startRun(opts, regions, nodes).graph; // a fresh graph from content
    const a = resumeSession(saveState(mid), rebuiltGraph, script.slice(4)).final;
    const b = playSession(state, graph, script).final;
    expect(a).toStrictEqual(b);
  });
});

describe("a full M1 slice runs end to end (T21 · M1 DoD)", () => {
  it("plays Parts 1–3 systems, auditing every turn, lossless each boundary", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    const script = scriptFrom(state, graph, 20);
    let s = state;
    for (const id of script) {
      const before = s;
      const c = availableActions(s, graph).find((x) => x.id === id)!;
      s = applyAction(before, c.action, graph).state;
      expect(auditTurn(before, s).ok).toBe(true); // every resolved turn moved a system (T13)
      expect(loadGame(saveGame(s))).toStrictEqual(s); // safe to quit here (T7/T21)
    }
    // the slice actually exercised the loop: time passed and the pack holds real finds.
    expect(s.meta.turn).toBeGreaterThan(0);
    expect(s.player.inventory.length).toBeGreaterThan(0);
  });
});
