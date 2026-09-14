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

import type { ContentId, GameState, NodeId } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { clampNoise } from "./noise.js";
import { cacheRead } from "./stash.js";
import { addItemBounded } from "./inventory.js";
import { releaseShelterVoluntarily, siegeLine } from "./siege.js";
import { claimSalvage, CLAIM_SALVAGE_ITEM, roomSlotsAuthored, roomSlotsOf, roomsAtShelter, DEMOLISH_COST, DEMOLISH_RECOVERY_PCT } from "./rooms.js";

/** The material spent to fortify — already produced by the T17 loot tables (generic/residential/industrial). */
export const SCRAP_ITEM = "item.scrap";

/** Time cost (hours) of the two shelter verbs. Both > 0 so every one is a resolved turn (FR-CORE-03/04).
 * Rebalanced T72 (playtest time-economy pass): claim 4→2, fortify 3→2 — settling a searched-clean base
 * shouldn't eat the day on top of the search itself. */
export const CLAIM_COST = 2;
export const FORTIFY_COST = 2;
/**
 * Time cost of walking away from a base (T83 · PL-M3-07). One hour: gathering what you can carry and
 * closing the door behind you. Non-zero like every other resolved verb (FR-CORE-03/04), and cheaper
 * than claiming because leaving is always easier than settling.
 */
export const ABANDON_COST = 1;

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

/**
 * Add up to `qty` units of a non-unique item to the pack, **stopping at {@link CARRY_CAPACITY}** —
 * returning the new inventory and how many actually fit.
 *
 * Bounded, and that is not incidental. `sim/inventory.ts` documents `inventoryWeight <=
 * CARRY_CAPACITY` as an invariant its own `addItemBounded` preserves, and an unbounded grant here
 * would have been the one hole in it: a claim at a rich building hands over enough scrap to break a
 * pack that is already near full. An audit of this task's own diff caught it. What will not fit is
 * left in the building — the leave-behind that T84 measured as never once happening (PL-M5-56), now
 * with an occasion that forces it.
 */
function grantBounded(inv: GameState["player"]["inventory"], type: string, qty: number): { inventory: GameState["player"]["inventory"]; took: number } {
  let inventory = inv;
  let took = 0;
  for (let i = 0; i < Math.max(0, Math.trunc(qty)); i += 1) {
    const r = addItemBounded(inventory, type);
    if (!r.carried) break;
    inventory = r.inventory;
    took += 1;
  }
  return { inventory, took };
}

// --- gates ------------------------------------------------------------------------------------

/**
 * Does this content set author safehouses at all? The master gate for the `claimable` rule (T83).
 *
 * `NodeDef.claimable` has been declared in `map/types.ts` since T13 and read by **exactly zero engine
 * code** ever since, so the fourteen hand-authored safehouses in `content/nodes/` were decorative and
 * every node in the city was equally claimable. Measured: **60 of 60 bot runs claimed the START node**
 * (`node.rivermouth.transit-plaza`) **on day 1**, one distinct node across sixty runs — and that node
 * does not declare `claimable`.
 *
 * Honouring the field is therefore a real behaviour change, which is why it rides an active-system gate
 * of exactly the shape `jobsActive` and the T81 weapon pool use: if **no** node in the graph declares
 * `claimable`, the rule is dark and every node is claimable (the pre-T83 behaviour, so every fixture
 * graph and every golden run is byte-identical); if **any** node declares it, only declared nodes are.
 * The shipped city declares fourteen, so the rule is live there and nowhere else.
 */
export function safehousesAuthored(graph: RegionGraph | undefined): boolean {
  if (graph === undefined) return false;
  for (const id of Object.keys(graph.nodes)) if (graph.nodes[id]?.claimable !== undefined) return true;
  return false;
}

/**
 * May the player claim the node they stand on? Only while they have **no shelter yet** (one active
 * shelter per run · FR-SHL-01), have **searched this node clean** (`searchPct >= 100`) — you secure a
 * building before you make it home — and, from T83, only where the content set says a safehouse can be
 * (see {@link safehousesAuthored}). The search gate also keeps claim inert on any run that never fully
 * searches a node, so prior golden scenes are untouched.
 *
 * `graph` is optional and the `claimable` rule is simply absent without one, so every existing caller
 * that had no graph to give keeps its exact prior behaviour.
 */
export function canClaimShelter(state: GameState, graph?: RegionGraph): boolean {
  const here = state.player.location;
  const node = state.nodes[here];
  if (state.player.shelterId !== null || node === undefined || node.searchPct < MAX_FORTIFICATION) return false;
  if (safehousesAuthored(graph) && graph!.nodes[here]?.claimable !== true) return false;
  return true;
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

/**
 * May the player walk away from the base they hold? Only while **standing in it** — abandoning a place
 * is something you do at the door, not from across the city. Closes PL-M3-07's "relocate/abandon" half:
 * until T83 `shelterId` had no clearer at all, so a base you had outgrown (or that a siege had beaten
 * flat) was yours forever and a better building found on day nine could never become home.
 */
export function canAbandonShelter(state: GameState): boolean {
  const sid = state.player.shelterId;
  return sid !== null && sid === state.player.location;
}

/**
 * The rooms the player could pull back out of their base (T85), in stable content order. Empty unless
 * the T85 layer is active and they are standing in their own shelter with something built in it.
 *
 * Demolition is what makes a slot a **decision rather than a mistake**: a garden installed on day two
 * can become a cistern on day nine at half the scrap back, so the wrong early choice costs you
 * materials and hours, not the run. Without it, slots would be a trap the player cannot see coming.
 */
export function demolishableRooms(state: GameState, graph?: RegionGraph): readonly ContentId[] {
  if (!roomSlotsAuthored(graph) || state.player.shelterId === null || state.player.shelterId !== state.player.location) return [];
  return [...roomsAtShelter(state)].sort((a, b) => a.localeCompare(b));
}

/**
 * Scrap a demolition returns for a room: {@link DEMOLISH_RECOVERY_PCT} of what its recipe's scrap
 * inputs cost, truncated. A room built from no scrap returns nothing, which is the honest answer —
 * you get back materials, not effort.
 */
export function demolishRecovery(graph: RegionGraph | undefined, room: ContentId): number {
  const recipe = (graph?.recipes ?? []).find((r) => r.installsRoom === room);
  if (recipe === undefined) return 0;
  const scrap = recipe.inputs.filter((i) => i.item === SCRAP_ITEM).reduce((a, i) => a + Math.max(0, Math.trunc(i.qty)), 0);
  return Math.max(0, Math.trunc((scrap * DEMOLISH_RECOVERY_PCT) / 100));
}

/** The shelter choices offered from the player's current node, in stable order. Empty when none applies. */
export function shelterChoices(state: GameState, graph?: RegionGraph): readonly SceneChoice[] {
  const choices: SceneChoice[] = [];
  if (canClaimShelter(state, graph)) {
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
  if (canAbandonShelter(state)) {
    choices.push({
      id: "abandon-shelter",
      label: "Leave this place behind",
      timeCost: ABANDON_COST,
      action: { type: "abandon-shelter", choiceId: "abandon-shelter", timeCost: ABANDON_COST },
    });
  }
  for (const room of demolishableRooms(state, graph)) {
    const back = demolishRecovery(graph, room);
    choices.push({
      id: `demolish:${room}`,
      label: back > 0 ? `Tear out the ${roomName(room)} (${back} scrap back)` : `Tear out the ${roomName(room)}`,
      timeCost: DEMOLISH_COST,
      action: { type: "demolish", choiceId: `demolish:${room}`, timeCost: DEMOLISH_COST, params: { room } },
    });
  }
  return choices;
}

/**
 * What the building has room for, in words and never a bare number pair (FR-UI-02 — the client does not
 * print the engine's integers at the player). Null when the T85 layer is dark, so no prior run's Scene
 * gains a sentence.
 */
export function roomsLine(state: GameState, graph?: RegionGraph): string | null {
  if (!roomSlotsAuthored(graph) || state.player.shelterId === null) return null;
  const total = roomSlotsOf(graph, state.player.shelterId);
  const used = roomsAtShelter(state).length;
  const free = Math.max(0, total - used);
  if (used === 0) return free === 1 ? "There is space in it for one thing." : `There is space in it for ${countWord(free)} things.`;
  if (free === 0) return "There is nothing left to build into it — something would have to come out first.";
  return free === 1 ? "There is space in it for one more thing." : `There is space in it for ${countWord(free)} more.`;
}

/** Small integers as words — the Scene never prints a bare count (FR-UI-02). */
function countWord(n: number): string {
  return ["nothing", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
}

/** A room content id as the player reads it: `room.medical` -> "medical bay" where authored, else the bare noun. */
function roomName(room: ContentId): string {
  const bare = room.startsWith("room.") ? room.slice("room.".length) : room;
  return bare.replace(/-/g, " ");
}

// --- dispatch (pipeline stage 3, from applyPlayerAction) --------------------------------------

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isShelterAction(action: Action): boolean {
  return action.type === "claim-shelter" || action.type === "fortify" || action.type === "abandon-shelter" || action.type === "demolish";
}

/**
 * Claim the node the player stands on as their base (T37). Sets `shelterId`, and — once the T85 layer
 * is active — **hands over what stripping the building was worth** ({@link claimSalvage}).
 *
 * ### Why a claim pays anything at all
 *
 * Claiming already requires `searchPct` 100: you have taken the place apart. Before T85 that work
 * bought a flag and nothing else, and the base economy had no entry fee it could pay — measured
 * (`measure/t85.ts --settle`, 40 goal-directed settler runs) a settler claimed on **day 1.6** and then
 * built **0 of the 7 rooms**, holding **0.65 scrap** against the cheapest room's 3. The materials were
 * always in the walls; nothing handed them over.
 *
 * Scaled by T84's authored `richness`, so a building already picked to the bones pays nothing and the
 * warehouse at the edge of the yard pays for two rooms. Paid into the **pack**, not the cache, so
 * T84's pack-weight pressure is what decides whether you can carry your own entry fee — the existing
 * system, not a route around it.
 *
 * Inert if the gate is closed, and pays 0 on any content set that authors no `roomSlots`.
 */
function claimShelter(state: GameState, graph?: RegionGraph): GameState {
  if (!canClaimShelter(state, graph)) return state;
  const here: NodeId = state.player.location;
  const node = state.nodes[here];
  // A building is stripped ONCE. Without this, claim -> abandon -> re-claim farms the payout, because
  // `searchPct` stays at 100 (found by `measure/t85.ts --ceiling`, which reported rooms "built in 245%
  // of runs" — an immortal bot recycling its own base on free scrap).
  const alreadyStripped = node?.stripped === true;
  const salvage = alreadyStripped ? 0 : claimSalvage(graph, here);
  const { inventory, took } = salvage > 0
    ? grantBounded(state.player.inventory, CLAIM_SALVAGE_ITEM, salvage)
    : { inventory: state.player.inventory, took: 0 };
  // The building is marked stripped on the CLAIM, not on what fitted in the pack. Marking it only when
  // `took > 0` would have re-opened the farm the mark exists to close: arrive full, claim for nothing,
  // drop a can, abandon, re-claim, and the walls pay out again.
  const nodes = salvage > 0 && node !== undefined ? { ...state.nodes, [here]: { ...node, stripped: true } } : state.nodes;
  const next: GameState = { ...state, nodes, player: { ...state.player, shelterId: here, inventory } };
  if (took <= 0) return next;
  const { day, hour, turn } = state.meta;
  return {
    ...next,
    history: [...next.history, { day, hour, turn, type: "shelter.stripped", subjects: [here], data: { item: CLAIM_SALVAGE_ITEM, units: took, offered: salvage } }],
  };
}

/**
 * Give up the base (T83 · PL-M3-07). Clears `shelterId` and leaves the cache, the barricades and the
 * dead exactly where they stand — an abandoned base is a building you no longer own, not a building
 * that burned. That is the whole difference between walking away and being broken out, which
 * `sim/siege.ts#breachShelter` handles the other way (it scatters the cache and leaves walkers in it).
 *
 * **What the cache does is worth stating precisely, because the first draft of this comment got it
 * wrong.** The stash lives on `player.stash`, not on the node, so it is not "still there to come back
 * for" — it travels with you, and every path that reads or writes it (`stashChoices`, `cacheRead`,
 * deposit and withdraw) is gated on `atOwnShelter`. So between abandoning one base and claiming the
 * next, the banked units are intact but **unreachable**, and they reappear at whatever you claim next.
 * Nothing is destroyed; nothing is spendable either.
 *
 * Re-validates its gate, so a forged action outside the base is inert.
 */
function abandonShelter(state: GameState): GameState {
  if (!canAbandonShelter(state)) return state;
  const sid = state.player.shelterId!;
  const { day, hour, turn } = state.meta;
  // Through the shared tenancy teardown, so abandoning clears the banked night and the residents' job
  // assignments exactly as a breach does — the audit found the first cut leaving both behind, which let
  // hours banked at an abandoned base buy a siege check at the next one.
  const next = releaseShelterVoluntarily(state);
  return {
    ...next,
    history: [...next.history, { day, hour, turn, type: "shelter.abandoned", subjects: [sid], data: {} }],
  };
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
export function resolveShelterAction(state: GameState, action: Action, graph?: RegionGraph): GameState {
  switch (action.type) {
    case "claim-shelter":
      return claimShelter(state, graph);
    case "fortify":
      return fortifyShelter(state);
    case "abandon-shelter":
      return abandonShelter(state);
    case "demolish": {
      const room = typeof action.params?.["room"] === "string" ? (action.params["room"] as string) : "";
      return demolishRoom(state, room, graph);
    }
    default:
      return state;
  }
}

/**
 * Tear a room back out of the base (T85): frees its slot and returns {@link demolishRecovery} scrap.
 *
 * Re-validates its whole gate rather than trusting the offered choice, so a forged action — off a
 * shelter, on a room that is not built, or on a content set with the T85 layer dark — is inert.
 */
function demolishRoom(state: GameState, room: string, graph?: RegionGraph): GameState {
  if (!demolishableRooms(state, graph).includes(room)) return state;
  const sid = state.player.shelterId!;
  const node = state.nodes[sid]!;
  const back = demolishRecovery(graph, room);
  const { inventory } = back > 0 ? grantBounded(state.player.inventory, SCRAP_ITEM, back) : { inventory: state.player.inventory };
  const { day, hour, turn } = state.meta;
  return {
    ...state,
    player: { ...state.player, inventory },
    nodes: { ...state.nodes, [sid]: { ...node, rooms: node.rooms.filter((r) => r !== room) } },
    history: [...state.history, { day, hour, turn, type: "shelter.demolished", subjects: [sid, room], data: { room, recovered: back } }],
  };
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
export function shelterLine(state: GameState, graph?: RegionGraph): string | null {
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
    // T83: what the dark is doing out there, when it is doing anything. Composed here rather than as a
    // separate line so the base still reads as one paragraph.
    const siege = siegeLine(state, graph);
    // T85 legibility: the slot rule is invisible otherwise — a recipe the player can afford simply
    // stops being offered and nothing says why. The T84 lesson in reverse: when the engine acquires a
    // constraint, the screen has to acquire the sentence. Only on a set that authors slots.
    const room = roomsLine(state, graph);
    return `This is your shelter — ${read}.${hint}${room !== null ? ` ${room}` : ""}${cache !== null ? ` ${cache}` : ""}${siege !== null ? ` ${siege}` : ""}`;
  }
  if (canClaimShelter(state, graph)) {
    // The offer has to be honest about the walls: a building this run has ALREADY stripped has nothing
    // left to give, and promising material that the claim will not deliver is exactly the dead
    // affordance the T84 note is about — here in the prose rather than in a verb.
    const salvage = state.nodes[here]?.stripped === true ? 0 : claimSalvage(graph, here);
    if (salvage <= 0) return "You have searched this place clean; it could be made your own.";
    return salvage === 1
      ? "You have searched this place clean; it could be made your own — and there is a length of usable material still in its walls."
      : "You have searched this place clean; it could be made your own — and there is usable material still in its walls.";
  }
  // T83 legibility: with the `claimable` rule live, a safehouse the player has not yet stripped is
  // otherwise indistinguishable from the fifty-odd buildings that can never be one — the verb simply
  // fails to appear and nothing says why. The fourteen authored safehouses are the whole point of the
  // field; they have to be findable. Only on a run whose content set authors them, and only once the
  // player already has nowhere to live.
  if (state.player.shelterId === null && safehousesAuthored(graph) && graph?.nodes[here]?.claimable === true) {
    return "This place could be made to hold — if you stripped it out first.";
  }
  return null;
}
