export {
  runEmptyTurn,
  WAIT_ACTION,
  type HarnessOptions,
  type EmptyTurnResult,
} from "./runEmptyTurn.js";

// Story-first single-decision play client (T19 · FR-UI-01/02/03/05)
export {
  renderScene,
  describeStatus,
  describeChoice,
  playSession,
  transcript,
  renderRegions,
  parseCommand,
  playByInputs,
  saveState,
  resumeSession,
  runEnded,
  UnofferedChoiceError,
  FOOTER,
  SCREEN_REGION_ORDER,
  type PlayedTurn,
  type SessionResult,
  type ScreenRegion,
  type ScreenRegions,
  type Command,
  type StopReason,
  type InputPlayResult,
} from "./play.js";

// The soundscape — the client-side Audio Director rendered as sound-captions (T55 · FR-AUD-01/02/06 · AUDIO §13.2)
export {
  describeSoundscape,
  soundscapeCaptions,
  EARSHOT_MAX,
  type Soundscape,
} from "./soundscape.js";

// The FR-AUD-06 cue-redundancy matrix — every meaningful sound cue → its text equivalent (T56 pt 2 · ACCESSIBILITY §10.4)
export {
  CUE_MATRIX,
  CUE_CHANNELS,
  DEFERRED_CUES,
  renderCueMatrix,
  type CueMatrixEntry,
  type CueChannel,
  type DeferredCue,
} from "./cueMatrix.js";

// On-demand depth screens — inventory / companions / shelter / map / codex (T54 · FR-UI-04 · GDD XVII)
export {
  DEPTH_SCREENS,
  SCREEN_KEYS,
  RESERVED_KEYS,
  SCREEN_BACK_HINT,
  screenForKey,
  screenById,
  screenLegend,
  renderDepthScreen,
  renderInventory,
  renderCompanions,
  renderShelter,
  renderMap,
  renderCodex,
  historyLine,
  type ScreenId,
  type DepthScreen,
} from "./screens.js";
