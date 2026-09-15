import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  contestRegion,
  createInitialState,
  difficultyOf,
  resolveSearchLoot,
  difficultyProfile,
  DIFFICULTY_MODES,
  driftNeeds,
  IDENTITY_PROFILE,
  isRunOver,
  isIronman,
  loadGame,
  modeInfo,
  parseDifficulty,
  profileOf,
  saveGame,
  SAVE_SCHEMA_VERSION,
  scaleInt,
  startRun,
  tickDirector,
  DIRECTOR_COASTING_TURNS,
  LAST_STAND_AT,
  LOOT_POINTS_PER_ITEM,
  unitsForPoints,
  lastStandAt,
  inLastStand,
  type DifficultyMode,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T56 — explicit difficulty modes (GDD XVI). A mode resolves to a scalar dial profile on
 * survivability/scarcity/pacing. Survivor — and an unset difficulty — is the IDENTITY profile, so a
 * baseline run is byte-identical to a pre-difficulty-modes run; the other modes bite in a proven direction.
 * The magnitudes are M5's to calibrate; these tests pin the *mechanism*: identity, direction, no save rung.
 */

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 15, threat: 8, survivorActivity: 60, loot: 90 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a store", adjacent: ["node.x.b"], start: true, kind: "store" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a house", adjacent: ["node.x.a"], kind: "residential" },
];
const CREATED = "2026-07-05T00:00:00Z";

const mkOpts = (difficulty?: DifficultyMode, ironman?: boolean) => ({
  seed: "difficulty-run",
  createdAt: CREATED,
  ...(difficulty ? { difficulty } : {}),
  ...(ironman ? { ironman } : {}),
});

/** A fixed, deterministic action script: rotate through the offered actions (move/search/rest) for K
 *  turns so time drifts needs, searches hit the loot cap, and the world ticks contest + director. */
function runScript(difficulty?: DifficultyMode, turns = 16): GameState {
  const { state, graph } = startRun(mkOpts(difficulty), REGIONS, NODES) as { state: GameState; graph: RegionGraph };
  let s = state;
  for (let i = 0; i < turns; i++) {
    if (isRunOver(s)) break;
    const choices = availableActions(s, graph);
    if (choices.length === 0) break;
    s = applyAction(s, choices[i % choices.length]!.action, graph).state;
  }
  return s;
}

/** Ping-pong MOVE between the two nodes for K turns: an identical action path in every mode (moves don't
 *  branch on needs), so time passes cleanly — needs drift + loot contest tick, with no eat/drink/search
 *  confound — and the survivability/scarcity dials show monotonically. */
function runMoves(difficulty: DifficultyMode | undefined, turns: number): GameState {
  const { state, graph } = startRun(mkOpts(difficulty), REGIONS, NODES) as { state: GameState; graph: RegionGraph };
  let s = state;
  for (let i = 0; i < turns; i++) {
    if (isRunOver(s)) break;
    const move = availableActions(s, graph).find((c) => c.action.type === "move");
    if (!move) break;
    s = applyAction(s, move.action, graph).state;
  }
  return s;
}

/** Resolve one loot draw directly against a hand-set region loot + fresh (searchPct 0) node; items gained. */
function searchOnceAtLoot(difficulty: DifficultyMode | undefined, loot: number, seed?: string): number {
  const base = mkOpts(difficulty);
  const { state } = startRun(seed === undefined ? base : { ...base, seed }, REGIONS, NODES) as { state: GameState; graph: RegionGraph };
  const nodeId = "node.x.a";
  const thin: GameState = {
    ...state,
    nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId]!, searchPct: 0 } },
    regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot } },
  };
  const count = (s: GameState): number => s.player.inventory.reduce((n, e) => n + e.quantity, 0);
  return count(resolveSearchLoot(thin, nodeId, "store")) - count(thin);
}

const needSum = (s: GameState): number => {
  const n = s.player.condition.needs;
  return n.hunger + n.thirst + n.fatigue;
};
const regionLoot = (s: GameState): number => s.regions["region.x"]!.loot;

// --- profile resolution ---------------------------------------------------------------------

describe("difficulty profile resolution (T56)", () => {
  it("Survivor and an unset difficulty resolve to the identity profile", () => {
    expect(difficultyProfile("survivor")).toEqual(IDENTITY_PROFILE);
    expect(difficultyProfile(undefined)).toEqual(IDENTITY_PROFILE);
    // Every dial is exactly 1 in the identity — the byte-identity anchor.
    for (const v of Object.values(IDENTITY_PROFILE)) expect(v).toBe(1);
  });

  it("degrades an unrecognized mode to the identity (defensive — a corrupt/newer save plays as Survivor, never NaN)", () => {
    // Includes Object.prototype keys: a plain-object lookup would return a truthy INHERITED member for these
    // and bypass the fallback (ENG audit) — the hasOwnProperty guard must send them to the identity too.
    for (const bad of ["bogus", "__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const p = difficultyProfile(bad as DifficultyMode);
      expect(p).toEqual(IDENTITY_PROFILE);
      for (const v of Object.values(p)) expect(typeof v).toBe("number"); // never an undefined / inherited-fn dial
    }
  });

  it("orders the dials by mode: harder ⇒ faster drift/contest/aggression, thinner relief/yield", () => {
    const s = difficultyProfile("story");
    const v = difficultyProfile("survivor");
    const h = difficultyProfile("hardcore");
    const n = difficultyProfile("nightmare");
    // Survivability + scarcity + pacing all tighten as the floor rises.
    expect(s.needDrift).toBeLessThan(v.needDrift);
    expect(v.needDrift).toBeLessThan(h.needDrift);
    expect(h.needDrift).toBeLessThan(n.needDrift);
    expect(s.lootContest).toBeLessThan(v.lootContest);
    expect(v.lootContest).toBeLessThan(n.lootContest);
    // directorAggression uses integer steps so Hardcore/Nightmare actually separate from Survivor's 1
    // (a value in (1,2) would trunc back to 1): 0.5 < 1 < 2 < 3.
    expect(s.directorAggression).toBeLessThan(v.directorAggression);
    expect(v.directorAggression).toBeLessThan(h.directorAggression);
    expect(h.directorAggression).toBeLessThan(n.directorAggression);
    // Relief loosens as the floor rises. lootYield is a DENIAL gate (≤1): Story is neutral (== Survivor),
    // harder modes deny thin finds; Story's loot ease rides lootContest, not lootYield.
    expect(s.needRelief).toBeGreaterThan(v.needRelief);
    expect(h.needRelief).toBeLessThan(v.needRelief);
    expect(s.lootYield).toBe(v.lootYield); // Story neutral on the find-denial gate
    expect(h.lootYield).toBeLessThan(v.lootYield);
    expect(n.lootYield).toBeLessThan(h.lootYield);
  });

  it("exposes exactly the four modes with words-only display metadata (no dial numbers leak)", () => {
    expect(DIFFICULTY_MODES.map((m) => m.mode)).toEqual(["story", "survivor", "hardcore", "nightmare"]);
    for (const m of DIFFICULTY_MODES) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.gloss).not.toMatch(/[0-9]/); // no magnitude leak in the player-facing gloss
      expect(modeInfo(m.mode)).toBe(m);
    }
    expect(parseDifficulty("NIGHTMARE")).toBe("nightmare");
    expect(parseDifficulty(" story ")).toBe("story");
    expect(parseDifficulty("brutal")).toBeNull();
  });
});

// --- the dial helper is a provable no-op at identity -----------------------------------------

describe("scaleInt short-circuits at identity (the byte-identity guarantee) (T56)", () => {
  it("returns the exact input when the multiplier is 1", () => {
    for (const n of [0, 1, 2, 45, 55, 99, 100, 1234]) expect(scaleInt(n, 1)).toBe(n);
    expect(scaleInt(7)).toBe(7); // default multiplier is 1
  });
  it("truncates toward zero for a non-identity multiplier", () => {
    expect(scaleInt(45, 1.3)).toBe(58); // trunc(58.5)
    expect(scaleInt(45, 0.7)).toBe(31); // trunc(31.5)
    expect(scaleInt(10, 0.5)).toBe(5);
    expect(scaleInt(2, 1.8)).toBe(3); // trunc(3.6)
  });
});

// --- no save rung: Survivor / default is byte-identical; a mode round-trips losslessly --------

describe("difficulty is stored optional-tolerated-absent — no save rung (T56)", () => {
  const base = createInitialState({ seed: "s", createdAt: CREATED });
  const survivor = createInitialState({ seed: "s", createdAt: CREATED, difficulty: "survivor" });

  it("Survivor and default produce the byte-identical save (Survivor normalizes to absent)", () => {
    expect(saveGame(survivor)).toBe(saveGame(base));
    expect(saveGame(base)).not.toContain("difficulty");
    expect(saveGame(base)).not.toContain("ironman");
    expect(base.meta.difficulty).toBeUndefined();
    expect(survivor.meta.difficulty).toBeUndefined();
  });

  it("stays at save-schema v10 — no version bump", () => {
    expect(SAVE_SCHEMA_VERSION).toBe(10);
    expect(base.meta.version).toBe(10);
    expect(createInitialState({ seed: "s", createdAt: CREATED, difficulty: "nightmare" }).meta.version).toBe(10);
  });

  it("a non-baseline mode is recorded and round-trips through save/load losslessly", () => {
    const hard = createInitialState({ seed: "s", createdAt: CREATED, difficulty: "hardcore" });
    expect(hard.meta.difficulty).toBe("hardcore");
    expect(saveGame(hard)).toContain('"difficulty":"hardcore"');
    expect(loadGame(saveGame(hard))).toEqual(hard);
    expect(difficultyOf(hard)).toBe("hardcore");
    expect(difficultyOf(base)).toBe("survivor"); // unset normalizes to the baseline label
  });

  it("Ironman is a layerable, persisted intent — recorded only when chosen", () => {
    const iron = createInitialState({ seed: "s", createdAt: CREATED, ironman: true });
    expect(iron.meta.ironman).toBe(true);
    expect(isIronman(iron)).toBe(true);
    expect(saveGame(iron)).toContain('"ironman":true');
    expect(isIronman(base)).toBe(false);
    // Ironman layers on any mode, including Survivor — no difficulty field, but the ironman flag is set.
    expect(saveGame(iron)).not.toContain("difficulty");
    // Nightmare + Ironman together.
    const both = createInitialState({ seed: "s", createdAt: CREATED, difficulty: "nightmare", ironman: true });
    expect(both.meta.difficulty).toBe("nightmare");
    expect(isIronman(both)).toBe(true);
    expect(loadGame(saveGame(both))).toEqual(both);
  });

  it("profileOf reads meta.difficulty; isIronman reads meta.ironman", () => {
    expect(profileOf(base)).toEqual(IDENTITY_PROFILE);
    expect(profileOf(createInitialState({ seed: "s", createdAt: CREATED, difficulty: "nightmare" }))).toEqual(
      difficultyProfile("nightmare"),
    );
  });
});

// --- the dials bite at the leaf, and are identity at Survivor --------------------------------

describe("dials scale the leaf rates, identity at Survivor (T56)", () => {
  it("driftNeeds: default (=1) is unchanged; harder climbs faster, Story slower", () => {
    const start = { hunger: 0, thirst: 0, fatigue: 0 };
    const base = driftNeeds(start, false, 4);
    expect(driftNeeds(start, false, 4, 1)).toEqual(base); // explicit identity == default
    const hard = driftNeeds(start, false, 4, difficultyProfile("nightmare").needDrift);
    const soft = driftNeeds(start, false, 4, difficultyProfile("story").needDrift);
    expect(hard.hunger).toBeGreaterThan(base.hunger);
    expect(soft.hunger).toBeLessThan(base.hunger);
  });

  it("contestRegion: default (=1) is unchanged; a harsher contest debits more", () => {
    const region = startRun(mkOpts(), REGIONS, NODES).state.regions["region.x"]!;
    const base = contestRegion(region, 6);
    expect(contestRegion(region, 6, 1)).toEqual(base);
    const harsh = contestRegion(region, 6, difficultyProfile("nightmare").lootContest);
    expect(harsh.loot).toBeLessThan(base.loot);
  });
});

// --- integration: Survivor == baseline; harder/softer diverge in the proven direction --------

describe("scripted-run divergence — the identity proof + the modes actually bite (T56)", () => {
  it("an unset difficulty and Survivor produce the byte-identical run over the FULL action surface (the in-suite identity proof)", () => {
    // runScript rotates through every offered action (move/search/rest/eat/drink), so this exercises the
    // needs, loot-search, contest, and director dials on the baseline path — all must be byte-identical.
    expect(saveGame(runScript(undefined))).toBe(saveGame(runScript("survivor")));
  });

  it("needs bite monotonically by mode: Nightmare > Survivor > Story (survivability dial, clean move path)", () => {
    const story = runMoves("story", 12);
    const surv = runMoves("survivor", 12);
    const night = runMoves("nightmare", 12);
    expect(saveGame(surv)).toBe(saveGame(runMoves(undefined, 12))); // Survivor == unset on the move path too
    expect(needSum(night)).toBeGreaterThan(needSum(surv));
    expect(needSum(surv)).toBeGreaterThan(needSum(story));
    expect(saveGame(night)).not.toBe(saveGame(surv));
    expect(saveGame(story)).not.toBe(saveGame(surv));
  });

  it("the world eats loot faster in harder modes: Nightmare < Survivor < Story (scarcity contest dial)", () => {
    expect(regionLoot(runMoves("nightmare", 12))).toBeLessThan(regionLoot(runMoves("survivor", 12)));
    expect(regionLoot(runMoves("survivor", 12))).toBeLessThan(regionLoot(runMoves("story", 12)));
  });

  it("a harder mode converts the same district offer into a smaller haul — and the modes separate from EACH OTHER (scarcity haul dial · T60 closes PL-M4-54)", () => {
    // **What PL-M4-54 was.** T56 sited `lootYield` on the yield CAP, where it was only ever read as a
    // boolean gate (`if (trunc(cap * mult) <= 0)`) while the draw used the RAW cap. A gate can only fire
    // where `cap === 1`, and at `cap === 1` Hardcore's 0.8 and Nightmare's 0.6 are byte-identical to
    // each other — so the dial could not tell two modes apart anywhere in the game. T59 measured the
    // reachable share of searches at 7% and declared the item rather than pretending; T60 measured what
    // it was worth end to end on that siting: **0.1 turns** against an identity control over 120 runs.
    //
    // **What it is now.** The dial scales the POINTS the district offers before they convert to items,
    // so it reduces every haul proportionally instead of denying a rare thin one. The three assertions
    // below are the three things the old siting could not do.
    //
    // Summed over a sweep of district richnesses rather than asserted on one draw: a single `drawInt`
    // is one sample of a 1..cap distribution, and a test that happens to catch a small one proves
    // nothing about a dial. The sweep is the claim — across the range a district can be in, a harder
    // mode carries less away.
    // Summed over twelve SEEDS at a rich district, not over one draw. A search is one `drawInt` over
    // `1..cap`, and `searchOnceAtLoot` always starts from a fresh run, so a single seed samples that
    // distribution exactly once — at the seed this suite uses, always near the bottom, which is how a
    // one-draw version of this test came out asserting 3 < 3. The sweep is the claim.
    const SEEDS = ["haul-a", "haul-b", "haul-c", "haul-d", "haul-e", "haul-f",
                   "haul-g", "haul-h", "haul-i", "haul-j", "haul-k", "haul-l"] as const;
    const hauled = (mode: DifficultyMode | undefined): number =>
      SEEDS.reduce((n, sd) => n + searchOnceAtLoot(mode, 90, sd), 0);
    const surv = hauled("survivor");
    const hard = hauled("hardcore");
    const night = hauled("nightmare");
    // 1. Survivor / unset is the identity — untouched, byte-identical, the pre-difficulty-modes haul.
    expect(hauled(undefined)).toBe(surv);
    // 2. Harder modes haul strictly less...
    expect(hard).toBeLessThan(surv);
    expect(night).toBeLessThan(surv);
    // 3. ...and they are DISTINGUISHABLE FROM EACH OTHER, which is the whole of PL-M4-54. This is the
    //    assertion the pre-T60 dial failed at every loot value in the game: the old gate fired only at
    //    `cap === 1`, where `trunc(1 * 0.8)` and `trunc(1 * 0.6)` are both 0.
    expect(night).toBeLessThan(hard);
    // The dial only ever reduces: Story keeps it at 1 and takes its loot advantage through lootContest.
    expect(hauled("story")).toBe(surv);
  });

  it("the haul dial scales POINTS, not units — so it has no cliff and a one-unit haul survives (T60)", () => {
    // Why the siting matters, pinned so a future retune cannot quietly move it back. Units are a small
    // integer whose modal value is 1, and a multiplicative dial on a small integer is a switch: scaling
    // UNITS sends 0.8 and 0.6 to the same place on a one-unit haul (both to nothing). Scaling POINTS
    // keeps the fraction in the larger number. A mutation sweep found the units-scaled variant
    // indistinguishable from the shipped one under every other test in this file.
    //
    // Asserted THROUGH `resolveSearch`, not on the arithmetic alone — a first cut compared the two
    // formulae directly and a mutation sweep walked straight past it, because the mutant changes the
    // call site and the arithmetic is the same either way.
    //
    // A district at loot 8 has a yield cap of 2, so its whole offer is one or two points — the modal
    // haul, and exactly where the two sitings disagree. Points-scaled, `trunc(2 * 0.6)` is 1 point and
    // still converts to one item; units-scaled, `unitsForPoints(2)` is 1 unit and `trunc(1 * 0.6)` is
    // NOTHING. Over fourteen seeds a harder mode must still come away with something.
    const CLIFF_SEEDS = Array.from({ length: 14 }, (_, i) => `haul-cliff-${i}`);
    const hauledAt = (mode: DifficultyMode | undefined, loot: number): number =>
      CLIFF_SEEDS.reduce((n, sd) => n + searchOnceAtLoot(mode, loot, sd), 0);
    expect(hauledAt("nightmare", 8)).toBeGreaterThan(0);
    expect(hauledAt("hardcore", 8)).toBeGreaterThan(0);
    // ...while still hauling strictly less than Survivor over the same fourteen draws.
    expect(hauledAt("nightmare", 8)).toBeLessThan(hauledAt("survivor", 8));

    // And the arithmetic that explains it, stated once: a one-unit offer survives every shipped dial.
    const oneUnit = LOOT_POINTS_PER_ITEM;
    expect(unitsForPoints(oneUnit)).toBe(1);
    for (const mode of ["hardcore", "nightmare"] as const) {
      const y = profileOf(startRun(mkOpts(mode), REGIONS, NODES).state as GameState).lootYield;
      expect(y).toBeLessThan(1);
      expect(unitsForPoints(scaleInt(oneUnit, y))).toBe(1);       // points-scaled: the haul survives...
      expect(scaleInt(unitsForPoints(oneUnit), y)).toBe(0);       // ...units-scaled: it would not.
    }
    // And across the range the haul is monotone with no step of more than one unit per 0.1 of dial.
    const offer = 20;
    const hauls = [1, 0.9, 0.8, 0.7, 0.6, 0.5].map((y) => unitsForPoints(scaleInt(offer, y)));
    for (let i = 1; i < hauls.length; i++) {
      expect(hauls[i]!).toBeLessThanOrEqual(hauls[i - 1]!);
      expect(hauls[i - 1]! - hauls[i]!).toBeLessThanOrEqual(1);
    }
  });

  it("a haul the dial denies still costs the district what it offered — scarcity does not make the world richer (T60)", () => {
    // The leak an audit measured: `units === 0` left `taken` at 0, so a harder mode FORGAVE the point
    // it consumed. Nightmare debited 10.4% fewer region points than Survivor over identical draws,
    // slower in all 14 (loot, searchPct) cells — backwards for a scarcity mode, and a direct
    // contradiction of the loot site's own claim that depletion stays owned by `lootContest`.
    const drained = (mode: DifficultyMode | undefined, loot: number, seed: string): number => {
      const base = mkOpts(mode);
      const { state } = startRun({ ...base, seed }, REGIONS, NODES) as { state: GameState };
      const thin: GameState = { ...state,
        nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot } } };
      return loot - resolveSearchLoot(thin, "node.x.a", "store").regions["region.x"]!.loot;
    };
    const SEEDS = ["drain-a", "drain-b", "drain-c", "drain-d", "drain-e", "drain-f"] as const;
    const total = (mode: DifficultyMode | undefined): number =>
      SEEDS.reduce((n, sd) => n + [4, 6, 8, 12, 20, 40].reduce((m, l) => m + drained(mode, l, sd), 0), 0);
    const surv = total("survivor");
    // A harder mode never drains LESS than Survivor over the same draws. Equality is fine — the dial is
    // not a depletion dial — but the strict inequality in the wrong direction is the defect.
    expect(total("hardcore")).toBeGreaterThanOrEqual(surv);
    expect(total("nightmare")).toBeGreaterThanOrEqual(surv);
    // ...and the specific case: a district whose whole offer is one point still pays it.
    const thinOne = drained("nightmare", 4, "drain-a");
    expect(thinOne).toBeGreaterThan(0);
  });

  it("a node that can never pay in this mode says so — the label reads the dial (T60 re-opened T84's rule)", () => {
    // T84: "a Scene that offers two hours and 25 noise without saying so is lying by omission." T60
    // re-sited `lootYield` and re-opened that for two of the four modes — at region loot 4 the cap is 1,
    // the only possible offer is one point, and a harder mode hauls nothing from it forever, while the
    // affordance still read "Search A".
    const label = (mode: DifficultyMode | undefined, loot: number): string => {
      const { state, graph } = startRun(mkOpts(mode), REGIONS, NODES) as { state: GameState; graph: RegionGraph };
      const thin: GameState = { ...state,
        nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot } } };
      return availableActions(thin, graph).find((c) => c.id === "search")?.label ?? "";
    };
    const STRIPPED = "stripped";
    expect(label("survivor", 4)).not.toContain(STRIPPED); // Survivor can still pay here...
    expect(label("nightmare", 4)).toContain(STRIPPED);    // ...Nightmare provably cannot, and says so.
    expect(label("hardcore", 4)).toContain(STRIPPED);
    // A district with real stock is never mislabelled in any mode — the test is on the best case (the
    // cap), so an unlucky draw that pays nothing is not advertised as a stripped node.
    for (const m of [undefined, "story", "survivor", "hardcore", "nightmare"] as const) {
      expect(label(m, 90)).not.toContain(STRIPPED);
    }
  });

  it("the two CONSEQUENCE dials bite, and a mode that sets them cannot quietly stop reading them (T60 · PL-M4-57 / PL-M5-45)", () => {
    // Before T60 every dial in the set was scarcity, needs or pacing: "harsher consequences" was a
    // thing the mode descriptions promised and no dial delivered. A mutation sweep found both new dials
    // unpinned on their first cut — the profile magnitudes could be flattened to identity and the whole
    // suite stayed green — so this asserts the WIRING, not the magnitude (PL-M4-53: magnitudes are
    // provisional until the M5 passes settle them; the fact that a mode reads them is not).
    const REST = 10; // hours with an untreated bite open
    const feverAfter = (mode: DifficultyMode | undefined): number => {
      const { state, graph } = startRun(mkOpts(mode), REGIONS, NODES) as { state: GameState; graph: RegionGraph };
      let s: GameState = { ...state, player: { ...state.player, condition: { ...state.player.condition,
        wounds: [{ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: state.meta.day }] } } };
      for (let i = 0; i < REST; i++) {
        const rest = availableActions(s, graph).find((c) => c.id === "rest");
        if (!rest) break;
        s = applyAction(s, rest.action, graph).state;
      }
      return s.player.condition.infection.progression;
    };
    // The fever runs strictly faster in each harder mode, and strictly slower on Story.
    const story = feverAfter("story"), surv = feverAfter("survivor"), hard = feverAfter("hardcore"), night = feverAfter("nightmare");
    expect(feverAfter(undefined)).toBe(surv); // unset == survivor: the identity
    expect(story).toBeGreaterThan(0);         // ...but never ZERO — a gentler mode is not a cure
    expect(story).toBeLessThan(surv);
    expect(surv).toBeLessThan(hard);
    expect(hard).toBeLessThan(night);

    // The Last Stand threshold, PL-M5-45's headline: a flat 80 on Story and Ironman alike for four
    // consecutive tasks. It is ordered, it is never below 1, and `LAST_STAND_AT` is the Survivor value.
    const at = (mode: DifficultyMode | undefined): number =>
      lastStandAt(startRun(mkOpts(mode), REGIONS, NODES).state as GameState);
    expect(at("survivor")).toBe(LAST_STAND_AT);
    expect(at(undefined)).toBe(LAST_STAND_AT);
    expect(at("story")).toBeGreaterThan(at("survivor"));
    expect(at("hardcore")).toBeLessThan(at("survivor"));
    expect(at("nightmare")).toBeLessThan(at("hardcore"));
    for (const m of [undefined, "story", "survivor", "hardcore", "nightmare"] as const) expect(at(m)).toBeGreaterThanOrEqual(1);

    // ...and `inLastStand` reads the SCALED threshold, not the constant. A burden between Nightmare's
    // threshold and Survivor's is the whole difference the dial buys.
    const grabbedAt = (mode: DifficultyMode | undefined, burden: number): boolean => {
      const { state } = startRun(mkOpts(mode), REGIONS, NODES) as { state: GameState };
      const s: GameState = { ...state,
        combat: { ...(state.combat ?? {}), grabbed: true } as GameState["combat"],
        player: { ...state.player, condition: { ...state.player.condition,
          wounds: [{ type: "wound.laceration", site: "arm", severity: burden, treated: 0, inflictedDay: state.meta.day }] } } };
      return inLastStand(s);
    };
    const between = Math.trunc((at("nightmare") + at("survivor")) / 2);
    expect(grabbedAt("nightmare", between)).toBe(true);
    expect(grabbedAt("survivor", between)).toBe(false);
  });

  it("the director escalates a coasting run harder in harder modes — Story 0 < Survivor < Hardcore < Nightmare (pacing dial · DES-2 regression)", () => {
    // A calm, undistressed run that has been QUIET ⇒ every director tick is an "escalate" beat. The
    // escalate step is an INTEGER dial, so Hardcore/Nightmare must nudge strictly more than Survivor
    // (the (1,2)-trunc bug). T60 moved the trigger from "pressure is low" to "the player is coasting",
    // which a turn-0 fixture is not — hence the stamped `turn`. The dial under test is unchanged.
    const density0 = startRun(mkOpts(), REGIONS, NODES).state.regions["region.x"]!.zombieDensity;
    const escalated = (mode: DifficultyMode | undefined): number => {
      const fresh = startRun(mkOpts(mode), REGIONS, NODES).state as GameState;
      let s: GameState = { ...fresh, meta: { ...fresh.meta, turn: DIRECTOR_COASTING_TURNS } };
      for (let i = 0; i < 10; i++) s = tickDirector(s, 1);
      return s.regions["region.x"]!.zombieDensity;
    };
    const surv = escalated("survivor");
    expect(escalated(undefined)).toBe(surv); // unset == survivor on the director path
    expect(escalated("story")).toBe(density0); // Story's director never escalates (step 0) — gentle mode
    expect(surv).toBeGreaterThan(density0); // Survivor escalates a coasting run (+1/tick)
    expect(escalated("hardcore")).toBeGreaterThan(surv); // Hardcore pushes harder (was byte-identical pre-fix)
    expect(escalated("nightmare")).toBeGreaterThan(escalated("hardcore"));
  });

  it("every mode is internally deterministic (same seed+mode ⇒ identical run)", () => {
    for (const m of DIFFICULTY_MODES) {
      expect(saveGame(runScript(m.mode))).toBe(saveGame(runScript(m.mode)));
    }
  });
});
