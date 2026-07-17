/**
 * Factions & inter-NPC relationships — the social simulation (M4 task T53 · FR-NPC-02/05/06/07 · GDD Part
 * XII "Survivors, NPCs & Factions", the game's soul).
 *
 * The people-substrate (T33 spawn, T34 trust, T35 talk/share/threaten, T36/T45 companions) gave survivors
 * state and a single trust scalar. T53 makes them **socially alive**:
 *
 *   - **Memory → trust / respect / fear (FR-NPC-02).** Beside T34's `trust`, a survivor now carries
 *     `respect` (do they defer to you?) and `fear` (do they dread you?), each moved by a bounded, append-only
 *     `memory` of what you did — not a global bar, per-character and per-relationship. `trust` still moves
 *     through T34's `applyTrustEvent` (so every T34/T35/T36 test holds); respect/fear/memory are the overlay.
 *   - **Conversations that hint (FR-NPC-06).** A survivor's authored `knowledge` (`NPCDef.knowledge`) is real,
 *     actionable leads — once they trust you, `ask` them and the lead **reveals a node** or **marks a
 *     discovery**. Listening pays in world state, never a quest marker.
 *   - **Desertion & betrayal (FR-NPC-05).** A companion ground down (low morale under a cruel leader, or
 *     terrified) long enough **deserts**; a mistreated, disrespectful one **betrays** — takes a slice of the
 *     base stash on the way out. Deterministic thresholds; a betrayal sticks.
 *   - **Inter-NPC bonds → shelter morale (FR-NPC-07).** Recruited survivors carry `relationships` with each
 *     other, seeded from authored faction co-membership (+) and rivalries (−); the mix of who is home moves
 *     shelter morale (the aggregate of resident `mind.morale`), surfaced in the daily report.
 *   - **The off-screen people-sim (PL-M3-02 / PL-M4-35).** Survivors drift and move while you are away.
 *
 * Faithful to the T47/T50/T51/T52 idiom: a faction is authored JSON (`content/factions/*.json`) interpreted
 * generically over the transient `graph.factions` pool (the npc *catalog* rides `graph.people` for leads).
 * The master gate {@link socialActive} is dark without a faction pool, so **every prior run is byte-identical**
 * — no memory written, no respect/fear, no morale drift, no desertion, no off-screen people tick, no group
 * movement. Nothing is seeded at spawn, so the new survivor fields are optional/tolerated-absent and T53 takes
 * **no save-schema rung** (the T45/T52 discipline; stays v10). No new loot-table growth, no new item, and —
 * because desertion/movement/leads are all deterministic — **no new RNG stream**. Pure, integer-only (ADR-0001).
 */

import type {
  ActorId,
  ContentId,
  GameState,
  GroupId,
  HistoryEvent,
  InventoryEntry,
  NodeId,
  NPCState,
  SocialMemory,
  Survivor,
  SurvivorGroup,
} from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import type { NPCDef, NpcLead } from "./npcs.js";
import { companionIds, isCompanion } from "./companions.js";
import { humanityOf } from "./events.js";
import { neighborsOf } from "../map/regionGraph.js";

// --- content shape (mirrored by content/schemas/faction.schema.json) --------------------------

/** Optional starting integers a faction seeds into `groups`/`reputation` (all 0–100 / −100..100 ints). */
export interface FactionBaseline {
  readonly strength?: number;
  readonly hostility?: number;
  /** The player's starting standing with this faction (−100..100). */
  readonly reputation?: number;
}

/** An unordered pair of survivor ids (a rivalry). */
export interface FactionPair {
  readonly a: ContentId;
  readonly b: ContentId;
}

/**
 * A static survivor faction — mirrors `content/schemas/faction.schema.json`. The engine interprets these
 * generically: at run start each seeds a {@link SurvivorGroup} into `state.groups` and a `player.reputation`
 * entry; co-`members` trend friendly and `rivalries` trend hostile (seeding companions' `relationships`); a
 * faction's `homeNode` is where its off-screen survivors regroup.
 */
export interface FactionDef {
  readonly id: GroupId;
  readonly name: string;
  /** Identity key for prose ("collective" | "holdout" | "raiders" | …) — FR-NPC-10 identity, first pass. */
  readonly archetype: string;
  readonly description: string;
  /** Where this faction gathers — its survivors drift here off-screen (PL-M3-02). */
  readonly homeNode?: NodeId;
  /** Content-defined goal key driving off-screen behaviour (reserved for diplomacy; movement uses `homeNode`). */
  readonly goal?: string;
  /** The survivor ids that belong to this faction. */
  readonly members: readonly ContentId[];
  readonly baseline?: FactionBaseline;
  /** Pairs of members (or cross-faction ids) who don't get along — seeds a negative `relationships` bond. */
  readonly rivalries?: readonly FactionPair[];
}

// --- dials (first-pass identity values; M5 T59/T60 balance) -----------------------------------

/** Most memories a survivor keeps — bounded so a long run never grows the save unboundedly (PL-M2-06). */
export const MEMORY_CAP = 12;
/** Neutral starting respect when a survivor has never been read (they don't defer to a stranger yet). */
export const DEFAULT_RESPECT = 30;
/** Time cost (hours) of asking a survivor what they know — a real, costed turn (FR-CORE-03). */
export const ASK_COST = 1;
/** Trust a survivor needs before they'll share a lead, unless the lead authors its own `minTrust`. */
export const ASK_TRUST_MIN = 40;
/** Confiding builds the bond a little — the trust/respect a shared lead earns (listening matters both ways). */
export const ASK_TRUST_GAIN = 3;
export const ASK_RESPECT_GAIN = 4;

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

/** A companion is neglected (unfed) above this need — an individual mistreatment that erodes morale + trust. */
export const NEGLECT_AT = 50;
/** Sustained need at/above which neglect also erodes a companion's TRUST — the reachable "low trust" path. */
export const NEGLECT_TRUST_AT = 75;

/** Shelter-morale model: residents drift toward a target set by who lives together and how you lead. */
export const MORALE_BASELINE = 60;
export const MORALE_HOURS_PER_STEP = 6;
export const MORALE_STEP = 4;
/** Per allied / rival resident companion present, the morale target rises / falls this much. */
export const ALLY_MORALE = 3;
export const RIVAL_MORALE = 4;
/** Seeded `relationships` value between two co-faction (ally) / rival companions. */
export const ALLY_SEED = 30;
export const RIVAL_SEED = -30;

/** Desertion (FR-NPC-05): a companion this unhappy or this afraid, for {@link DESERT_HOURS} of it, leaves. */
export const DESERT_MORALE = 25;
export const DESERT_FEAR = 80;
/**
 * Hours of sustained misery (low morale or high fear) that tip a companion into leaving. Accrued by ELAPSED
 * HOURS, not per tick, so the outcome is invariant to how the client chunks time — one long fast-forward and
 * many short turns over the same hours agree (the jobs.ts "a played hour == a fast-forwarded hour" discipline).
 */
export const DESERT_HOURS = 18;
/**
 * Betrayal is the worse door: a deserter robs the base on the way out when they are malicious (no respect)
 * or terrified (high fear) toward you — OR when they leave a leader whose {@link humanityOf} has sunk to the
 * cruel band ({@link BETRAY_HUMANITY}): under a leader who has done terrible things, people don't just walk,
 * they take what they can. The first two are reachable by menacing a survivor before recruiting them; the
 * humanity path is reachable through the moral-encounter system (PL-M4-15 — humanity's teeth).
 */
export const BETRAY_RESPECT = 20;
export const BETRAY_FEAR = 85;
export const BETRAY_HUMANITY = 28;
export const BETRAY_STASH_UNITS = 2;

/** Off-screen: a survivor away from their faction's home steps one node toward it every this many hours. */
export const MOVE_HOURS = 12;

/** Flag prefix marking a lead a survivor has already shared (`told:<leadId>`) — open flags, no save rung. */
export const TOLD_FLAG_PREFIX = "told:";
/** Flag prefix remembering a companion who left the party (desertion/betrayal), like T36's `fallen.<id>`. */
export const LEFT_FLAG_PREFIX = "left.";

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

// --- pool on the transient graph (never serialized) -------------------------------------------

/** The registered faction pool for this run, or empty when none is registered (inert). */
export function factionPool(graph: RegionGraph | undefined): readonly FactionDef[] {
  return graph?.factions ?? [];
}

/** Look up a faction def by id. */
export function factionOf(graph: RegionGraph | undefined, id: GroupId): FactionDef | undefined {
  return factionPool(graph).find((f) => f.id === id);
}

/**
 * Is the social system active on this run? The master gate: a graph built without a faction pool leaves the
 * whole social layer dark — no memory, no respect/fear, no ask, no desertion/betrayal, no morale drift, no
 * off-screen people tick, no movement — so every prior run (which registers none) is byte-identical.
 */
export function socialActive(graph: RegionGraph | undefined): boolean {
  return factionPool(graph).length > 0;
}

/** The survivor catalog registered for this run (for reading authored `knowledge`), or empty. */
export function peopleCatalog(graph: RegionGraph | undefined): readonly NPCDef[] {
  return graph?.people ?? [];
}

/** The authored def for a survivor id (for their `knowledge` leads). */
export function npcDefOf(graph: RegionGraph | undefined, id: ContentId): NPCDef | undefined {
  return peopleCatalog(graph).find((d) => d.id === id);
}

// --- the attitude axes (optional/tolerated-absent — the T52 discipline) -----------------------

/** A survivor with the optional social axes — both {@link NPCState} and {@link Survivor} satisfy it. */
type AxisActor = {
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

// --- faction seeding (startRun) ---------------------------------------------------------------

/**
 * Seed the faction groups + the player's standing with each into a fresh run — the reserved `groups` and
 * `player.reputation` shapes, populated for the first time (T53). Inert when `defs` is empty, so a run that
 * registers no factions carries `groups: {}` / `reputation: {}` exactly as before — every prior run
 * byte-identical. Deterministic (defs in id order, member ids sorted).
 */
export function seedFactions(state: GameState, defs: readonly FactionDef[]): GameState {
  if (defs.length === 0) return state;
  const groups: Record<GroupId, SurvivorGroup> = { ...state.groups };
  const reputation: Record<GroupId, number> = { ...state.player.reputation };
  for (const def of [...defs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const base = def.baseline ?? {};
    groups[def.id] = {
      id: def.id,
      type: def.id,
      memberIds: [...def.members].sort(),
      homeNodeId: def.homeNode ?? null,
      goal: def.goal ?? "",
      strength: clampPct(base.strength ?? 50),
      hostility: clampPct(base.hostility ?? 0),
      flags: {},
    };
    reputation[def.id] = Math.max(-100, Math.min(100, Math.trunc(base.reputation ?? 0)));
  }
  return { ...state, groups, player: { ...state.player, reputation } };
}

// --- inter-NPC bonds (FR-NPC-07) --------------------------------------------------------------

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

/**
 * The seeded bond between two survivors: negative if they are rivals, positive if they share a faction, else
 * 0 (strangers). Deterministic; rivalry wins over co-membership (an explicit rivalry is the stronger fact).
 */
export function bondSeed(graph: RegionGraph | undefined, a: ContentId, b: ContentId): number {
  if (areRivals(graph, a, b)) return RIVAL_SEED;
  const fa = factionIdOfNpc(graph, a);
  return fa !== null && fa === factionIdOfNpc(graph, b) ? ALLY_SEED : 0;
}

// --- leads: the `ask` verb (FR-NPC-06) --------------------------------------------------------

/** A survivor's authored leads, or empty. */
export function leadsOf(graph: RegionGraph | undefined, npcId: ContentId): readonly NpcLead[] {
  return npcDefOf(graph, npcId)?.knowledge ?? [];
}

/** The per-lead "already shared" flag key, kept on the typed `player.flags` map (no NPCState widening). */
function toldKey(npcId: ActorId, leadId: string): string {
  return `${TOLD_FLAG_PREFIX}${npcId}:${leadId}`;
}

/**
 * The first lead this survivor will share right now, or null: not yet told, the survivor trusts you at/above
 * its threshold, and it actually points somewhere still worth revealing (an undiscovered node / an unmarked
 * discovery) — so a fully-spent survivor is simply not offered `ask` (no dead option). "Told" is tracked on
 * the player's own `flags` (`told:<npcId>:<leadId>`), so no survivor field is widened.
 */
export function untoldLead(state: GameState, graph: RegionGraph | undefined, npc: NPCState): NpcLead | null {
  const flags = state.player.flags;
  for (const lead of leadsOf(graph, npc.id)) {
    if (flags[toldKey(npc.id, lead.id)] === true) continue;
    if (npc.trust < (lead.minTrust ?? ASK_TRUST_MIN)) continue;
    if (leadResolves(state, lead)) return lead;
  }
  return null;
}

/** Whether acting on a lead would still change the world (an unrevealed node or an unmarked discovery). */
function leadResolves(state: GameState, lead: NpcLead): boolean {
  if (lead.reveals !== undefined) {
    const n = state.nodes[lead.reveals];
    if (n !== undefined && !n.discovered) return true;
  }
  if (lead.marks !== undefined) {
    const n = state.nodes[lead.marks.node];
    if (n !== undefined && !n.discoveries.includes(lead.marks.discovery)) return true;
  }
  return false;
}

// --- the seam: choices / dispatch / resolution ------------------------------------------------

/** Living met survivors at the player's node with a lead still to share, in stable id order. */
function askableHere(state: GameState, graph: RegionGraph | undefined): readonly { readonly npc: NPCState; readonly lead: NpcLead }[] {
  const here = state.player.location;
  const out: { npc: NPCState; lead: NpcLead }[] = [];
  for (const id of Object.keys(state.npcs).sort()) {
    const npc = state.npcs[id]!;
    if (!npc.alive || !npc.met || npc.location !== here) continue;
    const lead = untoldLead(state, graph, npc);
    if (lead !== null) out.push({ npc, lead });
  }
  return out;
}

/**
 * The social actions offered from the current state, in stable order — the `ask` verb, one per met survivor
 * present who has a lead to share. Empty unless the social system is active. Offered in the quiet explore
 * branch (a fight / walkers / active encounter pre-empt it, like radio/economy). Inert on every prior run.
 */
export function socialChoices(state: GameState, graph: RegionGraph | undefined): readonly SceneChoice[] {
  if (!socialActive(graph)) return [];
  const choices: SceneChoice[] = [];
  for (const { npc } of askableHere(state, graph)) {
    choices.push({
      id: `ask:${npc.id}`,
      label: `Ask ${npc.name} what they know`,
      timeCost: ASK_COST,
      action: { type: "ask", choiceId: `ask:${npc.id}`, timeCost: ASK_COST, params: { npc: npc.id } },
    });
  }
  return choices;
}

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export function isSocialAction(action: Action): boolean {
  return action.type === "ask";
}

/** Stamp + append a Living-History beat (append-only; never rewritten). Pure. */
function appendBeat(state: GameState, type: string, subjects: readonly string[], data: HistoryEvent["data"]): GameState {
  const { day, hour, turn } = state.meta;
  const beat: HistoryEvent = { day, hour, turn, type, subjects: [...subjects], data };
  return { ...state, history: [...state.history, beat] };
}

/** Reveal a node onto the player's map (fog lift) — the T11 `discovered` transition, for a far lead. */
function revealNode(state: GameState, nodeId: NodeId): GameState {
  const n = state.nodes[nodeId];
  if (n === undefined || n.discovered) return state;
  return { ...state, nodes: { ...state.nodes, [nodeId]: { ...n, discovered: true } } };
}

/** Mark a discovery into a node's memory (idempotent). */
function markDiscovery(state: GameState, nodeId: NodeId, discovery: ContentId): GameState {
  const n = state.nodes[nodeId];
  if (n === undefined || n.discoveries.includes(discovery)) return state;
  return { ...state, nodes: { ...state.nodes, [nodeId]: { ...n, discoveries: [...n.discoveries, discovery] } } };
}

/**
 * Resolve an `ask`: the survivor shares their first eligible lead. Reveals its node and/or marks its
 * discovery, flags the lead told, remembers the confidence (a small trust/respect bump — listening builds the
 * bond), and records a `social.confided` beat carrying the hint for the scene. Re-validates every gate; inert
 * on a forged/spent ask. Pure, deterministic.
 */
function resolveAsk(state: GameState, graph: RegionGraph | undefined, npcId: ActorId): GameState {
  const npc = state.npcs[npcId];
  if (npc === undefined || !npc.alive || !npc.met) return state;
  // Re-check co-location (a forged action with no choiceId skips stage-1 validation): you must be standing
  // with them to ask — the lead is a conversation, not a phone call.
  if (npc.location !== state.player.location) return state;
  const lead = untoldLead(state, graph, npc);
  if (lead === null) return state;

  let next = state;
  if (lead.reveals !== undefined) next = revealNode(next, lead.reveals);
  if (lead.marks !== undefined) next = markDiscovery(next, lead.marks.node, lead.marks.discovery);

  // Update the survivor: bump trust (clamped), remember the confidence + a respect bump; flag the lead told
  // on the player's own flags. Listening builds the bond both ways.
  const trust = clampPct(npc.trust + ASK_TRUST_GAIN);
  const confided = remember({ ...npc, trust }, "confided", state.meta.turn);
  const bumped = { ...confided, respect: clampPct(respectOf(confided) + ASK_RESPECT_GAIN) };
  next = {
    ...next,
    npcs: { ...next.npcs, [npcId]: bumped },
    player: { ...next.player, flags: { ...next.player.flags, [toldKey(npcId, lead.id)]: true } },
  };

  return appendBeat(next, "social.confided", [npcId], { npc: npcId, lead: lead.id, hint: lead.hint });
}

/** Resolve a social action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. */
export function resolveSocialAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  if (!socialActive(graph)) return state;
  const npcId = typeof action.params?.["npc"] === "string" ? (action.params["npc"] as ActorId) : null;
  if (action.type === "ask" && npcId !== null) return resolveAsk(state, graph, npcId);
  return state;
}

// --- the social tick: bonds, morale, desertion & betrayal (FR-NPC-05/07) ----------------------

/** How many units of a non-unique `type` a store holds. */
function stashCount(stash: readonly InventoryEntry[], type: string): number {
  let n = 0;
  for (const e of stash) if (e.type === type && e.itemId === undefined) n += Math.max(0, Math.trunc(e.quantity));
  return n;
}

/** Remove up to `qty` units of `type` from a store (first matching stack). Drops empty stacks. */
function stashTake(stash: readonly InventoryEntry[], type: string, qty: number): readonly InventoryEntry[] {
  let remaining = Math.max(0, Math.trunc(qty));
  if (remaining === 0) return stash;
  const out: InventoryEntry[] = [];
  for (const e of stash) {
    if (remaining > 0 && e.type === type && e.itemId === undefined) {
      const t = Math.min(remaining, e.quantity);
      remaining -= t;
      const left = e.quantity - t;
      if (left > 0) out.push({ ...e, quantity: left });
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Seed missing bonds between every pair of party companions from their faction alignment (idempotent). */
function seedCompanionBonds(state: GameState, graph: RegionGraph | undefined): GameState {
  const ids = companionIds(state);
  if (ids.length < 2) return state;
  let actors = state.actors as Record<ActorId, Survivor>;
  let changed = false;
  for (const id of ids) {
    const c = actors[id]!;
    let rels = c.relationships;
    let relChanged = false;
    for (const other of ids) {
      if (other === id) continue;
      if (rels[other] !== undefined) continue;
      const seed = bondSeed(graph, id, other);
      if (seed !== 0) {
        rels = { ...rels, [other]: seed };
        relChanged = true;
      }
    }
    if (relChanged) {
      actors = { ...actors, [id]: { ...c, relationships: rels } };
      changed = true;
    }
  }
  return changed ? { ...state, actors } : state;
}

/**
 * The morale target a resident companion drifts toward. Read from BOTH the leader's overall humanity AND
 * this companion's own treatment (FR-NPC-05 names trust/mistreatment, not a global bar): a companion you
 * don't feed (neglect), one you frightened into joining (terror), or one who barely trusts you sinks toward
 * leaving even under a decent leader — and a well-treated one holds even under a grim one. Then who is home
 * together (FR-NPC-07) lifts or grinds it.
 */
function moraleTarget(state: GameState, companion: Survivor): number {
  let target = MORALE_BASELINE;
  // A cruel leader disillusions everyone (PL-M4-15 — humanity's reader).
  const humanity = humanityOf(state);
  if (humanity < 50) target -= 50 - humanity;
  // Neglect: this companion's own unmet needs — you are not keeping them fed/watered. Weighted so a companion
  // you keep hungry (but alive) sinks toward leaving even under a decent leader (the individual-mistreatment
  // path FR-NPC-05 names), while a fed one holds.
  const worstNeed = Math.max(companion.condition.needs.hunger, companion.condition.needs.thirst);
  if (worstNeed > NEGLECT_AT) target -= Math.trunc(((worstNeed - NEGLECT_AT) * 3) / 2);
  // Terror: a companion afraid of you (fear carried from menacing them before they joined) is miserable.
  target -= Math.trunc(fearOf(companion) / 3);
  // Distrust: one whose trust you've eroded (through neglect, below) takes less heart from staying — the
  // reachable "low trust" desertion driver FR-NPC-05 names.
  const trust = companion.trust ?? MORALE_BASELINE;
  if (trust < 60) target -= 60 - trust;
  // Who's home together (FR-NPC-07): allies lift, resident rivals grind.
  const here = companion.location;
  for (const oid of companionIds(state)) {
    if (oid === companion.id) continue;
    const o = state.actors[oid]!;
    if (o.location !== here) continue;
    const rel = companion.relationships[oid] ?? 0;
    if (rel > 0) target += ALLY_MORALE;
    else if (rel < 0) target -= RIVAL_MORALE;
  }
  return clampPct(target);
}

/**
 * Advance the party's social state for `hours` (FR-NPC-05/07): seed bonds, drift each companion's morale
 * toward its target, accrue/relieve desertion pressure, and resolve desertion (or betrayal) for any companion
 * over the line. Run from BOTH the pipeline (stage 5) and `advanceWorld` (off-screen). Gated
 * `if (!socialActive) return state` and inert on a zero-hour tick / no companions — so every prior run is
 * untouched. Pure, deterministic, no RNG.
 */
export function tickPeople(state: GameState, graph: RegionGraph | undefined, hours: number): GameState {
  if (!socialActive(graph)) return state;
  const h = Math.max(0, Math.trunc(hours));
  if (h === 0) return state;
  let cur = seedCompanionBonds(state, graph);
  const ids = companionIds(cur);
  if (ids.length === 0) return cur;

  const steps = Math.trunc(h / MORALE_HOURS_PER_STEP);
  const humanity = humanityOf(cur); // fixed across the tick — the cruel-leader betrayal driver

  for (const id of ids) {
    const c = cur.actors[id];
    if (c === undefined || !isCompanion(c)) continue;

    // 1. Drift morale toward its target by up to MORALE_STEP·steps (a short action barely moves it).
    const target = moraleTarget(cur, c);
    let morale = c.condition.mind.morale;
    if (steps > 0 && morale !== target) {
      const room = MORALE_STEP * steps;
      const delta = Math.max(-room, Math.min(room, target - morale));
      morale = clampPct(morale + delta);
    }

    // 1b. Sustained severe neglect erodes TRUST too — the reachable "low trust" desertion path (FR-NPC-05).
    //     Trust only ever ROSE before (feeding, T45); a companion you keep badly starved now loses faith in
    //     you, which feeds the distrust morale penalty and can cost them the dangerous standing orders.
    const worstNeed = Math.max(c.condition.needs.hunger, c.condition.needs.thirst);
    let trust = c.trust ?? MORALE_BASELINE;
    if (worstNeed >= NEGLECT_TRUST_AT && steps > 0) trust = Math.max(0, trust - steps);

    // 2. Desertion pressure accrues by ELAPSED HOURS of misery (low morale or terror) and resets on
    //    contentment — so the tipping point is invariant to how the client chunks time.
    const unhappy = morale < DESERT_MORALE || fearOf(c) >= DESERT_FEAR;
    const pressure = unhappy ? (c.desertPressure ?? 0) + h : 0;

    if (pressure >= DESERT_HOURS) {
      // 3. They leave. A malicious (no respect), terrified (high fear), or cruelly-led (low humanity) deserter
      //    BETRAYS — takes a slice of the cache; a merely worn-down one under a decent leader just slips away.
      const betray = respectOf(c) <= BETRAY_RESPECT || fearOf(c) >= BETRAY_FEAR || humanity <= BETRAY_HUMANITY;
      const actors: Record<ActorId, Survivor> = { ...cur.actors };
      delete actors[id];
      let player = { ...cur.player, flags: { ...cur.player.flags, [LEFT_FLAG_PREFIX + id]: true } };
      let took = 0;
      if (betray) {
        const stash = player.stash;
        // Steal from the first non-empty stack the base holds (deterministic by stash order).
        const stealType = firstStashType(stash);
        if (stealType !== null) {
          took = Math.min(BETRAY_STASH_UNITS, stashCount(stash, stealType));
          player = { ...player, stash: stashTake(stash, stealType, took) };
        }
      }
      cur = { ...cur, actors, player };
      cur = appendBeat(cur, betray ? "social.betrayed" : "social.deserted", [id], {
        companion: id,
        name: c.name ?? id,
        took,
      });
      continue;
    }

    // Not leaving — write back morale + pressure (+ eroded trust) only when something actually moved (so a
    // content companion in a social run gains no spurious field, and a zero-hour/steady tick is a no-op).
    const priorPressure = c.desertPressure ?? 0;
    const trustMoved = trust !== (c.trust ?? MORALE_BASELINE);
    if (morale !== c.condition.mind.morale || pressure !== priorPressure || trustMoved) {
      const updated: Survivor = {
        ...c,
        ...(trustMoved ? { trust } : {}),
        desertPressure: pressure,
        condition: { ...c.condition, mind: { ...c.condition.mind, morale } },
      };
      cur = { ...cur, actors: { ...cur.actors, [id]: updated } };
    }
  }
  return cur;
}

/** The item type of the first non-empty non-unique stash stack (deterministic pick for a betrayal). */
function firstStashType(stash: readonly InventoryEntry[]): string | null {
  for (const e of stash) if (e.itemId === undefined && e.quantity > 0) return e.type;
  return null;
}

// --- off-screen movement: survivors regroup toward home (PL-M3-02) ----------------------------

/** BFS next hop from `from` toward `to` over the (undirected) graph, or null if unreachable / already there. */
function nextHopToward(graph: RegionGraph, from: NodeId, to: NodeId): NodeId | null {
  if (from === to) return null;
  const seen = new Set<NodeId>([from]);
  let frontier: { node: NodeId; first: NodeId }[] = [];
  for (const n of [...neighborsOf(graph, from)].sort()) {
    if (!seen.has(n)) {
      seen.add(n);
      frontier.push({ node: n, first: n });
    }
  }
  while (frontier.length > 0) {
    const next: { node: NodeId; first: NodeId }[] = [];
    for (const { node, first } of frontier) {
      if (node === to) return first;
      for (const nb of [...neighborsOf(graph, node)].sort()) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push({ node: nb, first });
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** The home node a survivor drifts toward off-screen — their faction's `homeNode`, or null. */
function homeForNpc(graph: RegionGraph | undefined, npcId: ContentId): NodeId | null {
  const fid = factionIdOfNpc(graph, npcId);
  if (fid === null) return null;
  return factionOf(graph, fid)?.homeNode ?? null;
}

/**
 * Off-screen survivor movement — the "survivors don't move" half of PL-M3-02. Each living non-party survivor
 * away from their faction's home steps one node toward it (deterministic BFS next hop) once per {@link
 * MOVE_HOURS}. Run from BOTH stage-10 `moveGroups` (on-turn) and `advanceWorld` (off-screen), gated on
 * `socialActive` so every prior run — whose `moveGroups` was the reserved `identity` no-op — is byte-identical.
 * Pure, deterministic, no RNG.
 */
export function tickGroups(state: GameState, graph: RegionGraph | undefined, hours: number): GameState {
  if (!socialActive(graph) || graph === undefined) return state;
  const h = Math.max(0, Math.trunc(hours));
  const steps = Math.trunc(h / MOVE_HOURS);
  if (steps === 0) return state;

  let npcs = state.npcs;
  let changed = false;
  for (const id of Object.keys(state.npcs).sort()) {
    const npc = npcs[id]!;
    if (!npc.alive || npc.location === null) continue;
    const home = homeForNpc(graph, npc.id);
    if (home === null || npc.location === home) continue;
    // Step up to `steps` hops toward home, capped so one long fast-forward can't teleport across the city.
    let loc = npc.location;
    let hops = Math.min(steps, 2);
    while (hops > 0 && loc !== home) {
      const next = nextHopToward(graph, loc, home);
      if (next === null) break;
      loc = next;
      hops -= 1;
    }
    if (loc !== npc.location) {
      npcs = { ...npcs, [id]: { ...npc, location: loc } };
      changed = true;
    }
  }
  return changed ? { ...state, npcs } : state;
}

// --- narration surfaced in sceneOf ------------------------------------------------------------

/**
 * The social system's contribution to the Scene, or null. Surfaces ONLY on a turn a social beat exists (a
 * lead confided, a companion deserted/betrayed) — the same this-turn tail-scan `jobLine`/`radioLine` use — so
 * it never clutters an ordinary scene. All words; no numbers (FR-UI-02). Pure — reads state + the append-only
 * log, advances nothing.
 */
export function socialLine(state: GameState, graph: RegionGraph | undefined): string | null {
  let confided: { readonly [k: string]: unknown } | null = null;
  const departures: { readonly [k: string]: unknown }[] = [];
  for (let i = state.history.length - 1; i >= 0; i--) {
    const ev = state.history[i]!;
    if (ev.turn !== state.meta.turn) break; // turn-ordered append-only log ⇒ past this turn's tail, stop
    const d = ev.data as { readonly [k: string]: unknown } | null;
    if (ev.type === "social.confided" && confided === null && d !== null) confided = d;
    if ((ev.type === "social.deserted" || ev.type === "social.betrayed") && d !== null) {
      departures.push({ ...d, kind: ev.type });
    }
  }

  const bits: string[] = [];
  // Departures lead — the sharpest social news (someone left / robbed you).
  for (const dep of departures) {
    const name = typeof dep["name"] === "string" ? (dep["name"] as string) : "One of your people";
    if (dep["kind"] === "social.betrayed") {
      const took = typeof dep["took"] === "number" ? (dep["took"] as number) : 0;
      bits.push(
        took > 0
          ? `${name} is gone in the night — and so is some of what the cache held. A betrayal, plain and cold.`
          : `${name} is gone in the night, and took what they could carry. A betrayal, plain and cold.`,
      );
    } else {
      bits.push(`${name} has slipped away in the night — you pushed them too far, or the days did. They will not be back.`);
    }
  }
  if (confided !== null) {
    const hint = typeof confided["hint"] === "string" ? (confided["hint"] as string) : "";
    if (hint.length > 0) bits.push(`They lower their voice: "${hint}"`);
  }
  return bits.length > 0 ? bits.join(" ") : null;
}

/** A short faction identity read for prose (its archetype), or null. */
export function factionArchetype(graph: RegionGraph | undefined, id: GroupId): string | null {
  return factionOf(graph, id)?.archetype ?? null;
}

// --- attitude & morale surfacing (FR-NPC-02/07 read as behaviour, never a number — FR-UI-02) ---

/**
 * A words-only read of how a met SURVIVOR holds themselves toward the player — the FR-NPC-02 respect/fear
 * axes surfaced as behaviour, never a number. Fear leads (the sharper tell), then deference (high respect)
 * or, once they've earned the read, plain contempt (low respect). Null when nothing notable shows — a
 * survivor you've done nothing to reads by their plain disposition (T35), untouched.
 */
export function attitudeRead(actor: AxisActor): string | null {
  const f = fearOf(actor);
  const r = respectOf(actor);
  if (f >= 70) return "flinching when you move — plainly afraid of you";
  if (f >= 45) return "keeping just out of your reach now";
  if (r >= 75) return "deferring to you, waiting on your word";
  if (r < 15 && memoryOf(actor).length > 0) return "meeting your eye with something like contempt";
  return null;
}

/**
 * The desertion tell for a COMPANION — a legible, in-prose warning a turn or two BEFORE they leave, so a
 * departure never comes out of nowhere (fairness). Reads their morale (unhappiness) then fear (terror). Null
 * when they're steady. Words only.
 */
export function companionUnease(c: Survivor): string | null {
  if (c.condition.mind.morale < DESERT_MORALE + 10) return "worn down and quiet — the kind of quiet that comes before a person slips away";
  if (fearOf(c) >= DESERT_FEAR) return "watching you like they're waiting for a reason to run";
  return null;
}

/**
 * The resident mood at the base — the FR-NPC-07 daily-report band, from the average morale of the companions
 * who are home together and whether rivals share the roof. Words only, no number. Null off a shelter or with
 * fewer than two people home ("who lives together" needs at least two).
 */
export function shelterMoodRead(state: GameState): string | null {
  const sid = state.player.shelterId;
  if (sid === null) return null;
  const residents = companionIds(state)
    .map((id) => state.actors[id]!)
    .filter((c) => c.location === sid);
  if (residents.length < 2) return null;
  const avg = Math.trunc(residents.reduce((s, c) => s + c.condition.mind.morale, 0) / residents.length);
  let rivals = false;
  for (const a of residents) for (const b of residents) if (a.id < b.id && (a.relationships[b.id] ?? 0) < 0) rivals = true;
  if (avg < 30) return rivals ? "The base is on edge tonight — old grudges and thin nerves." : "Spirits are low under the roof — your people are wearing down.";
  if (avg >= 72 && !rivals) return "The house is close-knit tonight — the people here have each other's backs.";
  if (rivals) return "There's friction under the roof — not everyone here gets along.";
  return null;
}
