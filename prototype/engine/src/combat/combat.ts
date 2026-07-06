/**
 * Avoidable turn-based combat, loud firearms, and a stealth path (M1 task T15 · FR-CBT-01/02/04/05).
 *
 * Combat here is a *decision*, never a reflex. When walkers loiter at a node (`NodeState.walkers`)
 * the player is offered a fight — and always a way out. The four requirements this module carries:
 *
 *   - **Avoidable, always spends a resource (FR-CBT-01).** Every option debits something real: a
 *     melee strike costs time + weapon noise + the risk of a wound; a shot costs ammo + time + a
 *     region-scale bang; slipping away costs time + the risk of a parting blow.
 *   - **Turn-based exchange vs. systems, not twitch (FR-CBT-02).** A fight is `GameState.combat`,
 *     carried across turns; each Strike / Fire / Retreat is one resolved turn, and the enemy answers
 *     between them. All rolls come from named RNG streams (`combat`, `stealth`) so a seed reproduces
 *     the exchange exactly.
 *   - **Firearms are loud (FR-CBT-04).** Firing deposits far more noise (via the T14 model's
 *     `params.noise` override) than a melee strike — the loud-solves-one-problem-announces-you
 *     tension made mechanical.
 *   - **A full stealth path through every scenario (FR-CBT-05, the DoD).** "Slip away" is offered at
 *     every walker node to every discovered neighbour; a detection roll over the node's current
 *     noise and the day phase decides a clean escape vs. a parting wound — but you always get out,
 *     so a stealth-only survivor can traverse the whole region without ever entering combat.
 *
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). Enemy tuning (walker hp, damage,
 * the wounds a walker deals) lives here as engine constants — a bridge until an enemy/wound content
 * table lands in M2; the wound *prose* already lives in `content/wounds/` (T16).
 */

import type { CombatState, ContentId, GameState, NodeId, Player } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { discoverAround } from "../map/fogOfWar.js";
import { drawFloat, drawInt, drawPick } from "../rng/streams.js";
import { inflictNamedWound } from "../sim/wounds.js";
import { weatherDetectionDelta } from "../sim/weather.js";

// --- tuning constants -----------------------------------------------------------------------

/** Time cost (hours) of each combat/stealth action. */
export const STRIKE_COST = 1;
export const FIRE_COST = 1;
export const SLIP_COST = 2;
export const RETREAT_COST = 2;

/** Noise each deposits (via the T14 model). A shot is far louder than a swing; slipping is quiet. */
export const MELEE_NOISE = 15;
export const FIRE_NOISE = 75;
export const SLIP_NOISE = 5;

/** The one M1 enemy: a lone walker. */
export const WALKER_ENEMY: ContentId = "enemy.walker";
export const WALKER_MAX_HP = 3;

/** Melee does 1–2; a firearm does 3 — enough to drop a walker in one shot. */
const MELEE_DMG_MIN = 1;
const MELEE_DMG_MAX = 2;
const FIRE_DMG = 3;

/** An alerted walker lands its blow this often; a firearm kept it at range, so it barely answers. */
const MELEE_RETALIATE_CHANCE = 0.5;

/** The named wounds a walker inflicts (ids match content/wounds/, T16). */
const WALKER_WOUNDS: readonly { readonly type: ContentId; readonly severity: number }[] = [
  { type: "wound.laceration", severity: 30 },
  { type: "wound.bite", severity: 40 },
];

/** Firearm + ammo item ids the player might be carrying (content-defined; M1 recognises these). */
const FIREARM_TYPES = new Set<ContentId>(["item.pistol", "item.rifle", "item.shotgun"]);
const AMMO_TYPE: ContentId = "item.ammo";

// --- inventory: does the player have a shot to take? ---------------------------------------

/** True when the player carries a firearm *and* at least one round for it. */
export function hasLoadedFirearm(player: Player): boolean {
  const hasGun = player.inventory.some((e) => FIREARM_TYPES.has(e.type) && e.quantity > 0);
  const hasAmmo = player.inventory.some((e) => e.type === AMMO_TYPE && e.quantity > 0);
  return hasGun && hasAmmo;
}

/** Spend one round of ammo; returns the new Player (removes the stack when it hits zero). */
function spendAmmo(player: Player): Player {
  const inventory = player.inventory
    .map((e) => (e.type === AMMO_TYPE ? { ...e, quantity: e.quantity - 1 } : e))
    .filter((e) => e.quantity > 0);
  return { ...player, inventory };
}

// --- choices offered ------------------------------------------------------------------------

/** The routes a player can slip/retreat to: discovered neighbours, stable-sorted. */
function escapeTargets(state: GameState, graph: RegionGraph): readonly NodeId[] {
  return [...neighborsOf(graph, state.player.location)]
    .filter((to) => state.nodes[to]?.discovered)
    .sort();
}

/**
 * Choices at a *contested* node (walkers present, no fight yet): fight, fire (if armed), and a
 * stealth "slip away" to every discovered neighbour. The stealth options are what make the
 * encounter avoidable (FR-CBT-01/05).
 */
export function encounterChoices(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const choices: SceneChoice[] = [
    { id: "fight", label: "Fight the walker", timeCost: STRIKE_COST,
      action: { type: "fight", choiceId: "fight", timeCost: STRIKE_COST, params: { noise: MELEE_NOISE } } },
  ];
  if (hasLoadedFirearm(state.player)) {
    choices.push({ id: "fire", label: "Fire on the walker (loud)", timeCost: FIRE_COST,
      action: { type: "fire", choiceId: "fire", timeCost: FIRE_COST, params: { noise: FIRE_NOISE } } });
  }
  for (const to of escapeTargets(state, graph)) {
    const name = graph.nodes[to]?.name ?? to;
    choices.push({ id: `slip:${to}`, label: `Slip away toward ${name}`, timeCost: SLIP_COST,
      action: { type: "slip", choiceId: `slip:${to}`, timeCost: SLIP_COST, params: { to, noise: SLIP_NOISE } } });
  }
  return choices;
}

/** Choices *inside* an ongoing fight: strike, fire (if armed), and retreat to a discovered neighbour. */
export function combatChoices(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const choices: SceneChoice[] = [
    { id: "strike", label: "Strike", timeCost: STRIKE_COST,
      action: { type: "strike", choiceId: "strike", timeCost: STRIKE_COST, params: { noise: MELEE_NOISE } } },
  ];
  if (hasLoadedFirearm(state.player)) {
    choices.push({ id: "fire", label: "Fire (loud)", timeCost: FIRE_COST,
      action: { type: "fire", choiceId: "fire", timeCost: FIRE_COST, params: { noise: FIRE_NOISE } } });
  }
  for (const to of escapeTargets(state, graph)) {
    const name = graph.nodes[to]?.name ?? to;
    choices.push({ id: `retreat:${to}`, label: `Retreat toward ${name}`, timeCost: RETREAT_COST,
      action: { type: "retreat", choiceId: `retreat:${to}`, timeCost: RETREAT_COST, params: { to, noise: SLIP_NOISE } } });
  }
  return choices;
}

// --- resolution helpers ---------------------------------------------------------------------

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * Probability a stealth move is detected — louder node + brighter phase ⇒ easier to spot. Weather
 * (T27) shifts it too: rain/fog/storm cut visibility (harder to spot), snow/wind help the walkers.
 * `weather` is optional so M1 callers/tests keep their exact behaviour (clear = no modifier).
 */
export function detectChance(
  noise: number,
  phase: GameState["meta"]["phase"],
  weather?: ContentId,
): number {
  const phaseBonus = phase === "night" ? 0.15 : phase === "dawn" || phase === "evening" ? 0.05 : 0;
  const weatherDelta = weather === undefined ? 0 : weatherDetectionDelta(weather) / 100;
  const p = 0.25 + noise * 0.005 - phaseBonus + weatherDelta;
  return Math.max(0, Math.min(0.9, p));
}

/** Begin a fight against a walker at the player's node (full hp, not yet alerted). */
function beginCombat(state: GameState): GameState {
  const combat: CombatState = {
    node: state.player.location,
    enemy: WALKER_ENEMY,
    hp: WALKER_MAX_HP,
    maxHp: WALKER_MAX_HP,
    alerted: false,
  };
  return { ...state, combat };
}

/** Enemy is down: clear the fight and drop the node's walker count by one. */
function killEnemy(state: GameState): GameState {
  const node = state.nodes[state.player.location];
  const nodes =
    node === undefined
      ? state.nodes
      : { ...state.nodes, [state.player.location]: { ...node, walkers: Math.max(0, node.walkers - 1) } };
  return { ...state, nodes, combat: null };
}

/** An alerted walker answers a melee exchange — a coin-ish flip to land a named wound. */
function enemyRetaliate(state: GameState): GameState {
  const hit = drawFloat(state.rng, state.meta.seed, "combat");
  if (hit.value >= MELEE_RETALIATE_CHANCE) {
    return { ...state, rng: hit.rng }; // a miss — but the draw was still consumed (deterministic)
  }
  const pick = drawPick(hit.rng, state.meta.seed, "combat", WALKER_WOUNDS);
  const condition = inflictNamedWound(state.player.condition, pick.value.type, pick.value.severity, "arm", state.meta.day);
  return { ...state, rng: pick.rng, player: { ...state.player, condition } };
}

/** Resolve one melee strike on the active fight: damage the enemy, then it answers if still up. */
function resolveStrike(state: GameState): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  const dmg = drawInt(state.rng, state.meta.seed, "combat", MELEE_DMG_MIN, MELEE_DMG_MAX);
  const hp = combat.hp - dmg.value;
  const withRng = { ...state, rng: dmg.rng };
  if (hp <= 0) return killEnemy(withRng);
  const bruised: GameState = { ...withRng, combat: { ...combat, hp, alerted: true } };
  return enemyRetaliate(bruised);
}

/** Resolve a shot: spend a round, deal heavy damage; the walker rarely answers a firearm. */
function resolveFire(state: GameState): GameState {
  const started = state.combat === null ? beginCombat(state) : state;
  const combat = started.combat!;
  const player = spendAmmo(started.player);
  const hp = combat.hp - FIRE_DMG;
  const fired: GameState = { ...started, player };
  if (hp <= 0) return killEnemy(fired);
  return { ...fired, combat: { ...combat, hp, alerted: true } };
}

/** Move the player to `to` (relocate, mark visited today, lift fog around it). Pure. */
function relocate(state: GameState, graph: RegionGraph, to: NodeId): GameState {
  const dest = state.nodes[to];
  if (dest === undefined) return state;
  const visited = { ...dest, lastVisit: state.meta.day };
  const nodes = discoverAround({ ...state.nodes, [to]: visited }, graph, to);
  return { ...state, player: { ...state.player, location: to }, nodes };
}

/**
 * A stealth move to `to`: always escapes (the encounter is avoidable), but a detection roll over the
 * node's noise + phase decides whether a walker lands a parting wound on the way out. `clearCombat`
 * distinguishes a pre-fight slip (no combat to clear) from an in-fight retreat.
 */
function resolveEscape(state: GameState, graph: RegionGraph, to: NodeId, clearCombat: boolean): GameState {
  const here = state.nodes[state.player.location];
  const roll = drawFloat(state.rng, state.meta.seed, "stealth");
  const detected = roll.value < detectChance(here?.noise ?? 0, state.meta.phase, state.world.weather);
  let next: GameState = { ...state, rng: roll.rng };
  if (clearCombat) next = { ...next, combat: null };
  if (detected) {
    const pick = drawPick(next.rng, next.meta.seed, "combat", WALKER_WOUNDS);
    const condition = inflictNamedWound(next.player.condition, pick.value.type, pick.value.severity, "back", next.meta.day);
    next = { ...next, rng: pick.rng, player: { ...next.player, condition } };
  }
  return relocate(next, graph, to);
}

/**
 * Resolve a combat/stealth action (pipeline stage 3, dispatched from `applyPlayerAction`). Returns
 * the new state; an action of an unrelated type is returned unchanged for the caller to handle.
 */
export function resolveCombatAction(state: GameState, graph: RegionGraph, action: Action): GameState {
  const to = typeof action.params?.["to"] === "string" ? (action.params["to"] as NodeId) : null;
  switch (action.type) {
    case "fight":
      return resolveStrike(beginCombat(state));
    case "strike":
      return resolveStrike(state);
    case "fire":
      return resolveFire(state);
    case "slip":
      return to === null ? state : resolveEscape(state, graph, to, false);
    case "retreat":
      return to === null ? state : resolveEscape(state, graph, to, true);
    default:
      return state;
  }
}

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isCombatAction(action: Action): boolean {
  return action.type === "fight" || action.type === "strike" || action.type === "fire" ||
    action.type === "slip" || action.type === "retreat";
}

/** Narration for the current situation, or null when there is neither a fight nor a threat here. */
export function combatNarration(state: GameState): string | null {
  if (state.combat !== null) {
    const hurt = state.combat.hp < state.combat.maxHp ? " It is wounded but still coming." : " It hasn't seen you flinch yet.";
    return `You are in it now — a walker, ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}`;
  }
  const node = state.nodes[state.player.location];
  if (node !== undefined && node.walkers > 0) {
    const many = node.walkers === 1 ? "A walker" : `${node.walkers} walkers`;
    return `${many} ${node.walkers === 1 ? "shambles" : "shamble"} here. You can take ${node.walkers === 1 ? "it" : "them"} on, or slip away.`;
  }
  return null;
}
