/**
 * The data-driven encounter / event system (M4 task T47 · FR-ENC-03..08 · FR-CNT-03 · GDD Part VIII
 * "Encounters & Events").
 *
 * Where the world sim (Part IV) decides *what the world is doing*, this decides *which slice of it
 * becomes this turn's scene*. It is the content layer through which the simulation speaks — and it is
 * **declarative**: an encounter is authored JSON (`content/encounters/*.json`), and the engine ships a
 * generic *interpreter* over a closed vocabulary of requirement predicates and effect verbs. There is
 * **no hard-coded per-encounter branching** (FR-CNT-03) — add an encounter by writing data, never by
 * editing this file.
 *
 * Naming: this is distinct from `encounters.ts` (the T35 survivor-interaction verbs) and from combat's
 * `encounterChoices` (the T15 avoidable-walker prompt). Its public surface is `event*` / `Encounter*`.
 *
 * What it delivers:
 *  - **Categories** (FR-ENC-05) — every encounter is tagged exploration/combat/social/environmental/
 *    story/psychological/shelter.
 *  - **Chains** (FR-ENC-03) — a `setFlag` effect writes a `player.flags` fact a later encounter's
 *    `requiresFlags` reads; a `scheduleFollowup` effect enqueues a *timed* flag (resolved stage 12).
 *  - **Multi-stage** (FR-ENC-04) — an `advanceStage` effect moves the *active* encounter to its next
 *    stage; the active encounter persists across turns in the reserved `player.quests` slot (like a
 *    fight persists in `combat`). A `seedWalkers` effect hands a stage off to a real T15 fight.
 *  - **Moral → Humanity** (FR-ENC-06) — an `adjustHumanity` effect moves the hidden `player.humanity`
 *    scalar and logs a `moral` Living-History beat.
 *  - **False encounters** (FR-ENC-07) — an encounter whose stage resolves to nothing.
 *  - **Evolution** (FR-ENC-08) — encounters sharing `nodeIds` gate on node-state bands (searchPct,
 *    walkers, blood, a flag), so the same place yields before/during/after variants.
 *
 * Purity: no RNG this part — selection is by *fit*, so a run replays byte-for-byte from its seed (the
 * weighted `encounter` stream + cooldowns are T48). Inert when no encounter pool is registered on the
 * transient graph, so every prior golden run is byte-identical. Integer-only, dependency-free.
 */

import type {
  ActorId,
  ContentId,
  GameState,
  HistoryEvent,
  InventoryEntry,
  NodeId,
  GroupId,
  NodeState,
  Phase,
  RegionId,
  RngState,
  ScheduledEvent,
} from "../state/types.js";
import { HUMANITY_BASELINE } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { drawInt } from "../rng/streams.js";
import { addItemBounded } from "./inventory.js";
import { depleteStash, stashUnits } from "./stash.js";
import { depositNoiseAt } from "./noise.js";
import { adjustTrust } from "./trust.js";
import {
  adjustReputationPublic,
  factionIdOfNpc,
  remember,
  reputationOf,
  socialActive,
  REPUTATION_CRUELTY,
} from "./reputation.js";
import { inflictNamedWound } from "./wounds.js";
import { isRunOver } from "./survival.js";
import { overrunsPlayer } from "./hordes.js";
import { addBodies } from "./roster.js";
import { ZOMBIE_WALKER } from "./zombies.js";
import { directorIntent, type DirectorBeat } from "./director.js";
import { profileOf, scaleInt } from "./difficulty.js";

// --- categories -------------------------------------------------------------------------------

export type EncounterCategory =
  | "exploration"
  | "combat"
  | "social"
  | "environmental"
  | "story"
  | "psychological"
  | "shelter";

/** The seven FR-ENC-05 categories a healthy turn mix draws from. */
export const ENCOUNTER_CATEGORIES: readonly EncounterCategory[] = [
  "exploration",
  "combat",
  "social",
  "environmental",
  "story",
  "psychological",
  "shelter",
];

// --- content shapes (mirrored by content/schemas/encounter.schema.json) -----------------------

/** A declarative predicate over the full state — all fields optional, AND-combined. `{}` matches anywhere. */
export interface EncounterRequirement {
  readonly nodeIds?: readonly NodeId[];
  readonly regionIds?: readonly RegionId[];
  readonly nodeKinds?: readonly string[];
  readonly phases?: readonly Phase[];
  readonly minSearchPct?: number;
  readonly maxSearchPct?: number;
  readonly minWalkers?: number;
  readonly maxWalkers?: number;
  readonly minBlood?: number;
  readonly maxBlood?: number;
  readonly minCorpses?: number;
  readonly maxCorpses?: number;
  readonly minDay?: number;
  readonly maxDay?: number;
  readonly minRegionThreat?: number;
  readonly maxRegionThreat?: number;
  readonly minHumanity?: number;
  readonly maxHumanity?: number;
  readonly minStress?: number;
  readonly maxStress?: number;
  readonly minMorale?: number;
  readonly maxMorale?: number;
  /** Total units banked in the base stash (the T39 cache) — gates a choice that spends from it. */
  readonly minStash?: number;
  readonly maxStash?: number;
  /** Player flags that must all be set (chains). */
  readonly requiresFlags?: readonly string[];
  /** Player flags that must all be unset (chains + the one-shot guard). */
  readonly forbidsFlags?: readonly string[];
  /** The player must be standing in their own claimed shelter. */
  readonly requiresShelter?: boolean;
  /** The player must be carrying at least one unit of this item type. */
  readonly carriesItem?: string;
  /** This survivor must have been met (`met` true). */
  readonly metNpc?: ActorId;
  /** A living survivor with this id must be at the player's node. */
  readonly npcHere?: ActorId;
  /**
   * The faction whose standing {@link minReputation} / {@link maxReputation} bound (T86 · FR-NPC-10).
   * Ignored unless at least one bound is set; a bound with no `faction`, or one naming a faction the run
   * never registered, fails the requirement rather than passing silently — an authored gate that cannot
   * be evaluated must not be treated as satisfied.
   */
  readonly faction?: GroupId;
  readonly minReputation?: number;
  readonly maxReputation?: number;
}

/** One declarative consequence. The interpreter ({@link applyEncounterEffect}) applies each purely. */
export type EncounterEffect =
  | { readonly kind: "setFlag"; readonly flag: string; readonly value?: boolean }
  | { readonly kind: "setRegionFlag"; readonly flag: string; readonly value?: boolean; readonly region?: RegionId }
  | { readonly kind: "adjustHumanity"; readonly delta: number }
  | { readonly kind: "adjustTrust"; readonly npc: ActorId; readonly delta: number }
  | { readonly kind: "adjustReputation"; readonly faction: GroupId; readonly delta: number }
  | { readonly kind: "adjustNeed"; readonly need: "hunger" | "thirst" | "fatigue"; readonly delta: number }
  | { readonly kind: "adjustMind"; readonly stress?: number; readonly morale?: number }
  | { readonly kind: "grantItem"; readonly item: string; readonly quantity: number }
  | { readonly kind: "takeItem"; readonly item: string; readonly quantity: number }
  | { readonly kind: "depleteStash"; readonly units: number }
  | { readonly kind: "inflictWound"; readonly wound: ContentId; readonly site: string; readonly severity: number }
  | { readonly kind: "seedWalkers"; readonly count: number; readonly node?: NodeId; readonly types?: readonly ContentId[] }
  | { readonly kind: "addNoise"; readonly amount: number; readonly node?: NodeId }
  | { readonly kind: "revealDiscovery"; readonly discovery: ContentId; readonly node?: NodeId }
  | { readonly kind: "logHistory"; readonly event: string; readonly note?: string }
  | { readonly kind: "advanceStage"; readonly to: string }
  | { readonly kind: "endEncounter" }
  | { readonly kind: "scheduleFollowup"; readonly flag: string; readonly delayHours: number };

export interface EncounterChoice {
  readonly id: string;
  readonly label: string;
  /** Hours the choice spends (> 0 ⇒ a resolved turn; 0 ⇒ a free management beat). */
  readonly timeCost: number;
  /** Optional gate — hide the choice unless the state matches (e.g. carries a firearm, morale high). */
  readonly requirements?: EncounterRequirement;
  readonly effects: readonly EncounterEffect[];
}

export interface EncounterStage {
  readonly id: string;
  readonly narration: string;
  readonly choices: readonly EncounterChoice[];
}

export interface EncounterDef {
  readonly id: string;
  readonly category: EncounterCategory;
  readonly title: string;
  readonly premise: string;
  readonly requirements?: EncounterRequirement;
  readonly stages: readonly EncounterStage[];
  /** Default false ⇒ one-shot (a done-flag blocks re-fire). A repeatable encounter relies on state-gating. */
  readonly repeatable?: boolean;
  /** Done-flag scope: "node" (once per node, default) or "run" (once per run). */
  readonly scope?: "node" | "run";
  /**
   * Theme/kind labels (T48 · FR-ENC-01) — the recombination + diversity handle. Selection down-weights a
   * repeatable sharing a tag with something that fired recently, so thematically-similar beats (two
   * false-alarms, two stranger-pleas) don't cluster even when their ids differ. Free-form; no engine
   * meaning beyond grouping. Absent ⇒ untagged (maximally diverse).
   */
  readonly tags?: readonly string[];
  /**
   * Base selection weight for the ambient (repeatable) tier (T48 · FR-ENC-02); default {@link BASE_WEIGHT}.
   * Higher ⇒ more likely when several repeatables are eligible, before the recency/tag-diversity scaling.
   * Ignored for a one-shot (the scripted tier is deterministic-by-fit, never weighted).
   */
  readonly weight?: number;
  /**
   * What this beat does to the run's **tension** (M5 task T60 · GDD Part IV) — the handle the
   * Apocalypse Director biases the ambient pool with. Absent ⇒ {@link DEFAULT_TONE}, which never moves.
   * Read only for the repeatable tier; a one-shot is picked by fit and never weighted.
   */
  readonly tone?: EncounterTone;
  /**
   * Cooldown (hours) before a **repeatable** encounter may fire again (T48 · FR-ENC-02) — ENFORCED: a
   * repeatable whose last `encounter.begin` beat (Living History) is within this window is ineligible.
   * The core anti-repeat lever; set it ≥ the recency window so a re-fire never reads as verbatim. No
   * effect on a one-shot (the done-flag already blocks re-fire).
   */
  readonly cooldownHours?: number;
  readonly notes?: string;
}

/**
 * What a beat does to the run's tension — the axis the director bids on (M5 task T60).
 *
 * Deliberately **not** {@link EncounterCategory} and deliberately **not** `tags`. Category is about
 * what kind of thing happened and does not separate tension from relief at all: `environmental` holds
 * both `birdsong` (a living thing, and the quiet to hear it) and `the-uncovered` (bodies under a
 * tarpaulin). Tags are documented as *"free-form; no engine meaning beyond grouping"*, and giving them
 * engine meaning would mean a content author changing the director by naming a theme. So the author
 * says what the beat IS, in one word, and the engine reads exactly that.
 */
export type EncounterTone = "tension" | "relief" | "neutral";
/** The tone an unauthored beat reads as — the one the director never moves. */
export const DEFAULT_TONE: EncounterTone = "neutral";

// --- T48 selection constants (weighting + cooldowns · FR-ENC-01/02) ---------------------------

/** The named RNG stream the weighted ambient pick draws from — independent of loot/combat/etc. (T5). */
export const ENCOUNTER_STREAM = "encounter";
/** Default base weight for a repeatable ambient encounter (author override via `weight`). */
export const BASE_WEIGHT = 10;
/** Hours-since-last-fire saturates here when weighting — a week; a fresh/never-seen beat reads maximally stale. */
export const STALE_CAP_HOURS = 168;
/** The widest cooldown the schema allows (336h) — bounds the per-turn history look-back for cooldown/recency. */
export const COOLDOWN_MAX_HOURS = 336;

// --- the active-encounter slot (rides reserved player.quests — no save-schema rung) -----------

/** The reserved `player.quests` id under which the single active multi-stage encounter lives. */
export const ACTIVE_ENCOUNTER_QUEST = "quest.active-encounter";

/** The live multi-stage encounter, if one is engaged. */
export interface ActiveEncounter {
  readonly encounter: string;
  readonly stage: string;
  readonly node: NodeId;
}

/** Read the active encounter from the reserved quest slot, or null when none is engaged. */
export function activeEncounter(state: GameState): ActiveEncounter | null {
  const slot = state.player.quests.find((q) => q.id === ACTIVE_ENCOUNTER_QUEST);
  if (slot === undefined || typeof slot.data !== "object" || slot.data === null) return null;
  const d = slot.data as { encounter?: unknown; stage?: unknown; node?: unknown };
  if (typeof d.encounter !== "string" || typeof d.stage !== "string" || typeof d.node !== "string") return null;
  return { encounter: d.encounter, stage: d.stage, node: d.node };
}

/** Replace/insert the active-encounter quest slot. */
function setActive(state: GameState, active: ActiveEncounter): GameState {
  const others = state.player.quests.filter((q) => q.id !== ACTIVE_ENCOUNTER_QUEST);
  const quests = [...others, { id: ACTIVE_ENCOUNTER_QUEST, data: { ...active } }];
  return { ...state, player: { ...state.player, quests } };
}

/** Remove the active-encounter quest slot. */
function clearActive(state: GameState): GameState {
  const quests = state.player.quests.filter((q) => q.id !== ACTIVE_ENCOUNTER_QUEST);
  if (quests.length === state.player.quests.length) return state;
  return { ...state, player: { ...state.player, quests } };
}

// --- the transient encounter pool (threaded on the graph, never serialized) -------------------

/** The registered encounter pool for this run, or empty when none is registered (inert). */
export function encounterPool(graph: RegionGraph | undefined): readonly EncounterDef[] {
  return graph?.encounters ?? [];
}

/** Look up an encounter def by id in the pool. */
export function encounterOf(graph: RegionGraph | undefined, id: string): EncounterDef | undefined {
  return encounterPool(graph).find((e) => e.id === id);
}

// --- helpers ----------------------------------------------------------------------------------

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** The one-shot done-flag key for an encounter at a node (or per-run). */
function doneFlagKey(def: EncounterDef, node: NodeId): string {
  return def.scope === "run" ? `enc.done.${def.id}@run` : `enc.done.${def.id}@${node}`;
}

/** Stamp a Living-History beat. */
function beat(state: GameState, type: string, subjects: readonly string[], data: HistoryEvent["data"]): HistoryEvent {
  return { day: state.meta.day, hour: state.meta.hour, turn: state.meta.turn, type, subjects: [...subjects], data };
}

function appendBeat(state: GameState, ev: HistoryEvent): GameState {
  return { ...state, history: [...state.history, ev] };
}

/** Remove up to `count` units of a non-unique item type from the pack. */
function removeUnits(inventory: readonly InventoryEntry[], type: string, count: number): readonly InventoryEntry[] {
  let left = Math.max(0, Math.trunc(count));
  const out: InventoryEntry[] = [];
  for (const e of inventory) {
    if (left > 0 && e.type === type && e.itemId === undefined) {
      const take = Math.min(left, e.quantity);
      left -= take;
      if (e.quantity - take > 0) out.push({ ...e, quantity: e.quantity - take });
    } else {
      out.push(e);
    }
  }
  return out;
}

// --- cooldowns & recency: read from the Living History, never stored (T48 · FR-ENC-02) --------
//
// Every engage already logs an `encounter.begin` beat (subjects [id, node], data {encounter, category})
// stamped {day, hour, turn}. That IS the cooldown/recency store — so T48 adds NO save-schema rung and
// stays save-lossless (history round-trips). The scan is bounded: history is time-ordered, so we walk
// backward and stop the moment a beat falls outside the widest window we care about (COOLDOWN_MAX_HOURS).

/** Absolute hour-of-run — the monotone clock cooldowns/recency compare against (day·24 + hour). */
function absHourAt(day: number, hour: number): number {
  return day * 24 + hour;
}
function absNow(state: GameState): number {
  return absHourAt(state.meta.day, state.meta.hour);
}

interface FireBeat {
  readonly id: string;
  readonly abs: number;
}

/** The `encounter.begin` beats within `windowHours` of now, most-recent first (bounded backward scan). */
function recentFires(state: GameState, windowHours: number): readonly FireBeat[] {
  const now = absNow(state);
  const hist = state.history;
  const out: FireBeat[] = [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const ev = hist[i]!;
    const abs = absHourAt(ev.day, ev.hour);
    if (now - abs > windowHours) break; // older beats can't matter — history only moves forward in time
    if (ev.type !== "encounter.begin") continue;
    const raw =
      typeof ev.data === "object" && ev.data !== null && "encounter" in ev.data
        ? (ev.data as { encounter: unknown }).encounter
        : ev.subjects[0];
    const id = typeof raw === "string" ? raw : "";
    if (id.length > 0) out.push({ id, abs });
  }
  return out;
}

/** Most-recent fire (abs hour) per encounter id, from a most-recent-first fires list. */
function lastFireById(fires: readonly FireBeat[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of fires) if (!m.has(f.id)) m.set(f.id, f.abs); // first seen scanning back = most recent
  return m;
}

/** Most-recent fire (abs hour) per tag — each fired id's tags resolved from the in-hand pool. */
function lastFireByTag(fires: readonly FireBeat[], pool: readonly EncounterDef[]): Map<string, number> {
  const tagsOf = new Map<string, readonly string[]>(pool.map((d) => [d.id, d.tags ?? []]));
  const m = new Map<string, number>();
  for (const f of fires) {
    for (const t of tagsOf.get(f.id) ?? []) if (!m.has(t)) m.set(t, f.abs);
  }
  return m;
}

/** Is a repeatable still inside its own cooldown window (per the history beats)? One-shots never are. */
function onCooldown(def: EncounterDef, now: number, lastById: Map<string, number>): boolean {
  const cd = Math.max(0, Math.trunc(def.cooldownHours ?? 0));
  if (cd <= 0) return false;
  const last = lastById.get(def.id);
  return last !== undefined && now - last < cd;
}

// --- Humanity (FR-ENC-06 · GDD "The Humanity system") -----------------------------------------

/** The run's current hidden moral standing (0–100). */
export function humanityOf(state: GameState): number {
  return state.player.humanity ?? HUMANITY_BASELINE;
}

/**
 * A felt, one-line read of the moral shape of the run — surfaced only at the extremes (GDD: "it is
 * never shown as a bar; it is felt"). Null in the neutral band. Screen-reader-safe prose.
 */
export function humanityBand(state: GameState): string | null {
  const h = humanityOf(state);
  if (h >= 85) return "Whatever this place has taken, you have held onto yourself — you can still look at your own hands.";
  if (h <= 12) return "You do not recognise the person making these choices anymore, and some part of you has stopped trying to.";
  if (h <= 28) return "There is a coldness in you now, settling in for good, and you can feel it.";
  return null;
}

// --- the effect interpreter -------------------------------------------------------------------

/** Context an effect resolves against — the encounter it belongs to and the node it fired at. */
interface EffectCtx {
  readonly encounterId: string;
  readonly node: NodeId;
  /**
   * The run's transient graph (T86). Optional: `adjustReputation` and the cruelty hook need the faction
   * pool, and a call site that has no graph — every pre-T86 one — resolves them as no-ops, which is the
   * same thing a run with no registered pool does.
   */
  readonly graph?: RegionGraph;
}

/**
 * Apply one declarative {@link EncounterEffect} to the state, purely. The control-flow effects
 * (`advanceStage` / `endEncounter`) are handled by {@link resolveEventAction} and are no-ops here.
 * Every branch is a fixed transform — this is the whole of the "no hard-coded branching" contract:
 * new encounters compose these verbs in data, they never add a branch here.
 */
/**
 * Everyone standing here watches a cruel act (T86 · FR-NPC-02, the `saw-cruelty` hook T53 reserved).
 * Companions in the party and living survivors at the node both remember it — respect falls, fear
 * climbs — and a survivor who belongs to a faction costs the player {@link REPUTATION_CRUELTY} standing
 * with their people (spilling to that faction's rivals, who are pleased to hear it).
 *
 * Deterministic: survivors are visited in sorted id order. Inert — the same object back — without a
 * graph or without a registered faction pool, which is the byte-identity guarantee, and inert when
 * nobody is present, which is the common case.
 */
function witnessCruelty(state: GameState, ctx: EffectCtx): GameState {
  const graph = ctx.graph;
  if (graph === undefined || !socialActive(graph)) return state;
  const turn = state.meta.turn;
  const here = ctx.node;
  let out = state;

  // The first cut remembered onto every entry in `actors`, so a companion holding the base a region
  // away picked up `saw-cruelty` too — and because `sim/social.ts` reads exactly those fields for
  // desertion and betrayal, three remote cruel acts put a companion guarding the stash into betrayal
  // range for something they could not have seen.
  // Companions who are STANDING HERE, in sorted id order. The sort is hygiene, not load-bearing, and
  // mutation testing says so: `remember` is applied to each companion independently with no
  // cross-element interaction, so dropping the sort is a PROVEN-EQUIVALENT mutant today. It stays
  // because the faction loop below is NOT order-independent and these two lists should not drift apart
  // in how carefully they are built. There is deliberately no `alive` check:
  // `Survivor` has no such field — `killCompanion` DELETES the entry from `actors` and stamps a
  // `fallen.<id>` flag — so a check for one would be dead code that reads like a guarantee.
  const companions = Object.keys(out.actors).sort().filter((id) => out.actors[id]?.location === here);
  if (companions.length > 0) {
    const actors = { ...out.actors };
    for (const id of companions) {
      const c = actors[id];
      if (c !== undefined) actors[id] = remember(c, "saw-cruelty", turn);
    }
    out = { ...out, actors };
  }

  const present = Object.keys(out.npcs).sort().filter((id) => {
    const n = out.npcs[id];
    return n !== undefined && n.alive && n.location === here;
  });
  if (present.length === 0) return out;
  const npcs = { ...out.npcs };
  for (const id of present) {
    const n = npcs[id];
    if (n !== undefined) npcs[id] = remember(n, "saw-cruelty", turn);
  }
  out = { ...out, npcs };

  // ONE charge per FACTION, not per witness. Charging per head made the standing cost depend on how many
  // of a faction's people the off-screen sim happened to park in one room, and — because each charge
  // spilled to every rival while the rival's own single charge did not scale — a cruel act in front of
  // three of one faction's people came out as a NET GAIN with their rivals: measured at Slagworks
  // −25 → +2 for emptying the Quad's ration crate, which is larger than every positive act the Crew
  // authors put together. Deterministic: the distinct faction ids are visited in sorted order.
  // The order here is inherited from `present`, which is already sorted by survivor id, so the Set
  // preserves a deterministic sequence without a second sort — and the sequence matters, because a
  // charge that clamps and then spills is not commutative at the band edges.
  const factions = [...new Set(present.map((id) => factionIdOfNpc(graph, id)).filter((f): f is string => f !== null))];
  for (const fid of factions) out = adjustReputationPublic(out, graph, fid, REPUTATION_CRUELTY);
  return out;
}

export function applyEncounterEffect(state: GameState, effect: EncounterEffect, ctx: EffectCtx): GameState {
  switch (effect.kind) {
    case "setFlag":
      return { ...state, player: { ...state.player, flags: { ...state.player.flags, [effect.flag]: effect.value ?? true } } };
    case "setRegionFlag": {
      const rid = effect.region ?? state.nodes[ctx.node]?.regionId;
      const region = rid === undefined ? undefined : state.regions[rid];
      if (rid === undefined || region === undefined) return state;
      const storyFlags = { ...region.storyFlags, [effect.flag]: effect.value ?? true };
      return { ...state, regions: { ...state.regions, [rid]: { ...region, storyFlags } } };
    }
    case "adjustReputation":
      // T86 · the authored standing channel. Inert without a faction pool, and the rival spill is
      // derived inside `adjustReputation` — nothing about a feud is stored.
      return adjustReputationPublic(state, ctx.graph, effect.faction, effect.delta);
    case "adjustHumanity": {
      const humanity = clampPct(humanityOf(state) + effect.delta);
      const withValue = { ...state, player: { ...state.player, humanity } };
      // T86 · `saw-cruelty` finally has its occasion. T53 wrote the SOCIAL_DELTAS entry with the comment
      // "reserved; needs an events hook" and the design review asked for exactly this one: cruelty done
      // in front of people is remembered by the people who saw it. Eight authored encounters carry a
      // negative `adjustHumanity`. Inert without a graph or a faction pool.
      const witnessed = effect.delta < 0 ? witnessCruelty(withValue, ctx) : withValue;
      // A moral act is recorded for the run's memory (the M5 endings read the log, T61/T62).
      return appendBeat(witnessed, beat(witnessed, "moral", [ctx.encounterId], { delta: effect.delta, humanity }));
    }
    case "adjustTrust": {
      const npc = state.npcs[effect.npc];
      if (npc === undefined) return state;
      return { ...state, npcs: { ...state.npcs, [effect.npc]: adjustTrust(npc, effect.delta) } };
    }
    case "adjustNeed": {
      const needs = { ...state.player.condition.needs, [effect.need]: clampPct(state.player.condition.needs[effect.need] + effect.delta) };
      return { ...state, player: { ...state.player, condition: { ...state.player.condition, needs } } };
    }
    case "adjustMind": {
      const mind = {
        stress: clampPct(state.player.condition.mind.stress + (effect.stress ?? 0)),
        morale: clampPct(state.player.condition.mind.morale + (effect.morale ?? 0)),
      };
      return { ...state, player: { ...state.player, condition: { ...state.player.condition, mind } } };
    }
    case "grantItem": {
      let inventory = state.player.inventory;
      // Bounded by the T18 carry budget — overflow is simply left behind (the pack can't hold it).
      for (let i = 0; i < Math.max(0, Math.trunc(effect.quantity)); i++) {
        const res = addItemBounded(inventory, effect.item);
        if (!res.carried) break;
        inventory = res.inventory;
      }
      return inventory === state.player.inventory ? state : { ...state, player: { ...state.player, inventory } };
    }
    case "takeItem": {
      const inventory = removeUnits(state.player.inventory, effect.item, effect.quantity);
      return { ...state, player: { ...state.player, inventory } };
    }
    case "depleteStash":
      return depleteStash(state, Math.max(0, Math.trunc(effect.units)));
    case "inflictWound": {
      const condition = inflictNamedWound(state.player.condition, effect.wound, effect.severity, effect.site, state.meta.day, state.meta.hour);
      return { ...state, player: { ...state.player, condition } };
    }
    case "seedWalkers": {
      const nid = effect.node ?? ctx.node;
      const node = state.nodes[nid];
      if (node === undefined) return state;
      // T75: the effect now appends BODIES rather than bumping a count and unioning a type list. Each
      // listed type takes one of the authored `count` bodies and the rest are plain walkers, so
      // "3 walkers, one of them a screamer" arrives as three bodies, not four. The authored count is
      // therefore exact whenever `types.length <= count` — which is every shipped use (all four are
      // `count: 2|4` with `types: ["zombie.walker"]`, so they add exactly what they always did). A type
      // list LONGER than the count is the one place the count is exceeded: every type still lands a
      // body, because silently dropping an authored type is worse than adding one, and it is the same
      // contract `seedRoster` keeps.
      // Incidental: the old union wrote the literal "zombie.walker" into `zombieTypes`, which the
      // harness soundscape read as "a special is here" and used to SUPPRESS the collective-moan cue at
      // those three nodes. `distinctTypes` drops it, so the cue now fires — an undeclared-until-now
      // FR-AUD change, recorded in QA_REVIEW_T75.
      const count = Math.max(0, Math.trunc(effect.count));
      const listed = effect.types ?? [];
      const bodies: ContentId[] = [...listed];
      while (bodies.length < count) bodies.push(ZOMBIE_WALKER);
      return { ...state, nodes: { ...state.nodes, [nid]: addBodies(node, bodies) } };
    }
    case "addNoise": {
      const nid = effect.node ?? ctx.node;
      return { ...state, nodes: depositNoiseAt(state.nodes, nid, Math.max(0, Math.trunc(effect.amount))) };
    }
    case "revealDiscovery": {
      const nid = effect.node ?? ctx.node;
      const node = state.nodes[nid];
      if (node === undefined || node.discoveries.includes(effect.discovery)) return state;
      return { ...state, nodes: { ...state.nodes, [nid]: { ...node, discoveries: [...node.discoveries, effect.discovery] } } };
    }
    case "logHistory":
      return appendBeat(state, beat(state, effect.event, [ctx.encounterId], { note: effect.note ?? null }));
    case "scheduleFollowup": {
      const total = state.meta.hour + Math.max(0, Math.trunc(effect.delayHours));
      const ev: ScheduledEvent = {
        id: `${ctx.encounterId}.followup.${effect.flag}`,
        dueDay: state.meta.day + Math.floor(total / 24),
        dueHour: total % 24,
        kind: ENCOUNTER_EVENT_KIND,
        data: { flag: effect.flag },
      };
      return { ...state, queue: [...state.queue, ev] };
    }
    case "advanceStage":
    case "endEncounter":
      return state; // control-flow — handled by resolveEventAction
  }
}

// --- requirement evaluation -------------------------------------------------------------------

/** Does the state satisfy this requirement at `node`? All fields AND-combined; absent fields ignored. */
export function matchesRequirement(
  state: GameState,
  req: EncounterRequirement | undefined,
  node: NodeState,
  nodeId: NodeId,
  kind: string | undefined,
): boolean {
  if (req === undefined) return true;
  const inRange = (v: number, lo?: number, hi?: number): boolean =>
    (lo === undefined || v >= lo) && (hi === undefined || v <= hi);

  if (req.nodeIds !== undefined && !req.nodeIds.includes(nodeId)) return false;
  if (req.regionIds !== undefined && !req.regionIds.includes(node.regionId)) return false;
  if (req.nodeKinds !== undefined && (kind === undefined || !req.nodeKinds.includes(kind))) return false;
  if (req.phases !== undefined && !req.phases.includes(state.meta.phase)) return false;
  if (!inRange(node.searchPct, req.minSearchPct, req.maxSearchPct)) return false;
  if (!inRange(node.walkers, req.minWalkers, req.maxWalkers)) return false;
  if (!inRange(node.blood, req.minBlood, req.maxBlood)) return false;
  if (!inRange(node.corpses, req.minCorpses, req.maxCorpses)) return false;
  if (!inRange(state.meta.day, req.minDay, req.maxDay)) return false;
  const threat = state.regions[node.regionId]?.threat ?? 0;
  if (!inRange(threat, req.minRegionThreat, req.maxRegionThreat)) return false;
  if (!inRange(humanityOf(state), req.minHumanity, req.maxHumanity)) return false;
  if (!inRange(state.player.condition.mind.stress, req.minStress, req.maxStress)) return false;
  if (!inRange(state.player.condition.mind.morale, req.minMorale, req.maxMorale)) return false;
  if (req.minStash !== undefined || req.maxStash !== undefined) {
    if (!inRange(stashUnits(state.player.stash), req.minStash, req.maxStash)) return false;
  }
  if (req.requiresFlags !== undefined && !req.requiresFlags.every((f) => state.player.flags[f] === true)) return false;
  if (req.forbidsFlags !== undefined && req.forbidsFlags.some((f) => state.player.flags[f] === true)) return false;
  if (req.requiresShelter === true && (state.player.shelterId === null || state.player.shelterId !== nodeId)) return false;
  if (req.carriesItem !== undefined && !state.player.inventory.some((e) => e.type === req.carriesItem && e.quantity > 0)) return false;
  if (req.metNpc !== undefined && state.npcs[req.metNpc]?.met !== true) return false;
  // T86 · standing with a faction. A bound with no `faction`, or one naming a faction this run never
  // registered, FAILS — an authored gate the run cannot evaluate must not read as satisfied.
  if (req.minReputation !== undefined || req.maxReputation !== undefined) {
    if (req.faction === undefined) return false;
    if (!(req.faction in state.player.reputation)) return false;
    if (!inRange(reputationOf(state, req.faction), req.minReputation, req.maxReputation)) return false;
  }

  if (req.npcHere !== undefined) {
    const npc = state.npcs[req.npcHere];
    if (npc === undefined || !npc.alive || npc.location !== nodeId) return false;
  }
  return true;
}

/** How targeting each requirement key is — a node/npc/flag/node-state gate is far more specific than a
 * broad region/kind/phase one. */
const REQUIREMENT_WEIGHT: { readonly [key: string]: number } = {
  nodeIds: 3, npcHere: 3, metNpc: 3,
  requiresFlags: 2, forbidsFlags: 2, requiresShelter: 2, carriesItem: 2, minStash: 2, maxStash: 2,
  minSearchPct: 2, maxSearchPct: 2, minWalkers: 2, maxWalkers: 2,
  minBlood: 2, maxBlood: 2, minCorpses: 2, maxCorpses: 2,
};

/**
 * A "specificity" score — summed requirement-key weights — so a node/flag-targeted evolution or chain
 * encounter outranks a broad region/phase ambient one. Deterministic (ties fall to id order). T48 keeps
 * this as the ordering *within the scripted (one-shot) tier*; the ambient (repeatable) tier is ordered
 * by the weighted-pool + cooldown model ({@link chooseEncounter}) instead.
 */
function specificity(def: EncounterDef): number {
  if (def.requirements === undefined) return 0;
  return Object.keys(def.requirements).reduce((sum, k) => sum + (REQUIREMENT_WEIGHT[k] ?? 1), 0);
}

// --- selection (pipeline stage 13) ------------------------------------------------------------

/**
 * Every encounter eligible to fire at the player's node right now. A **one-shot** is gated by its
 * done-flag (T47); a **repeatable** is additionally gated by its `cooldownHours` (T48 · FR-ENC-02) —
 * dropped while its last `encounter.begin` beat sits inside the window. Requirements are AND-checked
 * last. No repeatable in the pool ⇒ the cooldown pass is a no-op and this returns exactly what T47 did.
 */
export function eligibleEncounters(state: GameState, graph: RegionGraph): readonly EncounterDef[] {
  const nodeId = state.player.location;
  const node = state.nodes[nodeId];
  if (node === undefined) return [];
  const kind = graph.nodes[nodeId]?.kind;
  const now = absNow(state);
  const lastById = lastFireById(recentFires(state, COOLDOWN_MAX_HOURS));
  return encounterPool(graph).filter((def) => {
    if (def.repeatable !== true) {
      if (state.player.flags[doneFlagKey(def, nodeId)] === true) return false;
    } else if (onCooldown(def, now, lastById)) {
      return false;
    }
    return matchesRequirement(state, def.requirements, node, nodeId, kind);
  });
}

/** Partition the eligible set into the scripted (one-shot) tier and the ambient (repeatable) tier. */
function eligibleTiers(state: GameState, graph: RegionGraph): { oneShot: EncounterDef[]; ambient: EncounterDef[] } {
  const oneShot: EncounterDef[] = [];
  const ambient: EncounterDef[] = [];
  for (const d of eligibleEncounters(state, graph)) (d.repeatable === true ? ambient : oneShot).push(d);
  return { oneShot, ambient };
}

/** The most-specific-then-id pick over a set — the deterministic fit ordering (scripted tier). */
function bestByFit(defs: readonly EncounterDef[]): EncounterDef | null {
  if (defs.length === 0) return null;
  return [...defs].sort((a, b) => specificity(b) - specificity(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!;
}

/**
 * The deterministic *fit view* of what would fire — scripted tier if any, else the best-fit repeatable.
 * Kept pure (no RNG) for tests/tools and as the scripted-tier resolver; the runtime pick that actually
 * weights the ambient tier is {@link chooseEncounter}. For a one-shot-only pool (every T47 fixture /
 * shipped encounter) this is byte-identical to the T47 selector.
 */
export function selectEncounter(state: GameState, graph: RegionGraph): EncounterDef | null {
  const { oneShot, ambient } = eligibleTiers(state, graph);
  return bestByFit(oneShot.length > 0 ? oneShot : ambient);
}

/**
 * **How far the director leans the ambient pool, per beat and tone** (M5 task T60 · GDD Part IV:
 * *"biases (never forces) what the simulation offers next"*), as a percentage of the row's weight.
 * 100 leaves a row exactly where it was.
 *
 * This is where the director stops being a number on a district and becomes something a player meets.
 * Measured on the pre-T60 tree, the whole controller was worth nothing: **turning the Apocalypse
 * Director off changed a run by 0.1 turns** (50.0 -> 49.9 over 120 runs across five policies), because
 * its entire authority was a clamped +-1 a tick on two dials of one region — and `driftRegions` pulls
 * those straight back onto the anchor (measured today, the player's region sits exactly on its anchor
 * on 40% of turns and within a point of it on 63%). Even forcing an escalate beat on every single tick
 * moved the run 0.8 turns, and a 6x wider bias cap on top of that moved it 1.2.
 *
 * **Those three figures are rebuild sweeps on a tree that no longer exists** — a constant was edited,
 * the tree re-run, the constant restored — so `measure/t60.ts` cannot reproduce them and does not
 * pretend to; `docs/qa/QA_REVIEW_T60.md` records how each was taken. Everything below IS re-derivable:
 * `--lean` prints the table this constant produces, `--pacing` the pressure and anchor readings.
 *
 * The encounter pool is the opposite of that: it fires **12.5 times a run**, it is the liveliest channel
 * in the game (T86 said the same when it looked for one), and what it offers is felt immediately.
 *
 * Measured after the wiring, on the ambient table itself (`--lean` (a)): an escalate beat asks for
 * **46.7% tension against a hold turn's 23.2%**. The relief half is weaker — 29.8% relief against
 * 35.8% — and the cause is eligibility rather than arithmetic: when the director asks for relief the
 * pool has 0.72 relief-toned rows eligible on average, its fewest, against 1.36 tension rows, its most.
 * A lean can only choose between rows that are eligible. See PL-M5-83.
 *
 * `hold` is the identity row and is written out rather than defaulted, so the table reads as what it is
 * — three beats, three columns, one of which does nothing.
 */
export const DIRECTOR_TONE_LEAN: { readonly [beat in DirectorBeat]: { readonly [tone in EncounterTone]: number } } = {
  escalate: { tension: 200, relief: 50, neutral: 100 },
  relief: { tension: 50, relief: 200, neutral: 100 },
  hold: { tension: 100, relief: 100, neutral: 100 },
};

/**
 * Whether this content set authors a {@link EncounterTone} anywhere — the **active-system gate** for
 * the whole director-bias axis (T83's `safehousesAuthored` precedent, applied to a content FIELD).
 *
 * A pool that says nothing about tone gets the arithmetic it always had, exactly: every row reads
 * `neutral`, every lean is 100, and `weightOf` returns the pre-T60 integer. Cheap — a scan of the
 * already-indexed pool, once per weighted pick, and the weighted pick happens only when two or more
 * repeatables are eligible.
 */
export function tonesAuthored(graph: RegionGraph | undefined): boolean {
  for (const def of encounterPool(graph)) if (def.tone !== undefined) return true;
  return false;
}

/**
 * The director's lean on one row, as a percentage. 100 (identity) unless the pool authors tones AND
 * the beat is not `hold`. `directorAggression` (T56's pacing dial) scales the lean's DISTANCE from
 * identity, which is that dial's first real job: before T60 it scaled an escalate nudge that fired
 * only on day one, and measured 0.2 turns of difference between Survivor and Nightmare.
 */
/**
 * The floor on a down-lean, as a percentage. **Declared, not tested**: at the four shipped
 * `directorAggression` values the reciprocal never reaches it (Nightmare's 3 gives an up-lean of 400
 * and a down-lean of exactly 100·100/400 = 25, which IS the floor but equals the unfloored value), so a
 * mutation sweep cannot distinguish `Math.max(TONE_LEAN_FLOOR, …)` from the bare division and no
 * honest test can either. It becomes reachable the moment a retune takes aggression above 4, which
 * PL-M4-53 says is exactly the kind of thing a later pass may do — which is why it ships rather than
 * being deleted as dead. Kept deliberately.
 */
const TONE_LEAN_FLOOR = 25;

function toneLean(beat: DirectorBeat, tone: EncounterTone, aggression: number): number {
  const lean = DIRECTOR_TONE_LEAN[beat][tone];
  if (lean === 100) return 100;
  // The aggression dial applies to ESCALATE ONLY. `difficulty.ts` documents it as "a multiplier on the
  // Director's escalate nudge", `director.ts`'s `nudge` says relief "is deliberately unscaled — a
  // harder mode escalates a coasting run harder, it does not yank away the comeback rope the GDD's
  // failure-spiral prevention promises (GDD XVI rule 4)", and `director.ts` says Story's director never
  // escalates at all. A first cut passed `aggression` on every beat and made all three false in the
  // same task: Hardcore leaned the relief beat 0.003:1 against tension, and Story's director escalated
  // through the one channel T60 calls its only real authority.
  if (beat !== "escalate") return lean;
  if (aggression === 1) return lean; // Survivor / unset: the table value, untouched.
  // Up-lean scales; down-lean is its reciprocal, so the dial stays a ROTATION of the odds rather than
  // a ratchet. The first cut scaled the linear distance from 100 and clamped at 1, which saturated:
  // `100 + trunc(-50 * 2)` is 0 for EVERY aggression >= 2, so Hardcore and Nightmare were numerically
  // identical on the suppression side while the amplification side kept growing — a 2x dial step
  // bought a 64x odds step, and at 212:1 the disfavoured row is not biased down, it is removed. GDD IV
  // says "biases (never forces)", so the floor is a real weight, not 1%.
  const up = Math.max(1, 100 + scaleInt(DIRECTOR_TONE_LEAN.escalate.tension - 100, aggression));
  return lean > 100 ? up : Math.max(TONE_LEAN_FLOOR, Math.trunc((100 * 100) / up));
}

/** Integer selection weight for a repeatable: base, scaled up by id-freshness and (2×) tag-diversity. */
function weightOf(
  def: EncounterDef,
  now: number,
  lastById: Map<string, number>,
  lastByTag: Map<string, number>,
  lean: (tone: EncounterTone) => number = () => 100,
): number {
  const base = Math.max(1, Math.trunc(def.weight ?? BASE_WEIGHT));
  const lastId = lastById.get(def.id);
  const idScore = lastId === undefined ? STALE_CAP_HOURS : Math.min(STALE_CAP_HOURS, now - lastId);
  let tagScore = STALE_CAP_HOURS; // untagged ⇒ maximally diverse
  for (const t of def.tags ?? []) {
    const lt = lastByTag.get(t);
    const s = lt === undefined ? STALE_CAP_HOURS : Math.min(STALE_CAP_HOURS, now - lt);
    if (s < tagScore) tagScore = s; // the most-recently-fired shared tag dominates → suppress the theme
  }
  const w = base * (1 + idScore + 2 * tagScore);
  // T60: the director's lean, last, so it scales the fully-diversified weight rather than the base —
  // a beat the pool is already suppressing for recency stays suppressed. Floored at 1: the director
  // biases, it never removes a row from the table (GDD IV "biases, never forces", and the `floor(f·len)`
  // shape hazard the pool gates exist for).
  const pct = lean(def.tone ?? DEFAULT_TONE);
  return pct === 100 ? w : Math.max(1, Math.trunc((w * pct) / 100));
}

/** One row of the ambient table as the director has left it: the selection odds, laid out. */
export interface AmbientWeight {
  readonly id: ContentId;
  readonly tone: EncounterTone;
  /** The integer selection weight, tone lean included. */
  readonly weight: number;
}

/**
 * **The ambient table for this exact state, weights and all** (T60) — pure, no draw, no stream step.
 *
 * The telemetry seam for the director's lean, and it exists because the obvious way to measure the
 * lean does not work. Counting the tones that actually FIRED, split by the beat that was live, is
 * confounded three ways at once: about half of all scenes are scripted one-shots the lean never
 * touches (T48), the beat correlates with WHERE the player is and therefore with which rows are
 * eligible at all, and the `1 + idScore + 2·tagScore` recency term dominates the weight — so the
 * measured delivery-level split reads as noise or backwards even where the lean is working exactly as
 * written. This returns what the director actually asked for, which is the thing to measure.
 *
 * Same shape as `samplePacing`: a client or a harness calls it on states it already has, nothing in
 * the pipeline calls it, and a seeded run is unaffected by whether anyone looks.
 */
export function ambientWeights(state: GameState, graph: RegionGraph): readonly AmbientWeight[] {
  const { oneShot, ambient } = eligibleTiers(state, graph);
  // Exactly `chooseEncounter`'s short-circuits, in the same order. The single-candidate case is the one
  // an audit caught missing: `chooseEncounter` returns `ambient[0]` with NO draw, so a table reported
  // there is a table nothing drew from. It was 20.5% of everything this function reported, and it
  // halved the apparent strength of the lean in the one measurement that exists to isolate it.
  if (oneShot.length > 0 || ambient.length === 0 || ambient.length === 1) return [];
  const { sorted, weights } = ambientTable(state, graph, ambient);
  return sorted.map((d, i) => ({ id: d.id, tone: d.tone ?? DEFAULT_TONE, weight: weights[i]! }));
}

/** The one place the ambient weights are computed — {@link weightedPick} draws on it, telemetry reads it. */
function ambientTable(
  state: GameState,
  graph: RegionGraph,
  ambient: readonly EncounterDef[],
): { sorted: readonly EncounterDef[]; weights: readonly number[] } {
  const now = absNow(state);
  const fires = recentFires(state, COOLDOWN_MAX_HOURS);
  const lastById = lastFireById(fires);
  const lastByTag = lastFireByTag(fires, encounterPool(graph));
  const sorted = [...ambient].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // stable, seed-independent order
  // T60: the director's bid on this turn's offer. Gated on the pool authoring any tone at all, so a
  // tone-less set draws bit-for-bit as before; `directorBeat` already returns `hold` when the director
  // is disabled, which is the identity row.
  const beat = tonesAuthored(graph) ? directorIntent(state) : "hold";
  const aggression = profileOf(state).directorAggression;
  const lean = (tone: EncounterTone): number => toneLean(beat, tone, aggression);
  return { sorted, weights: sorted.map((d) => weightOf(d, now, lastById, lastByTag, lean)) };
}

/** Weighted-random pick over ≥2 eligible repeatables, drawing once from the `encounter` stream. */
function weightedPick(state: GameState, graph: RegionGraph, ambient: readonly EncounterDef[]): { def: EncounterDef; rng: RngState } {
  const { sorted, weights } = ambientTable(state, graph, ambient);
  const total = weights.reduce((a, b) => a + b, 0);
  const { rng, value: roll } = drawInt(state.rng, state.meta.seed, ENCOUNTER_STREAM, 0, total - 1);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += weights[i]!;
    if (roll < acc) return { def: sorted[i]!, rng };
  }
  return { def: sorted[sorted.length - 1]!, rng };
}

/**
 * The runtime selection (T48 · FR-ENC-02), threading the RNG. **Tiered**: an eligible scripted (one-shot)
 * beat is picked deterministically by fit with **no draw** (a chain payoff / evolution beat is never
 * randomized or crowded out — so every prior golden is byte-identical); only when the eligible set is
 * *all* repeatable does the ambient model run — a single candidate returns **without drawing** (stream
 * untouched), ≥2 draw one weighted pick favouring fresh + tag-diverse content. Returns the picked def
 * (or null) and the possibly-advanced RngState; `rng === state.rng` whenever no draw happened.
 */
export function chooseEncounter(state: GameState, graph: RegionGraph): { def: EncounterDef | null; rng: RngState } {
  const { oneShot, ambient } = eligibleTiers(state, graph);
  if (oneShot.length > 0) return { def: bestByFit(oneShot), rng: state.rng };
  if (ambient.length === 0) return { def: null, rng: state.rng };
  if (ambient.length === 1) return { def: ambient[0]!, rng: state.rng };
  return weightedPick(state, graph, ambient);
}

/**
 * Stage-13 body: if the player stands idle at a node with no active encounter / no fight and the run is
 * live, select the fitting encounter and engage it (surfaces in this turn's Scene). Inert when the pool
 * is empty, so every prior golden run is byte-identical. Pure, deterministic (no RNG this part).
 */
export function evaluateEvents(state: GameState, graph: RegionGraph | undefined): GameState {
  if (graph === undefined || encounterPool(graph).length === 0) return state;
  if (isRunOver(state) || state.combat !== null || activeEncounter(state) !== null) return state;
  const node = state.nodes[state.player.location];
  // A contested node is the T15 avoidable-walker prompt, not a scripted beat — the dead in front of you
  // come first. Encounters fire on quiet nodes; a multi-stage one that turns violent seeds walkers and
  // ends, handing off to that prompt next turn.
  if (node === undefined || node.walkers > 0) return state;
  // T76: nor under a horde. The overrun pre-empts every choice list while a mass stands on the player
  // (`sim/overrun.ts`), so engaging a beat here would strand it — begun this turn, unanswerable until
  // the mass wanders off. This is the *opening* half of that guard; the flee/hold verbs abandon a beat
  // that was already engaged when the mass arrived.
  // `overrunsPlayer`, not a bare position test: a mass has no mechanical existence with the layer
  // switched off, and none inside the player's own claimed shelter, so in neither case may it go on
  // silently shutting beats out of the node it stands on. The guard exists because the overrun
  // pre-empts every choice list — where it cannot pre-empt, it must not suppress either.
  if (overrunsPlayer(state)) return state;
  const { def, rng } = chooseEncounter(state, graph);
  // No draw ⇒ rng === state.rng ⇒ strictly inert (empty pool, nothing eligible, or a single candidate),
  // so every prior run stays byte-identical; a real weighted pick only advances the `encounter` stream.
  if (def === null || def.stages.length === 0) return rng === state.rng ? state : { ...state, rng };
  const withRng = rng === state.rng ? state : { ...state, rng };
  const active: ActiveEncounter = { encounter: def.id, stage: def.stages[0]!.id, node: state.player.location };
  const engaged = setActive(withRng, active);
  // T60: the scene's tone rides on the beat, so `turnsSinceThreat` can tell a scene that THREATENED the
  // player from one that consoled them without re-resolving the pool off a save. Omitted entirely when
  // the content authors no tone, so a tone-less pool writes the pre-T60 payload byte-for-byte.
  // `def.tone ?? DEFAULT_TONE`, not `def.tone`: `weightOf` reads a missing tone as `neutral`, so a beat
  // stamped with nothing is `neutral` to the actuator and, because `threatening` fails closed on an
  // absent tone, a THREAT to the sensor — the same scene, two opposite readings, decided by whether an
  // author typed the field. Resolving it here makes the two agree. Still gated on the pool authoring a
  // tone ANYWHERE, so a tone-less content set writes the pre-T60 payload byte-for-byte.
  const payload = tonesAuthored(graph)
    ? { encounter: def.id, category: def.category, tone: def.tone ?? DEFAULT_TONE }
    : { encounter: def.id, category: def.category };
  return appendBeat(engaged, beat(engaged, "encounter.begin", [def.id, active.node], payload));
}

// --- choices (availableActions) + narration (sceneOf) -----------------------------------------

/** The stage an active encounter currently sits at (with its def), or null. */
function activeStage(state: GameState, graph: RegionGraph | undefined): { def: EncounterDef; stage: EncounterStage; active: ActiveEncounter } | null {
  const active = activeEncounter(state);
  if (active === null) return null;
  const def = encounterOf(graph, active.encounter);
  if (def === undefined) return null;
  const stage = def.stages.find((s) => s.id === active.stage);
  if (stage === undefined) return null;
  return { def, stage, active };
}

/**
 * The choices offered while an encounter is engaged — the active stage's authored choices whose own
 * `requirements` currently hold. If none is available (all gated out), a single engine **"Step away"**
 * is offered so an encounter can never soft-lock the run (the T15/T40 rule that a way out always
 * exists). Empty when no encounter is active.
 */
export function eventChoices(state: GameState, graph: RegionGraph | undefined): readonly SceneChoice[] {
  const cur = activeStage(state, graph);
  if (cur === null) return [];
  const nodeId = state.player.location;
  const node = state.nodes[nodeId];
  const kind = graph?.nodes[nodeId]?.kind;
  const choices: SceneChoice[] = [];
  for (const c of cur.stage.choices) {
    if (node !== undefined && !matchesRequirement(state, c.requirements, node, nodeId, kind)) continue;
    choices.push({
      id: `event:${cur.def.id}:${c.id}`,
      label: c.label,
      timeCost: c.timeCost,
      action: { type: "event", choiceId: `event:${cur.def.id}:${c.id}`, timeCost: c.timeCost, params: { encounter: cur.def.id, choice: c.id } },
    });
  }
  if (choices.length === 0) {
    choices.push({
      id: `event:${cur.def.id}:step-away`,
      label: "Step away and leave it",
      timeCost: 1,
      action: { type: "event", choiceId: `event:${cur.def.id}:step-away`, timeCost: 1, params: { encounter: cur.def.id, choice: "step-away" } },
    });
  }
  return choices;
}

/** The active encounter stage's narration — the scene lead while one is engaged. Null when none is. */
export function eventLine(state: GameState, graph: RegionGraph | undefined): string | null {
  const cur = activeStage(state, graph);
  return cur === null ? null : cur.stage.narration;
}

// --- dispatch (pipeline stage 3) --------------------------------------------------------------

/** Whether an action is one this module owns. */
export function isEventAction(action: Action): boolean {
  return action.type === "event";
}

/**
 * Resolve an engaged encounter choice (stage 3). Applies the choice's declarative effects in order,
 * then advances the flow: an `advanceStage` effect moves the active encounter to its next stage;
 * otherwise the encounter resolves — the active slot clears and its one-shot done-flag is stamped.
 * An unrelated / stale action passes through unchanged. Pure, deterministic.
 */
export function resolveEventAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  const cur = activeStage(state, graph);
  if (cur === null) return state;
  const choiceId = typeof action.params?.["choice"] === "string" ? (action.params["choice"] as string) : null;
  if (choiceId === null) return state;

  // The engine anti-softlock disengage — resolve the encounter with no other effect.
  if (choiceId === "step-away") {
    return endEngaged(state, cur.def, cur.active.node, "encounter.left");
  }

  const choice = cur.stage.choices.find((c) => c.id === choiceId);
  if (choice === undefined) return state;

  const ctx: EffectCtx = graph === undefined
    ? { encounterId: cur.def.id, node: cur.active.node }
    : { encounterId: cur.def.id, node: cur.active.node, graph };
  let s = state;
  for (const effect of choice.effects) s = applyEncounterEffect(s, effect, ctx);

  // Flow: advance to the named next stage, else resolve (implicit end).
  const advance = choice.effects.find((e): e is Extract<EncounterEffect, { kind: "advanceStage" }> => e.kind === "advanceStage");
  if (advance !== undefined && cur.def.stages.some((st) => st.id === advance.to)) {
    return setActive(s, { ...cur.active, stage: advance.to });
  }
  return endEngaged(s, cur.def, cur.active.node, "encounter.end");
}

/** Close out an engaged encounter: clear the active slot and stamp its one-shot done-flag. */
function endEngaged(state: GameState, def: EncounterDef, node: NodeId, beatType: string): GameState {
  const cleared = clearActive(state);
  const flags = def.repeatable === true ? cleared.player.flags : { ...cleared.player.flags, [doneFlagKey(def, node)]: true };
  const withFlags = { ...cleared, player: { ...cleared.player, flags } };
  return appendBeat(withFlags, beat(withFlags, beatType, [def.id, node], { encounter: def.id }));
}

// --- scheduled follow-ups (pipeline stage 12) -------------------------------------------------

/** The scheduled-event kind a `scheduleFollowup` effect enqueues (a timed chain flag). */
export const ENCOUNTER_EVENT_KIND = "encounter.followup";

function isDue(state: GameState, ev: ScheduledEvent): boolean {
  return ev.dueDay < state.meta.day || (ev.dueDay === state.meta.day && ev.dueHour <= state.meta.hour);
}

/**
 * Stage-12 body: resolve every due encounter follow-up in the queue — set its chain flag so a later
 * encounter becomes eligible — removing it as it fires. Inert when the queue holds no due follow-up, so
 * every prior run (empty queue) is byte-identical. Pure.
 */
export function resolveDueEncounterEvents(state: GameState): GameState {
  if (state.queue.length === 0) return state;
  let s = state;
  const remaining: ScheduledEvent[] = [];
  let changed = false;
  for (const ev of state.queue) {
    if (ev.kind !== ENCOUNTER_EVENT_KIND || !isDue(s, ev)) {
      remaining.push(ev);
      continue;
    }
    const flag = typeof ev.data === "object" && ev.data !== null && "flag" in ev.data ? String((ev.data as { flag: unknown }).flag) : "";
    if (flag.length > 0) {
      s = { ...s, player: { ...s.player, flags: { ...s.player.flags, [flag]: true } } };
      s = appendBeat(s, beat(s, "encounter.followup", [flag], { flag }));
    }
    changed = true;
  }
  return changed ? { ...s, queue: remaining } : s;
}
