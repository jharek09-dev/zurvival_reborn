import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  neighborsOf,
  ZOMBIE_SCREAMER,
  ZOMBIE_STALKER,
  ZOMBIE_FRESH,
  ZOMBIE_CRAWLER,
  ZOMBIE_BLOATED,
  ZOMBIE_RIOT,
  ZOMBIE_WALKER,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type Horde,
} from "../../engine/src/index.js";
import { describeSoundscape, soundscapeCaptions } from "../src/index.js";

/**
 * T55 — the soundscape (FR-AUD-01/02/06). The client-side Audio Director rendered as text: the five
 * adaptively-mixed layers become sparse sound-captions, and those captions are the non-audio equivalent
 * a sound-off player plays by. These tests prove the layers read the sim honestly, locate sound by
 * direction & distance, name every zombie's signature, scale the heartbeat with Fear, surface the
 * infection distortion fairly, stay sparse when the world is quiet, leak no number, and are a pure,
 * deterministic, side-effect-free function of (state, graph).
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const opts = { seed: "soundscape-rivermouth", createdAt: "2026-07-18T06:00:00.000Z" };
const base = (): { state: GameState; graph: RegionGraph } => startRun(opts, regions, nodes);

/** Strip the world to a guaranteed-quiet, safe day: no hordes, no dead near, no noise, clear, calm. */
function quiet(s: GameState): GameState {
  const nodes: Record<string, GameState["nodes"][string]> = {};
  for (const [id, n] of Object.entries(s.nodes)) {
    nodes[id] = { ...n, walkers: 0, zombieTypes: [], zombieState: "dormant", noise: 0, corpses: 0, damage: 0 };
  }
  return {
    ...s,
    meta: { ...s.meta, phase: "morning" },
    world: { ...s.world, weather: "weather.clear", globalThreat: 0 },
    regions: Object.fromEntries(Object.entries(s.regions).map(([k, r]) => [k, { ...r, threat: 0, fire: 0 }])),
    player: { ...s.player, condition: { ...s.player.condition, mind: { ...s.player.condition.mind, stress: 0 } } },
    hordes: [],
    nodes,
  };
}

const setNode = (s: GameState, id: string, patch: Partial<GameState["nodes"][string]>): GameState => ({
  ...s,
  nodes: { ...s.nodes, [id]: { ...s.nodes[id]!, ...patch } },
});

/** Two-hop layout from the start node: [start, oneHop, twoHop]. */
function layout(state: GameState, graph: RegionGraph): [string, string, string] {
  const start = state.player.location;
  const one = neighborsOf(graph, start)[0]!;
  const two = neighborsOf(graph, one).find((n) => n !== start)!;
  return [start, one, two];
}

// --- the bed & the Golden Rule (sparsity) --------------------------------------------------

describe("the ambient bed and the Golden Rule (AUDIO §5/§2.1)", () => {
  it("a quiet, safe turn is just the bed and the body — no threat captions", () => {
    const { state, graph } = base();
    const lines = soundscapeCaptions(quiet(state), graph);
    expect(lines.length).toBeGreaterThanOrEqual(2); // never empty: bed + heartbeat at minimum
    expect(lines.length).toBeLessThanOrEqual(4); // sparse: no wall of text on a calm turn
    expect(lines.some((l) => l.includes("heartbeat"))).toBe(true); // the level-0 floor is the heart
    expect(lines.some((l) => l.startsWith("["))).toBe(false); // no informational threat cue when nothing is there
  });

  it("the bed reflects weather as information — rain/fog pull detail back (§5.3)", () => {
    const { state, graph } = base();
    const rain = soundscapeCaptions({ ...quiet(state), world: { ...quiet(state).world, weather: "weather.rain" } }, graph);
    expect(rain[0]!.toLowerCase()).toMatch(/rain|blur/);
    const fog = soundscapeCaptions({ ...quiet(state), world: { ...quiet(state).world, weather: "weather.fog" } }, graph);
    expect(fog[0]!.toLowerCase()).toMatch(/fog|muffl/);
  });

  it("the shelter has its own night tone (§5.4)", () => {
    const { state, graph } = base();
    const inShelter = { ...quiet(state), meta: { ...state.meta, phase: "night" as const }, player: { ...state.player, shelterId: state.player.location } };
    expect(soundscapeCaptions(inShelter, graph)[0]!.toLowerCase()).toMatch(/shelter|walls|night-tone/);
  });
});

// --- direction & distance (FR-AUD-02, the positional read) ---------------------------------

describe("noise located by direction & distance (FR-AUD-02 · AUDIO §6.1)", () => {
  it("a loud spike two hops away reads with distance AND a known direction", () => {
    const { state, graph } = base();
    const [, one, two] = layout(state, graph);
    let s = quiet(state);
    s = setNode(s, one, { discovered: true }); // the way there is known → the bearing can be named
    s = setNode(s, two, { noise: 90 });
    const cue = soundscapeCaptions(s, graph).find((l) => l.startsWith("[") && l.includes("sound"))!;
    expect(cue).toBeDefined();
    expect(cue).toContain("near"); // two hops
    expect(cue).toContain(`toward ${graph.nodes[one]!.name}`); // direction through the discovered neighbour
  });

  it("is fair to the fog — an unknown direction is never named, only the distance", () => {
    const { state, graph } = base();
    const [, one, two] = layout(state, graph);
    let s = quiet(state);
    s = setNode(s, one, { discovered: false }); // the way there is NOT known
    s = setNode(s, two, { noise: 90 });
    const cue = soundscapeCaptions(s, graph).find((l) => l.startsWith("[") && l.includes("sound"))!;
    expect(cue).toBeDefined();
    expect(cue).not.toContain("toward"); // never spell out an unvisited place
  });

  it("a footstep-quiet source does not carry — only loud sound travels", () => {
    const { state, graph } = base();
    const [, one, two] = layout(state, graph);
    // a small ambient noise (like a footstep, well under a gunshot) two hops out is inaudible.
    const s = setNode(setNode(quiet(state), one, { discovered: true }), two, { noise: 12 });
    expect(soundscapeCaptions(s, graph).some((l) => l.includes("sound"))).toBe(false);
  });

  it("a loud node is surfaced as a Safety cost you can hear — honest about the place, not who made it (§6.1)", () => {
    const { state, graph } = base();
    const s = setNode(quiet(state), state.player.location, { noise: 60 });
    // The node's noise can be your own or an external cascade, so the cue speaks to the *place* being loud
    // (which pulls things toward you) rather than blaming the player — the fair, non-misleading read.
    expect(soundscapeCaptions(s, graph).some((l) => l.toLowerCase().includes("loud here") && l.toLowerCase().includes("pulls things"))).toBe(true);
  });
});

// --- zombie signatures (FR-AUD-02 · AUDIO §6.2) --------------------------------------------

describe("zombie-type signatures — you can close your eyes and know what's out there (§6.2)", () => {
  const cases: [string, string, RegExp][] = [
    ["walker", ZOMBIE_WALKER, /drag of walkers/],
    ["fresh", ZOMBIE_FRESH, /sprinting breath/],
    ["crawler", ZOMBIE_CRAWLER, /scrape .*ankle|nails on concrete/],
    ["bloated", ZOMBIE_BLOATED, /straining gurgle/],
    ["riot", ZOMBIE_RIOT, /clank of armour/],
  ];
  it.each(cases)("names the %s's tell when it is on your node", (_name, id, tell) => {
    const { state, graph } = base();
    const s = setNode(quiet(state), state.player.location, { zombieTypes: [id], zombieState: "wandering" });
    expect(soundscapeCaptions(s, graph).join(" ")).toMatch(tell);
  });

  it("a roused Screamer is the region-waking shriek — the signature stinger (§6.2/§8)", () => {
    const { state, graph } = base();
    const [, one] = layout(state, graph);
    const s = setNode(setNode(quiet(state), one, { discovered: true }), one, { zombieTypes: [ZOMBIE_SCREAMER], zombieState: "chasing" });
    const line = soundscapeCaptions(s, graph).find((l) => l.includes("shriek"))!;
    expect(line).toBeDefined();
    expect(line).toContain("the whole area just woke");
  });

  it("a Screamer that has not roused is only a restless rasp, not the shriek", () => {
    const { state, graph } = base();
    const s = setNode(quiet(state), state.player.location, { zombieTypes: [ZOMBIE_SCREAMER], zombieState: "dormant" });
    const text = soundscapeCaptions(s, graph).join(" ");
    expect(text).toMatch(/restless, building rasp/);
    expect(text).not.toContain("shriek");
  });

  it("a Stalker at night near you is wrongness in the quiet, not a loud cue (§6.2)", () => {
    const { state, graph } = base();
    const s = setNode({ ...quiet(state), meta: { ...state.meta, phase: "night" } }, state.player.location, { zombieTypes: [ZOMBIE_STALKER], zombieState: "dormant" });
    expect(soundscapeCaptions(s, graph).some((l) => l.toLowerCase().includes("displaced"))).toBe(true);
  });
});

// --- behavioural state reads & hordes ------------------------------------------------------

describe("behavioural state reads and the horde bed (§6.2)", () => {
  it("reads a node turning toward you / chasing / feeding", () => {
    const { state, graph } = base();
    const here = state.player.location;
    const invest = soundscapeCaptions(setNode(quiet(state), here, { walkers: 2, zombieState: "investigating" }), graph).join(" ");
    expect(invest).toContain("turned toward you");
    const chase = soundscapeCaptions(setNode(quiet(state), here, { walkers: 2, zombieState: "chasing" }), graph).join(" ");
    expect(chase.toLowerCase()).toMatch(/coming|tightens/);
    const feed = soundscapeCaptions(setNode(quiet(state), here, { walkers: 2, corpses: 1, zombieState: "feeding" }), graph).join(" ");
    expect(feed.toLowerCase()).toContain("feeding");
  });

  it("a horde swells by distance, and one on your node is dire", () => {
    const { state, graph } = base();
    const [start, one] = layout(state, graph);
    const horde: Horde = { id: "horde.x", size: 24, pos: one, dest: null, speed: 1, awareness: 2, types: [ZOMBIE_WALKER] };
    const near = soundscapeCaptions({ ...setNode(quiet(state), one, { discovered: true }), hordes: [horde] }, graph).join(" ");
    expect(near.toLowerCase()).toContain("mass of the dead");
    const onYou = soundscapeCaptions({ ...quiet(state), hordes: [{ ...horde, pos: start }] }, graph).join(" ");
    expect(onYou.toLowerCase()).toContain("on you");
  });
});

// --- the body: heartbeat with Fear, and the infection distortion ---------------------------

describe("the player body — heartbeat scales with Fear, no number (§6.4 · FR-UI-02)", () => {
  it("steady when safe, slamming under a fight at night — and never a stress number", () => {
    const { state, graph } = base();
    const calm = describeSoundscape(quiet(state), graph).body.join(" ");
    expect(calm.toLowerCase()).toContain("steady");
    const terrified = {
      ...quiet(state),
      meta: { ...state.meta, phase: "night" as const },
      combat: { node: state.player.location, enemy: "enemy.walker", hp: 5, maxHp: 5, alerted: true },
      player: { ...state.player, condition: { ...state.player.condition, mind: { ...state.player.condition.mind, stress: 85 } } },
    };
    const body = describeSoundscape(terrified, graph).body.join(" ");
    expect(body.toLowerCase()).toMatch(/panic|slams|loud/);
    // no digits anywhere in the body layer — Fear is words, never the 0–100 int.
    expect(body).not.toMatch(/\d/);
  });

  it("surfaces infection distortion by stage — fairly, and never a number (§9.2)", () => {
    const { state, graph } = base();
    const at = (stage: GameState["player"]["condition"]["infection"]["stage"]) =>
      soundscapeCaptions({ ...quiet(state), player: { ...state.player, condition: { ...state.player.condition, infection: { stage, progression: 99 } } } }, graph).join(" ");
    expect(at("none")).not.toMatch(/fever|swim|pulled back/);
    expect(at("symptomatic").toLowerCase()).toContain("fever-hum");
    expect(at("advanced").toLowerCase()).toContain("can't trust your ears");
    expect(at("terminal").toLowerCase()).toContain("pulled back to your breath");
    // the hidden progression int is never shown.
    expect(at("advanced")).not.toContain("99");
    expect(at("terminal")).not.toContain("progression");
  });
});

// --- the tone / music band (FR-AUD-01) -----------------------------------------------------

describe("the music/tone band is a mood word, silence at level-0 (AUDIO §4)", () => {
  it("renders no tone line on a dead-quiet, fully-searched safe node (level-0 is silence)", () => {
    const { state, graph } = base();
    const s = setNode(quiet(state), state.player.location, { searchPct: 100 });
    expect(describeSoundscape(s, graph).tone).toBeNull();
  });

  it("words danger when a fight is on, never a track name or a number", () => {
    const { state, graph } = base();
    const s = { ...quiet(state), combat: { node: state.player.location, enemy: "enemy.walker", hp: 5, maxHp: 5, alerted: true } };
    const tone = describeSoundscape(s, graph).tone ?? "";
    expect(tone.length).toBeGreaterThan(0);
    expect(tone).not.toMatch(/\d/);
  });
});

// --- the mix tracks real danger, proximity-graded (audit fixes · FR-AUD-01/02) -------------

describe("Fear and music read the real danger, proximity-graded", () => {
  it("a daytime chase on your node is never 'steady' — the heartbeat reads the danger (§6.4)", () => {
    const { state, graph } = base();
    const body = describeSoundscape(setNode(quiet(state), state.player.location, { walkers: 2, zombieState: "chasing" }), graph).body.join(" ").toLowerCase();
    expect(body).toMatch(/loud|slams|panic/);
    expect(body).not.toContain("steady");
  });

  it("an active fight is never 'steady' (a floor on Fear)", () => {
    const { state, graph } = base();
    const s = { ...quiet(state), combat: { node: state.player.location, enemy: "enemy.walker", hp: 5, maxHp: 5, alerted: true } };
    expect(describeSoundscape(s, graph).body.join(" ").toLowerCase()).not.toContain("steady");
  });

  it("Danger builds with proximity — an approaching horde is milder than one on your tile (§4.3)", () => {
    const { state, graph } = base();
    const [start, one, two] = layout(state, graph);
    const horde = (pos: string): Horde => ({ id: "h", size: 24, pos, dest: null, speed: 1, awareness: 2, types: [ZOMBIE_WALKER] });
    const far = (describeSoundscape({ ...setNode(quiet(state), one, { discovered: true }), hordes: [horde(two)] }, graph).tone ?? "").toLowerCase();
    const onYou = (describeSoundscape({ ...quiet(state), hordes: [horde(start)] }, graph).tone ?? "").toLowerCase();
    expect(onYou).toContain("nowhere left to hide"); // L4 — reserved for a threat on top of you
    expect(far).not.toContain("nowhere left to hide"); // it builds, never pinned to the peak
  });

  it("the urgency cap keeps the read ≤ 8 lines and never buries the most critical cue", () => {
    const { state, graph } = base();
    // pile many audible hordes onto nodes within 2 hops, plus a chase on your own node.
    const near = new Set<string>();
    for (const a of neighborsOf(graph, state.player.location)) { near.add(a); for (const b of neighborsOf(graph, a)) if (b !== state.player.location) near.add(b); }
    const hordes: Horde[] = [...near].map((pos, i) => ({ id: `h${i}`, size: 24, pos, dest: null, speed: 1, awareness: 2, types: [ZOMBIE_WALKER] }));
    const s = { ...setNode(quiet(state), state.player.location, { walkers: 2, zombieState: "chasing" }), hordes };
    const dyn = describeSoundscape(s, graph).dynamic;
    expect(dyn.length).toBeLessThanOrEqual(8);
    expect(dyn.some((l) => l.includes("coming") || l.includes("tightens"))).toBe(true); // the chase survives the cap
  });

  it("a horde on your node reads its size, not a generic mass", () => {
    const { state, graph } = base();
    const big = describeSoundscape({ ...quiet(state), hordes: [{ id: "h", size: 30, pos: state.player.location, dest: null, speed: 1, awareness: 2, types: [ZOMBIE_WALKER] }] }, graph).dynamic.join(" ").toLowerCase();
    expect(big).toContain("great mass");
    expect(big).toContain("on you");
  });
});

// --- determinism, purity, accessibility hygiene --------------------------------------------

describe("pure, deterministic, side-effect-free (AUDIO §13.3)", () => {
  it("same (state, graph) ⇒ identical captions, and rendering mutates nothing", () => {
    const { state, graph } = base();
    const s = setNode({ ...quiet(state), meta: { ...state.meta, phase: "night" } }, state.player.location, { walkers: 3, zombieTypes: [ZOMBIE_FRESH], zombieState: "chasing" });
    const before = JSON.stringify(s);
    const a = soundscapeCaptions(s, graph);
    const b = soundscapeCaptions(s, graph);
    expect(a).toStrictEqual(b);
    expect(JSON.stringify(s)).toBe(before); // no write to GameState
  });

  it("degrades without a graph to the node-local bed/body, no crash, still ≥ 2 lines", () => {
    const { state } = base();
    const lines = soundscapeCaptions(setNode(quiet(state), state.player.location, { walkers: 2, zombieState: "chasing" }));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => /heart|pulse/.test(l))).toBe(true); // the body's heartbeat line is always present, whatever the band
  });

  it("emits zero ANSI, and never leaks an engine field name", () => {
    const { state, graph } = base();
    const rich = setNode({ ...quiet(state), meta: { ...state.meta, phase: "night" }, world: { ...state.world, weather: "weather.storm", globalThreat: 80 } }, state.player.location, { walkers: 6, zombieTypes: [ZOMBIE_BLOATED], zombieState: "chasing", noise: 70 });
    const text = soundscapeCaptions(rich, graph).join("\n");
    expect(text).not.toMatch(/\x1b\[/); // no color; meaning is always in words
    expect(text).not.toMatch(/threat|progression|powerGrid|globalThreat|zombieDensity/i); // no raw system fields
  });

  it("does not crash on a run-over state", () => {
    const { state, graph } = base();
    const dead = { ...quiet(state), player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 100, thirst: 100, fatigue: 100 } } } };
    expect(() => soundscapeCaptions(dead, graph)).not.toThrow();
  });
});
