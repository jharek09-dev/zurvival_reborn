# QA Review — M4 Part 12 (T56 pt 1/2 · Difficulty modes)

**Scope:** GDD XVI difficulty modes — **Story / Survivor / Hardcore / Nightmare**, with **Ironman**
layerable on any — as an explicit floor on top of the adaptive Director (T30). The *mechanism*: a
five-scalar dial profile per mode across survivability / scarcity / pacing, calibrated later in the M5
staged balance passes (the T56 note). T56 is one task with two halves; this ships **difficulty modes**;
the **NFR-ACC accessibility baseline** follows as Part 13, at which point T56 flips to done.

**Verdict:** ✅ Ship. Zero BLOCKERs. Two-subagent adversarial audit (engineering + design) with a verify
pass on each; all actionable findings fixed and re-verified. **Survivor — and an unset difficulty — is
provably byte-identical to the pre-edit baseline** (cross-tree `saveGame` proof, identical md5), so every
prior golden holds and no save rung is needed (stays v10).

## Architecture verified

One new `prototype/engine/src/sim/difficulty.ts` owns the feature: the `DifficultyMode` roster, the
`DifficultyProfile` (5 scalar dials), `difficultyProfile(mode)` (the resolver — Survivor/unset → the
IDENTITY profile), `profileOf(state)`/`isIronman(state)`, and `scaleInt(n, mult)`. The dials thread
read-only into five existing rate-seams that already hold `state`: `updateCondition`/`eat`/`drink`
(survivability), `resolveSearchLoot`/`updateRegionContest` (scarcity), `tickDirector` (pacing). Selection
rides `createInitialState`'s options (`difficulty?`/`ironman?`, flowing through `startRun`); surfacing is
the harness Codex "This run" readout + the `playCli` boot banner, words-only.

**Byte-identity is structural, not incidental.** Every dial is applied through `scaleInt`, which
**short-circuits to the exact input when the multiplier is 1** — so a Survivor/unset run executes the
identical integer expression it did before T56, with no multiply and no `Math.trunc` in the path. This is
the [[zurvival-byte-identity-loot-hazard]] "gate the new behaviour behind the feature's flag" idiom, the
flag being *"the mode is Survivor / unset."* `meta.difficulty?`/`meta.ironman?` are optional and written
only for a non-baseline choice (Survivor normalizes to *absent*); `JSON.stringify` omits an unset field, so
a baseline save is byte-identical and `loadGame` tolerates the extra fields for non-baseline saves. The
dials never grow/shrink a loot table (the `floor(f·len)` pick hazard never arises) and add no RNG draw on
the baseline path.

## CI (clean cloud sandbox)

- engine typecheck + test — **580 pass** (+19: `difficulty.test.ts`; includes the in-suite identity proof,
  the prototype-key defensive test, and the director-escalation regression)
- content-loader typecheck + test — **9 pass**; schema gate `validate` — **160 entries / 13 types**
  (unchanged — no content moved); malformed-content rejected ✓
- harness typecheck + test — **175 pass** (+5: `difficulty.test.ts`, the Codex surfacing + Ironman honesty)
- harness `npm start` empty-turn smoke — determinism ✓, save round-trip ✓, exit 0

## Byte-identity proof (the gold standard, cross-tree)

The engine IS edited this part (unlike T54/T55), so the proof is the gated-dark one: extract the pristine
pre-edit tree from `zb.tgz`, run an identical RNG-heavy scripted run (8+ seeds, hammering searches across
every loot kind, forced combat, odd-hour `advanceWorld` jumps) on BOTH trees with difficulty **unset**, and
compare `saveGame` raw. Result: **byte-identical, md5 `5a67911b67f0a10e44e03b93b99960d7`** (edited-unset ==
edited-explicit-`survivor` == pristine baseline). The engineering auditor's independent 1183-save
full-trajectory hunt (28 seeds) reproduced it: `251576868e7f87654ae72cc258de51d9`, both trees, `diff` empty.
Non-vacuous: the same script under `nightmare`/`hardcore`/`story` diverges (thousands of differing fields),
so the identity holds precisely because the dials short-circuit, not because the run never reaches them.

## Two-subagent adversarial audit + verify

**Engineering lens** (byte-identity / determinism / no-crash / no-rung):
- **[MINOR → FIXED] Prototype-key hole in `difficultyProfile`.** A bare `PROFILES[mode]` returned a truthy
  *inherited* member for `"__proto__"`/`"constructor"`/`"toString"`/… (loadable via a hand-edited save),
  bypassing the identity fallback and yielding undefined dials — a latent NaN footgun and a false documented
  guarantee (masked today only by the `=1` default params). Fixed with a `hasOwnProperty` guard; a regression
  test asserts every such key → IDENTITY with all-numeric dials. **Verified.**
- **[MINOR → RATIFIED] `needDrift` scales the player but not companions/NPCs.** Ratified as a deliberate
  design stance — the dial is the *player's* survival clock; companions/residents are sustained by the
  shelter economy, so their scarcity rides the loot/stash dials — documented in the field doc + parking lot.
  No determinism impact (`companions.ts`/`npcs.ts` byte-identical to baseline). **Verified coherent.**
- Confirmed: `scaleInt(n,1)===n` bit-exact; no un-dialed second call site; `resolveSearchLoot` cannot throw
  (`yieldCap<=0` blocks `rawCap<1` from reaching `drawInt(1,rawCap)` for any `lootYield>0`); v10 unchanged;
  every mode + Ironman round-trips `saveGame(loadGame(x))===x`; a corrupt `"difficulty":"weird"` save loads,
  degrades to identity, and runs turns with no NaN.

**Design lens** (reachable AND surfaced AND correctly-directed AND honest):
- **[MAJOR → FIXED] Hardcore's director was a dead knob (== Survivor).** `scaleInt(1, 1.5)=trunc(1.5)=1`, so
  any escalate multiplier in the open interval `(1,2)` truncated back to Survivor's step — the "pushier
  director" pillar was absent for Hardcore. Fixed by moving the dial to **integer** steps (Hardcore 2,
  Nightmare 3); a regression test drives a coasting region and asserts Story 0 < Survivor < Hardcore <
  Nightmare. **Verified** (real-play: Hardcore threat strictly > Survivor at every checkpoint).
- **[MAJOR → FIXED] Ironman text over-claimed.** The readout asserted "Death is final." — a permadeath
  guarantee the demo doesn't enforce (a save round-trips = a take-back). Reworded (Codex + banner) to state
  the *rule* and name the enforcer: "one save, no take-backs — death is meant to be final. (The full
  client's save slots enforce it.)" **Verified honest.**
- **[MINOR → FIXED] Story's `lootYield` was dead / dishonest.** Because the player gets one item per success
  and the draw uses the raw cap, a `>1` yield can only *deny* a thin find, never grant a richer one — so
  Story's 1.4 was a no-op with a ">1 ⇒ richer" claim that couldn't fire. Set Story to 1 (neutral) and
  re-documented the dial as a hard-mode **find-denial gate**; Story's loot ease rides `lootContest`.
  **Verified** (Story still ends loot-richer than Survivor via contest 0.6).
- Confirmed **rule 1 (no enemy-stat inflation)**: difficulty references appear only in
  `survival.ts`/`loot.ts`/`director.ts`; zero in combat/zombies/infection/wounds/encounters. All modes are
  reachable (`--difficulty`/`--ironman`, unknown → Survivor) and surfaced (Codex + banner, no number leak).

## Parking lot (deferred — see the plan for full text)

- **Dial calibration** — the non-identity magnitudes are first-pass; M5 staged balance passes tune them.
- **Dial resolution floor (systemic)** — `lootContest`/`lootYield` act on base magnitudes often equal to 1,
  where `trunc(1×m)` erases `(1,2)` multipliers (Hardcore/Nightmare contest == Survivor at Rivermouth's low
  activity); M5 must fix structurally (raise base granularity / carry a fractional remainder), not by
  re-picking magnitudes. The director dial is already out of this trap (integer steps).
- **Ironman client enforcement** — single-slot / no-reload / delete-on-death is a client save-slot policy.
- **Mid-run difficulty change** (ACCESSIBILITY §6 `[A]`) — pairs with the Part-13 accessibility settings.
- **Consequence sub-dials** (infection/wound/combat severity) and **`needDrift` → party/residents** — M5.
