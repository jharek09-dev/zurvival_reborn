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
   * Scarcity HAUL multiplier (≤1) — scales a search's points→items conversion, so a harder mode's
   * rummage through the same district comes away with fewer items. It can only reduce a haul, never
   * grant one, so Story keeps it at 1 and takes its loot advantage through {@link lootContest} (which
   * keeps districts rich). 1 = the full haul (Survivor / unset, and byte-identical).
   *
   * T60 moved this off the yield CAP, where T56 first sited it and where it measured **0.1 turns** at
   * Nightmare's 0.6 — see the note at its use site in `sim/loot.ts` for why the cap could not work.
   */
  readonly lootYield: number;
  /**
   * Scarcity — multiplier on off-screen rivals' loot draw-down. >1 ⇒ the world eats the stock faster.
   *
   * **The weakest dial in the set, structurally, and T60 measured why rather than cranking it.** Over a
   * 3.3× magnitude range (1.8 / 3 / 6) it moves the haul — 8.5 / 7.7 / 6.3 items a run — and moves
   * survival by nothing: 51.1 / 51.1 / 50.9 turns against a 51.5 control. It is competing for `loot`,
   * and after T59 a run is bounded by the district's drinkable WATER, which this never touches. T60
   * built and measured the obvious fix (rivals drink too, on the same banked clock) and **reverted it**:
   * it bought about half a turn, inside the noise of what the dial already had, for a new drain on the
   * binding resource. That last figure measures code that is not in the tree and nothing can check it —
   * it is recorded as a decision, not offered as a reading. Left at its first-pass magnitude, doing the
   * job it can actually do (thinning what you find), and declared. See PL-M5-81.
   *
   * (Both sweeps above are rebuild sweeps: the dial is edited and the tree re-run. `measure/t60.ts`
   * cannot print them; `docs/qa/QA_REVIEW_T60.md` records how they were taken.)
   */
  readonly lootContest: number;
  /**
   * Pacing — multiplier on the Director's *escalate* nudge (a coasting run is escalated harder). The base
   * nudge is `DIRECTOR_STEP` = 1 and the result is `Math.trunc`'d, so a multiplier in the OPEN interval
   * (1, 2) truncates back to 1 (indistinguishable from Survivor) — harder modes therefore use INTEGER
   * multipliers ≥ 2 so the dial actually separates them; <1 floors to 0 (a gentle mode's director never
   * escalates, only relieves). 1 = Survivor's single step (the identity).
   */
  readonly directorAggression: number;
  /**
   * **Consequence** — multiplier on the hourly progression an untreated bite adds
   * (`sim/infection.ts`'s `BITE_INFECT_RATE`, base 2). The first consequence dial in the set, and the
   * reason PL-M4-57 named one: before T60 all five dials were scarcity, needs or pacing, so "harsher
   * consequences" was a thing the mode descriptions promised and no dial delivered.
   *
   * It is the strongest lever T60 measured anywhere in the engine. Isolated (this dial alone off
   * identity, 120 runs, control 51.5 turns): at **0.5** a run lasts **54.1 turns** and 2 of 120 end in
   * infection; at **1** it is the 51.5-turn control with 21 of 120; at **2** it is **44.3 turns** and
   * **54 of 120** — infection becomes the commonest death in the game. A rebuild sweep (the dial is
   * edited and the tree re-run), so `measure/t60.ts` cannot print it; `--modes` shows the end-to-end
   * consequence. It is also
   * where integer truncation stops being a hazard and becomes the point: against a base of 2 the four
   * multipliers land on the whole numbers 1 / 2 / 3 / 4, one clean step a mode, with no rounding rule
   * to argue about.
   *
   * GDD XVI rule 1 is honoured: this scales what an untreated wound COSTS, never an enemy's stats.
   */
  readonly infectionRisk: number;
  /**
   * **Consequence** — multiplier on {@link LAST_STAND_AT}, the untreated-wound burden at which being
   * held stops being a fight and becomes a death. Lower is harsher, so this dial runs the opposite way
   * to the others: Story is forgiving at >1, Nightmare unforgiving at <1.
   *
   * Closes the headline half of PL-M5-45, open for four consecutive tasks: the threshold was a flat 80
   * on Story and Ironman alike. Measured in isolation (rebuild sweep, 120 runs, control 51.5 turns),
   * 0.7 gives **49.2 turns** with the Last Stand as the commonest death (52 of 120 against the
   * control's 49) — real, and gentler than the infection dial, so the magnitudes here are deliberately
   * modest.
   *
   * Its resolution is coarse and deliberately declared: the untreated-wound burden at a grab has a 32%
   * atom at exactly 40 (one `wound.bite`), so the threshold moves in discrete steps of about ten points
   * of dial. Two consequences a retune must know. 0.7 and 0.55 straddle only one sample in nineteen and
   * measured bit-identical over 60 runs. And **0.5 puts the threshold ON 40**, where the test is `>=`,
   * so any grab while carrying a single untreated bite becomes instantly fatal — a cliff, not a step.
   */
  readonly woundTolerance: number;
}

/** The neutral profile — every dial its identity. Survivor and an unset difficulty resolve to this. */
export const IDENTITY_PROFILE: DifficultyProfile = {
  needDrift: 1,
  needRelief: 1,
  lootYield: 1,
  lootContest: 1,
  directorAggression: 1,
  infectionRisk: 1,
  woundTolerance: 1,
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
  story: { needDrift: 0.7, needRelief: 1.5, lootYield: 1, lootContest: 0.6, directorAggression: 0.5, infectionRisk: 0.5, woundTolerance: 1.25 },
  survivor: IDENTITY_PROFILE,
  hardcore: { needDrift: 1.2, needRelief: 0.85, lootYield: 0.8, lootContest: 1.4, directorAggression: 2, infectionRisk: 1.5, woundTolerance: 0.85 },
  nightmare: { needDrift: 1.35, needRelief: 0.7, lootYield: 0.6, lootContest: 1.8, directorAggression: 3, infectionRisk: 2, woundTolerance: 0.7 },
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
