import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FIRE_NOISE,
  HORDE_AWARENESS,
  HORDE_HOURS_PER_STEP,
  HORDE_MAX_SIZE,
  HORDE_MIN_SIZE,
  HORDE_DISABLED_FLAG,
  REPATH_NOISE,
  applyAction,
  availableActions,
  hordeAt,
  hordeMassAt,
  hordeSizeFor,
  loudestAudible,
  massAction,
  nodeCeiling,
  rosterOf,
  seedStarterHordes,
  startRun,
  tickHordes,
  withRoster,
  ZOMBIE_WALKER,
  type GameState,
  type Horde,
  type NodeDef,
  type NodeState,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T26 — migrating hordes that re-path to noise (FR-SIM-07, FR-CBT-08). A logged gunshot within a
 * horde's hearing redirects it; without a stimulus it migrates. It is routed by noise, never fought.
 *
 * T76 — the mass acquires mechanical weight. Seeding is per authored region density (so a content set
 * that authors no dead gets no horde), the walk is step-exact under any chunking, and a horde trades
 * exactly one body with every node it enters, conserving `sum(walkers) + sum(size)`. The player-facing
 * collision lives in `overrun.test.ts`.
 */

// A five-node line: n0—n1—n2—n3—n4, start at n0. Density 60 clears HORDE_SEED_MIN_DENSITY, so this
// region seeds a horde; the QUIET_REGIONS twin authors none and therefore gets none.
const DENSITY = 60;
const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50, zombieDensity: DENSITY } }];
const NODES: NodeDef[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `node.x.${i}`,
  regionId: "region.x",
  name: `N${i}`,
  description: `n${i}`,
  adjacent: [i - 1, i + 1].filter((j) => j >= 0 && j <= 4).map((j) => `node.x.${j}`),
  ...(i === 0 ? { start: true } : {}),
}));
const opts = { seed: "horde-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

/** The same five-node line with NO authored zombie density — the pre-T76 fixture shape. */
const QUIET_REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const quietRun = (): { state: GameState; graph: RegionGraph } => startRun(opts, QUIET_REGIONS, NODES);

const withHorde = (state: GameState, pos: string, patch: Partial<Horde> = {}): GameState => ({
  ...state,
  hordes: [{ id: "horde.1", size: 20, pos, dest: null, speed: 1, awareness: HORDE_AWARENESS, types: [ZOMBIE_WALKER], ...patch }],
});
const gunshotAt = (state: GameState, id: string): GameState => ({
  ...state,
  nodes: { ...state.nodes, [id]: { ...state.nodes[id]!, noise: FIRE_NOISE } },
});
const bodies = (s: GameState): number => Object.values(s.nodes).reduce((a, n) => a + n.walkers, 0);
const mass = (s: GameState): number => s.hordes.reduce((a, h) => a + h.size, 0);
/** Put exactly `n` plain walkers at a node. */
const stand = (s: GameState, id: string, n: number): GameState => ({
  ...s,
  nodes: { ...s.nodes, [id]: withRoster(s.nodes[id]!, Array.from({ length: n }, () => ZOMBIE_WALKER)) },
});

describe("seeding is driven by authored density (T26 · T76)", () => {
  it("seeds one mass per region that authors dead, sized by that density, never on the start node", () => {
    const regions: RegionDef[] = [
      { id: "region.a", name: "A", description: "a", baseline: { zombieDensity: 80 } },
      { id: "region.b", name: "B", description: "b", baseline: { zombieDensity: 60 } },
      // below HORDE_SEED_MIN_DENSITY — a quiet district gets no mass, which on the shipped city is
      // what keeps Rivermouth (the START region, 45) horde-free
      { id: "region.c", name: "C", description: "c", baseline: { zombieDensity: 45 } },
    ];
    const nodes: NodeDef[] = [
      { id: "node.a.0", regionId: "region.a", name: "a0", description: "", adjacent: ["node.a.1"], start: true },
      { id: "node.a.1", regionId: "region.a", name: "a1", description: "", adjacent: ["node.a.0", "node.b.0"] },
      { id: "node.b.0", regionId: "region.b", name: "b0", description: "", adjacent: ["node.a.1", "node.b.1"] },
      { id: "node.b.1", regionId: "region.b", name: "b1", description: "", adjacent: ["node.b.0", "node.c.0"] },
      { id: "node.c.0", regionId: "region.c", name: "c0", description: "", adjacent: ["node.b.1"] },
    ];
    const { state } = startRun(opts, regions, nodes);
    // Discriminates against the unfixed code, which seeded exactly ONE horde of STARTER_HORDE_SIZE at
    // the last node by sorted id regardless of how many regions the set had or what they authored.
    expect(state.hordes.map((h) => h.id)).toStrictEqual(["horde.region.a", "horde.region.b"]);
    expect(state.hordes.map((h) => h.size)).toStrictEqual([hordeSizeFor(80), hordeSizeFor(60)]);
    // furthest from the start node within each region, ties by sorted id
    expect(state.hordes.map((h) => h.pos)).toStrictEqual(["node.a.1", "node.b.1"]);
    expect(state.hordes.some((h) => h.pos === "node.a.0")).toBe(false);
  });

  it("a content set that authors NO zombie density anywhere seeds no horde at all", () => {
    // The rule T75's repopulation already keeps: density 0 means the author said there are no dead
    // here, so nothing invents a mass of twenty-four for them. Discriminates directly against the
    // unfixed code, which seeded one horde unconditionally on exactly this fixture.
    expect(quietRun().state.hordes).toStrictEqual([]);
  });

  it("sizes the band the way the note asked: 8 at density 0, 40 at 100, monotone between", () => {
    // literals, not the constants back at themselves — the note asked for a 8–40 band by name
    expect(hordeSizeFor(0)).toBe(8);
    expect(hordeSizeFor(100)).toBe(40);
    expect([HORDE_MIN_SIZE, HORDE_MAX_SIZE]).toStrictEqual([8, 40]);
    // the shipped city's three seeded masses, by authored density
    expect([hordeSizeFor(85), hordeSizeFor(80), hordeSizeFor(60)]).toStrictEqual([35, 33, 27]);
    for (let d = 1; d <= 100; d += 1) expect(hordeSizeFor(d)).toBeGreaterThanOrEqual(hordeSizeFor(d - 1));
    // total by construction against a hand-edited / out-of-range baseline
    expect(hordeSizeFor(-50)).toBe(HORDE_MIN_SIZE);
    expect(hordeSizeFor(500)).toBe(HORDE_MAX_SIZE);
    expect(hordeSizeFor(Number.NaN)).toBe(HORDE_MIN_SIZE);
  });

  it("seeds nothing for an empty graph shape", () => {
    expect(seedStarterHordes({ regions: {}, nodes: {}, startNodeId: "" } as unknown as RegionGraph)).toStrictEqual([]);
  });
});

describe("loudestAudible — a horde hears within its awareness (T26)", () => {
  it("finds a gunshot within range and ignores ordinary sound", () => {
    const { state, graph } = run();
    const shot = gunshotAt(state, "node.x.2");
    expect(loudestAudible(shot, graph, "node.x.1", HORDE_AWARENESS)).toBe("node.x.2"); // 1 hop away
    // a search-level sound (below the re-path bar) never redirects a horde
    const faint = { ...state, nodes: { ...state.nodes, "node.x.2": { ...state.nodes["node.x.2"]!, noise: REPATH_NOISE - 1 } } };
    expect(loudestAudible(faint, graph, "node.x.1", HORDE_AWARENESS)).toBeNull();
  });
  it("does not hear a gunshot beyond its awareness", () => {
    const { state, graph } = run();
    const shot = gunshotAt(state, "node.x.4");
    expect(loudestAudible(shot, graph, "node.x.0", HORDE_AWARENESS)).toBeNull(); // 4 hops away
  });
});

describe("a gunshot re-paths a nearby horde — the DoD (T26 · FR-SIM-07)", () => {
  it("re-paths toward a gunshot within hearing, and steps toward it", () => {
    const { state, graph } = run();
    const s = gunshotAt(withHorde(state, "node.x.0"), "node.x.2");
    const after = tickHordes(s, 6, graph); // a rest's worth of hours
    expect(after.hordes[0]!.dest).toBe("node.x.2");
    expect(after.hordes[0]!.pos).toBe("node.x.1"); // one step toward the shot
  });

  it("does NOT chase a gunshot beyond hearing (it wanders instead)", () => {
    const { state, graph } = run();
    const s = gunshotAt(withHorde(state, "node.x.0"), "node.x.4"); // 4 hops, awareness 2
    const after = tickHordes(s, 6, graph);
    expect(after.hordes[0]!.dest).not.toBe("node.x.4");
  });

  it("re-paths in the whole target share of in-range cases (rate over seeds)", () => {
    let repathed = 0;
    const trials = 40;
    for (let k = 0; k < trials; k++) {
      const { state, graph } = startRun({ seed: `shot-${k}`, createdAt: opts.createdAt }, REGIONS, NODES);
      const s = gunshotAt(withHorde(state, "node.x.0"), "node.x.2"); // 2 hops, in range
      if (tickHordes(s, 4, graph).hordes[0]!.dest === "node.x.2") repathed++;
    }
    expect(repathed / trials).toBeGreaterThanOrEqual(0.9); // in-range gunshots reliably pull the horde
  });
});

describe("migration & discipline (T26)", () => {
  it("a horde with no stimulus migrates, deterministically", () => {
    const { state, graph } = run();
    const s = withHorde(state, "node.x.2");
    const one = HORDE_HOURS_PER_STEP; // exactly one step, so "it left" is unambiguous
    const a = tickHordes(s, one, graph);
    const b = tickHordes(s, one, graph);
    expect(JSON.stringify(a.hordes)).toBe(JSON.stringify(b.hordes));
    expect(a.hordes[0]!.pos).not.toBe("node.x.2"); // it migrated from where it stood
    // Over more hours it keeps moving and stays deterministic — but note it may pass back through
    // where it started, because as of T76 a wander destination is re-picked on every ARRIVAL rather
    // than once per tick, which is what makes the walk chunk-exact below.
    expect(JSON.stringify(tickHordes(s, 8, graph).hordes)).toBe(JSON.stringify(tickHordes(s, 8, graph).hordes));
  });

  it("is inert without a graph, with no hordes, on a zero-hour tick, or when the layer is off", () => {
    const { state, graph } = run();
    const s = withHorde(state, "node.x.2");
    expect(tickHordes(s, 6, undefined)).toBe(s);
    expect(tickHordes(s, 0, graph)).toBe(s);
    expect(tickHordes({ ...state, hordes: [] }, 6, graph).hordes).toStrictEqual([]);
    // T76: one flag switches the whole layer off, mirroring `director.disabled` / `repopulate.disabled`.
    const off: GameState = { ...s, world: { ...s.world, flags: { ...s.world.flags, [HORDE_DISABLED_FLAG]: true } } };
    expect(tickHordes(off, 48, graph)).toBe(off);
  });

  it("never lands a horde on a non-node (property over random play)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 24 }), { minLength: 1, maxLength: 20 }), (hoursSeq) => {
        let { state, graph } = run();
        const ids = new Set(Object.keys(state.nodes));
        for (const hours of hoursSeq) {
          state = tickHordes(state, hours, graph);
          for (const h of state.hordes) expect(ids.has(h.pos)).toBe(true);
        }
      }),
    );
  });

  it("FR-CBT-08: a horde is never a combat target — it offers no fight action", () => {
    const { state, graph } = run();
    // Stand the player where the horde is, WITH walkers underfoot — the pre-T76 build offered the T15
    // encounter branch here (`fight` / `slip:…`) because nothing consulted the horde, so the fixture
    // needs bodies for this to discriminate rather than merely describe an empty node.
    const here = state.hordes[0]!.pos;
    const s = stand({ ...state, player: { ...state.player, location: here } }, here, 3);
    const ids = availableActions(s, graph).map((c) => c.id);
    expect(ids.some((i) => i.includes("horde"))).toBe(false);
    expect(ids).not.toContain("fight");
    expect(ids).not.toContain("fire");
    expect(ids.some((i) => i.startsWith("slip:"))).toBe(false);
  });

  it("loudestAudible still hears its own neighbours at awareness 0 or below", () => {
    const { state, graph } = run();
    const shot = gunshotAt(state, "node.x.2");
    expect(loudestAudible(shot, graph, "node.x.1", 0)).toBe("node.x.2");
    expect(loudestAudible(shot, graph, "node.x.1", -3)).toBe("node.x.2");
  });
});

describe("the walk is step-exact under any chunking (T76)", () => {
  it("one N-hour advance lands where any chunking of those N hours lands, with nothing audible", () => {
    const { state, graph } = run();
    const s = withHorde(state, "node.x.4");
    const N = 96;
    const oneShot = tickHordes(s, N, graph);
    let chunked = s;
    for (let i = 0; i < N / 2; i += 1) chunked = tickHordes(chunked, 2, graph);
    // Discriminates hard against the unfixed code: it walked at most to its CURRENT destination and
    // dropped the remaining banked steps, and picked a wander target once per tick rather than once
    // per arrival, so the two paths diverged (measured on the shipped city at 240h:
    // node.ironworks.machine-shop one-shot vs node.ironworks.loading-canal chunked).
    expect(oneShot.hordes[0]!.pos).toBe(chunked.hordes[0]!.pos);
    expect(oneShot.hordes[0]!.size).toBe(chunked.hordes[0]!.size);
    expect(JSON.stringify(oneShot.nodes)).toBe(JSON.stringify(chunked.nodes));
  });

  it("holds with SEVERAL masses sharing the map and the rng stream (the interleaving)", () => {
    // The hazard T75 hit with one shared `repop` stream across regions: hordes share `nodes` and the
    // `horde` stream, so letting one walk its whole span before the next starts changes both what it
    // finds and the draw order. A chunked replay gives every horde one step per tick, in order, so the
    // one-shot walk has to interleave the same way. Measured on the shipped 60-node city before the
    // interleaving: three masses at ridge-road/parking-structure/subway-entrance one-shot vs
    // waterworks/rail-depot/elm-court chunked over the same 480 hours.
    const { state, graph } = run();
    const many: GameState = stand(
      {
        ...state,
        hordes: [
          { ...withHorde(state, "node.x.0").hordes[0]!, id: "horde.a", pos: "node.x.0" },
          { ...withHorde(state, "node.x.2").hordes[0]!, id: "horde.b", pos: "node.x.2" },
          { ...withHorde(state, "node.x.4").hordes[0]!, id: "horde.c", pos: "node.x.4" },
        ],
      },
      "node.x.2",
      nodeCeiling(DENSITY) + 2,
    );
    const N = 120;
    const oneShot = tickHordes(many, N, graph);
    let chunked = many;
    for (let i = 0; i < N / 2; i += 1) chunked = tickHordes(chunked, 2, graph);
    expect(JSON.stringify(oneShot.hordes)).toBe(JSON.stringify(chunked.hordes));
    expect(JSON.stringify(oneShot.nodes)).toBe(JSON.stringify(chunked.nodes));
  });

  it("holds for arbitrary chunk sizes (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 6, max: 24 }), (chunk, count) => {
        const { state, graph } = run();
        const s = withHorde(state, "node.x.3");
        const total = chunk * count;
        let chunked = s;
        for (let i = 0; i < count; i += 1) chunked = tickHordes(chunked, chunk, graph);
        expect(tickHordes(s, total, graph).hordes[0]!.pos).toBe(chunked.hordes[0]!.pos);
      }),
      { numRuns: 40 },
    );
  });
});

describe("a horde carries bodies — massAction (T76)", () => {
  const nodeWith = (n: number): NodeState =>
    withRoster(
      {
        regionId: "region.x", searchPct: 0, damage: 0, corpses: 0, blood: 0, barricades: 0, traps: [], occupants: [],
        discoveries: [], playerNotes: [], lastVisit: null, noise: 0, walkers: 0, zombieTypes: [], zombieState: "dormant",
        discovered: true, rooms: [],
      },
      Array.from({ length: n }, () => ZOMBIE_WALKER),
    );

  it("sheds one body onto a node UNDER its region's carrying capacity", () => {
    const ceiling = nodeCeiling(DENSITY); // 40 ⇒ 3
    const node = nodeWith(ceiling - 1);
    const out = massAction(node, 20, DENSITY);
    expect(rosterOf(out.node).length).toBe(ceiling); // +1 body
    expect(out.size).toBe(19); // −1 mass: it came OUT of the horde
  });

  it("absorbs one body off a node OVER its capacity, taking the newest (the tail)", () => {
    const ceiling = nodeCeiling(DENSITY);
    const node = withRoster(nodeWith(0), ["zombie.riot", ...Array.from({ length: ceiling }, () => ZOMBIE_WALKER)]);
    const out = massAction(node, 20, DENSITY);
    expect(rosterOf(out.node).length).toBe(ceiling);
    expect(rosterOf(out.node)[0]).toBe("zombie.riot"); // the authored special is the LAST thing swept up
    expect(out.size).toBe(21);
  });

  it("does nothing at exactly the ceiling — the stable fixed point, so a parked horde cannot oscillate", () => {
    const node = nodeWith(nodeCeiling(DENSITY));
    const out = massAction(node, 20, DENSITY);
    expect(out.node).toBe(node); // same reference: nothing written
    expect(out.size).toBe(20);
  });

  it("the SIZE FLOOR is the sole binding constraint at HORDE_MIN_SIZE on an under-ceiling node", () => {
    // contested (so the quiet-node bound is not what stops it) and under its ceiling (so the ceiling
    // would allow a shed): only the size floor is binding
    const node = nodeWith(1);
    expect(rosterOf(node).length).toBeGreaterThan(0);
    expect(rosterOf(node).length).toBeLessThan(nodeCeiling(DENSITY));
    expect(massAction(node, HORDE_MIN_SIZE, DENSITY)).toStrictEqual({ node, size: HORDE_MIN_SIZE });
    expect(massAction(node, HORDE_MIN_SIZE + 1, DENSITY).size).toBe(HORDE_MIN_SIZE); // one above ⇒ it sheds
  });

  it("the SIZE CEILING is the sole binding constraint at HORDE_MAX_SIZE on an over-ceiling node", () => {
    const over = nodeWith(nodeCeiling(DENSITY) + 2);
    expect(rosterOf(over).length).toBeGreaterThan(nodeCeiling(DENSITY)); // the node WOULD give one up
    expect(massAction(over, HORDE_MAX_SIZE, DENSITY)).toStrictEqual({ node: over, size: HORDE_MAX_SIZE });
    expect(massAction(over, HORDE_MAX_SIZE - 1, DENSITY).size).toBe(HORDE_MAX_SIZE); // one below ⇒ it absorbs
  });

  it("absorbs a plain walker, never an authored special — and leaves a specials-only node alone", () => {
    // The tail of a roster can be a special. Sweeping one up and re-emitting it later as a plain
    // walker (a horde is composed of walkers and `horde.types` is not updated by this pass) would
    // launder a Riot into a walker, which is the exact type/population incoherence T75 removed.
    const ceiling = nodeCeiling(DENSITY);
    const mixed = withRoster(nodeWith(0), [
      ...Array.from({ length: ceiling }, () => ZOMBIE_WALKER),
      "zombie.riot",
    ]);
    const out = massAction(mixed, 20, DENSITY);
    expect(out.size).toBe(21);
    expect(rosterOf(out.node)).toContain("zombie.riot"); // the special is NOT the one taken
    expect(rosterOf(out.node).filter((t) => t === ZOMBIE_WALKER)).toHaveLength(ceiling - 1);

    // a node over its ceiling holding nothing BUT specials is left entirely alone
    const specials = withRoster(nodeWith(0), ["zombie.riot", "zombie.bloated", "zombie.fresh", "zombie.crawler", "zombie.screamer"]);
    expect(rosterOf(specials).length).toBeGreaterThan(ceiling);
    expect(massAction(specials, 20, DENSITY)).toStrictEqual({ node: specials, size: 20 });
  });

  it("conserves a body even when withRoster DROPS a malformed roster entry", () => {
    // `rosterOf` returns a stored roster verbatim when its length agrees with `walkers`, invalid
    // entries included, but `withRoster` filters them on write and rewrites `walkers` to match. A
    // flat ±1 credit to the horde would therefore DELETE bodies from the world on this path — which
    // is reachable from authored content, since `seedRoster` copies `zombieTypes` through unfiltered
    // and a `["", "zombie.riot"]` typo ships a node that eats a body the first time a mass crosses it.
    // The trade credits the ACTUAL delta instead, so the total holds. Fails against a ±1 version:
    // shed 23 → 22, absorb 25 → 23.
    const dirty: NodeState = { ...nodeWith(0), walkers: 3, roster: [ZOMBIE_WALKER, "", ZOMBIE_WALKER], zombieTypes: [] };
    const shed = massAction(dirty, 20, DENSITY); // 3 < ceiling 4 ⇒ sheds
    expect(rosterOf(shed.node).length + shed.size).toBe(rosterOf(dirty).length + 20);
    const dirtyOver: NodeState = { ...nodeWith(0), walkers: 5, roster: [ZOMBIE_WALKER, "", ZOMBIE_WALKER, "", ZOMBIE_WALKER], zombieTypes: [] };
    const absorbed = massAction(dirtyOver, 20, DENSITY); // 5 > ceiling 4 ⇒ absorbs
    expect(rosterOf(absorbed.node).length + absorbed.size).toBe(rosterOf(dirtyOver).length + 20);
  });

  it("stays inside the size band even when the delta credit is larger than one", () => {
    // `withRoster` can drop several malformed entries alongside the body actually taken, so the delta
    // credit (which exists to keep bodies conserved) can exceed 1. Unclamped, a horde at 39 came back
    // at 42 — which would make HORDE_MAX_SIZE's "never balloons without bound" false on exactly the
    // input the delta credit was added for.
    const junky: NodeState = { ...nodeWith(0), walkers: 3, roster: [ZOMBIE_WALKER, "", ""], zombieTypes: [] };
    expect(rosterOf(junky).length).toBeGreaterThan(nodeCeiling(0)); // over the ceiling at density 0
    const out = massAction(junky, HORDE_MAX_SIZE - 1, 0);
    expect(out.size).toBe(HORDE_MAX_SIZE);
    expect(out.size).toBeLessThanOrEqual(HORDE_MAX_SIZE);
  });

  it("is total against a hand-edited size (NaN / negative / fractional)", () => {
    const node = nodeWith(0);
    for (const bad of [Number.NaN, -5, 3.7]) {
      const out = massAction(node, bad, DENSITY);
      expect(Number.isInteger(out.size)).toBe(true);
      expect(out.size).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the mass is conserved across a tick (T76)", () => {
  it("bodies MOVE between the map and the horde, and the total never changes", () => {
    const { state, graph } = run();
    // Stack node 4 above its ceiling and leave the rest empty, so the horde has both a source and sinks.
    const s = stand(withHorde(state, "node.x.4"), "node.x.4", nodeCeiling(DENSITY) + 3);
    const total = bodies(s) + mass(s);
    const after = tickHordes(s, HORDE_HOURS_PER_STEP * 10, graph);
    // discriminator #1 — bodies actually moved (the unfixed layer never wrote `nodes` at all)
    expect(bodies(after)).not.toBe(bodies(s));
    expect(mass(after)).not.toBe(mass(s));
    // discriminator #2 — and every body that left one side arrived on the other
    expect(bodies(after) + mass(after)).toBe(total);
  });

  it("conservation holds over a long, arbitrarily chunked run (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 4, maxLength: 30 }), (hoursSeq) => {
        const { state, graph } = run();
        let s = stand(withHorde(state, "node.x.4"), "node.x.2", nodeCeiling(DENSITY) + 4);
        const total = bodies(s) + mass(s);
        for (const hours of hoursSeq) s = tickHordes(s, hours, graph);
        expect(bodies(s) + mass(s)).toBe(total);
        expect(s.hordes[0]!.size).toBeGreaterThanOrEqual(HORDE_MIN_SIZE);
        expect(s.hordes[0]!.size).toBeLessThanOrEqual(HORDE_MAX_SIZE);
      }),
      { numRuns: 40 },
    );
  });

  it("the mass pass takes NO rng draw — only the wander pick does", () => {
    const { state, graph } = run();
    // dest is one hop away, so the walk arrives without ever needing a wander pick this tick…
    const s = withHorde(stand(state, "node.x.3", 1), "node.x.2", { dest: "node.x.3" });
    const after = tickHordes(s, HORDE_HOURS_PER_STEP, graph);
    expect(after.hordes[0]!.pos).toBe("node.x.3");
    expect(after.rng).toBe(state.rng); // …and the body it shed there cost nothing from any stream
    expect(after.nodes).not.toBe(state.nodes); // but a body WAS shed
  });

  it("NEVER turns a quiet node into a contested one — the hard bound on encounter shadowing", () => {
    // `walkers > 0` gates the whole explore branch and all encounter selection (PL-M5-10), and
    // `nodeCeiling` bottoms out at 1, so an under/over rule that ignored the quiet case would have a
    // horde deposit a body on every empty node it crossed. Measured on the shipped city with that
    // rule: 30 off-screen days took quiet nodes from 11 of 60 to ZERO of 60 — the encounter system
    // switched off city-wide. The shed therefore requires a body to already be standing there, which
    // makes this invariant absolute: T76 can only ever REDUCE shadowing, by absorbing a node's last
    // bodies, never add to it.
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 4, maxLength: 24 }), (hoursSeq) => {
        const { state, graph } = run();
        let s = stand(withHorde(state, "node.x.4", { size: HORDE_MAX_SIZE }), "node.x.2", 2);
        const quietBefore = Object.entries(s.nodes).filter(([, n]) => n.walkers === 0).map(([id]) => id);
        for (const hours of hoursSeq) s = tickHordes(s, hours, graph);
        for (const id of quietBefore) expect(s.nodes[id]!.walkers).toBe(0);
      }),
      { numRuns: 40 },
    );
  });

  it("reads the LIVE region density, not the authored baseline the seed used", () => {
    // Seeding anchors on the author's intent; where a mass settles its bodies is a fact about the
    // district as it is NOW. Drift the live dial down and the trade must follow it: at live density 0
    // the ceiling is 1, so a node holding 3 is over capacity and gives one up, where at the authored
    // 60 (ceiling 4) it would have been given one instead.
    const { state, graph } = run();
    const s = stand(withHorde(state, "node.x.2", { dest: "node.x.3" }), "node.x.3", 3);
    const drifted: GameState = { ...s, regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, zombieDensity: 0 } } };
    expect(tickHordes(s, HORDE_HOURS_PER_STEP, graph).nodes["node.x.3"]!.walkers).toBe(4); // shed
    expect(tickHordes(drifted, HORDE_HOURS_PER_STEP, graph).nodes["node.x.3"]!.walkers).toBe(2); // absorbed
  });

  it("leaves the player's claimed shelter alone — no bodies garrisoned in your own base", () => {
    // T75 hard-excluded the shelter from repopulation and `repopulate.ts` reserves the base assault
    // for T83 ("not this pass's to sneak in"). A mass may walk over the base; it does not garrison it.
    const { state, graph } = run();
    const s0 = stand(withHorde(state, "node.x.2", { dest: "node.x.3" }), "node.x.3", 1);
    const based: GameState = { ...s0, player: { ...s0.player, shelterId: "node.x.3" } };
    expect(tickHordes(s0, HORDE_HOURS_PER_STEP, graph).nodes["node.x.3"]!.walkers).toBe(2); // shed…
    const after = tickHordes(based, HORDE_HOURS_PER_STEP, graph);
    expect(after.hordes[0]!.pos).toBe("node.x.3"); // …the mass still walks in…
    expect(after.nodes["node.x.3"]!.walkers).toBe(1); // …but leaves nothing behind
  });

  it("scrubs a hand-edited horde size rather than propagating it", () => {
    const { state, graph } = run();
    for (const bad of [Number.NaN, -4, 12.6]) {
      const s = stand(withHorde(state, "node.x.2", { size: bad as number }), "node.x.3", 1);
      const after = tickHordes(s, HORDE_HOURS_PER_STEP * 4, graph);
      expect(Number.isInteger(after.hordes[0]!.size)).toBe(true);
      expect(after.hordes[0]!.size).toBeGreaterThanOrEqual(0);
    }
    // and the reader is total too, so nothing downstream ever sees the raw value
    const nan = withHorde(state, "node.x.2", { size: Number.NaN as number });
    expect(hordeMassAt(nan, "node.x.2")).toBe(0);
  });

  it("hordeAt / hordeMassAt read the masses standing on a node", () => {
    const { state } = run();
    const s = withHorde(state, "node.x.2");
    expect(hordeAt(s, "node.x.2")?.id).toBe("horde.1");
    expect(hordeAt(s, "node.x.1")).toBeNull();
    expect(hordeMassAt(s, "node.x.2")).toBe(20);
    // two masses converged on one node sum, and `hordeAt` picks the first by sorted id
    const two: GameState = { ...s, hordes: [{ ...s.hordes[0]!, id: "horde.2" }, { ...s.hordes[0]!, id: "horde.1" }] };
    expect(hordeAt(two, "node.x.2")?.id).toBe("horde.1");
    expect(hordeMassAt(two, "node.x.2")).toBe(40);
  });
});

describe("the layer's write boundary (T76)", () => {
  it("writes hordes + nodes + rng, and never the player, world, regions, routes or clock", () => {
    const { state, graph } = run();
    const s = stand(withHorde(state, "node.x.4"), "node.x.4", nodeCeiling(DENSITY) + 2);
    const after = tickHordes(s, 48, graph);
    expect(after.hordes).not.toBe(s.hordes);
    expect(after.nodes).not.toBe(s.nodes);
    expect(after.player).toBe(s.player);
    expect(after.world).toBe(s.world);
    expect(after.regions).toBe(s.regions);
    expect(after.routes).toBe(s.routes);
    expect(after.meta).toBe(s.meta);
    // the only node field it may move is the roster triple
    for (const [id, node] of Object.entries(after.nodes)) {
      const before = s.nodes[id]!;
      expect({ ...node, walkers: 0, roster: [], zombieTypes: [] }).toStrictEqual({ ...before, walkers: 0, roster: [], zombieTypes: [] });
    }
  });

  it("never mutates its input", () => {
    const { state, graph } = run();
    const s = stand(withHorde(state, "node.x.4"), "node.x.4", 6);
    const snapshot = JSON.stringify(s);
    tickHordes(s, 72, graph);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("every numeric leaf stays a whole number after a long run", () => {
    const { state, graph } = run();
    let s = stand(withHorde(state, "node.x.4"), "node.x.4", 7);
    for (let i = 0; i < 30; i += 1) s = tickHordes(s, 5, graph);
    for (const h of s.hordes) {
      expect(Number.isInteger(h.size)).toBe(true);
      expect(Number.isInteger(h.stepHours ?? 0)).toBe(true);
    }
    for (const n of Object.values(s.nodes)) expect(Number.isInteger(n.walkers)).toBe(true);
  });
});
