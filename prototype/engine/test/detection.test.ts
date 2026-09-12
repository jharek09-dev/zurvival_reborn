import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ALERTED_DETECT,
  AROUSAL_DETECT,
  CARRY_CAPACITY,
  CHASE_AT,
  DETECT_MAX,
  INVESTIGATE_AT,
  MOVE_COST,
  OVERRUN_ESCAPE_FLOOR,
  PACK_DETECT_MAX,
  PACK_HEAVY,
  PLAYER_ADJACENT_BONUS,
  PLAYER_HERE_BONUS,
  ROUTE_BLOCKED_AT,
  ROUTE_COSTLY_AT,
  ROUTE_FLOODED_AT,
  RETREAT_COST,
  SCENT_BONUS,
  SCENT_DETECT_MAX,
  SCENT_FULL_AT,
  SLIP_COST,
  WANDER_AT,
  ZOMBIE_STALKER,
  applyAction,
  arousalDetect,
  availableActions,
  combatChoices,
  combatNarration,
  composeStealth,
  detectChance,
  encounterChoices,
  escapeExtraCost,
  extraCostOf,
  escapeTargets,
  loadGame,
  overrunEscapeChance,
  packDetect,
  routeKey,
  saveGame,
  scentDetect,
  scentDraw,
  woundBurden,
  startRun,
  stealthDetectChance,
  stealthRead,
  stealthTell,
  stimulusAt,
  tickZombies,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type Wound,
} from "../src/index.js";

/**
 * T77 — noise → arousal → detection, closed into one chain.
 *
 * Three systems that all described being noticed and never spoke to each other: the T14 noise model,
 * the T25/T46 arousal ladder, and the T15/T27/T28 stealth roll.
 *
 * The **behavioural** tests here are each written to fail against the unfixed code — the discipline
 * T75 and T76 both had to learn the hard way — and each says in place which pre-T77 behaviour it
 * discriminates against. The rest are not, and are not pretending to be: the house-rules block at the
 * bottom (determinism, integer-only, save-losslessness, inertness on a calm unhurt player) and the
 * pure-arithmetic and property tests exist to stop this change DRIFTING, and the inertness test is
 * deliberately non-discriminating — it asserts the pre-T77 roll is still exactly what an unhurt,
 * empty-handed player standing on a calm node gets.
 */

// A five-node line n0—n1—n2—n3—n4, start at n0.
const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 40, loot: 50 } }];
const NODES: NodeDef[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `node.x.${i}`,
  regionId: "region.x",
  name: `N${i}`,
  description: `n${i}`,
  adjacent: [i - 1, i + 1].filter((j) => j >= 0 && j <= 4).map((j) => `node.x.${j}`),
  ...(i === 0 ? { start: true } : {}),
}));
const boot = (seed = "t77-seed"): { state: GameState; graph: RegionGraph } =>
  startRun({ seed, createdAt: "2026-09-12T00:00:00Z" }, REGIONS, NODES);

const HERE = "node.x.0";
const NEXT = "node.x.1";
/** A node with TWO discovered neighbours, so "one road blocked" and "every road blocked" differ. */
const MID = "node.x.1";

const blockRoute = (s: GameState, a: string, b: string, wear: number): GameState => ({
  ...s,
  routes: { ...s.routes, [routeKey(a, b)]: { wear } },
});

const withNode = (s: GameState, id: string, over: Record<string, unknown>): GameState => ({
  ...s,
  nodes: { ...s.nodes, [id]: { ...s.nodes[id]!, ...over } },
});
const wound = (severity: number, treated = 0): Wound => ({
  type: "wound.laceration",
  site: "arm",
  severity,
  treated,
  inflictedDay: 1,
});
const withWounds = (s: GameState, wounds: readonly Wound[]): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, wounds } },
});
const withPack = (s: GameState, weight: number): GameState => ({
  // item.scrap weighs 1 unit, so quantity == weight and the number under test is exact
  ...s,
  player: { ...s.player, inventory: [{ type: "item.scrap", quantity: weight }] },
});
const discoverAll = (s: GameState): GameState => ({
  ...s,
  nodes: Object.fromEntries(Object.entries(s.nodes).map(([k, v]) => [k, { ...v, discovered: true }])) as GameState["nodes"],
});

// ================================================================================================
// 1. The arousal ladder actually has rungs again
// ================================================================================================

describe("the arousal ladder has rungs again (T77 · PLAYER_HERE_BONUS < CHASE_AT)", () => {
  it("pins the three threshold invariants the ladder rests on", () => {
    // Each is one plausible-looking retune from re-collapsing the ladder, and the first is the exact
    // equality (40 === 40) that the unfixed code shipped with.
    expect(PLAYER_HERE_BONUS).toBeLessThan(CHASE_AT);
    expect(PLAYER_HERE_BONUS).toBeGreaterThanOrEqual(INVESTIGATE_AT);
    expect(PLAYER_HERE_BONUS + SCENT_BONUS).toBeGreaterThanOrEqual(CHASE_AT);
    // and adjacency must stay below the rung presence reaches, or "here" and "next door" collapse too
    expect(PLAYER_ADJACENT_BONUS).toBeLessThan(PLAYER_HERE_BONUS);
    expect(PLAYER_ADJACENT_BONUS).toBeGreaterThanOrEqual(WANDER_AT);
  });

  it("a QUIET arrival on an occupied node reaches investigating, not chasing", () => {
    // THE discriminating test for the collapse. Unfixed: stimulus = noise 0 + PLAYER_HERE_BONUS 40 =
    // CHASE_AT exactly ⇒ `chasing`, on contact, at zero noise, in any weather. Measured on the shipped
    // city before the fix: 168 of 168 slips across 16 runs happened at a `chasing` node.
    const { state, graph } = boot();
    const s = withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
      walkers: 3,
      noise: 0,
      zombieState: "dormant",
    });
    expect(stimulusAt(s, HERE, s.nodes[HERE]!, graph)).toBe(PLAYER_HERE_BONUS);
    expect(tickZombies(s, 2, graph).nodes[HERE]!.zombieState).toBe("investigating");
  });

  it("a BITE tips the same node to chasing; a scratch does not — the scent term is a gradient", () => {
    // Unfixed, presence alone already saturated the ladder, so SCENT_BONUS could never change a rung at
    // the player's own node. It now decides one — and since T77 it is SCALED by untreated burden
    // (`scentDraw`), so it is the *bite* that makes them chase, not any open graze whatsoever.
    const { state, graph } = boot();
    const base = withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
      walkers: 3,
      noise: 0,
      zombieState: "dormant",
    });
    const bitten = withWounds(base, [wound(SCENT_FULL_AT)]);
    expect(scentDraw(bitten.player.condition)).toBe(SCENT_BONUS);
    expect(stimulusAt(bitten, HERE, bitten.nodes[HERE]!, graph)).toBe(PLAYER_HERE_BONUS + SCENT_BONUS);
    expect(tickZombies(bitten, 2, graph).nodes[HERE]!.zombieState).toBe("chasing");
    // a lesser wound draws proportionally less and leaves the node merely investigating
    const scratched = withWounds(base, [wound(20)]);
    expect(scentDraw(scratched.player.condition)).toBeLessThan(SCENT_BONUS);
    expect(tickZombies(scratched, 2, graph).nodes[HERE]!.zombieState).toBe("investigating");
    // and a fully TREATED wound leaves no trail at all — back to the quiet arrival
    const treated = withWounds(base, [wound(SCENT_FULL_AT, SCENT_FULL_AT)]);
    expect(scentDraw(treated.player.condition)).toBe(0);
    expect(tickZombies(treated, 2, graph).nodes[HERE]!.zombieState).toBe("investigating");
  });

  it("scentDraw is a monotone, integer gradient that is off only for a whole body", () => {
    const { state } = boot();
    const at = (burden: number): number => scentDraw(withWounds(state, [wound(burden)]).player.condition);
    expect(at(0)).toBe(0);
    expect(at(1)).toBeGreaterThan(0); // any open wound is SOME trail — never silently rounded to zero
    expect(at(SCENT_FULL_AT)).toBe(SCENT_BONUS);
    expect(at(500)).toBe(SCENT_BONUS); // capped, so a pile of wounds cannot outrun the ladder
    for (let b = 1; b <= 100; b += 1) {
      expect(Number.isInteger(at(b))).toBe(true);
      expect(at(b)).toBeGreaterThanOrEqual(at(b - 1));
    }
  });

  it("a Stalker at night and a rummaged node both still reach chasing from presence", () => {
    // The fix must not make the ladder unreachable in the other direction: the two type behaviours
    // whose whole point is reaching you fast must still clear CHASE_AT on a quiet arrival.
    const { state, graph } = boot();
    const night = { ...state, meta: { ...state.meta, phase: "night" as const } };
    const stalker = withNode(night, HERE, { walkers: 1, noise: 0, zombieTypes: [ZOMBIE_STALKER], zombieState: "dormant" });
    expect(tickZombies(stalker, 2, graph).nodes[HERE]!.zombieState).toBe("chasing");
    // and plain walkers on a node you have made noise at
    const loud = withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
      walkers: 3,
      noise: CHASE_AT - PLAYER_HERE_BONUS,
      zombieState: "dormant",
    });
    expect(tickZombies(loud, 2, graph).nodes[HERE]!.zombieState).toBe("chasing");
  });
});

// ================================================================================================
// 2. The stealth read: each term, pinned separately
// ================================================================================================

describe("the stealth read composes the terms the fiction promised (T77)", () => {
  it("arousal adds the documented points and feeding sits BELOW investigating", () => {
    expect(arousalDetect("dormant")).toBe(0);
    expect(arousalDetect("hibernating")).toBe(0);
    // The note asked for 10/25/40; measurement said `chasing` is the common case, not a spike, so the
    // band was lowered to 5/15/30 (see AROUSAL_DETECT's own note). The ORDERING is what matters and is
    // pinned below; these literals pin that the retune was deliberate rather than drifted into.
    expect(arousalDetect("wandering")).toBe(5);
    expect(arousalDetect("investigating")).toBe(15);
    expect(arousalDetect("chasing")).toBe(30);
    // a nest with its heads down in a corpse is awake but occupied — the one mercy the ladder offers,
    // and it would be deleted by ranking `feeding` with `investigating` (the arousal RUNG does).
    expect(arousalDetect("feeding")).toBeLessThan(arousalDetect("investigating"));
    expect(AROUSAL_DETECT.chasing).toBeGreaterThan(AROUSAL_DETECT.investigating);
    expect(arousalDetect(undefined)).toBe(0);
  });

  it("scent scales with untreated burden and caps; treatment turns it off", () => {
    expect(scentDetect(0)).toBe(0);
    expect(scentDetect(30)).toBe(3);
    expect(scentDetect(100)).toBe(SCENT_DETECT_MAX);
    expect(scentDetect(100000)).toBe(SCENT_DETECT_MAX); // capped, not unbounded
    expect(scentDetect(-5)).toBe(0);
    expect(scentDetect(Number.NaN)).toBe(0); // NaN is the one case the plain clamp cannot handle
  });

  it("pack weight is free below PACK_HEAVY and caps at a brim-full pack", () => {
    // Unfixed, `inventoryWeight` touched nothing but the carry cap — a full pack of loot walked home
    // exactly as quietly as an empty one, which is the complaint in the task note.
    expect(packDetect(0)).toBe(0);
    expect(packDetect(PACK_HEAVY)).toBe(0);
    expect(packDetect(PACK_HEAVY + 5)).toBe(5);
    expect(packDetect(CARRY_CAPACITY)).toBe(PACK_DETECT_MAX);
    expect(CARRY_CAPACITY - PACK_HEAVY).toBe(PACK_DETECT_MAX); // a full pack is exactly the cap
    expect(packDetect(Number.NaN)).toBe(0);
  });

  it("composes base + points/100 + extra, and clamps to [0, DETECT_MAX]", () => {
    const r = composeStealth(0.25, { zombieState: "investigating", burden: 30, weight: PACK_HEAVY + 5 });
    expect(r.base).toBe(0.25);
    expect([r.arousal, r.scent, r.pack, r.alerted]).toStrictEqual([15, 3, 5, 0]);
    expect(r.total).toBeCloseTo(0.25 + 0.23, 10);
    // everything at once saturates, and never exceeds the ceiling detectChance has always kept.
    // The literal matters: "nothing is ever certain" is the rule, and asserting against DETECT_MAX
    // alone would let the ceiling be raised to 1 without a single test noticing.
    expect(DETECT_MAX).toBe(0.9);
    expect(DETECT_MAX).toBeLessThan(1);
    const hot = composeStealth(0.9, { zombieState: "chasing", burden: 500, weight: 999, alerted: true, extra: 0.25 });
    expect(hot.total).toBe(DETECT_MAX);
    // and the worst situation the game can actually build still leaves a way through
    expect(hot.total).toBeLessThan(1);
    // and a pathological base cannot drive it negative
    expect(composeStealth(-3, {}).total).toBe(0);
    expect(composeStealth(Number.NaN, {}).total).toBe(0);
  });

  it("property: the total is always a probability, monotone in arousal, alerted, scent and pack", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 120 }),
        (base, burden, weight) => {
          const calm = composeStealth(base, { zombieState: "dormant", burden, weight });
          const roused = composeStealth(base, { zombieState: "chasing", burden, weight });
          expect(calm.total).toBeGreaterThanOrEqual(0);
          expect(roused.total).toBeLessThanOrEqual(DETECT_MAX);
          expect(roused.total).toBeGreaterThanOrEqual(calm.total);
          expect(composeStealth(base, { burden, weight, alerted: true }).total).toBeGreaterThanOrEqual(
            composeStealth(base, { burden, weight }).total,
          );
          // scent and pack, the two terms the name also promises
          expect(composeStealth(base, { burden: burden + 50, weight }).total).toBeGreaterThanOrEqual(
            composeStealth(base, { burden, weight }).total,
          );
          expect(composeStealth(base, { burden, weight: weight + 50 }).total).toBeGreaterThanOrEqual(
            composeStealth(base, { burden, weight }).total,
          );
        },
      ),
    );
  });

  it("stealthRead reads the node and the body off the state", () => {
    const { state } = boot();
    const s = withPack(withWounds(withNode(state, HERE, { zombieState: "chasing" }), [wound(50)]), CARRY_CAPACITY);
    const r = stealthRead(s, 0.1);
    expect([r.arousal, r.scent, r.pack]).toStrictEqual([AROUSAL_DETECT.chasing, 5, PACK_DETECT_MAX]);
    expect(stealthDetectChance(s, 0.1)).toBe(r.total);
  });

  it("names the loudest reason, and names nothing when the world alone is the read", () => {
    expect(stealthTell(composeStealth(0.25, {}))).toBeNull();
    expect(stealthTell(composeStealth(0.25, { zombieState: "chasing", weight: 999 }))).toBe(
      "they have already turned toward you",
    );
    expect(stealthTell(composeStealth(0.25, { zombieState: "dormant", weight: 999 }))).toBe(
      "your pack shifts and clatters",
    );
  });

  it("and the tell actually reaches the player, in the sentence they read before choosing", () => {
    // "Signpost, don't retune": the roll got harder, so the reason has to be legible. A tell that is
    // only exported and never spoken is the same as no tell at all — which is what the first draft of
    // this change shipped.
    const { state } = boot();
    const calm = withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
      walkers: 2,
      noise: 0,
      zombieState: "dormant",
    });
    // the untaxed player keeps the exact pre-T77 sentence the accessibility transcript relies on
    expect(combatNarration(calm)).toBe("2 walkers shamble here. You can take them on, or slip away.");
    const roused = withNode(calm, HERE, { zombieState: "chasing" });
    expect(combatNarration(roused)).toContain("they have already turned toward you");
    const laden = withPack(calm, CARRY_CAPACITY);
    expect(combatNarration(laden)).toContain("your pack shifts and clatters");
    const bleeding = withWounds(calm, [wound(SCENT_FULL_AT)]);
    expect(combatNarration(bleeding)).toContain("blood");
  });
});

// ================================================================================================
// 3. The chain, end to end through the escape roll
// ================================================================================================

describe("the escape roll is finally coupled to the world (T77 · PL-M2-02)", () => {
  it("a roused node is harder to slip than a calm one at identical noise/phase/weather", () => {
    // THE headline. Unfixed, `detectChance(noise, phase, weather)` was the entire roll, so these two
    // situations were the SAME number and this expectation fails.
    const { state } = boot();
    const calm = withNode(state, HERE, { walkers: 3, noise: 20, zombieState: "dormant" });
    const roused = withNode(state, HERE, { walkers: 3, noise: 20, zombieState: "chasing" });
    const base = detectChance(20, state.meta.phase, state.world.weather);
    expect(stealthDetectChance(calm, base)).toBe(base);
    expect(stealthDetectChance(roused, base)).toBeGreaterThan(stealthDetectChance(calm, base));
    expect(stealthDetectChance(roused, base) - stealthDetectChance(calm, base)).toBeCloseTo(
      AROUSAL_DETECT.chasing / 100,
      10,
    );
  });

  it("night in fog no longer makes a chasing node free to walk away from", () => {
    // detectChance clamps to 0 at night in fog (0.25 − 0.15 − 0.20), so the unfixed roll made the
    // darkest, foggiest night a GUARANTEED clean escape from anything, however roused. The design
    // review's "night is the safe phase" is a separate task; this is the part T77 owns.
    const { state } = boot();
    const foggy = { ...state, meta: { ...state.meta, phase: "night" as const }, world: { ...state.world, weather: "weather.fog" } };
    const base = detectChance(0, "night", "weather.fog");
    expect(base).toBe(0);
    expect(stealthDetectChance(withNode(foggy, HERE, { zombieState: "dormant" }), base)).toBe(0);
    expect(stealthDetectChance(withNode(foggy, HERE, { zombieState: "chasing" }), base)).toBeCloseTo(
      AROUSAL_DETECT.chasing / 100,
      10,
    );
  });

  it("a bleeding, laden player is caught more often than a whole, empty-handed one", () => {
    const { state } = boot();
    const node = withNode(state, HERE, { zombieState: "dormant", noise: 0 });
    const base = detectChance(0, state.meta.phase, state.world.weather);
    const fresh = stealthDetectChance(node, base);
    const hurt = stealthDetectChance(withWounds(node, [wound(60)]), base);
    const laden = stealthDetectChance(withPack(node, CARRY_CAPACITY), base);
    expect(hurt).toBeGreaterThan(fresh);
    expect(laden).toBeGreaterThan(fresh);
    expect(stealthDetectChance(withPack(withWounds(node, [wound(60)]), CARRY_CAPACITY), base)).toBeGreaterThan(
      Math.max(hurt, laden),
    );
  });

  it("the alerted term is worth exactly ALERTED_DETECT points on the composed read", () => {
    // `CombatState.alerted` was written at combat.ts:307 and :320 and read in no condition anywhere.
    // This is the arithmetic; the test below is the one that proves the PRODUCTION path reads it.
    // (It is still structurally always true in a live fight — see ALERTED_DETECT and PL-M5-22 — so
    // what the pair pins is retreat-vs-slip, honestly.)
    const { state } = boot();
    const node = withNode(state, HERE, { zombieState: "wandering" });
    const base = detectChance(0, state.meta.phase, state.world.weather);
    expect(stealthDetectChance(node, base, { alerted: true }) - stealthDetectChance(node, base)).toBeCloseTo(
      ALERTED_DETECT / 100,
      10,
    );
  });

  it("a RETREAT from a live fight really is caught more often than the identical slip", () => {
    // The one production read of `CombatState.alerted`, end to end through `applyAction`. Without it
    // this pair of situations — same node, same phase, same weather, same seed, differing only in
    // whether a fight is live — rolls the same number, which is the whole complaint in the task note:
    // "retreating from a fully alerted enemy is the same roll as slipping past one that never noticed
    // you". Hardcoding `alerted = false` in `resolveEscape` leaves every other test in the repo green;
    // this is the one that kills that mutant.
    const hurtCount = (asRetreat: boolean): number => {
      let hurt = 0;
      for (let i = 0; i < 80; i += 1) {
        const { state, graph } = boot(`alerted-${i}`);
        const at = discoverAll(withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
          walkers: 3,
          noise: 0,
          zombieState: "wandering",
        }));
        const s: GameState = asRetreat
          ? { ...at, combat: { node: HERE, enemy: "enemy.walker", hp: 2, maxHp: 3, alerted: true } }
          : at;
        const choice = asRetreat
          ? combatChoices(s, graph).find((c) => c.id === `retreat:${NEXT}`)!
          : encounterChoices(s, graph).find((c) => c.id === `slip:${NEXT}`)!;
        const after = applyAction(s, choice.action, graph).state;
        if (after.player.condition.wounds.length > s.player.condition.wounds.length) hurt += 1;
      }
      return hurt;
    };
    expect(hurtCount(true)).toBeGreaterThan(hurtCount(false));
  });

  it("a slip out of a roused node really does wound more often over many seeds", () => {
    // End to end through `applyAction`, not the pure function: the roll has to reach the player.
    const run = (zombieState: string): number => {
      let hurt = 0;
      for (let i = 0; i < 60; i += 1) {
        const { state, graph } = boot(`slip-${i}`);
        const s = discoverAll(withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
          walkers: 3,
          noise: 0,
          zombieState,
        }));
        const slip = encounterChoices(s, graph).find((c) => c.id === `slip:${NEXT}`)!;
        const after = applyAction(s, slip.action, graph).state;
        if (after.player.condition.wounds.length > s.player.condition.wounds.length) hurt += 1;
      }
      return hurt;
    };
    const calm = run("dormant");
    const roused = run("chasing");
    expect(roused).toBeGreaterThan(calm);
  });

  it("the overrun's flight rolls the same read, still floored", () => {
    const { state } = boot();
    const quiet = withNode({ ...state, meta: { ...state.meta, phase: "night" } }, HERE, { zombieState: "dormant", noise: 0 });
    expect(overrunEscapeChance(quiet)).toBe(OVERRUN_ESCAPE_FLOOR); // the floor still does its job
    const loaded = withPack(withWounds(withNode(quiet, HERE, { zombieState: "chasing", noise: 60 }), [wound(80)]), CARRY_CAPACITY);
    expect(overrunEscapeChance(loaded)).toBeGreaterThan(OVERRUN_ESCAPE_FLOOR);
    expect(overrunEscapeChance(loaded)).toBeLessThanOrEqual(DETECT_MAX);
  });
});

// ================================================================================================
// 4. Escapes obey the roads (PL-M2-05), and avoidance is no longer free
// ================================================================================================

describe("escapes obey the same roads travel does (T77 · PL-M2-05)", () => {

  it("a blocked route is dropped from the escape set while any other road is passable", () => {
    // Unfixed, `escapeTargets` filtered on `discovered` alone: standing at a walker node let you cross
    // a route travel refuses — walkers as a fast-travel network. Blocked roads ARE reachable on the
    // shipped city (weather degrades `RegionState.roads` monotonically and never restores them), so
    // this is a live rule, not a hypothetical one.
    const { state, graph } = boot();
    const s = discoverAll(withNode(state, MID, { walkers: 3 }));
    const atMid = { ...s, player: { ...s.player, location: MID } };
    expect(escapeTargets(atMid, graph)).toStrictEqual([HERE, "node.x.2"]);
    const blocked = blockRoute(atMid, MID, "node.x.2", ROUTE_BLOCKED_AT);
    expect(escapeTargets(blocked, graph)).toStrictEqual([HERE]);
    expect(encounterChoices(blocked, graph).some((c) => c.id === "slip:node.x.2")).toBe(false);
    expect(combatChoices(blocked, graph).some((c) => c.id === "retreat:node.x.2")).toBe(false);
  });

  it("but the LAST way out is never taken away — FR-CBT-05 over the road rules", () => {
    // The rule the task note asked for, applied unconditionally, is a stranding bug — and PL-M2-05's
    // own recorded text says the hole was "deliberate so a fight can never strand the player behind a
    // blocked road". FR-CBT-05 is a Must: you always get out. So a blocked road is refused only while
    // there is somewhere else to run. This test fails against BOTH the unfixed code (which never
    // filtered at all, so the first expectation's filtering is absent) and against the obvious fix.
    const { state, graph } = boot();
    const walled = [...Object.keys(state.nodes)].reduce(
      (acc, id) => (id === MID ? acc : blockRoute(acc, MID, id, ROUTE_BLOCKED_AT)),
      { ...discoverAll(withNode(state, MID, { walkers: 3 })), player: { ...state.player, location: MID } },
    );
    expect(escapeTargets(walled, graph)).toStrictEqual([HERE, "node.x.2"]); // boxed in ⇒ still offered
    expect(encounterChoices(walled, graph).some((c) => c.id.startsWith("slip:"))).toBe(true);
    expect(availableActions(walled, graph).length).toBeGreaterThan(0);
    // and forcing the crossing is the most expensive way off the node, never a free one
    expect(escapeExtraCost(walled, HERE)).toBe(extraCostOf(ROUTE_FLOODED_AT));
    expect(escapeExtraCost(walled, HERE)).toBeGreaterThan(extraCostOf(ROUTE_COSTLY_AT));
    // the label says so, rather than charging the hours silently
    expect(encounterChoices(walled, graph).find((c) => c.id === `slip:${HERE}`)!.label).toContain("blocked");
  });

  it("a node with no discovered neighbour at all offers the fight, not an empty list", () => {
    // The PL-M5-14 softlock class: `availableActions` must always hand back something.
    const { state, graph } = boot();
    const fogged = withNode(withNode(state, MID, { walkers: 3 }), NEXT, { discovered: false });
    const atMid = { ...fogged, player: { ...fogged.player, location: MID }, nodes: { ...fogged.nodes, [HERE]: { ...fogged.nodes[HERE]!, discovered: false }, "node.x.2": { ...fogged.nodes["node.x.2"]!, discovered: false } } };
    expect(escapeTargets(atMid, graph)).toStrictEqual([]);
    expect(availableActions(atMid, graph).length).toBeGreaterThan(0);
    expect(encounterChoices(atMid, graph).some((c) => c.id === "fight")).toBe(true);
  });

  it("a worn route costs the escape what it costs the walk", () => {
    // Unfixed, a slip over a flooded road cost a flat SLIP_COST while `move` charged +2 — measured on
    // the shipped city as 115 offers over worn routes and 36 hours dodged across 16 runs.
    const { state, graph } = boot();
    const s = discoverAll(withNode(state, HERE, { walkers: 3 }));
    expect(escapeExtraCost(s, NEXT)).toBe(0);
    const flooded = blockRoute(s, HERE, NEXT, ROUTE_BLOCKED_AT - 1); // flooded, not blocked
    const extra = escapeExtraCost(flooded, NEXT);
    expect(extra).toBeGreaterThan(0);
    expect(encounterChoices(flooded, graph).find((c) => c.id === `slip:${NEXT}`)!.timeCost).toBe(SLIP_COST + extra);
    expect(combatChoices(flooded, graph).find((c) => c.id === `retreat:${NEXT}`)!.timeCost).toBe(RETREAT_COST + extra);
  });

  it("avoidance is no longer free at the margin: a slip costs more than the same walk", () => {
    // SLIP_COST === MOVE_COST === 2 meant choosing the safe verb cost nothing you would not have spent
    // anyway. A retreat deliberately stays at MOVE_COST — it pays in the alerted term instead.
    expect(SLIP_COST).toBe(MOVE_COST + 1);
    expect(RETREAT_COST).toBe(MOVE_COST);
    expect(ALERTED_DETECT).toBeGreaterThan(0);
  });
});

// ================================================================================================
// 5. The house rules: determinism, integers, save-losslessness, inertness
// ================================================================================================

describe("T77 keeps the house rules (ADR-0001)", () => {
  it("adds no state: a slip round-trips through save/load unchanged", () => {
    const { state, graph } = boot();
    const s = discoverAll(withNode(state, HERE, { walkers: 3, zombieState: "chasing" }));
    const slip = encounterChoices(s, graph).find((c) => c.id === `slip:${NEXT}`)!;
    const after = applyAction(s, slip.action, graph).state;
    expect(loadGame(saveGame(after))).toStrictEqual(after);
    expect(JSON.parse(saveGame(after)).version).toBe(JSON.parse(saveGame(state)).version); // no rung
  });

  it("the same seed and the same situation produce the same roll, every time", () => {
    const once = (): GameState => {
      const { state, graph } = boot("determinism");
      const s = discoverAll(withNode(state, HERE, { walkers: 3, zombieState: "investigating", noise: 30 }));
      return applyAction(s, encounterChoices(s, graph).find((c) => c.id === `slip:${NEXT}`)!.action, graph).state;
    };
    expect(saveGame(once())).toBe(saveGame(once()));
  });

  it("every point term is an integer, for any state a hand-edited save could hold", () => {
    fc.assert(
      fc.property(fc.integer({ min: -500, max: 5000 }), fc.integer({ min: -500, max: 5000 }), (burden, weight) => {
        const r = composeStealth(0.3, { zombieState: "chasing", burden, weight, alerted: true });
        for (const v of [r.arousal, r.alerted, r.scent, r.pack]) expect(Number.isInteger(v)).toBe(true);
        expect(Number.isFinite(r.total)).toBe(true);
      }),
    );
  });

  it("a hand-edited save cannot switch the arousal ladder OFF through a NaN wound", () => {
    // Found by audit, not by design. `assertSaveFile` is deliberately shallow, so a wound with a
    // missing `severity` loads and makes `woundBurden` NaN. Unguarded, that NaN flows through
    // `scentDraw` into `stimulusAt`, and `desiredRung(NaN)` fails every comparison and returns 0 — so
    // the node relaxes to `hibernating` and BOTH the ladder and this task's arousal term switch off
    // for every node the player stands on. The pre-T77 flat bonus could not do that; `scentDraw` can.
    const { state, graph } = boot();
    const broken = {
      ...state,
      player: {
        ...state.player,
        location: HERE,
        condition: {
          ...state.player.condition,
          wounds: [{ type: "wound.bite", site: "arm", treated: 0, inflictedDay: 1 } as unknown as Wound, wound(30)],
        },
      },
    } as GameState;
    expect(Number.isNaN(woundBurden(broken.player.condition))).toBe(true); // the input really is NaN
    expect(scentDraw(broken.player.condition)).toBe(0); // ...and the draw is still a number
    const node = withNode({ ...broken, meta: { ...broken.meta, phase: "midday" } }, HERE, {
      walkers: 3,
      noise: 0,
      zombieState: "dormant",
    });
    expect(Number.isNaN(stimulusAt(node, HERE, node.nodes[HERE]!, graph))).toBe(false);
    expect(tickZombies(node, 2, graph).nodes[HERE]!.zombieState).toBe("investigating"); // NOT hibernating
  });

  it("an INFINITE body reads as maximally alarming, not as unhurt", () => {
    // `JSON.parse("1e999")` is `Infinity`, so a hand-edited save reaches here. The first draft of
    // this module guarded with `Number.isFinite(n) ? trunc(n) : 0`, which answers "unhurt and
    // empty-handed" to the most alarming state representable and makes `scentDraw` (which read it as
    // fully bleeding) disagree with `scentDetect` about the same body. The plain clamp is both
    // simpler and correct here; this test is what stops the bad guard coming back.
    expect(scentDetect(Number.POSITIVE_INFINITY)).toBe(SCENT_DETECT_MAX);
    expect(packDetect(Number.POSITIVE_INFINITY)).toBe(PACK_DETECT_MAX);
    expect(scentDetect(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(packDetect(Number.NEGATIVE_INFINITY)).toBe(0);
    const { state } = boot();
    const inf = withWounds(state, [wound(Number.POSITIVE_INFINITY)]);
    expect(scentDraw(inf.player.condition)).toBe(SCENT_BONUS); // the two halves agree
    expect(Number.isFinite(stealthRead(inf, 0.25).total)).toBe(true);
  });

  it("a feeding nest does not keep its head down with the player standing in it", () => {
    // T77 created this: with PLAYER_HERE_BONUS at 40 a feeding node snapped straight to `chasing`, but
    // at 25 the presence rung TIES `RUNG.feeding`, so without the guard the node sits there feeding —
    // and `AROUSAL_DETECT.feeding` (5) would hand the player a DISCOUNT for standing on a nest
    // mid-meal, cheaper than the `investigating` (15) an empty node charges. Unreachable on today's
    // content (nothing writes `NodeState.corpses` — PL-M5-25), which is exactly why it needs a test.
    expect(AROUSAL_DETECT.feeding).toBeLessThan(AROUSAL_DETECT.investigating); // the discount exists
    const { state, graph } = boot();
    const nest = withNode({ ...state, meta: { ...state.meta, phase: "midday" } }, HERE, {
      walkers: 3,
      noise: 0,
      corpses: 2,
      zombieState: "feeding",
    });
    expect(tickZombies(nest, 2, graph).nodes[HERE]!.zombieState).toBe("investigating");
    // away from the player it stays on the dead, which is the rung's whole point
    const elsewhere = { ...nest, player: { ...nest.player, location: "node.x.3" } };
    expect(tickZombies(elsewhere, 2, graph).nodes[HERE]!.zombieState).toBe("feeding");
  });

  it("is inert on a calm, unhurt, empty-handed player — the pre-T77 roll, exactly", () => {
    // Nothing about this change may tax a player it has nothing to say about.
    const { state } = boot();
    const s = withNode(state, HERE, { zombieState: "dormant", noise: 40 });
    const base = detectChance(40, s.meta.phase, s.world.weather);
    expect(stealthDetectChance(s, base)).toBe(base);
    expect(stealthRead(s, base).total).toBe(base);
  });
});
