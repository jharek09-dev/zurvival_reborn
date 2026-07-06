/**
 * Recruitable companions & permanent, remembered death (M3 task T36 · FR-NPC-03/04, VS subset · GDD XII).
 *
 * The people substrate (T33) and the trust gate (T34) shipped a `canRecruit` predicate with no caller
 * and a reserved `GameState.actors` collection that was always empty. T36 wires them together: a survivor
 * you have earned the trust of (and, per T35, *spoken* with) can be asked to **join you**, graduating from
 * the lightweight {@link NPCState} (a survivor you have *met*) into the heavier {@link Survivor} record
 * (a survivor who has *joined*) — the two life-stages the M3 Part 1 plan named as this task's concern.
 *
 * Three behaviours ship, all deterministic (ADR-0001), none touching RNG:
 *   - **Recruit** ({@link recruit}) promotes an `npcs` entry into an `actors` companion at the player's
 *     node, marked with {@link COMPANION_FLAG}, and removes the `npcs` entry.
 *   - **Autonomous upkeep** ({@link tickCompanions}, pipeline stage 5 after `tickNpcs`) drifts each living
 *     companion's needs on the player's survival economy and keeps them at the player's side — they follow.
 *   - **Permanent, remembered death** — a companion whose needs saturate dies: removed from `actors`
 *     forever (no revival path), remembered by a `fallen.<id>` flag on the player, and logged
 *     `companion.died` in the append-only Living History. {@link killCompanion} exposes the same
 *     transition for a future combat/scripted loss (FR-NPC-04).
 *
 * Deferred to MVP (see M3_PART2_PLAN): followable orders and combat participation (FR-NPC-03 full),
 * per-relationship memory / desertion / inter-NPC bonds (FR-NPC-02 full, 05, 07). The reserved `groups`
 * placeholder stays untouched. Pure, integer-only, dependency-free: no clock, no RNG.
 */

import type { ActorId, GameState, NodeId, NPCState, Survivor } from "../state/types.js";
import { driftNeeds, NEED_FATAL } from "./survival.js";

/** Flag marking a `Survivor` as a party companion that follows the player (vs a reserved faction member). */
export const COMPANION_FLAG = "companion" as const;

/** Whether a tracked `Survivor` is a recruited party companion. */
export function isCompanion(actor: Survivor): boolean {
  return actor.flags[COMPANION_FLAG] === true;
}

/** The party companions' actor ids (recruited `Survivor`s), in stable id order. */
export function companionIds(state: GameState): readonly ActorId[] {
  return Object.keys(state.actors)
    .filter((id) => isCompanion(state.actors[id]!))
    .sort();
}

/** Living companions at a node, in stable id order — the T35 share verbs feed these too. */
export function companionsHere(state: GameState, node: NodeId): readonly Survivor[] {
  return companionIds(state)
    .map((id) => state.actors[id]!)
    .filter((c) => c.location === node);
}

/**
 * Graduate a survivor from `npcs` (met) into `actors` (joined) — the T36 recruitment. The lightweight
 * `NPCState`'s needs carry over into a fresh `CharacterState` (no wounds/infection, a modest starting
 * mind); the companion is placed at the player's node and flagged {@link COMPANION_FLAG}; the `npcs`
 * entry is removed. The name is denormalised in content (recoverable from `type`), so the record stays
 * the reserved shape unchanged. Inert if the id is not a living survivor — the offer/validation gate
 * (`canRecruit && met`) already guards it. Pure, deterministic, no RNG.
 */
export function recruit(state: GameState, npcId: ActorId): GameState {
  const npc = state.npcs[npcId];
  if (npc === undefined || !npc.alive) return state;
  const companion: Survivor = {
    id: npc.id,
    type: npc.type,
    condition: {
      needs: npc.needs,
      wounds: [],
      infection: { stage: "none", progression: 0 },
      mind: { stress: 0, morale: 60 },
    },
    location: state.player.location,
    groupId: null,
    relationships: {},
    inventory: [],
    flags: { [COMPANION_FLAG]: true },
  };
  const npcs: Record<ActorId, NPCState> = { ...state.npcs };
  delete npcs[npcId];
  return { ...state, npcs, actors: { ...state.actors, [npcId]: companion } };
}

/**
 * Advance the party for a resolved turn (pipeline stage 5, after {@link tickNpcs}). For each living
 * companion: drift needs by the hours spent, keep them at the player's side (they follow — location
 * tracks `player.location`, already resolved in stage 3), and apply death when hunger or thirst reaches
 * the fatal ceiling. A dead companion is removed from `actors` (permanent) and remembered by a
 * `fallen.<id>` flag on the player; the Living History logs it by diffing `actors`. Inert on a zero-hour
 * tick or an empty party (empty-turn contract). Pure — no RNG, no clock.
 */
export function tickCompanions(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const ids = companionIds(state);
  if (ids.length === 0) return state;

  const here = state.player.location;
  let actors: Record<ActorId, Survivor> = state.actors as Record<ActorId, Survivor>;
  let flags = state.player.flags;
  let changed = false;
  let mourned = false;

  for (const id of ids) {
    const c = actors[id]!;
    const needs = driftNeeds(c.condition.needs, false, h);
    if (needs.hunger >= NEED_FATAL || needs.thirst >= NEED_FATAL) {
      const next: Record<ActorId, Survivor> = { ...actors };
      delete next[id];
      actors = next;
      flags = { ...flags, [`fallen.${id}`]: true };
      changed = true;
      mourned = true;
      continue;
    }
    if (needs !== c.condition.needs || c.location !== here) {
      actors = { ...actors, [id]: { ...c, location: here, condition: { ...c.condition, needs } } };
      changed = true;
    }
  }

  if (!changed) return state;
  const player = mourned ? { ...state.player, flags } : state.player;
  return { ...state, actors, player };
}

/**
 * Permanently remove a companion (a combat death or scripted loss) — the FR-NPC-04 transition exposed for
 * later callers. Removed from `actors` for good and remembered by a `fallen.<id>` flag on the player; the
 * Living History records `companion.died` by diffing `actors`. Inert if the id is not a companion. Pure.
 */
export function killCompanion(state: GameState, id: ActorId): GameState {
  const actor = state.actors[id];
  if (actor === undefined || !isCompanion(actor)) return state;
  const actors: Record<ActorId, Survivor> = { ...state.actors };
  delete actors[id];
  return {
    ...state,
    actors,
    player: { ...state.player, flags: { ...state.player.flags, [`fallen.${id}`]: true } },
  };
}
