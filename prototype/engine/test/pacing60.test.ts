import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  samplePacing,
  summarizePacing,
  ambientWeights,
  chooseEncounter,
  evaluateEvents,
  DEFAULT_TONE,
  directorBeat,
  threatening,
  turnsSinceThreat,
  coasting,
  tideLean,
  tonesAuthored,
  DIRECTOR_THREAT_BEATS,
  DIRECTOR_COASTING_TURNS,
  DIRECTOR_LEAN_HIGH,
  DIRECTOR_HIGH_BAND,
  DIRECTOR_TONE_LEAN,
  DIRECTOR_RELIEF_PER_DAY,
  crested,
  directorIntent,
  pressureRead,
  PHASE_THREAT_TARGET,
  type DifficultyMode,
  type DirectorBeat,
  type EncounterDef,
  type EncounterTone,
  type GameState,
  type HistoryEvent,
  type NodeDef,
  type PacingSample,
  type RegionDef,
  type RegionState,
  type RegionGraph,
} from "../src/index.js";

/**
 * **T60 — the Apocalypse Director, measured and rewired** (GDD Part IV · PRD §4 · FR-SIM-10).
 *
 * T30 built a controller, T78 fixed its substrate, and T60 was the first task to ask what it was
 * WORTH. On the pre-T60 tree the answer was 0.1 turns: over 120 played runs across five bot policies,
 * turning the whole director off moved a run from 50.0 to 49.9. (That pair is a reading of a tree that
 * no longer exists; `measure/t60.ts --onoff` prints today's, 51.5 on against 51.8 off, and what moved
 * is the shape — see `--lean`.) This file pins the three things that changed as a result,
 * and — as much as it pins the fixes — it pins the two mistakes, because both are the kind that come
 * back:
 *
 * 1. **The controller read one input of the five GDD IV names.** `turnsSinceThreat` reads the second
 *    ("time since the last real threat"), and it only works with an explicit beat set — see
 *    `DIRECTOR_THREAT_BEATS`, whose membership this file asserts from both sides.
 * 2. **Its sensor and its actuator were the same wire.** `encounter.begin` says "something happened to
 *    you" AND carries the escalate beat, so the loop blinded itself the instant it acted: escalate
 *    reached the weighted ambient pick **6 times in 120 runs** on that wiring. `threatening` is the
 *    correction; after it, the escalate beat is 23.8% of turns.
 * 3. **Its output could not reach the player.** Its whole authority was ±1 a tick on two dials of one
 *    district, which `driftRegions` pulls straight back. The beat now leans the encounter pool, which
 *    fires 12.5 times a run — gated on the content authoring a tone, so a tone-less pool is untouched.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { threat: 20, loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a plaza", adjacent: ["node.x.b"], start: true, kind: "generic" },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "a store", adjacent: ["node.x.a"], kind: "store" },
];
const opts = { seed: "t60-seed", createdAt: "2026-09-15T00:00:00Z" };
const run = (pool: EncounterDef[] = []): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], pool);

const toned = (id: string, tone: EncounterTone | undefined, tag: string): EncounterDef => ({
  id, category: "exploration", title: id, premise: id, repeatable: true, cooldownHours: 0, tags: [tag],
  ...(tone === undefined ? {} : { tone }),
  requirements: { nodeIds: ["node.x.a"] },
  stages: [{ id: "s", narration: "a beat", choices: [{ id: "ok", label: "ok", timeCost: 1, effects: [{ kind: "logHistory", event: "encounter.note" }] }] }],
});
const atA = (s: GameState): GameState => ({ ...s, player: { ...s.player, location: "node.x.a" }, nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, walkers: 0 } } });
const quiet = (s: GameState): GameState => ({ ...s, meta: { ...s.meta, turn: DIRECTOR_COASTING_TURNS } });
const disable = (s: GameState): GameState => ({ ...s, world: { ...s.world, flags: { ...s.world.flags, "director.disabled": true } } });
const beat = (type: string, turn: number, data: unknown = {}): HistoryEvent =>
  ({ day: 1, hour: 0, turn, type, subjects: [], data: data as HistoryEvent["data"] });

/** A short played run (rest/act until the run ends), sampling pacing each turn. */
function playedRun(start: GameState, graph: RegionGraph, turns: number): PacingSample[] {
  const samples: PacingSample[] = [samplePacing(start)];
  let s = start;
  for (let i = 0; i < turns; i++) {
    const ch = availableActions(s, graph);
    if (ch.length === 0) break;
    s = applyAction(s, ch[i % ch.length]!.action, graph).state;
    samples.push(samplePacing(s));
  }
  return samples;
}

// --- GDD IV's second input: time since the last real threat ----------------------------------

describe("the threat beat set is explicit, and explicit from BOTH sides (T60)", () => {
  it("names beats that are about the SURVIVOR, and excludes the four the log is actually full of", () => {
    // The log is mostly not about the player: measured over 6,301 turns, a run writes ~127 beats and
    // 60.3 of them are `horde.move` — off-screen masses stepping between nodes, 47% of the whole log.
    // A "did anything get written this turn" rule reads the map moving as the player being threatened,
    // and the streak is then 0 on 100% of turns: the signal is dead and looks alive.
    for (const t of ["horde.move", "npc.died", "route.change", "weather.change"]) {
      expect(DIRECTOR_THREAT_BEATS.has(t)).toBe(false);
    }
    for (const t of ["combat.cleared", "horde.overrun", "encounter.begin", "infection.staged"]) {
      expect(DIRECTOR_THREAT_BEATS.has(t)).toBe(true);
    }
  });

  it("a non-member never moves the clock, however many of them there are", () => {
    const { state } = run();
    const noise = Array.from({ length: 40 }, (_, i) => beat("horde.move", i));
    const s = { ...state, meta: { ...state.meta, turn: 40 }, history: noise };
    expect(turnsSinceThreat(s)).toBe(40); // the whole run: nothing has happened TO THEM
    expect(coasting(s)).toBe(true);
  });
});

describe("the sensor and the actuator are no longer the same wire (T60)", () => {
  it("a TENSION scene is a threat and resets the clock; a relief or neutral one does not", () => {
    // The defect this pins: `encounter.begin` both reports "something happened" and carries the
    // escalate beat. Wired naively, firing a scene blinds the controller — measured, escalate reached
    // the weighted pick 6 times in 120 runs against 8.8% of turns spent in the beat.
    const { state } = run();
    const at = (tone: string | undefined): number => {
      const data = tone === undefined ? { encounter: "e" } : { encounter: "e", tone };
      return turnsSinceThreat({ ...state, meta: { ...state.meta, turn: 9 }, history: [beat("encounter.begin", 4, data)] });
    };
    expect(at("tension")).toBe(5);   // a threat: five turns ago
    expect(at("relief")).toBe(9);    // not a threat: the clock never started
    expect(at("neutral")).toBe(9);
    // A pool that authors no tone, and every pre-T60 save, keeps the reading it has always had.
    expect(at(undefined)).toBe(5);
  });

  it("`threatening` is total about junk in the payload — a garbage tone is not an excuse", () => {
    // `data` comes off a save and can be anything. Anything that is not the string "tension" and not
    // absent must fail CLOSED (i.e. still count as a threat), because the failure that matters is a
    // hand-edited save talking the director into escalating forever.
    for (const junk of [null, 42, "TENSION", "", { tone: "tension" }, [], true]) {
      expect(threatening(beat("encounter.begin", 1, { encounter: "e", tone: junk }))).toBe(true);
    }
    expect(threatening(beat("encounter.begin", 1, null))).toBe(true);
    expect(threatening(beat("encounter.begin", 1, { encounter: "e", tone: "tension" }))).toBe(true);
    expect(threatening(beat("encounter.begin", 1, { encounter: "e", tone: "relief" }))).toBe(false);
    // Non-membership still wins over everything.
    expect(threatening(beat("horde.move", 1, { tone: "tension" }))).toBe(false);
  });

  it("a corrupt clock reads as NOT coasting, so no save can buy a permanent escalate", () => {
    const { state } = run();
    for (const turn of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(turnsSinceThreat({ ...state, meta: { ...state.meta, turn } })).toBe(0);
    }
    // ...and the same for a non-finite stamp on the beat itself.
    const s = { ...state, meta: { ...state.meta, turn: 20 }, history: [beat("combat.cleared", NaN)] };
    expect(turnsSinceThreat(s)).toBe(0);
    expect(coasting(s)).toBe(false);
  });

  it("a FINITE but absurd clock cannot buy a permanent escalate either (the guard `isFinite` was not)", () => {
    // A mutation sweep found the first cut's `Number.isFinite` guard survivable, and an audit had
    // already shown why: `loadGame` does not validate `meta.turn`, so a hand-edited `"turn": 1e308` is
    // a perfectly finite number that makes every tick coasting for the rest of the run and pins
    // `directorBias` at its cap — the "escalate forever" the guard's own comment called impossible.
    const { state } = run();
    const huge = { ...state, meta: { ...state.meta, turn: 1e308 } };
    expect(Number.isFinite(huge.meta.turn)).toBe(true); // the old guard would have let this through
    expect(turnsSinceThreat(huge)).toBe(0);
    expect(coasting(huge)).toBe(false);
    // ...and two finite stamps whose DIFFERENCE is not finite.
    const split = { ...state, meta: { ...state.meta, turn: 1e308 }, history: [beat("combat.cleared", -1e308)] };
    expect(Number.isFinite(turnsSinceThreat(split))).toBe(true);
    expect(turnsSinceThreat(split)).toBe(0);
    // A legitimately long quiet streak is still reported, so the clamp is not a blanket zero.
    const real = { ...state, meta: { ...state.meta, turn: 40 }, history: [beat("combat.cleared", 5)] };
    expect(turnsSinceThreat(real)).toBe(35);
  });

  it("the coasting threshold is the literal, and it is load-bearing", () => {
    expect(DIRECTOR_COASTING_TURNS).toBe(3);
    const { state } = run();
    const after = (turn: number): boolean => coasting({ ...state, meta: { ...state.meta, turn }, history: [beat("combat.cleared", 0)] });
    expect(after(DIRECTOR_COASTING_TURNS - 1)).toBe(false);
    expect(after(DIRECTOR_COASTING_TURNS)).toBe(true);
  });
});

// --- the tide's lean: the reachable half of a band nothing could reach ------------------------

describe("tideLean reads the tide against its own phase target (T60)", () => {
  it("is signed, relative to the phase, and 0 on junk", () => {
    const { state } = run();
    const target = PHASE_THREAT_TARGET[state.meta.phase]!;
    expect(tideLean({ ...state, world: { ...state.world, globalThreat: target } })).toBe(0);
    expect(tideLean({ ...state, world: { ...state.world, globalThreat: target + 12 } })).toBe(12);
    expect(tideLean({ ...state, world: { ...state.world, globalThreat: target - 12 } })).toBe(-12);
    for (const junk of [NaN, Infinity, undefined as unknown as number]) {
      expect(tideLean({ ...state, world: { ...state.world, globalThreat: junk } })).toBe(0);
    }
  });

  it("a PROTOTYPE key for the phase reads as no lean, not as NaN", () => {
    // `PHASE_THREAT_TARGET` is a plain object literal, so `PHASE_THREAT_TARGET["constructor"]` is a
    // truthy inherited member that sails past a `=== undefined` fallback and makes the subtraction NaN
    // — which then reaches `PacingSample.tideLean` and both summary fields. `sim/difficulty.ts` fixed
    // exactly this bug for `profileOf` and wrote the reason down; the first cut of `tideLean`
    // reintroduced it four files away, and only `loadGame`'s phase whitelist was in the way.
    const { state } = run();
    for (const junk of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty", "", "NIGHT"]) {
      const s = { ...state, meta: { ...state.meta, phase: junk as never } };
      expect(tideLean(s)).toBe(0);
      const sample = samplePacing(s);
      expect(Number.isNaN(sample.tideLean)).toBe(false);
      expect(Number.isNaN(summarizePacing([sample]).meanTideLean)).toBe(false);
    }
  });

  it("a POLLUTED prototype cannot smuggle a phase target either", () => {
    // The sharper form of the test above, and the one that makes `hasOwnProperty` load-bearing rather
    // than redundant: a `Number.isFinite(target)` check alone catches today's prototype members only
    // because they all happen to be functions. Give the prototype a numeric key and the bare index
    // returns a NUMBER for a phase the game does not have.
    const { state } = run();
    const KEY = "poisonPhase";
    Object.defineProperty(Object.prototype, KEY, { value: 99, configurable: true, enumerable: false });
    try {
      const s = { ...state, meta: { ...state.meta, phase: KEY as never } };
      expect((PHASE_THREAT_TARGET as Record<string, number>)[KEY]).toBe(99); // the bare index WOULD see it
      expect(tideLean(s)).toBe(0);                                           // ...and this does not
    } finally {
      delete (Object.prototype as Record<string, unknown>)[KEY];
    }
  });

  it("a tide well ahead of schedule buys relief WITHOUT the absolute high band being reachable", () => {
    // This is the half of the old controller that measurement showed was dead: peak pressure lands at
    // 41.6–50.4 by policy against a high band of 70, so `pressureRead >= DIRECTOR_HIGH_BAND` fires on
    // 0.0% of turns.
    const { state } = run();
    const target = PHASE_THREAT_TARGET[state.meta.phase]!;
    const ahead = quiet({ ...state, world: { ...state.world, globalThreat: target + DIRECTOR_LEAN_HIGH } });
    expect(tideLean(ahead)).toBeGreaterThanOrEqual(DIRECTOR_LEAN_HIGH);
    expect(directorBeat(ahead)).toBe("relief");
    // One point short of the lean, the same coasting state escalates instead — the literal is load-bearing.
    const short = quiet({ ...state, world: { ...state.world, globalThreat: target + DIRECTOR_LEAN_HIGH - 1 } });
    expect(directorBeat(short)).toBe("escalate");
  });

  it("relief stays rationed: past the day's ration a leaning tide gets hold, never a free beat", () => {
    const { state } = run();
    const target = PHASE_THREAT_TARGET[state.meta.phase]!;
    const ahead = { ...state, world: { ...state.world, globalThreat: target + DIRECTOR_LEAN_HIGH } };
    const spent = { ...ahead, world: { ...ahead.world, directorReliefDay: ahead.meta.day, directorReliefBeats: DIRECTOR_RELIEF_PER_DAY } };
    expect(directorBeat(ahead)).toBe("relief");
    expect(directorBeat(spent)).toBe("hold");
  });

  it("a crested district is never escalated into, and the clamp asks the DISTRICT, not the blend", () => {
    // The first cut of this test set `globalThreat: 100` as well, which made the relief branch fire and
    // proved nothing about the clamp — an audit deleted the clamp entirely and the whole suite stayed
    // green, then showed the clamp was the wrong quantity anyway: `pressureRead` is
    // `(globalThreat + regionThreat) / 2`, so a maxed district under a COLD tide reads 50 and was
    // escalated ten times running, its `directorBias` driven to the +10 cap.
    const { state } = run();
    const maxed = (o: Partial<RegionState>): GameState => quiet({
      ...state,
      regions: { "region.x": { ...state.regions["region.x"]!, ...o } },
      world: { ...state.world, globalThreat: 0 }, // a COLD tide: the blend cannot be what refuses
    });
    const hot = maxed({ threat: 100, zombieDensity: 100 });
    expect(coasting(hot)).toBe(true);
    expect(pressureRead(hot)).toBeLessThan(DIRECTOR_HIGH_BAND); // the blend would have allowed it
    expect(crested(hot)).toBe(true);
    expect(directorBeat(hot)).toBe("hold");
    // Either dial at the ceiling is enough — the nudge moves both, so either one blocks it.
    expect(directorBeat(maxed({ threat: 100, zombieDensity: 10 }))).toBe("hold");
    expect(directorBeat(maxed({ threat: 10, zombieDensity: 100 }))).toBe("hold");
    // ...and one point under, the same state escalates. The comparison is load-bearing.
    expect(directorBeat(maxed({ threat: 99, zombieDensity: 99 }))).toBe("escalate");
    // Total: a district the director cannot read is crested, i.e. it declines rather than guesses.
    expect(crested({ ...hot, regions: {} })).toBe(true);
    expect(crested(maxed({ threat: NaN, zombieDensity: 0 }))).toBe(true);
  });

  it("the relief RATION governs the nudge, not the tone lean — the two used to disagree across stages", () => {
    // `tickDirector` runs at pipeline stage 11 and SPENDS the ration; the encounter pool reads the beat
    // at stage 13, by which point `reliefSpent` is one higher. An audit measured `directorBeat`
    // reporting `hold` to the pool on 39.9% of turns for that reason — on the day's last rationed
    // relief the nudge landed and the pool was handed the identity lean.
    const { state } = run();
    const target = PHASE_THREAT_TARGET[state.meta.phase]!;
    const ahead = { ...state, world: { ...state.world, globalThreat: target + DIRECTOR_LEAN_HIGH } };
    const spent = { ...ahead, world: { ...ahead.world, directorReliefDay: ahead.meta.day, directorReliefBeats: DIRECTOR_RELIEF_PER_DAY } };
    expect(directorIntent(spent)).toBe("relief"); // what the director wants, unchanged by bookkeeping
    expect(directorBeat(spent)).toBe("hold");     // what the nudge takes, correctly rationed
    // The two agree whenever the ration is not the thing in the way.
    expect(directorIntent(ahead)).toBe(directorBeat(ahead));
  });
});

// --- the beat reaches the player: the encounter-tone lean -------------------------------------

describe("the director leans the ambient pool it can actually be felt through (T60 · GDD IV 'biases, never forces')", () => {
  it("the lean table is identity on hold, and mirror-symmetric between escalate and relief", () => {
    for (const tone of ["tension", "relief", "neutral"] as const) expect(DIRECTOR_TONE_LEAN.hold[tone]).toBe(100);
    for (const b of ["escalate", "relief"] as const) expect(DIRECTOR_TONE_LEAN[b].neutral).toBe(100);
    expect(DIRECTOR_TONE_LEAN.escalate.tension).toBe(DIRECTOR_TONE_LEAN.relief.relief);
    expect(DIRECTOR_TONE_LEAN.escalate.relief).toBe(DIRECTOR_TONE_LEAN.relief.tension);
    expect(DIRECTOR_TONE_LEAN.escalate.tension).toBeGreaterThan(100);
    expect(DIRECTOR_TONE_LEAN.escalate.relief).toBeLessThan(100);
  });

  it("the beat a scene is logged with is the tone the WEIGHTING used — the sensor and the actuator agree", () => {
    // `weightOf` reads a missing tone as `neutral`. If the beat is stamped with `def.tone` rather than
    // the RESOLVED tone, an untoned scene is `neutral` to the actuator and — because `threatening`
    // fails closed on an absent tone — a THREAT to the sensor: the same scene, two opposite readings,
    // decided by whether an author typed the field. An audit found it live for the one-shot tier, which
    // authors no tone at all and was 23% of every scene that fired.
    const pool = [
      toned("encounter.t.untoned", undefined, "p"),
      toned("encounter.t.kind", "relief", "q"),
    ];
    const { state, graph } = run(pool);
    expect(tonesAuthored(graph)).toBe(true); // one toned row is enough to open the gate
    const rows = ambientWeights(atA(quiet(state)), graph);
    const weighted = rows.find((r) => r.id === "encounter.t.untoned")!;
    expect(weighted.tone).toBe(DEFAULT_TONE); // what the weighting called it...
    expect(DEFAULT_TONE).toBe("neutral");     // the literal: an unstated tone is calm, not a crisis

    // ...and what the ENGINE writes to the log must be the same string. Read off a real firing, not
    // hand-built: a first cut constructed the beat itself and a mutation sweep walked past the mutant
    // that drops the `?? DEFAULT_TONE` from the payload, because the test never asked the engine.
    const fired = evaluateEvents(atA(quiet(state)), graph);
    const begun = fired.history.filter((h) => h.type === "encounter.begin");
    expect(begun.length).toBe(1);
    const logged = begun[0]!;
    const tone = (logged.data as { tone?: unknown }).tone;
    expect(typeof tone).toBe("string");                          // stamped, not omitted...
    const id = String((logged.data as { encounter?: unknown }).encounter);
    expect(tone).toBe(rows.find((r) => r.id === id)!.tone);       // ...and equal to what weighted it.
    // The consequence that matters: an untoned scene no longer reads as a threat to the sensor while
    // reading as neutral to the actuator.
    if (id === "encounter.t.untoned") expect(threatening(logged)).toBe(false);
  });

  it("a pool that authors NO tone is untouched — the active-system gate, proved by identical draws", () => {
    // The byte-identity discipline applied to a content FIELD (T83's `safehousesAuthored` precedent):
    // an unaware content set must draw exactly as it did before this task existed.
    const pool = [toned("encounter.t.a", undefined, "p"), toned("encounter.t.b", undefined, "q"), toned("encounter.t.c", undefined, "r")];
    const { state, graph } = run(pool);
    expect(tonesAuthored(graph)).toBe(false);
    const calm = atA(quiet(state));
    const hot = atA(quiet({ ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 95, thirst: 95, fatigue: 95 } } } }));
    expect(directorBeat(calm)).toBe("escalate");
    expect(directorBeat(hot)).toBe("relief");
    // Opposite beats, identical pick AND identical stream position: the director is gated out of a
    // pool that says nothing about tone. `chooseEncounter` is the path that draws — `selectEncounter`
    // resolves by fit and never consults the director at all, which is how a first draft of this file
    // came to assert the lean against a function the lean does not touch.
    const a = chooseEncounter(calm, graph);
    const b = chooseEncounter(hot, graph);
    expect(a.def?.id).toBe(b.def?.id);
    expect(a.rng).toEqual(b.rng);
  });

  it("with tones authored, opposite beats lean the same pool in opposite directions", () => {
    // Over SEEDS, not on one draw. The pick is weighted-random by construction (that is what "biases,
    // never forces" means), so a single seed says nothing about the lean — a first draft of this test
    // asserted one pick and failed on a seed that drew against the bias, which is the pool working.
    const pool = [toned("encounter.t.tense", "tension", "p"), toned("encounter.t.kind", "relief", "q")];
    const tenseShare = (hurt: boolean): number => {
      let tense = 0;
      for (let i = 0; i < 60; i++) {
        const { state, graph } = startRun({ ...opts, seed: `lean-${i}` }, REGIONS, NODES, [], [], pool);
        expect(tonesAuthored(graph)).toBe(true);
        const s = atA(quiet(hurt
          ? { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 95, thirst: 95, fatigue: 95 } } } }
          : state));
        expect(directorBeat(s)).toBe(hurt ? "relief" : "escalate");
        if (chooseEncounter(s, graph).def?.id === "encounter.t.tense") tense += 1;
      }
      return tense;
    };
    const escalating = tenseShare(false);
    const relieving = tenseShare(true);
    // Same pool, same sixty seeds, opposite beats: the tense scene must come up strictly more often
    // when the director wants the run tightened than when it wants the player let off.
    expect(escalating).toBeGreaterThan(relieving);
  });

  it("biases, never forces: the disfavoured row keeps a REAL weight at the harshest dial setting", () => {
    // GDD IV's own word, and the assertion has to be on the weight, not on a draw. A first cut of this
    // test looked for one seed in forty on which the escalate beat picked the relief row — and an audit
    // showed it passed with the lean deleted entirely AND with both weight floors deleted, at which
    // point Nightmare's relief row carried a weight of MINUS 2525 and was drawn 0 times in 40 seeds.
    // The test was named for the one property it could not see.
    //
    // So: the worst case the engine can construct. Nightmare (the largest `directorAggression`), an
    // escalate beat, and a relief row that the recency terms are already suppressing to the floor —
    // `weight: 1`, with its id and its tag both just fired, so `idScore` and `tagScore` are 0 and the
    // pre-lean weight is exactly 1. If a lean can take a row below 1, it happens here.
    // (i) THE FLOOR. `weight: 1` with the id and the tag both just fired ⇒ `idScore` and `tagScore` are
    // 0 ⇒ the pre-lean weight is exactly 1, so a down-lean that could go below 1 has nowhere to hide.
    const kind: EncounterDef = { ...toned("encounter.t.kind", "relief", "shared"), weight: 1, cooldownHours: 0 };
    const tense: EncounterDef = { ...toned("encounter.t.tense", "tension", "other"), weight: 1 };
    const { state, graph } = startRun({ ...opts, difficulty: "nightmare" }, REGIONS, NODES, [], [], [kind, tense]);
    const justFired = atA(quiet({
      ...state,
      history: [...state.history, { ...beat("encounter.begin", 0, { encounter: kind.id, tone: "relief" }), day: state.meta.day, hour: state.meta.hour, subjects: [kind.id] }],
    }));
    expect(directorBeat(justFired)).toBe("escalate");
    const floored = ambientWeights(justFired, graph).find((r) => r.id === kind.id)!;
    expect(floored.weight).toBe(1); // exactly the floor: never 0, never negative, never removed
    expect(Number.isInteger(floored.weight)).toBe(true);

    // (ii) THE LEAN'S OWN STRENGTH, isolated. Two rows identical in everything the recency terms read —
    // same base weight, neither fired, different tags — so the ratio between them IS the lean and
    // nothing else. "Biases, never forces" is a claim about how far that ratio may go.
    const a: EncounterDef = { ...toned("encounter.t.a", "relief", "ta"), weight: 100 };
    const b: EncounterDef = { ...toned("encounter.t.b", "tension", "tb"), weight: 100 };
    const fresh = startRun({ ...opts, difficulty: "nightmare" }, REGIONS, NODES, [], [], [a, b]);
    const rows = ambientWeights(atA(quiet(fresh.state)), fresh.graph);
    const wa = rows.find((r) => r.id === a.id)!.weight;
    const wb = rows.find((r) => r.id === b.id)!.weight;
    expect(wb).toBeGreaterThan(wa);            // the director is leaning...
    expect(wa * 50).toBeGreaterThan(wb);       // ...but better than 50:1, so the row is still reachable.
  });

  it("the aggression dial does not saturate: Nightmare leans harder than Hardcore, on BOTH sides", () => {
    // The mirror of the test above, and the defect it was written for: the first cut scaled the lean's
    // linear distance from 100 and clamped at 1, so `100 + trunc(-50 * aggression)` hit 0 for every
    // aggression >= 2 — Hardcore and Nightmare were bit-identical on the suppression side (relief
    // weight 43 in both, measured on shipped content) while the amplification side kept growing.
    const pool = [toned("encounter.t.tense", "tension", "p"), toned("encounter.t.kind", "relief", "q")];
    const at = (mode: DifficultyMode): { tense: number; kind: number } => {
      const { state, graph } = startRun({ ...opts, difficulty: mode }, REGIONS, NODES, [], [], pool);
      const rows = ambientWeights(atA(quiet(state)), graph);
      return { tense: rows.find((r) => r.id === "encounter.t.tense")!.weight, kind: rows.find((r) => r.id === "encounter.t.kind")!.weight };
    };
    const hard = at("hardcore");
    const night = at("nightmare");
    expect(night.tense).toBeGreaterThan(hard.tense); // the up-lean grows...
    expect(night.kind).toBeLessThan(hard.kind);      // ...and so does the down-lean. Neither saturates.
  });

  it("the aggression dial is the ESCALATE dial: it never touches the relief beat, and Story never escalates through it", () => {
    // Three documented invariants a first cut broke at once — `difficulty.ts` calls this "a multiplier
    // on the Director's escalate nudge", `director.ts`'s `nudge` says relief "is deliberately
    // unscaled … it does not yank away the comeback rope", and `director.ts` says Story's director
    // never escalates. Passing `aggression` on every beat made all three false in the same task.
    const pool = [toned("encounter.t.tense", "tension", "p"), toned("encounter.t.kind", "relief", "q")];
    const rowsAt = (mode: DifficultyMode | undefined, hurt: boolean): Record<string, number> => {
      const base = mode === undefined ? opts : { ...opts, difficulty: mode };
      const { state, graph } = startRun(base, REGIONS, NODES, [], [], pool);
      const s = atA(quiet(hurt
        ? { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 95, thirst: 95, fatigue: 95 } } } }
        : state));
      expect(directorBeat(s)).toBe(hurt ? "relief" : "escalate");
      return Object.fromEntries(ambientWeights(s, graph).map((r) => [r.id, r.weight]));
    };
    // The RELIEF beat is identical in every mode — the comeback rope is not difficulty-scaled.
    const relief = (["story", "survivor", "hardcore", "nightmare"] as const).map((m) => rowsAt(m, true));
    for (const r of relief.slice(1)) expect(r).toEqual(relief[0]);
    // Story's escalate beat leans no harder than Survivor's — `scaleInt(100, 0.5)` must not become a
    // +50% tension lean on the mode whose director is documented as never escalating at all.
    const storyEsc = rowsAt("story", false);
    const survEsc = rowsAt("survivor", false);
    expect(storyEsc["encounter.t.tense"]).toBeLessThanOrEqual(survEsc["encounter.t.tense"]!);
  });
});

describe("`ambientWeights` — the seam that makes the lean measurable at all (T60)", () => {
  it("returns the table the draw uses: same rows, same order, weights that respond to the beat", () => {
    const pool = [toned("encounter.t.tense", "tension", "p"), toned("encounter.t.kind", "relief", "q"), toned("encounter.t.plain", "neutral", "r")];
    const { state, graph } = run(pool);
    const calm = atA(quiet(state));
    const hot = atA(quiet({ ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 95, thirst: 95, fatigue: 95 } } } }));
    expect(directorBeat(calm)).toBe("escalate");
    expect(directorBeat(hot)).toBe("relief");
    const e = ambientWeights(calm, graph);
    const r = ambientWeights(hot, graph);
    expect(e.map((w) => w.id)).toEqual(["encounter.t.kind", "encounter.t.plain", "encounter.t.tense"]); // id order, seed-independent
    expect(e.map((w) => w.id)).toEqual(r.map((w) => w.id));
    const w = (rows: readonly { id: string; weight: number }[], id: string): number => rows.find((x) => x.id === id)!.weight;
    // The tense row is heavier when the director wants the run tightened; the kind row when it does not.
    expect(w(e, "encounter.t.tense")).toBeGreaterThan(w(r, "encounter.t.tense"));
    expect(w(r, "encounter.t.kind")).toBeGreaterThan(w(e, "encounter.t.kind"));
    // The neutral row is the fixed point in both — the lean is a rotation, not a rescale.
    expect(w(e, "encounter.t.plain")).toBe(w(r, "encounter.t.plain"));
    // (The "never removes a row" floor is pinned by its own test below, against the harshest dial —
    // asserting `>= 1` on these shipped-size weights, which are in the thousands, proves nothing.)
  });

  it("reads nothing when no ambient table is consulted — a one-shot tier, or an empty pool", () => {
    // `selectEncounter`/`chooseEncounter` short-circuit before the weighted table in both cases, and a
    // telemetry seam that reported a table nobody drew from would be measuring a fiction.
    const { state, graph } = run();
    expect(ambientWeights(atA(state), graph)).toEqual([]);
    const oneShot: EncounterDef = {
      id: "encounter.t.scripted", category: "story", title: "s", premise: "s",
      requirements: { nodeIds: ["node.x.a"] },
      stages: [{ id: "s", narration: "n", choices: [{ id: "ok", label: "ok", timeCost: 1, effects: [] }] }],
    };
    const withBoth = run([oneShot, toned("encounter.t.kind", "relief", "q"), toned("encounter.t.tense", "tension", "p")]);
    expect(ambientWeights(atA(withBoth.state), withBoth.graph)).toEqual([]); // the one-shot tier wins, no draw
    // ...and the SINGLE-candidate case, which an audit found missing: `chooseEncounter` returns the one
    // row with no draw, so a table reported here is a table nothing drew from. It was 20.5% of
    // everything this function reported and it halved the apparent strength of the lean.
    const solo = run([toned("encounter.t.only", "tension", "p")]);
    const s = atA(quiet(solo.state));
    expect(chooseEncounter(s, solo.graph).def?.id).toBe("encounter.t.only");
    expect(chooseEncounter(s, solo.graph).rng).toBe(s.rng); // no draw happened
    expect(ambientWeights(s, solo.graph)).toEqual([]);
  });

  it("is pure: reading the table never touches the state or the stream", () => {
    const pool = [toned("encounter.t.tense", "tension", "p"), toned("encounter.t.kind", "relief", "q")];
    const { state, graph } = run(pool);
    const s = atA(quiet(state));
    const before = JSON.stringify(s);
    const a = ambientWeights(s, graph);
    const b = ambientWeights(s, graph);
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// --- the T30 Definition of Done, asserted on what the director actually does ------------------

describe("disabling the director changes pacing metrics — on the BEAT, not on a dead band (T30 DoD via T60)", () => {
  it("the beat census separates director-on from director-off; the absolute band cannot", () => {
    const { state, graph } = run();
    const on = summarizePacing(playedRun(state, graph, 60));
    const off = summarizePacing(playedRun(disable(state), graph, 60));
    expect(on.samples).toBe(off.samples);
    // Off: one beat, no switches, by construction — the strongest form this assertion can take.
    expect(off.holdTurns).toBe(off.samples);
    expect(off.escalateTurns + off.reliefTurns).toBe(0);
    expect(off.beatSwitches).toBe(0);
    // On: not that.
    expect(on.escalateTurns + on.reliefTurns).toBeGreaterThan(0);
    expect(on.beatSwitches).toBeGreaterThan(0);
    // And the metric this assertion USED to rest on is dead in both, which is why it moved. Recorded as
    // an equality rather than a comment so that if the simulation ever does produce high pressure, this
    // line fails and someone re-reads the header of `telemetry/pacing.ts`.
    expect(on.highPressureTurns).toBe(0);
    expect(off.highPressureTurns).toBe(0);
  });

  it("every sample's beat is one of the three, and the census adds up to the sample count", () => {
    const { state, graph } = run();
    const samples = playedRun(state, graph, 40);
    const sum = summarizePacing(samples);
    const beats: DirectorBeat[] = ["hold", "escalate", "relief"];
    for (const s of samples) expect(beats).toContain(s.beat);
    expect(sum.holdTurns + sum.escalateTurns + sum.reliefTurns).toBe(sum.samples);
    // RECOMPUTED independently, not bounded. `coastingTurns <= samples`, `longestQuietStreak >= 0` and
    // `beatSwitches < samples` are all true by construction: an audit hard-coded the first two to 0 and
    // the test stayed green, and the third is bounded by n−1 whatever the folder does.
    expect(sum.coastingTurns).toBe(samples.filter((x) => x.coasting).length);
    expect(sum.longestQuietStreak).toBe(Math.max(...samples.map((x) => x.quietTurns)));
    expect(sum.beatSwitches).toBe(samples.filter((x, i) => i > 0 && x.beat !== samples[i - 1]!.beat).length);
  });

  it("an empty sample list folds to zeros rather than to NaN or -Infinity", () => {
    const sum = summarizePacing([]);
    expect(sum.samples).toBe(0);
    expect(sum.holdTurns + sum.escalateTurns + sum.reliefTurns).toBe(0);
    expect(sum.beatSwitches).toBe(0);
    expect(sum.meanTideLean).toBe(0);
    expect(sum.peakTideLean).toBe(0);
    expect(sum.longestQuietStreak).toBe(0);
  });

  it("the signed tide lean averages toward zero rather than flooring", () => {
    // `meanInt` truncates, which for a SIGNED quantity is the correct rounding and for a floor would
    // not be: -1 and +1 average to 0, not to -1.
    const { state } = run();
    const target = PHASE_THREAT_TARGET[state.meta.phase]!;
    const at = (globalThreat: number): PacingSample => samplePacing({ ...state, world: { ...state.world, globalThreat } });
    // THREE samples, not two. A `[-1, +1]` fixture sums to exactly 0, where `trunc` and `floor` agree
    // — an audit swapped `meanInt`'s `Math.trunc` for `Math.floor` and the whole 1363-test suite stayed
    // green. `[-1, -1, +1]` means -1/3, which truncates to 0 and floors to -1.
    const sum = summarizePacing([at(target - 1), at(target - 1), at(target + 1)]);
    expect(sum.meanTideLean === 0).toBe(true); // `===`, because trunc of -1/3 is negative zero
    expect(sum.peakTideLean).toBe(1);
    // ...and the mirror, so a `ceil` is caught too: +1/3 must also be 0, not 1.
    expect(summarizePacing([at(target + 1), at(target + 1), at(target - 1)]).meanTideLean).toBe(0);
  });
});
