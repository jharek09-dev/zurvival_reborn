import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  advanceWorld,
  startRun,
  tickDirector,
  directorBeat,
  directorEnabled,
  playerDistressed,
  pressureRead,
  reliefSpent,
  woundAgeHours,
  woundBurden,
  inflictWound,
  DIRECTOR_HIGH_BAND,
  DIRECTOR_WOUND_DISTRESS,
  DIRECTOR_FRESH_WOUND_HOURS,
  DIRECTOR_RELIEF_PER_DAY,
  DIRECTOR_BIAS_MAX,
  DIRECTOR_BIAS_DECAY_HOURS,
  directorBias,
  decayBias,
  driftAnchor,
  driftRegions,
  DRIFT_JITTER,
  saveGame,
  loadGame,
  type GameState,
  type Wound,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
  type RegionState,
} from "../src/index.js";

const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 20, threat: 10, survivorActivity: 0, loot: 60 } },
];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "A", description: "a", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "B", description: "b", adjacent: ["node.x.a"] },
];
const opts = { seed: "director-seed", createdAt: "2026-07-05T00:00:00Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES);

const disable = (s: GameState): GameState => ({ ...s, world: { ...s.world, flags: { ...s.world.flags, "director.disabled": true } } });
const withThreat = (s: GameState, globalThreat: number): GameState => ({ ...s, world: { ...s.world, globalThreat } });
const density = (s: GameState): number => s.regions["region.x"]!.zombieDensity;
const region = (o: Partial<RegionState>): RegionState => ({
  threat: 0, zombieDensity: 0, loot: 0, survivorActivity: 0, power: 0, water: 0, fire: 0, roads: 100, storyFlags: {},
  ...o,
});
const wounded = (s: GameState, wounds: readonly Wound[]): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, wounds } },
});

describe("director beat from pressure + distress (T30 · FR-SIM-10)", () => {
  it("escalates a calm, undistressed run", () => {
    const { state } = run();
    expect(pressureRead(state)).toBeLessThan(25);
    expect(playerDistressed(state)).toBe(false);
    expect(directorBeat(state)).toBe("escalate");
  });

  it("gives relief when pressure is high", () => {
    const { state } = run();
    const hot = withThreat({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, threat: 90 } } }, 90);
    expect(pressureRead(hot)).toBeGreaterThanOrEqual(DIRECTOR_HIGH_BAND);
    expect(directorBeat(hot)).toBe("relief");
  });

  it("gives relief when the player is distressed even if pressure is low", () => {
    const { state } = run();
    // one untreated bite: exactly the DIRECTOR_WOUND_DISTRESS burden (T78 narrowed the clause to weight)
    const hurt = wounded(state, [{ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: 1 }]);
    expect(playerDistressed(hurt)).toBe(true);
    expect(directorBeat(hurt)).toBe("relief");
  });

  it("holds — and never touches state — when disabled", () => {
    const { state } = run();
    const off = disable(state);
    expect(directorEnabled(off)).toBe(false);
    expect(directorBeat(off)).toBe("hold");
    expect(tickDirector(off, 6)).toBe(off);
  });
});

describe("distress is weight or shock, not the existence of a scab (T78 · closes the design review's III.1)", () => {
  it("a wound dressed down below one bite's worth is NOT distress — the run is not relieved forever", () => {
    // Against the pre-T78 clause (`treated < 100`) this wound was distress for the rest of the run.
    const { state } = run();
    const scab = wounded(state, [{ type: "wound.laceration", site: "arm", severity: 30, treated: 20, inflictedDay: 1 }]);
    expect(woundBurden(scab.player.condition)).toBe(10);
    expect(playerDistressed(scab)).toBe(false);
    expect(directorBeat(scab)).toBe("escalate"); // calm fixture region ⇒ the director gets back to work
  });

  it("burden at the threshold is distress; one point under it is not (the literal is load-bearing)", () => {
    expect(DIRECTOR_WOUND_DISTRESS).toBe(40);
    const { state } = run();
    const at = wounded(state, [{ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: 1 }]);
    const under = wounded(state, [{ type: "wound.bite", site: "arm", severity: 40, treated: 1, inflictedDay: 1 }]);
    expect(playerDistressed(at)).toBe(true);
    expect(playerDistressed(under)).toBe(false);
    // two lighter wounds add up — burden is summed across the body
    const two = wounded(state, [
      { type: "wound.sprain", site: "leg", severity: 25, treated: 0, inflictedDay: 1 },
      { type: "wound.sprain", site: "arm", severity: 25, treated: 0, inflictedDay: 1 },
    ]);
    expect(playerDistressed(two)).toBe(true);
  });

  it("a light wound opened within the last DIRECTOR_FRESH_WOUND_HOURS is distress by shock; the same wound a day old is not", () => {
    expect(DIRECTOR_FRESH_WOUND_HOURS).toBe(6);
    const { state } = run();
    const clock = (s: GameState, day: number, hour: number): GameState => ({ ...s, meta: { ...s.meta, day, hour } });
    const cut = { type: "wound.laceration", site: "arm", severity: 30, treated: 0, inflictedDay: 2, inflictedHour: 14 };
    const fresh = clock(wounded(state, [cut]), 2, 16); // two hours ago
    const stale = clock(wounded(state, [cut]), 3, 14); // a day ago
    const edge = clock(wounded(state, [cut]), 2, 20); // exactly six hours ago ⇒ no longer fresh
    expect(woundAgeHours(cut, 2, 16)).toBe(2);
    expect(woundAgeHours(cut, 3, 14)).toBe(24);
    expect(playerDistressed(fresh)).toBe(true);
    expect(playerDistressed(stale)).toBe(false);
    expect(playerDistressed(edge)).toBe(false);
    // a fresh wound that has been fully treated already is not distress — shock needs an OPEN wound
    expect(playerDistressed(clock(wounded(state, [{ ...cut, treated: 30 }]), 2, 16))).toBe(false);
  });

  it("a pre-T78 wound with no hour stamp counts from 00:00 of its day — it can only read OLDER, never fresh", () => {
    const { state } = run();
    const legacy = { type: "wound.laceration", site: "arm", severity: 30, treated: 0, inflictedDay: 2 };
    expect(woundAgeHours(legacy, 2, 5)).toBe(5);
    expect(woundAgeHours(legacy, 2, 6)).toBe(6);
    // at 05:00 on its own day it is inside the window; a live wound would have been stamped, so this
    // is the one hour band a legacy wound can still read fresh in — and it is the conservative side.
    expect(playerDistressed({ ...wounded(state, [legacy]), meta: { ...state.meta, day: 2, hour: 12 } })).toBe(false);
    // a wound stamped in the future (a hand-edited save) never yields a negative age
    expect(woundAgeHours({ ...legacy, inflictedDay: 9 }, 2, 12)).toBe(0);
  });

  it("woundAgeHours is total: a non-finite or out-of-range stamp reads OLD, never fresh (the T77 scentDraw lesson)", () => {
    // Against the unfixed code an `inflictedDay` of Infinity (a `1e999` hand edit) made the wound fresh
    // FOREVER (age 0 on every turn ⇒ permanent distress), and an hour of 30 made it fresh for a day.
    const base = { type: "wound.laceration", site: "arm", severity: 30, treated: 0, inflictedDay: 2 };
    expect(woundAgeHours({ ...base, inflictedDay: Number.POSITIVE_INFINITY }, 40, 12)).toBe((40 - 1) * 24 + 12);
    expect(woundAgeHours({ ...base, inflictedDay: Number.NaN }, 40, 12)).toBe((40 - 1) * 24 + 12);
    expect(woundAgeHours({ ...base, inflictedHour: Number.POSITIVE_INFINITY }, 3, 5)).toBe(24 + 5); // non-finite hour ⇒ unstamped ⇒ 00:00
    expect(woundAgeHours({ ...base, inflictedHour: 30 }, 3, 5)).toBe(24 + 5 - 23); // out of range ⇒ clamped into its day
    expect(woundAgeHours({ ...base, inflictedHour: -4 }, 2, 1)).toBe(1);
    const { state } = run();
    const s: GameState = { ...wounded(state, [{ ...base, inflictedDay: Number.POSITIVE_INFINITY }]), meta: { ...state.meta, day: 40, hour: 12 } };
    expect(playerDistressed(s)).toBe(false);
  });

  it("every live wound source stamps the hour, so a wound opened THIS turn reads fresh (combat path)", () => {
    // Wounds inflicted by the engine carry `inflictedHour`; without it the shock clause could never fire
    // on a live run and the whole clause would be dead wiring.
    const { state } = run();
    const s: GameState = { ...state, meta: { ...state.meta, day: 3, hour: 15 } };
    const hurt = inflictWound(s.player.condition, { id: "wound.laceration", name: "cut", description: "", severity: 30, effect: "bleed" }, "arm", s.meta.day, s.meta.hour);
    expect(hurt.wounds[0]!.inflictedHour).toBe(15);
    expect(hurt.wounds[0]!.inflictedDay).toBe(3);
  });
});

describe("relief is rationed — at most DIRECTOR_RELIEF_PER_DAY beats a day (T78)", () => {
  const distressed = (s: GameState): GameState => wounded(s, [{ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: 1 }]);

  it("the (cap+1)th relief of a day reads `hold` and moves nothing; the count lives on world", () => {
    expect(DIRECTOR_RELIEF_PER_DAY).toBe(4);
    const { state } = run();
    let s = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 50 } } });
    expect(reliefSpent(s)).toBe(0);
    for (let i = 0; i < DIRECTOR_RELIEF_PER_DAY; i++) {
      expect(directorBeat(s)).toBe("relief");
      s = tickDirector(s, 2);
      expect(density(s)).toBe(50 - (i + 1));
      expect(reliefSpent(s)).toBe(i + 1);
    }
    // Against the unfixed code this was a fifth relief and density 45.
    expect(directorBeat(s)).toBe("hold");
    const held = tickDirector(s, 2);
    expect(density(held)).toBe(50 - DIRECTOR_RELIEF_PER_DAY);
    expect(reliefSpent(held)).toBe(DIRECTOR_RELIEF_PER_DAY);
    expect(held.world).toBe(s.world);
    // The held tick is not reference-equal only because the bias decay clock banks its two hours
    // (the lean opened on tick 1 at 0 banked hours; ticks 2–5 banked 2 each ⇒ 8).
    expect(held.regions["region.x"]!.directorBias).toBe(-DIRECTOR_RELIEF_PER_DAY);
    expect(held.regions["region.x"]!.directorBiasHours).toBe(8);
  });

  it("midnight resets the ration: a new day spends from zero", () => {
    const { state } = run();
    let s = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 50 } } });
    for (let i = 0; i < DIRECTOR_RELIEF_PER_DAY; i++) s = tickDirector(s, 2);
    expect(directorBeat(s)).toBe("hold");
    const tomorrow: GameState = { ...s, meta: { ...s.meta, day: s.meta.day + 1 } };
    expect(reliefSpent(tomorrow)).toBe(0);
    expect(directorBeat(tomorrow)).toBe("relief");
    expect(density(tickDirector(tomorrow, 2))).toBe(50 - DIRECTOR_RELIEF_PER_DAY - 1);
  });

  it("a relief that changes nothing (density already 0 AND the lean at its floor) spends no ration and writes nothing", () => {
    const { state } = run();
    const s = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 0, directorBias: -DIRECTOR_BIAS_MAX } } });
    expect(directorBeat(s)).toBe("relief");
    // (decay runs on the tick, so compare the dials and the ration, not the reference)
    const t = tickDirector(s, 2);
    expect(density(t)).toBe(0);
    expect(reliefSpent(t)).toBe(0);
    expect(t.world).toBe(s.world);
    // …but a relief that can still lean the anchor DOES land, and is rationed, even at density 0:
    const floorless = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 0 } } });
    const u = tickDirector(floorless, 2);
    expect(density(u)).toBe(0);
    expect(u.regions["region.x"]!.directorBias).toBe(-1);
    expect(reliefSpent(u)).toBe(1);
  });

  it("escalate is not rationed and never touches the ration fields", () => {
    const { state } = run();
    let s = state;
    for (let i = 0; i < DIRECTOR_RELIEF_PER_DAY + 2; i++) {
      expect(directorBeat(s)).toBe("escalate");
      s = tickDirector(s, 2);
    }
    expect(s.world.directorReliefDay).toBeUndefined();
    expect(s.world.directorReliefBeats).toBeUndefined();
    expect(density(s)).toBe(density(state) + DIRECTOR_RELIEF_PER_DAY + 2);
  });

  it("a hand-edited ration count (NaN / negative) reads as 0 spent, never as a permanent cap", () => {
    const { state } = run();
    const s = distressed({ ...state, world: { ...state.world, directorReliefDay: state.meta.day, directorReliefBeats: Number.NaN } });
    expect(reliefSpent(s)).toBe(0);
    expect(directorBeat(s)).toBe("relief");
    const neg = { ...s, world: { ...s.world, directorReliefBeats: -3 } };
    expect(reliefSpent(neg)).toBe(0);
  });

  it("relief on a distressed run still bites the same day but is bounded: cap x step a day, whatever the turn count", () => {
    // 12 two-hour turns of a distressed, undisturbed player in one day: the region loses exactly the ration.
    const { state } = run();
    let s = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 60 } } });
    const before = density(s);
    let reliefBeats = 0;
    for (let i = 0; i < 12; i++) {
      if (directorBeat(s) === "relief") reliefBeats++;
      s = tickDirector(s, 2);
    }
    expect(reliefBeats).toBe(DIRECTOR_RELIEF_PER_DAY);
    expect(density(s)).toBe(before - DIRECTOR_RELIEF_PER_DAY);
  });
});

describe("a beat leans the region's drift anchor — `directorBias` (T78, the measured fix for beats the substrate erased)", () => {
  const distressed = (s: GameState): GameState => wounded(s, [{ type: "wound.bite", site: "arm", severity: 40, treated: 0, inflictedDay: 1 }]);
  const bias = (s: GameState): number => directorBias(s.regions["region.x"]!);

  it("escalate leans +step and relief −1, clamped to ±DIRECTOR_BIAS_MAX; the literal is load-bearing", () => {
    expect(DIRECTOR_BIAS_MAX).toBe(10);
    const { state } = run();
    let s = state;
    for (let i = 0; i < DIRECTOR_BIAS_MAX + 3; i++) {
      expect(directorBeat(s)).toBe("escalate");
      s = tickDirector(s, 2);
      // the STORED value never leaves the bound (the read clamp must not be what hides an overshoot)
      expect(Math.abs(s.regions["region.x"]!.directorBias ?? 0)).toBeLessThanOrEqual(DIRECTOR_BIAS_MAX);
    }
    expect(bias(s)).toBe(DIRECTOR_BIAS_MAX);
    expect(s.regions["region.x"]!.directorBias).toBe(DIRECTOR_BIAS_MAX); // stored as the clamped whole number
    // relief walks it back down a point a beat (rationed 4/day; roll the day to keep relieving)
    let r = distressed({ ...s, regions: { "region.x": { ...s.regions["region.x"]!, zombieDensity: 50 } } });
    for (let day = 0; day < 6; day++) {
      r = { ...r, meta: { ...r.meta, day: r.meta.day + 1 } };
      for (let i = 0; i < DIRECTOR_RELIEF_PER_DAY; i++) r = tickDirector(r, 2);
    }
    expect(bias(r)).toBe(-DIRECTOR_BIAS_MAX); // 10 − 24 clamps at the floor
  });

  it("the anchor carries the lean: with bias −5 a region converges 5 below its authored point; with +5, 5 above", () => {
    // Against the unfixed code the region converged to the authored point regardless of any beat.
    // Drift alone (the regions layer, no director tick ⇒ no decay), so the lean is the only variable.
    const { state, graph } = run();
    const b = REGIONS[0]!.baseline!;
    for (const lean of [-5, 5]) {
      let s: GameState = { ...state, regions: { "region.x": { ...state.regions["region.x"]!, directorBias: lean } } };
      for (let i = 0; i < 20; i++) s = driftRegions(s, 24, graph);
      expect(driftAnchor(b, 1, lean).threat).toBe(b.threat! + lean);
      expect(Math.abs(s.regions["region.x"]!.threat - (b.threat! + lean))).toBeLessThanOrEqual(2);
      expect(Math.abs(s.regions["region.x"]!.zombieDensity - (b.zombieDensity! + lean))).toBeLessThanOrEqual(3);
      expect(s.regions["region.x"]!.directorBias).toBe(lean); // drift never touches the lean
    }
  });

  it("the lean decays one point toward zero per DIRECTOR_BIAS_DECAY_HOURS, banked, in EVERY region, and holds at zero", () => {
    expect(DIRECTOR_BIAS_DECAY_HOURS).toBe(24);
    const r: RegionState = { ...region({ threat: 30, zombieDensity: 40 }), directorBias: -3 };
    // 23 hours bank; the 24th comes due
    const a = decayBias(r, 23);
    expect(a.directorBias).toBe(-3);
    expect(a.directorBiasHours).toBe(23);
    const b = decayBias(a, 1);
    expect(b.directorBias).toBe(-2);
    expect(b.directorBiasHours).toBe(0);
    // chunking-invariant: 3 x 24h == 1 x 72h, and both land at zero with the fields REMOVED, not stored as 0
    let chunked = r;
    for (let i = 0; i < 3; i++) chunked = decayBias(chunked, 24);
    const oneShot = decayBias(r, 72);
    expect(chunked).toStrictEqual(oneShot);
    expect("directorBias" in chunked).toBe(false);
    expect("directorBiasHours" in chunked).toBe(false);
    // HOLD at zero: a clean region comes back by the same reference and accrues no hours
    const clean = region({ threat: 30 });
    expect(decayBias(clean, 24)).toBe(clean);
    // a positive lean decays downward
    expect(decayBias({ ...r, directorBias: 2 }, 48).directorBias).toBeUndefined();
    expect(decayBias({ ...r, directorBias: 2 }, 24).directorBias).toBe(1);
    // …and the world tick decays the region the player is NOT in
    const { state } = run();
    const far: GameState = { ...state, regions: { ...state.regions, "region.far": { ...region({ threat: 30 }), directorBias: 4 } } };
    const t = tickDirector(far, 24);
    expect(directorBias(t.regions["region.far"]!)).toBe(3);
  });

  it("a hand-edited lean (NaN, a fraction, out of range) reads as the nearest legal value and is scrubbed on the next tick", () => {
    expect(directorBias(region({ directorBias: Number.NaN }))).toBe(0);
    expect(directorBias(region({ directorBias: 7.9 }))).toBe(7);
    expect(directorBias(region({ directorBias: 1e300 }))).toBe(DIRECTOR_BIAS_MAX);
    expect(directorBias(region({ directorBias: -1e300 }))).toBe(-DIRECTOR_BIAS_MAX);
    expect(directorBias(region({}))).toBe(0);
    const nan = decayBias({ ...region({}), directorBias: Number.NaN, directorBiasHours: Number.NaN }, 1);
    expect("directorBias" in nan).toBe(false);
    expect("directorBiasHours" in nan).toBe(false);
    const frac = decayBias({ ...region({}), directorBias: 7.9, directorBiasHours: Number.NaN }, 1);
    expect(frac.directorBias).toBe(7);
    expect(frac.directorBiasHours).toBe(1);
  });

  it("the beat is felt this turn AND next: a relief lowers the dial by one now and the anchor by one for the drift that follows", () => {
    const { state } = run();
    const b = REGIONS[0]!.baseline!;
    const s = distressed(state); // the fixture region sits AT its authored point (density 20)
    expect(density(s)).toBe(b.zombieDensity);
    const after = tickDirector(s, 2);
    expect(density(after)).toBe(b.zombieDensity! - 1);
    expect(bias(after)).toBe(-1);
    // Against the unfixed code the anchor for the next drift step was still the authored 20, pulling the dial back.
    expect(driftAnchor(b, after.meta.day, bias(after)).zombieDensity).toBe(b.zombieDensity! - 1);
    expect(driftAnchor(b, after.meta.day, bias(after)).threat).toBe(b.threat! - 1);
  });

  it("a disabled director stops the beats but NOT the decay — a lean acquired before the flag still fades; and a save round-trips the fields", () => {
    // The first T78 cut (not reproducible from the shipped trees) froze the lean under `director.disabled`; the audit showed that left a permanent
    // scar on the anchor (bias 10 held forever) while the header promised none.
    const { state, graph } = run();
    const s: GameState = disable({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, directorBias: -6, directorBiasHours: 5 } } });
    const back = loadGame(saveGame(s));
    expect(back.regions["region.x"]!.directorBias).toBe(-6);
    expect(back.regions["region.x"]!.directorBiasHours).toBe(5);
    const later = tickDirector(s, 48);
    expect(directorBias(later.regions["region.x"]!)).toBe(-4);
    expect(density(later)).toBe(density(s)); // no beat landed
    let faded = s;
    for (let i = 0; i < 12; i++) faded = advanceWorld(faded, 24, graph);
    expect(faded.regions["region.x"]!.directorBias).toBeUndefined();
    expect(Math.abs(faded.regions["region.x"]!.threat - REGIONS[0]!.baseline!.threat!)).toBeLessThanOrEqual(DRIFT_JITTER);
  });

  it("on Story the escalate step truncates to 0: the director never escalates and never leans a district upward (declared, not a bug)", () => {
    const { state } = startRun({ ...opts, difficulty: "story" }, REGIONS, NODES);
    expect(directorBeat(state)).toBe("escalate");
    let s = state;
    for (let i = 0; i < 10; i++) s = tickDirector(s, 2);
    expect(s).toBe(state);
    expect(bias(s)).toBe(0);
    // …but relief is unscaled and still leans it down
    const hurt = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 30 } } });
    expect(bias(tickDirector(hurt, 2))).toBe(-1);
  });

  it("a non-finite CLOCK (meta.day / meta.hour off a hand-edited save) fails closed: no fresh wound, the ration still binds, nothing non-finite is written", () => {
    // Against the first T78 cut (not the pre-T78 tree) an Infinity day made every open wound age 0 (permanent shock distress),
    // a NaN day dodged the ration (NaN never equals itself), and the tick wrote the bad day into world.
    const { state } = run();
    const cut = { type: "wound.laceration", site: "arm", severity: 30, treated: 0, inflictedDay: 1, inflictedHour: 0 };
    for (const day of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const s: GameState = { ...wounded(state, [cut]), meta: { ...state.meta, day, hour: 12 } };
      expect(woundAgeHours(cut, day, 12)).toBe(Number.MAX_SAFE_INTEGER);
      expect(playerDistressed(s)).toBe(false);
      let r = distressed({ ...s, regions: { "region.x": { ...s.regions["region.x"]!, zombieDensity: 50 } } });
      for (let i = 0; i < 12; i++) r = tickDirector(r, 2);
      expect(density(r)).toBe(50 - DIRECTOR_RELIEF_PER_DAY);
      expect(Number.isFinite(r.world.directorReliefDay)).toBe(true);
      // the poisoned clock itself serialises as null (that is the hand edit) — the director wrote nothing like it
      expect(JSON.stringify(JSON.parse(saveGame(r)).state.world).includes("null")).toBe(false);
      expect(JSON.stringify(JSON.parse(saveGame(r)).state.regions).includes("null")).toBe(false);
    }
    expect(woundAgeHours(cut, 3, Number.NaN)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("with the lean, the director ON vs OFF is distinguishable again on a distressed run (the T30 DoD)", () => {
    // Against the first T78 cut (dial nudge only; not reproducible from the shipped trees) the two ended within jitter of each other, because
    // every relief was undone by the next drift step toward the anchor.
    const { state, graph } = run();
    const s = distressed({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: 40 } } });
    let on = s;
    let off = disable(s);
    for (let day = 0; day < 4; day++) {
      for (let turn = 0; turn < 12; turn++) {
        on = advanceWorld(on, 2, graph);
        off = advanceWorld(off, 2, graph);
      }
      on = { ...on, meta: { ...on.meta, day: on.meta.day + 1 } };
      off = { ...off, meta: { ...off.meta, day: off.meta.day + 1 } };
    }
    expect(bias(on)).toBe(-DIRECTOR_BIAS_MAX);
    expect(density(off) - density(on)).toBeGreaterThanOrEqual(6);
  });
});

describe("director nudges are bounded and region-only (T30)", () => {
  it("escalate raises the current region's density + threat by one, clamped", () => {
    const { state } = run();
    const after = tickDirector(state, 6);
    expect(after.regions["region.x"]!.zombieDensity).toBe(density(state) + 1);
    expect(after.regions["region.x"]!.threat).toBe(state.regions["region.x"]!.threat + 1);
    // nothing but regions moved
    expect(after.player).toBe(state.player);
    expect(after.nodes).toBe(state.nodes);
    expect(after.world).toBe(state.world);
    expect(after.hordes).toBe(state.hordes);
  });

  it("is inert on a zero-hour tick", () => {
    const { state } = run();
    expect(tickDirector(state, 0)).toBe(state);
  });

  it("never produces an out-of-bounds dial, any pressure/hours (property — the DoD)", () => {
    const { state } = run();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 48 }), (gt, dens, hours) => {
        const s = withThreat({ ...state, regions: { "region.x": { ...state.regions["region.x"]!, zombieDensity: dens } } }, gt);
        const out = tickDirector(s, hours).regions["region.x"]!;
        expect(out.zombieDensity).toBeGreaterThanOrEqual(0);
        expect(out.zombieDensity).toBeLessThanOrEqual(100);
        expect(out.threat).toBeGreaterThanOrEqual(0);
        expect(out.threat).toBeLessThanOrEqual(100);
      }),
    );
  });
});

describe("the director counters off-screen de-escalation (T30 · addresses PL-M2-03)", () => {
  it("an idle district stays denser with the director on than off, and both stay legal", () => {
    // fix the phase to midday (calm tide) so escalation is the dominant signal, then idle for days
    const { state, graph } = run();
    const base = { ...state, meta: { ...state.meta, phase: "midday" as const }, world: { ...state.world, globalThreat: 10 } };
    const on = advanceWorld(base, 24 * 8, graph);        // 8 idle days, director on
    const off = advanceWorld(disable(base), 24 * 8, graph); // 8 idle days, director off
    expect(density(on)).toBeGreaterThan(density(off)); // the world festers when unwatched
    for (const s of [on, off]) {
      expect(density(s)).toBeGreaterThanOrEqual(0);
      expect(density(s)).toBeLessThanOrEqual(100);
    }
  });
});
