import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  recordHistory,
  stimulusAt,
  tickZombies,
  nextZombieState,
  canClaimShelter,
  canFortifyShelter,
  shelterChoices,
  resolveShelterAction,
  applyShelterRest,
  decayShelterFortification,
  muffleShelterNoise,
  shelterLine,
  scaleByFort,
  SCRAP_ITEM,
  CLAIM_COST,
  FORTIFY_COST,
  FORTIFY_GAIN,
  MAX_FORTIFICATION,
  FORTIFY_DECAY_PER_HOUR,
  SHELTER_REST_BONUS,
  SHELTER_REST_FORT_MAX,
  SHELTER_NOISE_MUFFLE_MAX,
  SHELTER_DETECT_FLOOR_MAX,
  REST_RECOVERY,
  NOISE_SEARCH,
  CHASE_AT,
  ZOMBIE_STALKER,
  type Action,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T37/T38 — Shelter: claim a base, fortify it with loot + time, upkeep decay, and the safety payoff
 * (noise muffle → horde-drift resistance, detection floor, deeper rest). No save-schema rung — the
 * reserved `player.shelterId` / `NodeState.barricades` fields are populated. Deterministic, integer-only,
 * save-lossless; inert on every prior (unsheltered) run.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"] },
];
const opts = { seed: "shelter-seed", createdAt: "2026-07-06T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const HERE = "node.x.a";

const withNode = (s: GameState, id: string, over: Record<string, unknown>): GameState => ({
  ...s,
  nodes: { ...s.nodes, [id]: { ...s.nodes[id]!, ...over } },
});
const withScrap = (s: GameState, qty: number): GameState => ({
  ...s,
  player: { ...s.player, inventory: [{ type: SCRAP_ITEM, quantity: qty }] },
});
const withShelter = (s: GameState, id: string | null): GameState => ({
  ...s,
  player: { ...s.player, shelterId: id as GameState["player"]["shelterId"] },
});
const withFatigue = (s: GameState, f: number): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, fatigue: f } } },
});
const searched = (s: GameState, id = HERE): GameState => withNode(s, id, { searchPct: 100 });
const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id);
const take = (s: GameState, g: RegionGraph, id: string) => {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (!c) throw new Error(`choice "${id}" not offered; got: ${ids(availableActions(s, g)).join(",")}`);
  return applyAction(s, c.action, g);
};

function assertIntegers(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`${path}: non-integer ${value}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => assertIntegers(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertIntegers(v, `${path}.${k}`);
  }
}

// --- T37: claim gate --------------------------------------------------------------------------

describe("claim gate — one base per run, secure it first (T37 · FR-SHL-01)", () => {
  it("is NOT offered on a fresh, unsearched node (keeps the T12 start-node choice set unchanged)", () => {
    const { state, graph } = run();
    expect(ids(availableActions(state, graph))).not.toContain("claim-shelter");
    expect(canClaimShelter(state)).toBe(false);
  });

  it("is offered once the node is searched clean and you have no shelter yet", () => {
    const { state, graph } = run();
    const s = searched(state);
    expect(canClaimShelter(s)).toBe(true);
    expect(ids(availableActions(s, graph))).toContain("claim-shelter");
  });

  it("is not offered when you already hold a shelter (one active shelter per run)", () => {
    const { state, graph } = run();
    const s = withShelter(searched(state), "node.x.b");
    expect(canClaimShelter(s)).toBe(false);
    expect(ids(availableActions(s, graph))).not.toContain("claim-shelter");
  });
});

// --- T37: claim effect ------------------------------------------------------------------------

describe("claiming a base (T37 · FR-SHL-01)", () => {
  it("sets shelterId, spends CLAIM_COST hours, is a resolved player-changing turn, and logs the beat", () => {
    const { state, graph } = run();
    const s = searched(state);
    const res = applyAction(s, { type: "claim-shelter", choiceId: "claim-shelter", timeCost: CLAIM_COST }, graph);
    expect(res.state.player.shelterId).toBe(HERE);
    expect(res.state.meta.hour).toBe(s.meta.hour + CLAIM_COST);
    expect(res.changed).toContain("player"); // not a no-op turn (FR-CORE-04)
    expect(recordHistory(s, res.state).map((e) => e.type)).toContain("shelter.claimed");
  });

  it("after claiming, claim is gone and the scene reads the base as yours", () => {
    const { state, graph } = run();
    const claimed = withShelter(searched(state), HERE);
    expect(ids(availableActions(claimed, graph))).not.toContain("claim-shelter");
    expect(sceneOf(claimed, graph).narration).toContain("your shelter");
    expect(shelterLine(claimed)).toContain("newly claimed");
  });

  it("resolveShelterAction is inert when the gate is closed (no double-claim, no unsearched claim)", () => {
    const { state } = run();
    expect(resolveShelterAction(state, { type: "claim-shelter" })).toBe(state); // unsearched
    const held = withShelter(searched(state), "node.x.b");
    expect(resolveShelterAction(held, { type: "claim-shelter" })).toBe(held); // already have one
  });
});

// --- T37/T38: deeper rest ---------------------------------------------------------------------

describe("deeper rest at the base, scaling with fortification (T37 core, T38 scaling)", () => {
  const rest: Action = { type: "rest", choiceId: "rest", timeCost: 6 };

  it("recovers exactly SHELTER_REST_BONUS extra fatigue at a bare claimed base", () => {
    const { state } = run();
    const base = withShelter(withFatigue(state, 90), HERE);
    const after = applyShelterRest(base, rest);
    expect(base.player.condition.needs.fatigue - after.player.condition.needs.fatigue).toBe(SHELTER_REST_BONUS);
  });

  it("scales with fortification: a full base recovers SHELTER_REST_BONUS + SHELTER_REST_FORT_MAX extra", () => {
    const { state } = run();
    const base = withShelter(withNode(withFatigue(state, 95), HERE, { barricades: 100 }), HERE);
    const after = applyShelterRest(base, rest);
    expect(base.player.condition.needs.fatigue - after.player.condition.needs.fatigue).toBe(
      SHELTER_REST_BONUS + scaleByFort(SHELTER_REST_FORT_MAX, 100),
    );
  });

  it("is inert away from the base, on a non-rest action, and with no shelter", () => {
    const { state } = run();
    const away = withShelter(withFatigue(state, 90), "node.x.b"); // shelter elsewhere, resting here
    expect(applyShelterRest(away, rest)).toBe(away);
    const atBase = withShelter(withFatigue(state, 90), HERE);
    expect(applyShelterRest(atBase, { type: "search", timeCost: 3 })).toBe(atBase);
    const tiredNoShelter = withFatigue(state, 90); // shelterId null
    expect(applyShelterRest(tiredNoShelter, rest)).toBe(tiredNoShelter);
  });

  it("through the pipeline, a rest at the base leaves less fatigue than the same rest without one", () => {
    const { state, graph } = run();
    const tired = withFatigue(state, 90);
    const atBase = take(withShelter(tired, HERE), graph, "rest").state;
    const noBase = take(tired, graph, "rest").state;
    expect(atBase.player.condition.needs.fatigue).toBeLessThan(noBase.player.condition.needs.fatigue);
    expect(noBase.player.condition.needs.fatigue - atBase.player.condition.needs.fatigue).toBe(SHELTER_REST_BONUS);
  });
});

// --- T38: fortify gate + effect ---------------------------------------------------------------

describe("fortify gate + effect (T38 · FR-SHL-02)", () => {
  it("is offered only at your own shelter, carrying scrap, below full", () => {
    const { state, graph } = run();
    const atBase = withScrap(withShelter(state, HERE), 2);
    expect(canFortifyShelter(atBase)).toBe(true);
    expect(ids(availableActions(atBase, graph))).toContain("fortify");
    // no scrap
    expect(canFortifyShelter(withShelter(state, HERE))).toBe(false);
    // away from the base (shelter is node.x.b, standing on node.x.a)
    expect(canFortifyShelter(withScrap(withShelter(state, "node.x.b"), 2))).toBe(false);
    // already at full fortification
    expect(canFortifyShelter(withScrap(withShelter(withNode(state, HERE, { barricades: 100 }), HERE), 2))).toBe(false);
  });

  it("spends one scrap and raises barricades by FORTIFY_GAIN, capped at MAX_FORTIFICATION", () => {
    const { state } = run();
    const atBase = withScrap(withShelter(state, HERE), 2);
    const once = resolveShelterAction(atBase, { type: "fortify" });
    expect(once.nodes[HERE]!.barricades).toBe(FORTIFY_GAIN);
    expect(once.player.inventory.find((e) => e.type === SCRAP_ITEM)!.quantity).toBe(1);
    // near the cap it clamps, never overshoots 100
    const high = withScrap(withShelter(withNode(state, HERE, { barricades: 90 }), HERE), 2);
    expect(resolveShelterAction(high, { type: "fortify" }).nodes[HERE]!.barricades).toBe(MAX_FORTIFICATION);
  });

  it("through the pipeline, fortify changes nodes + player and logs shelter.fortified on a real rise", () => {
    const { state, graph } = run();
    const atBase = withScrap(withShelter(state, HERE), 2);
    const res = applyAction(atBase, { type: "fortify", choiceId: "fortify", timeCost: FORTIFY_COST }, graph);
    expect(res.changed).toContain("nodes");
    expect(res.changed).toContain("player");
    // net barricades = +FORTIFY_GAIN then − upkeep decay over the fortify hours (still a rise)
    expect(res.state.nodes[HERE]!.barricades).toBe(FORTIFY_GAIN - FORTIFY_DECAY_PER_HOUR * FORTIFY_COST);
    expect(recordHistory(atBase, res.state).map((e) => e.type)).toContain("shelter.fortified");
  });
});

// --- T38: upkeep decay ------------------------------------------------------------------------

describe("upkeep decay — fortification bleeds and must be topped up (T38 · FR-SHL-02)", () => {
  it("erodes barricades by FORTIFY_DECAY_PER_HOUR per hour, floored at 0", () => {
    const { state } = run();
    const base = withShelter(withNode(state, HERE, { barricades: 50 }), HERE);
    expect(decayShelterFortification(base, 6).nodes[HERE]!.barricades).toBe(50 - FORTIFY_DECAY_PER_HOUR * 6);
    const low = withShelter(withNode(state, HERE, { barricades: 2 }), HERE);
    expect(decayShelterFortification(low, 10).nodes[HERE]!.barricades).toBe(0); // floored
  });

  it("is inert at 0 hours, with no shelter, and at 0 barricades (prior runs untouched)", () => {
    const { state } = run();
    const base = withShelter(withNode(state, HERE, { barricades: 50 }), HERE);
    expect(decayShelterFortification(base, 0)).toBe(base);
    const decayNoShelter = withNode(state, HERE, { barricades: 50 }); // shelterId null
    expect(decayShelterFortification(decayNoShelter, 6)).toBe(decayNoShelter);
    const decayBareBase = withShelter(state, HERE); // barricades 0
    expect(decayShelterFortification(decayBareBase, 6)).toBe(decayBareBase);
  });

  it("neglect: resting several turns at the base drains fortification over time", () => {
    const { state, graph } = run();
    let s = withScrap(withShelter(searched(state), HERE), 4);
    s = take(s, graph, "fortify").state; // put some barricades up
    s = take(s, graph, "fortify").state;
    const peak = s.nodes[HERE]!.barricades;
    for (let i = 0; i < 5; i++) s = take(s, graph, "rest").state; // neglect (rest, don't fortify)
    expect(s.nodes[HERE]!.barricades).toBeLessThan(peak);
  });
});

// --- T38: noise muffle → horde-drift resistance -----------------------------------------------

describe("noise muffle at a fortified base (T38 · dampen node noise + resist horde drift)", () => {
  it("reduces the shelter node's noise by scaleByFort(MAX, barricades); inert without fortification", () => {
    const { state } = run();
    const loud = withShelter(withNode(state, HERE, { noise: 40, barricades: 100 }), HERE);
    expect(muffleShelterNoise(loud, 2).nodes[HERE]!.noise).toBe(40 - scaleByFort(SHELTER_NOISE_MUFFLE_MAX, 100));
    const bare = withShelter(withNode(state, HERE, { noise: 40, barricades: 0 }), HERE);
    expect(muffleShelterNoise(bare, 2)).toBe(bare); // no fortification, no muffle
    const muffleNoShelter = withNode(state, HERE, { noise: 40 }); // shelterId null
    expect(muffleShelterNoise(muffleNoShelter, 2)).toBe(muffleNoShelter);
  });

  it("a fortified base ends a loud search quieter than an unfortified one (less to draw a horde)", () => {
    const { state, graph } = run();
    const seed = withNode(searched(state, "node.x.b"), HERE, { searchPct: 0 }); // searchable here
    const fortified = withNode(withShelter(seed, HERE), HERE, { barricades: 100 });
    const plain = withShelter(withNode(seed, HERE, { barricades: 0 }), "node.x.b");
    const nF = take(fortified, graph, "search").state.nodes[HERE]!.noise;
    const nP = take(plain, graph, "search").state.nodes[HERE]!.noise;
    expect(nF).toBeLessThan(nP);
    expect(nP).toBe(NOISE_SEARCH); // the plain node keeps the full deposit
  });
});

// --- T38: detection floor ---------------------------------------------------------------------

describe("detection floor at a fortified base (T38 · raise the floor vs night hunters)", () => {
  it("reduces stimulus at the shelter by exactly scaleByFort(DETECT_FLOOR_MAX, barricades)", () => {
    const { state, graph } = run();
    const atNode = { ...state, player: { ...state.player, location: HERE } };
    const fort = withNode(withShelter(atNode, HERE), HERE, { walkers: 2, barricades: 100 });
    const bare = withShelter(withNode(atNode, HERE, { walkers: 2, barricades: 100 }), "node.x.b"); // not the shelter
    const sFort = stimulusAt(fort, HERE, fort.nodes[HERE]!, graph);
    const sBare = stimulusAt(bare, HERE, bare.nodes[HERE]!, graph);
    expect(sBare - sFort).toBe(scaleByFort(SHELTER_DETECT_FLOOR_MAX, 100));
  });

  it("a fully fortified base does not rouse from the player's mere presence by day", () => {
    const { state, graph } = run();
    const atNode = { ...state, player: { ...state.player, location: HERE }, meta: { ...state.meta, phase: "midday" as const } };
    const fort = withNode(withShelter(atNode, HERE), HERE, { walkers: 3, zombieState: "dormant" });
    const bare = withShelter(withNode(atNode, HERE, { walkers: 3, zombieState: "dormant" }), "node.x.b");
    const rousedFort = tickZombies(withNode(fort, HERE, { barricades: 100 }), 6, graph).nodes[HERE]!.zombieState;
    const rousedBare = tickZombies(withNode(bare, HERE, { barricades: 0 }), 6, graph).nodes[HERE]!.zombieState;
    expect(rousedBare).toBe("chasing"); // an unprotected node wakes onto the player
    expect(["dormant", "hibernating"]).toContain(rousedFort); // the fortified base stays quiet
  });

  it("a stalker at night is reduced, never nullified — fortification helps, not god-mode", () => {
    const { state, graph } = run();
    const night = { ...state, player: { ...state.player, location: HERE }, meta: { ...state.meta, phase: "night" as const } };
    const stalkerNode = { walkers: 1, zombieTypes: [ZOMBIE_STALKER] };
    const fort = withNode(withShelter(night, HERE), HERE, { ...stalkerNode, barricades: 100 });
    const bare = withShelter(withNode(night, HERE, { ...stalkerNode, barricades: 100 }), "node.x.b");
    const sFort = stimulusAt(fort, HERE, fort.nodes[HERE]!, graph);
    const sBare = stimulusAt(bare, HERE, bare.nodes[HERE]!, graph);
    expect(sFort).toBeLessThan(sBare); // reduced
    expect(sFort).toBeGreaterThan(0); // never nullified — a stalker at night still hunts
  });
});

// --- determinism, save-lossless, integer-only, inert-on-old-state ------------------------------

describe("shelter is deterministic, save-lossless, integer-only (ADR-0001)", () => {
  const slice = (): GameState => {
    const { state, graph } = run();
    let s = withScrap(state, 3);
    s = take(s, graph, "search").state;
    s = take(s, graph, "search").state;
    s = take(s, graph, "search").state; // searched clean
    s = take(s, graph, "claim-shelter").state;
    s = take(s, graph, "fortify").state;
    s = take(s, graph, "rest").state;
    return s;
  };

  it("a search→claim→fortify→rest slice is byte-identical from its seed", () => {
    expect(JSON.stringify(slice())).toBe(JSON.stringify(slice()));
  });

  it("round-trips losslessly through save/load with a claimed, fortified base (no schema rung)", () => {
    const s = slice();
    expect(s.player.shelterId).toBe(HERE);
    expect(s.nodes[HERE]!.barricades).toBeGreaterThan(0);
    expect(loadGame(saveGame(s))).toStrictEqual(s);
  });

  it("every numeric leaf is an integer after the slice", () => {
    assertIntegers(slice());
  });

  it("property: scaleByFort is an integer in [0, max] for any barricade level", () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 140 }), fc.integer({ min: 0, max: 100 }), (b, max) => {
        const v = scaleByFort(max, b);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(max);
      }),
    );
  });

  it("all shelter effects are inert on an unsheltered state (every prior run untouched)", () => {
    const { state } = run();
    const s = withNode(state, HERE, { noise: 40, barricades: 0 }); // shelterId null
    expect(decayShelterFortification(s, 6)).toBe(s);
    expect(muffleShelterNoise(s, 6)).toBe(s);
    expect(applyShelterRest(s, { type: "rest", timeCost: 6 })).toBe(s);
    expect(shelterChoices(s)).toStrictEqual([]);
    expect(shelterLine(s)).toBeNull();
  });
});
