/**
 * Difficulty modes — the explicit floor a player sets on top of the adaptive Director (M4 task T56 ·
 * GDD XVI · PRD §6.2 · ACCESSIBILITY §6/§13.5).
 *
 * The Director (T30) already gives every run a hand-tuned feel by *biasing probabilities*. Difficulty
 * modes are the other half GDD XVI asks for: an explicit floor — **Story / Survivor / Hardcore /
 * Nightmare**, with **Ironman** layerable on any of them — for players who want to set how short the
 * apocalypse keeps them. Per GDD XVI rule 1, a harder mode tightens **scarcity and survivability**; it
 * does *not* inflate enemy stats. Per rule 2 (and the accessibility baseline), Story is a genuine gentle
 * mode, and difficulty never comes from the interface, the reading load, or the input.
 *
 * A mode resolves to one **scalar dial profile** — five multipliers on rates the sim already owns across
 * three axes (survivability / scarcity / pacing). Nothing here draws RNG, reads a clock, or grows a loot
 * table; the dials only *scale* magnitudes the engine already computes, at seams that already hold state.
 *
 * **Byte-identity is load-bearing and structural.** `survivor` — and an unset difficulty — resolve to the
 * IDENTITY profile (every dial = 1). Every dial is applied through {@link scaleInt}, which **short-circuits
 * to the exact input when the multiplier is 1** — so a Survivor / legacy run executes the identical integer
 * expression it did before difficulty modes existed, with no multiply and no `Math.trunc` in the path. This
 * is the [[byte-identity]] "gate the new behaviour behind the feature's flag" idiom; the flag here is *"the
 * mode is Survivor / unset."* The magnitudes for the other modes are directional FIRST-PASS values — the M5
 * staged balance passes (GDD XIX) calibrate them against the "one more day" target; only the identity column
 * is permanent.
 *
 * Pure, deterministic, dependency-free (ADR-0001). Depends only on the `DifficultyMode` type from state.
 */

import type { DifficultyMode, GameState } from "../state/types.js";

/**
 * A mode's resolved dials: scalar multipliers on existing survivability / scarcity / pacing rates. Each is
 * `1` in the identity profile, so a Survivor run scales nothing.
 */
export interface DifficultyProfile {
  /**
   * Survivability — multiplier on the PLAYER's hunger/thirst/fatigue drift. >1 ⇒ needs bite faster. By
   * design this scales the *player's* survival clock only; companions and residents are sustained by the
   * shelter economy, so their scarcity rides the loot/stash dials ({@link lootContest}/{@link lootYield}),
   * not a personal drift multiplier (an M5 tuning decision could extend it — see the plan's parking lot).
   */
  readonly needDrift: number;
  /** Survivability — multiplier on food/water relief. >1 ⇒ a ration buys back more. */
  readonly needRelief: number;
  /**
   * Scarcity FIND-DENIAL gate — a multiplier (≤1) on a search's yield cap used only to decide whether a
   * THIN search comes up empty (a harder mode denies a find when the node is nearly stripped). The find
   * *amount* draws against the raw cap, so this can only DENY a find, never grant one — Story keeps this at
   * 1 (its loot advantage rides {@link lootContest}, which keeps regions rich). 1 = never deny (Survivor).
   */
  readonly lootYield: number;
  /** Scarcity — multiplier on off-screen rivals' loot draw-down. >1 ⇒ the world eats the stock faster. */
  readonly lootContest: number;
  /**
   * Pacing — multiplier on the Director's *escalate* nudge (a coasting run is escalated harder). The base
   * nudge is `DIRECTOR_STEP` = 1 and the result is `Math.trunc`'d, so a multiplier in the OPEN interval
   * (1, 2) truncates back to 1 (indistinguishable from Survivor) — harder modes therefore use INTEGER
   * multipliers ≥ 2 so the dial actually separates them; <1 floors to 0 (a gentle mode's director never
   * escalates, only relieves). 1 = Survivor's single step (the identity).
   */
  readonly directorAggression: number;
}

/** The neutral profile — every dial its identity. Survivor and an unset difficulty resolve to this. */
export const IDENTITY_PROFILE: DifficultyProfile = {
  needDrift: 1,
  needRelief: 1,
  lootYield: 1,
  lootContest: 1,
  directorAggression: 1,
};

/**
 * Per-mode dial profiles. **FIRST-PASS, directional magnitudes** — the M5 staged balance passes calibrate
 * them (GDD XIX · the T56 note). Survivor is the permanent identity and must never be given a non-1 dial.
 * Harder modes tighten scarcity (lootYield↓, lootContest↑) and survivability (needDrift↑, needRelief↓) and
 * let the director push harder (directorAggression↑); Story softens all three, honoring GDD XVI rule 1
 * (scarcity, not enemy-stat inflation).
 */
const PROFILES: { readonly [mode in DifficultyMode]: DifficultyProfile } = {
  // NB directorAggression uses INTEGER steps (see the field doc): 1.5 would trunc back to Survivor's 1, so
  // Hardcore/Nightmare use 2/3. lootYield only DENIES (≤1), so Story keeps it at 1 (loot ease via contest).
  story: { needDrift: 0.7, needRelief: 1.3, lootYield: 1, lootContest: 0.6, directorAggression: 0.5 },
  survivor: IDENTITY_PROFILE,
  hardcore: { needDrift: 1.25, needRelief: 0.85, lootYield: 0.8, lootContest: 1.4, directorAggression: 2 },
  nightmare: { needDrift: 1.5, needRelief: 0.7, lootYield: 0.6, lootContest: 1.8, directorAggression: 3 },
};

/**
 * Resolve a mode (or an unset difficulty) to its dial profile. Undefined and `survivor` are the identity.
 * **Defensive:** an unrecognized string (a corrupt save, a newer mode from a future build) also degrades to
 * the identity rather than producing `undefined` dials → NaN — a bad mode makes the run play as Survivor,
 * never corrupt it.
 */
export function difficultyProfile(mode: DifficultyMode | undefined): DifficultyProfile {
  // `hasOwnProperty` guard: `PROFILES` is a plain object, so a bare `PROFILES[mode]` would return a truthy
  // INHERITED member for prototype keys ("__proto__", "constructor", "toString", …) and bypass the fallback
  // — yielding an object with undefined dials. Only an OWN, recognized key resolves; anything else (a corrupt
  // or future-build mode) degrades to the identity, so a bad mode plays as Survivor, never NaN-corrupts.
  return (mode !== undefined && Object.prototype.hasOwnProperty.call(PROFILES, mode) && PROFILES[mode]) || IDENTITY_PROFILE;
}

/** The dial profile for a run, read from `meta.difficulty` (absent ⇒ Survivor identity). */
export function profileOf(state: GameState): DifficultyProfile {
  return difficultyProfile(state.meta.difficulty);
}

/** The mode a run is on, normalizing an unset difficulty to the baseline `survivor`. */
export function difficultyOf(state: GameState): DifficultyMode {
  return state.meta.difficulty ?? "survivor";
}

/** Whether this run is Ironman (GDD XVI) — one save, no take-backs (client save-slot policy enforces it). */
export function isIronman(state: GameState): boolean {
  return state.meta.ironman === true;
}

/**
 * Apply a multiplier dial to an integer magnitude, truncating toward zero (ADR-0001 integer discipline).
 *
 * **Short-circuits to the exact input when the multiplier is 1** — the byte-identity guarantee: a Survivor /
 * unset run (whose every dial is 1) returns `n` untouched, with no multiply and no `Math.trunc`, so it is
 * bit-for-bit the pre-difficulty-modes value. For a non-identity dial the result is `trunc(n * mult)`,
 * deterministic across platforms (IEEE-754 double). Callers pass `mult = 1` as the default, so every
 * existing direct caller stays byte-identical.
 */
export function scaleInt(n: number, mult = 1): number {
  return mult === 1 ? n : Math.trunc(n * mult);
}

// --- harness-facing metadata (one source of truth for selection + display) ------------------

/** Display metadata for a mode — words only, no dial numbers (FR-UI-02 / no-number-leak). */
export interface DifficultyModeInfo {
  readonly mode: DifficultyMode;
  readonly label: string;
  /** One-line, words-only gloss of what the mode changes — never a dial magnitude. */
  readonly gloss: string;
}

/** The mode roster in floor order (gentlest first), the single source the client renders selection + status from. */
export const DIFFICULTY_MODES: readonly DifficultyModeInfo[] = [
  { mode: "story", label: "Story", gloss: "Softer scarcity and consequences — here for the world and its people, not the grind." },
  { mode: "survivor", label: "Survivor", gloss: "The intended balance — always a little short; every trip out costs more than it pays." },
  { mode: "hardcore", label: "Hardcore", gloss: "Tighter resources, a harsher decline, and an apocalypse that pushes when you coast." },
  { mode: "nightmare", label: "Nightmare", gloss: "Punishing scarcity and danger. For survivors who have made their peace with losing." },
];

/** Look up a mode's display metadata (total over the four modes). */
export function modeInfo(mode: DifficultyMode): DifficultyModeInfo {
  return DIFFICULTY_MODES.find((m) => m.mode === mode) ?? DIFFICULTY_MODES[1]!;
}

/** Parse a user-supplied mode string (a CLI flag), case-insensitively, or null if unrecognized. */
export function parseDifficulty(raw: string): DifficultyMode | null {
  const s = raw.trim().toLowerCase();
  return DIFFICULTY_MODES.some((m) => m.mode === s) ? (s as DifficultyMode) : null;
}
