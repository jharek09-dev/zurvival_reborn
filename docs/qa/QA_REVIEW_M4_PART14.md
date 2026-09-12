# QA Review — M4 Part 14 (T57 · the M4 exit gate)

**Scope:** the M4 exit gate — prove the machine-provable half of the M4 Definition of Done (content-complete
& schema-valid, §4 repeats under target, infection FR-INJ-08, a handable beta), assemble the gate packet +
owner playtest, and mark M4 *exit-ready — owner gate pending*. This is the milestone's decisive gate; the
human verdict is the **owner playtest**, not this part. T57 does **not** flip to done here.

**Verdict:** ✅ Ship (readiness package). Zero BLOCKERs. Two-subagent adversarial audit (engineering +
completeness/honesty) with a verify pass; all actionable findings fixed and re-verified. **Byte-identity holds
by construction** — nothing in `prototype/engine/src` or `content/` is edited (`diff -r` of both vs the pre-part
baseline is empty), so every engine golden + the cross-tree `saveGame` proof hold. The work is one harness test
suite + docs + one harness client fix.

## Architecture verified

- **The exit-gate suite** (`prototype/harness/test/exitGate.test.ts`, 23 assertions): one place the four DoD
  criteria are re-proven at the content-complete, full-city tier. A **content-completeness manifest** (every
  in-scope content pool → count-vs-floor with the engine's own constants; the zombie roster + named wounds;
  the client-side depth-screen + audio→text systems; all references resolve; the beta boot registers the
  authored arc), the **§4 sweep** over the all-pools boot, **repro-from-seed** + lossless save-format
  round-trip + resume-at-every-boundary + a multi-seed **no-soft-lock** invariant, and infection **FR-INJ-08**
  (terminal survivable, cure actionable, no number leaked).
- **The gate packet** (`docs/qa/M4_EXIT_GATE.md`): the bar, the proven/owner-pending split, an evidence table
  per criterion with the measured numbers, the CI snapshot, and the scripted **owner playtest** (Q1 infection
  reads as identity; Q2 handable / "one more day") with a PENDING verdict table (the FUN_GATE_LOG shape).
- **The beta handout** (`docs/BETA.md`): run instructions, controls, what-to-expect, accessibility, honest scope.
- **One client fix** (`prototype/harness/src/playCli.ts`): the full-city beta now registers the authored
  arc(s) so `npm run play` plays the story, not just `play:slice`. Harness-only; every golden generator still
  passes `[]` and stays byte-stable.

## CI (clean cloud sandbox)

- engine typecheck + test — **580 (+0, untouched)**
- content-loader typecheck + test — **23**; schema gate `validate` — **160 / 13**; a11y gate `validate:a11y`
  — palette OK; both malformed checks reject
- harness typecheck + test — **255 (+23:** `exitGate.test.ts`**)**; `npm start` smoke exit 0
- **Byte-identity by construction:** `diff -r prototype/engine/src` and `diff -r content` vs the baseline are
  both **empty**; the only source change is `harness/src/playCli.ts` (client arc registration).

## Measured evidence (reproduced by the audit)

- **§4 over the content-complete sweep:** 136 fires / ~54 days · **0.00% verbatim** (target < 5%) · 0
  immediate · 20 distinct · 12.5% max share · 5 ambient categories (combat/shelter out of the ambient probe by
  construction; all 7 authored).
- **Manifest:** 6 regions / 60 nodes / 14 safehouses · 18 survivors (beta subset) · 26 encounters, 7
  categories · 7 zombies (+5 enemies) · 4 wounds · 7 radio (5 families) · 16 recipes (6 families) · 6 jobs · 3
  factions · 1 arc (now boot-registered) · 4 difficulty modes + Ironman · 5 depth screens · 48 audio cues.
- **Hardening:** repro-from-seed byte-identical; save-format round-trip deep-equal; resume lossless at every
  boundary; no soft-lock across 3 seeds.

## Two-subagent adversarial audit → fixes

**Engineering (teeth / correctness / byte-identity).** Confirmed byte-identity, the full 255-test suite green,
`bootFullCity` mirrors the real client boot, and proved teeth empirically (a cooldown/weight regression flips
the §4 sub-asserts to fail; bogus cross-refs fail). Findings fixed:

- **MED — liveness longevity branch was dead** (the run succumbs to infection ~turn 59, so `resolved ≥ 120`
  never fired; the test reduced to "ends or no soft-lock" while the prose oversold sustainability). **Fixed:**
  reframed to the honest **anti-soft-lock invariant sampled across 3 seeds** (each makes real progress and
  ends cleanly or hits the cap), and the greedy policy now treats infection.
- **LOW — arc proven as data, never registered at runtime** (both clients passed `[]` for arc ids). **Fixed:**
  registered the arc in `playCli.ts`; the manifest now asserts the beta boot's `activeArcs` includes it.
- **LOW — "all-pools §4" adds ~zero incremental coverage** (selection is stream-independent). **Fixed:** the
  packet now states this honestly (independence is itself the assurance), not as new interaction coverage.

**Completeness / honesty (reverse-coverage / no over-claim).** Confirmed every measured number reproduces and —
the failure mode this task worried about — **no doc over-claims the human halves or M5/T66 reliability work**;
the proven/pending split and the beta-subset qualification are consistent across all docs. Findings fixed:

- **HIGH — the zombie/enemy roster (T46, FR-CBT-06/07, Must) had zero gate coverage.** **Fixed:** manifest row
  + assertion (7 zombies, 7 behaviours, enemy-mapping resolves) and named wounds; evidence-table row added.
- **HIGH — "enumerates every in-scope system" but depth screens (FR-UI-04, Must), adaptive audio (FR-AUD-06,
  Must) and the accessibility baseline were absent.** **Fixed:** manifest now asserts the client-side systems
  present (`DEPTH_SCREENS`/`CUE_MATRIX`), references their behaviour suites + the a11y gate, and the wording is
  corrected to "every content pool + the client-side systems".
- **MED — factions row implied the whole FR-NPC set but checked only membership.** **Fixed:** scoped to
  membership integrity; the relationship substance is referenced to `social.test.ts`.
- **LOW — the "Encounters ≥ 20" bar wasn't machine-backed; "never soft-locks" generalised one seed; stale
  README front page.** **Fixed:** count asserted; multi-seed liveness; README's "no engine committed yet" line
  refreshed to point at the prototype + beta.

Post-fix: full CI re-run green (255), byte-identity re-confirmed, measured numbers unchanged.

## DoD criteria → status

| Criterion | Machine half | Owner half |
| --- | --- | --- |
| 1 · Content-complete & schema-valid (FR-CNT-02) | ✅ manifest + schema gate (160/13) | — |
| 2 · Verbatim repeats < §4 target | ✅ 0.00% over the content-complete sweep | — |
| 3 · Infection a harder way to keep going | ✅ FR-INJ-08 survivable + legible (T49) | ⏳ *reads as identity?* |
| 4 · Beta stable enough to hand out | ✅ repro-from-seed, lossless persistence, no soft-lock, boots+plays | ⏳ *feels handable / "one more day"?* |

## Deferrals (tracked, honest)

- The **human verdict** on criteria 3 & 4 — the owner playtest (`M4_EXIT_GATE.md`).
- **Reliability/perf hardening** (crash-free ≥ 99.5%, perf budget, soak, bounded history) → **M5/T66**.
- **Deep content pours** toward the ~60–100 survivor cap + the wider encounter set → PL-M4-16 / PL-M4-63.
- **README refresh** — the "Repository layout" + principles sections still describe the pre-prototype scaffold
  → PL-M4-64 (the load-bearing "no engine" line is fixed here).

## Parking lot

- **PL-M4-64** — refresh the README "Repository layout" / six-principles sections to describe the prototype
  (they still list empty `items`/`weapons`/`locations` scaffold dirs and omit `prototype/`); the stale
  "no engine committed yet" line is fixed in this part.
