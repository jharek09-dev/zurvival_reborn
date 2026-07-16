/**
 * Survivor encounters — talk, share, threaten, recruit (M3 task T35 · FR-NPC-01 surfacing / FR-NPC-06 VS
 * subset · GDD XII). The verbs that make a survivor a *person you have a relationship with* rather than a
 * stat block drifting in the dark, and the teeth that make T33's needs and T34's trust finally bite.
 *
 * Standing at a living survivor's node (offered in the explore branch — a fight or loitering walkers still
 * take priority; you cannot parley mid-encounter), the player may:
 *   - **Talk** — once, while unmet and willing to parley: flip `met` true (surface flavour client-side and
 *     unlock recruitment). A one-shot, so it is a real state change, never a no-consequence turn.
 *   - **Share food / water** — the help verb: spend one of your items to buy their need down by the same
 *     relief the player gets, and raise trust ({@link applyTrustEvent} "share"). Offered only when you
 *     carry the item and their need is pressing. Companions travel with you and are fed the same way.
 *   - **Threaten** — the harm verb: lower trust ("threaten", −20). Push it below {@link PARLEY_MIN} and the
 *     survivor has *turned* — `canParley` is false, so talk/help/recruit stop being offered; the
 *     betrayal-sticks property (no regen, T34) keeps that door shut.
 *   - **Recruit** — when the T34 gate opens (`canRecruit` — trust ≥ 70) *and* you have spoken with them.
 *     Delegates to {@link recruit} (T36).
 *
 * Death is the needs' teeth and lives with the drift that causes it ({@link driftNpc}, T35): a survivor
 * whose hunger/thirst saturates dies. Pure, deterministic, integer-only, dependency-free: no clock, no RNG.
 */

import type { ActorId, GameState, NodeId, NPCState } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { applyTrustEvent, canParley, canRecruit } from "./trust.js";
import { FOOD_ITEM, WATER_ITEM, EAT_RELIEF, DRINK_RELIEF, RELIEF_OFFER_AT } from "./survival.js";
import { recruit, companionsHere, canRecruitEligible, companionName, COMPANION_SHARE_TRUST } from "./companions.js";

/** Time cost (hours) of each interaction. All > 0 so every interaction is a resolved turn (FR-CORE-03/04). */
export const TALK_COST = 1;
export const GIVE_COST = 1;
export const THREATEN_COST = 1;
export const RECRUIT_COST = 1;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Does the player carry at least one unit of a non-unique item type? */
function carries(state: GameState, type: string): boolean {
  return state.player.inventory.some((e) => e.type === type && e.quantity > 0);
}

/** Consume one unit of a carried non-unique item; returns the new inventory (mirrors survival's eat/drink). */
function consumeItem(state: GameState, type: string): GameState["player"]["inventory"] {
  const inv = state.player.inventory;
  const idx = inv.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return inv;
  const entry = inv[idx]!;
  if (entry.quantity <= 1) return inv.filter((_, i) => i !== idx);
  return inv.map((e, i) => (i === idx ? { ...e, quantity: e.quantity - 1 } : e));
}

/** Living survivors (not yet companions) at a node, in stable id order. */
export function survivorsHere(state: GameState, node: NodeId): readonly NPCState[] {
  return Object.keys(state.npcs)
    .sort()
    .map((id) => state.npcs[id]!)
    .filter((n) => n.alive && n.location === node);
}

/**
 * The people-interaction choices offered from the player's current node — one block per living survivor
 * present (talk while unmet, share food/water when carried & needed, recruit when the gate opens, threaten
 * while they'll still engage), then feed-your-companion options. Empty when no one is here. Stable order.
 */
export function encounterPeople(state: GameState): readonly SceneChoice[] {
  const here = state.player.location;
  const choices: SceneChoice[] = [];

  for (const npc of survivorsHere(state, here)) {
    const id = npc.id;
    const willEngage = canParley(npc);

    if (willEngage && !npc.met) {
      choices.push({
        id: `talk:${id}`,
        label: `Speak with ${npc.name}`,
        timeCost: TALK_COST,
        action: { type: "talk", choiceId: `talk:${id}`, timeCost: TALK_COST, params: { npc: id } },
      });
    }
    if (willEngage && carries(state, FOOD_ITEM) && npc.needs.hunger >= RELIEF_OFFER_AT) {
      choices.push({
        id: `give-food:${id}`,
        label: `Share food with ${npc.name}`,
        timeCost: GIVE_COST,
        action: { type: "give-food", choiceId: `give-food:${id}`, timeCost: GIVE_COST, params: { npc: id } },
      });
    }
    if (willEngage && carries(state, WATER_ITEM) && npc.needs.thirst >= RELIEF_OFFER_AT) {
      choices.push({
        id: `give-water:${id}`,
        label: `Share water with ${npc.name}`,
        timeCost: GIVE_COST,
        action: { type: "give-water", choiceId: `give-water:${id}`, timeCost: GIVE_COST, params: { npc: id } },
      });
    }
    if (npc.met && canRecruit(npc) && canRecruitEligible(state, npc)) {
      choices.push({
        id: `recruit:${id}`,
        label: `Ask ${npc.name} to join you`,
        timeCost: RECRUIT_COST,
        action: { type: "recruit", choiceId: `recruit:${id}`, timeCost: RECRUIT_COST, params: { npc: id } },
      });
    }
    if (willEngage) {
      choices.push({
        id: `threaten:${id}`,
        label: `Threaten ${npc.name}`,
        timeCost: THREATEN_COST,
        action: { type: "threaten", choiceId: `threaten:${id}`, timeCost: THREATEN_COST, params: { npc: id } },
      });
    }
  }

  for (const c of companionsHere(state, here)) {
    if (carries(state, FOOD_ITEM) && c.condition.needs.hunger >= RELIEF_OFFER_AT) {
      choices.push({
        id: `give-food:${c.id}`,
        label: `Share food with ${companionName(c)}`,
        timeCost: GIVE_COST,
        action: { type: "give-food", choiceId: `give-food:${c.id}`, timeCost: GIVE_COST, params: { companion: c.id } },
      });
    }
    if (carries(state, WATER_ITEM) && c.condition.needs.thirst >= RELIEF_OFFER_AT) {
      choices.push({
        id: `give-water:${c.id}`,
        label: `Share water with ${companionName(c)}`,
        timeCost: GIVE_COST,
        action: { type: "give-water", choiceId: `give-water:${c.id}`, timeCost: GIVE_COST, params: { companion: c.id } },
      });
    }
  }

  return choices;
}

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isEncounterAction(action: Action): boolean {
  return (
    action.type === "talk" ||
    action.type === "give-food" ||
    action.type === "give-water" ||
    action.type === "threaten" ||
    action.type === "recruit"
  );
}

/** Talk to a survivor: flip `met` true (their flavour surfaces client-side; recruitment unlocks). */
function talkTo(state: GameState, id: ActorId): GameState {
  const npc = state.npcs[id];
  if (npc === undefined || !npc.alive || npc.met) return state;
  return { ...state, npcs: { ...state.npcs, [id]: { ...npc, met: true } } };
}

/** Share a food/water item — buy a survivor's or a companion's need down, spend the item, (survivor) earn trust. */
function give(
  state: GameState,
  npcId: ActorId | null,
  compId: ActorId | null,
  item: string,
  need: "hunger" | "thirst",
  relief: number,
): GameState {
  if (!carries(state, item)) return state;
  const inventory = consumeItem(state, item);
  const player = { ...state.player, inventory };

  if (npcId !== null) {
    const npc = state.npcs[npcId];
    if (npc === undefined || !npc.alive) return state;
    const needs = { ...npc.needs, [need]: clampPct(npc.needs[need] - relief) };
    const fed = applyTrustEvent({ ...npc, needs }, "share");
    return { ...state, player, npcs: { ...state.npcs, [npcId]: fed } };
  }
  if (compId !== null) {
    const c = state.actors[compId];
    if (c === undefined) return state;
    const needs = { ...c.condition.needs, [need]: clampPct(c.condition.needs[need] - relief) };
    // Feeding a companion earns trust (T45): care is how you unlock the harder standing orders. Clamped 0–100.
    const trust = Math.max(0, Math.min(100, (c.trust ?? 0) + COMPANION_SHARE_TRUST));
    return { ...state, player, actors: { ...state.actors, [compId]: { ...c, trust, condition: { ...c.condition, needs } } } };
  }
  return state;
}

/** Threaten a survivor: lower trust; below PARLEY_MIN they turn (canParley false), the betrayal sticking. */
function threaten(state: GameState, id: ActorId): GameState {
  const npc = state.npcs[id];
  if (npc === undefined || !npc.alive) return state;
  return { ...state, npcs: { ...state.npcs, [id]: applyTrustEvent(npc, "threaten") } };
}

/**
 * Resolve a survivor-interaction action (pipeline stage 3, dispatched from `applyPlayerAction`). An action
 * of an unrelated type is returned unchanged for the caller to handle. Pure, deterministic.
 */
export function resolveEncounterAction(state: GameState, action: Action): GameState {
  const npcId = typeof action.params?.["npc"] === "string" ? (action.params["npc"] as ActorId) : null;
  const compId = typeof action.params?.["companion"] === "string" ? (action.params["companion"] as ActorId) : null;
  switch (action.type) {
    case "talk":
      return npcId === null ? state : talkTo(state, npcId);
    case "give-food":
      return give(state, npcId, compId, FOOD_ITEM, "hunger", EAT_RELIEF);
    case "give-water":
      return give(state, npcId, compId, WATER_ITEM, "thirst", DRINK_RELIEF);
    case "threaten":
      return npcId === null ? state : threaten(state, npcId);
    case "recruit":
      return npcId === null ? state : recruit(state, npcId);
    default:
      return state;
  }
}
