/**
 * What is in your hands — the weapon profile layer (M5 task T80 · FR-CBT-04 · FR-PLR-04).
 *
 * Until this task the engine had an equipped-weapon slot that could not change a fight. `resolveStrike`
 * rolled `drawInt(1, 2)` and subtracted the enemy's armor, *regardless of what the player was holding*;
 * the equipped artifact's only effect anywhere in combat was `wearWeaponOnStrike` taking two points of
 * durability off it, and a weapon worn down to 0 fought exactly as well as a fresh one. So the game's
 * one stated progression axis — **"equipment defines capability; growth comes from gear, not levels"**
 * (FR-PLR-04, and the reason XP is forbidden twice in the GDD) — was inverted: equipment defined a
 * *maintenance cost* and nothing else.
 *
 * This module is the peer of `EnemyDef`. An enemy says what it takes to put down; a {@link WeaponDef}
 * says what you can bring to that. The two meet in exactly two pure functions, {@link effectiveDamage}
 * and {@link retaliateChance}, and `combat.ts` does the state transitions around them.
 *
 * ### The fields, and why each one is a trade rather than a number
 *
 *   - **dmgMin/dmgMax** — the swing. `min === max` is a *flat* weapon and draws no RNG at all (every
 *     firearm is one), which is what keeps a shot's arithmetic the single sentence it has always been.
 *   - **noise** — the T14 deposit. This is the weapon's real price: `FIRE_NOISE` 75 against
 *     `MELEE_NOISE` 15 is the loud-solves-one-problem-and-announces-you tension, and since T75/T76 it
 *     is the term that decides what walks toward you afterwards.
 *   - **armorPierce** — points of the enemy's armor this ignores. Firearms carry enough (3) to ignore
 *     every armor value in the game, which is *exactly* the rule `resolveFire` hard-coded before this
 *     table existed ("armor never reduces a shot"); the difference is that armor is now a number a
 *     melee weapon can also answer, so the Riot stops being a firearm gate and becomes a
 *     weapon-selection problem.
 *   - **durabilityCost** — points off the equipped artifact per swing (the FR-ECO-07 repair loop's
 *     drain). Zero for bare hands and for firearms, which are inventory stacks, not tracked artifacts.
 *   - **retaliateModifier** — percentage points added to the enemy's answer chance. A weapon with
 *     reach keeps it off you (negative); a short, wild one does not.
 *   - **accuracy** — the chance the blow lands at all, and the answer to *"firing is mathematically
 *     incapable of hurting you"*. `1` means it always lands and **draws nothing**, so every melee
 *     profile in the shipped game costs the same RNG it always did.
 *
 * ### Two honest notes
 *
 * **The table is nearly empty and that is T81's problem, not a hidden one.** The complete weapon roster
 * in the build is `item.pistol`, `item.rifle`, `item.shotgun` and `item.molotov` (which has no combat
 * action at all — PL-M4-30, still open). There are **no melee weapons in the game**: the only entry
 * below that a player can actually come to hold is {@link WEAPON_BARE} and the one artifact the
 * crafting economy mints, `item.tool-reinforced`. This module is the socket T81 plugs the axe into.
 *
 * **Only the pistol is reachable.** `item.rifle` and `item.shotgun` appear in no loot table, no
 * encounter and no start kit (`sim/loot.ts` lists `item.pistol` alone, in the police table), so their
 * rows here are authored-but-unreachable content on the shipped city — recorded as PL-M5-36 rather
 * than quietly presented as a measured three-way trade.
 *
 * Pure, deterministic, dependency-free, integer-only where it counts (ADR-0001).
 */

import type { ContentId, GameState, ItemInstance } from "../state/types.js";
import { WEAPON_SLOT } from "../sim/economy.js";

/** Melee noise floor — bare hands, and the deposit `MELEE_NOISE` has always meant. */
export const BARE_NOISE = 15;
/** The pistol's bang: the `FIRE_NOISE` every firearm test has pinned since T15. */
export const PISTOL_NOISE = 75;

/** The id of the profile you fight with when you hold nothing — or hold something broken. */
export const WEAPON_BARE: ContentId = "weapon.bare";

/** What a weapon does to a fight. The peer of `EnemyDef`; see the module header for each field. */
export interface WeaponDef {
  /** Item type id this profile belongs to, or {@link WEAPON_BARE}. */
  readonly id: ContentId;
  /** Player-facing name, used in choice labels ("Strike with the reinforced tool"). */
  readonly name: string;
  readonly kind: "melee" | "firearm";
  readonly dmgMin: number;
  readonly dmgMax: number;
  /** T14 noise deposited by one blow with it. */
  readonly noise: number;
  /** Points of enemy armor this ignores. */
  readonly armorPierce: number;
  /** Durability spent per blow by the equipped artifact (0 = nothing to wear). */
  readonly durabilityCost: number;
  /** Percentage points added to the enemy's answer chance; negative = it keeps them off you. */
  readonly retaliateModifier: number;
  /** Chance the blow lands. Exactly 1 ⇒ it always lands and no draw is taken. */
  readonly accuracy: number;
}

const weapon = (d: Partial<WeaponDef> & { id: ContentId; name: string; kind: WeaponDef["kind"]; dmgMin: number; dmgMax: number; noise: number }): WeaponDef => ({
  armorPierce: 0,
  durabilityCost: 0,
  retaliateModifier: 0,
  accuracy: 1,
  ...d,
});

/**
 * The authoritative weapon dials. Keyed by **item type**, so an artifact instance and a plain stack of
 * the same type fight identically — what is tracked per instance is condition and provenance, never
 * capability (Principle 6: identical items are not interchangeable because of their *history*).
 *
 * `weapon.bare` is deliberately the pre-T80 melee profile *exactly* — `drawInt(1, 2)`, `MELEE_NOISE`,
 * no pierce, no wear, no modifier — so an empty-handed player's fight arithmetic is unchanged by this
 * task, and every T15 melee measurement still reads what it read.
 */
export const WEAPONS: { readonly [id: ContentId]: WeaponDef } = {
  [WEAPON_BARE]: weapon({ id: WEAPON_BARE, name: "bare hands", kind: "melee", dmgMin: 1, dmgMax: 2, noise: BARE_NOISE }),

  // The one artifact the crafting economy can mint (recipe.weapon.reinforce-tool). Heavier and longer
  // than a fist: it hits harder, bites through a riot plate, keeps the dead a half-step further away —
  // and it is the thing that wears out, which is the whole point of the repair ledger it carries.
  "item.tool-reinforced": weapon({
    id: "item.tool-reinforced", name: "reinforced tool", kind: "melee",
    dmgMin: 2, dmgMax: 3, noise: 20, armorPierce: 1, durabilityCost: 2, retaliateModifier: -10,
  }),

  // Firearms. Flat 3 damage (the pre-T80 `FIRE_DMG`), enough pierce to ignore any armor in the game,
  // and an accuracy under 1 — the term this task exists to add. The trade between them is
  // accuracy / noise / how well they handle with a body already on top of you.
  "item.pistol": weapon({ id: "item.pistol", name: "pistol", kind: "firearm", dmgMin: 3, dmgMax: 3, noise: PISTOL_NOISE, armorPierce: 3, accuracy: 0.75 }),
  "item.shotgun": weapon({ id: "item.shotgun", name: "shotgun", kind: "firearm", dmgMin: 3, dmgMax: 3, noise: 85, armorPierce: 3, accuracy: 0.85, retaliateModifier: -10 }),
  "item.rifle": weapon({ id: "item.rifle", name: "rifle", kind: "firearm", dmgMin: 3, dmgMax: 3, noise: 95, armorPierce: 3, accuracy: 0.8, retaliateModifier: 10 }),
};

/** The bare-hands profile — the fallback for nothing held, an unknown type, and a broken artifact. */
export const BARE_HANDS: WeaponDef = WEAPONS[WEAPON_BARE]!;

/**
 * The surest of a set of profiles — highest `accuracy`, ties broken by id so the answer never depends on
 * the order a pack happens to be in. Split out of {@link firearmFor} because a tie is unreachable with
 * the five rows shipped today (no two share an accuracy), and an unreachable rule that cannot be tested
 * is a rule that quietly rots; here a test can hand it a constructed tie. Returns undefined for an empty
 * set, which is the caller's business, not this function's.
 */
export function surestOf(profiles: readonly WeaponDef[]): WeaponDef | undefined {
  let best: WeaponDef | undefined;
  for (const w of profiles) {
    if (best === undefined || w.accuracy > best.accuracy || (w.accuracy === best.accuracy && w.id < best.id)) best = w;
  }
  return best;
}

/** The profile for an item type, or bare hands when the type has none (all but five items in the game). */
export function weaponProfile(type: ContentId | undefined): WeaponDef {
  if (type === undefined) return BARE_HANDS;
  const def = WEAPONS[type];
  return def !== undefined && def.kind === "melee" ? def : BARE_HANDS;
}

/**
 * The melee profile the player is currently fighting with.
 *
 * **A broken weapon is bare hands.** `durability === 0` drops to {@link BARE_HANDS} — the design
 * review's "a broken weapon carries no combat penalty" closed at its root rather than with a separate
 * penalty term, because a snapped haft is not a worse axe, it is no axe. `durability === null` (an item
 * with no durability track at all) keeps its profile: not everything that can be swung wears out on a
 * counter. An equipped *firearm* also reads as bare hands here, because this is the melee question —
 * pistol-whipping is not a verb the game offers (PL-M5-37).
 */
export function weaponFor(state: GameState): WeaponDef {
  const id = state.player.equipment[WEAPON_SLOT];
  if (id === undefined) return BARE_HANDS;
  const item: ItemInstance | undefined = state.items[id];
  if (item === undefined) return BARE_HANDS;
  if (item.durability === 0) return BARE_HANDS;
  return weaponProfile(item.type);
}

/**
 * Damage that actually lands: the swing, less whatever armor the weapon could not get through.
 *
 * Both pre-T80 rules survive this exactly. Bare hands against the Riot is `dmg − 1` (pierce 0), the old
 * `Math.max(0, dmg - def.armor)`; a firearm against the Riot is the full 3 (pierce 3 ≥ armor 1), the
 * old "armor never reduces a shot". What is new is the middle: a melee weapon with pierce 1 now answers
 * riot plate, which is the sentence the design review asked for.
 */
export function effectiveDamage(dmg: number, armor: number, armorPierce: number): number {
  const through = Math.max(0, armor - armorPierce);
  return Math.max(0, dmg - through);
}

/** Clamp a probability to [0, 1], reading NaN as 0 (it carries no direction). */
const clamp01 = (n: number): number => (Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n)));

/**
 * How often the enemy answers a blow of this kind.
 *
 * Three rules, in priority order, and the first two are absolute on purpose:
 *
 *   1. **A committed swing is always answered.** A heavy attack is the player choosing to be open for
 *      one beat; taking that away would make it a free damage multiplier.
 *   2. **A fast dead answers everything.** `EnemyDef.initiative` is the Fresh's whole character and its
 *      printed signature says so — *"it answers every blow"*. No weapon modifier may make that prose a
 *      lie, so initiative is read as a floor, not as a term.
 *   3. Otherwise: the base for the kind (melee `MELEE_RETALIATE_CHANCE`, a shot `FIRE_RETALIATE_CHANCE`
 *      — a firearm kept it at arm's length) shifted by the weapon's own `retaliateModifier`.
 */
export function retaliateChance(
  base: { readonly melee: number; readonly firearm: number },
  w: WeaponDef,
  opts: { readonly initiative: boolean; readonly heavy: boolean },
): number {
  if (opts.heavy || opts.initiative) return 1;
  const b = w.kind === "firearm" ? base.firearm : base.melee;
  return clamp01(b + w.retaliateModifier / 100);
}
