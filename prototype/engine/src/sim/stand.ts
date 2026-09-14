/**
 * The Last Stand as a *scene* — the final, heightened set of choices a dying survivor gets
 * (M5 task T62 · FR-CBT-10 · FR-STY-07 · GDD IX "Canonical: the Last Stand" · GDD XIII "Failure
 * endings" · closes PL-M5-44).
 *
 * **The defect, measured rather than asserted.** `measure/t62.ts --stand`, 160 bot runs across four
 * policies: **102 of them (63.8%) end in a Last Stand — it is the single commonest way a run stops** —
 * and every one of those 102 offered **0.00 choices on its closing frame**. `runEndReason` is read at
 * the top of `availableActions`, which returns `[]` the instant it is non-null, so the blow that
 * completed the condition ended the run on the same frame: no final turn, nothing to spend, and
 * therefore precisely the *"You Died" card* FR-STY-07 forbids and GDD IX rule 5 calls a screen rather
 * than a scene. T82 shipped the trigger and said so (PL-M5-44); this module is the scene it opens.
 *
 * ## THE GDD NAMES THREE SPENDS AND TWO OF THEM DO NOT EXIST
 *
 * GDD IX's own examples are *"hold the door so a companion gets out, take as many with you as you can,
 * say the thing you never said"*. Two of the three name a **person**. Measured at the exact frame the
 * condition becomes true, over those 102 stands (`measure/t62.ts --hands`):
 *
 * | at the stand                  |        |
 * | ----------------------------- | ------ |
 * | companions at your side       | **0.00 · 0.0% of stands** |
 * | survivors ever *met*          | **0.00 · 0.0% of stands** |
 * | at a base you still hold      | **0.0%** |
 * | carrying a loaded firearm     | **0.0%** |
 * | holding any weapon at all     | 5.9%   |
 * | **items in the pack**         | **3.72 · 97.1% carry something** |
 * | other dead standing with you  | 1.76   |
 * | wounds carried / burden       | 6.87 / **218.6** (the line is 80) |
 * | day                           | 2.5    |
 *
 * So the survivor this scene is written for is **alone, on day two and a half, two and a half times
 * past what their body can take, holding a can of food and a bottle of water, with no one to hold a
 * door for and no one left to say anything to.** An authored sequence built on the GDD's three examples
 * would have shipped with two of its three branches unreachable — which is the T87 finding exactly
 * ("the prescribed cure rested on a surplus that does not exist"), arriving for the second time in two
 * tasks.
 *
 * **So the acts are a MENU, not a script — T61's decision applied one layer down.** An act is offered
 * only when the run can pay for it, the floor act is unconditional, and the two people-acts are
 * authored anyway: they are clauses that never fire rather than branches that crash, and they light up
 * with no code change the day T59/T60 move the mortality curve. The pack — the one thing 97.1% of
 * stands actually have — is what the reachable acts are written against.
 *
 * ## THE STAND IS WHAT MAKES `sacrifice` REACHABLE, AND IT DOES IT WITHOUT WIDENING IT
 *
 * T61 authored `ending.sacrifice.json` and then declared it unreachable (PL-M5-69): its predicate is *a
 * Last Stand in a base you still hold*, and a survivor stands in a held base 6.2 turns a run and is in
 * combat there on **0.00** of them, because T76 made the shelter a hard sanctuary and T83 resolves the
 * night as a siege event rather than a fight. Re-derived here over 480 runs, including a `homebody` bot
 * that claims the nearest base and then stays in it: **15.2 turns a run at home, 0.00 of them in
 * combat.** The obvious repair — let a siege breach become a fight — measures dead too: **17 breaches
 * in 480 runs and not one of them with the player at home**, because `SIEGE_PLAYER_DEFENCE` (15) is
 * larger than `SIEGE_BASE_DEFENCE` (12), so *standing in your own base is the thing that stops it being
 * breached*. Both routes are closed.
 *
 * The route that opens is this module's, and it is a better one. Before T62 a death had no *act* in it,
 * so `atBase` was the only proxy available for "this death bought something". Now the run's last act is
 * a choice the player makes, and an act **declares the shape it resolves toward** ({@link StandActDef.shape}).
 * `sim/ending.ts` reads that off the Living History at the end, like everything else it reads. That is
 * not widening `sacrifice` until it means "died somewhere" — the thing T61 explicitly refused — it is
 * narrowing it to *died doing something for something else*, which is what the word means, and the
 * `atBase` route is left exactly as it was.
 *
 * ## Shape
 *
 * 1. **A death opens the stand instead of ending the run.** {@link standIsOpen} is true while a death
 *    reason holds and the stand is armed and unspent; `runEndReason` returns **null** for exactly that
 *    window, so every one of its consumers — the harness loops, the Test Lab runner, `sceneOf`,
 *    `availableActions` — keeps the run alive without being taught a new question. (That is the T87
 *    lesson from the other side: the way to add a terminal state safely is to not make every reader
 *    learn about it.)
 * 2. **It lasts exactly one turn.** GDD IX says *"one last set of choices"*, singular. Every act ends
 *    the run, so the window cannot be held open, farmed, or escaped from.
 * 3. **All four deaths open one** — `lastStand`, `infection`, `dehydrated`, `starved` — not just the
 *    one in a fight. FR-STY-07 names *"a Last Stand, a shelter overrun, a slow loss to infection —
 *    each gets a real close"*, and a fever that crests is a close the player should get to answer.
 *    Measured, a stand-in-a-fight covers 63.8% of runs and the three quiet deaths another 36.2%; a
 *    `lastStand`-only build would have left better than a third of all deaths on the card. The acts
 *    are gated per reason, which is what keeps *take it with you* out of a death with nothing to take.
 *    Neither **win** opens one: `escaped` and `held` already close on the finished project's own words.
 * 4. **Nothing is stored that is not already in the save.** The armed and spent bits are two keys in
 *    `story.endingFlags`, which has been a `Flags` record since v7 — **save stays v10, no rung** — and
 *    the *outcome* is a history beat, because the task's own brief asks the sequence to write what it
 *    did into the Living History and let `sim/ending.ts` read it rather than opening a second
 *    closing-text path. The flags are exact keys, not prefixes, and disjoint from `project.commit.` /
 *    `project.stage.` / `ending.*` — T87's audit found a stage id of `committed` producing the commit
 *    flag itself, and its conclusion was that **any suffix rule has that failure somewhere**.
 * 5. **Gated like every content pool since T81.** No `content/stands/` pool ⇒ the armed flag is never
 *    seeded ⇒ `runEndReason` is the identical pre-T62 expression and no stand ever opens. Byte-identical
 *    narration, choices and saves, verified by driving bots through both trees.
 *
 * **The one honest cost of arming at `startRun`.** The flag is seeded when the run is created, because
 * `runEndReason(state)` takes no graph and so cannot ask the content set anything — the same constraint
 * that forced T87 to bend the derive-don't-store rule, for the same reason, and the second time it has
 * bent. The consequence is that **a run begun before a stand pool existed keeps its old ending even if
 * it is loaded by a client that has one.** That is deliberate: it needs no migration, it cannot corrupt
 * an in-flight save, and a run that was played without a stand arguably should not acquire one halfway
 * through. T65 owns the migration if it is ever wanted.
 *
 * Pure, deterministic, dependency-free (ADR-0001): no RNG, no clock read, no I/O, no draw. A **leaf** —
 * it reads `survival`, `events`, `companions` and `combat`'s grab predicate, and nothing in `sim/`
 * imports it.
 */

import type { ContentId, GameState, HistoryEvent } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { deathReason, endingNarration, RUN_END_REASONS, type RunEndReason } from "./survival.js";
import { woundBurden } from "./wounds.js";
import { rosterOf, removeBodyAt } from "./roster.js";
import { CORPSES_PER_KILL, BLOOD_PER_KILL } from "./noise.js";
import { humanityOf } from "./events.js";
import { isCompanion } from "./companions.js";

// --- the flags ------------------------------------------------------------------------------------

/**
 * Set at `startRun` when a non-empty `content/stands/` pool is registered. Its **absence** is what
 * makes every pre-T62 run, and every client that ships no stands, byte-identical.
 */
export const STAND_ARMED_FLAG = "stand.armed";
/** Set by {@link resolveStandAction}. Its presence is what lets the death through. */
export const STAND_SPENT_FLAG = "stand.spent";
/**
 * Prefix of the flag recording **which death the stand was taken against**, set alongside
 * {@link STAND_SPENT_FLAG}.
 *
 * It exists because a stand is not an exchange you can win, and the first cut let you win one: an act
 * whose effect is `kill` clears `state.combat`, so `inLastStand` went false the frame after and
 * `runEndReason` — which was still re-asking the condition — reported a living player. Measured, those
 * runs carried on for another 15-30 turns. The reason is now recorded at the moment it is spent and
 * reported from then on, which also makes a save loaded one frame later close on the same words.
 */
export const STAND_DEATH_FLAG_PREFIX = "stand.death.";
/** The flag recording the death a spent stand was taken against. */
export const standDeathFlag = (reason: RunEndReason): string => `${STAND_DEATH_FLAG_PREFIX}${reason}`;

const flagOn = (flags: { readonly [k: string]: boolean }, key: string): boolean => flags[key] === true;

/** Whether this run was created with a stand pool registered. */
export const standArmed = (state: GameState): boolean => flagOn(state.story.endingFlags, STAND_ARMED_FLAG);
/**
 * Whether the one final act has already been taken.
 *
 * Reads **both** halves of what a spend writes. A spend sets `stand.spent` and `stand.death.<reason>`
 * together, so in a state this engine produced either alone is enough — but a hand-edited save can
 * carry one without the other, and the mutation run found what that costs: with only the first read,
 * a state holding a death flag and no `stand.spent` had `standIsOpen` and `isRunOver` **both true**,
 * and which one the player got came down to the order of two branches in `availableActions`. Reading
 * both makes the two states provably exclusive instead of exclusive-by-arrangement.
 */
export function standSpent(state: GameState): boolean {
  const flags = state.story.endingFlags;
  if (flagOn(flags, STAND_SPENT_FLAG)) return true;
  for (const key of Object.keys(flags)) {
    if (flags[key] === true && key.startsWith(STAND_DEATH_FLAG_PREFIX)) return true;
  }
  return false;
}

/**
 * The run-end reasons that open a stand: the four **deaths**.
 *
 * A `Record` over the union rather than a `Set` of strings, so TypeScript refuses to compile the day a
 * seventh reason is added and nobody decides which side of this line it falls on — the same drift guard
 * `RUN_END_REASONS` is, and it exists because T82 found the hand-written copy of that list in the Test
 * Lab the hard way.
 */
const OPENS_A_STAND: Record<RunEndReason, boolean> = {
  lastStand: true,
  infection: true,
  dehydrated: true,
  starved: true,
  // The two wins (T87). A finished departure or a held block closes on the project's own authored
  // ending; there is nothing for a dying survivor's last act to be, because nobody is dying.
  escaped: false,
  held: false,
};

/** Whether this reason is a death the survivor gets to answer. */
export const opensStand = (reason: RunEndReason): boolean => OPENS_A_STAND[reason] === true;

/**
 * The death a stand is being taken against, or null when no stand is open.
 *
 * Deliberately **not** `runEndReason`: that function returns null for exactly this window (which is the
 * whole mechanism), so a consumer that needs to know *what* is killing the player has to ask here. Both
 * read the same underlying condition; only their answers about whether the run is over differ.
 */
export function standReason(state: GameState): RunEndReason | null {
  if (!standArmed(state) || standSpent(state)) return null;
  const reason = deathReason(state);
  return reason !== null && opensStand(reason) ? reason : null;
}

/** Whether the survivor is in their final turn. */
export const standIsOpen = (state: GameState): boolean => standReason(state) !== null;

/**
 * The raw death condition, ignoring the stand entirely.
 *
 * `survival.ts#runEndReason` calls this and then suppresses its answer while a stand is open, so it
 * lives there and is re-exported here rather than duplicated: two copies of "what is killing this
 * player" is exactly the drift T82's `RUN_END_REASONS` guard exists to prevent.
 */
export { deathReason };

// --- content --------------------------------------------------------------------------------------

/**
 * A stand act's admission test. Closed, engine-side vocabulary — content supplies the prose and the
 * thresholds, the engine supplies the facts. Same contract as `EndingRequirement` (T61) and
 * `EncounterRequirement` (T47), which content authors already know.
 *
 * Every field is annotated with **what it measured at the stand frame** over 160 pre-T62 runs, so the
 * next person can tell a live gate from a dead one without re-deriving it (`measure/t62.ts --hands`).
 * T61's dial lesson is the reason that annotation is mandatory here: a `minDays >= 8` gate it shipped
 * fired 0 times in 241 runs because nobody had checked that mortal runs end on day 1–5.
 */
export interface StandRequirement {
  /** Deaths this act is admissible for. Absent ⇒ any death. */
  readonly reasons?: readonly RunEndReason[];
  /** Something is in front of you. **100% of `lastStand`, 0% of the three quiet deaths.** */
  readonly requiresCombat?: boolean;
  /** Other dead standing on your node. Mean **1.76** at a stand. */
  readonly minWalkers?: number;
  /** Companions still standing. Measured **0.00 in 102 stands** — authored ahead (PL-M5-71's shape). */
  readonly minCompanions?: number;
  /** Survivors ever met. Measured **0.00 in 102 stands** — authored ahead, same reason. */
  readonly minMet?: number;
  /** Units in the pack. Measured **3.72, and 97.1% of stands carry at least one**. */
  readonly minItems?: number;
  /** Standing in a base you still hold. Measured **0.0%** (PL-M5-69). */
  readonly requiresAtBase?: boolean;
  /** A base was claimed at some point. Measured **20.6%**. */
  readonly requiresClaimed?: boolean;
  /** Infection past `none`. */
  readonly requiresFeverish?: boolean;
  /** Untreated wound burden. Measured **218.6** at a stand, against a `LAST_STAND_AT` of 80. */
  readonly minBurden?: number;
  /** Hidden moral standing, 0–100. Measured 31–73 across 200 runs — **the extremes are unreachable
   * (PL-M5-70), so gate on the shift instead.** */
  readonly minHumanity?: number;
  readonly maxHumanity?: number;
  readonly minDay?: number;
}

/**
 * Every requirement key, as a value.
 *
 * The schema is checked against this **both ways** — no key here that the schema will not accept, and
 * no key in a `when` block that is not here. T61's audit found a typo'd requirement key making a clause
 * **unconditional** rather than failing loudly, which is the worst direction for a typo to fail in.
 */
export const STAND_REQUIREMENT_KEYS: readonly string[] = [
  "reasons", "requiresCombat", "minWalkers", "minCompanions", "minMet", "minItems",
  "requiresAtBase", "requiresClaimed", "requiresFeverish", "minBurden",
  "minHumanity", "maxHumanity", "minDay",
];

/** One thing a dying survivor can do with what is left. */
export interface StandActDef {
  readonly id: ContentId;
  /** What the choice reads like on the menu. */
  readonly label: string;
  /** What it reads like once taken — the line that closes the scene before the ending is assembled. */
  readonly text: string;
  /**
   * The ending shape this act resolves the run toward, if it claims one. Absent ⇒ the run's shape is
   * derived exactly as T61 derived it, from what the run *was*.
   *
   * Typed as a bare string rather than importing `EndingShape`, because `sim/ending.ts` imports **this**
   * module and the reverse import would close a cycle. `endingShapeOfStand` in that module is the one
   * place the string is narrowed, against `ENDING_SHAPES`, so an unknown value is ignored rather than
   * trusted — and the schema rejects it long before that.
   */
  readonly shape?: string;
  /**
   * What this act does to the world, beyond being remembered — one of `kill`, `drop`, `mark`, or
   * absent for an act that changes no field anywhere.
   *
   * A **closed set handled in code**, not an expression: see {@link applyStandEffect} for why it is
   * three and not more. An unknown value is ignored rather than trusted (the `default` arm), and the
   * schema rejects it first.
   */
  readonly effect?: "kill" | "drop" | "mark";
  readonly when?: StandRequirement;
  /** Higher sorts first; ties break on id so the menu is machine-independent. */
  readonly weight: number;
}

/**
 * Every world change an act may make, as a value — the drift guard, so adding a fourth without
 * teaching {@link applyStandEffect} about it stops compiling rather than falling through its `default`
 * arm and silently doing nothing under prose that says otherwise.
 */
export const STAND_EFFECTS: readonly NonNullable<StandActDef["effect"]>[] = ["kill", "drop", "mark"];

/** The authored stand for one or more deaths. One def per death in the shipped set. */
export interface StandDef {
  readonly id: ContentId;
  /** Deaths this def covers. A def whose reasons do not include the death is not consulted. */
  readonly reasons: readonly RunEndReason[];
  /** The heightened line that opens the scene — what it is like to be here. */
  readonly opening: string;
  readonly acts: readonly StandActDef[];
}

/** The registered stand pool, or empty when the client did not supply one. */
export const standPool = (graph: RegionGraph | undefined): readonly StandDef[] => graph?.stands ?? [];

/** Whether the stand system is live for this content set. */
export const standsActive = (graph: RegionGraph | undefined): boolean => standPool(graph).length > 0;

/**
 * How many authored acts a stand may offer, on top of the unconditional floor.
 *
 * **Three, and it is a legibility judgement rather than a measured one** — said plainly because most
 * constants in this codebase are measured. This menu is read once, under pressure, in a terminal or a
 * screen reader, and it is the last thing the player will ever read in this run; a list of eight is a
 * list nobody finishes. Measured act *supply* is 3.1 admissible on an ordinary stand, so the cap binds
 * on some stands and not others, which is the property that makes two stands differ.
 */
export const STAND_ACT_LIMIT = 3;

// --- the facts an act is tested against ------------------------------------------------------------

/** What is true of the survivor at the moment the stand opens. Folded once per menu. */
export interface StandFacts {
  readonly reason: RunEndReason;
  readonly inCombat: boolean;
  readonly walkers: number;
  readonly companions: number;
  readonly met: number;
  readonly items: number;
  readonly atBase: boolean;
  readonly claimed: boolean;
  readonly feverish: boolean;
  readonly burden: number;
  readonly humanity: number;
  readonly day: number;
}

/** Fold the final frame into the facts an act is admitted against. Pure; no graph needed. */
export function standFacts(state: GameState, reason: RunEndReason): StandFacts {
  const cond = state.player.condition;
  const shelterId = state.player.shelterId;
  return {
    reason,
    inCombat: state.combat !== null,
    walkers: state.nodes[state.player.location]?.walkers ?? 0,
    companions: Object.values(state.actors).filter(isCompanion).length,
    met: Object.values(state.npcs).filter((n) => n.met).length,
    items: state.player.inventory.reduce((n, e) => n + Math.max(0, e.quantity), 0),
    atBase: shelterId !== null && state.player.location === shelterId,
    // From the log as well as the frame, so a base claimed on day 2 and lost on day 9 still counts —
    // the T61 rule that the history says what *happened* and the state only what is *true at the end*.
    claimed: shelterId !== null || state.history.some((e) => e.type === "shelter.claimed"),
    feverish: cond.infection.stage !== "none",
    burden: woundBurden(cond),
    humanity: humanityOf(state),
    day: state.meta.day,
  };
}

const atLeast = (have: number, want: number | undefined): boolean => want === undefined || have >= want;

/** Whether the run can pay for this act. Every set field must hold; absent fields are ignored. */
export function matchesStand(f: StandFacts, req: StandRequirement | undefined): boolean {
  if (req === undefined) return true;
  if (req.reasons !== undefined && !req.reasons.includes(f.reason)) return false;
  if (req.requiresCombat === true && !f.inCombat) return false;
  if (!atLeast(f.walkers, req.minWalkers)) return false;
  if (!atLeast(f.companions, req.minCompanions)) return false;
  if (!atLeast(f.met, req.minMet)) return false;
  if (!atLeast(f.items, req.minItems)) return false;
  if (req.requiresAtBase === true && !f.atBase) return false;
  if (req.requiresClaimed === true && !f.claimed) return false;
  if (req.requiresFeverish === true && !f.feverish) return false;
  if (!atLeast(f.burden, req.minBurden)) return false;
  if (req.minHumanity !== undefined && f.humanity < req.minHumanity) return false;
  if (req.maxHumanity !== undefined && f.humanity > req.maxHumanity) return false;
  if (!atLeast(f.day, req.minDay)) return false;
  return true;
}

// --- the menu --------------------------------------------------------------------------------------

const STAND_ACT = "stand";
/** Choice id prefix. `stand:<actId>`; the floor act uses {@link STAND_FLOOR_ID}. */
export const STAND_CHOICE_PREFIX = `${STAND_ACT}:`;

/**
 * The act that is always on the menu, and the reason it is not content.
 *
 * The exit gate's one hard invariant is **`availableActions` is never empty** (T57), and a content set
 * that authors nothing admissible for this death would break it in the one place a player can least
 * afford it. So the floor lives in code: it needs no payment, it is always last, and it is the quiet
 * one — *stop*. It is also the honest default. A survivor who has nothing left to spend still gets to
 * decide that they are done, and GDD XIII's `fade` is a real ending rather than a failure to have one.
 */
export const STAND_FLOOR_ID = "stand.let-go";
const FLOOR_LABEL = "Stop fighting it.";
const FLOOR_TEXT = "You stopped. Whatever came next, it came without you arguing.";
/**
 * **The floor act declares NO shape, and that is an audit fix rather than an omission.**
 *
 * A first cut had it declare `fade`, on the reasoning that stopping is the quiet ending. Because
 * `shapeOfSummary` puts a declared shape above every derived test, that made the one act on every
 * menu overwrite the derivation — so a survivor who went down **inside a base they still held** and
 * chose "Stop fighting it" was reported as a `fade` when T61's `atBase` rule says `sacrifice`, and a
 * settled survivor who stopped was a `fade` rather than an `entrenchment`. The default choice was
 * quietly destroying the only `sacrifice` route that existed before this task.
 *
 * The floor act is what a survivor does when there is nothing left to spend; it is not a claim about
 * what the run WAS. So it makes none, and T61's derivation answers, which for the ordinary rootless
 * run is `fade` anyway — the same answer, now for the right reason.
 */
export const STAND_FLOOR_SHAPE: string | null = null;

/**
 * A stand act spends **no hours**, and that is a deliberate exception to FR-CORE-03.
 *
 * The requirement exists so time always advances and no verb can be farmed for free. A terminal act
 * cannot be farmed — taking it *ends the run* — so the rule it protects is not at risk here. Charging
 * an hour would be actively wrong besides: the pipeline would then tick a night, a siege and a horde
 * walk **after** the survivor is dead, and a base could be breached in the minute between the last
 * choice and the closing line. `EQUIP_COST` (T18) is the standing precedent for a zero-cost verb.
 */
export const STAND_COST = 0;

const speaks = (a: StandActDef): boolean =>
  typeof a.label === "string" && a.label.trim() !== "" && typeof a.text === "string" && a.text.trim() !== "";

/** Selection weight, coerced once — a non-numeric weight sorts as 0 rather than making the comparator
 * non-transitive. T61's audit finding 6, which promoted the garbage clause to the top slot. */
const weightOf = (a: StandActDef): number => (Number.isFinite(a.weight) ? a.weight : 0);

/** The def covering this death, or null. First match in pool order; ids break ties in the schema. */
export function standDefFor(graph: RegionGraph | undefined, reason: RunEndReason): StandDef | null {
  for (const def of standPool(graph)) {
    if (Array.isArray(def.reasons) && def.reasons.includes(reason)) return def;
  }
  return null;
}

/** The authored acts this run can pay for, strongest first — before the floor is appended. */
export function admissibleActs(state: GameState, graph: RegionGraph | undefined, reason: RunEndReason): readonly StandActDef[] {
  const def = standDefFor(graph, reason);
  if (def === null) return [];
  const facts = standFacts(state, reason);
  // `def.acts ?? []` rather than `def.acts`: `buildRegionGraph` rejects a def without an array, but
  // this module is also reachable from a client that builds a graph by hand, and the failure that
  // guards against is a `TypeError` thrown on the exact frame the player died — T61's audit finding 4,
  // in the same position, one task later.
  return (def.acts ?? [])
    .filter((a) => speaks(a) && matchesStand(facts, a.when))
    .slice()
    .sort((a, b) => weightOf(b) - weightOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, STAND_ACT_LIMIT);
}

/**
 * The final set of choices, or empty when no stand is open.
 *
 * Total and deterministic: admissible acts sort by weight descending then id ascending, the first
 * {@link STAND_ACT_LIMIT} are taken, and the floor is appended last. The id tiebreak is not decoration —
 * without it two acts of equal weight resolve in authoring order, which is directory order, which is
 * not a contract, and the same save would offer a different last choice on two machines.
 */
export function standChoices(state: GameState, graph: RegionGraph | undefined): readonly SceneChoice[] {
  const reason = standReason(state);
  if (reason === null) return [];
  const out: SceneChoice[] = [];
  for (const act of admissibleActs(state, graph, reason)) {
    out.push({
      id: `${STAND_CHOICE_PREFIX}${act.id}`,
      label: act.label,
      timeCost: STAND_COST,
      action: { type: STAND_ACT, choiceId: `${STAND_CHOICE_PREFIX}${act.id}`, timeCost: STAND_COST, params: { act: act.id } },
    });
  }
  out.push({
    id: `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`,
    label: FLOOR_LABEL,
    timeCost: STAND_COST,
    action: { type: STAND_ACT, choiceId: `${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`, timeCost: STAND_COST, params: { act: STAND_FLOOR_ID } },
  });
  return out;
}

/**
 * The scene the stand opens on: what is killing you, then what it is like to be here.
 *
 * `lines[0]` is **byte-for-byte `endingNarration(reason)`** — the exact sentence the run closed on
 * before T62 — for the same reason T61's `lines[0]` was: the authored death scenes and every test over
 * them stay intact, GDD IX rule 5 stays true of the first thing the player reads, and the content gate
 * has nothing to protect but an addition. T61 called this the cheapest gate of all and it is reused
 * here deliberately.
 */
export function standNarration(state: GameState, graph: RegionGraph | undefined): string | null {
  const reason = standReason(state);
  if (reason === null) return null;
  const def = standDefFor(graph, reason);
  const opening = def === null ? "" : def.opening;
  return opening.trim() === "" ? endingNarration(reason) : `${endingNarration(reason)} ${opening}`;
}

// --- resolution --------------------------------------------------------------------------------------

/** The beat a spent stand writes. `sim/ending.ts` reads this and nothing else about the stand. */
export const STAND_BEAT = "stand.spent";

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export const isStandAction = (action: Action): boolean => action.type === STAND_ACT;

const appendBeat = (state: GameState, type: string, subjects: readonly string[], data: Record<string, string | number | boolean | null>): GameState => {
  const { day, hour, turn } = state.meta;
  return { ...state, history: [...state.history, { day, hour, turn, type, subjects: [...subjects], data }] };
};

const withFlags = (state: GameState, add: Record<string, boolean>): GameState => ({
  ...state,
  story: { ...state.story, endingFlags: { ...state.story.endingFlags, ...add } },
});

/**
 * Take the final act (pipeline stage 3).
 *
 * **Re-validates its own gate rather than trusting the offered list**, which is T87's audit finding 1
 * in this module's own shape: `assertLegal` runs only for an action carrying a `choiceId` and compares
 * that string and nothing else, so a resolver that trusts the menu has no rule at all. A forged
 * `stand` action on a living survivor, or a second one after the first, is a no-op returning the same
 * object — and the second case matters, because without it a client could write two `stand.spent`
 * beats and the ending would read the wrong act.
 *
 * The act's own id is checked against the **admissible** list, not merely against the pool: an act the
 * run cannot pay for is not an act it can take, and the alternative is a survivor holding a door for a
 * companion who is not there.
 */
export function resolveStandAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  if (!isStandAction(action)) return state;
  const reason = standReason(state);
  if (reason === null) return state;
  const actId = action.params?.["act"];
  if (typeof actId !== "string") return state;

  // Both flags, together and once: the stand is spent, and *this* is what it was spent against.
  const spent = withFlags(state, { [STAND_SPENT_FLAG]: true, [standDeathFlag(reason)]: true });
  if (actId === STAND_FLOOR_ID) {
    return appendBeat(spent, STAND_BEAT, ["player"], { act: STAND_FLOOR_ID, reason });
  }
  const act = admissibleActs(state, graph, reason).find((a) => a.id === actId);
  // An act the run cannot pay for is refused on the UNMODIFIED state, so a rejected forgery leaves no
  // flags behind — `spent` above is a local, not a mutation.
  if (act === undefined) return state;
  // The world half of the act, applied before the beat so the beat describes a state that is true.
  const world = applyStandEffect(spent, act, reason);
  return appendBeat(world, STAND_BEAT, ["player", act.id], {
    act: act.id,
    ...(typeof act.shape === "string" && act.shape.trim() !== "" ? { shape: act.shape } : {}),
    reason,
  });
}

/**
 * What an act actually does to the world, beyond being remembered.
 *
 * **Deliberately small, and the smallness is the honesty.** T61's sharpest audit lesson was that *prose
 * is a claim about mechanics* — four of its seven real findings were sentences that were simply false of
 * the run they printed over, including two that narrated a mechanic the engine does not have. This
 * module has one authored act per real effect and no more: an act's text may describe only what the
 * lines below actually do, plus the fact of being remembered, which the beat makes true.
 *
 * The three effects, each an existing mechanic rather than a new one:
 *   - **the fight ends with you having ended it** — the thing that had hold of you is put down, which
 *     leaves a body (`corpses`) and a mess (`blood`) on the node exactly as any other kill does (T84
 *     wired both, and `sim/detection.ts` reads them);
 *   - **what you carried is left where you fell** — the pack empties. There is no node-level item
 *     store in this codebase, so nothing claims the next survivor can pick it up; what the act says is
 *     that you stopped carrying it, which is exactly what happens;
 *   - **a mark on the wall** — a note pinned to the node (T84's `playerNotes`, the same field the `pin`
 *     verb writes and the harness's Map & Journal screen reads back).
 *
 * An act with no `effect` does nothing to the world at all, and that is a legitimate act: *say the
 * thing you never said* changes no field anywhere, and pretending otherwise would be the defect above.
 */
/**
 * 0–100 scrub, identical to `combat.ts`'s. Duplicated rather than imported because importing
 * `combat/combat.ts` here would close a cycle (`combat` -> `sim/companions` -> `sim/survival`).
 */
const clampNodePct = (n: unknown): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.trunc(v)));
};
/** The mark. Deliberately one of `NOTE_PHRASES` — the vocabulary the `pin` verb already offers. */
export const STAND_NOTE = "dead here — careful";
/** Matches `NOTE_MAX_PER_NODE`; a node already carrying its fill is not written to. */
export const STAND_NOTE_MAX = 6;

export function applyStandEffect(state: GameState, act: StandActDef, _reason: RunEndReason): GameState {
  const here = state.player.location;
  const node = state.nodes[here];
  switch (act.effect) {
    case "kill": {
      if (state.combat === null || node === undefined) return state;
      // **Through the roster, exactly as `killEnemy` does.** The audit caught the first cut bumping
      // `corpses` and `blood` and stopping there, which left `walkers` unchanged — so the thing that
      // had you was still standing on the node while three authored sentences said the street was one
      // body lighter. A body removed here drops the count and re-derives `zombieTypes` when it was the
      // last of its kind, and the deposits are the kill table's own numbers rather than a second set.
      const bodies = rosterOf(node);
      const dropped = bodies.length === 0 ? node : removeBodyAt(node, bodies.length - 1);
      return {
        ...state,
        combat: null,
        nodes: {
          ...state.nodes,
          [here]: {
            ...dropped,
            // Clamped on read as well as write: the save format validates almost nothing, and `+ N` on a
            // junk value produces NaN or a string concatenation. The identical scrub `killEnemy` applies,
            // and for the identical reason (T83's audit, twice over).
            corpses: clampNodePct(clampNodePct(dropped.corpses) + CORPSES_PER_KILL),
            blood: clampNodePct(clampNodePct(dropped.blood) + BLOOD_PER_KILL),
          },
        },
      };
    }
    case "drop": {
      if (state.player.inventory.length === 0) return state;
      // **Emptying the pack also empties the hand, and forgets the instances.** The audit caught the
      // first cut clearing `inventory` alone, which left `player.equipment` pointing at an item id the
      // pack no longer carried and the instance itself stranded in `state.items` — a dangling reference
      // that survives a save round-trip, and a survivor still swinging the pipe they had just narrated
      // setting down. This is the bookkeeping the `drop` verb does for ONE artifact, applied to all of
      // them (`actions/coreActions.ts`, case "drop").
      const dropped = new Set(state.player.inventory.map((e) => e.itemId).filter((id): id is string => typeof id === "string"));
      const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => !dropped.has(id)));
      const equipment = Object.fromEntries(Object.entries(state.player.equipment).filter(([, id]) => !dropped.has(id)));
      return { ...state, items, player: { ...state.player, inventory: [], equipment } };
    }
    case "mark": {
      if (node === undefined) return state;
      const existing = node.playerNotes ?? [];
      // Deduped like `noteFor`, which refuses to offer a phrase the node already carries. Not a corner
      // case: `noteFor` offers this exact phrase FIRST whenever the node has corpses on it, which is
      // true of any node the player has killed on — i.e. exactly where a Last Stand happens. Without
      // this the Map & Journal screen renders the same line twice.
      if (existing.length >= STAND_NOTE_MAX || existing.includes(STAND_NOTE)) return state;
      return { ...state, nodes: { ...state.nodes, [here]: { ...node, playerNotes: [...existing, STAND_NOTE] } } };
    }
    default:
      return state;
  }
}

/**
 * The prose for an act that was taken — what the survivor did, for the ending to print.
 *
 * **Takes the DEATH as well as the act id, and the audit is why.** An act id is unique within a def but
 * deliberately shared across them: the shipped set authors `leave-what-you-carry` four times, once per
 * death, because leaving your pack behind reads differently when you are bleeding out than when you
 * have been out of water for a day. A first cut looked the id up by scanning the whole pool and taking
 * the first hit, which meant **ten of the eighteen authored act texts could never print** — every death
 * got `stand.fever`'s words, because that file sorts first. Worse, it was not even stable: the shipped
 * terminal harness loads content with an unsorted `readdirSync`, so *which* file's prose printed was
 * filesystem-order dependent — the precise machine-independence the act sort's id tiebreak exists to
 * buy, lost one function later.
 *
 * The death is in the beat already; {@link standTaken} now returns it. The pool scan survives only as
 * the fallback for a beat written before the reason was recorded.
 */
export function standActLine(graph: RegionGraph | undefined, actId: string, reason?: RunEndReason | null): string | null {
  if (actId === STAND_FLOOR_ID) return FLOOR_TEXT;
  const own = reason === undefined || reason === null ? null : standDefFor(graph, reason);
  if (own !== null) {
    for (const a of own.acts ?? []) if (a.id === actId && speaks(a)) return a.text;
  }
  for (const def of standPool(graph)) {
    for (const a of def.acts ?? []) {
      if (a.id === actId && speaks(a)) return a.text;
    }
  }
  return null;
}

/**
 * The act the run's last turn was spent on, read off the Living History.
 *
 * Scans **backwards**: the beat is the last thing that happens in a run, so the first match is the
 * newest, and a forged double-spend (which `resolveStandAction` refuses, but a hand-edited save can
 * still contain) resolves to the one that was taken last rather than first.
 */
export function standTaken(history: readonly HistoryEvent[]): { act: string; shape: string | null; reason: RunEndReason | null } | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i]!;
    if (e.type !== STAND_BEAT) continue;
    // `HistoryEvent.data` is a `JsonValue`, which may legitimately be a string or an array — a beat
    // written by a hand-edited save, or by a future author, is not required to be an object. Narrowed
    // rather than cast, so a malformed beat reads as "no act taken" instead of throwing on the frame
    // the player died (T61's audit finding 4, which is the failure this whole module is downstream of).
    const data = e.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const bag = data as { readonly [k: string]: unknown };
    const act = bag["act"];
    if (typeof act !== "string") return null;
    const shape = bag["shape"];
    const reason = bag["reason"];
    return {
      act,
      shape: typeof shape === "string" ? shape : null,
      // The death the stand was taken against — what picks the right def's prose out of an act id that
      // four files share. Narrowed against the canonical list rather than trusted.
      reason: typeof reason === "string" && (RUN_END_REASONS as readonly string[]).includes(reason) ? (reason as RunEndReason) : null,
    };
  }
  return null;
}
