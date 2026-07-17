/**
 * Save / load — the serialized GameState (M0 task T7 · DESIGN §9 · PRD NFR-SAVE-01/02).
 *
 * Because the whole game is one plain-JSON `GameState` (T3), a save *is* that state
 * serialized. This module wraps it in a tiny versioned envelope so the format is
 * migratable from the very first release (feeds ADR-0003), records the two things a save
 * must carry — the save-schema version and a one-line "where you are" summary (DESIGN §9,
 * QA TC-DET-07) — and is the single door back in on load.
 *
 * Guarantees:
 *   - Lossless: `loadGame(saveGame(state))` is deep-equal to `state`, including `history`,
 *     `queue`, and the serialized `rng` streams (QA TC-DET-05). The round-trip is pure
 *     `JSON` — no field is dropped, reordered in a way that matters, or reinterpreted.
 *   - Deterministic & clock-free: nothing here reads a wall-clock or a global RNG. The
 *     `savedAt` timestamp that a *client* might want is deliberately NOT stored by the core;
 *     a save is a function of the state alone, so two saves of the same state are identical
 *     byte-for-byte (ADR-0001).
 *   - Safe on load: a corrupt, foreign, or future-versioned blob throws `SaveError` rather
 *     than yielding a half-valid state. Older-versioned saves run forward through the
 *     migration ladder (empty at v1; the hook exists so no save is ever orphaned).
 *
 * This is part of the dependency-free engine core: no Ajv, no I/O. Reading/writing bytes to
 * a disk or browser store is the client's job; the core only turns state ⇄ string.
 */

import {
  SAVE_SCHEMA_VERSION,
  HUMANITY_BASELINE,
  type CharacterState,
  type GameState,
  type Phase,
  type Survivor,
} from "../state/types.js";
import { stageFor } from "../sim/infection.js";

/** Envelope discriminator — lets a loader reject a blob that isn't one of our saves. */
export const SAVE_FORMAT = "zurvival-save" as const;

/**
 * The on-disk / on-wire save envelope. Versioned independently of the inner state shape so
 * the container can evolve (e.g. add a checksum) without a state migration, and vice-versa.
 */
export interface SaveFile {
  readonly format: typeof SAVE_FORMAT;
  /** Save-schema version this blob was written at (SAVE_SCHEMA_VERSION at write time). */
  readonly saveSchemaVersion: number;
  /** One-line, human-readable "where you are" (DESIGN §9); never parsed on load. */
  readonly summary: string;
  /** The entire game. */
  readonly state: GameState;
}

/** Thrown when a blob can't be trusted as a save; carries a precise reason. */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

/**
 * A migration lifts a `SaveFile` written at version N to version N+1. The ladder is empty at
 * v1 — the hook exists now so the first breaking change (ADR-0003) drops in as one entry and
 * every historical save keeps loading. Keyed by the *source* version it upgrades from.
 */
export type SaveMigration = (save: SaveFile) => SaveFile;

/**
 * v1 → v2 (task T15): the combat layer arrived. v1 states have no `combat` slice and their nodes
 * have no `walkers` count; a forward-only rung adds both at their quiet defaults (`combat: null`,
 * every node `walkers: 0`) and stamps `meta.version` to 2. Pure and total — one N→N+1 rung, per the
 * ADR-0003 / T7 ladder discipline.
 */
function migrateV1toV2(state: GameState): GameState {
  const src = state as unknown as { readonly nodes: Record<string, Record<string, unknown>> };
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(src.nodes)) {
    nodes[id] = "walkers" in node ? node : { ...node, walkers: 0 };
  }
  return {
    ...state,
    meta: { ...state.meta, version: 2 },
    nodes: nodes as GameState["nodes"],
    combat: state.combat ?? null,
  };
}

/**
 * v2 -> v3 (task T25): the zombie state machine arrived. v2 nodes have no behavioural state and no
 * type list; a forward-only rung adds both at their quiet defaults (`zombieState: "dormant"`, every
 * node `zombieTypes: []`) and stamps `meta.version` to 3. Pure and total — one N->N+1 rung.
 */
function migrateV2toV3(state: GameState): GameState {
  const src = state as unknown as { readonly nodes: Record<string, Record<string, unknown>> };
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(src.nodes)) {
    const withState = "zombieState" in node ? node : { ...node, zombieState: "dormant" };
    nodes[id] = "zombieTypes" in withState ? withState : { ...withState, zombieTypes: [] };
  }
  return {
    ...state,
    meta: { ...state.meta, version: 3 },
    nodes: nodes as GameState["nodes"],
  };
}

/**
 * v3 -> v4 (task T29): route conditions arrived. v3 states have no `routes` slice; a forward-only
 * rung adds it empty (`routes: {}`) and stamps `meta.version` to 4. Empty is the safe default — every
 * route reads as clear until the world re-seeds/degrades it. Pure and total — one N->N+1 rung.
 */
function migrateV3toV4(state: GameState): GameState {
  const src = state as unknown as { readonly routes?: unknown };
  return {
    ...state,
    meta: { ...state.meta, version: 4 },
    routes: (src.routes as GameState["routes"] | undefined) ?? {},
  };
}

/**
 * v4 -> v5 (task T33): survivor NPCs arrived. v4 states have no `npcs` slice; a forward-only rung adds
 * it empty (`npcs: {}`) and stamps `meta.version` to 5. Empty is the safe default — a pre-people run
 * simply carries no survivors, and the world re-populates none retroactively. Pure and total — one
 * N->N+1 rung, per the ADR-0003 / T7 ladder.
 */
function migrateV4toV5(state: GameState): GameState {
  const src = state as unknown as { readonly npcs?: unknown };
  return {
    ...state,
    meta: { ...state.meta, version: 5 },
    npcs: (src.npcs as GameState["npcs"] | undefined) ?? {},
  };
}

/**
 * v5 -> v6 (task T35): survivor interaction arrived. A survivor now carries `met` — whether the player
 * has spoken with them. v5 survivors have no such field; a forward-only rung sets `met: false` on every
 * survivor in the pool (a pre-Part-2 run has met no one, the safe default) and stamps `meta.version` to
 * 6. Pure and total — one N->N+1 rung, per the ADR-0003 / T7 ladder.
 */
function migrateV5toV6(state: GameState): GameState {
  const src = state as unknown as { readonly npcs?: Record<string, Record<string, unknown>> };
  const npcs: Record<string, unknown> = {};
  for (const [id, npc] of Object.entries(src.npcs ?? {})) {
    npcs[id] = "met" in npc ? npc : { ...npc, met: false };
  }
  return {
    ...state,
    meta: { ...state.meta, version: 6 },
    npcs: npcs as GameState["npcs"],
  };
}

/**
 * v6 -> v7 (task T39): the shared stash arrived. The player now keeps a base store — `player.stash` —
 * separate from the weight-limited pack. v6 states have no such field; a forward-only rung adds it
 * empty (`stash: []`) and stamps `meta.version` to 7. Empty is the safe default — a pre-Part-4 run has
 * banked nothing — so every historical run migrates losslessly and stays inert. One N->N+1 rung, per
 * the ADR-0003 / T7 ladder.
 */
function migrateV6toV7(state: GameState): GameState {
  const src = state as unknown as { readonly player: Record<string, unknown> };
  const player = "stash" in src.player ? src.player : { ...src.player, stash: [] };
  return {
    ...state,
    meta: { ...state.meta, version: 7 },
    player: player as unknown as GameState["player"],
  };
}

/**
 * v7 -> v8 (task T47): the Humanity system arrived. The player now carries a hidden moral scalar —
 * `player.humanity` — that moral encounters (FR-ENC-06) move. v7 states have no such field; a
 * forward-only rung seeds it at `HUMANITY_BASELINE` (a pre-moral run reads as neutral) and stamps
 * `meta.version` to 8. Pure and total — one N->N+1 rung, per the ADR-0003 / T7 ladder.
 */
function migrateV7toV8(state: GameState): GameState {
  const src = state as unknown as { readonly player: Record<string, unknown> };
  const player =
    "humanity" in src.player ? src.player : { ...src.player, humanity: HUMANITY_BASELINE };
  return {
    ...state,
    meta: { ...state.meta, version: 8 },
    player: player as unknown as GameState["player"],
  };
}

/**
 * v8 -> v9 (task T49): infection became a *staged identity* and its stage bands changed — an `advanced`
 * band was inserted at progression 70, and terminal onset (100) no longer ends the run. A v8 save stored
 * `infection.stage` under the OLD bands, so a mid-infection save with progression in [70, 100) carries a
 * `stage` ("symptomatic") that now disagrees with `stageFor(progression)` ("advanced"), and nothing else
 * re-derives it. This forward-only rung RE-DERIVES `stage` from the stored `progression` under the current
 * bands, for the player and every actor, so a loaded run reads its infection correctly. The state *shape*
 * is unchanged (stage: string, progression: int) — a value normalization, not a reshape. Pure and total;
 * a healthy save (progression 0 ⇒ "none") is untouched. One N->N+1 rung, per the ADR-0003 / T7 ladder.
 */
function migrateV8toV9(state: GameState): GameState {
  const restage = (c: CharacterState): CharacterState => {
    const stage = stageFor(c.infection.progression);
    return stage === c.infection.stage ? c : { ...c, infection: { ...c.infection, stage } };
  };
  const actors: Record<string, Survivor> = {};
  for (const [id, a] of Object.entries(state.actors)) actors[id] = { ...a, condition: restage(a.condition) };
  return {
    ...state,
    meta: { ...state.meta, version: 9 },
    player: { ...state.player, condition: restage(state.player.condition) },
    actors: actors as GameState["actors"],
  };
}

/**
 * v9 -> v10 (task T51): the crafting economy arrived. The player now carries an `economy` slice (learned
 * blueprints + the carried-food spoilage clock) and every node carries a `rooms` list (crafting rooms
 * installed there). v9 states have neither; a forward-only rung adds both at their inert empties
 * (`economy: {blueprints: [], freshness: null}`, every node `rooms: []`) and stamps `meta.version` to 10.
 * Empty is the safe default — a pre-economy run has learned nothing, carries no fresh food, and has built
 * no rooms — so every historical run migrates losslessly and behaves identically. Pure and total; one
 * N->N+1 rung, per the ADR-0003 / T7 ladder.
 */
function migrateV9toV10(state: GameState): GameState {
  const src = state as unknown as {
    readonly player: Record<string, unknown>;
    readonly nodes: Record<string, Record<string, unknown>>;
  };
  const player =
    "economy" in src.player
      ? src.player
      : { ...src.player, economy: { blueprints: [], freshness: null } };
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(src.nodes)) {
    nodes[id] = "rooms" in node ? node : { ...node, rooms: [] };
  }
  return {
    ...state,
    meta: { ...state.meta, version: 10 },
    player: player as unknown as GameState["player"],
    nodes: nodes as GameState["nodes"],
  };
}

const MIGRATIONS: { readonly [fromVersion: number]: SaveMigration } = {
  1: (save) => ({ ...save, saveSchemaVersion: 2, state: migrateV1toV2(save.state) }),
  2: (save) => ({ ...save, saveSchemaVersion: 3, state: migrateV2toV3(save.state) }),
  3: (save) => ({ ...save, saveSchemaVersion: 4, state: migrateV3toV4(save.state) }),
  4: (save) => ({ ...save, saveSchemaVersion: 5, state: migrateV4toV5(save.state) }),
  5: (save) => ({ ...save, saveSchemaVersion: 6, state: migrateV5toV6(save.state) }),
  6: (save) => ({ ...save, saveSchemaVersion: 7, state: migrateV6toV7(save.state) }),
  7: (save) => ({ ...save, saveSchemaVersion: 8, state: migrateV7toV8(save.state) }),
  8: (save) => ({ ...save, saveSchemaVersion: 9, state: migrateV8toV9(save.state) }),
  9: (save) => ({ ...save, saveSchemaVersion: 10, state: migrateV9toV10(save.state) }),
};

/** Two-digit zero-pad for the summary clock (pure, allocation-light). */
const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/**
 * The one-line "where you are" a save must carry (DESIGN §9, QA TC-DET-07). Derived purely
 * from state — no clock, no RNG — so it's stable across identical states. Intentionally
 * terse and engine-flavored; the client localizes its own richer label from the Scene.
 */
export function describeSave(state: GameState): string {
  const { day, hour, phase, turn } = state.meta;
  const wounds = state.player.condition.wounds.length;
  const woundNote = wounds > 0 ? `, ${wounds} wound${wounds === 1 ? "" : "s"}` : "";
  return (
    `Day ${day}, ${phase} (${pad2(hour)}:00) — turn ${turn} ` +
    `@ ${state.player.location}${woundNote}`
  );
}

/** Build the (still-structured) save envelope for a state. */
export function serializeSave(state: GameState): SaveFile {
  return {
    format: SAVE_FORMAT,
    saveSchemaVersion: state.meta.version,
    summary: describeSave(state),
    state,
  };
}

/**
 * Serialize a GameState to a save string. `pretty` emits indented JSON for golden-run
 * fixtures and human diffs; the default is compact. Byte-stability does not depend on this
 * flag — a given (state, pretty) pair always produces the identical string.
 */
export function saveGame(state: GameState, pretty = false): string {
  return JSON.stringify(serializeSave(state), null, pretty ? 2 : undefined);
}

const VALID_PHASES: readonly Phase[] = ["dawn", "morning", "midday", "evening", "night"];

/** Narrow parsed JSON to a SaveFile, throwing SaveError with a precise reason otherwise. */
function assertSaveFile(value: unknown): asserts value is SaveFile {
  if (value === null || typeof value !== "object") {
    throw new SaveError("save is not a JSON object");
  }
  const v = value as Record<string, unknown>;
  if (v.format !== SAVE_FORMAT) {
    throw new SaveError(`not a ${SAVE_FORMAT} file (format=${JSON.stringify(v.format)})`);
  }
  if (typeof v.saveSchemaVersion !== "number" || !Number.isInteger(v.saveSchemaVersion)) {
    throw new SaveError("missing/invalid saveSchemaVersion");
  }
  if (typeof v.summary !== "string") {
    throw new SaveError("missing/invalid summary");
  }
  if (v.state === null || typeof v.state !== "object") {
    throw new SaveError("missing/invalid state");
  }
  // Shallow sanity of the fields the loader relies on. Deep content validation is the
  // schema gate's job (T8); here we only guard against loading obvious garbage as a run.
  const meta = (v.state as Record<string, unknown>).meta as Record<string, unknown> | undefined;
  if (meta === undefined || typeof meta !== "object") {
    throw new SaveError("state.meta is missing");
  }
  if (typeof meta.version !== "number" || meta.version !== v.saveSchemaVersion) {
    throw new SaveError("state.meta.version does not match envelope saveSchemaVersion");
  }
  if (typeof meta.seed !== "string") throw new SaveError("state.meta.seed is missing");
  if (!VALID_PHASES.includes(meta.phase as Phase)) {
    throw new SaveError(`state.meta.phase is invalid (${JSON.stringify(meta.phase)})`);
  }
}

/** Run the migration ladder from a save's version up to the current one. */
function migrate(save: SaveFile): SaveFile {
  let current = save;
  let guard = 0;
  while (current.saveSchemaVersion < SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[current.saveSchemaVersion];
    if (step === undefined) {
      throw new SaveError(
        `no migration from save-schema v${current.saveSchemaVersion} ` +
          `to v${SAVE_SCHEMA_VERSION}`,
      );
    }
    const next = step(current);
    if (next.saveSchemaVersion <= current.saveSchemaVersion) {
      throw new SaveError("migration did not advance the save-schema version");
    }
    current = next;
    if (++guard > 1000) throw new SaveError("migration ladder did not terminate");
  }
  return current;
}

/**
 * Parse a save string back into a GameState. Throws `SaveError` on malformed JSON, a foreign
 * format, or a version newer than this build understands; older versions are migrated forward
 * first. The returned state is deep-equal to the one that was saved when versions match.
 */
export function loadGame(text: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SaveError(`save is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  assertSaveFile(parsed);
  if (parsed.saveSchemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SaveError(
      `save-schema v${parsed.saveSchemaVersion} is newer than this build ` +
        `(v${SAVE_SCHEMA_VERSION}); update the game to load it`,
    );
  }
  return migrate(parsed).state;
}
