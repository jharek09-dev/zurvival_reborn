/**
 * Infection as staged identity (M4 task T49 · FR-INJ-05/06/07/08 · GDD Part VI).
 *
 * The M1 loop (T22) modelled infection as a **countdown to an instant Game Over**: a bite drives a
 * hidden `progression`, and at 100 the run just ends. GDD Part VI and PRD §7.5 are explicit that this
 * is exactly wrong — "infection is identity, not a countdown." This module promotes it:
 *
 *   - **Staged (FR-INJ-05).** none → incubating (the GDD's *asymptomatic*) → symptomatic → advanced →
 *     terminal, read only from symptoms — there is no infection bar. `"incubating"` is kept as the key
 *     for asymptomatic (renaming would churn saves/content for nothing; the prose says asymptomatic).
 *   - **No instant Game Over (FR-INJ-08).** Reaching `terminal` no longer ends the run — it *opens*
 *     new play: a cure race with failing senses. Death by infection is a **delayed `succumb`**
 *     ({@link INFECT_SUCCUMB_AT}) the player only reaches by neglecting the race across a real window;
 *     `runEndReason` (in survival.ts) reads {@link hasSuccumbed}, never terminal onset. The *authored*
 *     heightened death scene is deferred to T62.
 *   - **Perception / symptoms (FR-INJ-06).** {@link perceptionDistortion} makes the scene text
 *     unreliable at advanced/terminal — hallucinated leads, then memory gaps — framed as *possibly
 *     unreal* so they read as a symptom, never a real threat (real decisions still key off real state).
 *     It is a **stateless hash** ({@link hashUnit}) of `seed:turn`, so a *render* stays pure and never
 *     advances the rng. {@link stageInfo} carries the honest symptom/sign prose the harness surfaces.
 *   - **Diagnosis / cure / quarantine (FR-INJ-07).** {@link infectionChoices} offers `diagnose`
 *     (precise stage read), `treat-infection` (antibiotics — the cure, stage-scaled and *late-uncertain*
 *     via a seeded roll on the new `infection` stream), and `quarantine` (shelter clean-conditions —
 *     strong early, useless at terminal). "The deeper it goes, the costlier and less certain the cure."
 *
 * No save-schema rung (v8 holds): `"advanced"` is a new value of the existing `Infection.stage` string,
 * `progression` is the existing int (now clamped to {@link INFECT_CEILING}), the diagnosed flag rides
 * `player.flags`, and the `infection` RNG stream rides the open `rng.streams` map (lazily seeded — no
 * migration, exactly as T48's `encounter` stream). Inert unless infected, so every prior run is
 * byte-identical. Pure, deterministic, dependency-free, integer-only where it stores (ADR-0001).
 */

import type { GameState, HistoryEvent, Infection, InventoryEntry } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { drawFloat } from "../rng/streams.js";
import { hashUnit } from "../rng/prng.js";
import { woundRemainder } from "./wounds.js";

// --- the staged model -------------------------------------------------------------------------

/** Infection progression per hour while an untreated bite is open (unchanged from T22). */
export const BITE_INFECT_RATE = 2;

/**
 * Stage thresholds on the hidden 0–{@link INFECT_CEILING} `progression`. Chosen so every prior T22
 * `stageFor` assertion still holds — `symptomatic` and `terminal` are unmoved; only `advanced` is
 * inserted between them, and `succumb` is added *past* terminal onset.
 */
export const INFECT_SYMPTOMATIC_AT = 40;
export const INFECT_ADVANCED_AT = 70;
export const INFECT_TERMINAL_AT = 100;
/**
 * The delayed collapse (FR-INJ-08). Terminal onset is 100; the body only *fails* — ending the run by
 * infection — once progression reaches this, ~24 in-game hours of continued untreated driver later.
 * That gap is the cure race: turns to diagnose, cure, or at least stop the driver and live on terminal.
 */
export const INFECT_SUCCUMB_AT = 148;
/** Infection progression runs past terminal onset up to the succumb point; its own clamp, not `clampPct`. */
export const INFECT_CEILING = INFECT_SUCCUMB_AT;

export type InfectionStage = Infection["stage"];

/** The hidden `progression` → the stage the player reads from symptoms. Pure, total. */
export function stageFor(progression: number): InfectionStage {
  if (progression >= INFECT_TERMINAL_AT) return "terminal";
  if (progression >= INFECT_ADVANCED_AT) return "advanced";
  if (progression >= INFECT_SYMPTOMATIC_AT) return "symptomatic";
  if (progression > 0) return "incubating";
  return "none";
}

/** Clamp infection progression to 0..{@link INFECT_CEILING} (integer). Distinct from the 0–100 needs clamp. */
export const clampInfection = (n: number): number => Math.max(0, Math.min(INFECT_CEILING, Math.trunc(n)));

/** Rank a stage for worsen/improve comparisons (history observer, dialogue gates). */
export const STAGE_ORDER: readonly InfectionStage[] = ["none", "incubating", "symptomatic", "advanced", "terminal"];
export const stageRank = (stage: InfectionStage): number => Math.max(0, STAGE_ORDER.indexOf(stage));

/** Is the player carrying an active infection at all (any stage past `none`)? */
export const isInfected = (state: GameState): boolean => state.player.condition.infection.stage !== "none";

/**
 * Is the infection *perceivable* — symptomatic or worse? The infection self-care verbs gate on this, not
 * on {@link isInfected}: offering a cure/diagnosis/quarantine while still asymptomatic (`incubating`)
 * would leak the hidden clock the moment the bite lands, defeating FR-INJ-05. While asymptomatic the
 * player's only lever is the ordinary wound `treat` — closing the bite stops the driver before it shows.
 */
export const isSymptomatic = (state: GameState): boolean =>
  stageRank(state.player.condition.infection.stage) >= stageRank("symptomatic");

/** The run-ending collapse: the body has finally failed (FR-INJ-08 — delayed, never instant). */
export const hasSuccumbed = (infection: Infection): boolean => infection.progression >= INFECT_SUCCUMB_AT;

// --- the driver + its consequences (called from survival.ts stage 4) --------------------------

/**
 * Advance the infection for `hours` passed, given whether an untreated bite is open. The bite is the
 * only source for now (deep-wound/tainted-water/spoiled-food sources are a T51 seam). Progression
 * climbs past terminal onset toward {@link INFECT_SUCCUMB_AT} while the driver runs; treating the bite
 * (closing the wound) or curing it stops/reverses it. Pure — returns a new {@link Infection}.
 */
export function advanceInfection(infection: Infection, biteOpen: boolean, hours: number): Infection {
  if (!biteOpen || hours <= 0) return infection;
  const progression = clampInfection(infection.progression + BITE_INFECT_RATE * hours);
  if (progression === infection.progression) return infection;
  return { progression, stage: stageFor(progression) };
}

/** Extra fatigue per in-game hour the fever costs at each stage — infection makes the loop harder to survive. */
export const INFECT_STAGE_FATIGUE: { readonly [stage in InfectionStage]: number } = {
  none: 0,
  incubating: 0, // asymptomatic — the clock runs, but the body hasn't turned yet
  symptomatic: 1,
  advanced: 2,
  terminal: 3,
};

/** The extra fatigue the current infection stage adds over `hours` (0 while healthy/asymptomatic). */
export function stageFatigue(stage: InfectionStage, hours: number): number {
  return INFECT_STAGE_FATIGUE[stage] * Math.max(0, Math.trunc(hours));
}

// --- honest symptom / sign prose (the comprehension channel, FR-INJ-06) -----------------------

/** The player-facing identity of one infection stage: what you feel, and what others see on you. */
export interface InfectionStageInfo {
  readonly key: InfectionStage;
  /** What the player *feels* — the honest, escalating status read (null while asymptomatic). */
  readonly symptom: string | null;
  /** What others *see* — the visible sign NPCs react to (null while asymptomatic). */
  readonly sign: string | null;
}

/**
 * The four staged identities, authoritative in the engine and mirrored by `content/infections/`. The
 * symptom channel is deliberately distinct and escalating per stage so a player can read *how bad it
 * is* without any number (the FR-INJ / tripwire guarantee); the advanced line honestly warns that
 * perception can no longer be trusted, which is what makes distrusting the story channel legible.
 */
export const INFECTION_STAGES: readonly InfectionStageInfo[] = [
  { key: "incubating", symptom: null, sign: null },
  {
    key: "symptomatic",
    symptom: "You feel feverish — a wound throbs with a heat that isn't healing, and a fine tremor runs through your hands.",
    sign: "the sheen of fever on you",
  },
  {
    key: "advanced",
    symptom:
      "The fever has burrowed deep. Sounds come from nowhere and shapes cross the edge of your sight — you can no longer trust your own senses.",
    sign: "the grey, sweating look of the badly infected",
  },
  {
    key: "terminal",
    symptom:
      "You are burning up and failing — thoughts swimming, time slipping, and you can no longer tell what is real. And yet you are still here, still moving.",
    sign: "the hollow, dying look of someone the infection has almost taken",
  },
];

const STAGE_INFO = new Map<InfectionStage, InfectionStageInfo>(INFECTION_STAGES.map((s) => [s.key, s]));

/** The staged identity for a stage, or undefined for `none`. */
export const stageInfo = (stage: InfectionStage): InfectionStageInfo | undefined => STAGE_INFO.get(stage);

/** The honest symptom line the player feels at their current stage, or null (healthy / asymptomatic). */
export function infectionSymptom(state: GameState): string | null {
  return stageInfo(state.player.condition.infection.stage)?.symptom ?? null;
}

/** The visible sign of infection on the player others react to, or null. */
export function infectionSign(state: GameState): string | null {
  return stageInfo(state.player.condition.infection.stage)?.sign ?? null;
}

// --- perception distortion — hallucinations, then memory gaps (FR-INJ-06) ---------------------

/** Chance a scene is distorted, per stage. Advanced flickers; terminal is often unreliable. */
export const ADVANCED_DISTORT_CHANCE = 0.4;
export const TERMINAL_DISTORT_CHANCE = 0.65;

/** Hallucinated leads — a threat or presence that may not be real (advanced+). Framed as unreliable. */
export const HALLUCINATION_LINES: readonly string[] = [
  "For a moment you're certain you hear them massing just out of sight — then nothing. Was any of it real?",
  "Something moves at the corner of your vision. When you turn to look, there is nothing there.",
  "A voice says your name, close and clear. No one is with you.",
  "The walls seem to pulse in time with your heartbeat. You blink and they are still again — you think.",
];

/** Memory gaps — turns the fever won't let the narrator account for (terminal only). */
export const MEMORY_GAP_LINES: readonly string[] = [
  "There is a gap you can't account for — you don't quite remember getting here.",
  "You lose a moment. When it returns, your hands are shaking and you're not sure what you were doing.",
];

/**
 * A hallucination or memory-gap line for this turn, or null. **Stateless and pure** — chosen by a hash
 * of `${seed}:${turn}` so a render never advances the rng and a resumed run is byte-identical. Only
 * fires at advanced/terminal; framed as possibly-unreal so it colours the ambient scene as a *symptom*
 * of the disease and never fabricates a real threat (real decisions key off real state alone).
 */
export function perceptionDistortion(state: GameState): string | null {
  const stage = state.player.condition.infection.stage;
  if (stage !== "advanced" && stage !== "terminal") return null;
  const { seed, turn } = state.meta;
  const chance = stage === "terminal" ? TERMINAL_DISTORT_CHANCE : ADVANCED_DISTORT_CHANCE;
  if (hashUnit(`${seed}:${turn}:infection-perception`) >= chance) return null;
  const pool = stage === "terminal" ? [...HALLUCINATION_LINES, ...MEMORY_GAP_LINES] : HALLUCINATION_LINES;
  const idx = Math.min(pool.length - 1, Math.floor(hashUnit(`${seed}:${turn}:infection-pick`) * pool.length));
  return pool[idx]!;
}

// --- diagnosis, cure, quarantine (FR-INJ-07) --------------------------------------------------

/** The anti-infection medicine — the cure item, findable in the T17 `medical` loot table. */
export const ANTIBIOTICS_ITEM = "item.antibiotics";
/** Supplies whose presence lets the player diagnose a stage precisely (the GDD's "right supplies"). */
export const DIAGNOSTIC_ITEMS: readonly string[] = ["item.antibiotics", "item.antiseptic", "item.painkillers"];
/** Player flag set once the player has diagnosed the sickness — the Scene then names the stage precisely. */
export const DIAGNOSED_FLAG = "infection.diagnosed";
/** The named RNG stream the *uncertain late cure* draws from (lazily seeded; rides the open streams map). */
export const INFECTION_STREAM = "infection";

/** Time costs (hours). All > 0 so each is a resolved, world-advancing turn (FR-CORE-03/04). */
export const DIAGNOSE_COST = 1;
export const CURE_COST = 4;
export const QUARANTINE_COST = 8;

/** How a cure dose acts at each stage: full effect, the partial (failed-roll) effect, and the odds of full. */
export interface StageCure {
  readonly amount: number;
  readonly partial: number;
  /** Probability of the full effect. `1` ⇒ certain (no RNG draw at all — early stages). */
  readonly certainty: number;
}

/** "Halt or reverse early stages; the deeper it goes, the costlier and less certain the cure" (GDD VI). */
export const CURE_BY_STAGE: { readonly [stage in InfectionStage]: StageCure } = {
  none: { amount: 0, partial: 0, certainty: 1 },
  incubating: { amount: 50, partial: 50, certainty: 1 }, // early ⇒ strong & certain
  symptomatic: { amount: 50, partial: 50, certainty: 1 },
  advanced: { amount: 30, partial: 12, certainty: 0.7 }, // uncertain: full on success, a weaker partial otherwise
  terminal: { amount: 18, partial: 4, certainty: 0.4 }, // costliest & least certain
};

/** Clean-conditions quarantine (no meds): strong on early stages, weak on advanced, useless at terminal. */
export const QUARANTINE_BY_STAGE: { readonly [stage in InfectionStage]: number } = {
  none: 0,
  incubating: 30,
  symptomatic: 30,
  advanced: 10,
  terminal: 0, // clean conditions alone can't beat the late body — you need the cure
};

const carries = (state: GameState, type: string): boolean =>
  state.player.inventory.some((e) => e.type === type && e.quantity > 0);

/** Consume one unit of a carried non-unique item (mirrors survival/shelter). */
function consume(state: GameState, type: string): readonly InventoryEntry[] {
  const inv = state.player.inventory;
  const idx = inv.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return inv;
  const entry = inv[idx]!;
  if (entry.quantity <= 1) return inv.filter((_, i) => i !== idx);
  return inv.map((e, i) => (i === idx ? { ...e, quantity: e.quantity - 1 } : e));
}

const atOwnShelter = (state: GameState): boolean =>
  state.player.shelterId !== null && state.player.shelterId === state.player.location;

const isDiagnosed = (state: GameState): boolean => state.player.flags[DIAGNOSED_FLAG] === true;

/** May the player diagnose? Symptoms showing, not yet diagnosed, and holding supplies to read it by. */
export function canDiagnose(state: GameState): boolean {
  return isSymptomatic(state) && !isDiagnosed(state) && DIAGNOSTIC_ITEMS.some((i) => carries(state, i));
}

/** May the player attempt the cure? Symptoms showing and carrying antibiotics. */
export function canCureInfection(state: GameState): boolean {
  return isSymptomatic(state) && carries(state, ANTIBIOTICS_ITEM);
}

/**
 * May the player quarantine? Symptoms showing, standing in their own shelter, AND the stage is one clean
 * conditions can still act on (`QUARANTINE_BY_STAGE > 0`). At terminal that is 0, so the option is *not
 * offered* — it would only burn 8h and let the bite drive on, an unlabeled trap at the tensest moment.
 * The menu simply shrinking is legible (the terminal symptom already says the body is giving out), not a
 * leak. The cure (which can still help) remains offered.
 */
export function canQuarantine(state: GameState): boolean {
  return (
    isSymptomatic(state) &&
    atOwnShelter(state) &&
    QUARANTINE_BY_STAGE[state.player.condition.infection.stage] > 0
  );
}

/** The infection actions offered from the current state, in stable order. Empty unless infected. */
export function infectionChoices(state: GameState): readonly SceneChoice[] {
  const choices: SceneChoice[] = [];
  if (canDiagnose(state)) {
    choices.push({
      id: "diagnose",
      label: "Take stock of the sickness",
      timeCost: DIAGNOSE_COST,
      action: { type: "diagnose", choiceId: "diagnose", timeCost: DIAGNOSE_COST },
    });
  }
  if (canCureInfection(state)) {
    choices.push({
      id: "treat-infection",
      label: "Dose yourself with antibiotics",
      timeCost: CURE_COST,
      action: { type: "treat-infection", choiceId: "treat-infection", timeCost: CURE_COST },
    });
  }
  if (canQuarantine(state)) {
    choices.push({
      id: "quarantine",
      label: "Quarantine yourself in the shelter",
      timeCost: QUARANTINE_COST,
      action: { type: "quarantine", choiceId: "quarantine", timeCost: QUARANTINE_COST },
    });
  }
  return choices;
}

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export function isInfectionAction(action: Action): boolean {
  return action.type === "diagnose" || action.type === "treat-infection" || action.type === "quarantine";
}

/** Replace the player's infection + (optionally) inventory + rng, re-staging from the new progression. Pure. */
function withInfection(state: GameState, progression: number, inventory?: readonly InventoryEntry[], rng?: GameState["rng"]): GameState {
  const p = clampInfection(progression);
  const infection: Infection = { progression: p, stage: stageFor(p) };
  const flags =
    infection.stage === "none" && isDiagnosed(state)
      ? Object.fromEntries(Object.entries(state.player.flags).filter(([k]) => k !== DIAGNOSED_FLAG))
      : state.player.flags;
  return {
    ...state,
    ...(rng ? { rng } : {}),
    player: {
      ...state.player,
      condition: { ...state.player.condition, infection },
      inventory: inventory ?? state.player.inventory,
      flags,
    },
  };
}

/** The felt result of a cure/quarantine: it cleared the fever, eased it, or merely held it back. */
type InfectionOutcome = "cleared" | "eased" | "held";

/** Append an `infection.treated` beat (append-only Living History) so the outcome is legible + remembered. Pure. */
function logOutcome(state: GameState, outcome: InfectionOutcome): GameState {
  const { day, hour, turn } = state.meta;
  const beat: HistoryEvent = { day, hour, turn, type: "infection.treated", subjects: ["player"], data: { outcome } };
  return { ...state, history: [...state.history, beat] };
}

/** Diagnose: learn to read the stage precisely (sets the flag; the Scene then names it). Inert if gate closed. */
function diagnose(state: GameState): GameState {
  if (!canDiagnose(state)) return state;
  return { ...state, player: { ...state.player, flags: { ...state.player.flags, [DIAGNOSED_FLAG]: true } } };
}

/**
 * Attempt the cure with a dose of antibiotics. Early stages are strong & certain (no RNG draw, so an
 * early cure stays byte-identical from seed); advanced/terminal are weaker and *uncertain* — a seeded
 * roll on the `infection` stream decides full vs. partial. Consumes the dose either way. Pure.
 */
function cureInfection(state: GameState): GameState {
  if (!canCureInfection(state)) return state;
  const stage = state.player.condition.infection.stage;
  const spec = CURE_BY_STAGE[stage];
  const inventory = consume(state, ANTIBIOTICS_ITEM);
  const cur = state.player.condition.infection.progression;
  let removed: number;
  let rng: GameState["rng"] | undefined;
  if (spec.certainty >= 1) {
    removed = spec.amount; // early ⇒ certain: no stream advance, byte-identical from seed
  } else {
    const draw = drawFloat(state.rng, state.meta.seed, INFECTION_STREAM); // late ⇒ uncertain, seeded
    removed = draw.value < spec.certainty ? spec.amount : spec.partial;
    rng = draw.rng;
  }
  const next = clampInfection(cur - removed);
  const outcome: InfectionOutcome = next <= 0 ? "cleared" : removed >= spec.amount ? "eased" : "held";
  return logOutcome(withInfection(state, next, inventory, rng), outcome);
}

/**
 * Quarantine at the shelter: rest + clean conditions with no meds. Strong on early stages, weak on
 * advanced; not offered at terminal (clean conditions can't touch the late body — {@link canQuarantine}).
 * Deterministic — reliable but bounded. The fatigue side (isolation *is* rest) is handled by survival.ts +
 * shelter.ts treating `quarantine` like `rest`. Pure.
 */
function quarantine(state: GameState): GameState {
  if (!canQuarantine(state)) return state;
  const next = clampInfection(state.player.condition.infection.progression - QUARANTINE_BY_STAGE[state.player.condition.infection.stage]);
  return logOutcome(withInfection(state, next), next <= 0 ? "cleared" : "eased");
}

/** Resolve an infection action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. */
export function resolveInfectionAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "diagnose":
      return diagnose(state);
    case "treat-infection":
      return cureInfection(state);
    case "quarantine":
      return quarantine(state);
    default:
      return state;
  }
}

// --- narration surfaced in sceneOf ------------------------------------------------------------

const STAGE_LABEL: { readonly [stage in InfectionStage]: string } = {
  none: "clear",
  incubating: "earliest, still-hidden",
  symptomatic: "symptomatic",
  advanced: "advanced",
  terminal: "terminal",
};

/**
 * A one-line read of the infection for the Scene. Before a diagnosis this is the honest *symptom*
 * (never a number, never a stage word the player hasn't earned); after a diagnosis it names the stage
 * precisely — the optional clarity valve the tripwire's mitigation calls for. Null while healthy. Pure.
 */
export function infectionLine(state: GameState): string | null {
  const stage = state.player.condition.infection.stage;
  if (stage === "none") return null;
  if (isDiagnosed(state)) {
    return `You have taken the measure of the sickness in you: it has reached the ${STAGE_LABEL[stage]} stage.`;
  }
  return stageInfo(stage)?.symptom ?? null; // incubating ⇒ null: asymptomatic, nothing to feel yet
}

/**
 * The felt outcome of a cure/quarantine taken THIS turn, or null otherwise. Reads the `infection.treated`
 * beat {@link logOutcome} appended (a bounded backward scan over only this turn's tail of the append-only
 * history), so a scarce dose gives honest, no-number feedback — it cleared, eased, or merely held.
 * Surfaced by sceneOf on the treatment turn. Pure.
 */
export function infectionOutcomeLine(state: GameState): string | null {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i]!;
    if (h.turn !== state.meta.turn) break; // turn-ordered append-only log ⇒ past this turn's tail, stop
    if (h.type !== "infection.treated") continue;
    const outcome = (h.data as { readonly outcome?: string } | null)?.outcome;
    if (outcome === "cleared") return "The fever breaks and loosens its hold — for now, it is out of you.";
    if (outcome === "eased") return "The fever loosens its grip; your head clears a little.";
    if (outcome === "held") return "The dose blunts the fever, but it holds — you will need more.";
    return null;
  }
  return null;
}
