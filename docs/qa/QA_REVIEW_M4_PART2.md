# QA Review — M4 Part 2 (T45–T46)

_Reviewed 2026-07-16. Scope: the survivor pool + companion depth (T45) and the full zombie roster with a
type-aware combat model (T46). New files: 15 survivor JSONs, 4 zombie + 4 enemy JSONs, and 2 new engine
test files; changed: `content/schemas/{zombie,enemies}.schema.json`, `engine/src/sim/{zombies,companions}.ts`,
`engine/src/combat/combat.ts`, `engine/src/sim/encounters.ts`, `engine/src/actions/coreActions.ts`,
`engine/src/state/types.ts` (two optional `Survivor` fields), `engine/src/index.ts`, 26 re-seeded node
JSONs, the 3 existing zombie JSONs (signatures), and `harness/test/content.test.ts`. **No save-schema
rung; `SAVE_SCHEMA_VERSION` stays 7.** An independent adversarial content-quality subagent audit ran over
the new characters + monsters; its material findings were fixed (below). Focus: is the type-aware combat
correct and never a softlock; is the human-only canon and FR-AUD-06 held; is the pool worthy of the cast;
is the companion-order engine sound and trust-gated; is byte-identity preserved where promised; and is CI
green._

## Verdict

Part 2 is the first M4 block to change the engine, and it lands cleanly. The **owner chose the fuller
option on all three forks** (a ~15-survivor subset, full trust-gated companion orders, and the full
combat model), and each was delivered without a save-schema rung and without disturbing the M3 baseline.
The properties this block most puts at risk hold.

**Save-safety / byte-identity.** The riskiest promise — that a big combat + companion change ships with
**no migration rung** — is real. Type-distinct combat derives entirely from `CombatState.enemy` (stored
since T15); companion orders ride `Survivor.flags`; `name`/`trust` are optional and tolerated-absent. A
walker fight, a screamer/stalker node, and a default-order (`follow`) party are all **byte-identical** to
before this part, which is why the whole **349-test engine baseline stayed green untouched** and only new
tests were added. A type-distinct fight and an ordered companion both **save/reload deep-equal**.

**T46 — type-aware combat is correct and stays avoidable.** Each new type is mechanically distinct and
tested: a **Riot** takes strictly more melee strikes than a walker (armor) but falls to two shots (a
firearm pierces) — and because a stealth slip is always offered and a firearm is efficient, the armor is
*hard*, never a **softlock**. A **Bloated** inflicts an infectious bite when killed at your node (melee or
shot) but **never** when slipped past — so the burst teaches avoidance rather than punishing the player
for a forced fight. A **Crawler** lands an ankle sprain (not a random blow) on a caught slip and is
harder to slip. A **Fresh** answers every exchange. The **selection rule** (`riot > bloated > fresh >
crawler`, else walker) means screamer/stalker nodes fight exactly as before T46 — the seam that preserves
byte-identity. **Human-only canon** is held on all seven types (each new type's `notes` reasserts a
formerly-human origin; the stalker note was hardened for the art team). **FR-AUD-06**: every type ships a
**non-audio** signature (a visual/readable tell), verified by a harness guard — the roster reads with
sound off.

**T45 — the pool is a real cast, and the party is bounded and earned.** 15 new survivors, 3 per
non-Rivermouth district, each a person with a background, a personality, and a genuine withheld secret,
in the exemplar voice; Dana ships. The **companion engine** is sound: the party is capped at 3, a hostile
never joins, companions are named in prose, and the four standing orders change behaviour deterministically
— with the dangerous two (scavenge/guard) **gated on earned trust (≥80)**, a gate that actually bites in
play (a fresh recruit at 70 must be fed up to it). Scavenge feeding the base stash closes part of the
"companions are a pack-drain only" gap (PL-M3-01).

**Adversarial content audit → 11 fixes.** The subagent verdict was *ship-with-fixes*: canon and
accessibility clean, dark secrets restrained, strong at the sentence level — but repetition thinned the
cast (a reused description template across ~7 survivors; three overlapping "keeper of the dead's names"
beats) and two secrets (Mara, Walt) sat below the exemplar bar. All were fixed: 5 descriptions rewritten
to break the template, 4 secrets rewritten (differentiate Grace/Orin/Hector; lift Mara to real concealed
guilt and Walt to a concrete restrained truth; reframe Theo's hoard as grief), and 2 zombie polish
(walker signature tautology; stalker canon note).

CI is green in a clean sandbox. Nothing here blocks; the deferrals below are scoped forward.

## Checks performed

- **Determinism + save round-trip.** A riot fight reloads deep-equal mid-fight; a scavenging companion
  reloads deep-equal with its order intact; the full engine suite (incl. the T13 no-op-turn audit and the
  save-property tests) is green untouched at 349, plus 23 new.
- **Combat balance sanity.** Riot: melee net damage `max(0, 1–2 − 1)` against maxHp 5, with the slip and
  the two-shot firearm as the intended outs — punishing but bounded and always avoidable. Bloated burst
  reuses the existing infection driver (a `wound.bite`), so it needs the clinic's meds to halt, exactly
  like a combat bite.
- **Re-seed integrity.** `buildRegionGraph`/`startRun` over the shipped city still builds one connected,
  symmetric graph (harness content tests green); every combat-distinct type is seeded on a live
  (`walkers > 0`) node; Rivermouth's nodes are unchanged (only marina stays intentionally inert).
- **Order gate at resolve time.** The scavenge/guard trust gate is enforced both at the offer and in
  `resolveCompanionOrder`, so a caller that skips the offer can't sneak a low-trust companion into danger.
- **Content quality.** Post-fix dedup re-check: the description template and the ledger/register motif are
  resolved (Grace is the sole keeper of a names-register, as intended); dispositions and roles vary.

## Parking lot (carried forward)

- **PL-M4-07 — companions don't fight yet.** A companion follows, holds, scavenges, and guards, but does
  not participate in combat (FR-NPC-03 autonomy remainder). The type-aware combat (T46) is player-vs-dead
  only. Wire companion combat behaviour (competence/morale/fear) when the fear/panic model (FR-CBT-09) and
  the deeper companion AI land.
- **PL-M4-08 — orders tick only on the player's turns.** Scavenge banks and guard upkeep happen in stage 5
  (a resolved player turn), not off-screen (extends PL-M3-02/05). A companion left on `hold`/`scavenge`
  in a district you fast-forward past isn't simulated until you act. Land with the off-screen people-sim.
- **PL-M4-09 — first-pass companion-order dials.** `PARTY_CAP` 3, `ORDER_TRUST_MIN` 80,
  `SCAVENGE_HOURS_PER_UNIT` 2 / `SCAVENGE_EXTRA_DRAIN` 2, `GUARD_UPKEEP_PER_HOUR` 1, `COMPANION_SHARE_TRUST`
  8 are first-pass and untuned against a real run — M5 balance (T59/T60). Scavenge banks a fixed item
  (`item.canned-food`); a richer yield table can follow with the T51 economy.
- **PL-M4-10 — Rivermouth's marina stalker is still inert.** Left `walkers: 0` deliberately to protect the
  slice/Rivermouth goldens this part; give it a body when a Rivermouth-touching golden refresh is next due
  (the rest of the M2-roster inert nodes were made live in the re-seed).
- **PL-M4-11 — pool composition to watch as it grows.** At 18 the cast skews toward care/veteran-professional
  roles (3 medical-adjacent + the exemplar paramedic) and mid-career ages; widen the age band and swap in
  more trades/young/other backgrounds as the pool grows toward 60–100 (still under the review-capacity cap).
- **PL-M4-12 — the human voice/casting pass is still owed.** Per PRODUCTION §7 the characters cannot be
  auto-approved; this part drafted and self-reviewed them (+ a subagent audit). The owner's voice pass
  before beta is the real gate.

## CI

`engine 372 (+23) · content-loader 9 · harness 57 (+9) · typecheck clean ×3 · schema gate 101 entries /
7 types · malformed rejected · empty-turn smoke exit 0.`
