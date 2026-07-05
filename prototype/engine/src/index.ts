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
