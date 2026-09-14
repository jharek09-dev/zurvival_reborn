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
export const SAVE_SCHEMA_VERSION = 10;

/**
 * Neutral starting `Player.humanity` (M4 task T47 · GDD "The Humanity system"). 0–100 int, never shown
 * as a bar; moral encounters (FR-ENC-06) move it, and the v7→v8 migration seeds every historical save
 * here so a pre-moral run reads as neutral.
 */
export const HUMANITY_BASELINE = 50;

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
export type Phase = "early morning" | "dawn" | "morning" | "midday" | "late afternoon" | "dusk" | "night";

/**
 * Explicit difficulty modes (T56 · GDD XVI) that sit on top of the adaptive Director, letting a player set
 * the floor. `survivor` is the intended baseline; its resolved dial profile — and that of an *unset*
 * difficulty — is the identity (no-op), so a Survivor / legacy run plays and serializes exactly as it did
 * before difficulty modes existed. The dial magnitudes live in `sim/difficulty.ts`.
 */
export type DifficultyMode = "story" | "survivor" | "hardcore" | "nightmare";

/**
 * A node's aggregate zombie behavioural state — the FR-CBT-06 senses-driven machine (T25). One
 * state per node (not per corpse) keeps the sim phone-cheap while still giving a legible read.
 */
export type ZombieState =
  | "dormant"
  | "wandering"
  | "investigating"
  | "chasing"
  | "feeding"
  | "hibernating";

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
  /**
   * Chosen difficulty mode (T56 · GDD XVI), or absent for the baseline. Written ONLY for a non-baseline
   * mode — `survivor` normalizes to absent (it is the no-op), so a Survivor run's meta is byte-identical to
   * a pre-difficulty-modes run, and `JSON.stringify` omits an unset field so the save bytes are unchanged.
   * Optional + tolerated-absent on load ⇒ no save rung: an old save with no field simply reads as Survivor.
   */
  readonly difficulty?: DifficultyMode;
  /**
   * Ironman intent (T56 · GDD XVI): one save, no take-backs, death is final — layerable on any mode. The
   * core records the intent and exposes it; the no-reload / single-slot enforcement is a client save-slot
   * policy. Written only when chosen (absent = off), so a non-Ironman run is byte-identical.
   */
  readonly ironman?: true;
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
  /**
   * Hour (0–23) of that day the wound was inflicted (T78), so the director can tell a wound opened this
   * turn from one carried for a week. Optional: a pre-T78 save's wounds read as opened at 00:00 of
   * their day, which can only over-estimate their age — no `SAVE_SCHEMA_VERSION` rung.
   */
  readonly inflictedHour?: number;
}

/**
 * Infection is tracked numerically but NEVER surfaced as a number — the client only
 * ever sees symptoms in the Scene (FR-INJ-05, DESIGN §4).
 *
 * The stages are the GDD Part VI identity ladder: `incubating` is the *asymptomatic* stage (kept as
 * the key since T22), `advanced` (M4 task T49) is the hallucinating, memory-gapped stage before
 * `terminal`. `terminal` is a *playable* stage — the cure race — not an instant loss (FR-INJ-08); the
 * run only ends by infection once `progression` reaches the delayed `INFECT_SUCCUMB_AT` collapse.
 * `progression` now runs past 100 up to that ceiling; it is still never shown (FR-UI-02).
 */
export interface Infection {
  readonly stage: "none" | "incubating" | "symptomatic" | "advanced" | "terminal";
  /** Hidden progression int, 0–`INFECT_CEILING` (148); the stage is derived from it, the number never shown. */
  readonly progression: number;
}

/** Hidden mind state; surfaced only as behavior/prose (GDD VI). */
export interface Mind {
  /** 0–100 ints. */
  readonly stress: number;
  readonly morale: number;
}

/**
 * One remembered social event driving a survivor's per-relationship axes (M4 task T53 · FR-NPC-02 · GDD
 * XII "Memory, trust, and respect"). Plain JSON, integer-only. A survivor keeps a bounded, append-only
 * list of these; each nudges their `respect`/`fear` (and the memory itself surfaces as "they remember").
 * `kind` is a verb key (e.g. "kindness", "menaced-me", "confided"); `other` is set when the memory is
 * about someone other than the player. Absent on every pre-T53 / social-inactive run (written only when a
 * faction pool is registered), so it is optional and tolerated-absent — no save-schema rung (the T45/T52
 * discipline).
 */
export interface SocialMemory {
  readonly kind: string;
  /** The `meta.turn` it happened — recency for surfacing + memory-cap eviction. */
  readonly turn: number;
  /** The other actor, when the remembered act was not the player's toward this survivor. */
  readonly other?: ActorId;
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

/**
 * The player's crafting economy (M4 task T51 · FR-ECO-04..07 · GDD Part X). Plain JSON, integer-only.
 * Everything the economy *produces or spends* rides shapes that already exist (`inventory`/`stash` for
 * items, `items` for durability artifacts, `NodeState.rooms` for the workbench); this slice holds only
 * the two facts nothing else can derive: what recipes the player has *learned*, and how fresh the food
 * in the pack still is. Added at save schema v10; an empty value is inert (a pre-economy run is
 * byte-identical), which is the safe migration default.
 */
export interface EconomyState {
  /**
   * Learned crafting-recipe unlocks — content ids. A recipe carrying a `blueprint` requirement is
   * craftable only once that id is here; blueprints are found in the world as an `item.blueprint.*` and
   * added by studying it. Basic survival recipes carry no blueprint and are known from the start.
   */
  readonly blueprints: readonly ContentId[];
  /**
   * Hours until the carried `item.food-fresh` stack spoils (FR-ECO-05). `null` when no fresh food is
   * carried. Set to `FRESH_SHELF_LIFE` when fresh food is first taken, decremented each hour — faster
   * once the grid fails — and at `0` the stack turns to `item.food-spoiled`. Only fresh food ever feels
   * this; canned food is shelf-stable, so a pack of cans is untouched.
   */
  readonly freshness: number | null;
}

export interface Player {
  readonly condition: CharacterState;
  readonly inventory: readonly InventoryEntry[];
  /**
   * A store kept at the player's shelter, separate from the weight-limited pack (M3 task T39 ·
   * FR-SHL-03 / FR-PLR-04). Deposited loot leaves the carry budget entirely — the base banks the
   * surplus — and it is the store the contested world can *raid* (a raided cache is a story beat,
   * T40). Empty until the first deposit; weightless while stored (schema v7).
   */
  readonly stash: readonly InventoryEntry[];
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
  /** Active quest/goal content ids with progress data. Also carries the reserved single active
   * multi-stage encounter slot (M4 task T47) — an "active goal with progress" is exactly this shape. */
  readonly quests: readonly { readonly id: ContentId; readonly data: JsonValue }[];
  readonly flags: Flags;
  /**
   * The run's hidden moral shape (M4 task T47 · GDD "The Humanity system" · FR-ENC-06). 0–100 int,
   * `HUMANITY_BASELINE` at run start; abandoning the desperate / killing for supplies erode it,
   * protecting people / keeping promises / burying the dead preserve it. NEVER surfaced as a number —
   * only as felt prose (`humanityBand`) — and read by the M5 endings (T61/T62) and companion loyalty
   * (T53). Added at save schema v8 with a forward-only rung (migrateV7toV8).
   */
  readonly humanity: number;
  /**
   * The crafting economy (M4 task T51 · FR-ECO-04..07). Learned blueprints + the carried-food spoilage
   * clock. Added at save schema v10 with a forward-only rung (migrateV9toV10); `{blueprints: [],
   * freshness: null}` is the inert default a pre-economy run reads.
   */
  readonly economy: EconomyState;
}

/** A tracked survivor: companion or named NPC (GDD XII). */
export interface Survivor {
  readonly id: ActorId;
  /** Content id of the handcrafted survivor definition. */
  readonly type: ContentId;
  /**
   * Survivor's name, carried over from {@link NPCState.name} at recruitment (T45) so party prose can
   * name them without a content lookup (closes the M3 "your companion" gap). Optional and tolerated as
   * absent — a pre-T45 companion (only ever a test fixture) simply falls back to a generic label, so no
   * save-schema bump is needed.
   */
  readonly name?: string;
  /**
   * Trust toward the player, carried over from {@link NPCState.trust} at recruitment (T45). Governs which
   * standing orders the companion will take (the dangerous ones are gated on it — a companion you have
   * not earned enough won't range out to scavenge or hold the line). Optional/tolerated-absent for the
   * same reason as {@link name}: no schema rung.
   */
  readonly trust?: number;
  readonly condition: CharacterState;
  readonly location: NodeId | null;
  readonly groupId: GroupId | null;
  /** Actor id → -100..100 int relationship. */
  readonly relationships: { readonly [actorId: ActorId]: number };
  readonly inventory: readonly InventoryEntry[];
  readonly flags: Flags;
  /**
   * The other two attitude axes toward the player (M4 task T53 · FR-NPC-02) — `respect` (do they defer to
   * you?) and `fear` (do they dread you?), 0–100 ints, beside the existing `trust`. Not a global bar:
   * per-character and driven by {@link SocialMemory}. Optional and tolerated-absent — written only when a
   * faction pool makes the social system active, so a pre-T53 companion carries neither and no save-schema
   * rung is needed (the `name`/`trust` discipline).
   */
  readonly respect?: number;
  readonly fear?: number;
  /** Bounded, append-only memory of what the player and others did (T53 · FR-NPC-02). Absent when inactive. */
  readonly memory?: readonly SocialMemory[];
  /**
   * How many consecutive social ticks this companion has been unhappy/afraid enough to consider leaving
   * (T53 · FR-NPC-05). Reaches the desertion threshold ⇒ they desert or betray. Optional/tolerated-absent
   * (0 when unset) — written only under an active faction pool, so no rung.
   */
  readonly desertPressure?: number;
  /**
   * Hour accumulators (T74) for this survivor's three periodic clocks — banked hours toward their next
   * job cycle, their next morale step, and their next scavenged supply. Optional; absent reads as 0, so
   * a pre-T74 save (and any companion who has never worked, drifted or scavenged) carries none of them.
   * See `sim/clocks.ts`.
   */
  readonly jobHours?: number;
  readonly moraleHours?: number;
  readonly scavengeHours?: number;
}

/**
 * NPC disposition — a survivor's baseline temperament (M3 task T33 · FR-NPC-01). The *fixed* half of
 * the attitude model, seeded from content; {@link NPCState.trust} is the half that moves (T34).
 */
export type NPCDisposition = "hostile" | "wary" | "neutral" | "friendly" | "desperate";

/**
 * An encounterable survivor — a person in the run with their own state and needs (M3 task T33 ·
 * FR-NPC-01). Deliberately lighter than {@link Survivor} (the reserved companion/faction record): a
 * survivor you have merely *met* is not yet a party member. One instance per handcrafted definition in
 * the Vertical Slice, keyed by `id` in {@link GameState.npcs}.
 *
 * `trust` (T34 · FR-NPC-02) is the 0–100 scalar that shifts only from the player's actions and never
 * regenerates on its own — a betrayal sticks. `alive` is flipped false when a survivor's
 * needs saturate (T35 death); `met` (T35) records whether the player has spoken with them.
 */
export interface NPCState {
  readonly id: ActorId;
  /** Content id of the handcrafted survivor definition (DESIGN §8 — an id, never a content copy). */
  readonly type: ContentId;
  /** Survivor's name, denormalised from content so a save reads on its own. */
  readonly name: string;
  readonly disposition: NPCDisposition;
  /** Hunger/thirst/fatigue as 0–100 ints; drift with elapsed hours like the player's needs (T22). */
  readonly needs: Needs;
  /** Current node, or null when off-map. */
  readonly location: NodeId | null;
  readonly alive: boolean;
  /**
   * Whether the player has *spoken* with this survivor (M3 task T35). Flipped true by a `talk`
   * interaction, which reveals their FR-NPC-01 flavour; a precondition on recruitment (you cannot ask a
   * stranger to follow you). False at spawn — a survivor you have not yet met (schema v6).
   */
  readonly met: boolean;
  /** 0–100 int trust toward the player (T34 · FR-NPC-02). Moves only from actions; no free regen. */
  readonly trust: number;
  /**
   * The other two attitude axes toward the player (M4 task T53 · FR-NPC-02), beside `trust` — `respect`
   * (do they defer to you?) and `fear` (do they dread you?), 0–100 ints, driven by {@link SocialMemory}.
   * Optional/tolerated-absent: written only when a faction pool makes the social system active, so a
   * pre-T53 spawned survivor carries neither and no save-schema rung is needed (unlike the required `met`
   * field of the v5→v6 rung — these are deliberately optional so a pool-less run stays byte-identical).
   */
  readonly respect?: number;
  readonly fear?: number;
  /** Bounded, append-only memory of what the player and others did (T53 · FR-NPC-02). Absent when inactive. */
  readonly memory?: readonly SocialMemory[];
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
  /**
   * Hour accumulators (M4 task T74) — banked remainder hours for the world's periodic clocks, so a
   * sub-cycle turn still counts toward the next cycle instead of truncating to nothing. Every one is
   * optional and reads as 0 when absent, so a pre-T74 save loads with all clocks at zero and needs no
   * `SAVE_SCHEMA_VERSION` rung (the {@link Survivor.desertPressure} precedent). See `sim/clocks.ts`.
   */
  readonly spoilHours?: number;
  readonly threatTideHours?: number;
  readonly routeWearHours?: number;
  readonly regroupHours?: number;
  readonly wallDecayHours?: number;
  /** Weather pressure-hours (pressure x hours), not plain hours — the two infrastructure drains. */
  readonly powerDrainHours?: number;
  readonly roadDrainHours?: number;
  /**
   * The director's daily relief ration (T78): the in-game day the count is for, and the relief beats
   * spent on it. Both optional and absent until the first relief lands; a stamp from another day reads
   * as 0 spent. See `sim/director.ts#reliefSpent`.
   */
  readonly directorReliefDay?: number;
  readonly directorReliefBeats?: number;
  /**
   * Banked NIGHT hours toward the next siege check (T83) — the hours a turn's *span* spent between
   * 21:00 and 02:59, not the phase it resolved in. Every {@link SIEGE_HOURS_PER_NIGHT} banked is one
   * night resolved against the claimed base, so a played night and a fast-forwarded one cost the same.
   * Optional and reads 0 when absent (the T74 accumulator precedent above), so a pre-T83 save loads
   * with no banked night and needs no `SAVE_SCHEMA_VERSION` rung. See `sim/siege.ts`.
   */
  readonly siegeHours?: number;
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
  /**
   * Hour accumulators (T74) for this region's two drift clocks — banked hours toward the next density
   * / threat point. Optional; absent reads as 0. See `sim/clocks.ts`.
   */
  readonly densityHours?: number;
  readonly threatHours?: number;
  /** Banked pressure-hours (survivorActivity x hours) toward the next point of off-screen loot contest. */
  readonly lootContestHours?: number;
  /**
   * Banked hours toward this region's next zombie-repopulation attempt (T75). Optional; absent reads
   * as 0, so schema v10 holds and a pre-T75 save needs no migration rung. HOLDS (neither accrues nor
   * resets) while the region has nothing to do — density 0, or already at carrying capacity. See
   * `sim/repopulate.ts`.
   */
  readonly repopHours?: number;
  /**
   * The director's lean on this region's drift anchor (T78): a whole number in ±`DIRECTOR_BIAS_MAX`
   * added to the anchored threat and density targets, and its banked decay hours. Both optional and
   * ABSENT at zero (never a stored 0), so schema v10 holds and a clean region is byte-identical to a
   * pre-T78 one. See `sim/director.ts#directorBias`.
   */
  readonly directorBias?: number;
  readonly directorBiasHours?: number;
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
  /**
   * The player has **looked at** this place — from here, or from a neighbouring block with the `scout`
   * verb (M5 task T84 · FR-MAP-02). Distinct from {@link discovered}, which walking hands out for free:
   * a discovered node is a name and a direction, a scouted one is a name, a direction, *and what is
   * standing in it*. Standing in a node scouts it, so `lastVisit !== null` implies this.
   *
   * Optional-tolerated-absent (the T74 idiom): absent reads as false, so a pre-T84 save loads with
   * nothing scouted and needs no `SAVE_SCHEMA_VERSION` rung. See `map/fogOfWar.ts`.
   *
   * **An explicit mark, never derived.** The first cut read `scouted === true || lastVisit !== null`,
   * which handed the whole return on the `scout` verb away for free: arriving at a node reveals its
   * neighbours, so a player who had once stood anywhere got live intel on everything beside it forever.
   * Standing somewhere does scout it — but `applyMove` now *writes* that, so the predicate is honest
   * and the verb is the only way to learn about a place you have not been.
   */
  readonly scouted?: boolean;
  /**
   * The day the look was taken (M5 task T84). What you know about a place you are not standing in is a
   * memory, and memories go stale: past {@link SCOUT_MEMORY_DAYS} the travel choice stops reporting a
   * count it can no longer stand behind. Without this the mark was permanent and the label read the
   * node's **live** walker count, which is a surveillance channel the game does not otherwise have.
   *
   * Optional and absent-reads-stale, so a pre-T84 save needs no rung.
   */
  readonly scoutedOn?: number;
  /**
   * Whether this building's walls have already been stripped by a claim (M5 task T85).
   *
   * A claim pays out `claimSalvage` scrap — the materials the player took the place apart for. Without
   * this mark that payout is **farmable**: claim, abandon, re-claim, and the same building hands over
   * its fittings again, because `searchPct` stays at 100. A `--ceiling` probe found it immediately
   * (rooms "built in 245% of runs" — the bot was tearing the base down and rebuilding it on free
   * scrap), which is the one honest reason to store this rather than derive it: there is no other
   * record that a claim ever happened here.
   *
   * Optional and absent-reads-unstripped, so a pre-T85 save needs no `SAVE_SCHEMA_VERSION` rung (the
   * T84 `scouted` precedent). A building is stripped once and stays stripped for the rest of the run.
   */
  readonly stripped?: boolean;
  /** Day of last player visit; null if never visited. */
  readonly lastVisit: number | null;
  /** Noise deposited this turn (stage 6), consumed by hordes next turn (stage 9). */
  readonly noise: number;
  /**
   * Walkers loitering here — the seed of an avoidable encounter (FR-CBT-01, task T15). Node
   * memory: killing one lowers the count and the rest persist across turns; 0 on a quiet node.
   *
   * As of T75 this is the **length of {@link roster}** and is written through
   * `sim/roster.ts#withRoster`, which keeps the two in step. Every existing reader is unchanged **as
   * code** — but note that `actions/coreActions.ts` and `sim/events.ts` both branch on `walkers > 0`,
   * so any body this field gains suppresses the whole explore branch and all encounter selection at
   * that node. Repopulation (T75) moves this field for the first time, so those two gates now fire on
   * far more nodes than they used to: see the shadowing note in `sim/repopulate.ts`.
   */
  readonly walkers: number;
  /**
   * The bodies standing here, **one content id per body** (M4 task T75) — e.g.
   * `["zombie.riot", "zombie.walker", "zombie.walker"]`. The single source of truth that reconciles
   * {@link walkers} (how many) with {@link zombieTypes} (which kinds), which were divorced before
   * T75: a node with one listed riot and three walkers fought three riots, and killing one never
   * removed the type.
   *
   * Optional-tolerated-absent (the T74 idiom): absent on a pre-T75 save, where `rosterOf` synthesizes
   * it on read from the legacy pair — so schema v10 holds with no migration rung. Seeded for every
   * node on a fresh run. See `sim/roster.ts`.
   */
  readonly roster?: readonly ContentId[];
  /**
   * Aggregate behavioural state of the dead loitering here — the FR-CBT-06 machine (T25). Ticked by
   * the zombies sim layer from senses (this node's noise, the player's presence/scent, the phase).
   */
  readonly zombieState: ZombieState;
  /**
   * Content ids of the distinct zombie *types* present here (FR-CBT-07) — e.g. "zombie.screamer",
   * "zombie.stalker". Empty for a plain node of walkers. Seeded from `NodeDef.zombieTypes`.
   *
   * As of T75 this is **derived from {@link roster}** — its distinct non-walker set — and written
   * only through `sim/roster.ts#withRoster`. Its meaning and every consumer (`hasTag`, the screamer
   * prose, the encounter requirement gates) are unchanged.
   */
  readonly zombieTypes: readonly ContentId[];
  /**
   * Fog of war: true once the node is on the player's map — known to exist and routable to
   * (FR-MAP-02). Scouting reveals a node and its neighbors. Distinct from *visited*
   * (`lastVisit !== null`): a discovered node may never have been entered.
   */
  readonly discovered: boolean;
  /**
   * Crafting rooms installed here (M4 task T51 · FR-ECO-06 · GDD Part XI) — content ids like
   * `room.workshop` / `room.medical`, built by a shelter-category recipe (`installsRoom`) and required
   * by others (`room`). Only ever non-empty on the claimed shelter node. Empty on every node until
   * built (schema v10); a pre-economy run reads `[]`, so node memory is byte-identical.
   */
  readonly rooms: readonly ContentId[];
}

/**
 * The live condition of one undirected route between two nodes (M2 task T29 · FR-MAP-04). Keyed in
 * `GameState.routes` by the sorted node-id pair (`routeKey`). `wear` is a 0–100 int the route
 * accrues under bad weather / broken roads and sheds as they clear; it maps to a passability
 * condition (clear/costly/flooded/blocked) that changes move cost and availability. Extensible: new
 * route facts (a story-blocked flag, a toll) get their own fields without a reshape.
 */
export interface RouteState {
  /** 0–100 int route wear; higher is worse. 0 is a clear, free route. */
  readonly wear: number;
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
  /**
   * Hour accumulator (T74) — banked hours toward this horde's next node of movement, so a horde
   * advances on ordinary turns instead of only when the player rests. Optional; absent reads as 0.
   */
  readonly stepHours?: number;
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
// combat (GDD IX)
// ---------------------------------------------------------------------------

/**
 * An active, avoidable combat encounter (M1 task T15 · FR-CBT-01/02 · GDD IX). `null` outside a
 * fight. Turn-based: it persists across turns while the exchange plays out — each strike, shot, or
 * retreat is one resolved turn. The player is never forced into it; a stealth path always exists.
 */
export interface CombatState {
  /** Node the fight is at (equals `player.location` while engaged). */
  readonly node: NodeId;
  /** Content id of the enemy kind (e.g. "enemy.walker"). */
  readonly enemy: ContentId;
  /** Enemy hit points remaining (int); 0 ⇒ the enemy is down and the fight clears. */
  readonly hp: number;
  /** Enemy hit points at the encounter's start (scene phrasing / telemetry). */
  readonly maxHp: number;
  /** The enemy is alerted and striking back (after your first blow, or a detected stealth start). */
  readonly alerted: boolean;
  /**
   * The enemy has been shoved back and has not recovered (T80's PUSH verb). Consumed by the very next
   * combat action: an escape taken while it is true is far likelier to be clean, and any blow spends
   * it. Optional and absent-reads-as-false, exactly like `Horde.stepHours` (T74) — a pre-T80 save
   * simply has no shoved enemy in it, so there is no `SAVE_SCHEMA_VERSION` rung to climb.
   */
  readonly offBalance?: boolean;
  /**
   * The dead have **hold of you** (T82's GRABBED outcome). Set by a retaliation that does more than
   * wound; cleared by breaking free, by putting the enemy down, or by the fight ending.
   *
   * This is the single piece of state that makes a fight losable. While it is true the retreat
   * options are not offered at all, so `escapeTargets` stops being the player's guaranteed way out of
   * a fight they are already in — and `runEndReason` can therefore reach `lastStand`. Everything else
   * about the fight is unchanged.
   *
   * Optional and absent-reads-as-false, exactly like {@link CombatState.offBalance} (T80) and
   * `Horde.stepHours` (T74): a pre-T82 save simply has nothing holding the player in it, so there is
   * no `SAVE_SCHEMA_VERSION` rung to climb and v10 holds.
   */
  readonly grabbed?: boolean;
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
  /** Live per-route conditions, keyed by the sorted node-id pair (T29 · FR-MAP-04). */
  readonly routes: { readonly [routeKey: string]: RouteState };
  readonly actors: { readonly [actorId: ActorId]: Survivor };
  readonly groups: { readonly [groupId: GroupId]: SurvivorGroup };
  /** Encounterable survivors — people with state, needs, and trust (T33/T34 · FR-NPC-01/02). */
  readonly npcs: { readonly [npcId: ActorId]: NPCState };
  readonly hordes: readonly Horde[];
  readonly combat: CombatState | null;
  readonly items: { readonly [itemId: ItemInstanceId]: ItemInstance };
  readonly story: Story;
  readonly history: readonly HistoryEvent[];
  readonly queue: readonly ScheduledEvent[];
  readonly rng: RngState;
}
