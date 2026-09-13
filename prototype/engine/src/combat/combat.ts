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
 *     every walker node, to every discovered neighbour; the detection roll decides a clean escape vs.
 *     a parting wound — but you always get out, so a stealth-only survivor can traverse the whole
 *     region without ever entering combat. T77 made that roll read the whole situation rather than
 *     only noise and daylight (`sim/detection.ts`), and made an escape pay the road conditions `move`
 *     pays — **without** letting a blocked road remove the last way off a node, which is what keeps
 *     the "you always get out" half of this requirement true. See {@link escapeTargets}.
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
import { wearWeaponOnStrike } from "../sim/economy.js";
import { weatherDetectionDelta } from "../sim/weather.js";
import { phaseConcealment } from "../sim/timeOfDay.js";
import { rosterOf, removeBodyAt, withRoster } from "../sim/roster.js";
import { ZOMBIE_WALKER } from "../sim/zombies.js";
import { conditionOf, extraCostOf, isBlocked, routeWear, ROUTE_FLOODED_AT } from "../sim/routes.js";
import { stealthDetectChance, stealthRead, stealthTell } from "../sim/detection.js";
import { MOVE_COST } from "../actions/costs.js";

// --- tuning constants -----------------------------------------------------------------------

/** Time cost (hours) of each combat/stealth action. */
export const STRIKE_COST = 1;
export const FIRE_COST = 1;
/**
 * Slipping past the dead costs an hour more than walking the same road clear (`MOVE_COST` + 1).
 *
 * It was 2 — identical to `MOVE_COST` — which made avoidance *free at the margin*: choosing the
 * stealth path over the fight cost nothing you would not have spent walking anyway, so there was
 * never a reason to weigh it. Threading a node full of walkers is slow work, and the hour is the
 * price of the safest verb in the game. `RETREAT_COST` deliberately stays at `MOVE_COST`: breaking
 * off a fight is not careful, it is fast — and it pays instead in the alerted term on the roll
 * (`ALERTED_DETECT`, sim/detection.ts). Slow-and-safe vs. fast-and-seen is the trade.
 */
export const SLIP_COST = MOVE_COST + 1;
export const RETREAT_COST = MOVE_COST;

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
 * Which enemy the fight at a node is against: the most dangerous *combat-distinct* body **standing in
 * the node's roster**, else a plain walker. Priority riot > bloated > fresh > crawler — so a node that
 * mixes a riot in with walkers fights the riot first.
 *
 * As of T75 this reads the per-body roster (`sim/roster.ts`) rather than the node's distinct-type
 * *list*. Before T75 the two were divorced: `zombieTypes: ["zombie.riot"]` with `walkers: 3` meant
 * **three** armored dead, and killing one never removed the type, so the node produced riots until the
 * count ran out. Now the roster holds one entry per body, `killEnemy` removes the body it just put
 * down, and the walkers behind the riot fight as walkers. A roster-less node (a pre-T75 save, a
 * hand-built test state) synthesizes the legacy reading, so it still faces the same first enemy.
 */
export const COMBAT_PRIORITY: readonly ContentId[] = ["zombie.riot", "zombie.bloated", "zombie.fresh", "zombie.crawler"];
export function enemyForNode(state: GameState, nodeId: NodeId = state.player.location): EnemyDef {
  const node = state.nodes[nodeId];
  const bodies = node === undefined ? [] : rosterOf(node);
  for (const z of COMBAT_PRIORITY) {
    if (bodies.includes(z)) return ENEMIES[ENEMY_FOR_ZOMBIE[z]!]!;
  }
  return ENEMIES[WALKER_ENEMY]!;
}

/**
 * The index of the body a kill should remove: the first whose type fights as `def`. A walker kill
 * prefers a plain `zombie.walker` over a screamer/stalker (which have no distinct *combat* profile and
 * so also fight as walkers) — putting down "a walker" at a screamer node leaves the screamer standing,
 * which is both the dramatic reading and the one the arousal machine wants. −1 when nothing matches.
 */
function bodyIndexFor(bodies: readonly ContentId[], def: EnemyDef): number {
  const fightsAs = (t: ContentId): ContentId => ENEMY_FOR_ZOMBIE[t] ?? WALKER_ENEMY;
  if (def.id === WALKER_ENEMY) {
    const plain = bodies.indexOf(ZOMBIE_WALKER);
    if (plain >= 0) return plain;
  }
  return bodies.findIndex((t) => fightsAs(t) === def.id);
}

/** Melee does 1–2; a firearm does 3 — enough to drop a walker in one shot (armor never blunts a shot). */
const MELEE_DMG_MIN = 1;
const MELEE_DMG_MAX = 2;
const FIRE_DMG = 3;

/** An alerted dead lands its blow this often; a firearm kept it at range, so it barely answers. */
const MELEE_RETALIATE_CHANCE = 0.5;

/**
 * The named wounds a melee retaliation inflicts (ids match content/wounds/, T16). Deliberately NOT
 * shared with T76's horde overrun, which draws from its own `OVERRUN_WOUNDS`: this table bites one
 * time in two, which is right for one walker with its hands on you and would turn a two-wound overrun
 * into a ~75% infection sentence. `sim/overrun.ts` carries that arithmetic.
 */
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

/**
 * The routes a player can slip/retreat to: discovered neighbours, blocked roads dropped **while any
 * passable road remains**, stable-sorted. Exported since T76 so a horde overrun offers the same set —
 * one definition of "where you can run to", which is why fixing it here fixes the overrun's flight in
 * the same stroke.
 *
 * **PL-M2-05, closed here — but not the way the task note asked, and the difference matters.** Until
 * T77 this filtered on `discovered` alone, where `move` (coreActions.ts) also drops a route with
 * `isBlocked(routeWear(...))` and charges `extraCostOf` for a worn one. The note called for the same
 * two rules. The first one, applied unconditionally, is a **stranding bug**, and PL-M2-05's own
 * recorded text says so: the hole was *"deliberate so a fight can never strand the player behind a
 * blocked road"*. FR-CBT-05 is a Must — "you always get out" — so an unconditional filter would trade
 * one defect for a worse one.
 *
 * The reachability was measured, and the first draft of this comment had it backwards. It claimed no
 * route on the shipped city can ever block, on the grounds that every region starts at `roads: 100`
 * with `fire: 0` and the worst weather adds only `movementDelta 2 × 15 = 30` against
 * `ROUTE_BLOCKED_AT` 80. The `fire` third is true — nothing anywhere writes `RegionState.fire`. The
 * rest dropped the dominant term: `tickWeather` **degrades `roads` monotonically and never restores
 * them** (`sim/weather.ts`, `roadPressure` 2 under storm, 1 under snow; `seedWorld.ts` says outright
 * that roads "degrade during play, never tick up on their own"), and `targetWear` is
 * `(100 − min(roads)) + fire + movementDelta × 15`. Blocking therefore needs only `roads ≤ 50` under
 * snow, or `≤ 35` under storm. Measured on the shipped city (`measure/t77.ts --roads`): roads fall to
 * **50 under sustained snow and a route blocks on day 14–15**; under sustained storm they fall to 35
 * and a route blocks on **day 9–10**. Under clear skies they never move at all. And because road decay
 * is applied to every region alike, when one route blocks they very nearly all do, at once.
 *
 * So the rule is: **drop blocked routes, unless that would leave nowhere to run.** A player boxed in
 * by flooded-out roads still gets a way off the node — they force the crossing, and
 * {@link escapeExtraCost} charges them the worst rate the road table has for it. `move` keeps its own
 * unconditional refusal (travelling for its own sake through an impassable road is a different act
 * from breaking out of a nest through one), which is also why the total-immobility case that filter
 * can produce is `move`'s pre-existing problem and not this one's to solve.
 *
 * **The extra-hours half is live and was being dodged**, and that half is unconditional: over 16 runs
 * of the shipped city, **115 escape offers crossed a worn route and 36 were taken, dodging 36 hours**
 * that a `move` over the same edge would have charged. Every one of the 36 was `costly` (+1h): these
 * runs end around day 4, long before road decay reaches the flooded band, which is also why the
 * blocked case above needed a separate, longer probe to find. After the fix the same measurement reads
 * **0 hours dodged**. The runner is committed at `prototype/harness/measure/t77.ts` so the numbers can
 * be re-derived rather than taken on trust.
 */
export function escapeTargets(state: GameState, graph: RegionGraph): readonly NodeId[] {
  const here = state.player.location;
  const reachable = [...neighborsOf(graph, here)].filter((to) => state.nodes[to]?.discovered).sort();
  const passable = reachable.filter((to) => !isBlocked(routeWear(state, here, to)));
  // The FR-CBT-05 fallback: a blocked road is refused only while there is somewhere else to go.
  return passable.length > 0 ? passable : reachable;
}

/**
 * The extra hours a worn route adds to an escape, exactly as `move` charges them — so slipping,
 * retreating and fleeing over a flooded road all cost what walking it costs. Zero on a clear route,
 * which is every route on a fresh run.
 *
 * A **blocked** road is the one case `move` has no price for, because `move` simply refuses it. When
 * {@link escapeTargets} falls back to offering one (nothing else is passable), it is charged the
 * worst rate the table has — `extraCostOf` of the flooded band — so forcing the crossing is the most
 * expensive way off a node rather than a free one.
 */
export function escapeExtraCost(state: GameState, to: NodeId): number {
  const wear = routeWear(state, state.player.location, to);
  return isBlocked(wear) ? extraCostOf(ROUTE_FLOODED_AT) : extraCostOf(wear);
}

/** The road-condition suffix `move` shows, so an escape never hides a cost it is charging. */
function escapeRoadSuffix(state: GameState, to: NodeId): string {
  const wear = routeWear(state, state.player.location, to);
  if (isBlocked(wear)) return " — the way is blocked; you would have to force it";
  const cond = conditionOf(wear);
  return cond === "flooded" ? " — the way is flooded" : cond === "costly" ? " — the road is rough" : "";
}

/**
 * Choices at a *contested* node (walkers present, no fight yet): fight, fire (if armed), and a
 * stealth "slip away" to every discovered neighbour {@link escapeTargets} still offers. The stealth
 * options are what make the encounter avoidable (FR-CBT-01/05), and there is always at least one of
 * them while the player has a discovered neighbour at all.
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
    // A worn road costs the slip what it costs the walk (T77) — the same `extraCostOf` `move` charges,
    // and the same suffix `move` prints, so the extra hours are never charged silently.
    const cost = SLIP_COST + escapeExtraCost(state, to);
    choices.push({ id: `slip:${to}`, label: `Slip away toward ${name}${escapeRoadSuffix(state, to)}`, timeCost: cost,
      action: { type: "slip", choiceId: `slip:${to}`, timeCost: cost, params: { to, noise: SLIP_NOISE } } });
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
    const cost = RETREAT_COST + escapeExtraCost(state, to);
    choices.push({ id: `retreat:${to}`, label: `Retreat toward ${name}${escapeRoadSuffix(state, to)}`, timeCost: cost,
      action: { type: "retreat", choiceId: `retreat:${to}`, timeCost: cost, params: { to, noise: SLIP_NOISE } } });
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
 * Enemy is down: clear the fight and remove **that body** from the node's roster (T75), which drops
 * `walkers` by one and clears the type when it was the last of its kind — so the riot you just killed
 * is gone and the walkers behind it fight as walkers. Before T75 only the count moved, and the type
 * list never did. A Bloated bursts as it falls (`burstInfection`): whoever put it down — melee or
 * firearm — is standing on it, so the infectious spray inflicts a bite-severity wound that drives the
 * T22 infection track. No new RNG draw (a fixed wound).
 */
function killEnemy(state: GameState, def: EnemyDef): GameState {
  const node = state.nodes[state.player.location];
  let nodes = state.nodes;
  if (node !== undefined) {
    const bodies = rosterOf(node);
    const idx = bodyIndexFor(bodies, def);
    // A kill against a body the roster no longer lists (an encounter effect emptied the node mid-fight,
    // or a hand-edited save) spends one body off the END of the roster. Not quite the pre-T75
    // behaviour: `withRoster` re-derives `zombieTypes`, so a type whose last body sat at the tail
    // clears with it, where the old count-only decrement kept it listed. An EMPTY roster returns the
    // node untouched — same reference, type list intact — which is what matters, because that is the
    // shape a converted pre-T75 save has at every node the player had already cleared. Unreachable in
    // normal play: nothing removes bodies mid-fight, and encounters only fire at `walkers === 0`.
    const dropped =
      idx >= 0
        ? removeBodyAt(node, idx)
        : bodies.length === 0
          ? node
          : withRoster(node, bodies.slice(0, bodies.length - 1));
    nodes = dropped === node ? state.nodes : { ...state.nodes, [state.player.location]: dropped };
  }
  let player = state.player;
  if (def.burstInfection > 0) {
    const condition = inflictNamedWound(player.condition, "wound.bite", def.burstInfection, "face", state.meta.day, state.meta.hour);
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
  const condition = inflictNamedWound(state.player.condition, pick.value.type, pick.value.severity, "arm", state.meta.day, state.meta.hour);
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
  // A melee strike wears an equipped durability artifact (T51 · FR-ECO-07 — the safety-loop sink, and the
  // reason to repair rather than replace). Inert on every prior run: no current item has non-null
  // durability and the start equipment is empty, so this passes the state through unchanged.
  const withRng = wearWeaponOnStrike({ ...state, rng: dmg.rng });
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

/**
 * Move the player to `to` (relocate, mark visited today, lift fog around it). Pure. Exported as
 * {@link relocatePlayer} since T76 so a horde overrun's flight lands the player exactly where a slip
 * or a retreat would, fog reveal included.
 */
export function relocatePlayer(state: GameState, graph: RegionGraph, to: NodeId): GameState {
  const dest = state.nodes[to];
  if (dest === undefined) return state;
  const visited = { ...dest, lastVisit: state.meta.day };
  const nodes = discoverAround({ ...state.nodes, [to]: visited }, graph, to);
  return { ...state, player: { ...state.player, location: to }, nodes };
}

/**
 * A Crawler is likelier to catch a fleeing player (you didn't see it), and it goes for the ankle.
 *
 * **T77 changed what this can reach, in one direction, and it is worth stating.** It used to be added
 * to `detectChance`'s already-clamped output with no second clamp, so at a loud node it could push the
 * catch chance past 1.0 — a *guaranteed* ankle-grab (noise 100 at midday in wind read 1.05). It is now
 * passed through `composeStealth` as `extra` and clamped once with everything else at `DETECT_MAX`
 * 0.9. So at the very loudest nodes the Crawler is slightly *weaker* than it was, and everywhere else
 * it is stronger, because the arousal and scent terms it now sits on top of are worth far more than
 * the 0.10 of headroom it lost. "Nothing is ever certain" is the rule the clamp exists to keep, and a
 * guaranteed grab was the one place the codebase quietly broke it.
 */
const GRASP_ESCAPE_BONUS = 0.25;
const GRASP_SEVERITY = 25;

/**
 * A stealth move to `to`: always escapes (the encounter is avoidable), but a detection roll decides
 * whether the dead land a parting wound on the way out. A grasping type (Crawler, `graspWound`) is
 * harder to slip — a bonus to the catch chance — and lands its own ankle wound rather than a random
 * blow. `clearCombat` distinguishes a pre-fight slip from an in-fight retreat.
 *
 * **T77 closes the chain here.** The roll used to be `detectChance(noise, phase, weather)` and nothing
 * else: three world inputs, blind to the dead in front of you and to the state of the body carrying
 * the pack. It now runs through `stealthDetectChance` (sim/detection.ts), which adds the node's
 * arousal rung, the alerted-fight penalty on a retreat, the scent of an untreated wound and the weight
 * of a laden pack. `detectChance` itself is untouched and still means exactly what it meant — the
 * world's half of the read — so the T15/T27/T28 tests that pin it keep pinning the same thing.
 *
 * The RNG is untouched too: one `stealth` draw, in the same place, against a different number. Runs
 * are NOT byte-identical across this change and are not meant to be (declared, like T71/T72/T76) —
 * the stealth roll is the thing the task exists to move.
 */
function resolveEscape(state: GameState, graph: RegionGraph, to: NodeId, clearCombat: boolean): GameState {
  const here = state.nodes[state.player.location];
  const def = enemyForNode(state, state.player.location);
  const grasp = def.graspWound;
  const base = detectChance(here?.noise ?? 0, state.meta.phase, state.world.weather);
  // `alerted` only applies to a retreat — breaking off a fight the dead have hold of. A slip happens
  // before any fight exists, so there is nothing alerted to break off.
  const alerted = clearCombat && state.combat !== null && state.combat.alerted;
  const chance = stealthDetectChance(state, base, {
    ...(alerted ? { alerted: true } : {}),
    ...(grasp !== null ? { extra: GRASP_ESCAPE_BONUS } : {}),
  });
  const roll = drawFloat(state.rng, state.meta.seed, "stealth");
  const detected = roll.value < chance;
  let next: GameState = { ...state, rng: roll.rng };
  if (clearCombat) next = { ...next, combat: null };
  if (detected) {
    if (grasp !== null) {
      // The ankle-grab: a fixed wound, no combat draw (the crawler always goes low). New type ⇒ no golden.
      const condition = inflictNamedWound(next.player.condition, grasp, GRASP_SEVERITY, "leg", next.meta.day, next.meta.hour);
      next = { ...next, player: { ...next.player, condition } };
    } else {
      const pick = drawPick(next.rng, next.meta.seed, "combat", WALKER_WOUNDS);
      const condition = inflictNamedWound(next.player.condition, pick.value.type, pick.value.severity, "back", next.meta.day, next.meta.hour);
      next = { ...next, rng: pick.rng, player: { ...next.player, condition } };
    }
  }
  return relocatePlayer(next, graph, to);
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
 * The T77 signpost, as a sentence fragment to append (empty when the world alone is the read).
 *
 * The stealth roll now reads the node's arousal, the blood you are leaving and the weight on your
 * back, and a player who is told none of that just experiences a wound rate that got worse for no
 * reason. The design review's standing rule for exactly this situation is **"signpost, don't
 * retune"**, so the loudest term the roll is charging for is named in the one sentence the player
 * reads immediately before choosing whether to slip.
 *
 * The `alerted` term is included when a fight is live, because that is when it is charged. A calm,
 * unhurt, empty-handed player at a dormant node gets the exact pre-T77 sentence, unchanged — which is
 * what keeps the accessibility transcript's plain-walker wording (`repopulate.test.ts`) intact for
 * every situation it covers.
 */
function stealthTellFor(state: GameState): string {
  const here = state.nodes[state.player.location];
  const base = detectChance(here?.noise ?? 0, state.meta.phase, state.world.weather);
  const alerted = state.combat !== null && state.combat.alerted;
  const tell = stealthTell(stealthRead(state, base, alerted ? { alerted: true } : {}));
  return tell === null ? "" : ` (${tell})`;
}

/**
 * Narration for the current situation, or null when there is neither a fight nor a threat here. Names
 * the type you face and gives its non-audio signature (FR-AUD-06) so the read never depends on sound.
 * A plain walker node keeps its exact pre-T46 wording (the accessibility transcript relies on it).
 */
export function combatNarration(state: GameState): string | null {
  const tell = stealthTellFor(state);
  if (state.combat !== null) {
    const def = ENEMIES[state.combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
    const hurt = state.combat.hp < state.combat.maxHp ? " It is wounded but still coming." : " It hasn't seen you flinch yet.";
    if (def.id === WALKER_ENEMY) {
      return `You are in it now — a walker, ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}${tell}`;
    }
    return `You are in it now — a ${def.name}, ${def.signature}; ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}${tell}`;
  }
  const node = state.nodes[state.player.location];
  if (node !== undefined && node.walkers > 0) {
    const def = enemyForNode(state);
    if (def.id === WALKER_ENEMY) {
      const many = node.walkers === 1 ? "A walker" : `${node.walkers} walkers`;
      return `${many} ${node.walkers === 1 ? "shambles" : "shamble"} here. You can take ${node.walkers === 1 ? "it" : "them"} on, or slip away.${tell}`;
    }
    // T75: the roster knows how many bodies stand behind the one you would fight first, so a mixed node
    // reads honestly instead of hiding four walkers behind one riot. A node whose only body is the
    // special keeps the exact pre-T75 sentence.
    const rest = Math.max(0, rosterOf(node).length - 1);
    if (rest === 0) return `A ${def.name} is here — ${def.signature}. You can take it on, or slip away.${tell}`;
    const behind = rest === 1 ? "one more behind it" : `${rest} more behind it`;
    return `A ${def.name} is here — ${def.signature} — and ${behind}. You can take it on, or slip away.${tell}`;
  }
  return null;
}
