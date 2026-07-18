# M4 Part 11 — Adaptive audio + non-audio equivalents (T55 · "the world you can hear")

In a text-forward game **the soundtrack is the graphics** (AUDIO §1). Nine M4 parts built a city, a
shelter, an economy, companions, factions — a world with a lot going on just out of sight. T55 gives
the player the sense that *reads* that world: a standing **soundscape** rendered every turn, so a
distant shot, a nearing horde, a Screamer's shriek, the wrong quiet of late night, and your own heart
in your ears are all things you perceive and act on. And — the load-bearing half — it delivers that as
**text**, so the game is fully playable with sound off: not an accessibility retrofit, the primary
channel (AUDIO §11, FR-AUD-06 Must).

## What FR-AUD asks for

> **FR-AUD-01 (Should, MVP)** — Layered, state-driven adaptive mix (ambient / environmental / dynamic /
> player / music).
> **FR-AUD-02 (Should, MVP)** — Audio as information (noise direction/distance, zombie-type signatures,
> heartbeat with Fear).
> **FR-AUD-06 (Must, MVP)** — A non-audio equivalent for every meaningful sound cue.

The AUDIO bible fixes the shape: five adaptively-mixed layers (§3), a music theme + 0–4 intensity read
off the Director (§4.2), audio-as-mechanic for noise/zombies/body (§6), and the non-negotiable rule
that **audio is never the only channel** — every informational sound has a caption carrying its bearing
and distance (§11). The single sentence to honour: **the mix is a readout of the simulation, not a
playlist** (§1) — if a cue shows, some system put it there.

## The architecture: a client-side Audio Director, 100% harness, zero engine change

AUDIO §13 is unambiguous: **audio lives entirely in the client**; the deterministic core never makes
sound and never depends on it; audio is downstream and side-effect-only — it *reads* the Scene, never
writes `GameState`, and must not touch the seeded RNG or turn resolution, so **two clients with sound on
and off produce identical runs** (§13.3). Every fact the mix needs already exists in the engine's public
read API over the single `GameState` — node `noise`/`walkers`/`zombieTypes`/`zombieState`, the `hordes`
array, `world.weather`/`globalThreat`, the region threat, `mind.stress`, the infection stage,
`audibleSignals` — exactly the T54 situation. So T55 lives **entirely in the harness client**: one new
module `soundscape.ts` (the client-side Audio Director, AUDIO §13.2) plus a small render seam, and it
**touches no engine file, no schema, no content, no save rung, no RNG stream.**

That makes this the strongest byte-identity story the [[zurvival-ui-harness-only]] discipline can take,
for the second time after T54: not "gated dark behind a flag" (the T47–T53 idiom), but the determinism
surface is *never edited at all* — `diff -r prototype/engine/src` and `content/` against the pre-edit
baseline are **empty**, so every engine golden and the cross-tree `saveGame` proof hold by construction.
The soundscape is a pure `(state, graph) => Soundscape`; rendering it resolves no turn, spends no time,
and mutates nothing. A future Web Audio / FMOD client (AUDIO §13.4) swaps into the *same* seam: it reads
the same derived `Soundscape` and plays sound where the text client prints a caption.

## The five layers, as caption bands (AUDIO §3, Golden Rule §2.1)

The mix is assembled from the AUDIO bible's five layers; each becomes a band of the rendered soundscape,
and the **Golden Rule — when in doubt, take it out** — governs all of them: a band that carries nothing
this turn is silent. The default readout is sparse; a quiet turn is a couple of lines (bed + body), and
the informational cues surface loudly only when the world puts them there.

1. **Ambient bed** (§5) — region × phase × weather × interior/shelter, stacked into one atmospheric
   line: the ward's quiet, rain on the roof, the late-night wrongness. Weather is *informational*, not
   texture (§5.3): rain/fog "pull the detail back" (a masking note the player reads as *threat cues will
   arrive late*); the shelter has its own signed day/night tone (§5.4, §8).
2. **Environmental** (§6.7) — positioned one-shots read from node state: a dripping pipe, a flickering
   ballast, a fire's crackle (`region.fire`), the settling of a searched/damaged place, the creak of
   your own barricades. Tied to the node, sparse by nature.
3. **Dynamic — the informational layer** (§6.1/§6.2, **FR-AUD-02**). What the player learns to listen
   for: **noise by direction and distance** (a spike in a node's `noise` field, located by a
   breadth-first walk over the graph → `[a gunshot — near, toward the Corner Store]`); **zombie-type
   signatures** (each type's authored tell, §6.2 — a Rotter's wet drag, a Fresh's ragged sprint, a
   Crawler low and close, a Bloated's gurgle, the Riot's armor, and the **Screamer's shriek** = "the
   region just woke", a top-tier signature); **behavioural state reads** (`investigating` = a sound
   turning toward you, `chasing` = the bed tightening, `feeding` = occupied); the **horde collective
   bed** swelling as `state.hordes` near; and radio stingers (a station gone dark). This layer wins the
   mix (§10.2, information beats mood).
4. **Player body** (§6.4/§9, **FR-AUD-02**). The intimate layer, scaled by condition not the world:
   the **heartbeat** rises with Fear (the prototype's `mind.stress`, composited per §6.4 with threat
   proximity, darkness, wounds, and being in a fight); **breathing** ragged with fatigue/wounds; a
   **footstep-surface** tell (a Safety cost you can hear); and the **infection distortion** model (§9.2)
   surfaced by *stage*, deterministically and **fairly** — an Advanced player is told their hearing is
   no longer trustworthy (so a hallucinated cue can never masquerade as reliable information), Terminal
   strips the world to breath and heart.
5. **Music / tone** (§4, **FR-AUD-01**). The Director's read mapped to a theme word and an intensity in
   words — **survival / exploration / danger / loss / hope / home**, level 0–4 where **0 is silence**
   ("the quiet holds"). Never a number, never a track name; the tone is a *derived readout* (§13.1), the
   most duckable band, allowed to drop to nothing.

## Direction & distance in a graph world (FR-AUD-02, the text form of §11's positional captions)

The GUI contract carries a `bearing` in degrees (§13.1); the nodes here are a pure graph with no
coordinates, so the text client carries the **relational** bearing a player can actually act on:
distance by hop-count over the node graph (**here / close / near / far**, breadth-first, weather- and
phase-attenuated so rain and late night shorten earshot) and direction by the **named neighbour or
region** the source lies through (`toward the Corner Store`, `from the direction of the Waterfront`). In
prose this is clearer than a compass degree — `[a horde — near, toward the market]` tells you where to
*not* go. Perception only **describes**; it never flips a `discovered` flag or mutates the map (that
would be a state write) — you hear the horde before you see it (§6.2), and acting on it stays your
decision on the primary Scene.

## No number leaks, and the honesty rules

Consistent with FR-UI-02 and the T54 discipline: Fear/stress is a heartbeat in words, never the 0–100
int; infection is a symptom and a *stage-level* distortion, never `progression`; threat proximity is a
distance word, never the threat float; the music intensity is a mood word, never `2/4`. The unreliable-
audio model (§9.2) is surfaced as *the player being told they can't trust their hearing* rather than a
fabricated concrete threat, so it never hides required information unfairly — the fairness the AUDIO
bible makes non-negotiable (§9.2, §11).

## The seam

`soundscape.ts` exports the pure Audio Director — `describeSoundscape(state, graph) => Soundscape` (the
five layers) and `soundscapeCaptions(state, graph) => string[]` (their sparse text rendering) — plus the
per-layer builders and the small BFS/earshot helper, all reading only the engine's public selectors.
`play.ts` gains a **`soundscape` region** in the fixed navigable order, placed **after `status`, before
`story`** (you sense the world, then read the scene, then decide) — so every existing region-order
invariant still holds (header first, footer last, `Pack:` before the story, status before the prompt).
`renderRegions` / `renderScene` / `transcript` take an **optional `graph`** so the interactive CLIs and
the transcript pass it for full directional captions and pre-graph callers degrade gracefully to the
node-local bed/body (still deterministic). `playCli.ts` / `playSlice.ts` pass the graph they already
hold. The band is always ≥ 1 line (level-0 is a real, authored state — silence rendered), so the
accessibility region-presence invariant holds. No new key, no overlay: the soundscape is standing
information a deaf/HoH player must never have to *ask* for (FR-AUD-06), unlike the on-demand T54 screens.

## Determinism & byte-identity (by construction)

No engine/content/schema/save file is edited, so every engine suite (561), content-loader (9), the
schema gate (160 / 13), and the cross-tree `saveGame` proof are byte-identical **by construction** —
there is no gated system left dark because there is no new system in the core at all. Proven anyway (the
discipline): the engine + content trees diff **empty** against the pristine `zb.tgz` extract, and the
standard many-seed scripted-run `saveGame` comparison returns empty, raw, no normalization. The
soundscape itself is a total function of `(state, graph)` with no RNG and no clock, so rendering the same
turn twice is byte-identical and a screen key or a sound-off client changes no run.

## Test plan

- `harness/test/soundscape.test.ts` — the five layers over a rich hand-built state: the ambient bed
  reflects region/phase/weather/shelter; a positioned noise spike renders with **distance + direction**
  words (and re-locates when the source moves); each **zombie-type signature** shows its authored tell
  and the **Screamer** reads as the region waking; `investigating`/`chasing`/`feeding` state reads; an
  approaching **horde** swells by distance; the **heartbeat** scales up with composited Fear and down
  when safe, with **no stress/threat number** anywhere; **infection distortion** appears by stage
  (advanced/terminal) and is absent while healthy; the **tone** band words the theme + level-0 silence;
  the **Golden Rule** — a dead-quiet turn renders only bed + body, no threat lines; **zero ANSI**; and
  **determinism** (same state+graph ⇒ identical captions; rendering mutates nothing —
  `JSON.stringify(state)` unchanged).
- `harness/test/accessibility.test.ts` (extended) — the `soundscape` region is present and non-empty in
  every turn type and sits in the fixed order (after status, before story); with **sound off**, a turn
  with an audible threat still carries the danger *and* its direction in the text (the FR-AUD-06 proof);
  the region never leaks a number.
- Full CI green in a clean sandbox: engine typecheck+test (561), content-loader (9) + `validate`
  (160 / 13), harness typecheck+test, `npm start` smoke — the non-harness numbers **unchanged from
  M4P10** because nothing outside the harness moved.
- Byte-identity: `diff -r` of `prototype/engine/src` and `content/` vs the pristine baseline = empty;
  cross-tree `saveGame` many-seed diff = empty (belt-and-suspenders over the by-construction proof).

## Definition of done

Code + tests + this plan + `docs/qa/QA_REVIEW_M4_PART11.md` + `CHANGELOG.md`; `docs/status.json` T55 →
done with the completion note + refreshed banner + audit parking-lot items (under the concurrency
guard); Zurvival Mission Control snapshot refreshed; a verified `git format-patch` delivered; changed
files synced to the E: mount. Two-subagent adversarial audit — engineering (byte-identity / no engine
drift / non-mutation / no-crash over odd & corrupt states / no-number-leak) and design (FR-AUD-01/02/06
fidelity / every meaningful cue captioned / direction+distance legible / reachable+surfaced / fairness
of the unreliable-audio model / voice) — with a verify pass and all findings fixed.

## Parking lot / deferrals

- **Dynamic Audio Memory** (AUDIO §8, FR-AUD-05, Could/v1) — cues bound to formative events returning in
  dreams / on a Quiet Screen. It needs the FR-UI-06 Quiet Screen (already parked PL-M4-45) and a
  presentation-memory store; deferred (PL-M4-49).
- **Radio sonic identity per signal type** (AUDIO §6.6, FR-AUD-04, Could/v1) — the tuning/static grammar
  and the four broadcast timbres. The soundscape notes a station going dark (a §8 landmark) but the
  per-type sonic texture is a later block (PL-M4-50).
- **Accessibility audio settings** (AUDIO §11) — per-bus sliders, mono/mix-profiles, reduce-sudden-
  sounds, hearing-damage & infection-distortion toggles. In a text client the captions are always-on
  (you cannot mute the only channel); a caption-verbosity / reduce-startle toggle set belongs with the
  T56 accessibility settings surface (PL-M4-51).
- **Hearing-damage (tinnitus) as a played state** (AUDIO §6.4) — a close gunshot dropping the world into
  muffle+ring for a stretch, deaf to threat cues, is a *mechanic* (it touches what the player can
  perceive) and so an engine concern, not this pure-presentation pass; noted for a later combat-audio
  task (PL-M4-52).
- All caption **wording/ordering** is first-pass, tunable with the M5 comprehension playtests.
