import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ACTIVE_ENCOUNTER_QUEST,
  HORDE_AWARENESS,
  HORDE_DISABLED_FLAG,
  HORDE_MAX_SIZE,
  HORDE_MIN_SIZE,
  OVERRUN_ESCAPE_FLOOR,
  OVERRUN_FLEE_COST,
  OVERRUN_HOLD_COST,
  OVERRUN_MAX_WOUNDS,
  OVERRUN_WOUND_PER,
  ZOMBIE_WALKER,
  applyAction,
  availableActions,
  detectChance,
  evaluateEvents,
  isOverrun,
  loadGame,
  overrunChoices,
  overrunEscapeChance,
  overrunNarration,
  overrunsPlayer,
  overrunWounds,
  recordHistory,
  resolveOverrunAction,
  saveGame,
  sceneOf,
  startRun,
  withRoster,
  type GameState,
  type Horde,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T76 — the horde collision. A mass standing on the player is not a fight: FR-CBT-08 says routed,
 * funneled or fled, never out-traded, and through T75 that requirement passed only because the horde
 * had no teeth at all. Here the only verbs are run and go to ground, the escape roll is floored well
 * above the ordinary stealth roll, and a hit lands one wound per {@link OVERRUN_WOUND_PER} bodies —
 * which makes being overrun the game's sharpest infection vector, and finally gives `FIRE_NOISE 75` a
 * bill.
 */

// A five-node line n0—n1—n2—n3—n4, start at n0, region density 40.
const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 40, loot: 50 } }];
const NODES: NodeDef[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `node.x.${i}`,
  regionId: "region.x",
  name: `N${i}`,
  description: `n${i}`,
  adjacent: [i - 1, i + 1].filter((j) => j >= 0 && j <= 4).map((j) => `node.x.${j}`),
  ...(i === 0 ? { start: true } : {}),
}));
const boot = (seed = "overrun-seed"): { state: GameState; graph: RegionGraph } =>
  startRun({ seed, createdAt: "2026-09-12T00:00:00Z" }, REGIONS, NODES);

const horde = (pos: string, size = 24, patch: Partial<Horde> = {}): Horde => ({
  id: "horde.1", size, pos, dest: null, speed: 1, awareness: HORDE_AWARENESS, types: [ZOMBIE_WALKER], ...patch,
});
/** Stand the player at `at` with a mass of `size` on top of them, on a fully-revealed map. */
const overrunAt = (state: GameState, at: string, size = 24): GameState => ({
  ...state,
  player: { ...state.player, location: at },
  nodes: Object.fromEntries(Object.entries(state.nodes).map(([id, n]) => [id, { ...n, discovered: true }])),
  hordes: [horde(at, size)],
});
const ids = (s: GameState, g: RegionGraph): readonly string[] => availableActions(s, g).map((c) => c.id);
const take = (s: GameState, g: RegionGraph, id: string): GameState => {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (c === undefined) throw new Error(`choice "${id}" not offered; got: ${ids(s, g).join(",")}`);
  return applyAction(s, c.action, g).state;
};
const woundCount = (s: GameState): number => s.player.condition.wounds.length;

describe("the mass pre-empts every other choice (T76 · FR-CBT-08)", () => {
  it("offers flight and the hold, and NO fight — not even at a node full of walkers", () => {
    const { state, graph } = boot();
    const s = withRoster0(overrunAt(state, "node.x.1"), "node.x.1", 4);
    expect(isOverrun(s)).toBe(true);
    // Discriminates against the unfixed code, which offered `fight` / `fire` / `slip:…` here: a node
    // with walkers on it took the T15 encounter branch and the horde was not consulted at all.
    expect(ids(s, graph)).toStrictEqual(["flee:node.x.0", "flee:node.x.2", "hold"]);
  });

  it("pre-empts a fight already in progress — a mass does not queue behind your duel", () => {
    const { state, graph } = boot();
    const base = withRoster0(overrunAt(state, "node.x.1"), "node.x.1", 2);
    const mid: GameState = { ...base, combat: { node: "node.x.1", enemy: "enemy.walker", hp: 2, maxHp: 3, alerted: true } };
    expect(ids(mid, graph)).not.toContain("strike");
    expect(ids(mid, graph)).toContain("hold");
    // and whichever verb the player takes ENDS that fight
    expect(take(mid, graph, "hold").combat).toBeNull();
    expect(take(mid, graph, "flee:node.x.0").combat).toBeNull();
  });

  it("NEVER hands back an empty choice list, even with every neighbour still fogged", () => {
    // The softlock guard. `escapeTargets` filters on `discovered`, so a node whose neighbours are all
    // hidden yields no flight at all — and an empty `availableActions` is a hard softlock (the
    // PL-M5-14 class of bug T75 found in the explore branch and did not create).
    const { state, graph } = boot();
    const fogged: GameState = {
      ...overrunAt(state, "node.x.1"),
      nodes: Object.fromEntries(Object.entries(state.nodes).map(([id, n]) => [id, { ...n, discovered: id === "node.x.1" }])),
    };
    expect(overrunChoices(fogged, graph).map((c) => c.id)).toStrictEqual(["hold"]);
    expect(availableActions(fogged, graph)).toHaveLength(1);
  });

  it("is off entirely when the layer is disabled — collision, history and lead alike", () => {
    const { state, graph } = boot();
    const s = overrunAt(state, "node.x.1");
    const off: GameState = { ...s, world: { ...s.world, flags: { ...s.world.flags, [HORDE_DISABLED_FLAG]: true } } };
    expect(isOverrun(off)).toBe(false);
    expect(ids(off, graph)).not.toContain("hold");
    expect(overrunNarration(off)).toBeNull();
    // …and the three places that read horde POSITION rather than the layer used to leak: a frozen mass
    // went on shutting encounters out of its node, writing Living-History lines the harness renders,
    // and printing "a horde on the move on the next street".
    const near: GameState = { ...off, hordes: [horde("node.x.2")], player: { ...off.player, location: "node.x.1" } };
    expect(sceneOf(near, graph).narration).not.toContain("horde on the move");
    expect(recordHistory(near, off).filter((e) => e.type === "horde.overrun")).toStrictEqual([]);
    // the same arrival WITH the layer on does write the beat, so this is the flag and not the fixture
    const on: GameState = { ...near, world: { ...near.world, flags: {} } };
    expect(recordHistory(on, { ...s, world: { ...s.world, flags: {} } }).filter((e) => e.type === "horde.overrun")).toHaveLength(1);
    // …and the encounter guard, which is the fourth reader of the same rule
    expect(overrunsPlayer(off)).toBe(false);
    expect(overrunsPlayer(s)).toBe(true);
  });

  it("is off after the run has ended — the ending screen offers nothing, not a flight", () => {
    const { state, graph } = boot();
    const s = overrunAt(state, "node.x.1");
    const dead: GameState = {
      ...s,
      player: { ...s.player, condition: { ...s.player.condition, needs: { ...s.player.condition.needs, thirst: 100 } } },
    };
    const ended = applyAction(dead, { type: "wait", timeCost: 1 }, graph).state;
    expect(isOverrun(ended)).toBe(false);
    expect(overrunNarration(ended)).toBeNull();
    expect(availableActions(ended, graph)).toStrictEqual([]);
  });

  it("standing in your OWN claimed shelter is not an overrun — the base assault is T83's", () => {
    const { state, graph } = boot();
    const s = overrunAt(state, "node.x.1");
    const based: GameState = { ...s, player: { ...s.player, shelterId: "node.x.1" } };
    expect(isOverrun(based)).toBe(false);
    expect(overrunNarration(based)).toBeNull();
    expect(ids(based, graph)).not.toContain("hold"); // the ordinary explore branch, in your own base
    // but the sanctuary is the SHELTER, not shelter-ownership — you are not immune out in the street
    const elsewhere: GameState = { ...based, player: { ...based.player, location: "node.x.1", shelterId: "node.x.3" } };
    expect(isOverrun(elsewhere)).toBe(true);
  });

  it("leads the scene, ahead of the fight read it replaces", () => {
    const { state, graph } = boot();
    const s = withRoster0(overrunAt(state, "node.x.1"), "node.x.1", 3);
    const narration = sceneOf(s, graph).narration;
    expect(narration.startsWith("They are on you")).toBe(true);
    expect(narration).toContain("no fighting this");
    // sized in words, never numbers
    expect(overrunNarration(overrunAt(state, "node.x.1", 40))).toContain("a tide of them");
    expect(overrunNarration(overrunAt(state, "node.x.1", 24))).toContain("a crowd of them");
    expect(overrunNarration(overrunAt(state, "node.x.1", 8))).toContain("a knot of them");
  });
});

describe("the verbs refuse when there is no mass on you (T76)", () => {
  it("an unvalidated `hold` on a horde-free map does nothing at all", () => {
    // Pipeline stage 1 validates only an action carrying a `choiceId`, so a bare `{type:"hold"}`
    // reaches the dispatcher on ANY state. Without the precondition it burned a `stealth` draw,
    // cleared `state.combat`, dropped an engaged encounter and landed up to three wounds with no horde
    // anywhere — measured on 16 of 30 seeds before the guard. `resolveStrike`/`resolveFire` are inert
    // in the same situation only because they need `state.combat`; this verb has no such natural
    // precondition.
    for (let k = 0; k < 30; k += 1) {
      const { state, graph } = boot(`unvalidated-${k}`);
      const clear: GameState = {
        ...state,
        hordes: [],
        combat: { node: state.player.location, enemy: "enemy.walker", hp: 2, maxHp: 3, alerted: true },
        player: { ...state.player, quests: [{ id: ACTIVE_ENCOUNTER_QUEST, data: { encounter: "e", stage: "s", node: state.player.location } }] },
      };
      // the resolver directly, so the assertion is about the guard and not about what the other
      // thirteen pipeline stages happen to do on the same turn
      const after = resolveOverrunAction(clear, graph, { type: "hold", timeCost: 1, params: { noise: 0 } });
      expect(after).toBe(clear); // same reference: nothing at all happened
    }
  });

  it("…and neither does a flight taken inside your own shelter", () => {
    const { state, graph } = boot();
    const based: GameState = { ...overrunAt(state, "node.x.1"), player: { ...state.player, location: "node.x.1", shelterId: "node.x.1" } };
    const after = applyAction(based, { type: "flee", timeCost: 2, params: { to: "node.x.0", noise: 5 } }, graph).state;
    expect(after.player.location).toBe("node.x.1");
    expect(after.player.condition.wounds).toHaveLength(0);
  });
});

describe("the escape roll is floored, and the mass sizes the blows (T76)", () => {
  it("floors the detection chance well above the ordinary stealth roll", () => {
    const { state } = boot();
    // Night in fog is the quietest the ordinary roll ever gets — detectChance clamps it to 0.
    const dark: GameState = {
      ...overrunAt(state, "node.x.1"),
      meta: { ...state.meta, phase: "night" },
      world: { ...state.world, weather: "weather.fog" },
    };
    expect(detectChance(0, "night", "weather.fog")).toBeLessThan(OVERRUN_ESCAPE_FLOOR);
    expect(overrunEscapeChance(dark)).toBe(OVERRUN_ESCAPE_FLOOR); // …but the mass is on top of you
    // Concealment can never take it BELOW the floor — night in fog on a loud node is still the floor…
    expect(overrunEscapeChance(withNoise(dark, "node.x.1", 100))).toBe(OVERRUN_ESCAPE_FLOOR);
    // …but a loud node in broad daylight still pushes it above, so the ordinary reads still matter.
    const loudDay = withNoise({ ...overrunAt(state, "node.x.1"), meta: { ...state.meta, phase: "midday" } }, "node.x.1", 100);
    expect(overrunEscapeChance(loudDay)).toBeGreaterThan(OVERRUN_ESCAPE_FLOOR);
  });

  it("scales the wound draw with the headcount: 1 at the size floor, 3 at the ceiling", () => {
    expect(overrunWounds(HORDE_MIN_SIZE)).toBe(1);
    expect(overrunWounds(HORDE_MIN_SIZE + OVERRUN_WOUND_PER)).toBe(2);
    expect(overrunWounds(HORDE_MAX_SIZE)).toBe(OVERRUN_MAX_WOUNDS);
    expect(overrunWounds(10_000)).toBe(OVERRUN_MAX_WOUNDS); // bounded
    expect(overrunWounds(Number.NaN)).toBe(1); // total
  });

  it("a big mass lands strictly more wounds than a small one on the SAME roll", () => {
    // Both arms share seed, rng, node noise, phase and weather, so `overrunEscapeChance` and the single
    // `stealth` draw are identical — the ONLY difference is the headcount. Seeds are searched
    // deterministically for one where the roll is a detection, so the comparison never depends on luck.
    let compared = 0;
    for (let k = 0; k < 60 && compared === 0; k += 1) {
      const { state, graph } = boot(`overrun-${k}`);
      const small = overrunAt(state, "node.x.1", HORDE_MIN_SIZE);
      const big = overrunAt(state, "node.x.1", HORDE_MAX_SIZE);
      const a = take(small, graph, "hold");
      const b = take(big, graph, "hold");
      if (woundCount(a) === 0) continue; // this seed slipped clean; try the next
      expect(woundCount(a)).toBe(1);
      expect(woundCount(b)).toBe(OVERRUN_MAX_WOUNDS);
      compared += 1;
    }
    expect(compared).toBe(1); // a 0.6-floored roll must detect within 60 seeds
  });

  it("spreads a multi-wound draw across distinct sites rather than stacking one arm", () => {
    for (let k = 0; k < 60; k += 1) {
      const { state, graph } = boot(`sites-${k}`);
      const after = take(overrunAt(state, "node.x.1", HORDE_MAX_SIZE), graph, "hold");
      const w = after.player.condition.wounds;
      if (w.length < OVERRUN_MAX_WOUNDS) continue;
      expect(new Set(w.map((x) => x.site)).size).toBe(OVERRUN_MAX_WOUNDS);
      return;
    }
    throw new Error("no 3-wound overrun in 60 seeds — the floored roll should produce one");
  });

  it("a clean escape costs nothing but the hours — you always get out either way", () => {
    // Over many seeds, both outcomes occur and NEITHER ever fails to resolve the turn.
    let clean = 0, mauled = 0;
    for (let k = 0; k < 40; k += 1) {
      const { state, graph } = boot(`clean-${k}`);
      const after = take(overrunAt(state, "node.x.2"), graph, "flee:node.x.1");
      expect(after.player.location).toBe("node.x.1"); // the flight ALWAYS relocates (FR-CBT-05)
      if (woundCount(after) === 0) clean += 1; else mauled += 1;
    }
    expect(clean).toBeGreaterThan(0);
    expect(mauled).toBeGreaterThan(clean); // …but the floor means the mass usually gets a hand on you
  });

  it("the hold spends an hour and leaves you where you stand, still overrun", () => {
    const { state, graph } = boot();
    const s = overrunAt(state, "node.x.2");
    const after = take(s, graph, "hold");
    expect(after.player.location).toBe("node.x.2");
    expect(after.meta.hour).toBe((state.meta.hour + OVERRUN_HOLD_COST) % 24);
    // fleeing is the more expensive verb — going to ground is cheap and worse
    expect(OVERRUN_HOLD_COST).toBeLessThan(OVERRUN_FLEE_COST);
  });
});

describe("every reader branches on the same rule (T76)", () => {
  // `overrunsPlayer` is the single definition — layer enabled, not in your own shelter, a mass here —
  // and four systems read it: the choice list, the encounter opener, the Living History, and the
  // harness soundscape's dread read. Each of the three engine ones is checked against it directly,
  // because the audit found two of them open-coding the position test alone and therefore disagreeing
  // with the collision they were supposed to be reporting.
  const enc = { id: "encounter.quiet", category: "ambient", stages: [{ id: "s1", narration: "…", choices: [] }] } as never;
  const pooled = () => startRun({ seed: "guard", createdAt: "2026-09-12T00:00:00Z" }, REGIONS, NODES, [], [], [enc]);

  it("a frozen mass does not shut encounters out of the node it is stuck on", () => {
    const { state, graph } = pooled();
    const at = "node.x.1";
    const live: GameState = { ...state, player: { ...state.player, location: at }, hordes: [horde(at)] };
    const off: GameState = { ...live, world: { ...live.world, flags: { [HORDE_DISABLED_FLAG]: true } } };
    expect(evaluateEvents(live, graph)).toBe(live); // an ENABLED mass shuts the node
    expect(evaluateEvents(off, graph)).not.toBe(off); // a frozen one must not
  });

  it("a mass crossing your own claimed shelter neither pre-empts nor suppresses nor is logged", () => {
    // Where the collision cannot happen, nothing downstream may behave as though it did. The audit
    // found the log narrating "a horde came down on you in the open" for a mass walking over the base
    // while `isOverrun` was false and the player took nothing.
    const { state, graph } = pooled();
    const at = "node.x.1";
    const based: GameState = { ...state, player: { ...state.player, location: at, shelterId: at }, hordes: [horde(at)] };
    const beforeArrival: GameState = { ...based, hordes: [horde("node.x.2")] };
    expect(isOverrun(based)).toBe(false);
    expect(overrunsPlayer(based)).toBe(false);
    expect(recordHistory(beforeArrival, based).filter((e) => e.type === "horde.overrun")).toStrictEqual([]);
    expect(evaluateEvents(based, graph)).not.toBe(based); // beats still fire in your own base
  });

  it("a hand-edited NaN horde size cannot reach state.history, or the save", () => {
    const { state } = boot();
    const at = "node.x.1";
    const bad: GameState = { ...state, player: { ...state.player, location: at }, hordes: [horde(at, Number.NaN as number)] };
    const from: GameState = { ...bad, hordes: [horde("node.x.2", Number.NaN as number)] };
    const beat = recordHistory(from, bad).find((e) => e.type === "horde.overrun");
    expect(beat).toBeDefined();
    expect((beat!.data as { mass: number }).mass).toBe(0);
    expect(Number.isNaN((beat!.data as { mass: number }).mass)).toBe(false);
    // a NaN here would serialize to null and load back as null — a lossy save
    const withBeat: GameState = { ...bad, history: [beat!] };
    expect(saveGame(withBeat)).not.toContain('"mass":null');
    expect(loadGame(saveGame(withBeat)).history).toStrictEqual([beat]);
  });
});

describe("what the overrun does to a beat in progress (T76)", () => {
  it("abandons an engaged encounter WITHOUT stamping its done-flag, so it stays eligible", () => {
    const { state, graph } = boot();
    const engaged: GameState = {
      ...overrunAt(state, "node.x.1"),
      player: {
        ...state.player,
        location: "node.x.1",
        quests: [{ id: ACTIVE_ENCOUNTER_QUEST, data: { encounter: "encounter.test", stage: "s1", node: "node.x.1" } }],
      },
    };
    const flagsBefore = Object.keys(engaged.player.flags).length;
    const after = take(engaged, graph, "hold");
    expect(after.player.quests.some((q) => q.id === ACTIVE_ENCOUNTER_QUEST)).toBe(false);
    expect(Object.keys(after.player.flags).length).toBe(flagsBefore); // interrupted, not completed
  });

  it("evaluateEvents refuses to OPEN an encounter at a node a mass is standing on", () => {
    // The other half of the same guard: without it a beat engaged on the overrun turn would be
    // unanswerable until the mass wandered off, because the overrun pre-empts its choices.
    const enc = {
      id: "encounter.quiet", category: "ambient", stages: [{ id: "s1", narration: "…", choices: [] }],
    } as never;
    const withPool = startRun({ seed: "ev", createdAt: "2026-09-12T00:00:00Z" }, REGIONS, NODES, [], [], [enc]);
    const clear: GameState = { ...withPool.state, player: { ...withPool.state.player, location: "node.x.1" }, hordes: [] };
    const under: GameState = { ...clear, hordes: [horde("node.x.1")] };
    expect(evaluateEvents(clear, withPool.graph)).not.toBe(clear); // the pool IS live at this node…
    expect(evaluateEvents(under, withPool.graph)).toBe(under); // …and a mass shuts it out entirely
  });

  it("logs horde.overrun on the EDGE — once when the mass arrives, not once per turn under it", () => {
    const { state } = boot();
    const clear: GameState = { ...state, player: { ...state.player, location: "node.x.1" }, hordes: [horde("node.x.2")] };
    const arrived: GameState = { ...clear, hordes: [horde("node.x.1")] };
    const first = recordHistory(clear, arrived).filter((e) => e.type === "horde.overrun");
    expect(first).toHaveLength(1);
    expect(first[0]!.subjects).toStrictEqual(["node.x.1"]);
    expect((first[0]!.data as { mass: number }).mass).toBe(24);
    expect(recordHistory(arrived, arrived).filter((e) => e.type === "horde.overrun")).toHaveLength(0);
    // walking INTO a mass is an overrun too
    const walkedIn: GameState = { ...arrived, player: { ...arrived.player, location: "node.x.1" } };
    const from: GameState = { ...arrived, player: { ...arrived.player, location: "node.x.0" } };
    expect(recordHistory(from, walkedIn).filter((e) => e.type === "horde.overrun")).toHaveLength(1);
  });
});

describe("determinism, save-losslessness and no new schema rung (T76 · ADR-0001/0003)", () => {
  it("an overrun slice replays byte-identically from the same seed", () => {
    const a = boot("replay"), b = boot("replay");
    const run = (r: { state: GameState; graph: RegionGraph }): GameState => {
      let s = overrunAt(r.state, "node.x.2");
      s = take(s, r.graph, "hold");
      s = take(s, r.graph, "flee:node.x.1");
      return s;
    };
    expect(JSON.stringify(run(a))).toBe(JSON.stringify(run(b)));
  });

  it("round-trips losslessly through save/load, and stays on save v10", () => {
    const { state, graph } = boot();
    const after = take(take(overrunAt(state, "node.x.2"), graph, "hold"), graph, "flee:node.x.3");
    const loaded = loadGame(saveGame(after));
    expect(loaded).toStrictEqual(after);
    expect(JSON.parse(saveGame(after)).saveSchemaVersion).toBe(10);
  });

  it("every numeric leaf is a whole number after the slice", () => {
    const { state, graph } = boot();
    const after = take(overrunAt(state, "node.x.2"), graph, "hold");
    for (const h of after.hordes) expect(Number.isInteger(h.size)).toBe(true);
    for (const w of after.player.condition.wounds) {
      expect(Number.isInteger(w.severity)).toBe(true);
      expect(Number.isInteger(w.inflictedDay)).toBe(true);
    }
  });

  it("a flight always resolves and always relocates (property over seeds and targets)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.constantFrom(1, 3), (k, to) => {
        const { state, graph } = boot(`prop-${k}`);
        const s = overrunAt(state, "node.x.2");
        const after = take(s, graph, `flee:node.x.${to}`);
        expect(after.player.location).toBe(`node.x.${to}`);
        expect(after.combat).toBeNull();
      }),
      { numRuns: 50 },
    );
  });
});

// --- local helpers ------------------------------------------------------------------------------

function withRoster0(s: GameState, id: string, n: number): GameState {
  return { ...s, nodes: { ...s.nodes, [id]: withRoster(s.nodes[id]!, Array.from({ length: n }, () => ZOMBIE_WALKER)) } };
}
function withNoise(s: GameState, id: string, noise: number): GameState {
  return { ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id]!, noise } } };
}
