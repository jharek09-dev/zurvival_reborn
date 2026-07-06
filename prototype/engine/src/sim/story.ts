/**
 * The first authored story arc (M3 task T40 · FR-STORY-01 · GDD Part IV).
 *
 * Proof that the systems can carry a *story*. Not a cutscene — a **deterministic trigger chain over the
 * sim**: the arc watches the state the other systems produce (a survivor you met, grinding hungry, and a
 * base for her to come to), fires a beat when the world has set the stage, hands the player a **costed
 * choice**, and pays out a **consequence that ripples back** into trust (T34), the stash (T39), the
 * shelter (T38), and the Living History (T31).
 *
 * "The Last Customer" — Ruth, the desperate survivor who has been robbed twice and is nearly out of
 * everything, turns up at your barricade. **Take her in** (spend hours and draw from your cache to feed
 * and shelter her) and her trust climbs; **turn her away** and it collapses below parley — and, a while
 * later, she comes back for what you would not share (a raid on the stash, the FR-SHL-03 hook made into a
 * story beat).
 *
 * No save-schema rung: the arc rides two shapes reserved and inert since T3 — `story.progress[arcId]`
 * (the beat counter) and `queue` (the delayed consequence). An arc is **opt-in registered** into a run by
 * seeding `progress[arcId]`, so a run that does not enable it — and every prior golden — has no active
 * arc and is byte-identical. Two identity pipeline stages graduate (12 `resolveQueue`, 13 `evaluateStory`)
 * with their names and order unchanged, inert when no arc is active / the queue is empty.
 *
 * Pure, deterministic, dependency-free, integer-only (ADR-0001). No RNG — every trigger is a predicate,
 * every consequence a fixed transform, so the whole arc replays byte-for-byte from its seed.
 */

import type { ActorId, GameState, HistoryEvent, InventoryEntry, ScheduledEvent } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import { adjustTrust } from "./trust.js";
import { depleteStash as depleteStashLocal, removeStashUnits, stashUnits } from "./stash.js";

// --- beats: the integer values `story.progress[arcId]` moves through -------------------------

export const ARC_DORMANT = 0; // registered, waiting for the world to set the stage
export const ARC_PLEA = 1; // the survivor is at your door — awaiting the player's choice
export const ARC_HELPED = 2; // taken in — a good consequence is enqueued
export const ARC_REFUSED = 3; // turned away — a cold consequence is enqueued
export const ARC_RESOLVED_GOOD = 4; // the good consequence has paid out
export const ARC_RESOLVED_COLD = 5; // the cold consequence has landed

/** The scheduled-event kind the arc enqueues for its delayed consequence (resolved in stage 12). */
export const STORY_EVENT_KIND = "story.arc";

// --- the arc definition (VS: authored engine-side, dials mirrored in content/arcs) ------------

export interface StoryArc {
  readonly id: string;
  /** The survivor the arc is about — its trigger and ripples read this npc. */
  readonly subject: ActorId;
  /** Hunger/thirst at or above which the systems have produced "a survivor in trouble". */
  readonly needThreshold: number;
  /** Hours the two choices spend (both > 0 — real resolved turns, FR-CORE-03/04). */
  readonly helpCost: number;
  readonly refuseCost: number;
  /** Cache units drawn to take her in (the T39 stash gates the good branch). */
  readonly stashDraw: number;
  /** Trust shifts (asymmetric — the refusal is a betrayal that sticks, T34). */
  readonly helpTrust: number;
  readonly refuseTrust: number;
  /** Need relief when you feed and shelter her. */
  readonly relief: number;
  /** Hours until the delayed consequence comes due. */
  readonly delayHours: number;
  /** The good repayment — supplies she brings back to your cache. */
  readonly repay: readonly InventoryEntry[];
  readonly repayTrust: number;
  /** The cold raid — units taken from the cache and barricade integrity knocked off. */
  readonly raidUnits: number;
  readonly barricadeHit: number;
}

/** The Vertical-Slice arc. Its dials are first-pass, tuned against the Fun Gate (T42) / M5 balance. */
export const THE_LAST_CUSTOMER: StoryArc = {
  id: "arc.rivermouth.the-last-customer",
  subject: "npc.ruth",
  needThreshold: 60,
  helpCost: 2,
  refuseCost: 1,
  stashDraw: 2,
  helpTrust: 25,
  refuseTrust: -35,
  relief: 45,
  delayHours: 12,
  repay: [
    { type: "item.canned-food", quantity: 2 },
    { type: "item.water", quantity: 1 },
  ],
  repayTrust: 20,
  raidUnits: 3,
  barricadeHit: 20,
};

/** Every authored arc the engine knows, keyed by id. One in the VS; the library grows in M4. */
export const STORY_ARCS: readonly StoryArc[] = [THE_LAST_CUSTOMER];

/** Look up an arc definition by id (undefined for an unknown id). */
export function arcOf(id: string): StoryArc | undefined {
  return STORY_ARCS.find((a) => a.id === id);
}

// --- registration: opt-in, seeded into the reserved story.progress ----------------------------

/**
 * Enable arcs in a run by seeding `story.progress[arcId] = ARC_DORMANT` for each *known* arc id. Called
 * by `startRun`; a run that registers none (every prior caller) keeps `progress {}` and is untouched.
 * Idempotent — an already-registered arc is left at its current beat.
 */
export function registerArcs(state: GameState, arcIds: readonly string[]): GameState {
  const progress: Record<string, number> = { ...state.story.progress };
  let changed = false;
  for (const id of arcIds) {
    if (arcOf(id) === undefined || id in progress) continue;
    progress[id] = ARC_DORMANT;
    changed = true;
  }
  return changed ? { ...state, story: { ...state.story, progress } } : state;
}

/** The ids of arcs active (registered) in this run, in stable order. Empty for every prior run. */
export function activeArcs(state: GameState): readonly string[] {
  return Object.keys(state.story.progress).filter((id) => arcOf(id) !== undefined).sort();
}

// --- helpers ----------------------------------------------------------------------------------

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** The player stands in the base they claimed — where the plea and its choices surface. */
function atOwnShelter(state: GameState): boolean {
  const sid = state.player.shelterId;
  return sid !== null && sid === state.player.location;
}

/** Stamp a story beat for the Living History. */
function beat(state: GameState, arc: StoryArc, to: number, extra: HistoryEvent["data"] = {}): HistoryEvent {
  return {
    day: state.meta.day,
    hour: state.meta.hour,
    turn: state.meta.turn,
    type: "story.beat",
    subjects: [arc.id, arc.subject],
    data: { arc: arc.id, beat: to, ...(extra as object) },
  };
}

/** Add a stack of items to a store, merging onto an existing same-type entry. Pure. */
function addStack(entries: readonly InventoryEntry[], add: readonly InventoryEntry[]): readonly InventoryEntry[] {
  let out = [...entries];
  for (const a of add) {
    const idx = out.findIndex((e) => e.type === a.type && e.itemId === undefined);
    out = idx === -1 ? [...out, { type: a.type, quantity: a.quantity }] : out.map((e, i) => (i === idx ? { ...e, quantity: e.quantity + a.quantity } : e));
  }
  return out;
}

/** The beat an arc currently sits at (ARC_DORMANT default if somehow unset). */
export function arcBeat(state: GameState, arcId: string): number {
  return state.story.progress[arcId] ?? ARC_DORMANT;
}

// --- stage 13: auto-trigger the plea when the world has set the stage -------------------------

/** Fire one arc's dormant→plea trigger if its predicate holds. Pure; inert otherwise. */
function triggerArc(state: GameState, arc: StoryArc): GameState {
  if (arcBeat(state, arc.id) !== ARC_DORMANT) return state;
  if (!atOwnShelter(state)) return state; // she comes to the base — you must be home
  const npc = state.npcs[arc.subject];
  if (npc === undefined || !npc.alive || !npc.met) return state; // a stranger cannot come to your door
  const inTrouble = npc.needs.hunger >= arc.needThreshold || npc.needs.thirst >= arc.needThreshold;
  if (!inTrouble) return state;
  const progress = { ...state.story.progress, [arc.id]: ARC_PLEA };
  return { ...state, story: { ...state.story, progress }, history: [...state.history, beat(state, arc, ARC_PLEA)] };
}

/**
 * Stage 13 body (before the Living-History diff): advance every active arc's auto-triggers. Inert when
 * no arc is active, so every prior run is byte-identical. Pure.
 */
export function evaluateArcs(state: GameState): GameState {
  let s = state;
  for (const id of activeArcs(s)) {
    const arc = arcOf(id)!;
    s = triggerArc(s, arc);
  }
  return s;
}

// --- the costed choices (availableActions + stage-3 dispatch) ---------------------------------

/** The arc choices offered from the player's current node — the plea's fork. Empty unless a plea is live here. */
export function storyChoices(state: GameState): readonly SceneChoice[] {
  const choices: SceneChoice[] = [];
  if (!atOwnShelter(state)) return choices;
  for (const id of activeArcs(state)) {
    const arc = arcOf(id)!;
    if (arcBeat(state, id) !== ARC_PLEA) continue;
    const npc = state.npcs[arc.subject];
    const name = npc?.name ?? "the survivor";
    // Take her in — offered only when the cache can cover it (T39 gates the good branch).
    if (stashUnits(state.player.stash) >= arc.stashDraw) {
      choices.push({
        id: `story-help:${id}`,
        label: `Take ${name} in — shelter her (costs ${arc.stashDraw} from your cache)`,
        timeCost: arc.helpCost,
        action: { type: "story-help", choiceId: `story-help:${id}`, timeCost: arc.helpCost, params: { arc: id } },
      });
    }
    // Turn her away — always available (never a soft-lock).
    choices.push({
      id: `story-refuse:${id}`,
      label: `Turn ${name} away`,
      timeCost: arc.refuseCost,
      action: { type: "story-refuse", choiceId: `story-refuse:${id}`, timeCost: arc.refuseCost, params: { arc: id } },
    });
  }
  return choices;
}

/** Whether an action is one this module owns (used by validation + dispatch). */
export function isStoryAction(action: Action): boolean {
  return action.type === "story-help" || action.type === "story-refuse";
}

/** Enqueue the delayed consequence, dueDay/dueHour computed from the (already-advanced) clock + delay. */
function enqueue(state: GameState, arc: StoryArc, branch: "good" | "cold"): readonly ScheduledEvent[] {
  const total = state.meta.hour + arc.delayHours;
  const event: ScheduledEvent = {
    id: `${arc.id}.consequence`,
    dueDay: state.meta.day + Math.floor(total / 24),
    dueHour: total % 24,
    kind: STORY_EVENT_KIND,
    data: { arc: arc.id, branch },
  };
  return [...state.queue, event];
}

/** Take the survivor in: spend cache + ease her need + lift trust; enqueue the good repayment. */
function help(state: GameState, arc: StoryArc): GameState {
  if (arcBeat(state, arc.id) !== ARC_PLEA) return state;
  const npc = state.npcs[arc.subject];
  if (npc === undefined || !npc.alive) return state;
  if (stashUnits(state.player.stash) < arc.stashDraw) return state; // gate: you must have the supplies
  const { stash } = removeStashUnits(state.player.stash, arc.stashDraw);
  const easedNeeds = { ...npc.needs, hunger: clampPct(npc.needs.hunger - arc.relief), thirst: clampPct(npc.needs.thirst - arc.relief) };
  const eased = adjustTrust({ ...npc, needs: easedNeeds }, arc.helpTrust);
  const progress = { ...state.story.progress, [arc.id]: ARC_HELPED };
  return {
    ...state,
    player: { ...state.player, stash },
    npcs: { ...state.npcs, [arc.subject]: eased },
    story: { ...state.story, progress },
    queue: enqueue(state, arc, "good"),
    history: [...state.history, beat(state, arc, ARC_HELPED)],
  };
}

/** Turn the survivor away: her trust collapses below parley; enqueue the cold return. */
function refuse(state: GameState, arc: StoryArc): GameState {
  if (arcBeat(state, arc.id) !== ARC_PLEA) return state;
  const npc = state.npcs[arc.subject];
  if (npc === undefined || !npc.alive) return state;
  const turned = adjustTrust(npc, arc.refuseTrust);
  const progress = { ...state.story.progress, [arc.id]: ARC_REFUSED };
  return {
    ...state,
    npcs: { ...state.npcs, [arc.subject]: turned },
    story: { ...state.story, progress },
    queue: enqueue(state, arc, "cold"),
    history: [...state.history, beat(state, arc, ARC_REFUSED)],
  };
}

/** Resolve a story action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. */
export function resolveStoryAction(state: GameState, action: Action): GameState {
  const id = typeof action.params?.["arc"] === "string" ? (action.params["arc"] as string) : null;
  if (id === null) return state;
  const arc = arcOf(id);
  if (arc === undefined) return state;
  switch (action.type) {
    case "story-help":
      return help(state, arc);
    case "story-refuse":
      return refuse(state, arc);
    default:
      return state;
  }
}

// --- stage 12: resolve the delayed consequence when it comes due -------------------------------

/** Is a scheduled event due at the resolved clock? */
function isDue(state: GameState, ev: ScheduledEvent): boolean {
  return ev.dueDay < state.meta.day || (ev.dueDay === state.meta.day && ev.dueHour <= state.meta.hour);
}

/** Apply the good repayment: she brings supplies back to your cache and warms to you further. */
function payGood(state: GameState, arc: StoryArc): GameState {
  const stash = addStack(state.player.stash, arc.repay);
  const npc = state.npcs[arc.subject];
  const npcs = npc !== undefined && npc.alive ? { ...state.npcs, [arc.subject]: adjustTrust(npc, arc.repayTrust) } : state.npcs;
  const progress = { ...state.story.progress, [arc.id]: ARC_RESOLVED_GOOD };
  return {
    ...state,
    player: { ...state.player, stash },
    npcs,
    story: { ...state.story, progress },
    history: [...state.history, beat(state, arc, ARC_RESOLVED_GOOD, { repay: Object.fromEntries(arc.repay.map((e) => [e.type, e.quantity])) })],
  };
}

/** Apply the cold return: she raids the cache and knocks the barricades — the raided-stash story beat. */
function payCold(state: GameState, arc: StoryArc): GameState {
  // The raid logs its own `stash.raided` beat via depleteStash; import lazily to avoid a cycle at load.
  let s = depleteStashLocal(state, arc.raidUnits);
  const sid = s.player.shelterId;
  if (sid !== null) {
    const node = s.nodes[sid];
    if (node !== undefined && node.barricades > 0) {
      const barricades = Math.max(0, node.barricades - arc.barricadeHit);
      if (barricades !== node.barricades) s = { ...s, nodes: { ...s.nodes, [sid]: { ...node, barricades } } };
    }
  }
  const progress = { ...s.story.progress, [arc.id]: ARC_RESOLVED_COLD };
  return { ...s, story: { ...s.story, progress }, history: [...s.history, beat(s, arc, ARC_RESOLVED_COLD)] };
}

/**
 * Stage 12 body: resolve every due story consequence in the queue, removing it as it pays out. Inert when
 * the queue holds no due story event, so every prior run (empty queue) is byte-identical. Pure.
 */
export function resolveDueStoryEvents(state: GameState): GameState {
  if (state.queue.length === 0) return state;
  let s = state;
  const remaining: ScheduledEvent[] = [];
  for (const ev of state.queue) {
    if (ev.kind !== STORY_EVENT_KIND || !isDue(s, ev)) {
      remaining.push(ev);
      continue;
    }
    const arc = arcOf(typeof ev.data === "object" && ev.data !== null && "arc" in ev.data ? String((ev.data as { arc: unknown }).arc) : "");
    const branch = typeof ev.data === "object" && ev.data !== null && "branch" in ev.data ? String((ev.data as { branch: unknown }).branch) : "";
    if (arc === undefined) { remaining.push(ev); continue; }
    s = branch === "good" ? payGood(s, arc) : payCold(s, arc);
  }
  return s.queue === remaining ? s : { ...s, queue: remaining };
}


// --- narration (composed into sceneOf by T41) -------------------------------------------------

/**
 * A one-line read of the live arc beat — the plea while it waits, the sheltering/foreboding while a
 * consequence is pending, and the outcome the turn it lands. Null when no arc has anything live to say.
 * Screen-reader-safe — all words. Surfaced in `sceneOf` (T41).
 */
export function storyLine(state: GameState): string | null {
  for (const id of activeArcs(state)) {
    const arc = arcOf(id)!;
    const npc = state.npcs[arc.subject];
    const name = npc?.name ?? "A survivor";
    const b = arcBeat(state, id);
    // A consequence that reached its terminal beat *this turn* — surface it once, where it happened. Scan
    // the log for this arc's beat at the current turn rather than peeking the last slot: stage 13 appends
    // world events (weather/nightfall/horde/route) after stage 12's story beat, so the resolution is not
    // reliably last on a time-advancing turn (and a 12h-delayed consequence always advances the clock).
    const resolvedThisTurn = state.history.some(
      (h) =>
        h.type === "story.beat" &&
        h.turn === state.meta.turn &&
        typeof h.data === "object" &&
        h.data !== null &&
        (h.data as { arc?: unknown }).arc === id &&
        (h.data as { beat?: unknown }).beat === b,
    );
    if (b === ARC_RESOLVED_GOOD && resolvedThisTurn) return `${name} slipped back at first light and left supplies in your cache — she remembered.`;
    if (b === ARC_RESOLVED_COLD && resolvedThisTurn) return `Your cache has been torn into and the barricade wrenched loose — ${name} came back for what you would not give.`;
    // Foreshadow (earlier hint): once you have met her and she is grinding toward the plea, at your base a
    // line reminds you that sheltering her will cost cache supplies — so the stash reads as preparation.
    if (b === ARC_DORMANT) {
      const sub = state.npcs[arc.subject];
      if (sub !== undefined && sub.alive && sub.met && atOwnShelter(state) && Math.max(sub.needs.hunger, sub.needs.thirst) >= arc.needThreshold - 20) {
        return `You keep thinking about ${name} out there — she looked half-starved. If she comes to your door, taking her in would mean sparing ${arc.stashDraw} from your cache; best keep some stashed.`;
      }
    }
    if (b === ARC_PLEA) {
      const need = arc.stashDraw;
      const have = stashUnits(state.player.stash);
      const gate =
        have >= need
          ? ` Sheltering her will take ${need} from your cache — you have ${have}, enough to take her in.`
          : ` Sheltering her would take ${need} from your cache, and you have ${have}. Stash ${need - have} more and you can take her in.`;
      return `${name} sways at your barricade, hollow-eyed and begging to be let in — she has nothing left.${gate}`;
    }
    if (b === ARC_HELPED) return `${name} is resting under your roof, some colour coming back to her.`;
    if (b === ARC_REFUSED) return `${name} is out there in the dark, and she knows exactly what your cache holds.`;
  }
  return null;
}
