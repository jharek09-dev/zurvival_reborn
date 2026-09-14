import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  startRun,
  applyAction,
  availableActions,
  advanceWorld,
  saveGame,
  loadGame,
  shelterLine,
  canClaimShelter,
  canAbandonShelter,
  safehousesAuthored,
  overrunsPlayer,
  siegePressure,
  siegeDefence,
  breachShelter,
  tickSiege,
  siegeLine,
  isNightHour,
  nightHoursIn,
  stashUnits,
  SAVE_SCHEMA_VERSION,
  SIEGE_HOURS_PER_NIGHT,
  SIEGE_HEARING,
  SIEGE_MASS_DIVISOR,
  SIEGE_DENSITY_DIVISOR,
  SIEGE_NOISE_DIVISOR,
  SIEGE_MIN_PRESSURE,
  SIEGE_BASE_DEFENCE,
  SIEGE_WATCH_DEFENCE,
  SIEGE_COMPANION_DEFENCE,
  SIEGE_PLAYER_DEFENCE,
  SIEGE_STASH_LOSS_DIVISOR,
  SIEGE_BREACH_AT,
  SIEGE_BREACH_WALKERS,
  SIEGE_STREAM,
  SIEGE_WOUND_AT,
  SIEGE_FATAL_AT,
  SHELTER_SANCTUARY_AT,
  HORDE_AWARENESS,
  COMPANION_FLAG,
  ABANDON_COST,
  type GameState,
  type Horde,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../src/index.js";

/**
 * T83 — the night attack: a siege at the claimed base, the breach that takes it, the `claimable` gate
 * that decides where a base may be, and the abandon verb. No save-schema rung — `world.siegeHours` is
 * an optional accumulator that reads 0 when absent, and every other field written here already existed.
 * Deterministic, integer-only, save-lossless; inert on every run that never claims a base.
 */

const REGIONS: RegionDef[] = [
  { id: "region.s", name: "S", description: "s", baseline: { zombieDensity: 46, threat: 40 } },
];
/** No node declares `claimable`, so the T83 safehouse rule is DARK here — the pre-T83 behaviour. */
const NODES: NodeDef[] = [
  { id: "node.s.home", regionId: "region.s", name: "Home", description: "a depot", adjacent: ["node.s.near"], start: true },
  { id: "node.s.near", regionId: "region.s", name: "Near", description: "a lot", adjacent: ["node.s.home", "node.s.far"] },
  { id: "node.s.far", regionId: "region.s", name: "Far", description: "a yard", adjacent: ["node.s.near"] },
];
/** The same map with safehouses authored — the shipped-content shape, where the rule is LIVE. */
const AUTHORED: NodeDef[] = NODES.map((n) => (n.id === "node.s.far" ? { ...n, claimable: true } : n));

const opts = { seed: "siege-seed", createdAt: "2026-09-14T00:00:00Z" };
const run = (nodes: NodeDef[] = NODES, seed = opts.seed): { state: GameState; graph: RegionGraph } =>
  startRun({ ...opts, seed }, REGIONS, nodes);

const HOME = "node.s.home";
const horde = (pos: string, size: number): Horde => ({
  id: "horde.1", size, pos, dest: null, speed: 1, awareness: HORDE_AWARENESS, types: [],
});

/** Stand the player at `at` with `HOME` claimed, a wall of `barricades`, and `stash` units banked. */
function based(
  state: GameState,
  patch: { at?: string; barricades?: number; stash?: number; mass?: number; massAt?: string; noiseAt?: [string, number] } = {},
): GameState {
  let nodes: GameState["nodes"] = { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, barricades: patch.barricades ?? 0 } };
  if (patch.noiseAt !== undefined) {
    const [id, n] = patch.noiseAt;
    nodes = { ...nodes, [id]: { ...nodes[id]!, noise: n } };
  }
  return {
    ...state,
    meta: { ...state.meta, hour: 21, phase: "night" },
    nodes,
    player: {
      ...state.player,
      shelterId: HOME,
      location: patch.at ?? HOME,
      stash: patch.stash === undefined ? state.player.stash : [{ type: "item.canned-food", quantity: patch.stash }],
    },
    ...(patch.mass === undefined ? {} : { hordes: [horde(patch.massAt ?? "node.s.near", patch.mass)] }),
  };
}

/** A party companion standing at the base, optionally posted to a barricade-upkeep job. */
function companion(id: string, at: string, job?: string): Survivor {
  return {
    id, type: "npc.fixture", name: id,
    trust: 80,
    condition: { needs: { hunger: 10, thirst: 10, fatigue: 10 }, wounds: [], infection: { progression: 0, stage: "none" }, mind: { stress: 0, morale: 60 } },
    location: at, groupId: null, relationships: {}, inventory: [],
    flags: { [COMPANION_FLAG]: true, ...(job === undefined ? {} : { [`job:${job}`]: true }) },
  } as unknown as Survivor;
}

const beats = (s: GameState): readonly string[] => s.history.filter((e) => e.type.startsWith("siege.")).map((e) => e.type);
/**
 * Fresh boots with DIFFERENT SEEDS. Varying `meta.turn` between iterations does not vary the draw —
 * the `siege` stream state is part of `state.rng`, so a loop that only bumps the turn counter draws
 * the identical float every time and samples a distribution of size one. Every search loop below goes
 * through here.
 */
const seeds = (n: number, tag: string): { state: GameState; graph: RegionGraph }[] =>
  Array.from({ length: n }, (_, i) => run(NODES, `${tag}-${i}`));
/** Resolve `nights` whole nights against the base from 21:00. */
const nights = (s: GameState, g: RegionGraph | undefined, n = 1): GameState =>
  tickSiege(s, g, 21, SIEGE_HOURS_PER_NIGHT * n);

// --- the night window is a SPAN, not a resolved phase -------------------------------------------

describe("night is the hours a turn COVERED, never the phase it resolved in (T83)", () => {
  it("knows the six hours the day's night phase owns, and only those", () => {
    for (const h of [21, 22, 23, 0, 1, 2]) expect(isNightHour(h)).toBe(true);
    for (const h of [3, 4, 8, 12, 17, 19, 20]) expect(isNightHour(h)).toBe(false);
    // wraps like every other hour read in the engine
    expect(isNightHour(24 + 22)).toBe(true);
    expect(isNightHour(-2)).toBe(true); // 22:00
  });

  it("counts the whole night inside a 'Sleep until morning' — the turn the brief is ABOUT", () => {
    // 21:00 + 9h lands at 06:00, whose phase is "dawn". A gate on the RESOLVED phase would make the one
    // turn this system exists for the one turn that could never trigger it.
    expect(nightHoursIn(21, 9)).toBe(6);
    expect(SIEGE_HOURS_PER_NIGHT).toBe(6);
    expect(nightHoursIn(0, 3)).toBe(3); // bedded down after midnight
    expect(nightHoursIn(9, 2)).toBe(0); // an ordinary morning turn
    expect(nightHoursIn(20, 2)).toBe(1); // dusk into the first night hour
    expect(nightHoursIn(21, 0)).toBe(0);
    // the closed-form whole-day path (the loop over hours was replaced because `timeCost` reaches this
    // unvalidated from stage 2): N days is exactly N windows, whatever hour you start at
    expect(nightHoursIn(21, 24)).toBe(6);
    expect(nightHoursIn(13, 240)).toBe(60);
    expect(nightHoursIn(0, 24 * 100)).toBe(600);
    // and a fractional / negative / absurd span never produces a fractional or negative count
    expect(nightHoursIn(21, -5)).toBe(0);
    expect(nightHoursIn(21, 9.9)).toBe(6);
  });

  it("a played night and a fast-forwarded one resolve the SAME number of attacks (T74 parity)", () => {
    const { state, graph } = run();
    const start = based(state, { mass: 40, stash: 20 });
    // Three whole DAYS from 21:00, which is three whole nights however the client chunks them.
    const oneShot = tickSiege(start, graph, 21, 72);
    let chunked = start;
    for (let i = 0; i < 72; i += 1) chunked = tickSiege(chunked, graph, 21 + i, 1);
    expect(beats(chunked).length).toBe(beats(oneShot).length);
    expect(beats(chunked).length).toBe(3);
  });

  it("banks the remainder and HOLDS on a turn with no night in it (the T74 idle rule)", () => {
    const { state, graph } = run();
    const start = based(state, { mass: 40 });
    const part = tickSiege(start, graph, 22, 2); // two night hours, no whole night
    expect(beats(part)).toStrictEqual([]);
    expect(part.world.siegeHours).toBe(2);
    // an ordinary daytime turn neither accrues nor resets — and with nothing banked, returns the same ref
    expect(tickSiege(part, graph, 10, 2).world.siegeHours).toBe(2);
    expect(tickSiege(start, graph, 10, 2)).toBe(start);
  });
});

// --- what presses, and what stands ---------------------------------------------------------------

describe("pressure and defence are composed from what is actually there (T83)", () => {
  it("is zero without a claimed base, without a graph, and at an unknown node", () => {
    const { state, graph } = run();
    expect(siegePressure(state, graph)).toBe(0); // nothing claimed
    expect(siegePressure(based(state, { mass: 40 }), undefined)).toBe(0);
    expect(siegeDefence(state, graph)).toBe(0);
  });

  it("sums the mass in earshot, the district's standing dead, and the neighbourhood's noise", () => {
    const { state, graph } = run();
    // LITERALS, not expressions in the constants: `toBe(Math.trunc(46 / SIEGE_DENSITY_DIVISOR))` is the
    // implementation restated and passes at a divisor of 900 as happily as at 6. The numbers below are
    // density 46, mass 40 and noise 50 through the shipped dials — 7, 7+20, 7+10.
    expect(siegePressure(based(state, {}), graph)).toBe(7);
    expect(siegePressure(based(state, { mass: 40 }), graph)).toBe(27);
    expect(siegePressure(based(state, { noiseAt: ["node.s.near", 50] }), graph)).toBe(17);
    // and the dials really are the ones those literals came from
    expect([SIEGE_DENSITY_DIVISOR, SIEGE_MASS_DIVISOR, SIEGE_NOISE_DIVISOR]).toStrictEqual([6, 2, 5]);
  });

  it("hears exactly SIEGE_HEARING hops out — a mass one hop further is not in the night", () => {
    // The map needs a node THREE hops from home or the exclusion this test is named for is unreachable
    // and the assertion would pass at any hearing radius (the audit caught exactly that).
    const wide: NodeDef[] = [
      ...NODES.map((n) => (n.id === "node.s.far" ? { ...n, adjacent: [...n.adjacent, "node.s.beyond"] } : n)),
      { id: "node.s.beyond", regionId: "region.s", name: "Beyond", description: "further", adjacent: ["node.s.far"] },
    ];
    const { state, graph } = run(wide);
    const near = siegePressure(based(state, { mass: 40, massAt: "node.s.near" }), graph);
    const far = siegePressure(based(state, { mass: 40, massAt: "node.s.far" }), graph);
    const beyond = siegePressure(based(state, { mass: 40, massAt: "node.s.beyond" }), graph);
    expect(SIEGE_HEARING).toBe(2); // and a mass at `far` is exactly 2 hops out, so it IS heard
    expect(far).toBe(near);
    expect(beyond).toBe(siegePressure(based(state, {}), graph)); // three hops: not in tonight at all
    expect(beyond).toBeLessThan(far);
    // the noise term, by contrast, is the IMMEDIATE neighbourhood only — one hop, where a settled
    // player's sound actually lives (the base itself is the one node they never search)
    expect(siegePressure(based(state, { noiseAt: ["node.s.far", 90] }), graph)).toBe(
      siegePressure(based(state, {}), graph),
    );
  });

  it("counts the building, the party and your own body — and NOT the wall (the double-count regression)", () => {
    // The first build had `barricades` in BOTH `siegeDefence` and the absorption step, which bought
    // total immunity for one scrap: 0.0% breached and 0.0 units lost at 25 barricades against a mass
    // of 120. The wall does exactly one job now, and this test is what keeps it that way.
    const { state, graph } = run();
    const away = based(state, { at: "node.s.near", barricades: 100 });
    expect(siegeDefence(away, graph)).toBe(12); // the building alone — a hundred points of wall adds nothing here
    const home = based(state, { at: HOME, barricades: 100 });
    expect(siegeDefence(home, graph)).toBe(27); // + the player in the doorway
    expect([SIEGE_BASE_DEFENCE, SIEGE_PLAYER_DEFENCE]).toStrictEqual([12, 15]);
  });

  it("a lookout on the wall is worth more than another pair of hands, and more than you are", () => {
    const { state, graph } = run();
    const jobs = [{ id: "job.watch", label: "Stand watch", room: "room.watchtower", upkeepsBarricades: true, hoursPerCycle: 6 }];
    const withJobs = { ...graph, jobs } as unknown as RegionGraph;
    const away = based(state, { at: "node.s.near" });
    const plain = { ...away, actors: { ...away.actors, "npc.a": companion("npc.a", HOME) } as never };
    const posted = { ...away, actors: { ...away.actors, "npc.a": companion("npc.a", HOME, "job.watch") } as never };
    expect(siegeDefence(plain, withJobs)).toBe(20); // building 12 + a pair of hands 8
    expect(siegeDefence(posted, withJobs)).toBe(32); // building 12 + a lookout 20
    expect([SIEGE_COMPANION_DEFENCE, SIEGE_WATCH_DEFENCE]).toStrictEqual([8, 20]);
    // a companion who is not AT the base defends nothing
    const elsewhere = { ...away, actors: { ...away.actors, "npc.a": companion("npc.a", "node.s.far", "job.watch") } as never };
    expect(siegeDefence(elsewhere, withJobs)).toBe(SIEGE_BASE_DEFENCE);
  });

  it("a quiet enough night is never even rolled for", () => {
    // The floor, not a dial: on a district with no density and no mass there is nothing to roll.
    const { state, graph } = startRun({ ...opts, seed: "quiet" }, [{ id: "region.s", name: "S", description: "s" }], NODES);
    const dead = based(state, {});
    expect(siegePressure(dead, graph)).toBeLessThan(SIEGE_MIN_PRESSURE);
    const after = nights(dead, graph);
    expect(beats(after)).toStrictEqual([]); // nothing came
    expect(JSON.stringify(after.rng)).toBe(JSON.stringify(dead.rng)); // …and no draw was spent deciding
  });
});

// --- what a night costs --------------------------------------------------------------------------

describe("the order of losses is the order a base falls (T83)", () => {
  /** Find a seed whose first night actually LANDS (rather than passing the house by). */
  const landing = (make: (s: GameState) => GameState): { state: GameState; graph: RegionGraph } => {
    for (let i = 0; i < 200; i += 1) {
      const { state, graph } = run(NODES, `land-${i}`);
      const s = nights(make(state), graph);
      if (beats(s).some((t) => t !== "siege.passed")) return { state: make(state), graph };
    }
    throw new Error("no landing seed found");
  };

  it("the wall takes it first, point for point, and what it absorbs never reaches the cache", () => {
    const { state, graph } = landing((s) => based(s, { at: "node.s.near", mass: 120, stash: 30 }));
    const bare = nights(based(state, { at: "node.s.near", mass: 120, stash: 30, barricades: 0 }), graph);
    const walled = nights(based(state, { at: "node.s.near", mass: 120, stash: 30, barricades: 100 }), graph);
    expect(stashUnits(bare.player.stash)).toBeLessThan(30);
    expect(stashUnits(walled.player.stash)).toBe(30); // a full wall absorbed the whole night
    expect(walled.nodes[HOME]!.barricades).toBeLessThan(100); // …and paid for it in barricades
  });

  it("a night that does NOT breach still empties part of the cache — the raid, without the loss", () => {
    // The mutation run found the gap: at mass 120 the night BREACHES, and `breachShelter` scatters the
    // whole cache on its own — so a mutant that made the ordinary `depleteStash` step a no-op survived
    // every cache assertion in this file. The middle band is the one that tests it: a mass big enough
    // to get past the building, small enough that `past` stays under `SIEGE_BREACH_AT`.
    let robbed = 0;
    let kept = 0;
    for (const boot of seeds(120, "robbed")) {
      const before = based(boot.state, { at: "node.s.near", mass: 60, stash: 30 });
      const after = nights(before, boot.graph);
      if (!beats(after).includes("siege.held")) continue;
      expect(after.player.shelterId).toBe(HOME); // NOT a breach — the base is still yours
      const lost = 30 - stashUnits(after.player.stash);
      expect(lost).toBeGreaterThan(0);
      expect(lost).toBeLessThan(30);
      // trunc(past / 8) — with a bare wall, `past` is the whole overflow the beat recorded
      const beat = after.history.filter((e) => e.type === "siege.held").pop()!;
      expect(lost).toBe(Math.trunc((beat.data as { overflow: number }).overflow / 8));
      robbed += 1;
      kept += stashUnits(after.player.stash);
    }
    expect(robbed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it("cannot be breached through a wall that is still standing, however big the mass", () => {
    for (const boot of seeds(60, "breach-wall")) {
      const s = nights(based(boot.state, { at: "node.s.near", mass: 120, stash: 30, barricades: 1 }), boot.graph);
      expect(s.player.shelterId).toBe(HOME);
      expect(beats(s)).not.toContain("siege.breached");
    }
  });

  it("takes the base when the wall is already down and the night is heavier than SIEGE_BREACH_AT", () => {
    const { state, graph } = landing((s) => based(s, { at: "node.s.near", mass: 120, stash: 30 }));
    // Search for a seed whose first night actually BREACHES rather than returning early on one that
    // does not — an `if (…) return` here voids all four assertions the moment a dial is retuned, with a
    // green suite to show for it.
    let after: GameState | null = null;
    for (const boot of seeds(300, "breach")) {
      const s = nights(based(boot.state, { at: "node.s.near", mass: 120, stash: 30, barricades: 0 }), boot.graph);
      if (beats(s).includes("siege.breached")) { after = s; break; }
    }
    expect(after).not.toBeNull();
    expect(after!.player.shelterId).toBeNull();
    expect(stashUnits(after!.player.stash)).toBe(0); // the cache scatters — a breached base keeps nothing
    expect(after!.nodes[HOME]!.walkers).toBeGreaterThanOrEqual(2); // literal: `>= SIEGE_BREACH_WALKERS` passes at 0
    expect(after!.nodes[HOME]!.barricades).toBe(0);
    expect(after!.world.siegeHours ?? 0).toBe(0); // the tenancy ended — its banked night ends with it
  });

  it("hurts you only if you were actually home — being away costs you the base, not your skin", () => {
    const { state, graph } = run(NODES, "wound");
    let woundedAway = 0;
    for (let i = 0; i < 80; i += 1) {
      const s = { ...state, meta: { ...state.meta, turn: i } };
      const away = nights(based(s, { at: "node.s.near", mass: 120, stash: 30 }), graph);
      woundedAway += away.player.condition.wounds.length;
    }
    expect(woundedAway).toBe(0);

    // …and the positive half, which the first cut never asserted at all: standing in it costs you skin.
    let woundedHome = 0;
    let sample: GameState | null = null;
    for (const boot of seeds(120, "wound-home")) {
      const s = nights(based(boot.state, { at: HOME, mass: 120, stash: 30 }), boot.graph);
      if (s.player.condition.wounds.length > 0) { woundedHome += 1; sample ??= s; }
    }
    expect(woundedHome).toBeGreaterThan(0);
    const w = sample!.player.condition.wounds[0]!;
    expect(w.type).toBe("wound.laceration");
    expect(w.severity).toBe(25);
    expect(w.site).toBe("arm");
    expect([SIEGE_WOUND_AT, SIEGE_FATAL_AT]).toStrictEqual([20, 40]);
  });

  it("kills a defender on the heaviest nights, through killCompanion, by sorted id", () => {
    const two = (s: GameState): GameState => ({
      ...s,
      actors: { ...s.actors, "npc.b": companion("npc.b", HOME), "npc.a": companion("npc.a", HOME) } as never,
    });
    let lost: GameState | null = null;
    for (const boot of seeds(300, "fatal")) {
      const s = nights(two(based(boot.state, { at: "node.s.near", mass: 120, stash: 30 })), boot.graph);
      if (s.actors["npc.a"] === undefined || s.actors["npc.b"] === undefined) { lost = s; break; }
    }
    expect(lost).not.toBeNull();
    // the FIRST by sorted id goes, reproducibly, without a second draw
    expect(lost!.actors["npc.a"]).toBeUndefined();
    expect(lost!.actors["npc.b"]).toBeDefined();
    expect(lost!.player.flags["fallen.npc.a"]).toBe(true); // killCompanion's own mark
    expect(lost!.history.some((e) => e.type === "siege.held" || e.type === "siege.breached")).toBe(true);
  });

  it("a base already lost earlier in the same span is not besieged again", () => {
    const { state, graph } = run(NODES, "twice");
    let s: GameState | null = null;
    for (const boot of seeds(300, "twice")) {
      const t = tickSiege(based(boot.state, { at: "node.s.near", mass: 120, stash: 30 }), boot.graph, 21, 24 * 8);
      if (t.player.shelterId === null) { s = t; break; }
    }
    expect(s).not.toBeNull();
    const idx = beats(s!).indexOf("siege.breached");
    expect(idx).toBe(beats(s!).length - 1); // the breach is the LAST beat; nothing follows it
  });

  it("a night that CAN come does not always come — pressure is the odds, not just the weight", () => {
    // `roll.value * SIEGE_PRESSURE_MAX >= pressure` is the coin. Nothing asserted it existed, so a
    // mutant that removed it — every night lands, always — survived the whole suite.
    let passed = 0;
    let landed = 0;
    for (const boot of seeds(200, "coin")) {
      const after = nights(based(boot.state, { at: "node.s.near", mass: 40, stash: 20 }), boot.graph);
      const b = beats(after);
      if (b.includes("siege.passed")) passed += 1;
      else if (b.length > 0) landed += 1;
    }
    expect(passed).toBeGreaterThan(0); // some nights go by
    expect(landed).toBeGreaterThan(0); // and some do not
    // …and the odds track the pressure: a heavier night lands more often than a lighter one
    const share = (mass: number): number => {
      let n = 0;
      for (const boot of seeds(200, "coin")) {
        if (!beats(nights(based(boot.state, { at: "node.s.near", mass, stash: 20 }), boot.graph)).includes("siege.passed")) n += 1;
      }
      return n;
    };
    expect(share(120)).toBeGreaterThan(share(20));
  });

  it("every beat it writes carries the numbers that produced it", () => {
    for (const boot of seeds(40, "beat")) {
      const s = nights(based(boot.state, { at: "node.s.near", mass: 80, stash: 30 }), boot.graph);
      for (const e of s.history.filter((h) => h.type.startsWith("siege."))) {
        const d = e.data as Record<string, number | boolean>;
        expect(e.subjects).toContain(HOME);
        expect(Number.isInteger(d["pressure"])).toBe(true);
        expect(Number.isInteger(d["defence"])).toBe(true);
        expect(Number.isInteger(d["overflow"])).toBe(true);
        expect(d["stashLost"] as number).toBeLessThanOrEqual(30);
      }
    }
  });

  it("cache losses are bounded by what the cache actually holds — never negative, never invented", () => {
    for (const boot of seeds(60, "bounded")) {
      const s = nights(based(boot.state, { at: "node.s.near", mass: 120, stash: 1 }), boot.graph);
      expect(stashUnits(s.player.stash)).toBeGreaterThanOrEqual(0);
      expect(stashUnits(s.player.stash)).toBeLessThanOrEqual(1);
    }
    expect(SIEGE_STASH_LOSS_DIVISOR).toBe(8);
  });
});

// --- through the real pipeline, and what a tenancy leaves behind ---------------------------------

describe("the siege arrives through the pipeline, not only through the hook (T83)", () => {
  it("a night SLEPT through resolves the night — the turn this system exists for", () => {
    // Stage 9 reconstructs the span from `ctx.before.meta.hour` because stage 2 has already moved the
    // clock. A 9-hour sleep from 21:00 resolves at 06:00, phase "dawn": if the stage read the RESOLVED
    // phase instead, this — the one turn the brief is about — is the one turn that could never fire.
    let slept = 0;
    for (const boot of seeds(40, "pipeline")) {
      const home = based(boot.state, { at: HOME, mass: 120, stash: 20 });
      const sleep = availableActions(home, boot.graph).find((c) => c.id === "sleep");
      if (sleep === undefined) continue;
      expect(sleep.timeCost).toBe(9); // 21:00 → 06:00
      const after = applyAction(home, sleep.action, boot.graph).state;
      if (beats(after).length > 0) slept += 1;
      expect(after.meta.phase).toBe("dawn"); // …and the beat landed anyway
    }
    expect(slept).toBeGreaterThan(0);
  });

  it("an ordinary daytime turn through the pipeline resolves nothing and banks nothing", () => {
    const { state, graph } = run(NODES, "pipeline-day");
    const day: GameState = { ...based(state, { mass: 120 }), meta: { ...state.meta, hour: 10, phase: "morning" } };
    const after = applyAction(day, { type: "wait", timeCost: 2 }, graph).state;
    expect(beats(after)).toStrictEqual([]);
    expect(after.world.siegeHours ?? 0).toBe(0);
  });
});

describe("ending a tenancy cleans up after itself (T83)", () => {
  const withWorker = (s: GameState): GameState => ({
    ...s,
    actors: { ...s.actors, "npc.w": companion("npc.w", HOME, "job.watch") } as never,
  });

  it("the banked night does not follow you to the next base", () => {
    // `world.siegeHours` is an accumulator for a SPECIFIC base. Carried across a loss, five hours banked
    // at a base you no longer hold buy a siege check on the first hour of the next one.
    const { state, graph } = run(NODES, "banked");
    const part = tickSiege(based(state, { mass: 40 }), graph, 22, 5);
    expect(part.world.siegeHours).toBe(5);
    for (const gone of [breachShelter(part, HOME), applyAction(part, { type: "abandon-shelter", choiceId: "abandon-shelter", timeCost: ABANDON_COST }, graph).state]) {
      expect(gone.player.shelterId).toBeNull();
      expect(gone.world.siegeHours ?? 0).toBe(0);
    }
  });

  it("a resident's job assignment ends with the base, or they are stranded forever", () => {
    // `withJob` forces `order: hold`, so a posted worker never follows the player. Left assigned at a
    // node that is no longer a base, they have no job pool that can reach them (every job path is gated
    // on `atOwnShelter`) and no order that would ever move them.
    const { state, graph } = run(NODES, "jobs");
    const staffed = withWorker(based(state, { stash: 5 }));
    expect(Object.keys((staffed.actors["npc.w"] as Survivor).flags)).toContain("job:job.watch");
    for (const gone of [breachShelter(staffed, HOME), applyAction(staffed, { type: "abandon-shelter", choiceId: "abandon-shelter", timeCost: ABANDON_COST }, graph).state]) {
      const w = gone.actors["npc.w"] as Survivor;
      expect(Object.keys(w.flags).some((k) => k.startsWith("job:"))).toBe(false);
      expect(w.flags[COMPANION_FLAG]).toBe(true); // still yours — the tenancy ended, not the friendship
      expect(w.location).toBe(HOME); // and not teleported: where they stand is their business
    }
  });
});

// --- breachShelter, on its own -------------------------------------------------------------------

describe("losing the base (T83)", () => {
  it("clears shelterId, scatters the cache and leaves the dead standing in the rooms", () => {
    const { state } = run();
    const home = based(state, { stash: 12, barricades: 40 });
    const gone = breachShelter(home, HOME);
    expect(gone.player.shelterId).toBeNull();
    expect(stashUnits(gone.player.stash)).toBe(0);
    expect(gone.nodes[HOME]!.barricades).toBe(0);
    // LITERAL. `+ SIEGE_BREACH_WALKERS` is the implementation restated and passes at 0 — and did, in
    // round three of the mutation run, after an unrelated edit removed the test that had been carrying it.
    expect(gone.nodes[HOME]!.walkers).toBe(state.nodes[HOME]!.walkers + 2);
    expect(SIEGE_BREACH_WALKERS).toBe(2);
  });

  it("a breached base is the open street again — the horde exemption goes with the wall", () => {
    const { state } = run();
    const home = { ...based(state, { barricades: SHELTER_SANCTUARY_AT }), hordes: [horde(HOME, 24)] };
    expect(overrunsPlayer(home)).toBe(false);
    expect(overrunsPlayer(breachShelter(home, HOME))).toBe(true);
    // …against LITERALS. `toBe(b < SHELTER_SANCTUARY_AT)` is the implementation restated and passes at
    // a threshold of 50 as happily as at 1 — which is exactly the mutant that survived round one, and
    // exactly the lesson T82 wrote down ("assert against a literal, or the assertion is the code
    // restated"). A bare claim is the open street; ANY wall at all is the sanctuary.
    const overrunAt = (b: number): boolean => overrunsPlayer({ ...based(state, { barricades: b }), hordes: [horde(HOME, 24)] });
    expect(overrunAt(0)).toBe(true);
    for (const b of [1, 2, 25, 50, 99, 100]) expect(overrunAt(b)).toBe(false);
    expect(SHELTER_SANCTUARY_AT).toBe(1);
  });
});

// --- where a base MAY be: the claimable gate ------------------------------------------------------

describe("NodeDef.claimable finally decides where a base may be (T83)", () => {
  it("is dark on a content set that authors no safehouse — every prior run is untouched", () => {
    const { state, graph } = run(NODES);
    expect(safehousesAuthored(graph)).toBe(false);
    const clean: GameState = { ...state, nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, searchPct: 100 } } };
    expect(canClaimShelter(clean, graph)).toBe(true);
    expect(canClaimShelter(clean)).toBe(true); // and without a graph at all
  });

  it("is live the moment ANY node authors it, and then only authored nodes qualify", () => {
    const { state, graph } = run(AUTHORED);
    expect(safehousesAuthored(graph)).toBe(true);
    const atHome: GameState = { ...state, nodes: { ...state.nodes, [HOME]: { ...state.nodes[HOME]!, searchPct: 100 } } };
    expect(canClaimShelter(atHome, graph)).toBe(false); // stripped clean, but not a safehouse
    const atFar: GameState = {
      ...atHome,
      player: { ...atHome.player, location: "node.s.far" },
      nodes: { ...atHome.nodes, "node.s.far": { ...atHome.nodes["node.s.far"]!, searchPct: 100 } },
    };
    expect(canClaimShelter(atFar, graph)).toBe(true);
  });

  it("tells the player which buildings could be a home, or the rule is invisible", () => {
    // Without this line the verb simply fails to appear on 46 of the shipped city's 60 nodes and
    // nothing says why — and the fourteen authored safehouses are the entire point of the field.
    const { state, graph } = run(AUTHORED);
    const standing: GameState = { ...state, player: { ...state.player, location: "node.s.far" } };
    expect(shelterLine(standing, graph)).toContain("could be made to hold");
    expect(shelterLine(state, graph)).toBeNull(); // not a safehouse: nothing is promised
    // …and it stops once you have a home, so it never competes with the base's own read
    const housed: GameState = { ...standing, player: { ...standing.player, shelterId: "node.s.near" } };
    expect(shelterLine(housed, graph)).toBeNull();
  });
});

// --- the abandon verb (PL-M3-07) ------------------------------------------------------------------

describe("walking away from a base you have outgrown (T83 · PL-M3-07)", () => {
  it("is offered only at the door, and clears the claim", () => {
    const { state, graph } = run();
    const home = based(state, {});
    expect(canAbandonShelter(home)).toBe(true);
    const choice = availableActions(home, graph).find((c) => c.id === "abandon-shelter");
    expect(choice?.timeCost).toBe(ABANDON_COST);
    const after = applyAction(home, choice!.action, graph).state;
    expect(after.player.shelterId).toBeNull();
    expect(after.history.some((e) => e.type === "shelter.abandoned")).toBe(true);
  });

  it("is NOT offered from across the city, and a forged one is inert", () => {
    const { state, graph } = run();
    const away = based(state, { at: "node.s.near" });
    expect(canAbandonShelter(away)).toBe(false);
    expect(availableActions(away, graph).map((c) => c.id)).not.toContain("abandon-shelter");
    const forged = applyAction(away, { type: "abandon-shelter", timeCost: ABANDON_COST }, graph).state;
    expect(forged.player.shelterId).toBe(HOME);
  });

  it("leaves the cache and the wall exactly where they stand — the opposite of a breach", () => {
    const { state, graph } = run();
    const home = based(state, { stash: 9, barricades: 50 });
    const after = applyAction(home, { type: "abandon-shelter", choiceId: "abandon-shelter", timeCost: ABANDON_COST }, graph).state;
    expect(stashUnits(after.player.stash)).toBe(9);
    expect(after.nodes[HOME]!.barricades).toBeGreaterThan(0);
    expect(after.nodes[HOME]!.walkers).toBe(state.nodes[HOME]!.walkers);
  });
});

// --- narration ------------------------------------------------------------------------------------

describe("the dark says something before it does something (T83)", () => {
  it("reads the night only from inside your own base, and only when there is something to read", () => {
    const { state, graph } = run();
    expect(siegeLine(based(state, { at: "node.s.near", mass: 120 }), graph)).toBeNull(); // not home
    const day: GameState = { ...based(state, { mass: 120 }), meta: { ...state.meta, hour: 12, phase: "midday" } };
    expect(siegeLine(day, graph)).toBeNull();
    expect(siegeLine(based(state, { mass: 120 }), graph)).toContain("moving out there");
  });

  it("says whether the walls will hold, and changes its mind when they will not", () => {
    const { state, graph } = run();
    expect(siegeLine(based(state, { mass: 120 }), graph)).toContain("will not hold all of it");
    const tiny = based(state, { mass: 20 });
    expect(siegeLine(tiny, graph)).toContain("should hold");
    expect(shelterLine(based(state, { mass: 120 }), graph)).toContain("moving out there");
  });

  it("reads the WALL, which siegeDefence deliberately does not — the line is about the walls", () => {
    // The audit found this line comparing pressure against `siegeDefence` alone, which excludes
    // `barricades` on purpose — so at a HUNDRED barricades it said "the walls will not hold all of it",
    // wrong in exactly the case fortifying exists to fix. The fix then survived the first mutation run,
    // because it shipped without this test: the T77/T82 lesson, a third time.
    const { state, graph } = run();
    const heavy = { mass: 120 } as const;
    expect(siegeLine(based(state, { ...heavy, barricades: 0 }), graph)).toContain("will not hold all of it");
    expect(siegeLine(based(state, { ...heavy, barricades: 100 }), graph)).toContain("should hold");
    // and it turns over somewhere in between, monotonically
    const holds = [0, 25, 50, 75, 100].map((b) => siegeLine(based(state, { ...heavy, barricades: b }), graph)!.includes("should hold"));
    expect(holds[0]).toBe(false);
    expect(holds[holds.length - 1]).toBe(true);
    expect(holds.slice(1).every((h, i) => h >= holds[i]!)).toBe(true);
  });
});

// --- determinism, save-losslessness, no new rung --------------------------------------------------

describe("determinism, save-losslessness and no new schema rung (T83 · ADR-0001/0003)", () => {
  it("replays byte-identically from the same seed", () => {
    const a = run(NODES, "replay");
    const b = run(NODES, "replay");
    expect(JSON.stringify(nights(based(a.state, { mass: 120, stash: 20 }), a.graph)))
      .toBe(JSON.stringify(nights(based(b.state, { mass: 120, stash: 20 }), b.graph)));
  });

  it("round-trips losslessly and stays on save v10", () => {
    const { state, graph } = run(NODES, "save");
    const after = nights(based(state, { at: "node.s.near", mass: 120, stash: 20 }), graph);
    const text = saveGame(after);
    expect((JSON.parse(text) as { saveSchemaVersion: number }).saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(SAVE_SCHEMA_VERSION).toBe(10);
    expect(JSON.stringify(loadGame(text))).toBe(JSON.stringify(after));
  });

  it("every numeric leaf it writes is a whole number", () => {
    const { state, graph } = run(NODES, "ints");
    const after = nights(based(state, { at: "node.s.near", mass: 120, stash: 20 }), graph);
    const walk = (v: unknown): void => {
      if (typeof v === "number") expect(Number.isInteger(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk({ world: after.world, nodes: after.nodes, player: { ...after.player, stash: after.player.stash } });
  });

  it("is fully inert without a graph — it may not bank hours it could never spend", () => {
    // The audit found a graph-less advance banking night hours and then SPENDING them on nights that
    // could not resolve (`siegePressure` is 0 without a graph), so a pool-less fast-forward silently
    // consumed the nights a real one would have played. The fix then SURVIVED round one of the mutation
    // run, because it shipped without a test — the T77 lesson, hit again inside this very task.
    const { state, graph } = run(NODES, "nograph");
    // A full wall, so four nights actually resolve instead of the base falling on the first one.
    const home = based(state, { mass: 120, stash: 20, barricades: 100 });
    // A PARTIAL night is the case that distinguishes the two: on a whole number of nights the banked
    // remainder is 0 either way, so a graph-less call that wrongly proceeded would still return the
    // same object and the assertion would be vacuous — which is exactly why the first version of this
    // test let the mutant through a second time.
    expect(tickSiege(home, undefined, 22, 5)).toBe(home); // same reference: nothing happened at all
    expect(tickSiege(home, undefined, 22, 5).world.siegeHours ?? 0).toBe(0); // and NOTHING was banked
    expect(tickSiege(home, undefined, 21, 24 * 4)).toBe(home); // …whole nights too
    // …and those same hours DO bank and resolve once a graph is present
    expect(tickSiege(home, graph, 22, 5).world.siegeHours).toBe(5);
    expect(beats(tickSiege(home, graph, 21, 24 * 4)).length).toBe(4);
  });

  it("draws from its OWN named stream, so no other system's sequence moves", () => {
    // The whole byte-identity argument rests on this. A mutant that pointed `SIEGE_STREAM` at "combat"
    // survived round three, because every determinism test in this file compares a siege result against
    // another siege result — which moves together whichever stream it is drawn from.
    expect(SIEGE_STREAM).toBe("siege");
    const { state, graph } = run(NODES, "stream");
    const before = based(state, { at: "node.s.near", mass: 120, stash: 20 });
    const after = nights(before, graph);
    expect(beats(after).length).toBe(1); // a night really did resolve, so a draw really was taken
    expect(Object.keys(after.rng.streams)).toContain("siege");
    // …and every OTHER stream is untouched, byte for byte
    for (const name of Object.keys(before.rng.streams)) {
      expect(JSON.stringify(after.rng.streams[name])).toBe(JSON.stringify(before.rng.streams[name]));
    }
  });

  it("takes no draw at all on a run with no base — the whole existing suite is unshifted", () => {
    const { state, graph } = run(NODES, "nodraw");
    const homeless: GameState = { ...state, meta: { ...state.meta, hour: 21 }, hordes: [horde("node.s.near", 120)] };
    const after = tickSiege(homeless, graph, 21, SIEGE_HOURS_PER_NIGHT * 4);
    expect(after).toBe(homeless);
    expect(JSON.stringify(after.rng)).toBe(JSON.stringify(homeless.rng));
  });

  it("an off-screen advance can cost you the base you were not standing in", () => {
    let lost = 0;
    for (const boot of seeds(40, "offscreen")) {
      const s = based(boot.state, { at: "node.s.near", mass: 120, stash: 20 });
      if (advanceWorld(s, SIEGE_HOURS_PER_NIGHT, boot.graph).player.shelterId === null) lost += 1;
    }
    expect(lost).toBeGreaterThan(0);
  });

  it("never drives a quantity out of its range, over any span and any mass (property)", () => {
    const { state, graph } = run(NODES, "prop");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 120 }), fc.integer({ min: 0, max: 100 }), (hours, mass, wall) => {
        const s = nights(based(state, { at: "node.s.near", mass, stash: 20, barricades: wall }), graph, 1);
        const out = tickSiege(s, graph, 21, hours);
        const b = out.nodes[HOME]?.barricades ?? 0;
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(100);
        expect(out.world.siegeHours ?? 0).toBeLessThan(SIEGE_HOURS_PER_NIGHT);
        expect(stashUnits(out.player.stash)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 60 },
    );
  });
});
