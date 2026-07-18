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
function searchOnceAtLoot(difficulty: DifficultyMode | undefined, loot: number): number {
  const { state } = startRun(mkOpts(difficulty), REGIONS, NODES) as { state: GameState; graph: RegionGraph };
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

  it("a thin search comes up empty in Nightmare but pays out in Survivor (scarcity find-rate dial)", () => {
    // At region loot 8 the raw yield cap is 1: Survivor (lootYield 1) yields an item; Nightmare (0.6)
    // scales it to 0 → empty. Proves the find-gate direction, and that Survivor's guard is byte-identical.
    expect(searchOnceAtLoot("survivor", 8)).toBe(1);
    expect(searchOnceAtLoot(undefined, 8)).toBe(1);
    expect(searchOnceAtLoot("nightmare", 8)).toBe(0);
  });

  it("the director escalates a coasting run harder in harder modes — Story 0 < Survivor < Hardcore < Nightmare (pacing dial · DES-2 regression)", () => {
    // A fresh run is calm + undistressed ⇒ every director tick is an "escalate" beat. The escalate step is
    // an INTEGER dial, so Hardcore/Nightmare must nudge strictly more than Survivor (the (1,2)-trunc bug).
    const density0 = startRun(mkOpts(), REGIONS, NODES).state.regions["region.x"]!.zombieDensity;
    const escalated = (mode: DifficultyMode | undefined): number => {
      let s = startRun(mkOpts(mode), REGIONS, NODES).state as GameState;
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
