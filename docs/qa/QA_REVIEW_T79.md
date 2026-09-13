# QA Review — T79 · Neglected territory festers

**Date:** 2026-09-13 · **Milestone:** M5 (second task, seq 102) · **Task:** T79 (design review 2026-09-12, step 8)
**Status:** DONE · **Not byte-identical** — intentional behaviour change, declared like T74–T78. The whole
deliverable is that two districts which used to drift identically no longer do.

**CI (clean sandbox):** engine **815** (was 802 at T78, +13) / harness **264** / content-loader **23** /
testlab **22** / schema gate **160** / a11y gate OK / `tsc --noEmit` clean in all four packages.
**Save schema v10 holds and this task adds no state at all** — neglect is *derived* from the `lastVisit`
day the nodes have remembered since M1, so there is no new field, no migration rung, and nothing that
can desync from where the player has actually been.

---

## 1. What was wrong

DESIGN §5 and GDD IV both say the same thing: leave a district to fester and it gets worse. The code
said the opposite, and the design review measured it — 400 turns with the player absent took Rivermouth
from its authored 35 to **7** and Downtown from 70 to **11**. T78 fixed the *sign* of that curve (the
drift now anchors on the authored baseline, lifted by a +1/day ramp), but it fixed it **uniformly**: on
the T78 build every district climbs at the same rate whether the player patrols it daily or never sets
foot in it again. The only term that depended on where the player was standing was the director's local
lean, and it pointed the wrong way:

> 40 idle days on the shipped city, T78 build, seeds t79-a / t79-b: the district the player is standing
> in ends **+30 points over its authored threat**; the five it abandoned average **+27.6 / +28.0**.
> **Gap −2.4 / −2.0 — holding ground still made it worse than walking away from it.**

That is the same backwards fact the review named, one layer down: not "abandoning is safer than it was"
any more, but "abandoning is *no different*, and the ground you hold is the ground the director works."

## 2. What shipped

### `sim/regionDrift.ts` — the third term on the T78 anchor

- **`neglectLift(daysSinceVisit)`** — `0` through `NEGLECT_GRACE_DAYS` (2), then `NEGLECT_PER_DAY` (1)
  per day, capped at `NEGLECT_CAP` (10). Total in the `dayRamp` mould: a negative gap (a hand-edited
  `lastVisit` in the future), a fraction and `NaN` read as 0; `+Infinity` reads as the cap. Never `NaN`,
  which would have poisoned the anchor and then every dial downstream (the T77 `scentDraw` class of fault).
- **`regionNeglectDays(state)`** — days since the player last stood in each region, derived from the
  nodes' own `lastVisit`. Three rules, each with its own test:
  - the region the player is **in** reads 0, however stale its stamp is (`lastVisit` is written on
    *arrival* and never refreshed while you stay, so a player who camps for a week would otherwise be
    neglecting the ground under their feet);
  - a region counts from the **most recent** visit to **any** of its nodes;
  - a region no node of which was ever entered is neglected from the run's first day. What is never
    held is never tended.
- **`driftAnchor(baseline, day, bias, neglect)`** — the lift is now `dayRamp + neglect + bias`, applied
  to the threat **and** density points, under the existing 0–100 clamp. The `neglect` argument is
  re-bounded inside the anchor as well as at its source, so no caller can smuggle an unbounded lift in
  through it.
- **`driftRegions`** derives the map once per tick and passes each region its own lift. **No new RNG
  draws** — the jitter sequence is identical whether or not a region is neglected, so no other layer's
  stream moves (the T78 discipline).

### `prototype/harness/measure/t79.ts` (new) — the committed runner

`--idle` (default), `--patrol[=region.x]`, `--cap`, `--absent`. It runs against the **pre-T79 tree as
well**: the constants are read off the engine namespace with fallbacks and the neglect-day column is
computed in the runner by the same rule, so the before and after outputs line up column for column.
Every figure below is re-derivable from it; the cap sweep and the threat-only probe are taken by
rebuilding the engine with the variant constant and re-running, and the runner prints whatever constants
the tree it is running on compiled in.

## 3. Corrections to the brief, both measured (PL-M5-31)

**1. The brief's cap was a ceiling below the floor.** It asked for threat "capped at
`baseline.threat + 20`". Against the T78 anchor the day ramp *alone* is worth +21 on day 22 and +30 from
day 31, so an absolute cap of +20 would have **clamped the ramp back down from day 22** — undoing the
previous task rather than building on it — and would have pinned Downtown at 90 where the ramp had
already earned it 100. The cap therefore bounds **this term's own contribution to the anchor**, not the
resulting dial.

**2. Neglect must lift the density point too, or it is inert.** Under the anchored model
`equilibriumDensity` reads the *deviation* `threat − anchor.threat`, so a neglect term on the threat
anchor alone raises the threat dial and leaves the density equilibrium exactly where it was. Rebuilt
that way and re-measured over 40 idle days: the threat column is **identical** to the shipped one (city
mean 84.67) and the day-40 body count is **284, against the pre-T79 tree's 283** — one body in forty
days. T75 would never have seen it, and the consequence would have terminated in a number nobody acts
on. It rides both points, exactly as the ramp does.

**The compounding PL-M5-31 feared did not happen at the chosen cap.** The entry warned that "the two
ramps compound to the 100 clamp by week two in every district". Measured: at cap 10 the day-40 city has
**one** district at the clamp (Mercy) — exactly as many as the day ramp alone produces.

### The cap sweep (40 idle days, seed t79-a, each row a rebuild)

| cap | d40 mean threat | districts at the 100 clamp | d40 bodies |
|-----|-----------------|----------------------------|------------|
| 0 (no term) | 79.67 | 1 (Mercy) | 283 |
| 5 | 82.17 | 1 | 291 |
| **10 (shipped)** | **84.67** | **1** | **298** |
| 15 | 87.17 | 2 (+ the Ironworks) | 304 |
| 20 | 88.83 | 2 | 304 |
| 30 | 92.17 | 2 | 315 |

**10** is the choice: 15 is where the Ironworks (authored 55, plus the ramp's 30) is pinned at 100 by
day 40 and stops being a district with a character; 10 leaves the day-40 saturation exactly where the
ramp alone put it, buys 15 bodies, and equals `DIRECTOR_BIAS_MAX` — so the two *local* terms that lean
an anchor carry the same authority and neither can drown the other. A district is fully festered on day
13 of absence (grace 2 + cap 10).

## 4. Measured, before → after

All figures from `measure/t79.ts` on the shipped city; "before" is the T78 tree, "after" is this one.

**The differential the task exists to produce** (40 idle days, the player parked on the start node, so
Rivermouth is held and the other five are abandoned):

| | seed t79-a | seed t79-b |
|---|---|---|
| held district over its authored threat, d40 | 30 → **30** | 30 → **30** |
| the five abandoned, mean over authored, d40 | 27.6 → **33.6** | 28.0 → **34.0** |
| **gap (abandoned − held)** | **−2.4 → +3.6** | **−2.0 → +4.0** |
| city bodies, d40 | 283 → **298** | 280 → **299** |
| city mean threat, d40 | 79.67 → **84.67** | 80.00 → **85.00** |
| districts at the 100 clamp, d40 | 1 → **1** | 2 → **2** |

Per district, seed t79-a, day 40 (threat/density), before → after: the Ironworks **85/90 → 95/100**,
Hillcrest **69/68 → 79/78**, the Terraces **60/65 → 70/75**; Downtown (99/98) and Mercy (100/100) do not
move because the ramp already has them at the ceiling; Rivermouth (65/76) does not move because the
player is standing in it.

**The term in isolation** (`--patrol`: the same seed and the same 40 days run twice, one district
visited every other day, the other run identical — only `lastVisit` differs, and stamping it draws
nothing, so the jitter sequence is shared and the difference *is* the neglect term). The Terraces,
authored 30/35:

| | d4 | d7 | d10 | d14 | d20 | d30 | d40 |
|---|---|---|---|---|---|---|---|
| patrolled | 32/36 | 35/39 | 39/44 | 44/50 | 49/53 | 59/65 | 60/65 |
| abandoned | 33/37 | 39/43 | 46/50 | 54/60 | 59/63 | 69/75 | 70/75 |
| threat gap | 1 | 4 | 7 | **10** | 10 | 10 | 10 |

The two runs first differ on **day 4** (the first point after the grace), reach the 10-point cap on day
14 and hold it. The city-wide body count follows mid-run — day 14, abandoned vs patrolled, **287/282**
(seed a) and **283/278** (seed b) — but by day 40 the difference is seed-dependent (**298/298** and
**299/291**): one district of six, against a city the ramp is saturating anyway, is inside the noise by
then. The dial gap is the claim; the body gap is one district's worth of it.

**The review's own probe, re-measured** (400 turns × 2h = day 34, player absent): the Ironworks
**85 → 95**, Hillcrest **70 → 80**, the Terraces **60 → 70**, bodies **277 → 294**. Downtown and Mercy
are at 100 in both. Rivermouth is unchanged at 66 in both — the player is standing in it, which is the
rule working, not an omission.

**What the player actually reads.** `harness/src/screens.ts#threatWord` renders a district's threat as a
word on the travel list (quiet / uneasy / dangerous / deadly), so the differential is legible with no UI
work at all — but only where it crosses a threshold. Measured on the patrol probe: the two runs read a
**different word on 8 of 40 days (d13–d20, both seeds)** — "uneasy" against "dangerous" — after which the
day ramp carries the patrolled district over the same threshold and they read alike again. Eight days of
forty is what this buys in words; the rest of it is legible only in bodies.

## 5. Audit — three passes

**Engineering (mutation).** Fifteen mutants across every new site — the three constants, each of
`neglectLift`'s four total-ness branches, the anchor's two bounds, the anchor's density lift, each of
`regionNeglectDays`'s four rules, and the wiring in `driftRegions` — run against
`regionDrift`/`director`/`worldSim`. **15 of 15 killed on the first round**, each by a named test.
(T78's lesson was that an audit fix still needs its own test; this pass was run *before* the write-up so
the tests are what the claims rest on.)

Findings fixed during the build rather than after it:

1. **The camper's hole.** `lastVisit` is stamped on arrival and never refreshed, so a player who holds
   one node for a week would have been "neglecting" the region they were standing in. The current
   region reads 0 by rule; `neglect:no-here` is the mutant that proves it.
2. **A threat-only lift is inert** (§3.2) — caught by measurement, not by reading.
3. **Two tests were comparing the wrong things.** The first drafts asserted that region Y outran region
   X in one run, and that a one-day absence left them identical. Both are false for a reason that has
   nothing to do with neglect: **each region draws its own jitter**, so two identically-authored regions
   are never dial-for-dial equal. Every assertion now compares a district against *itself* across two
   runs that differ only in `lastVisit`.
4. **"Adds no RNG draws" was being tested over a whole run**, where it is not true and should not be:
   once neglect has produced more density, repopulation and hordes legitimately draw *more*. The
   invariant belongs to the drift layer and is now tested there, on a single call.

**Honesty.** Five claims were cut or corrected against the measurement before this document was
finished: (a) the cap paragraph in `regionDrift.ts` was first written with *invented* sweep figures and
is now the table in §3, taken from six rebuilds; (b) "the brief's cap would clamp the ramp from day 21"
— the crossing is day **22**; (c) the held/abandoned gap of +3.6 is **compressed by the 100 clamp** and
is not the size of the term (the term is 10, and §4's patrol probe is where that shows); (d) no claim is
made that this changes how a *run* plays (see §6.1); (e) the design review's 35 → 7 and 70 → 11 belong
to the pre-T78 build and are quoted as history, not as this task's before.

**Verification.** Every figure in this document was re-derived on both trees in the same session with
the committed runner; the mutation set was re-run against the final tree; full CI was run clean after
the last edit.

## 6. Declared limits — what this does not do

1. **It is inert in the play the bots produce, and measurably so.** `measure/t78.ts --director`
   (8 seeds × 400 turns, both policies) returns **identical** numbers on the T78 and T79 trees: 353
   turns, mean end day **3.63**, the same beat census, the same ends. Runs end on day 3.6 — before a
   district can fester even one point (grace 2, first point on day 3 of absence) and long before the
   cap. This term is measured off-screen because off-screen is where it lives; it is a statement about
   a run that lasts weeks, and no bot run does. The same limit T78 declared, unchanged.
2. **The ceiling absorbs it on exactly the two districts the design most wants dangerous.** The day
   ramp alone carries Mercy's anchor (authored 80) to the 100 clamp on **day 21** and Downtown's
   (authored 70) on **day 31**; from there neglect can add nothing, and the two trees' day-40 dials for
   those districts are identical (99/98 and 100/100). It does register before that — Downtown reads
   **83/92 → 93/99** at day 14 — so the term is not lost on them, it *expires* on them a fortnight in.
   The dial's headroom, not the term, is the binding constraint — **PL-M5-35**, pairs with PL-M5-11.
3. **It costs a little regional identity.** The day-40 threat spread falls **40 → 35**: the districts
   with headroom climb while the top two are already clamped. The cap sweep shows this is not
   cap-sensitive above 5, so it is the ceiling's doing, not the rate's — the same thing §6.2 names.
4. **The readout is thin** (§4): one word threshold, eight days of forty. The travel list says nothing
   about how long it has been since you were there or which way a district is moving — **PL-M5-34**.
5. **A base abandoned is still not weaker for it.** PL-M3-05 (off-screen barricade decay) is explicitly
   *not* closed here: the neglect term moves a region's threat and density, never a node's barricades.
   T83's night attacks are where a shelter left alone starts to cost something.
6. **Neglect is per *region*, not per node.** Stepping into one node of a six-node district resets the
   whole district's fester. That is the right grain for a drift layer that only has region dials, and it
   is worth knowing before anyone builds a "sweep the district" verb on top of it.
7. **Nothing reads it but drift.** The director does not know how long a region has been abandoned, the
   radio does not, and encounters do not. Everything downstream sees it only through `threat` and
   `zombieDensity` — which is the point (consequences must become bodies), but it also means there is no
   authored beat anywhere that says *this place has gone bad since you left*.

---

**Next: T80** (seq 103) — weapon profiles and the missing combat verbs.
