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
 * ### The roster, and the two fields T81 added (M5 task T81 · FR-CBT-04)
 *
 * T80 shipped this socket with **two melee rows** — bare hands and the one artifact the crafting
 * economy mints — and said so: *"the table is nearly empty and that is T81's problem."* It was worse
 * than a content gap. Measured on the pre-T81 tree (`measure/t81.ts --play`, 30 scavenging runs on the
 * shipped city), **0 of 30 runs ever held a melee weapon and 0 of 316 combat turns were fought armed**,
 * because no melee weapon appeared in any loot table *and there was no equip verb anywhere in the
 * engine* — `equipment[WEAPON_SLOT]` was written in exactly one place, the craft mint. So the one
 * progression axis the GDD allows (FR-PLR-04; XP is forbidden twice) was not merely thin, it was
 * unreachable by playing.
 *
 * T81 ships the GDD Part IX categories — **improvised** (fragile, weak, quiet), **bladed** (reliable,
 * quiet, wears), **blunt** (forgiving, durable, some noise) — against the same dials, and adds the two
 * fields that make a row reachable rather than authored:
 *
 *   - **startDurability** — what a *found* one arrives at, and `null` for a profile with no artifact
 *     behind it (bare hands; a firearm, which is an ammunition-fed stack, not a tracked artifact).
 *   - **lootWeight / lootKinds** — where this weapon is found and how rare it is, read by `sim/loot.ts`
 *     as a **weighted** draw against {@link BASE_LOOT_WEIGHT}. Authoring rarity here rather than in the
 *     loot module keeps one row per weapon: its dials and its scarcity are the same decision.
 *
 * **Damage buys noise — per BLOW. Per KILL it does the opposite, and that is a measured surprise.**
 * GDD Part IX: *"weapons are tools with trade-offs, not power tiers."* Every row below is checked
 * against every other by `measure/t81.ts` (and by a test): no melee profile may be at least as good as
 * another on **all** of damage, noise, wear, retaliation, pierce, durability and carry weight. That
 * holds. What does *not* hold is the conclusion it invites. Noise is deposited **per swing**, so a
 * weapon that ends a fight in fewer swings deposits less of it: measured over 3000 duels a cell, putting
 * a walker down with the firefighter's axe (noise 30, one blow) banks **30.0** points, and doing it
 * bare-handed (noise 15, E[2.26] blows) banks **33.9**. Against a Riot the gap is a chasm — **49.7**
 * against bare hands' **151.3**. So *arming yourself makes the city quieter*, and the axe's real price
 * is not the sound of it: it is rarity (found by 32% of runs that strip every police node in the city),
 * carry weight 8 — a fifth of the whole pack — and 33 swings before it needs a bench. Recorded as
 * PL-M5-40 rather than dialled away here: if noise is meant to price power, the deposit has to scale
 * with the damage dealt rather than with the swing, and that is a balance-pass decision (T59/T60).
 *
 * Pure, deterministic, dependency-free, integer-only where it counts (ADR-0001).
 */

import type { ContentId, GameState, ItemInstance, JsonValue } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import { WEAPON_SLOT } from "../sim/economy.js";

/** Melee noise floor — bare hands, and the deposit `MELEE_NOISE` has always meant. */
export const BARE_NOISE = 15;
/** The pistol's bang: the `FIRE_NOISE` every firearm test has pinned since T15. */
export const PISTOL_NOISE = 75;

/** The id of the profile you fight with when you hold nothing — or hold something broken. */
export const WEAPON_BARE: ContentId = "weapon.bare";

/** The GDD Part IX weapon families. `explosive` is authored-for but unshipped (PL-M4-30, molotov). */
export type WeaponCategory = "improvised" | "bladed" | "blunt" | "firearm";

/** What a weapon does to a fight. The peer of `EnemyDef`; see the module header for each field. */
export interface WeaponDef {
  /** Item type id this profile belongs to, or {@link WEAPON_BARE}. */
  readonly id: ContentId;
  /** Player-facing name, used in choice labels ("Strike with the reinforced tool"). */
  readonly name: string;
  /** How the fight resolves it. `melee` swings; `firearm` spends a round. */
  readonly kind: "melee" | "firearm";
  /** The GDD family, which is what the trade-offs below are authored *as* (T81). */
  readonly category: WeaponCategory;
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
  /**
   * Durability a **found** one arrives at (T81), and the tell that this profile has a tracked artifact
   * behind it at all. `null` ⇒ no artifact: bare hands, and every firearm (an ammunition-fed stack that
   * the pack carries by type, never an `ItemInstance`). A weapon with a track wears by
   * {@link WeaponDef.durabilityCost} per blow, falls to bare hands at 0, and is what `recipe.repair.tool`
   * restores — the FR-ECO-07 repair-over-replace loop, which until T81 had exactly one artifact to run on.
   */
  readonly startDurability: number | null;
  /**
   * Rarity in the weighted loot draw, against {@link BASE_LOOT_WEIGHT} for an ordinary item. `0` ⇒ this
   * profile is never placed by loot (bare hands; the crafted tool, which the bench mints instead).
   */
  readonly lootWeight: number;
  /** Node kinds whose search can turn this up (`sim/loot.ts` kinds). Empty ⇒ nowhere. */
  readonly lootKinds: readonly string[];
}

/**
 * Weight of an ORDINARY loot-table entry once the weapon content set is registered — the denominator
 * every {@link WeaponDef.lootWeight} is read against. Chosen by sweep, not by taste: see
 * `docs/qa/QA_REVIEW_T81.md` §4 for the 12/18/24/36 table and what each does to "how long until the
 * player holds anything at all".
 */
export const BASE_LOOT_WEIGHT = 18;

const weapon = (
  d: Partial<WeaponDef> & { id: ContentId; name: string; kind: WeaponDef["kind"]; category: WeaponCategory; dmgMin: number; dmgMax: number; noise: number },
): WeaponDef => ({
  armorPierce: 0,
  durabilityCost: 0,
  retaliateModifier: 0,
  accuracy: 1,
  startDurability: null,
  lootWeight: 0,
  lootKinds: [],
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
  [WEAPON_BARE]: weapon({ id: WEAPON_BARE, name: "bare hands", kind: "melee", category: "improvised", dmgMin: 1, dmgMax: 2, noise: BARE_NOISE }),

  // --- improvised: "everywhere, fragile, weak, silent-ish" (GDD IX) -------------------------------
  // The commonest things in the table and the worst, which is the point: the first thing you pick up
  // is barely better than your hands, and it breaks. A chair leg is the floor of the progression axis.
  "item.chair-leg": weapon({
    id: "item.chair-leg", name: "chair leg", kind: "melee", category: "improvised",
    dmgMin: 1, dmgMax: 2, noise: 12, durabilityCost: 4, startDurability: 25,
    lootWeight: 6, lootKinds: ["residential", "store", "generic"],
  }),
  "item.pipe": weapon({
    id: "item.pipe", name: "length of pipe", kind: "melee", category: "improvised",
    dmgMin: 1, dmgMax: 3, noise: BARE_NOISE, durabilityCost: 3, retaliateModifier: -5, startDurability: 40,
    lootWeight: 5, lootKinds: ["industrial", "residential", "generic"],
  }),

  // --- bladed: "reliable, silent, wears and needs stamina" (GDD IX) -------------------------------
  // The quiet family. A knife is the quietest thing in the game and the worst place to be standing
  // (retaliate +10 — you have to be inside its reach to use it); the machete is the quiet answer to
  // armor; the axe is the one the GDD names three times, and it is anything but quiet.
  "item.knife": weapon({
    id: "item.knife", name: "kitchen knife", kind: "melee", category: "bladed",
    dmgMin: 1, dmgMax: 3, noise: 8, durabilityCost: 3, retaliateModifier: 10, startDurability: 45,
    lootWeight: 4, lootKinds: ["residential", "store", "police"],
  }),
  "item.machete": weapon({
    id: "item.machete", name: "machete", kind: "melee", category: "bladed",
    dmgMin: 2, dmgMax: 4, noise: 12, armorPierce: 1, durabilityCost: 4, retaliateModifier: -5, startDurability: 60,
    lootWeight: 2, lootKinds: ["industrial", "generic"],
  }),
  // THE FIREFIGHTER'S AXE (GDD Principle 6, Part X legendary items, the Manifesto). The hardest hitter
  // in the game, the only profile that ignores riot plate outright, and the LOUDEST swing there is —
  // noise 30 against bare hands' 15, which since T75/T76 is a bill the region collects. It is found in
  // exactly one place, the `police` table, which is the kind `node.the-terraces.fire-station` carries
  // ("the tool wall intact — axes, halligans, bolt cutters").
  "item.axe-fire": weapon({
    id: "item.axe-fire", name: "firefighter's axe", kind: "melee", category: "bladed",
    dmgMin: 3, dmgMax: 5, noise: 30, armorPierce: 2, durabilityCost: 3, retaliateModifier: -15, startDurability: 100,
    lootWeight: 2, lootKinds: ["police"],
  }),

  // --- blunt: "forgiving, durable, tiring, some noise" (GDD IX) -----------------------------------
  "item.hammer": weapon({
    id: "item.hammer", name: "claw hammer", kind: "melee", category: "blunt",
    dmgMin: 2, dmgMax: 3, noise: 20, armorPierce: 1, durabilityCost: 2, retaliateModifier: 5, startDurability: 60,
    lootWeight: 3, lootKinds: ["industrial", "residential"],
  }),
  "item.bat": weapon({
    id: "item.bat", name: "baseball bat", kind: "melee", category: "blunt",
    dmgMin: 2, dmgMax: 4, noise: 25, durabilityCost: 1, retaliateModifier: -10, startDurability: 80,
    lootWeight: 3, lootKinds: ["residential", "store"],
  }),
  "item.crowbar": weapon({
    id: "item.crowbar", name: "crowbar", kind: "melee", category: "blunt",
    dmgMin: 2, dmgMax: 3, noise: 22, armorPierce: 1, durabilityCost: 1, retaliateModifier: -5, startDurability: 90,
    lootWeight: 2, lootKinds: ["industrial", "store"],
  }),

  // The one artifact the crafting economy can mint (recipe.weapon.reinforce-tool). Heavier and longer
  // than a fist: it hits harder, bites through a riot plate, keeps the dead a half-step further away —
  // and it is the thing that wears out, which is the whole point of the repair ledger it carries. It is
  // NOT in any loot table (lootWeight 0): the bench is how you get one, and that is its distinction now
  // that the world hands out weapons — it starts and repairs to a full 100 while a found weapon does not.
  "item.tool-reinforced": weapon({
    id: "item.tool-reinforced", name: "reinforced tool", kind: "melee", category: "blunt",
    dmgMin: 2, dmgMax: 3, noise: 20, armorPierce: 1, durabilityCost: 2, retaliateModifier: -10, startDurability: 100,
  }),

  // Firearms. Flat 3 damage (the pre-T80 `FIRE_DMG`), enough pierce to ignore any armor in the game,
  // and an accuracy under 1 — the term T80 exists to add. The trade between them is accuracy / noise /
  // how well they handle with a body already on top of you. T81 places all three (closing PL-M5-36:
  // before this the shotgun and rifle rows were decoration), and places them RARE — a weighted police
  // table drops a pistol on roughly one search in twenty-seven, where the pre-T81 uniform table dropped
  // one on one in four.
  "item.pistol": weapon({
    id: "item.pistol", name: "pistol", kind: "firearm", category: "firearm",
    dmgMin: 3, dmgMax: 3, noise: PISTOL_NOISE, armorPierce: 3, accuracy: 0.75,
    lootWeight: 3, lootKinds: ["police"],
  }),
  "item.shotgun": weapon({
    id: "item.shotgun", name: "shotgun", kind: "firearm", category: "firearm",
    dmgMin: 3, dmgMax: 3, noise: 85, armorPierce: 3, accuracy: 0.85, retaliateModifier: -10,
    lootWeight: 1, lootKinds: ["police", "residential"],
  }),
  "item.rifle": weapon({
    id: "item.rifle", name: "rifle", kind: "firearm", category: "firearm",
    dmgMin: 3, dmgMax: 3, noise: 95, armorPierce: 3, accuracy: 0.8, retaliateModifier: 10,
    lootWeight: 1, lootKinds: ["police"],
  }),
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

/** The profile for an item type, or bare hands when the type has none (every item outside {@link WEAPONS}). */
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

// --- the registered weapon content set (T81) ---------------------------------------------------

/**
 * The run's registered weapon pool, or empty. The pool is the **activation gate** for weapon loot, and
 * nothing else: the dials above stay engine-authoritative exactly as `ENEMIES` is, and `content/weapons/`
 * mirrors them under a schema with a drift-guard test (`harness/test/content.test.ts`) that fails if the
 * two ever disagree. That split is deliberate — moving the dials into content would have re-pointed every
 * T80 measurement at a JSON file mid-flight, and the drift guard buys the same protection without it.
 *
 * What the gate buys is byte-identity: a graph built without a weapon pool draws loot through the exact
 * pre-T81 uniform `drawPick`, so every prior run and every fixture that registers no pool is unchanged.
 * This is the radio (T50) / economy (T51) / jobs (T52) discipline, for the same `floor(f·len)` reason.
 */
export function weaponPool(graph: RegionGraph | undefined): readonly WeaponDef[] {
  return graph?.weapons ?? [];
}

/** True when the weapon content set is registered on the run — the gate for weapon loot placement. */
export function weaponsActive(graph: RegionGraph | undefined): boolean {
  return weaponPool(graph).length > 0;
}

/**
 * The weapons a search at a node of `kind` can turn up, with their rarity weights, ordered by id so the
 * draw never depends on object-key order. Read off the authoritative table (the pool gates, it does not
 * supply — see {@link weaponPool}).
 */
export function weaponLootFor(kind: string | undefined): readonly { readonly id: ContentId; readonly weight: number }[] {
  if (kind === undefined) return [];
  const out: { id: ContentId; weight: number }[] = [];
  for (const w of Object.values(WEAPONS)) {
    if (w.lootWeight > 0 && w.lootKinds.includes(kind)) out.push({ id: w.id, weight: w.lootWeight });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// --- provenance, in words (T81 · closes the rendering half of PL-M4-33) --------------------------

/**
 * What the thing in your hands looks like, in words — never numbers (FR-UI-02, and PL-M4-33's whole
 * complaint: `metadata.repairs` stores raw `{from,to}` durability ints and any screen printing them
 * would leak the stat block the GDD forbids).
 *
 * Two facts, in priority order, because they say different things:
 *
 *   1. **Repairs are history.** A weapon that has been brought back reads as its repair count — SCR-10's
 *      own example sentence, *"its third repair, it carries the marks now"*. This is Principle 6 made
 *      visible: two axes with the same dials are not the same axe, and the difference is what happened
 *      to them. A repaired weapon says so even when it is currently pristine.
 *   2. **Wear is condition.** Failing that, a band of the durability track — and the bands are named for
 *      what the player should DO about it, not for where the number sits.
 *
 * Returns "" for a weapon with nothing to say (fresh, unrepaired, or no durability track at all), which
 * is what keeps every pre-T81 label byte-identical.
 */
export function artifactMarks(item: ItemInstance | undefined): string {
  if (item === undefined) return "";
  const meta = (typeof item.metadata === "object" && item.metadata !== null && !Array.isArray(item.metadata)
    ? item.metadata
    : {}) as { readonly [k: string]: JsonValue };
  const repairs = Array.isArray(meta["repairs"]) ? (meta["repairs"] as readonly JsonValue[]).length : 0;
  if (repairs >= 3) return "it carries the marks now";
  if (repairs === 2) return "mended twice";
  if (repairs === 1) return "mended once";
  const d = item.durability;
  if (d === null) return "";
  if (d === 0) return "broken";
  if (d <= 25) return "about to go";
  if (d <= 60) return "worn";
  return "";
}

/** The held weapon's item instance, when one is equipped and still in the registry. */
export function equippedItem(state: GameState): ItemInstance | undefined {
  const id = state.player.equipment[WEAPON_SLOT];
  return id === undefined ? undefined : state.items[id];
}

/** The marks as a parenthetical for a choice label — "" when there is nothing to say. */
export function marksSuffix(item: ItemInstance | undefined): string {
  const m = artifactMarks(item);
  return m === "" ? "" : ` (${m})`;
}
