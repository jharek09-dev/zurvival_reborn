# 0005 — Cross-run memory persistence

- **Status:** accepted
- **Date:** 2026-07-16 (accepted 2026-07-16 by Jharek)

## Context

Scheduled to resolve by **M4** (PRODUCTION §9, PRD §15 Q6): it *gates endings and
meta-progression*. The M5 backlog assembles **multiple endings from real run components** (T61,
FR-STY-06) and epilogues that follow surviving NPCs (T62) — both need a defined answer to *how much
of a run outlives it*. The raw material already exists: the append-only **Living History** (TEC-06,
engine task T31) records the significant beats of a single run. What is undecided is how much of that
— survivors, endings, world beats — **carries between runs**, and whether it is account-bound.

Framing constraints from prior decisions and the game's spine:

1. **Protect the per-run stakes ("one more day", GDD XVI).** The core loop earns its tension from a
   fresh, losable run. A cross-run mechanic that grants a *head start* would trivialize the survival
   clock and feed the balance-fragility risk (PRD §13) — the thing M5's staged passes exist to
   retire, not to widen.
2. **Give endings + continuity a real source.** T61/T62 read "who lived, what you built, the choices
   logged" — that requires a *persistent* record of completed runs, not just the live one.
3. **Local + save-adjacent (ADR-0003).** Saves are local-first, client-owned, accountless on the hot
   path. Cross-run memory should live the same way.
4. **Bounded (PL-M2-06).** The in-run Living History is append-only and unbounded; a *cross-run*
   accumulation must not grow without limit across dozens of runs.
5. **Deterministic (TEC-01).** Whatever persists must be a pure function of what actually happened,
   so it is reproducible and testable.

## Options considered

**(a) Nothing carries.** Simplest; each run is an island. But endings cannot reference anything
beyond the current run, and there is no continuity or retention hook. Rejected — it throws away the
Living History's whole point across runs (criterion 2).

**(b) Bounded chronicle, no mechanical carry.** A persistent local record of completed runs
(endings, named survivors who lived/fell, notable beats) as codex/flavor and ending input, while
every run starts *mechanically* clean. Protects stakes (criterion 1) and feeds endings (2), but
offers no light "keep playing" pull between runs.

**(c) Chronicle + light unlocks (chosen).** Option (b) plus a small, explicitly-capped set of
persistent unlocks — starting-kit *variants*, already-discovered recipes/blueprints surfaced in the
codex, cosmetic titles/epitaphs — chosen so none shortens the survival clock. Meta-continuity and a
light retention hook **without** a power ramp.

**(d) Full meta-progression (roguelite).** Persistent upgrades/resources carry and compound. Strong
retention, but it erodes per-run stakes and multiplies the balance surface (criterion 1 + the
balance-fragility risk). Rejected.

## Decision

**Adopt (c): a bounded, local, per-profile "Chronicle" plus a capped set of light unlocks.**

- **The Chronicle** is a persistent record, stored the same local-first way as the save (ADR-0003),
  with **its own version integer and forward-only migration ladder** (the T7 pattern, applied to a
  second artifact). On a completed run it records: the outcome/ending, the named survivors who lived
  or fell, and a **bounded selection** of significant Living-History beats. It is the **source the
  M5 ending assembler (T61/T62) reads** and the codex renders.
- **Light unlocks** layer on top: alternate **starting-kit variants**, **recipes/blueprints already
  discovered** (surfaced, not pre-crafted), and **cosmetic titles/epitaphs**. The set is **finite
  and enumerated**, curated so no unlock grants a mechanical head start (criterion 1). It is not an
  open economy.
- **Bounds (criterion 4):** the Chronicle keeps a **rolling window** of the last *N* runs in detail
  plus small lifetime aggregates (e.g. runs survived, longest run, roll of the dead) — retiring
  PL-M2-06 for the cross-run layer. Unlocks are the fixed enumerated set.
- **Determinism (criterion 5):** every Chronicle entry and unlock is a **pure function of a
  completed run's final state + Living History** — reproducible from seed, unit-testable.
- **Not account-bound:** local per-profile, consistent with ADR-0003; optional cloud sync inherits
  ADR-0003's deferred additive-transport seam (the Chronicle is just another versioned local string).

This ADR **decides the policy**; no engine code is required in M4. The Chronicle shape, its
migration rung, and the ending assembler are M5 work (T61/T62), and the ladder is proven end-to-end
by T65.

## Consequences

Easier: M5 endings and epilogues have a **defined, bounded, deterministic source**; a **light
retention hook** exists ("watch your roster of the fallen grow") without a power snowball; per-run
survival **stays the point**; local-first keeps it accountless; the rolling-window bound kills the
unbounded-growth risk for this layer.

Harder: a **second persisted artifact** (the Chronicle) now carries its own versioning + migration
discipline (accepted — it reuses the ADR-0003 / T7 ladder pattern, and T65 already proves that
ladder); the **unlock set must be curated** to stay non-snowballing (a standing design-review guard,
logged to the parking lot); endings must **degrade gracefully on a first/empty Chronicle** (a first
run reads only its own components — which is the T61 default anyway).

If accepted: unblocks M5 T61/T62 with a defined cross-run contract — *chronicle + capped light
unlocks, local, versioned, deterministic*. If vetoed: re-decide against the same five criteria within
the M4 time-box before any ending or unlock reads cross-run state.
