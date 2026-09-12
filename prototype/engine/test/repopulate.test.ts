import { describe, expect, it } from "vitest";
import {
  startRun,
  advanceWorld,
  saveGame,
  loadGame,
  applyAction,
  availableActions,
  repopulateRegions,
  repopulateEnabled,
  repopStream,
  typeTableFor,
  nodeCeiling,
  regionCapacity,
  spawnWeight,
  rosterOf,
  withRoster,
  addBodies,
  removeBodyAt,
  seedRoster,
  distinctTypes,
  enemyForNode,
  ENEMY_RIOT,
  WALKER_ENEMY,
  ZOMBIE_WALKER,
  ZOMBIE_RIOT,
  ZOMBIE_SCREAMER,
  COMBAT_PRIORITY,
  ROSTER_COMBAT_PRIORITY,
  REPOP_DISABLED_FLAG,
  combatNarration,
  REPOP_HOURS_PER_STEP,
  REPOP_NODE_CEILING_MAX,
  REPOP_TYPE_TABLE,
  type GameState,
  type NodeDef,
  type NodeState,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T75 — zombie repopulation (design review 2026-09-12 step 2, THE KEYSTONE) and the per-node roster
 * that fixes the type/population divorce. Before this task `node.walkers` was written in exactly three
 * places, none of which ever ADDED a body back, so the player stripped a finite city and the map never
 * refilled; `region.zombieDensity` — the dial the director, the drift model and every difficulty mode
 * push on — never became a zombie, a wound or a decision.
 */

// --- fixtures -------------------------------------------------------------------------------

const region = (id: string, zombieDensity: number, extra: Record<string, number> = {}): RegionDef => ({
  id,
  name: id,
  description: id,
  baseline: { zombieDensity, threat: 0, loot: 0, survivorActivity: 0, ...extra },
});

/** A `count`-node line in one region; `walkers`/`zombieTypes` apply to the FIRST node only. */
const line = (
  regionId: string,
  count: number,
  first: { walkers?: number; zombieTypes?: readonly string[] } = {},
): NodeDef[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `node.z.${String.fromCharCode(97 + i)}`,
    regionId,
    name: `N${i}`,
    description: `n${i}`,
    adjacent: [i > 0 ? `node.z.${String.fromCharCode(96 + i)}` : "", i < count - 1 ? `node.z.${String.fromCharCode(98 + i)}` : ""].filter(
      (s) => s !== "",
    ),
    ...(i === 0 ? { start: true, ...first } : {}),
  }));

const opts = { seed: "t75-seed", createdAt: "2026-09-12T00:00:00Z" };
const world = (
  density: number,
  nodes = 6,
  first: { walkers?: number; zombieTypes?: readonly string[] } = {},
): { state: GameState; graph: RegionGraph } => {
  const regions = [region("region.z", density)];
  return startRun(opts as never, regions, line("region.z", nodes, first));
};

const bodies = (s: GameState): number => Object.values(s.nodes).reduce((a, n) => a + n.walkers, 0);
/** Advance only the repopulation pass, so drift can never move density under the measurement. */
const repop = (s: GameState, hours: number, times = 1): GameState => {
  let next = s;
  for (let i = 0; i < times; i += 1) next = repopulateRegions(next, hours);
  return next;
};

// --- the hole T75 closes --------------------------------------------------------------------

describe("density becomes bodies — the keystone (T75 · FR-SIM-03 · GDD IV/IX)", () => {
  it("a populated region gains bodies off-screen, where before T75 the map only ever depleted", () => {
    const { state, graph } = world(80, 6, { walkers: 2 });
    const start = bodies(state);
    let next = state;
    for (let t = 0; t < 48; t += 1) next = advanceWorld(next, 2, graph); // four days of 2h turns
    expect(bodies(next)).toBeGreaterThan(start);
  });

  it("a region at density 0 is completely inert — no body, no draw, same state reference", () => {
    const { state } = world(0, 6, { walkers: 2 });
    const next = repop(state, 24);
    expect(next).toBe(state);
  });

  it("a zero-hour tick is inert (the empty-turn contract)", () => {
    const { state } = world(80, 6, { walkers: 2 });
    expect(repop(state, 0)).toBe(state);
  });

  it("density is the spawn RATE, not just the ceiling: same capacity, different time-to-fill", () => {
    // The naive version of this test (dense region vs quiet region, compare final counts) measures
    // CAPACITY, not rate — both arms just sit at their own ceiling, and deleting the probability roll
    // entirely still passes it. Here both arms are given the SAME capacity by construction and the
    // measurement is how many attempts it takes to fill, which only the roll can change.
    const fill = (density: number, nodes: number): number => {
      const { state } = world(density, nodes);
      const cap = regionCapacity(density, nodes);
      let s = state;
      for (let i = 1; i <= 4000; i += 1) {
        s = repop(s, REPOP_HOURS_PER_STEP);
        if (bodies(s) >= cap) return i;
      }
      return Number.POSITIVE_INFINITY;
    };
    // 24 nodes @ density 25 and 6 nodes @ density 100 both have capacity 30, and in both the per-node
    // ceilings leave room for it (the player's own node is never eligible, so the check matters).
    expect(regionCapacity(25, 24)).toBe(regionCapacity(100, 6));
    expect(23 * nodeCeiling(25)).toBeGreaterThanOrEqual(regionCapacity(25, 24));
    expect(5 * nodeCeiling(100)).toBeGreaterThanOrEqual(regionCapacity(100, 6));
    const slow = fill(25, 24);
    const fast = fill(100, 6);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBe(30); // p = 1.0 ⇒ one body per attempt, exactly
    expect(slow).toBeGreaterThan(60); // p = 0.25 ⇒ roughly four attempts per body
  });

  it("the pass can be switched off entirely (`repopulate.disabled`, mirroring the director)", () => {
    const { state } = world(95, 6);
    const off: GameState = { ...state, world: { ...state.world, flags: { [REPOP_DISABLED_FLAG]: true } } };
    expect(repopulateEnabled(off)).toBe(false);
    expect(repop(off, 6, 50)).toBe(off);
    expect(bodies(repop(world(95, 6).state, 6, 50))).toBeGreaterThan(0); // …and on by default
  });
});

// --- the three bounds -----------------------------------------------------------------------

describe("bounded by construction — the director biases, it never forces (GDD XVI)", () => {
  it("the per-node ceiling is the binding bound when capacity is far above it", () => {
    // 3 nodes @ density 100: capacity 15, but only 2 are eligible (the player stands on the third) and
    // each stops at ceiling 6 ⇒ the ceiling, not capacity, is what stops this. An off-by-one in the
    // ceiling test moves the settled total; an off-by-one in capacity cannot.
    const { state } = world(100, 3);
    const ceiling = nodeCeiling(100);
    expect(regionCapacity(100, 3)).toBeGreaterThan(2 * ceiling); // capacity cannot bind here
    const next = repop(state, 6, 400);
    for (const node of Object.values(next.nodes)) expect(node.walkers).toBeLessThanOrEqual(ceiling);
    expect(bodies(next)).toBe(2 * ceiling); // both eligible nodes filled to exactly the ceiling
  });

  it("the region capacity is the binding bound when the ceilings are far above it", () => {
    // 12 nodes @ density 20: ceiling 2 ⇒ 11 eligible nodes could hold 22, but capacity is 12.
    const { state } = world(20, 12);
    const cap = regionCapacity(20, 12);
    expect(11 * nodeCeiling(20)).toBeGreaterThan(cap); // the ceilings cannot bind here
    const next = repop(state, 6, 2000);
    expect(bodies(next)).toBe(cap); // settles AT capacity, not one over, not one under
    // and one enormous single advance lands in the same place — leftover attempts are dropped
    expect(bodies(repop(state, 12000))).toBe(cap);
  });

  it("never spawns onto the node the player is standing on", () => {
    const { state } = world(95, 5);
    const at = state.player.location;
    const before = state.nodes[at]!.walkers;
    const next = repop(state, 6, 300);
    expect(next.nodes[at]!.walkers).toBe(before);
    expect(bodies(next)).toBeGreaterThan(before); // the rest of the region did fill
  });

  it("never spawns into the player's claimed shelter", () => {
    const { state } = world(95, 5);
    const shelterId = "node.z.c";
    const claimed: GameState = { ...state, player: { ...state.player, shelterId } };
    const next = repop(claimed, 6, 300);
    expect(next.nodes[shelterId]!.walkers).toBe(claimed.nodes[shelterId]!.walkers);
  });

  it("never CULLS — a region over capacity holds its bodies rather than losing them", () => {
    const { state } = world(10, 4);
    const packed: GameState = {
      ...state,
      nodes: Object.fromEntries(
        Object.entries(state.nodes).map(([id, n]) => [id, withRoster(n, [ZOMBIE_WALKER, ZOMBIE_WALKER, ZOMBIE_WALKER])]),
      ) as GameState["nodes"],
    };
    const before = bodies(packed);
    expect(before).toBeGreaterThan(regionCapacity(10, 4));
    expect(bodies(repop(packed, 6, 100))).toBe(before);
  });
});

// --- the T74 clock --------------------------------------------------------------------------

describe("the repopulation clock banks its remainder (T74 idiom)", () => {
  it("the ATTEMPT count is chunking-exact: twelve 2h ticks bank the same steps as one 24h tick", () => {
    // Measured on the accumulator itself rather than on outcomes: the spawn ROLL is per-attempt RNG,
    // so (per T74's declared limit 1) chunking changes the draws, never the arithmetic.
    const { state } = world(100, 6);
    const chunked = repop(state, 2, 12);
    const oneShot = repop(state, 24);
    const carried = (s: GameState): number => s.regions["region.z"]!.repopHours ?? 0;
    expect(carried(chunked)).toBe(carried(oneShot));
    expect(carried(chunked)).toBe(24 % REPOP_HOURS_PER_STEP);
  });

  it("a sub-period tick banks its hours instead of truncating them to nothing", () => {
    const { state } = world(80, 6);
    const one = repop(state, 1);
    expect(one.regions["region.z"]!.repopHours).toBe(1);
    expect(bodies(one)).toBe(bodies(state)); // nothing came due yet…
    let acc = one;
    for (let i = 0; i < REPOP_HOURS_PER_STEP - 1; i += 1) acc = repop(acc, 1);
    expect(acc.regions["region.z"]!.repopHours).toBe(0); // …and the period came due on the 6th hour
  });

  it("HOLDS the accumulator while the region has nothing to do, and releases it after a cull", () => {
    const { state } = world(40, 4);
    const cap = regionCapacity(40, 4);
    const full: GameState = {
      ...state,
      regions: { ...state.regions, "region.z": { ...state.regions["region.z"]!, repopHours: 3 } },
      nodes: Object.fromEntries(
        Object.entries(state.nodes).map(([id, n], i) => [
          id,
          withRoster(n, Array.from({ length: i === 0 ? cap : 0 }, () => ZOMBIE_WALKER)),
        ]),
      ) as GameState["nodes"],
    };
    const held = repop(full, 12, 5);
    expect(held.regions["region.z"]!.repopHours).toBe(3); // neither accrued nor reset
    expect(bodies(held)).toBe(bodies(full));
    // cull the district and the banked pressure is there waiting
    const culled: GameState = {
      ...held,
      nodes: Object.fromEntries(Object.entries(held.nodes).map(([id, n]) => [id, withRoster(n, [])])) as GameState["nodes"],
    };
    expect(repop(culled, 12).regions["region.z"]!.repopHours).toBe((3 + 12) % REPOP_HOURS_PER_STEP);
  });

  it("scrubs a NaN / negative / fractional carry off a hand-edited save on BOTH the hold and bank paths", () => {
    const bad = (density: number, carry: number): number => {
      const { state } = world(density, 4);
      const s: GameState = {
        ...state,
        regions: { ...state.regions, "region.z": { ...state.regions["region.z"]!, repopHours: carry } },
      };
      return repop(s, 4).regions["region.z"]!.repopHours ?? -1;
    };
    expect(bad(0, Number.NaN)).toBe(0); // the HOLD path
    expect(bad(0, -9)).toBe(0);
    expect(bad(80, Number.NaN)).toBe(4); // the BANK path — NaN reads as 0, then banks this tick's 4h
    expect(bad(80, 1.7)).toBe(5); // fractional floors to 1, + 4h
  });

  it("a NaN / negative / fractional `hours` is inert — it cannot spend a banked step", () => {
    const { state } = world(80, 6);
    // A carry of 30 is five whole periods, so a guard that lets NaN through (`Math.max(0, trunc(NaN))`
    // is NaN, which is not `=== 0`) spawns five bodies on a "zero-hour" tick. Five, not zero, is what
    // makes this assertion able to fail.
    const carried: GameState = {
      ...state,
      regions: { ...state.regions, "region.z": { ...state.regions["region.z"]!, repopHours: 30 } },
    };
    expect(repop(carried, Number.NaN)).toBe(carried);
    expect(repop(carried, -5)).toBe(carried);
    expect(repop(carried, 0.9)).toBe(carried);
    expect(bodies(repop(carried, 1))).toBeGreaterThan(bodies(carried)); // …but a real hour releases it
  });

  it("HOLDS when the region is under capacity but every legal node is already at its ceiling", () => {
    // The case a HOLD predicate that only knew about capacity missed: it rewrote the region slice and
    // drew from the RNG on every tick, forever, in a world that could never change.
    // Density 39 over 20 nodes: capacity 39, ceiling 2, and only 19 nodes are eligible (the player
    // stands on the 20th) ⇒ a maximum reachable occupancy of 38, one short of capacity, forever. This
    // is the shape the-terraces actually settles into on shipped content once drift moves its density.
    const { state } = world(39, 20);
    const ceiling = nodeCeiling(39);
    const ids = Object.keys(state.nodes).sort();
    const playerAt = state.player.location;
    const packed: GameState = {
      ...state,
      regions: { ...state.regions, "region.z": { ...state.regions["region.z"]!, repopHours: 2 } },
      nodes: Object.fromEntries(
        ids.map((id) => [id, id === playerAt ? state.nodes[id]! : withRoster(state.nodes[id]!, Array.from({ length: ceiling }, () => ZOMBIE_WALKER))]),
      ) as GameState["nodes"],
    };
    // under capacity — so only the eligibility check can stop it
    expect(bodies(packed)).toBeLessThan(regionCapacity(39, 20));
    // 2-hour ticks, deliberately: with 6-hour ticks the banked remainder happens to come back equal to
    // the carry, so the region slice is not rewritten either way and the assertion cannot tell a
    // correct HOLD from a missing one. At 2 hours a missing HOLD rewrites `repopHours` every tick.
    const next = repop(packed, 2, 12);
    expect(next).toBe(packed); // same reference: no node, no region slice, no RNG draw
    expect(next.regions["region.z"]!.repopHours).toBe(2); // neither accrued nor reset
    expect(next.rng).toBe(packed.rng);
  });
});

// --- determinism + stream hygiene -----------------------------------------------------------

describe("determinism and RNG-stream hygiene (ADR-0001 · the PL-M4-54 lesson)", () => {
  it("the same seed and hours reproduce the same world byte-for-byte", () => {
    const { state } = world(85, 6);
    expect(JSON.stringify(repop(state, 6, 30))).toBe(JSON.stringify(repop(state, 6, 30)));
  });

  it("draws only from the new `repop` stream — no existing stream's sequence moves", () => {
    const { state } = world(85, 6);
    const seeded: GameState = {
      ...state,
      rng: { streams: { ...state.rng.streams, loot: { s: 1, i: 2 } as never, horde: { s: 3, i: 4 } as never } },
    };
    const next = repop(seeded, 6, 20);
    expect(next.rng.streams["loot"]).toEqual(seeded.rng.streams["loot"]);
    expect(next.rng.streams["horde"]).toEqual(seeded.rng.streams["horde"]);
    expect(next.rng.streams["region"]).toBeUndefined(); // drift was never run here
    expect(next.rng.streams[repopStream("region.z")]).toBeDefined();
    expect(next.rng.streams["repop"]).toBeUndefined(); // per-region, never a single shared stream
  });

  it("each region draws from its OWN stream, so the chunking of hours cannot interleave them", () => {
    // On one shared stream the regions took turns, and the turn order depended on how the hours were
    // chunked — twelve 2h ticks and one 24h tick consumed different slices and produced different
    // worlds. Per region, any chunking of the same hours is byte-identical.
    const regions = [region("region.p", 70), region("region.q", 70)];
    const p = line("region.p", 4);
    const q = line("region.q", 4).map((n) => ({ ...n, id: `${n.id}2`, start: false, adjacent: n.adjacent.map((x) => `${x}2`) }));
    const nodes = [
      ...p.map((n) => (n.id === "node.z.d" ? { ...n, adjacent: [...n.adjacent, "node.z.a2"] } : n)),
      ...q.map((n) => (n.id === "node.z.a2" ? { ...n, adjacent: [...n.adjacent, "node.z.d"] } : n)),
    ] as NodeDef[];
    const { state } = startRun(opts as never, regions, nodes);
    expect(JSON.stringify(repop(state, 2, 12).nodes)).toBe(JSON.stringify(repop(state, 24).nodes));
    expect(JSON.stringify(repop(state, 1, 24).nodes)).toBe(JSON.stringify(repop(state, 24).nodes));
  });

  it("node candidates are taken in sorted id order, not object key order", () => {
    const { state } = world(70, 5);
    const keys = Object.keys(state.nodes);
    const shuffled: GameState = {
      ...state,
      nodes: Object.fromEntries([...keys].reverse().map((k) => [k, state.nodes[k]!])) as GameState["nodes"],
    };
    expect(JSON.stringify(repop(shuffled, 6, 12).nodes)).not.toBe(JSON.stringify(shuffled.nodes));
    const a = repop(state, 6, 12).nodes;
    const b = repop(shuffled, 6, 12).nodes;
    for (const k of keys) expect(b[k]!.walkers).toBe(a[k]!.walkers);
  });

  it("region iteration does not depend on object key order (and, post per-region streams, cannot)", () => {
    const regions = [region("region.b", 80), region("region.a", 80)];
    const a = line("region.a", 3);
    const b = line("region.b", 3).map((n) => ({ ...n, id: `${n.id}2`, start: false, adjacent: n.adjacent.map((x) => `${x}2`) }));
    // One bridge edge so the graph is connected (`buildRegionGraph` rejects orphans); the assertion is
    // about draw ORDER only, which comes from a sorted key list, so a reversed insertion must agree.
    const nodes = [
      ...a.map((n) => (n.id === "node.z.c" ? { ...n, adjacent: [...n.adjacent, "node.z.a2"] } : n)),
      ...b.map((n) => (n.id === "node.z.a2" ? { ...n, adjacent: [...n.adjacent, "node.z.c"] } : n)),
    ];
    const forward = startRun(opts as never, regions, nodes as NodeDef[]);
    const reversed = startRun(opts as never, [...regions].reverse(), nodes as NodeDef[]);
    expect(JSON.stringify(repop(forward.state, 6, 10).nodes)).toBe(JSON.stringify(repop(reversed.state, 6, 10).nodes));
  });
});

// --- the density-gated type table -----------------------------------------------------------

describe("a high-density district seeds Riot / Bloated / Fresh, a quiet one only walkers", () => {
  it("the table opens up with density and always keeps the walker", () => {
    expect(typeTableFor(0).map((r) => r.type)).toEqual([ZOMBIE_WALKER]);
    expect(typeTableFor(29).map((r) => r.type)).toEqual([ZOMBIE_WALKER]);
    expect(typeTableFor(30).map((r) => r.type)).toContain("zombie.fresh");
    expect(typeTableFor(50).map((r) => r.type)).toContain("zombie.screamer");
    expect(typeTableFor(69).map((r) => r.type)).not.toContain(ZOMBIE_RIOT);
    expect(typeTableFor(70).map((r) => r.type)).toContain(ZOMBIE_RIOT);
    expect(typeTableFor(100).length).toBe(REPOP_TYPE_TABLE.length);
  });

  it("a low-density region produces plain walkers only — no special can appear below its gate", () => {
    const next = repop(world(25, 6).state, 6, 200);
    for (const node of Object.values(next.nodes)) expect(node.zombieTypes).toEqual([]);
  });

  it("a high-density region produces specials, and walkers still dominate across seeds", () => {
    // Pooled over several region ids (each has its own `repop:<id>` stream) so the assertion is about
    // the TABLE's shape rather than one lucky draw.
    let plain = 0;
    let total = 0;
    let specials = 0;
    for (let k = 0; k < 8; k += 1) {
      const id = `region.z${k}`;
      const regions = [region(id, 95)];
      const { state } = startRun(opts as never, regions, line(id, 8));
      const next = repop(state, 6, 600);
      for (const node of Object.values(next.nodes)) {
        for (const t of rosterOf(node)) {
          total += 1;
          if (t === ZOMBIE_WALKER) plain += 1;
          else specials += 1;
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(specials).toBeGreaterThan(0);
    expect(plain * 2).toBeGreaterThan(total); // a majority, not a boss rush
    expect(plain).toBeLessThan(total); // …but not walkers-only either
  });

  it("the loudest and most-worked nodes draw the dead harder, but every node keeps a chance", () => {
    const base = world(80, 4).state;
    const quiet = base.nodes["node.z.b"]!;
    const loud: NodeState = { ...quiet, noise: 60, searchPct: 80, lastVisit: base.meta.day };
    expect(spawnWeight(loud, base.meta.day)).toBeGreaterThan(spawnWeight(quiet, base.meta.day));
    expect(spawnWeight(quiet, base.meta.day)).toBeGreaterThanOrEqual(1);
  });

  it("the per-node ceiling rises with density and is hard-capped", () => {
    expect(nodeCeiling(0)).toBe(1);
    expect(nodeCeiling(80)).toBe(5);
    expect(nodeCeiling(100)).toBeLessThanOrEqual(REPOP_NODE_CEILING_MAX);
    expect(nodeCeiling(-5)).toBe(1);
    expect(regionCapacity(80, 11)).toBe(44);
    expect(regionCapacity(0, 11)).toBe(0);
  });
});

// --- the roster: type and population, reconciled --------------------------------------------

describe("the per-node roster fixes the type/population divorce (T75)", () => {
  it("keeps walkers, zombieTypes and roster coherent through every write", () => {
    const { state } = world(0, 3, { walkers: 3, zombieTypes: [ZOMBIE_RIOT] });
    const node = state.nodes["node.z.a"]!;
    expect(rosterOf(node)).toEqual([ZOMBIE_RIOT, ZOMBIE_WALKER, ZOMBIE_WALKER]);
    expect(node.walkers).toBe(3);
    expect(node.zombieTypes).toEqual([ZOMBIE_RIOT]);
    const grown = addBodies(node, ["zombie.fresh"]);
    expect(grown.walkers).toBe(4);
    expect(grown.zombieTypes).toEqual([ZOMBIE_RIOT, "zombie.fresh"]);
    const shrunk = removeBodyAt(grown, 0);
    expect(shrunk.walkers).toBe(3);
    expect(shrunk.zombieTypes).toEqual(["zombie.fresh"]); // the riot is GONE, not merely decremented
  });

  it("an authored type with too small a walker count still gets a body (the marina's lone stalker)", () => {
    expect(seedRoster(0, ["zombie.stalker"])).toEqual(["zombie.stalker"]);
    expect(seedRoster(3, ["zombie.riot"])).toEqual([ZOMBIE_RIOT, ZOMBIE_WALKER, ZOMBIE_WALKER]);
    expect(distinctTypes([ZOMBIE_WALKER, ZOMBIE_WALKER])).toEqual([]);
    const { state } = world(0, 3, { walkers: 0, zombieTypes: ["zombie.stalker"] });
    expect(state.nodes["node.z.a"]!.walkers).toBe(1); // before T75 this node was never offered as a fight
  });

  it("killing the riot leaves WALKERS behind it, not three more riots", () => {
    const { state, graph } = world(0, 3, { walkers: 3, zombieTypes: [ZOMBIE_RIOT] });
    const armed = {
      ...state,
      player: { ...state.player, inventory: [{ type: "item.pistol", quantity: 1 }, { type: "item.ammo", quantity: 6 }] },
    };
    expect(enemyForNode(armed).id).toBe(ENEMY_RIOT);
    let s: GameState = armed;
    const take = (id: string): void => {
      const c = availableActions(s, graph).find((x) => x.id === id);
      if (c === undefined) throw new Error(`no choice ${id}`);
      s = applyAction(s, c.action, graph).state;
    };
    take("fight");
    for (let i = 0; i < 12 && s.combat !== null; i += 1) take("fire");
    expect(s.combat).toBeNull();
    expect(s.nodes["node.z.a"]!.walkers).toBe(2);
    expect(s.nodes["node.z.a"]!.zombieTypes).toEqual([]); // the armored dead is off the board
    expect(enemyForNode(s).id).toBe(WALKER_ENEMY);
  });

  it("a kill resolved against a node the roster no longer lists spends nothing and churns nothing", () => {
    // The `idx < 0` fallback in `killEnemy`. Unreachable in normal play (encounters only fire at
    // walkers 0, and nothing else empties a node mid-fight), so it is asserted directly: an empty
    // roster must come back as the SAME node object with its legacy type list untouched, matching the
    // pre-T75 `Math.max(0, walkers - 1)` floor rather than rewriting the node.
    const legacy = { walkers: 0, zombieTypes: [ZOMBIE_RIOT], noise: 0, searchPct: 0, lastVisit: null } as unknown as NodeState;
    expect(rosterOf(legacy)).toEqual([]);
    expect(withRoster(legacy, rosterOf(legacy))).not.toBe(legacy); // withRoster WOULD rewrite it…
    expect(withRoster(legacy, []).zombieTypes).toEqual([]); // …and would drop the type
    // …which is why the fallback must not call it on an empty roster. Proven end-to-end below.
    const { state, graph } = world(0, 3, { walkers: 1, zombieTypes: [ZOMBIE_RIOT] });
    let s: GameState = state;
    const take = (id: string): void => {
      const c = availableActions(s, graph).find((x) => x.id === id);
      if (c === undefined) throw new Error(`no choice ${id}`);
      s = applyAction(s, c.action, graph).state;
    };
    take("fight");
    for (let i = 0; i < 40 && s.combat !== null; i += 1) take("strike");
    expect(s.nodes["node.z.a"]!.walkers).toBe(0);
    expect(s.nodes["node.z.a"]!.roster).toEqual([]);
  });

  it("returns the same node reference when a write changes nothing (no idle churn)", () => {
    const { state } = world(0, 3, { walkers: 2 });
    const node = state.nodes["node.z.a"]!;
    expect(withRoster(node, rosterOf(node))).toBe(node);
    expect(addBodies(node, [])).toBe(node);
    expect(removeBodyAt(node, 9)).toBe(node);
  });

  it("keeps the most dangerous listed type when a legacy type list is longer than its walker count", () => {
    // Pre-T75 `enemyForNode` scanned the WHOLE type list, so truncating the synthesis in listed order
    // could hand a loaded save a weaker enemy than the save said was standing there.
    const legacy = { walkers: 1, zombieTypes: [ZOMBIE_SCREAMER, ZOMBIE_RIOT], noise: 0, searchPct: 0, lastVisit: null } as unknown as NodeState;
    expect(rosterOf(legacy)).toEqual([ZOMBIE_RIOT]);
    expect(ROSTER_COMBAT_PRIORITY).toEqual(COMBAT_PRIORITY); // the local copy must not drift
  });

  it("reconciles a stored roster that disagrees with `walkers` instead of trusting it", () => {
    // Only a hand-edited save or a writer that bypassed `withRoster` can produce this. Trusting the
    // roster let a node claim 0 walkers to every gate while hiding bodies a single kill then deleted.
    const { state } = world(0, 3, { walkers: 3, zombieTypes: [ZOMBIE_RIOT] });
    const node = state.nodes["node.z.a"]!;
    expect(rosterOf({ ...node, walkers: 0 })).toEqual([]);
    expect(rosterOf({ ...node, walkers: 2 })).toEqual([ZOMBIE_RIOT, ZOMBIE_WALKER]);
    expect(rosterOf({ ...node, roster: [], walkers: 2 })).toEqual([ZOMBIE_WALKER, ZOMBIE_WALKER]);
  });

  it("a kill removes the body it FOUGHT: a plain walker before a screamer that fights as one", () => {
    const { state, graph } = world(0, 3, { walkers: 2, zombieTypes: [ZOMBIE_SCREAMER] });
    const node = state.nodes["node.z.a"]!;
    expect(rosterOf(node)).toEqual([ZOMBIE_SCREAMER, ZOMBIE_WALKER]);
    expect(enemyForNode(state).id).toBe(WALKER_ENEMY); // a screamer has no distinct combat profile
    let s: GameState = state;
    const take = (id: string): void => {
      const c = availableActions(s, graph).find((x) => x.id === id);
      if (c === undefined) throw new Error(`no choice ${id}; offered ${availableActions(s, graph).map((x) => x.id).join(",")}`);
      s = applyAction(s, c.action, graph).state;
    };
    take("fight");
    for (let i = 0; i < 30 && s.combat !== null; i += 1) take("strike");
    expect(s.combat).toBeNull();
    // the plain walker fell; the screamer is still standing (and still drives the arousal machine)
    expect(rosterOf(s.nodes["node.z.a"]!)).toEqual([ZOMBIE_SCREAMER]);
    expect(s.nodes["node.z.a"]!.zombieTypes).toEqual([ZOMBIE_SCREAMER]);
  });

  it("names what is behind the body you would fight first, and keeps the plain-walker wording", () => {
    const plain = world(0, 3, { walkers: 2 }).state;
    expect(combatNarration(plain)).toBe("2 walkers shamble here. You can take them on, or slip away.");
    const lone = world(0, 3, { walkers: 1, zombieTypes: [ZOMBIE_RIOT] }).state;
    expect(combatNarration(lone)).toContain("You can take it on, or slip away.");
    expect(combatNarration(lone)).not.toContain("behind it");
    const mixed = world(0, 3, { walkers: 3, zombieTypes: [ZOMBIE_RIOT] }).state;
    expect(combatNarration(mixed)).toContain("2 more behind it");
    const pair = world(0, 3, { walkers: 2, zombieTypes: [ZOMBIE_RIOT] }).state;
    expect(combatNarration(pair)).toContain("one more behind it");
  });

  it("a pre-T75 node with no roster synthesizes the reading that save already had", () => {
    const legacy = { walkers: 3, zombieTypes: [ZOMBIE_RIOT], noise: 0, searchPct: 0, lastVisit: null } as unknown as NodeState;
    expect(rosterOf(legacy)).toEqual([ZOMBIE_RIOT, ZOMBIE_WALKER, ZOMBIE_WALKER]);
    const empty = { walkers: 0, zombieTypes: ["zombie.stalker"] } as unknown as NodeState;
    expect(rosterOf(empty)).toEqual([]); // un-fightable, exactly as that save has always been
    const broken = { walkers: Number.NaN, zombieTypes: [] } as unknown as NodeState;
    expect(rosterOf(broken)).toEqual([]);
  });
});

// --- save losslessness (no new rung: schema v10 holds) ---------------------------------------

describe("save losslessness — roster + repopHours ride v10 with no migration rung", () => {
  it("round-trips a repopulated world byte-for-byte", () => {
    const { state, graph } = world(85, 6, { walkers: 2 });
    let next = state;
    for (let t = 0; t < 24; t += 1) next = advanceWorld(next, 2, graph);
    const back = loadGame(saveGame(next));
    expect(JSON.stringify(back)).toBe(JSON.stringify(next));
    expect(back.meta.version).toBe(next.meta.version);
  });

  it("a save written before the roster existed still loads and plays", () => {
    const { state } = world(80, 4, { walkers: 2, zombieTypes: [ZOMBIE_RIOT] });
    const blob = JSON.parse(saveGame(state)) as { state: { nodes: Record<string, Record<string, unknown>>; regions: Record<string, Record<string, unknown>> } };
    for (const node of Object.values(blob.state.nodes)) delete node["roster"];
    for (const r of Object.values(blob.state.regions)) delete r["repopHours"];
    const back = loadGame(JSON.stringify(blob));
    expect(back.nodes["node.z.a"]!.roster).toBeUndefined();
    expect(rosterOf(back.nodes["node.z.a"]!)).toEqual([ZOMBIE_RIOT, ZOMBIE_WALKER]);
    expect(enemyForNode(back).id).toBe(ENEMY_RIOT);
    // and the first tick that touches it writes the roster in, coherently
    const ticked = repop(back, 24, 4);
    for (const node of Object.values(ticked.nodes)) {
      if (node.roster !== undefined) expect(node.roster.length).toBe(node.walkers);
    }
  });
});
