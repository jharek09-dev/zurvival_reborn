# M4 Part 5 — Infection as staged identity (T49 · the "harder way to keep playing")

**Milestone:** M4 (Content-complete city) · **Task:** T49 · **Requirements:** FR-INJ-05 (Must, MVP),
FR-INJ-06 (Should, MVP), FR-INJ-07 (Should, MVP), FR-INJ-08 (Must, MVP), the §7.5 acceptance criteria,
and the "Infection-as-identity is confusing" tripwire (§10).
**Depends on:** T22 (the M1 bite→infection track in `sim/survival.ts` this task promotes), T16 (named
wounds — the bite is the driver), T5 (named-stream RNG — the new `infection` stream for the uncertain
late cure), T31 (Living History — infection beats), T37/T39 (shelter — quarantine), T47 (Humanity
pattern of a hidden scalar surfaced only as prose).

## The problem this task fixes

The M1 loop (T22) modelled infection as exactly what the GDD says it must **not** be: a **countdown to
an instant Game Over**. `Infection = { stage, progression }`, an untreated bite adds `+2/h`, and at
`progression ≥ 100` the stage flips `terminal` and `runEndReason` returns `"infection"` — the run ends
on the spot. That is a death timer, not an identity.

GDD Part VI and PRD §7.5 are unambiguous:

- **FR-INJ-05 (Must):** staged identity — *asymptomatic → symptomatic → advanced → terminal* — with
  **no infection bar**.
- **FR-INJ-08 (Must):** **no instant Game Over**; reaching a bad stage "is a new and harder way to keep
  playing — a race for a cure." (PRD acceptance: "reaching a severe infection stage opens new play
  (cure race) rather than ending the run.")
- **FR-INJ-06 (Should):** it alters *perception* (scene text grows unreliable; hallucinations, memory
  gaps), opens/closes *dialogue*, and shows *symptoms* others react to.
- **FR-INJ-07 (Should):** *diagnosis, treatment, quarantine*; late stages **costlier and less certain**.
- The tripwire: comprehension-tested so a player can **act on symptoms without the hidden number**.

## Owner decision (the crux of the task)

"No instant Game Over" (Must) is in apparent tension with the GDD line "*some runs still end in death by
infection*." **Resolution — and the one call worth flagging:** reaching **terminal no longer ends the
run**. Terminal is a *playable* stage — failing senses, a cure still possible. Death by infection still
exists, but only as a **delayed collapse (`succumb`)** the player reaches by *neglecting the cure race*
across a real, survivable window (~a day of in-game time past terminal onset). So:

- Reaching terminal ⇒ **new play** (cure race), never an instant loss — satisfies FR-INJ-08 (Must) and
  the acceptance criterion verbatim.
- A player who ignores it still dies of infection — preserves the GDD's "some runs end in death by
  infection," and the *authored, heightened* final-choice death scene is explicitly deferred to **T62**
  (M5 failure endings), which this leaves a clean seam for.

If the owner would rather terminal **never** auto-ends the run (pure play-on, death only via its
*consequences* — collapse in a fight, needs you can't manage), that is a one-constant change
(`INFECT_SUCCUMB_AT = ∞`); this plan ships the delayed-succumb reading as the more defensible one.

## The staged model (engine `sim/infection.ts`, new)

The engine keeps the authoritative dials; the hidden `progression` int drives the stage the player reads
from symptoms. Bands (chosen so **every prior `stageFor` test stays green** — only `"advanced"` is
inserted, existing thresholds unmoved):

| Stage | GDD name | `progression` band | What the player gets |
| --- | --- | --- | --- |
| `none` | — | `0` | not infected |
| `incubating` | **asymptomatic** | `[1, 40)` | no visible sign; the hidden clock runs |
| `symptomatic` | symptomatic | `[40, 70)` | fever/sweats/tremor; mild fatigue drain; honest symptoms |
| `advanced` | advanced | `[70, 100)` | hallucinations + memory gaps begin; perception unreliable; heavier drain; NPCs afraid |
| `terminal` | terminal | `[100, 148)` | the cure race — severe drain, strong distortion, still playable |
| *(succumb)* | death | `≥ 148` | the body finally fails — run ends `"infection"` (delayed, never instant) |

- `incubating` is kept as the **key** for the GDD's *asymptomatic* stage (renaming would churn saves,
  content and five call-sites for no gain; the prose calls it asymptomatic).
- Constants unchanged so the T22 tests hold: `BITE_INFECT_RATE = 2`, `INFECT_SYMPTOMATIC_AT = 40`,
  `INFECT_TERMINAL_AT = 100`. **New:** `INFECT_ADVANCED_AT = 70`, `INFECT_SUCCUMB_AT = 148`,
  `INFECT_CEILING = 148` (infection progression gets its own clamp, since it now runs past 100).
- **Fatigue drain by stage** (`INFECT_STAGE_FATIGUE`): symptomatic +1/h, advanced +2/h, terminal +3/h —
  infection makes the loop materially harder to survive (FR-INJ-08 through *consequence*, not a bar).
  Fatigue is not itself fatal, so this never re-introduces an instant loss; it just bites needs.

## FR-INJ-08 — terminal is playable; succumb is delayed

- `runEndReason` no longer returns `"infection"` at terminal onset. It returns it **only at
  `progression ≥ INFECT_SUCCUMB_AT`**. Between terminal onset (100) and succumb (148) is the cure race —
  ~24 in-game hours of continued *untreated* progression, i.e. several turns to act.
- If the player **stops the driver** (treats the bite wound, so `infectDelta = 0`) or **cures**
  (below), progression halts/drops and they **do not succumb** — they live on, terminal, a harder run.
  That is the requirement made literal.

## FR-INJ-07 — diagnosis, cure race, quarantine (new actions, `infectionChoices`)

Mirrors the contained `shelterChoices`/`stashChoices` seam: `infectionChoices(state, graph)` offers, and
`isInfectionAction`/`resolveInfectionAction` dispatch in `applyPlayerAction` (stage 3). All inert unless
infected, so every prior run is byte-identical.

- **`diagnose`** (1h) — offered when infected **and** (carrying a med item **or** standing on a
  `kind:"medical"` node). Sets `player.flags["infection.diagnosed"] = true` (rides existing `Flags`, no
  schema rung); the Scene then names the stage precisely ("the infection is *advanced*"), the
  comprehension fallback for a player the symptoms alone didn't reach.
- **`treat-infection`** (the cure, 4h) — offered when infected **and** carrying `item.antibiotics`.
  Reduces `progression`, **stage-scaled and late-uncertain** via a new named **`infection` RNG stream**
  (lazily seeded, rides the open `rng.streams` map — no migration, exactly as T48's `encounter` stream):
  - incubating/symptomatic → strong, near-certain (`−50`);
  - advanced → moderate, a seeded success roll (full `−30` on success, partial `−12` otherwise);
  - terminal → weak, a low seeded success roll (partial `−18` on success, a spent-dose `−4` otherwise).
  "The deeper it goes, the costlier and less certain the cure" — realized as a real, reproducible roll.
- **`quarantine`** (8h) — offered when infected **and** standing in your **own shelter** (FR-INJ-07
  "shelters can quarantine"). Rest + clean conditions with **no meds**: strong on early stages
  (incubating/symptomatic `−30`), weak on advanced (`−10`), and **useless at terminal** (`0` — clean
  conditions can't beat the late body; you need the cure). Isolation is conveyed in prose; the deeper
  companion-trust strain is left as a T53 seam.

The `infection` stream advances **only** when a cure roll actually happens (advanced/terminal cure), so
no no-bite run ever touches it — determinism for every prior golden is preserved.

## FR-INJ-06 — perception, symptoms, dialogue

- **Symptoms (honest channel, harness `describeInfection`).** Four stages of distinct, escalating,
  decision-relevant prose in the *status* region — fever (symptomatic) → "you can't trust your senses"
  (advanced) → "your body is failing" (terminal). Never a number (the FR-UI-02 / tripwire guarantee).
  This is the channel the comprehension test pins: each stage a recognisably different read.
- **Perception distortion (engine `sceneOf`, advanced+).** Injected into the *story* narration:
  hallucinated leads/sounds and, at terminal, **memory gaps**. Must be pure and **must not advance the
  rng** (`sceneOf` is a render, called ad hoc), so it is gated by a **stateless hash** of
  `${seed}:${turn}:…` (new `hashUnit` over the existing `cyrb128`), deterministic and resume-safe.
  Framed as *possibly-unreal* ("— or was it? You can't trust your eyes now.") so it reads as a **symptom
  of the disease, not a real threat**: real decisions still key off real state (`walkers`, `combat`,
  `availableActions`), so a hallucination can never unfairly punish. The honest status channel warns the
  player their perception is compromised, so distrusting the story channel is itself legible.
- **Dialogue & visible signs (engine `peopleLine`, advanced+).** NPCs react to the fever on you ("they
  keep their distance"); at advanced+ a visibly-dying stranger can no longer be calmly recruited (the
  calm option fades), matching "companions grow afraid / some dialogue options vanish."

## Content — a new schema-validated type (gate 8 → 9)

On the milestone theme ("all content schema-validated in CI", FR-CNT-02): add **`content/infections/`**
+ **`content/schemas/infection.schema.json`** (singular — the loader strips the plural folder). One
entry, `infection.bite.json`, the canonical staged data: per-stage `key`, `label`, the felt symptom
line, the visible sign, the cure difficulty, and the perception-distortion line pool. The engine holds
the authoritative dials and its own fallback prose (as it already does for weather/atmosphere); the
content file is the canonical mirror, and a **harness drift-guard test** asserts the engine's stage
list/order matches the content (exactly T40's arc pattern). New engine constant `item.antibiotics` added
to the med tables and the `medical` loot table so the cure item is actually findable.

## Save schema — no rung (stays v8)

Nothing is added to the state *shape*: `"advanced"` is a new value of the existing `Infection.stage`
string; `progression` is the existing int (now clamped to 148); `diagnosed` rides `player.flags`;
infection beats ride `history`; the `infection` RNG stream rides the open `rng.streams` map. So **T49
adds zero save-schema rungs** (v8), consistent with T37/T38/T40/T47/T48 "ride reserved-and-inert shapes."
Old saves (progression ≤ 100, no `"advanced"`, no diagnosed flag) load and behave identically.

## Test plan

- **Engine** (`survival.test.ts` extended + new `infection.test.ts`):
  - staging thresholds incl. the new `advanced` band; the existing `stageFor` assertions unchanged;
  - **terminal is NOT run-over** (the T22 assertion inverts): `runEndReason(terminalOnset) === null`;
  - **delayed succumb**: `progression ≥ 148 ⇒ runEndReason === "infection"`; the 60-turn untreated-bite
    loop still dies of infection (now at succumb, still < the hunger clock) within its budget;
  - **cure race**: early cure near-certain & strong; advanced/terminal cure weaker + seeded (same seed ⇒
    same result; the draw advances **only** the `infection` stream, never combat/loot/encounter);
  - **quarantine** early-strong / terminal-useless; **diagnose** sets the flag & names the stage;
  - **fatigue drain** scales by stage; **stage-4 inert** on a zero-hour turn and on `stage:"none"`
    (every prior run byte-identical); save-lossless with a mid-terminal infection.
  - **perception statelessness**: `sceneOf` called twice on one state is identical and leaves `rng`
    untouched; a hallucination never creates real walkers/combat.
- **Harness**:
  - **comprehension gate** — for each of the four stages, the rendered status carries a *distinct*
    symptom keyword, the progression **integer never appears**, and an actionable option
    (treat-infection/quarantine/diagnose) is offered so no decision needs the number (retires the
    tripwire);
  - **content drift-guard** — engine stage list == `infection.bite.json` stages;
  - a shipped-content play beat: a bite taken → staged symptoms surface → a cure pulls the player back.
- **content-loader** — schema gate auto-counts the new type (**9 types**); entry count updated.
- Full CI green in a clean sandbox before packaging; every prior 418/9/75 golden byte-identical (the
  no-bite inertness + unchanged thresholds guarantee it).

## Definition of done

CI green in a clean sandbox; the comprehension gate green; format-patch built + verified (`git am` on a
fresh baseline + `diff -r` empty); changed files synced to the E: mount; `docs/status.json` T49 → done +
banner + parkingLot; `CHANGELOG.md`; `docs/qa/QA_REVIEW_M4_PART5.md`; Mission Control snapshot refreshed.
An adversarial content/design subagent audit (symptom legibility, no-number leak, real-trade-on-every-
cure-branch, screen-reader legibility, FR-INJ-05..08 fidelity, determinism).

## Parking lot / deferrals

- **Authored terminal death scene** — the heightened final-choice "death is a scene" for infection is
  **T62** (M5). T49 leaves the `succumb` seam and a plain death narration.
- **Mind model** (FR-INJ-09: stress/fear/hope surfaced as behaviour) — a separate requirement; T49
  touches only fatigue as infection's consequence, not the mind system.
- **Companion/community infection** (spread in the shelter, quarantine's trust strain, contagion from
  `wound.illness`) — needs the people-side off-screen sim (PL-M3-02) and T53; quarantine's isolation is
  prose-only here.
- **Non-bite infection sources** (deep wounds in filth, tainted water, spoiled food — GDD "Sources") —
  the driver is bite-only for now; the staged machine is source-agnostic and ready for T51's spoilage.
- **Scars persist / NPCs reference them** (FR-INJ-11, Could/v1) — later.
