/**
 * Named wounds — treated, not regenerated (M1 task T16 · FR-INJ-01, FR-INJ-04 · GDD VI).
 *
 * Damage in Zurvival is not a shrinking health bar. It is a discrete, *named* wound — a laceration,
 * a sprain, a bite — with a body site, a severity, and a treatment timeline. Two invariants define
 * the system and this module enforces both:
 *
 *   1. **Named + persistent (FR-INJ-01).** A wound is a `Wound` record in
 *      `player.condition.wounds`, carrying the content id of its *type* (never a copy of the def),
 *      the site it landed on, its severity, its accumulated treatment, and the day it was inflicted
 *      (for Living History and, later, infection timing). It persists across turns and saves.
 *   2. **Treated, not auto-regenerated (FR-INJ-04).** Nothing in the passage of time lowers a
 *      wound. Severity is fixed at infliction; only applied *care* (`treatWound`, spending an item
 *      and effort) advances a wound's `treated` value, and a wound leaves the body only when its
 *      care reaches completion. An untreated wound is exactly as bad tomorrow as today.
 *
 * The gameplay handle a wound exerts while open is its *burden* — its untreated remainder
 * (`severity − treated`). `woundBurden` sums it across the body; combat (T15), the needs drift, and
 * the Scene (T19) read that number. Pure, deterministic, dependency-free, integer-only (ADR-0001).
 * No clock, no RNG here — combat decides *which* wound via a named stream and calls `inflictWound`.
 */

import type { CharacterState, ContentId, GameState, Wound } from "../state/types.js";

/** A wound *type* definition — mirrors `content/schemas/wound.schema.json`. Static content. */
export interface WoundDef {
  readonly id: ContentId;
  readonly name: string;
  readonly description: string;
  /** Baseline severity (1–100) a fresh wound of this type carries. */
  readonly severity: number;
  /** The gameplay handle while untreated. */
  readonly effect: "bleed" | "slow" | "weaken" | "infect-risk";
  /** Item content ids whose use advances treatment (empty ⇒ generic first aid only). */
  readonly treatedBy?: readonly ContentId[];
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/** The untreated remainder of one wound (0 when fully cared for). The wound's live weight. */
export function woundRemainder(w: Wound): number {
  return Math.max(0, w.severity - w.treated);
}

/** Total untreated burden across the body — the number combat/needs/UI read (FR-INJ-01 effect). */
export function woundBurden(condition: CharacterState): number {
  return condition.wounds.reduce((sum, w) => sum + woundRemainder(w), 0);
}

/** Whether the body carries any open (not fully treated) wound. */
export function isWounded(condition: CharacterState): boolean {
  return condition.wounds.some((w) => woundRemainder(w) > 0);
}

/** The open wound with the greatest untreated remainder, or null if unhurt. */
export function worstWound(condition: CharacterState): Wound | null {
  let worst: Wound | null = null;
  for (const w of condition.wounds) {
    if (woundRemainder(w) > 0 && (worst === null || woundRemainder(w) > woundRemainder(worst))) {
      worst = w;
    }
  }
  return worst;
}

/**
 * Inflict a fresh wound of `def` at `site`, dated `day`. Appends a new `Wound` (treated: 0) to the
 * condition — wounds accumulate; a second bite is a second wound, not a bigger number. Pure:
 * returns a new `CharacterState`, input untouched.
 */
export function inflictWound(condition: CharacterState, def: WoundDef, site: string, day: number): CharacterState {
  const wound: Wound = {
    type: def.id,
    site,
    severity: clampPct(def.severity),
    treated: 0,
    inflictedDay: day,
  };
  return { ...condition, wounds: [...condition.wounds, wound] };
}

/** Inflict a wound on the player, returning the new GameState (dates it the current in-game day). */
export function woundPlayer(state: GameState, def: WoundDef, site: string): GameState {
  const condition = inflictWound(state.player.condition, def, site, state.meta.day);
  return { ...state, player: { ...state.player, condition } };
}

/**
 * Apply `care` points of treatment to the *worst open wound at `site`* (or, if `site` is omitted,
 * the worst open wound anywhere). Advances that wound's `treated` toward its severity; a wound that
 * reaches full treatment (`treated >= severity`) is **removed** — the only way a wound leaves the
 * body (FR-INJ-04). No open wound at the target ⇒ the condition is returned unchanged. Pure.
 *
 * `care` must be a positive integer (a treatment action's effectiveness); this is the sole path by
 * which the wound list improves, so time/rest/movement can never call it implicitly.
 */
export function treatWound(condition: CharacterState, care: number, site?: string): CharacterState {
  const amount = Math.max(0, Math.trunc(care));
  if (amount === 0) return condition;

  // Pick the target: the worst open wound, optionally constrained to a site.
  let targetIdx = -1;
  let targetRemainder = 0;
  condition.wounds.forEach((w, i) => {
    if (site !== undefined && w.site !== site) return;
    const rem = woundRemainder(w);
    if (rem > 0 && rem > targetRemainder) {
      targetRemainder = rem;
      targetIdx = i;
    }
  });
  if (targetIdx === -1) return condition;

  const target = condition.wounds[targetIdx]!;
  const treated = Math.min(target.severity, target.treated + amount);
  const wounds =
    treated >= target.severity
      ? condition.wounds.filter((_, i) => i !== targetIdx) // fully treated ⇒ closed & removed
      : condition.wounds.map((w, i) => (i === targetIdx ? { ...w, treated } : w));
  return { ...condition, wounds };
}

/**
 * Inflict a wound by *type id + severity* directly, without a full {@link WoundDef}. This is the
 * combat path (T15): the resolver knows which named wound a blow deals and how bad, while the
 * wound's player-facing prose (name/description) lives in `content/wounds/` for the UI to localize.
 * The stored {@link Wound} keeps only the type id + severity, so nothing is lost. Pure.
 */
export function inflictNamedWound(
  condition: CharacterState,
  typeId: ContentId,
  severity: number,
  site: string,
  day: number,
): CharacterState {
  const wound: Wound = { type: typeId, site, severity: clampPct(severity), treated: 0, inflictedDay: day };
  return { ...condition, wounds: [...condition.wounds, wound] };
}
