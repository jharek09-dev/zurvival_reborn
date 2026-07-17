/**
 * Shelter — claim a base, fortify it, keep it up (M3 tasks T37–T38 · FR-SHL-01/02 · GDD XIII).
 *
 * The first place on the map that is *yours*. Until now every node was somewhere to pass through;
 * this module lets the player plant a flag — claim a node as a base (T37) — and then makes that base a
 * live maintenance decision — spend loot + time to fortify it, and keep spending or watch it decay (T38).
 *
 * No new state shape: the two facts a shelter needs were reserved in the T3 schema and inert until now —
 * `Player.shelterId` (the claimed node, or null) and `NodeState.barricades` (0–100 fortification). So this
 * block ships with **no save-schema rung** (SAVE_SCHEMA_VERSION stays 6), and because both are untouched in
 * every prior run (`shelterId === null`, all `barricades === 0`), every function here is **inert on old
 * state** — all M2/M3P1/M3P2 golden runs stay byte-identical.
 *
 * The three fortification payoffs (noise muffle, detection floor, deeper rest) each scale from zero at a
 * bare claim to a tuned maximum at full fortification via {@link scaleByFort} — integer-only, no floats.
 *
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). No clock, no RNG.
 */

import type { GameState, NodeId } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { clampNoise } from "./noise.js";
import { cacheRead } from "./stash.js";

/** The material spent to fortify — already produced by the T17 loot tables (generic/residential/industrial). */
export const SCRAP_ITEM = "item.scrap";

/** Time cost (hours) of the two shelter verbs. Both > 0 so every one is a resolved turn (FR-CORE-03/04). */
export const CLAIM_COST = 4;
export const FORTIFY_COST = 3;

/** Scrap spent per fortify, barricades added per fortify, and the cap (matches the NodeState 0–100 field). */
export const FORTIFY_SCRAP = 1;
export const FORTIFY_GAIN = 25;
export const MAX_FORTIFICATION = 100;
/** Fortification lost per in-game hour — the upkeep pressure (≈4 game-days of neglect erodes a full base). */
export const FORTIFY_DECAY_PER_HOUR = 1;

/** Extra fatigue a rest recovers at your claimed base (T37), and the additional amount at full fortification. */
export const SHELTER_REST_BONUS = 15;
export const SHELTER_REST_FORT_MAX = 15;
/** Peak per-turn noise the shelter node absorbs, and peak stimulus discount at the base, at full fortification. */
export const SHELTER_NOISE_MUFFLE_MAX = 20;
export const SHELTER_DETECT_FLOOR_MAX = 40;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * Scale a tuned maximum by a node's fortification level (0..100), integer-only: `trunc(max * b / 100)`.
 * Zero at a bare claim (b = 0), the full maximum at b = 100. The single knob every payoff turns on.
 */
export function scaleByFort(max: number, barricades: number): number {
  const b = Math.max(0, Math.min(MAX_FORTIFICATION, Math.trunc(barricades)));
  return Math.trunc((max * b) / MAX_FORTIFICATION);
}

/** Does the player carry at least one unit of a non-unique item type? (mirrors survival/encounters.) */
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

// --- gates ------------------------------------------------------------------------------------

/**
 * May the player claim the node they stand on? Only while they have **no shelter yet** (one active
 * shelter per run · FR-SHL-01) and have **searched this node clean** (`searchPct >= 100`) — you secure a
 * building before you make it home. The search gate also keeps claim inert on any run that never fully
 * searches a node, so prior golden scenes are untouched.
 */
export function canClaimShelter(state: GameState): boolean {
  const node = state.nodes[state.player.location];
  return state.player.shelterId === null && node !== undefined && node.searchPct >= MAX_FORTIFICATION;
}

/**
 * May the player fortify? Only while **standing in their own shelter**, **carrying scrap**, and the base is
 * **below full**. Mirrors the eat/drink offer — surfaced only when the resource is carried and it can act.
 */
export function canFortifyShelter(state: GameState): boolean {
  const sid = state.player.shelterId;
  if (sid === null || sid !== state.player.location) return false;
  const node = state.nodes[sid];
  return node !== undefined && node.barricades < MAX_FORTIFICATION && carries(state, SCRAP_ITEM);
}

/** The shelter choices offered from the player's current node, in stable order. Empty when neither applies. */
export function shelterChoices(state: GameState): readonly SceneChoice[] {
  const choices: SceneChoice[] = [];
  if (canClaimShelter(state)) {
    choices.push({
      id: "claim-shelter",
      label: "Make this place your shelter",
      timeCost: CLAIM_COST,
      action: { type: "claim-shelter", choiceId: "claim-shelter", timeCost: CLAIM_COST },
    });
  }
  if (canFortifyShelter(state)) {
    choices.push({
      id: "fortify",
      label: "Fortify your shelter",
      timeCost: FORTIFY_COST,
      action: { type: "fortify", choiceId: "fortify", timeCost: FORTIFY_COST },
    });
  }
  return choices;
}

// --- dispatch (pipeline stage 3, from applyPlayerAction) --------------------------------------

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isShelterAction(action: Action): boolean {
  return action.type === "claim-shelter" || action.type === "fortify";
}

/** Claim the node the player stands on as their base (T37). Sets `shelterId`; inert if the gate is closed. */
function claimShelter(state: GameState): GameState {
  if (!canClaimShelter(state)) return state;
  const here: NodeId = state.player.location;
  return { ...state, player: { ...state.player, shelterId: here } };
}

/** Fortify the base (T38): spend one scrap, raise `barricades` by {@link FORTIFY_GAIN} (capped). Inert if gate closed. */
function fortifyShelter(state: GameState): GameState {
  if (!canFortifyShelter(state)) return state;
  const sid = state.player.shelterId!;
  const node = state.nodes[sid]!;
  const barricades = clampPct(node.barricades + FORTIFY_GAIN);
  const inventory = consumeItem(state, SCRAP_ITEM);
  return {
    ...state,
    player: { ...state.player, inventory },
    nodes: { ...state.nodes, [sid]: { ...node, barricades } },
  };
}

/** Resolve a shelter action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. Pure. */
export function resolveShelterAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "claim-shelter":
      return claimShelter(state);
    case "fortify":
      return fortifyShelter(state);
    default:
      return state;
  }
}

// --- payoffs ----------------------------------------------------------------------------------

/**
 * Deeper rest at the base (T37, scaled by T38 fortification): when the player rests **at their claimed
 * shelter**, recover extra fatigue beyond the standard `REST_RECOVERY`. Applied in the stage-4 needs pass
 * (via `tickNeeds`) so survival.ts stays shelter-agnostic. Inert unless the action is a `rest` with hours
 * and the player is standing in their own shelter — so no prior run is touched. Pure.
 */
export function applyShelterRest(state: GameState, action: Action): GameState {
  // A `quarantine` (T49) is a rest taken in isolation at your own shelter, so it earns the same base +
  // fortification recovery a `rest` here does — otherwise quarantining would leave you stranger than
  // simply resting at the same base. `updateCondition` already treats it as a rest for the base recovery.
  if (action.type !== "rest" && action.type !== "quarantine") return state;
  const hours = Math.max(0, Math.trunc(action.timeCost ?? 0));
  if (hours === 0) return state;
  const sid = state.player.shelterId;
  if (sid === null || sid !== state.player.location) return state;
  const node = state.nodes[sid];
  if (node === undefined) return state;
  const extra = SHELTER_REST_BONUS + scaleByFort(SHELTER_REST_FORT_MAX, node.barricades);
  const cur = state.player.condition.needs.fatigue;
  const fatigue = clampPct(cur - extra);
  if (fatigue === cur) return state;
  const needs = { ...state.player.condition.needs, fatigue };
  return { ...state, player: { ...state.player, condition: { ...state.player.condition, needs } } };
}

/**
 * Upkeep decay (T38): erode the shelter's `barricades` by {@link FORTIFY_DECAY_PER_HOUR} per hour. Runs in
 * pipeline stage 6 (`updateNode`) beside the noise decay. Only ever touches a node with `barricades > 0`
 * (in practice only the shelter), so every prior run — all barricades 0 — is untouched. Inert at 0 hours. Pure.
 */
export function decayShelterFortification(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const sid = state.player.shelterId;
  if (sid === null) return state;
  const node = state.nodes[sid];
  if (node === undefined || node.barricades <= 0) return state;
  const barricades = Math.max(0, node.barricades - FORTIFY_DECAY_PER_HOUR * h);
  if (barricades === node.barricades) return state;
  return { ...state, nodes: { ...state.nodes, [sid]: { ...node, barricades } } };
}

/**
 * Noise muffling (T38): the fortified base absorbs the sound made at home — reduce the shelter node's
 * `noise` by `scaleByFort(SHELTER_NOISE_MUFFLE_MAX, barricades)` each stage-6 tick, after the noise deposit.
 * Because hordes re-path to the loudest audible node (T26 reads `NodeState.noise`), a quieter base also
 * **resists horde drift** — one mechanism, both effects. Inert without a fortified shelter carrying noise. Pure.
 */
export function muffleShelterNoise(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const sid = state.player.shelterId;
  if (sid === null) return state;
  const node = state.nodes[sid];
  if (node === undefined || node.noise <= 0 || node.barricades <= 0) return state;
  const reduce = scaleByFort(SHELTER_NOISE_MUFFLE_MAX, node.barricades);
  if (reduce <= 0) return state;
  const noise = clampNoise(node.noise - reduce);
  if (noise === node.noise) return state;
  return { ...state, nodes: { ...state.nodes, [sid]: { ...node, noise } } };
}

// --- narration (surfaced in sceneOf) ----------------------------------------------------------

/**
 * A one-line read of the player's relationship to a shelter at their current node: the base's soundness
 * when they stand in it (with a scrap hint when they can reinforce), or an invitation to claim a
 * searched-clean node when they have none. Null otherwise. Screen-reader-safe — all words.
 */
export function shelterLine(state: GameState): string | null {
  const here = state.player.location;
  const sid = state.player.shelterId;
  if (sid === here) {
    const b = state.nodes[here]?.barricades ?? 0;
    const read =
      b >= MAX_FORTIFICATION
        ? "as secure as this city gets"
        : b >= 67
          ? "well fortified"
          : b >= 34
            ? "fortified against the dark"
            : b >= 1
              ? "lightly shored up"
              : "newly claimed and bare";
    const hint = canFortifyShelter(state) ? " You have scrap to reinforce it further." : "";
    const cache = cacheRead(state);
    return `This is your shelter — ${read}.${hint}${cache !== null ? ` ${cache}` : ""}`;
  }
  if (canClaimShelter(state)) {
    return "You have searched this place clean; it could be made your own.";
  }
  return null;
}
