/**
 * Trust & disposition model (M3 task T34 · FR-NPC-02, Vertical-Slice subset · GDD XII).
 *
 * Each encounterable survivor (T33) carries a single **trust** scalar (0–100) toward the player. It is
 * the gate every later people-system reads — whether a survivor will talk (T35) and whether they will
 * join as a companion (T36). Two properties define it:
 *
 *   - **It moves only from the player's actions.** Helping, sharing, and fair trade raise trust;
 *     threatening, robbing, and abandoning lower it. Nothing else touches it.
 *   - **It never regenerates on its own.** Unlike needs (which drift every hour), trust has no pull
 *     back toward a baseline — a lowered value stays lowered until another interaction moves it. This is
 *     the mechanical meaning of "a betrayal sticks" (the T34 note). The deltas are deliberately
 *     **asymmetric** so harm outweighs help: a betrayal costs more than a good turn earns.
 *
 * `disposition` (the fixed half of the attitude model, seeded from content in T33) sets a survivor's
 * *starting* trust — a friendly survivor opens more trusting than a hostile one — which is what ties
 * T33's temperament to T34's moving scalar.
 *
 * T34 ships the model, the numbers, and the gates only; the *choices* that call {@link applyTrustEvent}
 * are T35's dialogue, and the recruit that reads {@link canRecruit} is T36 — proven here by unit tests,
 * exactly as M2 proved each system at the engine layer before surfacing it. Pure, integer-only,
 * dependency-free (ADR-0001): no clock, no RNG.
 */

import type { NPCDisposition, NPCState } from "../state/types.js";

/** The player-action kinds that move trust (T35 wires these to real Scene choices). */
export type TrustEventKind = "help" | "share" | "trade" | "threaten" | "rob" | "abandon";

/**
 * Signed trust step per action kind. Asymmetric by design — harm outweighs help — so a betrayal is
 * expensive to undo. Integer points on the 0–100 scale.
 */
export const TRUST_DELTAS: { readonly [k in TrustEventKind]: number } = {
  help: 15,
  share: 10,
  trade: 5,
  threaten: -20,
  rob: -30,
  abandon: -25,
};

/** Starting trust per disposition — the seed T33 spawn reads. Ordered hostile → friendly, with the
 * volatile `desperate` survivor placed mid-scale (needs help, but wary of strangers). */
export const DISPOSITION_TRUST: { readonly [d in NPCDisposition]: number } = {
  hostile: 10,
  wary: 25,
  desperate: 35,
  neutral: 40,
  friendly: 60,
};

/** Trust below which a survivor won't even parley (T35 talk gate). */
export const PARLEY_MIN = 20;
/** Trust at or above which a survivor may be recruited as a companion (T36 gate). */
export const RECRUIT_MIN = 70;

/** A legible trust band for prose and gating (T35/T41 surfacing will read these). */
export type TrustTier = "hostile" | "wary" | "neutral" | "warm" | "trusted";

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** The starting trust a freshly-spawned survivor of this disposition holds toward the player. */
export function startingTrust(disposition: NPCDisposition): number {
  return DISPOSITION_TRUST[disposition];
}

/**
 * Shift an NPC's trust by `delta`, clamped to 0–100. Returns a new NPCState (input untouched). The
 * clamp is the only bound — there is no regen and no floor above 0 / ceiling below 100, so repeated
 * harm bottoms out at 0 and stays there until the player earns it back.
 */
export function adjustTrust(npc: NPCState, delta: number): NPCState {
  const trust = clampPct(npc.trust + Math.trunc(delta));
  return trust === npc.trust ? npc : { ...npc, trust };
}

/** Apply a player-action trust event by its mapped delta (the seam T35's choices call). */
export function applyTrustEvent(npc: NPCState, kind: TrustEventKind): NPCState {
  return adjustTrust(npc, TRUST_DELTAS[kind]);
}

/** The trust band a scalar falls in: hostile <20 · wary <40 · neutral <60 · warm <80 · trusted ≥80. */
export function trustTier(trust: number): TrustTier {
  const t = clampPct(trust);
  if (t < 20) return "hostile";
  if (t < 40) return "wary";
  if (t < 60) return "neutral";
  if (t < 80) return "warm";
  return "trusted";
}

/** Whether a living survivor trusts the player enough to parley (T35 dialogue gate). */
export function canParley(npc: NPCState): boolean {
  return npc.alive && npc.trust >= PARLEY_MIN;
}

/** Whether a living survivor trusts the player enough to be recruited as a companion (T36 gate). */
export function canRecruit(npc: NPCState): boolean {
  return npc.alive && npc.trust >= RECRUIT_MIN;
}
