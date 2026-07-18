# QA Review — M4 Part 11 (T55 · Adaptive audio + non-audio equivalents)

**Scope:** FR-AUD-01 (layered, state-driven adaptive mix), FR-AUD-02 (audio as information —
noise direction/distance, zombie-type signatures, heartbeat with Fear), FR-AUD-06 (Must — a
non-audio equivalent for every meaningful sound cue). Delivered as a text **soundscape**: the
AUDIO bible's client-side Audio Director (§13.2) rendered as always-on sound-captions.

**Verdict:** ✅ Ship. Zero BLOCKERs. Two-subagent adversarial audit + a verify pass on each; all
findings fixed and re-verified. Byte-identity holds **by construction** (engine + content trees
zero-diff). The game is genuinely playable with sound off.

## Architecture verified

100% harness-client, **zero engine change** — a new `prototype/harness/src/soundscape.ts` plus a
`soundscape` region in `play.ts` and the graph threaded through `renderRegions`/`renderScene`/
`transcript` and the two CLIs. No engine file, no content, no schema, no save rung, no RNG stream is
touched. The soundscape is a pure `(state, graph) => Soundscape` over the engine's existing public
read API (node noise/walkers/zombieTypes/zombieState, the hordes array, weather/threat, `mind.stress`,
infection stage). This is the T54 shape — the determinism surface is *never edited at all*.

The five AUDIO layers (§3) render as sparse caption bands governed by the Golden Rule (§2.1): ambient
bed (region × phase × weather × shelter), environmental one-shots (fire/dead/barricades/grid), the
**dynamic/informational** layer (positioned noise by direction+distance over a BFS earshot, the seven
zombie-type signatures, behavioural state reads, the horde collective bed), the **player body**
(heartbeat scaled by composited Fear, breath, footstep-surface, infection distortion by stage), and
the **music/tone** read (a theme word + 0–4 intensity, level-0 = silence). Direction is fair-to-fog
(a bearing is named only through a discovered neighbour); distance is a word (here/close/near/in the
distance). No number ever leaks; the unreliable-audio model tells the player their hearing can't be
trusted rather than fabricating a concrete cue (fair per §9.2/§11).

## CI (clean cloud sandbox)

- engine typecheck + test — **561 pass (+0, untouched)**
- content-loader typecheck + test — **9 pass**; schema gate `validate` — **160 entries / 13 types**
- harness typecheck + test — **170 pass (+33)** (`soundscape.test.ts` +30, `accessibility.test.ts` +3)
- harness `npm start` empty-turn smoke — determinism ✓, save round-trip ✓, exit 0
- **Byte-identity:** `diff -r prototype/engine/src` and `diff -r content` vs the pristine pre-edit
  `zb-m4p11.tgz` extract are **both empty** — the strongest proof (per [[zurvival-ui-harness-only]]),
  stronger than a sampled scripted run because the determinism surface is literally unchanged.

## Adversarial audit — two subagents, each with a verify pass

### Engineering lens (determinism / purity / byte-identity / crash-safety / no-leak)

The sacred claims were **proven, not asserted**: purity (a deep-frozen state + graph renders without a
write; `JSON.stringify(state)` byte-identical before/after; `state.rng` untouched); no RNG / no clock;
determinism under object-key iteration order (reversed node/region/horde keys + reversed adjacency →
identical captions); **no number leak and no forbidden token** (`threat|progression|powerGrid|
globalThreat|zombieDensity`) across an **882,000-state matrix**, 0 hits each; crash-safe across every
in-contract odd/corrupt state (missing player node, empty nodes, off-graph horde, dangling edge, huge/
negative stats, run-over, no-graph). Two findings, both fixed and re-verified:

- **MEDIUM — the `.slice(0,8)` cap was not urgency-aware, and Fear/tone read the post-cap list.** With
  more than one audible horde, the single most-urgent cue (a chase, "the dead are on you") could be
  dropped, and the derived Fear/tone could be silently muted. **Fixed:** the dynamic layer is now
  structured `Cue { text, urgency, proximity }`; `renderCues` sorts by urgency (stable) before the cap,
  so an urgent cue is never dropped, and `fearBand`/`buildTone` read the **full pre-cap** cue set.
  Re-verified: chase + 8 hordes → chase survives + heartbeat "loud" + danger L3; an on-you horde whose
  id sorts last still survives + panic + L4.
- **LOW — not crash-proof against undefined `zombieTypes`/`hordes`** (out-of-contract). **Fixed:** `?? []`
  guards at every access site. Re-verified: those malformed states no longer throw.

### Design lens (FR-AUD-01/02/06 fidelity / reachable+surfaced / fairness / voice)

The feature is structurally complete and playable sound-off — all five layers render, every simulated
cue has a text equivalent, the seven zombie signatures fire from real content and are faithful to §6.2,
direction/distance is legible, and the unreliable-audio model is fair. Five findings, all fixed and
re-verified (contradiction sweep after the fixes = **0**):

- **HIGH — the heartbeat under-read danger** ("steady" during a chase, an active fight, and a 30-horde
  on your tile; `fearBand` never read the hordes and its danger weight fell below the band-1 threshold).
  **Fixed:** `fearBand` now reads the real danger — the nearest threat's continuous proximity
  (`round(60·dangerProximity)`), an active fight (+35, floored so a fight is never below "loud"), a
  horde on your own tile (+25), plus night/wound/surrounded/ambient-dread. Re-verified via real turns: a
  daytime chase → "heart loud", a fight → never "steady", a horde on you → panic.
- **HIGH — the Danger theme was binary-pinned at Level 4** ("nowhere left to hide") for any acute cue,
  including a lone screamer three hops away. **Fixed:** proximity is continuous; Danger builds 2→3 with
  distance and L4 is reserved for a threat on top of you or a desperate fight. Re-verified: a 2-walker
  chase reads L3; an approaching horde builds; only an on-you horde/last stand hits L4.
- **MEDIUM — "You've made noise here" misattributed external node noise** (a Screamer's cascade) to the
  player. **Fixed:** reframed to "It's loud here right now — the kind of loud that pulls things toward
  you" — honest about the *place*, never blaming the player. (This is also the correct §6.1 dual read.)
- **LOW — a horde on your node dropped its size** (hard-coded "a mass"). **Fixed:** `[the dead are on
  you — {a handful / a pack / a great mass} of them, right here]`.
- **LOW — the own-node collective moan double-stated** a threat already read as investigating/chasing/
  feeding. **Fixed:** the moan is suppressed on a roused/feeding node.

Both verify passes confirmed the fixes are correct and complete with no new regression: the heartbeat
and the music can no longer contradict on the same turn (the danger branch structurally forces
`fearBand` ≥ "loud"), the mix is internally consistent, fairness of the unreliable-audio model still
holds, and no over-read was introduced (quiet/ambient turns stay "steady", a quiet turn is 3 lines).

## Non-defect notes

- A *distant* Screamer shriek now reads as survival-tone (correct — it's distant); its signature
  meaning is still carried by the always-first "[a shriek splits the air — …] — the whole area just
  woke" cue, and the heartbeat is never below "pulse" while a shriek is audible.
- `fearBand` is evaluated twice per render (once in `buildBody`, once in `buildTone`) — pure redundant
  work, zero correctness/purity impact; a later micro-optimization at most.

## Files

New: `prototype/harness/src/soundscape.ts`, `prototype/harness/test/soundscape.test.ts`,
`docs/plans/M4_PART11_PLAN.md`, `docs/qa/QA_REVIEW_M4_PART11.md`. Changed: `prototype/harness/src/{play,
playCli,playSlice,index}.ts` (the `soundscape` region + optional graph seam), `prototype/harness/
gen-slice.ts` (passes the graph), `prototype/harness/test/accessibility.test.ts` (the FR-AUD-06 proof).
**NO engine/content/schema change; save schema stays v10; the 14-stage pipeline is untouched.**

## Parking lot / deferrals

- **PL-M4-49** — Dynamic Audio Memory (AUDIO §8, FR-AUD-05): cues bound to formative events returning
  in dreams / on a Quiet Screen; needs the FR-UI-06 Quiet Screen (PL-M4-45) + a presentation-memory store.
- **PL-M4-50** — Radio sonic identity per signal type (AUDIO §6.6, FR-AUD-04): the tuning/static grammar
  and the four broadcast timbres (the radio's non-audio equivalent already exists as the T50 digest).
- **PL-M4-51** — Accessibility audio settings (AUDIO §11): caption-verbosity / reduce-startle toggles,
  and the eventual per-bus/mono/mix-profile controls, belong with the T56 accessibility settings surface.
- **PL-M4-52** — Hearing-damage (tinnitus) as a *played* state (AUDIO §6.4): a mechanic (it changes what
  the player can perceive), so an engine concern for a later combat-audio task, not this presentation pass.
- Distinguishing the player's own gunshot as a discrete louder cue (§6.1/§6.3) is a fidelity win noted
  for a later combat-audio pass; the information (a loud node draws things) is already carried.
- All caption wording/ordering is first-pass, tunable at the M5 comprehension playtests.
