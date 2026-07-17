# M4 Part 6 — The radio network (T50 · "the world speaking quietly")

**Milestone:** M4 (Content-complete city) · **Task:** T50 · **Requirements:** FR-STY-03 (Should, MVP —
the radio network), touching FR-STY-04 (Could/v1 — player broadcasting) as the SCR-09 "reveal yourself"
first-pass. GDD Part XIII "The radio network"; the M4 wireframe **SCR-09** (Steel owns the screen;
signals age, decay, go silent; listening cheap, broadcasting a first-class risk; one reserved anomaly).
**Depends on:** T14 (the noise model — broadcasting deposits region-scale noise via the `params.noise`
override, exactly like a firearm), T26 (hordes re-path to fresh noise — the real teeth of a broadcast),
T17 (loot tables — where the radio is found), T31 (Living History — radio beats), T47 (the content-pool-
on-the-graph registration idiom this mirrors), T5 (named-stream RNG — a lazy `radio` stream for the
broadcast's hidden audience), T24/T27/T28/T30 (the world state signals are *read from* to evolve).

## What FR-STY-03 asks for

The radio is "the game's window onto the wider world and its main deliberate story channel — a real,
evolving system, not a cutscene dispenser" (GDD XIII). Five signal families —

- **emergency** — automated, decaying official messages; the sound of the old world running down;
- **military** — evac points, checkpoints, warnings; often already fallen by the time you arrive;
- **civilian / ham** — real people with needs, information, and lies; some go silent mid-sentence;
- **automated / unknown** — a number station, a looping recording, *something that shouldn't still be
  transmitting*.

— that **evolve with world state** ("a station goes dark when its region falls; a new signal appears
after a global event"). SCR-09 adds the felt texture: signals **age** ("first heard Day 3, unchanged
since"), **decay** to a flat DEAD-AIR row that stays listed (the silence is content), **listening** is a
cheap tap, **broadcasting** is a blood-edged choice with an *unknown audience* ("NOISE ++ · WHO HEARS?"),
and exactly **one anomaly** breaks the screen's rules — *nothing else ever does*.

## The one design call worth flagging: signals are **derived**, not stored

The whole system is built so a signal's live/faint/dead status and which message it's playing is a **pure
function of world + region + day state** (plus a stateless hash for eerie jitter). Nothing about a
signal's *condition* is serialized. Consequences:

- **Signals evolve for free.** The world already drifts every turn (region threat rises — T24/T30, power
  fails — T27, night falls — T28). Because a signal reads *from* that state, "the military evac station
  goes dark when its region falls" and "the emergency loop dies when the grid drops" happen with **no
  radio sim-layer and no per-signal bookkeeping** — the pipeline and the 14-stage order are untouched.
- **Save-lossless by construction, and no save-schema rung (stays v9).** Nothing is added to the state
  *shape*. What the player accumulates rides shapes that already exist: **`history`** (append-only
  `radio.tuned` / `radio.heard` / `radio.broadcast` beats — this *is* the "first heard Day 3" aging
  record and the future Journal's channel list), **`NodeState.noise`** (a broadcast's deposit),
  **`rng.streams`** (a lazily-seeded `radio` stream, drawn *only* by a broadcast — like T48's `encounter`
  / T49's `infection`), **`world.flags`** (nothing latched today; the anomaly's once-per-run is read from
  history), and **inventory** (`item.radio`). `World.broadcasts` (the reserved `ContentId[]`) is left
  **inert** — writing a derived value into it each turn would break byte-identity for prior goldens; the
  derived model doesn't need it. Consistent with T47/T48's "ride reserved-and-inert shapes."

## Signals are content (`content/radio/*.json`), interpreted generically

Faithful to the milestone theme ("all content schema-validated in CI") and GDD XV ("radio scripts live as
data files"), a signal is authored JSON and the engine ships a **generic interpreter** — no hard-coded
per-signal branching, exactly the T47 encounter pattern. The pool rides the transient `RegionGraph`
(`graph.signals`, mirroring `graph.encounters`), so a graph built without it leaves the whole system
**inert** and every prior run byte-identical. New content type **`content/radio/`** +
**`content/schemas/radio.schema.json`** take the schema gate **9 → 10 types**.

A `SignalDef` carries: `id`, `signalType` (emergency/military/civilian/ham/unknown), `channel` (the
"CH 7"), `label` (the who), `onsetDay` (for aging), an optional `regionId` (the region whose fate drives
it), `reach` (`citywide` | `local` — citywide is audible anywhere; local only in/next to its region),
`decays`, an optional `onsetThreat` (a signal that only *appears* once `globalThreat ≥ X` — "a new signal
after a global event"), an `anomaly` flag, and a set of **status-keyed message variants** (`live` /
`failing` / `dead`, plus the number-station's `faint`). The engine picks the variant from the derived
status; it never invents prose.

## Derived status — `signalStatus(state, def)` → `live | faint | dead`

Pure, per family, reading real world/region state:

| Family | live while… | shifts / dies when… |
| --- | --- | --- |
| `emergency` | the grid holds (`world.powerGrid ≥ POWER_DEAD_AT`) | grid fails ⇒ **dead** (the loop stops) |
| `military` | its region stands (`region.threat < REGION_FALL_AT`) | region threat crosses a **failing** band, then **falls** ⇒ dead ("goes dark when its region falls") |
| `civilian` | its region isn't overrun | region threat past a higher line ⇒ **dead** ("went quiet mid-sentence") |
| `ham` | its region isn't overrun | as civilian; a real person relaying a lead |
| `unknown` (numbers) | always transmitting | **faint** by day, **live** at night — steady, eerie, never changes |
| `unknown` (anomaly) | only when the rare gate holds | otherwise **absent** (not merely dead) |

**Reach / faint:** a `local` signal read from outside its region (or from a neighbour) is **faint**; the
number station is faint by day. Faint vs live is honest signal strength, all in words.

**Aging** is derived from `onsetDay` vs the current day ("a recorded loop, three days old / running
since Day 1"), not from any stored player timestamp.

## The seam — `radioChoices` / `isRadioAction` / `resolveRadioAction` / `radioLine`

Mirrors `infectionChoices` exactly; gated on **carrying `item.radio`** (a scavenged hand-crank/transistor
receiver, added to the `store`/`residential`/`industrial` loot tables so it is findable). Offered in the
explore branch only — a fight / active encounter / loitering walkers pre-empt it — so it never shadows a
danger prompt. **Inert unless the player carries a radio**, so every prior run keeps the identical choice
list and is byte-identical.

- **`listen-radio`** (`LISTEN_COST` 1h) — tune in. A real, priced turn (needs drift + a `radio.tuned`
  beat ⇒ passes the FR-CORE-04 no-no-op audit). Surfaces the on-air **digest** this turn (re-derived, so
  it reflects the world *now*); logs a `radio.heard` beat the first time each audible signal is heard.
- **`broadcast`** (`BROADCAST_COST` 1h) — "reveal yourself." Carries `params.noise = BROADCAST_NOISE`
  (70 — between melee 15 and a gunshot 75), so stage 6 deposits region-scale noise at the player's node
  and the T26 hordes **re-path toward it**: a genuine, mechanical "the dead heard you." The **audience is
  unknown** — one draw on the `radio` stream picks a seeded, hidden-outcome flavour (silence / a far
  reply that fades / something closer turning toward the sound); it is a *hint*, never a spawn. Logs a
  `radio.broadcast` beat carrying the outcome so `radioLine` surfaces it honestly this turn.

**`radioLine(state, graph)`** contributes to `sceneOf` narration **only on a radio turn** (a `radio.*`
beat exists for `state.meta.turn` — the same this-turn scan `infectionOutcomeLine` uses), so the radio
never clutters an ordinary scene. On a listen it renders the Steel digest — one screen-reader-safe line
per audible signal (`[MILITARY · CH 7] "…evac at gate C…" — a recorded loop, three days old` /
`[CH 3] dead air — it went quiet`); on a broadcast, the "you put your voice into the dark… who heard?"
line plus the seeded outcome. All words, no glyph-only meaning, **no dial internals or raw numbers**
(NFR-ACC-01 / FR-UI-02).

## The reserved anomaly (SCR-09 "one anomaly… nothing else ever does")

One authored `radio.anomaly` signal (family `unknown`, `anomaly: true`), audible **only** when a rare
derived gate holds — `globalThreat ≥ ANOMALY_THREAT` (85) **and** night **and** not already heard this
run (a prior `radio.anomaly` beat suppresses it). It breaks the format exactly once: no channel number,
it addresses the listener directly, an impossible timestamp. Everything else obeys the rules.

## Save schema — no rung (stays v9)

Argued above: derived status + append-only history + existing noise/rng/inventory/flags. Old saves load
and behave identically; a run with no radio never touches the `radio` stream. Consistent with
T37/T38/T40/T47/T48.

## Test plan

- **Engine** (`sim/radio.test.ts`): status derivation per family as world state moves (a military signal
  read **live → failing → dead** as its region's threat climbs; the emergency loop dying as the grid
  drops; the number station **faint by day / live at night**); reach (local vs citywide, faint from a
  neighbour); `audibleSignals` ordering + onsetThreat gating; the anomaly gate (silent below threshold /
  by day / after first hearing); **listen** logs a beat + is a resolved change; **broadcast** deposits
  `BROADCAST_NOISE` at the node and draws the `radio` stream (same seed ⇒ same outcome; **only** the
  `radio` stream advances); **inert without `item.radio`** — `radioChoices` empty, `radioLine` null, and
  a run's turns byte-identical to the pre-radio engine; save-lossless across a broadcast; determinism
  (a render never advances rng — `radioLine`/`signalStatus` are pure).
- **Harness** (`radio.test.ts`): the shipped `content/radio/` loads and interprets; a **legibility gate**
  — the digest is all words, carries the channel/label/age, and **never shows a raw dial or number the
  design forbids**; a **shipped-content play beat** — find a radio → listen → read the network → drive
  the world until a station **falls** → listen again and see it gone to dead air → **broadcast** and see
  node noise jump (and a horde take notice); the **anomaly** surfaces once under its gate and not before.
- **content-loader**: the schema gate auto-counts the new type (**10 types**); a negative test that a
  malformed signal is rejected (rides the existing malformed-content gate).
- Full CI green in a clean sandbox before packaging; every prior 449/9/85 golden byte-identical (the
  no-radio inertness guarantees it).

## Definition of done

CI green in a clean sandbox; the legibility gate green; format-patch built + verified (`git am` on a
fresh baseline + `diff -r` empty); changed files synced to the E: mount; `docs/status.json` T50 → done +
banner + parkingLot; `CHANGELOG.md`; `docs/qa/QA_REVIEW_M4_PART6.md`; Mission Control snapshot refreshed.
An adversarial two-subagent audit (engineering: determinism / save / byte-identity / edge cases; design:
legibility / no-number-leak / FR-STY-03 fidelity / broadcast-risk fairness / voice).

## Parking lot / deferrals

- **The rumor system (FR-STY-05, Could/v1)** — turning a ham/civilian lead into a *variably-reliable,
  resolvable* lead (loot/location/trap) is deferred; T50 surfaces leads as honest prose only.
- **Deeper broadcasting (FR-STY-04, Could/v1)** — the *audience response* (a survivor/faction actually
  answering, a raider party drawn to you) is a hint-only seeded outcome here; the real reply needs the
  people-side off-screen sim (PL-M3-02) + factions (T53). The dedicated transmitter / radio-room gate
  (T52) that would let you broadcast *without* lighting up your own node is a seam.
- **Listen-across-regions via a radio room (Part XI / T52)** — the portable receiver hears citywide
  signals and local ones only in/near their region; the room upgrade (wider reach, safer broadcast) lands
  with craftable rooms.
- **First-pass signal set + dials** — a ~7-signal demonstrator across all five families + the anomaly,
  not the launch pool; the deep pour (a fitting set per district, evolving chains, the "signal that
  becomes a quest") is post-gate content behind the review-capacity cap + the owner's voice/casting pass
  (as for characters/encounters, PL-M4-12). Thresholds (`POWER_DEAD_AT`, `REGION_FALL_AT`,
  `ANOMALY_THREAT`, costs, `BROADCAST_NOISE`) are untuned against a real cross-city run (M5 balance
  T59/T60).
- **`world.broadcasts` stays reserved** — the derived model doesn't populate it; a future caching/perf
  pass (or the Journal depth-screen, T54) could.
- **Lore/codex assembly (GDD XIII)** — the `radio.heard` beats are the raw material; the codex that
  "quietly assembles the fragments" is the T54 Journal/depth-screen work.
