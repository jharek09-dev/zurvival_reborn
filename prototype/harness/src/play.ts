/**
 * Story-first, single-decision play client (M1 task T19 · FR-UI-01/02/03/05).
 *
 * The first *real* client of `@zurvival/engine`: it presents the whole M1 loop as a short scene that
 * resolves to one decision, not a grid of bars. `renderScene` lays the screen out in the fixed
 * region order the UI contract mandates — header → status → story → choices → footer (FR-UI-01) —
 * showing only critical state, and only in words (FR-UI-02: infection is symptoms, never a number;
 * needs are prose, not gauges). Every listed choice is one the engine actually offers this turn and
 * advertises its *known* time cost but never its outcome (FR-UI-03). The layout is a single vertical
 * column that reads top-to-bottom, the mobile-first / one-hand shape later clients inherit (FR-UI-05).
 *
 * The module is deliberately pure — render and session fold state to text with no stdout, no
 * process, no clock — so a test drives exactly what a human sees. The interactive shell (stdin/exit)
 * lives in `main.ts`. Accessibility (T20) reads from the same `describe*` seam so a plain-text
 * transcript carries everything needed to play (NFR-ACC-01/02).
 */

import {
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  inventoryWeight,
  CARRY_CAPACITY,
  isWounded,
  worstWound,
  isRunOver,
  infectionLine,
  type Action,
  type GameState,
  type Scene,
  type SceneChoice,
  type TrackedSystem,
  type RegionGraph,
} from "../../engine/src/index.js";
import { screenForKey, screenLegend, SCREEN_KEYS, type ScreenId } from "./screens.js";

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Humanise a weather content id for the header: "weather.storm" -> "storm". */
function weatherLabel(id: string): string {
  const tail = id.split(".").slice(1).join(" ").trim();
  return tail.length > 0 ? tail : id;
}

/** Join a list into readable prose: "a", "a and b", "a, b, and c". */
function conjoin(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** A pressing need in words, or null when it isn't worth surfacing (FR-UI-02 — only critical stats). */
function describeNeed(kind: "hunger" | "thirst" | "fatigue", value: number): string | null {
  const scale: Record<typeof kind, readonly [string, string, string]> = {
    hunger: ["hungry", "ravenous", "starving"],
    thirst: ["thirsty", "parched", "dangerously dehydrated"],
    fatigue: ["tired", "weary", "exhausted"],
  } as const;
  if (value >= 85) return scale[kind][2];
  if (value >= 60) return scale[kind][1];
  if (value >= 34) return scale[kind][0];
  return null;
}

/** Humanise a wound content id: "wound.laceration" → "laceration". */
function woundName(typeId: string): string {
  const tail = typeId.split(".").slice(1).join(" ").trim();
  return tail.length > 0 ? tail : typeId;
}

/**
 * Infection as *symptoms*, never a number (FR-UI-02 · T49). Reads the engine's staged, honest symptom
 * line — feverish (symptomatic) → senses you can't trust (advanced) → a body giving out (terminal) —
 * or, once the player has diagnosed it, the stage named precisely. Null while healthy or still
 * asymptomatic (incubating): the clock is hidden and running, nothing to perceive yet. The four stages
 * read recognisably differently so a player can act on how bad it is with no hidden number.
 */
function describeInfection(state: GameState): string | null {
  return infectionLine(state);
}

/**
 * The critical status in words: pressing needs, the worst wound, infection symptoms, and the pack
 * load. Only what matters is shown (FR-UI-02); nothing is a bar; the pack is a plain count, not a
 * gauge. This `describe*` seam is the single source both the human render and a screen-reader view
 * read from (T20 · NFR-ACC-01/02).
 */
export function describeStatus(state: GameState): readonly string[] {
  const lines: string[] = [];
  const needs = state.player.condition.needs;
  const pressing = (["hunger", "thirst", "fatigue"] as const)
    .map((k) => describeNeed(k, needs[k]))
    .filter((s): s is string => s !== null);
  lines.push(pressing.length > 0 ? `You are ${conjoin(pressing)}.` : "You feel steady.");

  if (isWounded(state.player.condition)) {
    const w = worstWound(state.player.condition);
    if (w) {
      const care = w.treated > 0 ? "half-tended" : "untreated";
      lines.push(`A ${woundName(w.type)} on your ${w.site} is ${care}.`);
    }
  }

  const infection = describeInfection(state);
  if (infection) lines.push(infection);

  const weight = inventoryWeight(state.player.inventory);
  lines.push(
    weight >= CARRY_CAPACITY
      ? `Pack: ${weight}/${CARRY_CAPACITY} — full; you'll have to leave things behind.`
      : `Pack: ${weight}/${CARRY_CAPACITY}.`,
  );
  return lines;
}

/** One offered choice as a line: number, label, and its known time cost (a drop is "free"). */
export function describeChoice(index: number, choice: SceneChoice): string {
  const cost = choice.timeCost > 0 ? `${choice.timeCost}h` : "free";
  return `  ${index}. ${choice.label}  (${cost})`;
}

/**
 * The footer that closes the screen. It advertises the one decision (a choice number), the depth
 * screens on demand (FR-UI-04 — one key each, listed so nothing is missable, NFR-ACC-01), and the
 * save/quit verbs. Built from the screen registry so the legend can never drift out of sync.
 */
export const FOOTER = `[choice number · screens: ${screenLegend()} · S save · Q quit]`;

/**
 * The screen's regions, in the fixed navigable order a screen reader traverses (NFR-ACC-02). The
 * order never changes across turn types, so assistive tech and muscle memory both stay stable.
 */
export const SCREEN_REGION_ORDER = ["header", "status", "story", "prompt", "choices", "footer"] as const;
export type ScreenRegion = (typeof SCREEN_REGION_ORDER)[number];

/** A rendered screen decomposed into its labelled regions (the T20 accessibility seam). */
export type ScreenRegions = { readonly [R in ScreenRegion]: readonly string[] };

/**
 * Render a Scene + state into labelled regions. Every critical fact is in words (NFR-ACC-01): the
 * status carries needs/wounds/pack, the story carries place and any threat, and each choice carries
 * its known cost. Pure; no color, no glyph-only meaning — a screen reader gets everything.
 */
export function renderRegions(scene: Scene, state: GameState): ScreenRegions {
  return {
    header: [`Day ${scene.day} · ${scene.phase} · ${weatherLabel(state.world.weather)} · ${pad2(scene.hour)}:00 · turn ${scene.turn}`],
    status: [...describeStatus(state)],
    story: [scene.narration.trim().length > 0 ? scene.narration.trim() : "The world is quiet."],
    prompt: ["What do you do?"],
    choices:
      scene.choices.length > 0
        ? scene.choices.map((c, i) => describeChoice(i + 1, c))
        : ["  (no choices available)"],
    footer: [FOOTER],
  };
}

/**
 * Render a Scene + state as the story-first screen: header → status → story → choices → footer, in
 * that fixed order (FR-UI-01). Pure — returns lines, prints nothing. A blank line separates regions
 * so the column reads cleanly top-to-bottom (FR-UI-05 one-hand shape).
 */
export function renderScene(scene: Scene, state: GameState): readonly string[] {
  const r = renderRegions(scene, state);
  const lines: string[] = [];
  SCREEN_REGION_ORDER.forEach((region, i) => {
    // Blank line between regions, except keep the prompt attached to its choice list (one Q&A block).
    if (i > 0 && region !== "choices") lines.push("");
    lines.push(...r[region]);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Session — fold chosen choice-ids into resolved turns (pure)
// ---------------------------------------------------------------------------

/** One resolved turn of a session: the choice taken and the state + scene it produced. */
export interface PlayedTurn {
  readonly choiceId: string;
  readonly changed: readonly TrackedSystem[];
  readonly scene: Scene;
  readonly state: GameState;
}

/** The whole played session: the opening scene, each resolved turn, and the final state. */
export interface SessionResult {
  readonly initial: GameState;
  readonly opening: Scene;
  readonly turns: readonly PlayedTurn[];
  readonly final: GameState;
}

/** Thrown when a submitted choice-id was not offered at the current state (a client-side bug). */
export class UnofferedChoiceError extends Error {
  constructor(choiceId: string, at: string) {
    super(`choice ${JSON.stringify(choiceId)} is not offered at "${at}"`);
    this.name = "UnofferedChoiceError";
  }
}

/** Resolve the offered choice with `id` at the current state, or throw. */
function actionFor(state: GameState, graph: RegionGraph, id: string): Action {
  const choice = availableActions(state, graph).find((c) => c.id === id);
  if (!choice) throw new UnofferedChoiceError(id, state.player.location);
  return choice.action;
}

/**
 * Play a scripted sequence of choice-ids from `state`, resolving each through the pipeline. Pure and
 * deterministic: identical (state, graph, choiceIds) always yield the same session. Every choice is
 * validated against what the engine offers that turn (FR-CORE-01 / FR-UI-03 — no fake choices).
 */
export function playSession(
  state: GameState,
  graph: RegionGraph,
  choiceIds: readonly string[],
): SessionResult {
  const opening = sceneOf(state, graph);
  const turns: PlayedTurn[] = [];
  let current = state;
  for (const id of choiceIds) {
    const action = actionFor(current, graph, id);
    const result = applyAction(current, action, graph);
    turns.push({ choiceId: id, changed: result.changed, scene: result.scene, state: result.state });
    current = result.state;
  }
  return { initial: state, opening, turns, final: current };
}

/**
 * A full session as a readable transcript — the opening scene, then for each turn the choice taken
 * and the scene it produced. This is the plain-text artifact the accessibility contract (T20) leans
 * on: everything needed to follow the run is in the text, no color or audio required (NFR-ACC-01).
 */
export function transcript(session: SessionResult): readonly string[] {
  const lines: string[] = [...renderScene(session.opening, session.initial)];
  for (const t of session.turns) {
    lines.push("", `> you chose: ${t.choiceId}`, "", ...renderScene(t.scene, t.state));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Keyboard input — number-key selection, no pointer, no timing (T20 · NFR-ACC-02)
// ---------------------------------------------------------------------------

/**
 * A parsed keyboard command. Play is entirely keyboard-driven: a choice is picked by typing its
 * 1-based number, "S" saves and quits, "Q" quits without saving. Anything else is `invalid` and the
 * caller re-prompts — nothing is reachable only by a pointer or a timed input (NFR-ACC-02).
 */
export type Command =
  | { readonly kind: "choice"; readonly choiceId: string }
  | { readonly kind: "screen"; readonly screenId: ScreenId }
  | { readonly kind: "save" }
  | { readonly kind: "quit" }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Parse a line of keyboard input against the scene's offered choices. Pure. A digit selects a choice;
 * `S`/`Q` save/quit; a screen key (see {@link SCREEN_KEYS}) opens a depth screen on demand (FR-UI-04) —
 * a screen is a read-only overlay, so the caller shows it and returns without resolving a turn.
 */
export function parseCommand(scene: Scene, input: string): Command {
  const t = input.trim().toLowerCase();
  if (t === "s") return { kind: "save" };
  if (t === "q") return { kind: "quit" };
  const screen = screenForKey(t);
  if (screen) return { kind: "screen", screenId: screen.id };
  if (!/^\d+$/.test(t))
    return {
      kind: "invalid",
      reason: `type a number 1–${scene.choices.length}, a screen key (${SCREEN_KEYS.map((k) => k.toUpperCase()).join("/")}), S, or Q`,
    };
  const n = Number.parseInt(t, 10);
  const choice = scene.choices[n - 1];
  if (choice === undefined) return { kind: "invalid", reason: `no choice ${n} — pick 1–${scene.choices.length}` };
  return { kind: "choice", choiceId: choice.id };
}

/** Why an input-driven play run stopped. */
export type StopReason = "save" | "quit" | "end-of-input";

/** Result of playing from keyboard input: the session so far, why it stopped, and any screens opened. */
export interface InputPlayResult {
  readonly session: SessionResult;
  readonly stopped: StopReason;
  /**
   * Depth screens opened during play, in the order the keys were pressed (FR-UI-04). Each was a free
   * read-only overlay — it never resolved a turn — so this list is proof the keyboard reaches the
   * screens without spending time or changing state.
   */
  readonly screensViewed: readonly ScreenId[];
}

/**
 * Play from a list of raw keyboard inputs (as a human would type them), resolving each number to the
 * choice it selects. Proves number-key play drives a whole slice with no pointer (NFR-ACC-02). Stops
 * on "S"/"Q" or when inputs run out; `invalid` inputs are skipped (a real UI re-prompts). Pure.
 */
export function playByInputs(
  state: GameState,
  graph: RegionGraph,
  inputs: readonly string[],
): InputPlayResult {
  const chosen: string[] = [];
  const screensViewed: ScreenId[] = [];
  let current = state;
  let stopped: StopReason = "end-of-input";
  for (const raw of inputs) {
    const scene = sceneOf(current, graph);
    const cmd = parseCommand(scene, raw);
    if (cmd.kind === "save") { stopped = "save"; break; }
    if (cmd.kind === "quit") { stopped = "quit"; break; }
    if (cmd.kind === "screen") { screensViewed.push(cmd.screenId); continue; } // a free overlay — no turn resolves
    if (cmd.kind === "invalid") continue;
    chosen.push(cmd.choiceId);
    current = applyAction(current, actionFor(current, graph, cmd.choiceId), graph).state;
  }
  return { session: playSession(state, graph, chosen), stopped, screensViewed };
}


// ---------------------------------------------------------------------------
// Quit / resume seam — lossless at any turn boundary (T21 · ADR-0003 · NFR-SAVE)
// ---------------------------------------------------------------------------

/**
 * Serialize a run to the T7 `SaveFile` string the client persists (the engine does no I/O; the
 * client owns storage per ADR-0003). Pure passthrough — the byte-lossless envelope is the engine's.
 */
export function saveState(state: GameState): string {
  return saveGame(state);
}

/**
 * Resume a run from a saved string and play more choices. The transient region `graph` is rebuilt
 * from content by the caller (never stored in state, since T11), so a run reconstructs from the save
 * text alone. Resuming and continuing is byte-identical to never having stopped (T21 DoD). Pure.
 */
export function resumeSession(
  saveText: string,
  graph: RegionGraph,
  choiceIds: readonly string[],
): SessionResult {
  return playSession(loadGame(saveText), graph, choiceIds);
}


/** True once the run has ended (death) — the client shows the final scene and stops (T22). */
export function runEnded(session: SessionResult): boolean {
  return isRunOver(session.final);
}
