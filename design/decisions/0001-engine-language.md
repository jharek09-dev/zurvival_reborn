# 0001 — Engine language & runtime

- **Status:** accepted
- **Date:** 2026-07-05 (accepted 2026-07-05 by Jharek)

## Context

No `prototype/` code may begin until this is accepted (PRD §10 decision gate). Selection
criteria, fixed in PRD §10:

1. **Strong web deployment story** — web is the confirmed first platform.
2. **Good testing story for a deterministic core** — golden-run tests, property tests,
   byte-identical replay from seed+state (TEC-01).
3. **Shared core across web + bot clients** — the headless engine (TEC-03) must run unchanged
   under a browser client and a chat-bot client (ADR-0004 ordering deferred).

Also relevant: the simulation is bookkeeping, not physics (TEC-07), so raw compute performance
is not a differentiator; solo + AI iteration speed and review ease are (PRODUCTION §2).

## Options considered

**TypeScript (recommended).** Engine as a pure, dependency-free TS package; Node ≥ 22 for the
terminal harness, tests, tooling, and future bot client; any bundler for the web client.
Web story is native — the engine ships to the browser as-is, no bindings or WASM bridge.
Testing story is mature (Vitest: unit, property via fast-check, snapshot/golden-run).
One language across engine, content tooling, web client, and bot maximizes AI-assist leverage
and minimizes solo context-switching. Weaknesses: determinism needs discipline (see
Consequences); type system is erasable, so schema validation stays a runtime concern (pairs
with ADR-0002).

**Rust + WASM.** Best-in-class determinism and correctness guarantees. But: slower iteration
for a solo dev, WASM bridge adds friction to the web client and *two* FFI surfaces for bot +
tooling, and AI-generated Rust needs heavier review — the scarce resource (PRODUCTION §2).
Overkill for a bookkeeping simulation.

**C# / .NET.** Solid language and test story; web deploy means Blazor/WASM payloads or a
server, weakening criterion 1 for a text-first mobile-web game.

**Python.** Fastest authoring, but no serious in-browser story — fails criterion 1 (would force
server-side turns and an always-online game, contradicting NFR-PLAT).

**Godot/GDScript.** A scene-graph game engine buys nothing for a text-driven headless core and
fights criterion 3.

## Decision

**TypeScript**, with the engine as a **pure, dependency-free package** (`engine/` inside
`prototype/`), Node ≥ 22 LTS as tool/bot runtime, **Vitest** (+ fast-check) for tests. Clients
(terminal harness now; web, bot later) are separate packages that consume the engine — the
engine never imports platform APIs.

## Consequences

Easier: single-language repo; engine runs natively in browser, Node, and bot host (criterion
3 satisfied by construction); best AI-assist ecosystem; instant iteration loop.

Harder — determinism must be *enforced*, not assumed:

- **No ambient nondeterminism in the core.** `Math.random`, `Date.now`, `performance.now`,
  and direct `Map`/`Set` iteration-order dependence are banned in `engine/`; lint rules + a
  golden-run CI test are the backstop.
- **All randomness** flows from the seeded, named-stream RNG (M0 task T5).
- **Numeric discipline:** prefer integer math for sim quantities; floats only where
  cross-engine bit-stability doesn't matter.
- Runtime schema validation is required at content load (feeds ADR-0002; JSON-native formats
  get first-class treatment in TS).

If accepted: unblocks all M0 tasks (T3–T9). If vetoed: re-run this ADR against the same
criteria within the M0 time-box — an open ADR-0001 at M0 exit is a defined tripwire
(PRODUCTION §6.7).
