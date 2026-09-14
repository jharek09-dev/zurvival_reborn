# 0007 — The player has no health stat; wounds are the health model

- **Status:** accepted
- **Date:** 2026-09-13 (accepted 2026-09-13 by Jharek)

## Context

Raised as **PL-M5-01** by the 2026-09-12 design review and flagged there as *the* open design question
of M5, to be settled **before T82** because T82 cannot be built without an answer.

The build and the GDD disagree with each other, and neither disagreement is written down anywhere:

- **What is built.** `CharacterState` is `{needs, wounds, infection, mind}`. The only `hp` in the
  entire codebase belongs to the enemy (`CombatState.hp`). `runEndReason` returned exactly three
  values — `starved | dehydrated | infection`. **A zombie could not kill you.** A fight cost
  resources, hours and mobility, and never the run. Measured before T82 over 400 paired duels a cell:
  a bare-handed player beat a **Riot** — the hardest body in the game, 5 hp and armor — **100% of the
  time**, at a cost of 99.5% wounded and 88.8% bitten. Combat was a wound-severity slot machine you
  always walked away from.
- **What the GDD says, twice, in opposite directions.** Principle 2 and Part VI are unambiguous that
  *"a hit never reads as −10 HP"* and that damage is *"a condition with a name and a consequence"*.
  But Part V's **Core stats** list opens with *"**Health** — physical survival; 0 = death"*, and
  Part IX makes the **Last Stand** *"canonical, not optional"*.

The contradiction is not academic. The Last Stand is *structurally impossible* rather than merely
unbuilt: a game where nothing can kill you in a fight has nowhere to put a death scene. So the answer
decides whether T82 adds a stat or adds a situation.

## Options considered

**(a) Add a real Health stat.** A 0–100 value in `CharacterState`, drained by attacks and untreated
wounds, restored by treatment and rest. Honours the Core stats list literally and makes the Last
Stand trivial to trigger. Rejected: it costs a save-schema rung and a re-baseline of every combat
number, and — decisively — it puts a **second damage currency** alongside the wound table. The wound
table *is* Principle 2 made mechanical (a sprain slows travel, a deep cut lays a scent trail, a bite
starts the infection clock). A parallel bar that also counts damage makes the named wound decorative,
which is the exact failure both Principle 2 and the whole of Part VI were written to prevent.

**(b) A lethal `critical` wound tier.** No number, but wounds gain a severity that kills if untreated
within N hours. Keeps damage named. Rejected as duplicative: the game already *has* a "you are dying
and can still act" system with a hidden clock, staged symptoms, a cure race and a delayed collapse —
the infection track (T22/T49). A second one would compete with it for the same dramatic space.

**(c) No health stat; wounds are the model.** Accepted. Below.

## Decision

**The player has no health stat, and will not get one. `woundBurden` — the summed untreated remainder
of the named wounds on the body — is the health model, and it is never shown as a number.**

The GDD's *"Health — 0 = death"* line is **superseded** by Principle 2 and Part VI for all purposes.
It should be read as a statement that physical damage can end a run, which remains true, and not as a
specification of a stat.

Death in combat is therefore a **situation, not a threshold**. `runEndReason` gains a fourth value,
`lastStand`, which is true when *all* of:

1. there is a live fight (`combat !== null`),
2. the dead have **hold of you** (`combat.grabbed` — T82's GRABBED outcome, which is also what
   withholds every retreat option), and
3. the body is carrying `woundBurden >= LAST_STAND_AT`.

All three are already in `GameState`, so the reason stays **derived** — there is no stored death
flag, and save v10 holds with no migration rung.

The conjunction is the whole decision. Condition 3 alone would be a health bar wearing a different
name, and a bad one: measured on the pre-T82 tree, burden ≥ 80 is true on **59.3% of all combat turns**
and 33 of 40 runs reach it, because wounds accumulate monotonically and only treatment removes them.
On its own it would be a second infection timer. Paired with 1 and 2 it is a moment: *held, hurt, and
out of the ways out.*

## Consequences

**Easier.**

- Every death has a **name and a cause the player can point at** — the bite on the forearm, the
  fracture, the hands that would not let go — which is Part VI's design rule 4 holding at the moment
  it matters most.
- The Last Stand becomes buildable, so **T62 has a trigger to author its scene against**.
- **Treating wounds becomes a survival decision rather than housekeeping.** Burden is the one conjunct
  the player controls, so a bandage is what keeps you from ever *entering* a Last Stand. Note the
  precise claim: it does not buy you *out* of one — `treat` is not offered inside a fight, and the
  condition is fatal on the frame it is created, so there is no moment at which a bandage can be
  reached. See the second bullet under **Harder**.
- **Avoidance becomes a measurable skill.** Measured over 120 bot runs a policy: a bot that fights
  everything and never retreats ends **64%** of its runs in a Last Stand; one that disengages once it
  is carrying real damage ends **8%** of them that way; one with three trusted companions beside it,
  **6%**. Before T82 all three numbers were 0% and there was nothing to be skilful about. The
  eightfold gap between the first two is the decision the threshold is priced to create — and the fact
  that the careful number is not *zero* is deliberate: an earlier setting made a careful player
  absolutely immune, which would have made the canonical death scene unreachable.
- No save rung, no new stat to display, and the UI stays clean — which is what the Core stats section
  was actually protecting.

**Harder.**

- **FR-CBT-05's "you always get out" is narrowed, deliberately and visibly.** The guarantee now reads:
  a player who has not entered a fight can always slip past — `slip` is offered at every contested
  node, untouched. A player who *is* in a fight and has been grabbed cannot walk away until they are
  loose. A stealth-only survivor can still cross the whole city without one option ever being
  withheld.
- Combat lethality is now a real dial with no obvious right setting, and it interacts with weapons
  (T80/T81), detection (T77) and the director (T78). `LAST_STAND_AT` is **80**, set by measurement
  and swept in `prototype/harness/measure/t82.ts`.
- **It is an ENDING, not yet a STAND, and the name currently overstates it.** `runEndReason` is read
  before any choice is offered, so the blow that completes the condition ends the run on the same
  frame. The player gets no final turn, no last set of choices, and nothing to spend — which is
  precisely what GDD IX asks a Last Stand to be. What T82 delivers is the *trigger*, plus one line of
  placeholder prose; the heightened sequence ("hold the door so a companion gets out, say the thing
  you never said") is **T62's** to author, and `endingNarration("lastStand")` is the only branch in
  that function expected to be replaced rather than kept. Tracked as PL-M5-44.
- **The grab prices melee and leaves firearms untouched**, which widens PL-M5-38 rather than narrowing
  it: a shot fired point-blank at something holding you is exactly as accurate and as damaging as any
  other shot, so an armed player's only cost for the grab is the lost retreat. T59/T60's to settle.
- `LAST_STAND_AT` is a flat number across every difficulty mode, which is almost certainly wrong for
  Story and for Ironman (PL-M5-45).
- Anyone reading Part V's Core stats list will still see "Health — 0 = death". This ADR is the
  reconciliation; the GDD is not being rewritten.
