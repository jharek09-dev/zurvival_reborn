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
 * player's needs, and stage 14 renders the next Scene. T14 turns stage 6 (updateNode) real: it
 * decays every node's noise and deposits the acting action's noise into node memory (FR-SIM-06).
 * The remaining world stages are still identity no-ops; each becomes a real system by swapping its
 * `run`, and the wiring never changes. A zero-cost `wait` with no graph passes through inertly —
 * the M0 empty-turn contract.
 *
 * Purity: stages never mutate their input and never read a clock or global RNG (ADR-0001). The
 * region `graph` is transient content the client rebuilds on load; it is threaded through the
 * turn context, never stored in state.
 */

import type { GameState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { advanceClock } from "../time/clock.js";
import { applyPlayerAction, assertLegal, sceneOf, tickNeeds } from "../actions/coreActions.js";
import { updateNodeNoise } from "../sim/noise.js";
import { decayShelterFortification, muffleShelterNoise } from "../sim/shelter.js";
import { runLayer, type SimContext } from "../sim/worldSim.js";
import { tickRoutes } from "../sim/routes.js";
import { tickNpcs } from "../sim/npcs.js";
import { tickCompanions } from "../sim/companions.js";
import { recordHistory, appendHistory } from "../sim/history.js";
import { evaluateArcs, resolveDueStoryEvents } from "../sim/story.js";
import { evaluateEvents, resolveDueEncounterEvents } from "../sim/events.js";
import { tickSpoilage } from "../sim/economy.js";
import { tickShelterOps } from "../sim/jobs.js";
import { tickPeople, tickGroups } from "../sim/social.js";
import { diffSystems } from "../telemetry/turnAudit.js";
import type { Action, Scene, SceneChoice, TurnResult } from "./contract.js";

export type { Action, Scene, SceneChoice, TurnResult } from "./contract.js";

// ---------------------------------------------------------------------------
// Pipeline internals
// ---------------------------------------------------------------------------

/** Everything a stage may read or replace as the turn flows through the pipeline. */
interface TurnContext {
  /** The turn's opening state — the baseline the Living History diffs against (T31). */
  readonly before: GameState;
  readonly state: GameState;
  readonly action: Action;
  readonly scene: Scene;
  /** Transient region graph (content), present for a real run; absent for the skeleton. */
  readonly graph?: RegionGraph;
}

/** A pipeline stage: a pure transform of the turn context. */
type StageFn = (ctx: TurnContext) => TurnContext;

/**
 * Stage 1: reject an action the current situation did not offer (FR-CORE-01). Any action answering a
 * Scene choice carries a `choiceId` and is validated; a bare `wait` (no choiceId) passes through, so
 * the M0 empty-turn contract holds. Skipped entirely without a graph (the pre-content skeleton).
 */
const validate: StageFn = (ctx) => {
  if (ctx.graph !== undefined && ctx.action.choiceId !== undefined) {
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

/** Stage 4: drift the player's needs by the hours spent (rest recovers fatigue), then age carried fresh
 * food (T51 spoilage, faster once the grid fails). Spoilage is inert without an active economy pool, so
 * the stage name / 14-stage order are unchanged and every prior run stays byte-identical — the body just
 * graduated, exactly as stage 6 added shelter upkeep. */
const updatePlayer: StageFn = (ctx) => {
  const withNeeds = tickNeeds(ctx.state, ctx.action);
  const hours = Math.max(0, Math.trunc(ctx.action.timeCost ?? 0));
  return { ...ctx, state: tickSpoilage(withNeeds, ctx.graph, hours) };
};

/** Build the world-sim context for a turn: the hours the action spent, plus the transient graph. */
const simCtx = (ctx: TurnContext): SimContext => {
  const hours = Math.max(0, Math.trunc(ctx.action.timeCost ?? 0));
  return ctx.graph === undefined ? { hours } : { hours, graph: ctx.graph };
};

/** Stage 5: advance the people — every living survivor's needs drift (T33), then the party companions
 * drift, follow the player, and can die (T36), then the shelter runs its jobs and feeds its residents from
 * the stash (T52). Was a no-op; the stage name and the 14-stage order are unchanged, only the body
 * graduated. Every tick is inert on a zero-hour turn / an empty pool — and the shelter-ops tick is dark
 * without a job pool, so every prior run stays byte-identical (exactly as T51 added spoilage to stage 4). */
const updateCompanions: StageFn = (ctx) => {
  const hours = Math.max(0, Math.trunc(ctx.action.timeCost ?? 0));
  const withNpcs = tickNpcs(ctx.state, hours);
  // The base runs its jobs and feeds its residents FIRST, then the party drifts and (starving) can die —
  // so a base with food in the cache keeps its people alive rather than losing them a beat before it feeds
  // them (PL-M3-01). Inert without a job pool, so tickCompanions sees the identical input on every prior run.
  const withOps = tickShelterOps(withNpcs, ctx.graph, hours);
  const withParty = tickCompanions(withOps, hours);
  // The social overlay (T53 · FR-NPC-05/07): seed inter-companion bonds, drift shelter morale, and resolve
  // desertion/betrayal. Inert without a faction pool, so every prior run sees the identical stage-5 output —
  // the body graduated exactly as T52 added shelter-ops here and T51 added spoilage to stage 4.
  return { ...ctx, state: tickPeople(withParty, ctx.graph, hours) };
};

/** Stage 6: decay/deposit node noise (T14), apply shelter fortification upkeep + noise muffle (T38), then
 * tick the node-local zombie state machine (T25). */
const updateNode: StageFn = (ctx) => {
  const hours = Math.max(0, Math.trunc(ctx.action.timeCost ?? 0));
  const withNoise = updateNodeNoise(ctx.state, ctx.action);
  // Shelter upkeep (T38): fortification decays with the hours, then a fortified base muffles its own noise
  // (the quieter value feeds the zombie stimulus below and the horde re-path next stage). Both inert without
  // a claimed shelter, so the M0 empty-turn contract and every prior run stay untouched.
  const decayed = decayShelterFortification(withNoise, hours);
  const muffled = muffleShelterNoise(decayed, hours);
  return { ...ctx, state: runLayer(muffled, "zombies", simCtx(ctx)) };
};

/** Stage 7: the regions layer — off-screen threat/density drift (T24) then the loot contest (T17). */
const updateRegion: StageFn = (ctx) => ({ ...ctx, state: runLayer(ctx.state, "regions", simCtx(ctx)) });

/**
 * Stage 8: the global layers — weather transitions (T27), then time-of-day danger (T28), then route
 * conditions (T29) drift from the resulting weather/roads. Routes are a stage-8 world effect, not a
 * seventh sim layer, so `tickWorld` still equals folding exactly the six layers.
 */
const updateWorld: StageFn = (ctx) => {
  const c = simCtx(ctx);
  const world = runLayer(runLayer(ctx.state, "weather", c), "timeOfDay", c);
  return { ...ctx, state: tickRoutes(world, c.hours) };
};

/** Stage 9: migrating hordes re-path to fresh noise and step over the graph (T26). */
const moveHordes: StageFn = (ctx) => ({ ...ctx, state: runLayer(ctx.state, "hordes", simCtx(ctx)) });

/**
 * Stage 10: move the people — off-screen survivors regroup a step toward their faction's home (T53 ·
 * PL-M3-02, the "survivors don't move" half). The reserved `identity` no-op graduates to a real gated body;
 * inert without a faction pool, so every prior run is byte-identical, and the stage NAME + 14-stage order
 * never change (pipeline.test asserts only names/order), exactly as stages 5/6 graduated.
 */
const moveGroups: StageFn = (ctx) => ({
  ...ctx,
  state: tickGroups(ctx.state, ctx.graph, Math.max(0, Math.trunc(ctx.action.timeCost ?? 0))),
});

/** Stage 11: the Apocalypse Director biases pacing without ever forcing an impossible state (T30). */
const tickDirector: StageFn = (ctx) => ({ ...ctx, state: runLayer(ctx.state, "director", simCtx(ctx)) });

/**
 * Stage 12: resolve any story consequence in the queue that has come due (T40) — the delayed good
 * repayment or the cold raid the arc enqueued when the player chose. Inert when the queue holds no due
 * story event, so every prior run (empty queue) is byte-identical; the stage name / order never move.
 */
const resolveQueue: StageFn = (ctx) => ({
  ...ctx,
  // T40 arc consequences, then T47 encounter follow-ups (a timed chain flag comes due). Both inert on
  // an empty queue, so every prior run (no scheduled events) is byte-identical.
  state: resolveDueEncounterEvents(resolveDueStoryEvents(ctx.state)),
});

/** Stage 14: project the resolved state into the Scene the client will render. */
const generateScene: StageFn = (ctx) => ({ ...ctx, scene: sceneOf(ctx.state, ctx.graph) });

/**
 * Stage 13: Living History — append the notable events this turn produced (weather, nightfall, horde
 * moves, route turns, a cleared fight, the run ending), diffed against the turn's opening state (T31).
 * Selective by design, so a quiet turn writes nothing and the FR-CORE-04 audit stays honest.
 */
const evaluateStory: StageFn = (ctx) => {
  // T40: advance the authored arcs first (auto-trigger a plea when the world has set the stage), so this
  // turn's beat is in the log; then T47: engage a fitting encounter from the registered pool (inert
  // without one); then record the Living History as before. Both beats land before the world events.
  const withArcs = evaluateArcs(ctx.state);
  // T48: don't OPEN a new encounter on a turn spent resolving one (an `event` action) — one scene closes
  // before the next opens, so the denser ambient pool can't stack a fresh beat onto a just-finished one.
  // A subsequent non-encounter action (move/search/wait) engages normally; inert for T47's sparse pool.
  const withEvents = ctx.action.type === "event" ? withArcs : evaluateEvents(withArcs, ctx.graph);
  const events = recordHistory(ctx.before, withEvents);
  const state = events.length === 0 ? withEvents : appendHistory(withEvents, events);
  return state === ctx.state ? ctx : { ...ctx, state };
};

/**
 * The 14 stages in their fixed, invariant order (DESIGN §5). Named for traceability and so tests
 * can assert the order never drifts. Unimplemented world stages remain `identity` until they land.
 */
export const PIPELINE_STAGES: readonly { readonly name: string; readonly run: StageFn }[] = [
  { name: "validate", run: validate },
  { name: "advanceTime", run: advanceTime },
  { name: "resolvePlayerAction", run: resolvePlayerAction },
  { name: "updatePlayer", run: updatePlayer },
  { name: "updateCompanions", run: updateCompanions },
  { name: "updateNode", run: updateNode },
  { name: "updateRegion", run: updateRegion },
  { name: "updateWorld", run: updateWorld },
  { name: "moveHordes", run: moveHordes },
  { name: "moveGroups", run: moveGroups },
  { name: "tickDirector", run: tickDirector },
  { name: "resolveQueue", run: resolveQueue },
  { name: "evaluateStory", run: evaluateStory },
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
      ? { before: state, state, action, scene: EMPTY_SCENE }
      : { before: state, state, action, scene: EMPTY_SCENE, graph };
  for (const stage of PIPELINE_STAGES) {
    ctx = stage.run(ctx);
  }
  return { state: ctx.state, scene: ctx.scene, changed: diffSystems(state, ctx.state) };
}
