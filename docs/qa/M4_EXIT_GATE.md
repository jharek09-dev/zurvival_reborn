# M4 Exit Gate — content-complete city & public-beta hardening (T57)

The **M4 Definition of Done** (PRODUCTION §M4), and the milestone's decisive gate — the content-complete
analogue of the M3 **Slice Fun Gate** ([`FUN_GATE_LOG.md`](FUN_GATE_LOG.md)). Like that gate, the verdict on
its human criteria is the **owner's call and cannot be auto-passed**: this packet prepares and proves
everything buildable, then hands the owner a scripted playtest for the parts only a player can judge.

> **Authority.** A pass closes M4 (MVP / public beta) and opens **M5** (release candidate). A fail does not
> "add more content" — per PRODUCTION §4 it re-invests in whatever the playtest shows is missing, content
> frozen until it passes.

## The bar (PRODUCTION §M4 · PRD §4/§7)

1. **Content-complete & schema-valid** — the first city is content-complete and validates in CI (FR-CNT-02).
2. **Repetition under target** — verbatim encounter repetition sits **under the PRD §4 target (< 5%)** across
   a full run.
3. **Infection is identity** — infection-as-identity plays as *a harder way to keep going* (FR-INJ-08),
   **comprehension-tested with players**.
4. **Handable beta** — the beta is **stable enough to hand out**.

## How the gate splits: proven vs owner-pending

Two of the four criteria are fully machine-provable and are **proven now**; the other two have a human half
that — exactly as the M3 gate was rendered by an owner playtest — is **deferred to the owner** (§ *Owner
playtest*). Nothing in this packet claims the human half.

| # | Criterion | Machine-provable half | Human half (owner) |
|---|-----------|-----------------------|--------------------|
| 1 | Content-complete & schema-valid | ✅ **PROVEN** | — |
| 2 | Verbatim repeats < §4 target | ✅ **PROVEN** | — |
| 3 | Infection is a harder way to keep going | ✅ **PROVEN** (FR-INJ-08 survivable; legible without the number) | ⏳ *does it READ as identity?* |
| 4 | Beta stable enough to hand out | ✅ **PROVEN** (repro-from-seed, lossless save/resume, no soft-lock, boots + plays) | ⏳ *does it FEEL handable / "one more day"?* |

## Evidence — the machine-provable half

All of it is consolidated in one gate suite, `prototype/harness/test/exitGate.test.ts` (20 assertions), so the
exit criteria can't silently rot. It is **harness-only** — it reads shipped content + the engine's public API
and adds no engine/content, so **byte-identity holds by construction** (`diff -r prototype/engine/src` and
`diff -r content` vs the pre-part baseline are both empty; the T54/T55/T56 shape).

### 1 · Content-complete & schema-valid (FR-CNT-02)

A machine-checked **manifest** enumerates every M4 in-scope Content-Bible **pool** — and checks the
client-side systems (depth screens, the audio→text cue matrix) are present — cross-checking that references resolve:

| System | Shipped | Bar | Note |
|--------|--------:|-----|------|
| Regions | 6 | =6 | one connected, symmetric graph, single known start (`buildRegionGraph` with **every** pool) |
| Nodes | 60 | 40–65 | PRODUCTION §6.4 city budget; 14 claimable safehouses |
| Survivors | 18 | ≥15 | the **defined beta subset** (PRODUCTION §7 permits it over the 100-cap); party cap 3 |
| Encounters | 26 | ≥20 | count asserted; all **7** categories (FR-ENC-05, Must) |
| — multi-stage (04) | ✓ | ≥1 | `overpass-toll` (talk → fight → chase) |
| — evolution (08) | ✓ | before/during/after | `garden-center-{before,during,after}` |
| — chains (03) | ✓ | sets + gates flags | flag-set beats + flag-gated payoffs |
| — moral/Humanity (06) | 10 | ≥3 | choices that move Humanity |
| Infection | 4 stages | =4 | incubating→symptomatic→advanced→terminal, no bar |
| Radio | 7 | ≥5 | all 5 families: emergency/military/civilian/ham/unknown |
| Recipes | 16 | all 6 families | medical/weapon/shelter/survival/repair/purify |
| Jobs | 6 | ≥5 rooms | garden/kitchen/salvage/infirmary/generator/watch |
| Factions | 3 | ≥2 | membership integrity (every member is a shipped survivor); relationship substance FR-NPC-02/05/06/07 → `social.test.ts` |
| Arc | 1 | ≥1 | subject resolves; the full-city beta boot now **registers + can fire** it (was slice-only) |
| Difficulty | 4 + Ironman | all reachable | story/survivor/hardcore/nightmare |
| Zombie roster | 7 (+5 enemies) | ≥7 / ≥4 | 7 distinct behaviours (T46 · FR-CBT-06/07); each combat-distinct type maps to a real enemy |
| Named wounds | 4 | ≥4 | bite/fracture/laceration/sprain (T16) |
| Depth screens | 5 | ≥5 | inventory/companions/shelter/map/codex (FR-UI-04, client — `screens.test.ts`) |
| Audio→text cues | 48 | ≥20 | every meaningful sound cue has a text equivalent (FR-AUD-06, client — `cueMatrix.test.ts`) |
| Accessibility | gated | — | palette contrast + colour-blind CI gate (NFR-ACC-01/03, `validate:a11y`) |

Cross-ref integrity (the manifest's teeth): every faction member, arc subject, npc home-node, and encounter
node-anchor resolves to a real shipped id — **no dangling references**. The **schema gate** (CI
`validate`) independently validates all **160 content entries across 13 types** and rejects malformed content.

> **Honest scope.** "Content-complete" = every M4 system present and schema-valid across the whole city at the
> **defined beta-subset volume PRODUCTION §7 permits**, not every pool at its theoretical maximum. The deep
> launch survivor/encounter pours (toward the ~60–100 survivor cap, the wider encounter set) are the tracked
> M5+ deferrals PL-M4-16/PL-M4-63; the *systems and the city* are complete, the *volume* is the beta subset.

### 2 · Verbatim repeats under the §4 target

Re-confirmed over the **content-complete, all-pools** boot (T48 gates it over the encounter pool alone). Encounter
selection rides its own RNG stream, independent of the radio/economy/jobs/factions pools — so registering the whole
world does **not** perturb selection, which is itself the assurance the exit boot re-checks. Deterministic full-city sweep, ~54 days:

```
136 encounter fires · verbatim-repeat 0.00% (target < 5%) · 0 immediate repeats
20 distinct encounters · max single share 12.5% · 5 ambient categories fired
```

The sweep is an ambient-selection probe (it keeps nodes uncontested and claims no safehouse), so the
**combat** and **shelter** categories are out of *its* scope by construction — both are nonetheless **authored
and shipped** (proven by the manifest), so all 7 categories exist; 5 fire in the ambient sweep. `T48`'s
`repetition.test.ts` remains the standing hard gate; this is the exit-tier re-proof over the full content.

### 3 · Infection is a harder way to keep going (FR-INJ-08) — machine half

- **Survivable, not a loss screen.** At `terminal` the run is **not over** (`isRunOver` false) — a cure race
  opens; the run ends by infection only if that race is neglected (the delayed succumb, proven in the engine
  `infection.test.ts`). The cure stays on the menu at the worst stage, so the fight is always actionable.
- **Legible without the number.** Each stage reads from a distinct symptom; the hidden progression number
  never appears in status, scene, or the diagnosis line. This is the standing **T49 comprehension gate**
  (`harness/test/infection.test.ts`), re-touched here at the exit tier.

> The **human half** — does infection *read* as an identity you inhabit rather than a hidden timer — is the
> owner playtest below.

### 4 · Beta stable enough to hand out — machine half

- **It boots and plays.** `npm run play` stands up the full content-complete city (every pool registered),
  renders the story-first single-decision Scene with live sound-captions and the depth-screen footer, and
  plays through the world — including the **authored arc** (`the-last-customer`), now registered in the full-city
  client, not just `play:slice`; `--difficulty` and `--ironman` are honoured at boot. (Smoke: exit 0.)
- **Repro-from-seed.** A full content-complete playthrough is **byte-identical** from the same seed (final
  state + transcript) — the property every beta bug report leans on (report the seed, reproduce the run).
- **Lossless persistence.** The shipped save **format** round-trips deep-equal at a rich content-complete
  state; quit/resume is byte-identical at **every** boundary of a content-complete run (T21 held at the exit
  tier, from the save string alone).
- **No soft-lock.** Across sampled long runs (multiple seeds) the engine always offers a legal action until the
  run **cleanly** ends — never a dead end. (Long-run soak proper is M5/T66.)

> Reliability/perf **hardening** proper — crash-free ≥ 99.5%, the turn-budget/perf numbers, long-run soak,
> bounded history growth — is **M5/T66** by PRODUCTION's own scoping; the M4 bar is "handable", proven above.

## CI (clean cloud sandbox) — all green

```
engine        580 (+0, untouched)      content-loader  23     harness  255 (+23 exitGate.test.ts)
schema gate   160 entries / 13 types   malformed rejected     a11y gate OK · malformed rejected · smoke exit 0
```

---

## Owner playtest — the human verdict (to be rendered by Jharek)

The two human halves. Play the beta and answer the two questions below; record the verdict in the table that
follows (mirroring the FUN_GATE_LOG format). If a question fails, note what to re-invest in — not "more
content".

**How to play.** From a fresh clone: `cd prototype/harness && npm install`, then:

- `npm run play` — a new run of the full city (fixed demo seed).
- `npm run play -- <seed>` — a chosen seed. `-- --difficulty <story|survivor|hardcore|nightmare>` and
  `--ironman` set the floor. `-- --resume <file>` resumes a save (press **S** in-run to save & quit).
- Keys in-run: a **number** to choose; **I/C/B/M/L** open inventory/companions/shelter/map/codex (free, no
  turn spent); **S** save & quit; **Q** quit. Full handout: [`../BETA.md`](../BETA.md).

### Q1 — Does infection read as *a harder way to keep going* (criterion 3)?

Play until you take a bite and let the infection climb (or start a seed that bites early). Watch the symptom
prose escalate — fever → senses you can't trust → burning up but still moving — **without ever seeing a
number**. Look for the moment it stops being "a health bar going down" and becomes "who I am now, and I'm
still going." Then decide:

- Could you **read your stage from symptoms alone** and act (diagnose / cure race / quarantine) without
  wanting a number?
- At `terminal`, did it feel like **a harder way to keep playing** (a race you're still in) rather than a
  death sentence?

### Q2 — Is the beta handable, and does it pull "one more day" (criterion 4)?

Play a real session or two (try a different difficulty). Watch for anything that breaks the hand-out bar — a
crash, a confusing dead end, an unreadable scene, a save that won't resume. Then the durability question the
milestone is really about (GDD XVI): **at session's end, did you want to start the next day?**

- Would you be comfortable **handing this build to a friend** to play unattended?
- Did a run produce a **retellable moment**, and did the loop pull you back for **one more day**?

### Verdict — to be recorded by the owner

| Field | Entry |
|-------|-------|
| Build | m4-part-14 (T57), `m4-part-14-T57.patch`; engine 580 · content-loader 23 · harness 255 green |
| Date | _pending_ |
| Playtesters | _pending (owner + any external testers)_ |
| Q1 — infection reads as identity | _pending_ |
| Q2 — handable / "one more day" | _pending_ |
| **Decision** | **PENDING — machine-provable readiness ✅ complete; awaiting owner playtest.** A pass closes M4 and opens M5. |
| Notes / re-invest in | _pending_ |

_When the verdict is rendered, flip T57 to `done` in `docs/status.json` (or record the re-invest list), and
open M5 per PRODUCTION §M5._
