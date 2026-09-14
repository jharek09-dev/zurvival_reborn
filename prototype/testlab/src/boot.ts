/**
 * Boot — stand up the full content-complete city exactly the way the shipped clients do.
 *
 * Mirrors `harness/src/playCli.ts` `boot()` and `harness/web/ui.js` `newRun()`: every pool registered
 * (regions, nodes, npcs, encounters, radio signals, recipes, jobs, factions, weapons) plus the authored story arcs,
 * so a Test Lab run is the full-city beta, not the slice. Content is passed IN — the browser page has it
 * inlined as `window.CONTENT`, the CLI reads `content/` — so this module never touches the filesystem and
 * bundles cleanly.
 *
 * `createdAt` is FIXED. It is stored in `meta.createdAt`, so a wall-clock value would make two boots of the
 * same seed differ and break repro-from-seed (the measurement runner `harness/measure/t77.ts` pins it the
 * same way).
 */

import {
  startRun,
  buildRegionGraph,
  STORY_ARCS,
  FOOD_ITEM,
  WATER_ITEM,
  ANTIBIOTICS_ITEM,
  type GameState,
  type RegionGraph,
  type RegionDef,
  type NodeDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type WeaponDef,
  type ProjectDef,
  type EndingDef,
  type DifficultyMode,
  type InventoryEntry,
} from "../../engine/src/index.js";

/** The content pools the full-city beta registers (`signals` <- content/radio). */
export interface Content {
  readonly regions: readonly RegionDef[];
  readonly nodes: readonly NodeDef[];
  readonly npcs: readonly NPCDef[];
  readonly encounters: readonly EncounterDef[];
  readonly signals: readonly SignalDef[];
  readonly recipes: readonly RecipeDef[];
  readonly jobs: readonly JobDef[];
  readonly factions: readonly FactionDef[];
  /** The T81 weapon content set — the gate for weapon loot placement. */
  readonly weapons: readonly WeaponDef[];
  /** The T87 terminal-project pool — the gate for the win condition. */
  readonly projects: readonly ProjectDef[];
  /** The T61 ending pool — the gate for endings assembled from run components. */
  readonly endings: readonly EndingDef[];
}

export const CONTENT_POOLS = ["regions", "nodes", "npcs", "encounters", "signals", "recipes", "jobs", "factions", "weapons", "projects", "endings"] as const;

/** Pinned run-creation timestamp: the core never reads a clock, and replay needs boots to be byte-identical. */
export const FIXED_CREATED_AT = "2026-09-12T00:00:00.000Z";

export interface BootOptions {
  readonly difficulty?: DifficultyMode;
  readonly ironman?: boolean;
  /** Start with a full, realistic pack ({@link STOCK_KIT}) instead of the bare-hands default. */
  readonly stocked?: boolean;
}

/**
 * A well-supplied pack that FITS the carry limit (33 of `CARRY_CAPACITY` 40 by `ITEM_WEIGHTS`): four days of
 * food and water, a little medicine, a little material. The exit-gate test's `stocked()` fixture carries 574
 * weight units — fine for a headless invariant probe, but a watched run should start from a state a player
 * could actually be in, so the Lab's kit is a real pack, not a warehouse.
 */
export const STOCK_KIT: readonly InventoryEntry[] = [
  { type: FOOD_ITEM, quantity: 4 },
  { type: WATER_ITEM, quantity: 4 },
  { type: ANTIBIOTICS_ITEM, quantity: 2 },
  { type: "item.bandage", quantity: 3 },
  { type: "item.scrap", quantity: 2 },
];

/** Replace the pack with {@link STOCK_KIT}. Pure. */
export function stock(state: GameState): GameState {
  return { ...state, player: { ...state.player, inventory: [...STOCK_KIT] } };
}

/** A fresh full-city run on `seed`. Pure and deterministic: same content + seed + opts ⇒ same state. */
export function bootCity(
  content: Content,
  seed: string,
  opts: BootOptions = {},
): { readonly state: GameState; readonly graph: RegionGraph } {
  // `survivor` is the identity mode and must be ABSENT, not `undefined`, to keep the save byte-identical
  // (exactOptionalPropertyTypes forbids an explicit undefined anyway) — the playCli.ts spread idiom.
  const difficulty = opts.difficulty && opts.difficulty !== "survivor" ? opts.difficulty : undefined;
  const { state, graph } = startRun(
    {
      seed,
      createdAt: FIXED_CREATED_AT,
      ...(difficulty ? { difficulty } : {}),
      ...(opts.ironman ? { ironman: true } : {}),
    },
    content.regions,
    content.nodes,
    content.npcs,
    STORY_ARCS.map((a) => a.id),
    content.encounters,
    content.signals,
    content.recipes,
    content.jobs,
    content.factions,
    content.weapons,
    content.projects,
    content.endings,
  );
  return { state: opts.stocked ? stock(state) : state, graph };
}

/**
 * Rebuild the transient region graph for a LOADED save (the graph is never serialized). Note the argument
 * order differs from `startRun`: npcs come LAST here (`playCli.ts` resume path).
 */
export function graphFor(content: Content): RegionGraph {
  return buildRegionGraph(
    content.regions,
    content.nodes,
    content.encounters,
    content.signals,
    content.recipes,
    content.jobs,
    content.factions,
    content.npcs,
    content.weapons,
    content.projects,
    content.endings,
  );
}
