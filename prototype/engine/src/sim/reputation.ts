/**
 * Faction reputation — the standing axis made consequential (M5 task T86 · FR-NPC-10 · GDD Part XII
 * "Survivors, NPCs & Factions"). Closes PL-M4-43; the prerequisite half of PL-M4-34.
 *
 * T53 gave the game three well-written factions and seeded `player.reputation` + `state.groups` from
 * them. **Nothing ever read either.** Measured on the shipped tree before this task (`measure/t86.ts`):
 *
 *   - `player.reputation` has exactly ONE writer (`seedFactions`) and **zero readers** anywhere in
 *     `engine/src`; `groups[].hostility` and `groups[].strength` likewise. All six faction-graph readers
 *     (`factionPool`/`factionOf`/`factionIdOfNpc`/`areRivals`/`bondSeed`/`factionArchetype`) are
 *     imported by NOTHING outside `social.ts` and the barrel.
 *   - Reputation changed in **0 of 160 runs**. There was no verb that moved it, so — as the design
 *     review put it — helping one faction could not anger another.
 *
 * The brief asked for three cash-outs: a reputation floor forcing `disposition: "hostile"` (which
 * `canRecruitEligible` already refuses), a faction `homeNode` offering **trade** at high standing, and
 * the same node seeding an **ambush** at low standing. **Two of the three were measured unbuildable
 * as written, and the third gates something that never happens:**
 *
 *   - **The recruit gate fires 0 times.** Faction members recruited across 320 measured runs (160 of
 *     them immortal): **zero**. A maximum-favourable immortal suitor that walks straight to each of the
 *     ten faction survivors and then does nothing but talk/feed/water/recruit reaches eight of them,
 *     **meets three**, and **recruits none** — `met` requires `talk:`, `talk:` is offered only while
 *     unmet, and `RECRUIT_MIN` (70) is two `share` steps above every disposition but `friendly`.
 *   - **Nobody stands on a homeNode.** In ordinary play the marina is reached in **10%** of runs and
 *     the Quad and the Foundry in **0%**. The cause is mortality, not topology — an immortal bot
 *     reaches all three, while a mortal one is ended by `lastStand` in 30–40 of 40 runs by day 1.8–3.7.
 *   - **There is no trade verb.** The engine dispatches 37 action types and none of them trades.
 *     Trading stays PL-M4-34's, unchanged.
 *
 * So T86 keeps the brief's *mechanism* and moves its *occasions* onto machinery the player actually
 * meets:
 *
 *   1. **Reputation moves through the three people-verbs that already exist** — `give-food`/`give-water`
 *      (share), `recruit`, `threaten` — each of which already threads `graph` and already gates on
 *      `socialActive`. Plus the authored `adjustReputation` encounter effect, because **encounters are
 *      the liveliest channel in the game** (11.8 fire per ordinary run, 66 per immortal one).
 *   2. **Standing spills to rivals.** Raising one faction lowers the ones it feuds with, so the design
 *      review's sentence finally holds. The rivalry is **DERIVED from the authored npc grudges** —
 *      `content/factions/*.json` already names `npc.hector-ruiz ↔ npc.sarah` and `npc.dana ↔ npc.marcus`,
 *      which are cross-faction pairs — union an optional faction-level `rivals` list. Read off the
 *      graph, **never stored** (the T79 `lastVisit` / T84 `richness` / T85 `roomSlots` precedent).
 *   3. **Standing is read as TERRITORY, not one node.** A faction's people carry its standing: at or
 *      below {@link REPUTATION_HOSTILE_AT} every member reads and behaves `hostile` — no parley, no
 *      recruit, and the Scene says so. And `minReputation`/`maxReputation` gate the encounter pool, so
 *      an authored beat can fire (or refuse to) on how a district holds you.
 *
 * Every write goes through {@link adjustReputation}, which is inert without a registered faction pool,
 * and every read is derived from the pool — so a run that registers no factions is **byte-identical**,
 * and nothing here takes a save-schema rung (stays v10). Pure, integer-only (ADR-0001), no RNG.
 */

import type { ActorId, GameState, GroupId, ContentId, NPCDisposition, SocialMemory } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import type { FactionDef } from "./social.js";

// --- dials (first-pass; M5 T59/T60 balance owns the tuning) -----------------------------------

/** Standing floor/ceiling — the same −100..100 band `seedFactions` clamps its baseline into. */
export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;

/**
 * Standing steps for the three people-verbs the engine actually offers. Asymmetric in the T34
 * `TRUST_DELTAS` idiom — harm outweighs help, so a faction is cheap to offend and slow to win back.
 */
export const REPUTATION_SHARE = 4;
export const REPUTATION_RECRUIT = 6;
export const REPUTATION_THREATEN = -12;
/** Cruelty done where one of a faction's people can see it (the `saw-cruelty` hook). */
export const REPUTATION_CRUELTY = -8;

/**
 * What a rival faction takes from a **public** standing move, as a percentage, truncated toward zero and
 * sign-flipped: put two of the Crew down at the overpass and the Holdout, who feud with them, are glad
 * to hear it.
 *
 * **It applies ONLY to {@link adjustReputationPublic}, never to the quiet people-verbs**, and that split
 * is a fix, not a flourish. A first cut spilled on every write at 50%, and the audit proved the obvious
 * consequence: alternating a `give-food` between two feuding factions nets each of them
 * `delta × (1 − pct/100)` per cycle, unbounded to the clamp — measured at +2 to BOTH the Harbor Holdout
 * and the Slagworks Crew per pair of shared meals, which defeats the entire point of an axis you are
 * supposed to have to choose sides on. No spill percentage fixes that (100% conserves for a feuding
 * PAIR but leaks the moment one faction has two rivals and the other has one), so the cure is the
 * channel, not the number: a shared meal is private and moves one faction; what you did at the overpass
 * is public and every faction hears it. Authored encounter effects and witnessed cruelty are public;
 * `give-food` / `give-water` / `recruit` / `threaten` are not. A one-shot encounter cannot be farmed.
 */
export const REPUTATION_SPILL_PCT = 50;

/**
 * The two gates, **set by measurement, not by taste** (the T85 cistern rule: a threshold nothing reaches
 * has re-created the defect it was built to fix). At or below {@link REPUTATION_HOSTILE_AT} a faction's
 * people read and behave as `hostile` — they will not parley and they will not join; at or above
 * {@link REPUTATION_WARM_AT} they count you as their own, and the authored aid beats open.
 *
 * A first cut at ±50 was crossed by **nothing**: `measure/t86.ts --standing` ran three temperaments over
 * 40 runs and reached HATED in 0% and KIN in 0%, and the reputation-gated encounters fired in none of
 * them. `--zealot` — an immortal bot that tours every authored standing act for one faction and takes
 * the extreme choice each time, the ceiling the CONTENT allows — reached a best standing of +67/−65 for
 * the Harbor Holdout, −67 for the Slagworks Crew, and only +40/−8 for the Quad Collective. ±40 is the
 * band those three actually straddle. What still does NOT cross is declared, not tuned away:
 * the Slagworks Crew cannot be won round at all (every positive act it authors totals +14 from a −25
 * baseline) and the Quad Collective cannot be made to hate you.
 */
export const REPUTATION_HOSTILE_AT = -40;
export const REPUTATION_WARM_AT = 40;

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

const clampRep = (n: number): number => Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.trunc(n)));

// --- the faction pool on the transient graph (never serialized) --------------------------------

/** The registered faction pool for this run, or empty when none is registered (inert). */
export function factionPool(graph: RegionGraph | undefined): readonly FactionDef[] {
  return graph?.factions ?? [];
}

/** Look up a faction def by id. */
export function factionOf(graph: RegionGraph | undefined, id: GroupId): FactionDef | undefined {
  return factionPool(graph).find((f) => f.id === id);
}

/** The faction id that lists `npcId` as a member (first by sorted faction id), or null. */
export function factionIdOfNpc(graph: RegionGraph | undefined, npcId: ContentId): GroupId | null {
  for (const f of [...factionPool(graph)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (f.members.includes(npcId)) return f.id;
  }
  return null;
}

/** Whether two survivors are named rivals in any faction's `rivalries`. */
export function areRivals(graph: RegionGraph | undefined, a: ContentId, b: ContentId): boolean {
  for (const f of factionPool(graph)) {
    for (const r of f.rivalries ?? []) {
      if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return true;
    }
  }
  return false;
}


// --- how ONE PERSON holds you: the respect / fear / memory axes (T53 · FR-NPC-02) -------------
// These moved here from `sim/social.ts` in T86 so this module can stay a LEAF. `sim/events.ts` needs
// `remember` for the cruelty hook and `socialActive` for the gate, while `sim/social.ts` reads
// `humanityOf` from events — importing social into events would have closed a cycle. They are
// re-exported from social.ts verbatim, so every T53-era import path is unchanged.

/** Most memories a survivor keeps — bounded so a long run never grows the save unboundedly (PL-M2-06). */
export const MEMORY_CAP = 12;
/** Neutral starting respect when a survivor has never been read (they don't defer to a stranger yet). */
export const DEFAULT_RESPECT = 30;
/**
 * Signed respect/fear steps per remembered act — asymmetric (harm outweighs help), echoing T34's `TRUST_DELTAS`.
 * `trust` is NOT here: it keeps moving through T34's `applyTrustEvent`, so this overlay never double-counts it.
 */
export const SOCIAL_DELTAS: { readonly [kind: string]: { readonly respect: number; readonly fear: number } } = {
  kindness: { respect: 4, fear: -2 }, // sharing food/water
  "stood-by-me": { respect: 8, fear: 0 }, // helped / kept a promise
  confided: { respect: 2, fear: 0 }, // shared a lead (the ask bond)
  "menaced-me": { respect: -6, fear: 18 }, // threatened — a bully is feared, not respected (drives the hard turns)
  "robbed-me": { respect: -6, fear: 10 },
  abandoned: { respect: -10, fear: 6 },
  "saw-cruelty": { respect: -4, fear: 8 }, // witnessed cruelty to another (reserved; needs an events hook)
};

// --- the attitude axes (optional/tolerated-absent — the T52 discipline) -----------------------

/** A survivor with the optional social axes — both {@link NPCState} and {@link Survivor} satisfy it. */
export type AxisActor = {
  readonly respect?: number;
  readonly fear?: number;
  readonly memory?: readonly SocialMemory[];
};

/** Respect toward the player (defaults to {@link DEFAULT_RESPECT} when never read). */
export function respectOf(actor: AxisActor): number {
  return actor.respect ?? DEFAULT_RESPECT;
}
/** Fear of the player (defaults to 0). */
export function fearOf(actor: AxisActor): number {
  return actor.fear ?? 0;
}
/** A survivor's remembered social events (empty when none). */
export function memoryOf(actor: AxisActor): readonly SocialMemory[] {
  return actor.memory ?? [];
}

/**
 * Record a remembered act and nudge the survivor's respect/fear by it (FR-NPC-02). Pure — returns a new
 * survivor with the memory appended (bounded to {@link MEMORY_CAP}) and the axes moved. Generic over
 * {@link NPCState} and {@link Survivor}. Callers apply this ONLY when {@link socialActive}, so a pool-less
 * run never writes a memory/respect/fear field — the byte-identity guarantee.
 */
export function remember<T extends AxisActor>(actor: T, kind: string, turn: number, other?: ActorId): T {
  const d = SOCIAL_DELTAS[kind];
  const respect = clampPct(respectOf(actor) + (d?.respect ?? 0));
  const fear = clampPct(fearOf(actor) + (d?.fear ?? 0));
  const entry: SocialMemory = other === undefined ? { kind, turn } : { kind, turn, other };
  const prior = memoryOf(actor);
  const memory = [...prior, entry].slice(-MEMORY_CAP);
  return { ...actor, respect, fear, memory };
}

/** A legible band for respect/fear/trust prose (never a number — FR-UI-02). */
export type AttitudeBand = "none" | "low" | "some" | "high";
export function band(value: number): AttitudeBand {
  const v = clampPct(value);
  if (v < 20) return "none";
  if (v < 45) return "low";
  if (v < 70) return "some";
  return "high";
}


/**
 * Is the social system active on this run? The master gate: a graph built without a faction pool leaves the
 * whole social layer dark — no memory, no respect/fear, no ask, no desertion/betrayal, no morale drift, no
 * off-screen people tick, no movement — so every prior run (which registers none) is byte-identical.
 */
export function socialActive(graph: RegionGraph | undefined): boolean {
  return factionPool(graph).length > 0;
}

// --- faction-level rivalry, DERIVED ------------------------------------------------------------

/**
 * The factions `id` feuds with — **derived, never stored**. Two sources, unioned:
 *
 *   - every authored `rivalries` pair whose two survivors sit in DIFFERENT factions (the shipped
 *     content already names two such grudges, both between the Slagworks Crew and the Harbor Holdout);
 *   - an optional faction-level `rivals` list, for a feud with no named survivors behind it.
 *
 * Symmetric by construction (a pair is read from both ends) and returned in sorted order, so the spill
 * in {@link adjustReputation} is deterministic however the pool is ordered. A faction is never its own
 * rival, and an id that names no registered faction contributes nothing.
 */
export function factionRivalsOf(graph: RegionGraph | undefined, id: GroupId): readonly GroupId[] {
  const pool = factionPool(graph);
  if (pool.length === 0) return [];
  const out = new Set<GroupId>();
  const home = factionOf(graph, id);
  for (const r of home?.rivals ?? []) if (r !== id && pool.some((f) => f.id === r)) out.add(r);
  for (const f of pool) {
    // the authored survivor grudges, read as faction-level feuds
    for (const pair of f.rivalries ?? []) {
      const fa = factionIdOfNpc(graph, pair.a);
      const fb = factionIdOfNpc(graph, pair.b);
      if (fa === null || fb === null) continue;
      // A SAME-faction grudge (the shipped Slagworks content has none, but a faction may name one) can
      // only ever add `id` to its own rival set here, which the `out.delete(id)` below removes — so
      // there is deliberately no `fa === fb` guard. Mutation testing found the guard unkillable because
      // it was exactly redundant with that delete; one of the two had to go, and the delete is the one
      // that also covers an authored `rivals` entry naming itself.
      if (fa === id) out.add(fb);
      if (fb === id) out.add(fa);
    }
    // the other end of an authored faction-level list
    if (f.id !== id && (f.rivals ?? []).includes(id)) out.add(f.id);
  }
  // Never your own rival — this is what makes the same-faction grudge above a no-op, and it is the
  // only thing that does.
  out.delete(id);
  // Sorted, because the spill in `adjustReputationPublic` walks this list and a run must replay the
  // same way whatever order the faction pool happens to arrive in.
  return [...out].sort();
}

// --- the axis ----------------------------------------------------------------------------------

/** The player's standing with a faction (0 when it registers none — the pool-less default). */
export function reputationOf(state: GameState, factionId: GroupId): number {
  return state.player.reputation[factionId] ?? 0;
}

/**
 * Move the player's standing with ONE faction by `delta`, and nobody else. The quiet channel: a meal
 * shared with a survivor, a menace, a recruitment — things only the people involved know about.
 * Clamped to −100..100.
 *
 * Inert — returns the SAME object — when the run registers no faction pool, when `factionId` names no
 * registered faction, or when `delta` truncates to zero. That inertness is the byte-identity guarantee:
 * every pre-T86 run registers no pool, so no caller of this can move a byte of it.
 */
export function adjustReputation(
  state: GameState,
  graph: RegionGraph | undefined,
  factionId: GroupId | null,
  delta: number,
): GameState {
  if (factionId === null) return state;
  if (factionOf(graph, factionId) === undefined) return state;
  const d = Math.trunc(delta);
  // A non-finite step must never reach the save. T83's audit found a NaN in `regionDrift` and T84's found
  // the IDENTICAL shape one task later, both because a guard checked `=== 0` and let NaN through
  // (NaN !== 0, and Math.max/min propagate it straight into a serialized integer). This is that guard.
  if (!Number.isFinite(d) || d === 0) return state;
  const next: Record<GroupId, number> = { ...state.player.reputation };
  next[factionId] = clampRep(reputationOf(state, factionId) + d);
  return { ...state, player: { ...state.player, reputation: next } };
}

/**
 * A standing move everyone hears about: the faction itself moves by `delta`, and each faction it feuds
 * with moves by the sign-flipped {@link REPUTATION_SPILL_PCT} share of it (truncated toward zero — a
 * ±1 step spills nothing, which is the intended floor, not a rounding bug). This is what makes the
 * design review's sentence true at last: helping one faction CAN now anger another.
 *
 * Reserved for the public occasions — an authored encounter effect, and cruelty done where a faction's
 * people can see it. The repeatable people-verbs deliberately do NOT come through here; see
 * {@link REPUTATION_SPILL_PCT} for the measured reason. Inert on the same three conditions as
 * {@link adjustReputation}.
 */
export function adjustReputationPublic(
  state: GameState,
  graph: RegionGraph | undefined,
  factionId: GroupId | null,
  delta: number,
): GameState {
  const moved = adjustReputation(state, graph, factionId, delta);
  if (moved === state || factionId === null) return moved;
  const d = Math.trunc(delta);
  const spill = Math.trunc((Math.abs(d) * REPUTATION_SPILL_PCT) / 100) * (d > 0 ? -1 : 1);
  // A pure fast path: with a zero spill the loop below would rewrite every rival to the value it
  // already holds and allocate a new state for nothing. Mutation testing confirms removing this line is
  // behaviourally EQUIVALENT — it is kept for the allocation, not for the semantics.
  if (spill === 0) return moved;
  const next: Record<GroupId, number> = { ...moved.player.reputation };
  for (const rival of factionRivalsOf(graph, factionId)) {
    next[rival] = clampRep(reputationOf(moved, rival) + spill);
  }
  return { ...moved, player: { ...moved.player, reputation: next } };
}

/**
 * The standing behind a survivor — the player's reputation with whichever faction claims them, or null
 * when they belong to none (eight of the eighteen shipped survivors are unaffiliated, and they are
 * untouched by every rule here).
 */
export function standingOf(state: GameState, graph: RegionGraph | undefined, npcId: ContentId): number | null {
  const fid = factionIdOfNpc(graph, npcId);
  return fid === null ? null : reputationOf(state, fid);
}

/** Whether a survivor's faction holds the player at or below {@link REPUTATION_HOSTILE_AT}. */
export function standingIsHostile(state: GameState, graph: RegionGraph | undefined, npcId: ContentId): boolean {
  const s = standingOf(state, graph, npcId);
  return s !== null && s <= REPUTATION_HOSTILE_AT;
}

/** Whether a survivor's faction holds the player at or above {@link REPUTATION_WARM_AT}. */
export function standingIsWarm(state: GameState, graph: RegionGraph | undefined, npcId: ContentId): boolean {
  const s = standingOf(state, graph, npcId);
  return s !== null && s >= REPUTATION_WARM_AT;
}

/**
 * How a survivor actually holds themselves right now: their authored `disposition`, overridden to
 * `hostile` once their faction has been pushed to {@link REPUTATION_HOSTILE_AT} or below.
 *
 * **Derived, never stored** — `NPCState.disposition` keeps the authored value, so nothing here takes a
 * save rung and a faction won back reverts its people without a migration. Without a faction pool (or
 * without `graph`) this is the authored value verbatim, which is why every pre-T86 caller is unmoved.
 */
export function effectiveDisposition(
  state: GameState,
  graph: RegionGraph | undefined,
  npc: { readonly id: ContentId; readonly disposition: NPCDisposition },
): NPCDisposition {
  return standingIsHostile(state, graph, npc.id) ? "hostile" : npc.disposition;
}

/** A legible standing band for prose — never a number (FR-UI-02). */
export type StandingBand = "hated" | "resented" | "unknown" | "welcome" | "kin";
export function standingBand(value: number): StandingBand {
  if (value <= REPUTATION_HOSTILE_AT) return "hated";
  if (value < -10) return "resented";
  // 25, not 20: the Quad Collective's authored baseline IS 20, and a floor of 20 had the Scene telling
  // the player "the Quad owe you something" on turn zero, before a single action. A band must not assert
  // a debt nobody has incurred, so the boundary sits above the highest authored baseline.
  if (value < 25) return "unknown";
  if (value < REPUTATION_WARM_AT) return "welcome";
  return "kin";
}

/**
 * A words-only read of how a survivor's PEOPLE hold the player, for the Scene line. Null when the
 * survivor has no faction or their faction has no strong view — a stranger reads by their own
 * disposition (T35), untouched.
 */
export function standingLine(
  state: GameState,
  graph: RegionGraph | undefined,
  npcId: ContentId,
  npcName: string,
): string | null {
  const fid = factionIdOfNpc(graph, npcId);
  if (fid === null) return null;
  const def = factionOf(graph, fid);
  if (def === undefined) return null;
  switch (standingBand(reputationOf(state, fid))) {
    case "hated":
      return `${npcName} has heard what ${def.name} say about you — there is nothing to talk about.`;
    case "resented":
      return `${npcName} keeps their distance; word from ${def.name} has not been kind.`;
    case "welcome":
      return `${npcName} knows ${def.name} owe you something.`;
    case "kin":
      return `${npcName} greets you the way ${def.name} greet their own.`;
    default:
      return null;
  }
}
