# prototype/

Engine code lives here, per ADR-0001 (TypeScript, accepted 2026-07-05).

## Packages

| Package | Holds |
| --- | --- |
| `engine/` | `@zurvival/engine` — the pure, deterministic, headless core. **Dependency-free at runtime** (dev deps only: TypeScript, Vitest, fast-check). Holds the GameState shape, the 14-stage turn pipeline, seeded named-stream RNG, and versioned save/load. Clients consume it; it never imports platform APIs. |
| `content-loader/` | `@zurvival/content-loader` — Ajv-backed loader + schema gate (T6, T8). Validates `content/` against JSON Schema (2020-12) and hands the engine already-validated plain objects. A loader/tooling dependency **only** — never imported by the engine core. |
| `harness/` | `@zurvival/harness` — the first headless client (T9). Runs an empty turn end to end and proves the M0 skeleton is deterministic and save-lossless. Run with `npm start`. |

Future packages (separate, consuming the engine): web client, bot client.

## Running it

Each package is standalone (`npm install` in its folder):

- `engine/` — `npm test` (Vitest + fast-check), `npm run typecheck`.
- `content-loader/` — `npm test`, `npm run typecheck`, and `npm run validate` (the content
  schema gate; pass a path to validate a specific tree, else it checks the repo `content/`).
- `harness/` — `npm start` (resolve and render one empty turn), `npm test`, `npm run typecheck`.

CI (`.github/workflows/ci.yml`) runs all of the above on every push and blocks merge on a red
result or on any content that fails the schema gate.

## Engine rules (ADR-0001)

- No ambient nondeterminism: `Math.random`, `Date.now`, `performance.now`, and
  iteration-order dependence on `Map`/`Set` are banned in `engine/`.
- All randomness derives from `meta.seed` via named streams whose state serializes with
  GameState (DESIGN §9). Clients may read a clock and pass timestamps in as data; the core
  never reads one itself.
- GameState is plain JSON throughout and every sim quantity is an integer, so a save is just
  `JSON.stringify(state)` wrapped in a versioned envelope.
