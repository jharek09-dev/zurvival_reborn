/**
 * The turn pipeline (M0 task T4 · DESIGN §5 · GDD IV).
 *
 * `applyAction(state, action)` runs the ONE fixed 14-stage sequence and returns the next
 * state plus the Scene the client should render. The order is invariant — it is what makes
 * a run reproducible while still allowing emergence (DESIGN §5): noise deposited in stage 6
 * is consumed by stages 9–10; the director (11) only biases stages 12–14.
 *
 * M0 scope: every stage is a *pure no-op transform of the turn context*. The skeleton runs
 * the full order deterministically (same seed + state ⇒ byte-identical result); real system
 * logic lands stage-by-stage from M1. Each stage is already a `(ctx) => ctx` transform, so a
 * system slots in by replacing one identity function — the wiring never changes.
 *
 * Purity: stages never mutate their input and never read a clock or global RNG (ADR-0001).
 * Any randomness a future stage needs is drawn from `state.rng` via `../rng/streams.js` and
 * threaded back through the returned context.
 */

import type { GameState } from "../state/types.js";

// ---------------------------------------------------------------------------
// Client-facing contract (DESIGN §10)
// ---------------------------------------------------------------------------

/**
 * A player's chosen action for the turn. In M0 this is a thin envelope; stage 1 will later
 * validate it against the current Scene's offered choices, and stage 2 will spend its time
 * cost. Content ids/params stay open until the systems that read them exist.
 */
export interface Action {
  /** Action kind, e.g. "move" | "search" | "rest" (content/engine-defined). */
  readonly type: string;
  /** The Scene choice this action answers, when the client drove it from a Scene. */
  readonly choiceId?: string;
  /** Turn time cost in in-game hours; spent by stage 2 (advanceTime). */
  readonly timeCost?: number;
  /** Action-shaped parameters (target node, item id…), validated by the owning system. */
  readonly params?: { readonly [key: string]: unknown };
}

/** One offered choice in a Scene. `label` will carry an ICU string once content lands. */
export interface SceneChoice {
  readonly id: string;
  readonly label: string;
}

/**
 * The systemic snapshot the client renders: story-first, one decision at a time (FR-UI-01..).
 * Stage 14 (generateScene) is the sole producer; the client never reads GameState directly.
 */
export interface Scene {
  readonly turn: number;
  readonly day: number;
  readonly hour: number;
  readonly phase: GameState["meta"]["phase"];
  /** Narrative prose for the moment; empty in the M0 skeleton. */
  readonly narration: string;
  readonly choices: readonly SceneChoice[];
}

/** What `applyAction` returns: the advanced state and the next Scene to present. */
export interface TurnResult {
  readonly state: GameState;
  readonly scene: Scene;
}

// ---------------------------------------------------------------------------
// Pipeline internals
// ---------------------------------------------------------------------------

/** Everything a stage may read or replace as the turn flows through the pipeline. */
interface TurnContext {
  readonly state: GameState;
  readonly action: Action;
  readonly scene: Scene;
}

/** A pipeline stage: a pure transform of the turn context. */
type StageFn = (ctx: TurnContext) => TurnContext;

/** No-op transform — the M0 body of a not-yet-implemented stage. */
const identity: StageFn = (ctx) => ctx;

/** Stage 14: project the current state into the Scene the client will render. */
const generateScene: StageFn = (ctx) => ({
  ...ctx,
  scene: buildScene(ctx.state),
});

function buildScene(state: GameState): Scene {
  const { turn, day, hour, phase } = state.meta;
  return { turn, day, hour, phase, narration: "", choices: [] };
}

/**
 * The 14 stages in their fixed, invariant order (DESIGN §5). Named for traceability and so
 * tests can assert the order never drifts. In M0 all are `identity` except the terminal
 * `generateScene`; each becomes a real system by swapping its `run`.
 */
export const PIPELINE_STAGES: readonly { readonly name: string; readonly run: StageFn }[] = [
  { name: "validate", run: identity },
  { name: "advanceTime", run: identity },
  { name: "resolvePlayerAction", run: identity },
  { name: "updatePlayer", run: identity },
  { name: "updateCompanions", run: identity },
  { name: "updateNode", run: identity },
  { name: "updateRegion", run: identity },
  { name: "updateWorld", run: identity },
  { name: "moveHordes", run: identity },
  { name: "moveGroups", run: identity },
  { name: "tickDirector", run: identity },
  { name: "resolveQueue", run: identity },
  { name: "evaluateStory", run: identity },
  { name: "generateScene", run: generateScene },
];

const EMPTY_SCENE: Scene = {
  turn: 0,
  day: 0,
  hour: 0,
  phase: "dawn",
  narration: "",
  choices: [],
};

/**
 * Resolve one turn: run the fixed pipeline in order and hand back the next state and Scene.
 * Deterministic — no wall-clock, no global RNG; identical (seed + state + action) inputs
 * always yield an identical result (M0 definition of done; T9 proves it end to end).
 */
export function applyAction(state: GameState, action: Action): TurnResult {
  let ctx: TurnContext = { state, action, scene: EMPTY_SCENE };
  for (const stage of PIPELINE_STAGES) {
    ctx = stage.run(ctx);
  }
  return { state: ctx.state, scene: ctx.scene };
}
