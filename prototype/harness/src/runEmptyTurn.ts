/**
 * Terminal harness — run one empty turn (M0 task T9 · DESIGN §10, §5 · QA §5 M0 exit).
 *
 * The first *client* of `@zurvival/engine`: a headless terminal driver that stands the
 * skeleton up end to end — create a run, resolve one turn through the 14-stage pipeline,
 * and render the returned `Scene`. In M0 every gameplay stage is a no-op, so "an empty
 * turn" is exactly the point: it proves the wiring runs deterministically before any system
 * exists (M0 Definition of Done, PRODUCTION §3).
 *
 * This module is deliberately pure — it returns the run and the text to print rather than
 * writing to the console — so a Vitest test can assert on the same thing a human sees. The
 * `main.ts` entry is the only place that touches stdout / process exit.
 *
 * As a *client* the harness may read a clock and pass `createdAt` in; the wall-clock ban is
 * an engine-core rule (ADR-0001), not a client one. The engine never sees it as anything but
 * data.
 */

import {
  applyAction,
  createInitialState,
  describeSave,
  loadGame,
  saveGame,
  type Action,
  type GameState,
  type Scene,
} from "../../engine/src/index.js";

export interface HarnessOptions {
  /** Run seed — the sole origin of all randomness (DESIGN §9). */
  readonly seed: string;
  /** ISO-8601 creation timestamp, supplied by this client. */
  readonly createdAt: string;
  /** Optional starting node id (defaults to the engine placeholder). */
  readonly startLocation?: string;
}

/** Everything one harness turn produces — the run, the Scene, and the M0 exit proofs. */
export interface EmptyTurnResult {
  readonly initial: GameState;
  readonly next: GameState;
  readonly scene: Scene;
  /** M0 DoD: same seed + state + action ⇒ byte-identical result. */
  readonly deterministic: boolean;
  /** NFR-SAVE-01: loadGame(saveGame(state)) reproduces the state exactly. */
  readonly saveRoundTrips: boolean;
  /** The terminal render — the lines `main.ts` prints. */
  readonly lines: readonly string[];
}

/** The turn the harness submits: a zero-cost wait. */
export const WAIT_ACTION: Action = { type: "wait" };

const RULE = "─".repeat(52);
const check = (ok: boolean): string => (ok ? "✓" : "✗ FAILED");
const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Render a Scene as terminal lines (story-first shell; empty in M0). */
function renderScene(seed: string, scene: Scene): string[] {
  const clock = `Day ${scene.day} · ${pad2(scene.hour)}:00 · ${scene.phase} · turn ${scene.turn}`;
  const narration =
    scene.narration.trim().length > 0
      ? scene.narration
      : "(no narration yet — the M0 skeleton runs an empty turn)";
  const choices =
    scene.choices.length > 0
      ? scene.choices.map((c, i) => `  ${i + 1}. ${c.label}`)
      : ["  (no choices — systems arrive in M1)"];
  return [
    "Zurvival Reborn — terminal harness (M0 · T9)",
    `seed: ${seed}`,
    RULE,
    clock,
    narration,
    "What can I do?",
    ...choices,
    RULE,
  ];
}

/**
 * Create a run, resolve one empty turn, and return the result plus its render and proofs.
 * Pure: no console, no process, no clock of its own (the caller supplies `createdAt`).
 */
export function runEmptyTurn(opts: HarnessOptions): EmptyTurnResult {
  const initial = createInitialState(
    opts.startLocation === undefined
      ? { seed: opts.seed, createdAt: opts.createdAt }
      : { seed: opts.seed, createdAt: opts.createdAt, startLocation: opts.startLocation },
  );

  const a = applyAction(initial, WAIT_ACTION);
  const b = applyAction(initial, WAIT_ACTION);
  const deterministic = JSON.stringify(a) === JSON.stringify(b);

  const roundTripped = loadGame(saveGame(a.state));
  const saveRoundTrips = JSON.stringify(roundTripped) === JSON.stringify(a.state);

  const lines = [
    ...renderScene(opts.seed, a.scene),
    `save: ${describeSave(a.state)}`,
    `determinism (same seed+state+action ⇒ byte-identical): ${check(deterministic)}`,
    `save round-trip (load(save(state)) deep-equal): ${check(saveRoundTrips)}`,
  ];

  return { initial, next: a.state, scene: a.scene, deterministic, saveRoundTrips, lines };
}
