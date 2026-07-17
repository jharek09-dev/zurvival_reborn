/**
 * The radio network (M4 task T50 · FR-STY-03 · GDD Part XIII "The radio network" · wireframe SCR-09).
 *
 * The radio is "the game's window onto the wider world and its main deliberate story channel — a real,
 * evolving system, not a cutscene dispenser." Five signal families (emergency / military / civilian /
 * ham / unknown) that **evolve with world state**: the emergency loop dies as the grid runs down or its
 * shelf life elapses, a military evac reads live/failing/dark against its region's threat, civilian/ham
 * operators fall silent when overrun, the number station is faint by day and clear at night. Signals
 * **age** and **decay to dead air** (a station you've found stays listed even after it goes silent — the
 * silence is content, SCR-09). Listening is a cheap tap; **broadcasting reveals you** — a real, loud risk
 * with an unknown audience. Exactly **one anomaly** breaks the rules, once; nothing else ever does.
 *
 * The design call: a signal's status and message are **derived**, never stored. What the player
 * accumulates rides shapes that already exist — `history` (append-only `radio.tuned` / `radio.broadcast`
 * beats), `NodeState.noise` (a broadcast's deposit, via the T14 `params.noise` override), and the open
 * `rng.streams` map (a lazily seeded `radio` stream, drawn ONLY by a broadcast). Two append-only *latches*
 * ride the `radio.tuned` beats and keep the derived model honest against a live world: a signal you have
 * tuned to **stays on your dial** (so an onset signal can't blink with the day/night tide and a fallen
 * station keeps its dead-air row), and a station you have heard **dead stays dead** (a fallen station
 * never un-falls, even if its district later calms). Both are pure functions of the log — **no save-schema
 * rung** (stays v9). Signals are content (`content/radio/*.json`) interpreted generically — no per-signal
 * branching (the T47 idiom) — and ride the transient `RegionGraph` (`graph.signals`), so a graph built
 * without them leaves the system inert (every prior run byte-identical). The seam mirrors
 * `infectionChoices` / `isInfectionAction` / `resolveInfectionAction` and is gated on carrying
 * `item.radio` (a scavenged receiver, findable only when the radio system is active — see loot.ts). Pure,
 * deterministic, dependency-free, integer-only where it stores (ADR-0001).
 */

import type { GameState, HistoryEvent, RegionId } from "../state/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";
import type { RegionGraph } from "../map/types.js";
import { drawInt } from "../rng/streams.js";

// --- content shape (mirrored by content/schemas/radio.schema.json) ----------------------------

/** The five signal families of GDD XIII. */
export type SignalType = "emergency" | "military" | "civilian" | "ham" | "unknown";

/** How far a signal carries on a portable receiver: everywhere, or only in/near its own region. */
export type SignalReach = "citywide" | "local";

/**
 * The message variants a signal plays, keyed by its derived status. Only `live` is required; `failing`
 * (a military station holding but slipping) and `dead` (what remains once it goes silent) are optional
 * and fall back to `live` / a generic dead-air line. The engine never invents prose — it only picks a
 * variant the content authored.
 */
export interface SignalMessages {
  readonly live: string;
  readonly failing?: string;
  readonly dead?: string;
}

/** A static signal definition — mirrors `content/schemas/radio.schema.json`. */
export interface SignalDef {
  readonly id: string;
  readonly signalType: SignalType;
  /** The dial channel ("CH 7"); the anomaly authors none. */
  readonly channel?: number;
  /** The who — "Army staging, gate C", "the old man on nineteen". */
  readonly label: string;
  /** Day the signal began transmitting — the aging reference ("a recorded loop, three days old"). */
  readonly onsetDay: number;
  /** The region whose fate drives a military/civilian/ham signal (its station goes dark when it falls). */
  readonly regionId?: RegionId;
  readonly reach: SignalReach;
  /** An emergency loop's shelf life: it dies this many days past onset even if the grid still holds. */
  readonly lifespanDays?: number;
  /** A signal that only *appears* once `world.globalThreat` reaches this — "a new signal after a global event". */
  readonly onsetThreat?: number;
  /** The reserved "signal that shouldn't exist" — breaks the screen's rules exactly once (SCR-09). */
  readonly anomaly?: boolean;
  readonly messages: SignalMessages;
}

// --- the dials --------------------------------------------------------------------------------

/** The scavenged receiver that unlocks the whole system — found in loot only when the radio system is active. */
export const RADIO_ITEM = "item.radio";
/** The named RNG stream a *broadcast* draws its hidden-audience outcome from (lazily seeded; rides the open map). */
export const RADIO_STREAM = "radio";

/** Time costs (hours). Both > 0 so each is a resolved, world-advancing turn (FR-CORE-03/04). */
export const LISTEN_COST = 1;
export const BROADCAST_COST = 1;

/** A broadcast is loud — between a melee blow (15) and a gunshot (75). It reveals you: the dead re-path to it (T26). */
export const BROADCAST_NOISE = 70;

/**
 * Status thresholds, tuned to the band the sim actually produces. Region threat mostly *decays* from its
 * baseline toward `zombieDensity/2` (the deferred horde→threat coupling is what would drive districts to
 * actively *fall*, PL-M2-05); the reachable spread of region baselines is ~30–80, and the director can
 * nudge the player's current region up ~10. So a military signal reads live/failing/dead across that
 * spread, and the anomaly gate is reachable (a deadly district or a blackout, at night) yet rare.
 */
export const POWER_DEAD_AT = 30; // the emergency loop falls silent once the grid drops below this
export const MILITARY_FAILING_AT = 45; // a military station reads "failing" once its region's threat crosses this…
export const REGION_FALL_AT = 65; // …and goes dark once the region has fallen (reachable: downtown 70 / mercy 80 start fallen)
export const REGION_SILENT_AT = 60; // a civilian/ham operator goes silent once their region is this overrun
export const ANOMALY_THREAT = 60; // the anomaly needs a genuinely deadly district (or a blackout — below) …
export const ANOMALY_BLACKOUT = 25; // …a grid this far gone is the alternate deep-crisis path to the anomaly

/** The derived condition of a signal: its message variant AND its strength pill. */
export type SignalStatus = "live" | "failing" | "faint" | "dead";
/** The strength shown to the player (the SCR-09 LIVE / FAINT / DEAD-AIR pill). */
export type SignalStrength = "live" | "faint" | "dead";

// --- pool on the transient graph (never serialized) -------------------------------------------

/** The registered signal pool for this run, or empty when none is registered (inert). */
export function radioPool(graph: RegionGraph | undefined): readonly SignalDef[] {
  return graph?.signals ?? [];
}

/** Look up a signal def by id in the pool. */
export function signalOf(graph: RegionGraph | undefined, id: string): SignalDef | undefined {
  return radioPool(graph).find((s) => s.id === id);
}

// --- gates ------------------------------------------------------------------------------------

const carries = (state: GameState, type: string): boolean =>
  state.player.inventory.some((e) => e.type === type && e.quantity > 0);

/** Does the player carry a working radio? The whole system is inert until they find one. */
export const hasRadio = (state: GameState): boolean => carries(state, RADIO_ITEM);

/** The region the player is standing in (or "" off a real node). */
function playerRegion(state: GameState): RegionId {
  return state.nodes[state.player.location]?.regionId ?? "";
}

/** Are two regions the same or authored-adjacent (a `local` signal carries one region out, faintly)? */
function regionsNear(graph: RegionGraph | undefined, a: RegionId, b: RegionId): boolean {
  if (a === "" || b === "") return false;
  if (a === b) return true;
  const ra = graph?.regions[a];
  const rb = graph?.regions[b];
  return (ra?.adjacent?.includes(b) ?? false) || (rb?.adjacent?.includes(a) ?? false);
}

// --- append-only latches over the radio.tuned log (pure; no stored state) ----------------------

/** A signal named in a *prior* turn's `radio.tuned` beat — it has been discovered and stays on the dial. */
function everHeard(state: GameState, id: string): boolean {
  for (const h of state.history) {
    if (h.type !== "radio.tuned" || h.turn >= state.meta.turn) continue; // exclude this turn's own beat
    const signals = (h.data as { readonly signals?: readonly string[] } | null)?.signals;
    if (Array.isArray(signals) && signals.includes(id)) return true;
  }
  return false;
}

/** A signal a *prior* turn's listen recorded as dead — a fallen station stays dead (never un-falls). */
function everHeardDead(state: GameState, id: string): boolean {
  for (const h of state.history) {
    if (h.type !== "radio.tuned" || h.turn >= state.meta.turn) continue;
    const dead = (h.data as { readonly dead?: readonly string[] } | null)?.dead;
    if (Array.isArray(dead) && dead.includes(id)) return true;
  }
  return false;
}

// --- status / reach derivation (pure — the heart of "signals evolve with world state") --------

/** The region-threat a region/civilian/military signal reads from (0 when its region is unknown). */
function regionThreat(state: GameState, def: SignalDef): number {
  return def.regionId !== undefined ? state.regions[def.regionId]?.threat ?? 0 : 0;
}

/**
 * A signal's status **derived purely from the live world** — its message variant AND (with reach) its
 * strength. This is where the network evolves with world state: emergency dies with the grid / its shelf
 * life, military fails then falls with its region's threat, civilian/ham go silent when overrun, the
 * number station is faint by day and clear at night. See {@link effectiveStatus} for the dead-latch that
 * keeps a fallen station fallen.
 */
export function signalStatus(state: GameState, def: SignalDef): SignalStatus {
  switch (def.signalType) {
    case "emergency": {
      const dead =
        state.world.powerGrid < POWER_DEAD_AT ||
        (def.lifespanDays !== undefined && state.meta.day - def.onsetDay > def.lifespanDays);
      return dead ? "dead" : "live";
    }
    case "military": {
      const threat = regionThreat(state, def);
      if (threat >= REGION_FALL_AT) return "dead";
      if (threat >= MILITARY_FAILING_AT) return "failing";
      return "live";
    }
    case "civilian":
    case "ham": {
      return regionThreat(state, def) >= REGION_SILENT_AT ? "dead" : "live";
    }
    case "unknown": {
      if (def.anomaly === true) return "live"; // audibility gates the anomaly; when heard, it is "live"
      return state.meta.phase === "night" ? "live" : "faint"; // number station: clear at night, faint by day
    }
    default:
      return "live";
  }
}

/**
 * The status the player actually reads: {@link signalStatus}, but a station once heard dead **stays
 * dead** (the dead-latch) — a fallen station never comes back on the air, even if its district later
 * calms. The anomaly is exempt (it is never a "dead" row).
 */
export function effectiveStatus(state: GameState, def: SignalDef): SignalStatus {
  if (def.anomaly !== true && everHeardDead(state, def.id)) return "dead";
  return signalStatus(state, def);
}

/** The rare, reachable gate on the reserved anomaly: a deadly district (or a blackout), at night. */
function anomalyAudible(state: GameState): boolean {
  if (state.meta.phase !== "night") return false;
  const region = state.regions[playerRegion(state)]?.threat ?? 0;
  return Math.max(state.world.globalThreat, region) >= ANOMALY_THREAT || state.world.powerGrid <= ANOMALY_BLACKOUT;
}

/**
 * Can the player pick this signal up right now? A dead signal in reach still lists (its silence is
 * content, SCR-09) — this filters by *reach* and *onset*, not by whether it's alive. A signal already
 * discovered ({@link everHeard}) stays on the dial regardless of an oscillating onset threshold, so a
 * "new signal after a global event" can't blink with the day/night tide. The anomaly is the exception:
 * it is absent unless its rare gate holds — deep threat/blackout, at night — and only ONCE per run.
 */
export function signalAudible(state: GameState, graph: RegionGraph | undefined, def: SignalDef): boolean {
  if (def.anomaly === true) return anomalyAudible(state) && !everHeard(state, def.id);
  if (state.meta.day < def.onsetDay) return false; // hasn't begun transmitting yet
  const reachOK = def.reach === "citywide" || (def.regionId !== undefined && regionsNear(graph, playerRegion(state), def.regionId));
  if (!reachOK) return false;
  // onset gates the FIRST appearance; once discovered, the signal stays listed (a one-way appearance).
  return def.onsetThreat === undefined || state.world.globalThreat >= def.onsetThreat || everHeard(state, def.id);
}

/** A signal read: the def, its (latched) status, and the strength pill. */
export interface SignalRead {
  readonly def: SignalDef;
  readonly status: SignalStatus;
  readonly strength: SignalStrength;
}

/** The display strength: dead stays dead; a number-station-by-day or an out-of-region local reads faint; else live. */
function strengthOf(state: GameState, def: SignalDef, status: SignalStatus): SignalStrength {
  if (status === "dead") return "dead";
  if (status === "faint") return "faint";
  if (def.reach === "local" && def.regionId !== undefined && playerRegion(state) !== def.regionId) return "faint";
  return "live";
}

/** The full read for one signal (pure) — status is the dead-latched {@link effectiveStatus}. */
export function readSignal(state: GameState, def: SignalDef): SignalRead {
  const status = effectiveStatus(state, def);
  return { def, status, strength: strengthOf(state, def, status) };
}

/**
 * Every signal the player can currently pick up, each with its derived read, ordered stably (by channel,
 * then id — the anomaly, channel-less, sorts last). Pure; empty when no radio pool is registered.
 */
export function audibleSignals(state: GameState, graph: RegionGraph | undefined): readonly SignalRead[] {
  return radioPool(graph)
    .filter((def) => signalAudible(state, graph, def))
    .map((def) => readSignal(state, def))
    .sort((a, b) => {
      const ca = a.def.channel ?? Number.MAX_SAFE_INTEGER;
      const cb = b.def.channel ?? Number.MAX_SAFE_INTEGER;
      return ca !== cb ? ca - cb : a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0;
    });
}

// --- the seam: choices / dispatch / resolution ------------------------------------------------

/** The radio actions offered from the current state, in stable order. Empty unless carrying a receiver. */
export function radioChoices(state: GameState): readonly SceneChoice[] {
  if (!hasRadio(state)) return [];
  return [
    {
      id: "listen-radio",
      label: "Tune the radio and listen",
      timeCost: LISTEN_COST,
      action: { type: "listen-radio", choiceId: "listen-radio", timeCost: LISTEN_COST },
    },
    {
      // The one known cost is stated up front (it's loud); the audience is the honest unknown (SCR-09).
      id: "broadcast",
      label: "Broadcast — reveal yourself (loud; who hears is unknown)",
      timeCost: BROADCAST_COST,
      // Loud, like a firearm: stage 6 deposits this at the player's node and the dead re-path to it (T26).
      action: { type: "broadcast", choiceId: "broadcast", timeCost: BROADCAST_COST, params: { noise: BROADCAST_NOISE } },
    },
  ];
}

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export function isRadioAction(action: Action): boolean {
  return action.type === "listen-radio" || action.type === "broadcast";
}

/** Stamp + append a Living-History beat (append-only; never rewritten). Pure. */
function appendBeat(state: GameState, type: string, subjects: readonly string[], data: HistoryEvent["data"]): GameState {
  const { day, hour, turn } = state.meta;
  const beat: HistoryEvent = { day, hour, turn, type, subjects: [...subjects], data };
  return { ...state, history: [...state.history, beat] };
}

/**
 * Listen: log a `radio.tuned` beat naming the signals on air this turn AND which of them are dead — the
 * append-only record that (a) drives the digest the player sees this turn (rendered by `radioLine` from
 * THIS beat, so a within-turn world drift can't change what you heard), (b) keeps discovered signals on
 * the dial and fallen ones dead (the two latches), and (c) makes the anomaly a once-per-run event. A
 * resolved change (history + the turn's needs drift) — never a no-op. Pure.
 */
function listen(state: GameState, graph: RegionGraph | undefined): GameState {
  const reads = audibleSignals(state, graph);
  const signals = reads.map((r) => r.def.id);
  const dead = reads.filter((r) => r.status === "dead").map((r) => r.def.id);
  return appendBeat(state, "radio.tuned", ["player"], { signals, dead });
}

/** The hidden-audience outcomes of a broadcast (SCR-09 "WHO HEARS?") — seeded, a hint, never a spawn. */
export const BROADCAST_OUTCOMES: readonly string[] = [
  "No voice answers. Whether that means no one is left to hear, or someone heard and chose silence, you cannot know.",
  "For a moment a voice crackles back — faint, far, a few broken words — then the static swallows it whole.",
  "No one answers in words. But close by, you hear the dead turn, and start to come.",
];

/**
 * Broadcast: put your voice out on an unknown audience. The loud deposit is handled by stage 6 from the
 * action's `params.noise`; here we draw the seeded outcome (advancing ONLY the `radio` stream, so no
 * prior run touches it) and log a `radio.broadcast` beat carrying it, so `radioLine` can surface an
 * honest read of what — if anything — answered. Pure.
 */
function broadcast(state: GameState): GameState {
  const draw = drawInt(state.rng, state.meta.seed, RADIO_STREAM, 0, BROADCAST_OUTCOMES.length - 1);
  const withRng: GameState = { ...state, rng: draw.rng };
  return appendBeat(withRng, "radio.broadcast", ["player"], { outcome: draw.value });
}

/** Resolve a radio action (stage 3, dispatched from `applyPlayerAction`). Unrelated types pass through. */
export function resolveRadioAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  switch (action.type) {
    case "listen-radio":
      return listen(state, graph);
    case "broadcast":
      return broadcast(state);
    default:
      return state;
  }
}

// --- narration surfaced in sceneOf ------------------------------------------------------------

/** A capitalised family tag for the digest ("MILITARY", "HAM OPERATOR"). */
function familyTag(type: SignalType): string {
  switch (type) {
    case "emergency": return "EMERGENCY";
    case "military": return "MILITARY";
    case "civilian": return "CIVILIAN";
    case "ham": return "HAM OPERATOR";
    case "unknown": return "UNKNOWN";
  }
}

/** The message the content authored for a status (with the live fallback). Null only if none exists. */
function messageFor(def: SignalDef, status: SignalStatus): string | null {
  if (status === "dead") return def.messages.dead ?? null;
  if (status === "failing") return def.messages.failing ?? def.messages.live;
  return def.messages.live; // live and faint both read the live text (rendered faint)
}

/** A plain-words age clause from the signal's onset ("a day old", "3 days old"). Never a bar. */
function ageClause(state: GameState, def: SignalDef): string {
  const days = state.meta.day - def.onsetDay;
  if (days <= 0) return "newly on the air";
  if (days === 1) return "a day old";
  return `${days} days old`;
}

/** The channel/strength prefix ("CH 7 · LIVE", "DEAD AIR"). The family tag is separate; the label is the who. */
function readPrefix(read: SignalRead): string {
  const ch = read.def.channel !== undefined ? `CH ${read.def.channel}` : "—";
  const pill = read.strength === "dead" ? "DEAD AIR" : read.strength === "faint" ? "FAINT" : "LIVE";
  return `${ch} · ${pill}`;
}

/**
 * One screen-reader-safe line for a signal read (all words; no dial internals, no hidden numbers). The
 * anomaly is rendered bare — no channel, no pill, no age, the narration unquoted — the one line that
 * departs from the row format (SCR-09 "breaks the rules exactly once").
 */
export function renderSignalRead(state: GameState, read: SignalRead): string {
  const { def } = read;
  if (def.anomaly === true) {
    return `[· · ·] ${messageFor(def, "live") ?? "something you cannot place"}`;
  }
  const head = `[${familyTag(def.signalType)} · ${readPrefix(read)}] ${def.label}`;
  if (read.strength === "dead") {
    const gone = messageFor(def, "dead");
    return gone !== null ? `${head} — dead air: ${gone}` : `${head} — dead air; it has gone silent.`;
  }
  const msg = messageFor(def, read.status);
  const body = msg !== null ? `"${msg}"` : "static";
  const faint = read.strength === "faint" ? ", faint and drifting" : "";
  return `${head} — ${body} (${ageClause(state, def)})`;
}

/**
 * The radio's contribution to the Scene, or null. It surfaces ONLY on a radio turn — a `radio.*` beat
 * exists for this turn (the same this-turn tail-scan `infectionOutcomeLine` uses) — so the radio never
 * clutters an ordinary scene. On a **listen** it renders the digest of exactly what the beat recorded on
 * air (so a within-turn world drift can't retroactively change what you heard, and a dead-latched station
 * shows dead air); on a **broadcast**, the "you put your voice out — it carries far, too far" read (the
 * loudness stated regardless of outcome) plus the seeded outcome. Pure — a render that reads state + the
 * append-only log and advances no rng.
 */
export function radioLine(state: GameState, graph: RegionGraph | undefined): string | null {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i]!;
    if (h.turn !== state.meta.turn) break; // turn-ordered append-only log ⇒ past this turn's tail, stop
    if (h.type === "radio.broadcast") {
      const idx = (h.data as { readonly outcome?: number } | null)?.outcome;
      const outcome = typeof idx === "number" ? BROADCAST_OUTCOMES[idx] ?? "" : "";
      return `You put your voice out into the static and the dark, and say your piece — it carries far, too far. ${outcome}`.trim();
    }
    if (h.type === "radio.tuned") {
      const data = h.data as { readonly signals?: readonly string[]; readonly dead?: readonly string[] } | null;
      const ids = Array.isArray(data?.signals) ? data!.signals! : [];
      const deadIds = new Set(Array.isArray(data?.dead) ? data!.dead! : []);
      // Render exactly the set recorded at tune time (pinning the dead ones to what you heard), so a
      // stage-13 world drift after the beat can't change the digest or the anomaly you just caught.
      const reads: SignalRead[] = [];
      for (const id of ids) {
        const def = signalOf(graph, id);
        if (def === undefined) continue;
        const status = deadIds.has(id) ? "dead" : signalStatus(state, def);
        reads.push({ def, status, strength: strengthOf(state, def, status) });
      }
      if (reads.length === 0) return "You work the dial end to end. Static, and dead air — nothing you can reach is transmitting.";
      return `You tune the radio and listen. ${reads.map((r) => renderSignalRead(state, r)).join(" ")}`;
    }
  }
  return null;
}
