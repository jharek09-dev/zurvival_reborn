# M4 Part 14 — the M4 exit gate (T57 · content-complete city & public-beta hardening)

The **last task in M4**, and the milestone's Definition of Done (PRODUCTION §M4). Unlike Parts 1–13 (which
*built* the content-complete city — regions, survivors, encounters, infection, radio, economy, factions, depth
screens, audio, difficulty, accessibility), Part 14 **proves the city is done and hands the beta to the
owner**. It is the content-complete analogue of the M3 **Slice Fun Gate** (T42): a gate whose human verdict is
the owner's, prepared and evidenced by everything a machine can prove.

## The bar (PRODUCTION §M4 Definition of Done)

> The first city is content-complete and schema-valid; verbatim encounter repetition sits under the PRD §4
> target across a full run; infection-as-identity plays as *a harder way to keep going*, comprehension-tested
> with players; the beta is stable enough to hand out. **A pass opens M5.**

Four criteria. Two are fully machine-provable; two have a human half that — as the M3 gate was — is the
**owner playtest**, not a code assertion.

## Scope decision (recorded)

- **Gate model: readiness package + owner playtest.** T57 delivers and *proves* every machine-provable
  criterion, assembles a gate packet + a scripted owner playtest, and **defers the human comprehension /
  "handable" / "one more day" verdict to the owner** — exactly how T42 closed M3. **M4 stays active**, marked
  *exit-ready — owner gate pending*; it flips to done when the owner records the verdict. This part does **not**
  unilaterally close the milestone.
- **Hardening depth: Focused, respecting the M5 line.** Full-city content-completeness + the §4 repeat proof
  over a full run + save round-trip integrity across the whole city + determinism/repro-from-seed + a beta
  build & handout. Crash-free ≥ 99.5%, the perf/turn-budget numbers, long-run soak, and bounded history growth
  stay in **M5/T66**, where PRODUCTION already scopes them — the M4 bar is "stable enough to hand out", not the
  reliability pass.

## Architecture — one consolidated exit gate + docs, zero engine/content touch

**Byte-identity by construction (the T54/T55/T56 shape).** Nothing in `prototype/engine/src` or `content/` is
edited, so `diff -r` of both against the pre-part baseline is **empty** and every engine golden + the
cross-tree `saveGame` proof hold by construction. The work is a harness test suite + docs.

### 1 · The exit-gate suite — `prototype/harness/test/exitGate.test.ts` (20 assertions)

One place the four DoD criteria are re-proven at the **content-complete, full-city** tier, so the exit
criteria can't silently rot (existing per-system tests prove pieces at slice scale; this consolidates and
elevates):

- **Content-completeness manifest (FR-CNT-02).** Enumerates every M4 in-scope content **pool** → its shipped
  count against a floor, with the engine's own constants (`ENCOUNTER_CATEGORIES`, `INFECTION_STAGES`,
  `DIFFICULTY_MODES`, `PARTY_CAP`, `ZOMBIE_BEHAVIOUR`, `ENEMY_FOR_ZOMBIE`) — regions/nodes, survivors,
  encounters (+ the 7 categories, multi-stage, evolution, chains, moral), infection, radio, economy, jobs,
  factions, the **zombie roster + named wounds**, and the difficulty floors — and checks the **client-side**
  systems are present (depth screens FR-UI-04, the FR-AUD-06 audio→text cue matrix). It **cross-checks every
  reference resolves** (faction members, arc subject, npc home-nodes, encounter node-anchors) — no dangling
  ids — and asserts the beta boot **registers the authored arc**. The whole city is built with **every pool
  registered** via `buildRegionGraph`, which throws on any asymmetry/dangling-edge/disconnection.
- **§4 over the content-complete run.** The T48 selection probe re-pointed at the **all-pools** boot: a
  deterministic ~54-day full-city sweep, asserting verbatim-repeat < 5%, 0 immediate, ≥ 12 distinct, ≤ 25%
  max share, and full city coverage (all 6 regions exercised).
- **Beta hardening (Focused).** Repro-from-seed (a full playthrough is byte-identical from the seed — final
  state + transcript); the shipped save **format** round-trips deep-equal at a rich state; quit/resume is
  byte-identical at **every** boundary from the save string alone; and a long run **never soft-locks** (a legal
  action is always offered until a clean end).
- **Infection is a harder way to keep going (FR-INJ-08).** At `terminal` the run is not over (a cure race, not
  a loss screen); the cure stays actionable at the worst stage; the stage reads from symptoms with **no number
  leaked** (re-touching the standing T49 comprehension gate at the exit tier).

### 2 · The gate packet — `docs/qa/M4_EXIT_GATE.md`

The auditable exit record: the bar, the proven/owner-pending split, an evidence table per criterion with the
measured numbers, the CI snapshot, and — the point of the "package + playtest" model — a **scripted owner
playtest** (Q1 infection-as-identity comprehension; Q2 handable / "one more day") with a verdict table for the
owner to render, mirroring `FUN_GATE_LOG.md`.

### 3 · The beta handout — `docs/BETA.md`

The hand-it-out doc: how to run (`npm run play`, seeds, `--difficulty`, `--ironman`, `--resume`), the
keyboard controls + free depth screens, what to expect (the Survival Triangle, node memory, infection as
identity, people, sound-in-words), the accessibility summary, and the honest known-scope (beta subset volume;
balance is the M5 pass; terminal client only). The repo `README.md` keeps its deliberate "design & content
home" framing; a note to refresh its stale "no engine committed yet" line is parked (PL-M4-64).

## Honest deferrals (tracked, not dropped)

- The **human verdict** on criteria 3 & 4 — the owner playtest (this packet prepares it).
- **Reliability/perf hardening** (crash-free ≥ 99.5%, perf budget, soak, bounded history) → **M5/T66**.
- **Deep content pours** toward the ~60–100 survivor cap and the wider encounter set → PL-M4-16 / PL-M4-63.
- The **stale README** front-page line → PL-M4-64.

## Definition of done for this part

`exitGate.test.ts` green (+23) with the full CI green and byte-identity proven; `M4_EXIT_GATE.md`,
`M4_PART14_PLAN.md`, `QA_REVIEW_M4_PART14.md`, and `BETA.md` written; `status.json` T57 marked *exit-ready —
owner gate pending* (not done) with the banner + parking-lot updated; the CHANGELOG entry added; Mission
Control refreshed; the format-patch delivered.
