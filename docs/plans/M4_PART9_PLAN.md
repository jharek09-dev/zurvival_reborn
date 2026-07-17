# M4 Part 9 — Factions & inter-NPC relationships (T53 · "the people are a world of their own")

The reactive city (M2), the shelter that runs itself (T52), and the staged people-substrate
(T33/T34/T35/T36/T45) have built everything except the thing the GDD calls **the game's soul**:
survivors who *remember*, relate to each other, and act on it. T53 lands that layer and, with it,
the long-deferred **off-screen people-sim** (PL-M3-02 / PL-M4-08 remainder / PL-M4-35) that every
prior part named as its dependency.

One content-driven system — `sim/social.ts`, interpreting `content/factions/*.json` generically over a
transient `graph.factions` pool, in the exact T47/T50/T51/T52 idiom — makes the whole social layer real,
and **a graph built without a faction pool leaves it entirely dark, so every prior run is byte-identical.**

## What FR-NPC-02/05/06/07 ask for, and the debt they clear

- **FR-NPC-02 (Must)** — *Per-character memory driving per-relationship trust/respect/fear (not a global
  bar).* T34 shipped a single per-NPC `trust` scalar toward the player. T53 keeps `trust` (unchanged, so
  T34/T35/T36/T45 all hold) and adds **`respect`** (do they defer to you?) and **`fear`** (do they dread
  you?) as the other two axes, each moved by a **bounded per-survivor `memory`** of what you and others did.
- **FR-NPC-05 (Should)** — *Desertion and betrayal from low trust/mistreatment.* A companion whose trust
  has been ground low, or whose fear has been driven high, for long enough **deserts** (walks in the night);
  a genuinely mistreated, low-trust companion may **betray** (empties a slice of the base stash and slips
  away). Deterministic, threshold-based — no RNG teeth needed, and a *betrayal sticks* stays literal.
- **FR-NPC-06 (Must)** — *Dynamic conversations where memories/knowledge act as real loot/location hints.*
  A survivor carries authored **`knowledge`** — offhand leads (*"the clinic on 4th had a safe in the back"*)
  that, once they trust you enough to share, **reveal a real node on the map or mark a real discovery**.
  Listening pays: `ask` is a real, costed verb whose payoff is world state, not flavour.
- **FR-NPC-07 (Should)** — *Inter-NPC relationships (friendship/rivalry) affecting shelter morale.* Recruited
  survivors carry **`relationships`** with each other (the reserved `Survivor.relationships` field), seeded
  from authored faction bonds/rivalries, and the mix of who lives at the base moves **shelter morale** — an
  aggregate of resident `mind.morale`, surfaced in the daily report.
- **Off-screen people-sim (PL-M3-02 / PL-M4-35)** — survivors elsewhere in the city finally **drift and move
  while you're away**: `tickNpcs` runs inside `advanceWorld` and stage-10 `moveGroups` graduates from its
  reserved `identity` no-op to real faction/survivor movement. Both gated, so prior off-screen goldens hold.

## The one system: social, content-driven, faction-pool-gated

`sim/social.ts` interprets faction JSON generically (no per-faction branching) and reads it via the transient
`graph.factions` pool (mirroring `graph.jobs`). The master gate is:

```ts
export function socialActive(graph): boolean { return factionPool(graph).length > 0; }
```

Everything below is downstream of it — memory accrual, respect/fear, `ask`/leads, desertion/betrayal,
inter-NPC bonds, shelter morale, and the off-screen people-sim. **A run with no faction pool writes none of
it and is byte-identical to the pre-T53 engine.** Prior golden runs (harness slice, every engine suite)
register no faction pool, so they stay dark. The shipped `content/factions/` set turns it on for real play.

The npc *catalog* is registered on the graph too (`graph.people`, the `NPCDef[]` already passed to
`spawnNpcs`) so the `ask` verb can read a survivor's authored `knowledge` at action time — but every read is
gated on `socialActive`, so registering the catalog changes no bytes (the graph is never serialized).

## No save-schema rung — social state is optional/tolerated-absent (stays v10)

This is the T52 discipline taken to its conclusion. The persistent social facts ride shapes that either
**already exist** or are **optional and written only when `socialActive`**, so a pool-less run's save is
byte-for-byte the pre-T53 save and **the cross-tree byte-identity proof needs no normalization** (T52-grade,
stronger than T51's rung):

- **Reserved, already in the shape (no rung):** `Survivor.relationships` (inter-companion bonds, −100..100),
  `Survivor.groupId` + `groups` + `player.reputation` (faction membership/standing), `Survivor.condition.
  mind.morale` (resident morale).
- **New but optional/tolerated-absent (no rung — exactly as `Survivor.name`/`trust` are today):**
  `respect?`, `fear?`, and a bounded `memory?` on `NPCState` and `Survivor`. Absent at spawn and on every
  pool-less run; **written only by the social tick when `socialActive`**, so a prior golden's survivors never
  gain a field. `spawnNpcs`/`createInitialState` are untouched.

Because nothing is seeded at spawn, a social-inactive run produces the identical NPCState/Survivor objects it
did before — the strongest possible byte-identity story.

## Memory → trust / respect / fear (FR-NPC-02)

A `SocialMemory` is a plain-JSON `{ kind, turn, other? }` (a verb key, the turn it happened, an optional other
actor). The per-survivor list is **append-only and bounded** to the last `MEMORY_CAP` entries (guards the
PL-M2-06 save-growth concern). Each remembered player action nudges the three axes by fixed, **asymmetric**
integer deltas (harm outweighs help, echoing `TRUST_DELTAS`):

| player action | trust | respect | fear | memory kind |
|---|---|---|---|---|
| share food/water | +10 | +4 | −2 | `kindness` |
| help / keep a promise (arc/encounter good) | +15 | +8 | 0 | `stood-by-me` |
| threaten | −20 | +2 | +18 | `menaced-me` |
| rob | −30 | −6 | +10 | `robbed-me` |
| abandon / let one fall | −25 | −10 | +6 | `abandoned` |
| witnessed cruelty to another (low humanity beat) | −8 | −4 | +8 | `saw-cruelty` |

`trust` continues to move through the existing `applyTrustEvent` (so T34's tests are untouched); respect/fear
and the memory entry are the **social overlay**, applied only when `socialActive`. The existing encounter
verbs (`give-food`/`give-water`/`threaten`) gain the overlay by threading `graph` into
`resolveEncounterAction` (as radio/economy/jobs already do) and calling `rememberPlayerAct` when the pool is
present. No number is ever shown (FR-UI-02) — respect/fear surface only as prose bands and as behaviour.

## Conversations that hint — the `ask` verb (FR-NPC-06)

`content/npcs/*.json` gains an optional **`knowledge`** array (schema-additive; existing npcs unaffected).
Each lead is `{ id, hint, reveals?: nodeId, marks?: {node, discovery}, minTrust? }`. When you stand with a met
survivor who trusts you at/above the lead's `minTrust` (default `PARLEY`+), an **`Ask <name> what they know`**
choice appears (costed, `ASK_COST`). Resolving it:

1. picks their first **unshared** lead (tracked by a `told:<leadId>` flag on the survivor — open `flags`, no
   rung), 2. **reveals the target node** on the map (`discovered: true`, the T11 fog lift) and/or **marks the
   discovery** into `node.discoveries`, 3. records a `memory` (`confided`) and a small trust/respect bump —
   *listening builds the bond too* — and 4. surfaces the hint verbatim as the turn's `socialLine`.

A survivor with no eligible unshared lead simply isn't offered `ask` (no dead option). Leads are **real,
actionable world state** — a new node you can now travel to, a discovery a later search resolves — not a quest
marker. Gated on `socialActive`, so byte-identical when dark.

## Desertion & betrayal (FR-NPC-05)

Deterministic, evaluated in the social tick for each party companion, reading the axes the memory built:

- **Desertion** — trust below `DESERT_TRUST` (or fear above `DESERT_FEAR`) held across a companion's
  `desertionPressure` counter reaching `DESERT_TURNS` → the companion leaves: removed from `actors`, a
  `social.deserted` history beat, a `left.<id>` flag (the community remembers, like `fallen.<id>`). Low
  **player humanity** (`humanityOf`) lowers the desertion thresholds — a cruel leader is left sooner (this is
  the intended reader PL-M4-15 named). The pressure counter itself is an optional tolerated-absent int.
- **Betrayal** — the worst case: a companion at/over the desertion bar **and** with `fear ≥ BETRAY_FEAR` and
  `respect ≤ BETRAY_RESPECT` **takes a slice of the base stash** on the way out (`social.betrayed` beat). A
  betrayal is strictly worse than a desertion and gated behind the harsher axis combination, so it only fires
  for a genuinely mistreated, frightened companion — never a merely under-fed one.

Both are surfaced honestly in the next scene (`socialLine`) and leave a Living-History mark.

## Inter-NPC bonds → shelter morale (FR-NPC-07)

Faction content authors **bonds** (co-members trend friendly) and **rivalries** (named pairs trend hostile).
When two survivors from the same faction are both recruited, their `relationships[other]` seeds positive;
a rival pair seeds negative. The social tick then moves **shelter morale** — the aggregate of resident
companion `mind.morale` — toward a target set by *who is home together*: allied residents lift it, resident
rivals grind it down, a recent desertion/death dents it. Morale is surfaced as a band in the daily report
(*"the house is close-knit tonight" / "the base is on edge — old grudges"*), never a number. Gated.

## Off-screen people-sim — closing PL-M3-02 (the dependency)

Two gated additions make the people side of the world live while you're away:

1. **`advanceWorld` runs the people tick.** Today `advanceWorld` skips `tickNpcs` (PL-M3-02). T53 adds, behind
   `socialActive`, a `tickPeople` pass: non-party survivors drift needs off-screen (they can starve in a
   district you fast-forward past — the teeth PL-M3-02 named), companions drift + accrue nothing new beyond
   what stage 5 does, and desertion/betrayal pressure advances. Gated, so every existing off-screen suite
   (worldSim/regionDrift/director/history/routes/pacing) is byte-identical.
2. **Stage-10 `moveGroups` graduates.** The reserved `identity` no-op becomes a gated body that walks factions
   toward their `goal` node and drifts a wandering survivor one step along the graph — the "survivors don't
   move" half of PL-M3-02. The stage **name and 14-stage order never change** (pipeline.test asserts only
   names/order), exactly as stages 5/6 graduated. Movement is deterministic (a bounded, seeded step from a new
   lazy `social` stream, drawn only when active — a new independent stream is byte-safe).

## The seam — `socialChoices` / `isSocialAction` / `resolveSocialAction` / `socialLine`

Wired into `coreActions` exactly like radio/economy/jobs: `socialChoices(state, graph)` adds the `ask` verbs in
the quiet explore branch (a fight/walkers/active encounter pre-empt them); `isSocialAction` routes stage-3
dispatch; `resolveSocialAction(state, graph, action)` resolves `ask`; `socialLine(state, graph)` surfaces the
this-turn hint / desertion / betrayal / morale read from the append-only log (the same this-turn tail-scan
`jobLine` uses). All inert without a faction pool.

## Determinism, RNG, and byte-identity (the discipline)

- **One master gate** (`socialActive`) dark ⇒ no choices, no memory writes, no respect/fear, no
  desertion/betrayal, no morale drift, no off-screen people tick, no group movement. **No save rung, no new
  loot-table growth** (leads reveal/mark existing world state — they never append to a `floor(f·len)` pick
  set, so the [[zurvival-byte-identity-loot-hazard]] simply never arises), **no new item**.
- **One new lazy RNG stream** (`social`), drawn only in active runs for movement/tiebreaks — independent, so
  it can't shift `loot`/`encounter`/`combat`/`npc` sequences. Desertion/betrayal are RNG-free (thresholds).
- **Passive world mutations gated on the flag**, never merely on data presence — the `tickPeople` off-screen
  drift and stage-10 movement both early-return `if (!socialActive) return state`.
- **Cross-tree byte-identity proof (T52-grade):** identical scripted run (many seeds, searches + combat +
  `advanceWorld` jumps, survivors present) on the pre-T53 baseline (from `.sandbox/zb.tgz`) vs the edited
  tree, **raw `saveGame` equal, no normalization** — because a pool-less run writes no new field. Proven by the
  adversarial engineering subagent.

## Content

- **New type `content/factions/`** + `faction.schema.json` (schema gate **12 → 13 types**). 2–3 factions over
  the shipped 18 npcs: e.g. a downtown courier-collective, a wary riverside holdout, one hostile crew — each
  with `members`, `goal`, `homeNode`, baseline `strength`/`hostility`/`reputation`, and `bonds`/`rivalries`.
- **`npc.schema.json` extended** with optional `knowledge` (additive; `additionalProperties:false` keeps old
  npcs valid). Author real leads on the survivors whose notes already flag FR-NPC-06 hooks (Cass's mental map,
  etc.) — each `reveals`/`marks` a real Rivermouth/downtown node or discovery.

## Test plan

- `engine/test/social.test.ts` — memory bounds + append-only; the trust/respect/fear deltas; `ask` reveals the
  target node & marks the discovery & flags the lead told; desertion at the trust/fear thresholds (and humanity
  lowering them); betrayal takes stash only under the harsher gate; bonds seed `relationships`; morale drifts
  from resident mix; the off-screen `tickPeople` starves an ignored survivor; stage-10 movement steps a group.
- **Byte-identity guard** — a no-faction-pool run is object-identical across an `ask`-less scenario (the
  in-suite mirror of the cross-tree proof).
- `harness/test` — a faction/knowledge **content drift test** (authored prose matches, the T40 pattern) + the
  schema gate counts 13 types.
- Full CI green in a clean sandbox: engine typecheck+test, content-loader, harness typecheck+test, `npm start`
  smoke, schema gate + malformed-reject.

## Definition of done

Code + tests + this plan + `docs/qa/QA_REVIEW_M4_PART9.md` + `CHANGELOG.md`; `docs/status.json` T53 → done with
the completion note + refreshed banner + audit parking-lot items (under the concurrency guard); Zurvival
Mission Control snapshot refreshed; a verified `git format-patch` delivered; changed files synced to the E:
mount. Two-subagent adversarial audit (engineering: determinism/byte-identity/save/forged-edges; design:
FR-NPC fidelity / no-number-leak / loops-close / voice) with all findings fixed.

## Parking lot / deferrals (first-pass; M5 balance + later blocks)

- **Personal quests & romance (FR-NPC-08, Could/v1)** and the **Storyteller surfacing system (FR-NPC-09)** —
  T53 lands the relationship *graph* and desertion/betrayal/leads; the dedicated Storyteller that weaves
  reconciliations/betrayal-foreshadowing into authored moments is a later story block.
- **Full faction diplomacy (FR-NPC-10, Could/v1)** — trade/alliance/tribute/war + dynamic leadership; T53
  ships identity, membership, reputation, hostility, and off-screen movement, not the diplomacy verbs.
- **Companion combat (PL-M4-07)** and **richer off-screen survivor economy** stay their own blocks.
- **All social dials** (memory cap, the axis deltas, desertion/betrayal thresholds, morale rates) are
  first-pass, tuned at M5 balance (T59/T60).
