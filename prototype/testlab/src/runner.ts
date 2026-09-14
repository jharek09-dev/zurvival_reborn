/**
 * Runner — one run of the real engine, stepped a turn at a time, with every check applied per turn.
 *
 * The runner is a STEPPER, not a loop, so the browser app can drive it at any speed (instant, animated,
 * paused, or with a human clicking the choice), while the CLI and the tests simply call `runToEnd`. A step
 * is: read the offered choices → pick one (policy or human) → time `applyAction` + a full render → run the
 * checks → record a timeline point. Failures never abort a run; an exception becomes CHK-CRASH and ends it.
 *
 * All of it is pure with respect to the outside world: no clock other than `performance.now` for the perf
 * measurement (a client is allowed a clock — only the engine core is not), no I/O, no DOM.
 */

import {
  applyAction,
  availableActions,
  sceneOf,
  isRunOver,
  runEndReason,
  type RunEndReason,
  saveGame,
  samplePacing,
  summarizePacing,
  summarizeRunRepetition,
  stageRank,
  type GameState,
  type RegionGraph,
  type SceneChoice,
  type DifficultyMode,
  type PacingSummary,
  type RepetitionSummary,
  type Infection,
} from "../../engine/src/index.js";
import { transcript, playSession } from "../../harness/src/index.js";
import { bootCity, graphFor, type Content } from "./boot.js";
import { policyFor, policyRng, kindOf, ZERO_COST_KINDS, ESCAPE_KINDS, FIGHT_KINDS, type PolicyName } from "./policies.js";
import {
  checkAudit,
  checkDeterminism,
  checkEnd,
  checkIntegers,
  checkLeak,
  checkRender,
  checkResume,
  checkSaveRoundTrip,
  checkTurn,
  firstDiff,
  percentile,
  renderAll,
  type CheckId,
  type Failure,
  type Rendered,
} from "./checks.js";

/** Everything that defines one run. Two runs with equal specs (and content) produce equal reports. */
export interface RunSpec {
  readonly seed: string;
  readonly policy: PolicyName;
  /** Cap on ACTIONS taken (free actions count) — the run also ends on death. */
  readonly turns: number;
  readonly stocked: boolean;
  readonly difficulty?: DifficultyMode;
  readonly ironman?: boolean;
  /** CHK-PERF fails only when a single turn's resolve+render exceeds this (ms). */
  readonly budgetMs: number;
  /** Run CHK-SAVE / CHK-RESUME every N actions (and always at the end). 0 = only at the end. */
  readonly saveSample: number;
  /** Run CHK-DET every N actions. 0 = never. */
  readonly detSample: number;
  /** Run CHK-REPLAY at the end (replays the recorded choices from a fresh boot). */
  readonly replay: boolean;
}

export const DEFAULT_SPEC: Omit<RunSpec, "seed" | "policy"> = {
  turns: 400,
  stocked: true,
  budgetMs: 100,
  saveSample: 10,
  detSample: 1,
  replay: true,
};

/** One point per action — what the app charts and what a failure is pinned to. */
export interface TimelinePoint {
  readonly step: number;
  readonly turn: number;
  readonly day: number;
  readonly hour: number;
  readonly action: string;
  readonly timeCost: number;
  readonly ms: number;
  readonly hunger: number;
  readonly thirst: number;
  readonly fatigue: number;
  readonly infection: Infection["stage"];
  readonly wounds: number;
  readonly walkersHere: number;
  readonly pressure: number;
  readonly globalThreat: number;
  readonly historyLen: number;
  readonly inCombat: boolean;
  readonly failures: number;
}

/**
 * How a Lab run finished: one of the engine's own run-end reasons, or one of the Lab's three outcomes
 * that are not deaths.
 *
 * **Derived from `RunEndReason`, never re-typed.** This was a hand-written union listing three of the
 * engine's reasons, laundered past the compiler by the `as EndKind` casts below — so when T82 added a
 * fourth (`lastStand`), `tsc` stayed green while half the `fighter` runs reported a value outside the
 * declared type. The sibling copy in `checks.ts` failed loudly on the same change; this one failed
 * silently, which is worse. Widening `RunEndReason` now widens this automatically.
 */
export type EndKind = RunEndReason | "alive" | "crashed" | "soft-locked";

export interface PerfStats {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  /** The step index of the slowest action. */
  readonly maxStep: number;
}

export interface Coverage {
  /** Distinct choice verbs taken, with counts. */
  readonly kinds: { readonly [kind: string]: number };
  readonly nodesVisited: number;
  readonly regionsVisited: number;
  readonly combatsEntered: number;
  readonly overrunsMet: number;
  readonly escapesTaken: number;
  readonly fightsTaken: number;
  readonly deepestInfection: Infection["stage"];
  readonly woundsSuffered: number;
  readonly companionsMax: number;
  readonly arcsTouched: number;
  readonly encountersFired: number;
}

export interface RunReport {
  readonly spec: RunSpec;
  /** Whether the run was resumed from a supplied save rather than booted from the seed. */
  readonly resumed: boolean;
  readonly ok: boolean;
  readonly actions: number;
  readonly resolvedTurns: number;
  readonly end: EndKind;
  readonly endDay: number;
  readonly endTurn: number;
  readonly failures: readonly Failure[];
  readonly failuresByCheck: { readonly [id: string]: number };
  readonly perf: PerfStats;
  readonly coverage: Coverage;
  readonly historyLen: number;
  readonly historyPerTurn: number;
  readonly saveBytes: number;
  readonly repetition: RepetitionSummary;
  readonly pacing: PacingSummary;
  readonly timeline: readonly TimelinePoint[];
  /** The recorded choice ids — replay these from the same boot to reproduce the run. */
  readonly choiceIds: readonly string[];
}

export interface StepResult {
  readonly choice: SceneChoice | null;
  readonly state: GameState;
  readonly rendered: Rendered | null;
  readonly failures: readonly Failure[];
  readonly ms: number;
  readonly done: boolean;
}

/** Test seam: the runner's own dependencies, overridable so a test can prove a check fires. */
export interface RunHooks {
  readonly render?: (state: GameState, graph: RegionGraph) => Rendered;
  /** Called with the state after each action; whatever it returns replaces it (a test can inject a float). */
  readonly mutate?: (state: GameState, step: number) => GameState;
  readonly now?: () => number;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** A live run: step it, watch it, finish it. */
export class RunSession {
  readonly spec: RunSpec;
  readonly graph: RegionGraph;
  readonly resumed: boolean;
  state: GameState;
  /** The state the run started from (the boot, or the loaded save) — replay re-runs from here. */
  readonly initial: GameState;
  readonly failures: Failure[] = [];
  readonly timeline: TimelinePoint[] = [];
  readonly choiceIds: string[] = [];
  private readonly rng: () => number;
  private readonly hooks: RunHooks;
  private readonly content: Content;
  private zeroCostStreak = 0;
  private endKind: EndKind | null = null;
  private lastRendered: Rendered | null = null;
  private readonly durations: number[] = [];
  private readonly visitedNodes = new Set<string>();
  private readonly visitedRegions = new Set<string>();
  private readonly kinds: { [kind: string]: number } = {};
  private combatsEntered = 0;
  private overrunsMet = 0;
  private escapesTaken = 0;
  private fightsTaken = 0;
  private deepest = 0;
  private woundsSuffered = 0;
  private companionsMax = 0;

  constructor(content: Content, spec: RunSpec, from?: GameState, hooks: RunHooks = {}) {
    this.content = content;
    this.spec = spec;
    this.hooks = hooks;
    if (from !== undefined) {
      this.state = from;
      this.graph = graphFor(content);
      this.resumed = true;
    } else {
      const boot = bootCity(content, spec.seed, {
        stocked: spec.stocked,
        ...(spec.difficulty ? { difficulty: spec.difficulty } : {}),
        ...(spec.ironman ? { ironman: true } : {}),
      });
      this.state = boot.state;
      this.graph = boot.graph;
      this.resumed = false;
    }
    this.initial = this.state;
    this.rng = policyRng(`policy:${spec.policy}:${spec.seed}`);
    this.noteVisit(this.state);
    this.deepest = stageRank(this.state.player.condition.infection.stage);
    this.companionsMax = Object.keys(this.state.actors).length;
    if (isRunOver(this.state)) this.endKind = runEndReason(this.state) ?? "alive";
  }

  get done(): boolean {
    return this.endKind !== null || this.choiceIds.length >= this.spec.turns;
  }

  get end(): EndKind {
    return this.endKind ?? "alive";
  }

  /** The choices offered right now (empty once the run is over). */
  choices(): readonly SceneChoice[] {
    return availableActions(this.state, this.graph);
  }

  /** What the policy WOULD pick now, without taking it (the app highlights it before the bot moves). */
  peek(): SceneChoice | null {
    const choices = this.choices();
    if (choices.length === 0) return null;
    // Peeking must not consume policy randomness, so run the policy on a forked rng.
    const forked = policyRng(`peek:${this.spec.policy}:${this.spec.seed}:${this.choiceIds.length}`);
    return policyFor(this.spec.policy)({ state: this.state, choices, rng: forked, zeroCostStreak: this.zeroCostStreak });
  }

  /** The last full render (scene + status + screens), or a fresh one. */
  rendered(): Rendered {
    return this.lastRendered ?? (this.hooks.render ?? renderAll)(this.state, this.graph);
  }

  /**
   * Take one action. With no argument the policy picks; with a choice (by object or id) a human picks —
   * both paths run exactly the same checks. Returns what happened; `done` says whether the run is over.
   */
  step(pick?: SceneChoice | string): StepResult {
    const stepIdx = this.choiceIds.length;
    if (this.done) return { choice: null, state: this.state, rendered: this.lastRendered, failures: [], ms: 0, done: true };

    const before = this.state;
    const choices = availableActions(before, this.graph);
    if (choices.length === 0) {
      // The invariant: never a dead end. (After a death `availableActions` is legitimately empty, but then
      // `done` was already true above.)
      const f = this.fail("CHK-LEGAL", before.meta.turn, stepIdx, null, "no choice offered on a live run");
      this.endKind = "soft-locked";
      return { choice: null, state: before, rendered: this.lastRendered, failures: [f], ms: 0, done: true };
    }

    let choice: SceneChoice | undefined;
    if (pick === undefined) {
      choice = policyFor(this.spec.policy)({ state: before, choices, rng: this.rng, zeroCostStreak: this.zeroCostStreak });
    } else {
      const id = typeof pick === "string" ? pick : pick.id;
      choice = choices.find((c) => c.id === id);
      if (choice === undefined) throw new Error(`choice ${JSON.stringify(id)} is not offered at this turn`);
    }
    const c = choice;
    const kind = kindOf(c.id);
    const failures: Failure[] = [];
    const clock = this.hooks.now ?? now;

    // --- resolve + render, timed together (the NFR-PERF-01 unit) ---
    const t0 = clock();
    let after: GameState;
    let scene;
    let rendered: Rendered | null = null;
    try {
      const result = applyAction(before, c.action, this.graph);
      after = result.state;
      scene = result.scene;
      if (this.hooks.mutate) after = this.hooks.mutate(after, stepIdx);
      rendered = (this.hooks.render ?? renderAll)(after, this.graph);
    } catch (err) {
      const ms = clock() - t0;
      const e = err instanceof Error ? err : new Error(String(err));
      failures.push(this.fail("CHK-CRASH", before.meta.turn, stepIdx, c.id, e.message, e.stack));
      this.endKind = "crashed";
      this.choiceIds.push(c.id);
      this.pushPoint(stepIdx, before, c, ms, failures.length);
      return { choice: c, state: before, rendered: this.lastRendered, failures, ms, done: true };
    }
    const ms = clock() - t0;
    this.durations.push(ms);
    this.state = after;
    this.lastRendered = rendered;
    this.choiceIds.push(c.id);
    this.zeroCostStreak = kind !== undefined && ZERO_COST_KINDS.has(kind) ? this.zeroCostStreak + 1 : 0;

    // --- the per-turn checks ---
    const turn = after.meta.turn;
    const add = (id: CheckId, detail: string | null): void => {
      if (detail !== null) failures.push(this.fail(id, turn, stepIdx, c.id, detail));
    };
    add("CHK-RENDER", checkRender(rendered));
    add("CHK-LEAK", checkLeak(rendered.status));
    add("CHK-TURN", checkTurn(before, after, c.timeCost));
    add("CHK-AUDIT", checkAudit(before, after));
    add("CHK-INT", checkIntegers(after, "state"));
    if (this.spec.detSample > 0 && stepIdx % this.spec.detSample === 0) {
      add("CHK-DET", safely(() => checkDeterminism(before, c.action, this.graph, { state: after, scene })));
    }
    const sampleSave = this.spec.saveSample > 0 && (stepIdx + 1) % this.spec.saveSample === 0;
    if (sampleSave) {
      add("CHK-SAVE", safely(() => checkSaveRoundTrip(after)));
      add("CHK-RESUME", safely(() => checkResume(before, c.action, this.graph, after)));
    }
    if (ms > this.spec.budgetMs) add("CHK-PERF", `${ms.toFixed(1)} ms > budget ${this.spec.budgetMs} ms`);
    if (isRunOver(after)) {
      add("CHK-END", safely(() => checkEnd(after, this.graph)));
      this.endKind = runEndReason(after) ?? "alive";
    }

    // --- coverage ---
    this.kinds[kind] = (this.kinds[kind] ?? 0) + 1;
    this.noteVisit(after);
    if (before.combat === null && after.combat !== null) this.combatsEntered += 1;
    if (choices.some((x) => kindOf(x.id) === "hold") && choices.some((x) => kindOf(x.id) === "flee")) this.overrunsMet += 1;
    if (ESCAPE_KINDS.has(kind)) this.escapesTaken += 1;
    if (FIGHT_KINDS.has(kind)) this.fightsTaken += 1;
    this.deepest = Math.max(this.deepest, stageRank(after.player.condition.infection.stage));
    if (after.player.condition.wounds.length > before.player.condition.wounds.length) this.woundsSuffered += 1;
    this.companionsMax = Math.max(this.companionsMax, Object.keys(after.actors).length);

    this.pushPoint(stepIdx, after, c, ms, failures.length);
    return { choice: c, state: after, rendered, failures, ms, done: this.done };
  }

  /** Finish the run: end-of-run checks, then fold everything into a report. Idempotent. */
  finish(): RunReport {
    const state = this.state;
    const turn = state.meta.turn;
    const finalStep = Math.max(0, this.choiceIds.length - 1);
    if (this.endKind !== "crashed") {
      const f = safely(() => checkSaveRoundTrip(state));
      if (f !== null) this.fail("CHK-SAVE", turn, finalStep, null, f);
      if (isRunOver(state)) {
        const e = safely(() => checkEnd(state, this.graph));
        if (e !== null) this.fail("CHK-END", turn, finalStep, null, e);
      }
      if (this.spec.replay) {
        const r = safely(() => this.checkReplay());
        if (r !== null) this.fail("CHK-REPLAY", turn, finalStep, null, r);
      }
    }
    return this.report();
  }

  /** Replay the recorded choices from the initial state; the result must be byte-identical. */
  private checkReplay(): string | null {
    const initial = this.resumed ? this.initial : bootCity(this.content, this.spec.seed, {
      stocked: this.spec.stocked,
      ...(this.spec.difficulty ? { difficulty: this.spec.difficulty } : {}),
      ...(this.spec.ironman ? { ironman: true } : {}),
    }).state;
    if (this.endKind === "crashed") return null;
    const session = playSession(initial, this.graph, this.choiceIds);
    const d = firstDiff(this.state, session.final, "state");
    if (d !== null) return `replay diverged: ${d}`;
    // The transcript is what a tester reads; it must match too (repro-from-seed, exitGate.test.ts).
    const live = playSession(initial, this.graph, this.choiceIds); // same fold, second time — must be identical
    const t1 = transcript(session, this.graph).join("\n");
    const t2 = transcript(live, this.graph).join("\n");
    return t1 === t2 ? null : "replay transcript differs between two folds of the same choices";
  }

  report(): RunReport {
    const state = this.state;
    const byCheck: { [id: string]: number } = {};
    for (const f of this.failures) byCheck[f.id] = (byCheck[f.id] ?? 0) + 1;
    const resolved = state.meta.turn - this.initial.meta.turn;
    const maxMs = this.durations.length === 0 ? 0 : Math.max(...this.durations);
    const perf: PerfStats = {
      samples: this.durations.length,
      mean: this.durations.length === 0 ? 0 : this.durations.reduce((a, b) => a + b, 0) / this.durations.length,
      p50: percentile(this.durations, 50),
      p95: percentile(this.durations, 95),
      max: maxMs,
      maxStep: this.durations.indexOf(maxMs),
    };
    const stages: Infection["stage"][] = ["none", "incubating", "symptomatic", "advanced", "terminal"];
    const samples = this.timeline.map((p) => ({ turn: p.turn, pressure: p.pressure }));
    return {
      spec: this.spec,
      resumed: this.resumed,
      ok: this.failures.length === 0,
      actions: this.choiceIds.length,
      resolvedTurns: resolved,
      end: this.end,
      endDay: state.meta.day,
      endTurn: state.meta.turn,
      failures: [...this.failures],
      failuresByCheck: byCheck,
      perf,
      coverage: {
        kinds: { ...this.kinds },
        nodesVisited: this.visitedNodes.size,
        regionsVisited: this.visitedRegions.size,
        combatsEntered: this.combatsEntered,
        overrunsMet: this.overrunsMet,
        escapesTaken: this.escapesTaken,
        fightsTaken: this.fightsTaken,
        deepestInfection: stages[this.deepest] ?? "none",
        woundsSuffered: this.woundsSuffered,
        companionsMax: this.companionsMax,
        arcsTouched: Object.keys(state.story.progress).length,
        encountersFired: summarizeRunRepetition(state).fires,
      },
      historyLen: state.history.length,
      historyPerTurn: resolved === 0 ? 0 : (state.history.length - this.initial.history.length) / resolved,
      saveBytes: safeBytes(state),
      repetition: summarizeRunRepetition(state),
      pacing: summarizePacing(samples.length === 0 ? [samplePacing(state)] : this.timeline.map((p) => this.pacingAt(p))),
      timeline: [...this.timeline],
      choiceIds: [...this.choiceIds],
    };
  }

  // --- internals ---

  private readonly pacingCache: ReturnType<typeof samplePacing>[] = [];

  private pacingAt(p: TimelinePoint): ReturnType<typeof samplePacing> {
    return this.pacingCache[p.step]!;
  }

  private pushPoint(step: number, state: GameState, c: SceneChoice, ms: number, failures: number): void {
    const pacing = samplePacing(state);
    this.pacingCache[step] = pacing;
    const needs = state.player.condition.needs;
    const here = state.nodes[state.player.location];
    this.timeline.push({
      step,
      turn: state.meta.turn,
      day: state.meta.day,
      hour: state.meta.hour,
      action: c.id,
      timeCost: c.timeCost,
      ms,
      hunger: needs.hunger,
      thirst: needs.thirst,
      fatigue: needs.fatigue,
      infection: state.player.condition.infection.stage,
      wounds: state.player.condition.wounds.length,
      walkersHere: here?.walkers ?? 0,
      pressure: pacing.pressure,
      globalThreat: state.world.globalThreat,
      historyLen: state.history.length,
      inCombat: state.combat !== null,
      failures,
    });
  }

  private noteVisit(state: GameState): void {
    const loc = state.player.location;
    this.visitedNodes.add(loc);
    const region = state.nodes[loc]?.regionId;
    if (region !== undefined) this.visitedRegions.add(region);
  }

  private fail(id: CheckId, turn: number, step: number | null, action: string | null, detail: string, stack?: string): Failure {
    const f: Failure = { id, turn, step, action, detail, ...(stack ? { stack } : {}) };
    this.failures.push(f);
    return f;
  }
}

/** Run a check that itself might throw (a broken save loader, say) and report the throw as its detail. */
function safely(fn: () => string | null): string | null {
  try {
    return fn();
  } catch (err) {
    return `check threw: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function safeBytes(state: GameState): number {
  try {
    return saveGame(state).length;
  } catch {
    return -1;
  }
}

/** Play a whole run at once. */
export function runToEnd(content: Content, spec: RunSpec, from?: GameState, hooks?: RunHooks): RunReport {
  const run = new RunSession(content, spec, from, hooks);
  while (!run.done) run.step();
  return run.finish();
}

/** A batch: the cross product of seeds × policies × stocked flags under shared settings. */
export interface BatchSpec {
  readonly seeds: readonly string[];
  readonly policies: readonly PolicyName[];
  readonly stocked: readonly boolean[];
  readonly turns: number;
  readonly difficulty?: DifficultyMode;
  readonly ironman?: boolean;
  readonly budgetMs: number;
  readonly saveSample: number;
  readonly detSample: number;
  readonly replay: boolean;
}

export function expandBatch(spec: BatchSpec): RunSpec[] {
  const out: RunSpec[] = [];
  for (const seed of spec.seeds)
    for (const policy of spec.policies)
      for (const stocked of spec.stocked)
        out.push({
          seed,
          policy,
          stocked,
          turns: spec.turns,
          budgetMs: spec.budgetMs,
          saveSample: spec.saveSample,
          detSample: spec.detSample,
          replay: spec.replay,
          ...(spec.difficulty ? { difficulty: spec.difficulty } : {}),
          ...(spec.ironman ? { ironman: true } : {}),
        });
  return out;
}

/** Seeds `tl-1` … `tl-N`. */
export function defaultSeeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `tl-${i + 1}`);
}

/** Iterate a batch one finished run at a time (a generator, so a UI can yield to the event loop between runs). */
export function* batchRuns(content: Content, spec: BatchSpec, from?: GameState): Generator<RunReport, void, void> {
  for (const rs of expandBatch(spec)) yield runToEnd(content, rs, from);
}
