# M4 Part 12 — Difficulty modes (T56, part 1 of 2 · "set the floor")

The Apocalypse Director (T30) already gives every run a hand-tuned feel by *biasing probabilities*
toward better drama — easing off after a brutal fight, tightening when the player coasts (GDD XVI, "the
adaptive layer"). What it deliberately does **not** do is let a player set the floor. GDD XVI names the
answer: **explicit difficulty modes that sit on top of the adaptive layer** — Story / Survivor /
Hardcore / Nightmare, with **Ironman** layerable on any of them. This part builds that mode system: the
*mechanism* by which a chosen mode moves the survivability / scarcity / pacing dials, wired so the actual
magnitudes stay easy to tune in the M5 staged balance passes (GDD XIX), and — the load-bearing
constraint — so **Survivor is the baseline the whole game has been built and proven against, bit for
bit.**

T56 is one task with two full-size halves; per the split agreed at kickoff this part ships **difficulty
modes** (engine), and the **NFR-ACC accessibility baseline** follows as Part 13. T56 flips to `done` when
Part 13 lands.

## What GDD XVI asks for

> **Difficulty modes** — Explicit modes sit on top of the adaptive layer for players who want to set the
> floor:
> - **Story** — softer scarcity and consequences; for players here to experience the world.
> - **Survivor** — the intended baseline.
> - **Hardcore** — tighter resources, harsher consequences, a smarter director.
> - **Nightmare** — punishing scarcity and danger; for veterans.
> - **Ironman** — one save, no take-backs; death is final. Can layer on any mode.

And the design rules that constrain *how* the modes differ (GDD XVI · ACCESSIBILITY §13.5):

1. **Scarcity is the primary difficulty driver, not enemy stat inflation.** A harder mode makes the
   player *a little shorter* — resources tighten and needs bite — it does not bolt +40% HP onto a walker.
2. **Difficulty comes from meaningful scarcity and decisions, never from the interface, the reading
   load, or the input** (this is also a Cognitive accessibility item, ACCESSIBILITY §6 "Difficulty
   options, including a gentle mode"). Story mode is the gentle mode the accessibility baseline promises.
3. The modes are a *floor the player sets*; the director's adaptive bias still runs on top of whatever
   floor is chosen.

There is no separate FR for difficulty — it is a GDD XVI design feature the PRD scope pulls into the MVP
("Difficulty modes and accessibility baseline in", PRD §6.2). So the acceptance bar is GDD XVI fidelity +
the project's determinism discipline, not a numbered requirement.

## The architecture: a resolved dial profile, threaded read-only, Survivor = identity

A mode is not a pile of `if (nightmare)` branches sprinkled through the sim. It is one **scalar dial
profile** resolved from the chosen mode and read at a handful of existing seams:

- `sim/difficulty.ts` (new) owns the whole feature: the `DifficultyMode` roster, the `DifficultyProfile`
  (five scalar dials across the three named axes), `difficultyProfile(mode)` (the pure resolver), the
  identity profile, the dial-application helpers, and `profileOf(state)` / `isIronman(state)`.
- Each mode maps to a profile. **Survivor — and an unset difficulty — map to the identity profile: every
  dial is its neutral value (×1).** The other modes carry directional, first-pass magnitudes (below).
- The five sim seams that already own a survivability / scarcity / pacing rate read `profileOf(state)`
  and apply the relevant dial. Every one of them already has `state` (hence `state.meta`) in scope, so
  nothing new is threaded through a signature that didn't already carry state.

**Byte-identity by construction of the identity path.** Every dial is applied through a helper that
**short-circuits to the exact original value when the dial equals its identity (1)** —
`scale(n, m) = m === 1 ? n : Math.trunc(n * m)`. So a Survivor / unset run does not merely *compute the
same number a different way* (which would invite a float-rounding argument); it executes the **identical
integer expression** it did before this part, with no multiply and no `Math.trunc` in the path at all.
This is the [[zurvival-byte-identity-loot-hazard]] "gate the new behaviour behind the feature's flag"
idiom, where the flag is *"the difficulty is Survivor / unset."*

## Where difficulty lives, and why there is no save rung (stays v10)

`meta.difficulty?: DifficultyMode` and `meta.ironman?: true` — both **optional** on the meta type, both
written **only for a non-baseline choice**. Survivor normalizes to *absent* (`meta.difficulty` is only
ever set to `story`/`hardcore`/`nightmare`; Survivor is the no-op, represented by no field), and Ironman
writes `meta.ironman: true` only when chosen.

`saveGame` is `JSON.stringify(serializeSave(state))`, and `JSON.stringify` **omits `undefined`
properties**, so a baseline run's save is byte-for-byte what it was: meta serializes exactly
`version, seed, createdAt, day, hour, phase, turn` and no more. The loader's `assertSaveFile` checks only
the fields it relies on (`version`, `seed`, `phase`) and **tolerates unknown/extra fields**, so a
non-baseline save round-trips losslessly (`loadGame(saveGame(s))` deep-equals `s`) without a migration.
No forward-compat break, no orphaned save, **no `SAVE_SCHEMA_VERSION` bump — the ladder stays at v10**.
This is the strongest form of the "optional-tolerated-absent field → no rung → raw byte proof" pattern
([[zurvival-byte-identity-loot-hazard]] T52/T53): a pool-less/baseline object is the pre-T56 shape
exactly, so the cross-tree `saveGame` proof is raw-equal with no normalization.

## The dials (three axes, five scalars) — first-pass magnitudes, M5 calibrates

The T56 note is explicit that the modes are **"calibrated later in the M5 staged balance passes"** — so
this part delivers the *mechanism* and directional, honest placeholder magnitudes, not tuned numbers. The
identity column is load-bearing and permanent; the rest are M5's to move.

| Dial | Seam it reads at | Story | Survivor | Hardcore | Nightmare |
| --- | --- | --- | --- | --- | --- |
| `needDrift` — the PLAYER's hunger/thirst/fatigue climb rate | `updateCondition` → `driftNeeds` (stage 4) | 0.7 | **1.0** | 1.25 | 1.5 |
| `needRelief` — food/water payback | `eat` / `drink` | 1.3 | **1.0** | 0.85 | 0.7 |
| `lootYield` — search find-DENIAL gate (≤1; thin search comes up empty) | `resolveSearchLoot` → `searchYieldCap` gate | 1.0 | **1.0** | 0.8 | 0.6 |
| `lootContest` — off-screen rivals' draw-down | `updateRegionContest` → `contestRegion` (stage 7) | 0.6 | **1.0** | 1.4 | 1.8 |
| `directorAggression` — escalate nudge (INTEGER step) | `tickDirector` → `nudge` (stage 11) | 0.5 | **1.0** | 2 | 3 |

`needDrift`/`needRelief` are the **survivability** axis. `needDrift` scales the *player's* clock only —
companions and residents are sustained by the shelter economy, so their scarcity rides the loot/stash
dials, not a personal drift multiplier (an M5 option to extend it is parked below). `lootYield`/`lootContest`
are **scarcity** (honoring rule 1, harder modes tighten *resources*, not enemy stats): `lootContest`
depletes the finite stock faster; `lootYield` is a find-DENIAL gate — because the player gets one item per
successful search and the draw uses the *raw* cap, a `>1` multiplier can only *deny* a thin find, never
grant a richer one, so Story keeps it at 1 and takes its loot ease from `lootContest`. `directorAggression`
is **pacing** (a pushier director escalates a coasting run harder). The base escalate nudge is `1` and the
result is `Math.trunc`'d, so a multiplier in the open interval `(1, 2)` truncates back to Survivor's 1 —
harder modes therefore use **integer** steps (2, 3) so the dial actually separates; `<1` floors to 0 (a
gentle mode's director never escalates, only relieves — GDD XVI rule 4). Every dial is `1.0` for Survivor,
so every one short-circuits to the original value on a baseline run.

> These magnitudes are the post-audit shipped values. The two-subagent adversarial audit caught that the
> pre-audit `directorAggression` (Hardcore 1.5) truncated to Survivor's step (a dead knob) and that a `>1`
> `lootYield` could never grant a find — both corrected above. Full audit narrative in the QA review.

**RNG discipline for the scarcity dials.** `lootYield` scales the *yield cap* passed to
`drawInt(1, cap)`. `drawInt` performs **exactly one** `stepFloat` regardless of its range, and
`drawPick` is one `drawInt` regardless of table length — so a changed cap changes the *drawn amount* but
never the *number of stream steps* or the subsequent item pick, and for Survivor the cap is unchanged so
the draw is bit-identical. The dials **never grow or shrink a loot table** — the `floor(f·len)` index
hazard that bit T50 never arises here. `lootContest` and every survivability/pacing dial are pure integer
arithmetic with no RNG at all.

## Ironman

Ironman is a persisted *intent*, not a new subsystem. The engine stores `meta.ironman: true`, exposes
`isIronman(state)`, and the harness surfaces it. The actual "one save, no take-backs, death is final"
enforcement is a **save-slot / client policy** (no reload, autosave-over-the-one-slot, delete on death) —
the headless deterministic core neither owns save slots nor reloads, so the *mechanic* of Ironman lives
where saves are managed. This part ships the flag + helper + surfacing and parks the client-side no-reload
enforcement (it belongs with a real save-slot manager, not the demo CLI's single `zurvival-save.json`).

## Harness surfacing (reachable AND surfaced — the design-audit lens)

A mode the engine stores but the player can neither choose nor see is a dead feature
([[zurvival-byte-identity-loot-hazard]] design lens). So:

- **Choose (reachable).** `startRun`'s options already flow into `createInitialState`; they gain
  `difficulty?` / `ironman?`. `playCli.ts` parses `--difficulty <story|survivor|hardcore|nightmare>` and
  `--ironman` from argv (Survivor stays the default when unspecified, so `npm run play` is unchanged).
- **See (surfaced).** A words-only readout of the current mode + Ironman, in the always-available run
  info a returning player re-orients from (ACCESSIBILITY §6 "where am I"): rendered in the depth-screen
  set T54 built, and echoed on the CLI banner at boot. Words only — the mode *name* and a one-line "what
  it changes" gloss, never the raw dial floats (FR-UI-02 / the no-number-leak discipline). The engine
  exports the labels/descriptions so the harness renders from one source of truth.

This part touches **no content, no schema, no save rung, no RNG stream, no pipeline stage name/order** —
only engine rate-seams (behind the identity gate) + harness presentation.

## Test plan

- `engine/test/difficulty.test.ts` (new) — `difficultyProfile('survivor')` and `difficultyProfile(undefined)`
  are the identity profile; the ordering invariants hold (Story ≤ Survivor ≤ Hardcore ≤ Nightmare on
  drift/contest/aggression; the reverse on relief/yield); `createInitialState` with no option and with
  `'survivor'` produce **byte-identical** saves (both omit the field), and with `'hardcore'`/`--ironman`
  the fields appear and round-trip through `saveGame`/`loadGame` losslessly; each dial helper
  short-circuits at identity; a scripted run under each mode is internally deterministic (same seed+mode ⇒
  identical `saveGame`).
- The **identity proof as a test**: a fixed scripted run (many searches across loot kinds, needs driven
  hard, an `advanceWorld` jump) with `difficulty: undefined` and with `difficulty: 'survivor'` yields the
  identical `saveGame` string.
- Existing engine suites (561) stay green and unedited in behaviour — the optional dial params default to
  identity, so every direct caller of `driftNeeds`/`contestRegion`/`searchYieldCap` is byte-identical.
- `harness/test/` — the difficulty readout shows the chosen mode + Ironman words-only with **no number
  leak**; the CLI flag selects the mode; the default is Survivor.
- Full CI green in a clean sandbox: engine typecheck+test, content-loader (9) + `validate` (160 / 13)
  **unchanged** (no content moved), harness typecheck+test, `npm start` smoke exit 0.
- **Byte-identity:** `diff -r prototype/engine/src` is *not* empty this time (unlike T54/T55) — the engine
  is edited — so the proof is the gated-dark one: extract the pristine `zb.tgz` baseline, run the standard
  many-seed scripted run on both trees with difficulty **unset**, and compare `saveGame` raw. Empty diff =
  the edits are invisible to a baseline run.

## Definition of done

Code + tests + this plan + `docs/qa/QA_REVIEW_M4_PART12.md` + `CHANGELOG.md`; `docs/status.json` T56 note
advanced to "part 1 of 2 (difficulty) done" (T56 stays `todo`/in-progress until Part 13) + refreshed
banner + parking-lot items, under the concurrency guard; Zurvival Mission Control snapshot refreshed; a
verified `git format-patch` delivered; changed files synced to the E: mount. Two-subagent adversarial
audit — **engineering** (Survivor/unset byte-identity vs the baseline tree; no RNG-order or loot-table
drift; no save-rung; no-crash over each mode + odd/corrupt states) and **design** (each mode reachable
from a fresh run and surfaced to the player; the dials actually move the intended pressure and aren't
dead; scarcity-not-stat-inflation honored; Story is a real gentle mode; no number leak) — each with a
verify pass, all findings fixed.

## Parking lot / deferrals

- **Dial calibration** — the non-identity magnitudes above are directional first-pass; the real numbers
  come from the M5 staged balance passes (GDD XIX, survivability/scarcity/pacing) against the "one more
  day" target. (M5, by design — the T56 note.)
- **Ironman client enforcement** — one save slot, autosave-over, no reload, delete-on-death. Needs a real
  save-slot manager, not the demo CLI's single file; parked for the client save layer.
- **Mid-run difficulty change** (ACCESSIBILITY §6 `[A]` "Difficulty adjustable mid-run") — interacts with
  Ironman/roguelite integrity; decide which modes allow it. Deferred (a settings-surface concern that
  pairs with the Part-13 accessibility settings, PL-M4-51).
- **Consequence sub-dials** — infection advance rate, wound severity, combat lethality as their own dials
  for "harsher consequences" beyond needs/scarcity/pacing. The three-axis set here is deliberately
  minimal; finer consequence dials are an M5 tuning extension.
- **Dial resolution floor (audit's systemic note)** — `lootContest` and `lootYield` act on base magnitudes
  that are often exactly 1 (a single contest tick at the shipped low region activity; a thin search cap),
  where `Math.trunc(1 × m)` erases any multiplier in the open interval `(1, 2)`, so at Rivermouth's starting
  activity Hardcore/Nightmare contest resolves identically to Survivor. M5 must fix this **structurally** —
  raise the base granularity or carry the fractional remainder across ticks — not by re-picking magnitudes
  alone (the same trap that made the pre-audit director dial dead). The director dial is already out of the
  trap (integer steps); contest/yield are the remaining cases.
- **`needDrift` → party/residents** — the survivability dial scales the *player's* clock only; extending it
  to companion/NPC drift (so a harder mode's clock reaches everyone) is a coherent M5 tuning option, parked
  as a deliberate scope decision (their scarcity currently rides the shared-stash loot dials).
