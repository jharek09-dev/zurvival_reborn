/**
 * Web entry for the temporary browser-playable client (side tool, NOT a roadmap task).
 *
 * Re-exports exactly what the single-file HTML UI needs, so esbuild's `--global-name=Zurvival`
 * exposes the real engine + harness renderers verbatim. Nothing here re-implements game logic —
 * the browser run is byte-for-byte the same engine as `npm run play`, just clicked instead of typed.
 * Excludes playCli.ts / main.ts / playSlice.ts (the only `node:` importers), so the bundle is
 * browser-clean and dependency-free (ADR-0001).
 */
export {
  // run lifecycle
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  isRunOver,
  buildRegionGraph,
  // save / load (client owns I/O — ADR-0003)
  saveGame,
  loadGame,
  // difficulty floor (T56 · GDD XVI)
  parseDifficulty,
  difficultyOf,
  modeInfo,
  isIronman,
  DIFFICULTY_MODES,
  // authored arcs — registered so the browser run is the full-city beta, not the slice (T57 fix)
  STORY_ARCS,
} from "../../engine/src/index.js";

export {
  // scene rendering — regions let the UI split narrative (pane) from choices (buttons)
  renderScene,
  renderRegions,
  SCREEN_REGION_ORDER,
  describeStatus,
  describeChoice,
  // shared narration reflow (locator lifted + paragraphs) — one source of truth with the terminal
  layoutStory,
  // canonical session fold — used to verify the UI click-path stays faithful
  playSession,
  transcript,
  // on-demand depth screens — free read-only overlays (T54 · FR-UI-04)
  renderDepthScreen,
  DEPTH_SCREENS,
  SCREEN_KEYS,
  screenForKey,
  screenById,
  // the same screen as structure — headings and real lists for assistive tech (T63 · NFR-ACC-02)
  outlineScreen,
} from "../src/index.js";
