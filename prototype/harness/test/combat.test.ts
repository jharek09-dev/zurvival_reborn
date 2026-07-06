import { describe, expect, it } from "vitest";
import {
  applyAction,
  auditTurn,
  availableActions,
  loadGame,
  saveGame,
  startRun,
  FIRE_NOISE,
  type GameState,
  type NodeDef,
  type Player,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";

/**
 * Integration (T15 · FR-CBT-01/02/04/05): the combat/stealth loop played through the first client.
 * A hand-built district with walkers proves, end to end, that an encounter is avoidable via stealth,
 * that a fight is turn-based and lossless to save mid-swing, and that a firearm is the loud option.
 */

const REGIONS: RegionDef[] = [{ id: "region.d", name: "District", description: "a contested block" }];
const NODES: NodeDef[] = [
  { id: "node.d.gate", regionId: "region.d", name: "Gate", description: "the way in", adjacent: ["node.d.yard"], start: true },
  { id: "node.d.yard", regionId: "region.d", name: "Yard", description: "an open yard", adjacent: ["node.d.gate", "node.d.store"], walkers: 1 },
  { id: "node.d.store", regionId: "region.d", name: "Store", description: "a stripped shop", adjacent: ["node.d.yard"] },
];
const opts = { seed: "harness-combat", createdAt: "2026-07-05T00:00:00Z" };
const armed = (p: Player): Player => ({ ...p, inventory: [{ type: "item.pistol", quantity: 1 }, { type: "item.ammo", quantity: 2 }] });

function take(state: GameState, graph: RegionGraph, id: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === id);
  if (!c) throw new Error(`no choice ${id}; offered ${availableActions(state, graph).map((x) => x.id)}`);
  return applyAction(state, c.action, graph).state;
}

describe("combat/stealth over a hand-built district (T15)", () => {
  it("a survivor can move up to the walkers and slip past them without a fight", () => {
    let { state, graph } = startRun(opts, REGIONS, NODES);
    state = take(state, graph, "move:node.d.yard"); // enter the contested yard
    const ids = availableActions(state, graph).map((c) => c.id);
    expect(ids).toContain("fight");
    expect(ids.some((i) => i.startsWith("slip:"))).toBe(true);
    state = take(state, graph, "slip:node.d.store"); // choose stealth
    expect(state.combat).toBeNull();
    expect(state.player.location).toBe("node.d.store");
  });

  it("a fight resolves turn by turn and stays autosave-lossless throughout", () => {
    let { state, graph } = startRun(opts, REGIONS, NODES);
    state = take(state, graph, "move:node.d.yard");
    state = take(state, graph, "fight");
    let guard = 0;
    while (state.combat !== null && guard++ < 20) {
      const before = state;
      state = take(state, graph, "strike");
      expect(auditTurn(before, state).ok).toBe(true); // never a no-op turn
      expect(loadGame(saveGame(state))).toStrictEqual(state); // safe to stop mid-fight
    }
    expect(state.combat).toBeNull();
    expect(state.nodes["node.d.yard"]!.walkers).toBe(0); // the lone walker is down
  });

  it("the firearm ends it fast and loud", () => {
    let { state, graph } = startRun(opts, REGIONS, NODES);
    state = { ...state, player: armed(state.player) };
    state = take(state, graph, "move:node.d.yard");
    const fired = take(state, graph, "fire");
    expect(fired.nodes["node.d.yard"]!.noise).toBeGreaterThanOrEqual(FIRE_NOISE); // region-loud
    expect(fired.combat).toBeNull(); // one shot, one walker
    expect(fired.player.inventory.find((e) => e.type === "item.ammo")!.quantity).toBe(1);
  });
});
