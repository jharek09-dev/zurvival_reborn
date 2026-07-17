import { describe, expect, it } from "vitest";
import {
  applyAction,
  availableActions,
  loadGame,
  saveGame,
  sceneOf,
  startRun,
  hasRadio,
  signalStatus,
  effectiveStatus,
  signalAudible,
  readSignal,
  audibleSignals,
  radioChoices,
  isRadioAction,
  resolveRadioAction,
  radioLine,
  renderSignalRead,
  RADIO_ITEM,
  RADIO_STREAM,
  BROADCAST_NOISE,
  BROADCAST_OUTCOMES,
  POWER_DEAD_AT,
  MILITARY_FAILING_AT,
  REGION_FALL_AT,
  REGION_SILENT_AT,
  ANOMALY_THREAT,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type SignalDef,
} from "../src/index.js";

/**
 * T50 — the radio network. Signals (content) whose live/failing/faint/dead status is DERIVED from world
 * + region + day (FR-STY-03: "evolve with world state"), read on a scavenged receiver; listening cheap,
 * broadcasting a loud unknown-audience risk (SCR-09); one reserved anomaly. No save-schema rung.
 */

// Two regions: home (start) is adjacent to next; far is not adjacent to home (reach boundary).
const REGIONS: RegionDef[] = [
  { id: "region.home", name: "Home", description: "home", baseline: { threat: 30 }, adjacent: ["region.next"] },
  { id: "region.next", name: "Next", description: "next", baseline: { threat: 30 }, adjacent: ["region.home", "region.far"] },
  { id: "region.far", name: "Far", description: "far", baseline: { threat: 30 }, adjacent: ["region.next"] },
];
const NODES: NodeDef[] = [
  { id: "node.home", regionId: "region.home", name: "Home", description: "a store", adjacent: ["node.next"], start: true, kind: "store" },
  { id: "node.next", regionId: "region.next", name: "Next", description: "next", adjacent: ["node.home", "node.far"] },
  { id: "node.far", regionId: "region.far", name: "Far", description: "far", adjacent: ["node.next"] },
];

const SIG = {
  mil: { id: "radio.mil", signalType: "military", channel: 7, label: "MIL 7", onsetDay: 1, regionId: "region.home", reach: "citywide", messages: { live: "hold", failing: "slipping", dead: "gone" } },
  emg: { id: "radio.emg", signalType: "emergency", channel: 1, label: "EAS", onsetDay: 1, reach: "citywide", lifespanDays: 5, messages: { live: "remain indoors", dead: "silence" } },
  civ: { id: "radio.civ", signalType: "civilian", channel: 3, label: "CIV 3", onsetDay: 1, regionId: "region.next", reach: "local", messages: { live: "anyone?", dead: "quiet" } },
  civFar: { id: "radio.civ-far", signalType: "civilian", channel: 8, label: "CIV 8", onsetDay: 1, regionId: "region.far", reach: "local", messages: { live: "help", dead: "quiet" } },
  num: { id: "radio.num", signalType: "unknown", channel: 12, label: "Numbers", onsetDay: 1, reach: "citywide", messages: { live: "nine four seven" } },
  anom: { id: "radio.anom", signalType: "unknown", label: "...", onsetDay: 1, reach: "citywide", anomaly: true, messages: { live: "we can wait" } },
  late: { id: "radio.late", signalType: "military", channel: 4, label: "MIL 4", onsetDay: 1, regionId: "region.home", reach: "citywide", onsetThreat: 40, messages: { live: "new" } },
  future: { id: "radio.future", signalType: "emergency", channel: 2, label: "later", onsetDay: 5, reach: "citywide", messages: { live: "day five" } },
} satisfies Record<string, SignalDef>;
const ALL: SignalDef[] = Object.values(SIG);

const opts = { seed: "radio-seed", createdAt: "2026-07-17T00:00:00Z" };
const run = (signals: SignalDef[] = ALL): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], [], [], signals);

const withRadio = (s: GameState): GameState => ({ ...s, player: { ...s.player, inventory: [{ type: RADIO_ITEM, quantity: 1 }] } });
const at = (s: GameState, loc: string): GameState => ({ ...s, player: { ...s.player, location: loc } });
const setThreat = (s: GameState, region: string, threat: number): GameState => ({ ...s, regions: { ...s.regions, [region]: { ...s.regions[region]!, threat } } });
const setPhase = (s: GameState, phase: GameState["meta"]["phase"]): GameState => ({ ...s, meta: { ...s.meta, phase } });
const setDay = (s: GameState, day: number): GameState => ({ ...s, meta: { ...s.meta, day } });
const setGrid = (s: GameState, powerGrid: number): GameState => ({ ...s, world: { ...s.world, powerGrid } });
const setGlobal = (s: GameState, globalThreat: number): GameState => ({ ...s, world: { ...s.world, globalThreat } });

// --- status derivation: signals evolve with world state ---------------------------------------

describe("signal status is derived from world state (FR-STY-03)", () => {
  it("a military signal reads live → failing → dead as its region's threat climbs", () => {
    const { state } = run();
    expect(signalStatus(setThreat(state, "region.home", MILITARY_FAILING_AT - 1), SIG.mil)).toBe("live");
    expect(signalStatus(setThreat(state, "region.home", MILITARY_FAILING_AT), SIG.mil)).toBe("failing");
    expect(signalStatus(setThreat(state, "region.home", REGION_FALL_AT - 1), SIG.mil)).toBe("failing");
    expect(signalStatus(setThreat(state, "region.home", REGION_FALL_AT), SIG.mil)).toBe("dead");
  });

  it("the emergency loop dies when the grid drops OR its shelf life elapses", () => {
    const { state } = run();
    expect(signalStatus(state, SIG.emg)).toBe("live");
    expect(signalStatus(setGrid(state, POWER_DEAD_AT - 1), SIG.emg)).toBe("dead");
    expect(signalStatus(setGrid(state, POWER_DEAD_AT), SIG.emg)).toBe("live"); // at the floor it still holds
    expect(signalStatus(setDay(state, 1 + 5 + 1), SIG.emg)).toBe("dead"); // past onsetDay + lifespanDays
  });

  it("a civilian/ham signal goes silent once its region is overrun", () => {
    const { state } = run();
    expect(signalStatus(setThreat(state, "region.next", REGION_SILENT_AT - 1), SIG.civ)).toBe("live");
    expect(signalStatus(setThreat(state, "region.next", REGION_SILENT_AT), SIG.civ)).toBe("dead");
  });

  it("the number station is faint by day and clear at night", () => {
    const { state } = run();
    expect(signalStatus(setPhase(state, "midday"), SIG.num)).toBe("faint");
    expect(signalStatus(setPhase(state, "night"), SIG.num)).toBe("live");
  });
});

// --- reach + audibility -----------------------------------------------------------------------

describe("reach and audibility (portable receiver)", () => {
  it("citywide signals are audible anywhere; local only in or next to their region", () => {
    const base = run().state;
    const home = at(base, "node.home"); // region.home
    expect(signalAudible(home, run().graph, SIG.mil)).toBe(true); // citywide
    expect(signalAudible(home, run().graph, SIG.civ)).toBe(true); // local in adjacent region.next
    expect(signalAudible(home, run().graph, SIG.civFar)).toBe(false); // local in far, not near home
    const next = at(base, "node.next");
    expect(signalAudible(next, run().graph, SIG.civFar)).toBe(true); // next is adjacent to far
  });

  it("a local signal read out of its own region reads FAINT; in-region reads LIVE", () => {
    const home = at(run().state, "node.home");
    expect(readSignal(home, SIG.civ).strength).toBe("faint"); // heard from adjacent region.home
    const next = at(run().state, "node.next");
    expect(readSignal(next, SIG.civ).strength).toBe("live"); // in region.next
  });

  it("onsetDay hides a signal until it begins, onsetThreat until the world spikes", () => {
    const g = run().graph;
    const s = at(run().state, "node.home");
    expect(signalAudible(s, g, SIG.future)).toBe(false); // day 1 < onsetDay 5
    expect(signalAudible(setDay(s, 5), g, SIG.future)).toBe(true);
    expect(signalAudible(s, g, SIG.late)).toBe(false); // globalThreat 0 < onsetThreat 40
    expect(signalAudible(setGlobal(s, 40), g, SIG.late)).toBe(true);
  });

  it("audibleSignals orders by channel and includes dead-but-in-reach signals", () => {
    const g = run().graph;
    const s = setThreat(at(run().state, "node.home"), "region.home", REGION_FALL_AT); // mil is dead but citywide
    const reads = audibleSignals(s, g);
    const ids = reads.map((r) => r.def.id);
    expect(ids).toContain("radio.mil");
    expect(reads.find((r) => r.def.id === "radio.mil")!.status).toBe("dead");
    const channels = reads.filter((r) => r.def.channel !== undefined).map((r) => r.def.channel!);
    expect(channels).toEqual([...channels].sort((a, b) => a - b)); // channel-ordered
  });
});

// --- the reserved anomaly ---------------------------------------------------------------------

describe("the anomaly breaks the rules exactly once (SCR-09)", () => {
  const deepNight = (s: GameState): GameState => setThreat(setPhase(s, "night"), "region.home", ANOMALY_THREAT);
  it("is silent below the threat gate, by day, and only surfaces deep + at night", () => {
    const g = run().graph;
    const s = at(run().state, "node.home");
    expect(signalAudible(s, g, SIG.anom)).toBe(false); // shallow, day
    expect(signalAudible(setPhase(deepNight(s), "midday"), g, SIG.anom)).toBe(false); // deep but daylight
    expect(signalAudible(deepNight(s), g, SIG.anom)).toBe(true); // deep + night
  });

  it("is heard once — a prior listen suppresses it thereafter (once per run)", () => {
    const g = run().graph;
    const s = withRadio(deepNight(at(run().state, "node.home")));
    expect(signalAudible(s, g, SIG.anom)).toBe(true);
    const listened = resolveRadioAction(s, g, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 });
    // Same turn: still audible (the reveal turn shows it). A later turn: suppressed.
    expect(signalAudible(listened, g, SIG.anom)).toBe(true);
    const nextTurn = { ...listened, meta: { ...listened.meta, turn: listened.meta.turn + 1 } };
    expect(signalAudible(nextTurn, g, SIG.anom)).toBe(false);
  });
});

// --- the seam: gated on a radio, listen, broadcast --------------------------------------------

describe("the radio seam is gated on carrying a receiver", () => {
  it("radioChoices is empty without a radio and offers listen + broadcast with one", () => {
    const { state } = run();
    expect(radioChoices(state)).toEqual([]);
    expect(radioChoices(withRadio(state)).map((c) => c.id)).toEqual(["listen-radio", "broadcast"]);
  });

  it("the whole system is inert without a signal pool AND without a radio (byte-identical)", () => {
    const noPool = startRun(opts, REGIONS, NODES); // no signals registered
    const a = availableActions(noPool.state, noPool.graph);
    const withPool = run(); // signals registered, but no radio carried
    const b = availableActions(withPool.state, withPool.graph);
    expect(b.map((c) => c.id)).toEqual(a.map((c) => c.id)); // pool alone adds no choices
    expect(hasRadio(withPool.state)).toBe(false);
    expect(radioLine(withPool.state, withPool.graph)).toBeNull(); // no radio turn ⇒ no line
  });

  it("listen logs a radio.tuned beat and is a resolved change; the digest surfaces only that turn", () => {
    const { state, graph } = run();
    const s = withRadio(at(state, "node.home"));
    const res = applyAction(s, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 }, graph);
    const beats = res.state.history.filter((h) => h.type === "radio.tuned");
    expect(beats.length).toBe(1);
    expect(res.changed).toContain("history");
    expect(res.scene.narration).toContain("tune the radio"); // digest present this turn
    // A subsequent non-radio turn: no radio line.
    const after = applyAction(res.state, { type: "rest", choiceId: "rest", timeCost: 6 }, graph);
    expect(radioLine(after.state, graph)).toBeNull();
  });

  it("listen advances no RNG; broadcast advances ONLY the radio stream and is deterministic", () => {
    const { state, graph } = run();
    const s = withRadio(at(state, "node.home"));
    const listen = resolveRadioAction(s, graph, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 });
    expect(listen.rng).toEqual(s.rng); // a listen touches no stream

    const bcast = resolveRadioAction(s, graph, { type: "broadcast", choiceId: "broadcast", timeCost: 1 });
    expect(Object.keys(bcast.rng.streams)).toContain(RADIO_STREAM);
    // every OTHER stream is untouched
    for (const k of Object.keys(s.rng.streams)) expect(bcast.rng.streams[k]).toEqual(s.rng.streams[k]);
    const again = resolveRadioAction(s, graph, { type: "broadcast", choiceId: "broadcast", timeCost: 1 });
    expect(again.rng).toEqual(bcast.rng); // same seed ⇒ same draw
    const beat = bcast.history.find((h) => h.type === "radio.broadcast")!;
    expect((beat.data as { outcome: number }).outcome).toBeGreaterThanOrEqual(0);
  });

  it("broadcast is loud — it deposits region-scale noise the dead can hear (T14/T26)", () => {
    const { state, graph } = run();
    const s = withRadio(at(state, "node.home"));
    const res = applyAction(s, availableActions(s, graph).find((c) => c.id === "broadcast")!.action, graph);
    expect(res.state.nodes["node.home"]!.noise).toBe(BROADCAST_NOISE); // decay-then-deposit from 0 ⇒ exactly this
    expect(res.scene.narration).toContain("put your voice out");
    expect(BROADCAST_OUTCOMES.some((o) => res.scene.narration.includes(o.slice(0, 12)))).toBe(true);
  });
});

// --- determinism + save-losslessness ----------------------------------------------------------

describe("determinism and save (no save-schema rung)", () => {
  it("sceneOf is pure over a radio turn — called twice it is byte-identical and advances no rng", () => {
    const { state, graph } = run();
    const s = withRadio(at(state, "node.home"));
    const res = applyAction(s, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 }, graph);
    expect(sceneOf(res.state, graph)).toEqual(sceneOf(res.state, graph));
    expect(sceneOf(res.state, graph).narration).toBe(res.scene.narration);
  });

  it("a run is save-lossless across a broadcast (the radio stream round-trips)", () => {
    const { state, graph } = run();
    const s = withRadio(at(state, "node.home"));
    const after = applyAction(s, availableActions(s, graph).find((c) => c.id === "broadcast")!.action, graph).state;
    const round = loadGame(saveGame(after));
    expect(round).toEqual(after);
    expect(round.rng.streams[RADIO_STREAM]).toEqual(after.rng.streams[RADIO_STREAM]);
  });

  it("isRadioAction only claims the radio verbs", () => {
    expect(isRadioAction({ type: "listen-radio" })).toBe(true);
    expect(isRadioAction({ type: "broadcast" })).toBe(true);
    expect(isRadioAction({ type: "rest" })).toBe(false);
  });

  it("a discovered signal stays on the dial after its onset threshold falls away (no blink)", () => {
    const { graph } = run();
    const s = { ...withRadio(at(run().state, "node.home")), world: { ...run().state.world, globalThreat: 40 } };
    expect(signalAudible(s, graph, SIG.late)).toBe(true); // onsetThreat 40 met
    const listened = resolveRadioAction(s, graph, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 });
    const later = { ...listened, meta: { ...listened.meta, turn: listened.meta.turn + 1 }, world: { ...listened.world, globalThreat: 0 } };
    expect(signalAudible(later, graph, SIG.late)).toBe(true); // discovered ⇒ stays listed though the tide dropped
  });

  it("a station heard dead stays dead even if its district later calms (dead-latch)", () => {
    const { graph } = run();
    const s = setThreat(withRadio(at(run().state, "node.home")), "region.home", REGION_FALL_AT); // mil dead
    expect(signalStatus(s, SIG.mil)).toBe("dead");
    const listened = resolveRadioAction(s, graph, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 });
    const calmed = setThreat({ ...listened, meta: { ...listened.meta, turn: listened.meta.turn + 1 } }, "region.home", 20);
    expect(signalStatus(calmed, SIG.mil)).toBe("live"); // the world says live again…
    expect(effectiveStatus(calmed, SIG.mil)).toBe("dead"); // …but a fallen station never un-falls
  });

  it("the digest renders what was on air at tune time, even if the world drifts within the turn (anomaly survives)", () => {
    const { state, graph } = run();
    // Deep + night so the anomaly is audible at stage 3; region drift will lower threat by stage 14. Use a
    // night HOUR (advanceClock recomputes phase from the hour at stage 2), so the listen turn resolves at night.
    const deep: GameState = { ...withRadio(at(state, "node.home")), meta: { ...state.meta, hour: 22, phase: "night" }, regions: { ...state.regions, "region.home": { ...state.regions["region.home"]!, threat: ANOMALY_THREAT } } };
    const res = applyAction(deep, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 }, graph);
    expect(res.state.regions["region.home"]!.threat).toBeLessThan(ANOMALY_THREAT); // drift lowered it within the turn
    expect(res.scene.narration).toContain("we can wait"); // yet the anomaly caught at stage 3 is still in the digest
  });

  it("renderSignalRead is all words — no raw threat/progression numbers leak", () => {
    const g = run().graph;
    const s = at(run().state, "node.home");
    for (const def of ALL) {
      if (!signalAudible(s, g, def)) continue;
      const line = renderSignalRead(s, readSignal(s, def));
      expect(line.length).toBeGreaterThan(0);
      // the only digits allowed are a channel number; no bare 0–100 dial value (threat/grid/progression)
      expect(/threat|progression|globalThreat|powerGrid/i.test(line)).toBe(false);
    }
  });
});
