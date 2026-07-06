# Fun-Gate Log

The single record of every fun-gate verdict (PRODUCTION §4 / §7). One check has real authority over the
whole project: the **Slice Fun Gate** after M3. This file holds its criteria, the evidence prepared for
it, and the verdict — which is the **owner's human call and cannot be auto-passed**.

> Per PRODUCTION §4: record every gate verdict with **build, date, the specific retellable moment (or its
> absence), and the decision**. If the gate fails, the answer is **never "add more content"** — scope
> re-invests in the loop, the director, the characters, or the pacing until the slice grips. Content stays
> frozen until it passes.

---

## Stage 2 — Slice Fun Gate (M3 → M4) — decisive

**The bar (PRODUCTION §4, GDD XVI/XIX).** The complete vertical slice — the core loop + the reactive world
+ people/companion + a claimed, fortified shelter + one authored story — must:

1. Produce an **emergent, retellable story** — a run generates a moment a player would recount unprompted.
2. Pass the **"one more day" test** with **real playtesters** — the loop pulls you into another day.

**Authority.** A pass opens M4 (content-complete city) and freezes the content schemas for authoring. A
fail freezes content and re-invests in loop/director/characters/pacing. Do not start M4 until this passes.

### Evidence prepared for the gate (M3 Part 4 build)

- **Playable slice transcript:** [`FUN_GATE_SLICE.md`](FUN_GATE_SLICE.md) — a real end-to-end run through
  the engine and the story-first client: search → claim → fortify → stash → meet Ruth → her plea (fired by
  the systems, not scripted) → a costed choice → its rippling consequence, shown warm (she repays) and
  cold (she raids your cache and barricade). Reproduce it: `cd prototype/harness && npx tsx gen-slice.ts`.
- **The slice is genuinely playable, not a mockup:** determinism, save/load, and keyboard-only
  accessibility all hold under test (engine 348 · content-loader 9 · harness 47, all green).

### Verdict — to be recorded by the owner

| Field | Entry |
|-------|-------|
| Build | m3-part-4 (T39–T41), `m3-part-4-T39-T41.patch`; engine 348 · content-loader 9 · harness 47 green |
| Date | 2026-07-06 |
| Playtesters | Jharek (owner), 1 session, full slice via `npm run play:slice` |
| The retellable moment (or its absence) | **Half-there.** The *setup* landed and read as a story: searched Transit Plaza clean, claimed it as a base, fortified and stashed, crossed to the Corner Store, met Ruth (desperate, "ready to drop"), and on the way home **her plea fired on its own at the barricade** — an emergent "the starving shopkeeper I'd met followed me home and begged to be let in." But the *payoff broke*: at the plea only **Turn Ruth away** was offered — **Take Ruth in was silently absent**, with no reason given, so the story could not complete. |
| "One more day" test | Not reached — the arc's emotional choice didn't resolve, so the pull wasn't fairly tested. |
| **Decision** | **PASS — Session 3 (2026-07-06) → open M4.** Session 1's NO-GO was a single legibility defect; fixed (Session 2) and then the full loop was played to its close (Session 3) and delivered. See Session 3 below. |
| Notes / what to re-invest in | Make the "Take Ruth in" path **legible** (see Session 1 below): the option was gated on the cache holding ≥ `stashDraw` (2) units and only 1 was stashed, so it was withheld invisibly. Fix the arc's choice surfacing (T41), then re-play. |

### Session 1 — owner playtest, 2026-07-06 (NO-GO)

**What was played.** Full slice, `npm run play:slice`, from Transit Plaza: search ×3 to clean → *Make
this place your shelter* → *Fortify* → *Stash canned food* (once) → travel to the Corner Store → *Speak
with Ruth* → travel home. Ruth's plea fired at the barricade **on its own** on arrival — the emergent
setup the arc was designed to produce worked in live play.

**The flaw (root-caused).** At the plea the Scene offered **"Turn Ruth away"** but **not "Take Ruth in."**
Cause, confirmed against the engine: `storyChoices` offers *Take her in* only when the stash holds at
least `stashDraw = 2` units; exactly **1** canned food had been stashed, so the help branch was withheld —
**with nothing on screen explaining why.** So the one authored arc's climactic, emotional choice appeared
one-sided and broken, and the player (correctly) read it as a missing option. This is precisely the
`PL-M3-10 / L1` risk this log flagged as unproven — and it surfaced on the *first* real playthrough, which
is exactly what the Fun Gate is for.

**Why NO-GO but not a "content freeze."** The gate's fail-response is content-freeze *when the slice is
systemically flat*. That is **not** the failure here — the loop was engaging (searching to a full pack,
claiming and fortifying a base, banking a cache) and the arc's setup was legitimately emergent and
story-shaped. The failure is a **surfacing/legibility defect in T41** on a single, high-stakes choice.
The correct re-investment is small and targeted, and it *is* re-investing in the slice, per the rule.

**Re-investment before re-run (recommended).** Make the good branch impossible to miss, in priority order:
1. **Always offer "Take Ruth in."** If the cache can't cover `stashDraw`, don't hide it — either draw what
   the cache holds (help is help; a fuller cache simply helps *more*), or present a third honest beat
   ("you share what little you have" / "you have nothing to spare — you can only send her on").
2. **State the cost in words** at the plea (the plea line names that sheltering her draws on your cache),
   and **signal it earlier** — when you meet Ruth, or when you first stash, hint that a stocked base is
   what lets you take someone in — so the stash reads as *preparation for the choice*, not bookkeeping.
3. Re-play the slice and re-judge the "one more day" pull with the choice actually available.

**Standing:** M3 remains **active** (the gate is not passed). The systemic substrate is promising; the
block needs one legibility pass on the arc's fork before the gate can be fairly signed.

**Re-investment applied — 2026-07-06 (owner chose "keep the 2-unit rule, make it visible").** The arc's
`storyChoices`/gate is unchanged (taking Ruth in still needs `stashDraw = 2` cache units), but the plea now
**states the cost and the shortfall in words**: with a short cache it reads *"Sheltering her would take 2
from your cache, and you have 1. Stash 1 more and you can take her in,"* the offered take-in choice carries
its cost in the label, and a foreshadow line appears at the base once she is grinding toward the plea
(*"if she comes to your door, taking her in would mean sparing 2 from your cache; best keep some stashed"*).
So the option is never mysteriously absent — the requirement is legible and the objective is clear. Engine
349 (+1) + content-loader 9 + harness 47 green. **Re-run the gate (Session 2) with the choice now legible.**

### Session 2 & 3 — owner playtest, 2026-07-06 (PASS)

**Session 2 (fix confirmed).** With the requirement now legible, the plea read *"Sheltering her would take 2
from your cache, and you have 1. Stash 1 more and you can take her in."* The player stashed one more, the
line flipped to *"you have 2, enough to take her in,"* the labelled **Take Ruth in — shelter her (costs 2
from your cache)** appeared, and taking her in resolved to *"Ruth is resting under your roof, some colour
coming back to her,"* cache spent to bare. The Session-1 blocker is gone; the choice is never silently
missing.

**Session 3 (the full loop closed — PASS).** The decisive run, played all the way through. Same emergent
opening — the ~20 in-game hours spent searching, claiming, fortifying and stashing a base are hours Ruth
goes without, so she turns up desperate at the barricade on her own. Took her in (2 cache units), then
rested ~12h — and at **Day 2, 17:00** the arc **closed**: the cache refilled and the Scene read *"Ruth
slipped back at first light and left supplies in your cache — she remembered"* (repay = 2 food + 1 water,
now withdrawable). **A run became a story, end to end, from systems that were not hand-holding the player:
time → hunger → a survivor at your door → a costed choice paid from the cache you banked → a consequence
that pays you back.** That is the M3 thesis, witnessed by the owner.

**Verdict: PASS.** The systemic / retellable-moment bar is cleared. The across-run "one more day" durability
rests on content breadth the slice deliberately doesn't yet have — and deciding whether the foundation grips
*before* pouring that content is exactly this gate's job. It grips. **M3 is complete; per PRODUCTION §4 the
content schemas freeze for authoring and M4 (content-complete city) opens; the "systemic but not fun" risk
is retired.**

**Carried into M4 / M5 (the scope the pass unlocks — not blockers):**
1. **Choice weight.** A flush start (6 food) made the 2-unit cost light; the *emotional* weight (take in vs.
   turn away a desperate woman) carried it, but the *resource* trade didn't bite. Tune scarcity / `stashDraw`
   so the choice sometimes costs (the Survival-Triangle "no strategy escapes a trade").
2. **A played base defense on the good branch.** The narrated horde never arrives (`PL-M2-02` / `PL-M3-08`);
   a survived siege is M4's contested world.
3. **More arcs / subjects** for across-run variety (`PL-M3-09`) — the arc library, now unfrozen.
4. **Polish nit:** the repay prose *"slipped back at first light"* showed at 17:00 (evening) — a
   fixed-string / clock mismatch to align.


---

> The section below is the engineer's pre-play *provisional* read, kept for the record. Session 1 above
> supersedes it as the actual verdict; note the provisional read had already flagged this exact risk
> (help gated on the cache) as the L1 lever — the playtest confirmed it bites immediately.

---

## Provisional read (input only — NOT the verdict)

An honest code-and-content assessment of where the M3 slice stands against the two bars. This is a read of
the built slice, **not a substitute for the real-playtester "one more day" test** the gate requires.

### Where the slice earns "a run becomes a story"

- **The Ruth arc chains five systems into one causal sequence.** Meeting her (people/trust), the hours you
  spend fortifying a home (shelter/time) being the same hours she goes without (needs), her arrival
  *desperate at the base you chose* (the plea fires from the simulation, not a timer), spending the cache
  you banked to take her in (stash), and — days later — repayment or a raid (world consequence). That is a
  genuinely **retellable** shape: *"I turned the old shopkeeper away to save my rations, and two nights
  later she came back and tore the cache open and wrenched the barricade half off."* The transcript shows
  exactly that, both ways.
- **The consequence is legible in the world, not just a card.** After the cold branch the base narration
  itself changes — *"newly claimed and bare … the cache here is bare … torn into … barricade wrenched
  loose"* — so the payoff is felt through the same reactive-world seam the rest of M3 surfaces, in plain
  words (accessibility holds).
- **The setup is emergent even though the arc is authored.** Nothing forces the plea; it fires because the
  needs the world already drives crossed a threshold while you were busy. Two systems you weren't thinking
  about (her hunger, your time) collided into a story beat. That is the M3 thesis working.

### Where it is thin (the risks the gate should weigh)

- **One arc, one subject.** The slice tells *a* story well, but a second run tells the *same* story.
  Retellability *across* runs — the thing the "one more day" test really measures — is **unproven** by a
  single authored arc. This is deferred to M4 by design (the arc *library* is post-gate), but the gate's
  job is precisely to decide whether one arc + the systemic loop grips *before* that pour. Honest read:
  this is the **biggest open question** and it can only be answered by real play, not by me.
- **The resolution is more scripted than the setup.** The plea's fork is a clean binary (help/refuse) with
  a fixed delayed payoff. The emergence lives in *how you arrive* at the choice, less in *what follows* it.
- **The raid is narrated, not defended.** The cold consequence resolves off a rest as a stat-and-prose
  beat (cache + barricades), not a played, moment-to-moment defense of the shelter. The drama is inferred
  from the aftermath, not survived live (carried forward from the Part-3 QA note PL-M3-04; the live
  night-siege is still deferred).
- **The companion payoff is implicit.** Helping Ruth lifts her trust toward the recruit gate (T36), but the
  arc doesn't walk the player into recruiting her — the "she becomes your companion" beat is available but
  not surfaced as the arc's reward.

### First-pass dials the gate should probe (all in `src/sim/story.ts` / `src/sim/shelter.ts`)

`needThreshold 60` (does she arrive at the right desperation?), `delayHours 12` (does the consequence still
*connect* to the choice when it lands?), `stashDraw 2` / `raidUnits 3` / `barricadeHit 20` (do the costs
bite without feeling arbitrary?), `helpTrust +25` / `refuseTrust −35` (does the relationship shift feel
earned?), plus the Part-3 shelter dials (`CLAIM_COST`, `FORTIFY_*`) the P3 QA already flagged. These are
reasoned first-pass values, tuned against a real run at this gate.

### Provisional lean (explicitly not the verdict)

On the **systemic / retellable-moment bar**, the slice **demonstrably clears it** — it produces a
causally-linked, world-legible, retellable sequence from systems that weren't hand-holding the player.
On the **"one more day" / retellability-across-runs bar**, the evidence is **insufficient**: one authored
arc can't prove sustained pull, and that bar is defined to need real playtesters. **Recommendation:** run a
short real playtest (even 2–3 people, 2–3 sessions) focused on the "one more day" pull before signing;
expect the verdict to hinge on whether the loop-plus-one-arc grips without more content — because if it
needs more content to grip, the gate's own rule says that's a *fail*, not a shopping list.
