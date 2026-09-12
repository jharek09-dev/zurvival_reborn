/**
 * Checks — the named invariants the Test Lab holds every turn against.
 *
 * Each check is a pure function of engine state (and the harness renderers) that returns `null` when the
 * invariant holds or a short human-readable detail when it does not. The runner wraps them, attributes a
 * failure to the turn and the action that produced it, and never stops the run on a failure — one report
 * should show everything that is wrong, not just the first thing.
 *
 * Every check traces to a requirement or an existing test so a red result means something a designer can
 * act on; see {@link CHECKS} for the map.
 */

import {
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  isRunOver,
  runEndReason,
  auditTurn,
  type Action,
  type GameState,
  type RegionGraph,
  type Scene,
} from "../../engine/src/index.js";
import { renderScene, renderRegions, renderDepthScreen, DEPTH_SCREENS } from "../../harness/src/index.js";

export type CheckId =
  | "CHK-LEGAL"
  | "CHK-DET"
  | "CHK-AUDIT"
  | "CHK-TURN"
  | "CHK-INT"
  | "CHK-SAVE"
  | "CHK-RESUME"
  | "CHK-RENDER"
  | "CHK-LEAK"
  | "CHK-END"
  | "CHK-PERF"
  | "CHK-CRASH"
  | "CHK-REPLAY";

export interface CheckInfo {
  readonly id: CheckId;
  readonly title: string;
  /** What breaks in the game if this fails. */
  readonly why: string;
  /** Requirement / test-case ids this re-proves. */
  readonly traces: string;
}

export const CHECKS: readonly CheckInfo[] = [
  { id: "CHK-LEGAL", title: "A legal choice is always offered", why: "A dead end soft-locks the run.", traces: "M4 DoD §4 · exitGate.test.ts soft-lock probe" },
  { id: "CHK-DET", title: "Same state + action resolves identically twice", why: "Determinism drift makes bug reports unreproducible.", traces: "TC-DET-01 · NFR-REL-01" },
  { id: "CHK-AUDIT", title: "A resolved turn changes at least one tracked system", why: "A no-consequence turn breaks the core loop promise.", traces: "FR-CORE-04 · telemetry.test.ts" },
  { id: "CHK-TURN", title: "The clock advances exactly as the choice's cost says", why: "A skipped or double-counted turn corrupts cooldowns and history.", traces: "pipeline contract · time/clock.ts" },
  { id: "CHK-INT", title: "Every number in state is an integer", why: "A float in state means a save that does not round-trip and a sim that drifts.", traces: "ADR-0001 numeric discipline · loop.test.ts assertIntegerLeaves" },
  { id: "CHK-SAVE", title: "Save then load reproduces the state exactly", why: "Save corruption is a zero-tolerance defect.", traces: "TC-DET-05 · NFR-SAVE-01" },
  { id: "CHK-RESUME", title: "Continuing from a save equals never having stopped", why: "Quit/resume must be lossless at every turn boundary.", traces: "TC-DET-04 · T21" },
  { id: "CHK-RENDER", title: "The scene and all five depth screens render", why: "A renderer throw is a crash in the client.", traces: "M4 DoD §4 'boots and plays' · screens.test.ts" },
  { id: "CHK-LEAK", title: "No hidden number reaches the status line", why: "Infection/stress are identity, never a number.", traces: "INV-07 · FR-UI-02 · QA §8.4 #6" },
  { id: "CHK-END", title: "A run ends only for a known reason, with no choices after", why: "An undefined ending is a soft-lock in disguise.", traces: "T22 · FR-INJ-08" },
  { id: "CHK-PERF", title: "Resolve + render stays inside the turn budget", why: "The phone budget is 100 ms per turn.", traces: "NFR-PERF-01 · TC-NFR-01 (desktop proxy)" },
  { id: "CHK-CRASH", title: "The engine never throws", why: "A crash in the core loop counts against crash-free ≥ 99.5%.", traces: "NFR-REL-01 · QA §8.4 #3" },
  { id: "CHK-REPLAY", title: "Replaying the recorded choices from the seed reproduces the run", why: "Repro-from-seed is what every beta bug report leans on.", traces: "TC-DET-02 · exitGate.test.ts repro-from-seed" },
];

export const CHECK_IDS: readonly CheckId[] = CHECKS.map((c) => c.id);

export function checkInfo(id: CheckId): CheckInfo {
  return CHECKS.find((c) => c.id === id)!;
}

/** One failed check, attributed to the turn that produced it. */
export interface Failure {
  readonly id: CheckId;
  /** `meta.turn` AFTER the action (or at the moment of a post-run check). */
  readonly turn: number;
  /** 0-based index into the run's recorded choice list (the action that produced this), or null. */
  readonly step: number | null;
  readonly action: string | null;
  readonly detail: string;
  readonly stack?: string;
}

// ---------------------------------------------------------------------------
// Structural equality — state is plain JSON, so a small recursive compare is all we need (and it works in
// the browser, which has no node:util). Key order is irrelevant; NaN never equals; -0 equals 0 here and is
// caught by CHK-INT instead.
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The path of the first difference between two JSON values, or null when they are deep-equal. */
export function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: ${describe(a)} vs ${describe(b)}`;
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    for (const k of ka) if (!(k in b)) return `${path}.${k}: present vs missing`;
    for (const k of kb) if (!(k in a)) return `${path}.${k}: missing vs present`;
    for (const k of ka) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d !== null) return d;
    }
    return null;
  }
  return `${path}: ${describe(a)} vs ${describe(b)}`;
}

export const deepEqual = (a: unknown, b: unknown): boolean => firstDiff(a, b) === null;

function describe(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (typeof v === "number" && Object.is(v, -0)) return "-0";
  if (v === undefined) return "undefined";
  if (typeof v === "object" && v !== null) return Array.isArray(v) ? `array(${v.length})` : `object(${Object.keys(v).length} keys)`;
  return String(v);
}

// ---------------------------------------------------------------------------
// The per-turn checks
// ---------------------------------------------------------------------------

/** CHK-INT — the path of the first non-integer number in `value`, or null. `-0` is reported distinctly. */
export function checkIntegers(value: unknown, path = "$"): string | null {
  if (typeof value === "number") {
    if (Object.is(value, -0)) return `${path} is -0 (JSON drops the sign)`;
    if (!Number.isInteger(value)) return `${path} = ${value}`;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const d = checkIntegers(value[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (isObj(value)) {
    for (const k of Object.keys(value)) {
      const d = checkIntegers(value[k], `${path}.${k}`);
      if (d !== null) return d;
    }
  }
  return null;
}

/** CHK-TURN — the clock moved exactly as the choice's advertised cost implies. */
export function checkTurn(before: GameState, after: GameState, timeCost: number): string | null {
  const dt = after.meta.turn - before.meta.turn;
  if (timeCost > 0 && dt !== 1) return `timeCost ${timeCost}h but meta.turn moved ${before.meta.turn} → ${after.meta.turn}`;
  if (timeCost === 0 && dt !== 0) return `free choice but meta.turn moved ${before.meta.turn} → ${after.meta.turn}`;
  const dd = after.meta.day - before.meta.day;
  if (dd < 0) return `meta.day went backwards ${before.meta.day} → ${after.meta.day}`;
  if (dd > 1) return `meta.day jumped ${before.meta.day} → ${after.meta.day} in one action`;
  return null;
}

/** CHK-AUDIT — FR-CORE-04 via the engine's own auditor. */
export function checkAudit(before: GameState, after: GameState): string | null {
  const audit = auditTurn(before, after);
  return audit.ok ? null : `resolved turn ${audit.turn} changed no tracked system`;
}

/** CHK-DET — the same (state, action) resolves to the same state and scene a second time. */
export function checkDeterminism(before: GameState, action: Action, graph: RegionGraph, first: { state: GameState; scene: Scene }): string | null {
  const again = applyAction(before, action, graph);
  const ds = firstDiff(first.state, again.state, "state");
  if (ds !== null) return ds;
  const dc = firstDiff(first.scene, again.scene, "scene");
  return dc;
}

/** CHK-SAVE — the shipped envelope round-trips deep-equal. */
export function checkSaveRoundTrip(state: GameState): string | null {
  const text = saveGame(state);
  const back = loadGame(text);
  return firstDiff(state, back, "state");
}

/** CHK-RESUME — one more turn from the loaded state equals one more turn from the live state. */
export function checkResume(before: GameState, action: Action, graph: RegionGraph, liveAfter: GameState): string | null {
  const resumed = loadGame(saveGame(before));
  const after = applyAction(resumed, action, graph).state;
  return firstDiff(liveAfter, after, "state");
}

/** CHK-LEAK — the status region carries no digits except the `Pack: n/m` line. */
export function checkLeak(statusLines: readonly string[]): string | null {
  for (const line of statusLines) {
    if (/^Pack:/.test(line)) continue;
    if (/\d/.test(line)) return `status line carries a number: ${JSON.stringify(line)}`;
  }
  return null;
}

const END_REASONS: ReadonlySet<string> = new Set(["starved", "dehydrated", "infection"]);

/** CHK-END — an ended run ended for a known reason and offers nothing further. */
export function checkEnd(state: GameState, graph: RegionGraph): string | null {
  if (!isRunOver(state)) return null;
  const reason = runEndReason(state);
  if (reason === null || !END_REASONS.has(reason)) return `run is over but runEndReason is ${String(reason)}`;
  const offered = availableActions(state, graph);
  if (offered.length > 0) return `run ended (${reason}) but ${offered.length} choice(s) still offered`;
  const scene = sceneOf(state, graph);
  if (scene.choices.length > 0) return `run ended (${reason}) but the scene lists ${scene.choices.length} choice(s)`;
  return null;
}

/** What the renderers produced this turn — the UI shows it; the checks read it. */
export interface Rendered {
  readonly scene: Scene;
  readonly lines: readonly string[];
  readonly status: readonly string[];
  readonly screens: { readonly [id: string]: readonly string[] };
}

/**
 * Render everything a player could look at this turn: the scene and all five depth screens. Throws if a
 * renderer throws (the runner turns that into CHK-CRASH); returns the output for CHK-RENDER / CHK-LEAK.
 */
export function renderAll(state: GameState, graph: RegionGraph): Rendered {
  const scene = sceneOf(state, graph);
  const lines = renderScene(scene, state, graph);
  const regions = renderRegions(scene, state, graph);
  const screens: { [id: string]: readonly string[] } = {};
  for (const s of DEPTH_SCREENS) screens[s.id] = renderDepthScreen(s.id, state, graph);
  return { scene, lines, status: regions.status, screens };
}

/** CHK-RENDER — every rendered surface is non-empty. */
export function checkRender(r: Rendered): string | null {
  if (r.lines.length === 0) return "renderScene returned no lines";
  for (const [id, lines] of Object.entries(r.screens)) if (lines.length === 0) return `depth screen ${id} rendered empty`;
  return null;
}

/** Percentile of a sorted-or-not sample (nearest rank). */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}
