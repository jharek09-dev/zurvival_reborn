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

import type { ActorId, CombatState, ContentId, GameState, NodeId, Player, Survivor } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { neighborsOf } from "../map/regionGraph.js";
import { discoverAround } from "../map/fogOfWar.js";
import { drawFloat, drawInt, drawPick } from "../rng/streams.js";
import { inflictNamedWound, woundBurden } from "../sim/wounds.js";
// T82: the party is an input to a fight at last. `sim/companions.ts` imports `sim/survival.ts` and
// `sim/clocks.ts` and nothing else, and neither reaches back here, so this edge adds no cycle.
import { COMPANION_FATAL_BURDEN, companionName, fightingCompanions, killCompanion } from "../sim/companions.js";
import { wearWeaponOnStrike } from "../sim/economy.js";
import { weatherDetectionDelta } from "../sim/weather.js";
import { phaseConcealment } from "../sim/timeOfDay.js";
import { rosterOf, removeBodyAt, withRoster } from "../sim/roster.js";
import { ZOMBIE_WALKER } from "../sim/zombies.js";
import { conditionOf, extraCostOf, isBlocked, routeWear, ROUTE_FLOODED_AT } from "../sim/routes.js";
import { stealthDetectChance, stealthRead, stealthTell } from "../sim/detection.js";
import { MOVE_COST } from "../actions/costs.js";
import {
  BARE_HANDS,
  BARE_NOISE,
  PISTOL_NOISE,
  WEAPONS,
  effectiveDamage,
  retaliateChance,
  surestOf,
  weaponFor,
  marksSuffix,
  equippedItem,
  type WeaponDef,
} from "./weapons.js";

// --- tuning constants -----------------------------------------------------------------------

/** Time cost (hours) of each combat/stealth action. */
export const STRIKE_COST = 1;
export const FIRE_COST = 1;
/**
 * A committed swing and a shove both cost one beat, the same as a strike.
 *
 * The T80 brief priced HEAVY as "double damage, double noise, guaranteed retaliation" and PUSH as "no
 * damage, clears alerted, −0.3 on your next slip" — three costs and one, and no hours in either. An
 * extra hour on top was drafted here and then dropped: it would have made HEAVY strictly worse than two
 * ordinary strikes against anything it fails to kill, and PUSH — which deals no damage at all — is
 * already paying its hour in full for a defensive effect. Both verbs pay in the fight, not the clock.
 */
export const HEAVY_COST = STRIKE_COST;
export const PUSH_COST = STRIKE_COST;
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

/**
 * Noise each deposits (via the T14 model). A shot is far louder than a swing; slipping is quiet.
 *
 * Since T80 these are the *bare-hands* and *pistol* rows of the weapon table rather than the only two
 * numbers in the game — a heavier tool is louder, a rifle is louder still, and a heavy swing is double
 * whatever it is swung with. They keep their names and their values because they are what every T14/T15
 * noise measurement has meant, and because the pistol is the only firearm the shipped city can hand you.
 */
export const MELEE_NOISE = BARE_NOISE;
export const FIRE_NOISE = PISTOL_NOISE;
export const SLIP_NOISE = 5;
/** A shove is quieter than a swing and far quieter than a shot: a scuffle, not a blow. */
export const PUSH_NOISE = 10;
/** A heavy swing doubles the weapon's damage, its noise, and the durability it spends. */
export const HEAVY_DMG_MULT = 2;
export const HEAVY_NOISE_MULT = 2;
export const HEAVY_WEAR_MULT = 2;

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

/**
 * How often an alerted dead lands its answer, by the kind of blow it is answering.
 *
 * **`FIRE_RETALIATE_CHANCE` is the second half of T80's central fix and the first time a shot can cost
 * you anything but ammo.** Before this task `resolveFire` never called {@link enemyRetaliate} at all,
 * so — measured, not inferred — firing was a **0%** chance of a wound and a **0%** chance of a bite
 * against every enemy in the game that does not burst when it dies, against melee's 56.8% / 29.1%
 * on a plain walker and 99.0% / 89.2% on a Riot. That is not a tuning error, it is a dominant strategy
 * with no counterweight, because the designed counterweight (`FIRE_NOISE` 75) only began to bite when
 * T75/T76 gave noise something to summon.
 *
 * A quarter is deliberately far below melee's half: a firearm still *is* the safe answer, and should
 * be. What it can no longer be is a free one — and it only ever rolls on a shot that did **not** put
 * the body down, so the pistol that one-shots a walker is still untouched when it connects.
 */
const MELEE_RETALIATE_CHANCE = 0.5;
const FIRE_RETALIATE_CHANCE = 0.25;
const RETALIATE_BASE = { melee: MELEE_RETALIATE_CHANCE, firearm: FIRE_RETALIATE_CHANCE } as const;

/**
 * Probability a shoved enemy takes off the very next escape roll (the PUSH verb's whole payload).
 *
 * PUSH also clears `CombatState.alerted`, which is worth another `ALERTED_DETECT` 15 points on a
 * retreat (`sim/detection.ts`), so a shove-then-run reads **0.45 lower** than the same retreat taken
 * straight — one hour and no damage for a materially cleaner way out. It is subtracted through
 * `composeStealth`'s `extra`, which is summed before the single clamp, so it can never drive the roll
 * below zero and can never make an escape *certain*.
 */
export const PUSH_ESCAPE_BONUS = 0.3;

// --- GRABBED: the outcome that makes a fight losable (T82 · FR-CBT-02 · GDD IX) -----------------

/**
 * The share of a **landing** retaliation that does more than wound: it gets hold of you.
 *
 * This costs **no new RNG draw**, which is the whole reason it is written as a share rather than a
 * second roll. {@link enemyRetaliate} already draws one float and compares it to the retaliation
 * chance; a grab is simply the bottom {@link GRAB_CHANCE} of that same interval. So the `combat`
 * stream advances exactly as it did before T82 — the same number of draws in the same order, against
 * the same numbers — and every T15–T81 measurement of what a fight *costs* stays comparable. Only the
 * consequence of a blow that was already landing has changed. (The same trick as T81's
 * `drawWeighted`, which buys rarity for the identical single `drawInt` a uniform pick spent.)
 *
 * A third is a deliberate minority of a minority: melee retaliation lands half the time, so a plain
 * exchange with a walker grabs about one time in six. Measured on the shipped city over 120 bot runs,
 * that lands on **12.8%** of a brawler's combat turns and 19.9% of a more careful player's — the
 * careful player's is higher because they spend fewer turns in fights they are winning easily.
 *
 * It is a **texture** dial, not a lethality dial, and the sweep is what showed that: swept by rebuild
 * against `LAST_STAND_AT`, halving it from 1/3 to 1/4 moved the share of runs ending in a Last Stand
 * by 1–2 points at every threshold, while the threshold itself moved it by 20. What this number sets
 * is how often you lose your way out, not how often that kills you.
 */
export const GRAB_CHANCE = 1 / 3;

/**
 * **While something has hold of you, your MELEE is bare hands** — whatever you are carrying.
 *
 * Melee, and only melee. {@link resolveFire} does not consult this and is not meant to: a shot fired
 * with the muzzle against something holding you is exactly as accurate and exactly as damaging as any
 * other shot, and `combatChoices` still offers it (relabelled "Fire point blank"). So the grab prices
 * the melee player and leaves the armed one untouched, which **widens PL-M5-38** — firing is already
 * the safest verb in the game — rather than narrowing it. Stated here rather than quietly implied by
 * a sentence about "whatever you are carrying"; the fix belongs with T59/T60's balance pass or with
 * the explosives verb, not smuggled into this one.
 *
 * This is the second cut, and the first one was broken in a way only the test suite found. The brief
 * says "strikes deal less", so the obvious implementation was a multiplier: half the rolled damage,
 * floored at 1. On **bare hands** — the 1–2 band, and the case that matters, because it is what most
 * players hold for most of a run — halving lands on 1 every single time, and 1 is exactly the Riot's
 * `armor`. The result was that a grabbed, bare-handed player dealt **literally zero damage to a Riot,
 * on every swing, forever**: `strike` stayed on the menu, cost an hour, drew a retaliation, and could
 * never end the fight. (The wider bands escape it — the axe's 3–5 halves to 1 or 2 — which is what
 * made the defect invisible until a bare-handed Riot fixture ran into it.) A dead affordance that reads like a live one is the precise defect the
 * design review exists to kill, and the multiplier created one.
 *
 * Dropping to the bare-hands profile is better on every axis. It reuses the fallback a *broken* weapon
 * already takes (`weaponFor`), so there is no new arithmetic and no new zero. It costs the armed
 * player exactly what it should — you cannot bring an axe to bear on something that is already inside
 * your reach — which puts the sharpest price of the grab on the player best equipped to pay it. It
 * costs the bare-handed player nothing *extra*, because losing the retreat is already the whole
 * penalty. And against the Riot it leaves T80's arithmetic exactly as T80 shipped it, rather than
 * inventing a new impossibility. The weapon takes no wear while it is not being swung, and the blow
 * deposits **bare hands' noise** rather than the weapon's — which falls out of the same substitution,
 * and is worth stating plainly because it is not always quieter: thrashing at grappling range banks
 * `BARE_NOISE` 15, more than a machete's clean 12 and less than the axe's 30. Being held makes the
 * well-armed quieter and the lightly-armed slightly louder. Declared, not dialled away.
 */
/**
 * What the player actually swings *right now*: what they are holding, or bare hands if the dead have
 * hold of them. The single definition, so the choice label's noise, the damage roll and the wear all
 * agree — a label that quotes the axe's noise for a punch would be a lie the player can measure.
 */
export function weaponInFight(state: GameState): WeaponDef {
  return isGrabbed(state) ? BARE_HANDS : weaponFor(state);
}

/** Breaking free is one beat, the same as a strike — it is a turn you spend not hurting anything. */
export const BREAK_COST = STRIKE_COST;

/**
 * Base chance a break-free attempt gets you loose, plus what each companion fighting beside you adds.
 *
 * 0.55 is a little better than a coin flip, so the expected cost of getting loose is under two turns
 * and the grab reads as a setback rather than a sentence. The companion term is the party's sharpest
 * moment of value in the whole game — *the reason you brought them* — and a full party (+0.15 × 3)
 * gets you out almost every time.
 *
 * Swept by rebuild at 0.35 / 0.45 / 0.55 / 0.70 over 120 bot runs a policy, as the share of runs
 * ending in a Last Stand (a bot that fights everything · a bot that disengages once hurt):
 * **68%/16% · 66%/14% · 64%/8% · 62%/6%.** Note which column it moves: the base barely touches the
 * brawler, who is dying with a grab he never tried to escape, and halves the careful player's risk.
 * It is the dial for *how much a good decision is worth*, which is why it sits above a coin flip.
 */
export const BREAK_BASE = 0.55;
export const BREAK_PER_COMPANION = 0.15;
export const BREAK_MAX = 0.95;

/** Noise a scuffle to get loose deposits — between a swing and a shove. */
export const BREAK_NOISE = 12;

/** Whether the dead currently have hold of the player. Total; absent-reads-as-false. */
export const isGrabbed = (state: GameState): boolean => state.combat?.grabbed === true;

/**
 * The chance a break-free attempt succeeds, given who is fighting beside you. Exported so the harness
 * and the measurement runner can quote the same number the resolver rolls against.
 */
export function breakFreeChance(state: GameState): number {
  const helpers = fightingCompanions(state, state.player.location).length;
  return Math.min(BREAK_MAX, BREAK_BASE + BREAK_PER_COMPANION * helpers);
}

// --- the party in the fight (T82 · FR-NPC-03 remainder · PL-M4-07) ------------------------------

/**
 * A companion's swing: the damage band and the chance it lands at all.
 *
 * Deliberately **weaker than the player's bare hands**: 1–2 damage at a **40%** chance to connect,
 * against the player's guaranteed 1–2. A companion is help, not a second player, and three of them
 * must not turn every fight into a formality. What they mainly buy is not damage — it is
 * {@link COMPANION_SOAK}, and the break-free bonus above.
 */
export const COMPANION_DMG_MIN = 1;
export const COMPANION_DMG_MAX = 2;
export const COMPANION_HIT_CHANCE = 0.4;

/**
 * The chance a landing retaliation lands on **a companion instead of the player**, per companion in
 * the fight — the soak, and the risk term recruiting has never had.
 *
 * This is the trade the task exists to create. Before T82 a companion contributed no damage, soaked
 * nothing and could not be hurt, so recruiting was unambiguously always correct and `PARTY_CAP` was a
 * ceiling rather than a decision. Now the same body that takes the bite for you is the body you can
 * lose, permanently and by name (`fallen.<id>`, the `companion.died` Living-History beat) — and it is
 * *your* fight that killed them.
 *
 * **{@link COMPANION_SOAK_MAX} is the correction the measurement forced, and it matters more than the
 * per-companion rate.** Written the obvious way — 0.3 each, summed, uncapped — a full party absorbed
 * 90% of everything and recruiting became the free win this task exists to remove. Both columns below
 * are 400 duels a cell from `measure/t82.ts --party`; the rejected row is re-derivable by rebuilding
 * with `COMPANION_SOAK = 0.3` and `COMPANION_SOAK_MAX = 0.9`:
 *
 * |                        | solo          | party of 3, 0.3 uncapped | party of 3, **0.2 capped at 0.5** |
 * | ---------------------- | ------------- | ------------------------ | --------------------------------- |
 * | walker, P(hurt)        | 59.8%         | 1.5%                     | **8.8%**                          |
 * | Riot, P(hurt)          | 99.5%         | 19.5%                    | **66.3%**                         |
 * | Riot, P(win)           | 26.0%         | **100.0%**               | **92.3%**                         |
 *
 * A wall of bodies that turns the hardest enemy in the game into a certainty is a power tier, which
 * the GDD forbids for weapons and should equally forbid for people. So the total is capped at half: a
 * companion can take the blow that was coming to you, and a crowd of them cannot take them all. The
 * other half still lands on you, which is what keeps a fight a fight.
 */
export const COMPANION_SOAK = 0.2;
export const COMPANION_SOAK_MAX = 0.5;

/** All party draws go on their own named stream, so a run without a fighting party is unshifted. */
export const PARTY_STREAM = "party";

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

/**
 * The gun that comes up: the **surest** firearm in the pack, ties broken by item id so the choice is
 * total and reproducible. Not the quietest, and the player is not asked — under a body's weight you
 * bring up what you trust, and a menu of three guns for a game that can only hand you one would be
 * three-quarters decoration.
 *
 * **T81 makes this live, and PL-M5-37 with it.** Until T81 the shipped city placed only `item.pistol`,
 * so "the surest gun in the pack" had exactly one answer and the rule was theory (PL-M5-36, now closed:
 * all three firearms are in the police table). Now a player can genuinely carry a pistol and a shotgun,
 * and this brings up the **shotgun** (accuracy 0.85 against 0.75) — the surer gun, and the LOUDER one
 * (85 against 75), with no way to ask for the quiet one. That is a real tactical choice the menu still
 * does not offer; it is recorded rather than smuggled in here, because a gun-selection menu is its own
 * design decision and not this task's. Falls back to the pistol profile when the pack holds a firearm
 * type with no profile at all, so an unknown gun still fires like a gun.
 */
export function firearmFor(player: Player): WeaponDef {
  const held = player.inventory
    .filter((e) => FIREARM_TYPES.has(e.type) && e.quantity > 0)
    .map((e) => WEAPONS[e.type])
    .filter((w): w is WeaponDef => w !== undefined && w.kind === "firearm");
  return surestOf(held) ?? WEAPONS["item.pistol"]!;
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
 * What the player is swinging, as a label suffix — empty for bare hands, so every pre-T80 choice label
 * is unchanged for an empty-handed player (which is every player in the shipped city until the crafting
 * economy mints them a tool).
 *
 * This is where FR-PLR-04 becomes *visible*. A weapon that changes the arithmetic and says nothing is
 * the same invisible stat block the GDD forbids twice over; naming it in the label puts the capability
 * at the point of decision, where the player can act on it, and keeps the numbers off the screen.
 * A **broken** artifact fights as bare hands, and T80 let its suffix simply disappear — "the tell that
 * the thing in your hands has stopped being a weapon". That was defensible while the only breakable
 * thing in the game was a bench-minted tool with fifty swings in it. T81 hands out chair legs with
 * **six**, so a silent disappearance is now a legibility hole rather than a tell: the label would go
 * back to plain "Strike" with nothing to say the axe in your hands snapped. So a broken weapon is
 * NAMED as broken — in words, never as a number (FR-UI-02) — and the repair the economy already ships
 * has something pointing at it. An empty-handed player's label is still exactly the T15 one.
 *
 * A working weapon carries its marks too ({@link artifactMarks}): "worn", "about to go", "it carries
 * the marks now". That is the FR-PLR-04 principle T80 set — capability at the point of decision, with
 * the numbers off the screen — extended to condition, which is the half a found weapon actually has.
 */
function weaponSuffix(state: GameState): string {
  const w = weaponFor(state);
  const item = equippedItem(state);
  if (w.id === BARE_HANDS.id) {
    // Bare hands with something equipped means that something is broken (the only way `weaponFor` falls
    // back while holding a melee artifact). Anything else — truly empty hands, or a firearm in the
    // weapon slot, which is not a melee weapon — keeps the untouched T15 label.
    const held = item === undefined ? undefined : WEAPONS[item.type];
    return item !== undefined && item.durability === 0 && held !== undefined && held.kind === "melee"
      ? ` — the ${held.name} is broken`
      : "";
  }
  return ` with the ${w.name}${marksSuffix(item)}`;
}

/**
 * Choices at a *contested* node (walkers present, no fight yet): fight, fire (if armed), and a
 * stealth "slip away" to every discovered neighbour {@link escapeTargets} still offers. The stealth
 * options are what make the encounter avoidable (FR-CBT-01/05), and there is always at least one of
 * them while the player has a discovered neighbour at all.
 */
export function encounterChoices(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const foe = enemyForNode(state);
  const w = weaponFor(state);
  const choices: SceneChoice[] = [
    { id: "fight", label: `Fight the ${foe.name}${weaponSuffix(state)}`, timeCost: STRIKE_COST,
      action: { type: "fight", choiceId: "fight", timeCost: STRIKE_COST, params: { noise: w.noise } } },
    { id: "heavy", label: `Swing hard at the ${foe.name} (committed, louder)`, timeCost: HEAVY_COST,
      action: { type: "heavy", choiceId: "heavy", timeCost: HEAVY_COST, params: { noise: w.noise * HEAVY_NOISE_MULT } } },
  ];
  if (hasLoadedFirearm(state.player)) {
    const gun = firearmFor(state.player);
    choices.push({ id: "fire", label: "Fire on the walker (loud)", timeCost: FIRE_COST,
      action: { type: "fire", choiceId: "fire", timeCost: FIRE_COST, params: { noise: gun.noise } } });
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

/**
 * Choices *inside* an ongoing fight — the six verbs FR-CBT-02 asks for, finally all present.
 *
 * The requirement's own list is *attack / heavy / aim / push / retreat / hide*, and the mapping is
 * stated here rather than quietly assumed: **attack → strike**, **heavy → heavy**, **aim → fire** (the
 * deliberate, expensive, loud shot), **push → push**, **retreat → retreat**, **hide → slip** (offered
 * one step earlier, at the contested node, because hiding from a fight you are already in is what
 * retreating *is*). Two of the six are therefore renames of verbs this module has had since T15, and
 * the honest count of what T80 adds is **two**: {@link resolveHeavy} and {@link resolvePush}.
 */
export function combatChoices(state: GameState, graph: RegionGraph): readonly SceneChoice[] {
  const w = weaponInFight(state);
  const shoved = state.combat?.offBalance === true;
  const grabbed = isGrabbed(state);
  const choices: SceneChoice[] = [
    // A grabbed player is named as bare-handed rather than quoting a weapon that is doing nothing —
    // the T80/T81 rule that capability belongs at the point of decision, applied to LOSING it. The
    // second clause is only true of a player who is actually carrying something: telling an
    // empty-handed survivor they cannot bring their weapon to bear would be inventing a weapon.
    { id: "strike",
      label: grabbed
        ? (weaponFor(state).id === BARE_HANDS.id ? "Strike at close quarters" : "Strike at close quarters — you cannot bring the weapon to bear")
        : `Strike${weaponSuffix(state)}`,
      timeCost: STRIKE_COST,
      action: { type: "strike", choiceId: "strike", timeCost: STRIKE_COST, params: { noise: w.noise } } },
    { id: "heavy", label: "Swing hard (committed, louder)", timeCost: HEAVY_COST,
      action: { type: "heavy", choiceId: "heavy", timeCost: HEAVY_COST, params: { noise: w.noise * HEAVY_NOISE_MULT } } },
  ];
  // T82: you cannot shove away what already has hold of you — that is what BREAK FREE is for, and
  // offering both would be two verbs for one situation with no way to tell them apart.
  if (grabbed) {
    choices.push({ id: "break", label: "Tear yourself loose", timeCost: BREAK_COST,
      action: { type: "break", choiceId: "break", timeCost: BREAK_COST, params: { noise: BREAK_NOISE } } });
  } else if (!shoved) {
    // The shove is only worth offering while there is still something to shove: once it is already off
    // balance, a second push would spend an hour to re-buy an effect the player already holds.
    choices.push({ id: "push", label: "Shove it back and make room", timeCost: PUSH_COST,
      action: { type: "push", choiceId: "push", timeCost: PUSH_COST, params: { noise: PUSH_NOISE } } });
  }
  if (hasLoadedFirearm(state.player)) {
    const gun = firearmFor(state.player);
    choices.push({ id: "fire", label: grabbed ? "Fire point blank (loud)" : "Fire (loud)", timeCost: FIRE_COST,
      action: { type: "fire", choiceId: "fire", timeCost: FIRE_COST, params: { noise: gun.noise } } });
  }
  // **The retreat offers are withheld while the dead have hold of you, and that is the single change
  // in this module that makes a run losable in a fight.** FR-CBT-05's "you always get out" is a
  // promise about the *stealth path* — `slip`, offered at a contested node before any fight exists,
  // and untouched here — not about walking out of a fight mid-grapple. A player who never chooses to
  // fight can still cross the whole city without one of these ever being withheld from them.
  if (!grabbed) {
    for (const to of escapeTargets(state, graph)) {
      const name = graph.nodes[to]?.name ?? to;
      const cost = RETREAT_COST + escapeExtraCost(state, to);
      choices.push({ id: `retreat:${to}`, label: `Retreat toward ${name}${escapeRoadSuffix(state, to)}`, timeCost: cost,
        action: { type: "retreat", choiceId: `retreat:${to}`, timeCost: cost, params: { to, noise: SLIP_NOISE } } });
    }
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

/**
 * Wound a companion and, if that body has now taken all it can, kill them — permanently, by name.
 *
 * The fatal read is {@link COMPANION_FATAL_BURDEN} against their *untreated* burden, which is the same
 * number the player's own systems read, so "she is hurt badly" means the same thing about a companion
 * as it does about you. Death routes through {@link killCompanion}, so the `fallen.<id>` flag and the
 * `companion.died` Living-History beat that module has always promised finally have a trigger.
 */
function woundCompanion(state: GameState, id: ActorId, type: ContentId, severity: number, site: string): GameState {
  const c = state.actors[id];
  if (c === undefined) return state;
  const condition = inflictNamedWound(c.condition, type, severity, site, state.meta.day, state.meta.hour);
  const hurt: GameState = { ...state, actors: { ...state.actors, [id]: { ...c, condition } } };
  return woundBurden(condition) >= COMPANION_FATAL_BURDEN ? killCompanion(hurt, id) : hurt;
}

/**
 * An alerted dead answers an exchange — a coin-ish flip, every time if it has initiative, always after
 * a committed swing, and a quarter of the time when it is answering a shot ({@link retaliateChance}).
 * The draw is taken either way, so a miss costs the same RNG as a hit and the stream stays predictable.
 *
 * **T82 adds two consequences to a blow that was already landing, and spends no extra `combat` draw on
 * either.** The single float this function has always drawn is now read as three outcomes rather than
 * two, by partitioning the interval it was already being compared against:
 *
 * ```
 *  0                       chance*GRAB_CHANCE            chance                         1
 *  |---------- lands, AND GETS HOLD ----|------ lands ------|--------- misses ----------|
 * ```
 *
 * So the `combat` stream advances exactly as it did before this task — same draws, same order, same
 * numbers — and the retaliation *rate* is untouched; only what a third of the landing blows now mean
 * has changed. That is what keeps every T15–T81 combat measurement comparable across the change.
 *
 * The second consequence is **who it lands on**. With companions in the fight the blow may find one of
 * them instead ({@link COMPANION_SOAK} each) — the soak that is the party's whole payload, and the
 * risk term recruiting has never carried. That choice *does* cost a draw, but it is taken on the
 * {@link PARTY_STREAM}, which no pre-T82 run ever touches: a player fighting alone is byte-identical
 * here, and that is tested.
 */
function enemyRetaliate(state: GameState, def: EnemyDef, w: WeaponDef, heavy = false): GameState {
  const chance = retaliateChance(RETALIATE_BASE, w, { initiative: def.initiative, heavy });
  const hit = drawFloat(state.rng, state.meta.seed, "combat");
  if (hit.value >= chance) {
    return { ...state, rng: hit.rng }; // a miss — but the draw was still consumed (deterministic)
  }
  const pick = drawPick(hit.rng, state.meta.seed, "combat", WALKER_WOUNDS);
  let next: GameState = { ...state, rng: pick.rng };

  // Who is standing in the way. Nobody ⇒ the pre-T82 path exactly, with no party draw taken.
  const helpers = fightingCompanions(next, next.player.location);
  let shielded: Survivor | null = null;
  if (helpers.length > 0) {
    const roll = drawFloat(next.rng, next.meta.seed, PARTY_STREAM);
    next = { ...next, rng: roll.rng };
    const soak = Math.min(COMPANION_SOAK_MAX, COMPANION_SOAK * helpers.length);
    if (roll.value < soak) {
      // Which one takes it — index off the same roll, rescaled, so stepping in costs one draw, not two.
      const idx = Math.min(helpers.length - 1, Math.floor((roll.value / Math.max(soak, Number.EPSILON)) * helpers.length));
      shielded = helpers[idx] ?? null;
    }
  }
  if (shielded !== null) {
    return woundCompanion(next, shielded.id, pick.value.type, pick.value.severity, "arm");
  }

  const condition = inflictNamedWound(next.player.condition, pick.value.type, pick.value.severity, "arm", next.meta.day, next.meta.hour);
  // The grab: the bottom GRAB_CHANCE of the interval this blow already landed in. A blow that kills the
  // fight outright cannot grab — `killEnemy` clears `combat` before this runs on the heavy path, and a
  // null fight has nothing to hold you.
  const grabbed = next.combat !== null && hit.value < chance * GRAB_CHANCE;
  const combat = next.combat === null ? null : { ...next.combat, ...(grabbed ? { grabbed: true } : {}) };
  return { ...next, combat, player: { ...next.player, condition } };
}

/**
 * The party's own swings, resolved after the player's, one draw each on the {@link PARTY_STREAM}.
 *
 * Taken **only while the fight is still live** — a companion does not swing at a body that is already
 * down — and only by companions {@link fightingCompanions} says are in it. With no such companion this
 * is a total no-op that takes no draw, which is the property that keeps a solo run byte-identical.
 */
function companionsStrike(state: GameState, def: EnemyDef): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  const helpers = fightingCompanions(state, state.player.location);
  if (helpers.length === 0) return state;
  let next = state;
  let hp = combat.hp;
  for (const c of helpers) {
    if (hp <= 0) break;
    const swing = drawFloat(next.rng, next.meta.seed, PARTY_STREAM);
    next = { ...next, rng: swing.rng };
    if (swing.value >= COMPANION_HIT_CHANCE) continue;
    const dmg = drawInt(next.rng, next.meta.seed, PARTY_STREAM, COMPANION_DMG_MIN, COMPANION_DMG_MAX);
    next = { ...next, rng: dmg.rng };
    // A companion swings with whatever they have; they never pierce the Riot's plate, which is what
    // keeps the armored dead a weapon-selection problem (T80) rather than a party-size problem.
    hp -= effectiveDamage(dmg.value, def.armor, 0);
  }
  if (hp === combat.hp) return next;
  if (hp <= 0) return killEnemy(next, def);
  return { ...next, combat: { ...combat, hp, alerted: true } };
}

/**
 * Roll one blow's damage off the weapon profile. A **flat** weapon (`dmgMin === dmgMax`, which is every
 * firearm) takes no draw at all — the shot's arithmetic stays the single sentence it has always been,
 * and the `combat` stream keeps the shape a shot has had since T15.
 */
function rollDamage(state: GameState, w: WeaponDef): { readonly value: number; readonly state: GameState } {
  if (w.dmgMin >= w.dmgMax) return { value: w.dmgMin, state };
  const d = drawInt(state.rng, state.meta.seed, "combat", w.dmgMin, w.dmgMax);
  return { value: d.value, state: { ...state, rng: d.rng } };
}

/**
 * Resolve one melee blow on the active fight against **what the player is holding** (T80): the weapon's
 * own damage band, less whatever armor its `armorPierce` could not get through, then its own durability
 * cost, then the enemy's answer at the weapon's own rate if it is still up.
 *
 * `heavy` is the committed swing: {@link HEAVY_DMG_MULT}× the damage, {@link HEAVY_WEAR_MULT}× the wear
 * (paid by the same choice that doubles the noise in the action's params), and an answer from the enemy
 * **whatever happens**, including the swing that kills it.
 *
 * **That last clause is a correction the measurement forced, and the brief did not ask for it.** Written
 * the obvious way — "guaranteed retaliation", i.e. the enemy always answers *if it is still up* — HEAVY
 * came out **strictly dominant**, which is the exact defect this task exists to remove, reintroduced by
 * its own fix. Measured over 3000 duels a side, bare-handed against a walker: `heavy` 1.49h and 49.4%
 * wounded, against `strike`'s 2.25h and 56.8% — faster *and* safer, on every enemy in the table, because
 * double damage kills so often that the guarantee almost never got to fire (against a Crawler it never
 * fired at all: 1.00h, 0.0% wounded). A guarantee you escape by winning is not a cost. So the answer is
 * unconditional: you committed, and it had hold of you as it fell.
 *
 * Bare-handed and ordinary, this is byte-for-byte the pre-T80 strike: `drawInt(1, 2)`, minus armor, a
 * coin-flip answer, no wear. That is the property that keeps every T15 melee measurement meaningful.
 */
function resolveStrike(state: GameState, heavy = false): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  const def = ENEMIES[combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
  // T82: {@link weaponInFight}, not `weaponFor` — something holding you fights you bare-handed,
  // whatever is in your pack. Note this also picks the retaliation rate and the wear below, which is
  // the point: none of the weapon is working for you right now.
  const w = weaponInFight(state);
  const rolled = rollDamage(state, w);
  const swing = heavy ? rolled.value * HEAVY_DMG_MULT : rolled.value;
  const dealt = effectiveDamage(swing, def.armor, w.armorPierce);
  const hp = combat.hp - dealt;
  // A melee strike wears an equipped durability artifact (T51 · FR-ECO-07 — the safety-loop sink, and the
  // reason to repair rather than replace). Inert for bare hands (durabilityCost 0) and on every run that
  // never mints an artifact, so this passes the state through unchanged exactly as it always did.
  const withRng = wearWeaponOnStrike(rolled.state, w.durabilityCost * (heavy ? HEAVY_WEAR_MULT : 1));
  // A committed swing is answered EVEN WHEN IT LANDS THE KILL — you are inside its reach and it gets a
  // hand on you as it goes down. See {@link resolveHeavyIsAnswered} for why that is not flavour.
  if (hp <= 0) {
    const down = killEnemy(withRng, def);
    return heavy ? enemyRetaliate(down, def, w, true) : down;
  }
  const bruised: GameState = { ...withRng, combat: { ...combat, hp, alerted: true, offBalance: false } };
  // The party swings before the answer comes — they are in the exchange, not after it, so a companion
  // can be the one who finishes it.
  const afterParty = companionsStrike(bruised, def);
  // …and if they DID finish it, nothing answers. The audit caught the first cut retaliating
  // unconditionally here: a companion's killing blow cleared `combat` and removed the body from the
  // roster, and the corpse then took a `combat` draw and landed a wound anyway — on 15% of party kill
  // turns, and it was the only path in the module by which a `wound.bite` and its infection clock
  // could come from something already dead. The heavy path's "answered even when it dies" rule below
  // is deliberate and stays, because that one is about YOUR committed swing putting you inside its
  // reach; it was never a licence for a de-rostered enemy to answer somebody else's kill.
  if (afterParty.combat === null) return afterParty;
  return enemyRetaliate(afterParty, def, w, heavy);
}

/**
 * Resolve a shot — and, since T80, **a shot that can miss**.
 *
 * Three things happen in order, and only the first is new: an accuracy roll off the firearm's own
 * profile decides whether the round finds anything; a hit deals the profile's flat damage through
 * whatever armor its pierce ignores (3, i.e. all of it — the pre-T80 "armor never reduces a shot",
 * unchanged); and a shot that leaves the body standing gets answered a quarter of the time.
 *
 * The round, the hour and the 75 points of noise are spent **either way**. That is the point: the
 * failure mode of a firearm in this game is not "you wasted a bullet", it is "you have announced
 * yourself to the whole region and it is still coming".
 */
function resolveFire(state: GameState): GameState {
  const started = state.combat === null ? beginCombat(state) : state;
  const combat = started.combat!;
  const def = ENEMIES[combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
  const w = firearmFor(started.player);
  const player = spendAmmo(started.player);
  let next: GameState = { ...started, player };
  let landed = true;
  if (w.accuracy < 1) {
    const shot = drawFloat(next.rng, next.meta.seed, "combat");
    landed = shot.value < w.accuracy;
    next = { ...next, rng: shot.rng };
  }
  const rolled = landed ? rollDamage(next, w) : { value: 0, state: next };
  next = rolled.state;
  const hp = combat.hp - (landed ? effectiveDamage(rolled.value, def.armor, w.armorPierce) : 0);
  if (hp <= 0) return killEnemy(next, def);
  const standing: GameState = { ...next, combat: { ...combat, hp, alerted: true, offBalance: false } };
  return enemyRetaliate(standing, def, w);
}

/**
 * Resolve a shove: no damage, no answer, no draw — the enemy goes back on its heels and stays there
 * until the next thing that happens to it.
 *
 * It clears `alerted` and sets `offBalance`, and the pair is worth `ALERTED_DETECT` 15 +
 * {@link PUSH_ESCAPE_BONUS} 30 = **45 points off the very next escape roll**. So the verb is not a
 * damage option at all; it is the answer to *this fight is going badly and I need to leave cleanly*,
 * which before T80 had no answer but a retreat at the full alerted rate. Both halves are consumed by
 * the next combat action of any kind, so it cannot be banked.
 *
 * Unreachable outside a live fight (it is offered only by {@link combatChoices}); with no fight it is a
 * total no-op that still spends its hour, which is the same shape every other misrouted action has.
 */
function resolvePush(state: GameState): GameState {
  const combat = state.combat;
  if (combat === null) return state;
  return { ...state, combat: { ...combat, alerted: false, offBalance: true } };
}

/**
 * Resolve a break-free attempt: one beat spent on nothing but getting loose, at
 * {@link breakFreeChance} — better the more of your people are in it with you.
 *
 * **A failed attempt is answered; a successful one is not.** That asymmetry is the verb's entire
 * price, and the first cut of this function did not have it — it took its roll and returned, which
 * made BREAK a *free* action: measured over 400 seeded Riot fights, a break turn wounded the player
 * **0 times** where a strike taken in the same position wounded them **212 times**. A verb that costs
 * an hour and carries no risk at all is strictly better than every other verb on the menu for any
 * player not trying to land the kill, so the grab — the one mechanic in this task that is supposed to
 * corner you — came with a free exit. That is the *same* defect T80 found in its own first cut of
 * HEAVY, from the other direction, and the same rule closes it: an option that escapes its own cost
 * by succeeding is not a cost.
 *
 * So: you thrash, and if you do not get clear it gets a better hold on you than it had. Getting clear
 * costs nothing extra, because you are out of its reach by the time it answers. The result is a real
 * gamble against {@link breakFreeChance} rather than a dominant button, and it is the path by which a
 * grabbed player's burden climbs toward {@link LAST_STAND_AT} while they are trying to escape it.
 *
 * Unreachable outside a live grab ({@link combatChoices} offers it nowhere else); called on a state
 * that is not grabbed it is a total no-op that still spends its hour, the same shape every other
 * misrouted action has.
 */
function resolveBreak(state: GameState): GameState {
  const combat = state.combat;
  if (combat === null || combat.grabbed !== true) return state;
  const roll = drawFloat(state.rng, state.meta.seed, "combat");
  const next: GameState = { ...state, rng: roll.rng };
  if (roll.value >= breakFreeChance(next)) {
    // Still held. Answered at the bare-hands rate, because a player wrestling is not using a weapon —
    // the same substitution {@link weaponInFight} makes for the strike, for the same reason.
    const def = ENEMIES[combat.enemy] ?? ENEMIES[WALKER_ENEMY]!;
    return enemyRetaliate(next, def, BARE_HANDS);
  }
  // Loose. `grabbed` is dropped from the record rather than set false, so a fight that was never
  // grabbed and one the player has escaped serialize identically — the absent-reads-as-false shape.
  const { grabbed: _dropped, ...free } = combat;
  return { ...next, combat: free };
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
  // T80: a body you have just shoved back is not in a position to catch you. Like `alerted`, it counts
  // only on a retreat — a slip happens before any fight exists, so there is nothing shoved to run from.
  const shoved = clearCombat && state.combat?.offBalance === true;
  const extra = (grasp !== null ? GRASP_ESCAPE_BONUS : 0) - (shoved ? PUSH_ESCAPE_BONUS : 0);
  const chance = stealthDetectChance(state, base, {
    ...(alerted ? { alerted: true } : {}),
    ...(extra !== 0 ? { extra } : {}),
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
    // A committed swing opens a fight the same way `fight` does — you can choose to start hard.
    case "heavy":
      return resolveStrike(state.combat === null ? beginCombat(state) : state, true);
    case "push":
      return resolvePush(state);
    case "break":
      return resolveBreak(state);
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
  return action.type === "fight" || action.type === "strike" || action.type === "heavy" ||
    action.type === "push" || action.type === "break" || action.type === "fire" ||
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
 * The T80 signpost for a shoved enemy, in the same "signpost, don't retune" spirit as T77's stealth
 * tell: PUSH spends an hour and deals no damage, so a player who is not told what it bought would
 * reasonably conclude it bought nothing. Empty whenever nothing is off balance, which is every fight
 * in the game that does not use the verb — so no existing transcript changes.
 */
function shovedTell(state: GameState): string {
  return state.combat?.offBalance === true ? " You have it back on its heels — this is the moment to go." : "";
}

/**
 * The T82 signpost: being grabbed takes the player's escape options away, and a choice list that
 * quietly loses three entries is a bug from the player's side unless something says why.
 *
 * Same "signpost, don't retune" rule T77 and T80 followed. Empty whenever nothing has hold of you,
 * which is every fight in the game that never grabs — so no existing transcript changes.
 */
function grabbedTell(state: GameState): string {
  if (!isGrabbed(state)) return "";
  const helpers = fightingCompanions(state, state.player.location);
  const hands =
    helpers.length === 0 ? ""
    : helpers.length === 1 ? ` ${companionName(helpers[0]!)} has hold of your jacket.`
    : ` ${companionName(helpers[0]!)} and the others are trying to haul you out.`;
  return ` It has you — there is no backing out of this one until you are loose.${hands}`;
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
    const shoved = shovedTell(state);
    const held = grabbedTell(state);
    if (def.id === WALKER_ENEMY) {
      return `You are in it now — a walker, ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}${shoved}${held}${tell}`;
    }
    return `You are in it now — a ${def.name}, ${def.signature}; ${state.combat.hp}/${state.combat.maxHp} still standing.${hurt}${shoved}${held}${tell}`;
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
