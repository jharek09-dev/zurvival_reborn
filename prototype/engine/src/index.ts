export * from "./state/types.js";
export { createInitialState, type InitialStateOptions } from "./state/createInitialState.js";

// Seeded RNG — named streams (T5, DESIGN §9)
export { seedStreamState, stepFloat } from "./rng/prng.js";
export { drawFloat, drawInt, drawPick, type Draw } from "./rng/streams.js";

// Turn pipeline shell (T4, DESIGN §5)
export {
  applyAction,
  PIPELINE_STAGES,
  type Action,
  type Scene,
  type SceneChoice,
  type TurnResult,
} from "./pipeline/applyAction.js";

// Per-turn change telemetry — the FR-CORE-04 no-no-op-turn audit (T13, DESIGN §11)
export {
  TRACKED_SYSTEMS,
  jsonEqual,
  diffSystems,
  auditTurn,
  type TrackedSystem,
  type TurnAudit,
} from "./telemetry/turnAudit.js";

// Save / load — versioned serialized GameState (T7, DESIGN §9)
export {
  saveGame,
  loadGame,
  serializeSave,
  describeSave,
  SaveError,
  SAVE_FORMAT,
  type SaveFile,
  type SaveMigration,
} from "./save/saveGame.js";

// Region & node graph, fog of war, world seeding (T11, DESIGN §4/§7)
export {
  MapError,
  buildRegionGraph,
  neighborsOf,
  areAdjacent,
  isDiscovered,
  isVisited,
  discoveredNodeIds,
  discoverAround,
  startRun,
  seedRegionState,
  seedNodeState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type NodeMap,
  type RunStart,
} from "./map/index.js";

// Core action loop — move/search/rest, time cost, scene (T12, DESIGN §5/§10)
export { phaseOf, advanceClock } from "./time/clock.js";
export {
  availableActions,
  assertLegal,
  applyPlayerAction,
  tickNeeds,
  sceneOf,
  IllegalActionError,
  MOVE_COST,
  SEARCH_COST,
  REST_COST,
  SEARCH_GAIN,
  REST_RECOVERY,
} from "./actions/coreActions.js";
