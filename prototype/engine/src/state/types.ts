/**
 * GameState — the single serializable state (M0 task T3 · PRD TEC-04 · DESIGN §4).
 *
 * Rules enforced here by construction:
 * - Everything is plain JSON: objects, arrays, strings, finite numbers, booleans, null.
 *   No Map/Set/Date/undefined/functions/classes — saves are `JSON.stringify(state)` (T7),
 *   and iteration-order hazards are kept out of the core (ADR-0001).
 * - Sim quantities are integers (ADR-0001 numeric discipline). Percent-like scales are
 *   0–100 ints unless noted.
 * - GameState stores content *ids*, never content copies (DESIGN §8, §12).
 * - Everything is `readonly`: pipeline stages are pure transforms (DESIGN §5).
 *
 * Fields for M1+ subsystems exist now with minimal structure, so the save schema is
 * versioned from the very first format (feeds ADR-0003, task T7).
 */

/** Bump on any breaking change to this shape; checked on load (DESIGN §9). */
export const SAVE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Any JSON-serializable value; used where content-driven data is intentionally open. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Content ids — plain strings referencing entries loaded from `content/` (ADR-0002). */
export type RegionId = string;
export type NodeId = string;
export type ActorId = string;
export type GroupId = string;
export type HordeId = string;
export type ItemInstanceId = string;
export type ContentId = string;

/** Discrete facts only — "prefer meaningful world state over flag sprawl" (DESIGN §7). */
export type Flags = { readonly [flag: string]: boolean };

/** Day phase; time cost per action moves through these (GDD IV). */
export type Phase = "dawn" | "morning" | "midday" | "evening" | "night";

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export interface Meta {
  /** Save-schema version (SAVE_SCHEMA_VERSION at creation; migrations update it). */
  readonly version: number;
  /** Run seed; the sole origin of all randomness via named streams (T5, DESIGN §9). */
  readonly seed: string;
  /** ISO-8601, supplied by the *client* at run creation — the core never reads a clock. */
  readonly createdAt: string;
  /** 1-based in-game day. */
  readonly day: number;
  /** 0–23 in-game hour. */
  readonly hour: number;
  readonly phase: Phase;
  /** Monotonic count of resolved turns; drives cooldowns and golden-run tests. */
  readonly turn: number;
}

// ---------------------------------------------------------------------------
// player & actors (GDD V, VI, XII)
// ---------------------------------------------------------------------------

/** Needs as 0–100 ints; 0 is fully satisfied, 100 is critical. Never shown as bars. */
export interface Needs {
  readonly hunger: number;
  readonly thirst: number;
  readonly fatigue: number;
}

/** A named wound that is treated, not regenerated (FR-INJ-01, FR-INJ-04). */
export interface Wound {
  /** Content id of the wound type (e.g. "wound.bite.forearm"). */
  readonly type: ContentId;
  /** Body location key (content-defined). */
  readonly site: string;
  /** 0–100 severity int. */
  readonly severity: number;
  /** 0–100 treatment progress int; wounds close only through care. */
  readonly treated: number;
  /** Day the wound was inflicted (for Living History and infection timing). */
  readonly inflictedDay: number;
}

/**
 * Infection is tracked numerically but NEVER surfaced as a number — the client only
 * ever sees symptoms in the Scene (FR-INJ-05, DESIGN §4).
 */
export interface Infection {
  readonly stage: "none" | "incubating" | "symptomatic" | "terminal";
  /** 0–100 hidden progression int. */
  readonly progression: number;
}

/** Hidden mind state; surfaced only as behavior/prose (GDD VI). */
export interface Mind {
  /** 0–100 ints. */
  readonly stress: number;
  readonly morale: number;
}

export interface CharacterState {
  readonly needs: Needs;
  readonly wounds: readonly Wound[];
  readonly infection: Infection;
  readonly mind: Mind;
}

/** One carried item stack; `itemId` points into `GameState.items` for artifacts. */
export interface InventoryEntry {
  /** Content id of the item type. */
  readonly type: ContentId;
  readonly quantity: number;
  /** Present only when this stack is a tracked unique instance (artifact). */
  readonly itemId?: ItemInstanceId;
}

export interface Player {
  readonly condition: CharacterState;
  readonly inventory: readonly InventoryEntry[];
  /** Slot → item-instance id (or content id for non-unique gear). */
  readonly equipment: { readonly [slot: string]: string };
  /** Skill key → 0–100 int. */
  readonly skills: { readonly [skill: string]: number };
  /** Content ids of traits. */
  readonly traits: readonly ContentId[];
  /** Current node. */
  readonly location: NodeId;
  /** Established shelter, if any. */
  readonly shelterId: NodeId | null;
  /** Group id → -100..100 int standing. */
  readonly reputation: { readonly [groupId: GroupId]: number };
  /** Active quest/goal content ids with progress data. */
  readonly quests: readonly { readonly id: ContentId; readonly data: JsonValue }[];
  readonly flags: Flags;
}

/** A tracked survivor: companion or named NPC (GDD XII). */
export interface Survivor {
  readonly id: ActorId;
  /** Content id of the handcrafted survivor definition. */
  readonly type: ContentId;
  readonly condition: CharacterState;
  readonly location: NodeId | null;
  readonly groupId: GroupId | null;
  /** Actor id → -100..100 int relationship. */
  readonly relationships: { readonly [actorId: ActorId]: number };
  readonly inventory: readonly InventoryEntry[];
  readonly flags: Flags;
}

/** An off-screen faction / rival group (GDD XII; moves in pipeline stage 10). */
export interface SurvivorGroup {
  readonly id: GroupId;
  readonly type: ContentId;
  readonly memberIds: readonly ActorId[];
  readonly homeNodeId: NodeId | null;
  /** Content-defined goal key driving off-screen behavior. */
  readonly goal: string;
  /** 0–100 ints. */
  readonly strength: number;
  readonly hostility: number;
  readonly flags: Flags;
}

// ---------------------------------------------------------------------------
// world, regions, nodes (GDD IV, VII)
// ---------------------------------------------------------------------------

export interface World {
  /** Content id of current weather state. */
  readonly weather: ContentId;
  readonly season: "spring" | "summer" | "autumn" | "winter";
  /** Infrastructure as 0–100 ints; they decay, never tick up on their own (GDD IV). */
  readonly powerGrid: number;
  readonly water: number;
  /** Military presence/activity 0–100 int. */
  readonly military: number;
  /** Active broadcast content ids (radio network, GDD XIII). */
  readonly broadcasts: readonly ContentId[];
  /** 0–100 int city-wide pressure; the director reads it, never writes fiction. */
  readonly globalThreat: number;
  readonly knownSafeZones: readonly NodeId[];
  readonly flags: Flags;
}

/** Regions live on their own clock (pipeline stage 7) — 0–100 ints throughout. */
export interface RegionState {
  readonly threat: number;
  readonly zombieDensity: number;
  /** Remaining loot richness; finite and depleting (FR-ECO-01). */
  readonly loot: number;
  readonly survivorActivity: number;
  readonly power: number;
  readonly water: number;
  /** Active fire spread 0–100 int. */
  readonly fire: number;
  /** Road passability 0–100 int. */
  readonly roads: number;
  readonly storyFlags: Flags;
}

/** Nodes remember: never reset within a run (GDD VII, DESIGN §4). */
export interface NodeState {
  readonly regionId: RegionId;
  /** 0–100 int of how searched-out this node is. */
  readonly searchPct: number;
  /** 0–100 int structural damage. */
  readonly damage: number;
  readonly corpses: number;
  /** Visible aftermath 0–100 int. */
  readonly blood: number;
  /** 0–100 int barricade integrity. */
  readonly barricades: number;
  /** Content ids of placed traps. */
  readonly traps: readonly ContentId[];
  /** Actor ids currently here. */
  readonly occupants: readonly ActorId[];
  /** Content ids of things found/uncovered here. */
  readonly discoveries: readonly ContentId[];
  /** Player-authored notes (verbatim strings). */
  readonly playerNotes: readonly string[];
  /** Day of last player visit; null if never visited. */
  readonly lastVisit: number | null;
  /** Noise deposited this turn (stage 6), consumed by hordes next turn (stage 9). */
  readonly noise: number;
  /**
   * Fog of war: true once the node is on the player's map — known to exist and routable to
   * (FR-MAP-02). Scouting reveals a node and its neighbors. Distinct from *visited*
   * (`lastVisit !== null`): a discovered node may never have been entered.
   */
  readonly discovered: boolean;
}

// ---------------------------------------------------------------------------
// hordes, items, story (GDD IX, V, XIII)
// ---------------------------------------------------------------------------

export interface Horde {
  readonly id: HordeId;
  readonly size: number;
  /** Current / destination node; hordes path over the node graph. */
  readonly pos: NodeId;
  readonly dest: NodeId | null;
  /** Nodes per turn (int). */
  readonly speed: number;
  /** 0–100 int alertness to stimuli. */
  readonly awareness: number;
  /** Zombie-type content ids composing the horde. */
  readonly types: readonly ContentId[];
}

/** A tracked unique item instance — identical items are not interchangeable (Principle 6). */
export interface ItemInstance {
  readonly type: ContentId;
  /** 0–100 int. */
  readonly quality: number;
  /** 0–100 int; null for items without durability. */
  readonly durability: number | null;
  /** Provenance, prior owners, inscriptions — content-shaped, schema-open. */
  readonly metadata: JsonValue;
}

export interface Story {
  /** Story-arc content id → 0-based progress int. */
  readonly progress: { readonly [arcId: ContentId]: number };
  /** Discovered lore content ids. */
  readonly lore: readonly ContentId[];
  readonly endingFlags: Flags;
  /** Mystery content id → current player-facing state key. */
  readonly mysteries: { readonly [mysteryId: ContentId]: string };
}

// ---------------------------------------------------------------------------
// history, queue, rng (DESIGN §4, §9)
// ---------------------------------------------------------------------------

/** One Living History entry. Append-only; never rewritten (GDD Part IV). */
export interface HistoryEvent {
  readonly day: number;
  readonly hour: number;
  readonly turn: number;
  /** Event-type key (content- or engine-defined). */
  readonly type: string;
  /** Ids of involved entities (actors, nodes, items...). */
  readonly subjects: readonly string[];
  /** Event-shaped payload. */
  readonly data: JsonValue;
}

/** A future/timed event resolved by pipeline stage 12. */
export interface ScheduledEvent {
  readonly id: string;
  readonly dueDay: number;
  readonly dueHour: number;
  /** Handler key. */
  readonly kind: string;
  readonly data: JsonValue;
}

/**
 * Serialized state of one named RNG stream. The algorithm (and this shape's contents)
 * is fixed by task T5; it is opaque, JSON-plain, and serializes with the save.
 */
export interface RngStreamState {
  readonly state: readonly number[];
}

export interface RngState {
  /** Named streams, e.g. "loot", "encounter", "combat" (DESIGN §9). */
  readonly streams: { readonly [streamName: string]: RngStreamState };
}

// ---------------------------------------------------------------------------
// GameState
// ---------------------------------------------------------------------------

/** The entire game. There is no state anywhere else (TEC-04). */
export interface GameState {
  readonly meta: Meta;
  readonly player: Player;
  readonly world: World;
  readonly regions: { readonly [regionId: RegionId]: RegionState };
  readonly nodes: { readonly [nodeId: NodeId]: NodeState };
  readonly actors: { readonly [actorId: ActorId]: Survivor };
  readonly groups: { readonly [groupId: GroupId]: SurvivorGroup };
  readonly hordes: readonly Horde[];
  readonly items: { readonly [itemId: ItemInstanceId]: ItemInstance };
  readonly story: Story;
  readonly history: readonly HistoryEvent[];
  readonly queue: readonly ScheduledEvent[];
  readonly rng: RngState;
}
