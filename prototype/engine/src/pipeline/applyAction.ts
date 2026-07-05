/**
 * The turn pipeline (M0 task T4 · M1 task T12 · DESIGN §5 · GDD IV).
 *
 * `applyAction(state, action, graph?)` runs the ONE fixed 14-stage sequence and returns the next
 * state plus the Scene the client should render. The order is invariant — it is what makes a run
 * reproducible while still allowing emergence (DESIGN §5): time spent in stage 2 drives every
 * later system; the player action resolves in stage 3 before the world reacts.
 *
 * As of T12 the player-facing stages are real: stage 1 validates the action against the choices
 * the current node actually offers (FR-CORE-01), stage 2 spends its time cost and advances the
 * shared clock (FR-CORE-03), stage 3 applies the move/search/rest effect, stage 4 drifts the
 * player's needs, and stage 14 renders the next Scene. The remaining world stages (5–13) are
 * still identity no-ops; each becomes a real system by swapping its `run`, and the wiring never
 * changes. A zero-cost `wait` with no graph passes through inertly — the M0 empty-turn contract.
 *
 * Purity: stages never mutate their input and never read a clock or global RNG (ADR-0001). The
 * region `graph` is transient content the client rebuilds on load; it is threaded through the
 * turn context, never stored in state.
 */

import type { GameState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { advanceClock } from "../time/clock.js";
import { applyPlayerAction, assertLegal, sceneOf, tickNeeds } from "../actions/coreActions.js";
import { diffSystems } from "../telemetry/turnAudit.js";
import type { Action, Scene, SceneChoice, TurnResult } from "./contract.js";

export type { Action, Scene, SceneChoice, TurnResult } from "./contract.js";

/** Action kinds whose legality is checked against the offered choices in stage 1. */
const VALIDATED_TYPES = new Set(["move", "search", "rest"]);

// ---------------------------------------------------------------------------
// Pipeline internals
// ---------------------------------------------------------------------------

/** Everything a stage may read or replace as the turn flows through the pipeline. */
interface TurnContext {
  readonly state: GameState;
  readonly action: Action;
  readonly scene: Scene;
  /** Transient region graph (content), present for a real run; absent for the skeleton. */
  readonly graph?: RegionGraph;
}

/** A pipeline stage: a pure transform of the turn context. */
type StageFn = (ctx: TurnContext) => TurnContext;

/** No-op transform — the body of a world stage not yet implemented (stages 5–13). */
const identity: StageFn = (ctx) => ctx;

/** Stage 1: reject an action the current node did not offer (FR-CORE-01). Skipped without a graph. */
const validate: StageFn = (ctx) => {
  if (ctx.graph !== undefined && VALIDATED_TYPES.has(ctx.action.type)) {
    assertLegal(ctx.state, ctx.graph, ctx.action);
  }
  return ctx;
};

/** Stage 2: spend the action's time cost; a positive cost advances the clock (FR-CORE-03). */
const advanceTime: StageFn = (ctx) => {
  const hours = Math.max(0, Math.trunc(ctx.action.timeCost ?? 0));
  if (hours === 0) return ctx;
  return { ...ctx, state: { ...ctx.state, meta: advanceClock(ctx.state.meta, hours) } };
};

/** Stage 3: apply the move/search/rest world effect (needs graph; inert without one). */
const resolvePlayerAction: StageFn = (ctx) =>
  ctx.graph === undefined
    ? ctx
    : { ...ctx, state: applyPlayerAction(ctx.state, ctx.graph, ctx.action) };

/** Stage 4: drift the player's needs by the hours spent (rest recovers fatigue). */
const updatePlayer: StageFn = (ctx) => ({ ...ctx, state: tickNeeds(ctx.state, ctx.action) });

/** Stage 14: project the resolved state into the Scene the client will render. */
const generateScene: StageFn = (ctx) => ({ ...ctx, scene: sceneOf(ctx.state, ctx.graph) });

/**
 * The 14 stages in their fixed, invariant order (DESIGN §5). Named for traceability and so tests
 * can assert the order never drifts. Stages 5–13 remain `identity` until their systems land.
 */
export const PIPELINE_STAGES: readonly { readonly name: string; readonly run: StageFn }[] = [
  { name: "validate", run: validate },
  { name: "advanceTime", run: advanceTime },
  { name: "resolvePlayerAction", run: resolvePlayerAction },
  { name: "updatePlayer", run: updatePlayer },
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

const EMPTY_SCENE: Scene = { turn: 0, day: 0, hour: 0, phase: "dawn", narration: "", choices: [] };

/**
 * Resolve one turn: run the fixed pipeline in order and hand back the next state, the Scene, and
 * the FR-CORE-04 change telemetry (`changed` — the tracked systems this turn moved, computed by
 * diffing the turn's input against its output). Pass the region `graph` for a real run (enables
 * move/search/rest, validation, and the full Scene); omit it for the pre-content skeleton.
 * Deterministic — no wall-clock, no global RNG; identical (state + action + graph) inputs always
 * yield an identical result.
 */
export function applyAction(state: GameState, action: Action, graph?: RegionGraph): TurnResult {
  let ctx: TurnContext =
    graph === undefined
      ? { state, action, scene: EMPTY_SCENE }
      : { state, action, scene: EMPTY_SCENE, graph };
  for (const stage of PIPELINE_STAGES) {
    ctx = stage.run(ctx);
  }
  return { state: ctx.state, scene: ctx.scene, changed: diffSystems(state, ctx.state) };
}
