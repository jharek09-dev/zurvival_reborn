import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  sceneOf,
  type GameState,
  type Survivor,
  type NodeDef,
  type RegionDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type HistoryEvent,
  type RegionGraph,
} from "../../engine/src/index.js";
import {
  DEPTH_SCREENS,
  SCREEN_KEYS,
  RESERVED_KEYS,
  SCREEN_BACK_HINT,
  screenForKey,
  screenById,
  renderDepthScreen,
  renderInventory,
  renderCompanions,
  renderShelter,
  renderMap,
  renderCodex,
  parseCommand,
  playByInputs,
  playSession,
  transcript,
  type ScreenId,
} from "../src/index.js";

/**
 * T54 — on-demand depth screens (FR-UI-04 · GDD XVII). Proves the five drill-down views exist, are
 * keyboard-reachable, carry every fact in words (no ANSI, no number leaks), and are *free* overlays:
 * opening one resolves no turn and mutates no state. Uses shipped Rivermouth with all content pools
 * registered (as the playable client does), plus hand-built fixtures for the richer states.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const npcs = load<NPCDef>("npcs");
const encounters = load<EncounterDef>("encounters");
const signals = load<SignalDef>("radio");
const recipes = load<RecipeDef>("recipes");
const jobs = load<JobDef>("jobs");
const factions = load<FactionDef>("factions");

/** A run with every content pool registered — the full playable client's world. */
function base(): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed: "screens-rivermouth", createdAt: "2026-07-18T06:00:00.000Z" },
    regions,
    nodes,
    npcs,
    [],
    encounters,
    signals,
    recipes,
    jobs,
    factions,
  );
}

// --- fixtures for the richer states -----------------------------------------------------------

/** A companion standing with the player: wounded, feverish, trust below the order gate. */
function withCompanion(s: GameState): GameState {
  const c: Survivor = {
    id: "actor.test-marcus",
    type: "npc.marcus",
    name: "Marcus",
    trust: 55, // below ORDER_TRUST_MIN (80) → the ranged orders are trust-locked
    condition: {
      needs: { hunger: 40, thirst: 10, fatigue: 20 },
      wounds: [{ type: "wound.sprain", site: "left ankle", severity: 30, treated: 0, inflictedDay: 1 }],
      infection: { stage: "symptomatic", progression: 63 }, // a distinctive number that must NOT surface
      mind: { stress: 40, morale: 45 },
    },
    location: s.player.location,
    groupId: null,
    relationships: {},
    inventory: [],
    flags: { companion: true },
  };
  return { ...s, actors: { ...s.actors, [c.id]: c } };
}

/** Turn the player's current node into a claimed, partly-built base with stores. */
function withShelter(s: GameState): GameState {
  const sid = s.player.location;
  const node = s.nodes[sid]!;
  return {
    ...s,
    player: {
      ...s.player,
      shelterId: sid,
      stash: [
        { type: "item.canned-food", quantity: 4 },
        { type: "item.water", quantity: 3 },
      ],
    },
    nodes: { ...s.nodes, [sid]: { ...node, barricades: 60, rooms: ["room.kitchen", "room.workshop"] } },
  };
}

/** Pin a player note onto the current (discovered) node. */
function withNote(s: GameState): GameState {
  const id = s.player.location;
  const node = s.nodes[id]!;
  return { ...s, nodes: { ...s.nodes, [id]: { ...node, playerNotes: ["good water here ↓", "lost Marcus near the plaza?"] } } };
}

/** Append memorial-worthy Living-History events (a death and a desertion). */
function withHistory(s: GameState): GameState {
  const ev = (type: string, subjects: readonly string[], data: HistoryEvent["data"]): HistoryEvent => ({
    day: 4,
    hour: 22,
    turn: 30,
    type,
    subjects,
    data,
  });
  const events: HistoryEvent[] = [
    ev("npc.met", ["npc.sarah"], { name: "Sarah" }),
    ev("companion.died", ["actor.sarah"], {}),
    ev("social.deserted", ["actor.tom"], {}),
    ev("social.confided", ["actor.cass"], { name: "Cass" }),
  ];
  return { ...s, history: [...s.history, ...events] };
}

/** Give the player a working radio. */
function withRadio(s: GameState): GameState {
  return { ...s, player: { ...s.player, inventory: [...s.player.inventory, { type: "item.radio", quantity: 1 }] } };
}

/** Give the player a tracked artifact with provenance. */
function withArtifact(s: GameState): GameState {
  return {
    ...s,
    player: { ...s.player, inventory: [...s.player.inventory, { type: "item.axe", quantity: 1, itemId: "axe-1" }] },
    items: { ...s.items, "axe-1": { type: "item.axe", quality: 80, durability: 70, metadata: { origin: "the fire station", repairs: 2 } } },
  };
}

const ALL: readonly ScreenId[] = ["inventory", "companions", "shelter", "map", "codex"];
const renderAll = (s: GameState, g: RegionGraph): string => ALL.map((id) => renderDepthScreen(id, s, g).join("\n")).join("\n");

// --- registry & keyboard routing (reachable by key) -------------------------------------------

describe("the five depth screens are registered and keyboard-reachable (FR-UI-04 · NFR-ACC-02)", () => {
  it("registers exactly the five FR-UI-04 screens with distinct, non-reserved single-letter keys", () => {
    expect(DEPTH_SCREENS.map((d) => d.id)).toEqual(["inventory", "companions", "shelter", "map", "codex"]);
    const keys = DEPTH_SCREENS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length); // distinct
    for (const k of keys) {
      expect(k).toMatch(/^[a-z]$/); // one lowercase letter
      expect(RESERVED_KEYS).not.toContain(k); // never collides with save/quit
    }
    expect(SCREEN_KEYS).toEqual(keys);
  });

  it("parseCommand routes each screen key to its screen, and leaves the existing verbs intact", () => {
    const { state, graph } = base();
    const scene = sceneOf(state, graph);
    for (const d of DEPTH_SCREENS) {
      expect(parseCommand(scene, d.key)).toEqual({ kind: "screen", screenId: d.id });
      expect(parseCommand(scene, d.key.toUpperCase())).toEqual({ kind: "screen", screenId: d.id }); // case-insensitive
    }
    // the primary verbs are unchanged (regression guard on T19/T20).
    expect(parseCommand(scene, "1")).toEqual({ kind: "choice", choiceId: scene.choices[0]!.id });
    expect(parseCommand(scene, "s").kind).toBe("save");
    expect(parseCommand(scene, "q").kind).toBe("quit");
    expect(parseCommand(scene, "z").kind).toBe("invalid"); // a non-screen letter is still invalid
    expect(parseCommand(scene, "999").kind).toBe("invalid");
  });

  it("screenForKey / screenById round-trip", () => {
    for (const d of DEPTH_SCREENS) {
      expect(screenForKey(d.key)!.id).toBe(d.id);
      expect(screenById(d.id).key).toBe(d.key);
    }
    expect(screenForKey("z")).toBeUndefined();
  });
});

// --- accessibility: words only, no ANSI, stable frame (NFR-ACC-01/02) -------------------------

describe("every screen carries its facts in plain words (NFR-ACC-01)", () => {
  it("renders zero ANSI escape codes across a rich state", () => {
    const { state, graph } = base();
    const s = withArtifact(withRadio(withHistory(withNote(withShelter(withCompanion(state))))));
    expect(renderAll(s, graph)).not.toMatch(/\x1b\[/);
  });

  it("each screen has the stable frame: a title bar first and the back hint last (NFR-ACC-02)", () => {
    const { state, graph } = base();
    const s = withShelter(withCompanion(state));
    for (const d of DEPTH_SCREENS) {
      const lines = renderDepthScreen(d.id, s, graph);
      expect(lines.length).toBeGreaterThan(2);
      expect(lines[0]).toContain(`— ${d.title} —`); // the "pressed"/active screen, named in words
      expect(lines[lines.length - 1]).toBe(SCREEN_BACK_HINT); // a screen never traps you
    }
  });

  it("infection is a symptom, never a number (FR-UI-02)", () => {
    const { state, graph } = base();
    const text = renderCompanions(withCompanion(state), graph).join("\n");
    expect(text).toContain("feverish"); // the symptomatic word
    expect(text).not.toContain("63"); // the raw progression must never leak
    expect(text.toLowerCase()).not.toContain("progression");
  });

  it("trust is a tier in words, never the raw 0–100 scalar (FR-UI-02)", () => {
    const { state, graph } = base();
    const text = renderCompanions(withCompanion(state), graph).join("\n");
    expect(text).toMatch(/hostile|wary|neutral|warm|trusted/);
    expect(text).not.toMatch(/\b55\b/); // the raw trust value must not appear
  });
});

// --- free overlay: no turn resolves, no state changes -----------------------------------------

describe("opening a screen is free — no turn, no state change (FR-UI-01 kept intact)", () => {
  it("rendering a screen never mutates the state", () => {
    const { state, graph } = base();
    const s = withShelter(withCompanion(state));
    const before = JSON.stringify(s);
    for (const id of ALL) renderDepthScreen(id, s, graph);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("a screen key mid-play resolves no turn and yields a byte-identical transcript", () => {
    const { state, graph } = base();
    // "3, 3, 1" plays three turns; inserting screen keys must not change the played turns at all.
    const plain = playByInputs(state, graph, ["3", "3", "1"]);
    const withScreens = playByInputs(state, graph, ["i", "3", "c", "3", "m", "1", "l"]);
    expect(plain.session.turns.length).toBeGreaterThan(0);
    expect(withScreens.session.turns.length).toBe(plain.session.turns.length); // screens added no turns
    expect(transcript(withScreens.session)).toStrictEqual(transcript(plain.session));
    // and the keyboard path is recorded as reaching each screen, in order.
    expect(withScreens.screensViewed).toEqual(["inventory", "companions", "map", "codex"]);
    expect(plain.screensViewed).toEqual([]);
  });

  it("is deterministic — same state renders identically", () => {
    const a = base();
    const b = base();
    const sa = withShelter(withCompanion(a.state));
    const sb = withShelter(withCompanion(b.state));
    expect(renderAll(sa, a.graph)).toBe(renderAll(sb, b.graph));
  });
});

// --- each screen surfaces its purpose-built facts (SCR-03..07) --------------------------------

describe("Inventory (SCR-03) — weight, categories, artifact history", () => {
  it("states the pack load and groups items by category", () => {
    const { state, graph } = base();
    const text = renderInventory(state, graph).join("\n");
    expect(text).toMatch(/Pack: \d+\/40 weight/);
    expect(text).toContain("Food & water"); // a labelled category
    expect(text.toLowerCase()).toContain("no level here"); // the "growth is your pack" note
  });

  it("a full pack states the leave-behind in words", () => {
    const { state, graph } = base();
    const s = { ...state, player: { ...state.player, inventory: [{ type: "item.pistol", quantity: 5 }] } }; // 5*8 = 40 = full
    expect(renderInventory(s, graph).join("\n").toLowerCase()).toContain("leave something behind");
  });

  it("an artifact is flagged and carries its provenance", () => {
    const { state, graph } = base();
    const text = renderInventory(withArtifact(state), graph).join("\n");
    expect(text).toContain("[artifact]");
    expect(text).toContain("the fire station");
    expect(text).toContain("repaired 2 times");
  });
});

describe("Companions (SCR-04) — condition, trust, orders", () => {
  it("with no party, states you travel alone and how to recruit", () => {
    const { state, graph } = base();
    const text = renderCompanions(state, graph).join("\n");
    expect(text).toContain("You travel alone");
    expect(text.toLowerCase()).toContain("recruited");
  });

  it("names a companion, their condition, and the active order, and locks the gated orders in words", () => {
    const { state, graph } = base();
    const text = renderCompanions(withCompanion(state), graph).join("\n");
    expect(text).toContain("Marcus");
    expect(text).toContain("sprain"); // the wound, named
    expect(text).toContain("left ankle");
    expect(text).toContain("currently:"); // the active order named (the "pressed" state)
    expect(text.toLowerCase()).toContain("locked — needs their trust"); // the trust-locked state, in words
    expect(text).toMatch(/1 with you/);
  });

  it("never promises an action the engine won't perform on a companion (no dead 'ask them' affordance)", () => {
    const { state, graph } = base();
    const text = renderCompanions(withCompanion(state), graph).join("\n").toLowerCase();
    expect(text).not.toContain("ask them"); // the engine's `ask` verb is for met NPCs, not companions
  });

  it("gates scavenge on trust AND a base — a trusted companion with no base is base-locked, not available", () => {
    const { state, graph } = base();
    // trust 85 (≥ ORDER_TRUST_MIN) but no shelter claimed.
    const trusted = withCompanion({ ...state, player: { ...state.player, shelterId: null } });
    const c = trusted.actors["actor.test-marcus"]!;
    const s: GameState = { ...trusted, actors: { ...trusted.actors, [c.id]: { ...c, trust: 85 } } };
    const text = renderCompanions(s, graph).join("\n").toLowerCase();
    expect(text).toContain("scavenge  [locked — needs a base"); // the real gate, not "needs their trust"
    expect(text).toMatch(/guard \(available\)/); // guard only needs trust, which is met
  });
});

describe("Shelter (SCR-05) — walls, rooms, jobs, report", () => {
  it("with no base, states none is claimed and how to claim", () => {
    const { state, graph } = base();
    const text = renderShelter(state, graph).join("\n");
    expect(text.toLowerCase()).toContain("not claimed a base");
    expect(text.toLowerCase()).toContain("claim");
  });

  it("with a base, states walls in words and lists built rooms and stores", () => {
    const { state, graph } = base();
    const text = renderShelter(withShelter(state), graph).join("\n");
    expect(text).toMatch(/walls: (sturdy|holding|thin|breached)/); // never a bar
    expect(text).toContain("kitchen");
    expect(text).toContain("workshop");
    expect(text.toLowerCase()).toContain("supplies banked");
  });

  it("'Could build' never lists an already-built room (the selector is unbuilt rooms, not built ones)", () => {
    const { state, graph } = base();
    const lines = renderShelter(withShelter(state), graph); // kitchen + workshop are built
    const cbIdx = lines.findIndex((l) => l === "Could build:");
    if (cbIdx === -1) return; // no buildable rooms in shipped content is acceptable
    const nextHeader = lines.findIndex((l, i) => i > cbIdx && /:$/.test(l) && !l.startsWith(" "));
    const cbBlock = lines.slice(cbIdx + 1, nextHeader === -1 ? undefined : nextHeader).join("\n");
    expect(cbBlock).not.toContain("kitchen (built)");
    expect(cbBlock).not.toMatch(/- kitchen —/); // kitchen is built, must not appear as buildable
    expect(cbBlock).not.toMatch(/- workshop —/);
  });
});

describe("Map & Journal (SCR-06) — fog, node memory, your notes", () => {
  it("states the fog percentage and marks where you are", () => {
    const { state, graph } = base();
    const text = renderMap(state, graph).join("\n");
    expect(text).toMatch(/of \d+ places known — fog over \d+% of the city/);
    expect(text).toContain("you are here");
  });

  it("surfaces the player's own handwritten notes", () => {
    const { state, graph } = base();
    const text = renderMap(withNote(state), graph).join("\n");
    expect(text).toContain('your note: "good water here');
  });
});

describe("Codex (SCR-07) — lore, radio, rumors, memorial", () => {
  it("needs a radio to hear the airwaves", () => {
    const { state, graph } = base();
    expect(renderCodex(state, graph).join("\n").toLowerCase()).toContain("no working radio");
    expect(renderCodex(withRadio(state), graph).join("\n")).toMatch(/Radio:\n {2}- .+ \(.+\) — /);
  });

  it("lists the dead and the departed by name in the memorial", () => {
    const { state, graph } = base();
    const text = renderCodex(withHistory(state), graph).join("\n");
    expect(text).toContain("Memorial");
    expect(text).toMatch(/† .*(sarah|companion)/i); // a death, marked
    expect(text.toLowerCase()).toContain("left in the night"); // the desertion
  });
});
