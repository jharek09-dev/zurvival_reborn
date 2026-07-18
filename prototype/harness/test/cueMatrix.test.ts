import { describe, expect, it } from "vitest";
import {
  startRun,
  REPATH_NOISE,
  WEATHER_RAIN,
  WEATHER_STORM,
  WEATHER_FOG,
  WEATHER_SNOW,
  WEATHER_WIND,
  ZOMBIE_WALKER,
  ZOMBIE_FRESH,
  ZOMBIE_CRAWLER,
  ZOMBIE_BLOATED,
  ZOMBIE_RIOT,
  ZOMBIE_SCREAMER,
  ZOMBIE_STALKER,
  type GameState,
  type RegionGraph,
  type NodeDef,
  type RegionDef,
  type NodeState,
  type RegionState,
  type Horde,
  type Wound,
  type InfectionStage,
} from "../../engine/src/index.js";
import { CUE_MATRIX, CUE_CHANNELS, renderCueMatrix, soundscapeCaptions, describeSoundscape, type CueChannel } from "../src/index.js";

/**
 * T56 pt 2 — the FR-AUD-06 cue-redundancy matrix acceptance (Must). Proves EVERY meaningful sound cue in
 * `CUE_MATRIX` actually surfaces as text when it fires (not silently dropped), across all five soundscape
 * layers. A sound-off player reads exactly what a hearing player hears — the redundancy is structural (the
 * captions are the only channel), this is the tracked, end-to-end proof.
 */

const A = "node.x.a";
const B = "node.x.b";
const C = "node.x.c";
const REGIONS: RegionDef[] = [
  { id: "region.x", name: "X", description: "x", baseline: { zombieDensity: 0, threat: 0, survivorActivity: 0, loot: 60 } },
];
const NODES: NodeDef[] = [
  { id: A, regionId: "region.x", name: "A", description: "a", adjacent: [B], start: true, kind: "store" },
  { id: B, regionId: "region.x", name: "B", description: "b", adjacent: [A, C], kind: "residential" },
  { id: C, regionId: "region.x", name: "C", description: "c", adjacent: [B], kind: "medical" },
];
const opts = { seed: "cuematrix", createdAt: "2026-07-18T12:00:00.000Z" };
type Run = { state: GameState; graph: RegionGraph };
// startRun seeds starter hordes; strip them so a scenario is calm unless it says otherwise (the horde
// scenarios set their own). A truly calm base is what the level-0 / exploration / heartbeat-0 cues need.
const base = (): Run => {
  const r = startRun(opts, REGIONS, NODES) as Run;
  return { graph: r.graph, state: { ...r.state, hordes: [] } };
};

// --- mutators (spread over the readonly state; graph unchanged) ------------------------------
const patchNode = (b: Run, id: string, patch: Partial<NodeState>): Run => ({
  ...b,
  state: { ...b.state, nodes: { ...b.state.nodes, [id]: { ...b.state.nodes[id]!, ...patch } } },
});
const patchRegion = (b: Run, patch: Partial<RegionState>): Run => ({
  ...b,
  state: { ...b.state, regions: { ...b.state.regions, "region.x": { ...b.state.regions["region.x"]!, ...patch } } },
});
const patchWorld = (b: Run, patch: Partial<GameState["world"]>): Run => ({ ...b, state: { ...b.state, world: { ...b.state.world, ...patch } } });
const setPhase = (b: Run, phase: GameState["meta"]["phase"]): Run => ({ ...b, state: { ...b.state, meta: { ...b.state.meta, phase } } });
const setStress = (b: Run, stress: number): Run => ({ ...b, state: { ...b.state, player: { ...b.state.player, condition: { ...b.state.player.condition, mind: { ...b.state.player.condition.mind, stress } } } } });
const setNeeds = (b: Run, patch: Partial<GameState["player"]["condition"]["needs"]>): Run => ({ ...b, state: { ...b.state, player: { ...b.state.player, condition: { ...b.state.player.condition, needs: { ...b.state.player.condition.needs, ...patch } } } } });
const setInfection = (b: Run, stage: InfectionStage): Run => ({ ...b, state: { ...b.state, player: { ...b.state.player, condition: { ...b.state.player.condition, infection: { stage, progression: 55 } } } } });
const addWound = (b: Run): Run => {
  const w: Wound = { type: "wound.laceration", site: "left arm", severity: 45, treated: 0, inflictedDay: 1 };
  return { ...b, state: { ...b.state, player: { ...b.state.player, condition: { ...b.state.player.condition, wounds: [w] } } } };
};
const shelterHere = (b: Run): Run => ({ ...b, state: { ...b.state, player: { ...b.state.player, shelterId: A } } });
const addHorde = (b: Run, pos: string, size: number): Run => {
  const h: Horde = { id: "horde.1", size, pos, dest: null, speed: 1, awareness: 1, types: [] };
  return { ...b, state: { ...b.state, hordes: [h] } };
};
const discover = (b: Run, id: string): Run => patchNode(b, id, { discovered: true });

// --- the triggering scenario for each CUE_MATRIX id -----------------------------------------
const SCENARIOS: { readonly [id: string]: () => Run } = {
  // bed
  "bed.day": () => setPhase(base(), "midday"),
  "bed.evening": () => setPhase(base(), "evening"),
  "bed.night": () => setPhase(base(), "night"),
  "bed.onEdge": () => patchRegion(setPhase(base(), "midday"), { threat: 60 }),
  "bed.shelterDay": () => shelterHere(setPhase(base(), "midday")),
  "bed.shelterNight": () => shelterHere(setPhase(base(), "night")),
  "bed.rain": () => patchWorld(base(), { weather: WEATHER_RAIN }),
  "bed.storm": () => patchWorld(base(), { weather: WEATHER_STORM }),
  "bed.fog": () => patchWorld(base(), { weather: WEATHER_FOG }),
  "bed.snow": () => patchWorld(base(), { weather: WEATHER_SNOW }),
  "bed.wind": () => patchWorld(base(), { weather: WEATHER_WIND }),
  "bed.powerOut": () => patchWorld(base(), { powerGrid: 10 }),
  // environmental
  "env.fire": () => patchRegion(base(), { fire: 55 }),
  "env.corpses": () => patchNode(base(), A, { corpses: 3 }),
  "env.barricades": () => patchNode(shelterHere(base()), A, { barricades: 50 }),
  "env.damage": () => patchNode(base(), A, { damage: 70 }),
  // dynamic
  "dyn.screamer": () => discover(patchNode(base(), B, { zombieTypes: [ZOMBIE_SCREAMER], zombieState: "investigating" }), B),
  "dyn.hordeOnYou": () => addHorde(base(), A, 25),
  "dyn.hordeDistant": () => discover(addHorde(base(), B, 10), B),
  "dyn.chasing": () => patchNode(base(), A, { zombieState: "chasing" }),
  "dyn.investigating": () => patchNode(base(), A, { zombieState: "investigating" }),
  "dyn.feeding": () => patchNode(base(), A, { zombieState: "feeding" }),
  "dyn.tell.walker": () => patchNode(base(), A, { zombieTypes: [ZOMBIE_WALKER] }),
  "dyn.tell.fresh": () => patchNode(base(), A, { zombieTypes: [ZOMBIE_FRESH] }),
  "dyn.tell.crawler": () => patchNode(base(), A, { zombieTypes: [ZOMBIE_CRAWLER] }),
  "dyn.tell.bloated": () => patchNode(base(), A, { zombieTypes: [ZOMBIE_BLOATED] }),
  "dyn.tell.riot": () => patchNode(base(), A, { zombieTypes: [ZOMBIE_RIOT] }),
  "dyn.tell.screamerLatent": () => patchNode(base(), A, { zombieTypes: [ZOMBIE_SCREAMER], zombieState: "dormant" }),
  "dyn.stalkerNight": () => patchNode(setPhase(base(), "night"), A, { zombieTypes: [ZOMBIE_STALKER] }),
  "dyn.walkerMoan": () => patchNode(base(), A, { walkers: 3 }),
  "dyn.nodeLoud": () => patchNode(base(), A, { noise: REPATH_NOISE + 20 }),
  "dyn.noiseSpike": () => discover(patchNode(base(), B, { noise: 85 }), B),
  // body
  "body.heartbeat0": () => setStress(base(), 0),
  "body.heartbeat1": () => setStress(base(), 35),
  "body.heartbeat2": () => setStress(base(), 60),
  "body.heartbeat3": () => setStress(base(), 90),
  "body.breath": () => setNeeds(base(), { fatigue: 70 }),
  "body.breathWound": () => addWound(base()),
  "body.footstepsSnow": () => patchWorld(base(), { weather: WEATHER_SNOW }),
  "body.infectSymptomatic": () => setInfection(base(), "symptomatic"),
  "body.infectAdvanced": () => setInfection(base(), "advanced"),
  "body.infectTerminal": () => setInfection(base(), "terminal"),
  // tone
  "tone.survival": () => patchRegion(base(), { threat: 30 }),
  "tone.exploration": () => base(), // fresh start: unsearched node, calm ⇒ exploration
  "tone.danger": () => patchNode(base(), A, { zombieState: "chasing" }),
  "tone.home": () => shelterHere(base()),
  "tone.loss": () => setNeeds(base(), { thirst: 100 }),
  "tone.silence": () => patchNode(base(), A, { searchPct: 100 }), // fully searched, calm ⇒ level-0 silence
};

describe("FR-AUD-06 cue-redundancy matrix — every meaningful sound cue surfaces as text (T56 pt 2, Must)", () => {
  it("has a triggering scenario for every matrix entry (test completeness)", () => {
    for (const entry of CUE_MATRIX) expect(SCENARIOS[entry.id], `missing scenario for ${entry.id}`).toBeTypeOf("function");
  });

  it("covers all five soundscape layers", () => {
    for (const ch of CUE_CHANNELS) {
      expect(CUE_MATRIX.some((c) => c.channel === ch), `no cue for channel ${ch}`).toBe(true);
    }
  });

  for (const entry of CUE_MATRIX) {
    it(`[${entry.channel}] ${entry.id} — "${entry.sound}" → surfaces its text equivalent`, () => {
      const { state, graph } = SCENARIOS[entry.id]!();
      if (entry.id === "tone.silence") {
        // Level-0 is authored silence: no tone line, the heartbeat carries it.
        expect(describeSoundscape(state, graph).tone).toBeNull();
        return;
      }
      const captions = soundscapeCaptions(state, graph).join("\n");
      expect(captions, `cue "${entry.id}" did not surface (looking for: ${entry.text})`).toContain(entry.text);
    });
  }

  it("DRIFT GUARD: every line the soundscape emits maps to a CUE_MATRIX entry — no cue can slip in untracked", () => {
    // The reverse of the per-cue proof: sweep a broad state battery, and assert every caption line the
    // soundscape produces is covered by some matrix entry's text/alt of that layer. A new soundscape cue
    // with no matrix row would surface here as an untracked line. (This is what makes "machine-checked
    // completeness" honest — not just "every LISTED cue surfaces" but "every EMITTED cue is listed".)
    const cover = (ch: CueChannel): string[] => CUE_MATRIX.filter((c) => c.channel === ch).flatMap((c) => [c.text, ...(c.alt ?? [])]);
    const bed = cover("bed"), env = cover("environmental"), dyn = cover("dynamic"), body = cover("body"), tone = cover("tone");
    const has = (line: string, texts: readonly string[]) => texts.some((t) => line.includes(t));
    // every per-cue scenario + composites that exercise the intensity/count/loudness variants (the alts).
    const composites: Run[] = [
      discover(patchNode(base(), B, { noise: 50 }), B), // adjacent mid spike → "a clatter of movement"
      discover(patchNode(base(), B, { noise: 38 }), B), // adjacent faint spike → "a faint scuff of sound"
      patchNode(base(), A, { walkers: 1 }), // the moan at count 1 → "one of the dead, shifting"
      patchRegion(setPhase(base(), "midday"), { threat: 60 }), // survival L2
      patchRegion(setPhase(base(), "midday"), { threat: 80 }), // survival L3
      patchRegion(setPhase(base(), "midday"), { threat: 95 }), // survival L4
      shelterHere(patchRegion(setPhase(base(), "night"), { threat: 60 })), // home L2 → "the walls feel thin tonight"
      addHorde(base(), A, 25), // danger L4 → "nowhere left to hide"
      (() => { const b = setInfection(patchWorld(shelterHere(setPhase(base(), "night")), { weather: WEATHER_STORM, powerGrid: 5 }), "symptomatic"); return setNeeds(addWound(b), { fatigue: 85 }); })(),
    ];
    const untracked = new Set<string>();
    for (const { state, graph } of [...CUE_MATRIX.map((e) => SCENARIOS[e.id]!()), ...composites]) {
      const s = describeSoundscape(state, graph);
      if (!has(s.bed, bed)) untracked.add(`[bed] ${s.bed}`);
      for (const l of s.environmental) if (!has(l, env)) untracked.add(`[environmental] ${l}`);
      for (const l of s.dynamic) if (!has(l, dyn)) untracked.add(`[dynamic] ${l}`);
      for (const l of s.body) if (!has(l, body)) untracked.add(`[body] ${l}`);
      if (s.tone !== null && !has(s.tone, tone)) untracked.add(`[tone] ${s.tone}`);
    }
    expect([...untracked], `untracked soundscape lines — add a CUE_MATRIX row (or an alt):\n${[...untracked].join("\n")}`).toHaveLength(0);
  });

  it("leaks no number — every cue is words, never a raw scalar (FR-UI-02 · NFR-ACC-01)", () => {
    for (const id of ["dyn.hordeDistant", "dyn.screamer", "body.heartbeat3", "tone.danger", "bed.onEdge"]) {
      const { state, graph } = SCENARIOS[id]!();
      expect(/[0-9]/.test(soundscapeCaptions(state, graph).join("\n")), `number leaked in ${id}`).toBe(false);
    }
  });

  it("is deterministic — the same state renders the same captions, and rendering mutates nothing", () => {
    const { state, graph } = SCENARIOS["dyn.hordeDistant"]!();
    const snap = JSON.stringify(state);
    const a = soundscapeCaptions(state, graph);
    const b = soundscapeCaptions(state, graph);
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(snap);
  });

  it("renders a Markdown matrix table covering every entry", () => {
    const md = renderCueMatrix();
    expect(md).toContain("# FR-AUD-06");
    for (const entry of CUE_MATRIX) expect(md, `matrix doc missing ${entry.id}`).toContain(entry.sound);
    expect(md).toContain(`**${CUE_MATRIX.length} cues**`);
  });
});
