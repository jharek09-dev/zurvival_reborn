# QA Review — M4 Part 10 (T54): Depth screens

**Requirement:** FR-UI-04 (Must, MVP) — "Depth screens on demand: inventory, companions, shelter, map/journal,
codex." · GDD Part XVII "Information on demand" · design/wireframes.html SCR-03..07.
**Result:** five purpose-built, read-only depth screens in the **harness client** (`prototype/harness/src/screens.ts`
+ seams in `play.ts`/`playCli.ts`/`playSlice.ts`). **Zero engine/content/schema change**, so byte-identity holds by
construction (the determinism surface is literally unedited). CI green (engine 561, content-loader 9, harness 137,
schema gate 160/13, malformed rejected, smoke exit 0). Save schema stays v10; 14-stage pipeline untouched.

## What shipped

- **Inventory (SCR-03, key `I`).** Pack weight in words (room to spare / heavy / full-leave-behind), items grouped by
  category (medical / food & water / weapons / materials / other), **artifacts** with provenance drawn from the
  instance metadata — gated on *real* provenance so a plain durability item isn't mislabelled — and the economy's
  freshness clock + learned recipes when live. "No level here" — growth is the pack.
- **Companions (SCR-04, key `C`).** "N with you · M at home · K/PARTY_CAP", per companion: condition (needs in words,
  worst wound named, infection a **symptom never a number**), mood + **trust as a tier word** (not the 0–100 scalar),
  and standing orders **read from the engine's own `companionOrderChoices`** so the screen shows only what the engine
  will accept — the active order stated, the withheld ones **locked with the real gate in words** (scavenge needs
  trust AND a base; guard needs trust).
- **Shelter (SCR-05, key `B`).** Walls / morale / stores in words (never a bar), built rooms vs. the **actually-unbuilt**
  room recipes under "could build", who's home + their assigned job + the jobs the built rooms allow, and a **persisted
  daily report scanned from the append-only Living History** (shelter-weakened/fortified, desertion/betrayal, deaths) —
  what your absence cost, surfaced on demand.
- **Map & Journal (SCR-06, key `M`).** Fog percentage, here/home, every known node with its memory (searched-state,
  walkers, discoveries), the player's **handwritten notes**, the fog edge (unknown ways out), and recent auto-annotated
  history.
- **Codex (SCR-07, key `L`).** Lore; the **radio gated on carrying a radio** (label/type + a readable status-plus-
  reception phrase); rumors (leads confided, mysteries); the **memorial** — the dead (`†`) and the departed (`↳`) by
  name and by *how*, from the history; and the run's moral shape felt, not counted.
- **Seam & accessibility.** A `{kind:"screen"}` `Command` variant; `parseCommand` routes one mnemonic key per screen
  (`I C B M L`, none colliding with the reserved `S`/`Q` or digits); the persistent **footer advertises every key**
  (nothing missable); the interactive/slice loops render a screen then redraw the scene with **no `applyAction`** — a
  free overlay. `playByInputs` records opened screens in a new `screensViewed` list and resolves no turn for them.

## Verification

- **Full CI green** in a clean cloud sandbox (fresh `npm install` × 3): engine typecheck + **561** (unchanged —
  untouched), content-loader typecheck + **9**, harness typecheck + **137**, `npm start` smoke exit 0, schema gate
  **160 entries / 13 types**, malformed content rejected.
- **Byte-identity by construction (the load-bearing guarantee).** `diff -r prototype/engine/src` against the pre-edit
  baseline (extracted from `.sandbox/zb-m4p10.tgz`) is **empty**; `content/` and `content-loader/src` likewise. Only
  harness files + docs changed. The engine that produces every save is byte-identical, so the cross-tree `saveGame`
  proof is satisfied definitionally (a stronger statement than any sampled scripted-run comparison).
- **Non-mutation / free overlay.** Rendering all five screens never changes `JSON.stringify(state)` (verified on a
  played run and on a deep-frozen `structuredClone`); a screen key mid-play adds no turn and the transcript is
  byte-identical with or without screen keys inserted; `playByInputs([...SCREEN_KEYS,"1"])` resolves exactly one turn.
- **`screens.test.ts` (24 tests):** registry + distinct non-reserved keys; `parseCommand` routes every screen key
  (and leaves choice/save/quit/invalid intact); each screen's stable frame + zero ANSI over a rich state; **no number
  leaks** (infection symptom not the progression, trust tier not the scalar); free-overlay non-mutation; and each
  screen's purpose-built facts, including three regression guards for the audit fixes (no dead "ask" affordance;
  scavenge base-locked when trusted-but-baseless; "could build" excludes built rooms).
- **`accessibility.test.ts` (+2):** the footer advertises every screen key; all five keys open a screen while
  resolving no turn (extends the T20 NFR-ACC baseline).

## Adversarial audit → fixes applied (two subagents, each with a follow-up verify pass)

An engineering lens (engine zero-drift / non-mutation / no-crash over degenerate & extreme states) and a design lens
(FR-UI-04 fidelity / no-number-leak / **reachable AND surfaced in real play** / voice). **0 BLOCKERs; 7 findings, all
fixed and re-verified end to end:**

1. **[design, HIGH] Companions "ask them" was a dead affordance.** The teaser promised asking a companion to reveal a
   lead, but the engine's `ask` verb reads met NPCs (`state.npcs`), not companions (`state.actors`) — and the told-flag
   key was wrong. **Fix:** removed the teaser from the companions screen; leads remain an NPC-encounter mechanic on the
   primary Scene. (Companion-lead surfacing parked, PL-M4-46.)
2. **[design, HIGH] Shelter "Could build" listed already-built rooms.** It was sourced from `buildableJobs`, which
   returns jobs whose room *is* built. **Fix:** "Could build" now lists the unbuilt `installsRoom` recipes; `buildableJobs`
   is correctly shown under Jobs as "jobs your rooms allow".
3. **[design, MED] Scavenge order shown available with no base.** `orderReadout` re-derived only the trust gate.
   **Fix:** it now derives the offered set from the engine's `companionOrderChoices` and words the real gate ("needs a
   base to scavenge for" vs "needs their trust").
4. **[design, MED] Shelter daily report never persisted.** It relied on the this-turn `jobLine`. **Fix:** "Recent at
   the base" now scans the append-only history (shelter/social/death beats).
5. **[design, LOW] Codex humanity line** had a double period and a wrong "they would say" frame over a second-person
   band. **Fix:** the band sentence stands alone.
6. **[design, LOW bundle]** "food fresh" → "fresh food"; the `[artifact]` tag now gated on real provenance (a plain
   worn pistol isn't an artifact); memorial names capitalized; the companions footer no longer says "Talk".
7. **[engineering, MED/LOW] Defensive guards.** `renderMap`/`historyLine`/`renderCodex` now tolerate a hand-built or
   corrupted state missing `node.playerNotes`/`discoveries`/`HistoryEvent.subjects` (`?? []`) — consistent with
   `renderShelter`. (Unreachable via normal play or an engine-written save; fixed for robustness and consistency.)

Both subagents re-ran their real-engine scenarios after the fixes and confirmed: engine still zero-diff, harness
137/137, no number leaks, and **FR-UI-04 genuinely delivered — every screen truthful about what the engine will do in
that context (reachable + surfaced), not merely test-passing.**

## Parking lot / deferrals

- **PL-M4-45** — FR-UI-06 emotional UI + the "Quiet Screen" (SCR-08): the loss-moment UI strip-back and state-degraded
  rendering, distinct from the depth screens.
- **PL-M4-46** — in-screen actions / sub-navigation (equip off the inventory screen, etc.). T54 keeps the decision on
  the primary Scene per FR-UI-01 and points to the actions.
- **PL-M4-47** — a real lore/rumor content set for the codex (it renders whatever `story.lore`/mysteries exist).
- **PL-M4-48** — surfacing a companion's authored knowledge post-recruitment (the `ask` verb is NPC-only today; a
  companion's leads aren't reachable once they join — a small engine feature, deferred).
- Screen wording/ordering is first-pass, tuned at the M5 comprehension playtests; the shelter/map "recent" lines
  lowercase names while the codex memorial capitalizes them (cosmetic, M5 wording pass).
