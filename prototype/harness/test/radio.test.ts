import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  availableActions,
  sceneOf,
  startRun,
  audibleSignals,
  renderSignalRead,
  resolveRadioAction,
  signalStatus,
  RADIO_ITEM,
  BROADCAST_NOISE,
  ANOMALY_THREAT,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type SignalDef,
} from "../../engine/src/index.js";
import { renderScene } from "../src/index.js";

/**
 * T50 — the radio network over shipped content. Proves the `content/radio/` set loads and interprets,
 * the on-air digest is legible through the client (all words, no hidden dial numbers, FR-STY-03 /
 * NFR-ACC-01), and a real play beat: find a radio → hear the network → watch a station fall to dead air
 * → broadcast and light up the node → the anomaly surfaces once, deep and at night.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const signals = load<SignalDef>("radio");
const opts = { seed: "radio-ship", createdAt: "2026-07-17T06:00:00.000Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, regions, nodes, [], [], [], signals);

const withRadio = (s: GameState): GameState => ({
  ...s,
  player: { ...s.player, inventory: [{ type: RADIO_ITEM, quantity: 1 }] },
});
const listenAt = (s: GameState, graph: RegionGraph): ReturnType<typeof applyAction> =>
  applyAction(s, availableActions(s, graph).find((c) => c.id === "listen-radio")!.action, graph);

// --- content loads + covers the network -------------------------------------------------------

describe("the shipped radio network (content/radio)", () => {
  it("ships all five signal families plus exactly one anomaly", () => {
    const families = new Set(signals.map((s) => s.signalType));
    for (const f of ["emergency", "military", "civilian", "ham", "unknown"]) expect(families.has(f as never)).toBe(true);
    expect(signals.filter((s) => s.anomaly === true).length).toBe(1);
    // The anomaly is the only signal without a channel; every other signal is on a dial.
    expect(signals.filter((s) => s.channel === undefined).map((s) => s.id)).toEqual(
      signals.filter((s) => s.anomaly === true).map((s) => s.id),
    );
  });

  it("a first listen from the start hears several families at once", () => {
    const { state, graph } = run();
    const reads = audibleSignals(withRadio(state), graph);
    expect(reads.length).toBeGreaterThanOrEqual(4);
    const families = new Set(reads.map((r) => r.def.signalType));
    expect(families.size).toBeGreaterThanOrEqual(3); // emergency + military + a real person + the numbers
    expect(reads.some((r) => r.def.signalType === "civilian")).toBe(true); // the rivermouth plea, in-region
  });
});

// --- legibility gate (the digest is all words, no hidden number) ------------------------------

describe("the on-air digest is legible through the client (NFR-ACC-01 / FR-UI-02)", () => {
  it("renders each signal in words with its channel/label, and leaks no dial number", () => {
    const { state, graph } = run();
    const res = listenAt(withRadio(state), graph);
    const screen = renderScene(res.scene, res.state).join("\n");
    expect(screen).toContain("tune the radio");
    expect(screen).toMatch(/CH \d+|EMERGENCY|MILITARY|CIVILIAN|HAM|UNKNOWN/); // channel/family tags present
    // No engine dial ever surfaces: threat, grid, progression, globalThreat are never named.
    expect(/threat|progression|powerGrid|globalThreat|zombieDensity/i.test(screen)).toBe(false);
    // Strength is a word, never a bar/percent.
    expect(/\bLIVE\b|\bFAINT\b|DEAD AIR/.test(screen)).toBe(true);
  });
});

// --- a play beat: the network evolves; broadcasting is loud -----------------------------------

describe("a radio play beat over shipped Rivermouth", () => {
  it("a listen is a resolved, world-advancing turn (no no-op)", () => {
    const { state, graph } = run();
    const res = listenAt(withRadio(state), graph);
    expect(res.state.meta.turn).toBe(state.meta.turn + 1);
    expect(res.changed.length).toBeGreaterThan(0);
    expect(res.state.history.some((h) => h.type === "radio.tuned")).toBe(true);
  });

  it("a station goes dark when its region falls — the on-air read reflects it", () => {
    const { state, graph } = run();
    const evac = signals.find((s) => s.id === "radio.military.evac-stadium")!;
    const region = evac.regionId!;
    const live = withRadio(state);
    expect(signalStatus(live, evac)).toBe("live"); // Hillcrest holds at the start
    // A fallen district (well past the fall threshold so the world-sim can't drift it back this turn).
    const fallen: GameState = { ...live, regions: { ...live.regions, [region]: { ...live.regions[region]!, threat: 95 } } };
    expect(signalStatus(fallen, evac)).toBe("dead");
    const read = audibleSignals(fallen, graph).find((r) => r.def.id === evac.id)!;
    expect(read.strength).toBe("dead");
    expect(renderSignalRead(fallen, read)).toContain("dead air"); // it lists as dead air, still on the dial
  });

  it("broadcasting is a loud, unknown-audience risk — it lights up the node", () => {
    const { state, graph } = run();
    const s = withRadio(state);
    const res = applyAction(s, availableActions(s, graph).find((c) => c.id === "broadcast")!.action, graph);
    expect(res.state.nodes[res.state.player.location]!.noise).toBe(BROADCAST_NOISE);
    expect(res.state.history.some((h) => h.type === "radio.broadcast")).toBe(true);
    expect(renderScene(res.scene, res.state).join("\n")).toContain("put your voice out");
  });

  it("the emergency loop reaches dead air within a survivable run (reachable evolution)", () => {
    const { state, graph } = run();
    const eas = signals.find((s) => s.id === "radio.emergency.eas")!;
    expect(signalStatus(state, eas)).toBe("live"); // day 1, grid full
    // Its shelf life elapses at a day count a run can reach — no hand-forced dials.
    const late: GameState = { ...withRadio(state), meta: { ...state.meta, day: eas.onsetDay + (eas.lifespanDays ?? 0) + 1 } };
    expect(signalStatus(late, eas)).toBe("dead");
    const read = audibleSignals(late, graph).find((r) => r.def.id === eas.id)!;
    expect(read.strength).toBe("dead");
    expect(renderSignalRead(late, read)).toContain("dead air"); // decays to a dead-air row, still listed
  });

  it("the anomaly is reachable in a shipped deadly district at night, and surfaces only once", () => {
    const { state, graph } = run();
    const anom = signals.find((s) => s.anomaly === true)!;
    // A REACHABLE state — standing in the hospital district (shipped baseline threat 80) at night with a
    // radio. No hand-forced threat: the gate is met by content the game actually ships.
    const inMercy = withRadio(state);
    const deep: GameState = {
      ...inMercy,
      player: { ...inMercy.player, location: "node.mercy-hospital.ambulance-bay" },
      meta: { ...state.meta, phase: "night" },
    };
    expect(deep.regions["region.mercy-hospital"]!.threat).toBeGreaterThanOrEqual(ANOMALY_THREAT); // shipped, not forced
    expect(audibleSignals(deep, graph).some((r) => r.def.id === anom.id)).toBe(true);
    const heard = resolveRadioAction(deep, graph, { type: "listen-radio", choiceId: "listen-radio", timeCost: 1 });
    const later = { ...heard, meta: { ...heard.meta, turn: heard.meta.turn + 5 } };
    expect(audibleSignals(later, graph).some((r) => r.def.id === anom.id)).toBe(false); // once per run
  });
});
