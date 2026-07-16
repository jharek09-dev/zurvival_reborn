/**
 * Recruitable companions, standing orders & permanent, remembered death (M3 T36 + M4 T45 · FR-NPC-03/04
 * · GDD XII).
 *
 * T36 shipped the recruit → follow → permanent-death life-cycle for a single VS companion. T45 grows the
 * party toward "several companions" and gives it the FR-NPC-03 depth the one-companion slice deferred:
 *
 *   - **A bounded, eligible party.** Recruiting is gated by a {@link PARTY_CAP} (an unbounded party was
 *     untested at scale, QA L3) and by disposition — a `hostile` survivor tolerates you at best and will
 *     never *join* you, however high trust climbs (they'll parley, trade, be robbed, but not follow).
 *   - **Named companions.** A recruit carries their {@link NPCState.name} and {@link NPCState.trust} onto
 *     the {@link Survivor} record, so party prose names them (closes the M3 "your companion" gap, L1) and
 *     the standing-order gate has a value to read.
 *   - **Trust-gated standing orders.** A companion at your side can be told to **follow** (default),
 *     **hold** (wait here), **scavenge** (range out and bank supplies at the base), or **guard** (hold the
 *     base and keep its barricades up). The two that put them in harm's way for you — scavenge and guard —
 *     are gated on trust ≥ {@link ORDER_TRUST_MIN}: a companion you have only just earned (recruited at 70)
 *     will follow and hold, but won't range out or hold the line until you've earned them further (feeding
 *     them raises it). Orders live as flags on the companion, so nothing in the save shape changes.
 *   - **Permanent, remembered death (T36, unchanged).** A companion whose needs saturate dies: removed
 *     from `actors` forever, remembered by a `fallen.<id>` flag and a `companion.died` Living-History beat.
 *
 * Still deferred to later M-work: combat participation and full autonomy (FR-NPC-03 remainder), off-screen
 * upkeep (PL-M3-02/05), desertion/betrayal & inter-NPC bonds (T53). Pure, integer-only, no clock, no RNG.
 */

import type { ActorId, GameState, InventoryEntry, NodeId, NPCDisposition, NPCState, Survivor } from "../state/types.js";
import type { SceneChoice, Action } from "../pipeline/contract.js";
import { driftNeeds, NEED_FATAL } from "./survival.js";

/** Flag marking a `Survivor` as a party companion that follows the player (vs a reserved faction member). */
export const COMPANION_FLAG = "companion" as const;

/** The most companions a player may have at once (T45 · QA L3). Recruiting a further survivor is refused. */
export const PARTY_CAP = 3;

/** Trust a companion needs before they'll take a *dangerous* standing order (scavenge / guard). */
export const ORDER_TRUST_MIN = 80;
/** Trust a companion gains when you share food/water with them (feeding earns the harder orders). */
export const COMPANION_SHARE_TRUST = 8;

/** Standing orders a companion can hold. `follow` (the default) is the T36 behaviour. */
export type CompanionOrder = "follow" | "hold" | "scavenge" | "guard";
const ORDER_FLAG: { readonly [o in Exclude<CompanionOrder, "follow">]: string } = {
  hold: "order:hold",
  scavenge: "order:scavenge",
  guard: "order:guard",
};

/** Scavenge economy: a scavenging companion banks one supply per this many hours, and drains faster for it. */
export const SCAVENGE_HOURS_PER_UNIT = 2;
export const SCAVENGE_ITEM = "item.canned-food";
export const SCAVENGE_EXTRA_DRAIN = 2; // extra hunger/thirst per hour — ranging out is exposure
/** Guard economy: a guarding companion maintains their node's barricades against the T38 decay, per hour. */
export const GUARD_UPKEEP_PER_HOUR = 1;
const BARRICADE_MAX = 100;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** Whether a tracked `Survivor` is a recruited party companion. */
export function isCompanion(actor: Survivor): boolean {
  return actor.flags[COMPANION_FLAG] === true;
}

/** The party companions' actor ids (recruited `Survivor`s), in stable id order. */
export function companionIds(state: GameState): readonly ActorId[] {
  return Object.keys(state.actors)
    .filter((id) => isCompanion(state.actors[id]!))
    .sort();
}

/** Living companions at a node, in stable id order — the T35 share verbs feed these too. */
export function companionsHere(state: GameState, node: NodeId): readonly Survivor[] {
  return companionIds(state)
    .map((id) => state.actors[id]!)
    .filter((c) => c.location === node);
}

/** A companion's display name for prose/labels, falling back to a generic label if none was carried (L1). */
export function companionName(actor: Survivor): string {
  return actor.name ?? "your companion";
}

/** The standing order a companion currently holds (default `follow`). */
export function orderOf(actor: Survivor): CompanionOrder {
  if (actor.flags[ORDER_FLAG.scavenge]) return "scavenge";
  if (actor.flags[ORDER_FLAG.guard]) return "guard";
  if (actor.flags[ORDER_FLAG.hold]) return "hold";
  return "follow";
}

/** Return the companion with a single standing order set (clearing the others); `follow` clears them all. */
function withOrder(actor: Survivor, order: CompanionOrder): Survivor {
  const flags: Record<string, boolean> = { ...actor.flags };
  delete flags[ORDER_FLAG.hold];
  delete flags[ORDER_FLAG.scavenge];
  delete flags[ORDER_FLAG.guard];
  if (order !== "follow") flags[ORDER_FLAG[order]] = true;
  return { ...actor, flags };
}

// --- recruitment ----------------------------------------------------------------------------

/** Whether the party has room for another companion. */
export function partyIsFull(state: GameState): boolean {
  return companionIds(state).length >= PARTY_CAP;
}

/**
 * Whether a met, trusted survivor may actually be recruited *right now* (T45): the party has room and the
 * survivor is not `hostile` (a hostile one never joins, however high trust runs). Pairs with the T34
 * `canRecruit` trust gate — the offer needs both.
 */
export function canRecruitEligible(state: GameState, npc: NPCState): boolean {
  return npc.disposition !== "hostile" && !partyIsFull(state);
}

/**
 * Graduate a survivor from `npcs` (met) into `actors` (joined) — the T36 recruitment, now carrying the
 * survivor's `name` + `trust` (T45) so the party can name them and gate their orders. Refuses if the id is
 * not a living survivor, the party is full, or the survivor is a hostile who would never join — so a
 * caller that skips the offer gate still can't overfill or shanghai a hostile. Pure, deterministic.
 */
export function recruit(state: GameState, npcId: ActorId): GameState {
  const npc = state.npcs[npcId];
  if (npc === undefined || !npc.alive) return state;
  if (!canRecruitEligible(state, npc)) return state;
  const companion: Survivor = {
    id: npc.id,
    type: npc.type,
    name: npc.name,
    trust: npc.trust,
    condition: {
      needs: npc.needs,
      wounds: [],
      infection: { stage: "none", progression: 0 },
      mind: { stress: 0, morale: 60 },
    },
    location: state.player.location,
    groupId: null,
    relationships: {},
    inventory: [],
    flags: { [COMPANION_FLAG]: true },
  };
  const npcs: Record<ActorId, NPCState> = { ...state.npcs };
  delete npcs[npcId];
  return { ...state, npcs, actors: { ...state.actors, [npcId]: companion } };
}

/** Raise a companion's trust (feeding earns the harder orders); clamped 0–100. Inert if not a companion. */
export function rewardCompanionTrust(state: GameState, id: ActorId, delta: number): GameState {
  const c = state.actors[id];
  if (c === undefined || !isCompanion(c)) return state;
  const trust = clampPct((c.trust ?? 0) + delta);
  if (trust === (c.trust ?? 0)) return state;
  return { ...state, actors: { ...state.actors, [id]: { ...c, trust } } };
}

// --- standing orders ------------------------------------------------------------------------

/** The order choices a companion at the player's node can be given (only the ones not already active). */
function ordersFor(state: GameState, c: Survivor): readonly { readonly order: CompanionOrder; readonly label: string }[] {
  const current = orderOf(c);
  const name = companionName(c);
  const trusted = (c.trust ?? 0) >= ORDER_TRUST_MIN;
  const hasBase = state.player.shelterId !== null;
  const out: { order: CompanionOrder; label: string }[] = [];
  if (current !== "follow") out.push({ order: "follow", label: `Tell ${name} to follow you` });
  if (current !== "hold") out.push({ order: "hold", label: `Tell ${name} to hold here` });
  if (trusted && hasBase && current !== "scavenge") out.push({ order: "scavenge", label: `Send ${name} to scavenge for the base` });
  if (trusted && current !== "guard") out.push({ order: "guard", label: `Set ${name} to guard the base` });
  return out;
}

/**
 * Free (0-hour) party-management choices for every companion at the player's node — like the T18 drop and
 * T39 stash verbs, they change state without advancing the clock. The dangerous orders (scavenge/guard)
 * appear only once a companion is trusted enough (ORDER_TRUST_MIN) — a companion you have not earned simply
 * isn't offered them, the legible form of "they'd refuse". Empty when no companion is with you.
 */
export function companionOrderChoices(state: GameState): readonly SceneChoice[] {
  const here = state.player.location;
  const choices: SceneChoice[] = [];
  for (const c of companionsHere(state, here)) {
    for (const { order, label } of ordersFor(state, c)) {
      choices.push({
        id: `order:${c.id}:${order}`,
        label,
        timeCost: 0,
        action: { type: "order", choiceId: `order:${c.id}:${order}`, timeCost: 0, params: { companion: c.id, order } },
      });
    }
  }
  return choices;
}

/** Whether an action is a companion standing-order (used by validation + dispatch). */
export function isCompanionOrderAction(action: Action): boolean {
  return action.type === "order";
}

const ORDER_VALUES: readonly CompanionOrder[] = ["follow", "hold", "scavenge", "guard"];

/** Apply a standing-order action (pipeline stage 3): set the named companion's order. Inert if ineligible. */
export function resolveCompanionOrder(state: GameState, action: Action): GameState {
  const id = typeof action.params?.["companion"] === "string" ? (action.params["companion"] as ActorId) : null;
  const order = action.params?.["order"];
  if (id === null || typeof order !== "string" || !ORDER_VALUES.includes(order as CompanionOrder)) return state;
  const c = state.actors[id];
  if (c === undefined || !isCompanion(c)) return state;
  const o = order as CompanionOrder;
  // Re-check the trust gate here too (a caller that skips the offer can't sneak a dangerous order through).
  if ((o === "scavenge" || o === "guard") && (c.trust ?? 0) < ORDER_TRUST_MIN) return state;
  if (o === "scavenge" && state.player.shelterId === null) return state;
  const updated = withOrder(c, o);
  return updated === c ? state : { ...state, actors: { ...state.actors, [id]: updated } };
}

// --- per-turn upkeep (pipeline stage 5) -----------------------------------------------------

/** Merge `count` units of `type` into a stash list (a non-unique stack). Pure. */
function bankToStash(stash: readonly InventoryEntry[], type: string, count: number): readonly InventoryEntry[] {
  if (count <= 0) return stash;
  const idx = stash.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return [...stash, { type, quantity: count }];
  return stash.map((e, i) => (i === idx ? { ...e, quantity: e.quantity + count } : e));
}

/**
 * Advance the party for a resolved turn (pipeline stage 5, after {@link tickNpcs}). For each living
 * companion, by standing order: **follow** keeps them at your side (location tracks the player, as T36);
 * **hold/guard/scavenge** keep them where they are. A **scavenger** drains faster (exposure) and banks a
 * supply into the base stash every {@link SCAVENGE_HOURS_PER_UNIT} hours (closes part of PL-M3-01 — the
 * base can feed itself, not only the pack); a **guard** maintains their node's barricades against the T38
 * decay. Needs still saturate to a permanent, remembered death (T36). Inert on a zero-hour tick or an empty
 * party (empty-turn contract) — and a default-order (`follow`) party behaves byte-identically to pre-T45.
 * Pure — no RNG, no clock.
 */
export function tickCompanions(state: GameState, hours: number): GameState {
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  const ids = companionIds(state);
  if (ids.length === 0) return state;

  const here = state.player.location;
  let actors: Record<ActorId, Survivor> = state.actors as Record<ActorId, Survivor>;
  let flags = state.player.flags;
  let stash = state.player.stash;
  let nodes = state.nodes as GameState["nodes"];
  let changed = false;
  let mourned = false;

  for (const id of ids) {
    const c = actors[id]!;
    const order = orderOf(c);
    let needs = driftNeeds(c.condition.needs, false, h);
    if (order === "scavenge") {
      needs = { ...needs, hunger: clampPct(needs.hunger + SCAVENGE_EXTRA_DRAIN * h), thirst: clampPct(needs.thirst + SCAVENGE_EXTRA_DRAIN * h) };
    }

    if (needs.hunger >= NEED_FATAL || needs.thirst >= NEED_FATAL) {
      const next: Record<ActorId, Survivor> = { ...actors };
      delete next[id];
      actors = next;
      flags = { ...flags, [`fallen.${id}`]: true };
      changed = true;
      mourned = true;
      continue;
    }

    const location = order === "follow" ? here : c.location;
    if (needs !== c.condition.needs || location !== c.location) {
      actors = { ...actors, [id]: { ...c, location, condition: { ...c.condition, needs } } };
      changed = true;
    }

    // Scavenge banks supplies at the base (needs a claimed shelter to bank into).
    if (order === "scavenge" && state.player.shelterId !== null) {
      const units = Math.trunc(h / SCAVENGE_HOURS_PER_UNIT);
      if (units > 0) {
        stash = bankToStash(stash, SCAVENGE_ITEM, units);
        changed = true;
      }
    }
    // Guard maintains the barricades of the node it holds (only where there are barricades to keep).
    if (order === "guard") {
      const gnode = nodes[c.location ?? ""];
      if (gnode !== undefined && gnode.barricades > 0) {
        const barricades = Math.min(BARRICADE_MAX, gnode.barricades + GUARD_UPKEEP_PER_HOUR * h);
        if (barricades !== gnode.barricades) {
          nodes = { ...nodes, [c.location!]: { ...gnode, barricades } };
          changed = true;
        }
      }
    }
  }

  if (!changed) return state;
  const player =
    mourned || stash !== state.player.stash
      ? { ...state.player, flags, stash }
      : state.player;
  return { ...state, actors, player, nodes };
}

/**
 * Permanently remove a companion (a combat death or scripted loss) — the FR-NPC-04 transition exposed for
 * later callers. Removed from `actors` for good and remembered by a `fallen.<id>` flag on the player; the
 * Living History records `companion.died` by diffing `actors`. Inert if the id is not a companion. Pure.
 */
export function killCompanion(state: GameState, id: ActorId): GameState {
  const actor = state.actors[id];
  if (actor === undefined || !isCompanion(actor)) return state;
  const actors: Record<ActorId, Survivor> = { ...state.actors };
  delete actors[id];
  return {
    ...state,
    actors,
    player: { ...state.player, flags: { ...state.player.flags, [`fallen.${id}`]: true } },
  };
}
