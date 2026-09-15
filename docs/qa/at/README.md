# Screen-reader transcripts (T63)

What **Orca 46** — a real screen reader — said while scripted scenarios played the two clients, and where DOM focus
landed (web client). Each file is the output of `prototype/harness/web/at/orca-run.mjs`; every step lists what Orca
spoke (`🔊`, the exact strings from its speech log) and PASS / **FAIL** against the scenario's expectations. How to
re-run them: `prototype/harness/web/at/README.md`. All recorded 2026-09-15 in the T63 cloud container (Ubuntu 24.04,
Xvfb, AT-SPI, Chromium 1194 from Playwright, xfce4-terminal), with the null speech backend — nothing was audible; the
log is the evidence.

## On the T63 build — every expectation held

| transcript | scenario |
|---|---|
| `T63_web-turn.md` | taking a turn; the heading outline |
| `T63_web-dialogs.md` | two depth screens opened, read, tabbed, closed |
| `T63_web-dialog-trap.md` | Tab after reading on inside a dialog |
| `T63_web-settings.md` | operating the Settings dialog |
| `T63_web-run-over.md` | the last turn of a run |
| `T63_cli-screen.md` | the terminal client: a turn, a depth screen, back |

## The same scripts on the pre-T63 clients

Run on the page built from the pre-T63 tree and on the pre-T63 terminal client. Which failures are defects:

- **`T63_PRE_web-turn.md` — 7 FAIL, all real.** After Enter, focus fell to `<body>`; Orca then read the scene
  **out of order** (story sentences interleaved with sound captions, status and the prompt — the whole card was one
  live region, refilled every turn), said "What you hear WHAT YOU HEAR", announced no choice count, and H found **no
  headings at all**. (The "Day 1, dawn 08:00 — at Collapsed Overpass" expectation passed: it was spoken, as the
  first of the sixteen fragments.)
- **`T63_PRE_web-dialog-trap.md` — 3 FAIL, all real.** After reading on with Down, Tab walked out of the Companions
  dialog into the page behind it (New, Save, Load).
- **`T63_PRE_cli-screen.md` — 5 FAIL: 4 real, 1 wording.** Opening Inventory, Orca never spoke the screen's title line,
  then ran the whole scene on after the screen; a bare Enter afterwards got "(type a number …)". The fifth — the hint
  "Enter returns to the story" not spoken — is the new hint's wording; the old hint, "[any other key returns to the
  story]", WAS spoken, and was false.

`web-dialogs`, `web-settings` and `web-run-over` use controls the pre-T63 page did not have, so they were not run
there.
