import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceWorld,
  applyAction,
  bankHours,
  contestRegion,
  difficultyProfile,
  wholeHours,
  driftRegion,
  loadGame,
  offscreenShelterUpkeep,
  relax,
  saveGame,
  startRun,
  stepToward,
  tickCompanions,
  tickGroups,
  tickHordes,
  tickPeople,
  tickRoutes,
  tickShelterOps,
  tickTimeOfDay,
  DENSITY_HOURS_PER_STEP,
  FORTIFY_DECAY_PER_HOUR,
  GLOBAL_THREAT_HOURS_PER_STEP,
  HORDE_AWARENESS,
  LOOT_CONTEST_DIVISOR,
  HORDE_HOURS_PER_STEP,
  MORALE_HOURS_PER_STEP,
  MORALE_STEP,
  MOVE_HOURS,
  ROUTE_HOURS_PER_STEP,
  ROUTE_WEAR_RISE_PER_STEP,
  SCAVENGE_HOURS_PER_UNIT,
  STASH_SPOIL_HOURS,
  THREAT_HOURS_PER_STEP,
  WATCHTOWER_DECAY_DIVISOR,
  type FactionDef,
  type GameState,
  type Horde,
  type JobDef,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
  type RegionState,
  type Survivor,
} from "../src/index.js";
import { SAVE_SCHEMA_VERSION } from "../src/state/types.js";

/**
 * T74 — hour accumulators, the sub-cycle granularity fix (design review 2026-09-12 step 1).
 *
 * Thirteen periodic systems computed `Math.trunc(hours / period)` against the CURRENT action's hour cost
 * and discarded the remainder. Ordinary turns cost 1–2 hours against periods of 2–12, so the work never
 * happened: the base economy produced nothing outside the 9-hour sleep, morale never drifted (making
 * desertion and betrayal unreachable), off-screen survivors never moved once in a whole run, and a horde
 * only advanced when the player rested. The three copies of `stepToward` compounded it from the other
 * side — `Math.max(1, maxStep)` moved a full point on a zero-step tick, so every `*_HOURS_PER_STEP`
 * constant was a dead knob and each dial crept at exactly 1 point per turn no matter how it was tuned.
 *
 * What is proven here:
 *   1. the accumulator itself is chunking-invariant (the property that makes the rest true);
 *   2. the dead knob is gone — a sub-period tick moves nothing, in all three former copies;
 *   3. every site banks and pays out on ordinary turn lengths;
 *   4. **a played hour == a fast-forwarded hour** — N turns of h hours do exactly what one advanceWorld
 *      of N·h does, for every RNG-free periodic system (the invariant the module headers claimed since
 *      T23 and truncation quietly broke in both directions);
 *   5. no save rung: the fields are optional-tolerated-absent, so a pre-T74 save loads at zero.
 */

// --- fixtures ---------------------------------------------------------------------------------

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.s", regionId: "region.z", name: "Shelter", description: "home", adjacent: ["node.a"], start: true, kind: "residential" },
  { id: "node.a", regionId: "region.z", name: "Away", description: "away", adjacent: ["node.s"], kind: "store" },
];
const JOBS: JobDef[] = [
  { id: "job.garden", label: "Tend the garden", worldEffect: "Beds give up fresh food.", room: "room.garden", produces: { item: "item.food-fresh", qty: 1 }, hoursPerCycle: 6 },
];
const opts = { seed: "t74-seed", createdAt: "2026-09-12T00:00:00Z" };

type Stash = GameState["player"]["stash"];
const jobsRun = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, [], [], [], [], [], JOBS);

const stashCount = (s: GameState, type: string): number =>
  s.player.stash.filter((e) => e.type === type && e.itemId === undefined).reduce((n, e) => n + e.quantity, 0);

function resident(s: GameState, id = "c.ruth", flags: Record<string, boolean> = { companion: true }): GameState {
  const c: Survivor = {
    id,
    type: "npc.ruth",
    name: "Ruth",
    trust: 90,
    condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
    location: s.player.location,
    groupId: null,
    relationships: {},
    inventory: [],
    flags,
  };
  return { ...s, actors: { ...s.actors, [id]: c } };
}

/** A claimed shelter with the given rooms, a resident companion, and a stash — the T52 fixture shape. */
function shelter(rooms: string[], stash: Stash = [], jobFlag = "job:job.garden"): { state: GameState; graph: RegionGraph } {
  const { state, graph } = jobsRun();
  let s: GameState = { ...state, player: { ...state.player, shelterId: state.player.location, stash } };
  s = { ...s, nodes: { ...s.nodes, [s.player.location]: { ...s.nodes[s.player.location]!, rooms } } };
  s = resident(s, "c.ruth", { companion: true, [jobFlag]: true });
  return { state: s, graph };
}

// The horde/region/route fixture: a five-node line n0—n1—n2—n3—n4, start at n0.
const LINE_REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const LINE_NODES: NodeDef[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `node.x.${i}`,
  regionId: "region.x",
  name: `N${i}`,
  description: `n${i}`,
  adjacent: [i - 1, i + 1].filter((j) => j >= 0 && j <= 4).map((j) => `node.x.${j}`),
  ...(i === 0 ? { start: true } : {}),
}));
const lineRun = (): { state: GameState; graph: RegionGraph } => startRun(opts, LINE_REGIONS, LINE_NODES);
const withHorde = (state: GameState, pos: string, patch: Partial<Horde> = {}): GameState => ({
  ...state,
  hordes: [{ id: "horde.1", size: 20, pos, dest: null, speed: 1, awareness: HORDE_AWARENESS, types: ["zombie.walker"], ...patch }],
});

// The social fixture (T53 shape): a faction pool makes the people layer live.
const SOC_NODES: NodeDef[] = [
  { id: "node.start", regionId: "region.z", name: "Start", description: "s", adjacent: ["node.mid"], start: true },
  { id: "node.mid", regionId: "region.z", name: "Mid", description: "m", adjacent: ["node.start", "node.home"] },
  { id: "node.home", regionId: "region.z", name: "Home", description: "h", adjacent: ["node.mid"] },
];
const SOC_NPCS: NPCDef[] = [{ id: "npc.sana", name: "Sana", description: "a steady medic", disposition: "friendly", homeNode: "node.start" }];
const SOC_FACTIONS: FactionDef[] = [
  { id: "faction.kin", name: "Kin", archetype: "holdout", description: "those who stayed", homeNode: "node.home", members: ["npc.sana"], baseline: { strength: 40, hostility: 5, reputation: 10 } },
];
const socialRun = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, SOC_NODES, SOC_NPCS, [], [], [], [], [], SOC_FACTIONS);

// --- 1. the accumulator itself ----------------------------------------------------------------

describe("bankHours — the accumulator (T74)", () => {
  it("is chunking-invariant: any split of a span yields the same total cycles as the whole span", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 24 }), (per, chunks) => {
        let carried: number | undefined = undefined;
        let total = 0;
        for (const h of chunks) {
          const b = bankHours(carried, h, per);
          total += b.steps;
          carried = b.rest;
        }
        const span = chunks.reduce((a, b) => a + b, 0);
        expect(total).toBe(Math.trunc(span / per));
      }),
    );
  });

  it("keeps the remainder bounded (0 <= rest < per) so no clock can run away", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 100 }), (per, carried, h) => {
        const b = bankHours(carried, h, per);
        expect(b.rest).toBeGreaterThanOrEqual(0);
        expect(b.rest).toBeLessThan(per);
        expect(b.steps).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("reads an absent accumulator as zero (the pre-T74 save case) and is total on junk input", () => {
    expect(bankHours(undefined, 6, 6)).toStrictEqual({ steps: 1, rest: 0 });
    expect(bankHours(-5, 6, 6)).toStrictEqual({ steps: 1, rest: 0 }); // negative carried clamps
    expect(bankHours(0, -3, 6)).toStrictEqual({ steps: 0, rest: 0 }); // negative hours clamp
    expect(bankHours(0, 3, 0)).toStrictEqual({ steps: 3, rest: 0 }); // per <= 0 is a per-hour clock
    expect(bankHours(1.9, 2.9, 3)).toStrictEqual({ steps: 1, rest: 0 }); // integer-only (ADR-0001)
  });
});

describe("stepToward — the dead knob is gone (T74)", () => {
  it("moves NOTHING on a zero step (the old copies floored at Math.max(1, maxStep))", () => {
    expect(stepToward(10, 50, 0)).toBe(10);
    expect(stepToward(50, 10, 0)).toBe(50);
  });

  it("still closes the gap and never overshoots it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 20 }), (cur, target, step) => {
        const next = stepToward(cur, target, step);
        expect(Math.abs(next - cur)).toBeLessThanOrEqual(step);
        expect(Math.abs(next - target)).toBeLessThanOrEqual(Math.abs(cur - target));
      }),
    );
  });

  it("relax HOLDS a dial already at its target — no accrual, and the bank is not thrown away", () => {
    // An equilibrium neither stores up a burst to spend the moment the target twitches, nor loses the
    // hours it had already banked. Returning the carry unchanged is also what keeps the caller's
    // `rest !== (carried ?? 0)` check false, so a settled layer writes nothing.
    expect(relax(40, 40, 2, 5, 3)).toStrictEqual({ value: 40, rest: 2 });
    expect(relax(40, 40, undefined, 5, 3)).toStrictEqual({ value: 40, rest: 0 });
    expect(relax(40, 50, undefined, 5, 3)).toStrictEqual({ value: 41, rest: 2 });
  });

  it("is total on junk that a hand-edited save could carry — NaN never reaches an accumulator field", () => {
    // A NaN in a numeric field survives JSON.stringify as `null`, which would break save losslessness.
    expect(bankHours(NaN, 5, 3)).toStrictEqual({ steps: 1, rest: 2 });
    expect(bankHours(0, NaN, 3)).toStrictEqual({ steps: 0, rest: 0 });
    expect(bankHours(0, 5, NaN)).toStrictEqual({ steps: 5, rest: 0 });
    expect(stepToward(10, 50, NaN)).toBe(10);
    expect(relax(10, 50, NaN, NaN, NaN)).toStrictEqual({ value: 10, rest: 0 });
  });
});

// --- 2. every site banks and pays out on ordinary turn lengths ---------------------------------

describe("the base economy works on ordinary turns (jobs.ts — T74)", () => {
  it("six 1-hour turns turn exactly the same cycle one 6-hour turn does", () => {
    const { state, graph } = shelter(["room.garden"]);
    let chunked = state;
    for (let i = 0; i < 6; i++) chunked = tickShelterOps(chunked, graph, 1);
    const whole = tickShelterOps(state, graph, 6);
    expect(stashCount(chunked, "item.food-fresh")).toBe(1);
    expect(stashCount(whole, "item.food-fresh")).toBe(1);
  });

  it("a full day of 2-hour turns yields a day of work, not nothing (the headline regression)", () => {
    const { state, graph } = shelter(["room.garden"]);
    let s = state;
    for (let i = 0; i < 12; i++) s = tickShelterOps(s, graph, 2); // 24h in ordinary turns
    expect(stashCount(s, "item.food-fresh")).toBe(4); // 24h / 6h per cycle
  });

  it("a worker pulled off the job drops their banked hours rather than carrying them to the next job", () => {
    const { state, graph } = shelter(["room.garden"]);
    const partial = tickShelterOps(state, graph, 5);
    expect(partial.actors["c.ruth"]!.jobHours).toBe(5);
    const unassigned: GameState = {
      ...partial,
      actors: { ...partial.actors, "c.ruth": { ...partial.actors["c.ruth"]!, flags: { companion: true } } },
    };
    const after = tickShelterOps(unassigned, graph, 1);
    expect(after.actors["c.ruth"]!.jobHours).toBe(0);
    expect(stashCount(after, "item.food-fresh")).toBe(0);
  });

  it("warm fresh food rots across ordinary turns (the spoil clock)", () => {
    const { state, graph } = shelter([], [{ type: "item.food-fresh", quantity: 2 }]);
    const warm: GameState = { ...state, world: { ...state.world, powerGrid: 0 } }; // no kitchen, failing grid
    let s = warm;
    for (let i = 0; i < STASH_SPOIL_HOURS / 2; i++) s = tickShelterOps(s, graph, 2);
    expect(stashCount(s, "item.food-spoiled")).toBe(1);
    expect(stashCount(s, "item.food-fresh")).toBe(1);
  });

  it("cold storage stops the rot clock instead of pausing it mid-count", () => {
    const { state, graph } = shelter([], [{ type: "item.food-fresh", quantity: 2 }]);
    const warm: GameState = { ...state, world: { ...state.world, powerGrid: 0 } };
    const part = tickShelterOps(warm, graph, STASH_SPOIL_HOURS - 1);
    expect(part.world.spoilHours).toBe(STASH_SPOIL_HOURS - 1);
    const chilled = tickShelterOps({ ...part, nodes: { ...part.nodes, [part.player.location]: { ...part.nodes[part.player.location]!, rooms: ["room.kitchen"] } } }, graph, 1);
    expect(chilled.world.spoilHours).toBe(0);
    expect(stashCount(chilled, "item.food-spoiled")).toBe(0);
  });

  it("the watchtower halves off-screen wall decay EXACTLY, odd hours included", () => {
    const { state, graph } = shelter(["room.watchtower"]);
    const walled: GameState = { ...state, nodes: { ...state.nodes, [state.player.location]: { ...state.nodes[state.player.location]!, rooms: ["room.watchtower"], barricades: 100 } } };
    let s = walled;
    for (let i = 0; i < 8; i++) s = offscreenShelterUpkeep(s, graph, 1); // eight ODD hours
    const lost = 100 - s.nodes[s.player.location]!.barricades;
    expect(lost).toBe((FORTIFY_DECAY_PER_HOUR * 8) / WATCHTOWER_DECAY_DIVISOR); // 4, not 0
  });
});

describe("a scavenger pays out on odd turns too (companions.ts — T74)", () => {
  it("two 1-hour turns bank one supply", () => {
    const { state, graph } = shelter(["room.garden"]);
    void graph;
    const scav: GameState = { ...state, actors: { ...state.actors, "c.ruth": { ...state.actors["c.ruth"]!, flags: { companion: true, "order:scavenge": true } } } };
    const one = tickCompanions(scav, 1);
    expect(one.actors["c.ruth"]!.scavengeHours).toBe(1);
    const two = tickCompanions(one, 1);
    expect(two.actors["c.ruth"]!.scavengeHours).toBe(0);
    expect(two.player.stash.length).toBeGreaterThan(0);
  });

  it("a companion taken off the order holds no clock (no stored burst to dump later)", () => {
    const { state } = shelter(["room.garden"]);
    const scav: GameState = { ...state, actors: { ...state.actors, "c.ruth": { ...state.actors["c.ruth"]!, flags: { companion: true, "order:scavenge": true } } } };
    const banked = tickCompanions(scav, 1);
    expect(banked.actors["c.ruth"]!.scavengeHours).toBe(1);
    const held: GameState = { ...banked, actors: { ...banked.actors, "c.ruth": { ...banked.actors["c.ruth"]!, flags: { companion: true } } } };
    expect(tickCompanions(held, 1).actors["c.ruth"]!.scavengeHours).toBe(0);
  });
});

describe("morale finally drifts, so desertion is reachable (social.ts — T74)", () => {
  const miserable = (s: GameState, id = "c.vic"): GameState => {
    const c: Survivor = {
      id,
      type: "npc.sana",
      name: "Vic",
      trust: 20,
      condition: { needs: { hunger: 95, thirst: 95, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
      location: s.player.location,
      groupId: null,
      relationships: {},
      inventory: [],
      flags: { companion: true },
    };
    return { ...s, actors: { ...s.actors, [id]: c } };
  };

  it("three 2-hour turns move morale exactly one step — six hours, one step", () => {
    const { state, graph } = socialRun();
    const s = miserable(state);
    const before = s.actors["c.vic"]!.condition.mind.morale;
    let cur = s;
    for (let i = 0; i < 2; i++) cur = tickPeople(cur, graph, 2); // 4h — short of the 6h step
    expect(cur.actors["c.vic"]!.condition.mind.morale).toBe(before);
    expect(cur.actors["c.vic"]!.moraleHours).toBe(4);
    cur = tickPeople(cur, graph, 2); // the 6th hour
    expect(before - cur.actors["c.vic"]!.condition.mind.morale).toBe(MORALE_STEP);
    expect(cur.actors["c.vic"]!.moraleHours).toBe(0);
  });

  it("a neglected companion in 2-hour turns actually leaves (unreachable before T74)", () => {
    const { state, graph } = socialRun();
    let cur = miserable(state);
    for (let i = 0; i < 60; i++) cur = tickPeople(cur, graph, 2); // 120h of ordinary turns
    expect(cur.actors["c.vic"]).toBeUndefined();
    expect(Object.keys(cur.player.flags).some((f) => f.includes("c.vic"))).toBe(true);
  });
});

describe("off-screen survivors regroup at all (social.ts tickGroups — T74)", () => {
  it("banks 12 hours of ordinary turns and then takes a hop toward home", () => {
    const { state, graph } = socialRun();
    const away: GameState = { ...state, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, location: "node.start" } } };
    let cur = away;
    for (let i = 0; i < MOVE_HOURS / 2 - 1; i++) cur = tickGroups(cur, graph, 2);
    expect(cur.npcs["npc.sana"]!.location).toBe("node.start"); // not yet
    expect(cur.world.regroupHours).toBe(MOVE_HOURS - 2);
    cur = tickGroups(cur, graph, 2);
    expect(cur.npcs["npc.sana"]!.location).toBe("node.mid"); // one hop toward faction home
  });
});

describe("regroup is chunking-invariant on a long chain (social.ts tickGroups — T74 audit)", () => {
  // A 12-node chain, so 3 hops is observably different from 2 — the geometry a 3-node line cannot show.
  const CHAIN: NodeDef[] = Array.from({ length: 12 }, (_, i) => ({
    id: `node.c${i}`,
    regionId: "region.z",
    name: `C${i}`,
    description: `c${i}`,
    adjacent: [i - 1, i + 1].filter((j) => j >= 0 && j <= 11).map((j) => `node.c${j}`),
    ...(i === 0 ? { start: true } : {}),
  }));
  const CHAIN_FACTIONS: FactionDef[] = [
    { id: "faction.kin", name: "Kin", archetype: "holdout", description: "d", homeNode: "node.c11", members: ["npc.sana"], baseline: { strength: 40, hostility: 5, reputation: 10 } },
  ];
  const chainRun = (): { state: GameState; graph: RegionGraph } =>
    startRun(opts, REGIONS, CHAIN, SOC_NPCS, [], [], [], [], [], CHAIN_FACTIONS);

  it("one long advance and the same span in ordinary turns land in the same place", () => {
    // The old `Math.min(steps, 2)` hop cap is gone: it could never fire before T74, and once it could it
    // made a single long advance under-move while the same hours played out did not.
    const { state, graph } = chainRun();
    const away: GameState = { ...state, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, location: "node.c0" } } };
    const whole = tickGroups(away, graph, MOVE_HOURS * 3);
    let chunked = away;
    for (let i = 0; i < 3; i++) chunked = tickGroups(chunked, graph, MOVE_HOURS);
    let ones = away;
    for (let i = 0; i < MOVE_HOURS * 3; i++) ones = tickGroups(ones, graph, 1);
    expect(whole.npcs["npc.sana"]!.location).toBe("node.c3");
    expect(chunked.npcs["npc.sana"]!.location).toBe("node.c3");
    expect(ones.npcs["npc.sana"]!.location).toBe("node.c3");
    expect(whole.world.regroupHours ?? 0).toBe(0);
  });

  it("the bank never becomes a stored burst — it cannot outgrow one period", () => {
    const { state, graph } = chainRun();
    const away: GameState = { ...state, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, location: "node.c0" } } };
    let cur = away;
    for (let i = 0; i < 20; i++) cur = tickGroups(cur, graph, 240);
    expect(cur.world.regroupHours ?? 0).toBeLessThan(MOVE_HOURS);
  });
});

describe("regional drift runs on its period, not once per turn (regionDrift.ts — T74)", () => {
  const region = (patch: Partial<RegionState> = {}): RegionState => ({
    threat: 10,
    zombieDensity: 10,
    loot: 50,
    survivorActivity: 0,
    power: 50,
    water: 50,
    fire: 0,
    roads: 100,
    storyFlags: {},
    ...patch,
  });

  it("a one-hour tick banks instead of moving a full point (the dead-knob regression)", () => {
    const r = region();
    const after = driftRegion(r, 1, 0);
    expect(after.zombieDensity).toBe(r.zombieDensity);
    expect(after.densityHours).toBe(1);
  });

  it("the density period governs: the point lands on the DENSITY_HOURS_PER_STEP hour", () => {
    let r = region();
    for (let i = 0; i < DENSITY_HOURS_PER_STEP - 1; i++) r = driftRegion(r, 1, 0);
    expect(r.zombieDensity).toBe(10);
    r = driftRegion(r, 1, 0);
    expect(r.zombieDensity).toBe(11);
  });

  it("threat keeps its own slower clock (the two periods are distinguishable at last)", () => {
    const r = region({ zombieDensity: 60, threat: 0, survivorActivity: 100 });
    const after = driftRegion(r, THREAT_HOURS_PER_STEP - 1, 0);
    expect(after.threat).toBe(0);
    expect(after.threatHours).toBe(THREAT_HOURS_PER_STEP - 1);
    expect(driftRegion(after, 1, 0).threat).toBe(1);
  });

  it("a region at equilibrium stays byte-identical — no idle churn in the save", () => {
    const settled = region({ zombieDensity: 20, threat: 10, survivorActivity: 0, fire: 0 });
    const target = driftRegion(driftRegion(settled, 96, 0), 96, 0); // let it settle fully
    expect(driftRegion(target, 2, 0)).toBe(target);
  });
});

describe("the diurnal tide and route wear run on their periods (timeOfDay.ts / routes.ts — T74)", () => {
  it("the threat tide banks sub-period hours instead of creeping a point every turn", () => {
    const { state } = lineRun();
    const s: GameState = { ...state, world: { ...state.world, globalThreat: 0 } };
    const one = tickTimeOfDay(s, 1);
    expect(one.world.globalThreat).toBe(0);
    expect(one.world.threatTideHours).toBe(1);
    let cur = s;
    for (let i = 0; i < GLOBAL_THREAT_HOURS_PER_STEP; i++) cur = tickTimeOfDay(cur, 1);
    expect(cur.world.globalThreat).toBe(1);
  });

  it("the tide reaches the same place whether played in 1-hour or one 12-hour step", () => {
    const { state } = lineRun();
    const s: GameState = { ...state, world: { ...state.world, globalThreat: 0 } };
    let chunked = s;
    for (let i = 0; i < 12; i++) chunked = tickTimeOfDay(chunked, 1);
    const whole = tickTimeOfDay(s, 12);
    expect(chunked.world.globalThreat).toBe(whole.world.globalThreat);
  });

  it("route wear no longer takes a full rise step every single turn", () => {
    const { state } = lineRun();
    const broken: GameState = { ...state, regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, roads: 0 } } };
    const one = tickRoutes(broken, 1);
    const firstKey = Object.keys(broken.routes)[0]!;
    expect(one.routes[firstKey]!.wear).toBe(broken.routes[firstKey]!.wear);
    expect(one.world.routeWearHours).toBe(1);
    const due = tickRoutes(one, ROUTE_HOURS_PER_STEP - 1);
    expect(due.routes[firstKey]!.wear).toBe(broken.routes[firstKey]!.wear + ROUTE_WEAR_RISE_PER_STEP);
  });

  it("a settled route map does not churn the world slice every turn", () => {
    const { state } = lineRun();
    const settled = tickRoutes(state, 96);
    expect(tickRoutes(settled, 2)).toBe(settled);
  });
});

describe("a horde advances on ordinary turns (hordes.ts — T74)", () => {
  it("banks two 2-hour turns into one node of movement", () => {
    const { state, graph } = lineRun();
    const s = withHorde(state, "node.x.4", { dest: "node.x.0" });
    const first = tickHordes(s, 2, graph);
    expect(first.hordes[0]!.pos).toBe("node.x.4"); // 2h < HORDE_HOURS_PER_STEP
    expect(first.hordes[0]!.stepHours).toBe(2);
    const second = tickHordes(first, 2, graph);
    expect(second.hordes[0]!.pos).toBe("node.x.3"); // the 4th hour carries it a node
    expect(second.hordes[0]!.stepHours).toBe(0);
  });

  it("covers the same ground in 2-hour turns as in one fast-forward of the same span", () => {
    const { state, graph } = lineRun();
    const s = withHorde(state, "node.x.4", { dest: "node.x.0" });
    let chunked = s;
    for (let i = 0; i < 4; i++) chunked = tickHordes(chunked, 2, graph); // 8h
    const whole = tickHordes(s, 8, graph);
    expect(chunked.hordes[0]!.pos).toBe(whole.hordes[0]!.pos);
    expect(8 / HORDE_HOURS_PER_STEP).toBe(2);
    expect(whole.hordes[0]!.pos).toBe("node.x.2");
  });
});

// --- 3. the headline invariant ------------------------------------------------------------------

describe("a played hour == a fast-forwarded hour (T74's verification bar)", () => {
  it("a day of 2-hour turns and one 24-hour advanceWorld produce the same job output", () => {
    const { state, graph } = shelter(["room.garden"]);
    let chunked = state;
    for (let i = 0; i < 12; i++) chunked = advanceWorld(chunked, 2, graph);
    const whole = advanceWorld(state, 24, graph);
    expect(stashCount(chunked, "item.food-fresh")).toBe(stashCount(whole, "item.food-fresh"));
    expect(stashCount(whole, "item.food-fresh")).toBe(4);
  });

  it("the same holds for a scavenger's banked supplies", () => {
    const { state, graph } = shelter(["room.garden"]);
    const scav: GameState = { ...state, actors: { ...state.actors, "c.ruth": { ...state.actors["c.ruth"]!, flags: { companion: true, "order:scavenge": true } } } };
    let chunked = scav;
    for (let i = 0; i < 9; i++) chunked = advanceWorld(chunked, 1, graph);
    const whole = advanceWorld(scav, 9, graph);
    expect(stashCount(chunked, "item.canned-food")).toBe(stashCount(whole, "item.canned-food"));
    expect(stashCount(whole, "item.canned-food")).toBe(Math.trunc(9 / SCAVENGE_HOURS_PER_UNIT));
  });

  it("the same holds for morale drift, whatever length the client chunks the span into", () => {
    const { state, graph } = socialRun();
    const c: Survivor = {
      id: "c.vic",
      type: "npc.sana",
      name: "Vic",
      trust: 20,
      condition: { needs: { hunger: 95, thirst: 95, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
      location: state.player.location,
      groupId: null,
      relationships: {},
      inventory: [],
      flags: { companion: true },
    };
    const s: GameState = { ...state, actors: { ...state.actors, "c.vic": c } };
    let ones = s;
    for (let i = 0; i < MORALE_HOURS_PER_STEP * 2; i++) ones = tickPeople(ones, graph, 1);
    let twos = s;
    for (let i = 0; i < MORALE_HOURS_PER_STEP; i++) twos = tickPeople(twos, graph, 2);
    const whole = tickPeople(s, graph, MORALE_HOURS_PER_STEP * 2);
    expect(ones.actors["c.vic"]!.condition.mind.morale).toBe(whole.actors["c.vic"]!.condition.mind.morale);
    expect(twos.actors["c.vic"]!.condition.mind.morale).toBe(whole.actors["c.vic"]!.condition.mind.morale);
  });
});

// --- 4. no save rung ----------------------------------------------------------------------------

describe("optional-tolerated-absent: no SAVE_SCHEMA_VERSION rung (T74)", () => {
  it("stays at the T52 rung", () => {
    expect(SAVE_SCHEMA_VERSION).toBe(10);
  });

  it("a save carrying accumulators round-trips losslessly", () => {
    const { state, graph } = shelter(["room.garden"]);
    const ticked = tickShelterOps(state, graph, 5);
    expect(ticked.actors["c.ruth"]!.jobHours).toBe(5);
    expect(loadGame(saveGame(ticked))).toStrictEqual(ticked);
  });

  it("a pre-T74 save (no accumulator fields anywhere) loads and ticks as if every clock were zero", () => {
    const { state, graph } = shelter(["room.garden"]);
    // A v10 save written before T74 simply has no `jobHours` on its survivors and no clocks on `world`.
    const old = loadGame(saveGame(state));
    expect(old.actors["c.ruth"]!.jobHours).toBeUndefined();
    expect(old.world.spoilHours).toBeUndefined();
    const fromAbsent = tickShelterOps(old, graph, 6);
    const fromZero = tickShelterOps({ ...old, actors: { ...old.actors, "c.ruth": { ...old.actors["c.ruth"]!, jobHours: 0 } } }, graph, 6);
    expect(stashCount(fromAbsent, "item.food-fresh")).toBe(stashCount(fromZero, "item.food-fresh"));
    // …and neither path grows a spurious field: an idle clock is written only when it actually moves.
    expect(fromAbsent.actors["c.ruth"]!.jobHours ?? 0).toBe(fromZero.actors["c.ruth"]!.jobHours ?? 0);
    expect(fromAbsent.actors["c.ruth"]!.jobHours).toBeUndefined();
  });

  it("an ordinary run still resolves a turn end to end with the clocks live", () => {
    const { state, graph } = lineRun();
    const res = applyAction(state, { type: "rest", choiceId: "rest", timeCost: 2 }, graph);
    expect(res.state.meta.turn).toBe(state.meta.turn + 1);
    expect(loadGame(saveGame(res.state))).toStrictEqual(res.state);
  });
});

// --- 5. an idle clock holds: no churn in the state, the telemetry, or the save ---------------------

describe("an idle clock holds — it neither accrues nor rewrites state (T74 audit)", () => {
  it("a job stalled at the tick's start banks nothing, for ANY turn length", () => {
    // A generator at a full grid is waiting, not working. Before this guard it cycled its accumulator
    // (and rewrote `actors`) every turn forever while producing nothing — and the T52 test that asserts
    // inertness only passed because its 24-hour span happened to be a whole number of cycles.
    const { state, graph } = jobsRun();
    let s: GameState = { ...state, player: { ...state.player, shelterId: state.player.location, stash: [{ type: "item.fuel", quantity: 5 }] } };
    s = { ...s, nodes: { ...s.nodes, [s.player.location]: { ...s.nodes[s.player.location]!, rooms: ["room.generator"] } } };
    s = resident(s, "c.ruth", { companion: true, "job:job.generator": true });
    s = { ...s, world: { ...s.world, powerGrid: 100 } };
    for (const hours of [1, 2, 5, 24, 25]) expect(tickShelterOps(s, graph, hours)).toBe(s);
  });

  it("a settled party does not rewrite its actors every turn", () => {
    const { state, graph } = socialRun();
    const content: GameState = {
      ...state,
      actors: {
        ...state.actors,
        "c.ok": {
          id: "c.ok", type: "npc.sana", name: "Ok", trust: 90,
          condition: { needs: { hunger: 0, thirst: 0, fatigue: 0 }, wounds: [], infection: { stage: "none", progression: 0 }, mind: { stress: 0, morale: 60 } },
          location: state.player.location, groupId: null, relationships: {}, inventory: [], flags: { companion: true },
        },
      },
    };
    const settled = tickPeople(tickPeople(content, graph, 24), graph, 24); // let morale reach its target
    expect(tickPeople(settled, graph, 2)).toBe(settled);
  });

  it("a regroup with everyone already home does not rewrite the world every turn", () => {
    const { state, graph } = socialRun();
    const home: GameState = { ...state, npcs: { ...state.npcs, "npc.sana": { ...state.npcs["npc.sana"]!, location: "node.home" } } };
    expect(tickGroups(home, graph, 2)).toBe(home);
  });

  it("a picked-clean region stops contesting instead of banking against a stock that cannot fall", () => {
    const bare: RegionState = { threat: 10, zombieDensity: 10, loot: 0, survivorActivity: 50, power: 50, water: 50, fire: 0, roads: 100, storyFlags: {} };
    expect(contestRegion(bare, 24)).toBe(bare);
  });
});

// --- 6. the 14th site: the off-screen loot contest ------------------------------------------------

describe("off-screen rivals thin a region on ordinary turns too (loot.ts — T74)", () => {
  const region = (survivorActivity: number): RegionState => ({
    threat: 10, zombieDensity: 10, loot: 50, survivorActivity, power: 50, water: 50, fire: 0, roads: 100, storyFlags: {},
  });

  it("a 2-hour turn against downtown's activity used to be a no-op and now banks", () => {
    const r = region(10); // region.downtown's shipped survivorActivity
    const after = contestRegion(r, 2);
    expect(after.loot).toBe(50); // not yet — 20 of 50 pressure-hours
    expect(after.lootContestHours).toBe(20);
    let cur = r;
    for (let i = 0; i < 12; i++) cur = contestRegion(cur, 2); // a day of ordinary turns
    expect(cur.loot).toBe(50 - Math.trunc((24 * 10) / LOOT_CONTEST_DIVISOR));
  });

  it("a day of 2-hour turns thins a region exactly as one 24-hour fast-forward does", () => {
    const r = region(45); // region.hillcrest
    let chunked = r;
    for (let i = 0; i < 12; i++) chunked = contestRegion(chunked, 2);
    expect(chunked.loot).toBe(contestRegion(r, 24).loot);
  });

  it("…and at EVERY difficulty dial, not only the identity profile", () => {
    // The scarcity dial rides the period, not the point count: scaling the points per tick would
    // re-truncate every tick, and on Story a low-activity region would still lose nothing on an
    // ordinary turn — the exact bug T74 exists to close.
    for (const mode of ["story", "survivor", "hardcore", "nightmare"] as const) {
      const contest = difficultyProfile(mode).lootContest;
      for (const activity of [10, 15, 20, 25, 45, 55]) {
        const r = region(activity);
        let chunked = r;
        for (let i = 0; i < 24; i++) chunked = contestRegion(chunked, 1, contest);
        expect(chunked.loot).toBe(contestRegion(r, 24, contest).loot);
      }
    }
  });

  it("a harsher dial still eats the stock faster, and Survivor is untouched", () => {
    const r = region(45);
    expect(contestRegion(r, 24, 1)).toStrictEqual(contestRegion(r, 24));
    expect(contestRegion(r, 24, difficultyProfile("nightmare").lootContest).loot).toBeLessThan(contestRegion(r, 24).loot);
    expect(contestRegion(r, 24, difficultyProfile("story").lootContest).loot).toBeGreaterThan(contestRegion(r, 24).loot);
  });
});

// --- 7. a held clock is scrubbed too, so a hand-edited save cannot poison one -----------------------

describe("every clock path scrubs junk, held or banked (T74 audit)", () => {
  it("wholeHours floors anything a hand-edited save could carry", () => {
    expect(wholeHours(undefined)).toBe(0);
    expect(wholeHours(NaN)).toBe(0);
    expect(wholeHours(-4)).toBe(0);
    expect(wholeHours(2.9)).toBe(2);
  });

  it("a NaN accumulator on a held clock is scrubbed rather than persisted and churned forever", () => {
    // NaN survives JSON.stringify as `null`, which would break save losslessness; and because
    // `NaN !== NaN` the clockMoved guard would fire on every tick for the rest of the run.
    const { state, graph } = socialRun();
    const poisoned: GameState = { ...state, world: { ...state.world, regroupHours: NaN, routeWearHours: NaN } };
    const home: GameState = { ...poisoned, npcs: { ...poisoned.npcs, "npc.sana": { ...poisoned.npcs["npc.sana"]!, location: "node.home" } } };
    const afterGroups = tickGroups(home, graph, 2);
    expect(afterGroups.world.regroupHours).toBe(0);
    expect(tickGroups(afterGroups, graph, 2)).toBe(afterGroups); // and settles, no churn
    const settled = tickRoutes(tickRoutes(afterGroups, 96), 96);
    expect(Number.isFinite(settled.world.routeWearHours ?? 0)).toBe(true);
    expect(tickRoutes(settled, 2)).toBe(settled); // and settles, no churn
    // Nothing NaN reaches the save, so the round-trip stays lossless (NaN serializes as null).
    expect(loadGame(saveGame(settled))).toStrictEqual(settled);
  });
});
