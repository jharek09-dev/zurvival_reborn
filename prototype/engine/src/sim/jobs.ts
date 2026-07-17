/**
 * Shelter jobs & room capabilities (M4 task T52 · FR-SHL-03/04 · GDD Part XI "Shelter, Rooms & Jobs").
 *
 * The base stops being a pure sink. T37/T38 gave the run a place, T39 gave it a store, T51 let a recipe
 * build a room; T52 makes the base a **second loop that runs on its own**. Assign a companion to a room's
 * job — garden, kitchen, salvage, infirmary, generator — and it **produces or consumes the shared stash
 * over time, on your turns and while you are away** (FR-SHL-03), and each craftable room now **unlocks a
 * real capability** (FR-SHL-04): a job, the fridge (a kitchen keeps the base's fresh food from spoiling),
 * or the generator (burns fuel to hold `world.powerGrid` up). This is what makes keeping people a *base*
 * loop rather than a pack drain (closes PL-M3-01), and lands the deferred off-screen shelter upkeep
 * (PL-M3-05) and the community fridge / generator (PL-M4-29).
 *
 * Faithful to the T47/T50/T51 idiom, a job is authored JSON (`content/jobs/*.json`) interpreted
 * generically — no per-job branching — and the pool rides the transient `RegionGraph` (`graph.jobs`,
 * mirroring `graph.recipes`), so **a graph built without it leaves the whole system inert and every prior
 * run byte-identical**. Assignment is stored the T45 way — a `job:<id>` flag on the `Survivor` — so, like
 * T45/T50, T52 takes **no save-schema rung** (stays v10) and touches no migration code. Jobs move only
 * *existing* items (food/water/scrap/cloth/bandage/fuel) between the stash and the world, so **no lootable
 * item is added and the shared loot tables are untouched** — the `floor(f·len)` byte-identity hazard T50/
 * T51 had to gate simply never arises here. Every passive world mutation (the generator's `powerGrid`, the
 * fridge's stash spoilage, off-screen barricade decay) sits behind `jobsActive`. Pure, deterministic,
 * dependency-free, integer-only, no RNG (ADR-0001).
 */

import type { ActorId, ContentId, GameState, HistoryEvent, InventoryEntry, Survivor } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { companionIds, companionName, isCompanion } from "./companions.js";
import { FRESH_FOOD_ITEM, SPOILED_FOOD_ITEM, POWER_SPOIL_AT } from "./economy.js";
import { FORTIFY_DECAY_PER_HOUR } from "./shelter.js";

// --- content shape (mirrored by content/schemas/job.schema.json) ------------------------------

/** One line of a job's per-cycle cost or yield: N units of an item id. Integer qty ≥ 1. */
export interface JobIO {
  readonly item: ContentId;
  readonly qty: number;
}

/**
 * A static shelter job — mirrors `content/schemas/job.schema.json`. The engine interprets these
 * generically: each cycle it debits `consumes` from the stash (skipping the cycle if it's short — a job
 * never drives the stash negative), then either credits `produces` to the stash or, for a `holdsPower`
 * job (the generator), raises `world.powerGrid`. A job runs only where its `room` is built (the FR-SHL-04
 * capability gate) and only while its assigned worker is a companion present at the shelter.
 */
export interface JobDef {
  readonly id: string;
  /** The assignment row name ("Tend the garden"). */
  readonly label: string;
  /** What the job does IN THE WORLD, in plain words ("Rooftop beds give up a little fresh food"). Never a number. */
  readonly worldEffect: string;
  /** The room that unlocks this job (FR-SHL-04) — the job is offered/works only where this room is built. */
  readonly room: ContentId;
  /** Drawn from the stash per cycle (a kitchen consumes fresh food; the generator, fuel). Omit for a pure producer. */
  readonly consumes?: JobIO;
  /** Banked into the stash per cycle (the garden's fresh food, the workshop's scrap). Omit for a hold-power job. */
  readonly produces?: JobIO;
  /** The generator: burn `consumes` to raise `world.powerGrid` instead of banking a `produces` item. */
  readonly holdsPower?: boolean;
  /** The watch: a resident on the watchtower keeps the shelter's `barricades` up each cycle (the upkeep shape). */
  readonly upkeepsBarricades?: boolean;
  /** Hours of work one cycle takes — the first-pass dial (M5 balance). Defaults to {@link DEFAULT_HOURS_PER_CYCLE}. */
  readonly hoursPerCycle?: number;
}

// --- the dials (first-pass identity values; M5 T59/T60 balance) -------------------------------

/** Default hours one job cycle takes when a job authors none. */
export const DEFAULT_HOURS_PER_CYCLE = 6;
/** `world.powerGrid` points one generator cycle restores (capped at 100). */
export const GEN_POWER_PER_CYCLE = 20;
/** Barricade points one watch cycle restores — tuned to hold a base steady against the T38 decay. */
export const WATCH_UPKEEP_PER_CYCLE = 6;
/** Off-screen barricade loss of at least this much surfaces a "the walls weakened while you were gone" note. */
export const WALL_WEAKENED_NOTE_AT = 3;
/** A resident is fed from the stash once hunger/thirst reaches this (0 satisfied … 100 critical). */
export const RESIDENT_FEED_AT = 55;
/** How far one stash ration/canteen brings a fed resident's need down. */
export const RESIDENT_FEED_RELIEF = 40;
/** Hours of a failing grid it takes to spoil one stash `item.food-fresh` unit when nothing keeps it cold. */
export const STASH_SPOIL_HOURS = 12;
/** A watchtower halves the off-screen barricade decay (a lookout keeps the wall up). */
export const WATCHTOWER_DECAY_DIVISOR = 2;

/** The room whose presence refrigerates the base's stash (the fridge — stash fresh food doesn't spoil). */
export const KITCHEN_ROOM = "room.kitchen";
/** The room that slows off-screen barricade decay. */
export const WATCHTOWER_ROOM = "room.watchtower";
/** The room that lets you broadcast without lighting up your own node (read in radio.ts). */
export const RADIO_ROOM = "room.radio";

/** Foods the base feeds a hungry resident, in preference order — fresh first (use it before it rots), then cans. */
const FEED_FOODS: readonly string[] = [FRESH_FOOD_ITEM, "item.canned-food"];
/** What the base gives a thirsty resident. */
const FEED_WATER = "item.water";

/** The flag prefix marking a companion's job assignment (`job:garden`). Mirrors T45's `order:` flags. */
export const JOB_FLAG_PREFIX = "job:";

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

// --- pool on the transient graph (never serialized) -------------------------------------------

/** The registered job pool for this run, or empty when none is registered (inert). */
export function jobPool(graph: RegionGraph | undefined): readonly JobDef[] {
  return graph?.jobs ?? [];
}

/** Look up a job def by id in the pool. */
export function jobOf(graph: RegionGraph | undefined, id: string): JobDef | undefined {
  return jobPool(graph).find((j) => j.id === id);
}

/**
 * Is the shelter-jobs system active on this run? The master gate: a graph built without a job pool leaves
 * the whole system dark — no job choices, no production tick, no feeding, no off-screen upkeep — so every
 * prior run (whose generators never register jobs) is byte-identical. Everything below is downstream of this.
 */
export function jobsActive(graph: RegionGraph | undefined): boolean {
  return jobPool(graph).length > 0;
}

// --- job assignment: a `job:<id>` flag on the companion (no save rung) -------------------------

/** The job id a companion is assigned to, or null. Reads the `job:<id>` flag (the T45 order idiom). */
export function jobIdOf(actor: Survivor): string | null {
  for (const k of Object.keys(actor.flags)) {
    if (k.startsWith(JOB_FLAG_PREFIX) && actor.flags[k] === true) return k.slice(JOB_FLAG_PREFIX.length);
  }
  return null;
}

/**
 * Set a companion's job assignment: clear any prior order/job flag, force order `hold` (a worker stays at
 * their post), and mark the new job. Pure — returns the updated companion.
 */
function withJob(actor: Survivor, jobId: string): Survivor {
  const flags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(actor.flags)) {
    if (!k.startsWith("order:") && !k.startsWith(JOB_FLAG_PREFIX)) flags[k] = v;
  }
  flags["order:hold"] = true; // a worker holds at the base (mirrors T45 ORDER_FLAG.hold)
  flags[JOB_FLAG_PREFIX + jobId] = true;
  return { ...actor, flags };
}

/** Clear a companion's job assignment (they go back to plain `hold`). Pure; inert if they hold no job. */
function withoutJob(actor: Survivor): Survivor {
  if (jobIdOf(actor) === null) return actor;
  const flags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(actor.flags)) if (!k.startsWith(JOB_FLAG_PREFIX)) flags[k] = v;
  return { ...actor, flags };
}

// --- gates ------------------------------------------------------------------------------------

/** Is the player standing in their own claimed shelter — the only place jobs are assigned (mirrors the bench). */
function atOwnShelter(state: GameState): boolean {
  return state.player.shelterId !== null && state.player.location === state.player.shelterId;
}

/** The rooms installed at the player's shelter node (empty off a shelter). */
function shelterRooms(state: GameState): readonly ContentId[] {
  const id = state.player.shelterId;
  return id !== null ? state.nodes[id]?.rooms ?? [] : [];
}

/** Living party companions currently at the player's shelter — the workers a job can be assigned to. */
function residentCompanions(state: GameState): readonly Survivor[] {
  const sid = state.player.shelterId;
  if (sid === null) return [];
  return companionIds(state)
    .map((id) => state.actors[id]!)
    .filter((c) => c.location === sid);
}

/** The jobs whose required room is built at the shelter — the ones that can be assigned/worked right now. */
export function buildableJobs(state: GameState, graph: RegionGraph | undefined): readonly JobDef[] {
  if (!jobsActive(graph) || state.player.shelterId === null) return [];
  const rooms = shelterRooms(state);
  return [...jobPool(graph)]
    .filter((j) => rooms.includes(j.room))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// --- the seam: choices / dispatch / resolution ------------------------------------------------

/**
 * The shelter-job actions offered from the current state, in stable order. Empty unless the jobs system is
 * active AND the player stands in their own shelter. One assign choice per (resident companion × buildable
 * job they aren't already on), plus a "take off duty" per assigned worker. Free (0h) base management, like
 * the T45 order and T39 stash verbs. Inert on every prior run (no job pool ⇒ no choices).
 */
export function jobChoices(state: GameState, graph: RegionGraph | undefined): readonly SceneChoice[] {
  if (!jobsActive(graph) || !atOwnShelter(state)) return [];
  const jobs = buildableJobs(state, graph);
  if (jobs.length === 0) return [];
  const choices: SceneChoice[] = [];
  for (const c of residentCompanions(state)) {
    const current = jobIdOf(c);
    const name = companionName(c);
    if (current !== null) {
      const job = jobOf(graph, current);
      choices.push({
        id: `clear-job:${c.id}`,
        label: `Take ${name} off ${job !== undefined ? job.label.toLowerCase() : "duty"}`,
        timeCost: 0,
        action: { type: "clear-job", choiceId: `clear-job:${c.id}`, timeCost: 0, params: { companion: c.id } },
      });
    }
    for (const job of jobs) {
      if (job.id === current) continue;
      choices.push({
        id: `assign-job:${c.id}:${job.id}`,
        label: `Set ${name} to ${job.label.toLowerCase()} — ${job.worldEffect}`,
        timeCost: 0,
        action: { type: "assign-job", choiceId: `assign-job:${c.id}:${job.id}`, timeCost: 0, params: { companion: c.id, job: job.id } },
      });
    }
  }
  return choices;
}

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export function isJobAction(action: Action): boolean {
  return action.type === "assign-job" || action.type === "clear-job";
}

/** Stamp + append a Living-History beat (append-only; never rewritten). Pure. */
function appendBeat(state: GameState, type: string, subjects: readonly string[], data: HistoryEvent["data"]): GameState {
  const { day, hour, turn } = state.meta;
  const beat: HistoryEvent = { day, hour, turn, type, subjects: [...subjects], data };
  return { ...state, history: [...state.history, beat] };
}

/** Assign a resident companion to a buildable job. Re-validates every gate; inert on a bad/forged action. */
function assignJob(state: GameState, graph: RegionGraph | undefined, companionId: ActorId, jobId: string): GameState {
  if (!atOwnShelter(state)) return state;
  const c = state.actors[companionId];
  if (c === undefined || !isCompanion(c) || c.location !== state.player.shelterId) return state;
  const job = jobOf(graph, jobId);
  if (job === undefined || !shelterRooms(state).includes(job.room)) return state;
  if (jobIdOf(c) === jobId) return state; // already on it
  const updated = withJob(c, jobId);
  const next: GameState = { ...state, actors: { ...state.actors, [companionId]: updated } };
  return appendBeat(next, "job.assigned", [companionId, jobId], { companion: companionId, job: jobId });
}

/** Take a companion off their job (back to plain hold). Inert if they hold none. */
function clearJob(state: GameState, companionId: ActorId): GameState {
  const c = state.actors[companionId];
  if (c === undefined || !isCompanion(c)) return state;
  const prior = jobIdOf(c);
  if (prior === null) return state;
  const updated = withoutJob(c);
  const next: GameState = { ...state, actors: { ...state.actors, [companionId]: updated } };
  return appendBeat(next, "job.cleared", [companionId], { companion: companionId, job: prior });
}

/** Resolve a shelter-job action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. */
export function resolveJobAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  const companion = typeof action.params?.["companion"] === "string" ? (action.params["companion"] as ActorId) : null;
  if (companion === null) return state;
  switch (action.type) {
    case "assign-job": {
      const job = typeof action.params?.["job"] === "string" ? (action.params["job"] as string) : "";
      return jobsActive(graph) ? assignJob(state, graph, companion, job) : state;
    }
    case "clear-job":
      return clearJob(state, companion);
    default:
      return state;
  }
}

// --- stash helpers (private; the module's own deterministic take/add, per house style) --------

/** How many units of a non-unique `type` a store holds. */
function stashCount(stash: readonly InventoryEntry[], type: string): number {
  let n = 0;
  for (const e of stash) if (e.type === type && e.itemId === undefined) n += Math.max(0, Math.trunc(e.quantity));
  return n;
}

/** Remove up to `qty` units of `type` from a store (first matching stack, deterministic). Drops empty stacks. */
function stashTake(stash: readonly InventoryEntry[], type: string, qty: number): { readonly stash: readonly InventoryEntry[]; readonly took: number } {
  let remaining = Math.max(0, Math.trunc(qty));
  if (remaining === 0) return { stash, took: 0 };
  let took = 0;
  const out: InventoryEntry[] = [];
  for (const e of stash) {
    if (remaining > 0 && e.type === type && e.itemId === undefined) {
      const t = Math.min(remaining, e.quantity);
      remaining -= t;
      took += t;
      const left = e.quantity - t;
      if (left > 0) out.push({ ...e, quantity: left });
      continue;
    }
    out.push(e);
  }
  return { stash: out, took };
}

/** Add `qty` units of `type` to a store (stacking onto the first matching stack, deterministic). */
function stashAdd(stash: readonly InventoryEntry[], type: string, qty: number): readonly InventoryEntry[] {
  const n = Math.max(0, Math.trunc(qty));
  if (n === 0) return stash;
  const idx = stash.findIndex((e) => e.type === type && e.itemId === undefined);
  if (idx === -1) return [...stash, { type, quantity: n }];
  return stash.map((e, i) => (i === idx ? { ...e, quantity: e.quantity + n } : e));
}

// --- the tick: jobs produce/consume, the base feeds its people, the fridge (stage 5 + off-screen) ---

/** A running tally of what the base did this tick — surfaced as the "daily report" by {@link jobLine}. */
interface ShelterReport {
  produced: Record<string, number>;
  consumed: Record<string, number>;
  fed: number;
  spoiled: number;
  powered: boolean;
  walled: boolean;
}

const bump = (rec: Record<string, number>, k: string, n: number): void => {
  if (n > 0) rec[k] = (rec[k] ?? 0) + n;
};

/**
 * Run the shelter's operations for `hours` — jobs produce/consume the stash, the base feeds its resident
 * companions, and unrefrigerated stash food spoils. Called from BOTH the pipeline (stage 5, after
 * `tickCompanions`) and `advanceWorld` (off-screen), so a played hour and a fast-forwarded hour do the same
 * thing. Gated `if (!jobsActive) return state` and inert on a zero-hour tick / off a shelter — so it
 * graduates stage 5's body exactly as T51 graduated stage 4's, and every prior run is untouched. Pure, no RNG.
 */
export function tickShelterOps(state: GameState, graph: RegionGraph | undefined, hours: number): GameState {
  if (!jobsActive(graph)) return state;
  const h = Math.max(0, Math.trunc(hours));
  const sid = state.player.shelterId;
  if (h === 0 || sid === null) return state;

  const rooms = shelterRooms(state);
  const shelterNode = state.nodes[sid];
  let stash = state.player.stash;
  let powerGrid = state.world.powerGrid;
  let barricades = shelterNode?.barricades ?? 0;
  let actors: Record<ActorId, Survivor> = state.actors as Record<ActorId, Survivor>;
  const report: ShelterReport = { produced: {}, consumed: {}, fed: 0, spoiled: 0, powered: false, walled: false };

  // 1. Jobs: each resident companion assigned to a job whose room is present works it for the tick's cycles.
  for (const c of residentCompanions(state)) {
    const jobId = jobIdOf(c);
    if (jobId === null) continue;
    const job = jobOf(graph, jobId);
    if (job === undefined || !rooms.includes(job.room)) continue;
    const perCycle = Math.max(1, Math.trunc(job.hoursPerCycle ?? DEFAULT_HOURS_PER_CYCLE));
    let cycles = Math.trunc(h / perCycle);
    while (cycles > 0) {
      // A hold-power / upkeep job with no headroom stalls BEFORE burning its input — don't waste the
      // thinnest resource (fuel) topping up a grid, or work a wall, that is already full.
      if (job.holdsPower === true && powerGrid >= 100) break;
      if (job.upkeepsBarricades === true && barricades >= 100) break;
      // Debit the input first; a job short of it stalls this cycle (never drives the stash negative).
      if (job.consumes !== undefined) {
        const need = Math.max(1, Math.trunc(job.consumes.qty));
        if (stashCount(stash, job.consumes.item) < need) break;
        const t = stashTake(stash, job.consumes.item, need);
        stash = t.stash;
        bump(report.consumed, job.consumes.item, t.took);
      }
      if (job.holdsPower === true) {
        const next = clampPct(powerGrid + GEN_POWER_PER_CYCLE);
        if (next !== powerGrid) { powerGrid = next; report.powered = true; }
      } else if (job.upkeepsBarricades === true) {
        const next = clampPct(barricades + WATCH_UPKEEP_PER_CYCLE);
        if (next !== barricades) { barricades = next; report.walled = true; }
      } else if (job.produces !== undefined) {
        const made = Math.max(1, Math.trunc(job.produces.qty));
        stash = stashAdd(stash, job.produces.item, made);
        bump(report.produced, job.produces.item, made);
      }
      cycles -= 1;
    }
  }

  // 2. The base feeds its residents from the stash (PL-M3-01) — a stocked base keeps people alive without
  //    touching the pack. Feed each resident down below the threshold, bounded by what the cache holds.
  for (const id of companionIds(state)) {
    const c = actors[id]!;
    if (c.location !== sid) continue;
    let needs = c.condition.needs;
    // Hunger: prefer fresh food (use it before it rots), then cans.
    while (needs.hunger >= RESIDENT_FEED_AT) {
      const food = FEED_FOODS.find((f) => stashCount(stash, f) > 0);
      if (food === undefined) break;
      stash = stashTake(stash, food, 1).stash;
      needs = { ...needs, hunger: clampPct(needs.hunger - RESIDENT_FEED_RELIEF) };
      bump(report.consumed, food, 1);
      report.fed += 1;
    }
    while (needs.thirst >= RESIDENT_FEED_AT && stashCount(stash, FEED_WATER) > 0) {
      stash = stashTake(stash, FEED_WATER, 1).stash;
      needs = { ...needs, thirst: clampPct(needs.thirst - RESIDENT_FEED_RELIEF) };
      bump(report.consumed, FEED_WATER, 1);
      report.fed += 1;
    }
    if (needs !== c.condition.needs) {
      actors = { ...actors, [id]: { ...c, condition: { ...c.condition, needs } } };
    }
  }

  // 3. The fridge (PL-M4-29): stash fresh food spoils ONLY when the grid is failing AND nothing keeps it
  //    cold — a kitchen (the fridge) or a generator that just ran holds it (powerGrid is already raised
  //    above, so a fueled generator lifts it out of the spoil band by construction).
  const refrigerated = rooms.includes(KITCHEN_ROOM) || powerGrid >= POWER_SPOIL_AT;
  if (!refrigerated) {
    const fresh = stashCount(stash, FRESH_FOOD_ITEM);
    const lost = Math.min(fresh, Math.trunc(h / STASH_SPOIL_HOURS));
    if (lost > 0) {
      stash = stashTake(stash, FRESH_FOOD_ITEM, lost).stash;
      stash = stashAdd(stash, SPOILED_FOOD_ITEM, lost);
      report.spoiled = lost;
    }
  }

  const changed =
    Object.keys(report.produced).length > 0 ||
    Object.keys(report.consumed).length > 0 ||
    report.fed > 0 ||
    report.spoiled > 0 ||
    report.powered ||
    report.walled;
  if (!changed) return state;

  const world = powerGrid !== state.world.powerGrid ? { ...state.world, powerGrid } : state.world;
  const nodes = shelterNode !== undefined && barricades !== shelterNode.barricades
    ? { ...state.nodes, [sid]: { ...shelterNode, barricades } }
    : state.nodes;
  const next: GameState = {
    ...state,
    world,
    nodes,
    actors,
    player: { ...state.player, stash },
  };
  return appendBeat(next, "shelter.tick", [sid], {
    produced: report.produced,
    consumed: report.consumed,
    fed: report.fed,
    spoiled: report.spoiled,
    powered: report.powered,
    walled: report.walled,
  });
}

/**
 * Off-screen shelter upkeep — the deferred PL-M3-05 barricade decay, landed here. The shelter's `barricades`
 * erode with the idle hours (the stage-6 upkeep the off-screen path skipped), **halved when a watchtower
 * stands** (the lookout keeps the wall up). Called ONLY from `advanceWorld` (the on-screen path already
 * decays in stage 6, so putting it here avoids double decay), gated on `jobsActive` so every pool-free
 * off-screen suite stays byte-identical. Pure, integer-only.
 */
export function offscreenShelterUpkeep(state: GameState, graph: RegionGraph | undefined, hours: number): GameState {
  if (!jobsActive(graph)) return state;
  const h = Math.max(0, Math.trunc(hours));
  const sid = state.player.shelterId;
  if (h === 0 || sid === null) return state;
  const node = state.nodes[sid];
  if (node === undefined || node.barricades <= 0) return state;
  const divisor = shelterRooms(state).includes(WATCHTOWER_ROOM) ? WATCHTOWER_DECAY_DIVISOR : 1;
  const loss = Math.trunc((FORTIFY_DECAY_PER_HOUR * h) / divisor);
  if (loss <= 0) return state;
  const barricades = Math.max(0, node.barricades - loss);
  if (barricades === node.barricades) return state;
  const next: GameState = { ...state, nodes: { ...state.nodes, [sid]: { ...node, barricades } } };
  // A material off-screen loss leaves a mark in the daily report — GDD XI's "what happened at the walls"
  // (so decaying defenses are never silent while you fast-forward). A held/attended wall drops nothing here.
  if (node.barricades - barricades >= WALL_WEAKENED_NOTE_AT) {
    return appendBeat(next, "shelter.weakened", [sid], { from: node.barricades, to: barricades });
  }
  return next;
}

// --- narration surfaced in sceneOf ------------------------------------------------------------

/**
 * Prose names for the items the report surfaces. Most read fine de-hyphenated ("canned food", "scrap"),
 * but the compound-adjective food ids invert ("food-fresh" ⇒ the wrong "food fresh"), so those are spelled
 * out. Keeps the daily report grammatical — the prose IS the interface (FR-UI-02).
 */
const ITEM_PROSE: { readonly [type: string]: string } = {
  "item.food-fresh": "fresh food",
  "item.food-spoiled": "spoiled food",
  "item.water-dirty": "dirty water",
};

/** A short item label for prose ("item.canned-food" ⇒ "canned food"; "item.food-fresh" ⇒ "fresh food"). */
function itemLabel(type: string): string {
  const named = ITEM_PROSE[type];
  if (named !== undefined) return named;
  const tail = type.startsWith("item.") ? type.slice("item.".length) : type;
  return tail.replace(/-/g, " ").trim() || type;
}

/** A words-only phrase listing item types (no counts — FR-UI-02): "fresh food and scrap". */
function listItems(rec: Record<string, number>): string {
  const parts = Object.keys(rec).sort().map(itemLabel);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * The jobs system's contribution to the Scene, or null. Surfaces ONLY on a shelter-ops turn — a `job.*` /
 * `shelter.tick` beat exists for this turn (the same this-turn tail-scan `radioLine`/`economyLine` use) —
 * so the base report never clutters an ordinary scene. All words; no numbers the design forbids (FR-UI-02).
 * Pure — reads state + the append-only log, advances nothing.
 */
export function jobLine(state: GameState, graph: RegionGraph | undefined): string | null {
  let tick: { readonly [k: string]: unknown } | null = null;
  let weakened = false;
  let assigned: { readonly [k: string]: unknown } | null = null;
  let cleared: { readonly [k: string]: unknown } | null = null;
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i]!;
    if (h.turn !== state.meta.turn) break; // turn-ordered append-only log ⇒ past this turn's tail, stop
    const d = h.data as { readonly [k: string]: unknown } | null;
    // Collect this turn's job beats, then prioritise: the "what happened" report (a worked turn or an
    // off-screen advance) wins over a bare assign/clear acknowledgement — `advanceWorld` reuses the acting
    // turn's number, so a same-turn assign + tick must not shadow the report.
    if (h.type === "shelter.tick" && tick === null) tick = d;
    if (h.type === "shelter.weakened") weakened = true;
    if (h.type === "job.assigned" && assigned === null) assigned = d;
    if (h.type === "job.cleared" && cleared === null) cleared = d;
  }

  if (tick === null && !weakened) {
    if (assigned !== null) {
      const job = jobOf(graph, typeof assigned["job"] === "string" ? (assigned["job"] as string) : "");
      const who = companionOf(state, typeof assigned["companion"] === "string" ? (assigned["companion"] as string) : "");
      return job !== undefined
        ? `${who} takes up a post at the shelter — ${job.worldEffect.toLowerCase()} It gives the base something to run on while you are gone.`
        : `${who} takes up a post at the shelter.`;
    }
    if (cleared !== null) {
      const who = companionOf(state, typeof cleared["companion"] === "string" ? (cleared["companion"] as string) : "");
      return `${who} steps back from the work, free to move with you again.`;
    }
    return null;
  }

  const bits: string[] = [];
  if (tick !== null) {
    const produced = (tick["produced"] ?? {}) as Record<string, number>;
    const spoiled = typeof tick["spoiled"] === "number" ? (tick["spoiled"] as number) : 0;
    const fed = typeof tick["fed"] === "number" ? (tick["fed"] as number) : 0;
    const powered = tick["powered"] === true;
    const walled = tick["walled"] === true;
    const madeList = listItems(produced);
    if (madeList.length > 0) bits.push(`the base has been at work — it puts by ${madeList}`);
    if (powered) bits.push("the generator holds the lights against the dark");
    if (walled) bits.push("the watch has kept the wall in good repair");
    if (fed > 0) bits.push("the cache has kept your people fed");
    if (spoiled > 0) bits.push("some of the fresh food in the cache has turned, past saving");
  }
  if (weakened) bits.push("the barricades have taken the weather and the days — the wall is not what it was");
  if (bits.length === 0) return null;
  const sentence = bits.join("; ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/** A companion's display name from an id, for prose (falls back to a generic label). */
function companionOf(state: GameState, id: string): string {
  const c = state.actors[id];
  return c !== undefined && isCompanion(c) ? companionName(c) : "One of your people";
}
