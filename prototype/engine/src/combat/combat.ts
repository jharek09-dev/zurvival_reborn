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
import { phaseConcealment } from "../sim/timeOfDay.js";

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

/**
 * The enemy roster (T15 walker + T46 type-distinct dead). The engine holds the authoritative combat
 * dials here as constants — the same bridge the loot tables and walker stats already are — and
 * `content/enemies/*.json` mirrors them for the schema gate + a harness drift-guard. Each keys to a
 * `zombie.<slug>` behaviour def (`ZOMBIE_BEHAVIOUR`, T25/T46): the zombie tags drive the *state
 * machine*, this table drives the *fight*.
 *
 *   - **armor** — flat melee mitigation. A blunt strike is reduced by it (floored at 0 net); a firearm
 *     punches straight through (armor never reduces a shot). The Riot's "right approach is a bullet".
 *   - **burstInfection** — an infectious wound the type inflicts on whoever puts it down at their node
 *     (melee OR firearm — you are standing on it either way). The Bloated: killing it up close is a bad
 *     idea, so you learn to slip past instead.
 *   - **graspWound** — the wound a fleeing player risks from this type (Crawler's ankle-grab): slipping
 *     past it costs more than past a plain walker.
 *   - **initiative** — answers *every* melee exchange rather than the coin-flip a walker gives (Fresh).
 */
export interface EnemyDef {
  readonly id: ContentId;
  /** Player-facing name used in combat narration + choice labels. */
  readonly name: string;
  readonly maxHp: number;
  /** Flat melee damage mitigation (0 = none). */
  readonly armor: number;
  /** Infectious-wound severity inflicted on the killer at the node when it dies (0 = no burst). */
  readonly burstInfection: number;
  /** Content id of the parting wound a fleeing player risks from this type, or null. */
  readonly graspWound: ContentId | null;
  /** True ⇒ answers every melee exchange (a fast dead); false ⇒ the walker coin-flip. */
  readonly initiative: boolean;
  /** The non-audio combat tell (FR-AUD-06) — how you read what you're fighting without sound. */
  readonly signature: string;
}

const enemy = (d: Partial<EnemyDef> & { id: ContentId; name: string; maxHp: number; signature: string }): EnemyDef => ({
  armor: 0,
  burstInfection: 0,
  graspWound: null,
  initiative: false,
  ...d,
});

/** The one M1 enemy id, kept for callers/tests that reference the walker directly. */
export const WALKER_ENEMY: ContentId = "enemy.walker";
export const WALKER_MAX_HP = 3;

export const ENEMY_FRESH: ContentId = "enemy.fresh";
export const ENEMY_CRAWLER: ContentId = "enemy.crawler";
export const ENEMY_BLOATED: ContentId = "enemy.bloated";
export const ENEMY_RIOT: ContentId = "enemy.riot";

/** The authoritative combat dials. `content/enemies/*.json` mirrors these; a harness test guards drift. */
export const ENEMIES: { readonly [id: ContentId]: EnemyDef } = {
  [WALKER_ENEMY]: enemy({ id: WALKER_ENEMY, name: "walker", maxHp: WALKER_MAX_HP,
    signature: "a slow, tireless shamble" }),
  [ENEMY_FRESH]: enemy({ id: ENEMY_FRESH, name: "fresh one", maxHp: 3, initiative: true,
    signature: "fast, wet, ragged — it answers every blow" }),
  [ENEMY_CRAWLER]: enemy({ id: ENEMY_CRAWLER, name: "crawler", maxHp: 2, graspWound: "wound.sprain",
    signature: "low and near, dragging itself at your ankles" }),
  [ENEMY_BLOATED]: enemy({ id: ENEMY_BLOATED, name: "bloated one", maxHp: 4, burstInfection: 40,
    signature: "a swollen, gas-tight gurgle — bad to burst up close" }),
  [ENEMY_RIOT]: enemy({ id: ENEMY_RIOT, name: "armored dead", maxHp: 5, armor: 1,
    signature: "riot plate your blows skid off — a bullet finds the gaps" }),
};

/** The enemy a type id fights as. Screamer/Stalker have no distinct *combat* profile ⇒ they fight as walkers. */
export const ENEMY_FOR_ZOMBIE: { readonly [zombieId: ContentId]: ContentId } = {
  "zombie.fresh": ENEMY_FRESH,
  "zombie.crawler": ENEMY_CRAWLER,
  "zombie.bloated": ENEMY_BLOATED,
  "zombie.riot": ENEMY_RIOT,
};

/**
 * Which enemy the fight at a node is against: the most dangerous *combat-distinct* type present, else a
 * plain walker. Priority riot > bloated > fresh > crawler — so a node that mixes a riot in with walkers
 * fights the riot. A screamer/stalker node (no combat-distinct type) fights a walker, exactly as before
 * T46, which is what keeps every pre-T46 encounter byte-identical.
 */
const COMBAT_PRIORITY: readonly ContentId[] = ["zombie.riot", "zombie.bloated", "zombie.fresh", "zombie.crawler"];
export function enemyForNode(state: GameState, nodeId: NodeId = state.player.location): EnemyDef {
  const types = state.nodes[nodeId]?.zombieTypes ?? [];
  for (const z of COMBAT_PRIORITY) {
    if (types.includes(z)) return ENEMIES[ENEMY_FOR_ZOMBIE[z]!]!;
  }
  return ENEMIES[WALKER_ENEMY]!;
}

/** Melee does 1–2; a firearm does 3 — enough to drop a walker in one shot (armor never blunts a shot). */
const MELEE_DMG_MIN = 1;
const MELEE_DMG_MAX = 2;
const FIRE_DMG = 3;

/** An alerted dead lands its blow this often; a firearm kept it at range, so it barely answers. */
const MELEE_RETALIATE_CHANCE = 0.5;

/** The named wounds a melee retaliation inflicts (ids match content/wounds/, T16). */
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
  const foe = enemyForNode(state);
  const choices: SceneChoice[] = [
    { id: "fight", label: `Fight the ${foe.name}`, timeCost: STRIKE_COST,
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
  // Phase term is owned by T28 (timeOfDay): dimmer light conceals a stealth mover, lowering the
  // chance of being spotted. Same numbers T15 always used; night hides most.
  const phaseBonus = phaseConcealment(phase) / 100;
  const weatherDelta = weather === undefined ? 0 : weatherDetectionDelta(weather) / 100;
  const p = 0.25 + noise * 0.005 - phaseBonus + weatherDelta;
  return Math.max(0, Math.min(0.9, p));
}

/** Begin a fight at the player's node against the most dangerous type present (full hp, not yet alerted). */
function beginCombat(state: GameState): GameState {
  const def = enemyForNode(state);
  const combat: CombatState = {
    node: state.player.location,
    enemy: def.id,
    hp: def.maxHp,
    maxHp: def.maxHp,
    alerted: false,
  };
  return { ...state, combat };
}

/**
 * Enemy is down: clear the fight and drop the node's walker count by one. A Bloated bursts as it falls
 * (`burstInfection`): whoever put it down — melee or firearm — is standing on it, so the infectious
 * spray inflicts a bite-severity wound that drives the T22 infection track. No new RNG draw (a fixed
 * wound), so a seeded walker kill is byte-identical to before T46.
 */
function killEnemy(state: GameState, def: EnemyDef): GameState {
  const node = state.nodes[state.player.location];
  const nodes =
    node === undefined
      ? state.nodes
      : { ...state.nodes, [state.player.location]: { ...node, walkers: Math.max(0, node.walkers - 1) } };
  let player = state.player;
  if (def.burstInfection > 0) {
    const condition = inflictNamedWound(player.condition, "wound.bite", def.burstInfection, "face", state.meta.day);
    player = { ...player, condition };
  }
  return { ...state, nodes, player, combat: null };
}

/** An alerted dead answers a melee exchange — a coin-ish flip (or *every* time, if it has initiative). */
function enemyRetaliate(state: GameState, def: EnemyDef): GameState {
  const chance = def.initiative ? 1 : MELEE_RETALIATE_CHANCE;
  const hit = drawFloat(state.rng, state.meta.seed, "combat");
  if (hit.value >= chance) {
    return { ...state, rng: hit.rng }; // a miss — but the draw was still consumed (deterministic)
  }
  const pick = drawPick(hit.rng, state.meta.seed, "combat", WALKER_WOUNDS);
  const condition = inflictNamedWound(state.player.condition, pick.value.type, pick.value.severity, "arm", state.meta.day);
  return { ...state, rng: pick.rng, player: { ...state.player, condition } };
}

/**
 * Resolve one melee strike on the active fight: damage the enemy (armor blunts a blow, floored at 0
 * net), then it answers if still up. Armored dead (Riot) shrug off blunt strikes — the fight wants a
 * firearm or a wide berth.
 */
function resolveStrike(state: GameState): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  const def = ENEMIES[combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
  const dmg = drawInt(state.rng, state.meta.seed, "combat", MELEE_DMG_MIN, MELEE_DMG_MAX);
  const dealt = Math.max(0, dmg.value - def.armor);
  const hp = combat.hp - dealt;
  const withRng = { ...state, rng: dmg.rng };
  if (hp <= 0) return killEnemy(withRng, def);
  const bruised: GameState = { ...withRng, combat: { ...combat, hp, alerted: true } };
  return enemyRetaliate(bruised, def);
}

/** Resolve a shot: spend a round, deal heavy damage that ignores armor; the dead rarely answer a firearm. */
function resolveFire(state: GameState): GameState {
  const started = state.combat === null ? beginCombat(state) : state;
  const combat = started.combat!;
  const def = ENEMIES[combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
  const player = spendAmmo(started.player);
  const hp = combat.hp - FIRE_DMG;
  const fired: GameState = { ...started, player };
  if (hp <= 0) return killEnemy(fired, def);
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

/** A Crawler is likelier to catch a fleeing player (you didn't see it), and it goes for the ankle. */
const GRASP_ESCAPE_BONUS = 0.25;
const GRASP_SEVERITY = 25;

/**
 * A stealth move to `to`: always escapes (the encounter is avoidable), but a detection roll over the
 * node's noise + phase decides whether the dead land a parting wound on the way out. A grasping type
 * (Crawler, `graspWound`) is harder to slip — a bonus to the catch chance — and lands its own ankle
 * wound rather than a random blow. Non-grasp nodes keep the exact pre-T46 roll + wound draw, so every
 * prior escape is byte-identical. `clearCombat` distinguishes a pre-fight slip from an in-fight retreat.
 */
function resolveEscape(state: GameState, graph: RegionGraph, to: NodeId, clearCombat: boolean): GameState {
  const here = state.nodes[state.player.location];
  const def = enemyForNode(state, state.player.location);
  const grasp = def.graspWound;
  const chance = detectChance(here?.noise ?? 0, state.meta.phase, state.world.weather) + (grasp !== null ? GRASP_ESCAPE_BONUS : 0);
  const roll = drawFloat(state.rng, state.meta.seed, "stealth");
  const detected = roll.value < chance;
  let next: GameState = { ...state, rng: roll.rng };
  if (clearCombat) next = { ...next, combat: null };
  if (detected) {
    if (grasp !== null) {
      // The ankle-grab: a fixed wound, no combat draw (the crawler always goes low). New type ⇒ no golden.
      const condition = inflictNamedWound(next.player.condition, grasp, GRASP_SEVERITY, "leg", next.meta.day);
      next = { ...next, player: { ...next.player, condition } };
    } else {
      const pick = drawPick(next.rng, next.meta.seed, "combat", WALKER_WOUNDS);
      const condition = inflictNamedWound(next.player.condition, pick.value.type, pick.value.severity, "back", next.meta.day);
      next = { ...next, rng: pick.rng, player: { ...next.player, condition } };
    }
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

/**
 * Narration for the current situation, or null when there is neither a fight nor a threat here. Names
 * the type you face and gives its non-audio signature (FR-AUD-06) so the read never depends on sound.
 * A plain walker node keeps its exact pre-T46 wording (the accessibility transcript relies on it).
 */
export function combatNarration(state: GameState): string | null {
  if (state.combat !== null) {
    const def = ENEMIES[state.combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
    const hurt = state.combat.hp < state.combat.maxHp ? " It is wounded but still coming." : " It hasn't seen you flinch yet.";
    if (def.id === WALKER_ENEMY) {
      return `You are in it now — a walker, ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}`;
    }
    return `You are in it now — a ${def.name}, ${def.signature}; ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}`;
  }
  const node = state.nodes[state.player.location];
  if (node !== undefined && node.walkers > 0) {
    const def = enemyForNode(state);
    if (def.id === WALKER_ENEMY) {
      const many = node.walkers === 1 ? "A walker" : `${node.walkers} walkers`;
      return `${many} ${node.walkers === 1 ? "shambles" : "shamble"} here. You can take ${node.walkers === 1 ? "it" : "them"} on, or slip away.`;
    }
    return `A ${def.name} is here — ${def.signature}. You can take it on, or slip away.`;
  }
  return null;
}
