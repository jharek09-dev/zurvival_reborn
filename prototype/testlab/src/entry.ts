/**
 * Bundle entry for the single-file Test Lab page (esbuild `--global-name=ZL`).
 *
 * Re-exports the engine API and harness renderers the page needs, plus this package's core. Nothing here
 * re-implements game logic: a Test Lab run is byte-for-byte the same engine as `npm run play`. Excludes
 * every `node:` importer (the CLI, the harness CLIs) so the bundle is browser-clean.
 */

export {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  isRunOver,
  runEndReason,
  buildRegionGraph,
  saveGame,
  loadGame,
  parseDifficulty,
  difficultyOf,
  modeInfo,
  isIronman,
  DIFFICULTY_MODES,
  STORY_ARCS,
  SAVE_FORMAT,
  VERBATIM_REPEAT_TARGET,
  samplePacing,
  stageRank,
  STAGE_ORDER,
} from "../../engine/src/index.js";

export {
  renderScene,
  renderRegions,
  layoutStory,
  describeStatus,
  playSession,
  transcript,
  renderDepthScreen,
  DEPTH_SCREENS,
  SCREEN_KEYS,
  screenForKey,
} from "../../harness/src/index.js";

export * from "./boot.js";
export * from "./policies.js";
export * from "./checks.js";
export * from "./runner.js";
export * from "./report.js";
