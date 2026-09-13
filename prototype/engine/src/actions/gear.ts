/**
 * Taking something up — the equip verb (M5 task T81 · FR-CBT-04 · FR-PLR-04 · GDD IX).
 *
 * ### Why this module exists at all
 *
 * T80 built the socket that makes what you hold change the fight, and T81's brief called the rest
 * *"pure content once T80 exists"*. It was not. Before this module, `player.equipment[WEAPON_SLOT]`
 * was written in **exactly one place in the entire engine** — the crafting bench's artifact mint
 * (`sim/economy.ts`) — so the only weapon a player could ever hold was one they built, and a weapon
 * placed in a loot table would have been decoration in a pack with no way into a hand. That is the same
 * dead-wiring pattern the 2026-09 design review exists to end, and shipping the roster without this
 * would have repeated it one task after naming it.
 *
 * ### The shape
 *
 * One free verb (`EQUIP_COST` 0 — the T18 rule that *managing the pack costs no in-game time*, and the
 * same cost `drop` and the T39 stash verbs charge), offered in the quiet explore branch only, once per
 * carried melee artifact that is not already in your hands. A fight, an overrun, an active encounter or
 * loitering walkers all pre-empt that branch, so **you cannot swap weapons mid-fight**: what you walked
 * in holding is what you fight with. That is deliberate — a free in-fight swap would collapse the
 * carry-weight trade the roster is built on (carry every weapon, use the perfect one), and it is the
 * decision the GDD's "weapons are tools with trade-offs" needs to stay a decision.
 *
 * A **broken** weapon (durability 0) is still offered, and taking it up is still allowed: it fights as
 * bare hands (`combat/weapons.ts`), but it is the thing `recipe.repair.tool` restores, and the label
 * says plainly what it is. What is never offered is the weapon already equipped.
 *
 * Pure, deterministic, RNG-free, clock-free.
 */

import type { GameState, ItemInstance } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { WEAPON_SLOT } from "../sim/economy.js";
import { weaponProfile, marksSuffix, equippedItem, WEAPONS } from "../combat/weapons.js";

/** Managing what is in your hands costs no in-game time — the T18 `DROP_COST` rule. */
export const EQUIP_COST = 0;

/** A carried tracked artifact whose item type has a melee profile — i.e. a weapon you could take up. */
export interface CarriedWeapon {
  readonly itemId: string;
  readonly item: ItemInstance;
  readonly type: string;
}

/**
 * Every melee weapon artifact in the pack, ordered by item id so the offered list is stable across
 * runs and platforms (the `workshopRows` ordering rule). A stack without an `itemId` is not a weapon
 * artifact and is never listed — firearms are stacks and are brought up by `firearmFor`, not equipped.
 */
export function carriedWeapons(state: GameState): readonly CarriedWeapon[] {
  const out: CarriedWeapon[] = [];
  for (const e of state.player.inventory) {
    if (e.itemId === undefined) continue;
    const item = state.items[e.itemId];
    if (item === undefined) continue;
    // `weaponProfile` answers the MELEE question and falls back to bare hands for anything else, so ask
    // the table directly: a row must exist AND be melee for this to be a weapon you can take up.
    const def = WEAPONS[item.type];
    if (def === undefined || def.kind !== "melee") continue;
    out.push({ itemId: e.itemId, item, type: item.type });
  }
  return out.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

/**
 * The equip choices: one per carried melee artifact that is not the one currently held. Empty for every
 * run that carries no weapon artifact — which is every pre-T81 run, so the offered choice list is
 * unchanged wherever the roster has not been found.
 */
export function gearChoices(state: GameState): readonly SceneChoice[] {
  const equipped = state.player.equipment[WEAPON_SLOT];
  const choices: SceneChoice[] = [];
  for (const w of carriedWeapons(state)) {
    if (w.itemId === equipped) continue;
    const def = weaponProfile(w.type);
    choices.push({
      id: `equip:${w.itemId}`,
      label: `Take up the ${def.name}${marksSuffix(w.item)}`,
      timeCost: EQUIP_COST,
      action: { type: "equip", choiceId: `equip:${w.itemId}`, timeCost: EQUIP_COST, params: { itemId: w.itemId } },
    });
  }
  return choices;
}

/** True for the actions this module owns (the `isShelterAction` dispatch idiom). */
export function isGearAction(action: Action): boolean {
  return action.type === "equip";
}

/**
 * Put the named artifact in the player's hands. Rejects — by returning the same state reference — a
 * forged `itemId`, one that is not carried, and one whose type has no melee profile, so a hand-built or
 * replayed action can never equip a ration. Pure.
 */
export function resolveGearAction(state: GameState, action: Action): GameState {
  if (action.type !== "equip") return state;
  const itemId = typeof action.params?.["itemId"] === "string" ? (action.params["itemId"] as string) : null;
  if (itemId === null) return state;
  const carried = carriedWeapons(state).find((w) => w.itemId === itemId);
  if (carried === undefined) return state;
  if (state.player.equipment[WEAPON_SLOT] === itemId) return state;
  return { ...state, player: { ...state.player, equipment: { ...state.player.equipment, [WEAPON_SLOT]: itemId } } };
}

/** Re-exported so a client asking "what is in my hands" has one import, not two. */
export { equippedItem };
