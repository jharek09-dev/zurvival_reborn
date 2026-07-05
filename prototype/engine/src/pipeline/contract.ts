/**
 * The engine ↔ client contract (M1 · DESIGN §10). Extracted from the pipeline so both the
 * pipeline (which produces a Scene) and the action layer (which offers the choices and validates
 * the answer) can share these shapes without an import cycle.
 *
 * The contract is deliberately tiny and one-directional: the engine emits a `Scene`, the client
 * picks one `SceneChoice` and submits its `action`. There is no `choice → scene` edge — the next
 * Scene is a pure function of the resolved state (FR-CORE-01), so a choice can advertise its
 * *cost* but never its *outcome*.
 */

import type { GameState, NodeId } from "../state/types.js";
import type { TrackedSystem } from "../telemetry/turnAudit.js";

/**
 * A player's chosen action for the turn. `choiceId` ties it back to the Scene choice it answers
 * (validated in stage 1); `timeCost` is the hours it spends (stage 2); `params` carries
 * action-specific data (e.g. the move target) read by the owning system in stage 3.
 */
export interface Action {
  /** Action kind: "move" | "search" | "rest" | "wait" (engine/content-defined). */
  readonly type: string;
  readonly choiceId?: string;
  /** Turn time cost in in-game hours; spent by advanceTime. */
  readonly timeCost?: number;
  readonly params?: { readonly [key: string]: unknown };
}

/**
 * One offered choice in a Scene: a stable id, a human label, the time it will cost (known), and
 * the concrete `action` the client submits to take it. The outcome stays hidden (DESIGN §10).
 */
export interface SceneChoice {
  readonly id: string;
  readonly label: string;
  /** Known time cost in hours. */
  readonly timeCost: number;
  /** The exact action to submit for this choice. */
  readonly action: Action;
}

/**
 * The systemic snapshot the client renders (stage 14, the sole producer). Answers the Four
 * Questions (FR-CORE-05): where (`location` + clock), what's happening / what changed
 * (`narration`), and what can I do (`choices`).
 */
export interface Scene {
  readonly turn: number;
  readonly day: number;
  readonly hour: number;
  readonly phase: GameState["meta"]["phase"];
  /** Where the player is — the current node id; omitted in the pre-content skeleton. */
  readonly location?: NodeId;
  /** Narrative prose for the moment; empty in the M0 skeleton. */
  readonly narration: string;
  readonly choices: readonly SceneChoice[];
}

/** What `applyAction` returns: the advanced state and the next Scene to present. */
export interface TurnResult {
  readonly state: GameState;
  readonly scene: Scene;
  /**
   * FR-CORE-04 telemetry: the tracked systems this turn changed (by value), in
   * `TRACKED_SYSTEMS` order. Instrumented by the pipeline, not derived by the client — a resolved
   * turn is expected to list at least one system, and an empty list on a resolved turn is a
   * no-consequence turn the audit exists to catch. Empty for an inert `wait` (no turn resolved).
   */
  readonly changed: readonly TrackedSystem[];
}
