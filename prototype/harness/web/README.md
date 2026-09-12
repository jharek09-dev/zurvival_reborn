# web — temporary browser-playable client (side tool, NOT a roadmap task)

A single self-contained HTML page that runs the **real** shipped engine + harness in the browser, so
the beta can be played by clicking choices instead of typing numbers in a terminal. Not a rewrite — it
reuses the engine/harness verbatim, so it stays byte-for-byte faithful and deterministic. A stop-gap
until the official web/native client (Post-launch · ADR-0004). This folder should NOT enter the
format-patch / status.json roadmap unless the owner decides to commit it.

## Files
- `webEntry.ts`   — re-exports exactly the engine+harness API the UI needs (esbuild `--global-name=Zurvival`).
- `build-web.mjs` — esbuild bundle + a `.js`→`.ts` resolver plugin. `--minify` for shipping; `--node` emits an ESM build used by the parity test.
- `styles.css`    — the "Ashfall & Ember" colorway (design/tokens.css) as a self-contained sheet.
- `ui.js`         — the vanilla-JS client: one-column reading pane, clickable choices (+ number keys), depth-screen overlays, new run / save / load. In-memory only — NO localStorage.
- `build-html.mjs`— inlines the bundle + CONTENT (content/*.json) + CSS + UI into one `.html`.

## Build (from repo root, esbuild available)
    node prototype/harness/web/build-web.mjs  /tmp/zurvival-bundle.js --minify
    node prototype/harness/web/build-html.mjs /tmp/zurvival-bundle.js content /tmp/zurvival-playable.html

The boot mirrors `playCli.ts` (registers `STORY_ARCS` + the encounter/radio/recipe/job/faction pools),
so a browser run is the full-city beta, not the slice. Determinism holds: same seed → same run —
verified against the Node engine build and the canonical `playSession` fold, and via a headless-Chromium
DOM smoke (see the build session notes).
