# web — the browser-playable client (side tool; since T63 the accessibility-verified client)

A single self-contained HTML page that runs the **real** shipped engine + harness in the browser, so the beta can be
played by clicking choices instead of typing numbers in a terminal. Not a rewrite — it reuses the engine/harness
verbatim, so it stays byte-for-byte faithful and deterministic. A stop-gap until the official web/native client
(Post-launch · ADR-0004).

Since **T63** it is also the client NFR-ACC-01..04 are verified on: landmarks and a heading outline, one polite
announcer and focus that follows a turn, native modal dialogs, depth screens as headings and lists, reader settings
(text to 200%, contrast, story font, spacing, announcement verbosity, single-key shortcuts on/off), OS reduced-motion
and forced colours. A CI step runs `a11y-check.mjs` (not yet run on a GitHub runner), and `at/` verifies it with a real screen reader.

## Files
- `webEntry.ts`   — re-exports exactly the engine+harness API the UI needs (esbuild `--global-name=Zurvival`).
- `build-web.mjs` — esbuild bundle + a `.js`→`.ts` resolver plugin. `--minify` for shipping; `--node` emits an ESM build used by the parity test.
- `styles.css`    — the "Ashfall & Ember" colorway (design/tokens.css) as a self-contained sheet. Linted against
  tokens.css by the a11y gate (`prototype/content-loader`, `npm run validate:a11y`).
- `ui.js`         — the vanilla-JS client. The RUN lives in memory only — no localStorage. The six reader settings
  are the one thing kept in `localStorage` (guarded; a browser that refuses storage just gets the defaults), because a
  low-vision player should not have to re-enlarge the text on every visit (ACCESSIBILITY §13.6).
- `build-html.mjs`— inlines the bundle + CONTENT (content/*.json) + CSS + UI into one `.html`.
- `a11y-check.mjs` + `a11y-contrast.js` — the CI accessibility check of the BUILT page in headless Chromium (T63).
- `at/`           — Orca scenarios and runner: the real-assistive-technology verification (T63; not in CI).

## Build (from prototype/harness, after `npm install`)
    node web/build-web.mjs  /tmp/zurvival-bundle.js --minify
    node web/build-html.mjs /tmp/zurvival-bundle.js ../../content /tmp/zurvival-playable.html
    node web/a11y-check.mjs /tmp/zurvival-playable.html        # needs Chrome/Chromium (CHROME_BIN or on PATH)

The boot mirrors `playCli.ts` (registers `STORY_ARCS` + the encounter/radio/recipe/job/faction/weapon/project/ending/
stand pools), so a browser run is the full-city beta, not the slice. **When a pool is added, register it in both
`ui.js` calls (`startRun` and `buildRegionGraph` take positional arguments) and build the page.**
