# M4 Part 1 — implementation plan (T43–T44)

Working design note for the first block of **M4 (Content-complete city)**. M0–M3 built and proved the
*engine*: a deterministic loop, a reactive world, people, a shelter, and a first authored story — and
the Slice Fun Gate (T42) signed the verdict that *a run becomes a story*. M4 is the milestone where
that proven substrate gets its **content pour**: the full first city, the survivor pool, the encounter
library, infection-as-identity, the radio network, the economy, factions, depth screens, adaptive
audio, and difficulty — all schema-valid in CI, all behind the review-capacity cap.

Part 1 is deliberately the **foundation-before-the-pour** block. It does two things, both of which must
land before the volume content they gate:

1. **T43 — resolve the three M4 decision gates** (PRODUCTION §9) so none silently stalls content or the
   beta: platform ordering (ADR-0004), cross-run memory (ADR-0005), and licensing (ADR-0006).
2. **T44 — author the city itself** (FR-MAP-01 / FR-SIM-02): the regions and nodes every later M4 task
   hangs content on. You cannot author encounters, survivors, or radio *for a city that does not exist
   yet*.

**No engine code changes this part.** T43 is written decisions; T44 is content-as-data (ADR-0002) that
the *existing* engine already knows how to read (`buildRegionGraph` / `startRun`, shipped in M1 T11).
The only code touched is one **test-budget update** (the node-count cap), because the M1–M3 slice
budget (5–8 nodes) is not the M4 city budget (≈40–60). Determinism, save-schema, RNG streams, and the
14-stage pipeline are all untouched — this is a data + decisions block.

## T43 — M4 decision gates (PRODUCTION §9)

Three decisions were scheduled to resolve by M4 because each *blocks* something the milestone needs, and
the §9 discipline is that a gate is resolved at its milestone so it cannot drift. Each is a written ADR
against explicit criteria (the ADR-0003 pattern: context + numbered criteria → options → decision →
consequences → accept/veto closer). The owner made each call; the ADRs record the reasoning and, where a
choice constrains a later decision, hand that constraint forward explicitly.

| Decision | ADR | Resolution |
|----------|-----|------------|
| Platform ordering (native/Steam/bot) | **0004** | **Ratify web-first**; defer the ordering to the v1.0 launch gate (T69) with a named trigger → ADR-0004a. The beta is web, so the ordering never blocks it; deciding it now would be a data-free guess. |
| Cross-run memory persistence | **0005** | A **bounded, local Chronicle + capped light unlocks** (no mechanical head-start). Protects the "one more day" per-run stakes while giving M5 endings (T61/T62) a deterministic source. |
| Licensing | **0006** | The beta ships **all-rights-reserved** — the placeholder LICENSE stands as its real license, so the gate is closed and distribution is unblocked; the **final selection** (open source / source-available / proprietary) is deferred to the coupled **T58** monetization decision with a named trigger → ADR-0006a. Permissive licensing is a one-way door, so the irreversible call is made *after* the business model it constrains, not before it. |

Deliverables: `design/decisions/0004-platform-ordering.md`, `0005-cross-run-memory.md`,
`0006-licensing.md`; the `design/decisions/README.md` register updated to a decisions log;
`docs/status.json` ADR-0004 flipped to accepted and ADR-0005/0006 added. The repo `LICENSE` is
**unchanged** — retaining it is the decision. **DoD:** three accepted ADRs against their criteria; the
register and status reflect them; the beta has an explicit license to ship under.

## T44 — the Content Bible: the full first city (FR-MAP-01 / FR-SIM-02)

**Idea.** Replace the single Rivermouth slice region with the whole launch city — the ground every later
M4 task authors *onto*. The scope, chosen by the owner at the top of the §6.4 band: **6 regions, ~60
nodes.** Rivermouth stays as the start region (the M1 six-node ring, expanded to eight), and five new
districts are built around it, wired into one connected graph.

**The six regions**, each with a distinct identity expressed in its baseline dials and its nodes:

| Region | Identity | Baseline lean | Nodes |
|--------|----------|---------------|-------|
| **Rivermouth** (start) | Harbor/riverfront; the ground you learn to read | threat 35 / loot 70 / power 0 (pinned) | 8 |
| **Downtown Core** | Dense, vertical, loud; high-tier loot behind serious risk | threat 70 / loot 85 / density 80 | 11 |
| **The Terraces** | Hillside suburbs; where the living still hide; loot spread thin | threat 30 / survivorActivity 55 | 11 |
| **Mercy Hospital** | The medical mother lode and where it went wrong; extreme danger | threat 80 / density 85 / loot 75 | 9 |
| **The Ironworks** | River-and-rail industry; materials, fuel, tools, hazards | power 60 / water 55 / loot 60 | 10 |
| **Hillcrest** | The high ground: university, reservoir, radio mast; water + knowledge | water 80 / survivorActivity 45 | 11 |

**Graph shape.** One connected graph from the single start (`node.rivermouth.transit-plaza`). Each
region is an internally-connected subgraph (loops, not lines, so routing has choices), and **9
inter-region gateway routes** stitch the regions together so the whole city is reachable and
`region.adjacent` is realized in actual node edges (the harbor rail to the Ironworks, the gridlock
bridge to Downtown, the subway tunnel to Mercy, the ridge to Hillcrest, the canal to the waterworks, …).
Rivermouth's six shipped nodes keep their exact prose, kind, and flags — only city adjacency is added —
and the region keeps its `loadContent`-pinned baseline (threat 35, loot 70).

**Per-node content (content-as-data, FR-CNT-01).** Every node is a JSON file validated against
`node.schema.json`: a five-question-test description (a reason to exist, a decision it creates, systems
it touches, a story, a memory), a location `kind` (the FR-ECO-02 loot table), symmetric `adjacent`
edges, optional `start`/`claimable`/`walkers`/`zombieTypes`. Per-run memory (searchPct, damage, corpses,
blood, noise, fog, occupants, discoveries) is *not* in the file — the engine seeds it at run start and
it persists all run (GDD VII); the file is the static definition only. **14 claimable safehouses** are
spread across the city, and walker/screamer/stalker are seeded as first-pass menace (the full roster is
T46).

**Authoring method.** To make graph integrity impossible to get wrong across 60 nodes and ~76 edges, the
city is authored as a *validated data table*: every edge is declared once and symmetric adjacency is
built from it (asymmetry, a dangling edge, or a disconnected node throw at generate time), and the same
invariants the engine's `buildRegionGraph` enforces (single start, known refs, full connectivity) plus
the schema enums (kinds, zombie ids, id patterns) are checked before anything is emitted. The shipped
artifacts are the one-entity-per-file JSON files; the generator is a sandbox authoring aid, not shipped.

**Verification.** The generated city is validated three ways: (1) the **schema gate** (`npm run
validate`) over the whole tree; (2) the **real engine** `buildRegionGraph` + `startRun` (the harness
`content.test`), proving the city forms a valid, playable graph; (3) an **adversarial content-quality
subagent audit** against the five-question test, kind fit, near-duplicate prose, accessibility, and
region identity — its findings triaged and the real ones fixed.

**Test-budget update (the one code change).** `harness/test/content.test.ts` asserted the shipped graph
was 5–8 nodes — the M1–M3 slice budget. That cap is updated to the **M4 city budget (40–65 nodes, 6
regions)** and the test is strengthened into a real T44 guard: every region is populated, at least one
route crosses a region boundary, and several claimable safehouses exist. The start-node and
fog-reveal assertions are unchanged.

**DoD.** The first city is content-complete for Part 1 (6 regions, 60 nodes) and **schema-valid in CI**
(FR-CNT-02); the engine builds it into one connected graph from the single start; Rivermouth's slice is
preserved; the content-quality audit's real findings are fixed; CI is green in a clean sandbox (engine
349 · content-loader 9 · harness 48 · schema gate 78 entries / 7 types · malformed rejected · empty-turn
smoke). The **§6.4 node cap is hit (60/≈60)** — which the PRD names as the signal to *stop authoring
breadth and go playtest*, not to keep pouring.

## Test & CI posture

The standing gate is unchanged and run in full in a clean sandbox copy (the mount carries only
partial/host-OS deps): **engine + content-loader + harness** green plus the schema gate over real
content and the malformed-content rejection. Because **no engine test reads shipped content** (the
content-integration tests live in the harness by design), the entire engine suite (349) is untouched by
the content pour. The harness suite stays green (48, +1 from the strengthened content guard); the only
behavioral risk — that a bigger world perturbs region-drift RNG over shipped content — was checked and
every behavioral assertion holds (they test *change*, not exact values). Schema gate grows 19 → **78
entries** (the 54 new nodes + 5 new regions).

## What this block deliberately defers

- **Everything downstream of the city.** The survivor pool (T45), the full zombie roster (T46),
  encounters/chains (T47), repeat-suppression (T48), infection-as-identity (T49), radio (T50), the
  economy (T51), shelter depth (T52), factions (T53), depth screens (T54), audio (T55), and difficulty
  (T56) are the rest of M4 — they author *onto* this city.
- **Balance.** Region baselines and the node distribution are first-pass identity dials; the M5 staged
  passes (T59/T60) tune them against telemetry over the bigger map.
- **The playtest.** The cap is hit; a real traversal playtest of the full city (does it read at scale,
  do the gateways route well, is 60 nodes too many to hold) is the next thing the PRD asks for — logged
  to the parking lot (PL-M4-05), owner's call on timing.
- **Richer content taxonomies** the city surfaced (a loot `kind` set beyond six; per-district zombie
  signatures once the roster lands) — logged as PL-M4-01/02.
