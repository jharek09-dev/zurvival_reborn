/**
 * The horde collision — what happens when the mass is standing where you are (M4 task T76 ·
 * design review 2026-09-12 step 3 · FR-CBT-01/05/08 · GDD IX).
 *
 * `sim/hordes.ts` owns the world half of T76 (how a mass moves and what it does to the ground it
 * walks over). This module owns the player-facing half, and it is deliberately **not a fight**:
 *
 *   - **No fight choice exists.** FR-CBT-08 says a horde is "routed, funneled or fled, not
 *     out-traded", and through T75 the requirement passed only because the horde had no teeth at all.
 *     Here it passes because the only verbs are {@link OVERRUN_FLEE} and {@link OVERRUN_HOLD}: run for
 *     a neighbouring node, or go to ground where you stand. Strike, Fire and the walker prompt are all
 *     suppressed while a mass is on you — you cannot trade blows with twenty-four bodies, and the
 *     engine no longer pretends you can.
 *   - **You always get out, and it always costs.** The stealth contract (FR-CBT-05) holds: neither
 *     verb can fail to resolve, and the flight always relocates. What the roll decides is how much of
 *     the mass gets a hand on you on the way past — a detection roll floored at
 *     {@link OVERRUN_ESCAPE_FLOOR}, far above the ordinary stealth roll, and on a hit **one wound per
 *     {@link OVERRUN_WOUND_PER} bodies** rather than the single parting blow a walker lands. T77 made
 *     that roll the same whole-situation read a slip uses (the floor still binds under it) and made
 *     the flight pay the road conditions a walk pays — and it is the reason `escapeTargets` refuses a
 *     blocked road only while another is passable, because an unconditional refusal would break this
 *     bullet outright.
 *   - **The teeth are the wound table, not a health bar.** There is no player hp in this codebase
 *     (PL-M5-01), so a horde kills the way everything else in the game kills: `wound.bite` at severity
 *     40 drives the T22 infection track, and a two- or three-wound draw is what makes a bite likely
 *     over a run rather than over a turn ({@link OVERRUN_WOUNDS} explains the odds and why they are
 *     not the walker table's). Being overrun is the commonest way a run starts its infection race,
 *     which is what finally gives `FIRE_NOISE 75` — a bang that re-paths every mass within two
 *     hops — a real bill.
 *
 * ## Why the overrun is derived, not stored
 *
 * There is no overrun flag anywhere in `GameState`. {@link isOverrun} is a function of the horde
 * positions the world sim already writes, so there is nothing to desynchronise, **no save-schema rung
 * (v10 holds)**, and no way for a stale flag to strand a player in a fight the horde has left. The
 * cost of that choice is that the pre-emption has to be honoured at every point that offers or
 * validates a choice; `actions/coreActions.ts` does it in exactly one place (`availableActions`, above
 * the combat branch), which `assertLegal` and `sceneOf` both route through.
 *
 * Two consequences of the pre-emption, both intended:
 *
 *   1. **A fight in progress is suspended, and ended by whichever verb the player takes.** A mass
 *      walking into your duel does not politely queue behind it. `state.combat` survives until the
 *      player answers the overrun, and both answers clear it.
 *   2. **An engaged multi-stage encounter is abandoned, not completed.** Its one-shot done-flag is
 *      never stamped, so the beat remains eligible to fire again later — the negotiation was
 *      interrupted, not resolved.
 *
 * A third, at the other end of the pipeline: `sim/events.ts` refuses to *open* an encounter at a node
 * a mass is standing on, so the overrun can never strand a beat it pre-empted on the very turn it
 * began.
 *
 * ## The two halves of T75's exclusion, treated differently on purpose
 *
 * T75's repopulation hard-excludes two nodes — the player's own, and their claimed shelter — on the
 * rule "clearing where you stand keeps it clear". T76 breaks one and keeps the other, and the split is
 * deliberate:
 *
 *   - **The player's node: broken, and that is the task.** A horde walking onto you sheds a body onto
 *     that node like any other, so from T76 the "clearing where you stand keeps it clear" promise
 *     holds for *off-screen repopulation only*. The mass arriving where you are, and some of it
 *     staying, is the consequence the horde layer never had.
 *   - **The claimed shelter: kept, and kept harder than T75 kept it.** A mass neither garrisons the
 *     base (`tickHordes` skips it in the body trade) nor overruns the player inside it
 *     ({@link isOverrun} returns false there). Besieging the base is T83's night-attack brief, which
 *     T75 explicitly refused to pre-empt ("not this pass's to sneak in"), and an unauthored version of
 *     it arriving as a side effect of a movement pass would be worse than not having it at all. The
 *     cost — until T83 the base is a hard sanctuary from this system — is declared as PL-M5-18 rather
 *     than left to be discovered.
 *
 * Pure, deterministic, integer-only (ADR-0001). Draws from the existing `stealth` and `combat`
 * streams, in the same order `resolveEscape` uses, so the overrun introduces no new RNG stream.
 */

import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { GameState, NodeId } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { drawFloat, drawPick } from "../rng/streams.js";
import { inflictNamedWound } from "./wounds.js";
import { detectChance, escapeExtraCost, escapeTargets, relocatePlayer } from "../combat/combat.js";
import { stealthDetectChance } from "./detection.js";
import { hordeMassAt, overrunsPlayer, HORDE_MIN_SIZE } from "./hordes.js";
import { ACTIVE_ENCOUNTER_QUEST } from "./events.js";
import { isRunOver } from "./survival.js";

// --- tuning -----------------------------------------------------------------------------------

/** Action ids/types the overrun owns. */
export const OVERRUN_FLEE = "flee";
export const OVERRUN_HOLD = "hold";

/**
 * Hours each verb spends. Flight matches `RETREAT_COST`; going to ground is the cheap, worse option.
 *
 * T76 wrote "flight matches `SLIP_COST`", which was true while both were 2 and is a misreading of what
 * the verb is. T77 raised `SLIP_COST` to `MOVE_COST + 1` because a *slip* is careful work — threading
 * past them. Running out from under a mass is not careful and was never meant to read as careful; it
 * is a retreat and it stays at `RETREAT_COST`. The *constant* is 2 before and after — but the flight
 * is not, because `overrunChoices` now adds {@link escapeExtraCost}, so running over a road the
 * weather has chewed up costs 3–4 hours where T76 charged a flat 2. That is a deliberate pacing change
 * on exactly the routes this task made expensive, and it is the same bill a slip, a retreat and a walk
 * all pay over the same edge.
 */
export const OVERRUN_FLEE_COST = 2;
export const OVERRUN_HOLD_COST = 1;

/** Noise each deposits: running through them is a slip's worth of sound, going to ground is silent. */
export const OVERRUN_FLEE_NOISE = 5;
export const OVERRUN_HOLD_NOISE = 0;

/**
 * The floor under the escape roll. `detectChance` tops out at 0.9 and bottoms out at 0.0 (night in
 * fog), which is the right shape for slipping past a handful of loitering dead and the wrong one for
 * walking out of a mass that is already on top of you: the floor is what makes the collision cost
 * something even in the dark. Noise and daylight still push it above the floor.
 */
export const OVERRUN_ESCAPE_FLOOR = 0.6;

/** One wound per this many bodies above the size floor: a mass of 8 lands 1, 24 lands 2, 40 lands 3. */
export const OVERRUN_WOUND_PER = 16;
export const OVERRUN_MAX_WOUNDS = 3;

/** Where the blows land, cycled so a multi-wound draw does not stack three wounds on one arm. */
const OVERRUN_SITES: readonly string[] = ["arm", "back", "leg"];

/**
 * The wounds a mass lands. `drawPick` is uniform over the array, so a row repeated twice carries twice
 * the weight — the table is the weighting. **A bite is one row in five**, where a single walker's retaliation bites one
 * time in two, and the difference is deliberate and measured:
 *
 * A mass pressing past you mostly claws, crushes and turns an ankle; teeth are what happens when one
 * of them actually gets hold. Mechanically, a bite starts the T22 infection clock, which is terminal
 * without antibiotics — so at the walker table's 1-in-2, a two-wound overrun infects the player ~75%
 * of the time and the horde stops being pressure and becomes an execution. At 1-in-5 a two-wound
 * overrun infects ~36% of the time: being caught by a mass is *the* way most runs start their
 * infection race, but surviving one intact is normal.
 *
 * This is the one place T76 does NOT reuse `WALKER_WOUNDS`, and the reason is a number, not a taste.
 */
export const OVERRUN_WOUNDS: readonly { readonly type: string; readonly severity: number }[] = [
  { type: "wound.laceration", severity: 25 },
  { type: "wound.laceration", severity: 25 },
  { type: "wound.sprain", severity: 20 },
  { type: "wound.sprain", severity: 20 },
  { type: "wound.bite", severity: 40 },
];

// --- reading the situation ---------------------------------------------------------------------

/**
 * Whether a mass is standing on the player right now. False once the run has ended (the ending screen
 * offers nothing) and false while the layer is switched off, so `hordes.disabled` really does disable
 * the whole system rather than only its movement.
 */
export function isOverrun(state: GameState): boolean {
  // `overrunsPlayer` (sim/hordes.ts) is the shared definition — layer enabled, not in your own claimed
  // shelter, a mass here — so `sim/events.ts` and `sim/history.ts` branch on exactly the same rule
  // without importing this module. The shelter clause is there because T75 hard-excluded the base from
  // repopulation and `repopulate.ts` is explicit that its night attacks are T83's to author, "not this
  // pass's to sneak in": a mass that could pin you inside your own base, suppress every shelter verb
  // and maul you there is precisely the assault T83 owns, arriving early and unauthored. A horde may
  // walk over the base; it does not besiege it, and `tickHordes` leaves no bodies there either. The
  // cost — until T83 the base is a hard sanctuary from this system — is declared as PL-M5-18.
  return !isRunOver(state) && overrunsPlayer(state);
}

/** The headcount on the player's node — what the wound draw scales on. */
export function overrunMass(state: GameState): number {
  return hordeMassAt(state, state.player.location);
}

/** How many wounds a mass of `mass` bodies lands when it gets a hand on you. At least 1, at most 3. */
export function overrunWounds(mass: number): number {
  const m = Number.isFinite(mass) ? Math.max(0, Math.trunc(mass)) : 0;
  const extra = Math.trunc(Math.max(0, m - HORDE_MIN_SIZE) / OVERRUN_WOUND_PER);
  return Math.max(1, Math.min(OVERRUN_MAX_WOUNDS, 1 + extra));
}

/**
 * The chance the mass lands blows as you go — the ordinary stealth read, floored.
 *
 * Since T77 "the ordinary stealth read" means the whole read, not just the world's third of it: the
 * same `stealthDetectChance` a slip or a retreat rolls against, so a bleeding player under a laden
 * pack is caught by a mass for the same reasons they are caught by two loitering walkers. The floor
 * still does the work it was put there to do — it is what stops a foggy night from making a mass
 * free to walk out of — it simply binds less often now.
 *
 * One declared limit, unchanged from T76 and worth restating because the arousal term makes it
 * visible: the `zombieState` this reads is the **node's own loiterers**, not the mass standing on it.
 * A horde that has walked onto an empty node leaves it `dormant`, so the arousal term contributes
 * nothing and the floor carries the whole roll. That is the right outcome by accident rather than by
 * design, and it is recorded as such (PL-M5-23) — hordes have no arousal state of their own.
 */
export function overrunEscapeChance(state: GameState): number {
  const here = state.nodes[state.player.location];
  const base = detectChance(here?.noise ?? 0, state.meta.phase, state.world.weather);
  return Math.max(OVERRUN_ESCAPE_FLOOR, stealthDetectChance(state, base));
}

// --- choices ------------------------------------------------------------------------------------

/**
 * The only choices a player has while a mass is on them: run for each discovered neighbour
 * {@link escapeTargets} offers, then go to ground where they stand.
 *
 * **The hold is never omitted**, and that is a hard requirement rather than flavour: a node whose
 * neighbours are all still fogged would otherwise return an empty choice list, which is a hard
 * softlock (the PL-M5-14 class of bug T75 found in `availableActions` and did not create). Going to
 * ground costs an hour, takes the same roll, and leaves you exactly where you were, so it is usually
 * the worse option when there is anywhere to run — not strictly, though: it is an hour cheaper and
 * five points quieter, and it keeps you standing on your own stash. It is always available when there
 * is nowhere to run, which is the point.
 */
export function overrunChoices(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const choices: SceneChoice[] = [];
  for (const to of escapeTargets(state, graph)) {
    const name = graph.nodes[to]?.name ?? to;
    // A worn road costs the run what it costs the walk (T77) — the same `extraCostOf` `move` charges.
    const cost = OVERRUN_FLEE_COST + escapeExtraCost(state, to);
    choices.push({
      id: `${OVERRUN_FLEE}:${to}`,
      label: `Run for ${name}`,
      timeCost: cost,
      action: { type: OVERRUN_FLEE, choiceId: `${OVERRUN_FLEE}:${to}`, timeCost: cost, params: { to, noise: OVERRUN_FLEE_NOISE } },
    });
  }
  choices.push({
    id: OVERRUN_HOLD,
    label: "Go to ground where you stand",
    timeCost: OVERRUN_HOLD_COST,
    action: { type: OVERRUN_HOLD, choiceId: OVERRUN_HOLD, timeCost: OVERRUN_HOLD_COST, params: { noise: OVERRUN_HOLD_NOISE } },
  });
  return choices;
}

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isOverrunAction(action: Action): boolean {
  return action.type === OVERRUN_FLEE || action.type === OVERRUN_HOLD;
}

// --- resolution -----------------------------------------------------------------------------------

/**
 * Drop an engaged multi-stage encounter without stamping its one-shot done-flag — the beat was
 * interrupted, so it stays eligible. Kept here rather than exported from `events.ts` so that module's
 * `endEngaged` remains the only path that can *complete* an encounter.
 */
function abandonEncounter(state: GameState): GameState {
  const quests = state.player.quests.filter((q) => q.id !== ACTIVE_ENCOUNTER_QUEST);
  if (quests.length === state.player.quests.length) return state;
  return { ...state, player: { ...state.player, quests } };
}

/**
 * Resolve a flight or a hold. One `stealth` draw decides whether the mass lands blows; on a hit, one
 * `combat` draw per wound picks it from {@link OVERRUN_WOUNDS} — NOT the walker retaliation table,
 * for the reason that constant documents. Both verbs end any suspended fight and abandon any engaged
 * encounter (see the header). A flight then relocates; a hold leaves the player where they are, still
 * overrun next turn.
 *
 * Draw order matches `resolveEscape` — stealth first, then combat — so the two paths read the same
 * streams in the same order and neither can shift the other's sequence.
 */
export function resolveOverrunAction(state: GameState, graph: RegionGraph, action: Action): GameState {
  if (!isOverrunAction(action)) return state;
  // Refuse when there is no mass on the player. Pipeline stage 1 only validates an action that
  // carries a `choiceId` (`pipeline/applyAction.ts`), so a bare `{ type: "hold" }` reaches this
  // dispatcher on ANY state — and without this guard it would burn a `stealth` draw, clear
  // `state.combat`, abandon an engaged encounter and land up to three wounds with no horde anywhere on
  // the map. `resolveStrike`/`resolveFire` are inert in the same situation because they need
  // `state.combat`; this verb has no such natural precondition, so it needs an explicit one.
  if (!isOverrun(state)) return state;
  const mass = overrunMass(state);
  const chance = overrunEscapeChance(state);
  const roll = drawFloat(state.rng, state.meta.seed, "stealth");

  let next: GameState = { ...state, rng: roll.rng, combat: null };
  next = abandonEncounter(next);

  if (roll.value < chance) {
    let condition = next.player.condition;
    let rng = next.rng;
    const count = overrunWounds(mass);
    for (let i = 0; i < count; i += 1) {
      const pick = drawPick(rng, next.meta.seed, "combat", OVERRUN_WOUNDS);
      rng = pick.rng;
      condition = inflictNamedWound(condition, pick.value.type, pick.value.severity, OVERRUN_SITES[i % OVERRUN_SITES.length]!, next.meta.day);
    }
    next = { ...next, rng, player: { ...next.player, condition } };
  }

  if (action.type === OVERRUN_HOLD) return next;
  const to = typeof action.params?.["to"] === "string" ? (action.params["to"] as NodeId) : null;
  if (to === null || next.nodes[to] === undefined) return next; // a malformed flight still spent its roll
  return relocatePlayer(next, graph, to);
}

// --- narration ------------------------------------------------------------------------------------

/**
 * The lead line while a mass is on you, or null. Leads the whole scene (ahead of the fight read and
 * the world lead) because it is the only thing on the board that matters, and it names the two things
 * the player needs — that there is no fighting this, and that going to ground is available. Sized in
 * words, never numbers, so the read never depends on a hud (FR-AUD-06 / FR-UI).
 */
export function overrunNarration(state: GameState): string | null {
  if (!isOverrun(state)) return null;
  const mass = overrunMass(state);
  const size = mass >= 32 ? "a tide of them" : mass >= 20 ? "a crowd of them" : "a knot of them";
  return `They are on you — ${size}, close enough to smell, pressing in from every side. There is no fighting this: run, or go to ground and let it pass over you.`;
}
