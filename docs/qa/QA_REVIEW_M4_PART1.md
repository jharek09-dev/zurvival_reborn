# QA Review — M4 Part 1 (T43–T44)

_Reviewed 2026-07-16. Scope: the three M4 decision gates resolved as ADRs (T43) and the full first-city
content bible (T44). New files: `design/decisions/{0004-platform-ordering,0005-cross-run-memory,0006-licensing}.md`,
a rewritten `design/decisions/README.md` register (the `LICENSE` deliberately left unchanged), 5 new
region JSON files + 54 new node JSON files (and 6 Rivermouth node files + the region file updated with
city adjacency), one strengthened test (`prototype/harness/test/content.test.ts`), and the status/
changelog/plan/QA docs. **No engine source, no schema change, no RNG, no save-schema rung.** An
independent adversarial content-quality subagent audit was run over all 66 content files; its material
findings were fixed (below). Focus: are the decisions sound and executed; does the city form a valid,
playable, schema-clean graph; is Rivermouth's slice preserved; is the content quality (five-question
test, kind fit, variety, accessibility) worthy of the pour; and is CI green._

## Verdict

Part 1 lays the foundation the rest of M4 pours onto, and it is solid. **T43** closes the three §9
decision gates with written ADRs against explicit criteria — web-first ratified with the client
ordering deferred-with-a-trigger (ADR-0004), a bounded local Chronicle + capped light unlocks for
cross-run memory (ADR-0005), and an all-rights-reserved beta with the final license deferred (ADR-0006) — and, crucially,
each ADR that constrains a *later* decision hands that constraint forward explicitly (ADR-0006 → the
T58 monetization criteria; ADR-0004 → the T69 launch gate; ADR-0005 → the M5 endings). The licensing
call closes the gate without walking a one-way door: the beta ships under the existing all-rights-reserved
LICENSE — an explicit license, not an open question, so the public beta is unblocked for real — while the
final selection rides with the coupled T58 decision under a named trigger (ADR-0006a).

**T44** replaces the single Rivermouth slice with the whole first city — **6 regions, 60 nodes** at the
top of the §6.4 band — as one connected, schema-valid graph from the single start, stitched by 9
inter-region gateway routes, with 14 claimable safehouses and per-district identity in both prose and
baseline dials. The properties this block most puts at risk hold. **Graph integrity:** the city was
authored so asymmetry, a dangling edge, or a disconnected node are impossible at author time, and then
verified by the *real* engine `buildRegionGraph` + `startRun` — not a re-implementation. **Slice
preservation:** Rivermouth's six shipped nodes keep their exact prose/kind/flags (a diff confirms only
`adjacent` grew, plus two intended `notes` updates), and the region keeps its `loadContent`-pinned
baseline (threat 35, loot 70), so the M3 arc and every content pin still hold. **No engine regression:**
no engine test reads shipped content (content-integration lives in the harness by design), so the full
engine suite (349) is untouched by a 60-node pour.

All suites are green in a clean Linux sandbox (**engine 349 · content-loader 9 · harness 48 (+1) ·
typecheck clean across all three packages · schema gate pass over 7 types / 78 entries · malformed
content still rejected · harness empty-turn end-to-end**). The only code change is the node-count cap in
`content.test.ts`, updated from the M1–M3 slice budget (5–8) to the M4 city budget (40–65, 6 regions)
and strengthened into a real T44 guard.

## What was checked and is solid

- **The three ADRs decide, against criteria, and don't drift.** Each follows the ADR-0003 shape
  (context + numbered selection criteria → options considered → decision → consequences → accept/veto
  closer). ADR-0004 resolves the gate by deciding the two things that matter now (the launch surface;
  no second client before v1.0) and **binds the ordering to a dated trigger (T69 → ADR-0004a)** rather
  than guessing — the §9 intent ("none silently stalls") is met without a data-free commitment.
  ADR-0005 protects the per-run "one more day" stakes (criterion 1) while giving M5 endings a
  deterministic, bounded source, and retires PL-M2-06 for the cross-run layer. ADR-0006 makes the
  coupled call in the **reversible order** — all-rights-reserved can be opened later, shipped permissive
  copies cannot be recalled — and **hands the selection forward** to T58 with the arguments for opening
  (moddable content-as-data, the portfolio-facing core) recorded rather than lost.
- **The licensing decision is closed, not executed-early.** `LICENSE` is unchanged — retaining it *is*
  the decision, and the beta has an explicit license to ship under; the register (`README.md`) is a decisions log with 0001–0006 and the two still-open PRD
  questions (monetization → T58, numeric thresholds → post-M2). `status.json` ADR rows match.
- **The city is one connected, valid graph.** `buildRegionGraph` accepts it (single start
  `node.rivermouth.transit-plaza`, all edges symmetric, all nodes reachable, all region refs known),
  proven by the harness `content.test` over the *shipped* files. 9 inter-region routes realize
  `region.adjacent` in actual node edges; every region carries ≥1 node; the fog reveal at start is
  unchanged (start + its two neighbours; the other 57 nodes fogged).
- **Content is content-as-data and schema-clean.** 60 node files + 6 region files validate against
  `node.schema.json` / `region.schema.json` in the schema gate (78 entries, 7 types); each node has a
  five-question description, a `kind` from the enum, symmetric `adjacent`, and per-district identity;
  the engine seeds per-node memory at run start (nothing static in the file).
- **Rivermouth's slice is preserved.** A byte-diff of the six shipped node files shows only added
  `adjacent` entries (city wiring) plus two intentional `notes` updates (region + overpass gateway);
  prose, kinds, `start`, and `claimable` are unchanged. The region baseline (threat 35, loot 70) is
  intact, so `loadContent.test` and the M3 arc content stay green.
- **CI is green and the gate still gates.** Full local run mirrors `ci.yml`: engine/content-loader/
  harness typecheck + test, `npm start` smoke, `npm run validate` over real content, and the
  malformed-content-must-be-rejected check — all pass.

## Findings

### Fixed this block (adversarial content-quality audit)

An independent subagent audited all 66 content files against the five-question test, kind fit,
near-duplicate prose, accessibility, and region identity. It found the content strong (no filler; the
five-question test, accessibility, and region identity all clean) and surfaced five worthwhile fixes,
all applied and re-verified green:

1. **[content] `ambulance-bay` was `kind: police` — implausible loot table.** The prose is a pure EMS
   bay (rigs, diesel pump, jump kits), no weapons, sitting among `medical` nodes, so the `police` loot
   table would surface implausible finds. **Fixed** → `kind: generic` (fuel + vehicles), leaving the
   region's firearms to the `evac-checkpoint` (`police`).
2. **[canon] a literal "zombie dog" at `scrap-yard`.** "A junkyard dog that stopped being a dog"
   implied a reanimated animal, but the undead taxonomy reads as human-only (walker/screamer/stalker).
   **Fixed** → reframed to a human hunter learning the blind aisles, preserving the stalker seeding and
   the human-only canon.
3–5. **[polish] three near-duplicate motif pairs** in adjacent same-region nodes — foundry/warehouse-row
   (both "sound carries + bulk"), ICU/morgue (both "bodies not where they should be"), observatory/
   ridge-road (both "the whole city below"). **Fixed** → each pair differentiated (warehouse-row is now
   a blind-canyon maze; the morgue a feel-your-way-through-the-dark shortcut; ridge-road drops the
   panorama the observatory owns).

### Simplifications & deferrals (by design — not defects)

- **The 6-kind loot enum is coarse for a full city (PL-M4-01).** A fire station and a military armory
  both fall to `police`; an ambulance bay to `generic`. Fine at city-VS scale; a richer kind→loot
  mapping (or a per-node loot-profile field) is post-VS, when the T51 economy and T17 tables grow.
- **Zombie seeding is the M2 roster only (PL-M4-02).** Nodes are flagged walker/screamer/stalker as
  first-pass menace; the full type set is T46, after which zombieTypes should be re-passed so each
  district's signatures match its identity (FR-CBT-07).
- **Region baselines + node distribution are first-pass (PL-M4-03).** Identity dials reasoned from each
  district's character, not balanced against a real cross-city run — the M5 staged passes (T59/T60)
  move them against telemetry.
- **Inter-region travel isn't surfaced as special yet (PL-M4-04).** A gateway route reads like any
  other move; "which district am I entering, what's it known for" is depth-screen / map-journal work
  (T54) and the fog/journal pass.
- **Region-drift determinism shifts with the bigger map (PL-M4-06).** Adding regions makes the shared
  `region` RNG stream draw once per region per tick, so Rivermouth's drift diverges from the M1–M3
  slice from turn 2 — expected and harmless (all behavioral tests hold), but any *future* golden pinning
  exact region numbers must be regenerated against the city. Seeding the jitter per-region-id (rather
  than sequentially) would restore per-run reproducibility across content growth, if ever wanted.

## Suggested follow-ups (owner's call)

1. **Playtest the city before pouring more (PL-M4-05).** The §6.4 node cap is hit (60/≈60) — the PRD's
   explicit signal to *stop authoring breadth and go playtest*. A real traversal run (pacing across
   regions, does the drift/director read at city scale, is 60 nodes too many to hold, do the 9 gateways
   route well) is the highest-value next step and should gate further M4 content.
2. **T45 next in the content order.** With the city on the map, the survivor pool + companions author
   *onto* it — the natural next block, and the people are the heart (GDD).
3. **Re-pass zombie seeding after T46 (PL-M4-02)** and **revisit the loot-kind taxonomy with T51
   (PL-M4-01)** — both are city-wide passes best done once their systems land, not now.
4. **When M5 endings (T61) begin, build the ADR-0005 Chronicle** — its shape, its forward-only
   migration rung (proven end-to-end by T65), and the capped unlock set (curated to stay
   non-snowballing).
