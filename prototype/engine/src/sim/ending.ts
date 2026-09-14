/**
 * Endings — assembled from what the run actually was (M5 task T61 · FR-STY-06 · GDD XIII "Endings
 * philosophy" · closes PL-M4-15 in part and PL-M5-67).
 *
 * **The defect this module exists for, measured rather than asserted.** Before T61 the closing text of
 * a run was a function of the *run-end reason alone*. `measure/t61.ts --distinct` over 40 settler runs:
 * **31 distinct component fingerprints → 3 distinct closing texts.** All thirty `lastStand` runs — 21
 * of them materially different lives — printed the identical 137 characters. `--pyrrhic` over 120
 * zealot runs: **5 wins → 1 closing text**, while 100% of those wins were carrying wounds or fever,
 * 100% ended alone, and 100% had someone dead behind them. The PRD's own acceptance criterion for
 * FR-STY-06 — *"two 'survival' endings differ based on tracked components"* — was not merely unmet,
 * it was **unreachable**: `assembleEnding` and `epilogue` had zero mentions in the engine, and no code
 * path anywhere read a single run component into the closing text.
 *
 * **What is assembled, and from where.** The FR says the history is the source, and the measurement
 * agrees: the append-only Living History (T31) is the one component that is genuinely rich — 19
 * distinct beat types, a mean of **100.3 events** per mortal run and **1402** per immortal one, with
 * `moral` beats in 97.5% of runs, `npc.died` in 80%, `shelter.claimed` in 77.5% and the T83 siege
 * outcomes in 45/10/7.5%. A snapshot of the *final frame* is by comparison almost empty — companions
 * alive 0.00 in every policy and both mortality modes, survivors met 0.00, `story.mysteries` and
 * `story.lore` still literal stubs. So {@link summarizeRun} reads the **log** for everything that
 * *happened* and the state only for what is *true at the end*. A base you claimed on day 2 and lost on
 * day 9 is in the log; `player.shelterId` is null either way.
 *
 * **Components are a MENU, not a template — the load-bearing decision, and it is T87's.** That task
 * found a thin-and-wide ledger and answered it with a disjunctive `accepts` menu rather than a bill of
 * materials, so that every dead item became an *alternate payment* instead of a hard gate. The
 * components of a run are thin-and-wide in exactly the same way: each is present in somewhere between
 * 0% and 100% of runs, and no fixed set of them is present in most. An ending built from a template
 * would therefore print holes or boilerplate for the ordinary run. So an ending is an **opening plus
 * the strongest {@link ENDING_CLAUSE_LIMIT} clauses whose requirements the run satisfies** — which
 * means a component that is dead today (a companion at your side; a survivor you kept alive) is a
 * clause that simply never fires, rather than a gap in the text, and lights up with no code change on
 * the day T59/T60 move the mortality curve. **That is the same trade as `accepts`, and it is the
 * reason this module can be honest about a game whose people all die.**
 *
 * **There is no single true ending, and that is mechanical here rather than aspirational.** The
 * {@link EndingShape} is derived from what the run *was*, not from how it stopped: two runs that both
 * end in a Last Stand are a `sacrifice` and a `fade` depending on whether you went down holding a door
 * you had built or alone in a street you were passing through. GDD XIII's four shapes — escape,
 * entrenchment, sacrifice, fade — are the whole vocabulary, and the reason contributes one of them
 * directly (a finished departure is an escape) and none of the other three.
 *
 * **The first line is never replaced.** `lines[0]` is *exactly* the text the run would have closed on
 * before T61 — `winNarration` for the two wins, `endingNarration` for the four deaths. Everything this
 * module adds is additional. That keeps the authored scenes (and the tests over them) intact, keeps
 * GDD IX rule 5's "death in combat is a scene, not a screen" true of the sentence the player reads
 * first, and makes the content gate below trivially safe.
 *
 * **Gated like every content pool since T81.** `endingsActive(graph)` is true only when the client
 * registered a non-empty `content/endings/` pool; without it {@link assembleEnding} returns null and
 * `sceneOf` falls back to the exact prior expression. Byte-identical narration, choices and save for
 * every run built without the pool — verified by driving bots through both trees.
 *
 * **No new state and no save rung.** Everything here is derived from `GameState` + `state.history`, so
 * the save stays v10 (the T79/T84/T85/T86 derive-don't-store rule; T87's `endingFlags` bend was forced
 * by `runEndReason(state)` taking no graph, and nothing here has that constraint). An ending is
 * therefore **reproducible from seed + state**, which is the other half of what FR-STY-06 asks for:
 * load a finished run on another machine and it closes on the same words.
 *
 * **Deliberately NOT stamped into the `run.ended` beat.** The obvious move is to put the shape in that
 * history event's `data`. It is wrong: `recordHistory` diffs a turn whose own events have not been
 * appended yet, so a siege resolved on the final turn would be invisible to a shape computed there and
 * the stamped shape could disagree with the one `assembleEnding` renders from the complete state one
 * frame later. The shape is a **read**, and reads are taken from finished state.
 *
 * Pure, deterministic, dependency-free (ADR-0001): a fold over two plain-JSON structures, no RNG, no
 * clock read, no I/O. A leaf — nothing in `sim/` imports this module.
 */

import type { ContentId, GameState, HistoryEvent } from "../state/types.js";
import { HUMANITY_BASELINE } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { runEndReason, endingNarration, type RunEndReason } from "./survival.js";
import { humanityOf } from "./events.js";
import { isCompanion } from "./companions.js";
import { winNarration, PROJECT_STAGE_FLAG_PREFIX, committedProject } from "./project.js";
import { standTaken, standActLine } from "./stand.js";

// --- the four shapes -------------------------------------------------------------------------------

/**
 * The shape a run resolved into (GDD XIII: *"Rescue / escape endings, entrenchment endings (you become
 * a fixture of the ruined city), sacrifice endings, and quiet fade endings"*), and GDD XVI's Legacy
 * beat names the same four: *"the run resolves toward its ending: hold, escape, sacrifice, or fall."*
 *
 * A shape is **not** a run-end reason and the mapping is deliberately not one-to-one. Only `escaped`
 * fixes a shape on its own. The other five reasons are resolved by what the run contained, which is
 * the entire point: "there is no true ending" is a statement about this function.
 */
export type EndingShape = "escape" | "entrenchment" | "sacrifice" | "fade";

/** Every shape, as a value — the T82 drift guard: adding a fifth stops compiling until this is updated. */
const ALL_SHAPES: Record<EndingShape, true> = { escape: true, entrenchment: true, sacrifice: true, fade: true };
export const ENDING_SHAPES: readonly EndingShape[] = Object.keys(ALL_SHAPES) as EndingShape[];

// --- what a run was --------------------------------------------------------------------------------

/**
 * The components of a finished run, in one flat record — the thing clauses are written against.
 *
 * Every field is either a count off the append-only log or a fact about the final state, and each is
 * annotated with what it measured on the pre-T61 tree so the next person can tell a live axis from a
 * dead one without re-deriving it (`measure/t61.ts --components`, 40 goal-directed settler runs;
 * `--ceiling` is the immortal figure where it differs interestingly).
 */
export interface RunSummary {
  /**
   * Why the run stopped, or **null while it is still going**.
   *
   * Nullable rather than defaulted, and the audit is why: an earlier cut stood `"lastStand"` in for a
   * live run on the grounds that `won` stayed false so nothing downstream could be fooled — and the one
   * downstream consumer in this module, {@link endingShape}, read `reason` and duly reported a living
   * settler with a fortified base as a `sacrifice`. A summary of a run in progress is still a legal and
   * useful thing to ask for; it just must not be able to name a death that has not happened.
   */
  readonly reason: RunEndReason | null;
  /** Whether it stopped well. Two of the six reasons are wins (T87). */
  readonly won: boolean;
  /** Day the run ended. Measured 1–5 mortal (mean 2.9), 31–44 immortal. */
  readonly days: number;
  /** Turns taken. */
  readonly turns: number;

  // --- the hands ---
  /** Hidden moral standing at the end, 0–100. Measured 31–73 across 200 runs; **never below 31**. */
  readonly humanity: number;
  /** Signed distance from {@link HUMANITY_BASELINE} — the *direction of travel*, which is the axis that
   * actually moves (97.5–100% of runs) where the authored ≤28 band never does. */
  readonly humanityShift: number;
  /** `moral` beats: choices that cost or kept something. Measured 2.35/run, 97.5% of runs. */
  readonly moralActs: number;

  // --- the people ---
  /** `npc.met` beats. Measured **0.00 in every policy and both mortality modes** — see the module note. */
  readonly met: number;
  /** `npc.died` beats. Measured 11.9/run mortal, **18.0 of the 18 authored, in 100% of immortal runs**. */
  readonly survivorsLost: number;
  /** `companion.died` beats. Measured 0 — nothing is ever recruited to lose (T86's PL-M5-63). */
  readonly companionsLost: number;
  /** `social.deserted` + `social.betrayed` beats. Measured 0, same cause. */
  readonly departed: number;
  /** Companions still standing at the end. Measured 0.00 in 320 runs. */
  readonly companions: number;

  // --- the place ---
  /** A base was claimed at some point in the run (from the log, not the final frame). 77.5–100%. */
  readonly claimed: boolean;
  /** Claimed, and gone by the end. Measured 5% immortal, 0% mortal (T83's `releaseShelter`). */
  readonly baseLost: boolean;
  /** Rooms standing in the base at the end. Measured 0–2 (T85). */
  readonly rooms: number;
  /** Barricade integrity at the base at the end. */
  readonly barricades: number;
  /**
   * The survivor was standing **in a base they still held** when it stopped.
   *
   * Separate from {@link claimed}, which is historical, because the difference is the whole of the
   * `sacrifice` shape: owning a fortified marina is not the same as dying in its doorway, and the first
   * cut of {@link endingShape} conflated them — it printed *"You went down at your own door"* over a
   * survivor taken in a pharmacy on the far side of the map (audit finding 1).
   */
  readonly atBase: boolean;
  /** `siege.held` + `siege.repelled` — nights the walls did their job (T83). 10%/45% of runs. */
  readonly nightsHeld: number;
  /** `siege.breached` — nights they did not. 7.5% of runs. */
  readonly breached: number;

  // --- the city ---
  /** `combat.cleared` beats — fights that ended with you still standing. 5.08/run, 97.5%. */
  readonly fightsEnded: number;
  /** `horde.overrun` beats — a mass came down on you in the open. 2.08/run, 65%. */
  readonly overruns: number;
  /** Nodes entered. Measured 3–7 mortal, 7–31 immortal. */
  readonly nodesSeen: number;
  /** Nodes searched to 100%. Measured 0–4 mortal, 3–21 immortal. */
  readonly nodesCleaned: number;
  /** `encounter.begin` beats — situations that found you. 10.6/run, 100%. */
  readonly encounters: number;

  // --- the work (T87) ---
  /** The terminal project this run committed to, or null. */
  readonly committed: ContentId | null;
  /** Project stages finished, from the flag set. */
  readonly stages: number;

  // --- the body, at the end ---
  /** Carrying at least one untreated wound. */
  readonly hurt: boolean;
  /** Infection past `none` at the end. */
  readonly feverish: boolean;
  /** Hunger or thirst in the upper half of the clock when it stopped. */
  readonly starving: boolean;
  readonly parched: boolean;
  /** Any of the four — the pyrrhic read (PL-M5-67). Measured true for **100% of wins**. */
  readonly battered: boolean;

  // --- the last act (T62) ---
  /**
   * The id of the act the survivor spent their final turn on, or null — for a win, for a run still
   * going, and for any run played without a `content/stands/` pool.
   *
   * Read off the Living History rather than off a flag, because that is what the task's brief asked
   * for: the stand writes what it did into the log and this module reads it, so there is exactly one
   * closing-text path rather than two. It is also the T61 rule holding — *the shape is a read, and
   * reads are taken from finished state*.
   */
  readonly standAct: ContentId | null;
  /**
   * The ending shape that act **declares**, or null when it declares none.
   *
   * This is the field that makes `sacrifice` reachable (PL-M5-69), and it is worth being precise about
   * why it is not the widening T61 refused. Before T62 a death contained no *act*, so `atBase` was the
   * only proxy available for "this death bought something". It is a poor one and it measured 0.0%. An
   * act is the real thing: a survivor who held a line, held a door, or left everything they carried
   * where it would be found has done something for something other than their own survival, wherever
   * they were standing. `atBase` is left exactly as it was and is still a route in its own right.
   */
  readonly standShape: string | null;
}

/** Count history beats of the given types. */
function beats(history: readonly HistoryEvent[], ...types: readonly string[]): number {
  const want = new Set(types);
  let n = 0;
  for (const e of history) if (want.has(e.type)) n += 1;
  return n;
}

/**
 * Hunger/thirst past which the end reads as *dying of it* rather than *hungry*. Half of `NEED_FATAL`
 * (100), so it is the upper half of the clock and nothing more clever than that — it selects prose, it
 * gates no mechanic, and unlike `LAST_STAND_AT` there is no measured curve to fit it to.
 */
export const ENDING_NEED_PRESSURE = 50;

/** Fold a finished (or any) run into its components. Pure; reads the log and the final state only. */
export function summarizeRun(state: GameState, graph?: RegionGraph): RunSummary {
  const reason = runEndReason(state);
  const h = state.history;
  const shelterId = state.player.shelterId;
  const claimed = shelterId !== null || beats(h, "shelter.claimed") > 0;
  const humanity = humanityOf(state);
  const cond = state.player.condition;
  const hurt = cond.wounds.length > 0;
  const feverish = cond.infection.stage !== "none";
  const starving = cond.needs.hunger >= ENDING_NEED_PRESSURE;
  const parched = cond.needs.thirst >= ENDING_NEED_PRESSURE;
  // The final act, if one was taken (T62). Scanned backwards from the end of the log, so it costs a
  // handful of reads rather than a second walk of a 1400-event history.
  const taken = standTaken(h);
  return {
    reason,
    won: reason === "escaped" || reason === "held",
    days: state.meta.day,
    turns: state.meta.turn,

    humanity,
    humanityShift: humanity - HUMANITY_BASELINE,
    moralActs: beats(h, "moral"),

    met: beats(h, "npc.met"),
    survivorsLost: beats(h, "npc.died"),
    companionsLost: beats(h, "companion.died"),
    departed: beats(h, "social.deserted", "social.betrayed"),
    companions: Object.values(state.actors).filter(isCompanion).length,

    claimed,
    // Claimed once and not held at the end. Read from the log rather than a flag, so the T83
    // `releaseShelter` path (a base taken back off you) and a voluntary abandon both land here.
    baseLost: claimed && shelterId === null,
    rooms: shelterId === null ? 0 : (state.nodes[shelterId]?.rooms ?? []).length,
    barricades: shelterId === null ? 0 : state.nodes[shelterId]?.barricades ?? 0,
    atBase: shelterId !== null && state.player.location === shelterId,
    nightsHeld: beats(h, "siege.held", "siege.repelled"),
    breached: beats(h, "siege.breached"),

    fightsEnded: beats(h, "combat.cleared"),
    overruns: beats(h, "horde.overrun"),
    nodesSeen: Object.values(state.nodes).filter((n) => n.lastVisit !== null).length,
    nodesCleaned: Object.values(state.nodes).filter((n) => n.searchPct >= 100).length,
    encounters: beats(h, "encounter.begin"),

    committed: committedProject(state, graph)?.id ?? null,
    stages: Object.keys(state.story.endingFlags).filter(
      (k) => k.startsWith(PROJECT_STAGE_FLAG_PREFIX) && state.story.endingFlags[k] === true,
    ).length,

    hurt,
    feverish,
    starving,
    parched,
    battered: hurt || feverish || starving || parched,

    standAct: taken === null ? null : taken.act,
    standShape: taken === null ? null : taken.shape,
  };
}

/**
 * The shape a summarized run resolved into, or null if it has not ended.
 *
 * The order of the tests is the judgement, and it is the same kind of judgement `runEndReason` makes
 * about which death is the proximate one:
 *
 * 1. **escape** — the departure was finished. Nothing else can outrank leaving.
 * 2. **entrenchment (win)** — the holdout was finished. The walls are the ending.
 * 3. **sacrifice** — a Last Stand **in a base you still held**. *You went down holding a door.* The
 *    conjunct is two words long on purpose: an earlier cut also required standing walls or a night
 *    turned away, which narrowed a shape that is **already unreachable** (see the declared limit below)
 *    without making the sentence any truer. What the walls were like is the clause menu's business.
 * 4. **entrenchment (loss)** — you claimed an address, and whatever else happened, that is what the run
 *    was. GDD XIII's *"you become a fixture of the ruined city"* is as true of the survivor who simply
 *    lived somewhere as of the one who fortified it.
 * 5. **fade** — everything else: the quiet ones, out in a city you were only passing through.
 *
 * **Three things here are audit fixes and each replaced something that read as a lie.**
 * (a) `sacrifice` required only that a base had *ever* been claimed and that some defence had *ever*
 * happened, so a survivor grabbed in a pharmacy across the map, or one whose base had been breached six
 * days earlier, was told they went down at their own door — while `lines[0]` said the city closed over
 * the place where they had been. It now requires {@link RunSummary.atBase}.
 * (b) `breached` is no longer evidence of a defence at all: `breachShelter` calls `releaseShelter`, so
 * a breach is the turn the base stops being yours, and the clauses that narrated it as a wall you
 * patched and slept behind were describing a mechanic the engine does not have.
 *
 * **DECLARED: `sacrifice` cannot be reached in this build, and the cause is not this predicate.**
 * Measured over 120 finished runs across three policies (`measure/t61.ts --sacrifice`): a survivor
 * stands inside a base they still hold for **6.2 turns a run, in 75.8% of runs — and is in combat there
 * on 0.00 of them.** A Last Stand is `combat.grabbed && woundBurden >= LAST_STAND_AT`, so with no fight
 * possible at your own address there is no Last Stand possible there either. Two prior decisions own
 * that between them: T76 made the claimed shelter a hard sanctuary (`overrunsPlayer` excludes it), and
 * T83 resolves the night as a siege event rather than as a fight. **T62 is the task that turns the Last
 * Stand from an ending into a stand (PL-M5-44), and this shape is the ending it lands in** — authored
 * ahead of it deliberately, in the same spirit as the clauses waiting on a companion, and recorded as
 * PL-M5-71 rather than papered over by widening "sacrifice" until it means "died somewhere".
 * (c) `entrenchment` required rooms, stages or a defence on top of the claim, so a survivor who claimed
 * a base and simply lived in it fell through to `fade` and was told *"nothing you had was yours for
 * long"* — measured, `shelter.claimed` fires in 77.5% of settler runs while a siege beat fires in
 * 10–45%, so that was the ordinary settled run, not an edge case. **Claiming an address is the whole
 * of what entrenchment means**; the clause menu is what distinguishes a fortress from a squat.
 *
 * `fade` is the floor rather than a guess, which is why it is last and unconditional.
 */
export function shapeOfSummary(s: RunSummary): EndingShape | null {
  if (s.reason === null) return null;
  if (s.reason === "escaped") return "escape";
  if (s.reason === "held") return "entrenchment";
  // T62 — **the last act, and it is the most proximate statement the run makes about itself.** It sits
  // above the derived tests for the same reason `runEndReason` checks the Last Stand before the slow
  // deaths: a survivor who chose, in their final turn, to hold a line or leave everything they carried
  // where it would be found has told you what the run was more directly than any count of nights or
  // rooms can. Narrowed against `ENDING_SHAPES` rather than trusted: the value reaches here as a plain
  // string off the Living History (a hand-edited save can put anything in a beat), and an unrecognised
  // one falls through to the derivation rather than producing a shape the game does not have.
  if (s.standShape !== null && (ENDING_SHAPES as readonly string[]).includes(s.standShape)) {
    return s.standShape as EndingShape;
  }
  if (s.reason === "lastStand" && s.atBase) return "sacrifice";
  if (s.claimed) return "entrenchment";
  return "fade";
}

/**
 * The shape this run resolved into, or null while it is still going. Pure.
 *
 * Takes the graph so that it and {@link assembleEnding} can never compute *different* summaries of the
 * same state — the hazard the audit named when `committed` was the one field that needed a graph and
 * this function did not take one. `assembleEnding` folds the run exactly once and calls
 * {@link shapeOfSummary} directly, so the two are the same read by construction rather than by care.
 */
export function endingShape(state: GameState, graph?: RegionGraph): EndingShape | null {
  return shapeOfSummary(summarizeRun(state, graph));
}

// --- content ---------------------------------------------------------------------------------------

/**
 * A clause's admission test — every set field must hold, absent fields are ignored (the
 * `EncounterRequirement` idiom from T47, which content authors already know).
 *
 * The vocabulary is **closed and engine-side on purpose**: content supplies prose and thresholds, the
 * engine supplies the facts. An open expression language here would put run logic in JSON where the
 * schema gate cannot check it and mutation testing cannot reach it.
 */
export interface EndingRequirement {
  /** Run-end reasons this clause is admissible for. Absent ⇒ any. */
  readonly reasons?: readonly RunEndReason[];
  readonly minDays?: number;
  readonly maxDays?: number;
  readonly minHumanity?: number;
  readonly maxHumanity?: number;
  /** Signed distance from the baseline — the axis that actually moves. */
  readonly minHumanityShift?: number;
  readonly maxHumanityShift?: number;
  readonly minMoralActs?: number;
  readonly minMet?: number;
  readonly minSurvivorsLost?: number;
  readonly minCompanions?: number;
  readonly minCompanionsLost?: number;
  readonly minDeparted?: number;
  readonly minRooms?: number;
  readonly minNightsHeld?: number;
  readonly minBreached?: number;
  /**
   * Upper bound on breaches — the vocabulary's only `max` on a count, and it earns its place: losing a
   * base to a breach and losing one any other way are different stories, and without this a clause about
   * the general case prints right beside the specific one that caused it.
   */
  readonly maxBreached?: number;
  readonly minFights?: number;
  readonly minOverruns?: number;
  readonly minNodesSeen?: number;
  readonly minNodesCleaned?: number;
  readonly minEncounters?: number;
  readonly minStages?: number;
  /** The run must have claimed a base at some point. */
  readonly requiresClaimed?: boolean;
  /** The run must have claimed a base and not had it at the end. */
  readonly requiresBaseLost?: boolean;
  /** The survivor must have ended carrying wounds, fever, hunger or thirst (PL-M5-67's pyrrhic read). */
  readonly requiresBattered?: boolean;
  /** The survivor must have ended *clean* — the complement, so the rare good end can be authored. */
  readonly forbidsBattered?: boolean;
  /**
   * The survivor must have ended with the infection past `none`. Narrower than
   * {@link requiresBattered} on purpose: "you got out and it came with you" is a different ending from
   * "you got out hurt", and the infection is the one thing in this game that the road does not leave
   * behind. Measured: `infection.staged` fires in 95% of runs.
   */
  readonly requiresFeverish?: boolean;
  /** No companion at the end. */
  readonly requiresAlone?: boolean;
  /**
   * Act ids the run's final turn may have been spent on (T62). Absent ⇒ any, including none.
   *
   * This is how the stand's choice reaches the closing prose: a clause can name what the survivor did
   * rather than only what was true of them. Ids are the bare act ids as authored in `content/stands/`
   * (`hold-the-line`, `leave-what-you-carry`, …) plus the engine's floor act `stand.let-go`.
   */
  readonly standActs?: readonly string[];
  /** The survivor was standing in a base they still held when the run stopped. */
  readonly requiresAtBase?: boolean;
  /**
   * The run **never claimed a base**. The vocabulary was otherwise monotone — every field a lower or
   * upper bound, none of them a negative — so a clause like *"you kept moving the whole way through,
   * none of them yours"* could not be kept off a survivor who had settled on day 2 (audit finding 3).
   */
  readonly forbidsClaimed?: boolean;
}

/**
 * Every key {@link matchesEnding} reads, as a value.
 *
 * It exists because `matchesEnding` AND-folds only the keys it knows, so a typo'd key
 * (`minNights` for `minNightsHeld`) does not fail loudly — it turns a gated clause into an
 * unconditional one, which is the *opposite* of what the author asked for. `buildRegionGraph` rejects
 * any key not on this list, and `harness/test/endingContent.test.ts` checks it against the schema's
 * own property list in both directions, so the three cannot drift apart (the T81 content drift-guard
 * idiom). The `Record` typing is the compile-time half: adding a field to `EndingRequirement` without
 * adding it here stops the build.
 */
const ALL_REQUIREMENT_KEYS: Record<keyof EndingRequirement, true> = {
  reasons: true, minDays: true, maxDays: true, minHumanity: true, maxHumanity: true,
  minHumanityShift: true, maxHumanityShift: true, minMoralActs: true, minMet: true,
  minSurvivorsLost: true, minCompanions: true, minCompanionsLost: true, minDeparted: true,
  minRooms: true, minNightsHeld: true, minBreached: true, maxBreached: true, minFights: true,
  minOverruns: true,
  minNodesSeen: true, minNodesCleaned: true, minEncounters: true, minStages: true,
  requiresClaimed: true, requiresBaseLost: true, requiresBattered: true, forbidsBattered: true,
  requiresAlone: true, requiresFeverish: true, requiresAtBase: true, forbidsClaimed: true,
  standActs: true,
};
export const ENDING_REQUIREMENT_KEYS: readonly string[] = Object.keys(ALL_REQUIREMENT_KEYS);

/** One candidate sentence in an ending. */
export interface EndingClauseDef {
  readonly id: string;
  /** Selection order. Higher wins a contested slot; ties break on `id` so selection is total. */
  readonly weight: number;
  readonly when?: EndingRequirement;
  /** Second-person past-tense prose, one or two sentences. */
  readonly text: string;
}

/** One authored shape: the line that names it, and the clauses that can follow. */
export interface EndingDef {
  readonly id: ContentId;
  readonly shape: EndingShape;
  /** The line that names what this run *was*. Always printed when the pool is live. */
  readonly opening: string;
  readonly clauses: readonly EndingClauseDef[];
}

/**
 * How many clauses an ending may carry after its opening.
 *
 * **Three, and the number is a legibility judgement rather than a measured one** — which is worth
 * saying plainly, because most constants in this codebase are measured. An ending is read once, at the
 * end, in a terminal or a screen reader; the opening already names the shape and `lines[0]` already
 * carries the authored scene. Measured clause *supply* is 4–7 admissible clauses on an ordinary run,
 * so the cap binds and the weights therefore matter — which is the property that makes two runs of the
 * same shape differ rather than converging on "everything that was true of you".
 */
export const ENDING_CLAUSE_LIMIT = 3;

/** The registered ending pool, or empty when the client did not supply one. */
export const endingPool = (graph: RegionGraph | undefined): readonly EndingDef[] => graph?.endings ?? [];

/**
 * Whether assembled endings are live for this run. False without a registered pool, which is what
 * keeps every pre-T61 run byte-identical (the T81/T83/T84/T85/T86/T87 gate idiom).
 */
export const endingsActive = (graph: RegionGraph | undefined): boolean => endingPool(graph).length > 0;

// --- assembly --------------------------------------------------------------------------------------

/** Does this run satisfy the clause's admission test? All set fields AND-combined. */
export function matchesEnding(s: RunSummary, req: EndingRequirement | undefined): boolean {
  if (req === undefined) return true;
  const atLeast = (v: number, lo?: number): boolean => lo === undefined || v >= lo;
  const inRange = (v: number, lo?: number, hi?: number): boolean =>
    (lo === undefined || v >= lo) && (hi === undefined || v <= hi);

  // A live run has no reason, and a `reasons` gate must then FAIL rather than pass — an authored
  // "this is how it took you" line is never true of a survivor who is still standing.
  if (req.reasons !== undefined && (s.reason === null || !req.reasons.includes(s.reason))) return false;
  if (!inRange(s.days, req.minDays, req.maxDays)) return false;
  if (!inRange(s.humanity, req.minHumanity, req.maxHumanity)) return false;
  if (!inRange(s.humanityShift, req.minHumanityShift, req.maxHumanityShift)) return false;
  if (!atLeast(s.moralActs, req.minMoralActs)) return false;
  if (!atLeast(s.met, req.minMet)) return false;
  if (!atLeast(s.survivorsLost, req.minSurvivorsLost)) return false;
  if (!atLeast(s.companions, req.minCompanions)) return false;
  if (!atLeast(s.companionsLost, req.minCompanionsLost)) return false;
  if (!atLeast(s.departed, req.minDeparted)) return false;
  if (!atLeast(s.rooms, req.minRooms)) return false;
  if (!atLeast(s.nightsHeld, req.minNightsHeld)) return false;
  if (!inRange(s.breached, req.minBreached, req.maxBreached)) return false;
  if (!atLeast(s.fightsEnded, req.minFights)) return false;
  if (!atLeast(s.overruns, req.minOverruns)) return false;
  if (!atLeast(s.nodesSeen, req.minNodesSeen)) return false;
  if (!atLeast(s.nodesCleaned, req.minNodesCleaned)) return false;
  if (!atLeast(s.encounters, req.minEncounters)) return false;
  if (!atLeast(s.stages, req.minStages)) return false;
  if (req.requiresClaimed === true && !s.claimed) return false;
  if (req.requiresBaseLost === true && !s.baseLost) return false;
  if (req.requiresBattered === true && !s.battered) return false;
  if (req.forbidsBattered === true && s.battered) return false;
  if (req.requiresFeverish === true && !s.feverish) return false;
  if (req.requiresAtBase === true && !s.atBase) return false;
  if (req.forbidsClaimed === true && s.claimed) return false;
  if (req.requiresAlone === true && s.companions > 0) return false;
  if (req.standActs !== undefined && (s.standAct === null || !req.standActs.includes(s.standAct))) return false;
  return true;
}

/** A finished run, closed. */
export interface Ending {
  readonly shape: EndingShape;
  readonly reason: RunEndReason;
  /** The authored id of the shape that supplied the opening and clauses, or null when the pool is off. */
  readonly source: ContentId | null;
  /**
   * The closing prose, in reading order. `lines[0]` is *exactly* the pre-T61 text for this reason; the
   * shape's opening and the selected clauses follow. Never empty.
   */
  readonly lines: readonly string[];
  /** The clause ids that fired, in the order they were printed — for tests and telemetry, not display. */
  readonly clauseIds: readonly string[];
}

/**
 * The line the run has always closed on: the finished project's own words for a win, the authored
 * death scene otherwise. Kept as a named function because *two* places need exactly it — the fallback
 * when no pool is registered, and `lines[0]` when one is.
 */
export function reasonScene(state: GameState, graph: RegionGraph | undefined, reason: RunEndReason): string {
  return reason === "escaped" || reason === "held" ? winNarration(state, graph, reason) : endingNarration(reason);
}

/**
 * Selection weight for a clause, coerced once.
 *
 * `b.weight - a.weight` on a non-numeric weight is `NaN`, which is falsy, so such a pair fell through
 * to the id tiebreak while every numeric pair still compared by weight — a **non-transitive**
 * comparator, whose result `Array.prototype.sort` is free to decide however it likes. That is precisely
 * the machine-independence the id tiebreak exists to buy, lost to the one input nobody validates. It
 * also failed in the unsafe direction: the garbage clause was promoted to the top slot rather than
 * dropped. Coercing here makes the comparator total again for any input at all.
 */
const weightOf = (c: EndingClauseDef): number => (Number.isFinite(c.weight) ? c.weight : 0);

/** A clause is printable only if it has prose. An empty `text` renders as a silent extra space. */
const speaks = (c: EndingClauseDef): boolean => typeof c.text === "string" && c.text.trim() !== "";

/**
 * Assemble the ending for a finished run, or null when the run is still going or no pool is registered.
 *
 * Selection is total and deterministic: admissible clauses sort by weight descending, then by id
 * ascending, and the first {@link ENDING_CLAUSE_LIMIT} are taken. The id tiebreak is not decoration —
 * without it two clauses of equal weight would resolve in authoring order, which is directory order,
 * which is not a contract, and the same save would close differently on two machines.
 *
 * The run is folded **once**: the shape and the clause tests read the same {@link RunSummary} object,
 * so they cannot disagree about the run they are describing, and a 1400-event log is walked once per
 * ending rather than twice.
 */
export function assembleEnding(state: GameState, graph?: RegionGraph): Ending | null {
  const reason = runEndReason(state);
  if (reason === null) return null;
  const pool = endingPool(graph);
  if (pool.length === 0) return null;

  const summary = summarizeRun(state, graph);
  const shape = shapeOfSummary(summary);
  const scene = reasonScene(state, graph, reason);
  // `shape` is non-null here because `reason` is, but the compiler does not know that and neither does
  // a hand-built state, so it is answered rather than asserted.
  // The act line is computed before the early returns, because an act was taken whether or not the
  // pool has words for the shape it landed in — a partial content set must not silently swallow the
  // last thing the survivor did.
  const actLine = summary.standAct === null ? null : standActLine(graph, summary.standAct, summary.reason);
  const spoken = actLine !== null && actLine.trim() !== "" ? [actLine] : [];
  if (shape === null) return { shape: "fade", reason, source: null, lines: [scene, ...spoken], clauseIds: [] };
  const def = pool.find((d) => d.shape === shape);
  // A pool that is live but has nothing authored for this shape still closes on the scene it always
  // did, rather than on an empty string or on another shape's words. A content set is not required to
  // author all four (the schema gate cannot express "covers every shape", and a partial set is a
  // legitimate thing to ship mid-authoring).
  if (def === undefined) return { shape, reason, source: null, lines: [scene, ...spoken], clauseIds: [] };

  // `def.clauses ?? []` rather than `def.clauses`: `buildRegionGraph` now rejects a def without an
  // array, but this module is also reachable from a client that builds a graph by hand, and the failure
  // this guards was a `TypeError` thrown on the exact frame the player died (audit finding 4).
  const picked = (def.clauses ?? [])
    .filter((c) => speaks(c) && matchesEnding(summary, c.when))
    .slice()
    .sort((a, b) => weightOf(b) - weightOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, ENDING_CLAUSE_LIMIT);

  // **What the survivor DID goes between how they died and what the run was** (T62). The order is the
  // reading order of the moment: the death sentence, the act taken against it, then the shape and its
  // clauses. `lines[0]` is untouched, so T61's guarantee — that the first line is byte-for-byte the
  // pre-T61 text — survives a second task intact, and a run played without a stand pool has no act and
  // therefore no extra line at all.
  return {
    shape,
    reason,
    source: def.id,
    lines: [scene, ...spoken, def.opening, ...picked.map((c) => c.text)],
    clauseIds: picked.map((c) => c.id),
  };
}

/** The ending as one paragraph — what a text client renders. */
export const endingText = (ending: Ending): string => ending.lines.join(" ");

/**
 * The closing narration for a run, assembled when a pool is registered and the plain reason scene when
 * not. This is the single function `sceneOf` calls, so the gate lives in exactly one place.
 */
export function closingNarration(state: GameState, graph: RegionGraph | undefined, reason: RunEndReason): string {
  const ending = assembleEnding(state, graph);
  if (ending !== null) return endingText(ending);
  // No ending pool. A stand pool can be registered without one (the two gates are independent), and in
  // that case the closing is the plain reason scene — but the act the survivor spent their last turn on
  // still belongs in it, or a client that ships stands and no endings would offer a final choice and
  // then never mention it again.
  const scene = reasonScene(state, graph, reason);
  const taken = standTaken(state.history);
  const act = taken === null ? null : standActLine(graph, taken.act, taken.reason ?? reason);
  return act !== null && act.trim() !== "" ? `${scene} ${act}` : scene;
}
