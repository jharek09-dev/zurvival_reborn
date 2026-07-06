import { SAVE_SCHEMA_VERSION, type GameState, type NodeId } from "./types.js";

export interface InitialStateOptions {
  /** Run seed — sole origin of all randomness (DESIGN §9). */
  readonly seed: string;
  /**
   * ISO-8601 creation timestamp, supplied by the CLIENT (the core never reads a
   * clock — `Date.now` is banned in `engine/` per ADR-0001).
   */
  readonly createdAt: string;
  /** Starting node; content-defined. Defaults to a placeholder until T6 lands content. */
  readonly startLocation?: NodeId;
}

/**
 * The empty-but-valid GameState a new run begins from (M0 scope: no gameplay, no
 * content beyond a placeholder start node id). Every field of the full shape is
 * present so saves are versioned and round-trippable from the first format (T7).
 */
export function createInitialState(opts: InitialStateOptions): GameState {
  return {
    meta: {
      version: SAVE_SCHEMA_VERSION,
      seed: opts.seed,
      createdAt: opts.createdAt,
      day: 1,
      hour: 6,
      phase: "dawn",
      turn: 0,
    },
    player: {
      condition: {
        needs: { hunger: 0, thirst: 0, fatigue: 0 },
        wounds: [],
        infection: { stage: "none", progression: 0 },
        mind: { stress: 0, morale: 70 },
      },
      // A modest starting kit buffers the opening so the survival clock (T22) is pressure, not a
      // guillotine — it runs out, and then you must scavenge (FR-CORE-02 · GDD V).
      inventory: [
        { type: "item.water", quantity: 2 },
        { type: "item.canned-food", quantity: 2 },
      ],
      equipment: {},
      skills: {},
      traits: [],
      location: opts.startLocation ?? "node.start",
      shelterId: null,
      reputation: {},
      quests: [],
      flags: {},
    },
    world: {
      weather: "weather.clear",
      season: "autumn",
      powerGrid: 100,
      water: 100,
      military: 100,
      broadcasts: [],
      globalThreat: 0,
      knownSafeZones: [],
      flags: {},
    },
    regions: {},
    nodes: {},
    routes: {},
    actors: {},
    groups: {},
    hordes: [],
    items: {},
    story: { progress: {}, lore: [], endingFlags: {}, mysteries: {} },
    history: [],
    queue: [],
    rng: { streams: {} },
    combat: null,
  };
}
