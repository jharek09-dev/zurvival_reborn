/**
 * The crafting economy (M4 task T51 · FR-ECO-04..07 · GDD Part X "Inventory, Crafting, Loot & Economy" ·
 * Part XI rooms · wireframe SCR-10 "Workshop — Crafting & Repair").
 *
 * One content-driven system closes all four resource loops. GDD X names four loops that must each have a
 * drain AND a sink — body (food/water), safety (ammo/materials/durability), health (medicine), power
 * (fuel/components). The audit before this part: body & health already had honest sinks (needs drift ↔
 * eat/drink/treat); safety had ammo + scrap but gear **durability was declared and never spent**; power
 * had **no sink at all**. This module gives the two thin loops real sinks and makes every option debit a
 * real resource — the workbench is where the four loops meet:
 *
 *   - **crafting** (medical / weapon / shelter / survival) debits components + time (health & safety);
 *   - **repairs** restore a worn artifact's durability and grow its story instead of replacing it — the
 *     safety loop's durability sink (FR-ECO-07, SCR-10 "repair beats replace; the story grows");
 *   - **purification** turns dirty water safe, debiting fuel — the power loop's sink (FR-ECO-05);
 *   - **spoilage** ages carried fresh food, faster once the grid fails — the body loop's passive sink
 *     (FR-ECO-05), read from `world.powerGrid`, a signal the world already drifts (T27).
 *
 * A recipe is authored JSON (`content/recipes/*.json`), interpreted generically — no per-recipe branching
 * (the T47/T50 idiom). The pool rides the transient `RegionGraph` (`graph.recipes`, mirroring
 * `graph.signals`), so a graph built without it leaves the whole system inert and **every prior run
 * byte-identical**. "Gated by blueprints, components, and rooms" (FR-ECO-06) is folded into the one schema:
 * a **room** is built by a shelter recipe (`installsRoom`) and required by another (`room`); a
 * **blueprint** is learned into `player.economy.blueprints` (found as an `item.blueprint.*` and studied)
 * and required by a recipe (`blueprint`). Crafting/repair/purify are pure deterministic conversions — the
 * economy draws **no RNG stream** and never mutates a shared loot table (new lootable items are appended
 * the `includeRadio` way, see loot.ts). The seam mirrors `radioChoices` / `isRadioAction` /
 * `resolveRadioAction` / `radioLine`. Pure, deterministic, dependency-free, integer-only (ADR-0001).
 */

import type { ContentId, GameState, HistoryEvent, InventoryEntry, ItemInstance, JsonValue } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";

// --- content shape (mirrored by content/schemas/recipe.schema.json) ---------------------------

/** The recipe families of GDD X, plus the two structural verbs the workbench also runs. */
export type RecipeCategory = "medical" | "weapon" | "shelter" | "survival" | "repair" | "purify";

/** One line of a recipe's cost: N units of an item id. Integer qty ≥ 1. */
export interface RecipeIO {
  readonly item: ContentId;
  readonly qty: number;
}

/**
 * A static recipe — mirrors `content/schemas/recipe.schema.json`. The engine interprets these generically:
 * it consumes every `input`, then applies the ONE payload the recipe carries (an item `output`, an
 * `installsRoom`, a `repairs` restore, or a `purify` conversion), spends `timeCost` hours, and logs a beat.
 */
export interface RecipeDef {
  readonly id: string;
  readonly category: RecipeCategory;
  /** The row name (SCR-10 "Reinforced plank"). */
  readonly label: string;
  /** What it does *in the world*, not a stat ("Boards the east window"). Surfaced as prose, never a number. */
  readonly worldEffect: string;
  /** The full known cost — the mono line of the SCR-10 row. Consumed on craft (deterministic, first stack). */
  readonly inputs: readonly RecipeIO[];
  /** An item-producing recipe's product (medical/survival/weapon). Omit for room/repair/purify recipes. */
  readonly output?: RecipeIO;
  /** A weapon recipe whose product is a tracked **durability artifact** (an `ItemInstance`), not a stack. */
  readonly mintsArtifact?: boolean;
  /** Starting durability for a minted artifact (0–100); defaults to full. */
  readonly startDurability?: number;
  /** A shelter recipe whose product is a **room** installed at the shelter node (`room.workshop`). */
  readonly installsRoom?: ContentId;
  /** A **repair** recipe: restore a carried durability artifact by this many points, growing its story. */
  readonly repairs?: number;
  /** A **purify** recipe: convert this item id (carried) into {@link purifyTo}. */
  readonly purifyFrom?: ContentId;
  /** A **purify** recipe's safe product. */
  readonly purifyTo?: ContentId;
  /** A learned unlock this recipe needs (content id); omit ⇒ known from the start (survival basics). */
  readonly blueprint?: ContentId;
  /** A built room this recipe needs to run (content id); omit ⇒ craftable in the bare shelter. */
  readonly room?: ContentId;
  /** Hours the craft costs — the real price (SCR-10). > 0 so every craft is a resolved, world-advancing turn. */
  readonly timeCost: number;
  /** Some crafts are loud (a molotov). Deposited at the node by stage 6 via `params.noise`, like a firearm. */
  readonly noise?: number;
}

// --- the dials --------------------------------------------------------------------------------

/** The perishable food the spoilage clock governs — enters play only via economy-active loot (see loot.ts). */
export const FRESH_FOOD_ITEM = "item.food-fresh";
/** What fresh food turns into once its clock runs out. Still carried (compost / a risky meal) — not vanished. */
export const SPOILED_FOOD_ITEM = "item.food-spoiled";
/** The prefix of a findable blueprint item; `item.blueprint.molotov` teaches `blueprint.molotov`. */
export const BLUEPRINT_ITEM_PREFIX = "item.blueprint.";
/** The learned-unlock id prefix a studied blueprint item maps to. */
export const BLUEPRINT_ID_PREFIX = "blueprint.";

/** Hours a fresh-food stack keeps before it spoils, at full power (~two days). Untuned (M5 balance). */
export const FRESH_SHELF_LIFE = 48;
/** Below this `world.powerGrid`, refrigeration is failing and fresh food spoils faster (FR-ECO-05). */
export const POWER_SPOIL_AT = 40;
/** How much faster fresh food spoils once the grid is below {@link POWER_SPOIL_AT}. */
export const POWER_SPOIL_MULT = 2;
/** Durability a worn artifact loses per melee strike with it equipped (the safety-loop drain). */
export const WEAPON_WEAR = 2;
/** The equipment slot a minted/repaired weapon artifact occupies. */
export const WEAPON_SLOT = "weapon";

// --- pool on the transient graph (never serialized) -------------------------------------------

/** The registered recipe pool for this run, or empty when none is registered (inert). */
export function recipePool(graph: RegionGraph | undefined): readonly RecipeDef[] {
  return graph?.recipes ?? [];
}

/** Look up a recipe def by id in the pool. */
export function recipeOf(graph: RegionGraph | undefined, id: string): RecipeDef | undefined {
  return recipePool(graph).find((r) => r.id === id);
}

/**
 * Is the crafting economy active on this run? The master gate: a graph built without a recipe pool leaves
 * the whole system dark — no choices, no spoilage tick, no durability wear, no loot gating — so every prior
 * run (whose generators never pass recipes) is byte-identical. Everything below is downstream of this.
 */
export function economyActive(graph: RegionGraph | undefined): boolean {
  return recipePool(graph).length > 0;
}

// --- inventory helpers (private; the module's own deterministic consume/grant, per house style) ------

/** How many units of a non-unique `type` the pack carries. */
function count(inv: readonly InventoryEntry[], type: string): number {
  let n = 0;
  for (const e of inv) if (e.type === type && e.itemId === undefined) n += Math.max(0, Math.trunc(e.quantity));
  return n;
}

/** Remove `qty` units of a non-unique `type` (first matching stack, deterministic). Drops empty stacks. */
function consume(inv: readonly InventoryEntry[], type: string, qty: number): readonly InventoryEntry[] {
  let remaining = Math.max(0, Math.trunc(qty));
  if (remaining === 0) return inv;
  const out: InventoryEntry[] = [];
  for (const e of inv) {
    if (remaining > 0 && e.type === type && e.itemId === undefined) {
      const take = Math.min(remaining, e.quantity);
      remaining -= take;
      const left = e.quantity - take;
      if (left > 0) out.push({ ...e, quantity: left });
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Add `qty` units of a non-unique `type`, stacking onto the first matching stack or appending (deterministic). */
function grant(inv: readonly InventoryEntry[], type: string, qty: number): readonly InventoryEntry[] {
  const n = Math.max(0, Math.trunc(qty));
  if (n === 0) return inv;
  const idx = inv.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return [...inv, { type, quantity: n }];
  return inv.map((e, i) => (i === idx ? { ...e, quantity: e.quantity + n } : e));
}

/** Does the pack hold every input of a recipe? (Repair/purify inputs included.) */
function hasInputs(inv: readonly InventoryEntry[], recipe: RecipeDef): boolean {
  return recipe.inputs.every((io) => count(inv, io.item) >= Math.max(1, Math.trunc(io.qty)));
}

/** Every input a recipe is short of (empty when all are present) — the SCR-10 "says exactly what it needs" line. */
function allMissing(inv: readonly InventoryEntry[], recipe: RecipeDef): readonly RecipeIO[] {
  return recipe.inputs.filter((io) => count(inv, io.item) < Math.max(1, Math.trunc(io.qty)));
}

// --- gates ------------------------------------------------------------------------------------

/** Is the player standing in their own claimed shelter — the workbench is home (SCR-10 "WORKSHOP · THE OVERLOOK"). */
function atWorkbench(state: GameState): boolean {
  return state.player.shelterId !== null && state.player.location === state.player.shelterId;
}

/** The rooms installed at the player's shelter node (empty off a shelter). */
function shelterRooms(state: GameState): readonly ContentId[] {
  const id = state.player.shelterId;
  return id !== null ? state.nodes[id]?.rooms ?? [] : [];
}

/** Has the player learned a recipe's required blueprint (or does it need none)? */
function blueprintOK(state: GameState, recipe: RecipeDef): boolean {
  return recipe.blueprint === undefined || state.player.economy.blueprints.includes(recipe.blueprint);
}

/** Does the player's shelter have a recipe's required room (or does it need none)? */
function roomOK(state: GameState, recipe: RecipeDef): boolean {
  return recipe.room === undefined || shelterRooms(state).includes(recipe.room);
}

/** The carried durability artifacts (an `ItemInstance` with non-null durability) — economy-only; empty otherwise. */
export function carriedArtifacts(state: GameState): readonly { readonly entry: InventoryEntry; readonly item: ItemInstance }[] {
  const out: { entry: InventoryEntry; item: ItemInstance }[] = [];
  for (const e of state.player.inventory) {
    if (e.itemId === undefined) continue;
    const item = state.items[e.itemId];
    if (item !== undefined && item.durability !== null) out.push({ entry: e, item });
  }
  return out;
}

/** A repair recipe can run when a carried artifact is below full durability and its inputs + room are present. */
function repairTarget(state: GameState, recipe: RecipeDef): InventoryEntry | null {
  if (recipe.repairs === undefined) return null;
  for (const { entry, item } of carriedArtifacts(state)) {
    if ((item.durability ?? 100) < 100) return entry;
  }
  return null;
}

/**
 * Is a recipe *craftable right now*? Gated on: the economy is active, the player is at the workbench, the
 * required blueprint is learned, the required room is built, every input is carried, and any
 * category-specific target exists (a repair needs a worn artifact; a purify needs its dirty input). Every
 * clause is false on a prior golden run (no recipe pool ⇒ `economyActive` false), so the choice list is
 * byte-identical unless the player is genuinely at the bench with the parts.
 */
export function craftable(state: GameState, graph: RegionGraph | undefined, recipe: RecipeDef): boolean {
  if (!economyActive(graph) || !atWorkbench(state)) return false;
  if (!blueprintOK(state, recipe) || !roomOK(state, recipe)) return false;
  // A room already installed at the shelter can't be built again — else the bench keeps offering it and a
  // re-craft would silently burn the inputs for nothing (the room-install is a no-op when already present).
  if (recipe.installsRoom !== undefined && shelterRooms(state).includes(recipe.installsRoom)) return false;
  if (!hasInputs(state.player.inventory, recipe)) return false;
  if (recipe.category === "repair") return repairTarget(state, recipe) !== null;
  if (recipe.category === "purify") return recipe.purifyFrom !== undefined && count(state.player.inventory, recipe.purifyFrom) > 0;
  return true;
}

// --- the workshop listing (legibility surface for the client / harness gate) -------------------

/** One SCR-10 recipe row: the recipe, whether it's craftable now, and every stated missing part if not. */
export interface WorkshopRow {
  readonly recipe: RecipeDef;
  readonly craftable: boolean;
  /** The stated missing components (SCR-10 amber "needs: fuel ×1 · cloth ×1") — every shortfall, empty when craftable. */
  readonly missing: readonly RecipeIO[];
}

/**
 * Every recipe the bench could show right now — those whose blueprint/room gates are met — each flagged
 * craftable or, if only a component is short, carrying its stated missing part. Empty off the workbench or
 * with no recipe pool. This is the honest SCR-10 screen: missing parts are *stated*, never a mystery.
 */
export function workshopListing(state: GameState, graph: RegionGraph | undefined): readonly WorkshopRow[] {
  if (!economyActive(graph) || !atWorkbench(state)) return [];
  const rows: WorkshopRow[] = [];
  for (const recipe of recipePool(graph)) {
    if (!blueprintOK(state, recipe) || !roomOK(state, recipe)) continue; // a locked recipe isn't shown at all
    const can = craftable(state, graph, recipe);
    rows.push({ recipe, craftable: can, missing: can ? [] : allMissing(state.player.inventory, recipe) });
  }
  return rows.sort((a, b) => (a.recipe.id < b.recipe.id ? -1 : a.recipe.id > b.recipe.id ? 1 : 0));
}

// --- blueprints the player is carrying and could study ----------------------------------------

/** The blueprint id an `item.blueprint.<slug>` teaches (`item.blueprint.molotov` ⇒ `blueprint.molotov`). */
export function blueprintIdForItem(itemType: string): string {
  return BLUEPRINT_ID_PREFIX + itemType.slice(BLUEPRINT_ITEM_PREFIX.length);
}

/** Carried blueprint items whose unlock the player has not yet learned — each a "study" opportunity. */
function studyableBlueprints(state: GameState): readonly string[] {
  const out: string[] = [];
  for (const e of state.player.inventory) {
    if (e.itemId !== undefined || !e.type.startsWith(BLUEPRINT_ITEM_PREFIX) || e.quantity <= 0) continue;
    const id = blueprintIdForItem(e.type);
    if (!state.player.economy.blueprints.includes(id) && !out.includes(e.type)) out.push(e.type);
  }
  return out.sort();
}

// --- the seam: choices / dispatch / resolution ------------------------------------------------

/** A stable cost clause for a choice label — the SCR-10 mono line, all words ("2 scrap · 30m · quiet"). */
function costClause(recipe: RecipeDef): string {
  const parts = recipe.inputs.map((io) => `${io.qty} ${itemLabel(io.item)}`);
  parts.push(`${recipe.timeCost}h`);
  if (recipe.noise !== undefined && recipe.noise > 0) parts.push("loud");
  return parts.join(" · ");
}

/** A short item label for prose ("item.canned-food" ⇒ "canned food"); local to keep this module dependency-light. */
function itemLabel(type: string): string {
  const tail = type.startsWith("item.") ? type.slice("item.".length) : type;
  return tail.replace(/-/g, " ").trim() || type;
}

/**
 * The economy actions offered from the current state, in stable order. Empty unless the economy is active.
 * Study is offered anywhere you carry an unlearned blueprint; craft/repair/purify are offered only at the
 * workbench (all downstream of `craftable`, so gated identically). Inert on every prior run.
 */
export function economyChoices(state: GameState, graph: RegionGraph | undefined): readonly SceneChoice[] {
  if (!economyActive(graph)) return [];
  const choices: SceneChoice[] = [];

  // Study a carried blueprint (learn its recipe) — the eat/drink pattern: consume the item ⇒ learn.
  for (const item of studyableBlueprints(state)) {
    choices.push({
      id: `study:${item}`,
      label: `Study the ${itemLabel(item)}`,
      timeCost: 1,
      action: { type: "study", choiceId: `study:${item}`, timeCost: 1, params: { item } },
    });
  }

  // Craft / repair / purify — one choice per craftable recipe, ordered by id for stability.
  for (const recipe of [...recipePool(graph)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!craftable(state, graph, recipe)) continue;
    const noise = recipe.noise !== undefined && recipe.noise > 0 ? { noise: recipe.noise } : {};
    if (recipe.category === "repair") {
      const target = repairTarget(state, recipe);
      if (target?.itemId === undefined) continue;
      choices.push({
        id: `repair:${recipe.id}`,
        label: `${recipe.label} — ${recipe.worldEffect} (${costClause(recipe)})`,
        timeCost: recipe.timeCost,
        action: { type: "repair", choiceId: `repair:${recipe.id}`, timeCost: recipe.timeCost, params: { recipe: recipe.id, itemId: target.itemId, ...noise } },
      });
    } else if (recipe.category === "purify") {
      choices.push({
        id: `purify:${recipe.id}`,
        label: `${recipe.label} — ${recipe.worldEffect} (${costClause(recipe)})`,
        timeCost: recipe.timeCost,
        action: { type: "purify", choiceId: `purify:${recipe.id}`, timeCost: recipe.timeCost, params: { recipe: recipe.id, ...noise } },
      });
    } else {
      choices.push({
        id: `craft:${recipe.id}`,
        label: `${recipe.label} — ${recipe.worldEffect} (${costClause(recipe)})`,
        timeCost: recipe.timeCost,
        action: { type: "craft", choiceId: `craft:${recipe.id}`, timeCost: recipe.timeCost, params: { recipe: recipe.id, ...noise } },
      });
    }
  }
  return choices;
}

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export function isEconomyAction(action: Action): boolean {
  return action.type === "craft" || action.type === "repair" || action.type === "purify" || action.type === "study";
}

/** Stamp + append a Living-History beat (append-only; never rewritten). Pure. */
function appendBeat(state: GameState, type: string, subjects: readonly string[], data: HistoryEvent["data"]): GameState {
  const { day, hour, turn } = state.meta;
  const beat: HistoryEvent = { day, hour, turn, type, subjects: [...subjects], data };
  return { ...state, history: [...state.history, beat] };
}

/**
 * A deterministic, collision-proof id for a minted artifact — turn-stamped (honest play mints at most once
 * per turn, since every mint recipe costs ≥1h and advances the turn), with a numeric suffix as a backstop
 * if that id is somehow already taken (a forged 0-cost craft). No clock, no RNG.
 */
function mintedArtifactId(state: GameState, type: string): string {
  const base = `${type}#t${state.meta.turn}`;
  if (!(base in state.items)) return base;
  let i = 2;
  while (`${base}.${i}` in state.items) i++;
  return `${base}.${i}`;
}

/** Craft: debit every input, then apply the recipe's single payload (output / room / artifact). Pure. */
function craft(state: GameState, recipe: RecipeDef): GameState {
  let inv = state.player.inventory;
  for (const io of recipe.inputs) inv = consume(inv, io.item, io.qty);

  // A weapon recipe that mints a tracked durability artifact (repair-over-replace exists because of these).
  if (recipe.mintsArtifact === true && recipe.output !== undefined) {
    const id = mintedArtifactId(state, recipe.output.item);
    const item: ItemInstance = {
      type: recipe.output.item,
      quality: 100,
      durability: clamp0to100(recipe.startDurability ?? 100),
      metadata: { craftedDay: state.meta.day, repairs: [] },
    };
    const withEntry = [...inv, { type: recipe.output.item, quantity: 1, itemId: id }];
    const next: GameState = {
      ...state,
      items: { ...state.items, [id]: item },
      player: { ...state.player, inventory: withEntry, equipment: { ...state.player.equipment, [WEAPON_SLOT]: id } },
    };
    return appendBeat(next, "craft.done", ["player", recipe.id], { recipe: recipe.id, minted: id });
  }

  // A shelter recipe that installs a room at the shelter node.
  if (recipe.installsRoom !== undefined && state.player.shelterId !== null) {
    const nodeId = state.player.shelterId;
    const node = state.nodes[nodeId];
    const rooms = node !== undefined && !node.rooms.includes(recipe.installsRoom) ? [...node.rooms, recipe.installsRoom] : node?.rooms ?? [];
    const nodes = node !== undefined ? { ...state.nodes, [nodeId]: { ...node, rooms } } : state.nodes;
    const next: GameState = { ...state, nodes, player: { ...state.player, inventory: inv } };
    return appendBeat(next, "craft.done", ["player", recipe.id], { recipe: recipe.id, room: recipe.installsRoom });
  }

  // An ordinary item-producing recipe (medical / survival / weapon stack).
  if (recipe.output !== undefined) inv = grant(inv, recipe.output.item, recipe.output.qty);
  const next: GameState = { ...state, player: { ...state.player, inventory: inv } };
  return appendBeat(next, "craft.done", ["player", recipe.id], { recipe: recipe.id, output: recipe.output?.item ?? null });
}

/** Repair: debit inputs, raise the target artifact's durability, and **append a provenance line** to its story. */
function repair(state: GameState, recipe: RecipeDef, itemId: string): GameState {
  const item = state.items[itemId];
  // A full or non-durability artifact is not a valid target — reject rather than burn the inputs on a no-op
  // (guards a forged itemId; the offered `repair` choice already targets only a worn artifact).
  if (item === undefined || item.durability === null || item.durability >= 100 || recipe.repairs === undefined) return state;
  let inv = state.player.inventory;
  for (const io of recipe.inputs) inv = consume(inv, io.item, io.qty);

  const before = item.durability;
  const after = clamp0to100(before + recipe.repairs);
  // Repair-over-replace: the instance id NEVER changes; its metadata grows a line (SCR-10 "the story grows").
  const meta = (item.metadata !== null && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}) as { readonly [k: string]: JsonValue };
  const priorRepairs: readonly JsonValue[] = Array.isArray(meta["repairs"]) ? (meta["repairs"] as readonly JsonValue[]) : [];
  const nth = priorRepairs.length + 1;
  const entry: JsonValue = { day: state.meta.day, from: before, to: after, note: `repair #${nth}` };
  const nextItem: ItemInstance = {
    ...item,
    durability: after,
    metadata: { ...meta, repairs: [...priorRepairs, entry] },
  };
  const next: GameState = { ...state, items: { ...state.items, [itemId]: nextItem }, player: { ...state.player, inventory: inv } };
  return appendBeat(next, "repair.done", ["player", itemId], { recipe: recipe.id, item: itemId, from: before, to: after, nth });
}

/** Purify: convert every carried dirty unit its inputs cover into the safe product, debiting the inputs. */
function purify(state: GameState, recipe: RecipeDef): GameState {
  if (recipe.purifyFrom === undefined || recipe.purifyTo === undefined) return state;
  const dirty = count(state.player.inventory, recipe.purifyFrom);
  if (dirty <= 0) return state;
  let inv = state.player.inventory;
  for (const io of recipe.inputs) inv = consume(inv, io.item, io.qty);
  inv = consume(inv, recipe.purifyFrom, dirty);
  inv = grant(inv, recipe.purifyTo, dirty);
  const next: GameState = { ...state, player: { ...state.player, inventory: inv } };
  return appendBeat(next, "purify.done", ["player", recipe.id], { recipe: recipe.id, made: dirty });
}

/** Study: learn a carried blueprint item's unlock and consume the schematic. No-op unless it's actually carried. */
function study(state: GameState, itemType: string): GameState {
  const id = blueprintIdForItem(itemType);
  if (state.player.economy.blueprints.includes(id)) return state;
  if (count(state.player.inventory, itemType) <= 0) return state; // must own the schematic to learn it
  const inv = consume(state.player.inventory, itemType, 1);
  const next: GameState = {
    ...state,
    player: { ...state.player, inventory: inv, economy: { ...state.player.economy, blueprints: [...state.player.economy.blueprints, id] } },
  };
  return appendBeat(next, "study.done", ["player", id], { blueprint: id });
}

/** Resolve an economy action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. */
export function resolveEconomyAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  const recipeId = typeof action.params?.["recipe"] === "string" ? (action.params["recipe"] as string) : "";
  const recipe = recipeOf(graph, recipeId);
  switch (action.type) {
    case "craft":
      return recipe !== undefined && craftable(state, graph, recipe) ? craft(state, recipe) : state;
    case "repair": {
      const itemId = typeof action.params?.["itemId"] === "string" ? (action.params["itemId"] as string) : "";
      return recipe !== undefined && craftable(state, graph, recipe) ? repair(state, recipe, itemId) : state;
    }
    case "purify":
      return recipe !== undefined && craftable(state, graph, recipe) ? purify(state, recipe) : state;
    case "study": {
      const item = typeof action.params?.["item"] === "string" ? (action.params["item"] as string) : "";
      // Re-validate like the other verbs: the economy must be active (dark without a pool) and the item a
      // blueprint schematic; `study` itself no-ops unless it's actually carried, so a forged action is inert.
      return economyActive(graph) && item.startsWith(BLUEPRINT_ITEM_PREFIX) ? study(state, item) : state;
    }
    default:
      return state;
  }
}

// --- spoilage (a per-turn body-loop sink, hooked in stage 4 beside advanceInfection) -----------

const clamp0to100 = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * Age carried fresh food by `hours`, faster once the grid fails (FR-ECO-05). Called from stage 4
 * (`updateCondition`) with the same `hours` the needs drift used. Inert unless the economy is active AND
 * the pack holds fresh food — so no prior run, and no economy run without perishables, is touched. When the
 * clock runs out the fresh stack turns to `item.food-spoiled` (a `food.spoiled` beat, no celebration). Pure.
 */
export function tickSpoilage(state: GameState, graph: RegionGraph | undefined, hours: number): GameState {
  if (!economyActive(graph)) return state;
  const h = Math.max(0, Math.trunc(hours));
  const fresh = count(state.player.inventory, FRESH_FOOD_ITEM);
  const clock = state.player.economy.freshness;

  if (fresh <= 0) {
    // No fresh food carried: the clock, if any, is meaningless — clear it (idempotent otherwise).
    if (clock === null) return state;
    return { ...state, player: { ...state.player, economy: { ...state.player.economy, freshness: null } } };
  }

  // Carrying fresh food: start the clock the first turn it's held, then count down (faster on a failing grid).
  const started = clock ?? FRESH_SHELF_LIFE;
  if (h === 0) {
    return clock === started ? state : { ...state, player: { ...state.player, economy: { ...state.player.economy, freshness: started } } };
  }
  const rate = state.world.powerGrid < POWER_SPOIL_AT ? POWER_SPOIL_MULT : 1;
  const next = started - h * rate;

  if (next > 0) {
    return { ...state, player: { ...state.player, economy: { ...state.player.economy, freshness: next } } };
  }

  // Spoiled: the fresh stack becomes spoiled food; the clock resets to empty.
  let inv = consume(state.player.inventory, FRESH_FOOD_ITEM, fresh);
  inv = grant(inv, SPOILED_FOOD_ITEM, fresh);
  const spoiled: GameState = {
    ...state,
    player: { ...state.player, inventory: inv, economy: { ...state.player.economy, freshness: null } },
  };
  return appendBeat(spoiled, "food.spoiled", ["player"], { units: fresh, powerGrid: state.world.powerGrid });
}

// --- durability wear (the safety-loop drain, hooked into a melee strike) -----------------------

/**
 * Wear the equipped weapon artifact by one strike's worth (FR-ECO-07's reason to exist). Called from the
 * combat melee resolution. Inert on every prior run: no current item has non-null durability and the start
 * `equipment` is empty, so the equipped-artifact lookup misses and the state passes through unchanged. Only
 * an economy-minted artifact wears — and the repair recipe is the only thing that restores it. Pure.
 */
export function wearWeaponOnStrike(state: GameState): GameState {
  const equippedId = state.player.equipment[WEAPON_SLOT];
  if (equippedId === undefined) return state;
  const item = state.items[equippedId];
  if (item === undefined || item.durability === null) return state;
  const next = clamp0to100(item.durability - WEAPON_WEAR);
  if (next === item.durability) return state;
  return { ...state, items: { ...state.items, [equippedId]: { ...item, durability: next } } };
}

// --- narration surfaced in sceneOf ------------------------------------------------------------

/**
 * The economy's contribution to the Scene, or null. Surfaces ONLY on an economy turn — a `craft.*` /
 * `repair.*` / `purify.*` / `study.*` / `food.spoiled` beat exists for this turn (the same this-turn
 * tail-scan `radioLine` uses) — so the workbench never clutters an ordinary scene. All words; no numbers
 * the design forbids (FR-UI-02). Pure — reads state + the append-only log, advances nothing.
 */
export function economyLine(state: GameState, graph: RegionGraph | undefined): string | null {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i]!;
    if (h.turn !== state.meta.turn) break; // turn-ordered append-only log ⇒ past this turn's tail, stop
    const d = h.data as { readonly [k: string]: unknown } | null;
    switch (h.type) {
      case "craft.done": {
        const recipe = recipeOf(graph, typeof d?.["recipe"] === "string" ? (d!["recipe"] as string) : "");
        if (recipe === undefined) return "You work at the bench a while, and it is done.";
        if (recipe.installsRoom !== undefined) return `You build it into the shelter — ${recipe.worldEffect.toLowerCase().replace(/\.\s*$/, "")}. The room is yours now.`;
        return `You make it at the bench: ${recipe.label.toLowerCase()}. ${recipe.worldEffect}`;
      }
      case "repair.done": {
        const nth = typeof d?.["nth"] === "number" ? (d!["nth"] as number) : 1;
        const ordinal = nth === 1 ? "first" : nth === 2 ? "second" : nth === 3 ? "third" : `${nth}th`;
        return `You bring the edge back and work the joints — its ${ordinal} repair. It carries the marks now, and it holds. You keep it alive rather than trade it away.`;
      }
      case "purify.done": {
        const made = typeof d?.["made"] === "number" ? (d!["made"] as number) : 0;
        const recipe = recipeOf(graph, typeof d?.["recipe"] === "string" ? (d!["recipe"] as string) : "");
        // Narrate the method the recipe actually used — boiling burns fuel; the filter runs it through charcoal and cloth.
        const boiled = recipe?.inputs.some((io) => io.item === "item.fuel") ?? true;
        const how = boiled ? "You boil it down and let it cool" : "You run it through the charcoal and cloth";
        return made === 1 ? `${how} — a canteen of water you can trust.` : `${how} — a store of water you can trust now, not gamble on.`;
      }
      case "study.done":
        return "You sit with the schematic until the sense of it settles. You know how to make it now.";
      case "food.spoiled":
        return "The fresh food has turned — soft, sour, past saving. It goes from something you were counting on to something you carry and can't eat.";
    }
  }
  return null;
}
