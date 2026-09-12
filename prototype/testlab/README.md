# testlab — the Zurvival Test Lab (side tool, NOT a roadmap task)

A single self-contained HTML page that **autoplays the real M4 build, checks every turn, and reports** — so
the current build can be tested by watching rather than by typing numbers in a terminal. It is the QA plan's
§4.1 *scripted action driver / state snapshotter* and §7.1 run-summary tool, and the precursor to the M5/T66
soak. Like `harness/web/`, it is a side tool: a README row and a CI block, no status.json task.

Nothing here re-implements game logic. The page bundles the **real engine + harness renderers** (the same
esbuild shape as `harness/web/`), so a Test Lab run is byte-for-byte the same engine as `npm run play`, and a
seed that fails here fails in the terminal client.

## Build and open

```
cd prototype/testlab
npm install
npm run build          # → dist/zurvival-testlab.html
```

Then double-click `dist/zurvival-testlab.html`. No server, no network, no storage — everything lives in the
page. (`--minify` shrinks it; `--content DIR` builds against another content tree.)

## What the page does

- **Lab tab.** Left: the batch setup (seeds, actions per run, policies, stocked/unstocked pack, difficulty,
  ironman, and the check settings). **Run batch** plays every seed × policy × pack combination headlessly
  and fills the Results tab; a batch of 8 × 4 × 2 runs takes a few seconds. Centre: the **Watch** pane — the
  real scene, rendered exactly as the terminal/browser client renders it, with the bot playing at an
  adjustable speed. The bot's pick is highlighted for a beat before it takes it. **Take over** pauses the bot
  and makes the choices clickable (or press 1–9); **Hand back** returns control. Every action, bot or human,
  runs the same checks; the strip above the scene shows each check's result for the last action. The depth
  screens (I / C / B / M / L) are one click away. Right: live telemetry (needs, pressure, ms per turn, history
  growth as sparklines), coverage, and this run's failures.
- **Results tab.** Summary tiles, a sortable per-run table (click a row to watch that run from its start), and
  every failure grouped by check with **Jump to turn** (replays the recorded choices to the failing step and
  drops you into the Watch pane there, paused), **Download save at turn** (the exact state, loadable by
  `npm run play -- --resume <file>`), **Copy repro**, and **Transcript**. **Export report** downloads the
  whole batch as JSON; **Copy summary** copies the text readout.
- **Checks tab.** What each check means and what it traces to.
- **Load save.** Paste or upload a `zurvival-save.json` (terminal client: press S). The bot continues from
  it in the Watch pane, and batches start every run from it — the way to auto-check a tester's bug report
  (BETA.md: "note the seed and the save file").

## The checks

Every action runs all of these; a failure is pinned to the turn and the action that produced it and never
stops the run, so one report shows everything.

| Id | Holds that | Traces to |
|---|---|---|
| CHK-LEGAL | a legal choice is always offered until the run ends (no soft-lock) | M4 DoD §4 |
| CHK-DET | the same state + action resolves identically twice | TC-DET-01 |
| CHK-AUDIT | a resolved turn changes at least one tracked system | FR-CORE-04 |
| CHK-TURN | the clock advances exactly as the choice's cost says; day never goes backwards | pipeline contract |
| CHK-INT | every number in state is an integer (`-0` reported separately) | ADR-0001 |
| CHK-SAVE | save → load reproduces the state exactly (every N actions and at the end) | TC-DET-05 |
| CHK-RESUME | one more turn from the loaded state equals one more turn from the live state | TC-DET-04 / T21 |
| CHK-RENDER | the scene and all five depth screens render non-empty | "boots and plays" |
| CHK-LEAK | the status line carries no digits outside `Pack: n/m` | INV-07 / FR-UI-02 |
| CHK-END | a run ends only as starved / dehydrated / infection, and offers nothing after | T22 / FR-INJ-08 |
| CHK-PERF | resolve + render per turn stays under the budget (default 100 ms — a desktop proxy for NFR-PERF-01) | TC-NFR-01 |
| CHK-CRASH | the engine and renderers never throw | NFR-REL-01 |
| CHK-REPLAY | replaying the recorded choices from the seed reproduces the final state and transcript | TC-DET-02 |

Reported but not failed: history growth per turn (PL-M2-06), save size, verbatim encounter repeats vs the
PRD §4 target, pacing, and coverage (verbs used, nodes/regions visited, combats, overruns, deepest infection
stage, encounters fired).

## Policies

`random` (uniform over offered choices — the fuzzer), `careful` (the exit-gate survival priority: treat,
drink, eat, rest, avoid fights, escape toward the calmest node), `greedy` (search first, never treats),
`fighter` (careful, but takes every fight). Each uses its own tiny PRNG seeded from the run seed — never the
engine's streams — so the bot is reproducible and the engine's determinism is untouched. A policy can only
ever return a choice the engine offered.

## Headless (CI)

The same core, from the command line:

```
npm run check                                   # 8 seeds × 4 policies × stocked+unstocked × 400 actions
npm run check -- --seeds 3 --turns 200
npm run check -- --seed tl-3 --policy random --unstocked --json out.json
npm run check -- --resume zurvival-save.json
```

Exit code 1 on any failed check. `npm test` runs the unit suite, including negative proofs that each check
actually fires (a float in state, a NaN the save format cannot carry, a renderer that throws, a leaked
digit, a zero budget).

## Files

- `src/boot.ts` — the full-city boot, pinned `createdAt`, the stocked kit (a realistic full pack), graph rebuild for saves.
- `src/policies.ts` — the four policies and the policy PRNG.
- `src/checks.ts` — the checks, `deepEqual`/`firstDiff`, `renderAll`.
- `src/runner.ts` — `RunSession` (step / peek / finish), `runToEnd`, `expandBatch`, `batchRuns`.
- `src/report.ts` — batch summary, text readout, reproduce lines.
- `src/entry.ts` — the esbuild entry (global `ZL`). `src/cli.ts` — the headless wrapper. `src/loadContent.ts` — Node content loader.
- `web/build.mjs` — bundles + inlines content/CSS/JS into `dist/zurvival-testlab.html`. `web/testlab.{html,css,js}` — the page.
